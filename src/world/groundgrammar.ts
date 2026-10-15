/**
 * Ground grammar: what a street surface *is*, as data.
 *
 * The city had eleven authored district palettes and ten authored ground
 * colours, and none of them reached a pixel — the deck was one flat quad in a
 * single grey and the only "ground detail" was a 1.2m kerb box on a jittered
 * 48m world-axis grid with no relationship to the street network it sat in.
 * This module is the missing link: a pure function from (district, road kind)
 * to a description of the surface, so a street in Terracotta Tiers is not the
 * same street as a street in Rust Hangars.
 *
 * PORTABILITY — binding. Everything in this file is plain data plus pure
 * functions. No WGSL, no GLSL, no GPU types, no texture sampling, no baked
 * asset lookups. `groundGrammarFor` is a total function of two small integers,
 * so a GLSL port is a literal transcription of `DISTRICT_GROUND` plus
 * `sharpenForKind` and nothing else. Every authored constant below carries the
 * reason it has the value it has; there are no magic numbers hiding a rule.
 */

import { clamp, type Rng, type Vec3 } from '../core/math';
import {
  DISTRICT_STYLES, districtAtField, districtStyle, type DistrictStyle,
} from './districts';
import {
  cityPlan, sampleStreetPlan, type CityChunk, type CityPlan, type RoadKind, type StreetSample,
} from './citygen';
import type { MeshBuilder } from './geometry';

// ---------------------------------------------------------------- vocabulary

/** How the carriageway and footway are surfaced. Selected by district + road kind. */
export type PavementFamily =
  | 'asphalt' | 'flagstone' | 'cobble' | 'boardwalk' | 'metal-deck'
  | 'terracotta-tile' | 'board-formed' | 'rubber' | 'dirt';

/** How the carriageway is separated from the footway. */
export type KerbStyle =
  | 'stone' | 'painted' | 'flush' | 'channel' | 'planter-edge' | 'bollard-line';

/** What paint, if any, is laid on the carriageway. */
export type MarkingStyle =
  | 'centre-line' | 'lane-dashes' | 'zebra' | 'tram-rails' | 'yard-grid' | 'none';

/**
 * Integer codes for the three enums above.
 *
 * WHY THESE EXIST: the vertex format is full at 12 floats and is shared with
 * `shadow.wgsl`, which has its own copy of `VSIn` — so no per-vertex attribute
 * can be added, and no per-draw `matId` is available for chunk geometry (every
 * chunk draws through the identity instance, `params.x = MAT.DIFFUSE`).
 * Ground class and family now use negative values of the existing mask channel
 * (see groundSurfaceTag), preserving the vertex stride and RGB as colour.
 * These vocabulary codes and the older colour-band decoder remain portable
 * authoring data; the shader uses BAND_ORDER for the explicit payload.
 */
export const PAVEMENT_CODES: Record<PavementFamily, number> = {
  asphalt: 0, flagstone: 1, cobble: 2, boardwalk: 3, 'metal-deck': 4,
  'terracotta-tile': 5, 'board-formed': 6, rubber: 7, dirt: 8,
};

export const KERB_CODES: Record<KerbStyle, number> = {
  stone: 0, painted: 1, flush: 2, channel: 3, 'planter-edge': 4, 'bollard-line': 5,
};

export const MARKING_CODES: Record<MarkingStyle, number> = {
  'centre-line': 0, 'lane-dashes': 1, zebra: 2, 'tram-rails': 3, 'yard-grid': 4, none: 5,
};

/**
 * Street furniture vocabulary. `GroundGrammar.clutter` holds indices into this,
 * so a district names its own kit and the emitter resolves index → geometry.
 *
 * The order is data, not decoration: it is the portable enum the emitter and
 * (later) a GLSL port both index by. Entries are APPENDED, never renumbered, so
 * an index handed out once stays valid.
 *
 * ------------------------------------------------------------------
 * EVIDENCE, and the honest state of it. Cross-referenced against
 * `docs/STREET_SPEC.md` section B, which opened all four reference sheets:
 *
 *   CONFIRMED in the references:
 *     railing           "a strong feature" in A (orange/red bridge rails);
 *                       6-10 main stanchions in B; gallery edges in C;
 *                       continuous terrace/bridge rails in D. The single
 *                       best-evidenced object on this list.
 *     projecting-sign   5-8 nearby illuminated panels in B, 15-25 across the
 *                       canyon. Thin framed objects, luminous faces, and
 *                       explicitly "dark attachment arms".
 *     lamp-bracket      C shows 10+ small warm lamp points along successive
 *                       gallery edges. B: lighting is "attached to fronts
 *                       rather than organised as a boulevard of identical lamp
 *                       posts" — which is why this is a bracket and not a post.
 *     planter / planter-row
 *                       D has 8-15 distinguishable planting/container groups
 *                       and "continuous terrace planting along much of their
 *                       edge". planter-row is that continuous case.
 *     awning            two conspicuous pale tarps in B02, shallow projecting
 *                       roofs in C, deep timber soffits in D.
 *     bracket / balcony B and C both show members that "attach to fronts" and
 *                       "do not float independently of the architecture".
 *     step-edge         stairs are the dominant pedestrian surface in A and B.
 *
 *   UNCONFIRMED — carried only where the grammar gives a real reason, and never
 *   described as reference-derived:
 *     bollard           "unconfirmed" in all four sections; the spec is explicit
 *                       that railing posts must not be relabelled bollards. Kept
 *                       ONLY for a `bollard-line` kerb (market edge) and the
 *                       canal quay, where the district's own description calls
 *                       for mooring bollards.
 *     drain-cover, manhole, cable-spool, puddle-grate, spool
 *                       no reliably identifiable example in any opened frame.
 *                       Plausible utilities, nearly free in triangles, kept at
 *                       low weight where drainage or industry is authored.
 *     bin               unconfirmed in A, B and D; one unresolved cylinder in
 *                       C02. REMOVED from every district kit.
 *     bench             "public benches unconfirmed" in A, B and C; D shows
 *                       2-5 small table/chair groupings supporting "furnished
 *                       domestic/cafe edges, not a particular public-bench
 *                       design". Kept only in the two planted/domestic districts.
 *     crate-stack, newspaper-box, sandwich-board, kiosk, potted-palm, sandbag
 *                       market and domestic props. See DESIGN HYPOTHESIS below.
 * ------------------------------------------------------------------
 *
 * DESIGN HYPOTHESIS — NOT REFERENCE-DERIVED. The spec is unambiguous: "the
 * opened reference set does not contain a sufficiently legible night market to
 * specify a complete stall", and stall geometry, canopy height and merchandise
 * "remain design hypotheses". Everything from `kiosk` downwards, and the market
 * grammar in `src/world/marketgrammar.ts`, is authored on judgement. The
 * references support exactly one relationship for a night register — A's "warm
 * pedestrian light against cool violet/blue surroundings" — and nothing more.
 * Do not let these names acquire reference authority they have never had.
 */
