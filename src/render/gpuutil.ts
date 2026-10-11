/**
 * Small helpers over the raw WebGPU API. Nothing here allocates per-frame.
 */

import type { GPUContext } from '../core/gpu';
import { mat4 as m4, mat4identity as m4identity, m4invert, m4mul } from '../core/math';
import { interleaveMesh } from '../world/geometry';

/** Every visibility bit that can reach group 0. */
export const SCENE_VIS =
  GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;

/** Size of the frame uniform block, mirrored by the `Frame` struct in WGSL. */
/**
 * Size of the frame uniform block. `struct Frame` in common.wgsl is 9 mat4
 * (576B) + 19 vec4 (304B) = 880B, rounded up for the uniform address space's
 * 16-byte struct alignment rules.
 */
export const FRAME_UNIFORM_SIZE = 1024;

/**
 * Group 0 is always the frame uniform, in every pass, so its layout is created
 * exactly once and bound without ever being rebuilt. Dynamic offset lets the
 * shadow pass point the same buffer at a different cascade.
 */
export const FRAME_ENTRY: GPUBindGroupLayoutEntry = {
  binding: 0,
  visibility: SCENE_VIS,
  buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: FRAME_UNIFORM_SIZE },
};

export const makeFrameLayout = (device: GPUDevice): GPUBindGroupLayout =>
  device.createBindGroupLayout({ label: 'frame-bgl', entries: [FRAME_ENTRY] });

export const makeFrameBindGroup = (
  device: GPUDevice, layout: GPUBindGroupLayout, buffer: GPUBuffer,
): GPUBindGroup =>
  device.createBindGroup({
    label: 'frame-bg', layout,
    entries: [{ binding: 0, resource: { buffer, offset: 0, size: FRAME_UNIFORM_SIZE } }],
  });

/** Build a bind group layout from `(binding, kind)` pairs. */
export interface Slot {
  binding: number;
  kind: 'ubo' | 'ssbo' | 'ssbo-rw' | 'tex' | 'depthTex' | 'sampler' | 'cmpSampler';
  visibility?: number;
  dynamic?: boolean;
}

export const makeLayout = (
  device: GPUDevice, label: string, slots: readonly Slot[],
): GPUBindGroupLayout =>
  device.createBindGroupLayout({
    label,
    entries: slots.map((s) => {
      const visibility = s.visibility ?? (SCENE_VIS & ~GPUShaderStage.VERTEX);
      switch (s.kind) {
        case 'ubo': return { binding: s.binding, visibility, buffer: { type: 'uniform', hasDynamicOffset: s.dynamic ?? false } };
        case 'ssbo': return { binding: s.binding, visibility, buffer: { type: 'read-only-storage' } };
        case 'ssbo-rw': return { binding: s.binding, visibility, buffer: { type: 'storage' } };
        case 'tex': return { binding: s.binding, visibility, texture: { sampleType: 'float' as const } };
        case 'depthTex': return { binding: s.binding, visibility, texture: { sampleType: 'depth' as const } };
        case 'sampler': return { binding: s.binding, visibility, sampler: { type: 'filtering' as const } };
        case 'cmpSampler': return { binding: s.binding, visibility, sampler: { type: 'comparison' as const } };
      }
    }),
  });

export interface RenderPassDesc {
  label: string;
  code: string;
  vs: string;
  fs?: string;
  /** Extra bind group layouts, in order, for groups 1..n. */
  groups: readonly GPUBindGroupLayout[];
  color: readonly GPUColorTargetState[];
  depth?: GPUDepthStencilState;
  vertexBuffers?: readonly GPUVertexBufferLayout[];
  cull?: GPUCullMode;
  topology?: GPUPrimitiveTopology;
}

export interface RenderPass {
  pipeline: GPURenderPipeline;
  layout: GPUPipelineLayout;
}

export const makeRenderPass = (device: GPUDevice, d: RenderPassDesc): RenderPass => {
  const module = device.createShaderModule({ label: `${d.label}:module`, code: d.code });
  const layout = device.createPipelineLayout({
    label: `${d.label}:layout`, bindGroupLayouts: d.groups,
  });
  return {
    layout,
    pipeline: device.createRenderPipeline({
      label: d.label,
      layout,
      vertex: { module, entryPoint: d.vs, buffers: d.vertexBuffers ?? [] },
      ...(d.fs ? { fragment: { module, entryPoint: d.fs, targets: [...d.color] } } : {}),
      ...(d.depth ? { depthStencil: d.depth } : {}),
      primitive: {
        topology: d.topology ?? 'triangle-list',
        cullMode: d.cull ?? 'back',
        frontFace: 'ccw',
      },
    }),
  };
};

export const makeComputePass = (
  device: GPUDevice, label: string, code: string, entry: string, groups: readonly GPUBindGroupLayout[],
): { pipeline: GPUComputePipeline; layout: GPUPipelineLayout } => {
  const module = device.createShaderModule({ label: `${label}:module`, code });
  const layout = device.createPipelineLayout({ label: `${label}:layout`, bindGroupLayouts: groups });
  return {
    layout,
    pipeline: device.createComputePipeline({ label, layout, compute: { module, entryPoint: entry } }),
  };
};

/** Fullscreen triangle. No vertex buffer, generated from vertex_index. */
export const FULLSCREEN_VS = /* wgsl */ `
struct VSOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: VSOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f((p[vi].x + 1.0) * 0.5, 1.0 - (p[vi].y + 1.0) * 0.5);
  return o;
}`;

