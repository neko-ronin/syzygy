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
  clamp, lerp, makeRng, saturate, smoothstep, v3cross, v3norm, type Rng, type Vec3,
} from '../core/math';
import { defaultWorld, type WorldState } from '../core/state';
import {
  City, GROUND_Y, cityPlan, sampleStreetPlan, type StreetSample,
} from '../world/citygen';
import { NavGraph, type NavNode } from '../world/networks';
import { MAT, INSTANCE_FLOATS } from '../render/citymesh';
import { districtAt, districtPaletteLinear, districtStyle } from '../world/districts';

const MAX_DT = 1 / 15;

// ---------------------------------------------------------------- needs

/** What a person is currently trying to do. The order is the u8 encoding. */
const enum Need {
  Commute = 0, Shop = 1, Market = 2, Rest = 3, Wander = 4, RideStop = 5, Event = 6,
}
const NEED_COUNT = 7;
/** Baseline need weights. Events and agitation perturb these. */
const NEED_WEIGHTS: number[] = [0.30, 0.18, 0.10, 0.08, 0.24, 0.07, 0.03];

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
  LOCAL: 28,
} as const;

export interface CrowdInstanceView { data: Float32Array; count: number; }

// ---------------------------------------------------------------- grid

/**
 * Uniform spatial hash. Rebuilt on a stagger so the cost is amortised: each
 * frame rebuilds one seventh of the cells, which is imperceptible and keeps
 * the frame budget flat.
 */
class HashGrid {
  cellSize = 8;
  originX = 0;
  originZ = 0;
  dimX = 1;
  dimZ = 1;
  private counts: Int32Array = new Int32Array(1);
  private starts: Int32Array = new Int32Array(1);
  private items: Int32Array = new Int32Array(1);
  /** Per-cell occupancy, refreshed by the compute pass and mirrored here. */
  occupancy: Int32Array = new Int32Array(1);

  configure(centre: Vec3, radius: number): void {
    const cs = 8;
    const dim = Math.max(1, Math.min(256, Math.ceil((radius * 2) / cs) + 1));
    if (dim !== this.dimX || cs !== this.cellSize) {
      this.cellSize = cs;
      this.dimX = dim;
      this.dimZ = dim;
      const n = dim * dim;
      this.counts = new Int32Array(n + 1);
      this.starts = new Int32Array(n + 1);
      this.items = new Int32Array(n);
      this.occupancy = new Int32Array(n);
    }
    this.originX = centre[0] - (dim * cs) / 2;
    this.originZ = centre[2] - (dim * cs) / 2;
  }

  private cellOf(x: number, z: number): number {
    const cx = clamp(((x - this.originX) / this.cellSize) | 0, 0, this.dimX - 1);
    const cz = clamp(((z - this.originZ) / this.cellSize) | 0, 0, this.dimZ - 1);
    return cz * this.dimX + cx;
  }

  /** Two-pass counting sort. O(n) with no allocation after construction. */
  build(f: Float32Array, ids: Int32Array, n: number): void {
    this.counts.fill(0);
    for (let i = 0; i < n; i++) {
      if (f[i * F.LOCAL + F.active] < 0.5) continue;
      this.counts[this.cellOf(f[i * F.LOCAL + F.x], f[i * F.LOCAL + F.z])]++;
    }
    // Prefix sum into `starts`, and reuse `counts` as the per-cell write cursor.
    let run = 0;
    for (let c = 0; c < this.counts.length; c++) {
      this.occupancy[c] = this.counts[c];
      this.starts[c] = run;
      run += this.counts[c];
    }
    this.starts[this.counts.length] = run;
    for (let i = 0; i < n; i++) {
      if (f[i * F.LOCAL + F.active] < 0.5) continue;
      const c = this.cellOf(f[i * F.LOCAL + F.x], f[i * F.LOCAL + F.z]);
      this.items[this.starts[c] + this.counts[c]++] = ids[i];
    }
    // `counts` is refilled with zeros at the top of the next build.
  }

  /** Visit every agent within `r` cells of (x,z). Callback-free: use a loop. */
  cellRange(x: number, z: number, r: number, out: Int32Array, max: number): number {
    const cs = this.cellSize;
    const x0 = clamp((((x - r) - this.originX) / cs) | 0, 0, this.dimX - 1);
    const x1 = clamp((((x + r) - this.originX) / cs) | 0, 0, this.dimX - 1);
    const z0 = clamp((((z - r) - this.originZ) / cs) | 0, 0, this.dimZ - 1);
    const z1 = clamp((((z + r) - this.originZ) / cs) | 0, 0, this.dimZ - 1);
    let n = 0;
    for (let cz = z0; cz <= z1 && n < max; cz++) {
      for (let cx = x0; cx <= x1 && n < max; cx++) {
        const c = cz * this.dimX + cx;
        const s = this.starts[c];
        const e = this.starts[c + 1];
        for (let i = s; i < e && n < max; i++) out[n++] = this.items[i];
      }
    }
    return n;
  }
}

