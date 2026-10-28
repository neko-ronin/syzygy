# Ground at close range, round 4a — the material below the tile

**Implementer's record. The verdict is the reviewer's. This file says what changed,
what it measured, and what it did not establish. It does not claim a verdict.**

**Gate registered before the capture** (2026-10-26), per `PROCESS.md` rule 1 and the
`SILT_CLASS_GATE.md` §7 replacement clause: a round's acceptance is written down before
its run, and a clause that cannot be satisfied by construction is a broken clause, not a
failed round.

## 0. Why this round exists, and what changed in the premise

`HANDOFF.md` §F8 ("the bare deck at close range", 2026-10-04) is the row: *"roughly seventy
percent of the first honest close-focus frame is a featureless grey slab … no joints, no
grain, no slab pattern, no wear."* That was true of the 2026-10-04 frame. It is not true of
the current build.

Independent review [`VISION_F8_CLOSE_RANGE.md`](VISION_F8_CLOSE_RANGE.md) measured both
frames at 2.7–3.0 m and split the row in two:

| | 2026-10-04 | 2026-10-25 (`01g-kerb-face`) |
| --- | --- | --- |
| joint-free 24×24 windows | 1477 of 1920 (77 %) | 10 % |
| median sd inside a slab | 0.42 | 1.28 |
| near-field structure | one kerb line | a 0.30 m lattice, world-locked (±4 % over 2.5× depth) |

So the *symptom* F8 named ("no joints") is gone and the row's first clause is met. What
remains is the second clause — **a material read** — and the review's number for it is
uncomfortable: the near field is the **flattest** part of the frame. Grain falls toward the
camera (HF sd 1.5–1.9 in the bottom half against 2.33–2.99 in the top half), and box(100)
sd is **6.08** against 14.1–25.4 in every section-B near ground. It went from an empty
plane to a **ruled** plane.

The mechanism is in `src/shaders/gbuffer.wgsl`, not in lighting and not in the bake:

- the shared grain is `fbm2(p * prm.w, oct)` with `prm.w` 1.2–9.0 cycles/m, i.e. a
  0.11–0.83 m wavelength, amplitude ±10 %. At 2.7 m that is a **175 px blob**, not grain,
  and its finest octave contributes ~1.3 % albedo — which is the measured 1.28 sd;
- the per-slab hash exists (`0.88 + 0.24 * hash21(cell …)`) but a single ±12 % draw per
  0.3 m cell does not group into patches at 100 px scale;
- there is no aggregate at all. Nothing in the branch draws below ~4 cm.

## 1. What changed

> **Read this section as the first registration, not as the shipped code.** Two reviews
> found the first version's constants wrong (§5, §6) and the fourth attempt is what ships:
> mottle at **0.6 cyc·m⁻¹** with an explicit `fbm2` remap and amplitude **0.35**, aggregate
> unchanged at 34/63 cyc·m⁻¹ ±21 % faded 5→9 m. §7 has the final table.

One change, in one function (`groundSurface`, constructed-paving branch), no geometry, no
bake, no new tag:

1. **`mottle`** — `fbm2(p * 2.6, 3)`, a 0.2–1 m patchwork at ±20 % albedo, running to the
   horizon. This is the sheet-B weathering layer: "irregular pale accumulation, dark
   joints, mottled exposed areas" (`STREET_SPEC.md` §B).
2. **`agg`** — two octaves at 34 and 63 cycles/m (1.6–3 cm), ±21 %, faded out from 5 m to
   9 m. It exists only where the eye can resolve it, because a closer octave at range is
   sub-pixel and aliases — that is R3's problem, and R3 has not been fixed.
3. **Per-slab spread** widened `0.88 + 0.24·h` → `0.82 + 0.36·h`.

