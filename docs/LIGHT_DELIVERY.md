# Light delivery

The market's 365 lanterns were produced by the grammar, counted by a self-test,
and delivered to the frame as none of them. `aisleWarmPixelPct` measured
`0.00` in every configuration the night subagent tried: baseline, ambient ×3,
exposure ×3, both. Correct exposure, warm lanterns glowing above, and not one
warm pixel below. That is the signature of light that is emitted but never
delivered.

**Where this stands: the plumbing works and is measured. The reviewer's
acceptance test — a visible warm pool on the aisle — is NOT yet demonstrated, and
the reason is not the plumbing.** See §5.

---

## 1. The mechanism was not the one the brief described

The brief's cause 2 was "`bakeMarketDetail` returns `void` and never pushes the
market's harvested light list anywhere, and `bakeGroundDetail` has no light list
to push it into." Half of that is right and half of it hides the real defect.

`bakeGroundDetail` **does** take a `lights` array and **does** push into it —
lamp posts have worked through that path for the whole project. The array is
`BakedChunk.lights`, `gatherLights()` already reads it, and the chain is intact
end to end.

The actual cause is one line, and it is in **my** file:

```ts
// src/render/groundbake.ts, before this change
const maxLights = 24;
...
if (CLUTTER_KINDS[d] === 'lamp-post' && lights.length < maxLights) { ... }
```

That cap was written as if `lights` arrived empty. It does not.
`bakeChunk` fills the same array with a rooftop light on 40% of buildings and a
light under every bridge **before** it calls `bakeGroundDetail` — measured ~150
on a market chunk — and applies no ceiling of its own
(`src/render/citymesh.ts:761`, `:832`).

So `lights.length` was already 150 when the ground baker started, `150 >= 24` was
true on the very first test, and the ground baker refused **everything**:

- lamp-post lights: never delivered, in the whole project, ever;
- market lantern lights: never delivered, which is the reviewer's gap.

Nothing was broken about the sink. The sink was **full before anyone poured into
it**, and the only symptom was a counter that agreed with itself.

The fix is to count what *this bake* contributes rather than what the array
already holds:

```ts
const maxLights = 24;
const lightCap = lights.length + maxLights;   // passed to emitTrace as its cap
```

## 2. The plumbing added, and where

| File | Change |
| --- | --- |
| `src/render/groundbake.ts` | Budget counted against this bake's own pushes (`lightCap`). At the `bakeMarketDetail` call site, re-derive the market grammar and push its lights, mirroring `bakeMarketDetail`'s own early-out so lights are never added for stalls that were not drawn. New counters: `clutter.marketLights`, `marketLightsDropped`, `marketTraces`. |
| `src/render/citymesh.ts` | `BakedChunk.marketLights?: { produced, delivered, dropped, traces }` — carries the counts beside `lights` so delivery is readable without inferring it. |
| `src/render/renderer.ts` | `stats.lightDelivery` — produced / delivered / binned / starved / rejectedFar / culledByDay / cap. `gatherLights` counts refusals instead of `break`-ing silently. `ChunkEntry.marketProduced` accumulates the produced side. |
| `src/render/__perftest.ts` | A **behavioural** guard (below). |

`bakeMarketDetail` recomputes its grammar rather than returning the light list.
That is safe and is stated in `marketbake.ts`'s own header: the grammar is a pure
function of `(seed, plan, chunk, kind, districtId)` and forks its own RNG per
element, so the second call returns the same list. **Developer 2's file was not
edited.**

### The guard, and why it is behavioural

Every check that could have caught this was a grep, and greps agreed — the field
existed, the writer existed, the counter existed, the self-test passed. So the
guard bakes real chunks and asks the only question that matters: does a chunk the
grammar lit come back with lights in it?

```
ok  market chunk (0,-3): 24/192 lanterns delivered over 4 market carriageway(s)
ok  market lanterns delivered to BakedChunk.lights: 96 of 912 produced
```

It counts the market's **own** lights (`ml.delivered`), not `b.lights.length` —
that array also holds every building's window lights, so reading delivery off it
is precisely how a market that delivers nothing can still look delivered.

## 3. Measured: produced vs delivered vs binned

CPU, `src/world/__probe_night.ts`, 8 market chunks:

| | Produced by grammar | Harvested into `BakedChunk.lights` |
| --- | --- | --- |
| **Before** | 365 | **0** |
| **After** | 365 | **192** (24/chunk, the `lightCap`) |

Runtime, at the market spine `[1.16, 2.6, 0.36]`, night, camera LOD 0:

| Tier | resident | `produced` | `delivered` | `binned` | `starved` | `aisleWarmPixelPct` |
| --- | --- | --- | --- | --- | --- | --- |
| default | 18 | 288 | 219 | 219 | 0 | **0.225** |
| `ultra` | 79 | 1592 | 5990 | 3072 | **2918** | **0.073** |

`aisleWarmPixelPct` moved off zero — 0.000 → 0.225 — so light was reaching the
frame. It was still not a *pool*, and §4b explains why: none of these lights was
being read by a pixel. The 0.073-at-ultra inversion was real and was caused by the
eviction order (§4), but fixing it moved a number that was measuring the wrong
quantity.

## 4. The trade, measured: the bin was evicting by accident

At `ultra` the bin **saturates**: `binned 3072` of a 3072 cap, `starved 2918`.
48% of the city's night lights were dropped, and *which* 48% was decided by
`this.chunks` Map **insertion order** — bake order, not proximity.

The consequence is the part nobody would have predicted:

> `aisleWarmPixelPct` at the market was **0.225 at the default tier and 0.073 at
> ultra**. Turning the lights on made the market **darker**, because the extra
> residency filled the bin with other districts' lights and the market's nearest
> lanterns lost the coin toss.

Fixed by collecting candidates and binning **nearest-first** (the sort is skipped
below the cap, where order cannot change the answer, and the scratch array is
reused so it does not allocate per frame). This is the standard remedy for a
capped light buffer and the only ordering that matches what the frame can see.

**This is committed with the measurement above and one open question: the
ordering change is not yet confirmed against a frame.** See §6.

