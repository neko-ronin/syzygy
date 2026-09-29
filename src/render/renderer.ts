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
  mat4 as m4, mat4identity as m4identity, m4invert, m4lookAt, m4mul,
  m4perspectiveReverseZ, v3norm, v3cross, type Mat4, type Vec3,
} from '../core/math';
import { defaultWorld, fovOf, sunDirection, type WorldState } from '../core/state';
import {
  destroyMesh, FRAME_UNIFORM_SIZE, INSTANCE_FLOATS, instanceVertexLayout, makeComputePass,
  makeFrameBindGroup, makeFrameLayout, makeLayout, makeRenderPass, meshVertexLayout,
  seedTexture, uploadMesh, type GpuMesh, type Slot,
} from './gpuutil';
import { modules } from './wgsl';
import { bakeChunk, bakeGround, entityMeshes, makeInstanceWriter, MAT, type BakedChunk } from './citymesh';
import { City, defaultCityConfig } from '../world/citygen';
import type { FlightCamera } from '../camera/camera';
import type { Mesh } from '../world/geometry';

// ---------------------------------------------------------------- quality

export type QualityTier = 'potato' | 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  tier: QualityTier;
  /** Backbuffer scale. Above 1 is supersampling. */
  renderScale: number;
  shadowRes: number;
  cascades: number;
  /** Max chunks drawn, by LOD. */
  lodRange: [number, number];
  bloomLevels: number;
  dofEnabled: boolean;
  taaEnabled: boolean;
  /** Static city draw distance in chunks. */
  viewDistance: number;
  foliageEnabled: boolean;
}

const TIERS: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  potato: { renderScale: 0.6, shadowRes: 1024, cascades: 2, lodRange: [0, 3], bloomLevels: 3, dofEnabled: false, taaEnabled: true, viewDistance: 3, foliageEnabled: false },
  low: { renderScale: 0.75, shadowRes: 1024, cascades: 3, lodRange: [0, 3], bloomLevels: 4, dofEnabled: true, taaEnabled: true, viewDistance: 4, foliageEnabled: true },
  medium: { renderScale: 1.0, shadowRes: 2048, cascades: 4, lodRange: [0, 2], bloomLevels: 4, dofEnabled: true, taaEnabled: true, viewDistance: 5, foliageEnabled: true },
  high: { renderScale: 1.0, shadowRes: 2048, cascades: 4, lodRange: [0, 1], bloomLevels: 5, dofEnabled: true, taaEnabled: true, viewDistance: 7, foliageEnabled: true },
  ultra: { renderScale: 1.35, shadowRes: 4096, cascades: 4, lodRange: [0, 0], bloomLevels: 6, dofEnabled: true, taaEnabled: true, viewDistance: 9, foliageEnabled: true },
};

// ---------------------------------------------------------------- constants

const HDR: GPUTextureFormat = 'rgba16float';
const DEPTH: GPUTextureFormat = 'depth32float';
const SHADOW_FMT: GPUTextureFormat = 'depth32float';
const CASCADE_COUNT = 4;
/** One cascade's params, padded to the dynamic-offset alignment. */
const CASCADE_STRIDE = 256;
const MAX_LIGHTS = 3072;

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
}

interface ChunkEntry {
  cx: number; cz: number;
  mesh: GpuMesh | null;
  foliage: GpuMesh | null;
  lights: BakedChunk['lights'];
  radius: number;
  lastUsed: number;
  centre: Vec3;
}

export interface RendererStats {
  frameMs: number;
  fps: number;
  drawCalls: number;
  triangles: number;
  residentChunks: number;
  visibleChunks: number;
  lights: number;
  vramMB: number;
  tier: QualityTier;
  bakeMs: number;
  uploadMs: number;
  frustumCulled: number;
}

export class Renderer {
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
  private cascadeSplits = new Float32Array([60, 220, 700, 2400]);

  private frameIndex = 0;
  private lastCpu = 0;
  private bakeAccum = 0;
  private frameTimes: number[] = [];
  private lightWriter = makeInstanceWriter(MAX_LIGHTS);
  private pendingBakes: { cx: number; cz: number }[] = [];

  stats: RendererStats = {
    frameMs: 16.7, fps: 60, drawCalls: 0, triangles: 0, residentChunks: 0,
    visibleChunks: 0, lights: 0, vramMB: 0, tier: 'high', bakeMs: 0,
    uploadMs: 0, frustumCulled: 0,
  };

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
    const dev = this.gpu.device;

    this.frameBgl = makeFrameLayout(dev);
    this.frameBg = makeFrameBindGroup(dev, this.frameBgl, this.gpu.frameUbo);

