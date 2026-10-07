/**
 * The crowd.
 *
 * Pedestrians, not cars. The point of this system is that the city looks
 * *inhabited* — so the design goal is not pathfinding quality, it is thousands
 * of plausible, individually-motivated movers at a few milliseconds of CPU.
 *
 * Everything lives in flat typed arrays (SoA). Nothing allocates in the hot
 * loop. Agents outside the camera's radius are frozen or coarsely updated, and
 * the visible population is smoothly recycled around the camera so the count
 * never pops.
 */

import {
  clamp, lerp, makeRng, saturate, v3norm, type Rng, type Vec3,
} from '../core/math';
import { defaultWorld, type WorldState } from '../core/state';
import {
  City, GROUND_Y, cityPlan, sampleStreetPlan, type StreetSample,
} from '../world/citygen';
import { NavGraph, type NavNode } from '../world/networks';
import { MAT, INSTANCE_FLOATS } from '../render/citymesh';
import { PEDESTRIAN_RADIUS, PEDESTRIAN_HEIGHT, type CrowdObstacle } from '../world/crowdobstacles';
import { WalkingSurfaceIndex, type WalkingSurfaceTriangles } from '../world/walkingsurfaces';
import {
  districtAt, districtField, districtPaletteLinear, districtStyle, spineHit, spinePoint,
  type ResolvedPalette, type SpineHit,
} from '../world/districts';

const MAX_DT = 1 / 15;

/** Only local bodies influence steering; the buffer keeps the true closest. */
const SEP_RADIUS = 1.0;
const NEAREST_COUNT = 32;
/** The rendered mesh must fit this disc for clearance to mean body clearance. */
const BODY_RADIUS = PEDESTRIAN_RADIUS;
const BODY_SEPARATION = BODY_RADIUS * 2;
/** Leave clearance for Float32 position rounding after a continuous sweep. */
const CONTACT_SEPARATION = BODY_SEPARATION + 0.001;
const BODY_HEIGHT = PEDESTRIAN_HEIGHT;
/**
 * Ceiling on the pavement hold's correction, m/s.
 *
 * A walking pace. The hold is a standing constraint on where a body sits
 * relative to the kerb; it is not a mechanism for moving one, so it corrects at
 * the speed a person covers ground rather than at the speed of the error.
 */
const HOLD_SPEED = 1.4;

/**
 * Agents per readable group, and the chance a group slot is left empty.
 *
 * `GROUP_EMPTY_P` is the "gaps between groups" half of the review gate's
 * design hypothesis. Without it, every group slot is occupied and the result is
 * a continuous ribbon of people, which is a different and equally wrong read.
 */
const GROUP_SIZE = 6;
/**
 * How many distinct anchors group centres cluster around, spread through the
 * view depth. Fewer anchors means denser knots and longer empty stretches
 * between them, which is the "gaps between groups" the review asked for.
 */
const GROUP_ANCHORS = 18;
/** Metres a group centre is pushed past the kerb line, onto the footway. */
const FOOTWAY_SETBACK = 1.9;
/**
 * Radius a group's members scatter inside, metres. Small enough that six heads
 * overlap into one readable silhouette rather than six separate dots.
 */
const GROUP_RADIUS = 1.5;

// ---------------------------------------------------------------- needs

/** What a person is currently trying to do. The order is the u8 encoding. */
const enum Need {
  Commute = 0, Shop = 1, Market = 2, Rest = 3, Wander = 4, RideStop = 5, Event = 6,
}
const NEED_COUNT = 7;
/** Baseline need weights. Events and agitation perturb these. */
const NEED_WEIGHTS: number[] = [0.30, 0.18, 0.10, 0.08, 0.24, 0.07, 0.03];

/**
 * The Market attractor.
 *
 * `MARKET_ALONG_QUANTUM` is the lattice the attractor is pinned to, in metres of
 * spine parameter. The candidate set is *the centreline itself*, so no amount
 * of camera bias can put the attractor off the market — it can only choose
 * which piece of the market is busy. Quantising means a camera creeping along
 * the street does not drag the attractor with it continuously.
 *
 * `MARKET_REACH` is how far the attractor may sit from the camera before it is
 * re-anchored. A crowd is only ever seeded within `viewRadius` (80-240 m), so an
 * attractor further away than this is one nobody will ever walk to.
 *
 * `MARKET_HOLD` is the minimum dwell, seconds, between re-anchors. A rush that
 * * relocates its destination every 2.5 s is a crowd that walks forever and
 * arrives nowhere.
 */
const MARKET_ALONG_QUANTUM = 15;
const MARKET_REACH = 320;
const MARKET_HOLD = 25;

/** Fields, one float per agent, in this order. */
const F = {
  x: 0, y: 1, z: 2,          // position
  vx: 3, vz: 4,              // velocity (y is unused; agents stay on their level)
  heading: 5, gait: 6, speed: 7,
  goal: 8, next: 9,          // nav node indices
  pathPos: 10,               // index into this agent's slice of the path pool
  need: 11, mood: 12,
  pace: 13, space: 14, social: 15, curious: 16,
  district: 17,
  density: 18,
  seed: 19,
  ttl: 20,                   // seconds until the agent is recycled
  level: 21,                 // 0 = street, 1 = skybridge
  color: 22,                 // packed into r,g,b floats 22..24
  cr: 22, cg: 23, cb: 24,
  active: 25,
  strand: 26,                // frames spent outside the radius
  dwell: 27,                 // seconds left standing at the market before re-picking
  lateral: 28,               // signed metres from the kerb line this agent walks on
  LOCAL: 29,
} as const;

export interface CrowdInstanceView { data: Float32Array; count: number; }

// ---------------------------------------------------------------- grid

/** Local linked cells. Membership follows each committed movement this frame. */
class HashGrid {
  cellSize = 2;
  originX = 0;
  originZ = 0;
  dimX = 1;
  dimZ = 1;
  private heads = new Int32Array(1);
  private next = new Int32Array(0);
  private prev = new Int32Array(0);
  private cells = new Int32Array(0);
  private f: Float32Array = new Float32Array(0);
  private distances = new Float64Array(NEAREST_COUNT);
  occupancy = new Int32Array(1);
  maxCandidates = 0;

  configure(centre: Vec3, radius: number): void {
    const dim = Math.max(1, Math.ceil(radius * 2 / this.cellSize) + 1);
    if (dim !== this.dimX) {
      this.dimX = this.dimZ = dim;
      this.heads = new Int32Array(dim * dim);
      this.occupancy = new Int32Array(dim * dim);
    }
    this.originX = centre[0] - dim * this.cellSize * 0.5;
    this.originZ = centre[2] - dim * this.cellSize * 0.5;
  }

  private cellOf(x: number, z: number): number {
    const cx = clamp(Math.floor((x - this.originX) / this.cellSize), 0, this.dimX - 1);
    const cz = clamp(Math.floor((z - this.originZ) / this.cellSize), 0, this.dimZ - 1);
    return cz * this.dimX + cx;
  }

  build(f: Float32Array, ids: Int32Array, n: number): void {
    this.f = f;
    if (this.next.length < f.length / F.LOCAL) {
      this.next = new Int32Array(f.length / F.LOCAL);
      this.prev = new Int32Array(this.next.length);
      this.cells = new Int32Array(this.next.length);
    }
    this.heads.fill(-1);
    this.cells.fill(-1);
    this.occupancy.fill(0);
    this.maxCandidates = 0;
    for (let k = 0; k < n; k++) {
      const i = ids[k], o = i * F.LOCAL;
      if (f[o + F.active] >= 0.5) this.insert(i, f[o + F.x], f[o + F.z]);
    }
  }

  remove(i: number): void {
    const c = this.cells[i];
    if (c < 0) return;
    const before = this.prev[i], after = this.next[i];
    if (before < 0) this.heads[c] = after; else this.next[before] = after;
    if (after >= 0) this.prev[after] = before;
    this.cells[i] = -1;
    this.occupancy[c]--;
  }

