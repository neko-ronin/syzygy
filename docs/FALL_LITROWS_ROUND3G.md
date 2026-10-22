# Fall lit rows, round 3g — the row on both long faces of each box

**Implementer's record. Frames are fall-lamp-review's to judge; this file says
what changed, what it measured, and what it cost.**

One change, taken from PART 11 NEXT: `dressFaces` now draws the row and the face
dressing on BOTH long faces of each box, not only the outward one, so a camera
that meets the inward face no longer sees an undressed box (PART 11 (c): pose 19
lost its 4-block band because the row moved to the outward face).

## What changed

`src/render/fallvillage.ts`, `dressFaces`: instead of selecting one long face by
line of sight (`side = outward; flip if it does not fit; skip if neither fits`),
both long faces are tried independently and each is drawn where its balcony reach
stays inside the record. The face KEY is unchanged — it is still keyed to the
box's `a`, `b` and level, with no side in it — so the layout (wins, bay count,
anchor, mid) is computed once per box and both faces draw from the same stream:
no re-rolled seams, grime, skirt or bays. Row geometry is unchanged (0.4 of the
face, cap 2.4 m, 0.45 m panel). The LOD 2 merged path, palette, poses and lights
are untouched (merged pass still 2,872 quads / 7,842 m²).

## Cost (probe, `src/render/__probe_litrow.ts`, seed 6191639)

- **Lit bays (lod 0, whole zone):** 542 → **1078** (+536, +98.9 %).
- **Bay-free triangles (lod 0):** 90,564 → **93,192** (+2,628).
- **Total LOD 0 triangles (village):** 98,628 → **108,284** (+9,656, +9.8 %).
  That is just under the +10 % line; said plainly, doubling the dressed faces
  costs about one tenth more of the zone's triangles.
- **In frame at 18:** g-buffer triangles 1,291,864 → 1,294,610 (+2,746).
  Total frame triangles 4,891,477 → 4,798,571 (−92,906, dominated by
  crowd/traffic dither, not geometry).
- **Lights:** 1,405 delivered, 0 starved (pose 18); 1,133 delivered, 0 starved
  (pose 19). No light-count change from the round.
- **LOD 2 merged:** 2,872 quads / 7,842 m², byte-identical by construction.

## Run (sequence, authoritative sidecar)

Run directory: `shots/2026-10-22T06-07-15/` with `_capture.json`.

Per-pose (from `_capture.json`):

- 18-fall-skyline: error null, lights 1405, starved 0, held fov 1.04451235,
  triangles 4,902,545, gbufferTriangles 1,295,018, lodHistogram [9, 34, 124, 0].
- 19-fall-pile-close: error null, lights 1133, starved 0, held fov 1.07304157,
  triangles 4,790,671, gbufferTriangles 2,027,940, lodHistogram [9, 34, 124, 0].

Earlier single-shot frames (no sidecar; kept as earlier evidence only):
`shots/2026-10-22T05-39-47-18-fall-skyline.png` and
`shots/2026-10-22T05-40-06-19-fall-pile-close.png`.

## Warm share at 18

Whole-frame warm-bright (R > 120 && R > 1.6 B): **0.2 %** (baseline 1.34 %).
No flood.

## What this round does not establish

- Crown counts and frame judgement are fall-lamp-review's, not mine.
- That six of six crowns carry a row, or that pose 19 recovers its band.
- That the probe's screen map is exact (PART 9 (b): ~12 % too close to frame
  centre); counts are taken where the row is drawn, not from probe positions.