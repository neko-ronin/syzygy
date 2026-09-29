# Syzygy — iteration log

Running notes for the render bring-up. Newest last. The point of this file is
that the next session (or the next model) can read *why* something is the way it
is without rediscovering it from a screenshot.

## Architecture

- `src/core/` — math kernel, GPU device acquisition, the mutable `WorldState`.
- `src/world/` — city generation (chunked, deterministic), district palettes,
  nav graph + rail/zipline networks, CPU mesh builder.
- `src/render/` — the frame graph, mesh baking, GPU helpers.
- `src/shaders/*.wgsl` — concatenated textually by `src/render/wgsl.ts`.
- `src/sim/` — weather director, alternate-transport traffic, crowd.
- `src/agent/` — LLM conductor + a deterministic local brain fallback.
- `src/camera/` — free-flight drone camera, gamepad + keyboard + touch.

## Frame graph

```
shadow (4 cascades, depth only, conventional Z)
  → gbuffer (albedo+rough rgba8, normal+metal rgba16f, emissive+ao rgba16f, depth32f reverse-Z)
  → lightbin (compute, 16x16 screen tiles)
  → lighting (deferred resolve + analytic sky IBL + clustered lights + fog)
  → dof (half-res golden-angle bokeh carrying the tilt-shift band)
  → bloom (threshold → down → additive up)
  → taa (YCoCg neighbourhood clamp + reprojection)
  → composite (lens warp, CA, defocus, halation, tonemap, grade, vignette, grain)
```

## Bugs found and fixed, in the order they were hit

These are all "silent" failures — the app ran, reported plausible stats, and
produced wrong pixels. Each one cost real time; the notes are here so it does
not happen twice.

1. **Reverse-Z depth test inverted.** The G-buffer cleared to `0.0` and used
   `depthCompare: 'less'`, which rejects *every* fragment including the clear.
   Nothing rasterised; the "sky" was the untouched-clear branch of the lighting
   pass. Reverse-Z needs `greater` with a `0.0` clear.
2. **Frame uniform written at float 128 instead of 144.** Nine `mat4` precede the
   `vec4` block in `struct Frame`. Every scalar uniform was shifted by 16 floats,
   so the render target size was being read as weather data.
3. **`prevViewProj` started as a zero-filled `Float32Array`,** not identity. Frame
   0 reprojected every pixel through a null matrix and produced a radial
   starburst. Now identity, plus a hard validity test that discards the history
   when the reprojection lands outside the frame.
4. **Fog was ~99.98% opaque.** The textbook analytic integral of a pure
   `exp(-k*y)` height fog is correct and unusable: over a kilometre of ray it
   reaches ~9 optical depth, so every frame became a flat wash of fog colour.
   Replaced with a bounded `haze * (dist / 900)` model whose height term is
   evaluated at the lowest point of the ray — still pools in the canyon, still
   art-directable, bounded by construction.
5. **The ground plane was never drawn.** `bakeGround` built and uploaded a mesh
   that no pass referenced. Added, with its own instance so it does not get the
   facade treatment (windows synthesised onto a horizontal plane).
6. **Post-pass texture aliasing.** Passes that write a target also bound it as a
   sampled texture. Added a 1×1 black stand-in swapped into any slot that aliases
   the write target.
7. **`debug` was marked `@fragment` and called from `composite`.** WGSL forbids
   calling an entry point; the whole `post.wgsl` module silently failed to
   compile and every post pass became a no-op. Debug views are now a plain
   function. The capture harness now hard-fails on any GPU/WGSL error instead of
   noting it in the footer.
8. **TAA clamped in two different colour spaces at once.** The neighbourhood
   min/max was RGB while the mean and sigma were YCoCg. The bounds crossed zero
   per channel, producing negative green/blue and painting the whole frame red —
   the "rainbow on every surface" and "everything smeared" artefacts. The whole
   resolve is now YCoCg end to end.
9. **Normals were `octDecode`d from an RGB-encoded G-buffer.** The G-buffer stores
   a full `vec3` normal in an `rgba16float` target; decoding it as octahedral
   gave garbage normals, which the environment specular then amplified.
