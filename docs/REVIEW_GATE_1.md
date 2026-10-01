# Review Gate 1 — 2026-09-30 (America/Los_Angeles) — changes in commits cc4bd7d..2360bf9 (repository HEAD 2360bf9); supplied-shot commit provenance unverified.

**VERDICT: more work needed**

**EVIDENCE:** Opened references first, then outputs. Paths are relative to `<repo>`.

- References: `references/A-saturated-sheet.jpg`, `references/B-cold-industrial-sheet.jpg`, `references/D-verdant-sheet.jpg`, `references/C-fire-lit-sheet.jpg`.
- Individual references: `references/sections/A-saturated/02-cablecar.jpg`, `references/sections/B-cold-industrial/03-snow-ropeway.jpg`, `references/sections/D-verdant/02-gardens.jpg`.
- Market: `shots/market/night-down.png`, `shots/market/night-three-quarter.png`, `shots/market/night-along-the-row.png`, `shots/market/night-looking-back.png`, `shots/market/day-down.png`, `shots/market/day-three-quarter.png`. These were the six files listed in that directory.
- Street: `shots/2026-10-01T03-15-29/01d-street-crowd.png`, `shots/2026-10-01T03-15-29/_contact-sheet.png`.
- Earlier output: `shots/2026-09-29T19-30-34/01c-street-crowd.png`, `shots/2026-09-30T01-34-35/01-wide-skyline.png`.
- Existing comparison: `shots/compare/2026-09-30T00-31-39.png` and its `.txt` sidecar. **Excluded from judging:** every reference row repeats one cable-car image, and the sidecar does not establish the correct section comparisons.
- Read `docs/STREET_SPEC.md`, `docs/DESIGN.md`, `docs/ROADMAP.md` R1 and `shots/latest.json`. No captures or file edits.

**JUDGED:**

1. **Ground — value structure and material read: partial.**  
   The new street frame has a **bright, almost white plane**, materially different from the earlier blue-grey slab. It catches broad shadows and contains narrow surface divisions. However, much of its sunlit area remains visually uniform: slab joints and wear do not survive sufficiently to establish close-focus material construction. The market’s daylight ground remains predominantly mid-dark grey; its night ground approaches black. A’s warm pedestrian-plane relationship is not achieved there.

   The street’s foreground transverse edge has a light top and a narrow dark lip, so it reads more convincingly as shallow geometry than paint. **A distinct kerb joint is not legible.** Red market boundaries mostly read as thin lines rather than substantial kerb sections. Some thin orange/burgundy strokes read as painted markings, but they do not clearly organise carriageway versus footway.

2. **Furniture — human scale and placement: mixed.**  
   Market counters, crates and canopy posts are organised into edge rows, leaving a coherent central aisle. This avoids evenly scattering every object across the walking area. **Repetition did happen:** similar pitched roofs and rectangular counters form long, mechanically regular sequences; the street’s left-edge orange/grey forms merge into a fence-like band.

   Several isolated diagonal bars in `day-down.png` lack a readable attachment. **Hypothesis:** these could be misplaced pieces or detached-looking shadows; the still does not establish that they float. Furniture establishes infrastructure more strongly than inhabitation.

3. **Market — silhouette and warm/cool organisation: recognisable structure, unsuccessful night register.**  
   The day frames show two canopy rows, supporting posts, counters and suspended cords: a market skeleton is recognisable. This is explicitly a **design hypothesis**, not a reference match—the references did not establish stall construction.

   Pitched canopy silhouettes are visible against façades. They do **not** demonstrably break a visible sky opening. No distinguishable sky is visible above the aisle in these market angles, although the central aisle visibly remains uncovered. At night, counters and roofs collapse into darkness. **Warm lantern pools do not visibly articulate the path.**

4. **Emissive fix — not visually verified.**  
   In `night-down.png`, the nearest lanterns are subdued grey/cream shapes; farther ones are faint points. In the other three night views, many become black silhouettes. Projecting sign shapes remain predominantly dark. I cannot identify convincing warm light pools beneath the cords.

   **This is too dim, not blown out or blooming into mush.** A’s reference retains a readable warm walking plane against cool surroundings; these frames retain blue façades above an almost black pedestrian zone. Whether the cause is emission, local-light contribution, exposure or capture/build provenance remains **unverified**. The reported wiring change cannot be certified from these pixels.

5. **Shadows — visible, but correctness remains unverified.**  
   The current street frame has broad building-like shadow masses and narrower elongated shadows. The day market also has visible directional shading. I see no unmistakable doubled-shadow pattern or widespread acne in these frames.

   However, the earlier street shot is a different pose, so it is **not a controlled before/after** of the shadow-camera correction. Small object/contact boundaries are insufficiently legible to clear peter-panning or detached shadows. The isolated market diagonals remain ambiguous. **“Every shadow is now correct” is not supported.**

6. **Crowd — insufficient human legibility and distant activity.**  
   Small figure-like forms occur, but the dominant left-edge repetition reads as blocks rather than separate people. The reported approximately 20-pixel individual is not enough to satisfy R1: the far end still reads largely empty.

   **Design hypothesis:** concentrate overlapping, recognisable head/torso silhouettes along visible pavements and market fronts, with gaps between groups. More submitted instances alone would not establish a busy destination.

7. **City-wide check — separately unverified.**  
   The supplied contact sheet contains one street tile, not a city-wide view. The newest wide image found, `shots/2026-09-30T01-34-35/01-wide-skyline.png`, predates this review set. It shows distinct tall teal masses and lower salmon-coloured blocks, but largely uniform grey ground.

   It cannot establish whether the new ground grammars preserved section differences or homogenised them. **No post-change city-wide pass can be awarded from the available wide evidence.**

8. **Single biggest gap:** the night market has no convincingly illuminated walking plane beneath its lanterns.

**GAP:** Warm market lantern illumination does not visibly reach the aisle; the pedestrian zone disappears into darkness.

**NEXT:** Make a market lantern produce a clearly luminous warm core and a visible warm pool on the adjacent walking surface at the reviewed night exposure. The cause must be established before selecting the implementation fix.

**CONFIRMED:** **“that pose is derived from the crowd centroid”** — `shots/latest.json` records the supplied street shot’s derived pose, crowd centroid `(1049, 0)` and camera distance of `18.1 m`.

No other complete visual clause of R1 is confirmed: these frames do not establish **“trams on the rails, cable cars above”**, confidently legible **“people on the pavements”**, or **“a density where the far end of the street is visibly busy”**.
