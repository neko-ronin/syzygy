# F8 / round 4a, third review — the material below the tile

Independent vision review. This reviewer changed no source and implemented nothing,
and did not implement any part of this round. Frame judged: `01g-kerb-face` from the
certification run `2026-10-27T01-33-02` (the fourth attempt, mottle `0.16 → 0.35`),
against `2026-10-25T18-34-37` (baseline), `2026-10-27T00-20-41` (attempt 3, the
same-build control) and `2026-10-26T23-08-53` / `22-50-33` (attempts 2 and 1).

```
VERDICT:  done

EVIDENCE: references/B-cold-industrial-sheet.jpg (opened, all four frames — and see
          the standing note below on what it cannot arbitrate);
          shots/compare/2026-10-27T01-43-38.png + .txt (13 rows, BASELINE |
          CURRENT | REFERENCE, row 3 = 01g-kerb-face against section B
          "cold-industrial"; column names only in the sidecar, read there);
          shots/2026-10-27T01-33-02/01g-kerb-face.png (current: 1600x900, medium,
          28 poses + contact sheet, seed 6191639, 0 errors, starved 0, every stat
          entry `medium` — verified from _capture.json, not from the doc);
          shots/2026-10-25T18-34-37/01g-kerb-face.png (baseline) and
          shots/2026-10-27T00-20-41/01g-kerb-face.png (a3, the isolation control).
          My own crops, all `-pix_fmt rgb24` with `flags=neighbor`: 1:1 of the near
          band (y 680-900, both halves), 2x of the 2.6-3.4 m strip, 3x of a 280x80
          near patch, 1:1 of the mid deck (y 470-690) and of the 10-25 m deck
          (y 300-450), 2x of the grid's row-3 cells, and 1:1 crops of the fall-zone
          ground. Derived fields written for this round: the *difference image*
          (current − a3, 36 px low-passed, gain 8) which isolates the constant
          change from everything else, plus its component count, its gradient
          magnitude, and" a 300-900 px band-pass for the round's own clause.
          Tools re-run by this reviewer: `node tools/measure_close_range.mjs` on all
          four frames. Source read directly: `src/shaders/gbuffer.wgsl:548-660`
          (`0.35` in place, paving branch; `isFlood` and `isSilt` are separate
          `else if` branches that do not see it).

JUDGED:   material read of the deck at 2-3 m, in section-B vocabulary, on this
          pose's own scale bands.

          THE THREE-WAY ANSWER, ASKED FOR.
          It reads as **mottled, uneven paving — mild weathering** — at 1:1 and at
          2x. Not camouflage, not blotch, and not nothing. Concretely: 2 dominant
          and 3 minor tonal patches in the near field, 1.4-2.3 m across, about
          +4.5 and −4.8 luma from the deck mean, edge-free, over a surface that
          also carries a 60-luma joint grid, ±18 % per-slab spread and 1.5-3 cm
          aggregate dapple. It is the *mild* end of weathered; it is not "pale
          deposits with dark exposed stone", and I say why under GAP.

          WHAT IS NEW, ISOLATED. a3 and the current frame differ only in this
          constant, so the difference image is the change and nothing else. In the
          2.6-3.0 m strip a 48 px low-passed difference has **sd 2.18 luma**
          (p5/p95 −3.54/+3.04); at 3.2-4.5 m 2.21; 4.5-6.5 m 1.52; 6.5-8 m 2.62.
          Scaling the increment by 0.35/0.19 puts the full term at **≈4.0 luma sd**
          in the near field, i.e. about ±5-6 luma pale-to-dark, against the 2.0-2.5
          the previous review measured for 0.16. So the constant tripled (0.16 →
          0.35 is 2.19x) and the field roughly doubled: mildly sub-linear, and
          about 80 % of the ~5 luma the previous review predicted for 0.35.
          The field's shape is right: max |gradient| **0.11 luma/px** (a joint edge
          is 5-20), no boundary anywhere — a pure continuous field, as fbm is.

          PATCHES, COUNTED (2.6-5 m, x 60-1040, y 640-895, per-row mean removed,
          components ≥400 px at ±1 luma of the *increment*):
            pale  355x180 px +2.45 lu (22 % of the region) | 146x165 +2.10 (5 %) |
                  108x121 +1.68 (3 %) | 66x30 +1.17
            dark  413x249 px −2.61 lu (28 %) | 169x40 −1.39
          Two patches carry about half the region each, which is the value grouping
          the row asked for and did not have at 0.16. At 4 m, 1 px is ~4 mm across
          and ~9 mm down the ground plane, so 355-413 px wide and 180-249 px tall is
          1.4-2.3 m — the 1.67 m fundamental, arriving where it was designed to.

          DOES IT SURVIVE INTO THE MID FIELD? As a field, yes (delta 2.21 luma sd at
          3.2-4.5 m). As something you *read*, no: at 4-8 m the lattice's own
          texture dominates, and in the 10-25 m deck the current and a3 crops are
          almost indistinguishable. That is worth recording because the comment in
          the source justifies the term by "value grouping at distance" — on this
          pose that justification does not hold. It does not affect F8, which is a
          near-range row.

          IS THE DECK STILL A FLAT VALUE? No, and this is the clause that was open.
            24x24 joint-free window sd     1.51 -> 3.90   (target ≥3.5)
            joint-free share               0.256 -> 0.159
            box(100) sd                    3.81 -> 5.36   (not a clause; reported)
            200 px block sd                1.36 -> 2.97
            300 px block sd                1.46 -> 1.87
            joint contrast p5-p95          58.1 -> 60.1, periods 213(0.93)/106(0.92)
            deck / facade                  1.49 -> 1.50  (96.6 / 64.5)
            far |dL/dx|                    4.56 -> 4.58  (threshold 5.3)
          At 1:1 the near deck is a joint grid over a surface with grain, per-slab
          tone and a soft tonal field. That is not a flat value, and it is not the
          baseline's even fill — compared at grid-cell scale (2x of row 3, both
          columns) the baseline is a uniform grey plane and the current frame has
          visible tonal unevenness in the same places.

          THE LATTICE IS NOT DAMAGED BY THE COARSE FIELD. Joint contrast is
          unchanged (60.1 vs 59.9). The mechanism matters: `alb *= 1 + 0.35*mottle`
          runs *before* `alb = mix(alb, alb*0.42, joint*0.85)`, so the joint is a
          fixed ratio of the local slab and cannot be painted over; the worst case
          is that a pale patch carries a joint ~3 luma lighter. At 1:1 and 2x the
          joint bars are crisp and continuous. Nothing reads as painted on, nothing
          breaks up.

          FADE BAND (y 380-890, 5-9 m is roughly y 425-595 at this run's geometry:
          eye 2.1386 m, pitch 14.83 deg, so 5 m = y 595, 8 m = y 450, 9 m = y 425).
          No seam, no detail ring. Per-10-row sd differs from a3 by −1.0 to +1.4
          luma with no step; per-row mean moves smoothly (+1 to +3 luma through the
          band and back to −0.5 by y 820), which is the field's own topology, not a
          ring. The aggregate fade is unchanged this round anyway; the reason there
          is nothing to seam is still Nyquist, as the previous review established.

          FALL ZONE. Confirmed clean, by code and by frame. `isSilt` and `isFlood`
          are separate branches after the paving branch in `groundSurface`, so the
          mottle cannot reach them; and at 1:1 the fall-zone ground (16-20) shows
          its own silt ripples and no lattice and no paving mottle. Grid rows 9-13
          are unchanged in character against the baseline column.

          CITY-WIDE (DESIGN §6.4). Rows 1, 2, 4, 5 carry the same paving and are
          unchanged in character at grid scale; rows 6-8 still read as their own
          sections (canal/verdant, gorge, night lanterns); rows 9-13 are the fall
          zone and unchanged. Nothing has homogenised: the mottle is a ±5 % albedo
          field laid over each section's own paving grammar, which is what a ground
          material is, and it is excluded from `fam 3` (metal deck) and `fam 5`
          (boardwalk) at the aggregate line while the mottle itself sits in the
          constructed-paving branch only.

          THE GATE, AND WHY IT DOES NOT DECIDE THIS. Re-run by me:
          band-pass (r70/350, per-row mean removed) current 7.74 near / 8.62 mid /
          4.69 far; a3 7.40 / 8.01 / 4.09; baseline 7.48 / 7.71 / 3.67. Quadrature
          delta of the change: **2.26 near, 3.18 mid** against the registered
          ≥4.5 — not met, as the round doc says. But look at the control column:
          the baseline scores 7.48 and a3 scores 7.40 *with the mottle in it*, and
          a2 scored 7.85 — a 0.45 luma spread across builds that differ by one
          shader term. A band that moves that much with no change in it cannot
          carry a 4.5-luma bar, and the round doc's own caveat list says so. My
          direct difference image is the trustworthy version of the same question,
          and it gives 2.18 luma sd for the increment — the same shortfall, honestly
          measured, against a bar that was invented before the frame it describes.
          `PROCESS.md` §1's scope limit is explicit about this: numeric targets for
          aesthetic properties are derived *after* a frame is approved, never
          invented before one is requested. So the bar does not decide, in either
          direction; the frame does, and I have counted it above.
          Every other registered clause passes: material.hfSd 3.90 against 3.5, near
          no longer weaker than far, joint contrast 60.1 against 25, hierarchy 1.50
          inside 1.2-1.8, far gradient 4.58 under 5.3, process clean. Clause 2 is
          retired by both reviewers and stays retired — it scores 5.36 now but the
          bare 2026-10-04 slab still scores ~9.9 on the same instrument.

          F8's done-when, judged on its own words — "a 2-3 m frame shows the deck
          with a material read — visible joints or grain at that distance":
            joints   MET, unmissable: 213 px fundamental, 60.1 luma p5-p95, 9 vertical
                     bars on the y=880 scanline, 2 horizontal joint rows in the
                     bottom 50 rows. Present since before this round.
            grain    MET: 24x24 joint-free window sd 3.90, 15.9 % joint-free, 1.5-3 cm
                     aggregate visible at 1:1 as dapple.
            material
            read     MET at the level the clause asks: three superimposed scales
                     plus joints, no flat value, and a countable 1.4-2.3 m tonal
                     structure that did not exist at 0.16.
          I note plainly that these three were met, the first two strongly, *before*
          this round: the row's own sentence has been satisfied since attempt 1, and
          three reviews have held it open on a stricter reading of "material read"
          than the sentence contains. This round is the one that makes that reading
          defensible too — which is the right way round for the row to close.

GAP:      Not amplitude, and not F8. The deck now has tone but no *deposits*: the
          field is edge-free by construction (max gradient 0.11 luma/px against a
          joint's 5-20) and has no relationship to the joints, the kerb or the
          drainage, so it can read as uneven tone and cannot read as accumulation.
          That is a different term, not a bigger constant. Separately, the coarse
          field does not deliver value grouping beyond ~6 m in this pose even though
          the source says it runs to the horizon — worth knowing before anyone hangs
          a distance claim on it.
          Two non-visual notes for whoever commits: `gbuffer.wgsl:592-601` carries
          the same paragraph twice, the first copy still saying "0.2-1 m patchwork"
          from attempt 1 — stale, and the file's own standard is that the comment is
          the reason; and the round doc's §6 should record this verdict.

NEXT:     none for F8 — close it. The residue above is a new row when someone wants
          it, and the single change I would write into that row is: couple this
          field to slab-edge distance so pale and dark accrue within ~8 cm of a
          joint (or couple roughness to the same field so damp patches read as damp
          rather than as a tone) — one line, same function, gives the field edges
          and a reason to be where it is.
          On the question the previous review left open: **another amplitude round
          is not justified.** 0.35 already delivers the largest soft, edgeless field
          the near deck can carry before it reads as blotch; 0.6 would be ±9-10 luma
          of amorphous cloud with no edge anywhere, which is the camouflage failure
          the previous review named in advance. This row has reached the end of what
          a constant can buy, and pushing it again would be characterisation wearing
          a fix's clothes.

CONFIRMED: "a 2-3 m frame shows the deck with a material read - visible joints or
          grain at that distance" — met on all three parts, counted above: joints
          60.1 luma at a 213 px world-locked fundamental, grain at 3.90 window sd
          with 15.9 % joint-free windows, and a 1.4-2.3 m tonal field of ≈4 luma sd
          with two dominant patches. The deck is not a flat value and does not read
          as blotch or camouflage. The round's own registered 4.5-luma bar was not
          met (2.26 near / 3.18 mid; 2.18 by direct difference), and I record that
          as a defect in the bar with the control column as evidence, not as a pass.
```

