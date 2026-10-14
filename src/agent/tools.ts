/**
 * Tool schema + executor for the conductor.
 *
 * This file is the ground truth for what the LLM can do to the world. The
 * executor owns *transitions*: weather eases toward a stored target, tours are
 * sequenced here, and events are pushed onto `world.events` where
 * `integrateWorld` ages them out.
 */

import { clamp, hexLinear, lerp, saturate, TAU, type Vec3 } from '../core/math';
import {
  defaultLens,
  defaultSun,
  defaultWeather,
  type EventKind,
  type Lens,
  type Precip,
  type SkyState,
  type Sun,
  type Weather,
  type WorldEvent,
  type WorldState,
} from '../core/state';
import { phaseOf } from '../sim/weather';

// ---------------------------------------------------------------- ports

export interface FlyToOpts {
  to?: Vec3;
  lookAt?: Vec3;
  roll?: number;
  fov?: number;
  seconds: number;
  easing: string;
}

/**
 * The slice of the camera the agent needs. The real camera module can satisfy
 * this without the agent importing it; `update` is optional and, if present,
 * is driven from `ToolExecutor.update` so null cameras can still interpolate.
 */
export interface CameraPort {
  position(): Vec3;
  flyTo(opts: FlyToOpts): void;
  cancelFlight(): void;
  isFlying(): boolean;
  /** Optional per-frame pump for cameras that interpolate internally. */
  update?(dt: number): void;
}

/** Inert camera used before the real camera lands — records the last flight. */
export class NullCameraPort implements CameraPort {
  private pos: Vec3 = [0, 40, 320];
  private from: Vec3 = [0, 40, 320];
  private to: Vec3 = [0, 40, 320];
  private fromLook: Vec3 = [0, 0, 0];
  private toLook: Vec3 = [0, 0, 0];
  private t = 0;
  private dur = 0;
  private rolling = false;
  /** Last flight requested; useful for tests and for the `/tour` UI chips. */
  lastFlight: FlyToOpts | null = null;

  position(): Vec3 {
    return [this.pos[0], this.pos[1], this.pos[2]];
  }

  flyTo(opts: FlyToOpts): void {
    this.lastFlight = opts;
    this.from = this.position();
    this.to = opts.to ? [opts.to[0], opts.to[1], opts.to[2]] : this.from;
    this.fromLook = this.toLook;
    this.toLook = opts.lookAt ? [opts.lookAt[0], opts.lookAt[1], opts.lookAt[2]] : this.fromLook;
    this.dur = Math.max(0, opts.seconds);
    this.t = 0;
    this.rolling = this.dur > 0;
    if (!this.rolling) this.pos = this.to;
  }

  cancelFlight(): void {
    this.rolling = false;
    this.dur = 0;
  }

  isFlying(): boolean {
    return this.rolling;
  }

  update(dt: number): void {
    if (!this.rolling) return;
    this.t = Math.min(this.dur, this.t + Math.max(0, dt));
    const k = this.dur > 0 ? easeInOut(this.t / this.dur) : 1;
    this.pos = [
      lerp(this.from[0], this.to[0], k),
      lerp(this.from[1], this.to[1], k),
      lerp(this.from[2], this.to[2], k),
    ];
    this.toLook = [
      lerp(this.fromLook[0], this.toLook[0], k),
      lerp(this.fromLook[1], this.toLook[1], k),
      lerp(this.fromLook[2], this.toLook[2], k),
    ];
    if (this.t >= this.dur) this.rolling = false;
  }
}

// ---------------------------------------------------------------- schema

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

/** Anthropic-style tool definition. */
export interface ToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

// ---------------------------------------------------------------- vocab

export const EVENT_KINDS: readonly EventKind[] = [
  'rain-burst', 'sunbreak', 'fog-bank', 'aurora', 'lightning',
  'bloom-festival', 'migration', 'market-rush', 'balloon-release',
  'blimp-parade', 'lantern-rise', 'spore-bloom',
  'monsoon', 'aurora-borealis', 'power-cycle', 'flash-flood',
];

export const SKY_STATES: readonly SkyState[] = [
  'clear', 'hazy', 'overcast', 'storm', 'dusk', 'dawn', 'bluehour', 'night',
];

export const PRECIP_KINDS: readonly Precip[] = [
  'none', 'rain', 'drizzle', 'snow', 'pollen', 'ash', 'spores',
];

export type TourPreset =
  | 'canyon' | 'skyline' | 'canal' | 'aerial' | 'ground' | 'vertical-drop' | 'orbit';

export const TOUR_PRESETS: readonly TourPreset[] = [
  'canyon', 'skyline', 'canal', 'aerial', 'ground', 'vertical-drop', 'orbit',
];

const EVENT_LABELS: Record<EventKind, string> = {
  'rain-burst': 'rain burst',
  sunbreak: 'sunbreak',
  'fog-bank': 'fog bank',
  aurora: 'aurora',
  lightning: 'lightning',
  'bloom-festival': 'bloom festival',
  migration: 'migration',
  'market-rush': 'market rush',
  'balloon-release': 'balloon release',
  'blimp-parade': 'blimp parade',
  'lantern-rise': 'lantern rise',
  'spore-bloom': 'spore bloom',
  monsoon: 'monsoon',
  'aurora-borealis': 'aurora borealis',
  'power-cycle': 'power cycle',
  'flash-flood': 'flash flood',
};

const enumOf = <T extends string>(v: string | undefined, allowed: readonly T[], d: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v.toLowerCase())
    ? (v.toLowerCase() as T)
    : d;

// ---------------------------------------------------------------- tours