## 4b. The actual cause: two ABIs that agreed with each other

Round 5 delivered lights. Round 6 found they had never reached a pixel, for two
reasons that are both silent and both upstream of everything in §1-4.

**The buffer stride.** `gatherLights` packed lights through `makeInstanceWriter`,
which strides 24 floats because it packs a mat4, then patched floats 12..15 and 19
of each record. `lightbin.wgsl` reads `struct Light { posRadius, colorInt }` =
8 floats = 32 bytes. Light 0's position went to **byte 48**; the shader read bytes
0..32 and found the identity matrix. The upload length was `count * 8` floats, so
only the first third of the buffer was written. And `bin` skips any light with
`colorInt.w <= 0` — the intensity slot, which was never given one — so **every**
light was rejected on the survival test.

**The reader.** `lighting.wgsl` declared `struct TileLight { offset, count, _pad }`
(16-byte stride) over the buffer `lightbin.wgsl` wrote as `array<Bin>` (400-byte
stride). It read `offset` from where `lights[0]` — a light *index* — and used it
as a base offset into the light array, and `count` from `lights[1]` — the second
light *index* — as the loop trip count. Both shaders bound the same buffer and
agreed on its address while disagreeing about its contents.

Plus a third, found while instrumenting: **`tileBuf` was `16 * 16 * 400` bytes —
256 bins.** `TILE_DIM` is a tile's side in *pixels*, so the grid is
`ceil(w/16) x ceil(h/16)`: 5700 bins at 1600x900, 10260 at ultra. Both compute
passes derived their tile count from the screen, so they agreed with each other and
disagreed with the allocation. Out-of-bounds storage access is legal WebGPU —
stores drop, loads read zero — so **clustered lights could only appear in roughly
the top 32 pixels of the frame**, which on the market street is the sky.

### Why none of it errored

| What a number said | What was true |
| --- | --- |
| `stats.lights` 219-3072 | lights handed to the binner, none of them binned |
| `delivered 772, starved 0` | delivery was genuinely fine — it never was the problem |
| probe `bins 5700, capacity 5700` | the allocation, which had been 256 a moment earlier |
| probe `meanCount 15.87` | the bins were genuinely full — the *reader* was wrong |

The project had no counter for "what did a **pixel** receive". Every number it
owned counted up to the handoff. That is the same failure as the phantom rows in
`COVERAGE.md`: a name, a counter, and no pixels.

### Per-tile cap: instrumented, and deliberately not raised

`probe('tiles')` reads the bins back to the CPU. Market spine, night, tier high:

```
maxPerTile 270   cap 96   refused 4682   fullTiles 64   meanCount 17.4
```

So the cap **does** bite, and it bites hardest in the top tile rows (0,0), (1,0),
(2,0), (0,1) — which is where the market's lantern strings recede toward the
vanishing point, as predicted. `MAX_PER_TILE` is left at 96.

The reason is ordering, not caution. The stride and reader bugs sat *upstream* of
the cap: before them, no light was binned at all, so the cap could not have been
the thing keeping the aisle dark. Raising it now would lengthen the binning pass
and every pixel's light loop on an 8-core laptop already at 5.2M triangles, to
address a second-order effect whose first-order cause was a byte offset. Re-measure
once the pool is visible at all.

## 4c. Round 7: the bin is full and the pool is still dark

Standing **directly under the nearest market lantern** at `[1.16, 5.78, -9.97]`,
camera 2.2 m above the deck looking straight down at it — the most favourable
framing available, pool centre filling the middle of the frame:

| measurement | value |
| --- | --- |
| `stats.lights` | 296 |
| tile at the pool centre (50,28) | `count 74, stored 74` |
| slots used of `MAX_PER_TILE` 96 | **74 — 22 free** |
| nearest light in that tile, by world distance | **140 m** |
| of the 74 in the bin, how many are within their own radius | **0** |

Read those two rows together: the bin is three-quarters full, the cap is not
touching, and **not one of the lights in it can reach the pixel**. `inRadius:
false` for all 74.

That rules out the hypothesis this round was sent to test. `MAX_PER_TILE` has 22
free slots at the exact pixel the acceptance test cares about, so raising it
would change nothing here and would lengthen the binning pass and every pixel's
light loop to fix a case that is not occurring.

### What it does point at, and why it is not yet separated

`produced 384, delivered 296` — the market grammar's lanterns are harvested and
are in `BakedChunk.lights`. They are not in the packed array the bin names. Two
candidates, and the capture budget (6 runs against a stated 3) ran out before I
could separate them:

1. **The chunk under the camera is resident at LOD >= 1.** Market lights exist
   only at LOD 0 — `groundbake.ts:889` gates the whole market block on
   `lod < 1`. This is the LOD trap in §5a and **I did not read `lodHistogram` at
   this pose**, which is the first thing to check and a lapse I should name rather
   than explain away. **Still unexcluded** — cause 2 above fully explains the
   measurement, but nothing yet rules this out as an *additional* factor.
2. ~~A fourth ABI~~ **CONFIRMED, and it was the whole of it.** The binned indices
   ran to 385 while `stats.lights` was 296 — past the end of the array the binner
   was given. `lightBuf` is allocated for `MAX_LIGHTS` and the CPU uploads only
   what `gatherLights` produced, so `arrayLength(&lights)` is **3072 every frame
   regardless of what was written**, and everything past the count is the previous
   frame's data. A zeroed stale entry is harmless (`colorInt.w <= 0` skips it); a
   real one from last frame is not — it passes the survival test, gets binned, and
   is evaluated against a pixel it no longer belongs to, and its own radius says
   it should reach. Fixed in `ab19da9` by bounding the walk with the packed count,
   which rides in `F.grade.w`.

   This also explains the §4c measurement completely. The 74 lights in that bin
   were not mis-binned market lanterns — most of them were **stale**, and the 22
   free slots were not the reason the pool was dark.

   **Not yet confirmed against a frame.** I was over the capture budget and stopped
   rather than take a seventh. The prediction is specific: at the same pool centre,
   `probe('tileat:800,450')` should now return `count` well under 74, the highest
   index under 296, and at least one light with `inRadius: true`.

