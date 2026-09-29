# Decisions

Architecture decisions made during bring-up, with the alternatives that were
rejected and why. Recorded because the most expensive thing a new session can do
is re-litigate a settled question, or worse, "helpfully" undo one without knowing
it was load-bearing.

Format is deliberately not ADR-with-status. Nothing here is revisable-by-default;
several would be actively harmful to reverse casually. If you disagree with one,
the last column tells you what to check first.

---

## D1 — WebGPU only, no WebGL 2 backend

**Decision.** The renderer is WebGPU. `src/core/gpu.ts` requests an adapter and
device from `navigator.gpu` and there is no GL path.

**Why.** WGSL compute is load-bearing for the light binner. The deferred
G-buffer maps cleanly onto WebGPU's multi-render-target, which is the single
biggest win in the project. A half-finished GL backend would have been a second,
worse codebase living alongside the first.

**Rejected.** A shared abstraction with two shader languages. Rejected as a trap:
it halves the performance ceiling in exchange for reach, and the ceiling is the
product.

**Cost, stated plainly.** Anyone without WebGPU sees nothing. The prompt asked
for both. Tracked as **R8** in the roadmap — it is a product decision, not
overdue work.

**If you think this is wrong:** the thing to check first is how much of the
renderer actually needs compute. The light binner is the only hard requirement,
and it is ~80 lines.

---

## D2 — Reverse-Z for the main pass, conventional depth for shadow maps

**Decision.** The G-buffer and camera are reverse-Z: near maps to 1, far to 0,
clear is `0.0`, and the depth test is `greater`. The shadow maps use conventional
depth: clear `1.0`, test `less`, and the lookup converts with `1.0 - proj.z`.

**Why.** Reverse-Z gives dramatically better depth precision across a 600 m city
with a 0.1 m near plane. The hybrid costs one subtraction and keeps the shadow
pass on the well-trodden `less` convention, where subtle bugs are well
understood.

**Rejected.** Making the shadow maps reverse-Z too, for consistency. Rejected:
flipping the comparison mode is four sign changes and a class of bug that is
tedious to debug and invisible when wrong. The comment in `common.wgsl` says do
not "unify" this.

**If you think this is wrong:** nothing is broken. It is inconsistent, and
inconsistency has cost this project before.

---

## D3 — Bounded fog, not the analytic height-fog integral

**Decision.** Optical depth is `haze * (dist / 900)` modulated by a height
weight evaluated at the *lowest* point of the ray. Bounded by construction.

**Why.** The textbook analytic integral of a pure `exp(-k*y)` density is correct
and unusable: over a kilometre of ray through a canyon it reaches ~9 optical
depth, which is 99.98% opaque, so every frame becomes a flat wash of fog colour.
The brief calls atmosphere "very important" and names it twice, which means fog
has to be an *art-directable dial*, not a physical constant.

**Rejected.** A preetham-style aerial-perspective model. Rejected because it goes
wrong the moment cloud cover or storminess change, which is exactly the axis the
LLM conductor pulls on.

**Invariant to preserve.** `haze` in `0..1` must map to a legible range. If you
change `FOG_SCALE`, check that `haze: 0.14` (the default) still reads as clear.

---

## D4 — Analytic sky, not Preetham or Hosek

**Decision.** A hand-written gradient: day/dusk/night ramps, a Mie forward-scatter
term, and two domain-warped fbm cloud layers.

**Why.** Same reason as D3. The weather system is an *authoring* surface driven by
an LLM; a physical fit that produces a grey sky for `cloudCover: 0.7,
storminess: 0.4` is useless, because there is no natural mapping from those
numbers to a Hosek turbidity.

**Cost.** Less physically plausible. Deliberate.

**Related.** Fog colour, ambient IBL and specular reflections all sample the same
`skyRadiance()`. That is why fog, sky and reflections always agree. **Do not add
a second sky implementation** for any of them.

---

## D5 — Deferred rendering

**Decision.** G-buffer with three colour attachments plus depth, resolved by a
fullscreen lighting pass.

**Why.** The scene is many small local lights (windows, lanterns, signs, vehicle
lights) against a mostly static city. Deferred makes that a clustered lookup
rather than a per-pixel loop over every light. WebGPU's MRT makes the G-buffer
essentially free.