export const CLUTTER_KINDS: readonly string[] = [
  'bollard', 'bench', 'bin', 'planter', 'lamp-post', 'drain-cover', 'manhole',
  'hydrant', 'bike-rack', 'crate-stack', 'spool', 'postbox', 'newspaper-box',
  'kiosk', 'phone-box', 'sandbag', 'cable-spool', 'puddle-grate',
  'sandwich-board', 'potted-palm',
  // --- appended, reference-evidenced (spec section B)
  'railing', 'bracket', 'projecting-sign', 'awning', 'lamp-bracket',
  'balcony', 'planter-row', 'step-edge',
  // --- appended, DECISIONS D30 (2026-10-13): things people use and leave.
  // Owner direction, not reference-derived; the district kits below map them
  // onto sheets A (seating, stall overflow), B (barrels, pallets), C (braziers,
  // firewood, kiln stock) and D (planters, trees, cafe terraces).
  'cafe-set', 'bicycle', 'doorstep-pots', 'barrel', 'pallet', 'brazier',
  'firewood', 'kiln-stock', 'handcart', 'sacks', 'planter-tall',
  // Island-only pieces (market spine interior, `MarketIsland`).
  'tree', 'ring-bench', 'parasol', 'pump', 'shrine', 'cafe-table', 'chair',
];

/**
 * Which side of the footway a kind belongs to.
 *
 * `front` = against the building line, `kerb` = on the route boundary. The spec
 * is explicit that furniture should "cluster beside building fronts and route
 * boundaries, leaving coherent walking areas" — which cannot be done if items
 * are scattered evenly across the width of the footway, where they read as
 * debris in the middle of the route. Superseded in part by DECISIONS D30
 * (2026-10-13): no authored footway reaches the ~6 m D30 names (widest 5.72 m),
 * so footways stay edge-placed and the islands go in open carriageway: the
 * market spine's and any carriageway at least `STREET_ISLAND_MIN_WIDTH` wide
 * (`MarketIsland`, `streetIslands` in `marketgrammar.ts`).
 */
export const CLUTTER_EDGE: Record<string, 'front' | 'kerb'> = {
  railing: 'kerb', 'step-edge': 'kerb', 'drain-cover': 'kerb', 'manhole': 'kerb',
  'puddle-grate': 'kerb', bollard: 'kerb', 'cable-spool': 'kerb', spool: 'kerb',
  'bike-rack': 'front', 'hydrant': 'kerb', 'postbox': 'front', 'sandbag': 'kerb',
  planter: 'front', 'planter-row': 'front', 'potted-palm': 'front', bench: 'front',
  'lamp-post': 'front', 'lamp-bracket': 'front', 'projecting-sign': 'front',
  awning: 'front', bracket: 'front', balcony: 'front', bin: 'kerb',
  'crate-stack': 'kerb', kiosk: 'front', 'phone-box': 'front',
  'newspaper-box': 'front', 'sandwich-board': 'front',
  'cafe-set': 'front', bicycle: 'front', 'doorstep-pots': 'front', barrel: 'front',
  pallet: 'front', brazier: 'front', firewood: 'front', 'kiln-stock': 'front',
  handcart: 'front', sacks: 'front', 'planter-tall': 'front',
};

/**
 * Half the across-street footprint of a kind at hip height, metres: what a
 * walker bumps into, not a crown or an awning overhead. Unlisted kinds are thin
 * (rails, posts) or off the walking surface (wall brackets, flat covers).
 */
