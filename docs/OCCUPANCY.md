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


---

# Round 11 — counting versus issuing

## The proof

`src/main.ts:424-430` installs a closure that `Renderer.render` invokes:

```ts
this.renderer.pendingEntities = (p) => {
  this.renderer.uploadInstances(this.entityScratch, total);
  this.pendingEntityTris = this.drawEntityBlock(p, 'pedestrian', ped.count, 0);
  ...
};
this.renderer.render(this.camera, dt);
```

`drawEntityBlock` (`main.ts:468`) is the only caller of `drawIndexed` for the
crowd, and it records every issue in `issuedEntityDraws`. Measured, live:

```
__syzygy.stats().issuedEntityDraws.length   ->  0
__syzygy.stats().entityTriangles            ->  1109640
```

**Zero entity draws issued, 1.1 million entity triangles reported.** The crowd
is not being drawn.

## Which counter lies

**`entityDrawCalls: 0` is correct.** It is `c.entity` (`renderer.ts:1294`),
incremented only at `renderer.ts:1554` inside `Renderer.drawEntitySet` — and
`main.ts` deliberately bypasses `drawEntitySet` (the comment at `main.ts:405`
explains why: it writes at buffer offset 0 on every call). So that counter is
honestly reporting a path this app never takes.

**`entityTriangles` is the diagnostic that lies.** `main.ts:438`:

```ts
this.renderer.stats.triangles += this.pendingEntityTris;
this.renderer.stats.entityTriangles += this.pendingEntityTris;
```

These run **after** `render()` returns, unconditionally — including on every
frame where `render()` early-returned at `renderer.ts:1187` or `1205` and issued
nothing. The accumulator is never reset on the skipped path, so it carries a
stale `pendingEntityTris` forward and adds it again. It reached 1,109,640 in
about 130 frames.

So the frame was advertising triangles for draws that had not happened, for as
long as the early exit has been firing. That is the same shape as the two bugs
already found this session: `arrayLength(&lights)` reporting the allocation, and
`byDay` meaning two different things. **Counted, not issued.**

## Which exit fires

`issuedEntityDraws` empty with the app reporting `frameCount=134` and
`framesInFlight=2` means `render()` returned before `recordGBuffer` on every
observed frame. Of the two:

- `if (!this.targets) return;` (`renderer.ts:1187`) — the canvas has never been
  sized in this headless path, and is the more likely of the two.
- `if ((capturePending || overBudget) && ...) { skipped++; return; }` — with
  `framesInFlight: 2` against a low `MAX_FRAMES_IN_FLIGHT` at 6.6 fps, this is
  also permanently true.

I could not separate the two from the debug surface (`skipped` is not on the
`stats()` hook, and `targetsW` is not exposed, so my probe of it returned
`undefined` rather than a value). **Separating them is developer 1's one probe**:
expose `skipped` and whether `this.targets` is set, and read both at the same
frame. Everything else follows from that.

## The handover, in one line

The counter pair that disagrees is `stats.entityDrawCalls` (correct, 0) against
`stats.entityTriangles` (an unbounded stale accumulator, `main.ts:438`). Until the
exit stops firing, **no crowd has been drawn in any capture this session**, and
every "the street is empty" observation in rounds 6-11 describes a draw-path
fault, not an occupancy fault.

## What the method could not see — the actual lesson

Nine mechanisms were eliminated across rounds 5-9. Every one of them was a real
mechanism in the code, measured with a control, and every one of them moved the
metric by about one percent or not at all. All nine were investigating a crowd
that was never submitted to the GPU.

The failure was not the hypotheses. It was that **every measurement was taken
upstream of the draw call.** Counts, ratios, distance profiles, funnel stages —
all of them describe the simulation, and the simulation was healthy. The number
that mattered was `entityDrawCalls: 0`, sitting in the capture JSON since round 7,
in a field nobody had asked what it meant.

Nine eliminations is a result, not an embarrassment, because each one narrowed
the search and the tenth measurement was the one that ended it. It is worth
recording precisely for that reason: **an instrument that only observes one side
of a boundary will produce a coherent, well-controlled, entirely wrong theory.**
`docs/OCCUPANCY.md` should be read as the proof of that, not as a list of
mistakes to avoid repeating.


---

# Round 12 — the crowd is drawn. It reads as blocks.

## The sentence that changed

The crowd is **drawn**: 2454 to 2550 agents in view, `entity.drawCalls` 5,
2,776,644 entity triangles, at seed 6191639 with `delivered: 1410`. What remains
between R1 and done is **legibility and distribution**. No simulation change will
move it.

