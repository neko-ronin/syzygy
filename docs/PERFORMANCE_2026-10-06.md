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
