/**
 * The fall zone's working floor (DESIGN §8 "The ground: a wreck field with a
 * working floor"), round 3b. Three pieces, in the order they were built:
 * lifelines (§1 of docs/GROUND_ROUND3_PLAN.md), wreck dressing (§2), and the
 * flooded lows (§3, corrected by docs/GROUND_ROUND3_AUDIT.md).
 *
 * Everything here is DERIVED from placement that already exists — the columns'
 * `access` kind, `FallChunk.stations`, `FallChunk.wreck`, `FallChunk.patches`.
 * Nothing is placed, no footprint is invented, and `fallzone.ts` is untouched.
 *
 * The lights are the one part that spends a shared budget. The audit measured
 * the mechanism (GROUND_ROUND3_AUDIT.md §5): the zone's lamps are pushed before
 * `bakeGroundDetail`, and `groundbake.ts:306` takes `lightCap = lights.length +
 * maxLights` *after* that, so a zone lamp RAISES the chunk's ceiling instead of
 * taking the market's share. The cap below is therefore not market protection —
 * that was the plan's error — it is GPU cost, and MAX_LAMPS is recorded here so
 * the number is visible rather than inferred.
 */

import { makeRng, type Rng, type Vec3 } from '../core/math';
import { GROUND_Y } from '../world/citygen';
import type { CrowdObstacle } from '../world/crowdobstacles';
import type { FallChunk, FallColumn } from '../world/fallzone';
import type { MeshBuilder } from '../world/geometry';
import type { ChunkLight } from './fallmesh';

// Salvage-yard materials. Sheet B's palette is cold steel with rust as the
// minority accent, so the huts are corrugated sheet and dirty timber, not paint.
const STEEL: Vec3 = [0.16, 0.18, 0.21];
const HUT: Vec3 = [0.31, 0.29, 0.26];
const ROOF: Vec3 = [0.23, 0.22, 0.21];
const TIMBER: Vec3 = [0.36, 0.30, 0.22];
const PALE_TIMBER: Vec3 = [0.47, 0.42, 0.33];
const BARREL: Vec3 = [0.27, 0.33, 0.30];
const RUST: Vec3 = [0.34, 0.22, 0.16];
const CABLE: Vec3 = [0.15, 0.15, 0.16];
const CONCRETE: Vec3 = [0.33, 0.32, 0.31];
const DOOR: Vec3 = [0.09, 0.09, 0.1];
/** D28's warm amber. The only colour in the zone that is not cold by design. */
const LAMP: Vec3 = [1.0, 0.72, 0.4];

/** One work lamp's reach — the alley-lantern scale, so it pools on the deck. */
const LAMP_RADIUS = 10;
const LAMP_INTENSITY = 2.2;
/**
 * Per chunk, at lod < 1. The audit shows the market is not the payer (see the
 * header), so this is a GPU-cost ceiling, not a starvation guard: a chunk holds
 * 4-8 columns and at most about six of them earn a lamp.
 */
const MAX_LAMPS = 6;

const SALT = 0x6f7264; // 'ord': the ground's own stream, not the village's

/** The zone's local frame: a along the grid's x, b along its z. */
interface Frame {
  yaw: number;
  at: (x: number, z: number, a: number, b: number) => [number, number];
  dir: (a: number, b: number) => [number, number];
}

function frame(yaw: number): Frame {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const at = (x: number, z: number, a: number, b: number): [number, number] => [x + ca * a + sa * b, z - sa * a + ca * b];
  return { yaw, at, dir: (a, b) => [ca * a + sa * b, -sa * a + ca * b] };
}

/**
 * One chunk's share of the zone's floor: stair-tower feet, winch houses,
 * core-stair thresholds, salvage workshops, the D30 B kit, and the ropeway
 * huts' queue rails. One warm work lamp each, emissive head always.
 */
