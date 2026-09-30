# Roadmap

The project has **no completion condition** — the original brief says it will be
handed to each new frontier model and iterated indefinitely. So this is not a
list of tickets to close; it is a map of where quality still lives, and why.

Every item is tied back to a clause of the [original prompt](ORIGINAL_PROMPT.md).
The reasoning column matters more than the task: it explains what "done" means
and what a lazy or misdirected attempt would look like.

Status key: **done** · **partial** · **todo** · **decision**

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

**Status: partial** · **Priority: highest** · *Vision: "realistically active
living city of pedestrians and traffic"*

The single clearest distance between current output and the reference. At 2.4 m
looking down an avenue you see a bare grey slab.

Three sub-problems. Full fix proposals — evidence, steps, and the check that
proves each closed — are in [`HANDOFF.md`](HANDOFF.md) as F5, F1/F2 and F4
respectively. Do them in that order; the third is nearly free.

1. **Ground detail.** No lane markings, no kerb read, no drain covers, no clutter
   at eye height. The `bakeGround` kerb strips exist but are barely visible.
   *Why it matters:* it is 60% of the pixels in a street-level shot, and it is
   the cheapest large-area quality win available. → **F5**
2. **Crowd density and distribution.** **Blocked on F1 and F2 first.** The
   crowd's two visibility predicates report 250 and 0 in the same frame, and the
   two poses meant to show it are hardcoded at the world origin while the crowd
   centroid sits ~975 units away. Until both are settled, do not tune density:
   you cannot tell a distribution problem from a rendering one, and two
   previous sessions misread this as a winding bug and then a culling bug.
   *Watch out:* raising the count without fixing distribution just produces a
   clump — see `PITFALLS.md` §9. → **F1, F2**
3. **Traffic on screen.** `TrafficSim` already produces 207 vehicles on real rail
   lines. `Renderer.drawEntitySet` already works. This is wiring, not design.
   → **F4**

**Done when:** a street-level pose contains trams on the rails, cable cars above,
and people on the pavements, at a density where the far end of the street is
visibly busy — and that pose is derived from the crowd centroid, so the shot
cannot be quietly framing empty ground (D21).

## R2 — Fix the night

**Status: todo** · **Priority: high** · *Vision: "atmostpheric lighting and
atmostphere effects are vey important"*

Night is currently a purple murk. It should be the **brightest** frame in the
set — that inversion is what makes a night city read.

The pieces exist: window emissive is synthesised, lanterns and signs are baked
with emissive masks, the light binner runs, `WeatherDirector` has a `night` phase.
What is wrong is the *authoring* — ambient, exposure, bloom and the emissive
multiplier for that phase. The weather self-test shows the phase rig is
internally consistent; it is simply aimed too dark.

*Engineering note:* this is a cheap fix with a large payoff, and it is the only
item that unlocks an entire visual register (lit windows, headlight cones, wet
reflections) that the rest of the renderer already supports.

*Proposed approach.* Because the rig is internally consistent and merely aimed
too dark, treat it as an authoring pass over the `night` phase, not a bug hunt:
raise the window-emissive multiplier and ambient floor, then pull exposure down
to compensate so highlights keep their roll-off. Use the `--grab` harness flag to
sweep phase parameters in one run rather than editing and re-shooting by hand,
and judge with `node tools/compare.mjs --pose=night --ref <video>` against a
reference night frame. *The verification that matters: night must become the
brightest frame in the set, not merely a brighter purple murk.*

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

**Status: todo** · **Priority: medium** · *Vision: "use performance tricks"*

A wide aerial is 1.0–4.6 M triangles with 126 visible chunks, and the shadow
cascades dominate. `bakeChunk` takes an `lod` parameter and LOD 1/2 are written,
but **every chunk is baked at LOD 0 and nothing is ever swapped in at distance**.

Also worth doing: shrink the far cascades' shadow atlas, instance the city into
a smaller number of draw calls, and move chunk baking off the critical path (it is
already budgeted, but 4 ms of a 16 ms frame is a lot when the renderer needs it).

*Why it matters:* "performance tricks" is an explicit requirement, and the
performance governor in `main.ts` will silently drop quality tiers on weaker
hardware unless the budget is genuinely there.

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

**Status: todo** · **Priority: medium** · *Vision: "atmostpheric lighting and
atmostphere effects are vey important" (repeated in the prompt)*

`godRays` and `precip` exist in state and drive **nothing**. The reference frames
lean on shafts of light cutting through canyons, and on rain.

Shafted volumetric fog is the single most recognisable element of the reference
material and is currently missing entirely. `WeatherDirector` already models
sunbreak, fog-bank and lightning, which are exactly the events that should drive
it.

## R7 — Water and the canal

**Status: todo** · **Priority: low-medium** · *Vision: implied by the
inspiration stills*

`bakeGround` returns `{ mesh, water }` and the water mesh is never consumed. The
canal district exists and `waterDepthAt` works. Reflections would sell the canal
level and the night shot enormously.

## R8 — WebGL 2 backend

**Status: decision** · *Vision: "use webgl 2 and webgpu"*

The prompt asked for both. Only WebGPU exists. See
[`ORIGINAL_PROMPT.md` § The one outright deviation](ORIGINAL_PROMPT.md) for why,
and for the cost. The decision itself is recorded in
[`DECISIONS.md`](DECISIONS.md).

Genuinely a second renderer: no compute (the light binner needs a transform
feedback path), GLSL ES 3.00 instead of WGSL, no `float32-filterable`, and the
whole frame graph re-authored. Weeks, not days.

The alternative — a hard-fail with a clear message (current behaviour) — is
honest but reaches nobody. **This needs a human decision, not an agent's
guess.**

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

R4 (perf)          ──  before the governor starts eating quality on weak hardware
R6 (atmosphere)    ──  the most recognisable missing element of the references
R5 (destructible)  ──  explicitly requested, spectator-scale is enough
R7 (water)         ──  cheap once R1 makes streets matter
R9 (districts)     ──  polish
R8 (WebGL 2)       ──  decision, not work (D1)
R10 (iteration)    ──  partly done: compare.mjs landed, warm boot is F6
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

**Status: todo** · **Priority: highest** · *Vision: "large sections of the city
have differing styles and colors like a real city"*

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
4. **C fire-lit** — **not a reskin.** No district is a ruin. Needs new grammar
   (soot, collapse, ember emissive, smoke) and has no design yet.

**Done when:** a pose in each section holds up against its own sheet at close
focus, **and** `wide-skyline` still reads as a city of visibly different places.
The second condition is the one that catches failure — sections can each look
correct alone while the city has quietly become one place.

**Per section, also add a close-focus capture pose.** The doctrine requires
detail at 3 m and no such pose exists for any section yet.
