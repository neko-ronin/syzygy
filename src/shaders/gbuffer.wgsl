// ============================================================================
//  gbuffer.wgsl — geometry pass.
//
//  Every building, prop, cable and bridge lands here. The interesting work is
//  procedural: facades get their windows, sills, grime streaks, AC boxes and
//  shopfronts computed in the fragment shader from world position, so the city
//  carries believable mid-frequency detail without a single byte of texture.
// ============================================================================

struct VSIn {
  @location(0)  position : vec3f,
  @location(1)  normal   : vec3f,
  @location(2)  uv       : vec2f,
  @location(3)  color    : vec3f,
  @location(4)  emissive : f32,

  // per-instance
  @location(5) m0 : vec4f,
  @location(6) m1 : vec4f,
  @location(7) m2 : vec4f,
  @location(8) m3 : vec4f,
  @location(9) tint : vec4f,   // rgb multiply, a = alpha
  @location(10) params: vec4f, // x=matId, y=rough, z=emissive, w=seed
};

struct VSOut {
  @builtin(position) clip : vec4f,
  @location(0) world  : vec3f,
  @location(1) normal : vec3f,
  @location(2) uv     : vec2f,
  @location(3) color  : vec3f,
  @location(4) @interpolate(flat) matId  : u32,
  @location(5) @interpolate(flat) rough : f32,
  @location(6) @interpolate(flat) emis  : f32,
  @location(7) @interpolate(flat) seed  : f32,
  @location(8) @interpolate(flat) tint  : f32,
};

@vertex
fn vs(v: VSIn) -> VSOut {
  let m = mat4x4f(v.m0, v.m1, v.m2, v.m3);
  let wp = m * vec4f(v.position, 1.0);

  var o: VSOut;
  o.clip = F.viewProj * wp;
  o.world = wp.xyz;
  // Instances are rigid + uniform-scaled, so the upper 3x3 needs no inverse
  // transpose — but buildings lean, so the model matrix carries rotation and
  // we transform the normal by it directly.
  o.normal = normalize((m * vec4f(v.normal, 0.0)).xyz);
  o.uv = v.uv;
  o.color = v.color * v.tint.rgb;
  o.matId = u32(v.params.x + 0.5);
  o.rough = v.params.y;
  o.emis = v.params.z * v.tint.a;
  o.seed = v.params.w;
  o.tint = v.tint.a;
  // `emis` and the tint alpha both gate emission, but the fragment stage needs
  // the raw emissive mask too.
  return o;
}

// ---------------------------------------------------------------- materials

const MAT_DIFFUSE : u32 = 0u;
const MAT_GLASS   : u32 = 1u;
const MAT_FOLIAGE : u32 = 2u;
const MAT_METAL   : u32 = 3u;
const MAT_WATER   : u32 = 4u;
const MAT_EMISSIVE: u32 = 5u;
const MAT_BRICK   : u32 = 6u;
const MAT_PLASTER : u32 = 7u;
const MAT_STREET  : u32 = 8u;
const MAT_PLAIN   : u32 = 9u;

// ---------------------------------------------------------------- facade

/** What the facade synthesiser hands back to the fragment stage. */
struct Facade {
  albedo    : vec3f,
  roughness : f32,
  metallic  : f32,
  emissive  : vec3f,
  occlusion : f32,
};

/**
 * A whole facade in one function: floor bands, window cells, recessed sills,
 * grime running down from each sill, shopfronts at street level, and a slow
 * per-floor colour drift so no two walls read the same.
 */
