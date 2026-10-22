/**
 * The fall zone as a greybox (DESIGN §8): plain volumes where placement put
 * things, so placement can be judged in frame before anything is modelled. The
 * village rendering pass replaces the volumes with the columns, piles, revival
 * kit and wreckage. The crowd obstacles stay: they are placement, not looks.
 * Round 0 of that pass lives in fallvillage.ts (the piles) and round 2 lives
 * in fallcolumn.ts (the shafts, ground to break); this file keeps the shared
 * basis helpers, decks, bridges, patches, wreck and stations, and wires the
 * two grammar files together.
 */

import type { Vec3 } from '../core/math';
import { makeRng } from '../core/math';
import { GROUND_Y } from '../world/citygen';
import type { CrowdObstacle } from '../world/crowdobstacles';
import type { FallChunk, OffLimitsPatch, PatchKind } from '../world/fallzone';
import type { MeshBuilder, MeshOpts } from '../world/geometry';
import { groundSurfaceTag } from '../world/groundgrammar';
import { pushColumn } from './fallcolumn';
import { pushFallGround } from './fallground';
import { pushFallVillage } from './fallvillage';

const STEEL: Vec3 = [0.14, 0.17, 0.21];
const SLAB: Vec3 = [0.3, 0.31, 0.32];
const SPAN: Vec3 = [0.2, 0.18, 0.16];
const PATCH: Record<PatchKind, Vec3> = {
  fenced: [0.24, 0.25, 0.26],
  // A flooded low is mud and shallow water, not asphalt. Round 3j: the pool
  // term in lighting.wgsl multiplies the lamp's colour by the fragment's
  // albedo, so a blue-biased dark floor turns a warm lamp into a blue-biased
  // lift — the lamp's pool was computed and invisible (PART 13 (b)). This is
  // the SILT margin the lamp's cone actually lands on: the flooded patch's
  // top face, which carries the `paving`/`board-formed` tag, not the flood
  // class. `src/render/__probe_floodsurface.ts` measures it: the strip in
  // front of the winch hut at pose 20 is this surface, 0-6 m in front of the
  // door, and the water sheets are 4-15 m away from it.
  flooded: [0.132, 0.126, 0.115],
  overgrown: [0.14, 0.19, 0.11],
};

/** A box on a right-handed basis: MeshBuilder.pushBox's corners and faces, so every face winds outward.
 *  `opts` goes to every face; `topOpts` to the +y face only, which is how a
 *  ground tag is kept off a vertical face. A tagged side face would be a
 *  4 cm stripe of mirror around every puddle — and the wetter the material,
 *  the more visible it is at exactly the grazing angle that matters. */
export function pushOrientedBox(
  bld: MeshBuilder, c: Vec3, ax: Vec3, ay: Vec3, az: Vec3, h: Vec3, color: Vec3,
  opts: MeshOpts = {}, topOpts: MeshOpts = opts,
): void {
  const p = (x: number, y: number, z: number): Vec3 => [
    c[0] + ax[0] * x + ay[0] * y + az[0] * z,
    c[1] + ax[1] * x + ay[1] * y + az[1] * z,
    c[2] + ax[2] * x + ay[2] * y + az[2] * z,
  ];
  const [hx, hy, hz] = h;
  const us = opts.uvScale ?? 1;
  const c000 = p(-hx, -hy, -hz), c100 = p(hx, -hy, -hz), c110 = p(hx, hy, -hz), c010 = p(-hx, hy, -hz);
  const c001 = p(-hx, -hy, hz), c101 = p(hx, -hy, hz), c111 = p(hx, hy, hz), c011 = p(-hx, hy, hz);
  bld.pushQuad(c001, c101, c111, c011, color, us, opts);
  bld.pushQuad(c100, c000, c010, c110, color, us, opts);
  bld.pushQuad(c101, c100, c110, c111, color, us, opts);
  bld.pushQuad(c000, c001, c011, c010, color, us, opts);
  bld.pushQuad(c011, c111, c110, c010, color, us, topOpts);
  bld.pushQuad(c000, c100, c101, c001, color, us, opts);
}

/** The basis of a frame yawed by `yaw` (rotationY), then tilted by `tilt` about its own x axis. */
export function yawTiltBasis(yaw: number, tilt: number): [Vec3, Vec3, Vec3] {
  const c = Math.cos(yaw), s = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
  return [[c, 0, -s], [s * st, ct, c * st], [s * ct, -st, c * ct]];
}

/** The basis of a span from a to b: x along it, z level and to its side, y up out of it. */
function spanBasis(a: Vec3, b: Vec3): [Vec3, Vec3, Vec3] {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const ax: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  const zl = Math.hypot(ax[0], ax[2]) || 1;
  const az: Vec3 = [-ax[2] / zl, 0, ax[0] / zl];
  const ay: Vec3 = [az[1] * ax[2] - az[2] * ax[1], az[2] * ax[0] - az[0] * ax[2], az[0] * ax[1] - az[1] * ax[0]];
  return [ax, ay, az];
}

