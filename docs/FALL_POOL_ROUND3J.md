# Fall pool, round 3j — the flooded low's material, not the shader

**Implementer:** fall-lamp. **Date:** 2026-10-22. **Subject:** the work lamp's pool on
pose 20's floor. The pool term in `src/shaders/lighting.wgsl` multiplies the lamp's
colour by the fragment's albedo, so the surface under the lamp decides whether the
pool can be warm at all (PART 13 (b)). This round changes that surface's material and
nothing else.

**The verdict is the reviewer's.** This document records what was changed, what it
cost, and what it measured. It does not claim the acceptance is met.

---

## 1. What changed, and why

One file, `src/render/fallmesh.ts`, two colours:

| | before | after |
|---|---|---|
| `WATER` — the flood water's sheets (`pushFloodWater`) | `[0.034, 0.049, 0.062]` | `[0.118, 0.113, 0.104]` |
| `PATCH['flooded']` — the flooded patch's silt margin (its top face) | `[0.06, 0.08, 0.1]` | `[0.132, 0.126, 0.115]` |

Both were asphalt-dark and blue-biased: a colour that mirrors the sky rather than a
flooded low's own mud. A warm lamp multiplied by a blue-biased albedo adds a
blue-biased lift — PART 13 (b) measured the pool term's contribution on this floor as
R +0.030·disc against B +0.022·disc, a few points of luma and no warmth at all. The
new values are near-neutral and faintly warm: mud and shallow water over silt, which is
what a flooded low is.

**Untouched, deliberately:**

- `src/shaders/lighting.wgsl` — the pool term is global, and every pool in every frame
  already judged was taken against it.
- The bracket (`fallground.ts`), the head's position, `LAMP_INTENSITY`, `LAMP_RADIUS`.
- The geometry, the `+0.075 m` water lift, the `groundSurfaceTag('flood', ...)` tag and
  the class decode. The contract self-test is the guard for all of those and it passes.
- `gbuffer.wgsl`'s flood branch — see §6.

## 2. Why the second colour is in this round: the strip is the SILT, not the water

PART 13 (b) and the round's brief both say the floor strip in front of the hut is
flood water at `WATER = [0.034, 0.049, 0.062]`. **That is not what is under the lamp.**
`src/render/__probe_floodsurface.ts` (new in this round) ray-casts the baked fall chunk
and reports the surface and its authored colour:

```
pose 20's winch hut: column id54, b0 10.32, door face b 12.02
the floor 0-6 m in front of the door, and what is under it:
  +0.0 m  world 552.6,-464.6  ->  y=0.400 albedo [0.132,0.126,0.115] paving/board-formed
  +0.5 m  world 552.9,-464.2  ->  y=0.400 albedo [0.132,0.126,0.115] paving/board-formed
  +1.0 m  world 553.2,-463.9  ->  y=0.400 albedo [0.132,0.126,0.115] paving/board-formed
  ...                                          (all eight points to +6.0 m the same)
the water sheets, for comparison:
  water quad y=0.425  -> y=0.425 albedo [0.118,0.113,0.104] flood/asphalt
```

The strip is the flooded patch's **silt margin** — the patch's top face at
`GROUND_Y + 0.05`, tagged `paving`/`board-formed`, at `PATCH['flooded']`. The water
sheets are a different material (the `flood` class) and they are elsewhere: the
nearest water edge is **3.5 m in front of the door face and 3 m to the side** (local
b 15.56 against the door's 12.02), the rest 4-15 m away, mostly to the left of the
frame. The lamp's pool disc (drop 3.35 m, radius 3.18 m, centred 0.5 m in front of the
wall) reaches local b 15.70 — it *just* touches the water's edge, and the strip itself
is entirely silt.

So changing `WATER` alone would have been a null result on the acceptance: the water
is not where the lamp is. Both surfaces of a flooded low are authored here, with the
same reasoning, so the low reads as one material rather than as a dark blue sheet with
a differently coloured margin.

## 3. Verification (all clean)

```
./node_modules/.bin/tsc --noEmit                 -> clean, no output
npx vite build                                   -> ✓ built in 765ms
npx vite-node@6.0.0 src/world/__selftest_fallzone.ts
    -> VIOLATIONS none
npx vite-node@6.0.0 src/render/__selftest_ground_contract.ts
    -> GROUND CONTRACT ALL PASS: every open-air counter is supported; repeated traces do
       not duplicate geometry; emitted hero subjects use the live seed
npx vite-node@6.0.0 src/render/__probe_floodsurface.ts
    -> the surface table in §2
```

The contract self-test is the guard for the class, the decode, the branch's position in
the `groundSurface` chain and the `+0.075 m` lift; it passes, so none of those moved.

## 4. The run

