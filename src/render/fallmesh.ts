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
import { GROUND_Y } from '../world/citygen';
import type { CrowdObstacle } from '../world/crowdobstacles';
import type { FallChunk, PatchKind } from '../world/fallzone';
import type { MeshBuilder } from '../world/geometry';
import { pushColumn } from './fallcolumn';
import { pushFallGround } from './fallground';
import { pushFallVillage } from './fallvillage';

const STEEL: Vec3 = [0.14, 0.17, 0.21];
const SLAB: Vec3 = [0.3, 0.31, 0.32];
const SPAN: Vec3 = [0.2, 0.18, 0.16];
const PATCH: Record<PatchKind, Vec3> = { fenced: [0.24, 0.25, 0.26], flooded: [0.06, 0.08, 0.1], overgrown: [0.14, 0.19, 0.11] };

/** A box on a right-handed basis: MeshBuilder.pushBox's corners and faces, so every face winds outward. */
export function pushOrientedBox(bld: MeshBuilder, c: Vec3, ax: Vec3, ay: Vec3, az: Vec3, h: Vec3, color: Vec3): void {
  const p = (x: number, y: number, z: number): Vec3 => [
    c[0] + ax[0] * x + ay[0] * y + az[0] * z,
    c[1] + ax[1] * x + ay[1] * y + az[1] * z,
    c[2] + ax[2] * x + ay[2] * y + az[2] * z,
  ];
  const [hx, hy, hz] = h;
  const c000 = p(-hx, -hy, -hz), c100 = p(hx, -hy, -hz), c110 = p(hx, hy, -hz), c010 = p(-hx, hy, -hz);
  const c001 = p(-hx, -hy, hz), c101 = p(hx, -hy, hz), c111 = p(hx, hy, hz), c011 = p(-hx, hy, hz);
  bld.pushQuad(c001, c101, c111, c011, color);
  bld.pushQuad(c100, c000, c010, c110, color);
  bld.pushQuad(c101, c100, c110, c111, color);
  bld.pushQuad(c000, c001, c011, c010, color);
  bld.pushQuad(c011, c111, c110, c010, color);
  bld.pushQuad(c000, c100, c101, c001, color);
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
    if (lod < 2) pushOrientedBox(bld, [p.x, GROUND_Y + 0.03, p.z], ...flat, [p.halfX, 0.02, p.halfZ], PATCH[p.kind]);
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