**What deliberately did not change: the deck's albedo level.** The independent review
proposed "the deck's albedo one step down so it sits below the facades", with an acceptance
of *deck mean ≤ 0.85× frame mean*. That clause is rejected here, and the reviewer is wrong
on it rather than being overruled on taste: `STREET_SPEC.md` §B, written from the reference
sheets, says **"Foreground treads are lighter than adjacent dark fronts … B is therefore not
simply a dark road slot"**, and §A says "the pedestrian surface can be a bright plane." Our
deck measures 1.49× the facades; the sheet shows the same relationship. Darkening it to
0.85× the frame mean would move away from the bar, and it would reopen the 0.62 deck
multiplier that was already recorded and reverted as an over-correction. The round keeps the
value hierarchy and fixes the flatness.

## 2. Pre-registered acceptance

Measured on `01g-kerb-face` from a fresh `--sequence --quality medium` run
(`SYZYGY_TIMEOUT=900000`; 28 poses; one run, judged against the same-build pair
`18-24-47`/`18-34-37` for the noise floor). Near strip = bottom 50 rows, deck only.

**Definitions live in `tools/measure_close_range.mjs`**, not in a throwaway script: the
first pass of this round measured "detail energy" as a per-band mean of `|dL/dy|`, which is
confounded by pitch (a band with three joint rows averages less than one with twelve,
whatever their contrast) and wrongly implied the distance was noisier than the near field.
The tool was run on the pre-change frame before this run landed; where its definition
differs from the reviewer's, both numbers are given and the gate is judged on the ratio.

1. **Material read, the row's own condition.** HF sd in the near strip **≥ 3.5** (now
   1.5–1.9) **and not weaker near than far** (now inverted).
2. **Value grouping at patch scale.** box(100) sd in the near strip **≥ 1.7× the pre-change
   value under the same implementation**: reviewer definition 6.08 → **≥ 10.3**; tool
   definition 3.81 → **≥ 6.5**. Plus at least **3** near-strip block means **≥ 4 luma**
   apart (now 4 bands spanning 11.9 luma).
   **Caveat registered before the run landed:** this metric is composition-sensitive, not
   material-sensitive. The 2026-10-04 *bare slab* frame scores box(100) sd **9.86** under
   the tool, higher than the current frame's 3.81, because a bright kerb line crosses the
   strip and a single gradient counts as "grouping". Clause 2 is therefore **supplementary**;
   clause 1 and the band count are the primary read, and no verdict should rest on box(100)
   alone in either direction.
3. **The lattice survives.** Joint contrast does not collapse: p5/p95 separation stays
   **≥ 25 luma** (reviewer 34.9, tool 58.1), and the reported periods keep the same
   fundamental — the tool now prints the top three autocorrelation peaks instead of
   calling the second harmonic "the pitch".
4. **Value hierarchy is not inverted.** Deck/facade ratio stays in **1.2–1.8×** (now 1.49×).
   This is the clause that replaces the review's rejected darkening target.
5. **No new aliasing.** Far-field `|dL/dx|` (y 380–460) does not rise above the pre-change
   **5.3**, and the aggregate fade is doing that work.
6. **The fall zone does not move.** Poses 16–20's yard band ≤ **0.03 pp** against the
   pre-change pair (the silt class does not enter this branch; a leak here means the change
   reached ground it should not have).
7. **Process.** Sequence `PASS`, `medium` on every stat entry, `starved 0`, no GPU/WGSL
   error.

## 3. What this round does not establish

> Written before the reviews. F8 **was** closed by round 4a (§7); the three limits below
> held, and the first bullet is the one the third review settled.

- It does not close F8. The review's second defect (value grouping against the *sheet's*
  fog-lit corridor) is a judgement for a reviewer on the new frame, not a number here.
- It does not touch the lattice itself, the 0.30 m pitch, the kerb, or the silt class.
- It does not fix aliasing. Clause 5 keeps this round from *adding* to it.

## 4. Iteration log

- **First attempt (amp 0.30 / 47 & 89 cyc·m⁻¹), full sequence `22-50-33`, `PASS` 498.6 s,
  28/28 `medium`, no errors, `starved 0`.** Clause 1 measured **3.10** against a registered
  **3.5** — a 2.05× improvement (1.51 → 3.10), not the bar. Clause 2 4.28 (floor 3.81) —
  supplementary, as registered. Clauses 3–5 and 7 passed. Fall controls: **strict** worst
  +0.0065 pp (pose 18), all inside ±0.03; **lean** pose 20 moved +0.037 pp (≈530 px), which
  is recorded rather than rounded away — the change reaches ordinary `paving` in the frame
  around the fall zone, never the `silt` class itself.
  **The round is not `done` on that run**, and the run is kept as `pre` for the second.
