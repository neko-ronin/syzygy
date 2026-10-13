/**
 * Turns city *instances* into *geometry*.
 *
 * The generator deliberately emits transforms, not triangles, because it can
 * then stream chunks cheaply. This module bakes a chunk's worth of instances
 * into a single world-space mesh on the main thread. At ~8k triangles a chunk
 * that costs a few milliseconds, and in exchange every static draw in the
 * scene is one indexed call with no per-object state.
 *
 * Everything is baked at LOD 0 here. Tighter LODs are produced by the same
 * functions with a `lod` bias that drops prop kinds and facade detail.
 */

import { makeRng, qRotate, type Vec3, type Mat4, type Rng } from '../core/math';
import {
  MeshBuilder, type Mesh, FACE_ALL, type MeshOpts,
} from '../world/geometry';
import {
  type BuildingInstance, type Cable, type CityChunk, type PropInstance, PropKind,
  buildingPoint, cityPlan, GROUND_Y, oldTownOf, towerTiers,
} from '../world/citygen';
import {
  districtAtField, districtPaletteLinear, districtStyle,
  type ResolvedPalette, type DistrictStyle,
} from '../world/districts';
import { groundGrammarFor, groundSurfaceTag, walkingFamily, walkingAlbedo } from '../world/groundgrammar';
import { bakeGroundDetail, type GroundLight } from './groundbake';
import type { CrowdObstacle } from '../world/crowdobstacles';
import { walkingTriangles, type WalkingSurfaceTriangles } from '../world/walkingsurfaces';
import type { MarketStall } from '../world/marketgrammar';

// ---------------------------------------------------------------- materials

export const MAT = {
  DIFFUSE: 0,
  GLASS: 1,
  FOLIAGE: 2,
  METAL: 3,
  WATER: 4,
  EMISSIVE: 5,
  BRICK: 6,
  PLASTER: 7,
  /** Street deck. Deliberately *not* a facade: no windows, no shopfronts. */
  STREET: 8,
  /** Untextured painted surface, used by entity meshes. */
  PLAIN: 9,
} as const;
export type MatId = (typeof MAT)[keyof typeof MAT];

const STONE = 0.62;
const METAL_ROUGH = 0.38;

const LEAF_COLORS: Vec3[] = [
  [0.055, 0.185, 0.040], [0.040, 0.140, 0.048], [0.090, 0.240, 0.052],
  [0.130, 0.290, 0.060], [0.070, 0.165, 0.070], [0.180, 0.330, 0.075],
];

// ---------------------------------------------------------------- instance buffer

/**
 * Per-instance data: mat4 model (64B) + tint rgba (16B) + params (16B).
 * `params` is (matId, roughness, emissive, seed) which is all the G-buffer
 * fragment stage needs to specialise its shading.
 */
export const INSTANCE_FLOATS = 24;

export interface InstanceWriter {
  data: Float32Array;
  count: number;
  reset(): void;
  /** Push an identity-model instance; the common case for baked world chunks. */
  pushStatic(
    color: Vec3, matId: number, rough: number, emissive: number, seed: number,
  ): void;
  /** Push a transformed instance, for moving entities. */
  pushTransformed(
    model: Mat4, color: Vec3, matId: number, rough: number,
    emissive: number, seed: number, tintAlpha?: number,
  ): void;
}

export function makeInstanceWriter(capacity: number): InstanceWriter {
  const data = new Float32Array(capacity * INSTANCE_FLOATS);
  return {
    data,
    count: 0,
    reset() { this.count = 0; },
    pushStatic(color, matId, rough, emissive, seed) {
      if (this.count >= capacity) return;
      const o = this.count * INSTANCE_FLOATS;
      data[o] = 1; data[o + 5] = 1; data[o + 10] = 1; data[o + 15] = 1;
      data[o + 16] = color[0]; data[o + 17] = color[1]; data[o + 18] = color[2];
      data[o + 19] = 1;
      data[o + 20] = matId; data[o + 21] = rough; data[o + 22] = emissive; data[o + 23] = seed;
      this.count++;
    },
    pushTransformed(model, color, matId, rough, emissive, seed, tintAlpha = 1) {
      if (this.count >= capacity) return;
      const o = this.count * INSTANCE_FLOATS;
      data.set(model, o);
      data[o + 16] = color[0]; data[o + 17] = color[1]; data[o + 18] = color[2];
      data[o + 19] = tintAlpha;
      data[o + 20] = matId; data[o + 21] = rough; data[o + 22] = emissive; data[o + 23] = seed;
      this.count++;
    },
  };
}

// ---------------------------------------------------------------- district profile

/**
 * Everything the baker needs to know about a district in one lookup: the linear
 * palette, the accent used for signage and trims, the roof grammar, and the
 * wall material the fragment stage should specialise on.
 */
interface DistrictProfile {
  style: DistrictStyle;
  palette: ResolvedPalette;
  accent: Vec3;
  wallMat: number;
  roofStyle: DistrictStyle['roofStyle'];
}

/** Which material the G-buffer should treat this district's walls as. */
function wallMatFor(s: DistrictStyle): number {
  switch (s.key) {
    case 'terracotta-tiers': return MAT.BRICK;
    case 'rust-hangars': return MAT.METAL;
    case 'lantern-bazaar': return MAT.PLASTER;
    case 'glass-foxholes': return MAT.GLASS;
    default: return MAT.DIFFUSE;
  }
}

const PROFILE_CACHE = new Map<number, DistrictProfile>();
export function profileFor(id: number): DistrictProfile {
  let p = PROFILE_CACHE.get(id);
  if (!p) {
    const style = districtStyle(id);
    p = {
      style,
      palette: districtPaletteLinear(style),
      accent: style.accentColor,
      wallMat: wallMatFor(style),
      roofStyle: style.roofStyle,
    };
    PROFILE_CACHE.set(id, p);
  }
  return p;
}

// ---------------------------------------------------------------- buildings

/**
 * A tower shell. The generator gives a box; what makes it read as a building
 * is the *silhouette work* — setbacks, a crown, a parapet, a plinth, and the
 * vertical rib pilasters that catch the sun and give the canyon its rhythm.
 */
/** Exported for `__selftest.ts` only. */
const oldTown = (b: BuildingInstance): ReturnType<typeof oldTownOf> => oldTownOf(b.districtId, b.position[0], b.position[2], b.windowSeed);
const EMBER: Vec3 = [1.0, 0.42, 0.13];

/** Street-level fire: forge mouths glowing at the base, lighting the canyon from below. */
export function pushOldTownFire(bld: MeshBuilder, b: BuildingInstance, lights: BakedChunk['lights'], lod: number): void {
  const ot = oldTown(b);
  if (!ot || lod >= 2) return;
  const r = makeRng((b.windowSeed ^ 0x6f0e6e5) >>> 0);
  const hy = b.halfExtents[1], yb = -hy, tiers = towerTiers(b), T = tiers[0];
  if (ot.ruin) {
    const k = makeRng((b.windowSeed ^ 0x2b1a5e) >>> 0), TL = tiers[tiers.length - 1], top = yb + TL.y1;
    // One dim smoulder left on the stubs for the silhouette, unlit. The kiln
    // yards that were up here put the fire on the ruin roofs, 20-40 m above a
    // street that stayed near-black (R14 review 5, pose 15).
    bld.pushQuad(buildingPoint(b, -TL.hx * 0.5, top + 0.02, TL.hz * 0.5), buildingPoint(b, TL.hx * 0.5, top + 0.02, TL.hz * 0.5),
      buildingPoint(b, TL.hx * 0.5, top + 0.02, -TL.hz * 0.5), buildingPoint(b, -TL.hx * 0.5, top + 0.02, -TL.hz * 0.5),
      [0.55, 0.12, 0.03], 1, { emissive: 0.3, doubleSided: true });
    // Kiln yards at street level against one or two faces: brick-kerbed ember
    // beds broken into cells (one flat sheet read as a skylight, review 4), each
    // a low fire light, so the paving, the ruin's foot and the neighbours' walls
    // are lit from the ground. Raised 0.28 m on their kerbs so a footway never
    // swallows them.
    // Two or three faces: on one random face, both ruins in pose 15 turned their
    // fire away from the camera.
    const order = k.shuffle([0, 1, 2, 3]);
    for (let yi = 0, yards = 2 + (k.bool(0.5) ? 1 : 0); yi < yards; yi++) {
      const face = order[yi], half = face < 2 ? T.hz : T.hx, wall = face < 2 ? T.hx : T.hz;
      const Q = (t: number, y: number, d: number): Vec3 => facePoint(b, face, wall, t, y, d);
      const yaw = b.rotationY + (face < 2 ? Math.PI / 2 : 0);
      for (let i = 0, n = 2 + k.int(0, 1); i < n; i++) {
        // Spread along the face: independent draws stacked three beds on one spot.
        const t = half * 0.75 * (((i + 0.5) / n) * 2 - 1) + k.jitter(half * 0.12), d = 1.5 + k.next() * 1.4, w = 0.8 + k.next() * 1.2, dd = 0.45 + k.next() * 0.35, y = yb + 0.28;
        bld.pushBox(Q(t, yb + 0.14, d), [w + 0.12, 0.14, dd + 0.12], [0.16, 0.08, 0.05], { faces: FACE_ALL, rotationY: yaw });
        for (let g = 0; g < 4; g++) {
          if (k.next() < 0.2) continue;
          const heat = k.next() * k.next(), t0 = t - w + (g + k.next() * 0.2) * (w / 2), t1 = t0 + (0.6 + k.next() * 0.4) * (w / 2);
          bld.pushQuad(Q(t0, y + 0.005, d - dd), Q(t1, y + 0.005, d - dd), Q(t1, y + 0.005, d + dd), Q(t0, y + 0.005, d + dd),
            [1.0, 0.16 + 0.34 * heat, 0.03 + 0.06 * heat], 1, { emissive: 0.8 + 2.4 * heat, doubleSided: true });
        }
        if (lod < 1 && i < 2) lights.push({ pos: Q(t, yb + 1.3, d), radius: 14, color: [1.0, 0.4, 0.12], intensity: 2.8 });
      }
      // The shell burning inside, seen through its ground-floor openings.
      for (let m = 0, nm = 2 + k.int(0, 1); m < nm; m++) {
        const t = k.jitter(half * 0.75), hw = 0.6 + k.next() * 0.5, h = 2.0 + k.next() * 0.6;
        bld.pushQuad(Q(t - hw, yb + 0.1, 0.04), Q(t + hw, yb + 0.1, 0.04), Q(t + hw, yb + h, 0.04), Q(t - hw, yb + h, 0.04),
          [1.0, 0.36, 0.1], 1, { emissive: 2.6, doubleSided: true });
      }
    }
    return;
  }
  if (!ot.kiln) {
    // A brazier on the footway: a fire basket on a post. The street's light is
    // fire, not lamps (sheet C), and 2.8 m up it lays a pool on the paving. On a
    // local z face: lots are yawed to their street, so +-z is front or back; a
    // random face put half of them on side walls no street sees (pose 14).
    const face = 2 + r.int(0, 1), half = face < 2 ? T.hz : T.hx, wall = face < 2 ? T.hx : T.hz;
    const t = r.jitter(half * 0.7);
    const Q = (y: number): Vec3 => facePoint(b, face, wall, t, y, 1.3);
    bld.pushCylinder(Q(yb), Q(yb + 1.7), 0.06, 5, [0.16, 0.13, 0.11]);
    bld.pushCylinder(Q(yb + 1.7), Q(yb + 2.1), 0.26, 7, [0.22, 0.16, 0.12], { radiusTop: 0.38, capEnds: true });
    bld.pushCylinder(Q(yb + 2.1), Q(yb + 2.25), 0.36, 7, EMBER, { capEnds: true, emissive: 3.4 });
    if (lod < 1) lights.push({ pos: Q(yb + 2.8), radius: 13, color: [1.0, 0.46, 0.16], intensity: 2.4 });
    return;
  }
  for (let n = 0, faces = 1 + r.int(0, 1); n < faces; n++) {
    const face = 2 + r.int(0, 1), half = face < 2 ? T.hz : T.hx, wall = (face < 2 ? T.hx : T.hz) + 0.3;
    const t = r.jitter(half * 0.6), hw = 1.1 + r.next() * 0.6, h = 2.2 + r.next() * 0.6;
    const Q = (tt: number, y: number, dd: number): Vec3 => facePoint(b, face, wall, tt, y, dd);
    bld.pushQuad(Q(t - hw, yb + 0.1, 0.02), Q(t + hw, yb + 0.1, 0.02), Q(t + hw, yb + h, 0.02), Q(t - hw, yb + h, 0.02), [1.0, 0.5, 0.16], 1, { emissive: 3.0, doubleSided: true });
    // Above the mouth and out over the footway, so its pool spreads on the paving
    // (at 1.4 m it was a 1.4 m disc against the wall).
    if (lod < 1) lights.push({ pos: Q(t, yb + h + 0.6, 2.2), radius: 14, color: [1.0, 0.5, 0.18], intensity: 2.6 });
  }
}

