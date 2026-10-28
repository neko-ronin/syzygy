# F8 / round 4a, second review — the material below the tile

Independent vision review. This reviewer changed no source and implemented nothing.
Round 4a's third attempt (the one written up in `GROUND_CLOSE_ROUND4A.md` §5) was
implemented after the previous review; the job here is to say whether that change
did what it claimed and whether `HANDOFF.md` F8 is closer to closed.

Frame judged: `01g-kerb-face` from the certification run `2026-10-27T00-20-41`,
against `2026-10-25T18-34-37`, and against the two earlier attempts
`22-50-33` (a1) and `23-08-53` (a2), which is what makes the new term separable
from what was already in the frame.

```
VERDICT:  more work needed

EVIDENCE: references/B-cold-industrial-sheet.jpg (opened, four frames);
          shots/compare/2026-10-27T00-31-23.png + .txt (13 rows, row 3 =
          01g-kerb-face against section B "cold-industrial", columns named only
          in the sidecar);
          shots/2026-10-27T00-20-41/01g-kerb-face.png (current, 1600x900, medium,
          29-shot --sequence, seed 6191639, PASS, no errors, starved 0) and
          shots/2026-10-25T18-34-37/01g-kerb-face.png (baseline);
          shots/2026-10-26T23-08-53 and 22-50-33 (attempts 2 and 1) as controls.
          My own crops, all from ffmpeg rgb24: 3x of the near strip y 837-900,
          1:1 of a 420x210 near patch, 2x of the fade band y 385-555, 2x/1.5x of
          the mid field, and three derived fields written for this review —
          a residual against a 600 px box blur, a 300-900 px band-pass
          (blur 70 minus blur 350), and a degree-2-detrended value field.
          Gate re-run by this reviewer: node tools/measure_close_range.mjs on all
          four frames. Source read directly: src/shaders/gbuffer.wgsl:582-619,
          src/shaders/common.wgsl:60-99. Arithmetic re-implemented and sampled
          (1 M points) rather than inferred.

JUDGED:   material read of the deck at 2-3 m, in section-B vocabulary, on the
          frame's own scale bands.

          THE CHANGE IS IN THE SOURCE, EXACTLY AS CLAIMED.
            let mottle = (fbm2(p * 0.6 + vec2f(7.1, 2.3), 2) - 0.375) * (1.0 / 0.375);
            alb *= 1.0 + 0.16 * mottle;
          `p` is `world.xz` (gbuffer.wgsl:452) in metres, so 0.6 cyc/m is a
          1.67 m fundamental with an 0.82 m octave; the aggregate, the lattice,
          the per-slab spread (0.82 + 0.36h) and the albedo level are untouched.
          The remap is also correct: fbm2 sums 0.5 and 0.25 of vnoise2, so two
          octaves return [0, 0.75] with mean 0.375 (sampled: mean 0.369,
          sd 0.114), and (x - 0.375)/0.375 maps that to mean 0 and range +-1.
          So the previous review's finding is fixed as stated.

          THE AMPLITUDE IS STILL NOT THE AMPLITUDE THE IMAGE RECEIVES.
          The remap maps the field's *bounds* to +-1, but fbm2 is bell-shaped:
          sampled over world space (2 cm grid, 20 m square) the remapped field
          has sd 0.303, p5-p95 -0.50/+0.50, and observed extremes -0.82/+0.82.
          It never reaches +-1. So `1 + 0.16 * mottle` delivers, on the deck:
            1 sigma   +-4.9 % albedo
            p5-p95    +-8.0 % albedo
            extremes  +-13.1 % albedo
          not the +-16 % the constant reads as. And at this display level the
          transfer is roughly 0.5 luma per 1 % albedo, which is measurable inside
          this project: the aggregate (6.5 % albedo at 1 sigma, unchanged this
          round) moved 24x24 window sd from 1.51 to 3.93 between the baseline and
          a2, i.e. +3.63 luma, i.e. 0.56 luma per %. Applied to the mottle's
          4.9 % at 1 sigma that predicts 2.7 luma, and the frame measures
          2.0-2.5: the same number within cross-run noise, so the arithmetic is
          not in doubt here and the amplitude is simply too small.
          A field whose typical excursion is +-4 luma on a 96-luma deck with a
          28-luma depth ramp across the same ground is not a value group.

          MEASURED, ON THE FRAME, WITH THE CHANGE ISOLATED FROM THE OLD ONE.
          Because a2 and a3 differ only in this term (the aggregate, joint,
          lattice and albedo level are identical, and a2's mottle has no
          component above 0.39 m), the a2 -> a3 difference is the change:
            300-900 px band-pass sd, near field (y 820-900):
                                         base 4.35  a1 4.56  a2 4.46  a3 4.91
            300-900 px band-pass sd, y 700-820:
                                         base 7.87  a1 7.84  a2 7.71  a3 8.12
            300-900 px band-pass sd, far y 380-500:
                                         base 4.03  a1 3.98  a2 3.96  a3 3.91
          In quadrature the new term contributes 2.0 luma of sd in the near
          field and 2.5 at y 700-820, and nothing in the far band — which is the
          right place for it to vanish, because 1.67 m at 9 m projects to 185 px,
          under the band measured. So the scale landed. The amplitude is the
          shortfall: 2-2.5 luma, against the 6.5 % -> 3.6 luma the aggregate
          achieves at a scale where the eye can see it.

          PATCH COUNT, the round's own question ("countable at 300-600 px"),
          in the near strip (2.57-3.00 m at this run's eye height, ~550 px per
          1.67 m), components at +-4 luma in the 300-900 px band with the
          per-row mean removed:
            baseline 5: 380x120 px/-7.5 lu, 200x120/+14.6, 80x60/+5.7,
                        120x40/-5.8, 40x40/+4.7; band sd 7.88
            current  4: 420x120 px/-8.2 lu, 220x120/+13.6, 180x60/+5.3,
                        100x20/-5.4; band sd 8.09
          The count did not change, and the count is not the useful part: the
          two largest components are 120 rows tall and span most of the width,
          i.e. they are the brightness ramp with distance, present identically in
          both frames. The genuine local patches in the current frame are
          180x60 px (+5.3) and 100x20 (-5.4) — about 0.5-1 m across and 5 luma.
          Note what that does to the borrowed bar: a single pre-existing
          brightness band covers 32-42 % of the near field, so the sheet's
          "largest patch 31-42 %" criterion is satisfied *before* this round by a
          gradient. It cannot be imported onto this pose either.
          At 14x amplification the current value field is visually
          indistinguishable from the baseline's: the blobs that are visible in it
          (the pale region left of centre, the dark band across the middle) are
          present in both frames, so they predate this round.

          IS IT MATERIAL, BLOTCH, OR NOTHING? Nothing, so far. It is too faint to
          be blotch and too smooth to be stone: it is a 1.67 m, +-4 luma,
          edge-free modulation laid over a surface whose own lighting varies by
          +-14 luma over the same few metres, which the eye reads as uneven
          light, not as weathering. The near field at 1:1 (420x210 crop) now
          reads as fine sandy dapple — that is the aggregate, and it is this
          round's real (inherited) achievement — inside an otherwise uniform
          field of slabs. It does not read as chips, exposed aggregate, dark worn
          strips, damp patches or pale accumulation.

          FADE BAND (5-9 m, y ~415-547), checked again as asked: no seam and no
          detail ring. Per-20-row sd differs from the baseline by at most
          0.2 luma at every row from y 380 to 900, and a 2x strip of y 385-555
          shows no horizon-parallel boundary. The coarse field does not "die
          abruptly" for the better reason that it has no fade at all — it runs to
          the horizon by design — but it is equally invisible at every distance,
          so its survival is not a gain.

          GATE, my numbers (baseline 18-34-37 -> current 00-20-41):
            1 hfSd >= 3.5                 1.51 -> 3.92   PASS
              near not weaker than far    3.97 bottom (840-900) / 3.97 (780-840)
                                          / 3.80 (690-760) - no longer inverted
                                          (baseline 1.59 / 1.99 / 2.76)
              joint-free 24x24 share      0.256 -> 0.159
            2 box100Sd >= 6.5 (retired)   3.81 -> 4.15   FAIL as written
              >=3 block means 4 apart     4 bands/11.9 -> 3 bands/11.1 (met in
                                          both frames before the change, carries
                                          no information)
              scale block sd              50 px 12.04->12.33, 100 px 6.98->7.44,
                                          200 px 1.36->2.04, 300 px 1.46->1.41
            3 joint contrast >= 25        58.1 -> 59.9   PASS
              periods                     213 px (r 0.94)/106 px (r 0.93) ->
                                          213 px (0.95)/106 px (0.92): same
                                          module, so no lattice change
            4 deck/facade 1.2-1.8x        1.49 -> 1.49   PASS (96.0 / 64.5)
            5 far |dL/dx| <= 5.3          4.56 -> 4.60   PASS (+0.04; the
                                          registered "pre-change 5.3" is the
                                          loose number, as the previous review
                                          said)
            6 fall zone <= 0.03 pp        pose 16 +0.000, 17 +0.016, 18 -0.037,
                                          19 -0.040, 20 +0.063 pp; yard-band mean
                                          RGB within 0.6 luma. Three poses
                                          outside a threshold already on record
                                          as finer than same-build drift. Not a
                                          pass and not a leak: code and frame
                                          agree the silt class is untouched and
                                          the mottle applies to ordinary paving,
                                          which is what a paving change does.
            7 process                     PASS - 29 shots, every stat entry
                                          `medium`, no error, starved 0, seed
                                          6191639.

          On clause 2 I AGREE with the retirement, on my own numbers and not on
          the doc's. Block-mean sd at 100-300 px is dominated by the deck's
          depth/illumination ramp in this pose: the bare, pre-mottle frame
          `shots/2026-10-04T00-09-34-01g-kerb-face.png` scores 9.86 on box100,
          higher than every textured build; my 150 px block sd is
          1.6-1.9 and my 300 px block sd 0.9-1.4 in all four frames including the
          baseline; and the uncorrected 300-900 px patch count returns a
          "patch" covering 47 % of the field that is simply the bright half of
          the region. The instrument cannot carry a verdict in either direction.
          But retiring it left the round with no pre-registered number for the
          defect the round exists to fix, which is why this verdict rests on a
          band-pass decomposition the reviewer had to build. That is a process
          gap, not the implementer's.

          F8's done-when, counted on this frame:
            "visible joints at that distance" - MET. 9 vertical joint bars across
            x 40-1000 on the y=880 scanline, widths 11-14 px, 106 px period;
            2 horizontal joint rows in the bottom 50 rows (y 826-828, y 833-834);
            p5-p95 59.9 luma. Identical in the baseline.
            "or grain" - MET, and better than the bar. Joint-free 24x24 px
            (~7 cm at 2.7 m) window sd 3.97 in the bottom band, 3.80 at y 690-760,
            15.6 % of windows joint-free (was 25.6 %); at 1:1 the near crop shows
            a fine dapple where the baseline was a flat fill.
            "a material read ... rather than a flat value" - NOT MET at the scale
            this round was asked to add: 2.0-2.5 luma of new field, no countable
            patch, value field unchanged against baseline.

          Build check, because the URL invites the wrong conclusion: _capture.json
          says `http://localhost:4173`, which is the vite `preview` port, but
          tools/capture.mjs:568 hardcodes `const useDev = true` and the spawn is
          `vite dev`; `assertPortFree` would have refused a foreign server.
          dist/ is in fact stale (it still contains `fbm2(p * 2.6`) and is not
          what was served. So the frame is not a stale build.
          Two process observations that belong on the record:
          - eye height differs per run: 2.2134 (baseline), 2.1287 (a1), 2.1596
            (a2), 2.0945 (current). At this pitch that is not a cosmetic shift:
            the 3.0 m line sits at y 844 in the baseline and y 814 in the current,
            so the "2-3 m" band is 56 rows in one frame and 86 in the other, and
            the bottom 0.15 m of ground in the current frame is not in the
            baseline at all. Cross-run near-field numbers are therefore not
            like-for-like, and the noise floor includes that.
          - GROUND_CLOSE_ROUND4A.md §5's "box100 ... 3.81 -> 3.67 on the third
            attempt" does not reproduce on the certified frame: I get 3.81 ->
            4.15, i.e. up. 3.67 is the single shot `00-14-34`, which §38 of the
            project's own rules says is evidence for nothing. The a2 -> a3 fall
            (4.53 -> 4.15) is real and is the coarsening signature; the sentence
            cites the wrong frame.

