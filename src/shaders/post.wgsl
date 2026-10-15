// ============================================================================
//  post.wgsl — the lens. Everything here is about making the render feel
//  photographed rather than rendered: temporal resolve, tilt-shift miniature,
//  barrel distortion, halation, chromatic aberration, and a filmic grade.
//
//  Order matters and is deliberate:
//    TAA → exposure → bloom add → DOF/tilt-shift → distort → CA → grade
//  Distortion is applied *after* the defocus so the blur follows the bent
//  image, which is what makes the miniature read as an optical effect on a
//  real lens rather than a post filter.
// ============================================================================

@group(1) @binding(2) var srcTex  : texture_2d<f32>;
@group(1) @binding(3) var bloomTex: texture_2d<f32>;
@group(1) @binding(4) var dofTex  : texture_2d<f32>;
@group(1) @binding(5) var histTex : texture_2d<f32>;
@group(1) @binding(6) var linSamp : sampler;
@group(1) @binding(7) var prevTex : texture_2d<f32>;

// ---------------------------------------------------------------- helpers

/**
 * Vertex stage for every pass in this file: one oversized triangle, with the
 * screen UV carried through as a varying. Deriving UV from NDC (rather than
 * from the fragment's pixel position) keeps it correct on half-res targets.
 */
struct PostOut {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
};

@vertex
fn fsFull(@builtin(vertex_index) vi: u32) -> PostOut {
  var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var o: PostOut;
  o.pos = vec4f(p[vi], 0.0, 1.0);
  o.uv = vec2f((p[vi].x + 1.0) * 0.5, 1.0 - (p[vi].y + 1.0) * 0.5);
  return o;
}


@group(1) @binding(8) var depthTex : texture_depth_2d;

/** Camera-basis distortion applied to a centred, aspect-corrected uv. */
fn warpLens(uvIn: vec2f, wobble: f32) -> vec2f {
  var uv = uvIn;
  let c = uv - 0.5;
  let aspect = F.screen.x / F.screen.y;
  let ca = vec2f(c.x * aspect, c.y);
  let r2 = dot(ca, ca);

  // 1. Radial barrel/pincushion.
  let k1 = F.lens3.x;
  let radial = 1.0 + k1 * r2 + k1 * 0.35 * r2 * r2;
  var w = ca * radial;
  // 2. Horizon bend: a cosine warp that lifts the far plane. Reads as the
  //    curvature of a very wide lens, or a diorama.
  let bend = F.lens3.w;
  w.y += bend * (1.0 - cos(ca.y * 2.2)) * 0.06;
  // 3. Screen-space wobble: low-frequency, slowly drifting. The "impossible
  //    geometry" tell — subtle enough to feel, too strong to notice directly.
  let warp = F.lens.z * wobble;
  if (warp > 0.001) {
    let t = F.time.x;
    w.x += sin(ca.y * 5.3 + t * 0.31) * warp * 0.010;
    w.y += cos(ca.x * 4.1 - t * 0.24) * warp * 0.008;
  }
  uv = vec2f(w.x / aspect, w.y) + 0.5;
  return uv;
}

/**
 * Zoom that keeps the warped frame inside the source. Past [0,1] the
 * clamp-to-edge sampler repeats the outermost column, which shows up as
 * horizontal smears down the frame edges. Measured on the wobble-free warp at
 * the corners and edge midpoints, plus the wobble and CA amplitudes as fixed
 * margins, so the crop does not breathe with the wobble.
 */
fn lensCrop() -> f32 {
  var m = vec2f(0.5);
  for (var i = 0u; i < 9u; i++) {
    let p = vec2f(f32(i % 3u), f32(i / 3u)) * 0.5;
    m = max(m, abs(warpLens(p, 0.0) - 0.5));
  }
  let aspect = F.screen.x / F.screen.y;
  m += vec2f(F.lens.z * 0.010 / aspect, F.lens.z * 0.008) + F.lens3.y * 0.0011 * 0.5;
  return max(m.x, m.y) * 2.0;
}

/** Tilt-shift band: 1.0 in focus, 0.0 at the extremes. */
fn focusBand(uv: vec2f) -> f32 {
  let d = abs(uv.y - F.lens2.y);
  let w = max(F.lens2.z, 1e-3);
  return 1.0 - smoothstep(w * 0.45, w, d);
}

