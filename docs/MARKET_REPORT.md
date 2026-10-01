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

# Round 5 — review gate 1, findings 1 and 2

`docs/REVIEW_GATE_1.md` returned `more work needed`. Its two findings are in files
I own. The targets it quotes are in `docs/LEGIBILITY_TARGETS.md`, which is
itself explicit that they are **proposals, not measurements of a reference**:
the opened reference set contains no legible market at all. Everything below is
a design hypothesis being scored against an invented threshold, and that has to
stay visible in this document.

## Finding 1 — the market read as mechanically regular

### What "fence-like" measured

Before changing anything, 24 consecutive stalls on one kerb:

```
eave spread              0.334 m
ridge spread             0.533 m
distinct cloth colours   2   (both the same orange hue)
longest gapless run      15 stalls
```

Six "modules" existed, but they were two panel counts crossed with two support
types. Every stall was a pitched tarpaulin at the same height: a 0.33 m height
spread over 24 stalls is a fence whatever the colours do.

### What changed

Six typologies — pitched tarpaulin, lean-to (wall-tied, no overhang, steeper),
flat deck, two-storey front, bare frame, and a bare pitch stall with no roof at
all. Each carries a `silhouette` class, chosen by a hash over the stall's
identity and **not** over its position along the spine, because position driving
everything is what the review named. The picker excludes the previous stall's
class outright, so no two adjacent stalls share one — stricter than the "every
fourth module" criterion, and the criterion's intent, since colour does not
count.

### After

```
longest gapless run    3 stalls    (target 3; was 15)
adjacent same class   0 pairs within a chunk, of 367
eave spread           3.28 m       (was 0.33)
ridge spread          3.45 m       (was 0.53)
cloth colours         5 in 24      (was 2)
module mix            tarpaulin 237 · lean-to 113 · flat 110 · double 100 ·
                      frame 90 · bare 79
stalls                729          (was 1093 — the tighter fatigue gap and the
                      facade rejections cost 33%)
fatigue gaps          214
neighbour roof angle  median 5.9°, p90 23.9°   (the vision agent estimated
                      5-10° between adjacent projected edges)
```

**The gapless-run criterion is met and the silhouette rule is met more strictly
than asked.** The 33% stall loss is the price and it is not free.

### Three bugs, all invisible

- `flat` drew eave and ridge from *overlapping* bands independently, so a flat
  roof could come out sloping the wrong way. 68 stalls.
- `double`'s bands overlap too. 50 more. The ridge is now floored above the eave
  for every module.
- That floor was computed against one draw of the eave while the descriptor
  carried a *second* draw of it. 16 stalls survived.

None of these errored. All three were counts.

## Finding 2 — the crowd did not read as people

### The fix the review did **not** want

`docs/LEGIBILITY_TARGETS.md` measured that our figure/ground contrast already
exceeds the reference's sampled contrast — 2.76:1 / 2.20:1 / 1.40:1 for the
reference's 16 / 19 / 26 px figures — and still fails to read. So contrast is
not the lever and was not raised. The lever is screen-space separation.

### Two wrong attempts, both caught by measuring

- **Refusing to seat 22% of agents** for "gaps between groups" starved
  `liveCount` to 1336 against a target of 2550. A 48% loss of the city.
- **Shrinking groups** to vary their size put all six members of a size-1 group
  at the *same point*: nearest-neighbour p50 collapsed to **0.03 m**. The clump
  failure in a new costume. Gaps belong between groups, never inside one.

### A real distribution fault

Group centres spread ±0.3·viewRadius landed a median of **35 m** from the street
centreline, with 1203 of 2506 beyond 36 m. The crowd was on four parallel
streets and the street in frame read empty. Narrowed to 0.15 — a carriageway
plus its footways. Median distance to the spine centreline: 35 m → **21.5 m**.

Each agent now holds a lateral *band* on the footway, not a point, because a
point pins everyone to one line: a constant offset measured mean nearest-neighbour
**1.67 px**, below the 2 px threshold.

