/**
 * Walking lines: footways per district, and the clear route through the market
 * spine's furniture islands (DECISIONS D30).
 *
 * 1. FOOTWAYS. Groups are placed on footways (`crowd.ts`: centre at kerb +
 *    FOOTWAY_SETBACK 1.9 m, members within GROUP_RADIUS 1.5 m, wander ±1.5 m),
 *    so this table is the capacity the crowd spreads into. Furniture stands at
 *    the building line or the kerb line, and a kind that would leave less than
 *    `footwayWalk(fw)` clear is not placed (`clutterReach`): 3 m where the
 *    footway can give it, otherwise all but 1.1 m. Capacity counts bodies at
 *    0.7 m lateral pitch. Alley-kind footways are single-file by construction;
 *    the hero aisle is the market carriageway, not its 2.86 m footway.
 *
 * 2. THE SPINE. Measured on the baked chunks, not on the grammar's intent:
 *    every metre along the spine, the cross-section through every emitted crowd
 *    obstacle (stall counters, poles, island pieces) and every building
 *    footprint must leave a free run of at least CLEAR_ROUTE metres, every
 *    solid island piece must have registered its obstacle, no island may reach
 *    into the lane in front of a stall row, and no tram may run at grade
 *    through an island.
 *
 * Run: `npx vite-node src/world/__selftest_footway.ts`
 */

import { DISTRICT_STYLES, districtAtField, spineHit, spinePoint } from './districts';
import { City, GROUND_Y, defaultCityConfig, footprintAabb, type RoadKind } from './citygen';
import { CLUTTER_KINDS, clutterReach, footwayWalk, groundGrammarFor } from './groundgrammar';
import { ISLAND_FRONT_MAX, ISLAND_LANE, marketGrammarFor, type MarketIsland } from './marketgrammar';
import { buildRailLines } from './networks';
import { bakeChunk } from '../render/citymesh';
import type { CrowdObstacle } from './crowdobstacles';

const KINDS: RoadKind[] = ['street', 'market', 'artery', 'alley'];
const PITCH = 0.7;
/** D30: islands leave a continuous clear route at least this wide. */
const CLEAR_ROUTE = 3.0;
const SEED = 0x5e7a17;

const problems: string[] = [];

// ---------------------------------------------------------------- 1. footways

console.log('\nFOOTWAY per district (authored m) | walk line kept clear | capacity @0.7 m pitch | kinds refused');
let widest = 0;
for (let d = 0; d < DISTRICT_STYLES.length; d++) {
  const cells: string[] = [];
  for (const k of KINDS) {
    const g = groundGrammarFor(d, k);
    const fw = g.footwayWidth;
    widest = Math.max(widest, fw);
    if (!Number.isFinite(fw) || fw < 0) problems.push(`${DISTRICT_STYLES[d].key}/${k} footway ${fw}`);
    const walk = footwayWalk(fw);
    const refused = g.clutter.filter((i) => clutterReach(CLUTTER_KINDS[i], fw) === null).map((i) => CLUTTER_KINDS[i]);
    // A kit that can place nothing on its own street is a grammar fault, not a choice.
    if (k === 'street' && g.clutter.length > 0 && refused.length === g.clutter.length) {
      problems.push(`${DISTRICT_STYLES[d].key}/street: every kit kind is too deep for a ${fw.toFixed(2)} m footway`);
    }
    cells.push(`${k}=${fw.toFixed(2)}/${walk.toFixed(2)}/${Math.floor(walk / PITCH)}${refused.length ? ` -${[...new Set(refused)].join(',')}` : ''}`);
  }
  console.log(`  ${DISTRICT_STYLES[d].key.padEnd(17)} ${cells.join('  ')}`);
}
// Hero adjacency: the market-spine district's market-kind footway borders the
// hero aisle. 2.86 m by construction (2.2 x 1.3).
const heroFw = groundGrammarFor(10, 'market').footwayWidth;
if (heroFw < 2.5) problems.push(`market market-kind footway ${heroFw.toFixed(2)} m below 2.5 m hero floor`);
for (let d = 0; d < DISTRICT_STYLES.length; d++) {
  const fw = groundGrammarFor(d, 'alley').footwayWidth;
  if (fw >= 1.5) problems.push(`${DISTRICT_STYLES[d].key} alley footway ${fw.toFixed(2)} m is not single-file`);
}
// D30 puts islands in walking areas wider than ~6 m. No footway is; if one
// becomes so, it needs islands of its own and this line says so.
console.log(`  widest footway ${widest.toFixed(2)} m (D30 islands start at ~6 m: market spine only)`);
if (widest >= 6) problems.push(`a footway is ${widest.toFixed(2)} m wide: D30 wants islands there, and only the spine has them`);

