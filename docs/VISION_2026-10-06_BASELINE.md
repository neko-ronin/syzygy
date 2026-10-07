# Market Spine Counter Walk: initial photographed baseline

**VERDICT: more work needed.** The saved daylight view reads as a broad empty
grey floor beside a large wall, with small market structures farther away. The
night view loses that construction in darkness and leaves warm floor patches
beneath hanging lights. Neither image establishes the specified inhabited
counter-front route. The pair also lacks complete geometry control, so it cannot
decide whether changing phase alone caused the differences.

This is an independent review of the street work: I did not implement the street,
hero derivation, lighting, or capture pair. I opened the A and B sheets, then the
comparison grid and its text sidecar, then both original 1600 × 900 images.
No capture, browser run, image alteration, or city implementation edit was made
for this review. My separate orchestration-preflight repair does not supply
visual evidence or approve capture health retrospectively.

## Evidence and limits

EVIDENCE:

- [A saturated-graphic reference sheet](../references/A-saturated-sheet.jpg)
- [B cold-industrial reference sheet](../references/B-cold-industrial-sheet.jpg)
- [Comparison grid](../shots/compare/2026-10-06T22-41-17.png) and
  [sidecar](../shots/compare/2026-10-06T22-41-17.txt)
- [Daylight original](../shots/2026-10-06T22-40-29/10-hero-walk-day.png) and
  [night original](../shots/2026-10-06T22-40-29/10-hero-walk-night.png)
- [Capture record](../shots/2026-10-06T22-40-29/_capture.json) and
  [saved scene](../shots/2026-10-06T22-40-29/_scene.json)
- [Hero-frame requirements](HERO_FRAME_SPEC.md), [previous review](VISION_ROUND13.md)
  and [review gate](DESIGN.md#6-task-close--the-review-gate)

The grid contains CURRENT | REFERENCE columns, without a baseline column.
Its sidecar maps **both** rows to section A. The right column really contains
the A sheet, not a duplicate of the render. A's cablecar/walkway relationships
support independent people, constructed walking ground, and passage into depth.
B's snow-ropeway image supports continuing occupation on a legible route.
Neither sheet supplies an approved, phase-matched full-night market exposure.
The A reference beside the night row is structural guidance, not permission to
make night match its daylight values.

The saved camera position and view direction match between the two captures.
The record retains a shared scene snapshot and reports no capture error. However,
residency changes from **127 chunks, LOD histogram [9,118,0,0]** in daylight to
**131 chunks, [9,122,0,0]** at night. A drained rebake queue does not freeze new
streaming. This is **not a fully controlled geometry/detail pair**.

The scene record explicitly limits subject provenance to descriptor/field data,
not emitted-mesh surface readback. The street engineer separately reports that
the ground-bake context used seed zero while the hero descriptor used seed
6191639, and is repairing that authority mismatch. I did not reconstruct that
source diagnosis for this review. The metadata cannot currently bind the named
counter/support/walking subjects to the photographed emitted market. Their
required relationships are not visible; that does not prove their geometry is
absent elsewhere, or select a lighting/shader cause.

The saved roughly **20–23 FPS** figures are warming capture snapshots. They are
not a controlled Chrome traversal benchmark, proof of sustained display rate,
or evidence that the 60 FPS target has been achieved or fully assessed.

## What the frames show

JUDGED: **human scale, near frontage, walking-ground material, route continuity,
and received night light at this view.**

In daylight, a nearly continuous pale-grey plane occupies the foreground and
extends into the middle distance. Large soft patches and faint seams vary it,
but they do not give this close ground a convincing paving scale or separate
walking surface from carriageway. A long brown/yellow horizontal member crosses
the lower foreground. A dark diagonal at the right runs along the wall and
toward the lower edge. Those isolated lines do not explain a higher footway,
kerb top, descending face, and lower road together. This frame cannot close the
separate raised-kerb gate.

The right foreground is dominated by a smooth grey wall and an ochre panel at
the edge, with an upright block in front. Small canopy-and-post frames and
yellow/brown objects appear farther across the open floor. I cannot identify a
near working counter front and end, its supporting construction and canopy
attachment, beside a clear passing strip. The eye crosses vacant floor toward
distant objects; it does not follow a supported, inhabited counter-side route
from approach to exit.

No independently readable near heads, shoulders, legs and grounded feet occupy
the required strip at whole-frame size. Distant marks cannot establish whether
the selected frontage has counter users or whether occupation continues through
its middle to the exit. This is a failed local occupation/framing result, not
proof that the crowd is missing from the world. It also cannot assess movement,
avoidance or body intersection from two still images.

At night, most of the right foreground and middle route become near-black.
Several hanging fittings remain warm, and broad amber patches spread across
the lower-left ground. The patch does not reveal a readable counter front,
canopy underside, independent bodies, or successive occupied frontage. The
black horizontal and diagonal interruptions remain prominent against the lit
floor, while the adjoining construction loses identity. Faint cool towers are
background depth; they do not replace the missing human-scale relationships.

Both images fail the required route read individually. Because subject binding
and complete geometry control are unresolved, I cannot choose the hero spec's
causal classification “darkness hides the same unresolved street” or “lighting
destroys an otherwise resolved street.” Daylight has not supplied that resolved
street, and the pair is not yet the required control.

GAP: **The camera/provenance does not expose the actual supported, occupied near
counter-front strip and its continuation.** Ground and night readability also
remain open, but changing their appearance cannot repair a subject mismatch.

NEXT: **Bind this hero to the actual emitted market run and freeze its complete
residency before the next daylight/night pair.** Keep the specified near
counter front/end/support, adjoining walking ground, middle frontage and exit
in the held view. This is one subject-and-control repair, not a request to fill
the open floor with random people or brighten the whole scene.

CONFIRMED: **No complete hero done-when clause is met.** In particular, the
standing requirement “These relationships must coexist along the same route in
the same image” is unconfirmed in each phase, and “Hold the world/generation
identity, selected slot/run identities, emission coverage, camera transform,
framing and image size fixed” is not established for the photographed subjects.
The narrower completion is that daylight and night **baseline image artifacts
now exist and have been opened and reviewed**. That closes the lack of any
photographed baseline; it does not approve the controlled hero pair, street
material, raised kerb, crowd behaviour, or received market light.

There is no wide city frame in this evidence. Section finish, district variety,
city-wide richness and the anti-homogenisation clause remain unjudged. There is
also no same-pose implementation-before frame here, so this review makes no
claim that an implementation change improved the image.

**Round reflection:** this is still a frame-first baseline review. The frames
expose a failed route read and a control/provenance gap. The next useful action
is the single subject-and-control repair above, followed by opened pixels; it
is not another numerical aesthetic threshold or an implementation-derived pass.
