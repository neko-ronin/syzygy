# Fall pool, round 3m — structure on the hut's front wall

**Implementer's record. The verdict is the reviewer's. This document records what
was changed, what it measured, and what it did not establish. It does not claim
the acceptance or a verdict.**

Round 3l closed **more work needed** on the wall, not on the pool: at
`LAMP_INTENSITY` 6.6 the hut's front face was 79 % warm and read as a lit slab,
where section B's reference carries warm as small apertures on a cold dark mass.
Round 3m gives that face structure, in geometry. The lamp, the pool term, the
flooded-low material and the bracket are untouched.

## 1. What changed

`src/render/fallground.ts` only. A helper `frontFace()`, called from
`winchHouse` and `workshopYard`, adds to each hut's door face:

- **Fascia** — three boards stacked across the face under the eave (world
  y = door head to the eave, 0.08 m proud of the cladding), in a new palette
  entry `SHEET = [0.06, 0.07, 0.095]`: a cold near-black, the colour of
  painted sheet. Two 0.08 m horizontal **reveals** separate the three boards.
- **Hood** — a steel slab over the door, projecting ~0.44 m past the cladding.
- **Pilasters** — two steel uprights framing the door's jambs (0.2 m wide), from
  the deck to the fascia.

Per hut: 6 boxes, 36 quads, **72 triangles**.

No shader change, no material change to the pool or the cladding, no lamp
change (`LAMP_INTENSITY` stays 6.6, `LAMP_RADIUS` unchanged), no change to the
bracket, the LOD 2 merged path, or any pose. `lighting.wgsl`'s pool term,
`WATER`, `PATCH['flooded']` and the bracket position are untouched.

### Why it is built this way

**The work lamps cast no shadow.** The pool is a disc term in `lighting.wgsl`
and the brdf has no shadow lookup for local lights, so nothing a hood does can
shade the wall behind it. This was checked before any capture:
`grep -n "shadow" src/shaders/lighting.wgsl` finds the word only in a header
comment. The pieces therefore work by **occluding the view** of the lit face
and by **their own colour**, never by shading.

**A single board over the wall is a slab in a different colour.** The first
version of this round (run `10-18-49`, committed as 6903208) boarded the wall
over with one near-black board. It passed the light-reduction test and failed
the read: the band became one 10,315 px black mass with no aperture in it, and
the two 0.2 m pilasters merged into it (they are ~2 px wide at 13 m and the same
near-black). A dark slab is the same failure the reviewer named, inverted.

**So the mass is split by lit seams.** Two reveals let the lamp-lit cladding
behind show through as narrow warm lines (0.08 m of gap, ~5 px of lit wall at
this distance). That is section B's grammar — small warm punctuation on a cold
mass — and, because the lines are lit, they cut the fascia into three boards
that can be counted on the frame instead of one mass. `SHEET` is blue-biased so
the boards read **cold** under a warm lamp: the band's mean RGB ends up
R 46 / G 37 / B 38, i.e. blue above red, where the slab's was R 93 / G 72 /
B 56.

## 2. Verification (all clean)

```
./node_modules/.bin/tsc --noEmit                            -> clean
npx vite build                                              -> built in 764 ms
npx vite-node@6.0.0 src/world/__selftest_fallzone.ts        -> VIOLATIONS none
npx vite-node@6.0.0 src/render/__selftest_ground_contract.ts -> GROUND CONTRACT ALL PASS
node tools/orchestrate.mjs preflight                        -> OK (swap 0.77/2.0 GB,
                                                               disk 12.8 GB, mem-unused 1132 MB)
```

No GPU/WGSL error in the run (below).

## 3. The run

- `node tools/orchestrate.mjs preflight` → OK (no BLOCK).
- `node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence --pose=fall --timeout 900`
- **Run directory: `shots/2026-10-22T10-36-13/`** — 5 fall poses +
  `_contact-sheet.png`, 61.7 s, PASS, all five poses at `q:medium` (the tier
  gate passed, so the tier is uniform).
- Baseline for the wall: `shots/2026-10-22T08-03-24/` (round 3l).
- Pool baseline: `shots/2026-10-22T07-21-31/` (round 3j, the pre-3l state).

### `_capture.json`, all five poses

