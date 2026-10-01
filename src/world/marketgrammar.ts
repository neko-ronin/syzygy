/**
 * Market grammar: what a market street *is*, as data.
 *
 * The market was a phantom. `DistrictField.market` forced a `RoadKind` of
 * `'market'` through the origin and a district id of 10, and that was the whole
 * of it — no stall, no tarpaulin, no lantern, no crate. `MARKET_DISTRICT` had
 * exactly one reference in the repo and `spinePoint` had none.
 *
 * This module is the missing half: a pure function from (plan, chunk, kind,
 * district) to plain descriptors. No GPU, no WGSL, no MeshBuilder, no
 * `Math.random`. It is testable without a device and it ports to a different
 * mesh layer unchanged, which is why the geometry lives in
 * `src/render/marketbake.ts` instead of here.
 *
 * ── The layout rule ────────────────────────────────────────────────────────
 * The spine is 26-36 m wide, so a stall row does not fit in the carriageway
 * and is not trying to. Each stall straddles the kerb line:
 *
 *      road        kerb line                    building face
 *   ───────────────┬───────────┬──────────────────┬─────────────
 *                  │ overhang  │   counter/vent   │  crates     │
 *       overhang 1.1-2.3 m      depth 1.7-2.7 m
 *
 * so the tarpaulin breaks the sky over the footway *and* reaches out over the
 * carriageway, which is what a night-market street looks like from inside it.
 * The building-side edge is then pulled in until the stall clears every facade
 * near it — see {@link FACADE_CLEARANCE} for why that is measured, not assumed.
 *
 * ── Determinism ────────────────────────────────────────────────────────────
 * Every element draws from its own `Rng` forked off a seed derived from
 * (seed, cx, cz) — not from `ctx.rng`. That is stronger than determinism, not
 * weaker: it makes the output independent of how many times, and in what order,
 * the bake happens to call this. A grammar whose output shifts when a caller is
 * added upstream is a grammar that will silently change the city, and nothing
 * would report it.
 *
 * ── Units ──────────────────────────────────────────────────────────────────
 * Every height in a descriptor is an absolute world Y, deck included. Half of
 * them used to be "above the deck" and half absolute, which is the kind of
 * convention that survives right up until a sign board ends up under the road.
 */

import { clamp, lerp, makeRng, fbm2, type Vec3 } from '../core/math';
import { GROUND_Y } from './citygen';
import type { CityChunk, CityPlan, RoadKind } from './citygen';
import {
  MARKET_DISTRICT, districtPaletteLinear, districtStyle, spineHit, spinePoint,
  type ResolvedPalette, type SpineHit,
} from './districts';

/** `lantern-bazaar`, the low-rise shophouse district that wraps the spine. */
export const LANTERN_BAZAAR = 4;
/**
 * Districts that get market dressing. Checked by id, so renaming a district
 * cannot silently take its stalls with it.
 */
export const MARKET_DISTRICTS: readonly number[] = [LANTERN_BAZAAR, MARKET_DISTRICT];
/** Market dressing stops existing entirely from this LOD up. */
export const MARKET_LOD_GONE = 2;

/**
 * Coarsest LOD at which an element still appears. Higher LOD is coarser, so a
 * descriptor tagged `lod: 0` is gone as soon as the chunk reaches LOD 1.
 */
export type MarketLod = 0 | 1;
/**
 * Coarsest LOD the legs, guys and counter survive at. Separate from the roof's
 * own tag because a canopy with nothing holding it up is the single worst thing
 * this grammar could emit.
 */
export const RIGGING_LOD: MarketLod = 0;

// ---------------------------------------------------------------- the rules

/**
 * Half-amplitude of the pitch noise, measured.
 *
 * This is the number that was wrong before. `noise2` is Perlin and peaks near
 * 0.46 in practice, not 1.0; assuming a unit amplitude made the pitch noise
 * cover 2.6-3.8 m of a declared 1.9-4.4 m range and turned the "low-frequency
 * variation between dense runs and quiet gaps" into a flat comb. Measured over
 * five seeds with `fbm2(a / PITCH_WAVELENGTH, bias, 3)`: -0.295 .. 0.474.
 */
export const PITCH_NOISE_SCALE = 0.48;

/** Stall pitch, metres, for a dense run and for a quiet one. */
export const PITCH_MIN = 1.9;
export const PITCH_MAX = 4.4;
/** Clear gap between neighbouring stalls, metres. */
export const STALL_SEPARATION = 0.22;
/** Wavelength of the pitch noise along the spine, metres. */
export const PITCH_WAVELENGTH = 190;

/**
 * Runs and gaps, in metres, not in noise.
 *
 * These were a threshold on `fbm2` before, and they could not work: a one-
 * dimensional slice of two-dimensional Perlin never visits its full range, so a
 * threshold that ought to open a quarter of the slots opened 0.7% of them
 * (measured). A threshold is also the wrong shape — it makes isolated holes
 * rather than stretches. Run lengths are a discrete event, so they are drawn
 * from a hash, which has a distribution you know.
 */
export const RUN_MIN_M = 12;
export const RUN_MAX_M = 46;
export const GAP_MIN_M = 4;
export const GAP_MAX_M = 17;

/** Per-district pitch scale. The bazaar is tighter than the spine itself. */
const PITCH_SCALE: Record<number, number> = {
  [LANTERN_BAZAAR]: 0.86,
  [MARKET_DISTRICT]: 1.0,
};

