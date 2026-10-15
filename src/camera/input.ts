/**
 * Unified flight input: keyboard + mouse (pointer lock) + gamepad + touch,
 * normalised into one `InputState` the camera reads once per frame.
 *
 * Everything browser-specific lives inside the class, so this module imports
 * cleanly under Node (typecheck, self-tests) with no DOM at module scope.
 */

import { clamp, saturate, type Vec2, type Vec3 } from '../core/math';

export interface InputState {
  /** x=strafe, y=vertical, z=forward. Raw axis values, -1..1. */
  translate: Vec3;
  /** yaw delta (+ = turn right), pitch delta (+ = look down) in radians *this frame*. */
  look: Vec2;
  /** -1..1, commanded roll offset (Q/E, or shoulder buttons). */
  roll: number;
  /** 0..1, extra thrust. */
  boost: number;
  /** 0..1, 1 = fine control. */
  precision: number;
  /** -1..1 cruise-speed setting from the wheel / pinch. */
  speedBias: number;
  confirm: boolean;
  cancel: boolean;
  toggleUi: boolean;
  screenshot: boolean;
  pause: boolean;
  /** Recentre/level the roll. Optional so plain object literals still typecheck. */
  levelRoll?: boolean;
}

export interface InputOptions {
  /** Radians of yaw per pixel of mouse movement at the reference FOV. */
  mouseSensitivity?: number;
  /** Vertical FOV (radians) the mouse sensitivity is calibrated at. */
  referenceFov?: number;
  /** Rad/s of yaw at full stick deflection. */
  stickLookRate?: number;
  /** Stick radial deadzone, 0..1. */
  deadzone?: number;
  /** Stick response exponent; >1 = precise near centre, fast at the stops. */
  stickCurve?: number;
  /** Cruise-speed setting the wheel starts at, 0..1. */
  initialSpeedBias?: number;
}

const DEFAULTS: Required<InputOptions> = {
  mouseSensitivity: 0.0023,
  referenceFov: (62 * Math.PI) / 180,
  stickLookRate: 2.6,
  deadzone: 0.13,
  stickCurve: 2.1,
  initialSpeedBias: 0,
};

const WHEEL_SENSITIVITY = 0.0016;
const KEY_LOOK_RATE = 1.9;
const TOUCH_LOOK_SENSITIVITY = 0.0042;
const TOUCH_TRANSLATE_RATE = 1.6;
const TOUCH_PINCH_SENSITIVITY = 0.004;
/** Gamepad buttons, "standard mapping" layout. */
const BTN_A = 0, BTN_B = 1, BTN_LB = 4, BTN_RB = 5, BTN_LT = 6, BTN_RT = 7;
const BTN_BACK = 8, BTN_START = 9, BTN_UP = 12, BTN_DOWN = 13, BTN_LEFT = 14, BTN_RIGHT = 15;
const AX_LX = 0, AX_LY = 1, AX_RX = 2, AX_RY = 3;

type Listener = [EventTarget, string, EventListener, AddEventListenerOptions | undefined];

const hasDom = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined' &&
  typeof HTMLCanvasElement !== 'undefined';

export class Input {
  /** Current frame's normalised input. Mutated in place; do not retain. */
  readonly state: InputState = {
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

  gamepadConnected = false;

  private readonly canvas: HTMLCanvasElement;
  private readonly opt: Required<InputOptions>;
  private readonly listeners: Listener[] = [];
  private readonly held = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number; type: string }>();

  private enabled = true;
  private disposed = false;
  private pointerLocked = false;

  /** Accumulated mouse-look radians since the last `beginFrame`. */
  private lookAccum: Vec2 = [0, 0];
  private speedAccum = 0;
  private speedBias = 0;
  private edgeConfirm = false;
  private edgeCancel = false;
  private edgeToggleUi = false;
  private edgeScreenshot = false;
  private edgePause = false;
  private edgeLevelRoll = false;

  private padIndex = 0;
  private padPrevButtons: boolean[] = [];
  private padSeen = false;

  private touchLookX = 0;
  private touchLookY = 0;
  private touchTransX = 0;
  private touchTransY = 0;
  private pinchPrev = 0;

  constructor(canvas: HTMLCanvasElement, opts: InputOptions = {}) {
    this.canvas = canvas;
    this.opt = { ...DEFAULTS, ...opts };
    this.speedBias = clamp(this.opt.initialSpeedBias, -1, 1);
    this.state.speedBias = this.speedBias;
    if (!hasDom()) return;
    try {
      canvas.style.touchAction = 'none';
    } catch { /* non-fatal */ }
    this.bind();
    this.refreshPadPresence();
  }

