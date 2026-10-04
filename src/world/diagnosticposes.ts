/**
 * Diagnostic camera poses derived from live world state (D21, PROCESS.md rule 4).
 *
 * This module exists because of the most expensive invisible failure in this
 * repository's history. `01b-crowd-closeup` and `01c-street-crowd` were typed in
 * at the world origin while the city and the crowd sit near (990, 25). They
 * reported an empty street, faithfully and in perfect detail, for two sessions:
 * first read as an entity-winding bug, then as a G-buffer culling bug. Both were
 * theories about the renderer, made because the diagnostic was pointing at
 * something a kilometre from its subject and nothing in the frame said so.
 *
 * A pose that cannot say where it is standing is a pose that lies. So every
 * pose built here carries a `source` record — the population it was derived
 * from, the carriageway it was placed on, the lateral offset from that
 * carriageway's centreline — and it is surfaced through `__syzygy.pose()` so
 * `--eval`, the console and the renderer all read the same numbers.
 *
 * The failure path is as important as the success path: when there is no
 * population to derive from, this returns `{ok: false}` with a reason and never
 * falls back to a constant. A fallback constant is exactly the bug that caused
 * F2, wearing a disguise.
 *
 * Pure: no GPU, no DOM, no sim state. The caller passes the numbers it read.
 */

import {
  cityPlan,
  sampleStreetPlan,
  footprintAabb,
  GROUND_Y,
  type CityPlan,
  type CityChunk,
  type StreetSample,
} from './citygen';
import { districtAtField, spinePoint } from './districts';
import { groundGrammarFor } from './groundgrammar';
import { marketGrammarFor, PITCH_MAX, RUN_MIN_M, type MarketStall } from './marketgrammar';
import { v3cross, v3norm, type Vec3 } from '../core/math';

/** The shape `CrowdSim.population()` returns; declared here so this file does not import the sim. */
export interface Population {
  n: number;
  cx: number;
  cz: number;
  spread: number;
  minY: number;
  maxY: number;
}

export type DerivedPoseId = 'street-crowd' | 'crowd-closeup' | 'facade-base' | 'kerb-face';

/** Where a pose is standing, and what it was derived from. */
export interface DerivedPoseSource {
  id: DerivedPoseId;
  seed: number;
  /** Live, as read at derivation time. */
  population: Population;
  /** The carriageway the camera is standing on. */
  carriageway: {
    kind: string;
    width: number;
    px: number;
    pz: number;
    tx: number;
    tz: number;
    /** Distance from the queried point to the centreline, before the footway offset. */
    dist: number;
    clearance: number;
  };
  /** Lateral metres from the centreline to the camera. Negative = right of travel. */
  footwayOffset: number;
  /**
   * Whether the pose's own subject is inside its own view cone, measured at
   * derivation time. `false` means `ok` is `false` and the shot must not run.
   */
  subjectInView: boolean;
  /** The pose's eye height above `GROUND_Y`, asserted to 0-12 m. */
  eyeHeight: number;
  /** Metres above `GROUND_Y`. */
  eye: number;
  /** Metres along the tangent the camera looks. */
  aimMetres: number;
  /** Horizontal distance from camera to the crowd centroid it was derived from. */
  distanceToCrowd: number;
  /** The samples that were rejected as too narrow to be worth the shot. */
  rejected: { x: number; z: number; kind: string; width: number }[];
  /**
   * District the subject stands in, when the pose is district-constrained
   * (kerb-face: one of the B districts). Absent for crowd poses, whose
   * subject is the population, not a district.
   */
  districtId?: number;
  /**
   * The emitted surfaces the kerb pose frames: kerb top, vertical face and
   * adjoining carriageway, each with a world position, plus the face/top
   * quad counts predicted from the walked segments on the camera side
   * (×2 for triangles, ×4 for vertices). A prediction from the walk, not a
   * bake readback — but the walk mirrors the emitter's own guards, which is
   * what makes it checkable instead of decorative. Absent for crowd poses.
   *
   * roadPoint is 2 m across the kerb line onto the carriageway — the surface
   * the frame actually contains — not the centreline, which sits half a road
   * width off-axis and fails any honest in-cone check on wide roads
   * (measured: it refused every wide arterial before this was corrected).
   */
  kerbRun?: {
    edge: [number, number];
    faceCentre: [number, number, number];
    topCentre: [number, number, number];
    roadPoint: [number, number];    kerbHeight: number;
    faceQuads: number;
    topQuads: number;
    walkedAhead: number;
    walkedBehind: number;
  };
}

export interface DerivedPose {
  ok: true;
  id: DerivedPoseId;
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  roll: number;
  source: DerivedPoseSource;
}

export interface DerivedPoseFailure {
  ok: false;
  id: DerivedPoseId;
  /**
   * Why the pose was refused. Set when the pose cannot see its own crowd subject
   * inside its own cone, or when its eye is not at street height. A caller that
   * ignores `ok` here is shooting a frame that was already rejected as empty.
   */
  reason: string;
  population: Population;
}

export type DerivedPoseResult = DerivedPose | DerivedPoseFailure;

// ------------------------------------------------------------------ tuning

/** Metres from a kerb to the camera. Wide enough to be on the footway, not in the road. */
const FOOTWAY_INSET = 1.5;
/** Clear of a canal centreline, which is water, not a place to stand. */
const CANAL_BANK = 3.0;
/** A carriageway narrower than this is an alley; fine for a close-up, poor for an avenue. */
const AVENUE_MIN_WIDTH = 20;
/** Probes along the tangent when looking for something wide enough to call an avenue. */
const AVENUE_PROBE_STEP = 55;
const AVENUE_PROBES = 4;
/**
 * How far the "find a wider street" probe may walk from the crowd centroid.
 *
 * Without this the probe happily returns a 31 m avenue 138 m from the crowd and
 * the camera stands on it — a wide empty road, framed correctly, with the
 * subject nowhere in the picture. That is F2 rebuilt inside the fix for F2, and
 * it reported `pedestrian:0` while claiming to be a crowd close-up. A narrow
 * street with a crowd in it beats a wide one without, every time.
 */
const AVENUE_LEASH = 80;

const SPECS: Record<DerivedPoseId, {
  eye: number; fov: number; aim: number; back: number; wide: boolean;
}> = {
  // 2.4 m on a footway looking down the tangent. The shot this project has never had.
  'street-crowd': { eye: 2.4, fov: 0.95, aim: 90, back: 0, wide: true },
  // Close on the centroid itself, so the frame is about people rather than a road.
  'crowd-closeup': { eye: 2.4, fov: 0.75, aim: 26, back: 26, wide: false },
  // Facade height on the same footway, aimed across the street and up. The
  // ground-contact check, on a carriageway instead of inside a lot.
  'facade-base': { eye: 6, fov: 1.05, aim: 34, back: 0, wide: true },
  // Kerb readability: eye/fov consumed by deriveKerbFace; aim/back are computed
  // from the kerb geometry itself (there is no crowd offset to apply).
  'kerb-face': { eye: 1.7, fov: 0.85, aim: 0, back: 0, wide: false },
};

