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
  @location(9) @interpolate(flat) groundTag : f32,
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
  // Negative red flags a vertex that keeps its own colour under the instance
  // tint (pedestrian skin and hair); albedo is never negative otherwise.
  o.color = select(v.color * v.tint.rgb, abs(v.color), v.color.r < 0.0);
  o.matId = u32(v.params.x + 0.5);
  o.rough = v.params.y;
  // `v.emissive` is the PER-VERTEX emissive mask: `MeshBuilder.vert` writes it
  // into the 4th channel of the vertex colour, `uploadMesh` puts it at vertex
  // offset 44, and `VSIn` has carried it at `@location(4)` since the beginning.
  //
  // It was discarded here. This line read `o.emis = v.params.z * v.tint.a` —
  // instance emissive only — so for every chunk draw, where `params.z` is 0 by
  // construction, `o.emis` was ALWAYS ZERO and the entire per-vertex emissive
  // channel was a dead wire. Every `PropKind.Lantern` (emissive 5.5), every
  // `PropKind.Sign` (2.6), every antenna beacon (3.0) and every lit market
  // element wrote a real emissive value into a buffer that was thrown away one
  // line later. The city had thousands of lights on it and rendered none of
  // them. No error, no warning, plausible statistics, dark pixels.
  //
  // `max`, not `+`: entity meshes ALSO carry per-vertex emissive
  // (`entityMeshes.tramCar()` marks its headlights 8.0) on top of a per-instance
  // `params.z`, and `crowd.ts` submits its own. Adding would double-count every
  // entity emitter and push it through the bloom threshold at 1.05. `max` means
  // "whichever channel asked for more", which is what a mask is.
  o.emis = max(max(v.emissive, 0.0), v.params.z * v.tint.a);
  o.groundTag = min(v.emissive, 0.0);
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
/** Building shells opt in to `facade()` by offsetting u (citymesh FACADE_UV; twice = reflective glass); props stay plain. */
const FACADE_UV: f32 = 4096.0;
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
 * How much authored light is on: 1 at dusk and night (sun sin-elevation under
 * 0.02), 0 by mid-morning. Glowing windows read as dots in daylight and noon
 * lanterns as flat white hexagons (D27).
 */
fn lightsOn() -> f32 { return 1.0 - smoothstep(0.02, 0.25, F.sunDir.y); }

/**
 * Detail that survives distance. A 3.1 x 3.6 m window cell is ~4 px at 1 km and
 * TAA averages it to a flat wall, so towers need structure at a lower spatial
 * frequency: a louvred mechanical floor every 8-13 storeys (per building) and
 * per-floor occupancy at night, so lit floors read as bands, not uniform fizz.
 */
fn isMechFloor(floorIdx: f32, seed: f32) -> bool {
  let every = 8.0 + floor(hash11(seed * 7.31) * 6.0);
  let k = floorIdx + floor(hash11(seed * 3.17) * every);
  return floorIdx > 2.5 && abs(k - every * floor(k / every)) < 0.5;
}

/** Lit-window threshold for a floor: mean ~0.6 keeps ~40% of windows lit city-wide. */
fn floorLitThreshold(floorIdx: f32, seed: f32) -> f32 {
  return mix(0.25, 0.95, hash11(floorIdx * 1.93 + seed * 5.7));
}

/**
 * A whole facade in one function: floor bands, window cells, recessed sills,
 * grime running down from each sill, shopfronts at street level, and a slow
 * per-floor colour drift so no two walls read the same.
 */