// ---------------------------------------------------------------- 2. the spine

const city = new City(defaultCityConfig(SEED));
const plan = city.plan;
const spine = plan.districts.market;
const half = spine.width * 0.5;
const band = half - ISLAND_FRONT_MAX - ISLAND_LANE;

const keys = new Map<string, [number, number]>();
for (let a = -400; a <= 900; a += 8) {
  const p = spinePoint(spine, a);
  keys.set(`${Math.floor(p[0] / 256)},${Math.floor(p[1] / 256)}`, [Math.floor(p[0] / 256), Math.floor(p[1] / 256)]);
}
const obstacles: CrowdObstacle[] = [];
const islands: MarketIsland[] = [];
const footprints: [number, number, number, number][] = [];
for (const [cx, cz] of keys.values()) {
  const ch = city.getChunk(cx, cz);
  if (!ch) continue;
  obstacles.push(...bakeChunk(ch, 0, SEED).obstacles);
  const mid = [(ch.boundsMin[0] + ch.boundsMax[0]) / 2, (ch.boundsMin[2] + ch.boundsMax[2]) / 2];
  islands.push(...marketGrammarFor({ seed: SEED, plan, chunk: ch, kind: 'market', districtId: districtAtField(plan.districts, mid[0], mid[1]) }).islands);
  for (const b of ch.buildings) { const [lo, hi] = footprintAabb(b); footprints.push([lo[0], lo[2], hi[0], hi[2]]); }
}
const walkers = obstacles.filter((o) => o.minY < GROUND_Y + 1.7 && o.maxY > GROUND_Y + 0.08);

/** Interval of s where c + n*s is inside the box (centre o, axes t and its left normal). */
function cut(cx: number, cz: number, nx: number, nz: number, o: CrowdObstacle): [number, number] | null {
  let lo = -Infinity, hi = Infinity;
  const ax: [number, number, number][] = [[o.tx, o.tz, o.halfAlong], [-o.tz, o.tx, o.halfAcross]];
  for (const [ux, uz, h] of ax) {
    const d0 = (cx - o.x) * ux + (cz - o.z) * uz, dn = nx * ux + nz * uz;
    if (Math.abs(dn) < 1e-9) { if (Math.abs(d0) > h) return null; continue; }
    const s1 = (-h - d0) / dn, s2 = (h - d0) / dn;
    lo = Math.max(lo, Math.min(s1, s2)); hi = Math.min(hi, Math.max(s1, s2));
  }
  return lo <= hi ? [lo, hi] : null;
}