    this.shadowUbo = dev.createBuffer({
      label: 'shadow-params', size: CASCADE_COUNT * CASCADE_STRIDE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.lightBuf = dev.createBuffer({
      label: 'lights', size: MAX_LIGHTS * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.tileBuf = dev.createBuffer({
      label: 'light-tiles', size: 16 * 16 * 400, usage: GPUBufferUsage.STORAGE,
    });
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
    ];
    this.lightBgl = makeLayout(dev, 'lighting:bgl', lightSlots);
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
      pedestrian: uploadMesh(this.gpu, 'ped', entityMeshes.pedestrian()),
      tram: uploadMesh(this.gpu, 'tram', entityMeshes.tramCar()),
      cablecar: uploadMesh(this.gpu, 'cablecar', entityMeshes.cableCar()),
      blimp: uploadMesh(this.gpu, 'blimp', entityMeshes.blimp()),
      balloon: uploadMesh(this.gpu, 'balloon', entityMeshes.balloon()),
      rider: uploadMesh(this.gpu, 'rider', entityMeshes.ziplineRider()),
    };
  }

  // ---------------------------------------------------------------- sizing

  setQuality(tier: QualityTier): void {
    if (this.quality === tier) return;
    this.quality = tier;
    this.q = TIERS[tier];
    this.allocShadow();
    // Cascades may have shrunk; drop the now-unused atlas entries.
    for (let i = this.q.cascades; i < CASCADE_COUNT; i++) {
      seedTexture(this.gpu, this.shadowTex[i], true, 1.0);
    }
    this.resize();
  }

  get settings(): QualitySettings { return { tier: this.quality, ...this.q }; }

  private resize(): void {
    const { w, h } = this.gpu.resize(this.q.renderScale);
    if (w === this.targetsW && h === this.targetsH && this.targets) return;
    this.targetsW = w; this.targetsH = h;
    this.allocTargets(w, h);
  }

  private allocTargets(w: number, h: number): void {
    const gpu = this.gpu;
    const t = this.targets;
    if (t) {
      for (const k of ['gAlbedo', 'gNormal', 'gEmis', 'gDepth', 'hdr', 'dof', 'dofTmp', 'resolved'] as const) t[k].destroy();
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
    m4lookAt(this.view, cam.position, cam.lookTarget, upFromRoll(cam.roll));
    m4perspectiveReverseZ(this.proj, fovOf(w), this.targetsW / Math.max(1, this.targetsH), near, Infinity);
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
    put(w.lens.colorGrade[0], w.lens.colorGrade[1], w.lens.colorGrade[2], 0);
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
    const splits = [45, 160, 520, 1900];
    this.cascadeSplits.set(splits);
    for (let i = 0; i < this.q.cascades; i++) {
      const near = i === 0 ? 0.1 : splits[i - 1];
      const far = splits[i];
      // Build a light-space frustum slab around the camera's view of that range.
      const centre = v3scaleAdd(cam.position, cam.forward, (near + far) * 0.5);
      const radius = (far - near) * 0.62 + 40;
      const up = Math.abs(s[1]) > 0.98 ? UP_ALT : UP;
      const lz = v3norm([centre[0] - s[0] * radius * 2, centre[1] - s[1] * radius * 2, centre[2] - s[2] * radius * 2]);
      const lx = v3norm(v3cross(UP_ALT, lz));
      v3cross(lz, lx);
      const eye: Vec3 = [centre[0] + lx[0] * radius, centre[1] + lx[1] * radius, centre[2] + lx[2] * radius];
      const lv = m4lookAt(m4(), eye, centre, up);
      // Orthographic, snapping the centre to texel increments to stop shimmer.
      const lp = m4ortho(m4(), -radius, radius, -radius, radius, 0.1, radius * 4.2);
      m4mul(this.cascadeMats[i], lp, lv);
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

  /** Bake and upload the closest missing chunks, one per frame to avoid hitches. */
  private streamChunks(cam: FlightCamera): void {
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
          if (this.chunks.has(this.chunkKey(cx, cz))) continue;
          this.pendingBakes.push({ cx, cz });
        }
      }
      this.pendingBakes.sort((a, b) =>
        ((a.cx - pcx) ** 2 + (a.cz - pcz) ** 2) - ((b.cx - pcx) ** 2 + (b.cz - pcz) ** 2));
    }

    const t0 = performance.now();
    let baked = 0;
    while (this.pendingBakes.length > 0 && performance.now() - t0 < 4) {
      const job = this.pendingBakes.shift()!;
      const key = this.chunkKey(job.cx, job.cz);
      if (this.chunks.has(key)) continue;
      const chunk = this.city.getChunk(job.cx, job.cz);
      if (!chunk) continue;
      this.uploadChunk(job.cx, job.cz, bakeChunk(chunk, 0, this.world.seed));
      baked++;
    }
    const ms = performance.now() - t0;
    if (ms > 0.05) { this.bakeAccum = this.bakeAccum * 0.88 + ms * 0.12; this.stats.bakeMs = this.bakeAccum; }
    if (baked) this.evictChunks(r);
  }

  private uploadChunk(cx: number, cz: number, baked: BakedChunk): void {
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
      cx, cz, mesh, foliage, lights: baked.lights, radius, centre, lastUsed: this.frameIndex,
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
    }
  }

