# Ground round 3 — audit of the plan against HEAD

**Read-only audit by the vision reviewer, 2026-10-21. Code at `6d5e81a`.
No code changed, nothing captured, no writes outside this document.**

`docs/GROUND_ROUND3_PLAN.md` was checked claim by claim against the tree. Six
items below, each as *the plan says X; the code does Y; therefore Z*. The last
section is the single failure most likely to ship unseen, and the assertion that
would catch it.

---

## 1. The class list, the codec, and where the branch has to go

**The plan says** (`GROUND_ROUND3_PLAN.md` §3.1) that `'flood'` is two lines in
`src/world/groundgrammar.ts`: the union at **715** and the array at **716**, and
that the compiler refuses the class until the union moves.

**The code does** have the union at **715** and `GROUND_SURFACE_CLASSES` at
**716**, with `groundSurfaceTag` at **717-718** and `decodeGroundSurfaceTag` at
**720-722**. But `groundgrammar.ts` contains **no material classifier** — there
is no branch chain in this file at all. The classifier is `groundSurface()` in
`src/shaders/gbuffer.wgsl:442`, and its chain is **509-622**: `vertical`
(surface 2) → `isPaintY && isPaint` (5) → `isGutter` (4) → `isRaised || (surface
== 0u && family not 0/1/2)` (1, 3, and tagged carriageway) → the catch-all
`else` at **583**. Surface 6 matches none of the earlier tests, so a new
`else if (isFlood)` is reachable only if it sits in the gap at **582**, before
the `else` token at 583.

**Therefore** the plan's file split is right but its "two lines" framing is
wrong: there are three edits, and the third is in a different language. The
array append at 716 is **not** compiler-enforced — the literal is typed
`readonly GroundSurfaceClass[]`, so a subset is legal, `indexOf('flood')`
returns **-1**, and `groundSurfaceTag` yields a **positive** value
(`-(1 - 16 + family + height)`), which the renderer reads as emission, not as a
ground tag. The class then renders unshaded and slightly glowing, with no error.

---

## 2. GPU decode: equality tests, and the scope of `isFlood`

**The plan says** (§3.2) to add `let isFlood = surface == 6u;` beside the other
class literals at **454-458**, then use it at **501** (grain), **643** (ripple)
and **727** (weather wetness).

**The code does** decode with arithmetic, not a bitfield: `payload = max(0.0,
-tag - 1.0)`, `surface = u32(floor(payload / 16.0))` at **445-447**. Identity is
a chain of **equality tests** (`surface == 2u`, `5u`, `4u`, `1u`/`3u`, and the
`0u` special case at **533**). A tagged primitive is only admitted to
`groundSurface` when `isChunkDeck` is true at **661** — i.e. `matId ==
MAT_DIFFUSE && i.groundTag < 0.0` — and `groundTag` is `min(v.emissive, 0.0)`
at **77**. `isFlood` as proposed lives inside `groundSurface`, which ends at
**631**. Lines **643** and **727** are inside `fs` (**642-750**), a different
function: `isFlood` is not in scope there.

**Therefore** the grain edit at 501 works as written. The ripple at 643 and the
wetness exclusion at 727 cannot use that variable — WGSL will reject the
identifier, and the tempting fix (gate on `i.groundTag < 0.0` alone) silently
ripples and re-wets **every** tagged paving, kerb-top and gutter quad in the
city, not just the water. `fs` needs its own class decode from `i.groundTag`,
with the same `max(0.0, ...)` guard, kept in step with 445-447 by the guard in
§4.

---

## 3. Where the fall ground actually is, and why the water is buried