// ---------------------------------------------------------------- TAA

/** RGB <-> YCoCg. The TAA neighbourhood MUST be handled entirely in one space. */
fn rgbToYCoCg(c: vec3f) -> vec3f {
  return vec3f(
     0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
     0.5  * c.r              - 0.5  * c.b,
    -0.25 * c.r + 0.5 * c.g - 0.25 * c.b);
}
fn yCoCgToRgb(c: vec3f) -> vec3f {
  let t = c.x - c.z;
  return vec3f(t + c.y, c.x + c.z, t - c.y);
}

/**
 * Temporal antialiasing.
 *
 * The whole neighbourhood — min, max, mean, sigma, and the history clamp — is
 * computed in YCoCg and only converted back to RGB at the very end. Doing the
 * AABB in RGB while computing sigma in YCoCg looks harmless and is not: it
 * lets the clamp bounds cross zero per channel, which is how the resolve ends
 * up with negative green and blue and paints the whole frame red. That single
 * space mismatch was the source of the "rainbow on every surface" and the
 * "everything is smeared" artefacts.
 */
@fragment
fn taa(v: PostOut) -> @location(0) vec4f {
  let uv = v.uv;
  let size = vec2i(F.screen.xy);
  let p = clamp(vec2i(uv * F.screen.xy), vec2i(0), size - 1);

  // --- reprojection. A bad reprojection is worse than no history at all, so
  //     anything implausible discards the history instead of smearing.
  let world4 = F.invViewProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0);
  let world = world4.xyz / world4.w;
  let prevClip = F.prevViewProj * vec4f(world, 1.0);
  var motion = vec2f(0.0);
  var historyValid = prevClip.w > 1e-4;
  if (historyValid) {
    let prevNdc = prevClip.xy / prevClip.w;
    let prevUv = vec2f(prevNdc.x * 0.5 + 0.5, 0.5 - prevNdc.y * 0.5);
    motion = uv - prevUv;
    historyValid = prevUv.x > -0.5 && prevUv.x < 1.5
                && prevUv.y > -0.5 && prevUv.y < 1.5
                && abs(motion.x) < 0.25 && abs(motion.y) < 0.25;
  }

  // --- neighbourhood statistics, entirely in YCoCg.
  let centerY = rgbToYCoCg(textureLoad(srcTex, p, 0).rgb);
  var mn = centerY;
  var mx = centerY;
  var sum = centerY;
  var sumSq = centerY * centerY;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) { continue; }
      let q = clamp(p + vec2i(x, y), vec2i(0), size - 1);
      let c = rgbToYCoCg(textureLoad(srcTex, q, 0).rgb);
      mn = min(mn, c);
      mx = max(mx, c);
      sum += c;
      sumSq += c * c;
    }
  }
  let mean = sum / 9.0;
  let sigma = sqrt(max(sumSq / 9.0 - mean * mean, vec3f(0.0)));
  let lo = max(mn, mean - sigma * 1.25);
  let hi = min(mx, mean + sigma * 1.25);

  var outY = centerY;
  if (historyValid) {
    let histUV = uv - motion;
    if (histUV.x > 0.0 && histUV.x < 1.0 && histUV.y > 0.0 && histUV.y < 1.0) {
      let hist = clamp(rgbToYCoCg(textureSampleLevel(prevTex, linSamp, histUV, 0.0).rgb), lo, hi);
      // Bias toward the current frame; the neighbourhood already does the
      // antialiasing, the history only fills in what it did not sample.
      outY = mix(centerY, hist, 0.82);
      // Final safety clamp, still in YCoCg.
      outY = clamp(outY, lo, hi);
    }
  }

  return vec4f(max(yCoCgToRgb(outY), vec3f(0.0)), 1.0);
}

// ---------------------------------------------------------------- bloom

