# 60 FPS measurement preparation

Status: **instrumented and tested headlessly; no sustained GPU benchmark result
yet.** The declared target is this Mac (Apple M2, 16 GB), Chrome, 1600 × 900.
The frame budget is 1000/60 = 16.67 ms. This work prepares trustworthy evidence;
it does not implement the queued large-world architecture or claim 60 FPS.

The installed Playwright browser is **Google Chrome for Testing**, under
`~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`.
Stable Chrome in `/Applications` is absent. The benchmark resolves the installed
binary, checks it exists, records its executable path, Chrome product/version,
user agent, JavaScript version, launch flags and headless/headed mode. It never
downloads a browser. The actual adapter string and enabled device features come
from the renderer's existing GPU context, rather than a second requested device.

## Measurements and limits

[`src/render/perf.ts`](../src/render/perf.ts) keeps bounded raw event samples and
monotonic lifetime counters. `performanceReset()` starts a sampling window and
clears samples; it does not rewind counters or discard in-flight queue identity.

| Measurement | Meaning | Does not establish |
| --- | --- | --- |
| Raw rAF count/interval | Actual browser callbacks entering the app loop | Encoded frames, GPU completion, display presentation |
| Submitted count/interval | A frame's `queue.submit` succeeded | GPU execution duration or displayed frames |
| Completed watermark | A successful existing queue fence reports all frame submissions through serial N retired | Presentation; fence callback latency is not GPU execution time |
| Rejected fence count | Queue completion failed | A successfully rendered frame |
| Simulation CPU | JS input, camera, world, weather, crowd and traffic update block | GPU work or all application JS |
| Stream CPU | Whole `streamChunks` call, including synchronous bake/upload preparation | Pure generation cost or GPU upload execution |
| Encode CPU | Renderer JS from admitted render to submission, excluding stream CPU | Whole app CPU; entity packing/HUD work occurs outside this scope |
| GPU timestamp samples | Optional explicitly bracketed pass range, when attached | Whole-frame GPU time unless the bracket actually spans it |

Manual warm-up and automation `step()` calls do not increment the browser rAF
counter. The initial pipeline render can submit before the first rAF. Counters
therefore have independent meanings and need not be equal. Completion callbacks
can arrive out of order: a later successful queue fence advances the watermark,
and earlier/duplicate notifications cannot count frames again. Frames already
in flight before a reset cannot inflate completed throughput in the new window.

Snapshots include the full raw window or explicit overflow counts. A clipped
window is marked incomplete, not silently summarized as a complete traversal.
Snapshots copy their sample records so a caller cannot rewrite live evidence.
The summaries retain p50/p95/p99/max and counts over 16.67/33.33 ms. They report
callback, submission and observed retirement rates separately;
**presentation FPS is null/unmeasured**. No ambiguous `renderedFPS` is published.

The previous `world.perf.gpuMs = frameMs - cpuEncodeMs` was a wall-time estimate,
not a GPU timer. It is replaced by `gpuMs: null, gpuMsSource: 'unavailable'`.
No current downstream code performed arithmetic on that field; the manually
constructed simulation self-test fixture now follows the explicit contract.

The held visual pair also exposed stale entity triangle accumulation: main
added the previous callback's entity triangles on ticks where renderer pacing
skipped submission. Main now resets that scratch count and uses the tested
submission boundary to add it only after an actual new frame. Identical held
geometry no longer acquires larger per-frame totals merely by waiting.

## Optional GPU timestamp ring

`GpuTimestampRing` is implemented and lifecycle-tested with fake device/buffer
objects. It is **not attached to the renderer's passes yet**, and runtime
metadata states that GPU timing is unavailable. It must not be enabled merely
by requesting the already-supported device feature.

When deliberately integrated, reserve a slot, attach beginning/end writes to
the first/last pass of the chosen range, resolve and copy inside the same frame
encoder, then start asynchronous mapping after successful submission. The ring
uses fixed buffers and skips a timing sample while all slots are busy. It never
adds a queue submission or awaits a readback in the render loop. A mapped buffer
cannot be reused until unmapping; failed or reversed timestamps cannot fabricate
a zero-duration sample. The range and dropped samples must accompany results.

