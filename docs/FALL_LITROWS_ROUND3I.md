# Fall lit rows, round 3i — the pick (which box carries the row)

**Implementer's record. Frames are fall-lamp-review's to judge; this file says what
changed, what it measured, and what it cost.**

One change, taken from PART 14 NEXT: in `dressFaces` (`src/render/fallvillage.ts`)
the selection order is changed so the box that carries the row is chosen by
radial line of sight, the way 3e chose the face by radial line of sight. The old
order was `q.y - p.y || |p.a| - |q.a| || |p.b| - |q.b|` — height first, then
the **innermost** box (`|a|` ascending), which is exactly what put the row on a
flank the camera sees edge-on (id108) or on a small box turned away (id124). The
new order leads with **outwardness** (`a*sin rot + b*cos rot`, descending) — how
much the box's dressed long face points away from the pile's axis — then
shadowed (a higher box with at least as much radial reach), then radial reach,
then height, then `|a|`/`|b|`. No new rng draw: the order is a pure function of
the already-rolled tops, so the seed, the dressing rolls and every seam/skirt/
window on every face are untouched.

## What did NOT change

- The face KEY (`c.seed ^ FACE_SALT ^ a ^ b ^ level`) — unchanged, so no face
  re-rolls.
- Row geometry (0.4 of the face, cap 2.4 m, 0.45 m panel) and the both-faces
  rule from 3g — unchanged.
- The LOD 2 merged path (2,872 quads / 7,842 m²), palette, poses, lights.
- Cost: this is a selection-only change. No new geometry.

## Probe (`src/render/__probe_litrow.ts`, seed 6191639)

Before (3g, commit `db33795`) and after (3i) are identical on the probe's
counts: **1078 lit quads at lod 0, 2872 at lod 2, 93,192 bay-free triangles**.
The six nearest crowns print the same clear-pane runs:

| column | dist | panes | clear | runs (clear) |
|---|---|---|---|---|
| id109 | 193 m | 44 | 11 | 4+2+2+2+1 (ACCEPT 2+2+2) |
| id76 | 198 m | 12 | 4 | 2+2 (ACCEPT) |
| id124 | 225 m | 8 | 3 | 2+1 (ACCEPT 2) |
| id89 | 228 m | 24 | 4 | 2+2 (ACCEPT) |
| id123 | 262 m | 8 | 4 | 2+2 (ACCEPT) |
| id108 | 264 m | 8 | 2 | 1+1 (no 2-3) |

The pick did **not** move id124 or id108 in the probe: id124's lattice has a
single candidate box (nothing to pick among), and id108's stack has two
candidates that are both already dressed (want = 2), so reordering them changes
which runs are counted but not how many. The probe's clear-pane test is also
stricter than the frame's (it requires the pane to face the camera and be
unoccluded by the pile's own mesh); a box whose outwardness is negative still
draws a row on a face the probe will not count. Whether the pick moves either
crown on the frame is the reviewer's call, not mine.

## Run (sequence)

Run directory: `shots/2026-10-22T06-57-22/` with `_capture.json`.

Per-pose (from `_capture.json`):

- 18-fall-skyline: error null, lights 1405, starved 0, held fov 1.04526686,
  triangles 4,800,595, gbufferTriangles 1,295,026, lodHistogram [9, 34, 124, 0].
- 19-fall-pile-close: error null, lights 1133, starved 0, held fov 1.07213867,
  triangles 4,300,635, gbufferTriangles 2,027,940, lodHistogram [9, 34, 124, 0].

Self-tests: `tsc --noEmit` clean, `vite build` clean, `__selftest.ts` →
`VIOLATIONS none`, `__selftest_fallzone.ts` → `VIOLATIONS none`. Preflight OK
(mem-unused 822 MB).

Warm share at 18: warm-bright 0.2 % (baseline 1.34 %). No flood.

## Cost against 3g

Selection only. Lit bays 1078 → 1078 (0), bay-free triangles 93,192 → 93,192 (0),
LOD 0 village triangles unchanged. In-frame at 18: g-buffer 1,295,018 vs 3g's
1,295,018 (+0), total triangles 4,800,595. No light-count change.

## What I did NOT verify

- The frame count is the reviewer's job. I do not claim 5 of 6; the probe's
  clear-pane counts are unchanged (id124 still 2+1, id108 still 1+1), so on
  the probe's stricter measure the acceptance is not met. Whether the frame
  shows a second visible block on either crown is unverified here.
- `workshopYard` (every third winch) is not in any judged frame; its read is
  unverified, as in every previous round.
- I did not re-run the city-wide check (`wide-skyline`, `aerial-top`); the
  change is selection-only and touches no new geometry, but that is an
  assumption, not a measurement.
- I did not move or alter the lamp, the pool, the poses, or the LOD 2 path.