fn facade(
  world: vec3f, n: vec3f, base: vec3f, accent: vec3f, seed: f32,
  floorH: f32, detail: f32, mirror: f32,
) -> Facade {
  let lights = lightsOn();
  // `mirror` 1: glass mirrors the cladding (teal/pastel towers), so the window
  // grid stays a near-imperceptible texture and the tower keeps its colour.
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
  // Per-building seed: the instance seed is per chunk; walls carry a ±4% jitter.
  let bseed = seed + hash21(base.xy * 517.0 + vec2f(base.z * 31.0)) * 97.0;
  let mech = isMechFloor(floorIdx, bseed);
  let isGlass = !mech && fx > insetX && fx < 1.0 - insetX && fy > insetY && fy < 1.0 - insetY;

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
    alb = mix(alb, alb * mix(0.72, 0.95, mirror) + vec3f(0.02 * (1.0 - mirror)), ledge * 0.8);
    ao *= 1.0 - ledge * 0.30 * (1.0 - 0.8 * mirror);
  }

  if (isGlass) {
    // --- the window itself.
    let r = hash21(cellId + vec2f(seed * 53.0, seed * 7.0));
    let kind = hash21(cellId * 1.7 + vec2f(seed * 11.0, 3.0));

    // Window frame / mullion, dead centre.
    let mull = min(abs(fx - 0.5), abs(fy - 0.5));
    let isMull = mull < 0.018;

    if (isMull) {
      alb = mix(base * 0.55 + vec3f(0.03), base * 0.93, mirror);
      rough = 0.55;
    } else {
      // Glass: dark, and it *reflects the sky* — that is most of the read.
      let glassDepth = 0.10 + 0.35 * r;
      alb = mix(mix(vec3f(0.020, 0.028, 0.036), base * 0.30, glassDepth), base * (0.90 + 0.08 * r), mirror);
      rough = mix(0.06 + 0.10 * kind, 0.30 + 0.08 * kind, mirror);
      metal = 0.0;

      // Interior lights. Roughly 40% lit, warm with occasional cold/green.
      let lit = step(floorLitThreshold(floorIdx, bseed), hash21(cellId * 3.3 + vec2f(seed * 17.0, 9.0)));
      if (lit > 0.5) {
        let warm = mix(vec3f(1.0, 0.72, 0.38), vec3f(0.55, 0.85, 1.0), step(0.86, kind));
        let bright = 0.35 + 3.2 * pow(hash21(cellId * 5.7 + seed), 3.0);
        // Fluorescent interiors are flatter; lamps read as a hot core.
        let core = 1.0 - smoothstep(0.0, 0.35, min(abs(fx - 0.5), abs(fy - 0.5)));
        emis = warm * bright * (0.55 + core * 0.9) * lights;
        alb = mix(alb, warm * 0.5, 0.4 * lights);
      }
      // Blinds / curtains occlude part of the aperture.
      let blind = step(0.72, kind) * step(0.5, fract(fy * 6.0 + r));
      alb *= 1.0 - blind * 0.4 * (1.0 - 0.85 * mirror);
      emis *= 1.0 - blind * 0.55;
    }
    ao *= mix(0.88, 0.98, mirror);
  } else if (mech) {
    // Louvred plant floor: dark, horizontally slatted, never lit.
    let slat = step(0.5, fract(fy * 9.0));
    alb = base * mix(0.38 + 0.12 * slat, 0.88 + 0.05 * slat, mirror);
    rough = 0.6;
    ao *= mix(0.8, 0.96, mirror);
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
        emis += neon * signBand * on * (2.2 + 2.0 * hash11(colIdx * 9.1)) * mix(0.35, 1.0, lights);
        alb = mix(alb, vec3f(0.03), signBand * 0.7);
      }
      // Window display, warmly lit from inside.
      let disp = step(0.42, gy) * (1.0 - step(0.70, gy));
      let glow = 0.25 + 0.75 * hash11(colIdx * 13.7 + floorIdx + seed);
      alb = mix(alb, mix(vec3f(0.04, 0.045, 0.05), vec3f(0.9, 0.72, 0.5) * glow, 0.55), disp * 0.85);
      emis += vec3f(0.85, 0.66, 0.44) * disp * glow * 1.5 * mix(0.3, 1.0, lights);
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

// ---------------------------------------------------------------- ground

/**
 * A street surface, synthesised per pixel.
 *
 * Everything here is a pure function of world position, the normal, the vertex
 * colour and the instance params — the same pattern `facade()` uses. There is no
 * uv and no texture, and nothing about it needs a GPU-specific feature, so it
 * ports to GLSL unchanged.
 *
 * WHY THE FAMILY COMES OUT OF THE VERTEX COLOUR. The vertex format is full at 12
 * floats and is shared with shadow.wgsl, which has its own copy of VSIn, so no
 * per-vertex attribute can be added; and chunk geometry draws through the
 * identity instance, so there is no per-draw material id either. That leaves
 * `color.rgb` as the only channel that reaches this stage. `groundgrammar.ts`
 * therefore writes each pavement family into a canonical (saturation, value)
 * band and `pavementFamily()` reads it back. The round trip is measured at
 * 66/66 (district, road kind) pairs by `src/world/__selftest.ts`; the bands
 * below are that table, transcribed. If you change one, change both.
 */
struct Ground {
  albedo    : vec3f,
  roughness : f32,
  metallic  : f32,
  emissive  : vec3f,
  occlusion : f32,
};

