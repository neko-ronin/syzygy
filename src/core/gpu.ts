/**
 * Backend detection and device acquisition.
 *
 * Two backends behind one interface:
 *   - `webgpu`  : WGSL, compute available, preferred. Full-fat path.
 *   - `webgl2`  : GLSL ES 3.00, transform feedback + float textures stand in for compute.
 *
 * The app only ever sees `Backend`, so a module can be written once against it and
 * get a shader translation at the edge.
 */

export type BackendKind = 'webgpu' | 'webgl2';

export interface Caps {
  backend: BackendKind;
  /** Compute pipelines available. */
  compute: boolean;
  /** Float32 render targets (filterable / blendable). */
  floatRender: boolean;
  /** Best available colour-render format. */
  hdrFormat: GPUTextureFormat | number;
  /** 32-bit float sampling (needed for reverse-Z + wide-range HDR). */
  maxAnisotropy: number;
  /** Max texture array layers usable for a material atlas. */
  maxTextureArrayLayers: number;
  maxTextureSize: number;
  maxStorageBufferBindingSize: number;
  /** Conservative 2-tier LOD ring buffer target. */
  maxUniformBufferBindingSize: number;
  /** 64-bit atomics / subgroup ops for crowd sim. */
  subgroups: boolean;
  /** RG16F/Snorm sampling — for lightmap / normal atlases. */
  textureCompression: string[];
  adapterInfo: string;
  devicePixelRatio: number;
}

export class GPUContext {
  readonly device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: GPUCanvasContext;
  readonly caps: Caps;
  readonly format: GPUTextureFormat;
  /** Session-scoped uniform buffer, 256B-aligned for dynamic offsets. */
  readonly frameUbo: GPUBuffer;
  readonly frameUboSize: number;

