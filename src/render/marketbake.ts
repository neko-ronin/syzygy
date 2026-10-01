/**
 * Market-street detail, baked.
 *
 * The only module in the project that knows both the market grammar
 * (`src/world/marketgrammar.ts`) and the mesh layer. That split is deliberate:
 * the grammar is plain data and testable without a GPU, this file is the one
 * that turns it into triangles, and a port to a different mesh layer replaces
 * this file and nothing else.
 *
 * ── Wiring note for the caller ─────────────────────────────────────────────
 * `GroundBakeCtx` carries no light sink, so the clustered lights the grammar
 * wants cannot leave from here. They are already shaped exactly like
 * `GroundLight`, so the fix at the `bakeMarketDetail` call site in
 * `groundbake.ts` is one loop, next to the call that is already there:
 *
 * ```ts
 * bakeMarketDetail(bld, ctx);
 * for (const l of marketGrammarFor(ctx).lights) lights.push(l);
 * ```
 *
 * Recomputing the grammar for that is not a second opinion that might disagree:
 * the grammar is a pure function of (seed, plan, chunk, kind, district), so the
 * second call returns the same light list. That property is why the grammar
 * forks its own RNG per element instead of drawing from `ctx.rng` — see the
 * determinism note in its header.
 *
 * ── What is not built ──────────────────────────────────────────────────────
 * There is no steam plume. There is no particle system in this project, and a
 * weather field with no consumer is the documented failure mode here
 * (PROCESS.md rule 5, `COVERAGE.md` PHANTOM rows). The cooking vent below is
 * real geometry — a lit firebox under a grille — and is the only honest part of
 * "steam" that can exist without a shader term behind it.
 */

import type { Vec3 } from '../core/math';
import { GROUND_Y } from '../world/citygen';
import { MeshBuilder, yawFromDir } from '../world/geometry';
import type { GroundBakeCtx } from '../world/groundgrammar';
import {
  COUNTER_TOP, MARKET_LOD_GONE, RIGGING_LOD, SAG_ACROSS, SAG_ALONG,
  marketCatenary, marketGrammarFor,
  type MarketCloth, type MarketCrate, type MarketLanternString, type MarketLight, type MarketStall,
} from '../world/marketgrammar';

// ---------------------------------------------------------------- the build

/** Segments the roof is sampled at, across its depth. Two is the minimum for a
 *  cloth that dips at mid-span instead of being a flat plane. */
const CANOPY_SEGMENTS = 2;
/** Posts and poles. Radii, metres. */
const LEG_RADIUS = 0.045;
const POLE_RADIUS = 0.035;
const GUY_RADIUS = 0.018;
/** A cord is a smooth curve; this is how finely it is sampled. */
const CORD_SEGMENTS = 6;
const CORD_RADIUS = 0.022;
/** A lantern is 0.2 m across. Nobody resolves that, so it gets the cheapest
 *  sphere that still reads round at a distance. */
const LANTERN_RINGS = 3;
const LANTERN_SECTORS = 5;

/**
 * A point on the tarpaulin.
 *
 * `u` runs along the stall, `v` across it from the roadward edge to the
 * building. The two sags are separate because they are separate phenomena: the
 * cloth bellies *between* the poles along the street, and again between the
 * front and back edges across it.
 */
function roofPoint(s: MarketStall, u: number, v: number, depth: number): Vec3 {
  const lateral = s.front + (s.back - s.front) * v;
  const height = s.eave + (s.ridge - s.eave) * v
    - s.pitch * SAG_ALONG * Math.sin(Math.PI * u)
    - depth * SAG_ACROSS * Math.sin(Math.PI * v);
  const along = (u - 0.5) * s.pitch;
  return [s.cx + s.nx * lateral + s.tx * along, height, s.cz + s.nz * lateral + s.tz * along];
}

/**
 * The roof: alternating panels, bellied, overhanging the kerb.
 *
 * A `frame` or `bare` module has no cloth and this emits nothing for it — that is
 * the point of those two: a stripped stall and an open-air pitch stall break the
 * roofline the way another tarpaulin cannot. A `flat` module has eave and ridge
 * within 0.4 m of each other, so the same surface formula produces a horizontal
 * deck rather than a slope, and the existing eave and ridge poles read as its
 * fascia.
 */
function bakeCanopy(bld: MeshBuilder, s: MarketStall): void {
  if (!s.hasCloth) return;
  const depth = Math.abs(s.back - s.front);
  const panels = s.panels;
  const panelWidth = s.pitch / panels;
  const cross: Vec3[] = [];
  for (let i = 0; i < panels; i++) {
    cross.length = 0;
    for (let j = 0; j <= CANOPY_SEGMENTS; j++) {
      cross.push(roofPoint(s, (i + 0.5) / panels, j / CANOPY_SEGMENTS, depth));
    }
    bld.pushRibbonAlongPath(cross, panelWidth, i % 2 === 0 ? s.cloth : s.clothAlt, { uvScale: 1 });
  }
}

