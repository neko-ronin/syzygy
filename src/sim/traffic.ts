/**
 * Alternate-transport traffic. No cars anywhere in this city: trams,
 * trolleybuses, aerial cable cars, funiculars, zipliners, blimps, hot-air
 * balloons and hand-cycles.
 *
 * Routes come from the city's own network (`buildRailLines` /
 * `buildZiplines`), so every rail-borne vehicle follows the same canyon
 * geometry the generator decided on. They advance along a resampled polyline
 * and respect it: they brake into curves (dot product of consecutive segment
 * directions), drag down on grades, and dwell 0.6-1.4s at deterministic stop
 * positions on the tram lines. Blimps and balloons are free-floating — they
 * ride `world.weather.windSpeed`/`windDir`, bob on a sine, separate from each
 * other cheaply, and bounce off a keep-out box over the downtown core.
 *
 * Budget: ~200 vehicles in well under a millisecond per frame. Everything is a
 * preallocated object or a flat typed array; the update loop mutates in place
 * and allocates nothing.
 */

import { clamp, makeRng, type Rng, type Vec3 } from '../core/math';
import type { WorldState } from '../core/state';
import { GROUND_Y, type City } from '../world/citygen';
import {
  districtAtField, districtPaletteLinear, districtStyle, type DistrictField,
} from '../world/districts';
import { NavGraph, buildRailLines, buildZiplines, type RailLine } from '../world/networks';
// The shared per-instance layout (D18). `gpuutil.ts` declares an identical
// `INSTANCE_FLOATS`, but importing from there evaluates `GPUShaderStage`
// at module scope, which does not exist in node — so the headless sim
// self-test cannot load it. The copy in `citymesh.ts` can, and is the one
// `crowd.ts` uses. See docs/TRAFFIC_REPORT.md.
import { INSTANCE_FLOATS } from '../render/citymesh';

// ---------------------------------------------------------------- tuning

export type VehicleKind =
  | 'tram' | 'trolley' | 'cablecar' | 'funicular'
  | 'zipline' | 'blimp' | 'balloon' | 'cycle';

export interface Vehicle {
  kind: VehicleKind;
  position: Vec3;
  velocity: Vec3;
  /**
   * Unit tangent of travel, including grade. `heading` is a yaw only, so a
   * model matrix built from it leaves a tram level on a 12% grade: it floats
   * off the rail on the way up and sinks into it on the way down. `stepRail`
   * already computes the true 3D tangent for its grade penalty; this keeps
   * that vector instead of making the draw layer re-derive it.
   */
  forward: Vec3;
  heading: number;
  /** 0..1 along its route. */
  s: number;
  speed: number;
  /** Index into the traffic sim's route table. */
  route: number;
  color: Vec3;
  scale: number;
  /** Blimp/balloon only: phase of the bob and drift oscillation. */
  bobPhase: number;
  alive: boolean;
}

/** Hard speed ceiling per kind, m/s. */
const MAX_SPEED: Record<VehicleKind, number> = {
  tram: 16, trolley: 12, cablecar: 12, funicular: 8, zipline: 24,
  blimp: 8, balloon: 3, cycle: 5.5,
};

/** Relative share of the roster each kind takes. */
const KIND_MIX: readonly VehicleKind[] = [
  'tram', 'tram', 'tram', 'tram',
  'trolley', 'trolley', 'trolley',
  'cablecar', 'cablecar', 'cablecar',
  'funicular', 'funicular',
  'zipline', 'zipline', 'zipline', 'zipline',
  'blimp', 'blimp',
  'balloon', 'balloon', 'balloon',
  'cycle', 'cycle',
];

const MAX_VEHICLES = 256;
const MAX_AIR = 48;
/** Nothing floats over the downtown core, which already has enough going on. */
const KEEPOUT_HALF = 640;
const KEEPOUT_TOP = 360;
/** Hard world bound. Traffic never leaves a 6km box. */
const WORLD_HALF = 2900;
const RAIL_POINTS = 128;
const ZIP_POINTS = 32;
const STOPS_PER_TRAM = 6;
const CYCLE_PATH_CAP = 48;
const MAX_LIGHTS = 64;
const NAV_RADIUS = 620;

/** dt ceiling: a long GC pause must not teleport a tram through a building. */
export const MAX_DT = 1 / 15;

// ---------------------------------------------------------------- routes

interface Route {
  /** Which family of the network this came from. */
  family: 'rail' | 'zipline';
  /** The generator's line kind, for `rail` routes. */
  lineKind: RailLine['kind'] | 'trolley';
  /**
   * Whether the line runs on the ground, hangs below a cable, or flies free.
   * Copied from `RailLine.suspension`, which existed and was read nowhere.
   */
  suspension: RailLine['suspension'];
  /** Tram lines get a second, offset route so trolleybuses do not overlap. */
  twin: boolean;
  /** Flat xyz triples. */
  pts: Float32Array;
  /** Cumulative arc length at each point. */
  cum: Float32Array;
  /** Direction cosine with the previous segment, sharpened: 0 = hairpin. */
  curvature: Float32Array;
  count: number;
  length: number;
  closed: boolean;
  /** Manned vehicles only: deterministic stop positions as length fractions. */
  stops: Float32Array;
  stopCount: number;
  /** Dwell seconds per stop, 0.6..1.4. */
  dwells: Float32Array;
  /** Line speed from the generator, already clamped to the kind ceiling. */
  speed: number;
  /** Nominal segment length, used for the grade penalty. */
  segLen: number;
  /** Lateral offset applied when sampling, so twins do not overlap. */
  offset: number;
  color: Vec3;
}

const flatFrom = (pts: Vec3[]): Float32Array => {
  const f = new Float32Array(pts.length * 3);
  for (let i = 0; i < pts.length; i++) {
    f[i * 3] = pts[i][0];
    f[i * 3 + 1] = pts[i][1];
    f[i * 3 + 2] = pts[i][2];
  }
  return f;
};

/**
 * Resample a point list to a fixed vertex budget so the hot loop can index a
 * flat array and binary-search a cumulative table. Catmull-Rom, matching the
 * generator's own spline so vehicles sit exactly on the drawn rails.
 */
function resampleTo(pts: Vec3[], n: number, closed: boolean): Vec3[] {
  if (pts.length === 0) return [];
  if (pts.length < 2 || n < 2) return [pts[0], pts[pts.length - 1]];
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(
      pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2],
    ));
  }
  const total = cum[cum.length - 1] || 1;
  const out: Vec3[] = [];
  let seg = 0;
  const cr = (a: number, b: number, c: number, e: number, t: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
  };
  for (let k = 0; k < n; k++) {
    const s = (closed ? (k % n) / n : k / (n - 1)) * total;
    while (seg < pts.length - 2 && cum[seg + 1] < s) seg++;
    const t = (s - cum[seg]) / Math.max(1e-6, cum[seg + 1] - cum[seg]);
    const p0 = pts[Math.max(0, seg - 1)];
    const p1 = pts[seg];
    const p2 = pts[Math.min(pts.length - 1, seg + 1)];
    const p3 = pts[Math.min(pts.length - 1, seg + 2)];
    out.push([
      cr(p0[0], p1[0], p2[0], p3[0], t),
      cr(p0[1], p1[1], p2[1], p3[1], t),
      cr(p0[2], p1[2], p2[2], p3[2], t),
    ]);
  }
  return out;
}

