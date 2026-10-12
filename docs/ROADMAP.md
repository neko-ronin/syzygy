# Roadmap

> **Owner extension, 2026-10-06:** finish the hero/street/crowd/night batch and
> related issues, then improve city richness and continuous large-world
> performance. Target: **60 FPS on this Mac in Chrome at 1600 × 900**. See
> [the execution plan](WORK_PLAN_2026-10-06.md) and **R14** below. Older ordering
> lists retain completed F items; the current plan does not reopen them.

The project has **no completion condition** — the original brief says it will be
handed to each new frontier model and iterated indefinitely. So this is not a
list of tickets to close; it is a map of where quality still lives, and why.

Every item is tied back to a clause of the [original prompt](ORIGINAL_PROMPT.md).
The reasoning column matters more than the task: it explains what "done" means
and what a lazy or misdirected attempt would look like.

Status key: **done** · **partial** · **todo** · **closed**

**closed** means a decision was taken, not that work finished. See R8.

---

## Reading the quality bar

The nine `.mov` files in `inspirations/dreamscape/` are the bar. Extract frames
before any aesthetic judgement:

```bash
ffmpeg -i inspirations/dreamscape/dreamscape-01.mov -vf "fps=1/6,scale=420:-1" /tmp/f%02d.jpg
```

Three things those frames demand that the current build does not yet deliver:

- **Perceptually clean distance.** Their silhouettes stay crisp into the haze.
  Ours crawls.
- **Colour that belongs to a place.** Their teal/coral is a *palette doctrine*
  across a whole frame. Ours is district-driven but the districts read as random
  per building in wide shots.
- **Occupied streets.** They are full of people and vehicles. Ours are empty.

---

## R1 — Make street level read as inhabited

**Status: partial — blocker CLEARED, ground work landed, zero frames judged better** ·
**Priority: highest** · *Vision: "realistically active living city of pedestrians
and traffic"*

> **2026-10-02 state, and it is a mixture that should not be mistaken for
> progress.** This row's blocker was a **phantom**: there was never a pedestrian
> rendering bug. The crowd renders — 2,550 bodies, correct draw, correct
> counters — and had **no lateral spread**, so it presented as a 1-D line at
> `z = 0.35` that read as an empty street. F1, F2, F3 and F4 are all closed and
> measured.
>
> **What now blocks this row is the ground and the crowd's neighbour query:**
>  - **F8, the bare deck** — ~70% of the first honest close-focus frame is a
>    featureless grey slab. The kerb reads now (4.319x authored contrast,
>    previously consumed by nothing, 0.45 px → 18-37 px), and having real relief
>    beside it makes the deck read as unfinished. Owner: `groundSurface()` +
>    `groundgrammar.ts`.
>  - **The neighbour buffer holds no near neighbour for 100% of agents** —
>    nearest-in-buffer 3.396 m vs a true nearest of 0.000 m, 90.7x. Separation
>    has been computed against the wrong bodies. Fix the query before any tuning.
>
> **And the session's honest verdict on this row: fifty commits produced no frame
> that anyone judged better.** Every vision gate returned `more work needed`.
> A measured fix nobody has photographed is not yet progress.

The single clearest distance between current output and the reference. At 2.4 m
looking down an avenue you see a bare grey slab.

Three sub-problems. Full fix proposals — evidence, steps, and the check that
proves each closed — are in [`HANDOFF.md`](HANDOFF.md) as F5, F1/F2 and F4
respectively. F1/F2 and F4 are **closed**; F5's kerb leg is **closed and
verified**, its close-range deck leg is **not** (F8).

1. **Ground detail.** No lane markings, no kerb read, no drain covers, no clutter
   at eye height. The `bakeGround` kerb strips exist but are barely visible.
   *Why it matters:* it is 60% of the pixels in a street-level shot, and it is
   the cheapest large-area quality win available. → **F5**
2. **Crowd density and distribution.** **UNBLOCKED — and the blocker was a phantom,
   measured.** There is no rasterisation bug. The crowd has been rendering the
   whole time: 2550 pedestrians, correct cloth palette, correct cloth-coloured box
   forms, packed shoulder to shoulder along the street. They were invisible
   because **`F.lateral` never reached the instance transform** — `crowd.ts:985`
   computes and stores the lateral offset, `crowd.ts:1019` writes only x/y/z from
   `F.x`/`F.y`/`F.z` — so every agent sat at `z = 0.35` on a single 1-D line.
   A one-dimensional smear of bodies reads as an empty street. Two sessions
   opened those frames, correctly saw no *figures*, and reported the crowd as not
   rendering; then two more sessions searched for a winding bug and a culling bug.
   Full record, including the four refuted hypotheses and the A/B that settled it:
   [`F1F2_GPU_HALF.md`](F1F2_GPU_HALF.md).

   F1 (the two counters disagreeing) and F3 (deleting the lying `inView`) are
   closed and measured. What remains is **lateral spread**, then avoidance and
   flow — and those are now measurable, which is the whole point of the
   unblocking.

   *Watch out, harder than before:* once the spread is fixed the crowd becomes
   visible for the first time and every visual judgement in the project will be
   applied to it. The vision reviewer has already named the failure it expects —
   a crowd that resolves into a counter-like band. Fixing the spread makes that
   judgement possible; it does not make it pass. → **F1 closed, F2 was never a
   render bug, spread fix + R12**
3. **Traffic on screen.** **DONE — this row was stale for a session.**
   `buildVehicleInstances` packs vehicles after the pedestrians into one
   contiguous instance buffer and issues a per-mesh draw at the correct instance
   offset (`main.ts:440-455`). Measured per kind from a live tram: tram 240/240,
   trolley 180/180, cablecar 180/170, and rail alignment is exact — the written Y
   column equals `forward[1]/|forward|`, so vehicles ride the rail tangent rather
   than a yaw, and the float-above/sink-below failure this row predicted does not
   occur. `cull`-by-distance explains the kinds that draw zero at any single pose,
   which makes this row's old "non-zero per kind" close condition unsatisfiable.
   → **F4 closed**

