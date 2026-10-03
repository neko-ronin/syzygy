# Round 9 follow-through: the 01g frame tested the pose, the pose failed, fixed

## 1. What the capture proved (dev1's frame + diagnosis, read, not re-shot)

`01g-kerb-face` landed, camera held 0.09 m, and the frame shows a 3.61x
gold band with no raised kerb — block-and-joint patterning on the band,
no vertical face, no step, no shadow. Two of dev1's flags survive contact
with my files; one does not:

- Population drift (1037,4)→(33,0) is irrelevant to this pose by
  construction: the kerb derivation never reads the centroid except to
  gate on non-empty and report distance. Stated in the code before the
  capture, confirmed after.
- "Market plaza, not copper" is not a mismatch: the pose constrains to B
  districts and street/artery kind, never to copper. Stalls nearby come
  from an adjacent market road. (Copper was the reviewer's screenshot, a
  different frame.)
- **The missing face IS my bug class.** Recomputed headlessly at the
  capture seed: the old derivation's edge has **zero kerb-face verts
  within 10 m** (122 within 20 m), and a trace-walk simulation holding
  **45 of 160 m (28%)**. My ±10 m two-point straightness check passed on a
  curving arterial whose trace dies after a few 5 m steps — I mirrored two
  of `traceOne`'s three termination guards and missed the projection-jump
  guard, which is exactly the one that kills traces on wandering arterials.
  The pose photographed a kerb gap of its own devising. Owned.

## 2. Fix (my file, one idea): mirror all three guards, require 20 m each way

`deriveKerbFace` now walks ±40 m in 5 m steps from the centreline point
with kind, width (±1.5 m) AND projection-jump (≤ 8.0 m) guards — the full
`traceOne` termination set — and requires ≥ 20 m each way. Re-verified at
the capture seed: new edge carries **12 kerb-face verts within 10 m**
(pose-chunk bake only; the 10 m disc crosses a chunk boundary, so this
undercounts), 50 within 20 m, walk holds **130/160 m (81%)**. Arterials
mostly fail out now, which biases selection toward straight grid kerbs —
the readable kind, and the reason the bar is per-direction rather than
total.

Q1 HELD (deterministic recomputation; camera held 0.09 m). Q2 REFUTED as
feared (0 verts <10 m, 28% walk) → fixed and re-measured above.

## 3. Unchanged standing orders

- Orange trace (copper 13°/14° by authorship) and the `sections.json`
  `kerb-face` key: untouched, still open as reported.
- No grammar, budget, LOD, renderer, or marketbake edits. The 3.61x band
  question (paint vs kerb face at full contrast) is now answerable by
  re-shooting this pose: the edge it stands on is verified to carry kerb.

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0 (one scratch-file unused-var
error during the round, deleted with the scratch).
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`.

## Files committed (this round)

- `src/world/diagnosticposes.ts`: trace-mirroring straight-run walk.
- `docs/R11_KERB_TRACE_FIX.md`: this file.
