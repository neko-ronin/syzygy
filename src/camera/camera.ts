/**
 * Flight camera: 6-DoF inertial drone flight with auto-bank, speed-coupled FOV,
 * low-altitude handheld behaviour, an optional collision probe, timed `flyTo`
 * moves, and seven looping cinematic tours that weave the canyon.
 *
 * Nothing here touches the DOM, so the module imports and runs headless.
 */

import {
  clamp, damp, lerp, m4lookAt, m4mul, m4perspectiveReverseZ, mat4, qFromEulerYXZ, qslerp,
  saturate, spring, v3dot, v3norm, v3perp, type Mat4, type Vec3, type Vec4,
} from '../core/math';
import { defaultWorld, type WorldState } from '../core/state';
import type { InputState } from './input';

export interface CollisionProbe {
  /** Smallest distance the camera may be from `p` without being inside geometry. */
  clearanceAt(p: Vec3, radius: number): number;
  /** Ground height (canal/street) at x,z. Infinity if unknown. */
  groundAt(x: number, z: number): number;
}

export interface CameraPose {
  position: Vec3;
  lookAt: Vec3;
  roll: number;
  fov: number;
}

export interface FlightCameraOptions {
  world?: WorldState;
  start?: Vec3;
  /** Cruise-speed setting at boot, -1..1. */
  speedBias?: number;
}

export interface FlyToOptions {
  to?: Vec3;
  lookAt?: Vec3;
  roll?: number;
  fov?: number;
  seconds: number;
  easing?: 'linear' | 'ease-in-out' | 'spring';
}

export interface TourKeyframe {
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  roll?: number;
  /** Seconds to travel from the previous keyframe to this one. */
  travel?: number;
  /** Seconds to hold at this keyframe before moving on. */
  dwell?: number;
}

// ---------------------------------------------------------------- tuning

/** Cruise speed in m/s at speedBias -1 / +1. A 3km city wants km/s at the top. */
export const MIN_CRUISE = 10;
export const MAX_CRUISE = 1500;
/** Thrust = cruise * ACC_RATE; drag is DRAG_RATE. Terminal v = cruise * ACC/DRAG. */
const ACC_RATE = 3.2;
const DRAG_RATE = 2.6;
const PRECISION_ACC_SCALE = 0.14;
const PRECISION_DRAG_BONUS = 2.4;
const BOOST_ACC_BONUS = 2.6;
const BOOST_DRAG_SCALE = 0.82;
/** Radians of bank per rad/s of yaw at full speed — the vertigo knob. */
const BANK_GAIN = 0.62;
const BANK_OMEGA = 5.2;
const USER_ROLL_GAIN = 0.55;
const MAX_ROLL = 1.35;
const MAX_PITCH = (88 * Math.PI) / 180;
const MAX_BANK_YAW_RATE = 3;
/** Metres of bob at street level; fully faded out by BOB_CEILING. */
const BOB_AMP = 0.55;
const BOB_CEILING = 180;
const CAMERA_RADIUS = 1.6;
const MIN_HOVER = 1.9;
/** Probe calls allowed per frame — the probe is CPU-side and not free. */
const MAX_PROBE_CALLS = 6;
const CEILING_Y = 2200;
const FLOOR_Y = -180;
const WORLD_LIMIT = 4000;
/** How far along the tour path the look target leads, in segment units. */
const LOOK_LEAD = 0.22;
/** Metres of velocity-lead blended into the tour look target. */
const LOOK_LEAD_DIST = 260;

const DEG = Math.PI / 180;

// ---------------------------------------------------------------- helpers

const v3add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const v3clone = (a: Vec3): Vec3 => [a[0], a[1], a[2]];
const v3finite = (a: Vec3): boolean =>
  Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(a[2]);

/** Rotate a vector by a unit quaternion. */
function qrot(q: Vec4, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}

/** Full basis of a YXZ euler. Roll rotates right/up but never `forward`. */
function basis(yaw: number, pitch: number, roll: number): { f: Vec3; r: Vec3; u: Vec3 } {
  const q = qFromEulerYXZ(yaw, pitch, roll);
  return { f: qrot(q, [0, 0, -1]), r: qrot(q, [1, 0, 0]), u: qrot(q, [0, 1, 0]) };
}

/** Roll-free basis: thrust uses this so banking never steers the velocity. */
function thrustBasis(yaw: number, pitch: number): { f: Vec3; r: Vec3 } {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  return { f: [-sy * cp, sp, -cy * cp], r: [cy, 0, -sy] };
}

/** Inverse of the euler forward convention. */
function yawPitchOf(f: Vec3): [number, number] {
  const n = v3norm(f);
  return [Math.atan2(-n[0], -n[2]), clamp(Math.asin(clamp(n[1], -1, 1)), -MAX_PITCH, MAX_PITCH)];
}

/** Yaw/pitch of a `qFromEulerYXZ` quaternion. */
function eulerYawPitch(q: Vec4): [number, number] {
  return yawPitchOf(qrot(q, [0, 0, -1]));
}

