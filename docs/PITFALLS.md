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

## 17. Half the building was never built: centre-relative vs base-relative

**Symptom:** "sky rises look like they're on stilts — they don't look like real
building structures." A plinth, a gap with hairline ribs in it, then the tower
mass starting in mid-air.

**Cause.** `b.position[1]` is a building's **centre**. The local→world mapping
maps local `y` straight onto it, so local `y = 0` is the middle of the tower. The
setback tier loop started at `y0 = 0`, so the shell began at mid-height and the
entire lower half of every building in the city was never emitted.

**This was five bugs wearing one coat**, all in the same function or its caller:

| where | fault |
| --- | --- |
| tier loop | shell started at the centre — bottom half missing everywhere |
| rib pilasters | ran base→centre, i.e. pilasters in the void where the shell belonged |
| tier arithmetic | intermediate tiers used `totalH/tiers`, last used `top - position[1]` (half height) — 3-tier towers overshot their own roof by 112m then emitted a negative-height crown |
| lean normaliser | divided about the centre, so every tower bowed outward at the bottom and inward at the top instead of rising straight and tilting |
| rooftop marker light | `position[1] + halfExtents[1] * 2 + 2` — a full half-height above the roof, +302m on the tallest buildings |
| top-cap guard | `if (y1 > 0)` meant "above the centre"; once `y = 0` became the base, the same expression silently changed meaning and dropped a cap |

**Rule:** when a value can be read as centre-relative or base-relative, name it
once and never re-derive it. `yBase = -halfExtents[1]; yRoof = +halfExtents[1]`
at the top of the function, and every vertical dimension written against those,
would have prevented all six. Mixing `position[1]` and `halfExtents[1]` in
different frames is the smell.

**Why it survived review:** **no pose in the capture harness could see it.** Every
pose was aerial or angled upward. A defect visible in no screenshot is a defect
that receives no review. A ground-contact pose now exists (`01a-building-base`),
derived from live generator state — and the first version of it did not work
either, so *the pose that catches this class of bug is itself subject to it.*

## 18. A counter that moved is not evidence of the cause

**Symptom:** after the stilts fix, scene triangles read 4.63M → 5.13M, and the
commit message claimed that was "consistent with the missing geometry now being
emitted."

**It was not.** A review agent baked 49 chunks at identical seed and LOD, old
versus new: 3,408,278 vs 3,407,928 triangles — **−350, or −0.01%**. The fix
*moves* geometry; it does not add any. The scene-level figure rose because
frustum culling and streaming admitted a different set of chunks, which has
nothing to do with the fix.

**Rule:** before reading a counter as support for a change, ask whether that
counter *could* distinguish the change. Then reproduce it at fixed seed and
fixed LOD, where the only variable is the code. A scene-level aggregate moves
for a dozen reasons; only a controlled bake isolates the cause.

This is [`PROCESS.md`](PROCESS.md) rule 3 — success is not evidence of
correctness — and it was committed by an agent that had itself written that
rule. The evidence that actually established the fix was a **frame with a
control**: same pose, same seed, `citymesh.ts` reverted, and the stilts
reproduced on demand. Take the control, not the counter.

---

## 19b. Two representations of one value, one of which parses to a different number

**Symptom:** `capture.mjs` wrote `?seed=0x5e7a17`. `main.ts` read it with
`Number.parseInt(q.get(k) ?? '', 10)`. **`parseInt('0x5e7a17', 10)` is `0`** — with
an explicit radix of 10 it stops at the `x`. It is finite, so the `0x5e7a17` default
at the call site was never used and `BOOT.seed` was 0.

Every capture in a session rendered **seed 0**. Every CPU-side probe written against
those captures measured **seed 0x5e7a17**. The market spine derived on the CPU was at
`[1.16, 0, -9.97]`; in the rendered city the nearest market lantern to it measured
**47.5m** away. Both numbers were correct about their own city, and neither was
about the city in the frame.

The cost: every coordinate anyone aimed at in that session was a coordinate from
elsewhere, so every "the renderer disagrees with my measurement" conclusion drawn
from them was a comparison across worlds. Six ABI fixes survived — they are in
shared code paths and are real — but none of the *evidence* for them did.

**Rule: a value crossing a boundary has one representation, and a round-trip test
is not optional.** The fix went on the writing side (decimal, because the same parser
also reads decimal keys) rather than in the parser, because a hex-aware `int()` has
to special-case one key and a writer that emits hex has to be right every time. The
test is three assertions: one named constant, no `0x` in any query string, and the
written value parses back to itself.

### The same lesson at two depths

This is §19a one level down, and the pair is worth keeping together:

- **§19a** — the *coordinate* was wrong. `c.w = -3.58` for the very lantern a pose
  was aimed at, so the measurement was structurally unable to see its subject.
- **§19b** — the *world* was wrong. The coordinate was fine; it belonged to a
  different city.

Both are "the diagnostic and its subject were not the same thing", and the second
is worse because it invalidates the frame rather than the measurement — the two
things being compared were never the same subject at all. A measurement can be
checked against its own arithmetic; a frame cannot be checked that way.

**So the check, before trusting any targeted comparison: is the subject in this
world, in front of this camera, at this LOD?** Print all three. Every instance of
this family in one session would have been caught by those three numbers before a
capture was spent.

