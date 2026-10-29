# Review — `ALIASING_SETTLE_PROBE.md` (R3, does the capture converge?)

**Reviewed 2026-10-28 by the non-implementer.** No source was edited. The two
instruments under review (`tools/capture.mjs --freeze/--settle`,
`tools/measure_far_field.mjs`) were run against the probe's own frames, and one
control the probe says is not yet possible was run with existing app surface.
That control is reproducible from `shots/2026-10-28-r3-taa-control/` (`_README.txt`,
`make.mjs`).

> **Where the control lives now (2026-10-28, after the review).** `shots/` is gitignored
> (D22) and gets pruned, so the reviewer's one-off `make.mjs` would not have survived the
> round that acts on this finding. It is now `tools/r3_taa_control.mjs`, which boots its own
> dev server, writes the same seven frames and checks that the toggle actually took (it reads
> `taaEnabled` back out of `setQualityParams`, which resolves to `renderer.settings`; there is
> no `settings()` method, so the reviewer's readout printed `undefined`). The binned darkening
> statistic from `sign.mjs` is `measure_far_field.mjs --contrast=`.
>
> Run twice, independently, with the same result:
>
> | run | A21 vs A22 | B01 vs B02 | changed by TAA | darker | luma by contrast bin |
> | --- | --- | --- | --- | --- | --- |
> | reviewer, `2026-10-28-r3-taa-control` | md5 equal | md5 equal | 11.87 % | **98.83 %** | −0.09 / −5.1 / −10.4 / −21.9 |
> | tool, `shots/r3-taa-control/2026-10-29T03-39-57` | md5 equal | md5 equal | 11.86 % | **98.87 %** | −0.091 / −5.091 / −10.385 / −21.822 |
>
> The frozen pairs being byte-identical is what makes the on/off comparison valid: the world
> really is still, so the entire difference is the pass. A smooth-resample control
> (`--contrast` of a bicubic re-expansion against its source) splits 56.29 / 43.71, so one-way
> darkening is a property of this pass and not of the metric.


---

```
VERDICT:  more work needed
EVIDENCE: references/A-saturated-sheet.jpg (01-wide-skyline maps to "ALL" in
          references/sections.json:62);
          shots/2026-10-28T18-58-21/ + 18-58-48/ (settle 1 vs 600) and
          18-59-16/ + 18-59-29/ (aerial 1 vs 600), _capture.json + PNGs;
          shots/2026-10-28-r3-taa-control/{A11,A12,A21,A22,A31,B01,B02}.png
          (+ _README.txt, make.mjs, sign.mjs, lum.mjs).
          No compare.mjs grid: nothing in the section changed, so there is no
          before/after frame to judge. The frame question here is only "are the
          two settle levels the same picture", and that was judged on a 2x and
          8x crop of the far band (identical to the eye — see below).
JUDGED:   the instrument, not the section. Specifically: whether a settle sweep
          measures history accumulation, and what the TAA resolve does with an
          edge. The picture is right; the explanation of why is wrong, and the
          wrong explanation points R3 at the wrong next change.
GAP:      the TAA pass has no history and no sub-pixel jitter — nothing ever
          writes its two history textures (src/render/renderer.ts:909, 1962,
          2014, 2521-2530). So "TAA converged before the budget" is not a fact
          about convergence: the frame has no temporal state to converge. The
          probe's sentence "the image is a fixed point" is contradicted by its
          own --diff — 6.40 % of the upper frame changes by >2 luma between
          settle 1 and settle 600.
NEXT:     restore the missing history write (copy the resolved frame into
          taa[(frameIndex + 1) % 2]) and add the sub-pixel projection jitter the
          shader was written for; then re-run this probe. Not the TAA toggle —
          it already exists (`__syzygy.setQualityParams({taaEnabled:false})`,
          src/main.ts:983), and it answers the question in one session.
CONFIRMED: none of R3's done-when clauses exist to confirm — R3 has options and
          an engineering note, no done-when. What is confirmed is narrower and
          real: the two v1 faults are real and the v2 metric detects them.
          (1) mean |dL/dx| moves the wrong way on a known-aliased image:
          1.506 -> 1.361 on the nearest-neighbour control, while spikePx rises
          4.86 % -> 6.93 %. (2) --sequence never froze the world. Both reproduce.
```

---

## Q1. Does the fixed-point finding hold when measured my own way?

**The number reproduces. The sentence it is attached to does not.**

`node tools/measure_far_field.mjs ... --ratio=...`, upper 360 rows, exactly as
registered (r = spikePx@600 / spikePx@1):

| frame | spikePx | r |
| --- | --- | --- |
| `01-wide-skyline` 1 / 40 / 600 | 4.86 / 4.85 / 4.85 % | 0.998 |
| `05-aerial-top` 1 / 600 | 6.19 / 6.18 % | 0.999 |
| `01-wide-skyline-night` 1 / 600 | 51.11 / 51.18 % | 1.001 |

Identical to the probe's table to the digit. The metric is not broken: my
synthetic control reproduces v2's behaviour (nearest-neighbour 4.86 -> 6.93 %,
1.43x; smooth resample -> 2.62 %, 0.54x; identical image -> 0 difference), and it
reproduces v1's failure (mean |dL/dx| 1.506 -> 1.361 on the *worse* image). **The
v1 void is earned.**

