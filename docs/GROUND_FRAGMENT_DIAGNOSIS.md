# Ground fragment diagnosis — the bare slab, and the LOD warning

Author: developer 1 (GPU half). Round 5.
Files owned: `src/render/renderer.ts`, `src/render/gpuutil.ts`, `src/render/citymesh.ts`,
the entity path in `src/shaders/gbuffer.wgsl`.

**One finding, one refutation.** The kerb is a misroute in the fragment shader and it is
fixed. The LOD premise I was asked to investigate is **false** — LOD 0 is reached on the
first warm pass, and the harness warning that says otherwise is blaming the wrong thing.

---

## Part 1 — The bare slab: LOCALISED, then FIXED

### 1.1 The three candidates, and which one it is

Developer 3 had already exonerated baking: kerb-face verts within 60 m = 1230/5160
(23.8%, against ~18% suite-wide), 8172 kerb-band verts project **inside** frame, nearest
7.6 m, authored contrast 2.05×. So "absent" was out before I started. The question was
which of the remaining two it was, and the orchestrator was right that they are different
fixes.

I evaluated **the shader's own gate** against real baked vertices from one chunk
(`bakeChunk(chunk, 1, 6191639)`, chunk (4,0), 41042 verts). No GPU, no capture.

```
vertices in the gate's height band, by surface class
  horizontal(deck)      6416
  vertical(kerb)        3520

--- THE MEASUREMENT ---
kerb-face verts (abs(n.y) < 0.5, in band)        : 3520
...of those, satisfying isChunkDeck              : 0        <-- ZERO
horizontal verts (abs(n.y) > 0.55, in band)      : 6416
...of those, satisfying isChunkDeck              : 6416
authored vertex-colour contrast kerb/deck        : 4.319x
```

The cause is a contradiction between two thresholds in the same shader:

| | test | meaning |
|---|---|---|
| `gbuffer.fs` (old) | `abs(n.y) > 0.55` | the only way to reach `groundSurface()` |
| `groundSurface()` | `vertical = abs(n.y) < 0.5` | what a kerb face **is** |

`> 0.55` and `< 0.5` are **mutually exclusive**. The intersection is empty, and the
measurement confirms it on real geometry: **3520 kerb-face vertices, 0 admitted.** The
kerb branch of `groundSurface()` was unreachable for kerbs. Every kerb in the city fell
through to the `MAT_DIFFUSE` **facade** branch at `gbuffer.wgsl:642` and was shaded with
window cells, sills and shopfront logic across a 12 cm strip.

**Verdict: category (2) — a material/shading bug, and specifically a MISROUTE.** Not
lighting (the kerb was being shaded, by the wrong function), not baking (developer 3's
numbers, confirmed). The authored **4.319×** kerb/deck contrast had no consumer left to
reach the frame.

### 1.2 How the gate came to be mutually exclusive with itself

The `abs(n.y) > 0.55` did not arrive alone. Per the comment at `gbuffer.wgsl:626-631`, the
predicate was ungated, and it claimed pedestrian leg-box top faces at 0.84 m, shading them
as pavement. Two terms were added to stop that. **`MAT_DIFFUSE` was sufficient** —
pedestrians are `MAT_PLAIN`. The normal range was added alongside it and is what broke the
kerbs. The fix for a pedestrian regression silently disarmed the kerb path, and nothing
failed: the branch still existed, still had a comment explaining it in detail, and was
simply never entered.

This is PROCESS rule 5 in a shader — a name (`isChunkDeck`, and a kerb branch inside
`groundSurface`) is a claim that something exists, not evidence that it runs.

### 1.3 The fix

`gbuffer.wgsl:632`. The normal test is split by surface class, because the two classes it
has to admit are perpendicular and one threshold cannot hold both:

```wgsl
let isChunkDeck = i.matId == MAT_DIFFUSE && (
     (abs(n.y) > 0.55 && i.world.y > DECK_Y - 0.40 && i.world.y < DECK_Y + 0.75)
  || (abs(n.y) < 0.50 && i.world.y > DECK_Y - 0.05 && i.world.y < DECK_Y + 0.22)
);
```

