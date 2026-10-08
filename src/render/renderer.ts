/**
 * The frame graph.
 *
 *   shadow      4 cascades, depth only
 *   gbuffer     MRT: albedo+rough, normal+metal, emissive+ao, reverse-Z depth
 *   binning     compute, screen-tile light lists
 *   lighting    deferred resolve + atmosphere, HDR
 *   dof         half-res golden-angle bokeh with the tilt-shift band
 *   bloom       threshold → 5× down → 4× up
 *   taa         reproject + neighbourhood clamp against history
 *   composite   lens warp, CA, halation, tonemap, grade, vignette, grain
 *
 * Order is fixed except for the TAA/composite pair, which ping-pongs.
 */

import { GPUContext } from '../core/gpu';
import {
  mat4 as m4, mat4identity as m4identity, m4invert, m4mul, type Mat4, type Vec3,
} from '../core/math';
import { defaultWorld, fovOf, sunDirection, type WorldState } from '../core/state';
import {
  destroyMesh, FRAME_UNIFORM_SIZE, INSTANCE_FLOATS, instanceVertexLayout, makeComputePass,
  makeFrameBindGroup, makeFrameLayout, makeLayout, makeRenderPass, meshVertexLayout,
  seedTexture, uploadMesh, type GpuMesh, type Slot,
} from './gpuutil';
import { modules } from './wgsl';
import { bakeChunk, bakeGround, entityMeshes, makeInstanceWriter, MAT, type BakedChunk } from './citymesh';
import { pedestrianMesh } from './pedestrianmesh';
import {
  CASCADE_SPLITS, cascadeMatrix, cascadeParams, extractOrthoFrustum, sphereInFrustum,
} from './cascade';
import {
  TIERS, lodForDistance, chunkDistance, type QualitySettings, type QualityTier,
} from './quality';
import { City, defaultCityConfig, type CityChunk } from '../world/citygen';
import type { FlightCamera } from '../camera/camera';
import type { Mesh } from '../world/geometry';
import { FramePerf, GpuPassTimer } from './perf';
import type { BakeRequest, BakeResponse } from './bakeworker';
import { writeCaptureProjection } from './captureprojection';

// ---------------------------------------------------------------- quality

// ---------------------------------------------------------------- constants

const HDR: GPUTextureFormat = 'rgba16float';
const DEPTH: GPUTextureFormat = 'depth32float';
const SHADOW_FMT: GPUTextureFormat = 'depth32float';
const CASCADE_COUNT = 4;
/**
 * How long `render()` will decline to encode before it stops believing the GPU
 * is simply behind, and renders anyway. See the fail-open clause in `render()`.
 */
const PACING_FAIL_OPEN_MS = 250;
/** One cascade's params, padded to the dynamic-offset alignment. */
const CASCADE_STRIDE = 256;
const MAX_LIGHTS = 3072;
/**
 * Floats per light in `lightBuf`, matching `struct Light` in `lightbin.wgsl`:
 * `posRadius: vec4f` + `colorInt: vec4f`. NOT `INSTANCE_FLOATS` — that is the
 * draw-instance stride and it packs a mat4.
 */
const LIGHT_FLOATS = 8;
/**
 * Hard per-frame bake budget in milliseconds. Shared by the streaming queue and
 * the LOD rebake queue so a tier change can never spend more than this.
 */
const BAKE_BUDGET_MS = 4;
/** Off-thread bakes in flight at once: enough to keep the worker busy, few enough to stay current. */
const MAX_INFLIGHT_BAKES = 2;
/** Main-thread time for uploading finished bakes per frame; at least one always goes. */
const UPLOAD_BUDGET_MS = 3;

// ---------------------------------------------------------------- resources

interface RenderTargets {
  w: number; h: number;
  gAlbedo: GPUTexture; gNormal: GPUTexture; gEmis: GPUTexture; gDepth: GPUTexture;
  hdr: GPUTexture; hdrView: GPUTextureView;
  dof: GPUTexture; dofView: GPUTextureView;
  dofTmp: GPUTexture; dofTmpView: GPUTextureView;
  bloom: GPUTexture[]; bloomView: GPUTextureView[];
  taa: [GPUTexture, GPUTexture];
  taaView: [GPUTextureView, GPUTextureView];
  resolved: GPUTexture; resolvedView: GPUTextureView;
  /** Half-res shaft buffer. See `godRays` in post.wgsl. */
  shafts: GPUTexture; shaftsView: GPUTextureView;
}

interface ChunkEntry {
  obstacles: BakedChunk['obstacles'];
  walking: BakedChunk['walking'];
  marketStalls: BakedChunk['marketStalls'];
  version: number;
  cx: number; cz: number;
  /** Detail level this mesh was baked at. Recorded so a rebake can be audited. */
  lod: number;
  mesh: GpuMesh | null;
  foliage: GpuMesh | null;
  lights: BakedChunk['lights'];
  /** Market lanterns this chunk's bake produced, carried for the delivery stat. */
  marketProduced: number;
  radius: number;
  lastUsed: number;
  centre: Vec3;
}

export interface RendererStats {
  /**
   * Smoothed wall-clock milliseconds between encoded-frame stat publications.
   * Includes queue pacing, JS work and callback scheduling. It is neither GPU
   * execution time nor measured display presentation. `cpuEncodeMs` is JS work.
   */
  frameMs: number;
  cpuEncodeMs: number;
  fps: number;
  cpuFps: number;
  /**
   * Draws and triangles submitted in ONE frame, summed over every pass.
   * These used to be *assigned* per pass, so the four shadow passes each
   * overwrote the last and the number that survived was the G-buffer pass
   * alone — a plausible statistic reporting 1/3 of the real cost. A counter
   * that under-reports cannot be optimised against.
   */
  drawCalls: number;
  triangles: number;
  /** Same totals, split by the pass that issued them. */
  shadowDrawCalls: number;
  gbufferDrawCalls: number;
  postDrawCalls: number;
  entityDrawCalls: number;
  /**
   * World seed and camera pose, published so a capture's provenance travels with
   * it. `capture.mjs` writes both into `shots/latest.json` beside the image.
   *
   * The seed is here because it was invisible for an entire session: captures
   * rendered seed 0 while every document said 0x5e7a17, so every coordinate a
   * reviewer or an agent derived was from a different city than the frame they
   * were describing. A number a reader cannot reconstruct should not be one they
   * have to.
   */
  seed: number;
  camera: { position: Vec3; lookAt: Vec3; fov: number };
  shadowTriangles: number;
  gbufferTriangles: number;
  postTriangles: number;
  entityTriangles: number;
  /** Per-cascade shadow draws, index = cascade. */
  cascadeDrawCalls: number[];
  cascadeTriangles: number[];
  residentChunks: number;
  /** Chunk meshes drawn by the G-buffer pass. Not draws — draws are `visibleDraws`. */
  visibleChunks: number;
  /** Every draw in the G-buffer pass, including ground, foliage and entities. */
  visibleDraws: number;
  lights: number;
  /**
   * Light delivery, end to end. This exists because 365 market lanterns were
   * produced, counted by a self-test, and delivered to the frame as none of
   * them — with every counter the project owned reading healthy. The chain is
   * `produced` (grammar, at bake) -> `delivered` (in `BakedChunk.lights`, for
   * chunks the camera can see at night) -> `binned` (survived the `MAX_LIGHTS`
   * cap and reached the GPU buffer). `starved` and `rejectedFar` say which of
   * the two filters ate what, because "delivered 400, binned 300" is a
   * different bug from "produced 400, delivered 0".
   */
  /**
   * Screen-tile bin occupancy. `bins` must equal `ceil(w/16) * ceil(h/16)` or the
   * bins past the end of the buffer read back as `count == 0` and every clustered
   * light below that row is invisible. `fullTiles` counts bins that hit
   * `MAX_PER_TILE` and refused a light; `maxPerTile` is the busiest bin.
   */
  tileBins: {
    bins: number;
    capacity: number;
    maxPerTile: number;
    refusedTiles: number;
  };
  lightDelivery: {
    produced: number;
    delivered: number;
    binned: number;
    starved: number;
    rejectedFar: number;
    /**
     * The frame's `dayPhase`, and nothing else.
     *
     * This was a boolean named for a day cull, and it was a positive false claim: it said
     * lights had been culled by a day test on frames where 1083 of them had been
     * delivered. The cull was removed in `cd7b7de` and the field outlived it,
     * which is worse than never having had it — a missing diagnostic is an absence
     * a reader can notice, and a wrong one sitting in the provenance file next to
     * `delivered 1083` reads as a contradiction that will get a correct frame
     * rejected.
     *
     * So it is replaced by the underlying quantity rather than a claim about what
     * was done with it. A reviewer who wants to know "is this frame dark" reads
     * `dayPhase`; nobody has to take a statement about a filter that no longer
     * exists.
     */
    dayPhase: number;
    cap: number;
  };
  vramMB: number;
  tier: QualityTier;
  bakeMs: number;
  uploadMs: number;
  /** Chunks rejected by the camera frustum, summed over every pass this frame. */
  frustumCulled: number;
  /** Resident chunks still baked at the wrong detail level. Non-zero while a tier change settles. */
  rebakePending: number;
  /** Fraction of resident chunks at each detail level, index = lod. */
  lodHistogram: number[];
  /**
   * Wall-clock cost of the last `captureRGBA()`, split by phase.
   *
   * This exists because the per-call cost of a readback was measured three times
   * in three sessions and each time it was attributed to something else —
   * streaming, "frames settling", a queue backlog — while adding presented
   * frames in between did not move it. A single total cannot distinguish
   * "the GPU had work to retire" from "this function is slow", and those two
   * have opposite fixes. `phases.map` is the `mapAsync` wait: it absorbs both
   * the GPU work queued ahead of it and any readback stall, so it is the phase
   * to look at first.
   */
  captureMs: number;
  capturePhases: CapturePhases;
  /**
   * Shafted volumetrics — the diagnostic that stops `godRays` being a phantom
   * again. `strength` is the value the CPU wrote into `weather2.y` this frame;
   * `passRan` says the pass was actually encoded; `sunOnScreen` says whether the
   * sun projects inside the frame, which is the precondition for a shaft being
   * visible at all. All three read zero/false on a clear pose, and the whole
   * point is that they move when the field does.
   */
  shafts: { strength: number; passRan: boolean; sunOnScreen: boolean; sunUv: [number, number] };
  /**
   * rAF ticks that `render()` declined to encode since the last frame it did
   * encode, because the queue was full or a readback was in flight. Zero in
   * steady state; a large value means the loop is asking for frames faster than
   * the machine can retire them, which is the condition every readback in this
   * project was paying for.
   */
  framesSkipped: number;
  /**
   * Frames submitted to the GPU but not yet reported retired, sampled at the end
   * of the frame that published this stat. With `MAX_FRAMES_IN_FLIGHT` = 2 this
   * should never exceed 2; a value in the hundreds is the queue-drain defect
   * that made every readback in the project cost seconds, made visible.
   */
  framesInFlight: number;
}

/** Phase-by-phase milliseconds for one `captureRGBA()`. */
export interface CapturePhases {
  /** (Re)allocating the offscreen capture texture. */
  tex: number;
  /** Recording the composite pass. */
  encode: number;
  /** Allocating the readback buffer. */
  buf: number;
  /** `copyTextureToBuffer` + `queue.finish()` + `queue.submit`. */
  submit: number;
  /** Awaiting `mapAsync`: everything queued ahead of it has to retire first. */
  map: number;
  /** `getMappedRange` plus the per-pixel BGRA→RGBA swizzle. */
  read: number;
  /** `unmap` + `destroy`. */
  free: number;
  /** Sum of the phases above. Differs from `captureMs` only by JSON marshalling. */
  total: number;
  /** Capture texture size in pixels, and the padded bytes-per-row actually copied. */
  w: number;
  h: number;
  bytes: number;
}

export class Renderer {
  readonly perf = new FramePerf();
  private captureFrozen = false;
  /** Natural streaming bakes here when Workers exist; see bakeworker.ts. */
  private baker: Worker | null = null;
  private bakeSeq = 0;
  private inflight = new Map<number, { cx: number; cz: number; lod: number; rebake: boolean }>();
  private inflightKeys = new Set<string>();
  private bakedReady: { cx: number; cz: number; lod: number; rebake: boolean; baked: BakedChunk }[] = [];
  /** Warm-up and captures bake synchronously so residency is settled when they return. */
  streamSync = false;
  private residencyRevision = 0;
  private obstacleCache: { revision: number; obstacles: BakedChunk['obstacles'] } = { revision: -1, obstacles: [] };
  private walkingCache: { revision: number; triangles: Float32Array } = { revision: -1, triangles: new Float32Array(0) };
  readonly gpu: GPUContext;
  readonly city: City;
  readonly world: WorldState;

  quality: QualityTier = 'high';
  private q: Omit<QualitySettings, 'tier'> = TIERS.high;

  private targets: RenderTargets | null = null;
  private targetsW = 0;
  private targetsH = 0;

  readonly frameData = new Float32Array(FRAME_UNIFORM_SIZE / 4);
  /** 0 = off, 1 = resolved only, 2 = bloom, 3 = DOF, 4 = no warp/CA, 5 = no tonemap. */
  debugView = 0;
  private postGroups = new Map<string, GPUBindGroup>();
  /**
   * A 1x1 black HDR view bound into any post slot that would alias the pass's
   * own write target. WebGPU forbids sampling and writing the same resource in
   * one synchronisation scope, and the post chain legitimately has passes that
   * would read their own output slot.
   */
  private blackView!: GPUTextureView;
  private blackTex!: GPUTexture;
  private shadowUbo!: GPUBuffer;

  private frameBgl!: GPUBindGroupLayout;
  private frameBg!: GPUBindGroup;
  private clampSamp!: GPUSampler;
  private skyLutView!: GPUTextureView;
  private skyLutSamp!: GPUSampler;
  private skyLutPass!: ReturnType<typeof makeRenderPass>;
  private shadowCmp!: GPUSampler;

