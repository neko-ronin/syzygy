# Pose 20 — lamp head moved out of its own hut (round 3d, second pass, fix-up)

**Implementer:** fall-piles. **Date:** 2026-10-22. **Subject:** the winch-house /
workshop work lamp whose head was buried inside its own hut body, so pose 20 had
no warm source below the horizon (PART 10, `docs/VISION_FALL_BASELINE.md`).

## The defect (verified in code, not taken on report)

`src/render/fallground.ts`:

- `winchHouse`: `lamp(hx, GROUND_Y + 2.55, hz)` at the hut centre (`b0 = c.halfZ + 2.9`).
  Hut body `0..2.70 m`, roof slab `2.70..2.94 m`, head half-height `0.12`, so the
  head top is `2.67 m` — inside the wall and under the roof. The emitter is
  buried and casts no source and no pool.
- `workshopYard`: the identical defect, `lamp(hx, GROUND_Y + 3.1, hz)` at the hut
  centre (`b0 = c.halfZ + 3.8`), hut top `3.4 m`, roof to `3.64 m`.

## The fix

Put the head on the door face. The door plate is already computed in both
functions as `dx, dz = f.at(c.x, c.z, 0, b0 + 1.72)` (winchHouse) and
`f.at(c.x, c.z, 1.2, b0 + 2.22)` (workshopYard); pose 20's camera is on that
side (local b `24.8` vs foot `11.2`). The head's half-extents are `0.14`, so at
the door face it straddles `b0 + 1.68 .. 1.86` against the wall at `b0 + 1.70`
and sits `0.38 m` under the roof slab with no coplanar faces — outside the wall
and clear of the eave, not embedded in either. The `lights.push` position moves
with it in the same `lamp(...)` call.

```diff
-  lamp(hx, GROUND_Y + 2.55, hz);
+  lamp(dx, GROUND_Y + 2.2, dz);
```
(winchHouse)

```diff
-  lamp(hx, GROUND_Y + 3.1, hz);
+  lamp(dx, GROUND_Y + 2.2, dz);
```
(workshopYard — same one-line defect; fix applied.)

WorkshopYard was the same one-line defect (lamp at hut centre, inside the body),
so the same rule was applied. Geometry elsewhere, palette, light counts, the LOD 2
merged path, and the pose were not touched. `workshopYard`'s door face is at
`b0 + 2.22`, `x + 1.2`, as specified.

## Run

- Stamp / run: `2026-10-22T05-05-49`
- Frame: `shots/2026-10-22T05-05-49-20-fall-ground-level.png`
- Capture command: `node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --pose=20-fall-ground-level --timeout 900`
- Preflight: OK (mem-unused 2065 MB). `tsc --noEmit` and `vite build` clean.

## `_capture.json` equivalent (`shots/latest.json`, shot `20-fall-ground-level`)

- `error`: null (no GPU/WGSL error)
- `lights`: 1133 delivered
- `lightDelivery.starved`: 0
- `lodHistogram`: [9, 28, 98, 0]
- `dayPhase`: 0.163 (blue hour)
- camera held: position [558.1, 2.0016, -452.4] (requested [558.1, 2.1, -452.4],
  0.10 m off), fov 1.0324 (requested 1.1)

## Probe counts (PART 10 gate)

Warm-bright = `R > 120 && R > 1.6 * B`.

- **Below y = 600** (`--rect=0,600,1600,300`, the bottom 300 px): **72 px**
  (0.015 %, rounds to 0.0 % in `pixel_share.py`). PART 10 gate required `> 0`:
  met (baseline PART 10 frame had 0 px).
- **Whole frame**: 7318 px = **0.5 %** warm-bright (baseline 1.34 %). No flood:
  below the 1.34 % baseline, so the change did not light up the frame.

Warm pixels span y `0..606` (max y 606), i.e. the new source's glow reaches
just below the horizon line (y 583-596) but not deep into the bottom third.

## What this does NOT establish

- It does not judge the frame. fall-review does that against
  `references/B-cold-industrial-sheet.jpg` (frame 3, ground level) and returns
  `done` or `more work needed`. This doc records the measurement only.
- A count of 72 px below y 600 is `> 0` and meets the gate, but it does not
  establish that the lamp reads as a distinct source, pool, or reflection in the
  water; the water's reflection was explicitly deferred to the round after
  (PART 10 (b)).
- It does not establish that rubble, rebar, lifelines, or the floor "read" —
  those were PART 10 (c)/(d) open items and are untouched here.
- It does not establish that workshopYard (every third winch) behaves identically
  in a frame; no workshopYard foot is the pose-20 subject. The same one-line
  defect was present and the same fix was applied; verification of its read is
  left to a frame that contains one.
- It does not re-judge rounds 3a/3b/3c or the break, and it does not change the
  pose.