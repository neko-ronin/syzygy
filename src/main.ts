/**
 * Boot, main loop, and the `window.__syzygy` automation surface the headless
 * capture harness drives.
 *
 * The loop is deliberately simple — fixed-ish timestep, world integrate, camera
 * update, render, HUD — because everything interesting lives in the systems
 * behind it. The one non-obvious piece is the load-adaptive quality governor,
 * which is what lets the same build stay interactive on a laptop and still fill
 * a 4K display.
 */

import { GPUContext } from './core/gpu';
import { clamp, type Vec3 } from './core/math';
import { defaultWorld, integrateWorld, sunDirection, type WorldState } from './core/state';
import { Renderer, type QualityTier, type RendererStats } from './render/renderer';
import { FlightCamera } from './camera/camera';
import { Input } from './camera/input';
import { ToolExecutor, type CameraPort } from './agent/tools';
import { ConductorUI, toast } from './agent/ui';
import { CrowdSim } from './sim/crowd';
import { TrafficSim, buildVehicleInstances, makeVehicleInstances } from './sim/traffic';
import { WeatherDirector } from './sim/weather';
import {
  derivePose, deriveTrafficPose, deriveHeroWalk, poseIsHeld,
  type DerivedPoseId, type DerivedPoseResult,
  type TrafficPoseId, type TrafficPoseResult,
} from './world/diagnosticposes';
import { INSTANCE_FLOATS, bakeChunk } from './render/citymesh';
import { accountEntityTriangles } from './render/perf';

// ---------------------------------------------------------------- dom


const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const dom = {
  canvas: $<HTMLCanvasElement>('view'),
  boot: $('boot'),
  bootBar: $('boot-bar'),
  bootStatus: $('boot-status'),
  stats: $('hud-stats'),
  compass: $('compass'),
  keys: $('hud-keys'),
  toasts: $('toasts'),
  flash: $('flash'),
  titlecard: $('titlecard'),
  btnConsole: $('btn-console'),
  btnShot: $('btn-shot'),
  btnCine: $('btn-cine'),
  btnDev: $('btn-dev'),
};

// ---------------------------------------------------------------- boot ui

let bootProgress = 0;
const setBoot = (p: number, msg: string): void => {
  bootProgress = Math.max(bootProgress, p);
  dom.bootBar.style.width = `${Math.round(bootProgress * 100)}%`;
  dom.bootStatus.textContent = msg;
};

const fatal = (err: unknown): void => {
  const msg = err instanceof Error ? err.message : String(err);
  dom.bootStatus.className = 'fatal';
  dom.bootStatus.textContent = `could not start\n\n${msg}\n\nThis build needs WebGPU. Try Chrome 121+, Edge 121+,\nor Safari 26+. On Linux you may need to launch with\n  --enable-unsafe-webgpu`;
  dom.bootBar.style.background = '#ff8a7a';
};

// ---------------------------------------------------------------- boot params

/** What a warm bake did, and why it stopped. Reported so a partial warm is visible. */
export interface WarmReport {
  /** Chunks asked for. */
  target: number;
  ticks: number;
  ms: number;
  /** Which loop exit fired. `target` is the only one that means the world is full. */
  stopped: 'target' | 'tick-cap' | 'ms-cap' | 'no-progress';
  residentChunks: number;
  visibleChunks: number;
  rebakePending: number;
  lodHistogram: number[];
  triangles: number;
  tier: string;
}

/**
 * URL parameters the harness sets. These are measurement instructions, not
 * preferences: they change what is resident and when, so a capture taken with
 * them is not the same capture as one taken without.
 *
 *   seed    — world seed
 *   chunks  — bake at least this many chunks resident, synchronously, at boot
 *   warm    — iteration cap for that bake (it stops early when there is nothing
 *             left to do, so this is a ceiling rather than a duration)
 */
const BOOT = (() => {
  const q = new URLSearchParams(location.search);
  const int = (k: string, d: number): number => {
    const v = Number.parseInt(q.get(k) ?? '', 10);
    return Number.isFinite(v) ? v : d;
  };
  return { seed: int('seed', 0x5e7a17) | 0, chunks: int('chunks', 0), warm: int('warm', 0) };
})();

// ---------------------------------------------------------------- main

/** The pass encoder type the renderer's entity hook hands over. */
type EntityPass = Parameters<NonNullable<Renderer['pendingEntities']>>[0];

class App {
  renderer!: Renderer;
  world: WorldState = defaultWorld(0x5e7a17);
  camera!: FlightCamera;
  input!: Input;
  crowd!: CrowdSim;
  traffic!: TrafficSim;
  /** Vehicle instances, grouped by mesh and distance-culled. Reused per frame. */
  private trafficInst = makeVehicleInstances(256);
  /** Pedestrians then vehicles, contiguous. One upload, many draws. */
  private entityScratch = new Float32Array(4096 * INSTANCE_FLOATS);
  /**
   * Triangles the entity draws contributed this frame, added to the render
   * stats after `render()` because they do not pass through `drawEntitySet`.
   */
  private pendingEntityTris = 0;
  /** Cost of the one memcpy per frame that packs the two instance sets. */
  private entityCopyMs = 0;
  /** What this frame actually issued, recorded here rather than read back. */
  private issuedEntityDraws: string[] = [];
  weather!: WeatherDirector;
  tools!: ToolExecutor;
  ui!: ConductorUI;
  port!: CameraPort;