/** How far the tarpaulin reaches back from the kerb line, out over the road. */
export const OVERHANG_MIN = 1.1;
export const OVERHANG_MAX = 2.3;
/** Depth of the stall from the kerb line out to the building face. */
export const DEPTH_MIN = 1.7;
export const DEPTH_MAX = 2.7;
/** Height of the tarpaulin's low (roadward) edge above the deck. */
export const EAVE_MIN = 2.25;
export const EAVE_MAX = 2.6;
/** Height of its high edge, where it leans on the building. */
export const RIDGE_MIN = 2.85;
export const RIDGE_MAX = 3.4;
/** Belly of the cloth between supports, as a fraction of the span it crosses.
 *  A tarp that does not sag reads as a board. */
export const SAG_ALONG = 0.055;
export const SAG_ACROSS = 0.09;

/**
 * How far a stall's building-side edge must stand off the nearest facade.
 *
 * Measured at seed 42 over 234 samples along the spine: the nearest building
 * footprint is 13.1 m from the centreline at the 5th percentile and 25.6 m at
 * the 25th, against a half-width of 17.6 m. A fixed `DEPTH_MAX` therefore drove
 * stalls straight through walls on 17% of the spine. The edge is pulled in
 * until the stall is clear instead.
 */
export const FACADE_CLEARANCE = 0.3;
/** Step the edge is pulled in by, metres. Small enough not to quantise the row. */
export const BACK_TRIM_STEP = 0.12;
/** Below this depth there is no stall; the slot is left empty rather than put a
 *  trestle table in the middle of a pavement. */
export const MIN_STALL_DEPTH = 0.85;

/** Counter height, metres — a trestle table, not a counter. */
export const COUNTER_TOP = 0.92;

/**
 * One stall in this many carries a projecting illuminated sign. Section B of
 * `docs/STREET_SPEC.md` counts "roughly 5-8 nearby projecting illuminated
 * panels" in one view and "roughly 15-25 glowing sign/fixture silhouettes"
 * across a canyon; at one in three stalls the measured density was 3.2 signs
 * per 30 m of street, which reads as signage rather than as a sign field.
 */
export const SIGN_EVERY = 2;
/** Sign arm height range above the deck. */
export const SIGN_Y_MIN = 3.6;
export const SIGN_Y_MAX = 5.2;
/** How far the arm reaches out over the carriageway. */
export const SIGN_ARM_MIN = 1.6;
export const SIGN_ARM_MAX = 2.9;

/**
 * Hanging cloth: pennants and laundry strips on the same cord idiom as the
 * lanterns. Section C of the spec lists "hanging pennant/laundry-like strips"
 * among the things actually visible in the fire-lit reference, so this is the
 * one market element with direct evidence behind it.
 */
export const CLOTH_PER_STRING_MIN = 6;
export const CLOTH_PER_STRING_MAX = 15;
/** A pennant is short; a laundry strip is long. */
export const PENNANT_DROP_MIN = 0.45;
export const PENNANT_DROP_MAX = 0.85;
export const STRIP_DROP_MIN = 0.95;
export const STRIP_DROP_MAX = 1.45;
/** Half-width at the top of the cloth, metres. */
export const CLOTH_HALF_WIDTH_MIN = 0.13;
export const CLOTH_HALF_WIDTH_MAX = 0.3;
/** One cord in this many carries cloth rather than lanterns alone. */
export const CLOTH_EVERY_STRING = 2;

/** Spacing of lantern cords along the spine. */
export const STRING_PITCH_MIN = 17;
export const STRING_PITCH_MAX = 31;
/** Height the cord is anchored at on each building face. */
export const STRING_ANCHOR_MIN = 7.0;
export const STRING_ANCHOR_MAX = 9.5;
/** Depth of the catenary belly. */
export const STRING_SAG_MIN = 1.0;
export const STRING_SAG_MAX = 2.1;
/** How far outboard of the kerb line a cord is anchored. */
export const STRING_ANCHOR_OUT = 1.7;
/** Lanterns on one cord. */
export const LANTERNS_PER_STRING_MIN = 5;
export const LANTERNS_PER_STRING_MAX = 9;
/** Drop from cord to lantern centre. */
export const LANTERN_DROP_MIN = 0.34;
export const LANTERN_DROP_MAX = 0.72;

/**
 * Lantern light budget.
 *
 * Two things were wrong with the first version. It lit one lantern in three,
 * which put one lit point every 15 m of street where section C of
 * `docs/STREET_SPEC.md` counts "more than 10 small warm lamp points along
 * successive galleries, including lamps on or beside railings. Several occur
 * within a short visible stretch." And it stopped at the cap in walk order, so
 * a chunk that wanted more lights than the cap allowed got a lit stretch
 * followed by a dark one — a seam straight down the middle of the market.
 *
 * The budget is now spent by a Bresenham spread over the whole walk, so a
 * capped market is dim everywhere rather than bright in one place.
 *
 * The radius and intensity are not guesses. `lighting.wgsl` attenuates a
 * clustered light by `(1 - d^2/r^2)^2 / (1 + d^2 * 0.05)`; a lantern 6 m above
 * the deck inside a 15 m sphere puts roughly 74x the night ambient on the
 * ground beneath it and roughly 21x at 6 m to the side (see
 * `__selftest_market.ts`, which does the arithmetic). The size of a pool was
 * never the problem. The number of them was.
 */
export const LANTERN_LIGHT_RADIUS = 15;
export const LANTERN_LIGHT_INTENSITY = 3.0;
/** Hard ceiling on market lights from one chunk, spread evenly along the walk. */
export const MAX_MARKET_LIGHTS_PER_CHUNK = 48;

/** One stall in this many has a cooking vent and a hot glow under a grille. */
export const COOKING_EVERY = 7;

/**
 * `fbm2` sums to at most `1.4 * (0.5 + 0.25 + 0.125 + 0.0625) = 1.3125`, so a
 * spine point never strays further than `amp * SPINE_WANDER` from its
 * parametrisation line. The chunk walker relies on this to skip forward instead
 * of sampling every metre, which is what makes the march exact rather than a
 * heuristic that happens to work at this amplitude.
 */