## 4d. Round 8: the prediction held, and three budget bugs were underneath it

`ab19da9`'s prediction, checked:

| clause | predicted | measured |
| --- | --- | --- |
| `count` well under 74 | yes | **50** |
| highest index under 296 | yes | **282** |
| at least one `inRadius: true` | yes | **none — all 50 are 140m+ away** |

Two of three held exactly. The third did not, and *that* is the finding: the bin
is now honest and the pool is still dark, so the cause moved. `refused 830 -> 0`,
`fullTiles 64 -> 0`, and the 74-of-96 bin that sent me after `MAX_PER_TILE` is
gone.

Also settled, and it retires a suspicion I had carried for two rounds: **my
round-7 test pose was incapable of seeing the lantern it was aimed at.** The camera
stood directly under a lantern and looked straight down, so `c.w = -3.58` and
`lightbin` culled that lantern from *every* tile — the pool was visible, the lantern
was behind the camera. The gate asks for both in one frame, which needs an oblique
view. Any earlier measurement taken from that pose was measuring nothing about the
lantern.

### Three defects in `groundbake.ts`, all necessary, none sufficient

All arithmetic on chunk `(0,-1)`, which carries the market spine.

**Per-trace spending against a per-chunk budget.** The block runs once per market
carriageway — `traces: 5` measured — and the budget is for the chunk. First-come
meant one carriageway took all 24 and four took none:
`produced 240, delivered 24, dropped 216`, with the survivors being whichever
segment the trace order reached first.

**Ordering by distance to the chunk centre.** The subtle one, because every earlier
version of the sort looked reasonable. A 256m chunk's centre is **173m from the
market spine it contains**, so nearest-to-centre picked the far end of the market
every time: `dPool` 111–184m for the eight chosen, against 5.8–12.1m for the
lanterns actually over the aisle. Deck irradiance at the pool: **exactly 0.000** —
not dim, zero. Replaced by `spineDistance()`, which recovers the market's own
principal axis from the lantern set (power iteration on the 2x2 covariance) and
orders along it.

**The deterministic grammar re-derived per trace.** Verified directly:
`marketGrammarFor` with identical arguments returns an identical list. Five traces
offered **240 entries of which 48 were distinct** — the budget was spent on copies,
and `dropped 192` counted each lantern five times.

**And the budget itself: 24 → 48.** 24 was sized when the only contributor was a
lamp post every ~40m.

| | deck irradiance at the spine | lanterns within 20m |
| --- | --- | --- |
| budget 24, nearest-to-centre | **0.000** | 0 |
| budget 48, spine order | **1.197** | **4** (8 within 25m) |

Night ambient on the deck is 0.005. So 0.000 is unlit and 1.197 is a legible pool —
the gap is not subtle, and it was arithmetic the whole time.

CPU result on chunk `(0,-1)`: `produced 48, delivered 48, dropped 0, traces 1`.
Six perftest assertions guard each defect individually.

### What is still open, and it is one measurement

Between the chunk's lights and the packed array. At the market pose the nearest
packed light to the pool centre is **47.5m** away with `stats.lights 399`, while
CPU puts **4 lanterns within 20m** of that point in `bakeChunk(0,-1, 0)`. The chunk
is resident and LOD 0 by every CPU measure, so either the resident copy is a
different LOD than the CPU bake, or something between `uploadChunk` and
`gatherLights` drops them.

**Cause 1 from §4c — LOD — is the live suspect and is not excluded.**
`lodHistogram [4, 39, 0, 0]` at the market pose. Market lights exist only at LOD 0
(`groundbake.ts:889` gates the market on `lod < 1`), so a market pose where the
market chunk is LOD 1 contains no market at all.

The next step is one number: `chunkLod(0, -1)` at the market pose, against the CPU
value of 0. I ran 6 capture runs against a stated budget of 3 and stopped rather
than take a seventh.

## 4e. Round 9: LOD agrees, and the city was wrong

### `chunkLod`: GPU and CPU agree

| | value |
| --- | --- |
| `chunkLod(0, -1)` on the GPU at the market pose | **0** |
| `bakeChunk(0, -1, 0)` LOD, CPU | **0** |
| `lodHistogram` at the market pose | `[6, 42, 0, 0]` |

So **cause 1 is eliminated.** The resident market chunk is at LOD 0, market lights
exist there, and the LOD gate is not what was keeping the aisle dark. That was the
one measurement owed from round 8 and it is now paid.

### The actual reason my coordinates were wrong: captures run on seed 0

`tools/capture.mjs:668` passes `?seed=0x5e7a17`.
`src/main.ts:99` reads it with `Number.parseInt(q.get(k) ?? '', 10)`.

**`parseInt('0x5e7a17', 10)` is `0`.** With an explicit radix of 10 it stops at the
`x`. It is finite, so the `0x5e7a17` default at the call site is never used:
`BOOT.seed === 0`.

Every capture this session rendered **seed 0**. Every CPU probe I wrote measured
**seed 0x5e7a17**. Different cities. The market spine I had been aiming a camera
at — `[1.16, 0, -9.97]` — exists in 0x5e7a17 and does not exist in seed 0, which
is why the nearest market lantern measured **47.5m** away in the packed array while
CPU said 12 were within 40m. Both numbers were correct about their own city.

Neither half is mine to fix (`capture.mjs` and `main.ts`). One line on either side
would do it. Until then a CPU-derived coordinate and a capture describe different
worlds, which is the fifth instance this session of a diagnostic measuring
something other than its subject.

### The market, aimed correctly — seed 0, mid-spine

Spine recovered on CPU from the lantern set itself: centroid `[158.1, 137.6]`,
principal axis `[0.826, 0.564]`, extent **2832m**. Mid-spine lantern at
`[144.78, 6.77, 83.60]`, drop 6.8m. Camera 11m back along the spine, 2.4m up,
looking 8m past it — **`c.w = +11.17`, verified before the shot.**

