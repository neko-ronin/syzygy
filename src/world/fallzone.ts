/**
 * The fall zone (DESIGN §8 "Section B's makeshift village", DECISIONS D33): where
 * the fallen megastructure's remains stand and what stands on them. Pure placement
 * data, one per seed: the columns (deck piers, stripped cores, silos and stacks,
 * lattice legs, spire stumps), the deck fragments and bridges between their
 * villages, the off-limits patches, the wreckage on the ground and the village
 * ropeways. citygen clears old buildings out of their way, fallmesh draws them,
 * networks hangs the ropeways and the crowd thins out inside the zone.
 *
 * The deck came after the lower city (owner, 2026-10-15): its piers keep a nominal
 * grid but shift up to PIER_SHIFT off streets, arterials, the rail, the market and
 * the canal. Alleys and old buildings it disregarded: a pier may stand in an alley,
 * and the buildings it needed are gone.
 *
 * citygen imports this module too (buildChunk), so imported bindings are read only
 * inside functions, never in top-level initialisers.
 */

import { clamp, fbm2, makeRng, type Rng, type Vec3 } from '../core/math';
import { GROUND_Y, cityPlan, defaultCityConfig, sampleStreetPlan, type CityPlan, type StreetSample } from './citygen';
import { beltBand, spineHit, type DistrictField, type SpineHit } from './districts';

// ---------------------------------------------------------------- tuning

/** Deck level above the street (DESIGN §8: "the deck stood at ~150 m"). */
export const DECK_H = 150;
/** Nominal pier grid pitch: the regular spacing that says "one structure". */
export const PIER_PITCH = 48;
/** How far a pier may shift off its grid node to clear a street. */
export const PIER_SHIFT = 14;
/** Distance a deck-grid shaft keeps from any carriageway edge that is not an alley. */
export const SHAFT_CLEAR = 12;
/** The same for a stripped core, which is narrower. */
export const CORE_CLEAR = 9;
/** One stacked box: a shipping container is 2.6 m tall. */
export const BOX_H = 2.6;
const CORE_PITCH_ALONG = 34, CORE_PITCH_ACROSS = 58;
/** A pier that fell entirely: rubble and a slab, no column. */
const PIER_MISSING = 0.18;
const PIER_INTACT = 0.2;
const SALVAGE_CUT = 0.1;
/** Silos and stacks stand along the railway, within this of its centreline. */
const NEAR_RAIL = 45;
const SILO_SHARE = 0.2;
const STACK_SHARE = 0.3;
/** Lattice legs stand at the deck's outer edge. */
const LATTICE_SHARE = 0.35;
const CORE_KEEP = 0.13;
const SPIRES_MIN = 3, SPIRES_MAX = 5;
const SPIRE_SPACING = 300;
/** First-pass mean of the repair knob, until the owner says how long ago it fell. */
const REPAIR_MEAN = 0.35;
/** Longest rope or catwalk between two piles, pile edge to pile edge. */
export const MAX_BRIDGE_GAP = 40;
/** Share of the deck band fenced, flooded or overgrown (DESIGN §8: about a quarter). */
export const OFF_LIMITS_SHARE = 0.25;
/** Ropeway cable sag as a share of its span; networks.ts hangs the line with it. */
export const ROPE_SAG = 0.04;
const SLAB_CHANCE = 0.3;
const DECK_KEEP = 0.6;
const ROPEWAYS = 2;

// ---------------------------------------------------------------- types

export type ColumnKind = 'pier' | 'core' | 'silo' | 'stack' | 'lattice' | 'spire';
export type BreakKind = 'intact' | 'shear' | 'crater' | 'cut';
/** How people get up from the ground; 'none' only inside an off-limits patch. */
export type Access = 'core-stair' | 'stair-tower' | 'winch' | 'none';

/**
 * One column and the village on it. Plan extents are on the zone's grid frame
 * (`FallZone.gridYaw`): local x runs along the railway. Round kinds (silo, stack,
 * spire) read `halfX` as their radius, except a silo battery, whose `count`
 * cylinders run along local x over `halfX`.
 */
export interface FallColumn {
  id: number;
  kind: ColumnKind;
  x: number;
  z: number;
  /** Deck grid node for deck-grid kinds; null for stripped cores (estate lattice). */
  node: [number, number] | null;
  halfX: number;
  halfZ: number;
  count: number;
  /** World y of the shaft's top: its break, or its cap when intact. */
  top: number;
  break: BreakKind;
  pileHalfX: number;
  pileHalfZ: number;
  /** World y range of the village pile. */
  pileBase: number;
  pileTop: number;
  /** Everything the bake rolls for this column alone starts here. */
  seed: number;
  offLimits: boolean;
  access: Access;
  /** 0..1: how far the revival's repair has got (DESIGN §8 revival kit). */
  repair: number;
}