## 19a. The light was behind the camera, and it took a round to notice

**Symptom:** a night market pose aimed straight down at a lantern's pool. The pool
was visible. The lantern was not, and neither was any warm ground. Reported across
two rounds as "the bin is full of lights that are 140m away" — which was true, and
was treated as the finding.

`lightbin.wgsl` culls any light with `c.w <= 0`, and the camera stood directly
*under* a lantern 3.58m above it looking down: **`c.w = -3.58`.** The subject was
behind the camera, so the binner correctly refused to put it in any tile, and every
measurement taken from that pose was structurally incapable of seeing the thing it
was aimed at. The pool was in frame; the lantern was not; the diagnostic needed
both.

This is §16 again, with a light instead of a camera — and it is worse, because §16
at least put the camera somewhere wrong while the *scene* was right. Here the whole
frame was legitimate and the subject was outside it.

**Rule: before trusting a targeted measurement, print the subject's clip-space
coordinate.** One number — `c.w` — would have caught this on the first shot instead
of two rounds later, and it is the cheapest check in the project: the projection is
five lines and there is no excuse for skipping it when the pose is hand-picked
specifically to look at something.

The generalisation, which is the same lesson a fifth time in a different costume:
**a diagnostic must point at its subject, and pointing at it is a claim you have to
verify, not one you get to make.** Forms of this so far: the camera 975 units from
its crowd (§16); the camera at ground level while the subject was 46m up (round 6);
`c.w` negative for the subject (this); and the *coordinate* right but the world
wrong — captures run on `seed=0` while every CPU probe measured `seed=0x5e7a17`,
because `parseInt('0x5e7a17', 10)` is `0`. The last one is the purest form: both
sides were internally correct about different cities.

So the check, before any targeted measurement: **is the subject in this world, in
front of this camera, at this LOD?** Print it. Three numbers, and every one of
these would have been caught before a capture was spent.

## 19c. Counted, never issued — a class, not an incident

**Symptom.** `entityDrawCalls` read **0** in every capture of a session, while
`entityTriangles` read hundreds of thousands and the instance buffer held 2537
records. Instances uploaded, triangles counted, no draw call issued. That is
"counted, never issued" and it was read, correctly and reasonably, as the cause of
the crowd legibility gap.

It was not. `counter.entity++` occurred in exactly one function, `drawEntitySet`,
and **`drawEntitySet` has no callers**. The crowd and the fleet are drawn by
`main.ts`'s own `drawEntityBlock`, which calls `pass.drawIndexed` directly and
pushes to a string ledger. The counter was structurally incapable of being nonzero.

And the draws *were* issued, provably from the frame itself: `drawEntityBlock`
returns `(indexCount / 3) * count` and only after calling `drawIndexed`, so a
nonzero `entityTriangles` is proof the GPU was told. Measured before the fix:
`entityTriangles 356480`, `entityDrawCalls 0`.

### The sibling: a counter that outlives the thing it was reporting

`lightDelivery.culledByDay` said lights had been culled by a day test. The cull was
removed in `cd7b7de`. The field was not, and every frame of a 12-frame presentation
set reported `"culledByDay": true` beside `delivered 1083` — a **positive false
claim**, in the provenance file a reviewer reads to decide whether a frame is real.

This is the first instance in the class that actively misinforms rather than
merely under-reports, and it is the most dangerous, because the two failure modes
are not equally recoverable. A missing diagnostic is an absence a reader notices. A
wrong one is a confident statement that agrees with nothing around it, and it will
get correct frames rejected.

The mechanism is always the same: the fix removed the *behaviour* and the
diagnostic was not in the same commit as the behaviour. There is no code path where
`culledByDay` could become true, and it was still true on every frame.

**Rule: when you remove the thing a diagnostic was reporting, delete the diagnostic
in the same commit.** `PROCESS.md` rule 6 — fix the document in the same change —
applies to a published stat exactly as it applies to a document, and a stat is read
more literally than prose because it looks like a measurement.

Preferred over deletion, and what was done here: replace the claim with the
quantity underneath it. `culledByDay: boolean` became `dayPhase: number`. The
reviewer's question is "is this frame dark", the quantity answers it, and nothing
reports a filter that does not exist.

The counter is now `dayPhase`, the local that fed it is gone, and ten assertions
in `src/render/__perftest.ts` cover it — including that every `lightDelivery` field
is assigned in the one place the stat is built, which is the general shape of the
check: *a declared field that is never assigned reads its initial value forever and
looks deliberate.*

### The class

| | counted | actually happened |
| --- | --- | --- |
| `arrayLength(&lights)` | the allocation | the write was 296 of 3072 |
| `byDay = dayPhase > 0.55` | "is it day" | "should authored lights exist" |
| `entityDrawCalls` | callers of an uncalled function | draws issued by another function |

**Rule: a counter must increment on the path that reaches the hardware, or it is a
second diagnostic that lies.** And the specific poison in all three: **a sibling
counter read healthily.** `entityTriangles` was true, so `entityDrawCalls` had to
be wrong rather than the frame. `stats.lights` was true, so `meanCount 0` had to be
the binner's. A broken counter is easy to disbelieve; a broken counter next to a
correct one is not.

