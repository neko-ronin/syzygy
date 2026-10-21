/**
 * The fall zone's column shafts, ground to `c.top` — the break plane in
 * `c.break`. Round 2 of the §8 pass (round 0 was fallmesh volumes, round 1
 * was the pile grammar in fallvillage.ts).
 *
 * The gap the review closed out (docs/VISION_FALL_BASELINE.md PART 3): the
 * zone's largest surfaces were plain smooth prisms — no break, no rebar, no
 * stain, no salvage cut — and at dusk the bare concrete was the brightest,
 * warmest thing in the frame. Two levers fix that, both on the column:
 *   - value/hue: the concrete is retinted to a cold soot-slate, and the
 *     stains and spalls that sit on it are darker still, so the sunlit area
 *     is a fraction of a prism's face, not the whole prism
 *   - silhouette: every broken kind carries its break as geometry that
 *     survives the lod >= 2 merge, so a far pier reads broken, not chimney
 *     (the merged blocks in citymesh cannot know about breaks — the shaft
 *     has to break itself here)
 *
 * Per-kind grammar follows DESIGN §8's table — each kind keeps its own
 * history rather than receiving one generic jagged cylinder:
 *   pier  shear   — body to a lowered rim, three torn slabs ascending to the
 *                   high corner, rebar, a spalled face, stains running down
 *   pier  crater  — body lowered, uneven rim ring around a hollow floor
 *   pier  cut     — clean salvage top, scorched saw band, bolt stubs
 *   pier  intact  — full height with its bearing cap; a couple of stains
 *   core  intact  — stair slots up one face, lift doors up another, slab
 *                   stub fringe (the floors the tower lost), low stains
 *   stack intact  — three taper parts, oxide bands, a flue lip, long stains
 *   silo  intact  — the battery unchanged plus hairline ring cracks, stains
 *   lattice shear — legs of uneven height, broken stubs above the cuts
 *   spire  crater — walls dropped to a lower rim, jagged battlements standing
 *                   back up to the record top, interior floor plates
 *
 * LOD tiers (pushColumn takes the chunk's lod): lod >= 2 is the far
 * silhouette — only the break's structure stays (shear slabs, crater ring,
 * saw band, battlements, uneven legs, taper, bands, caps, lip). Albedo
 * detail (stains, spall, rebar, bolts, plates, cracks) and the cores'
 * per-floor detail are lod < 2; the core's floor rhythm steps down — every
 * line at lod 0, every second at lod 1. D28 holds: nothing here emits light.
 *
 * Everything rolls on `makeRng(c.seed ^ salt)` — no Math.random, no shared
 * stream — so a chunk rebuild is byte-identical (probe: determinism).
 * Bounds contract (probe shaft sweep, lod 0 & 2): ground to the break,
 * material to +2.9 m above it, in plan inside the record's pile extent or,
 * for the interiored kinds (lattice + its 0.8 m leg section; the spire,
 * whose registered record is the crater interior, against the tube's outer
 * face), the structure's own half. Placement is untouched — fallzone still
 * owns the columns; only this drawing grew.
 *
 * Coplanar bookkeeping: pushed detail sits 0.01–0.05 m proud of (or recessed
 * 0.02 m back from) its support face, slab bottoms bury BURY into the solid
 * below, and drip streaks clamp to the ground plain — no two pushed faces
 * share a plane with the shell (PITFALLS: silent fights).
 */

import type { Vec3 } from '../core/math';
import { makeRng, type Rng } from '../core/math';
import { GROUND_Y } from '../world/citygen';
import type { FallColumn } from '../world/fallzone';
import type { MeshBuilder } from '../world/geometry';
import { pushOrientedBox, yawTiltBasis } from './fallmesh';

// The value leg: the concrete drops to a cold soot-slate (the dusk sun keeps
// its warmth for the villages; the shaft keeps the fog). Everything that
// sits on the concrete — stain, spall, band — is darker than the base.
const CONCRETE: Vec3 = [0.23, 0.245, 0.27];
const SPALL: Vec3 = [0.16, 0.16, 0.155]; // exposed aggregate
const STAIN: Vec3 = [0.11, 0.12, 0.14]; // cold water stain
const SCORCH: Vec3 = [0.075, 0.078, 0.085]; // saw cut, scorch, crack line
const BAND: Vec3 = [0.155, 0.135, 0.12]; // oxide bands
const FRINGE: Vec3 = [0.185, 0.195, 0.215]; // slab stubs, a shade under the shaft
const INNER: Vec3 = [0.19, 0.19, 0.185]; // crater floor, spire plates
const VOID: Vec3 = [0.045, 0.05, 0.058]; // openings, near black
const STEEL: Vec3 = [0.14, 0.17, 0.21];
const RUST: Vec3 = [0.15, 0.095, 0.07];