  // ------------------------------------------------------------ frame

  /** Advance one frame: fold held keys, stick, wheel and pointer deltas into `state`. */
  beginFrame(dt: number): void {
    if (this.disposed) return;
    const step = clamp(dt > 0 ? dt : 0, 0, 1 / 20);
    const s = this.state;
    const o = this.opt;

    // Mouse: scale by FOV so a fov change does not silently retune the hand.
    const fovScale = o.mouseSensitivity / o.referenceFov;
    let lookX = this.lookAccum[0] * fovScale;
    let lookY = this.lookAccum[1] * fovScale;
    this.lookAccum[0] = 0;
    this.lookAccum[1] = 0;

    // Wheel / pinch -> cruise speed, smoothed so a notch is a nudge not a jump.
    const targetBias = clamp(this.speedBias + this.speedAccum, -1, 1);
    this.speedAccum = 0;
    this.speedBias = targetBias + (targetBias - this.speedBias) * 0.25;

    let tx = 0, ty = 0, tz = 0;
    let roll = 0;
    let boost = 0;
    let precision = 0;

    // Keyboard.
    if (this.enabled) {
      if (this.held.has('KeyW')) tz += 1;
      if (this.held.has('KeyS')) tz -= 1;
      if (this.held.has('KeyD')) tx += 1;
      if (this.held.has('KeyA')) tx -= 1;
      if (this.held.has('KeyR') || this.held.has('Space')) ty += 1;
      if (this.held.has('KeyF') || this.held.has('KeyC')) ty -= 1;
      if (this.held.has('KeyE')) roll += 1;
      if (this.held.has('KeyQ')) roll -= 1;
      if (this.held.has('ArrowLeft')) lookX -= KEY_LOOK_RATE * step;
      if (this.held.has('ArrowRight')) lookX += KEY_LOOK_RATE * step;
      if (this.held.has('ArrowUp')) lookY += KEY_LOOK_RATE * step;
      if (this.held.has('ArrowDown')) lookY -= KEY_LOOK_RATE * step;
      if (this.held.has('ShiftLeft') || this.held.has('ShiftRight')) boost = 1;
      if (this.held.has('ControlLeft') || this.held.has('ControlRight')) precision = 1;
    }

    // Touch.
    if (this.enabled) {
      lookX += this.touchLookX;
      lookY += this.touchLookY;
      tx += this.touchTransX;
      ty += this.touchTransY;
      this.touchLookX = 0;
      this.touchLookY = 0;
      this.touchTransX = 0;
      this.touchTransY = 0;
    }

    // Gamepad — additive, so a stick trims a keyboard command rather than
    // fighting it.
    this.refreshPadPresence();
    if (this.gamepadConnected) {
      const pad = this.readPad();
      if (pad) {
        const [lx, ly] = this.shapeStick(pad.axes[AX_LX] ?? 0, pad.axes[AX_LY] ?? 0, o.stickCurve);
        const [rx, ry] = this.shapeStick(pad.axes[AX_RX] ?? 0, pad.axes[AX_RY] ?? 0, o.stickCurve);
        tx += lx;
        tz -= ly;
        ty += this.trigger(pad, BTN_RT) - this.trigger(pad, BTN_LT);
        roll += rx;
        lookX += rx * o.stickLookRate * step;
        lookY += ry * o.stickLookRate * step;
        const boostBtn = this.button(pad, BTN_RB) || this.button(pad, BTN_LB);
        boost = Math.max(boost, boostBtn ? 1 : 0);
        if (this.rising(pad, BTN_A)) this.edgeLevelRoll = true;
        if (this.rising(pad, BTN_B)) this.edgeCancel = true;
        if (this.rising(pad, BTN_START)) this.edgePause = true;
        if (this.rising(pad, BTN_BACK)) this.edgeConfirm = true;
        if (this.button(pad, BTN_UP)) tz += 1;
        if (this.button(pad, BTN_DOWN)) tz -= 1;
        if (this.button(pad, BTN_RIGHT)) tx += 1;
        if (this.button(pad, BTN_LEFT)) tx -= 1;
      }
    }

    s.translate[0] = clamp(tx, -1, 1);
    s.translate[1] = clamp(ty, -1, 1);
    s.translate[2] = clamp(tz, -1, 1);
    s.look[0] = Number.isFinite(lookX) ? lookX : 0;
    s.look[1] = Number.isFinite(lookY) ? lookY : 0;
    s.roll = clamp(roll, -1, 1);
    s.boost = saturate(boost);
    s.precision = saturate(precision);
    s.speedBias = clamp(this.speedBias, -1, 1);
    s.confirm = this.edgeConfirm;
    s.cancel = this.edgeCancel;
    s.toggleUi = this.edgeToggleUi;
    s.screenshot = this.edgeScreenshot;
    s.pause = this.edgePause;
    s.levelRoll = this.edgeLevelRoll;
  }

