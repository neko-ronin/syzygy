# Market report — developer 2, rounds 1 and 2

Everything below was measured. Where a number came from reading code rather than
from a measurement, it says so.

**Commits:** `98a0b6f` (Task A, crowd market attractor), `1d013b1` (market
grammar and bake), `c560e5e` (round 2: cloth, lamps, canopy variety).

---

## 0. The status of this work: DESIGN HYPOTHESIS

`docs/STREET_SPEC.md` §C opens with a correction, not a brief:

> **The opened reference set does not contain a sufficiently legible night
> market to specify a complete stall.** No frame clearly exposes a vendor
> counter, merchandise, canopy supports and customer aisle together.

**Almost everything in the market grammar is therefore an invention, not a
specification.** That is stated in the source next to the rule it applies to, and
it is repeated here because a design hypothesis presented as a specification is
how this project loses trust in its own documents — `docs/COVERAGE.md` exists
because five `PHANTOM`s survived three sessions, each of them a name with nothing
behind it.

### What the references actually support

| Element | Status | Where the spec says so |
|---|---|---|
| Warm pedestrian light against cool violet/blue surroundings | **evidenced** | §C: "A's relevant supported relationship is warm pedestrian light against cool violet/blue surroundings, with people and edge structures breaking up the route." A02 |
| Many small warm lamp points whose pools articulate the path | **evidenced** | §B: C04 shows "more than 10 small warm lamp points along successive galleries… Their pools articulate the path." |
| Projecting illuminated sign panels, dense | **evidenced** | §B: B03 has "roughly 5–8 nearby projecting illuminated panels"; "roughly 15–25 glowing sign/fixture silhouettes" across a canyon |
| Hanging pennant / laundry-like strips | **evidenced** | §B §C "Other visible detail": "Dense cables, gallery supports, hanging pennant/laundry-like strips and façade projections" |
| Bright amber ribbons against darker buildings (the vertical register) | **evidenced** | §A: "In C04, nearest steps occupy roughly 5–10%, with remote lit walkways another 8–15%" |
| Fabric-like tarps stretched across projecting structures | **weakly evidenced, and explicitly not transferable** | §B: "B02 shows two conspicuous pale fabric-like tarps… **These are not confirmed market shelters.**" |

### What is invented, and why

The spec lists each of these as unestablished. The reasoning is recorded here so
a later session can argue with the choice rather than rediscover it.

| Choice | Reasoning |
|---|---|
| **Stall pitch 1.9–4.4 m** | No reference establishes stall width (§C: "Counter construction, goods, storage, stall width/depth, open versus enclosed stall"). Chosen so a full stall row on both kerbs of a 26–36 m street gives runs dense enough to read as a market and gaps long enough to see through. Measured 2.28–4.18 m in practice. |
| **Runs of 12–46 m, gaps of 4–17 m** | Same. Chosen against the spec's §F warning: "Uniform procedural repetition will turn the street into another noisy pattern." An even comb is the failure it names. |
| **Canopy overhang 1.1–2.3 m into the carriageway, depth 1.7–2.7 m back to the building** | The spec cannot tell us "what covers the ground" or the stall envelope. The market spine is 26–36 m wide, so a stall row does not fit in the carriageway; straddling the kerb is the layout that gives both a footway row and a tarpaulin that breaks the sky over the road, which is the single strongest street-level read. |
| **Eave 2.25–2.6 m, ridge 2.85–3.4 m** | §C lists "Canopy clearance in metres and sky remaining above a market aisle" as unmeasured. Chosen to clear a standing person's head at the roadward edge and to leave the sky visible above the ridge line from a distance. |
| **Monopitch roof leaning on the building** | Not specified anywhere. A pitch is what a tarpaulin tied to a facade actually does; a symmetric gable needs a ridge post in the middle of the stall. |
| **Support: four poles, or tied to the building on raking arms** | §C asks "What supports a canopy? … A market canopy's posts, wall attachment, ropes, braces or frame" is listed as **unestablished**, and B02's tarps "cannot be treated as a night-market stall prototype". **Both are built**, mixed by hash. Building only one would have been picking a side the references refuse to pick. |
| **Trestle counter at 0.92 m** | §C: "Counter construction… unestablished". 0.92 m is a standing counter height; no reference measures one. |
| **Crates, 0–3 per stall, one stacked** | §C: "Market mats, loose boards, crates, rubbish, drainage, spilled goods or wet pavement" — all unestablished. Crates were chosen because §D's three-metre test asks for "support and attachment" to be legible, and a stack is the cheapest object that reads as *goods* rather than as *a box*. |
| **Projecting sign brackets, one in two stalls** | §B supports the density ("5–8 nearby projecting illuminated panels"). §C says "Whether stall signs hang from canopy fascia, cross-street wires or independent poles" is unestablished. Brackets off the building line were chosen because §D's close-focus bar demands "support and attachment" be distinguishable at three metres, and a bracket is an attachment. |
| **Cooking vents, one stall in seven** | §C: "Lantern strings, counter lamps, bare bulbs or cooking fires at individual stalls" — all unestablished. Fireboxes are lit geometry; **there is no steam plume**, because this project has no particle system and a field nothing reads is the documented failure mode (PROCESS.md rule 5). |
| **Lantern cords with 5–9 lanterns each, one cord per 17–31 m** | §B supports the *density* of small warm points but is explicit that the source is "lamps on or beside railings", not lantern strings. §C: "Lantern strings… at individual stalls" is unestablished. Chosen to deliver the evidenced point count. |
| **Hanging pennants and laundry strips** | **Evidenced** — see the table above. This is the only market element with direct reference support. |