**So a pair of counters needs a cross-check, not a second opinion.** `entityTriangles
> 0` with `entityDrawCalls == 0` is a contradiction, not a scene description, and
it should have been read as one the moment both numbers were on the same frame.

§12's companion row: *a counter that lies is worse than no counter, because it
answers a question you did not ask with a number that is merely plausible.* The
three instances above all had a plausible sibling, and the sibling is what made
them survive review.

## 19. A measurement taken mid-edit is not a measurement of the repository

**Symptom:** a doc-sweep agent reported that the project's own verification gate
was broken on a fresh clone:

```
npx tsc --noEmit        3 errors in src/render/gpuutil.ts
```

and attributed the errors to commit `81f34ba`, months earlier — concluding that
"the repo's documented 'must be clean' gate fails on a fresh clone", which is
`PROCESS.md` rule 3's exact shape: a check that reports a result nobody reads.

**It was not broken.** `gpuutil.ts` had not been modified since `81f34ba`, and
with a clean working tree `npx tsc --noEmit` produces no output at all. The
errors were real *at the moment they were measured* and they were real for the
wrong reason: another agent was mid-edit in a caller, TypeScript resolved an
overload mismatch at the **declaration** in `gpuutil.ts`, and the report read the
declaration's file as the culprit. Stashing the reporter's own change and
re-running — which it did, correctly — reproduced the errors, because the other
agent's half-finished edit was still on disk.

**Rule.** In a repository with more than one agent writing to it concurrently,
establish three things before reporting that the tree is broken:

1. **Is the working tree clean?** `git status`. Uncommitted changes are somebody
   mid-flight; that is the default explanation, not the alternative.
2. **Is the file you are blaming actually modified?** `git log -1 -- <file>`.
   If it has not moved since an old commit, a new error *in* it came from
   somewhere else.
3. **Did you attribute the error to a commit, or to a caller?** TypeScript
   reports overload failures at the declaration. The blame usually belongs to the
   call site, which is the file that is actually being edited.

**This is the general lesson of every entry in this file, applied to the
measuring instrument rather than to the measured.** A silent wrong result looks
exactly like a real one, and concurrency manufactures silent wrong results
routinely and for free. The discipline that catches it is the same as always —
*check the artifact against a source you know differs*, and distrust any
measurement whose result is convenient enough to need explaining.

Concretely, here: `git status` was clean and `tsc` was silent. Two commands,
both of which the reporting agent could have run and neither of which it did,
because it had already decided what the errors were.

---

## 20. The check existed, in the branch nobody was in

**Symptom:** `--pose=09-market-down` printed

```
PASS   1 shot(s) · 36.6s
```

and wrote a frame of a rooftop, 444 m above the ground, from a pose defined at
2.6 m looking down a market aisle.

**It was the tool lying, twice over, and the second lie is the one worth
remembering.**

`--pose=<substr>` pushed the substring onto `opts.poses`, and `opts.poses` is
read in exactly one place — inside the `if (opts.sequence)` branch. A bare
`--pose=` fell through to the single-shot branch, which never called `setPose`.
It warmed, settled 45 frames, photographed wherever the free flight camera was
parked, wrote `requested: null`, and printed PASS. Meanwhile the harness already
had a requested-vs-held check, with tuned tolerances and a paragraph explaining
why `fov` must not be compared — it just lived in the other branch.

The frame also had the wrong weather. `09-market-down` is a night pose
(`time: 'night'`, `exposure: 1.28`, night sky). The stats on the frame I had
just been fooled by read `dayPhase 0.707`, `sky: clear`, `exposure 0.92` — the
daylight control's values. The single-shot branch never called `setTime`,
`setWeather` or `setLens` either. The sequence branch has applied that ordering
in the sequence `time → weather → lens → pose` since a frame was once mislabelled
noon, with the reason written in a comment directly above it. One branch got
the lesson; the other was written before it and never revisited.

**Why it survived so long.** `AGENTS.md`, `README.md` and `PROCEDURES.md` all
present `--pose=canyon` as the one-shot command, and every agent working
street-level visuals is instructed to use it. The cheapest diagnostic in the
harness was the one that could not fail. Rule 4's mechanical check had been
added, extended to a second class (`PITFALLS.md` §16), and still left a whole
code path uncovered — because rule 4 was implemented *per call site* rather
than *per capture*.

**The generalisation.** A guard is only as good as its coverage, and coverage is
not the same as existence. When a check is correct, the question to ask next is
"which paths reach the frame without passing it?" — not "is the check right?".
A rule enforced at one call site is a rule with an exception you have not
noticed.

**Second lesson, smaller and more general: read the stats off the frame you are
about to believe.** The `requested: null` in the sidecar was visible in the
output and was not read, because a `PASS` had already been interpreted as
"the tool worked". A null there is a statement about the harness's own
bookkeeping, and it is worth more than the pixels next to it.

Fixed in `b2ea352`: the branch resolves the pose, applies phase → weather → lens
→ pose, runs the same held-camera check with the same tolerances, and prints the
agreement next to the frame rather than only on failure.

---

## 21. Four mechanisms proposed on plausibility, all four killed by measurement