export interface DeckFragment { a: number; b: number; y: number; width: number }
export interface VillageBridge { a: number; b: number; ya: number; yb: number; kind: 'rope' | 'catwalk' | 'truss' }
export type PatchKind = 'fenced' | 'flooded' | 'overgrown';
/** An off-limits rectangle on the grid frame; nobody walks inside it. */
export interface OffLimitsPatch { x: number; z: number; halfX: number; halfZ: number; kind: PatchKind }
/** A fallen deck slab or a spire's body, yawed (rotationY) then tilted about its local x axis. */
export interface WreckPiece {
  kind: 'slab' | 'body';
  x: number;
  y: number;
  z: number;
  yaw: number;
  tilt: number;
  halfX: number;
  halfY: number;
  halfZ: number;
}
/** A village ropeway: a ground station, then pile-top stations on `columns`. */
export interface Ropeway { stations: Vec3[]; columns: number[] }

export interface FallZone {
  seed: number;
  gridX: number;
  gridZ: number;
  /** Yaw of the grid frame, MeshBuilder rotationY convention (local x -> (cos, -sin)). */
  gridYaw: number;
  deckY: number;
  columns: FallColumn[];
  decks: DeckFragment[];
  bridges: VillageBridge[];
  patches: OffLimitsPatch[];
  wreck: WreckPiece[];
  ropeways: Ropeway[];
}

// ---------------------------------------------------------------- frame

/** World (x, z) of local (a, b) on a frame yawed by `yaw` (MeshBuilder's rotationY). */
export const onFrame = (ox: number, oz: number, yaw: number, a: number, b: number): [number, number] => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [ox + a * c + b * s, oz - a * s + b * c];
};

/** Local (a, b) of world (x, z) on the same frame. */
export const toFrame = (ox: number, oz: number, yaw: number, x: number, z: number): [number, number] => {
  const c = Math.cos(yaw), s = Math.sin(yaw), dx = x - ox, dz = z - oz;
  return [dx * c - dz * s, dx * s + dz * c];
};

/** A 32-bit finalizer (lowbias32): every input bit reaches every output bit. */
const mix32 = (h: number): number => {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return h ^ (h >>> 16);
};
/**
 * Mixed in sequence, not XORed side by side: `imul(-i, K) ^ imul(-j, K')` equals
 * `imul(i, K) ^ imul(j, K')` often enough that nodes mirrored through the grid
 * origin drew the same rolls (found by the self-test's duplicate-seed check).
 */
const hash3 = (a: number, b: number, c: number): number => mix32(mix32(mix32(c | 0) ^ (a | 0)) ^ (b | 0)) >>> 0;

/** Grid half-span, in nodes, that covers the city box [lo, hi) at any yaw. */
const gridSpan = (lo: number, hi: number): number => Math.ceil(Math.hypot(Math.max(-lo, hi), Math.max(-lo, hi)) / PIER_PITCH) + 1;

const roadSample: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };

/** Clearance from the nearest carriageway edge that is not an alley. */
export const roadClear = (plan: CityPlan, x: number, z: number): number =>
  sampleStreetPlan(plan, x, z, roadSample, false).clearance;

/** Offsets inside PIER_SHIFT, nearest first: a pier moves as little as it can. */
const SHIFTS: [number, number][] = (() => {
  const o: [number, number][] = [];
  for (let a = -PIER_SHIFT; a <= PIER_SHIFT; a += 3.5) {
    for (let b = -PIER_SHIFT; b <= PIER_SHIFT; b += 3.5) if (Math.hypot(a, b) <= PIER_SHIFT) o.push([a, b]);
  }
  return o.sort((p, q) => Math.hypot(p[0], p[1]) - Math.hypot(q[0], q[1]) || p[0] - q[0] || p[1] - q[1]);
})();

/** The nearest spot to a node, within PIER_SHIFT, that is in `band` and `clear` of the roads. */
function siteNear(plan: CityPlan, f: DistrictField, band: 1 | 2, x0: number, z0: number, yaw: number, clear: number): [number, number] | null {
  for (const [a, b] of SHIFTS) {
    const [x, z] = onFrame(x0, z0, yaw, a, b);
    if (beltBand(f, x, z) !== band || roadClear(plan, x, z) < clear) continue;
    return [x, z];
  }
  return null;
}

/** Whether two columns' plan footprints (shaft or pile, whichever is wider), grown by `pad`, overlap. Every column shares the grid yaw. */
export function footprintsOverlap(zone: FallZone, a: FallColumn, b: FallColumn, pad: number): boolean {
  const [ax, az] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, a.x, a.z);
  const [bx, bz] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, b.x, b.z);
  return Math.abs(ax - bx) < Math.max(a.halfX, a.pileHalfX) + Math.max(b.halfX, b.pileHalfX) + pad
    && Math.abs(az - bz) < Math.max(a.halfZ, a.pileHalfZ) + Math.max(b.halfZ, b.pileHalfZ) + pad;
}