GAP:      The scale is now right and the contrast is still wrong. The deck's
          second spatial scale exists in the shader at 1.67 m and reaches the
          frame at 2.0-2.5 luma of sd - about a third of what the eye needs at
          that scale, and below the 4-luma patch threshold the previous review
          set. The remap fixed the previous round's arithmetic error (the
          declared amplitude is now the field's amplitude), but the constant was
          then chosen as if the field were uniformly distributed over its bounds;
          it is not, so 0.16 delivers +-8 % at p5-p95 and ~2.3 luma on screen.
          The deck is no longer a flat fill - joints, per-slab spread, 1.5-3 cm
          aggregate and now a world-locked 1.67 m field are all present - but at
          1:1 it still reads as a ruled print with a sand finish, not as stone
          that has weathered.

NEXT:     One change, inside F8, in the same function and on the same term: set
          the mottle's amplitude from the delivered luma rather than the albedo
          constant - 0.16 -> 0.35 at the same 0.6 cyc/m and the same two octaves,
          which the measurements above put at ~5 luma at 1 sigma and ~16 luma
          patch-to-patch instead of ~2.3 and ~8. Leave the scale, the aggregate
          (34/63 cyc/m, 0.42, fade 5-9 m), the lattice and the deck's albedo
          level alone; the 1.49x hierarchy is right and the darkening clause
          stays rejected.
          State the acceptance in luma this time, and measure it gradient-free,
          because clause 2's retired instrument cannot. The 300-900 px band-pass
          sd, against attempt 2's frame as the same-build control (a2: 4.46
          near / 7.71 at y 700-820), should then read >= 6.3 / >= 9.4 if this
          round's measured 2.05 / 2.50 luma scales with the constant; that is
          4.5 luma of new field, enough to be a visible second scale rather than
          a fourth of the band's own variation. If it lands far short of that,
          the transfer is not linear and the constant is again not the amplitude
          — measure before choosing the next number.
          The thing the next reviewer must check, and the reason this is a
          judgement and not a knob: at 2.2x, the field may stop reading as damp
          patches and start reading as camouflage. If it does, the answer is not
          to lower the amplitude again — it is an edge or a roughness term on the
          same field, which is a different row's worth of work.