export const SPINE_WANDER = 1.3125;
/** Step while the walker is inside the chunk, metres of spine parameter. */
const WALK_FINE = 4;

/** Half the corridor the spine owns, matching `districtAtField`. */
export const CORRIDOR_SCALE = 0.55;

// ---------------------------------------------------------------- descriptors

/** Which kerb. +1 is left of the direction of travel, -1 right. */
export type MarketSide = 1 | -1;

/**
 * Stall typology.
 *
 * DESIGN HYPOTHESIS, and the reason it has to exist is a measurement. The
 * review gate reported "similar pitched roofs and rectangular counters form long,
 * mechanically regular sequences; the street's left-edge orange/grey forms
 * merge into a fence-like band". Measured at seed 42 over 24 consecutive
 * stalls on one kerb:
 *
 *     eave spread 0.334 m     ridge spread 0.533 m
 *     2 distinct cloth colours, both the same orange hue
 *     longest gapless run on one kerb: 15 stalls
 *
 * Every stall was a pitched tarpaulin at the same height with one of two
 * near-identical oranges. Panel count and support type varied; the *type* did
 * not, and a 0.33 m height spread is a fence. The six modules below differ in
 * silhouette, height band and whether there is cloth at all.
 */
export type MarketModule =
  /** Pitched tarpaulin, the common case. */
  | 'tarpaulin'
  /** Mono-pitch leaning on the building: no roadward overhang, steeper, taller at the back. */
  | 'lean-to'
  /** Flat deck on posts. Breaks the roofline completely. */
  | 'flat'
  /** Two-storey front, sign panel above the awning. The thing that stops a row reading as a fence. */
  | 'double'
  /** Frame with no cloth: a stripped stall being set up or packed down. */
  | 'frame'
  /** No roof at all: a pitch stall, a counter and crates in the open. */
  | 'bare';

/**
 * Per-module geometry, all metres. `eave`/`ridge` are heights above the deck.
 *
 * The height bands deliberately do not overlap much. A `double` at 4.4-5.6 m
 * beside a `lean-to` at 2.0-2.35 m is a 3.5 m step in the roofline; that is what
 * the review asked for when it said to spend geometry on "edges, thickness,
 * posts, brackets and canopy silhouettes".
 */
export interface ModuleForm {
  eave: [number, number];
  ridge: [number, number];
  /** Horizontal roof: `ridge` follows `eave` instead of rising. */
  flat: boolean;
  /** Roadward overhang past the kerb line, metres. */
  overhang: [number, number];
  depth: [number, number];
  /** Does the module emit a cloth surface at all? */
  cloth: boolean;
  /** Does it emit legs, or hang off the building? */
  frame: 'poles' | 'wall-tied';
  /** Share of the fleet, weights. */
  weight: number;
}

export const MODULE_FORMS: Record<MarketModule, ModuleForm> = {
  tarpaulin: { eave: [2.25, 2.60], ridge: [2.85, 3.40], flat: false, overhang: [1.1, 2.3], depth: [1.7, 2.7], cloth: true, frame: 'poles', weight: 40 },
  'lean-to': { eave: [2.00, 2.35], ridge: [3.30, 4.00], flat: false, overhang: [0.0, 0.4], depth: [1.9, 2.8], cloth: true, frame: 'wall-tied', weight: 18 },
  flat: { eave: [2.45, 2.85], ridge: [2.55, 2.95], flat: true, overhang: [0.9, 1.9], depth: [1.6, 2.4], cloth: true, frame: 'poles', weight: 14 },
  double: { eave: [4.40, 5.60], ridge: [4.60, 5.80], flat: false, overhang: [1.4, 2.6], depth: [2.2, 3.0], cloth: true, frame: 'wall-tied', weight: 10 },
  frame: { eave: [2.60, 3.10], ridge: [2.70, 3.20], flat: true, overhang: [0.6, 1.4], depth: [1.7, 2.4], cloth: false, frame: 'poles', weight: 9 },
  bare: { eave: [0, 0], ridge: [0, 0], flat: true, overhang: [0, 0], depth: [1.4, 2.0], cloth: false, frame: 'poles', weight: 9 },
};

const MODULE_TOTAL_WEIGHT = MODULE_FORMS.tarpaulin.weight + MODULE_FORMS['lean-to'].weight
  + MODULE_FORMS.flat.weight + MODULE_FORMS.double.weight + MODULE_FORMS.frame.weight
  + MODULE_FORMS.bare.weight;

/**
 * How many stalls may sit side by side on one kerb before a gap is forced.
 *
 * Measured longest gapless run before this: 15 stalls. A kerb read as a fence at
 * 15; the target is 6, which leaves a rhythm of run, run, gap.
 */
export const RUN_FATIGUE = 6;

/**
 * A crate, a sack, a box. Cheap geometry, and cheap geometry is what makes a
 * market look traded-in rather than modelled.
 */
export interface MarketCrate {
  /** Offset from the stall origin, along and across the stall's own basis. */
  lateral: number;
  along: number;
  half: Vec3;
  yaw: number;
  color: Vec3;
  /** 0 = on the deck, 1 = stacked on the crate listed before this one. */
  stack: number;
  lod: MarketLod;
}

/**
 * A cooking vent: the firebox under a grille, and the mouth a plume would rise
 * from. The firebox is real geometry and is baked; the plume is *not* built —
 * this project has no particle system, and adding a field nothing reads would
 * be a PHANTOM (PROCESS.md rule 5).
 */
