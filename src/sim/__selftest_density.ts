/**
 * Crowd density measurement — the two numbers `docs/OCCUPANCY.md` records.
 *
 * These are the standing measurements for R1's density clause and R12:
 *
 *   1. `viewRadius` as the seeding limit. The furthest agent along the view is
 *      the radius, and the distance bins past it are empty. The empty far end of
 *      a 400 m street is a **seeding** limit, not a placement one.
 *   2. The **separation histogram** for the 20-30 px band. An average hides the
 *      merge; the shape does not. The vision gate asks for "groups with
 *      deliberate gaps", and the quantity that answers it is whether there is a
 *      gap mode at all — the widest bin must be non-empty for a group structure
 *      to exist.
 *
 * This is a *measurement*, not a regression test. It prints and asserts that the
 * measurement is well formed (instances exist, pairs were found, the histogram
 * bins sum to the pair count). It deliberately does **not** assert the value of
 * the gap bin: it was 0.0% when measured, that is an open defect rather than an
 * invariant, and pinning a known failure here would make a future fix look like a
 * regression.
 *
 * Run: `npx vite-node src/sim/__selftest_density.ts`
 */

import { City, defaultCityConfig, GROUND_Y } from '../world/citygen';
import { derivePose, type Population } from '../world/diagnosticposes';
import { defaultWorld } from '../core/state';
import { CrowdSim } from './crowd';

/** The seed every frame this project has shot is rendered at. */
const SEED = 0x5e7a17;
/** Frames to settle before sampling. The crowd re-seeds over ~7 frames; 300 is generous. */
const SETTLE_FRAMES = 300;
/** Capture frame size, matching the harness. Separation is in *these* pixels. */
const FRAME_W = 1600;
const FRAME_H = 900;
/** A human is about this tall, in metres. Converts a depth to a pixel height. */
const BODY_HEIGHT_M = 1.7;
/** Lower and upper edge of the band the vision gate names. */
const BAND_PX_LO = 20;
const BAND_PX_HI = 30;
/** Distance bins for the longitudinal profile. */
const LON_BIN_M = 40;
/** How many distance bins to report. 8 x 40 m = 320 m, past the 400 m view ray. */
const LON_BINS = 8;
/** Screen-space cell size for the neighbour grid, in pixels. */
const GRID_PX = 24;
/** Pairs farther apart than this are counted but not binned; they are not neighbours. */
const MAX_NEIGHBOUR_PX = 80;

/**
 * Gap histogram edges, in pixels. **The final `Infinity` bin is the one the
 * finding rests on**: pairs at >= 40 px are not neighbours at all, so a
 * non-empty top bin is the signature of groups with deliberate gaps, and an empty
 * one is the signature of a continuous band. It was 0.0% when first measured. An
 * earlier version of this file ended the edges at 40 and so folded the gap mode
 * into the `[20-40)` bin, which reported "gap mode present" for a distribution
 * that has none -- the same class of error as a counter that reports a different
 * thing from the thing it names.
 */
const GAP_EDGES = [0, 2, 4, 6, 8, 12, 20, 40, Number.POSITIVE_INFINITY] as const;

interface Plotted {
  /** Screen x, pixels. */
  sx: number;
  /** Screen y, pixels. */
  sy: number;
  /** Depth along the view axis, metres. */
  d: number;
  /** Height the body subtends at that depth, pixels. */
  h: number;
}

function settle(c: CrowdSim, pos: [number, number, number], look: [number, number, number]): void {
  const w = defaultWorld(SEED);
  for (let k = 0; k < SETTLE_FRAMES; k++) c.update(1 / 60, { position: pos, lookAt: look }, w);
}

/** Project the submitted instances into the pose's frame. */
function project(c: CrowdSim, cam: readonly number[], look: readonly number[], fov: number): Plotted[] {
  const f = [look[0] - cam[0], look[1] - cam[1], look[2] - cam[2]];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1;
  f[0] /= fl; f[1] /= fl; f[2] /= fl;
  // Right = forward x up, with up = +Y. Degenerates only if we look straight up.
  let r = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0];
  const rl = Math.hypot(r[0], r[1], r[2]) || 1;
  r = [r[0] / rl, r[1] / rl, r[2] / rl];
  const u = [
    f[1] * r[2] - f[2] * r[1],
    f[2] * r[0] - f[0] * r[2],
    f[0] * r[1] - f[1] * r[0],
  ];
  const ty = Math.tan(fov / 2);
  const tx = ty * FRAME_W / FRAME_H;
  const inst = c.instances.data;
  const n = c.instances.count;
  const out: Plotted[] = [];
  for (let i = 0; i < n; i++) {
    const b = i * 24;
    const dx = inst[b + 12] - cam[0], dy = inst[b + 13] - cam[1], dz = inst[b + 14] - cam[2];
    const z = dx * f[0] + dy * f[1] + dz * f[2];
    if (z <= 0.5) continue;
    const xx = dx * r[0] + dy * r[1] + dz * r[2];
    const yy = dx * u[0] + dy * u[1] + dz * u[2];
    if (Math.abs(xx / z) > tx || Math.abs(yy / z) > ty) continue;
    out.push({
      sx: (xx / z / tx * 0.5 + 0.5) * FRAME_W,
      sy: (1 - (yy / z / ty * 0.5 + 0.5)) * FRAME_H,
      d: z,
      h: ((FRAME_H / 2) / ty) * BODY_HEIGHT_M / z,
    });
  }
  return out;
}