---

## 1. Task A — the crowd's market attractor

`crowd.ts:maybeRebuild` drew a uniform point in an 840 m × 840 m square and
re-rolled it every 2.5 s. Nothing about it referenced the market spine and
nothing referenced the camera.

### Before (seed 42, camera at the origin, 10 consecutive rebuilds)

```
attractor distance to market spine   mean 218.3 m, min 49.9, max 556.9
district at the attractor            d1 d3 d3 d3 d0 d0 d1 d4 d3 d6
market-district landings             0 of 10
distinct nav nodes over 10 rebuilds  10
distance from camera                 225-520 m   (viewRadius is 80-240 m)
```

Zero of ten landed in the market district. Every one was outside the radius the
crowd is ever seeded in. The destination changed every 2.5 s.

### After — the attractor is the quantised spine point nearest the camera

| scenario | dist to spine | nav node dist | district | moved |
|---|---|---|---|---|
| A camera at origin | 0.00 m | 0.0 m | d10 | 1× / 30 s |
| B camera 900 m off-market | 0.00 m | 45.1 m | d10 | 1× |
| C camera on the spine, static | 0.00 m | 0.0 m | d10 | 1× / 30 s |
| D camera walking the spine at 4 m/s | 0.00 m always | mean 3.2 m, max 21.2 m | d10 | 9× / 30 s, ~15 m steps ~3.8 s apart, never lagging >8 m |

**B is load-bearing.** The candidate set *is* the centreline, so the camera bias
picks which stretch of market is busy and cannot put the attractor in a park.
**D is the other.** A destination that moves faster than a person walks is a
crowd that never arrives.

### Also: `Need.Event` was dead

`this.events` was declared at `crowd.ts:415` and never assigned, so the
`Need.Event` branch was unreachable: `bloom-festival` raised the Event weight
3.0× and every one of those agents fell through to the generic neighbourhood
search. `WorldEvent.at` (`core/state.ts:188`) had no consumer anywhere in the
repository. One line: `this.events = world.events` in `update()`. That array is
mutated in place by `push`/`splice`, so holding the reference is free and correct.
`-1` goals were already reachable from `randomNodeNear` and are guarded in
`stepAgent`, so an event outside the nav graph degrades to local wandering.

---

## 2. Task B — the grammar

`src/world/marketgrammar.ts` is a pure function of
`(seed, plan, chunk, road kind, district)` returning plain descriptors. No GPU,
no WGSL, no `MeshBuilder`, no `Math.random` — so it is testable without a device
and it ports to a different mesh layer unchanged.
`src/render/marketbake.ts` is the only module that knows both the grammar and the
mesh layer, and exports exactly `bakeMarketDetail(bld, ctx)`.

**Determinism.** Every element draws from its own `Rng` forked off a seed
derived from `(seed, cx, cz)` — *not* from `ctx.rng`. That is stronger than
determinism: it makes the output independent of how many times, and in what
order, the bake happens to call it. A grammar whose output shifts when a caller
is added upstream is a grammar that will silently change the city, and nothing
would report it. Measured: two bakes of the same chunk are byte-identical; a
different seed produces a different market.

