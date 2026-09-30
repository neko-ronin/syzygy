# Glossary

Domain vocabulary. Written because this project is handed between model
sessions, and the cost of two sessions using the same word for two different
things is silent and expensive — the second session will confidently optimise
the wrong thing.

Where a term is defined in code, the symbol is given.

---

## The city

**District** — a named region with its own palette, building grammar and roof
style. There are 11 (`DISTRICT_STYLES`). Districts are *spatially coherent*: a
district is a neighbourhood, not a per-building attribute.
`districtAt(x, z, seed)` returns the id; `districtStyle(id)` returns the style.

**Canyon** — the open space between building faces. Statistically p50 ≈ 20 m
free width, p10 ≈ 7 m, p90 ≈ 47 m. Not an authored object; emergent from the
street field (D14). *If a change moves the p50, it changed the city's character.*

**Arterial / spine** — a wide street or deliberate linear feature: the canal, the
market street, the rail corridor. `Arterial`, `SpineLine`, `spineHit()`.

**Street field** — the function giving, for any `(x, z)`, the distance to the
nearest carriageway and which road it is. `sampleStreetPlan()`,
`roadClearanceAt()`.

> **Sign convention, and the single most dangerous thing in this repo.**
> `StreetSample.clearance` is `dist - width/2`, so it is **negative inside a
> carriageway**. Reading it as "positive means on the road" walks away from every
> street. See `PITFALLS.md` §10.

**Chunk** — a 256 m square of streamed world (`CityConfig.chunkSize`). Each
bakes to one world-space mesh, one draw call. Chunk boundaries are *not* visible;
nothing is generated per-chunk that the generator also does per-chunk.

**Setback** — a horizontal step where a tower narrows toward its crown. The
silhouette rhythm that makes a tower read as architecture.

**Lean** — buildings tilt toward the canyon so it pinches upward. `lean` in
`BuildingInstance` is a shear proportional to height, applied in the baker.

**Crown** — whatever tops a building: rooftop forest, antenna thicket, dome,
spire, sawtooth factory roof, stepped ziggurat. `RoofStyle` in `districts.ts`.

**Pilaster / rib** — the vertical strips on a facade that catch the sun and give
the canyon its rhythm. Baked geometry, not shader.

## The render

**Reverse-Z** — depth is inverted so near maps to 1 and far to 0. Requires
`depthCompare: 'greater'` and a `0.0` clear. Not used for shadow maps (D2).

**Cascade** — one level of the shadow map, covering a distance band.
`csmSplits` = 45 / 160 / 520 / 1900 m. Cascade 0 is the sharpest.

**G-buffer** — the three-target intermediate: albedo+roughness, normal+metal,
emissive+AO, plus depth.

**Tile** — a 16×16 screen-space cell used to bin local lights. `tileLights`,
`lightList`. 0–6 lights per tile typically.

**Tilt-shift** — the horizontal in-focus band that fakes a miniature. The
signature look of the reference material. Carried by `Lens.tiltShift` /
`focusWidth` and computed in `focusBand()`.

**Halation** — warm bloom bleed around highlights, added *before* the tonemap the
way light scatters in film.

**Settle** — waiting for enough chunks to stream that a screenshot means
something. In the harness, until 40 chunks are resident.

**LOD** — level of detail. 0 is full, 2 is silhouette. Written in `bakeChunk`,
**never actually used** — every chunk bakes at LOD 0 (D7, R4).

**Quality tier** — `potato | low | medium | high | ultra`, controlling render
scale, shadow resolution, cascade count, bloom levels, DOF, TAA and view
distance. A hysteretic governor moves between them.

## The simulation

**Need** — what a person is currently trying to do: `Commute, Shop, Market, Rest,
Wander, RideStop, Event`. The weight distribution is perturbed by world events, so
a `market-rush` visibly pulls the population. This is how "independent goals" is
satisfied at population scale rather than per agent.

**Personality** — per-agent pace / personal space / sociability, biasing local
behaviour. Deterministic from the seed.

**Population** — the set of currently-live agents. `population()` reports
centroid, spread and min/max Y. *Sanity check: if `live` is high and the
rendered instance count is zero, the fault is in placement or in the instance
build, not in the shaders.* Note there are **two** such counts and they are not
interchangeable — see below.

**`visibleCount`** — how many agents passed the radius test in Pass B of
`CrowdSim.update`. *Set on the CPU; says nothing about what was drawn.*

**`instances.count`** — how many instance records `buildInstances()` actually
wrote for the renderer to draw. This is the number that decides whether
pedestrians appear.

*These two were measured disagreeing in the same frame — 250 and 0 — from
predicates that look identical. That is work item F1. Until it is closed, quote
both, never either alone.*

