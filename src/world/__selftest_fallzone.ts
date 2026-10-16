/**
 * Fall zone (DESIGN §8, D33) standing measurements: the belt's bands, the
 * columns, their links and ground, the city around them, the greybox, the trams
 * and the foot traffic.
 *
 * Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
 * Prints a `VIOLATIONS` line; that line is the result. Exits 1 on any violation.
 */

import { beltBand, districtAtField, districtField } from './districts';
import { cityPlan, sampleStreetPlan, type StreetSample } from './citygen';

const DEFAULT_SEED = 0x5e7a17;
const LO = -1536, HI = 1792;
const problems: string[] = [];
const fail = (m: string): void => { problems.push(m); };
const sample = (): StreetSample => ({ dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 });

function belt(): void {
  console.log('\nBELT');
  const f = districtField(DEFAULT_SEED);
  let mismatch = 0, nearBand2 = 0, b1 = 0, b2 = 0;
  for (let x = LO; x < HI; x += 24) {
    for (let z = LO; z < HI; z += 24) {
      const b = beltBand(f, x, z);
      if ((b > 0) !== (districtAtField(f, x, z) === 5)) mismatch++;
      if (b === 1) b1++;
      if (b === 2) { b2++; if (Math.hypot(x, z) < 800) nearBand2++; }
    }
  }
  const km2 = (n: number): string => (n * 576 / 1e6).toFixed(2);
  console.log(`  deck band ${km2(b1)} km2, estates ${km2(b2)} km2`);
  if (mismatch > 0) fail(`${mismatch} samples where beltBand and districtAtField disagree on the belt`);
  // The estates widen only past r ~ 1 km (warped by up to ~150 m); band 2 any
  // closer means beltBand's copy of the belt threshold drifted from districtAtField's.
  if (nearBand2 > 0) fail(`${nearBand2} estate samples inside 800 m of the origin`);
  if (b1 * 576 < 0.2e6) fail(`deck band only ${km2(b1)} km2 at the default seed`);

  const plan = cityPlan(DEFAULT_SEED);
  const a = sample(), b = sample();
  let shrank = 0, differs = 0;
  for (let k = 0; k < 2000; k++) {
    const x = LO + ((k * 7919) % 3328), z = LO + ((k * 104729) % 3328);
    sampleStreetPlan(plan, x, z, a);
    sampleStreetPlan(plan, x, z, b, false);
    if (b.clearance < a.clearance - 1e-9) shrank++;
    if (a.kind !== 'alley' && Math.abs(a.clearance - b.clearance) > 1e-9) differs++;
  }
  if (shrank > 0) fail(`${shrank} samples where skipping alleys reduced clearance`);
  if (differs > 0) fail(`${differs} non-alley samples changed when alleys were skipped`);
}

belt();

console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
// tsconfig carries no node types, so reach `process` through globalThis.
const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
if (problems.length > 0 && proc) proc.exitCode = 1;