const PRIDE = 0.014; // albedo detail's stand-off from the face it stains
const BURY = 0.3; // how far a slab's bottom reaches into the solid below it

/** Plain world offset the flat basis gives for a plan offset (u along ax,
 *  w along az) on one world component: 0 for x, 2 for z. Roots of bars and
 *  plan placements of slabs use it so the yaw rotation is never recomputed
 *  with different values for one point. */
function fw(flat: [Vec3, Vec3, Vec3], ci: 0 | 2, u: number, w: number): number {
  return flat[0][ci] * u + flat[2][ci] * w;
}

/** One outward quad on a face plane of the column: faces `facing` (+1/-1)
 *  with its plane at the signed coordinate `plane` along basis axis `axis`
 *  ('a' = ax, 'b' = az), run u0..u1 across the face, y0..y1 vertical. For a
 *  right-handed basis the +a and -b faces run reversed against u, the -a
 *  and +b faces go plain — verified against pushBox's face order — so the
 *  quad reads from outside under backface culling. */
function faceQuad(bld: MeshBuilder, c: FallColumn, [ax, , az]: [Vec3, Vec3, Vec3], axis: 'a' | 'b', facing: number, plane: number, y0: number, y1: number, u0: number, u1: number, color: Vec3): void {
  const face = axis === 'a' ? ax : az;
  const run = axis === 'a' ? az : ax;
  const at = (u: number, y: number): Vec3 => [c.x + face[0] * plane + run[0] * u, y, c.z + face[2] * plane + run[2] * u];
  if (axis === 'a' ? facing > 0 : facing < 0) bld.pushQuad(at(u1, y0), at(u0, y0), at(u0, y1), at(u1, y1), color);
  else bld.pushQuad(at(u0, y0), at(u1, y0), at(u1, y1), at(u0, y1), color);
}

/** Four face quads closing a thin proud band around a plan rectangle of
 *  halfs [hx, hz] centred at (cu, cw), top edge at yTop: ring cracks, stack
 *  bands, saw lines. Corner noodles stop 0.002 short of each other, so the
 *  ring reads closed without two quads sharing an area. */
function bandRing(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], hx: number, hz: number, yTop: number, th: number, proud: number, color: Vec3, cu = 0, cw = 0): void {
  const y0 = yTop - th, e = 0.002, crossX = hx + proud - e, crossZ = hz + proud - e;
  faceQuad(bld, c, flat, 'a', 1, cu + hx + proud, y0, y0 + th, -crossZ, crossZ, color);
  faceQuad(bld, c, flat, 'a', -1, cu - hx - proud, y0, y0 + th, -crossZ, crossZ, color);
  faceQuad(bld, c, flat, 'b', 1, cw + hz + proud, y0, y0 + th, -crossX, crossX, color);
  faceQuad(bld, c, flat, 'b', -1, cw - hz - proud, y0, y0 + th, -crossX, crossX, color);
}

/** A rebar member: a thin box leaning `tilt` from vertical, centred along
 *  its own axis len/2 above its root, so the root buries into the rim. */
function bar(bld: MeshBuilder, root: Vec3, yaw: number, tilt: number, len: number, color: Vec3, half = 0.055): void {
  const basis = yawTiltBasis(yaw, tilt);
  const ay = basis[1];
  pushOrientedBox(bld, [root[0] + ay[0] * len / 2, root[1] + ay[1] * len / 2, root[2] + ay[2] * len / 2], ...basis, [half, len / 2, half], color);
}

/** The box body of a prism-kind shaft, ground..yTop at the given plan
 *  halfs. */
function shaftBox(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], hx: number, hz: number, yTop: number): void {
  pushOrientedBox(bld, [c.x, (yTop + GROUND_Y) / 2, c.z], ...flat, [hx, (yTop - GROUND_Y) / 2, hz], CONCRETE);
}

