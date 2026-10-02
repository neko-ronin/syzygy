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

# Round 4 — the seeder is exonerated; the hold is exonerated; the crowd is still a line

Developer 2. Worked on branch `dev2/crowd-spread`; **`src/sim/crowd.ts` is
byte-identical to `e96ba15` and nothing is shipped.** Import test
(`npx vite-node src/sim/__selftest.ts`) → **ALL PASS**.

## 1. Headline: still no fix, and the localisation moved

I could not get a fix past measurement. I am not shipping one. But round 4
eliminated two more candidates and **corrected one of round 3's own numbers**.

## 2. Round 3's "non-unit tangent" lead was wrong — retracted

I suggested `|placed.tangent| == 1` might be the bug. **It is not.** I had
averaged `placed.tx/tz` over 6301 seeds pointing in many different directions;
the mean of unit vectors that disagree has magnitude < 1 for entirely mundane
reasons. Averaging directions and reading the magnitude is not a measurement of
any one vector. Do not spend a round on it.

## 3. World-z WAS flattering, exactly as suspected

You flagged that the 0.04 m world-z figure might flatter. It does — and the
reviewer's ribbon is explained by the tangent-relative view, not the world one:

| measure | value | reading |
| --- | --- | --- |
| z − cz IQR (world axis) | 0.04 m | looks like a line |
| street tangent | (0.880, 0.099), bearing 6.4° | runs along X |
| **perpendicular offset from the nearest carriageway, IQR** | **12.70 m** | the crowd is *not* a world-axis line |
| realised lateral, median | **−10.20 m** | packed on ONE footway |
| realised lateral, p95 | +8.41 m | the far footway is nearly empty |
| **footway balance (asserted)** | **left 1599 / right 91 = 94.6% left** | **this is the ribbon** |

So the ribbon is not "no lateral spread" in world axes. It is **one footway
packed and the other empty** — a single occupied band running to the vanishing
point, which is precisely what the reviewer described as a divider.

`src/sim/__selftest_spread.ts` now **asserts** this rather than only printing:

```
  FOOTWAY BALANCE  left 1599  right 91  (left share 94.6%)
  z IQR about centroid = 0.04 m
  FAIL  both footways carry a real share of the crowd (30-70%)
  FAIL  z IQR about the centroid exceeds 1.0 m (not a line)
SPREAD VIOLATIONS 2
```

Both assertions fail on `e96ba15`. That is the defect, now re-runnable in one
command and impossible to forget.

## 4. The hold is exonerated by instrumentation, not by argument

I re-applied the round-3 convergence change (`HOLD_GAIN = 0.8`, `HOLD_CEIL = 8`,
proportional with a ceiling) **on the branch**, measured, and then reverted it.

It did not work: z IQR 0.04 → 0.20 m, left share 97.9%, `|F.lateral − current
lateral|` p50 22.51 m — unchanged. So the round-2 rate limit was not the cause
either, and the change does not ship.

Instrumenting the hold settles it:

```
  HOLD: ran 1591417 times, mean |correction| 0.1004 m/frame,
        mean |error| it was asked to close 16.71 m
```

**1.59 M executions, 0.10 m applied per frame, against a 16.7 m error.** Over 600
frames that is ~60 m of correction available against a 22 m error — 3.7× more
than required. And the error does not shrink.

The hold is running, is not blocked, and is doing everything asked of it. If it
applied its correction and the error stays constant, **something restores the
offset at the same rate**. Candidates tested this round, all in the report:

| candidate | verdict | measurement |
| --- | --- | --- |
| buildings ejecting bodies onto a straight face | **refuted** | **0.0%** of active agents stand inside a footprint |
| wind advection balancing the hold | **refuted** | default `windSpeed = 4.2` → **0.015 m/frame**, 6× too small to explain 0.10 |
| the population never being re-seeded | **refuted — and round 3 was wrong** | see below |

## 5. Correction to round 3: churn is NOT zero

Round 3 reported **0 retired, 0 seeded over 30 frames** and used it to rule out
churn. That was measured at the **boot** pose. At `street-crowd`:

```
  POPULATION CHURN over 30 frames: 163 agents retired, 162 newly seeded
```

That is **~5.4 agents per frame**, so the entire 2550-agent population is
replaced roughly every **470 frames** — more than once during a 600-frame settle.
Round 3's "0" was a pose artefact and I generalised from it. The correct
statement is: **churn is negligible at the boot pose and dominant at the pose the
reviewer judged.**

This matters for the fix, because an agent needs ~150 frames of hold to cross a
22 m error at the ceiling, and the expected lifetime is ~470 — so some should
converge. But any agent seeded far from its target spends much of its life in
transit, which is consistent with a population whose *realised* distribution is
dominated by seed placement rather than by settled behaviour.

