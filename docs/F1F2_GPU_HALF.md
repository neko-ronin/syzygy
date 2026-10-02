# F1/F2 — the GPU half: why pedestrians do not appear

Author: developer 1 (GPU half). Round 1 CPU measurement, Round 2 GPU measurement.
Files owned: `src/render/renderer.ts`, `src/render/gpuutil.ts`, `src/render/citymesh.ts`,
the entity path in `src/shaders/gbuffer.wgsl`.

**This file is the report.** Round 1's report was lost to a scrollback buffer. PROCESS rule 7.

---

## Status: OPEN

The entity geometry path in the files this role owns is **measured sound**. Whether
pedestrians are visible on screen is still **OPEN**. The GPU-side question is narrowed
to: *are fragments produced, and if so where do they go?*

---

## Part 1 — Round 1: CPU measurement of the four hypotheses

### Method

The four hypotheses were tested without a GPU, without a browser and without a capture,
by replicating the draw on the CPU:

* `entityMeshes.pedestrian()` — the exact mesh `buildStaticGeometry()` uploads.
* The **live** `CrowdSim` driven to the **derived** pose via `derivePose('street-crowd',
  population(), seed)` — not a typed-in coordinate. Rule 4.
* `m4lookAt` + `m4perspectiveReverseZ` — the same two calls `writeFrameUniforms()` makes.
* Reverse-Z, clear 0, `depthCompare: 'greater'` — `renderer.ts:612`.
* `cull: 'back'`, `frontFace: 'ccw'`, 1600×900 — `renderer.ts:614`, `gpuutil.ts:102-104`.
* A scanline rasteriser over the real instance array, and a `cull:'none'` control.

All probe files were deleted at the end of the round. They are rebuildable from this
document; nothing here depends on them surviving.

### A warning about winding, learned the hard way

The first probe measured **world-space** winding against vertex normals. That is **not**
what `cull: 'back'` decides. The GPU decides front/back from the **signed area of the
triangle in framebuffer space**, and framebuffer space has Y pointing **down** while
clip/NDC space has Y pointing **up**. A probe that reports world-space winding has not
measured the thing the rasteriser uses. Both were measured; the framebuffer-space one is
the load-bearing one.

### The four hypotheses

| # | Hypothesis | Verdict | The number that killed it |
|---|---|---|---|
| 1 | Winding / cull | **REFUTED** | framebuffer-space: pedestrian `ccw=30 cw=30 behind=0 sub-pixel=0`. Control: `cull:'none'` moved depth-accepted pixels **26571 → 31289, ratio 1.178** — not 0 → thousands |
| 2 | Slot 1 unbound / wrong pass | **REFUTED** | `recordGBuffer` binds 3 colour targets + `gDepth` (`renderer.ts:1426-1437`), sets the pipeline (`:1438`), slot 1 (`:1440`), chunks (`:1441`), then `entities(pass)` at **`:1442`**, `pass.end()` at **`:1443`**. `drawEntityBlock` sets slots 0 and 1 and the index buffer |
| 3 | Depth wrong side | **REFUTED** | NDC z ∈ **[5.898e-4, 8.897e-3]** — entirely inside (0,1], entirely above the 0 clear |
| 4 | Vertex path degenerate / instance attrs unbound | **REFUTED** | **2510/2511** instances in-frustum with valid depth; **8/8** corners of one box sane; `clip w` ∈ [11.24, 169.54]; no NaN; mat4 determinant exactly 1.000 |

Hypothesis 1 was also refuted a third time on the mesh itself: world-space,
**60/60 triangles outward, 0 inward, 0 degenerate**.

### Every number measured

**Pose** (derived, not typed in): position `[956.72, 2.75, -13.65]`, lookAt
`[1046.85, 2.55, -13.21]`, fov **0.95 rad**. Provenance: alley **12.56 m** wide,
footwayOffset **4.78 m**, distanceToCrowd **13.7 m**.

**Crowd** (live `crowd.ts` @ `539938f`): `population()` n=**2550**, centroid
**(1013.0, 0.0)**. `instances.count` = **2511** = `visibleCount` **2511**.

**Vertex-shader replica:**

```
(a) instances the draw is issued with : 2511
in front of camera (w>0)             : 2511/2511
inside NDC x/y +-1                    : 2510/2511
NDC z in (0,1]  (passes greater)      : 2511/2511
SURVIVING ALL THREE                  : 2510/2511
clip w range over ALL instances       : [11.24, 169.54]
distance histogram (m -> count): 20:519 40:1205 60:107 80:200 100:199 120:59 140:212 160:10
```

