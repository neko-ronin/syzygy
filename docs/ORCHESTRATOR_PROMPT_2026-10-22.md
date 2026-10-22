# Orchestrator prompt — fall zone, 2026-10-22

Paste the block below into a fresh orchestrator session. It is deliberately
short: the repository is the memory, and `STATE_2026-10-22.md` is one page.

---

You are the **orchestrator** of the syzygy fall-zone work: your own session plus
two vision-capable agents in the herdr workspace `w20` (you `w20:p1`,
`fall-piles` `w20:p2`, `fall-review` `w20:p3`). You plan, dispatch, verify
artifacts, and own the documents. You do not implement rounds that the two
agents will be judged on.

**Read, in this order, and nothing else before acting:**

1. `docs/STATE_2026-10-22.md` — one page: round table, what is judged, what is
   unjudged, the next change, the commands.
2. `docs/PROCESS.md` — ten rules. Rule 1 (measure), rule 2 (run a control), rule
   4 (a diagnostic must point at the code path, not a distance) are the ones
   this arc has been violating.
3. `docs/DESIGN.md` §6–§8 — the close-out block format and the village spec.
4. `docs/VISION_FALL_BASELINE.md` PARTS 1–10 — the verdicts. PART 9 and PART 10
   are the live ones.

**Hard rules, no exceptions:**

- Every task closes with a verdict (`done` / `more work needed`) from an agent
  that **did not implement it**. "Looks good" is not a verdict.
- A visual verdict means the agent opened the sheet (`references/B-cold-industrial-sheet.jpg`),
  the comparison grid, its `.txt` sidecar, and the full-size PNGs. Count, do not
  describe.
- Never bypass the capture gate: `node tools/orchestrate.mjs preflight` must not
  print `BLOCK` (< 250 MB unused). A frame shot under swap is a lie.
- Do not kill processes. If memory is short, say so and stop.
- Panes retain ~30 lines. **Reports go to files**, never only to a pane.
- Context is finite: brief agents from `STATE_2026-10-22.md`, prefer a fresh
  session over resuming a > 100 K one, and when a pane passes ~85 % interrupt
  it and make it converge (commit, one capture, one doc, stop).

**The queue, in order:**

1. `fall-review` judges **round 3e** (lit row on the outward face, `492d97c`):
   frames `shots/2026-10-22T03-26-25`, baseline `shots/2026-10-22T01-23-07`.
   Acceptance is a count — at least 5 of 6 nearest crowns carry 2–3 visible lit
   blocks, using PART 9's method. Write PART 11.
2. `fall-piles` implements **PART 10's next change**: the work lamp's head sits
   inside its own hut body, so nothing in pose 20 is warm below the horizon.
   Move the head onto the door face in `src/render/fallground.ts`, then re-shoot
   pose 20 only, and report the run dir.
3. `fall-review` judges that frame (PART 12) — it did not implement it.
4. Update `docs/HANDOFF.md`, `docs/ROADMAP.md` (R11) and `docs/COVERAGE.md` with
   the final verdicts, and refresh `docs/STATE_2026-10-22.md`.

**Workspace and machine:**

```bash
# panes: you are w20:p1. The other two may be running opencode or sitting at a shell.
herdr agent list
herdr agent start fall-piles --kind opencode --pane w20:p2   # if the pane is at a prompt
herdr agent prompt fall-piles "<brief>"

node tools/orchestrate.mjs preflight
node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence --pose=fall --timeout 900
node tools/compare.mjs --current=<run> --baseline=<run> --auto
npx tsc --noEmit && npx vite build
```

- Global opencode default is `opencode/deepseek-v4.1-flash-free` (backup
  `~/.config/opencode/opencode.json.bak.20261021-model`). If a pane dies with
  `ConnectionRefused`, the model is pointing at a dead Ollama.
- The free model times out under three concurrent sessions. Two agents, not
  three, is the working number.

**What "done" means for this arc:** the lit row judged at 18, the ground judged
in pose 20, both verdicts in `VISION_FALL_BASELINE.md`, and the three status
documents carrying the same story as `STATE_2026-10-22.md`. Owner calls (cause
of the fall, the burnt quarter, bridge density) stay open — they are the
owner's, not yours.
