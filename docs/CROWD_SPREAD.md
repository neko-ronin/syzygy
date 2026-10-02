# CROWD_SPREAD.md — the crowd renders, and it is a line

Developer 2, round 3. Supersedes the round-3 brief (avoidance + flow); that work
was **reverted uncommitted** — see §6.

Re-runnable measurement: `npx vite-node src/sim/__selftest_spread.ts`.

---

## 1. What this is not

**There is no pedestrian rendering bug. There never was.** Saying "rendering bug:
FIXED" would be the single most misleading thing this project could write, and it
would be false.

What is true, and what the frame shows: **the crowd was always rendering — 2550
pedestrians, in the `entityMeshes.pedestrian()` cloth palette, correctly
transformed and correctly drawn — but it had no lateral spread. All 2550 stood on
a 1-D line, and a smear of bodies reads as an empty street.**

The two sessions that reported "zero visible pedestrians" were reading the frame
correctly and the frame was showing a line of bodies, not figures. That is a
failure of the evidence, not of the reviewers: they were asked "are there people
here?", looked, saw no *figures*, and said no. The correct report was "there is
something on the kerb and I cannot identify it", and the thing on the kerb was
2550 people standing shoulder to shoulder on a line.

## 2. The measurement

`population()` at pose `street-crowd`, seed 6191639, 2550 agents. Distribution
about the crowd centroid, as interquartile range:

| axis | IQR | reading |
| --- | --- | --- |
| x − cx | **59.07 m** | spread along the street |
| y | 0.00 m | all on the deck, correct |
| **z − cz** | **0.04 m** | **4 cm — a line** |

Street tangent averaged over agents: **(0.880, 0.099)**, bearing 6.4°. The street
runs along X, so **Z is the lateral axis**, and the crowd's entire lateral extent
is 4 cm. Perpendicular offset from the carriageway centreline reads wider only
because the centreline's own position drifts along the street — not spread.

The sidecar's four `crowdSample` rows at `z = 0.35` were not a small sample of a
spread population. They were the population.

## 3. What is ruled out, by control

| candidate | verdict | what killed it |
| --- | --- | --- |
| `F.lateral` never reaches the instance transform | **refuted** | The transform is doing its job: it writes `F.x/F.y/F.z`, and the agents' *positions* are the line. The lateral offset is a constraint on position, not a field the transform should carry. Routing it into the transform would move rendered bodies without moving the sim. |
| The population is being churned/re-seeded onto a line | **refuted** | Churn at the boot pose: **0 retired, 0 seeded over 30 frames.** The crowd is stable. |
| The pavement hold collapses them | **refuted by control** | With the hold's correction set to **zero**, z IQR = **0.01 m** — *tighter* than with it on (0.04 m). Disabling the constraint does not spread the crowd. |

## 4. Where it actually comes from

A time series at the boot pose settles "seeded or walked into":

```
  frame    z IQR    x IQR
      5     0.158     72.58     <- 5 frames in, before any meaningful walking
     10     0.157     65.06
     30     0.153     66.51
    120     0.158     65.33
    300     0.151     64.49
    600     0.147     60.78
```


**The line exists at birth.** z IQR is 0.158 m at frame 5 and never meaningfully
moves. The walk does not make it; the seeder makes it.

Instrumenting `seedAgent`, accumulated over 6301 seeds:

```
  placed.width    = 32.15 m      (the arterial, correct)
  placed tangent  = (0.268, 0.364)
  lat (footway)   = -5.18 m      (intended: side * (width/2 + 1.9) = +/-17.98)
```

The seeder computes a 32 m street and a ±18 m footway offset, and the result is a
0.15 m line. **Intent and output disagree by more than two orders of magnitude.**
That is the localisation: `seedAgent`'s group placement at `crowd.ts:975-994`
(`d`, `lateral`, `snapToStreet`, and the `nx/nz` footway projection).

I have bounded the defect and named the code. I have **not** fixed it this round,
because I could not get a fix past measurement, and an unvalidated change to the
highest-value file in the project is worse than a measured, open defect.


## 4b. Incident: I broke another agent's round, and the lesson

Mid-round, developer 3 hit `ReferenceError: SEP_SHARE is not defined` at runtime
from `src/sim/crowd.ts`, while pinned tsc reported the whole tree clean.

Cause: my own uncommitted round-3 avoidance work, sampled in the window before I
reverted it. `grep` now finds none of `SEP_SHARE`, `BODY_SEP`, `LANE_OFFSET`,
`HOLD_GAIN`, `HOLD_CEIL` anywhere in `src/`; `crowd.ts` is byte-identical to
HEAD (`e96ba15`); and `npx vite-node src/sim/__selftest.ts` reports **ALL PASS**.

The generalisable part is the part that cost the round: one of my constant-block
edits emitted an `Auto-prefixed bare body row(s) with +` warning, which is
precisely where a malformed declaration survives typecheck and throws on import.
**A green `tsc` is not an import test.** Under concurrent edit, `vite-node` the
module that uses the file — a real import, not a typecheck — before assuming the
tree is usable by another agent.

