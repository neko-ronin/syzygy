/**
 * Streaming city generator. Produces chunk-local instance data (buildings,
 * facade clutter, skybridges, cable webs) plus the continuous street field that
 * everything else — rail lines, navmesh, water — is derived from.
 *
 * The structural idea: there is ONE continuous, seed-deterministic street field
 * in world space (warped grid + organic radial arteries + three deliberate
 * spines: canal, market street, rail cutting). Building lots are laid out on a
 * jittered grid over that field and *dropped* wherever they would intrude on a
 * carriageway. The canyons are therefore an emergent consequence of the street
 * network, not a separate placement pass.
 *
 * Everything is pure: same seed → byte-identical chunks, in any order, forever.
 */

import {
  clamp, fbm2, makeRng, qFromEulerYXZ, smoothstep, worley2,
  type Rng, type Vec3, type Vec4,
} from '../core/math';
import {
  DISTRICT_STYLES, districtAtField, districtField, spineHit, waterDepthAt,
  type DistrictField, type DistrictStyle, type SpineHit, type SpineLine,
} from './districts';

export { waterDepthAt };

// ---------------------------------------------------------------- types

export interface BuildingInstance {
  /** Centre of the box (y is mid-height, not ground). */
  position: Vec3;
  halfExtents: Vec3;
  rotationY: number;
  /** Tilt euler: [pitch about X, twist about Y, roll about Z], radians. */
  lean: Vec3;
  color: Vec3;
  accentColor: Vec3;
  districtId: number;
  styleId: number;
  floors: number;
  floorHeight: number;
  greenery: number;
  windowSeed: number;
  aabbMin: Vec3;
  aabbMax: Vec3;
}

export enum PropKind {
  Planter, VineCurtain, Awning, ACUnit, LaundryLine, Railing, Antenna, Dish,
  Stair, Pipe, Sign, Lantern, PottedTree, WaterTank, Crane, Zipline, Cable,
}

export interface PropInstance {
  kind: PropKind;
  position: Vec3;
  rotation: Vec4;
  scale: number;
  color: Vec3;
  aabbMin: Vec3;
  aabbMax: Vec3;
}

export interface Skybridge {
  a: Vec3;
  b: Vec3;
  width: number;
  color: Vec3;
  districtId: number;
}

export interface Cable {
  a: Vec3;
  b: Vec3;
  sag: number;
  radius: number;
  kind: 'power' | 'tram' | 'zipline' | 'anchor';
}

export interface CityChunk {
  cx: number;
  cz: number;
  buildings: BuildingInstance[];
  props: PropInstance[];
  bridges: Skybridge[];
  cables: Cable[];
  boundsMin: Vec3;
  boundsMax: Vec3;
  /** Coarse district ids, DISTRICT_CELL x DISTRICT_CELL over the chunk. */
  districtByCell: Int8Array;
}

export interface CityConfig {
  seed: number;
  chunkSize: number;
  radiusChunks: number;
  /** Lot-pitch density target; the achieved count runs ~25% under it. */
  buildingsPerChunk: number;
  propsPerChunk: number;
  maxHeight: number;
  /** 0..2 global clutter multiplier. */
  detail: number;
}

export const defaultCityConfig = (seed: number): CityConfig => ({
  seed,
  chunkSize: 256,
  radiusChunks: 6,
  buildingsPerChunk: 24,
  propsPerChunk: 1200,
  maxHeight: 600,
  detail: 1,
});

export const DISTRICT_CELL = 16;
/** Hard ceiling on storeys, independent of how short the floor-to-floor is. */
export const MAX_FLOORS = 160;
/** Measured fraction of candidate lots that survive the street/courtyard tests. */
const LOT_SURVIVAL = 0.11;
/** Top of the quay / street deck. Everything is built up from here. */
export const GROUND_Y = 0.35;

/** Nominal half-extents per prop kind, before `scale`. */
export const PROP_SIZE: Record<PropKind, Vec3> = {
  [PropKind.Planter]: [0.72, 0.26, 0.3],
  [PropKind.VineCurtain]: [1.7, 3.1, 0.14],
  [PropKind.Awning]: [1.45, 0.09, 0.95],
  [PropKind.ACUnit]: [0.46, 0.4, 0.36],
  [PropKind.LaundryLine]: [2.4, 0.9, 0.06],
  [PropKind.Railing]: [3.0, 0.5, 0.07],
  [PropKind.Antenna]: [0.5, 4.0, 0.5],
  [PropKind.Dish]: [0.72, 0.72, 0.36],
  [PropKind.Stair]: [1.45, 2.1, 1.05],
  [PropKind.Pipe]: [0.18, 6.0, 0.18],
  [PropKind.Sign]: [1.0, 0.72, 0.13],
  [PropKind.Lantern]: [0.26, 0.36, 0.26],
  [PropKind.PottedTree]: [1.1, 2.0, 1.1],
  [PropKind.WaterTank]: [1.5, 1.8, 1.5],
  [PropKind.Crane]: [1.0, 6.0, 1.0],
  [PropKind.Zipline]: [12.0, 0.3, 0.3],
  [PropKind.Cable]: [6.0, 0.16, 0.16],
};

const quatRotAbs = (q: Vec4): number[] => {
  const [x, y, z, w] = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  return [
    1 - (yy + zz), xy + wz, xz - wy,
    xy - wz, 1 - (xx + zz), yz + wx,
    xz + wy, yz - wx, 1 - (xx + yy),
  ];
};