**Done when:** a street-level pose contains trams on the rails, cable cars above,
and people on the pavements, at a density where the far end of the street is
visibly busy — and that pose is derived from the crowd centroid, so the shot
cannot be quietly framing empty ground (D21).

**The inhabitation judgement has three deciding things** ([`VISION_ROUND1.md`](VISION_ROUND1.md)
D7), fixed in advance so the verdict cannot drift into a general impression.
Missing any one of them means `more work needed`, regardless of palette, cable
density or skyline:

1. **Readable grounded bodies** — silhouettes that separate from each other,
   from stall supports, and from the ground. Heads and shoulders establish a
   body; feet, occlusion and shading establish where it stands. *A merged dark
   bar, a floating figure, or a repetition that reads as fence posts fails.*
2. **Occupation belonging to the route** — a passing stream on the clear aisle
   with counter-facing bodies beside the frontage. *A scatter across an empty
   slab fails even if every individual model renders cleanly.*
3. **Occupation continuing into depth** — the near people connect to occupied
   middle distance and a busy destination further along. *A convincing
   foreground clump over a street that then goes empty fails.*

The **first failure expected** is a crowd that becomes visible as a
counter-like band — overlapping bodies and repeated poses forming a dark comb
with coloured tops. That is a prediction, not a diagnosis of the current raster
fault, and the recognition test is whether the eye sees people using counters or
another set of rectangular street objects. **Visible pixels alone cannot close
this row**; a crowd produced by a uniform lattice has been mistaken for a
populated street before.

## R2 — Fix the night

**Status: in progress — awaiting the owner's day/night judgement.** Re-measured
2026-10-11 after facades and lit windows reached the screen: market night mean luma
**27.7** (was 6.21), 21% warm pixels (aisle warm was 0.00); lantern cores and warm
pools with visible joints, two pools on the aisle (§4 proposes three).
[NIGHT_REPORT §9](NIGHT_REPORT.md). The same-camera pairs the OPEN entry asks for
now exist, including the new `01-wide-skyline-night` pose. Earlier history below.
Night measured **6.21 mean luma** before, **~11.4** after (noon measures
**125.75**). Night is still not the brightest frame in the set, and there is
still no warm pool on the aisle. Full measurements, controls and the dominant
cause: **[`docs/NIGHT_REPORT.md`](NIGHT_REPORT.md)**. · **Priority: high** ·
*Vision: "atmostpheric lighting and atmostphere effects are vey important"*

Night is currently a purple murk. It should be the **brightest** frame in the
set — that inversion is what makes a night city read.

The pieces exist: window emissive is synthesised, lanterns and signs are baked
with emissive masks, the light binner runs, `WeatherDirector` has a `night` phase.

> **The original diagnosis below was wrong, and is kept because it is the kind of
> wrong this project keeps making.** It said the rig was "internally consistent
> and merely aimed too dark" and proposed raising "the window-emissive
> multiplier". Measured: that multiplier does not exist — `windowGlow` is read
> by nothing outside its own self-test — and the dominant cause is that
> **`marketGrammarFor` emits 365 lights and 0 of them reach `BakedChunk.lights`**,
> because `bakeMarketDetail` returns `void` and `bakeGroundDetail` has no market
> light sink. The lanterns glow and cast nothing. Ambient ×3 moves the aisle
> 3.56 → 3.95; exposure ×3 moves it 3.56 → 5.68; **`aisleWarmPixelPct` stays 0.00
> in every configuration**, because there is no warm light at the aisle to
> reveal. Multiplying a floor does not invert a ratio.

#### What the last four rounds actually established

This subsection replaces three separate wrong diagnoses. The full record is in
[`LIGHT_DELIVERY.md`](LIGHT_DELIVERY.md); the reason it is summarised here is
that **four plausible mechanisms were proposed and measurement killed all four**,
including two proposed by the orchestrator. Anyone reading only the commits would
not know that.

| Hypothesis | Verdict | Decisive measurement |
|---|---|---|
| Lights never reach the buffer | **REFUTED** | 933/933 delivered, 0 starved, `lights == delivered` on every frame |
| Lanterns hung too high for stall faces | **REFUTED** | Drop 6.3 m → 3.85 m confirmed baked (144 lanterns, median hang 3.85 m). It did what it was meant to — and the flank problem persisted unchanged |
| Stalls sit *beside* the lanterns, not under them | **REFUTED** | Stalls median 4.92 m from their nearest lantern, min 2.14, **zero of 27 within 2 m**, at N·L 0.874 — *better*-faced than the deck case modelled |
| Cloth albedo too dark | **EXONERATED** | Frontage is authored **1.7×–9× brighter** than the deck it stands on (cloth linear 0.19–1.0 vs deck effective 0.107). The predicted sign was backwards |
| `matAo` dimming vertical faces | **EXONERATED** | 0.594 on a vertical face vs 0.798 on deck — a 1.34× ratio, and it multiplies the **ambient term only**; the clustered-light term contains no `matAo`. AO cannot dim a lantern pool on a wall |

And then the measurement that had been resting on air was itself voided: the
"13 known roadward stall faces" were projected onto empty aisle, 2.36 m from the
nearest mesh vertex. Byte 4 with R-B −6.9 was **night sky**, and the day frame's
luma 119 at the same pixels was bright facades behind. So there was no
measurement of a lit stall face anywhere in this thread.

**The histogram that replaced it** (`7a9ae71`). Samples are triangle centroids of
baked geometry projected through the renderer's own `frameUniforms()[0..15]` —
never hand-placed. The probe was validated against the hand-measured deck point
before use: `(580, 627)` byte 64.3 R-B +41.5 against a manual `(581, 621)`
byte 60.6 R-B +38.3, inside 6 px and 4 byte.

