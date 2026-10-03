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
---

## Round 6 — the harness gate, a truthful capture, and what the renderer owes legibility

### 6.1 Capture health — the best window of the session

```
preflight OK   swap 4.09/5.0GB   disk 14.1GB   mem-unused 860MB   load 4.60/8
  warn: swap 4.09GB used — approaching the 4.5GB block
  warn: disk free 14.1GB — below the 20GB comfort line
shot     shots/2026-10-02T22-45-46-01d-street-crowd.png
pose     01d-street-crowd  (camera 0.15m from derived, within 0.5m)
```

It took **37 preflight attempts** to get this window; the box sat at 64–202 MB unused for
36 of them. No `--force` was passed. Frame-side health, from the sidecar:

```
framesSkipped 0    tier high    residentChunks 106    visibleChunks 20
rebakePending  0    lodHistogram [9, 97, 0, 0]        entityDrawCalls 5
camera pos [1033.9, 2.6, -2.21]  lookAt [1427.46, 1.86, 69.25]
pop {n:2550, cx:1094, cz:0, spread:97}
```

`framesSkipped: 0` and `residentChunks: 106` (the highest of any capture this session) make
this the most trustworthy crowd frame taken so far. **Caveat that survives:** `lodHistogram`
is `[9, 97, 0, 0]` — 9 chunks at LOD 0, the rest at LOD 1. Per §2 the camera's own chunk
*is* at LOD 0; this is still not a LOD-0-everywhere city-detail frame.

This is the first frame in the project showing **both** a legible street (kerbs) and the
crowd.

### 6.2 The harness gate is fixed, and the message is now truthful

`tools/capture.mjs:596-611` (granted this round). Before:

```js
if (settled && settled.lod === 0 && settled.resident >= chunks) return {...};
...
say(`    ! warm did not reach LOD 0 on the camera chunk in 12 passes ...`);
```

`chunks` is a fixed warm target. Residency is bounded by the tier's `viewDistance`, not by
the bake budget, so `resident >= chunks` was **unpassable** — measured 70 against 96 — and
the failure named the one condition that had held on every pass.

The replacement gates on the condition that means something, and reports the one that
failed:

```js
const lodOk   = !!settled && settled.lod === 0;
const drained = !!settled && settled.pending === 0;   // rebakePending: nothing left to bake
if (lodOk && drained) return { ...report, passes: i + 1 };
...
const why = !settled ? 'could not read the renderer state'
          : settled.lod !== 0 ? `camera chunk is at LOD ${settled.lod}, not 0`
          : `bake queue still holds ${settled.pending} chunk(s)`;
say(`    ! warm did not settle in 12 passes: ${why} (...) — the frame may be low-detail`);
```

`rebakePending === 0` is the target-free settled condition: it means the renderer has
nothing left to bake, so it cannot be defeated by a target chosen for a different tier.

**Is the message now truthful? Yes, and it is verified by absence.** This capture printed
**no `!` line at all** — the gate passed on the first pass, because `lod === 0` and
`rebakePending === 0` (`0`, in the sidecar). The false warning is gone rather than
reworded, which is the stronger outcome: the condition that was always true is no longer
part of a failure path.

The old message is in the sidecar of **every capture this project has ever taken**. Those
sidecars are historical and are not rewritten; this file and the harness comment are the
correction, per PROCESS rule 6.

### 6.3 Item 3 was already closed — it is in `f24ff19`

The brief lists two items as open. Both were done in Round 5 and are in the commit the
brief is built on:

- `renderer.ts:1477` now reads *"It DOES write depth, contrary to what this comment used to
  say"*, with the reverse-Z reason.
- `entityDrawEnabled` (`:1628`) carries a rewritten comment: it no longer says "remove when
  F2 closes" (stale — F2 was not a render bug) and records *why it stays*: `setCrowdCount(0)`
  cannot zero the instances (measured ~2500 surviving), so this is the only way to answer
  "are entities reaching the frame" without editing `main.ts`.

Not redone.

### 6.4 Legibility: what the renderer contributes to the crowd verdict

Flagged **before** the review, as asked. I opened the frame and a 3× crop of the near end.

**Measured context.** Bodies are `cz = 0` — a single line (developer 2's lateral spread is
not landed). Nearest sampled agent x=1155 is 121 m away; the near end of the ribbon is
2–4 m from the camera, where a 1.7 m figure is ~700 px tall. So "16×25 px" applies to the
*mid* field (~40 m → 37 px measured); the near field is far larger and still does not read
as a figure.

**What helps.**

- *Figure-ground separation is strong.* Saturated warm/dark bodies against a light
  blue-grey deck. Not the problem.