/** The baked-chunk light list's element — citymesh's `BakedChunk['lights']`
 *  shape, declared structurally here so the fall files stay out of the bake's
 *  import graph. */
export type ChunkLight = { pos: Vec3; radius: number; color: Vec3; intensity: number };

/** Greybox one chunk's share of the fall zone, and register what the crowd must walk around.
 *  `lights`, when the caller passes its chunk's light list, collects the village's crown
 *  lights (round 1, D28: one per lit pile top, lod < 1). */
export function pushFallChunk(bld: MeshBuilder, fall: FallChunk, lod: number, obstacles: CrowdObstacle[], lights?: ChunkLight[]): void {
  const flat = yawTiltBasis(fall.yaw, 0);
  const tx = Math.cos(fall.yaw), tz = -Math.sin(fall.yaw);
  for (const c of fall.columns) {
    pushColumn(bld, c, flat, lod);
    obstacles.push({ x: c.x, z: c.z, tx, tz, halfAlong: c.halfX, halfAcross: c.halfZ, minY: GROUND_Y, maxY: c.top, kind: `fall-${c.kind}` });
  }
  // The village on each column (docs/FALL_VILLAGE_ROUND1.md): the piles
  // pushColumn used to greybox. Real boxes at lod < 2, merged blocks beyond;
  // the crowd obstacles above are placement and unchanged.
  pushFallVillage(bld, fall, lod, lights);
  for (const { deck, a, b } of fall.decks) {
    const pa: Vec3 = [a.x, deck.y - 1.2, a.z], pb: Vec3 = [b.x, deck.y - 1.2, b.z];
    const mid: Vec3 = [(pa[0] + pb[0]) / 2, pa[1], (pa[2] + pb[2]) / 2];
    pushOrientedBox(bld, mid, ...spanBasis(pa, pb), [Math.hypot(b.x - a.x, b.z - a.z) / 2, 1.2, deck.width / 2], SLAB);
  }
  if (lod < 2) {
    for (const { bridge, a, b } of fall.bridges) {
      const pa: Vec3 = [a.x, bridge.ya, a.z], pb: Vec3 = [b.x, bridge.yb, b.z];
      const mid: Vec3 = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
      const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]);
      pushOrientedBox(bld, mid, ...spanBasis(pa, pb), [len / 2, 0.15, bridge.kind === 'rope' ? 0.6 : 0.9], SPAN);
    }
  }
  for (const w of fall.wreck) {
    pushOrientedBox(bld, [w.x, w.y, w.z], ...yawTiltBasis(w.yaw, w.tilt), [w.halfX, w.halfY, w.halfZ], SLAB);
    obstacles.push({
      x: w.x, z: w.z, tx: Math.cos(w.yaw), tz: -Math.sin(w.yaw), halfAlong: w.halfX,
      halfAcross: w.halfZ * Math.cos(w.tilt) + w.halfY * Math.sin(w.tilt),
      minY: GROUND_Y, maxY: w.y + w.halfZ * Math.sin(w.tilt) + w.halfY, kind: `fall-${w.kind}`,
    });
  }
  for (const p of fall.patches) {
    if (lod < 2) {
      if (p.kind === 'flooded') {
        // The patch box is the wet silt. Its TOP face carries an ordinary
        // paving tag so it is ground — grain, joints, matte — rather than the
        // flat MAT_DIFFUSE rectangle that never reaches groundSurface (the
        // audit's §3). The side faces stay untagged.
        pushOrientedBox(bld, [p.x, GROUND_Y + 0.03, p.z], ...flat, [p.halfX, 0.02, p.halfZ], PATCH[p.kind],
          {}, { surfaceTag: groundSurfaceTag('paving', 'board-formed') });
        pushFloodWater(bld, p, fall.yaw);
      } else {
        pushOrientedBox(bld, [p.x, GROUND_Y + 0.03, p.z], ...flat, [p.halfX, 0.02, p.halfZ], PATCH[p.kind]);
      }
    }
    obstacles.push({ x: p.x, z: p.z, tx, tz, halfAlong: p.halfX, halfAcross: p.halfZ, minY: GROUND_Y, maxY: GROUND_Y + 2.2, kind: `off-limits-${p.kind}` });
  }
  for (const s of fall.stations) {
    pushOrientedBox(bld, [s[0], GROUND_Y + 2, s[2]], ...flat, [3, 2, 3], STEEL);
    obstacles.push({ x: s[0], z: s[2], tx, tz, halfAlong: 3, halfAcross: 3, minY: GROUND_Y, maxY: GROUND_Y + 4, kind: 'fall-ropeway-station' });
  }
  // The working floor (round 3b): lifelines at the columns' feet, the D30 kit
  // and the ropeway huts' rails, with the zone's warm work lamps. Last, so the
  // lamps land after the village's crown lights in the same chunk list.
  pushFallGround(bld, fall, lod, obstacles, lights);
}

