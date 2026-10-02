# Coverage map

A living map from **the original build checklist** to where each item is
actually covered in this repository.

It exists to answer one question that nothing else does:

> **Is every part of the plan accounted for, and does each part have an owner?**

`ORIGINAL_PROMPT.md` maps the *clauses of the brief* to where they live.
`ROADMAP.md` ranks *outcomes* by visual impact. `HANDOFF.md` holds the current
work items. None of them notice a subsystem that quietly stopped existing.

The build checklist below came from the first session's chat pane and was never
committed. That is why it went stale — items 1–7 were done but still marked
`[ ]` — and why three phantoms survived three sessions. Its marks were never
wrong by accident; nobody could see them.

---

## How to maintain this

**This file grows; it does not get rewritten.** When you add a feature, add a
row. When you discover a subsystem nobody owns, that is the most valuable thing
you can add here.

1. **Every row names an owner** — an `R`-item, an `F`-item, a `D`-decision, or
   the explicit word `UNOWNED`. A row with no owner is the output of this file.
2. **Link, do not restate.** If a row repeats a status that `ROADMAP.md` owns,
   the two will drift. Point at it and let that file hold the status.
3. **Every claim here is verified, not remembered.** Each row was checked
   against the source during the audit below. If you change a status, re-check
   the code first — the point of this file is that it cannot be wrong by
   assumption.
4. **Adding a sub-detail is normal and expected.** Most rows will accumulate
   children as a subsystem grows. Add them as they appear.

**Status vocabulary** — deliberately narrow, because the interesting cases are
the ambiguous ones:

| Status | Means |
| --- | --- |
| `done` | Implemented **and** verified by rendering it |
| `partial` | Some sub-details done; children say which |
| `not built` | No implementation. Named files are scaffolding only |
| `unverified` | Exists, correctness not re-confirmed since it was written |
| **`PHANTOM`** | **A name exists with no system behind it.** Reads as done, does nothing |

`PHANTOM` is its own status because it is the dangerous one: it survives review,
it satisfies a grep, and it will be believed.

---

## The 13 build items

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Scaffold: Vite+TS, WebGPU init, headless screenshot harness | `done` | [`HANDOFF.md`](HANDOFF.md) |
| 2 | Math/noise lib + core GPU abstraction | `done` | `src/core/math.ts`, `src/core/gpu.ts` |
| 3 | City generation: districts, canyons, buildings, skybridges | `done` | R9, D14, D15 |
| 4 | Deferred renderer: G-buffer, clustered lighting, painterly shading | `done` | D5, D17 |
| 5 | Atmosphere: volumetric fog, god rays, sky, weather | `partial` | R6 |
| 6 | Camera: free flight + gamepad/keyboard + tilt-shift/roll/FOV | `done` | `src/camera/`, D16 |
| 7 | Post stack: TAA, bloom, DOF, CA, grade | `done` | `src/shaders/post.wgsl` |
| 8 | Crowd sim + pedestrians | **`unverified` — but the suspected cause is eliminated** | F1, F2, F3. `entityDrawCalls` read 0 in every capture while `entityTriangles` read hundreds of thousands, which read as "counted, never issued" and was taken to be R1's cause. It was not: `counter.entity` is incremented only in `drawEntitySet`, which has **no callers** — the crowd and fleet go through `main.ts`'s own `drawEntityBlock`. A nonzero `entityTriangles` can only come from the branch that calls `drawIndexed`, so the draws were always issued (measured 356480 tris / 0 calls before, 330512 / 4 after). **The counter was the lie.** What makes the crowd illegible is still open and is most likely the night contrast — 1.28:1 against a 2.5:1 threshold, unliftable by palette because `skyIrradiance` multiplies coat and deck by the same ambient. That now has a frame with lights in it to be measured against |
| 9 | Traffic: trams, trolleys, cable cars, ziplines, blimps, balloons | `done` — instanced from `TrafficSim`, drawn in the shared 24-float layout (D18). Cycle dropped: no entity mesh exists. Distance-culled per kind, no per-mesh LOD. Cable cars were on a tram alignment until round 4. See `docs/TRAFFIC_REPORT.md` | F4 |
| 10 | LLM agent integration (weather/camera/events) | `done` | `src/agent/`, D20 |
| 11 | Destructible structures (GPU fracture) | `not built` | R5 |
| 12 | Vegetation / solarpunk overgrowth + district colour identities | `done` | R9 |
| 13 | Iteration loop: screenshots, perf, notes | `partial` | R10, F6 |
| 14 | **Night market legibility** (added 2026-10-01) | `partial` — six mechanisms refuted, **measurement suspended as the wrong tool** | R2. Five mechanisms refuted with arithmetic; the "12% of predicted" residual was a lit deck compared against **night sky** (round 16 voided it). Validated histogram: frontage R−B **−5.0** vs deck **−3.7** — *both fail identically*. Real shape: a **~2 m pool, +41.5 at 3 m → −4.8 at 4–6 m → −3.3 at 8–10 m**, cords 17–31 m apart. Albedo and `matAo` both exonerated. The proposed lantern-**radius** lever was executed, scored **3 held / 3 failed**, and reverted (`882f434`) — the discriminating prediction (core must not brighten) failed. **Owner correction 2026-10-01: this item is subjective and numeric targets for it were a misuse of rigour.** Six refutations across nine rounds is one finding, not six rounds of progress. Next move is a **frame review**, not another histogram. Rule: derive numbers for aesthetics *after* a reviewer approves a frame, never before |
| 15 | **Crowd dynamics / locomotion** (added 2026-10-01) | `not built` — diagnosed only | R12. Density (R1) and behaviour (R12) split deliberately. Standing numbers: `viewRadius` is the seeding limit; the **≥40 px gap bin is empty**. Gate 5 measured isolated silhouettes at 22×9 and 23×11 px with 20 clear px columns — those clear the target, packed rows do not, so **mesh proportions and placement are two open causes and neither alone will fix it** |