**One box, 8 corners** (nearest surviving instance, 20.70 m): all 8 in-frustum and
depth-ok, `ndc z ≈ 0.005837`, `w ≈ 17.1`. Torso 0.38 × 0.60 m at 20.7 m →
**16.06 × 25.36 px** at 900 px target height. Not sub-pixel.

**CPU rasterisation and the control:**

```
cull:'back'   depth-accepted pixels: 26571   instances that drew: 844/2511
              NDC z written [5.899e-4, 5.908e-3]   mean NDC z 4.004e-3
CONTROL cull:'none'                   : 31289   instances that drew: 931/2511
ratio none/back = 1.178
26571 px on 1600x900 = 1.85% of frame from pedestrians alone
```

**Framebuffer-space winding, all entity meshes** (the quantity cull uses):
pedestrian 30/30 · chunk-style box 20/4 · tramCar 46/40 · cableCar 30/28 ·
blimp 115/132 · balloon 215/226 · ziplineRider 18/18. All behind=0.

**Stride check** over 2511 instances: non-finite **0**, `det != 1`: **0**
(worst deviation 0.00e+0), unit-length columns **0** failures.

### Conclusion of Round 1

All four hypotheses refuted. **The bug was not found.** The entity geometry path owned by
this role produces correct, depth-accepted, rasterisable geometry at a plausible pixel
size.

### The load-bearing caveat

Round 1's rasteriser was a **CPU model of the GPU**. It proves the *inputs* to the draw
are correct. It does **not** prove the GPU issues that draw with those states. A CPU
rasteriser cannot detect a divergence between itself and the real pipeline — which is
precisely the class of bug that would remain. Round 2 exists to close that gap.

### One claim in the brief that measurement contradicts

> "the PNG shows ZERO visible pedestrians"

Round 1 measured **26571 depth-accepted pixels spread over 844 instances** at 1600×900,
figures **16.06 × 25.36 px** each. That is not an empty street. This claim has been
load-bearing for two sessions and is the only evidence in this thread never mechanically
checked. **It must be settled by opening the actual PNG.** An agent reporting a visual
verdict without opening the image is reporting an opinion, not a review (AGENTS.md).

---

## Part 2 — Defects found and deliberately NOT fixed

Recorded, not fixed, because a second unjudged change contaminates the negative result.

### 2.1 `src/sim/crowd.ts:1039-1042` — 28 floats written into a 24-float record

`d[b+24] = density`, `d[b+25] = speed`, `d[b+26] = 0`, `d[b+27] = 0` spill **past** the
instance record (`INSTANCE_FLOATS` = 24, citymesh.ts:62) into the **next** instance's
mat4 column 0.

**Measured benign today**: determinant exactly 1.000 for all 2511 instances. It is benign
*only* because writes ascend in `n`, so each instance's own column 0 is written **after**
its predecessor's spill. It becomes silent corruption the moment records are written out
of order — a `firstInstance`-offset path, or compaction.

The docstring at `crowd.ts:1007-1009` asserts the write is in bounds "by construction".
True for array bounds; misleading about the record. **This file belongs to developer 2.**

### 2.2 `src/render/renderer.ts:1473-1475` — a comment that is false

> "The street deck goes down first with depth writes off"

There is no second pipeline, and `depthWriteEnabled: true` at `renderer.ts:612`. The deck
**does** write depth. A false statement in a file this role owns is a landmine
(PROCESS rule 6). Not a bug, not the cause. One-line fix, deferred to avoid bundling.

### 2.3 A probe of mine that lied — recorded because it nearly did not

An auxiliary check ("does column 0 look like a rotY column?") was malformed: a genuine
rotY column has `|z| = sin h ≠ 0`, so it reported **2511/2511 failures** and looked
alarming. The determinant check is authoritative and is clean. A diagnostic reporting
2511/2511 is exactly what gets believed (PITFALLS §12).

---

## Part 3 — Round 2: the GPU measurement

### 3.2 What Round 2 established on the real pipeline

Measured against `HEAD 0701f85`. Chromium had to be installed first (see 3.4).

**The entity draw IS issued on the GPU.** The ledger census over 60 stepped frames:

```
pedestrian:2550/180   12 frames      tram:34/264      12
blimp:1/792           12             balloon:3/1452   12
cablecar:9/174         5             cablecar:10/174  7
rider:0               12
```

So `drawEntityBlock` runs and the instance count submitted is the full crowd.