**Symptom:** a single visual defect — stall frontages unreadable at night —
attracted five successive confident explanations over five rounds. Every one was
mechanically reasonable. Every one was wrong.

| Proposed | Verdict | What killed it |
|---|---|---|
| Lights never reach the buffer | refuted | 933/933 delivered, 0 starved |
| Lanterns hung too high for a vertical face | refuted | drop confirmed baked; flank problem unchanged |
| Stalls sit beside the lanterns, not under them | refuted | median 4.92 m, **zero of 27 within 2 m**, at N·L 0.874 |
| Cloth albedo too dark | exonerated | frontage authored **1.7×–9× brighter** than the deck |
| `matAo` dimming vertical faces | exonerated | 0.594 vs 0.798, and it multiplies the **ambient term only** |

Then the measurement all of it rested on was voided: the "known roadward stall
faces" were projected onto empty aisle, 2.36 m from the nearest mesh vertex.
Byte 4 with R−B −6.9 was **night sky**. The day frame's luma 119 at the same
pixels was bright facades behind. So the headline finding — "a face receives 12%
of what its geometry predicts" — was a lit deck compared against sky.

**Two of the five were proposed by the orchestrator**, including one where a
reviewer's recommendation was relayed without first checking whether it could
work, and one where a "pale paving deck" was asserted without printing the value.

**What actually generalises.** None of these were reasoning failures; they were
*substitution* failures. In each case a quantity that would have decided the
question was available and cheap, and a plausible story was written instead:

- print the albedo; don't assume which surface is darker
- print the AO term for this surface class; don't assume which term applies
- ray-cast the sample point; don't pick it by eye from a dark frame
- print the falloff curve against the emitter spacing; don't assume intensity is
  the lever

The one round that went right did it in the opposite order: it built the probe,
then **validated the probe against a number someone else had measured by hand**
before believing any of its output.

**Corollary — a prediction is worth more before the round than after it.** The
next proposal in this thread is recorded in `ROADMAP.md` R2 with its predicted
numbers and its refutation condition *written down first*, precisely so that a
refutation is as cheap to spot as a confirmation. Three of the five above would
have died at the prediction step instead of costing five rounds.

**The other half, and it is the half that actually bit.** A measurement is only
as good as the point it was taken at, and "I chose this pixel because it looked
like a stall face" is not a measurement method — it is a way of guaranteeing a
result. Sample from geometry. Project through the renderer's own matrix. Then
check the instrument against a known quantity before trusting it.

---

## 22. The measurement was never answering the question

**This is the most expensive entry in this file, and it is not a code bug. It is
a way of working that produced correct measurements of the wrong thing.**

**Symptom.** One unlit night market frame. Over nine rounds: byte targets, N·L
ratios, warm/cool separation histograms, distance-band medians. Six mechanisms
proposed, **all six refuted**, each refutation reported as a successful round.
Net: no fix, fifteen captures, and a defect report against the work that only
surfaced in round nine.

**The owner's correction**, given at the session's close:

> Applying hard quantifiable scores toward a goal that is considered subjective,
> on a product that isn't yet remotely presentable let alone MVP, is not an
> acceptable practice.

**The mechanism.** Not carelessness. **Substitution.** "Warm-dominant versus
cold-dominant" is a *proxy* for "does this read as a lit market". Six rounds were
spent moving the proxy, because a proxy is measurable and measurable is the only
thing an agent knows how to trust. The substitution was never checked — nobody
ever asked whether moving the proxy moved the thing it stands for.

Three compounding errors, each individually invisible:

1. **Refutation read as progress.** A clean negative result is only good news if
   the round's question was the right one. Six in a row is a signal to stop and
   ask what is being measured, not a queue of six successes.
2. **The instrument's own defect reported as insight.** Round nine found the
   sample population was mostly non-market floor — 2.36 m of empty aisle where a
   stall face should have been, and the "byte 4" was **night sky**. That is a
   finding about the *instrument*, and it invalidates six rounds. It was written
   up as "the real shape of the problem".
3. **Rule 1 misread as unconditional.** "Measure, do not reason" is about bugs. A
   reverse-Z comparison that renders the world as empty sky has a right answer. A
   market's mood does not. Applying an engineering instrument to a taste question
   produces clean, rigorous, entirely useless results.

**The rule this bought**, now in `PROCESS.md` rule 1 as *"…but only where there is
a right answer"*:

> Atmosphere, mood, "does this read as a lit market" — these have no right answer
> to measure toward. The instrument is **the frame review**, by a non-implementer,
> against the reference sheets, judged by eye. Numeric targets for aesthetic
> properties are **derived after** a frame is approved, never invented before one is
> requested.

**Why it took nine rounds to notice.** Every intermediate output looked healthy.
The probe validated. The refutations were clean. The histograms were
well-constructed. Nothing errored, nothing was implausible, and by every signal
this project normally trusts the work was going well. The failure was invisible
*by construction* — which is the strongest argument for the frame review that was
skipped, since a reviewer's `more work needed` would have arrived in round one.

**The generalisable form.** Before optimising toward a number, ask: **where did
this number come from?** If the answer is "I chose it", stop. If the answer is "a
reviewer approved a frame and this was measured from it", proceed. Most numbers in
this project came from the second kind — the byte that broke the reverse-Z bug, the
119 luma on the day control. The night-market ones came from the first kind, and
they were invented specifically because inventing them felt like rigour.