export function pushFallGround(bld: MeshBuilder, fall: FallChunk, lod: number, obstacles: CrowdObstacle[], lights?: ChunkLight[]): void {
  if (lod >= 2) return; // the floor is near-field detail, like the patch quads
  const f = frame(fall.yaw);
  const tx = Math.cos(fall.yaw), tz = -Math.sin(fall.yaw);
  const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number, col: Vec3): void =>
    bld.pushBox([x, y, z], [hx, hy, hz], col, { rotationY: fall.yaw });
  // The B kit is rolled from the column's own seed, so it is deterministic and
  // independent of the village's stream.
  const kit = (c: FallColumn): void => pushBKit(bld, c, f, box, makeRng(c.seed ^ SALT));
  let lamps = 0;
  const lamp = (x: number, y: number, z: number): void => {
    // The head is emissive at every LOD; the pooled light is the near-field one.
    bld.pushBox([x, y, z], [0.14, 0.12, 0.14], LAMP, { rotationY: fall.yaw, emissive: 3.5 });
    if (!lights || lod >= 1 || lamps >= MAX_LAMPS) return;
    lights.push({ pos: [x, y, z], radius: LAMP_RADIUS, color: LAMP, intensity: LAMP_INTENSITY });
    lamps++;
  };
  let winches = 0;
  for (const c of fall.columns) {
    switch (c.access) {
      case 'stair-tower':
        stairTower(c, f, box, lamp, obstacles, tx, tz);
        kit(c);
        break;
      case 'winch': {
        const workshop = winches % 3 === 1;
        winches++;
        if (workshop) workshopYard(c, f, box, lamp, obstacles, tx, tz);
        else winchHouse(bld, c, f, box, lamp, obstacles, tx, tz);
        kit(c);
        break;
      }
      case 'core-stair':
        coreStairFoot(c, f, box, lamp, obstacles, tx, tz);
        break;
      default: break;
    }
  }
  for (const s of fall.stations) {
    const [hx, hz] = f.at(s[0], s[2], 0, 3.6);
    // The station box itself is fallmesh's; this is the hut beside it, the
    // queue rail that keeps the line off the hoist, and its lamp.
    box(hx, GROUND_Y + 1.5, hz, 1.3, 1.5, 1.1, HUT);
    box(hx, GROUND_Y + 3.15, hz, 1.5, 0.12, 1.3, ROOF);
    const [qx0, qz0] = f.at(s[0], s[2], -2.6, 2.6);
    const [qx1, qz1] = f.at(s[0], s[2], 2.6, 2.6);
    for (const [qx, qz] of [[qx0, qz0], [qx1, qz1]] as [number, number][]) box(qx, GROUND_Y + 0.5, qz, 0.06, 0.5, 0.06, STEEL);
    pushBeam(bld, [qx0, GROUND_Y + 0.95, qz0], [qx1, GROUND_Y + 0.95, qz1], 0.04, STEEL);
    lamp(hx, GROUND_Y + 3.4, hz);
  }
}

/** A scaffolding tower bolted up the pier's face, with its landing and rail. */
function stairTower(
  c: FallColumn, f: Frame,
  box: (x: number, y: number, z: number, hx: number, hy: number, hz: number, col: Vec3) => void,
  lamp: (x: number, y: number, z: number) => void,
  obstacles: CrowdObstacle[], tx: number, tz: number,
): void {
  const height = Math.min(14, Math.max(6, c.pileBase - GROUND_Y));
  const b0 = c.halfZ + 1.7;
  for (const sx of [-1.3, 1.3]) {
    for (const sz of [-1.3, 1.3]) {
      const [lx, lz] = f.at(c.x, c.z, sx, b0 + sz);
      box(lx, GROUND_Y + height / 2, lz, 0.08, height / 2, 0.08, STEEL);
    }
  }
  for (let y = 3; y < height; y += 3) {
    const [lx, lz] = f.at(c.x, c.z, 0, b0);
    box(lx, GROUND_Y + y, lz, 1.3, 0.05, 0.05, STEEL);
    box(lx, GROUND_Y + y, lz, 0.05, 0.05, 1.3, STEEL);
  }
  const [dx, dz] = f.at(c.x, c.z, 0, b0);
  box(dx, GROUND_Y + height - 0.1, dz, 1.5, 0.1, 1.5, TIMBER);
  for (const sx of [-1.4, 1.4]) {
    const [lx, lz] = f.at(c.x, c.z, sx, b0);
    box(lx, GROUND_Y + height + 0.5, lz, 0.05, 0.5, 0.05, STEEL);
  }
  box(dx, GROUND_Y + height + 0.98, dz, 1.4, 0.04, 0.04, STEEL);
  lamp(dx, GROUND_Y + height - 0.9, dz);
  obstacles.push({ x: dx, z: dz, tx, tz, halfAlong: 1.6, halfAcross: 1.6, minY: GROUND_Y, maxY: GROUND_Y + height, kind: 'fall-stair-tower-foot' });
}