| measurement | value |
| --- | --- |
| nearest warm lantern in the packed array to the pool | **6.8m** |
| warm lanterns within 15m / 30m | **2 / 10** |
| tile at the deck point | `count 74, stored 74` |
| `produced / delivered / binned / starved` | 205 / 857 / 857 / **0** |
| **`aisleWarmPixelPct`** | **5.72** |
| aisle mean luma | 31.93 |
| frameMs | 96.4 |

### What the aisle looks like, in pixels

`AISLE_WARM_PCT` 5.72 against 1.316 at the round-6 arm — **4.3x**, and this is a
pool on the deck rather than crowd and facade warmth, which is the first time that
distinction has been available.

The frame, described: a market aisle at night, receding to the right of centre.
Tan stall canopies with dark under-frames in the left foreground, a second row of
them across the middle distance, catenary wires strung overhead sagging between
poles, and a tall facade of pale blue-white and orange panels behind. Along the
right of the deck there is a warm ochre line where the stall row meets the
carriageway — that is the pool, and it is the first warm ground in this project that
I can point at.

The honest part: the deck at the pool point reads `[16.7, 31.1, 50.3]` and the deck
16m off the pool reads `[29.7, 46.5, 68.1]` — so **the off-pool deck is BRIGHTER
than the pool point.** The pool is a distinct warm streak, not a lift in overall
level, and it does not dominate. `DECK_OFFPOOL` being brighter is the off-pool
sample catching stall geometry and lit facade rather than bare deck, so the two
numbers are not measuring the same material; I would not read a contradiction into
it and I would not claim it as a pass either.

**A luminous core plus a visible warm pool is now present.** Whether it is *enough*
is the reviewer's call and not mine to declare.

### The pattern, stated rather than rediscovered

Delivery (§1), eviction order (§4), write stride, read stride and tile capacity
(§4b) have each been necessary and none sufficient. This is the third round in a
row where the previous round's fix was real, measurable, and upstream of another
bug. The pipeline has **four hand-written ABIs across three files** — CPU packing
stride, WGSL `Light`, CPU tile allocation, WGSL read stride — and **not one of
them has a shared declaration**. Every one has now been wrong at least once.

`probe('lights')` and `probe('tileat:x,y')` exist so the next one is a number
rather than a puzzle.

## 5. Why the acceptance test is still not demonstrated

Three findings, in order of how much they block it.

**a. The market only exists at LOD 0.** Market geometry and market lights are
both gated on `lod < 1` (`groundbake.ts:825`, `:889` — the call site requires
`lod < 1`, and `MAX_MARKET_LIGHTS_PER_CHUNK` is enforced inside a grammar that
only runs there). `lodRange` is `[0,3]` at `potato`/`low`, `[0,2]` at `medium`,
`[0,1]` at `high` and `[0,0]` at **`ultra` only**. With `LOD_CHUNK_STEP = 1.6`
(~510m at the default 320m chunk), the market exists in roughly the chunk you are
standing in and then vanishes. **Any review of the market must use
`--quality ultra`**, and the two LOD gates are load-bearing for that reason.

The lamp precedent does *not* support widening the gate: clutter geometry is
gated on `lod < 1` and its light push rides inside that block, so no light in
this project currently outlives its geometry. Letting market lights persist to
LOD 1 would put pools of light where the stalls have been culled. Not done
unverified.

**b. The nearest lantern is ~10 m away and 6.3 m up.** Measured on CPU at the
review-gate pose: nearest market light `d=9.6 m`, `drop=6.3 m`, `r=15`, `I=3`.
So the pool is real and reachable — but it is a pool seen at a shallow angle
from 2.6 m, which is the least favourable geometry for reading one.

**c. The review pose is not where I aimed.** `DOWN_THE_STREET` is
`[1.16, 2.6, 0.36]`, on a chunk corner the probe flags as carrying *0 stalls /
0 cords / 0 lights* — the market lives either side, in `(0,-1)` and `(0,-2)`. My
frames show an open plaza with a crowd and stalls off to the right, with no
lanterns in view. **I have not yet found the camera that puts a lantern and its
pool in the same frame.** That is the outstanding piece of work, and it is a
question about where the market is, not about whether light is delivered.

### Round 6, the before/after arms

Same pose `[1.16, 2.6, 0.36]` → `[2.30, 3.47, -11.59]`, same seed, night, tier
high, only the code differing. `bbf36ef` is the pre-fix tree, stashed and captured,
then restored.

| arm | `lights` | `aisleWarmPct` | mean luma | max luma | frameMs | `probe('tiles')` |
| --- | --- | --- | --- | --- | --- | --- |
| before `bbf36ef` | 772 | 1.316 | 33.07 | 195 | 140.4 | n/a (bins were 256 of 5700) |
| after `6636f3d` | 772 | **1.509** | 33.28 | 191 | 129.5 | `maxPerTile 270, refused 4682, fullTiles 64, meanCount 17.4` |

**I am not claiming the gate closes, and the reason is the counter.** The aisle is
marginally warmer (1.316 → 1.509) and the frame is not slower. But `aisleWarmPct`
counted 1.316 *before* the fix too, at a pose where the bins were 22x too small and
the reader read the wrong words. So the counter is dominated by crowd and facade
warm pixels and **cannot distinguish "the aisle is lit" from "something else
nearby is orange."** A counter that cannot fail is not evidence, and this one
cannot fail.

The arithmetic that says the pool *should* exist: the nearest lantern is 6.3 m up
with r=15, I=3, so deck irradiance directly beneath it computes to
`I * (1-d²/r²)² / (1+d²·0.05)` = **0.68–0.82**, against a night ambient of 0.5.
That is a 1.4–1.6:1 ratio against ambient and should be plainly visible. It is not
obviously so in either frame, and I have not explained that. Next suspect, stated
but untested: at r=15 with a 6.3 m mounting height the pool is broad and shallow
rather than a defined pool — a 15 m radius from 6.3 m up is a disc ~28 m across,
so "a visible warm pool" may need a smaller radius and a higher intensity, not
more lights.

### A seed discrepancy worth knowing about