/** World-space AABB of a prop, exact for a rotated box. */
export function propAabb(position: Vec3, rotation: Vec4, scale: number, kind: PropKind): [Vec3, Vec3] {
  const s = PROP_SIZE[kind];
  const m = quatRotAbs(rotation);
  const hx = s[0] * scale, hy = s[1] * scale, hz = s[2] * scale;
  const ex = Math.abs(m[0]) * hx + Math.abs(m[1]) * hy + Math.abs(m[2]) * hz;
  const ey = Math.abs(m[3]) * hx + Math.abs(m[4]) * hy + Math.abs(m[5]) * hz;
  const ez = Math.abs(m[6]) * hx + Math.abs(m[7]) * hy + Math.abs(m[8]) * hz;
  return [
    [position[0] - ex, position[1] - ey, position[2] - ez],
    [position[0] + ex, position[1] + ey, position[2] + ez],
  ];
}

// ---------------------------------------------------------------- street field

export type RoadKind = 'artery' | 'street' | 'alley' | 'market' | 'rail' | 'canal';

export interface StreetSample {
  /** Distance from the query point to the nearest centreline. */
  dist: number;
  /** Closest point on that centreline. */
  px: number;
  pz: number;
  /** Unit tangent along the centreline. */
  tx: number;
  tz: number;
  /** Full carriageway width. */
  width: number;
  kind: RoadKind;
  /** `dist - width/2`: negative inside the carriageway. */
  clearance: number;
}

export interface Arterial extends SpineLine { width: number; }

export interface CityPlan {
  seed: number;
  districts: DistrictField;
  arterials: Arterial[];
  gridPeriod: number;
  alleyPeriod: number;
  streetWidth: number;
  alleyWidth: number;
}

const planCache = new Map<number, CityPlan>();

/** Per-seed structural plan. Cached; safe to share between City instances. */
export function cityPlan(seed: number): CityPlan {
  const hit = planCache.get(seed);
  if (hit) return hit;
  const d = districtField(seed);
  const r = makeRng((seed ^ 0x27a1c3f1) >>> 0);
  const nArt = r.int(5, 7);
  const arterials: Arterial[] = [];
  for (let i = 0; i < nArt; i++) {
    arterials.push({
      key: 'artery',
      bearing: (i / nArt) * Math.PI * 2 + r.jitter(0.42),
      originX: r.jitter(180), originZ: r.jitter(180),
      amp: r.range(260, 640),
      freq: r.range(0.00016, 0.00030),
      phase: r.range(0, 60),
      width: r.range(28, 44),
    });
  }
  const plan: CityPlan = {
    seed,
    districts: d,
    arterials,
    gridPeriod: r.range(132, 176),
    alleyPeriod: r.range(76, 112),
    streetWidth: r.range(24, 32),
    alleyWidth: r.range(8, 13),
  };
  if (planCache.size > 8) planCache.delete(planCache.keys().next().value as number);
  planCache.set(seed, plan);
  return plan;
}

const planHit: SpineHit = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 };
const planSample: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };

/** Fills and returns `out` with the nearest carriageway to (x, z). */
export function sampleStreetPlan(plan: CityPlan, x: number, z: number, out: StreetSample): StreetSample {
  const d = plan.districts;
  const ox = d.ox, oz = d.oz;
  let best = Infinity;
  const take = (h: SpineHit, width: number, kind: RoadKind): void => {
    const clearance = h.dist - width * 0.5;
    if (clearance >= best) return;
    best = clearance;
    out.dist = h.dist;
    out.px = h.px;
    out.pz = h.pz;
    out.tx = h.tx;
    out.tz = h.tz;
    out.width = width;
    out.kind = kind;
  };
  take(spineHit(d.canal, x, z, planHit), d.canal.width, 'canal');
  take(spineHit(d.market, x, z, planHit), d.market.width, 'market');
  take(spineHit(d.rail, x, z, planHit), d.rail.width, 'rail');

  const warpAt = (wx: number, wz: number): number =>
    320 * fbm2(wx * 0.00082 + ox, wz * 0.00082 + oz, 3);

  const P = plan.gridPeriod;
  const w = warpAt(x, z);
  const su = (x + w) / P, sv = (z + w) / P;
  const nu = Math.round(su), nv = Math.round(sv);
  const du = (su - nu) * P, dv = (sv - nv) * P;
  // Each grid line is a curve whose *lateral* axis is the one it does not
  // vary along: the u-family holds x roughly constant and runs along z.
  const cx = nu * P - w, cz = nv * P - w;
  const dwx = (warpAt(cx + 6, cz) - warpAt(cx - 6, cz)) / 12;
  const dwz = (warpAt(cx, cz + 6) - warpAt(cx, cz - 6)) / 12;
  const uNear = Math.abs(du) <= Math.abs(dv);
  const gridClear = Math.min(Math.abs(du), Math.abs(dv)) - plan.streetWidth * 0.5;
  if (gridClear < best) {
    best = gridClear;
    if (uNear) {
      out.dist = Math.abs(du); out.px = cx; out.pz = z;
      out.tx = -dwz; out.tz = 1;
    } else {
      out.dist = Math.abs(dv); out.px = x; out.pz = cz;
      out.tx = 1; out.tz = -dwx;
    }
    const l = Math.hypot(out.tx, out.tz) || 1;
    out.tx /= l; out.tz /= l;
    out.width = plan.streetWidth;
    out.kind = 'street';
  }

  const AP = plan.alleyPeriod;
  const aw = 60 * fbm2(x * 0.0034 + ox + 31, z * 0.0034 + oz - 17, 2);
  const au = (x + aw) / AP, av = (z + aw) / AP;
  const adu = (au - Math.round(au)) * AP, adv = (av - Math.round(av)) * AP;
  const adwx = 0.2 * (fbm2((x + 6) * 0.0034 + ox + 31, z * 0.0034 + oz - 17, 2)
    - fbm2((x - 6) * 0.0034 + ox + 31, z * 0.0034 + oz - 17, 2));
  const adwz = 0.2 * (fbm2(x * 0.0034 + ox + 31, (z + 6) * 0.0034 + oz - 17, 2)
    - fbm2(x * 0.0034 + ox + 31, (z - 6) * 0.0034 + oz - 17, 2));
  const aNear = Math.abs(adu) <= Math.abs(adv);
  const alleyClear = Math.min(Math.abs(adu), Math.abs(adv)) - plan.alleyWidth * 0.5;
  if (alleyClear < best) {
    best = alleyClear;
    if (aNear) {
      out.dist = Math.abs(adu); out.px = Math.round(au) * AP - aw; out.pz = z;
      out.tx = -adwz; out.tz = 1;
    } else {
      out.dist = Math.abs(adv); out.px = x; out.pz = Math.round(av) * AP - aw;
      out.tx = 1; out.tz = -adwx;
    }
    const l = Math.hypot(out.tx, out.tz) || 1;
    out.tx /= l; out.tz /= l;
    out.width = plan.alleyWidth;
    out.kind = 'alley';
  }

  // Cheap conservative reject first: the wander can shift a line by at most
  // `amp` laterally, so a point far off the un-wandered ray cannot reach it.
  const rad = Math.hypot(x, z);
  const th = Math.atan2(z, x);
  for (const a of plan.arterials) {
    if (rad > 120) {
      let d0 = th - a.bearing;
      d0 = Math.atan2(Math.sin(d0), Math.cos(d0));
      if (Math.abs(d0) * rad - a.amp - a.width > best) continue;
    }
    const h = spineHit(a, x, z, planHit);
    if (h.along < -300 || h.along > 4600) continue;
    take(h, a.width, 'artery');
  }

  out.clearance = best;
  return out;
}