**Chunk claiming.** A stall belongs to the chunk its *spine point* falls in.
Padding the walk by the stall's own reach (~22 m) made both neighbours emit the
same tarp twice; the neighbouring module's self-test was already reporting 6239
vertices overhanging their bounds. With spine-point claiming that fell to 449,
and the per-chunk stall count dropped 21% with nothing missing from the row.

### Measured, seed 42, 120 chunks within 1400 m, 17 with market content

```
market tris/chunk   lod0 11198   lod1 5700   lod2 0     (49.1% dropped at lod 1)
control: off-market chunk  lod0 97294 tris
delta               +11198 tris = 11.5% of that baseline
worst single chunk  +18744 = 10.9% of its own total

totals   1093 stalls, 1697 crates, 543 signs, 148 vents
         132 cords, 897 lanterns, 591 lights (cap 48/chunk)
```

Per-chunk detail, canopy variety, cloth and light spread: see the verbatim
self-test output in §6.

---

## 3. The four defects, and what made them invisible

Three of these were invisible because every counter in the system agreed. A
grammar that never puts a stall on the footway still emits the right number of
stalls.

### 3.1 The LOD test was inverted

Descriptors carry the coarsest LOD at which they survive; the bake skipped them
with `s.lod > ctx.lod`. **Measured consequence: lod 0 emitted 0 triangles and
lod 1 emitted all 5984 of them.** Nothing errored. The self-test printed a
triangle count and it was simply zero.

### 3.2 `noise2` peaks at 0.461, not 1.0

Measured over 3296 samples: `noise2` spans −0.406…0.461. `fbm2(…, 3)` over four
biases: −0.405…0.474. Dividing by an assumed unit amplitude meant the pitch noise
covered 2.6–3.8 m of a declared 1.9–4.4 m range — the "low-frequency variation
between dense runs and quiet gaps" was a flat comb. `PITCH_NOISE_SCALE = 0.48` is
the measured value and the pitch now spans 2.28–4.18 m.

### 3.3 Gaps were a threshold on that same noise, which cannot work

A one-dimensional slice of two-dimensional Perlin never visits its full range, so
a threshold that ought to have opened a quarter of the slots opened **0.7%**.
Measured. A threshold is also the wrong *shape*: it makes isolated holes rather
than stretches. Runs and gaps are now run *lengths* — 12–46 m of continuous
stall, 4–17 m of quiet — drawn from a hash, which has a distribution you know.
Measured gap fraction: 33.5%.

### 3.4 The stalls were inside the buildings

Measured at seed 42 over 234 samples along the spine: the nearest facade is
**13.1 m** from the centreline at the 5th percentile and 25.6 m at the 25th,
against a half-width of 17.6 m. A fixed `DEPTH_MAX` therefore drove tarps
through walls on 17% of the spine: **3025** footprint samples inside a building
AABB.

The building-side edge is now pulled in until an SAT test says clear. The first
attempt still failed, because the separating-axis test read the *rectangle's*
second half-extent where it wanted the *building's*, so no axis ever separated.
**3025 → 2436 → 127 → 0**, in that order.

---

## 4. Round 2 — what changed and why

### 4.1 Hanging cloth (TASK 2)

Pennants and laundry strips on the same catenary idiom as the lanterns, half of
the cords carrying them. A strip is one double-sided ribbon; a pennant is two, the
lower at 85% width, which gives a stepped taper that reads as a point at street
range for four triangles. The ribbon's `up` is the cord's horizontal normal so
its width runs *along* the cord — cloth hanging edge-on to the street is a line,
and a line is invisible.

**This is the only market element with direct reference evidence behind it**
(STREET_SPEC §B, §C "Other visible detail"). Measured: 725 pieces, 387 pennants,
47/47 present in the baked mesh at their declared attachment point.

### 4.2 Light pools (TASK 3)

Two faults, and **neither of them was the pool**.

The first version lit one lantern in three, which put one lit point every 15 m of
street. §B counts "more than 10 small warm lamp points along successive
galleries" with "several… within a short visible stretch". Second, the cap was
applied **in walk order**, so a chunk that wanted more than 48 lights got a lit
stretch followed by a dark one — a seam straight down the middle of the market,
visible only at night. The budget is now spent by a **Bresenham spread** over the
whole walk. Measured: 4.5 lit lanterns per cord, and **34.6%** of lit lanterns
fall on the last quarter of the cords. Walk-order truncation gives near zero; the
assertion is `tailShare >= 0.12`.

