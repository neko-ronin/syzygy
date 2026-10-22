/**
 * The village on the fall zone's columns (DESIGN §8 "The village on top"),
 * round 0: the pile's form and silhouette only. Shipping containers (2.4 x
 * 2.6 m, 6 or 12 m long) mixed with salvaged-panel box-rooms, each layer turned
 * 90 deg from the one below, hung on steel outriggers with the bracing visible
 * below, a few boxes cantilevered further out, and an uneven stepped top with
 * antennas, a water tank and a white tarp. Per kind: a wide overhanging pile on
 * deck piers; a narrow taller pile with the stair head-house through stripped
 * cores; a linear village along a silo battery's gallery; a ring of boxes on a
 * stack's collar platform; boxes slung inside a lattice cage; a terraced crater
 * village inside a spire stump. DESIGN §8's table is the spec.
 *
 * Not this round (rounds 1-2): stairs and ladders, laundry, the revival kit,
 * ground lifelines, wreck dressing.
 *
 * Round 1 (material and light, docs/VISION_FALL_BASELINE.md's gap): the
 * containers carry sheet B's cold weighting — steel blue, slate, soot on six
 * of nine rolls, rust and the red panels as the minority accent — the crown
 * boxes get citymesh's weatherRoom dressing with a quarter of the windows lit
 * warm (D28), and the merged far mass carries a few lit panes so the mid band
 * reads as a stratum of warm points at 300-1400 m at every tier. The
 * cantilevered boxes stay inside the placement record now, with a brace each.
 *
 * Determinism: no Math.random. Every column's village rolls from
 * `makeRng(c.seed ^ VILLAGE_SALT)`, so the same seed builds the same village
 * every run, and chunking stays in step because every box stands on the one
 * column it belongs to. Face dressing and window layout roll from streams
 * keyed to the face's own identity, not the grammar stream. The palette is
 * citymesh's ROOMS (DESIGN §8: reuse it); structural steel, the tarp and the
 * lit pane are the only kit colours added here.
 *
 * Cost (D32): LOD 0 real boxes; lod >= 2 merged blocks with lit windows,
 * matching fallmesh's `lod < 2` convention. Recorded in
 * docs/FALL_VILLAGE_ROUND1.md; src/render/__probe_fallvillage.ts prints the
 * numbers.
 *
 * Round 3a (docs/FALL_LITROWS_ROUND3.md): the lit row at distance. Round 1 lit
 * one small pane (0.56 x ~0.8 m) per dressed face and two to four panes of
 * 0.6-1.1 m on the merged far mass. At pose 18 those are 2 px and sub-pixel
 * respectively, which is the reviewer's "one warm point, about 2 px" against a
 * sheet whose crowns carry rows of window blocks. Lit AREA was the lever, not
 * intensity — a brighter single point is what had already failed — so the near
 * pane is now a framed bay 0.4 of the box's length (cap 2.4 m) by 0.46 of its
 * height, every dressed face lights one, and the merged far mass carries a row
 * of 2-4 bays at two heights. All of it is emissive geometry: no light bins
 * added, so delivered/starved counts are unchanged.
 */

import { clamp, makeRng, type Rng, type Vec3 } from '../core/math';
import { BOX_H, type FallChunk, type FallColumn } from '../world/fallzone';
import { MeshBuilder, type MeshOpts } from '../world/geometry';
import { ROOMS, weatherRoom } from './citymesh';
import { pushOrientedBox, type ChunkLight } from './fallmesh';

/** Every pile rolls its own stream off the column's seed; the salt keeps the
 *  grammar independent of every other consumer of `c.seed` (`pileOn` and the
 *  access/repair rolls in fallzone.ts). */
const VILLAGE_SALT = 0x7113e55d;

/** Structural steel: fallmesh's STEEL by value, kept local to avoid an export
 *  churn in a file this round only wires a call into. */
const OUTRIGGER: Vec3 = [0.14, 0.17, 0.21];
/** The white tarp on the uneven top (DESIGN §8). */
const TARP: Vec3 = [0.72, 0.71, 0.66];
/** The lit pane colour weatherRoom uses for lit windows (citymesh's LIT, kept
 *  local like OUTRIGGER above): the crown's warm points (D28). */
const LIT_WARM: Vec3 = [1.0, 0.72, 0.4];

/** Same multiply citymesh calls `tint3`. */
const tint = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];

/**
 * Containers carry the section's cold industrial read (DESIGN §8 palette rule;
 * sheet B is "near-monochrome steel blue ... warmth only as emissive points"):
 * steel blue, slate, near-black slate and soot on six of nine rolls, with rust
 * and the red panels as the minority accent on three. ROOMS weighted that way,
 * not a new palette — round 0 ran warm-majority and the reviewer measured the
 * zone 78-94 % warm at dusk because of it. Built on demand, never at module
 * scope: this file sits in the import cycle citymesh -> fallmesh ->
 * fallvillage -> citymesh, and at the live app's entry order citymesh is still
 * initialising when this module's top level runs, so a module-scope read of
 * ROOMS was a temporal-dead-zone crash ("Cannot access 'ROOMS' before
 * initialization") that tsc, `vite build` and the probe's own entry order all
 * passed. Same rule as fallzone.ts imports: read another module's bindings
 * only inside functions. The array stays 9 entries for the roll below.
 */
const containerPalette = (): Vec3[] => [
  // Cold majority: steel blue x2, slate, near-black slate x2, soot.
  ROOMS[1], ROOMS[1], ROOMS[0], ROOMS[4], ROOMS[4], ROOMS[9],
  // Warm minority: rust-red panel, dark rust, deep red.
  ROOMS[2], ROOMS[8], ROOMS[6],
];

// ---------------------------------------------------------------- boxes

/** One box on the pile: kit 1 = ribs and door ends (a container), 2 = ribs only. */
interface Unit { long: number; wide: number; tall: number; col: Vec3; kit: 0 | 1 | 2; rot: number }

const box = (u: Omit<Unit, 'rot'>, rot = 0): Unit => ({ ...u, rot });

/** A container or a salvaged-panel room, off the pile's own stream. */
const rollUnit = (r: Rng): Unit => {
  if (r.bool(0.62)) {
    return box({
      long: r.bool(0.62) ? 12 : 6, wide: 2.4, tall: BOX_H * r.range(0.98, 1.02),
      // containerPalette() keeps the roll a single draw: r.int(0, 8), nine
      // entries, exactly the round-0 call — the palette's WEIGHTING is what
      // changed this round, not the rng stream's shape.
      col: containerPalette()[r.int(0, 8)], kit: 1,
    });
  }
  return box({
    long: r.range(3.6, 7.4), wide: r.range(2.8, 3.7), tall: r.range(2.45, 3.1),
    col: tint(ROOMS[r.int(0, ROOMS.length - 1)], r.range(0.62, 1.0)), kit: 0,
  });
};

/** Where a top-kit piece (and, round 1, a dressed facade) can stand, in grid
 *  coordinates. `u`/`y0` ride along when the push drew a box: the crown boxes
 *  weatherRoom paints are exactly the top set the kit already collected. */
interface TopSpot { a: number; b: number; turn: number; y: number; u?: Unit; y0?: number }

/** Round-1 dressing context. Faces are near/mid-field work (lod < 2); the one
 *  crown light per lit pile top at night must land in the caller's chunk light
 *  list, the scaffold's convention (`lod < 1`, citymesh.ts pushScaffold). */
interface Dress { lights?: ChunkLight[]; lod: number }

// ---------------------------------------------------------------- placing

/** Grid (a, b) on the chunk's yaw to world xz (fallzone's `onFrame`). */
const at = (c: FallColumn, yaw: number, a: number, b: number): [number, number] => {
  const cs = Math.cos(yaw), ss = Math.sin(yaw);
  return [c.x + a * cs + b * ss, c.z - a * ss + b * cs];
};