/** Second scratch, so the traffic path cannot stomp the crowd path's. */
const scratch2 = (): StreetSample => ({
  dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
});

const scratch = (): StreetSample => ({
  dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
});

/**
 * Derive the kerb-readability pose from the live street field.
 *
 * The reviewer could not tell a raised kerb from a painted stripe, and none
 * of the existing poses can answer it: `01d` looks down the street (the kerb
 * is a line), `01f` looks across and up (buildings, not kerbs). This stands
 * on the footway ~2.4 m past a real kerb line and looks obliquely along it,
 * so one frame holds pavement, vertical face and carriageway together.
 *
 * The kerb is FOUND, not typed in. A fixed lattice over the street field is
 * scanned for a street/artery in a B district whose grammar gives it a real
 * kerb face, with a straight 20 m run (same kind, same width — the same
 * guards `traceOne` walks under, so a traced kerb exists where this points).
 * No kerb in bounds refuses loudly; there is no fallback coordinate, for the
 * usual reason (F2).
 *
 * Constrained to B districts (glass-foxholes, rust-hangars, canal-district)
 * on purpose: the review that motivated this pose is about kerb edges, and
 * B's sheet is the one whose stair and kerb edges are the reference. The
 * district is recorded in provenance, so any other use is auditable, and
 * `compare.mjs --auto` needs a `kerb-face` key in `references/sections.json`
 * before this row resolves against a sheet (not added here).
 */
const KERB_DISTRICTS = [3, 5, 9];
const KERB_SCAN_STEP = 32;
const KERB_SCAN_EXTENT = 1024;
const KERB_MIN_WIDTH = 20;
/**
 * How far past the kerb line the camera stands. 1.2 m is on every footway
 * (narrowest authored is 2.2 m) and provably outside every conforming facade:
 * `makeBuilding` shrinks each footprint to `room = clearance − 1.6`, so a
 * facade face stands ≥ 1.6 m past its road's edge, and lean is a shear that is
 * zero at the base. 2.4 m would frame more pavement but gambles 0.8 m of that
 * guarantee on roads the lot was not placed against.
 */
const KERB_CAM_SIDE = 1.2;
const KERB_CAM_BACK = 2.8;
const KERB_LOOK_AHEAD = 2.5;
const KERB_WALK_STEP = 5;