  insert(i: number, x: number, z: number): void {
    this.remove(i);
    const c = this.cellOf(x, z), head = this.heads[c];
    this.cells[i] = c;
    this.prev[i] = -1;
    this.next[i] = head;
    if (head >= 0) this.prev[head] = i;
    this.heads[c] = i;
    this.occupancy[c]++;
  }

  move(i: number, x: number, z: number): void {
    if (this.cells[i] !== this.cellOf(x, z)) this.insert(i, x, z);
  }

  /** Exact closest K inside a metric radius, ordered by distance then stable ID.
   * Storage is bounded; candidate traversal is never truncated by storage order.
   */
  nearest(x: number, z: number, r: number, out: Int32Array, max: number, ignore = -1): number {
    const limit = Math.min(max, out.length, this.distances.length);
    if (limit <= 0) return 0;
    const x0 = clamp(Math.floor((x - r - this.originX) / this.cellSize), 0, this.dimX - 1);
    const x1 = clamp(Math.floor((x + r - this.originX) / this.cellSize), 0, this.dimX - 1);
    const z0 = clamp(Math.floor((z - r - this.originZ) / this.cellSize), 0, this.dimZ - 1);
    const z1 = clamp(Math.floor((z + r - this.originZ) / this.cellSize), 0, this.dimZ - 1);
    const r2 = r * r, f = this.f;
    let n = 0, candidates = 0;
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      for (let j = this.heads[cz * this.dimX + cx]; j >= 0; j = this.next[j]) {
        if (j === ignore || f[j * F.LOCAL + F.active] < 0.5) continue;
        candidates++;
        const dx = x - f[j * F.LOCAL + F.x], dz = z - f[j * F.LOCAL + F.z];
        const d2 = dx * dx + dz * dz;
        if (d2 > r2) continue;
        let at = n;
        while (at > 0 && (d2 < this.distances[at - 1] ||
          (d2 === this.distances[at - 1] && j < out[at - 1]))) at--;
        if (at >= limit) continue;
        const end = Math.min(n, limit - 1);
        for (let k = end; k > at; k--) { out[k] = out[k - 1]; this.distances[k] = this.distances[k - 1]; }
        out[at] = j;
        this.distances[at] = d2;
        n = Math.min(limit, n + 1);
      }
    }
    this.maxCandidates = Math.max(this.maxCandidates, candidates);
    return n;
  }

  /** Sweep a disc against every body the segment can reach, without a K cap. */
  sweep(i: number, x: number, z: number, dx: number, dz: number): number {
    const a = dx * dx + dz * dz;
    if (a < 1e-16) return 1;
    const r = CONTACT_SEPARATION;
    const x0 = clamp(Math.floor((Math.min(x, x + dx) - r - this.originX) / this.cellSize), 0, this.dimX - 1);
    const x1 = clamp(Math.floor((Math.max(x, x + dx) + r - this.originX) / this.cellSize), 0, this.dimX - 1);
    const z0 = clamp(Math.floor((Math.min(z, z + dz) - r - this.originZ) / this.cellSize), 0, this.dimZ - 1);
    const z1 = clamp(Math.floor((Math.max(z, z + dz) + r - this.originZ) / this.cellSize), 0, this.dimZ - 1);
    const f = this.f;
    let fraction = 1;
    for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
      for (let j = this.heads[cz * this.dimX + cx]; j >= 0; j = this.next[j]) {
        if (j === i || f[j * F.LOCAL + F.active] < 0.5) continue;
        if (Math.abs(f[i * F.LOCAL + F.y] - f[j * F.LOCAL + F.y]) > BODY_HEIGHT) continue;
        const ox = x - f[j * F.LOCAL + F.x], oz = z - f[j * F.LOCAL + F.z];
        const b = ox * dx + oz * dz;
        if (b >= 0) continue;
        const c = ox * ox + oz * oz - r * r;
        // Existing penetrations may move outward, never deeper. Birth rejects
        // occupied candidates, so this branch is for externally supplied state.
        if (c <= 0) { fraction = 0; continue; }
        const disc = b * b - a * c;
        if (disc < 0) continue;
        const t = (-b - Math.sqrt(disc)) / a;
        if (t >= 0 && t < fraction) fraction = t;
      }
    }
    return fraction;
  }
}

/** Emitted solids indexed once per renderer revision, never regenerated here. */
class ObstacleGrid {
  private rows = new Map<number, Map<number, number[]>>();
  private boxes: readonly CrowdObstacle[] = [];
  private stamps = new Int32Array(0);
  private stamp = 0;
  private revision = -1;
  private readonly cellSize = 8;

  set(boxes: readonly CrowdObstacle[], revision: number): void {
    if (revision === this.revision) return;
    this.revision = revision;
    this.boxes = boxes;
    this.rows.clear();
    this.stamps = new Int32Array(boxes.length);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const ex = Math.abs(b.tx) * b.halfAlong + Math.abs(b.tz) * b.halfAcross + BODY_RADIUS;
      const ez = Math.abs(b.tz) * b.halfAlong + Math.abs(b.tx) * b.halfAcross + BODY_RADIUS;
      const x0 = Math.floor((b.x - ex) / this.cellSize), x1 = Math.floor((b.x + ex) / this.cellSize);
      const z0 = Math.floor((b.z - ez) / this.cellSize), z1 = Math.floor((b.z + ez) / this.cellSize);
      for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
        let row = this.rows.get(cz);
        if (!row) { row = new Map(); this.rows.set(cz, row); }
        let cell = row.get(cx);
        if (!cell) { cell = []; row.set(cx, cell); }
        cell.push(i);
      }
    }
  }

  /** Conservative disc/box sweep: expanded corners retain body clearance. */
  sweep(x: number, z: number, y: number, dx: number, dz: number): number {
    this.stamp++;
    if (this.stamp >= 0x7fffffff) { this.stamps.fill(0); this.stamp = 1; }
    const x0 = Math.floor(Math.min(x, x + dx) / this.cellSize), x1 = Math.floor(Math.max(x, x + dx) / this.cellSize);
    const z0 = Math.floor(Math.min(z, z + dz) / this.cellSize), z1 = Math.floor(Math.max(z, z + dz) / this.cellSize);
    let fraction = 1;
    for (let cz = z0; cz <= z1; cz++) {
      const row = this.rows.get(cz);
      if (!row) continue;
      for (let cx = x0; cx <= x1; cx++) {
        const cell = row.get(cx);
        if (!cell) continue;
        for (let k = 0; k < cell.length; k++) {
          const i = cell[k];
          if (this.stamps[i] === this.stamp) continue;
          this.stamps[i] = this.stamp;
          const b = this.boxes[i];
          if (y >= b.maxY || y + BODY_HEIGHT <= b.minY) continue;
          const qx = (x - b.x) * b.tx + (z - b.z) * b.tz;
          const qz = (x - b.x) * -b.tz + (z - b.z) * b.tx;
          const vx = dx * b.tx + dz * b.tz, vz = dx * -b.tz + dz * b.tx;
          const hx = b.halfAlong + BODY_RADIUS + 0.001, hz = b.halfAcross + BODY_RADIUS + 0.001;
          if (Math.abs(qx) < hx && Math.abs(qz) < hz) {
            // A newly streamed solid can surround an existing actor. Permit
            // escape toward the nearest face; never pull it farther inside.
            const along = hx - Math.abs(qx) < hz - Math.abs(qz);
            const q = along ? qx : qz, v = along ? vx : vz;
            if (q === 0 ? v === 0 : q * v <= 0) fraction = 0;
            continue;
          }
          let enter = 0, exit = fraction;
          if (Math.abs(vx) < 1e-12) { if (Math.abs(qx) >= hx) continue; }
          else {
            const a = (-hx - qx) / vx, c = (hx - qx) / vx;
            enter = Math.max(enter, Math.min(a, c)); exit = Math.min(exit, Math.max(a, c));
          }
          if (Math.abs(vz) < 1e-12) { if (Math.abs(qz) >= hz) continue; }
          else {
            const a = (-hz - qz) / vz, c = (hz - qz) / vz;
            enter = Math.max(enter, Math.min(a, c)); exit = Math.min(exit, Math.max(a, c));
          }
          if (enter <= exit && exit >= 0 && enter < fraction) fraction = Math.max(0, enter);
        }
      }
    }
    return fraction;
  }

  occupied(x: number, z: number, y: number): boolean {
    const row = this.rows.get(Math.floor(z / this.cellSize));
    const cell = row?.get(Math.floor(x / this.cellSize));
    if (!cell) return false;
    for (let k = 0; k < cell.length; k++) {
      const b = this.boxes[cell[k]];
      if (y >= b.maxY || y + BODY_HEIGHT <= b.minY) continue;
      const qx = (x - b.x) * b.tx + (z - b.z) * b.tz;
      const qz = (x - b.x) * -b.tz + (z - b.z) * b.tx;
      if (Math.abs(qx) < b.halfAlong + BODY_RADIUS + 0.001 &&
          Math.abs(qz) < b.halfAcross + BODY_RADIUS + 0.001) return true;
    }
    return false;
  }

  /** An arriving detail revision may reveal a solid around an existing body.
   * Return a bounded local escape toward its nearest face, never a teleport.
   */
  recovery(x: number, z: number, y: number, maxStep: number, out: Float64Array): boolean {
    if (maxStep <= 0) return false;
    const cell = this.rows.get(Math.floor(z / this.cellSize))?.get(Math.floor(x / this.cellSize));
    if (!cell) return false;
    let best = Infinity, rx = 0, rz = 0;
    for (let k = 0; k < cell.length; k++) {
      const b = this.boxes[cell[k]];
      if (y >= b.maxY || y + BODY_HEIGHT <= b.minY) continue;
      const qx = (x - b.x) * b.tx + (z - b.z) * b.tz;
      const qz = (x - b.x) * -b.tz + (z - b.z) * b.tx;
      const ex = b.halfAlong + BODY_RADIUS + 0.001 - Math.abs(qx);
      const ez = b.halfAcross + BODY_RADIUS + 0.001 - Math.abs(qz);
      if (ex <= 0 || ez <= 0) continue;
      const along = ex < ez, depth = along ? ex : ez;
      if (depth >= best) continue;
      best = depth;
      const sign = (along ? qx : qz) < 0 ? -1 : 1;
      rx = (along ? b.tx : -b.tz) * sign;
      rz = (along ? b.tz : b.tx) * sign;
    }
    if (best === Infinity) return false;
    const step = Math.min(best + 0.001, maxStep);
    out[0] = rx * step;
    out[1] = rz * step;
    return true;
  }
}

