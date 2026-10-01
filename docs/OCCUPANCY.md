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
agent's goal must not take it behind the view plane. Nothing here has been
changed on the strength of that reading; it is the first measurement that names
a mechanism rather than eliminating one.

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