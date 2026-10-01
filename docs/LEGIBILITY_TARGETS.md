# Legibility and repetition targets

Quantitative acceptance thresholds for street-level crowd legibility and market
repetition. Produced by the vision agent (Codex, acting as visual-developer) on
2026-09-30, at the request of the orchestrator, after `docs/REVIEW_GATE_1.md`
returned `more work needed` on both counts.

**Separate pixel measurements, visual estimates and proposed acceptance targets.**
The contrast samples below are measurements; canopy periods and angle/height
variation are visual estimates; acceptance thresholds are design proposals, not
measured reference rules or validated recognition minima.

**Recovery audit:** the complete original response and pixel-probe code survived
in the persisted Codex session `01a0f49f-d7c8-75b1-9f68-1ce110298af4` (response at
JSONL line 436; final contrast probe at lines 414/417). This corrects the partial
transcription in `d47ddcf`. All six contrast ratios were reproduced from the
original image files during this audit. No captures were run.

Source images: `shots/market/{day-down,day-three-quarter,night-down,night-three-quarter,night-along-the-row,night-looking-back}.png`,
`shots/2026-10-01T03-15-29/01d-street-crowd.png`, and
`references/sections/B-cold-industrial/03-snow-ropeway.jpg`.
All coordinates are native image pixels, with origin at the top left; comparisons
and enlarged crops are inspection aids, not the measurement resolution.

---

## 1. Market repetition — the canopy row

### What could and could not be measured

Market frames are **1600 × 900**. These regions, periods and counts were
**estimated visually**, not recovered from generator data:

| Run | Approximate region `(x, y)` | Projected period | Consecutive similar canopies |
| --- | --- | --- | --- |
| `day-down.png`, right row | `1050–1600, 395–560` | **45–80 px** | **8–10** |
| `day-down.png`, left row | `90–430, 395–580` | **55–105 px** | **4–5** |
| `day-three-quarter.png`, right row | `1030–1510, 400–575` | **35–70 px** | **7–10** |

The longest clear run contains **at least eight similar modules without an
obvious silhouette change**. Perspective changes the projected period; these
ranges do not measure physical stall-width variation.

| Property | Finding |
| --- | --- |
| Height | **Estimated** departures from the receding roof envelope are roughly **3–8 px**. No conspicuous taller or lower module interrupts the run. |
| Width | Projected widths vary substantially with depth. **Independent width variation is not reliably measurable** from these oblique views. |
| Colour | Dark/brown and ochre areas are visible, but neighbouring roofs repeatedly reuse that arrangement. **No defensible percentage** — lighting and stripe placement prevent a colour variance statistic. |
| Pitch | **Estimated** neighbouring projected roof-edge angles differ by roughly **5-10°**. Different roof types are not apparent at a glance. |
| Night frames | `night-down.png` preserves the repeated row outline. The other three night frames are **too dark to count roof boundaries or measure variation confidently**. |

### The reference cannot supply this number

`references/A-saturated-sheet.jpg` and `references/sections/A-saturated/02-cablecar.jpg`
contain **no identifiable market canopy row** from which to derive a repeat period
or a maximum run length. Their repeated façade elements are not interchangeable
with stalls.

`docs/STREET_SPEC.md` §C says the opened set contains **no sufficiently legible
night market to specify a complete stall**: no frame exposes vendor counter,
merchandise, canopy supports and customer aisle together. This does not establish
that markets are absent, or that every market relationship is invented.
**Stall construction, canopy height, merchandise and the numeric repetition rule
remain design hypotheses.** Warm pedestrian light against cool violet/blue
surroundings, with people and edge structures breaking up the route, is supported
by the references.

### Pass criterion

> **No more than three consecutive near-identical canopy/counter modules. Every
> fourth module must visibly change roof silhouette or counter arrangement at
> normal image size. Recolouring an otherwise identical roof does not count as a
> typology break. Check both daylight angles; variation visible only when enlarged
> fails.**

Note the consequences:

- Recolouring alone does not count. **Roof silhouette or counter arrangement**
  may supply the visible break; the original criterion did not require roof
  silhouette alone.