| | n | median R−B | median byte R |
|---|---|---|---|
| stall frontage (N·L > 0.3) | 37 | −5.0 | 4.7 |
| deck under lanterns | 194 | −3.7 | 4.8 |
| matched, 2–12 m | — | −2.7 vs −3.7 | 7% warm vs 8% warm |

**Frontage is not starved relative to the deck. Both fail identically.** The
"a face receives 12% of what its geometry predicts" framing was wrong from the
start: it compared a lit deck against sky.

**The actual shape of the problem — a bright small spot on a very cold field:**

| distance from lantern | deck R−B | warm fraction |
|---|---|---|
| straight down, 3.0 m | **+41.5** | — |
| 4–6 m | −4.8 | 3% |
| 8–10 m | −3.3 | 5% |

and the coldest thing measured anywhere is frontage 0–1 m from a lantern at
**R−B −16.1**. Since clustered lights have **no shadow lookup at all**, that is
orientation rather than occlusion: N·L clamped to zero leaves only blue ambient.

This matches gate 5b's finding `(a) "one broad foreground wash, not three
successive pools"` more precisely than any earlier account did — and it explains
why the round-15 counter-height light experiment *regressed the deck* (60.6 →
22.8): it added more spots, and the spots were never the problem.

**Known limit of the instrument.** The occlusion ray test covers the market mesh
only, not buildings or ground, so a building-occluded sample would still count as
visible. No sample returned sky-black and the day control lights the same
geometry, so the histograms are probably sound — but this is untested and is
recorded rather than glossed.

#### ~~PROPOSED — widen the lantern pool, not its intensity~~ — **SUPERSEDED, DO NOT PICK UP**

> **Closed 2026-10-01. Executed as `882f434`: scored 3 held / 3 failed, reverted.**
> The discriminating prediction — *the 3 m core must not rise* — **failed**: the core
> rose R-B +41.7 -> +50.0. Deck 4-6 m moved -4.7 -> -1.6 (byte R x4.4) without
> reaching positive; the 8-10 m band moved -3.1 -> -2.3; frontage did not come level
> with the deck (the gap **widened**, 3.0 -> 3.4). Radius is a genuine far-field lever
> and insufficient, and it buys reach with a core closer to clipping. Zero captures
> were spent, which is exactly what gating captures on the prediction was for.
>
> **The next candidate was invalid too.** Round 18 observed an explicit aisle point
> 5.0 m lateral from a lantern reading **+39.6 at r=15** while the same run's 4-6 m
> band median read -4.7 — two numbers that cannot describe the same surface. The deck
> sample set is barycentric points across every chunk within 40 m, so it is mostly
> sidewalk and carriageway, **not the market corridor**. Round 17's band medians,
> and the "2 m pool every 17-31 m" premise above, were computed over a population
> that is mostly not the aisle.
>
> **And the method was wrong.** See `SESSION_2026-10-01.md` §1 and `PROCESS.md`
> rule 1. Nine rounds of numeric targets on a subjective question produced six
> refutations and no fix. **The next move for this item is a frame review by a
> non-implementer against the reference sheets — not another histogram, and not a
> corridor-restricted re-sample.** The original text is kept below because
> pre-registering a prediction is worth copying, and because the correction is part
> of the record.
>
> **What survives as genuinely established:** light delivery is plumbing-sound
> (`lights == delivered`, 933/933, 0 starved); the lantern drop to 3.85 m is baked
> and correct as far as it goes; frontage and deck **fail identically** (R-B -5.0
> vs -3.7), so stall faces are not starved relative to the paving; and albedo and
> `matAo` are both exonerated by arithmetic.

<details>
<summary>Original proposal, exactly as written before the round</summary>

**Written down before the round, deliberately.** Four mechanisms in this thread
were proposed on plausibility and refuted on measurement, two of them by the
orchestrator. A prediction recorded in advance is what makes the next result
falsifiable rather than another story that fits.

**Hypothesis.** The lantern's `Light.posRadius.w` (radius) is far smaller than
the spacing it is meant to bridge. Measured falloff is +41.5 at 3 m and −4.8 by
4–6 m, with cords **17–31 m apart**. A ~2 m bright pool every 17–31 m cannot
articulate an aisle at any intensity, because intensity scales a pool and not its
reach. Widening the radius should merge three successive pools into a continuous
lit walking plane, which is gate 5b's named requirement `(a)`.

**Prediction, stated so it can be falsified:**

- deck R−B at 4–6 m rises from −4.8 toward positive;
- the 8–10 m band rises from −3.3 toward positive;
- frontage median R−B follows the deck, from −5.0 toward roughly equal;
- **the 3 m core must NOT rise** — it is already +41.5 and clipping. If the core
  also brightens, the radius did not change the *shape* and this is another
  intensity change wearing a different hat;
- total lights delivered must stay 933 and `starved` 0 — if radius grows far
  enough to exceed the 3072 cap, the fix has moved the problem into the binner;
- `bakeChunk` cost and `capturePhases.total` must not regress materially.

**Refuted if** the 4–6 m and 8–10 m bands do not move while the 3 m core does.
That outcome means falloff is not the lever, and the next candidate is the absence
of any shadowing term for clustered lights — which the −16.1 frontage reading
already points at.

**Cost:** one constant, one round, no authoring change. Owned by R2.

</details>

---

**Done so far:** night `ambientIntensity` 0.22 → 0.66, `exposure` 1.28 → 1.60
(both measured, both inside the self-test's bounds, `sim` self-test still ALL
PASS); daylight verified unaffected from the same camera.

**Next, in order:**

1. **Push the market lights into the buffer.** One loop at the
   `bakeMarketDetail` call site in `groundbake.ts`, exactly as
   `marketbake.ts`'s own header specifies. This is the gap. Not a shader change.
2. **Reconcile the duplicate `PHASE_LOOK` in `src/agent/tools.ts`** (lines
   315-322). The conductor's `set_time` and the renderer read different night
   rows today (`ambientIntensity` 0.35 vs 0.22 before this change). Two sources
   disagreeing is `PROCESS.md` rule 6; one of them is currently a trap.