const hit = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 };
let samples = 0, worst = Infinity, worstAt = 0;
for (let a = -400; a <= 900; a += 1) {
  const p = spinePoint(spine, a);
  const h = spineHit(spine, p[0], p[1], hit);
  const nx = -h.tz, nz = h.tx;
  const blocked: [number, number][] = [];
  for (const o of walkers) {
    if (Math.abs(o.x - p[0]) > half + 8 || Math.abs(o.z - p[1]) > half + 8) continue;
    const iv = cut(p[0], p[1], nx, nz, o);
    if (iv) blocked.push(iv);
  }
  for (const [x0, z0, x1, z1] of footprints) {
    if (x1 < p[0] - half - 2 || x0 > p[0] + half + 2 || z1 < p[1] - half - 2 || z0 > p[1] + half + 2) continue;
    const iv = cut(p[0], p[1], nx, nz, { x: (x0 + x1) / 2, z: (z0 + z1) / 2, tx: 1, tz: 0, halfAlong: (x1 - x0) / 2, halfAcross: (z1 - z0) / 2, minY: 0, maxY: 0, kind: 'building' });
    if (iv) blocked.push(iv);
  }
  // Longest free run across the carriageway.
  blocked.sort((u, v) => u[0] - v[0]);
  let at = -half, best = 0;
  for (const [s0, s1] of blocked) {
    if (s1 < -half || s0 > half) continue;
    best = Math.max(best, Math.min(s0, half) - at);
    at = Math.max(at, s1);
  }
  best = Math.max(best, half - at);
  samples++;
  if (best < worst) { worst = best; worstAt = a; }
  if (best < CLEAR_ROUTE) problems.push(`spine along ${a}: longest clear run ${best.toFixed(2)} m < ${CLEAR_ROUTE} m`);
}

// Every solid piece registered an obstacle that covers it.
const SOLID_KINDS = new Set(islands.flatMap((i) => i.pieces.filter((q) => q.solid).map((q) => q.kind)));
let pieces = 0, covered = 0, laneBreach = 0, worstLat = 0;
for (const isl of islands) {
  const p = spinePoint(spine, isl.along);
  const lat = Math.hypot(isl.x - p[0], isl.z - p[1]);
  worstLat = Math.max(worstLat, lat + isl.radius);
  if (lat + isl.radius > band + 1e-6) laneBreach++;
  for (const q of isl.pieces) {
    if (Math.hypot(q.x - isl.x, q.z - isl.z) > isl.radius) problems.push(`${isl.kind} piece ${q.kind} outside its island radius`);
    if (!q.solid) continue;
    pieces++;
    if (walkers.some((o) => o.kind === q.kind && Math.abs(q.x - o.x) <= o.halfAlong + 0.05 && Math.abs(q.z - o.z) <= o.halfAcross + 0.05)) covered++;
  }
}
if (covered !== pieces) problems.push(`${pieces - covered}/${pieces} solid island pieces have no crowd obstacle`);
if (laneBreach > 0) problems.push(`${laneBreach} islands reach into the ${ISLAND_LANE} m stall lane`);

// Trams run at grade at their ends; an island on the track is a collision.
let tramHits = 0;
for (const line of buildRailLines(city, SEED)) {
  if (line.kind !== 'tram') continue;
  for (const q of line.points) {
    if (q[1] > GROUND_Y + 3) continue;
    for (const isl of islands) if (Math.hypot(q[0] - isl.x, q[2] - isl.z) < isl.radius + 1.5) tramHits++;
  }
}
if (tramHits > 0) problems.push(`${tramHits} at-grade tram points pass through an island`);

const byKind: Record<string, number> = {};
for (const i of islands) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
console.log(`\nSPINE (seed ${SEED.toString(16)}, ${keys.size} chunks, width ${spine.width.toFixed(1)} m, island band |lat|+r <= ${band.toFixed(2)} m)`);
console.log(`  islands ${islands.length} ${JSON.stringify(byKind)}; solid pieces with an obstacle ${covered}/${pieces} (${[...SOLID_KINDS].join(',')})`);
console.log(`  deepest island reach ${worstLat.toFixed(2)} m of ${band.toFixed(2)}; tram points through an island ${tramHits}`);
console.log(`  clear route over ${samples} cross-sections: narrowest ${worst.toFixed(2)} m at along ${worstAt} (need ${CLEAR_ROUTE})`);

console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
for (const p of problems.slice(0, 20)) console.log(`  - ${p}`);