export interface MarketVent {
  pos: Vec3;
  half: Vec3;
  /** Emissive strength of the firebox under the grille. */
  glow: number;
  lod: MarketLod;
}

/** A projecting sign: bracket off the building, board hanging into the road. */
export interface MarketSign {
  /** Foot of the bracket, on the building face. */
  root: Vec3;
  /** Far end of the arm, out over the carriageway. */
  tip: Vec3;
  /** Centre of the board that hangs from the arm. */
  board: Vec3;
  /** Half-extents in the stall's own basis: X along the street, Y up, Z across. */
  halfBoard: Vec3;
  boardColor: Vec3;
  frameColor: Vec3;
  emissive: number;
  /** Silhouette of the board. Section B counts thin projecting panels; a field
   *  of identical rectangles is the repetition risk the spec warns about in
   *  its last section, so tall panels and wide bands are mixed. */
  shape: 'panel' | 'band';
  lod: MarketLod;
}

/** One stall: a roof, its frame, what is under it, and what hangs off it. */
export interface MarketStall {
  /** Metres along the market spine, in the spine's own parameter. */
  along: number;
  side: MarketSide;
  /** Point on the market spine centreline directly abeam this stall. Signed
   *  laterals are offsets from here, which is what lets one expression place a
   *  roof edge at any lateral without first undoing the side's sign. */
  cx: number;
  cz: number;
  /** Unit tangent of the spine here. */
  tx: number;
  tz: number;
  /** Unit left-normal of the spine here. */
  nx: number;
  nz: number;
  /** Signed lateral of the roadward roof edge. Closer to the centreline than the
   *  kerb, so on this side the overhang reaches into the carriageway. */
  front: number;
  /** Signed lateral of the building-side edge, pulled clear of any facade. */
  back: number;
  /** Signed lateral of the counter. */
  counter: number;
  /** Footprint along the street. */
  pitch: number;
  /** Roof height at `front`, above the deck. */
  eave: number;
  /** Roof height at `back`, above the deck. */
  ridge: number;
  /** Stripes across the roof, along the street. Both counts are odd so a
   *  striped tarp closes on the same colour at every stall boundary. */
  panels: 3 | 5;
  /**
   * How this tarp is held up.
   *
   * DESIGN HYPOTHESIS. The spec is explicit that it cannot answer this: "What
   * supports a canopy? ... A market canopy's posts, wall attachment, ropes,
   * braces or frame" is listed as unestablished, and B02's tarps "cannot be
   * treated as a night-market stall prototype". Both are built here, mixed by
   * hash, because a street in which every canopy is on four poles and one in
   * which every canopy is tied to a wall are both visibly wrong and the
   * references will not adjudicate between them.
   */
  frame: 'poles' | 'wall-tied';
  /** Cloth colour of the odd panel. */
  cloth: Vec3;
  /** Cloth colour of the even panel. A striped tarp is the cheapest way to say
   *  "market" from thirty metres: the stripes carry the eye along the street. */
  clothAlt: Vec3;
  frameColor: Vec3;
  crates: MarketCrate[];
  vent: MarketVent | null;
  sign: MarketSign | null;
  /** Stall typology. Drives silhouette, height band and whether there is cloth. */
  module: MarketModule;
  /** Horizontal roof rather than pitched. */
  flatRoof: boolean;
  /** This module emits a cloth surface. `false` for `frame` and `bare`. */
  hasCloth: boolean;
  /** Coarsest LOD the *roof* survives at. */
  lod: MarketLod;
}

/** One lantern on a cord. */
export interface MarketLantern {
  pos: Vec3;
  radius: number;
  color: Vec3;
  emissive: number;
  /** True when this lantern also contributes a clustered light. */
  light: boolean;
}

/** A catenary spanning the street, and the lanterns hanging off it. */
export interface MarketLanternString {
  along: number;
  /** Cord endpoints. `sag` is the belly depth between them. */
  a: Vec3;
  b: Vec3;
  sag: number;
  lanterns: MarketLantern[];
  lod: MarketLod;
}

/**
 * One piece of cloth hanging off a cord.
 *
 * This is the only market element with direct reference evidence behind it:
 * section C of `docs/STREET_SPEC.md` lists "hanging pennant/laundry-like
 * strips" among the things the fire-lit frames actually show. Everything else
 * in this module is a design hypothesis filling a gap the spec says it cannot
 * fill — the spec states outright that "the opened reference set does not
 * contain a sufficiently legible night market to specify a complete stall".
 */
export interface MarketCloth {
  /** Top-centre attachment, on the cord. */
  pos: Vec3;
  /** Unit tangent of the cord here, so the cloth's width runs along the cord. */
  tx: number;
  tz: number;
  /** Half-width at the top, metres. */
  halfWidth: number;
  /** Length hanging down, metres. */
  drop: number;
  /** A pennant tapers; a strip does not. */
  shape: 'pennant' | 'strip';
  color: Vec3;
  lod: MarketLod;
}

/**
 * A light the market wants the chunk to carry. Structurally identical to
 * `GroundLight` in `src/render/groundbake.ts`, so pushing one into that array
 * needs no cast — it is one loop at the call site, described in the header of
 * `src/render/marketbake.ts`.
 */
export interface MarketLight {
  pos: Vec3;
  radius: number;
  color: Vec3;
  intensity: number;
}

/**
 * Counts of what was emitted, read from the walk. Never predicted from a
 * triangle formula: the numbers that get reported are the numbers that got built.
 */