fn facade(
  world: vec3f, n: vec3f, base: vec3f, accent: vec3f, seed: f32,
  floorH: f32, detail: f32,
) -> Facade {
  // Work in a 2D frame on the wall: u = horizontal, v = height.
  let ax = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.x) > 0.5);
  let u = dot(world, ax);
  let v = world.y;

  let floorIdx = floor(v / floorH);
  let fy = fract(v / floorH);
  let colW = 3.1;
  let colIdx = floor(u / colW);
  let fx = fract(u / colW);

  let cellId = vec2f(colIdx, floorIdx);

  // Window aperture, inset from the cell. Bay windows on some buildings.
  let bayJit = hash21(cellId + vec2f(seed * 37.0, 0.0));
  let insetX = 0.24 + 0.10 * bayJit;
  let insetY = 0.22 + 0.06 * hash21(cellId.yx + vec2f(0.0, seed * 91.0));
  let isGlass = fx > insetX && fx < 1.0 - insetX && fy > insetY && fy < 1.0 - insetY;

  // Per-floor structural band: a slightly proud ledge at every floor line.
  let ledge = 1.0 - smoothstep(0.0, 0.055, fy);
  let sill = 1.0 - smoothstep(insetY - 0.05, insetY, fy) * step(fy, insetY + 0.03);

  var alb = base;
  var rough = 0.72;
  var metal = 0.0;
  var emis = vec3f(0.0);
  var ao = 1.0;

  // --- per-floor tonal drift. Old concrete stains, repainted floors, sun-bleach.
  let floorTone = (hash11(floorIdx * 3.71 + seed * 13.0) - 0.5) * 0.16;
  alb *= 1.0 + floorTone;

  // --- vertical grime streaks below each sill, strongest on the older blocks.
  let streakSeed = hash21(vec2f(colIdx * 0.37, floorIdx * 5.1) + seed);
  let streak = smoothstep(0.55, 1.0, streakSeed) *
               smoothstep(0.0, 0.42, fy) * (1.0 - smoothstep(0.42, 0.85, fy));
  let streakNoise = fbm2(vec2f(u * 0.55, v * 0.09 + floorIdx * 3.0) + seed, select(2, 3, detail > 0.5));
  alb *= 1.0 - streak * streakNoise * 0.30;

  // --- broad weathering blotches so large walls aren't flat.
  let blotch = fbm2(vec2f(u, v) * 0.055 + seed * 3.0, select(2, 4, detail > 0.5));
  alb *= 0.86 + 0.28 * blotch;

  if (ledge > 0.01) {
    alb = mix(alb, alb * 0.72 + vec3f(0.02), ledge * 0.8);
    ao *= 1.0 - ledge * 0.30;
  }

  if (isGlass) {
    // --- the window itself.
    let r = hash21(cellId + vec2f(seed * 53.0, seed * 7.0));
    let kind = hash21(cellId * 1.7 + vec2f(seed * 11.0, 3.0));

    // Window frame / mullion, dead centre.
    let mull = min(abs(fx - 0.5), abs(fy - 0.5));
    let isMull = mull < 0.018;

    if (isMull) {
      alb = base * 0.55 + vec3f(0.03);
      rough = 0.55;
    } else {
      // Glass: dark, and it *reflects the sky* — that is most of the read.
      let glassDepth = 0.10 + 0.35 * r;
      alb = mix(vec3f(0.020, 0.028, 0.036), base * 0.30, glassDepth);
      rough = 0.06 + 0.10 * kind;
      metal = 0.0;

      // Interior lights. Roughly 40% lit, warm with occasional cold/green.
      let lit = step(0.58, hash21(cellId * 3.3 + vec2f(seed * 17.0, 9.0)));
      if (lit > 0.5) {
        let warm = mix(vec3f(1.0, 0.72, 0.38), vec3f(0.55, 0.85, 1.0), step(0.86, kind));
        let bright = 0.35 + 3.2 * pow(hash21(cellId * 5.7 + seed), 3.0);
        // Fluorescent interiors are flatter; lamps read as a hot core.
        let core = 1.0 - smoothstep(0.0, 0.35, min(abs(fx - 0.5), abs(fy - 0.5)));
        emis = warm * bright * (0.55 + core * 0.9);
        alb = mix(alb, warm * 0.5, 0.4);
      }
      // Blinds / curtains occlude part of the aperture.
      let blind = step(0.72, kind) * step(0.5, fract(fy * 6.0 + r));
      alb *= 1.0 - blind * 0.4;
      emis *= 1.0 - blind * 0.55;
    }
    ao *= 0.88;
  } else {
    // --- Sill: a proud ledge that catches light and casts a soft line below.
    if (sill > 0.01) {
      alb = mix(alb, alb * 1.18 + accent * 0.05, sill);
      ao *= 1.0 - (1.0 - sill) * 0.0 - 0.0;
    }
  }

  // --- Ground floor: shopfronts, awnings, signage glow. This is the layer
  //     that makes a street read as inhabited rather than modelled.
  let groundY = 7.5;
  if (v < groundY && v > 0.2) {
    let gy = v / groundY;
    let shopH = step(0.18, gy);
    let shopKind = hash21(vec2f(colIdx * 2.3, 0.0) + seed * 29.0);
    if (shopH > 0.5) {
      let signBand = smoothstep(0.70, 0.76, gy) * (1.0 - smoothstep(0.86, 0.92, gy));
      if (signBand > 0.01) {
        // Neon: saturated accent, gated by cell hash so only some are on.
        let on = step(0.42, hash21(vec2f(colIdx * 7.7, floorIdx * 2.1) + seed));
        let neon = mix(accent, vec3f(1.0, 0.35, 0.22), hash11(colIdx * 3.1 + seed));
        emis += neon * signBand * on * (2.2 + 2.0 * hash11(colIdx * 9.1));
        alb = mix(alb, vec3f(0.03), signBand * 0.7);
      }
      // Window display, warmly lit from inside.
      let disp = step(0.42, gy) * (1.0 - step(0.70, gy));
      let glow = 0.25 + 0.75 * hash11(colIdx * 13.7 + floorIdx + seed);
      alb = mix(alb, mix(vec3f(0.04, 0.045, 0.05), vec3f(0.9, 0.72, 0.5) * glow, 0.55), disp * 0.85);
      emis += vec3f(0.85, 0.66, 0.44) * disp * glow * 1.5;
      // Awning stripe.
      let aw = step(0.62, gy) * (1.0 - step(0.70, gy));
      let stripe = step(0.5, fract(u * 0.7 + shopKind * 3.0));
      alb = mix(alb, mix(accent, vec3f(0.92, 0.90, 0.86), stripe), aw * 0.8);
    }
  }

  var f: Facade;
  f.albedo = max(alb, vec3f(0.0));
  f.roughness = clamp(rough, 0.03, 1.0);
  f.metallic = metal;
  f.emissive = emis;
  f.occlusion = ao;
  return f;
}

