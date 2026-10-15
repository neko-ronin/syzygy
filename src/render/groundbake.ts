/**
 * Per-chunk ground detail: the kerbs, footways and paint of a street.
 *
 * WHY THIS IS GEOMETRY AND NOT SHADER WORK. The street field exists only on the
 * CPU — `sampleStreetPlan` is ~90 lines of fbm-warped grid lines, three
 * wandering spines and five to seven arteries. Reconstructing it in WGSL would
 * mean porting all of it with every float a rounding away, and the whole class
 * of bug this project has already paid for eleven times is a shader and a CPU
 * quietly disagreeing about where something is. So: anything that needs to know
 * WHERE the street is is decided here, at bake time, and the fragment stage is
 * handed a surface plus a vertex colour.
 *
 * WHAT WAS THERE BEFORE. One 4096m quad in flat grey, plus 1.2m kerb boxes on a
 * jittered 48m world-axis grid with no relationship to the street network. Those
 * boxes were not kerbs: they cut across blocks, none of them followed a
 * carriageway, and at a street-level pose they contributed a few thin bright
 * lines to an otherwise featureless slab. They looked plausible in a wide shot,
 * which is exactly why nobody measured them.
 *
 * LOD. 0 = kerb face, kerb top, footway band, paint. 1 = kerb face and top
 * only — the silhouette that still reads as a street edge. 2 = nothing; at that
 * range the shader's surface synthesis carries the whole street.
 */

import { makeRng, type Rng, type Vec3 } from '../core/math';
import {
  sampleStreetPlan, GROUND_Y, DISTRICT_CELL,
  type CityChunk, type CityPlan, type RoadKind, type StreetSample,
} from '../world/citygen';
import {
  groundGrammarFor, groundSurfaceTag, walkingFamily, walkingAlbedo, type GroundBakeCtx, type GroundGrammar, type StreetFrame,
} from '../world/groundgrammar';
import { FACE_ALL, FACE_NY, FACE_PY, MeshBuilder } from '../world/geometry';
import { bakeMarketDetail, marketBakeState, type MarketBakeState } from './marketbake';
import {
  marketGrammarFor, streetIslands, MAX_MARKET_LIGHTS_PER_CHUNK, MAX_STALL_LAMPS_PER_CHUNK,
} from '../world/marketgrammar';
import {
  CLUTTER_DEPTH, CLUTTER_EDGE, CLUTTER_KINDS, FOOTWAY_FRONT_INSET, FOOTWAY_KERB_BAND, clutterReach,
} from '../world/groundgrammar';
import { districtStyle } from '../world/districts';
import type { CrowdObstacle } from '../world/crowdobstacles';
import type { MarketIsland, MarketStall } from '../world/marketgrammar';

// ---------------------------------------------------------------- constants

/**
 * Kerb top width, metres. A kerb is a ~0.15m edge seen nearly edge-on plus its
 * top; 0.30m is the narrowest band that survives TAA at street range without
 * becoming a kerb-width strip of pavement.
 */
const KERB_W = 0.30;

/**
 * Order market lanterns by their position along the market's own spine.
 *
 * The spine is the principal axis of the lantern set: catenaries are strung along
 * it, so the set is long in one direction and thin in the other. Returns a
 * distance-from-spine-midpoint function, which is 0 in the middle of the market
 * and grows toward either end — which is the ordering that is least wrong from
 * any viewpoint, since a viewer is somewhere along the market rather than at one
 * end of it.
 *
 * Degenerate case: fewer than 3 lanterns, or no measurable spread, falls back to
 * distance from the set's own centroid. That is the chunk-centre ordering this
 * replaces, and it is only correct when the lights happen to surround the centre.
 */