**Pass A / B / C** — the staggered phases of the crowd's per-frame spatial work:
A builds the spatial hash, B counts and updates agents inside the radius, C
rebuilds instance data. Each is staggered across `rebuildStride` frames to bound
cost. `visibleCount` comes from B; `instances.count` comes from C.

**`viewRadius`** — how far from the camera an agent is kept simulated and
instantiated (`CrowdSim.viewRadius`, currently `lerp(80, 240, density)`). The
`01b`/`01c` crowd poses sit ~975 units from the measured crowd centroid, well
outside it — see D21 and work item F2.

**`inView()`** — a *removed* diagnostic. It reported 0 agents in the camera cone
repeatedly while a dense crowd was plainly in frame. Deleted per
[`PITFALLS.md`](PITFALLS.md) §12; pending as work item F3. Do not reintroduce it.

**Alternative transport** — the vehicle taxonomy, which contains **no cars**:
tram, trolley, cablecar, funicular, zipline, blimp, balloon, cycle. This is a hard
constraint from the brief.

**Suspension** — how a rail line is carried: `ground`, `catenary` or `free`.

**Phase** — a named time of day (`dawn, morning, noon, afternoon, dusk, night`).
Each authors a complete light rig: sun elevation and colour, ambient, cloud
cover, god rays, exposure, bloom, and lens settings. *Phase is the single
strongest control over how a frame looks.*

**Soak / event** — a scheduled change in the world with a ramp envelope
(`world.events`). Durable and in-world, not a callback (D20).

**Sunbreak** — a rapid cloud clear with a god-ray spike. The event that most
changes how a frame feels.

## The agent

**Conductor** — the LLM-driven director. 14 tools. `ToolExecutor` runs them;
`Conductor` does the SSE tool-calling loop; `ConductorUI` is the panel.

**Local brain** — `localBrain.ts`, deterministic natural-language parsing with no
API key. Not a fallback of last resort: it is what makes the console testable
without credentials, and it handles most requests well enough to steer by.

**`CameraPort`** — the narrow interface the agent layer sees. It does not know
the camera is a drone. Preserve that boundary.

**Tool** — one JSON-schema'd capability. The tool list *is* the feature surface
for natural-language control.

## Process

**Iteration** — change one thing, shoot the same pose, look at it. The loop this
project is built around.

**Baseline** — a curated screenshot set used as the "before" in a comparison
grid. *No longer committed* (D22); `shots/` is ignored entirely, so the
`BASELINE` column of `tools/compare.mjs` only appears if you populate
`shots/baseline/` yourself. The comparison degrades to `CURRENT | REFERENCE`,
which is weaker but not broken.

**Reference** — the nine videos in `inpirations/dreamscape/`. The quality bar,
not a mood board. When a question is aesthetic rather than correct, extract a
frame and compare. ~670 MB, on disk, and **not in git** (D22) — a fresh clone
has none of them.

**Contact sheet** — the overview strip of a capture run, `_contact-sheet.png`.
Generated only when ffmpeg is on `PATH`.

**Comparison grid** — `node tools/compare.mjs`, columns
`BASELINE | CURRENT | REFERENCE`, one row per pose. Replaces opening two images
in sequence, which does not work because the first is gone by the time you look
at the second. With `--auto` the reference column is the *section sheet* that
pose belongs to, rather than one frame applied to every row.

**Section** — one of the four places the city is divided into, each with its own
reference sheet, palette doctrine and form grammar: A saturated-graphic, B
cold-industrial, C fire-lit, D verdant-solarpunk. Defined in
`references/sections.json`, described in [`DESIGN.md`](DESIGN.md). *A section is
not a district* — a district is generator data; a section is an art direction
that several districts can serve.

**Reference sheet** — `references/<id>-sheet.jpg`, a contact sheet of frames
from one section's source video. **The image an agent opens before judging
anything.** Not optional context.

**Target finish** — painterly and graphic overall, detailed at close focus.
"Hyperreal" in the brief means exaggerated and stylised, not photoreal (D23).

**Homogenisation** — the failure mode where every section drifts toward the same
look and the city stops reading as a city of different places. It is only
visible in a *wide* shot, never in a section shot, which is why the design
workflow requires both checks.

**Hard-fail** — the capture harness aborting on any GPU or WGSL error. Do not
relax (D11). The same rule now applies to the comparison tool: it refuses to
build a partial grid rather than emit one with a tile silently wrong.

**Silent bug** — a fault that produces no error, no exception, and plausible
statistics. Every bug in this project's history has been one. Assume the next one
is too, and measure rather than reason.
