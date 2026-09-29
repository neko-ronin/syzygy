// ============================================================================
//  shadow.wgsl — depth-only pass, one cascade per draw.
//
//  The view matrix comes from group(2) so the same pipeline can serve all four
//  cascades; the fragment stage is a no-op and the depth attachment does the
//  work. A small normal-offset is applied in the vertex stage, which removes
//  virtually all of the shadow acne on the near-vertical canyon facades that
//  dominate this scene.
// ============================================================================

struct ShadowParams {
  lightViewProj : mat4x4f,
  texelWorld    : vec4f,   // xyz = texel size in world units, w = depth range
  bias         : vec4f,   // x = constant, y = slope, z = normalOffset, w = unused
};

@group(2) @binding(0) var<uniform> SP: ShadowParams;

struct VSIn {
  @location(0)  position : vec3f,
  @location(1)  normal   : vec3f,
  @location(2)  uv       : vec2f,
  @location(3)  color    : vec3f,
  @location(4)  emissive : f32,
  @location(5) m0 : vec4f,
  @location(6) m1 : vec4f,
  @location(7) m2 : vec4f,
  @location(8) m3 : vec4f,
  @location(9) tint : vec4f,
  @location(10) params: vec4f,
};

@vertex
fn vs(v: VSIn) -> @builtin(position) vec4f {
  let m = mat4x4f(v.m0, v.m1, v.m2, v.m3);
  let wp = m * vec4f(v.position, 1.0);

  // Normal offset: slide the vertex along its normal by a fraction of the
  // cascade's world texel size. Scales with cascade so the far ones, which
  // cover far more ground per texel, get a correspondingly bigger push.
  let wn = normalize((m * vec4f(v.normal, 0.0)).xyz);
  let push = wp.xyz + wn * SP.bias.z * (1.0 + length(SP.texelWorld.xyz) * 0.02);

  return SP.lightViewProj * vec4f(push, 1.0);
}

@fragment
fn fs() { }