/** Nearest carriageway to a world position. Allocates; use the *Plan form in loops. */
export const sampleStreet = (x: number, z: number, seed: number): StreetSample =>
  sampleStreetPlan(cityPlan(seed), x, z, { ...planSample });

/** Signed distance outside the nearest carriageway. Negative = in the road. */
export const roadClearanceAt = (x: number, z: number, seed: number): number =>
  sampleStreetPlan(cityPlan(seed), x, z, { ...planSample }).clearance;

// ---------------------------------------------------------------- lot hash

const lotHash = (ix: number, iz: number, salt: number): number => {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iz | 0, 0x165667b1) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
};

const lotRng = (ix: number, iz: number, salt: number): Rng => makeRng(lotHash(ix, iz, salt));

// ---------------------------------------------------------------- spatial index

class BoxIndex {
  private cells = new Map<number, number[]>();
  private items: BuildingInstance[];
  private ox: number;
  private oz: number;
  private cs: number;

  constructor(items: BuildingInstance[], minX: number, minZ: number, cell: number) {
    this.items = items;
    this.ox = minX;
    this.oz = minZ;
    this.cs = cell;
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      const x0 = Math.floor((b.aabbMin[0] - minX) / cell);
      const x1 = Math.floor((b.aabbMax[0] - minX) / cell);
      const z0 = Math.floor((b.aabbMin[2] - minZ) / cell);
      const z1 = Math.floor((b.aabbMax[2] - minZ) / cell);
      for (let gz = z0; gz <= z1; gz++) {
        for (let gx = x0; gx <= x1; gx++) {
          const k = gx * 8192 + gz;
          const bucket = this.cells.get(k);
          if (bucket) bucket.push(i);
          else this.cells.set(k, [i]);
        }
      }
    }
  }

  query(minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): void {
    const x0 = Math.floor((minX - this.ox) / this.cs), x1 = Math.floor((maxX - this.ox) / this.cs);
    const z0 = Math.floor((minZ - this.oz) / this.cs), z1 = Math.floor((maxZ - this.oz) / this.cs);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const bucket = this.cells.get(gx * 8192 + gz);
        if (!bucket) continue;
        for (const i of bucket) {
          const b = this.items[i];
          if (b.aabbMax[0] < minX || b.aabbMin[0] > maxX) continue;
          if (b.aabbMax[2] < minZ || b.aabbMin[2] > maxZ) continue;
          out.push(i);
        }
      }
    }
  }
}

/** Incremental XZ occupancy grid used to keep building footprints disjoint. */
class Occupancy {
  private readonly cells = new Map<number, BuildingInstance[]>();
  constructor(private readonly minX: number, private readonly minZ: number, private readonly cs: number) {}

