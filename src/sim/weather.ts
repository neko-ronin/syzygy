/**
 * The Weather Director.
 *
 * This is an *author*, not a state holder. It keeps a private `target` for the
 * weather, the sun and the lens, and eases `world.*` toward it with a different
 * rate per field — clouds crawl, haze follows, god rays snap. A hard cut in fog
 * reads as a bug, so nothing here ever snaps except an explicit `snap()`.
 *
 * Two things do the work:
 *
 *  - `PHASE_LOOK` — a full authored light rig per part of the day. `setPhase`
 *    writes the sun elevation/azimuth, the sun colour, the ambient, the cloud
 *    cover, the god rays, the exposure, the bloom and the lens. This is where
 *    the spectacle lives.
 *  - `EVENT_FX` — one handler per `EventKind`, each of which does something
 *    visible and specific. Events are layered *over* the phase look and decay
 *    back to it, so a sunbreak does not permanently rewrite the day.
 *
 * A private `cohere()` runs after every target rebuild and nudges physically
 * coupled fields (storm ⇒ wind and cloud, rain ⇒ wetness, wet ground ⇒ flatter
 * fog, strong shafts ⇒ thinner cloud) so the director cannot author nonsense.
 *
 * Headless: imports nothing browser-only, so it runs under vite-node.
 */

import { clamp, damp, hexLinear, saturate, type Vec3 } from '../core/math';
import {
  clampWeather, defaultLens, defaultSun, defaultWeather,
  type EventKind,
  type Lens,
  type Precip,
  type SkyState,
  type Sun,
  type Weather,
  type WorldEvent,
  type WorldState,
} from '../core/state';

// ---------------------------------------------------------------- field lists

const WX_KEYS = [
  'cloudCover', 'storminess', 'haze', 'hazeFalloff', 'windSpeed', 'windDir',
  'wetness', 'aerialHaze', 'godRays', 'motes', 'bloomStrength', 'scatter',
] as const;
type WxKey = (typeof WX_KEYS)[number];

const SUN_KEYS = ['intensity', 'ambientIntensity', 'bounceIntensity'] as const;
type SunKey = (typeof SUN_KEYS)[number];

const SUN_COL_KEYS = ['color', 'ambient', 'bounce'] as const;
type SunColKey = (typeof SUN_COL_KEYS)[number];

/** `roll` and `focusCenter` are owned by the camera, so the director leaves them. */
const LENS_KEYS = [
  'fov', 'focusWidth', 'tiltShift', 'bokeh', 'distortion', 'chroma', 'vignette',
  'grain', 'bloom', 'exposure', 'saturation', 'warp', 'breathe', 'speedFov',
  'horizonBend',
] as const;
type LensKey = (typeof LENS_KEYS)[number];

/** Sun and lens colours accumulate per channel, so their keys are `name0..2`. */
const COL_KEYS: string[] = [];
for (const k of SUN_COL_KEYS) for (let i = 0; i < 3; i++) COL_KEYS.push(`${k}${i}`);
COL_KEYS.push('c0', 'c1', 'c2');

type Group = 'wx' | 'sun' | 'sunC' | 'lens' | 'lensC';
const GROUPS: readonly Group[] = ['wx', 'sun', 'sunC', 'lens', 'lensC'];

const KEYS_OF: Record<Group, readonly string[]> = {
  wx: WX_KEYS, sun: SUN_KEYS, sunC: COL_KEYS, lens: LENS_KEYS, lensC: COL_KEYS,
};

/**
 * Time to close 90% of a gap, in seconds. Converted to an exponential rate so
 * the transition is frame-rate independent.
 */
const T90 = 2.3026;
const R = (t90: number): number => T90 / t90;

const WX_RATE: Record<WxKey, number> = {
  cloudCover: R(25), storminess: R(18), haze: R(12), hazeFalloff: R(12),
  windSpeed: R(16), windDir: R(25), wetness: R(30), aerialHaze: R(14),
  godRays: R(8), motes: R(10), bloomStrength: R(9), scatter: R(12),
};
const SUN_RATE: Record<SunKey, number> = {
  intensity: R(8), ambientIntensity: R(12), bounceIntensity: R(14),
};
const LENS_RATE: Record<LensKey, number> = {
  fov: R(6), focusWidth: R(10), tiltShift: R(10), bokeh: R(10),
  distortion: R(8), chroma: R(8), vignette: R(8), grain: R(8), bloom: R(8),
  exposure: R(5), saturation: R(6), warp: R(10), breathe: R(12),
  speedFov: R(12), horizonBend: R(10),
};
const COL_RATE = R(9);

const blank = (keys: readonly string[]): Record<string, number> => {
  const o: Record<string, number> = {};
  for (const k of keys) o[k] = 0;
  return o;
};

/** Frame delta ceiling. A long GC pause must not teleport the atmosphere. */
export const MAX_DT = 1 / 15;

// ---------------------------------------------------------------- phase rig

/** A complete authored look. Every field the director owns is listed. */
export interface PhaseLook {
  /** Azimuth the sun is steered to; also seeds `integrateWorld`'s elevation. */
  azimuth: number;
  elevation: number;
  sunColor: Vec3;
  intensity: number;
  ambient: Vec3;
  ambientIntensity: number;
  bounce: Vec3;
  bounceIntensity: number;
  sky: SkyState;
  precip: Precip;
  cloudCover: number;
  storminess: number;
  haze: number;
  hazeFalloff: number;
  windSpeed: number;
  wetness: number;
  aerialHaze: number;
  godRays: number;
  motes: number;
  bloomStrength: number;
  scatter: number;
  fov: number;
  chroma: number;
  grain: number;
  exposure: number;
  saturation: number;
  bloom: number;
  vignette: number;
  tiltShift: number;
  focusWidth: number;
  bokeh: number;
  warp: number;
  distortion: number;
  horizonBend: number;
  colorGrade: Vec3;
  /** Multiplier on lit windows. 1 = every window burning. */
}

const D2R = Math.PI / 180;
const g = (hex: string): Vec3 => hexLinear(hex);