/** Vertical water streaks on `n` seeded faces, descending from `yTopBase`:
 *  the stain that makes a break read as weather, not a modelling accident.
 *  Height clamps to the ground plain; (cu, cw) offsets the face plan for
 *  the silo battery's cylinders. */
function drips(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], r: Rng, hx: number, hz: number, yTopBase: number, hMin: number, hMax: number, wMin: number, wMax: number, n: number, proud = PRIDE, color = STAIN, cu = 0, cw = 0): void {
  for (let i = 0; i < n; i++) {
    const axis: 'a' | 'b' = r.bool() ? 'a' : 'b';
    const facing: 1 | -1 = r.bool() ? 1 : -1;
    const plane = (axis === 'a' ? cu + hx : cw + hz) + proud;
    const cross = axis === 'a' ? hz : hx;
    const u = r.range(-0.85, 0.85) * cross;
    const w = r.range(wMin, wMax);
    const yTop = yTopBase - r.range(0, 1.2);
    const h = Math.min(r.range(hMin, hMax), Math.max(1, yTop - GROUND_Y - 0.25));
    faceQuad(bld, c, flat, axis, facing, facing > 0 ? plane : -plane, yTop - h, yTop, u - w / 2, u + w / 2, color);
  }
}

/** Rebar planted at a seeded rim position: the root points sampled once so
 *  x and z agree on the same point. */
function rimBars(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], r: Rng, n: number, yRoot: number, lenMax = 2.4): void {
  for (let i = 0; i < n; i++) {
    const u = r.range(-0.85, 0.85) * c.halfX, w = r.range(-0.85, 0.85) * c.halfZ;
    bar(bld, [c.x + fw(flat, 0, u, w), yRoot, c.z + fw(flat, 2, u, w)], r.next() * Math.PI * 2, r.range(-0.2, 0.2), r.range(0.8, lenMax), r.bool(0.6) ? RUST : STEEL, 0.045 + r.next() * 0.02);
  }
}

interface Tier { y0: number; y1: number; hx: number; hz: number }

/** Stack taper: three concentric parts, each burying BURY into the one
 *  below, so no two tiers share a plane. */
function stackParts(c: FallColumn, r: Rng): Tier[] {
  const h = c.top - GROUND_Y;
  return [
    { y0: GROUND_Y, y1: GROUND_Y + 0.55 * h, hx: c.halfX, hz: c.halfZ },
    { y0: GROUND_Y + 0.55 * h, y1: GROUND_Y + 0.83 * h, hx: c.halfX * 0.86 + r.jitter(0.05), hz: c.halfZ * 0.86 + r.jitter(0.05) },
    { y0: GROUND_Y + 0.83 * h, y1: c.top, hx: c.halfX * 0.73 + r.jitter(0.04), hz: c.halfZ * 0.73 + r.jitter(0.04) },
  ];
}

/* ---------------------------------------------------------------- piers */

