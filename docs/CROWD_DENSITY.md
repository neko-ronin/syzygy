# CROWD_DENSITY.md — separation (D26), round 9

Developer 2. Branch `dev2/crowd-separation`. **`src/sim/crowd.ts` reverted to
`e96ba15`; no fix ships.** Import test → ALL PASS.

Standing instrument: `npx vite-node src/sim/__selftest_density.ts`. This round
**added world-space nearest-neighbour to it**, because pixels cannot answer R12.2
— a crowd on a line reads as 99.8% "merged" while every body is at a different
depth. That addition is kept; the simulation changes are not.

## 1. Predictions, stated before testing

| | prediction | verdict |
| --- | --- | --- |
| **P1** | separation with its own speed budget + a positional push from the **nearest** overlapping neighbour, applied last, moves NN p50 off 0.030 m and drops overlapping pairs below 99.0% | **REFUTED** — NN p50 0.030 → **0.020 m**; overlapping **99.0% → 99.9%** |
| **P2** | the ≥40 px gap mode does not move — separation is not grouping | **HELD** — 0.0% before and after, both bands |
| **P3** | the crowd may spread off the line as a by-product of repulsion | **NOT OBSERVED** — the crowd remains a line |

## 2. Baseline, on the standing instrument

```
BODY SEPARATION (world, n=2550)
  nearest-neighbour p10 0.007  p50 0.032  p90 0.082 m
  bodies inside another body's 0.45 m shoulder: 99.9%
  merged (<2 px) 19.0%   gap mode (>=40 px) 0.0%  -> NO GAP MODE
```

**99.9% of bodies are inside another body's shoulder width.** Nobody has
measured avoidance before this round; this is the first unconfounded number, and
it is the floor R12.2 asks for — not a target to tune toward.

## 3. What was implemented, measured, and not shipped

1. **Separation gets its own speed budget.** It was being throttled by the crowd
   `jam` factor to ~0.10 m/s at `n=256`, so a packed street could not unpick
   itself. Split into `seekSpeed` (negotiable) and `sepSpeed` (not).
2. **A positional push from the single nearest overlapping neighbour, applied
   last** so nothing downstream cancels it. One neighbour, not a sum: a sum
   cancels by symmetry in a packed blob and leaves interior bodies with nowhere
   to go, which is why two earlier attempts moved NN by about a centimetre.

Result: **NN p50 0.020 m, overlap 99.9%.** Reverted.

3. **Grid staleness, tested and refuted.** `this.grid` is rebuilt only every 7
   frames while agents move every frame, so `cellRange` returns a stale
   neighbourhood that might not contain the true nearest neighbour. Rebuilt it
   every frame: NN p50 **0.022 m**, overlap **99.8%**. No change. The stale grid
   is not why separation fails.

## 4. The finding, and the next step

The push this round applies is `(0.45 - d) * 0.5`. With bodies **0.032 m**
apart that is a **0.21 m displacement per frame** — a body should be thrown
clear in three frames. **The measured distribution does not move.**

That is the same signature as the standoff in rounds 6–8: an active correcting
term, ample authority, and no change. Whatever receives the correction is not
keeping it. The next step is therefore the same shape as round 8's, and it is
one counter:

**Measure the separation push on a single agent — its `d`, the computed `push`,
and `f[o+F.x]` immediately before and after the write.** If the write lands and
the next frame's value has moved back, the restorer is the same one that pinned
the lane standoff, and one mechanism explains both. If the write does not land,
the bug is in this file and is worth five minutes.

Do **not** add a third separation variant before that is answered.

## 5. Scene-layer notes (notes, not code)

Per D26 the scene layer is a later stage. Two places where the simulation
obviously wants a scene concept, recorded and not acted on:

- the **Market attractor** — a stall front with a queue and dwell, rather than a
  point every agent walks to;
- **crossings** — a wait state at a junction, which is also where the lane
  question in D25/D26 would actually be answered.

