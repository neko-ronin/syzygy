# Procedures

The workflows this project runs on. Written so a fresh session can be productive
in minutes rather than rediscovering the tooling.

---

## 1. Start here

```bash
npm install
npx tsc --noEmit          # must be clean
npm run dev               # http://localhost:5180
```

Then, before touching anything:

1. Read [`HANDOFF.md`](HANDOFF.md) — what works, what does not.
2. Read [`PITFALLS.md`](PITFALLS.md) — the traps.
3. Run the self-tests to confirm the ground truth matches what the docs claim:

```bash
npx vite-node src/world/__selftest.ts   # citygen   (expect VIOLATIONS: none)
npx vite-node src/sim/__selftest.ts     # weather + traffic  (expect ALL PASS)
npx vite-node src/camera/__selftest.ts  # camera              (expect ALL PASS)
```

The world self-test does not print `ALL PASS` — it prints a `VIOLATIONS` line,
which is the line to read. Do not go looking for an `ALL PASS` that is not there.

If a self-test fails, the docs are wrong or the code regressed. Fix one or the
other before starting new work — do not build on a false premise.

---

## 2. The iteration loop

This is the loop you will live in. It exists because the prompt asks for
screenshots every iteration and for iteration to come at ease.

```bash
node tools/capture.mjs --sequence --pose=canyon
```

Screenshots land in `shots/<timestamp>/`. Read the image — actually read it.
Then change one thing, and shoot the same pose again.

### Read the provenance before the image

`shots/latest.json` carries a `provenance` block per frame. **Read it before
looking at the frame**, because every field in it has been a false statement at
least once and the image cannot tell you which it is looking at.

```
seed              the world the frame rendered. Captures ran seed 0 for a whole
                  session while every document said 0x5e7a17, so every coordinate
                  anyone derived was from a different city. Assert it equals
                  0x5E7A17 = 6191639.
tier              `high` / `medium` / `low`. The governor demotes under load, so a
                  sequence at default quality can decay from high to low across the
                  run. Pass `--quality <tier>` to pin it. A set with mixed tiers is
                  not comparable frame to frame.
camera.position   where the renderer actually was.
camera.requested  what the pose table asked for. The harness compares these per
                  frame and FAILS the run on a mismatch.
lodHistogram      [LOD0, LOD1, ...]. A frame with 128 chunks at LOD 2 is a
                  different rendering path from one with none.
lights            count handed to the light binner. The most useful single number
                  for judging a night frame.
lightDelivery     produced / delivered / binned / starved / rejectedFar / dayPhase.
                  `starved > 0` means the bin filled and lights were dropped by
                  proximity order.
entity.drawCalls  draws actually issued. Was 0 in every capture for four sessions
                  because the counter had no callers.
```

If a frame's provenance is stale or self-contradictory, **stop and fix before
shooting the rest.** Every silent failure this project has had would have been
visible in this block.

### Capture harness options

| Flag | Effect |
| --- | --- |
| *(none)* | One shot, default pose |
| `--sequence` | 10 curated poses, ~9 min |
| `--pose=<substr>` | Only poses whose name contains `<substr>`; repeatable |
| `--debug=N` | Render post stage N only (1 resolved, 2 bloom, 3 DOF, 4 no-warp, 5 no-tonemap) |
| `--debugseq` | One pose, every stage, one run — **strictly comparable** |
| `--eval "<js>"` | Run an expression in the page, print the JSON result |
| `--grab="<pose>:<lens=k:v\|...>"` | One pose, N parameter variants |
| `--query=<str>` | Append to the URL query string (used for debug switches) |
| `--quality=<tier>` | Force a quality tier |
| `--timeout=<s>` | Global timeout, default 120 |

### Comparing against the reference

```bash
node tools/compare.mjs --latest --ref dreamscape-05@12
```

Builds a grid, one row per pose, rows paired by pose name so each row is the same
framing. This exists because the question that matters every iteration is "did
this change help?", and answering it by opening two images in sequence does not
work — the first one is gone by the time you look at the second.

Columns are `CURRENT | REFERENCE`, plus `BASELINE` on the left if
`shots/baseline/` is populated. **It is not populated by default** — `shots/` is
gitignored and purged from history (D22), so the baseline column is opt-in. Drop
a capture run's output in `shots/baseline/` if you want a "before" to diff
against.

