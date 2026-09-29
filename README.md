# syzygy

A dreamscape city. A dense, atmospheric, solarpunk metropolis that streams
forever, has weather, traffic, and thousands of people living in it, and that you
can fly through — with a camera that leans into vertigo and a lens that makes the
whole thing look like a model of itself.

Runs in a browser on WebGPU. No gameplay, no objectives, no fail state. A place.

```bash
npm install
npm run dev            # http://localhost:5180
```

---

## Status

The city renders. Sun shadows, canyon fog, district colour, tilt-shift, bloom,
TAA, filmic grade. Getting there meant fixing eleven silent WebGPU/frame-graph
faults — cases where the app ran at full speed, reported plausible statistics,
and produced wrong pixels.

Not yet: street level does not read as inhabited, traffic is simulated but never
drawn, night is nearly black, and WebGL 2 does not exist.

**Read [`docs/COVERAGE.md`](docs/COVERAGE.md) if you want to know what is
missing.** It maps the original build checklist to where each item is covered,
and flags the subsystems that have a name and a tool but no system behind them.

**Read [`docs/HANDOFF.md`](docs/HANDOFF.md) before working on this.** It says
what works, what does not, and what to do first.

## Documentation

| Document | What it is for |
| --- | --- |
| [`docs/ORIGINAL_PROMPT.md`](docs/ORIGINAL_PROMPT.md) | The brief, verbatim, read clause by clause as a specification — including the one place the build deviates from it |
| [`docs/HANDOFF.md`](docs/HANDOFF.md) | Current state. Start here. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What is left, why it matters to the vision, and in what order |
| [`docs/PITFALLS.md`](docs/PITFALLS.md) | The catalogue of silent failures and how to catch them next time |
| [`docs/PROCEDURES.md`](docs/PROCEDURES.md) | How to run, capture, debug, and extend this |
| [`docs/ITERATION.md`](docs/ITERATION.md) | Chronological log of what changed and why |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Why the architecture is the way it is, and what was rejected |
| [`docs/GLOSSARY.md`](docs/GLOSSARY.md) | Vocabulary, so the next session and the next agent talk about the same things |
| [`docs/COVERAGE.md`](docs/COVERAGE.md) | Living map from the original build checklist to where each item is covered — and what is a `PHANTOM` |

## Seeing it

```bash
node tools/capture.mjs --sequence        # 10 curated camera poses
node tools/capture.mjs --pose=canyon     # one of them
node tools/capture.mjs --eval "window.__syzygy.stats()"
```

Output lands in `shots/<timestamp>/` with `_contact-sheet.png` as the overview.
The harness fails the run on any GPU or shader error — a black screenshot is a
failure signal, not a dark scene.

## The reference

`inpirations/dreamscape/*.mov` are the quality bar, not a mood board. When a
question is aesthetic rather than correct, extract a frame and compare. That
distinction settled several arguments during bring-up that reading the code could
not.

Those videos are ~670 MB and are **not tracked in git** — they live on disk, and
the repo is still ~1 GB to clone because they remain in history. See
`.gitignore`.

Build the side-by-side grid rather than opening two images in sequence; you will
not hold both in your head:

```bash
node tools/compare.mjs --latest --ref dreamscape-05@12
# columns:  BASELINE  |  CURRENT  |  REFERENCE
# rows:    poses present in both shots/baseline/ and the latest run
```

`shots/baseline/` holds the curated frames worth keeping. Everything else in
`shots/` is transient and ignored.

## Shape of the thing

```
src/core/     math kernel, GPU device, the mutable WorldState
src/world/    city generation, districts, nav graph, CPU mesh builder
src/render/   the frame graph, mesh baking, GPU helpers
src/shaders/  WGSL, concatenated by src/render/wgsl.ts
src/sim/      weather director, alternate transport, crowd
src/camera/   6-DOF flight camera, gamepad + keyboard + touch
src/agent/    LLM conductor, local brain, console UI
server/       Vite plugin: /api/chat proxy, world state save/load
tools/        headless capture harness, language-server checker
```

Everything is TypeScript, strict, `noUnusedLocals`, and depends on exactly one
npm package at runtime: none. Dev dependencies are Vite, TypeScript, Playwright
and the WebGPU type definitions.

## Verifying it

```bash
npx tsc --noEmit
npx vite-node src/world/__selftest.ts   # citygen   (prints VIOLATIONS: none)
npx vite-node src/sim/__selftest.ts     # weather + traffic  (ALL PASS)
npx vite-node src/camera/__selftest.ts  # camera              (ALL PASS)
node tools/lsp-check.mjs                 # all five language servers
```