/** World (x, z) offset to grid (a, b) on the same yaw (fallzone's `toFrame`). */
const toGrid = (c: FallColumn, yaw: number, x: number, z: number): [number, number] => {
  const cg = Math.cos(yaw), sg = Math.sin(yaw), dx = x - c.x, dz = z - c.z;
  return [dx * cg - dz * sg, dx * sg + dz * cg];
};

/**
 * One box of the pile plus its kit, centred on grid (a, b) with its long side
 * along `yaw + u.rot`, sitting on y0. Returns its top y. Door leaves read as a
 * proud pair on one end; three shallow flats along a 12 m face (one along a
 * 6 m face) stand for the corrugation at this round's distances.
 */
function putUnit(bld: MeshBuilder, c: FallColumn, yaw: number, u: Unit, a: number, b: number, y0: number, doorSign = 1): number {
  const [wx, wz] = at(c, yaw, a, b);
  const yc = y0 + u.tall / 2;
  const rot = yaw + u.rot;
  const cs = Math.cos(rot), ss = Math.sin(rot);
  const opts: MeshOpts = { rotationY: rot };
  const off = (la: number, lb: number): [number, number] => [wx + la * cs + lb * ss, wz - la * ss + lb * cs];
  bld.pushBox([wx, yc, wz], [u.long / 2, u.tall / 2, u.wide / 2], u.col, opts);
  if (u.kit === 0) return y0 + u.tall;
  const ribMax = u.long > 9 ? 3 : 1;
  for (const side of [-1, 1]) {
    for (let i = 0; i < ribMax; i++) {
      const la = (u.long * (i + 1)) / (ribMax + 1) - u.long / 2;
      const [rx, rz] = off(la, side * (u.wide / 2 + 0.032));
      bld.pushBox([rx, yc, rz], [0.26, (u.tall - 0.36) / 2, 0.035], tint(u.col, 0.82), opts);
    }
  }
  if (u.kit === 1) {
    // Round 0 hung the leaves at ±0.565 with a 1.02 half-width; on anything
    // narrower than a panel that pair reaches 1.585 from the centreline —
    // 0.38 OUTSIDE the box's own wide (0.385 turns into a record escape on
    // any box whose across axis is a record axis). Hang them from the face's
    // edges instead: the envelope stays wide/2 for every unit.
    const leafAt = Math.max(0.02, u.wide / 2 - 0.53);
    for (const s of [-leafAt, leafAt]) {
      const [lx, lz] = off(doorSign * (u.long / 2 + 0.032), s);
      bld.pushBox([lx, yc, lz], [0.032, (u.tall - 0.28) / 2, 1.02], tint(u.col, 0.78), opts);
    }
  }
  return y0 + u.tall;
}

// ---------------------------------------------------------------- steel

/**
 * A thin member between two points (braces and brackets). x along the run, y up
 * out of it, z level across — the same basis fallmesh calls spanBasis.
 */
function memberBasis(a: Vec3, b: Vec3): [Vec3, Vec3, Vec3] {
  const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  const ax: Vec3 = [d[0] / l, d[1] / l, d[2] / l];
  const zl = Math.hypot(ax[0], ax[2]) || 1;
  const az: Vec3 = [-ax[2] / zl, 0, ax[0] / zl];
  const ay: Vec3 = [az[1] * ax[2] - az[2] * ax[1], az[2] * ax[0] - az[0] * ax[2], az[0] * ax[1] - az[1] * ax[0]];
  return [ax, ay, az];
}

function member(bld: MeshBuilder, a: Vec3, b: Vec3, halfY: number, halfZ: number, col: Vec3): void {
  const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const half: number = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2;
  pushOrientedBox(bld, mid, ...memberBasis(a, b), [half, halfY, halfZ], col);
}

/**
 * Steel outriggers under a pile's overhang (DESIGN §8: hung on poles... on
 * outriggers, with the bracing visible below): one beam slung under each
 * overhanging side of the shaft, with two braces back down its face. `dir`:
 * 0=+a, 1=-a, 2=+b, 3=-b on the grid frame; `over` the past-the-shaft reach.
 */
function outrigger(bld: MeshBuilder, c: FallColumn, yaw: number, dir: 0 | 1 | 2 | 3, over: number, by: number, r: Rng): void {
  if (over < 0.8) return;
  const onA = dir < 2, sgn = dir % 2 ? -1 : 1;
  const shaft = onA ? c.halfX : c.halfZ;
  const cs = Math.cos(yaw), ss = Math.sin(yaw);
  // A point by (along the run s, across it w) in the chosen direction: grid
  // (sgn*s, w) for the a axis, (w, sgn*s) for the b axis.
  const p = (s: number, w: number): [number, number] => onA
    ? [c.x + sgn * s * cs + w * ss, c.z - sgn * s * ss + w * cs]
    : [c.x + w * cs + sgn * s * ss, c.z - w * ss + sgn * s * cs];
  // Beam: anchored just inside the shaft face, tip flush at the record edge
  // (shaft + over = the registered extent). Round 0 rolled the leg 0.9 m long
  // beyond that and the tip hung 0.45 m past the record on every pier —
  // invisible until the sweep ran per-column.
  const [bx, bz] = p(shaft + over / 2, 0);
  const legLen = over;
  bld.pushBox([bx, by, bz], onA ? [legLen / 2, 0.14, 0.09] : [0.09, 0.14, legLen / 2], OUTRIGGER, { rotationY: yaw });
  for (const t of [0.3, 0.72]) {
    const [a0, b0] = p(shaft + over * t, 0);
    const [a1, b1] = p(shaft - 0.02, 0);
    member(bld, [a0, by - 0.12, b0], [a1, by - 2.4 - r.next() * 1.6, b1], 0.07, 0.07, OUTRIGGER);
  }
}

// ---------------------------------------------------------------- the top kit

/**
 * A box whose long axis sits at world angle `rotW` on the grid frame of chunk
 * yaw `gy` measures on each grid axis: `along * |cos(rotW - gy)|` plus
 * `across * |sin(rotW - gy)|` on a, the swapped pair on b. Anything placed at
 * an arbitrary angle — ring boxes, crater boxes — must be proven against the
 * yawed-rectangle record with these halfs, not against the radial reach a
 * time-aligned ring would have.
 */
const gridHalfs = (rotW: number, gy: number, along: number, across: number): [number, number] => {
  const d = rotW - gy, cs = Math.abs(Math.cos(d)), sn = Math.abs(Math.sin(d));
  return [along * cs + across * sn, along * sn + across * cs];
};

/**
 * The longest a ring box may run. Its centre at radial offset `rr` carries
 * |cos(phi + yaw)| on a and |sin(phi + yaw)| on b (`sC`/`sS`), its tangent run
 * measures long/2 the swapped way, and its across-half is `hW`. Stays 0.25
 * inside the record on both axes; an axis whose run coefficient vanishes puts
 * no bound on the length (perpendicular case).
 */
const ringLongMax = (rX: number, rZ: number, rr: number, sC: number, sS: number, hW: number): number => {
  const a = sS > 1e-4 ? 2 * (rX - 0.25 - sC * (rr + hW)) / sS : Infinity;
  const b = sC > 1e-4 ? 2 * (rZ - 0.25 - sS * (rr + hW)) / sC : Infinity;
  return Math.min(a, b);
};

/**
 * The uneven top's kit: 1-3 antennas, a water tank on legs, one or two white
 * tarps (DESIGN §8), each standing on boxes that finish near the pile top.
 * Anchors are seated inside the pile extent with the piece's own reach, so a
 * tank on a collar's outermost spot or a tarp on a ring cannot loll past the
 * footprint the placement registered.
 */
