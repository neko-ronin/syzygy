/**
 * Transport and pedestrian networks, all derived from the City. Rail lines are
 * grown by *flowing* along the street field (project, look ahead, steer) rather
 * than by a hand-authored track layout, so they follow the canyon wherever the
 * city decided its streets go. Ziplines and skybridge links are then hung off
 * the buildings the generator already produced.
 */

import { catmull, makeRng, type Rng, type Vec3 } from '../core/math';
import {
  GROUND_Y, cityPlan, sampleStreetPlan,
  type BuildingInstance, type City, type CityPlan, type StreetSample,
} from './citygen';
import { DISTRICT_STYLES, districtAt, districtPaletteLinear, type DistrictStyle } from './districts';

export interface RailLine {
  id: number;
  kind: 'tram' | 'cablecar' | 'funicular' | 'zipline';
  points: Vec3[];
  closed: boolean;
  /** Metres per second. */
  speed: number;
  color: Vec3;
  districtId: number;
  suspension: 'ground' | 'catenary' | 'free';
}

export interface Zipline {
  a: Vec3;
  b: Vec3;
  sag: number;
  width: number;
  color: Vec3;
}

export interface NavNode {
  position: Vec3;
  links: number[];
  kind: 'street' | 'bridge' | 'platform' | 'stair' | 'rooftop';
  districtId: number;
}

export interface NavConfig {
  seed?: number;
  center?: Vec3;
  /** Half-extent of the initial node region, metres. */
  radius?: number;
  /** Street node spacing, metres. */
  spacing?: number;
  /** Add rooftop + stair nodes. */
  rooftops?: boolean;
  /** Rail lines contribute platform nodes. */
  rail?: RailLine[];
}

// ---------------------------------------------------------------- splines

const dist3 = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Uniform Catmull-Rom resample of a polyline, arc-length parameterised. */
export function resampleSpline(pts: Vec3[], n: number): Vec3[] {
  if (pts.length === 0) return [];
  if (pts.length === 1 || n < 2) return Array.from({ length: Math.max(1, n) }, () => [...pts[0]] as Vec3);
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist3(pts[i], pts[i - 1]));
  const total = cum[cum.length - 1] || 1;
  const out: Vec3[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const s = (k / (n - 1)) * total;
    while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
    const t = (s - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
    const p0 = pts[Math.max(0, seg - 1)];
    const p1 = pts[seg];
    const p2 = pts[Math.min(pts.length - 1, seg + 1)];
    const p3 = pts[Math.min(pts.length - 1, seg + 2)];
    out.push([
      catmull(p0[0], p1[0], p2[0], p3[0], t),
      catmull(p0[1], p1[1], p2[1], p3[1], t),
      catmull(p0[2], p1[2], p2[2], p3[2], t),
    ]);
  }
  return out;
}

/** Parabolic-droop sample of a span, used for cable spans. */
const spanCurve = (a: Vec3, b: Vec3, sag: number, n: number): Vec3[] => {
  const out: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const bow = 4 * sag * t * (1 - t);
    out.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t - bow,
      a[2] + (b[2] - a[2]) * t,
    ]);
  }
  return out;
};

// ---------------------------------------------------------------- street flow

const walkSample: StreetSample = {
  dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
};
const lookSample: StreetSample = { ...walkSample };

/**
 * Walks the street field from a start point, snapping to the nearest
 * carriageway at each step and steering toward a look-ahead projection.
 */
function walkStreet(
  plan: CityPlan, sx: number, sz: number, steps: number, stepLen: number,
): Vec3[] {
  const out: Vec3[] = [];
  let x = sx, z = sz;
  for (let i = 0; i < steps; i++) {
    const s = sampleStreetPlan(plan, x, z, walkSample);
    let dx = s.tx, dz = s.tz;
    const look = stepLen * 1.7;
    sampleStreetPlan(plan, s.px + s.tx * look, s.pz + s.tz * look, lookSample);
    const lx = lookSample.px - s.px, lz = lookSample.pz - s.pz;
    const ll = Math.hypot(lx, lz);
    if (ll > 0.75) {
      dx = s.tx * 0.3 + (lx / ll) * 0.7;
      dz = s.tz * 0.3 + (lz / ll) * 0.7;
    }
    const dl = Math.hypot(dx, dz) || 1;
    out.push([s.px, GROUND_Y, s.pz]);
    x = s.px + (dx / dl) * stepLen;
    z = s.pz + (dz / dl) * stepLen;
  }
  return out;
}

