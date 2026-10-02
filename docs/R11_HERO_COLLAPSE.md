# Round 7 report: collapse excision, hero anchor, footway verdict

## 1. `structure-collapse`: excised. The tool can no longer lie.

Decision: removal, not R5. A fracture renderer is R5's scope; the task was
the lie. What was cut (kind string gone from every code path):

- `core/state.ts` EventKind union; `agent/tools.ts` EVENT_KINDS + labels
  (removal here alone would have silently retargeted requests to `sunbreak`
  via the enum fallback — the second lie this excision prevents);
- `agent/localbrain.ts` panic pattern (kept agitation-only) and collapse
  pattern (now an honest refusal with zero tool calls); help text no longer
  advertises "collapse"; `agent/ui.ts` `/event` list;
- `sim/weather.ts` durations, tags, and the dust/haze handler. The handler
  graded real pixels, but it was reachable ONLY through this kind — keeping
  it would mint a new phantom handler. Its constant went with it.
- `sim/__selftest.ts` event list.

Verification: `grep structure-collapse src/` → nothing; pinned tsc exit 0;
live behavior probed — "collapse it" and "demolish that tower" return
`I cannot collapse structures — nothing here comes down` with `calls: []`;
"panic" keeps agitation with no phantom event; "festival" still emits
bloom-festival. COVERAGE row marked REMOVED (above). `sim/__selftest.ts`
could not be re-run (live `crowd.ts` TDZ throw, dev2's, pre-existing);
its edit is type-checked.

## 2. Hero anchor: OPTION 1 — shootable. (Predictions: T2 HELD.)

- Market-district foul rate 100.0% (146/146): zero lots structural, not a
  bug. Option 3 refuted with the number.
- Hero zone (spine along 0–600): **143 stalls** (range 10–598) + **13
  enclosing buildings** from 5 districts (glass 4, bazaar 3, copper 3,
  verdant 2, botanical 1), enclosure by 200 m band **1/7/5**. One facade
  (bazaar, along 540) directly faces the market road; the rest enclose.
- R2's thesis (received warm light on the aisle) executes through stall
  lanterns and the 13 neighbours (bazaar/copper emissive-rich), not through
  market-district facades that cannot exist. D5's readability list
  (counters, aisle, bodies, lanterns, enclosure beyond) is all present.
- Recommendation: shoot the hero as specified. Moving the anchor (option 2)
  breaks D5 reproducibility. Note for the capture: enclosure concentrates
  mid/late run; the open approach (0–200 m) matches D5's approach gap, so
  pose with that reading in mind. Open sub-question (method recorded, not
  run): per-stall-run adjacency of the 13 facades via marketbake emission
  query.

## 3. Footway verdict, district by district (no tuning performed)

`__selftest_footway.ts` stands: street-kind capacity 1 (market-spine) to 4
(neon, terracotta) abreast at 0.7 m pitch; market-kind road at the market
district 2.86 m → 2; alley-kind 0 everywhere (single-file by design,
asserted). A placed group (±3 m footprint) fits on NO footway — spill is
structural and reference-true (B03 crowds the avenue, not the pavement).
Judgement: footways stay; lateral spread must use carriageway width
(24–47 m; dev2's `F.lateral` already spans ±21.9 m). If spread stays
footway-pinned, market/alley footways force ribbons — dev2's test to run.

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0.
`grep -rn structure-collapse src/` → no output.
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`.
`src/world/__selftest_footway.ts`, `__selftest_sectionB.ts`,
`__selftest_sectionD.ts`, `__selftest_street.ts` → `VIOLATIONS none`.
`src/camera/__selftest.ts` → `ALL PASS`.
`src/sim/__selftest.ts` not run (live crowd.ts TDZ throw).

## Files committed (this round)

- Excision: `core/state.ts`, `agent/tools.ts`, `agent/localbrain.ts`,
  `agent/ui.ts`, `sim/weather.ts`, `sim/__selftest.ts`, `docs/COVERAGE.md`.
- Report: `docs/R11_HERO_COLLAPSE.md` (this file).
- Scratch probes deleted.