/**
 * Sheet C's vertical chaos: rooms built onto the roof over generations, stacked
 * two or three high, some hanging past the parapet, a few with a lit window.
 */
function pushShanties(bld: MeshBuilder, b: BuildingInstance, P: (x: number, y: number, z: number) => Vec3, tx: number, tz: number, yRoof: number, dp: DistrictProfile, lod: number): void {
  const r = makeRng((b.windowSeed ^ 0x5a17e5) >>> 0);
  if (!r.bool(0.7)) return;
  const tones = [tint3(dp.palette.base, 0.75), tint3(dp.palette.secondary, 0.7), tint3(dp.palette.trim, 0.65), [0.36, 0.30, 0.24] as Vec3];
  for (let s = 0, stacks = 1 + r.int(0, 2); s < stacks; s++) {
    let x = r.jitter(tx * 0.8), z = r.jitter(tz * 0.8), y = yRoof;
    for (let k = 0, n = 1 + r.int(0, 2); k < n; k++) {
      const w = 1.6 + r.next() * 2.8, d = 1.6 + r.next() * 2.4, h = 2.4 + r.next() * 1.2;
      bld.pushBox(P(x, y + h / 2, z), [w / 2, h / 2, d / 2], tones[r.int(0, tones.length - 1)], { faces: FACE_ALL, rotationY: b.rotationY + r.jitter(0.15) });
      if (lod < 1 && r.bool(0.5)) {
        bld.pushBox(P(x, y + h * 0.55, z + d / 2 + 0.03), [0.35, 0.3, 0.02], [1.0, 0.68, 0.36], { faces: FACE_ALL, emissive: 2.4, rotationY: b.rotationY });
      }
      y += h; x += r.jitter(1.2); z += r.jitter(1.2);
    }
  }
}

/** Kiln stacks on a workshop roof, ember-mouthed. */
function pushKilns(bld: MeshBuilder, b: BuildingInstance, P: (x: number, y: number, z: number) => Vec3, tx: number, tz: number, yRoof: number, dp: DistrictProfile): void {
  const r = makeRng((b.windowSeed ^ 0x4b11a5) >>> 0);
  const brick = tint3(dp.palette.trim, 0.7);
  for (let k = 0, n = 1 + r.int(0, 2); k < n; k++) {
    const x = r.jitter(tx * 0.6), z = r.jitter(tz * 0.6), rad = 0.9 + r.next() * 1.0, h = 6 + r.next() * 9;
    bld.pushCylinder(P(x, yRoof, z), P(x, yRoof + h, z), rad, 7, brick, { radiusTop: rad * 0.75, capEnds: true });
    bld.pushCylinder(P(x, yRoof + h, z), P(x, yRoof + h + 0.5, z), rad * 0.78, 7, EMBER, { capEnds: true, emissive: 3.4 });
  }
}

/**
 * Bunting across the old town's streets at several low levels (sheet C's
 * signature): from a face to the building it faces, 6-40 m across. Pennants are
 * warm only (D28). Near field.
 */