- **Second attempt (amp 0.42 / 34 & 63 cyc·m⁻¹).** Checked with single shots
  (`23-05-04` high, `23-06-12` medium) because a `--pose` shot is cheap and **is not cited
  anywhere below** — §38 makes a single shot evidence for nothing. Medium single shot
  measured **3.92** HF sd, deck/facade 1.40, far-field gradient 4.49. The 2× crop at
  (180, 660) 400×240 shows a mottled stone surface with irregular pale and dark patches
  where the pre-change crop was flat inside every slab.
- **Certification run** for the second attempt follows; its numbers, not the single shot's,
  are what any verdict may use.

## 5. Second review, and the third attempt

`VISION_F8_CLOSE_RANGE_4A.md` returned **`more work needed`** on the `23-08-53` sequence and
found a real implementation error, not a taste difference:

- **`fbm2` is not normalised.** Two octaves return [0, 0.75] with mean 0.375, so
  `0.84 + 0.32 * mottle` delivered about **±5 % at 1σ**, not the ±20 % its constants read as.
  The declared amplitude was never the delivered amplitude, in either attempt.
- **The mottle was at the tile's scale, not above it.** `fbm2(p * 2.6, 3)` has a 0.385 m
  fundamental with octaves at 0.19 and 0.094 m — i.e. at and *below* the 0.30 m lattice, so
  the deck read as dirty tiles rather than weathered stone.

Third attempt: `mottle = (fbm2(p * 0.6, 2) - 0.375) / 0.375`, a **1.67 m** fundamental with an
0.82 m octave and an explicit remap, applied as `alb *= 1 + 0.16 * mottle`. The aggregate,
the lattice, the per-slab spread and the albedo level are unchanged, as the review asked.

**The review also killed clause 2 as an instrument**, and the tool now says why: block-mean
sd at 200–300 px measures **1.3–1.9 in every build, including the bare-slab baseline**, because
the deck's own illumination gradient dominates block means. It falls when the mottle is made
*coarser* even though the frame reads better. `box(100)` is retained as a reported number and
is not a pass/fail clause any more; the frame is judged by the reviewer on patch scale, as it
should have been from the start.

> **Correction (second review, `VISION_F8_CLOSE_RANGE_4A2.md`).** An earlier draft of this
> section cited `box100 3.81 → 3.67` as the coarsening signature. `3.67` is the single shot
> `00-14-34`, and §38 makes a single shot evidence for nothing — the same rule this round
> cites against other people's numbers. The certified frames read **4.53 (a2) → 4.15 (a3)**.
> The direction is the same; the sentence was citing the wrong frame.

## 6. Third attempt, second review, and the fourth attempt

`VISION_F8_CLOSE_RANGE_4A2.md` confirmed the scale landed — 2.0 luma of new sd at 300–900 px
in the near field and 2.5 at y 700–820, none in the far band, which is where it should vanish
— and confirmed the remap is arithmetically correct (sampled: mean 0.369, sd 0.114, which the
remap centres). It then found the remaining error: **the remap fixes the bounds, not the
distribution.** `fbm2` is bell-shaped, so the remapped field has sd 0.303 and p5–p95 ±0.50,
never ±1; `1 + 0.16 * mottle` therefore delivers ±4.9 % at 1σ and about 2.3 luma on screen,
not the ±16 % the constant reads as.

Fourth attempt: **0.16 → 0.35**, same 0.6 cyc/m, same two octaves, same aggregate, lattice,
albedo level. Acceptance is stated in luma this time, because the retired instrument cannot
carry it: **≥ 4.5 luma of new 300–900 px field**, measured as the quadrature delta between
the certified frame and attempt 2 (`23-08-53`) as the same-build control.