Horizontal keeps the original wide band (deck, footway, kerb top). Vertical gets a tight
one: kerbs stand 0.06–0.20 m proud, so `DECK_Y-0.05 .. DECK_Y+0.22` admits the kerb run and
excludes wall bases. The width of that window is not a guess — it is what the measurement
supports (1.1: **40** vertical vertices sit above `DECK_Y+0.22` and would otherwise pick up
kerb block joints on the bottom 22 cm of a facade, against 3480 that are genuinely kerb).

Re-measured with the same probe, same chunk, same predicate:

```
kerb-face verts satisfying isChunkDeck   : 0  ->  3480   (of 3520)
horizontal verts satisfying isChunkDeck  : 6416 ->  6416   (unchanged)
wall-base verts above kerb height excluded: 40   (by construction)
```

The pedestrians are unaffected: they are `MAT_PLAIN`, and the `MAT_DIFFUSE` term is
untouched.

### 1.4 Visual confirmation, and how far it goes

`shots/2026-10-02T21-43-42-01d-street-crowd.png`, captured on a **quiet** box —
preflight `OK swap 3.87/5.0GB disk 14.2GB mem-unused 373MB load 3.33/8`, `framesSkipped: 0`,
camera held **0.05 m** from the derived pose, `lodHistogram [9,105,0,0]`. I opened it:
kerbs read as warm strips along both kerbs and across the mid-distance, with block joints.

**What that frame does NOT prove.** I put the Round 4 frame and this one side by side at 3×
and the honest answer is that they are **not a controlled pair**: tier medium → high, LOD
histogram `[9,25,44,0]` → `[9,105,0,0]`, `dayPhase` 0.409 → 0.671, different sun elevation,
different camera. And in the **before** crop kerb strips are *also* visible — those are the
kerb **tops**, which are horizontal and always passed the gate. Only the kerb **faces** were
misrouted, and a face seen from a 2.7 m eye at 40 m is a few pixels tall.

So: no before/after pixel claim is made. The proof is §1.1 and §1.3 — 0 → 3480 vertices
reaching the branch, deterministic, same chunk, one-line change. The frame corroborates and
is the first frame in this project where a kerb face has ever been shaded as a kerb.

### 1.5 The confound the orchestrator warned about — it does not apply here

> footway and carriageway share one albedo BY CONSTRUCTION, so past kerb-face legibility
> range the street is legitimately one colour. That is a design limit, not a bug.

**This finding is not that.** My measurement is about *which shader branch a fragment is
routed to*, sampled per-vertex, with no distance term at all. It does not depend on albedo
sharing, on legibility range, or on how far away the kerb is. It would be true of a kerb
1 m from the camera. The design limit the orchestrator describes can still be true
separately; this is not it.

---

## Part 2 — LOD: the premise is REFUTED

I was handed this from my own Round 4 captures:

```
lodHistogram   shot 1 [9,25,44,0]      shot 2 [9,105,0,0]
harness warned "warm did not reach LOD 0 on the camera chunk in 12 passes"
```

and asked to find why no chunk reaches LOD 0. **Measured: the camera's chunk is at LOD 0
from the first warm pass, and never leaves it.**

Driving the harness's own loop (12 passes, reading `chunkLod(cameraChunk())` after each):

```
pass  ticks   ms     stopped       camChunkLod  resident  rebakePending  lod0InHistogram
  1   156   12250   no-progress        0            70          0              9
  2    26    1844   no-progress        0            70          0              9
  3     8     608   no-progress        0            70          0              9
  4..12  8   ~600   no-progress        0            70          0              9
```

`camChunkLod` is **0 on every pass including the first**. The policy is also correct in
shape — within 3 chunks of the camera the histogram is `{0: 9, 1: 25, 2: 8}`, which is what
`lodForDistance` (`floor(dist/1.6)`, clamped to the tier ceiling) should produce.

### 2.1 Why the harness says otherwise

`tools/capture.mjs:603` — the gate is:

```js
if (settled && settled.lod === 0 && settled.resident >= chunks) return {...};
```

**Two** conditions. `lod === 0` is satisfied. `resident >= chunks` is not: residency
plateaus at **70** against a warm target of **96**, because residency is bounded by the
tier's `viewDistance`, not by the budget. The target is unreachable, so the gate can never
pass, and the failure message — *"warm did not reach LOD 0 on the camera chunk"* — names
the condition that was **already satisfied**.