---

## 23. One missing bind turned the whole city into pavement

**Symptom:** every tower read as a flat tinted prism, near and far, day and night.
`facade()` — windows, floor ledges, grime, shopfronts, lit interiors, 150 lines —
had never reached a pixel. Nothing failed; the frames looked like a style.

**Cause:** `drawChunks` bound `groundInst` (`MAT_STREET`) for the ground plane and
never rebound `identityInst`, so every chunk after it drew as street deck through
`groundSurface()`. Found 2026-10-10 by painting each fragment branch a flat colour:
all buildings came back green (deck).

**Catch it next time:** when a shader feature "doesn't show", paint the branch
before tuning the feature. Per-draw state (vertex buffer 1 here) persists across
draws in a pass; every function that binds it must restore what its caller set.

---

## 24. The pose stood beside its subject, and the refusal blamed the wrong term

**Symptom.** `derivePose('street-crowd')` refused with "crowd is 4.1 m off the view
axis at -0.2 m, outside the 101.9 m reach", while 2,550 bodies stood around the
camera. `__selftest_spread` threw, and `__selftest_density` printed `VIOLATIONS 1`
with exit 0. `c42abff` recorded both as passing or pre-existing. Bisect: its parent
`8fc332b` derives the pose.

**Cause.** `street-crowd` had `back: 0`, so the camera stood at the centroid's own
foot-point, abreast of its subject. The centroid's projection on the view axis was
~0 by construction. Its sign depended on which footway the centroid fell on, because
the view axis angles ~7° inward. The crowd changes in `c42abff` removed the 1-D birth
line and centred the crowd on the camera's own footway (centroid z 0 → 20), which is
correct under D26. That flipped `along` from +4.1 to -0.2 m. The message reported the
reach, which perp 4.1 m satisfied; the failing term was `along > 0`.

**Fix.** The corridor pose stands 30 m upstream, with position and lookAt translated.
The refusal message names the term that failed. The market self-test asserts that
centroids on both footways derive with the subject ≥ 10 m ahead. Its old blind
control was blind only *because* of this defect: from the abreast camera it was
82° off-axis, but from the corrected pose it is 12° off-axis with 48/48 samples in
frame. The control was therefore replaced by a crowd 80° off-axis against a 42°
half-frame. Mutations fail in both directions (back 0; check forced true).

**Lessons.** A refusal whose printed numbers satisfy its own condition is reporting
a different term. A negative control that only fails under the bug proves nothing
after the fix; re-measure it. A suite that exits 0 on `VIOLATIONS 1` will be
reported as passing; read the line. Bug wiki: `syzygy-ts-corridor-pose-abreast-001`.

---

## 25. Thirty-nine thousand props, and most of them inside the walls

**Symptom:** a vision review found street walls bare: no AC units, signs, planting. The
generator placed tens of thousands of each, and every count and budget looked healthy.

**Cause:** three frames disagreed. Placement offset props along an unrotated wall
normal, slid them along world x on every face (through the wall on x faces), and used
the base footprint for every tier; the bake ignored each prop's rotation; tower tiers
were rolled at bake time from the chunk RNG, so the generator could not know them.
Measured: 32% of facade props on their wall, 39% buried, 29% floating.

**Fix:** one definition of a building's surface (`towerTiers`, `buildingPoint`) used by
both the shell bake and placement, and a self-test that every facade prop is on its
tier's wall. **Catch it next time:** a count of emitted items is not evidence they are
visible; measure where they are relative to what they attach to.

## 26. No time of day lights a −z face

**Symptom:** a feature pose (scaffold, terraces) read flat and grey-green "in shade"
at noon, and moving the clock did not help.

**Cause:** `sunDirection` is `(cos az · ce, sin el, sin az · ce)` with elevation
`sin(az) · 1.15 − 0.06`, so the sun is above the horizon only while `sin az > 0`: its
whole path stays on the +z side. A face whose outward normal points −z never gets
direct sun; at noon the sun is due +z, so ±x faces are only grazed (morning lights +x).

**Fix:** pick the subject by its face normal (`towerTiers` + the face's local axis
rotated by `rotationY`), not by position: pose 12 moved to a scaffold facing +z.
**Catch it next time:** before tuning a material that "reads in shade", check the
face normal against the sun path.

## 27. A crowd reshuffle reported as a regression

**Symptom:** a before/after review found a pedestrian standing at the hero lens in the
"after" frame and blamed the change under review.

**Cause:** the crowd seeds agents frame by frame, so the near crowd differs between any two
`--hero-pair` runs, on the same code too. Two independent runs are not a controlled pair.

**Fix:** shoot the "after" hero pair from the "before" run's saved actors:
`node tools/capture.mjs --hero-pair --scene=<before>/_scene.json`. Replayed, the pair
differed only where the code changed.

## 28. Furniture counted as kerb faces

**Symptom:** after D30 added barrels, pots and chairs to footways, the citygen self-test
failed "kerb faces are not on the carriageway edges" (p50 0.17 -> 0.52 m). No kerb had moved.

