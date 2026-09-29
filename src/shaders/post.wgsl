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


/** Camera-basis distortion applied to a centred, aspect-corrected uv. */
fn warpLens(uvIn: vec2f) -> vec2f {
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
  let warp = F.lens.z;
  if (warp > 0.001) {
    let t = F.time.x;
    w.x += sin(ca.y * 5.3 + t * 0.31) * warp * 0.010;
    w.y += cos(ca.x * 4.1 - t * 0.24) * warp * 0.008;
  }
  uv = vec2f(w.x / aspect, w.y) + 0.5;
  return uv;
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
  else if (mode == 6) { o = src; }
  return vec4f(linearToSrgb(o), 1.0);
}

@fragment
fn composite(v: PostOut) -> @location(0) vec4f {
  if (F.misc.w > 0.5) { return debugView(v); }
  var uv = warpLens(v.uv);

  // The barrel warp can push corners past the frame. Fade them out over a
  // narrow band rather than hard-cutting to black, so the vignette reads as a
  // lens rather than a mask.
  let edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  let outFade = smoothstep(-0.045, 0.012, edge);

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

  col = max(col, vec3f(0.0)) * outFade;
  return vec4f(linearToSrgb(col), 1.0);
}

/** Straight copy, used for the TAA history swap and for capture. */
@fragment
fn blit(v: PostOut) -> @location(0) vec4f {
  return vec4f(textureSampleLevel(srcTex, linSamp, v.uv, 0.0).rgb, 1.0);
}