function deriveKerbFace(seed: number, pop: Population): DerivedPoseResult {
  const id: DerivedPoseId = 'kerb-face';
  const spec = SPECS[id];
  const plan: CityPlan = cityPlan(seed);
  const s = scratch();
  const probe = scratch();
  const rejected: DerivedPoseSource['rejected'] = [];

  interface KerbHit { x: number; z: number; kind: string; width: number; district: number; kh: number; fx: number; fz: number; lx: number; lz: number; ahead: number; behind: number }
  // Two passes: grid streets first, arterials only if no street qualifies.
  // Arterials wander and weave between parallel roads, so their kerb emission
  // is intermittent even where the field is continuous (measured: 0 face
  // verts <5 m at the edge with 16 at −15 m, parallel street 20 m away).
  const consider = (gx: number, gz: number, wantKind: 'street' | 'artery'): KerbHit | null => {
    sampleStreetPlan(plan, gx, gz, s);
    if (s.kind !== wantKind) return null;
    if (s.width < KERB_MIN_WIDTH) {
      if (rejected.length < 8) rejected.push({ x: gx, z: gz, kind: s.kind, width: s.width });
      return null;
    }
    const districtId = districtAtField(plan.districts, gx, gz);
    if (!KERB_DISTRICTS.includes(districtId)) return null;
    const grammar = groundGrammarFor(districtId, s.kind);
    // 'bollard-line' (market) is posts, not a face; everything else in the
    // enum is raised geometry groundbake emits a face for.
    if (grammar.kerb === 'bollard-line') return null;
    const nx0 = -s.tz, nz0 = s.tx;
    const ex0 = s.px + nx0 * s.width * 0.5, ez0 = s.pz + nz0 * s.width * 0.5;
    // Uncontested OUTWARD only (the footway side the camera stands on): no
    // second carriageway intruding on the kerb's own band. Step out from the
    // edge; every sample must stay on this road with a clearance near its
    // stepped distance. (The inward side crosses the carriageway itself, so
    // checking it would reject every road in the city.) A parallel road
    // close enough to steal the footway dedupe cells fails here (measured
    // cause of patchy emission on an otherwise continuous arterial).
    for (const dd of [2, 4, 6, 8, 10]) {
      sampleStreetPlan(plan, ex0 + nx0 * dd, ez0 + nz0 * dd, probe);
      if (probe.kind !== s.kind || probe.clearance < dd - 3) {
        if (rejected.length < 8) rejected.push({ x: gx, z: gz, kind: s.kind, width: s.width });
        return null;
      }
    }
    // Walk + total tangent rotation: the kerb the trace walks must still be
    // this road 30 m ahead and 10 m behind, on the same heading. The
    // projection-jump guard this mirrors is vacuous as written (it compares
    // a step to itself), so rotation is measured directly: >15° over the
    // walk means a corner or a wanderer, and corner-turning kerbs are a
    // different picture from a straight run.
    let turn = 0;
    let ptx = s.tx, ptz = s.tz;
  // Straight run: the kerb the trace walks must still be this road 10 m
  // either way, or the edge point belongs to a junction, not a kerb line.
  const KERB_WALK_STEPS = 8;
  // The camera looks ahead (+tangent): the kerb it judges is the one in
  // front of it, so the ahead run carries the bar and the behind run only
  // needs the near context. Symmetric bars verified kerb somewhere around
  // the edge point while the frame showed a gap ahead of it (measured: 6
  // face verts within 10 m with an 81% total walk).
  const KERB_AHEAD_MIN = 30;
  const KERB_BEHIND_MIN = 10;
  let walkOk = true;
  // First and last centreline points of the ahead walk: the camera looks
  // along the VERIFIED run, not the anchor tangent, so a bending road cannot
  // aim the frame away from the kerb that was checked.
  let wFirstX = 0, wFirstZ = 0, wLastX = 0, wLastZ = 0;
  let wCount = 0, wAhead = 0, wBehind = 0;
  for (const [dir, need] of [[1, KERB_AHEAD_MIN], [-1, KERB_BEHIND_MIN]] as const) {
    let qx = s.px, qz = s.pz, walked = 0;
    for (let k = 0; k < KERB_WALK_STEPS; k++) {
      // All three of traceOne's termination guards, mirrored exactly: kind,
      // width within 1.5 m, and the projection jump. The ±10 m two-point check
      // this replaced passed on a curving arterial whose trace dies after a
      // few 5 m steps — the pose then photographed a kerb gap (measured: no
      // kerb-face verts within 10 m of the edge, trace walk holding 28%).
      sampleStreetPlan(plan, qx, qz, probe);
      if (probe.kind !== s.kind || Math.abs(probe.width - s.width) > 1.5) { walkOk = false; break; }
      // Tangent rotation over the walk, in radians. The jump guard above is
      // vacuous as written (it compares a step to itself — 5.0 < 8.0 always,
      // in groundbake too), so straightness is measured here instead: more
      // than 15° total means a corner or a wanderer.
      turn += Math.acos(Math.min(1, Math.max(-1, ptx * probe.tx + ptz * probe.tz)));
      ptx = probe.tx; ptz = probe.tz;
      if (turn > 0.26) { walkOk = false; break; }
      const nx = probe.px + probe.tx * KERB_WALK_STEP * dir;
      const nz = probe.pz + probe.tz * KERB_WALK_STEP * dir;
      if (Math.hypot(nx - probe.px, nz - probe.pz) > KERB_WALK_STEP * 1.5 + 0.5) { walkOk = false; break; }
      walked += KERB_WALK_STEP;
      if (dir > 0) {
        if (wCount === 0) { wFirstX = probe.px; wFirstZ = probe.pz; }
        wLastX = nx; wLastZ = nz;
        wCount++;
      }
      qx = nx; qz = nz;
    }
    if (walked < need) walkOk = false;
    else if (dir > 0) wAhead = walked;
    else wBehind = walked;
    if (!walkOk) break;
  }
  if (!walkOk) {
    if (rejected.length < 8) rejected.push({ x: gx, z: gz, kind: s.kind, width: s.width });
    return null;
  }
  return { x: gx, z: gz, kind: s.kind, width: s.width, district: districtId, kh: grammar.kerbHeight, fx: wFirstX, fz: wFirstZ, lx: wLastX, lz: wLastZ, ahead: wAhead, behind: wBehind };
  };
  let hit: KerbHit | null = null;
  for (const wantKind of ['street', 'artery'] as const) {
    for (let r = 0; r <= KERB_SCAN_EXTENT && !hit; r += KERB_SCAN_STEP) {
      if (r === 0) { hit = consider(0, 0, wantKind); continue; }
      for (let e = -r; e <= r && !hit; e += KERB_SCAN_STEP) {
        hit = consider(e, -r, wantKind) ?? consider(e, r, wantKind)
          ?? consider(-r, e, wantKind) ?? consider(r, e, wantKind);
      }
    }
    if (hit) break;
  }
  if (!hit) {
    return {
      ok: false, id, population: { ...pop },
      reason: `no street/artery with a kerb face in a B district within ±${KERB_SCAN_EXTENT} m ` +
        `(step ${KERB_SCAN_STEP} m, width ≥ ${KERB_MIN_WIDTH} m) — refusing rather than guessing`,
    };
  }
  const found = { x: hit.x, z: hit.z };
  const foundKind = hit.kind;
  const foundWidth = hit.width;
  const foundDistrict = hit.district;

  // Re-sample at the anchor so the frame below reads the road, not the lattice.
  sampleStreetPlan(plan, found.x, found.z, s);
  const { tx, tz } = s;
  const nx = -tz, nz = tx;
  const half = s.width * 0.5;
  const ex = s.px + nx * half, ez = s.pz + nz * half;
  let lx = tx, lz = tz;
  {
    const ll = Math.hypot(hit.lx - hit.fx, hit.lz - hit.fz);
    if (ll > 1e-3) { lx = (hit.lx - hit.fx) / ll; lz = (hit.lz - hit.fz) / ll; }
  }
  const position: [number, number, number] = [
    ex + nx * KERB_CAM_SIDE - lx * KERB_CAM_BACK,
    GROUND_Y + spec.eye,
    ez + nz * KERB_CAM_SIDE - lz * KERB_CAM_BACK,
  ];
  const lookAt: [number, number, number] = [
    ex + lx * KERB_LOOK_AHEAD,
    GROUND_Y + 0.25,
    ez + lz * KERB_LOOK_AHEAD,
  ];

  // Self-check: every named surface must be inside its own cone — the kerb
  // edge, the vertical-face band centre, the kerb-top band centre and the
  // adjoining carriageway point. Same arithmetic as derivePose's subject
  // check. A pose that cannot see its own face has no position worth handing
  // back: the reviewer asked for top, face and road in one frame, and "the
  // edge is in-frame" alone is how the last capture missed the face.
  // KERB_TOP_W mirrors groundbake.ts KERB_W (0.30 m); duplicated, not
  // imported, so this module keeps no edge into the renderer.
  const KERB_TOP_W = 0.30;
  const kh = hit.kh;
  const faceCentre: [number, number, number] = [ex, GROUND_Y + kh * 0.5, ez];
  const topCentre: [number, number, number] = [
    ex + nx * KERB_TOP_W * 0.5, GROUND_Y + kh, ez + nz * KERB_TOP_W * 0.5,
  ];
  const roadPoint: [number, number] = [ex - nx * 2.0, ez - nz * 2.0];
  const dx = lookAt[0] - position[0], dy = lookAt[1] - position[1], dz = lookAt[2] - position[2];
  const dl = Math.hypot(dx, dy, dz) || 1;
  const fx = dx / dl, fy = dy / dl, fz = dz / dl;
  const inCone = (px: number, py: number, pz: number, extent: number): { along: number; perp: number; reach: number; inside: boolean } => {
    const sx = px - position[0], sy = py - position[1], sz = pz - position[2];
    const along = sx * fx + sy * fy + sz * fz;
    const perp = Math.hypot(sx - fx * along, sz - fz * along);
    const reach = Math.tan(Math.min(Math.PI * 0.45, spec.fov * 0.75)) * Math.max(along, 1);
    return { along, perp, reach, inside: along > 0 && perp <= reach + extent };
  };
  const edgeIn = inCone(ex, GROUND_Y + 0.25, ez, 2);
  const faceIn = inCone(faceCentre[0], faceCentre[1], faceCentre[2], 1);
  const topIn = inCone(topCentre[0], topCentre[1], topCentre[2], 1);
  const roadIn = inCone(roadPoint[0], GROUND_Y, roadPoint[1], 2);
  const subjectInView = edgeIn.inside && faceIn.inside && topIn.inside && roadIn.inside;
  const eyeHeight = +(position[1] - GROUND_Y).toFixed(2);
  if (!subjectInView || !(eyeHeight > 0 && eyeHeight < 12)) {
    const miss = !edgeIn.inside ? `edge ${edgeIn.perp.toFixed(1)} m off-axis`
      : !faceIn.inside ? `face band ${faceIn.perp.toFixed(1)} m off-axis`
      : !topIn.inside ? `kerb top ${topIn.perp.toFixed(1)} m off-axis`
      : `road point ${roadIn.perp.toFixed(1)} m off-axis`;
    return {
      ok: false, id, population: { ...pop },
      reason: `derived kerb at (${ex.toFixed(1)}, ${ez.toFixed(1)}): ${miss} ` +
        `(reach ${edgeIn.reach.toFixed(1)} m) — refusing a pose that cannot see its own face`,
    };
  }

  const lateral = half + KERB_CAM_SIDE;
  const faceQuads = Math.round((hit.ahead + hit.behind) / KERB_WALK_STEP);
  return {
    ok: true,
    id,
    position,
    lookAt,
    fov: spec.fov,
    roll: 0,
    source: {
      id,
      seed,
      population: { ...pop },
      carriageway: {
        kind: foundKind, width: +foundWidth.toFixed(2),
        px: +s.px.toFixed(1), pz: +s.pz.toFixed(1),
        tx: +tx.toFixed(4), tz: +tz.toFixed(4),
        dist: +s.dist.toFixed(2), clearance: +s.clearance.toFixed(2),
      },
      footwayOffset: +lateral.toFixed(2),
      eye: spec.eye,
      aimMetres: +Math.hypot(lookAt[0] - position[0], lookAt[2] - position[2]).toFixed(1),
      distanceToCrowd: pop.n > 0
        ? +Math.hypot(position[0] - pop.cx, position[2] - pop.cz).toFixed(1)
        : -1,
      subjectInView, eyeHeight,
      rejected,
      districtId: foundDistrict,
      kerbRun: {
        edge: [+ex, +ez],
        faceCentre: [+faceCentre[0], +faceCentre[1], +faceCentre[2]],
        topCentre: [+topCentre[0], +topCentre[1], +topCentre[2]],
        roadPoint: [+roadPoint[0], +roadPoint[1]],
        kerbHeight: +kh.toFixed(3),
        faceQuads,
        topQuads: faceQuads,
        walkedAhead: hit.ahead,
        walkedBehind: hit.behind,
      },
    },
  };
}