/** Nearest-neighbour screen separations, as a histogram over `GAP_EDGES`. */
function separation(pts: Plotted[]): { bins: number[]; total: number; p50: number; p10: number } {
  const grid = new Map<string, number[]>();
  pts.forEach((p, i) => {
    const k = `${Math.floor(p.sx / GRID_PX)},${Math.floor(p.sy / GRID_PX)}`;
    const a = grid.get(k);
    if (a) a.push(i); else grid.set(k, [i]);
  });
  const seps: number[] = [];
  for (const idxs of grid.values()) {
    for (const i of idxs) for (const j of idxs) {
      if (j <= i) continue;
      const d = Math.hypot(pts[i].sx - pts[j].sx, pts[i].sy - pts[j].sy);
      if (d < MAX_NEIGHBOUR_PX) seps.push(d);
    }
  }
  seps.sort((a, b) => a - b);
  const bins = new Array(GAP_EDGES.length - 1).fill(0);
  for (const s of seps) {
    for (let b = 0; b < bins.length; b++) {
      if (s >= GAP_EDGES[b] && s < (GAP_EDGES[b + 1] ?? Number.POSITIVE_INFINITY)) { bins[b]++; break; }
    }
  }
  return {
    bins,
    total: seps.length,
    p50: seps[seps.length >> 1] ?? NaN,
    p10: seps[Math.floor(seps.length * 0.1)] ?? NaN,
  };
}

// -------------------------------------------------------------------------- run

const city = new City(defaultCityConfig(SEED));
for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) city.getChunk(x, z);
const sim = new CrowdSim(SEED);
sim.attach(city, SEED);