**Cause:** the check classified a kerb face as any ground-bake vertex below 1.5 m with a
sideways normal. Every side of every piece of furniture matched, so the metric was always
partly a furniture statistic, and adding furniture on footways moved it.

**Fix:** classify by the authored surface tag (`decodeGroundSurfaceTag(...).surface ===
'kerb-face'`). Real kerb faces: p50 0.00 m, p90 0.81 m. **Catch it next time:** when a
check fails after a change to something else, run the base as a control first (it passed),
then ask what the check's population actually contains.

## 29. A new light source blacked out an old one

**Symptom:** review 6 found the market aisle at night near-black (pose
`09-market-aisle-night`, 6.3% -> 36% near-black); the lantern cores still glowed.

**Cause:** footway braziers were given a fire light, spent from the chunk's 48-light ground
budget as each trace was emitted. Market lanterns are adjudicated afterwards from what is
left, middle of the spine first, so the spine's ends lose. The review camera stands at the
origin, a chunk corner, which is the end of every adjacent chunk's spine stretch. Chunk
(0,-1) dropped 11 of 48 lanterns, the ones over that aisle. The per-tile bin cap was the
first theory and was refuted by measurement (busiest tile 61 of 96, none refused).

**Fix:** brazier lights queue behind the market (`pendingFire`). `__selftest_footway.ts`
asserts every spine chunk lights all its lanterns. **Catch it next time:** a shared budget
has a spending order; adding a consumer can starve a later one that did not change.

## 30. The night skyline "lost its roof lights": capture history, not content

**Symptom:** review 6 compared a 3-pose base run with a 12-pose after run and found the
night skyline's roof-edge lights halved (warm-bright 0.6% -> 0.3% in the upper frame).

**Cause:** the last pose of the long run inherited far chunks at LOD 2 (`lodHistogram
[9, 33, 123, 0]`); the base had them at LOD 1. Shot with the base's own sequence, the after
frame reads 0.6% with `[9, 140, 0, 0]`. **Catch it next time:** compare frames from the same
pose sequence, and read `lodHistogram` in `_capture.json` before believing a far-field
difference.

## 31. Night in the live app was the afternoon rig: the harness never let the clock run

**Symptom:** under `npm run dev` (or `bun run dev`) the city at night was evenly lit "from
nothing"; every capture-harness night frame looked right.

**Cause:** `WeatherDirector` chose its phase rig once, in its constructor (boot is afternoon).
Only `setPhase` changed it. The live app reaches night by the running clock (`integrateWorld`,
900 s day) or the conductor's `set_time`, which writes the sun directly; neither calls
`setPhase`. So after sunset the director kept easing toward the afternoon rig: sun 3.9 below the
horizon, ambient 0.55 sky-blue, sky `clear`. The harness calls `setTime` → `setPhase` on every
pose, and every sim self-check froze the clock (`dayLength = 0`), so nothing measured the path
a user actually takes.

**Fix (`8e8f36a`):** `followSun()` in `update()` re-seeds the look when `phaseOf(world)` changes,
skipped while `setPhase` is steering. The "running clock" block in `src/sim/__selftest.ts`
fails on the old code. **Catch it next time:** when the harness and the live app disagree,
diff what the harness *calls* against what the live loop does; a self-check that freezes a
clock cannot see a bug that needs the clock. Background browser tabs draw ~1 frame/s, so
sample live state by frames, not seconds.

## 32. Orange fire rendered as a cream lamp, and a teal sign hid inside it

**Symptom:** review 6's follow-up: the old town's new wall braziers read as pale cream lamps,
not fire, and one had a teal sliver beside it (pose 14, left wall).

**Cause:** two separate faults. (1) The tonemap (`common.wgsl tonemap`) is per channel. Once red
clips, green keeps climbing, so emissive `(1.0, 0.42, 0.1) x 2.2` lands near sRGB (242, 200, 90),
which reads as cream. Bloom keys on luma, which is 72% green, so a red-only emitter does not
bloom at all. (2) The brazier spacing came out almost identical to `placeProps`' street-band
slot grid (7 m slots at 0.86 of the wall), so 44% of braziers ran through a blade sign, balcony,
AC unit or planter. The sliver was a sign seen edge-on, and it was teal because every prop was
baked with `profileFor(0)`, district 0's accent (props now carry their own `districtId`). Tinting suspects as pure emissive colours, one
kind per colour, in a single capture found it. Reading the code had pointed at the planters.

**Fix:** the flame is dark albedo times a high emissive mask, with green about 0.014 of red.
Red is pushed past the bloom threshold, and the yellow-white is kept to a small core. Braziers
hang in the whole-number gaps of the shared `streetSlotU` grid (citygen), and the bake drops
any gap a prop box still reaches. Sign panels take their own colour. **Catch it next time:**
judge a warm emitter by its green after exposure, not by its red. When two generators place
along the same wall, compare their spacing formulas. The world self-test's `wall braziers`
line fails when braziers land back on the slots (286/432 in a control run).

## 33. "Contention" with nothing running: a fanless Mac throttling

**Symptom:** a benchmark A/B found the base hero at 43-48/s, every pass up ~25-35%
at once (TAA 0.43 against 0.345, lighting 6.4-7.0 against 5.1 ms). Earlier sessions blamed
the same signature on other apps' renderers.

