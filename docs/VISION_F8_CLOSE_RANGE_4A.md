# F8 / round 4a — the material below the tile — close-out

Independent vision review. Round 4a was implemented by another agent; this reviewer
changed no source. Frame judged: `01g-kerb-face` from the certification run
`2026-10-26T23-08-53`, against `2026-10-25T18-34-37` and against the gate
pre-registered in [`GROUND_CLOSE_ROUND4A.md`](GROUND_CLOSE_ROUND4A.md) §2.

```
VERDICT:  more work needed

EVIDENCE: references/B-cold-industrial-sheet.jpg (opened, four frames);
          shots/compare/2026-10-26T23-22-34.png + .txt (13 rows, row 3 =
          01g-kerb-face against section B "cold-industrial");
          shots/2026-10-26T23-08-53/01g-kerb-face.png (current, 1600x900, medium,
          29-shot --sequence, seed 6191639) and
          shots/2026-10-25T18-34-37/01g-kerb-face.png (baseline, same seed/pose);
          crops of both at 2x (y 660-900), 4x (y 700-820) and 6x (y 840-900), and
          a 2x strip of the fade band y 400-610, all from ffmpeg rgb24.
          Gate re-run by this reviewer: `node tools/measure_close_range.mjs` on
          both frames. Build check: dist/ written 22:49 UTC, capture 23:08-23:20
          UTC, and the change is visible in the pixels, so the frame is not stale.
          No GPU/WGSL error in any of the 29 shots; all `medium`; `starved 0`.

JUDGED:   material read of the deck at 2-3 m, in section-B vocabulary.
          Geometry (eye 2.160 m, pitch 14.83 deg down, fovY 48.7 deg over 900 px):
          the frame bottom is ground at 2.62 m and y = 837 is 3.00 m, so F8's
          "2-3 m" band is the bottom 63 rows, 7% of the frame; the bottom ~65%
          of the frame is deck but 3 m to the horizon.

          Counted, not described, on the current frame:
          - 2 horizontal joint rows in the bottom 50 rows (y 862-869, y 893-899),
            identical in the baseline;
          - 9 vertical joint bars across x 100-1000 at a 106 px fundamental
            (autocorrelation 213 px r=0.89 / 106 px r=0.89), p5-p95 60.1 luma;
          - joint-free 24x24 px windows (about 7 cm at 2.7 m): 16.3%, from 25.6%
            before the change - the slab interiors are no longer flat fills;
          - 1.5-3 cm aggregate: separable at 6x as a 5-10 px dapple of about
            +-3-4 luma; not separable as discrete features at 1:1;
          - mottle: soft 0.19-0.39 m blobs, visible at 1:1 as uneven staining;
          - 100x50 px (about 28x14 cm) block means in the near strip span 12.1
            luma in 4 bands, against 11.9 luma in 4 bands before the change.

          Gate, my numbers (baseline -> current):
          1 hfSd >= 3.5:            1.51 -> 3.93   PASS (2.60x)
            near vs far in strip:   3.97 bottom half vs 3.82 at y 780-850 (mean
                                    sd of joint-free windows) - no longer inverted
          2 box100Sd >= 6.5:        3.81 -> 4.53   FAIL (1.19x, not 1.7x)
            >=3 block means 4 apart: 4 bands / 11.9 -> 4 bands / 12.1 - did not
                                    move, and was already true pre-change, so it
                                    carried no information either way
          3 joint contrast >= 25:   58.1 -> 60.1   PASS, same fundamental
          4 deck/facade 1.2-1.8:    1.49 -> 1.45   PASS
          5 far |dL/dx| <= 5.3:     4.56 -> 4.58   PASS (+0.02)
          6 fall zone <= 0.03 pp:   NOT reproducible as written - see below
          7 process:                PASS (29/29 medium, no error, starved 0)

          Where my numbers differ from the round doc: clause 2 (the doc's own
          iteration log gives 4.28 on attempt 1 and cites 3.92 from a single
          shot for attempt 2; I get 4.53 on the certification frame). Both are
          under the 6.5 floor, so the disagreement does not change the clause.
          Clause 5's registered "pre-change 5.3" does not match the baseline
          frame, which measures 4.56 - the threshold was loose, not the frame.

          The fade: no seam and no detail ring. In the current frame the slab-
          interior HF delta against the baseline is -0.2 to -0.5 luma from y 380
          to 540 and +0.1 to +0.7 from y 540 to 720, crossing over gradually
          across ~60 rows (about 1.5 m of ground). There is no single-row
          discontinuity, and at 2x the band y 400-610 shows no straight
          horizon-parallel boundary. The reason is worth recording: 34 cyc/m is
          a 29 mm period, and the ground footprint at y 650 (4.5 m) is 9.9 mm/px
          - 3.0 px per period - falling to 16 mm/px at y 550 (5.9 m), which is
          1.8 px and sub-Nyquist. The aggregate is unresolvable beyond about
          5 m, which is exactly where the 5 m fade starts, so there is nothing
          at the fade boundary to seam. Clause 5 passes, but not because the
          fade is doing the work; Nyquist is. The fade could be removed and this
          frame would not change.

          Against sheet B: the deck no longer reads as a print, and it does not
          read as speckle - the mottle is soft, low-contrast and world-locked,
          with nothing dotty or aliased about it. What it reads as is smooth,
          stained paving: no chips, no exposed aggregate at 1:1, no dark worn
          strips, no pale accumulation that groups. The sheet's near ground is
          lighter than its dark fronts, which our deck is (1.45x), so rejecting
          the review's darkening clause was correct and I confirm it - the
          sheet's 0.66-0.69x *frame* mean is a fog-and-lights composition
          artifact, not a deck-level instruction, while STREET_SPEC B's actual
          claim is relative to the adjacent fronts. The sheet cannot arbitrate
          the joints or the grain: no frame in it shows a paved deck close
          enough, and its nearest ground is snow over steps with railings and
          two figures. What it can settle, and does, is that every sheet-B near
          ground is broken by objects every few metres - 0 objects interrupt
          this deck for about 30 m.

GAP:      The second scale is at the tile's own scale. `mottle` is
          `fbm2(p * 2.6, 3)`, whose fundamental is 1/2.6 = 0.385 m with octaves
          at 0.19 and 0.094 m - so 0.09-0.39 m, at and below the 0.30 m lattice
          pitch, not the "0.2-1 m patchwork" the round doc claims. It has no
          component larger than one tile.
          The declared amplitudes are also not what the surface receives:
          `fbm2` sums three octaves at 0.5/0.25/0.125 of `vnoise2`, so it
          returns [0, 0.875] with a mean of 0.4375 and 1 sigma of about +-0.12.
          `0.80 + 0.40 * mottle` therefore lands in 0.80-1.15 with a mean of
          0.975 and a working swing of about +-5% (1 sigma) / +-9% (2 sigma),
          not +-20%. The aggregate is worse off in the same way: about +-6% at
          1 sigma, not +-21%.
          That is why the frame reads as it does: dirt *within* tiles, not
          weathering *across* the field, and why every 100 px grouping number in
          the near strip is unchanged. The round did real work - the near field
          is no longer the flattest part of the frame and the slab interiors are
          no longer flat fills - but the defect the row names is "one value at
          one spatial scale", and the deck still has one spatial scale.

          Clause 2 is not what decides this verdict; the frame is. But here the
          proxy and the eye agree, which is unusual and worth saying: at 1:1 the
          deck is still an even field with fine dapple, and the 100 px block
          means have not moved by more than 0.2 luma. I checked both and they
          point the same way. Clause 6 is a different matter - under the
          thermometer FALL_POOL_ROUND3Q §5.4 defines (yard band x 250-1300,
          y 560-780, share of R > B) I get pose 17 -0.114 pp, pose 18 +0.108 pp,
          pose 19 -0.545 pp, against the registered 0.03 pp. Pose 17 also drops
          7.87 luma and its LOD histogram differs between the runs
          ([9,28,130,0] -> [7,35,125,0]), which is streaming dither, not the
          shader. The 0.03 pp threshold is already on record as finer than the
          same-build drift, so clause 6 cannot decide anything here and should
          not be read as either a pass or a leak.

NEXT:     One change: give the mottle a 1-3 m fundamental - about 0.6 cyc/m
          with 2 octaves - and normalise it (or remap it explicitly) so the
          declared amplitude is the amplitude delivered, so that the deck groups
          at 100-300 px instead of only at tile scale. Leave the aggregate, the
          fittings, the lattice and the deck's albedo level alone; the 1.45x
          hierarchy is right and the darkening clause stays rejected.
          The deeper difference against the sheet - a plane with nothing on it
          for 30 m - is composition, not material, and is outside F8. If it is
          wanted, it belongs in its own row rather than in this one.

CONFIRMED: "a 2-3 m frame shows the deck with a material read - visible joints
          or grain at that distance" - joints: met, counted above, unchanged and
          unmissable. Grain: partly - 1.5-3 cm aggregate is present and
          separable at 6x, but not at 1:1. Material read: the near field is no
          longer the flattest part of the frame (1.51 -> 3.93) and the slab
          interiors are no longer flat fills (joint-free share 0.256 -> 0.163),
          so the row's "no joints, no grain" symptom is gone; "one value at one
          spatial scale" is not.
          "Not when a histogram moves" - the histogram moved and the deck still
          reads as one scale, which is why this is not `done`.
```

