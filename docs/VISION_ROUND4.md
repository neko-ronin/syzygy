# Captured crowd band — vision close-out

VERDICT: **more work needed**

EVIDENCE: Opened the supplied
[crowd-enabled street capture](../shots/2026-10-02T20-50-51-01d-street-crowd.png)
and [entity-draw-disabled control](../shots/2026-10-02T21-04-00-01d-street-crowd.png),
plus the [A reference sheet](../references/A-saturated-sheet.jpg) and
[B reference sheet](../references/B-cold-industrial-sheet.jpg). I inspected
near and middle band crops made directly from the supplied enabled PNG;
these were inspection extracts, not a re-derived pose. The source PNGs were
unchanged. No capture, comparison harness, browser or server was run.

JUDGED: **The band in this captured frame is pedestrian geometry.** At the
near end, small head blocks sit above broader coloured torsos; side-arm steps
protrude beside the torsos, and narrower dark lower bodies extend towards the
ground. I cannot find clean gaps between walking legs. The enabled image
repeats this head/torso/arm/lower-body construction along the diagonal. The
control removes that band while the thin fixed ground lines and wall-mounted
objects remain. Together, the local construction and the control settle its
identity here. A projecting-sign interpretation of another camera view does
not describe this captured band.

**Its identity and its visual read diverge.** The red, ochre, olive and cool
cloth colours add a strong warm/cool accent against the teal enclosure. But
the head and shoulder boundaries merge into a continuous cap, the torsos
form a coloured panel ribbon, and the dark lower bodies form a comb. At
whole-frame scale the eye follows a solid divider towards the vanishing
point. It does not find people occupying the street independently. Magnified
recognition of the mesh does not establish readable human scale in the frame.

Against the deciding conditions in [the earlier vision judgement](VISION_ROUND1.md):

- **Readable grounded bodies:** fails. Anatomical parts can be identified in
  the crop, but bodies do not separate from their neighbours in the whole
  image. The dark lower band does not establish independent feet and ground
  contact. This is the merged-bar failure already named in the gate.
- **Occupation belonging to the route:** not satisfied. The line establishes
  alignment, but no readable passing stream, counter-facing occupation or
  destination relationship. The available low-detail ground cannot certify
  a pavement or frontage relationship. I am not judging missing city detail
  as a crowd defect; the required relationship is simply unproved here.
- **Occupation continuing into depth:** not satisfied. The band recedes
  geometrically, but retains the silhouette of a continuous barrier. It does
  not connect near people to occupied middle distance and a busy destination.
  Perspective continuity of a ribbon is weaker evidence than continuity of
  occupation.

The reference relationships remain useful without treating either sheet as
a phase-matched lighting control. A's cablecar-deck image separates walkers
and their shadows along a bend; B's snowy stair-and-avenue image connects near
walkers to occupation farther along a route. Neither relationship is present
in the captured band. This review makes no judgement about district finish,
base/podium detail, materials or cable density from the supplied low-detail
captures.

**Contribution to the whole frame:** the crowd adds colour and a strong
diagonal, but moves the read towards a fenced foreground. The control exposes
open floor where that divider stood. Enabling the crowd therefore replaces
vacancy with an opaque partition rather than a legible inhabited route. The
lighting and building shadows also differ between the supplied images, so I
do not attribute their entire change in value structure to the crowd gate.
The disappearing band and its local shape are the evidence for this finding.

GAP: **The people collapse into a continuous frontage-like ribbon, erasing
individual human silhouettes and the spaces through which occupation could
read.**

NEXT: **Restore lateral distribution on the actual walking surface**, so
passing bodies can separate in silhouette and retain clear ground between
them. This is the pending implementer's change; I have made no implementation
edits.

**Prediction recorded before the spread result:** the next exposed defect
will be repeated rigid, post-like bodies. The near crop already shows broad
box torsos with arms lying alongside them and narrow, unsplit dark lower-body
columns. Opening space between these forms will reveal their repeated stance
before it establishes the varied walking silhouettes seen in A's deck image.
The recognition failure to watch for is a field of upright coloured markers
even after the continuous ribbon breaks up. This is a prediction from the
captured shapes, not a claim about animation that a still cannot prove. A
spread result with distinct walker postures and readable leg gaps would
contradict it.

**Evidence required next:** these captures suffice to identify and reject the
band. They cannot approve street use or the hero route. Review the spread
result from the actual captured camera and scene provenance, with the nearby
walking surface available, rather than substituting a headlessly re-derived
pose. If that captured state was not retained, create a new held-camera
enabled/disabled pair from a live crowd-derived pose and record the applied
pose before either member. That pair must point at the same subject. Market
Spine Counter Walk still requires its own derived pair as specified in
[HERO_FRAME_SPEC.md](HERO_FRAME_SPEC.md); this street capture cannot certify it.
No additional capture is required to return the present negative verdict.

CONFIRMED: **No complete inhabitation done-when clause is met.** Pedestrian
geometry is visibly drawn, but that does not confirm “people on the
pavements” or that “the far end of the street is visibly busy”. The required
“silhouettes that separate from each other”, “a passing stream on the clear
aisle with counter-facing bodies beside the frontage”, and connection to “a
busy destination further along” remain unmet or unproved. These quotations
are from [the street-level roadmap gate](ROADMAP.md#r1--make-street-level-read-as-inhabited).

**Round reflection:** this remains a review of the supplied captured crowd
and its control. It identifies what the band is, rejects its inhabitation
read, and names the next visible risk before the spread result. It does not
generalise another agent's different pose into evidence about this one, and
does not reopen the renderer fault that the supplied control resolved.