**Rejected.** Forward+ with a clustered light list. Rejected as strictly more
complex here: the facade is synthesised in the fragment stage, and its
albedo/roughness/emissive outputs are consumed exactly once, so there is no
overdraw argument to win.

**Cost.** No MSAA. This is why aliasing is currently the worst rendering artefact
(**R3**). Deferred+ was the obvious alternative and is the right answer *if* the
bottleneck turns out to be shading rather than geometry.

---

## D6 — Zero texture assets; the facade is synthesised procedurally

**Decision.** Every building wall, window, sill, shopfront, awning, sign and
grime streak is computed in `gbuffer.wgsl` from world position. There is not one
image file in the repository.

**Why.** It gives a city of unbounded apparent detail and zero asset pipeline,
which is what makes an infinite streaming city tractable at all. A 256 m chunk
bakes in ~1.5 ms with no texture decode anywhere.

**Rejected.** A texture atlas. Rejected on streaming cost and on the fact that
tiled facade textures at this density read as wallpaper.

**If you are tempted to add a texture:** that is a much larger architectural
change than it looks, because the whole point is that detail is *procedural and
seeded per building*. Add it as its own decision, not as a side effect.

---

## D7 — Chunks bake to world-space meshes, one draw per chunk

**Decision.** Each 256 m chunk is baked to a single world-space mesh with an
identity instance, drawn with one indexed call. Not per-building instancing.

**Why.** ~22 buildings, ~950 props, ~46 cables and ~9 skybridges per chunk is
~8 k triangles. One draw beats 1000. Streaming is a single buffer upload per
chunk, and frustum culling is a per-chunk sphere test rather than per-object.

**Rejected.** Instanced buildings sharing one unit-cube mesh. Rejected because
buildings are not boxes — they have setbacks, pilasters, parapets, crowns and
district-specific silhouettes. Instancing would have flattened exactly the
detail that makes the city read.

**Consequence to know:** LOD 1 and LOD 2 are *written* in `bakeChunk` but
nothing ever swaps them in. Every chunk is baked at LOD 0. Tracked as **R4**.

---

## D8 — Crowd simulates on the CPU, in structure-of-arrays

**Decision.** 6000 agents in flat `Float32Array`s, a spatial hash rebuilt on a
stagger, steering on the CPU, gait in the vertex shader. ~2 ms/frame.

**Why.** A free-flying camera only needs agents near it, and view-radius culling
means the expensive population is never simulated. CPU steering is debuggable
under `vite-node`, which is worth more at this scale than GPU occupancy. The
motion that sells life at city distance is a walk cycle, which is a vertex-shader
trick, not a simulation problem.

**Rejected.** GPU-resident boids. Rejected as speculative: the binding and
debugging cost exceeds the benefit at a population the view-radius cap already
keeps small.

**Load-bearing invariant:** the hot loop allocates nothing. No `.map`, no spread,
no object literals per agent per frame. This is easy to break by accident and
hard to notice.

---

## D9 — One flat `WorldState` record

**Decision.** All mutable world state is a single flat object in
`src/core/state.ts`: weather, sun, lens, events, perf, counters.

**Why.** It makes the LLM conductor's tool schema a direct JSON projection of
the state, and it makes a save/restore a single `JSON.stringify`. The prompt asks
for LLM control of weather, camera and events; this is the shape that makes
those three things cheap.

**Rejected.** A class graph with observers. Rejected as ceremony: nothing here
needs to notify, and the object can be diffed and snapshotted for free.

**Note.** Systems may derive from it, never write to it, except the ones that own
their field (`WeatherDirector` owns weather targets, for instance).

---

## D10 — No runtime npm dependencies

**Decision.** The application imports nothing at runtime. Raw WebGPU, raw WGSL,
Vite for bundling. Dev dependencies: Vite, TypeScript, Playwright, `@webgpu/types`.

**Why.** The renderer is the product and it should be legible end to end. There
is no Three.js/Babylon layer between the frame graph and the hardware, so every
performance decision is visible.

**Rejected.** A scene graph library. Rejected: instanced draws, custom
attachment layouts and the deferred pipeline would all have to be fought.

---

## D11 — The capture harness hard-fails on GPU errors

