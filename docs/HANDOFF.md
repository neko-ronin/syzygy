# Handoff

**Read this first, then [`ROADMAP.md`](ROADMAP.md) for what to work on,
[`PITFALLS.md`](PITFALLS.md) before you touch the renderer, and
[`DECISIONS.md`](DECISIONS.md) before you change the architecture.**

State as of the end of the session that built the renderer, plus the audit
session that followed. Commits: `27f3b66` (renderer bring-up), `1481e47`
(crowd), `0e90072` (documentation set).

The audit session added `DECISIONS.md`, `GLOSSARY.md` and `tools/compare.mjs`,
corrected the reference-video tracking, restored G-buffer back-face culling, and
found the two open questions below. It changed no renderer behaviour on the
strength of an unverified theory.

---

## Read this first: two open questions block the crowd work

Both were measured, not guessed. Do not start R1 without reading this section.

**1. The crowd's two visibility predicates disagree.** From a single frame at
the `01b-crowd-closeup` pose:

```
crowd: 250              // visibleCount, from Pass B   (crowd.ts:265-276)
instancesCount: 0       // buildInstances()            (crowd.ts:794-841)
```

Same guard (`f[o + F.active] < 0.5`), same radius test
(`dx*dx + dz*dz > viewRadius*viewRadius`), same `cam`, same `update()`, and
`viewRadius` is not modified between them. One of these is lying. **Do not
resolve it by reading the code and picking a side** — print both counts plus raw
per-agent state (`x`, `z`, `active`) for a handful of agents and find the agent
where they diverge. The disagreement is the bug.

Note this contradicts the claim below that the crowd "renders, but too sparse".
That claim rests on framing a known agent once, in the `1481e47` session. It has
not been re-verified since. **Treat crowd rendering as unverified.**

**2. The crowd diagnostic poses do not point at the crowd.** `01b-crowd-closeup`
and `01c-street-crowd` are hardcoded at the world origin
(`position: [0, 2.4, -40]`), while the crowd centroid measured at `(974, 46)` —
~975 units away, outside `viewRadius: 190`. Those two poses have been reporting
an empty street for a diagnostic reason, not a rendering one. Earlier sessions
chased this as an entity-winding bug and then as G-buffer culling; both were
wrong. When fixing the crowd, either move these poses onto the live centroid or
derive them from it, and only then judge the picture.

**Cheapest next step:** add a `--pose=crowd-live` that seeds the pose from
`crowd.population()`, and a diagnostic that prints the per-agent state for the
first ~8 agents within range. That answers question 1 in a single run.

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

`shots/<timestamp>/` per run, plus `shots/latest.json` with per-shot stats. The
reference set from the end of the last session is
`shots/2026-09-29T19-30-34/`, with `_contact-sheet.png` as the overview.

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
  open questions above.**

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

Ordered by how much it hurts the spectacle.

**1. Street level is not inhabited.** The crowd is placed on real streets, but
whether it renders at all is currently contradicted by our own counters (see
open question 1), and the two poses meant to show it are pointed at empty ground
(open question 2). ~1900 people spread across the streets within 160 m would be
thin on any single avenue regardless, and the street deck is a featureless grey
slab. This is the gap most visible against the reference frames.

**2. Traffic is invisible.** `TrafficSim` produces vehicles and 64 lights, but
only pedestrians are submitted through the instanced draw path. The fix is
small: `Renderer.drawEntitySet` already exists and works; traffic needs its
instances built and the `pendingEntities` hook extended. Trams and cable cars on
the visible rail lines would transform the canyon shots immediately.

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

Make street level read as inhabited. It is the clearest distance between the
current output and the reference frames, and it needs three things: ground
detail (markings, kerbs, clutter at eye height), a large crowd density increase
with better distribution along the view axis, and traffic on screen. Those three
together are the difference between "a city" and "a city that is alive".
