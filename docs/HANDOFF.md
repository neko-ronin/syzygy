# Handoff

**Read this first, then [`ROADMAP.md`](ROADMAP.md) for what to work on,
[`COVERAGE.md`](COVERAGE.md) for what is quietly missing,
[`PITFALLS.md`](PITFALLS.md) before you touch the renderer, and
[`DECISIONS.md`](DECISIONS.md) before you change the architecture.**

> ### If you are starting a new session: read §0 first.
>
> The 2026-10-01 session ended by correcting itself. Nine rounds were spent
> inventing numeric targets for a **subjective** question — whether the night
> market reads as a lit place — instead of asking a reviewer to look at a frame.
> Six mechanisms were proposed, all six refuted, and each refutation was reported
> as a successful round. `PROCESS.md` rule 1 now scopes measurement to questions
> that have a right answer, and rule 9 says *a refutation is not a successful
> round*.
>
> Full record, open items with owners, and the three questions for the owner:
> **[`SESSION_2026-10-01.md`](SESSION_2026-10-01.md)**.
>
> **Working with more than one agent?** Read
> [`WORKFLOW.md`](WORKFLOW.md) first — agent specialties and hard limits, dispatch
> by file ownership, capture and GPU budgets on this machine, drift checks,
> platform thresholds, and the session ceremony.

## 0. The one thing that changed this project's process most recently

**Do not measure toward a target that was invented rather than derived.**

The owner, closing the 2026-10-01 session:

> Applying hard quantifiable scores toward a goal that is considered subjective,
> on a product that isn't yet remotely presentable let alone MVP, is not an
> acceptable practice.

This is not an argument against rigour — `PROCESS.md` rule 1 is unchanged for
bugs, and every significant finding in this project came from measuring rather
than reasoning. It is an argument against **substitution**: warm/cool separation
is a proxy for "does this look like a market", and six rounds were spent moving
the proxy because proxies are measurable.

Consequences already written down:

- `PROCESS.md` rule 1 — "…but only where there is a right answer"
- `PROCESS.md` rule 9 — "a refutation is not a successful round"
- `PITFALLS.md` §21 — four mechanisms killed by measurement, and the substitution
  behind each
- `ROADMAP.md` R2 — the next move for the night market is **a frame review**, and
  its recorded prediction is marked superseded rather than left standing

## Where things stand

Two sessions of audit and design work sit on top of the build: `27f3b66`
(renderer bring-up), `1481e47` (crowd), `0e90072` (documentation set), then
`a893dbe` onward. The renderer and world are unchanged in behaviour except for
the building-frame fix described below.

**Three things a new session should know exist**, because they did not before:

- **[`DESIGN.md`](DESIGN.md) is the art direction**, and it was missing entirely
  until now. Districts existed as authored data with no recorded design intent.
  The target finish is painterly-and-graphic, detailed at close focus;
  "hyperreal" is *exaggerated and stylised*, not photoreal (D23).
- **`references/` holds curated per-section reference sheets** and
  `references/sections.json` is the machine-readable contract. `compare.mjs
  --auto` judges each pose against the sheet for the section it belongs to. The
  reference *videos* are not in git (D22) — a fresh clone gets the sheets only.
- **[`DESIGN.md`](DESIGN.md) §6 is a mandatory review gate.** No task closes
  without a second agent opening the reference and the output and returning
  `done` or `more work needed`. The implementer may not self-certify.

**One substantial render bug was found and fixed** — the bottom half of every
building was never emitted, because the setback tier loop started at the
building's *centre* rather than its base. Towers stood on plinths and ribs like
stilts. Six faults in total, all the same root cause; see
[`PITFALLS.md`](PITFALLS.md) §17. It survived several rounds of review because
**no pose in the harness could frame ground contact** — which is the general
lesson, and why `01a-building-base` now exists.

Two open threads the last session did not close:

- A review agent reported 3 pre-existing `tsc` errors in `src/render/gpuutil.ts`.
  **They reproduce, and neither agent was wrong: they ran different compilers.**
  `npx tsc` resolves to a globally installed TypeScript **7.0.2** at
  `/opt/homebrew/bin/tsc`, which is stricter about `readonly` arrays in overload
  resolution; the project's own pinned **5.9.3** at `./node_modules/.bin/tsc` is
  clean. The documented check `npx tsc --noEmit` is therefore **not pinned** and
  its result depends on what is installed globally. Use `./node_modules/.bin/tsc`
  --noEmit for a stable answer.
- `package.json` no longer says "hyperreal" in its description (the human author
  edited it), while `D23` and [`GLOSSARY.md`](GLOSSARY.md) still use the word and
  define it. Consistent with redefining rather than removing; not reconciled.

---

## Open work items — read this before starting

Six proposed fixes, in dependency order. F1 and F2 are **measure-first**: neither
may be closed by reading code and deciding which side looks right.

**Status.** **F1, F3, F4 and F5b are closed.** Each section below carries the
commit or the printed number that closed it, and F3's harness line is gone.
**F2 is still open**: the poses point at the crowd, the CPU counters agree and
the pavement hold no longer teleports bodies, but pedestrians still do not
rasterise — that half is `src/render/`.

Items not marked closed are unchanged. Each states the evidence, the proposed
fix, and the check that proves it closed.

### F1 — The crowd's two visibility predicates disagreed — **CLOSED, measured**

**Cause.** Not staleness, not a mid-frame `viewRadius` write, not frame parity.
The predicate was simply **evaluated twice against two different states**.
Pass B counted an agent against its *pre-step* position, `stepAgent` then moved
it, and `buildInstances` re-tested the *post-step* position. An agent the step
moved across the radius boundary was counted by one and dropped by the other.

