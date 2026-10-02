# Round 4 report: the shared knob + ground-read diagnosis

Two parts. Predictions were written down before testing (pane, round 4 open);
verdicts below. Headless throughout; no captures taken or needed. All counts
and distributions are load-independent and trustworthy; no wall-clock figure
is used as evidence anywhere (platform emergency note).

Mid-round platform events, not code faults: `src/sim/crowd.ts` carries
another agent's live edit that currently throws `ReferenceError: SEP_SHARE is
not defined` (TDZ-order, compiles clean) — crowd-dependent probes were
re-routed around it, pose values below come from a good run before the
breakage. A `bakeChunk` OOM/`RangeError` never occurred in this round's runs.

## Part 1 — one knob or two: TWO. Implemented.

`cableDensity` drove cables (`citygen.ts:876`) AND facade/rooftop clutter
(`citygen.ts:720`). The §B re-weighting therefore cut lantern-bazaar's facade
signs+lanterns as a side effect. Decision metric, pre-registered:
street-level (y < 12 m) signs+lanterns per building — the band a street reads
at — with bazaar top-two meaning one knob stands. Full-city counts, seed
0x5e7a17, same buildings both sides (attribution: facade-expanded footprint):

| District | Before (dens 1.7) | After, one knob (0.6) | After, split knob |
|---|---|---|---|
| lantern-bazaar S+L/bldg, all | 3.03 (rank 5/7) | 0.89 (rank 6/7) | — |
| lantern-bazaar S+L/bldg, y<12 | 1.77 (rank 1/7) | 0.54 (rank 5/7) | rank 1/7 |
| glass-foxholes y<12 | 0.76 | 1.65 | — |
| copper-stacks y<12 | 1.02 | 1.69 | — |

Note the premise correction: the unbanded rank was never bazaar's (tall
districts win by floor count: 5th → 6th). The street-level rank was 1st →
5th, a 3.3x cut, isolation-clean (same buildings, rolls linear in density).
Verdict: bazaar's "signage on every facade" identity is carried by facade
signs (market-grammar covers stalls/awnings/catenaries, not facade signs),
and the cut came from a cable decision. So the knob is split:

- `districts.ts`: new `DistrictStyle.clutterDensity`, set to the pre-§B
  density per district (facades restored exactly); cables keep the inverted
  `cableDensity`.
- `citygen.ts:720`: `dense` reads `clutterDensity`. One line. `placeCables`
  untouched.

Verification: world suite props 50728 → **58126** (exact pre-§B restoration),
cables stay 3569 (inversion kept), buildings 1337, `VIOLATIONS none`;
`__selftest_sectionB.ts` gains a bazaar top-two street-level guard and is
`VIOLATIONS none`. Separable diff: interface + 11 values + 1 citygen line.

Two observations for other lanes, no action: `market-spine` has **zero**
facade lots in all 169 chunks at both seeds — the S+L metric cannot judge it
and its night read is stalls-only (dev1/marketbake awareness). `crowd.ts:1141`
reads `pal.emissive` into the pedestrian tint pool, so §B emissive changes
shift crowd colours slightly (dev2 awareness).

## Part 2 — the slab: geometry present, pixels absent. Routed, not fixed.

Frame: `shots/2026-10-02T20-50-51-01d-street-crowd.png`. Pose re-derived
headlessly (settled sim, capture seed): camera (100.1, 2.8, 24.0) looking
down-street, population n=2550, camera-centroid 24.0 m. At camera:
district glass-foxholes, kind **street** (24.8 m), clearance −1.50.

- P2a REFUTED. Not a market/bollard-line street: kerbs are expected here
  (grammar: asphalt, flush kerb h=0.13, footway 2.8 m, centre-line marking).
- P2b REFUTED as written. Kerb-face verts within 60 m of camera: 1230 of
  5160 (23.8%, vs ~18% suite-wide); bins 0–10/10–20/20–40/40–60 m =
  48/243/315/624. Projected through the pose camera: **8172 kerb-band
  (y ≤ 0.6 m) verts inside the frame, nearest 7.6 m**, with 2.05x baked
  vertex-colour contrast (face V 0.250 vs deck 0.122; authored kerbTone 2.0
  realised). The frame shows zero kerb pixels. Baking and grammar are
  exonerated; the loss is downstream of the baked mesh.
- P2c HELD. The colourful strip is the projecting-sign row, by unique
  signature: 296 bright-saturated verts in the view, 288 with emissive 3.4 —
  `emissive: 3.4` occurs exactly once in the tree
  (`groundbake.ts:732`, sign faces), colour (0.75, 0.19, 0.03), y ≈ 3.1–3.7.
  It is working clutter foreshortened into a palisade, not a glitch; its
  *density* impression belongs to the vision gate, and F5c's emissive wire
  is confirmed live (`gbuffer.wgsl:73`).
- P2d HELD. n=2550 warm bodies 24 m from camera: absence is the entity
  draw gate (dev1's active chase), not placement.

Localisation for routing (present-but-invisible is lighting/fragment, not
geometry): kerb geometry in-frame in normal proportion + authored contrast
in vertex colours + no kerb pixels ⇒ **fragment or lighting response**
— owner: `src/shaders/gbuffer.wgsl` `groundSurface` kerb-face detection by
normal, or sun/fog response on vertical faces; `src/render/renderer.ts` if
deeper. Do not retune `CLUTTER_TRIS`/`TRACE_STEP`: throughput is fine
(placed == wanted, 1060/1060 over 9 chunks).

Two precision notes, both mine to state and neither a fix: footway and
carriageway share one albedo by construction, so past kerb-face legibility
range the street is legitimately one colour (grammar-design, and the far
field may additionally be LOD2-bare by design); paint pop at grazing angles
could not be resolved headlessly and is noted, not claimed.

Nothing in this part was changed: no groundgrammar edit (nothing
unambiguously mine was broken), no render/sim/tools edits. F5's kerb numbers
(p50 0.12 m) and the frame are reconciled — the numbers describe baked
geometry, which is present; the pixels describe fragment response, which is
dev1's chase.

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0, no output (tree-wide; the
crowd.ts TDZ throw is runtime-only and dev2's).
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`
(props 58126, cables 3569, decode 66/66, kerb p50 0.12/p90 2.71).
`src/world/__selftest_sectionB.ts` → `VIOLATIONS none` (incl. new bazaar guard).
`src/world/__selftest_street.ts` → `VIOLATIONS none`.
`src/camera/__selftest.ts` → `ALL PASS`.
`src/sim/__selftest.ts` not run: imports the live-broken `crowd.ts`
(ReferenceError above); rerun when dev2 lands.

## Files changed (uncommitted)

- `src/world/districts.ts`: `clutterDensity` interface + 11 values.
- `src/world/citygen.ts`: one line (`dense` source).
- `src/world/__selftest_sectionB.ts`: street-level bazaar guard.
- `docs/GROUND_READ_DIAGNOSIS.md`: this file.
- Scratch probes (`__r4*_scratch.ts`) deleted. Others' live files untouched.