**Finding R2-a — this box drops ~80% of frames.** Only **12 of 60** stepped frames
issued any draw. `renderer.render()` returns early under the frame budget
(`renderer.ts:1230`) and `main.ts:438` has already cleared `entityDraws`, so on a
skipped frame the ledger reads **empty**. A single sample of `entityDraws` therefore
means nothing here. **This is very likely the source of the intermittent
`pedestrian:0` symptom F2 records as "reproduced on 8 of 11 poses" — a skipped frame,
not a crowd that vanished.** It also means `captureRGBA` can read a stale composite:
the skip test at `renderer.ts:1230` fires *because* `capturePending` is set.

**Finding R2-b — `setCrowdCount(0)` does not zero the instances.** Requested 0,
measured **2528**. `Pass B` counts every `active` agent inside `viewRadius` regardless
of `targetVisible` (`crowd.ts:338-384`); `setCount` only sets a target that seeds
respect. The control `main.ts:753` advertises — "'2550 instances were submitted and the
frame is empty' and '2550 instances were submitted and 2550 were drawn' are
distinguishable by diffing a frame against the same frame with the population set to
zero" — **cannot be performed with that call.** File not owned by this role.

**Finding R2-c — the pixel-diff instrument is swamped by scene animation.** See 3.3.

### 3.3 The decisive experiment: entity draw ON vs OFF — INCONCLUSIVE

Built the control the brief could not supply: `Renderer.entityDrawEnabled`
(`renderer.ts`, added this round, **default `true`**, no behaviour change) gates
`entities(pass)` at `renderer.ts:1442`. Two runs, same seed, same derived pose, same
crowd — the **only** difference is whether the draw is issued. Verified: OFF arm reported
`drawn: 0`, empty ledger, **instances still 2549**.

Statistic: total frame darkness, `sum(255 - min-pooled channel)` over an 80×45 grid.
Chosen because it is a *sum*, so pedestrian motion cancels; max-pool was rejected
because a dark figure on bright road barely moves a max.

```
ARM ON  (entities drawn)    totalDarkness 1,991,827    within-arm delta 328,740
ARM OFF (no entity draw)    totalDarkness 1,891,963    within-arm delta 410,111

SIGNAL (ON vs OFF)          99,864
NOISE  (within-arm)       410,111
signal / noise            0.24x     -> NOT DISTINGUISHABLE
```

Per-cell: **658 cells darker** with entities on, 2402 **brighter**. The brighter cells
are the traffic entities (tram, blimp, balloons), which are lit and large; the darker
cells are consistent with pedestrians. But cell counts cannot be used: the within-run
noise is **8431 of 10800** cells, because the page's own rAF loop keeps advancing the
clock and the sim between and during snapshots.

**This experiment does not answer the question, and I am not reporting it as if it did.**
The instrument needs a still frame, which is exactly what a capture provides and what I
am not permitted to take. An earlier camera-turn variant (crowd in view vs crowd 180°
behind) gave 15485 signal cells vs 3874 noise, but it is **confounded and discarded**:
turning the camera changes every pixel in the frame, so it measures "different view",
not "pedestrians".

### 3.4 Blockers found, and one unblocked

* **Playwright Chromium was not installed.** Every `--eval` and every capture failed
  with `chromium is not installed for playwright`. Ran `npx playwright install chromium`
  (182 MiB, into `~/Library/Caches/ms-playwright`, no repo change). **This unblocks the
  capture harness for the whole workspace** and is the single most useful thing this
  round did.
* **`bakeChunk` OOMs at low memory** — `RangeError: Invalid array length`
  (`groundbake.ts:301`). Constrains any CPU-side chunk probing on a loaded box.

### 3.5 Still open

**Whether pedestrians are visible is NOT established.** Round 1 proved the *inputs* to
the draw are correct and that a CPU model of the pipeline rasterises 26571 pixels from
them. Round 2 proved the draw is *issued* on the GPU. Neither establishes that the
fragments survive into the visible frame. The remaining candidates, none yet tested:

1. Fragments are written to the G-buffer and **discarded downstream** (lighting / post).
2. The G-buffer write happens at a **different resolution** than the composite.
3. The composite readback (`captureRGBA`) does not show what the swapchain shows.

### 3.6 READY FOR CAPTURE — what one frame would settle

Three shots at `01d-street-crowd`, all with the same seed and settle:

1. **`entityDrawEnabled = true`, normal frame.** Pedestrians visible?
2. **`entityDrawEnabled = false`**, everything else identical. Diff 1 against 2 at the
   *pixel* level: the difference **is** the pedestrian contribution, with no animation
   confound. Expect roughly 844 figures of ~16×25 px if Round 1's model holds.
3. **`cull: 'none'`** at `renderer.ts:614`, `entityDrawEnabled = true`. If 3 differs from
   1, culling is implicated after all.

