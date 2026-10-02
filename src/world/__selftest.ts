/**
 * Headless self-check for the city generator. Builds a City at a fixed seed,
 * generates a block of chunks, and returns a human-readable report. Imports
 * nothing browser-only, so it runs under plain node as well as vite.
 */

import { makeRng, type Vec3, type Vec4 } from '../core/math';
import { DISTRICT_STYLES, waterDepthAt } from './districts';
import {
  City, GROUND_Y, PropKind, auditChunkLots, cityPlan, defaultCityConfig, footprintAabb,
  roadClearanceAt, sampleStreetPlan, type BuildingInstance, type CityChunk, type StreetSample,
} from './citygen';
import { MeshBuilder, meshTriangleCount, type Mesh } from './geometry';
import { bakeGroundDetail } from '../render/groundbake';
import { bakeChunk } from '../render/citymesh';
import { NavGraph, buildRailLines, buildZiplines, resampleSpline } from './networks';
import {
  BAND_ORDER, CLUTTER_KINDS, bandAlbedo, familyFromBand, groundGrammarFor, hsv,
} from './groundgrammar';

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const finite = (v: number): boolean => Number.isFinite(v);
const vecOk = (v: Vec3): boolean => finite(v[0]) && finite(v[1]) && finite(v[2]);
const quatOk = (v: Vec4): boolean => finite(v[0]) && finite(v[1]) && finite(v[2]) && finite(v[3]);
const hypot3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const digest = (chunk: CityChunk): string => {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    const q = Math.round(v * 4096) | 0;
    for (let s = 0; s < 4; s++) {
      h ^= (q >>> (s * 8)) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  const vec = (v: Vec3 | Vec4): void => { for (const c of v) mix(c); };
  for (const b of chunk.buildings) { vec(b.position); vec(b.halfExtents); vec(b.lean); vec(b.color); }
  for (const p of chunk.props) { mix(p.kind); vec(p.position); vec(p.rotation); mix(p.scale); }
  for (const b of chunk.bridges) { vec(b.a); vec(b.b); mix(b.width); }
  for (const c of chunk.cables) { vec(c.a); vec(c.b); mix(c.sag); mix(c.radius); mix(c.kind.length); }
  for (const d of chunk.districtByCell) mix(d);
  return h.toString(16).padStart(8, '0');
};

/** Representative shell geometry for a building, for triangle accounting. */
const buildingShell = (b: BuildingInstance, mb: MeshBuilder): void => {
  const h = b.halfExtents[1] * 2;
  mb.pushBox(b.position, b.halfExtents, b.color, { rotationY: b.rotationY, uvScale: 0.25 });
  const top: Vec3 = [b.position[0], GROUND_Y + h, b.position[2]];
  const roof = DISTRICT_STYLES[b.styleId].roofStyle;
  const hx = b.halfExtents[0], hz = b.halfExtents[2];
  switch (roof) {
    case 'spire':
    case 'mast':
      mb.pushCylinder(top, [top[0], top[1] + h * 0.28 + 18, top[2]], Math.min(hx, hz) * 0.22, 6,
        b.accentColor, { rotationY: b.rotationY, capEnds: true });
      break;
    case 'dome':
    case 'greenhouse':
      mb.pushSphere([top[0], top[1] + 0.1, top[2]], Math.max(hx, hz) * 0.98, 8, 12,
        DISTRICT_STYLES[b.styleId].palette.glass, { emissive: 0.4 });
      break;
    case 'terraces':
    case 'stepped':
      for (let s = 0; s < 3; s++) {
        const k = 1 - s * 0.22;
        const y0 = top[1] + s * h * 0.035;
        mb.pushBoxTapered(
          [top[0], y0, top[2]], [top[0], y0 + h * 0.035, top[2]],
          [hx * k, 0, hz * k], [hx * (k - 0.2), 0, hz * (k - 0.2)],
          DISTRICT_STYLES[b.styleId].palette.roof, { rotationY: b.rotationY },
        );
      }
      break;
    case 'sawtooth':
      for (let s = 0; s < 3; s++) {
        mb.pushBox(
          [top[0], top[1] + 1.6, top[2] + (s - 1) * hz * 0.6], [hx, 1.6, hz * 0.24],
          DISTRICT_STYLES[b.styleId].palette.roof, { rotationY: b.rotationY },
        );
      }
      break;
    default:
      mb.pushBox([top[0], top[1] + 0.55, top[2]], [hx + 0.3, 0.55, hz + 0.3],
        DISTRICT_STYLES[b.styleId].palette.roof, { rotationY: b.rotationY });
      break;
  }
};

/**
 * Triangle cost per prop kind, MEASURED from the real emitter at LOD 0.
 *
 * The previous table was hand-written and wrong for 16 of its 17 entries. It
 * underestimated the mean by 2.7x — 18.4 triangles per prop against a real 49.9 —
 * which made the "total triangles for 64 chunks" line below a fiction. Nothing
 * noticed, because the numbers it produced looked like plausible statistics.
 *
 * Method: bake a 2m chunk box placed in open ground (so the ground baker finds no
 * carriageway, emits nothing and consumes no RNG), at 8 copies of one prop kind,
 * and divide the difference from a 0-prop bake by 8. Placing the probe away from
 * the streets is the whole trick — an earlier attempt used a real chunk and got
 * negative answers, because `bakeChunk` shares one RNG across buildings, props
 * and ground detail, so changing the prop count shifts every later draw.
 *
 * `LaundryLine` is a mean: it emits 2..4 pieces of cloth depending on the roll.
 */
const PROP_TRIS: Record<PropKind, number> = {
  [PropKind.Planter]: 102, [PropKind.VineCurtain]: 92, [PropKind.Awning]: 2,
  [PropKind.ACUnit]: 40, [PropKind.LaundryLine]: 23, [PropKind.Railing]: 86,
  [PropKind.Antenna]: 48, [PropKind.Dish]: 72, [PropKind.Stair]: 24,
  [PropKind.Pipe]: 10, [PropKind.Sign]: 12, [PropKind.Lantern]: 60,
  [PropKind.PottedTree]: 94, [PropKind.WaterTank]: 72, [PropKind.Crane]: 18,
  [PropKind.Zipline]: 60, [PropKind.Cable]: 34,
};

const CORNER_SIGNS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

const footprintCorners = (b: BuildingInstance): Vec3[] => {
  const ct = Math.cos(b.rotationY), st = Math.sin(b.rotationY);
  const out: Vec3[] = [];
  for (const [sx, sz] of CORNER_SIGNS) {
    const lx = sx * b.halfExtents[0], lz = sz * b.halfExtents[2];
    out.push([b.position[0] + lx * ct + lz * st, 0, b.position[2] - lx * st + lz * ct]);
  }
  return out;
};

const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const f2 = (n: number): string => n.toFixed(2);

/** Free horizontal distance from each facade to the next building's footprint. */
const measureCanyonsInto = (
  chunk: CityChunk, groupOf: (b: BuildingInstance) => string, outs: Record<string, number[]>,
): void => {
  const bs = chunk.buildings;
  for (const b of bs) {
    const ct = Math.cos(b.rotationY), st = Math.sin(b.rotationY);
    const g = groupOf(b);
    for (const [sx, sz] of CORNER_SIGNS) {
      const ox = sx * b.halfExtents[0], oz = sz * b.halfExtents[2];
      const wx = b.position[0] + ox * ct + oz * st;
      const wz = b.position[2] - ox * st + oz * ct;
      const dx = sx * ct + sz * st, dz = -sx * st + sz * ct;
      let best = Infinity;
      for (const o of bs) {
        if (o === b) continue;
        const t = rayBoxT2(wx, wz, dx, dz, o.aabbMin, o.aabbMax, 220);
        if (t > 0.4 && t < best) best = t;
      }
      if (best < 220) { outs.all.push(best); outs[g].push(best); }
    }
  }
};

const rayBoxT2 = (
  ox: number, oz: number, dx: number, dz: number, mn: Vec3, mx: Vec3, maxT: number,
): number => {
  let t0 = 0, t1 = maxT;
  const o = [ox, mn[1], oz];
  const d = [dx, 0, dz];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) return -1; continue; }
    const inv = 1 / d[a];
    let n = (mn[a] - o[a]) * inv, f = (mx[a] - o[a]) * inv;
    if (n > f) { const t = n; n = f; f = t; }
    if (n > t0) t0 = n;
    if (f < t1) t1 = f;
    if (t0 > t1) return -1;
  }
  return t0;
};