export interface MarketStats {
  /** Metres of market spine inside the chunk. */
  metres: number;
  /** Pitch slots examined, stalled or not. */
  slots: number;
  /** Slots left empty because the run-length machine was in a gap. */
  gaps: number;
  /** Of those, how many were forced by {@link RUN_FATIGUE} rather than scheduled. */
  fatigueGaps: number;
  /** Slots where a stall was wanted but no facade clearance could be found. */
  rejected: number;
  stalls: number;
  crates: number;
  signs: number;
  vents: number;
  lanternStrings: number;
  lanterns: number;
  cloth: number;
  lights: number;
}

/** Everything one chunk's market contributes. */
export interface MarketDesc {
  stalls: MarketStall[];
  strings: MarketLanternString[];
  cloth: MarketCloth[];
  lights: MarketLight[];
  stats: MarketStats;
}

/**
 * What the grammar needs. A subset of `GroundBakeCtx`, so the grammar is
 * testable without building a bake context.
 */
export interface MarketQuery {
  seed: number;
  plan: CityPlan;
  chunk: CityChunk;
  /** Road kind the caller resolved. */
  kind: RoadKind;
  /** District the caller resolved at the query point. */
  districtId: number;
}

// ---------------------------------------------------------------- helpers

/**
 * Pick a module from a unit hash.
 *
 * Deliberately *not* a function of position along the spine. The review gate's
 * finding was that position drove everything and the row read as a comb; tying
 * the module to `along` would reproduce exactly that, one axis further out. The
 * hash is over the stall's own identity, so the sequence of modules along a run
 * is a permutation rather than a trend.
 */
function pickModule(u: number): MarketModule {
  const order: MarketModule[] = ['tarpaulin', 'lean-to', 'flat', 'double', 'frame', 'bare'];
  let acc = 0;
  for (const m of order) {
    acc += MODULE_FORMS[m].weight;
    if (u * MODULE_TOTAL_WEIGHT < acc) return m;
  }
  return 'tarpaulin';
}

/**
 * Cloth colours drawn from the district palette.
 *
 * Measured before: two distinct colours across 24 stalls, both the same orange
 * hue — the "orange/grey forms merge into a fence-like band" the review named.
 * Five entries spanning the palette's value range give adjacent stalls a real
 * chance of differing, and they all stay inside the district's identity.
 */
function clothSet(pal: ResolvedPalette, accent: Vec3): Vec3[] {
  return [pal.trim, pal.glass, accent, tint(pal.base, 0.78), tint(pal.secondary, 0.86)];
}

/** Multiply a linear colour by a scalar. Linear in, linear out (districts.ts:7). */
const tint = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];

/**
 * The shape a slack cord takes. The parabola that matches the catenary at the
 * ends and at the middle — indistinguishable at this scale, and two orders of
 * magnitude cheaper than solving the differential equation.
 */
export const marketCatenary = (a: Vec3, b: Vec3, sag: number, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t) - sag * 4 * t * (1 - t),
  lerp(a[2], b[2], t),
];

const scratchHit: SpineHit = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 };

/**
 * Chunk seed. Depends only on what was asked for, never on call order — see the
 * determinism note in the header.
 */
const chunkSeed = (seed: number, cx: number, cz: number): number =>
  (Math.imul(seed + 1, 0x27d4eb2d) ^ Math.imul(cx, 0x165667b1) ^ Math.imul(cz, 0x9e3779b1)) >>> 0;

/** Distance from (x, z) to the chunk's XZ bounds grown by `pad`. */
function outsideBy(minX: number, minZ: number, size: number, pad: number, x: number, z: number): number {
  const dx = Math.max(minX - x, x - (minX + size + pad), 0);
  const dz = Math.max(minZ - z, z - (minZ + size + pad), 0);
  return Math.hypot(dx, dz);
}

/**
 * Plan-space overlap of a rotated rectangle with an axis-aligned box.
 *
 * Separating-axis test over the rectangle's own two axes and the world X and Z.
 * Corner-sampling would have been shorter and would have missed exactly the
 * case that matters — a building corner poking a hand's width into a stall.
 */
function rectHitsBuilding(
  cx: number, cz: number, tx: number, tz: number,
  halfAlong: number, lateral: number, halfAcross: number,
  minX: number, minZ: number, maxX: number, maxZ: number,
): boolean {
  const nx = -tz, nz = tx;
  const mx = cx + nx * lateral, mz = cz + nz * lateral;
  const bcx = (minX + maxX) * 0.5, bcz = (minZ + maxZ) * 0.5;
  const bhx = (maxX - minX) * 0.5, bhz = (maxZ - minZ) * 0.5;
  for (let a = 0; a < 4; a++) {
    let ax: number, az: number, ra: number;
    if (a === 0) { ax = tx; az = tz; ra = halfAlong; }
    else if (a === 1) { ax = nx; az = nz; ra = halfAcross; }
    else if (a === 2) { ax = 1; az = 0; ra = halfAlong * Math.abs(tx) + halfAcross * Math.abs(nx); }
    else { ax = 0; az = 1; ra = halfAlong * Math.abs(tz) + halfAcross * Math.abs(nz); }
    // The building is an axis-aligned box, so its extent along an arbitrary
    // axis is the same sum over its own two. Reading the *rectangle's* other
    // half-extent here instead made every axis agree with itself and the test
    // never separated, which is why the facade clamp below did nothing.
    const rb = bhx * Math.abs(ax) + bhz * Math.abs(az);
    if (Math.abs((mx - bcx) * ax + (mz - bcz) * az) >= ra + rb) return false;
  }
  return true;
}