## 6. Ruled out for this lane

Separation speed budget · positional push from nearest neighbour · hash-grid
staleness · goal-side assignment (round 7) · waypoint-side assignment (round 8).

## 7. Standing numbers

| quantity | value |
| --- | --- |
| nearest-neighbour p50 | **0.032 m** |
| bodies inside a 0.45 m shoulder | **99.9%** |
| gap mode ≥40 px | 0.0% (both bands) |
| merged <2 px | 19.0% all-in-frame, 18.9% in the 20–30 px band |
| z IQR about centroid | 0.04 m (still a line — not this lane's blocker) |
| footway balance | 94.6% left |

No visual claim. The frame gate is running in parallel; when it lands it judges
the frame, not this report.


---

# Round 9 addendum — why separation cannot work as written

Round 9's work was stranded on `dev2/crowd-separation` and did not reach `main`,
which is why this round was re-issued. Recovered by fast-forwarding `main` to the
branch (safe: `main` had no commits the branch lacked). Baseline re-confirmed
**unchanged** on current main after the R11 reskin:

```
  nearest-neighbour p50 0.032 m
  bodies inside another body's 0.45 m shoulder: 99.9%
  gap mode (>=40 px) 0.0% (both bands)
```

## The blocker, measured, and it is local

```
  neighbour count n   p10 178  p50 256  p90 256  max 256
  at the 256 cap      72.9% of agents
  jam = 1/(1 + n*0.09*social)     p50 0.087
  SEPARATION SPEED CEILING = pace * jam   p50 0.113 m/s
```

Two independent facts, both read out of the running sim without editing it:

1. **The neighbour list is saturated.** `cellRange` caps at 256, and **72.9% of
   agents are at that cap**. For those agents the separation sum — and any
   "nearest neighbour" chosen from it — is computed over an arbitrary subset.
   The true nearest neighbour is frequently not in the list.
2. **Separation is throttled to 0.113 m/s.** `maxSpeed = pace * jam`, and the
   jam factor is there to make a dense crowd *look* dense by slowing
   goal-seeking. It slows separation by the same mechanism.

For scale: the lane standoff runs at **1.34 m/s** and the lane hold at
**1.4 m/s**. Separation is **~12x too slow** to affect anything, and for
three agents in four it is not even looking at the right neighbours.

## Why round 9's attempt moved so little

Round 9 separated the speed budget but **left the saturated neighbour list**.
It then tracked "the nearest overlapping neighbour" *within that arbitrary
256-subset*. Pushing away from a neighbour that is not actually the nearest
resolves an overlap that may not be the binding one, and pushes into a third
body. That is a coherent explanation for a 1 cm move and no distribution change.

## Next step — two local changes, no global arrangement

In order:

1. **Give separation a small, uncapped neighbourhood.** A dedicated query with a
   radius near `BODY_SEP` (0.45 m), not the 8 m `cellSize` search capped at 256.
   This is the one that matters: separation should see the bodies it is actually
   colliding with.
2. **Give separation its own speed budget** so the jam factor stops applying to
   it (`seekSpeed` for the goal, `sepSpeed` for avoidance).

Neither is a global placement pass, and neither touches the lane hold,
`F.lateral` targets, goal selection, or the z-IQR assertion. This is D26's frame:
local rules, a floor of "bodies do not end up inside one another", and a
population that can spread because separation pushes it apart rather than
because something arranged it.

**Floor to judge against, not a target:** nearest-neighbour p50 must exceed
0.45 m and the overlapping fraction must fall well below 99.9%. Report both
before and after with `npx vite-node src/sim/__selftest_density.ts`.

## Scene notes (unchanged, still not code)

The Market attractor wants a stall front with a queue and dwell rather than a
point every agent walks to; crossings want a wait state.

---

# Round 10 — the write proof did not produce a trustworthy answer

Developer 2. Branch `dev2/crowd-writeproof`. **`src/sim/crowd.ts` reverted to
its committed state; nothing ships.** Import test → ALL PASS. No instrumentation
left in the tree.

The round was one instrument: prove `f[o+F.x]` is written and that the write
persists across the frame boundary, before any separation is computed again. **I
could not obtain it, and the reason is my instrument, not the crowd.**

## What the instrument did, and why I am not reporting it

Three materially different definitions of "persistence", each run separately:

1. compare this frame's entry against **this frame's own write** — wrong by
   construction, that measures movement *inside* `stepAgent`;
2. compare this frame's entry against the **previous** frame's write;
3. same as (2), but record the stored **float32** field value instead of the
   float64 local, to remove float32 rounding as a confound.

**All three produced byte-identical output** — `0 persisted / 312 changed`,
worst `|dx| 1.05e-2`, worst `|dz| 2.18e-4`, for every version. Identical numbers
under three different definitions is the tell: the output is not coming from the
code as written, or the comparison is degenerate in a way I cannot see from
outside. **A persistence result I cannot reproduce under a changed definition is
not a result**, and I am not reporting it in either direction.

## What *is* trustworthy, because it held across all three runs

```
  re-seeds during a 39-frame window            : 0
  a single frame's write moves one body by     : 0.5 – 10.5 mm
  largest single-frame movement               : |dx| 1.05e-2 m, |dz| 2.10e-4 m
```

- **Zero re-seeds**, so `rebuildSlices` → `seedAgent` is **not** writing position
  during the window. That eliminates the one known writer outside `stepAgent`,
  and it is a real negative result.
- **A body moves 0.5–10.5 mm per frame.** That is the size of the effect any
  separation change has to compete with, and it is consistent with the standoff
  (1.34 m/s of goal-seeking cancelling 1.4 m/s of lane hold).

## Why the frame gate's verdict and this instrument agree

`docs/VISION_ROUND9.md`: *"The crowd's collective silhouette belongs to street
construction, not independent grounded people."* Nobody has seen people here,
because 99.9% of bodies are inside another body's 0.45 m shoulder. That number
was measured cleanly in round 9 and re-confirmed on current main. The reviewer's
marker-field disqualifier stands after separation, exactly as predicted.

## Next step — the same instrument, made trustworthy first

Do **not** compute another separation variant on top of an unproven pipeline.
The next agent should:

1. **Make the persistence probe self-checking.** It must print, for one agent,
   the exact triple `(entry, written, prevWritten)` per frame for a handful of
   frames, unaggregated. If those triples do not change when the comparison is
   changed, the probe is reading the wrong thing and that is visible at a glance.
   Rule from this session, twice applied: a ratio or a verdict is only as good as
   the arithmetic producing it, and a probe that returns identical numbers under
   changed inputs is broken until proven otherwise.
2. Once `entry[N] == written[N-1]` is demonstrated for at least one agent, run
   it across many agents. Only then is separation's first fair test available.
3. The floor to judge it by is unchanged and is not a target: **bodies do not end
   up inside other bodies** — NN p50 above 0.45 m, overlapping well below 99.9%,
   read with `npx vite-node src/sim/__selftest_density.ts`.

Separation's own blockers remain as recorded last round and are still the
likely cause: the neighbour list is saturated for **72.9%** of agents (capped at
256), and the jam factor caps separation's speed at **0.113 m/s** against a
1.34 m/s standoff.

---

# Round 11 — the throttle was real, and it was the smaller of the two defects

Developer 2. Branch `dev2/crowd-sep-budget`. **`src/sim/crowd.ts` reverted;
nothing ships.** Import test → ALL PASS. No instrumentation left.

## 1. The thing I buried, written down honestly

I named this obstruction in **round 3** and did not remove it. Measured then:
separation throttled to 0.10 m/s against the hold's 1.4 m/s authority —
"13x too slow to win a single argument". Measured in round 9: **0.113 m/s**
against a **1.34 m/s** goal-seeking pull. Eight rounds later, through a reframe,
two reverted variants and one withdrawn probe, the operative obstruction was
the same one I had already identified. Two variants were reverted fighting a
throttle I knew about. That is worth recording plainly rather than leaving in a
commit message.

## 2. Item 1 — separation gets its own speed budget. Measured; not shipped.

`seekSpeed = pace * jam` stays negotiable; `sepSpeed = pace * 0.6` does not.

```
                              before      after
  NN p50                        0.032      0.021 m
  bodies inside a 0.45 m shoulder  99.9%     99.8%
  merged <2 px, all in-frame      19.0%      25.6%
  merged <2 px, 20-30 px band     18.9%      37.8%
```

**Reverted.** NN p50 moved the right way and overlap did not — and screen-space
merging got substantially **worse**, which is the same signature as the two
variants already reverted. Un-throttling a force that is aimed at the wrong
bodies just moves bodies faster in the wrong direction.

## 3. Item 2 — the 256 cap is the bigger defect, and it is not a cap

```
  agents at the 256 cap                              : 100.0%
  true nearest neighbour        p50                  : 0.000 m
  nearest neighbour IN THE BUFFER p50                : 3.396 m
  buffer misses a much closer neighbour (>1.5x)     : 100.0%
  mean ratio buffer / true                           : 90.7x   (worst 5443.8x)
```

**For 100% of agents the buffer contains no near neighbour at all.** Its closest
member is **3.4 m** away; the true nearest is **0.000 m**. Separation has been
computed, correctly, against a set of bodies that are nowhere near the body it
is attached to. That is why un-throttling made things worse: more authority,
same wrong aim.

**And it is not a cap problem.** `cellRange` scans whole cells of `cellSize`
(8 m) and fills the buffer in cell order until `max`. At the measured density the
crowd is ~14 agents/m², so a single 8 m cell holds ~900 bodies and any buffer
smaller than that is saturated by arbitrary order. Raising `max` does not fix a
quantisation that coarse — it only buys a larger arbitrary subset.

**This also explains round 9.** The nearest-overlapping-neighbour push initialised
`nearD2` to `BODY_SEP²` (0.45 m). With the buffer's nearest at 3.4 m that test
was never met, so `nearJ` stayed `-1` and **the push never ran at all**.

## 4. What this means — and it is D26's actual finding

Separation was never the problem, and neither was its authority. **A cell-based
neighbourhood query cannot see the nearest neighbour at this density.** The
nearest bodies are inside the same cell as everything else, and the buffer keeps
the first 256 in storage order rather than the closest.

The fix is therefore not a bigger buffer and not more authority. It is a
**finer local structure** — which is precisely what D26 named as the first layer
(Lenia-style occupancy fields) and why that layer is there. A separation term
sized for a crowd at 0.5 agents/m² is being run on one at 14.

## 5. Next step — two, in order, both local

1. **Make the neighbourhood query distance-ordered within the small radius that
   matters.** A dedicated query at ~`BODY_SEP` radius that keeps the *closest*
   few, rather than the first few in cell order, is cheap and is the minimum
   change that makes separation aim at the right body. Verify by re-running the
   cap probe: `nearest in buffer` must fall from **3.396 m** to within a small
   multiple of the **0.000 m** truth. That number is the acceptance test for
   this step and it is not a target to tune toward.
2. **Then** re-test the speed budget from §2, which has never had a fair trial.

The write-proof probe stays withdrawn. It is not rebuilt on top of a pipeline
whose neighbourhood query is known to be looking at the wrong bodies; proving
persistence is still correct, but it is worth nothing until separation can see.

## 6. Floor status

Unchanged: NN p50 **0.032 m**, **99.9%** of bodies inside another body's 0.45 m
shoulder, gap mode ≥40 px **0.0%**. Bodies still do not end up inside one
another, so R12 sub-problem 2 is **not** met. The reviewer's marker-field
disqualifier stands, and separation alone has not yet been given a fair test.
