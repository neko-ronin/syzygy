# Market Spine Counter Walk — derived daylight and night pair

This specifies the first hero-frame candidate. It approves a subject and a
derivation, **not a rendered frame**. The crowd renders, but the captured ribbon
does not read as people. The derived hero pair still awaits visual judgement.
The question remains: does this same occupied route hold
its human-scale relationships in daylight and at night, or does darkness hide
an unresolved street?

The place is the roadward walking strip beside the first complete right-hand
stall run downstream of the market spine's parameter origin. The camera stands
in its approach gap and looks along that strip towards its exit gap. The
existing `09-market-down` is a locator for this part of the city; its typed
position and target are not inputs to the new pose.

This document implements the intent of [D21](DECISIONS.md#d21--diagnostic-poses-are-derived-from-live-state-never-hardcoded)
and [PROCESS](PROCESS.md): derive the diagnostic from its subject, preserve the
control, and decide aesthetic questions from opened frames. It makes the
selection left implicit in [the previous vision document](VISION_ROUND1.md)
explicit. No implementation or capture was performed in this round.

## Visual basis and inspection scope

I reopened both supplied contact sheets and every individual pose PNG in
`shots/2026-09-29T19-30-34/` and `shots/2026-10-01T16-10-49/`. I also reopened
the [B sheet](../references/B-cold-industrial-sheet.jpg), the
[A sheet](../references/A-saturated-sheet.jpg), and every individual frame
belonging to those sheets. The contact sheets omit later poses; the market and
night judgements below come from the individual images, not their thumbnails.
No source video was decoded, and this is not an audit of other sections' phase
labels.

The primary reference for **occupation continuing into depth** is
[B's snow-ropeway frame](../references/sections/B-cold-industrial/03-snow-ropeway.jpg):
near walkers on a legible stair route lead towards a busy avenue whose pale
ground separates people from the enclosing architecture. Warm commercial
edges give that occupation somewhere to belong. This supplies a route
relationship, not B's palette or an overhead camera for our market.

[A's cablecar frame](../references/sections/A-saturated/02-cablecar.jpg) is the
foil for **individual silhouette and ground contact**: dark bodies, gaps
between shoulders, and cast shadows remain distinct on the warm walking deck
as it bends away. Its chromatic enclosure supports the route without turning
the walkers into facade detail. It supplies that human-scale relationship;
its elevated setting and low-sun appearance do not establish a night-market
exposure or a stall construction kit.

Our [later daylight market frame](../shots/2026-10-01T16-10-49/09-market-down-day.png)
shows the problem to overcome: a broad grey foreground, stall rows pushed
towards the edges, overhead cords, and a foreground crowd mass whose coloured
tops and dark lower band are difficult to separate. Its
[night counterpart](../shots/2026-10-01T16-10-49/09-market-down.png) contains a
warm pavement patch, but the nearby counter frontage largely vanishes. A pool
on open floor does not yet join source, surface and occupant. These are
historical images. The rendering-fault premise under which this specification
was originally written is superseded: the later captured band contains bodies,
but its merged silhouette does not establish occupation.

## Derivation inputs that exist, and the missing contract

The selector's authority is **the actual market emission**, ordered by the
live spine parameter. Navigation constrains the walking strip; crowd state
establishes whether that strip is occupied. Neither a nav node nor the crowd
centroid selects a different market run.

The source already provides useful quantities:

- [The live district spine](../src/world/districts.ts), through
  `City.plan.districts.market`, `spinePoint` and `spineHit`, supplies the curve
  and its increasing `along` direction. Here “chainage” means the generator's
  `along` parameter, not a separately estimated distance along a screenshot.
- [The market grammar](../src/world/marketgrammar.ts), through
  `marketGrammarFor` and `MarketStall`, supplies each emitted stall's `along`,
  `side`, tangent, basis, `front`, `back`, `counter`, `pitch` and module. It also
  knows when it leaves a slot empty for a scheduled gap, a fatigue gap or
  facade clearance.
- [The market baker](../src/render/marketbake.ts) supplies the actual canopy,
  supports, counter and goods geometry. The counter's signed lateral alone
  does not specify the free walking space in front of it.
- [The ground baker](../src/render/groundbake.ts) supplies kerb and footway
  geometry. Its `edgeOffset` explicitly warns that a nominal perpendicular
  offset is not sufficient to locate the resolved carriageway edge.
- [The navigation graph](../src/world/networks.ts) supplies street nodes and
  links. Its street nodes are placed on carriageway centrelines. A nearest
  node is therefore not evidence of a counter-front walking route.

**A complete run is not currently an exposed live quantity.** `MarketDesc`
returns stalls, strings, cloth, lights and aggregate statistics. It does not
return the individual empty-slot events, their intervals, run identities or
approach and exit gaps. Its run machine starts afresh inside each chunk's
`marketAlongRange`. `bakeMarketDetail` returns no semantic record, and
`BakedChunk` retains meshes and lights rather than run or walking-strip bounds.
Sorting the currently resident stalls and guessing a gap from their spacing
would manufacture the missing contract.

An engineer must expose the following by-products of the existing emission.
These are proposed records, not APIs claimed to exist:

| Record | Required content and authority |
| --- | --- |
| Market slot event | Stable identity within its actual emission query; spine parameter and longitudinal slot interval; side; emitted stall identity or explicit empty reason. |
| Emission coverage | Evaluated spine interval for each owning chunk, actual query identity, and whether that interval is fully evaluated. A chunk edge or missing bake is an unknown boundary, not a market gap. |
| Stall surface record | Actual counter/frontage bounds, ground supports and obstacle footprints for posts, stock and other emitted furniture; record an absent element as absent. Do not infer these from the roof bounds. |
| Counter-front walk | A bounded frontage-apron corridor on the roadward side of the counters, with explicit counterward and roadward edges, a centreline derived between those edges, approach and exit cross-sections, ground support, and connection to the navigation used by the crowd. |
| Standing-eye landmark | The neutral adult pedestrian model's standing head/eye datum, shared with the pose derivation. The current pedestrian builder emits a head but returns only a mesh; it does not expose this landmark. |

Obtain slot events in the same walk that emits the stalls. Retain footprint
records at the bake operation that creates the corresponding surfaces. Use
the exact query used by the market bake, including its seed and resolved
kind/district, rather than assuming that re-running a probe with the world's
seed reproduces the bake. This needs semantic output from existing grammar,
not a new district layout or a replacement random sequence.

## Selection rule and execution order

**Selection rule:** from the live market spine's parameter origin, travel in
increasing `along` and select the earliest right-hand emitted stall run whose
start lies downstream and whose approach gap, exit gap and complete emission
coverage are known across chunk boundaries.

Apply that rule in the following dependency order.

**Resolve the live locator and orientation.** Read the active city's plan and
generation identity. Evaluate `spinePoint` at the spine's named parameter
origin and obtain the forward tangent from the live curve. That replaces the
coordinates copied into `09-market-down`. Define right with the upright camera
view basis used by `m4lookAt`, and classify the physical stall side against
that basis. Do not infer visual right from an array order or a comment calling
a normal “left”. The actual view basis wins.

**Evaluate and stitch the emission.** Starting at that live locator, enumerate
the owning chunks encountered downstream and their market slot events. Sort
events by `along` within the physical right-hand side; deduplicate repeated
bake calls by emission identity. Stitch neighbouring chunk intervals before
finding runs. The current chunk-local run machine remains authoritative about
which slots it emitted; a chunk boundary alone does not create an opening.
Evaluate the upstream neighbour as needed to establish the approach gap.

**Define a run from explicit events.** A run is the maximal consecutive
sequence of emitted stall slots between recorded empty-slot events. Ordinary
seams between adjacent stalls do not split it. Scheduled gaps, fatigue gaps
and facade-clearance omissions do split it; preserve their different reasons.
The usable geometric opening is the free interval between the actual adjacent
stall/obstacle bounds, not the aggregate `stats.gaps` count. A clearance
omission that exposes a wall is not automatically a walkable passage.

**Select the first complete run.** Its first stall begins downstream of the
locator, both bounding openings have been resolved, and every owning interval
through the run and those openings has been evaluated. A run already under
the locator is not the run ahead of it: finish resolving it and take the next
run with a known approach. All selected members and obstacles must have their
actual full-detail emission available for framing. Resolve a partial earlier
candidate before selecting anything later; streaming order must not decide
what “first” means.

Complete means **known from beginning to end**, not attractive, populated,
well lit, or composed of identical covered modules. An intended bare pitch
does not make the metadata incomplete. An absent counter or unsupported
canopy in that pitch remains a visible design defect if it harms the frame.
Do not keep advancing until a prettier run passes review.

**Resolve the subject's walking strip.** On the selected run, construct or
expose the connected free ground corridor immediately roadward of the actual
counter fronts. Subtract the emitted obstacles and building footprints; retain
the resolved ground/kerb support. The generator must emit this as a named,
bounded frontage apron, with its roadward boundary and centreline: it is not
the unbounded component of all empty ground outside the counters. The source
does not currently expose that apron. Where the free space branches, follow
the component adjacent to the selected counter fronts that connects the
approach to the exit; do not switch to a parallel centre-of-road passage.
Connect its approach, frontage and exit to
the crowd's navigable route. A link to a centreline node can be part of that
connection; it cannot substitute for the corridor beside the counters. A
blocked corridor makes this selected subject unavailable. Report it there;
do not choose another run or move the camera into the carriageway to conceal
the defect.

**Derive the eye and aim.** Take the longitudinal middle of the resolved
approach opening. At its cross-section, use the middle of the connected free
counter-front corridor as the camera's ground point. Add the shared neutral
standing-eye landmark above that ground support. This binds human scale to
the person model rather than an absolute camera altitude or a random agent's
height. Aim at the corresponding corridor centre in the exit opening, at the
same standing eyeline relative to its ground. Use upright roll and the existing
market lens's field of view, shared by both phases.

The resulting view must show the nearest right-hand counter's front and end,
the paving beside it, the passing strip, and its continuation to the exit
opening. The open aisle and opposing frontage remain visible to the left;
upper architecture and cables provide enclosure. If the derived line of sight
puts the eye inside a post, conceals the walking strip under a canopy, or
cannot show that continuation with the shared lens, return the framing failure.
Do not silently raise the camera, narrow the crop or move to a different gap.
This composition is the counter-side translation of the occupied-route
relationship in B's snow-ropeway frame and A's cablecar frame.

**Resolve occupation last.** Allow the normal crowd system to populate the
selected scene, then read actual agent positions and their route association.
The current [crowd attractor](../src/sim/crowd.ts) uses the market spine near
the camera; it does not identify this stall run or its counter destinations.
Record whether bodies actually lie in the selected corridor and viewing
frustum, rather than substituting the whole population's centroid or spread.
Never place actors for the screenshot or reselect the run by crowd abundance.

If the population remains elsewhere, report an unoccupied selected route, with
the route and actual population provenance. That is a placement finding before
it is an aesthetic verdict, not evidence that the draw failed. Conversely,
valid nearby transforms with no rasterised bodies leave the rendering blocker
open. The hero review becomes available when bodies actually appear; their
appearance alone does not pass it.

## The pair is a single controlled scene

Derive the subject and pose once. Produce a daylight member using the existing
daylight phase and a night member using the existing night phase. Replay the
same saved scene state for both. Do not run the selector separately after a
phase change.

Hold the world/generation identity, selected slot/run identities, emission
coverage, camera transform, framing and image size fixed. Hold the crowd's
agent identities, transforms, poses and animation sample fixed, along with
vehicles, cloth state and other animated geometry. Hold meteorological haze,
cloud cover, precipitation and wind fixed. Hold exposure, bloom, saturation,
vignette and the other lens settings fixed. Phase may change the solar/sky
illumination and the normal authored lighting response to phase; it may not
trigger a separately retouched grade or a different weather scene. Initialise
temporal histories consistently so one member does not contain the other
member's accumulated lighting.

The current [capture presets](../tools/capture.mjs) say “same everything except
the phase”, but their weather and lens settings differ. Those presets are
**not the controlled pair specified here**. Their images are useful historical
views, not a causal proof that phase alone produced the differences.

The pair's provenance must accompany it: live locator and basis, selected
emission/run identity and bounding gap reasons, owning chunks and detail
availability, corridor/ground/nav identity, standing-eye source, resolved
camera transform, actor snapshot, applied phase and the shared weather/lens
state. Record the actual quantities; this document supplies no aesthetic
target values. If the selector cannot resolve its subject, return an explicit
reason instead of a fallback pose. If the captured camera leaves the derived
pose, the pair is invalid before visual review.

## What daylight and night must each show

**Inhabitation passes as a relationship in the whole frame.** At the intended
viewing size, each phase must independently show readable grounded near bodies
occupying the selected walking strip, a passing stream with counter-facing
occupation beside its frontage, and that occupation continuing through the
middle distance towards the exit gap. These relationships must coexist along
the same route in the same image. People must retain a visual identity apart
from kerbs, rails, counter supports and facade rhythm. The evidence must let
the eye read people using the place, rather than identify body parts in a
magnified crop.

This is D7's existing requirement made explicit at the approval point. A
readable pavement, an illuminated counter, an isolated recognisable figure
elsewhere and a busy distant background cannot be assembled into a pass when
the selected strip still reads as a ribbon or marker field. Judge each member
against this condition before comparing the pair. A successful member cannot
compensate for the other's failed occupation; light may simplify the scene
while preserving the human relationships that qualify it. See
[the street and approval review](VISION_ROUND6.md).

**Daylight resolves the street's construction and use.** The near counter
must have a working face and support, goods or an intelligible working
surface, and a canopy edge whose attachments belong to the stall. Ground
joints, kerb transitions, feet and shadows must locate people beside that
frontage. Distinct heads and shoulders must separate from posts and from each
other. Cloth, solid counter surfaces and metal rigging must retain different
material reads. The passing route must continue through the middle distance
to the exit gap, with counter-facing occupation beside the flow. Bases and
entries must connect the street furniture to the surrounding city instead of
leaving a kit of awnings on a vacant plinth. This is the exposed construction
test: darkness cannot repair an absent relationship.

**Night reveals the same street through received light.** The first attention
belongs to nearby market activity: warm light on pavement, counter front,
canopy underside and passing bodies. It must then lead along successive
occupied frontages towards the same exit gap. Clothing and shoulders can take
warm light; shadowed bodies can separate against lit ground. Dark pauses may
group the businesses, but must not sever the route or erase the grounded
near silhouettes. The upper city can recede into cool atmospheric depth, with
windows and cable traffic supplying secondary activity. Cords must attach to
places and frame the route rather than become the brightest substitute for
it. These night choices are authored market direction, informed by the warm
route/cool enclosure relationship in A's cablecar frame; that frame is not
being passed off as a full-night market control.

## The discriminator, declared before capture

| What the pair shows | Judgement |
| --- | --- |
| Daylight establishes grounded, separate bodies, approachable counters and an occupied route into depth; night preserves those same relationships while local light gathers attention around market activity. | The street is resolved and the light is doing its job. Night may simplify the upper city without hiding the street. |
| Daylight exposes a vacant principal walking strip, unsupported or interchangeable frontage, bodies merged into a counter-like band, or occupation that stops near the camera; night becomes persuasive by swallowing that defect into blackness or bloom. | Darkness is hiding an unresolved street. A glowing foreground vignette cannot approve the pair. |
| Daylight resolves those relationships; night loses counter faces, ground contact or continuation and leaves luminous fittings above darkness. | The street is resolved in daylight; the night lighting still needs work. |
| Neither member establishes those relationships. | The street remains unresolved. There is no successful night member to rescue it. |
| The run, camera, actor snapshot, geometry/detail availability, weather or lens state changes between members. | Invalid pair. No conclusion about darkness versus street resolution follows. |

Night need not expose every daylight joint or every distant fitting. It must
preserve the **relationships** daylight establishes: body to ground, body to
counter, passage to destination, near occupation to continuing occupation.
The discriminator is the disappearance of an unresolved relationship, not
ordinary shadow or a change in palette. Daylight does not have to imitate the
night's local-light hierarchy to pass.

## Disqualifiers and the prediction

All of D5's disqualifiers remain in force:

- **People read as street construction:** a continuous ribbon or mechanically
  repeated row or field of upright markers groups visually with the kerb,
  railing or counter frontage instead of resolving as independent people
  occupying ground. This fails at the intended whole-frame viewing size even
  when the bodies are drawn, illuminated and distributed into depth. A
  magnified crop identifying the meshes cannot approve the frame.
- **Empty central slab surrounded by scenery:** the frame's principal route
  reads as unused open floor with market objects at its edges. This does not
  require filling the carriageway; open ground is acceptable when the occupied
  counter-front walk remains the frame's subject.
- **Bodies hidden behind counters:** rooflines, stock or continuous counter
  bands conceal people instead of revealing approach and use.
- **Foreground clump followed by vacancy:** near activity gives way to an
  empty middle distance before the route reaches its exit gap.
- **Luminous fixtures over black frontage:** the eye finds emitters but cannot
  find the pavement, working faces and bodies they are meant to reveal.
- **Overhead view concealing ground contact:** the camera makes the roof kit
  impressive while hiding how people stand and move beside it.
- **A tightly cropped attractive stall concealing the continuing street:**
  close material detail cannot replace the route this frame was chosen to show.

The crowd disqualifier applies independently to daylight and night. Stronger
ground contrast or warm light may make the ribbon or marker rhythm clearer;
that does not satisfy the human-silhouette condition. A queue or narrow
walking line can qualify when the people remain readable and belong to a
destination. Straight alignment itself is not prohibited, and widening a
ribbon into a uniform marker field does not escape the disqualifier. This
spells out D7's existing condition rather than replacing it with a coordinate
spread test. See [the specification ruling](VISION_ROUND5.md) for its basis.

**Historical prediction:** the following prediction is retained as written
before the captured ribbon was identified. Its rendering-fault premise is
superseded: the crowd was drawn but merged into a line. The owner has since
reported the kerb/deck fix. Current preparation for that frame is in
[VISION_ROUND5.md](VISION_ROUND5.md); the original prediction below is not a
claim about the unseen corrected street.

**My first-expected disqualifier is the empty central slab.** The early
[street-crowd image](../shots/2026-09-29T19-30-34/01c-street-crowd.png) spends its
foreground on unused road beneath a distant, elaborate skyline. That image's
known locator failure means it cannot establish where the crowd actually was;
it does establish the empty-slab composition this project has already accepted
as a street diagnostic. The later
[derived street view](../shots/2026-10-01T16-10-49/01d-street-crowd.png) and
[daylight market](../shots/2026-10-01T16-10-49/09-market-down-day.png) add visible
bodies and stalls, but still leave the eye crossing broad vacant foreground
towards edge-bound groups. The market's night member obscures much of the
frontage around its warm floor patch.

The new counter-side pose addresses the camera's distance from its subject.
It cannot by itself make occupation follow the actual frontage. I expect the
raster fix to reveal that placement/composition gap before it reveals a fully
inhabited Counter Walk. I would be wrong if the first valid pair shows a
separate passing stream and approachable counter groups continuing along the
selected strip through the middle distance to the exit gap, even with open
carriageway beside them.

The earlier D7 prediction about a counter-like crowd band still applies to
silhouette legibility. It is a different question: what visible crowd models
may read as. Here I am choosing the first expected failure among the route
frame's disqualifiers, after reopening both sets. Neither prediction diagnoses
the current raster fault.

## What the pair cannot prove; capture schedule

**No third still is required for this daylight/night relationship judgement.**
The derived view deliberately contains the near counter's front and end,
ground contact, middle route and exit opening. If it conceals one of those,
it fails the framing contract; a complementary attractive angle does not
repair the evidence missing from the hero pair.

The pair cannot prove gait, actual counter approach, dwell, avoidance or
continued movement through the gap. Neither can a third still. For a later
behaviour judgement, reserve a continuous daylight take from this same held
camera, with simulation advancing, showing a passer travel along the strip
and counter users occupy its destinations without intersecting the furniture.
It must show continuity, not a montage of agreeable poses. That is additional
motion evidence for living inhabitants, separate from approving this still
pair; it is not required to answer whether darkness hides unresolved street
relationships. The pair also makes no claim about occupation elsewhere in the
city or district-wide visual variety.

## Reference phase labels

[A's `03-funicular-night.jpg`](../references/sections/A-saturated/03-funicular-night.jpg)
still visibly reads as daylight: a visible bright sky opening, strongly
illuminated pale ground and roof surfaces, and directional shadows. Its
filename contradicts its image. It must not serve as the full-night member's
phase-matched reference.

I found no further explicit time-of-day filename contradiction in the reopened
A/B set. A's cablecar frame has a warm sky and long directional shadows;
it supports a low-sun reading, not proof of full night. A's
[walkway frame](../references/sections/A-saturated/04-walkway.jpg) has strongly
directional ground illumination despite its blue palette. B's fog frames
combine diffuse cool atmosphere with warm windows, which does not settle
their solar phase. None of those filenames explicitly names night. Treat
those images as structural references for the relationships named here,
not as a matched full-night exposure because they are cool or contain lights.
The full-night market treatment remains an authored target awaiting its own
approved frame.

**Round reflection.** This remains a specification task. It found missing
semantic emission needed to derive the subject, defined a controlled pair,
and declared how that pair can fail. It has not become another attempt to
characterise a broken draw or infer approval from counters.

FIRST APPROVED FRAME: Market Spine Counter Walk — the roadward corridor of the earliest complete right-hand emitted stall run downstream of the live market spine's parameter origin, from its approach gap at the shared standing eyeline towards its exit gap, reviewed as a daylight/night pair.

THE THREE DECIDING THINGS:

Separate human silhouettes visibly grounded beside the actual counter fronts.  
Occupation using the clear passing strip and its approachable counter destinations.  
Occupation continuing through middle distance to the same reachable exit gap in both phases.

WHAT I SHOULD HAVE ASKED YOU INSTEAD: This brief asks the right question. Resolve the emitted subject and freeze the scene first; then ask whether night reveals the same inhabited street that daylight exposes.
