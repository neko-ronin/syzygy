/**
 * Street-field distance check — the standing measurement for F5b.
 *
 * `sampleStreetPlan` used to evaluate the domain warp at the QUERY point, so
 * for the grid and alley families `out.dist` was the distance to a line whose
 * position depends on where you asked from. Measured before the fix, against
 * the bisected line (two independent methods that agreed):
 *
 *   |reported dist - true dist|  p50 0.71 m  p90 3.30 m  max 20.12 m
 *   reported-centreline miss     p50 0.71 m  p90 3.23 m  max 15.04 m
 *   resample-at-centreline       p50 0.71 m  p90 3.32 m  max 16.30 m
 *
 * After the fix (warp evaluated at the line by fixed-point iteration, plus the
 * perpendicular correction spineHit already applies): max 1.4 mm, p90 0.014 mm.
 *
 * Two documents were wrong about this defect and are corrected here, not in
 * the prose: HANDOFF F5b claims "a warp gradient of roughly 1.5 m per metre"
 * (measured p50 0.22, max 0.60), and the task brief claims kerb accuracy of
 * "p50 0.01 m / p90 1.00 m" (the suite measured p50 0.35 m / p90 2.89 m on the
 * same run as the 10.83..47.09 m carriageway line).
 *
 * Predictions recorded before the fix round (from the brief):
 *   P1: the fix reduces the distance error p50 by >5x.      (0.71 m -> ~0 mm)
 *   P2: the printed carriageway range moves off 10.83..47.09 m.
 *   P3: the kerb percentile check does not regress.
 * Verdicts are in the round report, not here: this file measures.
 *
 * This is a *measurement*, not a tight regression test. It prints the error
 * distribution and asserts only well-formedness (the probe found its subject,
 * the root finder converged) plus loose regression bounds that the pre-fix
 * field violates and the fixed field clears with 100x margin.
 *
 * Run: `npx vite-node src/world/__selftest_street.ts`
 */

import { fbm2, makeRng } from '../core/math';
import { cityPlan, sampleStreetPlan, type StreetSample } from './citygen';

/** The seed the citygen suite measures at. */
const SEED = 42;
const SAMPLES = 4000;

const plan = cityPlan(SEED);
const ox = plan.districts.ox, oz = plan.districts.oz;
const P = plan.gridPeriod, AP = plan.alleyPeriod;

// Replicas of the two warps inside `sampleStreetPlan` (deliberately
// re-derived, not imported: agreement between these and the field is what is
// being measured, and the bisection residual below guards the replica).
const warpGrid = (x: number, z: number): number =>
  320 * fbm2(x * 0.00082 + ox, z * 0.00082 + oz, 3);
const warpAlley = (x: number, z: number): number =>
  60 * fbm2(x * 0.0034 + ox + 31, z * 0.0034 + oz - 17, 2);

/** Bisection on a monotone `g`: independent of any fixed-point iteration. */
function bisect(g: (t: number) => number, lo: number, hi: number): number {
  let glo = g(lo);
  for (let i = 0; i < 80; i++) {
    const mid = 0.5 * (lo + hi);
    const gm = g(mid);
    if ((glo < 0) === (gm < 0)) { lo = mid; glo = gm; } else { hi = mid; }
  }
  return 0.5 * (lo + hi);
}

const pct = (xs: number[], p: number): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const f3 = (n: number): string => Number.isFinite(n) ? n.toFixed(3) : 'NaN';