| pose | error | tier | lights del/binned/starved | g-buffer triangles | frameMs |
|---|---|---|---|---|---|
| 16-fall-wreck-up | null | medium | 1222 / 1222 / 0 | 1,072,212 | 132.9 |
| 17-fall-piles-level | null | medium | 1133 / 1133 / 0 | 945,462 | 137.8 |
| 18-fall-skyline | null | medium | 1405 / 1405 / 0 | 1,296,250 | 132.8 |
| 19-fall-pile-close | null | medium | 1133 / 1133 / 0 | 2,028,732 | 139.2 |
| 20-fall-ground-level | null | medium | 1133 / 1133 / 0 | 1,329,716 | 139.8 |

Lights unchanged, none starved, no GPU error in any shot.

## 4. The five done-whens, measured

Method: PNG decoded with `tools/figure_contrast.load`; warm =
`R > B + 15 && R > 60`; the band is x 1340-1480, y 490-600 (140 × 110 =
15,400 px); luma is the mean of R, G, B.

### 1. Wall warm share in the band

| | warm px | share | mean RGB | px ≥ 250 | max R-B |
|---|---|---|---|---|---|
| 3l baseline 08-03-24 | 12,174 | 79.1 % | (93.3, 72.4, 55.9) | 0 | 66 at (1388, 520) |
| **3m 10-36-13** | **3,635** | **23.6 %** | **(46.5, 37.3, 38.0)** | **0** | 61 at (1394, 501) |

**79.1 % → 23.6 %, a 55.5-point drop**, and the mean is now blue-biased (B > R),
where the baseline was warm-biased. Nothing clips: 0 pixels at or above 250, max
R-B 61 (in the lit roof edge, not on the boards). The frame's whole-image warm
share at pose 20 falls 5.903 % → 4.393 %.

The inherited single-board version (`10-18-49`) measured 27.4 % with mean
(50, 38, 37): the cold `SHEET` colour and the reveals took the band from
there to 23.6 % and made the boards countable.

### 2. Countable dark apertures or edges crossing the band

Dark components in the band (luma < 40, 4-connected, ≥ 6 px): **8 in the 3l
baseline, 13 now**. The rhythm of the band, from the row-mean luma over
x 1340-1480 (a local profile, not the mean, shows the reveals at 48-52 and
41-50 against 30-41 and 23-29 for the boards):

| feature | rows | band luma |
|---|---|---|
| lit roof edge (pre-existing) | y 499-515 | 62-85 |
| **fascia board 1** | y 517-533 | 38-48 |
| **reveal 1** (lit seam) | y 535-537 | 48-52 |
| **fascia board 2** | y 539-555 | 30-41 |
| **reveal 2** (lit seam) | y 557-559 | 41-50 |
| **fascia board 3** | y 561-573 | 23-29 |
| **door head** (pre-existing) | y 575-585 | 12-21 |

So **four countable dark bands** cross the band (three boards and the door head),
separated by **two lit reveals**, which are the warm apertures. The pilasters
are visible in the 2× crop as cold uprights framing the door, but they do not
separate from the boards at 1×: at y 525 the left pilaster's columns read 43-49
against 41 for the board beside it, and the right pilaster's columns read
29-36. I am not claiming them as countable features.

### 3. Pool preserved

Peak lift at y 730-739 against `shots/2026-10-22T07-21-31`: **+52.5 luma**
(baseline 78.0 → 130.5), above the +45 floor. The transect shape is unchanged:
+8.4 at y 720-729, +52.5 at 730-739, +51.6 at 740-749, +47.3 at 750-759,
+38.5 at 760-769. Nothing stands in front of the pool: the fascia is on the
wall at world y ≥ 1.90 m and the pool is on the floor at the wall's base.

### 4. Controls

| pose | 3l | 3m | move |
|---|---|---|---|
| 16-fall-wreck-up | 0.115 % | 0.116 % | +0.001 pp |
| 17-fall-piles-level | 0.293 % | 0.290 % | −0.003 pp |
| 18-fall-skyline | 1.340 % | 1.337 % | −0.002 pp |
| 19-fall-pile-close | 2.077 % | 2.079 % | +0.001 pp |

All within the 0.03 pp gate. No GPU/WGSL error; tier uniform (`q:medium` on all
five, 1600×900).

**A note on the noise floor of these controls.** Pose 17's warm share is noisy
at the 0.08 pp level between runs that differ only by geometry: measured over
six runs (3j, 3l, two intensity experiments, and two runs of this round) it
ranges 0.212 %-0.293 %. The two runs of this round differ only by the fascia's
shape and their pose-17 shares differ by 0.002 pp, so the control's movement
here is at the noise floor, not from the change.