@fragment
fn bloomPrefilter(v: PostOut) -> @location(0) vec4f {
  let uv = v.uv;
  let c = textureSampleLevel(srcTex, linSamp, uv, 0.0).rgb;
  // Karis average over a 2x2 to stop fireflies from flickering into the bloom.
  let texel = F.screen.zw;
  var s = c;
  s += textureSampleLevel(srcTex, linSamp, uv + vec2f(-0.5, -0.5) * texel, 0.0).rgb;
  s += textureSampleLevel(srcTex, linSamp, uv + vec2f( 0.5, -0.5) * texel, 0.0).rgb;
  s += textureSampleLevel(srcTex, linSamp, uv + vec2f(-0.5,  0.5) * texel, 0.0).rgb;
  s += textureSampleLevel(srcTex, linSamp, uv + vec2f( 0.5,  0.5) * texel, 0.0).rgb;
  s /= 5.0;
  // Soft knee threshold so the bloom ramps in rather than clipping on.
  let th = 1.05;
  let lum = luma(s);
  let contrib = max(lum - th, 0.0) / max(lum, 1e-4);
  return vec4f(s * contrib, 1.0);
}

@fragment
fn bloomDown(v: PostOut) -> @location(0) vec4f {
  let uv = v.uv;
  let srcDim = vec2f(textureDimensions(srcTex, 0));
  let t = 1.0 / srcDim;
  // 13-tap Call-of-Duty style downsample: stable, no ringing.
  let s00 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f(-2.0,  2.0), 0.0).rgb;
  let s10 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 0.0,  2.0), 0.0).rgb;
  let s20 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 2.0,  2.0), 0.0).rgb;
  let s01 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f(-2.0,  0.0), 0.0).rgb;
  let s11 = textureSampleLevel(srcTex, linSamp, uv, 0.0).rgb;
  let s21 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 2.0,  0.0), 0.0).rgb;
  let s02 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f(-2.0, -2.0), 0.0).rgb;
  let s12 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 0.0, -2.0), 0.0).rgb;
  let s22 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 2.0, -2.0), 0.0).rgb;
  let d11 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f(-1.0,  1.0), 0.0).rgb;
  let e11 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 1.0,  1.0), 0.0).rgb;
  let d01 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  let e01 = textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 1.0, -1.0), 0.0).rgb;
  var o = s11 * 0.125;
  o += (s00 + s20 + s02 + s22) * 0.03125;
  o += (s10 + s01 + s21 + s12) * 0.0625;
  o += (d11 + e11 + d01 + e01) * 0.125;
  return vec4f(o, 1.0);
}

@fragment
fn bloomUp(v: PostOut) -> @location(0) vec4f {
  let uv = v.uv;
  let srcDim = vec2f(textureDimensions(srcTex, 0));
  let t = 0.5 / srcDim;
  var o = textureSampleLevel(srcTex, linSamp, uv, 0.0).rgb * 4.0;
  o += textureSampleLevel(srcTex, linSamp, uv + vec2f(-t.x,  0.0), 0.0).rgb * 2.0;
  o += textureSampleLevel(srcTex, linSamp, uv + vec2f( t.x,  0.0), 0.0).rgb * 2.0;
  o += textureSampleLevel(srcTex, linSamp, uv + vec2f( 0.0, -t.y), 0.0).rgb * 2.0;
  o += textureSampleLevel(srcTex, linSamp, uv + vec2f( 0.0,  t.y), 0.0).rgb * 2.0;
  o += textureSampleLevel(srcTex, linSamp, uv + t * vec2f(-1.0, -1.0), 0.0).rgb;
  o += textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 1.0, -1.0), 0.0).rgb;
  o += textureSampleLevel(srcTex, linSamp, uv + t * vec2f(-1.0,  1.0), 0.0).rgb;
  o += textureSampleLevel(srcTex, linSamp, uv + t * vec2f( 1.0,  1.0), 0.0).rgb;
  return vec4f(o / 16.0, 1.0);
}

// ---------------------------------------------------------------- depth of field

/**
 * Half-resolution bokeh built from a single gather. The disc is sampled on a
 * golden-angle spiral; 16 taps is enough once the tilt-shift term below
 * widens the radius.
 */
@fragment
fn dofPrefilter(v: PostOut) -> @location(0) vec4f {
  let uv = v.uv;
  let fullDim = vec2i(F.screen.xy);
  let halfDim = fullDim / 2;
  let p = vec2i(uv * vec2f(halfDim));
  let c = textureLoad(srcTex, p * 2, 0);
  return vec4f(min(c.rgb, vec3f(48.0)), 1.0);
}

