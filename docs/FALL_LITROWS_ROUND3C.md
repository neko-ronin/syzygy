# Fall lit rows, round 3c — blocks at the distance the crowns are actually seen

**Implementer's record. The frames are fall-review's to judge; this file says what
changed, what it measured, and what it cost.**

One change, taken straight from PART 6's close-out: the LOD 0-1 path now lights a
contiguous **row of 2-3 bays at one height** per dressed face. The merged row is
untouched and still serves LOD 2.

## The diagnosis this round acts on

PART 6 established the row was still a point at 18, and that the cause was a LOD
mismatch, not a bay size: the merged row is drawn only at LOD 2 (~819 m, `LOD =
floor(chunks / 1.6)` with 256 m chunks), where a 2.9 m bay is 1.9-2.7 px, while
18's crowns are at **193-410 m = LOD 0-1**, where the near path drew one bay per
face. The probe's own `p.d > 160 ? 2 : 0` said "lod 2" for every column past
160 m, so the diagnostic described a path the renderer does not take there.

## What changed

`src/render/fallvillage.ts`, `dressFaces`: the per-window bay became a row.

- The row is anchored on the face's first window (the one 3a always lit) and is
  **2 or 3 bays** of the 3a size (2.4 m wide, 0.46 of the box height).
- 0.45 m of panel between openings, not the 0.12 m a mullion pair would leave: at
  410 m 0.12 m is a third of a pixel, the bays merge, and the "row" is one 31 px
  bar — a wider point. At 193 m the 0.45 m panel is 1.9 px, so the openings stay
  countable across the band the acceptance names.
- The 2-vs-3 roll uses the face's own **key**, not the face's rng `w`: `w` feeds
  `weatherRoom` on the next line, and one extra draw would re-roll every seam,
  grime skirt and opening on every face in the zone. The per-window 25 % lit roll
  is still consumed (and no longer decides anything) for the same reason.
- Stream-neutrality is measured, not asserted: a bay is 1 pane + 6 frame quads =
  14 triangles, so `triangles - 14 × bays` is everything the round did not mean to
  touch. It is **90,460 at LOD 0 before and 90,460 after** — the row added 292
  bays (+4,088 tris, an exact multiple) and re-rolled no face.
- LOD 2 is byte-identical: 2,872 merged lit quads, 7,842 m², before and after.

## The probe, corrected

`src/render/__probe_litrow.ts` no longer guesses the LOD. It calls the renderer's
own functions — `lodForDistance(chunkDistance(...), TIERS.medium)` from
`quality.ts`, with the chunk size from `defaultCityConfig()` — and prints, per
column, the LOD the renderer would bake that column's chunk at. It now asserts
**blocks, not area**: it builds each column alone at that LOD, keeps only the
lit-warm quads whose outward normal faces the camera (a back-facing pane is
hidden by the pile, so counting it would overstate what the reviewer can see),
projects their centres, and buckets them into rows by **face normal + height**,
splitting where the along-face gap exceeds one bay + one panel. The bucketing
matters: a normal-only test counted two stacked rows as a run of four.

## Measured at 18 (run `shots/2026-10-22T01-23-07`)

Probe, world-space contiguous runs — all six nearest columns now carry a row, none
carries a single mark:

| column | dist | LOD | bays | runs (largest first) |
|---|---|---|---|---|
| id109 | 193 m | 0 | 22 | **6**, 4, 4, 3, 2, 2, 1 |
| id76 | 198 m | 0 | 6 | **2**, 2, 1, 1 |
| id124 | 225 m | 0 | 4 | **2**, 2 |
| id89 | 228 m | 0 | 12 | **5**, 2, 2, 1, 1, 1 |
| id123 | 262 m | 0 | 4 | **2**, 2 |
| id108 | 264 m | 0 | 8 | **2**, 2, 1, 1, 1, 1 |

Pixel count in the frame (warm = `R > B + 15 && R > 60`, the reviewer's threshold),
before = the 3b run `01-00-11`, after = this run:

| column | 90 px box (PART 6's) | comps | 130 px box | comps |
|---|---|---|---|---|
| id109 | 13 → **38** | 1 → **3** | 15 → **74** | 1 → **5** |
| id89 | 10 → **40** | 2 → **3** | 71 → **136** | 4 → 4 |
| id124 | 6 → 8 | 1 → 1 | 43 → **103** | 3 → **7** |
| id108 | 25 → 26 | 2 → 3 | 111 → 111 | 8 → 9 |
| id76 | 197 → 198 | 21 → 24 | 534 → 496 | 57 → 50 |
| id123 | 79 → 89 | 11 → 9 | 163 → 163 | 22 → 15 |

**Counted on the frames, not inferred:** id109 carries **3** contiguous blocks at
its crown, id89 **3** (plus a second row of 4 on a lower face), id124 **4**, id108
**3**. id76 and id123 sit directly in front of the old city's window grid, where
blocks cannot be attributed by eye; the probe's world-space count says 2 on each.
The 90 px box under-reports because the crown is wider than 90 px — the id109 row
sits at x 145-173, mostly left of a box spanning 161-251, which is part of why
PART 6 measured 12-14 px there.

The 4s and 6s in the probe column are two rows meeting where two boxes abut at the
same height, not one face drawing more than three bays (n ≤ 3 by construction).

## Cost

| | value |
|---|---|
| G-buffer delta vs 3b | +1,204 / +1,204 / +1,260 / +504 tris (poses 16-19) = **+0.113 / +0.128 / +0.098 / +0.025 %** |
| 3a for comparison | +0.06 % — same order, as the budget expected |
| lights | 1221 / 1133 / 1405 / 1133 delivered (+4 to +6), **starved 0**, cap 3072 |
| why lights moved | a face that rolled zero windows had no bay and therefore no lamp in 3a; it now gets both |
| LOD 2 merged | unchanged, 2,872 quads / 7,842 m² |
| whole-frame warm at 18 | 1.32 % → 1.31 % — flat, as expected: ~600 new lit px in a 1.44 M px frame |

## Capture

`node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence
--pose=fall` → **PASS**, `shots/2026-10-22T01-23-07`, 5 shots, 51.8 s, app booted
**frameCount=911**, `"error": null` on every shot.

## What I expect the reviewer to still find wrong

1. **19 changed and it is the clearest test of the row up close:** the near
   pile's upper container now carries a 4-block lit band where 3a had one framed
   bay. It reads as a window wall, not a decal, but it is a visible change on a
   pose the last round called a pass.
2. **The band can exceed 3 blocks** where two rows abut at a box edge (id109's
   run of 6 in the probe; 4 in the id124/19 frames). The spec asked for 2-3 per
   face; the geometry delivers that, and the extra comes from adjacency.
3. **The crown is wider than the 90 px measurement box**, so any future count
   that keeps PART 6's box will under-report again. The box size is part of the
   method, not a detail.
4. **16 is still unjudgeable for this change** — no fall crown is in that frame
   at all; it remains the pose item PART 6 named.