function topKit(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng, tops: TopSpot[]): void {
  if (tops.length === 0) return;
  const pick = (): TopSpot => tops[r.int(0, tops.length - 1)];
  // Pull an anchor toward the column so the piece's reach stays on the pile.
  const seat = (sp: TopSpot, need: number): [number, number] => [
    clamp(sp.a, -(c.pileHalfX - need), c.pileHalfX - need),
    clamp(sp.b, -(c.pileHalfZ - need), c.pileHalfZ - need),
  ];
  const near = (): TopSpot => {
    const sp = pick();
    const [a0, b0] = seat(sp, 0.45);
    return { ...sp, a: a0, b: b0 };
  };
  for (let k = 0, n = 1 + r.int(0, 2); k < n; k++) {
    const sp = near();
    const hj = 2.2 + r.next() * 2.6;
    const [ax, az] = at(c, yaw, sp.a + r.jitter(0.5), sp.b + r.jitter(0.5));
    const rot = yaw + sp.turn + r.jitter(0.08);
    bld.pushBox([ax, sp.y + hj / 2, az], [0.055, hj / 2, 0.055], OUTRIGGER, { rotationY: rot });
    if (r.bool(0.5)) {
      const [cx, cz] = at(c, yaw, sp.a + r.jitter(0.3), sp.b + r.jitter(0.3));
      bld.pushBox([cx, sp.y + hj * 0.62, cz], [0.5, 0.03, 0.03], OUTRIGGER, { rotationY: rot });
    }
  }
  if (r.bool(0.62)) {
    const sp = pick();
    const leg = 0.95 + r.next() * 0.3, rad = 1.05 + r.next() * 0.4, th = 2.1 + r.next() * 0.6;
    const [sa, sb] = seat(sp, rad + 0.5);
    const [tx, tz] = at(c, yaw, sa, sb);
    bld.pushCylinder([tx, sp.y + leg, tz], [tx, sp.y + leg + th, tz], rad, 9, tint(ROOMS[0], 0.85), { capEnds: true });
    for (const q of [0, 1, 2, 3]) {
      const ang = (q / 4) * Math.PI * 2;
      bld.pushBox([tx + Math.cos(ang) * rad * 0.65, sp.y + leg / 2, tz + Math.sin(ang) * rad * 0.65],
        [0.07, leg / 2, 0.07], OUTRIGGER, { rotationY: ang });
    }
  }
  if (r.bool(0.55)) {
    const sp = pick();
    const w = 3.2 + r.next() * 1.8, d = 2.6 + r.next() * 1.6;
    const [sa, sb] = seat(sp, Math.max(w, d) / 2 + 0.4);
    const [sx, sz] = at(c, yaw, sa, sb);
    const rot = yaw + sp.turn;
    const cs = Math.cos(rot), ss = Math.sin(rot);
    const q = (la: number, lb: number, dy: number): Vec3 => [sx + la * cs + lb * ss, sp.y + dy, sz - la * ss + lb * cs];
    const dip = -(0.2 + r.next() * 0.18);
    const lift = 0.08;
    bld.pushQuad(q(-w / 2, -d / 2, lift), q(w / 2, -d / 2, lift), q(w / 2, d / 2, lift + dip / 2), q(-w / 2, d / 2, lift + dip / 2), TARP, 1, { doubleSided: true });
    if (r.bool(0.5)) {
      const flap = (f: number): number => f * r.range(0.45, 0.85);
      bld.pushQuad(q(-flap(w), d / 2 - 0.3, lift + dip / 2 + 0.05), q(flap(w), d / 2 - 0.3, lift + dip / 2 + 0.05),
        q(flap(w), d / 2 - 0.8, lift + dip + 0.3), q(-flap(w), d / 2 - 0.8, lift + dip + 0.3), tint(TARP, 0.85), 1, { doubleSided: true });
    }
  }
}

// ---------------------------------------------------------------- faces

/**
 * Round 1 (the gap the vision reviewer named): the crown's faces and its lit
 * row. The crown boxes the grammar already collected in `tops` — with the
 * drawn unit and its floor riding along — are dressed with citymesh's
 * `weatherRoom`: panel seams, a grime skirt, soot runs, framed windows, a lit
 * side window, and now and then a balcony or tarp if its roll gives one. About
 * a quarter of the windows are over-painted emissive warm (D28's quarter lit
 * at night) and **every dressed face lights its first window as a bay**, so a
 * crown carries several lit room-fronts at different heights rather than a
 * single point. One small light per lit pile top lands in the chunk's light
 * list at lod < 1, the scaffold's convention; the bay itself is emissive
 * geometry and costs no light bin.
 *
 * What weatherRoom assumes about its input, and what feeding it a pile box
 * needed: it wants a frame closure Q(t, y, d) with t along the face from its
 * left edge, y absolute, and d measured from the room's BACK plane (the outer
 * face plane sits at d = sd, so it is called with front = the box's width),
 * plus the room's own rng so a face's layout never re-rolls with anything
 * else. The pile box maps onto that exactly — Q is the box's back-left-floor
 * corner plus runAxis*t + outAxis*d — so nothing in weatherRoom changed for
 * the village. The only pile-side rule is distance instead of a wall: a face
 * is dressed only where a balcony's or tarp's reach, the furthest thing the
 * rolls can put past it, stays inside the registered pile extent — which keeps
 * round 0's cantilever question closed on faces too. Faces whose panes copy
 * weatherRoom's window-frame constants (0.42/0.74 of the face height) sit
 * behind the frames and re-derive them here; if the scaffold tunes its
 * windows, the pile crown needs the same tune.
 */
const FACE_SALT = 0x1d299d3e;