| Flag | Effect |
| --- | --- |
| `--latest` | Use the most recent `shots/<timestamp>/` as CURRENT |
| `--ref <name>[@<sec>]` | Extract a frame from `inspirations/dreamscape/<name>.mov` (default 10 s, past the title cards), cached in `shots/reference/` |
| `--pose=<substr>` | Restrict rows, as in the capture harness |
| `--width=<px>` | Tile width, default 520 |
| *(bare paths)* | An explicit left-to-right strip instead of `--latest` |

ffmpeg here has no `drawtext`, so columns are not labelled in-image. A `.txt`
sidecar is written beside each grid naming every column. `BASELINE | CURRENT |
REFERENCE` is the contract — keep the reference on the right, where the eye ends
up.

The reference video is portrait and our shots are 16:9, so the tool crops the
*reference* to fill its tile. It never crops our own output.

### Two rules

**Always dev server, never preview.** The harness enforces this. A `preview`
build is a stale build and a screenshot of a stale build looks valid while being
wrong.

**Any GPU or WGSL error fails the run.** You will see
`run INVALIDATED by N GPU/shader error(s)`. Fix it before looking at pixels.

**A tool exiting 0 is not evidence its output is right.** `compare.mjs` once
printed a clean summary and wrote a grid in which every tile was the same frame.
Verify the artifact against a source you know differs — see
[`PITFALLS.md`](PITFALLS.md) §14.

### Reading results

`shots/latest.json` carries per-shot renderer statistics: frame time, draw calls,
triangles, resident and visible chunks, quality tier, bake time.

**Before concluding "the renderer is slow", check `bakeMs`.** The renderer
bakes and uploads one chunk per frame under a 4 ms budget, so a capture taken
before streaming completes is measuring the wrong thing. `settle()` waits for 40
resident chunks, and the sequence still takes ~9 minutes because of it.

---

## 3. The automation surface

`window.__syzygy` is how everything is driven and inspected. This is the single
most valuable piece of infrastructure in the repo — it is what makes the renderer
debuggable from a headless run.

```js
__syzygy.ready            // boolean
__syzygy.frameCount       // frames rendered
__syzygy.stats()          // fps, draw calls, tris, chunks, sun, ambient,
                          // weather, lens, crowd, traffic, pop
__syzygy.setPose({position, lookAt, fov, roll})
__syzygy.setLens({...})   // any Lens field
__syzygy.setWeather({...})
__syzygy.setTime('dusk')
__syzygy.setDebug(1)      // post-stage debug view
__syzygy.setQuality('low')
__syzygy.probe('hdr' | 'gbuffer' | 'resolved' | 'dof' | 'bloom')
__syzygy.frameUniforms()  // the raw frame uniform block, as JSON
__syzygy.rawInst(0)       // a decoded instance record
__syzygy.population()     // crowd centroid, spread, min/max Y
__syzygy.capture()        // Promise<dataURL>, deterministic readback
__syzygy.ask('make it rain')  // send to the LLM conductor
```

Examples:

```bash
# Is anything in the HDR buffer at all?
node tools/capture.mjs --eval "window.__syzygy.probe('hdr')"

# What is the sun actually doing?
node tools/capture.mjs --eval "JSON.stringify(window.__syzygy.stats().sun)"

# Where is the crowd?
node tools/capture.mjs --eval "JSON.stringify(window.__syzygy.stats().pop)"

# Which post stage introduces the artefact?
node tools/capture.mjs --sequence --debugseq --pose=wide-skyline
```

**`probe()` returns RGB triplets for float targets.** It decodes `rgba16float`
properly. An earlier version read half-floats as 8-bit integers, which made an
empty target report "35521" and cost an hour of confusion. It also writes each
sample to its own buffer offset; an 8-byte `bytesPerRow` is a validation error
and silently returns zeros.

**Corroborate probes against screenshots.** One diagnostic (`inView()`) lied
repeatedly. See `PITFALLS.md` §12.

---

## 4. Adding a system

The pattern, followed by citygen, traffic, crowd, camera and agent:

1. **Pure simulation in `src/sim/` or `src/world/`.** No browser APIs at module
   top level, so it imports cleanly under Node and is testable there. SoA typed
   arrays in hot loops. No per-frame allocation. `dt` clamped internally
   (`MAX_DT = 1/15`).
