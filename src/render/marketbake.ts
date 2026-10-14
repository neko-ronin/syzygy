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

import { makeRng, type Vec3 } from '../core/math';
import { GROUND_Y } from '../world/citygen';
import { MeshBuilder, yawFromDir } from '../world/geometry';
import type { GroundBakeCtx } from '../world/groundgrammar';
import type { CrowdObstacle } from '../world/crowdobstacles';
import {
  COUNTER_TOP, MARKET_LOD_GONE, RIGGING_LOD, SAG_ACROSS, SAG_ALONG,
  marketCatenary, marketGrammarFor,
  type MarketCloth, type MarketCrate, type MarketLantern, type MarketLanternString, type MarketStall,
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
function bakeRigging(bld: MeshBuilder, s: MarketStall, obstacles: CrowdObstacle[]): void {
  const halfPitch = s.pitch * 0.5;
  const legTop = s.eave;
  const postTop = s.ridge;
  const at = (lateral: number, along: number, y: number): Vec3 =>
    [s.cx + s.nx * lateral + s.tx * along, y, s.cz + s.nz * lateral + s.tz * along];
  const block = (lateral: number, along: number, halfAlong: number, halfAcross: number, maxY: number, kind: string): void => {
    const p = at(lateral, along, GROUND_Y);
    obstacles.push({ x: p[0], z: p[2], tx: s.tx, tz: s.tz, halfAlong, halfAcross, minY: GROUND_Y, maxY, kind });
  };
  for (const end of [-1, 1]) {
    const along = end * halfPitch;
    // The building-side post is common to both types.
    bld.pushCylinder(at(s.back, along, GROUND_Y), at(s.back, along, postTop), LEG_RADIUS, 4, s.frameColor);
    block(s.back, along, LEG_RADIUS, LEG_RADIUS, postTop, 'market-post');
    if (s.frame === 'poles') {
      // Roadward legs stand inside the overhang; they are what the tarpaulin's
      // low edge is actually tied to.
      bld.pushCylinder(at(s.front, along, GROUND_Y), at(s.front, along, legTop), LEG_RADIUS, 4, s.frameColor);
      block(s.front, along, LEG_RADIUS, LEG_RADIUS, legTop, 'market-post');
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
}

/** Counter exists independently of a canopy, including open-air bare pitches. */
function bakeCounter(bld: MeshBuilder, s: MarketStall, obstacles: CrowdObstacle[]): void {
  bld.pushBox(
    [s.cx + s.nx * s.counter, GROUND_Y + COUNTER_TOP * 0.5, s.cz + s.nz * s.counter],
    [s.pitch * 0.42, COUNTER_TOP * 0.5, 0.28], s.frameColor, { rotationY: yawFromDir(s.tx, s.tz) },
  );
  obstacles.push({ x: s.cx + s.nx * s.counter, z: s.cz + s.nz * s.counter, tx: s.tx, tz: s.tz,
    halfAlong: s.pitch * 0.42, halfAcross: 0.28, minY: GROUND_Y, maxY: GROUND_Y + COUNTER_TOP, kind: 'market-counter' });
}

/** Crates and sacks under the counter. `stack` puts the second crate on the first. */
function bakeCrate(bld: MeshBuilder, s: MarketStall, c: MarketCrate, baseY: number): void {
  bld.pushBox(
    [s.cx + s.nx * c.lateral + s.tx * c.along, baseY + c.half[1], s.cz + s.nz * c.lateral + s.tz * c.along],
    c.half, c.color, { rotationY: yawFromDir(s.tx, s.tz) + c.yaw },
  );
}

/** Fruit and veg, warm-led like the rest of sheet A, with one green. */
const PRODUCE: Vec3[] = [[0.85, 0.36, 0.05], [0.62, 0.07, 0.04], [0.86, 0.66, 0.08], [0.28, 0.48, 0.07], [0.36, 0.10, 0.22], [0.80, 0.52, 0.30]];
const TRAY: Vec3 = [0.36, 0.24, 0.13];

/**
 * Goods on the counter: shallow trays heaped with produce wherever the crates
 * leave it free. The counter read as a bare grey slab in the hero's near field
 * (R14 review 4). Bake-time dressing, from the stall's own seed.
 */
function bakeGoods(bld: MeshBuilder, s: MarketStall): void {
  const r = makeRng((Math.round(s.along * 97) * 2 + (s.side > 0 ? 1 : 0)) ^ 0x600d5);
  const yaw = yawFromDir(s.tx, s.tz), half = s.pitch * 0.42, top = GROUND_Y + COUNTER_TOP;
  const at = (along: number, lat: number, y: number): Vec3 =>
    [s.cx + s.nx * (s.counter + lat) + s.tx * along, y, s.cz + s.nz * (s.counter + lat) + s.tz * along];
  for (let t = -half + 0.3; t < half - 0.25; t += 0.5 + r.next() * 0.3) {
    if (s.crates.some((c) => c.stack === 0 && Math.abs(c.lateral - s.counter) < 0.6 && Math.abs(c.along - t) < Math.max(c.half[0], c.half[2]) + 0.28)) continue;
    if (r.next() < 0.15) continue;
    bld.pushBox(at(t, 0, top + 0.03), [0.21, 0.03, 0.19], TRAY, { rotationY: yaw });
    const c = PRODUCE[r.int(0, PRODUCE.length - 1)];
    // Heaped, not scattered: produce read as small at the hero's lens (review 5).
    // Two-ring spheres: at 10 cm a third ring is below a pixel at every review
    // lens, and the hero's shadow cascades paid for it (session-end A/B).
    for (let k = 0, n = 3 + r.int(0, 2); k < n; k++) {
      const rad = 0.085 + r.next() * 0.045;
      bld.pushSphere(at(t + r.jitter(0.12), r.jitter(0.1), top + 0.06 + rad * (k < 3 ? 0.8 : 1.9)), rad, 2, 4, [c[0] * (0.85 + r.next() * 0.25), c[1] * (0.85 + r.next() * 0.25), c[2]]);
    }
  }
}

const WICKER: Vec3 = [0.44, 0.31, 0.15];
const SACKCLOTH: Vec3 = [0.42, 0.34, 0.21];
/** Strings of chillies, garlic and dried goods; a woven basket; a cloth bag; a price board. */
const HUNG: Vec3[] = [[0.58, 0.07, 0.03], [0.80, 0.74, 0.60], [0.52, 0.30, 0.10]];

/**
 * The stall's near read beyond the counter (review 5: produce visible but small):
 * goods hung from the eave pole, at 1.8-2.3 m where the hero sees them over the
 * crowd's heads; baskets of produce on the ground under the canopy; crates and
 * sacks stacked behind the counter (D30's stall overflow). Bake-time, from the
 * stall's own seed, so the grammar's layout and the hero subject do not move.
 */
function bakeDressing(bld: MeshBuilder, s: MarketStall, obstacles: CrowdObstacle[]): void {
  const r = makeRng((Math.round(s.along * 131) * 2 + (s.side > 0 ? 1 : 0)) ^ 0xd2e55);
  const yaw = yawFromDir(s.tx, s.tz), half = s.pitch * 0.42;
  const at = (along: number, lat: number, y: number): Vec3 =>
    [s.cx + s.nx * lat + s.tx * along, y, s.cz + s.nz * lat + s.tz * along];
  const block = (along: number, lat: number, ha: number, hc: number, maxY: number, kind: string): void => {
    const p = at(along, lat, GROUND_Y);
    obstacles.push({ x: p[0], z: p[2], tx: s.tx, tz: s.tz, halfAlong: ha, halfAcross: hc, minY: GROUND_Y, maxY, kind });
  };
  const inward = Math.sign(s.counter - s.front) || 1;
  // Hung from the eave pole along the front edge.
  if (s.module !== 'bare') {
    for (let k = 0, n = 2 + r.int(0, 3); k < n; k++) {
      const u = (((k + 0.5) / n) * 2 - 1) * half + r.jitter(0.12), lat = s.front + inward * 0.06;
      const drop = Math.max(0.25, s.eave - GROUND_Y - 2.15) + r.next() * 0.25, top = s.eave, low = top - drop;
      bld.pushCylinder(at(u, lat, top), at(u, lat, low), 0.008, 3, [0.18, 0.17, 0.16]);
      const kind = r.int(0, 3);
      if (kind === 0) {
        // A string of chillies or garlic: a short column of bulbs.
        const c = HUNG[r.int(0, HUNG.length - 1)];
        for (let i = 0; i < 4; i++) bld.pushSphere(at(u + r.jitter(0.03), lat, low - 0.05 - i * 0.08), 0.05 + r.next() * 0.015, 2, 4, c);
      } else if (kind === 1) {
        bld.pushCylinder(at(u, lat, low - 0.2), at(u, lat, low), 0.16, 6, WICKER, { radiusTop: 0.19, capEnds: true });
      } else if (kind === 2) {
        bld.pushBox(at(u, lat, low - 0.15), [0.1, 0.15, 0.07], [s.clothAlt[0] * 0.8, s.clothAlt[1] * 0.8, s.clothAlt[2] * 0.8], { rotationY: yaw + r.jitter(0.5) });
      } else {
        // A price board: dark, a chalked line.
        bld.pushBox(at(u, lat, low - 0.16), [0.2, 0.15, 0.015], [0.05, 0.05, 0.045], { rotationY: yaw });
        bld.pushBox(at(u, lat + inward * -0.017, low - 0.12), [0.14, 0.012, 0.004], [0.75, 0.72, 0.62], { rotationY: yaw });
      }
    }
  }
  // Baskets of produce on the ground in front of the counter, under the roof.
  for (let k = 0, n = r.int(0, 2); k < n; k++) {
    const u = r.jitter(half * 0.8), lat = s.counter - inward * (0.55 + r.next() * 0.15), rad = 0.2 + r.next() * 0.1, h = 0.26 + r.next() * 0.1;
    bld.pushCylinder(at(u, lat, GROUND_Y), at(u, lat, GROUND_Y + h), rad, 6, WICKER, { radiusTop: rad * 1.15, capEnds: true });
    const c = PRODUCE[r.int(0, PRODUCE.length - 1)];
    for (let i = 0; i < 3; i++) bld.pushSphere(at(u + r.jitter(rad * 0.5), lat + r.jitter(rad * 0.5), GROUND_Y + h + 0.05), 0.09 + r.next() * 0.04, 2, 4, c);
    block(u, lat, rad * 1.15, rad * 1.15, GROUND_Y + h + 0.12, 'market-basket');
  }
  // Behind the counter: stock waiting, crates half stacked and sacks.
  const room = Math.abs(s.back - s.counter);
  if (room > 0.9) {
    for (let k = 0, n = 1 + r.int(0, 2); k < n; k++) {
      const u = r.jitter(half * 0.75), lat = s.back - inward * (0.35 + r.next() * Math.min(0.3, room - 0.8));
      if (r.bool(0.55)) {
        const hx = 0.24 + r.next() * 0.1;
        for (let i = 0, m = 1 + r.int(0, 2); i < m; i++) {
          bld.pushBox(at(u + r.jitter(0.05), lat, GROUND_Y + hx * 0.75 + i * hx * 1.5), [hx, hx * 0.75, hx * 0.85], i % 2 ? TRAY : [0.30, 0.20, 0.11], { rotationY: yaw + r.jitter(0.35) });
        }
        block(u, lat, hx * 1.2, hx * 1.2, GROUND_Y + 1.0, 'market-crates');
      } else {
        for (let i = 0; i < 3; i++) {
          // On the deck: centred at 0.2 m they sank 7 cm into it (__selftest_market).
          const rad = 0.22 + r.next() * 0.05;
          bld.pushSphere(at(u + (i - 1) * 0.3, lat + r.jitter(0.08), GROUND_Y + rad), rad, 2, 5, SACKCLOTH);
        }
        block(u, lat, 0.55, 0.3, GROUND_Y + 0.45, 'market-sacks');
      }
    }
  }
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

/** The bulb over a counter, on a drop to the roof directly above it. */
function bakeStallLamp(bld: MeshBuilder, s: MarketStall, l: MarketLantern): void {
  const lat = Math.hypot(l.pos[0] - s.cx, l.pos[2] - s.cz) * Math.sign(s.front || 1);
  const t = (lat - s.front) / ((s.back - s.front) || 1);
  const roof: Vec3 = [l.pos[0], GROUND_Y + s.eave + (s.ridge - s.eave) * t, l.pos[2]];
  bld.pushCylinder(roof, l.pos, 0.012, 3, [0.18, 0.17, 0.16]);
  bld.pushSphere(l.pos, l.radius, LANTERN_RINGS, LANTERN_SECTORS, l.color, { emissive: l.emissive });
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
export interface MarketBakeResult { stalls: MarketStall[]; obstacles: CrowdObstacle[]; }
export interface MarketBakeState { stalls: Set<string>; strings: Set<string>; cloth: Set<string>; islands: Set<string>; }
export const marketBakeState = (): MarketBakeState => ({ stalls: new Set(), strings: new Set(), cloth: new Set(), islands: new Set() });
export function bakeMarketDetail(bld: MeshBuilder, ctx: GroundBakeCtx, emitted = marketBakeState()): MarketBakeResult {
  const result: MarketBakeResult = { stalls: [], obstacles: [] };
  if (ctx.lod >= MARKET_LOD_GONE) return result;
  const desc = marketGrammarFor({
    seed: ctx.seed, plan: ctx.plan, chunk: ctx.chunk,
    kind: ctx.frame.kind, districtId: ctx.frame.districtId,
  });
  if (desc.stalls.length === 0 && desc.strings.length === 0) return result;

  const detailed = ctx.lod <= RIGGING_LOD;
  for (const s of desc.stalls) {
    if (s.lod < ctx.lod) continue;
    const key = `${s.along}:${s.side}`;
    if (emitted.stalls.has(key)) continue;
    emitted.stalls.add(key);
    result.stalls.push(s);
    bakeCanopy(bld, s);
    // A `bare` stall is a counter and crates in the open: no roof and no frame.
    if (detailed && s.module !== 'bare') bakeRigging(bld, s, result.obstacles);
    if (detailed) { bakeCounter(bld, s, result.obstacles); bakeGoods(bld, s); bakeDressing(bld, s, result.obstacles); }
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
    if (detailed && s.lamp) bakeStallLamp(bld, s, s.lamp);
  }

  for (const str of desc.strings) {
    if (str.lod < ctx.lod) continue;
    const key = `${str.along}:${str.a.join(',')}:${str.b.join(',')}`;
    if (emitted.strings.has(key)) continue;
    emitted.strings.add(key);
    bakeLanternString(bld, str);
  }

  for (const c of desc.cloth) {
    if (c.lod < ctx.lod) continue;
    const key = c.pos.join(',');
    if (emitted.cloth.has(key)) continue;
    emitted.cloth.add(key);
    bakeCloth(bld, c);
  }
  return result;
}
