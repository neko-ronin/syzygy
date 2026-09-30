# Pitfalls

Every trap hit during bring-up, what it looked like, why it happened, and how to
catch it next time. All of these produced **no error message** — the app ran at
full speed and printed plausible statistics.

The chronological record of *what changed and when* is in
[`ITERATION.md`](ITERATION.md). This file is the practical catalogue.

---

## The meta-lesson

**Every single bug in this list was found by measuring, not by reasoning.** Each
time I read the code and concluded the shader "obviously could not be doing that",
the actual cause was somewhere else. The techniques that found them:

- A **pixel probe** that reads pixels back out of an intermediate target
  (`Renderer.probe()`). A guessed cause took an hour; one probe took one run.
- A **per-stage debug view** (`--debugseq`) that dumps each post stage to its own
  PNG in a single run, so stages are strictly comparable. Every "the colours are
  wrong" bug in this project was a post-chain bug.
- **A diagnostic pose that frames the thing that is allegedly broken.** The crowd
  took five faults to find; the decisive step was putting the camera 3.4 m above
  a *known* agent and looking down, which showed a dense crowd immediately and
  proved the remaining problem was distribution, not rendering.
- **Killing the suspect and seeing if the symptom changes.** Scaling the
  pedestrian mesh 10× should have produced a visible wall. It produced nothing,
  which falsified "it's a scale problem" in one shot.

When something does not look right, resist the urge to re-read the shader. Build
a measurement.

---

## 1. A black screenshot is not a dark scene

**Symptom:** every pose rendered pure black. The app was at 137 fps with 4.6 M
triangles and 126 visible chunks. Nothing was wrong except everything.

The actual causes, in order of discovery: reverse-Z depth rejected all geometry
(§3), the frame uniform was offset (§4), and finally a WGSL compile error that
invalidated the entire post module (§6).

**How to catch it:**
- `tools/capture.mjs` now treats any GPU or WGSL error as a **hard failure** and
  prints `run INVALIDATED`. Do not remove that.
- `window.__gpuErrors` accumulates every `uncapturederror`. Read it before
  believing any screenshot.
- **If a screenshot is black, check the errors first. Always.** The `stats()`
  object is cheap and often tells you the opposite of the truth.

**Corollary:** a *plausible* screenshot is not proof. The harness once cheerfully
reported `PASS · 9 shots` for nine identical images of an empty sky.

## 2. WebGPU textures are not readable unless you say so

**Symptom:** the render was correct but every capture was black.

The canvas swapchain texture is transient. `ctx.configure()` needs
`usage: RENDER_ATTACHMENT | COPY_SRC` for `toDataURL`/`drawImage` to work, and
even then, reading after presentation is unreliable.

**The robust answer** (implemented): `Renderer.captureRGBA()` re-runs the
composite into a texture the renderer owns, copies it to a mapped buffer, and
returns RGBA bytes. It does not go through the canvas at all. If a capture ever
goes black again, check this first.

## 3. Reverse-Z inverts the depth comparison

**Symptom:** nothing rasterised. The "sky" you saw was the untouched-clear branch
of the lighting pass, not geometry.

Reverse-Z maps near→1 and far→0, so the clear value is `0.0` and the test must be
`depthCompare: 'greater'`. Using `less` rejects every fragment **including the
clear**, silently, forever.

**Rule:** if the world is missing but the sky renders, this is the first thing to
check. Same failure shape as a camera pointing the wrong way; the difference is
that the sky is *too* correct.

**Related:** the shadow maps deliberately stay in **conventional** depth
(clear `1.0`, `less`) even though the camera is reverse-Z, and the lookup
converts with `1.0 - proj.z`. Keeping the shadow pass on the conventional
convention is one subtraction instead of four sign changes. Do not "unify" these
without a reason — the working combination is commented in `common.wgsl`.

## 4. WGSL struct layout is an ABI with the TypeScript writer

