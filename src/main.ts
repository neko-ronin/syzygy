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
import { clamp } from './core/math';
import { defaultWorld, integrateWorld, sunDirection, type WorldState } from './core/state';
import { Renderer, type QualityTier, type RendererStats } from './render/renderer';
import { FlightCamera } from './camera/camera';
import { Input } from './camera/input';
import { ToolExecutor, type CameraPort } from './agent/tools';
import { ConductorUI, toast } from './agent/ui';
import { CrowdSim } from './sim/crowd';
import { TrafficSim } from './sim/traffic';
import { WeatherDirector } from './sim/weather';

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

// ---------------------------------------------------------------- main

class App {
  renderer!: Renderer;
  world: WorldState = defaultWorld(0x5e7a17);
  camera!: FlightCamera;
  input!: Input;
  crowd!: CrowdSim;
  traffic!: TrafficSim;
  weather!: WeatherDirector;
  tools!: ToolExecutor;
  ui!: ConductorUI;
  port!: CameraPort;

  readonly targetsW = 1600;
  readonly targetsH = 900;
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
  ready = false;
  frameCount = 0;

  async start(): Promise<void> {
    const seed = Number(new URLSearchParams(location.search).get('seed') ?? 0x5e7a17) | 0;

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
    requestAnimationFrame(this.tick);

    setTimeout(() => {
      dom.boot.classList.add('gone');
      dom.titlecard.classList.add('show');
      setTimeout(() => dom.titlecard.classList.remove('show'), 5200);
    }, 260);
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

  private tick = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.tick);

    let dt = (now - this.last) / 1000;
    this.last = now;
    // Clamp so an alt-tab or a long GC pause does not teleport the sim.
    dt = Math.min(dt, 1 / 15);

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
      this.crowd.update(simDt, { position: this.camera.position, lookAt: this.camera.lookTarget }, this.world);
      this.traffic.update(simDt, this.world);
      this.input.setFov(this.camera.fov);
      this.input.endFrame();
    }

    // Entities are drawn inside the G-buffer so they get shadows, fog and
    // deferred lighting for free.
    this.renderer.entityDraws.length = 0;
    this.renderer.pendingEntities = (p) => {
      this.renderer.drawEntitySet(p, 'pedestrian', this.crowd.instances.data, this.crowd.instances.count);
    };
    this.renderer.render(this.camera, dt);
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
      entityDraws: app.renderer.entityDraws.slice(-4),
      pop: app.crowd.population(),
      rawInst: app.crowd.rawInstance(0),
      inView: app.crowd.inView(app.camera.position, app.camera.forward, app.camera.fov, app.targetsW / app.targetsH),
      pedMesh: { idx: app.renderer.entityGeometry.pedestrian.indexCount },
        crowdDebug: { ...app.crowd.debug(), instancesCount: app.crowd.instances.count },
        traffic: app.traffic.activeCount,
      }),
      setPose: (pose: { position?: [number, number, number]; lookAt?: [number, number, number]; fov?: number; roll?: number }) => {
        app.camera.stopTour();
        app.camera.setPose({
          position: pose.position as never, lookAt: pose.lookAt as never,
          fov: pose.fov, roll: pose.roll,
        });
      },
      setLens: (patch: Record<string, number>) => Object.assign(app.world.lens, patch),
      setDebug: (mode: number) => { app.renderer.debugView = mode; },
      setWeather: (patch: Record<string, unknown>) => {
        Object.assign(app.world.weather, patch);
        app.weather.snap();
      },
      setTime: (phase: string) => app.weather.setPhase(phase),
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
      step: (n: number) => { for (let i = 0; i < n; i++) app.tick(performance.now()); },
      capture: () => app.refreshCapture(),
      probe: (t: string) => app.renderer.probe(t as never),
      camPos: () => app.camera.position.slice() as [number, number, number],
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