const PENNANTS: Vec3[] = [[0.78, 0.22, 0.10], [0.92, 0.55, 0.14], [0.86, 0.80, 0.62], [0.55, 0.16, 0.12], [0.80, 0.42, 0.20], [0.30, 0.42, 0.22]];
export function pushOldTownBunting(bld: MeshBuilder, buildings: BuildingInstance[], lod: number): void {
  if (lod >= 1) return;
  for (const b of buildings) {
    const inBazaar = b.districtId === 4 && Math.hypot(b.position[0], b.position[2]) < 700;
    if (!oldTown(b) && !inBazaar) continue;
    const r = makeRng((b.windowSeed ^ 0x0b0a7e) >>> 0);
    const T = towerTiers(b)[0], yb = b.position[1] - b.halfExtents[1];
    for (let face = 0; face < 4; face++) {
      if (!r.bool(0.45)) continue;
      const c = Math.cos(b.rotationY), sn = Math.sin(b.rotationY);
      const lx = face === 0 ? 1 : face === 1 ? -1 : 0, lz = face === 2 ? 1 : face === 3 ? -1 : 0;
      const nx = lx * c + lz * sn, nz = -lx * sn + lz * c;
      const wall = face < 2 ? T.hx : T.hz;
      const sx = b.position[0] + nx * wall, sz = b.position[2] + nz * wall;
      let best = Infinity, top = 0;
      for (const o of buildings) {
        if (o === b) continue;
        const vx = o.position[0] - sx, vz = o.position[2] - sz, along = vx * nx + vz * nz;
        const rad = Math.min(o.halfExtents[0], o.halfExtents[2]);
        if (along < 6 || along > 40 + rad) continue;
        if (Math.hypot(vx - along * nx, vz - along * nz) > rad * 0.8) continue;
        if (along - rad < best) { best = along - rad; top = o.position[1] + o.halfExtents[1]; }
      }
      if (!Number.isFinite(best) || best < 5) continue;
      for (let k = 0, n = 1 + r.int(0, 2); k < n; k++) {
        const y = yb + 5 + r.next() * 11 + k * 3.5;
        if (y > top - 2 || y > yb + T.y1 - 2) break;
        const a: Vec3 = [sx, y, sz], e: Vec3 = [sx + nx * best, y + r.jitter(1.2), sz + nz * best];
        const sag = best * (0.05 + r.next() * 0.05);
        const at = (t: number): Vec3 => [a[0] + (e[0] - a[0]) * t, a[1] + (e[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (e[2] - a[2]) * t];
        const pts: Vec3[] = []; for (let i = 0; i <= 6; i++) pts.push(at(i / 6));
        bld.pushTubeAlongPath(pts, 0.025, 3, [0.12, 0.1, 0.09], { capEnds: false });
        const pal = r.bool(0.5) ? PENNANTS : [PENNANTS[r.int(0, 5)], PENNANTS[r.int(0, 5)], PENNANTS[2]];
        const tx = -nz, tz = nx, m = Math.floor(best / 0.8);
        for (let i = 1; i < m; i++) {
          const p = at(i / m), drop = 0.42 + r.next() * 0.16, hw = 0.22, col = pal[i % pal.length];
          bld.pushQuad([p[0] - nx * hw, p[1], p[2] - nz * hw], [p[0] + nx * hw, p[1], p[2] + nz * hw],
            [p[0] + nx * 0.02 + tx * 0.01, p[1] - drop, p[2] + nz * 0.02 + tz * 0.01], [p[0] - nx * 0.02 + tx * 0.01, p[1] - drop, p[2] - nz * 0.02 + tz * 0.01], col, 1, { doubleSided: true });
        }
      }
    }
  }
}

export function pushBuilding(
  bld: MeshBuilder, b: BuildingInstance, dp: DistrictProfile, rng: Rng, lod: number,
): void {
  const [hx, , hz] = b.halfExtents;
  // Local Y is measured from the building's BASE, not its centre.
  //
  // b.position[1] is the centre, and P() maps ly straight onto it, so local
  // y = 0 is the middle of the tower. The tier loop used to start there, which
  // meant the bottom half of every building was never emitted and the only
  // things standing below the tower were the plinth skirt and a few rib
  // pilasters — a building on stilts. Every vertical dimension below is now
  // written against yBase..yRoof so the shell meets the ground.
  const yBase = -b.halfExtents[1];
  const yRoof = b.halfExtents[1];
  const height = yRoof - yBase;
  const yaw = b.rotationY;
  const pal = dp.palette;
  const seed = b.windowSeed;
  // ±4% per building: neighbours stop reading as one wall, and the G-buffer
  // hashes this colour into a per-building seed (the instance seed is per chunk).
  const jit = 0.96 + 0.08 * ((Math.imul(seed | 0, 0x9e3779b1) >>> 0) / 4294967296);
  const base: Vec3 = [pal.base[0] * jit, pal.base[1] * jit, pal.base[2] * jit];

  // Local → world for a point in the building's own frame (lean shear from the
  // base, then yaw): the same definition prop placement uses.
  const P = (lx: number, ly: number, lz: number): Vec3 => buildingPoint(b, lx, ly, lz);

  const mat = dp.wallMat;
  const rough = mat === MAT.METAL ? METAL_ROUGH : mat === MAT.BRICK ? STONE + 0.1 : STONE;

  // --- stacked setbacks: the tower narrows in 1-3 steps toward the crown.
  // Tiers come from the building (`towerTiers`), not this chunk's RNG, so props,
  // downpipes and pilasters placed by the generator stand on these walls.
  const ot = oldTown(b);
  // A burnt-out shell (sheet C): the upper storeys are gone, the roof has fallen
  // in below jagged wall stubs, the walls are sooted and no window is lit.
  // Old-town brick is sooted toward grey (generations of kilns). Full-saturation
  // terracotta clipped to flat red under the dusk sun (R14 review 4).
  const sootBase: Vec3 = ot ? [base[0] * 0.62 + 0.38 * (base[0] * 0.3 + base[1] * 0.5 + base[2] * 0.2), base[1] * 0.62 + 0.38 * (base[0] * 0.3 + base[1] * 0.5 + base[2] * 0.2), base[2] * 0.62 + 0.38 * (base[0] * 0.3 + base[1] * 0.5 + base[2] * 0.2)] : base;
  const tiers = towerTiers(b);
  const totalH = height;
  for (let t = 0; t < tiers.length; t++) {
    const T = tiers[t], isLast = t === tiers.length - 1;
    pushBoxShell(bld, P, T.hx, T.hz, yBase + T.y0, yBase + T.y1, ot?.ruin ? tint3(sootBase, 0.42) : sootBase, mat, rough, seed + t, lod, yaw,
      ot?.ruin ? FACADE_UV_RUIN : ot ? FACADE_UV_OLDTOWN : dp.style.reflectiveGlass ? FACADE_UV_REFLECTIVE : FACADE_UV);
    // Parapet lip on top of the tier.
    if ((!isLast || lod < 1) && !ot?.ruin) {
      pushBoxShell(
        bld, P, T.rimHx + 0.16, T.rimHz + 0.16, yBase + T.y1, yBase + T.y1 + (isLast ? 1.1 : 0.9),
        pal.trim, mat, rough * 0.9, seed + t + 40, 1, yaw,
      );
    }
  }
  const tx = tiers[tiers.length - 1].rimHx, tz = tiers[tiers.length - 1].rimHz;
  // A lit crown on tall towers: a warm band round the top parapet, so silhouettes
  // carry against the night sky (R14: crowns dissolved into the navy). Per-vertex
  // emissive, so it fades by day like every authored light (D27, D28).
  if (ot?.ruin) {
    // Jagged wall stubs round the fallen roof: the collapsed silhouette.
    const T = tiers[tiers.length - 1], r = makeRng((b.windowSeed ^ 0x57ab5) >>> 0), y0 = yBase + T.y1;
    const soot = tint3(base, 0.32);
    for (const [ax, az, len] of [[0, T.hz, T.hx], [0, -T.hz, T.hx], [T.hx, 0, T.hz], [-T.hx, 0, T.hz]] as const) {
      for (let u = -len + 1.2; u < len - 0.6; u += 2.0 + r.next() * 1.6) {
        if (r.next() < 0.25) continue;
        const h = 0.6 + r.next() * r.next() * 7.5, w = 0.8 + r.next() * 1.2;
        const cx = ax === 0 ? u : ax, cz = ax === 0 ? az : u;
        bld.pushBox(P(cx, y0 + h / 2, cz), ax === 0 ? [w / 2, h / 2, 0.3] : [0.3, h / 2, w / 2], soot, { faces: FACE_ALL, rotationY: yaw });
      }
    }
  } else if (ot && lod < 2) {
    const T = tiers[tiers.length - 1], top = yBase + T.y1;
    if (ot.kiln) pushKilns(bld, b, P, T.hx, T.hz, top, dp);
    pushShanties(bld, b, P, T.hx, T.hz, top, dp, lod);
  }
  if (height > 140 && lod < 2 && !ot) {
    // A lit top storey, 3 m: a thin parapet strip was 0.1 px at skyline range.
    const yc = yRoof - 1.6, cx = tx + 0.06, cz = tz + 0.06;
    const crown = { emissive: 2.6, doubleSided: true };
    const amber: Vec3 = [1.0, 0.7, 0.36];
    bld.pushQuad(P(-cx, yc - 1.5, cz), P(cx, yc - 1.5, cz), P(cx, yc + 1.5, cz), P(-cx, yc + 1.5, cz), amber, 1, crown);
    bld.pushQuad(P(cx, yc - 1.5, -cz), P(-cx, yc - 1.5, -cz), P(-cx, yc + 1.5, -cz), P(cx, yc + 1.5, -cz), amber, 1, crown);
    bld.pushQuad(P(cx, yc - 1.5, cz), P(cx, yc - 1.5, -cz), P(cx, yc + 1.5, -cz), P(cx, yc + 1.5, cz), amber, 1, crown);
    bld.pushQuad(P(-cx, yc - 1.5, -cz), P(-cx, yc - 1.5, cz), P(-cx, yc + 1.5, cz), P(-cx, yc + 1.5, -cz), amber, 1, crown);
  }
  // Pilasters stand on the first tier's walls, so they stop where it does.
  const tier0Top = yBase + tiers[0].y1;

  // --- plinth: the first 8m is a different material, like a real base course.
  // A ruin's plinth is burnt too: tagged plain, it kept lit shop displays and neon
  // under a sooted shell, which read as an intact building (R14 review 5).
  if (lod < 2) {
    const plinthH = Math.min(7.5, totalH * 0.25);
    pushBoxShell(bld, P, hx + 0.28, hz + 0.28, yBase, yBase + plinthH,
      pal.secondary, MAT.DIFFUSE, STONE + 0.15, seed + 7, 0, yaw, ot?.ruin ? FACADE_UV_RUIN : ot ? FACADE_UV_OLDTOWN : FACADE_UV);
  }

  // --- vertical pilasters. These are the single cheapest thing that makes a
  //     flat wall read as architecture: they catch the sun and give the canyon
  //     its vertical rhythm as the light sweeps across it.
  if (lod < 2) {
    const ribW = 0.22;
    // `pushRib*` take an absolute top. This passed the run LENGTH (height - 6)
    // where yBase = -height/2, so every rib rose height/2 - 6 above the roof:
    // 144 m of trim standing in open sky over a 300 m tower, which aliased into
    // the columns of dashes above the whole skyline. Upper tiers are inset, so
    // ribs also stop at the first tier rather than float beside them.
    const ribTop = tier0Top - 3;
    const runH = ribTop - (yBase + 3);
    if (runH >= 6) {
      const count = Math.max(2, Math.round(hx / 4.2));
      for (let i = 0; i < count; i++) {
        const f = count === 1 ? 0.5 : i / (count - 1);
        const lx = (f - 0.5) * 2 * (hx - 0.4);
        for (const sz of [1, -1]) {
          pushRibZ(bld, P, lx, sz * (hz + 0.10), yBase + 3, ribTop, ribW,
            pal.trim, seed + i);
        }
      }
      const countZ = Math.max(2, Math.round(hz / 4.2));
      for (let i = 0; i < countZ; i++) {
        const f = countZ === 1 ? 0.5 : i / (countZ - 1);
        const lz = (f - 0.5) * 2 * (hz - 0.4);
        for (const sx of [1, -1]) {
          pushRibX(bld, P, sx * (hx + 0.10), lz, yBase + 3, ribTop, ribW,
            pal.trim, seed + i + 20);
        }
      }
    }
  }

  // --- crown: whatever tops this district off (a ruin has none left).
  if (!ot?.ruin) pushCrown(bld, P, tx, tz, yRoof, dp, rng, lod);
}

/**
 * Reference-sheet features, decided per building from its own seed (no chunk RNG,
 * so nothing else re-rolls) and built in the building's frame, so they sit on the
 * real wall of the tier.
 *
 * Sheet B (cold-industrial): exposed scaffolding clinging to tower faces, plank
 * decks, braces, tarp-covered bays. Sheet D (verdant): deep planted terrace bands
 * with shrubs and vine curtains. Copper Stacks is in no reference section; a few
 * of its towers take B's scaffolding, which fits its industrial brief and leaves
 * its colour alone (D27).
 */
const SCAFFOLD_CHANCE: Record<string, number> = {
  'rust-hangars': 0.35, 'glass-foxholes': 0.35, 'canal-district': 0.3, 'copper-stacks': 0.12,
};
const TERRACE_CHANCE: Record<string, number> = { 'botanical-dome': 0.6, 'verdant-canyon': 0.7, 'canal-district': 0.4 };
const SCAFFOLD_DECK: Vec3 = [0.30, 0.22, 0.14];
/** Sunlit terrace planting (sheet D measures ~(91,112,74) sRGB on its foliage). */
const TERRACE_LEAF: Vec3[] = [[0.20, 0.33, 0.06], [0.26, 0.37, 0.07], [0.15, 0.28, 0.05], [0.30, 0.40, 0.09]];
/** Spheres a terraced building spends on ivy and hanging masses at most; see `pushTerraces`. */
const TERRACE_HANG_BUDGET = 360;
/** Wall ivy: darker and cooler than the sunlit terrace masses. */
const IVY: Vec3[] = [[0.10, 0.22, 0.06], [0.13, 0.26, 0.07], [0.08, 0.19, 0.06]];
/** Blooms on the odd terrace mass: warm pink and cream (sheet D's balcony flowers). */
const TERRACE_FLOWER: Vec3[] = [[0.72, 0.30, 0.38], [0.80, 0.62, 0.50], [0.66, 0.22, 0.30]];
const TARPS: Vec3[] = [[0.14, 0.24, 0.34], [0.55, 0.28, 0.12], [0.22, 0.28, 0.20], [0.42, 0.40, 0.36]];
/** Sheet B's bolted-on rooms: slate sheet, faded blue, rust-red panel, timber, near-black, grey (pale ones read as primitives, review 5). */
const ROOMS: Vec3[] = [[0.22, 0.24, 0.26], [0.17, 0.22, 0.27], [0.40, 0.15, 0.10], [0.33, 0.24, 0.16], [0.13, 0.15, 0.17], [0.30, 0.31, 0.30]];

/** A point `t` along face `face`, `d` out from its wall, at local height `ly` (from the centre). */
function facePoint(b: BuildingInstance, face: number, wall: number, t: number, ly: number, d: number): Vec3 {
  const nx = face === 0 ? 1 : face === 1 ? -1 : 0, nz = face === 2 ? 1 : face === 3 ? -1 : 0;
  return buildingPoint(b, nx * (wall + d) + (face < 2 ? 0 : t), ly, nz * (wall + d) + (face < 2 ? t : 0));
}

export function pushScaffold(bld: MeshBuilder, b: BuildingInstance, dp: DistrictProfile, lod: number, lights?: BakedChunk['lights']): void {
  const chance = SCAFFOLD_CHANCE[dp.style.key] ?? 0;
  if (!chance || lod >= 2) return;
  const r = makeRng((b.windowSeed ^ 0x5caff01d) >>> 0);
  if (!r.bool(chance)) return;
  const T = towerTiers(b)[0], hy = b.halfExtents[1], yBase = -hy;
  const face = r.int(0, 3);
  const half = face < 2 ? T.hz : T.hx, wall = face < 2 ? T.hx : T.hz;
  const Q = (t: number, y: number, d: number): Vec3 => facePoint(b, face, wall, t, y, d);
  // Sheet B is irregular: stacked segments of different widths and offsets,
  // decks cantilevered past the frame, X-braces, sparse tarps and shacks lit
  // from inside. A regular full-height lattice read as a ladder decal (R14).
  const metal = tint3(dp.palette.metal, 0.45), lift = 2.0;
  let y = yBase + Math.min(7.5, hy * 2 * 0.25) + 0.5;
  const top = Math.min(yBase + T.y1 + (r.bool(0.4) ? 6 : -1), y + 22 + r.next() * 50);
  let mid = r.jitter(half * 0.4);
  for (let seg = 0; y + 6 < top && seg < 4; seg++) {
    const h = Math.min(top - y, 8 + r.next() * 14);
    const W = Math.min(half * 2 * (0.3 + r.next() * 0.45), 18);
    mid = Math.max(-half + W / 2, Math.min(half - W / 2 + 2, mid + r.jitter(5)));
    const bays = Math.max(2, Math.round(W / 2.4));
    const ts = Array.from({ length: bays + 1 }, (_, i) => mid - W / 2 + (i * W) / bays);
    const dOut = 1.8 + r.next() * 1.2, dIn = 0.3;
    for (const t of ts) for (const d of lod < 1 ? [dIn, dOut] : [dOut]) bld.pushTubeAlongPath([Q(t, y, d), Q(t, y + h, d)], 0.1, 4, metal, { capEnds: false });
    const levels = Math.max(1, Math.floor(h / lift));
    for (let k = 0; k <= levels; k++) {
      const yy = y + k * lift;
      // Far field (LOD 1) keeps uprights, decks, shacks and lit windows: the read
      // and the night points. Rails, braces and tarps are near-field only.
      if (lod < 1) bld.pushTubeAlongPath([Q(ts[0], yy, dOut), Q(ts[bays], yy, dOut)], 0.07, 3, metal, { capEnds: false });
      if (k === 0 || k === levels || r.next() < 0.4) {
        // Some decks cantilever past the frame on outriggers.
        const out = r.bool(0.3) ? dOut + 1.4 + r.next() * 1.6 : dOut;
        bld.pushQuad(Q(ts[0], yy, dIn), Q(ts[bays], yy, dIn), Q(ts[bays], yy, out), Q(ts[0], yy, out), SCAFFOLD_DECK, 1, { doubleSided: true });
        bld.pushQuad(Q(ts[0], yy, out), Q(ts[bays], yy, out), Q(ts[bays], yy + 0.4, out), Q(ts[0], yy + 0.4, out), SCAFFOLD_DECK, 1, { doubleSided: true });
        if (out > dOut) for (const t of [ts[0], ts[bays]]) bld.pushTubeAlongPath([Q(t, yy - 1.6, dOut), Q(t, yy, out)], 0.06, 3, metal, { capEnds: false });
        // A shack on the deck: a box with a warm lit window (sheet B's stacked rooms).
        if (r.bool(0.35) && k < levels) {
          const sw = 1.2 + r.next() * 1.4, sd = Math.min(out - dIn, 2.0), sh = 1.8 + r.next() * 0.8, t0 = mid + r.jitter(W / 2 - sw);
          const c = TARPS[r.int(0, TARPS.length - 1)];
          bld.pushBox(Q(t0, yy + sh / 2, dIn + sd / 2), [sw / 2, sh / 2, sd / 2], tint3(c, 0.8), { faces: FACE_ALL, rotationY: b.rotationY + (face < 2 ? Math.PI / 2 : 0) });
          if (r.bool(0.7)) {
            const wd = dIn + sd + 0.02;
            bld.pushQuad(Q(t0 - 0.3, yy + sh * 0.45, wd), Q(t0 + 0.3, yy + sh * 0.45, wd), Q(t0 + 0.3, yy + sh * 0.75, wd), Q(t0 - 0.3, yy + sh * 0.75, wd), [1.0, 0.72, 0.4], 1, { emissive: 3.2 });
          }
        }
        if (lights && lod < 1 && r.next() < 0.25) {
          const lp = Q(ts[r.int(0, bays)], yy + 1.4, dOut - 0.3);
          bld.pushBox(lp, [0.18, 0.12, 0.18], [1.0, 0.7, 0.36], { emissive: 4.0, faces: FACE_ALL });
          lights.push({ pos: lp, radius: 9, color: [1.0, 0.68, 0.34], intensity: 1.6 });
        }
      }
      for (let i = 0; i < bays && k < levels; i++) {
        if (r.next() < 0.06 && lod < 1) {
          const tp = TARPS[r.int(0, TARPS.length - 1)], yt = yy + lift * (1.4 + r.next() * 0.6);
          bld.pushQuad(Q(ts[i], yy + 0.4, dOut + 0.06), Q(ts[i + 1], yy + 0.4, dOut + 0.06), Q(ts[i + 1], yt, dOut + 0.06), Q(ts[i], yt, dOut + 0.06), tp, 1, { doubleSided: true });
        }
        if ((i + k) % 2 === 0 && lod < 1) {
          bld.pushTubeAlongPath([Q(ts[i], yy, dOut), Q(ts[i + 1], yy + lift, dOut)], 0.06, 3, metal, { capEnds: false });
          bld.pushTubeAlongPath([Q(ts[i + 1], yy, dOut), Q(ts[i], yy + lift, dOut)], 0.06, 3, metal, { capEnds: false });
        }
      }
    }
    // Rooms bolted on over generations (sheet B): stacks of boxes hung off the
    // frame, wider and deeper than the decks, on struts back to the wall, each
    // with a lit window. The flush 2 m shacks hid behind the lattice (R14 review 4).
    for (let st = 0, stacks = 1 + r.int(0, 2); st < stacks; st++) {
      // Not on the first lift of the first segment: a stack there swallowed the
      // scaffold's foot and read as a kiosk (R14 review 5).
      const lo = seg === 0 ? 2 : 0;
      let ry = y + lift * r.int(lo, Math.max(lo, Math.floor(h / lift) - 1)), rt = mid + r.jitter(W / 2);
      for (let n = 0, high = 1 + r.int(0, 2); n < high && ry + 2.4 < top; n++) {
        const sw = 2.4 + r.next() * 2.2, sh = 2.4 + r.next() * 0.8, sd = 2.2 + r.next() * 1.6;
        const c = ROOMS[r.int(0, ROOMS.length - 1)], yaw = b.rotationY + (face < 2 ? Math.PI / 2 : 0);
        const rd = dIn + sd / 2 + r.next() * 0.8;
        bld.pushBox(Q(rt, ry + sh / 2, rd), [sw / 2, sh / 2, sd / 2], tint3(c, 0.85 + r.next() * 0.3), { faces: FACE_ALL, rotationY: yaw });
        // A thin roof sheet with an overhang.
        bld.pushBox(Q(rt, ry + sh + 0.06, rd + 0.15), [sw / 2 + 0.25, 0.06, sd / 2 + 0.3], tint3(c, 0.55), { faces: FACE_ALL, rotationY: yaw });
        const front = rd + sd / 2 + 0.02;
        for (let wn = 0, wins = sw > 3.4 ? 2 : 1; wn < wins; wn++) {
          if (!r.bool(0.75)) continue;
          const wt = rt + (wins === 2 ? (wn - 0.5) * sw * 0.45 : 0);
          bld.pushQuad(Q(wt - 0.35, ry + sh * 0.42, front), Q(wt + 0.35, ry + sh * 0.42, front), Q(wt + 0.35, ry + sh * 0.74, front), Q(wt - 0.35, ry + sh * 0.74, front), [1.0, 0.72, 0.4], 1, { emissive: 3.0 });
        }
        if (n === 0) for (const e of [-sw / 2 + 0.2, sw / 2 - 0.2]) bld.pushTubeAlongPath([Q(rt + e, ry - 2.2, 0.05), Q(rt + e, ry, rd + sd / 2 - 0.2)], 0.06, 3, metal, { capEnds: false });
        ry += sh + 0.12; rt += r.jitter(1.4);
      }
    }
    y += h;
  }
}

/** A draped leaf mass hanging from (t, y): two abreast, tapering slowly as it falls. */
function hangLeaves(leafBld: MeshBuilder, Q: (t: number, y: number, d: number) => Vec3, t: number, y: number, d: number, fall: number, leaf: Vec3, r: Rng): void {
  let yy = y, rad = 0.6 + r.next() * 0.35;
  for (let step = 0; yy > y - fall && rad > 0.24 && step < 12; step++) {
    const c = tint3(leaf, 0.62 + r.next() * 0.2);
    leafBld.pushSphere(Q(t - rad * 0.45, yy - rad * 0.5, d), rad, 5, 3, c);
    leafBld.pushSphere(Q(t + rad * 0.5, yy - rad * 0.8, d - 0.1), rad * 0.85, 5, 3, c);
    yy -= rad * 1.25; rad *= 0.9; t += r.jitter(0.3);
  }
}

export function pushTerraces(bld: MeshBuilder, leafBld: MeshBuilder, b: BuildingInstance, dp: DistrictProfile, lod: number): void {
  const chance = TERRACE_CHANCE[dp.style.key] ?? 0;
  if (!chance || lod >= 2) return;
  const r = makeRng((b.windowSeed ^ 0x7e44ace5) >>> 0);
  if (!r.bool(chance)) return;
  const hy = b.halfExtents[1], yBase = -hy, fh = b.floorHeight;
  const faces = [r.int(0, 3)];
  if (r.bool(0.6)) faces.push(faces[0] ^ 1);
  const every = 2 + (r.bool(0.3) ? 1 : 0);
  const slabCol = tint3(dp.palette.secondary, 0.95), timber: Vec3 = [0.42, 0.24, 0.11];
  // Every tier, not only the base: a setback tower left its upper tier bare above
  // three planted bands (R14 review 5, pose 13). Eight bands at most per face.
  const tiers = towerTiers(b), gap = fh * every;
  // Ivy and hanging masses scale with face width x bands, which put 139k leaf
  // triangles on one 123 m tower and 1.04M on chunk (1,4). Their density is
  // scaled so a building spends about TERRACE_HANG_BUDGET spheres on them,
  // evenly over every band (a running counter would starve the upper bands).
  let planted = 0;
  for (const T of tiers) for (const face of faces) {
    const w = (face < 2 ? T.hz : T.hx) * 0.86;
    planted += w * Math.min(8, Math.max(0, Math.floor((T.y1 / fh - Math.ceil(T.y0 / fh) - 3) / every) + 1));
  }
  const thin = Math.min(1, TERRACE_HANG_BUDGET / Math.max(1, planted * 3.2));
  const bands = [0, 0, 0, 0];
  for (const T of tiers) {
    for (const face of faces) {
      const half = face < 2 ? T.hz : T.hx, wall = face < 2 ? T.hx : T.hz, w = half * 0.86;
      const Q = (t: number, yy: number, d: number): Vec3 => facePoint(b, face, wall, t, yy, d);
      if (lod < 1) {
        // A garden on the tier's top edge (the setback or the roof), spilling over
        // and hanging down the wall: the top floors of a tier sit above its last
        // band and were bare.
        const yt = yBase + T.y1, leaf = TERRACE_LEAF[r.int(0, TERRACE_LEAF.length - 1)];
        for (let t = -w; t < w; t += 0.8 + r.next() * 1.2) {
          const rad = 0.5 + r.next() * r.next() * 1.1;
          leafBld.pushSphere(Q(t + r.jitter(0.4), yt + rad * 0.3, -0.4 + r.next() * 0.9), rad, 5, 3, tint3(leaf, 0.75 + r.next() * 0.35));
          if (r.next() < 0.35 * thin) hangLeaves(leafBld, Q, t, yt - 0.2, 0.35, 1.0 + r.next() * r.next() * gap * 0.7, leaf, r);
        }
      }
      for (let f = Math.ceil(T.y0 / fh) + 2; bands[face] < 8 && (f + 1) * fh < T.y1; f += every, bands[face]++) {
        const y = yBase + f * fh, depth = 2.6 + r.next() * 1.0;
        // Slab, a warm timber fascia (sheet D's timber edges; the soffit alone was
        // unseen from above), its soffit, and the shadow it casts on the wall.
        bld.pushQuad(Q(-w, y, 0), Q(w, y, 0), Q(w, y, depth), Q(-w, y, depth), slabCol, 1, { doubleSided: true });
        bld.pushQuad(Q(-w, y - 0.55, depth), Q(w, y - 0.55, depth), Q(w, y, depth), Q(-w, y, depth), timber, 1, { doubleSided: true });
        if (lod < 1) {
          bld.pushQuad(Q(-w, y - 0.5, 0), Q(-w, y - 0.5, depth), Q(w, y - 0.5, depth), Q(w, y - 0.5, 0), timber, 1, { doubleSided: true });
          bld.pushQuad(Q(-w, y - 1.6, 0.03), Q(w, y - 1.6, 0.03), Q(w, y - 0.5, 0.03), Q(-w, y - 0.5, 0.03), tint3(dp.palette.base, 0.45), 1);
        }
        // A warm lamp strip under the fascia: a continuous line at night, at any distance.
        bld.pushQuad(Q(-w, y - 0.62, depth - 0.15), Q(w, y - 0.62, depth - 0.15), Q(w, y - 0.55, depth - 0.15), Q(-w, y - 0.55, depth - 0.15), [1.0, 0.74, 0.42], 1, { emissive: 2.2, doubleSided: true });
        if (lod >= 1) continue;
        // Sunlit yellow-green, not the street planters' shade green.
        const leaf = tint3(TERRACE_LEAF[r.int(0, TERRACE_LEAF.length - 1)], 1);
        // Overgrown, not potted (sheet D): big overlapping masses across the
        // whole band, stacked and spilling over the fascia, lighter on top, the
        // odd one in flower. Single-file blobs covered 9.4% of the facade against
        // the sheet's ~40% (review 5): coverage comes from size, not count.
        for (let t = -w + 0.5; t < w - 0.4; t += 0.9 + r.next() * 1.3) {
          for (let k = 0, nk = 1 + r.int(0, 1); k < nk; k++) {
            const rad = 0.7 + r.next() * r.next() * 1.5;
            const lit = 0.75 + r.next() * 0.35 + (rad > 1.1 ? 0.15 : 0);
            const c = Q(t + r.jitter(0.5), y + rad * 0.5 + r.next() * 0.6, 0.6 + r.next() * (depth - 0.3));
            leafBld.pushSphere(c, rad, 5, 3, tint3(leaf, lit));
            // The odd mass in flower: a few small blooms on its crown.
            if (r.next() < 0.08) {
              const fc = TERRACE_FLOWER[r.int(0, TERRACE_FLOWER.length - 1)];
              for (let fl = 0; fl < 3; fl++) leafBld.pushSphere([c[0] + r.jitter(rad * 0.6), c[1] + rad * 0.75, c[2] + r.jitter(rad * 0.6)], 0.14 + r.next() * 0.08, 3, 4, fc);
            }
          }
          // Spilling over the edge, hanging in front of the fascia.
          if (r.next() < 0.45) {
            const rad = 0.45 + r.next() * 0.5;
            leafBld.pushSphere(Q(t + r.jitter(0.4), y - 0.25 - r.next() * 0.6, depth + 0.15 + r.next() * 0.35), rad, 5, 3, tint3(leaf, 0.7 + r.next() * 0.2));
          }
        }
        for (let k = 0, nt = (r.next() < 0.7 ? 1 : 0) + (w > 10 && r.next() < 0.5 ? 1 : 0); k < nt; k++) {
          const t = r.jitter(w * 0.75), th = 2.0 + r.next() * 1.2;
          bld.pushCylinder(Q(t, y, depth * 0.5), Q(t, y + th, depth * 0.5), 0.09, 4, [0.12, 0.08, 0.05]);
          // A crown of several masses, not one ball on a stick (review 5).
          for (let m = 0, nm = 4 + r.int(0, 2); m < nm; m++) {
            const mr = m === 0 ? 1.1 + r.next() * 0.3 : 0.6 + r.next() * 0.45;
            leafBld.pushSphere(Q(t + (m ? r.jitter(1.1) : 0), y + th + (m ? r.jitter(0.6) : 0.4), depth * 0.5 + (m ? r.jitter(0.8) : 0)), mr, 5, 3, tint3(leaf, 0.8 + r.next() * 0.35));
          }
        }
        // Hanging leaf masses draped over the fascia, two abreast and tapering
        // slowly: the lime strip vines read as paint (review 5), single spheres
        // in a line as beads. Some fall most of the way to the band below.
        for (let k = 0, nc = Math.round(w * (0.25 + r.next() * 0.2) * thin); k < nc; k++) {
          hangLeaves(leafBld, Q, r.jitter(w * 0.92), y - 0.5, depth + 0.1 + r.next() * 0.3, 1.2 + r.next() * r.next() * gap * 0.8, leaf, r);
        }
        // Ivy climbing the wall up from the slab toward the band above: domes half
        // sunk into the wall, the cheapest cover per triangle. Darker, cooler green.
        for (let k = 0, ni = Math.round(w * (0.2 + r.next() * 0.14) * thin); k < ni; k++) {
          let tt = r.jitter(w * 0.95), yy = y + 0.3, rad = 0.8 + r.next() * 0.45;
          const top = y + gap * (0.4 + r.next() * 0.55);
          const c = tint3(IVY[r.int(0, IVY.length - 1)], 0.85 + r.next() * 0.3);
          // Bounded by count: the climb is a geometric series (rad shrinks), so
          // `yy < top` alone never ends when top is more than ~19 radii up (it
          // hung the boot). Each step spreads sideways: a patch, not a column.
          for (let step = 0; yy < top && step < 14; step++) {
            leafBld.pushSphere(Q(tt, yy, 0.12), rad, 4, 4, c);
            if (r.next() < 0.6) leafBld.pushSphere(Q(tt + (r.bool() ? 1 : -1) * rad * (1.0 + r.next() * 0.5), yy + r.jitter(0.3), 0.1), rad * (0.6 + r.next() * 0.3), 4, 4, c);
            yy += rad * 1.3; tt += r.jitter(0.6); rad *= 0.95;
          }
        }
      }
    }
  }
}

const NO_FACES = 0;
/**
 * u offset marking building-shell quads for `facade()` (gbuffer.wgsl FACADE_UV);
 * twice it selects reflective glass. Shell u never exceeds ~20 on its own.
 */
const FACADE_UV = 4096;
const FACADE_UV_REFLECTIVE = 8192;
/** Three times FACADE_UV: a burnt-out ruin's walls (soot, no lit windows). */
const FACADE_UV_RUIN = 12288;
/** Four times: an old-town wall, lit from below by the street's fires (sheet C). */
const FACADE_UV_OLDTOWN = 16384;
const ALL_FACES = FACE_ALL;

function pushBoxShell(
  bld: MeshBuilder, P: (x: number, y: number, z: number) => Vec3,
  hx: number, hz: number, y0: number, y1: number,
  color: Vec3, mat: number, rough: number, seed: number, lod: number, yaw: number,
  facade: 0 | typeof FACADE_UV | typeof FACADE_UV_REFLECTIVE | typeof FACADE_UV_RUIN | typeof FACADE_UV_OLDTOWN = 0,
): void {
  const opts: MeshOpts = { emissive: 0, rotationY: 0, faces: ALL_FACES };
  void mat; void rough; void seed; void lod; void yaw; void opts; void NO_FACES;
  // Walls offset u by FACADE_UV so the G-buffer synthesises windows on them;
  // parapets, crowns and roof boxes stay plain.
  const SHELL = { doubleSided: false, uvOffset: facade };
  // Emit six quads by hand so each can carry its own normal and a uv scale
  // that is consistent in world units (one uv unit per metre).
  const a = P(-hx, y0, hz), b = P(hx, y0, hz), c = P(hx, y1, hz), d = P(-hx, y1, hz);
  bld.pushQuad(a, b, c, d, color, 0.34, SHELL);
  const a2 = P(hx, y0, -hz), b2 = P(-hx, y0, -hz), c2 = P(-hx, y1, -hz), d2 = P(hx, y1, -hz);
  bld.pushQuad(a2, b2, c2, d2, color, 0.34, SHELL);
  const a3 = P(hx, y0, hz), b3 = P(hx, y0, -hz), c3 = P(hx, y1, -hz), d3 = P(hx, y1, hz);
  bld.pushQuad(a3, b3, c3, d3, color, 0.34, SHELL);
  const a4 = P(-hx, y0, -hz), b4 = P(-hx, y0, hz), c4 = P(-hx, y1, hz), d4 = P(-hx, y1, -hz);
  bld.pushQuad(a4, b4, c4, d4, color, 0.34, SHELL);
  // Top cap.
  //
  // The guard used to be `y1 > 0`, which meant "above the building's centre"
  // back when local y=0 was the centre. Local y=0 is now the BASE, so that test
  // silently changed meaning: with tiers=3 the first tier's top lands at exactly
  // y=0 and the strict `>` dropped its cap. The box always has a top; the only
  // reason to skip it is a degenerate zero-height box.
  if (y1 > y0) {
    bld.pushQuad(P(-hx, y1, hz), P(-hx, y1, -hz), P(hx, y1, -hz), P(hx, y1, hz), color, 0.2, { doubleSided: false });
  }
}

function pushRibZ(
  bld: MeshBuilder, P: (x: number, y: number, z: number) => Vec3,
  along: number, z: number, y0: number, y1: number, w: number,
  color: Vec3, seed: number,
): void {
  void seed;
  const hw = w * 0.5, d = 0.14;
  // Front face, back face, and the two flanks plus the cap.
  bld.pushQuad(P(along - hw, y0, z), P(along + hw, y0, z), P(along + hw, y1, z), P(along - hw, y1, z), color, 0.5);
  bld.pushQuad(P(along + hw, y0, z - d), P(along - hw, y0, z - d), P(along - hw, y1, z - d), P(along + hw, y1, z - d), color, 0.5);
  bld.pushQuad(P(along + hw, y0, z), P(along + hw, y0, z - d), P(along + hw, y1, z - d), P(along + hw, y1, z), color, 0.5);
  bld.pushQuad(P(along - hw, y0, z - d), P(along - hw, y0, z), P(along - hw, y1, z), P(along - hw, y1, z - d), color, 0.5);
  bld.pushQuad(P(along - hw, y1, z), P(along + hw, y1, z), P(along + hw, y1, z - d), P(along - hw, y1, z - d), color, 0.5);
}

function pushRibX(
  bld: MeshBuilder, P: (x: number, y: number, z: number) => Vec3,
  x: number, along: number, y0: number, y1: number, w: number,
  color: Vec3, seed: number,
): void {
  void seed;
  const hw = w * 0.5, d = 0.14;
  bld.pushQuad(P(x, y0, along + hw), P(x, y0, along - hw), P(x, y1, along - hw), P(x, y1, along + hw), color, 0.5);
  bld.pushQuad(P(x - d, y0, along - hw), P(x - d, y0, along + hw), P(x - d, y1, along + hw), P(x - d, y1, along - hw), color, 0.5);
  bld.pushQuad(P(x - d, y0, along - hw), P(x, y0, along - hw), P(x, y1, along - hw), P(x - d, y1, along - hw), color, 0.5);
  bld.pushQuad(P(x, y0, along + hw), P(x - d, y0, along + hw), P(x - d, y1, along + hw), P(x, y1, along + hw), color, 0.5);
  bld.pushQuad(P(x - d, y1, along - hw), P(x, y1, along - hw), P(x, y1, along + hw), P(x - d, y1, along + hw), color, 0.5);
}

function pushCrown(
  bld: MeshBuilder, P: (x: number, y: number, z: number) => Vec3,
  hx: number, hz: number, y: number, dp: DistrictProfile,
  rng: Rng, lod: number,
): void {
  const pal = dp.palette;
  const green = pal.foliage;
  switch (dp.roofStyle) {
    case 'flat-garden':
    case 'terraces': {
      // Solarpunk rooftop: a raised planter lip and a cluster of canopy blobs.
      if (lod < 2) {
        bld.pushQuad(
          P(-hx - 0.3, y + 0.9, hz + 0.3), P(hx + 0.3, y + 0.9, hz + 0.3),
          P(hx + 0.3, y + 0.9, -hz - 0.3), P(-hx - 0.3, y + 0.9, -hz - 0.3), pal.trim, 0.4,
        );
      }
      const n = lod < 1 ? 9 : 4;
      for (let i = 0; i < n; i++) {
        const cx = rng.range(-hx, hx) * 0.86;
        const cz = rng.range(-hz, hz) * 0.86;
        const r = rng.range(0.7, 2.0) * (1 + hx * 0.04);
        const hgt = rng.range(1.4, 3.4);
        const c = tint3(green, rng.range(0.7, 1.4));
        bld.pushCylinder(P(cx, y, cz), P(cx, y + hgt * 0.55, cz), 0.13, 5, pal.trim, { capEnds: false });
        bld.pushSphere(P(cx, y + hgt * 0.72, cz), r, 6, 4, c);
        bld.pushSphere(P(cx + r * 0.3, y + hgt * 0.95, cz - r * 0.2), r * 0.62, 5, 3, c);
      }
      return;
    }
    case 'antenna-forest': {
      // A dense thicket of masts. From the ground this is most of the
      // silhouette; from the air it reads as a texture.
      const n = lod < 1 ? 9 : 3;
      for (let i = 0; i < n; i++) {
        const cx = rng.range(-hx, hx) * 0.85;
        const cz = rng.range(-hz, hz) * 0.85;
        const h = rng.range(5, 24);
        bld.pushCylinder(P(cx, y, cz), P(cx, y + h, cz), 0.09, 4, pal.metal, { capEnds: false });
        for (let k = 1; k <= 3; k++) {
          const t = (k / 4) * h;
          const r = 1.1 * (1 - k / 5);
          bld.pushCylinder(P(cx - r, y + t, cz), P(cx + r, y + t, cz), 0.05, 4, pal.metal, { capEnds: false });
        }
        bld.pushSphere(P(cx, y + h, cz), 0.22, 5, 4, [1.0, 0.08, 0.05], { emissive: 4.0 });
      }
      return;
    }
    case 'mast': {
      const h = rng.range(10, 34);
      bld.pushCylinder(P(0, y, 0), P(0, y + h, 0), 0.14, 5, pal.metal, { capEnds: false });
      bld.pushSphere(P(0, y + h, 0), 0.24, 5, 4, [1.0, 0.1, 0.06], { emissive: 3.5 });
      return;
    }
    case 'dome': {
      const r = Math.min(hx, hz) * 0.9;
      bld.pushCylinder(P(0, y, 0), P(0, y + 2.0, 0), r, 12, pal.trim, { capEnds: false });
      bld.pushSphere(P(0, y + 2.0, 0), r, 12, 6, pal.metal);
      return;
    }
    case 'spire': {
      const h = Math.max(12, hx * rng.range(6, 16));
      bld.pushCylinder(P(0, y, 0), P(0, y + h, 0), Math.min(hx, hz) * 0.55, 8, pal.metal,
        { radiusTop: 0.02, capEnds: false });
      bld.pushSphere(P(0, y + h, 0), 0.4, 8, 5, pal.trim, { emissive: 1.4 });
      return;
    }
    case 'sawtooth': {
      // North-light factory roof: the ridged profile that makes sheds read.
      const n = Math.max(2, Math.round((hx * 2) / 4));
      for (let i = 0; i < n; i++) {
        const x0 = -hx + ((hx * 2) / n) * i;
        const w = (hx * 2) / n;
        bld.pushQuad(
          P(x0, y, hz), P(x0 + w, y, hz), P(x0 + w, y + 1.8, hz - 1.2), P(x0, y + 1.8, hz - 1.2),
          pal.trim, 0.5,
        );
        bld.pushQuad(
          P(x0 + w, y + 1.8, hz - 1.2), P(x0, y + 1.8, hz - 1.2), P(x0, y, hz), P(x0 + w, y, hz),
          pal.secondary, 0.5,
        );
      }
      return;
    }
    case 'shed': {
      // A shallow gable.
      const ridge = 2.6;
      bld.pushQuad(P(-hx, y, hz), P(hx, y, hz), P(0, y + ridge, hz), P(0, y + ridge, hz), pal.trim, 0.4);
      bld.pushQuad(P(-hx, y, -hz), P(0, y + ridge, -hz), P(hx, y + ridge, -hz), P(hx, y, -hz), pal.trim, 0.4);
      bld.pushQuad(P(-hx, y, hz), P(-hx, y, -hz), P(0, y + ridge, -hz), P(0, y + ridge, hz), pal.secondary, 0.4);
      bld.pushQuad(P(0, y + ridge, hz), P(0, y + ridge, -hz), P(hx, y, -hz), P(hx, y, hz), pal.secondary, 0.4);
      return;
    }
    case 'stepped': {
      // Terraced ziggurat — the terracotta-tiers look.
      let w = hx, d = hz, yy = y;
      for (let i = 0; i < 3; i++) {
        pushBoxShell(bld, P, w, d, yy, yy + 2.6, pal.trim, MAT.DIFFUSE, STONE, 0, 0, 0);
        w *= 0.72; d *= 0.72; yy += 2.6;
      }
      return;
    }
    case 'greenhouse': {
      // A glazed barrel vault. The interior glows at night.
      const r = Math.min(hx, hz) * 0.85;
      const segs = 7;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI;
        const a1 = ((i + 1) / segs) * Math.PI;
        bld.pushQuad(
          P(-r * Math.cos(a0), y + r * Math.sin(a0), -hz * 0.7),
          P(r * Math.cos(a0), y + r * Math.sin(a0), -hz * 0.7),
          P(r * Math.cos(a1), y + r * Math.sin(a1), -hz * 0.7),
          P(-r * Math.cos(a1), y + r * Math.sin(a1), -hz * 0.7),
          pal.glass, 0.4,
        );
        bld.pushQuad(
          P(-r * Math.cos(a1), y + r * Math.sin(a1), hz * 0.7),
          P(r * Math.cos(a1), y + r * Math.sin(a1), hz * 0.7),
          P(r * Math.cos(a0), y + r * Math.sin(a0), hz * 0.7),
          P(-r * Math.cos(a0), y + r * Math.sin(a0), hz * 0.7),
          pal.glass, 0.4,
        );
      }
      return;
    }
    default: {
      // 'flat': a vent field and a parapet, which is most rooftops.
      if (lod < 2) {
        const n = 2 + Math.floor(rng.next() * 3);
        for (let i = 0; i < n; i++) {
          const cx = rng.range(-hx * 0.6, hx * 0.6);
          const cz = rng.range(-hz * 0.6, hz * 0.6);
          pushBoxAt(bld, P, cx, y + 0.6, cz, rng.range(0.4, 1.3), 0.6, rng.range(0.4, 1.3), pal.metal);
        }
        pushBoxAt(bld, P, 0, y + 0.25, 0, hx * 0.8, 0.25, hz * 0.8, pal.trim);
      }
    }
  }
}

function pushBoxAt(
  bld: MeshBuilder, P: (x: number, y: number, z: number) => Vec3,
  x: number, y: number, z: number, hx: number, hy: number, hz: number, color: Vec3,
): void {
  // x/z were ignored (`void x; void z`), so every roof vent stacked at the centre.
  const Q = (lx: number, ly: number, lz: number): Vec3 => P(lx + x, ly, lz + z);
  pushBoxShell(bld, Q, hx, hz, y - hy, y + hy, color, MAT.METAL, METAL_ROUGH, 0, 0, 0);
}

const tint3 = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];