  private constructor(
    device: GPUDevice, canvas: HTMLCanvasElement, ctx: GPUCanvasContext,
    caps: Caps, format: GPUTextureFormat, frameUboSize: number,
  ) {
    this.device = device;
    this.canvas = canvas;
    this.ctx = ctx;
    this.caps = caps;
    this.format = format;
    this.frameUboSize = frameUboSize;
    this.frameUbo = device.createBuffer({
      label: 'frame-uniforms',
      size: frameUboSize,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  static async create(canvas: HTMLCanvasElement): Promise<GPUContext> {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser.');
    const adapter =
      (await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' })) ??
      (await navigator.gpu.requestAdapter());
    if (!adapter) throw new Error('No suitable GPU adapter was found.');

    const want: Record<string, number> = {};
    for (const [k, v] of Object.entries({
      maxTextureDimension2D: adapter.limits.maxTextureDimension2D,
      maxBufferSize: adapter.limits.maxBufferSize,
      maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
      maxUniformBufferBindingSize: adapter.limits.maxUniformBufferBindingSize,
    })) {
      void k; void v;
    }
    void want;

    const lim = adapter.limits;
    const device = await adapter.requestDevice({
      label: 'syzygy-device',
      requiredLimits: {
        maxTextureDimension2D: lim.maxTextureDimension2D,
        maxBufferSize: lim.maxBufferSize,
        maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize,
        maxUniformBufferBindingSize: lim.maxUniformBufferBindingSize,
        maxColorAttachmentBytesPerSample: lim.maxColorAttachmentBytesPerSample ?? 32,
      },
      requiredFeatures: (['float32-filterable', 'timestamp-query'] as const).filter(
        (f) => adapter.features.has(f as GPUFeatureName),
      ) as GPUFeatureName[],
    });

    const ctx = canvas.getContext('webgpu') as GPUCanvasContext;
    const format = navigator.gpu.getPreferredCanvasFormat();
    // COPY_SRC is what makes the canvas readable via toDataURL / drawImage.
    // Without it the swapchain texture is transient and every screenshot comes
    // back black while the actual render is fine.
    ctx.configure({
      device, format, alphaMode: 'opaque',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });

    const info: Record<string, unknown> = {};
    try {
      const ai = (adapter as unknown as { info?: GPUAdapterInfo }).info;
      if (ai) Object.assign(info, {
        vendor: ai.vendor, architecture: ai.architecture,
        device: ai.device, description: ai.description,
      });
    } catch { /* adapter info is optional */ }

    const hdr: GPUTextureFormat = 'rgba16float';
    const caps: Caps = {
      backend: 'webgpu',
      compute: true,
      floatRender: true,
      hdrFormat: hdr,
      maxAnisotropy: 1,
      maxTextureArrayLayers: Math.min(256, lim.maxTextureArrayLayers),
      maxTextureSize: lim.maxTextureDimension2D,
      maxStorageBufferBindingSize: lim.maxStorageBufferBindingSize,
      maxUniformBufferBindingSize: lim.maxUniformBufferBindingSize,
      subgroups: adapter.features.has('subgroups'),
      textureCompression: [...adapter.features].filter((f) => f.startsWith('texture-compression')),
      adapterInfo: describeAdapter(info),
      devicePixelRatio: globalThis.devicePixelRatio || 1,
    };

    // 64 KiB frame UBO: matrices, camera frustum, time, weather, post params,
    // light clusters head, and 64 dynamic offsets. Sized generously up front so
    // adding a uniform later never reallocates mid-frame.
    const frameUboSize = 64 * 1024;
    const context = new GPUContext(device, canvas, ctx, caps, format, frameUboSize);
    attachErrorReporting(device);
    return context;
  }

  /** Resize backing store to CSS size × dpr, clamped to device limits. */
  resize(scale = 1): { w: number; h: number; dpr: number } {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2) * scale;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.min(this.caps.maxTextureSize, Math.round(rect.width * dpr)));
    const h = Math.max(1, Math.min(this.caps.maxTextureSize, Math.round(rect.height * dpr)));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { w, h, dpr };
  }

  makeTexture(
    label: string, w: number, h: number, format: GPUTextureFormat,
    usage: GPUTextureUsageFlags, layers = 1, mips = 1, sampleCount = 1,
  ): GPUTexture {
    return this.device.createTexture({
      label,
      size: { width: Math.max(1, w), height: Math.max(1, h), depthOrArrayLayers: layers },
      format, usage, mipLevelCount: mips, sampleCount, dimension: '2d',
    });
  }

  makeBuffer(label: string, size: number, usage: GPUBufferUsageFlags, label2?: string): GPUBuffer {
    void label2;
    return this.device.createBuffer({ label, size: Math.max(16, Math.ceil(size / 4) * 4), usage });
  }

  /** Upload a typed array, recreating if the size changed. */
  write(buf: GPUBuffer, data: ArrayBufferView | number): void {
    const dev = this.device;
    if (typeof data === 'number') {
      dev.queue.writeBuffer(buf, 0, new Uint8Array([data]));
      return;
    }
    dev.queue.writeBuffer(buf, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  }
}

function describeAdapter(info: Record<string, unknown>): string {
  const parts = [info.vendor, info.architecture, info.device, info.description]
    .filter((p) => typeof p === 'string' && p.length > 0);
  return parts.length ? parts.join(' · ') : 'webgpu adapter';
}

/**
 * Validation errors are otherwise silent: a bad bind group layout just produces
 * a black frame. This pipes them into the console and onto `window.__gpuErrors`
 * so a headless run can read them back.
 */
const GPU_ERRORS: string[] = [];
(globalThis as unknown as { __gpuErrors: string[] }).__gpuErrors = GPU_ERRORS;

function attachErrorReporting(device: GPUDevice): void {
  device.addEventListener('uncapturederror', (ev) => {
    const e = ev as GPUUncapturedErrorEvent;
    const msg = e.error?.message ?? String(e.error);
    if (GPU_ERRORS.length < 200) GPU_ERRORS.push(msg);
    console.error('[webgpu]', msg);
  });
  void pushErrorScope;
}

/** Run a GPU call inside an error scope and log anything it rejects. */
export async function pushErrorScope<T>(label: string, fn: () => T): Promise<T | null> {
  const dev = (globalThis as unknown as { __gpuDevice?: GPUDevice }).__gpuDevice;
  if (!dev) return fn();
  dev.pushErrorScope('validation');
  const r = fn();
  const err = await dev.popErrorScope();
  if (err) {
    const msg = `[${label}] ${err.message}`;
    if (GPU_ERRORS.length < 200) GPU_ERRORS.push(msg);
    console.error('[webgpu]', msg);
    return null;
  }
  return r;
}

/** Device-lost handler that surfaces a readable message instead of a silent freeze. */
export function onDeviceLost(ctx: GPUContext, onFatal: (msg: string) => void): void {
  ctx.device.lost.then((info) => {
    if (info.reason === 'destroyed') return;
    onFatal(`GPU device lost: ${info.message || info.reason}`);
  });
}