Nine mechanisms were eliminated across rounds 5-9 and the thing they were
investigating was never the problem. That is the **method's limit**, and it is
worth more than the mechanisms: every instrument was upstream of the draw call,
and a coherent, well-controlled theory built entirely from upstream measurements
is still wrong.

## What the frames actually show

`01d-street-crowd.png` — the street is **empty**. Not one pedestrian is visible
anywhere: not foreground, not far end, not on either pavement. The provenance
records `entity.inView.inside: 0` against `total: 2454`. The crowd is submitted
and none of it lands in frame.

`01e-crowd-closeup.png` — the crowd **is** there, and it is legible as *stuff*.
Two rows of dense coloured masses on the left and right pavements, the
carriageway completely empty between them. Each mass is roughly **50 px tall and
40-70 px wide** — wider than tall. A 1.7 m pedestrian is about 3:1 narrow. These
are not reading as people; they are reading as **market stalls or counters**, a
continuous row of them, with no gaps.

So the failure is now precise and it is a rendering-of-population fault:

1. **Silhouette**: the pedestrian footprint is far too wide for its height, so a
   cluster of them reads as one horizontal block.
2. **Distribution along the street**: a continuous band, not groups with gaps —
   the exact merge `LEGIBILITY_TARGETS.md` §2 describes as "a continuous
   orange/grey band ... fails regardless of instance count", and the
   `PITFALLS.md` §9 clump trap approached from the other side.
3. **Lateral**: they are correctly on the pavements and absent from the
   carriageway. That part is right and should not change.
4. **Longitudinal**: the far end of the street carries nothing at all. The
   160 m seeding question is still open and is now the obvious suspect.

## Night contrast — the ambient-invariance result is CONFIRMED

Measured in frames that have lights in them (`delivered: 1410`), which is the
first time this has been possible:

| frame | best local figure/ground | threshold |
| --- | --- | --- |
| `08-night-lanterns` | **1.15:1** | 2.5:1 |
| `09-market-down` | **1.05:1** | 2.5:1 |

**The theory stands.** No palette can lift this, because `skyIrradiance`
multiplies coat and deck by the same factor and the ratio is ambient-invariant
by construction. The prediction was that adding real lights would not lift it,
and 1414 delivered lights moved the number *down* (1.28 -> 1.15), which is what
an ambient-invariant ratio plus a darker frame does.

That leaves exactly the three options, and the third is now the live one: **the
crowd has to be dense enough that legibility comes from grouping rather than
from contrast.** Contrast is a dead end on this path and has been measured twice.

## What R1 says now

`docs/ROADMAP.md` R1 wants "a density where the far end of the street is visibly
busy" and "people on the pavements". The second is met — they are on the
pavements, in numbers, and they were there in every frame. The first is not:
**in the street frame, 0% of the visible street length carries a legible figure,
and the 17% far-end band named in `LEGIBILITY_TARGETS.md` §3 is empty.** In the
close-up the mass is legible but does not read as people.


---

# Round 13 — the pose is not looking at its subject

## R13.1 `01d-street-crowd` is empty because of the pose, not the crowd

Provenance for the certified frame, self-contradicting on its face:

```
camera.position         [910.85, 2.65, 13.49]        <- street level, correct
camera.viewRayPoint400m [827.65, 1.87, 404.74]       <- looking along the street, correct
source.population       { n: 2454, cx: 1053, cz: 4, spread: 217 }
source.distanceToCrowd  10.1                         <- the claim
```

The camera is at (910.85, 13.49). The crowd centroid it reports is (1053, 4).
Distance between them is **142.3 m**, not 10.1 m. Either the pose is not placed
relative to the centroid it reports, or the centroid is stale, or
`distanceToCrowd` measures something else entirely. **All three are the same
failure the session has already paid for twice** — a quantity that is true at the
buffer and false at the frame.

A live reading of the same fields confirms the app can put the camera nowhere
near the crowd at all:

```
pos   [1119.85, 434.45, 166.23]     <- camera 434 m up
look  [ 315.17, 326.63, 124.97]
crowd samples  [[1101.7, 0.35, 12.2], ...]   <- people at y = 0.35, on the ground
```

Nothing can be inside that cone. `inView.inside = 0` is **not lying** — it is
reporting a camera 434 m above a crowd standing on the pavement. The earlier
report of *"inView puts 810 instances in the cone at 17.8-107.8 m"* is not a
contradiction: it is the same field, computed correctly, against a camera that
was actually pointed at the crowd.