/**
 * Derive a diagnostic pose from the live crowd population and the street plan.
 *
 * `cx`/`cz` come from `CrowdSim.population()`, which is live: the crowd is
 * seeded forward of the camera in its own view basis, so the centroid tracks
 * wherever the viewer is looking and reading it is the only way to stand next
 * to it. From there the pose is placed on a real carriageway from
 * `sampleStreetPlan` — a centroid alone is not enough, because a centroid can be
 * mid-block, and a camera mid-block at 2.4 m photographs a wall.
 */
export function derivePose(id: DerivedPoseId, pop: Population, seed: number): DerivedPoseResult {
  const spec = SPECS[id];
  if (!spec) return { ok: false, id, reason: `no such derived pose '${id}'`, population: pop };
  if (!(pop.n > 0)) {
    // Deliberately no fallback. Returning a constant here would recreate F2.
    return {
      ok: false, id, population: pop,
      reason: `crowd population is empty (n=${pop.n}) — nothing to point at; ` +
        'this is a state bug, not something to paper over with a typed-in coordinate',
    };
  }
  if (!Number.isFinite(pop.cx) || !Number.isFinite(pop.cz)) {
    return { ok: false, id, population: pop, reason: `population centroid is not finite (${pop.cx}, ${pop.cz})` };
  }

  // The kerb pose derives from the street field, not the crowd — but it still
  // takes the population for provenance, and still refuses on an empty one,
  // because a pose shot before anything is settled is a pose of nowhere.
  if (id === 'kerb-face') return deriveKerbFace(seed, pop);

  const plan: CityPlan = cityPlan(seed);
  const s = sampleStreetPlan(plan, pop.cx, pop.cz, scratch());
  const rejected: DerivedPoseSource['rejected'] = [];

  // Prefer a street to an alley for the wide shots. The centroid's nearest
  // carriageway can be an 11 m alley even when a 28 m avenue is 50 m away, and
  // "looking down an avenue" from an alley is a different, worse picture. Both
  // are real carriageways; the wider one is what the label claims.
  let chosen = s;
  if (spec.wide && s.width < AVENUE_MIN_WIDTH) {
    rejected.push({ x: s.px, z: s.pz, kind: s.kind, width: s.width });
    for (let i = 1; i <= AVENUE_PROBES; i++) {
      let took = false;
      for (const sign of [1, -1]) {
        const qx = pop.cx + s.tx * AVENUE_PROBE_STEP * i * sign;
        const qz = pop.cz + s.tz * AVENUE_PROBE_STEP * i * sign;
        if (Math.hypot(qx - pop.cx, qz - pop.cz) > AVENUE_LEASH) continue;
        const probe = sampleStreetPlan(plan, qx, qz, scratch());
        rejected.push({ x: probe.px, z: probe.pz, kind: probe.kind, width: probe.width });
        if (probe.width >= AVENUE_MIN_WIDTH
          && Math.hypot(probe.px - pop.cx, probe.pz - pop.cz) <= AVENUE_LEASH) {
          chosen = probe;
          took = true;
          break;
        }
      }
      if (took) break;
    }
  }

  const { tx, tz } = chosen;
  // Left normal of the tangent. Everything lateral is measured along it, so the
  // offset means the same thing whichever way the street happens to run.
  const nx = -tz;
  const nz = tx;
  // A canal centreline is water. Stand on the bank or the camera is in the river.
  const lateral = chosen.kind === 'canal'
    ? chosen.width * 0.5 + CANAL_BANK
    : Math.max(1.2, chosen.width * 0.5 - FOOTWAY_INSET);

  const eye = GROUND_Y + spec.eye;
  const px = chosen.px + nx * lateral;
  const pz = chosen.pz + nz * lateral;

  let position: [number, number, number];
  let lookAt: [number, number, number];

  if (id === 'crowd-closeup') {
    // Stand back along the tangent and aim at the centroid at head height.
    // The centroid is the subject, so it is the target — not a guess at a height.
    position = [px - tx * spec.back, eye, pz - tz * spec.back];
    lookAt = [pop.cx, GROUND_Y + 1.7, pop.cz];
  } else if (id === 'facade-base') {
    position = [px, eye, pz];
    // Across the carriageway and up at the facade line, which is the thing
    // `01a-building-base` was supposed to show meeting the ground.
    lookAt = [px - nx * spec.aim, GROUND_Y + spec.aim * 0.65, pz - nz * spec.aim];
  } else {
    position = [px, eye, pz];
    lookAt = [chosen.px + tx * spec.aim, GROUND_Y + 2.2, chosen.pz + tz * spec.aim];
  }

  // Does this pose actually see its own subject?
  //
  // `distanceToCrowd` was true when measured and the frame was still empty: the
  // derived pose was correct and the *camera* left it before the shot, so a
  // correct pose was scored as a broken one. That is the harness's held-camera
  // problem and cannot be caught here. What CAN be caught here is a pose born
  // blind to its own subject, and refusing it loudly beats shipping an empty
  // street for a reviewer to score.
  //
  // The subject is not the centroid. A corridor pose like `street-crowd` looks
  // *along* the street, so the centroid sits tens of degrees off-axis by design,
  // and testing the centroid alone refuses a legitimate pose -- measured, and the
  // first version of this check did exactly that. What matters is whether the
  // crowd's *spread* reaches the view corridor. So: perpendicular distance from
  // the centroid to the view axis, against the spread plus the cone's own reach.
  const dx = lookAt[0] - position[0], dy = lookAt[1] - position[1], dz = lookAt[2] - position[2];
  const dl = Math.hypot(dx, dy, dz) || 1;
  const fx = dx / dl, fy = dy / dl, fz = dz / dl;
  const sx = pop.cx - position[0], sy = (GROUND_Y + 1.7) - position[1], sz = pop.cz - position[2];
  const along = sx * fx + sy * fy + sz * fz;
  // Perpendicular offset from the view axis, in the horizontal plane.
  const perp = Math.hypot(sx - fx * along, sz - fz * along);
  // How far the cone itself reaches sideways at the subject's distance.
  const reach = Math.tan(Math.min(Math.PI * 0.45, spec.fov * 0.75)) * Math.max(along, 1);
  // The corridor a corridor pose is allowed to miss by, is the spread itself.
  const subjectInView = along > 0 && perp <= reach + Math.max(pop.spread, 1);
  // The eye must be near the deck. `eye = GROUND_Y + spec.eye` bounds this inside
  // derivePose; the bound is asserted rather than assumed, because a camera at
  // y=434 has been reported against this function's output.
  const eyeHeight = +(position[1] - GROUND_Y).toFixed(2);
  const eyePlausible = eyeHeight > 0 && eyeHeight < 12;

  if (!subjectInView || !eyePlausible) {
    // The failure shape carries only what a caller needs to *report* the refusal.
    // A pose that cannot see its subject has no position worth handing back: a
    // caller that ignored `ok` would be shooting the thing we just rejected.
    return {
      ok: false,
      id,
      reason: !eyePlausible
        ? `eye height ${eyeHeight} m above the deck is not a street pose (allowed 0-12 m)`
        : `crowd is ${perp.toFixed(1)} m off the view axis at ${along.toFixed(1)} m, outside the ${(reach + pop.spread).toFixed(1)} m reach (spread ${pop.spread} m)`,
      population: { ...pop },
    };
  }

  return {
    ok: true,
    id,
    position,
    lookAt,
    fov: spec.fov,
    roll: 0,
    source: {
      id,
      seed,
      population: { ...pop },
      carriageway: {
        kind: chosen.kind, width: +chosen.width.toFixed(2),
        px: +chosen.px.toFixed(1), pz: +chosen.pz.toFixed(1),
        tx: +chosen.tx.toFixed(4), tz: +chosen.tz.toFixed(4),
        dist: +chosen.dist.toFixed(2), clearance: +chosen.clearance.toFixed(2),
      },
      footwayOffset: +lateral.toFixed(2),
      eye: spec.eye,
      aimMetres: spec.aim,
      distanceToCrowd: +Math.hypot(position[0] - pop.cx, position[2] - pop.cz).toFixed(1),
      subjectInView, eyeHeight,
      rejected,
    },
  };
}

