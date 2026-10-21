# Fall columns, round 2 — the break (`fallcolumn.ts`)

Commit: see the git log why-line. Evidence: `/tmp/vnprobe_r2_before.txt`
(the move state — `pushColumn` relocated verbatim from fallmesh, so the
baseline counts below are measured, not derived) and
`/tmp/vnprobe_r2_after.txt` (the break grammar). Probe:
`npx --yes vite-node@6.0.0 src/render/__probe_fallvillage.ts`.

## 1. Why this round exists

The round-1 close-out (VISION_FALL_BASELINE PART 3) moved the gap off the
villages and onto the columns: *"the zone's largest surfaces are still plain
smooth prisms — the column shafts carry no break, no rebar, no stain and no
salvage cut, and at dusk they are the brightest, warmest thing in the frame."*
Four round-1 frames opened with the sheets in mind said the same thing as
pixels: pose 16's shafts are giant warm prisms with clean flat tops; pose 18's
band reads as a row of orange needles; pose 19's background pier is a beige
plane behind the village. Sheet B wants a bare, windowless, dark concrete
column with the pile (not the shaft) as the subject.

Two levers, both on the column per the brief's scope:

1. **Value/hue leg.** The concrete drops from `[0.34, 0.35, 0.36]` to a cold
   soot-slate `[0.23, 0.245, 0.27]`, and everything that sits on it (stain
   `[0.11, 0.12, 0.14]`, spall `[0.16, 0.16, 0.155]`, scorch `[0.075…`,
   bands `[0.155, 0.135, 0.12]`) is darker still. What is left of a shaft's
   sunlit area is a fraction of a prism face, so the warm migrates to the
   villages and their crowns can be the brightest thing at dusk. No lights
   were added (D28: lights were 0 starved; they stay 0).
2. **Silhouette leg.** Every broken kind carries its break as **geometry
   that survives the lod ≥ 2 merge** — the merged blocks in citymesh cannot
   know about breaks, so the shaft breaks itself, in `pushColumn`, at both
   tiers.

## 2. The grammar, per kind (DESIGN §8's table, not one generic jagged cylinder)

| Kind | Break status | What is drawn |
| --- | --- | --- |
| pier | `shear` | body to a lowered rim (2.2–4.6 m drop), then **three torn slabs ascending to the high corner** (a seeded axis + side, jittered tops capped at the record top), rebar bristles (4–7, rust/steel), one spalled aggregate face proud of the shell, 2–3 stains running down from the redone rim |
| pier | `crater` | body lowered 1.8–3.2 m, hollow floor plate deep in the crater, **uneven rim ring** (up to 3 torn segments per wall, recessed 0.02 off the shell), rebar, stains |
| pier | `cut` | clean salvage top with a **scorched saw girdle** 0.05 under the rim (reads far), 2–3 anchor-bolt stubs, one coolant stain |
| pier | `intact` | full height + **bearing cap** (+0.22 plan) + 1–2 stains — survivors stay near-plain; their deck fragment is the read |
| core | intact | **stair slots** up one seeded face every floor line (3.1 m pitch, jittered runs), **lift doors** up another face every second floor, **slab-stub fringe** — the ledge lip of the lost floors, on two faces — low drips; lod 1 halves the rhythm, far keeps a clean dark slab (intact kind: no break to read) |
| stack | intact | **three-part taper** (×1 → 0.86 → 0.73, jittered), **oxide bands** every 7.5–11.5 m on whichever part they cross, a flue lip at the record top (what the round-3 turbine then crowns), long drips |
| silo | intact | the battery unchanged (square cylinders still), **hairline ring cracks** (2 per cylinder near, 1 far), scorch-tinted drips |
| lattice | `shear` | **legs of uneven height** — 1–3 legs of the four drop 1.0–3.2 m under a seeded shuffle, broken stubs crown the cuts; intact cages unchanged |
| spire | `crater` | walls to a lowered rim (2.5–6 m), **jagged battlements** standing back up to ±1.6 m of the record top (55 % stand roll, 4 segments per wall near / 3 far), **interior floor plates** (two ring ledges inside the shell), long drips; the round-1 crater village inside still shows from above |

Coplanar bookkeeping (PITFALLS class of bug): pushed detail sits 0.01–0.05 m
proud of (or recessed 0.02 m back from) the face it dresses; slab bottoms bury
0.3 m into the solid below; drip streaks clamp to the ground plain; battlement
sides are proud 0.01 of the wall shell and pulled 0.02 in from the corners;
band corners stop 0.002 short. No pushed face shares a plane with the shell.

## 3. The numbers

Per-kind shaft triangles (probe `col` rows, seed 5e7a17), **before → after**:

| Kind | n | lod 0 mean | lod 0 break cost | far (lod ≥ 2) mean | far broken read |
| --- | --- | --- | --- | --- | --- |
| pier | 93 | 12 → **129** [26..258] | +117 | 12 → **61** [20..120] | steps / rim ring / scorch rim survive |
| core | 25 | 12 → **258** [168..296] | +246 | 12 → 12 (deliberate) | clean dark slab; the rhythm is a mid/near read |
| silo | 8 | 30 → **74** [32..88] | +44 | 30 → **50** [20..60] | crack lines survive |
| stack | 5 | 12 → **143** [116..182] | +131 | 12 → **138** [112..176] | taper + bands + lip all far |
| lattice | 17 | 48 → **73** [48..84] | +25 | 48 → 48 (uneven tops) | stepped leg heights |
| spire | 3 | 48 → **341** | +293 | 48 → **192** | battlements all far |

Citywide (seed 5e7a17): the shafts add ≈ **22 000 tri at lod 0** (village
92 184 → ≈114 200, +24 %) and ≈ **8 400 at lod ≥ 2** (village far 8 712 →
≈17 100, ~×2). The far tier doubles by design: the band's broken silhouette
is the deliverable, and the merged tier sits at village-block cost with real
headroom. Per-chunk: heaviest chunks carry 9–12 columns, so the +1.2–1.9 k
per near chunk lands under the village's own 8 430 max; the probe's chunk
rows stay village-only for round-1 continuity (unchanged: mean 3 414, max 8 430).

Seed spread across the eight (lod 0 means): pier 97–159, core 211–258, silo
32–97, stack 129–165, lattice 48–73, spire 341. Determinism: **village
IDENTICAL / shafts IDENTICAL** on every seed (everything rolls on
`makeRng(c.seed ^ 0xc01a)`, no Math.random, no shared stream).

## 4. Bounds — the two contracts, both graded

The probe grew a second sweep. Where round 1 graded the village boxes against
the **pile record**, the structural shafts now get their own arena, at **both
lod tiers** (the far silhouette must be broken *and* inside bounds):

- y: ground plain (`GROUND_Y − 0.05`) up to the break plane `c.top + 2.9`
  (rebar ≤ 2.4 m, battlements never over the record top, streaks clamp).
- xz: the record's pile extent, or for the interiored kinds the structure's
  own half — lattice adds its 0.8 m leg section (legs sit exactly at ±halfX),
  the spire grades against the tube's outer face. Same logic as round 1's
  lattice-interior exception, extended and documented in the probe.
- Verdict: **WITHIN on all 8 seeds, 0 OUT rows**, village sweep unchanged and
  still WITHIN.

## 5. The lattice-registry question (asked in round 1, closed here)

**Registry: unchanged.** The crowd obstacles in `pushFallChunk` still read
`x/z/halfX/halfZ/top` straight off the placement columns — fallzone has zero
edits, the obstacle registry is untouched, and the fall-zone sweep's key
affirmation holds. ("fixes in the grammar, never placement") Files this round
touched: `fallcolumn.ts` (new), `fallmesh.ts` (the `pushColumn` call site +
header — placement rows untouched), `__probe_fallvillage.ts`, two docs.
`fallvillage.ts` stayed frozen.

## 6. What a far LOD still shows

A far pier: a cold slab with a **diagonal top** (3 ascending steps, 2-5 m of
drop) and/or a lowered rim with an open-ring crater around its rim segments;
a far cut pier keeps its dark scorch girdle; a far intact pier keeps the cap
ledge. A far stack: a tapering trunk with 8–14 oxide band rings. A far spire:
a 130–200 m wall crown with 12 battlements standing back to the record top. A
far lattice: legs of uneven height. What disappears far: rebar, stain/spall
albedo, ring cracks, floor plates, bolts, the cores' floor rhythm. The cores
are deliberate: they are intact kinds — the band's broken read comes from the
kinds with a break in `c.break`.

## 7. Deliberately left out

- **Cylinder silos.** §8 says "touching concrete cylinders"; the battery is
  still square. This is a form change (pushCylinder + caps + a new z-fight
  surface to re-audit), not a break — round-3 candidate, not smuggled in here.
- **Lattice cross-braces / hanging truss stubs** beyond the crown cuts. The
  cages read via the round-1 kits and now via uneven legs; brace diagonals
  are box-budget greed this round.
- **Lights.** None, D28 unchanged.
- **Any shader/material-system change.** Stain and spall are pushed albedo
  planes; the concrete retint is `pushColumn`'s own color. No WGSL touched.
- **Ground lifelines, patches, decks, bridges, wreck, ropeway huts, crowd
  obstacles, revival kit.** Not this slice.

## 8. What to ask the reviewer's capture to look at

- Pose 16 close-up: the top rim of the nearest shaft should carry steps or an
  open crater with rebar, stains, and a spalled face — no clean flat top.
- Pose 18 band: the silhouettes should vary column to column (uncapped
  heights, diagonal tops, battlements), with the band's warmth on the
  villages; the shafts cold and dark enough that the lit crowns read.
- Pose 19 background pier: stains/spall legible on the face behind the pile.
- The value leg is only measurable in frame: whether the sunlit sliver stops
  being the brightest object is the capture's call (no captures were run
  here; the reviewer owns the run).
