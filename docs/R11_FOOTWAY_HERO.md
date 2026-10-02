# Round 6 report: §D landing, footway capacity, market-spine lots, one correction

## 0. §D landed (verified, then committed)

`docs/R11_D_VERDANT.md`, `src/world/__selftest_sectionD.ts` and the
COVERAGE water row all survived (read back; the COVERAGE edit was already
committed). SectionD check re-run green. Committed in this round with the two
new files below — no tracked-file edits, so nothing else could drift.

Correction owed from round 4, stated plainly: P2c ("the strip is projecting
signs") was overclaimed. The headless signature (emissive 3.4, unique to
`groundbake.ts:732`) proves baked sign faces exist in the frustum — it does
NOT prove they are the visible pixels. The vision control pair
(enabled/disabled, `VISION_ROUND4.md`) shows the band disappearing with the
entity draw: the visible band is pedestrian geometry. I sampled the baked
mesh while the pixels came through the entity path — the wrong-population
error (PITFALLS §16/§21 family), caught by the reviewer's control, not by my
probe. The kerb localisation stands (kerb-band verts carry no such
ambiguity: entities are ~1.7 m figures, not ground-level horizontal faces).

## 1. Footway capacity per district (committed as `__selftest_footway.ts`)

Authored footway / clear band (minus 1 m clutter line) / capacity at 0.7 m
lateral pitch, street-kind: 2.20 (market-spine) … 4.40 (neon) → 1–4 abreast.
Market-kind road at the market district: 2.86 m → 2 abreast. Alley-kind:
0.66–1.32 m → capacity 0 in all districts (single-file-or-spill by
construction, asserted as design). Full table lives in the check; it prints,
it does not tune.

Judgement (mine, no numbers changed): a placed group (centre at kerb +
1.9 m, members ±1.5 m, wander ±1.5 m = ±3 m footprint) fits on NO authored
footway — spill is structural, and correctly so, because the references put
crowds across the avenue (B03), not single-file on pavements. The authored
widths are reference-true and stay. The binding condition is on the
distribution side: spread must use carriageway width (24–47 m streets;
dev2's `F.lateral` already spans ±21.9 m). If spread stays footway-pinned,
market/alley footways force ribbons — that conditional is the interface
statement, and it is dev2's test to run, not my dial to turn.

## 2. market-spine zero lots: RIGHT, not a defect

- Market-district positions foul at **100.0%** (146/146, capture seed):
  the corridor is too narrow for the lot lattice plus setbacks. Structural.
- 13 buildings city-wide face the market street (nearest road market-kind),
  all from neighbouring districts (copper 4, bazaar 4, rust 3, glass 1,
  botanical 1). Facade lighting IS exercisable — just not by
  market-district facades, which cannot exist.
- The market district is a road-plus-stalls district by construction
  (`sharpenForKind`: "carriageway given over to trading"). Hero unblocked on
  this axis; do not spend design on market-district facades. Open
  sub-question (exact method recorded): which of the 13 stand near the hero
  stall run — needs marketbake emission query per trace, not done here.

## 3. §D judgeability answer (the question asked twice, answered once)

JUDGEABLE without godrays (closed in code, absent from all six sheet
frames) and without water for every pose except canal-base ones (water in
1 of 6 frames; mesh empty by construction, unreferenced). No vision ruling
to the contrary was found in the docs; this verdict rests on sheet pixels.
`canal-district` serves B and D — dual membership wants a reviewer ruling
before anyone splits it. Frame review may proceed on a scoped set (no
canal-base poses).

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0.
`src/world/__selftest_footway.ts` (new) → `VIOLATIONS none`.
`src/world/__selftest_sectionD.ts` → `VIOLATIONS none`.
`src/world/__selftest_street.ts` → `VIOLATIONS none`.
`src/camera/__selftest.ts` → `ALL PASS` (prior round; rerun on demand).
`src/sim/__selftest.ts` not run: live `crowd.ts` runtime ReferenceError.
`src/world/__selftest.ts` behaviour unchanged (no tracked edits this round).

## Files committed (this round)

- `docs/R11_D_VERDANT.md`, `src/world/__selftest_sectionD.ts` (§D landing).
- `src/world/__selftest_footway.ts` (footway evidence).
- `docs/R11_FOOTWAY_HERO.md` (this file).