If shot 2 is identical to shot 1, the fragments never reach the visible frame and the
fault is downstream of the G-buffer write. If shot 1 shows pedestrians, then the
`pedestrian:N/180` readings and the "zero visible pedestrians" PNG claim cannot both be
true and the PNG needs re-examination against the live build.

**A capture on a box dropping 80% of frames may itself be unreliable** (R2-a). The
harness's settle loop should confirm the held camera; the frame ledger should be printed
alongside the shot so a skipped frame is visible in the sidecar.

### Method note

Round 1's control was CPU-side because `bakeChunk` died with `RangeError: Invalid array
length` (groundbake.ts:301) at 63 MB free. Round 2 has 117 MB free and is permitted
headless probes, so the control is re-run on the real pipeline.

### 3.1 Predictions, written before running

* **P(b) — `cull:'none'` at `renderer.ts:614`.** Prediction: **almost nothing changes.**
  Round 1's CPU raster put the ratio at **1.178**. If the GPU ratio is near that, culling
  is not the fault and hypothesis 1 is refuted *on the real pipeline* rather than on a
  model of it. *Falsified if pedestrians appear under `none` but not `back`.*
* **P(b2) — do fragments exist at all.** Prediction: a crowd-on/crowd-off pixel diff at
  the derived pose shows **thousands of changed pixels**, because Round 1 measured 26571
  depth-accepted pixels. *Falsified if the diff is within the off-vs-off noise floor —
  which would mean pedestrians contribute nothing on the GPU and Round 1's CPU model
  diverges from the real pipeline.*
---

## Round 4 — CAPTURES. The premise was false. Pedestrians DO rasterise.

`53d0627` + this section. Verdict up front: **the crowd has been rendering the whole
time.** The "nothing rasterises" investigation — four of my own hypotheses, two before
me — was chasing a phantom, and the actual defect is that the crowd has **no lateral
spread**.

### 4.1 Health reading at the moment of each shot

```
SHOT 1  preflight OK  swap 4.27/5.0GB  disk 14.3GB  mem-unused 486MB  load 26.18/8
        warn: mem 486MB under the 500MB line; load 26.18 = 3.27/core, box shared
SHOT 2  preflight OK  swap 3.88/5.0GB  disk 14.2GB  mem-unused 260MB  load 119.96/8
        warn: mem 260MB under the 500MB line; load 119.96 = 14.99/core
```

Both frames are **evidence of a weaker kind than a quiet box would give**: shot 1 at
486 MB unused with the box 3× oversubscribed, shot 2 at 260 MB with load 120. Shot 2 is
marginal. Both are labelled accordingly. Shot 1 needed `--timeout=420` (the 120 s default
timed out at this load).

Both frames are also **low-detail**: `lodHistogram` shot 1 `[9,25,44,0]`, shot 2
`[9,105,0,0]` — **no chunk at LOD 0 in either**, and the harness warned "warm did not reach
LOD 0 on the camera chunk in 12 passes". Neither frame is a statement about city detail.

### 4.2 The controlled A/B — and it is sound even though the diff was not

`Renderer.entityDrawEnabled` (`renderer.ts:1442`, added Round 2, default `true`) gates
**only** `entities(pass)`. Chunks, deck, buildings, post are untouched.

| | shot 1 `shots/2026-10-02T20-50-51-01d-street-crowd.png` | shot 2 `shots/2026-10-02T21-04-00-01d-street-crowd.png` |
|---|---|---|
| `entity.drawCalls` | 5 | **0** |
| `entity.triangles` | 1423548 | **0** |
| `entity.draws` | populated | **`[]`** |
| `gbufferDrawCalls` | 41 | 43 |
| `triangles` | 6526027 | 5508477 |
| band of coloured vertical bars | **PRESENT** | **ABSENT** |
| street deck | band along its right edge | bare |

**A raw pixel diff of the two frames is void** — it read 1,206,676 differing pixels, 83.8%
of the frame — because each capture re-derives its own pose from the boot-time crowd, so
the camera and the sun differ (`dayPhase` 0.409 vs 0; `residentChunks` 78 vs 114). The two
frames are **not a controlled pair** and must not be diffed numerically.

**The A/B is still decisive anyway, and the logic does not depend on the camera.** The
switch gates the entity draw and nothing else, so in shot 2 every chunk, the deck and the
buildings still rendered (5.5 M triangles, 43 G-buffer draws) — and the band is absent
from geometry that was never gated. A band produced by chunk geometry would still be
there. **Reading (c) is eliminated.**

I opened both PNGs and cropped the band from shot 1 at 3× magnification. It is not a
railing, not market boards and not z-fighting: it is **discrete box forms with individual
tops at individual heights**, in exactly the `entityMeshes.pedestrian()` cloth palette
(citymesh.ts:979-982 — red, orange, green, teal, yellow-green, near-black), packed
shoulder to shoulder and receding along the street. Reading (b), "instance-buffer garbage",
is also eliminated: garbage does not produce recognisable pedestrian silhouettes with
cloth colours.

**Reading (a) is confirmed: it is the crowd, bodies rendered and merged.**

### 4.3 Where they actually are — and this is the real defect

The sidecar of shot 1 answers it without inference:

```
crowdSample  [[1174.05,0.35,0.35,...], [1177.24,0.35,0.35,...],
              [1173.34,0.35,0.35,...], [1173.76,0.35,0.35,...]]