3. ~~**Decide the window-emissive question properly.**~~ **DONE — deleted.**
   `windowGlow` was removed along with the entire `glow` event channel that
   existed only to carry it (`b.glow.v = look.windowGlow` was its sole source),
   including the `power-cycle` event's `l.glow(...)` write, which also went
   nowhere. Window emissive is synthesised in `gbuffer.wgsl` at 0.19..5.15 linear
   and added unscaled in `lighting.wgsl`; there was never a multiplier to raise.
   Do not reintroduce one under this name.
4. ~~**Then re-judge.**~~ **DONE — the frame was re-judged, and the inversion
   target was wrong.** Night is not required to be the brightest frame; it is
   required to be *legible*. The cause was neither the phase table nor the light
   count: 933 lights delivered, 0 starved, the pool measurably warm — and stall
   faces still unreadable, because a lantern hung at 6.3 m puts byte 42 on the
   deck and byte 19 on a vertical panel 2 m back. Fixed by dropping the cords to
   ~3.6 m, which changes the ratio rather than the brightness. See
   `docs/LIGHT_DELIVERY.md` §4h.

*Verification that matters, changed:* night must be legible on its own terms —
stalls, crates and canopy frames resolve, and the ground does not read as an
orange wash. Not that it outshines noon.

### OPEN — needs the owner's eyes on a frame, not a number

**The luma inversion is undecided, and must not be decided by an agent.**

Measured now: night ≈ **11.4** luma against a noon of **125.75**. On the raw
number night is nowhere near being the brightest frame. But a raw mean-luma
comparison is the wrong instrument, and the owner has made the point directly:

> In reality a city is dark at night but perceptually it may be perceived as the
> brightest thing. I can't make a judgement without seeing it.

So the criterion above — *"night must become the brightest frame in the set"* — is
**provisional**. It is a useful forcing function for stopping night being a
purple murk. It is not established as the target. Three separate things are true
at once and this entry conflates them:

1. Night must not be near-black. Settled, and being fixed.
2. Night must read as *lit* — warm point sources, visible pools, a legible
   walking plane. This is the review gate's named gap and it is the current work.
3. Whether night out-reads *daylight* in a given frame is an **aesthetic
   judgement that requires looking at both frames together**, and depends on
   composition rather than on a mean.

**Queue for the next visual review session.** When the team is ready to produce
visuals for the owner, produce these as a set and ask:

- one daylight and one night frame of the **same pose and seed, side by side**,
  not as two separate stills;
- a night market frame, once the aisle lighting lands — that is where the
  question is sharpest;
- the wide skyline at both phases, since that is where an inversion either reads
  or does not.

Then either ratify the criterion or replace it with one that can be measured.
**Do not tune toward the number in the meantime.** Optimising for "night > day"
as a raw luma target would push the whole night rig bright and wash out the very
point sources the frame depends on. The related acceptance test that *is*
established is `docs/LEGIBILITY_TARGETS.md` §4: a luminous lantern core with a
visible warm pool on the adjacent walking surface.

---

## R3 — Kill the aliasing

**Status: todo** · **Priority: high** · *Vision: "near or surpasses the
videos"*

Deferred has no MSAA. TAA exists and is correct but does not converge inside the
capture settle budget, and thin geometry (cables, railings, window slots) is the
worst case.

Options, best first: accumulate more history frames in the harness's `settle`;
jitter the projection sub-pixel and take N samples; a cheap edge-aware resolve;
explicit SMAA-style pass. *Engineering note:* everything else in this list is
wasted effort if the base image is unstable, so this precedes polish work.

## R4 — Performance and LOD

**Status: substantially done and measured; this line said "todo" for several
sessions and that was wrong** · **Priority: medium** · *Vision: "use performance
tricks"*

**Was:** a wide aerial is 1.0-4.6 M triangles with 126 visible chunks, and the
shadow cascades dominate. `bakeChunk` takes a `lod` parameter and LOD 1/2 are
written, but **every chunk is baked at LOD 0 and nothing is ever swapped in at
distance**.

**Now, measured on the 16-frame high-tier set** (`shots/2026-10-01T16-10-49/`):

- Distance LOD actually swaps: **6.22 M -> 2.02 M -> 0.746 M** triangles across
  LOD 0/1/2.
- Shadow draws cut **63.8%**, by pointing the shadow camera along the sun
  (`2360bf9`) rather than at the origin.
- The quality governor now runs on **wall-clock** frame time instead of a counter
  that excluded the GPU.
- Readback queue bounded; `captureRGBA`'s 8 s was a fence, not a function.
- Presentation set: **LOD 2 and LOD 3 zero on 16/16 frames.** The renderer is not
  LOD-starved at street level.

**Honest caveat.** 8 cores / 16 GB; a full 16-frame high run is ~722 s (~35 s per
frame), and one warm street-level pose is ~35 s. That is what made this thread's
measurement loop possible at all (see R10) -- and it is also why capture budget
is rationed per round.

**Still open, in order:** shrink the far cascades' shadow atlas; instance the city
into fewer draw calls; move chunk baking fully off the critical path.

*Why it matters:* "performance tricks" is an explicit requirement, and the
governor in `main.ts` steps down silently unless the budget is genuinely there.

## R5 — Destructible structures

**Status: todo** · **Priority: medium** · *Vision: "structures should be able to
transform into a destructible form"*

Explicitly requested, and currently absent.

The design that fits this codebase: chunks are already self-contained baked
meshes, so a collapse is a per-chunk state change plus a GPU debris field.
`entityMeshes.debrisChunk()` already exists unused. `EventKind` already has
`structure-collapse`.

*Honest scoping:* "there is no gameplay", so this is spectacle, not mechanics.
The high-value version is a building folding into rubble with a dust plume that
lingers — visible from a kilometre away, since the camera is a drone.

## R6 — Atmosphere: volumetric light and weather

**Status: shafts done (`6a47405`) · precip still a PHANTOM** · **Priority: medium**
· *Vision: "atmostpheric lighting and atmostphere effects are vey important"
(repeated in the prompt)*

