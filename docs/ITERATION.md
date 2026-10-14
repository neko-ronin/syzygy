# Syzygy — iteration log

Chronological record of the render bring-up: what changed, and why it was
invisible. Newest last.

**For the current state, read [`HANDOFF.md`](HANDOFF.md). For what to do next,
[`ROADMAP.md`](ROADMAP.md). For how to work here,
[`PITFALLS.md`](PITFALLS.md) and [`PROCEDURES.md`](PROCEDURES.md).**

This file is the historical record — it is what a future session reads to
understand why the code looks the way it does.

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

## Crowd placement

Five separate faults all presenting as "no pedestrians", each documented in
[`PITFALLS.md`](PITFALLS.md) §9–13. Short version: the crowd now renders and is
placed on real streets; the remaining gap is density, not correctness.

## WebGPU-only: a decision that nine files were still describing as open

Recorded 2026-10-01. The human owner settled the backend question — *"we're
shelving webgl 2. we're going all in on webGPU."* — and the second sentence was
a question, so it was checked rather than answered from the docs: WebGPU is the
only renderer that has ever existed here. Six `.wgsl` shaders and no GLSL
anywhere; `getContext` called with `'webgpu'` and `'2d'` and never `'webgl2'`;
`gpu.ts:74` throws rather than falling back.

The interesting part is what that left behind. `BackendKind` was
`'webgpu' | 'webgl2'`, but nothing ever constructed a `'webgl2'` — the only
producer of `Caps.backend` was the literal `'webgpu'`. `package.json` advertised
`WebGPU/WebGL2` to anyone who opened the repository. The module doc comment in
`gpu.ts` described a GL path in the present tense, with GLSL ES 3.00 and
transform feedback, as though it were implemented. Nine documents framed a
settled scope decision as an outstanding deviation from the brief.

**None of it threw, and every check passed.** That is the whole failure mode, and
it is the one [`PROCESS.md`](PROCESS.md) rule 5 names: *a name, a uniform slot, a
registered tool, or a config value is not a feature — it is a claim that
something exists.* A union member is a claim. A package description is a claim.
Each was individually plausible and each was greppable, so no single session
tripped over the contradiction; it took a human decision to make the
accumulation visible. A reader arriving from the package description would
reasonably have concluded the project had two renderers.

The fix kept the decision's cost visible rather than deleting the inconvenient
part: **anyone without WebGPU sees nothing.** That is now stated in D1, R8, and
the places a reader will actually look, and it is framed as accepted rather than
as a shortfall. The three portability comments (`src/render/cascade.ts`,
`src/shaders/post.wgsl`, `docs/WATER_AND_VOLUMETRICS.md`) were deliberately left
alone — shelving the backend does not retract the owner's interest in porting to
three.js or WebGL 2, and those comments are the reason the design can move.

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

## Public build, viewpoints, blue hour (2026-10-14)

D31 has the why. What changed and what it uncovered:

- `npm run build:web` / `npm run deploy` build the public site (`STATIC_SITE`): no
  conductor, stats, tool buttons, controls help, quality toasts or `__syzygy`; URL
  parameters ignored. Kept: compass, crosshair, flight, `P`, `H`, and the new viewpoints.
- Viewpoint strip and keys 1-8 in every build; the showcase clock in the public build only.
- New `bluehour` phase rig and sky ramp in every build; `set_time`, `/time`, the local
  brain ("blue hour", "twilight") and `phaseNameOf` know it.
- **Found while measuring, all pre-existing:**
  - `phaseOf` named the pre-dawn sky `dusk` (rising test was `az < PI/2`, but before
    sunrise az is just under 2PI). Real-time day order is now asserted in the sim self-test.
  - The first frame after boot, or after any synchronous warm, ran with a negative `dt`
    (rAF frame-start stamp earlier than a `performance.now()` `last`). Harmless-looking at
    1x; at 20x it inverted the integrator's ease and threw the sun to -7 rad. Clamped at 0.
  - The compass clock was read from `dayPhase` (a height), so every afternoon ran backwards.
    Now from azimuth.
  - `#console` had no `position: fixed`, so it was always on screen; that hid the next one.
  - `T` and the console button were bound by both `main.ts` and `ConductorUI`, so each press
    opened and closed the panel. The conductor could not be opened. `ConductorUI` owns both.
  - `tools.ts` kept its own copy of `phaseOf` that had drifted (`az < PI`). It calls
    `phaseOf` now.