  overlaps(mn: Vec3, mx: Vec3, pad: number): boolean {
    const x0 = Math.floor((mn[0] - pad - this.minX) / this.cs);
    const x1 = Math.floor((mx[0] + pad - this.minX) / this.cs);
    const z0 = Math.floor((mn[2] - pad - this.minZ) / this.cs);
    const z1 = Math.floor((mx[2] + pad - this.minZ) / this.cs);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const bucket = this.cells.get(gx * 8192 + gz);
        if (!bucket) continue;
        for (const b of bucket) {
          if (b.aabbMax[0] < mn[0] - pad || b.aabbMin[0] > mx[0] + pad) continue;
          if (b.aabbMax[2] < mn[2] - pad || b.aabbMin[2] > mx[2] + pad) continue;
          return true;
        }
      }
    }
    return false;
  }

  add(b: BuildingInstance): void {
    const x0 = Math.floor((b.aabbMin[0] - this.minX) / this.cs);
    const x1 = Math.floor((b.aabbMax[0] - this.minX) / this.cs);
    const z0 = Math.floor((b.aabbMin[2] - this.minZ) / this.cs);
    const z1 = Math.floor((b.aabbMax[2] - this.minZ) / this.cs);
    for (let gz = z0; gz <= z1; gz++) {
      for (let gx = x0; gx <= x1; gx++) {
        const k = gx * 8192 + gz;
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(b);
        else this.cells.set(k, [b]);
      }
    }
  }
}

/** Entry parameter of a ray into an AABB, or -1 for a miss. */
const rayBox = (o: Vec3, d: Vec3, mn: Vec3, mx: Vec3, maxT: number): number => {
  let t0 = 0, t1 = maxT;
  for (let a = 0; a < 3; a++) {
    const da = d[a], oa = o[a];
    if (Math.abs(da) < 1e-9) {
      if (oa < mn[a] || oa > mx[a]) return -1;
      continue;
    }
    const inv = 1 / da;
    let n = (mn[a] - oa) * inv, f = (mx[a] - oa) * inv;
    if (n > f) { const t = n; n = f; f = t; }
    if (n > t0) t0 = n;
    if (f < t1) t1 = f;
    if (t0 > t1) return -1;
  }
  return t0;
};

const dist2d = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(ax - bx, az - bz);

/**
 * Axis-aligned box of the *footprint* only. `aabbMin/Max` additionally carries
 * the lean pad, which is right for culling but far too pessimistic for deciding
 * whether two buildings collide.
 */
export function footprintAabb(b: BuildingInstance): [Vec3, Vec3] {
  const c = Math.abs(Math.cos(b.rotationY)), s = Math.abs(Math.sin(b.rotationY));
  const ex = c * b.halfExtents[0] + s * b.halfExtents[2];
  const ez = s * b.halfExtents[0] + c * b.halfExtents[2];
  return [
    [b.position[0] - ex, GROUND_Y, b.position[2] - ez],
    [b.position[0] + ex, GROUND_Y + b.halfExtents[1] * 2, b.position[2] + ez],
  ];
}

// ---------------------------------------------------------------- chunk build

const scratchSample: StreetSample = { ...planSample };