### 5. Full-frame read

I opened the frame (`shots/2026-10-22T10-36-13/20-fall-ground-level.png`, and
2×/6× crops of the hut). What I see, stated as an observation and not a
verdict:

- The hut's front face is now a **cold dark boarded band** with two warm
  seams, a dark hood over the door, two uprights framing the door, and the
  lamp-lit roof edge above it. It reads as a structure, not as one field.
- The warm punctuation in the frame is the lamp head, the roof edge, the two
  reveals, the pool at the wall's base, and the old city's windows. The wall's
  own warm area is a small part of the frame now.
- The lamp is still visibly the source: the head on its bracket, the wash on
  the roof edge and the pool below.

Whether this reads as *section B* is the reviewer's judgement on the frame, not
mine.

## 5. Cost

Geometry, so the cost is real and stated:

- **G-buffer triangles, pose 20: +720** (1,328,996 → 1,329,716). Per pose:
  16 +1,512, 17 +1,440, 18 +1,224, 19 +792, 20 +720.
- **Per hut: 6 boxes = 36 quads = 72 triangles** (3 fascia boards, 1 hood,
  2 pilasters), times the number of winch/workshop huts in the visible chunks.
  Zone-wide the ground pass goes 55,762 (the single-board version) → **57,226**
  triangles citywide, winding 0 bad of 57,226.
- Lights unchanged: 1133 delivered at pose 20, 0 starved, 1405 at pose 18.
  Frame time 139.8 ms, unchanged.
- The LOD 2 merged path, the pool term and the bracket are untouched.

## 6. The runs before this one, and why they were not shipped

Both are in `shots/` and both were measured; neither is the deliverable.

| run | change | band warm share | why not |
|---|---|---|---|
| `10-18-49` (commit 6903208) | one near-black board over the whole face | 27.4 % | a slab in a new colour: one 10,315 px black mass, pilasters merged into it, no aperture |
| `10-33-26` | three boards split by two *vertical* reveals at a = ±1.3 m | 20.7 % | the reveals land at x 1278 and 1522 — outside the measured band, so the band still had one mass; the warm share looked good for the wrong reason |
| **`10-36-13`** | three boards split by two *horizontal* reveals; pilasters at the jambs | **23.6 %** | shipped: the reveals land inside the band and read as warm seams |

## 7. What I did NOT establish

- **The verdict.** Whether the face now reads as section B is the reviewer's.
- **The workshop yard.** Every third winch uses `frontFace` with `halfWidth 3.2`,
  `doorA 1.2`, `doorHalf 0.6`, `doorTop 2.0`, `eave 3.4`; no judged frame in
  this run contains one, so its read is unverified, as in every previous round.
- **City-wide frames.** `wide-skyline` and `aerial-top` were not in this run.
- **The specular (PART 10's deferred clause).** Not delivered; unchanged from 3j.
- **Shadows.** The claim that the work lamps cast none is verified by reading
  the shader, not by a test that a hood fails to shade the wall. What is measured
  is that the wall's warm area fell.
- **Why the reveals read warm.** The geometry says the lamp-lit cladding shows
  through the gap; the measurement confirms a lit row (48-52 against 30-41 for
  the boards) but the frame does not prove which surface is being seen through
  it.
- **A lit window was deliberately not added.** The reference carries warm as lit
  window panes, and a small emissive pane in the fascia would be the literal
  version of that, but it would be a second light source on a hut whose whole
  case is that the lamp is its source. That is a call for the reviewer, and the
  two reveals are the version that keeps the lamp as the source.

## 8. The one thing I am least sure about

Whether two warm seams across a cold band read as *apertures* at frame scale.
The measurement is clear — three countable dark boards, two lit reveals, warm
share 23.6 %, mean RGB blue-biased — but a 5 px warm line at 13 m is a thin
thing, and at 1× I cannot tell whether it reads as an opening or as a scratch
of light. If the reviewer reads it as the latter, the next move is not more
seams but fewer, larger warm apertures: fewer boards with the gap between them
widened so the lit cladding behind reads as a pane rather than a line, at the
cost of warm area in the band (each 0.08 m of gap is ~5 px × 140 rows ≈ 700
warm px, ~4.5 points of the band's share).