function makeRailRoute(line: RailLine, rng: Rng, twin: boolean): Route {
  const pts = resampleTo(line.points, RAIL_POINTS, line.closed);
  const f = flatFrom(pts);
  const n = pts.length;
  const cum = new Float32Array(n);
  const curv = new Float32Array(n);
  curv[0] = 1;

  for (let i = 1; i < n; i++) {
    const ax = f[(i - 1) * 3], ay = f[(i - 1) * 3 + 1], az = f[(i - 1) * 3 + 2];
    const bx = f[i * 3], by = f[i * 3 + 1], bz = f[i * 3 + 2];
    cum[i] = cum[i - 1] + Math.hypot(bx - ax, by - ay, bz - az);
    // Curvature from the dot product of consecutive segment directions. A
    // shallow kink barely registers; a hairpin is a dead stop.
    let dot = 1;
    if (i + 1 < n) {
      const dx0 = bx - ax, dy0 = by - ay, dz0 = bz - az;
      const l0 = Math.hypot(dx0, dy0, dz0) || 1;
      const dx1 = f[(i + 1) * 3] - bx, dy1 = f[(i + 1) * 3 + 1] - by, dz1 = f[(i + 1) * 3 + 2] - bz;
      const l1 = Math.hypot(dx1, dy1, dz1) || 1;
      dot = (dx0 * dx1 + dy0 * dy1 + dz0 * dz1) / (l0 * l1);
    }
    curv[i] = clamp(dot, 0, 1) ** 2.4;
  }
  const total = cum[n - 1] || 1;

  const manned = line.kind === 'tram';
  const stopCount = manned ? STOPS_PER_TRAM : 0;
  const stops = new Float32Array(Math.max(1, stopCount));
  const dwells = new Float32Array(Math.max(1, stopCount));
  for (let i = 0; i < stopCount; i++) {
    stops[i] = clamp((i + 0.5) / stopCount + rng.jitter(0.04), 0.05, 0.95);
    dwells[i] = rng.range(0.6, 1.4);
  }

  const kind: VehicleKind = twin ? 'trolley' : line.kind;
  return {
    family: 'rail',
    lineKind: twin ? 'trolley' : line.kind,
    suspension: line.suspension,
    twin,
    pts: f,
    cum,
    curvature: curv,
    count: n,
    length: total,
    closed: line.closed,
    stops,
    stopCount,
    dwells,
    speed: Math.min(line.speed, MAX_SPEED[kind]),
    segLen: total / Math.max(1, n - 1),
    // Trolleybuses share the alignment but run beside the tram, ~5m to one side.
    offset: twin ? 5.2 * (rng.bool() ? 1 : -1) : 0,
    color: [line.color[0], line.color[1], line.color[2]],
  };
}

function makeZiplineRoute(z: { a: Vec3; b: Vec3; sag: number; color: Vec3 }): Route {
  // Parabolic droop between the anchors, matching the drawn cable.
  const raw: Vec3[] = [];
  const span = Math.hypot(z.b[0] - z.a[0], z.b[1] - z.a[1], z.b[2] - z.a[2]);
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const bow = 4 * z.sag * t * (1 - t);
    raw.push([
      z.a[0] + (z.b[0] - z.a[0]) * t,
      z.a[1] + (z.b[1] - z.a[1]) * t - bow,
      z.a[2] + (z.b[2] - z.a[2]) * t,
    ]);
  }
  const pts = resampleTo(raw, ZIP_POINTS, false);
  const f = flatFrom(pts);
  const n = pts.length;
  const cum = new Float32Array(n);
  const curv = new Float32Array(n).fill(1);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(
      f[i * 3] - f[(i - 1) * 3],
      f[i * 3 + 1] - f[(i - 1) * 3 + 1],
      f[i * 3 + 2] - f[(i - 1) * 3 + 2],
    );
  }
  const total = cum[n - 1] || span || 1;
  return {
    family: 'zipline',
    lineKind: 'zipline',
    // A zipline rider hangs from the cable rather than running on it.
    suspension: 'catenary',
    twin: false,
    pts: f,
    cum,
    curvature: curv,
    count: n,
    length: total,
    closed: false,
    stops: new Float32Array(1),
    stopCount: 0,
    dwells: new Float32Array(1),
    speed: MAX_SPEED.zipline,
    segLen: total / Math.max(1, n - 1),
    offset: 0,
    color: [z.color[0], z.color[1], z.color[2]],
  };
}

// ---------------------------------------------------------------- sim

export class TrafficSim {
  vehicles: Vehicle[] = [];
  /** Headlight/underglow sources for the clustered light pass, most important first. */
  lights: { pos: Vec3; radius: number; color: Vec3; intensity: number }[] = [];

  private readonly world: WorldState;
  private readonly city: City;
  private readonly seed: number;
  private readonly field: DistrictField;

  private routes: Route[] = [];
  private railLines: RailLine[] = [];
  private nav: NavGraph | null = null;

  private density: number;
  private count = 0;
  private active = 0;
  private disposed = false;
  /**
   * Last `world.traffic` values seen. The conductor writes those fields
   * directly, so the sim adopts a change when the *world* value changes — which
   * means an explicit `setCount`/`setDensity` is not clobbered on the next
   * frame by an unchanged world.
   */
  private seenDensity: number;
  private seenCount: number;

  /** One representative route index per kind, resolved by `rebuild`. */
  private readonly byKind: Record<string, number> = {
    tram: -1, trolley: -1, cablecar: -1, funicular: -1, zipline: -1, cycle: -1,
  };
  /** Every route index per kind, so a fleet spreads over all its lines, not only the first. */
  private readonly routesOf: Record<string, number[]> = {};

  private readonly air: Vehicle[] = [];
  private readonly airPhase = new Float32Array(MAX_AIR);
  /** Target altitude for balloons; cruise band for blimps. */
  private readonly airCeiling = new Float32Array(MAX_AIR);
  /** Vehicle index → slot in `air`. -1 for everything else. */
  private readonly airSlotOf = new Int32Array(MAX_VEHICLES).fill(-1);

  /** Per-vehicle rail state. Flat arrays: no per-frame allocation. */
  private readonly dwellT = new Float32Array(MAX_VEHICLES);
  private readonly stopCursor = new Int32Array(MAX_VEHICLES);
  /** +1 or -1: ping-pong direction on non-looping lines. */
  private readonly railDir = new Int32Array(MAX_VEHICLES);

  /** Per-vehicle cycle state over the nav graph. */
  private readonly cycNext = new Int32Array(MAX_VEHICLES).fill(-1);
  private readonly cycPathOff = new Int32Array(MAX_VEHICLES);
  private readonly cycPathLen = new Int32Array(MAX_VEHICLES);
  private readonly cycRides = new Float32Array(MAX_VEHICLES);
  private readonly cycPath = new Int32Array(MAX_VEHICLES * CYCLE_PATH_CAP);

  /** Reused light records; only `lights.length` changes per frame. */
  private readonly lightPool: { pos: Vec3; radius: number; color: Vec3; intensity: number }[] = [];
  private readonly lightScore = new Float32Array(MAX_LIGHTS);
  private worstLight = 0;