This is PITFALLS §12 exactly: a diagnostic disagreeing with reality, and its message
pointing at the wrong quantity. The Round 4 warning I passed upward was this message, and
I repeated it in §1.2 of the Round 5 brief as though it were a measurement. It was not; I
had quoted a diagnostic instead of reading `chunkLod`. **The orchestrator's premise came
from my own unverified quote.**

Confirming the fix is not mine: `tools/capture.mjs` and `src/main.ts` are both outside this
role. The fix site is `capture.mjs:603` — report both conditions in the failure message, or
drop the residency clause from a message that names LOD.

### 2.2 What did turn out to be true, and is worth keeping

- **The shared `t0`.** `renderer.ts:998` sets one `t0` for both the rebake loop (`:1001`)
  and the initial-bake loop (`:1020`), and both test `performance.now() - t0 <
  BAKE_BUDGET_MS`. A single rebake therefore consumes the whole 4 ms budget and initial
  streaming does nothing on that frame. Not currently harmful — measured residency reaches
  its ceiling — but it couples two things that should be independent.
- **`BAKE_BUDGET_MS = 4`** (`:65`) against F6's measured 2255–2696 ms for 64 chunks
  (~35 ms/chunk). One LOD-0 bake cannot fit in 4 ms, so the loop is effectively
  one-bake-per-frame. Fine while a frame is on screen; `warmChunks` exists precisely
  because at boot the budget protects nothing.

---

## Part 3 — Two things in my own file, both closed

- **`renderer.ts:1473-1475`** said "The street deck goes down first with depth writes off".
  There is no second pipeline and `depthWriteEnabled: true` at `:612`, so it does write
  depth. **Comment corrected** to say so, and to say why that is correct under reverse-Z.
  The false statement is gone (PROCESS rule 6).
- **`entityDrawEnabled`** — comment rewritten. It previously said "remove when F2 closes",
  which is now stale: F2 closed and it was **not** a rendering bug. It stays, default
  `true`, no behaviour change, because it is the only way to answer "are entities reaching
  the frame" without editing `main.ts` — and `setCrowdCount(0)` cannot (measured: still
  ~2500 instances).

---

## Part 4 — Legibility flags, for the record before the reviewer sees a crowd

The reviewer will judge the first visible crowd, and the renderer contributes to that
judgement. Three things are on the record now, none of them mine to fix:

1. **The crowd is still a 1-D line.** This capture's sidecar: `crowdSample` all
   `z = 0.35`, `pop {n: 2550, cx: 1101, cz: 0}`. Developer 2's lateral spread is not landed.
   At 16×25 px a *merged* body does not read as a person — which is exactly the
   "counter-like band" D7 names. The renderer's contribution is that the band is
   high-contrast against a now-legible deck; that contrast is correct for a person and
   wrong for a wall of merged boxes. **The fix is lateral spread, not contrast.**
2. **A kerb-lit deck raises the bar.** Before this fix the deck was a featureless slab and
   a smeared crowd had nothing to be measured against. Now there is a readable ground
   plane, so "do the bodies read as figures" becomes a fair question rather than a
   rhetorical one. That is a net gain and it makes the crowd's failure more visible.
3. **Both this and the Round 4 frames are low-detail.** `lodHistogram` shows chunks at LOD
   1 and 2, never 0 beyond the 9 nearest. Per §2 the camera chunk itself *is* at LOD 0 —
   the LOD *policy* is fine — but "no LOD-0 chunk in the histogram" was always a misreading
   of a histogram whose bucket 0 counts the nearest 9. A city-detail judgement from these
   frames is a judgement about LOD 1–2 geometry.

---

## Verification

```
./node_modules/.bin/tsc --noEmit     5.9.3 — 0 errors, repo-wide
npx vite build                       ✓ built in 619ms
```

(The pinned binary matters: `npx tsc` resolves to a global 7.0.2 that disagrees.)

Probe `src/render/__probe_kerb.ts` **deleted**. Findings reproduced in §1.1 and §1.3.

### Not done, and why

- No capture of the *pre-fix* frame at the *same* pose and tier as the post-fix frame. The
  Round 4 shot differs in tier, LOD, sun angle and camera, so a true A/B needs the old
  shader back with everything else pinned. The vertex-level measurement does not need it.
- The LOD gate fix is **not mine** — `tools/capture.mjs` and `src/main.ts` are outside this
  role. Reported, not edited.