@fragment
fn dofBlur(v: PostOut) -> @location(0) vec4f {
  let uv = v.uv;
  let c0 = textureSampleLevel(srcTex, linSamp, uv, 0.0);
  let band = focusBand(uv);

  // Tilt-shift dominates: the band is a soft horizontal gradient, which is
  // exactly the miniature faking trick. The radius is deliberately small —
  // this is a *gradient across the frame*, not a smear. An earlier 0.022 gave
  // ~30px of blur at the edges and destroyed the image.
  let ts = F.lens2.x * (1.0 - band);
  let coc = clamp(ts * 0.55 + (1.0 - band) * F.lens2.w * 0.25, 0.0, 1.0);
  let radius = coc * 0.0075;

  var acc = c0.rgb;
  var wsum = 1.0;
  let GA = 2.39996323;
  for (var k = 0; k < 16; k++) {
    let fi = f32(k);
    let a = fi * GA;
    let r = sqrt((fi + 0.5) / 16.0) * radius;
    let off = vec2f(cos(a), sin(a) * 0.62) * r;   // slightly anamorphic
    let s = textureSampleLevel(srcTex, linSamp, uv + off, 0.0).rgb;
    // Weight by how blurred the *source* is, so in-focus detail does not bleed.
    let w = 1.0 - fi / 20.0;
    acc += s * w; wsum += w;
  }
  return vec4f(acc / wsum, coc);
}

// ---------------------------------------------------------------- composite

/**
 * Debug views. Selected by `F.misc.w` so the frame graph can be bisected from
 * the automation surface without recompiling: 1 = raw resolved, 2 = bloom only,
 * 3 = DOF only, 4 = no warp/CA, 5 = no tonemap, 6 = no grade. Every "the colours
 * are wrong" bug in this renderer has been a post-chain bug, and guessing which
 * stage from a screenshot is far slower than looking.
 */
// NOT an entry point. WGSL forbids calling one, and marking this `@fragment`
// silently invalidated the entire module — every post pass became a no-op and
// the whole frame went black. Debug views must be a plain function dispatched
// from the real entry point.
fn debugView(v: PostOut) -> vec4f {
  let mode = i32(F.misc.w + 0.5);
  let src = textureSampleLevel(srcTex, linSamp, v.uv, 0.0).rgb;
  let bl = textureSampleLevel(bloomTex, linSamp, v.uv, 0.0).rgb;
  let df = textureSampleLevel(dofTex, linSamp, v.uv, 0.0).rgb;
  var o = src;
  if (mode == 1) { o = src; }
  else if (mode == 2) { o = bl * 4.0; }
  else if (mode == 3) { o = df.rgb; }
  else if (mode == 4) { o = tonemap(src * F.weather4.w); }
  else if (mode == 5) { o = tonemap(src * F.weather4.w) * 4.0; }
  else if (mode == 6) {
    // The shaft buffer ALONE, x2.5 and tonemapped so a faint in-scatter term is
    // visible at all. Binding 4 holds the shaft buffer exactly when the shaft
    // pass ran, and the pass runs on the same `weather2.y > 0` test the CPU
    // uses, so this view is honest in both directions: black means the pass did
    // not run, which is the one thing a phantom looks like.
    let sh = select(vec3f(0.0), textureSampleLevel(dofTex, linSamp, v.uv, 0.0).rgb, F.weather2.y > 0.001);
    o = tonemap(sh * 2.5);
  }
  return vec4f(linearToSrgb(o), 1.0);
}

// ---------------------------------------------------------------- shafts