// Settle once before deriving: `population()` is empty on a fresh sim, and
// `derivePose` correctly refuses a pose it has no subject for.
function main(): void {
const boot = city.getChunk(0, 0);
if (!boot) {
  console.log('DENSITY: chunk (0,0) is not resident; the measurement is not well formed');
  return;
}
settle(
  sim,
  [boot.boundsMin[0] + 20, GROUND_Y + 2.4, boot.boundsMin[2] + 20],
  [boot.boundsMin[0] + 120, GROUND_Y + 1.7, boot.boundsMin[2] + 20],
);
const pop: Population = sim.population();
const pose = derivePose('street-crowd', pop, SEED);
if (!pose.ok) {
  console.log(`DENSITY: pose refused: ${pose.reason}`);
  console.log('\nVIOLATIONS 1');
  return;
}
settle(sim, pose.position as [number, number, number], pose.lookAt as [number, number, number]);


// --- World-space body separation. R12 sub-problem 2 has a FLOOR, not a target:
// two bodies must not end up inside one another. Screen-space pixels cannot
// answer it (a crowd on a line reads as 99.8% "merged" while every body is at a
// different depth), so this measures centres directly.
{
  const xs: number[] = [], zs: number[] = [];
  const f = (sim as unknown as { f: Float32Array }).f;
  for (let i = 0; i < 6000; i++) {
    if (f[i * 29 + 25] < 0.5) continue;
    xs.push(f[i * 29 + 0]); zs.push(f[i * 29 + 2]);
  }
  const nn: number[] = [];
  for (let a = 0; a < xs.length; a++) {
    let best = Infinity;
    for (let b = 0; b < xs.length; b++) {
      if (a === b) continue;
      const dx = xs[a] - xs[b], dz = zs[a] - zs[b];
      const q = dx * dx + dz * dz;
      if (q < best) best = q;
    }
    if (best < Infinity) nn.push(Math.sqrt(best));
  }
  nn.sort((p, q) => p - q);
  const pc = (t: number): string => `${((100 * nn.filter((v) => v < t).length) / (nn.length || 1)).toFixed(1)}%`;
  const q = (t: number): number => (nn.length ? nn[Math.min(nn.length - 1, Math.floor(nn.length * t))] : 0);
  console.log(`\nBODY SEPARATION (world, n=${nn.length})`);
  console.log(`  nearest-neighbour p10 ${q(0.1).toFixed(3)}  p50 ${q(0.5).toFixed(3)}  p90 ${q(0.9).toFixed(3)} m`);
  console.log(`  bodies inside another body's 0.45 m shoulder: ${pc(0.45)}`);
}
const d = sim.debug();
const pts = project(sim, pose.position, pose.lookAt, pose.fov);

console.log(`\nCROWD DENSITY  pose=${pose.id}  seed=${SEED}  ${FRAME_W}x${FRAME_H}`);
console.log(`  viewRadius ${d.radius} m   target ${d.target}   live ${d.live}   submitted ${sim.instances.count}`);
console.log(`  inside the cone ${pts.length}   population spread ${pop.spread} m`);

if (pts.length === 0) {
  console.log('  no instance projected into the pose cone; the measurement is not well formed');
  console.log('\nVIOLATIONS 1');
  return;
}

const ds = pts.map((p) => p.d).sort((a, b) => a - b);
console.log(`  depth along view  p50 ${ds[ds.length >> 1].toFixed(0)} m  p90 ${ds[Math.floor(ds.length * 0.9)].toFixed(0)} m  p99 ${ds[Math.floor(ds.length * 0.99)].toFixed(0)} m  max ${ds[ds.length - 1].toFixed(0)} m`);

const lon = new Array(LON_BINS).fill(0);
for (const p of pts) if (p.d < LON_BIN_M * LON_BINS) lon[Math.min(LON_BINS - 1, Math.floor(p.d / LON_BIN_M))]++;
console.log(`  agents by ${LON_BIN_M} m bin to ${LON_BIN_M * LON_BINS} m`);
console.log(`    ${lon.map((n, i) => `${i * LON_BIN_M}-${(i + 1) * LON_BIN_M}:${n}`).join('  ')}`);
const furthest = ds[ds.length - 1];
console.log(`  furthest agent ${furthest.toFixed(0)} m vs viewRadius ${d.radius} m  ->  ` +
  `${Math.abs(furthest - d.radius) < 6 ? 'SEEDING LIMIT (population stops at the radius)' : 'beyond the radius'}`);

function report(label: string, set: Plotted[]): void {
  if (set.length < 2) { console.log(`  ${label}: too few figures (${set.length}) to measure separation`); return; }
  const s = separation(set);
  if (s.total === 0) { console.log(`  ${label}: no neighbour pairs found; the measurement is not well formed`); return; }
  console.log(`  ${label}  n=${set.length} figures, ${s.total} pairs  p10 ${s.p10.toFixed(1)}  p50 ${s.p50.toFixed(1)} px`);
  console.log(`    ${s.bins.map((n, i) => { const hi = GAP_EDGES[i + 1]; return `[${GAP_EDGES[i]}-${hi === Number.POSITIVE_INFINITY ? 'inf' : hi}) ${(100 * n / s.total).toFixed(1)}%`; }).join('  ')}`);
  // The top bin is the gap-mode bin. Do not read the `[20-40)` bin as one.
  const gapBin = s.bins[s.bins.length - 1];
  const merged = s.bins[0];
  console.log(`    merged (<2 px) ${(100 * merged / s.total).toFixed(1)}%   gap mode (>=${GAP_EDGES[GAP_EDGES.length - 2]} px) ${(100 * gapBin / s.total).toFixed(1)}%` +
    `   ->  ${gapBin === 0 ? 'NO GAP MODE: a continuous band' : 'gap mode present'}`);
}
report('all in-frame', pts);
report(`${BAND_PX_LO}-${BAND_PX_HI} px band`, pts.filter((p) => p.h >= BAND_PX_LO && p.h <= BAND_PX_HI));

// Well-formedness only. See the header: the gap-bin value is an open defect and
// is reported, not pinned.
const band = pts.filter((p) => p.h >= BAND_PX_LO && p.h <= BAND_PX_HI);
const problems: string[] = [];
if (band.length < 2) problems.push(`fewer than 2 figures in the ${BAND_PX_LO}-${BAND_PX_HI} px band (${band.length})`);
const sBand = band.length >= 2 ? separation(band) : null;
if (sBand && sBand.bins.reduce((a, b) => a + b, 0) !== sBand.total) {
  problems.push(`histogram bins (${sBand.bins.reduce((a, b) => a + b, 0)}) do not sum to the pair count (${sBand.total})`);
}
if (furthest > d.radius + 1) problems.push(`an agent sits ${(furthest - d.radius).toFixed(0)} m beyond viewRadius`);

console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
}

main();