/** Ground height the city is built on, re-exported so callers need one import. */
export { GROUND_Y };
// ---------------------------------------------------------------- traffic poses

/**
 * Diagnostic poses derived from live vehicle positions (D21, PROCESS.md rule 4).
 *
 * `03-tram-level` is the reason this file exists twice over: it is anchored at
 * the world origin and claims a statement about tram height that it cannot
 * support from a kilometre away. Its label was corrected; its *name* could not
 * be, because `sections.json` maps `tram-level` to a section and
 * `compare.mjs --auto` matches on it. So the fix is a pose that goes to the
 * traffic rather than a rename that breaks the comparison grid.
 *
 * Appended rather than folded into {@link derivePose}: the crowd path and this
 * one derive from different live sources, and the crowd path has a reviewer.
 */

/** The shape this file needs from a vehicle, so it does not import the sim. */
export interface TrafficVehicle {
  kind: string;
  position: Vec3;
  velocity: Vec3;
  speed: number;
  alive: boolean;
}

export type TrafficPoseId = 'tram-level' | 'cable-car';

/** Where a traffic pose is standing, and the vehicle it was built from. */
export interface TrafficPose {
  ok: true;
  id: TrafficPoseId;
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  roll: number;
  /** The vehicle the camera is standing for, read live at derivation time. */
  vehicle: { kind: string; position: [number, number, number]; speed: number };
  /** Camera to vehicle, metres. The whole point of printing this. */
  distanceToVehicle: number;
  /** The carriageway the camera is standing on, when it stands on one. */
  carriageway: { kind: string; width: number; px: number; pz: number } | null;
  /** Every live vehicle of the kinds this pose considers. */
  considered: number;
  /** Why a candidate was turned down. Empty is a bad sign. */
  rejected: { kind: string; reason: string }[];
}

export interface TrafficPoseFailure {
  ok: false;
  id: TrafficPoseId;
  reason: string;
  considered: number;
  rejected: { kind: string; reason: string }[];
}

export type TrafficPoseResult = TrafficPose | TrafficPoseFailure;

/** How far off the vehicle the camera stands, metres. */
const TRAM_STANDOFF = 15;
const TRAM_EYE = 2.2;
/**
 * Where the camera looks, as a multiple of the vehicle's own tangent.
 *
 * Negative: *behind* the tram, so it is in the middle distance and moving
 * toward the camera. Looking 34 m ahead — the first attempt — framed the
 * street and left the tram at the edge of frame, and looking straight at the
 * vehicle's own position puts a 12 m bus dead centre filling the frame. Six
 * metres back is a street view with the tram in it.
 */
const TRAM_LOOK_BEHIND = 6;
const CABLE_STANDOFF = 45;
const CABLE_DROP = 34;

/** Unit tangent of a vehicle, from its velocity; level when it is stopped. */
function tangentOf(v: TrafficVehicle): [number, number] {
  const l = Math.hypot(v.velocity[0], v.velocity[2]);
  if (l < 1e-3) return [1, 0];
  return [v.velocity[0] / l, v.velocity[2] / l];
}