function main(): void {
  const problems: string[] = [];
  const tmp: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };
  const tmp2: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };
  const rng = makeRng(1234);

  const distErr: number[] = [];   // |reported dist - true perpendicular dist|
  const resampleErr: number[] = []; // dist re-sampled at the reported centreline
  const lineMiss: number[] = [];  // reported centreline's miss of the true line
  let nStreet = 0, nAlley = 0, nOther = 0, maxResid = 0;

  for (let i = 0; i < SAMPLES; i++) {
    const x = rng.range(-1500, 1500), z = rng.range(-1500, 1500);
    sampleStreetPlan(plan, x, z, tmp);
    if (tmp.kind !== 'street' && tmp.kind !== 'alley') { nOther++; continue; }
    const isGrid = tmp.kind === 'street';
    if (isGrid) nStreet++; else nAlley++;

    // Method A: a reported centreline point must itself be at distance ~0.
    sampleStreetPlan(plan, tmp.px, tmp.pz, tmp2);
    resampleErr.push(tmp2.dist);

    // Method B: bisect the true line for the family the field selected
    // (u-family reports pz == z, v-family reports px == x), then compare
    // against the independently computed perpendicular distance.
    const warp = isGrid ? warpGrid : warpAlley;
    const per = isGrid ? P : AP;
    const wq = warp(x, z);
    const slopeAt = (wx: number, wz: number): [number, number] => [
      (warp(wx + 6, wz) - warp(wx - 6, wz)) / 12,
      (warp(wx, wz + 6) - warp(wx, wz - 6)) / 12,
    ];
    let truePerp: number; let miss: number;
    if (Math.abs(tmp.pz - z) < 1e-9) {
      const n = Math.round((x + wq) / per);
      const g = (X: number): number => X + warp(X, z) - n * per;
      const R = Math.abs((x + wq) - n * per) + 60;
      const Xstar = bisect(g, x - R, x + R);
      maxResid = Math.max(maxResid, Math.abs(g(Xstar)));
      const [wx, wz] = slopeAt(Xstar, z);
      const m = Math.abs(1 + wx) > 1e-3 ? -wz / (1 + wx) : -wz;
      truePerp = Math.abs(x - Xstar) / Math.sqrt(1 + m * m);
      miss = Math.abs((tmp.px + warp(tmp.px, z)) - n * per);
    } else {
      const n = Math.round((z + wq) / per);
      const g = (Z: number): number => Z + warp(x, Z) - n * per;
      const R = Math.abs((z + wq) - n * per) + 60;
      const Zstar = bisect(g, z - R, z + R);
      maxResid = Math.max(maxResid, Math.abs(g(Zstar)));
      const [wx, wz] = slopeAt(x, Zstar);
      const m = Math.abs(1 + wz) > 1e-3 ? -wx / (1 + wz) : -wx;
      truePerp = Math.abs(z - Zstar) / Math.sqrt(1 + m * m);
      miss = Math.abs((tmp.pz + warp(x, tmp.pz)) - n * per);
    }
    distErr.push(Math.abs(tmp.dist - truePerp));
    lineMiss.push(miss);
  }

  console.log(`\nSTREET DISTANCE  seed=${SEED} samples=${SAMPLES} (street=${nStreet} alley=${nAlley} other=${nOther})`);
  console.log(`  bisection self-check: max |g(root)| = ${maxResid.toExponential(2)} (known answer 0)`);
  console.log(`  |reported - true|   p50 ${f3(pct(distErr, 0.5))} m  p90 ${f3(pct(distErr, 0.9))} m  max ${f3(Math.max(...distErr))} m`);
  console.log(`  centreline miss     p50 ${f3(pct(lineMiss, 0.5))} m  p90 ${f3(pct(lineMiss, 0.9))} m  max ${f3(Math.max(...lineMiss))} m`);
  console.log(`  resample-at-centre  p50 ${f3(pct(resampleErr, 0.5))} m  p90 ${f3(pct(resampleErr, 0.9))} m  max ${f3(Math.max(...resampleErr))} m`);

  // Well-formedness first: the probe must have found its subject.
  if (nStreet + nAlley < SAMPLES * 0.5) problems.push(`only ${nStreet + nAlley}/${SAMPLES} grid/alley samples`);
  if (!(maxResid < 1e-6)) problems.push(`root finder did not converge (max residual ${maxResid.toExponential(2)})`);
  // Regression bounds: the pre-fix field measured p50 0.71 m on all three
  // lines, so these fail pre-fix and clear post-fix (max 1.4 mm) with margin.
  if (pct(distErr, 0.5) > 0.25) problems.push(`distance error p50 ${f3(pct(distErr, 0.5))} m exceeds 0.25 m`);
  if (pct(lineMiss, 0.5) > 0.25) problems.push(`centreline miss p50 ${f3(pct(lineMiss, 0.5))} m exceeds 0.25 m`);
  if (pct(resampleErr, 0.5) > 0.25) problems.push(`resample error p50 ${f3(pct(resampleErr, 0.5))} m exceeds 0.25 m`);

  console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);
}

main();
