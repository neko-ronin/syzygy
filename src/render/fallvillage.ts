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
 * Not this round (rounds 1-2): weatherRoom faces, windows, stairs and ladders,
 * laundry, the revival kit, ground lifelines, wreck dressing.
 *
 * Determinism: no Math.random. Every column's village rolls from
 * `makeRng(c.seed ^ VILLAGE_SALT)`, so the same seed builds the same village
 * every run, and chunking stays in step because every box stands on the one
 * column it belongs to. The palette is citymesh's ROOMS (DESIGN §8: reuse it;
 * it is already weighted to slate, soot, rust and red panels); structural
 * steel and the tarp are the only kit colours added here.
 *
 * Cost (D32): LOD 0 real boxes; lod >= 2 merged blocks, matching fallmesh's
 * `lod < 2` convention. Recorded in docs/FALL_VILLAGE_ROUND0.md;
 * src/render/__probe_fallvillage.ts prints the numbers.
 */

import { clamp, makeRng, type Rng, type Vec3 } from '../core/math';
import { BOX_H, type FallChunk, type FallColumn } from '../world/fallzone';
import { MeshBuilder, type MeshOpts } from '../world/geometry';
import { ROOMS } from './citymesh';
import { pushOrientedBox } from './fallmesh';

/** Every pile rolls its own stream off the column's seed; the salt keeps the
 *  grammar independent of every other consumer of `c.seed` (`pileOn` and the
 *  access/repair rolls in fallzone.ts). */
const VILLAGE_SALT = 0x7113e55d;

/** Structural steel: fallmesh's STEEL by value, kept local to avoid an export
 *  churn in a file this round only wires a call into. */
const OUTRIGGER: Vec3 = [0.14, 0.17, 0.21];
/** The white tarp on the uneven top (DESIGN §8). */
const TARP: Vec3 = [0.72, 0.71, 0.66];

/** Same multiply citymesh calls `tint3`. */
const tint = (c: Vec3, k: number): Vec3 => [c[0] * k, c[1] * k, c[2] * k];

/** Containers carry the cold industrial read — steel blue, slate, soot, rust
 *  and the red panels, ROOMS weighted that way, not a new palette. Built on
 *  demand, never at module scope: this file sits in the import cycle
 *  citymesh -> fallmesh -> fallvillage -> citymesh, and at the live app's entry
 *  order citymesh is still initialising when this module's top level runs, so
 *  a module-scope `const CONTAINER = [ROOMS[1], ...]` was a temporal-dead-zone
 *  read — the app showed "Cannot access 'ROOMS' before initialization" and
 *  booted nothing, while tsc and `vite build` (which never execute the graph)
 *  and the probe's own entry order were all clean. Same rule as fallzone.ts
 *  imports: read another module's bindings only inside functions. The literal
 *  `8` is the palette's last index — keep it in step with the array. */
const containerPalette = (): Vec3[] => [
  ROOMS[1], ROOMS[0], ROOMS[4], ROOMS[9],
  ROOMS[2], ROOMS[7], ROOMS[8], ROOMS[6], ROOMS[8],
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
      // containerPalette()[...]: the palette is built on demand (module scope
      // would read ROOMS across the import cycle — see it above). The roll is
      // 0..8 exactly as round 0's `CONTAINER[r.int(0, CONTAINER.length - 1)]`:
      // same single rng draw, so every pile is byte-identical.
      col: containerPalette()[r.int(0, 8)], kit: 1,
    });
  }
  return box({
    long: r.range(3.6, 7.4), wide: r.range(2.8, 3.7), tall: r.range(2.45, 3.1),
    col: tint(ROOMS[r.int(0, ROOMS.length - 1)], r.range(0.62, 1.0)), kit: 0,
  });
};

/** Where a top-kit piece can stand, in grid coordinates. */
interface TopSpot { a: number; b: number; turn: number; y: number }

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
    for (const s of [-0.565, 0.565]) {
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
  // Beam: anchored just inside the shaft face, out past the pile edge.
  const [bx, bz] = p(shaft + over / 2, 0);
  const legLen = over + 0.9;
  bld.pushBox([bx, by, bz], onA ? [legLen / 2, 0.14, 0.09] : [0.09, 0.14, legLen / 2], OUTRIGGER, { rotationY: yaw });
  for (const t of [0.3, 0.72]) {
    const [a0, b0] = p(shaft + over * t, 0);
    const [a1, b1] = p(shaft - 0.02, 0);
    member(bld, [a0, by - 0.12, b0], [a1, by - 2.4 - r.next() * 1.6, b1], 0.07, 0.07, OUTRIGGER);
  }
}

