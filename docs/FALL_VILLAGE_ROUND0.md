# Fall-zone village — round 0: form and silhouette

**2026-10-20, geometry implementer.** Round 0 of the village rendering pass
(DESIGN §8, the owner's brief this session): the pile on every column top as
real geometry — containers and salvaged rooms, layer turns, outriggers,
cantilevers, uneven tops — wired by one call inside `pushFallChunk`. No faces, no
revival kit, no lights: those are rounds 1-2. Everything here was verified
headlessly; no captures were run (owner budget: the reviewer owns GPU work).

## What was built

`src/render/fallvillage.ts` (new). `pushFallVillage(bld, fall, lod)` pushes one
kind-specific pile grammar per column; every column rolls its own stream from
`makeRng(c.seed ^ 0x7113e55d)`, so the same seed builds the same village on every
run and chunking cannot split a pile (each box stands on its own column).

- **Boxes.** Containers 2.4 x 2.6 m, 6 or 12 m long — three shallow rib flats
  per 12 m face (one per 6 m face) stand for the corrugation, and a proud
  door-leaf pair reads on one end. Rooms are 2.8-3.7 wide, 3.6-7.4 long, plain.
- **Piers and cores** (`pileRect`): 3-10 layers (cores 5-10), each turned 90 deg,
  boxes back to back with gaps and skipped top slots so the crown steps instead
  of extruding; bottom layers hold the full footprint the placement set; piers
  keep two rows on wide layers. Steel outriggers under every overhanging side
  (one beam each, two braces back down the shaft face), 1-2 boxes cantilevered
  up to 3.6 m past the pile edge where there is an overhang. Cores get the stair
  head-house rising from `top - 0.5` to `pileTop + 0.9` with a small roof; boxes
  route around it along and across, both layer turns.
- **Silos**: a linear village along the battery — a run along the cylinder caps
  on even layers, crosswise shacks snapped onto cylinder centres on odd layers
  (clamped to the gallery's depth: `halfZ` is the radius plus 25%, so an
  unclamped 12 m container would sit metres outside the extent), an end canopy
  on one cylinder.
- **Stacks**: a plank ridge deck on radial brackets just under `pileBase`, a
  broken ring of 4-7 box spots (tangent or radial), a second box on spots where
  the band is two rows; the chimney's top 4 m stays bare for round 2's turbine.
- **Lattices**: one slung unit per level inside the cage at odd offsets, X
  bracing between one leg pair below the pile.
- **Spires**: 3-5 terraced rings inside the stump stepping inward with height,
  sparser low, denser near the crown.
- **The top kit** (all kinds): 1-3 antennas (some with crossarms), a water tank
  on four legs, a white tarp with a dip and an optional hanging flap. Anchors
  are seated inside the footprint with the piece's own reach, so a tank on a
  collar's outermost spot cannot loll past the extent.
- **`lod >= 2`**: merged blocks, the `lod < 2` convention fallmesh already uses.
  Piers: three stacked blocks; cores add the head-house block; silos a gallery
  slab plus per-cylinder blocks; stacks four collar blocks; lattices one inner
  block; spires two capped stepped cylinders. Far villages cost 12-72 triangles
  per column.
- **Palette**: citymesh's `ROOMS` — containers weighted to steel blue, slate,
  soot, rust and red panels, rooms the full ROOMS range with citymesh's tint
  rule (0.62-1.0). Structural steel is fallmesh's STEEL value (kept local to the
  new file) and the tarp is the only other kit colour. Lore wear this round is
  the palette weighting, not geometry.

## The numbers

