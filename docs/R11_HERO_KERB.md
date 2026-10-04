# Round 10 report: kerb census, surface provenance, hero derivation

## 1. Face-emission census: faces ARE emitted — patchily, not continuously

P1 REFUTED as written (and the bar was impossible: ≤32 kerb verts fit in
a 10 m disc at full density, not ≥100). Measured at three derived edges
(verified B streets, walks holding): **0, 8, 8 kerb-band face verts <10 m**
against 122 <20 m at the old spot. Vertical faces exist on these kerbs but
thin out at points — emission gaps, not a missing emitter. Newly found
mechanism, stated plainly: field continuity (what the pose can see) does
not imply emission continuity. Kerb emission also depends on bake state the
field cannot observe — trace starts, footway-dedupe first-writer-wins
against parallel roads (a street runs 20 m lateral of one measured edge),
chunk ownership. A pose module with no chunk access cannot name baked
verts; claiming "actual emitted" counts from the field side would be the
phantom this project hunts. The provenance below therefore names
field-verified geometry plus walk-predicted counts, labeled as such — and
the one-line wiring that would append bake readback lives in `main.ts`
(app owns city + resident baked chunks; not this file).

Consequence for the routing debate: BOTH sides hold part of it. Emission
gaps exist at verified points (bake-side, `groundbake.ts` trace/dedupe to
investigate — dev1), AND what is baked still needs fragment response (the
earlier flat-reading stands for baked kerbs). Either half alone explains a
missing face.

## 2. Provenance now names top, face and road (P2 HELD)

`kerbRun` on the pose source: edge, face-band centre (kerb mid-height),
top-band centre, road point 2 m across the line, kerb height, predicted
face/top quads from walked segments (×2 tris, ×4 verts), walked metres per
side — each with an in-cone check, refusing with the surface named. The
road point is the adjoining surface, not the centreline (which sits half a
road off-axis and failed every honest in-cone check on wide arterials —
found by measurement, corrected). Verified ok:true at three seeds; refusal
paths intact.

Pose improvements this round, both measured: asymmetric walk bars (ahead
≥30 m where the camera looks, behind ≥10 m — symmetric bars verified kerb
somewhere around the edge while the frame showed a gap ahead), look
direction from the verified walk (not the anchor tangent), street-first
two-pass selection (arterial kerb emission is intermittent by weave), an
uncontested-band guard (parallel-road dedupe competition), and a ≤15°
tangent-rotation bar — the projection-jump guard it mirrors is vacuous as
written (compares a step to itself, in groundbake too), so straightness is
measured directly.

## 3. Hero derivation implemented (P3 HELD)

`deriveHeroWalk(plan, seed, chunks)` in `diagnosticposes.ts`, selection rule
literal from HERO_FRAME_SPEC: spine origin → increasing along → earliest
right-hand emitted stall run downstream with known approach/exit and
complete coverage. Right classified against the m4lookAt view basis
(screen-right = up × −forward, computed with `v3cross`, never from the
`side` sign or a "left normal" comment). Runs = maximal consecutive slots
split at >PITCH_MAX×1.5; complete = bounded openings observed or
evaluated-empty both sides + span ≥ RUN_MIN_M + inside range; corridor =
counter line roadward to carriageway centre, blocked-checked against
footprints (refuses, never advances); eye +1.6, fov 1.05, approach-middle
to exit-middle with a framing-failure check.

Headless proof at the capture seed: run **422.7–434.7 (3 stalls, right)**,
approach 377.7–422.7, exit 434.7–447.4, camera (102.1, 2.0, −387.9) →
(113.1, 2.0, −426.9), 374 stalls / 74 runs / 73 splits evaluated, corridor
unblocked. Refusal verified by temp bar (reverted): full accounting in the
reason. 201 right-hand stalls counted — the side classifier is populated,
not vacuous.

Routed follow-ups (not my files): `main.ts` one-liner (`app.heroWalk()`
passing resident chunks) and a capture entry for the hero pose. The
derivation is pure and headless-proven; wiring is orchestration.

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0.
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`.
Scratch probes deleted.

## Files committed (this round)

- `src/world/diagnosticposes.ts`: kerb guards/provenance + hero derivation.
- `docs/R11_HERO_KERB.md`: this file.