- Both daylight angles. A typology that reads from one camera and not the other
  has not passed.
- Three of four night frames being too dark to evaluate is itself a problem: a
  market you cannot see is a market you cannot review.

---

## 2. Crowd legibility at 20 px

Frame sizes: the named street frame is **1600 × 900**; the specific B03 reference
`03-snow-ropeway.jpg` is **900 × 1614**. Both dimensions were rechecked. These are
native pixels, not equally scaled display sizes; the note does not describe the
B contact sheet or every B image.

### The finding that corrects the obvious fix

**Only our dark lower band** exceeds all three sampled reference ratios while
failing to separate into people. Our orange upper band has much lower contrast.
**Contrast alone is insufficient**; the measurements do not establish that
contrast is adequate everywhere or that improving it can never help.

Method: linearise each sRGB channel, then calculate
`L = 0.2126 Rlinear + 0.7152 Glinear + 0.0722 Blinear` per pixel. Use the median
patch luminance (the upper middle sorted value for even-sized patches), then
`(Lbright + 0.05) / (Ldark + 0.05)`. Boxes below are `(x, y, width, height)`.
These are **local samples, not whole-person averages**, and the output band
samples do not certify individual pedestrian identity.

| Sample | Foreground box | Background box | Foreground / background L | Contrast |
| --- | --- | --- | --- | --- |
| Our orange upper band against façade | `(445,474,3,6)` | `(445,440,6,6)` | `0.257074 / 0.199721` | **1.23:1** |
| Our dark lower band against pavement | `(445,495,3,8)` | `(445,520,6,8)` | `0.080704 / 0.743406` | **6.07:1** |
| Our pale isolated mark; identity **uncertain** | `(1052,466,3,8)` | `(1062,466,5,8)` | `0.473999 / 0.728487` | **1.49:1** |
| Reference, 16 px dark footprint | `(550,1067,3,6)` | `(558,1067,4,6)` | `0.163624 / 0.540418` | **2.76:1** |
| Reference, 19 px dark footprint | `(587,1081,3,6)` | `(575,1081,3,6)` | `0.209613 / 0.521737` | **2.20:1** |
| Reference, 26 px dark footprint | `(527,1138,3,6)` | `(541,1138,3,6)` | `0.279612 / 0.411098` | **1.40:1** |

The **16, 19 and 26 px** heights are thresholded dark footprints, not exact
whole-person heights: four-connected components at **L ≤ 0.32**, in reference
region `x=490–594, y=1040–1164`. Their inclusive boxes are respectively
`(549,1061)–(554,1076)`, `(584,1074)–(592,1092)` and
`(524,1129)–(531,1154)`. Blurred outer edges may extend farther. The **16–19 px**
examples read as crowd members through isolation, rounded/tapered outlines and
irregular spacing; consistently distinct heads are not established.

### What could not be established

Our frame does **not** establish a reliable minimum height at which an isolated
pedestrian becomes recognisable. The left band remains merged even where its
vertical extent is much greater than 20 px. The narrow isolated mark around
**(1052, 466)** could not be confidently identified as a pedestrian. Its **1.49:1**
local mark/background contrast was measured; **confirmed pedestrian contrast**
was not. The transcription lost that distinction.

### Acceptance thresholds

**Proposed, unchanged from the recovered response.** The **2.5:1** target is
stricter than two reference samples (**2.20:1** and **1.40:1**); it is not an
empirically established minimum for person recognition. Meeting the numeric
targets without an identifiable body still fails.

```
At 20-24 px height:
  a separately identifiable BODY, with at least 2 px of background separation
  from neighbouring bodies, plus >= 2.5:1 torso/background contrast.

For explicit head separation, use 32 px as the acceptance sample:
  a head approximately 4 px across, with a visible shoulder narrowing / neck
  of at least 1 px.
```

### The limitation to design around

In the reference, distinct head/neck separation becomes unreliable below
approximately **25-30 px** — *estimated*. Smaller figures can still read as people,
but the agent's advice is **not to preserve heads merely to preserve heads**.

