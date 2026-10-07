// ============================================================================
//  common.wgsl — the shared substrate. Prepended to every shader module by
//  `render/wgsl.ts`, so there is exactly one definition of the frame uniform,
//  the sky model, and the noise basis.
// ============================================================================

struct Frame {
  viewProj      : mat4x4f,
  view          : mat4x4f,
  invViewProj   : mat4x4f,
  prevViewProj  : mat4x4f,
  sunViewProj   : mat4x4f,   // cascade 0; cascades 1..3 follow at 320/384/448
  shadow0       : mat4x4f,
  shadow1       : mat4x4f,
  shadow2       : mat4x4f,
  shadow3       : mat4x4f,

  camPos        : vec4f,   // xyz, w = near
  sunDir        : vec4f,   // xyz (toward sun), w = intensity
  sunColor      : vec4f,   // rgb, w = dayPhase 0..1
  ambient       : vec4f,   // rgb, w = ambientIntensity
  bounce        : vec4f,   // rgb, w = bounceIntensity

  weather       : vec4f,   // haze, hazeFalloff, cloudCover, aerialHaze
  weather2      : vec4f,   // wetness, godRays, windSpeed, motes
  weather3      : vec4f,   // windDir, storminess, scatter, precipId
  weather4      : vec4f,   // bloomStrength, saturation, grain, exposure

  screen        : vec4f,   // w, h, 1/w, 1/h
  time          : vec4f,   // t, dt, frame, quality
  lens          : vec4f,   // fov, roll, warp, speedFov
  lens2         : vec4f,   // tiltShift, focusCenter, focusWidth, bokeh
  lens3         : vec4f,   // distortion, chroma, vignette, horizonBend
  grade         : vec4f,   // rgb tint, w = unused

  csm           : vec4f,   // cascadeCount, texelSize, depthBias, farDist
  csmSplits     : vec4f,   // 4 far distances
  misc          : vec4f,   // focusPlane, aerialScale, cloudTime, snowLevel
  fogColor      : vec4f,   // rgb, w = cloudBrightness
};

@group(0) @binding(0) var<uniform> F: Frame;

// ---------------------------------------------------------------- constants

const PI      : f32 = 3.14159265359;
const TAU     : f32 = 6.28318530718;
const INV_PI  : f32 = 0.31830988618;

// ---------------------------------------------------------------- hashing

fn hash11(p: f32) -> f32 { return fract(sin(p * 127.1) * 43758.5453); }
fn hash21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn hash22(p: vec2f) -> vec2f {
  let q = vec2f(dot(p, vec2f(127.1, 311.7)), dot(p, vec2f(269.5, 183.3)));
  return fract(sin(q) * 43758.5453);
}
fn hash31(p: vec3f) -> f32 { return fract(sin(dot(p, vec3f(127.1, 311.7, 74.7))) * 43758.5453); }
fn hash33(p: vec3f) -> vec3f {
  let q = vec3f(dot(p, vec3f(127.1, 311.7, 74.7)),
                dot(p, vec3f(269.5, 183.3, 246.1)),
                dot(p, vec3f(113.5, 271.9, 124.6)));
  return fract(sin(q) * 43758.5453);
}

/** Value noise — smooth, cheap, and the workhorse for procedural detail. */
fn vnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash31(i);
  let n100 = hash31(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3f(1.0, 1.0, 1.0));
  let x00 = mix(n000, n100, u.x);
  let x10 = mix(n010, n110, u.x);
  let x01 = mix(n001, n101, u.x);
  let x11 = mix(n011, n111, u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z);
}
fn fbm2(p0: vec2f, oct: i32) -> f32 {
  var s = 0.0; var a = 0.5; var p = p0;
  for (var i = 0; i < oct; i++) { s += a * vnoise2(p); p *= 2.03; a *= 0.5; }
  return s;
}
fn fbm3(p0: vec3f, oct: i32) -> f32 {
  var s = 0.0; var a = 0.5; var p = p0;
  for (var i = 0; i < oct; i++) { s += a * vnoise3(p); p *= 2.02; a *= 0.5; }
  return s;
}
/** Cellular F1. Returns distance to the nearest feature point. */
fn worley2(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p);
  var d = 8.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let o = hash22(i + g);
      d = min(d, length(g + o - f));
    }
  }
  return d;
}

// ---------------------------------------------------------------- colour

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