**Cause:** heat. This Mac is a fanless MacBook Air (Mac14,15). In the 2026-10-15 islands ABBA
the first four legs (~15 min) were clean, and the next four slowed on both sides at once.
Top CPU stayed at 12-15%, the GPU read 0% between legs, and nothing held the lock. Control:
7 minutes idle (battery 40.3 -> 34.0 °C), then the same base commit ran 59.72/s, 14.68 ms,
TAA 0.343, against 49.2/s hot. **Catch it next time:** when every pass rises at once, read
the battery `Temperature` (`ioreg -rn AppleSmartBattery -l`, centi-°C) and the Metal
`Device Utilization %` (`ioreg -r -c IOAccelerator -d 1`) before blaming another process.
Gate legs on a cool chassis, and keep each A/B pair inside one thermal state (ABBA).

## 34. Half the scaffold rooms had no windows: a face quad wound into the wall

**Symptom:** review 6 read sheet B's bolted-on rooms as "clean boxes, few windows". In pose 12
the right-hand stack showed no lit window by day and **none at night**, though every room
rolled a 75% chance of one or two.

**Cause:** `facePoint(b, face, wall, t, y, d)` runs `t` along +z on *both* x faces and along
+x on *both* z faces. `pushQuad` takes its normal from `cross(b - a, d - a)`, so one vertex
order (`t0 → t1`, low → high) faces out on faces 1 and 2 and into the wall on faces 0 (+x) and
3 (−z), where the back-face cull removes it. The scaffold decks and tarps were `doubleSided`
and hid the pattern; only the single-sided lit windows vanished.

**Fix:** `faceQuad` (citymesh.ts) builds a flat face quad and flips the winding when its normal
points away from `Q(..., d + 1)`. Every room window now goes through it. Night pose 12: 0 → ~15
lit windows on that stack. The terrace wall-shadow strip in `pushTerraces` had the same fault;
the item 4 (sheet D) work makes it `doubleSided`. `faceQuad` is the single-sided alternative.
**Catch it next time:** any single-sided quad built from a per-face helper must be checked on
all four faces. A feature that shows on some towers and not others, with the same chance on
each, is a winding problem before it is a probability problem.

## 35. A fleet on one line: every vehicle of a kind rode the first route of that kind

`TrafficSim.assign` pointed each vehicle at `byKind[kind]`, the first route of
its kind, so a city with two tram lines ran four trams on one and none on the
other; the second heavy cable car, later funiculars and every zipline but the
first ran empty. Nothing counted vehicles per line. Fixed by spreading a kind
over `routesOf[kind]` (`i % n`); the sim self-test now fails if every cable car
shares one of several lines, and checks a vehicle's line kind instead of its
altitude (village ropeways start on the ground). Recurrence sign: a line with no
vehicles on it, or a twin line busy on one side only.

## 36. Mirrored grid nodes drew the same rolls: an XOR of imul products is sign-symmetric