function dressFaces(bld: MeshBuilder, c: FallColumn, yaw: number, tops: TopSpot[], dress: Dress): void {
  if (dress.lod >= 2 || tops.length === 0) return;
  const cands = tops.filter((t): t is TopSpot & { u: Unit; y0: number } => t.u !== undefined && t.y0 !== undefined);
  if (cands.length === 0) return;
  // Selection (how many faces, crown-first) rolls on the pile's dress stream;
  // each face's own layout rolls on a stream keyed to the face itself, so a
  // face never re-rolls because of its neighbours. Round 3e (PART 9) chooses
  // WHICH long face of the box is dressed by line of sight — the one looking
  // out of the pile — and keeps the key unchanged, so the layout itself does
  // not re-roll.
  const sel = makeRng((c.seed ^ FACE_SALT) >>> 0);
  const want = Math.min(cands.length, 3 + sel.int(0, 3)); // 3-5 dressed faces
  // Round 3i (PART 14, "the pick"): choose which box of a crown carries the row
  // by RADIAL line of sight, the way 3e chose the face by line of sight. There is
  // no camera in the generator, so "line of sight" here means radial: prefer the
  // box whose dressed long face points away from the pile's axis (a*sin rot +
  // b*cos rot large) and which is not standing in the shadow of a box above or
  // beside it (a higher box with at least as much radial reach). The old
  // |a|/|b| tie-break preferred the INNER boxes, which is exactly what put the
  // row on a flank the camera sees edge-on (id108) or on a small box turned away
  // (id124). No new rng draw: the order is a pure function of the already-rolled
  // tops, so the seed and the dressing rolls are untouched.
  const radialReach = (t: (typeof cands)[number]): number => Math.hypot(t.a, t.b);
  const outwardness = (t: (typeof cands)[number]): number => t.a * Math.sin(t.u.rot) + t.b * Math.cos(t.u.rot);
  const shadowed = (t: (typeof cands)[number]): boolean =>
    cands.some((o) => o !== t && o.y > t.y + 0.1 && radialReach(o) >= radialReach(t) - 0.5);
  // Composite score: y (crown height) dominates, but outwardness (radial line of
  // sight) can override differences smaller than ~2 m, so an outward-facing box
  // slightly below an inward-facing one wins the slot instead of the inner flank.
  // Primary: radial reach (outer boxes first) so the row lands on a box the
  // camera's radial line of sight can actually see, rather than on an inner
  // flank. y is retained as a secondary key so crown height still matters among
  // boxes of similar reach.
  cands.sort((p, q) =>
    outwardness(q) - outwardness(p) ||
    (shadowed(p) ? 1 : 0) - (shadowed(q) ? 1 : 0) ||
    radialReach(q) - radialReach(p) ||
    q.y - p.y ||
    Math.abs(q.a) - Math.abs(p.a) ||
    Math.abs(q.b) - Math.abs(p.b));

  const cs = Math.cos(yaw), ss = Math.sin(yaw);
  let dressed = 0, lightDone = false;
  for (const t of cands) {
    if (dressed >= want) break;
    const u = t.u, y0 = t.y0;
    // The run axis in grid coordinates is (cos rot, -sin rot), the outward
    // normal (sin rot, cos rot): every point the face's run plus a balcony's
    // reach can cover must sit inside the record the placement locked.
    // Round 3e chose WHICH long face by line of sight. Round 3g (this round)
    // draws the row and the face dressing on BOTH long faces of the box, not
    // only the outward one, so a camera that meets the inward face no longer
    // sees an undressed box (PART 11 (c)). The face KEY is still keyed to the
    // box's a, b and level (no side in it), so the two faces draw from the
    // same stream and do not re-roll each other's seams, grime, skirt or bays.
    const cp = Math.cos(u.rot), sp = Math.sin(u.rot), runHalf = u.long / 2, reach = u.wide + 1.5;
    const outward = t.a * sp + t.b * cp >= 0 ? 1 : -1;
    // The dressing (a balcony is the furthest reach) has to stay inside the
    // record on the side it is drawn. Each long face is tried independently;
    // a face is drawn only where its balcony's reach stays inside the record,
    // and the box is skipped only when neither long face fits.
    const fitsRecord = (sd: number): boolean => {
      for (const tt of [0, u.long]) {
        const ga = t.a - runHalf * cp + tt * cp + sd * reach * sp;
        const gb = t.b + runHalf * sp - tt * sp + sd * reach * cp;
        if (Math.abs(ga) > c.pileHalfX - 0.3 || Math.abs(gb) > c.pileHalfZ - 0.3) return false;
      }
      return true;
    };
    const orderedSides: number[] = [outward, -outward].filter((sd, i, arr) => arr.indexOf(sd) === i && fitsRecord(sd));
    if (orderedSides.length === 0) continue; // an undressed box where no balcony fits either face
    // The box's back-left-floor corner, run axis and outward normal, as
    // weatherRoom's frame. `side` selects which long face; Q is rebuilt per
    // side below.
    const key = (c.seed ^ FACE_SALT
      ^ ((Math.round(t.a * 8) & 0xffff) * 7919 | 1)
      ^ ((Math.round(t.b * 8) & 0xffff) * 104729 | 3)
      ^ ((Math.round((y0 - c.pileBase) * 4) & 0xffff) * 1301 | 5)) >>> 0;
    // Layout (wins, bay count, anchor) is computed ONCE from the box key, so
    // both long faces share it and neither re-rolls the other.
    const w0 = makeRng(key);
    const wins: number[] = [];
    for (let wi = 0, nw = u.long > 9 ? 1 + w0.int(0, 1) : w0.int(0, 1); wi < nw; wi++) {
      wins.push(clamp(u.long * (0.3 + 0.4 * wi) + w0.jitter(0.6), 1.1, u.long - 1.1));
    }
    const litRoll = wins.map(() => w0.bool(0.25));
    void litRoll;
    const ya = y0 + u.tall * 0.34, yb = y0 + u.tall * 0.80;
    const bayW = clamp(u.long * 0.4, 1.1, 2.4);
    const gap = 0.45;
    const fits = Math.max(1, Math.floor((u.long - 0.6 + gap) / (bayW + gap)));
    const n = Math.min(fits, 2 + ((key >>> 5) & 1));
    const runW = n * bayW + (n - 1) * gap;
    const anchor = wins.length ? wins[0] : u.long / 2;
    const mid = clamp(anchor, runW / 2 + 0.3, u.long - runW / 2 - 0.3);
    // Replay helper: a fresh rng from the same key, advanced past the layout
    // rolls, so each face's weatherRoom starts at the same post-layout state.
    const replayW = (): Rng => {
      const rw = makeRng(key);
      const nw = u.long > 9 ? 1 + rw.int(0, 1) : rw.int(0, 1);
      for (let wi = 0; wi < nw; wi++) clamp(u.long * (0.3 + 0.4 * wi) + rw.jitter(0.6), 1.1, u.long - 1.1);
      for (let wi = 0; wi < nw; wi++) rw.bool(0.25);
      return rw;
    };
    for (const side of orderedSides) {
      const oA = t.a - runHalf * cp - side * (u.wide / 2) * sp;
      const oB = t.b + runHalf * sp - side * (u.wide / 2) * cp;
      const ox = c.x + oA * cs + oB * ss, oz = c.z - oA * ss + oB * cs;
      const ux = Math.cos(yaw + u.rot), uz = -Math.sin(yaw + u.rot);
      const Q = (tt: number, y: number, d: number): Vec3 => [ox + ux * tt - side * uz * d, y, oz + uz * tt + side * ux * d];
      weatherRoom(bld, Q, u.long / 2, y0, u.wide, u.long, u.tall, u.wide, u.col, wins, OUTRIGGER, replayW());
      // Over-paint the lit row on this face: a contiguous row of 2-3 bays at
      // one height, identical layout on both long faces (same n, mid, wins).
      for (let k = 0; k < n; k++) {
        const t0 = mid - runW / 2 + k * (bayW + gap);
        const t1 = t0 + bayW;
        bld.pushQuad(Q(t0, ya, u.wide + 0.03), Q(t1, ya, u.wide + 0.03),
          Q(t1, yb, u.wide + 0.03), Q(t0, yb, u.wide + 0.03),
          LIT_WARM, 1, { emissive: 3.0, doubleSided: true });
        const fr = tint(u.col, 0.35), fd = u.wide + 0.038;
        bld.pushQuad(Q(t0 - 0.07, ya - 0.07, fd), Q(t0, ya - 0.07, fd), Q(t0, yb + 0.07, fd), Q(t0 - 0.07, yb + 0.07, fd), fr, 1, { doubleSided: true });
        bld.pushQuad(Q(t1, ya - 0.07, fd), Q(t1 + 0.07, ya - 0.07, fd), Q(t1 + 0.07, yb + 0.07, fd), Q(t1, yb + 0.07, fd), fr, 1, { doubleSided: true });
        bld.pushQuad(Q(t0 - 0.07, yb, fd), Q(t1 + 0.07, yb, fd), Q(t1 + 0.07, yb + 0.07, fd), Q(t0 - 0.07, yb + 0.07, fd), fr, 1, { doubleSided: true });
        bld.pushQuad(Q(t0 - 0.07, ya - 0.07, fd), Q(t1 + 0.07, ya - 0.07, fd), Q(t1 + 0.07, ya, fd), Q(t0 - 0.07, ya, fd), fr, 1, { doubleSided: true });
        for (const s of [1 / 3, 2 / 3]) {
          const tm = t0 + (t1 - t0) * s;
          bld.pushQuad(Q(tm - 0.035, ya, fd), Q(tm + 0.035, ya, fd), Q(tm + 0.035, yb, fd), Q(tm - 0.035, yb, fd), fr, 1, { doubleSided: true });
        }
      }
      if (!lightDone && dress.lights && dress.lod < 1) {
        dress.lights.push({ pos: Q(mid, y0 + u.tall * 0.6, u.wide + 0.8), radius: 10, color: [1.0, 0.68, 0.34], intensity: 1.4 });
        lightDone = true;
      }
    }
    dressed++;
  }
}

