/**
 * Fall zone (DESIGN §8, D33) standing measurements: the belt's bands, the
 * columns, their links and ground, the city around them, the greybox, the trams
 * and the foot traffic.
 *
 * Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
 * Prints a `VIOLATIONS` line; that line is the result. Exits 1 on any violation.
 */

import { beltBand, districtAtField, districtField } from './districts';
import { GROUND_Y, cityPlan, sampleStreetPlan, type StreetSample } from './citygen';
import {
  CORE_CLEAR, PIER_PITCH, PIER_SHIFT, SHAFT_CLEAR,
  buildFallZone, footprintsOverlap, onFrame, roadClear,
} from './fallzone';

const DEFAULT_SEED = 0x5e7a17;
const SEEDS = [DEFAULT_SEED, 42, 7, 13, 99, 1234, 31337, 0xbeef];
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

function columns(): void {
  console.log('\nCOLUMNS');
  for (const seed of SEEDS) {
    const t0 = performance.now();
    const z = buildFallZone(seed);
    const ms = performance.now() - t0;
    if (JSON.stringify(z) !== JSON.stringify(buildFallZone(seed))) fail(`seed ${seed}: two builds of the fall zone differ`);
    // Every bake worker builds the zone once at boot: keep it cheap.
    if (seed === DEFAULT_SEED) console.log(`  default seed builds in ${ms.toFixed(0)} ms`);
    if (seed === DEFAULT_SEED && ms > 1500) fail(`the fall zone takes ${ms.toFixed(0)} ms to build`);
    const f = districtField(seed), plan = cityPlan(seed);
    const by = new Map<string, number>();
    for (const c of z.columns) by.set(c.kind, (by.get(c.kind) ?? 0) + 1);
    const n = z.columns.length;
    const share = (k: string): number => (by.get(k) ?? 0) / Math.max(1, n);
    console.log(`  seed ${seed.toString(16).padStart(6)}: ${String(n).padStart(3)} columns  `
      + ['pier', 'core', 'silo', 'stack', 'lattice', 'spire'].map((k) => `${k} ${by.get(k) ?? 0}`).join('  '));
    z.columns.forEach((c, i) => { if (c.id !== i) fail(`seed ${seed}: column ${i} carries id ${c.id}`); });
    for (const c of z.columns) {
      const band = beltBand(f, c.x, c.z);
      if (band !== (c.kind === 'core' ? 2 : 1)) fail(`seed ${seed}: ${c.kind} ${c.id} stands in belt band ${band}`);
      const need = c.kind === 'core' ? CORE_CLEAR : c.kind === 'spire' ? c.halfX + 2 : SHAFT_CLEAR;
      const clear = roadClear(plan, c.x, c.z);
      if (clear < need - 1e-6) fail(`seed ${seed}: ${c.kind} ${c.id} stands ${clear.toFixed(1)} m from a road edge (needs ${need.toFixed(1)})`);
      if (c.node) {
        const [nx, nz] = onFrame(z.gridX, z.gridZ, z.gridYaw, c.node[0] * PIER_PITCH, c.node[1] * PIER_PITCH);
        const off = Math.hypot(c.x - nx, c.z - nz);
        if (off > PIER_SHIFT + 1e-6) fail(`seed ${seed}: ${c.kind} ${c.id} is ${off.toFixed(1)} m off its grid node`);
      }
      if (c.kind === 'pier' && c.top > z.deckY + 1e-6) fail(`seed ${seed}: pier ${c.id} rises above the deck`);
      if (c.kind === 'pier' && c.break === 'intact' && Math.abs(c.top - z.deckY) > 1e-6) fail(`seed ${seed}: intact pier ${c.id} is not at deck level`);
      if (c.pileTop - GROUND_Y > 230 || c.pileBase >= c.pileTop) fail(`seed ${seed}: ${c.kind} ${c.id} pile ${c.pileBase.toFixed(0)}-${c.pileTop.toFixed(0)} m is out of range`);
    }
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (footprintsOverlap(z, z.columns[a], z.columns[b], 0)) fail(`seed ${seed}: columns ${a} and ${b} overlap`);
      }
    }
    if (new Set(z.columns.map((c) => c.seed)).size !== n) fail(`seed ${seed}: two columns share a seed`);
    const spires = by.get('spire') ?? 0, deckSites = n - (by.get('core') ?? 0);
    if (spires > 5 || (deckSites >= 100 && spires < 3) || (deckSites >= 40 && spires < 1)) {
      fail(`seed ${seed}: ${spires} spire stumps for ${deckSites} deck-grid columns`);
    }
    if (seed !== DEFAULT_SEED) continue;
    if (share('pier') < 0.5) fail(`piers are ${(100 * share('pier')).toFixed(0)}% of columns, not most`);
    if (share('core') < 0.05) fail(`stripped cores are only ${(100 * share('core')).toFixed(0)}%`);
    if (share('silo') + share('stack') < 0.03) fail('almost no silos or stacks');
    if (share('lattice') < 0.03) fail('almost no lattice legs');
    const tops = z.columns.filter((c) => c.kind !== 'silo' && c.kind !== 'stack')
      .map((c) => c.pileTop - GROUND_Y).sort((p, q) => p - q);
    const med = tops[tops.length >> 1];
    console.log(`  village tops: median ${med.toFixed(0)} m, ${tops[0].toFixed(0)}-${tops[tops.length - 1].toFixed(0)} m`);
    if (med < 75 || med > 185) fail(`median village top ${med.toFixed(0)} m is outside 75-185 m`);
    const broken = z.columns.filter((c) => c.kind === 'pier' && c.break !== 'intact').map((c) => c.top);
    const mean = broken.reduce((s, v) => s + v, 0) / broken.length;
    const sd = Math.sqrt(broken.reduce((s, v) => s + (v - mean) ** 2, 0) / broken.length);
    if (sd < 15) fail(`broken pier tops vary by only ${sd.toFixed(1)} m: the forest reads as one height`);
  }
}

belt();
columns();

console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
// tsconfig carries no node types, so reach `process` through globalThis.
const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
if (problems.length > 0 && proc) proc.exitCode = 1;