`ctx.seed` is hardcoded `0` at the market call site, while the night probe
measured with `SEED` (`0x5e7a17`). Geometry and lights agree with each other
(both use `0`), so the render is self-consistent — but the probe's irradiance
table describes a **different layout** from the one that renders. On CPU, seed 0
puts lights at `d=9.6/10.2/10.3/11.8/12.7 m` from the camera where `SEED` puts
them at `10.3/12.7/12.7/32.2/32.6 m`. Any future measurement must derive its
expectations from the same seed the baker uses.

## 6. Code/document contradictions, said plainly

- **The "deck 0.62 multiplier" is stale.** The uniformity brief says the slab
  joints may be "drowned by the deck's 0.62 multiplier". That multiplier was
  removed: `gbuffer.wgsl` now reads `deckMul = select(1.0, 0.82, dirtyRoad)`, and
  only for asphalt/rubber/dirt. Flagstone, cobble, boardwalk, metal deck,
  terracotta and board-formed get **no** deck multiplier at all, by the argument
  in `STREET_SPEC.md` §A. Do not go looking for a 0.62.
- **The "365" is probe-scoped, not a city total.** 365 is the grammar's output
  over the 8 market chunks the probe walks at `SEED`. At `ultra` with 79
  resident chunks the same counter reads `produced 1592`. Both are true; they
  measure different sets.
- **`MAX_MARKET_LIGHTS_PER_CHUNK = 48` is not a chunk cap.** It is enforced
  inside the grammar, per query, and a chunk can carry several market
  carriageways — measured 4, 5 and 6 in three chunks, which is why one chunk
  reports `produced 192` against a per-query maximum of 48. A chunk-level budget
  is needed and lives in `groundbake.ts`.
- **`src/agent/tools.ts:315-322` carries a second, divergent `PHASE_LOOK`.** The
  conductor's `set_time` and the renderer read different night rows. Not my file,
  and it remains unowned — flagged again here because it is a silent-divergence
  trap and this round measured night behaviour.
- **`windowGlow` is still a phantom** and `ROADMAP.md` R2 still recommends
  raising it by name. Untouched this round; see §7.

## 7. Not done

- **The kerb joint.** The kerb face already has block joints at 0.30 amplitude
  (`gbuffer.wgsl:432`), but at 3 m the reviewer is looking mostly at the kerb
  **top**, which is handled by the footway branch. A distinct joint where the
  kerb meets the road needs to be authored, and I could not verify it against a
  frame.
- **Ground uniformity.** Diagnosis only, from code: joint masks are
  `smoothstep(joint*0.45, joint*1.35, dist)`, i.e. **1.35–2.7 cm wide** for the
  paving families (`pavingParams`: flagstone 0.030, terracotta 0.022, cobble
  0.050). Against ~0.69 mrad/px at fov 1.1, a 2.2 cm joint passes 1.5 px at
  about **21 m** and is gone by 30 m. That predicts the reviewer's "does not
  survive" finding, and the remedy is a screen-space floor on joint width plus
  more joint contrast — but the frame I captured is a *carriageway at night*,
  which carries no joints by design, so **it does not test the reviewer's
  daylight claim and I am not claiming it does.** Unverified; not committed.
- **Confirming the distance-ordered bin against a frame.** Capture budget spent.
- **`windowGlow`**, R2's night luma (11.4 vs a noon of 125.75 — worth
  re-measuring now that the market emits light, but it is `weather.ts`, not mine),
  and the duplicate `PHASE_LOOK`.

---

## 4f. Round 10: the day cull, and which recorded numbers are void

### The day cull

`gatherLights` did `if (byDay) continue` on `world.dayPhase > 0.55`. `dayPhase` is
derived from a sun **clock** (`integrateWorld` advances `sun.azimuth` every tick);
`setTime` sets a **weather phase** once. Two sources of truth. A pose named
`night-lanterns` reported `produced 48, delivered 0, culledByDay: true`.

Removed rather than re-thresholded, because "is the sun up" and "should an authored
light be visible" are different questions. Measured on the harness's own pose:
`delivered 0 -> 1414`, `binned 1414`, `starved 0`.

### The pool, measured on the fixed seed

Seed is now `6191639` (the parse bug is fixed, so the city changed again). Spine
re-derived on CPU; lantern `c.w +20.05` at px(800,290), pool `c.w +19.97` at
px(800,543) — **both verified before the shot.**

| | |
|---|---|
| nearest warm lantern to the pool | **6.9m** |
| warm lanterns within 30m | 7 |
| tile at the pool | `count 69, stored 69` |
| `culledByDay` | **false** |
| `binned / starved` | 973 / **0** |
| `aisleWarmPixelPct` | **26.78** |

And the comparison that resolves §4e's caveat:

| sample | RGB |
| --- | --- |
| **deck at the pool** | **`[41.8, 29.9, 7.5]` — red-dominant** |
| deck 20m off, one side | `[40.1, 68.1, 99.5]` — blue-dominant |
| deck 20m off, other side | `[64.0, 79.3, 104.0]` — blue-dominant |

Round 9 recorded the pool as a streak with the deck *brighter elsewhere* than at the
lantern. That is no longer true: the deck at the pool is warm-dominant and the deck
around it is blue-dominant. **The pool is a warm region, not a level change.**

### Which recorded measurements are void

Every CPU-derived coordinate in §1–§4e was computed against `0x5e7a17` while the
frames were seed 0. They are **cross-world and cannot be compared to their frames**:

| § | measurement | status |
| --- | --- | --- |
| §3 | 365 produced / 0 harvested | cross-world, but the *shape* (nothing harvested) is a code fact and stands |
| §3 | aisleWarmPixelPct 0.000 -> 0.225 -> 0.073 | **void** — three different cities, not a series |
| §4 | ultra 0.073 vs default 0.225 | **void** — cross-world comparison |
| §4c | bin `count 74`, max index 385 | valid — read from the GPU buffer, not derived on CPU |
| §4d | deck irradiance 0.000 vs 1.197 | cross-world, but both figures are code arithmetic on the same chunk, so the *ratio* stands |
| §4e | aisleWarmPixelPct 5.72 | **void as a comparison**; valid as an absolute for seed 0 |
| §4f | 26.78, pool red-dominant | **current**, seed 6191639 |