10. **The decisive one: `uploadMesh` used a 3-float stride for vertex colour.**
    The geometry builder writes 4 floats per vertex (rgb + emissive mask), so the
    colour index walked diagonally through the array and decorrelated the
    channels. Every surface in the scene got an arbitrary saturated hue. This is
    what the long "iridescent city" hunt actually was.
11. **Shadow map compared reverse-Z against a conventional-Z sampler.** Now the
    map stays in conventional depth (clear 1.0, `less`) and the lookup converts
    with `1.0 - proj.z`, which keeps the shadow pass on the well-tested
    convention instead of flipping four sign changes.

## Diagnostics built along the way

These exist because guessing from a screenshot was slower than looking.

- `tools/capture.mjs --sequence` — curated pose set; **hard-fails on any GPU or
  WGSL error** so a black screenshot can never be mistaken for a dark scene.
- `--debug=N` / `--debugseq` — dumps each post stage to its own PNG in a single
  run, so stages are strictly comparable.
- `tools/lsp-check.mjs` — drives a real LSP handshake per server.
- `Renderer.probe()` — reads a 3×3 grid out of any internal target, with correct
  half-float decoding. (It was itself wrong twice: an 8-byte `bytesPerRow` is a
  validation error, and all nine samples were being written to offset 0.)
- `stats()` exposes sun, ambient, weather, lens, crowd and traffic so "the
  colours are wrong" is answerable without a debugger.

## Crowd: what actually happened

The crowd now **renders** (verified by framing a known agent from 3.4m — a dense
stream of pedestrians is plainly visible). Getting there took five separate
faults, each of which presented as the same symptom, "no pedestrians":

1. **Recycling gated on a deficit that never recurred.** Agents were seeded once
   and then only recycled when they left the view radius. A free camera sits
   *inside* the population it seeded, so the recycle arm never fired and the
   whole crowd stayed where the camera happened to start. Recycling and
   refilling must be two independent rules that always both run.
2. **`groundAt` returned the roof of the first building containing the point.**
   Since the city is mostly buildings, essentially the entire crowd was placed
   on top of towers, hundreds of metres up. Replaced by street-based placement.
3. **`MAT.DIFFUSE` on a 1.7m pedestrian.** The building facade synthesiser has a
   3.1m x 3.6m window grid, so a person falls entirely inside one cell and is
   shaded as dark glass. Entities need `MAT.PLAIN`.
4. **`roadClearanceAt` sign convention inverted.** `clearance` is
   `dist - width/2`, so it is *negative* inside a carriageway. A hill-climb that
   assumes "positive means on the road" walks confidently away from every street
   and into the middle of blocks.
5. **Snapping to the street *centreline*** collapses the distribution. In a
   dense block the nearest street is the same one for most of the view cone, so
   2500 people pile into a single 11m line. Stepping only as far as the kerb
   preserves the sampled distribution.

The remaining gap is **density, not correctness**: ~1900 people spread over the
street segments within 160m is thin on any one avenue, and the street deck is a
featureless grey slab, so even people who are present do not read.

## Known gaps, in priority order

1. **Street level does not read as inhabited.** The ground plane has no markings,
   no kerb detail, no props at eye height, and the crowd is too sparse on any
   one street. This is the single biggest remaining gap against the reference
   frames.
2. **Traffic is not drawn.** `TrafficSim` produces 129-207 vehicles and 64
   lights, but only pedestrians are submitted through the instanced path.
3. **Night is far too dark.** The night city should be the brightest thing in
   the frame; it is currently a purple murk.
4. **Severe aliasing on distant geometry.** Deferred has no MSAA; TAA is not
   converging within the capture's settle budget. This is the most visible
   remaining *rendering* artefact.
5. **District variety is uneven** — some framings are entirely one district.
6. **Destructible structures, rain, and volumetric god rays** are not
   implemented. The `godRays` and `precip` state exists and drives nothing yet.
7. **Aerial view is 1M+ triangles** and the shadow cascades are the dominant
   cost. Needs LOD above tier 0 and a smaller shadow atlas for the far cascades.

## Capture cost

The sequence takes ~9 minutes for 9 poses, dominated by streaming: the renderer
bakes one chunk per frame under a 4 ms budget, so filling the view is ~60 frames
before the first shot is meaningful. Reducing that is the single biggest win for
iteration speed and is why `--pose=` exists.