**Symptom:** every scalar uniform was wrong by exactly 16 floats, so the render
target size was being read as weather data and the screen was 48×17 px.

`struct Frame` has nine `mat4` (144 floats) before the `vec4` block. The writer
started at float 128.

**How to catch it:** `struct Frame` in `common.wgsl` and `writeFrameUniforms`
in `renderer.ts` are two halves of one contract. If you add, remove, or reorder
a field, change both. The `FRAME_UNIFORM_SIZE` constant in `gpuutil.ts` must
still cover the struct.

**Debug habit:** `window.__syzygy.frameUniforms()` returns the raw block as JSON.
When a uniform is suspected, *read it*. It would have solved this in one run.

## 5. WGSL forbids calling an entry point

**Symptom:** every shot went black right after adding a debug view.

A function marked `@fragment` cannot be called from another entry point. The
module fails to compile, and because the pipeline creation error is asynchronous,
the app kept running with a dead post chain.

**Rule:** debug views are plain functions dispatched from the real entry point.
This is now enforced by the harness hard-failing on shader errors — which is the
only reason it was found quickly the second time.

## 6. Colour space must be consistent within an algorithm

**Symptom:** the whole frame was red, then rainbow-iridescent on every surface.

The TAA neighbourhood min/max was computed in **RGB** while the mean and sigma
were computed in **YCoCg**. The clamp bounds crossed zero per channel, producing
negative green and blue.

**Rule:** pick one space per algorithm and never mix. The TAA resolve is now
YCoQg end to end, converting back only at the end.

**Corollary:** negative HDR values are always a bug. `max(..., vec3f(0.0))` at
the end of a resolve is a band-aid over a space error, not a fix.

## 7. A 3-float stride over a 4-float array

**Symptom:** every surface in the world had an arbitrary saturated hue. This was
the longest hunt in the project — several hours, and the eventual cause was a
single index expression.

`uploadMesh` interleaves 12 floats per vertex. Colour is 4 floats per vertex
(rgb + emissive mask). The colour index used `i * 3` instead of `i * 4`, walking
diagonally through the array and decorrelating the channels.

**How to catch it, generally:** when a data-placement bug produces *colour*
corruption rather than geometry corruption, suspect a stride mismatch, and check
the producer's actual element count rather than the consumer's assumption.
Write a tiny Node script that imports the builder and prints array lengths
against `vertexCount` — that took thirty seconds and would have saved the morning.

## 8. Procedural detail applied to the wrong object

**Symptom:** pedestrians were drawn (2550 instances issued, valid matrices) and
completely invisible.

Pedestrians used `MAT.DIFFUSE`, which routes into the **building facade
synthesiser** — a 3.1 m × 3.6 m window grid. A 1.7 m person falls entirely inside
one window cell and is shaded as dark glass.

**Rule:** a material id is a contract about scale. Anything much smaller than a
building needs its own material, not a shared one. `MAT.PLAIN` and `MAT.STREET`
were added for exactly this.

**Corollary:** the same class of bug hid in `MAT.STREET` — the ground plane was
running the facade synthesiser on a *horizontal* plane, producing windows and
shopfronts across the road.

## 9. Snap-to-feature collapses a distribution

**Symptom:** 2500 pedestrians, all in a single 11 m line.

Snapping every sampled point to the nearest street *centreline* looks correct. In
a dense city the nearest street is the same one for most of a view cone, so the
entire population converges onto it.

**Rule:** when snapping a point onto a constraint, snap to the **boundary**, not
the ideal point. Stepping only as far as it takes to reach the kerb preserves the
sampled distribution and corrects only the genuinely unwalkable part.

**Diagnostic that found it:** a top-down pose 3.4 m above the crowd centroid. The
crowd was plainly visible, in a line. Population-centroid and population-spread
numbers in `stats()` would have shown it sooner.

## 10. Signs and conventions in the data you did not write

**Symptom:** a street-placement hill-climb walked confidently away from every
street and into the middle of blocks.

