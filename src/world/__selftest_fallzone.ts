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
  buildFallZone, footprintsOverlap, onFrame, patchAt, reachable, roadClear, toFrame,
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

function links(): void {
  console.log('\nLINKS & GROUND');
  for (const seed of SEEDS) {
    const z = buildFallZone(seed);
    const f = districtField(seed), plan = cityPlan(seed);
    const col = z.columns;
    // Off-limits: about a quarter of the deck band, sampled on a 12 m grid.
    let inBand = 0, inPatch = 0;
    for (let x = LO; x < HI; x += 12) {
      for (let q = LO; q < HI; q += 12) {
        if (beltBand(f, x, q) !== 1) continue;
        inBand++;
        if (patchAt(z, x, q)) inPatch++;
      }
    }
    const offShare = inPatch / Math.max(1, inBand);
    if (inBand > 0 && (offShare < 0.15 || offShare > 0.35)) fail(`seed ${seed}: off-limits covers ${(100 * offShare).toFixed(0)}% of the deck band`);
    for (const c of col) {
      if (c.offLimits !== !!patchAt(z, c.x, c.z)) fail(`seed ${seed}: column ${c.id} offLimits flag disagrees with the patches`);
      if (c.offLimits && c.access !== 'none') fail(`seed ${seed}: off-limits column ${c.id} has ground access (${c.access})`);
      if (!c.offLimits && c.access === 'none') fail(`seed ${seed}: open column ${c.id} has no way up`);
    }
    // Everyone can get home: ground access, then decks, bridges and ropeways.
    const seen = reachable(z);
    const stranded = col.filter((c) => !seen.has(c.id)).length;
    if (stranded > 0) fail(`seed ${seed}: ${stranded} columns cannot be reached from the ground`);
    // Spans: decks join grid-adjacent intact piers; bridges stay short; nothing passes through a third pile.
    for (const d of z.decks) {
      const a = col[d.a], b = col[d.b];
      const adj = a.node && b.node && Math.abs(a.node[0] - b.node[0]) + Math.abs(a.node[1] - b.node[1]) === 1;
      if (a.kind !== 'pier' || b.kind !== 'pier' || a.break !== 'intact' || b.break !== 'intact' || !adj) fail(`seed ${seed}: deck ${d.a}-${d.b} does not join adjacent intact piers`);
    }
    const spans: [number, number, number, number, number[]][] = [
      ...z.decks.map((d) => [col[d.a].x, col[d.a].z, col[d.b].x, col[d.b].z, [d.a, d.b]] as [number, number, number, number, number[]]),
      ...z.bridges.map((b) => [col[b.a].x, col[b.a].z, col[b.b].x, col[b.b].z, [b.a, b.b]] as [number, number, number, number, number[]]),
      ...z.ropeways.flatMap((rw) => rw.stations.slice(1).map((s, k) => {
        const p = rw.stations[k];
        return [p[0], p[2], s[0], s[2], k === 0 ? [rw.columns[0]] : [rw.columns[k - 1], rw.columns[k]]] as [number, number, number, number, number[]];
      })),
    ];
    let through = 0;
    for (const [ax, az, bx, bz, skip] of spans) {
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t <= len; t += 1) {
        const px = ax + ((bx - ax) * t) / len, pz = az + ((bz - az) * t) / len;
        const [pa, pb] = toFrame(z.gridX, z.gridZ, z.gridYaw, px, pz);
        const hitCol = col.find((c) => {
          if (skip.includes(c.id)) return false;
          const [ca, cb] = toFrame(z.gridX, z.gridZ, z.gridYaw, c.x, c.z);
          return Math.abs(pa - ca) < Math.max(c.halfX, c.pileHalfX) && Math.abs(pb - cb) < Math.max(c.halfZ, c.pileHalfZ);
        });
        if (hitCol) { through++; break; }
      }
    }
    if (through > 0) fail(`seed ${seed}: ${through} spans pass through a third pile`);
    const longBridges = z.bridges.filter((b) => {
      const a = col[b.a], c = col[b.b];
      return Math.hypot(a.x - c.x, a.z - c.z) > 160;
    }).length;
    if (longBridges > 0) fail(`seed ${seed}: ${longBridges} bridges span more than 160 m`);
    // Slabs keep off every carriageway but alleys, outside the fences.
    let onRoad = 0;
    for (const w of z.wreck) {
      if (w.kind !== 'slab' || patchAt(z, w.x, w.z)) continue;
      for (let u = -1; u <= 1; u += 0.25) {
        for (let v = -1; v <= 1; v += 0.25) {
          const [px, pz] = onFrame(w.x, w.z, w.yaw, u * w.halfX, v * w.halfZ * Math.cos(w.tilt));
          if (roadClear(plan, px, pz) < 0) { onRoad++; u = v = 2; }
        }
      }
    }
    if (onRoad > 0) fail(`seed ${seed}: ${onRoad} slabs lie on a street outside the fences`);
    const bodies = z.wreck.filter((w) => w.kind === 'body').length;
    if (bodies !== col.filter((c) => c.kind === 'spire').length) fail(`seed ${seed}: ${bodies} spire bodies for the spire stumps`);
    if (seed === DEFAULT_SEED) {
      const perPile = z.bridges.length / Math.max(1, col.length);
      console.log(`  default seed: ${z.patches.length} patches (${(100 * offShare).toFixed(0)}% of the deck band), `
        + `${z.wreck.length - bodies} slabs, ${bodies} bodies, ${z.decks.length} decks, ${z.bridges.length} bridges `
        + `(${perPile.toFixed(2)} per pile), ${z.ropeways.length} ropeways (${z.ropeways.map((rw) => rw.columns.length).join(', ')} stations)`);
      if (perPile < 0.5 || perPile > 1.5) fail(`${perPile.toFixed(2)} bridges per pile, not about one`);
      if (z.ropeways.length < 1) fail('no village ropeway');
      if (z.wreck.length - bodies < 15) fail(`only ${z.wreck.length - bodies} fallen slabs`);
    }
  }
}

belt();
columns();
links();

console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
// tsconfig carries no node types, so reach `process` through globalThis.
const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
if (problems.length > 0 && proc) proc.exitCode = 1;
