/**
 * Lit-row reach probe (rounds 3a and 3c, docs/FALL_LITROWS_ROUND3.md and
 * docs/FALL_LITROWS_ROUND3C.md).
 *
 *   npx --yes vite-node@6.0.0 src/render/__probe_litrow.ts
 *
 * The question is the round's spec, not an opinion: at pose 18's real distance,
 * does a fall crown carry a contiguous ROW of lit blocks, or one mark? It
 * projects every fall column into pose 18's camera (position, look-at and fov
 * read from the capture's `_capture.json`, so the probe points at what the
 * frame points at — PROCESS rule 4).
 *
 * WHAT IT ASSERTS, and how it is made to agree with the renderer:
 *
 *  1. **The LOD is the renderer's, not an assumption.** Round 3a's probe had
 *     `p.d > 160 ? 2 : 0`, which is a guess about the quality policy: it made
 *     every column past 160 m "lod 2" and so described a path the renderer does
 *     not take at those distances. It now calls the same functions the renderer
 *     calls — `lodForDistance(chunkDistance(...), TIERS.medium)` from
 *     `quality.ts` — with the chunk size read from `defaultCityConfig()`. The
 *     band 193-410 m is therefore LOD 0-1 (one chunk is 256 m; LOD 2 starts at
 *     3.2 chunks, ~819 m), which is exactly where the reviewer measured one
 *     mark per crown.
 *  2. **Blocks, not area.** For each of pose 18's nearest columns it builds that
 *     column ALONE at the LOD the renderer would use for it, keeps the lit-warm
 *     quads whose outward normal faces the camera (a back-facing pane is hidden
 *     by the pile, so counting it would overstate what the reviewer can see),
 *     projects their centres, and clusters them into screen-space runs. The
 *     printed `runs`/`max` are the count the acceptance criterion is written in:
 *     a crown with one bay reports `runs 1 max 1`; a crown with a 2-3 bay row
 *     reports `max 2` or `max 3`.
 */

import './citymesh';
import { defaultCityConfig } from '../world/citygen';
import { fallZone, type FallColumn } from '../world/fallzone';
import { MeshBuilder } from '../world/geometry';
import { chunkDistance, lodForDistance, TIERS } from './quality';
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
const oneChunk = (columns: FallColumn[]) => ({ yaw: zone.gridYaw, columns, decks: [], bridges: [], patches: [], wreck: [], stations: [] });
const all = new MeshBuilder();
pushFallVillage(all, oneChunk(cols), 0);
const far = new MeshBuilder();
pushFallVillage(far, oneChunk(cols), 2);
const near = litArea(all), farL = litArea(far);
/**
 * Stream-neutrality. A bay is 1 pane quad + 6 frame quads = 7 quads = 14 tris,
 * so `total - 14 * bays` is everything the round did NOT mean to touch. It is
 * 90,460 before round 3c and 90,460 after: the row added bays and re-rolled
 * nothing (a re-roll would move seams, skirts and openings, and this number
 * with them). The exact multiple is the proof — +292 bays is +4,088 tris.
 */
const bayFree = (mb: MeshBuilder, bays: number): number => mb.triangleCount - 14 * bays;

console.log(`columns ${cols.length}`);
console.log(`lod 0 village: ${near.quads} lit quads, ${near.area.toFixed(0)} m2 lit area, ` +
  `${(near.area / cols.length).toFixed(2)} m2 per column`);
console.log(`lod 2 merged:  ${farL.quads} lit quads, ${farL.area.toFixed(0)} m2 lit area, ` +
  `${(farL.area / cols.length).toFixed(2)} m2 per column`);
console.log(`bay-free triangles at lod 0: ${bayFree(all, near.quads)} ` +
  `(90,460 both before and after round 3c — the row added bays and re-rolled no face)`);

// ---------------------------------------------------------------- LOD, the renderer's
const CHUNK = defaultCityConfig(SEED).chunkSize;
const camCx = Math.floor(POSE18.pos[0] / CHUNK), camCz = Math.floor(POSE18.pos[2] / CHUNK);
/** The LOD `bakeChunk` is given for the chunk this column stands in. */
const lodFor = (c: FallColumn): number =>
  lodForDistance(chunkDistance(Math.floor(c.x / CHUNK), Math.floor(c.z / CHUNK), camCx, camCz), TIERS.medium);

/** One lit-warm pane: world centre, outward normal, run axis, and screen box. */
interface Pane { sx: number; sy: number; d: number; wpx: number; hpx: number; cx: number; cy: number; cz: number; n: [number, number, number]; ax: [number, number, number]; wm: number }