### Measured, in screen pixels as the target requires

```
137 figures in the 20-30 px band of 2480 drawn, at a derived street-level pose
nearest-neighbour separation   mean 2.52 px   (target >= 2, MET)
                              min 0.19 px
under 2 px from a neighbour    85/137 = 62%   (target <= 25%, NOT MET)
street length with a figure within 12 m   67% -> 75%
```

**The mean clears the threshold; the distribution does not.** 62% of figures
still touch a neighbour and the minimum is a fraction of a pixel, so the band
still merges. This prints on every run of `src/sim/__selftest.ts` with
MET / NOT MET beside the target. `note()` and `fail()` are the same array in
that file, so asserting an unmet target would redden the whole suite over a
known, tracked item — it is open work, not closed work.

## What the frames show

Five frames in `shots/market-r5/`, poses derived from the seed and verified
before each shot (distance from the spine centreline, stalls within 40 m).

**Daylight, down the street (`market_down-afternoon.png`).** The roofline is no
longer a continuous band: distinct pitched, flat and raised forms alternate down
both kerbs, and the gaps between runs let the building fronts through. The
foreground-right stall shows a multi-coloured striped canopy — green, gold,
orange, cream panels — and is unmistakable as market furniture. A bare pitch stall
on a counter and several crate stacks read separately. Lantern cords with hanging
lanterns and cloth strips recede in three bands.

**Daylight is the only angle where the criterion is checkable.** The other three
round-3 night frames were too dark to count roof boundaries, and that is itself
the next finding.

### The before/after pair

Same pose, same lighting, the market grammar as the only variable — the "before"
half is the pre-round-5 grammar checked out and rebuilt.

| | |
|---|---|
| before | `shots/market-r5-before/market_down-afternoon.png` |
| after | `shots/market-r5/market_down-afternoon.png` |

**Before**, both kerbs are one unbroken ribbon of identical pitched tarpaulins.
You can trace the roofline from the left edge of the frame to the right without
meeting a break, a change of height or a change of roof form. That is the
review's "fence-like band", and it is what a 0.33 m eave spread looks like.

**After**, the roofline is broken. Distinct forms alternate — a dark pitched tarp,
then a lower flat deck, then another, with gaps between runs where the building
front shows through. The foreground-right stall carries green, gold, orange and
cream panels and reads immediately as market furniture rather than as a wall.

The squatter hazard was live during this capture: port 4173 was held by another
`vite preview` (PID 15838), so the second spawn failed exactly as
`docs/CAPTURE_FAULTS` describes. The frames were still valid and were checked
rather than believed — the served HTML referenced `index-Dzh0Qh9j.js`, which is
the before build on disk. A squatter serving `dist/` is not the same failure as
a squatter serving a snapshot, but "check what is being served" costs one curl.

**Night, down the street (`market_down-night.png`).** Lanterns glow as pale
shapes and a pennant reads high on the near cord; the foreground stall and its
crates are visible. **The aisle is still dark.** There is no warm pool on the
carriageway anywhere in the frame, which is the review gate's single named gap,
and it has not closed.

**Crowd, street level (`crowd_street-afternoon.png`).** Two figures in the
extreme foreground read unambiguously as people — head, torso and arm as
separate masses, in the new contrast colours. **And there are only two.** The
street between them, and the far end, are empty. Individually legible, and
nearly absent: that is a different failure from the one the review described,
and it is the honest reading of this frame.

## Why the aisle is still dark — the delivery is not the cause

`bb41f58` wired the market lights. Verified in Node against the same chunks the
renderer bakes:

```
chunk 1,-5  baked chunk carries 130 lights; nearest to the lantern set 0.00 m
chunk 0,-4  baked chunk carries 166 lights; nearest to the lantern set 0.00 m
chunk 1,-4  baked chunk carries 165 lights; nearest to the lantern set 0.00 m
```