export interface FloodQuad {
  /** The four corners, world (x, z). */
  pts: [number, number][];
  /** World y of the sheet. */
  y: number;
}

/**
 * The water's geometry: the pools then the runnels, in the order the RNG is
 * drawn. Exported because a capture pose has to stand at a pool's near edge,
 * and a copy of this stream in the probe would drift from the bake the moment
 * either changed (PROCESS: a derived number must come from the source).
 */
export function floodWater(p: OffLimitsPatch, yaw: number): FloodQuad[] {
  // Derived from the patch's own position, so the water is part of the zone's
  // deterministic bake and identical on every replay.
  const r = makeRng((Math.round(p.x * 32) * 73856093) ^ (Math.round(p.z * 32) * 19349663) ^ 0x5eed);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const at = (a: number, b: number): [number, number] => [p.x + ca * a + sa * b, p.z - sa * a + ca * b];
  const out: FloodQuad[] = [];
  const pools = 6 + r.int(0, 3);
  for (let k = 0; k < pools; k++) {
    const a0 = r.range(-0.72, 0.72) * p.halfX, b0 = r.range(-0.72, 0.72) * p.halfZ;
    const rad = Math.min(4 + r.next() * 7, Math.max(2.5, Math.min(p.halfX, p.halfZ) * 0.24));
    const pts: [number, number][] = [];
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2 + r.jitter(0.26);
      const rr = rad * (0.62 + r.next() * 0.55);
      pts.push(at(a0 + Math.cos(ang) * rr * 1.35, b0 + Math.sin(ang) * rr));
    }
    out.push({ pts, y: GROUND_Y + 0.075 + (k % 3) * 0.004 });
  }
  // Runnels: the water follows the low between wreck plates, so two long thin
  // sheets lie along the grid instead of every pool being a puddle.
  for (let k = 0; k < 2; k++) {
    const a0 = r.range(-0.5, 0.5) * p.halfX, b0 = r.range(-0.62, 0.62) * p.halfZ;
    const len = Math.min(p.halfX * 0.7, 14 + r.next() * 18);
    const wid = 2.2 + r.next() * 2.6;
    const pts: [number, number][] = [
      at(a0 - len, b0 - wid), at(a0 + len, b0 - wid * (0.7 + r.next() * 0.5)),
      at(a0 + len * (0.9 + r.next() * 0.1), b0 + wid), at(a0 - len * (0.9 + r.next() * 0.1), b0 + wid * (0.7 + r.next() * 0.5)),
    ];
    out.push({ pts, y: GROUND_Y + 0.079 + k * 0.004 });
  }
  return out;
}

/**
 * Standing water in a flooded low (round 3b §3).
 *
 * The class is applied to SEVERAL SMALL POOLS inside the patch, not to the
 * patch: a flooded low is 86 m across on average, and one quad that size tagged
 * `flood` is exactly the hard-edged sheet of horizon sky the spike warned
 * about. The pools are irregular quads at two jittered radii, and two long
 * runnels along the grid, so the waterline is ragged and the matte silt margin
 * around it carries the edge.
 *
 * Their y is GROUND_Y + 0.075 and up — ABOVE the patch box's top face at
 * GROUND_Y + 0.05. That is not cosmetic: the audit's "single most-likely silent
 * failure" is water placed inside or coplanar with its own patch box, where the
 * class, the tag, the branch, the ripple and every test can be right and the
 * frame shows no glint at all. __selftest_ground_contract.ts asserts the
 * inequality on the baked mesh.
 */
function pushFloodWater(bld: MeshBuilder, p: OffLimitsPatch, yaw: number): void {
  // Round 3j: turbid shallow water over silt, near-neutral and faintly warm,
  // instead of an asphalt-dark blue that mirrored the sky. The pool term
  // multiplies the lamp's colour by this albedo, so a blue-biased albedo made
  // the lamp's pool a blue-biased lift (PART 13 (b): the pool is computed and
  // lands on the right strip, and R-B stays negative). The geometry, the
  // +0.075 m lift and the `flood` tag are untouched; only the colour moves.
  const WATER: Vec3 = [0.118, 0.113, 0.104];
  const UP4: [Vec3, Vec3, Vec3, Vec3] = [[0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]];
  const tag = groundSurfaceTag('flood', 'asphalt');
  for (const q of floodWater(p, yaw)) {
    const [a, b, c, d] = q.pts;
    bld.pushQuad([a[0], q.y, a[1]], [b[0], q.y, b[1]], [c[0], q.y, c[1]], [d[0], q.y, d[1]],
      WATER, 1, { surfaceTag: tag, normals: UP4 });
  }
}
