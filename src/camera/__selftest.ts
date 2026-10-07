/**
 * Headless self-check for the camera + input module. Imports nothing
 * browser-only, so it runs under vite-node / plain node.
 */

import { defaultWorld } from '../core/state';
import type { Vec3 } from '../core/math';
import { FlightCamera, TOUR_NAMES, TOUR_PRESETS, type CollisionProbe } from './camera';
import { Input, type InputState } from './input';
import { writeCaptureProjection } from '../render/captureprojection';
import { mat4 } from '../core/math';

const DT = 1 / 60;

const input = (o: Partial<InputState> = {}): InputState => ({
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
  ...o,
});

const vecOk = (v: Vec3): boolean => v.every((n) => Number.isFinite(n));
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const f3 = (n: number): string => n.toFixed(3);

/** Half-space wall at x=200 (solid beyond) plus a floor at y=0, as an SDF. */
const probe = (): CollisionProbe => ({
  clearanceAt: (p) => 200 - p[0],
  groundAt: () => 0,
});

export function runCameraSelfTest(): string {
  const L: string[] = [];
  const fail: string[] = [];
  const check = (ok: boolean, msg: string): void => { if (!ok) fail.push(msg); };

  // A saved rendered pose must round-trip even after a different handheld phase.
  {
    const cam = new FlightCamera({ world: defaultWorld(), start: [0, 2, 0] });
    for (let f = 0; f < 83; f++) cam.update(DT, input());
    const saved = cam.getPose();
    for (let f = 0; f < 47; f++) cam.update(DT, input());
    cam.setPose(saved);
    const restored = cam.getPose();
    check(dist(saved.position, restored.position) < 1e-12 && dist(saved.lookAt, restored.lookAt) < 1e-12
      && Math.abs(saved.roll - restored.roll) < 1e-12 && Math.abs(saved.fov - restored.fov) < 1e-12,
    'saved rendered pose must restore exactly without sampling another bob phase');
    const physical = { position: [...cam.position] as Vec3, lookAt: [...cam.lookTarget] as Vec3, roll: cam.roll, fov: cam.fov };
    const view = mat4(), projection = mat4(), nextView = mat4(), nextProjection = mat4();
    writeCaptureProjection(view, projection, physical.position, physical.lookAt, physical.roll, 1.1519173063162575, 1600, 900);
    for (let f = 0; f < 31; f++) cam.update(DT, input());
    cam.setPose(physical);
    writeCaptureProjection(nextView, nextProjection, cam.position, cam.lookTarget, cam.roll, 1.1519173063162575, 1600, 900);
    check(view.every((v, i) => v === nextView[i]) && projection.every((v, i) => v === nextProjection[i]),
      'saved physical pose must restore the actual renderer view and projection matrices exactly');
    cam.dispose();
  }

  // ---------------------------------------------------------- free flight
  {
    const cam = new FlightCamera({ world: defaultWorld(), start: [0, 600, 0] });
    cam.setPose({ position: [0, 600, 0], lookAt: [0, 600, -100] });
    let maxRoll = 0;
    const speedTrack: number[] = [];
    for (let f = 0; f < 600; f++) {
      // Ramp the cruise speed in over 120 frames, then hold. A steady yaw from
      // frame 250 on is what the auto-bank has to answer.
      const bias = -1 + Math.min(1, f / 120) * 0.95;
      const turn = f > 250 ? 0.55 : 0;
      cam.update(DT, input({ translate: [0, 0, 1], speedBias: bias, look: [turn * DT, 0] }));
      speedTrack.push(cam.speed);
      maxRoll = Math.max(maxRoll, Math.abs(cam.roll));
      check(vecOk(cam.position), `free flight: position not finite at frame ${f}`);
      check(vecOk(cam.velocity), `free flight: velocity not finite at frame ${f}`);
      check(
        Number.isFinite(cam.fov) && cam.fov > 0.5 && cam.fov < 2.3,
        `free flight: fov ${cam.fov} out of range`,
      );
      check(Math.abs(cam.roll) <= 1.36, `free flight: roll ${cam.roll} out of range`);
      check(Math.abs(cam.pitch) <= 1.536, `free flight: pitch ${cam.pitch} out of range`);
      check(cam.speedNorm >= 0 && cam.speedNorm <= 1, `free flight: speedNorm ${cam.speedNorm}`);
    }
    const tail = speedTrack.slice(-30);
    const lo = Math.min(...tail), hi = Math.max(...tail);
    const convergence = hi - lo;
    check(hi > 100, `free flight: cruise speed never got going (${f3(hi)} m/s)`);
    check(convergence < hi * 0.1, `free flight: speed did not converge, still swinging ${f3(convergence)} m/s`);
    check(maxRoll > 0.05, `free flight: auto-bank too weak, max |roll| ${f3(maxRoll)} rad`);
    check(
      Math.abs(cam.position[0]) < 3999 && Math.abs(cam.position[2]) < 3999 && cam.position[1] > -179,
      `free flight: ran into the world clamp at ${cam.position.map(f3).join(', ')}`,
    );
    L.push(`free flight  600f  terminal ${f3(hi)} m/s (spread ${f3(convergence)}), cruise ${f3(cam.cruise)} m/s`);
    L.push(`             peak |roll| ${f3(maxRoll)} rad from 0.55 rad/s of yaw at speed`);
    L.push(`             fov ${f3((cam.fov * 180) / Math.PI)}deg, pos ${cam.position.map(f3).join(', ')}`);

    // Boost must out-run cruise; precision must crawl.
    const settle = (boost: number, precision: number): number => {
      const c = new FlightCamera({ world: defaultWorld(), start: [0, 400, 0] });
      for (let f = 0; f < 400; f++) c.update(DT, input({ translate: [0, 0, 1], boost, precision }));
      return c.speed;
    };
    const cruiseTerm = settle(0, 0);
    const boostSpeed = settle(1, 0);
    const fineSpeed = settle(0, 1);
    check(boostSpeed > cruiseTerm * 1.5, `boost: ${f3(boostSpeed)} m/s vs cruise ${f3(cruiseTerm)} m/s`);
    check(fineSpeed < cruiseTerm * 0.2, `precision: ${f3(fineSpeed)} m/s is not fine control`);
    L.push(`             cruise ${f3(cruiseTerm)} / boost ${f3(boostSpeed)} / precision ${f3(fineSpeed)} m/s`);
  }

  // ---------------------------------------------------------- flyTo
  {
    const cam = new FlightCamera({ world: defaultWorld(), start: [0, 40, 0] });
    const target: Vec3 = [300, 180, -450];
    cam.flyTo({ to: target, lookAt: [300, 180, -450], roll: 0.2, fov: 1.3, seconds: 1.5 });
    check(cam.isFlying(), 'flyTo: not flagged as flying');
    const frames = Math.ceil(1.5 / DT) + 2;
    let landed = false;
    for (let f = 0; f < frames; f++) {
      cam.update(DT, input());
      check(vecOk(cam.position), `flyTo: position not finite at frame ${f}`);
      if (!cam.isFlying()) { landed = true; break; }
    }
    const err = dist(cam.position, target);
    check(landed, 'flyTo: still flying after the duration elapsed');
    check(err < 0.5, `flyTo: landed ${f3(err)}m from the target`);
    check(Math.abs(cam.roll - 0.2) < 1e-3, `flyTo: roll ${f3(cam.roll)} != 0.2`);
    L.push(`flyTo        1.5s ease-in-out -> ${f3(err)}m error, roll ${f3(cam.roll)} rad`);
  }

  // ---------------------------------------------------------- tours
  for (const name of TOUR_NAMES) {
    const cam = new FlightCamera({ world: defaultWorld() });
    cam.startTour(name);
    check(cam.activeTour === name, `tour ${name}: activeTour is ${cam.activeTour}`);
    const keys = TOUR_PRESETS[name];
    check(keys.length >= 6, `tour ${name}: only ${keys.length} keyframes`);
    // Long enough to cross the loop seam at least once, and never fewer than
    // the 3000 frames the brief asks for.
    const loopSeconds = keys.reduce((a, k) => a + (k.travel ?? 7) + (k.dwell ?? 0), 0);
    const frames = Math.max(3000, Math.ceil(loopSeconds / DT) + 120);
    let prev: Vec3 = [cam.position[0], cam.position[1], cam.position[2]];
    let maxStep = 0;
    let maxRoll = 0;
    let minY = Infinity, maxY = -Infinity;
    for (let f = 0; f < frames; f++) {
      cam.update(DT, input());
      const p = cam.position;
      check(vecOk(p), `tour ${name}: position not finite at frame ${f}`);
      check(Number.isFinite(cam.fov) && cam.fov > 0.3 && cam.fov < 2.2, `tour ${name}: fov ${cam.fov}`);
      const step = dist(prev, p);
      if (f > 2) maxStep = Math.max(maxStep, step);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
      maxRoll = Math.max(maxRoll, Math.abs(cam.roll));
      prev = [p[0], p[1], p[2]];
    }
    check(cam.activeTour === name, `tour ${name}: stopped on its own`);
    check(cam.tourLoop >= 1, `tour ${name}: never wrapped (${frames} frames, ${f3(loopSeconds)}s loop)`);
    check(minY >= -200, `tour ${name}: dipped to ${f3(minY)}m`);
    check(maxY <= 2000, `tour ${name}: climbed to ${f3(maxY)}m`);
    check(maxStep < 200, `tour ${name}: jumped ${f3(maxStep)}m in one frame`);
    L.push(
      `tour ${name.padEnd(14)} ${String(keys.length).padStart(2)}kf ${f3(loopSeconds).padStart(5)}s loop x${cam.tourLoop + 1}  ` +
      `y ${f3(minY)}..${f3(maxY)}m  step ${f3(maxStep)}m/f  roll ${f3(maxRoll)}rad`,
    );
  }

  // ---------------------------------------------------------- input smoke
  {
    // No DOM under vite-node: constructing, stepping and disposing must be no-ops.
    const stub = {
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      setPointerCapture: () => {},
    } as unknown as HTMLCanvasElement;
    let threw = '';
    try {
      const inp = new Input(stub);
      inp.setFov(1.1);
      inp.setSpeedBias(0.5);
      inp.requestPointerLock();
      for (let f = 0; f < 10; f++) { inp.beginFrame(DT); inp.endFrame(); }
      check(inp.gamepadConnected === false, 'input: reported a phantom gamepad');
      check(Math.abs(inp.state.speedBias - 0.5) < 1e-6, 'input: setSpeedBias did not stick');
      inp.dispose();
      inp.dispose();
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    check(threw === '', `input: threw headless — ${threw}`);
    L.push('input        headless construct/step/dispose is a clean no-op');
  }

  // ---------------------------------------------------------- extras
  {
    // Frustum sanity: a point in front of the camera is inside all six planes.
    const cam = new FlightCamera({ world: defaultWorld(), start: [10, 50, 10] });
    cam.update(DT, input());
    const p: Vec3 = [
      cam.position[0] + cam.forward[0] * 100,
      cam.position[1] + cam.forward[1] * 100,
      cam.position[2] + cam.forward[2] * 100,
    ];
    const planes = cam.frustumPlanes;
    let inside = true;
    for (let i = 0; i < 6; i++) {
      const d = planes[i * 4] * p[0] + planes[i * 4 + 1] * p[1] +
        planes[i * 4 + 2] * p[2] + planes[i * 4 + 3];
      if (d < -1e-3) inside = false;
    }
    check(inside, 'frustum: a point 100m ahead of the camera is culled');

    // A point behind the camera must be culled.
    const b: Vec3 = [
      cam.position[0] - cam.forward[0] * 100,
      cam.position[1] - cam.forward[1] * 100,
      cam.position[2] - cam.forward[2] * 100,
    ];
    let culled = false;
    for (let i = 0; i < 6; i++) {
      const d = planes[i * 4] * b[0] + planes[i * 4 + 1] * b[1] +
        planes[i * 4 + 2] * b[2] + planes[i * 4 + 3];
      if (d < 0) culled = true;
    }
    check(culled, 'frustum: a point behind the camera was not culled');

    // Collision: drive the camera into the wall and confirm it is pushed out.
    const cam2 = new FlightCamera({ world: defaultWorld(), start: [199.4, 60, 0] });
    cam2.update(DT, input({ translate: [1, 0, 0] }), probe());
    const pushed = cam2.position[0] <= 200 - cam2.bodyRadius + 1e-3;
    check(pushed, `collision: not pushed out, x = ${f3(cam2.position[0])}`);
    check(cam2.velocity[0] <= 1e-6, `collision: still driving into the wall, vx = ${f3(cam2.velocity[0])}`);

    // Bob: fades out with altitude.
    const low = new FlightCamera({ world: defaultWorld(), start: [0, 6, 0] });
    let bobLow = 0;
    for (let f = 0; f < 120; f++) { low.update(DT, input()); bobLow = Math.max(bobLow, Math.abs(low.getPose().position[1] - low.position[1])); }
    const high = new FlightCamera({ world: defaultWorld(), start: [0, 900, 0] });
    let bobHigh = 0;
    for (let f = 0; f < 120; f++) { high.update(DT, input()); bobHigh = Math.max(bobHigh, Math.abs(high.getPose().position[1] - high.position[1])); }
    check(bobLow > 0.01, `bob: no bob at street level (${f3(bobLow)}m)`);
    check(bobHigh < 1e-6, `bob: bob survives at 900m (${f3(bobHigh)}m)`);

    L.push(`frustum      6 planes, ${f3(planes[15])} far-plane w; ahead-inside/ behind-culled ok`);
    L.push(`collision    pushed to x=${f3(cam2.position[0])} against a wall at x=200`);
    L.push(`handheld     bob ${f3(bobLow)}m at 6m alt, ${f3(bobHigh)}m at 900m alt`);

    cam.dispose();
    cam2.dispose();
  }

  L.push('');
  L.push(fail.length === 0 ? 'ALL PASS' : `FAIL (${fail.length})\n  - ${fail.join('\n  - ')}`);
  return L.join('\n');
}

const isMain = (): boolean => {
  const url = import.meta.url;
  return url.endsWith('__selftest.ts') || url.endsWith('__selftest.js');
};

if (isMain()) console.log(runCameraSelfTest());