function pushPier(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], r: Rng, lod: number): void {
  const far = lod >= 2, near = lod < 2;
  if (c.break === 'shear') {
    const drop = r.range(2.2, 4.6), rim = c.top - drop;
    shaftBox(bld, c, flat, c.halfX, c.halfZ, rim);
    // Three torn slabs ascending to the high corner, along a seeded axis and
    // side; each slab's bottom buries into the body, its top jitters and caps
    // at the record top.
    const axis: 'a' | 'b' = r.bool() ? 'a' : 'b';
    const side = r.bool() ? 1 : -1;
    const uh = axis === 'a' ? c.halfX : c.halfZ, cross = axis === 'a' ? c.halfZ : c.halfX;
    for (let k = 1; k <= 3; k++) {
      const stepTop = Math.min(c.top, rim + drop * (k / 3) + r.jitter(0.18));
      const lo = -uh + (side > 0 ? k - 1 : 3 - k) * (2 * uh / 3) + r.range(0.03, 0.12);
      const hi = lo + 2 * uh / 3 - r.range(0.03, 0.12);
      const uMid = (lo + hi) / 2, uhHalf = (hi - lo) / 2, ch = cross * (0.94 - r.range(0, 0.05));
      const yh = (stepTop - (rim - BURY)) / 2, yc = (stepTop + rim - BURY) / 2;
      const u = axis === 'a' ? uMid : 0, w = axis === 'a' ? 0 : uMid;
      pushOrientedBox(bld, [c.x + fw(flat, 0, u, w), yc, c.z + fw(flat, 2, u, w)], ...flat, axis === 'a' ? [uhHalf, yh, ch] : [ch, yh, uhHalf], CONCRETE);
    }
    if (near) {
      rimBars(bld, c, flat, r, 4 + ((r.next() * 4) | 0), rim - 0.2);
      // Spalled faces: exposed aggregate proud of the shell under the break.
      const spallN = 1 + ((r.next() * 2) | 0);
      for (let i = 0; i < spallN; i++) {
        const axis2: 'a' | 'b' = r.bool() ? 'a' : 'b';
        const facing: 1 | -1 = r.bool() ? 1 : -1;
        const plane = (axis2 === 'a' ? c.halfX : c.halfZ) + 0.012;
        const cross2 = axis2 === 'a' ? c.halfZ : c.halfX;
        const w = r.range(2.2, 4.6), u = r.range(-0.6, 0.6) * cross2;
        faceQuad(bld, c, flat, axis2, facing, facing > 0 ? plane : -plane, rim - r.range(2.5, 4.5), rim - r.range(0.6, 1.6), u - w / 2, u + w / 2, SPALL);
      }
      drips(bld, c, flat, r, c.halfX, c.halfZ, rim - r.range(0.2, 1.4), 6, 14, 0.3, 0.9, 2 + ((r.next() * 2) | 0));
    }
  } else if (c.break === 'crater') {
    const depth = r.range(1.8, 3.2), rim = c.top - depth;
    shaftBox(bld, c, flat, c.halfX, c.halfZ, rim);
    // Hollow floor deep in the crater — what the ring leaves open on top;
    // visible from above through the uneven rim, far included (12 tri).
    const fh = 0.5, fy = rim - r.range(0.55, 1.1);
    pushOrientedBox(bld, [c.x, fy - fh / 2, c.z], ...flat, [c.halfX * 0.5, fh / 2, c.halfZ * 0.5], INNER);
    // Uneven rim ring: four walls, two or three torn segments each, recessed
    // 0.02 back from the shell so no segment shares its plane. Each segment
    // sits ON its wall (run along the wall, fixed at the wall's own face),
    // leaving the crater hollow open between them.
    const segsPerWall = far ? 2 : 3, wDepth = r.range(0.7, 1.4);
    for (const [wall, sgn] of [['a', 1], ['a', -1], ['b', 1], ['b', -1]] as const) {
      const runHalf = wall === 'a' ? c.halfZ : c.halfX; // segments run across the wall
      const fixed = (wall === 'a' ? c.halfX : c.halfZ) - 0.02;
      for (let k = 0; k < segsPerWall; k++) {
        const lo = -runHalf + k * (2 * runHalf / segsPerWall) + r.range(0.05, 0.18);
        const hi = lo + 2 * runHalf / segsPerWall - r.range(0.05, 0.18);
        const segTop = rim + r.range(1.0, depth - 0.35);
        const mMid = (lo + hi) / 2, runRx = (hi - lo) / 2;
        const yh = (segTop - (rim - BURY)) / 2, sy = (segTop + rim - BURY) / 2;
        const depthHalf = wDepth / 2, mid = fixed - depthHalf; // recessed 0.02 back of the shell
        const u = wall === 'a' ? sgn * mid : mMid, w = wall === 'a' ? mMid : sgn * mid;
        const halfs: Vec3 = wall === 'a' ? [depthHalf, yh, runRx] : [runRx, yh, depthHalf];
        pushOrientedBox(bld, [c.x + fw(flat, 0, u, w), sy, c.z + fw(flat, 2, u, w)], ...flat, halfs, CONCRETE);
      }
    }
    if (near) {
      rimBars(bld, c, flat, r, 4 + ((r.next() * 4) | 0), rim - 0.2);
      drips(bld, c, flat, r, c.halfX, c.halfZ, rim - r.range(0.3, 1.5), 5, 12, 0.3, 0.9, 2 + ((r.next() * 2) | 0));
    }
  } else if (c.break === 'cut') {
    shaftBox(bld, c, flat, c.halfX, c.halfZ, c.top);
    // The salvage scorch line girdles the top; it reads far (the silhouette
    // keeps a dark rim on an otherwise clean cut).
    bandRing(bld, c, flat, c.halfX, c.halfZ, c.top - 0.05, 0.24, 0.015, SCORCH);
    if (near) {
      rimBars(bld, c, flat, r, 2 + ((r.next() * 2) | 0), c.top - 0.1, 0.5);
      drips(bld, c, flat, r, c.halfX, c.halfZ, c.top - r.range(0.4, 1.0), 4, 9, 0.25, 0.6, 1 + ((r.next() * 2) | 0));
    }
  } else {
    // Intact: full height with its bearing cap — the pile still holds to it.
    shaftBox(bld, c, flat, c.halfX, c.halfZ, c.top);
    pushOrientedBox(bld, [c.x, c.top - 0.36, c.z], ...flat, [c.halfX + 0.22, 0.33, c.halfZ + 0.22], CONCRETE);
    if (near) drips(bld, c, flat, r, c.halfX, c.halfZ, c.top - r.range(1.0, 2.5), 5, 11, 0.25, 0.7, 1 + ((r.next() * 2) | 0));
  }
}