// ---------------------------------------------------------------- columns

const column = (kind: ColumnKind, x: number, z: number, node: [number, number] | null, seed: number): FallColumn => ({
  id: -1, kind, x, z, node, halfX: 0, halfZ: 0, count: 1, top: 0, break: 'intact',
  pileHalfX: 0, pileHalfZ: 0, pileBase: 0, pileTop: 0, seed, offLimits: false, access: 'winch', repair: 0,
});

/** The village pile a column carries (DESIGN §8 "Each column kind gets its own village grammar"). */
function pileOn(c: FallColumn, r: Rng): void {
  const boxes = (lo: number, hi: number): number => r.int(lo, hi) * BOX_H;
  switch (c.kind) {
    case 'pier':
      c.pileHalfX = c.halfX * r.range(1.3, 2.0); c.pileHalfZ = c.halfZ * r.range(1.3, 2.0);
      c.pileBase = c.top - 1.5; c.pileTop = c.top + boxes(3, 10);
      break;
    case 'core':
      c.pileHalfX = c.halfX * r.range(1.1, 1.4); c.pileHalfZ = c.halfZ * r.range(1.1, 1.4);
      c.pileBase = c.top - 1; c.pileTop = c.top + boxes(5, 10);
      break;
    case 'silo':
      c.pileHalfX = c.halfX * 1.05; c.pileHalfZ = c.halfZ * 1.25;
      c.pileBase = c.top; c.pileTop = c.top + boxes(2, 4);
      break;
    case 'stack':
      c.pileHalfX = c.pileHalfZ = c.halfX * r.range(1.8, 2.4);
      c.pileTop = c.top - 4; c.pileBase = c.pileTop - boxes(1, 2);
      break;
    case 'lattice':
      c.pileHalfX = c.halfX * 0.85; c.pileHalfZ = c.halfZ * 0.85;
      c.pileTop = c.top - 3; c.pileBase = c.pileTop - boxes(3, 6);
      break;
    case 'spire':
      c.pileHalfX = c.pileHalfZ = c.halfX * 0.8;
      c.pileTop = c.top - 4; c.pileBase = c.top - r.range(20, 35);
      break;
  }
}

interface Site { i: number; j: number; x: number; z: number; r: Rng; edge: boolean; rail: number; clear: number }

/**
 * Every column: deck-grid sites (spires, silos and stacks, lattice legs, piers),
 * then the estates' stripped cores. `fallen` collects the nodes whose pier came
 * down entirely; their slabs are placed later.
 */