- Preflight: **OK** (swap 0.77/2.0 GB, disk 13.0 GB, mem-unused 990 MB, load 1.81/8) —
  no BLOCK. The capture's own preflight: mem-unused 1022 MB.
- `node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence --pose=fall --timeout 900`
- **Run directory: `shots/2026-10-22T07-21-31/`** — 5 fall poses + `_contact-sheet.png`,
  61.4 s, PASS. `_capture.json` present, so every frame has provenance (PITFALLS §38).
- Baseline for the comparison: `shots/2026-10-22T06-07-15/` (round 3g's sequence run,
  the last healthy run) and `shots/2026-10-22T05-56-31-20-fall-ground-level.png`
  (round 3h's single shot).

### `_capture.json`, all five poses (run `07-21-31`)

| pose | error | held fov | lights delivered / binned / starved | triangles | g-buffer triangles | frameMs | PNG |
|---|---|---|---|---|---|---|---|
| 16-fall-wreck-up | null | 1.01158 | 1222 / 1222 / 0 | 3,933,847 | 1,070,700 | 132.90 | 1600x900 |
| 17-fall-piles-level | null | 1.07026 | 1133 / 1133 / 0 | 3,670,141 | 944,022 | 138.69 | 1600x900 |
| 18-fall-skyline | null | 1.04794 | 1405 / 1405 / 0 | 4,800,595 | 1,295,026 | 126.30 | 1600x900 |
| 19-fall-pile-close | null | 1.06976 | 1133 / 1133 / 0 | 4,305,355 | 2,027,940 | 139.62 | 1600x900 |
| 20-fall-ground-level | null | 1.07542 | 1133 / 1133 / 0 | 4,261,575 | 1,328,996 | 139.42 | 1600x900 |

**No GPU/WGSL error, no light-count change, no starved light.** The g-buffer triangle
counts are the baseline's to the digit (18: 1,295,018 → 1,295,026, +8; 19: 2,027,940 →
2,027,940, +0) — the change is colour only, zero geometry. The total-triangle
differences (18: −101,950, 19: −485,316) are the crowd and traffic dither between
runs, as in the earlier rounds; the g-buffer numbers are the geometry.

## 5. The measurements

### 5.1 The floor strip, x 1300-1600, y 700-760 (1-6 m in front of the door)

Warm = `R > B + 15 && R > 60`; "warm-leaning" = `R > B`, the looser test that catches
the pool's own colour where it is under the threshold; components are 4-connected.

| | BEFORE 05-56-31 (1600x900, fov 1.03364) | BEFORE 06-07-15 (1200x675, same camera+fov as the new run, rects at 0.75) | **AFTER 07-21-31 (1600x900)** |
|---|---|---|---|
| warm px | 0 | 0 | **1** (1 component: 1 px, bbox x 1430-1430, y 737-737) |
| warm-leaning px (R>B) | 0 in 0 components | 0 in 0 components | **3,364 in 82 components; largest 2,927 px, bbox x 1317-1527, y 721-748** |
| max R-B | −4 at (1484, 716) | −4 at (1089, 535) | **+18 at (1422, 723)** |
| mean luma | 30.5 | 38.2 | **48.1** |
| mean RGB | (22.3, 24.4, 44.8) | (28.3, 31.5, 54.8) | **(47.1, 40.3, 56.7)** |

The floor strip went from **no warm-leaning pixel at all** to a contiguous
**2,927-px patch at x 1317-1527, y 721-748** — from the wall's base (y 720) 28 px
toward the camera, about 1.7 m of floor — with the strip's mean luma up 26 % against
the same-camera baseline (38.2 → 48.1) and its mean colour shifted from blue-dominant
(28.3, 31.5, 54.8) to warm-leaning (47.1, 40.3, 56.7).

### 5.2 The pool region, x 1200-1600, y 715-790

Identical numbers (warm px 1; warm-leaning 3,364 px, largest 2,927 px at x 1317-1527,
y 721-748; max R-B +18 at (1422, 723); mean luma 48.6; mean RGB (42.8, 38.7, 64.1)).
The patch lies wholly inside the strip, so **nothing warm-leaning appears outside the
strip's band in this frame**.

### 5.3 The pool's cross-section (vertical profile at x 1422, after)

| y | 700-721 | 722 | 723 | 724-733 | 734-750 | 751-758 |
|---|---|---|---|---|---|---|
| what | the door | edge | peak | pool core | pool | cold floor beyond |
| luma | 2-18 | 1 | 28 | 70-96 | 60-84 | 54-67 |
| R-B | −10..−15 | +1 | **+18** | −2..+9 | +2..+11 | −5..−25 |