The pool arithmetic, done against the exact attenuation in `lighting.wgsl:191`
and the exact night ambient in `weather.ts:234`, was never the problem and is
now in the self-test so nobody re-derives it:

```
pool/ambient at 0,2,4,6,8,10,12 m lateral:  74x 63x 40x 21x 9x 3x 1x
above 2x ambient out to 10.8 m lateral
```

The pool is large and strong. There were simply not enough of them.

### 4.3 Not clones

STREET_SPEC §F is a warning about precisely this: "Identical cracks, evenly
spaced props and repeated canopy modules can fill the empty ground while
destroying the references' large value groups and section differences."

The row was one module: three panels, four poles, one rectangle of sign. Now two
roof panel counts and two support types, mixed by hash — measured **652
three-panel / 441 five-panel, 727 on poles / 366 wall-tied**. `wall-tied` is a
canopy carried on raking arms off the building post with nothing standing in the
carriageway at all; `poles` stands four legs in the road.

Signs went from one stall in three to one in two, with tall panels and wide
fascia bands mixed — measured **332 / 211**.

### 4.4 Three new assertions were wrong before the geometry was

Worth recording, because each read as "the geometry is missing":

- `positions` is a `Float32Array`, so 0.35 does not survive the round trip and
  an unsigned `< GROUND_Y` filter rejected the very leg vertices it was hunting.
  Reported as 0/23 pole-framed stalls having legs.
- A ribbon's first vertices sit `halfWidth` either side of its attachment along
  the cord, not on it. Reported as 44 of 47 cloths unbuilt.
- A `pitch * 0.6` window in `along` sees a stall's own legs at `pitch/2` *and*
  its neighbour's at `pitch/2 + STALL_SEPARATION`. Reported as 5 wall-tied
  stalls with legs standing in the carriageway.

---

## 5. The blocking bug, and whether the fix works

`bd3d718` reconnected the emissive wire. `gbuffer.wgsl` now reads

```wgsl
o.emis = max(v.emissive, v.params.z * v.tint.a);
```

The old line read `v.params.z * v.tint.a` — instance emissive only — and for
every chunk draw `params.z` is 0 by construction, so `o.emis` was always zero
and the entire per-vertex emissive channel was a dead wire. Every
`PropKind.Lantern`, every `PropKind.Sign`, and every lantern cord, projecting
market sign and lit cooking firebox this grammar emits was dark.

**Confirmed fixed, on this grammar's geometry.** `night-down.png` shows distinct
warm lamp points on three legible cords, a gold canopy edge, lit crate faces and
an amber pennant, against cool blue towers. The lanterns and signs glow.

**What is still missing is not the glow but the light.** `groundbake.ts` ends
the market block with `void lights;` — the `lights` array is in scope two lines
above and is explicitly discarded. Every clustered light the grammar harvests is
computed, capped, evenly spread, and then thrown away. The night frames have no
pool on the street at all. See §7.

### The light budget is already over-subscribed, and not by the market

Measured at the app's own seed, over the 32 chunks within 700 m of the origin:

```
  market chunks   7, lights baked today 653 (mean 93), market wants +317 (mean 45, cap 48)
  off-market     25, lights baked 2890 (mean 116)
  every chunk in this disc harvests 3543 lights today
  wiring the market would raise it to 3860  (+8.9%)
  MAX_LIGHTS in renderer.ts is 3072
```

The bin is **already** full before the market contributes anything, so wiring
these lights evicts about 317 other lights. Worse, `renderer.ts:855 gatherLights`
decides who survives by **resident-chunk insertion order**, not by distance or
intensity:

```ts
for (const e of this.chunks.values()) {
  ...
  for (const l of e.lights) {
    if (w.count >= MAX_LIGHTS) break;
```

So which 317 lights go dark is arbitrary and changes as chunks stream. This is
`renderer.ts` territory and not mine to change, but it is the reason the +8.9%
is not free, and it should be scored rather than truncated.

---

## 6. Verification, verbatim