  /** Clear edge-triggered flags so the next frame sees a fresh press. */
  endFrame(): void {
    this.edgeConfirm = false;
    this.edgeCancel = false;
    this.edgeToggleUi = false;
    this.edgeScreenshot = false;
    this.edgePause = false;
    this.edgeLevelRoll = false;
  }

  /** Tell the input layer which vertical FOV is live (keeps mouse feel constant). */
  setFov(fov: number): void {
    if (Number.isFinite(fov) && fov > 1e-3) this.opt.referenceFov = fov;
  }

  /** Direct cruise-speed setting, -1..1 (HUD slider, presets, the LLM). */
  setSpeedBias(v: number): void {
    this.speedBias = clamp(v, -1, 1);
    this.state.speedBias = this.speedBias;
  }

  /** Suspend input without tearing down listeners. */
  setEnabled(v: boolean): void {
    this.enabled = !!v;
    if (!this.enabled) {
      this.held.clear();
      this.state.translate[0] = this.state.translate[1] = this.state.translate[2] = 0;
      this.state.look[0] = this.state.look[1] = 0;
      this.state.roll = 0;
      this.state.boost = 0;
      this.state.precision = 0;
    }
  }

  get pointerLockActive(): boolean { return this.pointerLocked; }

  /** Ask for pointer lock; a denial is silently ignored. */
  requestPointerLock(): void {
    if (this.disposed || !hasDom()) return;
    const el = this.canvas as HTMLCanvasElement & {
      requestPointerLock?: (o?: { unadjustedMovement?: boolean }) => Promise<void> | void;
    };
    try {
      const r = el.requestPointerLock?.({ unadjustedMovement: true });
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
    } catch { /* denied or unsupported */ }
  }

  /** Release pointer lock; a no-op if not held. */
  exitPointerLock(): void {
    if (this.disposed || !hasDom()) return;
    try { document.exitPointerLock?.(); } catch { /* nothing to release */ }
  }

