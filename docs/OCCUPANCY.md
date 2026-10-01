# Occupancy — why the street is empty, and what has been ruled out

Companion to `docs/MARKET_REPORT.md`. This is the durable record of the crowd's
placement investigation and of a design attempt that **did not work and was
reverted**.

**Does `docs/ROADMAP.md` R1's done-when pass? No.** See §5.

---

## 1. The symptom, as a number

Seed 42, camera on the market spine at a derived street-level pose, 240 frames
settled, `live` against `targetVisible`:

| camera at spine `along` | live | drawn | forward 20 m depth bins |
|---|---|---|---|
| 0 m | 2550/2550 | 2511 | 265 · 539 · **1149** · 250 · 165 · 85 · 0 · 0 |
| 160 m | 1310/2550 | 1954 | 85 · 0 · 0 · 0 · 0 · 0 · 0 · 0 |
| 240 m | 516/2550 | 593 | 0 · 0 · 0 · 0 · 0 · 0 · 0 · 0 |

Two failures, and they were long mistaken for one:

1. **The standing population collapses with distance from the market.** 2550 →
   1310 → 516. The crowd only exists where something holds it.
2. **A 1149-agent pile sits 40–60 m ahead of the camera**, and it is *not* the
   market: measured, the attractor is at `(10, −12)`, the camera is at `(10, −12)`
   — 0 m away — and the cluster centroid is `(72, −2)`, **63 m from it**.

There is also a hard spatial bound: **nothing is ever placed beyond ~109 m
forward** in a 160 m `viewRadius`, on any frame, including frame 1.

## 2. Six mechanisms eliminated, each with a control

| hypothesis | control | verdict |
|---|---|---|
| `rng.fork` does not vary between groups | drew anchors for groups 0–17 with the real seed `makeRng(42 ^ 0xc0ffee)`: 13 distinct of 18, depths 4–156 m, consecutive forks uncorrelated | **disproved** |
| the build under test was stale | `vite build` succeeds; served bundle matched disk on every certified capture | **disproved** |
| `snapToStreet` drags far samples back toward the camera | re-sampled group centres along the camera's *own* street, so there is no free-space walk to undo; along-range moved by **0 m** | **disproved** |
| lateral spread is too wide | narrowed the group band to the carriageway width; street emptiness got **worse**, 58% → 83% | **disproved** |
| `liveCount` reaching `targetVisible` stops seeding | `live` reaches 2550/2550 by frame 30 and stays; the cap never binds | **disproved** |
| goals reach past the view radius, so agents walk out and are retired | bounded `randomNodeFor` to `viewRadius * 0.8`; `live` at 160 m stayed **473**, depth histogram unchanged | **disproved** |

### The sink, measured

`rebuildSlices`' `behind` test was the live candidate and is now instrumented
(round 8; the instrumentation was reverted, the numbers kept). Over 240 settled
frames at the spine foot:

```
retired total                6196
  by radius only             2367   (38%)
  by behind only             3829   (62%)
  by both                       0
seeded total                 8746   mean radial 81.5 m  (viewRadius 160)
```

**`behind` is the larger sink, and it is 2.6x the radius test.** At 16
retirements and 36 seedings per frame against a target of 2550, the population
is in constant *replacement* rather than accumulation: agents walk across the
view plane and are destroyed, and replacements appear where the camera is
looking. That is what a crowd that never accumulates looks like from the
inside, and it is the mechanism behind both the collapsing profile and the
1149-agent pile — replacements keep arriving into the same band ahead.

So the fix is not more agents and not a wider place radius. It is that an
agent's goal must not take it behind the view plane.

### And that fix was attempted, and it did not work

Round 8b implemented `keepInFront`: four goal candidates drawn from the same
distribution, the first lying in front of the view plane kept, the original
returned unchanged if none qualify, so it could not make goal selection worse.

```
                    live at   live at   forward 20 m bins at the spine foot
before (HEAD)         0 m      160 m     265  539 1149 250 165  85
with keepInFront   2550/2550  1267/2550   273  544 1151 238 169  79
before (HEAD)      2550/2550  1310/2550   265  539 1149 250 165  85
```

Unchanged, and marginally worse at 160 m. **Reverted.** That is a seventh
elimination and an important one: the obvious fix that follows directly from the
measurement above does not move the metric, which means the chain
"goal behind the view plane -> retirement -> churn" is either incomplete or the
`behind` retirements are a symptom rather than the cause.

So the crowd is not yet understood well enough to change. Nine mechanisms have
now been eliminated and one sink measured, and nothing has moved the profile.
Continuing to ship design changes against a model that is demonstrably wrong is
how R1 has survived three sessions of plausible-looking work.

## 3. Two corrections to my own earlier readings

Recorded because both were stated with more confidence than the evidence
supported.