// Top of the street deck. Must match GROUND_Y in src/world/citygen.ts.
const DECK_Y : f32 = 0.35;
// Paint lift. Must match PAINT_LIFT in src/render/groundbake.ts.
const PAINT_Y : f32 = 0.366;

/** (joint width, pitchU, pitchV, grain frequency) per family, in metres. */
fn pavingParams(f: u32) -> vec4f {
  switch (f) {
    case 0u:  { return vec4f(0.0,   0.0,  0.0,  1.6); }  // asphalt
    case 1u:  { return vec4f(0.020, 0.50, 0.50, 9.0); }  // rubber
    case 2u:  { return vec4f(0.0,   0.0,  0.0,  1.2); }  // dirt
    case 3u:  { return vec4f(0.035, 1.20, 1.20, 2.2); }  // metal-deck
    case 4u:  { return vec4f(0.016, 0.22, 0.19, 7.0); }  // cobble
    case 5u:  { return vec4f(0.025, 0.16, 2.40, 5.0); }  // boardwalk
    case 6u:  { return vec4f(0.022, 0.30, 0.30, 4.0); }  // terracotta-tile
    case 7u:  { return vec4f(0.030, 0.90, 0.60, 3.0); }  // flagstone
    default: { return vec4f(0.020, 2.40, 0.22, 2.0); }  // board-formed
  }
  return vec4f(0.0, 0.0, 0.0, 1.6);
}

/**
 * A joint wide enough to still be a joint at this distance.
 *
 * THE CAUSE of "slab joints and wear do not survive sufficiently to establish
 * close-focus material construction", measured rather than guessed.
 *
 * The joint masks are authored in METRES and never widened: `pavingParams` gives
 * flagstone 0.030, terracotta 0.022, cobble 0.050, so a joint is 1.35-2.7cm of
 * half-width. At fov 1.1 over 1600px that is ~0.69 mrad per pixel, so a 2.2cm
 * flagstone joint passes one pixel at about
 *
 *     0.022 / (1.5 px * 0.00069 rad/px)  ~=  21 m
 *
 * and is gone by 30m. Past that the mask is sampled more than once per pixel,
 * so it averages toward its own mean and the paving flattens into exactly the
 * "visually uniform" surface the reviewer described. Not a contrast problem, and
 * emphatically NOT the deck multiplier — see §deckMul, which is 1.0 for every
 * paving family the reviewer was looking at. It is a sampling problem: a
 * sub-pixel feature cannot be resolved by raising its contrast, only by giving
 * it a floor in screen space.
 *
 * So the width is widened with distance until it reaches ~1.5px. That is a
 * deliberate lie about the world-space joint width, and it is the same trade
 * every procedural paving shader makes: the eye reads the PRESENCE of a joint
 * far more reliably than its exact width, and losing the presence loses the
 * material. Close up `pxW` goes to zero and the authored width is used exactly.
 *
 * The pitch is deliberately NOT scaled, so slabs keep their real size and only
 * the joint grows — which is what a mortar line does as it rakes away anyway.
 */
fn jointFloor(dist: f32) -> f32 {
  // ~1.5 px at fov 1.1 / 1600px wide, in metres at `dist`.
  return dist * 0.00104;
}

/**
 * Cobble stones: (distance to the nearest stone border in cells, stone hash).
 *
 * `worley2()` returns F1, the distance to the nearest feature, and a level set
 * of F1 draws a dot at every stone CENTRE — which is exactly the "fine dots, no
 * coherent courses" the material review saw. The border between two stones is
 * the bisector of their features, so the joint distance is
 * (d2^2 - d1^2) / (2 |o2 - o1|): exact, from squared distances, one sqrt.
 * The field is one continuous lattice; no per-cell phase is added on top.
 */
fn cobbleCells(p: vec2f) -> vec2f {
  let i = floor(p); let f = fract(p);
  var d1 = 8.0; var d2 = 8.0;
  var o1 = vec2f(0.0); var o2 = vec2f(0.0);
  var id = vec2f(0.0);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let o = g + hash22(i + g);
      let r = o - f;
      let d = dot(r, r);
      if (d < d1) { d2 = d1; o2 = o1; d1 = d; o1 = o; id = i + g; }
      else if (d < d2) { d2 = d; o2 = o; }
    }
  }
  let edge = (d2 - d1) / max(2.0 * length(o2 - o1), 1e-4);
  return vec2f(edge, hash21(id + vec2f(17.3, 4.1)));
}

