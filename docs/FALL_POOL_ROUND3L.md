# Fall pool, round 3l — the lamp's own strength, and where that lever stops

**Implementer:** fall-lamp. **Date:** 2026-10-22. **Subject:** the work lamp's pool on
pose 20's floor. Round 3j changed the flooded low's material and the floor got
lighter and less blue, but the second reading of PART 17 split that change: the
albedo rise contributes a flat +11 to +14 luma and +17 R-B across the whole
strip, and the lamp only +2 to +3 luma and +5 to +7 R-B on top. The floor was
paint with a lamp tint. This round raises the lamp.

**The verdict is the reviewer's.** This document records what was changed, what it
cost, and what it measured. It does not claim the acceptance is met.

---

## 1. The change

One constant, in `src/render/fallground.ts`:

```ts
-const LAMP_INTENSITY = 2.2;
+const LAMP_INTENSITY = 6.6;     // three times
```

`LAMP_RADIUS` (10), the pool term in `src/shaders/lighting.wgsl`, the bracket,
the material (`WATER`, `PATCH['flooded']`) and every other file are untouched.
`LAMP_INTENSITY` reaches only the fall zone's own work lamps — the winch houses,
the workshops, the stair towers, the core stairs, the ropeway huts — and it scales
a lamp's brdf contribution and its pool term together, which is what a brighter
lamp should do.

`POOL_GAIN` was **not** touched. It is global: every street lamp's pool in every
frame already judged moves with it, which is the trap round 3j deliberately
avoided.

## 2. How the intensity was chosen: three measured runs, not arithmetic

The tonemap (`common.wgsl`, an ACES-ish curve) is compressive, so the response
is not linear in the intensity. The first candidates were modelled by inverting
the tonemap on round 3j's own transect; **the model over-predicted** (+13 luma
centre lift at 6.6 against +42.9 measured, in sign but not in shape), so the
candidates were measured on the frame. Three sequence runs, each with
`_capture.json`:

| run | intensity | what it is |
|---|---|---|
| `shots/2026-10-22T06-07-15` | 2.2 (pre-3j material) | the baseline the second reading used; 1200x675, so its pixels are read at 0.75x |
| `shots/2026-10-22T07-21-31` | 2.2 (post-3j material) | the pre-3l state, and the reference for this round's lift |
| `shots/2026-10-22T08-03-24` | **6.6** | the shipped value |
| `shots/2026-10-22T08-08-59` | 8.8 | the second doubling |
| `shots/2026-10-22T08-12-59` | 17.6 | the third doubling (8x) |

**One correction to the brief.** It names `shots/2026-10-22T06-57-22` as the
same-camera baseline "1200×675 scaled ×4/3". That frame is **1600×900** (its
`_capture.json` and the PNG agree), and its transect is within 1 luma of the
`06-07-15` frame the second reading actually used (40.3 against 39.3 at the
leftmost column, 47.7 against 47.7 at the centre) — the two runs differ by the
eye height (2.211 m against 2.0016 m), not by the framing. The table in §3 uses
`06-07-15` at its own 0.75x pixel scale, which is the frame the second reading
measured, and the shipped comparison is against `07-21-31`, the pre-3l state at
1600×900 with the same camera and fov as the new run.

## 3. The transect, and the acceptance's metric

Method: the second reading's transect — 20-px columns, `y 715-760`, strip
`x 1300-1600`; the centre is `x 1400-1500`, the lateral edges `x 1280-1330` and
`x 1560-1599`. The lift is against the pre-3l state (`07-21-31`).

