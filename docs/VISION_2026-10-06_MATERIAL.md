# Market walking ground: material review

**VERDICT: more work needed.** The current daylight ground has visible small
dark flecks and a warmer pale value, so it is no longer completely featureless.
At the intended whole-frame size it still reads mainly as one flat speckled
plane. Paving courses/joints and a distinct carriageway material do not explain
the counter-side walking strip clearly enough to close the ground gate.

This is independent of the material implementation. I reopened the A and B
sheets, generated and opened the explicit before/current/reference grid and
sidecar, and opened all four original daylight/night images. I did not capture,
alter images, or edit material, geometry, crowd or lighting code. The narrow
`compare.mjs` directory-option repair makes the comparison's sources explicit;
it does not supply visual approval.

EVIDENCE:

- [A sheet](../references/A-saturated-sheet.jpg),
  [B sheet](../references/B-cold-industrial-sheet.jpg)
- [BASELINE | CURRENT | REFERENCE grid](../shots/compare/2026-10-06T23-29-22.png)
  and [source/section sidecar](../shots/compare/2026-10-06T23-29-22.txt)
- Baseline [daylight](../shots/2026-10-06T22-46-31/10-hero-walk-day.png),
  [night](../shots/2026-10-06T22-46-31/10-hero-walk-night.png),
  [scene](../shots/2026-10-06T22-46-31/_scene.json)
- Current [daylight](../shots/2026-10-06T23-27-56/10-hero-walk-day.png),
  [night](../shots/2026-10-06T23-27-56/10-hero-walk-night.png),
  [scene](../shots/2026-10-06T23-27-56/_scene.json) and
  [capture record](../shots/2026-10-06T23-27-56/_capture.json)
- [Hero requirements](HERO_FRAME_SPEC.md), [roadmap R1](ROADMAP.md#r1--make-street-level-read-as-inhabited)
  and [corrected-subject review](VISION_2026-10-06_SUBJECT.md)

JUDGED: **near paving scale and the visual identity of walking ground versus
carriageway, at this market view.** Crowd shape/contact, raised kerb geometry,
night exposure and city-wide finish are separate gates.

## Comparison identity and its limit

The sidecar names the actual before/current directories and maps both rows to
section A. The right column is the A sheet. A's blue stair passage and warm
walkway explain constructed ground beneath people; B's stair view provides
another route with legible changes of surface and scale. These are structural
material/use references. Neither is a phase-matched full-night market exposure
target, and this review does not request stair geometry on a flat market aisle.

The saved hero, time, camera fields, lens, weather, crowd buffers/count, vehicles
and traffic lights match byte-for-byte across runs. Both have 131 residents and
identical ordered coordinate/LOD identities. Ninety-one residency **versions**
differ across the rebuild, which is distinct from different residency coverage.
The current scene records replay from the named baseline and corrects the old
descriptor wording to actual bake-emission provenance. These records provide
substantially better control evidence than the earlier invalid replays.

However, the opened images still show a depth-dependent projection shift despite
matching saved camera fields. Approximately, the closest brown head's top moves
from y414 to y375, and the near counter top/end moves from y677 to y647; the far
cable shifts less. The image size remains 1600 × 900. This is visible framing
change, not a material measurement. It is consistent with the reported camera
matrix/bob ordering repair, but I have not established the old rendered view
matrix. **Matching saved pose fields do not prove identical rendered projection.**
The cause of all before/after differences therefore cannot be assigned solely
to material. The current frame can still be judged against the ground requirement
on its own. A strict isolated material comparison needs rendered view/projection
equivalence or a before rebuilt under the corrected camera path.

## What the current material shows

The daylight foreground contains many small scattered dark marks. They remain
visible in the grid's current tile as well as the original. Broad low-frequency
colour patches and some faint linear seams also vary the surface. This gives
the near ground more surface activity than the smooth baseline, but the marks
read primarily as aggregate/speckles scattered across a continuous pale plane.
They do not yet give the eye a stable paving-unit size or a sequence of courses
that follows the walking strip into the middle distance.

There are short edge/seam marks at the lower margins and under the right
frontage, but they do not organize the broad foreground strongly enough to
explain where one paving unit meets another. The brown line crossing the left
foreground and receding through the market remains the strongest ground
boundary. The two adjacent regions do not read as clearly distinct paving and
road materials at whole-frame size. I cannot use authored tags or a selector's
surface name to promote them into that visible distinction.

The current near counter is a useful scale cue, but its broad top/end and nearby
people dominate the floor read. The small flecks beneath them provide texture
without enough construction. This is an incomplete ground-material result;
the separate rectangular crowd read does not explain away the missing paving
scale, and better people would not close it automatically.

At night, flecks survive weakly inside the warm patch on the left while the
counter-side ground and front remain very dark. That image cannot establish
readable paving courses or carriageway identity. It does not isolate whether
material, illumination or the projection correction caused the change. The
night received-light gate remains open, without being folded into this ground
verdict.

GAP: **surface activity is visible, but pavement construction at human scale
and its distinction from the adjacent road remain weak.**

NEXT: **make paving courses/joints and their scale readable along this same
counter-side route, with a visibly different adjacent carriageway surface.**
Use current `23-27-56` as the new baseline. Save and compare the actual rendered
view/projection matrices on the next coherent material change. Do not spend
another capture round reconstructing the historical before solely for control.

CONFIRMED: **small-scale near-ground surface variation is visible.** The R1/hero
ground requirement is not confirmed as complete: the route still reads as a
broad pale speckled slab, rather than a finished constructed walking surface.
This review does not close raised kerb, human shape/feet contact or movement,
night frontage lighting, district variety, city-wide richness or 60 FPS.

**Round reflection:** this is still a frame-first ground-material review. The
new surface is visible and the remaining gap is concrete. More amplitude in
fine grain alone would characterize the same slab; the next useful build is
readable paving construction and surface distinction, with an honest control.
