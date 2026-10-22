/**
 * Flood-surface probe (round 3j) — WHICH surface does the lamp's cone land on?
 *
 *   npx --yes vite-node@6.0.0 src/render/__probe_floodsurface.ts
 *
 * Pose 20's acceptance is a warm patch on the floor 1-6 m in front of the winch
 * hut's door. The pool term in `lighting.wgsl` multiplies the lamp's colour by
 * the fragment's albedo, so the surface under the cone decides whether the pool
 * can be warm at all — and the two surfaces of a flooded low are different
 * materials: the water sheets (the `flood` class) and the silt margin (the
 * patch's top face, tagged `paving`/`board-formed`).
 *
 * This probe answers it from the bake, not from the source: it ray-casts the
 * baked fall chunk and reports the surface and its authored colour under the
 * lamp, and where the water sheets actually are.
 */

import { cityPlan, GROUND_Y } from '../world/citygen';
import { fallZone, fallChunk } from '../world/fallzone';
import { MeshBuilder } from '../world/geometry';
import { pushFallChunk, floodWater, type ChunkLight } from './fallmesh';
import { decodeGroundSurfaceTag } from '../world/groundgrammar';

const floodWaterQuads = floodWater;

const SEED = 0x5e7a17;
const SIZE = 256;
const zone = fallZone(cityPlan(SEED).seed);
const fall = fallChunk(zone, 2 * SIZE, -2 * SIZE, SIZE);
const yaw = fall.yaw;
const ca = Math.cos(yaw), sa = Math.sin(yaw);
const at = (x: number, z: number, a: number, b: number): [number, number] => [x + ca * a + sa * b, z - sa * a + ca * b];

const bld = new MeshBuilder();
const lights: ChunkLight[] = [];
pushFallChunk(bld, fall, 0, [], lights);
const m = bld.build();
const V = m.positions, C = m.colors, I = m.indices;

/** The highest surface under (x, z) that is at or below `maxY`. */
function surfaceAt(x: number, z: number, maxY = 2.0): string {
  const area = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    (qx - px) * (rz - pz) - (rx - px) * (qz - pz);
  let bestY = -Infinity, best = 'none';
  for (let t = 0; t < I.length; t += 3) {
    const ia = I[t], ib = I[t + 1], ic = I[t + 2];
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ax = V[a], az = V[a + 2], bx = V[b], bz = V[b + 2], cx = V[c], cz = V[c + 2];
    const den = area(ax, az, bx, bz, cx, cz);
    if (Math.abs(den) < 1e-12) continue;
    // Barycentric weights: each is the area of the triangle the point makes
    // with the other two vertices, over the triangle's own area.
    const w0 = area(x, z, bx, bz, cx, cz) / den;
    const w1 = area(x, z, cx, cz, ax, az) / den;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
    const y = w0 * V[a + 1] + w1 * V[b + 1] + w2 * V[c + 1];
    if (y > maxY || y <= bestY) continue;
    bestY = y;
    const col = [C[ia * 4], C[ia * 4 + 1], C[ia * 4 + 2]];
    const tag = C[ia * 4 + 3];
    let s = `y=${y.toFixed(3)} albedo [${col.map((v) => v.toFixed(3)).join(',')}]`;
    s += tag < 0 ? ` ${decodeGroundSurfaceTag(tag).surface}/${decodeGroundSurfaceTag(tag).family}` : ' untagged';
    best = s;
  }
  return best;
}

console.log(`chunk (2,-2)  GROUND_Y ${GROUND_Y}  ${I.length / 3} tris`);
for (const p of fall.patches) {
  const near = Math.hypot(p.x - 558.1, p.z + 452.4);
  console.log(`  patch ${p.kind} at ${p.x.toFixed(1)},${p.z.toFixed(1)} half ${p.halfX}x${p.halfZ}  ${near.toFixed(0)} m from pose 20's camera`);
}

const c = fall.columns.find((k) => k.id === 54)!;
const b0 = c.halfZ + 2.9;
console.log(`\npose 20's winch hut: column id${c.id}, b0 ${b0.toFixed(2)}, door face b ${(b0 + 1.7).toFixed(2)}`);
console.log('the floor 0-6 m in front of the door, and what is under it:');
for (const d of [0, 0.5, 1, 2, 3, 4, 5, 6]) {
  const [wx, wz] = at(c.x, c.z, 0, b0 + 1.7 + d);
  console.log(`  +${d.toFixed(1)} m  world ${wx.toFixed(1)},${wz.toFixed(1)}  ->  ${surfaceAt(wx, wz)}`);
}
console.log('\nthe water sheets, for comparison:');
for (const p of fall.patches) {
  if (p.kind !== 'flooded') continue;
  for (const q of floodWaterQuads(p, yaw)) console.log(`  water quad y=${q.y.toFixed(3)}  -> ${surfaceAt(q.pts[0][0], q.pts[0][1])}`);
}
