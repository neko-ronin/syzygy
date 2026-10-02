# Process

The rules to work by. Not the architecture — that is
[`DECISIONS.md`](DECISIONS.md). Not the list of what went wrong — that is
[`PITFALLS.md`](PITFALLS.md), which is a catalogue of past accidents. This is
what to *do*, stated so that the next mistake does not depend on remembering the
last one.

Every rule here exists because breaking it cost real time in this repository.
Where a rule came from, it is named.

---

## 1. Measure, do not reason

**The default failure mode of this project is a plausible theory.** Every one of
the eleven renderer bugs, the crowd placement faults, and the compare-harness bug
was found by measuring — a pixel probe, a counter, a control run — after reading
the code and concluding what was obviously wrong.

Reading code tells you what the author intended. Only measurement tells you what
the machine did.

- When two code paths compute the same thing, **print both**. If they disagree,
  the disagreement is the bug. Do not pick the one that looks right.
- **Print raw state, not just aggregates.** A count tells you something is wrong;
  per-entity state tells you where.
- Prefer a probe you can run in one pass to an argument you have to believe.

### ...but only where there is a right answer

This rule is about **bugs**, and it has a scope limit that costs real time when
missed. Measure to find out *what the machine did*. Do not manufacture a number
because numbers are the only thing you know how to trust.

The failure, in full: **the owner's words** —

> Applying hard quantifiable scores toward a goal that is considered subjective,
> on a product that isn't yet remotely presentable let alone MVP, is not an
> acceptable practice.

Nine rounds were spent on one unlit night market by inventing byte targets, N·L
ratios and warm/cool histograms. Six mechanisms were proposed and all six
refuted. Each refutation was reported as a successful round. It was one finding,
available in round one: *the measurement was not answering the question.*

The tell was round nine's "discovery" that the sample population was mostly
non-market floor. That is a defect report against eight rounds of prior work. It
was written up as insight.

**So:** atmosphere, mood, "does this read as a lit market" — these have no right
answer to measure toward. The instrument is **the frame review** (rule 9), by a
non-implementer, against the reference sheets, judged by eye. Numeric targets for
aesthetic properties are **derived after** a frame is approved, never invented
before one is requested.

Expect the pull. It returns whenever something looks wrong, and it feels like
diligence. That is the reason it is written here.

## 2. Run a control

**Change one variable. Re-shoot the same pose. Compare.**

The culling theory died in twelve seconds at `pedestrian:0/180` under *both*
`cull: 'back'` and `cull: 'none'`. It had already cost a renderer edit and most
of an afternoon. A control is cheaper than an argument.

If you find yourself explaining why the result is *still* correct, you are past
the point where one more run would have been too expensive.

## 3. Success is not evidence of correctness

**A command that exits 0 produced no error. It did not produce the right thing.**

- `tools/compare.mjs` printed a clean summary and wrote a valid PNG in which
  every tile was the same frame and the reference column showed our own render.
- The `.gitignore` entry for the reference videos claimed a benefit it did not
  deliver, because the files were already tracked.
- A self-test on `PATH` proved nothing until the probe used the right wire
  format.

**Check the artifact against a source you know differs.** Verify the thing the
artifact is *for*, not the exit code. This is the cheapest habit in the
repository and it catches the errors that survive review.

## 4. A diagnostic must point at its subject

**Before concluding a thing is absent, confirm the camera and the subject are in
the same place.** Print both positions. Distance, not vibes.

`01b-crowd-closeup` was hardcoded at the world origin while the crowd centroid
sat 975 units away, outside `viewRadius`. It reported an empty street, and two
sessions read that as a winding bug and then a culling bug. The pose was the
fault the whole time.

**Diagnostic poses derive from live state** — centroid, nav node, camera — never
from typed-in coordinates. This is D21, not a preference.

**Delete a diagnostic the first time it lies.** `inView()` reported zero in the
camera cone repeatedly while a dense crowd was in frame, and was believed for
several iterations. It is still in the tree; removing it is F3.

