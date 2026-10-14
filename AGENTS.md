# AGENTS.md

Working on this repository — for an AI agent or a new contributor.

syzygy is a dreamscape city: a dense, atmospheric, solarpunk metropolis that
streams forever and that you fly through. Raw WebGPU, procedural, no runtime npm
dependencies, no texture assets. No gameplay — it is a place.

**Read [`docs/PROCESS.md`](docs/PROCESS.md) before you touch anything.** Ten
rules, each bought with a real bug. It is short, and it is the highest-value read
in the repository — every significant mistake in this project's history is a
violation of one of them.

---

## Start here

```
1. docs/PROCESS.md          the rules        ← always, first
2. docs/HANDOFF.md          current state    ← what is true right now
3. docs/COVERAGE.md         what is missing  ← including 5 phantoms
```

**Doing any visual or design work? Read [`docs/DESIGN.md`](docs/DESIGN.md) and
open the section's reference image** in `references/`. Do not judge a frame from
memory or from another section's reference — steering this project by one image
has already happened once, and it cost a session.

Then pick work from `docs/ROADMAP.md`. Everything below is for when you know
which document answers your question.

---

## The documents, and when each one is the right one

| Document | What it is | Read it when |
| --- | --- | --- |
| [`PROCESS.md`](docs/PROCESS.md) | Ten working rules. Measure, run controls, check artifacts, confirm your diagnostic points at its subject | **Before you change anything.** Start every session here |
| [`WORKFLOW.md`](docs/WORKFLOW.md) | How the team actually works: agent roles and limits, dispatch, budgets, drift checks, platform, session ceremony | **Before dispatching an agent**, and whenever more than one person is in the loop |
| [`DESIGN.md`](docs/DESIGN.md) | **The art direction.** Target finish, the four sections, district mapping, and the two agent roles | **Before any visual or design work.** It was missing and the gap cost a session |
| [`sections.json`](references/sections.json) | The machine-readable design contract: sections, pose→section map, checks. Read by `compare.mjs --auto` | When tooling needs it, or you are changing the section definitions |
| [`README.md`](README.md) | Human-facing overview: what it is, how to run it, how to verify it | For someone new to the project who will not be editing it |
| [`HANDOFF.md`](docs/HANDOFF.md) | Current state. Work items F1–F6, what works, what does not, and the two open questions blocking the crowd | First, to learn where the project actually is. Re-read before handing off |
| [`COVERAGE.md`](docs/COVERAGE.md) | Living map from the original build checklist to where each item is covered. Marks `PHANTOM`s | When you need to know what is **missing** rather than what to do next. Read it before adding a feature |
| [`ROADMAP.md`](docs/ROADMAP.md) | R1–R10, ranked by visual impact, with the reasoning and the done-when | When choosing what to work on. This is the priority queue |
| [`PITFALLS.md`](docs/PITFALLS.md) | Every silent failure, what it looked like, and how to catch it next time. The history behind these rules | Before touching the renderer. When something is wrong and you have no idea why |
| [`DECISIONS.md`](docs/DECISIONS.md) | D1–D24: why the architecture is what it is, and what was rejected | **Before changing the architecture.** Several would be actively harmful to reverse |
| [`PROCEDURES.md`](docs/PROCEDURES.md) | How to run, capture, debug, and extend. Instance layouts, frame graph, quality tiers, committing | When you need to do a specific mechanical task |
| [`ORIGINAL_PROMPT.md`](docs/ORIGINAL_PROMPT.md) | The brief, verbatim, read clause by clause as a specification | When you need to know what was actually **asked for**, to judge scope or spot a deviation |
| [`GLOSSARY.md`](docs/GLOSSARY.md) | Vocabulary for the city, the render, the simulation, and the process | When a term is ambiguous, or you need to name something precisely |
| [`ITERATION.md`](docs/ITERATION.md) | Chronological log: what changed, when, and why | For history. Why the code is shaped the way it is |

### The three that are easy to confuse

There are three "what went wrong" documents and they are not interchangeable:

- **`PROCESS.md`** — what to do. Forward-looking. Read it before acting.
- **`PITFALLS.md`** — what happened. Historical, symptom-first. Read it when
  something is broken and you cannot see why.
- **`COVERAGE.md`** — what is missing. Present-tense inventory, including
  phantoms. Read it before adding anything.

### Two that are easy to misuse

- **`ORIGINAL_PROMPT.md` is frozen.** It is the user's words, kept unedited as a
  reference point. It does not track progress — `ROADMAP.md` and `COVERAGE.md`
  do that. Never edit it to fix a status; edit the status document instead.

---

## Verify before you claim

```bash
npx tsc --noEmit                            # must be clean
npx vite build                              # must be clean
npx vite-node@6.0.0 src/world/__selftest.ts       # citygen   — prints "VIOLATIONS: none"
npx vite-node@6.0.0 src/sim/__selftest.ts         # sim       — ALL PASS
npx vite-node@6.0.0 src/camera/__selftest.ts      # camera    — ALL PASS
node tools/lsp-check.mjs                    # 5/5 language servers
node tools/__selftest_hygiene.mjs           # hygiene screen — ALL PASS
```

`vite-node` is **not** a project dependency. The `@6.0.0` pin is deliberate: a bare
`npx vite-node` resolves whatever is newest on npm. The first pinned run asks once to
fetch exactly that version. `src/render/__selftest_ground_contract.ts` runs under it
(`GROUND CONTRACT ALL PASS`). `src/render/__selftest_capture.ts` only exports a function
and prints nothing under `vite-node`; run it through Vite SSR as in
`docs/SESSION_2026-10-06_STREET.md` (the `node -e` line). Silence is not a pass.

The world self-test prints a `VIOLATIONS` line, **not** `ALL PASS`. That is not
a broken test; that is the line to read.

[`PROCEDURES.md`](docs/PROCEDURES.md) §1 has the full command table, including
`--debugseq`, `--grab`, `--eval`, `--quality` and `--query`.

## The visual loop

```bash
node tools/capture.mjs --pose=canyon        # one shot
node tools/capture.mjs --sequence           # 10 poses, ~9 min
node tools/compare.mjs --latest --ref dreamscape-05@12
node tools/compare.mjs --latest --auto      # each pose vs its OWN section
```

`compare.mjs` builds a `BASELINE | CURRENT | REFERENCE` grid — one row per
pose. **Use it instead of opening two images in sequence**; the first is gone by
the time you look at the second. The reference videos in `inspirations/` are the
quality bar, and they are the arbiter of any "is this good enough" question.

Prefer **`--auto`**, which judges each pose against the reference sheet for the
section it belongs to. `--ref` applies one frame to every row, which is how a
night frame ends up being compared to a daylight shot.

**The curated reference images are in `references/` and are in git.** One
contact sheet per section (`references/<id>-sheet.jpg`) plus the individual
frames. Open the sheet before judging anything visual.

Two hard rules: the capture harness **always uses the Vite dev server, never
`preview`** (a stale build produces screenshots that look valid and are wrong),
and it **fails the run on any GPU or WGSL error**.

## Shape of the code

```
src/core/     math kernel, GPU device, the mutable WorldState
src/world/    city generation, districts, nav graph, CPU mesh builder
src/render/   the frame graph, mesh baking, GPU helpers
src/shaders/  WGSL, concatenated by src/render/wgsl.ts
src/sim/      weather director, alternate transport, crowd
src/camera/   6-DOF flight camera, gamepad + keyboard + touch
src/agent/    LLM conductor, local brain, console UI
server/       Vite plugin: /api/chat proxy, world state save/load
tools/        capture harness, comparison grid, language-server checker
```

TypeScript, strict, `noUnusedLocals`. **Zero runtime npm dependencies** — Vite,
TypeScript, Playwright and the WebGPU types are dev-only.

---

## Things that will waste your time if you do not know them

Full catalogue in [`PITFALLS.md`](docs/PITFALLS.md).

1. **Every bug in this project's history was silent** — no error, no exception,
   plausible statistics. Assume the next one is too, and measure.