// ---------------------------------------------------------------- the top kit

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
function pileRect(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng, narrow: boolean): void {
  const n = Math.max(2, Math.floor((c.pileTop - c.pileBase) / BOX_H));
  const tops: TopSpot[] = [];
  const headHalf: [number, number] = narrow ? [r.range(1.4, 1.7), r.range(1.3, 1.6)] : [0, 0];
  const headLo = c.top - 0.5, headHi = c.pileTop + (narrow ? 0.9 : 0);
  for (let k = 0; k < n; k++) {
    const t = k / Math.max(1, n - 1);
    const turn = k % 2 ? Math.PI / 2 : 0;
    const shrink = 1 - (narrow ? 0.42 : 0.3) * t;
    const fx = Math.min(c.pileHalfX, c.pileHalfX * shrink * (0.94 + r.next() * 0.1));
    const fz = Math.min(c.pileHalfZ, c.pileHalfZ * shrink * (0.94 + r.next() * 0.1));
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
          if (cur + u.long > s1 + 0.9) break;
          const mid = cur + u.long / 2;
          const a = turn ? rc : mid, b = turn ? mid : rc;
          const y0 = c.pileBase + k * BOX_H;
          const top = putUnit(bld, c, yaw, u, a, b, y0, r.bool() ? 1 : -1);
          if (top > c.pileTop - BOX_H - 0.35) tops.push({ a, b, turn, y: top });
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
  // 1-2 boxes cantilevered further out, on a mess of their own, never past the
  // pile extent the placement registered (only where there IS an overhang).
  if (c.pileHalfX > c.halfX + 3.2) {
    for (let k = 0, nc = 1 + r.int(0, 1); k < nc; k++) {
      const u = rollUnit(r);
      const out = r.range(2.2, 3.6);
      const dir = r.int(0, 3) as 0 | 1 | 2 | 3;
      const onA = dir < 2, sgn2 = dir % 2 ? -1 : 1;
      const extent = onA ? c.pileHalfX : c.pileHalfZ;
      const half = u.rot ? (onA ? u.wide / 2 : u.long / 2) : (onA ? u.long / 2 : u.wide / 2);
      const mid = sgn2 * (extent + out - half);
      const sideways = r.jitter(2.0);
      const a = onA ? mid : sideways, b = onA ? sideways : mid;
      const y0 = c.pileBase + (1 + r.int(0, Math.max(0, n - 2))) * BOX_H;
      putUnit(bld, c, yaw, { ...u, kit: 0 }, a, b, y0);
    }
  }
  topKit(bld, c, yaw, r, tops);
}

/** A linear village along a silo battery's gallery: a continuous run along the
 *  cylinder caps, shack rows across it, a head-house canopy at an end. */
function pileSilo(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng): void {
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
        const top = putUnit(bld, c, yaw, u, cur + u.long / 2, r.jitter(rad * 0.22), y0);
        tops.push({ a: cur + u.long / 2, b: 0, turn: 0, y: top });
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
        putUnit(bld, c, yaw, { ...u, long, rot: Math.PI / 2 }, a, clamp(r.jitter(rad * 0.5), -bMax, bMax), y0);
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
    putUnit(bld, c, yaw, { ...u, kit: 2 }, sgn * (c.halfX - Math.min(rad, u.long / 2) - 0.1), 0, c.pileBase, 1);
  }
  topKit(bld, c, yaw, r, tops.filter((sp) => sp.y > c.pileBase + BOX_H * 1.5));
}

/** A ring of boxes on a stack's collar platform: a plank deck on brackets, a
 *  broken ring of boxes around, the stack's top bare for its turbine (round 2). */
