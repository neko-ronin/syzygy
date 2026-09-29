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

The nine `.mov` files in `inpirations/dreamscape/` are the bar. Extract frames
before any aesthetic judgement:

```bash
ffmpeg -i inpirations/dreamscape/dreamscape-01.mov -vf "fps=1/6,scale=420:-1" /tmp/f%02d.jpg
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

Three sub-problems, and the third is nearly free:

1. **Ground detail.** No lane markings, no kerb read, no drain covers, no clutter
   at eye height. The `bakeGround` kerb strips exist but are barely visible.
   *Why it matters:* it is 60% of the pixels in a street-level shot, and it is
   the cheapest large-area quality win available.
2. **Crowd density and distribution.** The crowd renders and is placed on real
   streets, but ~1900 people over a 320 m disc is thin per avenue. *Watch out:*
   raising the count without fixing distribution just produces a clump — see
   `PITFALLS.md` §Snap collapse.
3. **Traffic on screen.** `TrafficSim` already produces 207 vehicles on real rail
   lines. `Renderer.drawEntitySet` already works. This is wiring, not design.

**Done when:** a street-level pose contains trams on the rails, cable cars above,
and people on the pavements, at a density where the far end of the street is
visibly busy.

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
and for the cost.

Genuinely a second renderer: no compute (the light binner needs a transform
feedback path), GLSL ES 3.00 instead of WGSL, no `float32-filterable`, and the
whole frame graph re-authored. Weeks, not days.

The alternative — a hard-fail with a clear message (current behaviour) — is
honest but reaches nobody. **This needs a human decision, not an agent's
guess.**

## R9 — Districts that read as places

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
minute. See [`PROCEDURES.md`](PROCEDURES.md).

---

## Ordering

```
R3 (aliasing)      ─┐  the base image has to be stable before polish means anything
R1 (street level)  ─┤  the biggest visible gap
R2 (night)         ─┘  cheap, unlocks a whole visual register

R4 (perf)          ──  before the governor starts eating quality on weak hardware
R6 (atmosphere)    ──  the most recognisable missing element of the references
R5 (destructible)  ──  explicitly requested, spectator-scale is enough
R7 (water)         ──  cheap once R1 makes streets matter
R9 (districts)     ──  polish
R8 (WebGL 2)       ──  decision, not work
R10 (iteration)    ──  continuous, do opportunistically
```

## What "spectacle" means here

The stated product goal is a showcase for AI model releases. That sets the bar
higher than "works": the test is whether a single frame, paused, is worth
looking at. The reference frames pass that. The current skyline shot
marginally passes; the night shot does not; the street-level shots do not.

When choosing between two ways to spend an afternoon, prefer the one that makes
a *frame* better.