  private readonly rng: Rng;

  constructor(world: WorldState, city: City) {
    this.world = world;
    this.city = city;
    this.seed = (world.seed ^ city.cfg.seed ^ 0x7a9c31) >>> 0;
    this.rng = makeRng(this.seed);
    this.field = city.plan.districts;
    this.density = clamp(world.traffic.density, 0, 1);
    this.seenDensity = world.traffic.density;
    this.seenCount = world.traffic.count;
    for (let i = 0; i < MAX_LIGHTS; i++) {
      this.lightPool.push({ pos: [0, 0, 0], radius: 1, color: [1, 1, 1], intensity: 0 });
    }
    for (let i = 0; i < MAX_VEHICLES; i++) this.railDir[i] = 1;
    this.rebuild();
    this.setCount(world.traffic.count);
  }

  /** Vehicles currently alive and in play. */
  get activeCount(): number { return this.active; }

  /** Route count currently loaded. Zero means the city had no network. */
  get routeCount(): number { return this.routes.length; }

  /**
   * Whether this vehicle's line runs on the ground, hangs below a cable, or
   * flies free. The draw layer needs it to know whether the body sits on the
   * line or below it; `RailLine.suspension` existed for years and was read
   * nowhere in the repository.
   *
   * Note the generator tags a *cablecar* `'free'`, which is a vocabulary slip:
   * a cable car hangs from its span, it does not fly. The draw layer keys the
   * hang off the vehicle kind for that reason and uses `suspension` only for
   * the tram lines, where `'catenary'` really does mean a graded hump.
   */
  suspensionOf(v: Vehicle): Route['suspension'] {
    return this.routes[v.route]?.suspension ?? 'ground';
  }

  /** The kind of line a vehicle rides ('zipline' for the zipline family), or null off any route. */
  lineKindOf(v: Vehicle): string | null {
    const r = this.routes[v.route];
    return r ? (r.family === 'zipline' ? 'zipline' : r.lineKind) : null;
  }

  /** How many routes carry vehicles of this kind. */
  lineCount(kind: string): number {
    return this.routesOf[kind]?.length ?? 0;
  }

  /** Fleet fraction, 0..1. */
  get fleetDensity(): number { return this.density; }

  /** Absolute fleet ceiling after density is applied. */
  get fleetSize(): number { return this.vehicles.length; }

  // ------------------------------------------------------------ setup

