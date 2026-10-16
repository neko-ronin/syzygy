/**
 * Fall zone (DESIGN §8, D33) standing measurements: the belt's bands, the
 * columns, their links and ground, the city around them, the greybox, the trams
 * and the foot traffic.
 *
 * Run: `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts`
 * Prints a `VIOLATIONS` line; that line is the result. Exits 1 on any violation.
 */

import { makeRng, type Vec3 } from '../core/math';
import { bakeGroundDetail } from '../render/groundbake';
import { beltBand, districtAtField, districtField } from './districts';
import { City, GROUND_Y, cityPlan, defaultCityConfig, footprintAabb, sampleStreetPlan, type StreetSample } from './citygen';
import {
  CORE_CLEAR, FALL_FOOT, PIER_PITCH, PIER_SHIFT, SHAFT_CLEAR,
  buildFallZone, fallFoot, fallZone, footprintsOverlap, onFrame, patchAt, reachable, roadClear, toFrame,
} from './fallzone';
import { MeshBuilder } from './geometry';
import { buildRailLines, tramTrack } from './networks';
import { pushOrientedBox, yawTiltBasis } from '../render/fallmesh';
import { bakeChunk } from '../render/citymesh';

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

function cityBlock(): void {
  console.log('\nCITY');
  const seed = DEFAULT_SEED, z = fallZone(seed), city = new City(defaultCityConfig(seed));
  const colCount = new Map<number, number>(), wreckCount = new Map<number, number>();
  let decks = 0, bridges = 0, stations = 0, buildings = 0, overShaft = 0, underPile = 0, onStation = 0, underCable = 0;
  const cables: { a: Vec3; b: Vec3 }[] = z.ropeways.flatMap((rw) => rw.stations.slice(1).map((b, k) => ({ a: rw.stations[k], b })));
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) {
      const ch = city.getChunk(cx, cz);
      if (!ch) continue;
      for (const c of ch.fall.columns) colCount.set(c.id, (colCount.get(c.id) ?? 0) + 1);
      for (const w of ch.fall.wreck) { const k = z.wreck.indexOf(w); wreckCount.set(k, (wreckCount.get(k) ?? 0) + 1); }
      decks += ch.fall.decks.length; bridges += ch.fall.bridges.length; stations += ch.fall.stations.length;
      for (const b of ch.buildings) {
        buildings++;
        const [lo, hi] = footprintAabb(b);
        for (const c of z.columns) {
          // Distance from the column's centre to the footprint: under the shaft's (or the
          // pile's) inscribed half-width means they certainly overlap.
          const gap = Math.hypot(Math.max(lo[0] - c.x, 0, c.x - hi[0]), Math.max(lo[2] - c.z, 0, c.z - hi[2]));
          if (gap < Math.min(c.halfX, c.halfZ)) overShaft++;
          if (b.aabbMax[1] > c.pileBase && gap < Math.min(c.pileHalfX, c.pileHalfZ)) underPile++;
        }
        for (const rw of z.ropeways) {
          const g = rw.stations[0];
          if (g[0] > lo[0] - 3 && g[0] < hi[0] + 3 && g[2] > lo[2] - 3 && g[2] < hi[2] + 3) onStation++;
        }
        for (const { a, b: e } of cables) {
          const len = Math.hypot(e[0] - a[0], e[2] - a[2]);
          for (let t = 0; t <= len; t += 2) {
            const px = a[0] + ((e[0] - a[0]) * t) / len, pz = a[2] + ((e[2] - a[2]) * t) / len;
            const py = a[1] + ((e[1] - a[1]) * t) / len - len * 0.04;
            if (px > lo[0] && px < hi[0] && pz > lo[2] && pz < hi[2] && b.aabbMax[1] > py) { underCable++; break; }
          }
        }
      }
    }
  }
  // Items anchored outside the city's chunks (a pier shifted past the edge, a
  // station found beyond it) are baked by no chunk, by design.
  const inCity = (x: number, q: number): boolean => x >= LO && x < HI && q >= LO && q < HI;
  const col = z.columns;
  const midIn = (a: number, b: number): boolean => inCity((col[a].x + col[b].x) / 2, (col[a].z + col[b].z) / 2);
  const missCol = col.filter((c) => inCity(c.x, c.z) && colCount.get(c.id) !== 1).length;
  const missWreck = z.wreck.filter((w, k) => inCity(w.x, w.z) && wreckCount.get(k) !== 1).length;
  const wantDecks = z.decks.filter((d) => midIn(d.a, d.b)).length;
  const wantBridges = z.bridges.filter((b) => midIn(b.a, b.b)).length;
  const wantStations = z.ropeways.filter((rw) => inCity(rw.stations[0][0], rw.stations[0][2])).length;
  console.log(`  ${buildings} buildings stand; chunks carry ${colCount.size} columns, ${wreckCount.size} wreck pieces, ${decks} decks, ${bridges} bridges, ${stations} stations`);
  if (missCol > 0) fail(`${missCol} columns are baked by zero or several chunks`);
  if (missWreck > 0) fail(`${missWreck} wreck pieces are baked by zero or several chunks`);
  if (decks !== wantDecks) fail(`chunks carry ${decks} decks of ${wantDecks}`);
  if (bridges !== wantBridges) fail(`chunks carry ${bridges} bridges of ${wantBridges}`);
  if (stations !== wantStations) fail(`chunks carry ${stations} ropeway stations of ${wantStations}`);
  if (overShaft > 0) fail(`${overShaft} old buildings still stand on a column's shaft`);
  if (underPile > 0) fail(`${underPile} old buildings rise into a village pile`);
  if (onStation > 0) fail(`${onStation} old buildings stand on a ropeway ground station`);
  if (underCable > 0) fail(`${underCable} old buildings rise through a ropeway cable`);
}