**Why quadrature and not the reviewer's absolute numbers (6.3 near / 9.4 mid).** The
reviewer's instrument was built by hand in a transcript, and its near-field figure does not
reproduce under any of the definitions this round could construct (its mid-field figure does,
within 0.3 luma, at radii 70/350 with the per-row mean removed). The absolute value is
therefore partly a property of the region, not of the shader. The **delta in quadrature** is
not: `sqrt(new² − old²)` removes whatever the two builds share — the depth ramp, the lighting,
the camera — and that is what the 4.5 luma bar is applied to.


**A caveat on every cross-run near-field number in this document**, found by the same review:
eye height is re-derived per run and differs (2.213 / 2.129 / 2.160 / 2.094 / 2.139 m across
the five frames), so the "2–3 m" band is 56 rows in one frame and 86 in another, and the bottom
0.15 m of ground in the current frame is not in the baseline at all. Comparisons here are
like-for-like only within a few tenths of a luma, and the registered thresholds are read with
that in mind.

## 7. Fourth attempt certified, and the third review

Certification run `2026-10-27T01-33-02`: `PASS`, 29 shots, 502.8 s, `SYZYGY_TIMEOUT=900000`,
28 poses, **28/28 `medium`**, no errors, `starved 0`, seed 6191639. Gate on
`01g-kerb-face`, measured by the tool and re-measured by the reviewer:

| clause | target | baseline `18-34-37` | attempt 2 `23-08-53` | **a4 `01-33-02`** |
| --- | --- | --- | --- | --- |
| 1 hfSd | ≥ 3.5 | 1.51 | 3.93 | **3.90** |
| 1 joint-free share | lower | 0.256 | 0.163 | **0.159** |
| 3 joint contrast | ≥ 25 | 58.1 | 60.1 | **60.1** |
| 3 periods | 213/106 px | 213(0.89)/106(0.89) | 213(0.89)/106(0.89) | **213(0.93)/106(0.92)** |
| 4 deck/facade | 1.2–1.8 | 1.49 | 1.45 | **1.50** |
| 5 far \|dL/dx\| | ≤ 5.3 | 4.56 | 4.58 | **4.58** |
| 6 fall controls (strict) | ≤ 0.03 pp | — | worst +0.0065 | **worst +0.001** |
| 7 process | clean | — | clean | **clean** |
| band-pass near / mid | (4.5 delta) | 7.48 / 7.71 | 7.85 / 7.15 | **7.74 / 8.62** |

Quadrature delta against the a3 control: **2.26 near, 3.18 mid** — below the registered 4.5.
Two clauses are therefore short of their registered bar: the band-pass delta, and clause 2
(`box100` 4.15 → 5.36, retired as an instrument by both reviewers).

`VISION_F8_CLOSE_RANGE_4A3.md` returned **`VERDICT: done`** and closed the row. Its reasons,
recorded here because they are the reviewer's and not the implementer's: the deck reads as
mottled uneven paving with two dominant and three minor tonal patches at 1.4–2.3 m and ±5 luma
(the 1.67 m fundamental arriving where designed), joint contrast is unchanged because the
mottle is applied *before* the joint mix, no seam in the fade band, fall zone clean by code
and frame, and no homogenisation across sections. On the two short clauses it held that the
band-pass bar **cannot decide in either direction** — the control column shows the same metric
moving 0.45 luma between builds that differ by one shader term (baseline 7.48, a3 7.40 with
the mottle in it), and `PROCESS.md` §1 forbids inventing a numeric aesthetic target before the
frame it describes — and that clause 2 stays retired because the bare slab still scores ~9.9
on it. Its GAP is not amplitude: the field is edge-free by construction and has no relationship
to the joints, kerb or drainage, so it can read as uneven tone but not as accumulation. That is
a new row, not a bigger constant, and the review states explicitly that another amplitude round
is **not** justified.

Two corrections the review asked for are in this commit: the duplicated comment paragraph in
`gbuffer.wgsl` (the first copy still described the attempt-1 "0.2–1 m patchwork"), and the
"runs to the horizon because value grouping is what reads at distance" claim, which the same
review measured as false beyond ~6 m on this pose.

