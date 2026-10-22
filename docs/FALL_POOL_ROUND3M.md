# Fall pool, round 3m — structure on the hut's front wall

**Implementer's record (inherited from `fall-lamp`, completed here). The verdict
is `fall-lamp-review`'s. This document records what was changed, what it measured,
and what it did not establish. It does not claim the acceptance or a verdict.**

## 1. What changed

`src/render/fallground.ts`: a new helper `frontFace()`, called from `winchHouse`
and `workshopYard`, adds three pieces to each hut's door face:

- **Fascia**: a board across the face under the eave, in the door's near-black
  (`DOOR`), 0.06 m proud of the cladding, 4.0 m wide × 0.82 m tall (winch) /
  6.2 m × 1.2 m (workshop), sitting over the band the lamp washes hardest.
- **Hood**: a steel slab over the door, projecting ~0.44 m past the cladding,
  0.12 m tall, at the door head.
- **Pilasters**: two steel uprights flanking the door, 0.2 m wide, from the deck
  to the fascia.

No shader change, no material change, no lamp change (`LAMP_INTENSITY` stays 6.6,
`LAMP_RADIUS` unchanged), no geometry of the pool or the bracket, no pose change.
The pool term in `lighting.wgsl`, the flooded-low material (`WATER`,
`PATCH['flooded']`) and the bracket position are untouched.

The helper's doc comment claims the work lamps cast no shadow, so a hood shades
nothing and the geometry works purely by occluding the view of the lit face. That
claim was verified before any capture: `grep -n "shadow" src/shaders/lighting.wgsl`
finds the word only in a header comment; the light loop (the clustered local
lights block) performs no shadow lookup. **The no-shadow claim holds.** The pieces
are dark (near-black fascia, cold steel hood and pilasters) standing proud of the
cladding, so they occlude parts of the lit face from the camera and leave edges
and bands instead of one bright field.

## 2. Verification (all clean)

```
./node_modules/.bin/tsc --noEmit              -> clean
npx vite build                                -> ✓ built in 783 ms
npx vite-node@6.0.0 src/world/__selftest.ts   -> VIOLATIONS   none — all invariants hold
npx vite-node@6.0.0 src/world/__selftest_fallzone.ts -> VIOLATIONS none
node tools/orchestrate.mjs preflight          -> OK (mem-unused 938 MB)
```

No GPU/WGSL error in the run (below).

## 3. The run

- Preflight: OK (swap 0.77/2.0 GB, disk 12.8 GB, mem-unused 938 MB, load 1.36/8).
- `node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence --pose=fall --timeout 900`
- **Run directory: `shots/2026-10-22T10-18-49/`** — 5 fall poses + `_contact-sheet.png`,
  62.6 s, PASS, all five poses at `q:medium` (tier verified uniform).
- Baseline: `shots/2026-10-22T08-03-24/` (round 3l, the last pool run).

### `_capture.json`, all five poses (run `10-18-49`)

| pose | error | held fov | lights del/binned/starved | triangles | g-buffer triangles | frameMs | tier |
|---|---|---|---|---|---|---|---|
| 16-fall-wreck-up | null | 1.01111 | 1222 / 1222 / 0 | 3,943,727 | 1,071,708 | 130.08 | medium |
| 17-fall-piles-level | null | 1.07075 | 1133 / 1133 / 0 | 3,676,114 | 944,022 | 136.92 | medium |
| 18-fall-skyline | null | 1.04743 | 1405 / 1405 / 0 | 4,905,401 | 1,295,842 | 131.79 | medium |
| 19-fall-pile-close | null | 1.06975 | 1133 / 1133 / 0 | 4,792,555 | 2,028,468 | 139.42 | medium |
| 20-fall-ground-level | null | 1.07542 | 1133 / 1133 / 0 | 5,093,359 | 1,329,476 | 139.86 | medium |

No GPU/WGSL error in any shot. Lights unchanged (1222/1133/1405/1133/1133, starved 0).
G-buffer triangles: pose 20 +480 over the 08-03-24 baseline (1,328,996 → 1,329,476).

## 4. The five done-whens, measured

### 1. Wall warm share in the band x 1340-1480, y 490-600