`roadClearanceAt` returns `dist - width/2`, so it is **negative inside a
carriageway**. The code assumed "positive means on the road".

**Rule:** when consuming another module's output — especially a subagent's —
check the sign convention against its own tests before building on it. Read the
doc comment *and* sample the function:

```ts
// in a scratch script, not the app
roadClearanceAt(0, -40, SEED)   // -16.6  <- on the street
roadClearanceAt(100, 0, SEED)   //  +6.1  <- in a block
```

## 11. "Deactivated" logic that can never fire

**Symptom:** the crowd lived at 2550 agents and rendered none of them in view.
The recycle loop was gated on a population *deficit*, which reaches zero and
stays there — so the arm that retires distant agents could never run again.

**Rule:** coupling two independent rules into one conditional is a latent
dead-branch. Refill and retire must be separate, and both must always evaluate.
Here the second condition ("behind the viewer") was a *tolerance*, and a generous
tolerance let a clump 25 m behind the camera stay immortal.

**Diagnostic that found it:** `population()` returning centroid, spread, and
min/max Y. "2550 alive, 0 visible" is a one-line contradiction; it took a while to
actually look at.

## 12. A diagnostic that lies

**Symptom:** `inView()` reported 0 instances in the camera cone, repeatedly,
even in a frame where a dense crowd was plainly visible.

It was wrong, and I kept believing it for several iterations.

**Rule:** when a diagnostic disagrees with a screenshot, the *diagnostic* is
wrong — a screenshot is ground truth. Corroborate a measurement against pixels
before you act on it, and delete diagnostics that have lied once.

**Still open.** `inView()` is in the tree at `crowd.ts:326`, called from
`main.ts:431`, along with the hardcoded `targetsW/1600, targetsH/900` arguments
that exist only to feed it. Deleting both is work item **F3** in
[`HANDOFF.md`](HANDOFF.md). F1 below makes the case sharper: two counters in that
same file are currently measured disagreeing, so a third unverified opinion in
the stats line is noise.

## 13. Tools that quietly do nothing

- **`vite preview` serves a stale `dist/`.** The capture harness once produced a
  full set of "passing" screenshots of a build from before the fix. The harness
  now always uses the dev server.
- **An LSP binary on `PATH` proves nothing.** `typescript-language-server`
  looked broken because my probe used newline-delimited JSON; LSP stdio uses
  `Content-Length` framing. `tools/lsp-check.mjs` now drives a real handshake.
- **A subagent returning an empty result did nothing.** Twice. `ls` the paths
  before believing the report.
- **A tool that reports success may have done nothing at all.** Twice, both in
  this project, both caught only by checking the *effect*:
  - `git filter-repo --path 'inspirations/**/*.mov'` (the directory was
    misspelled `inpirations/` at the time) — `**` as a `--path` rather
    than `--path-glob` — printed "Completely finished", rewrote nothing, and left
    every `.mov` blob reachable. The tell was the *speed*: 0.07s for 700MB.
  - **`.gitignore` containing `inspirations/**/*.mov` matched nothing at all** on
    git 2.54 (Apple Git-157). Verified in a scratch repo: `git add -A` staged
    all nine 670MB videos. The bare pattern `*.mov` works. This one was worse,
    because the entry had been *committed* with a comment explaining the benefit
    it did not deliver, and it survived a history rewrite and a `git rm --cached`
    that masked the fact that the ignore itself was inert. The .git now hit
    720MB from staging before it was caught.
  **Verify by checking the effect on a known file** — `git check-ignore -v <path>`
  for ignores, and a known-absent object for rewrites — not by the exit status,
  and not by the comment beside it.
- **A shell wrapper can report things that are not true.** The `rtk` prefix
  returned "No such file or directory" for a directory that existed, and
  `git ls-files | grep -c` returned 0 for files that were in the tree. It also
  silently swallowed commands when `$PATH` had been trimmed. When a result
  contradicts another result, re-run it with plain `/usr/bin/git` and plain
  `ls` before believing either.