```
$ npx tsc --noEmit
(no output, exit 0)

$ npx vite build
dist/index.html                 11.39 kB │ gzip:  3.45 kB
dist/assets/index-Vynem9Wo.js  332.99 kB │ gzip: 114.12 kB
✓ built in 458ms

$ npx vite-node src/sim/__selftest.ts
ALL PASS

$ npx vite-node src/camera/__selftest.ts
ALL PASS

$ npx vite-node src/world/__selftest.ts
VIOLATIONS   none — all invariants hold

$ node tools/lsp-check.mjs
5/5 language server(s) verified
```

`src/world/__selftest_market.ts` — full output:

```
```
market self-test — seed 42, 120 chunks within 1400 m
  market spine: width 35.3 m, amp 351 m, freq 0.00064

chunks with market content: 17 of 120
 cx   cz   metres  slots stalls gaps rej  crates signs vents  cords lanterns lights
 -5   -4     256    148     88   45  15     123    44    12     11       69     48
 -5   -3      52     29     16    8   5      32     8     2      2       11     11
 -4   -3     304    177    111   56  10     149    55    15     13       95     48
 -3   -3      36     21     16    5   0      23     8     2      2       14     14
 -3   -2     240    153    100   53   0     166    50    14     10       64     48
 -2   -2     228    133     89   44   0     154    44    12     10       69     48
 -2   -1      36     23     17    6   0      27     8     2      2       14     14
 -1   -1     316    183    113   69   1     195    56    16     14       86     48
  0   -1      12      8      8    0   0      10     4     1      1        5      5
  0    0     316    190    117   65   8     182    58    16     13       93     48
  1    0      32     21     20    1   0      27    10     2      2       16     16
  1    1     264    157     86   57  14     139    43    12     12       85     48
  2    1     124     70     44   26   0      63    22     6      6       42     42
  2    2     172    112     68   32  12     105    34     9      8       53     48
  3    2     260    162     81   60  21     128    40    11     12       76     48
  3    3       8      6      6    0   0       4     3     0      1        9      9
  4    3     296    190    113   70   7     170    56    16     13       96     48

triangles, market chunks only (17 of them), lod 0
 cx   cz   market   chunk-at-lod0   share
 -5   -4    13936         118582    11.8%
 -5   -3     2572         100866     2.5%
 -4   -3    17960         156110    11.5%
 -3   -3     2620          85102     3.1%
 -3   -2    15716         120746    13.0%
 -2   -2    14384          97800    14.7%
  market tris/chunk   lod0 11198  lod1 5700  lod2 0
  dropped lod0->lod1  49.1%  (crates, rigging, vents)
  chunk tris          lod0 mean 116347 over 17 market chunks, max 172156
  worst single chunk  18744 tris = 10.9% of that chunk
  control             off-market chunks lod0 mean 97294 over 6 chunks
  delta               +11198 tris on a market chunk, 11.5% of that baseline

invariants over 1093 stalls in 17 chunks
  pitch                2.28 .. 4.18 m
  gap slots            33.5% of 1783 slots
  kerbs                +1 557 stalls, -1 536 stalls
  canopy not overhanging the kerb line   0
  stall straddling both kerbs / inverted  0
  eave below 1.9 m or ridge <= eave       0
  roof samples inside a building footprint 0
  canopy modules       652 three-panel / 441 five-panel, 727 on poles / 366 wall-tied
  sign silhouettes      332 panels / 211 bands   (543 total, 1 in 2 stalls)
  cooking vents         148, 1 stall in 7
  hanging cloth         725 pieces, 387 pennants (1 cord in 2 carries cloth)
  lit lanterns          217 across 6 chunks; 34.6% on the last quarter of the cords

cord  anchors y 7.77 / 7.77, sag 1.30
  midpoint y 6.475 expected 6.475  (sag at mid-span)
  every lantern hangs below the cord: true

determinism  mesh identical true; counts identical true

light pools  ambient diffuse on the deck = [0.00062, 0.00094, 0.00319]
  lantern r=15 intensity=3, hanging 6 m over the deck
  pool/ambient at 0m, 2m, 4m, 6m, 8m, 10m, 12m: 74x 63x 40x 21x 9x 3x 1x
  pool 27.5 m sphere footprint at deck level; above 2x ambient out to 10.8 m lateral
  8.0 cords/chunk, 4.5 lit lanterns per cord