function placeColumns(zone: FallZone, plan: CityPlan, r: Rng, lo: number, hi: number, fallen: [number, number, number, number][]): FallColumn[] {
  const f = plan.districts, seed = zone.seed, yaw = zone.gridYaw;
  const hit: SpineHit = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 };
  const inBox = (x: number, z: number): boolean => x >= lo && x < hi && z >= lo && z < hi;
  const node = (i: number, j: number): [number, number] => onFrame(zone.gridX, zone.gridZ, yaw, i * PIER_PITCH, j * PIER_PITCH);
  const N = gridSpan(lo, hi);

  const sites: Site[] = [];
  for (let j = -N; j <= N; j++) {
    for (let i = -N; i <= N; i++) {
      const [x0, z0] = node(i, j);
      if (!inBox(x0, z0) || beltBand(f, x0, z0) !== 1) continue;
      const nr = makeRng(hash3(i, j, seed ^ 0x9e1));
      if (nr.next() < PIER_MISSING) { fallen.push([x0, z0, i, j]); continue; }
      const at = siteNear(plan, f, 1, x0, z0, yaw, SHAFT_CLEAR);
      if (!at) continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => {
        const [nx, nz] = node(i + di, j + dj);
        return beltBand(f, nx, nz) !== 1;
      });
      sites.push({ i, j, x: at[0], z: at[1], r: nr, edge, rail: spineHit(f.rail, at[0], at[1], hit).dist, clear: roadClear(plan, at[0], at[1]) });
    }
  }

  const out: FallColumn[] = [];
  const taken = new Set<Site>();
  const keep = (c: FallColumn): boolean => {
    pileOn(c, makeRng(c.seed));
    if (out.some((o) => footprintsOverlap(zone, o, c, 3))) return false;
    out.push(c);
    return true;
  };

  // Spire stumps: spread along the railway, where a block is big enough to hold one.
  const roomy = sites.filter((s) => s.clear >= 24).sort((a, b) => a.i - b.i || a.j - b.j);
  const want = r.int(SPIRES_MIN, SPIRES_MAX);
  for (let k = 0; k < want && roomy.length > 0; k++) {
    const target = Math.round(((k + 0.5) / want) * (roomy.length - 1));
    for (let d = 0; d < 2 * roomy.length; d++) {
      const s = roomy[target + (d % 2 === 0 ? d / 2 : -(d + 1) / 2)];
      if (!s || taken.has(s)) continue;
      if (out.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < SPIRE_SPACING)) continue;
      const c = column('spire', s.x, s.z, [s.i, s.j], hash3(s.i, s.j, seed ^ 0x5b1e));
      c.halfX = c.halfZ = Math.min(s.r.range(20, 40), s.clear - 4);
      c.top = GROUND_Y + s.r.range(130, 200);
      c.break = 'crater';
      if (!keep(c)) continue;
      taken.add(s);
      for (const o of sites) if (Math.hypot(o.x - s.x, o.z - s.z) < c.halfX + 18) taken.add(o);
      break;
    }
  }

  for (const s of sites) {
    if (taken.has(s)) continue;
    const seedOf = (salt: number): number => hash3(s.i, s.j, seed ^ salt);
    if (s.rail < NEAR_RAIL && s.r.next() < SILO_SHARE) {
      if (s.r.next() < STACK_SHARE) {
        const c = column('stack', s.x, s.z, [s.i, s.j], seedOf(0x57ac));
        c.halfX = c.halfZ = s.r.range(2.5, 4);
        c.top = GROUND_Y + s.r.range(80, 150);
        keep(c);
      } else {
        const rad = s.r.range(4, 6);
        const n = Math.min(s.r.int(3, 6), Math.floor(20 / rad));
        // The battery's end cylinders must clear the roads as its middle does.
        const ends = [-1, 1].every((e) => {
          const [ex, ez] = onFrame(s.x, s.z, yaw, e * (n - 1) * rad, 0);
          return roadClear(plan, ex, ez) >= rad + 2 && beltBand(f, ex, ez) === 1;
        });
        const c = column('silo', s.x, s.z, [s.i, s.j], seedOf(0x5110));
        c.count = ends ? n : 1;
        c.halfX = c.count * rad; c.halfZ = rad;
        c.top = GROUND_Y + s.r.range(40, 70);
        keep(c);
      }
      continue;
    }
    if (s.edge && s.r.next() < LATTICE_SHARE) {
      const c = column('lattice', s.x, s.z, [s.i, s.j], seedOf(0x1a77));
      c.halfX = c.halfZ = s.r.range(6, 9);
      const intact = s.r.next() < 0.3;
      c.break = intact ? 'intact' : 'shear';
      c.top = intact ? zone.deckY : GROUND_Y + DECK_H * s.r.range(0.6, 0.95);
      keep(c);
      continue;
    }
    const c = column('pier', s.x, s.z, [s.i, s.j], seedOf(0x9e7));
    c.halfX = s.r.range(4, 7);
    c.halfZ = c.halfX * s.r.range(0.85, 1);
    const roll = s.r.next();
    if (roll < PIER_INTACT) { c.break = 'intact'; c.top = zone.deckY; }
    else if (roll < PIER_INTACT + SALVAGE_CUT) { c.break = 'cut'; c.top = GROUND_Y + DECK_H * s.r.range(0.35, 0.7); }
    else { c.break = s.r.bool() ? 'shear' : 'crater'; c.top = GROUND_Y + DECK_H * s.r.range(0.4, 0.95); }
    keep(c);
  }

  // Stripped cores: the estates' towers cut back to their lift and stair shafts, in rows.
  const coreA = r.jitter(CORE_PITCH_ALONG / 2), coreB = r.jitter(CORE_PITCH_ACROSS / 2);
  const NA = Math.ceil((N * PIER_PITCH) / CORE_PITCH_ALONG), NC = Math.ceil((N * PIER_PITCH) / CORE_PITCH_ACROSS);
  for (let j = -NC; j <= NC; j++) {
    const rowH = makeRng(hash3(j, 0, seed ^ 0x2097)).range(70, 140);
    for (let i = -NA; i <= NA; i++) {
      const [x0, z0] = onFrame(zone.gridX, zone.gridZ, yaw, coreA + i * CORE_PITCH_ALONG, coreB + j * CORE_PITCH_ACROSS);
      if (!inBox(x0, z0) || beltBand(f, x0, z0) !== 2) continue;
      const er = makeRng(hash3(i, j, seed ^ 0xc02e));
      if (er.next() >= CORE_KEEP) continue;
      const at = siteNear(plan, f, 2, x0, z0, yaw, CORE_CLEAR);
      if (!at) continue;
      const c = column('core', at[0], at[1], null, hash3(i, j, seed ^ 0xc0e5));
      c.halfX = er.range(3, 5); c.halfZ = er.range(3, 5);
      c.top = GROUND_Y + rowH + er.jitter(4);
      keep(c);
    }
  }

  for (const c of out) {
    const cr = makeRng(c.seed ^ 0xacce55);
    c.access = c.kind === 'core' ? 'core-stair' : cr.next() < 0.4 ? 'stair-tower' : 'winch';
    c.repair = clamp(REPAIR_MEAN + 0.25 * fbm2(c.x * 0.004 + 11, c.z * 0.004 - 5, 2) + cr.jitter(0.1), 0, 1);
  }
  return out;
}