**So `inView` is the seventh diagnostic to be suspected and the first to be
cleared.** The fault is upstream of it, in pose derivation. Until
`derivePose` is shown to place the camera relative to the centroid it reports,
**no number measured from `01d-street-crowd` — including my 0% legible-street
figure — can be trusted.** That retracts the round-12 figure as *evidence about
the crowd*, though the close-up reading stands, because that frame has people in
it and I could see the shape of them.

## R13.2 Mesh spec for developer 1 (hand-over, not an edit)

Owner: the `pedestrian` entity factory in `src/render/citymesh.ts`. Not edited.

**Measured current silhouette**, street level, `01e-crowd-closeup.png`, native
1600x900:

- height **~50 px**, width **40-70 px** — i.e. roughly square, at worst 1.4:1 wide.
- a 1.7 m human is about **3:1 narrow**. The current footprint is the wrong shape
  by a factor of two in the wrong direction, which is why clusters read as market
  stalls rather than people.

**Required silhouette**, in order of what buys legibility at 20-24 px (per
`docs/LEGIBILITY_TARGETS.md` §2, and explicitly *not* by chasing head geometry
below 25-30 px):

| # | Requirement | Why |
| --- | --- | --- |
| 1 | Overall **3:1 narrow** at 1.7 m: ~0.55 m across at the shoulders | a square mass cannot read as a biped at any contrast |
| 2 | **Shoulders wider than waist**, a visible narrowing at ~0.85 of height | the single strongest biped cue, and it survives at 20 px where a head does not |
| 3 | Head **~4 px across at 32 px height**, on a **>=1 px neck** | acceptance sample in LEGIBILITY_TARGETS §2 |
| 4 | **Gap between the legs** below the hip, so the silhouette is not a slab at 20 px | a solid slab merges with its neighbour into one band |
| 5 | Fewer, narrower boxes overall | current box count is the reason the silhouette is wide |

**Group-level consequence, which is the other half of this.** At 40-70 px wide
adjacent agents *merge* even when correctly proportioned. Meeting requirement 1
alone will roughly halve the projected width and buy separation, but the 2 px
background gap still has to come from placement — that is round 13's grouping
work and it is mine, not developer 1's.

## R13.3 What was not measured

Longitudinal extent and the 160 m question, and the grouping separation
histogram. Both are open. The round-12 reading that the far end of the street
carries nothing is a **visual** observation from a close-up frame, not a
measured profile, and it should be re-taken once the pose is trustworthy.

## The method's limit, said once

Nine mechanisms were eliminated across rounds 5-9. Each was real, each was
measured with a control, and each moved its metric by about one percent. They
established that **placement, retirement and goal selection are sound** — which
is a true and useful result, and is why the remaining fault is silhouette and
extent rather than simulation. The next session should not re-run them.


---

# Round 14 — the pose was right; the camera left it

## Correction to round 13

I reported that `01d-street-crowd`'s provenance was self-contradicting: "the camera
is 142.3 m from the centroid it reports". **That was wrong, and the correction is
the more useful half.**

`derivePose` computes `distanceToCrowd` as
`hypot(position - pop.cx/cz)` (`diagnosticposes.ts:246`) and places the camera
**10.1 m** from the centroid. Re-derived at round 14:

```
street-crowd   distanceToCrowd reported 10.1   recomputed 10.1   MATCH
crowd-closeup  distanceToCrowd reported 28.1   recomputed 28.1   MATCH
facade-base    distanceToCrowd reported 10.1   recomputed 10.1   MATCH
```

The reported distance is **true**. The camera in the captured frame was 142 m
from where `derivePose` had put it. So the fault is entirely the harness's
**held-camera** problem -- the pose is requested, the camera keeps flying -- which
is exactly what developer 1's requested-vs-held check addresses.

`inView` is therefore cleared for the second time, and for the same reason: it
reports the cone the camera is actually pointing down, and the camera was not
pointed at the crowd.

## What was added: a pose that cannot see its subject now refuses

`derivePose` returns `ok: false` with a reason when either bound fails:

- **eye height outside 0-12 m above the deck.** A camera at y=434.45 has been
  reported against this function's output; `eye = GROUND_Y + spec.eye` bounds it
  internally, and the bound is now asserted rather than assumed.
- **the crowd misses the view corridor**, measured as perpendicular distance from
  the centroid to the view axis against `reach + spread`.

The subject is **not** the centroid. That was my first attempt and it was a false
positive: `street-crowd` looks *along* the street, so the centroid sits ~82 deg
off-axis by design, and testing the centroid refused a legitimate corridor pose.
Corrected to use the spread, with the control:

```
real spread 217 m   street-crowd  ok   subjectInView=true
tight spread 5 m    street-crowd  REFUSED: crowd is 10.0 m off the view axis
                                at 1.4 m, outside the 6.2 m reach
tight spread 5 m    crowd-closeup ok   (it aims at the centroid by construction)
```

The refusal path fires on a blind pose and stays quiet on a legal one. Asserted in
`src/world/__selftest_market.ts`, including that the reported distance matches a
recomputation.

## Still open, and not to be re-run

The longitudinal `viewRadius` question and the grouping separation histogram were
not measured this round. Nine well-measured eliminations across rounds 5-9 all
sat upstream of the draw call, and the thing they investigated was never the
problem; they established that placement, retirement and goal selection are
sound. **Do not run them again.** What remains is the silhouette spec handed to
developer 1, the longitudinal extent, and grouping.


---

# Round 12b — two lying diagnostics, and the two open questions answered

## The crowd is drawn

2547-2550 in view at street level, 3.7M entity triangles. **Lateral distribution is
correct**: on the pavements, absent from the carriageway. What remains is
**silhouette plus longitudinal extent**. Nine well-measured eliminations across
rounds 5-9 all sat upstream of the draw call, and the thing they investigated was
never the problem. Do not run them again.

## Two diagnostics fixed

**`derivedPose` was stale on nine of sixteen frames.** `app.derivedPose` survived
any authored pose set after it, so `02-canyon-up` through `09-market-down-day`
carried a rule-4 line describing a camera the renderer was not in — in the exact
field whose purpose is to prove the shot was derived from live state.

Clearing on `setPose` would fix that instance and miss the harder one: a
*derived* pose also goes stale when the camera flies off it, which is how
`01d-street-crowd` was shot from 142 m away with a provenance claiming 10.1 m. So
the rule is not "was an authored pose set" but **"is the camera still there"**,
checked at publication:

```ts
poseIsHeld(camPos, posePos, tol = 2 m)   // pure, in diagnosticposes.ts
heldDerivedPose()                          // returns null unless poseIsHeld
```

Exported from the pure module rather than the app so a headless self-test can
assert it. Asserted: a camera exactly at the pose is held; 1.5 m drift is held;
**3 m drift is not; 142 m drift is not.**

**`pedestrian: ?` was a rule-5 phantom.** The harness looked for
`stats.entityDraws.find(d => d.startsWith('pedestrian:'))` and printed `?` when
absent, on every frame of every run this session. It now reports the number that
does exist (`crowd.visibleCount`) rather than a name that does not. `crowdTotal`
is likewise a phantom field name — it does not exist in `src/`, `tools/`,
`server/` or `latest.json`.

## Longitudinal: `viewRadius` IS the constraint

Measured at the derived `street-crowd` pose, seed 6191639, settled:

```
submitted            2534
inside the cone      1483
distance along view  p50 56 m   p90 88 m   p99 146 m   max 160 m
agents by distance, 40 m bins to 320 m:
                        0-40   40-80  80-120 120-160 160-200 200-240 240-280 280-320
                        361    703    399     20      0      0      0      0
```

**The furthest agent is at exactly `viewRadius`, and the 160-320 m bins are
empty.** `01d-street-crowd` looks down a street that recedes to ~400 m. So the far
end is a **seeding limit, not a placement limit**: there is nothing out there
because nothing is seeded out there.

## Grouping: there is no gap mode at all

Separation histogram for the 20-30 px band (492 in-frame figures, 17,772 pairs),
and for all in-frame figures. **A histogram, not an average**, because an average
hides exactly this:

```
20-30 px band    p1 0.1   p10 1.1   p50 6.7   p90 15.9 px
  [0-2)  17.5%   [2-4) 14.9%   [4-6) 13.2%  [6-8) 12.0%
  [8-12) 18.8%   [12-20) 21.0% [20-40) 2.6% [40-inf) 0.0%
  under the 2 px threshold: 17.5%
```

**The `>= 40 px` bin is 0.0%.** There is no gap mode in this distribution — not a
weak one, an absent one. The vision gate's condition is *"groups with deliberate
gaps"* and a continuous band with no gap mode fails it, which is exactly what was
read off the pixels in round 12. The two agree.

## More agents, or better grouping? **Grouping.**

Not a preference; it is forced by the two measurements above.