function makeBuilding(
  plan: CityPlan, cfg: CityConfig, ix: number, iz: number, wx: number, wz: number, pitch: number,
): BuildingInstance | null {
  const s = sampleStreetPlan(plan, wx, wz, scratchSample);
  // Below this a lot cannot hold even the smallest footprint without fouling
  // the carriageway, and the canyon would read as a wall rather than a street.
  // Alleys and service lanes get away with less than real streets.
  const minClear = s.kind === 'alley' ? 5.2 : s.kind === 'canal' ? 8.5 : 5.5;
  if (s.clearance < minClear) return null;

  const r = lotRng(ix, iz, 17);
  // Courtyards and light wells: worley pockets punch holes in the block interiors.
  const pocket = worley2(wx * 0.0091 + plan.districts.ox * 0.01, wz * 0.0091 - plan.districts.oz * 0.01);
  if (pocket < 0.085) return null;
  if (r.next() < 0.06) return null;

  const districtId = districtAtField(plan.districts, wx, wz);
  const style = DISTRICT_STYLES[districtId];

  // Frontage always follows the nearest carriageway, so party walls line up.
  const yaw = Math.atan2(-s.tz, s.tx) + r.jitter(0.07);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);

  // Ordinary lots infill tightly; a minority of lots go mega and swallow their
  // neighbours in the de-overlap pass, which is how the arcology blocks clear
  // the plazas around them.
  const sizeT = Math.pow(r.next(), 1.55);
  const mega = r.next() < clamp((style.footprintRange[1] - pitch) / 90, 0, 0.45);
  const cap = pitch * (mega ? 2.6 : 0.48);
  const gap = style.gapBias;
  let hx = style.footprintRange[0] + (style.footprintRange[1] - style.footprintRange[0]) * sizeT;
  hx *= 1 + (gap - 1) * 0.22;
  let hz = hx * r.range(0.62, 1.0) * (2 - gap * 0.28);
  hx = Math.min(hx, cap);
  hz = Math.min(hz, cap);

  // Never cross the carriageway. The corridor edge is measured along the road's
  // own normal, not along the vector to the projection, so a winding street
  // still gets a parallel setback instead of a corner-first one.
  const nX = -s.tz, nZ = s.tx;
  const side = (wx - s.px) * nX + (wz - s.pz) * nZ >= 0 ? 1 : -1;
  const reach = Math.abs(nX * cy + nZ * -sy) * hx + Math.abs(nX * sy + nZ * cy) * hz;
  const room = s.clearance - 1.6;
  if (reach > room && reach > 0) {
    const k = Math.max(0.03, room / reach);
    hx *= k;
    hz *= k;
  }
  // The floor is bounded by the room available, so the setback can never invert.
  hx = Math.max(Math.min(4.2, room), hx);
  hz = Math.max(Math.min(4.2, room), hz);

  // Power law inside the district band, then a bounded local boost: a dense
  // mode of mid-rise with a thin tail of genuine supertalls.
  const cluster = fbm2(wx * 0.00092 + plan.districts.ox, wz * 0.00092 + plan.districts.oz, 3);
  const core = smoothstep(1400, 220, Math.hypot(wx, wz));
  const arterial = 1 - clamp(s.dist / 260, 0, 1);
  const boost = 0.86 + 0.3 * (cluster * 0.5 + 0.5) + 0.18 * arterial + 0.34 * core;
  const [lo, hi] = style.heightRange;
  let height = (lo + (hi - lo) * Math.pow(r.next(), 2.6)) * boost;
  height = Math.max(9, Math.min(cfg.maxHeight, height));

  const floorHeight = r.range(3.2, 4.6);
  let floors = Math.max(2, Math.round(height / floorHeight));
  floors = Math.min(floors, MAX_FLOORS, Math.floor(cfg.maxHeight / floorHeight));
  height = floors * floorHeight;

  const leanMag = style.leanAmount * r.range(0.45, 1.0) * (style.leanAmount > 0.03 ? 1 : 0.7);
  const lean: Vec3 = [
    -nZ * side * leanMag,
    r.jitter(0.12) * style.leanAmount,
    nX * side * leanMag,
  ];

  const shade = r.range(0.78, 1.18);
  const cool = r.range(0.0, 0.22);
  const base = style.palette.base;
  const color: Vec3 = [
    base[0] * shade * (1 - cool * 0.35) + style.palette.secondary[0] * cool * 0.5,
    base[1] * shade,
    base[2] * shade * (1 + cool * 0.2),
  ];
  const half: Vec3 = [hx, height * 0.5, hz];
  const position: Vec3 = [wx, GROUND_Y + height * 0.5, wz];
  const ex = Math.abs(cy) * hx + Math.abs(sy) * hz;
  const ez = Math.abs(sy) * hx + Math.abs(cy) * hz;
  const leanExtra = Math.abs(lean[0]) + Math.abs(lean[2]);
  const pad = leanExtra * height * 0.5;

  const greenery = clamp(style.greenery * r.range(0.7, 1.15) * (0.8 + 0.4 * (fbm2(wx * 0.004, wz * 0.004, 2) * 0.5 + 0.5)), 0, 1);

  return {
    position, halfExtents: half, rotationY: yaw, lean, color,
    accentColor: style.accentColor,
    districtId,
    styleId: style.id,
    floors,
    floorHeight,
    greenery,
    windowSeed: lotHash(ix, iz, 3),
    aabbMin: [wx - ex - pad, GROUND_Y, wz - ez - pad],
    aabbMax: [wx + ex + pad, GROUND_Y + height, wz + ez + pad],
  };
}