---

## What this frame cannot answer

- **Motion.** The aggregate and the mottle are functions of world position, so
  they cannot swim in the way screen-space noise does, but TAA history, sub-pixel
  world noise under camera motion, and shimmer in the 1.5-3 cm band cannot be
  judged from a still. That needs a short capture, not a frame.
- **Whether a 1-3 m mottle is the right answer.** It is the cheapest way to move
  the grouping number, and grouping is a proxy. The sheet gets its near-field
  value structure from snow, steps, rubble and objects. A 1-3 m albedo patchwork
  will read as damp patches and different pours of concrete, which is defensible
  for a deck but is an inference, and the frame after it is what settles it.
- **The fall-zone controls.** Clause 6 as registered is finer than the
  same-build drift (already on record in `FALL_POOL_ROUND3Q.md` §6 and
  `HANDOFF.md`), and pose 17's LOD histogram differs between the two runs, so no
  reading of it should be treated as a leak or as a pass.

## City-wide check (DESIGN §6.4)

Row 3 of the grid is this pose; rows 1, 2, 4, 5 (street crowd, crowd closeup,
canyon, tram) gain the same mottle on their paving and read as uneven paving,
not as noise. Rows 9-13 (fall zone) are unchanged in character and their
silhouette problem is F-series work, not this. Rows 6-8 still read as their own
sections. Nothing here has homogenised the city, and the mottle is not a
section-B-only effect leaking into other sections' grammar - it is a ground
material that applies to paving everywhere, which is consistent with how the
shader is structured (`fam 3` and `fam 5` are excluded from the aggregate).

## Sheet-B checklist for this pose, so the next reviewer starts here

| Frame quantity | Current | Baseline | Sheet B |
| --- | --- | --- | --- |
| joint contrast, p5-p95 | 60.1 | 58.1 | no paved deck close enough to measure |
| joint-free 7 cm windows | 16.3% | 25.6% | n/a |
| near-strip 100 px block range | 12.1 luma / 4 bands | 11.9 / 4 bands | 3-4 patches, largest 31-42% of the near field |
| deck vs shaded facades | 1.45x | 1.49x | lighter than the adjacent fronts (STREET_SPEC B) |
| objects interrupting the plane | 0 for ~30 m | 0 | one every few metres |