/* ---------------------------------------------------------------- cores */

function pushCore(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], r: Rng, lod: number): void {
  shaftBox(bld, c, flat, c.halfX, c.halfZ, c.top);
  if (lod >= 2) return; // far: the stripped core is a clean dark slab
  const pitch = 3.1, base = GROUND_Y + 3.5, lines = Math.max(1, Math.floor((c.top - 2 - base) / pitch));
  const every = lod === 0 ? 1 : 2; // lod 1 keeps the rhythm but halves it
  const slotAxis: 'a' | 'b' = r.bool() ? 'a' : 'b';
  const doorAxis: 'a' | 'b' = slotAxis === 'a' ? 'b' : 'a';
  const slotFacing: 1 | -1 = r.bool() ? 1 : -1;
  const doorFacing: 1 | -1 = slotFacing > 0 ? -1 : 1;
  const slotUc = r.range(-0.15, 0.15), doorUc = r.range(-0.15, 0.15);
  const slotPlane = (slotAxis === 'a' ? c.halfX : c.halfZ) + 0.01;
  const doorPlane = (doorAxis === 'a' ? c.halfX : c.halfZ) + 0.01;
  for (let k = 0; k < lines; k++) {
    const y = base + k * pitch;
    if (k % every === 0) {
      const w = r.range(0.8, 1.0), u = slotUc + r.jitter(0.4);
      faceQuad(bld, c, flat, slotAxis, slotFacing, slotFacing > 0 ? slotPlane : -slotPlane, y, y + r.range(1.7, 2.0), u - w / 2, u + w / 2, VOID);
    }
    if (lod === 0 && k % 2 === 0) {
      const w = r.range(1.4, 1.7), u = doorUc + r.jitter(0.3);
      faceQuad(bld, c, flat, doorAxis, doorFacing, doorFacing > 0 ? doorPlane : -doorPlane, y, y + 2.3, u - w / 2, u + w / 2, VOID);
    }
    if (k % (every + 1) === 0) {
      // Slab stub fringe — the ledge lip of the floors the tower lost, on
      // the two seeded faces. Proud quads, thin enough to read as stubs.
      for (const axis of [doorAxis, slotAxis] as const) {
        const plane = (axis === 'a' ? c.halfX : c.halfZ) + 0.05;
        const cross = axis === 'a' ? c.halfZ : c.halfX;
        for (const sgn of [1, -1] as const) {
          faceQuad(bld, c, flat, axis, sgn, sgn > 0 ? plane : -plane, y - 0.09, y + 0.09, -cross * 0.99, cross * 0.99, FRINGE);
        }
      }
    }
  }
  drips(bld, c, flat, r, c.halfX, c.halfZ, base + r.range(2, 5), 8, 20, 0.3, 0.8, 2);
}

/* --------------------------------------------------------------- stacks */

