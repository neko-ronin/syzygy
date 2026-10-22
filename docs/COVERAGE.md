# Coverage map

> **Current work, 2026-10-06:** [session and owners](SESSION_2026-10-06.md).
> Corrected hero subject/control is verified in saved frames. Ground, human
> silhouettes and night finish remain open; CPU correctness is not visual
> approval. City richness and 60 FPS traversal are authorised follow-on work
> under R14; neither is implemented or claimed complete by this status update.

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
| 8 | Crowd sim + pedestrians | `partial` — pedestrians render in the corrected hero pair; independent review still finds repeated marker silhouettes. Local query/clearance repairs are in progress with brute-force and movement properties. Earlier draw-counter and night-contrast theories do not describe the current visual gate | R1, R12, [current review](VISION_2026-10-06_SUBJECT.md), [crowd evidence](SESSION_2026-10-06_CROWD.md) |
| 9 | Traffic: trams, trolleys, cable cars, ziplines, blimps, balloons | `done` — instanced from `TrafficSim`, drawn in the shared 24-float layout (D18). Cycle dropped: no entity mesh exists. Distance-culled per kind, no per-mesh LOD. Cable cars were on a tram alignment until round 4. See `docs/TRAFFIC_REPORT.md` | F4 |
| 10 | LLM agent integration (weather/camera/events) | `done` | `src/agent/`, D20 |
| 11 | Destructible structures (GPU fracture) | `not built` | R5 |
| 12 | Vegetation / solarpunk overgrowth + district colour identities | `done` | R9 |
| 13 | Iteration loop: screenshots, perf, notes | `partial` | R10, F6 |
| 14 | **Night market legibility** (added 2026-10-01) | `partial` — six mechanisms refuted, **measurement suspended as the wrong tool** | R2. Five mechanisms refuted with arithmetic; the "12% of predicted" residual was a lit deck compared against **night sky** (round 16 voided it). Validated histogram: frontage R−B **−5.0** vs deck **−3.7** — *both fail identically*. Real shape: a **~2 m pool, +41.5 at 3 m → −4.8 at 4–6 m → −3.3 at 8–10 m**, cords 17–31 m apart. Albedo and `matAo` both exonerated. The proposed lantern-**radius** lever was executed, scored **3 held / 3 failed**, and reverted (`882f434`) — the discriminating prediction (core must not brighten) failed. **Owner correction 2026-10-01: this item is subjective and numeric targets for it were a misuse of rigour.** Six refutations across nine rounds is one finding, not six rounds of progress. Next move is a **frame review**, not another histogram. Rule: derive numbers for aesthetics *after* a reviewer approves a frame, never before |
| 15 | **Crowd dynamics / locomotion** (added 2026-10-01) | `partial` — local movement, nearest-neighbour query, swept body/static clearance and bounded recovery exist and are being verified; the later scene layer and visual motion approval remain open | R12, D26, [current crowd report](SESSION_2026-10-06_CROWD.md) |

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
| Canal water | `bakeGround()` returns a water mesh (`citymesh.ts:898-902`) | **Still PHANTOM, and thinner than described:** nothing is ever pushed into the `w` builder, so the mesh is empty by construction — and no `ground.water` reference exists anywhere in `renderer.ts` (previously cited `renderer.ts:400`, gone to line drift; `renderer.ts:701` uploads `ground.mesh` only). Water as *data* (`waterDepthAt`) is live in lot placement. Re-verified round 5. **The fall zone's flooded lows do not close this row** — see the fall-zone section: those are a ground-surface class on quads that already exist, not a water surface the renderer draws |
| `MAT.WATER` (matId 4) | `src/render/citymesh.ts:40` defines `WATER: 4`; `gbuffer.wgsl:91,715` and `lighting.wgsl:19` give matId 4 a roughness of 0.04 and a sky-reflection branch | **PHANTOM, and a new one.** The shader branch exists and **nothing in `src/` ever sets `MAT.WATER`** — `grep -rn "\.WATER\b" src/` returns no use — so the branch cannot execute. A material id with a consumer and no producer is a name that looks finished. Found 2026-10-20 in [`FLOODED_LOWS_SPIKE.md`](FLOODED_LOWS_SPIKE.md), which rejects using it: matId is a per-mesh `params` value, so reaching it needs a separate mesh and draw per patch, which is the shape of the phantom above |

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
| Street furniture | 46 `CLUTTER_KINDS` emitted by `pushClutterItem`, every box on its placer's yaw. Footways: district kits plus a D30 `lived` list, a kind too deep for the walking line refused (`clutterReach`); alleys carry the lived kit. **148 placed of 157 wanted, 9.3k tris/chunk, budget 12000** (citygen self-test, 2026-10-13). Market spine: D30 islands (`MarketIsland`), 104 at the default seed, clear route measured by `__selftest_footway.ts` | Needs `PropKind` members for the new vocabulary — out of `CLUTTER_KINDS` the emitter has no route into `pushProp`'s kit |
| `PropKind.Zipline` / `.Cable` | Real geometry now (`citymesh.ts` `pushProp`). Measured 60 and 34 tris | Both were in the enum with `PROP_SIZE` entries, never emitted, and **no case in `pushProp`** — they silently rendered as the 0.3-scale metal cube |