  /** Remove every listener and drop state. Safe to call twice. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.exitPointerLock();
    for (const [t, type, fn, opts] of this.listeners) {
      try { t.removeEventListener(type, fn, opts); } catch { /* already gone */ }
    }
    this.listeners.length = 0;
    this.held.clear();
    this.pointers.clear();
    this.setEnabled(false);
  }

  // ------------------------------------------------------------ wiring

  private on<T extends Event>(
    target: EventTarget, type: string, fn: (e: T) => void, opts?: AddEventListenerOptions,
  ): void {
    const listener = fn as EventListener;
    target.addEventListener(type, listener, opts);
    this.listeners.push([target, type, listener, opts]);
  }

  private bind(): void {
    const win = window;
    const doc = document;

    this.on<KeyboardEvent>(win, 'keydown', (e) => {
      if (e.repeat) { return; }
      this.held.add(e.code);
      switch (e.code) {
        case 'Enter': case 'NumpadEnter': this.edgeConfirm = true; break;
        case 'Escape': this.edgeCancel = true; this.edgePause = true; break;
        case 'Backspace': this.edgeCancel = true; break;
        case 'Tab': this.edgeToggleUi = true; e.preventDefault(); break;
        case 'KeyP': this.edgeScreenshot = true; break;
        case 'KeyL': this.edgeLevelRoll = true; break;
        default: break;
      }
      if (BLOCKED_KEYS.has(e.code)) e.preventDefault();
    });

    this.on<KeyboardEvent>(win, 'keyup', (e) => { this.held.delete(e.code); });
    this.on(win, 'blur', () => { this.held.clear(); this.pointers.clear(); });

    this.on<WheelEvent>(this.canvas, 'wheel', (e) => {
      if (!this.enabled) return;
      this.speedAccum += clamp(e.deltaY, -120, 120) * WHEEL_SENSITIVITY;
      e.preventDefault();
    }, { passive: false });

    this.on(this.canvas, 'contextmenu', (e) => { e.preventDefault(); });
    this.on<PointerEvent>(this.canvas, 'pointerdown', (e) => {
      if (!this.enabled) return;
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      this.resetTouchBaseline();
      if (e.pointerType === 'mouse' && !this.pointerLocked) this.requestPointerLock();
    });

    this.on<PointerEvent>(this.canvas, 'pointermove', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'mouse' && this.pointerLocked) {
        const mx = Number.isFinite(e.movementX) ? e.movementX : 0;
        const my = Number.isFinite(e.movementY) ? e.movementY : 0;
        this.lookAccum[0] += mx * this.opt.mouseSensitivity;
        this.lookAccum[1] += my * this.opt.mouseSensitivity;
        return;
      }
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) {
        // Drag grabs the world: dragging right swings the view left.
        this.touchLookX -= dx * TOUCH_LOOK_SENSITIVITY;
        // Trackpad/mouse drag (reported as 'mouse') tilts the other way to touch.
        this.touchLookY += (p.type === 'mouse' ? -dy : dy) * TOUCH_LOOK_SENSITIVITY;
      } else if (this.pointers.size === 2) {
        this.touchTransX += (dx + dy) * 0.5 * TOUCH_TRANSLATE_RATE;
        this.touchTransY -= dy * TOUCH_TRANSLATE_RATE;
        this.updatePinch();
      }
    });

    const release = (e: PointerEvent): void => {
      this.pointers.delete(e.pointerId);
      this.resetTouchBaseline();
    };
    this.on<PointerEvent>(this.canvas, 'pointerup', release);
    this.on<PointerEvent>(this.canvas, 'pointercancel', release);

    this.on(doc, 'pointerlockchange', () => {
      this.pointerLocked = doc.pointerLockElement === this.canvas;
      if (!this.pointerLocked) this.held.clear();
    });
    this.on(doc, 'pointerlockerror', () => { this.pointerLocked = false; });
    this.on(win, 'gamepadconnected', (e: Event) => {
      const gp = (e as GamepadEvent).gamepad;
      if (gp && gp.index < this.padIndex) this.padIndex = gp.index;
      this.refreshPadPresence();
    });
    this.on(win, 'gamepaddisconnected', () => this.refreshPadPresence());
  }

  // ------------------------------------------------------------ gamepad

  private readPad(): Gamepad | null {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    let pads: (Gamepad | null)[] = [];
    try { pads = navigator.getGamepads() ?? []; } catch { return null; }
    let pad = pads[this.padIndex] ?? null;
    if (!pad) {
      for (const p of pads) {
        if (p) { this.padIndex = p.index; pad = p; break; }
      }
    }
    if (!pad) { this.padSeen = false; return null; }
    this.padSeen = true;
    return pad;
  }

  private refreshPadPresence(): void {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      this.gamepadConnected = false;
      return;
    }
    try {
      const pads = navigator.getGamepads() ?? [];
      this.gamepadConnected = this.padSeen || pads.some((p) => !!p);
    } catch {
      this.gamepadConnected = false;
    }
  }

  private button(pad: Gamepad, i: number): boolean {
    const b = pad.buttons[i];
    return !!b && (typeof b === 'object' ? b.pressed || b.value > 0.5 : b > 0.5);
  }

  /** Analogue trigger value 0..1, tolerating pads that report only as buttons. */
  private trigger(pad: Gamepad, i: number): number {
    const b = pad.buttons[i];
    if (!b) return 0;
    const v = typeof b === 'object' ? b.value : b;
    return saturate(v > 0 ? v : 0);
  }

  private rising(pad: Gamepad, i: number): boolean {
    const now = this.button(pad, i);
    const was = this.padPrevButtons[i] ?? false;
    this.padPrevButtons[i] = now;
    return now && !was;
  }

  /** Radial deadzone + radial saturation + response curve. */
  private shapeStick(x: number, y: number, curve: number): [number, number] {
    const dz = this.opt.deadzone;
    const m = Math.hypot(x, y);
    if (!(m > dz) || !Number.isFinite(m)) return [0, 0];
    const n = saturate((m - dz) / (1 - dz));
    const s = (Math.pow(n, curve) / m) * this.opt.deadzone;
    return [x * s, y * s];
  }

  // ------------------------------------------------------------ touch

  private resetTouchBaseline(): void {
    this.pinchPrev = 0;
    this.updatePinch();
  }

  private updatePinch(): void {
    if (this.pointers.size < 2) { this.pinchPrev = 0; return; }
    const list = [...this.pointers.values()];
    const dist = Math.hypot(list[0].x - list[1].x, list[0].y - list[1].y);
    if (this.pinchPrev > 0) {
      this.speedAccum += (this.pinchPrev - dist) * TOUCH_PINCH_SENSITIVITY;
    }
    this.pinchPrev = dist;
  }
}

const BLOCKED_KEYS = new Set([
  'Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Backspace',
]);