**Decision.** Any WebGPU validation or WGSL error marks the run
`INVALIDATED` and exits non-zero. It does not appear as a footnote.

**Why.** A black screenshot with the reason in the footer is indistinguishable
from a dark scene. This cost roughly an hour: a WGSL error invalidated the post
module, every shot went black, and the harness cheerfully reported
`PASS · 9 shots`.

**Do not relax this.** It is the difference between a broken run being noticed in
one shot and in one hour.

---

## D12 — The capture harness always uses the Vite dev server

**Decision.** `useDev` is hardcoded true. `vite preview` is never used.

**Why.** A `preview` build is a stale `dist/`. A screenshot of a stale build
looks perfectly valid and is completely wrong. The harness once captured a full
passing set from a build predating the fix under test.

---

## D13 — One `clangd` LSP entry, not a `c` and a `cpp` entry

**Decision.** `~/.config/opencode/opencode.json` declares `clangd` once.

**Why.** `clangd` is a single server that dispatches on file extension. Two
entries would spawn two competing processes and report every diagnostic twice.

---

## D14 — Canyons are emergent, not authored

**Decision.** The generator lays down a street *field* (warped grids, meandering
arteries, three deliberate spines) and then *drops* building lots wherever they
would not foul a carriageway. Canyons are whatever falls out.

**Why.** Hand-authored canyons do not compose at city scale, and do not survive
being 600 m tall. The brief asks for "surreal proportions" in something that
reads as real — emergent geometry gets that for free, because the street network
is plausible and the buildings on it are not.

**Consequence:** canyon width is a *statistical* property. The self-test asserts
p50 ≈ 20 m free width. If a change moves that number, the change altered the
city's character.

---

## D15 — Districts are fixed archetypes placed by a field, not derived

**Decision.** 11 named district styles with authored palettes and building
grammars, placed by `districtAt(x, z, seed)` — a domain-warped fbm plus spines.

**Why.** "Large sections of the city [differing] in styles and colors like a real
city" is a *legibility* requirement. Procedurally derived palettes drift toward
the same muddy average no matter how they are seeded. Authored archetypes give
11 genuinely different places, and the placement field gives coherent boundaries.

**Cost.** The palette set is closed; it cannot express a district the brief
implies but nobody wrote down. Adding one is cheap and encouraged.

---

## D16 — Colour is linear end to end, tonemapped exactly once

**Decision.** `hexLinear()` at generation, linear palettes, linear shading,
linear HDR targets, one tonemap in `composite`, then saturation/grade/vignette.

**Why.** Everything in the pipeline is additive and multiplicative. Any sRGB
decode in the middle shows up as a specific, hard-to-place family of colour bugs.

**Load-bearing.** It is very easy to write `vec3f(0.5)` meaning "mid grey" in a
shader. In this pipeline that is a *value of 0.5 linear*, which is much brighter
than intended. This is the single most likely source of a future
colour regression, and the hardest to see.

---

## D17 — A material id is a contract about scale

**Decision.** `MAT` in `citymesh.ts` has ten ids. `MAT.DIFFUSE` (0) routes into
the building facade synthesiser; `MAT.PLAIN` (9) exists for anything sub-building
scale; `MAT.STREET` (8) for the ground.

**Why.** See `PITFALLS.md` §8. Pedestrians used `MAT.DIFFUSE`, fell inside one
3.1 m × 3.6 m window cell, and were shaded as dark glass. 2500 of them were
rendering, every frame, completely invisibly.

**Rule:** if something is much smaller than a building, it needs its own id. Not
a comment — a requirement.

---

## D18 — Instance records are 24 floats, mat4 + tint + params

**Decision.** `mat4` model (16) + `tint rgba` (4) + `params` (4). Built by hand
into a `Float32Array` and uploaded in one `writeBuffer` per frame.

**Why.** One contiguous upload beats 2500 small ones, and a fixed 96-byte stride
keeps the vertex layout trivial. `params` carries matId, roughness, emissive and
a free slot, which is enough to specialise every material.

**Trap.** The *builder* writes 4 floats of colour per vertex (rgb + emissive
mask); the *interleaved buffer* writes 3 plus a separate emissive float. A stride
mismatch between those two produced the single worst bug in the project. See
`PITFALLS.md` §7.

