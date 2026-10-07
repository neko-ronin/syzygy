/**
 * The single mutable world state. Everything visible — weather, time, the
 * camera's mood, event scheduling — reads from here, and the LLM conductor is
 * allowed to write to exactly this shape.
 *
 * Keeping it one flat record (rather than a class graph) is deliberate: the
 * conductor's tool layer is a JSON schema over these fields, and a future
 * session can diff/restore state by serialising one object.
 */

import { clamp, lerp, saturate, TAU, type Vec3 } from './math';

// ---------------------------------------------------------------- weather

export type SkyState = 'clear' | 'hazy' | 'overcast' | 'storm' | 'dusk' | 'dawn' | 'night';
export type Precip = 'none' | 'rain' | 'drizzle' | 'snow' | 'pollen' | 'ash' | 'spores';

export interface Weather {
  sky: SkyState;
  precip: Precip;
  /** 0 = clear blue, 1 = solid overcast. */
  cloudCover: number;
  /** Storm cell intensity; drives lightning, wind, and sky turbulence. */
  storminess: number;
  /** 0..1 fog/haze density in the canyon. Depth cue #1. */
  haze: number;
  /** Height falloff exponent for the fog. Higher = denser near the ground. */
  hazeFalloff: number;
  /** m/s, also drives rain slant, foliage sway, cable sway, blimp drift. */
  windSpeed: number;
  /** Radians; direction the wind blows toward. */
  windDir: number;
  /** 0..1 wetness — darkens albedo, adds specular, spawns puddle reflections. */
  wetness: number;
  /** 0..1 fog in the far distance only (aerial perspective). */
  aerialHaze: number;
  /** Additive light shafts, 0..1. */
  godRays: number;
  /** 0..1 how much pollen/spore motes drift through the air. */
  motes: number;
  /** 0..1, kills the far plane and softens silhouettes. */
  bloomStrength: number;
  /** 0..1 strength of the rainbow/chromatic sky scattering. */
  scatter: number;
}

export const defaultWeather = (): Weather => ({
  sky: 'clear',
  precip: 'none',
  cloudCover: 0.34,
  storminess: 0.0,
  haze: 0.22,
  hazeFalloff: 0.055,
  windSpeed: 4.2,
  windDir: 0.9,
  wetness: 0.0,
  aerialHaze: 0.4,
  godRays: 0.55,
  motes: 0.35,
  bloomStrength: 0.4,
  scatter: 0.35,
});

// ---------------------------------------------------------------- sun / time

export interface Sun {
  /** Radians around Y. 0 = +X. */
  azimuth: number;
  /** Radians above the horizon. Negative = below (night). */
  elevation: number;
  /** Day length in seconds. 0 = frozen (LLM-controlled time-of-day). */
  dayLength: number;
  /** Radiant colour at the zenith-ish direction. Linear. */
  color: Vec3;
  /** Radiance multiplier. */
  intensity: number;
  /** Ambient sky bounce. */
  ambient: Vec3;
  ambientIntensity: number;
  /** Directional bounce off the canyon floor, warmer. */
  bounce: Vec3;
  bounceIntensity: number;
}

export const defaultSun = (): Sun => ({
  azimuth: 2.1,
  elevation: 0.62,
  dayLength: 900,
  color: [1.0, 0.93, 0.82],
  intensity: 4.2,
  ambient: [0.42, 0.56, 0.72],
  ambientIntensity: 0.5,
  bounce: [0.55, 0.42, 0.32],
  bounceIntensity: 0.22,
});

/** Unit vector toward the sun, from azimuth/elevation. */
export function sunDirection(s: Sun): Vec3 {
  const ce = Math.cos(s.elevation);
  return [Math.cos(s.azimuth) * ce, Math.sin(s.elevation), Math.sin(s.azimuth) * ce];
}

// ---------------------------------------------------------------- camera mood

/**
 * The lens is part of the world, not a setting. The LLM can push these, and
 * cinematic mode drives them from a score. This is where "dreamlike camera
 * distortion" actually lives.
 */