function pushStack(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], r: Rng, lod: number): void {
  const parts = stackParts(c, r);
  for (const p of parts) {
    const bury = p.y0 > GROUND_Y ? BURY : 0;
    pushOrientedBox(bld, [c.x, (p.y0 + p.y1) / 2 - bury / 2, c.z], ...flat, [p.hx, (p.y1 - p.y0) / 2 + bury / 2, p.hz], CONCRETE);
  }
  // Oxide bands on whichever part each crosses; the banded silhouette holds
  // far (the "banded, tapering" chimney of the table).
  const pitch = r.range(7.5, 11.5);
  for (let yTop = GROUND_Y + 7; yTop < c.top - 2; yTop += pitch) {
    const by = yTop + r.jitter(0.5), th = r.range(0.26, 0.44);
    const p = parts.find((q) => by >= q.y0 && by <= q.y1) ?? parts[parts.length - 1];
    bandRing(bld, c, flat, p.hx, p.hz, by, th, 0.045, BAND);
  }
  // Flue lip: the top's own rim — what the round-3 turbine then crowns.
  const top = parts[parts.length - 1];
  pushOrientedBox(bld, [c.x, c.top + 0.16, c.z], ...flat, [top.hx * 0.82, 0.32, top.hz * 0.82], CONCRETE);
  if (lod < 2) drips(bld, c, flat, r, top.hx, top.hz, GROUND_Y + 7 + r.range(0, 4), 12, 30, 0.4, 1.1, 2 + ((r.next() * 2) | 0));
}

/* ---------------------------------------------------------------- silos */

function pushSilo(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], r: Rng, lod: number): void {
  const near = lod < 2, rad = c.halfX / c.count, h = c.top - GROUND_Y, y = GROUND_Y + h / 2;
  const [ax, ay, az] = flat;
  for (let k = 0; k < c.count; k++) {
    const cu = (2 * k - (c.count - 1)) * rad;
    pushOrientedBox(bld, [c.x + ax[0] * cu, y, c.z + ax[2] * cu], ax, ay, az, [rad, h / 2, rad], CONCRETE);
    const cracks = near ? 2 : 1;
    for (let i = 0; i < cracks; i++) {
      bandRing(bld, c, flat, rad, rad, GROUND_Y + h * r.range(0.22, 0.9), r.range(0.08, 0.13), 0.03, SCORCH, cu, 0);
    }
  }
  if (near) {
    const k = r.int(0, c.count - 1), cu = (2 * k - (c.count - 1)) * rad;
    drips(bld, c, flat, r, rad, rad, GROUND_Y + h * r.range(0.5, 0.85), h * 0.3, h * 0.6, 0.25, 0.6, 2, 0.02, SCORCH, cu, 0);
  }
}

/* -------------------------------------------------------------- lattice */

function pushLattice(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], r: Rng, lod: number): void {
  const near = lod < 2, order = r.shuffle([0, 1, 2, 3]);
  const nLost = c.break === 'shear' ? 1 + r.int(0, 2) : 0;
  const lost = new Set(order.slice(0, nLost));
  const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < 4; i++) {
    const [u, w] = corners[i];
    const isLost = lost.has(i);
    const legTop = isLost ? c.top - r.range(1.0, 3.2) : c.top;
    pushOrientedBox(bld, [c.x + fw(flat, 0, u * c.halfX, w * c.halfZ), (legTop + GROUND_Y) / 2, c.z + fw(flat, 2, u * c.halfX, w * c.halfZ)], ...flat, [0.8, (legTop - GROUND_Y) / 2, 0.8], STEEL);
    if (near && isLost) {
      bar(bld, [c.x + fw(flat, 0, u * c.halfX, w * c.halfZ) + r.jitter(0.3), legTop - 0.15, c.z + fw(flat, 2, u * c.halfX, w * c.halfZ) + r.jitter(0.3)], r.jitter(0.7), r.range(-0.2, 0.2), r.range(0.35, 0.85), r.bool(0.5) ? RUST : STEEL, 0.13);
    }
  }
}

/* ---------------------------------------------------------------- spire */