`imul(i, A) ^ imul(j, B) ^ imul(c, C)` often equals the same expression for
`(-i, -j)`, because `imul(-i, A)` is `-imul(i, A)`; a finalizer applied after the
XOR cannot separate inputs that already collided. The fall zone's first node hash
gave piers mirrored through the grid origin identical rolls (caught by the
self-test's duplicate-seed check); it now mixes in sequence
(`mix32(mix32(mix32(c) ^ a) ^ b)`). **Open:** citygen's `lotHash` has the same
shape: 2420 of 7260 mirrored lot pairs (33%) share a hash at salt 17. Fixing it
re-rolls every building in the city, so it is the owner's call.

## 37. Every check passed and the app still died on load: a temporal-dead-zone read through an import cycle

**Symptom:** the capture harness failed with *"vite dev did not answer on http://localhost:4190"*
and then *"window.__syzygy is missing 15s after load — the app must set `window.__syzygy = {ready,
readyPromise, ...}` before the first frame"*. The page was **blank**. No GPU error, no WGSL error, and
every static check was green at the same time: `tsc --noEmit` clean, `vite build` clean, the fall-zone
self-test printed `VIOLATIONS none`, the hygiene screen `ALL PASS`, and the pre-commit publish built
and deployed the site. Nothing said "broken"; the only thing that was missing was the app.

**Cause:** `src/render/fallvillage.ts` read `ROOMS` at **module scope** (the `CONTAINER` array) while
`citymesh.ts` was still initialising. The import cycle is
`citymesh.ts:28 → fallmesh.ts:15 → fallvillage.ts:31 → citymesh.ts`. Entering through `citymesh`
(the app's route: `main.ts` → `renderer.ts:27` → `citymesh.ts`) starts `citymesh` first, so
`citymesh`'s body has not yet run past its own `export const ROOMS` when `fallvillage`'s body
evaluates `ROOMS[1]`. ES module bindings are hoisted but temporal-dead-zone checked, so the read
throws — `ReferenceError: Cannot access 'ROOMS' before initialization` in the browser (native ES
modules), `TypeError: Cannot read properties of undefined` under the vite-node transform. The throw
happens during module evaluation, long before `main.ts` sets `window.__syzygy`, so the page dies
with nothing on it.

**Why no check could see it, and the part that is worth remembering:** a type checker cannot see an
evaluation order, and a bundler resolves the cycle happily. The *probe* that exercised the same code
**passed on the unfixed tree**, because `src/render/__probe_fallvillage.ts` enters through
`./fallvillage` — and entering the same graph through `fallvillage` works, because then `citymesh`'s
body runs first and `ROOMS` is initialised. Measured, same commit, same code:

| first import | result |
| --- | --- |
| `./render/citymesh` (the app's order) | throws — `TypeError: Cannot read properties of undefined (reading '1')` |
| `./render/fallvillage` (the probe's order) | **OK** — `pushFallVillage` is a function |

**A temporal-dead-zone fault is decided by the order the entry point imports first, so a probe can
pass on a build that the app cannot boot.** "The probe ran" is not evidence that the module graph is
sound.

**Fix:** build the palette on demand instead of at module scope — one line, and it changes no
geometry:

```ts
const containerPalette = (): Vec3[] => [
  ROOMS[1], ROOMS[0], ROOMS[4], ROOMS[9],
  ROOMS[2], ROOMS[7], ROOMS[8], ROOMS[6], ROOMS[8],
];   // used as containerPalette()[r.int(0, 8)]
```

**Catch it next time:** **a headless boot probe that asserts `window.__syzygy` answers — not a
build.** `tools/capture.mjs` already fails on exactly this, but only when someone remembers to spend
a capture on it, and by then it is buried in a run that looks like a GPU fault. The check belongs
beside the other gates: start the dev server, open it with Playwright, and assert
`window.__syzygy?.ready === true` within a timeout. A green `tsc`, a green build and a green
self-test are three statements about the *source*; a boot probe is the only statement about the
*product*, and this bug lived in the gap between them.

## 38. A counted frame with no record of its run: single-shot captures overwrite `shots/latest.json`

**Symptom:** round 3g's evidence was `shots/2026-10-22T05-39-47-18-fall-skyline.png` and
`shots/2026-10-22T05-40-06-19-fall-pile-close.png`. Both frames exist and look right. Only the
second has provenance, because `capture.mjs` in single mode writes the PNG plus **one**
`shots/latest.json`, and the next single run overwrites it. So pose 18 — the frame the round's
acceptance is counted on — had no `error`, no `lights`, no `starved`, no held `fov`, and no way to
tell whether it came from a healthy run. The implementer reported the run stamps; they are stamps,
not run directories.

**Why it was invisible:** the PNG is the artifact a reviewer opens; the sidecar is the artifact that
says the run was sound. A file exists, the frame looks like the pose, every gate is green — and the
evidence that the frame is not a transition or a partial render is gone. `--sequence` writes a run
directory and `_capture.json` for every pose, which is why the earlier rounds had this and this one
did not: the round shot two poses alone to save time.

**Rule:** any frame that will be counted, measured or judged is shot with `--sequence` (or a single
pose alone, keeping `latest.json` before the next shot). A stamp is not a run directory, and
`docs/` should cite run directories.

**Harness fix, not made:** write `shots/<stamp>-<pose>.json` next to each single-mode PNG instead of
overwriting a single `latest.json`. Left as a named gap in `STATE_2026-10-22.md` rather than an
unverified edit to the harness everything else depends on.

## 39. "The probe says identical" — a number quoted from the last document instead of run

**Symptom:** round 3i's implementer record
([`FALL_LITROWS_ROUND3I.md`](FALL_LITROWS_ROUND3I.md)) says the change is "selection
only, no new geometry", and prints "**Before (3g) and after (3i) are identical on the
probe's counts**: 1078 lit quads at lod 0, 2872 at lod 2, 93,192 bay-free triangles".
The reviewer of that round (PART 15) repeats the same three numbers as its own
independent probe run. Both are wrong, and the check is one command:

```
git worktree add -d /tmp/wt 47b5c6d^        # the round's parent
cd /tmp/wt && ln -s <repo>/node_modules . && npx vite-node@6.0.0 src/render/__probe_litrow.ts
#   1078 lit quads, 2563 m2, bay-free 93192
# at HEAD:
#   1088 lit quads, 2598 m2, bay-free 93272
```

The pick moved **+10 lit quads, +35 m² of lit area and +40 non-bay quads**. That is
not a bug in the change — the change is a *selection*, so it necessarily changes which
boxes are dressed, and "+10 bays' worth of geometry" is exactly what a selection change
does. The bug is the sentence. A selection-only change is not a geometry-neutral one,
and a number carried forward from the previous document is not a measurement of this
build.

**Why it was invisible:** the numbers were plausible, the round's real evidence (the
frame count) was correct, and the probe prints its totals among a dozen lines that
nobody re-reads. The claim that fails is the one that says *nothing else moved* — the
control, not the result. Every reviewer since round 3a has copied the previous round's
"bay-free triangles" line as the cost baseline, so one stale figure would have poisoned
the cost table for the rest of the arc.

**Rule:** when a document says "unchanged" or "identical", that is a **control claim**,
and a control claim is measured on this build, not inherited. Run the probe on the
parent commit in a throwaway worktree (the command above is the whole procedure) and
paste both outputs. `git worktree add -d <rev>` is cheap and leaves the working tree
alone — the reason to skip re-measuring is usually "I would have to rebuild", and here
you do not.


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