export const CLUTTER_DEPTH: Record<string, number> = {
  'cafe-set': 0.36, bicycle: 0.2, 'doorstep-pots': 0.26, barrel: 0.33, pallet: 0.22,
  brazier: 0.38, firewood: 0.3, 'kiln-stock': 0.34, handcart: 0.5, sacks: 0.32,
  'planter-tall': 0.36, kiosk: 0.82, bench: 0.27, 'crate-stack': 0.34, 'potted-palm': 0.3,
  planter: 0.42, 'planter-row': 0.5, 'bike-rack': 0.34, 'sandwich-board': 0.35,
  spool: 0.32, 'cable-spool': 0.32, sandbag: 0.22, hydrant: 0.14, postbox: 0.2,
  'newspaper-box': 0.2, 'phone-box': 0.36,
};
const DEPTH_THIN = 0.1;

/** Building-line inset of a front item, metres beyond the footway edge. */
export const FOOTWAY_FRONT_INSET = 0.22;
/** Kerb-line placement band of a kerb item's centre, metres onto the footway. */
export const FOOTWAY_KERB_BAND: readonly [number, number] = [0.16, 0.38];

/**
 * The walking line a footway keeps clear of furniture: 3 m where the footway
 * can give it (D30), otherwise all but 1.1 m (one furnished edge line, which is
 * what the edge-only rule this extends assumed).
 */
export const footwayWalk = (fw: number): number => Math.min(3, Math.max(0, fw - 1.1));

/**
 * Depth from its own edge that a placed item may reach, metres, and so the room
 * left for jitter: `null` when the kind cannot stand on this footway at all.
 * Front items are measured from the building line, kerb items from the kerb.
 */
export function clutterReach(name: string, fw: number): number | null {
  const d = CLUTTER_DEPTH[name] ?? DEPTH_THIN;
  const allowed = fw - footwayWalk(fw);
  const atFront = (CLUTTER_EDGE[name] ?? 'front') === 'front';
  const used = atFront ? FOOTWAY_FRONT_INSET + 2 * d : FOOTWAY_KERB_BAND[1] + d;
  return used <= allowed + 1e-9 ? allowed - used : null;
}

/** Index of a clutter kind by name, or -1. */
export const clutterIndex = (name: string): number => CLUTTER_KINDS.indexOf(name);

// ---------------------------------------------------------------- the grammar

export interface GroundGrammar {
  pavement: PavementFamily;
  kerb: KerbStyle;
  marking: MarkingStyle;
  /** Metres. 0 means carriageway and footway are level (flush). */
  kerbHeight: number;
  /** Carriageway edge to building line, metres. */
  footwayWidth: number;
  /** Items per 100 m of footway (both sides). */
  clutterDensity: number;
  /** Indices into {@link CLUTTER_KINDS}. */
  clutter: number[];
  /** 0..1, how much footway is covered by awnings / shopfront spill. */
  shopfrontDensity: number;
  /** 0..1 puddle retention. */
  wetnessBias: number;
  /** 0..1 polished vs matte carriageway. */
  polish: number;
  /** Carriageway, linear. Default: the district palette's ground colour. */
  albedo: Vec3;
  kerbAlbedo: Vec3;
  paintAlbedo: Vec3;
  /**
   * Kerb value divided by carriageway value. The old hard-coded kerb was 2.1
   * against a 0.052-luminance deck — barely a stop and a half of separation at
   * best, which is why the kerbs did not read. The authored values below are
   * 1.8..3.4 and are the single cheapest number in this whole change.
   */
  kerbTone: number;
}

/** Per-district authored defaults, before road-kind sharpening. */
interface DistrictGround {
  pavement: PavementFamily;
  kerb: KerbStyle;
  marking: MarkingStyle;
  kerbHeight: number;
  footwayWidth: number;
  clutterDensity: number;
  clutter: readonly string[];
  /**
   * D30: things people use and leave, drawn alongside `clutter`. The draw is
   * uniform over both lists and the density scales by their combined length,
   * so each authored kind keeps its per-metre rate (appended into `clutter`,
   * they halved the lamp brackets: 20.6 -> 11.3 lamps per chunk).
   */
  lived: readonly string[];
  shopfrontDensity: number;
  wetnessBias: number;
  polish: number;
  kerbTone: number;
  /** Extra value multiplier on the kerb relative to the authored tone. */
  kerbChroma: number;
}

/**
 * The eleven entries, one per `DISTRICT_STYLES` id. Each is a statement about
 * what the ground of that district is made of, derived from the district's own
 * description and palette — not a variation on a theme.
 *
 * `clutter` and `clutterDensity` were rebalanced in round 2 against
 * `docs/STREET_SPEC.md` section B. The round-1 list was invented: bollards,
 * bins, drain covers and manholes, none of which the vision agent could find in
 * any reference frame. The spec's own density ranking is applied here —
 *
 *   D verdant      most identifiable planted and furnished pedestrian edges,
 *                  8-15 planting groups and continuous terrace planting
 *   B cold         dense in projecting signs and exposed infrastructure,
 *                  6-10 railing stanchions on the stair
 *   C fire-lit     10+ small warm lamp points along successive gallery edges
 *   A saturated    the LEAST freestanding furniture of the four
 *
 * — mapped onto districts by their own descriptions, not asserted as a mapping.
 * Where a district could plausibly serve any section, it is given a mix rather
 * than a guess. Repeated names in a list are intentional: they are the weighted
 * draw, so 'railing','railing' means "mostly railings".
 *
 * D30 (2026-10-13) appends things people use and leave, by sheet: seating and
 * stall overflow on the market (A), barrels and pallets in the yards (B),
 * braziers, firewood and kiln stock in the old town (C), cafe sets, pots and
 * small trees in the planted districts (D). Owner direction, not reference-derived.
 */
