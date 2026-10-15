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

**Status: CLOSED — ratified by the human owner, 2026-10-01.** Not revisable
without them. This is a scope decision, not a known gap and not overdue work.

**Decision.** The renderer is WebGPU. `src/core/gpu.ts` requests an adapter and
device from `navigator.gpu` and there is no GL path.

**Ratified by the human owner, 2026-10-01.** Verbatim: *"we're shelving webgl 2.
we're going all in on webGPU. that's what the team has been building right?"* —
that last clause was a question, and it was checked rather than assumed.
**Confirmed: yes.** WebGPU is the only thing that has ever been built here.
Measured across the tree on 2026-10-01:

| Claim | Evidence |
| --- | --- |
| Six shaders, all WGSL | `src/shaders/*.wgsl` — six files, zero `.glsl` / `.vert` / `.frag` anywhere in `src/`, `tools/` or `server/` |
| No GL context is ever requested | `getContext` appears exactly twice in the whole source tree: `'webgpu'` (`gpu.ts:106`) and `'2d'` (`main.ts:630`, the minimap/PNG canvas). No `'webgl2'` call exists |
| No fallback path | `gpu.ts:74` throws when `navigator.gpu` is absent; `main.ts:64` surfaces that as a hard-fail boot message |
| `BackendKind` never carried a live second member | It was `export type BackendKind = 'webgpu' \| 'webgl2'`, but `Caps.backend` had exactly one producer, the literal `'webgpu'` (now `gpu.ts:127`). `'webgl2'` was never constructed. It is now `export type BackendKind = 'webgpu'`, and nothing outside `gpu.ts` ever referenced either the type or `Caps.backend` |

This was previously filed as *the one outstanding deviation from the brief*. It
is not outstanding. It is a ratified scope decision, closed on 2026-10-01, and
nothing should reopen it without the human owner saying so. The `'webgl2'`
member of `BackendKind` and a `WebGPU/WebGL2` package description were both
removed in the same change as this entry, for the reason
[`PROCESS.md`](PROCESS.md) rule 5 exists: a name in a type union is a claim
that something exists, and it sat there long enough to be believed.

**Why.** WGSL compute is load-bearing for the light binner. The deferred
G-buffer maps cleanly onto WebGPU's multi-render-target, which is the single
biggest win in the project. A half-finished GL backend would have been a second,
worse codebase living alongside the first.

**Rejected.** A shared abstraction with two shader languages. Rejected as a trap:
it halves the performance ceiling in exchange for reach, and the ceiling is the
product. This reasoning still stands and is kept deliberately — it is the reason
the decision is not "just add a second backend later".

**Cost, stated plainly.** Anyone without WebGPU sees nothing. The prompt asked
for both. That trade is now accepted rather than outstanding; **R8** in the
roadmap records the scope decision, not a task.

**Shelving the backend does not retract portability.** The owner may still port
to three.js or WebGL 2 later. The algorithms are written to allow it, and three
comments say so on purpose: `src/render/cascade.ts:6`,
`src/shaders/post.wgsl:324`, `docs/WATER_AND_VOLUMETRICS.md:27`. Keep them;
they are the reason the current design can move. Portability is not a promise of
a second backend.

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

**Decision.** The nine `.mov` files in `inspirations/dreamscape/` (~670 MB) and
all of `shots/` are untracked, gitignored, **and purged from history**. `.git` is
1.3 MB.

*The directory was `inpirations/` — misspelled — at the time of the purge. It has
since been renamed to `inspirations/`; the commands quoted below are the ones
actually run, and retain the old spelling for the record.*

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

**A note on doing this again.** `git filter-repo --path 'inspirations/**/*.mov'`
— with `**`, as a `--path` argument rather than `--path-glob` — reports success,
rewrites nothing, and prints a cheerful "Completely finished". The first attempt
did exactly that, and `.git` barely moved. **Verify a rewrite by checking a
known-absent object, not by the tool's exit status.** That is
[`PITFALLS.md`](PITFALLS.md) §3 in a new costume, and it is why the first
rewrite had to be redone.