The pool is a 28-px band at the wall's base, at luma 60-96 against the cold floor's
54-67, and its warm lean is strongest at the top edge (the wall's base) and decays as
the disc's smoothstep window falls off. **Its warm bias is small**: the floor's blue
ambient (the sky's reflection at a 7° grazing angle) still dominates the pool's own
R-B, so the strict `R>B+15 && R>60` count is 1 px while the *value* break is large.
The measurable event here is the value break with a location, not a warm-pixel count.

### 5.4 Controls — nothing leaked

Whole-frame shares, before → after (same resolution, same runs):

| pose | warm (`R>B+15, R>60`) | warm-bright (`R>120, R>1.6B`) | mean RGB |
|---|---|---|---|
| 16-fall-wreck-up | 0.115 % → **0.115 %** (±0.000) | 0.016 % → **0.016 %** (±0.000) | (15.4, 34.0, 86.6) → (15.4, 34.0, 86.6) |
| 18-fall-skyline | 1.334 % → **1.335 %** (+0.002) | 0.233 % → **0.238 %** (+0.006) | (18.2, 33.9, 78.8) → (18.2, 33.9, 78.7) |
| 19-fall-pile-close | 2.058 % → **2.076 %** (+0.018) | 0.057 % → **0.057 %** (+0.000) | (117.4, 132.4, 149.1) → (117.1, 132.1, 148.8) |
| 20-fall-ground-level | 3.135 % → 3.015 % (−0.120) | 0.508 % → **0.517 %** (+0.009) | (13.8, 16.8, 51.1) → (14.2, 17.2, 52.1) |

**16 and 18 are flat to the digit** — no new pool, no flood, no change in value
structure. 19 is a noon frame on a deck 150 m above the low; its +0.018 pp is the
crowd. Pose 20's whole-frame numbers carry two confounds and are reported with them:
the 1600x900 "before" is round 3h's single shot at fov 1.03364 against the new run's
1.07542 (a wider lens puts more sky and near floor in the frame, so the old city's
share of the warm pixels falls), and the same-camera comparison against the 06-07-15
run — whose pose-20 PNG was captured at a **0.75 render scale** (1200x675) while the
new one is 1600x900 — reads 3.144 % → 3.015 % loose and 0.577 % → 0.517 % bright.

## 6. What this round did NOT do, and did NOT verify

- **The verdict.** The reviewer's, against the acceptance: a source-lit patch of ground
  below the horizon, a warm/light value break with a measured location and a counted
  warm area, and a control frame with no new pool. §5 gives the numbers; whether they
  carry it is not mine to say.
- **PART 10's deferred clause — the water's specular — is NOT delivered.** Two reasons,
  both measured: the material cannot author a roughness (the vertex layout carries no
  roughness; the chunk draw's `params.y` is one value for the whole chunk mesh, and the
  `flood` class overrides it in `gbuffer.wgsl` with `mix(0.66, 0.10, open)` — already
  low-roughness in the open areas), and the surface under the lamp is the **silt**,
  which takes the shared `paving` family's roughness (0.70). Lowering that is a
  city-wide change to every paved surface, and `docs/FLOODED_LOWS_SPIKE.md` records
  that lowering the water's roughness at grazing angles is what turned a pool into a
  uniform sheet of horizon. `gbuffer.wgsl`'s flood branch was left alone for that
  reason. The lamp's own glint would in any case land on the silt about 9.9 m in
  front of the wall, outside the pool's 3.18 m disc.
- **The water sheets' own read.** They are 3.5-15 m from the strip and mostly to the
  left of the frame; their pixels were not measured separately. Their albedo rose
  3.4x, so they are brighter in the frame, and that is a change a reviewer should look
  at.
- **The city's other flooded lows.** `grep` finds one author of the `flood` class —
  `fallmesh.ts`'s `pushFloodWater` — so the change reaches the fall zone's flooded
  lows only, and the `fenced` and `overgrown` patches are untouched. No frame in this
  run was posed to look at the low as a place.
- **The read.** Whether the pool reads as a work lamp's pool, and whether the brighter
  silt reads as mud or as a pale decal, is a judgement on the frame, and it is the
  reviewer's.
- **The harness's frame times** (126-140 ms) are a headless artefact; both runs sit in
  the same band, and D32's 30 fps floor is not testable here.
- **Not re-judged:** round 3g's lit-row count (5 of 6, closed separately), 3h's bracket
  and fixture, the ground pass, the lifelines, the rubble, and pose 19's band.

## 7. The next step, if the reviewer wants one

The pool now lands and is measurable. What it cannot be is *warm*: the floor's blue
ambient still wins the R-B contest, so the strict warm-pixel count is 1 px on a
2,927-px patch. If the acceptance wants warmth rather than a value break, the lever is
the floor's own colour under blue-hour light — a warmer silt albedo, or a warmer
ambient for the low — not the lamp, and not the global pool term.
