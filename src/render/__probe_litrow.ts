/**
 * Lit-row reach probe (round 3a, docs/FALL_LITROWS_ROUND3.md).
 *
 *   npx --yes vite-node@6.0.0 src/render/__probe_litrow.ts
 *
 * The question this answers is the round's spec, not an opinion: does the lit
 * row survive at pose 18's distance as a BLOCK, or is it still a point? It
 * projects every fall column into pose 18's camera (position, look-at and fov
 * read from the capture's `_capture.json`, so the probe points at what the
 * frame points at — PROCESS rule 4) and prints, per column in frame, its
 * distance and the pixel size of the bays this round draws there.
 *
 * It also counts, over the whole zone, the emissive lit area the village emits
 * per column at lod 0 and at the merged far path, by walking the mesh the same
 * way the renderer does and measuring only the quads whose vertex colour is the
 * lit warm. That is the "lit area is the lever" claim, measured.
 */

import './citymesh';
import { fallZone, type FallColumn } from '../world/fallzone';
import { MeshBuilder } from '../world/geometry';
import { pushFallVillage } from './fallvillage';

const SEED = 6191639;
const POSE18 = {
  pos: [-633.8, 122.947993430884, 438.5] as [number, number, number],
  look: [-681.3667835568027, 140.18799741968496, 835.2895838435797] as [number, number, number],
  fov: 1.0484040158993704,
  w: 1600,
  h: 900,
};

function basis(): { f: number[]; r: number[]; u: number[]; focal: number } {
  const f = [POSE18.look[0] - POSE18.pos[0], POSE18.look[1] - POSE18.pos[1], POSE18.look[2] - POSE18.pos[2]];
  const nf = Math.hypot(...f);
  const fn = f.map((v) => v / nf);
  const r = [fn[1] * 0 - fn[2] * 1, fn[2] * 0 - fn[0] * 0, fn[0] * 1 - fn[1] * 0];
  const nr = Math.hypot(...r);
  const rn = r.map((v) => v / nr);
  const un = [rn[1] * fn[2] - rn[2] * fn[1], rn[2] * fn[0] - rn[0] * fn[2], rn[0] * fn[1] - rn[1] * fn[0]];
  return { f: fn, r: rn, u: un, focal: POSE18.h / (2 * Math.tan(POSE18.fov / 2)) };
}

const B = basis();
function project(x: number, y: number, z: number): { sx: number; sy: number; d: number } | null {
  const dx = x - POSE18.pos[0], dy = y - POSE18.pos[1], dz = z - POSE18.pos[2];
  const zc = dx * B.f[0] + dy * B.f[1] + dz * B.f[2];
  if (zc <= 1) return null;
  const xc = dx * B.r[0] + dy * B.r[1] + dz * B.r[2];
  const yc = dx * B.u[0] + dy * B.u[1] + dz * B.u[2];
  return { sx: POSE18.w / 2 + (xc / zc) * B.focal, sy: POSE18.h / 2 - (yc / zc) * B.focal, d: zc };
}

/** Emissive quads whose colour is the lit warm, and their area in m². */
function litArea(mb: MeshBuilder): { quads: number; area: number } {
  const raw = mb as unknown as { pos: number[]; col: number[]; idx: number[] };
  const pos = raw.pos, col = raw.col, idx = raw.idx;
  let quads = 0, area = 0;
  const warm = (i: number): boolean => {
    const k = i * 4;
    return Math.abs(col[k] - 1.0) < 0.02 && Math.abs(col[k + 1] - 0.72) < 0.02 && Math.abs(col[k + 2] - 0.4) < 0.02;
  };
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (!warm(a) || !warm(b) || !warm(c)) continue;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    area += Math.hypot(nx, ny, nz) / 2; // one triangle
    quads++;
  }
  return { quads: quads / 2, area }; // two triangles per quad; area is the sum of both
}

const zone = fallZone(SEED);
const cols: FallColumn[] = zone.columns;
const chunk = { yaw: zone.gridYaw, columns: cols, decks: [], bridges: [], patches: [], wreck: [], stations: [] };
const all = new MeshBuilder();
pushFallVillage(all, chunk, 0);
const far = new MeshBuilder();
pushFallVillage(far, chunk, 2);
const near = litArea(all), farL = litArea(far);

console.log(`columns ${cols.length}`);
console.log(`lod 0 village: ${near.quads} lit quads, ${near.area.toFixed(0)} m2 lit area, ` +
  `${(near.area / cols.length).toFixed(2)} m2 per column`);
console.log(`lod 2 merged:  ${farL.quads} lit quads, ${farL.area.toFixed(0)} m2 lit area, ` +
  `${(farL.area / cols.length).toFixed(2)} m2 per column`);

// Bay sizes as written this round (metres), for the projection below.
const NEAR_BAY = { w: 2.4, h: 1.2 };
const FAR_BAY = { w: 2.9, h: 1.45 };

const inFrame = cols
  .map((c) => ({ c, p: project(c.x, (c.pileBase + c.pileTop) / 2, c.z) }))
  .filter((v): v is { c: FallColumn; p: { sx: number; sy: number; d: number } } =>
    v.p !== null && v.p.sx >= 0 && v.p.sx < POSE18.w && v.p.sy >= 0 && v.p.sy < POSE18.h)
  .sort((a, b) => a.p.d - b.p.d);

const px = (metres: number, d: number): number => (metres * B.focal) / d;
console.log(`\npose 18: ${inFrame.length} of ${cols.length} columns in frame`);
for (const { c, p } of inFrame.slice(0, 14)) {
  const lod = p.d > 160 ? 2 : 0; // the quality tier's LOD radius at `medium`; printed for both
  console.log(`  id${String(c.id).padStart(3)} ${c.kind.padEnd(7)} d=${p.d.toFixed(0).padStart(4)}m ` +
    `screen(${p.sx.toFixed(0)},${p.sy.toFixed(0)})  bay ${px(NEAR_BAY.w, p.d).toFixed(1)}x${px(NEAR_BAY.h, p.d).toFixed(1)} px (near)  ` +
    `${px(FAR_BAY.w, p.d).toFixed(1)}x${px(FAR_BAY.h, p.d).toFixed(1)} px (far)  lod~${lod}`);
}
if (inFrame.length) {
  const ds = inFrame.map((v) => v.p.d);
  console.log(`\ndistances ${Math.min(...ds).toFixed(0)}..${Math.max(...ds).toFixed(0)} m; ` +
    `nearest bay ${px(NEAR_BAY.w, Math.min(...ds)).toFixed(1)} px wide, ` +
    `farthest ${px(FAR_BAY.w, Math.max(...ds)).toFixed(1)} px wide`);
}