  private running = false;
  private last = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private uiVisible = true;
  private hudTimer = 0;
  private governorTimer = 0;
  private screenshotRequested = false;
  private qualityOverride: QualityTier | null = null;
  private qualityHold = 0;
  /** The last pose derived from live state, so `stats()` can report where it is standing. */
  private derivedPose: DerivedPoseResult | null = null;
  ready = false;
  frameCount = 0;

  async start(): Promise<void> {
    const seed = BOOT.seed;

    setBoot(0.08, 'requesting a gpu');
    await GPUContext.create(dom.canvas);

    setBoot(0.2, 'growing the city');
    this.renderer = await Renderer.create(dom.canvas, seed);
    this.world = this.renderer.world;


    setBoot(0.4, 'charting the canyons');
    this.camera = new FlightCamera({ world: this.world, start: [0, 220, 520] });
    this.camera.startTour('skyline');
    this.input = new Input(dom.canvas);

    setBoot(0.52, 'waking the crowd');
    this.crowd = new CrowdSim(this.world.seed);
    this.crowd.attach(this.renderer.city, this.world.seed);
    this.traffic = new TrafficSim(this.world, this.renderer.city);

    setBoot(0.64, 'tuning the weather');
    this.weather = new WeatherDirector(this.world);

    setBoot(0.74, 'wiring the conductor');
    // The agent layer talks to the camera through a narrow port, so it never
    // needs to know the camera is a drone.
    this.port = makeCameraPort(this.camera);
    this.tools = new ToolExecutor(this.world, this.port);
    this.ui = new ConductorUI(this.tools, this.world, this.port);
    this.ui.mount();
    this.wireUi();

    setBoot(0.86, 'compiling shaders');
    // Force pipeline creation before the first presented frame so the
    // titlecard does not stutter.
    this.renderer.render(this.camera, 1 / 60);

    setBoot(1, 'ready');
    this.ready = true;
    this.running = true;
    this.last = performance.now();

    // `?chunks=N` — fill the world before the first presented frame. This sits
    // after `running = true` and before the rAF subscription so `tick()` can be
    // called synchronously and nothing is on screen yet to stutter.
    if (BOOT.chunks > 0) {
      setBoot(0.94, `warming ${BOOT.chunks} chunks`);
      this.lastWarm = this.warmChunks(BOOT.chunks, BOOT.warm > 0 ? BOOT.warm : 400);
    }

    requestAnimationFrame(this.tick);

    setTimeout(() => {
      dom.boot.classList.add('gone');
      dom.titlecard.classList.add('show');
      setTimeout(() => dom.titlecard.classList.remove('show'), 5200);
    }, 260);
  }

  // ---------------------------------------------------------------- warm bake

  /**
   * Synchronous streaming warm-up (F6 / R10).
   *
   * `streamChunks` bakes under a hard 4 ms budget per frame, which is the right
   * trade *while a frame is on screen* — a ~30 ms LOD-0 bake inside a 16 ms
   * budget is a dropped frame. At boot there is no frame on screen, so the
   * budget protects nothing; it only turns "fill the view" into "fill the view
   * over the next sixty frames". Running the loop synchronously is the whole
   * trick, and it is what takes a capture from minutes to seconds.
   *
   * It is deliberately the *same* loop and not a second, faster bake path.
   * That is what keeps warm boot honest: `streamChunks` derives each chunk's
   * LOD from the live camera position on every tick, so a chunk is baked at the
   * detail level it would actually be viewed at. A warm path that baked
   * everything at LOD 0 would be quicker still and would produce a high-detail
   * image of a distant view — which looks valid and is wrong, which is the
   * failure class this repository keeps paying for. It also means the detail
   * level is only correct once the camera has been moved to the capture pose,
   * so the harness warms *after* `setPose`, not before.
   *
   * Stopping conditions, all of them explicit: the residency target is met and
   * no re-bakes are queued; the tick cap; the wall-clock cap; or the loop has
   * stopped making progress, which means there is nothing left in range to
   * bake. Whichever fired is reported, because a warm that quietly gave up is
   * a capture of a half-loaded world that still looks like a picture.
   */
  warmChunks(target = 96, maxTicks = 400, maxMs = 90_000): WarmReport {
    // A synchronous loop cannot receive worker results; warm bakes on this thread.
    this.renderer.streamSync = true;
    try { return this.warmChunksSync(target, maxTicks, maxMs); } finally { this.renderer.streamSync = false; }
  }

  private warmChunksSync(target: number, maxTicks: number, maxMs: number): WarmReport {
    const t0 = performance.now();
    this.last = t0;
    let ticks = 0;
    let last = -1;
    let stall = 0;
    let stopped: WarmReport['stopped'] = 'tick-cap';
    for (; ticks < maxTicks; ticks++) {
      this.tick(performance.now(), false);
      const s = this.renderer.stats;
      if (s.residentChunks >= target && s.rebakePending === 0) { stopped = 'target'; break; }
      if (performance.now() - t0 > maxMs) { stopped = 'ms-cap'; break; }
      // "No progress" means no new chunks *and* nothing left to re-bake. Without
      // the rebake clause a warm stops the moment residency plateaus while LODs
      // are still wrong for the camera, and reports `no-progress` as though the
      // world were settled — which is exactly the state that makes a capture
      // quietly low-detail.
      if (s.residentChunks === last && s.rebakePending === 0) { if (++stall >= 8) { stopped = 'no-progress'; break; } }
      else { stall = 0; last = s.residentChunks; }
    }
    const s = this.renderer.stats;
    const report: WarmReport = {
      target, ticks, ms: Math.round(performance.now() - t0), stopped,
      residentChunks: s.residentChunks, visibleChunks: s.visibleChunks,
      rebakePending: s.rebakePending, lodHistogram: s.lodHistogram.slice(),
      triangles: s.triangles, tier: s.tier,
    };
    this.lastWarm = report;
    return report;
  }
  lastWarm: WarmReport | null = null;