/**
 * Azimuths are chosen so `integrateWorld`'s `sin(az) * 1.15 - 0.06` lands on
 * the authored elevation, which means the integrator and the director never
 * argue about where the sun is.
 */
const PHASE_LOOK: Record<string, PhaseLook> = {
  dawn: {
    azimuth: 0.06, elevation: 0.009,
    sunColor: g('#ffb37a'), intensity: 2.6,
    ambient: g('#4a5f8c'), ambientIntensity: 0.55,
    bounce: g('#6b4a46'), bounceIntensity: 0.3,
    sky: 'dawn', precip: 'none',
    cloudCover: 0.46, storminess: 0, haze: 0.58, hazeFalloff: 0.09,
    windSpeed: 3.4, wetness: 0.3, aerialHaze: 0.55, godRays: 0.88, motes: 0.55,
    bloomStrength: 0.6, scatter: 0.52,
    fov: 60 * D2R, chroma: 0.5, grain: 0.22, exposure: 1.06, saturation: 1.14,
    bloom: 0.72, vignette: 0.46, tiltShift: 0.62, focusWidth: 0.34, bokeh: 0.5,
    warp: 0.26, distortion: 0.07, horizonBend: 0.2,
    colorGrade: [1.04, 1.0, 0.98],
  },
  morning: {
    azimuth: 0.4115, elevation: 0.4,
    sunColor: g('#fff0d4'), intensity: 3.6,
    ambient: g('#6e93c4'), ambientIntensity: 0.55,
    bounce: g('#7a6046'), bounceIntensity: 0.26,
    sky: 'clear', precip: 'none',
    cloudCover: 0.3, storminess: 0, haze: 0.32, hazeFalloff: 0.07,
    windSpeed: 4.6, wetness: 0.12, aerialHaze: 0.38, godRays: 0.62, motes: 0.34,
    bloomStrength: 0.4, scatter: 0.38,
    fov: 64 * D2R, chroma: 0.34, grain: 0.15, exposure: 1.0, saturation: 1.12,
    bloom: 0.45, vignette: 0.4, tiltShift: 0.6, focusWidth: 0.34, bokeh: 0.48,
    warp: 0.2, distortion: 0.05, horizonBend: 0.18,
    colorGrade: [1.0, 1.02, 1.04],
  },
  noon: {
    azimuth: 1.5708, elevation: 1.09,
    sunColor: g('#fffaf0'), intensity: 4.6,
    ambient: g('#8fb4dd'), ambientIntensity: 0.6,
    bounce: g('#6f6656'), bounceIntensity: 0.2,
    sky: 'clear', precip: 'none',
    cloudCover: 0.16, storminess: 0, haze: 0.14, hazeFalloff: 0.05,
    windSpeed: 5.2, wetness: 0.04, aerialHaze: 0.24, godRays: 0.3, motes: 0.18,
    bloomStrength: 0.26, scatter: 0.3,
    fov: 66 * D2R, chroma: 0.24, grain: 0.1, exposure: 0.92, saturation: 1.08,
    bloom: 0.3, vignette: 0.34, tiltShift: 0.58, focusWidth: 0.36, bokeh: 0.44,
    warp: 0.16, distortion: 0.035, horizonBend: 0.15,
    colorGrade: [0.99, 1.01, 1.06],
  },
  afternoon: {
    azimuth: 2.6722, elevation: 0.46,
    sunColor: g('#ffe9c0'), intensity: 3.9,
    ambient: g('#7fa4cc'), ambientIntensity: 0.55,
    bounce: g('#7d6042'), bounceIntensity: 0.26,
    sky: 'clear', precip: 'none',
    cloudCover: 0.32, storminess: 0, haze: 0.3, hazeFalloff: 0.07,
    windSpeed: 5.8, wetness: 0.06, aerialHaze: 0.36, godRays: 0.74, motes: 0.4,
    bloomStrength: 0.42, scatter: 0.46,
    fov: 62 * D2R, chroma: 0.4, grain: 0.16, exposure: 1.02, saturation: 1.16,
    bloom: 0.5, vignette: 0.42, tiltShift: 0.62, focusWidth: 0.3, bokeh: 0.5,
    warp: 0.22, distortion: 0.06, horizonBend: 0.2,
    colorGrade: [1.02, 1.01, 0.99],
  },
  dusk: {
    azimuth: 3.0816, elevation: 0.009,
    sunColor: g('#ff7a2e'), intensity: 2.4,
    ambient: g('#3d4d86'), ambientIntensity: 0.5,
    bounce: g('#7a3a2e'), bounceIntensity: 0.34,
    sky: 'dusk', precip: 'none',
    cloudCover: 0.48, storminess: 0, haze: 0.55, hazeFalloff: 0.08,
    windSpeed: 4.0, wetness: 0.18, aerialHaze: 0.5, godRays: 0.95, motes: 0.5,
    bloomStrength: 0.72, scatter: 0.58,
    fov: 52 * D2R, chroma: 0.62, grain: 0.26, exposure: 1.14, saturation: 1.2,
    bloom: 0.82, vignette: 0.5, tiltShift: 0.66, focusWidth: 0.26, bokeh: 0.56,
    warp: 0.3, distortion: 0.09, horizonBend: 0.26,
    colorGrade: [1.06, 0.99, 0.94],
  },
  // Night. Measured, not guessed — `docs/NIGHT_REPORT.md` has the numbers and
  // the controls behind each of these.
  //
  // `ambientIntensity` 0.22 -> 0.66 is a 3x lift on the ambient floor, which
  // R2 asks for and which measurably moves the frame: mean luma 6.21 -> 8.84,
  // aisle 3.56 -> 3.99. It is a real gain and it is a SMALL one, which is the
  // point worth keeping in mind: ambient lights everything uniformly, so it
  // cannot make a POOL. The warm pool under a lantern needs that lantern's
  // light to exist in the clustered buffer, and the market grammar's 365 lights
  // currently reach it as zero. See NIGHT_REPORT.md cause 2.
  //
  // `exposure` 1.28 -> 1.6 is the strongest authoring lever measured here: at
  // 3x the frame reached mean luma 17.31 and maxLuma 106.6 with
  // `hotPixelPct` still 0, so there was real headroom and 1.6 spends some of it
  // without approaching the roll-off. Night-only, so daylight is untouched.
  night: {
    azimuth: 3.49, elevation: -0.45,
    sunColor: g('#6a86e0'), intensity: 0.5,
    ambient: g('#1d2547'), ambientIntensity: 0.66,
    bounce: g('#241f38'), bounceIntensity: 0.12,
    sky: 'night', precip: 'none',
    cloudCover: 0.34, storminess: 0, haze: 0.26, hazeFalloff: 0.06,
    windSpeed: 3.0, wetness: 0.14, aerialHaze: 0.34, godRays: 0.28, motes: 0.28,
    bloomStrength: 0.74, scatter: 0.42,
    fov: 56 * D2R, chroma: 0.5, grain: 0.3, exposure: 1.6, saturation: 1.18,
    bloom: 0.78, vignette: 0.56, tiltShift: 0.7, focusWidth: 0.24, bokeh: 0.62,
    warp: 0.24, distortion: 0.07, horizonBend: 0.2,
    colorGrade: [0.96, 1.0, 1.08],
  },
};

