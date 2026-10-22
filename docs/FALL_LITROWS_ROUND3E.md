# Fall lit rows, round 3e — the row goes on the face that looks out

**Implementer's record. The frames are fall-review's to judge; this file says what
changed, what it measured, and what it cost.**

One change, taken straight from PART 9's close-out: the row's long face is now
chosen by line of sight instead of by the unit's roll.

## What changed

`src/render/fallvillage.ts`, `dressFaces`: of the box's two long faces, the row
(and the face's whole dressing) is drawn on the one whose outward normal points
away from the pile's own axis — the face that stands further out from the axis
than its twin, and the one a stepped pile cannot hide with a layer above it.
`side = sign(a·sin rot + b·cos rot)`, and the face frame's normal, back-left
corner and balcony-reach test are all carried through that sign. If a balcony
would cross the placement record on the outward side, the other face takes the
dressing rather than the face disappearing; that fallback re-admits a few faces
the old test dropped, which is the 104-triangle residue below.

What did **not** change: the face's key (it is keyed to the box's `a`, `b` and
level, not to a side), so seams, grime, skirt, windows and the 2-vs-3 bay roll
all draw from the same stream and no other face re-rolls. The bay (0.4 of the
face, cap 2.4 m), the 0.45 m panel and the LOD 2 path are untouched — the merged
pass never reaches `dressFaces`, and it is unchanged at 2,872 quads / 7,842 m².

## The count, at 18's six nearest columns (run `shots/2026-10-22T03-26-25`)

PART 9's method: warm = `R > B + 15 && R > 60`, 4-connected components, blocks
counted in a box round the row the frame carries; the columns and their boxes are
the ones PART 9 named.

| column | 3c blocks | 3e components | blocks on the frame | where |
| --- | --- | --- | --- | --- |
| id109 (193 m) | 5 | 4 | **3** | x 136-150 (two comps that read as one block) + x 171-173 |
| id89 (228 m) | 2-3 | 2 | **2** | x 621-633, the pair that PART 9 counted |
| id76 (198 m) | 0 | 2 | **2** | x 759-772, y 658-665; 24 px each, on the pool of the old city's grid |
| id124 (225 m) | 0 | 2 | **2**, one a 1 px sliver | x 115 (1 px) + x 119-124 (20 px) |
| id123 (262 m) | 0 | 2 | **2** | x 272-280, x 282-290 |
| id108 (264 m) | 1 | 1 | **1** | x 511-512, the same mark as 3c |

**5 of 6 crowns carry two or more; four of them are unambiguous.** id124's second
component is a 1-px-wide, 4-px-tall sliver: the row is on the face that looks out,
which from this camera is the box's far side, so the box's own near edge clips the
second bay. Counted strictly, id124 is one block and the round is **4 of 6**.
id108 is the other miss and the change did nothing for it: it is a stack, and the
selection's `|a|` tie-break picks the ring's flanks, which this camera sees
edge-on — a face rule cannot reach a box that is not on the camera's arc.

Before/after on the frame, same boxes: id109 5 → 3 (the two blocks at x 163-177
were on the inward face and went with it), id89 2 → 2, id76 0 → 2, id124 0 → 2,
id123 0 → 2, id108 1 → 1.

## What it cost

- **LOD 0:** 542 → 576 lit bays (+34, of which the guard fallback re-admits the
  faces the old reach test dropped), bay-free triangles 90,460 → 90,564, total
  98,048 → **98,628 (+580, +0.59 %)** for the whole 151-column zone.
- **In frame at 18:** 4,891,401 → 4,891,477 triangles (+76), 160 draw calls both,
  1,405 lights delivered, **0 starved**, `error: null`, whole-frame warm 1.31 % →
  1.34 % (no light flood).
- **LOD 2 merged:** 2,872 quads / 7,842 m², byte-identical by construction.

## The near control, 19, loses its row — and that is the rule working

At 19 the container that carried the 4-block band is now dark on the face the
camera sees (`shots/…/19-fall-pile-close.png`, a 68 px component at x 1234-1245
is gone, nothing appears in its place). The camera is 3 m from that box's *inward*
side; the row moved to the outward face. A window that opens into the pile's own
boxes is the thing this round set out to remove, so the dark face at 19 is the
rule's consequence, not a stray. It is still a visual loss at a pose PART 9 praised
and fall-review should weigh it.

## What this round does not establish

- That six of six crowns carry a row. Four do, unambiguously.
- That id108 can be reached by a face rule — it cannot; the pick is the lever.
- That a row survives being seen at a grazing angle on a small box (id124's
  second bay). The panel is right at 0.45 m; the *angle* is what clips it.

Reproduce: `vite-node src/render/__probe_litrow.ts` (now reports `facing/clear`
and the clear-pane runs, the own-pile occlusion PART 9 counted by hand), capture
`--sequence --pose=fall`, then the box count above at pose 18.