---

## Open decisions

Decisions this project has deliberately *not* made. Do not resolve one in passing.

**None.** The last entry — the WebGL 2 backend — was answered by the human owner
on 2026-10-01 and folded into D1, which is now closed rather than open. This
section is kept, empty, because the next open decision should not have to invent
a place to go.

---

## D23 — "Hyperreal" means exaggerated and stylised, not photoreal

**Decision.** The target finish is **painterly and graphic overall, detailed at
close focus**. Realistic materials are correct and retained; they read as
painterly through value grouping, atmosphere, depth of field and a single
dominant light. PBR is the substrate, not the aesthetic.

**Why.** The brief says "visually hyperrealistic city simulation syled with
surreal proportions", and separately that quality should reach "near or surpasses
**the videos**". Read together, and confirmed by the human author of the brief:
"hyperreal" means *exaggerated and stylised*. It cannot mean photoreal, because
the same sentence asks for surreal proportions, and the reference material is
painted. Read as photoreal, the clause contradicts itself.

**Consequence that matters:** the renderer keeps its physically-based shading and
its filmic post chain. Nothing is thrown away. What changes is the budget —
detail has to survive a 3 m inspection, the eye must read large shapes and colour
relationships first, and silhouette legibility is the test for every frame.

**If you think this is wrong:** open `references/D-verdant-sheet.jpg` and
`solarpunk-metropolis-01.jpg`. They are painted, and they are the doctrine.

---

## D24 — The design workflow is: per-section reference sheets, compared per pose

**Decision.** The city is four **sections** (A saturated-graphic, B
cold-industrial, C fire-lit, D verdant-solarpunk), derived from six of the nine
reference videos. Each section has a curated contact sheet in `references/`, a
pose→section map, and its own done-when. `tools/compare.mjs --auto` judges each
pose against the sheet for the section it belongs to.

**Why.** A single reference frame collapses four distinct places into one look,
and the brief requires that "large sections of the city have differing styles and
colors". Worse, a single frame invites a category error: a night frame was
compared against a daylight shot, and the conclusion drawn was wrong. Per-section
comparison makes both failures structurally hard.

The reference videos are not in git (D22), so the sheets and
`references/sections.json` are what a fresh clone actually receives. That is the
point of committing them: the design guidance has to survive the clone.

**Cost, stated plainly.** 3.8 MB of committed images, against a project that
purged 929 MB of reference material. The distinction is curation: four small
sheets an agent can read are design documentation, not bulk binary.

**The check that catches failure:** a *section* shot must hold up against its own
sheet, and a *wide* shot must still read as a city of visibly different places.
Optimising only the first is how a city quietly becomes one place.

---

## D25 — A pedestrian's lane is a hard constraint, and goals must respect it

**Decision.** The pavement hold stays a **non-negotiable** constraint. Goal
assignment is what changes: an agent's destination is drawn from **its own side
of the carriageway**, so path-following and the lane constraint stop opposing
each other. Crossings are possible; they are not continuous.

**The measurement that forced it.** Watching one agent's `z` across frames:

```
  frame |  z before | hold corr |  z after
      0 |   0.3763  |   0.0233  |   0.3761
      1 |   0.3761  |   0.0233  |   0.3759
      3 |   0.3757  |   0.0233  |   0.3755
```

The hold adds **+0.0233 m** in z. The written z **falls 0.0002 m**. About
0.0224 m/frame is removed — at `dt = 1/60` that is **−1.34 m/s**, and `pace` is
seeded in `[0.85, 1.75]`, so this agent was walking in −z at essentially its
full speed while the lane hold cancelled it. `max |correction|` is exactly
`HOLD_SPEED * dt`, so the hold sat **at its ceiling on every agent, every
frame** — straining, never easing.

The standoff was **25.9 m**, and every body settled on the surface where its own
goal and its own lane happened to cancel. That surface is a straight line. It is
the kerb-hugging comb the vision gate rejected as "a continuous frontage-like
ribbon", and it read as an empty street to two sessions.