function pileStack(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng): void {
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
    const len = (2 * Math.PI * rMid) / ns + 0.55;
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
    const rr = rMid + r.jitter(0.8);
    const [wx, wz] = [c.x + Math.cos(phi) * rr, c.z + Math.sin(phi) * rr];
    const u = rollUnit(r);
    const turnW = r.bool(0.65) ? -phi : -phi - Math.PI / 2;
    const [a, b] = toGrid(c, yaw, wx, wz);
    const top = putUnit(bld, c, yaw, { ...u, rot: turnW - yaw }, a, b, deckY + 0.19);
    let yBest = top;
    if (rows >= 2 && r.bool(0.45)) {
      const u2 = rollUnit(r);
      yBest = Math.max(yBest, putUnit(bld, c, yaw, { ...u2, rot: turnW - yaw }, a + r.jitter(0.4), b + r.jitter(0.4), top));
    }
    tops.push({ a, b, turn: turnW - yaw, y: yBest });
  }
  topKit(bld, c, yaw, r, tops);
}

/** Boxes slung inside a lattice cage: one big unit per level at odd offsets,
 *  an X of bracing on one face taking the read. */
function pileLattice(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng): void {
  const n = Math.max(2, Math.round((c.pileTop - c.pileBase) / BOX_H));
  const inner = Math.max(c.pileHalfX - 0.6, 3.2);
  const tops: TopSpot[] = [];
  for (let k = 0; k < n; k++) {
    const u = rollUnit(r);
    const long = Math.min(u.long, inner * 2 - 1.0);
    const top = putUnit(bld, c, yaw, { ...u, long }, r.jitter(inner * 0.16), r.jitter(inner * 0.16), c.pileBase + k * BOX_H);
    if (k === n - 1) tops.push({ a: r.jitter(1.2), b: r.jitter(1.2), turn: (k % 2) * Math.PI / 2, y: top });
  }
  const legAt: [number, number][] = [[0, 1], [0, 2], [2, 3], [1, 3]];
  const corner = (i: number, dy: number): Vec3 => {
    const [u, w] = [[1, 1], [1, -1], [-1, 1], [-1, -1]][i];
    return [c.x + u * c.halfX, c.pileBase - dy, c.z + w * c.halfZ];
  };
  const [i0, i1] = legAt[r.int(0, 3)];
  member(bld, corner(i0, 2.8), corner(i1, 0.15), 0.08, 0.08, OUTRIGGER);
  member(bld, corner(i1, 2.8), corner(i0, 0.15), 0.08, 0.08, OUTRIGGER);
  topKit(bld, c, yaw, r, tops);
}

/** A terraced crater village inside a spire stump: rings of boxes step inward
 *  as they climb the broken floors, widest down at the foot. */
function pileSpire(bld: MeshBuilder, c: FallColumn, yaw: number, r: Rng): void {
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
      const turnW = -phi - Math.PI / 2;
      const [a, b] = toGrid(c, yaw, c.x + Math.cos(phi) * rr, c.z + Math.sin(phi) * rr);
      putUnit(bld, c, yaw, { ...u, rot: turnW - yaw }, a, b, yFloor);
      if (j === L - 1 && i % 3 === 0) tops.push({ a, b, turn: turnW - yaw, y: yFloor + u.tall });
    }
  }
  topKit(bld, c, yaw, r, tops);
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
}

// ---------------------------------------------------------------- the chunk

/** The village on one chunk's columns: real piles at lod < 2, merged blocks beyond. */
export function pushFallVillage(bld: MeshBuilder, fall: FallChunk, lod: number): void {
  for (const c of fall.columns) {
    const r = makeRng((c.seed ^ VILLAGE_SALT) >>> 0);
    if (lod < 2) {
      switch (c.kind) {
        case 'pier': pileRect(bld, c, fall.yaw, r, false); break;
        case 'core': pileRect(bld, c, fall.yaw, r, true); break;
        case 'silo': pileSilo(bld, c, fall.yaw, r); break;
        case 'stack': pileStack(bld, c, fall.yaw, r); break;
        case 'lattice': pileLattice(bld, c, fall.yaw, r); break;
        case 'spire': pileSpire(bld, c, fall.yaw, r); break;
      }
    } else {
      mergedBlocks(bld, c, fall.yaw, r);
    }
  }
}
