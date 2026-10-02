# Operating procedure — how this project is actually worked

**Read this when you are about to start work, not after.** It describes the
workflow the team has converged on, the parts of it that are load-bearing, and
the four places it has failed. `PROCESS.md` is the rules; `PITFALLS.md` is the
accidents; this file is the *craft* — how the rules get applied when several
agents and a human are in the loop at once.

If a practice here conflicts with `PROCESS.md`, `PROCESS.md` wins and this file
is wrong and should be fixed.

---

## 1. The shape of a session

```
        ┌─────────────────────────────────────────────┐
        │  owner: direction, taste, and the final call │
        └───────────────┬─────────────────────────────┘
                        │  short briefs, not micromanagement
        ┌───────────────▼─────────────────────────────┐
        │  orchestrator: plan, dispatch, integrate     │
        │  owns the roadmap and the review gate        │
        └────────┬──────────────┬──────────────┬───────┘
                 │              │              │
        ┌────────▼──────┐┌──────▼───────┐┌─────▼────────┐
        │ implementers  ││ vision       ││ reviewer      │
        │ 1..n, by      ││ reviewer     ││ (adversarial) │
        │ ownership     ││ (mandatory)  ││               │
        └───────────────┘└──────────────┘└──────────────┘
                 │
        ┌────────▼──────────────────────────────────────┐
        │  owner reviews frames; session ceremony ends it │
        └───────────────────────────────────────────────┘
```

**The orchestrator does not implement.** Its value is the plan, the dispatch, and
the memory of what was already tried. An orchestrator that also writes code is an
orchestrator that has no bandwidth to notice two agents touching the same file,
or that the third refutation means the question is wrong.

**Every task ends with a vision verdict** from an agent that did not do the work
(`DESIGN.md` §6). `more work needed` is a normal, successful outcome. Closing on
a verdict you do not believe is the actual failure.

---

## 2. Agents, specialties, and the constraints that shape dispatch

Three agents ran this session. Their specialties are not interchangeable, and
their limits are load-bearing.

| Role | Strength | Hard constraint | Owner of |
|---|---|---|---|
| **Implementer A** (ground, market, lighting, WGSL, capture probes) | Fast, willing to refute itself, comfortable with numeric work | Owns `src/world/*grammar*`, `src/render/*bake*`, `src/shaders/`, `tools/capture.mjs`. **Budgeted captures** — 2 per round, stated up front | ground, market, lighting, harness |
| **Implementer B** (crowd, diagnostics, ABI audit, cross-checks) | Careful, refuses to act on a guess, good at falsifying its own numbers | Owns `src/sim/crowd.ts`, diagnostics, `docs/OCCUPANCY.md`, `docs/ABI_AUDIT.md`. **No capture budget** — works headlessly via `--eval` and self-tests | crowd, diagnostics, ABI, density |
| **Vision reviewer** (mandatory gate) | Opens the reference sheets first; measures silhouettes in pixels; refuses to certify without evidence | **No writes, no captures.** Judgement only. Also the **adversarial voice** — the one role whose job is to disagree | `DESIGN.md` §6 |

### 2.1 File ownership is a dispatch constraint, not a courtesy

Ownership collisions cost more rounds than slow agents do. A capture budget
exhausted mid-round is recoverable; two agents in `marketgrammar.ts` in the same
round is a merge conflict plus two half-understood diffs.

**When a task crosses an ownership line, the brief says so explicitly and names
who owns the file.** That happened twice this session and both times it cost a
round: once when an implementer asked for authority it did not have (a wizard
question, correctly escalated rather than guessed), and once when a reviewer's
recommendation was relayed without checking it could work.

### 2.2 Agents need hard limits, not encouragement

Idle agents are a planning failure, not an agent failure. The formats that worked:

- **numbered, falsifiable predictions** written into the roadmap *before* the
  round, so a refutation costs zero captures;
