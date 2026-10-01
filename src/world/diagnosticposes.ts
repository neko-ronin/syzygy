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
  GROUND_Y,
  type CityPlan,
  type StreetSample,
} from './citygen';

/** The shape `CrowdSim.population()` returns; declared here so this file does not import the sim. */
export interface Population {
  n: number;
  cx: number;
  cz: number;
  spread: number;
  minY: number;
  maxY: number;
}

export type DerivedPoseId = 'street-crowd' | 'crowd-closeup' | 'facade-base';

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
  /** Metres above `GROUND_Y`. */
  eye: number;
  /** Metres along the tangent the camera looks. */
  aimMetres: number;
  /** Horizontal distance from camera to the crowd centroid it was derived from. */
  distanceToCrowd: number;
  /** The samples that were rejected as too narrow to be worth the shot. */
  rejected: { x: number; z: number; kind: string; width: number }[];
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
};

const scratch = (): StreetSample => ({
  dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
});

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
      rejected,
    },
  };
}

/** Ground height the city is built on, re-exported so callers need one import. */
export { GROUND_Y };