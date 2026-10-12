/**
 * District archetypes. Each is a colour identity plus a form grammar: the city
 * generator reads these to decide what a lot looks like, how wide the canyon in
 * front of it runs, and how much junk hangs off the facade.
 *
 * Every colour in this file is LINEAR (via `hexLinear`) because the renderer
 * tonemaps at the very end and never works in sRGB.
 */

import { fbm2, hexLinear, makeRng, v3lerp, v3scale, type Vec2, type Vec3 } from '../core/math';

export type WindowStyle =
  | 'grid' | 'ribbon' | 'mosaic' | 'shutter' | 'arcade'
  | 'mullion' | 'louvre' | 'pergola' | 'stacked' | 'curtainwall';

export type RoofStyle =
  | 'flat-garden' | 'terraces' | 'stepped' | 'shed' | 'sawtooth'
  | 'dome' | 'spire' | 'antenna-forest' | 'greenhouse' | 'mast';

/** Linear-RGB material identity of a district. */
export interface DistrictPalette {
  base: Vec3;
  secondary: Vec3;
  trim: Vec3;
  glass: Vec3;
  roof: Vec3;
  ground: Vec3;
  foliage: Vec3;
  metal: Vec3;
  water: Vec3;
  emissive: Vec3;
}

export interface DistrictStyle {
  id: number;
  key: string;
  name: string;
  palette: DistrictPalette;
  /** Building heights in metres, before the density gradient is applied. */
  heightRange: [number, number];
  /** Plan half-extent range in metres. */
  footprintRange: [number, number];
  /** Peak lean toward the canyon, radians. */
  leanAmount: number;
  /** Multiplier on the required canyon width. >1 = more open. */
  gapBias: number;
  /** 0..1 rooftop + facade planting. */
  greenery: number;
  /** Multiplier on cables, brackets, signs, clutter. */
  cableDensity: number;
  /**
   * Multiplier on facade and rooftop props only. Split from `cableDensity` in
   * round 4: one knob starved lantern-bazaar's signs and lanterns 3.3x for a
   * cable decision that had nothing to do with its facades. Cables read
   * `cableDensity`; `placeProps` reads this.
   */
  clutterDensity: number;
  windowStyle: WindowStyle;
  /**
   * Window glass reflects the cladding colour, so the grid is barely there and
   * the tower keeps its colour (owner direction 2026-10-10 for the teal towers).
   */
  reflectiveGlass?: true;
  accentColor: Vec3;
  roofStyle: RoofStyle;
  description: string;
}

export interface ResolvedPalette extends DistrictPalette {
  /** Darker, cooler facade variant. */
  shadeLo: Vec3;
  /** Lighter, sun-bleached facade variant. */
  shadeHi: Vec3;
}

const pal = (
  base: string, secondary: string, trim: string, glass: string, roof: string,
  ground: string, foliage: string, metal: string, water: string, emissive: string,
): DistrictPalette => ({
  base: hexLinear(base), secondary: hexLinear(secondary), trim: hexLinear(trim),
  glass: hexLinear(glass), roof: hexLinear(roof), ground: hexLinear(ground),
  foliage: hexLinear(foliage), metal: hexLinear(metal), water: hexLinear(water),
  emissive: hexLinear(emissive),
});