// ---------------------------------------------------------------- ground

/** Deck-band grid cells, by their corner node (i, j). */
function deckCells(zone: FallZone, plan: CityPlan, lo: number, hi: number): [number, number][] {
  const out: [number, number][] = [];
  const N = gridSpan(lo, hi);
  for (let j = -N; j <= N; j++) {
    for (let i = -N; i <= N; i++) {
      const [x, z] = onFrame(zone.gridX, zone.gridZ, zone.gridYaw, (i + 0.5) * PIER_PITCH, (j + 0.5) * PIER_PITCH);
      if (x >= lo && x < hi && z >= lo && z < hi && beltBand(plan.districts, x, z) === 1) out.push([i, j]);
    }
  }
  return out;
}

/** The off-limits patch covering (x, z), if any. */
export function patchAt(zone: FallZone, x: number, z: number): OffLimitsPatch | undefined {
  const [a, b] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, x, z);
  return zone.patches.find((p) => {
    const [pa, pb] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, p.x, p.z);
    return Math.abs(a - pa) <= p.halfX && Math.abs(b - pb) <= p.halfZ;
  });
}

/** Fenced, flooded and overgrown rectangles of whole grid cells, until they cover OFF_LIMITS_SHARE of the deck band. */
function placePatches(zone: FallZone, plan: CityPlan, cells: [number, number][]): void {
  const P = PIER_PITCH, seed = zone.seed;
  const order = [...cells].sort((a, b) => hash3(a[0], a[1], seed ^ 0x0ff) - hash3(b[0], b[1], seed ^ 0x0ff) || a[0] - b[0] || a[1] - b[1]);
  const target = OFF_LIMITS_SHARE * cells.length * P * P;
  let area = 0;
  for (const [i, j] of order) {
    if (area >= target) break;
    const pr = makeRng(hash3(i, j, seed ^ 0x9a7c));
    const w = pr.int(1, 3), h = pr.int(1, 2);
    const ca = (i + 0.5 * w) * P, cb = (j + 0.5 * h) * P, hx = 0.5 * w * P, hz = 0.5 * h * P;
    const clash = zone.patches.some((p) => {
      const [pa, pb] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, p.x, p.z);
      return Math.abs(pa - ca) < p.halfX + hx && Math.abs(pb - cb) < p.halfZ + hz;
    });
    if (clash) continue;
    const [x, z] = onFrame(zone.gridX, zone.gridZ, zone.gridYaw, ca, cb);
    if (beltBand(plan.districts, x, z) !== 1) continue;
    const roll = pr.next();
    zone.patches.push({ x, z, halfX: hx, halfZ: hz, kind: roll < 0.4 ? 'fenced' : roll < 0.7 ? 'flooded' : 'overgrown' });
    area += 4 * hx * hz;
  }
}

/** Whether a column's shaft (as a disc grown by `pad`) meets a wreck piece's plan footprint. */
export function shaftMeetsWreck(c: FallColumn, w: WreckPiece, pad: number): boolean {
  const [lx, lz] = toFrame(w.x, w.z, w.yaw, c.x, c.z);
  const rad = Math.hypot(c.halfX, c.halfZ) + pad;
  return Math.abs(lx) < w.halfX + rad && Math.abs(lz) < w.halfZ * Math.cos(w.tilt) + rad;
}

/** Each spire's fallen body: a long ridge from its foot along the belt, cut short where the belt ends. */
function placeBodies(zone: FallZone, plan: CityPlan): void {
  for (const c of zone.columns) {
    if (c.kind !== 'spire') continue;
    const r = makeRng(c.seed ^ 0xb0d1);
    const ang = zone.gridYaw + (r.bool() ? 0 : Math.PI) + r.jitter(0.3);
    let len = r.range(150, 280);
    while (len > 80 && beltBand(plan.districts, ...onFrame(c.x, c.z, ang, c.halfX + len, 0)) === 0) len -= 20;
    const [x, z] = onFrame(c.x, c.z, ang, c.halfX + len / 2, 0);
    const halfZ = c.halfX * 0.6, halfY = c.halfX * 0.35;
    zone.wreck.push({ kind: 'body', x, y: GROUND_Y + halfY, z, yaw: ang, tilt: r.range(0.02, 0.08), halfX: len / 2, halfY, halfZ });
  }
}