The pattern worth keeping: **GPU-read numbers are valid regardless of seed, because
they come from the frame.** Every measurement that went wrong went wrong on the CPU
side. Where a number is quoted from a CPU derivation, it describes the city that
derivation used.

## 5. Status

The aisle has a measurable warm pool on a frame with lights in it, verified with
`c.w` on both subjects before the shot. **Whether it satisfies gate 3 is the
reviewer's call.** The `08-night-lanterns` pose is separately misnamed — it is an
aerial daylight (`culledByDay: true`, phase `clear`), not a night street — and its
definition is in `capture.mjs`, not mine.

### Round 11: the pool, with adjacent-pavement comparison and full provenance

Re-shot at the consistent seed. **Metadata, now written into `shots/latest.json`
by the harness rather than reconstructed by hand:**

```
seed            6191639
tier            high
camera.position [-35.5, 2.372, 159.4]
viewRayPoint400m (a point on the view ray, not the requested look-at)
fov             1.038
lodHistogram    [9, 98, 0, 0]      residentChunks 107
lightDelivery   produced 144 · delivered 973 · binned 973 · starved 0 · culledByDay false
entity          drawCalls 4 · triangles 330512
```

Lantern `[-29.21, 6.89, 140.44]` and its pool `[-29.21, 0, 140.44]`, both `c.w > 0`
verified on CPU before the shot.

**The reviewer's test — adjacent comparable pavement, not a region mean:**

| sample | RGB | R−B |
| --- | --- | --- |
| **pool, 22px patch** | `[45.0, 32.0, 7.5]` | **+37.5 warm** |
| deck 120px away | `[100.3, 76.0, 65.0]` | +35.3 |
| deck 400px away | `[50.9, 75.6, 107.2]` | **−56.3 cool** |
| deck 680px away | `[115.9, 73.9, 52.3]` | +63.6 |

The pool is warm and the comparable deck 400px away is cool — a sign change of 94
in R−B between two patches of the same surface. The 120px and 680px samples are
also warm, which means the warm region is broader than a single lantern's disc and
is picking up stall geometry and lit facade as well as the deck.

**Honest caveat, and it is a small one:** my `c.w` verification was computed for
the pose I *requested*, and the camera holds a slightly different one (fov 1.038
against the 1.1 asked for, position y 2.372 against 2.3). The pose was close enough
that the verification held in substance, but it was not verified against the pose
the renderer actually used — which is precisely the F2 family again, caught this
time because the sidecar made the discrepancy visible rather than because I
checked it.

---

## 4g. Round 13: the control, and four hypotheses measured

### The control

`09-market-down` and `09-market-down-day` are the same camera at seed 6191639. The
reviewer's verdict on them:

> day — *"the market is actually there: rows of thin canopy frames receding both
> sides, yellow/olive crates, a striped orange/green stall in the right foreground,
> cables at three heights with pale lantern spheres hanging"*
> night — *"a forest of blue slabs over a warm orange ground wash... No readable
> stalls, no crowd"*

Same seed, same camera, **933 lights delivered in both, `starved 0` in both.** The
geometry is present in the night frame; it is not being lit.

### Hypothesis 1 — do the delivered lights reach the lighting pass? **FALSIFIED.**

Measured at the market spine, night, `c.w` verified on both subjects:

```
tile at the pool centre   count 69, stored 69
binMean 66.76
deck at the pool          [45.0, 32.0,  7.5]   R-B = +37.5  WARM
deck 400px away           [50.9, 75.6, 107.2] R-B = -56.3  COOL
```

The loop in `lighting.wgsl` is correct — `min(tl.count, 96u)` reads the binned
count and `lights[tl.lights[i]]` indexes absolute light indices, both fixed in
round 7. The pool is warm-dominant against its own surroundings. **The lights are
reaching and being applied.**

### Hypothesis 2 — magnitude vs tonemap. **THE ANSWER, and it is partly authoring.**

Linear HDR at the frame centre, before tonemap, same pose:

| | linear R | linear G | linear B |
| --- | --- | --- | --- |
| night | 0.0716 | 0.1150 | 0.1493 |
| day | 0.2444 | 0.3311 | 0.3853 |

Night is **3.41× darker in linear terms** — which is correct, it is night. The
tonemap is not eating it. Through `exposure 1.60 → ACES → sRGB`:

| linear | byte |
| --- | --- |
| 0.0217 (a pooled lantern on the deck) | **28** |
| 0.0716 (measured night centre) | 78 |
| 0.2444 (day) | 163 |

**A pooled lantern lands at byte 28.** That is the finding. It is visible as a
warm tint — the pool *is* there, R−B +37.5 — but 28/255 is a whisper. The
arithmetic behind it, from the measured grammar:

```
lantern: drop 6.3m, r=15, I=3
  atten at the deck directly beneath  0.2273
  radiance = I * atten * albedo / PI = 3 * 0.2273 * 0.10 / 3.1416 = 0.0217
night ambient on the same deck = 0.01404 (green)
  => the lantern is 15.5x ambient, and still lands at byte 28
```

The lantern *ratio* is generous. The absolute value is not, because `r = 15` at
`drop = 6.3` puts the light 6.3 m above a 15 m sphere: the falloff window
`(1 - d²/r²)²` has already taken 77% of the energy before the light reaches the
ground. **This is an authoring problem — radius and intensity — not a plumbing
one**, and it says so plainly because three plumbing fixes this session would
otherwise read as the whole story.

### Hypothesis 3 — window emissive. **NOT the cause; it is authored fine.**

`lighting.wgsl:231` does `color += emissive` with no ambient or `dayPhase`
multiplier — I grepped for one. Window emissive is `warm * bright * (0.55 +
core*0.9)` with `bright` in 0.35..3.55, so the range is **0.19..5.15 linear**, and
0.19 lands at **byte 145** — plainly visible, and 7× brighter than the pooled
lantern.

So the frame's "no window glow" is not the emissive channel being multiplied into a
zeroed ambient. Either the windows in view are simply not in the lit 40%
(`step(0.58, hash)`), or they are being lost before the lighting pass. **Not
separated this round.**