// ---------------------------------------------------------------- the piles

/**
 * The pile on a rectangular plan — deck piers (wide, overhanging, 1.3-2x the
 * shaft) and stripped cores (narrower, taller, the stair head-house through
 * it). Layers turn 90 deg each; boxes run back to back along the layer axis
 * with gaps and skipped top slots, so the crown steps instead of extruding.
 * The bottom layers hold the footprint the placement set, on outriggers; 1-2
 * upper boxes cantilever further out. `narrow` also drops the pile's width
 * faster so cores climb in a column.
 */
function pileRect(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng, narrow: boolean, dress: Dress): void {
  const n = Math.max(2, Math.floor((c.pileTop - c.pileBase) / BOX_H));
  const tops: TopSpot[] = [];
  const headHalf: [number, number] = narrow ? [r.range(1.4, 1.7), r.range(1.3, 1.6)] : [0, 0];
  const headLo = c.top - 0.5, headHi = c.pileTop + (narrow ? 0.9 : 0);
  for (let k = 0; k < n; k++) {
    const t = k / Math.max(1, n - 1);
    const turn = k % 2 ? Math.PI / 2 : 0;
    const shrink = 1 - (narrow ? 0.42 : 0.3) * t;
    // The layer's outer faces stop 0.25 m inside the record: 1.04x shrink at
    // t=0 could put the layer face past the registered extent, and nothing in
    // the village may stand outside it (the door flats add 0.032 more).
    const fx = Math.min(c.pileHalfX - 0.25, c.pileHalfX * shrink * (0.94 + r.next() * 0.1));
    const fz = Math.min(c.pileHalfZ - 0.25, c.pileHalfZ * shrink * (0.94 + r.next() * 0.1));
    const along = turn ? fz : fx, across = turn ? fx : fz;
    // The stair head-house: an interval on the layer's run axis the boxes avoid.
    const head = narrow ? (turn ? headHalf[1] : headHalf[0]) : 0;
    const rows = across > 6.4 && (t < 0.45 ? r.bool(0.55) : r.bool(0.2)) ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      const rc = rows === 1 ? r.jitter(across * 0.12) : (row - (rows - 1) / 2) * (across / rows) + r.jitter(0.4);
      const margin0 = r.range(0.35, along * 0.14), margin1 = r.range(0.35, along * 0.14);
      const headMid = head > 0 && Math.abs(rc) > (turn ? headHalf[0] : headHalf[1]) + 1.0 ? 0 : head;
      const spans: [number, number][] = headMid > 0.01 && headMid < along - margin1 - 0.4
        ? [[-along + margin0, -headMid], [headMid, along - margin1]]
        : [[-along + margin0, along - margin1]];
      for (const [s0, s1] of spans) {
        let cur = s0;
        for (;;) {
          if (s1 - cur < 3.0) break;
          if (k === n - 1 && r.bool(0.35)) { cur += 2.2 + r.next() * 1.6; continue; }  // stepped top
          if (r.bool(0.12)) { cur += r.range(0.8, 2.2); continue; }                   // gaps, not courses
          const u = rollUnit(r);
          // Break at the span, not past it: round 0 allowed a +0.9 slack and a
          // full row could hang 0.55 m past the layer face. The cantilevers
          // carry the protrusion reads; the courses stay inside the record.
          if (cur + u.long > s1) break;
          const mid = cur + u.long / 2;
          const a = turn ? rc : mid, b = turn ? mid : rc;
          const y0 = c.pileBase + k * BOX_H;
          // Honour the docstring's "layers turn 90 deg": round 0 swapped the
          // a/b coords but never rotated the box, so an odd layer's 12 m
          // container still spanned the ACROSS axis from an rc centre and
          // reached pileHalf + 0.4 (pier 106). The drawn rot and the recorded
          // one are the same unit now.
          const top = putUnit(bld, c, yaw, { ...u, rot: turn }, a, b, y0, r.bool() ? 1 : -1);
          if (top > c.pileTop - BOX_H - 0.35) tops.push({ a, b, turn, y: top, u: { ...u, rot: turn }, y0 });
          cur += u.long;
        }
      }
    }
  }
  if (narrow) {
    const hy = (headLo + headHi) / 2;
    bld.pushBox([c.x, hy, c.z], [headHalf[0], (headHi - headLo) / 2, headHalf[1]], tint(ROOMS[1], 0.8), { rotationY: yaw });
    bld.pushBox([c.x, headHi + 0.34, c.z], [headHalf[0] * 0.56, 0.34, headHalf[1] * 0.56], tint(ROOMS[9], 1), { rotationY: yaw });
    tops.push({ a: r.jitter(0.4), b: r.jitter(0.4), turn: 0, y: headHi + 0.68 });
  }
  for (const dir of [0, 1, 2, 3] as const) {
    const over = (dir < 2 ? c.pileHalfX - c.halfX : c.pileHalfZ - c.halfZ) * (narrow ? 0.7 : 1);
    outrigger(bld, c, yaw, dir, over, c.pileBase + 0.05, r);
  }
  // 1-2 boxes cantilevered out over the layers below (DESIGN §8: "a few boxes
  // cantilevered further out"), each with a brace under it so the cantilever
  // reads as steel, not as debris in the air — the review named that read in
  // pose 19. Round 0 rolled the box's outer face up to 3.6 m PAST the extent
  // the placement registered (round-0 open question 2), right where deck
  // fragments and bridges anchor; now the outer face sits 0.3 m inside the
  // record on the pushed axis, and the whole box stays inside it on the other
  // axis too. A box whose proportions cannot fit is rolled and dropped.
  if (c.pileHalfX > c.halfX + 3.2) {
    for (let k = 0, nc = 1 + r.int(0, 1); k < nc; k++) {
      const u = rollUnit(r);
      const dir = r.int(0, 3) as 0 | 1 | 2 | 3;
      const onA = dir < 2, sgn2 = dir % 2 ? -1 : 1;
      // The box's half on the PUSHED axis and on the other one. The first
      // cut of this clamp used "hA wherever the push goes", and a 12 m
      // container pushed along b still ran its long axis along a, reaching
      // ~11.5 into a 6.9 record — the tightened sweep caught it (pier 39).
      const hLong = u.rot ? u.wide / 2 : u.long / 2, hWide = u.rot ? u.long / 2 : u.wide / 2;
      const hPush = onA ? hLong : hWide, hSide = onA ? hWide : hLong;
      const extPush = onA ? c.pileHalfX : c.pileHalfZ;
      const extSide = onA ? c.pileHalfZ : c.pileHalfX;
      if (hPush > extPush - 0.5 || hSide > extSide - 0.5) continue; // it cannot sit inside the record
      const pushed = sgn2 * (extPush - 0.3 - hPush);
      const side = clamp(r.jitter(2.0), -(extSide - hSide - 0.2), extSide - hSide - 0.2);
      const a = onA ? pushed : side, b = onA ? side : pushed;
      const y0 = c.pileBase + (1 + r.int(0, Math.max(0, n - 2))) * BOX_H;
      putUnit(bld, c, yaw, { ...u, kit: 0 }, a, b, y0);
      // A brace from under the box's inner edge, down and inward into the
      // mass. The pair earlier fed `pushed` where the across coordinate
      // belongs: for a b-push the brace sat at (pushed, inner) and its
      // midpoint reached pileHalfX + 0.3 with a 0.07 section (pier 21's
      // 11.59/11.73 band), while the box itself never left the record.
      const inner = pushed - sgn2 * (hPush - 0.2), to = pushed - sgn2 * (hPush + 2.8);
      const PA = (onA ? [inner, side] : [side, inner]) as [number, number];
      const PB = (onA ? [to, side] : [side, to]) as [number, number];
      const [bx0, bz0] = at(c, yaw, PA[0], PA[1]);
      const [bx1, bz1] = at(c, yaw, PB[0], PB[1]);
      member(bld, [bx0, y0, bz0], [bx1, y0 - BOX_H + 0.05, bz1], 0.07, 0.07, OUTRIGGER);
    }
  }
  topKit(bld, c, yaw, r, tops);
  // Round 1: the crown's faces and its lit row (docs/FALL_VILLAGE_ROUND1.md).
  dressFaces(bld, c, yaw, tops, dress);
}

