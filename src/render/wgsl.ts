/**
 * Assembles WGSL modules. WebGPU has no preprocessor, so the shared library is
 * prepended textually. Keeping the include list in one place means a shader
 * author never has to think about declaration order.
 */

import common from '../shaders/common.wgsl?raw';
import gbuffer from '../shaders/gbuffer.wgsl?raw';
import lighting from '../shaders/lighting.wgsl?raw';
import shadow from '../shaders/shadow.wgsl?raw';
import post from '../shaders/post.wgsl?raw';
import lightbin from '../shaders/lightbin.wgsl?raw';

/**
 * `common` declares group(0) binding(0) and group(1) bindings 0/1 (the shadow
 * map + comparison sampler). Every lighting-side module therefore starts with
 * it, and per-pass bindings continue from binding(2).
 */
export const SHADOW_TEX_BINDING = 0;
export const SHADOW_SAMP_BINDING = 1;

export const modules = {
  common,
  gbuffer: `${common}\n${gbuffer}`,
  lighting: `${common}\n${lighting}`,
  shadow: `${common}\n${shadow}`,
  post: `${common}\n${post}`,
  lightbin: `${common}\n${lightbin}`,
} as const;

export type ModuleName = keyof typeof modules;
