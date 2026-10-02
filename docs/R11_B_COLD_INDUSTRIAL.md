# R11 §B — cold-industrial (glass-foxholes, rust-hangars, canal-district)

Round 3 consequence-style report, written to file per WORKFLOW §3.5 so the
reasoning survives the pane buffer. Headless round: no captures taken; the
frame-review gate (§6) is still open and belongs to a later serial slot.

Reference: all four frames in `references/sections/B-cold-industrial/` were
opened before any colour was touched. Read: desaturated steel-blue masses and
ground plane throughout, warm restricted to small emissive points (windows,
signs, lanterns, the red cable cars), ropeways strung between tall masses at
altitude as the compositional subject. Reviewer's read: "cold massive
enclosure".

## 1. Palette consumers traced (F5 precedent: a value nothing reads is a phantom)

| Palette field | Live readers | Status |
|---|---|---|
| base | `citygen` facade colour; `citymesh` shells, plinths, props tint | LIVE |
| secondary | `citymesh` plinth/roof quads; `citygen` laundry lines | LIVE |
| trim | `citymesh` ribs/parapets/crowns; kerb albedo via `groundgrammar`; skybridges; awnings/dishes | LIVE |
| glass | `citymesh` window bands | LIVE |
| roof | only the analytic shell in `__selftest.ts` | PHANTOM in renderer — reported, not fixed |
| ground | `groundgrammar` carriageway albedo | LIVE |
| foliage | `citygen` planters/trees/vines | LIVE |
| metal | props, masts, cables, clutter | LIVE |
| water | mesh discarded by renderer (HANDOFF-known) | PHANTOM — left untouched on purpose |
| emissive | `citygen` signs/lanterns; `networks` zipline colour; market boards; `crowd` tint pool | LIVE |
| accentColor | `citymesh` accent; groundbake clutter; cranes | LIVE |
| shadeLo/shadeHi | computed in `districtPaletteLinear`, read by nothing | PHANTOM-ish — reported, not fixed |

Facade windows do NOT read `palette.emissive` (night window light is
shader-global); the warm-restriction therefore acts through signs, lanterns,
zipline/bridge colours and tint pools. B emissives are now warm amber
(`#ffb35e`, 23°) where glass-foxholes was cyan (`#9fe8ff`, 198°).

Value structure kept distinct inside B so it does not homogenise with itself:
glass pale icy, rust dark slate, canal mid stone. Against the other sections:
B mean base hue 208.8° vs rest 42.0° — separation 166.8° (was 11.8°).

## 2. What changed (two separable hunks in `src/world/districts.ts`)

Hunk 1 — palette hexes + descriptions for ids 3/5/9 (descriptions were stale
either way and are read by nothing layout-relevant — verified by grep).
Hunk 2 — `cableDensity` re-weighted with height (sum 9.9 → 10.2, mean 0.90 →
0.93, tri budget held):

```
neon 1.9  monastery 1.7  glass 1.5  copper 1.4  verdant 1.0  canal 0.9
terraces 0.7  market 0.6  bazaar 0.6  rust 0.5  botanical 0.4
```

Authored Pearson(heightMid, density): −0.235 → +0.961.

## 3. Cable correlation, before → after (seed 42, same 64 chunks)

| Metric | Before | After |
|---|---|---|
| realised building-level Pearson | −0.547 (n=1337) | +0.020 (n=1337) |
| district-level Pearson (DESIGN §4's framing) | −0.65 | +0.302 |
| neon / glass / copper cables per bldg | 3.52 / 2.45 / 2.09 | 5.68 / 4.81 / 3.55 |
| lantern-bazaar cables per bldg | 6.00 | 1.97 |
| monastery-spire cables per bldg | 0.15 @446m | 0.36 @446m |
| total cables / props (64 chunks) | 2898 / 58126 | 3569 / 50728 |
| bakeChunk 64-chunk | 4.99M | 4.26M |

The building-level coefficient did NOT flip: monastery-spire's 429 sparse
needles stand at ~446 m with almost no neighbours in 96 m ray range, so
attempts (3 → 9 per building) cannot become successes there. Starving the low
districts further would move the statistic without moving a ropeway, so that
was not done. The geography still inverted where buildings are dense enough
to carry cables — district-level sign flip carries that. Longer rays for tall
sparse pairs would be a mechanism change (second idea); noted, not bundled.

Side effect, stated plainly: `cableDensity` also drives facade/rooftop
clutter (`citygen.ts:720`), so props fell 13% and lantern-bazaar's sign and
lantern density dropped ~3x. Bazaar/market identity lives in the separate
market-grammar systems (untouched), but the A-round should re-check bazaar
facades — the knob is shared and this round did not split it.

## 4. Predictions (written before testing) and verdicts

- P1 HELD — 19/21 B diffuse slots violated the steel band (hue 195–230°,
  sat ≤ 0.45) plus the cyan glass emissive = 20 violations; after: 0.
  (First pass left 7 slots at linear-sat 0.46–0.50 — sRGB estimates underread
  linear saturation ~1.75x — and was corrected by measurement, twice.)
- P2 REFUTED — realised building-level r went −0.547 → +0.020, not ≥ +0.15.
  One finding, not a failure: the monastery anchor explains it, and the
  district-level coefficient flipped −0.65 → +0.302 with ropeway counts up
  where tall buildings cluster.
- P3 HELD — B-vs-rest separation 11.8° → 166.8° (bar 100°); witnesses
  terracotta (11°) and botanical (111°) outside the band.
- P4 HELD — world suite `VIOLATIONS none`; decode 66/66; kerb p50 0.12 /
  p90 2.71 unchanged; determinism 64/64.

## 5. Checks (re-runnable, not prose)

- `src/world/__selftest_sectionB.ts` (new): palette band table, separation,
  witnesses, authored + district-level + building-level correlations.
  Currently `VIOLATIONS none`.
- Existing suite untouched in logic; its numbers moved only through content:
  bake 4.26M, props 50728, cables 3569, canyon p50 26.06m unchanged.

## 6. Left open

1. Frame-review gate: B poses against the B sheet + `wide-skyline`
   homogenisation check — needs a serial capture slot (ask owner).
2. Monastery long-span ropeways: ray-range or tall-endpoint preference in
   `placeCables` — a mechanism change, deliberately not bundled here.
3. A-round: revisit lantern-bazaar facade clutter after its density cut.
4. Phantoms reported: `palette.roof`, `palette.water`, `shadeLo`/`shadeHi`.

## 7. Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0, no output (tree-wide; the
`src/sim/crowd.ts` errors from another agent's live edit are gone).
`npx vite-node src/world/__selftest_street.ts` → `VIOLATIONS none`.
`npx vite-node src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`.
`npx vite-node src/sim/__selftest.ts` → `ALL PASS`.
`npx vite-node src/camera/__selftest.ts` → `ALL PASS`.