const round3 = (n: number): number => +n.toFixed(3);

/**
 * A camera pointed at the traffic, from the traffic.
 *
 * Picks the fastest live vehicle of the kind, stands off it by a fixed
 * distance, and looks at a point *ahead* of it rather than at its own
 * position: a camera pointed at a moving tram from directly abeam frames it for
 * one frame and then watches it leave. `rejected` says why every other
 * candidate was passed over, because "no tram found" and "no tram near the
 * camera" are the same empty frame and only one of them is a bug.
 */
export function deriveTrafficPose(
  id: TrafficPoseId, vehicles: readonly TrafficVehicle[], seed: number,
): TrafficPoseResult {
  const scratch = scratch2();
  const rejected: { kind: string; reason: string }[] = [];
  const live = vehicles.filter((v) => v.alive);
  const wanted = id === 'tram-level'
    ? new Set(['tram', 'trolley', 'funicular'])
    : new Set(['cablecar']);

  let best: TrafficVehicle | null = null;
  let considered = 0;
  for (const v of live) {
    if (!wanted.has(v.kind)) continue;
    considered++;
    const finite = Number.isFinite(v.position[0]) && Number.isFinite(v.position[1])
      && Number.isFinite(v.position[2]);
    if (!finite) { rejected.push({ kind: v.kind, reason: 'non-finite position' }); continue; }
    // A tram mid-dwell has speed 0 and is a stationary red box; the moving one
    // is the one that says anything about whether the thing is alive.
    if (!best || v.speed > best.speed) best = v;
  }
  if (!best) {
    return {
      ok: false, id,
      reason: `no live ${[...wanted].join('/')} among ${live.length} live vehicles`,
      considered, rejected,
    };
  }

  const v = best;
  const [tx, tz] = tangentOf(v);
  // Left of the tangent, in the XZ plane.
  const nx = -tz, nz = tx;
  let camX: number, camZ: number, camY: number, lookX: number, lookZ: number, lookY: number;
  let fov: number;
  let carriageway: TrafficPose['carriageway'] = null;

  if (id === 'tram-level') {
    camX = v.position[0] + nx * TRAM_STANDOFF;
    camZ = v.position[2] + nz * TRAM_STANDOFF;
    lookX = v.position[0] - tx * TRAM_LOOK_BEHIND;
    lookZ = v.position[2] - tz * TRAM_LOOK_BEHIND;
    // Stand on the ground, not on the rail: the vehicle's own y is the rail
    // height and the street is a metre below it.
    camY = GROUND_Y + TRAM_EYE;
    lookY = GROUND_Y + 1.6;
    fov = 0.95;
    const s = sampleStreetPlan(cityPlan(seed), camX, camZ, scratch);
    carriageway = { kind: s.kind, width: round3(s.width), px: round3(s.px), pz: round3(s.pz) };
    if (s.clearance > 0) {
      // In the buildings. Move in to the nearest carriageway edge and say so.
      rejected.push({ kind: v.kind, reason: `stand-off point ${s.clearance.toFixed(1)} m off the carriageway` });
    }
  } else {
    camX = v.position[0] + nx * CABLE_STANDOFF;
    camZ = v.position[2] + nz * CABLE_STANDOFF;
    camY = v.position[1] - CABLE_DROP;
    lookX = v.position[0];
    lookZ = v.position[2];
    lookY = v.position[1];
    fov = 1.1;
    if (camY < GROUND_Y + 6) {
      rejected.push({ kind: v.kind, reason: `cable car is only ${camY.toFixed(1)} m up; nothing to stand below` });
    }
  }

  return {
    ok: true, id,
    position: [round3(camX), round3(camY), round3(camZ)],
    lookAt: [round3(lookX), round3(lookY), round3(lookZ)],
    fov, roll: 0,
    vehicle: {
      kind: v.kind,
      position: [round3(v.position[0]), round3(v.position[1]), round3(v.position[2])],
      speed: round3(v.speed),
    },
    distanceToVehicle: round3(Math.hypot(v.position[0] - camX, v.position[1] - camY, v.position[2] - camZ)),
    carriageway, considered, rejected,
  };
}


export type HeroWalkId = 'hero-walk';

export interface HeroRun {
  startAlong: number;
  endAlong: number;
  stalls: number;
  side: 'right';
  approachStart: number;
  approachEnd: number;
  exitStart: number;
  exitEnd: number;
  /** Signed lateral of the counter line, measured along +view-right. */
  counterEdge: number;
  /** Signed lateral of the walking-strip centre. */
  corridorLateral: number;
}

export interface HeroWalkSource {
  id: HeroWalkId;
  seed: number;
  run: HeroRun;
  /** Spine-parameter interval actually evaluated. */
  evaluatedFrom: number;
  evaluatedTo: number;
  chunksEvaluated: number;
  /** Spine chunks in range that were not provided — empty when ok. */
  chunksMissing: string[];
  /** Stall slots examined vs emitted, across the evaluated chunks. */
  slotsExamined: number;
  stallsEmitted: number;
  splits: number;
  /** Runs seen before selection (short + unbounded skips explain the gap). */
  runsTotal: number;
  skippedShort: number;
  skippedUnbounded: number;
  corridorBlockedAt: number | null;
  eyeHeight: number;
  /** Horizontal metres camera to exit aim. */
  aimMetres: number;
}

export interface HeroWalk {
  ok: true;
  id: HeroWalkId;
  position: [number, number, number];
  lookAt: [number, number, number];
  fov: number;
  roll: number;
  source: HeroWalkSource;
}

export interface HeroWalkFailure {
  ok: false;
  id: HeroWalkId;
  reason: string;
  evaluatedFrom: number;
  evaluatedTo: number;
  chunksMissing: string[];
}

export type HeroWalkResult = HeroWalk | HeroWalkFailure;

/** Spine-parameter interval evaluated for the hero run. */
const HERO_EVAL_LO = -200;
const HERO_EVAL_HI = 1200;
/** A run shorter than the grammar's own minimum run is not a run. */
const HERO_MIN_RUN = RUN_MIN_M;
/** Consecutive stall starts further apart than this are two runs. */
const HERO_SPLIT_GAP = PITCH_MAX * 1.5;
/** Approach/exit openings are read at most this far from the run. */
const HERO_OPENING_WINDOW = 100;
/** Corridor half-depth each side of its centre lateral. */
const HERO_CORRIDOR_HALF = 1.5;
/** Neutral standing-eye landmark above the walking surface. */
const HERO_EYE = 1.6;
/** The existing market lens. */
const HERO_FOV = 1.05;
/** Building footprint pad for the corridor-blocked test. */
const HERO_BLOCK_PAD = 1.0;