- **a capture budget stated in the brief** ("2 captures maximum, and only if the
  probe already says the prediction holds");
- **an explicit "do not implement a second idea"**, because the pull to bundle is
  strong and a second unjudged change contaminates the first;
- **permission to refute.** Implementer A refuted four of its own mechanisms this
  session, and one of those refutations voided the measurement the other four
  rested on. That is the behaviour to protect. An implementer that cannot say "I
  was wrong" will ship a wrong number.

### 2.3 Budgets are real and must be rationed

This machine: **8 cores, 16 GB RAM, ~13 GB free disk**. A full 16-frame high-tier
capture run is ~722 s and produces ~36 MB. At the session's peak, swap hit
**8.1 GB of 9.2 GB used** with 15 GB of 15 GB physical memory in use.

Consequences, all of which bit:

- Captures are rationed per round and stated in the brief.
- GPU work is **serialised**. Two agents capturing at once is how swap gets
  killed.
- A capture series is never run to satisfy curiosity. If the probe already
  answers the question, no capture happens — which is how round 18 spent zero
  captures and still produced a falsified prediction.

---

## 3. Planning so nothing sits idle

### 3.1 Dispatch by ownership boundary, not by convenience

The unit of parallel work is a **file boundary with one owner**. Three agents can
work simultaneously only if their file sets do not intersect. Plan the round by
listing which files each task will touch *before* dispatching.

### 3.2 Order by dependency, and say what is blocked on what

```
  measurement ──▶ prediction (written down first) ──▶ implementation
       │                                                     │
       └──────────── blocked ────────────────────────────────┘
                          capture (gated on prediction)
```

The gate at the right is the whole point. Round 18 ran the probe, the prediction
failed, no capture was taken, and the round closed in 7 minutes with a number
instead of a frame.

### 3.3 Keep a warm queue

Never dispatch the last round's final item with nothing behind it. The session's
longest idle stretch was recoverable only because R13 had been written while
something else ran. When one agent returns, the next brief should already exist.

### 3.4 Reclaim idle agents with diagnosis, not with busywork

An idle implementer usually means the plan ran out, not that the agent is stuck.
Give it the **next unanswered question**, which is almost always already sitting
in a document from a prior round. Round 13's slot was filled by writing R13's ABI
section — work that had to happen anyway and needed no new planning.

---

## 4. Research and adversarial discussion, before the owner

The owner is the direction and the taste. They are **not** a research desk, and
this session produced a concrete failure from forgetting that.

### 4.1 Try to answer it without asking

Before putting a question to the owner, in order:

1. **Search the repository.** It is 68 KB of `LIGHT_DELIVERY.md`, a 269-line ABI
   audit, and a `PITFALLS.md` with 22 numbered failures. The answer is usually
   written down by someone who has already paid for it.
2. **Read the code, and print the value.** Not the value you expect — the one the
   machine produces.
3. **Web research**, for anything about WebGPU, WGSL, three.js, or current
   practice outside this codebase. Reach for it; it is cheap.
4. **Adversarial discussion between agents.** Put the claim to one agent as the
   advocate and another as the sceptic. The strongest single finding this session
   came from this route: dev2's observation that *ten SAFE ABI results is a worse
   signal than one MISMATCH*, because a mismatch announces itself and correct
   constants watched by nobody announce nothing.
5. **Only then** ask the owner — with options, a recommendation, and the
   reasoning, not an open question.

### 4.2 The failure, recorded so it does not repeat

Three questions were put to the owner this session that should not have been, or
should have been asked better:

- A recommendation was relayed from a vision reviewer **without checking whether
  it could physically work**. It was implemented, measured, and reverted. The
  reviewer's advice was reasonable; the handoff lacked an arithmetic check.
- Two proposals were made from plausibility and refuted on measurement. The right
  move both times was to print the number first.
- A taste question was escalated to the owner as a technical option list, when the
  correct instrument was a frame review.

**The rule:** an owner question must be a *decision* (which of these two, and do
you accept this risk), never a *fact* (what does this number say). Facts are
yours to find.

---

## 5. Drift control — the reflection that keeps this from sprawling

Drift in this project looks like: a working capture harness quietly stops applying
the pose it is given. It is invisible, it survives review, and it costs rounds.

### 5.1 Reflect at the turn, not at the end of the session

Two questions after **every** agent round, before the next dispatch:

1. **Is this still the task I dispatched?** This session's clearest drift: nine
   rounds of numeric targets on *"does this night market look right"* — a
   subjective question — after the roadmap itself had recorded that the criterion
   requires the owner's eyes on a frame. The roadmap said it. Nine rounds
   overrode it.
2. **Am I still building, or am I now characterising?** If a round's output is a
   histogram, a ratio, or a status update, and the next round's output will be
   the same kind of thing, stop. That is not progress; it is characterisation.
   Six consecutive refutations was one finding available in round one.

`PROCESS.md` rule 9 now carries this as *"a refutation is not a successful
round"*, and rule 1 carries *"but only where there is a right answer"*.

### 5.2 Ward off entropy deliberately

- **Fix the document when measurement contradicts it.** Three documents had
  drifted this session — R4 understated completed work, R2 understated the
  diagnosis, `HANDOFF.md` omitted a live workflow failure.
- **Delete what has outlived its cause.** `culledByDay` was removed, not
  deprecated; `windowGlow` and its entire `glow` event channel were deleted and
  the roadmap corrected so it stops recommending a knob nothing consumes.
- **Keep the history, mark it dead.** Superseded proposals are folded into
  `<details>` and labelled, so a new session cannot pick one up as live work.
  This is why the lantern-radius proposal says **SUPERSEDED — DO NOT PICK UP**:
  left standing, it would have sent the next session straight back into histograms.
- **One owner per row, always.** A `COVERAGE.md` row with no owner is the output
  of that file.

### 5.3 Valuation: verifiable over elaborate

This project's own rule, and the reason the codebase is small:

- **Complete a foundation before widening it.** Ground grammar → market grammar →
  lighting. Not breadth.
- **A measurement committed as a diff is a spec.** `src/sim/__selftest_density.ts`
  makes the ≥40 px gap bin re-runnable in one command. That is more valuable than
  the prose that discovered it.
- **No abstraction layer without two callers.** The one time this was violated
  during the session — relaying a reviewer's fix without checking it — cost a
  round.
- **Prefer the check to the comment.** The ABI's ten SAFE verdicts are enforced by
  humans reading comments, which is a check that cannot fail. Three lines of test
  would make it real.

---

## 6. Platform management

Not housekeeping. This machine ran out of both disk and RAM during the session, and
that is a *project* risk: a capture that dies mid-run looks exactly like a
rendering bug.

### 6.1 Check at the start of a round, not after the failure

```bash
df -h /System/Volumes/Data          # free space — the binding constraint here
sysctl -n vm.swapusage              # swap used / total
top -l 1 -n 0 | grep PhysMem        # physical memory and compressor
du -sh shots node_modules .git      # what this repo is holding
```

**Thresholds, from this session's experience:**

| Signal | Reading | Action |
|---|---|---|
| Disk free < 20 GB | 98% at peak | prune `shots/` — see below |
| Swap used > 8 GB | 8.1 of 9.2 GB | serialise captures; no parallel GPU work |
| PhysMem "unused" < 500 MB | 66 MB at peak | expect a swap death, not a slow run |
| `shots/` > 400 MB | reached 449 MB | prune unreferenced runs |

### 6.2 `shots/` is the pressure valve, by design

It is **gitignored on purpose** (`DECISIONS.md` D22) precisely so it can be
deleted without consequence: a frame is one capture run away, and storing renders
in git was never worth the clone cost.

**Prune procedure, used at this session's end (449 MB → 154 MB):**

```bash
# 1. find what the docs actually reference — never delete these
rtk grep -rho "shots/[0-9][^/ )\`]*" docs/ AGENTS.md README.md | sort -u

# 2. keep those, plus the current presentation set and any run a verdict cites
mkdir -p /tmp/keepshots
# ...move the keepers...
for d in shots/*/; do case "$(basename $d)" in <keepers>) ;; *) rm -rf "$d";; esac; done
mv /tmp/keepshots/* shots/
```

Never prune a run that a review verdict, a commit message, or a document cites.
Those references are the only index into untracked evidence.

### 6.3 Do not prune `node_modules/`

It is gitignored but not free — 59 MB, and it is the source of the **pinned
TypeScript 5.9.3** that `HANDOFF.md` depends on. `npx tsc` resolves to a *global*
7.0.2 with different overload rules, so the documented `npx tsc --noEmit` is not
pinned. Use `./node_modules/.bin/tsc --noEmit` for a stable answer.

### 6.4 A failed capture is not evidence of a rendering bug

Disk full and OOM both produce truncated frames and GPU errors that read exactly
like the silent faults this project spends its life hunting. **Check platform
state before believing a visual failure.**

---

## 7. Communication with the owner

**Match the register to the reader.** The owner asked, mid-session, for a Flesch
reading-ease of about 50 — short sentences, plain words, no clause-stacking.

| Situation | Register |
|---|---|
| Routine status | Two or three lines. Lead with the verdict, not the process. |
| A correction, or a mistake worth owning | Plain, short, and *before* the explanation. No preamble. |
| An aesthetic judgement | **Never a number.** Ask about a frame. |
| A real decision | Options, a recommendation, and the reasoning. Not an open question. |
| A fact the owner could look up | Look it up. See §4. |

Two things that worked this session and are worth repeating:

- **Lead with the thing that changed their plans.** If the next action is
  different from what they expected, that is the first sentence.
- **Report a refutation as a refutation.** "Five mechanisms refuted" is more
  useful than "good progress on the investigation", and it is the difference
  between an honest status and a reassuring one.

---

## 8. Session ceremony

The session ends with a ceremony, because the next session should not have to
reconstruct what happened. [`SESSION_2026-10-01.md`](SESSION_2026-10-01.md) is the
worked example.

1. **Verify, and record the output.** Pinned `tsc`, `vite build`, all five
   self-tests, `lsp-check`. Do not summarise from memory — `PROCESS.md` rule 9.
2. **Commit everything, to `main` or a named branch.** Nothing left uncommitted,
   nothing stranded on a side branch.
3. **Synchronise the documents to reality.** Correct a status that understates
   work *and* one that overstates it; both mislead. This session fixed three.
4. **Collect the undocumented lessons** and write them where the next session will
   read them — `PITFALLS.md` for accidents, `PROCESS.md` for rules,
   `SESSION_*.md` for this round's arc. Include the owner's corrections by name and
   in their own words.
5. **Supersede, do not leave standing.** Any live proposal that was refuted gets
   labelled `SUPERSEDED — DO NOT PICK UP` and folded away.
6. **Track issues with owners.** `COVERAGE.md` plus the session file. A row with
   no owner is the output of that file.
7. **Prune the platform.** `shots/` per §6.2. Remove temp scratch.
8. **Ask the owner the real questions** — decisions only — and write them into the
   handoff so they survive if the human is not there tomorrow.

**Checklist at the end:** tree clean · `main` committed · pinned `tsc` clean ·
docs synchronised · superseded work labelled · issues owned · disk and swap
checked · the next session's first action written down in one sentence.

---

## 9. The four ways this has failed

Condensed, because they are the parts worth carrying into the next session.

| Failure | Where | Countermeasure |
|---|---|---|
| **A guard existed but sat in the wrong path** | `--pose=` never applied the pose; the requested-vs-held check was one branch away, and the documented command reported `PASS` over a rooftop | `PITFALLS.md` §20 — ask *"which paths reach the frame without passing this check?"*, not *"is the check right?"* |
| **Measurement substituted for judgement** | Nine rounds of byte targets on a subjective question; six refutations read as six successful rounds | `PROCESS.md` rule 1 scope; `PITFALLS.md` §22 — ask **where the number came from**; if you chose it, stop |
| **The measurement was pointed at the wrong population** | Stall "faces" sampled into empty aisle; the byte was night sky | `PITFALLS.md` §16, §21 — sample from geometry, validate the probe against a known quantity first |
| **An agent's scope was crossed** | A reviewer's fix relayed without an arithmetic check; implemented, measured, reverted | §2.1, §4.2 — name the file owner in the brief; verify before relaying |