**The plan says** (§3.3) that `fallmesh.ts:100-103` is "the ground chunk" and
the flood geometry goes on the patch loop, with water quads at `GROUND_Y + 0.03
to +0.05` and a larger untagged silt quad beneath them ("it is ordinary
ground").

**The code does** emit no ground chunk in `fallmesh.ts`. `pushFallChunk`
(**68-108**) emits columns, village, decks, bridges, wreck, patches and stations
— the floor is the shared deck built by `pushGroundDeck`
(`src/render/citymesh.ts:1718`) and already tagged `paving` at
**citymesh.ts:1756**; per-chunk street tags are chosen in `groundbake.ts` at
**1278, 1296, 1345, 1373, 1609**. The fall patches at **100-103** are untagged
overlays: a box centred at `GROUND_Y + 0.03` with half-height 0.02 (**101**),
so its top face is `GROUND_Y + 0.05`.

**Therefore** water at `+0.03` is *inside* the patch box and occluded by its
own top face; water at `+0.05` is coplanar and z-fights. Either way the flood
class can be correct, the tag can reach the vertex buffer, every test can pass,
and no water is visible. The silt quad has the opposite problem: without a tag
it never reaches `groundSurface` (661/667), so it is flat `MAT_DIFFUSE`, not
"ordinary ground" — no grain, no joints, a dark rectangle. The floor's existing
paving tags sit underneath and are hidden by it.

---

## 4. The parity test: which file, and what it can actually prove

**The plan says** (§3.5) the source-level guard belongs in
`src/render/__selftest_ground_contract.ts` "or in `src/render/__perftest.ts`",
and that the `surface == {i}u` assertion passes only if the branch was inserted
before the final `else`.

**The code does** have the CPU codec round-trip at **73-79** and the per-vertex
tag scan at **86-88** in `__selftest_ground_contract.ts`; it is the only
self-test that bakes a chunk and reads `colors[i * 4 + 3]`.
`src/world/__selftest.ts` and `src/world/__selftest_fallzone.ts` import
`bakeChunk`/`fallmesh` but never read the tag channel or the WGSL, so a CPU/GPU
split is invisible to them. `__perftest.ts` is not in the documented
verification sweep (`AGENTS.md` or `PROCEDURES.md` §1 — neither runs it), so a
guard placed only there does not run in the standard checks.

**Therefore** the test belongs in `__selftest_ground_contract.ts`, next to the
round-trip at 73-79. But a regex for `surface == 6u` matches a comment, a
literal in a dead block, or a line in a different function — it proves
**presence, not reachability**, and it cannot see either the unappended array
(§1) or `pushOrientedBox` failing to forward the tag (§3.3 of the plan). A guard
that would catch the real failures needs three assertions: `indexOf('flood')
=== 6` in the array; the `surface == 6u` literal located **inside**
`groundSurface` between the last class test and the `else` at 583; and a baked
fixture with a flood-tagged primitive whose vertex tags round-trip.

The plan's claim that the presence check "passes only if the branch was inserted
before the final `else`" is false as stated.

---

## 5. Stale or wrong in the plan (beyond the above)

1. **The light-budget mechanism is backwards.** The plan (§1) says every zone
   lamp reduces the market's share in the chunk, citing PITFALLS §29. The code
   computes `const lightCap = lights.length + maxLights` at **groundbake.ts:306**,
   *after* the fall zone has already pushed into `lights` (`citymesh.ts:1539`,
   before `bakeGroundDetail` at 1649). The formula at **433-440** then cancels
   the pre-existing lights: the market's room is 48 minus only what the bake
   itself spends. Zone lamps **raise the chunk ceiling**; they do not take the
   market's share. §29 is about a consumer *inside* the bake (`pendingFire`),
   not about upstream lights. The 4-lamp cap is not required for market
   protection — it may still be prudent for GPU cost, but the stated reason is
   wrong, and an implementer who "mitigates" this will believe a non-problem is
   handled.

2. **Lifeline arithmetic contradicts itself.** §0 says 88 columns carry a
   lifeline and then lists 27 `stair-tower` + 61 `winch` + 24 `core-stair` =
   **112**, which is also 151 columns − 39 `none` (`fallzone.ts:771`). The
   union is at **70**, the field at **99**, not `fallzone.ts:100`.

3. **"9 ropeways with 4-6 stations each" vs "9 huts".** A ropeway stores a
   ground station plus one station per pile (`fallzone.ts:642, 647`), but
   `FallChunk.stations` keeps only `stations[0]` at **811** — one hut per line.
   The table's 9 is right; the prose's 36-54 would be wrong if built from.

4. **The silt quad is not "ordinary ground"** without a tag (see §3), and the
   plan's own 3.4 geometry puts it under a box whose top is at +0.05.

5. **The quoted delivered range omits pose 17.** §1 says 1189-1383; the JSON
   says 1189, **1107**, 1383 (see §6). The plan's numbers are the 16/18 pair.

---

## 6. The lights ceiling, measured

`shots/2026-10-21T17-14-22/_capture.json`, `stats.*.lightDelivery`:

| pose | delivered | starved | binned | refused tiles | cap |
|---|---|---|---|---|---|
| 16-fall-wreck-up | 1189 | 0 | 5700/5700 | 0 | 3072 |
| 17-fall-piles-level | 1107 | 0 | 5700/5700 | 0 | 3072 |
| 18-fall-skyline | 1383 | 0 | 5700/5700 | 0 | 3072 |

**Therefore** nothing is starved at the renderer; headroom is 1689-1883 lights,
not "~1700" at worst and not 1189-1383 as a floor. The plan's conclusion
(there is room for the zone's lamps at the renderer) is correct; its range is
not, and the binding constraint it should be quoting is GPU cost, not the
binner.

---

## The single most-likely silent failure

**The flood water is buried in its own patch box.** The existing patch top is
`GROUND_Y + 0.05` (`fallmesh.ts:101`); the plan places water at `+0.03` to
`+0.05`, i.e. inside or coplanar. The class, the tag, the branch, the ripple and
the parity test can all be right, and the frame shows dark wet silt with no
glint — which a reviewer can easily read as "the flood is subtle, but it is
there." Nothing in the current capture stats can see it: `_capture.json` records
lights and tile bins, not geometry, and neither `__selftest.ts` nor
`__selftest_fallzone.ts` inspects the tag or the height of a water vertex.

**What would catch it.** In `__selftest_ground_contract.ts`, select the chunk
that owns a `flooded` patch from `fallZone` (the existing fixture chunk `(0,-2)`
is a market chunk and has no fall zone, so the test has to derive the chunk — see
PROCESS rule 4), bake it, then assert (a) at least one tagged flood triangle
exists and survives to `colors[i * 4 + 3]`, and (b) every tagged flood vertex's
`y` is **greater than** the top of the patch box it belongs to
(`GROUND_Y + 0.05 + epsilon`). That single pair catches the burial, the
unappended class array (no tag exists), and the unforwarded `opts`
(`pushOrientedBox`, `fallmesh.ts:26-41`, which would produce no tag at all).
The frame check is pose 20 once it exists: a flooded patch at 15-30 m must show
the horizon glint in the silt, not a uniform dark plane.

---

*Scope note: this audit did not run the fall-zone probe or any capture. The
counts it disputes are the plan's own arithmetic or read from the code/JSON
cited above. Nothing in `src/`, `tools/` or `shots/` was written.*