**Why the lane wins and the goal yields.** Two options were on the table:

| | option | why not / why |
| --- | --- | --- |
| (a) | goal respects the lane | **chosen** |
| (b) | the hold yields to an agent making progress | rejected |

(b) is rejected twice over. First, a soft constraint is how bodies end up inside
bodies again — `R12` sub-problem 2 exists *because* agents overlap freely, and
trading a solved problem for an unsolved one is a bad trade. Second, and more
sharply: **"making progress" is not a safe test.** An agent being dragged
backwards by the hold always retains some residual velocity, so a
progress-based yield lets some agents be dragged indefinitely. The failure is
silent and the guard does not catch it.

A person crosses a street; they do not walk permanently into oncoming footway
traffic. So an agent whose destination is genuinely across the carriageway should
**cross and settle on the far footway** — a transient, not a permanent standoff.

**What this decision does NOT claim.** Crossings are not implemented. An agent
whose real destination is across the road still gets an unfiltered destination as
a fallback, so a crossing is reachable; it is not modelled, not animated, and
not verified. What this fixes is the permanent standoff that made the street
unreadable.

**Do not "fix" this by softening the hold.** If the street reads badly again, the
next question is whether goals are lane-aligned, not whether the lane should
yield. Reversing this trades a legible street for a crowd of bodies inside one
another, and it will look like progress.

**The check that catches failure:** `npx vite-node src/sim/__selftest_spread.ts`
asserts both footways carry 30–70% of the crowd and that z IQR about the centroid
exceeds 1.0 m. Both thresholds are the standing contract and are not to be
relaxed to make a change land.

**Status: the decision is in force; the first implementation did not land it.**
Lane-aligned goal selection was implemented (goals drawn from the agent's own
side, with an unfiltered fallback so a crossing stays reachable) and measured:
footway balance **94.7% left** against 94.6% before, z IQR **0.04 m** unchanged,
**both assertions still FAIL**. The change was reverted rather than shipped.

So the standoff is real and measured, but goal selection is **not** the term that
opposes the hold — at least not through `randomNodeNear`, and not within one
600-frame settle (goals are repicked on arrival or `ttl`, and `ttl` is 35–150 s,
so many agents never repick during a settle at all).

**What this means for the next round.** The opposing force is a force, not a
goal: the agent is walking at ~1.34 m/s in −z, and that motion survives a
lane-aligned destination. The next place to look is the steering term itself —
`stepAgent` steers toward `pathNodeAt(i, k)`, the *k-th waypoint*, not the goal,
so the waypoint can still lie across the carriageway even when the destination
does not. Measure what the steering is actually aiming at before changing it.

---

## D26 — The crowd is a local simulation, and the city stages scenes

**Decided by the owner, 2026-10-02.** This supersedes the framing of D25 and
redirects `R12`.

### The decision

Crowd behaviour is **local-first**, in three borrowed layers:

- **Lenia / cellular-automata style** — occupancy and interaction emerge from
  local rules over a field. No global "place N people on the pavement" pass.
- **Boids-style separation** — the operative near-term requirement: agents move
  without colliding. Separation, alignment and cohesion are local steering terms.
- **Hollywood scene-making with Extras** — the city has *scenes*. Certain
  sections **emit a script**; an NPC picks one up and **acts it out**. Market
  stalls, crossings, transit landings and plazas are stages with parts, not
  merely places with density.

**Priority: later stage.** It is an important vertical slice, and it is explicitly
*not* what the next few rounds are for. The near-term goal is narrow and
achievable: **agents move around without colliding.**