mesh  chunk -5,-4: 19436 verts, 13936 tris
  y range              0.350 .. 9.688 m  (deck 0.35, declared ceiling 10.15)
  cloth over carriageway 6980 verts, over footway 6058 verts
  eave edge present     40/40
  ridge edge present    40/40
  belly sags by the declared SAG_ALONG/SAG_ACROSS  40/40
  hanging cloth         47/47 pieces present in the mesh
  roadward legs         23/23 pole-framed stalls have one; 0/17 wall-tied stalls have one (must be 0)

totals  stalls 1093  crates 1697  signs 543  vents 148
        cords 132  lanterns 897  lights 591 (cap 48/chunk)
        1.55 crates/stall, 0.12 cords/stall
  runs 12-46 m, gaps 4-17 m, pitch noise scale 0.48, corridor scale 0.55, deck y 0.35

VIOLATIONS: none
```
```

---

## 7. What the frames show

Six frames in `shots/market/`, shot at 1600×900 from the app's default seed
`0x5e7a17`, market spine width 28.1 m: `day-down`, `day-three-quarter`,
`night-down`, `night-three-quarter`, `night-looking-back`,
`night-along-the-row`.

### How they were shot, and the three things that went wrong first

`tools/capture.mjs` belongs to another agent mid-session (F2/F6) and its POSES
table has no market frame, so the poses come from a throwaway that derives them
from live state and **prints the verification beside each one**:

```
spine width 28.1 m, runs carrying a market: along -900 .. 900
DOWN_THE_STREET   position [1.16, 2.6, 0.36]     VERIFY camera 0.01 m off the spine centreline; 27 market stalls within 40 m
THREE_QUARTER     position [4.8, 3.4, 32.58]     VERIFY camera 12.01 m off the spine centreline; 21 market stalls within 40 m
LOOKING_BACK      position [11.04, 2.3, -38.46]  VERIFY camera 0.01 m off the spine centreline; 30 market stalls within 40 m
ALONG_THE_ROW     position [-13.34, 2.9, -3.47]  VERIFY camera 14.99 m off the spine centreline; 26 market stalls within 40 m
```

That verification is not ceremony. The first attempt used a pose helper that
shared one mutable `SpineHit` scratch, so `along` was corrupted between calls,
the camera landed outside the market run, and the frame was a dark wall with two
lit windows in it. Read naively that says "the market is invisible at night". It
was a wall — PROCESS.md rule 4, *print both positions, distance not vibes*.

Three harness faults, each of which cost a full run and is worth writing down:

1. **Vite reloads the page when any file in the repo changes.** Other agents are
   editing concurrently and every save destroyed the execution context
   mid-capture; four runs were lost that way. Fix: serve a `vite preview` build.
   The harness warns that preview is stale and wrong — the answer is to build
   immediately before serving, not to never use it.
2. **`locator('canvas').screenshot()` and `page.screenshot()` never settle** on a
   WebGPU canvas that presents every frame. Both time out after "fonts loaded".
   Fix: `Page.captureScreenshot` over CDP, which grabs whatever is in the
   framebuffer right now.
3. **`H` does not hide the conductor panel in headless**, and it covers the left
   two thirds of the viewport. Fix: hide every top-level sibling of the canvas.

**Staleness caveat:** these come from a build made during this session. Other
agents committed `renderer.ts` and `cascade.ts` afterwards. Re-shoot before
treating them as a picture of HEAD.

### `day-down.png` — the market reads as a market

This is the frame the work was for. Eye height (2.6 m), on the centreline,
looking down the spine:

- **Stall rows on both kerbs**, receding to a vanishing point, with a readable
  pitched roof line and a dark underside. The silhouette is there.
- **Counters with crate stacks**, clearly yellow/tan, under the canopies on both
  sides. They read as goods on tables rather than as boxes.
- **Three distinct lantern cords** at roughly y=120-200, 250-310 and 340-380,
  each with hanging lanterns, and the near cord's catenary is legible as a curve.
  Counting the points across all three: **well over ten**. That is §B's bar for
  section C — "more than 10 small warm lamp points along successive galleries" —
  met.
- **A clear walking aisle** down the middle with the rows flanking it, which is
  the value grouping §F asks to preserve.
- **Warm stalls and cloth against cool blue-teal towers.** §A's supported
  relationship is present and it is the strongest thing in the frame.

### `night-down.png` — the lanterns glow; the ground pool does not