  private gbufferPass!: ReturnType<typeof makeRenderPass>;
  private shadowPass!: ReturnType<typeof makeRenderPass>;
  private lightingPass!: ReturnType<typeof makeRenderPass>;
  private dofPass!: ReturnType<typeof makeRenderPass>;
  private bloomDown!: ReturnType<typeof makeRenderPass>;
  private bloomUp!: ReturnType<typeof makeRenderPass>;
  private taaPass!: ReturnType<typeof makeRenderPass>;
  private compositePass!: ReturnType<typeof makeRenderPass>;
  private blitPass!: ReturnType<typeof makeRenderPass>;
  private binClear!: ReturnType<typeof makeComputePass>;
  private binRun!: ReturnType<typeof makeComputePass>;

  private lightBuf!: GPUBuffer;
  private tileBuf!: GPUBuffer;
  /** Bins `tileBuf` can address. See `allocTiles` — this used to be hard-coded. */
  private tileCapacity = 0;
  private instBuf!: GPUBuffer;
  private identityInst!: GPUBuffer;
  private groundInst!: GPUBuffer;

  private chunks = new Map<string, ChunkEntry>();
  private ground!: GpuMesh;
  private entities!: Record<string, GpuMesh>;

  private view: Mat4 = m4();
  private proj: Mat4 = m4();
  private viewProj: Mat4 = m4();
  private invViewProj: Mat4 = m4();
  /** Starts as identity, not zeros: a zero matrix reprojects everything to NaN. */
  private prevViewProj: Mat4 = m4identity(m4());
  private cascadeMats: Mat4[] = Array.from({ length: CASCADE_COUNT }, () => m4());
  /**
   * World-space planes (6 x vec4) of each cascade's orthographic box, in the
   * same normalised layout `camera.frustumPlanes` uses, so the same
   * `sphereInFrustum` rejects chunks against a cascade exactly as it rejects
   * them against the camera.
   */
  private cascadePlanes: Float32Array[] = Array.from(
    { length: CASCADE_COUNT }, () => new Float32Array(24));
  /**
   * Diagnostic: when false, every cascade falls back to the camera frustum and
   * the renderer reverts to submitting the full chunk set to all of them. This
   * exists so "does per-cascade culling change the picture?" can be answered by
   * diffing two frames instead of by staring at one and forming an opinion.
   */
  shadowCullEnabled = true;
  private cascadeSplits = new Float32Array([60, 220, 700, 2400]);

  private frameIndex = 0;
  private lastCpu = 0;
  /** `performance.now()` of the previous frame, for the wall-clock frame time. */
  private lastFrameAt = 0;
  /** EMA of wall-clock frame time. 0 means "no measurement yet". */
  private wallAccum = 0;
  private bakeAccum = 0;
  private frameTimes: number[] = [];
  /**
   * True from the moment `captureRGBA()` starts recording until its `mapAsync`
   * has resolved. While it is set, `render()` declines to submit.
   *
   * `mapAsync` resolves only when the device has retired everything submitted
   * *ahead of it* on the same queue, so a readback is a queue drain wearing a
   * copy's clothes. Gating for the duration of the readback bounds what is ahead
   * of the fence by the work already queued, which is the only part the readback
   * is responsible for. Without the gate the fence also waits for every frame
   * the loop submits while it is blocked, which on this machine was 440-528 rAF
   * ticks — not presented frames, ticks: the loop is not waiting for the GPU.
   */
  private capturePending = false;
  /**
   * Frames submitted to the GPU that `onSubmittedWorkDone` has not yet reported
   * as retired. Published as `stats.framesInFlight` because "the queue is deep"
   * is otherwise an unfalsifiable claim: on this machine rAF ran at 87-114 ticks
   * per second while a single fence took seconds, and nothing in `stats` could
   * say whether the fence was waiting for 2 frames or for 2000.
   */
  private framesInFlight = 0;
  /**
   * Frames may be submitted-but-unretired before `render()` stops encoding.
   *
   * Measured, not reasoned, and the measurement is the uncomfortable one: rAF in
   * headless Chromium free-runs, and this loop hands the GPU a 3-7M-triangle,
   * four-cascade frame every 8.8-9.9 ms of CPU encode time without ever waiting
   * for one to retire. Every fence in the project therefore had to drain a queue
   * that was still being refilled, and `mapAsync` in `captureRGBA()` spent
   * 0.65-16.8 s there depending on what else was using the GPU — while
   * `probe()`, which copies 27 bytes through the identical submit / `mapAsync` /
   * `getMappedRange` path, spent 1.3-12.8 s in the same minutes. A readback that
   * transfers 200000x less data and costs the same is not paying for its data.
   *
   * Two frames, not one: `getCurrentTexture()` cannot block forever and a single
   * frame in flight serialises the loop on the fence callback, which is a latency
   * of its own.
   *
   * NOT MEASURED AS A SPEEDUP, and the honest reason is in HANDOFF.md: four
   * capture runs on a GPU shared with other agents produced per-call times from
   * 0.65 s to 28.8 s for the same code, and the quality governor moved the tier
   * mid-run in the last one. What this change does buy is an invariant —
   * `framesInFlight` cannot exceed 2, so a fence's worst case is two frames of
   * work rather than however long the page has been open. That is a bound, not a
   * benchmark, and it should be re-measured on an idle machine before anyone
   * quotes a number for it.
   */
  private static readonly MAX_FRAMES_IN_FLIGHT = 2;
  /** rAF ticks `render()` declined to encode: the queue was full or a readback was in flight. */
  private skipped = 0;
  /** `performance.now()` of the last submit, for the pacing fail-open. */
  private lastSubmitAt = 0;
  /**
   * Scratch for the packed light array. Sized for the shader's 8-float stride,
   * not `INSTANCE_FLOATS`: reusing the instance writer is what put the positions
   * 48 bytes from where the shader looked.
   */
  private lightWriter = makeInstanceWriter(Math.ceil(MAX_LIGHTS * LIGHT_FLOATS / INSTANCE_FLOATS) + 8);
  /**
   * Scratch for the distance-ordered bin. Reused every frame so the sort does
   * not allocate; `gatherLights` runs once per frame at night.
   */
  private lightCandidates: { l: BakedChunk['lights'][number]; d: number }[] = [];
  private pendingBakes: { cx: number; cz: number }[] = [];
  /**
   * Resident chunks whose baked detail level is now wrong, with the level they
   * should be at. Drained under the same 4ms budget as new bakes so a tier
   * change spreads over as many frames as it needs instead of stalling one.
   */
  private rebakeQueue: { cx: number; cz: number }[] = [];
  private rebakeDirty = false;
  /** Keys currently in `rebakeQueue`, so a per-frame scan cannot double-queue. */
  private rebakeQueued = new Set<string>();

  stats: RendererStats = {
    frameMs: 16.7, cpuEncodeMs: 0, fps: 60, cpuFps: 60,
    drawCalls: 0, triangles: 0,
    shadowDrawCalls: 0, gbufferDrawCalls: 0, postDrawCalls: 0, entityDrawCalls: 0,
    shadowTriangles: 0, gbufferTriangles: 0, postTriangles: 0, entityTriangles: 0,
    cascadeDrawCalls: Array.from({ length: CASCADE_COUNT }, () => 0),
    cascadeTriangles: Array.from({ length: CASCADE_COUNT }, () => 0),
    residentChunks: 0, visibleChunks: 0, visibleDraws: 0, lights: 0, vramMB: 0,
    seed: 0,
    camera: { position: [0, 0, 0], lookAt: [0, 0, -1], fov: 1 },
    lightDelivery: {
      produced: 0, delivered: 0, binned: 0, starved: 0, rejectedFar: 0,
      dayPhase: 0, cap: MAX_LIGHTS,
    },
    tileBins: { bins: 0, capacity: 0, maxPerTile: 0, refusedTiles: 0 },
    tier: 'high', bakeMs: 0, uploadMs: 0, frustumCulled: 0,
    rebakePending: 0, lodHistogram: [0, 0, 0, 0],
    captureMs: 0,
    shafts: { strength: 0, passRan: false, sunOnScreen: false, sunUv: [0, 0] },
    capturePhases: {
      tex: 0, encode: 0, buf: 0, submit: 0, map: 0, read: 0, free: 0, total: 0,
      w: 0, h: 0, bytes: 0,
    },
    framesSkipped: 0,
    framesInFlight: 0,
  };

  /**
   * Per-frame draw accounting. Reset at the top of `render()` and folded into
   * `stats` at the bottom, so every pass *adds* and nothing is overwritten.
   * Kept as a flat mutable object rather than fields on `stats` so that a pass
   * mid-frame never publishes a partial total as if it were the whole frame.
   */
  private counter = {
    shadow: 0, gbuffer: 0, post: 0, entity: 0,
    shadowTris: 0, gbufferTris: 0, postTris: 0, entityTris: 0,
    culled: 0, chunkMeshes: 0,
    cascade: Array.from({ length: CASCADE_COUNT }, () => 0),
    cascadeTris: Array.from({ length: CASCADE_COUNT }, () => 0),
  };

  private resetCounter(): void {
    const c = this.counter;
    c.shadow = c.gbuffer = c.post = c.entity = 0;
    c.shadowTris = c.gbufferTris = c.postTris = c.entityTris = 0;
    c.culled = 0; c.chunkMeshes = 0;
    for (let i = 0; i < CASCADE_COUNT; i++) { c.cascade[i] = 0; c.cascadeTris[i] = 0; }
  }

  private constructor(gpu: GPUContext, world: WorldState, city: City) {
    this.gpu = gpu;
    this.world = world;
    this.city = city;
  }

  static async create(canvas: HTMLCanvasElement, seed = 0x5e7a17): Promise<Renderer> {
    const gpu = await GPUContext.create(canvas);
    const world = defaultWorld(seed);
    const city = new City(defaultCityConfig(seed));
    const r = new Renderer(gpu, world, city);
    r.init();
    return r;
  }

  // ---------------------------------------------------------------- init