2. **A `__selftest` that prints `ALL PASS`.** Run it under `vite-node`. If a
   system has no self-test, it has no contract.
3. **A thin render hook.** `renderer.pendingEntities` is a hook set each frame by
   `main.ts` and invoked inside the G-buffer pass, so entities get shadows, fog
   and deferred lighting for free. `drawEntitySet(pass, name, data, count)`
   uploads one contiguous instance block and issues the draw.
4. **Wire the automation surface** so it can be inspected headlessly. This is not
   optional; it is how every bug in this project was found.
5. **A diagnostic pose that derives its position from live state** (D21). If the
   pose exists to frame a system, compute it from that system's centroid or nav
   node — not from typed-in coordinates. See the checklist below.

### Writing a diagnostic that cannot lie

Every silent bug in this project was found by measurement, and several were
*caused* by a diagnostic that pointed at the wrong thing. Before trusting a new
diagnostic shot or counter, check all five:

1. **Is the camera actually looking at the subject?** Print the camera position
   and the subject's centroid in the same frame. Distance, not vibes. A pose
   975 units from its subject reports an absence forever (D21, F2).
2. **Cross-check two independent counters.** `visibleCount` and
   `instances.count` are computed separately and were measured disagreeing
   250 vs 0. When two paths compute the same predicate, print both — and if they
   disagree, *that disagreement is the bug*. Do not delete the one that looks
   wrong.
3. **Print raw state, not just aggregates.** For a handful of agents, print
   index, position, and the field that gates them. A count tells you that
   something is wrong; per-agent state tells you where.
4. **Run a control.** Change one variable, re-shoot the same pose, compare. This
   is what killed the culling theory: `pedestrian:0/180` under *both* modes.
5. **Delete a diagnostic the first time it lies.** `inView()` reported 0 while a
   dense crowd was in frame, and was believed for several iterations. See §12.

Two rules that follow, both learned the hard way:

- **A command exiting 0 is not evidence its output is correct.** `compare.mjs`
  emitted a valid PNG of the wrong thing. Check artifacts against a source you
  know differs.
- **Do not crop or clip the thing under test** to make a comparison convenient.
  Crop the reference.

**Note on `__selftest`:** step 2 above says a self-test prints `ALL PASS`. The
world self-test does not — it prints a `VIOLATIONS` line, and that is the line
to read. Do not go looking for an `ALL PASS` that is not there.

### Instance layout

`INSTANCE_FLOATS = 24` (96 bytes), matching `instanceVertexLayout`:

```
float  0..15   mat4 model, column-major
float 16..19   tint rgba
float 20..23   params (matId, roughness, emissive, seed)
```

Mesh vertices are 12 floats (48 bytes): position 3, normal 3, uv 2, colour 3,
emissive 1. **Colour is 4 floats in the builder, 3 in the interleaved buffer** —
this asymmetry caused the worst bug in the project. See `PITFALLS.md` §7.

---

## 5. Working on the renderer

### Frame graph

```
shadow      4 cascades, depth only, conventional Z
  → gbuffer MRT: albedo+rough rgba8, normal+metal rgba16f, emissive+ao rgba16f, depth32f reverse-Z
  → lightbin compute, 16×16 screen tiles
  → lighting      deferred resolve + analytic sky IBL + clustered lights + fog
  → dof           half-res golden-angle bokeh carrying the tilt-shift band
  → bloom         threshold → down → additive up
  → taa           YCoCg neighbourhood clamp + reprojection
  → composite     lens warp, CA, defocus, halation, tonemap, grade, vignette, grain
```

### Shaders

WGSL in `src/shaders/*.wgsl`, concatenated textually by `src/render/wgsl.ts`.
WebGPU has no preprocessor, so `common.wgsl` is prepended to every module.

**Declaration order is a dependency.** `common.wgsl` owns group(0) binding(0) (the
frame uniform) and group(1) bindings 0–1 (the shadow map + comparison sampler).
Per-pass bindings start at 2. The shadow pass therefore needs a real (empty)
layout at group(1) with its cascade params at group(2), or the indices do not
line up.

**Adding a field to `struct Frame` means changing `writeFrameUniforms` too.**
They are one ABI split across a language boundary. Verify with
`__syzygy.frameUniforms()`.

### Materials