## 6. What I did not do, and why

**Task 2 — varied silhouettes.** Not attempted. It is the reviewer's predicted
next defect and it is real, but it is only visible *after* the spread is fixed,
and I cannot judge it: no frame may be taken this round, and a silhouette change
with no frame behind it is exactly the move this project has been punished for.
Doing it blind would also put a second unvalidated change into the same round.

**Task 3 — avoidance.** Not attempted, per your instruction and my own round-3
note. **Recording the P2 refutation so it is not re-attempted blind:** giving
separation its own speed budget and adding a positional overlap pass moved
nearest-neighbour p50 only 0.030 → 0.019 m and overlapping bodies 99.0% → 98.4%.
**Those figures are confounded** — with the crowd on one footway, nearest-neighbour
distance measures the footway, not avoidance. Treat them as void, not as a result.

## 7. Updated standing numbers

| quantity | value |
| --- | --- |
| population | n = 2550, seed 6191639, pose `street-crowd` |
| `viewRadius` | 160 m |
| street tangent | (0.880, 0.099), bearing 6.4° — runs along X |
| z − cz IQR (world) | **0.04 m** — FAIL (< 1.0 m) |
| **perpendicular offset IQR** | **12.70 m** |
| **footway balance** | **94.6% left** — FAIL (needs 30–70%) |
| realised lateral | p50 −10.20 m, p95 +8.41 m |
| `F.lateral` targets | p50 +7.64 m, IQR 29.32 m — the targets are *sensible* |
| \|F.lateral − current lateral\| | p50 22.51 m |
| hold execution | 1.59 M runs, 0.1004 m/frame, mean error 16.71 m |
| churn at this pose | 163 retired / 162 seeded per 30 frames (~1 replacement per 470 frames) |
| agents inside a building | **0.0%** |
| nearest-neighbour 3D | p50 0.030 m — **confounded, do not read as avoidance** |
| gap histogram | unchanged; void while degenerate |

## 8. Where this leaves it

The targets are already right (`F.lateral` IQR 29.3 m, sensibly signed both
ways). The seeder aims at both footways. The hold runs 1.59 M times with ample
authority and the error does not shrink. Nothing is blocking it that I can find
by measurement.

**The defect is now bounded to a single unexplained equilibrium:** agents are
restored to a ~16 m lateral error, on one footway, at the same rate the hold
corrects it — with buildings, wind and churn all measured and excluded as the
restoring force. That is a smaller and more precise target than round 3's, and it
is not yet a fix.

This is **not** a closed row, and no visual claim is made. The reviewer's
prediction stands and is now more precisely stated: fixing this will break the
ribbon into a row, and the repeated stance will be exposed behind it.

## 9. Process

Branched before touching anything, so no unvalidated change was ever live in the
shared tree — the round-3 failure did not recur. **Import test run before
claiming the tree usable**, and it is what caught my own module-scope
mis-declaration this round (`ReferenceError: holdRuns is not defined`) which tsc
had passed. That is the second time in two rounds that a green `tsc` hid a
runtime break, and both times the import test was what found it.

All numbers are counts, distributions or percentiles. No wall-clock figure is
reported.
---

# Round 5 — the restoring force: four candidates refuted, one contradiction sharpened

Developer 2. Branch `dev2/crowd-spread`. **`src/sim/crowd.ts` byte-identical to
`e96ba15`; no fix ships.** Import test → **ALL PASS**. All instrumentation
removed; the tree carried no experiment while the round ran.

## 1. The arithmetic, and what it predicted

Hold applies ~0.10 m/frame; offset stable at ~16 m. So the restorer writes
~0.1 m/frame, every frame, opposite the hold. That correctly excludes the
seeder (runs once) and churn (1 per 470 frames), and points at a per-frame
positional writer. Candidates tested by **instrumentation, not reasoning**:

## 2. Results — four refutations and one new datum

| candidate | verdict | measurement |
| --- | --- | --- |
| **1. the footway projection** | **refuted (round 4 control)** | correction set to zero → z IQR **0.01 m**, *tighter* than 0.04 m with it on |
| **2. `F.lateral` rewritten per frame** | **REFUTED** | target frozen: `14.65 → 14.65`, mean \|target change\| **0.0000 m** over 60 frames |
| **3. `snapToStreet` fighting the hold** | **REFUTED** | called only from `seedAgent`, once per agent. Not per-frame. |
| **4. the `side` sign** | **symptom, not cause** | targets are sensibly signed both ways (p50 **+7.64**, IQR **29.32**) and simply are not reached |