/** True when the stall's footprint, grown by `clear`, touches any facade. */
function footprintObstructed(
  chunk: CityChunk, cx: number, cz: number, tx: number, tz: number,
  halfAlong: number, lo: number, hi: number, clear: number, reach: number,
): boolean {
  for (const b of chunk.buildings) {
    const dx = Math.max(b.aabbMin[0] - cx, 0, cx - b.aabbMax[0]);
    const dz = Math.max(b.aabbMin[2] - cz, 0, cz - b.aabbMax[2]);
    if (Math.hypot(dx, dz) > reach) continue;
    if (rectHitsBuilding(
      cx, cz, tx, tz, halfAlong + clear, (lo + hi) * 0.5, (hi - lo) * 0.5 + clear,
      b.aabbMin[0], b.aabbMin[2], b.aabbMax[0], b.aabbMax[2],
    )) return true;
  }
  return false;
}

/**
 * The stretch of spine parameter that crosses this chunk, or `null`.
 *
 * Marches with a fat-line step: outside the box the curve can still close the
 * gap in one hop, because a spine point never strays further than
 * `amp * SPINE_WANDER` from its parametrisation line. Inside the box it walks
 * at {@link WALK_FINE}.
 */
function marketAlongRange(q: MarketQuery, pad: number): [number, number] | null {
  const s = q.plan.districts.market;
  const size = q.chunk.boundsMax[0] - q.chunk.boundsMin[0];
  const minX = q.chunk.boundsMin[0], minZ = q.chunk.boundsMin[2];
  // The field forces the spine through the world origin, so a point at
  // parameter `a` is within `|a| + amp` of it. Past that it cannot be inside a
  // chunk whose far corner is `maxR` from the origin.
  const maxR = Math.max(
    Math.abs(minX), Math.abs(minX + size),
    Math.abs(minZ), Math.abs(minZ + size),
  );
  const reach = s.amp * SPINE_WANDER;
  const limit = maxR + reach + pad;
  let a = -limit;
  let inside = false;
  let lo = 0, hi = 0;
  while (a <= limit) {
    const p = spinePoint(s, a);
    const off = outsideBy(minX, minZ, size, pad, p[0], p[1]);
    if (off <= 0) {
      if (!inside) { lo = a; inside = true; }
      hi = a;
      a += WALK_FINE;
    } else {
      // Inset by one fine step: the samples that opened and closed the run are
      // quantised to WALK_FINE, so without this a stall can sit up to 4 m
      // outside the chunk and be emitted by this chunk and its neighbour.
      if (inside) return [lo + WALK_FINE, hi - WALK_FINE];
      // Cannot reach the box from here in one hop; close the gap conservatively.
      a += Math.max(WALK_FINE, off - reach) + WALK_FINE;
    }
  }
  return inside ? [lo + WALK_FINE, hi - WALK_FINE] : null;
}

// ---------------------------------------------------------------- the walk

/**
 * Every market element this chunk owns.
 *
 * Walks the market spine rather than `ctx.frame`. The frame a caller holds is
 * the frame at the *start* of a carriageway trace — one tangent and `along: 0`
 * — which is not enough to lay out a 250 m street, and trusting it would put
 * every stall at parameter zero. The spine is the thing that is actually there,
 * and it is the same curve `sampleStreetPlan` classifies as `kind: 'market'`.
 */
