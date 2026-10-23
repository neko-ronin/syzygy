# Fall ground, round 3o — the yard's own rubble

**Implementer's record (fall-lamp, revived). The frames are the reviewer's to
judge; this file says what changed, what it cost, and what the pre-registered
predictions were. No VERDICT here — see VISION_FALL_BASELINE.md PART 21.**

## Where this round came from

Round 3n's second review (PART 20, `370e955`) closed the wall work — *3n stays,
wall work stops, residual recorded* — and named the next item for the arc: the
ground pass, judged as a place. Round 3b built lifelines, wreck dressing and
the flooded lows citywide (51,370 tris / 27 chunks, mean 1,903), and PART 7
famously found 0 of 4 poses containing the floor; since 3d, pose 20 does
contain the floor, and the rounds since (3e–3n) judged only its pool, hut face
and lamp. Nothing has ever judged the yard between the pool and the old city.

## What the yard actually contains (measured before designing anything)

Two measurements, both from the current shipped state (`11-09-19`, round 3n):

**1. Placement census** (new harness `src/render/__probe_yard20.ts`, pose 20's
frustum: eye `[558.1, 2.1, −452.4]`, lookAt `[471.1, 19.7, −501.8]`, fov 1.1,
1600×900; leverages the zone's own grammar, draw for draw):

- Citywide: 151 columns, **69 wreck pieces (66 slabs / 3 bodies)**, 25 patches
  (5 flooded).
- In-frustum: 31 placed items from 17 columns. **Only 2 warm sources are in
  frame** — id54's bracket lamp at px (1341,462), 13 m out, and id27's
  stair-tower lamp at the far-left edge (60,500), 152 m out. The midground's
  lamps (id55 winch+workshop 62.7 m, id52 stair-tower 90.9 m) sit **behind the
  camera**; the midground is genuinely columnless.
- In-frame contents otherwise: id54's kit (two cable drums, one at centre frame
  ~(1048,643)), the winch drum beside the hut (1581,659), the hut (1309,604),
  one flooded-patch pool already in frame at 14.5 m — px (267,689), r 8.8 m —
  and wreck slabs at 51-60 m reading as dark planes.

**2. Pixel crops** (the 3n pose-20 frame, 2×):

- The floor's dominant surface feature is the **old city's paving pattern**:
  the zone stands on `citygen`'s ground mesh, and nothing re-arms it when the
  city fell. The yard reads as tiled cells (cobble-family joints) at grazing
  angle; inside the hut lamp's 10 m the flood ripple adds a fine crawl.
- The pool disc reads only inside that 10 m; the in-frame pool at 14.5 m reads
  as pattern, not water.
- The wreck slab at 51 m reads as a smooth tilted plane with soft smudges —
  its own dressing (top lumps at tintOf(CONCRETE, 0.82–1.16)) sits within the
  plane's tone and melts into it.
- The kit drum reads as a smooth brown capsule.

So the yard's failure is the **floor's surface read**: a wreck field wearing
intact paving, its placed furniture unlit and tone-flat, one pool and one lamp
carrying all the light in the frame.
The reference bar (`references/B-cold-industrial-sheet.jpg`, frame 3) is a
*used* floor — wet pavement with light structure, warm punctuations, evidence
of work.

## The change — one lever

**Rubble ridges along the lines where the deck came down** (`rubbleRidges` in
`src/render/fallground.ts`, called after `dressWreck` from `pushFallGround`):

- Per wreck piece, on the ground (GROUND_Y + 0.045), two beds of pale concrete
  fines — `tintOf(CONCRETE, 1.56–1.70)` and `1.30–1.42` (bodies' flanks
  1.52–1.64) — running along the piece's long axis (bed length 1.3–1.55×
  halfX, wider on the 3 `body` flanks), 3–5 dark chunks (`0.42–0.72`) thrown
  over them, 1–2 rebar rods. Attempt 1 carried 1.34–1.44 / 1.16–1.26 with
  chunks 0.64–0.94 and read fainter than the crust; the tones were pushed
  apart between the two captures and the push measured as a **dead end** (the
  tonemap shoulder already capped the pale end) — the reason the attempt-2
  tones are kept is that they are the slightly cleaner of two floor tones, not
  because they moved the read (see the saturation finding).