export interface TourStep {
  to: Vec3;
  lookAt: Vec3;
  seconds: number;
  easing: string;
  roll?: number;
  fov?: number;
  lens?: Partial<Lens>;
}

export interface TourDef {
  preset: TourPreset;
  loop: boolean;
  steps: TourStep[];
  lens?: Partial<Lens>;
  weather?: Partial<Weather>;
}

/**
 * Authored tours. Coordinates assume the city is centred on the origin, ground
 * at y=0, canyon floors near y=6, canals near y=2 and towers up to ~y=420.
 */
const STATIC_TOURS: Record<Exclude<TourPreset, 'orbit'>, Omit<TourDef, 'preset'>> = {
  canyon: {
    loop: true,
    weather: { haze: 0.5, godRays: 0.75 },
    lens: { tiltShift: 0.55, focusWidth: 0.3, fov: 74 * (Math.PI / 180), warp: 0.28 },
    steps: [
      { to: [600, 46, 620], lookAt: [120, 300, 60], seconds: 5.5, easing: 'ease-in-out' },
      { to: [190, 9, 330], lookAt: [230, 150, 150], seconds: 7, easing: 'ease-in-out', fov: 82 * (Math.PI / 180) },
      { to: [40, 6, 320], lookAt: [280, 90, 190], seconds: 6, easing: 'linear' },
      { to: [-170, 12, 520], lookAt: [-420, 320, -80], seconds: 8, easing: 'ease-in-out', roll: -0.12 },
    ],
  },
  skyline: {
    loop: true,
    weather: { cloudCover: 0.45, aerialHaze: 0.55 },
    lens: { tiltShift: 0.7, focusWidth: 0.2, fov: 64 * (Math.PI / 180) },
    steps: [
      { to: [900, 120, 1400], lookAt: [0, 200, 0], seconds: 5, easing: 'ease-in-out', fov: 72 * (Math.PI / 180) },
      { to: [1400, 380, 1900], lookAt: [0, 180, 0], seconds: 8, easing: 'ease-in-out' },
      { to: [700, 620, 2200], lookAt: [0, 120, 0], seconds: 8, easing: 'linear', fov: 56 * (Math.PI / 180) },
      { to: [-900, 300, 1600], lookAt: [0, 160, -200], seconds: 9, easing: 'ease-in-out', fov: 68 * (Math.PI / 180), roll: 0.1 },
    ],
  },
  canal: {
    loop: true,
    weather: { haze: 0.42, wetness: 0.55, motes: 0.5 },
    lens: { fov: 46 * (Math.PI / 180), tiltShift: 0.4, focusWidth: 0.5, saturation: 1.25 },
    steps: [
      { to: [300, 2.5, 200], lookAt: [900, 5, 260], seconds: 5, easing: 'ease-in-out' },
      { to: [900, 3, 260], lookAt: [1400, 6, 340], seconds: 7, easing: 'linear' },
      { to: [1400, 2.5, 340], lookAt: [600, 8, 120], seconds: 8, easing: 'ease-in-out' },
      { to: [640, 3.5, 120], lookAt: [180, 10, -160], seconds: 7, easing: 'linear', roll: 0.06 },
    ],
  },
  aerial: {
    loop: true,
    weather: { cloudCover: 0.5, aerialHaze: 0.7 },
    lens: { fov: 60 * (Math.PI / 180), horizonBend: 0.34, tiltShift: 0.6, focusWidth: 0.24 },
    steps: [
      { to: [300, 1400, 700], lookAt: [0, 0, 0], seconds: 6, easing: 'ease-in-out' },
      { to: [-200, 900, -300], lookAt: [0, 40, 0], seconds: 7, easing: 'linear', fov: 66 * (Math.PI / 180) },
      { to: [-500, 480, 500], lookAt: [0, 80, 0], seconds: 7, easing: 'ease-in-out' },
      { to: [200, 1050, -200], lookAt: [0, 20, 0], seconds: 8, easing: 'ease-in-out', roll: 0.14 },
    ],
  },
  ground: {
    loop: true,
    weather: { haze: 0.3, wetness: 0.15 },
    lens: { fov: 52 * (Math.PI / 180), tiltShift: 0.78, bokeh: 0.82, focusWidth: 0.15, saturation: 1.18 },
    steps: [
      { to: [80, 1.9, 80], lookAt: [0, 3, -140], seconds: 4, easing: 'ease-in-out' },
      { to: [0, 1.9, -140], lookAt: [-60, 4, -320], seconds: 5, easing: 'linear' },
      { to: [-60, 2.1, -320], lookAt: [80, 6, -600], seconds: 6, easing: 'ease-in-out', roll: -0.05 },
      { to: [40, 1.9, -560], lookAt: [140, 8, -820], seconds: 6, easing: 'linear' },
    ],
  },
  'vertical-drop': {
    loop: true,
    weather: { cloudCover: 0.55, godRays: 0.7, haze: 0.35 },
    lens: { warp: 0.5, speedFov: 0.55, breathe: 0.5, distortion: 0.12 },
    steps: [
      { to: [240, 900, 240], lookAt: [180, 0, 180], seconds: 2.5, easing: 'ease-in-out', fov: 74 * (Math.PI / 180) },
      { to: [200, 120, 200], lookAt: [188, 0, 188], seconds: 3, easing: 'linear', fov: 86 * (Math.PI / 180) },
      { to: [190, 6, 190], lookAt: [180, 2, 180], seconds: 3, easing: 'ease-in-out', fov: 96 * (Math.PI / 180) },
      { to: [186, 1.9, 186], lookAt: [160, 24, 150], seconds: 3.5, easing: 'ease-in-out', fov: 70 * (Math.PI / 180) },
    ],
  },
};

