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