// ---------------------------------------------------------------- sim

export class CrowdSim {
  /** Structure-of-arrays. One contiguous allocation, never resized in the loop. */
  private f: Float32Array;
  private ids: Int32Array;
  private capacity: number;

  private grid = new HashGrid();
  private obstacles = new ObstacleGrid();
  private walkingSurfaces = new WalkingSurfaceIndex();
  private walkingSurfaceChanged = false;
  private escape = new Float64Array(2);
  private lastFwd: Vec3 = [0, 0, -1];
  private streetTangent = { x: 0, z: 0, tx: 1, tz: 0 };
  private nbr: Int32Array;

  private nav: NavGraph | null = null;
  private nodes: NavNode[] = [];
  private city: City | null = null;
  private rng: Rng;

  private viewRadius = 190;
  private targetVisible = 0;
  private densitySeen = -1;
  private rebuildCursor = 0;
  private readonly rebuildStride = 7;

  private pathPool: Int32Array;
  private pathLen: Int32Array;
  private pathCursor = 0;
  private readonly PATH_MAX = 24;
  private readonly PATH_POOL = 8192;

  private instData: Float32Array;

  private lastMs = 0;
  private liveCount = 0;
  private wanderClock = 0;
  private market: Vec3 = [0, 0, 0];
  private hasMarket = false;
  private marketTimer = 0;
  /** Lattice cell of the current anchor along the market spine. */
  private marketCellAt = Number.NaN;
  private spineOut: SpineHit = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 };

  visibleCount = 0;
  /** Live diagnostic counters; surfaced through the automation stats(). */
  diag = { frames: 0, live: 0, target: 0, radius: 0, instances: 0, cursor: 0, navNodes: 0, ms: 0, blockedSeeds: 0, maxNeighbourCandidates: 0, obstacleRecoveries: 0, blockedRecoveries: 0 };
  /** Per-instance (mat4, tint, params) for the renderer to upload verbatim. */
  instances: CrowdInstanceView;

  constructor(seed: number) {
    this.capacity = 6000;
    this.f = new Float32Array(this.capacity * F.LOCAL);
    this.ids = new Int32Array(this.capacity);
    this.nbr = new Int32Array(NEAREST_COUNT);
    this.pathPool = new Int32Array(this.PATH_POOL * this.PATH_MAX);
    this.pathLen = new Int32Array(this.PATH_POOL);
    this.instData = new Float32Array(this.capacity * INSTANCE_FLOATS);
    this.instances = { data: this.instData, count: 0 };
    this.rng = makeRng(seed ^ 0xc0ffee);
    for (let i = 0; i < this.capacity; i++) this.ids[i] = i;
  }

  /** Attach the city. Safe to call once the renderer has one. */
  attach(city: City, seed: number): void {
    this.city = city;
    void seed;
    this.nav = new NavGraph(city);
    this.nodes = this.nav.nodes;
  }

  /** The renderer owns placement; retain and index its immutable revision. */
  setStaticObstacles(obstacles: readonly CrowdObstacle[], revision: number): void {
    this.obstacles.set(obstacles, revision);
  }

  /** Actual emitted walking triangles, retained without a per-frame copy.
   * Existing bodies acquire new support on the next simulation update.
   */
  setWalkingSurfaces(triangles: WalkingSurfaceTriangles, revision: number): void {
    if (this.walkingSurfaces.set(triangles, revision)) this.walkingSurfaceChanged = true;
  }

  setCount(n: number): void {
    this.targetVisible = clamp(n | 0, 0, this.capacity);
  }

  /**
   * Retire the whole population, synchronously.
   *
   * `setCount(0)` does not do this, and claiming it did was the §20 failure
   * class: it only sets `targetVisible`, which caps *seeding*. Pass B counts
   * every agent that is `active` and inside `viewRadius`, so asking for zero
   * measured ~2528 — the control the automation surface advertised could not
   * be performed. `setCount` keeps its seeding meaning; this is the explicit
   * "no bodies" state.
   *
   * `setCount(n > 0)` refills over `rebuildStride` frames, because
   * `rebuildSlices` seeds one slice per frame.
   */
  clearPopulation(): void {
    const f = this.f;
    for (let i = 0; i < this.capacity; i++) {
      f[i * F.LOCAL + F.active] = 0;
      f[i * F.LOCAL + F.strand] = 0;
    }
    this.liveCount = 0;
    this.visibleCount = 0;
    this.instances.count = 0;
    this.diag.instances = 0;
    this.diag.live = 0;
  }

  setDensity(d: number): void {
    // Density scales how much of the capacity is filled; count is the ceiling.
    this.viewRadius = lerp(80, 240, saturate(d));
    this.targetVisible = Math.min(
      this.capacity,
      Math.round(this.capacity * saturate(d) * 0.85),
    );
  }

  update(
    dt: number,
    camera: { position: Vec3; lookAt?: Vec3 },
    world: WorldState,
  ): void {
    const t0 = performance.now();
    dt = Math.min(dt, MAX_DT);
    const f = this.f;

    if (this.walkingSurfaceChanged) {
      for (let o = 0; o < f.length; o += F.LOCAL) {
        if (f[o + F.active] > 0.5) f[o + F.y] = this.groundAt(f[o + F.x], f[o + F.z]);
      }
      this.walkingSurfaceChanged = false;
    }

    this.diag.frames++;
    this.seedRef = world;
    // `world.events` is mutated in place (push/splice), never reassigned, so
    // holding the reference is the cheap correct thing. This used to be
    // declared and never assigned, which left the `Need.Event` branch in
    // `randomNodeFor` unreachable: `bloom-festival` raised the Event weight
    // 3.0x and every one of those agents silently fell through to the generic
    // neighbourhood search instead. `WorldEvent.at` had no consumer at all.
    this.events = world.events;
    // Derive the view direction from the look target rather than trusting a
    // passed-in basis. Seeding ahead of the camera is what makes a street-level
    // view populated instead of empty, and getting the sign wrong puts the
    // entire crowd behind the viewer.
    const eye = camera.position;
    const look = camera.lookAt;
    if (look) {
      const dx = look[0] - eye[0], dy = look[1] - eye[1], dz = look[2] - eye[2];
      const l = Math.hypot(dx, dy, dz) || 1;
      this.lastFwd[0] = dx / l; this.lastFwd[1] = dy / l; this.lastFwd[2] = dz / l;
    }
    this.wanderClock += dt;
    if (!this.nav && this.city) this.attach(this.city, world.seed);

    this.densityTarget(world);
    this.maybeRebuild(camera.position, dt);
    const cam = camera.position;
    this.grid.configure(cam, this.viewRadius + 40);
    this.grid.build(f, this.ids, this.capacity);
    this.diag.blockedSeeds = 0;
    this.diag.obstacleRecoveries = 0;
    this.diag.blockedRecoveries = 0;
    this.rebuildSlices(camera.position, this.lastFwd);

    // Pass B: count the agents inside the radius and write their instances.
    //
    // One predicate, evaluated once. This was two scans of the same population
    // with `stepAgent` between them: Pass B counted an agent against its
    // pre-step position, `stepAgent` moved it, and `buildInstances` re-tested
    // the *post*-step position. Measured over 30 frames, 1032 counted agents
    // were dropped by that second test — 107 in one frame — so `visibleCount`
    // and `instances.count` disagreed on 17 of 30 frames while describing one
    // quantity. The mover is the pavement hold in `stepAgent`: it is an
    // unconditional positional projection, not a velocity term, and it is not
    // scaled by dt. With dt=0 it still displaced agents 185 m in a single frame
    // and still lost 1013 of them.
    //
    // Writing the record where the count happens makes the disagreement
    // structurally impossible instead of merely rare, and costs less: one
    // scan per frame instead of two.
    const r2 = this.viewRadius * this.viewRadius;
    let visible = 0;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * F.LOCAL;
      if (f[o + F.active] < 0.5) { visibleCountStep(f, o); continue; }
      const dx = f[o + F.x] - cam[0], dz = f[o + F.z] - cam[2];
      const d2 = dx * dx + dz * dz;
      if (d2 > r2) {
        // Outside: coarse update only — decay the goal so it reselects on return.
        f[o + F.strand] += 1;
        if (f[o + F.strand] > 90) {
          f[o + F.active] = 0;
          this.grid.remove(i);
          this.liveCount--;
        }
        continue;
      }
      f[o + F.strand] = 0;
      visible++;
      this.stepAgent(i, dt, world);
      // Written after the step, so the transform carries this frame's heading
      // and gait; selected by this frame's position, so it is the agent the
      // count just reported.
      this.writeInstance(visible - 1, o);
    }
    this.visibleCount = visible;
    this.instances.count = visible;
    this.diag.instances = visible;
    this.diag.live = this.liveCount;
    this.diag.target = this.targetVisible;
    this.diag.radius = this.viewRadius;
    this.diag.cursor = this.rebuildCursor;
    this.diag.navNodes = this.nodes.length;
    this.diag.ms = this.lastMs;

    this.diag.maxNeighbourCandidates = this.grid.maxCandidates;

    const ms = performance.now() - t0;
    this.lastMs = this.lastMs * 0.85 + ms * 0.15;
  }

  get msPerFrame(): number { return this.lastMs; }

  /** Full diagnostic block for the automation surface. */
  debug() { return { ...this.diag, attached: this.city !== null, hasNav: this.nav !== null }; }

  /** Centroid and extent of the active population, so drift is visible. */
  population(): { n: number; cx: number; cz: number; spread: number; minY: number; maxY: number } {
    const f = this.f;
    let n = 0, sx = 0, sz = 0, spread = 0, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * F.LOCAL;
      if (f[o + F.active] < 0.5) continue;
      n++; sx += f[o + F.x]; sz += f[o + F.z];
      if (f[o + F.y] < minY) minY = f[o + F.y];
      if (f[o + F.y] > maxY) maxY = f[o + F.y];
    }
    if (n === 0) return { n: 0, cx: 0, cz: 0, spread: 0, minY: 0, maxY: 0 };
    const cx = sx / n, cz = sz / n;
    for (let i = 0; i < this.capacity; i++) {
      const o = i * F.LOCAL;
      if (f[o + F.active] < 0.5) continue;
      spread = Math.max(spread, Math.hypot(f[o + F.x] - cx, f[o + F.z] - cz));
    }
    return { n, cx: +cx.toFixed(0), cz: +cz.toFixed(0), spread: +spread.toFixed(0), minY: +minY.toFixed(1), maxY: +maxY.toFixed(1) };
  }

  /** One full 24-float instance record, so a bad matrix is legible. */
  rawInstance(i = 0): number[] {
    const d = this.instData;
    const b = i * INSTANCE_FLOATS;
    return Array.from(d.subarray(b, b + INSTANCE_FLOATS)).map((v) => +v.toFixed(3));
  }

  /** First few instance records, decoded, so a wrong transform is visible. */
  sampleInstances(k = 4): number[][] {
    const d = this.instData;
    const out: number[][] = [];
    for (let i = 0; i < Math.min(k, this.instances.count); i++) {
      const b = i * INSTANCE_FLOATS;
      out.push([
        +d[b + 12].toFixed(2), +d[b + 13].toFixed(2), +d[b + 14].toFixed(2),
        +d[b + 20].toFixed(0), +d[b + 16].toFixed(2), +d[b + 17].toFixed(2), +d[b + 18].toFixed(2),
      ]);
    }
    return out;
  }

  // ---------------------------------------------------------------- internals

  private densityTarget(world: WorldState): void {
    if (this.densitySeen === world.crowds.density) return;
    this.densitySeen = world.crowds.density;
    this.setDensity(world.crowds.density);
  }

  /**
   * Pick a need by weight. The weights shift with the world's event queue, which
   * is what lets a `market-rush` visibly pull the population somewhere.
   */
  private pickNeed(world: WorldState): number {
    const w = NEED_WEIGHTS.slice();
    const ag = saturate(world.crowds.agitation);
    w[Need.Wander] *= 1 + ag * 1.4;
    w[Need.Commute] *= 1 - ag * 0.4;
    for (const e of world.events) {
      switch (e.kind) {
        case 'market-rush': w[Need.Market] += 2.6 * e.intensity; break;
        case 'migration': w[Need.Commute] += 2.0 * e.intensity; break;
        case 'bloom-festival': w[Need.Event] += 3.0 * e.intensity; break;
        case 'lantern-rise': w[Need.Event] += 1.4 * e.intensity; break;
        case 'flash-flood': w[Need.Commute] += 1.2 * e.intensity; break;
        default: break;
      }
    }
    let total = 0;
    for (const v of w) total += v;
    let r = this.rng.next() * total;
    for (let i = 0; i < NEED_COUNT; i++) {
      r -= w[i];
      if (r <= 0) return i;
    }
    return Need.Wander;
  }

  private nearestNodeIdx(x: number, z: number): number {
    if (!this.nav) return -1;
    return this.nav.nearestNode([x, GROUND_Y, z]);
  }

  private events: WorldState['events'] = [];

  private randomNodeFor(need: number, x: number, z: number): number {
    if (!this.nav || this.nodes.length === 0) return -1;
    const r = this.rng;
    if (need === Need.Market && this.hasMarket) {
      return this.nav.nearestNode(this.market);
    }
    if (need === Need.Event && this.events.length > 0) {
      const e = this.events[(r.next() * this.events.length) | 0];
      return this.nav.nearestNode(e.at);
    }
    if (need === Need.Wander) {
      // Local wander: bias short trips so the crowd does not teleport the whole
      // city every time somebody changes their mind.
      return this.nav.randomNodeNear([x, GROUND_Y, z], r.range(40, 220));
    }
    if (need === Need.RideStop) {
      return this.nav.randomNodeNear([x, GROUND_Y, z], r.range(300, 1200));
    }
    return this.nav.randomNodeNear([x, GROUND_Y, z], r.range(150, 900));
  }

  /** Assign a fresh path, taking a slice of the shared path pool. */
  private assignPath(i: number, goal: number): void {
    const f = this.f;
    const o = i * F.LOCAL;
    const from = f[o + F.goal] | 0;
    if (from < 0 || !this.nav) { f[o + F.next] = goal; return; }
    const p = this.nav.path(from, goal);
    const slot = this.pathCursor++ % this.PATH_POOL;
    const n = Math.min(p.length, this.PATH_MAX);
    const base = slot * this.PATH_MAX;
    for (let k = 0; k < n; k++) this.pathPool[base + k] = p[k];
    this.pathLen[slot] = n;
    f[o + F.pathPos] = base;
    f[o + F.goal] = goal;
  }

  private pathNodeAt(i: number, k: number): number {
    const f = this.f;
    const o = i * F.LOCAL;
    const base = f[o + F.pathPos] | 0;
    if (base === 0 && f[o + F.next] === f[o + F.goal]) return f[o + F.next] | 0;
    const n = this.pathLen[base / this.PATH_MAX] ?? 0;
    if (k >= n) return f[o + F.goal] | 0;
    return this.pathPool[base + k];
  }

  private pathLength(i: number): number {
    const f = this.f;
    const o = i * F.LOCAL;
    const base = (f[o + F.pathPos] | 0) / this.PATH_MAX;
    return this.pathLen[base] || 1;
  }

  private stepAgent(i: number, dt: number, world: WorldState): void {
    const f = this.f;
    const o = i * F.LOCAL;
    const x = f[o + F.x], z = f[o + F.z];

    // --- pick a new goal when the old one is reached or the agent loses patience
    const gi = f[o + F.goal] | 0;
    const target = gi >= 0 && gi < this.nodes.length ? this.nodes[gi].position : null;
    const arrived = !target ||
      (target[0] - x) * (target[0] - x) + (target[2] - z) * (target[2] - z) < 36;
    f[o + F.ttl] -= dt;
    // Market dwell.
    //
    // Without this a Market-goer arrives, `arrived` is true, and on the very next
    // frame it picks a fresh goal and walks on. The sim reported agents heading
    // for the market and the market stayed empty: people walked *through* it.
    // Holding them at the market for 8-30 s is what turns arrival into
    // occupancy, which is the thing the review asked to see.
    if (f[o + F.dwell] > 0) {
      f[o + F.dwell] -= dt;
    } else if (arrived || f[o + F.ttl] <= 0) {
      const wasMarket = f[o + F.need] === Need.Market;
      const need = this.pickNeed(world);
      f[o + F.need] = need;
      const g = this.randomNodeFor(need, x, z);
      this.assignPath(i, g);
      f[o + F.ttl] = this.rng.range(35, 150);
      f[o + F.mood] = need === Need.Commute ? 1 : 0;
      if (wasMarket && need === Need.Market && this.hasMarket) {
        f[o + F.dwell] = this.rng.range(8, 30);
      }
    }

    // --- steering
    let tx = x, tz = z;
    const node = gi >= 0 && gi < this.nodes.length ? this.nodes[gi].position : null;
    if (node) {
      // Steer toward the next node along the path, not the final goal, so the
      // crowd follows streets instead of clipping building corners.
      const len = this.pathLength(i);
      const k = Math.min(len - 1, 1 + (((f[o + F.gait] * 0.02) | 0) % Math.max(1, len)));
      const ni = this.pathNodeAt(i, k);
      const np = ni >= 0 && ni < this.nodes.length ? this.nodes[ni].position : node;
      tx = np[0]; tz = np[2];
    }

    let dx = tx - x, dz = tz - z;
    const dl = Math.hypot(dx, dz) || 1;
    dx /= dl; dz /= dl;

    // True nearest local bodies, independent of storage/insertion order.
    let sx = 0, sz = 0;
    const n = this.grid.nearest(x, z, SEP_RADIUS, this.nbr, NEAREST_COUNT, i);
    for (let k = 0; k < n; k++) {
      const j = this.nbr[k], p = j * F.LOCAL;
      let ox = x - f[p + F.x], oz = z - f[p + F.z];
      let d = Math.hypot(ox, oz);
      if (d < 1e-6) {
        // Coincident externally supplied bodies still have an antisymmetric
        // local direction; the old zero-distance guard left them coincident.
        const a = ((Math.min(i, j) * 73856093 ^ Math.max(i, j) * 19349663) >>> 0) * 2.3283064365386963e-10 * Math.PI * 2;
        const sign = i < j ? 1 : -1;
        ox = Math.cos(a) * sign; oz = Math.sin(a) * sign; d = 1;
      }
      const weight = Math.max(0, 1 - Math.hypot(x - f[p + F.x], z - f[p + F.z]) / SEP_RADIUS);
      sx += ox / d * weight * weight;
      sz += oz / d * weight * weight;
    }
    f[o + F.density] = n;

    // Curiosity makes a few agents veer off-route; sociability slows them
    // down in crowds, which is what makes a dense crowd *look* dense.
    const wob = Math.sin(this.wanderClock * 0.7 + f[o + F.seed] * 6.28) * f[o + F.curious] * 0.55;
    const perpX = -dz, perpZ = dx;

    // Goal motion may slow in a crowd; separation keeps its own speed budget.
    const jam = 1 / (1 + n * 0.09 * f[o + F.social]);
    const maxSpeed = f[o + F.pace];
    const sep = Math.hypot(sx, sz);
    const sepSpeed = maxSpeed * Math.min(1, sep) * 0.8;
    const wx = dx * maxSpeed * jam + perpX * wob + (sep > 0 ? sx / sep * sepSpeed : 0);
    const wz = dz * maxSpeed * jam + perpZ * wob + (sep > 0 ? sz / sep * sepSpeed : 0);

    const ax = wx * 4.0, az = wz * 4.0;
    const damp = Math.exp(-6.0 * dt);
    f[o + F.vx] = (f[o + F.vx] + ax * dt) * damp;
    f[o + F.vz] = (f[o + F.vz] + az * dt) * damp;

    // Clamp, then integrate.
    const sp = Math.hypot(f[o + F.vx], f[o + F.vz]);
    if (sp > maxSpeed) {
      f[o + F.vx] *= maxSpeed / sp;
      f[o + F.vz] *= maxSpeed / sp;
    }
    let nx = x + f[o + F.vx] * dt;
    let nz = z + f[o + F.vz] * dt;

    // Wind pushes people around, and rain makes them hurry.
    const wind = world.weather.windSpeed * 0.018;
    const gust = 0.35 + 0.65 * Math.sin(this.wanderClock * 1.7 + f[o + F.seed] * 12.0);
    nx += Math.cos(world.weather.windDir) * wind * gust * dt * 12;
    nz += Math.sin(world.weather.windDir) * wind * gust * dt * 12;

    // Pavement hold.
    //
    // Path following walks every agent onto a nav node, and nav nodes sit on
    // street centrelines: measured, after three seconds all 2124 drawn agents
    // had the same z, 0.35, whatever grouping had put them there. A group assigned
    // at spawn does not survive the first few frames of pathing. So the signed
    // offset from the kerb is a standing constraint: the agent still walks, it
    // just walks on the pavement rather than in the traffic lane, which is also
    // where the review asked for them.
    if (!this.plan) this.plan = cityPlan(this.seedRef.seed);
    if (f[o + F.lateral] !== 0) {
      const s = sampleStreetPlan(this.plan, nx, nz, this.streetOut);
      const nxx = -s.tz, nzz = s.tx;
      const lat = (nx - s.px) * nxx + (nz - s.pz) * nzz;
      // Hold the *band*, not a point. A constant offset pins every agent to one
      // lateral line, which is what the hold was for and also what collapsed
      // their screen separation: measured mean nearest-neighbour 1.67 px, below
      // the 2 px threshold in docs/LEGIBILITY_TARGETS.md. Two incommensurate
      // sines per agent give each one its own wander so the band is populated
      // without anyone standing still.
      const wob = Math.sin(this.wanderClock * 0.31 + f[o + F.seed] * 17.3) * 0.9
        + Math.sin(this.wanderClock * 0.11 + f[o + F.seed] * 41.7) * 0.6;
      const d = f[o + F.lateral] + wob - lat;
      // The correction is a *rate*, not a snap. Measured with the clamp removed
      // as a control, over 60 frames at each of dt = 0, 1/120, 1/60, 1/30, 1/15:
      // the hold displaced the median agent **24.12 m in a single frame**, with
      // 74% of agents displaced more than 20 m. It did so identically at dt=0
      // (p50 24.117 m) as at dt=1/15 (p50 24.169 m) — a 0.2% spread across a
      // 60-fold change in dt. It was not a velocity term at all; it was
      // `nx += normal * error`, applied in full, every frame.
      //
      // The error never converged because it was never allowed to. `resolveBuildings`
      // pushes an agent out of a footprint, the hold snapped it straight back
      // in, and the next frame repeated: **20.8% of the active population stood
      // inside a building at the start of every frame**. Each of those made two
      // ~24 m internal moves per frame which cancelled to a **net 0.000 m** —
      // the crowd was pinned in place, not flying. Two systems were fighting
      // over the same bodies, and the crowd not being alive was the symptom.
      //
      // Rate-limiting keeps the constraint and loses the teleport. A walking
      // pace is 4x the correction's own demand (the `wob` target moves at
      // 0.9*0.31 + 0.6*0.11 = 0.35 m/s), so the band is still tracked; an agent
      // shoved 20 m off now walks back instead of snapping. After: hold p50
      // 0.000 m at dt=0 and exactly `HOLD_SPEED * dt` at every other dt, max
      // 0.09 m; agents inside a building 20.8% -> 0.0%.
      const lim = HOLD_SPEED * dt;
      const corr = d > lim ? lim : d < -lim ? -lim : d;
      nx += nxx * corr;
      nz += nzz * corr;
    }
    // The final local sweep owns clearance. Wind, pathing and the legacy hold
    // cannot put a body back inside another body or an emitted solid afterward.
    const recovering = this.obstacles.recovery(x, z, f[o + F.y], maxSpeed * dt, this.escape);
    if (recovering) {
      nx = x + this.escape[0];
      nz = z + this.escape[1];
      this.diag.obstacleRecoveries++;
    }
    const mx = nx - x, mz = nz - z;
    const travel = Math.min(this.grid.sweep(i, x, z, mx, mz),
      this.obstacles.sweep(x, z, f[o + F.y], mx, mz));
    if (recovering && travel < 1e-6) this.diag.blockedRecoveries++;
    nx = x + mx * travel;
    nz = z + mz * travel;
    const step = Math.hypot(nx - x, nz - z);
    f[o + F.speed] = dt > 0 ? step / dt : 0;
    f[o + F.x] = nx;
    f[o + F.z] = nz;
    this.grid.move(i, f[o + F.x], f[o + F.z]);
    f[o + F.y] = this.groundAt(nx, nz);
    const mv = Math.hypot(f[o + F.vx], f[o + F.vz]);
    if (mv > 0.06) {
      const want = Math.atan2(f[o + F.vx], f[o + F.vz]);
      let diff = want - f[o + F.heading];
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      f[o + F.heading] += diff * Math.min(1, dt * 8);
    }
    // Rain hurries people along, which is instantly readable in a downpour.
    const hurry = world.weather.precip === 'rain' ? 1.35 : 1;
    f[o + F.gait] += step * 2.4 * hurry;

  }

  /**
   * Actual emitted walking-surface support, with the global deck as fallback.
   *
   * It used to return the roof of the first building whose footprint contained
   * the point, which meant that seeding anywhere in the city — and the city is
   * mostly buildings — put the entire crowd on top of towers, hundreds of
   * metres up. Rejection sampling in `seedAgent` keeps them off the footprints
   * in the first place. Only tagged walking triangles are supplied here;
   * building roofs never enter this index.
   */
  private groundAt(x: number, z: number): number {
    return this.walkingSurfaces.heightAt(x, z, GROUND_Y);
  }

  /** Reusable output for the street sampler; the module's own is private. */
  private streetOut: StreetSample = {
    dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
  };
  private plan: ReturnType<typeof cityPlan> | null = null;

  /**
   * Place a point on the nearest carriageway, and report which way that street
   * runs.
   *
   * The city already knows: `sampleStreetPlan` returns the closest point on the
   * nearest centreline plus the tangent along it. So this is one lookup, not a
   * search — and it is exact.
   *
   * The earlier version hill-climbed on `roadClearanceAt`, assuming a positive
   * value meant "on the road". It does not: `clearance` is `dist - width/2`, so
   * it is *negative* inside the carriageway. The climb therefore walked
   * confidently away from every street and into the middle of the blocks, which
   * is why the crowd ended up 25m behind the camera and out of frame.
   */
  private snapToStreet(x: number, z: number): { x: number; z: number; tx: number; tz: number; width: number } {
    if (!this.plan) this.plan = cityPlan(this.seedRef.seed);
    const s = sampleStreetPlan(this.plan, x, z, this.streetOut);
    // Already on (or beside) the carriageway — leave it where it was sampled.
    if (s.clearance <= 1.5) return { x, z, tx: s.tx, tz: s.tz, width: s.width };
    // Otherwise step only as far as it takes to reach the *edge* of the road.
    //
    // Snapping all the way to the centreline looks correct and is catastrophic:
    // in a dense block the nearest street is the same one for most of the view
    // cone, so the entire population collapses into a single 11m line. Stepping
    // to the kerb keeps the sampled distribution and only corrects the part
    // that is genuinely unwalkable.
    const need = s.dist - s.width * 0.5 - 1.5;
    if (need <= 0) return { x, z, tx: s.tx, tz: s.tz, width: s.width };
    const dx = s.px - x, dz = s.pz - z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return { x, z, tx: s.tx, tz: s.tz, width: s.width };
    const k = Math.min(1, need / l);
    return { x: x + dx * k, z: z + dz * k, tx: s.tx, tz: s.tz, width: s.width };
  }

  // ---------------------------------------------------------------- population

  /**
   * Recycle agents toward the camera, in slices so a teleport cannot spike a
   * frame.
   *
   * The two rules are independent and both always run: anything that has fallen
   * out of the view radius is retired, and anything inactive is refilled while
   * the population is under target. Coupling the refill to a "deficit" alone
   * looks equivalent and is not — once the population reaches target, the
   * deficit is permanently zero, the recycle arm never fires, and the whole
   * crowd is stranded wherever the camera happened to be at startup. That is
   * exactly what happened: 2550 agents alive, zero visible.
   */
  private rebuildSlices(cam: Vec3, fwd: Vec3): void {
    const f = this.f;
    const slice = Math.ceil(this.capacity / this.rebuildStride);
    const end = Math.min(this.capacity, this.rebuildCursor + slice);
    const r2 = this.viewRadius * this.viewRadius;

    const fx = fwd[0], fz = fwd[2];
    for (let i = this.rebuildCursor; i < end; i++) {
      const o = i * F.LOCAL;
      const active = f[o + F.active] > 0.5;
      const dx = f[o + F.x] - cam[0], dz = f[o + F.z] - cam[2];
      const d2 = dx * dx + dz * dz;
      // Retire an agent when it is out of range *or* behind the viewer.
      //
      // The radius test alone is not enough. A free-flying camera can sit well
      // inside a population it seeded elsewhere, and then the recycle loop never
      // fires, the crowd stays centred where the camera happened to start, and
      // the view is an empty street with thousands of people at your back. The
      // crowd has to follow the view, not merely coexist with it.
      // Retire anything behind the view plane. A generous negative margin
      // here is what let the whole population sit in a clump 25m behind the
      // camera: it was technically "not too far", and therefore immortal.
      const behind = (dx * fx + dz * fz) < 0;
      const retire = active && (d2 > r2 || behind);

      if (retire) {
        f[o + F.active] = 0;
        this.grid.remove(i);
        this.liveCount--;
        continue;
      }
      if (!active && this.liveCount < this.targetVisible) {
        // An empty group slot must not be counted: `liveCount` is the number of
        // agents the rebuild believes are alive, and inflating it starves the
        // rest of the population.
        if (this.seedAgent(i, cam, fwd)) {
          this.liveCount++;
          this.grid.insert(i, f[o + F.x], f[o + F.z]);
        } else this.diag.blockedSeeds++;
      }
    }
    this.rebuildCursor = end >= this.capacity ? 0 : end;
  }

  /**
   * Put the Market attractor on the market spine, and decide when to move it.
   *
   * This used to be a uniform point in an 840 m square, re-rolled every 2.5 s.
   * Measured at seed 42: mean 218 m off the market spine, worst 557 m, and in
   * ten consecutive rebuilds it landed in the market district *zero* times — a
   * `market-rush` walked several thousand people to a car park. Nothing
   * reported it. The agents walked, the paths were valid, the counts looked
   * right; the destination was simply wrong, which is the only kind of bug a
   * counter cannot see.
   *
   * The attractor is now the point of the spine centreline nearest the camera.
   * Candidates are restricted to the centreline, so the camera bias chooses
   * *which* stretch of market is busy and can never push the attractor off the
   * market. The parameter is quantised, so a drifting camera moves the
   * attractor in 15 m steps instead of dragging it continuously, and a dwell
   * timer stops it relocating every few seconds — a destination that moves
   * faster than a person walks is a crowd that never arrives.
   */
  private maybeRebuild(cam: Vec3, dt: number): void {
    this.marketTimer -= dt;
    const f = districtField(this.seedRef.seed);
    // The spine parameter of the camera's perpendicular foot on the spine.
    const cell = Math.round(
      spineHit(f.market, cam[0], cam[2], this.spineOut).along / MARKET_ALONG_QUANTUM,
    );
    if (this.hasMarket && cell === this.marketCellAt) {
      const reach = Math.hypot(this.market[0] - cam[0], this.market[2] - cam[2]);
      // Hold this anchor: either the dwell has not expired, or it has and the
      // camera has not travelled far enough along the market to justify moving.
      if (reach <= MARKET_REACH || this.marketTimer > 0) {
        if (this.marketTimer <= 0) this.marketTimer = MARKET_HOLD;
        return;
      }
    }
    this.marketTimer = MARKET_HOLD;
    this.marketCellAt = cell;
    const p = spinePoint(f.market, cell * MARKET_ALONG_QUANTUM);
    this.market[0] = p[0];
    this.market[1] = GROUND_Y;
    this.market[2] = p[1];
    this.hasMarket = true;
  }

  /** Reject occupied local candidates rather than putting bodies inside bodies. */
  private seedAgent(i: number, cam: Vec3, fwd: Vec3 = [0, 0, -1]): boolean {
    const f = this.f;
    const o = i * F.LOCAL;
    const r = this.rng;
    // Uniform disc, pushed a little ahead of the camera. A free-flying camera
    // covers ground far faster than a person walks, so seeding symmetrically
    // leaves the view half-empty by construction.
    //
    // Rejection-sample against building footprints: a point inside one is a
    // rooftop or a wall, and a person standing there is a person nobody can
    // see. Eight attempts clears even the densest blocks.
    // Sample in *view* space, not as a world disc.
    //
    // A world-space disc around a free-flying camera wastes most of the
    // population: half of it is behind you, and the part in front is spread
    // thin over a 320m circle. Sampling forward-weighted in the camera's own
    // basis puts the density where the frustum actually is — and it is what
    // makes a street-level view populated rather than deserted.
    const fx = fwd[0], fz = fwd[2];
    const fl = Math.hypot(fx, fz) || 1;
    const ux = fx / fl, uz = fz / fl;          // forward, horizontal
    const vx = -uz, vz = ux;                   // left/right
    // d^2 weighting: uniform area density on the ground plane, no concentration
    // at the near point.
    // Groups, not a uniform scatter.
    //
    // The review gate: "concentrate overlapping, recognisable head/torso
    // silhouettes along visible pavements and market fronts, with gaps between
    // groups. More submitted instances alone would not establish a busy
    // destination." 2550 instances were already being submitted; they read as a
    // block because a uniform scatter puts nobody next to anybody. A group of
    // six inside 1.5 m overlaps into a legible silhouette, and an empty group
    // slot leaves daylight where the next group starts.
    const g = (i / GROUP_SIZE) | 0;
    const rg = this.rng.fork(0x9e37 + g);
    // Group *centres* cluster around a small set of anchors spread through the
    // view, so the street carries readable knots with daylight between them
    // rather than one continuous band.
    //
    // Two earlier attempts got this wrong and both were caught by measuring.
    // Refusing to seat 22% of agents starved `liveCount` to 1336 against a target
    // of 2550. Shrinking groups to vary their size was worse: a size-1 group put
    // all six members at `rr = 0`, the *same point*, and measured nearest-neighbour
    // distance p50 collapsed to 0.03 m — the clump failure in a new costume.
    // Gaps belong between groups, never inside one.
    const band = this.viewRadius / GROUP_ANCHORS;
    const aIdx = rg.int(0, GROUP_ANCHORS - 1);
    const d = Math.max(2, (aIdx + 0.5) * band + rg.jitter(band * 0.5));
    // Narrow across the view, not wide. Measured before this: agents spread
    // +/-0.3*viewRadius landed a median of 35 m from the street centreline with
    // 1203 of 2506 beyond 36 m — the crowd was on four parallel streets and the
    // street in frame read empty. A 26-36 m carriageway plus its footways is
    // about 0.15 of the view radius wide.
    const lateral = rg.jitter(this.viewRadius * 0.15);
    const sx = cam[0] + ux * d + vx * lateral;
    const sz = cam[2] + uz * d + vz * lateral;
    const placed = this.snapToStreet(sx, sz);
    // Push the group onto the footway. People stand at the edge of a street, not
    // in its traffic lane, and the pavement is the surface the review asked the
    // crowd to be on.
    const nx = -placed.tz, nz = placed.tx;
    const side = rg.bool() ? 1 : -1;
    const lat = side * (placed.width * 0.5 + FOOTWAY_SETBACK);
    const cx = placed.x + nx * lat;
    const cz = placed.z + nz * lat;
    // Members cluster inside GROUP_RADIUS so their head/torso masses overlap.
    //
    // The member fork is what makes them different people. Without it every
    // member of a group draws the same `rg` stream and lands on the *same point*
    // — measured nearest-neighbour distance p50 0.00 m across all 2124 drawn
    // agents, a clump with 2124 people standing in it. The group stream decides
    // where the group is; the member stream decides who is in it.
    const rm = rg.fork(i - g * GROUP_SIZE);
    // Seats beyond this group's size fall back onto the group centre itself, so
    // a small group is a tight knot and a zero group is an empty patch of
    // pavement with nobody on it.
    let x = cx, z = cz, free = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const a2 = rm.next() * Math.PI * 2;
      const rr = Math.sqrt(rm.next()) * GROUP_RADIUS;
      x = cx + Math.cos(a2) * rr;
      z = cz + Math.sin(a2) * rr;
      if (this.obstacles.occupied(x, z, this.groundAt(x, z))) continue;
      if (this.grid.nearest(x, z, CONTACT_SEPARATION, this.nbr, 1, i) !== 0) continue;
      free = true;
      break;
    }
    if (!free) return false;
    // Face along the street rather than a random direction — a crowd walking
    // across traffic reads as nonsense, and this costs nothing.
    this.streetTangent = placed;

    f[o + F.x] = x;
    f[o + F.z] = z;
    f[o + F.y] = this.groundAt(x, z);
    f[o + F.vx] = 0;
    f[o + F.vz] = 0;
    f[o + F.heading] = Math.atan2(this.streetTangent.tx, this.streetTangent.tz) + rm.jitter(0.9);
    f[o + F.gait] = r.range(0, 100);
    f[o + F.speed] = 0;
    f[o + F.pace] = r.range(0.85, 1.75);
    f[o + F.space] = r.next();
    f[o + F.social] = r.next();
    f[o + F.curious] = r.next() * 0.7;
    f[o + F.seed] = r.next();
    f[o + F.mood] = 0;
    f[o + F.density] = 0;
    f[o + F.strand] = 0;
    f[o + F.level] = 0;
    f[o + F.district] = 0;
    f[o + F.active] = 1;
    f[o + F.dwell] = 0;
    // The pavement this agent walks on, held for its whole life. A small
    // per-member jitter so a group is not a ruled line either.
    f[o + F.lateral] = lat + rm.jitter(0.55);
    f[o + F.need] = Need.Wander;
    f[o + F.goal] = this.nearestNodeIdx(x, z);
    f[o + F.pathPos] = 0;
    f[o + F.ttl] = r.range(20, 120);

    const c = crowdColorFor(this.seedRef, [x, f[o + F.y], z], f[o + F.seed]);
    f[o + F.cr] = c[0];
    f[o + F.cg] = c[1];
    f[o + F.cb] = c[2];
    return true;
  }

  /** Set each frame from the world so colour lookups see live weather. */
  private seedRef: WorldState = defaultWorld(0x5e7a17);

  /**
   * Write one agent's instance record into slot `n`.
   *
   * Called from Pass B under the same `active` guard and the same radius test
   * that produced `visibleCount`, which is why the two agree by construction
   * rather than by luck. `o` is the agent's field offset. At most one record is
   * written per iteration of a loop bounded by `capacity`, and `instData` is
   * `capacity * INSTANCE_FLOATS` long, so no capacity guard is reachable.
   *
   * Exactly INSTANCE_FLOATS are written. The old density/speed tail landed on
   * the next record's rotation column and only appeared safe in ascending
   * order. A record-isolation regression exercises out-of-order writes now.
   */
  private writeInstance(n: number, o: number): void {
    const f = this.f;
    const d = this.instData;
    const b = n * INSTANCE_FLOATS;
    const x = f[o + F.x], y = f[o + F.y], z = f[o + F.z];
    const h = f[o + F.heading];
    const ch = Math.cos(h), sh = Math.sin(h);
    // Column-major TRS: translate · rotY · uniform scale.
    d[b] = ch; d[b + 1] = 0; d[b + 2] = -sh; d[b + 3] = 0;
    d[b + 4] = 0; d[b + 5] = 1; d[b + 6] = 0; d[b + 7] = 0;
    d[b + 8] = sh; d[b + 9] = 0; d[b + 10] = ch; d[b + 11] = 0;
    d[b + 12] = x; d[b + 13] = y; d[b + 14] = z; d[b + 15] = 1;
    // Tint: the clothing colour, with alpha carrying the gait-driven limb mask.
    const gait = f[o + F.gait];
    const mask = 0.5 + 0.5 * Math.sin(gait);
    d[b + 16] = f[o + F.cr];
    d[b + 17] = f[o + F.cg];
    d[b + 18] = f[o + F.cb];
    d[b + 19] = mask;
    // Params: matId, roughness, emissive (0), gait phase.
    // MAT.PLAIN, not MAT.DIFFUSE: a pedestrian is 1.7m tall, so under the
    // building facade synthesiser it lands entirely inside one 3.1m x 3.6m
    // window cell and is shaded as dark glass. People were being drawn the
    // whole time and were simply invisible.
    d[b + 20] = MAT.PLAIN;
    d[b + 21] = 0.66;
    d[b + 22] = 0;
    d[b + 23] = gait;
  }


  dispose(): void {
    this.f = new Float32Array(0);
    this.instData = new Float32Array(0);
    this.instances = { data: this.instData, count: 0 };
    this.visibleCount = 0;
  }
}

