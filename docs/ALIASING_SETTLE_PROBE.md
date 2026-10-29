# Is the crawling distance the renderer, or the capture? (R3, probe 0)

**Registered 2026-10-27, before the runs.** `PROCESS.md` rule 1: the acceptance is written
down before the capture, and a clause that cannot be satisfied by construction is a broken
clause, not a failed round.

## Why this probe exists

`ROADMAP.md` R3 says the base image is unstable, and the reasoning is that *"everything else
in this list is wasted effort if the base image is unstable, so this precedes polish work."*
That is probably right. But the claim behind it — *"TAA exists and is correct but does not
converge inside the capture settle budget"* — has never been tested. It is a statement about
the **harness** written into a roadmap entry as if it were a statement about the renderer.

The harness settles **24–45 presented frames** per pose (`tools/capture.mjs`, pose table).
TAA accumulates over history, so a 30-frame image is a partially converged one by
construction. If distant silhouettes are still moving at frame 30, then every "perceptually
clean distance" verdict this project has recorded measured the capture, not the product —
including the comparison against the `inspirations/` bar, which is a video, i.e. fully
converged by definition.

So before choosing between the four options R3 lists (more history, sub-pixel jitter with N
samples, edge-aware resolve, SMAA-style pass), establish which problem is being solved. A
resolve change is a session; a settle change is a constant.

## The test

**Instrument v1 was void, and this section replaces it before any result is read.**
Two faults, both caught by control runs rather than by argument:

1. **`--sequence` does not freeze the world** (`freezeCapture` is called only in the
   hero-pair path). A settle sweep therefore changed *elapsed animation* as well as history —
   the settle-40 vs settle-600 pair differs on 9.2 % of upper-frame pixels, and that is the
   crowd and the weather, not convergence. Any number from it would have been two effects
   reported as one.
2. **Mean `|dL/dx|` is blind to aliasing.** A synthetic positive control — the same frame
   nearest-neighbour downscaled and re-expanded — *raised* the visible jaggies and *lowered*
   `mean|dL/dx|` (1.482 → 1.337). The registered primary moved the wrong way on a known-bad
   image, so it could not have detected non-convergence even if it had been there.

v2, registered before the runs it applies to:

- **`--freeze`**: the pose's own settle brings the camera to rest, then `freezeCapture`
  pauses the world, then `--settle` frames accumulate history on top. A settle sweep then
  changes **history and nothing else**. `_capture.json` records `frozen`.
- **Primary: spike share.** `spike` = `|L(x,y) − (L(x−1,y)+L(x+1,y))/2|`, and `spikePx` is
  the percentage of upper-frame pixels where it exceeds 6 luma. A resolved edge is a 2–3 px
  ramp and scores low; an unresolved silhouette is a single-pixel step and scores high.
  Validated on the synthetic control: nearest-neighbour alias 4.79 % → 6.84 % (1.43×), smooth
  resample 4.79 % → 3.50 % (0.73×), identical image → exactly 0 difference.

```bash
node tools/capture.mjs --sequence --pose=01-wide-skyline --freeze --settle=1   --quality=medium
node tools/capture.mjs --sequence --pose=01-wide-skyline --freeze --settle=40  --quality=medium
node tools/capture.mjs --sequence --pose=01-wide-skyline --freeze --settle=600 --quality=medium
node tools/capture.mjs --sequence --pose=aerial-top      --freeze --settle=1   --quality=medium
node tools/capture.mjs --sequence --pose=aerial-top      --freeze --settle=600 --quality=medium
```

`--sequence --pose=` is the citable path: `_capture.json` and a contact sheet, per §38.
`01-wide-skyline` is the pose the ITERATION note calls the worst case; `05-aerial-top` is the
densest far field in the set.

## The decision rule, fixed now (v2)

Let `r = spikePx at 600 / spikePx at 1`, upper frame, world frozen. The comparison point is 1
rather than 40 because the question is whether history accumulation helps at all and where it
stops — 40 is already the project's status quo and its value is measured in the same sweep.

| `r` | reading | what R3 becomes |
| --- | --- | --- |
| **≤ 0.80** | history accumulation materially resolves the far field; the capture's 24–45 frames were under-converged | **harness row first** — raise settle (or report it honestly), re-judge the distance bar, then ask whether a resolve change is still needed |
| **0.80 < r < 0.95** | both contribute | report the split; the constant lands first |
| **≥ 0.95** | 600 frames of history does not resolve the far field | **renderer row** — R3 proceeds as written, and the roadmap's "does not converge inside the capture budget" sentence is corrected |

