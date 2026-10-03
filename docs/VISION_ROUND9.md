# Kerb form, crowd read and hero composition — captured-frame review

**VERDICT: more work needed on the street, crowd and hero gates, separately.**
The crowd's read is **the same** as the opened baselines. The kerb image
exposes a strong surface graphic, but does not establish the intended raised
street boundary. Neither image is Market Spine Counter Walk. The controlled
daylight/night question remains unanswered.

## Inspection and provenance

I read the saved provenance and capture report before opening the supplied
frames, then opened the reference sheets before judging them. Images actually
opened in this round:

- [Supplied kerb view — 2026-10-03T23-20-15-01g-kerb-face.png](../shots/2026-10-03T23-20-15-01g-kerb-face.png)
- [Supplied crowd view — 2026-10-03T23-21-00-01d-street-crowd.png](../shots/2026-10-03T23-21-00-01d-street-crowd.png)
- [Latest historical crowd baseline — 2026-10-02T23-17-05-01d-street-crowd.png](../shots/2026-10-02T23-17-05-01d-street-crowd.png)
- [Previously reviewed crowd baseline — 2026-10-02T22-45-46-01d-street-crowd.png](../shots/2026-10-02T22-45-46-01d-street-crowd.png)
- [B reference sheet](../references/B-cold-industrial-sheet.jpg)
- [A reference sheet](../references/A-saturated-sheet.jpg)
- [B snow-ropeway frame](../references/sections/B-cold-industrial/03-snow-ropeway.jpg)
- [A cablecar-deck frame](../references/sections/A-saturated/02-cablecar.jpg)
- [Historical daylight market](../shots/2026-10-01T16-10-49/09-market-down-day.png)
- [Historical night market](../shots/2026-10-01T16-10-49/09-market-down.png)

No capture, comparison harness, browser, server, video decoding or code edit
was performed. There is no new comparison grid or grid sidecar in this
review; the supplied raw images and named historical images are the visual
evidence. This is not a section-reskin or city-wide approval.

The [capture report](GROUND_FRAGMENT_DIAGNOSIS.md) identifies these exact
files and records adequate capture headroom, a held derived camera, no skipped
frames and a drained bake queue for each. Those are engineer-reported facts;
I did not rerun the harness. [shots/latest.json](../shots/latest.json) retains
the crowd capture's raw metadata. I found no separate saved raw metadata
file for the supplied kerb capture. Its capture-health record survives in
the report, rather than in an independently inspectable per-image sidecar.

**The claim that the cited histogram contains no finest-detail chunks is
incorrect.** [The renderer](../src/render/renderer.ts) increments the bucket
indexed by each resident chunk's detail level. The first bucket represents
the finest level and is populated in the saved crowd capture. The
[diagnostic audit](DIAGNOSTIC_TRUSTWORTHINESS.md) already records this exact
misreading. A high quality tier is not a substitute for that detail record.

The aggregate histogram does not identify the camera's chunk or the chunk
containing a particular kerb face. The saved crowd metadata does not retain
that subject-specific result. Its warm report's `no-progress` label also
does not establish that the camera lacked detail: the recorded finest-level
bucket is populated and the bake queue is drained. I cannot certify the
subject's full-detail residency from this artifact, but I have no evidence
that detailed chunks were absent across the scene.

That limit prevents me from ruling out missing local detail or diagnosing a
missing kerb face from pixels alone. It does **not** invalidate the judgement
that the visible crowd forms a barrier, or the compositional finding that
neither image follows the specified counter-front route. Those findings
concern large shapes actually present in the frames.

## Street form and strength

VERDICT: **more work needed.** The intended kerb is not legible as a coherent
raised boundary between footway and carriageway. Its face contrast remains
unjudgeable in this capture.

EVIDENCE: The supplied kerb view, the B sheet and B's snow-ropeway frame.
The supplied crowd view provides a second street-level context, not another
close view of this same boundary.

JUDGED: The kerb view's foreground is dominated by a pale blue-grey hatched
strip and a saturated yellow band. Their changes of direction, broad surface
pattern and jagged junctions command attention before the stall fronts.
The surrounding cool-grey ground does not clearly announce which side is
footway and which is carriageway. The yellow reads as a surface marking;
its visibility does not identify the surface beneath it as a kerb.

**I agree that the principal foreground band reads chiefly as a decorated
surface. I cannot establish that every edge elsewhere is flat.** Some
transverse bands farther across the foreground
have pale tops and narrow dark near-side lips. They suggest shallow relief
rather than pure paint. A dark border also follows part of the near strip.
These cues still do not give the eye a continuous, identifiable kerb top,
vertical face and road joint along the intended run. A dark outline is not
automatically the face the diagnostic was meant to expose.

**Clarification:** those dark lips are relief cues, not identified emitted
kerb faces. I have not found a clear kerb face that the owner overlooked.
[The follow-up clarification](VISION_ROUND10.md) locates the cues and explains
why they cannot settle face contrast or the cause of the missing kerb read.