**Shipped.** A half-resolution radial scatter march from the sun's screen
position, occluded by the depth buffer, driven by `weather2.y`, composited
after the temporal resolve. Plain WGSL, no froxel volume, no reflection probe —
see [`WATER_AND_VOLUMETRICS.md`](WATER_AND_VOLUMETRICS.md) for the design, the
cost, and the two bugs that had to be found before any of it was measurable.

The open half is `precip`: `weather3.w` is still written every frame and read by
nothing, and the reference frames lean on rain. `WeatherDirector` models
sunbreak, fog-bank and lightning, which is what drove the shafts and should
drive it.

**Known gap:** no pose in `references/sections.json` frames the sun, so the
comparison grid cannot currently show this working. A dusk pose with the sun
in-frame is a prerequisite for reviewing it, not a follow-up.

## R7 — Water and the canal

**Status: todo** · **Priority: low-medium** · *Vision: implied by the
inspiration stills*

`bakeGround` returns `{ mesh, water }` and the water mesh is never consumed. The
canal district exists and `waterDepthAt` works. Reflections would sell the canal
level and the night shot enormously.

## R8 — WebGL 2 backend

**Status: closed — shelved by decision, 2026-10-01** · *Vision: "use webgl 2 and
webgpu"*

**Not work. Do not pick this up.** The prompt asked for both backends; the human
owner ratified *WebGPU only* on 2026-10-01, and D1 is closed. This entry is kept
rather than deleted because a roadmap is a map of where quality still lives, and
this records a decision that was actually taken — including what it cost.

What was confirmed against the source before closing it: there has only ever been
one renderer here. Six `.wgsl` shaders, no `.glsl` anywhere; `getContext` is
called with `'webgpu'` and `'2d'` and never `'webgl2'`; `gpu.ts:74` hard-fails
rather than falling back. The cost, stated plainly: **anyone without WebGPU sees
nothing.** That was accepted, not overlooked.

Genuinely a second renderer, if it is ever un-shelved: no compute (the light
binner needs a transform feedback path), GLSL ES 3.00 instead of WGSL, no
`float32-filterable`, and the whole frame graph re-authored. Weeks, not days.

**Shelving is not retracting portability.** The owner may still port to
three.js or WebGL 2 later; the algorithms already allow for it and three
comments exist to keep that honest — `src/render/cascade.ts:6`,
`src/shaders/post.wgsl:324`, `docs/WATER_AND_VOLUMETRICS.md:27`. Do not "clean
those up"; they are why the current design can move.

## R9 — Districts that read as places

**Superseded in scope by [`DESIGN.md`](DESIGN.md) + R11.** The section↔district
mapping, the per-section reference sheets and the palette doctrine all live in
the design document now. What follows is the original framing, kept because the
roadmap is history as well as plan.


**Status: partial** · **Priority: low** · *Vision: "large sections of the city
to have differing styles and colors like a real city"*

The district field works and is spatially coherent. What is missing is that in a
wide shot the districts read as *per-building random* rather than as
neighbourhoods — partly because buildings are individually coloured, and partly
because the aerial perspective flattens the transition.

Worth doing: district-scale value banding, signage that is district-legible at
distance, and letting a district's silhouette language (setback profile, spire
frequency) differ more strongly.

## R10 — Iteration cost

**Status: partial** · **Priority: high** · *Vision: "engineer it so that
iteration comes at ease"*

The sequence takes ~9 minutes, dominated by streaming: the renderer bakes one
chunk per frame under a 4 ms budget, so filling the view is ~60 frames before a
shot means anything. Every design decision in this project is downstream of how
cheaply it can be looked at.

Highest-leverage remaining work: a `?seed=&chunks=N&warm=N` parameter that bakes
the whole view synchronously at boot, so a capture is a second rather than a
minute. **Do this before the crowd work** — it is F6 in
[`HANDOFF.md`](HANDOFF.md), and it is what makes the F1 diagnostic loop cheap
enough to run ten times instead of two. See [`PROCEDURES.md`](PROCEDURES.md).

**Partly done.** `node tools/compare.mjs --latest --ref <video>` builds a
baseline/current/reference grid in one shot, so "did this help?" no longer
requires holding two images in your head. It is documented in
[`PROCEDURES.md`](PROCEDURES.md) §2.

---

## Ordering

The `F` items in [`HANDOFF.md`](HANDOFF.md) are the executable form of the
top three rows. Within R1 the order is not negotiable: F6, then F1+F2 together,
then F4 and F5.

```
F6 (warm boot)     ─┐  do first: makes the F1 loop cheap enough to run ten times
F1 (crowd counts)  ─┤  measure-first, pair with F2, do not close by inspection
F2 (crowd poses)   ─┘
F3 (delete inView) ──  housekeeping, do while you are in crowd.ts
F4 (traffic)       ─┐
F5 (ground detail) ┘  the visible gap; independent of F1-F3

R3 (aliasing)      ─┐  the base image has to be stable before polish means anything
R2 (night)         ─┘  cheap, unlocks a whole visual register

R4 (perf)          ──  MEASURED DONE: LOD swaps, 63.8% fewer shadow draws. Atlas
                         sizing and draw-call instancing still open
R2 (night) 2nd   ──  the lantern-radius round is CLOSED and reverted (882f434).
                         The next move is a FRAME REVIEW, not another histogram:
                         nine rounds of numeric targets on a subjective question
                         bought six refutations and no fix. See
                         SESSION_2026-10-01.md §1 and PROCESS.md rule 1
R6 (atmosphere)    ──  the most recognisable missing element of the references
R5 (destructible)  ──  explicitly requested, spectator-scale is enough
R7 (water)         ──  cheap once R1 makes streets matter
R9 (districts)     ──  polish
R8 (WebGL 2)       ──  CLOSED: shelved by decision 2026-10-01, not work (D1)
R10 (iteration)    ──  partly done: compare.mjs landed, warm boot is F6
R12 (living)       ──  R1 makes streets read occupied; this makes the occupants
                         read alive. Independent of R1's density work.

      ── after R2's radius round, before R11 ──
R13 (audit)        ──  find which guarantees are ENFORCED and which sit in the
                         wrong path. Cheap now; expensive after R11 §C work
R11 (sections)     ──  §C is not a reskin and is the item most likely to stress
                         the frame graph, which is why the audit precedes it
```