`MAT` in `citymesh.ts` is a contract about **scale**, not just shading:

| id | name | Use for |
| --- | --- | --- |
| 0 | DIFFUSE | building walls — gets the facade synthesiser |
| 1 | GLASS | curtain walling |
| 2 | FOLIAGE | alpha-tested leaf clumps |
| 3 | METAL | structural metal |
| 4 | WATER | (unimplemented) |
| 5 | EMISSIVE | light sources |
| 6 | BRICK | masonry districts |
| 7 | PLASTER | rendered stucco |
| 8 | STREET | ground deck — **no facade** |
| 9 | PLAIN | entities, anything sub-building scale |

Anything much smaller than a building needs its own id. Sharing DIFFUSE is what
made 2500 pedestrians invisible.

### Colour

Everything is **linear** from generation through shading. `hexLinear()` in
districts, linear palettes, tonemap exactly once in `composite`. Saturation,
grade, vignette and grain come after.

Palette variety between districts is a requirement from the prompt, not
decoration. If a wide shot reads as per-building random rather than as
neighbourhoods, that is a bug against the brief — see roadmap R9.

---

## 6. Quality tiers

`TIERS` in `renderer.ts`: `potato | low | medium | high | ultra`, controlling
render scale, shadow resolution, cascade count, bloom levels, DOF, TAA, view
distance and foliage.

`main.ts` runs a hysteretic governor every 1.5 s: step down after sustained
sub-34 fps, step up only after sustained headroom. The hysteresis is wide on
purpose — oscillating between tiers is worse than a steady 40 fps.

`__syzygy.setQuality('tier')` forces a tier and pins the governor off. Use it
when comparing tiers, not when measuring performance.

---

## 7. The LLM conductor

`src/agent/` — 14 tools over weather, time, sun, lens, camera, events, crowd,
traffic, tours, colour grade, and a world description.

**The local brain is the important part.** `localBrain.ts` parses natural
language with no API key — "make it rain", "golden hour", "go to the canyon",
"faster", "blurrier", "celebrate". Without it the console only works on a
configured machine, and the feature would be untestable in CI.

To exercise the LLM path:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev
# then press T, or: __syzygy.ask('storm at dusk, then fly into the canyon')
```

`server/plugin.mjs` is a Vite plugin providing `/api/chat` (SSE proxy to the
Anthropic API), `/api/health`, and `/api/state` (save/restore world state to
`docs/saves/`). With no key it returns `{ needsKey: true }` and the client falls
back to the local brain.

`ToolExecutor` takes a narrow `CameraPort`, not a camera. The agent layer does
not know the camera is a drone. Preserve that boundary.

---

## 8. Language servers

Five configured in `~/.config/opencode/opencode.json`: `typescript`,
`python` (pyright), `clangd` (C and C++ — one entry, it dispatches on file
extension; two entries would spawn two servers and double every diagnostic), and
`rust` (rust-analyzer, installed via Homebrew for this).

```bash
node tools/lsp-check.mjs              # all
node tools/lsp-check.mjs rust clangd  # subset
```

This drives a **real handshake** and asserts each server catches a deliberate
error in a scratch file, because a binary on `PATH` is not evidence — a probe
failure here once looked like a broken install when the probe itself was using
the wrong wire format.

Requires an opencode restart to take effect.

---

## 9. Committing

Two commits so far, both explaining *why*:

- `27f3b66` — the eleven silent render bugs
- `1481e47` — the five crowd placement faults

**Commit at a natural boundary, with reasoning in the message.** This project is
explicitly designed to survive a session limit; the git log and
`docs/ITERATION.md` are the recovery mechanism. A commit that says only *what*
changed is worth much less to the next session than one that says what was
wrong and why it was invisible.

`docs/` is the other half. If you learn something the hard way, write it in
`PITFALLS.md` before you forget it.

---

## 10. Working with the other agents

`herdr` session, this workspace. `claude` and `developer` panes are idle and
free; task-tool subagents also work.

Split by ownership boundary so parallel agents do not collide — the split used
during bring-up was citygen/districts/networks, agent+capture-harness, camera+
input, and weather+traffic.

**Verify a subagent's work with `ls` before believing its report.** Two
subagent runs returned empty results having written nothing.

Where a subagent and a direct edit both touch a file, do not run them
concurrently.