Then `--diff` on the same pairs — the mode the probe wrote and did not use on
them:

| pair (upper 360 rows) | mean | >2 luma | >8 luma | max |
| --- | --- | --- | --- | --- |
| skyline 1 vs 600 | 0.698 | **6.40 %** | 1.82 % | 80.0 |
| skyline 1 vs 40 | 0.269 | 1.61 % | 0.29 % | 44.0 |
| aerial 1 vs 600 | 1.311 | **16.39 %** | 2.17 % | 51.2 |
| night 1 vs 600 | 7.432 | **80.22 %** | 41.60 % | 45.2 |

"600 frames of history change one pixel in ten thousand" is false by three
orders of magnitude. 6.4 % of the upper frame moves by more than 2 luma, 1.8 %
by more than 8. The image is not a fixed point between those two runs, and
`spikePx` stayed at 0.998 *because it is a texture statistic*: a sub-pixel
displacement changes pixels at every high-contrast edge without changing the
population of single-pixel steps. A statistic can be stable while the picture
under it moves. That is the exact shape of the failure this project keeps
paying for.

**The frame is a fixed point in a different sense, and I measured that too.** In
one page session, world frozen, film grain off, TAA on: three captures ~1000
frames apart are byte-identical (md5 `5d1f0fa5…` at frames 5045, 6107, 9116).
TAA off: `f21b24a…` twice. With grain on, the residue is 0.170 mean / 0.03 % >2 /
max 3.4 — i.e. **the film grain is the only thing that changes inside a run**
(`post.wgsl:493` seeds it with `F.time.z`, the frame index). So settling inside a
run is a literal no-op — but a no-op is also what a pass with *no temporal state*
does, which is Q3.

## Q2. Is the freeze actually working?

**Within a run, yes. Across the three runs, no — and the sweep is three runs.**

`freezeCapture` sets `world.paused`, and `main.ts:498` gates the whole sim on it:
`camera.update`, `integrateWorld`, `weather.update`, `crowd.update`,
`traffic.update`. Good. That is why my in-session frames are stable.

But each settle level is a separate page load, and `_capture.json` shows the
frozen state is not the same state:

| | settle 1 (`18-58-21`) | settle 600 (`18-58-48`) |
| --- | --- | --- |
| crowd sample[0] | `310.03, 0.35, 448.19` | `310.34, 0.53, 446.31` (walked 1.9 m) |
| `crowdDebug.frames` | 3447 | 3511 |
| sun elevation | 0.880 | 0.882 |
| dayPhase | 0.820 | 0.821 |
| camera position | y 150.016197 | y 150.006239 (0.0100 m) |
| view direction | — | differs 0.0014° |

