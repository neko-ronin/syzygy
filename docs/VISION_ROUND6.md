# Street-read gate and the hero's positive approval condition

VERDICT: **more work needed** on the street-read gate. The opened capture does
not convincingly distinguish pavement from carriageway. The crowd verdict
also remains **more work needed**; its unchanged ribbon does not test the
prediction about separated bodies.

EVIDENCE: Opened the [B sheet](../references/B-cold-industrial-sheet.jpg),
[A sheet](../references/A-saturated-sheet.jpg),
[B's snow-ropeway frame](../references/sections/B-cold-industrial/03-snow-ropeway.jpg),
[A's cablecar-deck frame](../references/sections/A-saturated/02-cablecar.jpg),
the [earlier crowd capture](../shots/2026-10-02T20-50-51-01d-street-crowd.png),
the [intermediate kerb-fixed capture](../shots/2026-10-02T21-43-42-01d-street-crowd.png),
and the [current street-crowd capture](../shots/2026-10-02T22-45-46-01d-street-crowd.png).
The current artifact was named by `shots/latest.json` and by the implementer's
[capture record](GROUND_FRAGMENT_DIAGNOSIS.md). The sidecar reported no capture
error and identified the subject as in view. I opened the actual PNG; the
implementer's description of a legible street is not its visual approval.
No capture or comparison harness was run by this reviewer.

JUDGED: **A lighter ground plane with visible warm edging still reads mainly
as a shared floor between building podiums.** The rust-coloured strips around
the left podium and across the middle ground give some boundaries a traceable
outline. Broad cool-grey patches and shadows articulate the floor's value
structure. They do not make a continuous walking surface beside a distinct
carriageway legible. The pale bands on the right do not resolve confidently as
painted road lines. The foreground's material read remains broad and smooth;
I cannot follow pavement construction into a raised kerb and down onto road.

## The kerb judgement

The warm edging is visually subordinate to the teal enclosure and coloured
crowd band. **I do not see an overbearing kerb line.** Its problem here is
identity: at this framing it often reads as an orange outline at a podium's
base, rather than a top and return face separating walking ground from road.
Calling that outline a kerb because its vertices were authored as one would
repeat the crowd mistake.

This is not enough evidence to approve the kerb face's authored contrast.
The nearest ground does not expose a clear kerb section, and the crowd
obscures the right-hand surface. Reducing contrast on the strength of an
authored value would be an invented remedy. The relevant question is whether
the illuminated top, return face and adjoining surfaces resolve as a physical
boundary at human scale.

The ground is visibly lighter than in the earlier crowd capture. Camera,
shadows and actor positions also differ, so these images are not a controlled
proof that the shader correction alone caused every visible change. The
implementer's fragment-routing evidence and this street-read judgement answer
different questions. Correct routing does not establish a readable pavement.

B's snow-ropeway frame shows pale walking ground with legible risers, broken
surface edges and rails belonging to its sides. Its surface remains a route
through a cool enclosure. A's cablecar-deck frame shows how even a strongly
lit, comparatively simple floor is bounded by a readable physical edge, with
walkers occupying the interior. These supply construction and occupation
relationships. Neither is being used as a matching exposure or a demand that
our carriageway become a stairway or elevated deck.

GAP: **The footway-to-carriageway boundary does not resolve as a kerb in this
frame.** Warm outlines are visible, but the raised edge and the distinct
surfaces it joins remain ambiguous.

NEXT: **Provide a subject-derived kerb-boundary view before changing its
contrast.** Select the nearest unobstructed emitted kerb span belonging to the
same live street used by this crowd diagnostic. Derive the camera's ground
support and direction from that span and its adjoining footway. At standing
eye height, show footway top, kerb top and return face, and carriageway together
in the foreground, with the edge continuing towards the enclosing podiums.
Keep the current phase and lighting. If no such span can be resolved, report
that failure rather than use a typed coordinate or choose an unrelated
photogenic kerb. This is an additional ground diagnostic, not a replacement
for the crowd frame or the market hero. A serialised slot was requested;
this reviewer has not captured it.

CONFIRMED: **No complete street-read close condition is confirmed.**
[HANDOFF's ground clause](HANDOFF.md) requires “kerbs catching light and reading
as a kerb, with painted lines on the carriageway.” The opened frame establishes
visible warm edge strips, which is only part of that clause. It does not
support closing the clause as written. No crowd done-when clause is newly met.

## The spread prediction remains untested

The current crowd still reads as a continuous barrier: repeated dark uprights
under a coloured cap. Its clearer separation from the ground helps identify
the barrier; it does not establish independent people occupying that ground.
The predicted fence-footing concern has not been demonstrated specifically:
the image does not expose a bright kerb beneath the nearest crowd clearly
enough to make that attribution.

The spread has not landed. This image therefore neither confirms nor refutes
the forecast that opened space will expose rigid post-like bodies. When it
does land, judge whether the crowd retains a marker rhythm or resolves into
independent human silhouettes. Resolving that identity failure still leaves
route use and continuation to be judged under D7. Spread alone cannot close
inhabitation.

## The hero's positive success criteria

**Make the approval condition explicit, but do not claim the full existing
contract permitted this ribbon.** The daylight clause already requires
distinct bodies beside frontage and a passing route into depth. The night
clause already preserves grounded silhouettes and that route. The
discriminator explicitly rejects bodies merged into a counter-like band.
Those are substantive inhabitation requirements, not rendering proxies.

The remaining shortcut is piecemeal approval: recognising paving here, a body
part there, light on a counter, and distant activity, without their belonging
to the same occupied route. I added a positive approval statement immediately
before the phase-specific clauses in [HERO_FRAME_SPEC.md](HERO_FRAME_SPEC.md).
Each member must independently show D7's relationships together at the
intended whole-frame viewing size. Readable near people, passage and
counter-facing occupation, and occupied continuation must belong to the
selected strip. The crowd must retain its identity apart from street
construction. A successful phase cannot compensate for a failed member.

This complements the explicit disqualifier without substituting a spread
measurement or requiring randomness. A purposeful queue remains valid when
it reads as people using a destination. The actual daylight/night question
remains unanswered until the derived pair exists.

**Round reflection:** this remains a street review and a specification
amendment. The next ground evidence is pointed at its physical boundary. No
renderer or simulation change was made, and the unchanged ribbon has not
been reported as a test of the pending spread.

WHAT I SHOULD HAVE ASKED YOU INSTEAD: Can the viewer follow a continuous
footway, across a readable kerb onto carriageway, without treating a coloured
outline or the crowd ribbon as the street's boundary?
