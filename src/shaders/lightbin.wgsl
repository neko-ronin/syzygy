// ============================================================================
//  lightbin.wgsl — screen-tile binning for local lights.
//
//  Two passes: a clear, then one thread per tile that walks the light list and
//  appends survivors to a shared scratch buffer. With a 16x16 grid over a
//  typical frame the inner loop is short and the lighting pass then only ever
//  touches 0-6 lights per pixel.
// ============================================================================

struct Light {
  posRadius : vec4f,
  colorInt  : vec4f,
};
struct TileLight { offset: u32, count: u32, _pad: vec2u };

const TILE_DIM : u32 = 16u;
const MAX_PER_TILE : u32 = 96u;

struct Bin {
  lights  : array<atomic<u32>, MAX_PER_TILE>,
  count   : atomic<u32>,
  _pad    : array<u32, 3>,
};

@group(1) @binding(0) var<storage, read> lights : array<Light>;
@group(1) @binding(1) var<storage, read_write> bins : array<Bin>;

fn projectPoint(world: vec3f) -> vec3f {
  let c = F.viewProj * vec4f(world, 1.0);
  if (c.w <= 0.0) { return vec3f(-1e9, -1e9, -1e9); }
  let ndc = c.xyz / c.w;
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z);
}

@compute @workgroup_size(64)
fn clear(@builtin(global_invocation_id) gid: vec3u) {
  let tiles = ((vec2u(F.screen.xy) + TILE_DIM - 1u) / TILE_DIM);
  let total = tiles.x * tiles.y;
  if (gid.x >= total) { return; }
  atomicStore(&bins[gid.x].count, 0u);
}

@compute @workgroup_size(64)
fn bin(@builtin(global_invocation_id) gid: vec3u) {
  let tiles = ((vec2u(F.screen.xy) + TILE_DIM - 1u) / TILE_DIM);
  let total = tiles.x * tiles.y;
  if (gid.x >= total) { return; }
  let screen = vec2u(F.screen.xy);
  let tx = gid.x % tiles.x;
  let ty = gid.x / tiles.x;
  let pmin = vec2f(f32(tx * TILE_DIM), f32(ty * TILE_DIM));
  let pmax = min(pmin + vec2f(f32(TILE_DIM)), F.screen.xy);

  // The count of lights actually packed this frame, NOT `arrayLength(&lights)`.
  //
  // `lightBuf` is allocated for `MAX_LIGHTS` and the CPU uploads only what
  // `gatherLights` produced, so every entry past the count is whatever the
  // PREVIOUS frame left there. `arrayLength` therefore walks 3072 entries and
  // bins stale lights: measured, the bin at a market pool centre named indices
  // up to 385 while `stats.lights` was 296, and every one of the 74 it held was
  // 140m away and outside its own radius.
  //
  // Stale entries are worse than empty ones. A zeroed light is skipped by
  // `colorInt.w <= 0`, so it costs nothing — but a light that was real last frame
  // and is not this one still passes that test, gets binned, and is then
  // evaluated against a pixel it no longer belongs to. It cannot be culled by
  // distance because its own radius says it should reach. That is how a bin
  // becomes 74/96 full of lights that are all in the wrong place.
  //
  // The count rides in `F.grade.w`, which was documented as unused. Checked:
  // `F.grade` is read only as `.rgb` in post.wgsl.
  let n = min(u32(F.grade.w), arrayLength(&lights));
  for (var i = 0u; i < n; i++) {
    let l = lights[i];
    if (l.colorInt.w <= 0.0) { continue; }
    // Project the sphere, expand the screen rect, and reject off-screen.
    let c = projectPoint(l.posRadius.xyz);
    if (c.z <= 0.0) { continue; }
    // Screen-space radius: project a point offset by the world radius.
    let edge = projectPoint(l.posRadius.xyz + vec3f(l.posRadius.w, 0.0, 0.0));
    let rad = max(abs(edge.x - c.x) * F.screen.x, abs(edge.y - c.y) * F.screen.y) + 2.0;
    if (c.x + rad < pmin.x || c.x - rad > pmax.x) { continue; }
    if (c.y + rad < pmin.y || c.y - rad > pmax.y) { continue; }

    let slot = atomicAdd(&bins[gid.x].count, 1u);
    if (slot < MAX_PER_TILE) {
      atomicStore(&bins[gid.x].lights[slot], i);
    }
  }
}