/** A mesh on the GPU. One vertex buffer + one index buffer. */
export interface GpuMesh {
  vbo: GPUBuffer;
  ibo: GPUBuffer;
  indexCount: number;
  /** Instance buffer holding mat4 + tint + params. */
  ib: GPUBuffer;
  instanceCount: number;
  indexFormat: GPUIndexFormat;
  boundsMin: [number, number, number];
  boundsMax: [number, number, number];
}

export function uploadMesh(
  ctx: GPUContext, label: string, data: {
    positions: Float32Array; normals: Float32Array; uvs: Float32Array;
    /** 4 floats per vertex: linear rgb + emissive mask. */
    colors: Float32Array; indices: Uint32Array;
    boundsMin: readonly number[]; boundsMax: readonly number[]; packed?: Float32Array;
  },
): GpuMesh {
  const dev = ctx.device;
  const inter = (data.packed ?? interleaveMesh(data)) as Float32Array<ArrayBuffer>;
  const vbo = dev.createBuffer({
    label: `${label}:vbo`, size: inter.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(vbo, 0, inter);
  const ibo = dev.createBuffer({
    label: `${label}:ibo`, size: Math.max(4, data.indices.byteLength), usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  dev.queue.writeBuffer(ibo, 0, data.indices as unknown as BufferSource);
  return {
    vbo, ibo,
    indexCount: data.indices.length,
    ib: dev.createBuffer({ label: `${label}:inst`, size: 256, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }),
    instanceCount: 0,
    indexFormat: 'uint32',
    boundsMin: [data.boundsMin[0], data.boundsMin[1], data.boundsMin[2]],
    boundsMax: [data.boundsMax[0], data.boundsMax[1], data.boundsMax[2]],
  };
}

export const MESH_STRIDE = 12 * 4;

/** Vertex layout matching `uploadMesh`'s interleaving. */
export const meshVertexLayout = (): GPUVertexBufferLayout => ({
  arrayStride: MESH_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },   // position
    { shaderLocation: 1, offset: 12, format: 'float32x3' },  // normal
    { shaderLocation: 2, offset: 24, format: 'float32x2' },  // uv
    { shaderLocation: 3, offset: 32, format: 'float32x3' },  // color
    { shaderLocation: 4, offset: 44, format: 'float32' },    // emissive
  ],
});

/** mat4 model (4× vec4 @0) + tint(vec4 @64) + params(vec4 @80) = 96 bytes. */
export const INSTANCE_STRIDE = 96;
/** Floats per instance record. */
export const INSTANCE_FLOATS = INSTANCE_STRIDE / 4;
export const instanceVertexLayout = (): GPUVertexBufferLayout => ({
  arrayStride: INSTANCE_STRIDE,
  stepMode: 'instance',
  attributes: [
    { shaderLocation: 5, offset: 0, format: 'float32x4' },
    { shaderLocation: 6, offset: 16, format: 'float32x4' },
    { shaderLocation: 7, offset: 32, format: 'float32x4' },
    { shaderLocation: 8, offset: 48, format: 'float32x4' },
    { shaderLocation: 9, offset: 64, format: 'float32x4' },  // tint
    { shaderLocation: 10, offset: 80, format: 'float32x4' }, // params
  ],
});

export function destroyMesh(m: GpuMesh | null): void {
  if (!m) return;
  m.vbo.destroy(); m.ibo.destroy(); m.ib.destroy();
}

/** A 1x1 white texture for bind slots that a pass does not actually read. */
export const whiteTexture = (ctx: GPUContext): GPUTexture =>
  ctx.makeTexture('white', 1, 1, 'rgba8unorm',
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);

/** A 1x1 black float texture — the safe default for unwritten HDR targets. */
export const blackTexture = (ctx: GPUContext): GPUTexture =>
  ctx.makeTexture('black', 1, 1, 'rgba16float',
    GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST);

export function fillTexture(
  ctx: GPUContext, tex: GPUTexture, data: ArrayBufferView, bytesPerRow?: number,
): void {
  const src = data as unknown as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
  ctx.device.queue.writeTexture(
    { texture: tex },
    src.buffer, { offset: src.byteOffset, bytesPerRow: bytesPerRow ?? src.byteLength },
    { width: tex.width, height: tex.height, depthOrArrayLayers: 1 },
  );
}

/** Camera matrices for an arbitrary view. Used by the shadow cascades. */
export const viewProjFrom = (view: Float32Array, proj: Float32Array, out = m4()) =>
  m4mul(out, proj, view);

export const invert = (m: Float32Array, out = m4()) => m4invert(out, m);
export { m4, m4identity };

/** Round up to a multiple of `a` (used for buffer/texture size alignment). */
export const align = (x: number, a: number) => Math.ceil(x / a) * a;

/**
 * Clear a target without drawing anything. Used to seed the shadow cascades at
 * "fully lit" (reverse-Z far = 1.0) so an un-rendered cascade returns shadow
 * = 1 rather than sampling garbage.
 */
export function seedTexture(
  ctx: GPUContext, tex: GPUTexture, isDepth: boolean, value: number,
): void {
  const enc = ctx.device.createCommandEncoder({ label: 'seed-texture' });
  const view = tex.createView();
  const pass = enc.beginRenderPass(
    isDepth
      ? {
        colorAttachments: [],
        depthStencilAttachment: {
          view, depthClearValue: value, depthLoadOp: 'clear', depthStoreOp: 'store',
        },
      }
      : {
        colorAttachments: [{
          view, clearValue: { r: value, g: value, b: value, a: value },
          loadOp: 'clear', storeOp: 'store',
        }],
      },
  );
  pass.end();
  ctx.device.queue.submit([enc.finish()]);
}