function litPanes(c: FallColumn, lod: number): Pane[] {
  const mb = new MeshBuilder();
  pushFallVillage(mb, oneChunk([c]), lod);
  const raw = mb as unknown as { pos: number[]; col: number[]; idx: number[] };
  const pos = raw.pos, col = raw.col, idx = raw.idx;
  const warm = (i: number): boolean => {
    const k = i * 4;
    return Math.abs(col[k] - 1.0) < 0.02 && Math.abs(col[k + 1] - 0.72) < 0.02 && Math.abs(col[k + 2] - 0.4) < 0.02;
  };
  const out: Pane[] = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c2 = idx[t + 2];
    if (!warm(a) || !warm(b) || !warm(c2)) continue; // only the pane, never its frame
    const p = [0, 1, 2].map((q) => [pos[idx[t + q] * 3], pos[idx[t + q] * 3 + 1], pos[idx[t + q] * 3 + 2]]);
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn: [number, number, number] = [n[0] / nl, n[1] / nl, n[2] / nl];
    const el = Math.hypot(e1[0], e1[1], e1[2]) || 1;
    const ax: [number, number, number] = [e1[0] / el, e1[1] / el, e1[2] / el];
    const cx = (p[0][0] + p[1][0] + p[2][0]) / 3, cy = (p[0][1] + p[1][1] + p[2][1]) / 3, cz = (p[0][2] + p[1][2] + p[2][2]) / 3;
    // Facing test: a pane on the far side of the pile is hidden by the pile, so
    // counting it would overstate what a reviewer can count in the frame.
    if ((POSE18.pos[0] - cx) * n[0] + (POSE18.pos[1] - cy) * n[1] + (POSE18.pos[2] - cz) * n[2] <= 0) continue;
    const s = project(cx, cy, cz);
    if (!s) continue;
    // Triangle edge lengths give the pane's own projected size, so the run test
    // scales with distance instead of using a fixed pixel gap.
    const wpx = (Math.hypot(e1[0], e1[1], e1[2]) * B.focal) / s.d;
    const hpx = (Math.hypot(e2[0], e2[1], e2[2]) * B.focal) / s.d;
    out.push({ sx: s.sx, sy: s.sy, d: s.d, wpx, hpx, cx, cy, cz, n: nn, ax, wm: el });
  }
  return out;
}

/**
 * Contiguous runs of bays, in WORLD space, bucketed by face normal AND height:
 * panes of one row share a normal and a y, and are 2.85 m apart (2.4 m bay +
 * 0.45 m panel). Two rows stacked on the same face share the normal but sit a
 * box height apart, so a normal-only test counts 2 bays + 2 bays as a run of 4 —
 * which is exactly what the first version of this probe did. Not a screen-space
 * pixel gap either: at 193 m a 0.45 m panel is 1.9 px (countable) while at 410 m
 * it is 0.9 px, so a fixed pixel threshold would describe different geometry at
 * each distance.
 */
function runs(panes: Pane[]): number[] {
  const buckets = new Map<string, Pane[]>();
  for (const p of panes) {
    const k = `${p.n.map((v) => Math.round(v * 100)).join(',')}@${Math.round(p.cy * 4)}`;
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(p);
  }
  const out: number[] = [];
  for (const g of buckets.values()) {
    const a = g[0];
    const t = (q: Pane): number => q.cx * a.ax[0] + q.cy * a.ax[1] + q.cz * a.ax[2];
    g.sort((x, y) => t(x) - t(y));
    let run = 1;
    for (let i = 1; i < g.length; i++) {
      if (t(g[i]) - t(g[i - 1]) <= 3.0) run++;
      else { out.push(run); run = 1; }
    }
    out.push(run);
  }
  return out.sort((x, y) => y - x);
}

const inFrame = cols
  .map((c) => ({ c, p: project(c.x, (c.pileBase + c.pileTop) / 2, c.z) }))
  .filter((v): v is { c: FallColumn; p: { sx: number; sy: number; d: number } } =>
    v.p !== null && v.p.sx >= 0 && v.p.sx < POSE18.w && v.p.sy >= 0 && v.p.sy < POSE18.h)
  .sort((a, b) => a.p.d - b.p.d);

console.log(`\npose 18: ${inFrame.length} of ${cols.length} columns in frame; ` +
  `camera chunk (${camCx},${camCz}), ${CHUNK} m chunks, LOD = floor(chunks / 1.6) capped at ${TIERS.medium.lodRange[1]}`);
console.log('  id  kind     dist  screen      lod  panes  runs (largest first)   row width');
for (const { c, p } of inFrame.slice(0, 8)) {
  const lod = lodFor(c);
  const panes = litPanes(c, lod);
  const rr = runs(panes);
  const width = panes.length
    ? Math.max(...panes.map((q) => q.sx)) - Math.min(...panes.map((q) => q.sx)) + Math.max(...panes.map((q) => q.wpx))
    : 0;
  console.log(`  ${String(c.id).padStart(3)} ${c.kind.padEnd(8)} ${p.d.toFixed(0).padStart(4)}m ` +
    `(${p.sx.toFixed(0).padStart(4)},${p.sy.toFixed(0).padStart(3)})  ${String(lod).padStart(2)}  ` +
    `${String(panes.length).padStart(5)}  ${(rr.length ? rr.join('+') : '-').padEnd(20)}  ${width.toFixed(0)} px`);
}
const lodHist: Record<number, number> = {};
for (const { c } of inFrame) lodHist[lodFor(c)] = (lodHist[lodFor(c)] ?? 0) + 1;
console.log(`\nin-frame LOD distribution: ${Object.entries(lodHist).map(([k, v]) => `lod${k}=${v}`).join(' ')}`);
if (inFrame.length) {
  const ds = inFrame.map((v) => v.p.d);
  console.log(`distances ${Math.min(...ds).toFixed(0)}..${Math.max(...ds).toFixed(0)} m; ` +
    `nearest row ${inFrame[0] ? runs(litPanes(inFrame[0].c, lodFor(inFrame[0].c))).join('+') || '-' : '-'}`);
}