  // ---------------------------------------------------------------- lights

  private gatherLights(cam: FlightCamera): number {
    const w = this.lightWriter;
    w.reset();
    const r = this.q.viewDistance;
    for (const e of this.chunks.values()) {
      const d = Math.hypot(e.centre[0] - cam.position[0], e.centre[2] - cam.position[2]);
      if (d > (r + 1) * 320) continue;
      // Night only: the sun out-competes them by day and the binning cost is
      // not worth paying.
      if (this.world.dayPhase > 0.55) continue;
      for (const l of e.lights) {
        if (w.count >= MAX_LIGHTS) break;
        w.pushStatic(l.color, 5, 1, l.intensity, 0);
        // Overwrite the position that pushStatic left at identity.
        const o = (w.count - 1) * 24;
        w.data[o + 12] = l.pos[0];
        w.data[o + 13] = l.pos[1];
        w.data[o + 14] = l.pos[2];
        w.data[o + 15] = l.radius;
        w.data[o + 19] = l.intensity;
      }
    }
    this.gpu.device.queue.writeBuffer(this.lightBuf, 0, w.data as unknown as BufferSource, 0, Math.max(1, w.count) * 8);
    this.stats.lights = w.count;
    return w.count;
  }

  // ---------------------------------------------------------------- frame

  render(cam: FlightCamera, dt: number): void {
    if (!this.targets) return;
    const t0 = performance.now();
    this.resize();
    this.updateCascades(cam);
    this.writeFrameUniforms(cam);
    this.streamChunks(cam);
    const lightCount = this.gatherLights(cam);

    const enc = this.gpu.device.createCommandEncoder({ label: 'frame' });
    this.recordShadow(enc, cam);
    const visible = this.recordGBuffer(enc, cam, this.pendingEntities);
    this.recordBinning(enc, lightCount);
    this.recordLighting(enc);
    this.recordPost(enc);
    this.gpu.device.queue.submit([enc.finish()]);

    this.frameIndex++;
    const cpu = performance.now() - t0;
    this.lastCpu = this.lastCpu * 0.9 + cpu * 0.1;
    this.frameTimes.push(cpu);
    if (this.frameTimes.length > 60) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.stats.frameMs = this.lastCpu;
    this.stats.fps = avg > 0.0001 ? 1000 / Math.max(avg, dt * 1000) : 60;
    this.stats.visibleChunks = visible;
    this.stats.residentChunks = this.chunks.size;
    this.stats.tier = this.quality;
    this.world.perf.frameMs = this.stats.frameMs;
    this.world.perf.fps = this.stats.fps;
    this.world.perf.drawCalls = this.stats.drawCalls;
    this.world.perf.triangles = this.stats.triangles;
    this.world.perf.residentChunks = this.chunks.size;
    this.world.perf.visibleDraws = visible;
    this.world.perf.tier = this.quality;
    void dt;
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
    if (entities) entities(pass);
    pass.end();
    return visible;
  }

  /** Issue one indexed draw per visible chunk. Shared by the shadow and g-buffer passes. */
  private drawChunks(
    pass: GPURenderPassEncoder, cam: FlightCamera, shadowOnly: boolean, _cascade: number,
  ): number {
    let draws = 0;
    let tris = 0;
    let culled = 0;
    const planes = cam.frustumPlanes;

    // The street deck goes down first with depth writes off, so it only fills
    // pixels nothing else claims. Without it, a top-down view is all sky and a
    // street-level view has a void under the buildings.
    if (this.ground.indexCount > 0) {
      pass.setVertexBuffer(0, this.ground.vbo);
      pass.setVertexBuffer(1, shadowOnly ? this.groundInst : this.groundInst);
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
      if (!shadowOnly && e.foliage && this.q.foliageEnabled) {
        pass.setVertexBuffer(0, e.foliage.vbo);
        pass.setIndexBuffer(e.foliage.ibo, e.foliage.indexFormat);
        pass.drawIndexed(e.foliage.indexCount);
        draws++;
        tris += e.foliage.indexCount / 3;
      }
    }
    this.stats.drawCalls = draws;
    this.stats.triangles = tris;
    this.stats.frustumCulled = culled;
    return draws;
  }