- **"95% of the crowd is standing" was my measurement being wrong.** Occupancy
  was measured as distance to the *nearest previous instance position*. With 2500
  agents packed together that is nearest-neighbour distance, not displacement, so
  every agent reads as stationary. The instance buffer cannot be used either:
  the crowd writes 28 floats per record and the last four overflow into the next
  instance, so `b+25` is the next agent's x, not a speed.
- **"The crowd transits, it does not occupy" was too neat.** The forward pile is
  63 m from the market, so it is not the market drawing everyone. Something else
  is holding them there.

## 4. The design attempt, and why it was reverted

Two changes, both to `src/sim/crowd.ts`:

1. **Place attraction.** `Need.Market` returned `nearestNode(this.market)` — one
   node, forever, with no capacity. Changed to
   `randomNodeNear(this.market, MARKET_PLACE_RADIUS)` with a 40 m radius.
2. **Dwell that expires in place.** Previously only a Market-goer that re-picked
   Market got a dwell. Changed so that *arriving* starts the dwell, for every
   need, and the dwell runs down before the next goal is picked.

Both are sensible and both changed nothing measurable:

```
before   depth 20m: 265  539 1149 250 165  85
after    depth 20m: 257  536 1160 241 173  91
live at 160 m along: 1310 -> 1345
```

**Reverted.** A simulation-design change that moves the number it was aimed at by
one percent is an unverified theory, and shipping it would read as progress on a
roadmap item that has already survived three sessions of exactly that.

There is a concrete reason the place radius could not work, measured:
**only 6 nav nodes lie within 40 m of the market, and 30 within 80 m**, out of
4075 in the city. A 40 m "place" has six places in it. Raising the radius trades
the jam for a spread thin enough to be neither a queue nor a crowd.

## 5. Is R1's done-when met? No

R1 requires *"a density where the far end of the street is visibly busy"* and
*"people on the pavements"*. Measured in a certified frame:

- **58% of visible street length carries no legible figure** (14 of 24 samples at
  5 m steps), unchanged through rounds 6, 7 and 8.
- The certified day frame shows the market **fully built along both kerbs and not
  one person on it**.
- The standing population at 160 m and 240 m along the spine is roughly half and
  a fifth of the target.

The market grammar meets its own criterion: longest gapless run 3, adjacent
same-silhouette pairs 0 of 367. The crowd does not meet R1, and the reason is
the crowd, not the geometry.

## 6. Night legibility, and why it is not measured here

`docs/LEGIBILITY_TARGETS.md` sets ≥2.5:1 between a figure's body and the ground.
`tools/figure_contrast.py` measures it from pixels without hand-placed boxes:

```
best local figure contrast   1.32:1
```

No palette can lift that, because `skyIrradiance` multiplies coat and deck by
the same ambient and their ratio is invariant under uniform illumination. A
self-lit floor on the figures was implemented, measured (1.32 → 1.33, noise) and
reverted: the street had no figures in it to measure. **This number should be
re-taken once developer 1's aisle lighting lands**, because a lit aisle changes the
deck luminance the crowd has to contrast against, and a ratio taken against an
unlit aisle is a ratio against a target that is about to move.

## 7. What would actually fix it, in order

1. **Keep an agent's goal in front of the view plane.** The `behind` test is the
   measured larger sink at 62% of retirements (§2). This is the one change the
   evidence actually points at, and it has not been attempted.
2. **Find what the 63 m pile is.** It is not the market. Until that is named,
   every placement change is a guess at a target nobody has located.
3. **Give the market more places than six.** Either the place radius must exceed
   the node density, or the nav graph needs finer resolution along street frontages.
4. **Only then** revisit dwell: occupancy is worth having once agents have
   somewhere distinct to occupy.

---

## The funnel (round 9)

One frame traced at two poses, one row per agent index, first-seen-wins across
full rebuild cycles. `sampled` is the anchor drawn, `placed` is after
`snapToStreet` and the footway push, `in-range` is Pass B's radius test,
`buffered` is present in the instance buffer.

### Along = 0 (spine foot)

```
stage                      count    radial 0..160 m, 20 m bins
sampled  (anchor drawn)     1271     81 160 302 204  32 144 100 248
placed   (post snap)        1271     81 160 302 204  32 144 100 248
active   (F.active>=.5)     3478    170 327 1502 304 540 213 122 300
in-range (Pass B r2)        3402    170 327 1502 304 540 213 122 224
buffered (instance buffer)  3402    170 327 1502 304 540 213 122 224

retired by radius  570    retired by behind  694    killed by strand>90  0
```

**No funnel loss.** 3402 of 3478 positioned rows reach the buffer, and the
radial profile is flat out to the 160 m radius. The target of 2550 is met.

### Along = 160

```
stage                      count
sampled                    5938
placed                     5938
active                     6000
in-range                   5855
buffered                   5428
```