/**
 * Fallen deck slabs: one at every node whose pier came down, and at SLAB_CHANCE of
 * the deck cells. Outside the fences a slab keeps off every carriageway but an
 * alley (paths stay open); it never lands on a standing column. Too big: shrink
 * twice, then give up.
 */
function placeSlabs(zone: FallZone, plan: CityPlan, cells: [number, number][], fallen: [number, number, number, number][]): void {
  const seed = zone.seed;
  const spots: { x: number; z: number; key: number }[] = fallen.map(([x, z, i, j]) => ({ x, z, key: hash3(i, j, seed ^ 0x51a1) }));
  for (const [i, j] of cells) {
    if (makeRng(hash3(i, j, seed ^ 0x51ab)).next() >= SLAB_CHANCE) continue;
    const [x, z] = onFrame(zone.gridX, zone.gridZ, zone.gridYaw, (i + 0.5) * PIER_PITCH, (j + 0.5) * PIER_PITCH);
    spots.push({ x, z, key: hash3(i, j, seed ^ 0x51a2) });
  }
  for (const s of spots) {
    const r = makeRng(s.key);
    const x = s.x + r.jitter(10), z = s.z + r.jitter(10);
    const yaw = zone.gridYaw + r.jitter(0.5), tilt = r.range(0.08, 0.6), halfY = 1.2;
    let hx = r.range(10, 25), hz = r.range(6, 14);
    const open = !patchAt(zone, x, z);
    for (let k = 0; k < 3; k++, hx *= 0.7, hz *= 0.7) {
      const piece: WreckPiece = { kind: 'slab', x, y: GROUND_Y + halfY * Math.cos(tilt) + hz * Math.sin(tilt), z, yaw, tilt, halfX: hx, halfY, halfZ: hz };
      // The self-test samples these same 9 x 9 points, so the two agree exactly.
      let onRoad = false;
      for (let u = -1; u <= 1 && !onRoad; u += 0.25) {
        for (let v = -1; v <= 1 && !onRoad; v += 0.25) {
          const [px, pz] = onFrame(x, z, yaw, u * hx, v * hz * Math.cos(tilt));
          if (roadClear(plan, px, pz) < 0.5) onRoad = true;
        }
      }
      if (open && onRoad) continue;
      if (zone.columns.some((c) => shaftMeetsWreck(c, piece, 2))) continue;
      zone.wreck.push(piece);
      break;
    }
  }
}

// ---------------------------------------------------------------- links

/** Plan gap between two columns' footprints along the line between them (conservative). */
const pileGap = (a: FallColumn, b: FallColumn): number =>
  Math.hypot(a.x - b.x, a.z - b.z) - Math.max(a.pileHalfX, a.pileHalfZ, a.halfX) - Math.max(b.pileHalfX, b.pileHalfZ, b.halfX);

/** Slab test: does the segment (x0,z0)-(x1,z1) meet the box |x| <= hx, |z| <= hz? */
function segHitsBox(x0: number, z0: number, x1: number, z1: number, hx: number, hz: number): boolean {
  let t0 = 0, t1 = 1;
  for (const [p, d, h] of [[x0, x1 - x0, hx], [z0, z1 - z0, hz]]) {
    if (Math.abs(d) < 1e-9) { if (Math.abs(p) > h) return false; continue; }
    let ta = (-h - p) / d, tb = (h - p) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** Whether the plan segment a->b passes within `pad` of any column not in `skip`. */
export function segmentBlocked(zone: FallZone, ax: number, az: number, bx: number, bz: number, skip: readonly number[], pad: number): boolean {
  const [p0, q0] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, ax, az);
  const [p1, q1] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, bx, bz);
  for (const c of zone.columns) {
    if (skip.includes(c.id)) continue;
    const [cx, cz] = toFrame(zone.gridX, zone.gridZ, zone.gridYaw, c.x, c.z);
    if (segHitsBox(p0 - cx, q0 - cz, p1 - cx, q1 - cz, Math.max(c.halfX, c.pileHalfX) + pad, Math.max(c.halfZ, c.pileHalfZ) + pad)) return true;
  }
  return false;
}