const DISTRICT_GROUND: readonly DistrictGround[] = [
  // 0 verdant-canyon — pale stone under planting. Spec A has the least
  // freestanding furniture but strong orange/red bridge rails, so the budget
  // goes to railings and wall brackets, not to loose street kit.
  {
    pavement: 'flagstone', kerb: 'stone', marking: 'none',
    kerbHeight: 0.16, footwayWidth: 3.2, clutterDensity: 4.0,
    clutter: ['railing', 'railing', 'lamp-bracket', 'planter', 'balcony'],
    lived: ['cafe-set', 'doorstep-pots', 'bicycle', 'planter-tall'],
    shopfrontDensity: 0.35, wetnessBias: 0.50, polish: 0.35, kerbTone: 2.6, kerbChroma: 1.0,
  },
  // 1 copper-stacks — industrial, exposed infrastructure. Spec B is the densest
  // section in projecting illuminated panels and brackets, so signs lead.
  {
    pavement: 'asphalt', kerb: 'flush', marking: 'lane-dashes',
    kerbHeight: 0.14, footwayWidth: 2.6, clutterDensity: 5.2,
    clutter: ['projecting-sign', 'bracket', 'lamp-bracket', 'railing', 'drain-cover', 'manhole'],
    lived: ['bicycle'],
    shopfrontDensity: 0.30, wetnessBias: 0.60, polish: 0.60, kerbTone: 1.9, kerbChroma: 0.85,
  },
  // 2 terracotta-tiers — terracotta tiles the whole width, wide planted shoulder.
  {
    pavement: 'terracotta-tile', kerb: 'stone', marking: 'none',
    kerbHeight: 0.18, footwayWidth: 4.0, clutterDensity: 5.6,
    clutter: ['planter-row', 'planter', 'railing', 'potted-palm', 'lamp-bracket'],
    lived: ['brazier', 'brazier', 'brazier', 'firewood', 'kiln-stock', 'doorstep-pots'],
    shopfrontDensity: 0.45, wetnessBias: 0.40, polish: 0.40, kerbTone: 2.4, kerbChroma: 1.05,
  },
  // 3 glass-foxholes — cold, reflective, swept. B-like: rails, signs, brackets.
  {
    pavement: 'asphalt', kerb: 'flush', marking: 'centre-line',
    kerbHeight: 0.13, footwayWidth: 2.8, clutterDensity: 4.6,
    clutter: ['railing', 'projecting-sign', 'lamp-bracket', 'balcony', 'drain-cover'],
    lived: ['bicycle'],
    shopfrontDensity: 0.25, wetnessBias: 0.65, polish: 0.70, kerbTone: 2.0, kerbChroma: 0.8,
  },
  // 4 lantern-bazaar — everything crowds the carriageway. C-like: warm lamp
  // points along successive edges, plus awnings and hanging things.
  {
    pavement: 'terracotta-tile', kerb: 'painted', marking: 'none',
    kerbHeight: 0.14, footwayWidth: 2.4, clutterDensity: 12.0,
    clutter: ['lamp-bracket', 'lamp-bracket', 'projecting-sign', 'awning', 'railing', 'planter', 'bracket'],
    lived: ['cafe-set', 'sacks', 'handcart', 'doorstep-pots'],
    shopfrontDensity: 0.95, wetnessBias: 0.45, polish: 0.45, kerbTone: 2.8, kerbChroma: 1.15,
  },
  // 5 rust-hangars — yard, not street. Spec B's "exposed infrastructure":
  // spools, cable, sheet roofs, and a lot of clear ground.
  {
    pavement: 'board-formed', kerb: 'flush', marking: 'yard-grid',
    kerbHeight: 0.10, footwayWidth: 3.4, clutterDensity: 4.2,
    clutter: ['spool', 'cable-spool', 'awning', 'railing', 'drain-cover', 'step-edge'],
    lived: ['barrel', 'barrel', 'pallet'],
    shopfrontDensity: 0.15, wetnessBias: 0.70, polish: 0.30, kerbTone: 1.8, kerbChroma: 0.75,
  },
  // 6 monastery-spire — pale stone, generous clear footway, herb terraces.
  {
    pavement: 'flagstone', kerb: 'stone', marking: 'none',
    kerbHeight: 0.20, footwayWidth: 3.6, clutterDensity: 4.0,
    clutter: ['planter', 'potted-palm', 'railing', 'bench', 'step-edge'],
    lived: ['doorstep-pots', 'planter-tall'],
    shopfrontDensity: 0.20, wetnessBias: 0.50, polish: 0.50, kerbTone: 2.7, kerbChroma: 1.05,
  },
  // 7 neon-arcology — engineered deck over a plinth. Spec C's "dense cables,
  // gallery supports, façade projections" and spec D's "balconies and exterior
  // framework", which "attach to fronts".
  {
    pavement: 'metal-deck', kerb: 'channel', marking: 'centre-line',
    kerbHeight: 0.10, footwayWidth: 4.4, clutterDensity: 5.8,
    clutter: ['balcony', 'bracket', 'lamp-bracket', 'railing', 'puddle-grate', 'drain-cover'],
    lived: ['cafe-set', 'bicycle'],
    shopfrontDensity: 0.30, wetnessBias: 0.55, polish: 0.80, kerbTone: 2.2, kerbChroma: 0.7,
  },
  // 8 botanical-dome — not paved at all. This is the spec's section D: the
  // highest planting count in the set, and *continuous* terrace planting rather
  // than discrete pots, which is what `planter-row` is for.
  {
    pavement: 'dirt', kerb: 'planter-edge', marking: 'none',
    kerbHeight: 0.12, footwayWidth: 3.0, clutterDensity: 9.5,
    clutter: ['planter-row', 'planter-row', 'planter', 'potted-palm', 'bench', 'railing'],
    lived: ['cafe-set', 'planter-tall', 'doorstep-pots'],
    shopfrontDensity: 0.10, wetnessBias: 0.75, polish: 0.25, kerbTone: 2.5, kerbChroma: 0.95,
  },
  // 9 canal-district — quay flagstone, open channel, continuous terrace rails,
  // and mooring bollards: the one place the spec's "bollards unconfirmed" is
  // outweighed, because the district's own description asks for them and a quay
  // edge is exactly what a bollard is for.
  {
    pavement: 'flagstone', kerb: 'channel', marking: 'none',
    kerbHeight: 0.18, footwayWidth: 3.2, clutterDensity: 7.0,
    clutter: ['railing', 'railing', 'planter', 'bollard', 'lamp-bracket', 'crate-stack'],
    lived: ['barrel', 'pallet', 'bicycle'],
    shopfrontDensity: 0.30, wetnessBias: 0.70, polish: 0.40, kerbTone: 2.6, kerbChroma: 1.0,
  },
  // 10 market-spine — cobbles, bollards instead of a kerb.
  // DESIGN HYPOTHESIS, NOT REFERENCE-DERIVED: the spec states the reference set
  // contains no legible night market. The density is a judgement, not a
  // measurement, and none of these names has reference authority.
  {
    pavement: 'cobble', kerb: 'bollard-line', marking: 'none',
    kerbHeight: 0.13, footwayWidth: 2.2, clutterDensity: 15.0,
    clutter: ['kiosk', 'crate-stack', 'awning', 'projecting-sign', 'lamp-bracket',
      'newspaper-box', 'sandwich-board', 'planter', 'bollard'],
    lived: ['cafe-set', 'sacks', 'handcart'],
    shopfrontDensity: 1.00, wetnessBias: 0.40, polish: 0.45, kerbTone: 2.9, kerbChroma: 1.2,
  },
];

