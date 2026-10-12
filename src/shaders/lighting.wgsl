// ============================================================================
//  lighting.wgsl — deferred shading, then atmosphere in the same pass.
//
//  Direct sun through the cascade shadow map, analytic sky IBL, a floor-bounce
//  term tuned for a sunlit canyon, clustered local lights, and finally the fog
//  that turns all of it into depth.
// ============================================================================

@group(1) @binding(2) var gAlbedo : texture_2d<f32>;
@group(1) @binding(3) var gNormal : texture_2d<f32>;
@group(1) @binding(4) var gEmis   : texture_2d<f32>;
@group(1) @binding(5) var gDepth  : texture_depth_2d;
@group(1) @binding(6) var linSamp : sampler;

const MAT_DIFFUSE : u32 = 0u;
const MAT_GLASS   : u32 = 1u;
const MAT_FOLIAGE : u32 = 2u;
const MAT_METAL   : u32 = 3u;
const MAT_WATER   : u32 = 4u;
const MAT_EMISSIVE: u32 = 5u;

// ---------------------------------------------------------------- lights

/** Ground pools (see the light loop): strength, and the highest a lamp may hang and still lay one. */
const POOL_GAIN: f32 = 0.4;
const POOL_MAX_DROP: f32 = 9.0;

struct Light {
  posRadius : vec4f,   // xyz, w = radius
  colorInt  : vec4f,   // rgb, w = intensity
};

/**
 * Must be the SAME struct `lightbin.wgsl` writes.
 *
 * It was not. The binner declared `array<Bin>` — 96 light indices then a count,
 * 400 bytes — and this declared `array<TileLight>` with `offset`/`count` and a
 * 16-byte stride. Both bound the same buffer, so the two agreed on the address
 * and disagreed about everything else:
 *
 *   - `offset` read floats 0..3, which is `lights[0]` — a *light index*, used
 *     here as a base offset into the global light array. Whenever the tile's
 *     first surviving light was not light 0 of the city, `base` pointed
 *     somewhere arbitrary and the loop read the wrong lights.
 *   - `count` read floats 4..7, which is `lights[1]` — the *second light index*,
 *     used as the number of lights to iterate. So the loop count was a light
 *     index, typically a large number, capped at 96.
 *
 * The result read plausible light data from plausible offsets and lit almost
 * nothing, because `base` was wrong. `probe('tiles')` reports `count` from the
 * real location, which is why the measured `maxPerTile 268` and `meanCount
 * 17.36` were true while the frame stayed dark: the bins were full and the
 * reader was looking at the wrong words.
 *
 * Declaring one struct and importing it from both sides is the fix that cannot
 * drift again. `lightbin.wgsl` owns it.
 */
struct Bin {
  lights : array<u32, 96>,
  count  : u32,
  _pad   : array<u32, 3>,
};

@group(1) @binding(7) var<storage, read> tileLights : array<Bin>;
@group(1) @binding(8) var<storage, read> lights     : array<Light>;
@group(1) @binding(9) var skyLutTex : texture_2d<f32>;
@group(1) @binding(10) var skyLutSamp : sampler;

/**
 * The cloudy sky, rendered once per frame at 512x256 (fsSkyLut) and sampled for
 * fog colour and reflections. Evaluating the cloud fbm per pixel for those was
 * measured at 5.5 ms of a 9 ms lighting pass; directly visible sky stays exact.
 */
fn skyLut(dir: vec3f) -> vec3f {
  return textureSampleLevel(skyLutTex, skyLutSamp, skyLutUv(dir), 0.0).rgb;
}

@fragment
fn fsSkyLut(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  return vec4f(skyWithClouds(skyLutDir(frag.xy / SKY_LUT_SIZE), F.time.w), 1.0);
}

// ---------------------------------------------------------------- IBL

/**
 * Analytic environment. Instead of a probe atlas, sample the same procedural
 * sky the fog uses, so reflections, ambient and fog are guaranteed to agree —
 * which is the whole trick behind making an outdoor scene feel coherent.
 *
 * A cosine-lobe approximation using a small SH-like fit keeps it to a handful
 * of instructions.
 */