**Also no funnel loss.** The capacity is 6000 and essentially every slot is
seeded and drawn.

### So the pipeline is innocent

Every hypothesis in rounds 5-8 tested the per-agent pipeline. The funnel shows
that pipeline is not where the population goes. Two measured facts about the
*population* survive:

**1. The crowd does not follow the camera.** Two independent probes (fresh start
at along=160, and progressive 0 -> 160) agree exactly:

```
MODE=fresh       along=160  live=2550 drawn=2297
  active 2550    ahead 191    behind 2359
  radial 0..160 m:   0    0    0    0  459  822  486  530
MODE=progressive along=160  live=2550 drawn=2237
  active 2550    ahead 178    behind 2372
  radial 0..160 m:   0    0    0    0  641  628  425  543
```

93% of the population is behind the view plane, and the radial bins at 0-40 m
are **empty** while 80-160 m is full. `liveCount` reports a full 2550/2550
throughout, so the counter is not the problem — the agents simply never move
forward. This is the same 109 m / 63 m / 40-60 m pile seen from three different
poses: it is a single population sitting behind the camera, and every profile
measured in front of it has been measuring an empty foreground.

**2. `snapToStreet` moves agents a long way.** Measured, not inferred: mean
displacement **19.4 m**, max **24.4 m**, and 5.4% of anchors that were inside the
160 m radius end up outside it. Max radial goes 160.3 -> 172.0 m. This is a real
placement defect, and it is a *drag*, not a loss — those agents are seeded
outside the radius and retired, but the population refills to target anyway.

## Retractions

Two of my own numbers this round were wrong, and both were my instrument:

- **`F.goal` offsets.** I read `F.goal` at array index 16 and `F.next` at 17.
  The real table (`src/sim/crowd.ts:117-134`) is `goal: 8`, `next: 9`, and 16/17
  are `curious` and `district`. That produced a confident claim that 62% of the
  crowd was walking toward a single node 1 km away. With the correct offsets
  **every one of the 2550 live agents has a valid goal, p50 77 m, p90 159 m.**
  The "96.6% have no goal" claim was an artefact of my own trace row, which
  recorded `randomNodeFor`'s return value at a moment when the re-pick had not
  yet fired. Both retractions are in the record because both were stated with
  confidence.
- **`LOCAL` stride 28 vs 29** in the same probe, which is why it first reported
  `live 1857` against a true 2550.

This is the fifth time in this project a diagnostic has measured the wrong side
of a boundary, and the second time this session. The `F` offset table must be
imported or asserted, never retyped.

## What to instrument next

Not the pipeline. Specifically:

1. **`rebuildSlices`' `behind` test against `lastFwd`.** 2359 agents are behind
   the camera and alive, yet the same test was measured at 62% of retirements.
   Both cannot be true. Print `fwd` as it arrives at `rebuildSlices` against
   `this.lastFwd` for the same frame.
2. **Why the population does not re-seed forward.** `liveCount` is full at 2550
   with 93% of agents behind, so the `!active && liveCount < targetVisible`
   refill arm in `rebuildSlices` never fires. Print how many indices are
   inactive at that point.
3. The `snapToStreet` drag (§2 above) is a separate, smaller defect and can be
   fixed independently once the population question is settled.


## The night capture (round 9, owed measurement)

`node tools/capture.mjs --pose=night-lanterns --quality high` at the market,
served bundle verified against disk first. Two facts, and the second is the
useful one:

```
lights: 0
lightDelivery: { produced: 48, delivered: 0, binned: 0, culledByDay: true, cap: 3072 }
entityTriangles: 74800    entityDrawCalls: 0
```

**`culledByDay: true` at a pose named `night-lanterns`.** All 48 produced lights
are discarded by a day test at a night pose, so the aisle lighting landed in
`84d0d64` is not reaching the frame the night measurement has to be taken in.
This is developer 1's boundary (`lightDelivery` is emitted by the renderer), and
it is the same class as the `arrayLength` bug: a wire reports one thing and means
another.

`entityTriangles: 74800` with `entityDrawCalls: 0` is the same shape — triangles
counted, no call issued.

### Why the contrast number is not banked

`python3 tools/figure_contrast.py shots/2026-10-01T10-07-57.png` reports
**best 2.43:1** against the 2.5:1 threshold, up from 1.28:1. **It is not
evidence.** The frame has `lights: 0`, so it is not a lit-aisle frame, and the
tool's documented limitation applies exactly: with no figures in it, it returns
the brightest lit building edge. A number taken on an unlit frame against a
lit-aisle target is the 1.28 -> 1.30 mistake again in a new coat.

The threshold is close, which is worth knowing, but the honest state is that the
night crowd contrast **has not been measured** and cannot be until `culledByDay`
stops being true at a night pose.