/** The hut where the hoist cable lands: drum, cable up to the pile, door. */
function winchHouse(
  bld: MeshBuilder, c: FallColumn, f: Frame,
  box: (x: number, y: number, z: number, hx: number, hy: number, hz: number, col: Vec3) => void,
  lamp: (x: number, y: number, z: number) => void,
  obstacles: CrowdObstacle[], tx: number, tz: number,
): void {
  const b0 = c.halfZ + 2.9;
  const [hx, hz] = f.at(c.x, c.z, 0, b0);
  box(hx, GROUND_Y + 1.35, hz, 2.1, 1.35, 1.7, HUT);
  box(hx, GROUND_Y + 2.82, hz, 2.35, 0.12, 1.95, ROOF);
  const [dx, dz] = f.at(c.x, c.z, 0, b0 + 1.72);
  box(dx, GROUND_Y + 0.95, dz, 0.5, 0.95, 0.04, DOOR);
  // The drum sits beside the hut, its axis along the grid, and the cable runs
  // up to the pile the winch serves.
  const [sx, sz] = f.at(c.x, c.z, 2.9, b0 - 0.4);
  const [ex, ez] = f.at(c.x, c.z, 4.3, b0 - 0.4);
  bld.pushCylinder([sx, GROUND_Y + 0.55, sz], [ex, GROUND_Y + 0.55, ez], 0.42, 8, RUST, { capEnds: true });
  const [cx, cz] = f.at(c.x, c.z, 0, c.halfZ + 0.2);
  pushBeam(bld, [ex, GROUND_Y + 0.95, ez], [cx, c.pileBase + 2.5, cz], 0.025, CABLE);
  lamp(hx, GROUND_Y + 2.55, hz);
  obstacles.push({ x: hx, z: hz, tx, tz, halfAlong: 2.2, halfAcross: 1.8, minY: GROUND_Y, maxY: GROUND_Y + 3, kind: 'fall-winch-house' });
}

/** Every third winch: a bigger hut with the yard's sorted heaps. */
function workshopYard(
  c: FallColumn, f: Frame,
  box: (x: number, y: number, z: number, hx: number, hy: number, hz: number, col: Vec3) => void,
  lamp: (x: number, y: number, z: number) => void,
  obstacles: CrowdObstacle[], tx: number, tz: number,
): void {
  const r = makeRng(c.seed ^ (SALT + 1));
  const b0 = c.halfZ + 3.8;
  const [hx, hz] = f.at(c.x, c.z, 0, b0);
  box(hx, GROUND_Y + 1.7, hz, 3.2, 1.7, 2.2, HUT);
  box(hx, GROUND_Y + 3.5, hz, 3.5, 0.14, 2.5, ROOF);
  const [dx, dz] = f.at(c.x, c.z, 1.2, b0 + 2.22);
  box(dx, GROUND_Y + 1.0, dz, 0.6, 1.0, 0.04, DOOR);
  // Sorted heaps: steel, timber, cable — three grades, each its own pile.
  const heapCol = [STEEL, PALE_TIMBER, RUST];
  for (let k = 0; k < 3; k++) {
    const [px, pz] = f.at(c.x, c.z, -2.4 + k * 2.4 + r.jitter(0.4), b0 + 3.2 + r.jitter(0.5));
    const h = 0.35 + r.next() * 0.45;
    box(px, GROUND_Y + h, pz, 0.9 + r.next() * 0.5, h, 0.7 + r.next() * 0.4, heapCol[k]);
  }
  const [bx, bz] = f.at(c.x, c.z, 0, b0 + 2.2);
  box(bx, GROUND_Y + 0.45, bz, 1.1, 0.06, 0.4, PALE_TIMBER);
  for (const sx of [-0.9, 0.9]) {
    const [lx, lz] = f.at(c.x, c.z, sx, b0 + 2.2);
    box(lx, GROUND_Y + 0.22, lz, 0.07, 0.22, 0.35, TIMBER);
  }
  lamp(hx, GROUND_Y + 3.1, hz);
  obstacles.push({ x: hx, z: hz, tx, tz, halfAlong: 3.3, halfAcross: 2.3, minY: GROUND_Y, maxY: GROUND_Y + 3.6, kind: 'fall-salvage-workshop' });
}