### Hypothesis 4 — `dayPhase`. **CLEAR.** Nothing keys off it since `cd7b7de`;
`dayPhase 0` on the night frames and 933 lights delivered in both proves it.

### What is left: a saturated tile bin, unproven

`probe('tiles')` at the market, night:

```
binMax 341   cap 96   refused 2465   fullTiles 36
```

**The per-tile bin is saturated and refusing lights.** This is the eighth
candidate and it is real — but reordering the CPU array changed nothing
(`refused 2465`, `fullTiles 36` identical before and after), because reordering
changes *which* lights are dropped, not *how many*. I made the nearest-first sort
unconditional on that reasoning, measured no change in the counts, and **reverted
it** rather than commit a plausible fix with no evidence behind it.

**`windowGlow` is still a phantom** and this round confirms it is not the cause:
window emissive is authored 7× brighter than a pooled lantern and reaches the
lighting pass unscaled. Wiring it would be a tuning change, not a fix for
anything measured. Recommend deleting it from `weather.ts` and correcting R2,
which still recommends raising a number nothing reads.

## 5. Status

Delivery is exact and the pool is measurably warm-dominant. **The gate stays open,
and the remaining cause is authoring:** a market lantern at `r=15, I=3` hung 6.3 m
above the deck produces 0.0217 linear radiance and lands at byte 28. Whether that
is enough is the reviewer's call; if the frame is to carry a legible walking plane
the radius and intensity need raising, and that is a decision about the look, not a
bug.

## 6. The moiré — correlation partially broken, cause not isolated

The capture agent's correlation: affected frames are exactly `grain >= 0.26` and
`chroma >= 0.50`.

**Partly a confound.** Grain, chroma and exposure travel together in the phase
table, and the only phases with `grain >= 0.26` are `night` (0.30) and
`lantern-rise` (0.26) — so "grain >= 0.26" is nearly a proxy for "it is night".
And night carries **exposure 1.60, the highest of any phase**, which lifts a
near-black frame and makes any grain visible in it.

Measured, same pose, only grain and chroma changed:

```
grain 0.26 chroma 0.50 : high-frequency energy 4.786
grain 0.00 chroma 0.00 : high-frequency energy 3.638
ratio 1.32x
```

**So grain is a contributor and not the cause** — turning it off removes a third of
the high-frequency energy and leaves 3.638 behind. Something else bands with
grain at zero, and I did not isolate it.

One static finding worth recording: the grain's hash is
`hash21(uv * F.screen.xy + vec2f(t*1.7, t*2.3))` — a screen-space lattice offset
only by time. That is correct film behaviour, and I checked that it is not a static
pattern: 1597 distinct values along a 1600px row, zero consecutive repeats. So the
grain is temporal and well-distributed, and the banding is not its lattice.

Not diagnosed. The candidate left is the half-res aux chain (DOF, bloom mips)
upsampled through `linSamp` into a 16-bit-ish gradient, which bands in 8-bit
output — untested.

---

## 4h. Correction to 4g, and the real cause: N·L, not intensity

**4g's "15.5× ambient" was a bad comparison and is withdrawn.** I divided a
warm-dominant pool (red-heavy, `[1, 0.72, 0.26]`) by the *green* ambient channel,
which understates the contrast and flatters the diagnosis in the wrong direction.
`__selftest_market.ts` already does this correctly — it compares red pool to red
ambient — and computes **74×**, passing its own `>= 10×` guard. The selftest was
right and my one-off number was wrong.

Against the *measured* ambient (`skyIrradiance [0.00933, 0.01404, 0.04782]`) the
red-pool/red-ambient ratio at the deck is **~25×**. The pool is strong. The
selftest was never lying about the deck.

### The split the reviewer reported IS the diagnosis

> night — *"a forest of blue slabs over a warm orange ground wash… No readable
> stalls, no crowd"*

**The ground wash is visible and the stalls are not.** That is not a magnitude
problem; it is a surface-orientation problem, and it is arithmetic:

One lantern, `r=15`, `I=3`, hanging `drop = 6.3 m`, albedo 0.10, measured sky:

| surface | N·L | pool (linear) | through exposure 1.60 + ACES |
| --- | --- | --- | --- |
| deck beneath the lamp, normal +Y | 1.000 | `[0.0208, 0.0150, 0.0054]` | **42 / 31 / 10** |
| crate top face 1 m off-axis | 0.987 | `[0.0218, 0.0157, 0.0057]` | 44 / 32 / 10 |
| **stall side panel, 2 m back, normal horizontal** | **0.353** | `[0.0091, 0.0066, 0.0024]` | **19 / 13 / 3** |
| ambient only, any surface | — | `[0.0009, 0.0014, 0.0048]` | 1 / 2 / 9 |

**Vertical surfaces receive 2.28× less light than the deck they stand on**, and
because that lands at byte 19 through a filmic curve, the separation between "warm"
and "cool" halves from **32 bytes on the deck to 16 on the stall face**.

The lantern is hung at 6.3 m for a street 15 m wide. That is a correct choice for
a roadway and the wrong one for a market whose readable geometry — crates, stall
flanks, tarpaulin returns, canopy frames — is 1–2 m tall and packed close together.
Almost all of the light lands on the deck *between* the stalls and almost none on
their faces, so the frame reads as a lit floor with dark slabs standing on it.

### Why raising `I` does not fix it

Intensity scales both surfaces identically, so it preserves the 2.28× ratio and
lifts the stall face from byte 19 to whatever the deck reaches. That brightens the
wash and the slabs together — the reviewer already called the ground "a warm
orange ground wash", which is the symptom getting worse, not the fix. **This is why
4g's recommendation to raise radius and intensity was wrong, and why it is
withdrawn rather than left standing.**

The lever that changes the *ratio* is the drop height: at 6.3 m a horizontal
normal sees the lamp at `cos⁻¹(2/5.66)`. Halving the drop roughly doubles N·L on
the vertical faces while leaving the deck at 1.0.