function placeProps(
  cfg: CityConfig, b: BuildingInstance, style: DistrictStyle, budget: number, r: Rng, out: PropInstance[],
): void {
  const th = b.rotationY;
  const ct = Math.cos(th), st = Math.sin(th);
  const hx = b.halfExtents[0], hz = b.halfExtents[2], hy = b.halfExtents[1];
  const baseY = b.position[1] - hy;
  const roofY = b.position[1] + hy;
  const dense = style.cableDensity * cfg.detail;
  const green = b.greenery;
  let n = 0;

  const faceAt = (face: number, u: number, out2: number): Vec3 => {
    const nx = face < 2 ? (face === 0 ? 1 : -1) : 0;
    const nz = face < 2 ? 0 : (face === 2 ? 1 : -1);
    const off = face < 2 ? hx : hz;
    return [
      b.position[0] + nx * off + ct * u,
      out2,
      b.position[2] + nz * off - st * u,
    ];
  };
  const faceYaw = (face: number): number =>
    face === 0 ? th - Math.PI / 2 : face === 1 ? th + Math.PI / 2 : face === 2 ? th : th + Math.PI;

  const put = (
    kind: PropKind, p: Vec3, face: number, scale: number, color: Vec3, tilt: boolean,
  ): void => {
    const q = qFromEulerYXZ(
      faceYaw(face),
      tilt ? b.lean[0] : 0,
      tilt ? b.lean[2] : 0,
    );
    const [aabbMin, aabbMax] = propAabb(p, q, scale, kind);
    out.push({ kind, position: p, rotation: q, scale, color, aabbMin, aabbMax });
    n++;
  };

  // Facade: per-floor sill clutter on all four elevations.
  const floors = b.floors;
  const facadeFloors = Math.min(floors, 60);
  for (let f = 0; f < facadeFloors; f++) {
    const y = baseY + f * b.floorHeight + 1.05;
    if (y > roofY - 1) break;
    const face = r.int(0, 3);
    const halfW = face < 2 ? hz : hx;
    const roll = r.next();
    if (roll < 0.30 * dense) put(PropKind.ACUnit, faceAt(face, r.jitter(halfW * 0.7), y), face, r.range(0.8, 1.3), style.palette.metal, false);
    else if (roll < 0.30 * dense + 0.22 * green) put(PropKind.Planter, faceAt(face, r.jitter(halfW * 0.75), y), face, r.range(0.85, 1.4), style.palette.foliage, false);
    else if (roll < 0.30 * dense + 0.22 * green + 0.20) put(PropKind.LaundryLine, faceAt(face, r.jitter(halfW * 0.6), y), face, r.range(0.9, 1.7), style.palette.secondary, true);
    else if (roll < 0.30 * dense + 0.22 * green + 0.20 + 0.14 * green) {
      put(PropKind.VineCurtain, faceAt(face, r.jitter(halfW * 0.7), y - 1.2), face, r.range(0.8, 1.6), style.palette.foliage, true);
    }
    if (f % 4 === 0 && y < baseY + 26 && r.next() < 0.55) {
      put(PropKind.Awning, faceAt(face, r.jitter(halfW * 0.6), baseY + 3.4), face, r.range(0.9, 1.5), style.palette.trim, true);
    }
    if (y < baseY + 7.5 && r.next() < 0.4 * dense) {
      put(PropKind.Sign, faceAt(face, r.jitter(halfW * 0.5), y + 1.4), face, r.range(0.7, 1.6), style.palette.emissive, false);
    }
    if (r.next() < 0.10 * dense) {
      put(PropKind.Lantern, faceAt(face, r.jitter(halfW * 0.8), y + 0.6), face, r.range(0.8, 1.5), style.palette.emissive, false);
    }
    if (n >= budget) return;
  }

  // Corner downpipes run the full height — the vertical read of the facade.
  if (n < budget && r.next() < 0.75) {
    const face = r.int(0, 3);
    const halfW = face < 2 ? hz : hx;
    const p = faceAt(face, halfW * 0.94, baseY + hy * 0.98);
    put(PropKind.Pipe, p, face, hy / 12, style.palette.metal, false);
  }

  // Rooftop: the solarpunk layer. Parapets, planters, canopies, trees, tanks.
  const roofBudget = Math.max(2, Math.floor(budget * 0.35));
  const roofStart = n;
  for (let i = 0; i < 4 && n - roofStart < roofBudget; i++) {
    const halfW = i < 2 ? hz : hx;
    if (r.next() < 0.55 + 0.3 * green) {
      put(PropKind.Railing, faceAt(i, 0, roofY + 0.5), i, Math.min(2.2, (halfW * 2) / 6), style.palette.metal, false);
    }
  }
  let guard = 0;
  while (n - roofStart < roofBudget && guard++ < 40) {
    const face = r.int(0, 3);
    const halfW = face < 2 ? hz : hx;
    const roll = r.next();
    const p = faceAt(face, r.jitter(halfW * 0.72), roofY + 0.4);
    if (roll < 0.34 * green + 0.1) put(PropKind.Planter, p, face, r.range(1.0, 2.2), style.palette.foliage, false);
    else if (roll < 0.55 * green + 0.16) put(PropKind.PottedTree, p, face, r.range(0.8, 1.6), style.palette.foliage, false);
    else if (roll < 0.64) put(PropKind.WaterTank, p, face, r.range(0.9, 1.5), style.palette.metal, false);
    else if (roll < 0.74 * dense) put(PropKind.ACUnit, p, face, r.range(0.9, 1.6), style.palette.metal, false);
    else if (roll < 0.82) put(PropKind.Antenna, faceAt(face, r.jitter(halfW * 0.5), roofY + 4), face, r.range(0.7, 1.5), style.palette.metal, false);
    else if (roll < 0.88) put(PropKind.Dish, faceAt(face, r.jitter(halfW * 0.5), roofY + 1.4), face, r.range(0.8, 1.4), style.palette.trim, false);
    else if (roll < 0.93 && r.next() < 0.5) put(PropKind.Crane, faceAt(face, r.jitter(halfW * 0.3), roofY + 6), face, r.range(0.8, 1.4), style.accentColor, false);
    else if (roll < 0.98) put(PropKind.Stair, faceAt(face, halfW * 0.6, roofY - 1.6), face, r.range(0.9, 1.5), style.palette.metal, false);
  }
}

function placeBridges(
  buildings: BuildingInstance[], index: BoxIndex,
  seed: number, detail: number, out: Skybridge[],
): void {
  const near: number[] = [];
  for (let i = 0; i < buildings.length; i++) {
    const a = buildings[i];
    near.length = 0;
    index.query(
      a.aabbMin[0] - 82, a.aabbMin[2] - 82, a.aabbMax[0] + 82, a.aabbMax[2] + 82, near,
    );
    let placed = 0;
    for (const j of near) {
      if (j === i || placed >= 1) continue;
      const b = buildings[j];
      const gap = Math.max(
        b.aabbMin[0] - a.aabbMax[0], a.aabbMin[0] - b.aabbMax[0],
        b.aabbMin[2] - a.aabbMax[2], a.aabbMin[2] - b.aabbMax[2],
      );
      if (gap < 12 || gap > 62) continue;
      const yLo = Math.max(a.aabbMin[1], b.aabbMin[1]) + 9;
      const yHi = Math.min(a.aabbMax[1], b.aabbMax[1]) - 5;
      if (yHi - yLo < 7) continue;
      const key = Math.min(i, j) * 7919 + Math.max(i, j) * 104729;
      if (lotHash(key, seed, 91) / 4294967296 > 0.11 * detail) continue;
      const y = yLo + (lotHash(key, seed, 92) / 4294967296) * (yHi - yLo);
      const snapped = GROUND_Y + Math.round((y - GROUND_Y) / 3.6) * 3.6;
      const style = DISTRICT_STYLES[a.districtId];
      const mixT = 0.35 * (lotHash(key, seed, 93) / 4294967296);
      out.push({
        a: [a.position[0], snapped, a.position[2]],
        b: [b.position[0], snapped, b.position[2]],
        width: 2.3 + (lotHash(key, seed, 94) / 4294967296) * 2.2,
        color: [
          style.palette.metal[0] * (1 - mixT) + style.palette.trim[0] * mixT,
          style.palette.metal[1] * (1 - mixT) + style.palette.trim[1] * mixT,
          style.palette.metal[2] * (1 - mixT) + style.palette.trim[2] * mixT,
        ],
        districtId: a.districtId,
      });
      placed++;
    }
  }
}