fn skyIrradiance(n: vec3f) -> vec3f {
  let up = n.y * 0.5 + 0.5;
  let zen = F.ambient.rgb * 1.15;
  let hor = F.ambient.rgb * 0.55 + F.sunColor.rgb * 0.10 * F.sunDir.w;
  let gnd = F.bounce.rgb * 0.55;
  var c = mix(gnd, hor, smoothstep(0.0, 0.5, up));
  c = mix(c, zen, smoothstep(0.35, 1.0, up));
  // Warm wash from the sun's side of the sky.
  c += F.sunColor.rgb * max(dot(n, F.sunDir.xyz), 0.0) * 0.16 * F.sunDir.w;
  return c * F.ambient.w;
}

fn skyRadianceSpec(r: vec3f, rough: f32) -> vec3f {
  // Blend between the sharp sky and a broad ambient as roughness rises.
  let broad = F.ambient.rgb * F.ambient.w * 1.25;
  let t = smoothstep(0.05, 0.65, rough);
  // At t = 1 the sharp sky has zero weight. It is five cloud evaluations, and
  // most surfaces (paving, kerbs, facades) sit at 0.68-0.88 roughness: skipping
  // it is exact and was most of the lighting pass.
  if (t >= 1.0) { return broad; }
  return mix(skyWithClocks(r, rough), broad, t);
}

fn skyWithClocks(r: vec3f, rough: f32) -> vec3f {
  // Roughness widens the reflection: sample progressively flatter directions
  // around the mirror vector. Four taps is enough once bloom is on top.
  let N = vec3f(0.0, 1.0, 0.0);
  let upRefl = reflect(r, N);
  var c = skyLut(normalize(mix(r, upRefl, 0.0)));
  if (rough > 0.10) {
    let w1 = normalize(r + vec3f(rough * 0.55, 0.0, 0.0));
    let w2 = normalize(r - vec3f(rough * 0.55, 0.0, 0.0));
    let w3 = normalize(r + vec3f(0.0, rough * 0.55, 0.0));
    let w4 = normalize(r - vec3f(0.0, rough * 0.55, 0.0));
    let blur = (skyLut(w1) + skyLut(w2) + skyLut(w3) + skyLut(w4)) * 0.25;
    c = mix(c, blur, smoothstep(0.10, 0.75, rough));
  }
  return c;
}

/** GGX direct lighting. */
fn brdf(
  N: vec3f, V: vec3f, L: vec3f, albedo: vec3f, rough: f32, metal: f32,
) -> vec3f {
  let H = normalize(V + L);
  let a = max(rough * rough, 0.002);
  let a2 = a * a;
  let NoL = max(dot(N, L), 0.0);
  let NoV = max(dot(N, V), 1e-4);
  let NoH = max(dot(N, H), 0.0);
  let VoH = max(dot(V, H), 0.0);

  let d = (NoH * NoH * (a2 - 1.0) + 1.0);
  let D = a2 / (PI * d * d);
  let k = a * 0.5;
  let G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  let F0 = mix(vec3f(0.04), albedo, metal);
  let F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);

  let spec = (D * G * F) / (4.0 * NoV * NoL + 1e-4);
  let kd = (1.0 - F) * (1.0 - metal);
  return (kd * albedo / PI + spec) * NoL;
}

/** Split-sum environment BRDF (Karis' analytic fit). */
fn envBRDF(f0: vec3f, rough: f32, NoV: f32) -> vec3f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022);
  let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = vec4f(1.0 - rough, 1.0 - rough, 1.0 - rough, 1.0 - rough) * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * NoV)) * r.x + r.y;
  let ab = vec2f(-1.04, 1.04) * a004 + r.zw;
  return f0 * ab.x + vec3f(ab.y);
}

// ---------------------------------------------------------------- main