/** Deck fragments still spanning between grid-adjacent intact piers: streets in the sky. */
function placeDecks(zone: FallZone): void {
  const at = new Map<string, FallColumn>();
  for (const c of zone.columns) if (c.node) at.set(`${c.node[0]},${c.node[1]}`, c);
  for (const c of zone.columns) {
    if (c.kind !== 'pier' || c.break !== 'intact' || !c.node) continue;
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const o = at.get(`${c.node[0] + di},${c.node[1] + dj}`);
      if (!o || o.kind !== 'pier' || o.break !== 'intact') continue;
      const r = makeRng(hash3(c.id, o.id, zone.seed ^ 0xdec));
      if (r.next() >= DECK_KEEP) continue;
      // Shifted piers can bring a third column into the gap; the fragment fell there.
      if (segmentBlocked(zone, c.x, c.z, o.x, o.z, [c.id, o.id], 1)) continue;
      zone.decks.push({ a: c.id, b: o.id, y: zone.deckY, width: r.range(14, 24) });
    }
  }
}

function bridgeBetween(zone: FallZone, a: FallColumn, b: FallColumn): VillageBridge {
  const r = makeRng(hash3(a.id, b.id, zone.seed ^ 0xb21d));
  const y = Math.min(a.pileTop, b.pileTop) - BOX_H;
  return {
    a: a.id, b: b.id,
    ya: clamp(y, a.pileBase + 1, a.pileTop - 1), yb: clamp(y, b.pileBase + 1, b.pileTop - 1),
    kind: a.kind === 'lattice' && b.kind === 'lattice' ? 'truss' : r.next() < 0.6 ? 'rope' : 'catwalk',
  };
}

/** About one bridge per pile: each column to its nearest neighbour, if close, unlinked and clear of third piles. */
function placeBridges(zone: FallZone): void {
  const linked = new Set<string>();
  const key = (a: number, b: number): string => (a < b ? `${a},${b}` : `${b},${a}`);
  for (const d of zone.decks) linked.add(key(d.a, d.b));
  for (const c of zone.columns) {
    let best: FallColumn | null = null, gap = Infinity;
    for (const o of zone.columns) {
      if (o === c) continue;
      const g = pileGap(c, o);
      if (g < gap) { gap = g; best = o; }
    }
    if (!best || gap > MAX_BRIDGE_GAP || linked.has(key(c.id, best.id))) continue;
    if (segmentBlocked(zone, c.x, c.z, best.x, best.z, [c.id, best.id], 1)) continue;
    linked.add(key(c.id, best.id));
    zone.bridges.push(bridgeBetween(zone, c, best));
  }
}

const stationSample: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };

/** A ground station beside a road, off the belt, straight across the belt from `c`. */
function groundStation(zone: FallZone, plan: CityPlan, c: FallColumn): [number, number] | null {
  for (let d = 0; d <= 400; d += 8) {
    for (const side of [1, -1]) {
      const [x, z] = onFrame(c.x, c.z, zone.gridYaw, 0, side * d);
      if (beltBand(plan.districts, x, z) !== 0) continue;
      const s = sampleStreetPlan(plan, x, z, stationSample);
      if (s.clearance >= 1.5 && s.clearance <= 8) return [x, z];
    }
  }
  return null;
}

/** A ropeway from the nearest ground station up to `start`, then up to `hops` more piles, off-limits ones first. */
function ropewayFrom(zone: FallZone, plan: CityPlan, start: FallColumn, used: Set<number>, hops: number): Ropeway | null {
  const g = groundStation(zone, plan, start);
  if (!g || segmentBlocked(zone, g[0], g[1], start.x, start.z, [start.id], 1)) return null;
  const rw: Ropeway = { stations: [[g[0], GROUND_Y + 4, g[1]]], columns: [] };
  let at = start;
  for (let k = 0; k <= hops; k++) {
    rw.columns.push(at.id);
    used.add(at.id);
    rw.stations.push([at.x, at.pileTop + 3, at.z]);
    const from = at;
    const next = zone.columns
      .filter((o) => !used.has(o.id) && Math.hypot(o.x - from.x, o.z - from.z) >= 40 && Math.hypot(o.x - from.x, o.z - from.z) <= 160)
      .sort((p, q) => Number(q.offLimits) - Number(p.offLimits)
        || Math.hypot(p.x - from.x, p.z - from.z) - Math.hypot(q.x - from.x, q.z - from.z) || p.id - q.id)
      .find((o) => !segmentBlocked(zone, from.x, from.z, o.x, o.z, [from.id, o.id], 1));
    if (!next) break;
    at = next;
  }
  return rw;
}