  // ---------------------------------------------------------------- derived poses

  /**
   * Derive a diagnostic pose from live state, right now (D21).
   *
   * One source for `--eval`, the console and `setPose`: the harness asks for the
   * numbers here and hands the same numbers back to `setPose`, so what the
   * console prints is what the renderer used. There is no second copy to drift.
   *
   * It reads `CrowdSim.population()` — the live centroid — and then places the
   * camera on a real carriageway from `sampleStreetPlan`. The centroid alone is
   * not enough: a centroid can sit mid-block, and a camera at 2.4 m mid-block
   * photographs a wall. Both are needed for a shot that points at its subject,
   * and both are reported in `source` so the claim is checkable.
   */
  pose(id: DerivedPoseId): DerivedPoseResult {
    const r = derivePose(id, this.crowd.population(), this.world.seed);
    this.derivedPose = r;
    return r;
  }

  /**
   * The derived pose, but only while the camera is still standing in it.
   *
   * `derivedPose` used to be published verbatim whenever it was non-null, so an
   * *authored* pose set after a derived one left the previous frame's provenance
   * in place. Nine frames of a sequence carried a rule-4 line describing a camera
   * the renderer was not in -- a diagnostic lying in the exact field whose
   * purpose is to prove the shot was not improvised.
   *
   * Clearing on `setPose` alone would fix that instance and miss the harder one:
   * a *derived* pose also goes stale when the camera flies off it, which is how
   * `01d-street-crowd` was photographed from 142 m away with a provenance that
   * still claimed 10.1 m. So the rule is not "was an authored pose set" but
   * "is the camera still there", checked here rather than trusted from the setter.
   *
   * `HELD_POSE_TOLERANCE` is 2 m: the harness asks for a pose and settles, so
   * small drift is expected and is not the failure being guarded against.
   */
  heldDerivedPose(): DerivedPoseResult | null {
    const r = this.derivedPose;
    if (!r) return null;
    if (!r.ok) return r;
    return poseIsHeld(this.camera.position, r.position) ? r : null;
  }

  /**
   * A camera pointed at the traffic, derived from live vehicle positions.
   *
   * `03-tram-level` is anchored at the world origin and claims a statement about
   * tram height it cannot support from a kilometre away. This goes to the tram
   * instead of renaming the pose, because `sections.json` maps `tram-level` to a
   * section and `compare.mjs --auto` matches on it.
   */
  trafficPose(id: TrafficPoseId): TrafficPoseResult {
    return deriveTrafficPose(id, this.traffic.vehicles, this.world.seed);
  }

  // ---------------------------------------------------------------- ui wiring