export const DISTRICT_STYLES: DistrictStyle[] = [
  {
    id: 0, key: 'verdant-canyon', name: 'Verdant Canyon',
    palette: pal('#e9e4d6', '#d6cdb9', '#b08a66', '#9fc4bd', '#7c9070', '#6f6b5f', '#4f8a3c', '#7e8a86', '#2f6f6c', '#ffd9a0'),
    // Mid-rise garden suburbs on the green belt (D29); at 130-430 m the outskirts
    // walled off the downtown skyline from every outer viewpoint.
    heightRange: [45, 150], footprintRange: [15, 27],
    leanAmount: 0.032, gapBias: 1.15, greenery: 0.92, cableDensity: 1.0, clutterDensity: 1.0,
    windowStyle: 'pergola', accentColor: hexLinear('#2f8f6a'), roofStyle: 'flat-garden',
    description: 'White concrete and warm timber, curtains of vine, planters on every sill.',
  },
  {
    id: 1, key: 'copper-stacks', name: 'Copper Stacks',
    palette: pal('#4e8f86', '#3c6d68', '#c96a2e', '#2f4f52', '#35706a', '#5c554a', '#6b8f4a', '#7b6b5b', '#205055', '#ff9a4a'),
    heightRange: [190, 520], footprintRange: [17, 31],
    leanAmount: 0.019, gapBias: 0.92, greenery: 0.36, cableDensity: 1.4, clutterDensity: 0.8,
    reflectiveGlass: true,
    windowStyle: 'louvre', accentColor: hexLinear('#e07a2f'), roofStyle: 'antenna-forest',
    description: 'Oxidised copper cladding, orange patina streaks, industrial flues above the parapet.',
  },
  {
    id: 2, key: 'terracotta-tiers', name: 'Terracotta Tiers',
    palette: pal('#b5623a', '#9c4c30', '#d9a05b', '#7d8f9a', '#a8542f', '#7b6653', '#7f8f3f', '#8b6b4b', '#405b5d', '#ffb15e'),
    heightRange: [55, 210], footprintRange: [25, 47],
    leanAmount: 0.008, gapBias: 1.32, greenery: 0.5, cableDensity: 0.7, clutterDensity: 0.5,
    windowStyle: 'stacked', accentColor: hexLinear('#e08a3c'), roofStyle: 'terraces',
    description: 'Stepped ziggurat blocks of terracotta and ochre, wide planted terrace shoulders.',
  },
  {
    id: 3, key: 'glass-foxholes', name: 'Glass Foxholes',
    palette: pal('#b4c8d4', '#8fa9b8', '#6e828f', '#9db9cb', '#7c8b98', '#6b7683', '#6d8a6a', '#8da2ab', '#2d6b81', '#ffb35e'),
    heightRange: [210, 570], footprintRange: [19, 35],
    leanAmount: 0.013, gapBias: 0.86, greenery: 0.3, cableDensity: 1.5, clutterDensity: 0.7,
    reflectiveGlass: true,
    windowStyle: 'mullion', accentColor: hexLinear('#4f9fc4'), roofStyle: 'mast',
    description: 'Pale steel-blue glass over blue-grey metal, cold and reflective, very few openings.',
  },
  {
    id: 4, key: 'lantern-bazaar', name: 'Lantern Bazaar',
    palette: pal('#a04a30', '#7c4430', '#c9302c', '#ffcf6a', '#5b3b2d', '#50453d', '#5f8f3f', '#7b6b59', '#2b4b4b', '#ff4a2a'),
    heightRange: [18, 78], footprintRange: [10, 23],
    leanAmount: 0.055, gapBias: 1.48, greenery: 0.26, cableDensity: 0.6, clutterDensity: 1.7,
    windowStyle: 'shutter', accentColor: hexLinear('#ff3b2e'), roofStyle: 'flat-garden',
    description: 'Low, leaning, over-signed shophouses. Red and gold signage on every facade.',
  },
  {
    id: 5, key: 'rust-hangars', name: 'Rust Hangars',
    palette: pal('#55606c', '#505c68', '#6a7683', '#4e5e66', '#4e5a66', '#585f68', '#5f7a5f', '#767f8a', '#2f4147', '#ffa060'),
    heightRange: [26, 92], footprintRange: [31, 63],
    leanAmount: 0.006, gapBias: 1.12, greenery: 0.22, cableDensity: 0.5, clutterDensity: 0.4,
    windowStyle: 'ribbon', accentColor: hexLinear('#c0562a'), roofStyle: 'sawtooth',
    description: 'Big-span steel sheds in blue-grey, clerestory ribbons along the ridge.',
  },
  {
    id: 6, key: 'monastery-spire', name: 'Monastery Spire',
    palette: pal('#ddd7c9', '#c9c1b1', '#2f8f6a', '#a8c8c4', '#a9a395', '#8b8579', '#4f8a4a', '#9b9589', '#2b5b59', '#ffd8a8'),
    heightRange: [270, 600], footprintRange: [13, 23],
    leanAmount: 0.052, gapBias: 1.06, greenery: 0.82, cableDensity: 1.7, clutterDensity: 0.6,
    windowStyle: 'arcade', accentColor: hexLinear('#2f9a72'), roofStyle: 'spire',
    description: 'Pale stone needle towers, verdigris domes, terraced herb gardens between them.',
  },
  {
    id: 7, key: 'neon-arcology', name: 'Neon Arcology',
    palette: pal('#4a2a8a', '#0f4a52', '#b040c0', '#6a4ad0', '#232351', '#2b2b39', '#3a6a5a', '#5b5b7b', '#2b2b7b', '#ff40d0'),
    heightRange: [310, 600], footprintRange: [42, 92],
    leanAmount: 0.021, gapBias: 0.72, greenery: 0.35, cableDensity: 1.9, clutterDensity: 1.1,
    windowStyle: 'curtainwall', accentColor: hexLinear('#e040c0'), roofStyle: 'antenna-forest',
    description: 'Single mega-structures in deep indigo, magenta edge light, skybridges at every level.',
  },
  {
    id: 8, key: 'botanical-dome', name: 'Botanical Dome',
    palette: pal('#c8dcc4', '#a8c8a4', '#4f8f4a', '#c0e8d0', '#8ab888', '#6b7b60', '#3f9a3a', '#7b8b73', '#2b6b5b', '#8affa0'),
    heightRange: [42, 165], footprintRange: [35, 71],
    leanAmount: 0.011, gapBias: 1.26, greenery: 1.0, cableDensity: 0.4, clutterDensity: 0.3,
    windowStyle: 'grid', accentColor: hexLinear('#2fa04a'), roofStyle: 'greenhouse',
    description: 'Vaulted glasshouses glowing green from the inside, condensation on the panes.',
  },
  {
    id: 9, key: 'canal-district', name: 'Canal District',
    palette: pal('#8b98a3', '#7e8b96', '#7f92a3', '#9cbdc9', '#7e8891', '#6e757d', '#68806a', '#7b8b93', '#2b606c', '#ffc880'),
    // Quay warehouses are low (D29); at 45-190 m they walled the canal views.
    heightRange: [25, 90], footprintRange: [15, 29],
    leanAmount: 0.036, gapBias: 1.2, greenery: 0.6, cableDensity: 0.9, clutterDensity: 0.9,
    windowStyle: 'grid', accentColor: hexLinear('#3f7f9a'), roofStyle: 'flat-garden',
    description: 'Warehouse conversions in blue-grey stone on the quay walls, mooring bollards, washing on the balconies.',
  },
  {
    id: 10, key: 'market-spine', name: 'Market Spine',
    palette: pal('#9b6b4b', '#805739', '#d8a03c', '#ffd07a', '#705034', '#6b5d4f', '#6f9a45', '#8b7b63', '#305152', '#ffa028'),
    heightRange: [15, 62], footprintRange: [9, 19],
    leanAmount: 0.058, gapBias: 1.52, greenery: 0.3, cableDensity: 0.6, clutterDensity: 1.95,
    windowStyle: 'shutter', accentColor: hexLinear('#ffab2e'), roofStyle: 'flat-garden',
    description: 'The night-market street. Awnings, steam, signage hung off brackets into the road. Authored property: no facade lots ever front it (100% foul at both seeds) — the district is road plus stalls, and its facades belong to neighbouring districts.',
  },
];