  private recordBinning(enc: GPUCommandEncoder, lightCount: number): void {
    const bg = this.gpu.device.createBindGroup({
      label: 'bin-bg', layout: this.binBgl,
      entries: [
        { binding: 0, resource: { buffer: this.lightBuf } },
        { binding: 1, resource: { buffer: this.tileBuf } },
      ],
    });
    const cp = enc.beginComputePass({ label: 'lightbin' });
    const tiles = Math.ceil(this.targetsW / 16) * Math.ceil(this.targetsH / 16);
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

  /** Draw a named entity set with the given instance block. */
  drawEntitySet(
    pass: GPURenderPassEncoder, name: keyof typeof this.entities, data: Float32Array, count: number,
  ): void {
    const mesh = this.entities[name];
    if (!mesh) return;
    const n = this.uploadInstances(data, count);
    this.drawEntity(pass, mesh, n);
    this.stats.drawCalls++;
    this.stats.triangles += (mesh.indexCount / 3) * n;
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
      ],
    });
    const pass = enc.beginRenderPass({
      label: 'lighting',
      colorAttachments: [{ view: t.hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(this.lightingPass.pipeline);
    pass.setBindGroup(0, this.frameBg, [0]);
    pass.setBindGroup(1, bg);
    pass.draw(3);
    pass.end();
  }

  /**
   * Post passes all share one bind-group layout, so a pass that reads from an
   * arbitrary mip of the bloom chain just needs a different source view. Rather
   * than hand-maintaining a dozen groups, key them by source texture — there
   * are at most `bloomLevels + 4` distinct ones.
   */
  private postBg(
    key: string, target: GPUTexture, src: GPUTextureView, prev: GPUTextureView,
  ): GPUBindGroup {
    const t = this.targets!;
    const k = `${key}|${src.label ?? 's'}|${prev.label ?? 'p'}`;
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
        { binding: 4, resource: safe(t.dofView, t.dof) },
        { binding: 5, resource: safe(t.hdrView, t.hdr) },
        { binding: 6, resource: this.clampSamp },
        { binding: 7, resource: safe(prev, t.taa[0] === target ? t.taa[0] : t.taa[1]) },
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
    p.setBindGroup(1, this.postBg('composite', t.resolved, t.resolvedView, t.taaView[prevIdx]));
    p.draw(3);
    p.end();
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
    if (!this.captureTex || !this.captureView
      || this.captureTex.width !== w || this.captureTex.height !== h) {
      this.captureTex?.destroy();
      this.captureTex = dev.createTexture({
        label: 'capture', size: [w, h], format: this.gpu.format,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
      this.captureView = this.captureTex.createView();
    }
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
    p.setBindGroup(1, this.postBg('composite', t.resolved, t.resolvedView, t.taaView[prevIdx]));
    p.draw(3);
    p.end();

    const bpr = Math.ceil((w * 4) / 256) * 256;
    const buf = dev.createBuffer({
      size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    enc.copyTextureToBuffer(
      { texture: this.captureTex },
      { buffer: buf, bytesPerRow: bpr, rowsPerImage: h },
      { width: w, height: h },
    );
    dev.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
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
    buf.unmap();
    buf.destroy();
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
    target: 'hdr' | 'gbuffer' | 'resolved' | 'dof' | 'bloom' = 'hdr',
  ): Promise<number[]> {
    const t = this.targets;
    if (!t) return [];
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


  get entityGeometry() { return this.entities; }
  get instanceBuffer() { return this.instBuf; }
  get groundMesh() { return this.ground; }
  get frameUboSize() { return FRAME_UNIFORM_SIZE; }
}

// ---------------------------------------------------------------- helpers

const UP: Vec3 = [0, 1, 0];
const UP_ALT: Vec3 = [0, 0, 1];
function upFromRoll(roll: number): Vec3 {
  return [Math.sin(roll), Math.cos(roll), 0];
}

function v3scaleAdd(base: Vec3, dir: Vec3, s: number): Vec3 {
  return [base[0] + dir[0] * s, base[1] + dir[1] * s, base[2] + dir[2] * s];
}

function m4ortho(out: Mat4, l: number, r: number, b: number, t: number, n: number, f: number): Mat4 {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = 1 / (n - f);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = n / (n - f);
  out[15] = 1;
  return out;
}

/** IEEE-754 half → float, for readback of rgba16float targets. */
function halfToFloat(h: number): number {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}

function sphereInFrustum(planes: Float32Array, c: Vec3, r: number): boolean {
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    if (planes[o] * c[0] + planes[o + 1] * c[1] + planes[o + 2] * c[2] + planes[o + 3] < -r) return false;
  }
  return true;
}

const PRECIP_IDS: Record<string, number> = {
  none: 0, rain: 1, drizzle: 2, snow: 3, pollen: 4, ash: 5, spores: 6,
};
function precipId(p: string): number { return PRECIP_IDS[p] ?? 0; }

export type { Mesh };