function orbitTour(from: Vec3): TourDef {
  const r = clamp(Math.max(90, Math.hypot(from[0], from[2]) * 0.7), 90, 900);
  const y = clamp(from[1], 8, 320);
  const steps: TourStep[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU;
    steps.push({
      to: [Math.cos(a) * r, y, Math.sin(a) * r],
      lookAt: [from[0] * 0.4, clamp(from[1], 0, 200), from[2] * 0.4],
      seconds: 4.5,
      easing: 'ease-in-out',
      fov: 60 * (Math.PI / 180),
    });
  }
  return { preset: 'orbit', loop: true, steps, lens: { fov: 60 * (Math.PI / 180) } };
}

/** Build a tour definition, resolving the parametric `orbit` preset. */
export function buildTour(preset: TourPreset, from: Vec3 = [0, 40, 320]): TourDef | null {
  if (preset === 'orbit') return orbitTour(from);
  const t = STATIC_TOURS[preset];
  return t ? { preset, ...t, steps: t.steps.map((s) => ({ ...s })) } : null;
}

// ---------------------------------------------------------------- phases

export type PhaseName = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'dusk' | 'bluehour' | 'night';

export const PHASES: readonly PhaseName[] = [
  'dawn', 'morning', 'noon', 'afternoon', 'dusk', 'bluehour', 'night',
];

interface PhaseDef {
  azimuth: number;
  elevation: number;
  color: string;
  intensity: number;
  ambient: string;
  ambientIntensity: number;
  bloom: number;
}

/**
 * Azimuths are chosen so `integrateWorld`'s `sin(az)*1.15-0.06` elevation
 * settles exactly on the authored value — set_time never fights the integrator.
 */
const PHASE_LOOK: Record<PhaseName, PhaseDef> = {
  dawn: { azimuth: 0.06, elevation: 0.009, color: '#ffb37a', intensity: 2.6, ambient: '#4a5f8c', ambientIntensity: 0.55, bloom: 0.72 },
  morning: { azimuth: 0.4115, elevation: 0.4, color: '#fff0d4', intensity: 3.6, ambient: '#6e93c4', ambientIntensity: 0.55, bloom: 0.45 },
  noon: { azimuth: 1.5708, elevation: 1.09, color: '#fffaf0', intensity: 4.6, ambient: '#8fb4dd', ambientIntensity: 0.6, bloom: 0.34 },
  afternoon: { azimuth: 2.6722, elevation: 0.46, color: '#ffe9c0', intensity: 3.9, ambient: '#7fa4cc', ambientIntensity: 0.55, bloom: 0.42 },
  dusk: { azimuth: 3.0816, elevation: 0.009, color: '#ff8f52', intensity: 2.4, ambient: '#3d4d86', ambientIntensity: 0.5, bloom: 0.82 },
  bluehour: { azimuth: 3.1851, elevation: -0.11, color: '#5a78d8', intensity: 0.9, ambient: '#2b4a9a', ambientIntensity: 0.8, bloom: 0.76 },
  night: { azimuth: 3.49, elevation: -0.45, color: '#5f74c8', intensity: 0.45, ambient: '#1d2547', ambientIntensity: 0.35, bloom: 0.58 },
};

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

// ---------------------------------------------------------------- helpers

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** True when the caller actually supplied a value (so `0` is not treated as absent). */
const given = (o: Record<string, unknown>, k: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null;

function num(o: Record<string, unknown>, k: string, fallback: number): number {
  return given(o, k) && isNum(o[k]) ? (o[k] as number) : fallback;
}

function vec3(v: unknown, fallback: Vec3): Vec3 {
  if (Array.isArray(v) && v.length >= 3 && v.every(isNum)) return [v[0] as number, v[1] as number, v[2] as number];
  return fallback;
}

function color(v: unknown, fallback: Vec3): Vec3 {
  if (typeof v === 'string') {
    try { return hexLinear(v); } catch { return fallback; }
  }
  return vec3(v, fallback);
}

function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (isNum(x)) out[k] = x;
  }
  return out;
}

/**
 * Name the current part of the day. One source: this used to be a private copy
 * of `phaseOf` that had drifted (an `az < PI` rising test where the director
 * uses the half-turn around sunrise), so the conductor and the director could
 * name the same sky differently.
 */
export const phaseNameOf = (w: WorldState): PhaseName => phaseOf(w) as PhaseName;

const r2 = (x: number): string => String(Math.round(x * 100) / 100);

/**
 * Compact snapshot of the world for LLM grounding. Hard-capped so it never
 * eats the context window — under ~600 characters.
 */
export function describeWorld(w: WorldState): string {
  const wx = w.weather;
  const l = w.lens;
  const s = w.sun;
  const ev = w.events
    .slice(0, 3)
    .map((e) => `${e.kind}:${e.ttl === Infinity ? 'inf' : e.ttl.toFixed(0) + 's'}@${e.intensity.toFixed(2)}`)
    .join(' ');
  const lines = [
    `t=${w.time.toFixed(0)}s phase=${phaseNameOf(w)}(${w.dayPhase.toFixed(2)}) scale=${r2(w.timeScale)}${w.paused ? ' PAUSED' : ''}`,
    `sky=${wx.sky} precip=${wx.precip} cloud=${r2(wx.cloudCover)} storm=${r2(wx.storminess)} haze=${r2(wx.haze)} wind=${wx.windSpeed.toFixed(1)} wet=${r2(wx.wetness)} ray=${r2(wx.godRays)} mote=${r2(wx.motes)} bloom=${r2(wx.bloomStrength)} scatter=${r2(wx.scatter)}`,
    `sun az=${r2(s.azimuth)} el=${r2(s.elevation)} i=${s.intensity.toFixed(1)} day=${s.dayLength}`,
    `lens fov=${Math.round(l.fov * 57.2958)}deg roll=${r2(l.roll)} tilt=${r2(l.tiltShift)} bokeh=${r2(l.bokeh)} warp=${r2(l.warp)} exp=${r2(l.exposure)} sat=${r2(l.saturation)}`,
    `crowd=${w.crowds.count}/${r2(w.crowds.density)}/${r2(w.crowds.agitation)} traffic=${w.traffic.count}/${r2(w.traffic.density)}`,
    ev ? `events=${ev}` : 'events=none',
  ];
  const out = lines.join('\n');
  return out.length <= 600 ? out : out.slice(0, 597) + '...';
}