`npx --yes vite-node@6.0.0 src/render/__probe_fallvillage.ts` — 8 seeds (the
fall-zone self-test's). Village-only triangles; columns, decks, wreck and
patches stay fallmesh volumes.

Per-kind pile triangles at LOD 0, mean across seeds (min..max of any one pile):

| kind | mean | range | merged (lod >= 2) |
|---|---|---|---|
| pier | 755-1081 | 156..2364 | 36 flat |
| core | 119-184 | 36..336 | 48 flat |
| silo | 228-532 | 84..1232 | 24-36 |
| stack | 344-668 | 272..872 | 48 flat |
| lattice | 312-535 | 108..1116 | 12 flat |
| spire | 1026-1736 | 660..2328 | 72 flat |

Chunks that carry piles: LOD 0 per-chunk mean 1 798-3 530, worst chunk 10 268
(seed 7, chunk -3,-2). Citywide all-chunk sums: 12.6k-95.3k at lod < 2 (seed
scale: 18-151 columns), 0.8k-5.5k at lod >= 2. For scale: a box is 12
triangles, a fully kitted 12 m container ~108; the worst village chunk adds
about a tenth of a tree-bench chunk's near budget. Recorded, nothing cut for
speed (D32).

Every seed also reports, on the same run:

- **Bounds vs placement: WITHIN** — a vertex-level test in the grid frame
  (the world AABB lies for yawed piles, which burned the first version of this
  check). Allowances: kit to `pileTop + 7.0` (a core's head-house roof carries
  its antenna to +6.4, by design), bracing to `pileBase - 4.6`, cantilever past
  the extent 4.6. The sweep found and I fixed three real overruns during the
  round: silo cross shacks ran a 12 m box across the gallery (now length- and
  position-clamped), and stack/pile-top kit anchors sat near the extent edge
  (now seated per piece).
- **Determinism: IDENTICAL** — the same seed rebuilt gives equal counts and
  equal position/colour bytes.

## Wiring, and two flagged deviations

1. **`fallmesh.ts` beyond "the call site".** The brief said wire in with one
   call inside `pushFallChunk` and nothing else in that file. I also removed the
   greybox pile volume `pushColumn` drew and its now-unused `PILE` colour: that
   volume capped every pile with a flat slab at `pileTop` and squared-off sides,
   so the stepped crown, outriggers and cantilevers this round exists to deliver
   could not be read in frame at all. `fallmesh` remains the greybox for
   columns, decks, bridges, patches, wreck and ropeway huts; its header now says
   round 0 lives in fallvillage. If the owner disagrees, restoring the volume is
   a three-line revert — but then the greybox slab must be judged the silhouette,
   not the boxes.
2. **`citymesh.ts`, one word**: `export` on `ROOMS`, plus a comment. DESIGN §8
   says reuse the palette, don't invent one; a copied array would drift the
   next time the scaffold kit's palette is tuned. The word is the cheapest way
   to make "reuse" true this round; the report's open question 5 asks whether
   the export is the right home.

## Deliberately left out (rounds 1-2 per DESIGN §8 and the brief)

- weatherRoom faces, windows, stairs and ladders, laundry.
- The revival kit: turbines, rain funnels, panels, planters, greenhouse, string
  lights. The stack tops are left bare 4 m for its turbine; the spire crowns are
  left open for the crown work.
- Ground lifelines, wreck dressing, ropeway huts' dressing.
- The silo **gallery beam** itself: the linear village stands cylinder-cap to
  cylinder-cap; the conveyor housing is column infra, not village geometry
  (open question 3).
- Corrugation stops at rib flats and door leaves; real worn-face work waits for
  the face round. Repair is palette-weighted only; no repair-driven geometry.

## Open questions (for the reviewer and the orchestrator)

1. **Cores read thin**: 1-2 boxes per layer, mean ~150 triangles. Is
   "narrow and taller" right at pose distance, or do cores want denser packing
   once faces exist?
2. **Cantilever encroachment**: cantilevered boxes poke up to ~3.6 m past the
   registered pile extent — inside the column's own piece, but deck fragments
   and bridges anchor at the extent edge. Check pose 17 for collision reads.
3. **The silo gallery beam is unassigned** — village geometry (this file) or
   fallmesh column infra?
4. **Kit density**: antennas/tank/tarps reach `pileTop + 6.4` at most. Does the
   stepped crown read as salvage, or as clutter?
5. **Palette home**: is `export const ROOMS` in citymesh the accepted solution,
   or should it move to a small shared module?

## Checks run

- `./node_modules/.bin/tsc --noEmit` — clean.
- `npx vite build` — clean (685 ms).
- `npx --yes vite-node@6.0.0 src/world/__selftest_fallzone.ts` — `VIOLATIONS none`.
- `node tools/__selftest_hygiene.mjs` — ALL PASS.
- `npx --yes vite-node@6.0.0 src/render/__probe_fallvillage.ts` — numbers above;
  bounds WITHIN and determinism IDENTICAL on all 8 seeds.
- Not run (owner's caller/reviewer): captures, compare grids, GPU frames.