// ---------------------------------------------------------------- props

function pushProp(
  bld: MeshBuilder, p: PropInstance, dp: DistrictProfile, rng: Rng, lod: number,
): void {
  const pal = dp.palette;
  const accent = dp.accent;
  const px = p.position[0], py = p.position[1], pz = p.position[2];
  const s = p.scale;
  const c = p.color;
  /**
   * Prop-local point (+z = out of the wall), rotated by the prop's own rotation.
   * The rotation was never applied: every facade prop faced world +z, so awnings
   * on -z walls pointed into the building and sheets on x walls stood out as fins.
   */
  const P = (x: number, y: number, z: number): Vec3 => {
    const r = qRotate(p.rotation, [x, y, z]);
    return [px + r[0], py + r[1], pz + r[2]];
  };
  /** The same rotation for boxes, which take a yaw (facade props are yaw-only or near it). */
  const boxYaw = 2 * Math.atan2(p.rotation[1], p.rotation[3]);
  const tint = (base: Vec3, k: number): Vec3 => [
    base[0] * c[0] * k, base[1] * c[1] * k, base[2] * c[2] * k,
  ];
  const leaf = LEAF_COLORS[Math.floor(rng.next() * LEAF_COLORS.length)];

  switch (p.kind) {
    case PropKind.Planter: {
      bld.pushBox(P(0, 0, 0), [0.72 * s, 0.26 * s, 0.3 * s], tint(pal.base, 0.9), { faces: ALL_FACES, rotationY: boxYaw });
      if (lod < 2) {
        const n = 2 + Math.floor(rng.next() * 3);
        for (let i = 0; i < n; i++) {
          bld.pushSphere(
            P(rng.jitter(0.5) * s, 0.32 * s + rng.range(0.05, 0.3) * s, rng.jitter(0.2) * s),
            rng.range(0.16, 0.34) * s, 5, 3, tint(leaf, 1),
          );
        }
      }
      break;
    }
    case PropKind.VineCurtain: {
      // Vines hanging down the wall — the solarpunk signature. Strands of mixed
      // length, hung clear of the wall: one sheet on the wall plane read as a
      // flat green board, and where the lean tilted it into the wall, a dark
      // triangle (R14 review 4).
      const h = 3.1 * s, w = 1.7 * s;
      const drop = h * rng.range(0.4, 1.0);
      for (let t = -w; t < w; t += 0.3 + rng.next() * 0.35) {
        const hw = 0.08 + rng.next() * 0.16, z = 0.22 + rng.next() * 0.12, low = -drop * rng.range(0.25, 1.0);
        bld.pushQuad(P(t - hw, h, z), P(t + hw, h, z), P(t + hw, low, z), P(t - hw, low, z), tint(leaf, 0.7 + rng.next() * 0.4), 0.6, { doubleSided: true });
      }
      if (lod < 1) {
        for (let i = 0; i < 3; i++) {
          bld.pushSphere(
            P(rng.jitter(w * 0.8), rng.range(-drop * 0.7, h * 0.6), 0.3 + rng.jitter(0.1)),
            rng.range(0.2, 0.5) * s, 5, 3, tint(leaf, 1.15),
          );
        }
      }
      break;
    }
    case PropKind.Awning: {
      const w = 1.45 * s, d = 0.95 * s;
      bld.pushQuad(
        P(-w, 0, 0), P(w, 0, 0), P(w, -0.45 * s, d), P(-w, -0.45 * s, d),
        tint(accent, 1.0), 0.7, { doubleSided: true },
      );
      break;
    }
    case PropKind.ACUnit: {
      // A light enamel box with a dark grille and fan on its face: in district
      // metal it read as a flat black square (R14 review).
      bld.pushBox(P(0, 0, 0), [0.46 * s, 0.4 * s, 0.36 * s], [0.56, 0.55, 0.52], { faces: ALL_FACES, rotationY: boxYaw });
      for (let k = -2; k <= 2; k++) {
        const y = k * 0.13 * s;
        bld.pushQuad(P(-0.4 * s, y - 0.025 * s, 0.37 * s), P(0.05 * s, y - 0.025 * s, 0.37 * s), P(0.05 * s, y + 0.025 * s, 0.37 * s), P(-0.4 * s, y + 0.025 * s, 0.37 * s), [0.08, 0.08, 0.085], 1);
      }
      bld.pushCylinder(P(0.24 * s, 0, 0.36 * s), P(0.24 * s, 0, 0.38 * s), 0.15 * s, 8, [0.12, 0.12, 0.13], { capEnds: true });
      break;
    }
    case PropKind.LaundryLine: {
      // A sagging cord with a few bright pieces of cloth. Tiny, but it is the
      // detail that makes a facade look lived-in.
      const w = 2.4 * s;
      bld.pushTubeAlongPath(
        [P(-w, 0, 0), P(0, -0.28 * s, 0), P(w, 0, 0)], 0.02 * s, 4, [0.1, 0.1, 0.11],
      );
      if (lod < 1) {
        const n = 2 + Math.floor(rng.next() * 3);
        for (let i = 0; i < n; i++) {
          const t = (i + 1) / (n + 1);
          const x = (t - 0.5) * 2 * w * 0.82;
          const y = -0.28 * s * (1 - (t - 0.5) * (t - 0.5) * 4);
          const cw = rng.range(0.18, 0.34) * s;
          bld.pushQuad(
            P(x - cw, y, 0), P(x + cw, y, 0),
            P(x + cw, y - rng.range(0.4, 0.8) * s, 0), P(x - cw, y - rng.range(0.4, 0.8) * s, 0),
            [rng.range(0.5, 1.0), rng.range(0.5, 1.0), rng.range(0.5, 1.0)], 1.0, { doubleSided: true },
          );
        }
      }
      break;
    }
    case PropKind.Railing: {
      const w = 3.0 * s, h = 0.5 * s;
      bld.pushTubeAlongPath(
        [P(-w, h, 0), P(w, h, 0)], 0.035 * s, 4, tint(pal.metal, 0.8),
      );
      if (lod < 1) {
        const n = Math.max(3, Math.round((w * 2) / (0.5 * s)));
        for (let i = 0; i <= n; i++) {
          const x = (i / n - 0.5) * 2 * w;
          bld.pushTubeAlongPath([P(x, 0, 0), P(x, h, 0)], 0.03 * s, 3, tint(pal.metal, 0.8));
        }
      }
      break;
    }
    case PropKind.Antenna: {
      bld.pushTubeAlongPath(
        [P(0, -4 * s, 0), P(0, 4 * s, 0)], 0.06 * s, 4, tint(pal.metal, 0.7),
      );
      bld.pushSphere(P(0, 4 * s, 0), 0.14 * s, 5, 4, [1.0, 0.1, 0.08], { emissive: 3.0 });
      break;
    }
    case PropKind.Dish: {
      bld.pushSphere(P(0, 0, 0), 0.7 * s, 8, 4, tint(pal.metal, 1.2));
      bld.pushTubeAlongPath([P(0, -0.7 * s, 0), P(0, 0, 0)], 0.08 * s, 4, tint(pal.metal, 0.6));
      break;
    }
    case PropKind.Stair: {
      bld.pushBox(P(0, 0, 0), [1.45 * s, 0.1 * s, 0.6 * s], tint(pal.metal, 0.8), { faces: ALL_FACES, rotationY: boxYaw });
      bld.pushBox(P(0, -1.0 * s, 0), [1.45 * s, 0.1 * s, 0.6 * s], tint(pal.metal, 0.8), { faces: ALL_FACES, rotationY: boxYaw });
      break;
    }
    case PropKind.Pipe: {
      bld.pushTubeAlongPath(
        // Scale is length only; a scaled radius made 9 m wide slabs on tall towers.
        [P(0, -6 * s, 0), P(0, 6 * s, 0)], 0.18, 5, tint(pal.metal, 0.9),
      );
      break;
    }
    case PropKind.Sign: {
      // A blade sign: it projects from the wall on a bracket, so it reads in a
      // street seen end-on, where a panel flat on the facade is a sliver.
      bld.pushBox(P(0, 0, 0.62 * s), [0.05 * s, 0.6 * s, 0.48 * s], tint(accent, 1.0), {
        faces: ALL_FACES, emissive: 2.6, rotationY: boxYaw,
      });
      bld.pushTubeAlongPath([P(0, 0.66 * s, 0), P(0, 0.66 * s, 1.15 * s)], 0.025 * s, 3, tint(pal.metal, 0.6));
      break;
    }
    case PropKind.Balcony: {
      // Slab and a three-sided rail: the street-facade element sheets A, B and D
      // carry and the R14 review found missing.
      const w = 1.5 * s, d = 1.3 * s, h = 1.0 * s;
      bld.pushBox(P(0, 0, d * 0.5), [w, 0.07 * s, d * 0.5], tint(pal.trim, 0.9), { faces: ALL_FACES, rotationY: boxYaw });
      const rail = tint(pal.metal, 0.75);
      bld.pushTubeAlongPath([P(-w, h, 0.02), P(-w, h, d), P(w, h, d), P(w, h, 0.02)], 0.03 * s, 4, rail);
      if (lod < 1) {
        for (const x of [-w, -w / 3, w / 3, w]) bld.pushTubeAlongPath([P(x, 0, d), P(x, h, d)], 0.022 * s, 3, rail);
      }
      break;
    }
    case PropKind.Lantern: {
      bld.pushSphere(P(0, 0, 0), 0.26 * s, 6, 5, [1.0, 0.62, 0.28], { emissive: 5.5 });
      break;
    }
    case PropKind.PottedTree: {
      bld.pushCylinder(P(0, -0.5 * s, 0), P(0, 0.5 * s, 0), 0.42 * s, 7, tint(pal.trim, 0.9), { capEnds: true });
      bld.pushCylinder(P(0, 0.5 * s, 0), P(0, 1.5 * s, 0), 0.11 * s, 5, [0.09, 0.07, 0.05]);
      bld.pushSphere(P(0, 2.0 * s, 0), 1.1 * s, 7, 4, tint(leaf, 1));
      break;
    }
    case PropKind.WaterTank: {
      bld.pushCylinder(P(0, -0.9 * s, 0), P(0, 0.9 * s, 0), 1.5 * s, 9, tint(pal.metal, 0.8), { capEnds: true });
      bld.pushCylinder(P(0, 0.9 * s, 0), P(0, 1.6 * s, 0), 1.5 * s, 9, tint(pal.metal, 0.6),
        { radiusTop: 0.3, capEnds: true },
      );
      break;
    }
    case PropKind.Crane: {
      bld.pushTubeAlongPath([P(0, -6 * s, 0), P(0, 6 * s, 0)], 0.3 * s, 5, tint(pal.metal, 0.9));
      bld.pushTubeAlongPath(
        [P(-4 * s, 5 * s, 0), P(4 * s, 5 * s, 0)], 0.18 * s, 4, tint(pal.metal, 0.7),
      );
      break;
    }
    case PropKind.Zipline: {
      // A zipline is a span with a rider cable and a haul rope, not a box. It
      // fell through to the default below and rendered as a 0.3-scale metal cube
      // hanging in the air, which is what "silently wrong" looks like: a
      // plausible small dark box, and nothing anywhere reported it.
      const w = 12.0 * s;
      bld.pushTubeAlongPath(
        [P(-w, 0, 0), P(0, -1.1 * s, 0), P(w, 0, 0)], 0.045 * s, 4, [0.42, 0.38, 0.16], { capEnds: false },
      );
      bld.pushTubeAlongPath(
        [P(-w, -0.9 * s, 0.18), P(0, -2.0 * s, 0.18), P(w, -0.9 * s, 0.18)], 0.03 * s, 3, [0.30, 0.27, 0.12], { capEnds: false },
      );
      for (const sx of [-1, 1]) {
        bld.pushCylinder(P(sx * w, -0.5 * s, 0), P(sx * w, 1.1 * s, 0), 0.07 * s, 4, tint(pal.metal, 0.8), { capEnds: true });
      }
      break;
    }
    case PropKind.Cable: {
      // A short overhead cable with a couple of droppers.
      const w = 6.0 * s;
      bld.pushTubeAlongPath(
        [P(-w, 0, 0), P(0, -0.42 * s, 0), P(w, 0, 0)], 0.055 * s, 4, [0.10, 0.10, 0.11], { capEnds: false },
      );
      const n = Math.max(2, Math.round(w / 1.5));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = (t - 0.5) * 2 * w;
        const y = -0.42 * s * (1 - (t - 0.5) * (t - 0.5) * 4) * 4 * t * (1 - t) * 2.5;
        bld.pushTubeAlongPath([P(x, y, 0), P(x, y - 0.5 * s, 0)], 0.022 * s, 3, [0.10, 0.10, 0.11]);
      }
      break;
    }
    default: {
      bld.pushBox(P(0, 0, 0), [0.3 * s, 0.3 * s, 0.3 * s], tint(pal.metal, 0.9), { faces: ALL_FACES, rotationY: boxYaw });
    }
  }
}