export const DISTRICT_COUNT = DISTRICT_STYLES.length;
export const CANAL_DISTRICT = 9;
export const MARKET_DISTRICT = 10;

/** Districts that may appear from the organic field (the rest are spine-driven). */
export const ORGANIC_DISTRICTS: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

/** Index into {@link DISTRICT_STYLES}, wrapping for out-of-range ids. */
export const districtStyle = (id: number): DistrictStyle =>
  DISTRICT_STYLES[((id | 0) % DISTRICT_COUNT + DISTRICT_COUNT) % DISTRICT_COUNT];

/** Linear palette plus the shade variants a renderer needs for facade variation. */
export function districtPaletteLinear(style: DistrictStyle): ResolvedPalette {
  const p = style.palette;
  return {
    ...p,
    shadeLo: v3lerp(v3scale(p.base, 0.62), [0.02, 0.028, 0.05], 0.28),
    shadeHi: v3lerp(p.base, [0.95, 0.93, 0.88], 0.34),
  };
}

// ---------------------------------------------------------------- spines

export type SpineKey = 'canal' | 'market' | 'rail' | 'artery';

/** A deliberate linear city feature: a wavy line with a corridor around it. */
export interface SpineLine {
  key: SpineKey;
  bearing: number;
  originX: number;
  originZ: number;
  /** Lateral wander amplitude in metres. */
  amp: number;
  /** Wander frequency, cycles per metre. */
  freq: number;
  phase: number;
  /** Full corridor width in metres. */
  width: number;
}