I also kept an in-flight, unvalidated change to `crowd.ts` in the shared working
tree across many turns and several long probe runs. That is the behaviour to
stop: an experiment belongs on a branch or behind a commit, not live in a file
other agents are running against.

## 5. Standing numbers, for the next session

Do not re-derive these; re-run the command at the top.

| quantity | value |
| --- | --- |
| population | n = 2550, seed 6191639, pose `street-crowd` |
| `viewRadius` | 160 m |
| x − cx IQR | 59.07 m |
| **z − cz IQR (lateral)** | **0.04 m** |
| y IQR | 0.00 m |
| street tangent | (0.880, 0.099), bearing 6.4° |
| `F.lateral` targets | p5 −21.6, p50 −7.9, p95 +21.9 (IQR 29.3 m) |
| \|F.lateral − current lateral\| | p50 18.7 m |
| churn, 30 frames | 0 retired / 0 seeded |
| nearest-neighbour, 3D | p50 0.030 m; 99.0% of bodies inside another's 0.45 m shoulder |
| lateral speed | p50 0.28 m/s against a ~1.4 m/s walk |
| gap histogram (all in-frame) | merged <2 px **19.0%**, gap mode ≥40 px **0.0%** |
| gap histogram (20–30 px band) | merged <2 px **18.9%**, gap mode ≥40 px **0.0%** |

The last three rows are R12's numbers, and they are **not** independent of the
spread defect: with every body on a line, nearest-neighbour distance is a
statement about the line, not about avoidance. They should not be read as an
avoidance result until the spread is fixed.

## 6. The avoidance and flow work — measured, then reverted

Started before the supersede, kept because the numbers are informative and the
negative result is worth not repeating.

Measured first, at frame 30 — before any locomotion could have caused it:

```
  NN p50 = 0.032 m        99.8% of bodies inside 0.45 m
```

Giving separation its own speed budget (it was being throttled by the crowd `jam`
factor to 0.10 m/s, 13x too slow to beat the hold's 1.4 m/s authority), then
adding a positional overlap pass applied after the hold:

| | before | after |
| --- | --- | --- |
| NN p50 | 0.030 m | **0.021 m** |
| NN p50 (with positional pass) | | **0.019 m** |
| bodies overlapping | 99.0% | **98.4%** |
| lateral IQR at frame 600 | 3.17 m | 7.08 m |

**Prediction P2 (avoidance moves separation and the mode) was REFUTED.** Roughly a
centimetre, and the overlap rate barely moved. The orchestrator's instruction
stands and is now measured: *this tells us whether grouping or avoidance is the
binding constraint* — **grouping is**, and more specifically the seeder's line.

All of it was reverted (`git checkout -- src/sim/crowd.ts`) before this report. No
unvalidated avoidance change ships. `crowd.ts` is untouched from `e96ba15`.

A keep-right lane preference was also tried and produced a wider band at the boot
pose (lateral IQR 3.17 → 10.34 m at frame 600) but did not survive to the settled
pose (1.16 m). Recorded as measured, not adopted.

## 7. Two harness fixes (granted)

**`tools/capture.mjs` — the held-pose check was vacuous for every derived pose.**
`requested` was built from `pose.position`, a static config value that is `null`
for the whole derived 01d/01e/01f family. So `d === null`, the agreement suffix
never printed, and the check could not fail — `requested: {position: null}` next
to a `PASS`. That is PITFALLS §20's exact shape, recurring on the family of poses
that most needs the guard. Now it checks against what was actually derived
(`stats.derivedPose`), labels which source it used, and **throws** when a derived
pose has no live derivation — `heldDerivedPose()` returns null once the camera
drifts off, which is exactly when the frame is no longer the frame the pose
describes.

**Derived-pose provenance goes stale, now recorded honestly.** A derived pose is
computed once, from a population that is usually still filling; by capture time
that crowd has moved 72 m. `requested` now carries both
`populationAtDerivation` and `populationAtCapture`, so the rule-4 number cannot be
mistaken for a live one. This records the limit rather than removing it: the real
fix is to re-derive after warm, which is unvalidated and not attempted.

## 8. What is open, and what must not be claimed

- **The spread defect is open.** Named and bounded: `seedAgent`, `crowd.ts:975-994`.
- **This is not a closed row.** R1's D7.1 names the failure this fixes the
  precondition for — "a repetition that reads as fence posts" — and fixing the
  spread makes that judgement *possible*. It does not make it pass.
- **No visual claim is made here.** This is a CPU measurement round. When the
  spread is fixed, the frame has to be judged by a reviewer who did not implement
  it (DESIGN.md §6). A green histogram beside an unjudged frame is not a closed
  row, and this project has spent nine rounds once already mistaking a moved
  proxy for progress.
- Once the crowd is genuinely spread and visible, the reviewer's named first
  failure is a counter-like band of overlapping bodies. The nearest-neighbour
  numbers in §5 say that risk is real: 99% of bodies currently overlap. **The
  spread fix will make that visible rather than fix it.**

## 9. Platform note

Measured under load average 128–150 with 89 MB unused RAM. Every number here is a
**count, distribution or percentile**, which stay valid under contention. **No
millisecond, fps or wall-clock figure is reported**, because it would be measuring
the box rather than the crowd. No `RangeError` or killed process was hit.