In B's snow-ropeway frame, pale tread surfaces, darker fronts and irregular
edges organise a descending route before their surface detail is inspected.
That is the useful form relationship here. The reference does not establish
a conventional road-kerb section, nor does its cold atmosphere prescribe
the exposure of our clear-day capture.

**The visible ground graphic is too assertive.** Hatching and yellow markings
make the eye follow pattern changes across the foreground rather than read
a simple physical street edge. This is not evidence that the actual kerb
face is over-bright or that its step is too tall to walk over: the required
section is not sufficiently exposed to judge either. I would not tune the
authored kerb contrast from this image.

The supplied crowd view does not independently close street readability.
It shows cooler open ground, shadow patches and edged podium surrounds,
but its foreground still does not clearly divide a walking surface from a
marked carriageway. Ground detail being visible is a narrower claim than
the street reading as a street.

**Mechanism and routing:** pixels alone cannot choose between an absent,
occluded or poorly shaded face. There is relevant additional evidence:
[the kerb-selector follow-through](R11_KERB_TRACE_FIX.md) reports that the
old selector pointed at a gap in emitted kerb geometry. The capture report
records the supplied kerb view at the same position as that earlier view.
The selector correction was committed after the supplied captures. Thus
the strongest supported lead is **pose-to-emitted-geometry correspondence**,
not another brightness adjustment or a colour-channel swap. The current
corrected source is not proof that this earlier image contains its subject.

Developer three should own that correspondence through
[diagnosticposes.ts](../src/world/diagnosticposes.ts) and the actual output
of [groundbake.ts](../src/render/groundbake.ts). I do not diagnose
[groundgrammar.ts](../src/world/groundgrammar.ts) from the yellow band's
colour, and this frame does not convict the fragment path. Nearby market
stalls also do not prove that the selector chose a market district: its
documented selection is in B, while stalls can belong to an adjacent route.
This is not the copper street's orange kerb/paint test.

GAP: **The capture does not establish the selected kerb as a continuous
physical separation between pavement and road.**

NEXT: Supply the corrected kerb pose with provenance naming the actual
emitted top, face and adjoining road surface it frames. This is a request
for the next review artifact, not a further fix to an already corrected
selector or a capture performed by the reviewer.

CONFIRMED: No complete street done-when clause is met. In particular,
“kerbs catching light and reading as a kerb, with painted lines on the
carriageway” from [HANDOFF.md](HANDOFF.md) remains open. Visible surface
pattern, yellow colour and isolated dark lips do not confirm that clause.

## Crowd change and human identity

VERDICT: **more work needed. Same crowd read; no supported visual improvement
or worsening against the opened baselines. It reads as street construction.**

EVIDENCE: The supplied crowd view; the latest historical crowd baseline and
previously reviewed crowd baseline named above; A's cablecar-deck frame and
B's snow-ropeway frame.

JUDGED: Warm rust, orange, muted green and pale cloth-like panels sit above
dark vertical uprights. Closely packed tops make a continuous cap. The band
runs from the near right edge towards the central distance with the visual
authority of a divider or palisade. Broad grey ground and teal podiums frame
it as street hardware. The eye follows a manufactured edge, not people
using the ground beside a destination.

The new capture preserves that same large-scale organisation seen in both
baselines. Local cap shapes and colour patches differ, but no new readable
human relationship appears. The broad ground treatment remains sufficiently
similar that I cannot substantiate the claim that it has newly turned a weak
crowd into a more convincing fence. **The fence read was already convincing.**
These are comparable street compositions, not frozen-state controls for a
single ground change; I will not attribute every local difference to the
kerb fix. The previously reviewed baseline was already recorded as kerb-fixed
in [the street review](VISION_ROUND6.md), so it must not be relabelled a
pre-fix control.

A's cablecar-deck frame separates its walkers from the rail through distinct
heads, shoulders, space between bodies and shadows on the walking deck.
B's snow-ropeway frame carries readable near walkers into a collectively
occupied commercial route. Those are structural references for human scale,
not exposure matches or claims that our clear-day street should resemble
snowy stairs.

Against the standing conditions in [R1](ROADMAP.md):

- **Readable grounded bodies — fails.** The collective silhouette has panel
  faces and post rhythm. It does not give independent head-and-shoulder
  silhouettes and feet located on open walking ground. Dark lower forms
  merge into the barrier. Identifying body components on close inspection
  would not change the whole-frame read.
- **Occupation belonging to the route — fails.** The band divides open floor;
  it does not show a passing stream beside an approachable frontage or
  counter-facing occupation. Following the street's direction is not enough
  when the occupants read as its edge treatment.
- **Occupation continuing into depth — fails as occupation.** The drawn band
  plainly continues into distance. What continues is the same barrier
  silhouette, not a connection between near people, occupied middle distance
  and a busy destination. Geometric continuation cannot satisfy this clause
  by itself.