CONFIRMED: "a 2-3 m frame shows the deck with ... visible joints ... at that
          distance" - met, counted above, unchanged by this round.
          "or grain at that distance" - met: 3.97 window sd in the bottom band,
          15.6 % joint-free, dapple visible at 1:1 where the baseline was flat.
          The previous review's NEXT did land as an implementation: the mottle is
          at 0.6 cyc/m with an explicit remap, and it is measurable as new energy
          at 300-900 px in the near and mid field and absent in the far band.
          "rather than a flat value" - not met: +-4 luma typical, no countable
          patch, value field unchanged against baseline.
```

---

## What the sheet can and cannot settle, restated so it stops being re-litigated

`B-cold-industrial-sheet.jpg` still cannot arbitrate "joints or grain on a paved
deck at 2-3 m": no frame in it shows paving that close. Its nearest ground
(frames 3 and 4) is snow over steps with railings, rubble and two figures at
roughly 3-8 m, so its grouping (31-42 % largest patch) is made of objects, snow
and fog, not of an albedo field on stone. Any instruction to hit that number with
a shader term is an inference, and it should be written down as one.

What the sheet does settle, and both previous reviews and this one agree on:
- the near ground is *lighter* than the adjacent dark fronts, so the deck at
  1.49x the shaded facades is the right direction and the darkening clause stays
  rejected (`STREET_SPEC.md` §B);
- the plane is interrupted every few metres by an object; ours has none for
  about 30 m. That is composition, it is outside F8, and it is the reason the
  deck reads as a plaza rather than a street whatever the shader does.

## What this frame cannot answer

- **Motion.** The mottle and the aggregate are functions of world position, so
  they cannot swim the way screen-space noise does, but TAA history and sub-pixel
  world noise under camera motion cannot be judged from a still. At 2.2x
  amplitude this becomes more, not less, important.
- **Whether 2.2x is the right number.** It is the number that reaches the
  measured threshold; whether 16 luma patch-to-patch reads as damp stone or as
  camouflage is a judgement on the next frame and is the reason the NEXT names it
  as the thing to check.
- **Cross-run near-field drift.** Eye height moves 0.12 m between runs, so the
  near strip is not the same piece of ground in any two captures in this
  comparison. The a2 -> a3 difference is still valid (same pose, one term) but
  the absolute near-field numbers carry that uncertainty.

## City-wide check (DESIGN §6.4)

Row 3 of the grid is this pose. Rows 1, 2, 4 and 5 (street crowd, crowd closeup,
canyon, tram) carry the same paving and are unchanged in character at grid scale;
rows 6-8 still read as their own sections; rows 9-13 (fall zone) are unchanged
and their silhouette problem is F-series work. Nothing has homogenised the city,
and a +-5 % albedo field cannot: it is below the grid's own noise. The change is
in the right place (all constructed paving) rather than being a section-B special
case leaking elsewhere.