/** Distance from an interior point to the AABB boundary along a unit direction. */
const exitDistance = (b: BuildingInstance, o: Vec3, d: Vec3): number => {
  let t = Infinity;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) continue;
    t = Math.min(t, d[a] > 0 ? (b.aabbMax[a] - o[a]) / d[a] : (b.aabbMin[a] - o[a]) / d[a]);
  }
  return Number.isFinite(t) ? Math.max(0, t) : 0;
};

function placeCables(
  buildings: BuildingInstance[], index: BoxIndex, plan: CityPlan, seed: number,
  detail: number, out: Cable[],
): void {
  const dir: Vec3 = [0, 0, 0];
  for (let i = 0; i < buildings.length; i++) {
    const a = buildings[i];
    const style = DISTRICT_STYLES[a.districtId];
    const r = lotRng(i, seed, 41);
    const h = a.aabbMax[1] - a.aabbMin[1];
    const attempts = Math.round(5 * style.cableDensity * detail);
    for (let k = 0; k < attempts; k++) {
      const y = a.aabbMin[1] + 6 + r.next() * Math.max(4, h - 10);
      const ang = r.int(0, 11) * (Math.PI / 6) + r.jitter(0.22);
      dir[0] = Math.cos(ang); dir[1] = 0; dir[2] = Math.sin(ang);
      const o: Vec3 = [a.position[0], y, a.position[2]];
      const near: number[] = [];
      const qx0 = Math.min(o[0], o[0] + dir[0] * 96), qx1 = Math.max(o[0], o[0] + dir[0] * 96);
      const qz0 = Math.min(o[2], o[2] + dir[2] * 96), qz1 = Math.max(o[2], o[2] + dir[2] * 96);
      index.query(qx0, qz0, qx1, qz1, near);
      let bestJ = -1, bestT = Infinity;
      for (const j of near) {
        if (j === i) continue;
        const b = buildings[j];
        if (b.aabbMin[1] > y || b.aabbMax[1] < y) continue;
        const t = rayBox(o, dir, b.aabbMin, b.aabbMax, 96);
        if (t > 1.5 && t < bestT) { bestT = t; bestJ = j; }
      }
      if (bestJ < 0) continue;
      const t = bestT;
      const anchor: Vec3 = [o[0] + dir[0] * t, y, o[2] + dir[2] * t];
      // Start on this building's facade rather than its centre.
      const tOut = exitDistance(a, o, dir);
      const from: Vec3 = [o[0] + dir[0] * tOut, y, o[2] + dir[2] * tOut];
      const span = dist2d(from[0], from[2], anchor[0], anchor[2]);
      if (span < 3) continue;
      const s = sampleStreetPlan(plan, (from[0] + anchor[0]) * 0.5, (from[2] + anchor[2]) * 0.5, scratchSample);
      const along = Math.abs(s.tx * dir[0] + s.tz * dir[2]);
      let kind: Cable['kind'] = 'power';
      let radius = r.range(0.045, 0.13);
      if (span < 12) { kind = 'anchor'; radius = r.range(0.06, 0.1); }
      else if (along > 0.82 && y < 17) { kind = 'tram'; radius = r.range(0.07, 0.11); }
      else if (span > 46 && y > 24 && r.next() < 0.12) { kind = 'zipline'; radius = 0.05; }
      out.push({
        a: from, b: anchor,
        sag: span * r.range(0.035, 0.085),
        radius, kind,
      });
    }
  }
}