const rampProfile = (t: number, hump: number): number => {
  const climb = Math.min(1, Math.max(0, (t - 0.04) / 0.4));
  const drop = Math.min(1, Math.max(0, (t - 0.74) / 0.24));
  const s = (v: number): number => v * v * (3 - 2 * v);
  return hump * s(climb) * (1 - s(drop));
};

const gatherTowers = (
  city: City, center: Vec3, radius: number, minHeight: number, cap: number,
): BuildingInstance[] => {
  const out: BuildingInstance[] = [];
  for (const c of city.chunksInRadius(center, radius)) {
    for (const b of c.buildings) {
      if (b.aabbMax[1] < minHeight) continue;
      out.push(b);
      if (out.length >= cap) return out;
    }
  }
  return out;
};

const styleColor = (style: DistrictStyle, k: number): Vec3 => {
  const p = districtPaletteLinear(style);
  return [
    p.metal[0] * (1 - k) + p.trim[0] * k,
    p.metal[1] * (1 - k) + p.trim[1] * k,
    p.metal[2] * (1 - k) + p.trim[2] * k,
  ];
};

/** Grows the transport network: street trams, an aerial cable car, funiculars. */
export function buildRailLines(city: City, seed: number): RailLine[] {
  const plan = city.plan;
  const r = makeRng((seed ^ 0x2b1c9f43) >>> 0);
  const lines: RailLine[] = [];
  let id = 0;

  // Two trams threading the canyon: street level at the ends, viaduct mid-run.
  for (let i = 0; i < 2; i++) {
    const a = r.range(0, Math.PI * 2);
    const rad = r.range(140, 900);
    const raw = walkStreet(plan, Math.cos(a) * rad, Math.sin(a) * rad, 16, 34);
    if (raw.length < 6) continue;
    const pts = resampleSpline(raw, 96);
    const hump = 8 + r.next() * 9;
    for (let k = 0; k < pts.length; k++) {
      pts[k][1] += 0.28 + rampProfile(k / (pts.length - 1), hump);
    }
    const mid = pts[pts.length >> 1];
    const d = districtAt(mid[0], mid[2], seed);
    let crest = 0;
    for (const p of pts) if (p[1] > crest) crest = p[1];
    lines.push({
      id: id++, kind: 'tram', points: pts, closed: false,
      speed: 10.5 + r.next() * 2.5, color: styleColor(DISTRICT_STYLES[d], 0.55),
      districtId: d, suspension: crest - GROUND_Y > 4 ? 'catenary' : 'ground',
    });
  }

  // The heavy aerial cable car, crossing high above everything.
  const towers = gatherTowers(city, [0, 0, 0], 1200, 140, 240);
  if (towers.length >= 2) {
    for (let i = 0; i < 2; i++) {
      const a = towers[r.int(0, towers.length - 1)];
      let best: BuildingInstance | null = null;
      let bestSpan = Infinity;
      for (let k = 0; k < 26; k++) {
        const b = towers[r.int(0, towers.length - 1)];
        if (b === a) continue;
        const span = Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2]);
        if (span > 320 && span < 900 && span < bestSpan) { bestSpan = span; best = b; }
      }
      if (!best) continue;
      const pa: Vec3 = [a.position[0], a.aabbMax[1] + 9, a.position[2]];
      const pb: Vec3 = [best.position[0], best.aabbMax[1] + 9, best.position[2]];
      const d = districtAt(pa[0], pa[2], seed);
      lines.push({
        id: id++, kind: 'cablecar',
        points: resampleSpline(spanCurve(pa, pb, bestSpan * 0.09, 10), 40),
        closed: false, speed: 22, color: styleColor(DISTRICT_STYLES[d], 0.8),
        districtId: d, suspension: 'free',
      });
    }
  }

  // Funiculars: street level up to a rooftop platform, steep but short.
  for (let i = 0; i < 3; i++) {
    if (towers.length === 0) break;
    const top = towers[r.int(0, towers.length - 1)];
    // Project the tower onto the nearest carriageway to get a valid base.
    sampleStreetPlan(plan, top.position[0], top.position[2], walkSample);
    const base: Vec3 = [walkSample.px, GROUND_Y + 0.2, walkSample.pz];
    const apex: Vec3 = [top.position[0], top.aabbMax[1] + 1.2, top.position[2]];
    const d = districtAt(base[0], base[2], seed);
    lines.push({
      id: id++, kind: 'funicular',
      points: resampleSpline([base, [
        (base[0] + apex[0]) * 0.5 + 5, base[1] + (apex[1] - base[1]) * 0.44, (base[2] + apex[2]) * 0.5 - 4,
      ], apex], 48),
      closed: false, speed: 5.5, color: styleColor(DISTRICT_STYLES[d], 0.3),
      districtId: d, suspension: 'ground',
    });
  }
  return lines;
}