// ---------------------------------------------------------------- cables

function pushCable(bld: MeshBuilder, c: Cable, col: Vec3, sides: number): void {
  const a = c.a, b = c.b;
  const segs = 5;
  const pts: Vec3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    // Parabolic catenary approximation.
    const sag = c.sag * 4 * t * (1 - t);
    pts.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - sag,
      a[2] + (b[2] - a[2]) * t,
    ]);
  }
  bld.pushTubeAlongPath(pts, Math.max(c.radius, 0.035), sides, col, { capEnds: false });
}

// ---------------------------------------------------------------- chunk bake

export interface BakedChunk {
  obstacles: CrowdObstacle[];
  marketStalls: MarketStall[];
  /** Raised walking support the crowd stands on (see walkingsurfaces.ts). */
  walking: WalkingSurfaceTriangles;
  /** World-space geometry for everything opaque and static. */
  opaque: Mesh;
  /** Thin geometry that wants double-sided, alpha-tested treatment. */
  foliage: Mesh;
  boundsMin: Vec3;
  boundsMax: Vec3;
  triangleCount: number;
  /** Cheap light sources harvested while baking. */
  lights: { pos: Vec3; radius: number; color: Vec3; intensity: number }[];
  /** A stable per-chunk tint seed so the fragment stage can vary its detail. */
  seed: number;
  /**
   * How many market lanterns this chunk's bake produced, and how many the chunk
   * light budget refused. Kept beside `lights` rather than inferred from it,
   * because the failure this exists to prevent is a count that agrees with
   * itself: 365 lanterns produced, 0 in `lights`, and every counter green.
   */
  marketLights?: { produced: number; delivered: number; dropped: number; traces: number };
}