**The blocking-bug acceptance test: PASSED.** Distinct warm lamp points hanging
from three legible cords, the striped canopy edge catching gold on the right at
y≈390-440, pale crate faces lit under it, an amber pennant high on the near cord
at x≈1420, cool blue towers behind. Small warm points against cool surroundings,
exactly the relationship §A supports. `bd3d718` is confirmed working on this
grammar's geometry.

**But there is no pool on the street anywhere in the frame.** The bottom 40% is
flat dark blue-grey with no warm falloff on it. TASK 3's entire output — the
pool arithmetic, the Bresenham spread so the budget is not truncated at one end
of the chunk, 4.5 lit lanterns per cord, 48 lights per chunk — **is not
visible, because `groundbake.ts` still ends the market block with `void lights;`
and throws every one of them away.** The lanterns glow as emissive geometry;
they cast nothing.

### What is wrong with it, honestly

1. **No people.** §A supports "people and edge structures breaking up the
   route". The app reports `crowd 2550` and none of them are in this aisle. The
   market reads as a shuttered market. This is the biggest gap in the frame and
   it is not a market-grammar problem: round 1 fixed where the crowd *walks*, and
   nobody has yet put any of them *there*. Placing the crowd on the market spine
   is unstarted work.
2. **The canopies are too dark by day.** They read as near-black plates in the
   mid-ground; only the foreground tarp shows its stripe and its gold. They are
   horizontal surfaces with the sun behind the canyon, so they receive almost no
   sun and almost no ambient. §F asks for geometry spent on "edges, thickness,
   posts, brackets and canopy silhouettes" — the silhouette reads; the posts do
   not.
3. **The signs do not meet the bar.** §B counts "roughly 5-8 nearby projecting
   illuminated panels" in one view. I cannot count five in either street-level
   frame. The boards are present but small, and at this camera height they sit
   nearly edge-on.
4. **Hanging cloth reads as dark rectangles, not pennants.** Visible on the near
   cord but unremarkable; the taper does not survive at this distance.
5. **A stray linear element crosses the carriageway** in both `day-down` and
   `night-down` — dark red/maroon, thin, straight, running diagonally across the
   road at y≈500-560. **I have not identified it.** It is not obviously mine: my
   sign arms and guy lines use `tint(pal.metal, 0.7)`, not red. It needs a probe
   before anyone claims it either way.
6. **The carriageway is a large flat grey plane** occupying the bottom 40% of the
   day frame. §E names exactly this as the project's principal gap — "the lowest
   few metres and the walking surface". §C lists "market mats, loose boards,
   crates, rubbish, drainage, spilled goods or wet pavement" as unestablished, so
   nothing here is specified, but it is the gap that is specified.
7. **The yellow is very saturated.** `market-spine`'s `trim` is `#d8a03c` and my
   cloth takes it directly. Against the references' more muted amber ribbons
   (§A, C04) this may read as too primary. That is a judgement call for the
   vision reviewer, not for me.

### Net judgement

By day the grammar works and the street-level frame is materially better than an
empty road. By night the emissive fix is confirmed working on this geometry and
the lamps read; the market is not lit. **The single thing standing between the
current state and a lit night market is one loop in a file I do not own.**
Until that is done the honest description of this work is: measured,
daylight-readable, and not yet lit at night.

---

## 8. What I did not get to

1. **No vision-agent review has closed this work.** `docs/DESIGN.md` §6 and
   PROCESS.md rule 9 require a second agent to open the reference and the output
   and return `done` or `more work needed`. The frames in §7 were shot by me and
   judged by me, which is the thing PROCESS.md rule 9 calls out as the failure
   this project has already paid for once. **This needs a reviewer.**

2. **Nobody is in the market.** The street-level frames show an empty aisle
   while the app reports `crowd 2550`. §A's supported relationship is "warm
   pedestrian light against cool violet/blue surroundings, **with people and
   edge structures breaking up the route**" — the people are half the sentence
   and they are absent. Round 1 made the crowd *walk toward* the market; nothing
   puts any of them *in* it. `rebuildSlices` seeds agents in a view-space disc
   around the camera and `snapToStreet` puts them on the nearest carriageway,
   which on the spine is the carriageway, not the stall row. Nothing I own seeds
   a dense crowd into the footway behind the stall line. This is the largest
   single gap in the frames and it is unstarted.