/**
 * Shafted volumetric light, by radial scatter from the sun's screen position.
 *
 * `weather2.y` was written every frame for three sessions and read by nothing.
 * `WeatherDirector` drives it from `sunbreak`, `fog-bank` and `lightning`, and
 * poses and the LLM's `set_weather` set it, so a pose carrying `godRays: 0.4`
 * was asserting an effect that did not exist. This is the pass that makes that
 * field mean something.
 *
 * The formulation is the cheap portable one on purpose. A full-screen march is
 * one triangle, one depth fetch per step and no geometry; a froxel compute
 * volume would be faster per pixel and would not survive the port to WebGL2
 * without a rewrite. Everything below is plain arithmetic over texture loads.
 *
 * How it works: a shaft is the set of pixels whose line of sight to the sun is
 * not blocked. The occlusion signal is therefore the DEPTH BUFFER and nothing
 * else — no extra render target, no extra geometry, no lighting query. Each
 * pixel walks toward the sun in screen space and accumulates how much of that
 * walk is unobstructed sky. Buildings then read as the thing casting the shafts,
 * for free, because they are what writes the depth.
 *
 * Reverse-Z: the main pass clears depth to 0.0 and tests `greater`, so a
 * fragment at the far plane is ~0 and sky is exactly 0. That makes the occlusion
 * test a threshold rather than a comparison against a reconstructed world
 * distance, which is both cheaper and immune to the near/far convention.
 */
const SHAFT_STEPS : i32 = 14;

/** Sun direction to a screen uv, or a sentinel outside the frame. */
fn sunScreenUv() -> vec2f {
  // A point far along the sun direction: the sun is a direction, not a point,
  // so it is placed at the far plane and projected like anything else.
  let p = F.viewProj * vec4f(F.sunDir.xyz * 1e6, 1.0);
  if (p.w <= 1e-6) { return vec2f(-10.0); }
  let n = p.xy / p.w;
  return vec2f(n.x * 0.5 + 0.5, 0.5 - n.y * 0.5);
}

@fragment
fn shafts(v: PostOut) -> @location(0) vec4f {
  let strength = F.weather2.y;
  // Below this the pass is skipped by the caller; returning black here as well
  // means the buffer is never stale if that check is ever loosened.
  if (strength <= 0.001) { return vec4f(0.0, 0.0, 0.0, 1.0); }

  let sun = sunScreenUv();
  // The sun is behind the camera or so far off frame that a radial smear would
  // be a directionless streak rather than a shaft. Nothing to add.
  if (sun.x < -0.6 || sun.x > 1.6 || sun.y < -0.6 || sun.y > 1.6) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  // Exponent controls the decay along the walk, and therefore whether the shaft
  // is a tight spear or a wide fan. A shaft reads best when it is brightest
  // near the sun, which is what the exponent buys.
  let density = 0.55 + 0.45 * strength;
  let uv = v.uv;
  let delta = (sun - uv) * (1.0 / f32(SHAFT_STEPS));
  var coord = uv;
  var acc = 0.0;
  var w = 1.0;
  var wsum = 0.0;
  for (var i = 0; i < SHAFT_STEPS; i = i + 1) {
    coord = coord + delta;
    // Fetch the depth at this half-res sample. `depthTex` is full res, so the
    // coordinate is scaled: one fetch covers the same 2x2 block either way.
    let dim = vec2i(F.screen.xy);
    let px = vec2i(clamp(coord, vec2f(0.0), vec2f(0.999)) * F.screen.xy);
    let d = textureLoad(depthTex, clamp(px, vec2i(0), dim - 1), 0);
    // 0.0 is the clear value: the sky. Anything above it is geometry in the
    // way, and contributes nothing to the shaft.
    let sky = step(d, 1e-5);
    acc = acc + sky * w;
    wsum = wsum + w;
    w = w * (1.0 - density * 0.55);
  }
  let march = acc / max(wsum, 1e-4);
  // Fade out when the sun is behind the camera: the shafts have no origin on
  // screen and a radial smear from off-frame reads as a lens artefact.
  let onScreen = smoothstep(1.35, 0.75, max(abs(sun.x - 0.5), abs(sun.y - 0.5)) * 2.0);
  // Concentrate the term around the sun. This is not a taste knob, it is the
  // difference between the effect existing at all. Open sky marches to
  // `march == 1` everywhere, so without a radial falloff the pass adds a
  // uniform veil across the entire frame: a fog card with fourteen steps of
  // extra cost, and at the gain the sun's own intensity implies it is a white
  // one. The falloff is also what lets the shafts read — an occluder only
  // darkens `march` relative to its neighbours, and only near the sun is there
  // enough signal for that difference to be visible.
  let dv = (sun - uv) * vec2f(F.screen.x / F.screen.y, 1.0);
  let radial = exp(-dot(dv, dv) * 4.0);
  // Deliberately NOT multiplied by sun intensity. Sun intensity is ~4.6 at
  // dusk, and this term is additive on top of a sky that already has it in it;
  // scaling by it again is what turned the first working build into white.
  let amt = march * strength * onScreen * radial * 0.6;
  // Sun-tinted, so a shaft at sunset is warm and at noon is white. The colour is
  // the frame's own sun, not a constant — a constant here is the difference
  // between light and a filter.
  return vec4f(F.sunColor.rgb * amt, 1.0);
}