2. **A black screenshot is not a dark scene.** Check for GPU/WGSL errors first.
3. **WGSL struct offsets are an ABI.** The frame uniform is written from
   TypeScript and read by a shader; if the two disagree, everything shifts
   silently. There is a comment on the writer and a `FRAME_UNIFORM_SIZE`
   constant for a reason.
4. **Reverse-Z inverts the depth comparison.** Using `less` in the main pass
   rejects every fragment including the clear, and the world renders as empty
   sky.
5. **The reference videos are the spec.** Settle aesthetic arguments with a
   frame, not an opinion.

## Multi-agent

This is a `herdr` workspace; the `claude` and `developer` panes are free, as are
task-tool subagents. Split work along ownership boundaries — citygen,
camera+input, weather+traffic, agent+harness — so parallel agents do not collide.

**Read [`docs/WORKFLOW.md`](docs/WORKFLOW.md) before dispatching.** It is the
operating procedure this team converged on: agent specialties and their hard
limits, file ownership as a dispatch constraint, capture and GPU budgets on this
8-core/16 GB machine, how to keep agents from sitting idle, when to research
instead of asking the owner, how to check for drift after every round, the
platform checks (`df`, `sysctl vm.swapusage`) and the `shots/` prune procedure,
the session ceremony, and the four ways the workflow has already failed.

Two rules from it that override habit:

- **Every round is closed with a written reflection**: *is this still the task I
  dispatched?* and *am I building, or now characterising?* A round whose output is
  a number and whose successor's output will also be a number is not progress.
- **An owner question must be a decision, never a fact.** If it can be found in
  the repository, the code, or the web, find it first.

**A subagent that returns an empty result did nothing.** `ls` the paths before
believing the report. Twice, a subagent claimed work that was never written.

### Visual work is not optional context

Any agent doing design or visual review **must open the images and run the
comparison**. Concretely, before reporting:

1. Read `references/<section>-sheet.jpg` — the image, not its filename.
2. `node tools/capture.mjs --pose=<substr>` for the section you touched.
3. `node tools/compare.mjs --latest --auto` and read the resulting grid.
4. Open the grid, and the `.txt` sidecar, to see which section each row was
   judged against.

An agent reporting "looks good" without having opened the sheet and the grid has
reported an opinion, not a review.

### No task closes without a review agent

**Every task ends with a vision agent returning `done` or `more work needed`.**
The reviewer must not be the implementer — an agent grading its own work has the
change in mind instead of the frame, and has already seen it as good.

The reviewer opens the sheet, the grid and the sidecar, judges against the
roadmap item's done-when, and returns the close-out in
[`DESIGN.md`](docs/DESIGN.md) §6. "Looks good" is not a verdict; it is the
absence of one. `more work needed` is a normal, successful outcome — closing on
a verdict you do not believe is the actual failure. Roles are specified in
[`DESIGN.md`](docs/DESIGN.md) §7.

## Commits

Commit at a natural boundary and explain **why** — what was wrong and why it was
invisible. A commit that says only *what* changed is worth much less to the next
session.

Do not commit a change made on an unverified theory. Committing a measurement
and an open question is better than committing a speculative fix.

## Closed decisions — do not reopen these casually

- **WebGL 2 is shelved, and that is the owner's call, not a gap.** The human
  owner decided on **2026-10-01**: *"we're shelving webgl 2. we're going all in
  on webGPU."* This was WebGPU-only from the first commit, and it has been
  confirmed against the source, not assumed. The full entry, including the
  evidence table, the accepted cost (**anyone without WebGPU sees nothing**),
  and the rejected shared-abstraction alternative, is
  [`DECISIONS.md`](docs/DECISIONS.md) **D1**; the roadmap record is
  [`ROADMAP.md`](docs/ROADMAP.md) **R8**, status *closed*. **Weeks of work for a
  second renderer — do not start it in passing, and do not re-raise it as an
  outstanding deviation.** Portability to three.js and WebGL 2 is still wanted
  and is a different thing from building a second backend; the comments saying
  so are load-bearing.

That was the only item under this heading, so this section is now a record of a
decision rather than a to-do. If you add an open question, put it under a
heading that says *open*.