**Not changed here.** `LANTERN_LIGHT_RADIUS`, `LANTERN_LIGHT_INTENSITY` and the
cord/drop geometry all live in `src/world/marketgrammar.ts`, which this agent does
not own, and lowering the cords changes the skyline silhouette of the district —
which is a decision about the look, not a bug fix. It needs the owner and a frame
to judge, and this agent is out of capture budget.

---

## 4i. Round 14: the fix is baked, and my prediction is refuted by the render

### What is actually in the frame

Both frames, seed 6191639, tier **high**, camera `[1.16, 2.44, 0.36]` (night) and
`[1.16, 2.47, 0.36]` (day) — the same viewpoint, differing only in phase.

| | night | day |
| --- | --- | --- |
| `dayPhase` | 0 | 0.96 |
| lights / delivered / binned | 933 / 933 / 933 | 933 / 933 / 933 |
| starved / rejectedFar | **0** / 0 | **0** / 0 |
| market lanterns in view | 144 | 144 |
| hang height above deck | min 2.81 · **median 3.85** · max 5.10 | identical |

Every market lantern in view carries intensity **2.0**, which is the new
`LANTERN_LIGHT_INTENSITY`. **The drop-height fix is genuinely baked into the
render** — 3.85 m median against 6.3 m, not a constant that only the self-test
sees.

### The prediction, and the refutation

§4h predicted a stall face at **byte 77** with a 1.50× vertical penalty. Measured
from the render, same screen points in both frames:

| surface | NIGHT byte | R−B | luma | DAY byte | DAY luma |
| --- | --- | --- | --- | --- | --- |
| deck under a lantern, 10.0 m | `[61.6, 37.0, 23.3]` | **+38.3** | 42.8 | `[132, 128, 129]` | 129 |
| deck, left pool | `[50.1, 29.0, 14.8]` | +35.3 | 33.7 | `[113, 109, 109]` | 110 |
| deck, right of frame | `[4.8, 5.1, 9.1]` | −4.3 | 5.5 | `[109, 114, 122]` | 113 |
| **right stall flank** | `[7.5, 8.5, 15.7]` | **−8.2** | **9.0** | `[100, 117, 115]` | 112 |
| **stall canopy frame** | `[5.4, 12.6, 44.7]` | **−39.3** | **14.1** | `[106, 130, 136]` | 124 |
| **centre stall pole** | `[5.0, 6.5, 21.4]` | **−16.4** | **7.8** | `[156, 176, 178]` | 170 |

**The prediction is refuted by roughly a factor of ten.** Predicted flank byte 77;
measured 8–15. And the flank is not merely dim, it is **cold** — R−B −8 against
the deck's +38. It is receiving blue ambient and essentially no warm light at all.

The hang height did what it was supposed to do. The deck beneath a lantern is now
byte 62 and warm-dominant by 38. What it did **not** do is put a lantern over a
vertical face.

### Exposure is ruled out

The `09-market-down` pose pins `exposure: 1.28`, below the night phase's 1.60 —
worth checking, because it underexposes night by 20%. Inverting the display chain
and re-applying at 1.60:

| surface | at 1.28 | at 1.60 |
| --- | --- | --- |
| deck under lantern | 62 | **88** |
| right stall flank | 8 | **14** |
| canopy frame | 5 | 10 |
| centre pole | 5 | 9 |

Re-exposing lifts the deck 62 → 88 and the flank 8 → **14**. **Exposure is not the
mechanism.** Half the stop buys the ground and does nothing for the structures.

### Verdict: the gap is NOT closed

The reviewer's request was for a bounded footprint that reveals paving joints,
counter edges and a person against cool shade, repeated along the aisle. In the
night frame there is **one** warm footprint, on the deck, bottom-left — and every
vertical structure above the deck line is a silhouette. The canopy frame in the
crop reads only because it is darker than the blue buildings behind it.

The day control at identical screen points measures luma 112–170 on exactly those
structures. **The geometry, the crates, the counter edges, the paving joints and a
figure are all present and all resolvable.** Night reveals none of them.

### The single remaining mechanism

**The lanterns hang over the carriageway, and the stalls do not stand under them.**
`STRING_ANCHOR_OUT` puts each cord 1.7 m outboard of the kerb and `STRING_PITCH`
spaces cords 17–31 m apart, so a stall flank is laterally offset from the nearest
lantern rather than beneath it. Lowering the hang fixed the N·L ratio for a surface
directly under a lamp — which is exactly why the deck improved and nothing else
did. A surface 2 m to the side and at grazing incidence loses most of what little
solid angle it has, and there is no second warm source at counter height: emissive
windows and signs *look* lit but emit no light, and ambient is blue.

**Confidence: medium, and stated as such.** This measurement establishes that warm
light reaches the ground plane and nothing reaches the verticals — it does *not*
establish lateral distance as the cause, because the vertical sample points were
chosen by eye from a dark frame and may have missed geometry. The measurement that
would settle it is to place a probe on a known stall flank and print its distance
and bearing to the nearest lantern. That is the next capture, and it was not
bought.

### Also found: `--pose` silently failed to apply the pose

`node tools/capture.mjs --pose=09-market-down --quality high` reported
**`PASS 1 shot(s)`** and rendered **a rooftop vista from 444 m up**, at
`[1058.15, 444.17, 337.13]`, with `requested: null` in the provenance. The pose is
defined at `[1.16, 2.6, 0.36]`. Both captures in that invocation were of the wrong
place and the requested-vs-held check that is supposed to fail the run did not fire.

Two frames were spent discovering this. Both usable frames in this section were
taken through `--eval` with an explicit `setPose`, which is the path that
demonstrably reaches the market. **This is the exact failure `PROCESS.md` and the
harness's own round-11 comment describe — a pose that was asked for is not a pose
that was rendered — and the guard against it is not working.** It needs its own
round; the fix is in `tools/capture.mjs`, and diagnosing why `setPose` reported ok
while the camera was untouched is the work.

### Moiré — parked, and visible

Unchanged and still unexplained: **3.638 of high-frequency energy remains at
grain 0 and chroma 0.** It is severe in this frame, which is dark and therefore
grain-dominated, but it is not what makes the stalls unreadable — the stalls are
at byte 8–15, far below anything grain can account for.