function spineDistance(lights: GroundLight[]): (l: GroundLight) => number {
  const n = lights.length;
  let mx = 0, mz = 0;
  for (const l of lights) { mx += l.pos[0]; mz += l.pos[2]; }
  mx /= n; mz /= n;
  if (n < 3) {
    return (l) => (l.pos[0] - mx) ** 2 + (l.pos[2] - mz) ** 2;
  }
  // Principal axis by power iteration on the 2x2 covariance. Two passes is enough
  // for a set that is strongly elongated, which a catenary line is.
  // Power iteration on the 2x2 covariance: repeatedly multiply the axis by the
  // covariance and renormalise, which converges on the dominant eigenvector.
  let ax = 1, az = 0;
  for (let iter = 0; iter < 3; iter++) {
    let tx = 0, tz = 0;
    for (const l of lights) {
      const dx = l.pos[0] - mx, dz = l.pos[2] - mz;
      const proj = dx * ax + dz * az;
      tx += proj * dx; tz += proj * dz;
    }
    const len = Math.hypot(tx, tz);
    if (len < 1e-9) break;
    ax = tx / len; az = tz / len;
  }
  // Midpoint of the extent along the axis, so distance is symmetric about the middle.
  let lo = Infinity, hi = -Infinity;
  for (const l of lights) {
    const t = (l.pos[0] - mx) * ax + (l.pos[2] - mz) * az;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  const mid = (lo + hi) * 0.5;
  return (l) => {
    const t = (l.pos[0] - mx) * ax + (l.pos[2] - mz) * az - mid;
    return t * t;
  };
}

/**
 * How far paint sits above the carriageway, metres.
 *
 * It has to clear reverse-Z depth precision at the far end of the range and it
 * has to stay BELOW the lowest kerb, so the fragment stage can tell paint from
 * kerb by height alone. Sharpened kerb heights run 0.06..0.20m; 0.016m is clear
 * of the deck and well under all of them.
 */
export const PAINT_LIFT = 0.016;

/** Centreline step while tracing, metres. Also the road dedupe quantisation. */
const TRACE_STEP = 5.0;
/** Seed grid pitch while hunting for carriageways, metres. */
const SEED_PITCH = 8.0;
/** Footway overlap dedupe cell, metres. */
const DEDUPE_CELL = 2.0;
/** Guard on trace iterations. A chunk is 256m, so 96 steps x 4m covers it twice over. */
const TRACE_MAX_STEPS = 80;
/**
 * Coarse node lattice the seed hunt collapses onto, metres.
 *
 * The hunt samples a 6m grid over the chunk and about 60% of those samples come
 * back "inside a carriageway" — the streets are 24-32m wide at a 132-176m
 * pitch and the alleys are 8-13m at 76-112m, so the network really does cover
 * most of the ground. Tracing from every one of them cost 1100 traces and
 * ~118,000 `sampleStreetPlan` calls per chunk (measured). Collapsing onto an
 * 8m node lattice turns that into ~250 nodes and, once a road has been walked,
 * its nodes are all marked, so ~10 traces actually run.
 */
const NODE_CELL = 8.0;

const UP: Vec3 = [0, 1, 0];
const UP4: [Vec3, Vec3, Vec3, Vec3] = [UP, UP, UP, UP];

/** Stable 0..1 from an integer. Mirrors `hash01` in citymesh.ts. */
const hash01 = (h: number): number => {
  let x = Math.imul(h ^ 0x9e3779b1, 0x85ebca6b) >>> 0;
  x = (x ^ (x >>> 13)) >>> 0;
  return (Math.imul(x, 0xc2b2ae35) >>> 0) / 4294967296;
};

/** Quantised world-grid key. Negative coordinates land in [0, 16384). */
const gkey = (x: number, z: number, cell: number): number =>
  (Math.round(x / cell) + 8192) * 16384 + (Math.round(z / cell) + 8192);

// ---------------------------------------------------------------- tracing

const tmpSample: StreetSample = {
  dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
};

/** One traced carriageway: centreline points with a unit frame at each. */
interface Trace {
  /** 5 floats per point: x, z, tx, tz, width. */
  p: number[];
  kind: RoadKind;
  districtId: number;
  /** First point inside the chunk; `to` is one past the last. `to <= from` = empty. */
  from: number;
  to: number;
}

const makeTrace = (): Trace => ({ p: [], kind: 'street', districtId: 0, from: 0, to: 0 });

/**
 * Walk a carriageway centreline in one direction from (x0, z0).
 *
 * Termination is deliberately conservative. A point can stop being on the road
 * it started on without leaving the field: the *nearest* centreline changes at
 * a junction, and the two grid families swap which line they consider nearest
 * as you cross an intersection. Three guards catch that — the road kind must
 * not change, the width must not move by more than 1.5m, and the projection may
 * not jump further than one and a half steps. Without the last guard a trace
 * turns a corner at every junction and lays a kerb down the wrong street, which
 * is worse than laying no kerb at all.
 */
function traceOne(
  plan: CityPlan, x0: number, z0: number, dir: 1 | -1,
  kind: RoadKind, width: number, b: Bounds, out: Trace,
): void {
  let qx = x0, qz = z0;
  for (let i = 0; i < TRACE_MAX_STEPS; i++) {
    const s = sampleStreetPlan(plan, qx, qz, tmpSample);
    if (s.kind !== kind || Math.abs(s.width - width) > 1.5) break;
    const nx = s.px + s.tx * TRACE_STEP * dir;
    const nz = s.pz + s.tz * TRACE_STEP * dir;
    if (Math.hypot(nx - s.px, nz - s.pz) > TRACE_STEP * 1.5 + 0.5) break;
    if (dir > 0) out.p.push(s.px, s.pz, s.tx, s.tz, s.width);
    else out.p.unshift(s.px, s.pz, -s.tx, -s.tz, s.width);
    qx = nx; qz = nz;
    if (qx < b.minX || qx > b.maxX || qz < b.minZ || qz > b.maxZ) break;
  }
}

/** Axis-aligned XZ bounds, expanded by `TRACE_MARGIN`. */
interface Bounds { minX: number; minZ: number; maxX: number; maxZ: number }

/**
 * How far outside the chunk a trace may run before it is abandoned, metres.
 * Only `TRACE_STEP` of slack is needed: geometry is clipped to the chunk, and
 * the extra room exists purely so a road that clips a corner still contributes
 * its last segment inside.
 */
const TRACE_MARGIN = 16;

/** Restrict a trace to the chunk rectangle, so neighbours tile without seams. */
function clipToChunk(t: Trace, minX: number, minZ: number, maxX: number, maxZ: number): void {
  const n = t.p.length / 5;
  let from = -1, to = -1;
  for (let i = 0; i < n; i++) {
    const x = t.p[i * 5], z = t.p[i * 5 + 1];
    if (x >= minX && x <= maxX && z >= minZ && z <= maxZ) {
      if (from < 0) from = i;
      to = i;
    }
  }
  t.from = from < 0 ? 0 : from;
  t.to = from < 0 ? 0 : to + 1;
}

/** District id from the chunk's own DISTRICT_CELL map — free, and exact enough. */
function districtAt(chunk: CityChunk, minX: number, minZ: number, size: number, x: number, z: number): number {
  const ci = Math.min(DISTRICT_CELL - 1, Math.max(0, Math.floor(((x - minX) / size) * DISTRICT_CELL)));
  const cj = Math.min(DISTRICT_CELL - 1, Math.max(0, Math.floor(((z - minZ) / size) * DISTRICT_CELL)));
  return chunk.districtByCell[cj * DISTRICT_CELL + ci];
}

// ---------------------------------------------------------------- the bake

/** Cheap light source, harvested while baking so a night street is lit. */
export interface GroundLight {
  pos: Vec3;
  radius: number;
  color: Vec3;
  intensity: number;
}

export interface GroundBakeResult {
  obstacles: CrowdObstacle[];
  marketStalls: MarketStall[];
  /** Carriageway centrelines that contributed geometry. */
  roads: number;
  /** Furniture the grammar asked for, and how many the triangle budget allowed. */
  clutter: ClutterTally;
  /**
   * Market-spine islands (D30), on their own tally: charging them to `clutter`
   * would throttle every footway traced after the market in the same chunk.
   */
  islands: { placed: number; pieces: number; tris: number };
  /** Islands placed on wide non-market carriageways, for the footway self-test. */
  streetIslands: MarketIsland[];
  /** Metres of carriageway edge emitted. */
  edgeMetres: number;
  /** Triangles emitted. Read back from the builder, never predicted. */
  triangles: number;
  /** Milliseconds spent walking the street field, for the bake budget. */
  fieldMs: number;
}

/**
 * Bake a chunk's street surface into `bld`.
 *
 * `bld` is the chunk's solid builder, so this streams and evicts with the chunk
 * and is covered by the same frustum test and the same shadow cascades as the
 * buildings standing on it.
 */
export function bakeGroundDetail(
  bld: MeshBuilder, chunk: CityChunk, plan: CityPlan, lod: number, rng: Rng,
  lights: GroundLight[],
): GroundBakeResult {
  // Ceiling on lights THIS BAKE contributes, so a dense market chunk cannot eat
  // the whole clustered-light budget that the buildings already draw from.
  //
  // It has to be counted against the lights this function adds, not against the
  // array it was handed. `bakeChunk` fills that array with a rooftop light on 40%
  // of buildings and a light under every bridge BEFORE it gets here — ~150 on a
  // market chunk — and it applies no ceiling of its own. Comparing `lights.length`
  // against 24 therefore read 150 >= 24 on the very first call and refused
  // everything: lamp posts delivered nothing, and then market lanterns delivered
  // nothing, and both looked like missing plumbing. Measured in
  // docs/LIGHT_DELIVERY.md; the static guard is in src/render/__perftest.ts.
  // 24 was enough when the only contributor was a lamp post every ~40m. The
  // market changed that: its grammar emits up to `MAX_MARKET_LIGHTS_PER_CHUNK`
  // (48) per carriageway and a chunk carries up to 5 of those, so 240 lanterns
  // compete for the same 24 slots. Measured on chunk (0,-1): with 24 the deck
  // irradiance at the market spine was **0.000** — not dim, exactly zero, because
  // a 256m chunk's centre is 173m from its own market and nearest-to-centre
  // ordering therefore selects the far end of the market every time. At 48 the
  // same arithmetic gives **1.197** against a night ambient of 0.005, which is
  // the difference between an unlit aisle and a legible one.
  //
  // 48 is the chunk's total light budget now, not a per-market one; the market may
  // take at most half of whatever is left after building lights, so lamp posts
  // are still funded. The renderer's `MAX_LIGHTS` binner is 3072 and measured
  // `binned 490, starved 0` at this pose, so there is headroom for it.
  const maxLights = 48;
  const lightCap = lights.length + maxLights;
  // Market lanterns offered by every trace, adjudicated once at the end. See the
  // block at the `bakeMarketDetail` call site for why this cannot be per-trace.
  const pendingMarket: GroundLight[] = [];
  // Braziers' fire lights wait behind the market (see the adjudication below).
  const pendingFire: GroundLight[] = [];
  // The grammar is a pure function of (seed, plan, chunk, kind, districtId) and is
  // re-derived once per market carriageway, so every trace in a chunk offers the
  // SAME lanterns. Measured: 5 traces offered 240 entries, 48 distinct. Deduplicate
  // by position, or the budget is spent on copies and `dropped` counts each
  // lantern five times.
  const marketSeenKeys = new Set<string>();
  const marketState = { seen: false, emitted: marketBakeState() };
  const res: GroundBakeResult = {
    obstacles: [], marketStalls: [],
    roads: 0, edgeMetres: 0, triangles: 0, fieldMs: 0,
    clutter: {
      placed: 0, wanted: 0, tris: 0, lamps: 0,
      marketLights: 0, marketLightsDropped: 0, marketTraces: 0, stallLights: 0,
    },
    islands: { placed: 0, pieces: 0, tris: 0 },
    streetIslands: [],
  };
  if (lod > 1) return res;

  const size = chunk.boundsMax[0] - chunk.boundsMin[0];
  const minX = chunk.boundsMin[0], minZ = chunk.boundsMin[2];
  const maxX = minX + size, maxZ = minZ + size;
  const t0 = Date.now();
  const before = bld.indexCount;

  const roadCells = new Set<number>();
  const footwayCells = new Set<number>();
  const trace = makeTrace();

  // --- pass 1: sample the seed grid ONCE and collapse it onto a node lattice.
  const nSeed = Math.floor(size / SEED_PITCH);
  const nS = (nSeed + 1) * (nSeed + 1);
  const nodePx = new Float64Array(nS);
  const nodePz = new Float64Array(nS);
  const nodeW = new Float64Array(nS);
  const nodeKind: RoadKind[] = new Array(nS);
  const nodeIndex = new Map<number, number>();
  let nNode = 0;

  for (let j = 0; j <= nSeed; j++) {
    for (let i = 0; i <= nSeed; i++) {
      const sx = minX + i * SEED_PITCH;
      const sz = minZ + j * SEED_PITCH;
      const s = sampleStreetPlan(plan, sx, sz, tmpSample);
      // `clearance` is `dist - width/2`: negative means ON the carriageway.
      if (s.clearance >= 0) continue;
      const nk = gkey(s.px, s.pz, NODE_CELL);
      if (nodeIndex.has(nk)) continue;
      nodeIndex.set(nk, nNode);
      nodePx[nNode] = s.px; nodePz[nNode] = s.pz;
      nodeW[nNode] = s.width; nodeKind[nNode] = s.kind;
      nNode++;
    }
  }

  // --- pass 2: walk each node's carriageway. A road already walked has all its
  //     nodes marked, so this converges to the handful of real roads.
  //
  //     The trace box is a real AABB. It was a single `lo`/`hi` pair derived
  //     from `minX` for BOTH axes, which meant every trace on any chunk that
  //     was not on the world diagonal died on the first step — silently, with
  //     no error and plausible-looking geometry, just missing kerbs. Measuring
  //     the trace-length histogram is what found it: p50 was 2 steps.
  const box: Bounds = {
    minX: minX - TRACE_MARGIN, minZ: minZ - TRACE_MARGIN,
    maxX: maxX + TRACE_MARGIN, maxZ: maxZ + TRACE_MARGIN,
  };
  for (let k = 0; k < nNode; k++) {
    if (roadCells.has(gkey(nodePx[k], nodePz[k], NODE_CELL))) continue;
    const kind = nodeKind[k];
    const width = nodeW[k];
    trace.p.length = 0;
    trace.kind = kind;
    trace.districtId = districtAt(chunk, minX, minZ, size, nodePx[k], nodePz[k]);
    traceOne(plan, nodePx[k], nodePz[k], 1, kind, width, box, trace);
    traceOne(plan, nodePx[k], nodePz[k], -1, kind, width, box, trace);
    if (trace.p.length / 5 < 2) continue;
    for (let q = 0; q < trace.p.length; q += 5) {
      roadCells.add(gkey(trace.p[q], trace.p[q + 1], NODE_CELL));
    }

    clipToChunk(trace, minX, minZ, maxX, maxZ);
    if (trace.to - trace.from < 1) continue;
    emitTrace(
      bld, chunk, plan, trace, lod, rng, lights, footwayCells, pendingMarket, pendingFire,
      marketSeenKeys, marketState, minX, minZ, size, res, lightCap,
    );
    res.roads++;
  }

  // --- adjudicate the market's offered lights, once, for the whole chunk.
  //
  // Nearest-to-chunk-centre first, because the budget cannot light every lantern
  // and a light 200m away inside the same chunk is worth much less than one 10m
  // away. First-come by trace order put the whole budget on whichever carriageway
  // happened to be traced first.
  if (pendingMarket.length > 0) {
    // Nearest to the MARKET SPINE, not to the chunk centre.
    //
    // This is the fourth thing that had to be wrong for the aisle to be dark, and
    // it is the subtlest because every earlier version of this sort looked
    // reasonable. Measured on chunk (0,-1): the chunk is 256m square and its
    // centre sits 173m from the market spine it contains, so sorting by distance
    // to the chunk centre selects the FAR END OF THE MARKET every time —
    // `dPool` 111-184m for the eight lights it picked, against 5.8-12.1m for the
    // ones actually over the aisle. Deck irradiance at the pool was exactly 0.000.
    //
    // A chunk has no idea where the viewer will stand, so "nearest to what" has
    // to be something intrinsic to the lights. The market's own geometry is:
    // lanterns come from catenary cords strung along the spine, so the spine is
    // recoverable as the principal axis of the lantern set itself — the direction
    // of greatest spread. Sorting along that axis from its midpoint puts the
    // middle of the market first, which is where a flythrough spends its time and
    // which is the only choice that is not wrong from every viewpoint at once.
    const key = spineDistance(pendingMarket);
    const ordered = [...pendingMarket].sort((a, b) => key(a) - key(b));
    // Reserved share of the chunk budget: the market may take at most half, so
    // lamp posts are never starved outright, and at most `MAX_MARKET_LIGHTS_PER_CHUNK`
    // in total however many traces offered them.
    const room = Math.max(0, Math.min(
      MAX_MARKET_LIGHTS_PER_CHUNK,
      lightCap - (lights.length - res.clutter.stallLights),
      Math.floor((lightCap - (lights.length - res.clutter.stallLights) + maxLights) * 0.5),
    ));
    let added = 0;
    for (const l of ordered) {
      if (added >= room) break;
      lights.push(l);
      added++;
    }
    res.clutter.marketLights = added;
    res.clutter.marketLightsDropped = pendingMarket.length - added;
  }
  // Footway braziers take what the market left. Spent as they were placed, they
  // came out of the same budget first: chunk (0,-1) then dropped 11 of its 48
  // lanterns, and the middle-first order drops the spine's ends, which is where
  // pose 09 stands (the origin is a chunk corner). The aisle went black (review 6).
  for (const l of pendingFire) {
    if (lights.length - res.clutter.stallLights >= lightCap) break;
    lights.push(l);
  }

  res.fieldMs = Date.now() - t0;
  res.triangles = (bld.indexCount - before) / 3;
  return res;
}

/** True when both endpoints of segment `i` lie inside the chunk rectangle. */
function inRect(x: number, z: number, minX: number, minZ: number, maxX: number, maxZ: number): boolean {
  return x >= minX && x <= maxX && z >= minZ && z <= maxZ;
}

function segInside(
  t: Trace, i: number, minX: number, minZ: number, maxX: number, maxZ: number,
): boolean {
  for (const k of [i, i + 1]) {
    if (!inRect(t.p[k * 5], t.p[k * 5 + 1], minX, minZ, maxX, maxZ)) return false;
  }
  return true;
}

/**
 * Push a point out of the carriageway until the street field agrees it is out.
 *
 * This is not an optimisation, it is a correctness fix. `sampleStreetPlan`
 * evaluates the domain warp `warpAt(x, z)` **at the query point**, so for the
 * grid families `out.dist` is the distance to a line whose position depends on
 * where you asked from — it is an approximate distance, not a true one, and the
 * warp gradient is around 1.5 m per metre. Offsetting perpendicular to a traced
 * centreline by `width/2` therefore does NOT land at distance `width/2` when you
 * re-sample.
 *
 * The only definition of "the carriageway edge" that is consistent with the rest
 * of the city is the one `sampleStreetPlan` gives at the point in question —
 * which is also how `makeBuilding` decides its setbacks. So the edge is *found*
 * rather than computed: step out until `clearance >= 0`.
 *
 * ONE query per call, not a bisection. The offset varies smoothly along a road,
 * so the previous segment's answer predicts this one and the single query only
 * has to measure the residual. Counting was necessary to find this: the
 * two-query version made 17147 field calls per chunk, and at the measured
 * 1.9us per call that was the entire 28ms of this function — not the geometry,
 * which is 1.5ms.
 */
function edgeOffset(
  plan: CityPlan, cx: number, cz: number, nx: number, nz: number,
  hint: number, maxR: number,
): number {
  const s = sampleStreetPlan(plan, cx + nx * hint, cz + nz * hint, tmpSample);
  // Correct by the measured residual in BOTH directions. Returning `hint`
  // unchanged when the point is already outside the carriageway looks like the
  // obvious optimisation and is the wrong one: the offset then only ever grows,
  // and it drifts. Measured, that cost p50 3.16m of kerb accuracy against
  // 0.39m — the same code with one line removed, and nothing threw.
  return Math.min(maxR, Math.max(0.1, hint - s.clearance));
}

// ---------------------------------------------------------------- clutter

/**
 * Hard ceiling on furniture per chunk, in triangles.
 *
 * Not a taste decision — a budget decision, arrived at by measurement. A chunk
 * already carries ~87k triangles; the kerbs and footways added ~9k. Street
 * furniture at `clutterDensity` items per 100m over the ~6.1km of footway a
 * chunk contains works out to 180 items at a mid-density district and 980 in
 * the market spine, which at 30..200 triangles each is 24k..78k — more than the
 * whole rest of the chunk. So furniture is placed in street order until the
 * budget is gone — as a uniform throttle rather than a cut-off, see the comment
 * at the placement site — and `clutterPlaced` / `clutterWanted` are reported so
 * the shortfall is visible rather than silent.
 *
 * Raised to 12000 for D30 (2026-10-13) and put back the same day: with the
 * lived-in kits and alleys it doubled footway furniture in the hero's nine near
 * chunks (51k -> 101k triangles), every shadow cascade re-renders it, and the
 * hero fell to 57/s (session-end A/B). At 9000 the throttle keeps the lived
 * kinds, sparser. Market islands are not in this budget
 * (`GroundBakeResult.islands`).
 */
const CLUTTER_TRIS = 9000;

/**
 * Compensates the mean of the clump/open gap draw so the AUTHORED
 * `clutterDensity` still means "items per 100 m of footway" after clustering.
 *
 * The two regimes draw gaps in 0.22..0.72 (clump) and 1.7..3.4 (open stretch),
 * 66/34. Their mean is 0.69; without a correction the realised count is 1/0.69
 * = 1.45x the authored density, and with the wider non-clustering gaps of round 1
 * the clustering cost 60% of the items outright (182 -> 70 measured). This is the
 * number that makes "rearranged" true rather than "reduced".
 */
const CLUSTER_MEAN = 1.45;

/**
 * Prop-local point -> world, yawing the item to face the carriageway. `yaw` is
 * the same angle in `MeshBuilder`'s `rotationY` convention: boxes must be given
 * it too, or they stay world-aligned while their positions turn (every clutter
 * box was, until D30's chairs at angles made it visible).
 */
type Placer = ((x: number, y: number, z: number) => Vec3) & { yaw: number };

/** Build a placer that puts local +Z toward `face` and local +Y at `y`. */
const placer = (x: number, y: number, z: number, faceX: number, faceZ: number): Placer => {
  const a = Math.atan2(faceX, faceZ);
  const c = Math.cos(a), s = Math.sin(a);
  const P = (lx: number, ly: number, lz: number): Vec3 => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
  return Object.assign(P, { yaw: a });
};

/** Yaw jitter, radians, a loose kind may take on a footway (D30 rule 3). Long items stay near square to the wall. */
const LOOSE_YAW: Record<string, number> = {
  'cafe-set': 0.35, barrel: Math.PI, sacks: Math.PI, 'doorstep-pots': Math.PI, brazier: Math.PI,
  pallet: 0.3, 'kiln-stock': 0.3, handcart: 0.2, bicycle: 0.08, firewood: 0.06,
};

const METAL: Vec3 = [0.16, 0.17, 0.18];
/**
 * The gutter strip along the kerb line. Dark, and very slightly cooler than the
 * carriageway: it is the road's own shadow plus the dirt that collects in a
 * channel, and it is what gives a kerb its "visible joint against the road" at
 * the spec's three-metre bar. Value is a fraction of the darkest authored band
 * (asphalt, 0.150) so it stays the darkest thing on the ground at any district.
 */
//
// Lifted 2026-10-11 from [0.048, 0.052, 0.058] (~1/3 of asphalt): the Round 13
// vision verdict read the near-black strip as a channel cut into the road
// rather than the joint under a raised kerb ("the contrast is too isolating").
// That strip was all GUTTER: it covered the meeting line (see the bake).
const GUTTER: Vec3 = [0.075, 0.079, 0.086];
/**
 * The kerb/road meeting line. Darker than the gutter by design: this is the
 * shadowed gap between two stones, and the gutter either side is the graded
 * shadow that makes it read as a joint rather than as a stripe.
 */
const DEEP_JOINT: Vec3 = [0.030, 0.031, 0.035];   // was [0.020, 0.021, 0.024]; the 10 cm line stays crisp
const DARK: Vec3 = [0.055, 0.058, 0.062];
const TIMBER: Vec3 = [0.26, 0.17, 0.10];
const LEAF: Vec3 = [0.075, 0.21, 0.055];
// D30 pieces. Warm, used materials; the ember is the only emitter (D28 amber).
const LEAVES: readonly Vec3[] = [LEAF, [0.11, 0.26, 0.06], [0.16, 0.30, 0.07]];
const BARK: Vec3 = [0.19, 0.13, 0.08];
const POT: Vec3 = [0.46, 0.20, 0.10];
const BURLAP: Vec3 = [0.42, 0.33, 0.20];
const IRON: Vec3 = [0.085, 0.085, 0.095];
const BRICK: Vec3 = [0.40, 0.15, 0.08];
const EMBER: Vec3 = [1.0, 0.45, 0.14];
const PALE_TIMBER: Vec3 = [0.40, 0.30, 0.18];
const BARREL_PAINT: readonly Vec3[] = [[0.36, 0.14, 0.07], [0.17, 0.25, 0.33], [0.30, 0.20, 0.11]];
/** Island stone: the market's kerb paint read every island as a yellow disc. */
const STONE: Vec3 = [0.34, 0.30, 0.25];
/**
 * Island paintwork, one per island, from sheet A: saffron, coral, teal, leaf green,
 * cream. Review 6 read the muted set (green, ox-red, cream, blue-grey) as neutral.
 */
const ISLAND_PAINT: readonly Vec3[] = [[0.80, 0.48, 0.08], [0.72, 0.20, 0.13], [0.07, 0.40, 0.42], [0.22, 0.46, 0.20], [0.78, 0.70, 0.52]];
/** Parasol stripes alternate a sheet-A colour with cream. */
const PARASOL_CLOTH: readonly Vec3[] = [[0.84, 0.50, 0.08], [0.76, 0.20, 0.13], [0.06, 0.42, 0.45], [0.55, 0.14, 0.10], [0.24, 0.48, 0.22]];
const CREAM: Vec3 = [0.82, 0.76, 0.60];
/** Crown greens for the island tree: yellower than LEAVES, after sheet D (review 6). */
const CROWN: readonly Vec3[] = [[0.12, 0.27, 0.06], [0.18, 0.34, 0.08], [0.25, 0.40, 0.10], [0.15, 0.31, 0.05]];
/** Festoon bulbs in a tree: amber (D28), emissive only, no light budget. */
const FESTOON: Vec3 = [1.0, 0.70, 0.36];
/** A seated figure's clothes and skin, drawn per figure. */
const SHIRTS: readonly Vec3[] = [[0.78, 0.46, 0.10], [0.70, 0.20, 0.14], [0.08, 0.38, 0.42], [0.80, 0.74, 0.58], [0.20, 0.24, 0.42], [0.26, 0.44, 0.20]];
const TROUSERS: readonly Vec3[] = [[0.10, 0.10, 0.13], [0.22, 0.17, 0.12], [0.14, 0.18, 0.26]];
const SKIN: readonly Vec3[] = [[0.62, 0.42, 0.30], [0.45, 0.29, 0.19], [0.30, 0.19, 0.12], [0.70, 0.52, 0.40]];

/**
 * Someone sitting, facing local +Z, seat at 0.45 m (a chair's or a ring bench's).
 * Static: the crowd's walkers animate, a sitter does not need to. 108 triangles.
 */
function pushSitter(bld: MeshBuilder, P: Placer, rng: Rng): void {
  const o = { faces: FACE_ALL, rotationY: P.yaw };
  const shirt = SHIRTS[rng.int(0, SHIRTS.length - 1)], legs = TROUSERS[rng.int(0, TROUSERS.length - 1)];
  const skin = SKIN[rng.int(0, SKIN.length - 1)];
  const lean = rng.range(-0.04, 0.06);
  bld.pushBox(P(0, 0.52, 0.12), [0.16, 0.07, 0.2], legs, o);                       // thighs
  for (const sx of [-0.08, 0.08]) bld.pushBox(P(sx, 0.24, 0.31), [0.06, 0.24, 0.06], legs, o);   // shins
  bld.pushBox(P(0, 0.86, -0.06 + lean), [0.17, 0.27, 0.1], shirt, o);                 // torso
  for (const sx of [-0.21, 0.21]) bld.pushBox(P(sx, 0.82, 0.04 + lean), [0.045, 0.2, 0.06], shirt, o); // arms
  bld.pushSphere(P(0, 1.25, -0.03 + lean * 1.4), 0.11, 3, 6, skin);
}

/** A chair whose sitter faces local +Z: seat, back, two side frames. 48 triangles. */
function pushChair(bld: MeshBuilder, P: Placer, color: Vec3): void {
  const o = { faces: FACE_ALL, rotationY: P.yaw };
  bld.pushBox(P(0, 0.45, 0), [0.21, 0.025, 0.21], color, o);
  bld.pushBox(P(0, 0.7, -0.19), [0.2, 0.22, 0.02], color, o);
  for (const sx of [-0.19, 0.19]) bld.pushBox(P(sx, 0.21, 0), [0.02, 0.21, 0.19], METAL, o);
}

/** Placer for a sub-part at local (lx, lz), turned by `yaw` more than its parent. */
const sub = (P: Placer, lx: number, lz: number, yaw: number): Placer => {
  const o = P(lx, 0, lz);
  const a = P.yaw + yaw;
  return placer(o[0], o[1], o[2], Math.sin(a), Math.cos(a));
};

export interface ClutterTally {
  placed: number;
  wanted: number;
  tris: number;
  lamps: number;
  /**
   * Market lanterns whose light was harvested into `lights`, counted separately
   * from `lamps` on purpose: `lamps` means "a lamp-post was placed", and this
   * means "a light reached the render buffer". Conflating them is how a count
   * comes to agree with itself and disagree with the frame — which is the bug
   * this number exists to make impossible.
   */
  marketLights: number;
  /** Market lanterns the grammar produced that the chunk budget refused. */
  marketLightsDropped: number;
  /** Distinct market carriageways in this chunk, i.e. grammar queries made. */
  marketTraces: number;
  /** Stall lamp lights delivered, from their own budget. */
  stallLights: number;
}

/**
 * One piece of street furniture.
 *
 * Every shape here is authored for a low triangle count on purpose: a bollard is
 * 6 sides and a cap, a drain cover is a single quad. The silhouette and the
 * colour carry the read at the distances these are actually seen, and a street
 * with 300 objects on it has to pay for all of them.
 */
function pushClutterItem(
  bld: MeshBuilder, kind: string, P: Placer, pal: ClutterPalette, rng: Rng, tally: ClutterTally,
): void {
  const before = bld.indexCount;
  switch (kind) {
    case 'bollard':
      bld.pushCylinder(P(0, 0, 0), P(0, 0.95, 0), 0.075, 6, pal.kerb, { capEnds: true });
      break;
    case 'drain-cover':
    case 'puddle-grate':
      // Flat in the carriageway plane. A dark recessed quad with a bar or two
      // across it reads as a gully at every distance that matters.
      bld.pushQuad(P(-0.28, 0.012, -0.28), P(0.28, 0.012, -0.28), P(0.28, 0.012, 0.28), P(-0.28, 0.012, 0.28), DARK, 1, { normals: UP4 });
      for (let i = -1; i <= 1; i++) {
        bld.pushQuad(
          P(-0.24, 0.02, i * 0.12), P(0.24, 0.02, i * 0.12), P(0.24, 0.02, i * 0.12 + 0.05), P(-0.24, 0.02, i * 0.12 + 0.05),
          METAL, 1, { normals: UP4 },
        );
      }
      break;
    case 'manhole':
      bld.pushCylinder(P(0, 0.008, 0), P(0, 0.03, 0), 0.33, 8, pal.kerb, { capEnds: true });
      break;
    case 'bench':
      bld.pushBox(P(0, 0.44, 0), [0.9, 0.05, 0.24], TIMBER, { faces: FACE_PY | FACE_NY, rotationY: P.yaw });
      bld.pushBox(P(0, 0.68, -0.22), [0.9, 0.22, 0.04], TIMBER, { faces: FACE_ALL, rotationY: P.yaw });
      for (const sx of [-0.78, 0.78]) bld.pushBox(P(sx, 0.22, 0), [0.05, 0.22, 0.22], METAL, { faces: FACE_ALL, rotationY: P.yaw });
      break;
    case 'bin':
      bld.pushCylinder(P(0, 0, 0), P(0, 0.78, 0), 0.26, 7, pal.metal, { capEnds: false });
      bld.pushCylinder(P(0, 0.78, 0), P(0, 0.86, 0), 0.29, 7, pal.metal, { radiusTop: 0.2, capEnds: true });
      break;
    case 'planter':
      bld.pushBox(P(0, 0.22, 0), [0.42, 0.22, 0.42], pal.kerb, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushSphere(P(0, 0.62, 0), 0.4, 6, 3, LEAF);
      break;
    case 'potted-palm':
      bld.pushCylinder(P(0, 0, 0), P(0, 0.4, 0), 0.3, 7, pal.trim, { capEnds: true });
      bld.pushCylinder(P(0, 0.4, 0), P(0, 1.5, 0), 0.08, 5, TIMBER);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        bld.pushSphere(P(Math.cos(a) * 0.34, 1.62, Math.sin(a) * 0.34), 0.38, 5, 3, LEAF);
      }
      break;
    case 'lamp-post':
      // Retained only where a grammar has a reason for a standing lamp (a
      // bollard-line kerb, a market edge). Given a base plate and a stay arm so
      // that it is a post and not a floating stick — the spec's bar is
      // "support and attachment", and it distinguishes a real lamp post from a
      // bollard by exactly that.
      bld.pushCylinder(P(0, 0, 0), P(0, 4.6, 0), 0.085, 5, pal.metal, { capEnds: false });
      bld.pushCylinder(P(0, 0, 0), P(0, 0.14, 0), 0.17, 6, pal.metal, { capEnds: true });
      bld.pushTubeAlongPath([P(0, 3.5, 0), P(0, 4.35, -0.5)], 0.03, 3, pal.metal, { capEnds: false });
      bld.pushBox(P(0, 4.42, 0), [0.10, 0.07, 0.42], pal.metal, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushBox(P(0, 4.3, 0.56), [0.20, 0.06, 0.26], [1.0, 0.86, 0.62], { faces: FACE_ALL, emissive: 4.6, rotationY: P.yaw });
      tally.lamps++;
      break;
    case 'hydrant':
      bld.pushCylinder(P(0, 0, 0), P(0, 0.62, 0), 0.14, 6, pal.accent, { capEnds: true });
      bld.pushCylinder(P(0, 0.62, 0), P(0, 0.74, 0), 0.1, 6, pal.accent, { radiusTop: 0.04, capEnds: true });
      break;
    case 'bike-rack':
      for (let i = 0; i < 3; i++) {
        bld.pushTubeAlongPath(
          [P(-0.7, 0, -0.3 + i * 0.3), P(-0.7, 0.62, -0.3 + i * 0.3), P(0.7, 0.62, -0.3 + i * 0.3), P(0.7, 0, -0.3 + i * 0.3)],
          0.03, 4, pal.metal, { capEnds: false },
        );
      }
      break;
    case 'crate-stack':
      for (let i = 0; i < 3; i++) {
        bld.pushBox(P(rng.jitter(0.1), 0.2 + i * 0.4, rng.jitter(0.1)), [0.32, 0.2, 0.28], TIMBER, { faces: FACE_ALL, rotationY: P.yaw + rng.jitter(0.4) });
      }
      break;
    case 'spool':
    case 'cable-spool':
      bld.pushCylinder(P(0, 0, -0.3), P(0, 0, 0.3), 0.55, 8, TIMBER, { capEnds: true });
      bld.pushCylinder(P(0, 0, -0.32), P(0, 0, -0.26), 0.78, 8, TIMBER, { capEnds: true });
      bld.pushCylinder(P(0, 0, 0.26), P(0, 0, 0.32), 0.78, 8, TIMBER, { capEnds: true });
      break;
    case 'postbox':
      bld.pushBox(P(0, 0.6, 0), [0.24, 0.6, 0.18], pal.accent, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushBox(P(0, 1.22, 0), [0.26, 0.04, 0.2], pal.accent, { faces: FACE_ALL, rotationY: P.yaw });
      break;
    case 'newspaper-box':
      bld.pushBox(P(0, 0.28, 0), [0.22, 0.28, 0.18], pal.accent, { faces: FACE_ALL, rotationY: P.yaw });
      for (const sx of [-0.16, 0.16]) bld.pushBox(P(sx, 0.06, 0), [0.03, 0.06, 0.03], METAL, { faces: FACE_ALL, rotationY: P.yaw });
      break;
    case 'kiosk':
      bld.pushBox(P(0, 1.1, 0), [1.1, 1.1, 0.8], pal.trim, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushQuad(P(-1.2, 2.55, -0.6), P(1.2, 2.55, -0.6), P(1.2, 2.3, 0.7), P(-1.2, 2.3, 0.7), pal.accent, 1, { doubleSided: true });
      bld.pushBox(P(0, 2.66, 0.66), [0.9, 0.18, 0.03], pal.accent, { faces: FACE_ALL, rotationY: P.yaw });
      for (const sx of [-1.05, 1.05]) bld.pushCylinder(P(sx, 2.2, 0.68), P(sx, 2.36, 0.68), 0.03, 3, pal.metal, { capEnds: false });
      bld.pushBox(P(0, 0.5, 0.42), [0.9, 0.5, 0.04], pal.metal, { faces: FACE_ALL, rotationY: P.yaw });
      break;
    case 'phone-box':
      bld.pushBox(P(0, 1.1, 0), [0.42, 1.1, 0.34], pal.accent, { faces: FACE_ALL, rotationY: P.yaw });
      break;
    case 'sandbag':
      for (let i = 0; i < 3; i++) {
        bld.pushBox(P(0, 0.11 + i * 0.2, 0), [0.34, 0.1, 0.2], pal.kerb, { faces: FACE_ALL, rotationY: P.yaw + i * 0.3 });
      }
      break;
    case 'sandwich-board':
      for (const s of [-1, 1]) {
        bld.pushQuad(P(-0.3, 0.9, s * 0.1), P(0.3, 0.9, s * 0.1), P(0.3, 0, s * 0.34), P(-0.3, 0, s * 0.34), DARK, 1, { doubleSided: true });
      }
      break;

    // ------------------------------------------------------------------
    // Reference-evidenced kinds. See the evidence table on CLUTTER_KINDS in
    // groundgrammar.ts for what each of these is based on and what is not.
    //
    // The spec's three-metre bar governs the shapes: "the viewer must distinguish
    // surface, joint, edge, SUPPORT and ATTACHMENT", and "nothing floats
    // unattached". So every object below that touches a wall has a visible arm
    // running back to it, and every object that stands on the ground has a base.
    // A floating sign panel is exactly what spec section E says our output is
    // missing: "the supplied foreground has no comparable sign silhouettes,
    // brackets or local light accents".
    // ------------------------------------------------------------------
    case 'railing': {
      // Spec B: "6-10 main nearby stanchions", "main supports, horizontal rails
      // and thinner infill have distinct thicknesses". So: a heavy top rail, a
      // lighter mid rail, and thin infill — three thicknesses, not one.
      // Height 1.0m: the spec's own human-scale estimate is 0.9-1.1m.
      const L = 2.0;
      bld.pushTubeAlongPath([P(-L / 2, 1.0, 0), P(L / 2, 1.0, 0)], 0.032, 4, pal.metal, { capEnds: false });
      bld.pushTubeAlongPath([P(-L / 2, 0.58, 0), P(L / 2, 0.58, 0)], 0.022, 3, pal.metal, { capEnds: false });
      for (let i = 0; i <= 3; i++) {
        const x = -L / 2 + (L * i) / 3;
        bld.pushTubeAlongPath([P(x, 0, 0), P(x, 1.0, 0)], 0.038, 4, pal.metal, { capEnds: false });
        // Base plate: the post has to meet something.
        bld.pushBox(P(x, 0.02, 0), [0.09, 0.02, 0.09], pal.metal, { faces: FACE_ALL, rotationY: P.yaw });
      }
      break;
    }
    case 'bracket': {
      // A wall bracket. Local -Z is toward the building line (see `placer`), so
      // the arm runs back and UP into the facade — the attachment is the point.
      bld.pushTubeAlongPath([P(0, 2.35, 0), P(0, 2.35, -0.75)], 0.045, 4, pal.metal, { capEnds: false });
      bld.pushTubeAlongPath([P(0, 2.35, -0.75), P(0, 1.95, -0.75)], 0.035, 4, pal.metal, { capEnds: false });
      bld.pushTubeAlongPath([P(0, 2.05, -0.05), P(0, 2.35, -0.70)], 0.022, 3, pal.metal, { capEnds: false });
      bld.pushBox(P(0, 2.42, 0.02), [0.11, 0.16, 0.06], pal.metal, { faces: FACE_ALL, rotationY: P.yaw });
      break;
    }
    case 'lamp-bracket': {
      // Spec C: "10+ small warm lamp points along successive galleries,
      // including lamps on or beside railings". Spec B: lighting is "attached
      // to fronts rather than organised as a boulevard of identical lamp posts".
      // So this is a short arm off the front with a small warm head on it — and
      // the head is EMISSIVE, which until round 2 was written into a channel the
      // shader threw away.
      bld.pushTubeAlongPath([P(0, 3.05, 0), P(0, 3.15, -0.55)], 0.05, 4, pal.metal, { capEnds: false });
      bld.pushTubeAlongPath([P(0, 3.15, -0.55), P(0, 2.95, -0.62)], 0.035, 4, pal.metal, { capEnds: false });
      bld.pushBox(P(0, 3.1, 0.03), [0.1, 0.18, 0.05], pal.metal, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushBox(P(0, 2.88, -0.62), [0.13, 0.09, 0.13], [1.0, 0.68, 0.32], { faces: FACE_ALL, emissive: 4.2, rotationY: P.yaw });
      tally.lamps++;
      break;
    }
    case 'projecting-sign': {
      // Spec B: "thin framed objects with luminous faces, warm yellow/orange/red
      // colour and DARK ATTACHMENT ARMS", 5-8 of them in the near frame.
      // Local +Z faces the street, so the panel faces the road and the arms run
      // back to the facade.
      bld.pushTubeAlongPath([P(-0.32, 2.9, -0.04), P(-0.32, 2.9, -0.5)], 0.028, 3, pal.metal, { capEnds: false });
      bld.pushTubeAlongPath([P(0.32, 2.9, -0.04), P(0.32, 2.9, -0.5)], 0.028, 3, pal.metal, { capEnds: false });
      bld.pushBox(P(0, 2.9, -0.04), [0.42, 0.36, 0.035], pal.metal, { faces: FACE_ALL, rotationY: P.yaw });
      // The luminous face. Emissive 3.4 — under the 5.5 of a PropKind.Lantern,
      // because a sign panel is a large area and a large emissive area blooms out.
      bld.pushBox(P(0, 2.9, 0.02), [0.36, 0.3, 0.02], pal.accent, { faces: FACE_ALL, emissive: 3.4, rotationY: P.yaw });
      break;
    }
    case 'awning': {
      // Spec B02: "two conspicuous pale fabric-like tarps, stretched across
      // projecting members at altitude". Not confirmed as a market shelter.
      bld.pushQuad(P(-0.85, 2.5, 0.15), P(0.85, 2.5, 0.15), P(0.85, 2.05, 0.95), P(-0.85, 2.05, 0.95),
        pal.trim, 1, { doubleSided: true });
      for (const s of [-0.72, 0.72]) {
        bld.pushTubeAlongPath([P(s, 2.5, 0), P(s, 2.5, -0.32)], 0.03, 3, pal.metal, { capEnds: false });
        bld.pushTubeAlongPath([P(s, 2.5, -0.32), P(s, 2.02, 0.88)], 0.025, 3, pal.metal, { capEnds: false });
      }
      break;
    }
    case 'balcony': {
      // Spec D: "Balconies and exterior framework — railings, narrow platforms
      // and struts visibly attach to fronts. They do not float independently of
      // the architecture."
      bld.pushQuad(P(-0.9, 3.4, -0.1), P(0.9, 3.4, -0.1), P(0.9, 3.4, 0.95), P(-0.9, 3.4, 0.95),
        pal.trim, 1, { normals: UP4 });
      // Underside: the street sees this platform from below.
      bld.pushQuad(P(-0.9, 3.4, -0.1), P(0.9, 3.4, -0.1), P(0.9, 3.4, 0.95), P(-0.9, 3.4, 0.95),
        pal.trim, 1, { normals: [[0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0]] });
      bld.pushQuad(P(-0.9, 3.1, 0.95), P(0.9, 3.1, 0.95), P(0.9, 3.4, 0.95), P(-0.9, 3.4, 0.95),
        pal.trim, 1, { normals: UP4 });
      for (const s of [-0.78, 0.78]) {
        bld.pushTubeAlongPath([P(s, 3.1, 0.9), P(s, 4.05, 0.9)], 0.028, 3, pal.metal, { capEnds: false });
        bld.pushTubeAlongPath([P(s, 3.15, -0.06), P(s, 3.15, 0.9)], 0.022, 3, pal.metal, { capEnds: false });
        bld.pushTubeAlongPath([P(s, 2.75, 0.1), P(s, 3.4, 0.82)], 0.03, 3, pal.metal, { capEnds: false });
      }
      bld.pushTubeAlongPath([P(-0.9, 4.05, 0.9), P(0.9, 4.05, 0.9)], 0.03, 4, pal.metal, { capEnds: false });
      bld.pushTubeAlongPath([P(-0.9, 3.6, 0.9), P(0.9, 3.6, 0.9)], 0.02, 3, pal.metal, { capEnds: false });
      break;
    }
    case 'planter-row': {
      // Spec D: "doctrine terraces carry planting along much of their edge", and
      // "plants overlap them" — the boundary is softened, not lined. A run of
      // boxes with foliage breaking over the top.
      for (let i = 0; i < 2; i++) {
        const x = -0.55 + i * 1.1;
        bld.pushBox(P(x, 0.26, 0), [0.5, 0.26, 0.34], pal.kerb, { faces: FACE_ALL, rotationY: P.yaw });
        bld.pushSphere(P(x, 0.66, rng.jitter(0.08)), rng.range(0.36, 0.52), 5, 3, LEAF);
      }
      break;
    }
    case 'step-edge': {
      // Stairs are the dominant pedestrian surface in spec sections A and B, and
      // "stair noses and retaining edges are clear" is called out twice. One step:
      // a riser face and a tread, with the nose picked out in the kerb tone so it
      // catches light. Rise 0.18m: the spec's own estimate is 0.15-0.20m.
      const rise = 0.18;
      bld.pushQuad(P(-1.4, 0, 0.05), P(1.4, 0, 0.05), P(1.4, rise, 0.05), P(-1.4, rise, 0.05),
        pal.kerb, 1, { normals: UP4 });
      bld.pushQuad(P(-1.4, rise, 0.05), P(1.4, rise, 0.05), P(1.4, rise, 0.95), P(-1.4, rise, 0.95),
        pal.kerb, 1, { normals: UP4 });
      bld.pushQuad(P(-1.4, rise, 0.05), P(1.4, rise, 0.05), P(1.4, rise + 0.012, 0.05), P(-1.4, rise + 0.012, 0.05),
        pal.trim, 1, { normals: UP4 });
      break;
    }
    // ------------------------------------------------------------------
    // D30: things people use and leave. Owner direction, not reference-
    // derived (see the kits in groundgrammar.ts). Same rule as above: every
    // standing thing has a base, nothing floats.
    // ------------------------------------------------------------------
    case 'cafe-set': {
      // Against a front: a small table and two chairs either side of it,
      // never square to the wall.
      bld.pushCylinder(P(0, 0, 0), P(0, 0.72, 0), 0.04, 4, METAL, { capEnds: false });
      bld.pushCylinder(P(0, 0.72, 0), P(0, 0.75, 0), 0.32, 8, TIMBER, { capEnds: true });
      for (const sx of [-1, 1]) pushChair(bld, sub(P, sx * 0.56, 0.02, -sx * (1.3 + rng.jitter(0.4))), rng.bool(0.5) ? TIMBER : pal.trim);
      break;
    }
    case 'cafe-table':
      bld.pushCylinder(P(0, 0, 0), P(0, 0.72, 0), 0.045, 4, METAL, { capEnds: false });
      bld.pushCylinder(P(0, 0, 0), P(0, 0.04, 0), 0.24, 6, METAL, { capEnds: true });
      bld.pushCylinder(P(0, 0.72, 0), P(0, 0.76, 0), 0.42, 8, rng.bool(0.5) ? TIMBER : pal.trim, { capEnds: true });
      if (rng.bool(0.6)) bld.pushCylinder(P(rng.jitter(0.15), 0.76, rng.jitter(0.15)), P(0, 0.85, 0), 0.04, 5, pal.trim, { capEnds: true });
      break;
    case 'chair':
      pushChair(bld, P, rng.bool(0.5) ? TIMBER : pal.trim);
      break;
    case 'parasol': {
      // Eight panels in alternating stripes: a striped canopy is the market's
      // read above a crowd, where the table under it is hidden (review 6).
      // Edge at 2.2 m, crown 2.8 m: above a 1.7 m crowd from eye height.
      bld.pushCylinder(P(0, 0.76, 0), P(0, 2.75, 0), 0.03, 4, METAL, { capEnds: false });
      const a = PARASOL_CLOTH[rng.int(0, PARASOL_CLOTH.length - 1)], b = rng.bool(0.7) ? CREAM : a;
      const top = P(0, 2.82, 0);
      for (let k = 0; k < 8; k++) {
        const t0 = (k / 8) * Math.PI * 2, t1 = ((k + 1) / 8) * Math.PI * 2;
        const e0 = P(Math.cos(t0) * 1.55, 2.2, Math.sin(t0) * 1.55), e1 = P(Math.cos(t1) * 1.55, 2.2, Math.sin(t1) * 1.55);
        bld.pushQuad(e0, e1, top, top, k % 2 ? a : b, 1, { doubleSided: true });
      }
      break;
    }
    case 'sitter':
      pushSitter(bld, P, rng);
      break;
    case 'tree': {
      // Review 6: four to six big 6-sided balls in a tight knot read as a dark
      // lollipop by day and a black hexagon against the lanterns at night. Now:
      // a trunk that forks into limbs, a crown of 8-11 smaller masses spread wide
      // and uneven (the outline is lumps, not a polygon), shading normals bent up
      // so the crown is lit as one canopy rather than balls with black bellies,
      // and festoon bulbs on its outer masses so it reads at night. ~950 triangles.
      // Street-tree scale: the crown has to clear a standing crowd to be seen at all.
      const fork = rng.range(2.1, 2.6);
      bld.pushCylinder(P(0, 0, 0), P(0, fork + 0.2, 0), 0.2, 7, BARK, { radiusTop: 0.13, capEnds: false });
      const n = rng.int(8, 11), spin = rng.next() * 6.28;
      const masses: [Vec3, number][] = [];
      for (let i = 0; i < n; i++) {
        // Golden-angle spiral, jittered: even cover with no ring or grid in it.
        const a = spin + i * 2.4 + rng.jitter(0.5), d = i === 0 ? rng.range(0, 0.3) : rng.range(0.7, 1.9);
        const y = fork + 1.0 + (1 - d / 1.9) * rng.range(1.0, 2.0) + rng.jitter(0.35);
        const rad = rng.range(0.6, 1.05) * (i === 0 ? 1.15 : 1);
        const c = P(Math.cos(a) * d, y, Math.sin(a) * d);
        masses.push([c, rad]);
        // Sun-side and upper masses a touch lighter: value variation inside the crown.
        const g = CROWN[rng.int(0, CROWN.length - 1)], lit = 0.85 + (y - fork) * 0.07;
        bld.pushSphere(c, rad, 5, 8, [g[0] * lit, g[1] * lit, g[2] * lit], { normalLift: 0.75 });
        // Limbs to the outer masses only: the inner ones hide the join.
        if (d > 1.1 && i % 2 === 0) {
          bld.pushTubeAlongPath([P(0, fork, 0), P(Math.cos(a) * d * 0.55, y - rad * 0.9, Math.sin(a) * d * 0.55)], 0.07, 4, BARK, { capEnds: false });
        }
      }
      const bulbs = rng.int(7, 10);
      for (let k = 0; k < bulbs; k++) {
        const [c, rad] = masses[1 + (k % (masses.length - 1))];
        const o = P(0, 0, 0), dx = c[0] - o[0], dz = c[2] - o[2], dl = Math.hypot(dx, dz) || 1;
        bld.pushSphere([c[0] + (dx / dl) * rad * 0.97, c[1] - rad * rng.range(0.1, 0.5), c[2] + (dz / dl) * rad * 0.97],
          0.075, 2, 4, FESTOON, { emissive: 6 });
      }
      break;
    }
    case 'ring-bench': {
      // A raised octagonal planter ring with a timber seat on it, round a tree pit.
      bld.pushCylinder(P(0, 0, 0), P(0, 0.4, 0), 1.12, 8, pal.kerb, { capEnds: true });
      bld.pushCylinder(P(0, 0.4, 0), P(0, 0.5, 0), 0.6, 8, pal.kerb, { capEnds: false });
      bld.pushCylinder(P(0, 0.49, 0), P(0, 0.5, 0), 0.58, 8, DARK, { capEnds: true });
      for (let k = 0; k < 8; k++) {
        // Seat slats along the ring's tangent: local X onto (-sin, cos) is yaw -phi - pi/2.
        const phi = (k / 8) * Math.PI * 2 + Math.PI / 8;
        bld.pushBox(P(Math.cos(phi) * 0.88, 0.43, Math.sin(phi) * 0.88), [0.34, 0.03, 0.2], TIMBER,
          { faces: FACE_ALL, rotationY: P.yaw - phi - Math.PI / 2 });
      }
      break;
    }
    case 'pump': {
      // A cast-iron street pump over a stone trough.
      bld.pushBox(P(0, 0.25, 0.32), [0.55, 0.25, 0.27], pal.kerb, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushBox(P(0, 0.49, 0.32), [0.47, 0.012, 0.2], [0.05, 0.08, 0.10], { faces: FACE_PY, rotationY: P.yaw });
      bld.pushCylinder(P(0, 0, -0.15), P(0, 1.25, -0.15), 0.1, 6, IRON, { capEnds: false });
      bld.pushSphere(P(0, 1.3, -0.15), 0.13, 3, 6, IRON);
      bld.pushTubeAlongPath([P(0, 1.02, -0.08), P(0, 1.02, 0.18), P(0, 0.9, 0.24)], 0.035, 4, IRON, { capEnds: false });
      bld.pushTubeAlongPath([P(0, 1.15, -0.22), P(0, 1.42, -0.7)], 0.025, 4, IRON, { capEnds: false });
      break;
    }
    case 'shrine': {
      bld.pushBox(P(0, 0.42, 0), [0.32, 0.42, 0.26], pal.kerb, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushQuad(P(-0.4, 1.0, -0.34), P(0.4, 1.0, -0.34), P(0.4, 1.22, 0), P(-0.4, 1.22, 0), pal.trim, 1, { doubleSided: true });
      bld.pushQuad(P(-0.4, 1.22, 0), P(0.4, 1.22, 0), P(0.4, 1.0, 0.34), P(-0.4, 1.0, 0.34), pal.trim, 1, { doubleSided: true });
      for (const sx of [-0.28, 0.28]) bld.pushCylinder(P(sx, 0.84, 0.2), P(sx, 1.08, 0.2), 0.025, 3, TIMBER, { capEnds: false });
      bld.pushBox(P(0, 0.91, 0.12), [0.07, 0.07, 0.07], [1.0, 0.70, 0.36], { faces: FACE_ALL, emissive: 3.5, rotationY: P.yaw });
      break;
    }
    case 'bicycle': {
      // Long axis along the wall (local X). Wheels are discs: spokes are below a pixel.
      const c = rng.bool(0.5) ? pal.accent : [0.42, 0.10, 0.08] as Vec3;
      for (const wx of [-0.52, 0.52]) bld.pushCylinder(P(wx, 0.33, -0.025), P(wx, 0.33, 0.025), 0.33, 10, IRON, { capEnds: true });
      bld.pushTubeAlongPath([P(-0.52, 0.33, 0), P(-0.04, 0.32, 0), P(0.32, 0.76, 0), P(-0.24, 0.78, 0), P(-0.52, 0.33, 0)], 0.022, 3, c, { capEnds: false });
      bld.pushTubeAlongPath([P(0.52, 0.33, 0), P(0.38, 0.92, 0)], 0.02, 3, c, { capEnds: false });
      bld.pushTubeAlongPath([P(0.38, 0.92, -0.22), P(0.38, 0.92, 0.22)], 0.016, 3, IRON, { capEnds: false });
      bld.pushBox(P(-0.24, 0.84, 0), [0.11, 0.025, 0.05], IRON, { faces: FACE_ALL, rotationY: P.yaw });
      break;
    }
    case 'doorstep-pots': {
      const n = rng.int(2, 3);
      for (let i = 0; i < n; i++) {
        const x = -0.28 + (i * 0.56) / Math.max(1, n - 1) + rng.jitter(0.05), r = rng.range(0.12, 0.2), h = rng.range(0.22, 0.38);
        bld.pushCylinder(P(x, 0, rng.jitter(0.05)), P(x, h, 0), r, 6, POT, { radiusTop: r * 1.18, capEnds: true });
        bld.pushSphere(P(x, h + r * 0.7, 0), r * rng.range(1.1, 1.6), 2, 5, LEAVES[rng.int(0, LEAVES.length - 1)]);
      }
      break;
    }
    case 'barrel': {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const x = (i - (n - 1) / 2) * 0.64, c = BARREL_PAINT[rng.int(0, BARREL_PAINT.length - 1)];
        if (i === n - 1 && n > 1 && rng.bool(0.35)) {
          // One on its side: rolled out and left.
          bld.pushCylinder(P(x - 0.1, 0.3, -0.44), P(x + 0.1, 0.3, 0.44), 0.3, 8, c, { capEnds: true });
          continue;
        }
        bld.pushCylinder(P(x, 0, 0), P(x, 0.88, 0), 0.3, 8, c, { capEnds: true });
        for (const y of [0.18, 0.68]) bld.pushCylinder(P(x, y, 0), P(x, y + 0.05, 0), 0.315, 8, IRON, { capEnds: false });
      }
      break;
    }
    case 'pallet': {
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        bld.pushBox(P(rng.jitter(0.06), 0.06 + i * 0.13, rng.jitter(0.04)), [0.6, 0.06, 0.2], PALE_TIMBER,
          { faces: FACE_ALL, rotationY: P.yaw + rng.jitter(0.12) });
      }
      break;
    }
    case 'brazier': {
      // An iron bowl on three legs with a live ember bed: the old town's
      // ground-level fire (sheet C). Emissive only; the light budget is the market's.
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        bld.pushTubeAlongPath([P(Math.cos(a) * 0.36, 0, Math.sin(a) * 0.36), P(Math.cos(a) * 0.2, 0.58, Math.sin(a) * 0.2)], 0.022, 3, IRON, { capEnds: false });
      }
      bld.pushCylinder(P(0, 0.55, 0), P(0, 0.82, 0), 0.22, 8, IRON, { radiusTop: 0.36, capEnds: false });
      bld.pushCylinder(P(0, 0.55, 0), P(0, 0.56, 0), 0.22, 8, IRON, { capEnds: true });
      bld.pushCylinder(P(0, 0.74, 0), P(0, 0.8, 0), 0.31, 8, EMBER, { capEnds: true, emissive: 4.0 });
      for (let i = 0; i < 3; i++) bld.pushSphere(P(rng.jitter(0.15), 0.84, rng.jitter(0.15)), rng.range(0.05, 0.09), 2, 4, EMBER, { emissive: 5.0 });
      break;
    }
    case 'firewood': {
      // Split logs stacked against the wall, three courses.
      for (let k = 0; k < 3; k++) {
        for (let j = 0; j < 3 - k; j++) {
          const z = (j - (2 - k) / 2) * 0.21, y = 0.1 + k * 0.18;
          bld.pushCylinder(P(-0.5 + rng.jitter(0.06), y, z), P(0.5 + rng.jitter(0.06), y, z), 0.1, 5, rng.bool(0.5) ? BARK : TIMBER, { capEnds: true });
        }
      }
      break;
    }
    case 'kiln-stock': {
      // Fired brick on the pallet and unglazed pots waiting for the kiln.
      bld.pushBox(P(-0.25, 0.2, 0), [0.3, 0.2, 0.2], BRICK, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushBox(P(-0.22, 0.52, 0.02), [0.26, 0.12, 0.18], BRICK, { faces: FACE_ALL, rotationY: P.yaw + rng.jitter(0.2) });
      for (let i = 0; i < rng.int(2, 3); i++) {
        const x = 0.28 + i * 0.2, r = rng.range(0.1, 0.16);
        bld.pushCylinder(P(x, 0, rng.jitter(0.12)), P(x, r * 2.4, 0), r, 6, POT, { radiusTop: r * 0.7, capEnds: true });
      }
      break;
    }
    case 'handcart': {
      // Two wheels, a boarded bed, handles back toward local -X, a prop leg in front.
      bld.pushBox(P(0, 0.62, 0), [0.55, 0.04, 0.4], TIMBER, { faces: FACE_ALL, rotationY: P.yaw });
      for (const sz of [-0.4, 0.4]) {
        bld.pushBox(P(0, 0.76, sz), [0.55, 0.1, 0.02], TIMBER, { faces: FACE_ALL, rotationY: P.yaw });
        bld.pushCylinder(P(0.05, 0.36, sz * 1.18), P(0.05, 0.36, sz * 1.3), 0.36, 10, PALE_TIMBER, { capEnds: true });
        bld.pushTubeAlongPath([P(-0.55, 0.64, sz * 0.75), P(-1.2, 0.7, sz * 0.75)], 0.025, 3, TIMBER, { capEnds: false });
      }
      bld.pushTubeAlongPath([P(0.05, 0.36, -0.5), P(0.05, 0.36, 0.5)], 0.025, 3, IRON, { capEnds: false });
      bld.pushTubeAlongPath([P(0.5, 0.6, 0), P(0.52, 0, 0)], 0.03, 3, TIMBER, { capEnds: false });
      if (rng.bool(0.6)) for (let i = 0; i < 3; i++) bld.pushSphere(P(-0.3 + i * 0.3, 0.86, rng.jitter(0.15)), rng.range(0.18, 0.24), 2, 5, BURLAP);
      else bld.pushBox(P(0, 0.88, 0), [0.32, 0.22, 0.28], TIMBER, { faces: FACE_ALL, rotationY: P.yaw + rng.jitter(0.4) });
      break;
    }
    case 'sacks': {
      const n = rng.int(3, 4);
      for (let i = 0; i < n; i++) {
        const top = i === n - 1 && n > 3;
        const r = rng.range(0.2, 0.27);
        bld.pushSphere(P(top ? 0 : (i - 1) * 0.36 + rng.jitter(0.05), top ? 0.5 : r, rng.jitter(0.1)), r, 2, 5,
          [BURLAP[0] * rng.range(0.85, 1.1), BURLAP[1] * rng.range(0.85, 1.1), BURLAP[2]]);
      }
      break;
    }
    case 'planter-tall': {
      bld.pushBox(P(0, 0.3, 0), [0.34, 0.3, 0.34], pal.kerb, { faces: FACE_ALL, rotationY: P.yaw });
      bld.pushCylinder(P(0, 0.6, 0), P(0, 1.55, 0), 0.05, 4, BARK, { capEnds: false });
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + rng.jitter(0.5);
        bld.pushSphere(P(Math.cos(a) * 0.25, rng.range(1.5, 1.95), Math.sin(a) * 0.25), rng.range(0.32, 0.48), 2, 5, LEAVES[rng.int(0, LEAVES.length - 1)]);
      }
      break;
    }
    default:
      // An authored kind with no emitter yet is a loud, visible cube rather than
      // a silent one — see the same reasoning in `pushProp`.
      bld.pushBox(P(0, 0.3, 0), [0.3, 0.3, 0.3], pal.metal, { faces: FACE_ALL, rotationY: P.yaw });
      break;
  }
  tally.tris += (bld.indexCount - before) / 3;
}

/** District colours a piece of furniture is allowed to use. */
export interface ClutterPalette {
  kerb: Vec3;
  trim: Vec3;
  metal: Vec3;
  accent: Vec3;
}

/**
 * Register what was emitted since `start` as a crowd obstacle, if it stands in
 * the walking band (above the paving, below a standing head). The one path
 * every piece of furniture takes, so the crowd and the frame cannot disagree.
 */
function pushObstacleSince(bld: MeshBuilder, start: number, kind: string, out: CrowdObstacle[]): void {
  const bounds = bld.boundsSince(start);
  if (!bounds || bounds[1][1] <= GROUND_Y + 0.08 || bounds[0][1] >= GROUND_Y + 1.7) return;
  const [lo, hi] = bounds;
  out.push({ x: (lo[0] + hi[0]) * 0.5, z: (lo[2] + hi[2]) * 0.5, tx: 1, tz: 0,
    halfAlong: (hi[0] - lo[0]) * 0.5, halfAcross: (hi[2] - lo[2]) * 0.5,
    minY: lo[1], maxY: hi[1], kind });
}

/**
 * Bake the market spine's islands (D30). Placement is the grammar's
 * (`MarketIsland`); here each piece goes through `pushClutterItem` and
 * {@link pushObstacleSince}. `seen` dedupes across the chunk's market traces,
 * which all re-derive the same grammar.
 */
function bakeIslands(
  bld: MeshBuilder, islands: readonly MarketIsland[], districtId: number,
  seen: Set<string>, res: GroundBakeResult,
): void {
  const style = districtStyle(districtId);
  const tally: ClutterTally = { placed: 0, wanted: 0, tris: 0, lamps: 0, marketLights: 0, marketLightsDropped: 0, marketTraces: 0, stallLights: 0 };
  for (const isl of islands) {
    const key = `${isl.x.toFixed(2)},${isl.z.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Bake-time dressing draws from the island's own seed, never the chunk stream.
    const rng = makeRng((Math.round(isl.x * 131) * 73856093) ^ (Math.round(isl.z * 131) * 19349663) ^ 0x15a4d);
    const pal: ClutterPalette = { kerb: STONE, trim: ISLAND_PAINT[rng.int(0, ISLAND_PAINT.length - 1)], metal: style.palette.metal, accent: style.accentColor };
    for (const pc of isl.pieces) {
      const start = bld.vertexCount;
      pushClutterItem(bld, pc.kind, placer(pc.x, GROUND_Y, pc.z, Math.sin(pc.yaw), Math.cos(pc.yaw)), pal, rng, tally);
      if (pc.solid) pushObstacleSince(bld, start, pc.kind, res.obstacles);
      res.islands.pieces++;
    }
    res.islands.placed++;
  }
  res.islands.tris += tally.tris;
}

/** Emit kerb, kerb top, footway band and paint for one traced carriageway. */
function emitTrace(
  bld: MeshBuilder, chunk: CityChunk, plan: CityPlan, t: Trace, lod: number, rng: Rng,
  lights: GroundLight[], footwayCells: Set<number>, pendingMarket: GroundLight[], pendingFire: GroundLight[],
  marketSeenKeys: Set<string>, marketState: { seen: boolean; emitted: MarketBakeState },
  minX: number, minZ: number, size: number, res: GroundBakeResult, maxLights: number,
): void {
  const maxX = minX + size, maxZ = minZ + size;
  const last = t.to;
  let grammar = groundGrammarFor(t.districtId, t.kind);
  // Edge offsets carried along the trace, one per side. The edge moves smoothly
  // with the street, so the previous segment's answer is a predictor good enough
  // for a single field query — see `edgeOffset`.
  const off = [0, 0];
  let offSet = false;
  // Distance walked along the footway since the last item, per side, and the
  // (irregular) distance to walk before the next one.
  const gapWalk = [0, 0];
  const gapNext = [1, 1];

  for (let i = t.from; i < last - 1; i++) {
    if (!segInside(t, i, minX, minZ, maxX, maxZ)) continue;
    const ax = t.p[i * 5], az = t.p[i * 5 + 1];
    const bx = t.p[(i + 1) * 5], bz = t.p[(i + 1) * 5 + 1];
    // Trace layout is x, z, tx, tz, width. The left normal of the tangent is
    // (-tz, tx) — indices 3 and 2. It was briefly written as (-tz, tz) with the
    // normal's Z read from index 4, which is the WIDTH: a lateral direction of
    // magnitude ~26m, so every kerb landed tens of metres from the road and the
    // emitted geometry spanned 2.3km instead of 256m. Nothing threw. `selftest`
    // now asserts every emitted normal is a unit vector, which is what catches it.
    const anx = -t.p[i * 5 + 3], anz = t.p[i * 5 + 2];
    const bnx = -t.p[(i + 1) * 5 + 3], bnz = t.p[(i + 1) * 5 + 2];
    const width = t.p[i * 5 + 4];
    const along = Math.hypot(bx - ax, bz - az);

    // The grammar can only change at a district boundary, so re-resolving it
    // every segment is 16x the work for nothing. Every 4th segment — 16m — is
    // the district cell size, so this cannot straddle a boundary unnoticed.
    if (i % 4 === t.from % 4) {
      grammar = groundGrammarFor(districtAt(chunk, minX, minZ, size, (ax + bx) * 0.5, (az + bz) * 0.5), t.kind);
    }

    const kh = Math.max(0.03, grammar.kerbHeight);
    const fw = Math.max(0, grammar.footwayWidth);
    const half = width * 0.5;

    const maxR = half * 1.6 + KERB_W;
    if (!offSet) { off[0] = half; off[1] = half; offSet = true; }

    for (const side of [1, -1] as const) {
      const si = side > 0 ? 0 : 1;
      // Find the edge the field agrees with, independently at each end.
      const rA = edgeOffset(plan, ax, az, anx * side, anz * side, off[si], maxR);
      const rB = edgeOffset(plan, bx, bz, bnx * side, bnz * side, rA, maxR);
      off[si] = rB;
      const axE2 = ax + anx * side * rA, azE2 = az + anz * side * rA;
      const bxE2 = bx + bnx * side * rB, bzE2 = bz + bnz * side * rB;
      // Ownership. `segInside` only clips along the street, so a carriageway
      // running along a chunk boundary would have BOTH chunks lay the same
      // kerb, kerb top and footway over the same square metres — coplanar
      // duplicates whose winner is chosen by depth precision, i.e. arbitrarily,
      // and which double the triangles exactly where the camera spends most of
      // its time. One owner per band: whichever chunk contains the kerb line.
      // Overhang is then bounded by the footway width instead of the road width,
      // and coverage stays complete because every point of the band is inside
      // exactly one chunk's kerb line.
      //
      // Both ENDPOINTS, not the midpoint: the edge search is allowed to overshoot
      // the nominal half-width by 0.6 of it, which on the widest arterial is
      // 14m, so a midpoint test let a 14m-long kerb segment be owned by a chunk
      // it did not touch. Measured: 6132 out-of-chunk vertices with a midpoint
      // test, 0 with this one.
      if (!inRect(axE2, azE2, minX, minZ, maxX, maxZ) || !inRect(bxE2, bzE2, minX, minZ, maxX, maxZ)) continue;
      // Overlap dedupe. Two carriageways crossing produce two footway bands over
      // the same square metre of ground; coplanar duplicates z-fight and the
      // winner is chosen by depth precision, which is to say arbitrarily. One
      // Set, one 2m cell per side-segment, first writer keeps it.
      const fk = gkey(
        (axE2 + bxE2) * 0.5 + anx * side * (KERB_W + fw * 0.5),
        (azE2 + bzE2) * 0.5 + anz * side * (KERB_W + fw * 0.5),
        DEDUPE_CELL,
      );
      if (footwayCells.has(fk)) continue;
      footwayCells.add(fk);
      res.edgeMetres += along;

      // The field-resolved road is explicit geometry above the shared paving
      // deck, with the same ownership and trace dedupe as its edge. Backward
      // traces store reversed frames; use actual polygon winding. Degenerate
      // join points and folded corner quads leave the shared deck visible.
      const roadA: Vec3 = [ax, GROUND_Y + 0.002, az], roadB: Vec3 = [bx, GROUND_Y + 0.002, bz];
      const roadAE: Vec3 = [axE2, GROUND_Y + 0.002, azE2], roadBE: Vec3 = [bxE2, GROUND_Y + 0.002, bzE2];
      const roadUp1 = (bz - az) * (bxE2 - ax) - (bx - ax) * (bzE2 - az);
      const roadUp2 = (bzE2 - az) * (axE2 - ax) - (bxE2 - ax) * (azE2 - az);
      if (roadUp1 * roadUp2 > 0.00001) bld.pushQuad(roadA, roadUp1 > 0 ? roadB : roadAE, roadBE, roadUp1 > 0 ? roadAE : roadB,
        grammar.albedo, 1, { normals: UP4, surfaceTag: groundSurfaceTag('carriageway', grammar.pavement) });

      // Kerb face. Vertical, normal pointing at the carriageway. This is the
      // surface that has to read as a kerb; its authored tag admits it to the
      // ground shader independently of its normal, colour, or world height.
      const yLo = GROUND_Y, yHi = GROUND_Y + kh;
      // The normal comes from the segment itself, not the road normal at `a`.
      // At junctions the edge search jumps sideways, the segment runs ALONG the
      // road normal, and `-an` was in the face's own plane: 276 kerb faces
      // (354 m², five chunks) lit edge-on and wound by a coin toss.
      const sdx = bxE2 - axE2, sdz = bzE2 - azE2, sLen = Math.hypot(sdx, sdz);
      if (sLen < 1e-4) continue;
      const alongNormal = Math.abs((sdx * anx + sdz * anz) / sLen);
      let fnx = sdz / sLen, fnz = -sdx / sLen;
      if (fnx * anx * side + fnz * anz * side > 0) { fnx = -fnx; fnz = -fnz; }
      const face: Vec3 = [fnx, 0, fnz];
      bld.pushQuad(
        [axE2, yLo, azE2], [bxE2, yLo, bzE2], [bxE2, yHi, bzE2], [axE2, yHi, azE2],
        grammar.kerbAlbedo, 1, { normals: [face, face, face, face], surfaceTag: groundSurfaceTag('kerb-face', walkingFamily(grammar), kh) },
      );

      // Gutter. The spec's three-metre bar requires a kerb to read as "a THICK EDGE
      // with a top face, a vertical face and a VISIBLE JOINT against the road".
      // The first two are geometry above; this is the third. It is a dark strip
      // on the carriageway side of the kerb line, and per the spec's own advice
      // ("put joints and restrained wear into procedural shading") it is a
      // shading joint rather than modelled channel geometry: 2 triangles a
      // segment, where a modelled channel would be 4 and would fight the deck
      // for z-precision across its whole width.
      //
      // WIDTH, and this is the second attempt at the review gate's "a distinct
      // kerb joint is not legible". The first pass modelled this as a 0.26 m
      // flat dark strip, which the reviewer described exactly: "a light top and
      // a narrow dark lip, so it reads more convincingly as shallow geometry
      // than paint". Their phrase names the failure — one value, one width, no
      // gradient — so it reads as an edge finish rather than as a JOINT.
      //
      // A joint is a gap between two stones, and it has three parts: a dark
      // line where the two faces meet, a graded shadow that gets darker toward
      // that line, and the lit arris on the kerb's own corner. A single strip
      // has none of the three. So it is two strips, and the geometry carries a
      // gradient the fragment stage would otherwise have to infer:
      //
      //   0.00 - 0.10m  DEEP   the meeting line, near-black
      //   0.10 - 0.34m  GUTTER graded out toward the carriageway
      //
      // 0.34 m total, from 0.26 m, at 4 triangles a segment instead of 2. The
      // z-precision worry in the comment above was about a modelled CHANNEL
      // fighting the deck across its width; these are coplanar with the gutter
      // was and separated by 4 mm, which is comfortably above the depth
      // precision at this range and is why the pair does not z-fight.
      const gDeep = 0.10;
      const gOut = 0.34;
      const lift = (d: number): number => GROUND_Y + 0.006 + d * 0.004;
      // Offset along the road normal, a strip on a segment that runs along that
      // normal folds into a vertical sliver (552 of them, 0.05 m² each, lit as
      // floor). No joint to draw there.
      // The strips were swapped and overlapping: DEEP spanned 0.10-0.34 m and
      // GUTTER 0-0.34 m, 4 mm above it, so the meeting line was never visible
      // and the "graded joint" was one flat strip (measured: a single value
      // across the band). Now DEEP is the 0-0.10 m line at the kerb foot.
      if (alongNormal <= 0.7) {
        bld.pushQuad(
          [axE2, lift(1), azE2],
          [bxE2, lift(1), bzE2],
          [bxE2 - bnx * side * gDeep, lift(1), bzE2 - bnz * side * gDeep],
          [axE2 - anx * side * gDeep, lift(1), azE2 - anz * side * gDeep],
          DEEP_JOINT, 1, { normals: UP4, surfaceTag: groundSurfaceTag('gutter', grammar.pavement) },
        );
        bld.pushQuad(
          [axE2 - anx * side * gDeep, lift(0), azE2 - anz * side * gDeep],
          [bxE2 - bnx * side * gDeep, lift(0), bzE2 - bnz * side * gDeep],
          [bxE2 - bnx * side * gOut, lift(0), bzE2 - bnz * side * gOut],
          [axE2 - anx * side * gOut, lift(0), azE2 - anz * side * gOut],
          GUTTER, 1, { normals: UP4, surfaceTag: groundSurfaceTag('gutter', grammar.pavement) },
        );
      }

      if (lod > 0) continue;

      // Kerb top: 0.30m of stone, then the footway out to the building line.
      // Both raised by the kerb height, with distinct authored surface tags.
      const a1x = axE2 + anx * side * KERB_W, a1z = azE2 + anz * side * KERB_W;
      const b1x = bxE2 + bnx * side * KERB_W, b1z = bzE2 + bnz * side * KERB_W;
      // Kerb line to KERB_W. This quad once repeated the footway's corners, so
      // the real top was missing and the strip beside the face was an open slot.
      bld.pushQuad(
        [axE2, yHi, azE2], [bxE2, yHi, bzE2], [b1x, yHi, b1z], [a1x, yHi, a1z],
        grammar.kerbAlbedo, 1, { normals: UP4, surfaceTag: groundSurfaceTag('kerb-top', walkingFamily(grammar), kh) },
      );
      if (fw > 0.01) {
        bld.pushQuad(
          [a1x, yHi, a1z], [b1x, yHi, b1z],
          [b1x + bnx * side * fw, yHi, b1z + bnz * side * fw],
          [a1x + anx * side * fw, yHi, a1z + anz * side * fw],
          walkingAlbedo(grammar), 1, { normals: UP4, surfaceTag: groundSurfaceTag('paving', walkingFamily(grammar)) },
        );

        // --- street furniture, placed on the footway out of the grammar.
        //
        // Three rules, all from `docs/STREET_SPEC.md` section F, which names
        // "uniform procedural repetition" as the single risk to this work:
        //
        //   1. EDGE, NOT MIDDLE, on footways. Items go to the building line or
        //      the kerb line per `CLUTTER_EDGE`, and a kind that would leave less
        //      than `footwayWalk` clear is not placed (`clutterReach`). DECISIONS
        //      D30 extends this rule: wide walking areas carry islands in their
        //      middle. No authored footway is that wide (widest 5.72 m), so the
        //      islands stand in the market spine and in carriageways of at least
        //      `STREET_ISLAND_MIN_WIDTH` (`MarketIsland`, baked below).
        //   2. IRREGULAR GAPS. Each gap is re-rolled in 0.45..2.4x of nominal, so
        //      there is rhythm instead of a metronome.
        //   3. OPEN STRETCHES. A low-frequency mask leaves roughly a third of
        //      every route completely empty, and a placed item pulls the NEXT gap
        //      in, so furniture arrives in clumps at boundaries rather than as a
        //      scatter.
        const si2 = side > 0 ? 0 : 1;
        if (grammar.clutter.length > 0 && grammar.clutterDensity > 0 && lod < 1) {
          const want = grammar.clutterDensity / 100;      // items per metre
          // Budget as a proportional THROTTLE, not a cut-off. Stopping dead at
          // the limit gives every item to the first streets walked and none to
          // the rest of the chunk, which reads as one furnished street and
          // several deserted ones — worse than uniformly sparser. Widening the
          // spacing in proportion to what has already been spent thins every
          // street in the chunk by the same factor and converges on the budget.
          //
          // An integer skip counter (skip 1 in N opportunities) was tried first
          // and over-damped badly: it converged on 4747 triangles of a 9000
          // budget, because each extra skip made the next one likelier. Spacing
          // is the right control variable, not a counter.
          const throttle = Math.max(1, res.clutter.tris / (CLUTTER_TRIS * 0.55));
          // Rate-preserving clustering. The naive version — reject 34% of
          // opportunities and widen every remaining gap — cut placement from 182
          // to 70 items per chunk, which is not clustering, it is deletion. What
          // the spec asks for is the same number of items arranged in clumps, so
          // the two regimes are given reciprocal gaps (tight in a clump, wide in
          // an open stretch) and the mean is held near the authored rate by
          // CLUSTER_MEAN. Measured after the change: see __selftest's report.
          gapWalk[si2] += along;
          if (gapWalk[si2] >= (gapNext[si2] * throttle * CLUSTER_MEAN) / want) {
            const dense = hash01((Math.round(t.p[0]) * 73856093) ^ (Math.round(t.p[1]) * 19349663)
              ^ (Math.round(res.clutter.wanted * 2654435761) * 40503) ^ side) > 0.34;
            gapNext[si2] = dense ? rng.range(0.22, 0.72) : rng.range(1.7, 3.4);
            gapWalk[si2] = 0;
            res.clutter.wanted++;
            const pickKind = (): number => grammar.clutter[Math.floor(rng.next() * grammar.clutter.length) % grammar.clutter.length];
            let d = pickKind();
            let room = clutterReach(CLUTTER_KINDS[d], fw);
            // Too deep for this footway's walking line: one re-draw, then the slot stays empty.
            if (room === null) { d = pickKind(); room = clutterReach(CLUTTER_KINDS[d], fw); }
            if (room !== null) {
              const name = CLUTTER_KINDS[d];
              const atFront = (CLUTTER_EDGE[name] ?? 'front') === 'front';
              // Against the building line, or on the route boundary. A front item
              // stands its own depth off the line: placed by its centre at the
              // inset, anything deeper than the inset was half inside the wall.
              // Wall-mounted kinds (unlisted depth) keep the inset their arms reach.
              const inX = atFront
                ? Math.max(KERB_W + 0.25, KERB_W + fw - FOOTWAY_FRONT_INSET - (CLUTTER_DEPTH[name] ?? 0)
                  - rng.next() * Math.min(0.75, fw * 0.4, room))
                : KERB_W + FOOTWAY_KERB_BAND[0] + rng.next() * (FOOTWAY_KERB_BAND[1] - FOOTWAY_KERB_BAND[0]);
              const px = (axE2 + bxE2) * 0.5 + anx * side * inX;
              const pz = (azE2 + bzE2) * 0.5 + anz * side * inX;
              // Face the carriageway: local +Z points at the road, so local -Z is
              // the building line — which is what the bracket arms in
              // `pushClutterItem` run back to. Loose things are left at an angle.
              const turn = Math.atan2(-anx * side, -anz * side) + (LOOSE_YAW[name] ? rng.jitter(LOOSE_YAW[name]) : 0);
              const P = placer(px, yHi, pz, Math.sin(turn), Math.cos(turn));
              const style = districtStyle(t.districtId);
              const pal = style.palette;
              const componentStart = bld.vertexCount;
              pushClutterItem(bld, name, P, {
                kerb: grammar.kerbAlbedo, trim: pal.trim, metal: pal.metal, accent: style.accentColor,
              }, rng, res.clutter);
              pushObstacleSince(bld, componentStart, name, res.obstacles);
              res.clutter.placed++;
              // A lamp that emits no light is a PHANTOM: the light is the point.
              //
              // Counted against the chunk's OWN budget rather than the array's
              // length. `maxLights` is already offset by the building lights that
              // were in the array before this bake began, so the original
              // `lights.length < maxLights` compared a *chunk-relative* cap with
              // an *absolute* count and refused every lamp post in the project.
              if (CLUTTER_KINDS[d] === 'lamp-post' && lights.length - res.clutter.stallLights < maxLights) {
                lights.push({ pos: [px, yHi + 4.6, pz], radius: 13, color: [1.0, 0.72, 0.42], intensity: 2.6 });
              }
              // A brazier's fire lays its own pool (sheet C: the street is lit by fire),
              // from what the chunk's budget has left once the market is lit.
              if (name === 'brazier') pendingFire.push({ pos: [px, yHi + 1.4, pz], radius: 12, color: [1.0, 0.46, 0.16], intensity: 2.4 });
            }
          }
        }
      }
    }

    if (grammar.marking !== 'none') emitPaint(bld, ax, az, bx, bz, anx, anz, bnx, bnz, half, grammar, i);
  }

  // Wide walking carriageways off the spine carry islands down their middle
  // (D30 rule 1). Placement is pure (`streetIslands`); the bake is the spine's.
  if (lod < 1 && t.kind !== 'market') {
    const isl = streetIslands(plan, chunk, t.p, t.from, t.to, t.kind, plan.seed);
    if (isl.length) {
      bakeIslands(bld, isl, t.districtId, marketState.emitted.islands, res);
      res.streetIslands.push(...isl);
    }
  }

  // Market detail belongs to another agent's module (`src/render/marketbake.ts`).
  // It is called exactly once per market carriageway, with the same context
  // every other ground baker receives, and its body is never touched from here.
  if (t.kind === 'market' && lod < 1 && t.p.length >= 5) {
    const frame: StreetFrame = {
      lateral: 0, along: 0, tx: t.p[2], tz: t.p[3], nx: -t.p[3], nz: t.p[2],
      width: t.p[4], kind: t.kind, districtId: t.districtId, clearance: -1, px: t.p[0], pz: t.p[1],
    };
    const ctx: GroundBakeCtx = {
      builder: bld, rng, plan, chunk, lod, seed: plan.seed, frame, grammar,
    };
    const emitted = bakeMarketDetail(bld, ctx, marketState.emitted);
    res.marketStalls.push(...emitted.stalls);
    res.obstacles.push(...emitted.obstacles);

    // ---------------------------------------------------------------------
    // The half of the market that used to not exist.
    //
    // `bakeMarketDetail` draws the stalls, the catenaries and the lanterns, and
    // returns void. The lights the lantern grammar harvested for those same
    // lanterns had nowhere to go, so the grammar computed them, a self-test
    // counted them, and `BakedChunk.lights` — which exists, and which
    // `gatherLights()` already reads — received none of them. 365 lights
    // produced, 0 delivered. The lanterns glowed (emissive geometry) and lit
    // nothing, which is the exact shape of the PHANTOM rows in COVERAGE.md and
    // is why `aisleWarmPixelPct` measured 0.00 in every configuration tried.
    //
    // Recomputing the grammar here is not a second opinion that could disagree:
    // it is a pure function of (seed, plan, chunk, kind, districtId) and forks
    // its own RNG per element, so this returns exactly the list
    // `bakeMarketDetail` just laid the lanterns out from. That property is
    // stated in `marketgrammar.ts`; it is the reason this loop is safe.
    const desc = marketGrammarFor({
      seed: ctx.seed, plan, chunk, kind: t.kind, districtId: t.districtId,
    });
    // Mirror `bakeMarketDetail`'s own early-out: no stalls and no catenaries
    // means no lanterns were drawn, and lights for geometry that is not there
    // are exactly the kind of counter that agrees with itself and disagrees
    // with the frame.
    if (desc.stalls.length === 0 && desc.strings.length === 0) return;
    bakeIslands(bld, desc.islands, t.districtId, marketState.emitted.islands, res);
    // Count distinct traces only for the report; see the dedup below.
    if (!marketState.seen) {
      res.clutter.marketTraces++;
      marketState.seen = true;
    }
    // Budget for THIS trace, and it must be reserved rather than first-come.
    //
    // `maxLights` is 24 lights for the whole chunk and this block runs once per
    // market carriageway — measured at `traces: 5` on chunk (0,-1). First-come
    // meant the first carriageway to be traced took all 24 and the other four
    // took none, so `produced 240, delivered 24, dropped 216` and the lanterns
    // that survived were whichever 24 the trace order happened to reach first.
    // Worse, they were NOT the ones near the camera: on chunk (0,-1) the 8
    // lanterns within 25m of the market spine sat at array indices 103-111,
    // behind 103 building lights, and the whole market rendered unlit while the
    // counter said 24 delivered.
    //
    // So the market gets a reserved slice of the chunk budget, spent nearest-first
    // within each trace. Per-trace `MAX_MARKET_LIGHTS_PER_CHUNK` is 48; the
    // reservation is the smaller of that and the chunk budget this bake still has
    // left, so a market chunk cannot starve lamp posts outright.
    // Collected, NOT spent here.
    //
    // This block runs once per market carriageway — `traces: 5` on chunk (0,-1) —
    // and the budget is for the whole chunk. Spending it per trace meant the
    // first carriageway traced took all 24 and the other four took none
    // (`produced 240, delivered 24, dropped 216`), and the 24 that survived were
    // whichever segment the trace order reached first rather than the ones near
    // the market spine. Measured on chunk (0,-1): the grammar's 8 lanterns within
    // 25m of the spine sat at array indices 103-111 behind 103 building lights,
    // and the market rendered unlit while the counter read `delivered 24`.
    //
    // So every trace offers its lights and `bakeGroundDetail` adjudicates once,
    // after all traces are done, nearest-to-chunk-centre first. Adjudicating per
    // trace is the same first-come bug one level down.
    // Deduplicate, because the grammar is deterministic and every trace in this
    // chunk re-derives the SAME 48 lanterns.
    //
    // Measured: `marketGrammarFor` with identical arguments returns an identical
    // light list, so a chunk with `traces: 5` offered 240 entries of which only
    // 48 were distinct. The spine ordering still measured correctly over the
    // duplicated set, but `dropped 192` was counting the same 48 lanterns five
    // times and the budget was being spent on copies. `MarketDesc.lights` is the
    // authority here — this module is not the place to trust a caller's
    // idempotence, and a keyed set costs nothing at 48 entries.
    for (const l of desc.lights) {
      const key = `${l.pos[0].toFixed(2)}|${l.pos[1].toFixed(2)}|${l.pos[2].toFixed(2)}`;
      if (marketSeenKeys.has(key)) continue;
      marketSeenKeys.add(key);
      pendingMarket.push({ pos: l.pos, radius: l.radius, color: l.color, intensity: l.intensity });
    }
    // Stall lamps sit outside the chunk budget: the budgets above subtract them.
    for (const l of desc.stallLights) {
      const key = `${l.pos[0].toFixed(2)}|${l.pos[1].toFixed(2)}|${l.pos[2].toFixed(2)}`;
      if (marketSeenKeys.has(key) || res.clutter.stallLights >= MAX_STALL_LAMPS_PER_CHUNK) continue;
      marketSeenKeys.add(key);
      lights.push({ pos: l.pos, radius: l.radius, color: l.color, intensity: l.intensity });
      res.clutter.stallLights++;
    }
  }
}

/**
 * Road paint, baked as geometry rather than synthesised per pixel.
 *
 * Same reason as the kerbs: a centre line follows a carriageway centreline and
 * the GPU has no way to find a carriageway centreline. A world-space stripe
 * lattice would put lane markings through the middle of buildings, which is
 * worse than having none. What the shader adds on top is wear — see
 * `groundSurface` in `gbuffer.wgsl`.
 */
function emitPaint(
  bld: MeshBuilder,
  ax: number, az: number, bx: number, bz: number,
  anx: number, anz: number, bnx: number, bnz: number,
  half: number, g: GroundGrammar, index: number,
): void {
  const y = GROUND_Y + PAINT_LIFT;
  const quad = (
    x0: number, z0: number, x1: number, z1: number, x2: number, z2: number, x3: number, z3: number,
  ): void => {
    bld.pushQuad([x0, y, z0], [x1, y, z1], [x2, y, z2], [x3, y, z3], g.paintAlbedo, 1,
      { normals: UP4, surfaceTag: groundSurfaceTag('paint', 'paint') });
  };
  switch (g.marking) {
    case 'centre-line':
      quad(
        ax - anx * 0.07, az - anz * 0.07, bx - bnx * 0.07, bz - bnz * 0.07,
        bx + bnx * 0.07, bz + bnz * 0.07, ax + anx * 0.07, az + anz * 0.07,
      );
      break;
    case 'lane-dashes':
      // 3m painted, 9m gap, in 4m trace segments: paint every third.
      if (index % 3 !== 0) break;
      quad(
        ax - anx * 0.07, az - anz * 0.07, bx - bnx * 0.07, bz - bnz * 0.07,
        bx + bnx * 0.07, bz + bnz * 0.07, ax + anx * 0.07, az + anz * 0.07,
      );
      break;
    case 'zebra': {
      // Bars across the carriageway every 16m. It reads at exactly the distance
      // a pedestrian crossing matters and costs two quads.
      if (index % 4 !== 0) break;
      const outer = half - 0.35, inner = half * 0.5;
      for (const s of [-1, 1]) {
        quad(
          ax + anx * s * outer, az + anz * s * outer,
          bx + bnx * s * outer, bz + bnz * s * outer,
          bx + bnx * s * inner, bz + bnz * s * inner,
          ax + anx * s * inner, az + anz * s * inner,
        );
      }
      break;
    }
    case 'tram-rails': {
      // Two rails at standard gauge. Metal, not paint — they get the kerb albedo
      // so the shader reads them as a hard specular line rather than dirt.
      const rail: [Vec3, Vec3, Vec3, Vec3] = [UP, UP, UP, UP];
      for (const s of [-1, 1]) {
        const cx = 0.7175 * s, w = 0.035;
        bld.pushQuad(
          [ax + anx * (cx - w), GROUND_Y, az + anz * (cx - w)],
          [bx + bnx * (cx - w), GROUND_Y, bz + bnz * (cx - w)],
          [bx + bnx * (cx + w), GROUND_Y, bz + bnz * (cx + w)],
          [ax + anx * (cx + w), GROUND_Y, az + anz * (cx + w)],
          g.kerbAlbedo, 1, { normals: rail },
        );
      }
      break;
    }
    case 'yard-grid': {
      // Yard aprons are marked in squares, not lanes. One transverse line every
      // 12m; the longitudinal edges follow the kerb, which is already geometry.
      if (index % 3 !== 0) break;
      const a = half - 0.06, b = half - 0.24;
      quad(
        ax - anx * a, az - anz * a, bx - bnx * a, bz - bnz * a,
        bx - bnx * b, bz - bnz * b, ax - anx * b, az - anz * b,
      );
      break;
    }
    case 'none':
      break;
  }
}