/** ROPEWAYS lines, each starting 300 m or more from the others, off-limits and tall piles first. */
function placeRopeways(zone: FallZone, plan: CityPlan): void {
  const used = new Set<number>();
  const order = [...zone.columns].sort((p, q) => Number(q.offLimits) - Number(p.offLimits) || q.pileTop - p.pileTop || p.id - q.id);
  for (const c of order) {
    if (zone.ropeways.length >= ROPEWAYS) break;
    if (used.has(c.id)) continue;
    if (zone.ropeways.some((rw) => Math.hypot(rw.stations[1][0] - c.x, rw.stations[1][2] - c.z) < 300)) continue;
    const rw = ropewayFrom(zone, plan, c, used, 3);
    if (rw && rw.columns.length >= 2) zone.ropeways.push(rw);
    else if (rw) for (const id of rw.columns) used.delete(id);
  }
}

/** Column ids people can reach from the ground: their own access, then across decks, bridges and ropeways. */
export function reachable(zone: FallZone): Set<number> {
  const adj = new Map<number, number[]>();
  const link = (a: number, b: number): void => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  };
  for (const d of zone.decks) link(d.a, d.b);
  for (const b of zone.bridges) link(b.a, b.b);
  for (const rw of zone.ropeways) for (let k = 1; k < rw.columns.length; k++) link(rw.columns[k - 1], rw.columns[k]);
  const queue = zone.columns.filter((c) => c.access !== 'none').map((c) => c.id);
  for (const rw of zone.ropeways) if (rw.columns.length > 0) queue.push(rw.columns[0]);
  const seen = new Set<number>();
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of adj.get(id) ?? []) if (!seen.has(n)) queue.push(n);
  }
  return seen;
}

/**
 * Nobody is stranded: a column nobody can reach gets a bridge to the nearest
 * reachable one (clear of third piles), else a ropeway of its own, else, as a
 * last resort the self-test reports, a winch.
 */
function connectStranded(zone: FallZone, plan: CityPlan): void {
  for (;;) {
    const seen = reachable(zone);
    const stranded = zone.columns.find((c) => !seen.has(c.id));
    if (!stranded) return;
    const to = zone.columns.filter((c) => seen.has(c.id) && Math.hypot(c.x - stranded.x, c.z - stranded.z) <= 160)
      .sort((p, q) => pileGap(stranded, p) - pileGap(stranded, q) || p.id - q.id)
      .slice(0, 10)
      .find((o) => !segmentBlocked(zone, stranded.x, stranded.z, o.x, o.z, [stranded.id, o.id], 1));
    if (to) { zone.bridges.push(bridgeBetween(zone, stranded, to)); continue; }
    const rw = ropewayFrom(zone, plan, stranded, new Set(), 0);
    if (rw) { zone.ropeways.push(rw); continue; }
    stranded.access = 'winch';
  }
}

// ---------------------------------------------------------------- the zone

const zoneCache = new Map<number, FallZone>();

/** The fall zone for `seed`. Cached; safe to share. */
export function fallZone(seed: number): FallZone {
  const hit = zoneCache.get(seed);
  if (hit) return hit;
  const zone = buildFallZone(seed);
  if (zoneCache.size > 8) zoneCache.delete(zoneCache.keys().next().value as number);
  zoneCache.set(seed, zone);
  return zone;
}

/** Uncached build; the self-test calls it twice to prove determinism. */
export function buildFallZone(seed: number): FallZone {
  const plan = cityPlan(seed);
  const f = plan.districts;
  const r = makeRng((seed ^ 0x6fa11e2d) >>> 0);
  const cfg = defaultCityConfig(seed);
  const lo = -cfg.radiusChunks * cfg.chunkSize, hi = (cfg.radiusChunks + 1) * cfg.chunkSize;
  // Local x along the railway: rotationY maps local x to (cos, -sin), so negate the bearing.
  const gridYaw = -f.rail.bearing;
  const zone: FallZone = {
    seed, gridYaw, deckY: GROUND_Y + DECK_H,
    gridX: f.rail.originX + r.jitter(PIER_PITCH / 2), gridZ: f.rail.originZ + r.jitter(PIER_PITCH / 2),
    columns: [], decks: [], bridges: [], patches: [], wreck: [], ropeways: [],
  };
  const fallen: [number, number, number, number][] = [];
  zone.columns = placeColumns(zone, plan, r, lo, hi, fallen);
  const cells = deckCells(zone, plan, lo, hi);
  placePatches(zone, plan, cells);
  // A spire's body knocked down every column it fell across.
  placeBodies(zone, plan);
  zone.columns = zone.columns.filter((c) => c.kind === 'spire' || !zone.wreck.some((w) => shaftMeetsWreck(c, w, 2)));
  zone.columns.forEach((c, i) => { c.id = i; });
  for (const c of zone.columns) if (patchAt(zone, c.x, c.z)) { c.offLimits = true; c.access = 'none'; }
  placeSlabs(zone, plan, cells, fallen);
  placeDecks(zone);
  placeBridges(zone);
  placeRopeways(zone, plan);
  connectStranded(zone, plan);
  return zone;
}