/**
 * Derive Market Spine Counter Walk from emitted stall geometry (D21).
 *
 * Selection rule, implemented literally from HERO_FRAME_SPEC: from the live
 * market spine's parameter origin, travel in increasing `along` and select
 * the earliest right-hand emitted stall run downstream, with approach gap,
 * exit gap and complete emission coverage known. "Right" is classified
 * against the m4lookAt view basis (screen-right = up × −forward), never
 * from the `side` field's sign or a comment calling a normal "left".
 *
 * Runs are maximal consecutive emitted slots: consecutive stall starts more
 * than PITCH_MAX×1.5 apart are two runs (ordinary seams do not split; the
 * threshold is where an omitted slot must lie). Complete means known from
 * beginning to end — bounded openings observed or evaluated-empty on both
 * sides, every owning chunk evaluated — never attractive or populated.
 *
 * The camera stands in the approach opening on the counter-front corridor
 * centre at standing eye height and aims at the corridor centre in the exit
 * opening. A blocked corridor, a missing chunk, or no complete run refuses
 * loudly: per the spec a blocked corridor reports instead of advancing, and
 * framing that hides the strip is a failure, not a fallback.
 *
 * Wiring note: the caller passes resident chunks (main.ts owns the City).
 * Nothing here touches the GPU, the sim, or the capture harness.
 */