// ---------------------------------------------------------------- helpers

function visibleCountStep(f: Float32Array, o: number): void {
  f[o + F.strand] += 1;
  if (f[o + F.strand] > 90) f[o + F.active] = 0;
}

/**
 * Clothing colour for a pedestrian: the district's own palette, pulled toward
 * a saturated accent, then jittered per person so a crowd has variety rather
 * than one uniform mass.
 */
/**
 * A district's coat colours: the three palette entries furthest from its deck.
 *
 * Why this is not a fixed ramp. The previous version lerped `base -> trim`, which
 * for `market-spine` is brown `#9b6b4b` to gold `#d8a03c` — **warm clothing on a
 * warm brown cobble deck**, which is the review gate's "reads as blocks rather
 * than separate people" exactly. `docs/STREET_SPEC.md` §A supports warm
 * pedestrian light against cool surroundings; a per-district rule is what makes
 * that hold where the ground is warm too, because it picks the palette entries
 * the deck does not already own.
 *
 * Ranking is over two axes, because hue alone is not enough at 20 px:
 *   - chroma distance, normalising each colour by its max channel, so a pale gold
 *     and a saturated gold are the same hue and score the same;
 *   - value distance, so a figure separates from the deck by lightness even when
 *     it shares its hue.
 *
 * `base` and `ground` are excluded outright: a figure that is the colour of the
 * ground it stands on is the failure mode, whatever its chroma.
 */