### Still a PHANTOM after F5

| Subsystem | What exists | What is missing |
| --- | --- | --- |
| `MeshOpts.emissive` | A per-vertex emissive mask, written by `MeshBuilder.vert`, uploaded at vertex offset 44 | **FIXED.** `gbuffer.wgsl:73` now reads `o.emis = max(v.emissive, v.params.z * v.tint.a)`. It was a dead wire until `bd3d718`. Note that fixing it made the lanterns *glow* without making them *light* anything — see the `windowGlow` row below and `NIGHT_REPORT.md` cause 2 |
| ~~`WeatherDirector.windowGlow`~~ | A per-phase field (`0.18`…`0.85` across the six phases), eased every frame, listed in `EVENT_FX`, asserted by `sim/__selftest.ts` to move | **DELETED.** Nothing read it — `grep` returned `weather.ts` and its own self-test, and changing it was measured to change no pixel. Its comment claimed *"Read by the renderer when shading facades"*, which is what made it a trap: it was named exactly like the control it was not. Removed with the whole `glow` event channel that existed only to carry it (`b.glow.v = look.windowGlow` was its sole source), plus the `power-cycle` event's `l.glow()` write, which also went nowhere. Window emissive is synthesised in `gbuffer.wgsl` at 0.19..5.15 linear and added unscaled in `lighting.wgsl` — there was never a multiplier. **Do not reintroduce one under this name.** |
| **Market lantern hang height** | `STRING_ANCHOR_MIN/MAX`, `STRING_SAG_MIN/MAX` in `marketgrammar.ts` set how high a lantern hangs over the deck | | **FIXED — the cause of unreadable night stalls.** A lantern at 6.3 m puts N·L 1.000 on the deck and 0.353 on a vertical panel 2 m back, a 2.28× penalty on the exact geometry a reader resolves: byte 42 on the deck against byte 19 on the stall face. Raising intensity cannot fix this (it scales both surfaces and preserves the ratio — it only brightens a wash already called excessive). Dropping the cords to ~3.6 m gives 1.50× and byte 77. Guarded in `__selftest_market.ts` §5b, which is the check that would have caught it: every earlier pool test looked only at the deck, which is why the file passed cleanly on an unreadable frame. |
| **Shophouse roof extent** | `marketbake.ts` builds roof members that sit on the ridge *axis*, so baked vertices reach 0.118 m above the declared peak | | **OPEN, minor.** The ceiling guard in `__selftest_market.ts` now derives from `SHOPHOUSE_PEAK_MAX` (6.50 m) rather than accidentally riding on a 9.5 m cord anchor, and exposes a measured 0.118 m residual over 110 vertices, covered by a named `ROOF_EXTENT` allowance. `marketbake.ts` is not owned here; the real fix is for it to declare its own extent. || **Market lantern lights** — eight defects fixed, **gate open pending review** | `marketGrammarFor` emits up to 48 lanterns per carriageway, r=15, I=3. Packed at `LIGHT_FLOATS = 8`; tiles sized from the resolution; `lighting.wgsl` reads the same `struct Bin` the binner writes; binner bounded by the packed count in `F.grade.w`; market lights adjudicated **once per chunk** along the **market spine**, deduplicated across traces, chunk budget 48; **no day cull** — authored lights are light sources, not a function of `dayPhase`. Seed fixed: captures and CPU probes now render the same city. | **Eight silent defects between a produced lantern and a lit pixel, all fixed**: 96B write stride vs 32B struct; 16B read stride vs 400B; `tileBuf` 256 of 5700 bins; `arrayLength` binning last frame's lights; per-trace spending against a per-chunk budget; nearest-to-chunk-centre ordering selecting the market's far end; the deterministic grammar re-derived per trace; and `dayPhase > 0.55` culling every authored light in a night frame. **Measured on seed 6191639** (lantern `c.w +20.05`, pool `c.w +19.97`, both verified before the shot): nearest warm lantern 6.9m, tile at the pool holding 69, `binned 973 starved 0`, `aisleWarmPixelPct` 26.78, and the deck **at** the pool `[41.8,29.9,7.5]` red-dominant against blue-dominant deck 20m either side — a warm region, not a streak. **Gate 3 remains the reviewer's call.** Note `08-night-lanterns` is an aerial *daylight* pose. See [`LIGHT_DELIVERY.md`](LIGHT_DELIVERY.md) §4b–§4f and [`PITFALLS.md`](PITFALLS.md) §19a–19b |
| `BakedChunk.seed` | Computed in `bakeChunk`, documented as "a stable per-chunk tint seed so the fragment stage can vary its detail" | Never reaches the shader. `uploadMesh` allocates `GpuMesh.ib` per chunk and nothing ever binds it; `drawChunks` sets `identityInst` once for all chunks | **2026-10-10:** `facade()` derives a per-building seed from the wall colour (±4% per-building jitter in `pushBuilding`) instead |
| `i.uv` | `float32x2` at vertex offset 24 | **Fixed 2026-10-10.** The stride-3 read is gone (`interleaveMesh`, self-tested). `u >= FACADE_UV` (4096) now marks building-shell walls for `facade()`; nothing else reads it |

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