The band contributes a strong perspective line and colour rhythm. It moves
the image **away from an inhabited read** by giving the otherwise empty
walking ground an architectural divider instead of visible users. That is
its contribution to this image, not a claim that removing all bodies would
produce an inhabited city. No entity-off control of the current ground was
supplied.

The brighter-ground/picket-fence concern remains valid as a general risk,
but this comparison does not establish a new deterioration. The forecast
that separation could reveal repeated upright markers is still untested:
this capture contains the unchanged ribbon, not the separated crowd.

GAP: **The crowd's collective silhouette belongs to street construction,
not independent grounded people.**

NEXT: Continue the already authorised local separation work, then submit
this same crowd-derived composition for review. Do not add scene scripting
or treat visible gaps alone as approval; the marker-field disqualifier remains
in force after separation.

CONFIRMED: None of “Readable grounded bodies”, “Occupation belonging to the
route” or “Occupation continuing into depth” is met as an inhabitation
condition. The frame instead triggers “People read as street construction
or repeated upright markers” from [the hero specification](HERO_FRAME_SPEC.md).
“Visible pixels alone cannot close this row” remains binding.

## Hero composition

VERDICT: **more work needed. Neither supplied image is the hero frame.**

EVIDENCE: The supplied kerb and crowd views, the historical daylight market,
and the selected-route contract in [HERO_FRAME_SPEC.md](HERO_FRAME_SPEC.md).

JUDGED: The kerb view is closer to the hero's **human-height ingredients**
than the crowd corridor: it brings ground, counter boxes, canopy supports
and overhead market cords into the same image. Its improvement over the
historical market locator is access to foreground ground detail. Its
composition, however, looks across an open market space with stalls beyond
it. The graphic floor leads attention across that space rather than along
the working face of a selected stall run. Counters remain middle-distance
objects instead of the near frontage beside a walk.

The historical daylight market already establishes a stronger longitudinal
market direction, though its empty centre and peripheral stalls also fail
the hero. The kerb view therefore does **not** establish itself as a closer
hero composition than the existing market view. It supplies useful eye-level
ground access; it does not replace the counter-front subject. The crowd
view has depth but no readable market frontage or approach-to-exit route.

Developer three's next hero pose should remain the specified derivation:
select the earliest complete right-hand emitted stall run downstream of the
live market spine origin, stand in its approach gap, and look along the
roadward walking strip to its exit gap. Bring the near counter's front and
end into the foreground, alongside ground on which people can stand. Do not
reuse this kerb camera merely because it is low and has stalls in view.

GAP: **Neither capture frames the selected counter-front walk from its
approach to its exit.**

NEXT: Implement the existing emitted-run hero derivation, preserving its
selection rule rather than promoting either diagnostic to hero status.

CONFIRMED: Neither image confirms “These relationships must coexist along
the same route in the same image” for the selected Market Spine Counter Walk.
No hero approval is issued.

## Daylight/night discrimination

VERDICT: **more work needed — the controlled pair is absent.** This review
does not establish that daylight has resolved the street or that current
night lighting hides it.

EVIDENCE: Both supplied captures visibly show daylight. The reopened historical
daylight and night markets show older evidence; their different weather and
lens states prevent them from serving as the specified phase-only control.

JUDGED: The supplied daylight exposes unresolved boundary identity and an
architectural crowd ribbon. Those defects remain visible despite the ground
pattern and colour separation. The historical night market shows why received
light is required: a warm floor patch persists while counter fronts and people
largely disappear into blue-black ground and frontage. That older image is
not a verdict on the present night build.

The discriminator is already concrete in [the amended specification](HERO_FRAME_SPEC.md):
follow the same near counter front and end, adjoining ground and bodies,
occupied middle frontage and exit opening in each phase. If night hides a
daylight ribbon or unsupported frontage in darkness or bloom, it cannot pass.
If daylight establishes those relationships and night loses them, night
lighting fails without proving that the shared geometry is wrong. If stronger
night modelling exposes a support or marker defect that daylight hid, the
street fails; softening the revealing light is not a repair.

GAP: **There is no matched daylight/night evidence of the selected route.**

NEXT: After the hero derivation exists, supply its controlled pair with the
same camera, actor snapshot, geometry, weather and lens state, changing phase
and its authored lighting alone.

CONFIRMED: No current night or paired-hero clause is confirmed. “A successful
member cannot compensate for the other's failed occupation” remains the
approval rule; no successful member has been established here.

**Round reflection:** this is the requested independent frame review, not
implementation or a search for another aesthetic number. The supplied
artifacts now support a crowd verdict and a concrete street-evidence failure.
They do not justify a new shader diagnosis, a section approval or a hero pass.
Only this review document was edited.

**WHAT I SHOULD HAVE ASKED YOU INSTEAD:** Does the diagnostic frame contain the
actual emitted kerb face it claims to test, before we decide how that face is
shaded? The broad review questions are sound; the missing subject is the
earlier question that changes what should be captured next.
