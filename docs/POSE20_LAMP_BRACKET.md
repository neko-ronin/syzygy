# Pose 20 — the lamp head on a bracket above the eave (round 3g)

**Implementer:** fall-lamp. **Date:** 2026-10-22. **Subject:** the winch-house /
workshop work lamp whose head sat on the hut's door face, so its light stopped
at that wall and the floor in front of it — in frame — carried no pool
(PART 12, `docs/VISION_FALL_BASELINE.md`).

## The defect (verified in code, not taken on report)

`src/render/fallground.ts`, `winchHouse`:

- Hut body `box(hx, GROUND_Y + 1.35, hz, 2.1, 1.35, 1.7, HUT)` — the wall face
  is at `b0 + 1.70`, the top at `GROUND_Y + 2.70`.
- Roof slab `box(hx, GROUND_Y + 2.82, hz, 2.35, 0.12, 1.95, ROOF)` — the top is
  at **`GROUND_Y + 2.94`** and the footprint reaches **`b0 + 1.95`**.
- The head was on the door face: `lamp(dx, GROUND_Y + 2.2, dz)` with
  `dx, dz = f.at(c.x, c.z, 0, b0 + 1.72)`.

So the head sat **0.02 m in front of the wall and 0.38 m under the slab**, i.e.
inside the eave's shadow line. A head above the door can only light the wall it
is mounted on and the roof above it; the floor strip 1-6 m in front of the door
is lit by nothing.

## The fix

One change, in `src/render/fallground.ts`: a new `bracketHead` helper draws a
post that stands on the roof slab and an arm that reaches out past the eave,
and the lamp head hangs at the arm's tip. The `lights.push` position moves
with the head, in the same `lamp(...)` call.

`winchHouse` — head centre at `b = b0 + 2.2`, `y = GROUND_Y + 3.4`:

| | value | clearance |
| --- | --- | --- |
| eave (roof slab's outer edge) | `b0 + 1.95` | head's inner face at `b0 + 2.06` → **0.11 m outboard** |
| slab top | `GROUND_Y + 2.94` | head's underside at `GROUND_Y + 3.28` → **0.34 m above** |
| wall face | `b0 + 1.70` | head's inner face at `b0 + 2.06` → 0.36 m clear |

The post's foot is sunk 0.02 m into the slab and the arm's tip is inside the
head, so no two faces are coplanar. The post is a 0.1 m square section, the
arm the same, both `STEEL`; the head keeps the existing 0.14 m emissive box.

`workshopYard` — **the geometry matches in kind, so the same rule was
applied**: its slab reaches `b0 + 2.5` with its top at `GROUND_Y + 3.64` (a
bigger hut, the same defect), so the head goes to `b = b0 + 2.75` (0.25 m
outboard of that eave) at `y = GROUND_Y + 4.1`, over the door's own `a = 1.2`.
The yard's sorted heaps stand at `b0 + 3.2` and reach `GROUND_Y + 1.6` at
their tops, so they do not meet the bracket. **No frame contains a
workshopYard hut** — the only one in this chunk (id55) is 60 m away and off
frame — so its read is unverified, as it was in round 3f.

`LAMP_INTENSITY` and `LAMP_RADIUS` are untouched: every lifeline in the zone
shares them, a stronger lamp would change frames that are already judged, and
the finding below is that strength was never the blocker.

## The run

- Stamp: `2026-10-22T05-56-31`
- Frame: `shots/2026-10-22T05-56-31-20-fall-ground-level.png`
- Command: `node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --pose=20-fall-ground-level --timeout 900`
- Preflight: OK (mem-unused 2687 MB, swap 0.77/2.0 GB, disk 13.0 GB).
  `tsc --noEmit` and `vite build` clean.
- A single-pose capture writes a bare PNG plus `shots/latest.json`, not a run
  directory, so there is no grid to pair.

`shots/latest.json` (shot `20-fall-ground-level`): `error` null, `lights` 1133
delivered, `lightDelivery` produced 0 / delivered 1133 / binned 1133 / starved
0 / `dayPhase` 0.163, `lodHistogram` [9, 28, 98, 0]. Camera held at position
[558.1, 2.0217, -452.4] (requested [558.1, 2.1, -452.4], 0.08 m off), look ray
[215.52, 71.40, -646.92], **held fov 1.03364** (requested 1.1). The 3f frame's
held fov was 1.03241, so the two frames are within 0.12 % of each other in
lens; the held eye height differs by 0.057 m (2.0217 vs 1.9652).

The bracket costs two boxes per structure, 24 triangles. The light count is
unchanged at 1133: one light moved, none added, none dropped.

## The measurements

### Warm components below y 600, by location

Method as PART 12: warm = `R > B + 15 && R > 60`, 4-connected, whole frame
decoded. Before = `shots/2026-10-22T05-05-49-20-fall-ground-level.png` (the
3f frame).

**After (`05-56-31`): 17 components, 248 px, all of them the two groups that
are already in the before frame.**

| px | bbox | what |
| --- | --- | --- |
| 46 | x 412-421, y 601-606 | stall |
| 34 | x 459-463, y 600-607 | stall |
| 29 | x 1194-1201, y 600-606 | canopy row |
| 24 | x 468-471, y 600-608 | stall |
| 23 | x 1069-1073, y 601-607 | canopy row |
| 20 | x 1037-1041, y 600-604 | canopy row |
| 18 | x 438-440, y 600-606 | stall |
| 14 | x 1052-1054, y 600-604 | canopy row |
| 11 | x 1086-1088, y 600-603 | canopy row |
| 9 | x 322-323, y 600-604 | stall |
| 5 + 5 + 4 + 2 + 2 + 1 + 1 | x 491-492, x 1062-1063, x 1060, x 1052-1053, x 460, x 496, x 431 | stall / canopy row |

**Before (`05-05-49`): 28 components, 303 px, the same two groups** (the stall
at x 321-496, the canopy row at x 1037-1201). The lens is 0.12 % different, so
the group sizes move by a few px and a few px of the crowd drift.

**There is no new component below y 600 anywhere, and none in the lamp's own
x range.** The lamp contributes **0** warm px below the horizon in this frame,
as it did in 3f. The count went *down* (28 → 17 components, 303 → 248 px)
because the tighter lens lifted the canopy row's lower edge out of the
band — that is lens and crowd drift, not the lamp.

### The floor strip between the hut and the camera

The strip in front of the door face is `y 700-760`, `x 1300-1600` (PART 12's
rect) — 1 to 6 m in front of the door, which is the ground the camera can
actually see.

| | after (05-56-31) | before (05-05-49) |
| --- | --- | --- |
| max R-B on the strip | **−4 at (1484, 716)** | −2 at (1465, 700) |
| warm px on the strip | **0** | 0 |
| mean luma on the strip | 30.5 | 26.1 |
| max R-B, wall base → frame edge (x 1400-1600, y 715-800) | −4 at (1484, 716) | −1 at (1442, 780) |

**No pool.** The floor in front of the hut carries the same cold blue it
carried before the change; the +4.4 luma on PART 12's rect is the lens and
eye-height difference, and the other floor rect moved the other way
(38.2 vs 40.0).

### What did change, and it is visible

- **The emitter moved up and now has a fixture.** The bright warm core
  (`R > 150 && R > B + 60`) was at x 1415-1424, y 553-559 (3f) and is now at
  x 1412-1414, y 456-475 — 95 px higher, clear above the slab's edge, with the
  bracket arm reading under it in the crop.
- **The wall is lit properly now.** The warm area on and around the hut
  (x 1350-1500, y 500-700) grew from 3398 to 3829 px and its mean luma from
  27.2 to 29.7. The head is 0.5 m outboard of the wall instead of 0.02 m, so
  the wall sees it instead of seeing it edge-on. That is the change working,
  and it is on the wall, not the floor.

## Why there is still no pool on the floor (measured, with a diagnostic frame)

The light is not the problem, and neither is its position. Both were checked
directly:

1. **Delivery.** `probe('lights')` on the live app at this pose returns the
   lamp's light in the packed array: `pos 552.59, 2.55, -464.60` in round 3f
   (radius 10, intensity 2.2, colour 1/0.72/0.4). The capture reports 1133
   delivered, 1133 binned, **0 starved**.
2. **Binning.** `probe('tileat:x,y')` on the floor pixels in front of the hut
   (1420,745 / 1450,760 / 1480,775) returns 32-48 lights per tile, and the
   lamp's index is **in every one of those tiles**. So the lighting pass does
   evaluate this light on that floor.
3. **The pool term itself.** A diagnostic capture,
   `shots/2026-10-22T05-58-09-20-fall-ground-level.png`, was taken with the
   albedo factor removed from the pool term in `src/shaders/lighting.wgsl`
   (`color += albedo * li.colorInt.rgb * ...` → `color += vec3f(1.0, 0.45, 0.0)
   * disc * 2.0`). The shader edit was **reverted and is not part of this
   commit** (`git diff src/shaders/lighting.wgsl` is empty). In that frame the
   pool lands where the geometry says it should: **one warm component of
   12,650 px, bbox x 1227-1599, y 725-778** — the disc under the head,
   clipped by the hut, spreading from the wall's base out towards the camera.
   The bracket's cone does reach the visible strip.

So the pool is computed, it lands on the right ground, and it is invisible
because the term is multiplied by the **fragment's albedo**:

```wgsl
color += albedo * li.colorInt.rgb * li.colorInt.w * disc * POOL_GAIN * pools;
```

The floor in front of this hut is the flooded low's surface: the flood water
quads of `fallmesh.ts`'s `pushFloodWater`, albedo (0.034, 0.049, 0.062) —
dark, and **blue-biased**. A warm lamp multiplied by a blue-biased albedo adds
a blue-biased light: R +0.030·disc, B +0.022·disc in linear. It lifts the
value by a few luma and leaves R-B negative, which is exactly what the strip
measures. The pool cannot be warm on this floor while it is multiplied by this
floor's colour.

**A stronger lamp would not fix it either**, and this is why the task's
instruction not to touch `LAMP_INTENSITY` was the right one on the merits, not
only on scope: raising the intensity scales the blue-biased lift by the same
factor, and every frame that already carries a lit wall would get brighter.

## What this does NOT establish

- It does not judge the frame. A review agent opens the sheet, this frame and
  the grid, and returns `done` or `more work needed`. This doc records
  measurements only.
- It does not establish a pool. There is none: 0 warm px on the strip, max
  R-B −4, no new component below y 600.
- It does not establish the water's specular (PART 10's deferred clause) —
  untouched.
- It does not establish workshopYard's read. No frame contains a workshopYard
  hut; the same rule was applied on matching geometry and its verification is
  owed to a frame that contains one.
- It does not establish that the fall zone's floor is a place at night. The
  strip is still a cold blue sheet.

## The next change, if there is one

Not the lamp's position, and not its strength. The pool term's albedo
multiply, or the flood water's albedo, is what decides whether a lamp can
warm this floor at all: a pool that is the surface's own colour times the
lamp's colour cannot be warm on a blue surface. That is a shader/material
decision, one file, and it is not this round's.

**Bottom line:** the head is now on a bracket above the eave, outboard of the
roof slab, with the light moved with it; the wall reads as lit and the frame
reads as a lamp with a fixture. The floor in front of the hut still carries no
pool, and a diagnostic frame shows why: the pool is computed and lands on
exactly that strip, and the floor's own dark blue albedo swallows it.