---

## D19 — No gameplay, by omission

**Decision.** No score, no objectives, no fail state, no HUD beyond diagnostics.

**Why.** The brief says it twice: "there is no gameplay it is an interactive
simulation experience".

**This is a constraint, not an omission.** If a change starts adding objectives,
collectibles, or win conditions, it is wrong. Diagnostics are fine; the stats
overlay is a debugging tool that happens to be always available.

---

## D20 — Events are durable and in-world, not fire-and-forget

**Decision.** `trigger_event` pushes onto `world.events`; systems read
`event.intensity` and react. Nothing is a one-shot callback.

**Why.** The conductor can layer events, and a monsoon plus a lightning strike
should compose rather than fight. It also means the LLM can ask "what is
happening?" and get an answer.

**Invariant:** events ramp in and out over their lifetime. `integrateWorld`
owns the envelope. Never snap an event's effect on.

---

## D21 — Diagnostic poses are derived from live state, never hardcoded

**Decision.** A capture pose whose job is to show a system must compute its
position from that system's live state — centroid, nav node, camera — not from
coordinates typed in by hand.

**Why.** `01b-crowd-closeup` was hardcoded at `position: [0, 2.4, -40]` while
the crowd centroid sat at `(974, 46)`, ~975 units away and outside
`viewRadius: 190`. The pose was never looking at its subject. It reported an
empty street, and two separate sessions read that as a *rendering* fault — first
entity winding, then G-buffer culling — chasing the renderer for a problem that
was entirely in the pose. A control run killed it: `pedestrian:0/180` under
both cull modes.

**This generalises.** Any hardcoded pose silently becomes a lie the moment the
thing it frames moves. The city generates deterministically but the crowd does
not stay where it was seeded, so "deterministic world" does not make hardcoded
camera coordinates safe.

**Check first:** if a diagnostic shot shows an absence, confirm the camera and
the subject are co-located *before* touching the renderer.

## D22 — Reference media and screenshots are not stored in git

**Decision.** `inpirations/**/*.mov` (~670 MB) and all of `shots/` are
untracked, gitignored, **and purged from history**. `.git` is 1.3 MB.

**Why.** The videos are the quality bar, not source. They live on disk; every
session has them; committing 670 MB of binary buys nothing. The untracking
happened in `a893dbe`, after `.gitignore` had already listed them — and because
they were still tracked, that earlier entry was doing nothing at all. A
configuration file that claims a benefit it does not deliver is worse than no
entry, because it reads as done.

**Done, on explicit instruction.** History was rewritten with
`git filter-repo --invert-paths --path-glob 'inpirations/**/*.mov' --path shots`,
after copying all nine videos to a backup outside the repository and verifying
every file by md5 first. `.git` went from **929 MB to 1.3 MB**.

Three consequences, all accepted deliberately:

- **Commit hashes all changed.** Any clone or fork must be re-cloned; the old
  history is unreachable. This is the cost of the operation and was authorised
  with full knowledge of it.
- **The videos are not recoverable from a fresh clone.** They must be copied
  from a working checkout before `tools/compare.mjs --ref` can extract a frame.
- **`shots/baseline/` is gone from history too.** Screenshots were never source
  and a 10-pose run is ~25 MB; storing renders in git was never worth 210 MB of
  clone. `compare.mjs` falls back to `CURRENT | REFERENCE` when the baseline is
  absent — a weaker comparison, not a broken one. Re-capture if a committed
  baseline is ever wanted again.

**A note on doing this again.** `git filter-repo --path 'inpirations/**/*.mov'`
— with `**`, as a `--path` argument rather than `--path-glob` — reports success,
rewrites nothing, and prints a cheerful "Completely finished". The first attempt
did exactly that, and `.git` barely moved. **Verify a rewrite by checking a
known-absent object, not by the tool's exit status.** That is
[`PITFALLS.md`](PITFALLS.md) §3 in a new costume, and it is why the first
rewrite had to be redone.

---

## Open decisions

Decisions this project has deliberately *not* made. Do not resolve one in passing.

- **WebGL 2 backend.** Settled as *WebGPU only* (D1); the brief asked for both,
  and the cost of the second backend is weeks. Revisit only if the brief's
  intent changes.