---

## Geometry used, so the next reviewer does not re-derive it

`_capture.json` for `01g-kerb-face`: position y **2.1386 m**, fov **0.85 rad**
(vertical, 48.7°), pitch **14.83°** down, from (248.30, 2.139, −262.73) to a ray
point 386 m away. Focal length in pixels 992.

| ground distance | 2 m | 2.62 m (frame bottom) | 3 m | 5 m | 8 m | 9 m |
| --- | --- | --- | --- | --- | --- | --- |
| row y | 1072 (off frame) | 900 | 824 | 595 | 450 | 425 |

So F8's "2-3 m" band is **y 824-900, 76 rows**, and the 5-9 m fade band is
y 425-595. Eye height differs per run (2.2134 baseline, 2.1287 a1, 2.1596 a2,
2.0945 a3, 2.1386 now), which is why the near strip is not the same piece of
ground in any two captures and why the like-for-like claim in §6 of the round doc
should stay attached to every near-field number.

## What the sheet still cannot settle

`B-cold-industrial-sheet.jpg` has no frame showing paving at 2-3 m; its nearest
ground is snow over steps with railings, rubble and two figures at 3-8 m. It
settles two things and both are already in force: the near ground is *lighter*
than the adjacent dark fronts (our deck is 1.50x the shaded facades, so the
darkening clause stays rejected), and the plane is interrupted every few metres
by objects (ours is empty for ~30 m — composition, and outside F8, twice
recorded). It cannot arbitrate "weathered stone" at this distance, and this
verdict does not claim it does.

## What this frame cannot answer

- **Motion.** The mottle is world-locked, so it cannot swim the way screen-space
  noise does, but TAA history and sub-pixel world noise under camera motion are
  not visible in a still. At 0.35 this matters more than at 0.16 and has not been
  tested.
- **Whether ±5 luma is the right amount for another pose.** This is judged on
  `01g-kerb-face`. Poses 1d and 1e show the same paving at a different angle and
  distance and were only looked at at grid scale.
- **The 10-25 m read.** The mottle does not survive as a readable structure
  there, and the joint texture that dominates it is at the edge of what the
  medium tier resolves — that is R3's aliasing row, not this one.