  private wireUi(): void {
    dom.btnConsole.onclick = () => this.toggleConsole();
    dom.btnCine.onclick = () => this.toggleCinematic();
    dom.btnShot.onclick = () => this.screenshot();
    dom.btnDev.onclick = () => this.toggleDev();

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.code) {
        case 'KeyT': this.toggleConsole(); break;
        case 'KeyC': this.toggleCinematic(); break;
        case 'F2': e.preventDefault(); this.screenshot(); break;
        case 'KeyH': this.toggleHud(); break;
        case 'Backquote': this.toggleDev(); break;
        case 'KeyP': this.world.paused = !this.world.paused; break;
        default: break;
      }
    });

    // Click the canvas to capture the mouse.
    dom.canvas.addEventListener('click', () => {
      if (this.ui.isOpen) return;
      this.input.requestPointerLock();
    });
  }

  private toggleConsole(): void {
    this.ui.toggle();
    dom.btnConsole.classList.toggle('on', this.ui.isOpen);
  }

  private toggleCinematic(): void {
    if (this.camera.activeTour) {
      this.camera.stopTour();
      dom.btnCine.classList.remove('on');
      toast('cinematic off');
    } else {
      const presets = ['canyon', 'skyline', 'aerial', 'orbit', 'canal', 'ground', 'vertical-drop'];
      const i = presets.indexOf(this.camera.activeTour ?? 'skyline');
      const next = presets[(i + 1) % presets.length];
      this.camera.startTour(next);
      dom.btnCine.classList.add('on');
      toast(`cinematic · ${next}`);
    }
  }

  private toggleHud(): void {
    this.uiVisible = !this.uiVisible;
    for (const el of [dom.stats, dom.compass, dom.keys, dom.btnConsole.parentElement!]) {
      (el as HTMLElement).style.display = this.uiVisible ? '' : 'none';
    }
  }

  private toggleDev(): void {
    if (!this.ui.isOpen) this.ui.open();
    void this.ui.send('/state');
  }

  private screenshot(): void {
    this.screenshotRequested = true;
  }

  // ---------------------------------------------------------------- loop

  private tick = (now: number, isAnimationFrame = true): void => {
    if (!this.running) return;
    // Callback entry time, not the rAF frame timestamp: that can predate a
    // window reset made between frame start and this callback ("sample outside window").
    if (isAnimationFrame) this.renderer.perf.raf(performance.now());
    requestAnimationFrame(this.tick);

    let dt = (now - this.last) / 1000;
    this.last = now;
    // Clamp so an alt-tab or a long GC pause does not teleport the sim.
    dt = Math.min(dt, 1 / 15);

    const simStart = performance.now();
    if (!this.world.paused) {
      this.input.beginFrame(dt);
      // Any deliberate manual input cancels an authored flight.
      const inp = this.input.state;
      const active = Math.abs(inp.translate[0]) + Math.abs(inp.translate[1]) + Math.abs(inp.translate[2])
        + Math.abs(inp.look[0]) + Math.abs(inp.look[1]) + Math.abs(inp.roll);
      if (active > 0.02 && (this.camera.isFlying() || this.camera.activeTour)) {
        this.camera.cancelFlight();
        this.camera.stopTour();
        dom.btnCine.classList.remove('on');
      }
      this.camera.update(dt, this.input.state);

      const simDt = dt * this.world.timeScale;
      integrateWorld(this.world, simDt);
      this.weather.update(simDt);
      const blockers = this.renderer.crowdObstacles();
      this.crowd.setStaticObstacles(blockers.obstacles, blockers.revision);
      const walking = this.renderer.crowdWalkingSurfaces();
      this.crowd.setWalkingSurfaces(walking.parts, walking.revision);
      this.crowd.update(simDt, { position: this.camera.position, lookAt: this.camera.lookTarget }, this.world);
      this.traffic.update(simDt, this.world);
      this.input.setFov(this.camera.fov);
      this.input.endFrame();
    }
    this.renderer.perf.cpu('simulation', performance.now() - simStart);

    // Entities are drawn inside the G-buffer so they get shadows, fog and
    // deferred lighting for free.
    //
    // One upload for the whole frame. `Renderer.drawEntitySet` writes at buffer
    // offset 0 on *every* call and draws from instance 0, so calling it once per
    // kind makes the last upload overwrite the first and every draw then reads
    // the same bytes — which is how a tram ends up wearing a pedestrian's
    // matrix. So the two sets are packed into one contiguous buffer, uploaded
    // once, and the per-mesh draws are issued below against the pass encoder and
    // the two getters Renderer already exposes.
    this.renderer.entityDraws.length = 0;
    this.issuedEntityDraws.length = 0;
    const vehicles = buildVehicleInstances(this.traffic, this.camera.position, this.trafficInst);
    const ped = this.crowd.instances;
    const total = ped.count + vehicles.count;
    const need = Math.max(total, 64) * INSTANCE_FLOATS;
    if (this.entityScratch.length < need) this.entityScratch = new Float32Array(need);
    const copyT0 = performance.now();
    this.entityScratch.set(ped.data.subarray(0, ped.count * INSTANCE_FLOATS), 0);
    this.entityScratch.set(vehicles.data.subarray(0, vehicles.count * INSTANCE_FLOATS), ped.count * INSTANCE_FLOATS);
    this.entityCopyMs = performance.now() - copyT0;

    this.pendingEntityTris = 0;
    this.renderer.pendingEntities = (p) => {
      this.renderer.uploadInstances(this.entityScratch, total);
      this.pendingEntityTris = this.drawEntityBlock(p, 'pedestrian', ped.count, 0);
      for (const b of vehicles.blocks) {
        this.pendingEntityTris += this.drawEntityBlock(p, b.mesh, b.count, ped.count + b.start);
      }
    };
    const beforeSubmission = this.renderer.submittedFrames;
    this.renderer.render(this.camera, dt);
    // The draws above bypass `drawEntitySet`, so they never reach
    // `renderer.counter.entityTris` and `stats.triangles` would silently
    // under-report. Add them once, from the counts the draws were issued with —
    // the same number `drawEntitySet` would have added. This disappears when
    // `drawEntitySet` takes an instance offset; see docs/TRAFFIC_REPORT.md.
    accountEntityTriangles(this.renderer.stats, this.pendingEntityTris, beforeSubmission, this.renderer.submittedFrames);
    this.frameCount++;

    if (this.screenshotRequested) {
      this.screenshotRequested = false;
      this.takeScreenshot();
    }

    this.fpsAccum += dt;
    this.fpsFrames++;
    this.hudTimer += dt;
    if (this.hudTimer > 0.25) {
      this.updateHud();
      this.hudTimer = 0;
    }
    this.governorTimer += dt;
    if (this.governorTimer > 1.5) {
      this.governQuality();
      this.governorTimer = 0;
    }
  };

  /**
   * One instanced draw for a mesh already resident in the instance buffer.
   *
   * Reaches the entity meshes and the instance buffer through the two public
   * getters `Renderer` exposes, rather than duplicating `drawEntity`'s state.
   * Returns the triangles it drew, so the caller can keep the frame's triangle
   * total honest.
   */
  private drawEntityBlock(
    p: EntityPass, key: string, count: number, offset: number,
  ): number {
    const mesh = this.renderer.entityGeometry[key];
    if (!mesh || count <= 0) {
      this.renderer.entityDraws.push(`${key}:0`);
      this.issuedEntityDraws.push(`${key}:0@${offset}`);
      return 0;
    }
    p.setVertexBuffer(0, mesh.vbo);
    p.setVertexBuffer(1, this.renderer.instanceBuffer);
    p.setIndexBuffer(mesh.ibo, mesh.indexFormat);
    p.drawIndexed(mesh.indexCount, count, 0, 0, offset);
    this.renderer.entityDraws.push(`${key}:${count}/${mesh.indexCount}`);
    this.issuedEntityDraws.push(`${key}:${count}/${mesh.indexCount}@${offset}`);
    return (mesh.indexCount / 3) * count;
  }

  // ---------------------------------------------------------------- hud

  private updateHud(): void {
    if (!this.uiVisible) return;
    const s: RendererStats = this.renderer.stats;
    const w = this.world;
    const cam = this.camera;
    const fps = this.fpsFrames / Math.max(this.fpsAccum, 1e-4);
    this.fpsAccum = 0;
    this.fpsFrames = 0;

    const alt = cam.position[1];
    const spd = cam.speed;
    const compassDeg = ((-Math.atan2(cam.forward[0], -cam.forward[2]) * 180 / Math.PI) + 360) % 360;
    const cardinal = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][
      Math.round(compassDeg / 45) % 8];

    const bar = (v: number) => {
      const n = Math.round(clamp(v, 0, 1) * 10);
      return '▰'.repeat(n) + '▱'.repeat(10 - n);
    };
    const clock = formatClock(w.dayPhase);

    dom.compass.innerHTML =
      `<span style="color:var(--accent)">${cardinal}</span> ${compassDeg.toFixed(0).padStart(3, '0')}°` +
      `&nbsp;&nbsp;·&nbsp;&nbsp;${clock}&nbsp;&nbsp;·&nbsp;&nbsp;${w.weather.sky}` +
      (w.weather.precip !== 'none' ? ` / ${w.weather.precip}` : '');

    const loadCls = s.fps > 50 ? 'spark' : s.fps > 28 ? '' : 'warn';
    dom.stats.innerHTML = [
      `<b>${fps.toFixed(0)}</b> fps <span class="${loadCls}">${bar(fps / 60)}</span>`,
      `<span class="k">alt</span> <b>${alt.toFixed(0)}</b> m &nbsp; <span class="k">spd</span> <b>${spd.toFixed(0)}</b> m/s`,
      `<span class="k">pos</span> ${cam.position[0].toFixed(0)}, ${alt.toFixed(0)}, ${cam.position[2].toFixed(0)}`,
      `<span class="k">roll</span> ${(cam.roll * 180 / Math.PI).toFixed(1)}° &nbsp; <span class="k">fov</span> ${(cam.fov * 180 / Math.PI).toFixed(0)}°`,
      `<span class="k">crowd</span> ${this.crowd.visibleCount} &nbsp; <span class="k">traffic</span> ${this.traffic.activeCount}`,
      `<span class="k">chunks</span> ${s.visibleChunks}/${s.residentChunks} &nbsp; <span class="k">draws</span> ${s.drawCalls}`,
      `<span class="k">tris</span> ${(s.triangles / 1000).toFixed(0)}k &nbsp; <span class="k">lights</span> ${s.lights}`,
      // Both timing bases, side by side. When they diverge the machine is
      // GPU-bound and `cpu` is the number that is lying.
      `<span class="k">frame</span> ${s.frameMs.toFixed(1)}ms &nbsp; <span class="k">cpu</span> ${s.cpuEncodeMs.toFixed(1)}ms`,
      `<span class="k">shadow</span> ${s.shadowDrawCalls} &nbsp; <span class="k">gbuf</span> ${s.gbufferDrawCalls}` +
      ` &nbsp; <span class="k">lod</span> ${s.lodHistogram.join('/')}`,
      `<span class="k">quality</span> ${s.tier} &nbsp; <span class="k">bake</span> ${s.bakeMs.toFixed(1)}ms` +
      (s.rebakePending ? ` &nbsp; <span class="k">rebake</span> ${s.rebakePending}` : ''),
      w.events.length
        ? `<span class="k">event</span> <span style="color:var(--accent)">${w.events[0].label}</span>`
        : '',

    ].filter(Boolean).join('<br>');
  }

  /**
   * Quality governor.
   *
   * It reads `renderer.stats.frameMs`, which is wall-clock time between frame
   * starts and therefore includes GPU execution. That is a change of basis: it
   * used to read `lastCpu * 0.9 + cpu * 0.1`, the JS-side command-buffer encode
   * time, which excludes the GPU entirely because `queue.submit` is
   * asynchronous and returns before a pixel is drawn. On a GPU-bound machine
   * that reported 0.61ms — 1639 fps — while the real frame time was 66ms at
   * 15fps. The governor therefore read the machine as having enormous headroom
   * and stepped *up* into a heavier tier, which is the exact opposite of what a
   * governor is for. Measured on an idle laptop; see the commit message.
   *
   * Hysteresis is wide on purpose: oscillating between tiers is far more
   * objectionable than a steady 40fps, so we only step down after sustained
   * pressure and step back up only with real headroom.
   */
  private governQuality(): void {
    // One basis, one meaning. `stats.fps` is the reciprocal of the same
    // wall-clock number; deriving it here from frameMs keeps a single source.
    const fps = 1000 / Math.max(this.renderer.stats.frameMs, 0.01);
    const order: QualityTier[] = ['potato', 'low', 'medium', 'high', 'ultra'];
    const cur = order.indexOf(this.renderer.quality);

    // A harness-requested tier is a measurement instruction, not a preference.
    // `capture.mjs --quality ultra` exists so a capture is taken at a known
    // tier. The downgrade branch used to ignore `qualityOverride`, so a machine
    // below 34fps was silently demoted mid-run and the capture was not at the
    // tier that was asked for — and nothing said so, because the capture still
    // produced a valid-looking PNG of a different quality setting. That is the
    // class of silent failure this repository keeps paying for.
    if (this.qualityOverride) {
      if (this.qualityOverride !== this.renderer.quality) {
        this.renderer.setQuality(this.qualityOverride);
      }
      this.qualityHold = 0;
      return;
    }

    if (fps < 34 && cur > 0) {
      this.qualityHold++;
      if (this.qualityHold > 2) {
        const next = order[cur - 1];
        this.renderer.setQuality(next);
        this.qualityHold = 0;
        toast(`quality → ${next} (${fps.toFixed(0)} fps)`);
      }
    } else if (fps > 58 && cur < order.length - 1) {
      this.qualityHold--;
      if (this.qualityHold < -6) {
        this.renderer.setQuality(order[cur + 1]);
        this.qualityHold = 0;
      }
    } else {
      this.qualityHold = 0;
    }
  }

  // ---------------------------------------------------------------- capture

  private takeScreenshot(): void {
    void this.refreshCapture().then((url) => {
    if (!url) return;
    dom.flash.style.transition = 'none';
    dom.flash.style.opacity = '0.85';
    requestAnimationFrame(() => {
      dom.flash.style.transition = 'opacity .3s ease';
      dom.flash.style.opacity = '0';
    });
    const a = document.createElement('a');
    a.download = `syzygy-${Date.now()}.png`;
    a.href = url;
    a.click();
    });
  }

  /**
   * Capture through the renderer's own readback path. `capture()` is async, so
   * the last good frame is cached and returned synchronously if a caller wants
   * an immediate string.
   */
  private lastCapture = '';
  private capturing = false;

  async refreshCapture(): Promise<string> {
    if (this.capturing) return this.lastCapture;
    this.capturing = true;
    try {
      const img = await this.renderer.captureRGBA();
      if (img) {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d')!;
        ctx.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
        this.lastCapture = c.toDataURL('image/png');
      }
    } catch (e) {
      console.error('capture failed', e);
    } finally {
      this.capturing = false;
    }
    return this.lastCapture;
  }



  // ---------------------------------------------------------------- automation

  /** The surface `tools/capture.mjs` drives. */
  automation() {
    const app = this;
    return {
      get ready() { return app.ready; },
      get frameCount() { return app.frameCount; },
      readyPromise: undefined as Promise<void> | undefined,
      stats: () => ({
        ...app.renderer.stats,
        phase: app.weather.describe(),
        // Lighting state, because "the colours are wrong" is not a debuggable
        // statement without knowing what the sun and sky are actually doing.
        sun: {
          dir: sunDirection(app.world.sun), elevation: +app.world.sun.elevation.toFixed(3),
          azimuth: +app.world.sun.azimuth.toFixed(3),
          color: app.world.sun.color.map((v) => +v.toFixed(2)),
          intensity: +app.world.sun.intensity.toFixed(2),
        },
        ambient: {
          color: app.world.sun.ambient.map((v) => +v.toFixed(2)),
          intensity: +app.world.sun.ambientIntensity.toFixed(2),
        },
        weather: {
          haze: +app.world.weather.haze.toFixed(2),
          cloud: +app.world.weather.cloudCover.toFixed(2),
          wetness: +app.world.weather.wetness.toFixed(2),
          sky: app.world.weather.sky,
        },
        lens: {
          chroma: +app.world.lens.chroma.toFixed(2),
          tiltShift: +app.world.lens.tiltShift.toFixed(2),
          bokeh: +app.world.lens.bokeh.toFixed(2),
          grain: +app.world.lens.grain.toFixed(2),
          exposure: +app.world.lens.exposure.toFixed(2),
          saturation: +app.world.lens.saturation.toFixed(2),
        },
        crowd: app.crowd.visibleCount,
      crowdSample: app.crowd.sampleInstances(4),
      entityDraws: app.renderer.entityDraws.slice(-8),
      issuedEntityDraws: app.issuedEntityDraws.slice(-8),
      trafficDraw: {
        instances: app.trafficInst.count,
        blocks: app.trafficInst.blocks.filter((b) => b.count > 0)
          .map((b) => `${b.mesh}:${b.count}@${b.start}`),
        alive: app.traffic.activeCount,
        packMs: +app.entityCopyMs.toFixed(3),
        byKind: app.trafficInst.stats,
      },
      pop: app.crowd.population(),
      rawInst: app.crowd.rawInstance(0),
      pedMesh: { idx: app.renderer.entityGeometry.pedestrian.indexCount },
        crowdDebug: { ...app.crowd.debug(), instancesCount: app.crowd.instances.count },
        traffic: app.traffic.activeCount,
        // Where the current diagnostic is standing, and what it was derived
        // from. Without this a stats dump cannot tell a good frame from a pose
        // aimed at empty ground a kilometre away — which is the whole of F2.
        derivedPose: app.heldDerivedPose(),
        warm: app.lastWarm,
      }),
      /**
       * Derive a diagnostic pose from live state and return the numbers.
       *
       * Call this, then hand the result to `setPose`. The pose a report or a
       * console print names is therefore the pose the renderer used.
       */
      pose: (id: string) => app.pose(id as DerivedPoseId),
      /** Resolve the hero once, evaluating missing spine chunks explicitly. */
      heroWalk: () => {
        const city = app.renderer.city;
        const first = deriveHeroWalk(city.plan, app.world.seed, []);
        if (first.ok) return first;
        const chunks = first.chunksMissing.flatMap((key) => {
          const [cx, cz] = key.split(',').map(Number);
          const chunk = city.getChunk(cx, cz);
          return chunk ? [chunk] : [];
        });
        const emissions = new Map(chunks.map((c) => [`${c.cx},${c.cz}`, bakeChunk(c, 0, app.world.seed).marketStalls]));
        return deriveHeroWalk(city.plan, app.world.seed, chunks, emissions);
      },
      /** Pause simulation while still presenting frames for GPU readback. */
      freezeCapture: () => { app.world.paused = true; app.renderer.freezeCaptureResidency(); },
      submittedFrames: () => app.renderer.submittedFrames,
      performanceSnapshot: () => app.renderer.perf.snapshot(),
      performanceReset: () => app.renderer.perf.reset(),
      performanceMetadata: () => ({ ...app.renderer.performanceMetadata(), qualityOverride: app.qualityOverride }),
      setPaused: (paused: boolean) => { app.world.paused = paused; },
      flyTo: (options: Parameters<FlightCamera['flyTo']>[0]) => app.camera.flyTo(options),
      captureScene: () => ({
        time: app.world.time,
        residency: app.renderer.captureResidency(),
        camera: { position: app.camera.position.slice(), lookAt: app.camera.lookTarget.slice(), roll: app.camera.roll, fov: app.camera.fov },
        cameraRendered: app.camera.getPose(),
        cameraMatrices: app.renderer.captureMatrices(),
        lens: structuredClone(app.world.lens),
        weather: structuredClone(app.world.weather),
        crowd: Array.from(app.crowd.instances.data.subarray(0, app.crowd.instances.count * INSTANCE_FLOATS)),
        crowdCount: app.crowd.instances.count,
        vehicles: structuredClone(app.traffic.vehicles),
        trafficLights: structuredClone(app.traffic.lights),
      }),
      expectedCaptureMatrices: (scene: { camera: { position: Vec3; lookAt: Vec3; roll: number }; lens: WorldState['lens'] }) =>
        app.renderer.expectedCaptureMatrices(scene.camera, scene.lens),
      /** Replay saved render poses for a material control; never resume this snapshot as a simulation. */
      replayCaptureScene: async (scene: {
        time: number; camera: Parameters<FlightCamera['setPose']>[0];
        lens: WorldState['lens']; weather: WorldState['weather']; crowd: number[]; crowdCount: number;
        vehicles: TrafficSim['vehicles']; trafficLights: TrafficSim['lights'];
        residency: { cx: number; cz: number; lod: number }[];
      }) => {
        if (!app.world.paused) throw new Error('replay requires a frozen capture');
        if (scene.crowd.length !== scene.crowdCount * INSTANCE_FLOATS || scene.crowd.length > app.crowd.instances.data.length) throw new Error('invalid saved actor buffer');
        await app.renderer.replayCaptureResidency(scene.residency);
        app.world.time = scene.time;
        Object.assign(app.world.lens, structuredClone(scene.lens));
        Object.assign(app.world.weather, structuredClone(scene.weather));
        app.camera.setPose(scene.camera);
        app.crowd.instances.data.set(scene.crowd);
        app.crowd.instances.count = scene.crowdCount;
        app.traffic.vehicles = structuredClone(scene.vehicles);
        app.traffic.lights = structuredClone(scene.trafficLights);
      },
      /** Phase changes sun/sky and normal authored lamps; scene and grade stay held. */
      capturePhase: (phase: string, scene: { weather: WorldState['weather']; lens: WorldState['lens'] }) => {
        if (!app.world.paused) throw new Error('capturePhase requires a frozen scene');
        app.weather.setPhase(phase);
        app.weather.snap();
        app.world.sun.azimuth = app.weather.targetSunState.azimuth;
        const sky = app.world.weather.sky;
        Object.assign(app.world.weather, structuredClone(scene.weather), { sky });
        Object.assign(app.world.lens, structuredClone(scene.lens));
        app.world.dayPhase = clamp((app.world.sun.elevation + 0.35) / 1.5, 0, 1);
        app.renderer.resetTemporalHistory();
      },
      /** Derive a pose from live traffic, then hand it to `setPose`. */
      trafficPose: (id: string) => app.trafficPose(id as TrafficPoseId),
      /** Synchronous streaming warm-up. `__syzygy.warm()` after `setPose`. */
      warm: (target?: number, maxTicks?: number, maxMs?: number) =>
        app.warmChunks(target ?? 96, maxTicks ?? 400, maxMs ?? 90_000),
      /**
       * Set the crowd population directly, for one control: the same camera,
       * the same frame, the population changed and nothing else.
       *
       * `0` calls `clearPopulation()`, which retires every agent immediately.
       * That distinction is the whole point: `setCount(0)` alone only caps
       * *seeding*, and Pass B still counts every agent already `active` and
       * inside `viewRadius` — it measured ~2528, so the control this comment
       * advertises could not actually be performed. With `0` it is real.
       *
       * A positive `n` sets the seeding target; the population refills over
       * `rebuildStride` frames (one slice per frame), so wait ~10 frames
       * before reading the counters back.
       */
      setCrowdCount: (n: number) => {
        // Zero also caps seeding; clearPopulation alone refills within frames.
        app.crowd.setCount(Math.max(0, n | 0));
        if ((n | 0) <= 0) app.crowd.clearPopulation();
      },
      setPose: (pose: {
        position?: [number, number, number]; lookAt?: [number, number, number];
        fov?: number; roll?: number; derive?: DerivedPoseId;
      }) => {
        app.camera.stopTour();
        let p = pose;
        if (pose.derive) {
          const r = app.pose(pose.derive);
          // Refuse rather than fall back. A pose that cannot be derived is a
          // broken diagnostic, and substituting a constant is how F2 happened.
          if (!r.ok) throw new Error(`cannot derive '${pose.derive}': ${r.reason}`);
          p = { position: r.position, lookAt: r.lookAt, fov: r.fov, roll: r.roll };
        }
        app.camera.setPose({
          position: p.position as never, lookAt: p.lookAt as never,
          fov: p.fov, roll: p.roll,
        });
      },
      setLens: (patch: Record<string, number>) => Object.assign(app.world.lens, patch),
      setDebug: (mode: number) => { app.renderer.debugView = mode; },
      setWeather: (patch: Record<string, unknown>) => {
        Object.assign(app.world.weather, patch);
        app.weather.snap();
      },
      setTime: (phase: string) => app.weather.setPhase(phase),
      /** Per-pass GPU timing: `gpuPassTiming(true)` starts a window, `gpuPassTimes()` reads it. */
      gpuPassTiming: (on: boolean) => app.renderer.setPassTiming(on),
      gpuPassTimes: () => app.renderer.passTimer?.results() ?? null,
      /** Override individual quality fields (cascades, lodRange, viewDistance, ...) for A/B runs. */
      setQualityParams: (patch: Record<string, unknown>) => {
        app.renderer.setQualityOverrides(patch as never);
        return app.renderer.settings;
      },
      setQuality: (tier: string) => {
        app.qualityOverride = tier as QualityTier;
        app.renderer.setQuality(tier as QualityTier);
      },
      /**
       * Drive the governor with a synthetic frame time and report what it does.
       *
       * The governor is otherwise only reachable through 1.5s of real wall clock,
       * which makes "does it step down on a slow frame" untestable on demand —
       * and an untestable governor is one that rots. `governQuality` reads
       * `renderer.stats.frameMs`, so overwriting that value is enough to present
       * it with an arbitrary frame time without touching the render loop.
       */
      governor: (frameMs: number, ticks = 4) => {
        const before = app.renderer.quality;
        for (let i = 0; i < ticks; i++) {
          app.renderer.stats.frameMs = frameMs;
          app.governQuality();
        }
        return {
          syntheticFrameMs: frameMs,
          fps: +(1000 / frameMs).toFixed(1),
          before,
          after: app.renderer.quality,
          override: app.qualityOverride,
        };
      },
      clearQualityOverride: () => { app.qualityOverride = null; },
      /** A/B the per-cascade shadow culling. See `renderer.shadowCullEnabled`. */
      shadowCull: (on: boolean) => { app.renderer.shadowCullEnabled = on; },
      /** Raw pixels from the renderer's own readback path, for diffing. */
      pixels: async () => {
        const img = await app.renderer.captureRGBA();
        if (!img) return null;
        return { w: img.width, h: img.height, d: Array.from(img.data) };
      },
      step: (n: number) => { for (let i = 0; i < n; i++) app.tick(performance.now(), false); },
      capture: () => app.refreshCapture(),
      probe: (t: string) => app.renderer.probe(t as never),
      camPos: () => app.camera.position.slice() as [number, number, number],
      chunkLod: (cx: number, cz: number) => app.renderer.chunkLod(cx, cz),
      cameraChunk: () => app.renderer.cameraChunk(app.camera.position),
      camLook: () => app.camera.lookTarget.slice() as [number, number, number],
      frameUniforms: () => Array.from(app.renderer.frameData.slice(0, 256)),
      ask: (text: string) => app.ui.send(text),
    };
  }
}

/** Adapter from the flight camera to the narrow port the agent layer sees. */
function makeCameraPort(cam: FlightCamera): CameraPort {
  return {
    position: () => cam.position,
    flyTo: (o) => {
      cam.cancelFlight();
      cam.flyTo({
        to: o.to, lookAt: o.lookAt, roll: o.roll, fov: o.fov,
        seconds: o.seconds ?? 2.5,
        easing: (o.easing ?? 'ease-in-out') as 'linear' | 'ease-in-out' | 'spring',
      });
    },
    cancelFlight: () => cam.cancelFlight(),
    isFlying: () => cam.isFlying(),
  };
}

function formatClock(dayPhase: number): string {
  const h = (dayPhase * 24 + 6) % 24;
  const m = Math.floor((h % 1) * 60);
  return `${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- entry

const app = new App();
(globalThis as unknown as { __syzygy: unknown }).__syzygy = app.automation();
app.start().catch(fatal);

export { app };