export interface SpineHit {
  /** Perpendicular distance from the query point to the centreline. */
  dist: number;
  /** Closest point on the centreline. */
  px: number;
  pz: number;
  /** Unit tangent of the centreline at that point. */
  tx: number;
  tz: number;
  /** Distance along the spine from its origin. */
  along: number;
}

const scratchHit: SpineHit = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 };

/** Projects a point onto a spine, filling and returning `out`. */
export function spineHit(s: SpineLine, x: number, z: number, out: SpineHit): SpineHit {
  const dx = x - s.originX, dz = z - s.originZ;
  const ca = Math.cos(s.bearing), sa = Math.sin(s.bearing);
  const along = dx * ca + dz * sa;
  const perp = -dx * sa + dz * ca;
  const y0 = (along - 5) * s.freq + s.phase;
  const y1 = (along + 5) * s.freq + s.phase;
  const w0 = s.amp * fbm2(y0, s.phase * 0.7 + 4.2, 2);
  const w1 = s.amp * fbm2(y1, s.phase * 0.7 + 4.2, 2);
  const off = (w0 + w1) * 0.5;
  const slope = (w1 - w0) * 0.1;
  const inv = 1 / Math.sqrt(1 + slope * slope);
  out.dist = Math.abs(perp - off) * inv;
  out.along = along;
  out.px = s.originX + along * ca - off * sa;
  out.pz = s.originZ + along * sa + off * ca;
  const tc = (1 - slope * slope) * inv;
  const tu = slope * inv;
  const tx = ca * tc - sa * tu, tz = sa * tc + ca * tu;
  const l = Math.hypot(tx, tz) || 1;
  out.tx = tx / l;
  out.tz = tz / l;
  return out;
}

export interface DistrictField {
  seed: number;
  canal: SpineLine;
  market: SpineLine;
  rail: SpineLine;
  /** Noise-space offset so different seeds give different city plans. */
  ox: number;
  oz: number;
  /**
   * Bearing (radians, atan2(z, x) from the origin) of the downtown wedge. It sits
   * at a fixed relation to the market road, so it turns with the road per seed.
   */
  downtownBearing: number;
}

const fieldCache = new Map<number, DistrictField>();

/** Per-seed district layout: spines, the organic table, and the downtown core. */
export function districtField(seed: number): DistrictField {
  const hit = fieldCache.get(seed);
  if (hit) return hit;
  const r = makeRng((seed ^ 0x5f3a1c7d) >>> 0);
  const f: DistrictField = {
    seed,
    canal: {
      key: 'canal', bearing: r.range(0, Math.PI * 2), originX: r.range(-500, 500), originZ: r.range(-500, 500),
      amp: r.range(620, 1050), freq: r.range(0.00022, 0.00034), phase: r.range(0, 100),
      width: r.range(46, 62),
    },
    market: {
      key: 'market', bearing: r.range(0, Math.PI * 2), originX: 0, originZ: 0,
      amp: r.range(240, 430), freq: r.range(0.00045, 0.00070), phase: r.range(0, 100),
      width: r.range(26, 36),
    },
    rail: {
      key: 'rail', bearing: r.range(0, Math.PI * 2), originX: 0, originZ: 0,
      amp: r.range(380, 700), freq: r.range(0.00030, 0.00048), phase: r.range(0, 100),
      width: r.range(24, 34),
    },
    ox: r.range(0, 900),
    oz: r.range(0, 900),
    downtownBearing: 0,
  };
  // Downtown grew beside the market road, 50 degrees to its left (D29).
  f.downtownBearing = Math.atan2(Math.sin(f.market.bearing), Math.cos(f.market.bearing)) - 0.88;
  if (fieldCache.size > 8) fieldCache.delete(fieldCache.keys().next().value as number);
  fieldCache.set(seed, f);
  return f;
}

/** Water depth in metres at a world position; 0 on dry land. */
export function waterDepthAt(x: number, z: number, seed: number): number {
  const f = districtField(seed);
  const h = spineHit(f.canal, x, z, scratchHit);
  const half = f.canal.width * 0.42;
  if (h.dist >= half) return 0;
  const t = 1 - h.dist / half;
  return 4.2 * t * t;
}

/** Which district a world position falls in. */
export function districtAt(x: number, z: number, seed: number): number {
  return districtAtField(districtField(seed), x, z);
}