export function marketGrammarFor(q: MarketQuery): MarketDesc {
  const stalls: MarketStall[] = [];
  const strings: MarketLanternString[] = [];
  const cloth: MarketCloth[] = [];
  const lights: MarketLight[] = [];
  const stats: MarketStats = {
    metres: 0, slots: 0, gaps: 0, fatigueGaps: 0, rejected: 0, stalls: 0, crates: 0, signs: 0,
    vents: 0, lanternStrings: 0, lanterns: 0, cloth: 0, lights: 0,
  };
  const empty = (): MarketDesc => ({ stalls, strings, cloth, lights, stats });

  // Market dressing belongs to the market street and to the bazaar that wraps
  // it. Anything else gets nothing, however close its geometry runs to the
  // spine — otherwise every street in the city grows a market.
  if (q.kind !== 'market' && !MARKET_DISTRICTS.includes(q.districtId)) return empty();

  const spine = q.plan.districts.market;
  const half = spine.width * 0.5;
  const style = districtStyle(q.districtId);
  const pal = districtPaletteLinear(style);
  const pitchScale = PITCH_SCALE[q.districtId] ?? 1;
  // A stall belongs to the chunk its *spine point* falls in, and to no other.
  // Padding the range by the stall's own reach — which is what this did, at
  // `half + DEPTH_MAX + PITCH_MAX` ≈ 22 m — makes both neighbours emit the same
  // tarp twice, and the neighbouring chunk's selftest duly reported 6239
  // vertices overhanging their bounds. A stall whose roof crosses a chunk
  // border is ordinary streaming geometry and costs nothing; a stall emitted
  // twice is duplicated triangles and z-fighting on a double-sided cloth.
  const pad = 0;

  const range = marketAlongRange(q, pad);
  if (!range) return empty();
  stats.metres = range[1] - range[0];
  if (stats.metres <= 0) return empty();

  const base = makeRng(chunkSeed(q.seed, q.chunk.cx, q.chunk.cz));
  const cloths = clothSet(pal, style.accentColor);
  let slot = 0;

  for (const side of [1, -1] as const) {
    // Run-length machine: metres of continuous stall left, then metres of gap.
    // Keyed by index, not by draw order, so removing one gap cannot shift the
    // position of every gap after it.
    let gapIndex = 0;
    const runFor = (i: number): number =>
      base.fork(0x6a00 + (side > 0 ? 1 : 2) * 4096 + i).range(RUN_MIN_M, RUN_MAX_M);
    let runLeft = runFor(gapIndex++);
    let gapLeft = 0;
    // Stalls placed back to back on this kerb since the last gap.
    let consecutive = 0;

    let a = range[0];
    while (a <= range[1]) {
      stats.slots++;
      const step = clamp(
        lerp(PITCH_MIN, PITCH_MAX, (fbm2(a / PITCH_WAVELENGTH + side * 0.37, side * 37.7, 3) / PITCH_NOISE_SCALE) * 0.5 + 0.5)
          * pitchScale,
        PITCH_MIN * 0.75, PITCH_MAX,
      ) + STALL_SEPARATION;

      let stalled = true;
      if (gapLeft > 0) {
        gapLeft -= step;
        stalled = false;
        consecutive = 0;
        stats.gaps++;
      } else if (consecutive >= RUN_FATIGUE) {
        // Fatigue gap. The run-length machine already opens gaps on its own
        // schedule; measured before this, its longest gapless run on one kerb was
        // 15 stalls, which is a fence at street level whatever the roof heights
        // do. This forces a short empty slot every RUN_FATIGUE stalls so the
        // kerb always reads as runs with daylight between them.
        gapLeft = step * 1.6;
        consecutive = 0;
        stalled = false;
        stats.gaps++;
        stats.fatigueGaps++;
      } else {
        consecutive++;
        runLeft -= step;
        if (runLeft <= 0) {
          const rg = base.fork(0x6b00 + (side > 0 ? 1 : 2) * 4096 + gapIndex);
          gapIndex++;
          gapLeft = rg.range(GAP_MIN_M, GAP_MAX_M);
          runLeft = runFor(gapIndex++);
          stalled = false;
          stats.gaps++;
        }
      }

      if (stalled) {
        // Fork per slot rather than drawing from a shared stream: dropping one
        // stall must not shift every stall after it.
        const r = base.fork(slot * 4 + (side > 0 ? 1 : 2));
        const p = spinePoint(spine, a);
        const h = spineHit(spine, p[0], p[1], scratchHit);
        const nx = -h.tz, nz = h.tx;
        const pitch = step - STALL_SEPARATION;
        const module = pickModule(r.next());
        const form = MODULE_FORMS[module];
        const front = side * (half - r.range(form.overhang[0], form.overhang[1]));
        const reach = half + DEPTH_MAX + pitch * 0.5 + FACADE_CLEARANCE;

        // Pull the building-side edge in until the stall clears every facade
        // near it. Measured: the nearest building sits 13.1 m from the
        // centreline at the 5th percentile, well inside the kerb line.
        let back = half + r.range(form.depth[0], form.depth[1]);
        while (back > half + MIN_STALL_DEPTH
          && footprintObstructed(
            q.chunk, p[0], p[1], h.tx, h.tz, pitch * 0.5,
            Math.min(front, side * back), Math.max(front, side * back), FACADE_CLEARANCE, reach,
          )) {
          back -= BACK_TRIM_STEP;
        }

        if (back <= half + MIN_STALL_DEPTH) {
          stats.rejected++;
        } else {
          const stall: MarketStall = {
            along: a,
            side,
            cx: p[0], cz: p[1],
            tx: h.tx, tz: h.tz, nx, nz,
            front,
            back: side * back,
            counter: side * (half + 0.35),
            pitch,
            eave: GROUND_Y + r.range(form.eave[0], form.eave[1]),
            ridge: GROUND_Y + r.range(form.ridge[0], form.ridge[1]),
            module,
            flatRoof: form.flat,
            hasCloth: form.cloth,
            // Two module silhouettes and two support types, mixed by hash. The
            // spec's last section is a warning about exactly this: "repeated
            // canopy modules can fill the empty ground while destroying the
            // references' large value groups". Identical tarps at identical
            // pitch is the failure mode, and it costs six triangles to avoid.
            panels: r.bool(0.42) ? 5 : 3,
            frame: form.frame,
            cloth: cloths[r.int(0, cloths.length - 1)],
            clothAlt: cloths[r.int(0, cloths.length - 1)],
            frameColor: tint(pal.metal, 0.85),
            crates: [],
            vent: null,
            sign: null,
            lod: 1,
          };
          stalls.push(stall);
          stats.stalls++;

          const nCrates = r.int(0, 3);
          for (let c = 0; c < nCrates; c++) {
            // The second crate of a run stacks on the first rather than sitting
            // beside it: a stack is what says "goods"; two boxes side by side
            // say "box".
            const prev = c === 1 ? stall.crates[0] : null;
            const hx = prev ? prev.half[0] * 0.88 : r.range(0.24, 0.38);
            stall.crates.push({
              lateral: prev ? prev.lateral : side * (back - r.range(0.25, 0.7)),
              along: prev ? prev.along : r.jitter(pitch * 0.3),
              half: prev
                ? [hx, prev.half[1] * 0.8, hx]
                : [hx, hx * r.range(0.55, 0.95), hx * r.range(0.8, 1.2)],
              yaw: prev ? prev.yaw + r.jitter(0.22) : r.range(-0.4, 0.4),
              color: r.bool(0.55) ? pal.secondary : tint(pal.trim, 0.62),
              stack: prev ? 1 : 0,
              lod: 0,
            });
            stats.crates++;
          }

          if (stalls.length % COOKING_EVERY === 0) {
            stall.vent = {
              pos: [
                stall.cx + nx * side * (back - 0.5),
                GROUND_Y + COUNTER_TOP + 0.22,
                stall.cz + nz * side * (back - 0.5),
              ],
              half: [0.24, 0.16, 0.24],
              glow: 4.2,
              lod: 0,
            };
            stats.vents++;
          }

          if (stalls.length % SIGN_EVERY === 0) {
            const y = GROUND_Y + r.range(SIGN_Y_MIN, SIGN_Y_MAX);
            const arm = r.range(SIGN_ARM_MIN, SIGN_ARM_MAX);
            const rootX = stall.cx + nx * side * (back - 0.1);
            const rootZ = stall.cz + nz * side * (back - 0.1);
            const tipX = rootX - nx * side * arm;
            const tipZ = rootZ - nz * side * arm;
            const drop = r.range(0.75, 1.15);
            // A tall thin panel or a wide horizontal band. Section B's "5-8
            // nearby projecting illuminated panels" is a silhouette count; a
            // field of identical rectangles satisfies the count and fails the
            // read. Both are real signage, so neither is a fantasy.
            const panel = r.bool(0.62);
            stall.sign = {
              root: [rootX, y, rootZ],
              tip: [tipX, y, tipZ],
              // A panel hangs below the arm; a band sits just under it, which is
              // where a fascia sign actually goes and what stops every board on
              // the street from occupying the same horizontal band.
              board: [tipX + nx * side * 0.28, y - (panel ? drop * 0.95 : 0.32), tipZ + nz * side * 0.28],
              // Thin along X so that the board faces along the street, i.e.
              // perpendicular to the facade it hangs off. A panel is tall and
              // narrow; a band is the other way round and hangs off the arm
              // rather than under it.
              halfBoard: panel
                ? [0.06, drop * 0.9, r.range(0.26, 0.36)]
                : [0.06, r.range(0.2, 0.3), r.range(0.62, 0.9)],
              boardColor: pal.emissive,
              frameColor: tint(pal.metal, 0.7),
              emissive: 2.6,
              shape: panel ? 'panel' : 'band',
              lod: 1,
            };
            stats.signs++;
          }
        }
      }
      slot++;
      a += step;
    }
  }

  // Lantern cords span the street, so they are walked once and not per side.
  // Doing this inside the side loop put two identical cords at every anchor,
  // which doubled the geometry and doubled the light count for nothing.
  for (let a = range[0]; a <= range[1];) {
    const rs = base.fork(0x5a1e + Math.round(a * 8));
    const p = spinePoint(spine, a);
    const h = spineHit(spine, p[0], p[1], scratchHit);
    const nx = -h.tz, nz = h.tx;
    const y = GROUND_Y + rs.range(STRING_ANCHOR_MIN, STRING_ANCHOR_MAX);
    const outboard = half + STRING_ANCHOR_OUT;
    const str: MarketLanternString = {
      along: a,
      a: [p[0] + nx * outboard, y, p[1] + nz * outboard],
      b: [p[0] - nx * outboard, y, p[1] - nz * outboard],
      sag: rs.range(STRING_SAG_MIN, STRING_SAG_MAX),
      lanterns: [],
      lod: 1,
    };
    const n = rs.int(LANTERNS_PER_STRING_MIN, LANTERNS_PER_STRING_MAX);
    for (let i = 0; i < n; i++) {
      const c = marketCatenary(str.a, str.b, str.sag, (i + 0.5) / n);
      str.lanterns.push({
        pos: [c[0], c[1] - rs.range(LANTERN_DROP_MIN, LANTERN_DROP_MAX), c[2]],
        radius: rs.range(0.17, 0.26),
        color: [1.0, 0.58, 0.26],
        emissive: 5.5,
        // Decided below, once every lantern in the chunk is known.
        light: false,
      });
      stats.lanterns++;
    }

    // Pennants and laundry on the same cord. Half the cords carry them; a cord
    // with both lanterns and cloth on it is the busiest read and the one the
    // fire-lit frames actually show.
    if (strings.length % CLOTH_EVERY_STRING === 0) {
      const nCloth = rs.int(CLOTH_PER_STRING_MIN, CLOTH_PER_STRING_MAX);
      for (let i = 0; i < nCloth; i++) {
        const t = (i + 0.5) / nCloth;
        const c = marketCatenary(str.a, str.b, str.sag, t);
        const pennant = rs.bool(0.55);
        const col = rs.bool(0.4) ? pal.secondary
          : rs.bool(0.5) ? tint(pal.base, 0.85) : style.accentColor;
        cloth.push({
          pos: c,
          // The cord is a chord, so its tangent is constant along it.
          tx: -(str.b[2] - str.a[2]), tz: str.b[0] - str.a[0],
          halfWidth: rs.range(CLOTH_HALF_WIDTH_MIN, CLOTH_HALF_WIDTH_MAX),
          drop: pennant
            ? rs.range(PENNANT_DROP_MIN, PENNANT_DROP_MAX)
            : rs.range(STRIP_DROP_MIN, STRIP_DROP_MAX),
          shape: pennant ? 'pennant' : 'strip',
          color: col,
          lod: 1,
        });
        stats.cloth++;
      }
    }
    strings.push(str);
    stats.lanternStrings++;
    a += rs.range(STRING_PITCH_MIN, STRING_PITCH_MAX);
  }

  // Spend the light budget by a Bresenham spread over the whole walk. Lighting
  // in walk order and stopping at the cap put every lit lantern in the first
  // 120 m of the chunk and none in the rest — a seam straight down the middle
  // of the market, visible only at night, which is exactly the kind of fault
  // this project keeps paying for.
  const total = stats.lanterns;
  let k = 0;
  for (const str of strings) {
    for (const l of str.lanterns) {
      const prev = Math.floor((k * MAX_MARKET_LIGHTS_PER_CHUNK) / total);
      const next = Math.floor(((k + 1) * MAX_MARKET_LIGHTS_PER_CHUNK) / total);
      k++;
      if (next <= prev || lights.length >= MAX_MARKET_LIGHTS_PER_CHUNK) continue;
      l.light = true;
      lights.push({
        pos: l.pos, radius: LANTERN_LIGHT_RADIUS,
        color: l.color, intensity: LANTERN_LIGHT_INTENSITY,
      });
      stats.lights++;
    }
  }

  return { stalls, strings, cloth, lights, stats };
}