The probe's premise — *"a settle sweep then changes **history and nothing
else**"* — requires the frozen state to be the same state at both settle levels.
**It is not**: the camera alone differs by 1e-2 m and 1e-3 deg. The registered
void clause — *"a `frozen` field that is not true voids that row"* — is satisfied
on the letter (`frozen: true`) and broken in substance: the field records that
the world was paused, not that the two frames are the same frame.

Fairly: the view difference is only 0.04 px of edge motion, so it does not by
itself explain 6.4 %. I could not attribute the cross-run difference to a single
recorded variable: the diff is edge-localised and **zero-mean** (49.4 % darker /
50.6 % lighter, per-band mean ≈ 0), which rules out an exposure or grade shift
and points at a geometric or per-pixel effect that the sidecar does not record.
That is the finding: the sidecar does not carry enough state to claim two runs
are comparable, and the comparison that carries the verdict is between two runs.

Everything else the brief asks for is clean: all five runs `frozen: true`,
`quality: medium`, every stat `medium`, `starved: 0`, `notes: []`, no errors, seed
6191639. `_capture.json` records `settle` and `frozen` as claimed — but **not**
the frames advanced or the paced/stepped flag, so the registered
`under-converged` void condition is printed to stdout and lost, i.e. it cannot be
re-checked from the artifact (PROCESS rule 3).

Also worth naming: `--settle=1` is one frame **on top of the pose's own 30**, so
the sweep compares 31 vs 630. The doc calls 1 "the history floor" and argues the
question is "whether history accumulation helps at all". 31 frames is not "at
all", and the harness cannot reach the floor without a `--no-pose-settle`.

## Q3. Can the pass change the image at all? (the admitted hole, now closed)

Read `src/shaders/post.wgsl:123-180` and `src/render/renderer.ts:2012-2017`:

- **History is sampled** — binding 7, `prevTex = t.taaView[frameIndex % 2]`,
  `textureSampleLevel(prevTex, linSamp, uv - motion)`.
- **History is never written.** The two history textures are created
  (renderer.ts:909) and then only ever *bound* (renderer.ts:1962, binding 7) and
  *read* (renderer.ts:2014, `taaView[prevIdx]`). The only other touch is
  `resetTemporalHistory()` (renderer.ts:2521-2530), which **clears** both to
  zero. No `copyTextureToTexture`, no blit into them, no render pass targeting
  them anywhere in the tree. The header's "the TAA/composite pair ping-pongs"
  (renderer.ts:13) describes a ping-pong whose second leg was never built.
- **The blend weight (0.82 history) is not the problem**; with a zero history it
  is the whole operator: `mix(centerY, clamp(0, lo, hi), 0.82)`, then clamped
  again. On a flat neighbourhood `lo ≈ hi ≈ center` and nothing happens; on an
  edge it pulls the pixel 82 % of the way to the neighbourhood floor.
- **There is no sub-pixel jitter anywhere.** `writeCaptureProjection`
  (`src/render/captureprojection.ts:4-7`) is a plain lookAt + reverse-Z
  perspective; `prevViewProj` is a straight copy of `viewProj`
  (renderer.ts:937-938). No Halton, no jitter term in the projection. TAA
  without jitter has no new samples to accumulate — there is nothing to converge
  *to*.

So the pass cannot antialias, and it does change the image — a lot. Measured with
the toggle that already exists (`__syzygy.setQualityParams({taaEnabled:false})`,
main.ts:983), same pose, same session, same settle, grain 0:

```
A21 (TAA on) vs B01 (TAA off), upper 360 rows:
  diff 1.576 mean, 11.87 % > 2 luma, 6.05 % > 8, max 74.8
  98.83 % of changed pixels are DARKER with TAA on
  darkening by local 3x3 luma range:  0-4: -0.09   4-12: -5.1
                                     12-30: -10.4   30+: -21.9
  frame mean luma 121.79 (on) vs 127.83 (off)
```

A pass whose output is a function of the current frame alone, whose effect is a
contrast-scaled darkening toward the local minimum, and which is byte-identical
over 1000 frames. **It is not a temporal filter. It is a per-frame edge crush.**
That is also why the two settle levels look identical in the far-band crop (2x
and 8x): there is no accumulation to see, and the aliased silhouette edges are
single-pixel steps in both.