rawInst      translation (1174.051, 0.35, 0.35)
pop          { n: 2550, cx: 1104, cz: 0, spread: 86 }
```

**Every sampled agent is at `z = 0.35`.** The crowd's centroid `cz` is **0**. 2550 agents
are packed into a single 1-D line along `x`, so they merge into a picket wall instead of
reading as individuals, and the street deck they should be standing on is empty. That is
why two sessions looked at these frames and reported "zero visible pedestrians": they were
looking for figures, and there are no figures — there is one long smear of bodies with no
lateral spread.

**This is in `src/sim/crowd.ts` — developer 2's file, not mine.** `crowd.ts:985` sets
`f[o + F.lateral] = lat + rm.jitter(0.55)`, so a lateral offset field exists and is being
written; it is evidently not reaching the instance transform at `crowd.ts:1019-1022`,
which writes only `x`, `y`, `z` from `F.x`, `F.y`, `F.z`. Route it there.

### 4.4 Two further findings from the captures

**Finding R4-a — the held-camera check is vacuous for every derived pose.**
`capture.mjs:1047-1061` builds `requested` from `pose.position` / `pose.lookAt` — the
**static** pose config. The whole `01d/01e/01f` family is derived at runtime and has no
literal position, so `d === null`, the agreement suffix never prints, and the check cannot
fail. Both sidecars read `requested: {position: null, lookAt: null, fov: null}` next to a
`PASS`. This is **PITFALLS §20's exact failure shape recurring on the derived-pose family**,
and it means rule 4's mechanical guard does not fire on any pose that most needs it. Not my
file. `capture.mjs:1047-1061` is the fix site.

**Finding R4-b — the derived pose's own provenance goes stale immediately.** Shot 1's
sidecar records `derivedPose.source.population = {n: 1600, cx: 1032, cz: 5}` and
`distanceToCrowd: 8`, but by capture time `pop = {n: 2550, cx: 1104, cz: 0}` — the crowd
had moved **72 m** from the point the pose was derived from. The pose is computed once at
boot from a population that is still filling, so the number rule 4 checks is a number
about a crowd that has since moved. This is a weaker cousin of §12: the guard is not wrong,
it is about a different subject than the one in frame.

### 4.5 Shot 3 (`cull: 'none'`) was not run, and is now moot

Culling was refuted twice by measurement before a capture was possible — framebuffer-space
winding 30 CCW / 30 CW, and the CPU control `cull:'back'`→`'none'` = 26571 → 31289 px
(ratio 1.178). Shot 1 shows 2550 pedestrians rendering **under `cull: 'back'`**, which is
the direct refutation: culling is not removing them. Reopening hypothesis 1 on the
strength of a predicted result would be exactly the substitution failure of §21. Not run.

### 4.6 Corrected conclusion

The four hypotheses were all correctly refuted, and the reason none of them was the answer
is that the question was wrong. **There is no rasterisation bug.** `pedestrian:N/180`
counters, valid transforms, correct winding, correct depth and a correctly issued draw were
all true *and consistent with a rendering crowd*. The bug is a **placement** bug in the
sim: the crowd is a 1-D line at `z = 0.35` instead of a distribution across the street.

### 4.7 Still open / next

1. **`src/sim/crowd.ts`** — lateral spread. Developer 2. Highest value in the project now.
2. **`tools/capture.mjs:1047-1061`** — make the held-pose check fire for derived poses.
3. **`renderer.ts:1473-1475`** — the "depth writes off" comment is still false (§2.2).
4. **`entityDrawEnabled`** is still in `renderer.ts`, default `true`, no behaviour change.
   It is the instrument for any future "do entities draw" question. Keep or remove —
   it is now 3 lines with a comment saying to remove it when F2 closes.
5. Both frames are low-detail (no LOD 0 chunks). A crowd shot on a quiet box at LOD 0 is
   the honest picture of this fix and should be re-shot once the box allows.
