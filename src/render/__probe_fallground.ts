/**
 * Fall ground cost probe (round 3b, docs/FALL_GROUND_ROUND3.md).
 *
 *   npx --yes vite-node@6.0.0 src/render/__probe_fallground.ts
 *
 * Measures the thing the plan asked the probe to confirm: the per-chunk
 * triangle cost of the ground pass and the number of work lamps it registers.
 * It bakes the zone's chunks the way the renderer does (pushFallChunk with the
 * zone's own FallChunk) rather than guessing from source line counts.
 */

import './citymesh';
import { cityPlan, GROUND_Y } from '../world/citygen';
import { fallZone, fallChunk } from '../world/fallzone';
import { MeshBuilder } from '../world/geometry';
import { pushFallChunk, type ChunkLight } from './fallmesh';
import { pushFallGround } from './fallground';

const SEED = 6191639;
const SIZE = 256;
const zone = fallZone(cityPlan(SEED).seed);
const cols = zone.columns.map((c) => [c.x, c.z] as const);

let total = 0, totalGround = 0, lamps = 0, chunks = 0, maxFull = 0, maxGround = 0, maxLamps = 0;
let opposed = 0, tris = 0;
/** Winding against the authored normal = the back-face cull hides the visible side. */
const opposedIn = (m: ReturnType<MeshBuilder['build']>): number => {
  let bad = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => m.indices[t + k]);
    const e1 = [0, 1, 2].map((k) => m.positions[b * 3 + k] - m.positions[a * 3 + k]);
    const e2 = [0, 1, 2].map((k) => m.positions[c * 3 + k] - m.positions[a * 3 + k]);
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const gl = Math.hypot(g[0], g[1], g[2]);
    if (gl < 1e-4) continue;
    const n = [0, 1, 2].map((k) => m.normals[a * 3 + k]);
    const cos = (g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / (gl * (Math.hypot(n[0], n[1], n[2]) || 1));
    if (cos <= -0.05) bad++;
    tris++;
  }
  return bad;
};
const per = new Map<string, number>();
for (const [x, z] of cols) {
  const key = `${Math.floor(x / SIZE)},${Math.floor(z / SIZE)}`;
  per.set(key, (per.get(key) ?? 0) + 1);
}
for (const key of per.keys()) {
  const [cx, cz] = key.split(',').map(Number);
  const fall = fallChunk(zone, cx * SIZE, cz * SIZE, SIZE);
  const lights: ChunkLight[] = [];
  const full = new MeshBuilder();
  pushFallChunk(full, fall, 0, [], lights);
  // The ground pass on its own, in a fresh builder: exact, not a difference.
  const ground = new MeshBuilder();
  const groundLights: ChunkLight[] = [];
  pushFallGround(ground, fall, 0, [], groundLights);
  opposed += opposedIn(ground.build());
  chunks++;
  total += full.triangleCount;
  totalGround += ground.triangleCount;
  lamps += groundLights.length;
  if (ground.triangleCount > maxGround) maxGround = ground.triangleCount;
  if (full.triangleCount > maxFull) maxFull = full.triangleCount;
  if (groundLights.length > maxLamps) maxLamps = groundLights.length;
}
console.log(`zone columns ${zone.columns.length} across ${chunks} chunks (${(zone.columns.length / chunks).toFixed(1)} per chunk)`);
console.log(`lod 0 chunk triangles: total ${total}, mean ${Math.round(total / chunks)}, max ${maxFull}`);
console.log(`the ground pass alone: ${totalGround} tris citywide, mean ${Math.round(totalGround / chunks)} per chunk, max ${maxGround}`);
console.log(`winding: ${opposed} of ${tris} ground triangles face away from their authored normal`);
console.log(`work lamps registered at lod 0: ${lamps} (mean ${(lamps / chunks).toFixed(1)} per chunk, max ${maxLamps} — the cap is 6)`);
console.log(`ground deck sits at y=${GROUND_Y}`);