/**
 * The frame: two poles and a trestle, plus whatever carries the roadward edge.
 *
 * This is the part that stops the tarpaulin being a floating sheet. A canopy
 * with nothing under it is worse than no canopy at all, which is why
 * {@link RIGGING_LOD} is only ever one step behind the roof's own LOD.
 *
 * Two support types, because the references cannot choose between them (see
 * `MarketStall.frame`): `poles` stands four legs in the road and guys them back
 * to the building line; `wall-tied` carries the overhang on two raking arms
 * and stays off the building post, with nothing standing in the carriageway at
 * all. They read very differently down a street and they cost the same.
 */
function bakeRigging(bld: MeshBuilder, s: MarketStall): void {
  const halfPitch = s.pitch * 0.5;
  const legTop = s.eave;
  const postTop = s.ridge;
  const at = (lateral: number, along: number, y: number): Vec3 =>
    [s.cx + s.nx * lateral + s.tx * along, y, s.cz + s.nz * lateral + s.tz * along];
  for (const end of [-1, 1]) {
    const along = end * halfPitch;
    // The building-side post is common to both types.
    bld.pushCylinder(at(s.back, along, GROUND_Y), at(s.back, along, postTop), LEG_RADIUS, 4, s.frameColor);
    if (s.frame === 'poles') {
      // Roadward legs stand inside the overhang; they are what the tarpaulin's
      // low edge is actually tied to.
      bld.pushCylinder(at(s.front, along, GROUND_Y), at(s.front, along, legTop), LEG_RADIUS, 4, s.frameColor);
      // Guy from the head of each front leg up to the back post. This is the
      // diagonal that says "this is tied to something".
      bld.pushTubeAlongPath([at(s.front, along, legTop), at(s.back, along, postTop + 0.22)], GUY_RADIUS, 3, s.frameColor);
    } else {
      // A raking arm along the roof line, and a stay above it. Both run from
      // the building post out to the unsupported roadward edge.
      bld.pushTubeAlongPath([at(s.front, along, legTop), at(s.back, along, postTop)], LEG_RADIUS, 4, s.frameColor);
      bld.pushTubeAlongPath(
        [at(s.front, along, legTop), at(s.back, along, postTop + 0.5)],
        GUY_RADIUS, 3, s.frameColor,
      );
    }
  }
  // Eave and ridge poles run the length of the stall at the two edges.
  for (const [lateral, top] of [[s.front, legTop], [s.back, postTop]] as const) {
    bld.pushTubeAlongPath([
      [s.cx + s.nx * lateral - s.tx * halfPitch, top, s.cz + s.nz * lateral - s.tz * halfPitch],
      [s.cx + s.nx * lateral + s.tx * halfPitch, top, s.cz + s.nz * lateral + s.tz * halfPitch],
    ], POLE_RADIUS, 4, s.frameColor);
  }
  // Trestle: top and four splayed feet, as one box plus one cross bar.
  bld.pushBox(
    [s.cx + s.nx * s.counter, GROUND_Y + COUNTER_TOP * 0.5, s.cz + s.nz * s.counter],
    [s.pitch * 0.42, COUNTER_TOP * 0.5, 0.28], s.frameColor, { rotationY: yawFromDir(s.tx, s.tz) },
  );
}

/** Crates and sacks under the counter. `stack` puts the second crate on the first. */
function bakeCrate(bld: MeshBuilder, s: MarketStall, c: MarketCrate, baseY: number): void {
  bld.pushBox(
    [s.cx + s.nx * c.lateral + s.tx * c.along, baseY + c.half[1], s.cz + s.nz * c.lateral + s.tz * c.along],
    c.half, c.color, { rotationY: yawFromDir(s.tx, s.tz) + c.yaw },
  );
}

/** A lit firebox under a grille. The mouth a plume would rise from; see header. */
function bakeVent(bld: MeshBuilder, s: MarketStall): void {
  if (!s.vent) return;
  const v = s.vent;
  bld.pushBox(v.pos, v.half, [1.0, 0.44, 0.14], {
    emissive: v.glow, rotationY: yawFromDir(s.tx, s.tz),
  });
  bld.pushBox(
    [v.pos[0], v.pos[1] + v.half[1] + 0.09, v.pos[2]],
    [v.half[0] * 1.12, 0.09, v.half[2] * 1.12],
    s.frameColor, { rotationY: yawFromDir(s.tx, s.tz) },
  );
}

/** Bracket off the building line, board hanging into the carriageway. */
function bakeSign(bld: MeshBuilder, s: MarketStall): void {
  const g = s.sign;
  if (!g) return;
  bld.pushTubeAlongPath([g.root, g.tip], 0.05, 3, g.frameColor);
  bld.pushTubeAlongPath([g.root, g.board], 0.03, 3, g.frameColor);
  bld.pushBox(g.board, g.halfBoard, g.boardColor, {
    emissive: g.emissive, rotationY: yawFromDir(s.tx, s.tz),
  });
}