  /** Rebuild every route from the city. Call when chunks stream in. */
  rebuild(): void {
    if (this.disposed) return;
    this.railLines = buildRailLines(this.city, this.city.cfg.seed);
    const zips = buildZiplines(this.city, this.city.cfg.seed);

    const routes: Route[] = [];
    for (const line of this.railLines) {
      routes.push(makeRailRoute(line, this.rng, false));
      // Tram lines get a second, laterally-identical route for the
      // trolleybuses; they are offset along the polyline at spawn so the two
      // services never occupy the same metres.
      if (line.kind === 'tram') routes.push(makeRailRoute(line, this.rng, true));
    }
    for (const z of zips) routes.push(makeZiplineRoute(z));
    this.routes = routes;

    for (const k of Object.keys(this.byKind)) this.byKind[k] = -1;
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      const key = r.family === 'zipline' ? 'zipline' : r.lineKind;
      if (this.byKind[key] < 0) this.byKind[key] = i;
    }
    for (const k of Object.keys(this.routesOf)) delete this.routesOf[k];
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      (this.routesOf[r.family === 'zipline' ? 'zipline' : r.lineKind] ??= []).push(i);
    }
    // Fallback pass, AFTER the sweep: a city whose only lines are funiculars
    // still needs something for trams, so fall back to any rail route.
    //
    // This used to run inside the loop, guarded only by `byKind[x] < 0`, and
    // that bound every kind to whichever rail route came first in the list. A
    // tram line is route 0, so `byKind.cablecar` was pinned to it and all 27
    // cable cars rode a street-level tram alignment: measured 1-9 m altitude
    // while the cable car lines they were supposed to be on run at 418-607 m.
    // Nothing reported it. The HUD said `cablecar`, the self-test checked
    // speeds and NaN, and no counter anywhere compared a vehicle's altitude
    // against its line's.
    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (r.family !== 'rail') continue;
      if (this.byKind.tram < 0) this.byKind.tram = i;
      if (this.byKind.cablecar < 0) this.byKind.cablecar = i;
      if (this.byKind.funicular < 0) this.byKind.funicular = i;
    }

    if (!this.nav && this.city.totalBuildings > 0) {
      this.nav = new NavGraph(this.city, {
        seed: this.city.cfg.seed,
        radius: NAV_RADIUS,
        spacing: 34,
        rooftops: false,
        rail: this.railLines,
      });
    }

    this.reindexFleet();
    // Routes changing can change how many of each kind can run at all.
    this.applyRoster();
  }

  /** Drop every route, vehicle and nav graph. */
  dispose(): void {
    this.disposed = true;
    this.routes = [];
    this.railLines = [];
    this.nav = null;
    this.vehicles = [];
    this.air.length = 0;
    this.airSlotOf.fill(-1);
    this.lights = [];
    this.active = 0;
  }

  /** Scale the fleet 0..1. The roster kind mix is fixed. */
  setDensity(d: number): void {
    this.density = clamp(Number.isFinite(d) ? d : 0, 0, 1);
    this.applyRoster();
  }

  /** Absolute fleet ceiling, hard-clamped to the pool. */
  setCount(n: number): void {
    this.count = clamp(Math.round(Number.isFinite(n) ? n : 0), 0, MAX_VEHICLES);
    this.applyRoster();
  }

  private desiredFleet(): number {
    return Math.round(this.count * (0.4 + 0.6 * this.density));
  }

  private applyRoster(): void {
    const want = this.desiredFleet();
    while (this.vehicles.length < want) this.spawn(this.vehicles.length);
    if (this.vehicles.length > want) this.vehicles.length = want;
    this.reindexFleet();
  }

  /**
   * Rebuild the air-vehicle list and its index map, then (re)point every
   * vehicle at a route. Called whenever the roster or the route table changes,
   * never per frame.
   */
  private reindexFleet(): void {
    this.air.length = 0;
    this.airSlotOf.fill(-1);
    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (v.kind !== 'blimp' && v.kind !== 'balloon') continue;
      if (this.air.length >= MAX_AIR) break;
      this.airSlotOf[i] = this.air.length;
      this.air.push(v);
    }
    for (let i = 0; i < this.vehicles.length; i++) this.assign(this.vehicles[i], i);
  }

  /** Point a vehicle at a live route (or at the air/cycle families) and seed it. */
  private assign(v: Vehicle, i: number): void {
    if (v.kind === 'blimp' || v.kind === 'balloon') {
      v.route = -1;
      const ai = this.airSlotOf[i];
      if (ai < 0) { v.alive = false; return; }
      if (!v.alive) {
        this.seedAir(v, ai, makeRng((this.seed ^ Math.imul(i + 5, 0x165667b1)) >>> 0));
      }
      v.alive = aiValid(v);
      return;
    }
    if (v.kind === 'cycle') {
      v.route = -1;
      if (!v.alive) {
        v.alive = this.nav !== null && this.nav.nodes.length > 4;
        if (v.alive) this.seedCycle(i, v);
      }
      return;
    }
    // Spread a kind's fleet over all its lines; `byKind` (with its fallback) only when it has none.
    const list = this.routesOf[v.kind];
    const idx = list && list.length > 0 ? list[i % list.length] : this.byKind[v.kind] ?? -1;
    v.route = idx;
    if (idx < 0) { v.alive = false; return; }
    this.railDir[i] = 1;
    this.stopCursor[i] = 0;
    this.dwellT[i] = 0;
    if (!v.alive) {
      v.alive = true;
      v.s = (i * 0.618) % 1;
      this.sampleRoute(this.routes[idx], v.s, v.position);
    }
  }

  // ------------------------------------------------------------ spawning

  private spawn(index: number): void {
    const kind = KIND_MIX[index % KIND_MIX.length];
    const r = makeRng((this.seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
    const style = districtStyle(districtAtField(this.field, r.range(-900, 900), r.range(-900, 900)));
    const pal = districtPaletteLinear(style);
    const t = r.next();

    const v: Vehicle = {
      kind,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      forward: [0, 0, 1],
      heading: r.range(-Math.PI, Math.PI),
      s: r.next(),
      speed: 0,
      route: -1,
      color: [
        pal.metal[0] * (1 - t) + style.accentColor[0] * t,
        pal.metal[1] * (1 - t) + style.accentColor[1] * t,
        pal.metal[2] * (1 - t) + style.accentColor[2] * t,
      ],
      scale: kind === 'blimp' ? r.range(1.3, 2.4)
        : kind === 'balloon' ? r.range(1.0, 2.0)
          : kind === 'cycle' ? r.range(0.9, 1.15)
            : kind === 'cablecar' ? r.range(0.9, 1.2)
              : r.range(0.9, 1.1),
      bobPhase: r.range(0, Math.PI * 2),
      alive: false,
    };
    this.vehicles.push(v);
    this.assign(v, index);
  }

  /** Deterministic scatter for an air vehicle. */
  private seedAir(v: Vehicle, ai: number, r: Rng): void {
    const ang = r.range(0, Math.PI * 2);
    const rad = r.range(KEEPOUT_HALF + 80, WORLD_HALF * 0.88);
    v.position[0] = Math.cos(ang) * rad;
    v.position[2] = Math.sin(ang) * rad;
    v.position[1] = v.kind === 'blimp' ? r.range(180, 340) : r.range(70, 220);
    v.velocity[0] = 0; v.velocity[1] = 0; v.velocity[2] = 0;
    this.airPhase[ai] = v.bobPhase;
    // Balloons have a ceiling far above their launch; blimps hold their band.
    this.airCeiling[ai] = v.kind === 'balloon'
      ? v.position[1] + r.range(220, 520)
      : r.range(240, 460);
  }

  private seedCycle(i: number, v: Vehicle): void {
    const r = makeRng((this.seed ^ Math.imul(i + 3, 0x27d4eb2d)) >>> 0);
    const ang = r.range(0, Math.PI * 2);
    const rad = r.range(80, WORLD_HALF * 0.8);
    v.position[0] = Math.cos(ang) * rad;
    v.position[2] = Math.sin(ang) * rad;
    v.position[1] = GROUND_Y + 0.7;
    v.velocity[0] = 0; v.velocity[1] = 0; v.velocity[2] = 0;
    v.speed = 0;
    this.cycRides[i] = 0;
    this.chooseCycleLeg(i, v);
  }

  // ------------------------------------------------------------ sampling

  /** Binary search the cumulative table for arc-length fraction `s`. */
  private sampleRoute(r: Route, s: number, out: Vec3): number {
    const target = clamp(s, 0, 0.999999) * r.length;
    let lo = 0;
    let hi = r.count - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (r.cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    const o = lo * 3;
    out[0] = r.pts[o];
    out[1] = r.pts[o + 1];
    out[2] = r.pts[o + 2];
    return lo;
  }

  private indexFor(r: Route, s: number): number {
    const target = clamp(s, 0, 0.999999) * r.length;
    let lo = 0;
    let hi = r.count - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (r.cum[mid] <= target) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  // ------------------------------------------------------------ per-frame

  /** Advance the whole fleet. `dt` is internally clamped. */
  update(dt: number, world: WorldState): void {
    if (this.disposed) return;
    const d = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_DT);
    if (d <= 0) return;

    // `world.traffic` is conductor-driven. Adopt it when the world value moves;
    // a large density jump means the city itself shifted and the route table is
    // worth rebuilding rather than just re-densitying.
    if (world.traffic.density !== this.seenDensity) {
      this.seenDensity = world.traffic.density;
      const want = clamp(world.traffic.density, 0, 1);
      const delta = Math.abs(want - this.density);
      this.density = want;
      if (delta > 0.18) this.rebuild();
      else this.applyRoster();
    }
    if (world.traffic.count !== this.seenCount) {
      this.seenCount = world.traffic.count;
      this.count = clamp(Math.round(world.traffic.count), 0, MAX_VEHICLES);
      this.applyRoster();
    }

    if (this.routes.length === 0) { this.active = 0; return; }

    const wx = world.weather;
    const wind = clamp(wx.windSpeed, 0, 40);
    const windX = Math.cos(wx.windDir) * wind;
    const windZ = Math.sin(wx.windDir) * wind;
    const t = world.time;

    let active = 0;
    const n = this.vehicles.length;
    for (let i = 0; i < n; i++) {
      const v = this.vehicles[i];
      if (!v.alive) continue;
      const kind = v.kind;
      if (kind === 'blimp' || kind === 'balloon') this.stepAir(v, i, d, windX, windZ, wind, t);
      else if (kind === 'cycle') this.stepCycle(i, v, d);
      else this.stepRail(i, v, d);
      if (v.alive) active++;
    }
    this.active = active;

    this.separateAir(d);
    this.buildLights(world);
  }

  /** Advance one rail-borne vehicle: brake into curves and grades, dwell at stops. */
  private stepRail(i: number, v: Vehicle, dt: number): void {
    const r = this.routes[v.route];
    if (!r || r.count < 2) { v.alive = false; return; }

    const dir = this.railDir[i] >= 0 ? 1 : -1;
    let s = v.s + (dir * v.speed * dt) / r.length;
    if (r.closed) {
      if (s >= 1) s -= Math.floor(s);
      else if (s < 0) s += Math.ceil(-s);
    } else if (s >= 1 || s < 0) {
      // Terminus: turn around. A single signed direction field is all the
      // state a shuttle needs.
      this.railDir[i] = -dir;
      s = s >= 1 ? 0.999 : 0.001;
      this.stopCursor[i] = 0;
      this.dwellT[i] = 0.8;
    }

    const idx = this.indexFor(r, s);
    const f = r.pts;
    const o = idx * 3;

    // Speed law: the kind ceiling, scaled by how straight this stretch is,
    // then dragged down further if the track is climbing.
    const straight = r.curvature[idx];
    const climb = Math.max(0, f[o + 1] - f[Math.max(0, idx - 1) * 3 + 1]);
    const grade = 1 - clamp((climb / Math.max(6, r.segLen)) * 0.55, 0, 0.45);
    let want = Math.min(MAX_SPEED[v.kind], r.speed) * (0.28 + 0.72 * straight) * grade;

    // Stops are read in *travel* order, so a ping-pong line sees the same ladder
    // forwards and backwards without a second cursor.
    const u = dir > 0 ? s : 1 - s;
    if (r.stopCount > 0 && v.kind !== 'cablecar') {
      if (this.dwellT[i] > 0) {
        this.dwellT[i] -= dt;
        want = 0;
      } else {
        let cur = this.stopCursor[i];
        while (cur < r.stopCount && r.stops[cur] <= u) cur++;
        this.stopCursor[i] = cur;
        if (cur < r.stopCount) {
          const gap = (r.stops[cur] - u) * r.length;
          if (gap > 0 && gap < 24) {
            want *= clamp(gap / 24, 0, 1);
          } else if (gap <= 0) {
            // Served. Advance the cursor immediately: a stationary vehicle
            // would otherwise re-arm the same stop forever.
            this.stopCursor[i] = cur + 1;
            this.dwellT[i] = r.dwells[cur];
            want = 0;
          }
        }
      }
    }

    // Acceleration is gentle, braking is firm. That asymmetry is most of what
    // makes a tram read as a tram rather than a constant-velocity bead.
    const accel = want < v.speed ? 6.0 : 2.0;
    v.speed += clamp(want - v.speed, -accel * dt, accel * dt);
    if (v.speed < 0.02) v.speed = 0;
    v.s = s;

    const nx = Math.min(idx + 1, r.count - 1);
    const pv = Math.max(0, idx - 1);
    const dx = f[nx * 3] - f[pv * 3];
    const dy = f[nx * 3 + 1] - f[pv * 3 + 1];
    const dz = f[nx * 3 + 2] - f[pv * 3 + 2];
    const len = Math.hypot(dx, dy, dz) || 1;

    v.position[0] = f[o];
    v.position[1] = f[o + 1];
    v.position[2] = f[o + 2];
    if (r.offset !== 0) {
      // Lateral shift along the horizontal normal, so a twin service reads as
      // its own carriageway rather than a ghost tram.
      const hx = -dz / len;
      const hz = dx / len;
      const hl = Math.hypot(hx, hz) || 1;
      v.position[0] += (hx / hl) * r.offset;
      v.position[2] += (hz / hl) * r.offset;
    }
    v.velocity[0] = (dx / len) * v.speed;
    v.velocity[1] = (dy / len) * v.speed;
    v.velocity[2] = (dz / len) * v.speed;
    // The tangent with its grade, signed by travel direction so a tram that
    // turned around at a terminus faces the way it is going. `velocity` cannot
    // carry this: it is the same vector times speed, and speed is zero at every
    // stop — which is most of the time a camera happens to be looking at one.
    v.forward[0] = (dx / len) * dir;
    v.forward[1] = (dy / len) * dir;
    v.forward[2] = (dz / len) * dir;
    const want2 = Math.atan2(dx * dir, dz * dir);
    v.heading += shortestAngle(v.heading, want2) * (1 - Math.exp(-5 * dt));
  }

  /** Free-floating air vehicle: wind advection, bob, climb, keep-out box. */
  private stepAir(
    v: Vehicle, i: number, dt: number,
    windX: number, windZ: number, wind: number, t: number,
  ): void {
    const ai = this.airSlotOf[i];
    if (ai < 0) { v.alive = false; return; }
    const ball = v.kind === 'balloon';

    // Balloons are light and couple to the wind almost immediately. Blimps are
    // heavy and lag it, which is exactly why they need a pilot.
    const couple = ball ? 0.94 : 0.36;
    const drag = ball ? 1.7 : 0.55;

    const tx = windX * couple;
    const tz = windZ * couple;
    // Bob: a slow vertical oscillation that dies down as the air picks up.
    const bobAmp = (ball ? 3.0 : 5.2) * (1 - clamp(wind / 26, 0, 0.55));
    const bob = Math.sin(t * 0.85 + this.airPhase[ai]) * bobAmp;
    const climb = ball ? clamp((this.airCeiling[ai] - v.position[1]) * 0.014, -1.4, 3.2) : 0;

    const kx = 1 - Math.exp(-drag * dt);
    v.velocity[0] += (tx - v.velocity[0]) * kx;
    v.velocity[2] += (tz - v.velocity[2]) * kx;
    v.velocity[1] += (climb + bob * 0.55 - v.velocity[1]) * (1 - Math.exp(-0.9 * dt));

    v.position[0] += v.velocity[0] * dt;
    v.position[1] += v.velocity[1] * dt;
    v.position[2] += v.velocity[2] * dt;

    // Keep-out: nothing floats over the downtown core below the roofline. The
    // exclusion is an axis-aligned box, escaped along the shallowest face.
    if (v.position[1] < KEEPOUT_TOP) {
      const x = v.position[0];
      const z = v.position[2];
      if (Math.abs(x) < KEEPOUT_HALF && Math.abs(z) < KEEPOUT_HALF) {
        const outX = KEEPOUT_HALF - Math.abs(x);
        const outZ = KEEPOUT_HALF - Math.abs(z);
        let nx = 0;
        let nz = 0;
        if (outX < outZ) nx = x >= 0 ? 1 : -1;
        else nz = z >= 0 ? 1 : -1;
        // Slide out rather than teleporting, but never linger inside.
        const push = Math.min(outX, outZ) + 40 * dt;
        v.position[0] += nx * Math.min(push, KEEPOUT_HALF);
        v.position[2] += nz * Math.min(push, KEEPOUT_HALF);
        const vn = v.velocity[0] * nx + v.velocity[2] * nz;
        if (vn < 0) {
          v.velocity[0] -= nx * vn;
          v.velocity[2] -= nz * vn;
        }
      }
    }

    // World box: reflect off it rather than sticking to the wall.
    if (v.position[0] > WORLD_HALF || v.position[0] < -WORLD_HALF) {
      v.position[0] = clamp(v.position[0], -WORLD_HALF, WORLD_HALF);
      v.velocity[0] *= -0.45;
    }
    if (v.position[2] > WORLD_HALF || v.position[2] < -WORLD_HALF) {
      v.position[2] = clamp(v.position[2], -WORLD_HALF, WORLD_HALF);
      v.velocity[2] *= -0.45;
    }
    if (v.position[1] < GROUND_Y + 12) {
      v.position[1] = GROUND_Y + 12;
      if (v.velocity[1] < 0) v.velocity[1] = 0;
    }
    // Altitude recycle: a balloon at its ceiling hands back to a fresh launch.
    const top = ball ? this.airCeiling[ai] : 900;
    if (v.position[1] > top) this.recycleAir(v, ai);

    v.speed = Math.hypot(v.velocity[0], v.velocity[1], v.velocity[2]);
    v.s = (v.s + dt * 0.02) % 1;
    v.heading = Math.atan2(v.velocity[0], v.velocity[2]);
    // A blimp pitches with its airspeed. Normalise from velocity rather than
    // heading so the nose follows the climb instead of staying flat.
    const sp = v.speed;
    if (sp > 1e-3) {
      v.forward[0] = v.velocity[0] / sp;
      v.forward[1] = v.velocity[1] / sp;
      v.forward[2] = v.velocity[2] / sp;
    }
  }

  /** O(n^2) over at most `MAX_AIR` bodies: cheap, and it reads as flocking. */
  private separateAir(dt: number): void {
    const n = this.air.length;
    for (let i = 0; i < n; i++) {
      const a = this.air[i];
      if (!a.alive) continue;
      const ra = a.kind === 'balloon' ? 30 : 58;
      for (let j = i + 1; j < n; j++) {
        const b = this.air[j];
        if (!b.alive) continue;
        const dx = a.position[0] - b.position[0];
        const dy = a.position[1] - b.position[1];
        const dz = a.position[2] - b.position[2];
        const minSep = ra + (b.kind === 'balloon' ? 30 : 58);
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > minSep * minSep || d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        const push = ((minSep - d) / minSep) * 7 * dt;
        const ux = (dx / d) * push;
        const uy = (dy / d) * push;
        const uz = (dz / d) * push;
        a.velocity[0] += ux; a.velocity[1] += uy; a.velocity[2] += uz;
        b.velocity[0] -= ux; b.velocity[1] -= uy; b.velocity[2] -= uz;
      }
    }
  }

  /** A balloon at its ceiling relaunches from a deterministic new spot. */
  private recycleAir(v: Vehicle, ai: number): void {
    const r = makeRng(
      (this.seed ^ Math.imul(ai + 11, 0x85ebca6b) ^ Math.imul(Math.floor(this.world.time), 131)) >>> 0,
    );
    const ang = r.range(0, Math.PI * 2);
    const rad = r.range(KEEPOUT_HALF + 140, WORLD_HALF * 0.88);
    v.position[0] = Math.cos(ang) * rad;
    v.position[2] = Math.sin(ang) * rad;
    v.position[1] = r.range(70, 240);
    v.velocity[0] = 0; v.velocity[1] = 0; v.velocity[2] = 0;
    this.airPhase[ai] = v.bobPhase = r.range(0, Math.PI * 2);
    this.airCeiling[ai] = v.position[1] + r.range(240, 540);
  }

  /** Hand-cycle: ride the nav graph node to node, then pick a fresh leg. */
  private stepCycle(i: number, v: Vehicle, dt: number): void {
    const nav = this.nav;
    if (!nav) { v.alive = false; return; }
    let next = this.cycNext[i];
    if (next < 0 || next >= nav.nodes.length) {
      this.chooseCycleLeg(i, v);
      return;
    }
    const node = nav.nodes[next];
    const dx = node.position[0] - v.position[0];
    const dz = node.position[2] - v.position[2];
    const dist = Math.hypot(dx, dz);
    if (dist < 4) {
      // Arrived. Step along the stored path, or pick a new destination.
      const off = ++this.cycPathOff[i];
      if (off + 1 < this.cycPathLen[i]) {
        next = this.cycPath[i * CYCLE_PATH_CAP + off + 1];
        this.cycNext[i] = next;
      } else {
        this.chooseCycleLeg(i, v);
      }
      return;
    }
    const k = 1 - Math.exp(-3.4 * dt);
    v.velocity[0] += (dx / dist * MAX_SPEED.cycle - v.velocity[0]) * k;
    v.velocity[2] += (dz / dist * MAX_SPEED.cycle - v.velocity[2]) * k;
    v.position[0] += v.velocity[0] * dt;
    v.position[2] += v.velocity[2] * dt;
    // Sit on the nav node's own height: some nodes are on bridges.
    v.position[1] += (node.position[1] + 0.5 - v.position[1]) * (1 - Math.exp(-6 * dt));
    v.position[0] = clamp(v.position[0], -WORLD_HALF, WORLD_HALF);
    v.position[2] = clamp(v.position[2], -WORLD_HALF, WORLD_HALF);
    v.speed = Math.hypot(v.velocity[0], v.velocity[2]);
    v.heading = Math.atan2(dx, dz);
    // A cyclist is on a street, so this is the street tangent rather than the
    // velocity: steering is smoothed separately and velocity lags a corner.
    if (dist > 1e-3) {
      v.forward[0] = dx / dist;
      v.forward[1] = 0;
      v.forward[2] = dz / dist;
    }
    if (++this.cycRides[i] > 900) { this.cycRides[i] = 0; this.chooseCycleLeg(i, v); }
  }

  /** A* between two nearby nodes; the result is walked one node at a time. */
  private chooseCycleLeg(i: number, v: Vehicle): void {
    const nav = this.nav;
    if (!nav || nav.nodes.length < 4) { v.alive = false; return; }
    const from = nav.nearestNode(v.position);
    if (from < 0) { v.alive = false; return; }
    const near = nav.nodesNear(v.position, 300);
    let to = from;
    if (near.length > 1) to = near[Math.floor(this.rng.next() * near.length) % near.length];
    if (to === from) to = from;
    const path = to === from ? [from] : nav.path(from, to);
    const n = Math.min(path.length, CYCLE_PATH_CAP);
    const base = i * CYCLE_PATH_CAP;
    for (let k = 0; k < n; k++) this.cycPath[base + k] = path[k];
    this.cycPathLen[i] = n;
    this.cycPathOff[i] = 0;
    if (n > 1) {
      this.cycNext[i] = path[1];
      v.alive = true;
    } else {
      // Isolated node: hop to a neighbour so the cycle is never parked.
      const links = nav.nodes[from].links;
      if (links.length === 0) { v.alive = false; return; }
      this.cycNext[i] = links[0];
      v.alive = true;
    }
  }

  // ------------------------------------------------------------ lights

  /**
   * Rebuild the clustered light list, keeping the `MAX_LIGHTS` most important
   * emitters. A partial selection over a fixed pool: no allocation, no `map`,
   * no spread.
   */
  private buildLights(world: WorldState): void {
    const pool = this.lightPool;
    const score = this.lightScore;
    // Lamplight only really reads at dusk and after, but the cluster is always
    // gathered so the renderer's binning is stable frame to frame.
    const dark = world.dayPhase < 0.62;
    let count = 0;

    for (let i = 0; i < this.vehicles.length; i++) {
      const v = this.vehicles[i];
      if (!v.alive) continue;
      const kind = v.kind;
      let importance: number;
      let radius: number;
      let cr = 1;
      let cg = 0.86;
      let cb = 0.62;
      if (kind === 'tram' || kind === 'trolley') {
        importance = 3.4; radius = 28;
        cr = 1.0; cg = 0.94; cb = 0.78;
      } else if (kind === 'cablecar') {
        importance = 3.0; radius = 24;
        cr = 1.0; cg = 0.82; cb = 0.55;
      } else if (kind === 'funicular') {
        importance = 1.4; radius = 14;
        cr = 0.9; cg = 0.7; cb = 0.5;
      } else if (kind === 'zipline') {
        // Trailing light: a streak strung out behind the rider.
        importance = 2.2; radius = 16;
        cr = 1.0; cg = 0.70; cb = 0.36;   // warm (D28); was cyan
      } else if (kind === 'balloon') {
        // Burner flare, and only while it is actually climbing.
        importance = 1.5 + (v.velocity[1] > 0.2 ? 1.5 : 0);
        radius = 36;
        cr = 1.0; cg = 0.6; cb = 0.22;
      } else if (kind === 'blimp') {
        importance = 1.3; radius = 20;
        cr = 1.0; cg = 0.85; cb = 0.62;   // warm (D28); was blue
      } else {
        importance = 1.1; radius = 12;
        cr = 1.0; cg = 0.96; cb = 0.86;
      }
      // By day the sun out-competes vehicle lights by two orders of magnitude;
      // the cluster is still filled so it does not pop in at dusk.
      if (dark) importance *= 1;
      else importance *= 0.3;

      if (count < MAX_LIGHTS) {
        this.writeLight(count, v, radius, cr, cg, cb, importance);
        count++;
        this.worstLight = 0;
        let worst = -Infinity;
        for (let k = 0; k < count; k++) {
          if (score[k] < worst) { worst = score[k]; this.worstLight = k; }
        }
        continue;
      }
      if (importance <= score[this.worstLight]) continue;
      this.writeLight(this.worstLight, v, radius, cr, cg, cb, importance);
      let worst = -Infinity;
      for (let k = 0; k < MAX_LIGHTS; k++) {
        if (score[k] < worst) { worst = score[k]; this.worstLight = k; }
      }
    }

    // Hand back a short view of the pool. The pool is reused; only the exposed
    // length changes, so the renderer sees a stable array.
    this.lights.length = 0;
    for (let i = 0; i < count; i++) this.lights.push(pool[i]);
  }

  private writeLight(
    slot: number, v: Vehicle,
    radius: number, cr: number, cg: number, cb: number, importance: number,
  ): void {
    const l = this.lightPool[slot];
    // Headlights sit at the nose; beacons hang below the envelope.
    const fwd = v.kind === 'tram' || v.kind === 'trolley' ? 7 * v.scale : 0;
    const lift = v.kind === 'blimp' ? -2.4 : v.kind === 'balloon' ? -1.6 : 1.8;
    l.pos[0] = v.position[0] + Math.sin(v.heading) * fwd;
    l.pos[1] = v.position[1] + lift;
    l.pos[2] = v.position[2] + Math.cos(v.heading) * fwd;
    l.radius = radius;
    l.color[0] = cr;
    l.color[1] = cg;
    l.color[2] = cb;
    l.intensity = importance;
    this.lightScore[slot] = importance;
  }
}

/** A vehicle is only in play once it has a finite position somewhere legal. */
const aiValid = (v: Vehicle): boolean =>
  Number.isFinite(v.position[0]) && Number.isFinite(v.position[1]) && Number.isFinite(v.position[2]);

/** Signed shortest angular difference from `a` to `b`, in (-pi, pi]. */
function shortestAngle(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------- drawing

/**
 * How a vehicle kind becomes a drawn instance.
 *
 * Six entity meshes exist (`entityMeshes`) for eight vehicle kinds, so two
 * kinds share and one is dropped. The share is on silhouette, not convenience:
 * a trolleybus and a funicular are both long boxes on a rail and read correctly
 * at either scale. A cycle has no mesh at all and is dropped — `rider` is 0.65 m
 * tall and would need scaling 2.6x to stand a person up, at which point it is
 * indistinguishable from a pedestrian and the frame would be showing a lie.
 */
export interface VehicleDrawSpec {
  /** `Renderer.entities` key. */
  mesh: VehicleMeshKey;
  /** Cull distance from the camera, metres. */
  range: number;
  /** Uniform scale on top of `Vehicle.scale`. */
  size: number;
  /** Metres the body drops below its line, for a suspended vehicle. */
  hang: number;
  /**
   * Instance emissive, written to `params.z`.
   *
   * The mesh carries its own emissive and `gbuffer.wgsl` takes
   * `max(v.emissive, params.z * tint.a)`, so this is a floor, not a second
   * convention. It exists because the meshes were authored for daylight:
   * `cableCar()` gives its window band `emissive: 0.9`, and against a night
   * facade that measured as a dark box — the ropeway is the brightest object in
   * the reference set and it was the dimmest thing in the frame. A tram's
   * headlights are already 8.0 in the mesh, so a low value here only lifts its
   * window band without touching them.
   */
  emissive: number;
}

/**
 * How far a body hangs below its cable, measured from the built meshes.
 *
 * `cableCar()` spans y -1.1..+2.3 and carries a hanger arm from +1.25 to +2.1
 * with a cap at +2.2, so its cable is at local +2.2 and the body belongs 2.2 m
 * below the line, not on it. `ziplineRider()` spans y -0.2..+0.4 with the head
 * at +0.30, so its cable is about half a metre above the body.
 */
export const CABLE_HANG = 2.2;
export const RIDER_HANG = 0.5;

/** Mesh keys, in the order their blocks are laid out in the instance buffer. */
export const VEHICLE_MESH_ORDER = ['tram', 'cablecar', 'rider', 'blimp', 'balloon'] as const;
export type VehicleMeshKey = typeof VEHICLE_MESH_ORDER[number];

/**
 * Cull distance per kind, and why each is what it is.
 *
 * Cable cars are the compositional subject of the whole reference set — aerial
 * ropeways strung between tall buildings are what the frames are *about* — so
 * they are held furthest of the ground transport, at 1100 m. Blimps are 60 m
 * envelopes at 180-340 m altitude and read as a shape at 1.5 km; balloons are
 * 20 m and stop at 900 m, where the envelope still has a silhouette rather than
 * being a dot. Trams are 18 m long and matter at street level; past 460 m a
 * tram is a smear on a road that is already a smear.
 */
export const VEHICLE_DRAW: Record<VehicleKind, VehicleDrawSpec> = {
  tram: { mesh: 'tram', range: 460, size: 1, hang: 0, emissive: 1.0 },
  trolley: { mesh: 'tram', range: 460, size: 0.78, hang: 0, emissive: 1.0 },
  funicular: { mesh: 'tram', range: 460, size: 0.62, hang: 0, emissive: 1.0 },
  cablecar: { mesh: 'cablecar', range: 1100, size: 1, hang: CABLE_HANG, emissive: 3.6 },
  zipline: { mesh: 'rider', range: 620, size: 1, hang: RIDER_HANG, emissive: 0 },
  blimp: { mesh: 'blimp', range: 1500, size: 1, hang: 0, emissive: 0 },
  balloon: { mesh: 'balloon', range: 900, size: 1, hang: 0, emissive: 0 },
  /** No mesh exists for a cycle. See {@link VehicleDrawSpec}. */
  cycle: { mesh: 'rider', range: 0, size: 1, hang: 0, emissive: 0 },
};

/** A contiguous run of one mesh's instances, and where it starts. */
export interface VehicleBlock {
  mesh: VehicleMeshKey;
  start: number;
  count: number;
}

/** Per-kind bookkeeping, so a frame can say what it dropped and why. */
export interface VehicleDrawStats {
  alive: number;
  drawn: number;
  culledFar: number;
  dropped: number;
}

export interface VehicleInstances {
  data: Float32Array;
  count: number;
  blocks: VehicleBlock[];
  stats: Record<VehicleKind, VehicleDrawStats>;
  /**
   * Steepest grade (|forward.y|) written, and the worst disagreement between
   * the forward column actually written and the sim's own tangent. Both are
   * measured here because this is the only place that holds both vectors: a
   * re-derivation in a test cannot tell a working grade from a plausible one.
   */
  maxGrade: number;
  maxGradeError: number;
}

const newDrawStats = (): VehicleDrawStats => ({ alive: 0, drawn: 0, culledFar: 0, dropped: 0 });

/** An instance buffer sized for the whole fleet, reusable every frame. */
export const makeVehicleInstances = (capacity: number): VehicleInstances => ({
  data: new Float32Array(capacity * INSTANCE_FLOATS),
  count: 0,
  blocks: [],
  stats: {
    tram: newDrawStats(), trolley: newDrawStats(), cablecar: newDrawStats(),
    funicular: newDrawStats(), zipline: newDrawStats(), blimp: newDrawStats(),
    balloon: newDrawStats(), cycle: newDrawStats(),
  },
  maxGrade: 0,
  maxGradeError: 0,
});

/**
 * Column-major model matrix from a unit forward.
 *
 * Columns are the basis vectors in world space: col0 = local +X (right),
 * col1 = +Y (up), col2 = +Z (forward). Every vehicle mesh is authored +Z
 * forward, and with a horizontal forward this reproduces the crowd's matrix
 * exactly — which is the point: both entity types share one buffer and one
 * layout (D18). The difference is that `forward` carries the grade, which is the
 * entire reason it is kept rather than re-derived from `heading`.
 *
 * `fallbackHeading` is for a vehicle with no usable tangent this frame. A blimp
 * stalled against its keep-out box has a zero velocity, and a zero forward would
 * collapse the basis into a singular matrix that draws nothing and reports
 * nothing.
 */
function writeModel(
  d: Float32Array, o: number, p: Vec3, fwd: Vec3, size: number, fallbackHeading: number,
): void {
  const l = Math.hypot(fwd[0], fwd[1], fwd[2]);
  const fx = l > 1e-4 ? fwd[0] / l : Math.sin(fallbackHeading);
  const fy = l > 1e-4 ? fwd[1] / l : 0;
  const fz = l > 1e-4 ? fwd[2] / l : Math.cos(fallbackHeading);
  // right = worldUp x forward. World up is the reference, not the vehicle's, so
  // a funicular descending a 30% grade still stands on its rails rather than
  // rolling with them.
  let rx = fz, rz = -fx;
  const rl = Math.hypot(rx, rz);
  if (rl > 1e-4) { rx /= rl; rz /= rl; } else { rx = 1; rz = 0; }
  const ux = fy * rz - fz * 0;
  const uy = fz * rx - fx * rz;
  const uz = fx * 0 - fy * rx;

  d[o] = rx * size; d[o + 1] = 0; d[o + 2] = rz * size; d[o + 3] = 0;
  d[o + 4] = ux * size; d[o + 5] = uy * size; d[o + 6] = uz * size; d[o + 7] = 0;
  d[o + 8] = fx * size; d[o + 9] = fy * size; d[o + 10] = fz * size; d[o + 11] = 0;
  d[o + 12] = p[0]; d[o + 13] = p[1]; d[o + 14] = p[2]; d[o + 15] = 1;
}

/**
 * Write this frame's vehicles into `out`: distance-culled, grouped by mesh,
 * one contiguous block per mesh so the renderer can draw each at its own
 * instance offset.
 *
 * Two passes over the fleet, which is ~200 vehicles: one to lay out the blocks,
 * one to write them. Nothing allocates after the first call. `out.data` must be
 * large enough for the fleet, which is fixed at construction.
 */
export function buildVehicleInstances(
  sim: TrafficSim, cam: Vec3, out: VehicleInstances,
): VehicleInstances {
  const mesh = VEHICLE_MESH_ORDER;
  const perMesh = [0, 0, 0, 0, 0];
  out.blocks.length = 0;
  out.maxGrade = 0;
  out.maxGradeError = 0;
  for (const k of Object.keys(out.stats) as VehicleKind[]) {
    const s = out.stats[k];
    s.alive = 0; s.drawn = 0; s.culledFar = 0; s.dropped = 0;
  }

  const inRange = (v: Vehicle): boolean => {
    const spec = VEHICLE_DRAW[v.kind];
    if (spec.range <= 0) return false;
    const dx = v.position[0] - cam[0], dy = v.position[1] - cam[1], dz = v.position[2] - cam[2];
    return dx * dx + dy * dy + dz * dz <= spec.range * spec.range;
  };

  // Pass 1: block sizes.
  for (const v of sim.vehicles) {
    if (!v.alive) continue;
    if (!inRange(v)) continue;
    perMesh[mesh.indexOf(VEHICLE_DRAW[v.kind].mesh)]++;
  }
  const cap = out.data.length / INSTANCE_FLOATS;
  let cursor = 0;
  for (let m = 0; m < mesh.length; m++) {
    const n = Math.min(perMesh[m], Math.max(0, cap - cursor));
    out.blocks.push({ mesh: mesh[m], start: cursor, count: n });
    perMesh[m] = n;
    cursor += n;
  }
  out.count = cursor;

  // Pass 2: the instances themselves.
  const write = [0, 0, 0, 0, 0];
  for (const v of sim.vehicles) {
    if (!v.alive) continue;
    const st = out.stats[v.kind];
    st.alive++;
    const spec = VEHICLE_DRAW[v.kind];
    if (spec.range <= 0) { st.dropped++; continue; }
    if (!inRange(v)) { st.culledFar++; continue; }
    const m = mesh.indexOf(spec.mesh);
    if (write[m] >= perMesh[m]) continue;
    const o = (out.blocks[m].start + write[m]) * INSTANCE_FLOATS;
    write[m]++;
    const hang = sim.suspensionOf(v) === 'catenary' ? spec.hang : 0;
    const px = v.position[0], py = v.position[1] - hang, pz = v.position[2];
    writeModel(out.data, o, [px, py, pz], v.forward, v.scale * spec.size, v.heading);
    out.data[o + 16] = v.color[0];
    out.data[o + 17] = v.color[1];
    out.data[o + 18] = v.color[2];
    out.data[o + 19] = 1;
    // MAT.PLAIN, as the crowd uses: these are small objects and the facade
    // synthesiser shades anything inside one 3.1 x 3.6 m window cell as glass.
    out.data[o + 20] = 9;
    out.data[o + 21] = v.kind === 'blimp' || v.kind === 'balloon' ? 0.7 : 0.42;
    out.data[o + 22] = spec.emissive;
    out.data[o + 23] = 0;
    st.drawn++;

    // Grade fidelity, measured here rather than asserted downstream: this is
    // the only scope that holds both the tangent the sim computed and the
    // column that went into the buffer. A tram on a 12% grade has to pitch.
    const scale = v.scale * spec.size;
    if (scale > 1e-4) {
      const gy = out.data[o + 9] / scale;
      if (Math.abs(gy) > out.maxGrade) out.maxGrade = Math.abs(gy);
      const l = Math.hypot(v.forward[0], v.forward[1], v.forward[2]);
      if (l > 1e-4) {
        const err = Math.abs(gy - v.forward[1] / l);
        if (err > out.maxGradeError) out.maxGradeError = err;
      }
    }
  }
  return out;
}