// ---------------------------------------------------------------- executor

const WEATHER_NUM_KEYS = [
  'cloudCover', 'storminess', 'haze', 'hazeFalloff',
  'windSpeed', 'wetness', 'aerialHaze', 'godRays', 'motes', 'bloomStrength', 'scatter',
] as const satisfies readonly (keyof Weather)[];

const LENS_KEYS = [
  'fov', 'roll', 'tiltShift', 'focusCenter', 'focusWidth', 'bokeh', 'distortion',
  'chroma', 'vignette', 'grain', 'bloom', 'exposure', 'saturation', 'warp',
  'breathe', 'speedFov', 'horizonBend',
] as const satisfies readonly (keyof Lens)[];

export class ToolExecutor {
  private readonly worldRef: WorldState;
  private readonly camRef: CameraPort;
  /** Weather is eased toward this, never snapped. */
  private weatherTarget: Weather;
  private lensTarget: Partial<Lens> = {};
  private tour: { def: TourDef; i: number; t: number } | null = null;
  private nextEventId = 1;
  /** Fraction of the weather gap closed per second. Lower = slower. */
  weatherEase = 0.6;
  lensEase = 3.2;

  constructor(world: WorldState, cam: CameraPort) {
    this.worldRef = world;
    this.camRef = cam;
    this.weatherTarget = { ...world.weather };
  }

  get world(): WorldState { return this.worldRef; }
  get camera(): CameraPort { return this.camRef; }
  get activeTour(): TourPreset | null { return this.tour?.def.preset ?? null; }

  // ------------------------------------------------------------ per-frame

  /**
   * Advance eased state. The host loop must call this once per frame with the
   * real `dt`; without it, weather and tours never progress.
   */
  update(dt: number): void {
    const d = Math.max(0, dt);
    this.easeWeather(d);
    this.easeLens(d);
    this.stepTour(d);
    this.camRef.update?.(d);
  }

  private easeWeather(dt: number): void {
    const t = this.weatherTarget;
    const w = this.worldRef.weather;
    if (dt <= 0) return;
    // Rain implies wet streets. Applied to the target before easing so the
    // streets are already darkening on the same frame the sky turns.
    if (t.precip === 'rain' || t.precip === 'drizzle') t.wetness = Math.max(t.wetness, 0.75);
    const k = 1 - Math.exp(-this.weatherEase * dt);
    for (const key of WEATHER_NUM_KEYS) w[key] = lerp(w[key], t[key], k);
    // windDir wraps: take the short way round.
    const dd = ((t.windDir - w.windDir + Math.PI * 3) % TAU) - Math.PI;
    w.windDir = (w.windDir + dd * k + TAU) % TAU;
    if (w.sky !== t.sky) w.sky = t.sky;
    if (w.precip !== t.precip) w.precip = t.precip;
  }

  private easeLens(dt: number): void {
    const l = this.worldRef.lens;
    const keys = Object.keys(this.lensTarget) as (keyof Lens)[];
    if (keys.length === 0 || dt <= 0) return;
    const k = 1 - Math.exp(-this.lensEase * dt);
    for (const key of keys) {
      const to = this.lensTarget[key];
      if (typeof to !== 'number' || typeof l[key] !== 'number') continue;
      (l as unknown as Record<string, number>)[key] = (l[key] as number) + ((to as number) - (l[key] as number)) * k;
    }
  }

  /** Fast-forward all easing — used by tests and the capture harness. */
  settle(seconds: number, dt = 1 / 60): void {
    for (let t = 0; t < seconds; t += dt) this.update(dt);
  }

  // ------------------------------------------------------------ tours

  cancelTour(): void {
    this.tour = null;
  }

  private stepTour(dt: number): void {
    const tr = this.tour;
    if (!tr || dt <= 0) return;
    const step = tr.def.steps[tr.i];
    tr.t += dt;
    if (tr.t < step.seconds) return;
    tr.t -= step.seconds;
    tr.i += 1;
    if (tr.i >= tr.def.steps.length) {
      if (!tr.def.loop) { this.tour = null; return; }
      tr.i = 0;
    }
    this.fireStep(tr.def, tr.i);
  }

  private fireStep(def: TourDef, i: number): void {
    const s = def.steps[i];
    if (s.lens) this.pushLens(s.lens);
    this.camRef.flyTo({
      to: s.to,
      lookAt: s.lookAt,
      seconds: s.seconds,
      easing: s.easing,
      ...(s.roll !== undefined ? { roll: s.roll } : {}),
      ...(s.fov !== undefined ? { fov: s.fov } : {}),
    });
  }

  // ------------------------------------------------------------ lens target

  private pushLens(patch: Partial<Lens>): void {
    const t = this.lensTarget as Record<string, number>;
    for (const [k, v] of Object.entries(patch)) if (isNum(v)) t[k] = v;
  }