/** A threshold and a door at the core's foot; the lit slots above are the village's. */
function coreStairFoot(
  c: FallColumn, f: Frame,
  box: (x: number, y: number, z: number, hx: number, hy: number, hz: number, col: Vec3) => void,
  lamp: (x: number, y: number, z: number) => void,
  obstacles: CrowdObstacle[], tx: number, tz: number,
): void {
  const b0 = c.halfZ + 0.9;
  const [dx, dz] = f.at(c.x, c.z, 0, b0);
  box(dx, GROUND_Y + 0.09, dz, 1.4, 0.09, 0.7, CONCRETE);
  box(dx, GROUND_Y + 1.35, dz, 1.0, 1.2, 0.09, DOOR);
  for (const sx of [-1.05, 1.05]) {
    const [jx, jz] = f.at(c.x, c.z, sx, b0);
    box(jx, GROUND_Y + 1.35, jz, 0.1, 1.35, 0.14, CONCRETE);
  }
  box(dx, GROUND_Y + 2.76, dz, 1.2, 0.09, 0.14, CONCRETE);
  lamp(dx, GROUND_Y + 3.1, dz);
  obstacles.push({ x: dx, z: dz, tx, tz, halfAlong: 1.3, halfAcross: 1.0, minY: GROUND_Y, maxY: GROUND_Y + 2.9, kind: 'fall-core-stair-foot' });
}

/** D30's B kit at the foot of a lifeline: barrels, pallets, a cable drum. */
function pushBKit(
  bld: MeshBuilder, c: FallColumn, f: Frame,
  box: (x: number, y: number, z: number, hx: number, hy: number, hz: number, col: Vec3) => void,
  r: Rng,
): void {
  const items = 3 + r.int(0, 2);
  for (let k = 0; k < items; k++) {
    const [px, pz] = f.at(c.x, c.z, r.range(-c.halfX - 1.2, c.halfX + 1.2), c.halfZ + r.range(1.2, 2.4));
    const kind = r.int(0, 2);
    if (kind === 0) {
      // Barrel, upright on its rim, with two rusty hoops.
      bld.pushCylinder([px, GROUND_Y, pz], [px, GROUND_Y + 0.86, pz], 0.29, 6, BARREL, { capEnds: true });
      bld.pushCylinder([px, GROUND_Y + 0.22, pz], [px, GROUND_Y + 0.28, pz], 0.3, 6, RUST);
      bld.pushCylinder([px, GROUND_Y + 0.62, pz], [px, GROUND_Y + 0.68, pz], 0.3, 6, RUST);
    } else if (kind === 1) {
      // Pallet: deck boards over three bearers, sometimes loaded.
      box(px, GROUND_Y + 0.16, pz, 0.6, 0.02, 0.5, PALE_TIMBER);
      for (const sz of [-0.42, 0, 0.42]) box(px, GROUND_Y + 0.08, pz + sz, 0.58, 0.06, 0.05, TIMBER);
      if (r.bool(0.5)) box(px, GROUND_Y + 0.34, pz, 0.5, 0.16, 0.4, TIMBER);
    } else {
      // Cable drum on its side: two discs and a core, axis along the grid.
      const [ax, az] = f.dir(1, 0);
      const off = 0.55;
      bld.pushCylinder([px - ax * off, GROUND_Y + 0.55, pz - az * off], [px + ax * off, GROUND_Y + 0.55, pz + az * off], 0.55, 8, TIMBER, { capEnds: true });
      bld.pushCylinder([px - ax * (off + 0.06), GROUND_Y + 0.55, pz - az * (off + 0.06)], [px + ax * (off + 0.06), GROUND_Y + 0.55, pz + az * (off + 0.06)], 0.18, 6, CABLE, { capEnds: true });
    }
  }
}

/** A thin beam between two world points — cable, rail, rebar. */
export function pushBeam(bld: MeshBuilder, a: Vec3, b: Vec3, radius: number, col: Vec3): void {
  bld.pushCylinder(a, b, radius, 3, col);
}