function greybox(): void {
  console.log('\nGREYBOX');
  // Every face of a yawed, tilted box winds outward (PITFALLS §34 is what happens otherwise).
  let inward = 0;
  for (let k = 0; k < 24; k++) {
    const c: Vec3 = [k, 3, -k];
    const mb = new MeshBuilder();
    pushOrientedBox(mb, c, ...yawTiltBasis(k * 0.7, (k % 6) * 0.11), [5, 1.2, 3], [0.5, 0.5, 0.5]);
    const m = mb.build();
    for (let i = 0; i < m.indexCount; i += 3) {
      const v = [0, 1, 2].map((q) => { const o = m.indices[i + q] * 3; return [m.positions[o], m.positions[o + 1], m.positions[o + 2]]; });
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const out = [0, 1, 2].map((a) => (v[0][a] + v[1][a] + v[2][a]) / 3 - c[a]);
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] <= 0) inward++;
    }
  }
  if (inward > 0) fail(`${inward} greybox triangles wind into their box`);

  // Every column, wreck piece, patch and station a chunk bakes registers its crowd obstacle.
  const seed = DEFAULT_SEED, city = new City(defaultCityConfig(seed));
  let want = 0, got = 0, chunks = 0;
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) {
      const ch = city.getChunk(cx, cz);
      if (!ch) continue;
      const n = ch.fall.columns.length + ch.fall.wreck.length + ch.fall.patches.length + ch.fall.stations.length;
      if (n === 0) continue;
      chunks++;
      want += n;
      got += bakeChunk(ch, 0, seed).obstacles.filter((o) => o.kind.startsWith('fall-') || o.kind.startsWith('off-limits-')).length;
    }
  }
  console.log(`  ${chunks} chunks bake fall-zone items; ${got}/${want} obstacles`);
  if (got !== want) fail(`${want - got} fall-zone items registered no crowd obstacle`);
}

belt();
columns();
links();
function trams(): void {
  console.log('\nTRAMS & ROPEWAYS');
  for (const seed of SEEDS) {
    const f = districtField(seed), plan = cityPlan(seed);
    const lines = tramTrack(plan, seed);
    const inside = lines.reduce((s, pts) => s + pts.filter((p) => beltBand(f, p[0], p[2]) > 0).length, 0);
    if (inside > 0) fail(`seed ${seed}: ${inside} tram points run through the industrial belt`);
    if (seed === DEFAULT_SEED) console.log(`  default seed: ${lines.length} tram lines, ${lines.map((p) => p.length).join(' + ')} points`);
  }
  const city = new City(defaultCityConfig(DEFAULT_SEED));
  const rails = buildRailLines(city, DEFAULT_SEED);
  const ropeLines = rails.filter((l) => l.kind === 'cablecar' && l.districtId === 5).length;
  const want = fallZone(DEFAULT_SEED).ropeways.length;
  console.log(`  ${rails.length} rail lines, ${ropeLines} of them village ropeways`);
  if (ropeLines !== want) fail(`${ropeLines} ropeway lines for ${want} village ropeways`);
}

function foot(): void {
  console.log('\nFOOT TRAFFIC & COMMERCE');
  const f = districtField(DEFAULT_SEED), plan = cityPlan(DEFAULT_SEED);
  let inBelt = 0, keptIn = 0, offBelt = 0, keptOff = 0;
  for (let k = 0; k < 20000; k++) {
    const x = LO + ((k * 7919) % 3328), z = LO + ((k * 104729) % 3328);
    const ok = fallFoot(f, x, z, k);
    if (beltBand(f, x, z) > 0) { inBelt++; if (ok) keptIn++; } else { offBelt++; if (ok) keptOff++; }
  }
  const share = keptIn / Math.max(1, inBelt);
  console.log(`  seats kept: ${(100 * share).toFixed(1)}% in the belt (${inBelt} samples), ${keptOff}/${offBelt} off it`);
  if (keptOff !== offBelt) fail(`${offBelt - keptOff} seats refused off the belt`);
  if (Math.abs(share - FALL_FOOT) > 0.03) fail(`belt seats kept ${(100 * share).toFixed(1)}%, not ~${100 * FALL_FOOT}%`);
  // Street islands (cafes, planters, benches) keep out of the zone.
  const city = new City(defaultCityConfig(DEFAULT_SEED));
  let islands = 0, inZone = 0;
  for (let cx = -6; cx <= 6; cx++) {
    for (let cz = -6; cz <= 6; cz++) {
      const ch = city.getChunk(cx, cz);
      if (!ch || ch.fall.columns.length === 0) continue;
      const g = bakeGroundDetail(new MeshBuilder(), ch, plan, 0, makeRng(1), []);
      islands += g.streetIslands.length;
      inZone += g.streetIslands.filter((s) => beltBand(f, s.x, s.z) > 0).length;
    }
  }
  console.log(`  ${islands} street islands on the zone's chunks, ${inZone} inside the belt`);
  if (inZone > 0) fail(`${inZone} street islands stand in the industrial belt`);
}

cityBlock();
greybox();
trams();
foot();

console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
for (const p of problems) console.log(`  - ${p}`);
// tsconfig carries no node types, so reach `process` through globalThis.
const proc = (globalThis as unknown as { process?: { exitCode?: number } }).process;
if (problems.length > 0 && proc) proc.exitCode = 1;
