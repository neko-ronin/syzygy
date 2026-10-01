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

import { type Vec3, type Mat4, type Rng } from '../core/math';
import {
  MeshBuilder, type Mesh, FACE_ALL, type MeshOpts,
} from '../world/geometry';
import {
  type BuildingInstance, type Cable, type CityChunk, type PropInstance, PropKind,
  cityPlan, GROUND_Y,
} from '../world/citygen';
import {
  districtAtField, districtPaletteLinear, districtStyle,
  type ResolvedPalette, type DistrictStyle,
} from '../world/districts';
import { groundGrammarFor } from '../world/groundgrammar';
import { bakeGroundDetail, type GroundLight } from './groundbake';

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
function profileFor(id: number): DistrictProfile {
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
function pushBuilding(
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
  const lean = b.lean;
  const yaw = b.rotationY;
  const pal = dp.palette;
  const base = pal.base;
  const seed = b.windowSeed;

  // Local → world for a point in the building's own frame.
  const P = (lx: number, ly: number, lz: number): Vec3 => {
    // Lean is a shear proportional to height above the BASE, so the tower
    // rises straight out of the ground and tilts as it climbs. Normalising
    // against the centre instead made every tower bow outwards at the bottom
    // and inwards at the top, which is not what leaning means.
    const t = (ly - yBase) / Math.max(height, 1);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const px = lx + lean[0] * t * b.halfExtents[1] * 2;
    const pz = lz + lean[2] * t * b.halfExtents[1] * 2;
    return [b.position[0] + px * c + pz * s, b.position[1] + ly, b.position[2] - px * s + pz * c];
  };

  const mat = dp.wallMat;
  const rough = mat === MAT.METAL ? METAL_ROUGH : mat === MAT.BRICK ? STONE + 0.1 : STONE;

  // --- stacked setbacks: the tower narrows in 1-3 steps toward the crown.
  //
  // Tier boundaries are fractions of the FULL height measured from the base and
  // must be monotonic and land exactly on yRoof. The old arithmetic mixed a
  // totalH-scaled intermediate step with a `top - position[1]` (= half height)
  // last tier, so a 3-tier tower overshot its own roof and then emitted a
  // negative-height crown.
  const tiers = 1 + (rng.bool(0.72) ? 1 : 0) + (rng.bool(0.35) ? 1 : 0);
  const TIER_SPLIT: Record<number, number[]> = { 1: [1], 2: [0.62, 1], 3: [0.5, 0.78, 1] };
  const split = TIER_SPLIT[tiers] ?? [1];
  let y0 = yBase;
  let tx = hx, tz = hz;
  const totalH = height;
  for (let t = 0; t < tiers; t++) {
    const isLast = t === tiers - 1;
    const y1 = isLast ? yRoof : yBase + height * split[t];
    const shrink = isLast ? 0.72 + rng.next() * 0.16 : 0.80 + rng.next() * 0.15;
    const nx = t === 0 ? tx : tx * shrink;
    const nz = t === 0 ? tz : tz * shrink;
    // Body of the tier, inset from the previous so the setback reads.
    const inset = t === 0 ? 0 : 0.18;
    pushBoxShell(bld, P, nx - inset, nz - inset, y0, y1, base, mat, rough, seed + t, lod, yaw);
    // Parapet lip on top of the tier.
    if (!isLast || lod < 1) {
      pushBoxShell(
        bld, P, nx + 0.16, nz + 0.16, y1 - 0.0, y1 + (isLast ? 1.1 : 0.9),
        pal.trim, mat, rough * 0.9, seed + t + 40, 1, yaw,
      );
    }
    y0 = y1;
    tx = nx; tz = nz;
  }

  // --- plinth: the first 8m is a different material, like a real base course.
  if (lod < 2) {
    const plinthH = Math.min(7.5, totalH * 0.25);
    pushBoxShell(bld, P, hx + 0.28, hz + 0.28, yBase, yBase + plinthH,
      pal.secondary, MAT.DIFFUSE, STONE + 0.15, seed + 7, 0, yaw);
  }

  // --- vertical pilasters. These are the single cheapest thing that makes a
  //     flat wall read as architecture: they catch the sun and give the canyon
  //     its vertical rhythm as the light sweeps across it.
  if (lod < 2) {
    const ribW = 0.22;
    const runH = height - 6;
    if (runH >= 6) {
      const count = Math.max(2, Math.round(hx / 4.2));
      for (let i = 0; i < count; i++) {
        const f = count === 1 ? 0.5 : i / (count - 1);
        const lx = (f - 0.5) * 2 * (hx - 0.4);
        for (const sz of [1, -1]) {
          pushRibZ(bld, P, lx, sz * (hz + 0.10), yBase + 3, runH, ribW,
            pal.trim, seed + i);
        }
      }
      const countZ = Math.max(2, Math.round(hz / 4.2));
      for (let i = 0; i < countZ; i++) {
        const f = countZ === 1 ? 0.5 : i / (countZ - 1);
        const lz = (f - 0.5) * 2 * (hz - 0.4);
        for (const sx of [1, -1]) {
          pushRibX(bld, P, sx * (hx + 0.10), lz, yBase + 3, runH, ribW,
            pal.trim, seed + i + 20);
        }
      }
    }
  }

  // --- crown: whatever tops this district off.
  pushCrown(bld, P, tx, tz, yRoof, dp, rng, lod);
}

const NO_FACES = 0;
const ALL_FACES = FACE_ALL;

function pushBoxShell(
  bld: MeshBuilder, P: (x: number, y: number, z: number) => Vec3,
  hx: number, hz: number, y0: number, y1: number,
  color: Vec3, mat: number, rough: number, seed: number, lod: number, yaw: number,
): void {
  const opts: MeshOpts = { emissive: 0, rotationY: 0, faces: ALL_FACES };
  void mat; void rough; void seed; void lod; void yaw; void opts; void NO_FACES;
  // Emit six quads by hand so each can carry its own normal and a uv scale
  // that is consistent in world units (one uv unit per metre).
  const a = P(-hx, y0, hz), b = P(hx, y0, hz), c = P(hx, y1, hz), d = P(-hx, y1, hz);
  bld.pushQuad(a, b, c, d, color, 0.34, { doubleSided: false });
  const a2 = P(hx, y0, -hz), b2 = P(-hx, y0, -hz), c2 = P(-hx, y1, -hz), d2 = P(hx, y1, -hz);
  bld.pushQuad(a2, b2, c2, d2, color, 0.34, { doubleSided: false });
  const a3 = P(hx, y0, hz), b3 = P(hx, y0, -hz), c3 = P(hx, y1, -hz), d3 = P(hx, y1, hz);
  bld.pushQuad(a3, b3, c3, d3, color, 0.34, { doubleSided: false });
  const a4 = P(-hx, y0, -hz), b4 = P(-hx, y0, hz), c4 = P(-hx, y1, hz), d4 = P(-hx, y1, -hz);
  bld.pushQuad(a4, b4, c4, d4, color, 0.34, { doubleSided: false });
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
  pushBoxShell(bld, P, hx, hz, y - hy, y + hy, color, MAT.METAL, METAL_ROUGH, 0, 0, 0);
  void x; void z;
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
  /** Prop-local point, then tint the district material by the prop's own hue. */
  const P = (x: number, y: number, z: number): Vec3 => [px + x, py + y, pz + z];
  const tint = (base: Vec3, k: number): Vec3 => [
    base[0] * c[0] * k, base[1] * c[1] * k, base[2] * c[2] * k,
  ];
  const leaf = LEAF_COLORS[Math.floor(rng.next() * LEAF_COLORS.length)];

  switch (p.kind) {
    case PropKind.Planter: {
      bld.pushBox(P(0, 0, 0), [0.72 * s, 0.26 * s, 0.3 * s], tint(pal.base, 0.9), { faces: ALL_FACES });
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
      // A hanging sheet of foliage — the solarpunk signature.
      const h = 3.1 * s, w = 1.7 * s;
      const drop = h * rng.range(0.4, 1.0);
      bld.pushQuad(
        P(-w, h, 0), P(w, h, 0), P(w, -drop, 0), P(-w, -drop, 0),
        tint(leaf, 0.85), 0.6, { doubleSided: true },
      );
      if (lod < 1) {
        for (let i = 0; i < 3; i++) {
          bld.pushSphere(
            P(rng.jitter(w * 0.8), rng.range(-drop * 0.7, h * 0.6), rng.jitter(0.1)),
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
      bld.pushBox(P(0, 0, 0), [0.46 * s, 0.4 * s, 0.36 * s], tint(pal.metal, 0.9), { faces: ALL_FACES });
      bld.pushCylinder(P(0, 0, 0), P(0, 0.4 * s, 0), 0.26 * s, 7, tint(pal.metal, 0.55), { capEnds: true });
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
      bld.pushBox(P(0, 0, 0), [1.45 * s, 0.1 * s, 0.6 * s], tint(pal.metal, 0.8), { faces: ALL_FACES });
      bld.pushBox(P(0, -1.0 * s, 0), [1.45 * s, 0.1 * s, 0.6 * s], tint(pal.metal, 0.8), { faces: ALL_FACES });
      break;
    }
    case PropKind.Pipe: {
      bld.pushTubeAlongPath(
        [P(0, -6 * s, 0), P(0, 6 * s, 0)], 0.18 * s, 5, tint(pal.metal, 0.9),
      );
      break;
    }
    case PropKind.Sign: {
      bld.pushBox(P(0, 0, 0), [1.0 * s, 0.72 * s, 0.08 * s], tint(accent, 1.0), {
        faces: ALL_FACES, emissive: 2.6,
      });
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
      bld.pushBox(P(0, 0, 0), [0.3 * s, 0.3 * s, 0.3 * s], tint(pal.metal, 0.9), { faces: ALL_FACES });
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

  // --- buildings
  for (const b of chunk.buildings) {
    const dp = profileFor(b.districtId);
    pushBuilding(solid, b, dp, rng, lod);
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
      if (k === PropKind.LaundryLine || k === PropKind.Awning || k === PropKind.Railing) continue;
      if (rng.next() < 0.55) continue;
    }
    if (lod >= 2 && rng.next() < 0.7) continue;
    const isFoliage = p.kind === PropKind.VineCurtain || p.kind === PropKind.PottedTree ||
      p.kind === PropKind.Planter;
    pushProp(isFoliage ? leaf : solid, p, dp, rng, lod);

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
    const nrm: Vec3 = [-side[2], 0, side[0]];
    // Deck
    const corners: Vec3[] = [
      [br.a[0] - side[0] * hw, br.a[1] - th, br.a[2] - side[2] * hw],
      [br.a[0] + side[0] * hw, br.a[1] - th, br.a[2] + side[2] * hw],
      [br.b[0] + side[0] * hw, br.b[1] - th, br.b[2] + side[2] * hw],
      [br.b[0] - side[0] * hw, br.b[1] - th, br.b[2] - side[2] * hw],
    ];
    solid.pushQuad(corners[0], corners[1], corners[2], corners[3], pal.trim, 0.4, { normals: [nrm, nrm, nrm, nrm] });
    // Soffit
    solid.pushQuad(corners[3], corners[2], corners[1], corners[0], pal.base, 0.4,
      { normals: [[-nrm[0], 0, -nrm[2]], [-nrm[0], 0, -nrm[2]], [-nrm[0], 0, -nrm[2]], [-nrm[0], 0, -nrm[2]]] });
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
        radius: 16, color: [0.9, 0.92, 1.0], intensity: 1.1,
      });
    }
  }

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
  if (lod < 2) {
    bakeGroundDetail(solid, chunk, cityPlan(seed), lod, rng, lights as GroundLight[]);
  }

  const opaque = solid.build();
  const foliage = leaf.build();
  return {
    opaque,
    foliage,
    boundsMin: opaque.boundsMin,
    boundsMax: opaque.boundsMax,
    triangleCount: (opaque.indexCount + foliage.indexCount) / 3,
    lights,
    seed: (seed ^ Math.imul(chunk.cx * 73856093 ^ chunk.cz * 19349663, 0x9e3779b1)) >>> 0,
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
      cols[j * (n + 1) + i] = [g.albedo[0] * k, g.albedo[1] * k, g.albedo[2] * k];
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
        c, 0.12, { normals: [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]] },
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
  pedestrian(): Mesh {
    const b = new MeshBuilder();
    const skin: Vec3[] = [[0.62, 0.45, 0.34], [0.42, 0.30, 0.22], [0.75, 0.58, 0.45], [0.28, 0.20, 0.16]];
    const cloth: Vec3[] = [
      [0.75, 0.28, 0.22], [0.20, 0.34, 0.55], [0.85, 0.72, 0.35], [0.30, 0.48, 0.36],
      [0.86, 0.86, 0.84], [0.42, 0.24, 0.46], [0.18, 0.20, 0.26], [0.92, 0.52, 0.30],
    ];
    const c = cloth[0], s = skin[0];
    // Legs
    b.pushBox([0, 0.42, 0], [0.075, 0.42, 0.075], [0.10, 0.11, 0.14], { faces: FACE_ALL });
    // Torso
    b.pushBox([0, 1.12, 0], [0.19, 0.30, 0.12], c, { faces: FACE_ALL });
    // Arms
    b.pushBox([0.25, 1.10, 0], [0.06, 0.26, 0.06], c, { faces: FACE_ALL });
    b.pushBox([-0.25, 1.10, 0], [0.06, 0.26, 0.06], c, { faces: FACE_ALL });
    // Head
    b.pushBox([0, 1.58, 0], [0.105, 0.12, 0.10], s, { faces: FACE_ALL });
    void skin; void cloth;
    return b.build();
  },

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

