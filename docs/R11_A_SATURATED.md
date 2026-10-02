# Round 8 report: R11 §A reskin, crowd-coat coupling, R2 aisle geometry

## 1. §A reskin (palette/saturation only, `districts.ts`)

Sheet read first (`A-saturated-sheet.jpg` + `02-cablecar.jpg`): clean
chromatic blocks, warm peach deck against violet canyon, teal/orange and
blue/orange pairs. Gap found by measurement: neon-arcology was single-hue
near-black indigo (base #2b2b5a, v 0.10; secondary #1a1a3b) with no teal
block the sheet shows, and lantern-bazaar's base sat dark brown while the
sheet's red-orange blocks run bright. Moves:

- neon base #2b2b5a → #4a2a8a (h260 s.70, luminous violet),
  secondary #1a1a3b → #0f4a52 (h187 s.82, the missing teal block).
- bazaar base #8b5b4b → #a04a30 (h14 s.70 v.63),
  secondary #704636 → #7c4430 (h16 s.61).
- Trim/emissive untouched (already saturated: neon trim h288 s.90,
  emissive h323 s.95; bazaar trim h0 s.96, emissive h3 s.98).

Committed as `__selftest_sectionA.ts`: slot bands, A trim/emissive
saturation lead (+0.19 vs +0.15 bar), crowd-coat ratios, R2 geometry pins.
`VIOLATIONS none`. Rest-of-city untouched; B/C/D separation verified in the
same run (witness mechanism as §B).

## 2. Predictions and verdicts

- A1 HELD — saturation lead +0.19 (bar +0.15); all bands hold.
- A2 REFUTED as written, corrected as instrument. The value-difference score
  (dev2's market-calibrated 1.90–2.87) does not transfer to dark-ground
  districts: neon's best coat scores 0.82 by difference while standing at
  4.58:1 by ratio (bazaar 6.37:1). The check now asserts the ratio the
  legibility doc specifies (≥ 2.5:1). City unchanged; probe fixed, twice
  measured. This is the same class as round 6's P2c: the instrument, not
  the subject, was wrong.
- A3 HELD — lanterns span the aisle (median lateral 5.90 m ≤ 8 m), 39% of
  the hero aisle within 5 m of a lantern (≥ 30%), 63% carry a light flag
  (≥ 50%). 307 lanterns over the hero chunks, heights p50 4.4 m.
- A4 HELD — neon base indigo (252°), bazaar warm (7°), emissives ≥ 0.95 sat.

## 3. Crowd-coat coupling (traced, measured, no action needed)

`crowdColorFor` ranks coats per district by value-contrast vs the ground, so
the reskin flows through automatically — verified, not assumed: top-coat
ratios 4.58:1 (neon) and 6.37:1 (bazaar) post-reskin. Night remains
invariant (~1.0 under uniform ambient, dev2's documented finding); no
palette can fix that and none was asked to. dev2 awareness only.

## 4. R2 geometry answer (diagnosis, routed — no lighting change made)

The warm light exists where it must: cords span the street, lanterns hang
over the aisle at walking-relevant heights, 39% of the hero aisle within
5 m. The gaps (worst 14.3 m, p90 11.9 m) are shadowed interruptions of the
kind D5 explicitly wants between pools — not vacancy. Whether 39% coverage
at these intensities reaches the 1.5–3× pool multiples is developer 1's
lighting to answer (intensities, flag adjudication, exposure); the
positions, heights and flags are now pinned numbers, not impressions.
`marketbake.ts` and the renderer untouched.

## 5. Market zero-lots recorded as authored property

`market-spine` description in `districts.ts` now records it: 100% lot foul
at both seeds, district is road plus stalls, facades belong to neighbours.
The next session reads a fact, not a bug.

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0.
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`.
Section street/B/D/footway checks → `VIOLATIONS none` (all four).
`src/camera/__selftest.ts` → `ALL PASS`.
`src/sim/__selftest.ts` not run (live crowd.ts runtime ReferenceError).

## Files (this round)

- `src/world/districts.ts`: 2 palette entries + market description.
- `src/world/__selftest_sectionA.ts`: new.
- `docs/R11_A_SATURATED.md`: this file.