The probe's own two "does not say" bullets need correcting in light of this. It
says a resolve that did nothing would also be a fixed point — true, and that is
what this is, except that it is not "nothing": it darkens every edge. And the
fixed point does not need 630 frames to establish; one `--eval` and one read of
the shader establish it.

## Q4. Is `spikePx` a legitimate proxy for "crawling distance"?

**No, and the probe's own numbers show why.** `spikePx` counts isolated
single-pixel steps in a still: `|L - mean(L±1)| > 6`. It is invariant to a
sub-pixel translation (the step population is unchanged), which is exactly how
6.4 % of the frame moved while it read 0.998. It saturates on legitimate
high-frequency detail — the night pose sits at 51 % because lanterns and window
lattice are high-frequency everywhere (the probe correctly reports that row as
unusable rather than as a pass). And by construction it cannot see crawling at
all: a still is static, and the defect R3 is named for is *temporal* instability
under motion.

What would catch it, cheapest first:

1. **Pinning** — frozen world, grain off, TAA on/off, same session, `--diff`
   (or md5). This distinguishes "no temporal state" from "converged" and costs
   one session. Done above.
2. **Sub-pixel jitter pair on a moving camera** — two frames offset by a known
   fraction of a pixel, measuring edge-position variance, which is the still-
   frame analogue of crawl.
3. **A two-frame diff from the reference videos** at matched motion — the actual
   bar, and motion is the only place crawl can be observed.

This does not change the "more settle will not help" conclusion; it changes what
the conclusion is *about*. A metric that cannot see motion is the wrong
pass/fail for a row whose subject is motion.

## Q5. Is R3's sentence correctly corrected, and is the next step right?

Two clauses, two answers.

- *"does not converge inside the capture settle budget"* — **corrected, but for
  the wrong reason.** The capture budget is not the limit, yes. But the reason is
  not that convergence finishes before frame 30; it is that there is nothing that
  converges. The correction in `ROADMAP.md` asserts "TAA converges long before
  the capture budget" and "the aliasing that survives 630 frames is what the
  resolve leaves behind". Both are mechanism claims the probe did not measure
  and the code contradicts: the resolve leaves it behind because it never
  receives a second sample. The row's direction (renderer, not harness) is right,
  and stronger than the probe argues.
- *"TAA exists and is correct"* — **this is the clause that is actually false**,
  and the probe left it standing. No history, no jitter, and a measured edge
  crush.

So: R3 is a renderer row. **The next step should not be a TAA-on/off pair to
build.** The pair is the right question and it already exists —
`setQualityParams` is on the app surface, `--eval` can reach it, and the answer
took one session (11.87 % of the upper frame differs). Building a toggle first
would spend the row's cheapest step on a tool that is already there. The next
change is the fix: write the history (the missing ping-pong leg) and add the
sub-pixel jitter the shader was designed for, then re-run this probe with the
pinning control in-session. SMAA remains the wrong first move, as the roadmap
says — but for a reason the roadmap has not yet stated.

---

## Two document defects to fix in the same change (PROCESS rule 6)

1. `ROADMAP.md:428` still lists *"accumulate more history frames in the
   harness's `settle`"* as **"Options, best first"**, directly under an
   annotation that calls it dead. Two adjacent sentences, one of them false.
2. `ROADMAP.md:426` says *"no tier turns TAA off. Build the toggle first."* No
   tier does (`quality.ts:41-45`, all `taaEnabled: true`) — but the app surface
   does, and the sentence's conclusion does not follow from its premise.

Unrelated foot-gun found while reviewing, cheap to fix: `SYZYGY_TIMEOUT` is
milliseconds (`capture.mjs:39`) while `--timeout` is seconds
(`capture.mjs:82`). `SYZYGY_TIMEOUT=300` silently sets a 300 ms budget and the
run fails with "`window.__syzygy` is missing 15s after load" after 1.2 s. It cost
this review three runs.