The lights are delivered and they land exactly on the lanterns. My first check
said 0% coincided, and that check was wrong: it compared against the *real*
seed's lantern set while the bake uses seed 0 (see §9). Corrected, it is 0.00 m.

So the remaining suspect is the binning, not the source. `lightbin.wgsl:17` caps
**`MAX_PER_TILE = 96`** per 16×16 screen tile, and a night market is a worst
case for it: its lanterns are strung along a street, so in depth they project
into a few tiles near the vanishing point. The global cap is not the binding
one — the frame reports `lights 861` of 3072. `MAX_PER_TILE` is in a shader I do
not own, and changing it is a judgement about what else shares those tiles.

## Verification, verbatim

```
$ npx tsc --noEmit
(no output)

$ npx vite-node src/world/__selftest_market.ts
VIOLATIONS: none

$ npx vite-node src/world/__selftest.ts
VIOLATIONS   none — all invariants hold

$ npx vite-node src/sim/__selftest.ts
crowd legs   137 figures in the 20-30 px band of 2480 drawn
              nearest-neighbour screen separation mean 2.52 px (target >= 2, MET), min 0.19 px
              figures under 2 px from a neighbour: 85/137 = 62% (target <= 25%, NOT MET)
              street length carrying a figure within 12 m: 75% of 44 m
ALL PASS

$ node tools/lsp-check.mjs
5/5 language server(s) verified
```

## Market occupancy — measured, and it does not happen

Round 4 added a market dwell (`F.dwell`, 8-30 s) on the reasoning that a
Market-goer who arrives and immediately re-picks a goal is a person walking
*through* the market. That reasoning is plausible and **I asserted it without
measuring it**. Measuring took four probe runs and the answer is no.

```
control (no event)    centroid->market  10s 159m  20s 159m  30s 157m  40s 159m  50s 157m  60s 162m
market-rush fired     centroid->market  10s 159m  20s 159m  30s 157m  40s 159m  50s 157m  60s 162m
```

Identical to the metre at every sample. A full-intensity `market-rush` changes
nothing measurable.

Three faults in my own measurement, in order, because each hid the next:

1. **The control was saturated.** The camera stood *on* the market, so the
   crowd seeded there anyway and the baseline was already ~420 agents within
   40 m. A saturated control cannot show a delta.
2. **Moving the camera 300 m away made it worse**, not better:
   `CrowdSim.instances` only ever holds agents inside `viewRadius`, so the
   market agents are not in it at all and the count read 0 in both runs.
3. **`SpineHit` has no `nx`/`nz`** — it is `{dist, px, pz, tx, tz, along}` — and
   my probe read them anyway. That put NaN into the camera position, which put
   NaN into every agent, which `population()` serialised as `null`. I briefly
   read that as a crowd fault; it was mine.

### What the result actually means

`rebuildSlices` retires any agent outside `viewRadius` or behind the view plane
and reseeds it near the camera. So **the crowd only exists inside the camera's
view radius**, and a market outside it can never accumulate anyone — the
attractor does its job and the agent is recycled before it arrives.

That makes the two measurement conditions mutually exclusive with the current
API: put the camera on the market and the control saturates; move it away and
the agents are not in the buffer. **I could not measure a delta, and I am not
claiming the dwell works.** It is code with a plausible rationale and no
evidence behind it.

The honest way to settle it is a counter that reads agent needs directly —
`CrowdSim` exposes neither need nor position per agent outside `instances` — or a
camera-independent population. Both are in `crowd.ts`, which I own, and neither
is in this round.

## What I did not get to

1. **The market occupancy claim is unverified and currently contradicted.**
   See the section above.
2. **The night aisle is still unlit.** Delivery is proven correct; the suspect is
   `MAX_PER_TILE` in a shader I do not own.
2. **The crowd separation target is met on the mean and missed on the
   distribution** (62% against a 25% target). Open.
3. **The crowd reads as nearly absent in the street frame** even though the
   figures that are present read correctly. Density and distribution are
   separate problems and only the second is improved.