export const PHASES: readonly string[] = Object.keys(PHASE_LOOK);

const PHASE_ALIAS: Record<string, string> = {
  'sunrise': 'dawn', 'sunset': 'dusk', 'midnight': 'night',
  'day': 'noon', 'midday': 'noon', 'evening': 'dusk', 'morning-dawn': 'dawn',
};

/** Name the current part of the day from sun elevation and azimuth. */
export function phaseOf(w: WorldState): string {
  const el = w.sun.elevation;
  // Azimuth 0 is sunrise and runs to sunset at PI, so the quadrant test is
  // against PI/2, not PI: that is what the authored phase rig uses.
  const az = ((w.sun.azimuth % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (el < -0.18) return 'night';
  if (el < 0.1) return az < Math.PI / 2 ? 'dawn' : 'dusk';
  if (el < 0.55) return az < Math.PI / 2 ? 'morning' : 'afternoon';
  return 'noon';
}

const resolvePhase = (phase: string, fallback: string): string => {
  const p = String(phase).toLowerCase().trim();
  if (PHASE_LOOK[p]) return p;
  const alias = PHASE_ALIAS[p];
  if (alias) return alias;
  for (const name of Object.keys(PHASE_LOOK)) if (p.includes(name)) return name;
  for (const name of Object.keys(PHASE_ALIAS)) if (p.includes(name)) return PHASE_ALIAS[name];
  return fallback;
};

// ---------------------------------------------------------------- blend layer

/**
 * Accumulates intensity-weighted event contributions per field, then resolves
 * them against the phase look. A field nobody touched keeps its authored value
 * exactly, so an event only moves what it names.
 */
class Blend {
  private readonly acc: Record<Group, Record<string, number>>;
  private readonly wsum: Record<Group, Record<string, number>>;
  private skyVal: SkyState | null = null;
  private skyW = 0;
  private precipVal: Precip | null = null;
  private precipW = 0;

  constructor() {
    const acc = {} as Record<Group, Record<string, number>>;
    const wsum = {} as Record<Group, Record<string, number>>;
    for (const grp of GROUPS) {
      acc[grp] = blank(KEYS_OF[grp]);
      wsum[grp] = blank(KEYS_OF[grp]);
    }
    this.acc = acc;
    this.wsum = wsum;
  }

  reset(): void {
    for (const grp of GROUPS) {
      const a = this.acc[grp];
      const w = this.wsum[grp];
      for (const k of KEYS_OF[grp]) { a[k] = 0; w[k] = 0; }
    }
    this.skyVal = null; this.skyW = 0;
    this.precipVal = null; this.precipW = 0;
  }

  /** Weather numbers, e.g. `wx(0.5, { cloudCover: 0.8 })`. */
  wx(weight: number, patch: Partial<Record<WxKey, number>>): void {
    const a = this.acc.wx, w = this.wsum.wx;
    for (const k of WX_KEYS) {
      const v = patch[k];
      if (v === undefined) continue;
      a[k] += v * weight;
      w[k] += weight;
    }
  }

  sun(weight: number, patch: Partial<Record<SunKey, number>>): void {
    const a = this.acc.sun, w = this.wsum.sun;
    for (const k of SUN_KEYS) {
      const v = patch[k];
      if (v === undefined) continue;
      a[k] += v * weight;
      w[k] += weight;
    }
  }

  /** Sun colours: each channel accumulates separately. */
  sunColor(weight: number, key: SunColKey, c: Vec3): void {
    const a = this.acc.sunC, w = this.wsum.sunC;
    a[`${key}0`] += c[0] * weight; w[`${key}0`] += weight;
    a[`${key}1`] += c[1] * weight; w[`${key}1`] += weight;
    a[`${key}2`] += c[2] * weight; w[`${key}2`] += weight;
  }

  lens(weight: number, patch: Partial<Record<LensKey, number>>): void {
    const a = this.acc.lens, w = this.wsum.lens;
    for (const k of LENS_KEYS) {
      const v = patch[k];
      if (v === undefined) continue;
      a[k] += v * weight;
      w[k] += weight;
    }
  }

  lensGrade(weight: number, c: Vec3): void {
    const a = this.acc.lensC, w = this.wsum.lensC;
    for (let i = 0; i < 3; i++) { a[`c${i}`] += c[i] * weight; w[`c${i}`] += weight; }
  }

  sky(v: SkyState, weight: number): void {
    if (weight > this.skyW) { this.skyW = weight; this.skyVal = v; }
  }

  precip(v: Precip, weight: number): void {
    if (weight > this.precipW) { this.precipW = weight; this.precipVal = v; }
  }

  /** Highest-weight event sky, or the phase's own when nothing set one. */
  skyOr(fallback: SkyState): SkyState {
    return this.skyVal !== null && this.skyW > 0.02 ? this.skyVal : fallback;
  }

  precipOr(fallback: Precip): Precip {
    return this.precipVal !== null && this.precipW > 0.02 ? this.precipVal : fallback;
  }

  /** Mix an accumulated group over the phase base, in place on `out`. */
  resolveNum(grp: 'wx' | 'sun' | 'lens', out: Record<string, number>, base: Record<string, number>): void {
    const a = this.acc[grp];
    const w = this.wsum[grp];
    for (const k of KEYS_OF[grp]) {
      const wk = w[k];
      if (wk <= 1e-6) { out[k] = base[k]; continue; }
      if (wk >= 1) { out[k] = a[k] / wk; continue; }
      out[k] = base[k] * (1 - wk) + a[k];
    }
  }

  /** Mix an accumulated colour group into `out`, in place. */
  resolveCol(out: Vec3, base: Vec3, key: string): void {
    const a = this.acc.sunC;
    const w = this.wsum.sunC;
    for (let i = 0; i < 3; i++) {
      const k = `${key}${i}`;
      const wk = w[k];
      if (wk <= 1e-6) { out[i] = base[i]; continue; }
      out[i] = wk >= 1 ? a[k] / wk : base[i] * (1 - wk) + a[k];
    }
  }

  resolveGrade(out: Vec3, base: Vec3): void {
    for (let i = 0; i < 3; i++) {
      const k = `c${i}`;
      const wk = this.wsum.lensC[k];
      if (wk <= 1e-6) { out[i] = base[i]; continue; }
      out[i] = wk >= 1 ? this.acc.lensC[k] / wk : base[i] * (1 - wk) + this.acc.lensC[k];
    }
  }
}

// ---------------------------------------------------------------- events

/** How long each event lives by default, in seconds. */
export const EVENT_TTL: Record<EventKind, number> = {
  'rain-burst': 26, sunbreak: 30, 'fog-bank': 45, aurora: 42, lightning: 9,
  'bloom-festival': 55, migration: 42, 'market-rush': 46, 'balloon-release': 58,
  'blimp-parade': 48, 'lantern-rise': 62,
  'spore-bloom': 58, monsoon: 95, 'aurora-borealis': 72, 'power-cycle': 11,
  'flash-flood': 36,
};

/** Short label used by `describe()`. */
const EVENT_TAG: Record<EventKind, string> = {
  'rain-burst': 'squall line moving through',
  sunbreak: 'sun breaking through',
  'fog-bank': 'fog bank rolling up the canyon',
  aurora: 'aurora over the arcologies',
  lightning: 'lightning walking the far shore',
  'bloom-festival': 'bloom festival',
  migration: 'a migration crossing the terraces',
  'market-rush': 'the bazaar at full pitch',
  'balloon-release': 'balloons letting go',
  'blimp-parade': 'blimp parade overhead',
  'lantern-rise': 'lanterns rising',
  'spore-bloom': 'spores in the air',
  monsoon: 'monsoon',
  'aurora-borealis': 'the borealis',
  'power-cycle': 'the grid dropping out',
  'flash-flood': 'flash flood off the terraces',
};

const AURORA_GREEN: Vec3 = [0.16, 0.62, 0.42];
const AURORA_VIOLET: Vec3 = [0.3, 0.2, 0.66];
const NIGHT_AMBIENT: Vec3 = [0.09, 0.12, 0.26];
const LANTERN_AMBIENT: Vec3 = [0.46, 0.24, 0.12];
const MARKET_AMBIENT: Vec3 = [0.5, 0.38, 0.22];

const mixC = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];

/**
 * What each event does to the atmosphere, weighted by its intensity envelope.
 * Every kind moves at least one field of weather, sun or lens.
 */
const EVENT_FX: Record<EventKind, (l: Blend, w: number, e: WorldEvent) => void> = {
  'rain-burst': (l, w) => {
    l.precip('rain', w);
    l.sky('overcast', w);
    l.wx(w, {
      storminess: 0.45, cloudCover: 0.78, wetness: 0.66, haze: 0.5,
      hazeFalloff: 0.055, godRays: 0.06, windSpeed: 14, aerialHaze: 0.5,
      bloomStrength: 0.3, scatter: 0.14, motes: 0.3,
    });
    l.lens(w, { exposure: 0.9, chroma: 0.5 });
  },
  sunbreak: (l, w) => {
    l.precip('none', w);
    l.sky('hazy', w);
    l.wx(w, {
      cloudCover: 0.08, haze: 0.14, wetness: 0.1, godRays: 0.92,
      scatter: 0.78, aerialHaze: 0.26, storminess: 0, motes: 0.42,
    });
    l.lens(w, { exposure: 1.08, chroma: 0.6, saturation: 1.22, bloom: 0.8 });
  },
  'fog-bank': (l, w) => {
    l.sky('hazy', w);
    l.wx(w, {
      haze: 0.94, hazeFalloff: 0.13, aerialHaze: 0.72, cloudCover: 0.3,
      godRays: 0.42, scatter: 0.4, motes: 0.5, bloomStrength: 0.62,
    });
    l.lens(w, { fov: 44 * D2R, focusWidth: 0.16, bokeh: 0.72, exposure: 0.94, tiltShift: 0.8 });
  },
  aurora: (l, w, e) => {
    const borealis = e.kind === 'aurora-borealis';
    l.sky('night', w);
    l.sun(w, { intensity: 0.12, ambientIntensity: borealis ? 0.44 : 0.34, bounceIntensity: 0.08 });
    l.sunColor(w, 'ambient', mixC(NIGHT_AMBIENT, mixC(AURORA_GREEN, AURORA_VIOLET, 0.35 + e.intensity * 0.25), 0.85));
    l.wx(w, { godRays: 0.6, bloomStrength: 0.85, scatter: borealis ? 0.8 : 0.6, motes: 0.5, haze: 0.3 });
    l.lens(w, { bloom: 0.9, saturation: borealis ? 1.34 : 1.26, chroma: 0.7, exposure: 1.2 });
  },
  lightning: (l, w, e) => {
    l.sky('storm', w);
    l.wx(w, {
      storminess: 0.92, cloudCover: 0.9, windSpeed: 26, haze: 0.42,
      wetness: 0.55, godRays: 0.04, aerialHaze: 0.36, motes: 0.34,
    });
    // The flash itself: a hard key spike on a fraction of the envelope.
    const flash = Math.pow(w, 0.35) * (0.6 + 0.4 * Math.sin(e.intensity * 9.1 + e.id));
    l.sun(w * flash, { intensity: 6.5, ambientIntensity: 1.4 });
    l.sunColor(w * flash, 'ambient', [0.72, 0.78, 1.0]);
    l.lens(w, { exposure: 1 + flash * 0.22, chroma: 0.4, bloom: 0.7 });
  },
  'bloom-festival': (l, w) => {
    l.precip('pollen', w);
    l.sky('hazy', w);
    l.wx(w, { motes: 0.96, scatter: 0.8, bloomStrength: 0.62, haze: 0.3, godRays: 0.6, wetness: 0.12 });
    l.lens(w, { chroma: 0.68, saturation: 1.28, bloom: 0.72, exposure: 1.06, grain: 0.1 });
  },
  migration: (l, w) => {
    l.wx(w, { haze: 0.44, aerialHaze: 0.58, motes: 0.44, godRays: 0.5, bloomStrength: 0.5 });
    l.lens(w, { tiltShift: 0.86, focusWidth: 0.18, bokeh: 0.7, saturation: 0.98, warp: 0.34 });
  },
  'market-rush': (l, w) => {
    l.sky('hazy', w);
    l.sun(w, { ambientIntensity: 0.34 });
    l.sunColor(w, 'ambient', MARKET_AMBIENT);
    l.wx(w, { haze: 0.42, motes: 0.6, godRays: 0.5, bloomStrength: 0.6, scatter: 0.5 });
    l.lens(w, { tiltShift: 0.76, focusWidth: 0.22, bloom: 0.8, exposure: 1.06, saturation: 1.2 });
  },
  'balloon-release': (l, w) => {
    l.precip('none', w);
    l.sky('dawn', w);
    l.wx(w, { motes: 0.5, haze: 0.32, godRays: 0.72, bloomStrength: 0.58, scatter: 0.55, windSpeed: 5 });
    l.lens(w, { fov: 74 * D2R, warp: 0.3, chroma: 0.55, exposure: 1.08, bloom: 0.7 });
  },
  'blimp-parade': (l, w) => {
    l.wx(w, { haze: 0.46, godRays: 0.68, bloomStrength: 0.6, windSpeed: 12, motes: 0.3 });
    l.lens(w, { fov: 70 * D2R, saturation: 1.18, chroma: 0.5, bloom: 0.68 });
  },
  'lantern-rise': (l, w) => {
    l.sky('night', w);
    l.sun(w, { intensity: 0.14, ambientIntensity: 0.4, bounceIntensity: 0.3 });
    l.sunColor(w, 'ambient', LANTERN_AMBIENT);
    l.sunColor(w, 'bounce', [0.5, 0.22, 0.08]);
    l.wx(w, { bloomStrength: 0.86, motes: 0.7, scatter: 0.7, haze: 0.38, godRays: 0.4 });
    l.lens(w, { bloom: 0.92, exposure: 1.18, saturation: 1.26, chroma: 0.6 });
  },
  'spore-bloom': (l, w) => {
    l.precip('spores', w);
    l.sky('hazy', w);
    l.wx(w, { motes: 0.98, haze: 0.46, scatter: 0.86, godRays: 0.66, bloomStrength: 0.56, wetness: 0.2 });
    l.lens(w, { chroma: 0.72, saturation: 1.24, bloom: 0.66, exposure: 1.04 });
  },
  monsoon: (l, w) => {
    l.precip('rain', w);
    l.sky('storm', w);
    l.wx(w, {
      storminess: 0.96, cloudCover: 0.95, windSpeed: 30, wetness: 0.98,
      haze: 0.72, hazeFalloff: 0.07, godRays: 0.02, aerialHaze: 0.3,
      bloomStrength: 0.2, scatter: 0.06, motes: 0.5,
    });
    l.lens(w, { exposure: 0.84, chroma: 0.46, saturation: 0.96, bloom: 0.4, fov: 70 * D2R });
  },
  'aurora-borealis': (l, w, e) => EVENT_FX.aurora(l, w, e),
  'power-cycle': (l, w) => {
    // Every lit window in the city goes out, then comes back.
    l.sun(w, { intensity: 0.55, ambientIntensity: 0.06, bounceIntensity: 0.02 });
    l.sunColor(w, 'ambient', [0.05, 0.06, 0.11]);
    l.wx(w, { haze: 0.16, bloomStrength: 0.22, motes: 0.06 });
    l.lens(w, { bloom: 0.24, exposure: 0.8, saturation: 0.9 });
  },
  'flash-flood': (l, w) => {
    l.precip('rain', w);
    l.sky('storm', w);
    l.wx(w, {
      storminess: 0.78, wetness: 1.0, haze: 0.62, hazeFalloff: 0.022,
      godRays: 0.04, motes: 0.72, aerialHaze: 0.28, bloomStrength: 0.4,
      cloudCover: 0.86, windSpeed: 18,
    });
    l.lens(w, { exposure: 0.9, saturation: 1.04, bloom: 0.6, chroma: 0.42 });
  },
};

// ---------------------------------------------------------------- director

interface QueueEntry {
  ev: WorldEvent;
  ttl: number;
  total: number;
}

let nextLocalId = -1;

export class WeatherDirector {
  private readonly w: WorldState;
  private look: PhaseLook;
  private phaseName: string;

  private readonly base = {
    wx: blank(WX_KEYS), sun: blank(SUN_KEYS), lens: blank(LENS_KEYS),
  };
  private readonly tw: Record<string, number> = blank(WX_KEYS);
  private readonly ts: Record<string, number> = blank(SUN_KEYS);
  private readonly tl: Record<string, number> = blank(LENS_KEYS);
  private readonly sunC: Record<SunColKey, Vec3> = {
    color: [1, 1, 1], ambient: [0, 0, 0], bounce: [0, 0, 0],
  };
  private readonly grade: Vec3 = [1, 1, 1];

  private readonly layer = new Blend();
  private readonly queue: QueueEntry[] = [];

  private targetSky: SkyState = 'clear';
  private targetPrecip: Precip = 'none';

  /** 0..1 — how hard the director is currently steering the atmosphere. */
  private blendAmt = 0;
  private clock = 0;
  /** Peak `blend` seen since construction, for diagnostics. */
  private blendPeak = 0;

  /** Azimuth steering: only active during a phase jump, then handed to the sun. */
  private azTarget = 0;
  private azSteering = false;
  private elTarget = 0;
  private elSteering = false;

  private readonly targetWeather: Weather = defaultWeather();
  private readonly targetSun: Sun = defaultSun();
  private readonly targetLens: Lens = defaultLens();

  constructor(world: WorldState) {
    this.w = world;
    const name = resolvePhase(phaseOf(world), 'afternoon');
    this.phaseName = name;
    this.look = PHASE_LOOK[name];
    this.azTarget = world.sun.azimuth;
    this.elTarget = world.sun.elevation;
    this.seedTargets();
    this.buildTarget();
    this.snap();
  }

  /** The director's live weather target — useful for HUDs and self-checks. */
  get target(): Weather { return this.targetWeather; }
  get targetSunState(): Sun { return this.targetSun; }
  get targetLensState(): Lens { return this.targetLens; }
  /** The part of the day currently being authored. */
  get phase(): string { return this.phaseName; }
  /** 0..1 how much the director is actively steering. */
  get blend(): number { return this.blendAmt; }

  /** Highest `blend` reached so far — a cheap "is this thing working" probe. */
  get peakBlend(): number { return this.blendPeak; }

  /** Live event count, ignoring anything on `world.events`. */
  get pendingEvents(): number { return this.queue.length; }

  // ------------------------------------------------------------ authoring

  /**
   * Jump to a named part of the day and author the whole rig around it: sun
   * angle and colour, ambient, cloud, god rays, exposure, bloom and the lens.
   */
  setPhase(phase: string): void {
    const name = resolvePhase(phase, this.phaseName);
    const look = PHASE_LOOK[name];
    this.phaseName = name;
    this.look = look;

    // Azimuth and elevation are steered rather than cut, except that the sun
    // itself may be running free (frozen time) — then we own both.
    const az = this.w.sun.azimuth;
    const dAz = Math.abs(((look.azimuth - az + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dAz > 0.04) {
      this.azTarget = look.azimuth;
      this.azSteering = true;
    }
    this.elTarget = look.elevation;
    this.elSteering = true;
    this.seedTargets();
    // Re-resolve immediately so `snap()` (and any immediate read of the
    // target) already reflects the new phase rather than the outgoing one.
    this.buildTarget();
  }

  /** Push an event onto the director's own queue; it decides how to honour it. */
  fire(kind: EventKind, at?: Vec3, ttl?: number): void {
    const life = Math.max(0.2, ttl ?? EVENT_TTL[kind] ?? 20);
    const ev: WorldEvent = {
      id: nextLocalId--,
      kind,
      ttl: life,
      totalTtl: life,
      intensity: 0,
      at: at ? [at[0], at[1], at[2]] : [0, 0, 0],
      radius: 400,
      params: {},
      label: EVENT_TAG[kind],
    };
    this.queue.push({ ev, ttl: life, total: life });
  }

  /** Apply the current target with no easing at all. */
  snap(): void {
    const w = this.w;
    const wx = w.weather;
    for (const k of WX_KEYS) wx[k] = this.tw[k];
    wx.sky = this.targetSky;
    wx.precip = this.targetPrecip;

    const s = w.sun;
    s.azimuth = this.azSteering ? s.azimuth : this.azTarget;
    s.elevation = this.elTarget;
    for (const k of SUN_KEYS) s[k] = this.ts[k];
    for (const k of SUN_COL_KEYS) {
      const c = this.sunC[k];
      s[k][0] = c[0]; s[k][1] = c[1]; s[k][2] = c[2];
    }

    const l = w.lens;
    for (const k of LENS_KEYS) l[k] = this.tl[k];
    l.colorGrade[0] = this.grade[0];
    l.colorGrade[1] = this.grade[1];
    l.colorGrade[2] = this.grade[2];

    this.writeMirror();
    clampWeather(wx);
  }

  // ------------------------------------------------------------ per-frame

  /** Ease the world toward the target. `dt` is internally clamped. */
  update(dt: number): void {
    const d = clamp(Number.isFinite(dt) ? dt : 0, 0, MAX_DT);
    if (d <= 0) return;
    this.clock += d;
    this.ageQueue(d);
    this.followSun();
    this.buildTarget();
    this.cohere();
    this.ease(d);
  }

  /** Current narrative label, e.g. "overcast · squall line moving through". */
  describe(): string {
    const wx = this.w.weather;
    const parts: string[] = [];
    let live = 0;
    let tag = '';
    for (const q of this.queue) {
      if (q.ev.intensity > live) { live = q.ev.intensity; tag = EVENT_TAG[q.ev.kind]; }
    }
    for (const e of this.w.events) {
      if (e.intensity > live) { live = e.intensity; tag = EVENT_TAG[e.kind] ?? e.label; }
    }
    parts.push(wx.sky);
    if (wx.precip !== 'none') parts.push(wx.precip);
    const mods: string[] = [];
    if (wx.storminess > 0.55) mods.push(EVENT_TAG.monsoon);
    if (wx.godRays > 0.62) mods.push('shafts cutting the canyon');
    if (wx.haze > 0.55) mods.push('thick air');
    if (wx.wetness > 0.6) mods.push('wet asphalt');
    if (wx.motes > 0.6) mods.push('motes in the light');
    if (wx.sky === 'night') mods.push('lamplight and windows');
    else if (this.w.sun.elevation < 0.1) mods.push('long shadows');
    for (const m of mods) if (parts.indexOf(m) < 0) parts.push(m);
    if (live > 0.06) parts.push(tag);
    return parts.join(' · ');
  }

  // ------------------------------------------------------------ internals

  /** Copy the authored phase look into the base layer. */
  private seedTargets(): void {
    const look = this.look;
    const b = this.base;
    b.wx.cloudCover = look.cloudCover;
    b.wx.storminess = look.storminess;
    b.wx.haze = look.haze;
    b.wx.hazeFalloff = look.hazeFalloff;
    b.wx.windSpeed = look.windSpeed;
    b.wx.windDir = this.w.weather.windDir;
    b.wx.wetness = look.wetness;
    b.wx.aerialHaze = look.aerialHaze;
    b.wx.godRays = look.godRays;
    b.wx.motes = look.motes;
    b.wx.bloomStrength = look.bloomStrength;
    b.wx.scatter = look.scatter;

    b.sun.intensity = look.intensity;
    b.sun.ambientIntensity = look.ambientIntensity;
    b.sun.bounceIntensity = look.bounceIntensity;

    b.lens.fov = look.fov;
    b.lens.chroma = look.chroma;
    b.lens.grain = look.grain;
    b.lens.exposure = look.exposure;
    b.lens.saturation = look.saturation;
    b.lens.bloom = look.bloom;
    b.lens.vignette = look.vignette;
    b.lens.tiltShift = look.tiltShift;
    b.lens.focusWidth = look.focusWidth;
    b.lens.bokeh = look.bokeh;
    b.lens.warp = look.warp;
    b.lens.distortion = look.distortion;
    b.lens.horizonBend = look.horizonBend;

    this.baseSun = {
      color: [look.sunColor[0], look.sunColor[1], look.sunColor[2]],
      ambient: [look.ambient[0], look.ambient[1], look.ambient[2]],
      bounce: [look.bounce[0], look.bounce[1], look.bounce[2]],
    };
    this.baseGrade = [look.colorGrade[0], look.colorGrade[1], look.colorGrade[2]];
  }

  private baseSun: Record<SunColKey, Vec3> = {
    color: [1, 1, 1], ambient: [0, 0, 0], bounce: [0, 0, 0],
  };
  private baseGrade: Vec3 = [1, 1, 1];

  /**
   * Re-author the rig when the sun crosses into another part of the day, by the
   * running clock or by anything that writes the sun directly (`set_time`).
   * Without this the boot phase's rig was held all day, so a sunless city kept
   * the afternoon sun, ambient and exposure. Skipped while `setPhase` is steering
   * the sun, so a phase jump is not re-judged mid-flight. Only the look changes:
   * the sun angle stays with `integrateWorld`, and `ease` blends the rig across.
   */
  private followSun(): void {
    if (this.azSteering || this.elSteering) return;
    const name = phaseOf(this.w);
    if (name === this.phaseName) return;
    this.phaseName = name;
    this.look = PHASE_LOOK[name];
    this.seedTargets();
  }

  /** Age the director's own queue. It never owns `world.events`. */
  private ageQueue(dt: number): void {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.ttl -= dt;
      if (q.ttl <= 0) { this.queue.splice(i, 1); continue; }
      const life = saturate(1 - q.ttl / q.total);
      q.ev.intensity = saturate(Math.min(life / 0.25, 1 - Math.max(0, (life - 0.75) / 0.25)));
    }
  }

  /** Layer every live event over the phase look and resolve into the target. */
  private buildTarget(): void {
    const l = this.layer;
    l.reset();
    let strongest = 0;
    for (const q of this.queue) {
      const w = q.ev.intensity;
      if (w <= 0.001) continue;
      strongest = Math.max(strongest, w);
      EVENT_FX[q.ev.kind](l, w, q.ev);
    }
    // Events the conductor pushed onto `world.events` are honoured too; the
    // director reads their intensity but never ages or removes them.
    for (let i = 0; i < this.w.events.length; i++) {
      const e = this.w.events[i];
      const fx = EVENT_FX[e.kind];
      if (!fx) continue;
      const w = Number.isFinite(e.intensity) ? saturate(e.intensity) : 0;
      if (w <= 0.001) continue;
      strongest = Math.max(strongest, w);
      fx(l, w, e);
    }

    l.resolveNum('wx', this.tw, this.base.wx);
    l.resolveNum('sun', this.ts, this.base.sun);
    l.resolveNum('lens', this.tl, this.base.lens);
    l.resolveCol(this.sunC.color, this.baseSun.color, 'color');
    l.resolveCol(this.sunC.ambient, this.baseSun.ambient, 'ambient');
    l.resolveCol(this.sunC.bounce, this.baseSun.bounce, 'bounce');
    l.resolveGrade(this.grade, this.baseGrade);
    this.targetSky = l.skyOr(this.look.sky);
    this.targetPrecip = l.precipOr(this.look.precip);
    this.eventWeight = strongest;
  }

  private eventWeight = 0;

  /**
   * Push coupled fields toward each other so the director cannot author an
   * impossible sky. Runs on the *target*, after every event layer.
   */
  private cohere(): void {
    const t = this.tw;
    const rainLike = this.targetPrecip === 'rain' || this.targetPrecip === 'drizzle';

    if (t.storminess > 0.2) {
      // Storms raise wind and pull cloud in.
      t.windSpeed = Math.max(t.windSpeed, 4.2 + 26 * t.storminess);
      t.cloudCover = Math.max(t.cloudCover, 0.4 + 0.55 * t.storminess);
    }
    if (rainLike) {
      // Rain soaks the ground and thickens the air above it.
      t.wetness = Math.max(t.wetness, 0.45);
      t.haze = Math.max(t.haze, 0.28);
    }
    if (t.wetness > 0.35) {
      // Wet ground flattens the fog profile: it hugs the deck instead of
      // climbing the canyon.
      t.hazeFalloff = Math.min(t.hazeFalloff, 0.055 + 0.06 * (1 - t.wetness));
    }
    if (t.godRays > 0.5) {
      // Strong shafts imply thin, broken cloud — you cannot see a beam through
      // a solid deck.
      t.cloudCover = Math.min(t.cloudCover, 0.28 + 0.9 * (1 - t.godRays));
    }
    if (this.targetSky === 'storm') t.storminess = Math.max(t.storminess, 0.55);
    if (this.targetSky === 'overcast') t.cloudCover = Math.max(t.cloudCover, 0.62);
    if (this.targetSky === 'clear') t.cloudCover = Math.min(t.cloudCover, 0.34);

    t.cloudCover = clamp(t.cloudCover, 0, 1);
    t.storminess = clamp(t.storminess, 0, 1);
    t.haze = clamp(t.haze, 0, 1);
    t.wetness = clamp(t.wetness, 0, 1);
    t.godRays = clamp(t.godRays, 0, 1);
    t.motes = clamp(t.motes, 0, 1);
    t.bloomStrength = clamp(t.bloomStrength, 0, 1);
    t.scatter = clamp(t.scatter, 0, 1);
    t.hazeFalloff = clamp(t.hazeFalloff, 0.008, 0.24);
    t.windSpeed = clamp(t.windSpeed, 0, 40);
  }

  /** Wetness rate `integrateWorld` will apply this frame, cancelled after our ease. */
  private wetBias = 0;
  /** Same, for the storm-driven wind pull in `integrateWorld`. */
  private windBias = 0;

  /** One damped approach per field. Nothing snaps. */
  private ease(dt: number): void {
    const w = this.w;
    const rainLike =
      this.targetPrecip === 'rain' || this.targetPrecip === 'drizzle';
    this.wetBias = rainLike ? 0.08 : -0.012;
    this.windBias = this.tw.storminess > 0.4 ? 0.4 : 0;
    const wx = w.weather;
    let gap = 0;

    for (const k of WX_KEYS) {
      const tgt = this.tw[k];
      const before = wx[k];
      wx[k] = damp(before, tgt, WX_RATE[k], dt);
      gap += Math.abs(wx[k] - tgt);
    }
    // `integrateWorld` also relaxes wetness — it soaks it while it is raining
    // and dries it otherwise — and it runs before us every frame. Undo that
    // delta here so the director, not the integrator, decides the value. Left
    // alone, the two laws fight and wetness parks ~0.16 below its target.
    if (this.wetBias !== 0) wx.wetness = clamp(wx.wetness - this.wetBias * dt, 0, 1);

    // `integrateWorld` also pulls wind toward `4.2 + 22*storminess` once a cell
    // is up. Cancel that too, for the same reason.
    if (this.windBias > 0) {
      const pull = 4.2 + 22 * this.tw.storminess;
      const k = 1 - Math.exp(-0.4 * dt);
      wx.windSpeed += (pull - wx.windSpeed) * k - this.windBias * dt;
      if (wx.windSpeed < 0) wx.windSpeed = 0;
    }
    wx.sky = this.targetSky;
    wx.precip = this.targetPrecip;
    clampWeather(wx);

    // Sun: steer the angle only while a phase jump is in flight, then hand it
    // back to `integrateWorld` so the two never fight.
    const s = w.sun;
    if (this.azSteering) {
      const d = ((this.azTarget - s.azimuth + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      if (Math.abs(d) < 0.004) {
        // Land exactly on the authored azimuth rather than easing asymptotically.
        s.azimuth = this.azTarget;
        this.azSteering = false;
      } else {
        s.azimuth = (s.azimuth + d * (1 - Math.exp(-3.2 * dt)) + Math.PI * 2) % (Math.PI * 2);
      }
      gap += Math.abs(d);
    }
    if (this.elSteering) {
      const before = s.elevation;
      s.elevation = damp(before, this.elTarget, 5.5, dt);
      if (Math.abs(s.elevation - this.elTarget) < 0.01) {
        s.elevation = this.elTarget;
        this.elSteering = false;
      }
      gap += Math.abs(s.elevation - this.elTarget);
    } else {
      this.elTarget = s.elevation;
    }
    for (const k of SUN_KEYS) {
      const tgt = this.ts[k];
      s[k] = damp(s[k], tgt, SUN_RATE[k], dt);
      gap += Math.abs(s[k] - tgt);
    }
    for (const k of SUN_COL_KEYS) {
      const src = this.sunC[k];
      const dst = s[k];
      for (let i = 0; i < 3; i++) {
        dst[i] = damp(dst[i], src[i], COL_RATE, dt);
        gap += Math.abs(dst[i] - src[i]);
      }
    }

    const l = w.lens;
    for (const k of LENS_KEYS) {
      const tgt = this.tl[k];
      l[k] = damp(l[k], tgt, LENS_RATE[k], dt);
      gap += Math.abs(l[k] - tgt);
    }
    for (let i = 0; i < 3; i++) {
      l.colorGrade[i] = damp(l.colorGrade[i], this.grade[i], COL_RATE, dt);
      gap += Math.abs(l.colorGrade[i] - this.grade[i]);
    }

    // `blend` is the summed normalised gap, floored by live event weight and
    // held briefly so a one-frame transient still registers as "steering".
    const norm = saturate(gap / 12);
    this.blendAmt = Math.max(norm, this.eventWeight * 0.8, this.blendAmt - dt * 0.6);
    if (this.blendAmt > this.blendPeak) this.blendPeak = this.blendAmt;

    this.writeMirror();
  }

  /** Keep the public mirrors in step for HUDs and tests. */
  private writeMirror(): void {
    const t = this.targetWeather;
    for (const k of WX_KEYS) t[k] = this.tw[k];
    t.sky = this.targetSky;
    t.precip = this.targetPrecip;

    const ts = this.targetSun;
    for (const k of SUN_KEYS) ts[k] = this.ts[k];
    ts.azimuth = this.azTarget;
    ts.elevation = this.elTarget;
    ts.color = [this.sunC.color[0], this.sunC.color[1], this.sunC.color[2]];
    ts.ambient = [this.sunC.ambient[0], this.sunC.ambient[1], this.sunC.ambient[2]];
    ts.bounce = [this.sunC.bounce[0], this.sunC.bounce[1], this.sunC.bounce[2]];
    ts.dayLength = this.w.sun.dayLength;

    const tl = this.targetLens;
    for (const k of LENS_KEYS) tl[k] = this.tl[k];
    tl.roll = this.w.lens.roll;
    tl.focusCenter = this.w.lens.focusCenter;
    tl.colorGrade = [this.grade[0], this.grade[1], this.grade[2]];
  }
}