- **Raising `viewRadius` cannot create a gap.** It scales the count linearly, so
  every 0-2 px bin grows with everything else. It fills 160-320 m, which fixes the
  far end, and it produces more of the same continuous band.
- **It is also the expensive option here.** The street frames already carry 3.7M
  entity triangles at 7-8 fps and 123-140 ms/frame on an 8-core laptop. Doubling
  the radius doubles the instance count and the entity triangle load.
- **Grouping costs no GPU time at all.** Same instances, different arrangement:
  tight clusters with deliberate gaps. It creates the gap mode that is measured
  absent, and it raises the 17.5% under-2px figure by spreading the same people.

So: **use `viewRadius` only to stop clipping the far end, and spend the actual
budget on grouping.** The failure mode to avoid is doing the first without the
second, which turns a continuous band into a *longer* continuous band.

`PITFALLS.md` §9 is the trap and the histogram is the detector: a clump shows up
as mass in the `[0-2)` bin, a uniform band as the empty `[40-inf)` bin seen here.
Both must be watched; only the second is currently wrong.


---

# Round 13 — the two standing measurements, and how to re-measure them

Appended, not rewritten. Everything above is what was measured when it was
measured. This section says how to reproduce the two numbers that matter and what
they currently are.

## Reproduce

```
npx vite-node src/sim/__selftest_density.ts
```

`src/sim/__selftest_density.ts` is a **measurement, not a regression test**. It
asserts that the measurement is well formed — instances projected, pairs found,
histogram bins summing to the pair count, no agent beyond `viewRadius` — and it
prints everything else. It deliberately does **not** assert the value of the gap
bin: `0.0%` is an open defect, not an invariant, and pinning it would make a
future fix look like a regression.

## The two numbers

**1. `viewRadius` is the seeding limit.**

```
viewRadius 160 m   target 2550   live 2550   submitted 2534   inside the cone 1483
depth along view   p50 56 m   p90 88 m   p99 146 m   max 160 m
agents by 40 m bin to 320 m
  0-40:361  40-80:703  80-120:399  120-160:20  160-200:0  200-240:0  240-280:0  280-320:0
```

The furthest agent is at exactly `viewRadius`, and every bin past it is empty.
The street recedes to ~400 m. **So the empty far end is a seeding limit, not a
placement one** — there is nothing out there because nothing is seeded out there.

**2. The `>= 40 px` gap bin is empty.**

```
20-30 px band   492 figures, 17772 pairs   p10 1.1   p50 6.7 px
  [0-2) 17.5%  [2-4) 14.9%  [4-6) 13.2%  [6-8) 12.0%
  [8-12) 18.8% [12-20) 21.0% [20-40) 2.6% [40-inf) 0.0%
  merged (<2 px) 17.5%   gap mode (>=40 px) 0.0%   ->  NO GAP MODE
```

All in-frame, 1483 figures / 47,425 pairs, agrees: `[40-inf) 0.0%`.

The `>= 40 px` bin is the bin the finding rests on. Pairs that far apart are not
neighbours at all, so **a non-empty top bin is the signature of groups with
deliberate gaps and an empty one is the signature of a continuous band** — which
is what the vision gate asks for and what four rounds of reading pixels kept
seeing. `PITFALLS.md` §9 is the other failure and the histogram detects it too: a
clump shows as mass in `[0-2)`, and that bin is at 17.5%.

### A caution about this measurement, recorded because I got it wrong first

The first version of `__selftest_density.ts` ended the histogram edges at `40`,
which folds the gap-mode bin into `[20-40)` and prints **"gap mode present"** for
a distribution that has none. It did exactly that on its first run. The
`[40-inf)` bin has to exist or the number this round is recording does not exist.
This is the same class as every other error in this file: a diagnostic that
reports something other than the thing it names.

## Cross-link: R12

`docs/ROADMAP.md` R12 ("Living systems: crowd dynamics and locomotion") is the
behaviour work, and it is deliberately separate from R1's density question.
**R1 asks whether streets read occupied. R12 asks whether the occupants read
alive.** The `[40-inf) = 0.0%` finding is the standing number cited there.

## Cause is split, and both halves are open

Gate 5 measured **isolated** silhouettes at 22x9 and 23x11 px with 20 clear pixel
columns — those **clear** the separation target — while **packed** rows merge into
counter-like bands. So the density failure is two causes, not one:

- **overlapping placement**, which the empty gap bin above measures, and which
  the reviewer states will not be resolved by rebuilding alone; and
- **silhouette**, handed to developer 1 as a written spec (see R13.2 above).

Fixing the mesh alone will not move the `[40-inf)` bin.