**So: do not chase head geometry at 20 px. Chase body separation.**

The left-edge band merges into a continuous strip. **Exact nearest-neighbour
gaps are uncertain**: the recovered pass did not measure them. **At least 2 px**
is the proposed acceptance gap, not evidence that current agents were measured
at or under 2 px. Measure screen-space silhouette separation before increasing
headcount; more instances alone cannot establish legibility and may worsen
merging.

---

## 3. What to measure

### The missing far-end finding and target

The distant street zone is approximately **`y=450–525`**, a **75 px** vertical
band: about **17%** of the projected **450 px** street-depth span from horizon
to image bottom. It contains no unambiguously recognisable separate people.
This is a **screen-space fraction**, not 17% of world-space street length or an
area percentage; strict person legibility remains uncertified elsewhere too.

**Proposed far-end target: at least 20 distinguishable figure silhouettes**
distributed across the visible pavements in that zone, **with gaps between
groups**. A continuous orange/grey band fails regardless of instance count.
This is a design target for the named pose, not a reference-derived headcount.

### Follow-up instrumentation

The reviewer's brief, restated as instrumentation:

1. **Mean and minimum nearest-neighbour separation in screen pixels**, for agents
   in the 20-30 px band. Near-zero silhouette-edge gaps flag touching or overlap;
   inspect the masks and placement before selecting a fix.
2. **The fraction of projected street depth carrying no legible figures.** The far
   end of the street reads largely empty. That is the real target: fill it with
   readable groups **with gaps between them**, not with a continuous band.

Watch for the opposite failure. `PITFALLS.md` §9 is the clump failure — raising
density without fixing distribution produces a clump. Groups with deliberate gaps
are the opposite of uniform density, and the measurement should show that.

---

## 4. What a lit market aisle has to look like

The review gate's single named gap was that warm lantern illumination does not
visibly reach the aisle. The original measurement response supplied a more
specific **proposed pass** that the transcription omitted:

> At least **three successive warm ground pools** reaching the walking aisle,
> with centres roughly **1.5–3 times the linear luminance** of adjacent cool
> pavement, and **surface joints or contact shadows still visible inside them**.

Glowing lanterns above unchanged black ground, a uniform orange wash, or white
bloom that erases the paving still fails. This is a proposed local luminance
multiple, **not** the contrast-table ratio with its `+0.05` offset, and was not
measured from reference lantern pools. Pool/background sampling regions were
not specified in the lost pass and remain **uncertain**; use the same night
exposure and record the regions when testing it.

The reviewer's qualitative test remains:

> Make a market lantern produce a clearly luminous warm core and a visible warm
> pool on the adjacent walking surface at the reviewed night exposure.

The transcribed **365 generated lights / 0 reaching `BakedChunk.lights`** is
absent from the recovered measurement response. Its self-test provenance is
**uncertain** in this audit; it is not a pixel measurement or a certified current
plumbing status. `REVIEW_GATE_1.md` explicitly left the lighting cause unverified.

---

## 5. What I would measure differently now

- Fix display size, zoom and exposure before judging recognition. Measure native
  pixels as above, but also compare references and output at a declared common
  display scale; these differently sized frames are not calibrated equivalents.
- Record identified body masks and adjacent background masks, full-body heights,
  and nearest **silhouette-edge** gaps. Report gap distributions and overlap
  separately; centre distances or a few high-contrast patches can conceal merges.
  Validate the proposed 2.5:1 target against recognition rather than treating it
  as proof of recognition.
- Count far-end silhouettes within a recorded pavement mask and report where
  groups and gaps occur. The original 17% is only projected vertical depth.
- Annotate canopy boundaries and repeat runs at native scale in both daylight
  angles. The period, height and pitch ranges above remain estimates; projected
  roof-edge angles do not measure physical roof pitch.
- Define pool-centre and adjacent-pavement patches before evaluating the proposed
  1.5–3× target, and check construction detail inside each pool at the same
  exposure. No new render or temporal legibility measurement was made here.