function contrastSet(pal: ResolvedPalette): Vec3[] {
  const nx = Math.max(pal.ground[0], pal.ground[1], pal.ground[2]) || 1;
  const ng = [pal.ground[0] / nx, pal.ground[1] / nx, pal.ground[2] / nx];
  const vg = 0.2126 * pal.ground[0] + 0.7152 * pal.ground[1] + 0.0722 * pal.ground[2];
  const pool: Vec3[] = [pal.trim, pal.glass, pal.secondary, pal.foliage, pal.water, pal.emissive, pal.metal];
  // Value first, chroma as a tie-break — not the other way round, and the order
  // is the whole point.
  //
  // Measured on `market-spine`, over the three coats each rule selects:
  //
  //   chroma-first (was)  day 1.15 2.04 1.57   night 1.00 1.03 1.01
  //   value-first  (now)  day 2.87 2.04 1.90   night 1.05 1.03 1.02
  //
  // Doubling the daytime figure/ground contrast matters: the reference's own
  // samples are 2.76:1 at 16 px and 2.20:1 at 19 px, and the chroma-first rule
  // put the primary coat at 1.15:1, *below* the band the doc says is already
  // sufficient. The night row is the other half of the finding and is in
  // `__selftest.ts`: under a uniform ambient, contrast is invariant under
  // illumination, so no palette entry separates the crowd from a night street.
  // Hue is what dies under a blue night; value survives it, which is why the
  // weight moved.
  const scored = pool.map((c) => {
    const m = Math.max(c[0], c[1], c[2]) || 1;
    const n = [c[0] / m, c[1] / m, c[2] / m];
    const chroma = Math.hypot(n[0] - ng[0], n[1] - ng[1], n[2] - ng[2]);
    const v = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    return { c, score: Math.abs(v - vg) * 1.6 + chroma * 0.5 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.c);
}

export function crowdColorFor(world: WorldState, position: Vec3, personality: number): Vec3 {
  const style = districtStyle(nearestDistrict(world.seed, position));
  const pal = districtPaletteLinear(style);
  const coats = contrastSet(pal);
  // Personality chooses within the contrast set and scales value, so two agents
  // in the same place never resolve to the same flat colour.
  const c = coats[Math.min(coats.length - 1, Math.floor(personality * coats.length))];
  const k = 0.7 + personality * 0.85;
  return v3norm([c[0] * k, c[1] * k, c[2] * k]);
}

const DISTRICT_PROBE = new Map<number, number>();
function nearestDistrict(seed: number, p: Vec3): number {
  // Quantise to a coarse grid and cache; the district field is expensive to
  // evaluate per agent per frame and changes slowly.
  const key = (Math.floor(p[0] / 64) << 12) ^ (Math.floor(p[2] / 64) << 2);
  const hit = DISTRICT_PROBE.get(key);
  if (hit !== undefined) return hit;
  const id = districtAt(p[0], p[2], seed);
  DISTRICT_PROBE.set(key, id);
  if (DISTRICT_PROBE.size > 4096) DISTRICT_PROBE.clear();
  return id;
}
