# Round 5 report: reconciliation, §D judgeability, phantom audit, §D start

## 0. Reconciliation: 1.48 vs 1.77 (rule 6 — the check now says the exact thing)

The round-4 report's table gave lantern-bazaar street-level S+L as **1.77**
(before §B) while `__selftest_sectionB.ts` prints **1.48** after the
"restored exactly" split. Both numbers were correct about different
populations: 1.77 was the full 169-chunk city at the capture seed
(0x5e7a17); 1.48 is the check's 64-chunk sample at seed 42.

Re-run on the check's own population against the pre-§B tree (worktree at
33b4a01^, same check file): **lantern-bazaar = 1.48, rank 1 of 7** — digit for
digit the post-split figure, because `clutterDensity` carries the old rolls
identically. The full per-district line reproduces exactly too
(verdant 1.01, neon 0.94, copper 0.68, monastery 0.66, glass 0.52,
terracotta 0.46). "Restored exactly" holds per-district for the same
population; the report now says so instead of implying one universal number.
The same run usefully proves the check fails loudly pre-§B (5 violations:
palette 23+1, separation, authored and district correlations).

## 1. §D verdict: JUDGEABLE without godrays and without water — except canal-base poses

No vision ruling clearing water/godrays for §D was found in
`VISION_ROUND1.md` (D5/D6/D7 cover the hero, C, and inhabitation),
`DESIGN.md`, or any review file — saying so plainly rather than assuming the
premise. The verdict below rests on the sheet pixels instead
(`references/D-verdant-sheet.jpg`, all six frames opened):

- godRays: absent from all six frames (soft daylight and haze throughout, no
  volumetric shafts) — and already closed in code anyway (`post.wgsl:353`
  reads `weather2.y`). Not load-bearing for §D. No work.
- Water: present in exactly **one** of six frames (bottom-right canal base).
  The other five read through planting, timber, terraces and daylight.
  Water surface is still PHANTOM (see §2) and is genuinely load-bearing for
  canal-base poses only.

So §D is **UNBLOCKED with a scoped review set**: build and review everything
except canal-base poses; judge those with a dry channel noted, or defer them
until water exists. R11's "blocked on two phantoms" is half-stale and should
be updated where the roadmap owns it (not in this file).

Tension stated, not resolved: `canal-district` serves **two** sections
(`sections.json`: B and D). Since round 3 it reads B-steel; D's canal-base
frame wants timber and water. That wants a reviewer ruling, not an engineer
splitting a district without frame evidence.

## 2. Phantom audit (all five rows + F5c, verified against the tree)

| Phantom | Verdict | Settles at |
|---|---|---|
| godRays | CLOSED (was already struck through; still true) | `post.wgsl:353,446`, COVERAGE as-is |
| precip | Still PHANTOM | `weather3.w` written `renderer.ts:868`, read by no shader; `__perftest.ts:247-271` guards it as deliberately unbuilt |
| structure-collapse | Still PHANTOM (the sharp one stands) | Tool receipt `agent/tools.ts:939` (`event #N structure collapse …`); handler `sim/weather.ts:540-549` only grades dust/haze — no tower comes down, `debrisChunk()` uncalled |
| debrisChunk() | Still PHANTOM | defined `citymesh.ts:1058`, zero callers in the tree |
| canal water | Still PHANTOM, thinner than documented | `bakeGround` returns an **empty** mesh (nothing pushed into `w`, `citymesh.ts:898-902`) and no `ground.water` reference exists in `renderer.ts` (`:701` uploads mesh only). COVERAGE row updated (old `renderer.ts:400` ref was line drift). Water-as-data (`waterDepthAt`) is live |
| F5c emissive | already FIXED (`gbuffer.wgsl:73`), unchanged | — |

No COVERAGE change except the water row's refs: every other row is current.

## 3. §D start: trace, predictions, baseline (no district changes this round)

D lane: `verdant-canyon` (0), `botanical-dome` (8), `canal-district` (9).
Palette/grammar already carry D: greenery 0.92/1.0/0.6, saturated green
foliage, `planter-row` ×2 in botanical's grammar, flagstone/dirt grounds.

- D1 REFUTED as written. Predicted verdant+botanical top-2 planting per
  building; measured (capture seed, full city): monastery 18.21,
  botanical 13.96, verdant 13.78, next 8.18. Tall facades accumulate sill
  planters, so a tall herb-garden district wins — authored identity, not a
  defect. D pair clearly separated from the rest; the metric, not the
  section, was wrong.
- D2 HELD. Facade timber exists nowhere: `timber`/`wood` grep-clean in
  `citymesh.ts` (timber lives only as groundbake clutter). Gap vs the
  sheet's timber/plank construction; the element would live in `citymesh.ts`
  (dev1's lane) — routed, not built here.
- D3 HELD. Water surface absent (empty mesh, unreferenced); water data live
  (suite: 0 buildings over the canal).

Committed as `src/world/__selftest_sectionD.ts`: D palette bands
(verdant warm-pale 20–60°, botanical green 90–130°, neither in B steel),
saturated foliage, planting floors per D district. Currently
`VIOLATIONS none`.

§D work definition for the next round (mine): canal-district dual-membership
ruling from the reviewer; D review poses excluding canal-base; timber
element owned by whoever owns `citymesh.ts`. No palette change was needed to
start: D identity is present and measured.

## 4. Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0, no output.
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`.
`src/world/__selftest_sectionB.ts` → `VIOLATIONS none`.
`src/world/__selftest_sectionD.ts` → `VIOLATIONS none` (new).
`src/world/__selftest_street.ts` → `VIOLATIONS none`.
`src/camera/__selftest.ts` → `ALL PASS`.
`src/sim/__selftest.ts` not run: `crowd.ts` carries another agent's live
runtime `ReferenceError` (TDZ-order, compiles clean); rerun when they land.

## Files changed (uncommitted)

- `docs/COVERAGE.md`: water row refs only.
- `src/world/__selftest_sectionD.ts`: new (this round's committed measurement).
- `docs/R11_D_VERDANT.md`: this file.
- Scratch probes deleted. Others' live files untouched.