/** Value (luminance proxy) of a linear colour. Cheap, order-preserving, portable. */
export const valueOf = (c: Vec3): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

const scale3 = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Positive linear scale that reaches the requested VALUE (max channel, not
 * luminance) while keeping hue. Matching on max channel rather than luminance
 * is what makes `kerbTone` mean what the doc comment on it says it means.
 */
const valueScaled = (c: Vec3, targetValue: number): Vec3 => {
  const v = hsv(c)[2];
  return v > 1e-5 ? scale3(c, targetValue / v) : [targetValue, targetValue, targetValue];
};

/**
 * Road-kind sharpening.
 *
 * A district's default describes its *typical* street. The road kind overrides
 * whatever the district would otherwise imply, because a market street is not
 * a residential street even in the same block, and a service alley has no
 * footway at all. Applied after the district lookup, never before.
 */
function sharpenForKind(g: GroundGrammar, kind: RoadKind, lived: readonly string[]): void {
  switch (kind) {
    case 'artery':
      // Wide, fast, marked, swept. Less furniture, wider carriageway feel.
      g.marking = g.pavement === 'metal-deck' || g.pavement === 'board-formed'
        ? 'centre-line' : 'lane-dashes';
      g.footwayWidth *= 0.8;
      g.kerbHeight *= 0.9;
      g.clutterDensity *= 0.7;
      g.polish = clamp(g.polish + 0.15, 0, 1);
      break;
    case 'street':
      // District default, unchanged. Present so the switch is exhaustive.
      break;
    case 'alley':
      // No kerb, no footway, no paint. Drains, and the district's things people
      // leave against the wall (D30): the old-town alley of pose 14 is sheet C's
      // canyon and had no brazier, firewood or kiln stock in it. Without a lived
      // kit, a quarter of the street rate, as before.
      g.kerb = 'flush';
      g.marking = 'none';
      g.kerbHeight *= 0.5;
      g.footwayWidth *= 0.3;
      // 0.4 of the street rate with a lived kit: at the full rate the alleys' many
      // metres pushed every chunk past the furniture budget and the throttle thinned
      // the streets' lamp brackets (20.6 -> 16.9 lamps a chunk).
      g.clutterDensity *= lived.length === 0 ? 0.25 : 0.4;
      g.clutter = ['drain-cover', 'manhole', ...lived].map(clutterIndex).filter((i) => i >= 0);
      break;
    case 'market':
      // Carriageway given over to trading. Cobbles, bollards in place of a kerb,
      // maximum density, shopfronts spilling across the whole footway.
      g.pavement = 'cobble';
      g.kerb = 'bollard-line';
      g.marking = 'none';
      g.kerbHeight = Math.min(g.kerbHeight, 0.14);
      g.footwayWidth *= 1.3;
      g.clutterDensity *= 2.2;
      g.shopfrontDensity = Math.max(g.shopfrontDensity, 0.9);
      break;
    case 'rail':
      // Ballast and sleepers, not a carriageway. Rails, not paint.
      g.pavement = 'dirt';
      g.kerb = 'flush';
      g.marking = 'tram-rails';
      g.kerbHeight = 0.06;
      g.footwayWidth = 0;
      g.clutterDensity = 0;
      g.clutter = [];
      break;
    case 'canal':
      // Quay edge: hard engineering, open channel, mooring furniture.
      g.pavement = 'board-formed';
      g.kerb = 'channel';
      g.marking = 'none';
      g.footwayWidth = Math.min(g.footwayWidth, 1.6);
      g.kerbHeight = Math.max(g.kerbHeight, 0.18);
      g.clutter = [...new Set([...g.clutter, clutterIndex('bollard')])].filter((i) => i >= 0);
      break;
  }
}