  private init(): void {
    this.startBaker();
    const dev = this.gpu.device;

    this.frameBgl = makeFrameLayout(dev);
    this.frameBg = makeFrameBindGroup(dev, this.frameBgl, this.gpu.frameUbo);

    this.shadowUbo = dev.createBuffer({
      label: 'shadow-params', size: CASCADE_COUNT * CASCADE_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.lightBuf = dev.createBuffer({
      label: 'lights', size: MAX_LIGHTS * 32,
      // COPY_SRC so `probe('lights')` can read the packed array back. Without it
      // the copy is a validation error and the readback returns zeros — which is
      // the second time in two rounds that a missing usage flag produced a
      // measurement of nothing rather than an error.
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.allocTiles(dev);
    this.instBuf = dev.createBuffer({
      label: 'instances', size: 4096 * 96,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.identityInst = dev.createBuffer({
      label: 'identity-instance', size: 96,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.groundInst = dev.createBuffer({
      label: 'ground-instance', size: 96,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    // The identity instance: unit model, white tint, generic material. Every
    // static chunk draw uses this, so all world geometry is baked in world
    // space and needs no per-object uniforms.
    dev.queue.writeBuffer(this.identityInst, 0, new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
      1, 1, 1, 1, 0, 0.62, 0, 0,
    ]));
    // The street deck gets its own material id so the fragment stage does not
    // try to synthesise a facade onto a horizontal plane.
    dev.queue.writeBuffer(this.groundInst, 0, new Float32Array([
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
      1, 1, 1, 1, MAT.STREET, 0.55, 0, 0,
    ]));

    this.clampSamp = dev.createSampler({
      label: 'clamp', magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });
    this.skyLutView = dev.createTexture({
      label: 'sky-lut', size: [512, 256], format: HDR,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    }).createView();
    // Repeat around the horizon so the equirect seam samples across it.
    this.skyLutSamp = dev.createSampler({
      label: 'sky-lut', magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'repeat', addressModeV: 'clamp-to-edge',
    });
    this.shadowCmp = dev.createSampler({
      label: 'shadow-cmp', compare: 'less', magFilter: 'linear', minFilter: 'linear',
      addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
    });

    this.buildPipelines();
    this.buildStaticGeometry();

    // Seed the shadow atlas with 1.0 so un-rendered cascades return "lit".
    this.allocShadow();
    for (let i = 0; i < CASCADE_COUNT; i++) {
      const t = this.shadowTex[i];
      seedTexture(this.gpu, t, true, 1.0);
    }

    this.allocBlack();
    this.gpu.resize(this.q.renderScale);
    this.resize();
  }

  private allocBlack(): void {
    const seed = this.gpu.makeTexture('black-seed', 1, 1, 'rgba16float',
      GPUTextureUsage.RENDER_ATTACHMENT);
    seedTexture(this.gpu, seed, false, 0);
    this.blackTex = this.gpu.makeTexture('black', 1, 1, 'rgba16float',
      GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);
    this.blackView = this.blackTex.createView();
  }

  private shadowTex: GPUTexture[] = [];
  private shadowView: GPUTextureView[] = [];

  private allocShadow(): void {
    const dev = this.gpu.device;
    const res = this.q.shadowRes;
    if (this.shadowTex[0]?.width === res) return;
    for (const t of this.shadowTex) t.destroy();
    this.shadowTex = [];
    this.shadowView = [];
    for (let i = 0; i < CASCADE_COUNT; i++) {
      const t = dev.createTexture({
        label: `shadow${i}`, size: [res, res], format: SHADOW_FMT,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      this.shadowTex.push(t);
      this.shadowView.push(t.createView());
    }
  }

  private buildPipelines(): void {
    const dev = this.gpu.device;
    const mvl = meshVertexLayout();
    const ivl = instanceVertexLayout();

    // --- gbuffer
    this.gbufferPass = makeRenderPass(dev, {
      label: 'gbuffer',
      code: modules.gbuffer,
      vs: 'vs', fs: 'fs',
      groups: [this.frameBgl],
      color: [
        { format: 'rgba8unorm' },
        { format: HDR },
        { format: HDR },
      ],
      // Reverse-Z: near maps to 1 and far to 0, so the clear value is 0 and the
      // test is `greater`. Using `less` here rejects every fragment including
      // the clear, and the world silently renders as empty sky.
      depth: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' },
      vertexBuffers: [mvl, ivl],
      cull: 'back',
    });

    // --- shadow (depth only, two entry points)
    const shadowGroup2 = makeLayout(dev, 'shadow:g2', [
      { binding: 0, kind: 'ubo', visibility: GPUShaderStage.VERTEX, dynamic: true },
    ]);
    // The shadow module includes `common`, which reserves group(1) for the
    // shadow map, so the cascade params must sit at group(2) with a real
    // (empty) layout at group(1) to keep the indices aligned.
    const emptyBgl = makeLayout(dev, 'empty', []);
    this.shadowPass = makeRenderPass(dev, {
      label: 'shadow',
      code: modules.shadow,
      vs: 'vs', fs: 'fs',
      groups: [this.frameBgl, emptyBgl, shadowGroup2],
      color: [],
      depth: { format: SHADOW_FMT, depthWriteEnabled: true, depthCompare: 'less' },
      vertexBuffers: [mvl, ivl],
      cull: 'front',
    });
    this.shadowUboBgl = shadowGroup2;
    this.emptyBindGroup = dev.createBindGroup({ label: 'empty-bg', layout: emptyBgl, entries: [] });

    // --- lighting
    const lightSlots: Slot[] = [
      { binding: 0, kind: 'depthTex' }, { binding: 1, kind: 'cmpSampler' },
      { binding: 2, kind: 'tex' }, { binding: 3, kind: 'tex' },
      { binding: 4, kind: 'tex' }, { binding: 5, kind: 'depthTex' },
      { binding: 6, kind: 'sampler' },
      { binding: 7, kind: 'ssbo' }, { binding: 8, kind: 'ssbo' },
      { binding: 9, kind: 'tex' }, { binding: 10, kind: 'sampler' },
    ];
    this.lightBgl = makeLayout(dev, 'lighting:bgl', lightSlots);
    this.skyLutPass = makeRenderPass(dev, {
      label: 'sky-lut', code: modules.lighting, vs: 'vsFullscreen', fs: 'fsSkyLut',
      groups: [this.frameBgl], color: [{ format: HDR }], cull: 'none',
    });
    this.lightingPass = makeRenderPass(dev, {
      label: 'lighting',
      code: modules.lighting,
      vs: 'vsFullscreen', fs: 'fs',
      groups: [this.frameBgl, this.lightBgl],
      color: [{ format: HDR }],
      cull: 'none',
    });

    // --- light binning
    const binBgl = makeLayout(dev, 'lightbin:bgl', [
      { binding: 0, kind: 'ssbo', visibility: GPUShaderStage.COMPUTE },
      { binding: 1, kind: 'ssbo-rw', visibility: GPUShaderStage.COMPUTE },
      { binding: 2, kind: 'depthTex', visibility: GPUShaderStage.COMPUTE },
    ]);
    this.binClear = makeComputePass(dev, 'bin:clear', modules.lightbin, 'clear', [this.frameBgl, binBgl]);
    this.binRun = makeComputePass(dev, 'bin:run', modules.lightbin, 'bin', [this.frameBgl, binBgl]);
    this.binBgl = binBgl;

    // --- post family
    const postBgl = makeLayout(dev, 'post:bgl', [
      { binding: 0, kind: 'depthTex' }, { binding: 1, kind: 'cmpSampler' },
      { binding: 2, kind: 'tex' }, { binding: 3, kind: 'tex' },
      { binding: 4, kind: 'tex' }, { binding: 5, kind: 'tex' },
      { binding: 6, kind: 'sampler' }, { binding: 7, kind: 'tex' },
      // Scene depth, for the shaft pass only. It is the whole occlusion signal:
      // a shaft exists where the line of sight to the sun is not blocked by
      // geometry, and that is exactly what the depth buffer knows.
      { binding: 8, kind: 'depthTex' },
    ]);
    this.postBgl = postBgl;
    const postGroups = [this.frameBgl, postBgl];
    const mk = (label: string, vs: string, fs: string, format: GPUTextureFormat) =>
      makeRenderPass(dev, { label, code: modules.post, vs, fs, groups: postGroups, color: [{ format }], cull: 'none' });
    this.dofPass = mk('dof', 'fsFull', 'dofBlur', HDR);
    this.bloomDown = mk('bloom-down', 'fsFull', 'bloomDown', HDR);
    this.bloomThreshold = mk('bloom-threshold', 'fsFull', 'bloomPrefilter', HDR);
    this.bloomUp = mk('bloom-up', 'fsFull', 'bloomUp', HDR);
    this.taaPass = mk('taa', 'fsFull', 'taa', HDR);
    this.shaftPass = mk('shafts', 'fsFull', 'shafts', HDR);
    this.blitPass = mk('blit', 'fsFull', 'blit', HDR);
    this.compositePass = makeRenderPass(dev, {
      label: 'composite', code: modules.post, vs: 'fsFull', fs: 'composite',
      groups: postGroups, color: [{ format: this.gpu.format }], cull: 'none',
    });
  }

  private lightBgl!: GPUBindGroupLayout;
  private postBgl!: GPUBindGroupLayout;
  private binBgl!: GPUBindGroupLayout;
  private shadowUboBgl!: GPUBindGroupLayout;
  private emptyBindGroup!: GPUBindGroup;

  private buildStaticGeometry(): void {
    const ground = bakeGround(4096, this.world.seed);
    this.ground = uploadMesh(this.gpu, 'ground', ground.mesh);
    this.entities = {
      pedestrian: uploadMesh(this.gpu, 'ped', pedestrianMesh()),
      tram: uploadMesh(this.gpu, 'tram', entityMeshes.tramCar()),
      cablecar: uploadMesh(this.gpu, 'cablecar', entityMeshes.cableCar()),
      blimp: uploadMesh(this.gpu, 'blimp', entityMeshes.blimp()),
      balloon: uploadMesh(this.gpu, 'balloon', entityMeshes.balloon()),
      rider: uploadMesh(this.gpu, 'rider', entityMeshes.ziplineRider()),
    };
  }

  // ---------------------------------------------------------------- sizing

  /**
   * Change quality tier.
   *
   * The tier sets three things that chunks are already-resident data for:
   * `lodRange` (what detail they were baked at), `foliageEnabled` (whether
   * their foliage mesh was uploaded at all) and `viewDistance` (which chunks
   * should exist). So a tier change has to invalidate the residency set, not
   * just the render targets.
   *
   * It does NOT re-bake anything here. Doing that inline would stall the frame
   * the tier changed in — and a governor step-down fires exactly when the
   * machine is already behind, so the stall would land on the worst possible
   * frame. Instead every resident chunk is queued for a rebake at its new
   * detail level and `streamChunks` drains the queue under its existing 4ms
   * budget. Chunks whose level happens to be unchanged are not queued at all.
   */
  setQuality(tier: QualityTier): void {
    if (this.quality === tier) return;
    this.quality = tier;
    this.applyQuality();
  }

  /** Per-pass GPU timing for attribution; off by default. Re-enabling starts a fresh window. */
  passTimer: GpuPassTimer | null = null;
  setPassTiming(on: boolean): boolean {
    this.passTimer?.destroy();
    this.passTimer = on && this.gpu.device.features.has('timestamp-query') ? new GpuPassTimer(this.gpu.device) : null;
    return this.passTimer !== null;
  }

  /** Field overrides on top of the tier, for A/B attribution; recorded in `settings`. */
  setQualityOverrides(patch: Partial<Omit<QualitySettings, 'tier'>>): void {
    this.qualityOverrides = { ...patch };
    this.applyQuality();
  }
  private qualityOverrides: Partial<Omit<QualitySettings, 'tier'>> = {};

  private applyQuality(): void {
    this.q = { ...TIERS[this.quality], ...this.qualityOverrides };
    this.allocShadow();
    // Cascades may have shrunk; drop the now-unused atlas entries.
    for (let i = this.q.cascades; i < CASCADE_COUNT; i++) {
      seedTexture(this.gpu, this.shadowTex[i], true, 1.0);
    }
    this.resize();

    // Every resident chunk is a candidate for a rebake, because the tier decides
    // its detail level and the camera chunk — which the level is measured from
    // — is not known here. `streamChunks` recomputes the level against the live
    // camera and skips any chunk whose level is already right, so a tier change
    // that does not move the LOD table (potato and low are both [0,3]) costs
    // nothing beyond the scan. The pending list was built against the old
    // `viewDistance`, so drop it and let the next frame rebuild it.
    this.pendingBakes.length = 0;
    this.rebakeQueued.clear();
    for (const e of this.chunks.values()) {
      const key = this.chunkKey(e.cx, e.cz);
      if (this.rebakeQueued.has(key)) continue;
      this.rebakeQueued.add(key);
      this.rebakeQueue.push({ cx: e.cx, cz: e.cz });
    }
    this.rebakeDirty = true;
  }

  get settings(): QualitySettings { return { tier: this.quality, ...this.q }; }

  performanceMetadata() {
    const canvas = this.gpu.canvas;
    const rect = canvas.getBoundingClientRect();
    return {
      adapter: this.gpu.caps.adapterInfo, features: [...this.gpu.device.features],
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      canvas: { width: canvas.width, height: canvas.height, cssWidth: rect.width, cssHeight: rect.height },
      internal: { width: this.targetsW, height: this.targetsH }, settings: this.settings,
      city: { chunkSize: this.city.cfg.chunkSize, radiusChunks: this.city.cfg.radiusChunks, finite: true },
      gpuTiming: 'unavailable: timestamp ring not attached to frame passes',
    };
  }

  private resize(): void {
    const { w, h } = this.gpu.resize(this.q.renderScale);
    if (w === this.targetsW && h === this.targetsH && this.targets) return;
    this.targetsW = w; this.targetsH = h;
    this.allocTargets(w, h);
    // The tile bins are sized from the target resolution, so they have to be
    // reallocated with it. Missed this at first and the resize path left the
    // old, smaller buffer in place — which is the same class of silent
    // disagreement this method exists to remove.
    this.allocTiles(this.gpu.device);
  }

  private allocTargets(w: number, h: number): void {
    const gpu = this.gpu;
    const t = this.targets;
    if (t) {
      for (const k of ['gAlbedo', 'gNormal', 'gEmis', 'gDepth', 'hdr', 'dof', 'dofTmp', 'resolved', 'shafts'] as const) t[k].destroy();
      for (const b of t.bloom) b.destroy();
      for (const a of t.taa) a.destroy();
    }
    const RT = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const mk = (label: string, ww: number, hh: number, format: GPUTextureFormat, usage = RT) =>
      gpu.makeTexture(label, ww, hh, format, usage);

    const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
    const gAlbedo = mk('g-albedo', w, h, 'rgba8unorm', RT | GPUTextureUsage.COPY_SRC);
    const gNormal = mk('g-normal', w, h, HDR);
    const gEmis = mk('g-emissive', w, h, HDR);
    const gDepth = mk('g-depth', w, h, DEPTH);
    const hdr = mk('hdr', w, h, HDR, RT | GPUTextureUsage.COPY_SRC);
    const dof = mk('dof', hw, hh, HDR);
    const dofTmp = mk('dof-tmp', hw, hh, HDR);
    const resolved = mk('resolved', w, h, HDR, RT | GPUTextureUsage.COPY_SRC);
    // Shafts are computed at half resolution and added in the composite. Half is
    // not a compromise for its own sake: a radial march is 14 depth fetches per
    // pixel, and at 1600x900 full-res that is 20M fetches a frame on a laptop
    // that is already at 2.4-10.9M triangles. Shafts are a low-frequency
    // effect; nothing in them survives the 2x upsample.
    const shafts = mk('shafts', hw, hh, HDR);

    const bloom: GPUTexture[] = [];
    const bloomView: GPUTextureView[] = [];
    for (let i = 0; i < this.q.bloomLevels; i++) {
      const s = 1 << (i + 1);
      const bw = Math.max(1, w / s | 0), bh = Math.max(1, h / s | 0);
      const tex = mk(`bloom${i}`, bw, bh, HDR);
      bloom.push(tex);
      bloomView.push(tex.createView());
    }

    const taaTex = [mk('taa0', w, h, HDR), mk('taa1', w, h, HDR)] as [GPUTexture, GPUTexture];
    this.targets = {
      w, h, gAlbedo, gNormal, gEmis, gDepth, hdr,
      hdrView: hdr.createView(),
      dof, dofView: dof.createView(),
      dofTmp, dofTmpView: dofTmp.createView(),
      bloom, bloomView,
      taa: taaTex,
      taaView: [taaTex[0].createView(), taaTex[1].createView()],
      resolved, resolvedView: resolved.createView(),
      shafts, shaftsView: shafts.createView(),
    };
    this.postGroups.clear();
  }

  // ---------------------------------------------------------------- uniforms

  /**
   * Write the frame block. Layout mirrors `struct Frame` in common.wgsl:
   * 9 mat4 (576B) then 19 vec4 (304B) = 880B, padded out to 1024B.
   */
  private writeFrameUniforms(cam: FlightCamera): void {
    const d = this.frameData;
    const w = this.world;
    const near = 0.1;
    writeCaptureProjection(this.view, this.proj, cam.position, cam.lookTarget, cam.roll, fovOf(w), this.targetsW, this.targetsH);
    m4mul(this.viewProj, this.proj, this.view);
    m4invert(this.invViewProj, this.viewProj);
    const prev = this.prevViewProj;
    this.prevViewProj.set(this.viewProj);

    d.set(this.viewProj, 0);
    d.set(this.view, 16);
    d.set(this.invViewProj, 32);
    d.set(prev, 48);
    d.set(this.cascadeMats[0], 64);
    d.set(this.cascadeMats[1], 80);
    d.set(this.cascadeMats[2], 96);
    d.set(this.cascadeMats[3], 112);

    const s = sunDirection(w.sun);
    const wp = cam.getPose();
    // 9 mat4 precede the vec4 block in `struct Frame`, so the scalars start at
    // float 144. Getting this wrong silently shifts *every* uniform.
    let o = 144;
    const put = (a: number, b: number, c: number, e: number) => {
      d[o++] = a; d[o++] = b; d[o++] = c; d[o++] = e;
    };
    put(wp.position[0], wp.position[1], wp.position[2], near);
    put(s[0], s[1], s[2], w.sun.intensity);
    put(w.sun.color[0], w.sun.color[1], w.sun.color[2], w.dayPhase);
    put(w.sun.ambient[0], w.sun.ambient[1], w.sun.ambient[2], w.sun.ambientIntensity);
    put(w.sun.bounce[0], w.sun.bounce[1], w.sun.bounce[2], w.sun.bounceIntensity);
    put(w.weather.haze, w.weather.hazeFalloff, w.weather.cloudCover, w.weather.aerialHaze);
    put(w.weather.wetness, w.weather.godRays, w.weather.windSpeed, w.weather.motes);
    put(w.weather.windDir, w.weather.storminess, w.weather.scatter, precipId(w.weather.precip));
    put(w.weather.bloomStrength, w.lens.saturation, w.lens.grain, w.lens.exposure);
    put(this.targetsW, this.targetsH, 1 / this.targetsW, 1 / this.targetsH);
    put(w.time, cam.speed, this.frameIndex, this.q.renderScale > 1 ? 1 : 0.55);
    put(fovOf(w), cam.roll, w.lens.warp, w.lens.speedFov);
    put(w.lens.tiltShift, w.lens.focusCenter, w.lens.focusWidth, w.lens.bokeh);
    put(w.lens.distortion, w.lens.chroma, w.lens.vignette, w.lens.horizonBend);
    // grade.w carries the packed local-light count for lightbin.wgsl. It was
    // written as a literal 0 and documented "unused" — verified unused, with
    // `F.grade` read only as `.rgb` in post.wgsl. Reading the count from the
    // uniform rather than `arrayLength(&lights)` is what stops the binner walking
    // 3072 entries and binning last frame's leftovers; see lightbin.wgsl.
    put(w.lens.colorGrade[0], w.lens.colorGrade[1], w.lens.colorGrade[2], this.stats.lights);
    put(this.q.cascades, 1 / this.q.shadowRes, 0.0016, 2400);
    d[o] = this.cascadeSplits[0]; d[o + 1] = this.cascadeSplits[1];
    d[o + 2] = this.cascadeSplits[2]; d[o + 3] = this.cascadeSplits[3];
    o += 4;
    put(60, 0.0009, w.time * 0.02, this.debugView);

    // Fog/ground tint picks up the sun so the haze is never a flat grey.
    const fogTint: Vec3 = [
      w.sun.color[0] * 0.30 + w.sun.ambient[0] * 0.45,
      w.sun.color[1] * 0.30 + w.sun.ambient[1] * 0.45,
      w.sun.color[2] * 0.30 + w.sun.ambient[2] * 0.45,
    ];
    put(fogTint[0], fogTint[1], fogTint[2], w.weather.cloudCover);

    this.gpu.device.queue.writeBuffer(this.gpu.frameUbo, 0, d as unknown as BufferSource, 0, FRAME_UNIFORM_SIZE / 4);
  }

  private updateCascades(cam: FlightCamera): void {
    const s = sunDirection(this.world.sun);
    const splits = CASCADE_SPLITS;
    this.cascadeSplits.set(splits);
    for (let i = 0; i < this.q.cascades; i++) {
      const near = i === 0 ? 0.1 : splits[i - 1];
      const far = splits[i];
      const box = cascadeParams(cam.position, cam.forward, s, near, far, this.q.shadowRes);
      const m = cascadeMatrix(box);
      this.cascadeMats[i].set(m);
      // Real world-space planes of this cascade's ortho box, so a chunk can be
      // rejected per cascade instead of being submitted to all four of them.
      extractOrthoFrustum(m, this.cascadePlanes[i]);
    }
    // Upload per-cascade params to their own buffer, one 256B slot each.
    const d = new Float32Array(CASCADE_COUNT * CASCADE_STRIDE / 4);
    for (let i = 0; i < CASCADE_COUNT; i++) {
      const base = (i * CASCADE_STRIDE) / 4;
      d.set(this.cascadeMats[i], base);
      d[base + 16] = 0.02;   // texelWorld.xyz
      d[base + 19] = 2.0;    // texelWorld.w  (depth range)
      d[base + 20] = 0.0009 + i * 0.0006;  // constant depth bias
      d[base + 21] = 0.05;                   // slope bias
      d[base + 22] = 0.03 * (1 + i * 2.2);    // normal offset, world units
      d[base + 23] = 0;
    }
    this.gpu.device.queue.writeBuffer(this.shadowUbo, 0, d);
  }

  // ---------------------------------------------------------------- streaming

  private chunkKey(cx: number, cz: number): string { return `${cx},${cz}`; }

  /**
   * Bake and upload the closest missing chunks, under a hard per-frame budget.
   *
   * Two queues drain here, and the order matters. `rebakes` first: a chunk baked
   * at the wrong detail level is wrong *now*, and it is what the camera is
   * looking at. `pendingBakes` second: a missing chunk is a hole in the world,
   * but a hole that fills in over the next few frames.
   *
   * Both share one budget. A tier change can invalidate every resident chunk at
   * once, and re-baking all of them in the frame that changed the tier would
   * stall for the better part of a second — which is exactly what a governor
   * step-down must not do, since it fires when the machine is already behind.
   * So the rebake is spread across as many frames as it takes, nearest chunk
   * first, and the budget check happens *after* each bake. That check placement
   * is not free: it means one bake is atomic, so the budget is really "4ms plus
   * at most one chunk". A single LOD-0 bake of a city chunk costs ~30ms, so the
   * budget is overrun by design and 4ms is a target, not a cap. Measured below.
   */
  private streamChunks(cam: FlightCamera): void {
    if (this.captureFrozen) return;
    const cfg = this.city.cfg;
    const cs = cfg.chunkSize;
    const pcx = Math.floor(cam.position[0] / cs);
    const pcz = Math.floor(cam.position[2] / cs);
    const r = this.q.viewDistance;

    if (this.pendingBakes.length === 0) {
      // Rebuild the priority list only when it's been drained, sorted by
      // distance so the chunk you are about to fly into bakes first.
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dz * dz > r * r + 1) continue;
          const cx = pcx + dx, cz = pcz + dz;
          // Outside the finite city there is no chunk; queueing it re-sent a
          // no-op bake forever and pinned rebakePending above zero.
          if (Math.abs(cx) > cfg.radiusChunks || Math.abs(cz) > cfg.radiusChunks) continue;
          const key = this.chunkKey(cx, cz);
          if (this.chunks.has(key) || this.inflightKeys.has(key)) continue;
          this.pendingBakes.push({ cx, cz });
        }
      }
      this.pendingBakes.sort((a, b) =>
        chunkDistance(a.cx, a.cz, pcx, pcz) - chunkDistance(b.cx, b.cz, pcx, pcz));
    }

    // Sort the rebake queue by distance whenever it is refilled, so a tier
    // change re-bakes what the camera is looking at first rather than whatever
    // the Map iteration order happened to produce.
    // Enqueue any resident chunk whose detail level no longer matches its
    // distance. Without this, LOD is baked once when a chunk is first seen and
    // never revisited: fly forward and the block you are about to enter was
    // baked LOD 1 at 500m and stays LOD 1 at 5m, so detail never increases for
    // the whole flight. The scan is a few hundred integer comparisons and runs
    // unconditionally — there is no cheaper way to notice the camera moved.
    for (const e of this.chunks.values()) {
      if (e.lod === lodForDistance(chunkDistance(e.cx, e.cz, pcx, pcz), this.q)) continue;
      const key = this.chunkKey(e.cx, e.cz);
      if (this.rebakeQueued.has(key)) continue;
      this.rebakeQueued.add(key);
      this.rebakeQueue.push({ cx: e.cx, cz: e.cz });
      this.rebakeDirty = true;
    }

    // Sort the rebake queue by distance whenever it is refilled, so the chunk
    // the camera is looking at is re-baked first rather than whatever order the
    // scan or a Map iteration happened to produce.
    if (this.rebakeDirty) {
      this.rebakeQueue.sort((a, b) =>
        chunkDistance(a.cx, a.cz, pcx, pcz) - chunkDistance(b.cx, b.cz, pcx, pcz));
      this.rebakeDirty = false;
    }

    const t0 = performance.now();
    let baked = 0;

    if (this.baker && !this.streamSync) {
      baked = this.applyBaked(pcx, pcz, r, t0);
      this.dispatchBakes(pcx, pcz);
      if (baked) this.evictChunks(r);
      this.stats.rebakePending = this.rebakeQueue.length + this.inflight.size + this.bakedReady.length;
      return;
    }

    while (this.rebakeQueue.length > 0 && performance.now() - t0 < BAKE_BUDGET_MS) {
      const job = this.rebakeQueue.shift()!;
      const key = this.chunkKey(job.cx, job.cz);
      const entry = this.chunks.get(key);
      if (!entry) { this.rebakeQueued.delete(key); continue; }
      // The detail level is measured from the camera chunk, which is only known
      // here, so the queued level is always recomputed at bake time. Two ways to
      // come out of this with nothing to do, and both must drop the queue entry
      // or `rebakeQueued` latches the key and the chunk can never be re-baked
      // for the rest of the session.
      const lod = lodForDistance(chunkDistance(job.cx, job.cz, pcx, pcz), this.q);
      if (lod === entry.lod) { this.rebakeQueued.delete(key); continue; }
      const chunk = this.city.getChunk(job.cx, job.cz);
      if (!chunk) { this.rebakeQueued.delete(key); continue; }
      this.bakeInto(entry, chunk, lod);
      this.rebakeQueued.delete(key);
      baked++;
    }

    while (this.pendingBakes.length > 0 && performance.now() - t0 < BAKE_BUDGET_MS) {
      const job = this.pendingBakes.shift()!;
      const key = this.chunkKey(job.cx, job.cz);
      if (this.chunks.has(key)) continue;
      const chunk = this.city.getChunk(job.cx, job.cz);
      if (!chunk) continue;
      const lod = lodForDistance(chunkDistance(job.cx, job.cz, pcx, pcz), this.q);
      const bakedChunk = bakeChunk(chunk, lod, this.world.seed);
      this.uploadChunk(job.cx, job.cz, bakedChunk, lod);
      baked++;
    }

    const ms = performance.now() - t0;
    if (ms > 0.05) { this.bakeAccum = this.bakeAccum * 0.88 + ms * 0.12; this.stats.bakeMs = this.bakeAccum; }
    if (baked) this.evictChunks(r);
    this.stats.rebakePending = this.rebakeQueue.length;
  }

  private startBaker(): void {
    if (typeof Worker === 'undefined') return;
    try {
      const w = new Worker(new URL('./bakeworker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<BakeResponse>) => this.onBaked(e.data);
      w.onerror = (e) => {
        // Fall back to main-thread baking; lost jobs are re-found by the scans.
        console.error(`bake worker failed (${e.message}); baking on the main thread`);
        for (const job of this.inflight.values()) this.rebakeQueued.delete(this.chunkKey(job.cx, job.cz));
        this.inflight.clear(); this.inflightKeys.clear(); this.pendingBakes.length = 0;
        this.baker = null;
      };
      w.postMessage({ type: 'init', seed: this.world.seed } satisfies BakeRequest);
      this.baker = w;
    } catch { this.baker = null; }
  }

  private onBaked(r: BakeResponse): void {
    const job = this.inflight.get(r.id);
    if (!job) return;
    this.inflight.delete(r.id);
    this.inflightKeys.delete(this.chunkKey(job.cx, job.cz));
    if (r.ms > 0) { this.bakeAccum = this.bakeAccum * 0.88 + r.ms * 0.12; this.stats.bakeMs = this.bakeAccum; }
    if (!r.baked) {
      if ('error' in r && r.error) console.error(`bake ${job.cx},${job.cz} failed: ${r.error}`);
      if (job.rebake) this.rebakeQueued.delete(this.chunkKey(job.cx, job.cz));
      return;
    }
    this.bakedReady.push({ ...job, baked: r.baked });
  }

  /** Upload finished bakes that are still wanted, within the frame's upload budget. */
  private applyBaked(pcx: number, pcz: number, r: number, t0: number): number {
    let n = 0;
    while (this.bakedReady.length > 0 && (n === 0 || performance.now() - t0 < UPLOAD_BUDGET_MS)) {
      const done = this.bakedReady.shift()!;
      const key = this.chunkKey(done.cx, done.cz);
      if (done.rebake) {
        this.rebakeQueued.delete(key);
        if (!this.chunks.has(key)) continue;          // evicted while baking
      } else if (this.chunks.has(key)) continue;      // a synchronous warm got there first
      if (chunkDistance(done.cx, done.cz, pcx, pcz) > r + 1) continue;  // flown past
      this.uploadChunk(done.cx, done.cz, done.baked, done.lod);
      n++;
    }
    return n;
  }

  /** Keep the worker fed: rebakes first (wrong detail where the camera is), then new chunks. */
  private dispatchBakes(pcx: number, pcz: number): void {
    while (this.baker && this.inflight.size < MAX_INFLIGHT_BAKES) {
      let job: { cx: number; cz: number } | undefined;
      let lod = 0, rebake = false;
      while (!job && this.rebakeQueue.length > 0) {
        const j = this.rebakeQueue.shift()!;
        const key = this.chunkKey(j.cx, j.cz);
        const entry = this.chunks.get(key);
        lod = lodForDistance(chunkDistance(j.cx, j.cz, pcx, pcz), this.q);
        if (!entry || lod === entry.lod || this.inflightKeys.has(key)) { this.rebakeQueued.delete(key); continue; }
        job = j; rebake = true;
      }
      while (!job && this.pendingBakes.length > 0) {
        const j = this.pendingBakes.shift()!;
        const key = this.chunkKey(j.cx, j.cz);
        if (this.chunks.has(key) || this.inflightKeys.has(key)) continue;
        lod = lodForDistance(chunkDistance(j.cx, j.cz, pcx, pcz), this.q);
        job = j;
      }
      if (!job) return;
      const id = ++this.bakeSeq;
      this.inflight.set(id, { cx: job.cx, cz: job.cz, lod, rebake });
      this.inflightKeys.add(this.chunkKey(job.cx, job.cz));
      this.baker.postMessage({ type: 'bake', id, cx: job.cx, cz: job.cz, lod } satisfies BakeRequest);
    }
  }

  /** Re-bake an already-resident chunk at a given detail level, in place. */
  private bakeInto(entry: ChunkEntry, chunk: CityChunk, lod: number): void {
    const baked = bakeChunk(chunk, lod, this.world.seed);
    const prev = this.chunks.get(this.chunkKey(entry.cx, entry.cz));
    if (prev) {
      destroyMesh(prev.mesh);
      destroyMesh(prev.foliage);
    }
    this.uploadChunk(entry.cx, entry.cz, baked, lod);
  }

  private uploadChunk(cx: number, cz: number, baked: BakedChunk, lod: number): void {
    const key = this.chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) {
      destroyMesh(existing.mesh);
      destroyMesh(existing.foliage);
    }
    const mesh = uploadMesh(this.gpu, `chunk${key}`, baked.opaque);
    let foliage: GpuMesh | null = null;
    if (this.q.foliageEnabled && baked.foliage.indexCount > 0) {
      foliage = uploadMesh(this.gpu, `foliage${key}`, baked.foliage);
    }
    const centre: Vec3 = [
      (baked.boundsMin[0] + baked.boundsMax[0]) * 0.5,
      (baked.boundsMin[1] + baked.boundsMax[1]) * 0.5,
      (baked.boundsMin[2] + baked.boundsMax[2]) * 0.5,
    ];
    const radius = 0.5 * Math.hypot(
      baked.boundsMax[0] - baked.boundsMin[0],
      baked.boundsMax[1] - baked.boundsMin[1],
      baked.boundsMax[2] - baked.boundsMin[2],
    );
    this.chunks.set(key, {
      obstacles: baked.obstacles, walking: baked.walking, marketStalls: baked.marketStalls, version: ++this.residencyRevision,
      cx, cz, lod, mesh, foliage, lights: baked.lights, radius, centre, lastUsed: this.frameIndex,
      marketProduced: baked.marketLights?.produced ?? 0,
    });
  }

  private evictChunks(r: number): void {
    const limit = (r * 2 + 3) * (r * 2 + 3) + 16;
    if (this.chunks.size <= limit) return;
    const entries = [...this.chunks.entries()].sort(
      (a, b) => (a[1].lastUsed - b[1].lastUsed));
    for (let i = 0; i < entries.length - limit; i++) {
      const [key, e] = entries[i];
      destroyMesh(e.mesh);
      destroyMesh(e.foliage);
      this.chunks.delete(key);
      this.residencyRevision++;
      // Drop the eviction hook too, or a chunk that streams back in later finds
      // its key already latched in `rebakeQueued` and never gets re-baked.
      this.rebakeQueued.delete(key);
    }
  }

  // ---------------------------------------------------------------- lights

  private gatherLights(cam: FlightCamera): number {
    const w = this.lightWriter;
    w.reset();
    const r = this.q.viewDistance;
    // `MAX_LIGHTS` is filled in chunk-iteration order, so a dense district that
    // happens to come first can starve every light after it. Counting the
    // refusals is the only way to see that happen; a `break` is silent.
    let produced = 0, delivered = 0, starved = 0, rejectedFar = 0;
    // Collect first, bin nearest-first.
    //
    // This used to push as it walked `this.chunks.values()`, which is Map
    // INSERTION order — bake order, not proximity. At `ultra`, where every
    // chunk is LOD 0 and the market contributes 1592 lanterns, the bin
    // overflows: measured `binned 3072, starved 2918`, so 48% of the city's
    // night lights were dropped and *which* 48% was decided by the order chunks
    // happened to stream in. The effect was not subtle and it was not in the
    // direction anyone would guess: `aisleWarmPixelPct` at the market measured
    // 0.225 at the default tier and 0.073 at ultra. Turning the lights on made
    // the market DARKER, because the extra residency filled the bin with other
    // districts' lights and the market's nearest ones lost the coin toss.
    //
    // A distance-ordered bin is the standard remedy for a capped light buffer
    // and it is the only ordering that matches what the frame can see.
    const cand = this.lightCandidates;
    cand.length = 0;
    for (const e of this.chunks.values()) {
      produced += e.marketProduced;
      const d = Math.hypot(e.centre[0] - cam.position[0], e.centre[2] - cam.position[2]);
      if (d > (r + 1) * 320) { rejectedFar += e.lights.length; continue; }
      // NOT culled by day. The cull used to be here, and it was wrong on its own
      // terms rather than merely at the wrong threshold.
      //
      // `dayPhase` is derived from a sun CLOCK (`integrateWorld` advances
      // `sun.azimuth` continuously and derives elevation from it), while
      // `setTime` sets a WEATHER phase once. They are two sources of truth and
      // they disagree: a pose named `night-lanterns` reports
      // `produced 48, delivered 0` with the cull flag set, because the clock had
      // carried the sun above `elevation 0.475` while the weather was still the
      // night phase. Developer 2 lost a whole measurement cycle to that frame.
      //
      // But the deeper problem is that "is the sun up" and "should an authored
      // light be visible" are different questions. A market lantern is a light
      // source: it is visible at dusk, under an overcast afternoon, and in a
      // canyon in daylight, where the sun out-competes it but does not erase it.
      // Culling on a scalar means the lights snap off at one number and every
      // measurement taken near that boundary describes a different city.
      //
      // The cost argument does not survive contact with the numbers: the binning
      // pass is one dispatch over 5700 tiles x ~860 lights = 4.9M projection
      // tests, and the renderer already pays it every night frame. So the lights
      // are always binned, and the sun is left to win or lose on its own merits.
      delivered += e.lights.length;
      for (const l of e.lights) {
        cand.push({
          l,
          d: (l.pos[0] - cam.position[0]) ** 2 + (l.pos[2] - cam.position[2]) ** 2,
        });
      }
    }
    // Only pay for the sort when it can change the answer. Below the cap the
    // bin takes everything and order is irrelevant.
    if (cand.length > MAX_LIGHTS) cand.sort((a, b) => a.d - b.d);
    const take = Math.min(cand.length, MAX_LIGHTS);
    // Pack at the SHADER's stride, not the instance writer's.
    //
    // This used to go through `makeInstanceWriter` and then patch slots 12..15
    // and 19 of each 24-float instance record. That was wrong in three
    // independent ways at once, and each one alone was enough to lose the
    // lights:
    //
    //   1. STRIDE. `INSTANCE_FLOATS` is 24 floats = 96 bytes, because it packs
    //      a mat4. `lightbin.wgsl`'s `Light` is two vec4f = 8 floats = 32
    //      bytes. Light 0's position went to byte 48; the shader read light 0
    //      from bytes 0..32 and found the identity matrix instead.
    //   2. LENGTH. The upload was `count * 8` floats — the right length for the
    //      shader's stride but applied to data laid out at 24 — so only the
    //      first ~1/3 of the buffer was ever written and the rest stayed zero.
    //   3. `colorInt.w` is the intensity the shader reads to decide whether a
    //      light exists at all (`if (l.colorInt.w <= 0.0) { continue; }`).
    //      `pushStatic` writes the *emissive* slot there, and the patch wrote
    //      intensity to slot 19 — so the survival test read a slot that was
    //      never given one for lights, and rejected them.
    //
    // Net effect: `stats.lights` reported 219-3072 lights "delivered" while the
    // binning shader rejected every one of them on the intensity test, wrote
    // `count == 0` to every bin, and `lighting.wgsl` iterated zero lights for
    // every pixel in the frame. `meanCount 0` from `probe('tiles')` with 772
    // lights binned is that, measured. This is the actual cause of the unlit
    // market aisle, and it is upstream of everything in docs/LIGHT_DELIVERY.md
    // §1-4: delivery, ordering and tile capacity were all necessary and none of
    // them was sufficient.
    const d = w.data;
    for (let i = 0; i < take; i++) {
      const l = cand[i].l;
      const o = i * LIGHT_FLOATS;
      d[o + 0] = l.pos[0];
      d[o + 1] = l.pos[1];
      d[o + 2] = l.pos[2];
      d[o + 3] = l.radius;
      d[o + 4] = l.color[0];
      d[o + 5] = l.color[1];
      d[o + 6] = l.color[2];
      d[o + 7] = l.intensity;
    }
    starved = cand.length - take;
    this.gpu.device.queue.writeBuffer(
      this.lightBuf, 0, d as unknown as BufferSource, 0, Math.max(1, take) * LIGHT_FLOATS,
    );
    this.stats.lights = take;
    this.stats.lightDelivery = {
      produced, delivered, binned: take, starved, rejectedFar,
      dayPhase: +this.world.dayPhase.toFixed(3), cap: MAX_LIGHTS,
    };
    return take;
  }

  // ---------------------------------------------------------------- frame

  render(cam: FlightCamera, dt: number): void {
    if (!this.targets) return;
    // Streaming needs no GPU slot, so it runs before the pacing gate. Behind the
    // gate a synchronous warm stalled: its ticks were declined while two frames
    // were in flight, and it can never see them complete (boot warm 1/64 chunks).
    const streamStart = performance.now();
    this.streamChunks(cam);
    this.perf.cpu('stream', performance.now() - streamStart);
    // Live, not end-of-frame: warm reads it on ticks the gate declines.
    this.stats.residentChunks = this.chunks.size;
    // The GPU is the bottleneck, and a fence is the only place that shows it.
    //   1. A readback is in flight. Every frame submitted here is work the
    //      readback's `mapAsync` has to wait behind.
    //   2. The queue is already `MAX_FRAMES_IN_FLIGHT` deep. Submitting anyway
    //      makes every readback in the project pay for the backlog, and a
    //      backlog the loop keeps refilling never drains.
    //
    // The `lastSubmitAt` clause is a fail-open. Both gates depend on an
    // `onSubmittedWorkDone` promise resolving, and if one ever does not, the
    // counter latches at the cap and the app stops drawing for the rest of the
    // session. Losing pacing for a frame is a far better failure than losing the
    // picture, so after `PACING_FAIL_OPEN_MS` of declining to encode, the gate
    // opens itself and the frame goes through regardless.
    const now = performance.now();
    const overBudget = this.framesInFlight >= Renderer.MAX_FRAMES_IN_FLIGHT;
    if ((this.capturePending || overBudget) && now - this.lastSubmitAt < PACING_FAIL_OPEN_MS) {
      this.skipped++;
      return;
    }
    if (overBudget) this.framesInFlight = 0;
    const t0 = now;
    this.resetCounter();
    this.resize();
    this.updateCascades(cam);
    // gatherLights BEFORE writeFrameUniforms, because the packed light count now
    // rides in the frame uniform (`grade.w`) and the binner reads it. Written in
    // the other order it would carry LAST frame's count — a one-frame lag that
    // costs nothing on a steady scene and mis-bins every light on the frame a
    // light appears or disappears, which is exactly when it matters.
    const lightCount = this.gatherLights(cam);
    this.writeFrameUniforms(cam);

    const enc = this.gpu.device.createCommandEncoder({ label: 'frame' });
    this.passTimer?.instrument(enc);
    this.recordShadow(enc, cam);
    const visible = this.recordGBuffer(enc, cam, this.pendingEntities);
    this.recordBinning(enc, lightCount);
    this.recordLighting(enc);
    this.recordPost(enc);
    const passTiming = this.passTimer?.resolve(enc) ?? null;
    this.gpu.device.queue.submit([enc.finish()]);
    this.passTimer?.collect(passTiming);
    this.trackGpuCompletion();

    this.frameIndex++;
    const cpu = performance.now() - t0;
    this.perf.cpu('encode', cpu);
    this.lastCpu = this.lastCpu * 0.9 + cpu * 0.1;
    this.frameTimes.push(cpu);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    this.stats.seed = this.world.seed;
    this.publishStats(visible, cam);
    void dt;
  }

  /**
   * Count this frame against the in-flight budget and release it when the GPU
   * says it has retired everything submitted up to now.
   *
   * The budget is what keeps any fence in this renderer honest — `mapAsync` in
   * `captureRGBA`, `probe`, and the loop's own pacing all read the same queue
   * depth. Without it the depth is a function of how long the page has been
   * open, which is why every fence measured in this project came out at
   * seconds and nobody could say why.
   */
  private trackGpuCompletion(): void {
    const q = this.gpu.device.queue;
    this.framesInFlight++;
    this.lastSubmitAt = performance.now();
    const serial = this.perf.submitted(this.lastSubmitAt);
    void q.onSubmittedWorkDone().then(
      () => {
        this.perf.completed(serial);
        this.framesInFlight = Math.max(0, this.framesInFlight - 1);
      },
      // Device lost or the queue torn down: never let the counter latch at the
      // cap, which would stop the app drawing for the rest of the session.
      () => { this.perf.failed(serial); this.framesInFlight = 0; },
    );
  }

  /**
   * Fold the frame's counters into `stats` and update the timing bases.
   *
   * Two timing numbers are published, deliberately, because they disagree and
   * picking one silently is how the governor came to believe the machine was
   * running at 1639 fps:
   *
   *   `cpuEncodeMs` — JS time spent building and submitting the command buffer.
   *                   GPU execution is not included, and cannot be: submit is
   *                   asynchronous, so it returns before the GPU has drawn a
   *                   pixel. On a GPU-bound frame this is near zero.
   *   `frameMs`      — smoothed wall-clock between encoded-frame publications.
   *                   Includes queue pacing and callback scheduling; it is not
   *                   measured display presentation or GPU execution time.
   */
  private publishStats(gbufferDraws: number, cam?: FlightCamera): void {
    const c = this.counter;
    const now = performance.now();
    const wall = this.lastFrameAt > 0 ? now - this.lastFrameAt : 16.7;
    this.lastFrameAt = now;
    this.wallAccum = this.wallAccum > 0 ? this.wallAccum * 0.88 + wall * 0.12 : wall;

    const s = this.stats;
    s.cpuEncodeMs = this.lastCpu;
    if (cam) {
      const pose = cam.getPose();
      this.stats.camera.position = [pose.position[0], pose.position[1], pose.position[2]];
      this.stats.camera.lookAt = [pose.lookAt[0], pose.lookAt[1], pose.lookAt[2]];
      this.stats.camera.fov = pose.fov;
    }
    s.frameMs = this.wallAccum;
    s.fps = this.wallAccum > 0.0001 ? 1000 / this.wallAccum : 60;
    s.cpuFps = this.lastCpu > 0.0001 ? 1000 / this.lastCpu : 60;

    // Same correction as `entityDrawCalls` below: `c.entity` counts callers of a
    // function nobody calls, so adding it here would short the frame total by
    // every crowd and fleet draw. Counted from the ledger instead.
    let issued = 0;
    for (const e of this.entityDraws) { if (!e.endsWith(':0')) issued++; }
    s.drawCalls = c.shadow + c.gbuffer + c.post + issued;
    s.triangles = c.shadowTris + c.gbufferTris + c.postTris + c.entityTris;
    s.shadowDrawCalls = c.shadow;
    s.gbufferDrawCalls = c.gbuffer;
    s.postDrawCalls = c.post;
    // Counted from `entityDraws`, not from `c.entity`.
    //
    // `counter.entity` is incremented in exactly one place — `drawEntitySet` — and
    // `drawEntitySet` has no callers. The crowd and the fleet are drawn by
    // `main.ts`'s own `drawEntityBlock`, which calls `pass.drawIndexed` directly
    // and pushes to `entityDraws`. So `entityDrawCalls` read **0** in every capture
    // this session while `entityTriangles` read hundreds of thousands, and the
    // pair looked like "counted, never issued": instances uploaded, triangles
    // counted, no draw call issued. Developer 2 read that as the cause of R1.
    //
    // It is not. Measured at the market pose: `entityTriangles 356480`,
    // `entityDrawCalls 0`. A nonzero `entityTriangles` can only come from the
    // branch that calls `drawIndexed` — `drawEntityBlock` returns
    // `(indexCount/3) * count` and only after issuing the draw — so the GPU was
    // told. **The counter was the thing that was wrong, not the frame.** That is
    // the fourth diagnostic in this project to lie while a sibling read healthily,
    // and the most expensive one, because a plausible sibling (`entityTriangles`)
    // is exactly what makes a broken counter believable.
    //
    // `entityDraws` is pushed by BOTH paths, so counting its non-empty entries is
    // the honest number for the whole frame regardless of which one ran.
    s.entityDrawCalls = issued;
    // Kept for the record: what the single-caller counter would have said.
    this.statsEntityCounterOnly = c.entity;
    s.shadowTriangles = c.shadowTris;
    s.gbufferTriangles = c.gbufferTris;
    s.postTriangles = c.postTris;
    s.entityTriangles = c.entityTris;
    // Fresh arrays, not the counter's own. `__syzygy.stats()` shallow-spreads
    // this object, so a held snapshot would otherwise alias the live array and
    // quietly change under the caller — which is how a before/after comparison
    // ends up comparing a number with itself.
    s.cascadeDrawCalls = c.cascade.slice();
    s.cascadeTriangles = c.cascadeTris.slice();
    s.frustumCulled = c.culled;
    // Histogram of baked detail levels. This is the stat that makes 'LOD is
    // wired' a measurement rather than a claim: if every entry is level 0, the
    // policy is not running, whatever the call site says it passes.
    s.lodHistogram = [0, 0, 0, 0];
    for (const e of this.chunks.values()) {
      if (e.lod >= 0 && e.lod < s.lodHistogram.length) s.lodHistogram[e.lod]++;
    }
    s.visibleChunks = c.chunkMeshes;
    s.visibleDraws = gbufferDraws;

    s.residentChunks = this.chunks.size;
    s.tier = this.quality;
    s.framesSkipped = this.skipped;
    s.framesInFlight = this.framesInFlight;
    this.skipped = 0;

    const w = this.world;
    w.perf.frameMs = s.frameMs;
    w.perf.cpuMs = s.cpuEncodeMs;
    w.perf.gpuMs = null;
    w.perf.gpuMsSource = 'unavailable';
    w.perf.fps = s.fps;
    w.perf.drawCalls = s.drawCalls;
    w.perf.triangles = s.triangles;
    w.perf.residentChunks = this.chunks.size;
    w.perf.residentDraws = s.drawCalls;
    w.perf.visibleDraws = gbufferDraws;
    w.perf.tier = this.quality;
  }

  private recordShadow(enc: GPUCommandEncoder, cam: FlightCamera): void {
    const bg = this.gpu.device.createBindGroup({
      label: 'shadow-bg', layout: this.shadowUboBgl,
      entries: [{ binding: 0, resource: { buffer: this.shadowUbo, offset: 0, size: CASCADE_STRIDE } }],
    });
    for (let i = 0; i < this.q.cascades; i++) {
      const pass = enc.beginRenderPass({
        label: `shadow${i}`,
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowView[i],
          depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
        },
      });
      pass.setPipeline(this.shadowPass.pipeline);
      pass.setBindGroup(0, this.frameBg, [0]);
      pass.setBindGroup(1, this.emptyBindGroup);
      pass.setBindGroup(2, bg, [i * CASCADE_STRIDE]);
      pass.setVertexBuffer(1, this.identityInst);
      this.drawChunks(pass, cam, true, i);
      pass.end();
    }
  }

  private recordGBuffer(
    enc: GPUCommandEncoder, cam: FlightCamera,
    entities?: ((p: GPURenderPassEncoder) => void) | null,
  ): number {
    const t = this.targets!;
    const pass = enc.beginRenderPass({
      label: 'gbuffer',
      colorAttachments: [
        { view: t.gAlbedo.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: t.gNormal.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: t.gEmis.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
      ],
      depthStencilAttachment: {
        view: t.gDepth.createView(),
        depthClearValue: 0.0, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });
    pass.setPipeline(this.gbufferPass.pipeline);
    pass.setBindGroup(0, this.frameBg, [0]);
    pass.setVertexBuffer(1, this.identityInst);
    const visible = this.drawChunks(pass, cam, false, -1);
    if (entities && this.entityDrawEnabled) entities(pass);
    pass.end();
    return visible;
  }

  /**
   * Issue one indexed draw per visible chunk. Shared by the shadow and g-buffer
   * passes.
   *
   * Every counter here ADDS into `this.counter`. The previous version assigned
   * `stats.drawCalls` and `stats.triangles`, so each of the four shadow passes
   * overwrote the last and the number the HUD showed was the G-buffer pass only
   * — it reported 232 while the frame really submitted 780. That is worse than
   * no counter: it was a plausible statistic for the wrong quantity, and it hid
   * the fact that the shadow passes were the largest single cost in the frame.
   *
   * `cascade` is -1 for the G-buffer pass and the cascade index for a shadow
   * pass, which is how per-cascade culling knows which box to test against.
   */
  private drawChunks(
    pass: GPURenderPassEncoder, cam: FlightCamera, shadowOnly: boolean, cascade: number,
  ): number {
    const c = this.counter;
    let draws = 0;
    let tris = 0;
    let culled = 0;
    let chunkMeshes = 0;
    const planes = shadowOnly && cascade >= 0 && this.shadowCullEnabled
      ? this.cascadePlanes[cascade]
      : cam.frustumPlanes;

    // The street deck goes down first so it only fills pixels nothing else
    // claims. Without it, a top-down view is all sky and a street-level view
    // has a void under the buildings.
    //
    // It DOES write depth, contrary to what this comment used to say. There is
    // no second pipeline here and the G-buffer pipeline sets
    // `depthWriteEnabled: true` (renderer.ts:612), so the deck occupies the
    // depth buffer like everything else. That is correct and load-bearing for
    // reverse-Z — a nearer surface wins on `greater` — but it is why a deck
    // fragment and a crowd member's feet can contend at the same distance.
    // Recorded here because a comment that says the opposite of the code is a
    // landmine for whoever reads this next (PROCESS rule 6).
    if (this.ground.indexCount > 0) {
      pass.setVertexBuffer(0, this.ground.vbo);
      pass.setVertexBuffer(1, this.groundInst);
      pass.setIndexBuffer(this.ground.ibo, this.ground.indexFormat);
      pass.drawIndexed(this.ground.indexCount);
      draws++;
      tris += this.ground.indexCount / 3;
    }

    for (const e of this.chunks.values()) {
      if (!e.mesh || e.mesh.indexCount === 0) continue;
      const vis = sphereInFrustum(planes, e.centre, e.radius);
      if (!vis) { culled++; continue; }
      e.lastUsed = this.frameIndex;
      pass.setVertexBuffer(0, e.mesh.vbo);
      pass.setIndexBuffer(e.mesh.ibo, e.mesh.indexFormat);
      pass.drawIndexed(e.mesh.indexCount);
      draws++;
      tris += e.mesh.indexCount / 3;
      chunkMeshes++;
      if (!shadowOnly && e.foliage && this.q.foliageEnabled) {
        pass.setVertexBuffer(0, e.foliage.vbo);
        pass.setIndexBuffer(e.foliage.ibo, e.foliage.indexFormat);
        pass.drawIndexed(e.foliage.indexCount);
        draws++;
        tris += e.foliage.indexCount / 3;
      }
    }

    // --- account for this pass
    if (shadowOnly && cascade >= 0) {
      c.shadow += draws;
      c.shadowTris += tris;
      c.cascade[cascade] += draws;
      c.cascadeTris[cascade] += tris;
    } else {
      c.gbuffer += draws;
      c.gbufferTris += tris;
      c.chunkMeshes += chunkMeshes;
    }
    c.culled += culled;
    return draws;
  }

  /**
   * Size the screen-tile light bins for the current target resolution.
   *
   * THIS WAS A HARD-CODED `16 * 16 * 400`, and it was wrong by more than an
   * order of magnitude, silently.
   *
   * `16 * 16` looks like it means "a 16x16 tile grid", which is what
   * `lightbin.wgsl` calls `TILE_DIM`. It is not: `TILE_DIM` is the tile's side
   * in PIXELS, and the grid is `ceil(W/16) x ceil(H/16)` — 5700 bins at 1600x900,
   * 10260 at ultra. So the buffer held 256 of the 5700 bins the shader actually
   * addressed.
   *
   * `recordBinning` dispatches `ceil(tiles/64)` workgroups over ALL of them and
   * `lighting.wgsl` reads `tileLights[tile.y * tiles.x + tile.x]` over ALL of
   * them, so both passes agreed with each other and disagreed with the
   * allocation. Every store past the end of a storage buffer is discarded and
   * every load returns zero, which is legal WebGPU and produces no error — so
   * the bin for any tile past the first 256 read back `count == 0`, and
   * `lighting.wgsl`'s light loop ran zero iterations for it.
   *
   * The visible consequence: clustered lights only ever appeared in roughly the
   * top 32 pixels of the frame. On the market street, that is the sky. The
   * lanterns glowed (they are emissive geometry, drawn in the G-buffer pass, not
   * binned) and the aisle beneath them got nothing — which is exactly the
   * reviewer's reported symptom, and exactly why raising `MAX_PER_TILE` or
   * re-ordering the bin could not have fixed it.
   *
   * Nothing about this was visible from any number the project owned. `stats.lights`
   * counted lights *handed to the binner*, and read 219-3072 depending on tier,
   * which looks like healthy delivery. The lights were delivered; almost none of
   * them had anywhere to be read from.
   */
  private allocTiles(dev: GPUDevice): void {
    const tx = Math.ceil(this.targetsW / 16);
    const ty = Math.ceil(this.targetsH / 16);
    const bins = Math.max(1, tx * ty);
    // Matches `sizeof(Bin)` in lightbin.wgsl: array<atomic<u32>,96> + count + 3 pad.
    const bytes = bins * 400;
    this.tileCapacity = bins;
    this.stats.tileBins.bins = bins;
    this.stats.tileBins.capacity = bins;
    this.tileBuf?.destroy();
    this.tileBuf = dev.createBuffer({
      label: 'light-tiles', size: bytes,
      // COPY_SRC so `tileStats()` can read the bins back. Without it the copy is
      // a validation error and the whole readback silently returns zeros — the
      // same "no error, wrong numbers" shape as the bug this buffer had.
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
  }

  private recordBinning(enc: GPUCommandEncoder, lightCount: number): void {
    const bg = this.gpu.device.createBindGroup({
      label: 'bin-bg', layout: this.binBgl,
      entries: [
        { binding: 0, resource: { buffer: this.lightBuf } },
        { binding: 1, resource: { buffer: this.tileBuf } },
        { binding: 2, resource: this.targets!.gDepth.createView() },
      ],
    });
    const cp = enc.beginComputePass({ label: 'lightbin' });
    const tiles = Math.ceil(this.targetsW / 16) * Math.ceil(this.targetsH / 16);
    // Dispatching past the buffer is legal WebGPU and silently wrong: the stores
    // are dropped and the matching loads read zero, so those tiles light nothing
    // and no error is raised. Assert it instead of trusting it.
    if (tiles > this.tileCapacity) {
      throw new Error(`lightbin: ${tiles} tiles exceed tileBuf capacity ${this.tileCapacity} (${this.targetsW}x${this.targetsH})`);
    }
    cp.setBindGroup(0, this.frameBg, [0]);
    cp.setBindGroup(1, bg);
    cp.setPipeline(this.binClear.pipeline);
    cp.dispatchWorkgroups(Math.ceil(tiles / 64));
    if (lightCount > 0) {
      cp.setPipeline(this.binRun.pipeline);
      cp.dispatchWorkgroups(Math.ceil(tiles / 64));
    }
    cp.end();
  }

  /** Set by the app each frame; invoked inside the G-buffer pass. */
  pendingEntities: ((p: GPURenderPassEncoder) => void) | null = null;

  /**
   * Gate on the entity draw, so a frame with entities and a frame without them
   * can be taken at the SAME camera and diffed. Default `true`, so it changes no
   * behaviour; it exists because the obvious control does not work.
   *
   * `setCrowdCount(0)` cannot do this. `Pass B` counts every `active` agent
   * inside `viewRadius` regardless of `targetVisible` (`crowd.ts:338-384`), so
   * asking for a population of zero still submitted ~2500 instances — measured.
   * The "population set to zero" control `main.ts:753` advertises is therefore
   * void, and this flag is what replaced it: flip to false, re-shoot, diff. That
   * is how F2 was closed, and how the pedestrian band was identified as the
   * crowd rather than as chunk geometry (docs/F1F2_GPU_HALF.md §4.2).
   *
   * F2 turned out NOT to be a rendering bug — the crowd had been drawing the
   * whole time and the defect was its lack of lateral spread. Keep this: the
   * next question of the shape "are entities reaching the frame" is otherwise
   * unanswerable without editing `main.ts`.
   */
  entityDrawEnabled = true;

  /** Draw a named entity set with the given instance block. */
  drawEntitySet(
    pass: GPURenderPassEncoder, name: keyof typeof this.entities, data: Float32Array, count: number,
  ): void {
    const mesh = this.entities[name];
    if (!mesh) return;
    const n = this.uploadInstances(data, count);
    // A zero-instance set submits nothing. Counting it anyway inflated the
    // draw total by one per empty entity set every frame — a phantom in a
    // counter that is supposed to be the ground truth for the whole frame.
    if (n <= 0) {
      this.entityDraws.push(`${name}:0`);
      return;
    }
    this.drawEntity(pass, mesh, n);
    this.counter.entity++;
    this.counter.entityTris += (mesh.indexCount / 3) * n;
    this.entityDraws.push(`${name}:${n}/${mesh.indexCount}`);
  }

  private recordLighting(enc: GPUCommandEncoder): void {
    const t = this.targets!;
    const bg = this.gpu.device.createBindGroup({
      label: 'lighting-bg', layout: this.lightBgl,
      entries: [
        { binding: 0, resource: this.shadowView[0] },
        { binding: 1, resource: this.shadowCmp },
        { binding: 2, resource: t.gAlbedo.createView() },
        { binding: 3, resource: t.gNormal.createView() },
        { binding: 4, resource: t.gEmis.createView() },
        { binding: 5, resource: t.gDepth.createView() },
        { binding: 6, resource: this.clampSamp },
        { binding: 7, resource: { buffer: this.tileBuf } },
        { binding: 8, resource: { buffer: this.lightBuf } },
        { binding: 9, resource: this.skyLutView },
        { binding: 10, resource: this.skyLutSamp },
      ],
    });
    const sky = enc.beginRenderPass({
      label: 'sky-lut',
      colorAttachments: [{ view: this.skyLutView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    sky.setPipeline(this.skyLutPass.pipeline);
    sky.setBindGroup(0, this.frameBg, [0]);
    sky.draw(3);
    sky.end();
    const pass = enc.beginRenderPass({
      label: 'lighting',
      colorAttachments: [{ view: t.hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.lightingPass.pipeline);
    pass.setBindGroup(0, this.frameBg, [0]);
    pass.setBindGroup(1, bg);
    pass.draw(3);
    pass.end();
    this.counter.post++;
    this.counter.postTris++;
  }

  /**
   * Post passes all share one bind-group layout, so a pass that reads from an
   * arbitrary mip of the bloom chain just needs a different source view. Rather
   * than hand-maintaining a dozen groups, key them by source texture — there
   * are at most `bloomLevels + 4` distinct ones.
   */
  private postBg(
    key: string, target: GPUTexture, src: GPUTextureView, prev: GPUTextureView,
    slot4?: GPUTextureView,
  ): GPUBindGroup {
    const t = this.targets!;
    const k = `${key}|${src.label ?? 's'}|${prev.label ?? 'p'}|${slot4 ? 'x' : '-'}`;
    const cached = this.postGroups.get(k);
    if (cached) return cached;
    // Any slot whose texture is the pass's own write target is swapped for the
    // 1x1 black stand-in.
    const safe = (v: GPUTextureView, tex: GPUTexture) => (tex === target ? this.blackView : v);
    const g = this.gpu.device.createBindGroup({
      label: `post:${key}`, layout: this.postBgl,
      entries: [
        { binding: 0, resource: safe(this.shadowView[0], this.shadowTex[0]) },
        { binding: 1, resource: this.shadowCmp },
        { binding: 2, resource: safe(src, t.hdr) },
        { binding: 3, resource: safe(t.bloomView[0], t.bloom[0]) },
        // Binding 4 is the half-res aux slot: the DOF buffer for the DOF pass,
        // the shaft buffer for the composite. Only ever one of them at a time,
        // and always something the pass does not itself write.
        { binding: 4, resource: safe(slot4 ?? t.dofView, slot4 ? t.shafts : t.dof) },
        { binding: 5, resource: safe(t.hdrView, t.hdr) },
        { binding: 6, resource: this.clampSamp },
        { binding: 7, resource: safe(prev, t.taa[0] === target ? t.taa[0] : t.taa[1]) },
        { binding: 8, resource: t.gDepth.createView() },
      ],
    });
    this.postGroups.set(k, g);
    return g;
  }

  private recordPost(enc: GPUCommandEncoder): void {
    const t = this.targets!;
    const bg0 = [0];

    const draw = (
      label: string, target: GPUTexture, pipeline: GPURenderPipeline, src: GPUTextureView,
      prev: GPUTextureView, load: GPULoadOp = 'clear',
    ) => {
      const p = enc.beginRenderPass({
        label,
        colorAttachments: [{
          view: target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: load, storeOp: 'store',
        }],
      });
      p.setPipeline(pipeline);
      p.setBindGroup(0, this.frameBg, bg0);
      p.setBindGroup(1, this.postBg(label, target, src, prev));
      p.draw(3);
      p.end();
      // The post chain is ~11 full-screen triangles per frame. Small, but it
      // was not counted at all before, so "total draws" did not mean total.
      this.counter.post++;
      this.counter.postTris++;
    };

    // --- depth of field, half res
    if (this.q.dofEnabled) {
      draw('dof', t.dof, this.dofPass.pipeline, t.hdrView, t.taaView[1]);
    }

    // --- bloom: threshold into mip 0, then down, then additive up.
    const n = t.bloom.length;
    for (let i = 0; i < n; i++) {
      const src = i === 0 ? t.hdrView : t.bloomView[i - 1];
      draw(`bloom-down${i}`, t.bloom[i], i === 0 ? this.bloomThreshold.pipeline : this.bloomDown.pipeline, src, t.taaView[1]);
    }
    for (let i = n - 2; i >= 0; i--) {
      draw(`bloom-up${i}`, t.bloom[i], this.bloomUp.pipeline, t.bloomView[i + 1], t.taaView[1], 'load');
    }

    // --- temporal resolve
    const prevIdx = this.frameIndex % 2;
    if (this.q.taaEnabled) {
      draw('taa', t.resolved, this.taaPass.pipeline, t.hdrView, t.taaView[prevIdx]);
    } else {
      draw('copy', t.resolved, this.blitPass.pipeline, t.hdrView, t.taaView[prevIdx]);
    }

    // --- shafts: radial scatter from the sun, half res, AFTER the temporal
    //     resolve. It reads `weather2.y`, which three sessions of poses, weather
    //     events and LLM tools wrote without anything consuming it.
    //
    //     Skipped entirely at zero strength, so a clear day costs one branch in
    //     the composite and no pass at all.
    const shafted = this.world.weather.godRays > 0.001;
    if (shafted) {
      draw('shafts', t.shafts, this.shaftPass.pipeline, t.resolvedView, t.taaView[prevIdx]);
    }
    // Same sun-screen test the shader runs, on the CPU, so a diagnostic can say
    // "shafts are on and the sun is off frame" instead of leaving you guessing.
    const sp = this.projectSunUv();
    this.stats.shafts = {
      strength: +this.world.weather.godRays.toFixed(3),
      passRan: shafted,
      sunOnScreen: shafted && sp[0] >= 0 && sp[0] <= 1 && sp[1] >= 0 && sp[1] <= 1,
      sunUv: [+sp[0].toFixed(3), +sp[1].toFixed(3)],
    };

    // --- lens: warp, CA, defocus, halation, tonemap, grade, vignette, grain.
    const p = enc.beginRenderPass({
      label: 'composite',
      colorAttachments: [{
        view: this.gpu.ctx.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store',
      }],
    });
    p.setPipeline(this.compositePass.pipeline);
    p.setBindGroup(0, this.frameBg, bg0);
    // The composite reads `dofTex` (binding 4) as the shaft term, so when the
    // pass ran, that slot has to BE the shaft buffer. Keying the group on a
    // suffix rather than mutating the cached one keeps both variants alive.
    p.setBindGroup(1, shafted
      ? this.postBg('composite+shafts', t.resolved, t.resolvedView, t.taaView[prevIdx], t.shaftsView)
      : this.postBg('composite', t.resolved, t.resolvedView, t.taaView[prevIdx]));
    p.draw(3);
    p.end();
  }

  /** Radial shaft pass. Consumes `weather2.y`, which nothing read for three sessions. */
  private shaftPass!: ReturnType<typeof makeRenderPass>;

  /**
   * Where the sun lands in screen uv, by the same construction the shader uses:
   * a point far along `sunDir`, pushed through the frame's viewProj. Mirrors
   * `sunScreenUv()` in post.wgsl — the two must agree or the diagnostic lies
   * about a frame the shader drew differently.
   */
  private projectSunUv(): [number, number] {
    const m = this.frameData;
    const s = sunDirection(this.world.sun);
    const P = 1e6;
    const x = s[0] * P, y = s[1] * P, z = s[2] * P;
    const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
    const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
    const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (cw <= 1e-6) return [-10, -10];
    return [cx / cw * 0.5 + 0.5, 0.5 - cy / cw * 0.5];
  }

  /** Mip 0 of the bloom chain needs the threshold, not a plain downsample. */
  private bloomThreshold!: ReturnType<typeof makeRenderPass>;

  // ---------------------------------------------------------------- control

  /**
   * Draw an instanced entity set into an already-configured pass. The instance
   * buffer must already hold `count` records in the 24-float layout.
   */
  private drawEntity(
    pass: GPURenderPassEncoder, mesh: GpuMesh, count: number, instanceOffset = 0,
  ): void {
    if (count <= 0 || mesh.indexCount === 0) return;
    pass.setVertexBuffer(0, mesh.vbo);
    pass.setVertexBuffer(1, this.instBuf);
    pass.setIndexBuffer(mesh.ibo, mesh.indexFormat);
    pass.drawIndexed(mesh.indexCount, count, 0, 0, instanceOffset);
  }

  /** Upload a contiguous instance block and return the draw count. */
  uploadInstances(data: Float32Array, count: number): number {
    const n = Math.min(count, Math.floor(this.instBuf.size / INSTANCE_FLOATS));
    if (n <= 0) return 0;
    this.gpu.device.queue.writeBuffer(
      this.instBuf, 0, data as unknown as BufferSource, 0, n * INSTANCE_FLOATS,
    );
    return n;
  }

  /**
   * Deterministic frame capture.
   *
   * Re-runs the composite into an offscreen texture we own, copies it to a
   * mapped buffer, and returns RGBA bytes. This deliberately does not go
   * through the canvas: a WebGPU swapchain texture is transient, and reading
   * it after presentation yields black on several backends even when the render
   * is perfect. Anything that wants a picture of the sim should come through
   * here.
   */
  async captureRGBA(): Promise<{ width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } | null> {
    const t = this.targets;
    if (!t) return null;
    const dev = this.gpu.device;
    const w = t.w, h = t.h;
    const ph = this.stats.capturePhases;
    const mark = performance.now();
    let t0 = mark;
    const phase = (k: 'tex' | 'encode' | 'buf' | 'submit' | 'map' | 'read' | 'free'): void => {
      const now = performance.now();
      ph[k] = now - t0;
      t0 = now;
    };
    this.capturePending = true;
    try {
      return await this.captureLocked(dev, t, w, h, ph, mark, phase);
    } finally {
      this.capturePending = false;
      // A readback is not a frame. Without this the first frame after a capture
      // reports the capture's whole duration as its frame time, which is one
      // large enough lie to feed the quality governor three times over.
      this.lastFrameAt = performance.now();
    }
  }

  /** The body of `captureRGBA`, with the readback gate already held. */
  private async captureLocked(
    dev: GPUDevice, t: RenderTargets, w: number, h: number,
    ph: CapturePhases, mark: number,
    phase: (k: 'tex' | 'encode' | 'buf' | 'submit' | 'map' | 'read' | 'free') => void,
  ): Promise<{ width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> } | null> {
    if (!this.captureTex || !this.captureView
      || this.captureTex.width !== w || this.captureTex.height !== h) {
      this.captureTex?.destroy();
      this.captureTex = dev.createTexture({
        label: 'capture', size: [w, h], format: this.gpu.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      this.captureView = this.captureTex.createView();
    }
    phase('tex');
    const view = this.captureView!;
    {
    }
    const prevIdx = this.frameIndex % 2;
    const enc = dev.createCommandEncoder({ label: 'capture' });
    const p = enc.beginRenderPass({
      label: 'capture-composite',
      colorAttachments: [{
        view, clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
    });
    p.setPipeline(this.compositePass.pipeline);
    p.setBindGroup(0, this.frameBg, [0]);
    // Same shaft-aware bind group the live path uses. This pass re-composites
    // into the readback target, so if it does not bind the shaft buffer then
    // binding 4 is the DOF buffer and every capture — every screenshot the
    // harness takes, every `--eval` pixel read — silently shows a frame with
    // the volumetrics missing. That is not a subtle difference: it is the
    // difference between measuring the feature and measuring its absence, and
    // it looks exactly like the bug it hides.
    const shafted = this.world.weather.godRays > 0.001;
    p.setBindGroup(1, shafted
      ? this.postBg('composite+shafts', t.resolved, t.resolvedView, t.taaView[prevIdx], t.shaftsView)
      : this.postBg('composite', t.resolved, t.resolvedView, t.taaView[prevIdx]));
    p.draw(3);
    p.end();
    phase('encode');

    const bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = dev.createBuffer({
      size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    phase('buf');
    enc.copyTextureToBuffer(
      { texture: this.captureTex },
      { buffer: buf, bytesPerRow: bpr, rowsPerImage: h },
      { width: w, height: h },
    );
    dev.queue.submit([enc.finish()]);
    phase('submit');
    await buf.mapAsync(GPUMapMode.READ);
    phase('map');
    const src = new Uint8Array(buf.getMappedRange());
    const out = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
    const bgra = this.gpu.format.startsWith('bgra');
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = y * bpr + x * 4;
        const d = (y * w + x) * 4;
        out[d] = bgra ? src[s + 2] : src[s];
        out[d + 1] = src[s + 1];
        out[d + 2] = bgra ? src[s] : src[s + 2];
        out[d + 3] = 255;
      }
    }
    phase('read');
    buf.unmap();
    buf.destroy();
    phase('free');
    ph.w = w; ph.h = h; ph.bytes = bpr * h;
    ph.total = performance.now() - mark;
    this.stats.captureMs = ph.total;
    return { width: w, height: h, data: out };
  }

  private captureTex: GPUTexture | null = null;
  private captureView: GPUTextureView | null = null;

  /**
   * Read back a small grid of pixels from an internal target. This is a
   * diagnostic, not a hot path: it exists so a headless run can prove which
   * stage of the frame graph is producing black instead of guessing.
   */
  async probe(
    target: 'hdr' | 'gbuffer' | 'resolved' | 'dof' | 'bloom' | 'tiles' | 'lights' | string = 'hdr',
  ): Promise<number[]> {
    const t = this.targets;
    if (!t) return [];
    // `tiles` is not a texture sample, it is the tile-bin occupancy. Reachable
    // through the existing `probe` entry point so it does not need a new
    // binding in `main.ts`, and returned flat for the same reason:
    //   [bins, capacity, maxPerTile, cap, refusedTiles, fullTiles, meanCount,
    //    busiestCount0, x0, y0, ...]
    if (target === 'tiles') {
      const s = await this.tileStats();
      const flat = [s.bins, s.capacity, s.maxPerTile, s.cap, s.refusedTiles, s.fullTiles, s.meanCount];
      for (const b of s.busiest) flat.push(b.count, b.x, b.y);
      return flat;
    }
    // The packed light array as the GPU holds it. For "the bin names light 47,
    // is 47 the lantern I think it is?" — the two ends of the pipeline are
    // written by different code in different files and there is no other way to
    // compare them.
    if (target === 'lights') {
      const n = this.stats.lights;
      // 32 bytes per light, but the buffer must be a multiple of 4 for
      // copyBufferToBuffer and the map range must be a multiple of 8. One light is
      // 32 bytes so n*32 is always fine; the max(32) was only ever to avoid a
      // zero-size buffer.
      const bytes = Math.max(32, n * 32);
      const rb = this.gpu.device.createBuffer({
        size: bytes,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      await this.gpu.device.queue.onSubmittedWorkDone();
      const enc = this.gpu.device.createCommandEncoder({ label: 'lights-read' });
      enc.copyBufferToBuffer(this.lightBuf, 0, rb, 0, bytes);
      this.gpu.device.queue.submit([enc.finish()]);
      await rb.mapAsync(GPUMapMode.READ);
      const f = new Float32Array(rb.getMappedRange().slice(0, bytes));
      rb.unmap(); rb.destroy();
      const out: number[] = [];
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 8; k++) out.push(+f[i * 8 + k].toFixed(2));
      }
      return out;
    }
    // `tileat:<x>,<y>` — the pixel is in the string, because the question is
    // always asked about a pixel somebody is looking at and hard-coding one here
    // would answer a question nobody asked.
    if (target.startsWith('tileat:')) {
      const [sx, sy] = target.slice(7).split(',').map(Number);
      const a = await this.tileAt(sx, sy);
      return [a.tx, a.ty, a.count, a.stored, ...a.indices];
    }
    const dev = this.gpu.device;
    const map: Record<string, { tex: GPUTexture; bpp: number; hdr: boolean }> = {
      hdr: { tex: t.hdr, bpp: 8, hdr: true },
      resolved: { tex: t.resolved, bpp: 8, hdr: true },
      dof: { tex: t.dof, bpp: 8, hdr: true },
      bloom: { tex: t.bloom[0], bpp: 8, hdr: true },
      gbuffer: { tex: t.gAlbedo, bpp: 4, hdr: false },
    };
    const m = map[target];
    if (!m) return [];
    // A 3x3 grid over the middle of the target. `copyTextureToBuffer` requires
    // bytesPerRow to be a 256 multiple whenever the copy has rows, so each row
    // gets its own padded stride — an 8-byte stride is a validation error and
    // silently returns zeros.
    const xs = [m.tex.width >> 2, m.tex.width >> 1, (m.tex.width * 3) >> 2];
    const ys = [m.tex.height >> 2, m.tex.height >> 1, (m.tex.height * 3) >> 2];
    const stride = 256;
    const buf = dev.createBuffer({
      size: stride * ys.length, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const enc = dev.createCommandEncoder({ label: 'probe' });
    ys.forEach((y, row) => {
      enc.copyTextureToBuffer(
        { texture: m.tex, origin: { x: xs[0], y, z: 0 } },
        { buffer: buf, offset: row * stride, bytesPerRow: stride, rowsPerImage: 1 },
        { width: 3, height: 1, depthOrArrayLayers: 1 },
      );
    });
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(buf.getMappedRange());
    const out: number[] = [];
    const rd = (o: number) => (m.hdr
      ? halfToFloat(src[o] | (src[o + 1] << 8))
      : Number(src[o] / 255));
    for (let row = 0; row < ys.length; row++) {
      for (let col = 0; col < 3; col++) {
        const o = row * stride + col * m.bpp;
        out.push(rd(o), rd(o + 2), rd(o + 4));
      }
    }
    buf.unmap();
    buf.destroy();
    return out;
  }


  /**
   * Read back the screen-tile light bins and report their occupancy.
   *
   * This exists because of `MAX_PER_TILE = 96`. The cap refuses lights in the
   * busiest tiles, it does so with no error, and the refusal is invisible from
   * `stats.lights` — which counts what was *handed to* the binner, not what
   * survived it. So the question "is the cap biting, and where" had no answer
   * without reading the bins, and the honest way to settle it is to read them.
   *
   * Returns the busiest bins, not an average: an average over 5700 tiles hides
   * a handful of saturated tiles completely, and a saturated tile is exactly
   * the failure — every pixel in it silently loses a light.
   */
  async tileStats(): Promise<{
    bins: number; capacity: number; maxPerTile: number; cap: number;
    refusedTiles: number; fullTiles: number; meanCount: number;
    busiest: { x: number; y: number; count: number }[];
  }> {
    const dev = this.gpu.device;
    const bins = this.tileCapacity;
    const bytes = bins * 400;
    const rb = dev.createBuffer({
      label: 'tile-readback', size: bytes,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    // `await dev.queue.onSubmittedWorkDone()` first. The bin pass for this
    // frame is already queued but the copy below would otherwise be recorded
    // against a buffer whose bins have not been written yet — and a buffer full
    // of zeros is a perfectly valid thing to read back. That is not a
    // hypothetical: it is what the first version of this probe returned,
    // `meanCount 0` with 548 lights binned, which reads exactly like "the tiles
    // are empty" and is why the race is worth a comment.
    await dev.queue.onSubmittedWorkDone();
    const enc = dev.createCommandEncoder({ label: 'tile-readback' });
    enc.copyBufferToBuffer(this.tileBuf, 0, rb, 0, bytes);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    // `count` is the third u32 of the Bin: 96 light slots then the count.
    const u = new Uint32Array(rb.getMappedRange());
    const tx = Math.ceil(this.targetsW / 16);
    let max = 0, refused = 0, full = 0, total = 0;
    const hot: { x: number; y: number; count: number }[] = [];
    for (let i = 0; i < bins; i++) {
      const c = u[i * 100 + 96];
      total += Math.min(c, 96);
      if (c > max) max = c;
      if (c > 96) { refused += c - 96; full++; }
      if (c > 48) hot.push({ x: i % tx, y: (i / tx) | 0, count: c });
    }
    hot.sort((a, b) => b.count - a.count);
    rb.unmap();
    rb.destroy();
    this.stats.tileBins.maxPerTile = max;
    this.stats.tileBins.refusedTiles = refused;
    return {
      bins, capacity: this.tileCapacity, maxPerTile: max, cap: 96,
      refusedTiles: refused, fullTiles: full, meanCount: total / Math.max(1, bins),
      busiest: hot.slice(0, 8),
    };
  }

  /**
   * Dump one tile's binned light indices. Diagnostic for "the bin has the lights
   * but the pixel is still dark" — the one failure mode where `meanCount` and
   * `stats.lights` both look healthy.
   *
   * Takes a pixel, not a tile, because the question is always asked about a
   * pixel someone is looking at.
   */
  async tileAt(px: number, py: number): Promise<{
    tx: number; ty: number; count: number; stored: number; indices: number[];
  }> {
    const dev = this.gpu.device;
    const tx = Math.floor(px / 16), ty = Math.floor(py / 16);
    const tiles = Math.ceil(this.targetsW / 16) * Math.ceil(this.targetsH / 16);
    const idx = ty * Math.ceil(this.targetsW / 16) + tx;
    if (idx < 0 || idx >= tiles) return { tx, ty, count: -1, stored: 0, indices: [] };
    const rb = dev.createBuffer({
      size: 400, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    await dev.queue.onSubmittedWorkDone();
    const enc = dev.createCommandEncoder({ label: 'tile-at' });
    enc.copyBufferToBuffer(this.tileBuf, idx * 400, rb, 0, 400);
    dev.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const u = new Uint32Array(rb.getMappedRange().slice(0));
    rb.unmap(); rb.destroy();
    const count = u[96];
    const stored = Math.min(count, 96);
    const indices: number[] = [];
    for (let i = 0; i < stored; i++) indices.push(u[i]);
    return { tx, ty, count, stored, indices };
  }

  /** Recent entity draw calls, for diagnosing "is it actually being issued". */
  entityDraws: string[] = [];
  /**
   * `counter.entity` as published — which is 0, because its only incrementer has
   * no callers. Kept so the two can be compared rather than one silently
   * replacing the other; see the `entityDrawCalls` assignment in the frame
   * finaliser.
   */
  statsEntityCounterOnly = 0;

  get entityGeometry() { return this.entities; }
  get instanceBuffer() { return this.instBuf; }
  get groundMesh() { return this.ground; }
  freezeCaptureResidency(): void { this.captureFrozen = true; }
  get submittedFrames(): number { return this.frameIndex; }
  captureResidency() {
    return [...this.chunks.values()].map((c) => ({ cx: c.cx, cz: c.cz, lod: c.lod, version: c.version }))
      .sort((a, b) => a.cx - b.cx || a.cz - b.cz);
  }
  captureMatrices() { return { view: Array.from(this.view), projection: Array.from(this.proj), viewProjection: Array.from(this.viewProj) }; }
  expectedCaptureMatrices(pose: { position: Vec3; lookAt: Vec3; roll: number }, lens: WorldState['lens']) {
    const view = m4(), projection = m4(), viewProjection = m4();
    writeCaptureProjection(view, projection, pose.position, pose.lookAt, pose.roll, lens.fov + (lens._fovOffset ?? 0), this.targetsW, this.targetsH);
    m4mul(viewProjection, projection, view);
    return { view: Array.from(view), projection: Array.from(projection), viewProjection: Array.from(viewProjection) };
  }
  /** Diagnostic replay only; synchronous exact residency is not a streaming benchmark. */
  async replayCaptureResidency(saved: readonly { cx: number; cz: number; lod: number }[]): Promise<void> {
    if (!this.captureFrozen) throw new Error('residency replay requires a frozen capture');
    const wanted = new Map<string, typeof saved[number]>();
    for (const item of saved) {
      if (![item.cx, item.cz, item.lod].every(Number.isInteger) || item.lod < 0 || item.lod > 3) throw new Error('invalid saved residency');
      const key = this.chunkKey(item.cx, item.cz);
      if (wanted.has(key) || !this.city.getChunk(item.cx, item.cz)) throw new Error(`invalid or duplicate saved chunk ${key}`);
      wanted.set(key, item);
    }
    await this.gpu.device.queue.onSubmittedWorkDone();
    for (const [key, entry] of this.chunks) {
      if (wanted.has(key)) continue;
      destroyMesh(entry.mesh); destroyMesh(entry.foliage);
      this.chunks.delete(key);
      this.residencyRevision++;
    }
    for (const [key, item] of wanted) {
      if (this.chunks.get(key)?.lod === item.lod) continue;
      const chunk = this.city.getChunk(item.cx, item.cz)!;
      this.uploadChunk(item.cx, item.cz, bakeChunk(chunk, item.lod, this.world.seed), item.lod);
    }
    const signature = (entries: readonly { cx: number; cz: number; lod: number }[]) => JSON.stringify(
      entries.map(({ cx, cz, lod }) => ({ cx, cz, lod })).sort((a, b) => a.cx - b.cx || a.cz - b.cz));
    if (signature(this.captureResidency()) !== signature(saved)) throw new Error('residency replay did not reproduce saved keys and LODs');
  }
  crowdObstacles() {
    if (this.obstacleCache.revision !== this.residencyRevision) {
      this.obstacleCache = { revision: this.residencyRevision, obstacles: [...this.chunks.values()].flatMap((c) => c.obstacles) };
    }
    return this.obstacleCache;
  }
  /** Resident walking triangles, rebuilt only when residency changes. */
  // ponytail: full concatenation per revision; per-chunk index slices if streaming makes this hot.
  crowdWalkingSurfaces() {
    if (this.walkingCache.revision !== this.residencyRevision) {
      const parts = [...this.chunks.values()].map((c) => c.walking);
      const triangles = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) { triangles.set(p, o); o += p.length; }
      this.walkingCache = { revision: this.residencyRevision, triangles };
    }
    return this.walkingCache;
  }
  /** Initialise both histories alike after a capture phase cut, without rewinding telemetry. */
  resetTemporalHistory(): void {
    if (!this.targets) return;
    this.prevViewProj.set(this.viewProj);
    const enc = this.gpu.device.createCommandEncoder({ label: 'reset-capture-history' });
    for (const view of this.targets.taaView) {
      const pass = enc.beginRenderPass({ colorAttachments: [{
        view, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store',
      }] });
      pass.end();
    }
    this.gpu.device.queue.submit([enc.finish()]);
  }
  /** Detail level a resident chunk was baked at, or -1 if it is not resident. */
  chunkLod(cx: number, cz: number): number {
    return this.chunks.get(this.chunkKey(cx, cz))?.lod ?? -1;
  }
  /** Camera chunk, so a diagnostic can name the chunks it cares about. */
  cameraChunk(pos: Vec3): [number, number] {
    const cs = this.city.cfg.chunkSize;
    return [Math.floor(pos[0] / cs), Math.floor(pos[2] / cs)];
  }
  get frameUboSize() { return FRAME_UNIFORM_SIZE; }
}

/** IEEE-754 half -> float, for readback of rgba16float targets. */
function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

const PRECIP_IDS: Record<string, number> = {
  none: 0, rain: 1, drizzle: 2, snow: 3, pollen: 4, ash: 5, spores: 6,
};
function precipId(p: string): number { return PRECIP_IDS[p] ?? 0; }

export type { Mesh };
export { TIERS } from './quality';
export type { QualitySettings, QualityTier } from './quality';
export { CASCADE_SPLITS, cascadeParams, extractOrthoFrustum, sphereInFrustum } from './cascade';
export { LOD_CHUNK_STEP, chunkDistance, lodForDistance } from './quality';