[Reference scene notes](VISION_ROUND8.md#scene-notes-for-the-later-stage)
describe the visible relationships in the opened frames and distinguish them
from inferred behaviour. They are observations for later design, not new
requirements or authority to add scenes during separation work.

### Why D25 is superseded, and what it cost to learn

D25 held that the lane is a hard constraint and goals must respect it. That is
not wrong as a statement about a lane, and it is wrong as an architecture. The
measured failure was a **standoff between two global rules**: path-following
pulled each agent at ~1.34 m/s toward a waypoint while the lane hold pulled it
back at exactly `HOLD_SPEED * dt`, balancing to **0.0002 m/frame** with the hold
straining at its ceiling on every agent, every frame.

Six rounds were spent on that standoff — eight candidates refuted, the arithmetic
corrected twice, the mechanism fully explained, and **no fix shipped**. Every one
of those rounds was an attempt to make two global systems agree. Going local
means the spread is no longer something to be *placed*: separation itself produces
lateral spread, and no lane constraint is needed to hold an arrangement that was
never imposed.

### The measurement that was never taken

Separation steering **was** attempted and recorded as refuted. That refutation is
void. It was measured on a degenerate population — every agent on a 1-D line,
nearest-neighbour p50 **0.030 m** — and `docs/CROWD_SPREAD.md` says so itself:
*"confounded, do not read as avoidance."* **Avoidance has never actually been
measured in this project.** "Get them moving without collisions" is therefore not
a demotion. It is the first honest attempt at `R12` sub-problem 2.

### Consequences

- `R12` is reordered. Local avoidance first, flow and lanes second, scenes and
  scripts third.
- **The 0.04 m z-IQR spread defect is no longer on the critical path.** It was a
  symptom of the global-lane architecture, not an independent fault. It is kept as
  a measured, bounded, open observation — not chased.
- D25 stays in the record as the measured reason the architecture changed, and
  specifically so that nobody "fixes" the hold again.
- Any future work on lanes, waypoints or goal selection is a **scene-layer**
  concern — an NPC inside a scene — not crowd steering.

### What this does NOT authorise

No invented thresholds for "crowd-like" behaviour. Separation has a right answer
— bodies do not end up inside other bodies — and it gets measured. Scene quality
is a **frame judgement** by the vision reviewer against the reference sheets, and
never a number. `PROCESS.md` rule 1's scope limit applies to the whole slice.

## D27 — Teal towers keep their colour; window grids are reflective texture

**Owner direction, 2026-10-10**, after facades first reached the screen (the instance-bind fix):
the pale pastel teal towers lost their drama under dark window grids. Keep the dramatic teal
towers, with a window grid that is almost imperceptible — glass reflecting the cladding colour —
just enough to ground each tower as a banal building. Interior window glow fades in daylight.

### Consequences

- `DistrictStyle.reflectiveGlass` (copper-stacks, glass-foxholes): wall quads carry
  `FACADE_UV_REFLECTIVE`; `facade()` keeps glass, mullions, ledges and plant floors within a few
  percent of the wall colour. Their plinths keep ordinary shopfronts.
- Other districts keep dark glass (terracotta's lit grid reads well and was not in scope).
- Window glow follows `F.sunDir.y`: full at dusk and night, gone by mid-morning; shop displays and
  neon dim to ~1/3 by day.
- 2026-10-11: authored per-vertex emitters (lanterns, signs, beacons) keep 15% by day. Once
  facades reached the screen the noon lanterns saturated to flat white hexagons, which the R14
  vision review read as UI markers; night frames are pixel-identical (4% fuzz).
- Frame-edge lens streaks: accepted for now.

## D28 — A warm-lit world: artificial light stays amber

**Owner direction, 2026-10-12**, after seeing night district identity done by window colour
(teal towers cool blue-white, terracotta amber, `b17563d`): "I prefer the one amber
lighting. Let's presume this world still uses warm lighting and stays away from
blue-white light."

### Consequences

- Lit windows: one amber, with one in seven a paler warm white (was pale blue). The
  hue-following cool share is reverted.
- Other artificial lights made warm: skybridge lamps (were cool white), zipline trail
  (cyan), blimp (blue).
- Night district identity must come from something other than light temperature
  (silhouette, density, signage, features), not from cool light.
- The night sky and ambient stay as they are: this is about artificial light.

## D29 — The city plan is a history: every district, where its story puts it

**Owner direction, 2026-10-12:** "Changing district mix is back on the table. Fix this,
incorporate all the districts tastefully. Keep in mind aesthetics in viewpoints, skyline,
and plausible historical lore."

**What was wrong.** The organic table picked districts from about 25 noise cells across the
finite city: terracotta-tiers (sheet C's district) and neon-arcology (sheet A's) never
appeared, copper-stacks took 38% of the land and almost every tall building, canal-district
held only the water channel, and the downtown core blended into the outer table in
concentric rings around the origin (a bull's-eye of white, yellow, green and red bands).

**The story, as the plan encodes it** (`districtAtField`):

1. **Old town (terracotta-tiers)** grew where the canal meets the market road. Kilns,
   forges and lantern workshops: the fire-lit quarter of sheet C. r < ~360 m.
2. **Lantern bazaar** lines the market road out from the old town, and fills the suburbs
   on its west side.
3. **Canal quarter** (canal-district): warehouse conversions on the quays, low (25-90 m).
4. **Monastery hill** (monastery-spire): a small rise beside the old town; its needle
   spires are the skyline's mid-ground accent.
5. **Industrial belt** (rust-hangars) followed the railway, widening into estates past the
   suburbs.
6. **Downtown**, the boom: a +/-74 deg wedge 50 deg to the left of the market road
   (it turns with the road per seed). Copper-stacks body (the teal towers, still the
   largest tall district, D27), glass-foxholes flanks and far edge, the neon-arcology
   megastructures at its heart.
7. **Green belt**, the later reclamation: garden suburbs (verdant-canyon, now mid-rise
   45-150 m) and glasshouse farms (botanical-dome) in ~500 m patches on the outskirts.

Area shares (default seed): bazaar 18%, copper 17%, terracotta 16%, glass 10%, rust 10%,
botanical 9%, verdant 9%, canal 7%, neon 2%, monastery 1%, market street 1%.

**Viewpoints.** The outer review cameras sit south-east of the origin looking north-west:
the plan puts low districts in front of them and downtown behind the old town, so the
skyline reads low-historic foreground, spires mid-ground, towers behind. Verdant and
canal heights were lowered for that reason (at 130-430 m and 45-190 m they walled every
outer view).

### Sheet C in the old town (2026-10-12)

The old town (terracotta-tiers within ~400 m of the crossing) is a kiln, forge and
lantern-workshop quarter, part of it burnt out in a great fire:

- **Ruins** (17% of old-town buildings): the upper storeys gone, the roof fallen in
  below jagged wall stubs, sooted walls with no lit window, an ember bed inside.
- **Kilns** (60% of the rest): brick stacks with glowing mouths on the roofs, and forge
  openings at street level whose light reaches up the facades: sheet C's "fire is the
  key light and it comes from inside the canyon".
- **Bunting** across old-town and inner-bazaar streets at several low levels.
- **Smoke**: a low haze over the old town, grey-brown by day, lit amber from below at
  night.
- Terracotta-tiers became dense mid-rise (35-140 m), and the height boost moved from the
  origin (now the old town) to the downtown heart.

Review poses: `14-old-town-c` (22 m up an old-town alley at dusk) and
`15-old-town-ruins-night` (rooftops onto three ruins at night).

**Fire at street level (2026-10-13, review 5).** The ruins' kiln yards sat on their cut-down
tops, 20-40 m above a near-black street. They are now brick-kerbed ember beds against two
or three faces at street level, each with a low fire light, plus fire seen through the
ground-floor openings; the stubs keep one dim, unlit smoulder. A ruin's plinth carries the
ruin tag (it kept lit shop displays and neon). Old-town alleys carry braziers, firewood and
kiln stock (D30's lived kit), footway braziers lay their own light, post braziers and forge
mouths stand on a street-facing (local z) face, and old-town walls take two props a floor
with more wall lamps.

## D30 — A lived-in street: furniture where people use it, not only at the edges

**Owner direction, 2026-10-13:** "Change the rule for furniture. It's time to make the
world look more natural and lived in."

**What it supersedes.** STREET_SPEC §F said "cluster furniture beside fronts and route
boundaries, leaving coherent walking areas", and the ground bake encodes that as rule 1,
*edge, not middle* (`groundbake.ts` furniture placement, `CLUTTER_EDGE` in
`groundgrammar.ts`): every item goes to the building line or the kerb line. It kept early
streets from reading as debris, but it left wide walking areas empty. The market spine's
foreground and the hero street are bare paving with people standing on it (R14 reviews 4
and 5).

**The concern it protected stays:** uniform procedural repetition reading as noise. §F's
other two rules (irregular gaps, open stretches and clumps) still apply.

### The rule now

1. **Interiors, not just edges.** Wide walking areas (the market spine, plazas,
   footways wider than ~6 m) carry furniture inside them as *islands people use*: a tree
   with a ring bench, café tables and chairs spilling from a front, a kiosk, a water pump
   or tank, planter groups, stacked crates and sacks behind a stall, handcarts, a shrine.
2. **Keep a walking line.** Islands leave a continuous clear route at least ~3 m wide
   along the street, and every item registers a crowd obstacle (the existing
   `boundsSince` path), so the crowd flows around them rather than through.
3. **Signs of use over decoration.** Things people left: chairs at angles, crates half
   stacked, potted plants at doorsteps, a broom against a wall, laundry, a bicycle. Vary
   kind, orientation and spacing; nothing on a grid.
4. **District character**, from the section sheets: A (market) seating and stall overflow;
   B (industrial) barrels, pallets, cable drums; C (old town) braziers, firewood, kiln
   stock; D (verdant) planters, trees, café terraces. Light stays warm (D28).
5. **Budget by measurement.** `CLUTTER_TRIS` (9,000 triangles per chunk) may be revisited,
   but R14's 60 fps on this Mac stands; small items stay near-field (LOD 0).

### Consequences

- `groundbake.ts` rule 1 and `CLUTTER_EDGE` change; `__selftest_footway.ts` assumes one
  ~1 m clutter line per footway and needs a clear-route check instead.
- STREET_SPEC §F is annotated as superseded in part.

### As built (2026-10-13)

- **Where the islands go.** No authored footway reaches ~6 m (widest 5.72 m), so footways
  stay edge-placed and the islands are the market spine's: `MarketIsland` in
  `marketgrammar.ts` (placement, pure data), baked in `groundbake.ts` through
  `pushClutterItem` and one obstacle path (`pushObstacleSince`). Kinds: tree in a ring
  bench, cafe (tables, chairs at angles, parasols), kiosk, pump, planter group, stall
  overflow, handcart, shrine. Default seed: 104 islands over 1.3 km of spine.
- **The walking line.** Islands keep `|lateral| + radius <= half - 2.6 - 3.2`: a 3.2 m lane
  in front of the deepest stall overhang on both sides, which is also where the hero
  corridor stands. Measured on the baked chunks (`__selftest_footway.ts`): narrowest
  clear run across the spine 11.2 m over 1301 cross-sections (10.6 m once the stalls were
  dressed); every solid piece carries a crowd obstacle; no at-grade tram passes an island;
  every spine chunk lights all its market lanterns (PITFALLS §29).
- **An arterial runs inside the spine** either side of the origin (along -20..52 at the
  default seed), and the street field reports `artery` there. Islands accept any walkable
  carriageway (not canal, not rail), or every market review camera would look down the
  one stretch with none.
- **Footways.** District kits gain a `lived` list (sheet A cafe sets, sacks, handcarts; B
  barrels, pallets; C braziers, firewood, kiln stock; D cafe sets, pots, small trees),
  drawn alongside the authored kit at the same per-kind rate. A kind that would leave less
  than `footwayWalk(fw)` clear (3 m, or all but 1.1 m on narrow footways) is not placed
  (`clutterReach`). Front items stand their own depth off the building line (they were
  placed by their centre, half inside the wall), and every clutter box now carries its
  placer's yaw.
- **Budget.** `CLUTTER_TRIS` went 9000 -> 12000 and back to 9000 the same day: with the
  lived kits it doubled footway furniture near the hero and the session-end A/B lost 60 fps
  there (PERFORMANCE, 2026-10-13). Islands carry their own tally.

## D31 — A public build that shows the place, and a clock that spends it in the best light

**Owner direction, 2026-10-14:** "In essence we want to present the city in its best
lighting, golden hour, blue hour, and night." The public deploy (Cloudflare, static
files, `syzygy.catronin.com`) drops the conductor, the debug readout and the tool buttons.

**One flag, decided at build time.** `STATIC_SITE` (`src/core/site.ts`) is
`import.meta.env.MODE === 'web'`, true only for `npm run build:web` / `npm run deploy`.
Vite inlines it, so the conductor, the agent tools and the `__syzygy` automation surface
leave the bundle (452 kB -> 396 kB), not just the screen. Rejected: runtime detection by
probing `/api/health`. orbius did that and a host's SPA fallback answered the probe with
`index.html`, so the app believed a server was there (orbius DEPLOY_AUDIT_PLAN §5).

**Viewpoints, all builds.** Eight named camera poses (`src/camera/viewpoints.ts`), copied
from the curated establishing poses in `tools/capture.mjs`, on a bottom strip and keys
1-8. A jump cuts behind a dark veil and warms chunks first: a glide flies a straight line
through towers and arrives before the city around it has streamed in.

**Showcase clock, public only.** `showcaseDayLength()` runs the sun at 20x from sunrise
until the setting sun is at golden-hour height (0.13 rad), and in real time from there
through golden hour, blue hour, night and dawn. Only the sun: `timeScale` is untouched,
so the crowd and trams do not race. Measured loop: 502 s, of which 21 s at 20x, ~20 s
golden hour, 36 s blue hour (both sides), 420 s night (`src/sim/__selftest.ts`).

**Blue hour, all builds.** A `bluehour` phase rig between dusk/dawn and night (sun -2° to
-10°), and a matching ramp in `skyGradient` (common.wgsl). Without the sky ramp the rig lit
the city blue under dusk's orange horizon. Values are a first pass for frame review.

**Integrator lag scales with sun pace.** `integrateWorld` eases elevation toward the
azimuth's height at `0.35 * (REAL_DAY / dayLength)` per second, so a fast day keeps the
same curve. At a fixed 0.35/s a 20x sun trailed its azimuth by ~0.4 rad and golden hour
lasted 1.4 s.

## D32 — Frame rate: 30 fps is the floor, 60 fps is the aim

**Owner direction, 2026-10-14:** "Lock development target at 30 fps. Aim for 60 fps as the
goal but not at the cost of cutting out objects or reducing visual refinement too
dramatically. Dramatic feature cutting and pivot when dropping below 30 fps."

**What it supersedes.** R14 and D30 rule 5 held 60 fps on this Mac as a hard bar, and
review 6 treated 57/s as a regression to trim back. That made every new near-field piece
pay its frame time back before it could land.

### The rule now

1. **Floor: 30 fps** (33.3 ms) on the R14 platform (this Mac, Chrome, 1600 × 900), on
   every held view and in flight. Below it is a defect: cut features or change approach.
2. **Aim: 60 fps** (16.7 ms). Take the cheap wins (LOD, culling, batching, budgets that
   cost nothing visible) and keep measuring, but do not remove objects or visibly coarsen
   the picture to reach it.
3. **Between 30 and 60 is acceptable** while the world is being built. Record the number
   with every change that adds geometry, so a slide toward the floor is seen early.
4. Per-chunk budgets that prevent pathological cases (e.g. `TERRACE_HANG_BUDGET`, which
   stopped one chunk carrying 1.04M foliage triangles) stay: they guard the floor.
