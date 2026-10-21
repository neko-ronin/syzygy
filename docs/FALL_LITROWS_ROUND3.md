# Round 3a — the lit row at blue-hour distance

**Mechanism: emissive geometry, not lights.** Lit *area* was the lever; a brighter
single point is what had already failed. In `src/render/fallvillage.ts`:

- **Near (lod < 2, `dressFaces`).** The lit pane was 0.56 × 0.32·tall (~0.5 m²). It is
  now a framed **bay**: 0.4 of the box's length (cap 2.4 m) × 0.46 of its height, with its
  own jambs, head, sill and two mullions so it reads as glazing up close. **Every dressed
  face lights its first bay**, so a crown carries several at different heights instead of
  one dot (sheet B, frame 2: the column carries lit blocks at several heights).
- **Far (lod ≥ 2, `mergedBlocks`).** 0.6–1.1 m panes became 1.7–2.9 m bays, 2–4 per row,
  on two heights of the merged mass. The probe `src/render/__probe_litrow.ts` projects them
  into pose 18's own camera: the 62 columns in frame sit 193–1185 m out, so a bay is
  11.7 × 5.8 px at 193 m and 1.9 px at 1185 m — blocks at the near end, points at the far.

**Cost, `shots/2026-10-21T23-08-14/_capture.json`** (D32 budget: ≤2% of the hero):

| pose | G-buffer triangles | delta | lights delivered | starved |
|---|---|---|---|---|
| 16 | 1,050,418 | +560 | 1189 | 0 |
| 17 | 924,654 | +1,056 | 1107 | 0 |
| 18 | 1,277,608 | +956 | 1383 | 0 |
| 19 | 2,016,106 | +1,304 | 1107 | 0 |

Worst case +0.06% of G-buffer triangles. **No light bins added** — delivered and starved
are identical to the 22:19 control, which is the point of choosing geometry.

**Run.** `shots/2026-10-21T23-08-14`, PASS, 5 shots, 50.5 s, no GPU/WGSL error, **app ready
(frameCount=341)**. `tsc --noEmit` and `vite build` clean; citygen and fallzone self-tests
report no violations.

**What it did not fix.** At 16 the shaft faces are still blank: the pose looks up two bare
pier sides and the village sits at the top of frame, so the bays are not in shot and the
frame has nothing warm in the zone at all. The crown at 18 also still reads as one small
warm mark on a dark stack — the far bays landed (visible at 19) but 18's nearest fall column
is 193 m out on the merged LOD, and one row of 6 px bays is not yet rows of blocks.
*Caveat: this capture was shot before the last edit — the far panes' face offsets were
corrected afterwards (they sat at 0.55 of the pile's half-extent while the merged blocks'
faces are at 0.94/0.78/0.55, so on the wide blocks they were buried). The next capture will
show more far bays than these frames do.*