export function deriveHeroWalk(plan: CityPlan, seed: number, chunks: CityChunk[]): HeroWalkResult {
  const id: HeroWalkId = 'hero-walk';
  const m = plan.districts.market;
  // 1. Spine chunks in range.
  const want = new Map<string, { cx: number; cz: number }>();
  for (let a = HERO_EVAL_LO; a <= HERO_EVAL_HI; a += 8) {
    const p = spinePoint(m, a);
    const cx = Math.floor(p[0] / 256), cz = Math.floor(p[1] / 256);
    want.set(`${cx},${cz}`, { cx, cz });
  }
  const have = new Map<string, CityChunk>();
  for (const c of chunks) have.set(`${c.cx},${c.cz}`, c);
  const missing = [...want.keys()].filter((k) => !have.has(k));
  if (missing.length > 0) {
    return {
      ok: false, id, evaluatedFrom: HERO_EVAL_LO, evaluatedTo: HERO_EVAL_HI,
      chunksMissing: missing,
      reason: `${missing.length} spine chunks unevaluated (${missing.slice(0, 4).join(' ')}) — ` +
        `a chunk edge is an unknown boundary, not a market gap`,
    };
  }
  // 2. Stalls per chunk, through the same query the market bake uses.
  const UP: Vec3 = [0, 1, 0];
  const rightStalls: MarketStall[] = [];
  let slotsExamined = 0, stallsEmitted = 0;
  for (const { cx, cz } of want.values()) {
    const ch = have.get(`${cx},${cz}`)!;
    // Spine midpoint in this chunk, for the district resolution.
    let midA = 0, midN = 0;
    for (let a = HERO_EVAL_LO; a <= HERO_EVAL_HI; a += 8) {
      const p = spinePoint(m, a);
      if (Math.floor(p[0] / 256) === cx && Math.floor(p[1] / 256) === cz) { midA += a; midN++; }
    }
    if (midN === 0) continue;
    const mp = spinePoint(m, midA / midN);
    const did = districtAtField(plan.districts, mp[0], mp[1]);
    const desc = marketGrammarFor({ seed, plan, chunk: ch, kind: 'market', districtId: did });
    slotsExamined += desc.stats.slots;
    stallsEmitted += desc.stalls.length;
    for (const stall of desc.stalls) {
      // Screen-right à la m4lookAt (x = norm(up × z), z = norm(eye−target)):
      // for a viewer looking downstream, right = norm(up × −forward).
      const back: Vec3 = [-stall.tx, 0, -stall.tz];
      const rgt = v3norm(v3cross(UP, back));
      // Counter offset in the stall's own lateral frame, dotted with right.
      // Mechanical: no array order, no comment about left normals.
      const dot = stall.nx * stall.counter * rgt[0] + stall.nz * stall.counter * rgt[2];
      if (dot > 0) rightStalls.push(stall);
    }
  }
  rightStalls.sort((a, b) => a.along - b.along);
  // 3. Runs: maximal consecutive emitted slots. A start interval wider than
  // PITCH_MAX×1.5 holds an omitted slot; ordinary seams never split.
  interface Run { stalls: MarketStall[]; start: number; end: number }
  const runs: Run[] = [];
  for (const st of rightStalls) {
    const last = runs[runs.length - 1];
    const prev = last?.stalls[last.stalls.length - 1];
    if (last && prev && st.along - prev.along <= HERO_SPLIT_GAP) {
      last.stalls.push(st);
      last.end = Math.max(last.end, st.along + st.pitch);
    } else {
      runs.push({ stalls: [st], start: st.along, end: st.along + st.pitch });
    }
  }
  const splits = Math.max(0, runs.length - 1);
  // 4. First complete run downstream of the origin. Complete = known from
  // beginning to end: bounded openings observed or evaluated-empty on both
  // sides, span of at least the grammar's own minimum run, fully inside the
  // evaluated interval. A run already under the locator is not the run ahead.
  let sel: Run | null = null;
  let selPrevEnd: number | null = null;
  let skippedShort = 0, skippedUnbounded = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    if (run.start <= 0) { skippedUnbounded++; continue; }
    if (run.end - run.start < HERO_MIN_RUN) { skippedShort++; continue; }
    if (run.end > HERO_EVAL_HI) { skippedUnbounded++; continue; }
    const prevEnd = i > 0 ? runs[i - 1].end : null;
    const nextStart = i + 1 < runs.length ? runs[i + 1].start : null;
    // Bounding openings: an observed split, or evaluated emptiness to the
    // range edge (an empty evaluated interval is a known opening, not a gap
    // in knowledge). A run touching the range edge with stalls beyond it is
    // truncated — unknown, not complete.
    const belowKnown = prevEnd !== null || !rightStalls.some((st) => st.along < run.start);
    const aboveKnown = nextStart !== null || !rightStalls.some((st) => st.along > run.end);
    if (!belowKnown || !aboveKnown) { skippedUnbounded++; continue; }
    sel = run;
    selPrevEnd = prevEnd;
    break;
  }
  const fail = (reason: string): HeroWalkResult => ({
    ok: false, id, evaluatedFrom: HERO_EVAL_LO, evaluatedTo: HERO_EVAL_HI,
    chunksMissing: [], reason,
  });
  if (!sel) {
    return fail(`no complete right-hand emitted run downstream of the origin in [0, ${HERO_EVAL_HI}] ` +
      `(${rightStalls.length} right-hand stalls, ${runs.length} runs, ${splits} splits) — refusing, not advancing`);
  }
  // 5. Counter-front corridor: counterward edge = furthest counter line of
  // the run measured along +view-right; roadward edge = the carriageway half
  // width at run mid; centre between them. Tangent/normal from the spine
  // curve itself at each along (finite difference), never from a comment.
  const tangentAt = (a: number): [number, number] => {
    const p0 = spinePoint(m, a - 4), p1 = spinePoint(m, a + 4);
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1;
    return [(p1[0] - p0[0]) / l, (p1[1] - p0[1]) / l];
  };
  const rightAt = (a: number): [number, number] => {
    const [tx, tz] = tangentAt(a);
    const r = v3norm(v3cross(UP, [-tx, 0, -tz]));
    return [r[0], r[2]];
  };
  let counterEdge = -Infinity;
  for (const st of sel.stalls) {
    const [rx, rz] = rightAt(st.along);
    const c = (st.nx * st.counter) * rx + (st.nz * st.counter) * rz;
    if (c > counterEdge) counterEdge = c;
  }
  const midAlong = (sel.start + sel.end) / 2;
  const midP = spinePoint(m, midAlong);
  const midS = sampleStreetPlan(plan, midP[0], midP[1], scratch());
  void midS;
  const corridorLateral = counterEdge - HERO_CORRIDOR_HALF - 0.5;
  const corridorAt = (a: number): [number, number] => {
    const p = spinePoint(m, a);
    const [rx, rz] = rightAt(a);
    return [p[0] + rx * corridorLateral, p[1] + rz * corridorLateral];
  };
  // 6. Blocked corridor: sample the strip every 5 m at three laterals
  // against building footprints. A hit reports the subject unavailable —
  // never another run, never the carriageway.
  let blockedAt: number | null = null;
  const lanes = [corridorLateral - HERO_CORRIDOR_HALF, corridorLateral, corridorLateral + HERO_CORRIDOR_HALF];
  for (let a = sel.start; a <= sel.end && blockedAt === null; a += 5) {
    const p = spinePoint(m, a);
    const [rx, rz] = rightAt(a);
    for (const lat of lanes) {
      const wx = p[0] + rx * lat, wz = p[1] + rz * lat;
      for (const c of chunks) {
        // Chunk-bounds prefilter: corridor points are metres apart, chunks
        // are 256 m. Without this every point tests every building in the
        // city, which is correct and wasteful in equal measure.
        if (wx < c.boundsMin[0] - 2 || wx > c.boundsMax[0] + 2 ||
          wz < c.boundsMin[2] - 2 || wz > c.boundsMax[2] + 2) continue;
        for (const b of c.buildings) {
          const fp = footprintAabb(b);
          if (wx >= fp[0][0] - HERO_BLOCK_PAD && wx <= fp[1][0] + HERO_BLOCK_PAD &&
            wz >= fp[0][2] - HERO_BLOCK_PAD && wz <= fp[1][2] + HERO_BLOCK_PAD) {
            blockedAt = a;
            break;
          }
        }
        if (blockedAt !== null) break;
      }
      if (blockedAt !== null) break;
    }
  }
  if (blockedAt !== null) {
    return fail(`counter-front corridor blocked at along ${blockedAt.toFixed(0)} m ` +
      `(run ${sel.start.toFixed(0)}..${sel.end.toFixed(0)}) — subject unavailable, not advancing`);
  }
  // 7. Eye and aim. Approach opening middle, on the corridor centre, at the
  // standing-eye landmark; aim at the corridor centre in the exit opening.
  // Open ground counts as a known opening only inside the window: beyond it
  // the "gap" is just unevaluated-looking distance, not an approach.
  const approachStart = Math.max(selPrevEnd ?? HERO_EVAL_LO, sel.start - HERO_OPENING_WINDOW);
  const nextStart = (() => {
    const idx = runs.indexOf(sel);
    return idx + 1 < runs.length ? runs[idx + 1].start : null;
  })();
  const exitEnd = Math.min(nextStart ?? HERO_EVAL_HI, sel.end + HERO_OPENING_WINDOW);
  const approachMid = (approachStart + sel.start) / 2;
  const exitMid = (sel.end + exitEnd) / 2;
  const [camX, camZ] = corridorAt(approachMid);
  const [aimX, aimZ] = corridorAt(exitMid);
  const position: [number, number, number] = [camX, GROUND_Y + HERO_EYE, camZ];
  const lookAt: [number, number, number] = [aimX, GROUND_Y + HERO_EYE, aimZ];
  // Framing failure check: the exit must be in the cone, else the line of
  // sight hides the continuation the hero exists to show.
  {
    const dx = lookAt[0] - position[0], dz = lookAt[2] - position[2];
    const dl = Math.hypot(dx, dz) || 1;
    if (dl < 1e-3) return fail('approach and exit collapse to one point — no line of sight');
  }
  return {
    ok: true,
    id,
    position,
    lookAt,
    fov: HERO_FOV,
    roll: 0,
    source: {
      id,
      seed,
      run: {
        startAlong: +sel.start.toFixed(1),
        endAlong: +sel.end.toFixed(1),
        stalls: sel.stalls.length,
        side: 'right',
        approachStart: +approachStart.toFixed(1),
        approachEnd: +sel.start.toFixed(1),
        exitStart: +sel.end.toFixed(1),
        exitEnd: +exitEnd.toFixed(1),
        counterEdge: +counterEdge.toFixed(2),
        corridorLateral: +corridorLateral.toFixed(2),
      },
      evaluatedFrom: HERO_EVAL_LO,
      evaluatedTo: HERO_EVAL_HI,
      chunksEvaluated: want.size,
      chunksMissing: [],
      slotsExamined,
      stallsEmitted,
      splits,
      runsTotal: runs.length,
      skippedShort,
      skippedUnbounded,
      corridorBlockedAt: blockedAt,
      eyeHeight: HERO_EYE,
      aimMetres: +Math.hypot(aimX - camX, aimZ - camZ).toFixed(1),
    },
  };
}

/**
 * How far the camera may drift from a derived pose and still be "in" it.
 * The harness asks for a pose and then settles, so small drift is expected; the
 * failure being guarded is 142 m of it.
 */
export const HELD_POSE_TOLERANCE = 2;

/**
 * Is the camera still standing in the pose it was given?
 *
 * Pure, and exported from this module rather than from the app, so a headless
 * self-test can assert it without a GPU or a DOM. The failure it guards is nine
 * frames of a sequence carrying a rule-4 line that describes a camera the
 * renderer was not in -- a diagnostic lying in the field whose whole purpose is
 * to prove the shot was derived from live state.
 */
export function poseIsHeld(
  cam: readonly [number, number, number], want: readonly [number, number, number],
  tol = HELD_POSE_TOLERANCE,
): boolean {
  return Math.hypot(cam[0] - want[0], cam[1] - want[1], cam[2] - want[2]) <= tol;
}