Warm = `R > B + 15 && R > 60`. Baseline 08-03-24 (6.6 intensity, PART 18's "79 %").

| | warm px | share | mean RGB |
|---|---|---|---|
| baseline 08-03-24 | 12,329 | 78.8 % | (93, 72, 56) |
| current 10-18-49 | 4,285 | 27.4 % | (50, 38, 37) |

**Materially down: 78.8 % → 27.4 % (−51.4 points), mean RGB (93, 72, 56) → (50, 38, 37).**
The near-black fascia covers the band the lamp washes hardest; the wall's warm
area fell from the largest lit area in the frame to a quarter of the band.

### 2. Countable dark apertures or edges crossing the band

Dark components (luma < 50, 4-connected, area ≥ 50 px) in x 1340-1480, y 490-600:

| # | area | bbox (x, y) | extent |
|---|---|---|---|
| 1 | 10,315 | x 1340-1480, y 513-600 | 141 × 88 (the fascia + lower wall) |
| 2 | 558 | x 1340-1391, y 490-502 | 52 × 13 (top-left eave band) |
| 3 | 458 | x 1416-1480, y 490-497 | 65 × 8 (top-right eave band) |
| 4 | 89 | x 1373-1405, y 517-519 | 33 × 3 (small mark) |

There are **four** countable dark regions in the band, three of them large
(the fascia mass and the two eave bands) plus one small mark. The fascia is a
single near-black mass 4.0 m wide × 0.82 m tall; the pilasters (0.2 m wide) do
**not** appear as distinct vertical components — they are merged into the fascia
because they are only ~2 px wide at this distance and the same near-black. The
hood reads as a horizontal edge above the door, not as an aperture.

**My read of the inherited geometry (stated, not claimed as a verdict):** the
fascia is a crude black band — it works as a light reducer (done-when 1) but it
is one mass, not structured apertures. The pilasters are too thin to read and
the hood is a slab. I have **not** changed the geometry, because the measured
goals (1, 3, 4) are met and any refinement of the apertures is a visual
judgement I cannot verify from pixel counts; changing it on an unverified theory
risks the warm share and the pool. The count is reported as measured; whether
these regions read as "structure" on the frame is `fall-lamp-review`'s call.

### 3. Pool preserved

Peak lift at y 730-739 against the 07-21-31 baseline: **+52.2 luma**
(baseline 77.5 → current 129.7), comfortably above the +45 floor. The transect
shape is unchanged: +40.5 at y 720-729, +52.3 at 730-739, +50.0 at 740-749,
+43.5 at 750-759, decaying to +16.2 at 850-859. The pool is not shaded by
the front face (the lamps cast no shadow — verified, §1).

### 4. Controls

| pose | warm share move | |
|---|---|---|
| 16-fall-wreck-up | +0.001 pp | (0.115 % → 0.116 %) |
| 17-fall-piles-level | +0.002 pp | (0.287 % → 0.288 %) |
| 18-fall-skyline | +0.025 pp | (1.335 % → 1.360 %) |
| 19-fall-pile-close | +0.001 pp | (2.076 % → 2.077 %) |

All within the 0.03 pp gate. No GPU/WGSL error in any shot; `error` null on all
five; tier uniform (`q:medium` on all five, 1600×900).

### 5. Full-frame read

The pool is visible at full frame scale (a bright patch at the wall's base,
falling off toward the camera), the bracket's post and arm are visible at 4×,
and the hut reads as a lit object in a cold blue yard. The wall is now dark
rather than a warm slab. Whether the front face reads as *structure* (apertures
on a cold mass) or as a crude black band is a judgement on the frame and is
`fall-lamp-review`'s; the measurements above (warm share, dark components, pool
preservation, controls) are what I can verify from pixels.

## 5. Cost

Geometry, so the cost is real and stated (unlike 3i's selection-only change):

- G-buffer triangles, pose 20: **+480** (1,328,996 → 1,329,476).
- Total frame triangles, pose 20: +3,456 (5,089,903 → 5,093,359) — the
  difference is crowd/traffic dither, not geometry; g-buffer is the geometry.
- Per hut: fascia 1 box (12 tris) + hood 1 box (12 tris) + 2 pilasters
  (24 tris) = **48 tris**, times the number of winch/workshop huts in the
  visible chunks.
- Lights unchanged: 1133 delivered, 0 starved. No light-count change.
- The LOD 2 merged path is untouched.

## 6. What I did NOT establish

- **The visual read.** Whether the front face reads as structured apertures or as
  a crude black band, and whether the hut still reads as a lit object with the
  lamp as its source at full frame scale (done-when 5). I cannot view the frame;
  only `fall-lamp-review` can judge it.
- **The no-shadow claim beyond the shader.** Verified by grep and by reading the
  light loop: no shadow lookup exists for lamps. But I did not test whether the
  hood's geometry, at the actual angles, occludes the view of the lit face the
  way the doc assumes — that is a frame read.
- **WorkshopYard.** Every third winch uses `frontFace` with `halfWidth 3.2`,
  `doorA 1.2`, `doorHalf 0.6`, `doorTop 2.0`, `eave 3.4`. No judged frame in
  this run contains a workshop yard, so its read is unverified, as in every
  previous round.
- **City-wide check.** `wide-skyline` and `aerial-top` were not in this run; the
  front face is per-hut geometry, so it should not homogenise the zone, but that
  is an assumption, not a measurement.
- **The specular (PART 10's deferred clause).** Not delivered; the pool's
  surface is silt at roughness 0.70 and `FLOODED_LOWS_SPIKE.md` records why
  roughness was left alone. Unchanged from 3j.
- **The lamp's pool term, the bracket position, `LAMP_INTENSITY` (6.6), and
  `LAMP_RADIUS`.** Untouched, as constrained.
- **I did not change the fascia even though it reads as a crude black band.**
  The measured goals (1, 3, 4) are met and a refinement of the apertures is a
  visual judgement; changing it on an unverified theory risks the warm share and
  the pool. The reviewer may request a change; the numbers above are the
  baseline it would be measured against.

## 7. The one thing I am least sure about

Whether the fascia reads as a soffit/structure or as a black band painted across
the wall. The pixel count says it is one near-black mass (10,315 px, 141 × 88)
with no distinct aperture; the two eave bands and the small mark are the only
other dark regions. If the reviewer reads it as a crude band, the fix is not
more black area but a different kind of edge — a projecting slab with a lit slit
under it, or a boarded opening — and that is a geometry change I did not make
because I could not verify it from the numbers.