## What "spectacle" means here

The stated product goal is a showcase for AI model releases. That sets the bar
higher than "works": the test is whether a single frame, paused, is worth
looking at. The reference frames pass that. The current skyline shot
marginally passes; the night shot does not; the street-level shots do not.

When choosing between two ways to spend an afternoon, prefer the one that makes
a *frame* better.

---

## R11 — Build the four sections (D24)

**Status: built, ZERO sections visually verified** · **Priority: highest** · *Vision:
"large sections of the city have differing styles and colors like a real city"*

> **2026-10-02: §B and §A are BUILT and §D's evidence is landed — and not one
> section has been photographed.** That is the state of this row, and it is worse
> than "todo" in one specific way: there is code and no evidence it works.
>
> - **§B cold-industrial** — built. Mean base hue 208.8° against 42.0° for the
>   rest of the city, separation **11.8° → 166.8°**. Ropeway relationship
>   inverted: authored Pearson(height, density) −0.235 → +0.961, district-level
>   −0.65 → +0.302. Cable-density and facade-clutter density split into two
>   knobs after the §B re-weighting silently cut lantern-bazaar's signage ~3x.
>   One prediction was **refuted and explained** (building-level r −0.547 →
>   +0.020; monastery-spire's 429 sparse needles stand at ~446 m with no
>   neighbours in ray range). Report: [`R11_B_COLD_INDUSTRIAL.md`](R11_B_COLD_INDUSTRIAL.md).
> - **§A saturated-graphic** — built. Report: [`R11_A_SATURATED.md`](R11_A_SATURATED.md).
> - **§D verdant-solarpunk** — **judgeable without godRays and without water**,
>   except canal-base poses. `godRays` was found to be a **phantom that was
>   already closed** (`post.wgsl:353` reads `weather2.y`). Report:
>   [`R11_D_VERDANT.md`](R11_D_VERDANT.md).
> - **§C fire-lit** — design exists and is **not** the burning-ruin premise this
>   row used to carry; see below.
> - `structure-collapse` — the one phantom that made an LLM tool **lie on
>   request** — is removed, not built. Removing registration alone would have
>   retargeted collapse requests to `sunbreak` via the enum fallback, which is a
>   second lie wearing the first one's clothes.
>
> **What is missing is a frame.** §A and §B are both in the codebase and neither
> has been photographed; the reviewer has not judged either. That is the whole
> remaining work on this row, and it is capture-bound.
>
> **The hero frame is the gate.** Market Spine Counter Walk's derivation is
> delivered and **unphotographed** — the first image this project will call
> approved, and the one that exercises R11's second clause alongside R1 and R2.
> Spec: [`HERO_FRAME_SPEC.md`](HERO_FRAME_SPEC.md). Verdict criteria tightened
> against what 2026-10-02 found: [`VISION_ROUND9.md`](VISION_ROUND9.md),
> [`VISION_ROUND13.md`](VISION_ROUND13.md).

Full direction in [`DESIGN.md`](DESIGN.md); machine-readable definitions in
[`references/sections.json`](../references/sections.json). This entry is only
the ordering and the done-when, so the roadmap is not a second source of truth.

**Build order: B → A → D → C.**

1. **B cold-industrial** — `glass-foxholes`, `rust-hangars`, `canal-district`.
   Reskin: desaturate to steel blue, restrict warm to emissive points, and
   **invert the cable-density relationship** so ropeways run between the tall
   districts (see `DESIGN.md` §4 — it is currently backwards).
2. **A saturated-graphic** — `neon-arcology`, `lantern-bazaar`. Palette and
   saturation only. Watch homogenisation: this is the section most likely to
   spread.
3. **D verdant-solarpunk** — `verdant-canyon`, `botanical-dome`. Mostly present
   already. **Blocked on two phantoms**: the water mesh is discarded at
   `renderer.ts:400` and `godRays` is read by no shader. Both are load-bearing
   for this section.
4. **C fire-lit** — **not a reskin.** No district is a ruin, so C needs new
   form grammar, not a palette. **Its design now exists** —
   [`VISION_ROUND1.md`](VISION_ROUND1.md) D6 — and it is *not* the design this
   row previously assumed:

   > **SUPERSEDED — the burning-ruin premise was wrong.** C is **an inhabited,
   > weathered vertical quarter under amber backlight**. "Fire-lit" describes
   > the amber impression of the light, not a destruction state. The district
   > stays occupied; there is no ruin renderer to build and no default fire
   > emitter below the city, no blanket ember emissive on masonry, and no
   > billowing smoke.

   So the soot/collapse/ember/smoke list that stood here **is not a requirement
   of this design** and must not be picked up as one. What C actually needs is
   authored, per D6: accretion grammar (projecting box rooms, balconies,
   brackets, planted ledges around tall cores), walking decks that wrap the
   projections and cross the void, and — the part that is genuinely missing —
   that assembly continued **down to a readable landing at the base**, so a
   tower is not perched over an empty slab. Ochre/cream/rust on the surfaces,
   amber and honey catching projections and window reveals, recesses falling to
   charcoal and cool blue-grey, near wall and human silhouettes kept dark
   enough to frame the luminous canyon opening. C must be recognisable by its
   irregular assembled silhouette *before* the amber light is applied;
   recolouring the existing terracotta tiers cannot provide that.

   **Consequence for this row:** the absence of a ruin renderer was never C's
   blocker, so `R5` destructible structures is **not** on C's critical path.