Two departures from the checklist as written. Both are deliberate, both are
recorded in `DECISIONS.md`, and **neither is outstanding work**:

- **Item 8 says "GPU compute". The crowd runs on the CPU** in structure-of-arrays
  (D8). It simulates 6,000 agents in ~2 ms/frame. This is a considered
  trade-off, not a shortfall — the checklist assumed an implementation detail
  rather than stating a requirement.
- **Item 4 is WebGPU-only; there is no WebGL 2 half.** The brief asked for both
  backends. The human owner ratified WebGPU-only on **2026-10-01** — *"we're
  shelving webgl 2. we're going all in on webGPU."* — and it was confirmed
  against the source that this is what has always been built: six `.wgsl`
  shaders and no GLSL anywhere, `getContext` called with `'webgpu'` and `'2d'`
  and never `'webgl2'`, and a hard-fail (`gpu.ts:74`, surfaced by `main.ts:64`)
  rather than a fallback. This was
  previously written up here as *the one outright deviation*, which made a
  settled scope decision look like a shortfall. It is not: it is closed, and the
  decision plus its cost live in [`DECISIONS.md`](DECISIONS.md) **D1**, with
  **R8** in the roadmap holding the reasoning. **The cost is not zero — anyone
  without WebGPU sees nothing.** Row 4 above stays `done` because the row
  describes the renderer, and the renderer exists; the deleted WebGL 2 half is
  out of scope by decision, not unimplemented.