## The fall zone (DESIGN §8, the sheet-B village)

Added 2026-10-20. This section had no rows at all, which is the failure mode
this map exists to catch: a whole subsystem — a 3 km band of piers, piles and
wreck across the industrial belt — with 151 columns placed, a village rendering
pass landed, and **nothing in this file to say so**. The section is new design
work rather than a checklist item, so it gets its own section.

| Subsystem | What exists | What is missing |
| --- | --- | --- |
| Placement | `src/world/fallzone.ts`: 151 columns per seed (93 pier, 25 core, 17 lattice, 8 silo, 5 stack, 3 spire), 1 deck fragment, 61 bridges, 69 wreck pieces, 25 off-limits patches, 9 ropeways. Grid frame, broken heights, per-column seed. Checked by `src/world/__selftest_fallzone.ts` (`VIOLATIONS none`) | **Done for round 0.** 1 deck fragment and 0.40 bridges per pile against DESIGN's "about one" — an open design item for the owner |
| Village piles | `src/render/fallvillage.ts` (`fae3058`): real stepped piles per kind — piers and cores as rotated container courses on outriggers, a linear village along a silo gallery, a ring on a stack collar, boxes slung in a lattice cage, a terraced crater village in a spire — with corrugation ribs, door leaves, a stepped top, antennas, a water tank on legs and a white tarp. `lod < 2` real boxes, `lod >= 2` merged blocks. Round 1 added faces, weatherRoom dressing and lit panes; round 3a added framed lit bays on every dressed face and rows on the far mass; round 3c put a 2-3 bay row on the LOD 0-1 path; round 3e chooses the row's long face by line of sight (outward, away from the pile's axis). Round 3b added the ground: stair-tower feet, winch houses, core-stair thresholds, salvage workshops, the D30 B kit, wreck ridges/rebar/facade grids and the flooded lows ([`FALL_GROUND_ROUND3.md`](FALL_GROUND_ROUND3.md)) | **Still open:** stairs and ladders, laundry, the revival kit. The lit row is built and judged three times: it renders as separate blocks, not a bar, where it faces the camera (18's id109 at 193 m, 19 at 3 m in 3c), but it is drawn on **one** face per box and only **3 of the six nearest crowns** carry 2+ visible blocks — at most 4 counted generously — against an acceptance of 5 (PART 11). The next change is the row on both long faces. Judged against sheet B: **more work needed** ([`VISION_FALL_BASELINE.md`](VISION_FALL_BASELINE.md)) |
| Pile greybox | **RETIRED.** The flat slab `fallmesh.ts` used to cap every pile at `pileTop` is gone, so the stepped crown is no longer flattened by a lid | — |
| Columns, decks, bridges, wreck, patches | Still plain volumes in `src/render/fallmesh.ts`: concrete shafts, slab spans, catwalk boxes, tilted wreck plates, flat patch quads | Wreck dressing, the ground's working floor, and the off-limits patches' treatments (fenced boards, flood, overgrowth) are round 1-2 |
| Faces on the village | `weatherRoom` (`citymesh.ts:618`) dresses a room — seams, grime skirt, soot runs, framed windows with a lit side pane, railed balcony, roof tarp — and it now runs on the village's own pile boxes too (`fallvillage.ts:425`, round 1), with round 3a/3c/3e adding framed lit bays and a 2-3 bay lit row on the dressed face | **Applied, but on one face per box.** The dressing and the row are drawn on a single long face chosen by line of sight, so a camera that meets the other face sees an undressed box — that is why pose 19 lost its 4-block band in round 3e (PART 11). Not closed |
| Ground lifelines | The ground exists (`bakeGround`, `groundgrammar.ts`); the fall zone's lifelines — stair-tower feet, winch houses, salvage workshops, work lamps, D30's B kit, foot traffic on paths through the wreckage | **Built, round 3b** (`0b52d9d`/`fe6bf11`, `src/render/fallground.ts`, called from `pushFallChunk`): stair-tower feet with landing and rail, winch houses with drum and hoist cable, core-stair thresholds, a salvage workshop at every third winch with three sorted heaps, D30's B kit, ropeway queue rails, one warm work lamp per lifeline. 51,370 tris / 27 chunks, 104 lamps. **Judged at one pose.** Pose 20 stands on the lamp side of the pile at a pool's edge (`8e10f35`), and the work lamp's head — which was buried inside its own hut body — now sits on the door face (`8608fbe`): a legible warm rectangle with a lit wall around it (max R-B 12 → 97). The floor 1-6 m in front of that door is in frame and carries **no** light (R-B −2), and every warm pixel below the horizon belongs to the stall or the canopy row (PART 12). Next: a bracket above the eave so the pool lands on the visible ground. 1,133 lights delivered, 0 starved |
| Flooded lows | The patch quads exist (`fallmesh.ts`, one flat quad per off-limits patch at `GROUND_Y + 0.03`); the standing-water term exists in `gbuffer.wgsl` but only inside the carriageway branch, so a patch quad never reaches it | **Built, round 3b** ([`FALL_GROUND_ROUND3.md`](FALL_GROUND_ROUND3.md)): `'flood'` is class 6, water is 6-8 irregular pools and 2 runnels per flooded patch at `GROUND_Y + 0.075` (above the patch box's `+0.05` top), the normal ripple is applied in `fs` and the flood class is excluded from the weather-wetness pass. **This does not close the canal-water phantom above** — that one is a *drawn water mesh the renderer drops*; this is a *ground-surface class on geometry that already exists*. Two different things. **Pose 20 now points at the floor** (`08ff863`, re-derived to the lamp side in `8e10f35`), and the water reads as a value break with a single-scale concentric ripple and **no reflection of the 572 lit towers behind it**; the lamp on its hut wall lights nothing on the floor (PART 12). The specular is the round after the lamp pool. Not closed |

**The three rows above are built and not `done`, and must not be read as finished
because they compile:** the village carries its dressing and its lit row on **one**
face per box, and the zone's ground is judged at one pose where the lamp lights its
own wall and not the floor (PARTS 11-12). DESIGN §8 lists what is still missing.

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

*Last verified: the fall-zone section and the two phantom rows above were
re-verified against `fae3058` on 2026-10-20, and the fall-zone rows re-read
against the PART 11/PART 12 verdicts at `92e2cef` on 2026-10-22; the rest is as
verified during the audit that produced this file, against commit `66a65df`.
Every status above was read out of the source, not out of another document. If a
row disagrees with the code, the code is right and this file needs the edit.*
