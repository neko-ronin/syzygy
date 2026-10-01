/**
 * Headless self-check for the market grammar and its bake.
 *
 * Runs at a fixed seed and prints the numbers that were asked for — element
 * counts, triangles contributed, the LOD ladder — and asserts the invariants
 * that cannot be read off the source: that a stall is never inside a building,
 * that the canopy really does overhang the carriageway, that the two runs are
 * byte-identical, and that the light cap holds.
 *
 * Prints a `VIOLATIONS` line, like the city self-test. That line is the result.
 */

import { makeRng } from '../core/math';
import { City, defaultCityConfig, cityPlan, GROUND_Y } from './citygen';
import { MARKET_DISTRICT, spineHit, type SpineHit } from './districts';
import { MeshBuilder } from './geometry';
import { groundGrammarFor, type GroundBakeCtx, type StreetFrame } from './groundgrammar';
import { bakeMarketDetail } from '../render/marketbake';
import { bakeChunk } from '../render/citymesh';
import {
  CLOTH_EVERY_STRING, COOKING_EVERY, GAP_MAX_M, GAP_MIN_M, LANTERN_LIGHT_INTENSITY,
  LANTERN_LIGHT_RADIUS, MARKET_LOD_GONE, MAX_MARKET_LIGHTS_PER_CHUNK,
  PITCH_MAX, PITCH_MIN, PITCH_NOISE_SCALE, RIDGE_MAX, RUN_MAX_M, RUN_MIN_M,
  SAG_ACROSS, SAG_ALONG, SIGN_EVERY, STALL_SEPARATION, STRING_ANCHOR_MAX,
  marketCatenary, marketGrammarFor, type MarketQuery, type MarketStall,
} from './marketgrammar';

const SEED = 42;
/** How far out to look for chunks the market spine crosses. */
const SEARCH_R = 1400;
/** Chunks that actually contain market content, for the summary. */
const SAMPLE = 6;

const violations: string[] = [];
const fail = (m: string): void => { violations.push(m); };

// ---------------------------------------------------------------- scaffolding

const city = new City(defaultCityConfig(SEED));
const plan = cityPlan(SEED);

const scratch: SpineHit = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 };

const frame: StreetFrame = {
  lateral: 0, along: 0, tx: 0, tz: 1, nx: -1, nz: 0,
  width: plan.districts.market.width, kind: 'market',
  districtId: MARKET_DISTRICT, clearance: -1, px: 0, pz: 0,
};

const queryFor = (chunk: { cx: number; cz: number }): MarketQuery => ({
  seed: SEED, plan, chunk: chunk as MarketQuery['chunk'], kind: 'market',
  districtId: MARKET_DISTRICT,
});

/** A bake context for one chunk at one LOD, into its own builder. */
function bakeChunkMarket(chunk: MarketQuery['chunk'], lod: number): { tris: number; bld: MeshBuilder } {
  const bld = new MeshBuilder();
  const ctx: GroundBakeCtx = {
    builder: bld, rng: makeRng(SEED ^ 0x5eed), plan, chunk, lod, seed: SEED, frame,
    grammar: groundGrammarFor(MARKET_DISTRICT, 'market'),
  };
  bakeMarketDetail(bld, ctx);
  return { tris: bld.triangleCount, bld };
}

