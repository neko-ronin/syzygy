# Fall village, round 1 — material and light only

The brief (DESIGN §8, D28; gaps live in `docs/VISION_FALL_BASELINE.md`): cold
steel-blue/slate material, the pile crowns read as weathered rooms, one lit
window row per pile top at LOD 0, and the cantilevers re-grounded in the
grammar instead of the placement. Job 1's boot fix is separate (`7f06ac4`);
everything in this file is round 1. Round 0's open question 2 (boxes hanging
past the registered extent) closes here.

## 1. What shipped

- **Material.** The container palette rebalanced cold: 6 cold entries
  (`ROOMS[1]` ×2, `[0]`, `[4]` ×2, `[9]`) and 3 warm (`[2]`, `[8]`, `[6]`).
  The roll order is untouched (`r.int(0, 8)` after the same draws as round 0),
  so the piles keep the round-0 shapes; panel rooms keep the round-0 tint
  spread (0.62–1.0).
- **Faces.** 3–5 crown boxes per pile (crown-first sort, `lod < 2`) get
  `weatherRoom` trade dress — pane-adjacent faces only, gated so a face's run
  plus a balcony's 1.5 m reach stays 0.3 m inside the record (faces on boxes
  that would dress across the record are skipped, not moved).
- **Lit rows.** The pile's first window always lights; each further window
  lights on `w.bool(0.25)`. The lit pane over-paints at front + 0.03
  (`LIT_WARM`, emissive 3.0, doubleSided), just proud of `weatherRoom`'s
  frames (+0.022) and soot (+0.015).
- **Crown light.** One light per lit crown at `lod < 1`, from the first lit
  face: `u.wide + 0.8` out on the face, radius 10, `[1.0, 0.68, 0.34]`,
  intensity 1.4. Threading: `pushFallVillage` collects the chunk's
  `ChunkLight[]` (type declared structurally in `fallmesh.ts`, no bake import)
  and `citymesh`'s `bakeChunk` passes the chunk light list in.
- **Cantilever, in the grammar.** The outer face sits 0.3 m inside the record
  on the pushed axis and the whole box stays inside on the other axis; one
  brace (0.07 member) runs from under the box's inner edge down and inward.
  Boxes whose proportions cannot fit the record are rolled and dropped.

## 2. Numbers

Before = the Job-1 baseline probe (`/tmp/vnprobe_before.txt`); after = this
round's. **Lights before = 0** (round 0 had none); "merged" is the far-half
LOD ≥ 2 triangle count.

| seed   | lod0 before→after (citywide) | merged before→after | crown lights |
| ------ | ---------------------------- | ------------------- | ------------ |
| 5e7a17 | 95 300 → 92 184              | 5 472 → 8 712       | 60           |
| 2a     | 44 520 → 43 342              | 2 700 → 4 252       | 26           |
| 7      | 74 900 → 70 924              | 4 212 → 6 460       | 45           |
| d      | 24 024 → 24 820              | 1 788 → 2 652       | 11           |
| 63     | 28 400 → 27 658              | 1 464 → 2 216       | 14           |
| 4d2    | 56 816 → 56 072              | 3 576 → 5 672       | 34           |
| 7a69   | 12 588 → 12 336              | 780 → 1 132         | 7            |
| beef   | 21 352 → 22 122              | 1 248 → 1 984       | 15           |

Per-chunk LOD-0 mean: 3 530 → 3 414 on the largest seed. The LOD-0 drop is
mostly the anchors pulled inside the record (shorter collar planks, seated
kits); the merged rise (+60 % citywide) is round 1's single out-of-scope add:
**merged far blocks gain an emissive pane row at `lod ≥ 2`** (2–4 panes per
block face, kinds-specific, ~85 % roll) per D32's "merged blocks with lit
windows". It is cheap, but it is scope; say the word and it rolls back with
one clause.

## 3. The `weatherRoom` contract, and what the pile side feeds it

`weatherRoom(bld, Q, t, y0, front, sw, sh, sd, c, wins, metal, w)` (citymesh,
now exported) assumes:

1. `Q(t, y, d)` places a point **t** along the face from its left edge, **y**
   absolute, **d** outward from the room's back plane; `front` is the depth
   the visible face sits at (`front + 0.01` = the panes' plane).
2. `t`/`y0` are the room's run-centre and floor; the room fills
   `t − sw/2 … t + sw/2` across, `y0 … y0 + sh` up.
3. `w` is its own RNG: the room never re-rolls because neighbours changed.
4. It draws near-field trade dress only (seams, soot, grime, frames, a lit
   side window, a balcony, a tarp) and over-paints nothing of the caller's
   geometry; the caller's lit over-paint must sit proud of its frames.

What changed to feed it a pile box: the caller in `fallvillage.ts` builds the
frame from the box's own unit — `Q = back-left-floor corner + runAxis·t +
outAxis·d`, `front = u.wide`, `runHalf = u.long / 2`, per-face rng keyed
`(c.seed ^ FACE_SALT ^ hash(a, b, y0))` so a face never re-rolls behind its
neighbours — and gates the face against the record. All adaptation lives in
`fallvillage.ts`; `citymesh` changes are the `export` keyword plus the chunk
light pass.

## 4. What the tightened sweep caught — before/after classes

The round-0 sweep gated on the chunk's world AABB union and attributed only
when it tripped; the union masked every escape below. The round-1 probe builds
each column alone, per chunk, and grades every vertex against the column's
registered extent (tolerances: +7.0 above, 4.6 below in y; 0.4 round-off room
in xz). **Before this round: 11/8 chunks outside on the first seed;
after all 8 seeds: 0 outside, determinism IDENTICAL everywhere.**

**Class A — a rotated piece graded on a yawed-rectangle record** (the
`gridHalfs`/`ringLongMax` projection answer):

- Stack ring containers, radial 12 m: ~5 m past both axes (round 0's catch,
  now fixed by projection: length capped so `|centre| + gridHalfs ≤ record −
  0.25` on both grid axes, per spot).
- Collar planks: a uniform-length plank ring reaches `√(rMid² + (len/2)²)`
  along a grid axis — 6.67 against a 6.21 record (stack 17). Planks are now
  capped per segment the same way.
- Lattice cage legs: round 0 placed them on the **world** axes, so the record
  saw the half·√2 diamond (10.89 against a 7.67 record) — and the braces
  silently missed `fallmesh`'s shaft legs, which stand on the **grid**. The
  cage is grid-aligned now; the brace/leg sighting was wrong all round 0.
  The grill's interior record (0.85×) is by design, so the probe grades
  lattice columns against the cage half.

**Class B — clamps on the wrong axis**:

- Odd pile-rect layers never turned: the docstring's "layers turn 90 deg" was
  coords swapped but `rot` left 0 — a 12 m container on an across-centreline
  reached record + 0.4 (pier 106). Drawn rotated now, and the recorded rot
  matches what was drawn (the dress Q reads the same value).
- Row runs broke 0.9 past the span (`+0.9` slack): full rows hung 0.55 past
  the layer face. Break at the span; the cantilevers carry the silhouette.
- Cantilever halves: pushed-along-a used the box's pushed half on the b axis
  and never clamped the long half that still ran on a — a 12 m container
  pushed along b reached ~11.5 into a 6.9 record (pier 39). Half-per-axis now
  (`hPush`/`hSide`), jittered side clamped to the record with the box's own
  half.
- Cantilever brace coordinates: for b-pushes the brace took `pushed` on the
  across axis; its far end landed at record + 0.3 in xz (pier 21's
  11.59–11.73 band). The brace now runs (side, inner) → (side, to).
- Silo cross-shacks: an edge cap jitted outward reached record + 0.64
  (silo 21/30/55/83/98); the centre now clamps so `|a| + wide/2 + 0.1 ≤
  record`. The end canopy ran ~3 m past the battery: the seat now caps the
  run and drops the canopy where the record cannot hold it.
- Outrigger beam tips: round 0's leg was `over + 0.9` long, so the tip hung
  record + 0.45 on every pier (the whole 0.05-class row list). Tip flush at
  the record now (`legLen = over`).

**Class C — decoration envelopes**:

- Door leaves: ±0.565 centres with a 1.02 half-width reach 1.585 from the
  centreline — 0.385 outside the box's own wide on anything narrower than a
  panel, and a record escape wherever the box's across axis is a record axis.
  Hung from the face's edges now; the envelope stays `wide/2`.
- Stack second-layer centre clamp could invert (`record − half < 0`) — the
  drawn box would have poked out while every clamp lined up; guarded (drop
  the second box).

## 5. Answer on the pose-19 deck read

Deck fragment white at noon = `fallmesh`'s `SLAB [0.3, 0.31, 0.32]`
(fallmesh.ts:19, used at :107) — the deck's albedo, not a lighting problem.
The pile's flat brown was round 0's warm palette, which this round changes.
The slab itself stays until the ground round: out of scope here.

## 6. Determinism note

Round 1 is a recomposition: recording the crown `u`/`y0` on some spots
(ring/lattice/spire values) and honest rotations change pile geometry, so
Job 1's byte-identical guarantee does not extend here. What is proven is
rebuild-stability: the same build twice reproduces bytes on every seed
(`IDENTICAL` ×8). No `Math.random` anywhere; every roll rides the seeded
chain.

## 7. Checks and what is deliberately not done here

- `tsc --noEmit` clean; `vite build` clean;
  `__selftest_fallzone` `VIOLATIONS none`; hygiene `ALL PASS`.
- Probe: 8/8 seeds bounds `WITHIN` (exact per-column), determinism
  `IDENTICAL`, 212 crown lights lod 0 citywide across the sweep.
- **No GPU capture this round** (the run costs 66 MB on this machine); the
  reviewer owns the next capture run and judges it against the section
  sheets via `compare.mjs --auto`.
- Out of scope, unchanged: ground, patches, decks (SLAB), bridges, wreck,
  columns, ropeway huts.

## 8. Round-2 hooks carried forward

- The lattice interior record (0.85×) vs the cage: decks/bridges anchored
  near a lattice pile could clip the cage legs at the old union-gate
  difference; if round 2 touches anchors, grade them against the cage half.
- Merged pane rows are the one scope add; keep or roll back with one clause.
- The collar planks can gap where a diagonal cap bites; if the reviewer's
  frame reads it as broken rather than derelict, shrink `rMid` instead and
  keep `len` uniform.
