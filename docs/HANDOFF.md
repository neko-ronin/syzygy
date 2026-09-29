# Handoff

**Read this first, then [`ROADMAP.md`](ROADMAP.md) for what to work on,
[`COVERAGE.md`](COVERAGE.md) for what is quietly missing,
[`PITFALLS.md`](PITFALLS.md) before you touch the renderer, and
[`DECISIONS.md`](DECISIONS.md) before you change the architecture.**

State as of the end of the session that built the renderer, plus the audit
session that followed. Commits: `27f3b66` (renderer bring-up), `1481e47`
(crowd), `0e90072` (documentation set).

The audit session added `DECISIONS.md`, `GLOSSARY.md` and `tools/compare.mjs`,
corrected the reference-video tracking, restored G-buffer back-face culling, and
found the six open work items below. It changed no renderer behaviour on the
strength of an unverified theory.

---

## Open work items — read this before starting

Six proposed fixes, in dependency order. F1 and F2 are **measure-first**: neither
may be closed by reading code and deciding which side looks right. Do them
together, in one run. Everything downstream of the crowd is blocked until they
are both settled.

Nothing here has been implemented. Each item states the evidence, the proposed
fix, and the check that proves it closed.

### F1 — The crowd's two visibility predicates disagree

**Evidence.** One frame at the `01b-crowd-closeup` pose:

```
crowd: 250              // visibleCount, Pass B        crowd.ts:265-276
instancesCount: 0       // buildInstances()            crowd.ts:794-841
```

Same guard (`f[o + F.active] < 0.5`), same radius test
(`dx*dx + dz*dz > viewRadius*viewRadius`), same `cam`, same `update()`, and
`viewRadius` is not written between them. Both cannot be right.

This also contradicts the `1481e47` claim that the crowd renders, which rested
on framing one known agent once and has not been re-verified since.
**Treat crowd rendering as unverified** until F1 closes.

**Proposed fix.** Do not reason about which side is wrong. Add a diagnostic that
prints, for the same frame:

1. `visibleCount` and `instances.count` side by side.
2. `viewRadius` read at three points — before `rebuildSlices`, before Pass B,
   and inside `buildInstances` — to rule out a mid-frame write.
3. Raw per-agent state for the first ~8 agents passing the guard: index, `x`,
   `z`, `active`, and the computed `d2`.

Then find the first agent counted by Pass B and dropped by `buildInstances` and
compare its two distances. Candidate causes worth *checking against that
evidence*, not assuming:

- `d.b` (the instance write cursor) colliding with the field writes, so
  `buildInstances` writes the TRS but `n` never advances.
- The `if (n >= cap) break` guard at `crowd.ts:806` tripping early, since it is
  placed *after* the distance test and compares against `capacity`, not the
  number of eligible agents.
- `buildInstances` running before the seeding arm of `rebuildSlices` has
  refilled, reading a stale `active` state.

**Closed when:** the two counts agree, or the divergence is localised to a named
agent and a named line. If they agree, the bug was ordering or staleness and F1
closes with a one-line reorder — not by deleting whichever counter disagreed.

### F2 — The crowd diagnostic poses do not point at the crowd

**Evidence.** `01b-crowd-closeup` and `01c-street-crowd` are hardcoded at the
world origin (`position: [0, 2.4, -40]`, `capture.mjs`). The crowd centroid
measured at `(974, 46)` — ~975 units away, outside `viewRadius: 190`. The
"close-up" was never looking at the crowd, so both poses have reported an empty
street for a *diagnostic* reason.

Earlier sessions read that absence as an entity-winding bug, then as G-buffer
culling. Both wrong. A control run settled it: `pedestrian:0/180` under *both*
`cull: 'back'` and `cull: 'none'`.

**Proposed fix.**

- Add a `crowd-live` pose whose `position` is derived from
  `crowd.population()` — centroid plus a street-aligned offset — rather than
  hardcoded. `population()` already reports centroid and spread.
- Compute it in the app, not in the harness, so `--eval` and the console see the
  same value the renderer used.
- Keep `01b`/`01c` as origin-anchored establishing shots, but rename them so
  they no longer claim to be crowd diagnostics. A diagnostic that lies by
  position is worse than no diagnostic.

**Closed when:** a shot from the new pose contains visible pedestrians, *or*
F1 shows the count is legitimately zero with the reason identified.

### F3 — Delete `crowd.inView()`

**Evidence.** `PITFALLS.md` §12: it reported 0 in the camera cone repeatedly,
even with a dense crowd plainly in frame. It is still in the tree
(`crowd.ts:326`, called from `main.ts:431`).

**Proposed fix.** Delete it and its call site, plus the hardcoded
`targetsW/1600, targetsH/900` arguments that only existed to feed it. Per §12, a
diagnostic that has lied once does not get a second chance — and F1 is currently
proving that counters in this file are not trustworthy, so a third opinion would
only add noise. `pass A/B/C` counts replace it.

**Closed when:** `inView` no longer appears in `shots/latest.json` stats.

### F4 — Wire traffic to the instanced draw path

**Evidence.** `TrafficSim` produces 207 vehicles and 64 lights on real rail
lines; `main.ts:243` submits only pedestrians.

**Proposed fix.** Build a traffic instance buffer in the same 24-float layout as
the crowd (D18) — `TrafficSim` already has position, heading and kind — and
extend the `pendingEntities` hook to carry a second set keyed `'tram'`,
`'cablecar'`, etc. `Renderer.drawEntitySet` already works; this is wiring, not
design. Rail-aligned vehicles must use the suspension's own transform, or trams
will float above and sink below their cables.

**Closed when:** the `03-tram-level` pose shows vehicles on the rails, with
`entityDraws` reporting a non-zero count per kind.

### F5 — Ground detail at eye height

**Evidence.** Street-level frames are ~60% featureless grey slab. `bakeGround`
emits kerb strips that are barely visible.

**Proposed fix.** Lane markings, drain covers and kerb read as procedural
synthesised detail in the existing facade shader rather than new geometry or new
textures (D6) — the shader already knows street distance, so this is a
synthesis job, not an asset job. Widen the kerb strip and raise its contrast
first; it is one number.

**Closed when:** a street-level pose shows kerbs catching light and reading as a
kerb.

### F6 — Warm boot, so a capture is seconds not minutes

**Evidence.** The sequence is ~9 minutes, dominated by streaming: one chunk baked
per frame under a 4 ms budget, ~60 frames before a shot means anything. Every
other decision here is downstream of how cheaply you can look at the thing.

**Proposed fix.** A `?seed=&chunks=N&warm=N` query parameter that resolves the
seed, forces the first `N` chunks resident, and bakes them synchronously at boot
before the first frame. `capture.mjs` then sets it, and a capture drops to
seconds. This is also the cheapest way to make F1 cheap to iterate on, so
consider doing it *before* F1 rather than after.

**Closed when:** `node tools/capture.mjs --pose=<any>` returns in seconds and the
image is indistinguishable from the settled version.

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
simulated but never drawn, night is nearly black, and WebGL 2 does not exist.

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

**5. WebGL 2 does not exist.** The prompt asked for it. See
`ORIGINAL_PROMPT.md` and roadmap item R8 — this is a product decision, not a
task to quietly pick up.

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
