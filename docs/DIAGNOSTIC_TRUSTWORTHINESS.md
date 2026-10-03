# R13 §3 — diagnostic trustworthiness audit

Author: developer 1 (GPU half). Round 9.
Scope: every value that reaches `shots/latest.json` or `stats()`.

**What this document is for.** A later session must not be lied to by a value it has not seen
questioned. This is not a list of every field — it is the set of fields that **have already
lied**, or **can** lie structurally, with the check that would catch each one. Fields that
cannot lie by construction are listed briefly at the end so the omission is deliberate.

R13's done-when requires **every claim to cite a file and line**. That is done throughout.
**Negative results are legitimate** and several appear below: three fields are confirmed
phantoms that no code path writes, and one previously-dangerous field has been retired.

---

## How to read the classes

| class | meaning |
|---|---|
| **LIED** | it has produced a wrong number that a reader believed. The incident is named. |
| **CAN LIE** | structurally capable: a race, a stale default, a definition that does not match the name. It has not necessarily lied yet. |
| **CLEAN** | a direct read of state with no intermediate that can drift. |

---

## 1. Fields that have already lied

### 1.1 `entityDrawCalls` — LIED, and the comment is load-bearing

`src/render/renderer.ts:1354` — `s.entityDrawCalls = issued`, where `issued` is counted at
`:1326-1327` from the `entityDraws` ledger.

**What it claimed to be.** Draw calls issued by entity meshes.

**What happened.** An earlier version incremented `counter.entity` in `drawEntitySet`
(`:1602`), a function **with no callers** — the crowd and the fleet are drawn by `main.ts`'s
own `drawEntityBlock` (`src/main.ts:494-510`), which calls `pass.drawIndexed` directly. So
`entityDrawCalls` read **0 in every capture** while `entityTriangles` read hundreds of
thousands. Developer 2 read the pair as "counted, never issued" and treated it as the cause of
R1. It was not: the counter was the thing that was wrong.

**Why it is dangerous.** A nonzero sibling (`entityTriangles`) sitting next to a zero is
exactly what makes a broken counter believable.

**The check.** `entityDrawCalls` must be 0 **only** when the ledger is empty. If
`entityDrawCalls === 0 && entityTriangles > 0`, one of the two is lying. Currently counted
from the ledger (`:1326`), so the two are derived from the same source and cannot disagree
that way — but the guard is worth keeping as an assertion.

### 1.2 `entityDraws` — CAN LIE, and it lied to me

`src/main.ts:438` clears `renderer.entityDraws` at the top of every tick; `drawEntityBlock`
pushes at `:507`; `stats()` reads it at `src/main.ts:708`.

**What it claims.** The entity draws issued this frame.

**What happens.** It is cleared *before* the frame is encoded. If `renderer.render()` returns
early under the frame budget (`renderer.ts:1230-1234`), nothing is pushed and the ledger
reads **`[]`** — on a frame where the previous frame did draw. Measured: on a loaded box
**12 of 60** stepped frames issued any draw at all.

**Concrete harm done.** In Round 4 shot 1 the sidecar read `entityDraws: []` next to
`entityDrawCalls: 5`. Both were true — of different frames. A single sample of this field
means nothing.

**The check.** Never read `entityDraws` from a single frame. Census it over N frames and
assert at least one non-empty (what I did in Round 3). A sidecar that shows `[]` alongside a
nonzero `entityDrawCalls` is a **sampling artifact, not a contradiction** — say so.

### 1.3 `pedestrian:N/180` — CAN LIE, via its own components

`src/main.ts:507` — `` `${key}:${count}/${mesh.indexCount}` ``.

- The `/180` half is **real**: `mesh.indexCount` is the uploaded index count
  (`src/render/gpuutil.ts:190`). 180 indices = 5 boxes = 60 triangles. Not a phantom.
- The `N` half inherits §1.1 and §1.2.
- `pedestrian:0` is pushed by `main.ts:499` when the mesh is missing **or** `count <= 0`, so
  **`:0` conflates "no crowd" with "mesh not resident"**.