| col (after coords) | pre-3j luma | 3j luma | **3l (6.6)** | 3l (8.8) | 3l (17.6) | 3l R-B (6.6) |
|---|---|---|---|---|---|---|
| 1280-1299 | 39.3 | 50.8 | 87.2 | 99.6 | 132.5 | +13.7 |
| 1300-1319 | 42.1 | 54.5 | 93.7 | 106.6 | 139.7 | +18.8 |
| 1320-1339 | 45.0 | 57.4 | 98.6 | 111.7 | 145.0 | +23.1 |
| 1340-1359 | 46.4 | 59.5 | 102.1 | 115.7 | 148.7 | +26.6 |
| 1360-1379 | 47.1 | 60.4 | 103.0 | 116.3 | 148.4 | +28.1 |
| 1380-1399 | 46.0 | 59.7 | 101.3 | 114.2 | 145.0 | +28.7 |
| 1400-1419 | 46.8 | 60.4 | 102.5 | 115.3 | 145.7 | +29.8 |
| 1420-1439 | 47.3 | 60.8 | 103.1 | 115.7 | 145.8 | +30.4 |
| 1440-1459 | 46.8 | 60.5 | 102.8 | 115.4 | 145.2 | +30.6 |
| 1460-1479 | 48.8 | 62.6 | 106.6 | 120.0 | 151.5 | +32.2 |
| 1480-1499 | 48.7 | 62.8 | 106.5 | 119.7 | 150.8 | +31.0 |
| 1500-1519 | 47.8 | 62.0 | 105.1 | 118.2 | 149.0 | +30.4 |
| 1520-1539 | 46.7 | 60.2 | 102.5 | 115.5 | 146.0 | +29.4 |
| 1540-1559 | 44.9 | 58.2 | 99.2 | 112.0 | 142.3 | +27.8 |
| 1560-1579 | 42.4 | 55.6 | 95.2 | 107.9 | 138.1 | +25.5 |
| 1580-1599 | 40.9 | 53.4 | 92.0 | 104.5 | 135.2 | +23.2 |

**The lift, and the acceptance's differential (centre lift − edges lift):**

| intensity | centre lift | edges lift | **differential** | acceptance |
|---|---|---|---|---|
| 2.2 (3j vs pre-3j) | +13.7 | +12.4 | +1.3 | ≥ +8 |
| **6.6 (shipped)** | **+42.9** | **+39.0** | **+3.9** | ≥ +8 |
| 8.8 | +55.8 | +51.7 | +4.1 | ≥ +8 |
| 17.6 | +86.4 | +83.7 | +2.7 | ≥ +8 |

**The differential saturates at about +4 and then falls.** The reason is
mechanical, and it is why this lever cannot reach +8:

1. **The same light's brdf term is broad.** The lamp's `LAMP_RADIUS` is 10 m and
   its brdf contribution falls off smoothly; the transect's "lateral edges" are
   only 0.7-3.5 m from the head's ground position, well inside that reach, so
   they are lifted almost as much as the centre. The stylised pool disc (radius
   `drop x 0.95` = 3.18 m) is the local part; the brdf is the broad part, and
   both scale with this constant.
2. **The tonemap then compresses what is left.** The strip's mean luma is 48.1 at
   I=2.2, 82.2 at 6.6, 93.3 at 8.8 and 121.3 at 17.6 — the whole band climbs
   into the shoulder, and the centre-to-edge difference stops growing
   (absolute bump: 7.1 → 11.0 → 11.2 → **9.7**).

**So: the acceptance's "+8 luma above the strip's flat lift" is not reachable
with `LAMP_INTENSITY` at any intensity this lever allows.** The remaining lever
is a **per-light pool gain** — the pool term's multiplier as a per-light value
rather than a global `POOL_GAIN` — which is a WGSL uniform-struct ABI change, a
bigger decision than this round, and it belongs to the orchestrator.

### What the round did achieve, on the same numbers

- **The lamp now carries the change.** The centre's lift is +42.9 of the +56.8
  total against the pre-3j baseline: **~75 %** of the visible change is the
  lamp, against 15-25 % in the second reading. The second reading's criterion
  ("the lamp contributes more than half of the strip's luma lift") is met.
- **The strict warm count went from 1 px to 10,526.** The strip
  (`x 1300-1600, y 700-760`) carries **10,526 warm px in 6 components, the
  largest 10,516 px at bbox x 1300-1599, y 720-759** (was 1 px at
  x 1430, y 737), and the strip's max R-B went **+18 → +59 at (1447, 723)**.
  The strip's mean luma is 82.2 and its mean RGB (93.4, 79.3, 74.0), against
  48.1 and (47.1, 40.3, 56.7) before this round.
- The lamp's hue signature is now a profile, not a wash: the strip's R-B runs
  +13.7 at the left edge, +30 to +32 across the centre columns, +23.2 at the
  right edge.

## 4. The wall, which does not clip

The band the round names, `x 1480-1600, y 500-600` (the tower face the lamp
washes), and the hut's own wall, `x 1350-1470, y 500-600`:

| | pre-3j (2.2) | 3j (2.2) | **3l (6.6)** | 3l (8.8) | 3l (17.6) |
|---|---|---|---|---|---|
| band max R-B | 134 at (1180, 393) | 145 at (1574, 528) | **134 at (1574, 528)** | 127 | 124 |
| band px at R ≥ 250 | 0 | 0 | **0** | 0 | 0 |
| band px at R ≥ 248 | 0 | 0 | **0** | 0 | 0 |
| band max R | 213 | 214 | **214** | 214 | 214 |
| band mean RGB | (43.7, 33.8, 41.6) | (46.1, 34.7, 42.2) | **(77.9, 58.7, 51.7)** | (89.8, 68.4, 56.0) | (122.6, 98.0, 71.7) |
| hut wall max R-B | 43 | 42 | **66 at (1388, 520)** | 70 | 77 |
| hut wall px at R ≥ 250 | 0 | 0 | **0** | 0 | 0 |
| hut wall max R | 93 | 94 | **153** | 169 | 199 |
| hut wall mean RGB | (44.9, 34.3, 38.6) | (49.4, 37.2, 39.7) | **(97.8, 76.4, 58.1)** | (113.7, 91.0, 66.4) | (151.8, 130.2, 95.3) |

**No pixel reaches 250 in any of the five frames, in either band, at any
intensity.** The band's max R-B and max R are the same old-city lit window in
every frame (the lamp does not move it); what the lamp changes is the band's
mean, which roughly triples at the shipped value. The hut's own wall takes the
brighter lamp well (max R 153 at 6.6, 199 at 17.6) and still does not clip.

The wall not clipping is why the lever was pushed to 8x at all: the wall was
never the binding constraint, the tonemap's shoulder is.

## 5. Controls — nothing leaked

Whole-frame warm share, before (the pre-3l state, `07-21-31`) → after:

| pose | 3l (6.6) | 3l (8.8) | 3l (17.6) |
|---|---|---|---|
| 16-fall-wreck-up | warm 0.115 % → **0.115 %** (±0.000), warm-bright 0.016 % → 0.015 % | 0.115 % → 0.115 %, 0.016 % → 0.016 % | 0.115 % → 0.114 %, 0.016 % → 0.016 % |
| 17-fall-piles-level | 0.287 % → 0.293 % (+0.007) | 0.287 % → 0.288 % | 0.287 % → 0.272 % |
| 18-fall-skyline | 1.335 % → 1.340 % (+0.004) | 1.335 % → 1.361 % (+0.026) | 1.335 % → 1.346 % (+0.011) |
| 19-fall-pile-close | 2.076 % → 2.077 % (+0.001) | 2.076 % → 2.075 % | 2.076 % → 2.053 % |
| 20-fall-ground-level | 3.015 % → 5.903 % (+2.888) | 3.015 % → 6.862 % | 3.015 % → 9.950 % |

**16 is flat to the digit and 17 and 19 move by ≤0.01 pp** (crowd drift). Pose
18 moves by +0.004 pp at the shipped value — the zone's other work lamps, 200 m
away, now register a little more; at 8.8 that is +0.026 pp and at 17.6 it is
+0.011 pp (the shoulder again). That +0.026 pp is one of the reasons 6.6 is
shipped rather than 8.8.

Pose 20's own +2.888 pp is the pool, and it is the frame's own subject.

## 6. The shipped run and its `_capture.json`

**Run directory: `shots/2026-10-22T08-03-24/`** (I = 6.6) — sequence, 5 fall
poses + `_contact-sheet.png`, 62.3 s, PASS. `_capture.json` present, so every
frame has provenance (PITFALLS §38).

| pose | error | held fov | eye y | lights del/binned/starved | triangles | g-buffer triangles | frameMs | lod | PNG |
|---|---|---|---|---|---|---|---|---|---|
| 16-fall-wreck-up | null | 1.01078 | 2.056 | 1222 / 1222 / 0 | 3,936,443 | 1,070,700 | 133.26 | [9, 28, 97, 0] | 1600x900 |
| 17-fall-piles-level | null | 1.07012 | 152.00 | 1133 / 1133 / 0 | 3,670,377 | 944,022 | 137.80 | [9, 28, 100, 0] | 1600x900 |
| 18-fall-skyline | null | 1.04782 | 122.97 | 1405 / 1405 / 0 | 4,902,569 | 1,295,026 | 132.02 | [9, 34, 124, 0] | 1600x900 |
| 19-fall-pile-close | null | 1.06973 | 151.98 | 1133 / 1133 / 0 | 4,798,223 | 2,027,940 | 139.80 | [9, 34, 124, 0] | 1600x900 |
| 20-fall-ground-level | null | 1.07542 | 2.078 | 1133 / 1133 / 0 | 5,089,903 | 1,328,996 | 139.86 | [9, 34, 124, 0] | 1600x900 |

