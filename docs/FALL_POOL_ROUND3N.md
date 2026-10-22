# Fall pool, round 3n — widening the reveals (and the fallback that failed)

**Implementer's record. The verdict is `fall-lamp-review`'s. This document records
what was changed, what it measured, and what it did not establish. It does not
claim a verdict.**

## 1. What changed

Two attempts, one committed.

**Attempt 1 — widen the reveals (committed).** `src/render/fallground.ts`,
`frontFace`: the fascia's reveal half-height `gapH` went from `0.04` (0.08 m
total gap) to `0.08` (0.16 m total gap). The three boards got shorter and the
two gaps between them doubled. No other geometry, no material, no lamp, no
shader, no pose. This is the state of the tree and the state of the run cited
below.

**Attempt 2 — framed opening (tried, reverted).** Following PART 19's fallback
for "still reads as lines", the two reveals were replaced with one framed
opening: top and bottom boards, steel jambs (top, sill, two sides) standing
0.12 m proud of the cladding, and a lit interior plane set back at the
cladding face. Result: warm share in the band went to **52.8 %** (15,651 px,
mean (72, 57, 49)) — over the ~50 % failure mode, because the interior plane
was a 40-px-tall bright band lit by the lamp wash. The opening read as a large
bright rectangle, not a framed aperture, and it re-warmed the wall. That state
was reverted; the committed state is attempt 1. The failed attempt's frame is
`shots/2026-10-22T11-10-45/` and its numbers are in §3.

## 2. Verification (all clean)

```
./node_modules/.bin/tsc --noEmit              -> clean
npx vite build                                -> ✓ built in 774-782 ms
npx vite-node@6.0.0 src/world/__selftest.ts   -> VIOLATIONS   none — all invariants hold
npx vite-node@6.0.0 src/world/__selftest_fallzone.ts -> VIOLATIONS none
node tools/orchestrate.mjs preflight          -> OK (mem-unused 2333 MB / 407 MB)
```

No GPU/WGSL error in the run (below).

## 3. The run

- Preflight: OK (swap 0.77/2.0 GB, disk 12.7 GB, mem-unused 2333 MB → 407 MB
  across the two attempts, load 2.01/8 → 1.66/8).
- `node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence --pose=fall --timeout 900`
- **Run directory (committed state, widened reveals): `shots/2026-10-22T11-09-19/`**
  — 5 fall poses + `_contact-sheet.png`, 59.4 s, PASS, all five at `q:medium`.
- Failed-fallback run (framed opening): `shots/2026-10-22T11-10-45/`, 62.0 s,
  PASS, all `q:medium`. Kept as evidence of the failed idiom only.
- Baseline for the pool: `shots/2026-10-22T07-21-31/` (round 3j). Baseline for
  the wall: `shots/2026-10-22T10-36-13/` (round 3m).

### `_capture.json`, all five poses (run `11-09-19`, committed state)

| pose | error | held fov | lights del/binned/starved | triangles | g-buffer triangles | frameMs | tier |
|---|---|---|---|---|---|---|---|
| 16-fall-wreck-up | null | 1.01111 | 1222 / 1222 / 0 | 3,943,727 | 1,071,708 | 130.08 | medium |
| 17-fall-piles-level | null | 1.07075 | 1133 / 1133 / 0 | 3,676,114 | 944,022 | 136.92 | medium |
| 18-fall-skyline | null | 1.04743 | 1405 / 1405 / 0 | 4,905,401 | 1,295,842 | 131.79 | medium |
| 19-fall-pile-close | null | 1.06975 | 1133 / 1133 / 0 | 4,792,555 | 2,028,468 | 139.42 | medium |
| 20-fall-ground-level | null | 1.07542 | 1133 / 1133 / 0 | 5,093,359 | 1,329,716 | 139.86 | medium |

No GPU/WGSL error in any shot. Lights unchanged (1222/1133/1405/1133/1133,
starved 0). G-buffer triangles identical to 3m (1,329,716) — the widened
reveals change board heights, not box count.

## 4. The six numbers

### 1. Seam height in px at 1×, before and after, per reveal

