# F8 — The bare deck at close range — close-out

Independent vision review. Reviewer did not implement anything in this row.
Frame judged: the **current build at `38325d8`**, not the 2026-10-04 frame the row
was written from.

```
VERDICT:  more work needed

EVIDENCE: references/B-cold-industrial-sheet.jpg (opened, all four frames);
          shots/2026-10-25T18-34-37/01g-kerb-face.png (1600x900, medium,
          28-pose --sequence, seed 6191639, _capture.json valid);
          shots/compare/2026-10-26T22-21-18.png + .txt (row 3 = 01g-kerb-face
          against section B, "cold-industrial"; rows 4, 5, 9-13 also B);
          before frame shots/2026-10-04T00-09-34-01g-kerb-face.png.
          Build check: dist/ built 2026-10-25 12:49, capture 18:43, last src
          commit 2026-10-22 20:58 - the frame is not a stale build.

JUDGED:   material read of the deck at 2-3 m, in section-B vocabulary.
          Geometry: camera y = 2.213 m, pitch 14.83 deg down, fovY 48.70 deg
          (fov is fovY - src/core/math.ts:107), so the frame bottom is ground at
          2.71 m and y = 850 is 2.99 m. F8's "2-3 m" band is the bottom ~50 rows
          only; everything above y = 850 is further than 3 m.
          There the joints are unmissable: 106 px period, 15 px joint width,
          p5 64.8 / p95 99.7 = 34.9 luma contrast. So "visible joints at that
          distance" is MET, and that is the only clause that is.
          "Material read" is NOT met. Inside the slabs the surface is a flat
          fill: 24x24 px joint-free windows at 2.7 m (about 7 cm across) have a
          median peak-to-peak of 6/255 (2.3%) and median sd 1.28. The
          high-frequency residue over the 69% of near-strip pixels that are not
          joints is sd 2.12, and it FALLS toward the camera - 1.5-1.9 in the
          bottom half vs 2.33-2.99 in the top half, robust across three
          thresholds (MAD 0.20-0.25 near vs 0.33-0.54 far). Approaching this
          deck reveals less, not more. It is matte (brightest near-strip pixel
          111.7, no specular), which is one thing it gets right.

GAP:      The deck is one value at one spatial scale: a 0.30 m lattice drawn on
          a flat fill, uniform from 2.7 m to the horizon, with no second scale
          and no value grouping. Measured against the sheet's near ground it is
          the print, not the stone: box(100) sd 6.08 vs the sheet's 14.1-25.4;
          7 value patches >=50x50 px with the largest covering 11% of the near
          field, vs 3-4 patches with the largest covering 31-42% in every sheet
          frame. And the value hierarchy is inverted: this deck is 1.33x the
          frame mean (96.9 vs 72.9) and 1.5x the shaded facades (64.5), while
          the sheet's near ground is 0.66-0.69x its frame mean, with fog and lit
          signage as the bright things.

NEXT:     One change: give the deck material below the tile. Per-slab value
          spread and grain at the sub-tile scale, with the deck's albedo one
          step down so it sits below the facades rather than 1.5x above them.
          Not a lighting or time-of-day change - the fill is what is flat.

CONFIRMED: "a 2-3 m frame shows the deck with ... visible joints ... at that
          distance" - met, measured above.
          "a material read" - not met; "rather than a flat value" - not met;
          "the reviewer judges the street gate on it" - the street gate is not
          passed, because the near field still reads as a lattice.
```

---

## What changed since 2026-10-04, and whether the premise still holds

The premise **has half expired.** The 2026-10-04 frame is the one the row
describes, and it measures as described: in the same near strip, 1477 of 1920
24x24 px windows are joint-free (77%) with median sd **0.42**, and the only
structure in the whole plane is a single kerb line. That is a featureless slab.

The current frame has a joint grid over the whole deck and a different scene
entirely (brick facades where 2026-10-04 had teal glass). What changed inside
the slabs is **+0.86 luma of sd** (0.42 to 1.28) and a 0.30 m lattice. So the
row's *symptom* ("no joints") is gone and its *condition* ("a material read")
is not: the surface went from an empty plane to a ruled plane. F8 should not be
rewritten as closed on the change of symptom.

## Against the sheet, as counts

| Count | Current frame | Sheet, frames 3 and 4 (near ground) |
| --- | --- | --- |
| Lattice pitch, world space | 0.304 m @ 2.85 m, 0.316 @ 3.92, 0.310 @ 4.96, 0.296 @ 7.00, 0.249 @ 10.30 — one module within 4% over 2.5x depth | no lattice; snow banks, step nosings, rubble, railing posts |
| Distinct value patches >= 50x50 px (dev >= 4 luma, 61 px smoothing) | 7, largest 11% of the near field | 3-4, largest 31 / 34 / 34 / 42% |
| Smoothed sd at 100 px | 6.08 | 14.1 / 17.0 / 19.5 / 25.4 |
| Near ground vs frame mean | 1.33x (brightest large surface at street level) | 0.66x / 0.69x |
| Interruption of the plane | 90% of 24x24 windows contain a joint; nothing larger than the tile is uninterrupted | plane broken by objects, banks and silhouettes at every scale |
| Hue | near deck B-R +11 (neutral), facades B-R -3 (warm brick) | blue-dominant throughout, warmth only emissive |

So: **printed/repeating lattice**, on the counts above — uniform 0.30 m pitch,
uniform joint, no variation above 11% of the field, brighter than the
architecture. It is not a printed *screen* pattern (pitch survives the
perspective test, so it is world-locked), which is the one thing that keeps this
from being a texture-space bug report.

## What this frame cannot answer

- **The sheet cannot arbitrate "joints at 2-3 m".** No frame in
  `B-cold-industrial-sheet.jpg` shows a paved deck close enough to read a
  joint. The nearest ground is frames 3 and 4 at roughly 3-8 m: snow over
  steps and rubble, with railings and two figures for scale. The sheet's bar
  for a deck at that distance has to be inferred from its near-ground **value
  grouping**, which is what the table above measures. Anyone quoting the sheet
  as a joint reference is quoting something that is not in it.
- **Whether the grain term is absent or thresholded out.** The measurements
  show fine detail disappearing up close, which matches answer (1) of F8's own
  four ("thresholded out at close range"), but a single frame cannot separate
  that from answer (2) ("no coordinate variation at that scale"). That is a
  hypothesis for whoever implements the next change, not a finding of this
  review.

## City-wide check (DESIGN §6.4)

The grid's wide and skyline rows (9-13) still read as different places, so
nothing here has homogenised the city. Row 11 (`18-fall-skyline`) is a pale
untextured silhouette — that is fall-zone/F-series work and is not judged here.

## Proof I would accept for closing F8

On `01g-kerb-face` re-captured, near strip y 760-900, x 60-1000, from raw
`ffmpeg -pix_fmt rgb24`:

1. **Grain arrives and does not retreat:** high-frequency residue sd >= 3.5 in
   the bottom half of the strip (now 1.5-1.9), and no lower near than far.
2. **Value groups:** >= 3 joint-free regions each covering >= 20% of the strip
   and >= 4 luma apart (now 7 regions, largest 11%; sheet 31-42%).
3. **Hierarchy:** deck mean <= 0.85x the frame mean (now 1.33x; sheet
   0.66-0.69x).

Clause 1 is the row's own condition. Clauses 2 and 3 are the same defect seen
at 100 px instead of 7 cm, and a deck that satisfies 1 while still measuring 11%
patches at 1.33x the frame mean has moved a histogram, which the row explicitly
does not accept.