/** A linear village along a silo battery's gallery: a continuous run along the
 *  cylinder caps, shack rows across it, a head-house canopy at an end. */
function pileSilo(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng, dress: Dress): void {
  const rad = c.halfX / c.count;
  const tops: TopSpot[] = [];
  const rows = Math.max(1, Math.round((c.pileTop - c.pileBase) / BOX_H));
  for (let k = 0; k < rows; k++) {
    const y0 = c.pileBase + k * BOX_H;
    if (k % 2 === 0) {
      const edge = c.halfX - rad * 0.8;
      const m0 = r.range(rad * 0.4, edge * 0.16), m1 = r.range(rad * 0.4, edge * 0.16);
      let cur = -edge + m0;
      const s1 = edge - m1;
      while (s1 - cur > 4.4) {
        if (r.bool(0.16)) { cur += r.range(0.8, 2); continue; }
        const u = rollUnit(r);
        if (cur + u.long > s1) break;
        const aMid = cur + u.long / 2;
        // The gallery's crosswise reach is the battery's z half: a wide box at
        // an edge jitter could hang past it.
        const bMid = clamp(r.jitter(rad * 0.22), -(c.pileHalfZ - u.wide / 2 - 0.2), c.pileHalfZ - u.wide / 2 - 0.2);
        const top = putUnit(bld, c, yaw, u, aMid, bMid, y0);
        tops.push({ a: aMid, b: bMid, turn: 0, y: top, u, y0 });
        cur += u.long;
      }
    } else {
      // Crosswise shacks: a box across the caps, snapped onto a cylinder
      // centre. Clamped to the gallery's depth — halfZ is the cylinder radius
      // plus 25%, so a 12 m container turned across would sit metres past the
      // extent the placement registered.
      const cross = (u: Unit, a: number): void => {
        const long = Math.min(u.long, c.pileHalfZ * 2 - 2.2);
        const bMax = c.pileHalfZ - long / 2 - 1.1;
        const b = clamp(r.jitter(rad * 0.5), -bMax, bMax);
        // Rotated across, the box's across-half is what the record's a axis
        // sees; an edge cap jitted outward could sit up to ~1 m past the
        // record (silo 21/30/55/83/98 maxA). Slide the centre back in and
        // give up when the record cannot hold the wide at all.
        const aMax = c.pileHalfX - 0.1 - u.wide / 2;
        if (aMax < 0) return;
        const a2 = clamp(a, -aMax, aMax);
        const drawn = { ...u, long, rot: Math.PI / 2 };
        const top = putUnit(bld, c, yaw, drawn, a2, b, y0);
        tops.push({ a: a2, b, turn: Math.PI / 2, y: top, u: drawn, y0 });
      };
      const cy = r.int(0, c.count - 1);
      const centreA = (2 * cy - (c.count - 1)) * rad;
      cross(rollUnit(r), centreA + r.jitter(rad * 0.3));
      if (r.bool(0.5)) cross(rollUnit(r), centreA + r.jitter(rad * 1.4));
    }
  }
  if (r.bool(0.6)) {
    const sgn = r.bool() ? 1 : -1;
    const u = rollUnit(r);
    // The end canopy is the battery's head-house. Round 0 seated it at the
    // caps' interior edge and let a 12 m run hang ~3 m past the registered
    // extent (the sweep flagged silo 21/30/83/98); the seat now caps the run,
    // and a record too small to hold it drops the canopy.
    const seat = c.pileHalfX - 0.1 - u.long / 2;
    if (seat >= 0.4) {
      putUnit(bld, c, yaw, { ...u, kit: 2 }, sgn * Math.min(c.halfX - Math.min(rad, u.long / 2) - 0.1, seat), 0, c.pileBase, 1);
    }
  }
  topKit(bld, c, yaw, r, tops.filter((sp) => sp.y > c.pileBase + BOX_H * 1.5));
  dressFaces(bld, c, yaw, tops, dress);
}

/** A ring of boxes on a stack's collar platform: a plank deck on brackets, a
 *  broken ring of boxes around, the stack's top bare for its turbine (round 2). */
function pileStack(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng, dress: Dress): void {
  const rows = Math.max(1, Math.round((c.pileTop - c.pileBase) / BOX_H));
  const rOut = c.pileHalfX;
  const rIn = Math.max(Math.min(rOut - 1.9, c.halfX + 0.7), c.halfX + 0.25);
  const rMid = (rOut + rIn) / 2, depth = rOut - rIn;
  const deckY = c.pileTop - rows * BOX_H - 0.2;
  const ns = Math.max(7, Math.round((2 * Math.PI * rMid) / 4.6));
  const off0 = r.next() * Math.PI * 2;
  for (let i = 0; i < ns; i++) {
    if (r.bool(0.16)) continue;
    const phi = off0 + ((i + 0.5) / ns) * Math.PI * 2;
    // A plank at a diagonal ring angle reaches sqrt(rMid^2 + (len/2)^2) along
    // a grid axis — up to 0.45 m past rOut on a small stack (stack 17, dY band
    // at deckY): restate it on the yawed-rectangle record and cap each plank.
    const sC = Math.abs(Math.cos(phi + yaw)), sS = Math.abs(Math.sin(phi + yaw));
    const radial = rMid + depth / 2;
    const len = Math.min(
      (2 * Math.PI * rMid) / ns + 0.55,
      sS > 1e-4 ? 2 * Math.max(0, rOut - 0.05 - sC * radial) / sS : Infinity,
      sC > 1e-4 ? 2 * Math.max(0, rOut - 0.05 - sS * radial) / sC : Infinity,
    );
    if (len < 1.6) continue; // the collar gap shows here; keep the line honest
    bld.pushBox([c.x + Math.cos(phi) * rMid, deckY + 0.19, c.z + Math.sin(phi) * rMid],
      [len / 2, 0.19, depth / 2], tint(ROOMS[4], 0.8), { rotationY: -phi - Math.PI / 2 });
  }
  for (let i = 0; i < 5; i++) {
    const phi = off0 + (i / 5) * Math.PI * 2 + r.jitter(0.2);
    const rr = (c.halfX + rIn) / 2;
    bld.pushBox([c.x + Math.cos(phi) * rr, deckY - 0.02, c.z + Math.sin(phi) * rr],
      [(rIn - c.halfX) / 2 + 0.4, 0.08, 0.07], OUTRIGGER, { rotationY: -phi });
  }
  const tops: TopSpot[] = [];
  const spots = 4 + r.int(0, 3);
  for (let i = 0; i < spots; i++) {
    if (r.bool(0.3)) continue;
    const phi = off0 + ((i + 0.5) / spots) * Math.PI * 2 + r.jitter(0.25);
    const rr0 = rMid + r.jitter(0.8);
    const u = rollUnit(r);
    // The collar is a thin ring (depth rOut - rIn <= 1.9 m), so every box runs
    // TANGENT to it and short enough to keep its outer face inside rOut.
    // Round 0 rolled 65 % of these radial, and a radial 12 m container hung
    // ~5 m past the registered extent on both axes — the round-0 sweep's
    // union gate masked it; the tightened sweep caught it this round.
    const turnW = -phi - Math.PI / 2;
    const sC = Math.abs(Math.cos(phi + yaw)), sS = Math.abs(Math.sin(phi + yaw));
    const radHalf = Math.max(u.wide, 3.7) / 2; // conservative: the second layer's wide rolls after
    const rr = Math.min(rr0, rOut - radHalf - 0.05);
    // Tangent run: the box must still fit the yawed-rectangle record on both
    // grid axes — a tangent box at a diagonal ring angle reaches half its
    // length along a grid axis (stack 40: dA up to 4.2 before this cap).
    const long = Math.min(u.long, ringLongMax(c.pileHalfX, c.pileHalfZ, rr, sC, sS, u.wide / 2));
    if (long < 1.2) continue; // the spot cannot hold this box inside the record
    const [wx, wz] = [c.x + Math.cos(phi) * rr, c.z + Math.sin(phi) * rr];
    const [a, b] = toGrid(c, yaw, wx, wz);
    const yFloor = deckY + 0.19;
    let yBest = putUnit(bld, c, yaw, { ...u, long, rot: turnW - yaw }, a, b, yFloor);
    let uBest = { ...u, long }, y0Best = yFloor;
    if (rows >= 2 && r.bool(0.45)) {
      const u2 = rollUnit(r);
      const long2 = Math.min(u2.long, long);
      const [hA2, hB2] = gridHalfs(turnW, yaw, long2 / 2, u2.wide / 2);
      // The jittered centre needs room for the second box's own halfs: a
      // negative bound means the clamp range inverts and the box pokes out —
      // roll and drop it instead (round 1 drew it unbounded, stack-class dA).
      const axB = c.pileHalfX - 0.1 - hA2, bzB = c.pileHalfZ - 0.1 - hB2;
      if (axB < 0 || bzB < 0) continue;
      const a2 = clamp(a + r.jitter(0.4), -axB, axB);
      const b2 = clamp(b + r.jitter(0.4), -bzB, bzB);
      y0Best = yBest;
      yBest = Math.max(yBest, putUnit(bld, c, yaw, { ...u2, long: long2, rot: turnW - yaw }, a2, b2, yBest));
      uBest = { ...u2, long: long2 };
    }
    tops.push({ a, b, turn: turnW - yaw, y: yBest, u: uBest, y0: y0Best });
  }
  topKit(bld, c, yaw, r, tops);
  dressFaces(bld, c, yaw, tops, dress);
}