Row-mean luma over x 1340-1480 (the bright seam is the row where the mean rises
above the boards' ~30-48). Before = 3m run `10-36-13`; after = 3n run
`11-09-19`.

| reveal | before height | before rows | after height | after rows |
|---|---|---|---|---|
| 1 (upper) | ~4 px | y 534-537 | ~6 px | y 533-538 |
| 2 (lower) | ~4 px | y 556-559 | ~7 px | y 555-561 |

Widening from 0.08 m to 0.16 m total gap roughly doubled the seam height
(~4 px → ~6-7 px), matching PART 19's prediction of ~5 → ~10 px within the
projection's cosine factor. The seam is taller but still a seam: a bright band
6-7 px tall and 141 px wide, with no jamb, no sill, no frame — a lit line, not
an aperture.

### 2. At least two reveals or openings read as apertures

There are **two** reveals, each a lit seam (the cladding behind shows through the
gap between two SHEET boards):

- Reveal 1: height ~6 px (y 533-538), width 141 px (full fascia), peak luma
  86.7, no visible depth, no frame, no jamb. **A lit line.**
- Reveal 2: height ~7 px (y 555-561), width 141 px, peak luma 79.0. **A lit
  line.**

Neither has visible depth, a frame, or a sill. They are lit lines, not
apertures. The fallback (framed opening) was tried and produced a 40-px-tall
bright band with warm share 52.8 % (§1, attempt 2) — a large bright rectangle,
still not a framed aperture, and it re-warmed the wall past the failure mode.
The fallback did not solve the idiom problem either.

### 3. Warm share in the band (x 1340-1480, y 490-600)

Warm = `R > B + 15 && R > 60`, plain RGB mean (the metric PART 18, 19 and the
3m record all use).

| run | warm px | share | mean RGB |
|---|---|---|---|
| 3m baseline `10-36-13` | 3,635 | 23.6 % | (46.5, 37.3, 38.0) |
| 3n widened `11-09-19` | 4,611 | **29.5 %** | (51, 41, 40) |
| 3n fallback `11-10-45` | 8,260 | **52.8 %** | (72, 57, 49) |

The committed state (widened) is 29.5 %, below the ~35 % acceptable line and
well short of the ~50 % failure mode. The fallback was rejected on this number
alone.

### 4. Pool preserved

Peak lift at y 730-739 against `07-21-31`: **+52.2 luma** (baseline 77.5 →
current 129.7), above the +45 floor. Transect shape unchanged from 3m
(+40.5 / +52.3 / +50.0 / +43.5 / +34.8 across y 720-769). The front face
stands proud of the cladding and the pool is on the floor at the wall's base;
nothing stands in front of it.

### 5. Controls 16-19 within 0.03 pp, no GPU/WGSL error, tier uniform

| pose | move |
|---|---|
| 16-fall-wreck-up | +0.001 pp (0.115 % → 0.116 %) |
| 17-fall-piles-level | +0.002 pp (0.287 % → 0.288 %) |
| 18-fall-skyline | +0.025 pp (1.335 % → 1.360 %) |
| 19-fall-pile-close | +0.001 pp (2.076 % → 2.077 %) |

All within 0.03 pp. No GPU/WGSL error in any shot; `error` null on all five;
tier uniform (`q:medium`, 1600×900 on all five).

### 6. The hut reads as a lit object with the lamp as its source

The pool is visible at full frame scale (a bright patch at the wall's base,
falling off toward the camera), the bracket's post and arm are visible at 4×,
and the hut is a lit object in a cold blue yard. The wall is dark rather than a
warm slab. Whether the reveals read as openings or as scratches of light is a
judgement on the frame and is `fall-lamp-review`'s (§7).

## 5. Cost

Geometry change (board heights), same box count as 3m, so the cost is the same
as 3m's:

- G-buffer triangles, pose 20: **+0** (1,329,716, identical to 3m).
- Total frame triangles, pose 20: +3,456 over the 3l baseline (crowd/traffic
  dither, not geometry).
- Lights unchanged: 1133 delivered, 0 starved. Frame time 139.8 ms, unchanged.
- The LOD 2 merged path is untouched.

## 6. What widening did, and what it did not do

- **Did:** doubled the seam height (~4 px → ~6-7 px) and lifted the warm share
  from 23.6 % to 29.5 % (the wider gap exposes more lit cladding). The wall is
  still dark and the reveals are visible as bright lines at 1×.
- **Did not:** produce apertures. A 6-7 px bright band with no jamb, no sill,
  no frame and no depth is a seam, not an opening. The PART 19 prediction was
  ~10 px; the actual is ~6-7 px, because the gap is foreshortened by the lamp's
  grazing angle. At this scale a seam is a seam.
- **Did not:** re-warm the wall past the failure mode (29.5 % is below 35 %).

## 7. The fallback, and why it is not the answer either

The fallback (one framed opening with jamb depth and a lit interior plane) was
implemented and captured (`11-10-45`). It produced:

- A 40-px-tall bright band (y 520-560) with warm share **52.8 %** — over the
  ~50 % failure mode. The interior plane (the cladding behind the frame) is
  washed by the lamp and reads as a large bright rectangle.
- No visible frame: the jambs (steel, 0.08 m half-depth) did not separate from
  the dark mass at 1×; the opening reads as a bright band, not as a recess with
  inner edges.

So the fallback failed the warm-share gate and did not achieve the aperture read.
It is documented here as an attempted idiom, not a solution. The committed state
is the widened reveals.

## 8. What I did not establish

- **The visual read of the seams.** I measure 6-7 px; whether that reads as an
  opening or a scratch at 1× is `fall-lamp-review`'s call. My own read, stated
  honestly: they are lines, not apertures. Widening a gap does not create depth;
  a gap is a gap. The fallback (depth) failed the warm-share gate. The idiom of
  "reveals between boards" appears to have run out: a reveal is a seam at any
  width that fits the warm-share budget, and a framed opening at this lamp
  distance is a bright rectangle.
- **Whether a darker interior or a different opening would work.** Not tried.
  The interior plane was the lamp-washed cladding; a darker plane, or a
  shuttered/battened opening, might read as an aperture without re-warming the
  wall, but that is an unverified theory and I did not commit on one.
- **WorkshopYard.** Every third winch uses `frontFace` with the same change; no
  judged frame contains one.
- **City-wide check.** `wide-skyline` and `aerial-top` were not in this run.
- **The specular (PART 10's deferred clause).** Not delivered; unchanged from
  3j/3m.
- **The no-shadow claim** is verified by grep and by reading the light loop, but
  the hood's occlusion of the lit face at the actual angles is a frame read,
  not a measurement.

## 9. The one thing I am least sure about

Whether any amount of widening or reframing inside this hut's geometry can
produce an aperture rather than a seam, or whether the aperture read requires a
different idiom entirely (a window with a lit interior plane behind a frame of
sufficient depth, or a shuttered opening with battens). The two idioms I tried
both failed: widening produced lines, and the framed opening produced a bright
rectangle that re-warmed the wall. The measured seam height (~6-7 px) is at the
edge of readability, and the warm-share budget (below ~35 %) is what prevents a
larger bright area. Those two constraints may be mutually exclusive at this
lamp distance and this wall size. That is the open question for `fall-lamp-review`
and for any next round.