function pushSpire(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], r: Rng, lod: number): void {
  const near = lod < 2, t = 3, halfT = t / 2, hx = c.halfX, hz = c.halfZ;
  const rimDrop = r.range(2.5, 6), topBody = c.top - rimDrop, h = topBody - GROUND_Y, yc = GROUND_Y + h / 2;
  const [ax, ay, az] = flat;
  const at = (u: number, w: number): Vec3 => [c.x + ax[0] * u + az[0] * w, yc, c.z + ax[2] * u + az[2] * w];
  // Body: hollow square tube, so the crater village inside shows from above.
  pushOrientedBox(bld, at(0, hz - halfT), ax, ay, az, [hx, h / 2, halfT], CONCRETE);
  pushOrientedBox(bld, at(0, -hz + halfT), ax, ay, az, [hx, h / 2, halfT], CONCRETE);
  pushOrientedBox(bld, at(hx - halfT, 0), ax, ay, az, [halfT, h / 2, hz - t], CONCRETE);
  pushOrientedBox(bld, at(-hx + halfT, 0), ax, ay, az, [halfT, h / 2, hz - t], CONCRETE);
  // Battlements: standing wall segments out of the lowered rim, jagged back
  // up to the record top. Sides proud 0.01 of the wall shell, ends pulled in
  // 0.02 from the corners, so no segment shares a plane with the shell or
  // its neighbours.
  const segsPerWall = near ? 4 : 3;
  for (const [axis, sgn] of [['z', 1], ['z', -1], ['x', 1], ['x', -1]] as const) {
    const span = axis === 'z' ? hx : hz, thick = axis === 'z' ? hz : hx;
    for (let k = 0; k < segsPerWall; k++) {
      const lo = -span + 0.02 + k * ((2 * (span - 0.02)) / segsPerWall);
      const hi = lo + (2 * (span - 0.02)) / segsPerWall;
      const stand = r.bool(0.55);
      const segTop = Math.max(topBody + 0.55, c.top - (stand ? r.range(0, 1.6) : r.range(2.4, 3.9)));
      const uMid = (lo + hi) / 2, uhHalf = (hi - lo) / 2;
      const yh = (segTop - (topBody - BURY)) / 2, sy = (segTop + topBody - BURY) / 2;
      const pos: Vec3 = axis === 'z'
        ? [c.x + ax[0] * uMid + az[0] * sgn * (thick - halfT), sy, c.z + ax[2] * uMid + az[2] * sgn * (thick - halfT)]
        : [c.x + az[0] * uMid + ax[0] * sgn * (thick - halfT), sy, c.z + az[2] * uMid + ax[2] * sgn * (thick - halfT)];
      pushOrientedBox(bld, pos, ax, ay, az, axis === 'z' ? [uhHalf, yh, halfT + 0.01] : [halfT + 0.01, yh, uhHalf], CONCRETE);
    }
  }
  // Interior floor plates — the ring ledges the fall left inside the shell.
  if (near) {
    for (let d = 1; d <= 2; d++) {
      const dep = topBody - d * r.range(6, 9), j0 = r.jitter(0.05), j1 = r.jitter(0.05), j2 = r.jitter(0.05), j3 = r.jitter(0.05);
      const inner: Array<[u: number, w: number, halfs: Vec3, j: number]> = [
        [0, hz - 3.2, [hx - 3.1, 0.14, 0.45], j0],
        [0, -(hz - 3.2), [hx - 3.1, 0.14, 0.45], j1],
        [hx - 3.2, 0, [0.45, 0.14, hz - 3.1], j2],
        [-(hx - 3.2), 0, [0.45, 0.14, hz - 3.1], j3],
      ];
      for (const [u, w, halfs, j] of inner) {
        pushOrientedBox(bld, [c.x + ax[0] * u + az[0] * w, dep + j, c.z + ax[2] * u + az[2] * w], ax, ay, az, halfs, INNER);
      }
    }
    drips(bld, c, flat, r, c.halfX, c.halfZ, topBody - r.range(0.5, 2), 15, 45, 1.2, 3.5, 2 + ((r.next() * 2) | 0), 0.02);
  }
}

/* ---------------------------------------------------------------- entry */

/** One column's share of the chunk mesh: kind grammar over break grammar,
 *  both seeded per column. `lod` is the chunk's tier: 0 near, 1 mid (the
 *  stepped-down rhythm), >= 2 far silhouette. */
export function pushColumn(bld: MeshBuilder, c: FallColumn, flat: [Vec3, Vec3, Vec3], lod: number): void {
  const r = makeRng(c.seed ^ 0xc01a);
  switch (c.kind) {
    case 'silo': return pushSilo(bld, c, flat, r, lod);
    case 'lattice': return pushLattice(bld, c, flat, r, lod);
    case 'spire': return pushSpire(bld, c, flat, r, lod);
    case 'core': return pushCore(bld, c, flat, r, lod);
    case 'stack': return pushStack(bld, c, flat, r, lod);
    default: return pushPier(bld, c, flat, r, lod);
  }
}