/** Uniform Catmull-Rom: C(0)=p1, C(1)=p2, p0/p3 are the neighbouring handles. */
function catmull3(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t, t3 = t2 * t;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * (
      2 * p1[i] +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
    );
  }
  return out;
}

/** Derivative of `catmull3` with respect to `t`. */
function catmull3d(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    out[i] = 0.5 * (
      (-p0[i] + p2[i]) +
      2 * (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t +
      3 * (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t2
    );
  }
  return out;
}

function catmull1(a: number, b: number, c: number, d: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (
    2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3
  );
}

const easeInOut = (t: number): number => t * t * (3 - 2 * t);

const IDLE_INPUT: InputState = {
  translate: [0, 0, 0],
  look: [0, 0],
  roll: 0,
  boost: 0,
  precision: 0,
  speedBias: 0,
  confirm: false,
  cancel: false,
  toggleUi: false,
  screenshot: false,
  pause: false,
  levelRoll: false,
};

const lensFov = (w: WorldState): number => {
  const base = Number.isFinite(w.lens.fov) ? w.lens.fov : 62 * DEG;
  const off = w.lens._fovOffset ?? 0;
  return base + (Number.isFinite(off) ? off : 0);
};

const K = (
  position: Vec3, lookAt: Vec3, fov: number,
  roll = 0, travel = 7, dwell = 0,
): TourKeyframe => ({ position, lookAt, fov, roll, travel, dwell });

// ---------------------------------------------------------------- tours

/**
 * Seven authored flights. Metres about the city origin; the generated city is
 * streamed over a ±1536m disc, so every waypoint stays inside it. Y is absolute
 * world height — the street deck sits at y = 0.35.
 */
export const TOUR_PRESETS: Record<string, TourKeyframe[]> = {
  // Slot canyon: fall in off the skyline, thread two bends at facade height, climb out.
  canyon: [
    K([-820, 760, -980], [-300, 240, -520], 72 * DEG, -0.06, 8),
    K([-430, 180, -690], [-120, 90, -430], 84 * DEG, 0.12, 7),
    K([-250, 46, -430], [40, 60, -180], 92 * DEG, -0.22, 6.5),
    K([60, 38, -180], [330, 70, 130], 88 * DEG, 0.18, 6),
    K([330, 62, 140], [560, 30, 470], 80 * DEG, 0.05, 6),
    K([540, 300, 470], [700, 120, 900], 74 * DEG, -0.14, 7),
    K([680, 620, 900], [240, 380, 700], 70 * DEG, 0.08, 7),
    K([240, 760, 700], [-420, 520, -540], 74 * DEG, -0.04, 8),
  ],
  // Wide arc around the core, gently banked, always looking inward.
  skyline: [
    K([1150, 430, 0], [0, 260, 0], 66 * DEG, 0.08, 9, 1.5),
    K([760, 480, 780], [0, 300, 0], 68 * DEG, 0.04, 8),
    K([0, 520, 1150], [0, 280, 0], 70 * DEG, -0.05, 8),
    K([-780, 470, 780], [0, 300, 0], 68 * DEG, -0.08, 8),
    K([-1150, 400, -60], [0, 240, 0], 64 * DEG, 0.06, 9, 1.5),
    K([-720, 450, -850], [0, 300, 0], 70 * DEG, 0.1, 8),
    K([40, 540, -1180], [0, 320, 0], 72 * DEG, 0.0, 8),
    K([880, 470, -820], [0, 280, 0], 68 * DEG, -0.06, 9),
  ],
  // Six metres over the water: fast, wide, long lead-ins.
  canal: [
    K([-1200, 12, -240], [-700, 10, -140], 78 * DEG, -0.05, 9),
    K([-640, 9, -120], [-260, 8, -40], 84 * DEG, 0.03, 7.5),
    K([-220, 8, -30], [180, 9, 60], 88 * DEG, -0.08, 7),
    K([220, 11, 70], [620, 9, 200], 82 * DEG, 0.06, 7),
    K([660, 8, 210], [1080, 14, 340], 76 * DEG, 0.02, 8),
    K([1080, 26, 340], [700, 16, 40], 72 * DEG, -0.1, 9, 1),
    K([560, 34, 20], [-100, 18, -60], 74 * DEG, 0.08, 9),
    K([-380, 20, -110], [-980, 12, -210], 80 * DEG, -0.04, 9),
  ],
  // High, slow, wide: the whole city read as a model on a table.
  aerial: [
    K([-1400, 980, -1400], [0, 0, 0], 62 * DEG, 0.03, 11),
    K([-300, 1120, -1500], [100, 100, -200], 60 * DEG, -0.04, 11),
    K([900, 1050, -900], [200, 200, 200], 62 * DEG, 0.05, 11),
    K([1450, 900, 300], [0, 150, 300], 64 * DEG, 0.06, 11),
    K([700, 1000, 1350], [-200, 120, 300], 60 * DEG, -0.05, 11),
    K([-500, 1150, 1300], [-300, 100, 100], 62 * DEG, 0.02, 11),
    K([-1450, 980, 500], [-200, 100, -300], 64 * DEG, -0.03, 11),
    K([-1300, 940, -700], [-100, 150, -700], 62 * DEG, 0.04, 11),
  ],
  // Street level: fast weave between blocks, maximum handheld.
  ground: [
    K([-900, 4.2, -300], [-420, 6, -180], 96 * DEG, 0.04, 6),
    K([-430, 3.6, -170], [-40, 5, -60], 102 * DEG, -0.06, 5.5),
    K([-30, 5, -50], [380, 4, 90], 98 * DEG, 0.05, 5.5),
    K([380, 3.8, 100], [760, 6, 300], 92 * DEG, -0.04, 5.5),
    K([780, 5.5, 320], [1120, 8, 620], 86 * DEG, 0.07, 6),
    K([1120, 22, 640], [500, 10, 60], 80 * DEG, -0.08, 7),
    K([420, 6.5, 40], [-260, 4, -220], 94 * DEG, 0.05, 6.5),
    K([-320, 4.5, -240], [-820, 5, -290], 90 * DEG, -0.03, 6.5),
  ],
  // One long fall past the towers, pulled out at the last moment.
  'vertical-drop': [
    K([-260, 1560, 340], [-220, 700, 300], 58 * DEG, 0.05, 8),
    K([-210, 980, 320], [-180, 420, 280], 66 * DEG, -0.08, 6),
    K([-180, 520, 300], [-140, 180, 240], 78 * DEG, 0.14, 5),
    K([-140, 190, 250], [-90, 40, 190], 92 * DEG, -0.2, 4.5),
    K([-40, 26, 170], [220, 90, 60], 108 * DEG, 0.24, 4),
    K([240, 60, 40], [520, 160, -140], 96 * DEG, -0.1, 5),
    K([560, 240, -180], [300, 500, -420], 74 * DEG, 0.08, 7),
    K([280, 900, -520], [-160, 1300, 60], 64 * DEG, -0.05, 9),
  ],
  // A tightening spiral that expands again: the "impossible scale" loop.
  orbit: [
    K([420, 190, 0], [0, 200, 0], 74 * DEG, 0.0, 6),
    K([0, 230, 420], [0, 230, 0], 76 * DEG, 0.06, 6),
    K([-420, 180, 0], [0, 200, 0], 72 * DEG, -0.06, 6),
    K([0, 260, -420], [0, 240, 0], 78 * DEG, 0.04, 6),
    K([250, 120, 250], [0, 220, 0], 82 * DEG, -0.1, 5.5),
    K([0, 90, 250], [0, 200, 0], 88 * DEG, 0.12, 5),
    K([-250, 120, -250], [0, 220, 0], 82 * DEG, -0.12, 5.5),
    K([0, 330, -250], [0, 260, 0], 76 * DEG, 0.06, 6),
  ],
};

/** Names of every authored tour, in presentation order. */
export const TOUR_NAMES: readonly string[] = Object.keys(TOUR_PRESETS);

// ---------------------------------------------------------------- internals

interface FlightState {
  elapsed: number;
  seconds: number;
  easing: 'linear' | 'ease-in-out' | 'spring';
  fromPos: Vec3;
  toPos: Vec3;
  fromQ: Vec4;
  toQ: Vec4;
  fromRoll: number;
  toRoll: number;
  fromFovBias: number;
  toFovBias: number;
  fromLook: Vec3;
  toLook: Vec3;
  t: number;
  vel: number;
  overshoot: boolean;
}

interface TourState {
  keys: TourKeyframe[];
  seg: number;
  t: number;
  mode: 'travel' | 'dwell';
  dwellT: number;
}

interface TourSample {
  pos: Vec3;
  look: Vec3;
  fov: number;
  roll: number;
  vel: Vec3;
}

// ---------------------------------------------------------------- camera

export class FlightCamera {
  readonly world: WorldState;

  /** Physics position. The low-altitude bob is *not* baked in — see `getPose`. */
  position: Vec3;
  velocity: Vec3 = [0, 0, 0];
  yaw = 0;
  pitch = -0.12;
  roll = 0;
  fov: number;
  /** Smoothed speed in m/s, planar + vertical. For the HUD and speed-coupled FOV. */
  speed = 0;

  readonly forward: Vec3 = [0, 0, -1];
  readonly right: Vec3 = [1, 0, 0];
  readonly up: Vec3 = [0, 1, 0];

  readonly view: Mat4 = mat4();
  readonly proj: Mat4 = mat4();
  readonly viewProj: Mat4 = mat4();
  /** 6 x vec4, world space: left, right, bottom, top, near, far. Inside is dot >= 0. */
  readonly frustumPlanes = new Float32Array(24);

  /** Cinematic jitter amount for the composite pass, 0..1. */
  shake = 0;
  collision: CollisionProbe | null = null;
  activeTour: string | null = null;
  /** Completed loops of the active tour; 0 while on the first pass. */
  tourLoop = 0;

  /** The point the camera is framing; for the HUD compass. */
  readonly lookTarget: Vec3 = [0, 0, -1];

  /** Aspect ratio for the projection. The renderer must keep this in sync. */
  aspect = 16 / 9;
  near = 0.5;
  far: number = Infinity;
  /** Distance used to synthesise a far plane when `far` is infinite. */
  frustumFar = 24000;
  /** Eye radius used for collision queries. */
  bodyRadius = CAMERA_RADIUS;
  /** Cruise-speed setting, -1..1; mirrors `InputState.speedBias`. */
  speedBias: number;

  private rollVel = 0;
  private yawRate = 0;
  private bobPhase = 0;
  private bobY = 0;
  private bobRoll = 0;
  private fovBias = 0;
  private fovBiasTarget: number | null = null;
  private flight: FlightState | null = null;
  private tour: TourState | null = null;
  private readonly thrustF: Vec3 = [0, 0, -1];
  private readonly thrustR: Vec3 = [1, 0, 0];
  private readonly eye: Vec3 = [0, 0, 0];

  constructor(opts: FlightCameraOptions = {}) {
    this.world = opts.world ?? defaultWorld();
    this.position = v3clone(opts.start ?? [0, 180, 0]);
    this.speedBias = clamp(opts.speedBias ?? 0, -1, 1);
    this.fov = lensFov(this.world);
    this.syncBasis(true);
    this.buildMatrices(0);
  }

  // ------------------------------------------------------------ tuning

  /** Cruise speed in m/s for the current speed setting (log-ish, usable low). */
  get cruise(): number {
    const t = (this.speedBias + 1) * 0.5;
    return MIN_CRUISE + (MAX_CRUISE - MIN_CRUISE) * Math.pow(saturate(t), 2.2);
  }

  /** 0..1 fraction of the achievable top speed. Drives FOV and bank strength. */
  get speedNorm(): number {
    return saturate(this.speed / Math.max(1, this.cruise * (1 + BOOST_ACC_BONUS)));
  }

  // ------------------------------------------------------------ step

  /** One simulation step. `probe` is optional; omit it to keep the wired one. */
  update(dt: number, input: InputState, probe?: CollisionProbe | null): void {
    const step = clamp(dt > 0 ? dt : 0, 0, 1 / 20);
    if (probe !== undefined) this.collision = probe ?? null;
    if (!input) input = IDLE_INPUT;

    if (this.hasIntent(input)) {
      this.cancelFlight();
      this.stopTour();
    }
    if (input.pause) {
      this.cancelFlight();
      this.stopTour();
    }
    this.speedBias = clamp(input.speedBias, -1, 1);

    const driven = this.tour !== null || this.flight !== null;
    const live = driven ? IDLE_INPUT : input;

    if (this.tour) this.stepTour(step);
    else if (this.flight) this.stepFlight(step);
    else this.stepFree(step, live);

    this.updateLook(step, live, driven);
    this.resolveCollision();
    this.updateLens(step);
    this.buildMatrices(step);
  }

  /** Release the probe and any scripted motion. */
  dispose(): void {
    this.flight = null;
    this.tour = null;
    this.activeTour = null;
    this.tourLoop = 0;
    this.collision = null;
  }

  /** Snap instantly — tours, the screenshot harness, the conductor. */
  setPose(pose: Partial<CameraPose>): void {
    if (pose.position && v3finite(pose.position)) this.position = v3clone(pose.position);
    if (pose.roll !== undefined && Number.isFinite(pose.roll)) {
      this.roll = clamp(pose.roll, -MAX_ROLL, MAX_ROLL);
    }
    if (pose.fov !== undefined && Number.isFinite(pose.fov)) {
      this.fovBias = pose.fov - lensFov(this.world);
      this.fovBiasTarget = this.fovBias;
    }
    if (pose.lookAt && v3finite(pose.lookAt)) {
      const [yaw, pitch] = yawPitchOf(v3sub(pose.lookAt, this.position));
      this.yaw = yaw;
      this.pitch = pitch;
      this.lookTarget[0] = pose.lookAt[0];
      this.lookTarget[1] = pose.lookAt[1];
      this.lookTarget[2] = pose.lookAt[2];
    }
    this.rollVel = 0;
    this.yawRate = 0;
    this.velocity = [0, 0, 0];
    this.speed = 0;
    this.bobY = 0;
    this.bobRoll = 0;
    this.syncBasis(pose.lookAt === undefined);
    this.updateLens(0);
    this.buildMatrices(0);
  }

  /** The rendered pose: bob applied to the eye, `position` left as physics truth. */
  getPose(): CameraPose {
    return {
      position: v3add(this.position, [0, this.bobY, 0]),
      lookAt: v3clone(this.lookTarget),
      roll: this.roll + this.bobRoll,
      fov: this.fov,
    };
  }

  // ------------------------------------------------------------ scripted motion

  /** Start a timed eased move. Manual input or pause cancels it next frame. */
  flyTo(opts: FlyToOptions): void {
    const seconds = Math.max(0.05, Number.isFinite(opts.seconds) ? opts.seconds : 1);
    const dest = opts.to && v3finite(opts.to) ? v3clone(opts.to) : v3clone(this.position);
    const destLook = opts.lookAt && v3finite(opts.lookAt)
      ? v3clone(opts.lookAt)
      : v3add(this.position, v3scale(this.forward, 400));
    const [yaw, pitch] = yawPitchOf(v3sub(destLook, dest));
    const toRoll = Number.isFinite(opts.roll as number)
      ? clamp(opts.roll as number, -MAX_ROLL, MAX_ROLL)
      : this.roll;
    const toFov = Number.isFinite(opts.fov as number) ? (opts.fov as number) : this.fov;
    this.stopTour();
    this.flight = {
      elapsed: 0,
      seconds,
      easing: opts.easing ?? 'ease-in-out',
      fromPos: v3clone(this.position),
      toPos: dest,
      fromQ: qFromEulerYXZ(this.yaw, this.pitch, this.roll),
      toQ: qFromEulerYXZ(yaw, pitch, toRoll),
      fromRoll: this.roll,
      toRoll,
      fromFovBias: this.fovBias,
      toFovBias: toFov - lensFov(this.world),
      fromLook: v3clone(this.lookTarget),
      toLook: destLook,
      t: 0,
      vel: 0,
      overshoot: opts.easing === 'spring',
    };
  }

  cancelFlight(): void {
    if (!this.flight) return;
    this.flight = null;
    this.fovBiasTarget = null;
  }

  isFlying(): boolean { return this.flight !== null; }

  /** Begin a looping authored flight. Unknown names are ignored. */
  startTour(preset: string): void {
    const keys = TOUR_PRESETS[preset];
    if (!keys || keys.length < 4) return;
    this.flight = null;
    this.tour = { keys, seg: 0, t: 0, mode: 'travel', dwellT: 0 };
    this.activeTour = preset;
    this.tourLoop = 0;
    const kf = keys[0];
    this.setPose({ position: kf.position, lookAt: kf.lookAt, roll: kf.roll ?? 0, fov: kf.fov });
    this.tour.seg = 0;
    this.tour.t = 0;
    this.tour.mode = 'travel';
    this.tour.dwellT = 0;
  }

  stopTour(): void {
    if (!this.tour) { this.activeTour = null; return; }
    this.tour = null;
    this.activeTour = null;
    this.fovBiasTarget = null;
  }

  // ------------------------------------------------------------ motion

  private hasIntent(i: InputState): boolean {
    const t = i.translate, l = i.look;
    return (
      Math.abs(t[0]) > 0.02 || Math.abs(t[1]) > 0.02 || Math.abs(t[2]) > 0.02 ||
      Math.abs(l[0]) > 1e-4 || Math.abs(l[1]) > 1e-4 || Math.abs(i.roll) > 0.02
    );
  }

  /** Inertial free flight: thrust accumulates, drag bleeds, and you overshoot. */
  private stepFree(dt: number, input: InputState): void {
    if (dt <= 0) return;
    const boost = input.boost;
    const precision = input.precision;
    const accel = this.cruise * ACC_RATE * (1 + boost * BOOST_ACC_BONUS) *
      lerp(1, PRECISION_ACC_SCALE, precision);
    const drag = DRAG_RATE * lerp(1, BOOST_DRAG_SCALE, boost) *
      (1 + precision * PRECISION_DRAG_BONUS);

    const tb = thrustBasis(this.yaw, this.pitch);
    this.thrustF[0] = tb.f[0]; this.thrustF[1] = tb.f[1]; this.thrustF[2] = tb.f[2];
    this.thrustR[0] = tb.r[0]; this.thrustR[1] = tb.r[1]; this.thrustR[2] = tb.r[2];

    const t = input.translate;
    this.velocity[0] += (this.thrustF[0] * t[2] + this.thrustR[0] * t[0]) * accel * dt;
    this.velocity[1] += (this.thrustF[1] * t[2] + t[1]) * accel * dt;
    this.velocity[2] += (this.thrustF[2] * t[2] + this.thrustR[2] * t[0]) * accel * dt;
    const k = Math.exp(-drag * dt);
    this.velocity[0] *= k;
    this.velocity[1] *= k;
    this.velocity[2] *= k;

    this.position[0] += this.velocity[0] * dt;
    this.position[1] += this.velocity[1] * dt;
    this.position[2] += this.velocity[2] * dt;

    this.speed = damp(this.speed, Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]), 9, dt);
    this.settle();
  }

  private stepFlight(dt: number): void {
    const f = this.flight;
    if (!f || dt <= 0) return;
    f.elapsed += dt;
    const raw = clamp(f.elapsed / f.seconds, 0, 1);
    if (f.overshoot) {
      const [t, vel] = spring(f.t, f.vel, 1, 3.4 / Math.max(0.25, f.seconds / 2), dt);
      f.t = t;
      f.vel = vel;
    } else {
      f.t = f.easing === 'linear' ? raw : easeInOut(raw);
    }
    const t = clamp(f.t, -0.2, 1.2);
    const tc = clamp(t, 0, 1);

    const px = this.position[0], py = this.position[1], pz = this.position[2];
    this.position[0] = lerp(f.fromPos[0], f.toPos[0], t);
    this.position[1] = lerp(f.fromPos[1], f.toPos[1], t);
    this.position[2] = lerp(f.fromPos[2], f.toPos[2], t);
    this.lookTarget[0] = lerp(f.fromLook[0], f.toLook[0], tc);
    this.lookTarget[1] = lerp(f.fromLook[1], f.toLook[1], tc);
    this.lookTarget[2] = lerp(f.fromLook[2], f.toLook[2], tc);

    const [yaw, pitch] = eulerYawPitch(qslerp(f.fromQ, f.toQ, tc));
    this.yaw = yaw;
    this.pitch = clamp(pitch, -MAX_PITCH, MAX_PITCH);
    this.roll = clamp(lerp(f.fromRoll, f.toRoll, tc), -MAX_ROLL, MAX_ROLL);
    this.fovBiasTarget = lerp(f.fromFovBias, f.toFovBias, tc);

    this.velocity[0] = (this.position[0] - px) / dt;
    this.velocity[1] = (this.position[1] - py) / dt;
    this.velocity[2] = (this.position[2] - pz) / dt;
    this.speed = damp(this.speed, Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]), 6, dt);
    this.settle();

    if (raw >= 1) {
      const [lyaw, lpitch] = eulerYawPitch(f.toQ);
      this.position = v3clone(f.toPos);
      this.lookTarget[0] = f.toLook[0];
      this.lookTarget[1] = f.toLook[1];
      this.lookTarget[2] = f.toLook[2];
      this.yaw = lyaw;
      this.pitch = clamp(lpitch, -MAX_PITCH, MAX_PITCH);
      this.roll = f.toRoll;
      this.fovBias = f.toFovBias;
      this.flight = null;
      this.fovBiasTarget = null;
    }
  }

  /** Catmull-Rom tour traversal with a leading look target. Loops seamlessly. */
  private stepTour(dt: number): void {
    const tour = this.tour;
    if (!tour) return;
    if (dt > 0) {
      const k2 = tour.keys[(tour.seg + 1) % tour.keys.length];
      const travel = Math.max(0.25, k2.travel ?? 7);
      const dwell = Math.max(0, k2.dwell ?? 0);
      if (tour.mode === 'travel') {
        tour.t += dt / travel;
        if (tour.t >= 1) {
          tour.t = 1;
          if (dwell > 0) { tour.mode = 'dwell'; tour.dwellT = 0; }
          else this.advanceTour();
        }
      } else {
        tour.dwellT += dt;
        if (tour.dwellT >= dwell) this.advanceTour();
      }
    }

    const s = this.sampleTour(tour.seg, tour.t);
    this.position[0] = s.pos[0];
    this.position[1] = s.pos[1];
    this.position[2] = s.pos[2];
    this.lookTarget[0] = s.look[0];
    this.lookTarget[1] = s.look[1];
    this.lookTarget[2] = s.look[2];
    this.roll = s.roll;
    this.fovBiasTarget = s.fov - lensFov(this.world);

    const scale = tour.mode === 'travel' && dt > 0
      ? 1 / Math.max(0.25, tour.keys[(tour.seg + 1) % tour.keys.length].travel ?? 7)
      : 0;
    this.velocity[0] = s.vel[0] * scale;
    this.velocity[1] = s.vel[1] * scale;
    this.velocity[2] = s.vel[2] * scale;
    this.speed = damp(this.speed, Math.hypot(this.velocity[0], this.velocity[1], this.velocity[2]), 8, dt);
    this.settle();
  }

  private advanceTour(): void {
    const tour = this.tour;
    if (!tour) return;
    tour.seg = (tour.seg + 1) % tour.keys.length;
    if (tour.seg === 0) this.tourLoop++;
    tour.t = 0;
    tour.dwellT = 0;
    tour.mode = 'travel';
  }

  private sampleTour(seg: number, t: number): TourSample {
    const keys = this.tour ? this.tour.keys : TOUR_PRESETS.orbit;
    const n = keys.length;
    const i = ((seg % n) + n) % n;
    const a = keys[(i - 1 + n) % n];
    const b = keys[i];
    const c = keys[(i + 1) % n];
    const d = keys[(i + 2) % n];
    const u = clamp(t, 0, 1);
    const pos = catmull3(a.position, b.position, c.position, d.position, u);
    const vel = catmull3d(a.position, b.position, c.position, d.position, u);

    // The look target leads the motion: sample the look path ahead of the
    // position path, then blend in a velocity-lead point. This is what makes
    // a scripted camera read as intentional rather than merely interpolated.
    const leadT = u + LOOK_LEAD;
    let leadSeg = i, lt = leadT;
    if (leadT > 1) { leadSeg = (i + 1) % n; lt = leadT - 1; }
    const l1 = keys[leadSeg];
    const l2 = keys[(leadSeg + 1) % n];
    const l3 = keys[(leadSeg + 2) % n];
    const l0 = keys[(leadSeg - 1 + n) % n];
    const authored = catmull3(l0.lookAt, l1.lookAt, l2.lookAt, l3.lookAt, clamp(lt, 0, 1));
    const velLead = v3add(pos, v3scale(v3norm(vel), LOOK_LEAD_DIST));
    const look = v3add(v3scale(authored, 0.7), v3scale(velLead, 0.3));

    const fov = clamp(catmull1(a.fov, b.fov, c.fov, d.fov, u), 20 * DEG, 120 * DEG);
    const roll = clamp(
      catmull1(a.roll ?? 0, b.roll ?? 0, c.roll ?? 0, d.roll ?? 0, u), -MAX_ROLL, MAX_ROLL,
    );
    return { pos, look, fov, roll, vel };
  }

  // ------------------------------------------------------------ orientation

  private updateLook(dt: number, input: InputState, driven: boolean): void {
    if (dt > 0 && !driven) {
      const commanded = input.levelRoll ? 0 : input.roll * USER_ROLL_GAIN;
      const rawRate = clamp(input.look[0] / dt, -MAX_BANK_YAW_RATE, MAX_BANK_YAW_RATE);
      this.yawRate = damp(this.yawRate, rawRate, 14, dt);
      this.yaw += input.look[0];
      this.pitch = clamp(this.pitch - input.look[1], -MAX_PITCH, MAX_PITCH);
      // Auto-bank: proportional to yaw rate, scaled by how fast we are going.
      const bank = clamp(-this.yawRate * BANK_GAIN * this.speedNorm, -MAX_ROLL, MAX_ROLL);
      const [r, rv] = spring(this.roll, this.rollVel, bank + commanded, BANK_OMEGA, dt);
      this.roll = clamp(r, -MAX_ROLL, MAX_ROLL);
      this.rollVel = rv;
    }
    if (!v3finite(this.position) || !Number.isFinite(this.yaw)) this.reset();
    this.yaw = ((this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.pitch = clamp(this.pitch, -MAX_PITCH, MAX_PITCH);
    this.syncBasis(!driven);
  }

  /** Refresh the public basis vectors and the framed look target. */
  private syncBasis(setLook: boolean): void {
    const b = basis(this.yaw, this.pitch, this.roll);
    this.forward[0] = b.f[0]; this.forward[1] = b.f[1]; this.forward[2] = b.f[2];
    this.right[0] = b.r[0]; this.right[1] = b.r[1]; this.right[2] = b.r[2];
    this.up[0] = b.u[0]; this.up[1] = b.u[1]; this.up[2] = b.u[2];
    if (!setLook) return;
    this.lookTarget[0] = this.position[0] + b.f[0] * 400;
    this.lookTarget[1] = this.position[1] + b.f[1] * 400;
    this.lookTarget[2] = this.position[2] + b.f[2] * 400;
  }

  private reset(): void {
    this.position = [0, 180, 0];
    this.velocity = [0, 0, 0];
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.rollVel = 0;
    this.yawRate = 0;
  }

  // ------------------------------------------------------------ world reaction

  /** Bob at street level, speed-coupled FOV, and the composite shake amount. */
  private updateLens(dt: number): void {
    const lens = this.world.lens;
    const altNorm = saturate((this.position[1] - 0.35) / BOB_CEILING);
    const bobAmt = (1 - altNorm) * (0.3 + 0.7 * this.speedNorm);
    this.bobPhase += dt * (1.4 + 1.6 * this.speedNorm);
    this.bobY = Math.sin(this.bobPhase * 2.1) * BOB_AMP * bobAmt;
    this.bobRoll = Math.sin(this.bobPhase * 1.07 + 1.1) * 0.018 * bobAmt;

    if (this.fovBiasTarget !== null) this.fovBias = damp(this.fovBias, this.fovBiasTarget, 12, dt);
    else if (this.fovBias !== 0) this.fovBias = damp(this.fovBias, 0, 1.6, dt);

    const speedFov = Number.isFinite(lens.speedFov) ? lens.speedFov : 0;
    this.fov = clamp(
      lensFov(this.world) + this.speedNorm * speedFov * 0.35 + this.fovBias,
      18 * DEG,
      130 * DEG,
    );

    this.shake = saturate(
      0.05 + this.speedNorm * 0.4 + (1 - altNorm) * 0.12 + Math.abs(this.rollVel) * 0.3,
    );
  }

  private buildMatrices(dt: number): void {
    void dt;
    this.eye[0] = this.position[0];
    this.eye[1] = this.position[1] + this.bobY;
    this.eye[2] = this.position[2];
    const vb = basis(this.yaw, this.pitch, this.roll + this.bobRoll);
    const look = this.lookTarget;
    const dl = Math.hypot(look[0] - this.eye[0], look[1] - this.eye[1], look[2] - this.eye[2]);
    const target: Vec3 = dl > 1e-3
      ? [look[0], look[1], look[2]]
      : [this.eye[0] + vb.f[0] * 400, this.eye[1] + vb.f[1] * 400, this.eye[2] + vb.f[2] * 400];
    m4lookAt(this.view, this.eye, target, vb.u);
    m4perspectiveReverseZ(this.proj, this.fov, this.aspect, this.near, this.far);
    m4mul(this.viewProj, this.proj, this.view);
    this.extractFrustum();
  }

  /** Gribb-Hartmann on a reverse-Z [0,1] matrix; inside is `dot(plane, p) >= 0`. */
  private extractFrustum(): void {
    const m = this.viewProj;
    const r0: Vec4 = [m[0], m[4], m[8], m[12]];
    const r1: Vec4 = [m[1], m[5], m[9], m[13]];
    const r2: Vec4 = [m[2], m[6], m[10], m[14]];
    const r3: Vec4 = [m[3], m[7], m[11], m[15]];
    const planes: Vec4[] = [
      [r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]],
      [r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]],
      [r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]],
      [r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]],
      [r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]],
      [0, 0, 0, 0],
    ];
    // Reverse-Z: ndc z in [0,1] with near -> 1 and far -> 0, so `w - z` is the
    // near plane and the z row alone is the far plane.
    const farLen = Math.hypot(r2[0], r2[1], r2[2]);
    if (farLen > 1e-9) {
      planes[5] = [r2[0] / farLen, r2[1] / farLen, r2[2] / farLen, r2[3] / farLen];
    } else {
      // Infinite far plane: synthesise one `frustumFar` ahead, inside is forward.
      const f = this.forward;
      planes[5] = [-f[0], -f[1], -f[2], v3dot(f, this.eye) + this.frustumFar];
    }
    for (let i = 0; i < 6; i++) {
      const p = planes[i];
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      this.frustumPlanes[i * 4 + 0] = p[0] / l;
      this.frustumPlanes[i * 4 + 1] = p[1] / l;
      this.frustumPlanes[i * 4 + 2] = p[2] / l;
      this.frustumPlanes[i * 4 + 3] = p[3] / l;
    }
  }

  // ------------------------------------------------------------ collision

  /**
   * Push out of geometry and kill the velocity component into the surface so we
   * slide along walls. Probe calls are budgeted per frame: one ground query on
   * alternate frames, one clearance query, then up to three more to estimate the
   * penetration normal.
   */
  private resolveCollision(): void {
    const probe = this.collision;
    if (!probe) {
      this.clampToWorld();
      return;
    }
    // Budget: one ground query per frame, one clearance query, and up to three
    // more only when we are actually inside something. Worst case five.
    let budget = MAX_PROBE_CALLS;

    let g: number;
    try { g = probe.groundAt(this.position[0], this.position[2]); } catch { g = Infinity; }
    budget--;
    if (Number.isFinite(g)) {
      const floor = g + MIN_HOVER;
      if (this.position[1] < floor) {
        this.position[1] = floor;
        if (this.velocity[1] < 0) this.velocity[1] *= -0.15;
      }
    }

    let clear = Infinity;
    try { clear = probe.clearanceAt(this.position, this.bodyRadius); } catch { clear = Infinity; }
    budget--;

    if (Number.isFinite(clear) && clear < this.bodyRadius) {
      const depth = this.bodyRadius - clear;
      const eps = Math.max(0.5, this.bodyRadius);
      let gx = -Infinity, gy = -Infinity, gz = -Infinity;
      const probeAxis = (a: Vec3, which: 0 | 1 | 2): void => {
        if (budget <= 0) return;
        budget--;
        let c2: number;
        try {
          c2 = probe.clearanceAt(
            [this.position[0] + a[0], this.position[1] + a[1], this.position[2] + a[2]],
            this.bodyRadius,
          );
        } catch { c2 = -Infinity; }
        const g = c2 - clear;
        if (which === 0 && g > gx) gx = g;
        else if (which === 1 && g > gy) gy = g;
        else if (which === 2 && g > gz) gz = g;
      };
      probeAxis([eps, 0, 0], 0);
      probeAxis([0, eps, 0], 1);
      probeAxis([0, 0, eps], 2);
      const cand: Vec3 = [
        Number.isFinite(gx) ? gx : 0,
        Number.isFinite(gy) ? gy : 0,
        Number.isFinite(gz) ? gz : 0,
      ];
      const l = Math.hypot(cand[0], cand[1], cand[2]);
      const n = l > 1e-6 ? v3norm(cand) : v3perp(this.velocity);
      this.position[0] += n[0] * (depth + 0.02);
      this.position[1] += n[1] * (depth + 0.02);
      this.position[2] += n[2] * (depth + 0.02);
      const vn = v3dot(this.velocity, n);
      if (vn < 0) {
        this.velocity[0] -= n[0] * vn;
        this.velocity[1] -= n[1] * vn;
        this.velocity[2] -= n[2] * vn;
      }
    }

    this.clampToWorld();
  }

  private clampToWorld(): void {
    if (!v3finite(this.position)) { this.reset(); return; }
    if (!v3finite(this.velocity)) this.velocity = [0, 0, 0];
    this.position[0] = clamp(this.position[0], -WORLD_LIMIT, WORLD_LIMIT);
    this.position[1] = clamp(this.position[1], FLOOR_Y, CEILING_Y);
    this.position[2] = clamp(this.position[2], -WORLD_LIMIT, WORLD_LIMIT);
  }

  /** NaN guard shared by every motion mode. */
  private settle(): void { this.clampToWorld(); }
}