**The check.** `pedestrian:0` means "either no instances or no mesh" — it does not say which.
Corroborate with `crowdDebug.instancesCount` before concluding the crowd vanished.

### 1.4 `requested` — LIED, permanently, on every derived pose

`tools/capture.mjs:1047-1049` builds `requested` from `pose.position` / `pose.lookAt`; the
agreement line at `:1057-1061` is suppressed when `d === null`.

**What it claims.** The camera the renderer held matches the camera the harness requested.

**What happened.** The whole `01d/01e/01f/01g` family is **derived at runtime** and has no
literal position, so `pose.position` is undefined, `requested` serialises as all-`null`, the
comparison is skipped, and the shot prints `PASS`. This is PITFALLS §20's exact failure shape
recurring on the family that most needs rule 4.

**Measured.** Every derived-pose sidecar this session: `"requested":{"position":null,
"lookAt":null,"fov":null}` next to `PASS 1 shot(s)`.

**The check.** `requested.position === null` means **the held-camera check did not run**. A
`PASS` beside a null `requested` is not a verified frame. *Not fixed — `capture.mjs` held-pose
semantics are developer 3's; reported, not edited.*

### 1.5 the warm gate — LIED, fixed in `3ccd549`

`tools/capture.mjs:603` (pre-fix) — `settled.lod === 0 && settled.resident >= chunks`.

**What it claimed.** LOD 0 on the camera chunk was not reached.

**What happened.** `lod === 0` held on **every one of 12 passes**; `resident >= chunks` could
**never** hold, because residency is bounded by the tier's `viewDistance`
(`src/render/quality.ts:41-42`) and not by the bake budget — measured 70 against a target of
96. The gate was unpassable and the message named the condition that had been satisfied.

**Blast radius.** That message is in the sidecar of every capture the project has ever
taken, and two agents read it as a measurement — including me, who repeated it upward as a
finding in Round 5 before measuring `chunkLod` and finding LOD 0 on pass 1.

**The check.** `lodHistogram[0] > 0` is the cheap corroboration. Now gated on
`rebakePending === 0` (`capture.mjs:625`), which cannot be defeated by a target chosen for
another tier.

### 1.6 `inView` — LIED, and is now **retired**

`src/sim/crowd.ts` — **0 occurrences remain**, and the field is gone from the `stats()` block
(`src/main.ts`, no `inView` entry). It reported 0 instances in the camera cone repeatedly
while a dense crowd was plainly in frame (PITFALLS §12). **This is the one item on this list
that has been fully closed**, and it is closed by deletion, which is the only reliable fix for
a diagnostic that has lied once.

**The check.** None needed — it no longer exists. Recorded because "it was here and it was
removed" is worth more than silence.

---

## 2. Fields that CAN lie structurally, and have not yet

### 2.1 `lightDelivery.produced` — CONFIRMED PHANTOM, and an incoherent chain

`src/render/renderer.ts:170` declares it; `:440` initialises it to `0`. **Nothing ever
assigns it.** (Grep across `src/` finds only the declaration, the doc comments at `:151-155`,
and the initialiser.)

**Why it matters more than a dead field.** The comment at `:151-155` documents a chain —
`produced` (grammar, at bake) → `delivered` (per-chunk, for visible chunks) → `binned` (survived
the cap) — and says *"delivered 400, binned 300 is a different bug from produced 400,
delivered 0"*. But `produced` is hard-wired to 0, so **every sidecar reports
`produced: 0, delivered: 1332+`**, which is impossible under its own definition: you cannot
deliver 1332 lights that were never produced.

**The harm is a reader concluding lights are being lost at the grammar stage**, when in fact
the counter is dead. This is precisely the "a real number answering to nothing" class.