@fragment
fn composite(v: PostOut) -> @location(0) vec4f {
  if (F.misc.w > 0.5) { return debugView(v); }
  // The barrel warp pushes corners past the frame; crop in rather than sample
  // there (see lensCrop).
  let uv = 0.5 + (warpLens(v.uv, 1.0) - 0.5) / lensCrop();

  // Chromatic aberration: sample R/G/B at slightly different radial scales.
  let ca = F.lens3.y * 0.0011;
  let c0 = uv - 0.5;
  let r2 = dot(c0, c0);
  let dir = normalize(c0 + vec2f(1e-6));
  let off = dir * r2 * ca;

  var col: vec3f;
  if (ca > 1e-6) {
    let cr = textureSampleLevel(srcTex, linSamp, uv + off, 0.0).r;
    let cg = textureSampleLevel(srcTex, linSamp, uv, 0.0).g;
    let cb = textureSampleLevel(srcTex, linSamp, uv - off, 0.0).b;
    col = vec3f(cr, cg, cb);
  } else {
    col = textureSampleLevel(srcTex, linSamp, uv, 0.0).rgb;
  }

  // Shafts. Added here rather than into the HDR target so they sit AFTER the
  // temporal resolve: TAA smears anything it accumulates, and a shaft that
  // trails behind the camera reads as a motion-blur bug rather than as light.
  // The cost of that ordering is that they do not bloom, which is the right
  // trade — bloom on an already-soft additive term is how shafts turn to mush.
  if (F.weather2.y > 0.001) {
    col = col + textureSampleLevel(dofTex, linSamp, uv, 0.0).rgb;
  }

  // Defocus, sampled through the same lens warp so the blur bends too.
  let dofC = textureSampleLevel(dofTex, linSamp, uv, 0.0);
  let band = focusBand(uv);
  // Blend the defocus in gently. A hard mix turns the whole frame to mush the
  // moment the camera is not perfectly level.
  let dofMix = clamp((1.0 - band) * (0.35 + F.lens2.w * 0.30), 0.0, 0.62);
  col = mix(col, dofC.rgb, dofMix);

  // Halation: bloom tinted warm and added before tonemapping, the way light
  // scatters in film.
  let bloom = textureSampleLevel(bloomTex, linSamp, uv, 0.0).rgb;
  let halation = vec3f(1.0, 0.62, 0.42);
  col += bloom * (F.weather4.x * 0.55) * mix(vec3f(1.0), halation, 0.55);

  // Exposure.
  col *= F.weather4.w;

  // Filmic tonemap, then saturation and the district grade.
  col = tonemap(col);
  let l = luma(col);
  col = mix(vec3f(l), col, F.weather4.y);
  col *= F.grade.rgb;

  // Vignette, elliptical so it doesn't fight a wide frame.
  let vd = (c0 * vec2f(1.0, 0.86)) * 2.0;
  let vig = 1.0 - F.lens3.z * dot(vd, vd) * 0.55;
  col *= clamp(vig, 0.0, 1.0);

  // Grain, scaled down in the highlights the way real film behaves.
  let g = hash21(uv * F.screen.xy + vec2f(F.time.z * 1.7, F.time.z * 2.3)) - 0.5;
  col += g * F.weather4.z * 0.030 * (1.0 - l * 0.75);

  col = max(col, vec3f(0.0));
  return vec4f(linearToSrgb(col), 1.0);
}

/** Straight copy, used for the TAA history swap and for capture. */
@fragment
fn blit(v: PostOut) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(srcTex, linSamp, v.uv, 0.0).rgb, 1.0);
}