/** AgX-ish filmic curve. Keeps the saturated sky from turning to paper. */
fn tonemap(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(1e-5)), vec3f(1.0 / 2.4)) - 0.055;
  return select(hi, lo, c <= vec3f(0.0031308));
}
fn srgbToLinear(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

// ---------------------------------------------------------------- sky

/**
 * Analytic sky. A two-lobe Rayleigh/Mie approximation driven by sun elevation,
 * then clouds composited as a domain-warped fbm shell.
 *
 * This is intentionally *not* a Preetham/Hosek fit. Those look great for a
 * single sun and go wrong the moment cloud cover or storminess change, which
 * is exactly the axis the LLM conductor pulls on. This one is cheap, stable
 * across the whole parameter space, and it lets the weather system art-direct
 * the horizon colour directly.
 */
fn skyGradient(dir: vec3f) -> vec3f {
  let up = clamp(dir.y, -1.0, 1.0);
  let sunAmt = clamp(dot(normalize(dir), F.sunDir.xyz), -1.0, 1.0);
  let elev = F.sunDir.y;

  // Day → dusk → night ramps.
  let dayK    = smoothstep(-0.05, 0.28, elev);
  let duskK   = smoothstep(-0.22, 0.10, elev) * (1.0 - smoothstep(0.05, 0.42, elev));
  let nightK  = 1.0 - smoothstep(-0.30, -0.02, elev);

  let zenithDay   = vec3f(0.075, 0.195, 0.44);
  let horizonDay  = vec3f(0.46, 0.60, 0.78);
  let zenithDusk  = vec3f(0.048, 0.072, 0.185);
  let horizonDusk = vec3f(0.62, 0.33, 0.24);
  let zenithNight = vec3f(0.005, 0.009, 0.026);
  let horizonNight= vec3f(0.024, 0.034, 0.068);

  let zen = mix(mix(zenithDusk, zenithDay, dayK), zenithNight, nightK);
  let hor = mix(mix(horizonDusk, horizonDay, dayK), horizonNight, nightK);

  // Gradient biased so the interesting band sits just above the skyline. A
  // higher exponent than the "physically correct" 1-2 keeps the warm band tight
  // to the horizon instead of letting it flood the whole upper frame.
  let g = pow(1.0 - max(up, 0.0), 5.0);
  var col = mix(zen, hor, g);

  // Mie forward-scatter: the bright halo around the sun, and a broad warm
  // wash along the horizon in the sun's direction.
  let m = pow(max(sunAmt, 0.0), 10.0);
  col += F.sunColor.rgb * m * 0.40 * (0.4 + dayK);
  let horizonGlow = pow(max(sunAmt, 0.0), 3.5) * pow(1.0 - max(up, 0.0), 4.0);
  col += F.sunColor.rgb * horizonGlow * 0.18 * (0.25 + duskK * 1.1);

  // Ground haze below the horizon: the city is never visible past the floor.
  // Damped hard, or a top-down view fills with sky instead of street.
  let below = smoothstep(0.0, -0.22, up);
  col = mix(col, mix(col, hor, 0.55) * 0.70, below);

  return col * (0.35 + 0.65 * dayK + 0.06 * nightK);
}

/** Cloud shell. Two layers of warped fbm, lit by a cheap forward-scatter term. */
fn cloudLayer(dir: vec3f, coverage: f32, alt: f32, t: f32) -> vec4f {
  if (dir.y < 0.008) { return vec4f(0.0); }
  // Project onto a plane at `alt` so clouds converge at the horizon.
  let t2 = alt / dir.y;
  if (t2 > 90000.0) { return vec4f(0.0); }
  let p = dir.xz * t2 * 0.00035 + vec2f(t * 0.0032, t * 0.0019);
  let q = vec2f(fbm2(p * 1.7 + vec2f(11.3, 4.1), 4),
                fbm2(p * 1.7 + vec2f(2.7, 19.4), 4));
  var d = fbm2(p + (q - 0.5) * 0.85, 5);
  d = smoothstep(1.0 - coverage, 1.0 - coverage * 0.55 + 0.12, d);
  // Fade the layer out toward the horizon and at the zenith limit.
  let horizonFade = smoothstep(0.008, 0.10, dir.y) * (1.0 - smoothstep(0.55, 1.0, dir.y) * 0.35);
  d *= horizonFade;
  return vec4f(vec3f(d), d);
}

fn skyWithClouds(dir: vec3f, quality: f32) -> vec3f {
  var col = skyGradient(dir);
  let cov = F.weather.z;
  if (cov > 0.005) {
    let oct = select(3, 5, quality > 0.5);
    let hi = cloudLayer(dir, cov * 0.82, 1800.0, F.misc.z);
    let lo = cloudLayer(dir, cov, 900.0, F.misc.z * 1.4);
    // Light the cloud: bright rim toward the sun, dark base away from it.
    let sunAmt = clamp(dot(dir, F.sunDir.xyz), -1.0, 1.0);
    let rim = pow(max(sunAmt, 0.0), 3.0);
    let lightC = F.sunColor.rgb * (0.55 + rim * 1.5) * F.sunDir.w;
    let shadeC = F.ambient.rgb * 0.55 + F.bounce.rgb * 0.35;
    let ci = mix(shadeC, lightC, 0.35 + rim * 0.5);
    col = mix(col, ci, clamp(hi.a * 0.6, 0.0, 1.0));
    col = mix(col, ci * 0.86, clamp(lo.a * 0.9, 0.0, 1.0));
  }
  return col;
}

/** Sun disc, drawn additively when the camera looks at it. */
fn sunDisc(dir: vec3f) -> vec3f {
  let d = dot(dir, F.sunDir.xyz);
  let ang = acos(clamp(d, -1.0, 1.0));
  let r = 0.0092;
  let core = 1.0 - smoothstep(r * 0.6, r, ang);
  let glow = pow(max(1.0 - ang / (r * 26.0), 0.0), 2.4);
  let through = smoothstep(-0.06, 0.10, F.sunDir.y);
  return F.sunColor.rgb * F.sunDir.w * (core * 55.0 + glow * 5.0) * through;
}

/** Equirect sky-LUT mapping, shared by the LUT pass and its readers. */
const SKY_LUT_SIZE : vec2f = vec2f(512.0, 256.0);
fn skyLutUv(dir: vec3f) -> vec2f {
  return vec2f(atan2(dir.z, dir.x) * (0.5 / PI) + 0.5, acos(clamp(dir.y, -1.0, 1.0)) / PI);
}
fn skyLutDir(uv: vec2f) -> vec3f {
  let phi = (uv.x - 0.5) * 2.0 * PI;
  let th = uv.y * PI;
  return vec3f(sin(th) * cos(phi), cos(th), sin(th) * sin(phi));
}

fn skyRadiance(dir: vec3f) -> vec3f {
  return skyWithClouds(dir, F.time.w) + sunDisc(dir);
}

// ---------------------------------------------------------------- fog

/**
 * Height-weighted distance fog.
 *
 * The important property here is *boundedness*. An earlier version used the
 * textbook analytic integral of a pure `exp(-k*y)` density, which is correct and
 * completely unusable: at a kilometre of ray length through a canyon it reaches
 * ~9 optical depth, i.e. 99.98% opaque, so every frame is a flat wash of fog
 * colour. Fog has to be something the conductor can dial between "clear" and
 * "you cannot see the next block" without either end being degenerate.
 *
 * So: optical depth is `haze * (dist / FOG_SCALE)`, modulated by a height
 * weight evaluated at the *lowest* point of the ray. That is bounded by
 * construction, still pools in the canyon (which is the entire point — it is
 * what separates near from far and sells the verticality), and `haze` maps
 * 0..1 to a legible 0..~3 optical depth at a kilometre.
 */
const FOG_SCALE : f32 = 900.0;

/** `sky` is the sky radiance along `viewDir`; the caller chooses exact or LUT. */
fn applyFog(color: vec3f, worldPos: vec3f, viewDir: vec3f, dist: f32, sky: vec3f) -> vec3f {
  let density = F.weather.x;
  if (density < 0.0005) { return color; }
  let k = F.weather.y;
  let hRef = 12.0;

  // Fog is thickest where the ray runs lowest, so a ray that skims a rooftop
  // stays clear while one dropping into the street fills up.
  let lowest = min(F.camPos.y, worldPos.y);
  let heightWeight = clamp(exp(-k * (lowest - hRef)), 0.06, 1.0);
  // A floor term keeps high-altitude views from going perfectly crisp, which
  // would break the aerial perspective that makes the skyline read as far away.
  let weight = mix(0.34, 1.0, heightWeight);

  let optical = density * (dist / FOG_SCALE) * weight;
  let trans = exp(-optical);

  // Fog colour is the sky in the view direction, so fog and sky always agree.
  // Without this the horizon develops a hard seam.
  let fogCol = sky * 0.88 + F.fogColor.rgb * 0.18;
  var c = mix(color, fogCol, 1.0 - trans);

  // Aerial perspective: a second, flatter, longer-range term that desaturates
  // and lifts distant geometry toward the sky colour.
  let aerial = 1.0 - exp(-dist * F.weather.w * 0.00085);
  c = mix(c, mix(c, fogCol, 0.75), aerial);
  return c;
}

// ---------------------------------------------------------------- shadows

/**
 * Shadow matrices are stored packed 4x4 in the frame block: shadow0 at float
 * 64, then 16 floats each.
 */
fn shadowMatrix(i: i32) -> mat4x4f {
  switch i {
    case 0: { return F.shadow0; }
    case 1: { return F.shadow1; }
    case 2: { return F.shadow2; }
    default: { return F.shadow3; }
  }
}

fn sampleCascadeShadow(
  i: i32, worldPos: vec3f, nDotL: f32, texel: f32, depthBias: f32,
) -> f32 {
  let m = shadowMatrix(i);
  let lp = m * vec4f(worldPos, 1.0);
  if (lp.w <= 0.0) { return 1.0; }
  let proj = lp.xyz / lp.w;
  if (proj.z <= 0.0) { return 1.0; }
  let uv = vec2f(proj.x * 0.5 + 0.5, 0.5 - proj.y * 0.5);
  if (uv.x < 0.002 || uv.x > 0.998 || uv.y < 0.002 || uv.y > 0.998) { return 1.0; }

  // The shadow map is stored in conventional depth (near = 0, far = 1) even
  // though the main camera is reverse-Z. Converting here rather than flipping
  // the comparison mode keeps the shadow pass on the well-tested `less`
  // convention, and is one subtraction instead of four sign changes.
  let z = 1.0 - proj.z;
  // Slope-scaled bias, applied in conventional space so more bias is needed
  // at grazing angles.
  let slope = clamp(1.0 - nDotL, 0.0, 1.0);
  let zBiased = z - depthBias * (1.0 + slope * 3.0);

  var sum = 0.0;
  let o = texel;
  // 5-tap rotated cross — cheap PCF that survives the thin geometry.
  sum += textureSampleCompareLevel(shadowTex, shadowSamp, uv, zBiased);
  sum += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f( o,  o * 0.5), zBiased);
  sum += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f(-o,  o * 0.5), zBiased);
  sum += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f( o * 0.5, -o), zBiased);
  sum += textureSampleCompareLevel(shadowTex, shadowSamp, uv + vec2f(-o * 0.5, -o), zBiased);
  return sum * 0.2;
}