**The check.** Until it is written, **ignore `produced` entirely** and use `delivered` and
`binned`, which are assigned (`renderer.ts:1203-1210`). A `produced < delivered` reading is a
bug in the counter, never in the city. *Fix is one line in my lane; not taken this round
because it would change a number a reviewer may be reading.*

### 2.2 `tileBins.maxPerTile` / `refusedTiles` — CAN LIE: stale default

`renderer.ts:443` initialises `tileBins` to all zeros. `bins`/`capacity` are set at
allocation (`:1568-1569`), but **`maxPerTile` and `refusedTiles` are only written inside the
tile readback** (`:2132-2133`), which runs only when someone calls `probe('tiles')`.

**So in any capture where no probe ran, they read 0** — and every capture this session showed
`"maxPerTile":0,"refusedTiles":0` alongside 1332–1896 binned lights. A `MAX_PER_TILE` refusal
would be **invisible in a sidecar**, and `docs/OCCUPANCY.md` exists because that cap had
already refused lights silently once.

**The check.** `refusedTiles === 0` is only meaningful if a `probe('tiles')` ran in the same
frame. Otherwise it is a default. **A reviewer cannot use this field from a sidecar.**

### 2.3 `entityTriangles` — CAN LIE: two writers

`renderer.ts:1329` sums `c.entityTris`; **`src/main.ts:463-464` then adds
`pendingEntityTris` on top.** Two writers, one field, and the second runs *after* the frame.
That is deliberate (documented at `main.ts:458-462`) because the crowd bypasses
`drawEntitySet`, but it means the value is **not** a per-pass counter and does not reconcile
with `entityDrawCalls × triangles-per-instance`.

Measured inconsistency worth noting: shot 1 reported `entityDrawCalls: 5`,
`entityTriangles: 1423548` — while 2550 instances × 60 tris is 153,000. The excess is traffic
entities plus the double-counting. **Do not reconcile this field arithmetically.**

### 2.4 `bakeMs` — CAN LIE: a gated EMA

`renderer.ts:1033` — `if (ms > 0.05) { ... }`. Below the threshold the EMA **stops updating**
and the last value persists indefinitely. A frame that bakes nothing reports the previous
frame's cost. Under the platform load this session, `bakeMs` values were also measured as
**contention, not work** — per the standing instruction, timing figures under load are not
comparable across runs.

**The check.** Prefer counts (`residentChunks`, `rebakePending`, `lodHistogram`) over
milliseconds. `bakeMs` is a hint.

### 2.5 `vramMB` — CONFIRMED PHANTOM

`renderer.ts:194` declares it; `:436` initialises it to `0`; **nothing assigns it.** Present in
every sidecar as `"vramMB":0`, permanently. It is a number that looks like a measurement and
answers to nothing.

**The check.** Treat as absent. A reviewer must not conclude the renderer uses no VRAM.

### 2.6 `uploadMs` — CONFIRMED PHANTOM

`renderer.ts:197` declares it; `:444` initialises it to `0`; **nothing assigns it.** Always
`"uploadMs":0` in every sidecar. Same class as §2.5.

### 2.7 `lodHistogram` — was misread, is clean, and the misreading is worth recording

`renderer.ts:1371-1373` — counts **resident** chunks by `e.lod`, index = lod. It is a direct
read and cannot lie about what the renderer believes.

**But it was read wrong twice**, including by me. `[9,25,44,0]` was read as "no chunk at LOD
0" — it means **9 chunks at LOD 0, 25 at LOD 1, 44 at LOD 2, 0 at LOD 3**. Bucket 0 is the
count *at* LOD 0, and per `lodForDistance` (`quality.ts:60-66`) the ~9 chunks within
1.6 chunks of the camera are exactly the ones that belong there. **The camera's own chunk was
at LOD 0 on every warm pass all along** (§1.5).

**The check.** `lodHistogram[0] > 0` and `chunkLod(cameraChunk) === 0` agree, and both
did. Read the bucket as a count per level, never as "the level of the camera".

### 2.8 `derivedPose.source` — CAN LIE: computed once at boot, about a crowd that moves