## 14. A ffmpeg graph that drops half its inputs still exits 0

**Symptom:** `tools/compare.mjs` printed a clean summary and wrote a valid PNG.
The grid was wrong — every tile showed the same frame, and the `REFERENCE`
column showed our own render instead of the reference video.

**Cause:** a refactor replaced `-filter_complex` `${graph};${vstackChain}` with
just `filter`, and `graph` — the half that actually *defines* the tile labels
`[r0c0]`…`[r2c2]` — was never passed to ffmpeg. The labels went undefined, and
ffmpeg produced a plausible image from the surviving inputs instead of
erroring.

**Rule:** a command that succeeds and emits an artifact is not evidence the
artifact is correct. Check the artifact against a known-different source. Two
related traps, both fixed here:

- The chain ended on a *labelled* pad, and ffmpeg auto-maps only *unlabelled*
  outputs — so single-row grids failed to bind. Always end on an explicit label
  and `-map` it.
- `vstack` rejects `inputs=1`, so a one-row grid needs a `null` passthrough.

Never crop the image under test to fit a tile; crop the *reference*. Cropping
the subject hides the thing you are trying to look at.

## 15. Two predicates that look identical and disagree

**Symptom, measured in one frame from the `01b-crowd-closeup` pose:**

```
crowd: 250              // visibleCount, from Pass B   (crowd.ts:265-276)
instancesCount: 0       // buildInstances()            (crowd.ts:794-841)
```

Both apply the same guard (`f[o + F.active] < 0.5`) and the same test
(`dx*dx + dz*dz > viewRadius*viewRadius`) to the same `cam`, in the same
`update()`, with `viewRadius` unchanged between them. They cannot both be right.
**This is unresolved** — see [`HANDOFF.md`](HANDOFF.md).

**Rule:** when two code paths compute the same predicate, do not reason about
which is wrong. Print both, plus the raw per-agent state for a handful of
agents, and find the agent where they diverge. The disagreement *is* the bug;
picking a side by inspection just relocates it.

**Proposed fix:** work item **F1** in [`HANDOFF.md`](HANDOFF.md).

## 16. The camera was not where the diagnostic pose said

**Symptom:** the `01b-crowd-closeup` and `01c-street-crowd` poses both show an
empty street. Chased for several iterations as a *rendering* bug — suspected
entity winding, then G-buffer culling.

The poses are hardcoded at the world origin (`position: [0, 2.4, -40]`), while
the crowd centroid sat at `(974, 46)` — roughly 975 units away, well outside
`viewRadius: 190`. The pose was never looking at the crowd.

**Rule:** before suspecting the renderer, confirm the camera and the subject are
in the same place. A "close-up" diagnostic that is 975 units from its subject
will read as an absence forever. When adding a diagnostic pose, derive its
position from live state (centroid, nav node, camera) rather than hardcoding it
— this is now a standing decision, D21, and the fix is work item **F2** in
[`HANDOFF.md`](HANDOFF.md).

---

## Working norms that held up

- **Measure before theorising.** Every bug above cost far less time to measure
  than to reason about.
- **Run a control.** The culling theory died in one run at
  `pedestrian:0/180` under both modes. A control is cheaper than an argument.
- **Build the diagnostic before the fix**, when the symptom is visual.
- **Compare against the reference frames** when the question is aesthetic. They
  settled several "is this a bug or a choice?" arguments immediately. Use
  `tools/compare.mjs` rather than opening two images in sequence.
- **Hard-fail the harness on shader errors.** Anything that lets a broken run
  report success will eventually be believed.
- **Commit at a natural boundary**, with the reasoning in the message. Both
  commits here explain *why*, not just *what*.
- **Correct the docs when measurement contradicts them**, even mid-task. A
  document that asserts something false is a landmine for the next session, and
  the `1481e47` claim that the crowd renders is exactly that.