**The hero frame is named, and it is not a section shot.** The first frame this
project will call approved is **Market Spine Counter Walk** —
[`VISION_ROUND1.md`](VISION_ROUND1.md) D5. The vision reviewer's judgement was
that a spectacular aerial vista is the more immediately photogenic choice and
the *wrong* one: it would let atmospheric depth and skyline silhouette carry a
frame while the missing human-scale relationships stayed unresolved. So R11
does not get to declare itself done on four sheets alone — **the hero frame has
to hold too**, and it exercises `R1` (inhabitation) and `R2` (received warm
light) at once, which is why both outrank a reskin.

**Done when:** a pose in each section holds up against its own sheet at close
focus, **and** `wide-skyline` still reads as a city of visibly different places.
The second condition is the one that catches failure — sections can each look
correct alone while the city has quietly become one place.

**Per section, also add a close-focus capture pose.** The doctrine requires
detail at 3 m and no such pose exists for any section yet.

---

---
## R12 — Living systems: crowd dynamics and locomotion

**Status: in progress — reordered by [`D26`](DECISIONS.md)** · **Priority: high**
· *Vision: "realistically active living city of pedestrians and traffic"*

> **REORDERED, owner decision 2026-10-02 (`DECISIONS.md` D26).** Local-first:
> **Lenia**-style local fields, **boids** separation, and **Hollywood
> scene-making with Extras** — the city has scenes, certain sections **emit a
> script**, and an NPC picks one up and acts it out.
>
> **The scene/script layer is a LATER STAGE and is explicitly not the next few
> rounds.** The near-term goal is narrow and achievable: **agents move around
> without colliding.**
>
> This supersedes the ordering below, and it supersedes `D25`. Six rounds were
> spent trying to make two global systems agree — path-following against a lane
> hold, balancing to 0.0002 m/frame — and the mechanism was fully explained
> without a fix shipping. Going local means spread is no longer something to be
> *placed*: separation produces it.
>
> **The 0.04 m z-IQR spread defect has left the critical path.** It was a
> symptom of the global-lane architecture, not an independent fault. Kept as a
> bounded open observation in `docs/CROWD_SPREAD.md`, not chased. The 1-D line
> was never a *placement* bug to be fixed — it was what a permanent standoff
> between two global rules looks like from outside.
>
> **Separation has never actually been measured.** The recorded refutation of
> avoidance was measured on a degenerate population — nearest-neighbour p50
> 0.030 m on a line — and `CROWD_SPREAD.md` says so itself. So the near-term
> task is not a demotion; it is the first honest attempt at sub-problem 2.

**R1 asks whether streets read as inhabited. This asks whether the inhabitants
are alive.** R1's done-when is a density and a framing; it does not require that
the people in it do anything. That is the gap this row owns, and it is why the
two must not be closed together.

The reference frames are full of pedestrian traffic whose *organisation* is
visible even where individual bodies are a few pixels tall: streams parting
around an obstacle, groups walking together, people slowing at a stall,
queues, density varying between a crossing and a quiet block. Read at that
distance the city reads as inhabited by something with intent. A uniform field
of agents at a fixed speed never does, however dense it gets.

Sub-problems, **in the order `D26` sets**, not the original order:

0. **Separation — bodies do not end up inside other bodies.** Nearest-neighbour
   distribution and the fraction of overlapping pairs, measured on a population
   that is not degenerate. This is the whole near-term scope, and it has a right
   answer — a floor, not a target. Instrument: `src/sim/__selftest_density.ts`
   plus the gap histogram in [`LEGIBILITY_TARGETS.md`](LEGIBILITY_TARGETS.md).
   *(Was sub-problem 2; promoted by `D26`.)*
1. **Locomotion realism.** Gait is a per-agent phase on a fixed loop; nobody
   reacts to anybody. A crowd where every agent walks a straight line at the
   same speed reads as a conveyor. Minimum: speed distribution rather than one
   value, and a stride whose contact phase correlates with speed.
2. ~~**Local avoidance.**~~ **Now sub-problem 0 — see `D26`.** The old text said
   agents overlap freely, which is what makes packed rows merge into a single
   band, and that this "is the same defect as the placement problem R1 names,
   seen from the simulation side". **`D26` dissolves that framing**: the overlap
   and the 1-D line were never two defects. Both were one — a permanent standoff
   between two global rules, which is what a crowd looks like when nothing local
   is separating anything. Note what the reviewer's warning *did* get right, and
   keep it: rebuilding the mesh alone will not resolve overlapping placement. It
   was wrong only in assuming the placement side and the simulation side were
   separable problems.
3. **Grouping and flow.** Agents move as independent points; reference crowds
   have cliques, lanes and counter-flow. Needs a lightweight flow field or
   lane preference so the crowd acquires streams rather than noise.
4. **Interaction with the city — now the SCENE LAYER, and `D26` says so.**
   Nobody reacts to the city they are in. Stall browsing, waiting at a crossing,
   queueing — the behaviours that make a market read as a market rather than a
   corridor. **This is the `Extras` half of the owner's direction:** the city has
   *scenes*, certain sections **emit a script**, and an NPC picks one up and
   **acts it out**. Market stalls, crossings, transit landings and plazas are
   stages with parts, not merely places with density.
   **Later stage.** Do not build it as a side effect of separation — that is how
   an unjudged second idea contaminates a first. Note candidate scenes while
   working; design them deliberately. Scene *quality* is a frame judgement by the
   vision reviewer against the reference sheets, never a number.
5. **Traffic as agents.** R1/F4 puts vehicles on rails. The same question
   applies: do they queue, yield, stop, and do pedestrians react to them? Under
   `D26` this is the same local-first question as sub-problem 0, and vehicles
   should eventually be agents in the same field rather than a separate system.

**Watch out, and the second warning is the one that bit.** R1 taught the first
one the expensive way: the crowd's two visibility predicates reported 250 and 0
in the same frame, two sessions misread it as a winding bug and then a culling
bug, and **it was neither** — the crowd had no lateral spread and no separating
force. The second warning is `D26` itself: **a distribution change is unreadable
on its own.** Piled on top of movement, you cannot tell a distribution problem
from a locomotion one, because both move the pixels. So separate the change from
the measurement — change one thing, re-measure, judge the frame — and keep
`viewRadius` and the gap histogram as the standing numbers.