`src/world/diagnosticposes.ts:284-308` returns `population`, `distanceToCrowd` and
`carriageway` **as read at derivation time**. The harness writes this into provenance
(`capture.mjs` provenance block) and it sits next to a *live* `pop` in the same sidecar.

**Measured divergence.** Round 5 shot 1: `derivedPose.source.population = {n: 1600, cx: 1032,
cz: 5}`, `distanceToCrowd: 8` — while `pop = {n: 2550, cx: 1104, cz: 0}` at capture time.
**The crowd had moved 72 m** from the point the pose was derived from. Rule 4's mechanical
number is a number about a subject that has since left.

**The check.** `distanceToCrowd` in provenance is **historical**. Use the live `pop.cx/cz`
against `camera.position` for the real distance. Both are in the sidecar; only one is
current.

### 2.9 `crowd` (visibleCount) vs `crowdDebug.instancesCount` — CAN LIE, and used to

`src/main.ts:706` publishes `app.crowd.visibleCount`; `:724` publishes
`crowdDebug.instancesCount`. These were two predicates over the same agents and disagreed
(`250` vs `0`, then `2511` vs `2501`) until `539938f` made the writer run inside the same
guard. Measured this session: **2511 vs 2511**, agreeing across the frames I checked.

**The check.** These two are now the cheapest available corroboration. **If they ever
disagree again, that is a live bug and not a stale field** — this pair is the one place where
disagreement is diagnostic rather than expected.

### 2.10 The 28-float instance record — a real number answering to nothing

`src/sim/crowd.ts:1039-1042` writes `d[b+24..b+27]` into a record whose stride is
`INSTANCE_FLOATS = 24` (`src/render/citymesh.ts:62`), spilling into the next instance's mat4
column 0.

**Measured benign**: determinant exactly 1.000 for all 2511 instances, zero non-finite. It is
benign only because writes ascend in `n`, so each record's own column 0 is written after its
predecessor's spill. It becomes silent corruption the moment records are written out of
order.

**This is the kerb failure class in the sim**: a value computed, stored, and structurally
incapable of being consumed correctly. Routed to developer 2.

### 2.11 The kerb itself — the archetype

`src/render/gbuffer.wgsl:632` (pre-fix) required `abs(n.y) > 0.55` to reach
`groundSurface()`, while `groundSurface()` defines a kerb as `abs(n.y) < 0.5`
(`gbuffer.wgsl:420`). Mutually exclusive. Measured: **3520 kerb-face vertices, 0 admitted.**

**4.319× of authored contrast** sat in vertex colour, computed by the baker, uploaded, and
**discarded at the fragment stage** — never read by anything. Not a stat: a shader input
answering to nothing, which is why it belongs on this list.

**The generalisable check.** *For a value that is supposed to affect the frame, name the line
that consumes it.* `rg` for the name; if the only hits are the producer and a comment, it is
a phantom. This catches the kerb, and it would have caught `vramMB`, `uploadMs`,
`lightDelivery.produced`, the `gait` mask (`gbuffer.wgsl:606` — `alpha` is never written to
`GOut`, and the G-buffer has no blend state), and `crowd.inView`.

---

## 3. Fields that cannot lie by construction

Short, so the omission above is deliberate.

- **`seed`** (`renderer.ts`, published at `:1262`) — a direct read of `world.seed`.
  It earned its place by catching a real incident (`capture.mjs` parsed a hex literal with
  radix 10, so every capture rendered **seed 0** while docs said `0x5e7a17`). Trustworthy,
  and the reason every coordinate in a sidecar is reconstructible.
- **`residentChunks`** (`:1378`) — `this.chunks.size`. Direct.
- **`rebakePending`** (`:1035`) — `this.rebakeQueue.length`. Direct, and now the warm gate's
  real condition.
- **`chunkLod`** (`:2173`) — returns `e.lod`, or `-1` when non-resident. Since `lod >= 0`
  always, `-1` unambiguously means "not resident".