The mover is the **pavement hold** in `stepAgent` — an unconditional positional
projection, `nx += nxx * d; nz += nzz * d`, applied to `d = lateral + wob - lat`.
It is not a velocity term and it is **not scaled by `dt`**. Measured with
`dt = 0` (velocity contributes exactly nothing): agents still moved **185 m in
one frame** and **1013 of them were still lost** over 30 frames. That control is
what kills "a pedestrian simply walked out of frame".

**Evidence.** 30 consecutive frames, flying camera, seed 42, camera derived from
`crowd.population()` (rule 4 — the first rig run pointed at the world origin
because `population()` is 0 before warm-up, which is `PITFALLS` §16 all over
again). `pop.n = 2550`, `viewRadius = 160`, `r² = 25600`.

```
  frame | visibleCount | instances.count | lost | identity | first agent counted then dropped
     16 |         2545 |            2522 |   23 |      yes | #13  passD2=25370 nowD2=26367 speed=210.18 lateral=-17.05
     24 |         2434 |            2327 |  107 |      yes | #132 passD2=25361 nowD2=26417 speed=231.86 lateral=-21.49
```

`visibleCount − lost == instances.count` held on **30/30 frames**, in both the
flight run and the `dt = 0` control. 17 of 30 frames lost something; 1032
agents were lost over 30 frames, up to **107 in a single frame**. Intermittency
is positional, not periodic: 0 lost while the crowd sits wholly inside the
radius, tens to hundreds lost once the camera flies through the rim. That is why
it reproduced on 8 of 11 poses.

All three candidate causes in the old F1 text are **refuted by that identity
holding 30/30**: `d.b` never collided (`det = 1`, `|col0| = 1` on every sampled
instance); the `if (n >= cap) break` guard could not fire (`n ≈ 2400` against
`cap = 6000`); and `buildInstances` ran *after* `rebuildSlices`, not before —
an independent reconstruction of its predicate from a post-frame snapshot
matched `instances.count` on 30/30 frames.

**Fix.** The instance record is now written inside Pass B, by `writeInstance`,
under the same guard and the same radius test that produced the count. The two
counters are one quantity by construction, not by luck — and it costs *less*,
because the population is scanned once per frame instead of twice. The
`n >= cap` guard is gone because it is no longer reachable: at most one record
per iteration of a loop bounded by `capacity`, into a buffer of
`capacity * INSTANCE_FLOATS`.

**After.** 30/30 agreement, `dt = 1/60` **and** `dt = 0`, including the frames
that previously lost 107 and 99:

```
  frame | visibleCount | instances.count | agree
     16 |         2545 |            2545 |  yes      (was 2545 / 2522)
     24 |         2434 |            2434 |  yes      (was 2434 / 2327)
  RESULT: the two counters agree on 30/30 frames
```

**Still true, and not F1:** whether pedestrians *rasterise* is the GPU half, in
`src/render/`. F1 never claimed they were visible — it claimed the two CPU
counters disagreed. They no longer do. See F2.

#### The cause underneath it: the pavement hold was teleporting bodies

F1's "lost agents" were not agents walking out of frame. The pavement hold in
`stepAgent` applied its **whole** error as a position snap every frame:
`nx += normal * (lateral + wob - lat)`. It is not a velocity term and it is not
scaled by `dt`.

Measured with the rate limit removed as a **control**, 60 frames at each of
`dt = 0, 1/120, 1/60, 1/30, 1/15`:

```
  hold  p50 24.117 m at dt=0 ... p50 24.169 m at dt=1/15   (0.2% spread, 60x change in dt)
  hold  max 33.97 m;  97.9% of agents > 0.5 m;  87.4% > 5 m;  74.4% > 20 m
  NET travel (|locomotion + hold|)  p50 0.000 m
  agents standing inside a building footprint  529 of 2550 = 20.8%
```

The `NET travel p50` is the finding. The bodies were **not flying** — the hold
moved agents ~24 m and `resolveBuildings` moved them ~24 m straight back, and
the two cancelled to zero. 20.8% of the crowd stood inside a building at the
start of every frame, being shoved out and pulled back in, forever. That is why
Pass B and `buildInstances` disagreed by up to 107: the agents crossed the
radius boundary twice per frame and cancelled in between.

**Fixed** by making the correction a rate — `clamp(d, ±HOLD_SPEED * dt)` with
`HOLD_SPEED = 1.4 m/s`, a walking pace. After, the same sweep:

```
  hold  p50 0.000 m at dt=0 (all 6000 slots exactly zero), and exactly HOLD_SPEED*dt otherwise
  hold  max 0.09 m;  0.0% of agents > 0.5 m at every dt
  agents inside a building footprint  0 of 2550 = 0.0%
  NET travel p50 0.023 m at dt=1/60   (was 0.000 — the crowd was pinned)
```

**Standing numbers, `__selftest_density.ts`, before -> after:**

| | before | after |
| --- | --- | --- |
| gap mode (>= 40 px), all in-frame | 0.0% | **0.0%** |
| gap mode (>= 40 px), 20–30 px band | 0.0% | **0.0%** |
| merged (< 2 px), all in-frame | 18.7% | 19.0% |
| merged (< 2 px), **20–30 px band** | 28.4% | **18.9%** |
| p50 separation, 20–30 px band | 3.7 px | **6.2 px** |
| figures in the 20–30 px band | 48 | **517** |
| population spread | 169 m | 112 m |
| self-test violations | 1 | **none** |