/**
 * Bake one chunk. `lod` 0 is full detail, 1 drops mid-frequency props, 2 keeps
 * only the silhouette. All three come out of the same code path so a distant
 * building is recognisably the same building as a near one.
 */
/**
 * Deterministic RNG for baking. Kept separate from `makeRng` so the bake order
 * is independent of anything the generator does — the same chunk always bakes
 * to the same bytes regardless of when it was built.
 */
function bakeRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    jitter: (m) => (next() * 2 - 1) * m,
    bool: (p = 0.5) => next() < p,
    pick: <T,>(arr: readonly T[]) => arr[Math.floor(next() * arr.length) % arr.length],
    gauss: (m = 0, sd = 1) => m + (next() * 2 - 1) * sd,
    shuffle: <T,>(arr: T[]) => arr,
    shuffleInto: <T,>(arr: T) => arr,
    fork: () => bakeRng(Math.floor(next() * 0xffffffff)),
  };
}

export function bakeChunk(chunk: CityChunk, lod: number, seed: number): BakedChunk {
  const solid = new MeshBuilder();
  const leaf = new MeshBuilder();
  const rng = bakeRng(seed ^ Math.imul(chunk.cx + 7919, 0x9e3779b1) ^ Math.imul(chunk.cz + 104729, 0x85ebca6b));

  const lights: BakedChunk['lights'] = [];
  const obstacles: CrowdObstacle[] = [];
  let marketStalls: MarketStall[] = [];

  // --- buildings
  for (const b of chunk.buildings) {
    const dp = profileFor(b.districtId);
    pushBuilding(solid, b, dp, rng, lod);
    pushScaffold(solid, b, dp, lod, lights);
    pushTerraces(solid, leaf, b, dp, lod);
    pushOldTownFire(solid, b, lights, lod);
    // Ground footprint comes from the generator's actual occupied bounds.
    obstacles.push({ x: (b.aabbMin[0] + b.aabbMax[0]) * 0.5, z: (b.aabbMin[2] + b.aabbMax[2]) * 0.5,
      tx: 1, tz: 0, halfAlong: (b.aabbMax[0] - b.aabbMin[0]) * 0.5, halfAcross: (b.aabbMax[2] - b.aabbMin[2]) * 0.5,
      minY: GROUND_Y, maxY: b.aabbMax[1], kind: 'building' });
    // Rooftop marker lights — a scatter of them turns the night skyline into
    // a constellation rather than a black cutout.
    //
    // The roof is position[1] + halfExtents[1]. This used to read
    // `+ halfExtents[1] * 2 + 2`, which is the CENTRE-relative error that
    // 6e2b5af fixed everywhere else: it put the light a full half-height above
    // the roof, up to +302m on the tallest buildings, so the "rooftop"
    // constellation floated in mid-air over the tallest towers. Nobody caught it
    // because nothing measured light positions.
    if (lod < 1 && rng.next() < 0.4) {
      lights.push({
        pos: [b.position[0], b.position[1] + b.halfExtents[1] + 2, b.position[2]],
        radius: 26, color: [1.0, 0.35, 0.22], intensity: 1.6,
      });
    }
  }

  // --- props
  for (const p of chunk.props) {
    const dp = profileFor(0);
    // Cheap LOD gate: drop the noisy kinds first.
    if (lod >= 1) {
      const k = p.kind;
      // Street-band detail (balconies, blade signs) is near-field only: at LOD 1 it
      // added ~6k triangles to each of ~130 chunks and the shadow passes, and GPU
      // completion p95 rose 18 -> 24 ms in flight.
      if (k === PropKind.LaundryLine || k === PropKind.Awning || k === PropKind.Railing ||
          k === PropKind.Balcony || k === PropKind.Sign) continue;
      if ((k === PropKind.ACUnit || k === PropKind.Planter) && p.position[1] < GROUND_Y + 16) continue;
      if (rng.next() < 0.55) continue;
    }
    if (lod >= 2 && rng.next() < 0.7) continue;
    const isFoliage = p.kind === PropKind.VineCurtain || p.kind === PropKind.PottedTree ||
      p.kind === PropKind.Planter;
    const propBuilder = isFoliage ? leaf : solid;
    const propStart = propBuilder.vertexCount;
    pushProp(propBuilder, p, dp, rng, lod);
    const bounds = propBuilder.boundsSince(propStart);
    if (bounds && bounds[1][1] > GROUND_Y + 0.08 && bounds[0][1] < GROUND_Y + 1.7) {
      const [lo, hi] = bounds;
      obstacles.push({ x: (lo[0] + hi[0]) * 0.5, z: (lo[2] + hi[2]) * 0.5, tx: 1, tz: 0,
        halfAlong: (hi[0] - lo[0]) * 0.5, halfAcross: (hi[2] - lo[2]) * 0.5,
        minY: lo[1], maxY: hi[1], kind: `prop-${PropKind[p.kind]}` });
    }

    if (p.kind === PropKind.Lantern && lod < 1) {
      lights.push({ pos: p.position, radius: 14, color: [1.0, 0.6, 0.3], intensity: 3.2 * p.scale });
    } else if (p.kind === PropKind.Sign && lod < 1) {
      lights.push({ pos: p.position, radius: 11, color: p.color, intensity: 2.2 });
    }
  }

  // --- skybridges
  for (const br of chunk.bridges) {
    const dp = profileFor(br.districtId);
    const pal = dp.palette;
    const d: Vec3 = [br.b[0] - br.a[0], br.b[1] - br.a[1], br.b[2] - br.a[2]];
    const len = Math.hypot(d[0], d[1], d[2]);
    if (len < 1) continue;
    const u: Vec3 = [d[0] / len, d[1] / len, d[2] / len];
    const side: Vec3 = [-u[2], 0, u[0]];
    const sl = Math.hypot(side[0], side[2]) || 1;
    side[0] /= sl; side[2] /= sl;
    const hw = br.width * 0.5;
    const th = 0.55;
    // Deck faces up, soffit down. These were horizontal (along the span),
    // which shaded both as walls and left their visible side to the slope.
    const up: Vec3 = [0, 1, 0], down: Vec3 = [0, -1, 0];
    // Deck
    const corners: Vec3[] = [
      [br.a[0] - side[0] * hw, br.a[1] - th, br.a[2] - side[2] * hw],
      [br.a[0] + side[0] * hw, br.a[1] - th, br.a[2] + side[2] * hw],
      [br.b[0] + side[0] * hw, br.b[1] - th, br.b[2] + side[2] * hw],
      [br.b[0] - side[0] * hw, br.b[1] - th, br.b[2] - side[2] * hw],
    ];
    solid.pushQuad(corners[0], corners[1], corners[2], corners[3], pal.trim, 0.4, { normals: [up, up, up, up] });
    // Soffit
    solid.pushQuad(corners[3], corners[2], corners[1], corners[0], pal.base, 0.4, { normals: [down, down, down, down] });
    // Railings, both sides, if close enough to matter.
    if (lod < 1 && len < 90) {
      for (const s of [1, -1]) {
        const p0: Vec3 = [br.a[0] + side[0] * hw * s, br.a[1] + 1.0, br.a[2] + side[2] * hw * s];
        const p1: Vec3 = [br.b[0] + side[0] * hw * s, br.b[1] + 1.0, br.b[2] + side[2] * hw * s];
        solid.pushTubeAlongPath([p0, p1], 0.05, 4, pal.metal, { capEnds: false });
        const n = Math.max(2, Math.round(len / 3));
        if (lod < 1) {
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            const b0: Vec3 = [p0[0] + (p1[0] - p0[0]) * t, p0[1], p0[2] + (p1[2] - p0[2]) * t];
            const b1: Vec3 = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + 1.0, p0[2] + (p1[2] - p0[2]) * t];
            solid.pushTubeAlongPath([b0, b1], 0.04, 3, pal.metal, { capEnds: false });
          }
        }
      }
      lights.push({
        pos: [(br.a[0] + br.b[0]) * 0.5, (br.a[1] + br.b[1]) * 0.5 + 0.5, (br.a[2] + br.b[2]) * 0.5],
        radius: 16, color: [1.0, 0.84, 0.62], intensity: 1.1,   // warm (D28); was cool white
      });
    }
  }

  pushOldTownBunting(solid, chunk.buildings, lod);

  // --- cables
  const cableSides = lod < 1 ? 4 : 3;
  for (const c of chunk.cables) {
    const pal = profileFor(0).palette;
    const col: Vec3 = c.kind === 'tram' ? [0.05, 0.05, 0.06]
      : c.kind === 'zipline' ? [0.55, 0.5, 0.2]
        : [pal.metal[0] * 0.5, pal.metal[1] * 0.5, pal.metal[2] * 0.5];
    pushCable(solid, c, col, cableSides);
  }

  // --- ground detail: kerbs, footways and paint along the REAL carriageways.
  // This goes into the chunk's solid builder so it streams, evicts and is
  // frustum-culled with the buildings standing on it, and it is the only place
  // in the renderer that knows where a street is — the street field lives on the
  // CPU and cannot be reconstructed in a shader without porting ~90 lines of
  // warped noise and risking a silent disagreement. See `src/render/groundbake.ts`.
  let marketLights: BakedChunk['marketLights'];
  if (lod < 2) {
    const gres = bakeGroundDetail(solid, chunk, cityPlan(seed), lod, rng, lights as GroundLight[]);
    obstacles.push(...gres.obstacles);
    marketStalls = gres.marketStalls;
    if (gres.clutter.marketLights > 0 || gres.clutter.marketLightsDropped > 0) {
      marketLights = {
        // `produced` counts every grammar query this chunk made, so a chunk with
        // four market carriageways legitimately produces four times the per-trace
        // grammar maximum. `traces` is here so that ratio is readable rather than
        // looking like the grammar over-produced.
        produced: gres.clutter.marketLights + gres.clutter.marketLightsDropped,
        delivered: gres.clutter.marketLights,
        dropped: gres.clutter.marketLightsDropped,
        traces: gres.clutter.marketTraces,
      };
    }
  }

  const opaque = solid.build();
  const foliage = leaf.build();
  return {
    obstacles, marketStalls,
    walking: walkingTriangles(opaque),
    opaque,
    foliage,
    boundsMin: opaque.boundsMin,
    boundsMax: opaque.boundsMax,
    triangleCount: (opaque.indexCount + foliage.indexCount) / 3,
    lights,
    seed: (seed ^ Math.imul(chunk.cx * 73856093 ^ chunk.cz * 19349663, 0x9e3779b1)) >>> 0,
    ...(marketLights ? { marketLights } : {}),
  };
}