## 5. Do not read a name as evidence

**A name, a uniform slot, a registered tool, or a config value is not a
feature.** It is a claim that something exists.

Five phantoms survived three sessions precisely because each was greppable:
`godRays` and `precip` are uniform slots no shader reads;
`structure-collapse` is a live LLM tool with no renderer; `debrisChunk()` is
defined and never called; canal water is built and discarded.

**A pose config setting `godRays: 0.4` is not evidence of god rays.** Ask what
consumes the value, and follow it to the end.

`PHANTOM` is a status in [`COVERAGE.md`](COVERAGE.md) because it is the
dangerous case: "not built" announces itself, a phantom survives review.

## 6. When two sources disagree, the executable one wins

Code beats documentation. A screenshot beats a counter. A measurement beats an
argument.

When you find them disagree, **fix the document in the same change.** A file
that asserts something false is a landmine for whoever reads it next — and
`1481e47`'s claim that the crowd renders sat in `HANDOFF.md` uncorrected until
an audit contradicted it.

## 7. Write it down where the next session will look

The brief asked to "break up work as needed to recover work done without having
work get lost by an agent hitting a session limit." The recovery mechanism is
the git log plus `docs/`.

**A finding that is not written down is a finding that will be re-derived, badly.**
The first session's build checklist lived only in a chat pane; it went stale, and
that is why [`COVERAGE.md`](COVERAGE.md) exists.

- Learn something the hard way → `PITFALLS.md`, before you forget it.
- Decide something and reject an alternative → `DECISIONS.md`.
- Change what is true about the project → `COVERAGE.md`.
- Finish work, or hit a wall → `HANDOFF.md`.

## 8. Commit at a natural boundary, explaining why

Say what was wrong and why it was invisible, not just what changed. A commit that
only says *what* is worth far less to the next session.

Do not commit on a false premise, and do not commit a change made on an
unverified theory. It is fine — better — to commit a measurement and an open
question instead of a speculative fix.

## 9. Verify before reporting, and let a reviewer close the work

Run the checks, and report their output. Do not summarise from memory. For
**visual** work the bar is higher than "the build is clean": a different agent
must open the reference and the output, judge the frame, and return `done` or
`more work needed`. Self-certifying visual work is the failure this project has
already paid for once. See [`DESIGN.md`](DESIGN.md) §6.

- **A subagent that returns an empty result did nothing.** `ls` the paths.
  Twice, a subagent reported work that was never written.
- Confirm a cross-reference points at something that exists before committing it.
  `ORIGINAL_PROMPT.md` pointed at R6 for three commits when it meant R5.
- If a claim in this repository contradicts what you measured, say so plainly
  rather than working around it. Every one of the significant findings in this
  project came from taking a document at its word and being wrong.
- **A refutation is not a successful round.** Six consecutive mechanisms
  refuted by measurement is one finding — that the question was wrong — and it
  should have ended round one. If your round produced a clean negative result,
  check whether the round was worth having before opening the next one.
- **Read the stats off the frame you are about to believe.** A `requested: null`
  next to a `PASS` was visible in the output and unread, because the `PASS` had
  already been interpreted as "the tool worked".

## 10. Do not narrow the brief

The brief says no gameplay, no cars, iterate until the output reaches near or
surpasses the reference video, and drop screenshots every iteration. Those are
constraints, not suggestions. If a change starts adding objectives, four-wheeled
vehicles, or a completion condition, it is wrong.

The reference material in `inspirations/` is the quality bar, not a mood board.
Any "is this good enough" judgement gets settled against a frame from it, with
`node tools/compare.mjs` — not against imagination.

---

## The short version

Measure before theorising — **about bugs, not about taste**. Run a control. Check
the artifact, not the exit code. Confirm the diagnostic is looking at its subject.
Do not read a name as evidence. A refutation is not a successful round. Fix the
document when measurement contradicts it. Write down what you learned. Commit the
reasoning. Verify before reporting — and let a reviewer judge the frame.
