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

import { type Rng, type Vec3 } from '../core/math';
import {
  sampleStreetPlan, GROUND_Y, DISTRICT_CELL,
  type CityChunk, type CityPlan, type RoadKind, type StreetSample,
} from '../world/citygen';
import {
  groundGrammarFor, type GroundBakeCtx, type GroundGrammar, type StreetFrame,
} from '../world/groundgrammar';
import { FACE_ALL, FACE_NY, FACE_PY, MeshBuilder } from '../world/geometry';
import { bakeMarketDetail } from './marketbake';
import { CLUTTER_KINDS } from '../world/groundgrammar';
import { districtStyle } from '../world/districts';

// ---------------------------------------------------------------- constants

/**
 * Kerb top width, metres. A kerb is a ~0.15m edge seen nearly edge-on plus its
 * top; 0.30m is the narrowest band that survives TAA at street range without
 * becoming a kerb-width strip of pavement.
 */
const KERB_W = 0.30;

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
  /** Carriageway centrelines that contributed geometry. */
  roads: number;
  /** Furniture the grammar asked for, and how many the triangle budget allowed. */
  clutter: ClutterTally;
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
  // Ceiling on ground-contributed lights so a dense market chunk cannot eat the
  // whole clustered-light budget that the buildings already draw from.
  const maxLights = 24;
  const res: GroundBakeResult = {
    roads: 0, edgeMetres: 0, triangles: 0, fieldMs: 0,
    clutter: { placed: 0, wanted: 0, tris: 0, lamps: 0 },
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
    emitTrace(bld, chunk, plan, trace, lod, rng, lights, footwayCells, minX, minZ, size, res, maxLights);
    res.roads++;
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
 */
const CLUTTER_TRIS = 9000;

/** Prop-local point -> world, yawing the item to face the carriageway. */
type Placer = (x: number, y: number, z: number) => Vec3;

/** Build a placer that puts local +Z toward `face` and local +Y at `y`. */
const placer = (x: number, y: number, z: number, faceX: number, faceZ: number): Placer => {
  const a = Math.atan2(faceX, faceZ);
  const c = Math.cos(a), s = Math.sin(a);
  return (lx: number, ly: number, lz: number): Vec3 => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
};

const METAL: Vec3 = [0.16, 0.17, 0.18];
const DARK: Vec3 = [0.055, 0.058, 0.062];
const TIMBER: Vec3 = [0.26, 0.17, 0.10];
const LEAF: Vec3 = [0.075, 0.21, 0.055];

export interface ClutterTally {
  placed: number;
  wanted: number;
  tris: number;
  lamps: number;
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
      bld.pushBox(P(0, 0.44, 0), [0.9, 0.05, 0.24], TIMBER, { faces: FACE_PY | FACE_NY, rotationY: 0 });
      bld.pushBox(P(0, 0.68, -0.22), [0.9, 0.22, 0.04], TIMBER, { faces: FACE_ALL });
      for (const sx of [-0.78, 0.78]) bld.pushBox(P(sx, 0.22, 0), [0.05, 0.22, 0.22], METAL, { faces: FACE_ALL });
      break;
    case 'bin':
      bld.pushCylinder(P(0, 0, 0), P(0, 0.78, 0), 0.26, 7, pal.metal, { capEnds: false });
      bld.pushCylinder(P(0, 0.78, 0), P(0, 0.86, 0), 0.29, 7, pal.metal, { radiusTop: 0.2, capEnds: true });
      break;
    case 'planter':
      bld.pushBox(P(0, 0.22, 0), [0.42, 0.22, 0.42], pal.kerb, { faces: FACE_ALL });
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
      bld.pushCylinder(P(0, 0, 0), P(0, 4.6, 0), 0.085, 5, pal.metal, { capEnds: false });
      bld.pushBox(P(0, 4.72, 0.3), [0.10, 0.07, 0.42], pal.metal, { faces: FACE_ALL });
      bld.pushBox(P(0, 4.6, 0.56), [0.20, 0.06, 0.26], [1.0, 0.86, 0.62], { faces: FACE_ALL, emissive: 3.0 });
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
        bld.pushBox(P(rng.jitter(0.1), 0.2 + i * 0.4, rng.jitter(0.1)), [0.32, 0.2, 0.28], TIMBER, { faces: FACE_ALL, rotationY: rng.jitter(0.4) });
      }
      break;
    case 'spool':
    case 'cable-spool':
      bld.pushCylinder(P(0, 0, -0.3), P(0, 0, 0.3), 0.55, 8, TIMBER, { capEnds: true });
      bld.pushCylinder(P(0, 0, -0.32), P(0, 0, -0.26), 0.78, 8, TIMBER, { capEnds: true });
      bld.pushCylinder(P(0, 0, 0.26), P(0, 0, 0.32), 0.78, 8, TIMBER, { capEnds: true });
      break;
    case 'postbox':
      bld.pushBox(P(0, 0.6, 0), [0.24, 0.6, 0.18], pal.accent, { faces: FACE_ALL });
      bld.pushBox(P(0, 1.22, 0), [0.26, 0.04, 0.2], pal.accent, { faces: FACE_ALL });
      break;
    case 'newspaper-box':
      bld.pushBox(P(0, 0.28, 0), [0.22, 0.28, 0.18], pal.accent, { faces: FACE_ALL });
      for (const sx of [-0.16, 0.16]) bld.pushBox(P(sx, 0.06, 0), [0.03, 0.06, 0.03], METAL, { faces: FACE_ALL });
      break;
    case 'kiosk':
      bld.pushBox(P(0, 1.1, 0), [1.1, 1.1, 0.8], pal.trim, { faces: FACE_ALL });
      bld.pushQuad(P(-1.2, 1.85, -0.6), P(1.2, 1.85, -0.6), P(1.2, 1.6, 0.7), P(-1.2, 1.6, 0.7), pal.accent, 1, { doubleSided: true });
      bld.pushBox(P(0, 0.5, 0.42), [0.9, 0.5, 0.04], pal.metal, { faces: FACE_ALL });
      break;
    case 'phone-box':
      bld.pushBox(P(0, 1.1, 0), [0.42, 1.1, 0.34], pal.accent, { faces: FACE_ALL });
      break;
    case 'sandbag':
      for (let i = 0; i < 3; i++) {
        bld.pushBox(P(0, 0.11 + i * 0.2, 0), [0.34, 0.1, 0.2], pal.kerb, { faces: FACE_ALL, rotationY: i * 0.3 });
      }
      break;
    case 'sandwich-board':
      for (const s of [-1, 1]) {
        bld.pushQuad(P(-0.3, 0.9, s * 0.1), P(0.3, 0.9, s * 0.1), P(0.3, 0, s * 0.34), P(-0.3, 0, s * 0.34), DARK, 1, { doubleSided: true });
      }
      break;
    default:
      // An authored kind with no emitter yet is a loud, visible cube rather than
      // a silent one — see the same reasoning in `pushProp`.
      bld.pushBox(P(0, 0.3, 0), [0.3, 0.3, 0.3], pal.metal, { faces: FACE_ALL });
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

/** Emit kerb, kerb top, footway band and paint for one traced carriageway. */
function emitTrace(
  bld: MeshBuilder, chunk: CityChunk, plan: CityPlan, t: Trace, lod: number, rng: Rng,
  lights: GroundLight[], footwayCells: Set<number>,
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
  // Distance walked along the footway since the last item, per side.
  const gapWalk = [0, 0];

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

      // Kerb face. Vertical, normal pointing at the carriageway. This is the
      // surface that has to read as a kerb, and it does so from its normal alone
      // (n.y near 0 against the deck's n.y near 1), with no extra data channel.
      const yLo = GROUND_Y, yHi = GROUND_Y + kh;
      const face: Vec3 = [-anx * side, 0, -anz * side];
      bld.pushQuad(
        [axE2, yLo, azE2], [bxE2, yLo, bzE2], [bxE2, yHi, bzE2], [axE2, yHi, azE2],
        grammar.kerbAlbedo, 1, { normals: [face, face, face, face] },
      );

      if (lod > 0) continue;

      // Kerb top: 0.30m of stone, then the footway out to the building line.
      // Both raised by the kerb height, which makes world height an unambiguous
      // surface tag in the fragment stage — deck, kerb top and footway are three
      // distinguishable heights and nothing else in a chunk lives there.
      const a1x = axE2 + anx * side * KERB_W, a1z = azE2 + anz * side * KERB_W;
      const b1x = bxE2 + bnx * side * KERB_W, b1z = bzE2 + bnz * side * KERB_W;
      bld.pushQuad(
        [a1x, yHi, a1z], [b1x, yHi, b1z],
        [b1x + bnx * side * fw, yHi, b1z + bnz * side * fw],
        [a1x + anx * side * fw, yHi, a1z + anz * side * fw],
        grammar.kerbAlbedo, 1, { normals: UP4 },
      );
      if (fw > 0.01) {
        bld.pushQuad(
          [a1x, yHi, a1z], [b1x, yHi, b1z],
          [b1x + bnx * side * fw, yHi, b1z + bnz * side * fw],
          [a1x + anx * side * fw, yHi, a1z + anz * side * fw],
          grammar.albedo, 1, { normals: UP4 },
        );

        // --- street furniture, placed on the footway out of the grammar.
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
          gapWalk[si2] += along;
          if (gapWalk[si2] >= throttle / want) {
            gapWalk[si2] = 0;
res.clutter.wanted++;
            {
              const d = grammar.clutter[Math.floor(rng.next() * grammar.clutter.length) % grammar.clutter.length];
              const inX = KERB_W + 0.3 + rng.next() * Math.max(0.1, fw - 0.9);
              const px = (axE2 + bxE2) * 0.5 + anx * side * inX;
              const pz = (azE2 + bzE2) * 0.5 + anz * side * inX;
              // Face the carriageway: local +Z points at the road.
              const P = placer(px, yHi, pz, -anx * side, -anz * side);
              const style = districtStyle(t.districtId);
              const pal = style.palette;
              pushClutterItem(bld, CLUTTER_KINDS[d], P, {
                kerb: grammar.kerbAlbedo, trim: pal.trim, metal: pal.metal, accent: style.accentColor,
              }, rng, res.clutter);
              res.clutter.placed++;
              // A lamp that emits no light is a PHANTOM: the light is the point.
              if (CLUTTER_KINDS[d] === 'lamp-post' && lights.length < maxLights) {
                lights.push({ pos: [px, yHi + 4.6, pz], radius: 13, color: [1.0, 0.72, 0.42], intensity: 2.6 });
              }
            }
          }
        }
      }
    }

    if (grammar.marking !== 'none') emitPaint(bld, ax, az, bx, bz, anx, anz, bnx, bnz, half, grammar, i);
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
      builder: bld, rng, plan, chunk, lod, seed: 0, frame, grammar,
    };
    bakeMarketDetail(bld, ctx);
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
    bld.pushQuad([x0, y, z0], [x1, y, z1], [x2, y, z2], [x3, y, z3], g.paintAlbedo, 1, { normals: UP4 });
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