/** Boxes slung inside a lattice cage: one big unit per level at odd offsets,
 *  an X of bracing on one face taking the read. */
function pileLattice(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng, dress: Dress): void {
  const n = Math.max(2, Math.round((c.pileTop - c.pileBase) / BOX_H));
  const inner = Math.max(c.pileHalfX - 0.6, 3.2);
  const tops: TopSpot[] = [];
  for (let k = 0; k < n; k++) {
    const u = rollUnit(r);
    const long = Math.min(u.long, inner * 2 - 1.0);
    const drawn = { ...u, long };
    const y0 = c.pileBase + k * BOX_H;
    // Cage offsets stop inside the record: a slung box's outer face is its
    // centre plus its own long/wide half, not the cage ring the jitter was
    // scaled from — round 0 let it hang ~1 m past pileHalfX.
    const aAmp = Math.min(inner * 0.16, c.pileHalfX - 0.2 - long / 2);
    const bAmp = Math.min(inner * 0.16, c.pileHalfZ - 0.2 - u.wide / 2);
    const aMid = r.jitter(Math.max(0, aAmp)), bMid = r.jitter(Math.max(0, bAmp));
    const top = putUnit(bld, c, yaw, drawn, aMid, bMid, y0);
    if (k === n - 1) tops.push({ a: aMid, b: bMid, turn: (k % 2) * Math.PI / 2, y: top, u: drawn, y0 });
  }
  const legAt: [number, number][] = [[0, 1], [0, 2], [2, 3], [1, 3]];
  const corner = (i: number, dy: number): Vec3 => {
    // Grid-aligned legs: the shaft's own tubes (fallmesh pushColumn) stand at
    // the grid frame's quadrants. Round 0 placed these at the WORLD axes, so
    // the braces missed the legs by the yaw mixing (up to half*sqrt(2) on the
    // diagonal) and the tightened sweep's diamond read flagged the whole cage.
    const [u, w] = [[1, 1], [1, -1], [-1, 1], [-1, -1]][i] as [number, number];
    const [gx, gz] = at(c, yaw, u * c.halfX, w * c.halfZ);
    return [gx, c.pileBase - dy, gz];
  };
  const [i0, i1] = legAt[r.int(0, 3)];
  member(bld, corner(i0, 2.8), corner(i1, 0.15), 0.08, 0.08, OUTRIGGER);
  member(bld, corner(i1, 2.8), corner(i0, 0.15), 0.08, 0.08, OUTRIGGER);
  topKit(bld, c, yaw, r, tops);
  dressFaces(bld, c, yaw, tops, dress);
}

/** A terraced crater village inside a spire stump: rings of boxes step inward
 *  as they climb the broken floors, widest down at the foot. */
function pileSpire(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng, dress: Dress): void {
  const R = c.halfX;
  const L = 3 + (r.bool(0.5) ? 1 : 0) + (r.bool(0.35) ? 1 : 0);
  const tops: TopSpot[] = [];
  for (let j = 0; j < L; j++) {
    const yFloor = c.pileBase + ((j + 0.3) / L) * (c.pileTop - c.pileBase);
    const rj = Math.max(4.2, Math.min(R * (0.8 - 0.55 * (j / Math.max(1, L - 1))), R - 7));
    const ns = Math.max(4, Math.min(12, Math.round((2 * Math.PI * rj) / 8)));
    const off0 = r.next() * Math.PI * 2;
    for (let i = 0; i < ns; i++) {
      if (r.bool(j === 0 ? 0.3 : 0.5)) continue;
      const phi = off0 + (i / ns) * Math.PI * 2 + r.jitter(0.08);
      const u = rollUnit(r);
      const rr = Math.max(2.6, Math.min(rj, R - 3.2 - u.wide / 2));
      // The crater's boxes sit at arbitrary ring angles on a yawed-rectangle
      // record: cap the run by its grid-frame projection (stack's lesson).
      const long = Math.min(u.long, ringLongMax(c.pileHalfX, c.pileHalfZ, rr,
        Math.abs(Math.cos(phi + yaw)), Math.abs(Math.sin(phi + yaw)), u.wide / 2));
      if (long < 1.2) continue;
      const turnW = -phi - Math.PI / 2;
      const [a, b] = toGrid(c, yaw, c.x + Math.cos(phi) * rr, c.z + Math.sin(phi) * rr);
      const drawn = { ...u, long, rot: turnW - yaw };
      putUnit(bld, c, yaw, drawn, a, b, yFloor);
      if (j === L - 1 && i % 3 === 0) tops.push({ a, b, turn: turnW - yaw, y: yFloor + u.tall, u: drawn, y0: yFloor });
    }
  }
  topKit(bld, c, yaw, r, tops);
  dressFaces(bld, c, yaw, tops, dress);
}

// ---------------------------------------------------------------- far form

/**
 * lod >= 2: the pile as a few merged blocks (fallmesh's `lod < 2` convention).
 * Silhouette over detail: the layered mass and, per kind, the one thing that
 * kind reads by at mid distance — the head-house, the collar ring, the crater.
 */
