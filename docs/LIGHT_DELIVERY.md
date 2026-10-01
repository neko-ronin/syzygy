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
   than explain away.
2. **A fourth ABI** between `gatherLights`'s packing and `lightbin.wgsl`'s
   `arrayLength(&lights)`. Note the binned indices run to 385 while
   `stats.lights` is 296 — the bin is naming indices past the end of the array it
   was given. That is consistent with `arrayLength` reading the whole 3072-entry
   buffer rather than the 296 entries written, which would mean it walks stale
   lights. **This is the strongest lead and it is a code reading, not a
   measurement** — it needs `lodHistogram` and the array length read back
   together to confirm or kill.

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