/** World-aligned slab joints (no street frame on the GPU), with a screen-space width floor. */
fn groundJointsD(p: vec2f, pitch: vec2f, joint: f32, dist: f32) -> f32 {
  let f = abs(fract(p / pitch) - 0.5) * pitch;
  let w = max(joint, jointFloor(dist));
  return 1.0 - smoothstep(w * 0.45, w * 1.35, min(f.x, f.y));
}

/**
 * What a street surface looks like.
 *
 * Surface class and family are authored by the emitter. The existing mask
 * channel carries a negative flat payload; nonnegative values remain emission.
 * Colour and height no longer have to impersonate material identity.
 */
fn groundSurface(world: vec3f, n: vec3f, base: vec3f, detail: f32, dist: f32, tag: f32) -> Ground {
  // Negative mask payload is authored at bake time, flat across every primitive.
  // See groundSurfaceTag in groundgrammar.ts; colour remains colour.
  let payload = max(0.0, -tag - 1.0);
  let surface = u32(floor(payload / 16.0));
  let fam = u32(floor(payload)) % 16u;
  let prm = pavingParams(fam);
  let isPaint = fam == 9u;

  let oct = select(2, 3, detail > 0.5);
  let p = world.xz;

  // --- authored surface class (GROUND_SURFACE_CLASSES in groundgrammar.ts).
  let vertical = surface == 2u;
  let isPaintY = surface == 5u;
  let isRaised = surface == 1u || surface == 3u;
  let isGutter = surface == 4u;

  // Value structure between the walking plane and the carriageway.
  //
  // Round 1 multiplied the horizontal deck by 0.62 to separate it from the
  // footway. That was an over-correction, and docs/STREET_SPEC.md section A says
  // why: "the pedestrian surface can be a bright plane" — luminous cyan treads
  // between darker walls in A04, a peach bridge deck in A02 — and in B the
  // "foreground treads are LIGHTER than adjacent dark fronts". Darkening the
  // walking surface pushed against the reference read rather than toward it.
  //
  // The split is now conditional on what the surface actually is:
  //
  //   asphalt / rubber / dirt — a genuinely dirty carriageway. Kept 18% below
  //     the footway so road and pavement stay two things.
  //   everything else — flagstone, cobble, boardwalk, metal deck, terracotta,
  //     board-formed concrete. These are the deck-and-terrace families, and for
  //     them the spec's instruction is to let the whole corridor read as ONE
  //     walking plane. No deck multiplier at all: the corridor becomes
  //     continuous, which is what a timber deck or a paved terrace looks like,
  //     and is the direct opposite of the "universal mid-dark grey road
  //     material" the spec rejects.
  //
  // The footway is lifted in both cases, so the walking plane is the brightest
  // ground surface — the relationship every section in the spec supports.
  //
  // Only the horizontal carriageway is scaled. The kerb face is vertical and
  // carries `kerbAlbedo` at 1.8..2.9x the road; scaling it here would quietly
  // undo `kerbTone` and every measurement of it.
  let dirtyRoad = (fam == 0u || fam == 1u || fam == 2u);
  let isUp = abs(n.y) > 0.5;
  let raised = isRaised;
  let onDeck = isUp && !raised && abs(world.y - PAINT_Y) > 0.006;
  let deckMul = select(1.0, 0.82, dirtyRoad);
  var alb = select(base, base * deckMul, onDeck);
  alb = select(alb, alb * 1.15, isUp && raised);
  var rough = 0.72;
  var metal = 0.0;
  var ao = 1.0;

  // --- shared grain. One octave is all that survives at street range, and it is
  //     what stops any large flat surface reading as a fill.
  let grain = fbm2(p * prm.w, oct);
  alb *= 0.90 + 0.20 * grain;

  if (vertical) {
    // ---------------------------------------------------------------- kerb face
    // The one surface that has to read as a kerb from its own normal. Grime
    // runs down it from the top, the top 15cm catches the light as a chamfer,
    // and the bottom 2cm is dark where it meets the road.
    let top = clamp((world.y - DECK_Y) / 0.20, 0.0, 1.0);
    let streak = fbm2(vec2f(dot(world.xz, vec2f(0.94, 0.34)) * 3.1, world.y * 0.7), 2);
    alb *= 0.80 + 0.34 * streak;
    // Joints every metre along the run, from a world-axis frame — the kerb is
    // 0.3m wide and 1.2m blocks, which is what makes it read as stone units.
    let alongK = select(world.x, world.z, abs(n.x) > 0.5);
    let blockJ = 1.0 - smoothstep(0.012, 0.05, abs(fract(alongK / 1.2) * 1.2 - 0.6));
    alb *= 1.0 - blockJ * 0.30 * (1.0 - top * 0.5);
    // Chamfer highlight and the dark base.
    alb = mix(alb, alb * 1.35 + vec3f(0.02), smoothstep(0.72, 1.0, top) * 0.7);
    alb *= mix(0.55, 1.0, smoothstep(0.0, 0.22, top));
    ao *= mix(0.62, 1.0, smoothstep(0.0, 0.45, top));
    rough = 0.68 - 0.16 * smoothstep(0.7, 1.0, top);
  } else if (isPaintY && isPaint) {
    // ---------------------------------------------------------------- road paint
    // Paint fails at its edges and wears through in the wheel tracks, so the
    // aggregate underneath has to show. Without this a painted line reads as a
    // decal laid on the tarmac rather than 40mm of thermoplastic.
    let wear = fbm2(p * 2.3 + vec2f(11.3, 7.7), 3);
    let edge = smoothstep(0.35, 0.62, wear);
    alb = mix(alb * 1.25, alb * 0.72, edge);
    rough = mix(0.55, 0.80, edge);
    ao *= 0.94 + 0.06 * edge;
  } else if (isGutter) {
    rough = 0.88;
  } else if (isRaised || (surface == 0u && fam != 0u && fam != 1u && fam != 2u)) {
    // ---------------------------------------------------------------- constructed paving
    // Running bond: alternate courses shift half a slab. This replaced a
    // per-cell lattice rotation, which drew unrelated grid fragments per slab.
    let pitch = max(prm.yz, vec2f(0.05));
    let course = floor(p.y / pitch.y);
    let ps = vec2f(p.x + 0.5 * pitch.x * (course - 2.0 * floor(course * 0.5)), p.y);
    let cell = floor(ps / pitch);
    let h = hash21(cell + vec2f(3.17, 9.41));
    var joint = 0.0;
    if (fam == 4u) {
      // Cobble is cellular, not a grid: stone borders are the joints, and each
      // stone carries its own tone so the courses read as separate setts.
      let stone = cobbleCells(p * (1.0 / prm.y));
      let w = max(prm.x, jointFloor(dist));
      joint = 1.0 - smoothstep(w * 0.45, w * 1.35, stone.x * prm.y);
      alb *= 0.84 + 0.30 * stone.y;
    } else if (fam == 6u) {
      // Terracotta: a tight grid with a per-tile hue jitter and a bevel.
      joint = groundJointsD(ps, pitch, prm.x, dist);
      alb *= 0.82 + 0.34 * hash21(cell * 1.7 + vec2f(h, 21.0));
    } else if (fam == 8u) {
      // Board-formed concrete: 0.22m board bands, 2.4m lifts, with the timber
      // grain imprinted in each band.
      joint = groundJointsD(p, prm.yz, prm.x, dist);
      let band = fract(p.y / 0.22);
      alb *= 0.94 + 0.12 * fbm2(vec2f(p.x * 9.0, band * 3.0), 2);
    } else if (fam == 5u) {
      // Boardwalk: planks 0.16m wide, 2.4m long, staggered course to course.
      let stagger = floor(p.x / 2.4);
      let q = vec2f(p.x + stagger * 1.2, p.y) / prm.yz;
      let f = abs(fract(q) - 0.5) * prm.yz;
      joint = 1.0 - smoothstep(0.008, 0.030, min(f.x, f.y));
      alb *= 0.86 + 0.26 * hash21(vec2f(stagger, floor(q.y)));
    } else if (fam == 3u) {
      // Metal deck: 1.2m plates with a chequer relief inside each plate.
      joint = groundJointsD(p, prm.yz, prm.x, dist);
      let cq = abs(fract((p.x + p.y) * 1.6) - 0.5) + abs(fract((p.x - p.y) * 1.6) - 0.5);
      alb *= 0.90 + 0.18 * smoothstep(0.55, 0.95, cq);
      metal = 0.35;
    } else {
      joint = groundJointsD(ps, pitch, prm.x, dist);
      alb *= 0.88 + 0.24 * hash21(cell + vec2f(h * 13.0, 5.0));
    }
    // Joints are darker and hold dirt; they also occlude.
    alb = mix(alb, alb * 0.42 + vec3f(0.004), joint * 0.85);
    ao *= 1.0 - joint * 0.42;
    // Grime banked against the kerb, i.e. toward the carriageway. The footway is
    // raised, so its lower edge is nearer the road: use height, not direction.
    rough = 0.70 - 0.10 * joint;
  } else {
    // ---------------------------------------------------------------- carriageway
    // Worn asphalt: grain, resurfacing patches at a scale you can read from a
    // car but not from an aircraft, polished wheel tracks and standing water.
    //
    // NO CRACK NETWORK, deliberately, and it took two wrong versions to learn
    // why. Thresholding `abs(fbm - 0.5)` draws the ISO-CONTOURS of a smooth
    // field: a topographic map laid on the street, which rendered as thick black
    // loops of spilled oil. Replacing it with a level set of worley F1 was worse
    // in a different way — it draws RINGS AROUND EACH FEATURE POINT, because a
    // cell border is not a level set of the distance to the nearest point. A
    // real crack net needs F2 - F1, and `worley2()` in common.wgsl returns F1
    // only; that file is not mine to change.
    //
    // Both versions read as a DECAL, and a decal on a street reads as a bug
    // rather than as wear. A plain surface with grain, patching and polish is
    // honest and looks like asphalt; a wrong pattern does not. Crack networks
    // are an open item, not a parameter to turn up.
    let resurf = fbm2(p * 0.035 + vec2f(31.0, 17.0), 3);
    alb *= 0.84 + 0.30 * resurf;
    // Polished wheel tracks: two darker, smoother bands either side of the line.
    // The shader cannot know where the centreline is — that is baked geometry —
    // so this keys off a 6m world lattice, the same quantise-and-hash idiom the
    // facade uses for its window bays.
    let cell = floor(p / 6.0);
    let wear = hash21(cell + vec2f(5.7, 2.3));
    let wearBand = 1.0 - smoothstep(0.0, 2.4, abs(fract(p.y / 6.0) - 0.5) * 6.0 - 1.0);
    let track = wearBand * step(0.55, wear);
    rough = mix(0.78, 0.42, track * 0.7 + resurf * 0.25);
    alb *= 1.0 - track * 0.10;
    // Tar seams: the straight lines every resurfacing leaves behind.
    let seam = 1.0 - smoothstep(0.02, 0.09, min(abs(fract(p.x / 24.0 + 0.5) - 0.5) * 24.0,
                                               abs(fract(p.y / 24.0 + 0.5) - 0.5) * 24.0));
    alb = mix(alb, alb * 0.66, seam * 0.28);
    // Standing water in the low-frequency lows. This is what the wetness pass
    // downstream then tightens.
    let pool = smoothstep(0.40, 0.78, resurf);
    rough = mix(rough, 0.12, pool * 0.6);
    ao *= 0.90 + 0.10 * pool;
  }

  var g: Ground;
  g.albedo = max(alb, vec3f(0.0));
  g.roughness = clamp(rough, 0.04, 1.0);
  g.metallic = metal;
  g.emissive = vec3f(0.0);
  g.occlusion = clamp(ao, 0.0, 1.0);
  return g;
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
  // Authored emitters (lanterns 5.5, signs, beacons) keep 15% by day: at full
  // strength a noon lantern saturated to a flat white hexagon.
  var emis = i.color * i.emis * mix(0.15, 1.0, lightsOn());
  var ao = 1.0;
  var alpha = i.tint;

  let detail = F.time.w;

  // Explicit authored tags admit street geometry, including vertical kerbs.
  // Ordinary props and bodies never become paving merely because they are low.
  let isDeckMat = i.matId == MAT_STREET;
  let isChunkDeck = i.matId == MAT_DIFFUSE && i.groundTag < 0.0;

  if (isDeckMat || isChunkDeck) {
    // Distance drives the joint width floor below; without it every paving
    // family flattens to a uniform field past ~25m.
    let gdist = length(F.camPos.xyz - i.world);
    let g = groundSurface(i.world, n, i.color, detail, gdist, i.groundTag);
    base = g.albedo; rough = g.roughness; metal = g.metallic; emis = g.emissive;
    ao *= g.occlusion;
  } else if ((i.matId == MAT_DIFFUSE || i.matId == MAT_PLASTER || i.matId == MAT_BRICK) && i.uv.x >= FACADE_UV) {
    let mirror = select(0.0, 1.0, i.uv.x >= 2.0 * FACADE_UV);
    let r = facade(i.world, n, i.color, i.color * 0.4 + vec3f(0.25, 0.12, 0.05), i.seed, 3.6, detail, mirror);
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
