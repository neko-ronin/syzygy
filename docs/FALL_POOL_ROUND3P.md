# Fall ground, round 3p — the yard needs light

**Implementer's record (fall-lamp, revived). The frames are the reviewer's to
judge; this file says what changed, what it cost, and what the pre-registered
predictions were. No VERDICT here — the 3p review comes from an agent that did
not implement this round (PART 21's lesson, kept as governance).**

## §1 Where this round came from

PART 22 (`src/../../docs/VISION_FALL_BASELINE.md`, lines 4241+) refuted 3o's
tonemap diagnosis with a falsifier — the hut wall moved 79 % → 23.6 % warm on
albedo changes *under a lit lamp* — and found the real cause: **the yard is
unlit**. The beds 3o committed sit beside slabs 51–60 m out, and the measured
illumination census says nothing reaches them:

- in-frustum warm sources: 2 — id54's bracket lamp at **13 m** and id27's
  stair-tower lamp at **152 m**; both `LAMP_RADIUS` 10 m. The beds are 38–47 m
  beyond the nearest lamp's reach;
- the midground lamps (id55 winch+workshop at 62.7 m, id52 at 90.9 m) are
  **behind the camera** and in no screen tile's bin — they are not delivered;
- sun elevation −0.103 (below horizon, zero contribution); emissive surfaces
  are self-only in `lighting.wgsl` — they glow, they do not illuminate;
- so the beds are lit by ambient alone (`[0.02, 0.07, 0.32]` × 0.8), and a
  1.56× albedo under fixed light gives a fixed ratio: the measured +15.2 luma.

Part 22's instruction for this round: *one light in the yard's midground*, on a
fixture plausible in the world — or, if the midground has no structure to hang
a light on, say so and propose the smallest honest fixture.

## §2 What the midground actually contains — and the finding

The committed census (`src/render/__probe_yard20.ts`) plus the 3p design probes
(temp `probe_p23/p24/p25.ts`) enumerate pose 20's midground (depth 20–70 m)
exhaustively. Structures standing **in frustum**:

| item | depth | screen | lamp reach? |
| --- | --- | --- | --- |
| id54 lattice column (access=winch) | 21.8 m | px (1202, 640) | 22 m short of the beds |
| id53 pier (access=none) | 35.9 m | off-band left | a bare pier, 15 m short |
| slab #44 (511.6, −474.3) half 10.1/1.2/9.1 tilt 0.58 | 51.2 m | px (743, 518) | **is** at the beds |
| slab #43 (485.2, −448.4) half 5.6/1.2/6.3 tilt 0.30 | 60.7 m | px (322, 564) | is at the beds |

The standing structure tops out at 21.8 m; the beds run at 51–61 m. With
`LAMP_RADIUS` closed at 10 m, **no existing structure's lamp reaches the beds —
that is the finding.** Off-screen hosts are refused by the engine itself (no
tile bin, no delivery). The only structure *at* the beds is the wreck. So the
smallest honest fixture hangs on the wreck: a salvage clamp-light on the fallen
deck — the crew lighting the cut they are stripping. Not a mast.

## §3 The fixture — rule and build

**Rule** (world-true, deterministic, evaluated zone-wide in `fallChunk()`,
materialized chunk-level; never reads a pose or a camera):

1. **core** = the flooded patch nearest the zone's grid origin →
   (579.0, −439.9) half 48×48 (origin-d 721.6 m; the other four flooded
   patches sit 1,373–2,328 m out).
2. **host** = the winch-access column nearest the core's centre →
   **id54** (544.6, −473.6), core-d 48.1 m (next nearest winch ~107 m).
3. **cut** = the wreck piece nearest the host column →
   **slab #44** (511.6, −474.3), d 33.0 m (next 39.2 m).

Exactly one fixture exists citywide. Id54's winch is the station that serves
the yard's flooded low, and the cut it serves is the slab pose 20 looks at —
that it lands in the round's frame is a measured **consequence** of the rule,
not its premise.

**Build** (additive; internal interface only — `FallChunk` gains a `salvage`
datum; uniform ABI untouched): clamp bracket bolted to the slab's tilt-down
long edge (edge y ≈ 1.35 m), arm ~1.0 m out over the bed (bed line 8.2 m
laterally from the centreline; the edge footprint sits at 7.6 m), head ~1.1 m
above the edge → head y ≈ 2.46 m. A thin cable runs down the deck edge.

**Light**: registered on its **own channel — not `lamp()`'s MAX_LAMPS
counter**, because the fixture's chunk (256, −512) holds est. 7 lamp-calling
columns/stations against a cap of 6 (one lamp is silently dropped today; a
cap-respecting push would be silently dropped too). Own intensity **4.4**
(deliberately below the hut's closed 6.6), radius `LAMP_RADIUS` (10) reused
as-is, `LAMP` colour. Emissive head follows the `lamp()` idiom.

At pose 20 (probe p25, validated to the census's own px to the pixel): head at
px (660, 573), depth 43.4 m; ground pool centre at px (639, 610); the lit disc
spans px x ≈ 490–780, y ≈ 606–616 — in the yard band, at the slab's low flank.

## §4 Cost predictions (pre-registered)

- lights delivered, pose 20: **+1 exactly** (one fixture, in frustum; citywide
  delivery 1,133–1,222 vs cap 3,072 gains at most this one).
- g-buffer triangles: **+≤600** in the fixture's chunk (clamp, bracket, head,
  cable — few boxes), against pose 20's existing g-buffer load.
- frame ms: **Δ ≤ +2 %** on pose 20's mean (one more pooled light in one tile
  pass; shader work is bound by the delivery count).
- `MAX_LAMPS`, `LAMP_INTENSITY`, `LAMP_RADIUS`, the hut lamp, the pool and its
  material, the wall: **untouched**.

## §5 Pre-registered gate (numbers locked before any capture)

Frame under test: `20-fall-ground-level` from `--sequence` runs pinned to
`--quality=medium`. Baselines: 3n `shots/2026-10-22T11-09-19`, 3j
`shots/2026-10-22T07-21-31`. **Luma is the plain RGB mean `(r+g+b)/3`. Warm is
`R > 120 && R > 1.6 B`.**

1. **Source-lit patch with a falloff transect** (band x 250–1300, y 560–780):
   - warm components in the pool region **x 490–780, y 595–640**: 0 at 3n →
     **≥ 1** at 3p;
   - lit peak pocket **x 600–680, y 605–615** mean luma: 12.6 at 3n →
     **≥ 27.6** (+15); it must also exceed the ambient-left reference (19.6);
   - **falloff, not a uniform lift**: lit peak above *both* unlit pockets
     (x 420–460: 19.3; x 810–850: 16.1 at 3n) by **≥ 8**; each unlit pocket
     moves **≤ +2.0** luma — the light must not become a wash.
2. **The beds findable at 1×** (the round's real question). Measurable proxy,
   3o's matcher (lo 40, hi 95, rb 30, minpx 40): cold comps in band **≥ 3n's
   count**, with **≥ 2** persisting within 25 px of 3n centroids. Plus the eye
   record, stated in the results and judged by the reviewer: at 1×, without
   being told, can a fresh eye locate the beds? (A cold-silhouette read —
   rubble against lit ground — is accepted; that is likely the reference's own
   mechanism.)
3. **The accepted pool survives**: peak lift y 730–739 vs 3j **≥ +45** (3n's
   own: +52.0, row 733); max row unchanged.
4. **The wall band does not move**: x 1480–1600, y 500–600 warm share within
   ±1.5 pp of 3n's **3.23 %**.
5. **Controls 16–19 flat**: each within **0.03 pp** of 3n's 0.01 / 0.00 /
   0.23 / 0.06 %.
6. **Run health**: tier uniform (medium); 5/5 poses `error null`; no GPU/WGSL
   error (the capture harness fails the run on any); pose 20 mean frame ms
   within **+2 %** of 3n.

The band already holds **7** small warm components at 3n (flat slivers at
y 560–587, distant content). The fixture adds an 8th — the head — and, in the
pool region, the round's first. Band warm-comp count: 7 → 8.

## §6 Attempts and budget

Capture budget 2, both `--sequence`. Attempt 1: this design as specified.
Attempt 2 is reserved for **mechanical correction only** (the light missing a
transect/warm gate does not void the design — it points at intensity, and
intensity alone). `orchestrate.mjs preflight` before any capture; stop on
BLOCK. No verdict section is written here; the doc ends with the results and
the honest gap.

## §7 Results (attempt 1, run `shots/2026-10-23T03-00-54`)

Capture: **PASS — 29 shots, 545.5 s**, `--sequence --quality=medium
--timeout 900`. Two earlier spawns (`03-...02-43-16`, `02-52-29`) died on the
harness's **default global timeout (120 s)** mid-list, before any judged pose
(camera-irrelevant: both died at the same ~109 s seam transitioning into pose
05; the full sequence needs `--timeout 900`); both directories
(`2026-10-23T02-43-16`, `02-52-29`) were deleted. That invocation fault was
mine; the third spawn used the doc history's operative form.

### G1 — missed as registered; mechanism present; causes measured

- warm comps in the registered ROI (x 490–780, y 595–640): 0 → 0. **MISS**
  (gate ≥1). Over the light's *whole* footprint (x 460–800, y 580–650) it is
  also 0 → 0: the lit matte ground's diffuse R peaks at **79** (x 549);
  R>120 needs ≈ **6.7 intensity** (19.1 R-counts per unit), above the hut's
  closed 6.6 — and the accepted pool's own warm regime is 60 px of
  near-black water-glint (R med 131, **luma med 20**), specular physics a
  matte deck cannot borrow. The registered warm threshold and the closed
  "below the hut" ceiling cannot both hold for one matte-ground light. The
  head's emissive speck at 43 m also stays under the 40-px component floor —
  band warm comps *7 → 7* against the registered 7 → 8. **MISSES recorded.**
- peak pocket, registered (x 600–680, y 605–615): 12.6 → **20.2** (+7.7;
  gate ≥ +15 — MISS; the > 19.6 clause satisfied).
- registered falloff (+3.8 / +5.3 vs ≥8): **MISS**. Unlit pockets 19.2→16.4
  and 16.2→15.0 — downward −2.8 / −1.2 (run-to-run tonal wobble; the same
  scale the accepted pool's +1.5 row drift shows), no wash.
- **Cause: my ROI was mis-aimed, twice.** The measured brightest strip is
  **x 500–580** (bins 27/29 in the observed transect) and the pool's hot rows
  reach **y ≈ 585–600** — projection had the nadir at (639, 610), so the
  registered pockets sampled the wedge's dimmer right flank and its lower
  half. On the light's own strip **x 500–580, y 605–615: 17.0 → 28.0 (≈ +11)**;
  corrected peak ROI x 480–620: 16.4 → 24.5 (**+8.1**); falloff from the
  corrected peak **+13.1** and **+11.7** against both unlit pockets — the
  ≥ 8 shape the gate wanted, *present*, at the light's actual footprint.
  Transect profile (40 px bins, x 420–860):
  `16 21 27 29 18 21 19 12 11 12 15` — a pool with falloff from a point,
  ambient floor at both ends. This is the mechanism PART 22 asked for.

### G2 — measurable proxy PASS; eye record (mine, not the verdict)

Cold comps in band: **7 → 18** (count not down ✓); **10** persist within 25 px
of a 3n centroid (≥2 ✓). The lit ground *revealed* structure. At 1× (inspect
crops of both runs, x 400–880 × y 545–700 ×2, and the whole band ×1): the
midground now holds **one findable event** — the lit wedge behind the crowd
strip, the emissive head dot above it, **dark chunks visible inside the lit
floor**, standing figures reading backlit against the light. In 3n the same
view carries no value event between the forecourt and the distant village.
The wedge does not bloom into a disc (peak 28 ambient-corrected; the frame's
hottest ground belongs to the accepted pool).

Inspect crops, kept for the reviewer beside the compare grid:
`shots/compare/3p-p1_pool_band.png` (3n | 3p side-by-side, ×2),
`shots/compare/3p-p3_yard_wide.png` (whole band 3n | 3p, 1×),
`shots/compare/3p-p2_accepted_pool.png` (accepted-pool context), and the
compare grid `shots/compare/2026-10-23T03-18-37.png` (5 rows
`BASELINE | CURRENT | REFERENCE`, sidecar `.txt` alongside).

### G3 — PASS. vs 3j max **+52.5** (≥ +45 ✓); plateau rows 730–739 within
±0.9 of 3n; the max row drifts 733 → 739 inside that flat plateau (noise
scale).

### G4 — PASS. wall band 3.23 % → 3.44 % (**+0.22 pp** ≤ 1.5).

### G5 — PASS. Controls +0.002 / +0.001 / −0.007 / +0.000 pp — each ≤ 0.03.

### G6 — PASS. quality medium uniformly (29/29 `q:medium`); 5/5 fall poses
`error null`; no GPU/WGSL error anywhere (the harness fails the run on any);
frameMs on the five fall poses 125.1–130.9 vs 3n's 126.4–139.8 (mean −5.6 %,
i.e. the session's own pose-to-pose spread; pose 20: 139.8 → 130.9).

### Costs, actual

ground-pass triangles citywide **68,092 → 68,128 (+36**; pre-registered
≤ 600 ✓); registered lights **104 → 105 (+1**, own channel, exactly once ✓);
`MAX_LAMPS` untouched and the host chunk's own six cap-lamps register
unchanged (verified before and during: the chunk was already over-cap and
sweeping one lamp-call under it; the fixture's light rides **beside** the
cap, which is why it could not have gone through it); frame ms — the fixture
is invisible inside pose-time noise (G6 numbers above).

## §8 The honest gap, and what is handed to the reviewer

- **The registered G1 numbers miss as stated.** Recorded causes: the ROI
  mis-aim (mine — the projection under-positioned the pool ≈ 80 px in x and
  ≈ 15 px in y from the transect's true peak), a lift magnitude encoded
  from the accepted pool's specular regime rather than a matte work light
  (measured ≈ +8..+11, not ≥ +15), and a warm threshold that needs ≈ 6.7
  intensity — above the closed 6.6 ceiling — i.e. the registered warm clause
  and the round's own intensity bar cannot both hold for a matte-ground
  light.
- **No attempt 2 was spent chasing it.** The reserved correction (intensity)
  moves against the closed reference bar (2× light for the lift target, ≈
  1.55× for the warm target) and would put a ~200-luma pool into a frame
  whose reference news is *small points on a cold mass*. The correction
  lever exists if the reviewer judges the light should push harder — the
  fixture, the rule and the costs will not need to change for it.
- **What the frame gives**: a legible work place in a midground that had
  none — a lit wedge with a point-falloff transect (≈ 16 → 28 → 12 across
  ~440 px), crowds reading against it, chunked texture inside the pool —
  with the accepted pool (G3), the wall (G4), the controls (G5) and the
  unlit ground's exposure (G1's unlit-pocket clause) all held.
- **The beds at 1×** (my record; the verdict is the reviewer's): found as
  the dark-chunk texture inside the lit wedge and as cold silhouettes
  against it — the reference's own mechanism — while the rest of the yard's
  bed stretches stay ambient-lit, unchanged, as scoped for one light.