- *The kerb fix raised the bar honestly.* The deck now has structure, so "do bodies read as
  people" became a fair question instead of a rhetorical one.

**What is on my side and hurts. Three findings, all verified in code.**

**(i) Every pedestrian is the same rigid body and effectively the same colour.**
`citymesh.ts:976-995`. Eight `cloth` colours and four `skin` colours are defined; line 983
takes `cloth[0]` and `skin[0]`; line 993 is `void skin; void cloth;`. **The arrays are dead
code.** All 2550 pedestrians are one 5-box figure with two vertex colours, and the only
per-instance variation is the `crowdColorFor` tint multiplying a fixed base. There is no
pose variation, no height variation, and no per-body-part colour.

This is the reviewer's *predicted next failure* — "repeated rigid post-like bodies" — and the
renderer is **already producing it**. The ribbon is the lateral-spread symptom of it. Fixing
spread alone will turn the ribbon into a row of identical posts, which is the middle step of
the predicted sequence, not the end of it.

**(ii) Entities cast no shadow — there is no contact shadow.**
`renderer.ts:1249` calls `this.recordShadow(enc, cam)` and `recordShadow` (`:1397`) takes
**no entities parameter**; only `recordGBuffer` receives the entity callback. Every body
floats: nothing ties a pedestrian to the deck. This is the single largest legibility
contribution on my side, it is invisible in a counter, and no amount of lateral spread will
substitute for it. A person on a street with a contact shadow reads as a person; without one
they read as a sticker.

**(iii) The gait mask is a dead wire — the crowd is completely static.**
`crowd.ts` writes a gait-driven limb mask into `tint.a`. In `gbuffer.wgsl:606` it becomes
`var alpha = i.tint`, is touched once more for foliage (`:678`), and is **never written to
`GOut`** — which carries only `albedoRough`, `normalMetal`, `emissive`. The gbuffer targets
have **no blend state** (`renderer.ts:604-608`), so per-instance opacity has no path to the
screen by construction. So: authored, uploaded, read by the shader, discarded. Structurally
the same failure as the kerb — a value computed and thrown away one stage later — and worth
naming as such, because it means the sim's animation work cannot reach the frame without a
G-buffer that has somewhere to put it.

**Ordering, cheapest first.** (ii) contact shadow is one call-site change and the biggest
legibility win per line. (i) is `citymesh.ts` only and can be done as body-part colour
indexing before the spread lands, so the first spread frame is not a row of clones. (iii)
needs a design answer, not a patch — a deferred G-buffer has no per-instance opacity, so
either the gait drives vertex colour/emissive instead, or the crowd gets a forward pass.

**Not mine, flagged for routing:** no height or scale variation (the model matrix is rigid,
`crowd.ts:1019-1022`) — developer 2.

### 6.5 Verification

```
./node_modules/.bin/tsc --noEmit   5.9.3 — 0 errors, repo-wide
```

Files changed this round: `tools/capture.mjs` (gate + message), and this document. The
Round 5 shader fix and renderer comment fixes are in `f24ff19`. No probe files remain.

---

## Round 7 — the frame, on `main`

**Branch.** I was on `dev2/crowd-instrument`, not `main`. Both pointed at `0152426`, so
moving was content-neutral; I switched to `main` and landed here. Recorded because the
episode is the lesson: three lanes sharing one checked-out branch is not parallelism, it is
three agents editing a file none of them checked. Branch deliberately, name it for the task,
and state the branch in the report.

### 7.1 Capture health — marginal, and labelled as such

```
preflight OK   swap 3.95/5.0GB   disk 13.9GB   mem-unused 297MB   load 11.40/8
  warn: mem 297MB — under the 500MB line
  warn: swap 3.95GB — approaching the 4.5GB block
  warn: disk 13.9GB — below the 20GB comfort line
shot     shots/2026-10-02T23-17-05-01d-street-crowd.png
pose     01d-street-crowd  (camera 0.14m from derived, within 0.5m)
```

It took **23 preflight attempts** (the box sat at 64–144 MB unused for 22 of them). No
`--force`. Frame-side: `framesSkipped 0`, `tier high`, `residentChunks 114`,
`rebakePending 0`, `entityDrawCalls 5`.

**This frame is evidence of a weaker kind than Round 6's** (`mem 297MB / load 11.4` against
`860MB / load 4.6`), and it is on the same build, so **Round 6's
`shots/2026-10-02T22-45-46-01d-street-crowd.png` remains the better-trustworthy crowd
frame.** Both are cited below; neither is treated as the sole basis for a claim.

### 7.2 The gate fix: free test passed