@group(1) @binding(0) var shadowTex: texture_depth_2d;
@group(1) @binding(1) var shadowSamp: sampler_comparison;

/** Full CSM lookup, choosing the cascade from view depth. */
fn sunShadow(worldPos: vec3f, nDotL: f32) -> f32 {
  let viewPos = F.view * vec4f(worldPos, 1.0);
  let viewZ = -viewPos.z;
  let s = F.csmSplits;
  var idx = 0;
  if (viewZ > s.x) { idx = 1; }
  if (viewZ > s.y) { idx = 2; }
  if (viewZ > s.z) { idx = 3; }
  if (viewZ > s.w) { return 1.0; }
  // Blend the last two so the cascade boundary is invisible.
  var sh = sampleCascadeShadow(idx, worldPos, nDotL, F.csm.y, F.csm.z);
  if (idx == 3) {
    sh = mix(sh, sampleCascadeShadow(2, worldPos, nDotL, F.csm.y, F.csm.z), 0.5);
  }
  return sh;
}

// ---------------------------------------------------------------- misc

fn reconstructWorld(uv: vec2f, depth: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let w = F.invViewProj * ndc;
  return w.xyz / w.w;
}

/**
 * Octahedral normal packing: 2 channels, ±1, ~0.1° error. Plenty for G-buffers.
 * Currently unused — the G-buffer stores a full rgb normal in an rgba16float
 * target, which is both cheaper and exact. Kept for a future depth+normal
 * packed attachment.
 */
fn octEncode(nIn: vec3f) -> vec2f {
  let n = nIn / (abs(nIn.x) + abs(nIn.y) + abs(nIn.z) + 1e-8);
  var e = n.xy;
  if (n.z < 0.0) {
    e = (1.0 - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), n.xy >= vec2f(0.0));
  }
  return e;
}
fn octDecode(e: vec2f) -> vec3f {
  var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) {
    let xy = n.xy;
    n = vec3f((1.0 - abs(n.yx)) * select(vec2f(-1.0), vec2f(1.0), xy >= vec2f(0.0)), n.z);
  }
  return normalize(n);
}