A run printing `under-converged`, or a `frozen` field that is not `true`, voids that row rather
than being read as a result.

## Result (2026-10-28)

Runs, all `--sequence --freeze --quality=medium`, seed 6191639, `frozen: true`, no errors,
`starved 0`, no `under-converged` line:

| run | pose | settle (on top of the pose's own 30) |
| --- | --- | --- |
| `18-58-21` | `01-wide-skyline`, `-night` | 1 |
| `18-58-34` | `01-wide-skyline`, `-night` | 40 |
| `18-58-48` | `01-wide-skyline`, `-night` | 600 |
| `18-59-16` | `05-aerial-top` | 1 |
| `18-59-29` | `05-aerial-top` | 600 |

`node tools/measure_far_field.mjs`, upper 360 rows, world frozen:

| frame | spikePx (>6 luma) | vs settle 1 |
| --- | --- | --- |
| `01-wide-skyline` settle 1 / 40 / 600 | **4.86 / 4.85 / 4.85 %** | 0.998 |
| `05-aerial-top` settle 1 / 600 | **6.19 / 6.18 %** | 0.998 |
| `01-wide-skyline-night` settle 1 → 600 | 51.11 → 51.18 % | 1.001 |

**The registered rule said "renderer row", and that part survived review. The mechanism I
gave it did not.** The reviewer of this probe returned **`more work needed`**
([`VISION_R3_SETTLE_PROBE.md`](VISION_R3_SETTLE_PROBE.md)) and was right, on two counts I
reproduced myself:

1. **The image is not a fixed point.** My own `--diff` on the frozen pair shows **6.40 %** of
   the upper frame changing by >2 luma between settle 1 and 600 (aerial **16.39 %**). `spikePx`
   stayed flat because what changes is not edge structure — it is noise that nothing averages
   away. "The frame is a fixed point" was a claim about one statistic reported as a claim about
   the image.
2. **The reason nothing accumulates is that TAA has no history at all.** In
   `src/render/renderer.ts` the two `taa` textures are created (909), bound as *sources*
   (1962, 1998, 2005, 2008, 2014, 2016, 2027, 2053) and cleared by `resetTemporalHistory`
   (2521-2530) — and **never written by any pass**. `post.wgsl` blends `mix(centerY, hist,
   0.82)`, and `hist` is a clamp of the always-zero texture, so the resolve mixes 82 % of a
   black neighbourhood floor into every pixel: a **per-frame edge crush that darkens in
   proportion to local contrast**, not a temporal filter. The reviewer's on/off control
   confirms the signature — 11.87 % of the upper frame differs, 98.83 % of it darker with TAA
   on, darkening −0.09 / −5.1 / −10.4 / −21.9 luma by contrast quartile — and the control is
   now `tools/r3_taa_control.mjs` (the reviewer's script was in gitignored `shots/`), which
   reproduced it independently at 98.87 % / −0.091 / −5.091 / −10.385 / −21.822 with both
   frozen pairs md5-identical.

So the roadmap's original sentence was wrong in a different and worse way than this probe
first said: not "TAA does not converge inside the capture budget" but **"the TAA pass has no
temporal state to converge"**. Raising `settle` can never help — which is the "more history is
dead" conclusion, arriving by a route that also names the missing code.

## What follows for R3

The next change is **not** an SMAA pass, **not** "accumulate more history", and **not** a TAA
toggle — the toggle already exists (`__syzygy.setQualityParams({ taaEnabled: false })`,
`src/main.ts:983`). It is:

1. write the resolved frame into the other history texture each frame (`frameIndex % 2`
   ping-pong), so history exists;
2. add the sub-pixel projection jitter `post.wgsl` was written for — without jitter a temporal
   filter has nothing to reconstruct;
3. re-run this probe. The fixed-point result should *change*: if `spikePx` still reads 0.998 at
   600 frames once history is real, the resolve is broken in a second, independent way.

That is a registered round, not a patch made in passing — it changes the image everywhere at
once and needs a gate and a review like round 4a's.

## What this probe cannot establish

- Whether the corrected resolve is *good*. This probe only established that the current one is
  not temporal.
- Motion. A still cannot show swim; convergence is necessary, not sufficient, for a clean
  image in motion.
- Anything at `high` tier, where the reference bar is judged. This ran at `medium` so it is
  comparable with the certified frames; a tier difference is a different probe.