/** {@link districtAt} against a precomputed field — use this in hot loops. */
/**
 * The city plan as a history (DECISIONS D29), not a noise table. Every district
 * appears, each where its story puts it. The old organic table picked from about
 * 25 noise cells: terracotta-tiers and neon-arcology never appeared, copper-stacks
 * took 38% of the land, and the downtown core blended into the outer table in
 * concentric rings around the origin.
 *
 *   old town (terracotta-tiers, sheet C)  around the canal-market crossing, r < ~360 m
 *   lantern bazaar                        both sides of the market road, out to ~1.15 km
 *   downtown                              a +/-66 deg wedge beside the market road:
 *     neon-arcology heart, copper-stacks body, glass-foxholes flanks and far edge
 *   canal quarter (canal-district)        the quays, outside downtown
 *   monastery hill (monastery-spire)      a small rise beside the old town
 *   industrial belt (rust-hangars)        along the railway
 *   suburbs / green belt                  terracotta and bazaar suburbs, then
 *                                         verdant-canyon and botanical-dome outskirts
 *
 * Edges are domain-warped so the quarters read as grown, not drawn.
 */
export function districtAtField(f: DistrictField, x: number, z: number): number {
  const h = scratchHit;
  spineHit(f.canal, x, z, h);
  const dCanal = h.dist;
  if (dCanal < f.canal.width * 0.6) return CANAL_DISTRICT;
  spineHit(f.market, x, z, h);
  const dMarket = h.dist;
  if (dMarket < f.market.width * 0.55) return MARKET_DISTRICT;

  const fx = (x + f.ox) * 0.0021, fz = (z + f.oz) * 0.0021;
  const n1 = fbm2(fx + 3.1, fz - 1.7, 3), n2 = fbm2(fx * 1.3 - 8.2, fz * 1.3 + 2.6, 3);
  const r = Math.hypot(x, z) + 150 * n1;
  let th = Math.atan2(z, x) - f.downtownBearing + 0.3 * n2;
  th = Math.atan2(Math.sin(th), Math.cos(th));

  // The market road and its bazaar, from the old town outward.
  if (dMarket < f.market.width * 0.55 + 115 + 45 * n2 && r < 1150) return 4;
  if (r < 360) return 2;

  if (Math.abs(th) < 1.3 && r < 1800) {
    const hx = Math.cos(f.downtownBearing) * 900, hz = Math.sin(f.downtownBearing) * 900;
    if (Math.hypot(x - hx, z - hz) * (1 + 0.25 * Math.sin(Math.atan2(z - hz, x - hx) * 3)) + 110 * n1 < 250) return 7;
    return Math.abs(th) > 1.07 || r > 1620 ? 3 : 1;
  }
  if (dCanal < f.canal.width * 0.6 + 105 + 35 * n1) return CANAL_DISTRICT;
  spineHit(f.rail, x, z, h);
  // The railway's industrial belt, wider where estates spread out beyond the suburbs.
  if (h.dist < f.rail.width * 0.8 + 75 + 30 * n2 + (r > 1000 ? 110 : 0)) return 5;
  const mb = f.downtownBearing + 2.45;
  const mx = x - Math.cos(mb) * 640, mz = z - Math.sin(mb) * 640;
  if (Math.hypot(mx * 0.8, mz * 1.25) + 140 * fbm2(fx * 3 + 1.3, fz * 3 - 7.1, 2) < 200) return 6;

  // Suburbs (terracotta on one side, bazaar on the other), then the green belt
  // in patches: garden suburbs (verdant) and glasshouse farms (botanical).
  if (r < 1050 + 120 * n2) return th > 0 ? 2 : 4;
  const n3 = fbm2(fx * 0.85 + 5.5, fz * 0.85 - 3.3, 3);
  return n3 > 0.1 ? 0 : n3 < -0.12 ? 8 : (th > 0 ? 2 : 4);
}

/** Planar coordinates of a spine at distance `along` from its origin. */
export const spinePoint = (s: SpineLine, along: number): Vec2 => {
  const ca = Math.cos(s.bearing), sa = Math.sin(s.bearing);
  const off = s.amp * fbm2(along * s.freq + s.phase, s.phase * 0.7 + 4.2, 2);
  return [s.originX + along * ca - off * sa, s.originZ + along * sa + off * ca];
};