export interface Lens {
  /** Vertical FOV, radians. Wide = vertigo; narrow = miniature. */
  fov: number;
  /** Camera roll, radians. Banked horizons read as flight. */
  roll: number;
  /** Tilt-shift band centre in NDC-y, -1..1. */
  focusCenter: number;
  /** Tilt-shift band half-height, 0..1. Smaller = stronger miniature. */
  focusWidth: number;
  /** Blur strength inside the band (the miniature signature). */
  tiltShift: number;
  /** Depth-of-field far/near strength. */
  bokeh: number;
  /** Radial barrel/pincushion. Positive = barrel (bulge). */
  distortion: number;
  /** Chromatic aberration at the edges. */
  chroma: number;
  /** Vignette. */
  vignette: number;
  /** Film grain. */
  grain: number;
  /** Halation around highlights. */
  bloom: number;
  /** Exposure in stops, applied before tonemap. */
  exposure: number;
  /** Saturation multiplier post-tonemap. */
  saturation: number;
  /** Per-channel lift/gain pushed toward the district's key colour. */
  colorGrade: [number, number, number];
  /** Screen-space wobble amplitude — the "impossible geometry" tell. */
  warp: number;
  /** Speed of the breathing FOV oscillation. */
  breathe: number;
  /** Extra FOV swing amplitude in radians, driven by camera velocity. */
  speedFov: number;
  /** Non-linear horizon bend, sells the miniature/toy-city read. */
  horizonBend: number;
  /** Written by integrateWorld; not authored directly. */
  _fovOffset?: number;
}

export const defaultLens = (): Lens => ({
  fov: 62 * (Math.PI / 180),
  roll: 0,
  focusCenter: 0.04,
  focusWidth: 0.52,
  tiltShift: 0.55,
  bokeh: 0.42,
  distortion: 0.045,
  chroma: 0.26,
  vignette: 0.34,
  grain: 0.10,
  bloom: 0.5,
  exposure: 1.0,
  saturation: 1.12,
  colorGrade: [1.0, 1.02, 1.05],
  warp: 0.2,
  breathe: 0.35,
  speedFov: 0.12,
  horizonBend: 0.18,
});

// ---------------------------------------------------------------- events

export type EventKind =
  | 'rain-burst' | 'sunbreak' | 'fog-bank' | 'aurora' | 'lightning'
  | 'bloom-festival' | 'migration' | 'market-rush' | 'balloon-release'
  | 'blimp-parade' | 'lantern-rise' | 'spore-bloom'
  | 'monsoon' | 'aurora-borealis' | 'power-cycle' | 'flash-flood';

export interface WorldEvent {
  id: number;
  kind: EventKind;
  /** Seconds remaining, or Infinity for persistent events. */
  ttl: number;
  /** 0..1 ramp envelope so nothing snaps on. */
  intensity: number;
  /** World position for localised events. */
  at: Vec3;
  radius: number;
  /** Free-form params, read by whichever system handles the kind. */
  params: Record<string, number>;
  label: string;
  /** Set on first integration; the envelope is derived from it. */
  totalTtl?: number;
}

// ---------------------------------------------------------------- debug / perf

export interface Perf {
  /** Rolling frame time, ms. */
  frameMs: number;
  cpuMs: number;
  /** Real timestamp-query duration only. null means no measured GPU duration is available. */
  gpuMs: number | null;
  gpuMsSource: 'unavailable' | 'timestamp-query';
  fps: number;
  /** 0..1, drives the automatic quality governor. */
  load: number;
  /** Current quality tier name. */
  tier: string;
  drawCalls: number;
  triangles: number;
  instances: number;
  /** Draw calls uploaded to the GPU (all LOD tiers). */
  residentDraws: number;
  /** Draw calls that survived frustum culling this frame. */
  visibleDraws: number;
  residentChunks: number;
  /** GPU memory estimate, MB. */
  vram: number;
}

// ---------------------------------------------------------------- root

export interface WorldState {
  seed: number;
  time: number;
  /** 0..1 progress through the day, derived from sun azimuth. */
  dayPhase: number;
  weather: Weather;
  sun: Sun;
  lens: Lens;
  events: WorldEvent[];
  perf: Perf;
  /** Simulation rate multiplier — lets the LLM speed the city up. */
  timeScale: number;
  /** Free-form counters the conductor can bump for spectacle. */
  crowds: { count: number; density: number; agitation: number };
  traffic: { count: number; density: number };
  /** Set true by the conductor for a "freeze the world" beat. */
  paused: boolean;
}