Two further hypotheses opened and closed this round:

| hypothesis | verdict | measurement |
| --- | --- | --- |
| building ejections make the line | **REFUTED** | **283 ejections total** across ~930 frames = **0.3/frame**; needs ~2550/frame. Top face z = 30.1 (125 hits), −14.4 (35) — discrete faces, not a continuum |
| a third of the crowd is never held | **REFUTED** | **0.0%** of active agents have `F.lateral === 0`; the hold's guard reaches all 2550 |

And one measurement that rules out an error in *my own* instrument:

```
  plan object identity: true
  mean |F.lateral - lat| against cityPlan(SEED):  14.48 m
  mean |F.lateral - lat| against crowd's own plan:  14.48 m
```

The crowd's internal plan and the one I measure against are **the same object**.
The 14.48 m error is real, not a reference mismatch.

## 3. The contradiction, now fully characterised

This is the sharpest statement of the defect to date:

```
    agent    6  target 14.65   realised -11.25 -> -11.25
    agent    7  target 14.51   realised -11.21 -> -11.18
    agent    8  target 14.45   realised -11.26 -> -11.22
    agent    9  target 14.21   realised -11.21 -> -11.19
    mean |target change| = 0.0000 m over 60 frames
```

**Target +14.65, realised −11.25 — a 25.9 m error — and the body moves 0.07 m in
60 frames.** Meanwhile the hold:

* reaches **every** active agent (0.0% excluded),
* is not blocked (0.0% inside a footprint),
* runs 1.59 M times applying mean **0.1004 m/frame**,
* is asked to close a mean error of **16.71 m**, with 3.7× the authority required.

A body with a 25.9 m error, under 0.13 m/frame of correction, should cross the
street in ~200 frames. It crosses 0.07 m in 60.

**Every per-frame positional writer I can identify in `stepAgent` has now been
measured and excluded**: locomotion, building ejection, wind (0.015 m/frame),
and the hold itself. The restoring force is real, per the arithmetic, and is
**not in the list of writers I have enumerated.**

One number remains unreconciled and I flag it rather than explain it:
`holdRuns` implies the hold fires for ~69% of active agent-frames, yet
`F.lateral === 0` for none of them. Those two facts cannot both hold, and one of
my two measurements is wrong. **That is the next thing to check** — it is the
last internal inconsistency in the investigation, and it may be where the
restorer lives.

## 4. Acceptance test status: NOT MET, thresholds untouched

```
  FOOTWAY BALANCE  left 1599  right 91  (left share 94.6%)
  z IQR about centroid = 0.04 m
  FAIL  both footways carry a real share of the crowd (30-70%)
  FAIL  z IQR about the centroid exceeds 1.0 m (not a line)
SPREAD VIOLATIONS 2
```

I did not relax a threshold to make anything land.

## 5. Silhouette variety: not attempted, and why that is the honest call

The reviewer's prediction stands untested. Fixing the spread would trade a
continuous ribbon for a row of posts, and varying silhouettes is what stops it
being a row of posts. But:

* it can only be judged against a captured frame, and **no capture may be taken
  this round**;
* doing it blind would put a second unvalidated change into the same round as a
  spread change that has not landed.

So I have **not** produced "spread alone yields posts" or "spread plus variety
yields varied bodies". I have produced neither, and I am not going to describe
a result I did not observe. The reviewer's stated refutation test — "a spread
result with distinct walker postures and readable leg gaps would contradict it" —
**remains untested**.

## 6. Standing numbers, updated

| quantity | value |
| --- | --- |
| z IQR about centroid | **0.04 m** (FAIL, needs > 1.0) |
| footway balance | **94.6% left** (FAIL, needs 30–70%) |
| street tangent | (0.880, 0.099) bearing 6.4° |
| perpendicular offset IQR | 12.70 m |
| realised lateral | p50 −10.20 m |
| `F.lateral` targets | p50 +7.64 m, IQR 29.32 m, **frozen** (0.0000 m drift / 60 frames) |
| hold | 1.59 M runs, 0.1004 m/frame, mean error 16.71 m, reaches 100% of agents |
| building ejections | 283 total (~0.3/frame) |
| agents inside a footprint | 0.0% |
| wind | 0.015 m/frame at default `windSpeed 4.2` |
| churn | 163 retired / 162 seeded per 30 frames |
| crowd plan == probe plan | **same object** — measurement reference sound |

## 7. Process

Branched before probing; `crowd.ts` never carried an unvalidated experiment;
instrumentation added, measured, and removed within the round. Import test run
before calling the tree usable. All numbers are counts, distributions or
percentiles — no wall-clock figure, the box is loaded.

No visual claim is made anywhere in this report.