// ---------------------------------------------------------------- sim

export class CrowdSim {
  /** Structure-of-arrays. One contiguous allocation, never resized in the loop. */
  private f: Float32Array;
  private ids: Int32Array;
  private capacity: number;

  private grid = new HashGrid();
  private lastCam: Vec3 = [0, 0, 0];
  private lastFwd: Vec3 = [0, 0, -1];
  private streetTangent = { x: 0, z: 0, tx: 1, tz: 0 };
  private nbr: Int32Array;

  private nav: NavGraph | null = null;
  private nodes: NavNode[] = [];
  private city: City | null = null;
  private rng: Rng;

  private viewRadius = 190;
  private targetVisible = 0;
  private rebuildPhase = 0;
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

  visibleCount = 0;
  /** Live diagnostic counters; surfaced through the automation stats(). */
  diag = { frames: 0, live: 0, target: 0, radius: 0, instances: 0, cursor: 0, navNodes: 0, ms: 0 };
  /** Per-instance (mat4, tint, params) for the renderer to upload verbatim. */
  instances: CrowdInstanceView;

  constructor(seed: number) {
    this.capacity = 6000;
    this.f = new Float32Array(this.capacity * F.LOCAL);
    this.ids = new Int32Array(this.capacity);
    this.nbr = new Int32Array(512);
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

  setCount(n: number): void {
    this.targetVisible = clamp(n | 0, 0, this.capacity);
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

    this.diag.frames++;
    this.seedRef = world;
    this.lastCam[0] = camera.position[0];
    this.lastCam[2] = camera.position[2];
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
    this.rebuildSlices(camera.position, this.lastFwd);

    const cam = camera.position;
    this.grid.configure(cam, this.viewRadius + 40);

    // Pass A: stagger the counting sort across `rebuildStride` frames.
    if (this.rebuildPhase === 0) this.grid.build(f, this.ids, this.capacity);

    // Pass B: count active agents inside the radius.
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
        if (f[o + F.strand] > 90) { f[o + F.active] = 0; }
        continue;
      }
      f[o + F.strand] = 0;
      visible++;
      this.stepAgent(i, dt, world);
    }
    this.visibleCount = visible;
    this.diag.live = this.liveCount;
    this.diag.target = this.targetVisible;
    this.diag.radius = this.viewRadius;
    this.diag.cursor = this.rebuildCursor;
    this.diag.navNodes = this.nodes.length;
    this.diag.ms = this.lastMs;

    // Pass C: rebuild instance data for the visible set.
    this.buildInstances();

    // Advance the staggered rebuild.
    this.rebuildPhase = (this.rebuildPhase + 1) % this.rebuildStride;

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