---

# Round 10 — the funnel, on all three seeds

## R10.1 The seed, established empirically

| source | seed |
|---|---|
| `tools/capture.mjs:668` requests | `0x5e7a17` = 6192407 |
| `src/main.ts:99` `parseInt(..., 10)` on that string | **0** |
| `__syzygy.pose('street-crowd').source.seed` | **6191639** |

The third row is measured, not inferred. The last two rows disagree, so the
`0x5e7a17` fallback never runs and the world seed is 6191639 from somewhere
else — that "somewhere else" is untraced and is the first thing to read.

## R10.2 The funnel

Settled 240 frames at each pose before tracing, because round 9 measured a
teleport transient and called it a profile.

```
SEED 6191639 (the seed the frames use)
along=0     active 4097  in-range 4058  buffered 4058   drawn 2541   goal p50  23 m
along=160   active 6000  in-range 5932  buffered 3502   drawn 1013   goal p50  14 m
along=240   active 6000  in-range 5955  buffered    0   drawn    0   goal p50  15 m
             retired radius 6000   retired behind 5955   killed strand>90  0

SEED 0            along=0 drawn 2534 · along=160 drawn 2440 · along=240 drawn 2436
SEED 6192407      along=0 drawn 2323 · along=160 drawn 1591 · along=240 drawn  585
```

**On the seed the frames use, `drawn` is 0 at 240 m.** 6000 agents are alive and
every one of them is outside the 160 m radius. That is R1's gap, and it is not a
pipeline loss: nothing is dropped, the population is simply not where the camera
is.

**The three seeds give three different cities.** `drawn` at 240 m along is 0,
585 and 2436. The same code, the same poses, three answers.

## R10.3 Which stage loses them — and my instrument's own fault

The stage is `in-range -> buffered` at along=240 on seed 6191639. But I have to
record that **my funnel reported `in-range 5955` where the real test says 0**, so
that row is wrong.

Direct control, printing both radius tests in the same frame:

```
along=  0  viewRadius=160  passA_inR2=2537  build_inR2=2537  drawn=2537
along=160  viewRadius=160  passA_inR2=1356  build_inR2=1356  drawn=1356
along=240  viewRadius=160  passA_inR2=0     build_inR2=0     drawn=0
```

The two code paths agree exactly, as they must. So PROCESS.md rule 1 is
satisfied — *when both sides are printed from the field*. The failure is my
own: the trace row's `x,z` is written **first-seen-wins**, once, and then
compared against a camera 70 frames later, so the distance profile in §R10.2 is a
blend of 70 frames and is not a profile. `drawn` and `passA_inR2` are the
trustworthy numbers; the per-stage histograms are not.

Sixth wrong-boundary diagnostic in this project. The row must record a position
*per frame*, or the profile must be computed at the frame the count is taken.

## R10.4 CPU/GPU boundary

```
lights 465  delivered 465  binned 465      (day pose -- correct)
entityDrawCalls 0    entityTriangles 55000
```

**`entityDrawCalls: 0` in every capture this session**, including one with 2537
instances in the buffer and 55,000 entity triangles counted. A count that is
produced and never issued is exactly the `arrayLength` shape developer 1 found in
the light path. This is `renderer.ts` and is not mine; I am reporting it, not
touching it.

## R10.5 Re-scoping rounds 6-9 honestly

**Survive** (structural, city-independent):
- The funnel shows **no pipeline loss** on all three seeds.
- `killed strand>90` is **0** on every seed and pose.
- `assignPath` discards the goal to `F.next` when `from < 0` (`crowd.ts:588`).
  Structural, but with correct `F` offsets every live agent has a valid goal,
  so it is latent rather than active.

**Void** (measured on `0x5e7a17`, a city with no frame):
- "the 109 m wall"
- "62% of retirements are `behind`" — on seed 6191639 it is 39% radius / 62%
  behind at 0 m but **100% radius at 240 m**; the ratio is a property of the city.
- "12 lanterns within 40 m"
- the legible-street-length figure of 58%, and every R1 number quoted in rounds
  6-8.

**Superseded:** round 9's own "93% behind the camera" was measured on
`0x5e7a17` and does not hold on the frames' seed, where `drawn` at 240 m is 0
for a different and simpler reason — nobody is within 160 m at all.

## R10.6 What to instrument next

1. **Where seed 6191639 comes from.** Until the boot path is traced end to end,
   every number in this file is attached to an unnamed world.
2. **Why nobody is within 160 m at 240 m along** on seed 6191639 while 6000
   agents are alive. `goal p50 15 m` says the population is clustered on its
   goals, and those clusters are outside the radius. That is the R1 mechanism.
3. **`entityDrawCalls: 0`** — developer 1's boundary.
4. Fix the funnel's first-seen-wins profile before using it again.