No GPU/WGSL error in any shot; `error` is null on all five. **The light counts
are unchanged** (1222/1133/1405/1133/1133, starved 0) — this round changes a
light's strength, not how many there are. **The g-buffer triangle counts are
identical to the pre-3l run's to the digit** (1,070,700 / 944,022 / 1,295,026 /
2,027,940 / 1,328,996) and to the 8.8 and 17.6 runs' — the change is a number
in a light, not geometry. The total-triangle differences (pose 19: 4,798,223
against 4,305,355 in `07-21-31`; pose 20: 5,089,903 against 4,261,575) are the
crowd and traffic dither between runs, as in every previous round; the g-buffer
numbers are the geometry. The harness's frame times (132-140 ms) are a headless
artefact and D32's 30 fps floor is not testable here.

## 7. Verification

```
./node_modules/.bin/tsc --noEmit                 -> clean, no output
npx vite build                                   -> ✓ built in 768ms
npx vite-node@6.0.0 src/world/__selftest_fallzone.ts
    -> VIOLATIONS none
npx vite-node@6.0.0 src/render/__selftest_ground_contract.ts
    -> GROUND CONTRACT ALL PASS: every open-air counter is supported; repeated traces do
       not duplicate geometry; emitted hero subjects use the live seed
```

Preflight: **OK** at every capture (mem-unused 816 / 2137 / 2097 MB, disk 12.9 GB,
no BLOCK). No capture was running when any of the three was started.

## 8. What this round did NOT do, and did NOT verify

- **The verdict.** The reviewer's, against this round's acceptance (a local bump
  of +8 luma above the strip's flat material lift, and a wall that does not
  clip). The wall does not clip; the bump measures +3.9, and §3 shows why no
  intensity this lever allows reaches +8. Whether +3.9 with a 10,526-px warm
  patch and a lamp that now carries 75 % of the change carries the round is not
  mine to say.
- **A per-light pool gain.** The measured finding is that the global pool term
  cannot be sharpened per lamp; giving the fall zone's work lamps their own
  pool gain is a WGSL uniform-struct ABI change (the `Light` struct is packed at
  8 floats in `lightbin.wgsl` and read in `lighting.wgsl`), which is a bigger
  decision than this round and belongs to the orchestrator. Not attempted.
- **`POOL_GAIN` / `lighting.wgsl`.** Untouched, deliberately: it is global, and
  every street lamp's pool in every frame already judged moves with it.
- **The material, the bracket, the head's position, `LAMP_RADIUS`.** Untouched;
  PARTS 13, 14 and 17 settled them.
- **The water's specular** (PART 10's deferred clause) — still not delivered, and
  still refuted as a roughness route by `FLOODED_LOWS_SPIKE.md`.
- **The other fall-zone work lamps.** `LAMP_INTENSITY` is shared by all 104 of
  them (the winch houses, the workshops, the stair towers, the core stairs, the
  ropeway huts), so they are all 3x brighter. Their walls and pools move with
  the lamp they belong to. Only pose 20's hut is measured here; pose 18's
  +0.004 pp is the only zone-scale evidence that the change reached them.
- **The read.** Whether the floor now reads as a lamp's pool on wet mud, or as
  an over-lit warm sheet, is a judgement on the frame and it is the reviewer's.
  The numbers say the band is at luma 82 with a +59 R-B peak and a +30 R-B
  profile across the centre columns; the sheet-B ground-level reference is
  `references/B-cold-industrial-sheet.jpg` frame 3.
- **The city's other flooded lows, the ground pass, the lifelines, the rubble,
  and round 3g's lit-row count (5 of 6, closed separately)** — not re-judged.
- **The harness's frame times** are a headless artefact, as in every round.