3. **The `PROP_TRIS` table in `src/world/__selftest.ts` is still wrong** and I did
   not fix it. `pushProp` is not exported, so I could not measure it, and
   PROCESS.md rule 1 forbids closing that by reading the code. Fixing it needs
   either a one-line `export` on `pushProp` or a synthetic single-prop chunk.
   The performance agent separately reports that its triangle line understates by
   roughly 11×, which suggests this table is load-bearing and wrong.

4. **The clustered market lights are still not wired.** `GroundBakeCtx` has no
   light sink, and `groundbake.ts` still ends the market block with a bare
   `bakeMarketDetail(bld, ctx);`. The 591 harvested market lights are computed,
   capped, evenly spread — and then dropped. One loop fixes it:

   ```ts
   import { marketGrammarFor } from '../world/marketgrammar';
   ...
   bakeMarketDetail(bld, ctx);
   for (const l of marketGrammarFor(ctx).lights) lights.push(l);
   ```

   `MarketLight` is structurally identical to `GroundLight`, so no cast.
   Recomputing is safe: the grammar forks its own RNG per element off
   `(seed, cx, cz)`, so the second call provably returns the same list.

5. **LOD 1 is unreachable.** `groundbake.ts` gates the market on `lod < 1`, so
   my lod-1 branch (canopy silhouette, no crates, no rigging, no vents) only ever
   runs inside the self-test. It is implemented and measured; it needs the gate
   widened to `lod < 2` to matter.

6. **No market pose in the harness.** `tools/capture.mjs` has no frame that
   looks at the market spine — its bearing at the app's seed is 5.016 rad and the
   nearest pose, `03-tram-level`, looks along (0.15, −0.99). I did not add one,
   because that file belongs to another agent mid-session (F2/F6). I computed the
   poses from live state instead. **A `market-spine` pose should land** so this
   is reproducible rather than a throwaway script.

7. **No steam plume.** Deliberate. There is no particle system in this project
   and a weather field with no consumer is the documented failure mode
   (`docs/COVERAGE.md` PHANTOM rows). What exists is a lit firebox under a grille
   on every seventh stall, and the vent mouth is where a plume would attach.

---

## 9. Contradictions between code and documents

1. **`src/render/groundbake.ts` — `void lights;`.** The `lights` array is in
   scope at the `bakeMarketDetail` call site and is then explicitly discarded.
   Every clustered light the ground bake harvests, and every one the market
   grammar asks for, is dropped there.

2. **`src/render/groundbake.ts` — the market is gated on `lod < 1`**, which
   makes the lod-1 branch of my contract unreachable (§8.4).

3. **`src/world/__selftest.ts` — `PROP_TRIS` is wrong.** `PropKind.Planter` is
   declared 12 triangles; reading `pushProp` it emits a box plus a per-planter
   scatter of cylinders and spheres. `PropKind.Railing` is declared 6. This is a
   *reading*, not a measurement — see §8.2 for why I did not act on it.

4. **`src/world/__selftest.ts` prints an impossible pair.** Round 1 it reported
   `chunk overhang 6239 vertices, of which 4328 on raised/kerb surfaces`; after
   my change, `449 vertices, of which 618 on raised/kerb surfaces`. The second
   number is larger than the first, so the two counts are computed over different
   sets.

5. **`docs/STREET_SPEC.md` vs `src/world/districts.ts:161`.** The district
   description still reads "The night-market street. Awnings, steam, signage
   hung off brackets into the road." Awnings and signage are now real; **steam is
   not**, and the stall counter, merchandise and ground covering the spec lists as
   unestablished are all invented. The description should say so.

6. **`docs/COVERAGE.md` does not yet list the market grammar at all**, which
   makes an existing, measured, non-phantom subsystem look absent. It needs a row
   marked DESIGN HYPOTHESIS against `docs/STREET_SPEC.md` §C.

7. **Flagged, not fixed (developer 1 owns `renderer.ts`; this needs a vision
   judgement):** the shadow camera is not looking at the sun — measured 65.7°
   off in cascade 0 and 114.3° in cascades 1–3. `m4lookAt` derives its z axis
   from `eye - centre`, and the eye is offset along the cross product
   perpendicular to the sun, so the depth axis is sideways to the light. One-line
   fix (offset the eye along the sun direction), but it changes every shadow in
   the project.