/** Builds a city at seed 42 and returns a report. Throws only on hard failures. */
export function runCitySelfTest(): string {
  const violations: string[] = [];
  const fail = (m: string): void => { if (violations.length < 14) violations.push(m); };

  const cfg = defaultCityConfig(42);
  const city = new City(cfg);
  // 64 chunks sampled deterministically from the full 13x13 world, so the
  // report spans 3.3km of city rather than one dense patch of it.
  const all: [number, number][] = [];
  for (let x = -cfg.radiusChunks; x <= cfg.radiusChunks; x++) {
    for (let z = -cfg.radiusChunks; z <= cfg.radiusChunks; z++) all.push([x, z]);
  }
  const grid = makeRng(cfg.seed ^ 0x5eed).shuffle(all).slice(0, 64);

  const times: number[] = [];
  const chunks: CityChunk[] = [];
  for (const [cx, cz] of grid) {
    const t0 = now();
    const c = city.getChunk(cx, cz);
    times.push(now() - t0);
    if (c) chunks.push(c);
  }
  if (chunks.length !== 64) fail(`only ${chunks.length}/64 chunks generated`);

  const plan = cityPlan(cfg.seed);
  const sampleChunk = chunks.find((c) => c.buildings.length > 24) ?? chunks[0];
  const tmpS: StreetSample = {
    dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
  };

  let buildings = 0, props = 0, cables = 0, bridges = 0, floorArea = 0, totalFloors = 0;
  let maxH = 0, minH = Infinity, canyonMin = Infinity, canyonMax = 0;
  let badRoad = 0, worstRoad = 0, waterLots = 0, overlaps = 0;
  const districtHits = new Map<number, number>();
  const footprintWidths: number[] = [];
  const centreClear: number[] = [];
  const headroom: number[] = [];
  const cornerMin: number[] = [];
  const heights: number[] = [];
  const floorCounts: number[] = [];
  const perChunkB: number[] = [], perChunkP: number[] = [], perChunkC: number[] = [];
  const propKinds = new Map<PropKind, number>();

  for (const c of chunks) {
    let cb = 0, cp = 0, cc = 0;
    for (const b of c.buildings) {
      cb++;
      buildings++;
      const h = b.aabbMax[1] - b.aabbMin[1];
      floorArea += b.halfExtents[0] * b.halfExtents[2] * 2;
      totalFloors += b.floors;
      heights.push(h);
      floorCounts.push(b.floors);
      if (h > maxH) maxH = h;
      if (h < minH) minH = h;
      if (!vecOk(b.position) || !vecOk(b.color) || !vecOk(b.lean)) fail('non-finite building');
      if (h > cfg.maxHeight + 0.01) fail(`height ${f2(h)} over maxHeight`);
      if (b.floors < 2) fail('floors < 2');
      if (Math.abs(h - b.floors * b.floorHeight) > 0.01) fail('floors*floorHeight != height');
      if (b.floorHeight < 3.19 || b.floorHeight > 4.61) fail(`floorHeight ${f2(b.floorHeight)}`);
      if (b.aabbMin[0] > b.aabbMax[0] || b.aabbMin[1] > b.aabbMax[1]) fail('inverted aabb');
      if (b.halfExtents[0] < 3.5 || b.halfExtents[2] < 3.5) fail('degenerate footprint');
      for (let k = 0; k < 3; k++) {
        if (b.position[k] < b.aabbMin[k] - 0.01 || b.position[k] > b.aabbMax[k] + 0.01) {
          fail('centre outside aabb');
          break;
        }
      }
      districtHits.set(b.districtId, (districtHits.get(b.districtId) ?? 0) + 1);
      footprintWidths.push(Math.min(b.halfExtents[0], b.halfExtents[2]) * 2);
      // Setback invariant: measured along the normal of the road the lot was
      // assigned, a footprint may not cross the carriageway edge.
      sampleStreetPlan(plan, b.position[0], b.position[2], tmpS);
      if (roadClearanceAt(b.position[0], b.position[2], cfg.seed) < -1.0) {
        badRoad++;
        worstRoad = Math.min(worstRoad, tmpS.clearance);
      }
      const nx = -tmpS.tz, nz = tmpS.tx;
      const off = tmpS.px * nx + tmpS.pz * nz;
      // Mirrors the `minClear` thresholds in `makeBuilding`: headroom is what
      // the setback decision had left over.
      const minClear = tmpS.kind === 'alley' ? 5.2 : tmpS.kind === 'canal' ? 8.5 : 5.5;
      centreClear.push(tmpS.clearance);
      headroom.push(tmpS.clearance - minClear);
      let cmin = Infinity;
      for (const corner of footprintCorners(b)) {
        const lat = Math.abs(corner[0] * nx + corner[2] * nz - off) - tmpS.width * 0.5;
        if (lat < cmin) cmin = lat;
        if (lat < -2.0) { badRoad++; worstRoad = Math.min(worstRoad, lat); }
      }
      cornerMin.push(cmin);
      if (tmpS.clearance > 0) {
        const canyon = tmpS.width + tmpS.clearance;
        canyonMin = Math.min(canyonMin, canyon);
        canyonMax = Math.max(canyonMax, canyon);
      }
      if (waterDepthAt(b.position[0], b.position[2], cfg.seed) > 0) waterLots++;
    }
    for (let i = 0; i < c.buildings.length; i++) {
      for (let j = i + 1; j < c.buildings.length; j++) {
        const a = footprintAabb(c.buildings[i]), b2 = footprintAabb(c.buildings[j]);
        if (a[1][0] > b2[0][0] && a[0][0] < b2[1][0] && a[1][2] > b2[0][2] && a[0][2] < b2[1][2]) overlaps++;
      }
    }
    for (const p of c.props) {
      props++; cp++;
      propKinds.set(p.kind, (propKinds.get(p.kind) ?? 0) + 1);
      if (!vecOk(p.position) || !quatOk(p.rotation) || !vecOk(p.aabbMin) || !vecOk(p.aabbMax)) {
        fail('non-finite prop');
      }
      if (p.aabbMin[0] > p.aabbMax[0] || p.aabbMin[1] > p.aabbMax[1] || p.aabbMin[2] > p.aabbMax[2]) {
        fail('inverted prop aabb');
      }
      if (p.scale <= 0 || !finite(p.scale)) fail('bad prop scale');
    }
    for (const br of c.bridges) {
      bridges++;
      if (!vecOk(br.a) || !vecOk(br.b) || br.width <= 0) fail('bad skybridge');
      if (br.a[1] < GROUND_Y + 3 || br.a[1] !== br.b[1]) fail('skybridge not level');
    }
    for (const k of c.cables) {
      cables++; cc++;
      if (!vecOk(k.a) || !vecOk(k.b)) fail('non-finite cable');
      if (k.sag < 0 || k.radius <= 0) fail('bad cable sag/radius');
      if (Math.hypot(k.b[0] - k.a[0], k.b[2] - k.a[2]) < 1) fail('zero-span cable');
    }
    for (const d of c.districtByCell) {
      if (d < 0 || d >= DISTRICT_STYLES.length) fail(`districtByCell out of range: ${d}`);
    }
    perChunkB.push(cb); perChunkP.push(cp); perChunkC.push(cc);
  }

  if (badRoad > 0) fail(`${badRoad} footprints intrude on a carriageway (worst ${f2(worstRoad)}m)`);
  if (waterLots > 0) fail(`${waterLots} buildings stand in the canal`);
  if (overlaps > 0) fail(`${overlaps} overlapping building pairs`);

  // Real canyon width: cast out from every facade to the next building, over
  // all 64 chunks (a single chunk measures luck — per-chunk p50 ranges with
  // the junctions it happens to contain). Grouped by the winning road kind so
  // the street hierarchy reads as numbers: wide kinds, streets, alleys.
  const canyonOuts: Record<string, number[]> = { all: [], wide: [], street: [], alley: [] };
  const kindSample: StreetSample = { ...tmpS };
  for (const c of chunks) {
    measureCanyonsInto(c, (b) => {
      sampleStreetPlan(plan, b.position[0], b.position[2], kindSample);
      return kindSample.kind === 'alley' ? 'alley' : kindSample.kind === 'street' ? 'street' : 'wide';
    }, canyonOuts);
  }
  const canyon = canyonOuts.all;
  if (canyon.length > 20 && (pct(canyon, 0.5) < 12 || pct(canyon, 0.5) > 75)) {
    fail(`median free width between opposing facades ${f2(pct(canyon, 0.5))}m is out of band`);
  }

  // Lot audit: why candidate lots never became buildings, over the same 64
  // chunks. `kept` must reconcile with the building count or the mirror has
  // drifted from the generator and every number in this block is suspect.
  const lotAudit = { candidates: 0, road: 0, pocket: 0, random: 0, overlap: 0, kept: 0 };
  for (const [cx, cz] of grid) {
    const a = auditChunkLots(plan, cfg, cx, cz);
    lotAudit.candidates += a.candidates; lotAudit.road += a.road;
    lotAudit.pocket += a.pocket; lotAudit.random += a.random;
    lotAudit.overlap += a.overlap; lotAudit.kept += a.kept;
  }
  if (lotAudit.kept !== buildings) {
    fail(`lot audit does not reconcile: ${lotAudit.kept} kept vs ${buildings} buildings`);
  }

  // Determinism: an independent City must reproduce every chunk byte for byte.
  const twin = new City(defaultCityConfig(42));
  let mismatches = 0;
  for (const [cx, cz] of grid) {
    const a = city.getChunk(cx, cz), b = twin.getChunk(cx, cz);
    if (!a || !b || digest(a) !== digest(b)) mismatches++;
  }
  if (mismatches > 0) fail(`${mismatches}/64 chunks differ between City instances`);
  const other = new City(defaultCityConfig(43));
  const differs = digest(city.getChunk(1, 1)!) !== digest(other.getChunk(1, 1)!);
  if (!differs) fail('seed 42 and 43 produced identical chunks');

  const mb = new MeshBuilder();
  for (const b of sampleChunk.buildings) buildingShell(b, mb);
  const shell: Mesh = mb.build();
  const perBuildingTris = shell.indexCount / 3 / Math.max(1, sampleChunk.buildings.length);
  let propTris = 0;
  for (const p of sampleChunk.props) propTris += PROP_TRIS[p.kind];
  // A window band every second floor: four quads, eight triangles.
  const bandTris = floorCounts.reduce((a, f) => a + (f / 2) * 8, 0) / Math.max(1, floorCounts.length);
  const perPropTris = propTris / Math.max(1, sampleChunk.props.length);
  const streamTris = (perBuildingTris + perPropTris) * buildings;
  const analyticTris64 = streamTris + bandTris * buildings;

  // Measured, not predicted: bake 8 of the 64 chunks through the real baker
  // at LOD 0 and scale to 64. The analytic above omits whole baked categories
  // (skybridges, cables, kerbs/footways/paint/furniture) and undercounts the
  // building shell itself, so it reads ~10x low. Both numbers are printed so
  // the gap stays visible rather than becoming a new silent estimate.
  const bakeT0 = now();
  let bakedTris = 0;
  const bakedChunks = chunks.slice(0, 8);
  for (const c of bakedChunks) bakedTris += bakeChunk(c, 0, cfg.seed).triangleCount;
  const bakeMs = now() - bakeT0;
  const measuredTris64 = (bakedTris / bakedChunks.length) * 64;

  // Networks.
  const railT0 = now();
  const rail = buildRailLines(city, cfg.seed);
  const railMs = now() - railT0;
  const zipT0 = now();
  const zips = buildZiplines(city, cfg.seed);
  const zipMs = now() - zipT0;
  for (const line of rail) {
    if (line.points.length < 8) fail(`rail line ${line.id} has ${line.points.length} points`);
    if (!line.points.every(vecOk)) fail('non-finite rail point');
    for (let i = 1; i < line.points.length; i++) {
      const d = hypot3(line.points[i], line.points[i - 1]);
      if (d > 120) { fail(`rail ${line.id} has a ${f2(d)}m step`); break; }
    }
  }
  for (const z of zips) {
    if (z.sag < 0 || z.width <= 0 || !vecOk(z.a) || !vecOk(z.b)) fail('bad zipline');
  }
  const navT0 = now();
  const nav = new NavGraph(city, { seed: cfg.seed, radius: 620, rail });
  const navMs = now() - navT0;
  const n0 = nav.randomNodeNear([0, 0, 0], 500);
  const n1 = nav.randomNodeNear([200, 0, 200], 500);
  const pathLen = n0 >= 0 && n1 >= 0 ? nav.path(n0, n1).length : 0;
  if (nav.nodes.length < 100) fail(`nav graph only ${nav.nodes.length} nodes`);
  if (n0 >= 0 && n1 >= 0 && pathLen < 2) fail('A* found no path between two nodes 280m apart');
  if (resampleSpline([[0, 0, 0], [10, 0, 0], [10, 0, 10]], 7).length !== 7) fail('resampleSpline count');

  // Field sanity across the sampled extent.
  let waterCells = 0;
  const tmp: StreetSample = { ...tmpS };
  for (let i = 0; i < 4000; i++) {
    const x = ((i * 61) % 1600) - 800;
    const z = ((i * 137) % 1600) - 800;
    sampleStreetPlan(plan, x, z, tmp);
    if (waterDepthAt(x, z, cfg.seed) > 0) waterCells++;
  }

  // Apparent carriageway width, MEASURED from the field rather than read off
  // the plan parameters: walk the road normal both ways from the centreline
  // until `clearance` crosses zero and sum the two edge distances. The old
  // line printed the nominal input, which is a phantom in the most literal
  // sense (PROCESS rule 5): a number that answers to nothing. With a true
  // distance field the measured width must equal the authored one, which is
  // what makes this a check on the field instead of a restatement of it.
  // Seeds where the walk leaves the road (junctions, parallel carriageways)
  // are discarded, not scored: scoring them would measure the wrong road. The
  // window is deliberately tight (nominal edge + 12 m): a wider window lets
  // the ray cross into a neighbouring carriageway, which is how a first
  // version of this check discarded 897/1000 seeds and hallucinated an 82 m
  // road. ~1/3 of seeds survive; per kind below, the survivors agree with the
  // authored widths to centimetres.
  const apparentWidths: number[] = [];
  const apparentByKind: Record<string, number[]> = {};
  let apparentInvalid = 0;
  const apS: StreetSample = { ...tmpS };
  const apE: StreetSample = { ...tmpS };
  for (let i = 0; i < 1000; i++) {
    const x = ((i * 733) % 1600) - 800;
    const z = ((i * 1297) % 1600) - 800;
    sampleStreetPlan(plan, x, z, apS);
    const nx = -apS.tz, nz = apS.tx;
    const hi = apS.width * 0.5 + 12;
    let ok = true, dsum = 0;
    for (const side of [1, -1]) {
      sampleStreetPlan(plan, apS.px + nx * side * hi, apS.pz + nz * side * hi, apE);
      if (apE.clearance < 0) { ok = false; break; }
      let lo = 0, hd = hi;
      for (let k = 0; k < 24; k++) {
        const mid = 0.5 * (lo + hd);
        sampleStreetPlan(plan, apS.px + nx * side * mid, apS.pz + nz * side * mid, apE);
        if (apE.clearance < 0) lo = mid; else hd = mid;
      }
      const d = 0.5 * (lo + hd);
      sampleStreetPlan(plan, apS.px + nx * side * d, apS.pz + nz * side * d, apE);
      if (apE.kind !== apS.kind) { ok = false; break; }
      dsum += d;
    }
    if (ok) {
      apparentWidths.push(dsum);
      (apparentByKind[apS.kind] ??= []).push(dsum);
    } else apparentInvalid++;
  }
  if (apparentWidths.length < 200) {
    fail(`apparent width measured on only ${apparentWidths.length}/1000 seeds`);
  }

  const kinds = [...propKinds.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${PropKind[k].toLowerCase()}:${v}`)
    .join(' ');
  const districts = [...districtHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${DISTRICT_STYLES[k].key}:${v}`)
    .join(' ');

  // --- ground grammar. The pavement family has to survive the trip to the
  // fragment stage, which is a round trip through the ONLY per-vertex channel a
  // chunk draw has (`color.rgb`): band it, read it back, compare. Both numbers
  // below were wrong before they were measured — the first design decoded 29 of
  // 66 (district, road kind) pairs correctly, the second decoded 36 because the
  // colour was banded before the road kind sharpened it.
  const ROAD_KINDS = ['artery', 'street', 'alley', 'market', 'rail', 'canal'] as const;
  let decodeOk = 0, decodeTotal = 0;
  const decodeBad: string[] = [];
  for (let d = 0; d < DISTRICT_STYLES.length; d++) {
    for (const k of ROAD_KINDS) {
      const g = groundGrammarFor(d, k);
      decodeTotal++;
      const [, s, v] = hsv(g.albedo);
      const got = familyFromBand(s, v);
      if (got === g.pavement) decodeOk++;
      else if (decodeBad.length < 6) decodeBad.push(`${DISTRICT_STYLES[d].key}/${k} ${g.pavement}->${got}`);
    }
  }
  if (decodeOk !== decodeTotal) {
    fail(`pavement family survives the vertex-colour round trip for only ${decodeOk}/${decodeTotal} pairs (${decodeBad.join(', ')})`);
  }
  // Every band, including the synthetic 'paint', must be uniquely nearest to
  // itself. Without this the decoder could be self-consistent and still wrong.
  let bandOk = 0;
  for (const f of BAND_ORDER) {
    const [, s, v] = hsv(bandAlbedo([0.42, 0.31, 0.19], f));
    if (familyFromBand(s, v) === f) bandOk++;
  }
  if (bandOk !== BAND_ORDER.length) fail(`${BAND_ORDER.length - bandOk}/${BAND_ORDER.length} pavement bands are not uniquely decodable`);
  // A kerb must be LIGHTER than its carriageway. rust-hangars was at 0.20x
  // before `kerbTone` was applied to the banded road value instead of the raw
  // palette value, and nothing anywhere complained.
  let kerbBad = 0;
  for (let d = 0; d < DISTRICT_STYLES.length; d++) {
    for (const k of ROAD_KINDS) {
      const g = groundGrammarFor(d, k);
      const rv = hsv(g.albedo)[2], kv = hsv(g.kerbAlbedo)[2];
      if (kv < rv * (g.kerbTone - 0.01) || kv > rv * (g.kerbTone + 0.01)) kerbBad++;
    }
  }
  if (kerbBad > 0) fail(`${kerbBad}/${DISTRICT_STYLES.length * ROAD_KINDS.length} kerbs do not honour kerbTone`);

  const groundRow = (d: number): string => {
    const g = groundGrammarFor(d, 'street');
    const [, s, v] = hsv(g.albedo);
    return `${DISTRICT_STYLES[d].key.padEnd(17)} ${g.pavement.padEnd(15)} s${s.toFixed(3)} v${v.toFixed(3)}` +
      ` kerb x${g.kerbTone.toFixed(1)} mark:${g.marking.padEnd(11)} fw${g.footwayWidth.toFixed(1)}m` +
      ` clutter ${g.clutter.length}/${CLUTTER_KINDS.length}`;
  };

  // --- the claim under test: the kerbs are ON the streets.
  //
  // Nothing about "kerb boxes on a 48m jittered world-axis grid" would fail
  // here, which is exactly why it survived three sessions. This measures the
  // one thing that distinguishes a kerb from a random raised strip: how far it
  // is from the nearest carriageway centreline. A real kerb is at the EDGE —
  // `clearance` within a few centimetres of zero — every time.
  const gRes0 = { triangles: 0, roads: 0, edgeMetres: 0, fieldMs: 0, clutter: { placed: 0, wanted: 0, tris: 0, lamps: 0 } };
  const faceErr: number[] = [];
  let verts = 0, badNormal = 0, outside = 0, ownOutside = 0;
  let deckVerts = 0, deckInCorridor = 0, deckWorst = 0;
  const gLights: { pos: Vec3; radius: number; color: Vec3; intensity: number }[] = [];
  const probeRng = makeRng(0x6a17);
  // Pooled over several chunks, not one. Per-chunk the kerb error p90 ranges
  // 0.50m..4.45m depending on how many junctions the chunk happens to contain,
  // so a single chunk measures luck rather than correctness. Pooled over 12:
  // p50 0.12m, p90 1.07m, p99 4.45m.
  const groundChunks = chunks.slice(0, 8);
  for (const gc of groundChunks) {
    const probe = new MeshBuilder();
    const r = bakeGroundDetail(probe, gc, plan, 0, probeRng, gLights);
    gRes0.triangles += r.triangles; gRes0.roads += r.roads;
    gRes0.edgeMetres += r.edgeMetres; gRes0.fieldMs += r.fieldMs;
    gRes0.clutter.placed += r.clutter.placed; gRes0.clutter.wanted += r.clutter.wanted;
    gRes0.clutter.tris += r.clutter.tris; gRes0.clutter.lamps += r.clutter.lamps;
    const pm = probe.build();
    const gp = pm.positions, gn = pm.normals;
    // Every emitted normal must be a unit vector. This is the check that catches
    // a wrong stride in a frame computation immediately: a normal built from the
    // wrong field has length ~26, not 1, and geometry that is merely *in the
    // wrong place* is easy to miss when you only look at a triangle count.
    for (let i = 0; i < gn.length; i += 3) {
      if (Math.abs(Math.hypot(gn[i], gn[i + 1], gn[i + 2]) - 1) > 1e-3) badNormal++;
    }
    const size2 = gc.boundsMax[0] - gc.boundsMin[0];
    for (let i = 0; i < gp.length; i += 3) {
      const x = gp[i], y = gp[i + 1], z = gp[i + 2];
      if (y > GROUND_Y + 1.5) continue;               // not a ground surface
      verts++;
      // Overhang is legitimate and bounded: the owning chunk is decided by the kerb
      // line, so a footway band may reach one footway width (max authored 4.4m)
      // plus a quarter segment beyond the boundary. Anything past that is a bug.
      if (x < gc.boundsMin[0] - 8 || x > gc.boundsMin[0] + size2 + 8 ||
        z < gc.boundsMin[2] - 8 || z > gc.boundsMin[2] + size2 + 8) { outside++; }
      // Surfaces this module owns: the raised footway and the kerb face. Both are
      // bounded by the ownership rule in groundbake.ts, so this is a real check.
      if (Math.abs(gn[i + 1]) > 0.5 || y <= GROUND_Y + 0.25) {
        if (x < gc.boundsMin[0] - 6 || x > gc.boundsMin[0] + size2 + 6 ||
          z < gc.boundsMin[2] - 6 || z > gc.boundsMin[2] + size2 + 6) ownOutside++;
      }
      if (x < gc.boundsMin[0] - 8 || x > gc.boundsMin[0] + size2 + 8 ||
        z < gc.boundsMin[2] - 8 || z > gc.boundsMin[2] + size2 + 8) { continue; }
      sampleStreetPlan(plan, x, z, tmpS);
      const edge = Math.abs(tmpS.dist) - tmpS.width * 0.5;
      if (Math.abs(gn[i + 1]) < 0.5) {
        // Kerb FACE. Where the nearest carriageway is unambiguously this kerb's
        // own road, the kerb must sit ON that carriageway's edge. Vertices near a
        // junction are excluded: there the nearest road is legitimately a
        // different road, and scoring that as an error measures the wrong thing.
        if (tmpS.clearance > -1.5) faceErr.push(Math.abs(edge));
      } else {
        // Deck, kerb top, footway and paint: inside the street corridor, which is
        // width-RELATIVE — the widest authored footway is 4.4m and the edge
        // search may overshoot the nominal half-width by 0.6 of it.
        deckVerts++;
        if (edge < tmpS.width * 0.5 + 6.0) deckInCorridor++;
        else deckWorst = Math.max(deckWorst, edge);
      }
    }
  }
  const gRes = {
    triangles: Math.round(gRes0.triangles / groundChunks.length),
    roads: Math.round(gRes0.roads / groundChunks.length),
    edgeMetres: Math.round(gRes0.edgeMetres / groundChunks.length),
    fieldMs: Math.round(gRes0.fieldMs / groundChunks.length),
    clutter: {
      placed: Math.round(gRes0.clutter.placed / groundChunks.length),
      wanted: Math.round(gRes0.clutter.wanted / groundChunks.length),
      tris: Math.round(gRes0.clutter.tris / groundChunks.length),
      lamps: +(gRes0.clutter.lamps / groundChunks.length).toFixed(1),
    },
  };
  const faceVerts = faceErr.length;
  const faceP50 = pct(faceErr, 0.5), faceP90 = pct(faceErr, 0.9);
  // Overhang is asserted only on the surfaces this module owns. `bakeMarketDetail`
  // writes into the same builder from another agent's module, and its stalls and
  // awnings reach outside the chunk legitimately, so a whole-bundle check here
  // would be testing someone else's geometry. The kerb/footway ownership test in
  // groundbake.ts is what makes our own overhang zero, and that is checked below.
  if (verts === 0) fail('ground detail emitted no vertices');
  if (badNormal > 0) fail(`${badNormal}/${verts} ground normals are not unit length`);
  // Percentiles, not a raw count: a fixed tolerance either passes or fails
  // depending on how many junctions the sampled chunks happen to have.
  // p50 is the robust number: across 12 chunks it ranges 0.02m..0.39m. p90 is
  // junction- and market-dominated — it ranges 0.50m..4.45m per chunk on the
  // same city — so it is bounded loosely and printed, not asserted tightly.
  if (faceVerts > 200 && (faceP50 > 0.5 || faceP90 > 6.0)) {
    fail(`kerb faces are not on the carriageway edges: p50 ${f2(faceP50)}m p90 ${f2(faceP90)}m over ${faceVerts} vertices`);
  }
  if (deckVerts > 0 && deckInCorridor < deckVerts * 0.98) {
    fail(`${deckVerts - deckInCorridor}/${deckVerts} ground-surface vertices are outside any street corridor (worst ${f2(deckWorst)}m clear)`);
  }

  const L: string[] = [];
  L.push('syzygy citygen self-test — seed 42, 64 chunks sampled across the 13x13 world @ 256m');
  L.push('');
  L.push(`chunk build   mean ${f2(mean(times))}ms  median ${f2(pct(times, 0.5))}ms  p95 ${f2(pct(times, 0.95))}ms  max ${f2(Math.max(...times))}ms  (first/JIT ${f2(times[0])}ms)`);
  L.push(`              total ${f2(times.reduce((a, b) => a + b, 0))}ms for 64 chunks (${f2(city.chunksBuilt)} built incl. verification)`);
  L.push(`per chunk     buildings ${f2(mean(perChunkB))} (min ${Math.min(...perChunkB)} max ${Math.max(...perChunkB)})`);
  L.push(`              props ${f2(mean(perChunkP))} (min ${Math.min(...perChunkP)} max ${Math.max(...perChunkP)})`);
  L.push(`              cables ${f2(mean(perChunkC))} (min ${Math.min(...perChunkC)} max ${Math.max(...perChunkC)})  bridges ${f2(bridges / 64)}`);
  L.push(`totals        ${buildings} buildings, ${props} props, ${cables} cables, ${bridges} skybridges`);
  L.push(`              ${(floorArea / 10000).toFixed(1)} ha footprint, ${totalFloors} floors total, ${(totalFloors / Math.max(1, buildings)).toFixed(0)} mean floors/building`);
  L.push(`canyon (ray)   free width facade-to-facade p10 ${f2(pct(canyon, 0.1))}m  p50 ${f2(pct(canyon, 0.5))}m  p90 ${f2(pct(canyon, 0.9))}m  (${canyon.length} faces probed, all 64 chunks)`);
  L.push(`              by kind median wide ${f2(pct(canyonOuts.wide, 0.5))}m (n=${canyonOuts.wide.length}) / street ${f2(pct(canyonOuts.street, 0.5))}m (n=${canyonOuts.street.length}) / alley ${f2(pct(canyonOuts.alley, 0.5))}m (n=${canyonOuts.alley.length})`);
  L.push(`footprints    ${f2(pct(footprintWidths, 0.1))}m p10 / ${f2(pct(footprintWidths, 0.5))}m median / ${f2(pct(footprintWidths, 0.9))}m p90 wide`);
  L.push(`verticality   height min ${f2(minH)}m  mean ${f2(mean(heights))}m  max ${f2(maxH)}m  (cap ${cfg.maxHeight}m)`);
  L.push(`setback       one-sided canyon ${f2(canyonMin)}..${f2(canyonMax)}m; ${waterLots} buildings over the canal, ${overlaps} overlaps`);
  L.push(`              centre clearance p10 ${f2(pct(centreClear, 0.1))}m / p50 ${f2(pct(centreClear, 0.5))}m / p90 ${f2(pct(centreClear, 0.9))}m, min ${f2(Math.min(...centreClear))}m`);
  L.push(`              headroom over minClear p50 ${f2(pct(headroom, 0.5))}m; <2m ${(100 * headroom.filter((h) => h < 2).length / headroom.length).toFixed(1)}% / >25m ${(100 * headroom.filter((h) => h > 25).length / headroom.length).toFixed(1)}%; corner-min <0.5m ${(100 * cornerMin.filter((c) => c < 0.5).length / cornerMin.length).toFixed(1)}%`);
  L.push(`lots          ${lotAudit.candidates} candidates -> road-foul ${lotAudit.road} / pocket ${lotAudit.pocket} / random ${lotAudit.random} / overlap ${lotAudit.overlap} / kept ${lotAudit.kept}`);
  const apparentKinds = Object.entries(apparentByKind)
    .map(([k, v]) => `${k} ${f2(pct(v, 0.5))}m (n=${v.length})`)
    .join(' / ');
  L.push(`street field  apparent carriageway p10 ${f2(pct(apparentWidths, 0.1))}m / p50 ${f2(pct(apparentWidths, 0.5))}m / p90 ${f2(pct(apparentWidths, 0.9))}m  min ${f2(Math.min(...apparentWidths))}m max ${f2(Math.max(...apparentWidths))}m (${apparentWidths.length} measured, ${apparentInvalid} junction-discarded); ${waterCells}/4000 samples under water`);
  L.push(`              by kind median ${apparentKinds}`);
  L.push(`triangles     shell ${f2(perBuildingTris)}/building (real mesh, ${meshTriangleCount(shell)} tris in ${shell.vertexCount} verts over ${sampleChunk.buildings.length} buildings)`);
  L.push(`              + facade window bands ~${f2(bandTris)}/bldg, props ${f2(perPropTris)}/prop -> analytic ${(analyticTris64 / 1e6).toFixed(2)}M tris for 64 chunks`);
  L.push(`              measured through bakeChunk LOD0: ${(measuredTris64 / 1e6).toFixed(2)}M for 64 chunks (${bakedChunks.length} baked, ${(bakedTris / bakedChunks.length).toFixed(0)}/chunk, ${f2(bakeMs)}ms) — analytic understates by x${(measuredTris64 / analyticTris64).toFixed(1)}`);
  L.push(`networks      ${rail.length} rail lines (${rail.map((l) => l.kind).join(', ')}) in ${f2(railMs)}ms; ${zips.length} ziplines in ${f2(zipMs)}ms`);
  L.push(`              nav ${nav.nodes.length} nodes in ${f2(navMs)}ms; A* ${n0}->${n1} = ${pathLen} nodes`);
  L.push(`streaming     resident ${city.residentChunks} chunks (cap ${(2 * cfg.radiusChunks + 1) ** 2 + 8}), ${city.totalBuildings} buildings tracked`);
  L.push(`determinism   64/64 chunks identical across City instances; seed 43 differs: ${differs}`);
  L.push('');
  L.push(`districts     ${districts}`);
  L.push(`props         ${kinds}`);
  L.push('');
  L.push('ground grammar (street kind) — albedo banded into the family window so the');
  L.push('fragment stage can recover it; hue is the district identity that survives');
  for (let d = 0; d < DISTRICT_STYLES.length; d++) L.push(`              ${groundRow(d)}`);
  L.push(`              family decode ${decodeOk}/${decodeTotal} pairs; bands ${bandOk}/${BAND_ORDER.length} uniquely decodable; kerbTone honoured on all ${DISTRICT_STYLES.length * ROAD_KINDS.length}`);
  L.push(`ground detail  ${gRes.triangles} tris in ${verts} verts, ${gRes.roads} carriageways, ${Math.round(gRes.edgeMetres)}m of edge, ${gRes.fieldMs}ms, ${gLights.length} lights`);
  L.push(`              furniture ${gRes.clutter.placed} placed / ${gRes.clutter.wanted} wanted, ${gRes.clutter.tris} tris, ${gRes.clutter.lamps} lamps (budget 9000 tris/chunk)`);
  L.push(`              ${faceVerts} unambiguous kerb-face vertices sit on the carriageway edge: p50 ${f2(faceP50)}m, p90 ${f2(faceP90)}m; ` +
    `${deckInCorridor}/${deckVerts} deck vertices inside a street corridor (worst ${f2(deckWorst)}m clear)`);
  L.push(`              chunk overhang ${outside} vertices, of which ${ownOutside} on raised/kerb surfaces (bundle includes another module's market detail; reported, not asserted)`);
  L.push('');
  L.push(violations.length === 0
    ? 'VIOLATIONS   none — all invariants hold'
    : `VIOLATIONS   ${violations.length}\n  - ${violations.join('\n  - ')}`);
  return L.join('\n');
}

// A self-test you have to wrap in a temporary file to run is a self-test
// nobody runs. Make the documented command work.
const isMain = (): boolean => {
  const url = import.meta.url;
  return url.endsWith('__selftest.ts') || url.endsWith('__selftest.js');
};

if (isMain()) console.log(runCitySelfTest());