/** Long sagging spans between rooftops, for pedestrians who do not use stairs. */
export function buildZiplines(city: City, seed: number): Zipline[] {
  const r = makeRng((seed ^ 0x71a5c33d) >>> 0);
  const towers = gatherTowers(city, [0, 0, 0], 1200, 55, 420);
  const out: Zipline[] = [];
  for (const a of towers) {
    if (out.length >= 64) break;
    for (let k = 0; k < 2; k++) {
      const ang = r.range(0, Math.PI * 2);
      const dir: Vec3 = [Math.cos(ang), 0, Math.sin(ang)];
      const y = a.aabbMax[1] - 1.6;
      const o: Vec3 = [a.position[0], y, a.position[2]];
      let best: BuildingInstance | null = null;
      let bestT = Infinity;
      for (const b of towers) {
        if (b === a) continue;
        const t = rayBoxT(o, dir, b.aabbMin, b.aabbMax, 170);
        if (t > 45 && t < bestT) { bestT = t; best = b; }
      }
      if (!best) continue;
      const span = bestT;
      if (span > 165) continue;
      const p: Vec3 = [o[0] + dir[0] * span, o[1], o[2] + dir[2] * span];
      const d = districtAt(p[0], p[2], seed);
      const pal = districtPaletteLinear(DISTRICT_STYLES[d]);
      out.push({
        a: [o[0] + dir[0] * 3, o[1], o[2] + dir[2] * 3],
        b: p,
        sag: span * r.range(0.035, 0.07),
        width: 0.7 + r.next() * 0.5,
        color: [
          DISTRICT_STYLES[d].accentColor[0],
          pal.foliage[1],
          pal.emissive[2],
        ],
      });
    }
  }
  return out;
}