const GRAMMAR_CACHE = new Map<number, GroundGrammar>();

/**
 * The grammar for a point. `kind` sharpens the district default.
 *
 * Cached per (district, kind): this is called once per ground feature per chunk
 * bake, and the returned object is treated as read-only by every consumer.
 */
export function groundGrammarFor(districtId: number, kind: RoadKind): GroundGrammar {
  const d = ((districtId | 0) % DISTRICT_STYLES.length + DISTRICT_STYLES.length) % DISTRICT_STYLES.length;
  const key = d * 16 + ROAD_CODE[kind];
  const hit = GRAMMAR_CACHE.get(key);
  if (hit) return hit;

  const style: DistrictStyle = districtStyle(d);
  const src = DISTRICT_GROUND[d] ?? DISTRICT_GROUND[0];
  const g: GroundGrammar = {
    pavement: src.pavement,
    kerb: src.kerb,
    marking: src.marking,
    kerbHeight: src.kerbHeight,
    footwayWidth: src.footwayWidth,
    clutterDensity: src.clutterDensity * (src.clutter.length + src.lived.length) / Math.max(1, src.clutter.length),
    clutter: [...src.clutter, ...src.lived].map(clutterIndex).filter((i) => i >= 0),
    shopfrontDensity: src.shopfrontDensity,
    wetnessBias: src.wetnessBias,
    polish: src.polish,
    albedo: style.palette.ground,
    kerbAlbedo: style.palette.trim,
    paintAlbedo: style.palette.trim,
    kerbTone: src.kerbTone,
  };
  // Sharpen FIRST, derive the colours from the sharpened grammar.
  //
  // The order matters and getting it wrong was silent. Banding `albedo` before
  // sharpening meant the colour described the district's *default* family while
  // `pavement` described the *actual* one, so the shader decoded a different
  // family than the grammar claimed on 30 of 66 pairs; and `kerbTone` was
  // applied against the raw palette value rather than the banded carriageway
  // value, which put rust-hangars' kerb at 0.20x its own road — darker than
  // the carriageway, the exact opposite of what a kerb is.
  sharpenForKind(g, kind, src.lived);

  // THE WIRING. `palette.ground` is the 6th hex argument of `pal()` in
  // districts.ts and has been read by nothing in the repository until here.
  //
  // It is banded into the sharpened family's (saturation, value) window. That is
  // not cosmetic: it is the only thing that lets the fragment stage recover the
  // pavement family from the vertex colour at all. Hue — the district identity —
  // survives. See the decoder section below.
  g.albedo = bandAlbedo(style.palette.ground, g.pavement);
  const roadValue = Math.max(1e-3, hsv(g.albedo)[2]);
  // Kerb: the district's own trim, value-matched to the authored tone ratio
  // against the *banded* carriageway so `kerbTone` means what it says.
  g.kerbAlbedo = valueScaled(style.palette.trim, roadValue * g.kerbTone);
  // Paint: the district's accent hue in a band that reads as road paint. Real
  // road paint is never neutral and never white, and banded so the shader can
  // tell it from a pale flagstone slab with no per-vertex flag.
  g.paintAlbedo = bandAlbedo(style.accentColor, 'paint');

  if (GRAMMAR_CACHE.size < 128) GRAMMAR_CACHE.set(key, g);
  return g;
}

/** Stable small integer per road kind, for the cache key and for any wire format. */
export const ROAD_CODE: Record<RoadKind, number> = {
  canal: 0, market: 1, rail: 2, artery: 3, street: 4, alley: 5,
};

// ---------------------------------------------------------------- street frame

/** A point resolved into street-relative coordinates. */
export interface StreetFrame {
  /** Signed perpendicular offset from the centreline, metres. */
  lateral: number;
  /** Metres along the centreline. */
  along: number;
  /** Unit tangent. */
  tx: number;
  tz: number;
  /** Unit left-normal of the tangent (in the XZ plane). */
  nx: number;
  nz: number;
  /** Full carriageway width. */
  width: number;
  kind: RoadKind;
  districtId: number;
  /** `dist - width/2`. Negative inside the carriageway. */
  clearance: number;
  /** Closest point on the centreline. */
  px: number;
  pz: number;
}