  // ------------------------------------------------------------ event ids

  private allocEventId(): number {
    let max = this.nextEventId - 1;
    for (const e of this.worldRef.events) if (e.id > max) max = e.id;
    this.nextEventId = max + 1;
    return max + 1;
  }

  /** Push a durable event; `integrateWorld` ages and eventually removes it. */
  private pushEvent(kind: EventKind, ttl: number, at: Vec3, radius: number, params: Record<string, number>): WorldEvent {
    const total = Number.isFinite(ttl) ? Math.max(0.1, ttl) : Infinity;
    const e: WorldEvent = {
      id: this.allocEventId(),
      kind,
      ttl: total,
      totalTtl: total,
      intensity: 0,
      at,
      radius,
      params,
      label: EVENT_LABELS[kind],
    };
    this.worldRef.events.push(e);
    return e;
  }

  // ------------------------------------------------------------ tool list

  /** Every tool the conductor may call. */
  list(): ToolDef[] {
    return [
      {
        name: 'set_weather',
        description:
          'Set the atmosphere. Every field is optional and 0..1 except windSpeed (m/s) and windDir (radians). Transitions are eased over ~2s, never snapped. Pass only what should change.',
        input_schema: {
          type: 'object',
          properties: {
            sky: { type: 'string', enum: [...SKY_STATES], description: 'Overall sky mood.' },
            precip: { type: 'string', enum: [...PRECIP_KINDS], description: 'Falling particles. Rain implies wetness.' },
            cloudCover: { type: 'number', minimum: 0, maximum: 1 },
            storminess: { type: 'number', minimum: 0, maximum: 1, description: 'Storm cell intensity — drives lightning, wind and turbulence.' },
            haze: { type: 'number', minimum: 0, maximum: 1, description: 'Ground/canyon fog density.' },
            hazeFalloff: { type: 'number', description: 'Height falloff exponent for the fog. Higher = denser near the floor.' },
            windSpeed: { type: 'number', description: 'm/s. Drives rain slant, sway, cable drift.' },
            windDir: { type: 'number', description: 'Radians; direction the wind blows toward.' },
            wetness: { type: 'number', minimum: 0, maximum: 1, description: 'Darkens albedo, adds specular and puddles.' },
            aerialHaze: { type: 'number', minimum: 0, maximum: 1, description: 'Distance fog / aerial perspective.' },
            godRays: { type: 'number', minimum: 0, maximum: 1, description: 'Additive light shafts. Needs cloud or mist to read.' },
            motes: { type: 'number', minimum: 0, maximum: 1, description: 'Drifting pollen/spore/dust particles.' },
            bloomStrength: { type: 'number', minimum: 0, maximum: 1, description: 'Far-plane kill + silhouette softening.' },
            scatter: { type: 'number', minimum: 0, maximum: 1, description: 'Rainbow / chromatic sky scattering.' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'set_time',
        description:
          'Jump the sun to a part of the day. Also sets the authored light colour and intensity for that hour so the look reads immediately.',
        input_schema: {
          type: 'object',
          properties: {
            phase: { type: 'string', enum: [...PHASES] },
            dayLengthSeconds: { type: 'number', description: 'Seconds per full day. Ignored while frozen.' },
            freeze: { type: 'boolean', description: 'true = hold the sun still (dayLength 0).' },
            sky: { type: 'string', enum: [...SKY_STATES], description: 'Optional sky mood to pair with the hour.' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'set_sun',
        description:
          'Direct control of the key light. Angles are DEGREES (azimuth 0..360 around +Y, elevation -90..90).',
        input_schema: {
          type: 'object',
          properties: {
            azimuth: { type: 'number', description: 'Degrees around Y. 0 = +X.' },
            elevation: { type: 'number', description: 'Degrees above the horizon. Negative = night.' },
            intensity: { type: 'number', minimum: 0 },
            color: {
              description: 'Hex "#rrggbb" or linear [r,g,b].',
              anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }],
            },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'move_camera',
        description:
          'Timed, interruptible camera flight. Give either an absolute `to`, or a `direction` (unit vector) with `speed` and `seconds`. Any new flight replaces the current one.',
        input_schema: {
          type: 'object',
          properties: {
            to: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Absolute target position.' },
            direction: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Direction of travel, e.g. [0,-1,0] to descend.' },
            relative: { type: 'boolean', description: 'Treat `to`/`direction` as an offset from the current position.' },
            speed: { type: 'number', description: 'm/s, used with `direction`.' },
            lookAt: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            roll: { type: 'number', description: 'Radians of bank.' },
            fov: { type: 'number', description: 'Radians. Values > 3.3 are read as degrees.' },
            seconds: { type: 'number', description: 'Flight duration. Default 3.' },
            easing: { type: 'string', enum: ['linear', 'ease-in-out', 'spring'] },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'look_at',
        description: 'Aim the camera at a point without moving it. Optionally change FOV at the same time.',
        input_schema: {
          type: 'object',
          properties: {
            point: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            seconds: { type: 'number', description: 'Turn duration. Default 2.' },
            fov: { type: 'number', description: 'Radians. Values > 3.3 are read as degrees.' },
          },
          required: ['point'],
          additionalProperties: false,
        },
      },
      {
        name: 'set_lens',
        description:
          'The dreamlike distortion knobs. All optional, all eased. fov/roll are radians (values > 3.3 / |3.2| are read as degrees). This is where the image stops being real.',
        input_schema: {
          type: 'object',
          properties: {
            fov: { type: 'number', description: 'Vertical FOV, radians. Wide = vertigo, narrow = miniature.' },
            roll: { type: 'number', description: 'Radians of horizon bank.' },
            tiltShift: { type: 'number', minimum: 0, maximum: 1, description: 'Blur inside the focus band — the miniature signature.' },
            focusCenter: { type: 'number', description: 'Band centre in NDC-y, -1..1.' },
            focusWidth: { type: 'number', description: 'Band half-height 0..1. Smaller = stronger miniature.' },
            bokeh: { type: 'number', minimum: 0, maximum: 1 },
            distortion: { type: 'number', description: 'Barrel/pincushion. Positive = bulge.' },
            chroma: { type: 'number', minimum: 0, maximum: 1, description: 'Chromatic aberration at the edges.' },
            vignette: { type: 'number', minimum: 0, maximum: 1 },
            grain: { type: 'number', minimum: 0, maximum: 1 },
            bloom: { type: 'number', minimum: 0, maximum: 1, description: 'Halation around highlights.' },
            exposure: { type: 'number', description: 'Stops, applied before tonemap.' },
            saturation: { type: 'number', description: 'Post-tonemap multiplier.' },
            warp: { type: 'number', minimum: 0, maximum: 1, description: 'Screen-space wobble — the impossible-geometry tell.' },
            breathe: { type: 'number', minimum: 0, maximum: 1, description: 'Slow FOV oscillation.' },
            speedFov: { type: 'number', minimum: 0, maximum: 1, description: 'Extra FOV swing driven by velocity.' },
            horizonBend: { type: 'number', minimum: 0, maximum: 1, description: 'Non-linear horizon curve — sells a toy city.' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'trigger_event',
        description:
          'Start a world event. It ramps in, lives for `ttl` seconds and ramps out; ttl Infinity makes it persistent.',
        input_schema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: [...EVENT_KINDS] },
            ttl: { type: 'number', description: 'Seconds. Infinity for persistent.' },
            at: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'World position.' },
            radius: { type: 'number', description: 'Localised effect radius, metres.' },
            params: { type: 'object', description: 'Free-form numeric params read by the handling system.' },
          },
          required: ['kind'],
          additionalProperties: false,
        },
      },
      {
        name: 'set_crowd',
        description: 'Steer pedestrian population and mood.',
        input_schema: {
          type: 'object',
          properties: {
            count: { type: 'number', minimum: 0 },
            density: { type: 'number', minimum: 0, maximum: 1 },
            agitation: { type: 'number', minimum: 0, maximum: 1, description: '0 = strolling, 1 = panic.' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'set_traffic',
        description: 'Steer tram/car/rail traffic volume.',
        input_schema: {
          type: 'object',
          properties: {
            count: { type: 'number', minimum: 0 },
            density: { type: 'number', minimum: 0, maximum: 1 },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'set_time_scale',
        description: 'Global simulation rate multiplier. 1 = real time, 0 = frozen, 4 = frantic.',
        input_schema: {
          type: 'object',
          properties: { scale: { type: 'number', minimum: 0, maximum: 20 } },
          required: ['scale'],
          additionalProperties: false,
        },
      },
      {
        name: 'describe_world',
        description: 'Return a compact snapshot of the current world so you can ground your next move. Call this before answering any question about what is currently on screen.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      {
        name: 'tour',
        description:
          'Run an authored cinematic camera tour. Loops until interrupted by another camera move. Use this instead of hand-rolled flyTo for anything recognisable.',
        input_schema: {
          type: 'object',
          properties: { preset: { type: 'string', enum: [...TOUR_PRESETS] } },
          required: ['preset'],
          additionalProperties: false,
        },
      },
      {
        name: 'set_color_grade',
        description: 'Push the overall colour of the image — the district key colour. Distinct from set_lens geometry effects.',
        input_schema: {
          type: 'object',
          properties: {
            tint: { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3, description: 'Per-channel gain, e.g. [1.1, 0.95, 1.2].' },
            exposure: { type: 'number', description: 'Stops.' },
            saturation: { type: 'number' },
          },
          additionalProperties: false,
        },
      },
      {
        name: 'reset_world',
        description: 'Return weather, sun, lens and crowds to authored defaults. Does not touch the camera.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
    ];
  }

  /** Names of every tool, for validation and UI chips. */
  toolNames(): string[] {
    return this.list().map((t) => t.name);
  }

  // ------------------------------------------------------------ dispatch

  /**
   * Execute one tool call. Never throws — failures come back as an `ERROR:`
   * string so the conversation can recover.
   */
  async run(name: string, rawArgs: Record<string, unknown>): Promise<string> {
    const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
    try {
      switch (name) {
        case 'set_weather': return this.tSetWeather(args);
        case 'set_time': return this.tSetTime(args);
        case 'set_sun': return this.tSetSun(args);
        case 'move_camera': return this.tMoveCamera(args);
        case 'look_at': return this.tLookAt(args);
        case 'set_lens': return this.tSetLens(args);
        case 'trigger_event': return this.tTriggerEvent(args);
        case 'set_crowd': return this.tSetCrowd(args);
        case 'set_traffic': return this.tSetTraffic(args);
        case 'set_time_scale': return this.tSetTimeScale(args);
        case 'describe_world': return describeWorld(this.worldRef);
        case 'tour': return this.tTour(args);
        case 'set_color_grade': return this.tColorGrade(args);
        case 'reset_world': return this.tReset();
        default: return `ERROR: unknown tool "${name}". Available: ${this.toolNames().join(', ')}`;
      }
    } catch (err) {
      return `ERROR: ${name} failed — ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // ------------------------------------------------------------ handlers

  private tSetWeather(a: Record<string, unknown>): string {
    const t = this.weatherTarget;
    if (given(a, 'sky')) t.sky = enumOf(a.sky as string, SKY_STATES, t.sky);
    if (given(a, 'precip')) t.precip = enumOf(a.precip as string, PRECIP_KINDS, t.precip);
    const changed: string[] = [];
    for (const key of WEATHER_NUM_KEYS) {
      if (!given(a, key)) continue;
      const v = a[key];
      if (!isNum(v)) continue;
      const bounded = key === 'windSpeed' ? clamp(v, 0, 120) : saturate(v);
      t[key] = bounded;
      changed.push(`${key}=${r2(bounded)}`);
    }
    return changed.length
      ? `weather easing -> sky=${t.sky} ${t.precip !== 'none' ? t.precip + ' ' : ''}${changed.join(' ')}`
      : `weather unchanged (sky=${t.sky} precip=${t.precip})`;
  }

  private tSetTime(a: Record<string, unknown>): string {
    const w = this.worldRef;
    const notes: string[] = [];
    if (given(a, 'freeze')) {
      const freeze = a.freeze === true || a.freeze === 'true';
      w.sun.dayLength = freeze ? 0 : Math.max(1, num(a, 'dayLengthSeconds', 900));
      notes.push(freeze ? 'time frozen' : `day=${w.sun.dayLength}s`);
    } else if (given(a, 'dayLengthSeconds')) {
      w.sun.dayLength = Math.max(0, num(a, 'dayLengthSeconds', w.sun.dayLength));
      notes.push(`day=${w.sun.dayLength}s`);
    }
    if (given(a, 'phase')) {
      const name = enumOf(a.phase as string, PHASES, phaseNameOf(w));
      const look = PHASE_LOOK[name];
      w.sun.azimuth = look.azimuth;
      w.sun.elevation = look.elevation;
      w.sun.color = hexLinear(look.color);
      w.sun.intensity = look.intensity;
      w.sun.ambient = hexLinear(look.ambient);
      w.sun.ambientIntensity = look.ambientIntensity;
      this.weatherTarget.bloomStrength = look.bloom;
      this.lensTarget.bloom = look.bloom;
      w.dayPhase = saturate((look.elevation + 0.35) / 1.5);
      if (given(a, 'sky')) this.weatherTarget.sky = enumOf(a.sky as string, SKY_STATES, this.weatherTarget.sky);
      notes.push(`${name} (az=${r2(look.azimuth)} el=${r2(look.elevation)} i=${look.intensity})`);
    }
    return notes.length ? `time set: ${notes.join(', ')}` : 'time unchanged';
  }

  private tSetSun(a: Record<string, unknown>): string {
    const s: Sun = this.worldRef.sun;
    if (given(a, 'azimuth') && isNum(a.azimuth)) s.azimuth = ((a.azimuth * (Math.PI / 180)) % TAU + TAU) % TAU;
    if (given(a, 'elevation') && isNum(a.elevation)) s.elevation = clamp(a.elevation * (Math.PI / 180), -1.5708, 1.5708);
    if (given(a, 'intensity') && isNum(a.intensity)) s.intensity = Math.max(0, a.intensity);
    if (given(a, 'color')) s.color = color(a.color, s.color);
    this.worldRef.dayPhase = saturate((s.elevation + 0.35) / 1.5);
    return `sun az=${r2(s.azimuth)}rad el=${r2(s.elevation)}rad i=${s.intensity.toFixed(2)} color=[${s.color.map(r2).join(',')}]`;
  }

  private tMoveCamera(a: Record<string, unknown>): string {
    this.cancelTour();
    const here = this.camRef.position();
    const seconds = Math.max(0.05, num(a, 'seconds', 3));
    const easing = enumOf(a.easing as string, ['linear', 'ease-in-out', 'spring'] as const, 'ease-in-out');
    const relative = a.relative === true || a.relative === 'true';
    let to: Vec3 | undefined;
    if (given(a, 'to')) {
      const t = vec3(a.to, here);
      to = relative ? [here[0] + t[0], here[1] + t[1], here[2] + t[2]] : t;
    } else if (given(a, 'direction')) {
      const d = vec3(a.direction, [0, 0, 0]);
      const speed = num(a, 'speed', 40);
      to = [here[0] + d[0] * speed * seconds, here[1] + d[1] * speed * seconds, here[2] + d[2] * speed * seconds];
    }
    this.camRef.cancelFlight();
    const lookAt = given(a, 'lookAt') ? vec3(a.lookAt, here) : undefined;
    const roll = given(a, 'roll') && isNum(a.roll) ? num(a, 'roll', 0) : undefined;
    const fov = given(a, 'fov') && isNum(a.fov) ? readAngle(a.fov) : undefined;
    this.camRef.flyTo({
      ...(to ? { to } : {}),
      ...(lookAt ? { lookAt } : {}),
      ...(roll !== undefined ? { roll } : {}),
      ...(fov !== undefined ? { fov } : {}),
      seconds,
      easing,
    });
    return `camera flight ${seconds}s ${easing} to [${(to ?? here).map((n) => Math.round(n)).join(', ')}]`;
  }

  private tLookAt(a: Record<string, unknown>): string {
    this.cancelTour();
    const here = this.camRef.position();
    const point = vec3(a.point, here);
    const seconds = Math.max(0.05, num(a, 'seconds', 2));
    const fov = given(a, 'fov') && isNum(a.fov) ? readAngle(a.fov) : undefined;
    this.camRef.cancelFlight();
    this.camRef.flyTo({ lookAt: point, seconds, easing: 'ease-in-out', ...(fov !== undefined ? { fov } : {}) });
    return `looking at [${point.map((n) => Math.round(n)).join(', ')}]`;
  }

  private tSetLens(a: Record<string, unknown>): string {
    const patch: Partial<Lens> = {};
    for (const key of LENS_KEYS) {
      if (!given(a, key) || !isNum(a[key])) continue;
      const v = a[key] as number;
      switch (key) {
        case 'fov': patch.fov = readAngle(v); break;
        case 'roll': patch.roll = Math.abs(v) > 3.2 ? v * (Math.PI / 180) : v; break;
        case 'focusCenter': patch.focusCenter = clamp(v, -1, 1); break;
        case 'focusWidth': patch.focusWidth = saturate(v); break;
        case 'saturation': patch.saturation = clamp(v, 0, 4); break;
        case 'exposure': patch.exposure = clamp(v, -4, 4); break;
        case 'distortion': patch.distortion = clamp(v, -1, 1); break;
        default: patch[key] = saturate(v);
      }
    }
    this.pushLens(patch);
    const keys = Object.keys(patch);
    return keys.length
      ? `lens easing -> ${keys.map((k) => `${k}=${r2(patch[k as keyof Lens] as number)}`).join(' ')}`
      : 'lens unchanged';
  }

  private tColorGrade(a: Record<string, unknown>): string {
    const l = this.worldRef.lens;
    if (given(a, 'tint')) {
      const t = vec3(a.tint, l.colorGrade);
      this.lensTarget.colorGrade = [clamp(t[0], 0, 3), clamp(t[1], 0, 3), clamp(t[2], 0, 3)];
    }
    const patch: Partial<Lens> = {};
    if (given(a, 'exposure') && isNum(a.exposure)) patch.exposure = clamp(a.exposure, -4, 4);
    if (given(a, 'saturation') && isNum(a.saturation)) patch.saturation = clamp(a.saturation, 0, 4);
    this.pushLens(patch);
    return `grade -> tint=[${this.lensTarget.colorGrade?.map(r2).join(',') ?? l.colorGrade.map(r2).join(',')}] exp=${r2(this.lensTarget.exposure ?? l.exposure)} sat=${r2(this.lensTarget.saturation ?? l.saturation)}`;
  }

  private tTriggerEvent(a: Record<string, unknown>): string {
    const kind = enumOf(a.kind as string, EVENT_KINDS, 'sunbreak');
    const rawTtl = a.ttl;
    const ttl = rawTtl === 'infinity' || rawTtl === Infinity || (isNum(rawTtl) && !Number.isFinite(rawTtl))
      ? Infinity
      : clamp(num(a, 'ttl', 30), 0.5, 600);
    const at = vec3(a.at, [0, 0, 0]);
    const radius = Math.max(1, num(a, 'radius', 220));
    const params = numRecord(a.params);
    const e = this.pushEvent(kind, ttl, at, radius, params);
    return `event #${e.id} ${e.label} ttl=${ttl === Infinity ? 'inf' : `${ttl}s`} r=${Math.round(radius)}`;
  }

  private tSetCrowd(a: Record<string, unknown>): string {
    const c = this.worldRef.crowds;
    if (given(a, 'count') && isNum(a.count)) c.count = Math.max(0, Math.round(a.count));
    if (given(a, 'density') && isNum(a.density)) c.density = saturate(a.density);
    if (given(a, 'agitation') && isNum(a.agitation)) c.agitation = saturate(a.agitation);
    return `crowds ${c.count} density=${r2(c.density)} agitation=${r2(c.agitation)}`;
  }

  private tSetTraffic(a: Record<string, unknown>): string {
    const t = this.worldRef.traffic;
    if (given(a, 'count') && isNum(a.count)) t.count = Math.max(0, Math.round(a.count));
    if (given(a, 'density') && isNum(a.density)) t.density = saturate(a.density);
    return `traffic ${t.count} density=${r2(t.density)}`;
  }

  private tSetTimeScale(a: Record<string, unknown>): string {
    const s = clamp(num(a, 'scale', 1), 0, 20);
    this.worldRef.timeScale = s;
    return `timeScale=${r2(s)}`;
  }

  private tTour(a: Record<string, unknown>): string {
    const preset = enumOf(a.preset as string, TOUR_PRESETS, 'skyline');
    const def = buildTour(preset, this.camRef.position());
    if (!def) return `ERROR: no tour named "${preset}"`;
    this.cancelTour();
    if (def.lens) this.pushLens(def.lens);
    if (def.weather) {
      const wt = this.weatherTarget as unknown as Record<string, number>;
      for (const [k, v] of Object.entries(def.weather)) if (isNum(v)) wt[k] = v;
    }
    this.tour = { def, i: 0, t: 0 };
    this.fireStep(def, 0);
    return `tour "${preset}" started — ${def.steps.length} keyframes, ${def.steps.reduce((n, s) => n + s.seconds, 0).toFixed(0)}s loop`;
  }

  private tReset(): string {
    const w = this.worldRef;
    Object.assign(w.weather, defaultWeather());
    Object.assign(w.sun, defaultSun());
    Object.assign(w.lens, defaultLens());
    Object.assign(w.crowds, { count: 2400, density: 0.5, agitation: 0.1 });
    Object.assign(w.traffic, { count: 180, density: 0.6 });
    w.timeScale = 1;
    this.weatherTarget = { ...w.weather };
    this.lensTarget = {};
    return 'world reset to defaults';
  }
}

/** Angles read as radians, except implausibly large values which are degrees. */
function readAngle(v: number): number {
  return Math.abs(v) > 3.3 ? v * (Math.PI / 180) : v;
}