function buildChunk(plan: CityPlan, cfg: CityConfig, cx: number, cz: number): CityChunk {
  const size = cfg.chunkSize;
  const ox = cx * size, oz = cz * size;
  const pitch = clamp(size * Math.sqrt(LOT_SURVIVAL / Math.max(4, cfg.buildingsPerChunk)), 10, 46);
  const i0 = Math.ceil(ox / pitch), i1 = Math.floor((ox + size) / pitch);
  const j0 = Math.ceil(oz / pitch), j1 = Math.floor((oz + size) / pitch);

  const candidates: BuildingInstance[] = [];
  for (let iz = j0; iz <= j1; iz++) {
    for (let ix = i0; ix <= i1; ix++) {
      const lr = lotRng(ix, iz, 5);
      const wx = (ix + 0.5) * pitch + lr.jitter(pitch * 0.19);
      const wz = (iz + 0.5) * pitch + lr.jitter(pitch * 0.19);
      if (wx < ox || wx >= ox + size || wz < oz || wz >= oz + size) continue;
      const b = makeBuilding(plan, cfg, ix, iz, wx, wz, pitch);
      if (b) candidates.push(b);
    }
  }

  // Greedy de-overlap, biggest footprint first. A mega-structure swallows the
  // lots around it instead of interpenetrating them, which is what gives the
  // megastructure districts their characteristic cleared plazas.
  const order = candidates.map((_, i) => i).sort((a, b) => {
    const ab = candidates[a].halfExtents[0] * candidates[a].halfExtents[2];
    const bb = candidates[b].halfExtents[0] * candidates[b].halfExtents[2];
    return bb - ab || a - b;
  });
  const occ = new Occupancy(ox - 64, oz - 64, 48);
  const buildings: BuildingInstance[] = [];
  const box: [Vec3, Vec3] = [[0, 0, 0], [0, 0, 0]];
  for (const i of order) {
    const b = candidates[i];
    const fp = footprintAabb(b);
    box[0][0] = fp[0][0]; box[0][2] = fp[0][2];
    box[1][0] = fp[1][0]; box[1][2] = fp[1][2];
    if (occ.overlaps(box[0], box[1], 1.4)) continue;
    occ.add(b);
    buildings.push(b);
  }
  buildings.sort((p, q) => p.position[0] - q.position[0] || p.position[2] - q.position[2]);

  const index = new BoxIndex(buildings, ox, oz, 44);
  const bridges: Skybridge[] = [];
  placeBridges(buildings, index, cfg.seed, cfg.detail, bridges);

  const cables: Cable[] = [];
  placeCables(buildings, index, plan, cfg.seed, cfg.detail, cables);

  const props: PropInstance[] = [];
  const allowance = buildings.length > 0
    ? clamp(Math.floor(cfg.propsPerChunk / buildings.length), 3, 46)
    : 0;
  for (let i = 0; i < buildings.length && props.length < cfg.propsPerChunk; i++) {
    const b = buildings[i];
    placeProps(cfg, b, DISTRICT_STYLES[b.districtId], allowance, lotRng(i, cfg.seed, 77), props);
  }
  if (props.length > cfg.propsPerChunk) props.length = cfg.propsPerChunk;

  const cells = DISTRICT_CELL;
  const districtByCell = new Int8Array(cells * cells);
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      const wx = ox + ((ci + 0.5) / cells) * size;
      const wz = oz + ((cj + 0.5) / cells) * size;
      districtByCell[cj * cells + ci] = districtAtField(plan.districts, wx, wz);
    }
  }

  let maxY = GROUND_Y;
  for (const b of buildings) if (b.aabbMax[1] > maxY) maxY = b.aabbMax[1];

  return {
    cx, cz, buildings, props, bridges, cables,
    boundsMin: [ox, GROUND_Y - 1, oz],
    boundsMax: [ox + size, maxY, oz + size],
    districtByCell,
  };
}

// ---------------------------------------------------------------- City

/** Streaming city: chunk cache with LRU eviction, bounded by `radiusChunks`. */
export class City {
  readonly cfg: CityConfig;
  readonly plan: CityPlan;
  private readonly cache = new Map<number, CityChunk>();
  private readonly cap: number;
  private buildings = 0;
  private props = 0;
  private built = 0;

  constructor(cfg: CityConfig) {
    this.cfg = cfg;
    this.plan = cityPlan(cfg.seed);
    this.cap = (2 * cfg.radiusChunks + 1) * (2 * cfg.radiusChunks + 1) + 8;
  }

  /** Buildings resident in the chunk cache. */
  get totalBuildings(): number { return this.buildings; }
  /** Props resident in the chunk cache. */
  get totalProps(): number { return this.props; }
  /** Chunks ever built, including evicted ones. */
  get chunksBuilt(): number { return this.built; }
  get residentChunks(): number { return this.cache.size; }

  getChunk(cx: number, cz: number): CityChunk | null {
    if (cx < -this.cfg.radiusChunks || cx > this.cfg.radiusChunks) return null;
    if (cz < -this.cfg.radiusChunks || cz > this.cfg.radiusChunks) return null;
    const key = (cx + 4096) * 8192 + (cz + 4096);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const chunk = buildChunk(this.plan, this.cfg, cx, cz);
    this.built++;
    this.buildings += chunk.buildings.length;
    this.props += chunk.props.length;
    this.cache.set(key, chunk);
    if (this.cache.size > this.cap) {
      const oldest = this.cache.keys().next().value as number | undefined;
      if (oldest !== undefined) {
        const dead = this.cache.get(oldest);
        if (dead) {
          this.buildings -= dead.buildings.length;
          this.props -= dead.props.length;
        }
        this.cache.delete(oldest);
      }
    }
    return chunk;
  }

  /** Every chunk whose bounds meet the disc of radius `r` around `viewCenter`. */
  chunksInRadius(viewCenter: Vec3, r: number): CityChunk[] {
    const size = this.cfg.chunkSize;
    const out: CityChunk[] = [];
    const c0x = Math.floor((viewCenter[0] - r) / size), c1x = Math.floor((viewCenter[0] + r) / size);
    const c0z = Math.floor((viewCenter[2] - r) / size), c1z = Math.floor((viewCenter[2] + r) / size);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = this.getChunk(cx, cz);
        if (c && discHitsChunk(viewCenter, r, c, size)) out.push(c);
      }
    }
    return out;
  }

  /** Every chunk whose bounds meet the sphere of radius `r` around `p`. */
  queryNear(p: Vec3, r: number): CityChunk[] {
    return this.chunksInRadius(p, r);
  }
}

const discHitsChunk = (c0: Vec3, r: number, c: CityChunk, size: number): boolean => {
  const x = Math.max(c.boundsMin[0], Math.min(c0[0], c.boundsMax[0]));
  const z = Math.max(c.boundsMin[2], Math.min(c0[2], c.boundsMax[2]));
  void size;
  return Math.hypot(x - c0[0], z - c0[2]) <= r;
};