/** Reusable frame. Mirrors `planSample`/`scratchSample` at citygen.ts:238 and :482. */
const scratchFrame: StreetFrame = {
  lateral: 0, along: 0, tx: 1, tz: 0, nx: 0, nz: 1, width: 1,
  kind: 'street', districtId: 0, clearance: 0, px: 0, pz: 0,
};
const scratchSample2: StreetSample = {
  dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
};

/**
 * Non-allocating street query. Fills and returns `out`.
 *
 * `out.kind` is `'street'` and `out.lateral` is the signed offset even when the
 * point is far from any carriageway — check `out.clearance < 0` for "on the
 * road". Callers in tight loops MUST pass their own `out`; the module-level
 * scratch is only for the trivial one-shot convenience of {@link streetFrame}.
 */
export function streetFrameAt(plan: CityPlan, x: number, z: number, out: StreetFrame): StreetFrame {
  const s = sampleStreetPlan(plan, x, z, scratchSample2);
  out.tx = s.tx;
  out.tz = s.tz;
  // Left normal of the tangent, in XZ. Same handedness as citygen.ts:523
  // (`nX = -s.tz, nZ = s.tx`), so a building's `side` and a footway's agree.
  out.nx = -s.tz;
  out.nz = s.tx;
  out.width = s.width;
  out.kind = s.kind;
  out.clearance = s.clearance;
  out.px = s.px;
  out.pz = s.pz;
  const dx = x - s.px, dz = z - s.pz;
  out.lateral = dx * out.nx + dz * out.nz;
  out.along = dx * s.tx + dz * s.tz;
  out.districtId = districtAtField(plan.districts, x, z);
  return out;
}

/** Allocating convenience form. Fine outside loops; use {@link streetFrameAt} inside them. */
export const streetFrame = (seed: number, x: number, z: number): StreetFrame =>
  streetFrameAt(cityPlan(seed), x, z, { ...scratchFrame });

// ---------------------------------------------------------------- bake context

/**
 * The context every ground bake function receives.
 *
 * `frame.lateral` is relative to the *nearest* carriageway and `frame.width` is
 * that carriageway's full width, so "am I on the road" is
 * `Math.abs(frame.lateral) <= frame.width * 0.5` and nothing else needs to
 * re-sample the street field.
 */
export interface GroundBakeCtx {
  /** Write geometry here — the chunk's solid builder. */
  builder: MeshBuilder;
  rng: Rng;
  plan: CityPlan;
  chunk: CityChunk;
  lod: number;
  seed: number;
  /** `clearance` is -1 (i.e. mid-carriageway) when the point is on a carriageway. */
  frame: StreetFrame;
  grammar: GroundGrammar;
}

/** Grammar for a frame, resolved from its district and road kind. */
export const grammarForFrame = (f: StreetFrame): GroundGrammar =>
  groundGrammarFor(f.districtId, f.kind);

// ---------------------------------------------------------------- the decoder

/**
 * Recover a pavement family from the vertex colour.
 *
 * WHY THIS EXISTS, stated plainly because it looks like a smell: the vertex
 * format is full at 12 floats and is shared with `shadow.wgsl`, which has its
 * own copy of `VSIn` — so no per-vertex attribute can be added. Chunk geometry
 * also draws through the identity instance, so there is no per-draw `matId`
 * either. That leaves exactly ONE per-vertex channel that reaches the fragment
 * stage: `color.rgb`.
 *
 * The first attempt at this decoded the family from the raw district colour and
 * it was WRONG FOR 37 OF THE 66 (district, road kind) pairs — because `albedo`
 * is a property of the DISTRICT while the family is a property of the DISTRICT
 * *AND* the ROAD KIND: Lantern Bazaar is terracotta-tile for a street and dirt
 * for the rail and board-formed for the canal, all with one albedo. No
 * classifier over a per-district colour can ever work, and a better reference
 * table would not have rescued it. It was thrown out on the measurement.
 *
 * So the encoding is made deliberate instead of hoped-for. Each family owns a
 * canonical (saturation, value) band; the grammar writes the district's hue
 * into that band before emitting the vertex. The shader recovers the family
 * from the band and keeps the hue for district identity. Hue carries less
 * district identity in the ground than the raw palette did — that is the price
 * and it is recorded here rather than hidden.
 *
 * Portable: pure arithmetic, no texture, no lookup beyond these two tables.
 * Mirrored by `pavementFamily()` in `src/shaders/gbuffer.wgsl`.
 */
export const FAMILY_BAND: Record<PavementFamily | 'paint', [number, number]> = {
  // [saturation, value] — value is max(r,g,b) in LINEAR space
  asphalt: [0.050, 0.150],
  rubber: [0.030, 0.075],
  dirt: [0.190, 0.215],
  'metal-deck': [0.235, 0.330],
  cobble: [0.300, 0.290],
  boardwalk: [0.405, 0.375],
  'terracotta-tile': [0.545, 0.470],
  flagstone: [0.135, 0.560],
  'board-formed': [0.045, 0.735],
  // Not a pavement. Road paint sits in a band nothing else occupies, so the
  // shader can tell a painted line from a pale slab by colour alone.
  paint: [0.600, 0.195],
};