export const defaultWorld = (seed = 0x5e7a17): WorldState => ({
  seed,
  time: 0,
  dayPhase: 0.28,
  weather: defaultWeather(),
  sun: defaultSun(),
  lens: defaultLens(),
  events: [],
  perf: {
    frameMs: 16.7, cpuMs: 0, gpuMs: null, gpuMsSource: 'unavailable', fps: 60, load: 0,
    tier: 'high', drawCalls: 0, triangles: 0, instances: 0,
    residentDraws: 0, visibleDraws: 0, residentChunks: 0, vram: 0,
  },
  timeScale: 1,
  crowds: { count: 2400, density: 0.5, agitation: 0.1 },
  traffic: { count: 180, density: 0.6 },
  paused: false,
});

// ---------------------------------------------------------------- integration

// Small helper so the envelope maths below reads cleanly.
function lifeOf(e: WorldEvent): number {
  return e.ttl === Infinity ? 1 : saturate(1 - e.ttl / (e.totalTtl ?? 60));
}

/**
 * Advance the *derived* parts of state. Systems read these; nothing else
 * writes them. Called once per frame before sim.
 */
export function integrateWorld(w: WorldState, dt: number): void {
  w.time += dt;

  // Sun traverses its arc at dayLength seconds per full revolution.
  if (w.sun.dayLength > 0) {
    w.sun.azimuth = (w.sun.azimuth + (TAU / w.sun.dayLength) * dt) % TAU;
  }
  // Elevation follows the azimuth with a slight lag, so dawn/dusk linger.
  const target = Math.sin(w.sun.azimuth) * 1.15 - 0.06;
  w.sun.elevation = lerp(w.sun.elevation, target, 1 - Math.exp(-0.35 * dt));
  w.dayPhase = saturate((w.sun.elevation + 0.35) / 1.5);

  // Weather relaxes toward a coherent state: clouds and storminess co-vary,
  // rain implies wetness, wind rises with storm.
  const wx = w.weather;
  const rainLike = wx.precip === 'rain' || wx.precip === 'drizzle' || wx.precip === 'monsoon' as never;
  if (rainLike) {
    wx.wetness = Math.min(1, wx.wetness + dt * 0.08);
    wx.haze = Math.min(1, wx.haze + dt * 0.02);
  } else {
    wx.wetness = Math.max(0, wx.wetness - dt * 0.012);
  }
  if (wx.storminess > 0.4) {
    wx.windSpeed = lerp(wx.windSpeed, 4.2 + 22 * wx.storminess, 1 - Math.exp(-0.4 * dt));
  }

  // Events: age, ramp, expire.
  for (let i = w.events.length - 1; i >= 0; i--) {
    const e = w.events[i];
    if (e.totalTtl === undefined) e.totalTtl = e.ttl === Infinity ? Infinity : e.ttl;
    if (e.ttl !== Infinity) {
      e.ttl -= dt;
      if (e.ttl <= 0) { w.events.splice(i, 1); continue; }
    }
    // Ramp in over the first quarter of life, out over the last quarter.
    const life = lifeOf(e);
    e.intensity = saturate(Math.min(life / 0.25, 1 - Math.max(0, (life - 0.75) / 0.25)));
  }

  // Lens breathing: a slow FOV oscillation that never quite repeats.
  const b = w.lens.breathe;
  if (b > 0) {
    const t = w.time;
    const wob =
      Math.sin(t * 0.21) * 0.6 +
      Math.sin(t * 0.077 + 1.7) * 0.3 +
      Math.sin(t * 0.43 + 0.4) * 0.1;
    w.lens._fovOffset = wob * b * 0.06;
  } else {
    w.lens._fovOffset = 0;
  }
}

export const fovOf = (w: WorldState) => w.lens.fov + (w.lens._fovOffset ?? 0);
export const clampWeather = (w: Weather) => {
  w.cloudCover = clamp(w.cloudCover, 0, 1);
  w.haze = clamp(w.haze, 0, 1);
  w.wetness = clamp(w.wetness, 0, 1);
  w.godRays = clamp(w.godRays, 0, 1);
  w.motes = clamp(w.motes, 0, 1);
  return w;
};