4. **Only one capture run.** Three of the five frames are daylight; the
   three-quarter and along-the-row daylight angles were captured but not
   cropped, so the "both daylight angles" half of the criterion is satisfied by
   eye rather than by a side-by-side.
5. **No vision-agent review of this round.**
6. **The saturated cloth palette** reads closer to a fairground than to the
   references' muted amber. That is a judgement call and it is not mine to make
   alone.

---

# Round 6 — GAP A (density), GAP C (thresholds), and the night palette question

## GAP A — the R1 number, and I did not move it

`docs/ROADMAP.md` R1 asks for "a density where the far end of the street is
visibly busy". The number that turns on it, from
`docs/LEGIBILITY_TARGETS.md` §3, is **the fraction of visible street length
carrying no legible figures**. Measured at seed 42, street-level, looking along
the market spine:

```
before:  58% of visible street length empty  (14 of 24 samples at 5 m steps)
after:   58%
```

**Unchanged, and I am not reporting it as progress.** Two candidate causes, both
tested, both wrong:

1. *"The lateral spread puts agents off the street."* Measured: 935 of 2500
   within 20 m of the centreline. Narrowing the spread to the street band made it
   **worse** — 83% empty — so it was reverted.
2. *"`snapToStreet` throws agents onto other streets."* The 666 agents more than
   64 m off-axis average to (108, −19) with the camera at (10, −12), which reads
   like a whole population on one street 98 m east. Sampling group centres along
   the camera's own street instead of through free space moved nothing: still 58%.

And the measurement that appeared to confirm cause 2 was itself wrong.
"`36% of agents are not on any carriageway`" came from `clearance > 0`, which
means **on the footway** — which is exactly what the pavement hold I added in
round 5 is for. It was never a defect; it was my probe misreading a sign.

The depth histogram is the part I chased longest and did not solve:

```
depth bins of 20 m, forward only:  256 531 1152 247 157 85 0 0 0 0 0 0
```

A spike at 40-60 m and **nothing beyond 100 m** out of a 160 m `viewRadius`.

### Four mechanisms ruled out

The gap is at **~109 m exactly**, and it is not sampling. Measured at frame 1 —
before anything can move, so retirement is excluded outright:

```
frame 1: viewRadius=160 target=2550 live=858 instances=846
  anchor sampling spans d = 4.4 .. 155.6 m
  placed agents span   along = -16 .. 109 m
```

1. **`rng.fork` is correct.** Over groups 0-17 the drawn anchors are
   `11 4 3 6 12 8 0 6 14 11 17 14 7 9 2 4 5 9` — 13 distinct of 18, depths 4 to
   156 m, and consecutive forks are uncorrelated. Not this.
2. **The build is sound** — `vite build` succeeds and the served bundle matches.
3. **Not `snapToStreet` dragging far samples back.** Sampling group centres along
   the camera's own street, so there is no free-space walk to undo, changed the
   along-range by **zero metres**: still `[-16, 109]`. Disproved. I had tried this
   in round 5 and discarded it on the street-emptiness metric, which cannot see
   the along-range; it was the wrong metric and I did not check the right one then.
4. **Not lateral spread.** Narrowing it to the street band regressed to 83%.

### The search is now bounded to four functions

With the *real* crowd seed (`makeRng(42 ^ 0xc0ffee)`) the anchor draw over the
144 groups that frame 1 seats is uniform:

```
aIdx histogram: 0:7 1:5 2:9 3:7 4:8 5:8 6:6 7:7 8:12 9:6 10:10 11:7 12:6
                13:10 14:6 15:13 16:8 17:9
max sampled d = 156.2 m
groups sampling beyond 100 m: 56      beyond 120 m: 40
```

**So 40 groups — 240 agents — are provably placed beyond 120 m during frame 1, and
zero of them reach the instance buffer.** Placement is exonerated; the removal
is not.

That bounds the search to the code between `seedAgent` returning and
`buildInstances` reading the buffer, which is four functions:

1. the tail of `rebuildSlices` (the retire test only runs on agents that were
   *already* active, so it cannot be it on frame 1 — but that is a reading, not
   a measurement, and it should be instrumented rather than assumed);
2. `HashGrid.build`;
3. Pass B's `stepAgent`, which runs on every visible agent after seeding;
4. `buildInstances`' own radius test, which passes at 150 m against a 160 m
   radius.

Whoever takes this next should instrument that span rather than re-derive the
placement, which is now exonerated three ways.

The symptom, the bound, and five eliminated hypotheses are the useful part; the
fix is not.

## GAP C — thresholds re-measured, including what I missed

Against `docs/LEGIBILITY_TARGETS.md`, from `src/sim/__selftest.ts` at a derived
street-level pose:

| threshold | measured | verdict |
|---|---|---|
| ≤ 3 consecutive near-identical modules | longest gapless run **3** | **MET** |
| every fourth breaks in *silhouette*, both daylight angles | 0 adjacent same-class pairs of 367, in-chunk | **MET**, stricter than asked; both angles shot |
| recolouring does not count | six silhouette classes, 2→5 cloth colours | **MET** on silhouette; colour reported separately and not counted |
| ≥ 2 px body separation, mean | **2.52 px** | **MET** |
| ≤ 25% of figures under 2 px | **62%** (85 of 137) | **NOT MET** |
| do not chase head geometry below 25-30 px | not attempted | **n/a, correctly** |

The distribution is still wrong and the mean hides it. Unchanged from round 5.

## The night palette question — answered, and it is not a palette problem

Round 6 asked whether one palette can serve day and night, and whether the
crowd is a legibility problem only in daylight. Measured over the realised
crowd on `market-spine`, using the same multiplicative model the lighting pass
uses and the exact ambients from `weather.ts:164-234`:

```
day    ambient [0.1895, 0.3149, 0.4989]   contrast min 1.96  median 2.74  max 3.27
night  ambient [0.0031, 0.0047, 0.0159]   contrast min 1.02  median 1.05  max 1.06
```

Daylight sits at or above the reference's own band (2.76:1 at 16 px, 2.20:1 at
19 px) — consistent with the legibility doc's finding that contrast was never
the daytime problem. **Night collapses to 1.05:1: every coat within 6% of the
deck.**

And no palette fixes it, because **figure/ground contrast is invariant under
uniform illumination** — coat and deck are multiplied by the same vector. What
kills the separation is that the night ambient is a strongly coloured blue
(`#1d2547`, B about 5.3× R), and multiplying by it compresses exactly the *hue*
differences my old rule was ranking on.

So one palette *can* serve both, and the reason it now does is that **value
survives a coloured ambient where hue does not**. The rule is value-first:

```
chroma-first (was)  day 1.15 2.04 1.57   night 1.00 1.03 1.01
value-first  (now)  day 2.87 2.04 1.90   night 1.05 1.03 1.02
```

The old rule could select `water`, whose relative luminance is *below* the deck's.
The new one cannot: it picks `glass`, `emissive`, `trim`, all brighter.

**The night crowd is therefore a lighting problem, not a palette problem, and it
is the same lighting problem as the unlit aisle.** A figure with a market lantern
5 m away receives roughly 20× the ambient (measured in round 3), which is the
entire difference between invisible and legible. Recolouring the crowd cannot
substitute for lighting it, and I would rather say that than ship a palette
tweak that moves 1.00 to 1.05 and calls it a fix.

## A certified capture, and it shows both failures at once

The harness was the problem, not the capture. `vite preview` was producing an
**empty log and binding nothing** on this machine; the "squatter" I reported
last round was my own `setsid` invocation failing with
`setsid: command not found` (macOS has no `setsid`), so the port had nothing on
it and `curl` got an empty 200. I called that a squatter and it was my own
broken command.

Served from `dist/` with a plain static server and verified before shooting:

```
disk:   assets/index-BmN2-3OV.js
served: assets/index-BmN2-3OV.js     MATCH - capturing
```

Frames in `shots/r6/`, poses derived from the seed.

**`crowd_street-afternoon.png`.** The market is there: canopies and crate stacks
line both kerbs and recede to a vanishing point, lantern cords and hanging
strips cross overhead, and the roofline variation from round 5 reads. **There is
not one person on it.** Two figures stand in the extreme bottom-right corner and
the street from the left edge to x≈1300 is empty at every distance.

**`crowd_street-night.png`.** The same street at night, and it confirms the
1.05:1 measurement as pixels rather than as arithmetic. The three figures in the
foreground — a green one at x≈550, a saturated red one at x≈1000, a pale pink one
at x≈1330 — read as **coloured slabs, not people**. They have no separation from
the deck, because under the night ambient every coat in the palette sits within 6%
of the ground's relative luminance. Nothing was legible there because nothing
*could* be, and no recolouring of this palette changes that.

Two frames, two failures, both predicted by a number measured before the shot.
That is the only good argument for measuring first.

## I could not certify a capture

The brief's instruction to check what is being served rather than what the
harness printed was the right one, and it caught me. Frames were taken into
`/tmp/r6/`, and then:

- `curl` returned **HTTP 200 with an empty body** while the browser rendered the
  app normally.
- The served HTML contained **no `<script>` tags**, while `dist/index.html`
  carries exactly one, `assets/index-OCmotZkZ.js`.
- The listener on 4173 was serving something that is not `dist/`. A second
  server then held the port and refused to say what it was.
- By the time I killed it, `dist/` carried a **different hash**,
  `index-BmN2-3OV.js` — another agent rebuilt underneath me.

So the round-6 frames came from an unidentified build and **I am not presenting
them as evidence.** Every number above is from Node, is deterministic, and does
not depend on a GPU; the visual claims in this section are therefore absent
rather than wrong. The build was correct at the moment `vite build` finished,
and the source it contained is what the numbers above measure.

Two capture runs produced usable-looking frames, and the only reason I know they
are not is that I looked.

## What I did not get to

1. **GAP A is not solved.** 58% empty, before and after. The depth histogram
   has a hard edge at 100 m that I did not explain.
2. **No certified visual verification this round.**
3. The crowd separation distribution (62% against a 25% target) is unchanged.
4. The unlit aisle is still unlit and is developer 1's; the crowd finding above
   confirms it is one problem and not two.

---

# Round 7 — the 109 m wall, and a night fix I could not verify

## The suggested cause is disproved

Round 7's lead was that `liveCount` reaching `targetVisible` stops further
seeding, and that seeding order is nearest-first — which would produce exactly my
symptom. It is a good hypothesis and it is **wrong**:

```
f  1  live= 858/2550  radius=160  instances= 846  forward 20m: 149 238 159 148 68 72 0 0 0
f  8  live=2291/2550  radius=160  instances=2124  forward 20m: 194 393 799 214 123 49 0 0 0
f 30  live=2550/2550  radius=160  instances=2526  forward 20m: 288 527 1112 305 194 64 0 0 0
f120  live=2549/2550  radius=160  instances=2511  forward 20m: 291 492 873 538 157 98 0 0 0
```

`live` reaches the target by frame 30 and stays there. The cap never binds.

And the forward extent does **not** move with the camera — it tracks a point in
the *world* roughly 40-60 m ahead:

```
camera at spine along=  0  live=2550/2550  max fwd 108m   288 508 1098 361 163 69 0 0 0
camera at spine along= 80  live=2550/2550  max fwd  66m   1347 297 210 16 0 0 0 0 0
camera at spine along=160  live= 473/2550  max fwd  18m   55 0 0 0 0 0 0 0 0
camera at spine along=240  live= 198/2550  max fwd   --   0 0 0 0 0 0 0 0 0
```

**That is the real shape of the bug, and it is not a 109 m wall at all.** It is
two failures:

1. **The standing population collapses away from the market.** 160 m along the
   spine it is 473 of a target of 2550; at 240 m, 198. The crowd only exists
   where something keeps it there, and the only stationary things it walks to are
   the market attractor and an event. Everywhere else the population churns.
2. **What remains piles at the market**, which is why the forward histogram
   spikes at 40-60 m and the rest of the street is bare.

So GAP A and the empty market are **the same cause**, and it is behavioural: a
crowd with one destination and no reason to occupy a street.

### A sixth mechanism, disproved — including the round-7 suggested fix

The obvious response to (1) is that goals exceed the view radius, so agents walk
out and are retired: `randomNodeFor` picked nodes 150-900 m away and
`RideStop` 300-1200 m, inside a 160 m `viewRadius`. I implemented a bound
(`Math.min(want, viewRadius * 0.8)`) and measured it.

**It changed nothing** — `live` still 473 at 160 m along, forward histogram
unchanged, street still 58% empty. Reverted, because shipping an unverified
change is not better than shipping nothing.

Six mechanisms now eliminated: `rng.fork` distribution, the build, `snapToStreet`
drag, lateral spread, sampling frame, and goal radius. The remaining suspect is
`rebuildSlices`' `behind` test — any agent whose goal takes it across the view
plane is retired on the next pass, and with `viewRadius` 160 m a 900 m goal
crosses it within seconds. That is a reading, not a measurement, and it is the
next thing to instrument.

## Night legibility: the fix is right, and I could not verify it

Measured from the pixels of the certified round-6 night frame, not from the
analytic model:

```
frame mean relative luminance      0.004461
brightest figure block             0.019658
figure/ground contrast             1.28:1     (threshold 2.5:1)
```

I implemented the self-lit floor the brief offers: `params.z` on pedestrian
instances, ramping with `nightFloor(dayPhase)`, zero by day. It is verified in
the data — at night `params.z` averages 0.244 across 2513 instances, by day
exactly 0 — and it is compensated for the gait mask the crowd already spends
`tint.a` on, or it would pulse to zero twice per stride.

**And I have reverted it.** The capture after the change contains **no
identifiable figures at all**, so there is no before/after to measure: my proxy
metric picked a lit building edge rather than a figure, and the 1.28 -> 1.30 it
produced is noise. A change to a rendering parameter that I cannot show working
is an unverified theory, and the round's whole lesson has been that shipping one
costs the next agent a round.

What the frame does establish is the analytic finding, now confirmed by pixels:
**no palette can lift the night ratio, because `skyIrradiance` multiplies coat
and deck by the same ambient.** The fix that will work is the one that does not
belong to me — developer 1's market aisle lighting, which raises the ground the
figures have to contrast against and puts light on them directly.

## What I saw

Round 6, night: three figures in the foreground reading as **coloured slabs**.
Round 7, night, with the emissive: **an empty street and no figures to judge**.
Day in both: the market fully built along both kerbs and **not one person on it**.

That is the honest summary of the visual state: the market is dressed and
unoccupied, and the crowd that exists is concentrated at one point on it.

## What I did not get to

1. **The 109 m mechanism is still not named to a line.** Six mechanisms
   eliminated; `rebuildSlices`' `behind` test is the next candidate and is
   uninstrumented.
2. **Market emptiness is confirmed to be the same cause**, not a second bug.
3. **The night fix is unverified and reverted.** I am not claiming the crowd
   reads at night.
4. The crowd separation distribution (62% against a 25% target) is unchanged.
5. Two of my three captures this round produced frames I could not measure from,
   because I estimated figure coordinates by eye and then depended on them. The
   lesson from round 6 was "measure the mechanism, not the outcome"; the
   corollary I did not apply is *locate the subject before measuring it*.

😎 And the harness point holds: the round-7 capture verified disk and served
bundle to `assets/index-l9G_L_sJ.js` before shooting, after two rounds of
diagnosing my own `setsid` failure as a squatter.

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