- **`framesSkipped`** (`:1380`, reset at `:1382`) — genuinely per-frame. `0` means zero skips
  in the publishing frame.
- **`camera.position` / `lookAt` / `fov`** — a direct read of the camera pose
  (`cam.getPose()`). Note `lookAt` is the *aim*, and I measured it diverging ~300 m from the
  derived pose's `lookAt` while `position` matched to 0.05 m — so **compare position, never
  aim** (PITFALLS §16, and the harness's own comment at `capture.mjs:860` says fov must not
  be compared).
- **`pedMesh.idx`** (`main.ts:720`) — `entityGeometry.pedestrian.indexCount`, the real uploaded
  count.

---

## 4. The two RESEARCH numbers, which are a different failure

`RESEARCH`: the **0.04 m z-IQR assertion** is void as a blocker (`D26`), and the **avoidance
refutation** was measured on a degenerate population.

Both were true numbers. Neither was trustworthy, because both were measured on a population
that could not have produced a different answer — a uniform distribution has an IQR, and an
avoidance test on agents that never needed to avoid will always "refute avoidance".

**The check, and it is the most transferable item here:** *before believing a statistic,
state what value would have falsified it, and confirm the population could have produced that
value.* A measurement whose population cannot vary cannot refute anything. This is the same
move as the `cull:'none'` control that killed the winding theory in twelve seconds
(PROCESS rule 2), applied before the measurement instead of after.

---

## 5. What a reader should do with a sidecar

1. Treat `requested.position === null` as **"held-camera check did not run"**, not "passed".
2. Treat `entityDraws: []` as **"this sample landed on a skipped frame"**, not "nothing drew".
3. Ignore `vramMB`, `uploadMs`, and `lightDelivery.produced` entirely — all three are
   unwritten.
4. Ignore `tileBins.maxPerTile` / `refusedTiles` unless a `probe('tiles')` ran in that frame.
5. Read `lodHistogram[i]` as *chunks at LOD i*; confirm the camera with
   `chunkLod(cameraChunk) === 0`.
6. Use live `pop`, not `derivedPose.source.population`, for where the crowd is now.
7. Do not reconcile `entityTriangles` arithmetically — two writers.
8. Trust counts and distributions under platform load. **Do not trust any millisecond figure**
   taken while the box is shared (Round 5 platform note).
9. For any value that is *supposed* to affect the frame, `rg` for its consumer. No consumer
   means phantom, and the value will be confident, plausible and wrong.

---

## Verification

`./node_modules/.bin/tsc --noEmit` — see §6. No probe files remain; every measurement quoted
here is reproducible from the cited file and line, and the incident measurements are in
`docs/F1F2_GPU_HALF.md` (Rounds 1–4) and `docs/GROUND_FRAGMENT_DIAGNOSIS.md` (Rounds 5–8).

## 6. Related, not fixed

- **§2.1 `produced`, §2.5 `vramMB`, §2.6 `uploadMs`** are one-line phantoms in my lane. Not
  removed this round: a reviewer's eye may be on them, and deleting a field mid-review is
  worse than labelling it. §5 is the interim label.
- **§1.4 `requested`** — the fix belongs to whoever owns `capture.mjs` held-pose semantics.
- **§2.10** — developer 2's file.
- **`entityDrawEnabled`** (`renderer.ts`, default `true`) — **kept, decision recorded.** It is
  3 lines, it changes no behaviour, and it is the only way to answer "are entities reaching
  the frame" without editing `main.ts`, because `setCrowdCount(0)` cannot zero the instances
  (measured: ~2500 survive; `crowd.ts:338-384` counts every active agent inside `viewRadius`
  regardless of `targetVisible`). Its comment no longer says "remove when F2 closes" — F2 was
  never a render bug — and it names the one capture in which it was load-bearing
  (`docs/F1F2_GPU_HALF.md` §4.2). A switch nobody can interpret is worse than one nobody
  flips; this one is interpretable and has a recorded use.