This capture printed **no `!` line at all**, and the sidecar contains no warm-failure string.
`rebakePending 0` and camera-chunk LOD 0 satisfied the new gate on the first pass. The
corrected message was therefore not exercised — which is the better outcome: the false
warning is **gone**, not reworded. If a warm failure occurs later, the message will name
the queue depth or the LOD value that actually failed.

### 7.3 What the frame shows — my read, before the review

I opened it. Kerbs, deck and crowd, all in one frame for the first time.

**Measured, not eyeballed** (RGB/HCL from the PNG; the frame wins over any earlier note of
mine):

```
KERB band   RGB(121, 66, 56)   hue   2 deg   lum 36.8%
DECK        RGB(109,123,141)   hue 213 deg   lum 12.6%
CROWD body  RGB( 69, 48, 38)   hue  19 deg   lum 20.8%

realised kerb/deck luminance contrast = 2.91x   (authored 4.32x in vertex colour)
```

**A correction to my own Round 7 measurement.** My first pass reported kerb/deck at
**0.93×** and concluded the kerb fix had not carried. That number was an artifact: the
sample window straddled kerb and deck and averaged them. The row-by-row probe puts the kerb
at rows 496–500 and gives **2.91×**. The 0.93× is withdrawn. PROCESS rule 6 — the frame
beats the document, including the document I wrote twenty minutes earlier.

**Does the deck read as pavement?** Yes. Blue-grey, tonally varied, with kerb lines, block
joints on the kerb, and road paint. The ground fix works and the street reads as a place.

**Does a body at 16×25 px still separate from it?** By colour, emphatically: 194° of hue
difference and ~1.65× luminance. It is not a separation problem.

**Did the kerb fix move the picket-fence read either way?** Measured, it moved it slightly
the wrong way, and this is the useful part:

> **kerb hue 2°, crowd hue 19° — 17° apart, the same warm family.** The kerb runs parallel
> to and immediately alongside the crowd line for the length of the frame.

Before the fix the kerb was facade-shaded (window cells, cool tones), so the ribbon stood
against a cool neutral line. Now it stands against a warm rust line of its own hue family.
Net: the **ground** is unambiguously better, and the **crowd's** separation from its
immediate background is slightly worse. The reviewer's worry — that higher contrast makes
an unspread crowd read as a picket fence *more confidently* — is **supported**, by hue
proximity rather than by brightness.

### 7.4 The renderer's outstanding contribution to that verdict

Unchanged from §6.4 and re-confirmed against this frame. Bodies are flat-topped slabs with
no head reading, no contact shadow, and no pose variation; the gait mask is a dead wire.
The three findings stand:

| # | finding | site | cost to fix |
|---|---|---|---|
| i | 8 cloth + 4 skin colours defined, `void skin; void cloth;` — every pedestrian is one 5-box figure with two colours | `citymesh.ts:983,993` | body-part colour indexing; do it **before** spread lands |
| ii | `recordShadow` takes no entities param — **no contact shadow**, bodies float | `renderer.ts:1249,1397` | one call site; largest legibility win per line |
| iii | `var alpha = i.tint` never written to `GOut`, and the G-buffer has no blend state — **gait is a dead wire, the crowd is static** | `gbuffer.wgsl:606` | needs a design answer, not a patch |

(i) is the reviewer's predicted "repeated rigid post-like bodies" already in production.
Fixing lateral spread alone converts the ribbon into a row of clones — the middle step of
the predicted sequence, not its end.

### 7.5 Needs the vision gate — I am not self-certifying this

The kerb contrast went from discarded to realised at **2.91×**. Whether that reads as a
**kerb**, as a **painted stripe**, or as a **step too tall to walk on** is a frame judgement,
and DESIGN.md §6 says the implementer does not self-certify it. **Flagged for the gate, not
claimed.** Specifically for the reviewer:

1. Do the kerbs read as kerbs, or as paint?
2. Given kerb hue 2° and crowd hue 19°, does the crowd line merge with the kerb line?
3. With bodies now judged against a legible deck, do they read as figures or as a fence?

I have answered (2) with a number and deliberately **not** answered (1) or (3) — those are
the gate's.

---

## Round 8 — BLOCKED. No frame produced, and why that is the correct outcome.

### 8.1 The frames did not land. The guard held.

Task was to shoot `01g-kerb-face` then re-shoot `01d-street-crowd`, and nothing else.
**Neither was captured.** 115 preflight attempts across ~45 minutes, every one refused:

```
BLOCK swap 3.81/5.0GB  disk 13.5GB  mem-unused 63-68MB  load 1.21-3.0/8
  BLOCK: physical memory unused 63MB < 250MB.
         Expect a swap death, not a slow run (WORKFLOW §6.1: 66MB at peak).
```

No `--force` was passed. The attempt count and the pinned memory are in §8.4.