function mergedBlocks(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng): void {
  const colA = tint(ROOMS[4], 0.9), colB = tint(ROOMS[9], 1);
  const blk = r.bool() ? colA : colB;
  const band = c.pileTop - c.pileBase;
  const geo = { rotationY: yaw };
  const swap = (hx: number, hz: number, t: number): [number, number] => (t ? [hz, hx] : [hx, hz]);
  const stackBox = (fracH: number, fracX: number, fracZ: number, dy: number, turn: number, col: Vec3): void => {
    const [hx, hz] = swap(c.pileHalfX * fracX, c.pileHalfZ * fracZ, turn);
    const rot = { rotationY: yaw + (turn ? Math.PI / 2 : 0) };
    bld.pushBox([c.x, c.pileBase + band * dy + band * fracH / 2, c.z], [hx, band * fracH / 2, hz], col, rot);
  };
  switch (c.kind) {
    case 'pier': {
      stackBox(0.42, 0.94, 0.94, 0, 0, blk);
      stackBox(0.32, 0.78, 0.74, 0.42, 1, r.bool() ? colA : colB);
      stackBox(0.26, 0.55, 0.55, 0.74, 0, blk);
      break;
    }
    case 'core': {
      stackBox(0.42, 0.94, 0.94, 0, 0, blk);
      stackBox(0.36, 0.74, 0.74, 0.42, 1, blk);
      stackBox(0.22, 0.57, 0.57, 0.78, 0, blk);
      const [hx, hz] = [c.halfX * 0.55, c.halfZ * 0.55];
      bld.pushBox([c.x, (c.top - 1 + c.pileTop + 0.8) / 2, c.z], [hx, (c.pileTop + 0.8 - (c.top - 1)) / 2, hz], tint(ROOMS[1], 0.8), geo);
      break;
    }
    case 'silo': {
      const rad = c.halfX / c.count;
      bld.pushBox([c.x, c.pileBase + band * 0.3, c.z], [c.halfX * 0.95, band * 0.3, c.halfZ * 1.05], blk, geo);
      for (let k = 0; k < c.count; k += 2) {
        const off = (2 * k - (c.count - 1)) * rad;
        bld.pushBox([c.x + off * Math.cos(yaw), c.pileBase + band * 0.68, c.z - off * Math.sin(yaw)],
          [rad * 0.55, band * 0.32, rad * 0.55], r.bool() ? colA : colB, geo);
      }
      break;
    }
    case 'stack': {
      const mid = (c.pileHalfX + c.halfX) / 2;
      for (let i = 0; i < 4; i++) {
        const phi = ((i + 0.5) / 4) * Math.PI * 2;
        bld.pushBox([c.x + Math.cos(phi) * mid, c.pileBase + band / 2, c.z + Math.sin(phi) * mid],
          [Math.PI * mid / 4, band / 2, (c.pileHalfX - c.halfX) / 2], blk, { rotationY: -phi - Math.PI / 2 });
      }
      break;
    }
    case 'lattice': {
      bld.pushBox([c.x, c.pileBase + band / 2, c.z], [c.pileHalfX * 0.85, band / 2, c.pileHalfZ * 0.85], blk, geo);
      break;
    }
    case 'spire': {
      const R = c.halfX;
      const inner = R * 0.66;
      bld.pushCylinder([c.x, c.pileBase + 0.5, c.z], [c.x, c.pileBase + band * 0.52, c.z], Math.max(R * 0.82 - 2, inner + 3), 9, blk, { capEnds: true });
      bld.pushCylinder([c.x, c.pileBase + band * 0.52, c.z], [c.x, c.pileTop - 0.5, c.z], inner, 9, blk, { capEnds: true });
      break;
    }
  }
  // D32's far half: "far, a few merged blocks with lit windows" — the mid
  // band's stratum of warm points must survive the merge. Round 3a: a ROW of
  // lit bays on two heights of the mass, not two-to-four small panes: at 300 m
  // a 2 m bay is ~10 px and a 12 m row ~58 px, and at 1400 m the row still
  // breaks into lit blocks where a 0.6 m pane is 0.6 px. Emissive geometry, no
  // registered lights — a far pool burns the light budget for something a far
  // camera cannot catch, and the panes carry the read.
  if (r.bool(0.85)) {
    const csy = Math.cos(yaw), ssy = Math.sin(yaw);
    const nP = 2 + r.int(0, 2);
    // One row = one face plane (aP) at one height, walked along the grid's b
    // axis. `aP` MUST be the face of the block the row sits on: the round-1
    // panes used 0.55 of the pile's half-extent at every height, but the merged
    // stack's faces are at 0.94, 0.78 (turned, so the b axis) and 0.55 of it —
    // so on the wide blocks the panes were buried inside the mass and never
    // showed. Measured by src/render/__probe_litrow.ts.
    const paneRow = (aP: number, bSpan: number, yLo: number): void => {
      for (let j = 0; j < nP; j++) {
        const tb = nP === 1 ? r.jitter(bSpan * 0.3) : (j / (nP - 1) - 0.5) * 2 * bSpan + r.jitter(0.15);
        const hw = r.range(0.85, 1.45), hh = r.range(0.95, 1.45);
        for (const sgn of [-1, 1]) {
          // The plane a = sgn * aP, walked along the grid's b axis.
          const px = c.x + sgn * aP * csy + tb * ssy, pz = c.z - sgn * aP * ssy + tb * csy;
          bld.pushQuad([px - hw * ssy, yLo, pz - hw * csy], [px + hw * ssy, yLo, pz + hw * csy],
            [px + hw * ssy, yLo + hh, pz + hw * csy], [px - hw * ssy, yLo + hh, pz - hw * csy],
            LIT_WARM, 1, { emissive: 3.0, doubleSided: true });
        }
      }
    };
    // Rows at two heights, each on the face of the block at that height
    // (mergedBlocks' stackBox fractions: 0.94 at 0-0.42, 0.78 TURNED at
    // 0.42-0.74, 0.55 at 0.74-1). The turned block's a axis is the pile's z.
    const yTop = c.pileTop - 2.4 - r.next() * 0.6;
    switch (c.kind) {
      case 'pier':
      case 'core':
        paneRow(c.pileHalfX * 0.55 + 0.05, c.pileHalfZ * 0.42, yTop);
        paneRow(c.pileHalfZ * 0.78 + 0.05, c.pileHalfX * 0.55, c.pileBase + band * 0.58);
        break;
      case 'silo':
        paneRow(c.pileHalfX * 0.95 + 0.05, c.pileHalfZ * 0.6, c.pileBase + band * 0.3);
        break;
      case 'stack':
        paneRow(c.pileHalfX + 0.05, c.pileHalfZ * 0.5, yTop);
        break;
      case 'lattice':
        paneRow(c.pileHalfX * 0.85 + 0.04, c.pileHalfZ * 0.6, c.pileBase + band * 0.55);
        break;
      case 'spire':
        paneRow(c.halfX * 0.66 - 0.05, c.halfX * 0.3, c.pileBase + band * 0.6);
        break;
    }
  }
}

// ---------------------------------------------------------------- the chunk

/** The village on one chunk's columns: real piles at lod < 2, merged blocks
 *  (with their lit crown panes, D32) beyond. `lights` collects one crown light
 *  per lit pile top at night (D28, scaffold convention, lod < 1 only). */
export function pushFallVillage(bld: MeshBuilder, fall: FallChunk, lod: number, lights?: ChunkLight[]): void {
  for (const c of fall.columns) {
    const r = makeRng((c.seed ^ VILLAGE_SALT) >>> 0);
    const dress: Dress = { lights, lod };
    if (lod < 2) {
      switch (c.kind) {
        case 'pier': pileRect(bld, c, fall.yaw, r, false, dress); break;
        case 'core': pileRect(bld, c, fall.yaw, r, true, dress); break;
        case 'silo': pileSilo(bld, c, fall.yaw, r, dress); break;
        case 'stack': pileStack(bld, c, fall.yaw, r, dress); break;
        case 'lattice': pileLattice(bld, c, fall.yaw, r, dress); break;
        case 'spire': pileSpire(bld, c, fall.yaw, r, dress); break;
      }
    } else {
      mergedBlocks(bld, c, fall.yaw, r);
    }
  }
}