/**
 * Ground plane + canal water, built once and shared.
 *
 * The deck used to be ONE quad in a single hard-coded grey, plus 1.2m kerb
 * boxes on a jittered 48m world-axis grid. Two things were wrong with that and
 * neither of them announced itself: the colour ignored `palette.ground`, which
 * has existed in `districts.ts` since the first commit and was read by nothing;
 * and the kerb grid had no relationship to the street network, so a "kerb" ran
 * straight through the middle of a block and none of them ran along an actual
 * carriageway. The kerbs are now baked per chunk from `sampleStreetPlan`
 * (`bakeGroundDetail`), and what is left here is the deck itself.
 */
export function bakeGround(size: number, seed: number): { mesh: Mesh; water: Mesh } {
  const g = new MeshBuilder();
  const w = new MeshBuilder();
  pushGroundDeck(g, size, seed);
  return { mesh: g.build(), water: w.build() };
}

/** Deck tessellation pitch in metres. Districts are 300m+ across, so this is well under. */
const DECK_CELL = 64;

/**
 * The street deck: a shared-vertex grid, one vertex per grid node, coloured by
 * the district that owns that node.
 *
 * A shared vertex grid rather than independent quads is deliberate: with shared
 * nodes the district boundary is a continuous ramp at cell resolution and
 * neighbouring cells cannot disagree along a shared edge, so there is no
 * seam and no z-fight. 64x64 cells over 4096m is 4096 quads / 8192 triangles
 * for a mesh that used to be 1034, which is nothing against a per-chunk budget
 * and is the single largest change in screen area in the whole renderer.
 */