- The side offset shrinks with `cos(tilt)` (a tilted plate's edge lands inside
  its own footprint); grid-frame flood test skips points inside flooded
  patches, protecting the accepted pool; own rng stream (dressWreck's seed xor
  `SALT`, so the two passes never replay each other's draws).
- Inherits `pushFallGround`'s `lod < 2` gate — near-field detail, exactly like
  the dressing it completes.
- **No new ground class, no ABI change, no shader edit, no light, no crowd
  obstacle.** The lamp, bracket, pool material and `POOL_GAIN` are settled and
  untouched.

## Pre-registered predictions (locked before any capture)

Capture budget: **2** (predicted use: 1 sequence run). Predictions:

1. **Tri ledger** (`__probe_fallground.ts`): new ground tris citywide ≈ ≤16k;
   mean/chunk 1,903 → ≤ ~2,520; winding stays 0.
   — MEASURED: **68,092** citywide, **+16,722**, mean **2,522**, winding **0
   of 68,092**. The estimate missed by ~4%: rebar rods cost 12 tris each
   (cylinder caps), not the 6 I projected for a 3-segment beam. Recorded, not
   fudged; the pose-20 g-buffer delta below is the number that matters.
2. **Light ledger**: lamps stay 104, no new light, starved 0. — MEASURED
   104 ✓ (probe).
3. **Pose 20 g-buffer**: 1,329,716 triangles at 3n → ≤ 1,349,000 (+ ≤ 19.3k;
   the yard's near field carries every in-frustum ridge). **RECAST, then
   MEASURED.** The 1,329,716 anchor proved rig-dependent — a bare `--eval`
   rig settles pose 20 at **1,041,848** at 3n regardless of tier/shadow
   weather or settle length (220 rAF frames, residentChunks 114, identical
   to the digit across all three runs; the capture-context bake that produced
   1.33 M is not reachable from `--eval`). Falsified honestly by A/B instead:
   the round stashed, identical rig — 3n **1,041,848** → 3o **1,044,488** =
   **+2,640 in-frame**. Bounded and small: the drift is two in-frustum slabs'
   worth of boxes; everything further is culled. ✓ (as an A/B delta).
4. **New readables**: ≥ 3 NEW cold components (≥ 40 px, centroid ≥ 25 px from
   every `baseline.json` centroid) in the yard band x 250–1300, y 560–780,
   where the 3n baseline has 7 components and **none in x 250–900**.
   **MEASURED: attempt 1 = 4 ✓ / attempt 2 = 2.** Attempt 1 (01-36-05): before
   7 → after 11, NEW at **(488,594)** n 46 — the first readable mass the left
   yard has ever carried — and (1198,759) n 62, (1215,767) n 56, (1234,775)
   n 68 at the pool flank. Attempt 2 (01-43-45): before 7 → after 10, NEW at
   (1296,673) n 52 and (1212,766) n 40 only. The drop is the metric's window,
   not visibility: the brighter beds exit 40–95 luma **from above**; the
   tone-blind footprint check (below) grows with the brighter tones.
5. **Pool preserved**: peak lift at y 730–739 vs 3j (`shots/2026-10-22T07-21-31`)
   stays ≥ +45. The flood skip keeps ridges out of the patch. **MEASURED:
   +51.9 ✓ both attempts** (attempt 1 peak on row 733, attempt 2 on row 730;
   every row ≥ +51.0) — and **vs 3n: −0.1 … +0.1**, i.e. the strip is
   unchanged to read-out precision: the pool, its ripple and `POOL_GAIN`
   are untouched.
6. **Wall band unregressed**: x 1480–1600, y 500–600 warm share within ~1.5 pp
   of 3n (nothing in this round touches the face). **MEASURED: attempt 1
   3.23% → 3.25% (+0.03 pp); attempt 2 3.23% → 3.23% (+0.01 pp). ✓**
7. **Controls flat**: poses 16–19 warm shares within 0.03 pp of 3n; pose 18 is
   the risky one only if rubble leaked into far LODs — it cannot: `lod >= 2`
   returns early. **MEASURED ✓ — attempt 1: 16 +0.000, 17 +0.001, 18 −0.002,
   19 −0.000 pp; attempt 2: 16 +0.001, 17 +0.000, 18 +0.009, 19 +0.001 pp.**
8. **Run health**: tier uniform (`medium` everywhere — the mixed-tier gate
   FAILs otherwise), no GPU/WGSL error, frame time within noise of 3n's.
   **MEASURED ✓ — both runs PASS 5/5 at q:medium, `starved 0` in every
   pose's light delivery, `error: null` throughout; per-pose shot times
   8.2–14.0 s vs 3n's 7.5–14.6 s; wall clock 59.0/59.3 s per run.**

## What was run before any capture

`./node_modules/.bin/tsc --noEmit` — clean. `npx vite build` — clean.
`vite-node src/render/__selftest_fallzone.ts` — **VIOLATIONS none**.
`vite-node src/render/__selftest_ground_contract.ts` — **GROUND CONTRACT ALL
PASS**. `node tools/__selftest_hygiene.mjs` — **ALL PASS**. Platform: disk
11 GB free (98%, tight but above none), `shots/` 556 MB, swap 1.0/2.0 GB used.

## Wait — how the ledger is measured

`src/render/__probe_fallground.ts` bakes the zone the way the renderer does
(`pushFallChunk` + `pushFallGround` at lod 0, all 27 chunks) and prints the
per-chunk triangle ledger, the lamp count and a winding check against the
authored normal. Before this round it printed 51,370 / mean 1,903 / max 4,206
with 104 lamps; after, 68,092 / 2,522 / max — see §Predictions.

## The saturation finding — why tone cannot carry this read

The budget was 2 captures and both were spent, by design (the planning
paragraph predicted "tolerably 1, plausibly 2"). Between them the bed tones
were pushed apart (1.34–1.44 → 1.56–1.70, 1.16–1.26 → 1.30–1.42; chunks
0.64–0.94 → 0.42–0.72) to clear the crust's value band. The delta measurement
(pose 20's yard band x 250–1300 / y 560–780, after-luma minus before-luma —
the beds are the only value this round writes anywhere):

| attempt | bed tint | footprint (Δ ≥ +12) | share of band | mean bed lift | crust modulation |
| --- | --- | --- | --- | --- | --- |
| 1 (01-36-05) | 1.34–1.44 | 3,467 px | 1.50% | **+15.1** | ±24.8 |
| 2 (01-43-45) | 1.56–1.70 | 4,214 px | 1.82% | **+15.2** | ±24.9 |

A ~15% brighter input tint bought **+0.1 display luma**: the tonemap shoulder
saturates the pale end — the same compression shape the 3l lamp-intensity
rounds hit. Chunk-footprint (Δ ≤ −12) reads 3,731 → 3,508 px, same story. So
the read is pinned where it is: beds sit ~+15 above a crust that modulates
±25 of its own, covering ~1.5–1.8% of the band, and both sit inside the
crust's value range. **The ridges are real and findable (P4's components),
but the yard's surface story is still the old city's printed paving, not the
fall.** The residual levers are not tone: chunkier silhouettes (a geometry
round) or the owner-level re-tag of the zone's ground under the fall — the
paving families `citygen` still prints there are an ABI/contract call (a new
ground class shape), explicitly NOT this round.

## One trap, named and closed

Mid-review I believed the compare grid's REFERENCE column showed foreign
watermarked images ("Inicio Delta Leasy"). At 1:1 the row-5 reference cell is
the curated `references/B-cold-industrial-sheet.jpg` itself — the 2×2 of the
four section-B frames carrying only the source videos' small "茗Debussy"
watermark; at the grid's 520×285 cell size the watermark glyphs smear into
what looks like foreign UI text. The four files in
`references/sections/B-cold-industrial/` are all legit section-B frames and
`shots/reference/` (the video-extract cache) does not even exist yet. **No
corruption, no tooling bug** — the lesson is the PROCESS one: judge reference
cells at 1:1 or not at all.

## Evidence index (what a reviewer opens, in order)

1. `shots/compare/2026-10-23T01-45-44.png` + `...44.txt` — the canonical
   grid: BASELINE (3n, `11-09-19`) | CURRENT (attempt 2, `01-43-45`) |
   REFERENCE (section B sheet per `--auto`), tiers medium/medium, row 5 =
   pose 20, the floor pose.
2. `references/B-cold-industrial-sheet.jpg` — the section-B bar.
3. Full frames: `shots/2026-10-23T01-43-45/20-fall-ground-level.png` (current)
   vs `shots/2026-10-22T11-09-19/20-fall-ground-level.png` (before).
4. Close pairs (before above, after below, seam = light rule):
   `pairA2_slab_left.png` (x 250–720 / y 500–700, 2×), `pairB2_centre_right`
   (x 1040–1320 / y 640–820, 2×), `pairC2_yard_wide` (x 140–1330 / y 560–820,
   1:1) — under the round's work dir (`/tmp/opencode/3o/`), plus the attempt-1
   set (`pairA/B/C_*` from `01-36-05`).
5. `_capture.json` in each run dir — tier, errors, starved, per-pose ms.
6. `src/render/__probe_yard20.ts` — the census harness this round started
   from (committed with the round); `src/render/__probe_fallground.ts` — the
   tri/light ledger probe.

## Verification battery at the committed state

`tsc --noEmit` clean · `vite build` clean (`✓ built`, the chunk-size advice is
pre-existing) · `__selftest_fallzone.ts` **VIOLATIONS none** ·
`__selftest_ground_contract.ts` **GROUND CONTRACT ALL PASS** ·
`__selftest_hygiene.mjs` **ALL PASS** · tri ledger 68,092 / mean 2,522 /
winding 0 / lamps 104 after the tone pass (tones move no triangles).
Capture budget: **2 of 2 used.**

## §6 close-out (implementer's write; VERDICT is not here on purpose)

- **EVIDENCE:** the grid + sidecar above; pool rows (vs 3j max +51.9, vs 3n
  ±0.1); 4→2 new cold components (attempts 1→2), footprint 3.5k→4.2k px,
  bed lift +15.1→+15.2 vs crust ±24.9; g-buffer A/B +2,640 at pose 20;
  +16,722 citywide ground tris (mean 2,522); controls ≤0.009 pp; wall
  +0.01 pp; 104 lamps, starved 0, winding 0, tier uniform medium ×2 runs.
- **JUDGED:** the rib lines now exist on the fall's ground lines where pose
  20 looks, derived strictly from the wreck pieces and the flood skips
  preserve everything accepted. The changes are bounded, night-cheap, and
  the pool / wall / lights / controls confirm no regression anywhere.
- **GAP (honest):** the yard does not yet read as a place. The floor's
  dominant surface is still the old city's printed paving; the beds'
  +15 luma loses to the crust's ±25 modulation, and the tonemap shoulder
  makes further tonal pushes dead ends (measured, two titres). Coverage of
  the band is ~1.5–1.8%. The arc's remaining lever for the READ is
  geometry-scale (chunkier ridge silhouettes) or the owner-level ground
  re-tag; both are next-round-or-owner questions, not fixes inside this
  round's scope.
- **NEXT (proposed, for the reviewer to weigh):** (a) verdict on whether the
  ribs at this tone earn their 16.7k tris or should flex darker/sparser;
  (b) the geometry-vs-retag decision on the floor pattern, which needs an
  owner call on `citygen`'s zone ground; (c) pose 17/19 checks for ridge
  reads at their distances before any further spend.
- **VERDICT:** *assigned by a fresh reviewer in
  `docs/VISION_FALL_BASELINE.md` (PART 21) — this file deliberately does not
  contain it.*