**Read this honestly.** The `>= 40 px` gap mode did **not** appear — the
prediction that it would was wrong, and it is not chased here. What moved is the
band `LEGIBILITY_TARGETS.md` §2 actually names (20–24 px body separation): merged
fell 9.5 points and the number of figures in that band rose 10x, because the
crowd is no longer pinned and now spreads down the street rather than heaping
at the camera. The gap mode needs *group structure*, which is a different
mechanism — `GROUP_EMPTY_P` — and is R1's remaining work, not this fix's.
The reviewer's recorded verdict still stands: rebuilding alone will not resolve
overlapping placement.

### F2 — The crowd diagnostic poses do not point at the crowd — **POSES DONE, SUBJECT STILL INVISIBLE**

**Evidence (original).** `01b-crowd-closeup` and `01c-street-crowd` were hardcoded
at the world origin (`position: [0, 2.4, -40]`, `capture.mjs`). The crowd centroid
measured at `(974, 46)` — ~975 units away, outside `viewRadius: 190`. The
"close-up" was never looking at the crowd, so both poses have reported an empty
street for a *diagnostic* reason.

Earlier sessions read that absence as an entity-winding bug, then as G-buffer
culling. Both wrong. A control run settled it: `pedestrian:0/180` under *both*
`cull: 'back'` and `cull: 'none'`.

**Status: the poses are fixed.** `src/world/diagnosticposes.ts` derives them in
the app from `crowd.population()` plus `sampleStreetPlan`, so `--eval`, the
console and the renderer read the same numbers (`__syzygy.pose(id)`). Three
derived poses now exist — `01d-street-crowd`, `01e-crowd-closeup`,
`01f-facade-base` — and the two lying poses are renamed to `01b-origin-field` /
`01c-origin-avenue` (and `01a-building-base` to `01a-lot-interior`), so they no
longer claim to be crowd or street diagnostics. Each derived shot prints its own
provenance, and the harness now *fails loudly* if a crowd pose lands more than
60 m from the centroid — rule 4 as a mechanical check.

**Status: the subject is still invisible, and it is not the pose.** Measured at
`01d-street-crowd`, camera `(1041.7, 2.75, 17.8)` on a 31.24 m arterial, 16.57 m
off the centreline, 49.5 m from the live centroid `(990, 35)`:

```
population()        n=2392, centroid (990, 35)
instances drawn     pedestrian:2550/180     (renderer.stats.entityDraws)
entityTriangles     153000 = 2550 × 60
inView()            inside 810 of 2245, minD 17.8 m, maxD 107.8 m
pedestrian mesh     180 indices = 5 boxes = 60 tris, 1.7 m tall, sane
instance[0]         translation (1129.268, 0.35, 0.35), scale 1
the PNG             zero visible pedestrians
```

The camera and the subject are in the same place (rule 4 satisfied by
construction — the pose is *derived* from the centroid), the instance buffer
holds valid transforms, the draw is issued, and the counters now agree. Nothing
rasterises. That half is in `src/render/renderer.ts` (entity pipeline /
`uploadInstances` / `drawEntity`) and `src/render/citymesh.ts`
(`instanceVertexLayout`), none of which the session that found this owned.
**F2 cannot close until pedestrians are actually visible.**

**Two different mechanisms were called one symptom, and they must not be
conflated.** The F1 counter divergence was real and is closed — Pass B counted
against the pre-step position while `buildInstances` re-tested the post-step
position, disagreeing on 17 of 30 frames by up to 107 agents. That was
**positional**: zero while the crowd sat wholly inside `viewRadius`, tens to
hundreds once the camera flew through the rim.

The *other* intermittency — `pedestrian:0` sampled once from
`renderer.entityDraws`, "reproduced on 8 of 11 poses" — has a different cause
and is **not** explained by F1. Measured from the GPU side: this box drops ~80%
of frames, and only 12 of 60 stepped frames issued any draw at all, because
`renderer.render()` returns early under the frame budget at `renderer.ts:1230`
while `main.ts:438` has already cleared `entityDraws`. On a skipped frame the
draw ledger reads **empty**. Anything that samples that ledger once is reading
skipped frames, not a crowd that vanished.

So the standing rule from this: **`crowd`'s `diag`/`visibleCount` counters are
trustworthy and the GPU draw ledger is not** — the opposite of the usual
assumption. Sample the counters, and sample the ledger over a run rather than
once.

**Closed when:** a shot from `01d-street-crowd` contains visible pedestrians.

### F3 — Delete `crowd.inView()` — **CLOSED**

`inView()`, its call site in `main.ts`, and the hardcoded
`targetsW = 1600 / targetsH = 900` fields that existed only to feed it are
deleted. Nothing else read `targetsW`/`targetsH`, so both went with it. Per
§12, a diagnostic that has lied once does not get a second chance, and the
`pass A/B/C` counts and `population()` answer the question it was answering.

**Also closed.** `tools/capture.mjs:1144`'s `inView: s.inView ?? null` is gone,
so the key is absent from the stats sidecar rather than present and null. That
was the last step and it is the close condition F3 actually named.

### F4 — Wire traffic to the instanced draw path — **DONE; this section was wrong**

**The old text was false and has been deleted.** It claimed "`main.ts:243`
submits only pedestrians". `buildVehicleInstances` exists, and `main.ts` packs
the vehicle instances into the same buffer immediately after the pedestrians and
issues one `drawEntityBlock` per vehicle mesh with a correct instance offset
(`ped.count + b.start`). PROCESS rule 6: the executable one won, and the document
was corrected in the same change.