/** Stable decode order; also the order the confusion matrix is printed in. */
export const BAND_ORDER: readonly (PavementFamily | 'paint')[] = [
  'asphalt', 'rubber', 'dirt', 'metal-deck', 'cobble',
  'boardwalk', 'terracotta-tile', 'flagstone', 'board-formed', 'paint',
];

/** Existing vertex mask channel: negative values carry ground data; emission is nonnegative.
 * Integer payload is class*16+family; fractional payload is the authored kerb height.
 * Flat interpolation in WGSL preserves this exact per-primitive contract without a new ABI.
 */
export type GroundSurfaceClass = 'carriageway' | 'paving' | 'kerb-face' | 'kerb-top' | 'gutter' | 'paint';
export const GROUND_SURFACE_CLASSES: readonly GroundSurfaceClass[] = ['carriageway', 'paving', 'kerb-face', 'kerb-top', 'gutter', 'paint'];
export function groundSurfaceTag(surface: GroundSurfaceClass, family: PavementFamily | 'paint', height = 0): number {
  return -(1 + GROUND_SURFACE_CLASSES.indexOf(surface) * 16 + BAND_ORDER.indexOf(family) + clamp(height, 0, 0.99));
}
export function decodeGroundSurfaceTag(tag: number) {
  const payload = -tag - 1;
  return { surface: GROUND_SURFACE_CLASSES[Math.floor(payload / 16)], family: BAND_ORDER[Math.floor(payload) % 16], height: payload - Math.floor(payload) };
}
/** Asphalt carriageways meet constructed stone footways; other authored decks continue their family. */
export function walkingFamily(g: GroundGrammar): PavementFamily {
  return g.pavement === 'asphalt' || g.pavement === 'rubber' || g.pavement === 'dirt' ? 'flagstone' : g.pavement;
}
export const walkingAlbedo = (g: GroundGrammar): Vec3 => bandAlbedo(g.albedo, walkingFamily(g));

/** Hue in turns (0..1), saturation (0..1) and value (0..1) of a linear colour. */
export function hsv(c: Vec3): [number, number, number] {
  const mx = Math.max(c[0], c[1], c[2]);
  const mn = Math.min(c[0], c[1], c[2]);
  const d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    if (mx === c[0]) h = ((c[1] - c[2]) / d) % 6;
    else if (mx === c[1]) h = (c[2] - c[0]) / d + 2;
    else h = (c[0] - c[1]) / d + 4;
    h = ((h / 6) % 1 + 1) % 1;
  }
  return [h, mx > 1e-6 ? d / mx : 0, mx];
}

/** Nearest family band to a measured (saturation, value). */
export function familyFromBand(sat: number, val: number): PavementFamily | 'paint' {
  let best: PavementFamily | 'paint' = 'asphalt';
  let bestD = Infinity;
  for (const f of BAND_ORDER) {
    const b = FAMILY_BAND[f];
    const d = (sat - b[0]) * (sat - b[0]) + (val - b[1]) * (val - b[1]);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

/** The decode the shader performs. Same arithmetic as `familyFromBand`. */
export const pavementFamily = familyFromBand;

/**
 * Write `c`'s hue into a family's band.
 *
 * Saturation and value are set exactly, so the band survives a round trip
 * through the vertex buffer and the shader's decode is exact rather than
 * approximate. Hue is preserved: it is the only part of the district identity
 * that survives the banding, and inventing one for a neutral input would make
 * up a colour nobody authored.
 */
export function bandAlbedo(c: Vec3, family: PavementFamily | 'paint'): Vec3 {
  const [h] = hsv(c);
  const [s, v] = FAMILY_BAND[family];
  const chroma = v * s;
  const m = v - chroma;
  const hf = h * 6;
  const seg = Math.floor(hf) % 6;
  const q = chroma * (hf - Math.floor(hf));
  switch (seg) {
    case 0: return [chroma + m, q + m, m];
    case 1: return [q + m, chroma + m, m];
    case 2: return [m, chroma + m, q + m];
    case 3: return [m, q + m, chroma + m];
    case 4: return [q + m, m, chroma + m];
    default: return [chroma + m, m, q + m];
  }
}

/** Joint geometry the fragment stage synthesises for a family, in metres. */
export function pavingPitch(f: PavementFamily): { joint: number; slab: [number, number]; grain: number } {
  switch (f) {
    case 'flagstone': return { joint: 0.030, slab: [0.90, 0.60], grain: 3.0 };
    case 'cobble': return { joint: 0.016, slab: [0.22, 0.19], grain: 7.0 };
    case 'boardwalk': return { joint: 0.025, slab: [0.16, 2.40], grain: 5.0 };
    case 'board-formed': return { joint: 0.020, slab: [2.40, 0.22], grain: 2.0 };
    case 'terracotta-tile': return { joint: 0.022, slab: [0.30, 0.30], grain: 4.0 };
    case 'metal-deck': return { joint: 0.035, slab: [1.20, 1.20], grain: 2.2 };
    case 'rubber': return { joint: 0.020, slab: [0.50, 0.50], grain: 9.0 };
    case 'dirt': return { joint: 0, slab: [0, 0], grain: 1.2 };
    case 'asphalt': return { joint: 0, slab: [0, 0], grain: 1.6 };
  }
}