**The load number is what distinguishes this from contention, and it is the useful part.**
Load sat at **1.2–3.0 across 8 cores** — the box was *idle* — while memory stayed at
63–68 MB. That is not a spike from other agents working; it is a steady state, and the
earlier session where captures succeeded at 860 MB and 297 MB shows the machine can do it.
Two `opencode` processes were holding 658 MB and 885 MB RSS. `ps` shows no chromium, no vite
and no held capture lock of mine, so nothing here is reclaimable by me without killing
another workspace's agent — which is not mine to do.

**This is the guard working.** A capture at 63 MB unused produces a truncated frame and GPU
errors that read exactly like the silent rendering faults this project has spent a session
hunting (WORKFLOW §6.4). Forcing it would have manufactured a wrong conclusion — most
likely "the kerb still does not read", or "the crowd is gone" — and a whole round would have
gone into debugging the operating system. The honest result is no frame.

### 8.2 What I did instead, and it is not nothing

- **Re-verified the gate fix is landed.** `3ccd549` is an ancestor of `HEAD`, and `drained`
  is present in `tools/capture.mjs`. The brief listed it as outstanding; it was committed in
  Round 7 and is in `main`. Nothing to land.
- **Re-verified both Round 7 small items are closed**, in `f24ff19`: `renderer.ts:1477`
  states the deck *does* write depth and why; `entityDrawEnabled` carries a comment that
  records why it stays (`setCrowdCount(0)` cannot zero instances) rather than the stale
  "remove when F2 closes". Nothing outstanding.
- **Pre-registered the Round 8 measurements below**, with predictions, so that the moment a
  capture slot frees this is arithmetic and not another round.

### 8.3 Pre-registered: what I will measure, and what each result means

Written before the frames exist, so the answer cannot be reverse-fitted to them.

**On `01g-kerb-face`** (1.7 m eye, oblique along a 20 m straight run, 1.2 m past the edge):

| measurement | prediction | if it goes the other way |
|---|---|---|
| Row-scan across a kerb at 3× and 4×, sampling **rows identified as kerb** (my Round 7 error was sampling a window that straddled kerb and deck) | the kerb occupies **2–5 rows** and has a **hue distinct from the deck by >25°** | a 1-row, hue-matched band means it is reading as paint, and the geometry has not separated them |
| Split the kerb band into its **upper and lower half** and measure luminance of each | upper **brighter** than lower by **>1.3×** — a lit side and a shadowed side | upper ≈ lower means there is no vertical face shading and it is a stripe by construction, which is a **grammar** question not a brightness one |
| Does a **dash** (road paint, `PAINT_Y`, horizontal) differ from the **kerb** in row-count and hue | paint is **1 row**, kerb is **2–5 rows**, and hues differ | if both are one row and one hue, developer 3's authorship-ambiguity is confirmed as still unresolved in the renderer |
| Kerb luminance against adjacent deck | **1.8×–3.5×** realised. Measured **2.91×** on the street-crowd frame | **>4×** means over-strong and reads as a painted stripe or an unwalkable step — the failure mode named in the brief |

**On `01d-street-crowd`:**

| measurement | prediction | if it goes the other way |
|---|---|---|
| Kerb hue vs crowd-body hue | **>40° apart** — the crowd must not sit in the kerb's hue family | I already measured **17° apart** (kerb 2°, crowd 19°) on the pre-R11 frame, so I predict this **still fails** |
| Body vs deck luminance and hue separation | strong (>1.5× luminance, >120° hue) | unchanged from Round 7 — not the failure |
| Whether bodies read as figures or as a fence | **fence.** Predicted before looking | if they read as figures, the R11 reskin or coat guards changed something I did not model, and that is worth knowing |
| Presence of a **contact shadow** under bodies | **absent.** `recordShadow` (`renderer.ts:1397`) takes no entities parameter, so nothing can cast one | if present, developer 2 has changed the shadow path and my §6.4 finding (ii) is stale |

### 8.4 Evidence log

115 attempts, all BLOCK, memory 63–68 MB throughout, load 1.21–3.0. No `--force`. No lock
held. Round 7's frames remain the most recent crowd frames taken (`22-45-46` at 860 MB and
`23-17-05` at 297 MB) and both **predate** `21f4efa` (R11 reskin + kerb-face pose) and
`1f25fa6` (D25 lane + coat guards), so **neither is a current-build frame** and neither is
offered as one.

### 8.5 Not self-certifying

The kerb is flagged for the vision gate, as before. `DESIGN.md` §6: the implementer does not
self-certify. I have not looked at a `01g-kerb-face` frame and I will not predict its
verdict — only the numbers in §8.3, which are inputs to the reviewer's judgement and not a
substitute for it.