/** Point-in-building test over the stall's footprint, sampled on the deck. */
function insideBuildings(chunk: MarketQuery['chunk'], s: MarketStall): number {
  let hits = 0;
  const lo = Math.min(s.front, s.back), hi = Math.max(s.front, s.back);
  for (let i = 0; i <= 6; i++) {
    for (let j = 0; j <= 4; j++) {
      const u = (i / 6 - 0.5) * s.pitch;
      const lat = lo + (hi - lo) * (j / 4);
      const x = s.cx + s.nx * lat + s.tx * u;
      const z = s.cz + s.nz * lat + s.tz * u;
      for (const b of chunk.buildings) {
        if (x > b.aabbMin[0] && x < b.aabbMax[0] && z > b.aabbMin[2] && z < b.aabbMax[2]) {
          hits++;
          break;
        }
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------- 1. counts

const chunks = city.chunksInRadius([0, 0, 0], SEARCH_R);
const marketChunks = chunks.filter((c) => marketGrammarFor(queryFor(c)).stats.stalls > 0);
const offMarket = chunks.filter((c) => marketGrammarFor(queryFor(c)).stats.stalls === 0);

console.log(`market self-test — seed ${SEED}, ${chunks.length} chunks within ${SEARCH_R} m`);
console.log(`  market spine: width ${plan.districts.market.width.toFixed(1)} m, amp ${plan.districts.market.amp.toFixed(0)} m, freq ${plan.districts.market.freq.toFixed(5)}`);

if (marketChunks.length === 0) fail('no chunk in range produced a single stall');
if (offMarket.length === 0) fail('every chunk produced a stall — the guard is not working');

console.log(`\nchunks with market content: ${marketChunks.length} of ${chunks.length}`);
console.log(' cx   cz   metres  slots stalls gaps rej  crates signs vents  cords lanterns lights');

let totStalls = 0, totCrates = 0, totSigns = 0, totVents = 0, totStrings = 0, totLanterns = 0, totLights = 0;
let allTris: number[] = [];
let chunkTris: number[] = [];
let worstShare = 0, worstShareTris = 0;
for (const c of marketChunks) {
  const d = marketGrammarFor(queryFor(c));
  const s = d.stats;
  const m = bakeChunkMarket(c, 0);
  const full = bakeChunk(c, 0, SEED);
  allTris.push(m.tris);
  chunkTris.push(full.triangleCount);
  if (m.tris > worstShareTris) { worstShareTris = m.tris; worstShare = m.tris / Math.max(1, full.triangleCount); }
  totStalls += s.stalls; totCrates += s.crates; totSigns += s.signs; totVents += s.vents;
  totStrings += s.lanternStrings; totLanterns += s.lanterns; totLights += s.lights;
  if (s.lights > MAX_MARKET_LIGHTS_PER_CHUNK) {
    fail(`chunk ${c.cx},${c.cz}: ${s.lights} market lights, cap is ${MAX_MARKET_LIGHTS_PER_CHUNK}`);
  }
  // Density is bounded by the constants, not by taste: the loosest row the
  // grammar can emit is one stall per PITCH_MAX per kerb, and the tightest is
  // one per PITCH_MIN. Both sides are counted, so the band doubles.
  const dens = s.metres > 0 ? s.stalls / s.metres : 0;
  if (s.metres > 0 && dens < 2 / (PITCH_MAX + STALL_SEPARATION) * 0.55) {
    fail(`chunk ${c.cx},${c.cz}: ${dens.toFixed(2)} stalls/m over ${s.metres.toFixed(0)} m — sparser than the loosest row the constants allow`);
  }
  if (dens > 2 / (PITCH_MIN + STALL_SEPARATION) * 0.85) {
    fail(`chunk ${c.cx},${c.cz}: ${dens.toFixed(2)} stalls/m — a continuous wall of tarps, not a market`);
  }
  if (s.stalls + s.gaps + s.rejected !== s.slots) {
    fail(`chunk ${c.cx},${c.cz}: stalls+gaps+rejected (${s.stalls + s.gaps + s.rejected}) != slots (${s.slots})`);
  }
  console.log(
    `${String(c.cx).padStart(3)} ${String(c.cz).padStart(4)}  ${s.metres.toFixed(0).padStart(6)}` +
    ` ${String(s.slots).padStart(6)} ${String(s.stalls).padStart(6)} ${String(s.gaps).padStart(4)} ${String(s.rejected).padStart(3)}` +
    ` ${String(s.crates).padStart(7)} ${String(s.signs).padStart(5)} ${String(s.vents).padStart(5)}` +
    ` ${String(s.lanternStrings).padStart(6)} ${String(s.lanterns).padStart(8)} ${String(s.lights).padStart(6)}`,
  );
}

// ---------------------------------------------------------------- 2. triangles

const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sample = marketChunks.slice(0, SAMPLE);

console.log(`\ntriangles, market chunks only (${marketChunks.length} of them), lod 0`);
console.log(' cx   cz   market   chunk-at-lod0   share');
for (const c of sample) {
  const t = bakeChunkMarket(c, 0).tris;
  const full = bakeChunk(c, 0, SEED).triangleCount;
  console.log(
    `${String(c.cx).padStart(3)} ${String(c.cz).padStart(4)}  ${String(t).padStart(7)}` +
    `  ${String(full).padStart(13)}   ${(100 * t / Math.max(1, full)).toFixed(1).padStart(5)}%`,
  );
}

// Control: what the same bake costs on a chunk the market never touches. This
// is a different chunk, not the same one with the market removed, so it is a
// baseline for the neighbourhood and not a subtraction — the delta below is the
// market's own measured triangle count.
const offSample = offMarket.slice(0, SAMPLE);
const offTris = offSample.map((c) => bakeChunk(c, 0, SEED).triangleCount);

const lod0 = sample.map((c) => bakeChunkMarket(c, 0).tris);
const lod1 = sample.map((c) => bakeChunkMarket(c, 1).tris);
const lod2 = sample.map((c) => bakeChunkMarket(c, 2).tris);
console.log(`  market tris/chunk   lod0 ${avg(lod0).toFixed(0)}  lod1 ${avg(lod1).toFixed(0)}  lod2 ${avg(lod2).toFixed(0)}`);
console.log(`  dropped lod0->lod1  ${(100 * (1 - avg(lod1) / Math.max(1, avg(lod0)))).toFixed(1)}%  (crates, rigging, vents)`);
console.log(`  chunk tris          lod0 mean ${avg(chunkTris).toFixed(0)} over ${chunkTris.length} market chunks, max ${Math.max(...chunkTris)}`);
console.log(`  worst single chunk  ${worstShareTris} tris = ${(100 * worstShare).toFixed(1)}% of that chunk`);
console.log(`  control             off-market chunks lod0 mean ${avg(offTris).toFixed(0)} over ${offTris.length} chunks`);
console.log(`  delta               +${avg(lod0).toFixed(0)} tris on a market chunk, ${(100 * avg(lod0) / Math.max(1, avg(offTris))).toFixed(1)}% of that baseline`);

if (lod2.some((t) => t !== 0)) fail(`lod ${MARKET_LOD_GONE} emitted geometry: ${lod2.join(', ')} tris`);
if (!lod1.every((t, i) => t > 0 && t < lod0[i])) fail('lod1 must keep some market geometry and drop some');

// ---------------------------------------------------------------- 3. invariants

const any = marketGrammarFor(queryFor(marketChunks[0]));
const allStalls: MarketStall[] = [];
let stallsSeen = 0;
for (const c of marketChunks) {
  const d = marketGrammarFor(queryFor(c));
  for (const s of d.stalls) allStalls.push(s);
  stallsSeen += d.stats.stalls;
}
if (allStalls.length !== stallsSeen) fail('stall collection disagrees with the stats counter');

const half = plan.districts.market.width * 0.5;
const pMin = Math.min(...allStalls.map((s) => s.pitch));
const pMax = Math.max(...allStalls.map((s) => s.pitch));
// Module-aware, and deliberately so. A `lean-to` does not overhang the
// carriageway — that is what a lean-to is — and a `bare` stall has no roof at
// all, so demanding a 1.9 m eave of it tests nothing. These two assertions were
// written when every stall was a pitched tarpaulin and they caught real faults;
// what has changed is the vocabulary, not the intent.
let noOverhang = 0, wrongSide = 0, sunk = 0, negative = 0, tooTall = 0, roofless = 0;
for (const s of allStalls) {
  if (s.module !== 'lean-to' && Math.abs(s.front) >= half) noOverhang++;
  if (Math.sign(s.back) !== Math.sign(s.front) || Math.abs(s.back) <= Math.abs(s.front)) wrongSide++;
  if (!s.hasCloth) roofless++;
  else if (s.eave < 1.9 || s.ridge <= s.eave) tooTall++;
  if (s.eave < 0) negative++;
}
for (const c of marketChunks) {
  for (const s of marketGrammarFor(queryFor(c)).stalls) sunk += insideBuildings(c, s);
}
const gapFrac = marketChunks.reduce((a, c) => {
  const s = marketGrammarFor(queryFor(c)).stats;
  return a + s.gaps;
}, 0) / Math.max(1, marketChunks.reduce((a, c) => a + marketGrammarFor(queryFor(c)).stats.slots, 0));
const sides = [0, 0];
for (const s of allStalls) sides[s.side > 0 ? 0 : 1]++;

// Canopy and sign variety. `docs/STREET_SPEC.md`'s last section is a warning
// about precisely this: "Identical cracks, evenly spaced props and repeated
// canopy modules can fill the empty ground while destroying the references'
// large value groups". A grammar that emits one module type is the failure it
// names, so the mix is measured rather than assumed.
const panels3 = allStalls.filter((s) => s.panels === 3).length;
const panels5 = allStalls.filter((s) => s.panels === 5).length;
const poles = allStalls.filter((s) => s.frame === 'poles').length;
const wallTied = allStalls.filter((s) => s.frame === 'wall-tied').length;
const allSigns = marketChunks.flatMap((c) => marketGrammarFor(queryFor(c)).stalls.map((s) => s.sign));
const signPanels = allSigns.filter((g) => g !== null && g.shape === 'panel').length;
const signBands = allSigns.filter((g) => g !== null && g.shape === 'band').length;
const allCloth = marketChunks.flatMap((c) => marketGrammarFor(queryFor(c)).cloth);
const pennants = allCloth.filter((c) => c.shape === 'pennant').length;

// Light spread. The first version lit in walk order and stopped at the cap,
// which put every lit lantern in the opening stretch of the chunk. The
// cheapest way to see that class of fault is to ask whether the last quarter
// of the cords has any light on it at all.
const spread = marketChunks.slice(0, 6).map((c) => {
  const d = marketGrammarFor(queryFor(c));
  const lit = d.strings.map((x) => x.lanterns.filter((l) => l.light).length);
  return {
    litTotal: lit.reduce((x, y) => x + y, 0),
    head: lit.slice(0, Math.max(1, Math.floor(lit.length * 0.25))).reduce((x, y) => x + y, 0),
    tail: lit.slice(Math.floor(lit.length * 0.75)).reduce((x, y) => x + y, 0),
    cords: d.strings.length,
  };
});
const litAll = spread.reduce((a, s) => a + s.litTotal, 0);
// An even spread puts roughly a quarter of the lit lanterns on the last quarter
// of the cords. Lighting in walk order puts almost none.
const tailShare = spread.reduce((a, s) => a + s.tail, 0) / Math.max(1, litAll);

// ---------------------------------------------------------------- variety
//
// REVIEW GATE 1: "similar pitched roofs and rectangular counters form long,
// mechanically regular sequences; the street's left-edge orange/grey forms merge
// into a fence-like band". Measured before, over 24 consecutive stalls on one
// kerb: eave spread 0.334 m, ridge spread 0.533 m, 2 distinct cloth colours
// (both the same orange hue), longest gapless run 15 stalls.
const variety = marketChunks.flatMap((c) => marketGrammarFor(queryFor(c)).stalls);
const modules = new Map<string, number>();
for (const s of variety) modules.set(s.module, (modules.get(s.module) ?? 0) + 1);

const kerb = variety.filter((s) => s.side > 0).sort((a, b) => a.along - b.along);
const window24 = kerb.slice(0, 24);
const eaveSpread = window24.length > 1
  ? Math.max(...window24.map((s) => s.eave)) - Math.min(...window24.map((s) => s.eave)) : 0;
const ridgeSpread = window24.length > 1
  ? Math.max(...window24.map((s) => s.ridge)) - Math.min(...window24.map((s) => s.ridge)) : 0;
const clothColours = new Set(
  window24.map((s) => s.cloth.map((v) => v.toFixed(3)).join(',')),
);
const clothModules = new Set(window24.map((s) => s.module));

let runNow = 1;
let longestRun = 1;
for (let i = 1; i < kerb.length; i++) {
  if (Math.abs(kerb[i].along - kerb[i - 1].along) < kerb[i].pitch * 1.9) runNow++;
  else { if (runNow > longestRun) longestRun = runNow; runNow = 1; }
}
if (runNow > longestRun) longestRun = runNow;

const fatigueGaps = marketChunks.reduce((a, c) => a + marketGrammarFor(queryFor(c)).stats.fatigueGaps, 0);

console.log(`\nvariety — review gate 1, "mechanically regular sequences"`);
console.log(`  stall modules        ${[...modules.entries()].map(([k, v]) => `${k} ${v}`).join(' · ')}`);
console.log(`  first 24 on one kerb eave spread ${eaveSpread.toFixed(2)} m (was 0.33), ridge spread ${ridgeSpread.toFixed(2)} m (was 0.53)`);
console.log(`  cloth colours        ${clothColours.size} in 24 stalls (was 2), ${clothModules.size} modules in the same 24`);
console.log(`  longest gapless run  ${longestRun} stalls (was 15), fatigue gaps ${fatigueGaps}`);

if (modules.size < 5) fail(`only ${modules.size} stall modules: every stall is still the same typology`);
if (eaveSpread < 2.0) fail(`eave spread ${eaveSpread.toFixed(2)} m across 24 consecutive stalls: the roofline is still a fence`);
if (ridgeSpread < 1.5) fail(`ridge spread ${ridgeSpread.toFixed(2)} m across 24 consecutive stalls`);
if (clothColours.size < 4) fail(`${clothColours.size} cloth colours in 24 stalls: the kerb merges into one band`);
if (clothModules.size < 3) fail(`${clothModules.size} modules in the first 24 stalls: a run reads as one typology`);
if (longestRun > 8) fail(`longest gapless run is ${longestRun} stalls`);
if (fatigueGaps === 0) fail('the run-fatigue gap never fired');

console.log(`\ninvariants over ${allStalls.length} stalls in ${marketChunks.length} chunks`);
console.log(`  pitch                ${pMin.toFixed(2)} .. ${pMax.toFixed(2)} m`);
console.log(`  gap slots            ${(100 * gapFrac).toFixed(1)}% of ${any.stats.slots > 0 ? marketChunks.reduce((a, c) => a + marketGrammarFor(queryFor(c)).stats.slots, 0) : 0} slots`);
console.log(`  kerbs                +1 ${sides[0]} stalls, -1 ${sides[1]} stalls`);
console.log(`  canopy not overhanging the kerb line   ${noOverhang} (lean-to exempt by design)`);
console.log(`  clothless modules                    ${roofless} of ${allStalls.length} (frame + bare, by design)`);
console.log(`  stall straddling both kerbs / inverted  ${wrongSide}`);
console.log(`  eave below 1.9 m or ridge <= eave       ${tooTall}`);
console.log(`  roof samples inside a building footprint ${sunk}`);
console.log(`  canopy modules       ${panels3} three-panel / ${panels5} five-panel, ${poles} on poles / ${wallTied} wall-tied`);
console.log(`  sign silhouettes      ${signPanels} panels / ${signBands} bands   (${totSigns} total, 1 in ${SIGN_EVERY} stalls)`);
console.log(`  cooking vents         ${totVents}, 1 stall in ${COOKING_EVERY}`);
console.log(`  hanging cloth         ${allCloth.length} pieces, ${pennants} pennants (1 cord in ${CLOTH_EVERY_STRING} carries cloth)`);
console.log(`  lit lanterns          ${litAll} across ${spread.length} chunks; ${(100 * tailShare).toFixed(1)}% on the last quarter of the cords`);

if (noOverhang > 0) fail(`${noOverhang} stalls do not overhang the carriageway`);
if (wrongSide > 0) fail(`${wrongSide} stalls are not wholly on one kerb`);
if (tooTall > 0) fail(`${tooTall} stalls have an eave/ridge that cannot shade a stall`);
if (negative > 0) fail(`${negative} stalls have a negative eave`);
if (sunk > 0) fail(`${sunk} stall footprint samples land inside a building`);
if (sides[0] === 0 || sides[1] === 0) fail('one kerb has no stalls at all — the walk is not symmetric');
if (gapFrac < 0.05) fail('gap noise produced no quiet stretches: the row is an even comb');
if (gapFrac > 0.6) fail(`${(gapFrac * 100).toFixed(0)}% of slots are empty: too sparse`);
if (pMax - pMin < 0.8) fail(`pitch barely varies (${pMin.toFixed(2)}..${pMax.toFixed(2)} m)`);
if (totSigns === 0) fail('no projecting signs were emitted');
if (totVents === 0) fail('no cooking vents were emitted');
if (totStrings === 0) fail('no lantern cords were emitted');
if (panels3 === 0 || panels5 === 0) fail('only one canopy module is emitted — the repeated-module risk the spec names');
if (poles === 0 || wallTied === 0) fail('only one canopy support type is emitted');
if (signPanels === 0 || signBands === 0) fail('every projecting sign has the same silhouette');
if (allCloth.length === 0) fail('no hanging cloth was emitted');
if (allCloth.some((c) => c.halfWidth <= 0 || c.drop <= 0)) fail('a piece of hanging cloth has no size');
// A quarter is what an even spread gives. Walk-order truncation gives ~0.
if (tailShare < 0.12) fail(`${(100 * tailShare).toFixed(1)}% of lit lanterns are on the last quarter of the cords: the budget is truncating, not spreading`);

// ---------------------------------------------------------------- 4. cord + determinism

const str = any.strings[0];
if (str) {
  const mid = marketCatenary(str.a, str.b, str.sag, 0.5);
  const expect = (str.a[1] + str.b[1]) * 0.5 - str.sag;
  console.log(`\ncord  anchors y ${str.a[1].toFixed(2)} / ${str.b[1].toFixed(2)}, sag ${str.sag.toFixed(2)}`);
  console.log(`  midpoint y ${mid[1].toFixed(3)} expected ${expect.toFixed(3)}  (sag at mid-span)`);
  if (Math.abs(mid[1] - expect) > 1e-6) fail('the cord does not sag by `sag` at mid-span');
  let below = true;
  for (let i = 0; i < str.lanterns.length; i++) {
    const t = (i + 0.5) / str.lanterns.length;
    const c = marketCatenary(str.a, str.b, str.sag, t);
    if (str.lanterns[i].pos[1] >= c[1]) below = false;
  }
  console.log(`  every lantern hangs below the cord: ${below}`);
  if (!below) fail('a lantern is at or above the cord it hangs from');
}

const c0 = marketChunks[0];
const a = bakeChunkMarket(c0, 0).bld.build();
const b = bakeChunkMarket(c0, 0).bld.build();
const same = a.indexCount === b.indexCount
  && a.positions.every((v, i) => v === b.positions[i])
  && a.colors.every((v, i) => v === b.colors[i]);
// The query is also order-independent: the same chunk asked twice, from a fresh
// builder, must produce the same numbers. That is what lets the caller compute
// the light list separately from the geometry without risking disagreement.
const q1 = marketGrammarFor(queryFor(c0)).stats;
const q2 = marketGrammarFor(queryFor(c0)).stats;
console.log(`\ndeterminism  mesh identical ${same}; counts identical ${JSON.stringify(q1) === JSON.stringify(q2)}`);
if (!same) fail('two bakes of the same chunk produced different meshes');
if (JSON.stringify(q1) !== JSON.stringify(q2)) fail('two grammar runs of the same chunk disagreed');

// ---------------------------------------------------------------- 5. the pools

// Does a lantern put a visible pool on the street? That is arithmetic, not
// opinion, so it is done here against the exact attenuation in
// `src/shaders/lighting.wgsl` and the exact night ambient in
// `src/sim/weather.ts`. A ratio near 1 is a street with lamps in it; a ratio
// near 100 is a lit market.
//
//   lighting.wgsl:191   atten = (1 - d2/r2)^2 / (1 + d2 * 0.05)
//   weather.ts:234     night ambient #1d2547 at ambientIntensity 0.22;
//                      market-rush lifts it to 0.34
const hexToLinear = (hex: string): number[] => {
  const ch = (i: number): number => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [ch(1), ch(3), ch(5)];
};
const NIGHT_AMBIENT_INTENSITY = 0.22;
/** Diffuse irradiance on an up-facing deck from the night sky alone, albedo 0.2. */
const ambientDiffuse = hexToLinear('#1d2547').map((a) => a * 1.15 * NIGHT_AMBIENT_INTENSITY * 0.2);

/** Red channel of the pool a lantern of this radius/intensity puts `lateral` away. */
const poolRed = (height: number, lateral: number, r: number, intensity: number): number => {
  const d2 = height * height + lateral * lateral;
  const win = (1 - d2 / (r * r)) ** 2;
  const atten = win / (1 + d2 * 0.05);
  const noL = height / Math.sqrt(d2);
  return (0.96 * 0.2 / Math.PI) * noL * intensity * atten;   // albedo 0.2, kd ~0.96
};

// A cord anchors at GROUND_Y + 7.0..9.5, sags 1.0-2.1, and the lantern drops a
// further 0.34-0.72, so it hangs about 6 m over the deck.
const LANTERN_HEIGHT = 6.0;
const OFFSETS = [0, 2, 4, 6, 8, 10, 12];
const ratios = OFFSETS.map((l) => poolRed(LANTERN_HEIGHT, l, LANTERN_LIGHT_RADIUS, LANTERN_LIGHT_INTENSITY) / ambientDiffuse[0]);
const poolWidth = 2 * Math.sqrt(Math.max(1, LANTERN_LIGHT_RADIUS ** 2 - LANTERN_HEIGHT ** 2));
// Where the pool falls to twice the ambient it sits in, interpolated between
// the samples that bracket it. That radius is the pool; the geometric
// footprint of the light sphere is not, because attenuation at the deck is
// grazing and dies long before the sphere does.
const legibleRadius = ((): number => {
  for (let i = 1; i < OFFSETS.length; i++) {
    if (ratios[i] >= 2) continue;
    const t = (ratios[i - 1] - 2) / Math.max(1e-6, ratios[i - 1] - ratios[i]);
    return OFFSETS[i - 1] + t * (OFFSETS[i] - OFFSETS[i - 1]);
  }
  return OFFSETS[OFFSETS.length - 1];
})();

console.log(`\nlight pools  ambient diffuse on the deck = [${ambientDiffuse.map((a) => a.toFixed(5)).join(', ')}]`);
console.log(`  lantern r=${LANTERN_LIGHT_RADIUS} intensity=${LANTERN_LIGHT_INTENSITY}, hanging ${LANTERN_HEIGHT} m over the deck`);
console.log(`  pool/ambient at ${OFFSETS.map((o) => `${o}m`).join(', ')}: ${ratios.map((r) => `${r.toFixed(0)}x`).join(' ')}`);
console.log(`  pool ${poolWidth.toFixed(1)} m sphere footprint at deck level; above 2x ambient out to ${legibleRadius.toFixed(1)} m lateral`);

// A pool has to beat the ambient it sits in by a wide margin to survive a
// filmic tonemap at exposure 1. Two is a rounding error; twenty is a lit street.
if (ratios[0] < 10) fail(`the pool directly under a lantern is only ${ratios[0].toFixed(1)}x the night ambient — it will not read`);
// A pool that dies inside a couple of metres is a spot, and one still visible
// from the far kerb is not a pool, it is a floodlight.
if (legibleRadius < 6) fail(`the pool falls below 2x ambient at ${legibleRadius} m: a spot, not a pool`);
if (legibleRadius > 14) fail(`the pool is still above 2x ambient at ${legibleRadius} m: that is a floodlight`);
if (poolWidth < 4) fail(`the pool is only ${poolWidth.toFixed(1)} m across at deck level`);

// And the count. The spec counts "more than 10 small warm lamp points" along
// successive galleries, several of them "within a short visible stretch".
const cordsSeen = spread.reduce((a, s) => a + s.cords, 0);
const litPerCord = litAll / Math.max(1, cordsSeen);
console.log(`  ${(cordsSeen / Math.max(1, spread.length)).toFixed(1)} cords/chunk, ${litPerCord.toFixed(1)} lit lanterns per cord`);
if (litPerCord < 2) fail(`${litPerCord.toFixed(1)} lit lanterns per cord: the strings read as decoration, not as lamps`);

// ---------------------------------------------------------------- 6. the mesh

// Everything above checks the descriptor. This checks the artefact: that the
// vertices that reached the builder are the ones the grammar promised. A
// grammar can be perfect and a baker can still emit a flat board, and no count
// in section 1 would ever notice.
const meshChunk = marketChunks.find((c) => marketGrammarFor(queryFor(c)).stats.stalls > 8) ?? c0;
const mesh = bakeChunkMarket(meshChunk, 0).bld.build();
const pos = mesh.positions;
let minY = Infinity, maxY = -Infinity, overRoad = 0, overFootway = 0;
for (let i = 0; i < pos.length; i += 3) {
  const y = pos[i + 1];
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
  if (y < GROUND_Y + 1.5) continue;
  const d = spineHit(plan.districts.market, pos[i], pos[i + 2], scratch).dist;
  if (d < half) overRoad++;
  else overFootway++;
}


// marketbake's LEG_RADIUS + POLE_RADIUS: the frame members are tubes and
// cylinders, so their vertices sit on the surface and never on the axis.
const FRAME_TOL = 0.08;
// Tallest member the grammar declares: a lantern cord anchor, or a ridge if
// that ever stands higher.
const ceiling = GROUND_Y + Math.max(RIDGE_MAX, STRING_ANCHOR_MAX) + 0.3;
/**
 * Is there a vertex within `tol` of this lateral/height, in this stall?
 *
 * `tol` for a roof edge has to cover the frame: the eave and ridge poles are
 * tubes and the legs are 4-sided cylinders, so their vertices sit on the
 * surface of the member and never on its axis. LEG_RADIUS + POLE_RADIUS in
 * marketbake is the honest bound; the cloth check keeps a tight one because a
 * ribbon vertex does land on the surface it describes.
 */
const nearStall = (s: MarketStall, lateral: number, y: number, tol = FRAME_TOL): boolean => {
  for (let i = 0; i < pos.length; i += 3) {
    const l = (pos[i] - s.cx) * s.nx + (pos[i + 2] - s.cz) * s.nz;
    if (Math.abs(l - lateral) > tol) continue;
    if (Math.abs(pos[i + 1] - y) > tol) continue;
    // Must also be within the stall's own footprint, not a neighbour's.
    const along = (pos[i] - s.cx) * s.tx + (pos[i + 2] - s.cz) * s.tz;
    if (Math.abs(along) > s.pitch * 0.6) continue;
    return true;
  }
  return false;
};

// Clothless modules emit no roof, so there is no edge to find on them.
const deep = marketGrammarFor(queryFor(meshChunk)).stalls.filter((s) => s.hasCloth).slice(0, 40);
let eaveOk = 0, ridgeOk = 0, sagOk = 0;
for (const s of deep) {
  const depth = Math.abs(s.back - s.front);
  const midLat = (s.front + s.back) * 0.5;
  const straight = s.eave + (s.ridge - s.eave) * 0.5;
  // Mid-panel, mid-cross: the deepest point of the belly. If the cloth were a
  // plane this vertex would sit at `straight` and the assertion below fails.
  const belly = straight - s.pitch * SAG_ALONG - depth * SAG_ACROSS;
  if (nearStall(s, s.front, s.eave)) eaveOk++;
  if (nearStall(s, s.back, s.ridge)) ridgeOk++;
  if (nearStall(s, midLat, belly, 0.03)) sagOk++;
}

// Cloth is a descriptor until a vertex exists for it. A ribbon's first row of
// vertices sits `halfWidth` either side of its attachment along the cord, so
// the XZ tolerance is the cloth's own half-width and the vertical tolerance is
// tight. Getting this wrong reads as "the cloth is missing" when it is built.
const meshCloth = marketGrammarFor(queryFor(meshChunk)).cloth;
let clothInMesh = 0;
for (const c of meshCloth) {
  const flat = c.halfWidth + 0.01;
  for (let i = 0; i < pos.length; i += 3) {
    if (Math.abs(pos[i + 1] - c.pos[1]) > 0.02) continue;
    if (Math.hypot(pos[i] - c.pos[0], pos[i + 2] - c.pos[2]) > flat) continue;
    clothInMesh++;
    break;
  }
}

// The two support types have to produce genuinely different geometry, not just
// a different string in a descriptor. A `poles` stall has a leg standing on
// the deck at its roadward edge; a `wall-tied` one has nothing there at all.
//
// Two precision traps, both of which read as "the geometry is missing":
// `positions` is a Float32Array, so 0.35 does not survive the round trip and
// an unsigned `< GROUND_Y` filter rejects the very vertices it is hunting; and
// the window has to be tight in `along`, because a stall's own legs stand at
// exactly `pitch/2` while its neighbour's nearest leg is only
// `pitch/2 + STALL_SEPARATION` away. `pitch * 0.6` sees both.
let polesMissing = 0, wallTiedWithLeg = 0;
for (const s of deep) {
  const own = s.pitch * 0.5;
  let standing = false;
  for (let i = 0; i < pos.length; i += 3) {
    const dy = pos[i + 1] - GROUND_Y;
    if (dy < -0.05 || dy > 0.3) continue;
    const l = (pos[i] - s.cx) * s.nx + (pos[i + 2] - s.cz) * s.nz;
    if (Math.abs(l - s.front) > 0.2) continue;
    const along = Math.abs((pos[i] - s.cx) * s.tx + (pos[i + 2] - s.cz) * s.tz);
    if (along < own - 0.06 || along > own + 0.16) continue;
    standing = true;
    break;
  }
  if (s.frame === 'poles') { if (!standing) polesMissing++; } else if (standing) wallTiedWithLeg++;
}
const deepPoles = deep.filter((s) => s.frame === 'poles').length;
const deepWall = deep.length - deepPoles;

console.log(`\nmesh  chunk ${meshChunk.cx},${meshChunk.cz}: ${mesh.vertexCount} verts, ${mesh.indexCount / 3} tris`);
console.log(`  y range              ${minY.toFixed(3)} .. ${maxY.toFixed(3)} m  (deck ${GROUND_Y}, declared ceiling ${ceiling.toFixed(2)})`);
console.log(`  cloth over carriageway ${overRoad} verts, over footway ${overFootway} verts`);
console.log(`  eave edge present     ${eaveOk}/${deep.length}`);
console.log(`  ridge edge present    ${ridgeOk}/${deep.length}`);
console.log(`  belly sags by the declared SAG_ALONG/SAG_ACROSS  ${sagOk}/${deep.length}`);
console.log(`  hanging cloth         ${clothInMesh}/${meshCloth.length} pieces present in the mesh`);
console.log(`  roadward legs         ${deepPoles - polesMissing}/${deepPoles} pole-framed stalls have one; ${wallTiedWithLeg}/${deepWall} wall-tied stalls have one (must be 0)`);

if (minY < GROUND_Y - 0.02) fail(`market geometry goes ${(GROUND_Y - minY).toFixed(3)} m below the deck`);
if (overRoad === 0) fail('no market cloth over the carriageway: the canopy does not overhang the road');
if (overFootway === 0) fail('no market cloth over the footway');
if (eaveOk < deep.length) fail(`${deep.length - eaveOk} stalls have no roof edge at their declared eave height`);
if (ridgeOk < deep.length) fail(`${deep.length - ridgeOk} stalls have no roof edge at their declared ridge height`);
if (sagOk < deep.length) fail(`${deep.length - sagOk} stalls have a flat roof — the cloth does not sag`);
if (maxY > ceiling) fail(`something rises ${(maxY - GROUND_Y - RIDGE_MAX).toFixed(2)} m above the tallest declared member`);
if (meshCloth.length > 0 && clothInMesh !== meshCloth.length) {
  fail(`${meshCloth.length - clothInMesh} of ${meshCloth.length} hanging cloths have no vertex at their attachment`);
}
// Exact, not a tolerance: a pole-framed stall with no leg and a wall-tied stall
// with one are the same defect seen from two sides.
if (polesMissing > 0) {
  fail(`${polesMissing} of ${deepPoles} pole-framed stalls have no leg at their roadward edge`);
}
if (wallTiedWithLeg !== 0) {
  fail(`${wallTiedWithLeg} wall-tied stalls have a leg standing in the carriageway`);
}

const other = marketGrammarFor({ ...queryFor(c0), seed: SEED + 1 }).stats;
if (JSON.stringify(other) === JSON.stringify(q1)) fail('a different seed produced an identical market — it is not reading the seed');

console.log(`\ntotals  stalls ${totStalls}  crates ${totCrates}  signs ${totSigns}  vents ${totVents}`);
console.log(`        cords ${totStrings}  lanterns ${totLanterns}  lights ${totLights} (cap ${MAX_MARKET_LIGHTS_PER_CHUNK}/chunk)`);
console.log(`        ${(totCrates / Math.max(1, totStalls)).toFixed(2)} crates/stall, ${(totStrings / Math.max(1, totStalls)).toFixed(2)} cords/stall`);
console.log(`  runs ${RUN_MIN_M}-${RUN_MAX_M} m, gaps ${GAP_MIN_M}-${GAP_MAX_M} m, pitch noise scale ${PITCH_NOISE_SCALE}, corridor scale 0.55, deck y ${GROUND_Y}`);

console.log(`\nVIOLATIONS: ${violations.length === 0 ? 'none' : ''}`);
for (const v of violations) console.log(`  - ${v}`);