/**
 * One cord across the street and the lanterns on it.
 *
 * The lantern-to-cord hanger is not decoration: a glowing sphere hanging in
 * mid-air with nothing above it is the same failure as unsupported cloth, and it
 * is cheaper to build the hanger than to explain the sphere later.
 */
function bakeLanternString(bld: MeshBuilder, str: MarketLanternString): void {
  const cord: Vec3[] = [];
  for (let i = 0; i <= CORD_SEGMENTS; i++) {
    cord.push(marketCatenary(str.a, str.b, str.sag, i / CORD_SEGMENTS));
  }
  bld.pushTubeAlongPath(cord, CORD_RADIUS, 3, [0.18, 0.17, 0.16]);
  const n = str.lanterns.length;
  for (let i = 0; i < n; i++) {
    const l = str.lanterns[i];
    const hanger = marketCatenary(str.a, str.b, str.sag, (i + 0.5) / n);
    bld.pushCylinder(hanger, l.pos, 0.012, 3, [0.18, 0.17, 0.16]);
    bld.pushSphere(l.pos, l.radius, LANTERN_RINGS, LANTERN_SECTORS, l.color, { emissive: l.emissive });
  }
}

/**
 * One hanging cloth.
 *
 * A strip is a single double-sided ribbon. A pennant is two — full width for
 * the upper part, half width for the rest — which gives a stepped taper that
 * reads as a point at street range for four triangles. The ribbon's `up` is
 * the cord's horizontal normal, which makes its width run *along* the cord:
 * cloth hanging edge-on to the street is a line, and a line is invisible.
 */
function bakeCloth(bld: MeshBuilder, c: MarketCloth): void {
  const up: Vec3 = [-c.tz, 0, c.tx];
  const hang = (from: Vec3, d: number, width: number): void => {
    bld.pushRibbonAlongPath(
      [from, [from[0], from[1] - d, from[2]]], width, c.color, { up, uvScale: 1 },
    );
  };
  if (c.shape === 'strip') {
    hang(c.pos, c.drop, c.halfWidth * 2);
    return;
  }
  const waist = c.drop * 0.55;
  hang(c.pos, waist, c.halfWidth * 2);
  hang([c.pos[0], c.pos[1] - waist, c.pos[2]], c.drop - waist, c.halfWidth * 0.85);
}

/**
 * Bake one chunk's market.
 *
 * Reads `ctx.frame` for the road kind and the district, and then lays the stalls
 * out along the market spine rather than along the frame — see the header of
 * `marketgrammar.ts` for why the frame alone is not enough to place anything.
 *
 * `bld` and `ctx.builder` are the same builder; the parameter is spelled out
 * because the signature has to match every other ground baker.
 */
export function bakeMarketDetail(bld: MeshBuilder, ctx: GroundBakeCtx): void {
  if (ctx.lod >= MARKET_LOD_GONE) return;
  const desc = marketGrammarFor({
    seed: ctx.seed, plan: ctx.plan, chunk: ctx.chunk,
    kind: ctx.frame.kind, districtId: ctx.frame.districtId,
  });
  if (desc.stalls.length === 0 && desc.strings.length === 0) return;

  const detailed = ctx.lod <= RIGGING_LOD;
  for (const s of desc.stalls) {
    if (s.lod < ctx.lod) continue;
    bakeCanopy(bld, s);
    // A `bare` stall is a counter and crates in the open: no roof and no frame.
    if (detailed && s.module !== 'bare') bakeRigging(bld, s);
    // Crates ride the counter, not the floor, so a stack reads as goods on a
    // table rather than as a heap in the road.
    let ground = GROUND_Y + COUNTER_TOP;
    for (const c of s.crates) {
      if (c.lod < ctx.lod) continue;
      const y = c.stack === 1 ? ground + s.crates[0].half[1] * 2 : ground;
      bakeCrate(bld, s, c, y);
      if (c.stack === 0) ground = y;
    }
    if (s.vent && s.vent.lod <= ctx.lod) bakeVent(bld, s);
    if (s.sign && s.sign.lod <= ctx.lod) bakeSign(bld, s);
  }

  for (const str of desc.strings) {
    if (str.lod < ctx.lod) continue;
    bakeLanternString(bld, str);
  }

  for (const c of desc.cloth) {
    if (c.lod < ctx.lod) continue;
    bakeCloth(bld, c);
  }

  // Hand the lantern lights to whoever is collecting them.
  //
  // `GroundBakeCtx` has no light sink yet, so this reads the field structurally
  // and does nothing if it is absent — which is the point. The review gate's
  // single biggest gap is "warm market lantern illumination does not visibly
  // reach the aisle", and the grammar has been producing these lights since
  // round 2 with nowhere to put them: 365 measured, 0 delivered.
  //
  // Written so it starts working the moment the destination lands on the ctx,
  // without needing this file to change again. If the field is named something
  // other than `lights` this silently no-ops, which is why the self-test prints
  // whether the sink was found rather than assuming it.
  const sink = (ctx as unknown as { lights?: MarketLight[] }).lights;
  if (sink) for (const l of desc.lights) sink.push(l);
}