**Done when:** a street-level pose shows visible stream structure — agents
parting around obstacles, groups co-moving, a density gradient between two
locations — and the same pose shows no body intersecting another. Verified by a
histogram of pairwise separation and by a frame, **not** by a screenshot of a
still crowd alone. A still crowd can be produced by a uniform lattice, and has
been.

---

---
## R13 — Renderer and engine review (audit only)

**Status: proposed** · **Priority: high** · *Vision: "make performance tricks" /
"use webgpu" — both of which are statements about the engine*

**This is an audit. The deliverable is a document, not a migration.** Read that
sentence before spending anything on it. No new abstraction layer, no framework
adoption, no second backend, no rewrite. Portability to three.js remains wanted
and is *not* this row (D1).

**Why now, and not at the end.** Every expensive fault in this project's history
has been silent, and repeatedly the guard existed but sat in the wrong place. The
sharpest recent instance: `--pose=<substr>` without `--sequence` never applied the
pose, and the requested-vs-held check — correct, tolerance-tuned, with two
paragraphs of written reasoning — lived one branch away from the documented
one-shot command. It reported `PASS` and wrote two frames of a rooftop 444 m up
(`b2ea352`, `PITFALLS.md` §20). Five of the seven night-market rounds were spent
not on the renderer being wrong but on not knowing which part was wrong, and five
mechanisms were proposed on plausibility before a validated probe settled it
(§21).

That is the argument for an audit now rather than later: **the highest-value
output is not a verdict on the architecture, it is an inventory of which
guarantees are actually enforced, and where.** Finding a structural problem after
R11's §C grammar work means redoing that work.

**Scope, in priority order:**

1. **Enforcement inventory.** For every invariant the renderer claims — reverse-Z
   comparison direction, shadow camera along the sun, light count round-trip,
   crowd-centroid refusal for diagnostic poses, LOD swapping, seed fidelity —
   mark each **enforced / unenforced / enforced-in-one-path**. The third
   category is the one that has cost real time.
2. **The WGSL↔TypeScript ABI.** Enumerate every struct written from TS and read
   by a shader, and check each against `FRAME_UNIFORM_SIZE` and its WGSL
   counterpart. This is already known to be load-bearing ("WGSL struct offsets
   are an ABI", `AGENTS.md` pitfall 3) and is *documented as a risk rather than
   checked by a test*. Convert it into one.
3. **Diagnostic trustworthiness.** Catalogue every value that appears in
   `shots/latest.json` or `stats()` and mark whether it can lie. Precedents to
   fold in: `entityDrawCalls` (no callers), `derivedPose` (published stale),
   `pedestrian: ?` (a name with no system), `requested: null` on a passing run,
   `culledByDay` (outlived its cause), and the ≥40 px gap bin that dev2 nearly
   deleted while tidying — which is the strongest argument for the whole row.
4. **Which remaining items are blocked on a renderer limit.** Specifically: is R3's
   moiré (3.638 HF energy at grain 0) the same problem as TAA non-convergence, or
   independent? Are R5 fracture, R7 water and R11 §C smoke blocked on a frame-graph
   limit, or merely unwritten? Answering this reorders work rather than adding it.
5. **Portability assessment — output, not input.** Where the code is coupled to
   WebGPU specifics, and what a three.js port would actually cost. Recorded so the
   next session is not asked to re-derive it. **This section may not contain
   work items**, or it becomes a rewrite with a roadmap row.

**Watch out.** An audit that concludes "we should adopt X" is the failure mode,
and it is the reason this row is written with a scope rather than a goal. The
question is *what is enforced*, not *what would be nicer*. A negative result is a
legitimate and useful outcome: if the answer is "the architecture is sound and the
guards are in the wrong three places", that is three cheap fixes and no migration.

**Done when:** the document exists, every claim in it cites a file and line, and
each of the five sections above has an answer. **Not** when a framework has been
chosen.

---

## R14 — A richer city at 60 FPS during continuous travel

**Status: authorised, pending the street batch** · **Priority: highest after that
batch** · Owner direction: improve richness/detail; optimise and re-architect
city-item placement where needed; adapt documented Spider-Man and Fortnite
large-world techniques to this browser renderer.

**Target platform, explicitly confirmed:** this Mac, Chrome, 1600 × 900. Record
the browser version, adapter, quality tier, actual internal render size and
draw distance with every result. The frame budget is 16.67 ms. Sustained
rendering throughput and traversal frame pacing matter; a CPU encode reciprocal
or a count of animation callbacks does not establish 60 rendered FPS.

Research Insomniac and Epic primary sources, with game-specific claims separated
from general engine features and proposed adaptations. Preserve WebGPU, seeded
procedural generation, zero texture assets, and no runtime npm dependencies.
Re-architecture is authorised where measurement supports it; a framework
migration is not an objective.

**Scope:** detailed streets and facades near the camera, recognisable district
silhouettes and useful detail into the distance, continuous production and
residency of new city regions, visibility/LOD and repeated-item placement that
fit the frame budget. Streaming must not stop play behind a loading screen or
hide an empty horizon by quietly reducing the measured draw distance.

**Done when:** fixed and adaptive quality results are separately recorded for
held street/market and skyline views and for continuous flight across chunk
boundaries, including fast travel and reversal. Report raw frame intervals,
percentiles, slow frames, submitted/completed work, streaming backlog and memory;
use actual GPU timestamps where supported, labelled unavailable otherwise.
Cold boot is measured separately. A non-implementing vision reviewer confirms
near richness and district/distant-city readability against the section sheets
and before/after grids. Unmet performance or visual clauses remain open.

Execution and ownership: [WORK_PLAN_2026-10-06.md](WORK_PLAN_2026-10-06.md).