The WebGPU specification writes timestamp values in nanoseconds and requires
256-byte query-resolution offset alignment. The helper follows those contracts.
[WebGPU specification](https://www.w3.org/TR/webgpu/#timestamp-query)

Chrome documents quantized timestamp queries for privacy. Timing precision
therefore depends on the browser and configuration; this harness does not disable
quantization or introduce experimental timestamp-inside-pass APIs.
[What's New in WebGPU, Chrome 121](https://developer.chrome.com/blog/new-in-webgpu-121)

### Read-only integration plan for the actual frame graph

The source was checked against `Renderer.render`, `recordShadow` and
`recordPost`; this is a plan, not completed timestamp integration:

1. Allocate one ring against the renderer's **existing device**, after `gpu`
   exists. Gate on `device.features.has('timestamp-query')`; unsupported devices
   keep null timing with an explicit unsupported reason. Reserve a slot only
   after render pacing admits a frame, so declined ticks consume no slot.
2. Put the beginning write on the actual `shadow0` render-pass descriptor in
   `recordShadow` (`i === 0`). All current quality tiers have at least two
   cascades. Still handle a future zero-cascade tier by moving the beginning
   write to `gbuffer`; do not silently leave a query unwritten.
3. Put the ending write on the final **`composite`** render-pass descriptor in
   `recordPost`, after the shadows, G-buffer/entities, light-bin compute,
   lighting, optional DOF, bloom down/up, TAA-or-copy and optional shafts. This
   brackets the complete sequence of current frame-graph passes. Timing only
   G-buffer, only composite, or a convenient intermediate pass is insufficient.
4. After `recordPost` closes composite, encode the ring's resolve/copy on the
   **same frame encoder**, then finish and submit once. Refactor the existing
   completion-tracking hook to return its monotonic frame serial (or otherwise
   expose that exact serial). Only after successful submission call the ring's
   asynchronous mapping hook with that serial. Cancel the reservation on an
   encode/submit failure, and never add a second submit or await in render.
5. Publish range name `shadow0-begin → composite-end`, supported/enabled state,
   skipped/failed readback counts, and sample serial/timestamp. Benchmark GPU
   summaries consume actual raw samples only. If a convenience `world.perf`
   value is added, use the latest **completed timestamp sample** with its
   identity/age, not an estimate or a claim about the just-submitted frame.
6. Test boundary selection through quality branches, optional post passes,
   unsupported devices, ring exhaustion, rejected mapping and aborted encoding.
   Then validate GPU errors and nonzero timestamp samples in the first authorized
   serialized baseline run. Do not spend a separate visual-control capture
   round merely proving the counter is wired.

This range measures **frame-graph pass execution interval**, not every GPU
operation associated with a frame: `queue.writeBuffer` uploads/resource work
issued before the frame encoder, query resolve/copy after composite, screenshot
readbacks and display presentation are outside it. It can guide which CPU/GPU
budget is binding without being mislabeled total GPU cost or display FPS.
Record whether timing is enabled, since even bounded optional instrumentation
has overhead. No renderer mutation was made for this integration plan.

## Benchmark routes and provenance

[`tools/benchmark.mjs`](../tools/benchmark.mjs) uses Vite **dev**, fresh browser
contexts, seed 6191639 in decimal, zero boot prewarm, viewport 1600 × 900 and
device scale factor 1. It performs no screenshots, synchronous `warm()` calls,
or manual render ticks.

- **Hero:** derives the actual market subject once, records derivation/setup CPU
  duration separately, then naturally streams for the declared warm duration.
  The camera stays at its authored pose with normal handheld motion; crowd,
  traffic, weather and streaming continue. The measured window includes active
  simulation, not a paused render-only workload.
- **Skyline:** uses the existing wide skyline pose and the same active workload
  and declared natural warm period.
- **Flight:** starts without route prewarm at (800,220,1200), traverses to
  (-800,220,-1200), then reverses back in the same measured window. A wall-clock
  rAF pose trajectory gives continuous positions independently of simulation dt
  clamping. Actors remain active. This controls the camera path, not player input
  or collision navigation. Leg duration and resulting speed are recorded.

Every one-second observation records actual camera/chunk, crowd population and
visible/instance counts, traffic counts, residency/LOD/rebake backlog, draw and
triangle counts, adapter, quality settings, declared view distance, render scale,
canvas backing dimensions and actual internal dimensions. Flight crossing a
chunk boundary proves travel only; **missing-visible coverage and hole-free
streaming remain unmeasured** until streaming exposes authoritative demand and
coverage counters. Aggregate residency does not supply that evidence.

Navigation-to-ready, hero setup and natural warm time are separate fields.
“Ready” means the application's signal, not first displayed pixels. Fresh
contexts do not make the already-running Vite server's module compilation cold.
The flight tests the currently finite generated city. `City.getChunk` rejects
coordinates beyond ±6 chunks, and `bakeGround(4096)`/`pushGroundDeck` provide a
finite global ground mesh. Removing only the City guard would not deliver an
infinite world. Ground coverage is a required stage-two migration item.

Fixed-quality runs enforce the chosen override/tier and stable actual internal
resolution consistent with its declared scale; fixed high must be 1600 × 900
internally at DPR 1. Adaptive runs explicitly permit and record tier, resolution
and distance changes. A reduced-resolution adaptive result cannot silently
become a native-resolution high-quality result. Browser/GPU errors, rejected
fences, missing metadata, inconsistent counters, and incomplete raw windows
invalidate the corresponding controls. These controls establish measurement
integrity, not a visual or 60 FPS pass.

The report saves Git revision, dirty status and SHA-256 of the tracked diff,
plus content hashes of the relevant perf/benchmark/self-test modules (including
untracked files). A separate content-hash map enumerates tracked and non-ignored
untracked files under `src`/`server` plus benchmark-critical tools/configuration,
so a new mesh/worker's content change cannot hide behind unchanged filenames
and status. End provenance detects source changes during the run. Source
must remain held while a benchmark is active. Reports retain full raw samples;
the console's short rate line is not the evidence artifact.

## Commands and current verification

```sh
# Headless preparation only: no browser, GPU, lock, or platform probe.
node tools/benchmark.mjs --plan --route=all --quality=high
node tools/__selftest_benchmark.mjs

# Only after the current capture slot is free and real preflight passes.
node tools/benchmark.mjs --route=all --quality=high
node tools/benchmark.mjs --route=all --quality=high --adaptive
# Add --headed for the visible Chrome run; mode is saved in each report.
```

GPU execution is serialized through the shared atomic `shots/.caplock` and
fail-closed preflight from `tools/orchestrate.mjs`. The benchmark has no force
option and does not reap or clear someone else's lock. It refuses unknown
critical telemetry and unhealthy capacity before starting Vite or Chrome.
Signal interruption closes the active context to unwind pending page waits;
one shared final cleanup awaits Chrome closure and owned Vite-process exit
before releasing the claim. Rejection or bounded cleanup timeout retains the
lock rather than allowing another GPU job beside an unconfirmed live browser.
Reports default to `benchmarks/<timestamp>/report.json`. No GPU benchmark was
run during this preparation; street captures own the current GPU slot.

The new semantic suite prints:

```text
ALL PASS: raw frame telemetry + benchmark evidence + nonblocking timestamp ring
```

It covers callback/submission/completion separation, out-of-order/duplicate
fences, rejected fences, reset with old in-flight work, bounded overflow and
snapshot isolation, skipped-frame triangle invariants, nonblocking readback and
buffer reuse/alignment, unavailable/failed GPU timings, raw-window corruption,
fixed-resolution/tier controls and rejection of a force option. Script syntax,
the dry plan, pinned TypeScript and owned-file whitespace checks pass. Browser
launch, full route execution and 60 FPS remain unverified until the serialized
run and independent review.

**Round reflection:** this is still verification preparation while the first
visual batch is active. It removes false measurements and makes the next
performance result reviewable. The next useful output is an actual baseline
report under a healthy, exclusive GPU slot; architecture changes remain queued
behind the initial batch and source-backed research.

## 2026-10-07 — first baseline, GPU attribution, lighting fixes

**Baseline** (`benchmarks/2026-10-07T16-18-21-886Z`, fixed high, headless, 1600 × 900,
valid controls): submitted frames/s hero 42.4, skyline 36.9, flight 31.7; p95
submission interval 34.2 / 34.9 / 65.7 ms. Callbacks ran at 60/s while submissions
lagged: the renderer allows two frames in flight, so hero and skyline were GPU-bound.
Simulation CPU (mostly crowd) is 9.7–12 ms per callback; flight adds synchronous
streaming spikes (stream p95 22.7 ms, simulation p95 34 ms).

**Quality A/B** (`--set`, `--crowd`, new; 12 s windows): removing the crowd freed
9 ms of CPU and changed nothing; halving triangles (2 cascades) gained only ~5 fps.
Triangles were not the binding cost.

**Per-pass GPU timing** (`GpuPassTimer` in `perf.ts`, `--gpu-passes`): every pass
gets labelled timestamps; readback never stalls. On this Apple tiled GPU begin
timestamps are sampled long before a pass's own work, so begin-to-end spans overlap
(ten post passes each "took" 12.9 ms of a 21.6 ms frame). The timer reports
incremental completion (this end minus the previous end), which sums exactly to the
frame span. Instrumented runs are marked `instrumented` in the report.

The deferred **lighting pass was 11.6 of 21.1 ms** (hero) and 13.5 of 25.1 (skyline):

1. *Light binning had no depth test.* Lights were binned into every tile their
   screen rect covered: 38.7 per tile, busiest tiles at the 96 cap. The binner now
   reads each tile's G-buffer depth range and rejects spheres that miss it (mean
   19.8). Exactly conservative; hero pair identical at 4% fuzz. Lighting −0.5/−2 ms.
2. *Sky reflections discarded their own work.* `skyRadianceSpec` computed five cloud
   evaluations then weighted them zero at roughness ≥ 0.65, where most surfaces sit.
   Early return; exact. Lighting 11.1 → 9.0 ms (hero).
3. *Cloud fbm per pixel.* Removing clouds (diagnostic only) took lighting 9.0 →
   3.6 ms and hero to 60 fps. Fog colour and reflections now sample a 512 × 256
   equirect sky LUT rendered once per frame (`fsSkyLut`); directly visible sky stays
   exact. Hero pair identical to the previous frames at 4% fuzz (day 1%: 170 px,
   run-to-run grain level).

Result (`benchmarks/passes4-*`, instrumented, 12 s windows): **hero 58.7 fps, GPU
14.5 ms** (lighting 3.8, G-buffer 3.6, shadow cascade 2 3.3); **skyline 49.7 fps,
GPU 15.9 ms** (G-buffer 5.0, lighting 3.7, cascade 3 3.1). Not yet 60 sustained;
flight not re-measured.

Harness fixes found by running it: callback samples were stamped with the rAF
frame timestamp, which can predate a window reset ("sample outside window") — now
callback entry time; `/favicon.ico` 404 invalidated runs (empty icon declared);
console errors now carry the failing URL; the page loaded Google Fonts at runtime
(network dependency and IP leak) — removed, system fallbacks were already declared.

**Next:** CPU — crowd simulation at 9.7–12 ms per callback is the next binding cost
once GPU is under budget; then synchronous streaming for flight; then G-buffer and
far shadow cascade cost on skyline.

## 2026-10-07 — crowd CPU

Profiled headlessly (Node `--cpu-prof`, real `CrowdSim` with the emitted obstacles
and walking surfaces of the surrounding chunks), which reproduced the browser's
10.2 ms per update at the hero.

1. *Pavement hold sampled the street field per agent per frame* — `sampleStreetPlan`
   and its noise/warp helpers were ~60% of crowd CPU. Each agent now caches its
   street frame and re-samples after moving 0.5 m (the frame is a pure function of
   position, so a reused slot cannot inherit a wrong street). Lateral error vs an
   exact sample: p95 1.8 mm; a 1 km radius mutant fails at 7.9 m. 10.2 → 3.5 ms.
2. *Agents stranded at goal −1 re-ran the goal search every frame.* `assignPath`
   never wrote `F.goal` when the agent had no current node, and wrote −1 when a
   search failed; `arrived` was true for a null target. At the skyline pose this was
   160 radius searches (up to 1.2 km, ~5,900 bucket lookups each) per frame, 67% of
   crowd CPU, with zero paths computed. Fixed: a failed search keeps the old goal,
   the no-origin branch paths from the nearest node, no-target is not arrival and
   retries on a short ttl.
3. *The nav graph covered ±760 m of a ±1,536 m city*, so 735 of 2,550 agents near the
   skyline camera had nothing to walk to. The crowd now builds the whole finite city
   once at attach (19,071 nodes, ~390 ms instead of ~110 ms). A streamed world must
   grow it with `ensureRegion` instead (37–40 ms per region, measured).
   Regression: no active agent without a goal at the skyline pose (old graph: 973).

Benchmark (`benchmarks/2026-10-07T23-31-00-738Z`, fixed high, valid): hero **54.7**,
skyline **51.8**, flight **48.0** submitted frames/s (baseline 42.4 / 36.9 / 31.7).
Simulation p50 3.5–4.3 ms (was 9.7–12). GPU is binding again on hero/skyline
(completion latency p50 ~25 ms in this run; the instrumented hero run measured a
14.5 ms frame span, so run-to-run GPU contention from other applications is
material). Flight remains limited by synchronous streaming: stream p95 19.7 ms,
max 46 ms.

## 2026-10-08 — chunk baking off the main thread

`src/render/bakeworker.ts` bakes chunks in a Web Worker with its own `City` from the
same seed. A chunk baked in a fresh City is byte-identical to one baked after its
neighbours (SHA-256 over all mesh arrays, obstacles, lights and stalls, LOD 0 and 1),
so worker output equals the synchronous path. Natural streaming keeps two bakes in
flight (rebakes first) and uploads finished chunks within 3 ms per frame (at least
one); results for evicted, already-baked or flown-past chunks are dropped. Mesh
arrays are transferred. Warm-up, capture replay and worker-less environments keep
the synchronous path (`renderer.streamSync`), so captures stay deterministic: hero
pair identical at 4% fuzz.

Found on the way:
- Chunks outside the finite city were queued forever (the worker answered "no
  chunk" and nothing marked them done), pinning `rebakePending` above zero.
- `render()` declined frames while two were in flight *before* streaming, so a
  synchronous warm loop — which can never see frames complete — stalled, and the
  residency count it polled was only refreshed on admitted frames. Boot warm reached
  10/64 chunks before today and 1/64 with the worker; streaming now runs before the
  pacing gate and residency is refreshed live: **64/64, stopped: target**.

Benchmark (`benchmarks/2026-10-08T01-28-52-596Z`, fixed high, valid): hero **60.0**,
skyline **58.6**, flight **46.9** (a run minutes earlier measured 60.0 / 59.9 / 52.9;
run-to-run spread is material on this shared machine). Flight stream p95 19.7 →
2.0 ms. Flight is now limited by crowd simulation spikes while the camera moves
fast (p95 20 ms), single large uploads (max 21.6 ms) and heavier GPU frames
(completion p50 23 ms).

## 2026-10-08 — flight crowd spikes

Profiled the crowd along the benchmark flight path (Node, 96 m/s at 220 m): p50 4.0,
p95 13.3, max 25 ms. Fixes:
- A* explored the whole 19k-node city graph for long or unreachable goals (up to
  7.5 ms per path) although agents keep only 24 nodes. `NavGraph.path` gained an
  opt-in budget with a partial result (path to the explored node nearest the goal);
  the crowd uses 600 expansions and makes the partial end its goal.
- `randomNodeNear` collected every node within up to 1.2 km to pick one; it now
  samples a point in the disc and takes its nearest node (uniform over space).
- Goal changes are capped at 12 per update (flight average ~10); over budget an
  agent keeps its goal and asks next frame. Paths per frame were up to 44.
Node flight crowd: p50 3.4, p95 4.0, max 6.4 ms. `__selftest_spread`, failing all
session, now passes.

In the browser flight simulation was still p95 21 ms: every residency change made
the crowd re-index all walking triangles (7 ms for nine LOD 0 chunks), including
far LOD 1 uploads that carry none. Walking surfaces now have their own revision,
bumped only when a chunk with walking triangles arrives or leaves. Obstacle
re-indexing (1.7 ms per change) is left as is.

Benchmark (`benchmarks/2026-10-08T16-49-29-174Z`, fixed high, valid): hero **60.0**,
skyline **60.0** (0 intervals over 33 ms each), flight **56.3** (simulation p95 9.2,
stream max 17.8 ms — a single large upload; completion p50 17.4 ms).

## 2026-10-08 — far cascades alternate; walking support per chunk

- Far shadow cascades (2, 3; 160–1900 m) render on alternate frames, each keeping
  the matrix it was rendered with. GPU frame span 14.1 → 12.1 ms (hero), 13.9 →
  12.3 (skyline), 13.6 → 12.2 (flight). Hero pair identical at 4% fuzz.
- 41 of flight's 48 slow intervals coincided with simulation over 8 ms: the crowd
  rebuilt one walking index over all LOD 0 chunks on every LOD 0 swap. Walking
  support is now a `WalkingSurfaceSet` indexed per chunk (diffed by key and array
  identity); a split gives identical heights to one index at 2,000 points (a
  first-part-only mutant fails at 70).

**Benchmark** (`benchmarks/2026-10-08T16-58-19-982Z`, fixed high, headless,
1600 × 900, valid): **hero 60.0, skyline 60.0, flight 59.5** submitted frames/s
(baseline 42.4 / 36.9 / 31.7). Intervals over 33 ms: 0 / 0 / 11. Flight's residual
spikes: simulation max 15.6 ms, single uploads up to 18 ms. Presentation FPS is
not measured (headless); submitted and completed rates agree.

Not yet done: headed-Chrome confirmation, an adaptive-quality run, uploads split
across frames for the largest chunks, and richer distant detail now that GPU
headroom exists (~4.5 ms).

## 2026-10-10 — adaptive run, upload interleave off-thread, residency range

**Adaptive baseline** (`benchmarks/r14-adaptive`, adaptive from high): hero **37.3**, skyline **35.3**,
flight **49.5**. The governor upgraded on "fps > 58", which a 60 Hz vsync cap always satisfies, climbed to
ultra and held it at ~36 fps because its floor was 34; flight oscillated high ↔ ultra. Fixes in
`governQuality`: floor 52 fps; never climb above the tier it took over at; a tier failing twice becomes
the ceiling; skip two ticks (3 s) after a switch while its rebakes land.

Found on the way:
- **Stuck rebakes.** The rebake scan queued resident chunks past r + 1, whose worker results `applyBaked`
  drops as flown past: 13 (hero) / 22 (skyline) chunks re-baked forever on a held camera. The worker-path
  `rebakePending` also counted new-chunk bakes, contrary to its contract.
- **Drawing past the stream radius.** `drawChunks` drew every resident chunk (an LRU wider than the view
  distance the finite city never evicts), so after a tier drop the old tier's LOD 0 chunks were still
  drawn; medium flight ran ~50 fps. Rebake, upload and draw now share radius + 1. Light gathering used
  `320` m chunks where `chunkSize` is 256.
- **Rebake storm simulation.** Each upload re-indexed every crowd obstacle; during async streaming the
  rebuild is rate-limited to 250 ms (sync warm/capture stays exact). Storm simulation max 17–20 → 10–13 ms.
- **UV stride.** `uploadMesh` read UVs at stride 3 (they are 2 per vertex): the last third of every mesh's
  UVs were NaN. Invisible because no shader samples `uv`; self-test added (`__selftest.ts`, mutant fails).

**Uploads.** The interleave moved into the bake worker (`Mesh.packed`); the main thread only creates
buffers and writes them. Flight stream max 18 → **3.4 ms**, p95 1.7 → 1.0 (`benchmarks/r14-interleave`).
Splitting writes across frames is not needed at this size.

**Results** (headless, 1600 × 900): adaptive from high **60.0 / 60.0 / 60.0** (`r14-adaptive-final`,
tier held high throughout); fixed high 60.0 / 60.0 / 58.9 (`r14-fixed-final`). Adaptive from ultra on
flight: ultra fails, retries once, caps at high, 60 fps thereafter (`r14-storm-c`). Hero pair identical to
`shots/2026-10-07T15-30-45` at 4% fuzz.

## 2026-10-10 — distant detail: facades reach the screen

The GPU headroom (span 12.3 ms of 16.7) was meant for distant detail, but the first look showed
the real deficit was not geometry: every tower was a flat prism at every distance.
- **Instance bind leak.** `drawChunks` left `groundInst` (MAT_STREET) bound for all chunk draws, so
  every building shaded as paving and `facade()` never ran. Fixed; building walls opt in to
  `facade()` with a u offset (`FACADE_UV`), so counters, stalls, ribs and roof boxes stay plain.
- **Distance-surviving structure** in `facade()`: a louvred plant floor every 8–13 storeys and
  per-floor occupancy at night (lit floors as bands), keyed on a per-building seed hashed from a ±4%
  wall-colour jitter (the instance seed is per chunk and never reached the shader).
- **Pilasters** rose height/2 − 6 m above every roof (absolute top passed a length): the dashes
  over the skyline. Roof vents all stacked at the roof centre (`pushBoxAt` ignored x/z).

Cost: G-buffer 2.26 → 2.20 ms, span 12.34 → 12.22 ms (`r14-passes-facade`). Fixed high
60.0 / 59.8 / 59.9, adaptive 60.0 / 60.0 / 60.0 (`r14-facade-fixed`, `r14-facade-adaptive`).
The hero pair changes by design (facades, lit windows, glowing lanterns); paving is unchanged.

## 2026-10-11 — post-merge benchmarks, headed Chrome, crowd obstacle locality

**Crowd spikes.** A Node profile along the benchmark flight path (residency and LOD
as the high tier, 250 ms obstacle limit) put flight's remaining simulation spikes on
chunk crossings, where 19–32 chunks change LOD at once: obstacle indexing over every
resident chunk 3.5–6.5 ms, walking surfaces 1.6–4 ms, update +1–3 ms. Obstacles now
come only from chunks within 384 m of the camera (viewRadius ≤ 240 + pad +
retirement lag): 0.6–1.0 ms per rebuild; frames over 8 ms on the path 32 → 11.

**Benchmarks** at `2466fde` (post-merge: winding fix, pose fix, downpipes, kerbs,
gutter, obstacle locality), 1600 × 900:

| Run | hero | skyline | flight | flight sim p95 / max | flight >33 ms |
|---|---|---|---|---|---|
| fixed high, headless (`r14-2026-10-11-fixed`) | 59.99 | 60.00 | 59.99 | 5.0 / **7.0** ms (was 15.8) | 0 (was 2) |
| adaptive from high, headless (`r14-2026-10-11-adaptive`) | 59.99 | 60.00 | 59.99 | 5.0 / 9.8 ms | 1 |
| fixed high, **headed** Chrome 153 (`r14-2026-10-11-headed`) | 59.99 | 59.86 | 59.94 | — | 3 |

Adaptive held `high` throughout. Headed completed frames match submitted (59.96 /
59.80 / 59.92); display presentation is not measurable by this harness (queue
retirement only), as its report states.

**Motion shimmer.** A 30 m/s lateral pan of the skyline view, 40 screenshots at a
fixed cadence, on HEAD and on the pre-facade build `a57253d`: the window grid moves
with the camera as stable texture, no visible strobing. The temporal second
difference is noise-limited (sky region 13–20 from tower edges sweeping across), and
shows distant towers equal (18.6 vs 18.4) and near towers calmer (15.6 → 11.4: the
floating pilasters and pipe slabs are gone).

## 2026-10-12 — cold boot, street band cost, final runs

**Cold boot** (benchmark `startup.streamSettled`: pose set → nothing left to stream or
re-bake, natural streaming): navigation → ready 0.6 s; hero 3.1 s / 141 chunks, skyline
2.7 s / 90 chunks; 60 fps with 0 intervals over 33 ms during boot.

**Street band.** Facade props now sit on their walls (32% before) and a street band dresses
floors 0–3: LOD 0 chunks 92k → 107k triangles. At LOD 1 it first added ~6k triangles to
each of ~130 chunks, drawn again by the shadow cascades: flight GPU completion p95 18 → 24
ms, 9–11 intervals over 33 ms. Street-band kinds are now near-field only (LOD 1 32.6k,
below the 32.9k before the band).

**Final** (`9ea641e`, headless, 1600 × 900): fixed 59.99 / 60.00 / 59.96 (flight re-run
after the lantern restore); adaptive 60.00 / 60.02 / 59.94, held `high`. One adaptive flight
run measured 59.24 with 22 slow intervals; the re-run 59.94 / 2 (machine contention).

## 2026-10-13 — review 4 fixes (`b751c69`), same-window A/B

Reports: `benchmarks/review4-ab/` (hero pass runs, base = `6301ae6`). The machine was loaded throughout (`opencode` at 80–90% CPU), so absolute numbers moved run
to run; the comparison is interleaved against a worktree at `6301ae6`, same window.

- **All routes, fixed high** (base / new, two pairs): hero 57.1 / 57.2 then 57.5 / 50.6;
  skyline 60.0 / 60.0 twice; flight 58.4 / 58.7 then 58.5 / 56.6.
- **Hero GPU passes** (`--gpu-passes`, four pairs, alternating which side runs first): span
  base 14.89, 14.96, 17.79, 17.03 ms; new 14.94, 19.04, 15.20, 17.66 ms. Every slow run
  rose on every pass at once (gbuffer, light binning, lighting together), on either side,
  which is contention rather than content; best of each side 14.89 vs 14.94 ms.

No measurable cost. The height envelope lowers mean building height 192 → 177 m (analytic
0.43M → 0.41M triangles over 64 chunks); goods, braziers, fire lights and scaffold rooms add
near-field geometry only. The benchmark keeps the old skyline camera, `(900, 120, 1400)`.

**Crown and envelope scatter** (`MAX_FLOORS` 160 → 256, per-lot envelope ±20%; heart towers
to 819 m): GPU span, two pairs against `6301ae6`: hero 14.25 / 14.21 → 14.40 / 14.40 ms;
skyline 11.24 / 12.05 → 11.92 / 11.80 ms (gbuffer +0.2–0.35 ms). 59.1–60.1 fps throughout.

## 2026-10-13 — D30 furniture islands, same-window A/B

Reports: `benchmarks/d30-islands-ab/` (hero pass runs, base = `69e675d`, five pairs
interleaved). Uncontended pairs, GPU span base / new: 14.54, 14.60 / 14.75, 14.77 ms and
13.69, 13.67 / 13.85 ms; submitted 58.4–60.1 / 57.8–60.0 per second. **Cost +0.17–0.21 ms
(~1.3%).** Pairs 4–5 collapsed to 43–45/s with every pass up ~50% at once, TAA included,
on both sides (new 20.16 / 19.93 ms, base 20.89 ms): contention from another app's
renderer (a ChatGPT/Codex framework process at ~21% CPU), not content.

`CLUTTER_TRIS` 9000 -> 12000 per chunk: footway furniture 102 -> 135 items and 4.5k -> 7.6k
triangles per chunk over the citygen self-test's 8 chunks. On the six spine chunks the
islands add 4.7–7.0k triangles each (13–20 islands, 58–99 pieces, LOD 0 only), and footway
furniture there runs 11–18k: the throttle widens spacing past the budget rather than
cutting off, by design.

## 2026-10-13 — sheet D foliage, `garden` route

No route saw the green belt (flight passes ~600 m off it at 220 m), so `benchmark.mjs`
gained `--route=garden`: a held camera at pose 13's position. It is outside `--route=all`,
so earlier "all" reports stay comparable. Reports: `benchmarks/sheet-d-foliage-ab/`, three
interleaved pairs against `7e399b6`.

- GPU span base / new: 11.00, 11.84, 11.66 / 12.05, 11.70, 11.98 ms; **about +0.4 ms**, most
  of it shadow casting (cascades 2+3 alternate run to run, so their sum is the stable
  figure: 2.74, 2.74, 3.09 / 3.23, 3.30, 3.20 ms). Every run 59.97–60.08/s.
- Triangles, LOD 0: the densest green-belt chunk (1,4) foliage 194k -> 524k (23 of 31
  buildings terraced); (0,4) 55k -> 116k; (1,3) 38k -> 69k. LOD 1 unchanged (leaf detail
  is near-field only). The first pass, without a per-building budget, put 1.04M on (1,4)
  and 139k on one 123 m tower; `TERRACE_HANG_BUDGET` scales ivy and hanging masses so a
  building spends about 360 spheres on them, evenly over its bands.

## 2026-10-13 — sheet C ground fire, same-window A/B

Reports: `benchmarks/sheet-c-ground-fire-ab/` (hero, two interleaved pairs against
`496e1e9`; the hero stands ~400 m from the old town). GPU span base / new: 14.31, 14.59 /
14.77, 14.08 ms: no measurable cost. Light binning rose 0.82, 0.85 -> 1.10, 1.05 ms on both
pairs (footway braziers now carry a fire light, ruins have two or three street-level
yards with two lights each). Furniture over the self-test's 8 chunks: 148 items, 9.3k
triangles, 17.8 lamps (old-town alleys now carry the lived kit at 0.4 of the street rate).

## 2026-10-13 — sheet B accretion, same-window A/B

Reports: `benchmarks/sheet-b-accretion-ab/` (against `17cd839`). Skyline, two pairs: GPU
span 12.02, 12.00 -> 12.38, 12.27 ms (shadows +0.2-0.3). Hero, two clean pairs: 14.05,
14.98 -> 14.74, 14.65 ms, about +0.2 ms; a third pair ran contended on both sides (TAA
0.48 / 0.53 ms, 52 and 47/s) and is not counted. More scaffolds (rust 0.5, glass 0.45,
canal 0.4, copper 0.2), denser room stacks, a second face on 40%, and crowns of rooms on
the non-teal accreted towers.

## 2026-10-13 — session end: the per-item checks missed a regression

Reports: `benchmarks/session-end-ab/` (`first-*` at `166f659`, `final-*` after the fixes,
both against the session start `69e675d`, interleaved, on a quiet machine).

**First pass, `166f659`:** hero GPU span 13.84, 13.88, 13.69 -> 14.92, 15.05, 14.99 ms and
**57.0-57.5 submitted/s against 60.0**: R14 broken at the hero. Skyline 11.99, 12.02 ->
12.23, 12.11 ms (60/s); garden 11.44 -> 11.90 ms (60/s). The per-item A/Bs had each looked
small (+0.1 to +0.3 ms, two of them run contended), and they did not add up to this.

**Where it was:** CPU unchanged (simulation 3.9 -> 4.0 ms). Shadows +0.85-1.0 ms, G-buffer
+0.2. Triangles in the hero's 5x5 neighbourhood 1.59M -> 1.87M (stall dressing +97k, sheet B
+82k with 50k at LOD 1, D30 +60k, sheet C +41k); the far cascades sweep LOD 1 out to 7 chunks.

**Trims, measured each time:** small spheres in produce, dressing and furniture 3 rings -> 2
and produce heaps back to 3-5 (-72k triangles, ~-0.1 ms); sheet B crowns, second scaffold face
and extra room stacks near-field only (LOD 1 across the residency 4.64M -> 4.68M, i.e. back to
+1%; the crowns were also the "flecks" review 6 flagged); old-town wall props doubled on the
lower twelve storeys only; `CLUTTER_TRIS` 12000 -> 9000.

**Final, three rounds:** base 13.93, 13.75, 13.73 ms at 60.07, 59.98, 59.99/s; now 14.37,
14.34, 14.42 ms at **59.85, 59.85, 59.35/s** (p95 17.6 ms both; base drops no frame, now an
occasional single 33 ms frame, 475-479 of 480 in 8 s). Net cost of the session **+0.58 ms**.
A variant without the D30 lived kits measured 14.12, 14.38, 14.18 ms: they cost ~0.15 ms.
The hero is inside the band earlier sessions recorded as meeting R14 (59.1-60.1/s), not at
the clean 60.0 it started at.

**Lesson:** per-item A/Bs of a few tenths each, two of them contended, hid a 1.1 ms sum. Run
the session-start vs HEAD A/B before the review, not after.