  /** How many instances actually land inside the view cone, and their depth range. */
  inView(cam: Vec3, fwd: Vec3, fovY: number, aspect: number): { inside: number; total: number; minD: number; maxD: number } {
    const d = this.instData;
    const n = this.instances.count;
    const ty = Math.tan(fovY * 0.5);
    const tx = ty * aspect;
    // Build a basis around the view direction.
    const f = v3norm([fwd[0], fwd[1], fwd[2]]);
    const upRef: Vec3 = Math.abs(f[1]) > 0.98 ? [1, 0, 0] : [0, 1, 0];
    const r = v3norm(v3cross(upRef, f));
    const u = v3cross(f, r);
    let inside = 0, minD = Infinity, maxD = 0;
    for (let i = 0; i < n; i++) {
      const b = i * INSTANCE_FLOATS;
      const px = d[b + 12] - cam[0], py = d[b + 13] - cam[1], pz = d[b + 14] - cam[2];
      const z = px * f[0] + py * f[1] + pz * f[2];
      if (z <= 0.5) continue;
      const xx = px * r[0] + py * r[1] + pz * r[2];
      const yy = px * u[0] + py * u[1] + pz * u[2];
      if (Math.abs(xx / z) > tx || Math.abs(yy / z) > ty) continue;
      inside++;
      if (z < minD) minD = z;
      if (z > maxD) maxD = z;
    }
    return { inside, total: n, minD: +minD.toFixed(1), maxD: +maxD.toFixed(1) };
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
    if (arrived || f[o + F.ttl] <= 0) {
      const need = this.pickNeed(world);
      f[o + F.need] = need;
      const g = this.randomNodeFor(need, x, z);
      this.assignPath(i, g);
      f[o + F.ttl] = this.rng.range(35, 150);
      f[o + F.mood] = need === Need.Commute ? 1 : 0;
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

    // Separation, from the local hash. This is the only neighbour work, and it
    // is bounded by the cell radius rather than by agent count.
    let sx = 0, sz = 0;
    const n = this.grid.cellRange(x, z, this.grid.cellSize, this.nbr, 256);
    for (let k = 0; k < n; k++) {
      const j = this.nbr[k];
      if (j === i) continue;
      const p = j * F.LOCAL;
      if (f[p + F.active] < 0.5) continue;
      const ox = x - f[p + F.x], oz = z - f[p + F.z];
      const d2 = ox * ox + oz * oz;
      if (d2 > 9 || d2 < 1e-6) continue;
      const inv = 1 / d2;
      sx += ox * inv; sz += oz * inv;
    }
    f[o + F.density] = n;

    // Curiosity makes a few agents veer off-route; sociability slows them
    // down in crowds, which is what makes a dense crowd *look* dense.
    const wob = Math.sin(this.wanderClock * 0.7 + f[o + F.seed] * 6.28) * f[o + F.curious] * 0.55;
    const perpX = -dz, perpZ = dx;

    const jam = 1 / (1 + n * 0.09 * f[o + F.social]);
    const maxSpeed = f[o + F.pace] * jam;
    let wx = dx + sx * 1.9 + perpX * wob;
    let wz = dz + sz * 1.9 + perpZ * wob;
    const wl = Math.hypot(wx, wz) || 1;
    wx /= wl; wz /= wl;

    const ax = wx * maxSpeed * 4.0, az = wz * maxSpeed * 4.0;
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

    // Building avoidance. Cheap: test the agent's current cell's occupants
    // only, and push out of any AABB it has entered.
    if (this.city) {
      const hit = this.resolveBuildings(nx, nz, f[o + F.y]);
      nx = hit[0]; nz = hit[1];
    }

    // Wind pushes people around, and rain makes them hurry.
    const wind = world.weather.windSpeed * 0.018;
    const gust = 0.35 + 0.65 * Math.sin(this.wanderClock * 1.7 + f[o + F.seed] * 12.0);
    nx += Math.cos(world.weather.windDir) * wind * gust * dt * 12;
    nz += Math.sin(world.weather.windDir) * wind * gust * dt * 12;

    const step = Math.hypot(nx - x, nz - z);
    f[o + F.speed] = dt > 0 ? step / dt : 0;
    f[o + F.x] = nx;
    f[o + F.z] = nz;
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
   * Street height. Multi-level walking is not implemented yet, so this is
   * always the deck.
   *
   * It used to return the roof of the first building whose footprint contained
   * the point, which meant that seeding anywhere in the city — and the city is
   * mostly buildings — put the entire crowd on top of towers, hundreds of
   * metres up. Rejection sampling in `seedAgent` keeps them off the footprints
   * in the first place; this is just the floor.
   */
  private groundAt(_x: number, _z: number): number {
    return GROUND_Y;
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
  private snapToStreet(x: number, z: number): { x: number; z: number; tx: number; tz: number } {
    if (!this.plan) this.plan = cityPlan(this.seedRef.seed);
    const s = sampleStreetPlan(this.plan, x, z, this.streetOut);
    // Already on (or beside) the carriageway — leave it where it was sampled.
    if (s.clearance <= 1.5) return { x, z, tx: s.tx, tz: s.tz };
    // Otherwise step only as far as it takes to reach the *edge* of the road.
    //
    // Snapping all the way to the centreline looks correct and is catastrophic:
    // in a dense block the nearest street is the same one for most of the view
    // cone, so the entire population collapses into a single 11m line. Stepping
    // to the kerb keeps the sampled distribution and only corrects the part
    // that is genuinely unwalkable.
    const need = s.dist - s.width * 0.5 - 1.5;
    if (need <= 0) return { x, z, tx: s.tx, tz: s.tz };
    const dx = s.px - x, dz = s.pz - z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return { x, z, tx: s.tx, tz: s.tz };
    const k = Math.min(1, need / l);
    return { x: x + dx * k, z: z + dz * k, tx: s.tx, tz: s.tz };
  }

  private resolveBuildings(x: number, z: number, y: number): Vec3 {
    if (!this.city) return [x, y, z];
    const cs = this.city.cfg.chunkSize;
    const chunk = this.city.getChunk(Math.floor(x / cs), Math.floor(z / cs));
    if (!chunk) return [x, y, z];
    for (const b of chunk.buildings) {
      if (x > b.aabbMin[0] && x < b.aabbMax[0] && z > b.aabbMin[2] && z < b.aabbMax[2]) {
        // Push out along the shallowest axis — the cheapest stable resolution.
        const dl = x - b.aabbMin[0], dr = b.aabbMax[0] - x;
        const db = z - b.aabbMin[2], df = b.aabbMax[2] - z;
        const m = Math.min(dl, dr, db, df);
        if (m === dl) return [b.aabbMin[0] - 0.4, y, z];
        if (m === dr) return [b.aabbMax[0] + 0.4, y, z];
        if (m === db) return [x, y, b.aabbMin[2] - 0.4];
        return [x, y, b.aabbMax[2] + 0.4];
      }
    }
    return [x, y, z];
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
        this.liveCount--;
        continue;
      }
      if (!active && this.liveCount < this.targetVisible) {
        this.seedAgent(i, cam, fwd);
        this.liveCount++;
      }
    }
    this.rebuildCursor = end >= this.capacity ? 0 : end;
  }

  private maybeRebuild(_cam: Vec3, dt: number): void {
    this.marketTimer -= dt;
    if (this.marketTimer > 0) return;
    this.marketTimer = 2.5;
    this.market = [
      this.rng.range(-420, 420), GROUND_Y, this.rng.range(-420, 420),
    ];
    this.hasMarket = true;
  }

  private seedAgent(i: number, cam: Vec3, fwd: Vec3 = [0, 0, -1]): void {
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
    const d = Math.sqrt(r.next()) * this.viewRadius;
    // Spread across the view cone; `spread` widens with distance so the density
    // stays roughly uniform in screen space.
    const lateral = (r.next() * 2 - 1) * d * 0.75;
    const sx = cam[0] + ux * d + vx * lateral;
    const sz = cam[2] + uz * d + vz * lateral;
    const placed = this.snapToStreet(sx, sz);
    // Jitter across the carriageway. Without this every sample in a block
    // collapses onto the same centreline and the crowd piles into one clump.
    const jx = placed.x + (r.next() * 2 - 1) * 2.2;
    const jz = placed.z + (r.next() * 2 - 1) * 2.2;
    const x = jx;
    const z = jz;
    // Face along the street rather than a random direction — a crowd walking
    // across traffic reads as nonsense, and this costs nothing.
    this.streetTangent = placed;

    f[o + F.x] = x;
    f[o + F.z] = z;
    f[o + F.y] = this.groundAt(x, z);
    f[o + F.vx] = 0;
    f[o + F.vz] = 0;
    f[o + F.heading] = Math.atan2(this.streetTangent.tx, this.streetTangent.tz) + r.jitter(0.9);
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
    f[o + F.need] = Need.Wander;
    f[o + F.goal] = this.nearestNodeIdx(x, z);
    f[o + F.pathPos] = 0;
    f[o + F.ttl] = r.range(20, 120);

    const c = crowdColorFor(this.seedRef, [x, f[o + F.y], z], f[o + F.seed]);
    f[o + F.cr] = c[0];
    f[o + F.cg] = c[1];
    f[o + F.cb] = c[2];
  }

  /** Set each frame from the world so colour lookups see live weather. */
  private seedRef: WorldState = defaultWorld(0x5e7a17);

  private buildInstances(): void {
    const f = this.f;
    const d = this.instData;
    const camX = this.lastCam[0], camZ = this.lastCam[2];
    let n = 0;
    const cap = this.capacity;

    for (let i = 0; i < cap; i++) {
      const o = i * F.LOCAL;
      if (f[o + F.active] < 0.5) continue;
      const dx = f[o + F.x] - camX, dz = f[o + F.z] - camZ;
      if (dx * dx + dz * dz > this.viewRadius * this.viewRadius) continue;
      if (n >= cap) break;

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
      // Params: matId, roughness, emissive (0), gait phase, density.
      // MAT.PLAIN, not MAT.DIFFUSE: a pedestrian is 1.7m tall, so under the
      // building facade synthesiser it lands entirely inside one 3.1m x 3.6m
      // window cell and is shaded as dark glass. People were being drawn the
      // whole time and were simply invisible.
      d[b + 20] = MAT.PLAIN;
      d[b + 21] = 0.66;
      d[b + 22] = 0;
      d[b + 23] = gait;
      d[b + 24] = f[o + F.density];
      d[b + 25] = f[o + F.speed];
      d[b + 26] = 0;
      d[b + 27] = 0;
      n++;
    }
    this.instances.count = n;
    this.diag.instances = n;
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
export function crowdColorFor(world: WorldState, position: Vec3, personality: number): Vec3 {
  const style = districtStyle(nearestDistrict(world.seed, position));
  const pal = districtPaletteLinear(style);
  const t = smoothstep(0.35, 0.75, personality);
  const base = [
    lerp(pal.base[0], pal.trim[0], t),
    lerp(pal.base[1], pal.trim[1], t),
    lerp(pal.base[2], pal.trim[2], t),
  ];
  const k = 0.55 + personality * 0.9;
  return v3norm([base[0] * k, base[1] * k, base[2] * k]);
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