/** Foliage: a leaf-clump alpha test driven by a triplanar cellular pattern. */
fn foliage(world: vec3f, n: vec3f, base: vec3f, seed: f32) -> vec4f {
  let p = world * 2.6 + seed * 17.0;
  let w = worley2(p.xz + p.y * 0.3);
  let d = fbm3(p * 0.55, 3);
  let mask = smoothstep(0.62, 0.40, w + d * 0.22);
  // Leaves are lighter at the tips and darker underneath.
  let up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  var c = base * (0.55 + 0.75 * up) * (0.75 + 0.5 * d);
  c = mix(c * 0.45, c, mask);
  return vec4f(c, mask);
}

// ---------------------------------------------------------------- fragment

struct GOut {
  @location(0) albedoRough : vec4f,   // rgb albedo, a roughness
  @location(1) normalMetal : vec4f,   // xyz world normal, a = metallic
  @location(2) emissive    : vec4f,   // rgb emissive, a ao
};

@fragment
fn fs(i: VSOut) -> GOut {
  var n = normalize(i.normal);
  let V = normalize(F.camPos.xyz - i.world);
  if (dot(n, V) < 0.0) { n = n; }  // keep two-sided shading honest for thin geo

  var base = i.color;
  var rough = i.rough;
  var metal = select(0.0, 0.85, i.matId == MAT_METAL);
  var emis = i.color * i.emis;
  var ao = 1.0;
  var alpha = i.tint;

  let detail = F.time.w;

  if (i.matId == MAT_DIFFUSE || i.matId == MAT_PLASTER || i.matId == MAT_BRICK) {
    let r = facade(i.world, n, i.color, i.color * 0.4 + vec3f(0.25, 0.12, 0.05), i.seed, 3.6, detail);
    base = r.albedo; rough = r.roughness; metal = r.metallic; emis = r.emissive; ao = r.occlusion;
    // Brick courses on the masonry districts.
    if (i.matId == MAT_BRICK) {
      let course = floor(i.world.y / 0.28);
      let off = fract(course * 0.5) * 0.5;
      let bx = fract((dot(i.world, select(vec3f(1.0,0.0,0.0), vec3f(0.0,0.0,1.0), abs(n.x) > 0.5)) + off) * 5.5);
      let by = fract(i.world.y / 0.28);
      let mortar = 1.0 - min(smoothstep(0.0, 0.07, bx) * smoothstep(0.0, 0.14, by), 1.0);
      base = mix(vec3f(0.30, 0.28, 0.26), base, mortar * 0.85 + 0.15);
    }
  } else if (i.matId == MAT_GLASS) {
    rough = 0.08;
  } else if (i.matId == MAT_FOLIAGE) {
    let f = foliage(i.world, n, i.color, i.seed);
    base = f.rgb; alpha *= f.a; rough = 0.68;
  } else if (i.matId == MAT_WATER) {
    rough = 0.04;
    metal = 0.0;
  } else if (i.matId == MAT_STREET) {
    // Street deck: worn asphalt with a faint centreline grain and enough
    // variation that a large flat quad does not read as a solid fill. Painted
    // markings come from the baked kerb geometry, not from here.
    let g = fbm2(i.world.xz * 0.06, 3);
    let fine = fbm2(i.world.xz * 1.4, 2);
    base = base * (0.72 + 0.5 * g) + vec3f(0.010) * fine;
    // Puddle-scale variation so wetness has something to key off.
    let pool = smoothstep(0.42, 0.86, g);
    ao *= 0.86 + 0.14 * pool;
    rough = 0.60 - 0.18 * pool;
  } else if (i.matId == MAT_PLAIN) {
    // Entities: keep the instance colour, add a touch of cloth-like noise so
    // large surfaces (a tram flank, a blimp envelope) are not dead flat.
    base *= 0.90 + 0.20 * fbm3(i.world * 0.7, 2);
  }

  // --- wetness: everything darkens and tightens, and puddles pool in the
  //     low-frequency noise. The specular tightening is what sells rain.
  let wet = F.weather2.x;
  if (wet > 0.001 && i.matId != MAT_FOLIAGE) {
    let pool = smoothstep(0.45, 0.85, fbm2(i.world.xz * 0.09, 3) + (1.0 - clamp(n.y, 0.0, 1.0)) * 0.4);
    let w = wet * mix(0.35, 1.0, pool) * clamp(1.2 - abs(n.y), 0.0, 1.0);
    base *= 1.0 - w * 0.42;
    rough = mix(rough, 0.055, w * 0.85);
  }

  // --- height-based ambient occlusion. A cheap, very effective approximation
  //     of the canyon bounce: streets are darker, upper facades catch sky.
  let up = clamp(n.y * 0.5 + 0.5, 0.0, 1.0);
  let groundAo = mix(0.55, 1.0, smoothstep(0.0, 45.0, i.world.y));
  ao *= mix(groundAo, 1.0, up * 0.55);

  var o: GOut;
  o.albedoRough = vec4f(base, rough);
  o.normalMetal = vec4f(n, metal);
  o.emissive = vec4f(emis, ao);
  return o;
}

// ---------------------------------------------------------------- depth-only

struct DepthOut { @builtin(position) clip: vec4f };

@vertex
fn vsDepth(v: VSIn) -> DepthOut {
  let m = mat4x4f(v.m0, v.m1, v.m2, v.m3);
  var o: DepthOut;
  o.clip = F.viewProj * (m * vec4f(v.position, 1.0));
  return o;
}

@fragment
fn fsDepth() { }