export function pushGroundDeck(bld: MeshBuilder, size: number, seed: number): void {
  const plan = cityPlan(seed);
  const n = Math.max(1, Math.round(size / DECK_CELL));
  const half = size * 0.5;
  const step = size / n;
  // Node colours, computed once each and shared by the quads around them.
  const cols: Vec3[] = new Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -half + i * step;
      const z = -half + j * step;
      const d = districtAtField(plan.districts, x, z);
      const g = groundGrammarFor(d, 'street');
      // Low-frequency value drift so the 64m lattice does not read as a
      // checkerboard where two districts of similar value meet.
      const jitter = 0.94 + 0.12 * hash01(i * 73856093 ^ j * 19349663 ^ seed);
      const k = jitter;
      const paving = walkingAlbedo(g);
      cols[j * (n + 1) + i] = [paving[0] * k, paving[1] * k, paving[2] * k];
    }
  }
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = -half + i * step, x1 = x0 + step;
      const z0 = -half + j * step, z1 = z0 + step;
      const c00 = cols[j * (n + 1) + i];
      const c10 = cols[j * (n + 1) + i + 1];
      const c11 = cols[(j + 1) * (n + 1) + i + 1];
      const c01 = cols[(j + 1) * (n + 1) + i];
      // pushQuad takes one colour per quad, so average the four node colours.
      const c: Vec3 = [
        (c00[0] + c10[0] + c11[0] + c01[0]) * 0.25,
        (c00[1] + c10[1] + c11[1] + c01[1]) * 0.25,
        (c00[2] + c10[2] + c11[2] + c01[2]) * 0.25,
      ];
      bld.pushQuad(
        [x0, GROUND_Y, z1], [x1, GROUND_Y, z1], [x1, GROUND_Y, z0], [x0, GROUND_Y, z0],
        c, 0.12, { normals: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]],
          surfaceTag: groundSurfaceTag('paving', walkingFamily(groundGrammarFor(districtAtField(plan.districts, (x0 + x1) * 0.5, (z0 + z1) * 0.5), 'street'))) },
      );
    }
  }
}

/** Stable 0..1 from an integer pair. Mirrors the fragment stage's hash intent. */
const hash01 = (h: number): number => {
  let x = Math.imul(h ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  return (Math.imul(x, 0xc2b2ae35) >>> 0) / 4294967296;
};

// ---------------------------------------------------------------- entity meshes

/**
 * Reusable entity geometry, built once in a local frame and drawn instanced.
 * Kept deliberately low-poly: at the distances these are seen, silhouette and
 * colour carry everything.
 */
export const entityMeshes = {
  tramCar(): Mesh {
    const b = new MeshBuilder();
    const L = 9.0, W = 1.2, H = 1.8;
    // Body with chamfered roof, in the local frame: +Z is forward.
    b.pushBox([0, H + 0.35, 0], [W, H, L], [0.55, 0.16, 0.10], { faces: FACE_ALL });
    b.pushBox([0, H + H + 0.15, 0], [W * 0.86, 0.28, L * 0.96], [0.42, 0.14, 0.10], { faces: FACE_ALL });
    // Window band
    b.pushBox([0, H + 1.15, 0], [W * 1.01, 0.55, L * 0.93], [0.06, 0.07, 0.09], { emissive: 0.6, faces: FACE_ALL });
    // Skirt
    b.pushBox([0, 0.25, 0], [W * 0.95, 0.25, L * 0.98], [0.12, 0.12, 0.13], { faces: FACE_ALL });
    // Roof gear + pantograph
    b.pushBox([0, H * 2 + 0.4, L * 0.3], [0.5, 0.12, 0.8], [0.2, 0.2, 0.22], { faces: FACE_ALL });
    b.pushTubeAlongPath([[0, H * 2 + 0.5, L * 0.3], [0, H * 2 + 1.6, L * 0.1]], 0.05, 4, [0.3, 0.3, 0.32]);
    b.pushTubeAlongPath([[0, H * 2 + 0.5, L * 0.3], [0, H * 2 + 1.5, L * 0.45]], 0.05, 4, [0.3, 0.3, 0.32]);
    // Headlights
    b.pushBox([0, 0.75, L + 0.05], [0.4, 0.12, 0.06], [1.0, 0.92, 0.75], { emissive: 8.0, faces: FACE_ALL });
    return b.build();
  },

  cableCar(): Mesh {
    const b = new MeshBuilder();
    b.pushBox([0, 0, 0], [1.0, 1.1, 1.4], [0.62, 0.28, 0.12], { faces: FACE_ALL });
    b.pushBox([0, 0.15, 0], [1.02, 0.6, 1.42], [0.05, 0.06, 0.08], { emissive: 0.9, faces: FACE_ALL });
    b.pushBox([0, 1.15, 0], [1.1, 0.12, 1.5], [0.48, 0.22, 0.11], { faces: FACE_ALL });
    b.pushTubeAlongPath([[0, 1.25, 0], [0, 2.1, 0]], 0.06, 5, [0.25, 0.25, 0.28]);
    b.pushBox([0, 2.2, 0], [0.35, 0.12, 0.2], [0.25, 0.25, 0.28], { faces: FACE_ALL });
    return b.build();
  },

  blimp(): Mesh {
    const b = new MeshBuilder();
    // Envelope: a squashed sphere scaled along +Z, 60m long.
    b.pushSphere([0, 0, 0], 1, 14, 8, [0.80, 0.76, 0.66]);
    b.pushBox([0, 0, 0], [0.62, 0.62, 2.9], [0.80, 0.76, 0.66], { faces: FACE_ALL });
    b.pushBox([0, -0.72, 0.2], [0.30, 0.26, 0.95], [0.20, 0.24, 0.28], { faces: FACE_ALL });
    b.pushBox([0, -1.05, -0.1], [0.22, 0.18, 0.42], [0.15, 0.16, 0.19], { faces: FACE_ALL });
    // Fins
    b.pushQuad([0, 0.1, -2.6], [1.5, 1.2, -3.2], [1.5, -0.1, -3.2], [0, -0.6, -2.6], [0.55, 0.22, 0.16], 0.4, { doubleSided: true });
    b.pushQuad([0, 0.1, -2.6], [0, -0.6, -2.6], [-1.5, -0.1, -3.2], [-1.5, 1.2, -3.2], [0.55, 0.22, 0.16], 0.4, { doubleSided: true });
    return b.build();
  },

  balloon(): Mesh {
    const b = new MeshBuilder();
    b.pushSphere([0, 0, 0], 1, 12, 9, [0.86, 0.36, 0.20]);
    b.pushSphere([0, 0.45, 0], 0.66, 10, 6, [0.92, 0.52, 0.24]);
    b.pushSphere([0, -0.55, 0], 0.5, 10, 6, [0.70, 0.24, 0.16]);
    b.pushBox([0, -1.35, 0], [0.30, 0.30, 0.30], [0.42, 0.30, 0.20], { faces: FACE_ALL });
    b.pushTubeAlongPath([[0, -1.1, 0], [0, -1.35, 0]], 0.04, 4, [0.2, 0.15, 0.1]);
    b.pushTubeAlongPath([[0, -1.1, 0], [0, -1.35, 0]], 0.04, 4, [0.2, 0.15, 0.1]);
    return b.build();
  },

  ziplineRider(): Mesh {
    const b = new MeshBuilder();
    b.pushBox([0, 0, 0], [0.16, 0.24, 0.42], [0.85, 0.30, 0.18], { faces: FACE_ALL });
    b.pushBox([0, 0.30, 0.34], [0.11, 0.11, 0.11], [0.55, 0.40, 0.30], { faces: FACE_ALL });
    b.pushBox([0, 0.24, -0.5], [0.02, 0.16, 0.2], [0.15, 0.15, 0.18], { faces: FACE_ALL });
    return b.build();
  },

  debrisChunk(): Mesh {
    const b = new MeshBuilder();
    b.pushBox([0, 0, 0], [0.5, 0.5, 0.5], [0.45, 0.42, 0.38], { faces: FACE_ALL });
    return b.build();
  },
};