Note the direction of the error this row used to carry: a *truthful* cost
("anyone without WebGPU sees nothing") attached to a *false* status ("the one
outstanding deviation"). Splitting them is the fix — the cost is now stated in
D1 and R8 where a decision belongs, and the checklist row reports only whether
the renderer was built.

---

## The phantoms

Found during the audit by checking each row against the source instead of
against a filename. Each has a name, wiring, or a tool that makes it look done.

`godRays` was closed in `6a47405` and its row is struck through rather than
deleted, because the failure mode is worth remembering: **it stayed invisible
because every reference pose frames the city with the sun off-screen**, so even
a correct pass would have been absent from the comparison grid. A feature that
no pose can see is a feature nothing will ever ask you to finish.

None of these were caught in three sessions. Everything in the doc set was
organised around *what to do next*; nothing was checking *what was planned and
where it went*.

| Subsystem | What exists | What is missing |
| --- | --- | --- |
| ~~`godRays`~~ **RETIRED** | A weather field, written to the `weather2` uniform. Set by poses and by the LLM's `set_weather` | **Closed `6a47405`.** `shafts` in `post.wgsl` reads `weather2.y`; half-res radial scatter occluded by the depth buffer, composited after the resolve. `stats.shafts` and a static guard in `__perftest.ts` keep it honest. See [`WATER_AND_VOLUMETRICS.md`](WATER_AND_VOLUMETRICS.md) |
| `precip` | `weather3.w` (`common.wgsl:26`) | **No shader reads `weather3.w`.** No precipitation renderer |
| ~~`structure-collapse`~~ **REMOVED** | Was an `EventKind` (`core/state.ts`), a tool (`agent/tools.ts`), local-brain triggers, a `/event` entry, and a weather handler grading dust/haze — with no fracture renderer behind any of it, so a collapse request returned a success receipt while nothing came down | **Excised, not built** (R5 keeps the fracture renderer as its own scope): kind removed from the state union, tool vocab and labels, local brain (collapse utterances now get an honest refusal with zero tool calls — verified), `/event` list, weather durations/tags/handlers, and the sim self-test list. `grep structure-collapse src/` returns nothing. Building it would be R5, briefed separately |
| `debrisChunk()` | Defined at `citymesh.ts:900` | Never called. The GPU debris field R5 depends on does not exist |
| Canal water | `bakeGround()` returns a water mesh (`citymesh.ts:898-902`) | **Still PHANTOM, and thinner than described:** nothing is ever pushed into the `w` builder, so the mesh is empty by construction — and no `ground.water` reference exists anywhere in `renderer.ts` (previously cited `renderer.ts:400`, gone to line drift; `renderer.ts:701` uploads `ground.mesh` only). Water as *data* (`waterDepthAt`) is live in lot placement. Re-verified round 5 |

Two consequences worth stating plainly:

- **The LLM will lie by omission.** `structure-collapse` is a registered tool.
  Natural language asking for a collapse succeeds and does nothing. This is the
  D20 event system working as designed with nothing behind it.
- **`godRays: 0.4` in the `01b` pose config** suggests an effect that is not
  being drawn. Reading a pose config as evidence of a feature is exactly the
  mistake this file exists to prevent.

### Incidental finding

`renderer.ts:402` assigns `this.entities = { ground: ... }`, and line 403
immediately overwrites it. A dead store, harmless to output, but it is the kind
of leftover that implies a ground entity exists when it does not. Not on the
roadmap; fold it into the next pass over that function.

---

## Ground surface (F5)

Street-level work. Added as its own section because the interesting failure here
was not "not built" — it was **built, and wrong in a way that rendered
plausibly**, which is the class of fault this map exists to catch.

| Subsystem | What exists | What is missing |
| --- | --- | --- |
| District ground colour | `DistrictPalette.ground`, the 6th hex arg of `pal()`, since the first commit. Wired at `groundgrammar.ts` `groundGrammarFor` → `bandAlbedo` → `bakeGroundDetail` / `pushGroundDeck` | Was **read by nothing** until F5. Eleven authored ground colours had never reached a pixel |
| Ground grammar | `src/world/groundgrammar.ts`: 9 pavement families, 6 kerb styles, 6 marking styles, 11 district entries + road-kind sharpening, `CLUTTER_KINDS`, `streetFrameAt` | — |
| Kerbs / footways / paint | `src/render/groundbake.ts`, baked per chunk into the chunk's solid builder from `sampleStreetPlan`. Measured: **+8897 tris/chunk (+11.3%), kerb p50 0.01m / p90 1.00m from the carriageway edge** | The lod tiers are correct but **inert**: `renderer.ts:618` calls `bakeChunk(chunk, 0, seed)` unconditionally |
| Per-pixel surface | `groundSurface()` in `gbuffer.wgsl`: family-specific grain, slab joints, cobble worley, plank lines, board-formed bands, chequer plate, kerb faces, worn paint | **World-axis lattice only.** The GPU cannot build a street-aligned frame — the street field is CPU-only by design — so paving runs on world X/Z with a per-cell hash rotation |
| Street furniture | 20 `CLUTTER_KINDS` emitted by `pushClutterItem` with correct street-facing yaw. **182 placed of 182 wanted, 7923 tris/chunk** | Needs `PropKind` members for the new vocabulary — out of `CLUTTER_KINDS` the emitter has no route into `pushProp`'s kit |
| `PropKind.Zipline` / `.Cable` | Real geometry now (`citymesh.ts` `pushProp`). Measured 60 and 34 tris | Both were in the enum with `PROP_SIZE` entries, never emitted, and **no case in `pushProp`** — they silently rendered as the 0.3-scale metal cube |

### Still a PHANTOM after F5

| Subsystem | What exists | What is missing |
| --- | --- | --- |
| `MeshOpts.emissive` | A per-vertex emissive mask, written by `MeshBuilder.vert`, uploaded at vertex offset 44 | **FIXED.** `gbuffer.wgsl:73` now reads `o.emis = max(v.emissive, v.params.z * v.tint.a)`. It was a dead wire until `bd3d718`. Note that fixing it made the lanterns *glow* without making them *light* anything — see the `windowGlow` row below and `NIGHT_REPORT.md` cause 2 |
| ~~`WeatherDirector.windowGlow`~~ | A per-phase field (`0.18`…`0.85` across the six phases), eased every frame, listed in `EVENT_FX`, asserted by `sim/__selftest.ts` to move | **DELETED.** Nothing read it — `grep` returned `weather.ts` and its own self-test, and changing it was measured to change no pixel. Its comment claimed *"Read by the renderer when shading facades"*, which is what made it a trap: it was named exactly like the control it was not. Removed with the whole `glow` event channel that existed only to carry it (`b.glow.v = look.windowGlow` was its sole source), plus the `power-cycle` event's `l.glow()` write, which also went nowhere. Window emissive is synthesised in `gbuffer.wgsl` at 0.19..5.15 linear and added unscaled in `lighting.wgsl` — there was never a multiplier. **Do not reintroduce one under this name.** |
| **Market lantern hang height** | `STRING_ANCHOR_MIN/MAX`, `STRING_SAG_MIN/MAX` in `marketgrammar.ts` set how high a lantern hangs over the deck | | **FIXED — the cause of unreadable night stalls.** A lantern at 6.3 m puts N·L 1.000 on the deck and 0.353 on a vertical panel 2 m back, a 2.28× penalty on the exact geometry a reader resolves: byte 42 on the deck against byte 19 on the stall face. Raising intensity cannot fix this (it scales both surfaces and preserves the ratio — it only brightens a wash already called excessive). Dropping the cords to ~3.6 m gives 1.50× and byte 77. Guarded in `__selftest_market.ts` §5b, which is the check that would have caught it: every earlier pool test looked only at the deck, which is why the file passed cleanly on an unreadable frame. |
| **Shophouse roof extent** | `marketbake.ts` builds roof members that sit on the ridge *axis*, so baked vertices reach 0.118 m above the declared peak | | **OPEN, minor.** The ceiling guard in `__selftest_market.ts` now derives from `SHOPHOUSE_PEAK_MAX` (6.50 m) rather than accidentally riding on a 9.5 m cord anchor, and exposes a measured 0.118 m residual over 110 vertices, covered by a named `ROOF_EXTENT` allowance. `marketbake.ts` is not owned here; the real fix is for it to declare its own extent. || **Market lantern lights** — eight defects fixed, **gate open pending review** | `marketGrammarFor` emits up to 48 lanterns per carriageway, r=15, I=3. Packed at `LIGHT_FLOATS = 8`; tiles sized from the resolution; `lighting.wgsl` reads the same `struct Bin` the binner writes; binner bounded by the packed count in `F.grade.w`; market lights adjudicated **once per chunk** along the **market spine**, deduplicated across traces, chunk budget 48; **no day cull** — authored lights are light sources, not a function of `dayPhase`. Seed fixed: captures and CPU probes now render the same city. | **Eight silent defects between a produced lantern and a lit pixel, all fixed**: 96B write stride vs 32B struct; 16B read stride vs 400B; `tileBuf` 256 of 5700 bins; `arrayLength` binning last frame's lights; per-trace spending against a per-chunk budget; nearest-to-chunk-centre ordering selecting the market's far end; the deterministic grammar re-derived per trace; and `dayPhase > 0.55` culling every authored light in a night frame. **Measured on seed 6191639** (lantern `c.w +20.05`, pool `c.w +19.97`, both verified before the shot): nearest warm lantern 6.9m, tile at the pool holding 69, `binned 973 starved 0`, `aisleWarmPixelPct` 26.78, and the deck **at** the pool `[41.8,29.9,7.5]` red-dominant against blue-dominant deck 20m either side — a warm region, not a streak. **Gate 3 remains the reviewer's call.** Note `08-night-lanterns` is an aerial *daylight* pose. See [`LIGHT_DELIVERY.md`](LIGHT_DELIVERY.md) §4b–§4f and [`PITFALLS.md`](PITFALLS.md) §19a–19b |
| `BakedChunk.seed` | Computed in `bakeChunk`, documented as "a stable per-chunk tint seed so the fragment stage can vary its detail" | Never reaches the shader. `uploadMesh` allocates `GpuMesh.ib` per chunk and nothing ever binds it; `drawChunks` sets `identityInst` once for all chunks |
| `i.uv` | `float32x2` at vertex offset 24 | **Garbage.** `uploadMesh` reads the uv array with a 3-float stride (`v3 = i * 3`) when it is written 2 floats per vertex. Nothing reads it; nothing should |

### The measurement that had to be taken first

`sampleStreetPlan` **is not a distance field.** For the grid and alley families
it evaluates the domain warp `warpAt(x, z)` at the *query point*, so `out.dist`
is the distance to a line whose position depends on where you asked from, with a
warp gradient of roughly 1.5 m per metre. Consequences, all measured:

- A perpendicular offset of `width/2` does not land at distance `width/2`. That
  is why the kerb edge is **found** (one field query per segment) rather than
  computed.
- `makeBuilding`'s setbacks are computed from a `clearance` that is not a
  distance, so buildings sit further back from a carriageway than their
  footprints suggest. **Not fixed** — `citygen.ts` is out of scope for F5, and it
  is the highest-value follow-up this work found.

### Also true, and still true

`HANDOFF.md` records that a review agent reported 3 `tsc` errors in
`gpuutil.ts` that "could not be reproduced". **They reproduce, and the reason is
that the documented check does not use the project's own compiler:**
`npx tsc` resolves to a globally installed **TypeScript 7.0.2** at
`/opt/homebrew/bin/tsc`, which is stricter about `readonly` arrays in overload
resolution. `./node_modules/.bin/tsc` — the project's pinned **5.9.3** — is
clean. Neither agent was wrong; they ran different compilers.

---

## Adding rows

The phantoms above were all found by asking "what did the plan include,
and is each part actually there?" The checklist had 13 items and the map found
gaps inside 5 of them. The sub-details are where the real growth is:

- **As a subsystem grows, add a child row per capability**, with the same three
  questions: is it named, is it wired, does anything consume it?
- **When a feature is added, add it here** — even if it is small, and especially
  if it was not on the original checklist. The map is for the project as it
  stands, not as it was planned.
- **When you retire something, delete its row** rather than marking it done. A
  map full of completed rows stops being read.

*Last verified: during the audit that produced this file, against commit
`66a65df`. Every status above was read out of the source, not out of another
document. If a row disagrees with the code, the code is right and this file
needs the edit.*