/** Fullscreen triangle; the lighting pass has no vertex buffers. */
@vertex
fn vsFullscreen(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(p[vi], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  // Derive UV from the rasterised position: no varying, no interpolation.
  let uv = frag.xy * F.screen.zw;
  let depth = textureLoad(gDepth, vec2i(frag.xy), 0);

  let viewPos = F.view * vec4f(reconstructWorld(uv, depth), 1.0);
  let dist = length(viewPos.xyz);

  // Sky. The G-buffer clears to 0.0, and in reverse-Z 0.0 is the far plane —
  // so an untouched depth texel is exactly the sky.
  if (depth <= 1e-7) {
    let dir = normalize(reconstructWorld(uv, 0.0) - F.camPos.xyz);
    return vec4f(skyRadiance(dir), 1.0);
  }

  let p = vec2i(uv * F.screen.xy);
  let ar = textureLoad(gAlbedo, p, 0);
  let nr = textureLoad(gNormal, p, 0);
  let er = textureLoad(gEmis, p, 0);

  let albedo = ar.rgb;
  let rough = clamp(ar.a, 0.025, 1.0);
  // The G-buffer stores a full RGB normal, not an octahedral pair. Decoding it
  // as if it were packed produces garbage normals, and because the ambient
  // specular is an environment lookup, garbage normals read as an iridescent
  // rainbow across every surface in the scene.
  let N = normalize(nr.xyz);
  let metal = nr.a;
  let emissive = er.rgb;
  let matAo = er.a;

  let V = normalize(F.camPos.xyz - reconstructWorld(uv, depth));
  let P = reconstructWorld(uv, depth);
  let L = F.sunDir.xyz;
  let NoL = dot(N, L);

  var color = vec3f(0.0);

  // --- sun
  if (NoL > 0.0) {
    let sh = sunShadow(P, NoL);
    if (sh > 0.001) {
      color += brdf(N, V, L, albedo, rough, metal) * F.sunColor.rgb * F.sunDir.w * sh;
    }
  }

  // --- sky + ground bounce ambient
  let irr = skyIrradiance(N);
  let f0 = mix(vec3f(0.04), albedo, metal);
  let R = reflect(-V, N);
  let spec = skyRadianceSpec(R, rough) * envBRDF(f0, rough, max(dot(N, V), 0.0));
  let diff = irr * albedo * (1.0 - metal);
  // Rough surfaces lose most of the specular; metals keep it all.
  color += (diff * (1.0 - rough * 0.55) + spec) * matAo;

  // --- clustered local lights
  // 16x16 screen tiles, matching lightbin.wgsl.
  let tiles = (vec2u(F.screen.xy) + 15u) / 16u;
  let tile = min(vec2u(p) / 16u, tiles - 1u);
  let tl = tileLights[tile.y * tiles.x + tile.x];
  // The bin stores absolute light indices in `lights[]`, so there is no base to
  // add — `base` was reading `tl.lights[0]` and treating it as one.
  let cnt = min(tl.count, 96u);
  let pools = lightsOn();
  for (var i = 0u; i < cnt; i++) {
    let li = lights[tl.lights[i]];
    let dv = li.posRadius.xyz - P;
    let d2 = dot(dv, dv);
    let r = li.posRadius.w;
    if (d2 > r * r) { continue; }
    let dist2 = sqrt(max(d2, 1e-6));
    let Lp = dv / dist2;
    // Inverse-square with a smooth window so lights end cleanly at the radius.
    let win = pow(clamp(1.0 - d2 / (r * r), 0.0, 1.0), 2.0);
    let atten = win / (1.0 + d2 * 0.05);
    color += brdf(N, V, Lp, albedo, rough, metal) * li.colorInt.rgb * li.colorInt.w * atten;

    // Stylised warm pool (owner direction, 2026-10-12). A street-level lamp lays a
    // soft disc of its light on the surface beneath it, sized by its height above
    // that surface. Painterly, not physical: no inverse square and no N.L, which is
    // what made a physical pool 15 m ahead a sliver at eye height and the aisle an
    // even wash (R14 review, LEGIBILITY §4). It multiplies albedo, so paving joints
    // stay visible inside it. Night only.
    let drop = dv.y;
    if (pools > 0.0 && N.y > 0.6 && drop > 0.4 && drop < POOL_MAX_DROP) {
      let poolR = clamp(drop * 0.95, 1.4, 4.8);
      let disc = 1.0 - smoothstep(poolR * 0.3, poolR, length(dv.xz));
      color += albedo * li.colorInt.rgb * li.colorInt.w * disc * POOL_GAIN * pools;
    }
  }

  color += emissive;

  // --- fog last, so it occludes everything uniformly
  let Vdir = -V;
  color = applyFog(color, P, Vdir, dist, skyLut(Vdir) + sunDisc(Vdir));

  return vec4f(color, 1.0);
}