**Measured**, camera derived from a live tram (rule 4), 10 frames:

```
  per-kind   alive / drawn / culledFar / dropped
    tram        240 /  240 /    0 /    0
    trolley     180 /  180 /    0 /    0
    cablecar    180 /  170 /   10 /    0
    funicular   120 /    0 /  120 /    0
    zipline     240 /    0 /  240 /    0
    blimp       120 /   40 /   80 /    0
    balloon     180 /   20 /  160 /    0
    cycle        30 /    0 /    0 /   30

  blocks issued per frame:
    count=65 [tram:42@0 cablecar:17@42 rider:0@59 blimp:4@59 balloon:2@63]
    maxGrade=0.8129 maxGradeError=0
```

**Rail alignment is correct.** Distance from a tram's position to its own
resampled rail spline, and the vertical term alone:

```
    tram       railDist=0  |dy|=0  suspension=catenary  nearestCam=29.6
    trolley    railDist=5.2  |dy|=0  suspension=catenary  nearestCam=28.6
    cablecar   railDist=0  |dy|=0  suspension=free     nearestCam=850
    funicular  railDist=0  |dy|=0  suspension=ground   nearestCam=1894
    zipline    railDist=0  |dy|=0  suspension=catenary  nearestCam=1745
```

`|dy| = 0` means trams are on the rail, not floating above or sinking below it.
The 5.2 m on `trolley` is the authored twin offset ("run beside the tram, ~5 m to
one side"). `maxGradeError = 0` is the stronger statement: the written Y column
equals `forward[1] / |forward|` exactly, so the vehicles use the rail tangent
and not a yaw-only transform. That is the failure the old F4 text predicted and
it is not present.

**Two things a reviewer should know, both pre-existing and correct:**

- `funicular` and `zipline` drew 0 from a tram-adjacent camera because their
  nearest instance was 1894 m and 1745 m away against ranges of 460 m and 620 m.
  They are culled by distance, not broken. F4's old close condition — "non-zero
  `entityDraws` per kind" — is therefore pose-dependent, and no single pose
  satisfies it for all eight kinds.
- `cycle` is `dropped` every frame with `range: 0`. That is deliberate and
  commented at `traffic.ts` (`VEHICLE_DRAW.cycle`): no mesh exists for a cycle.
  It is a documented absence, not a wiring fault, but it is the same *shape* as
  a phantom, so it is recorded here rather than left to be rediscovered.

### F5 — Ground detail at eye height — **CLOSED, measured**

**Was:** Street-level frames ~60% featureless grey slab. `bakeGround` emitted
kerb strips that were barely visible and, worse, were not on the streets — 1.2m
boxes on a jittered 48m **world-axis** grid, with no relationship to
`sampleStreetPlan`, so a "kerb" ran through the middle of blocks and none of them
followed a carriageway. `DistrictPalette.ground`, the colour that has existed in
`districts.ts` since the first commit, was read by nothing at all.

**Now.** Three layers, and the split between them is forced by one fact: the
street field lives only on the CPU, and re-deriving ~90 lines of warped noise in
WGSL is exactly the way this project gets silent bugs. So *where the street is*
is decided at bake time, and *what the surface is made of* is synthesised per
pixel.

- `src/world/groundgrammar.ts` — 9 pavement families, 6 kerb styles, 6 marking
  styles, 11 district entries plus road-kind sharpening, `CLUTTER_KINDS`,
  `streetFrameAt`. Pure data and pure functions; no WGSL, no GPU types.
- `src/render/groundbake.ts` — per chunk: kerb face, kerb top, footway band,
  road paint, and street furniture, emitted into the chunk's solid builder so it
  streams and culls with the buildings.
- `groundSurface()` in `gbuffer.wgsl` — grain, slab joints, cobble worley, plank
  lines, board-formed bands, chequer plate, kerb faces, worn paint.

**Measured, same 12 chunks, before and after, best of 4:**

| | tris/chunk | min | p50 | max | ms/chunk |
| --- | --- | --- | --- | --- | --- |
| before (F5 baseline) | 78,485 | 53,228 | 83,820 | 88,518 | 12.3 |
| + kerbs, footways, paint | 87,382 (+11.3%) | 62,754 | 92,170 | 98,498 | 27.0 |
| + street furniture | 95,439 (+21.6% total) | 71,374 | 99,982 | 109,690 | 29.8 |

Per chunk the ground work is 16,819 triangles: 8,897 kerb/footway/paint plus
182 pieces of furniture (of 182 wanted, 7,923 tris, 17.3 lamps). `CLUTTER_TRIS`
and `TRACE_STEP` are the two dials if this needs to be cheaper.

**Kerb accuracy, measured not asserted:** pooled over 12 chunks the kerb sits
**p50 0.01m / p90 1.00m** from the carriageway edge that the same street field
reports at the kerb's own position. `__selftest.ts` prints the percentiles and
fails above p50 0.5m / p90 2.5m, so a regression is a red line rather than a
slightly wrong frame.

**Five silent bugs were found by measuring, not by reading.** All are written up
in the commits; the two worth carrying forward:

- The lateral normal read `t.p[i*5+4]`, which is the **width**, not `tx`. Every
  kerb landed tens of metres from its road and the emitted geometry spanned
  2.3km instead of 256m. Nothing threw; the triangle count looked plausible.
- The pavement family has to reach the fragment stage through `color.rgb`,
  because the vertex format is full and chunk geometry has no per-draw
  `matId`. The first two encodings decoded **29/66** and **36/66** of the
  (district, road kind) pairs correctly. The working one banded the albedo into a
  per-family (saturation, value) window *after* road-kind sharpening: **66/66**,
  with all 10 bands uniquely nearest to themselves.

**Closed when:** a street-level pose shows kerbs catching light and reading as a
kerb, with painted lines on the carriageway. **See the capture below.**

### F5b — The street field is not a distance field — **CLOSED, `2037d6c`**

`sampleStreetPlan` evaluates the domain warp `warpAt(x, z)` at the **query
point**, so for the grid and alley families `out.dist` is the distance to a line
whose position depends on where you asked from, with a warp gradient of roughly
1.5 m per metre. A perpendicular offset of `width/2` does not land at distance
`width/2`.

**This matters beyond the kerbs:** `makeBuilding` derives every building's
setback from that `clearance`, so buildings stand further back from a carriageway
than their footprints suggest — and `__selftest.ts` reports "carriageway
10.83..47.09m wide" from the *nominal* parameter, not the apparent one. A true
signed distance (evaluate the warp at the line, not at the query) would fix lot
placement, the kerb edge, and probably the canyon widths at once.

**Closed.** `2037d6c`, "citygen: the street field is a distance field now, and
the check is committed". The warp is now evaluated at the line by fixed-point
iteration, and the error was measured against the bisected line by two
independent methods that agreed:

```
  |reported - true|   p50 0.71m   p90 3.30m   max 20.12m
```

That is the *pre-fix* error. `src/world/__selftest.ts` now asserts the result
directly and currently reports:

```
  34647 unambiguous kerb-face vertices sit on the carriageway edge: p50 0.12m, p90 2.71m
  134906/134906 deck vertices inside a street corridor (worst 0.00m clear)
```

The close condition ("the kerb edge stops needing a field query per segment") is
met. Note the downstream consequence was wider than the kerbs and is still worth
watching: every building setback was derived from this `clearance`, so the city
stands differently than it did before `2037d6c`.

### F5c — `MeshOpts.emissive` is a PHANTOM (new, from F5)

`MeshBuilder` writes a per-vertex emissive mask, `uploadMesh` puts it at vertex
offset 44, `VSIn` declares it at `@location(4)` — and `gbuffer.wgsl`'s vertex
shader computes `o.emis = v.params.z * v.tint.a`, never reading `v.emissive`.

**Every glowing lantern, sign and lamp head in chunk geometry emits nothing.**
Entities are unaffected (they set emissive per instance). The fix is one token in
`vs`: `max(v.emissive, v.params.z * v.tint.a)`. It is not in F5 because F5 was not
allowed to touch `vs`, and because turning on an emissive channel changes the
look of the whole night city and wants its own comparison run.

**Closed when:** `01d`-equivalent night pose shows lantern and sign light, and
the emissive channel is in the G-buffer.

### F6 — Warm boot, so a capture is seconds not minutes — **DONE, but the diagnosis was wrong**

**Evidence (original, and it was wrong).** "The sequence is ~9 minutes,
dominated by streaming: one chunk baked per frame under a 4 ms budget, ~60 frames
before a shot means anything."

**Measured, same 11 poses, current tree:**

| Stage | Total over 11 poses |
| --- | --- |
| residency wait (`residentChunks >= 40`) | **1.0 s** (989 ms on pose 1, 0 ms on the other ten) |
| `settle()` synchronous steps | 6.1 s |
| `captureRGBA()` | **89.0 s**, rising 1319 ms → 15204 ms across the run |

Streaming to 40 chunks costs **1591 ms** synchronously (35 ticks). Streaming was
never the cost. Two real costs, neither in the streaming budget:

1. **`captureRGBA()` (`src/render/renderer.ts:1314`) costs a fixed ~7.6–8.9 s
   per call** — measured three ways, and it is *not* a queue backlog:
   `pixels()` (which calls `captureRGBA` directly, no PNG encode) 8220 ms;
   `capture()` (which adds `toDataURL`) 8586 ms; and three *back-to-back*
   captures with nothing between them were 7961 / 7731 / 7988 ms. Adding 30 more
   presented frames before a capture did not change it (7585 ms). A fixed cost
   of that size, independent of backlog, is what 11 poses × 8 s = 86 s of the
   105 s run is made of. **This is the actual F6 root cause and it is not mine
   to fix.**
2. **`settle()` used `__syzygy.step()`**, which calls `tick()` N times back to
   back. Each encodes and submits in ~20 ms because `queue.submit` does not wait
   for the GPU, so N frames of GPU work were queued in tens of milliseconds.
   Now paced through rAF, so the GPU is never handed more than it can retire.

**Landed.** `?seed=&chunks=N&warm=M` bakes N chunks resident at boot before the
first presented frame (`App.warmChunks`), and `__syzygy.warm()` does the same
*after* `setPose` — which is the one that matters, because a chunk's LOD is
derived from the live camera position, so a boot warm bakes detail levels for
the spawn camera and re-bakes them the moment the pose moves. It is the app's
own `streamChunks` loop, not a second bake path, precisely so each chunk is baked
at the LOD it will be viewed at. `--no-warm` is the cold path for A/B.

**Measured:** boot warm 64 chunks = **2255–2696 ms** (62 ticks, `stopped:
target`); post-pose warm 96 chunks = 190–5661 ms. A **single-pose capture is
24.5 s wall** including vite boot, chromium launch and PNG write — inside the
~30 s target.

**Warm must not change the image — measured.** Same seed, same *literal* camera,
sim frozen via the existing KeyP binding; warm arm vs. cold arm (teleport far
away so the residency set is evicted, return to the same camera, let the 4 ms
budgeted streamer refill it):

```
triangles       2741068 == 2741068     drawCalls 116 == 116
pedestrian      2245/180 == 2245/180   lights 0 == 0
pixels differing  479587 / 1440000  = 33.305%
mean abs diff      0.129 / 255  (0.05 %)
max abs diff       9 / 255
histogram   identical 960413 | ≤1 459380 | ≤4 19264 | ≤16 943 | >16 0
```

**Noise floor for comparison:** two consecutive captures of a completely
unchanged world differ on **43.87 %** of pixels, mean 0.171/255, max 9/255. The
warm-vs-cold difference is *indistinguishable from the noise floor of two
captures of the same state*, and every residency-sensitive counter is identical
to the digit. That is the honest form of "indistinguishable": not zero, but
below what this renderer can resolve, with no geometric difference behind it.

**Closed when:** `node tools/capture.mjs --pose=<any>` returns in seconds — done,
24.5 s. The remaining ~8 s per shot is `captureRGBA()` and belongs to the
performance agent's file.

### F7 — `captureRGBA()`'s 8 s is a fence, not a function (new, measured)

The ~8 s was attributed to `captureRGBA()` three times without ever being
measured inside it. It is now measured, per phase, and published in
`stats.capturePhases` so any later claim can be checked. Milliseconds:

```
run                    tex  encode  buf  submit    map    read  free  total
1 (quiet)             0.0     0.1  1.9     0.2  1854.2   14.5   0.0  1871.0
2 (busy)              0.1     0.0  0.1     0.1  9175.0   11.8   0.1  9187.1
2 (busy)              0.0     0.0  0.0     0.1 12040.0   12.7   0.0 12052.9
2 (busy)              0.1     0.0  0.0     0.0 16786.0   18.8   0.0 16804.9
3 (readback gate)     0.0     0.1  0.0     0.1  6487.0    8.1   0.0  6495.2
4 (gate + pacing)     0.0     0.1  0.0     0.1  646.0     7.2   0.0   653.0
```

Encoding the composite is 0.1 ms, allocating the 5.76 MB readback buffer is 0,
submitting is 0, and the 1.44M-pixel BGRA→RGBA swizzle is 8-19 ms.
`mapAsync` is 99.9 % of the function in every run at every contention level.

What the fence waits for, measured:

- `probe()` copies **27 bytes** through the identical submit/`mapAsync`/
  `getMappedRange` path and took **3.7-12.8 s** (run 2) and **1.3-1.9 s**
  (runs 3-4). A readback transferring 200000× less data for the same time is
  not paying for its data.
- **440-528 rAF ticks** elapsed inside one `captureRGBA()` call. Ticks, not
  presented frames: the loop never waits for the GPU, and rAF free-ran at a
  measured 87-114 Hz while `render()` encoded a 3-7M-triangle, four-cascade
  frame in 8.8-9.9 ms of CPU and submitted it regardless. The queue was being
  refilled faster than it drained, which is why the cost was stable at ~8 s and
  why adding 30 presented frames first "did not move it".
- The **PNG encode is not the cost**: `putImageData` 0-7 ms, `toDataURL`
  14-75 ms for a 2.16 MB PNG, GPU-backed and `willReadFrequently` alike. The
  6511 ms `toDataURL` in run 2 was CPU contention with four browsers running.

**Landed:** `render()` will not submit while more than 2 frames are unretired
(`MAX_FRAMES_IN_FLIGHT`), nor while a readback is in flight, with a 250 ms
fail-open. `stats.framesInFlight` and `stats.framesSkipped` publish the queue
depth and the declines, because "the queue is deep" was previously unfalsifiable.

**No speedup is claimed.** Four runs on a GPU shared with other agents returned
0.65-28.8 s per call for identical code, and in run 4 the governor stepped
high→low mid-run (3.1M triangles instead of 6.9M) after a 661 s stall in which
333 rAF ticks took 661 s. Runs 3 and 4 differ by the gate *and* the tier, so
6.5 s → 0.65 s is not attributable to anything yet. The invariant is real; the
number is not. Re-measure on an idle machine.

**Two things for whoever picks this up:**

1. `main.ts`'s `refreshCapture` is now the largest remaining term and nobody owns
   it: it is `putImageData` + `toDataURL`, ~20-90 ms once the fence is bounded.
   Worth re-checking after the next idle-machine run before optimising it.
2. Pacing makes `stats.frameMs` the real GPU-paced frame time instead of the
   rAF cadence, and `governQuality()` reads exactly that and demotes below
   34 fps. In steady state that was not reached (frameMs 8.25-9.19 ms,
   109-121 fps) but the governor did demote after an external stall. Whether a
   capture on a shared GPU should be allowed to demote the tier is a decision,
   not a default.

---

**Also still wrong, and worth 30 seconds from whoever owns it.**
`src/world/__selftest.ts:551` prints `0.57M tris for 64 chunks`. It is a
hand-rolled analytic estimate that never calls the baker. The figure measured
through `bakeChunk` is **6.22M** for 64 chunks — an 11x understatement. Live
frames corroborate the order of magnitude: this session measured 2.4M–10.9M
`stats.triangles` for 19–167 visible chunks. It is the same failure class as the
other phantoms — a number that is printed, looks plausible, and answers to
nothing.

---

**Cheapest first move:** F6, then F1 and F2 together. F6 makes the F1 loop fast,
and F1 + F2 together answer both crowd questions in a single run.

## The short version

The city renders. It is a dense, atmospheric, district-coloured metropolis with
working sun shadows, canyon fog, and a post chain that does tilt-shift, bloom,
TAA, chromatic aberration and filmic grade. Getting there meant fixing **eleven
silent rendering bugs** — faults where the application ran at full speed, reported
plausible statistics, and produced wrong pixels.

What is *not* true yet: street level does not read as inhabited, traffic is
simulated but never drawn, and night is nearly black.

The project is **WebGPU-only**, decided by the human owner on 2026-10-01 (*"we're
shelving webgl 2. we're going all in on webGPU."*) and confirmed against the
source — six `.wgsl` shaders, no GLSL, `gpu.ts:74` hard-fails rather than
falling back. The brief asked for both backends; the WebGL 2 half is out of
scope by decision, not missing by neglect. Anyone without WebGPU sees nothing.
Do not pick it up in passing: `DECISIONS.md` D1, roadmap R8.

## Running it

```bash
npm install
npm run dev            # http://localhost:5180
```

Headless capture (this is the loop you will live in):

```bash
node tools/capture.mjs                          # one shot
node tools/capture.mjs --sequence               # 10 curated poses, ~9 min
node tools/capture.mjs --sequence --pose=canyon # just the poses matching "canyon"
node tools/capture.mjs --debugseq --pose=wide-skyline   # every post stage, one run
node tools/capture.mjs --eval "<js expression>"  # run an expression in the page
```

Type and test:

```bash
npx tsc --noEmit
npx vite-node src/world/__selftest.ts    # city generation
npx vite-node src/sim/__selftest.ts      # weather + traffic
npx vite-node src/camera/__selftest.ts   # camera
node tools/lsp-check.mjs                  # all five language servers
```

**The capture harness always uses the Vite dev server, never `preview`.** A
`preview` build is a stale build, and a screenshot of a stale build looks
perfectly valid while being completely wrong. This cost an hour once.

## Where the screenshots are

`shots/<timestamp>/` per run, plus `shots/latest.json` with per-shot stats.

**Nothing in `shots/` is in git** — ignored, and purged from history along with
the reference videos (D22). The 10-pose reference set from the end of the last
session is on this machine at `shots/2026-09-29T19-30-34/`, with
`_contact-sheet.png` as the overview, but a fresh clone has none of it.

`_contact-sheet.png` is generated only when ffmpeg is on `PATH`.

## What is actually working

Verified by rendering it, not by assuming it.

**World generation** (`src/world/`)
- Deterministic from a seed. Same seed, byte-identical city, across processes.
- Buildings are solid from the ground up. This was broken until the last session
  — see [`PITFALLS.md`](PITFALLS.md) §17 — and is worth re-checking after any
  change to `pushBuilding`, because six of the faults shared one origin and two
  more were found downstream of the main fix.
- A street field of warped grids, meandering arteries and three deliberate
  spines (canal, market, rail). Building lots are dropped where they do not foul
  a carriageway, so canyons are emergent rather than authored.
- 11 districts with distinct linear-RGB palettes, building grammars and roof
  types. Spatial coherence via domain-warped fbm.
- ~1.5 ms to generate a chunk (256 m). ~22 buildings, ~950 props, ~46 cables,
  ~9 skybridges per chunk.
- Building heights to 600 m; canyon free width p50 ≈ 20 m.

**Renderer** (`src/render/`, `src/shaders/`)
- Deferred: albedo+roughness, normal+metal, emissive+AO, reverse-Z depth.
- 4-cascade CSM in **conventional** depth (see `PITFALLS.md` — the conversion is
  deliberate).
- Analytic sky: Rayleigh/Mie-ish gradient, two warped-fbm cloud layers, sun disc.
  All colours linear; tonemap happens once, at the very end.
- Bounded height-weighted fog that pools in the canyon. Aerial perspective on top.
- Clustered local lights via a compute binner (16×16 screen tiles).
- Post: YCoCg-clamped TAA, half-res golden-angle bokeh carrying the tilt-shift
  band, 6-level bloom, barrel distortion, CA, halation, filmic tonemap, grade,
  vignette, grain.
- Streaming: chunks bake and upload under a 4 ms/frame budget, LRU-evicted.
- Five quality tiers with a hysteretic governor.

**Simulation** (`src/sim/`)
- `WeatherDirector` — eases weather toward targets at per-field rates, six
  authored day phases, all 17 event kinds wired to specific field changes.
  Self-tested: converges to within 0.2% of target.
- `TrafficSim` — 207 vehicles across tram/trolley/cablecar/funicular/zipline/
  blimp/balloon/cycle, wind-responsive, 0.04 ms/frame. **Not drawn.**
- `CrowdSim` — SoA, 6000 agents, need-driven goals, spatial hash, view-space
  seeding, street placement. ~2 ms/frame. **Rendering unverified — see the two
  open work items above.**

**Camera** (`src/camera/`)
- 6-DOF inertial flight, auto-banking proportional to yaw rate and speed,
  speed-coupled FOV, altitude-dependent handheld bob.
- 7 authored tours. Self-tested for seams and NaN.
- Gamepad, keyboard, mouse, touch, with pointer-lock that degrades cleanly.

**Agent** (`src/agent/`)
- 14 tools. SSE tool-calling loop against `/api/chat`, with a Vite dev proxy in
  `server/plugin.mjs`.
- **A deterministic local brain** parses natural language with no API key, so the
  console is fully explorable with zero configuration. This matters: it is the
  difference between a feature that always works and one that works on your
  machine.

## What is not working

Ordered by how much it hurts the spectacle. The full coverage map, including the
`PHANTOM` rows, is [`COVERAGE.md`](COVERAGE.md).

**0. Five phantoms.** `godRays` and `precip` are uniform slots that no shader
reads. `structure-collapse` is a registered LLM tool with no fracture renderer
behind it — ask the agent to collapse a structure and it reports success while
doing nothing. `debrisChunk()` is defined and never called. Canal water is built
and discarded. None of these are on the roadmap, which is how they survived
three sessions. Cheapest to reason about, and the only one that makes a tool
lie.

**1. Street level is not inhabited.** The crowd is placed on real streets, but
whether it renders at all is currently contradicted by our own counters (F1),
and the two poses meant to show it are pointed at empty ground (F2). ~1900
people spread across the streets within 160 m would be thin on any single avenue
regardless, and the street deck is a featureless grey slab (F5). This is the gap
most visible against the reference frames. Fixes: F1, F2, F4, F5.

**1b. The pedestrians that do render are inert.** Density and legibility are
R1. Whether the crowd *behaves* is R12 (living systems: locomotion, avoidance,
grouping, interaction) — a separate row on purpose, so closing "the street reads
occupied" cannot be mistaken for "the occupants read alive". Current evidence:
gate 5 measured isolated silhouettes clearing the 20-24 px separation target
while packed rows merge into counter-like bands, and dev2 measured the empty
≥40 px gap bin. Two causes, both open — the mesh proportions in `citymesh.ts`
and the placement/locomotion in `crowd.ts`. The reviewer was explicit that
"rebuilding alone will not resolve overlapping placement".

**2. Traffic is invisible.** `TrafficSim` produces vehicles and 64 lights, but
only pedestrians are submitted through the instanced draw path. `Renderer
.drawEntitySet` already exists and works; traffic needs its instances built and
the `pendingEntities` hook extended. Trams and cable cars on the visible rail
lines would transform the canyon shots immediately. Fix: F4.

**3. Night is nearly black.** The night pose is a purple murk. A night city
should be the *brightest* thing in the frame — the window emissive is written,
the clustered lights are binned, but the exposure and ambient authoring for the
night phase is wrong.

**4. Aliasing is severe.** Deferred has no MSAA, and TAA is not converging within
the capture's settle budget. Distant geometry crawls. Options: longer history
accumulation, a cheap edge-detect resolve, or jittered projection with more
samples.

**5. WebGL 2 does not exist — by decision, not by neglect.** The prompt asked for
both backends. The human owner shelved WebGL 2 on 2026-10-01 (*"we're shelving
webgl 2. we're going all in on webGPU."*), and it was confirmed against the
source that WebGPU is the only renderer that has ever existed here. **This is
not on the list of things that need doing and was previously written here as if
it were** — that framing was wrong, and it is the one item in this document that
a reader could act on by mistake. `DECISIONS.md` D1 (closed), roadmap R8
(shelved). Portability to WebGL 2 / three.js is still wanted and is a separate
thing; do not read this as "rewrite the renderer as GL".

**6. Not built at all:** destructible structures, precipitation, volumetric god
rays, water rendering (`bakeGround` returns a water mesh that nothing consumes),
district-accurate signage at distance.

## Things that will waste your time if you don't know them

Full catalogue in [`PITFALLS.md`](PITFALLS.md). The four that cost the most:

1. **A black screenshot is not a dark scene.** Check for GPU/WGSL errors. The
   harness now hard-fails on them, but only for *new* errors.
2. **WGSL forbids calling an entry point.** Marking a helper `@fragment` and
   calling it from another entry point silently invalidates the whole module.
3. **Struct offsets in WGSL are the ABI.** The frame uniform is written from
   TypeScript and read by a shader; if the two disagree, everything shifts
   silently. There is a comment on the writer and a `FRAME_UNIFORM_SIZE` constant
   for a reason.
4. **The reference videos are the spec.** When a decision is aesthetic rather
   than correct, extract a frame and compare.

## Two agents in the workspace

You are in a `herdr` session. The other two panes in this workspace are
`claude` (idle) and `developer` (idle). They are free to be used; subagents
through the task tool also work. Prior work was split this way:

- city generation, districts, networks → one agent
- LLM conductor, local brain, console UI, capture harness → one agent
- flight camera + input → one agent
- weather director + traffic → one agent
- crowd → attempted twice by a subagent that returned empty both times, so it
  was written directly

**If a subagent returns an empty result, assume it did nothing and verify with
`ls`.** That happened twice and cost real time.

## If you only do one thing next

Take **F6**, then **F1 + F2** together.

F6 makes a capture cost seconds instead of minutes, which is what makes the F1
diagnostic loop cheap enough to run ten times. F1 and F2 together settle whether
the crowd renders at all, and until they are settled no amount of density tuning
is meaningful — you cannot tell a distribution problem from a rendering one, and
two sessions have already misread it as a winding bug and then a culling bug.

After that, F4 (traffic) and F5 (ground detail) are what turn "a city" into "a
city that is alive", and they are the clearest distance between the current
output and the reference frames.

**Before any of it, read [`COVERAGE.md`](COVERAGE.md).** It carries five
`PHANTOM` rows — subsystems with a name, a uniform slot, or a registered LLM
tool and no system behind them. `structure-collapse` is the sharp one: ask the
agent to collapse a structure and it reports success while doing nothing. Those
are not on the roadmap, which is why they survived three sessions.