const rayBoxT = (o: Vec3, d: Vec3, mn: Vec3, mx: Vec3, maxT: number): number => {
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

// ---------------------------------------------------------------- nav graph

interface NavSettings {
  seed: number;
  center: Vec3;
  radius: number;
  spacing: number;
  rooftops: boolean;
  rail: RailLine[];
}

const nodeKey = (p: Vec3): number => {
  const qx = Math.round(p[0] / 4) + 2048;
  const qy = Math.round(p[1] / 8) + 2048;
  const qz = Math.round(p[2] / 4) + 2048;
  return qx * 4194304 + qy * 8192 + qz;
};

const nodeGridCell = 32;

/** A* over the pedestrian network: streets, bridges, stairs, platforms, roofs. */
export class NavGraph {
  readonly nodes: NavNode[] = [];
  private readonly city: City;
  private readonly s: NavSettings;
  private readonly keys = new Map<number, number>();
  private readonly buckets = new Map<number, number[]>();
  private gScore = new Float32Array(0);
  private came = new Int32Array(0);
  private stamp = new Int32Array(0);
  private closed = new Uint8Array(0);
  private heapNode = new Int32Array(0);
  private heapKey = new Float32Array(0);
  private heapLen = 0;
  private gen = 0;
  private rng: Rng;
  private covered: { minX: number; minZ: number; maxX: number; maxZ: number } = {
    minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity,
  };

  constructor(city: City, cfg: NavConfig = {}) {
    this.city = city;
    this.s = {
      seed: cfg.seed ?? city.cfg.seed,
      center: cfg.center ?? [0, 0, 0],
      radius: cfg.radius ?? 760,
      spacing: cfg.spacing ?? 26,
      rooftops: cfg.rooftops ?? true,
      rail: cfg.rail ?? [],
    };
    this.rng = makeRng((this.s.seed ^ 0x5cd1a93b) >>> 0);
    this.ensureRegion(this.s.center, this.s.radius);
  }

  /** Grows the graph to cover a disc, skipping area already built. */
  ensureRegion(center: Vec3, r: number): void {
    const minX = center[0] - r, maxX = center[0] + r;
    const minZ = center[2] - r, maxZ = center[2] + r;
    if (minX >= this.covered.minX && maxX <= this.covered.maxX &&
        minZ >= this.covered.minZ && maxZ <= this.covered.maxZ) return;

    this.addStreetNodes(minX, minZ, maxX, maxZ);
    if (this.s.rooftops) this.addVerticalNodes(minX, minZ, maxX, maxZ);
    this.addPlatformNodes();
    this.linkStreetNeighbours();
    this.covered = {
      minX: Math.min(this.covered.minX, minX), minZ: Math.min(this.covered.minZ, minZ),
      maxX: Math.max(this.covered.maxX, maxX), maxZ: Math.max(this.covered.maxZ, maxZ),
    };
  }

  private addNode(p: Vec3, kind: NavNode['kind']): number {
    const k = nodeKey(p);
    const existing = this.keys.get(k);
    if (existing !== undefined) return existing;
    const id = this.nodes.length;
    this.nodes.push({ position: p, links: [], kind, districtId: districtAt(p[0], p[2], this.s.seed) });
    this.keys.set(k, id);
    const cell = (Math.floor(p[0] / nodeGridCell) + 4096) * 8192 + (Math.floor(p[2] / nodeGridCell) + 4096);
    const bucket = this.buckets.get(cell);
    if (bucket) bucket.push(id);
    else this.buckets.set(cell, [id]);
    return id;
  }

  private link(a: number, b: number): void {
    if (a === b) return;
    const la = this.nodes[a].links, lb = this.nodes[b].links;
    if (la.indexOf(b) === -1) la.push(b);
    if (lb.indexOf(a) === -1) lb.push(a);
  }

  private addStreetNodes(minX: number, minZ: number, maxX: number, maxZ: number): void {
    const plan = cityPlan(this.s.seed);
    const sp = this.s.spacing;
    for (let z = minZ; z <= maxZ; z += sp) {
      for (let x = minX; x <= maxX; x += sp) {
        const s = sampleStreetPlan(plan, x, z, walkSample);
        if (s.clearance > s.width * 0.24) continue;
        this.addNode([s.px, GROUND_Y + 0.55, s.pz], 'street');
      }
    }
  }

  private addVerticalNodes(minX: number, minZ: number, maxX: number, maxZ: number): void {
    for (const c of this.city.chunksInRadius([(minX + maxX) / 2, 0, (minZ + maxZ) / 2], (maxX - minX) / 2)) {
      for (const b of c.buildings) {
        if (b.aabbMax[1] < 18) continue;
        if (b.position[0] < minX || b.position[0] > maxX) continue;
        if (b.position[2] < minZ || b.position[2] > maxZ) continue;
        const stair = this.addNode([b.position[0], GROUND_Y + 0.55, b.position[2]], 'stair');
        const roof = this.addNode([b.position[0], b.aabbMax[1] + 0.6, b.position[2]], 'rooftop');
        this.link(stair, roof);
      }
      for (const br of c.bridges) {
        const a = this.addNode([br.a[0], br.a[1] + 0.4, br.a[2]], 'bridge');
        const b = this.addNode([br.b[0], br.b[1] + 0.4, br.b[2]], 'bridge');
        this.link(a, b);
      }
    }
  }

  private addPlatformNodes(): void {
    for (const line of this.s.rail) {
      const stride = Math.max(2, Math.round(70 / Math.max(6, lineSpeed(line))));
      for (let i = 0; i < line.points.length; i += stride) {
        const p = line.points[i];
        this.addNode([p[0], p[1] + 0.6, p[2]], 'platform');
      }
    }
  }

  private linkStreetNeighbours(): void {
    const plan = cityPlan(this.s.seed);
    const reach = this.s.spacing * 2.0;
    const mid: StreetSample = { ...walkSample };
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.kind !== 'street') continue;
      const gx = Math.floor(n.position[0] / nodeGridCell), gz = Math.floor(n.position[2] / nodeGridCell);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const bucket = this.buckets.get((gx + dx + 4096) * 8192 + (gz + dz + 4096));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i || this.nodes[j].kind !== 'street') continue;
            const q = this.nodes[j].position;
            if (Math.abs(q[0] - n.position[0]) > reach || Math.abs(q[2] - n.position[2]) > reach) continue;
            if (Math.hypot(q[0] - n.position[0], q[2] - n.position[2]) > reach) continue;
            // The link must stay on the carriageway: no shortcuts through blocks.
            sampleStreetPlan(plan, (n.position[0] + q[0]) * 0.5, (n.position[2] + q[2]) * 0.5, mid);
            if (mid.clearance > mid.width * 0.3) continue;
            this.link(i, j);
          }
        }
      }
    }
    this.connectElevated();
  }

  /** Rooftops reach a skybridge if one is close; stairs always reach the street. */
  private connectElevated(): void {
    const fallbackStreet = (i: number, reach: number): void => {
      const n = this.nodes[i];
      let best = -1, bestD = Infinity;
      const gx = Math.floor(n.position[0] / nodeGridCell), gz = Math.floor(n.position[2] / nodeGridCell);
      const span = Math.ceil(reach / nodeGridCell);
      for (let dz = -span; dz <= span; dz++) {
        for (let dx = -span; dx <= span; dx++) {
          const bucket = this.buckets.get((gx + dx + 4096) * 8192 + (gz + dz + 4096));
          if (!bucket) continue;
          for (const j of bucket) {
            if (this.nodes[j].kind !== 'street') continue;
            const d = Math.hypot(n.position[0] - this.nodes[j].position[0], n.position[2] - this.nodes[j].position[2]);
            if (d < bestD) { bestD = d; best = j; }
          }
        }
      }
      if (best >= 0 && bestD < reach) this.link(i, best);
    };

    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      if (n.kind === 'rooftop') {
        let best = -1, bestD = 30;
        const gx = Math.floor(n.position[0] / nodeGridCell), gz = Math.floor(n.position[2] / nodeGridCell);
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const bucket = this.buckets.get((gx + dx + 4096) * 8192 + (gz + dz + 4096));
            if (!bucket) continue;
            for (const j of bucket) {
              if (this.nodes[j].kind !== 'bridge') continue;
              const d = hypot3d(n.position, this.nodes[j].position);
              if (d < bestD) { bestD = d; best = j; }
            }
          }
        }
        if (best >= 0) this.link(i, best);
      } else if (n.kind === 'stair') {
        fallbackStreet(i, 130);
      } else if (n.kind === 'platform') {
        fallbackStreet(i, 45);
      }
    }
  }

  nodesNear(p: Vec3, r: number): number[] {
    const out: number[] = [];
    const r2 = r * r;
    const span = Math.ceil(r / nodeGridCell);
    const gx = Math.floor(p[0] / nodeGridCell), gz = Math.floor(p[2] / nodeGridCell);
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const bucket = this.buckets.get((gx + dx + 4096) * 8192 + (gz + dz + 4096));
        if (!bucket) continue;
        for (const j of bucket) {
          const q = this.nodes[j].position;
          const ddx = q[0] - p[0], ddy = q[1] - p[1], ddz = q[2] - p[2];
          if (ddx * ddx + ddy * ddy + ddz * ddz <= r2) out.push(j);
        }
      }
    }
    return out;
  }

  nearestNode(p: Vec3): number {
    let best = -1, bestD = Infinity;
    const gx = Math.floor(p[0] / nodeGridCell), gz = Math.floor(p[2] / nodeGridCell);
    for (let ring = 0; ring <= 8; ring++) {
      for (let dz = -ring; dz <= ring; dz++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dz) !== ring) continue;
          const bucket = this.buckets.get((gx + dx + 4096) * 8192 + (gz + dz + 4096));
          if (!bucket) continue;
          for (const j of bucket) {
            const d = dist3(p, this.nodes[j].position);
            if (d < bestD) { bestD = d; best = j; }
          }
        }
      }
      if (best >= 0) return best;
    }
    return best;
  }

  randomNodeNear(p: Vec3, r: number): number {
    const near = this.nodesNear(p, r);
    if (near.length === 0) return -1;
    return near[this.rng.int(0, near.length - 1)];
  }

  /** A* node-index path, endpoints included. Empty when unreachable. */
  path(from: number, to: number): number[] {
    const n = this.nodes.length;
    if (from < 0 || to < 0 || from >= n || to >= n) return [];
    if (from === to) return [from];
    if (this.gScore.length < n) {
      this.gScore = new Float32Array(n);
      this.came = new Int32Array(n);
      this.stamp = new Int32Array(n);
      this.closed = new Uint8Array(n);
      this.heapNode = new Int32Array(n);
      this.heapKey = new Float32Array(n);
    }
    this.gen++;
    const gen = this.gen;
    this.heapLen = 0;
    this.stamp[from] = gen;
    this.gScore[from] = 0;
    this.came[from] = -1;
    this.closed[from] = 0;
    this.heapPush(from, dist3(this.nodes[from].position, this.nodes[to].position));

    let expansions = 0;
    while (this.heapLen > 0) {
      const cur = this.heapPop();
      if (cur === to) {
        const out: number[] = [];
        for (let n2 = to; n2 !== -1; n2 = this.came[n2]) out.push(n2);
        out.reverse();
        return out;
      }
      if (this.closed[cur] === 1 && this.stamp[cur] === gen) continue;
      this.closed[cur] = 1;
      if (++expansions > 40000) return [];
      const here = this.nodes[cur];
      for (const nb of here.links) {
        if (this.stamp[nb] === gen && this.closed[nb] === 1) continue;
        const there = this.nodes[nb];
        const w = dist3(here.position, there.position) *
          (here.kind === 'street' && there.kind === 'street' ? 1 : 1.8);
        const g = this.gScore[cur] + w;
        if (this.stamp[nb] !== gen || g < this.gScore[nb]) {
          this.stamp[nb] = gen;
          this.gScore[nb] = g;
          this.came[nb] = cur;
          this.closed[nb] = 0;
          this.heapPush(nb, g + dist3(there.position, this.nodes[to].position));
        }
      }
    }
    return [];
  }

  private heapPush(node: number, key: number): void {
    let i = this.heapLen++;
    this.heapNode[i] = node;
    this.heapKey[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapKey[p] <= this.heapKey[i]) break;
      this.swapHeap(p, i);
      i = p;
    }
  }

  private heapPop(): number {
    const top = this.heapNode[0];
    this.heapLen--;
    if (this.heapLen > 0) {
      this.heapNode[0] = this.heapNode[this.heapLen];
      this.heapKey[0] = this.heapKey[this.heapLen];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < this.heapLen && this.heapKey[l] < this.heapKey[m]) m = l;
        if (r < this.heapLen && this.heapKey[r] < this.heapKey[m]) m = r;
        if (m === i) break;
        this.swapHeap(m, i);
        i = m;
      }
    }
    return top;
  }

  private swapHeap(a: number, b: number): void {
    const n = this.heapNode[a]; this.heapNode[a] = this.heapNode[b]; this.heapNode[b] = n;
    const k = this.heapKey[a]; this.heapKey[a] = this.heapKey[b]; this.heapKey[b] = k;
  }
}

const hypot3d = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lineSpeed = (l: RailLine): number => Math.max(4, l.speed);
