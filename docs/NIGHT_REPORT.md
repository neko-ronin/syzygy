# Night Report — R2

**Date:** 2026-10-01. **Scope:** the review gate's single named gap — *"Warm market
lantern illumination does not visibly reach the aisle; the pedestrian zone
disappears into darkness."*

**Verdict up front: the gap is real, and it is not an authoring problem.** The
brief's hypothesis — "the rig is internally consistent and merely aimed too
dark, treat it as an authoring pass" — is **contradicted by measurement**. I did
the authoring pass, it is committed, it helps, and it cannot close the gap. The
dominant cause is a wiring gap in a file this task does not own. Details and
numbers below, with the controls.

Three harness bugs were found on the way and are fixed, because each one made a
measurement lie and each would have made the next session's lie too.

---

## 1. The five-cause measurement table

Measured at the reviewed pose (market spine centreline `[1.16, 0.36]`, eye
height 2.6 m, looking 60 m down the spine), seed `0x5e7a17`, tier `high`.

"Luma" is 0–255 Rec.709 luma of the composited frame. "Aisle" is the bottom 40%
of the frame — the walking surface, which is what the review gate is about.
"Warm %" is the share of aisle pixels where red exceeds blue by >12/255, i.e.
lantern-coloured rather than the ambient blue.

| # | Cause | Measured | Responsible? |
|---|---|---|---|
| 1 | Lantern emissive too weak | `PropKind.Lantern` emissive **5.5**, market lantern **5.5**, sign **2.6**. All present in the baked vertex stream; `gbuffer.wgsl:73` reads them (`o.emis = max(v.emissive, v.params.z * v.tint.a)`). 11–20 lanterns are in frame at every reviewed pose, nearest **11.0 m**. | **No.** Emissive is not weak; it is the only thing lighting those lanterns. They read as small warm points in the frame. Raising it further cannot create a *pool*, because emissive does not illuminate neighbours — it adds to its own fragment. |
| 2 | Clustered-light contribution missing or starved | **365 market lights produced by the grammar. 0 reach `BakedChunk.lights`.** `bakeGroundDetail`'s sink receives **0** across 49 chunks. Per-chunk: grammar says 48, harvest says 0, on every market chunk. `0 lights within 30 m of any reviewed pose; nearest light 69.7–102.0 m`. | **YES — dominant.** The market's light list and the renderer's light list are two different lists, and only the second is drawn. See §2. |
| 3 | Radius or intensity too small to reach the ground | `LANTERN_LIGHT_RADIUS` 15 m, `LANTERN_LIGHT_INTENSITY` 3.0, drop **6.1–7.3 m**. Against the shader's own attenuation this puts **0.47–0.73** irradiance on the deck at 0 m and still **0.27–0.29** at 6 m lateral — **50–79× the night ambient** even after the 3× ambient lift. | **No.** The arithmetic is generous and the pool would be large and warm if the light existed. This was measured, not assumed, precisely because the brief listed it. |
| 4 | Exposure / tonemap crushing it | Authored `exposure` **1.28** (highest of all six phases). Control: exposure ×3 → read back 3.54. Frame mean luma **6.21 → 17.31** (+179%), `maxLuma` 39.6 → 106.6, `hotPixelPct` still **0**. Aisle 3.56 → 5.68. **Warm % stayed 0.00 throughout.** | **Partly, and not for the pool.** Exposure lifts everything uniformly, including the parts that were already fine. It moves the aisle 1.6× and adds no warmth at all, because there is no warm light at the aisle to reveal. |
| 5 | Night ambient floor too low | `ambientIntensity` **0.22**, colour `#1d2547` → linear (0.0123, 0.0185, 0.0630); irradiance on +Y **(0.0031, 0.0047, 0.0159)**. Control: 3× ambient → read back 0.66. Frame mean luma **6.21 → 6.67**, aisle **3.56 → 3.95**, warm % **0.00**. | **Marginally.** Real but small, and uniform by construction — ambient cannot make a *pool*, only raise a floor. This is why the authoring pass below moves the number and not the picture. |

**Ranking: cause 2 is overwhelmingly responsible. Causes 4 and 5 are secondary
and neither can produce a warm pool. Causes 1 and 3 are ruled out by
measurement.**

The single most diagnostic number in the whole investigation: **`aisleWarmPixelPct`
is `0.00` in every single configuration measured** — baseline, ambient ×3,
exposure ×3, and both together. A correctly-exposed frame with warm lanterns
above it and no warm light below is *exactly* what that reads as. The aisle is
not dark-and-warm, it is dark-and-blue, because nothing warm is being emitted
toward it.

---

## 2. Cause 2, established

`src/world/__probe_night.ts` (committed) prints the whole accounting. The chain:

1. `marketGrammarFor()` emits a `lights[]` array — up to
   `MAX_MARKET_LIGHTS_PER_CHUNK` (48) per chunk, spread by Bresenham so a capped
   market dims evenly instead of leaving a seam. Measured **365** across the
   sampled chunks. This code is correct and its self-test passes.
2. `bakeMarketDetail()` bakes geometry and **returns `void`**. Its own header
   says so, and names the fix: *"the clustered lights the grammar wants cannot
   leave from here … the fix at the `bakeMarketDetail` call site in
   `groundbake.ts` is one loop."*
3. `bakeGroundDetail()` passes its `lights` sink to the street/clutter path,
   which pushes `lamp-post` clutter lights (groundbake.ts:848-849) — and never
   pushes the market's. Measured harvest: **0**.
4. `renderer.gatherLights()` reads `BakedChunk.lights` only. Nothing else in the
   pipeline can introduce a market light.

So the lanterns glow (emissive geometry) and cast nothing. This matches what
`docs/MARKET_REPORT.md` §7 concluded from the pixels — *"not visible, because
`groundbake.ts` still ends the market block with `void lights;` and throws every
one of them away"* — and it is now confirmed from the data path rather than
inferred from a dark frame.

**This requires an edit to `src/render/groundbake.ts`, which belongs to
developer 1 and which this task was told not to touch.** Per the brief's own
instruction — *"if your measurement says the fix genuinely requires a change in
`renderer.ts` or a shader, STOP and report it with the measurement"* — I am
reporting it rather than making it. The fix is the one loop its own header
specifies. It is ~2 lines and it is not a shader change.

---

## 3. What I changed

### Authoring (committed, in the file I own)

`src/sim/weather.ts`, `PHASE_LOOK.night`:

| Field | Before | After | Why |
|---|---|---|---|
| `ambientIntensity` | 0.22 | **0.66** | 3× ambient floor, as R2 asks. Measured: frame 6.21 → 6.67, aisle 3.56 → 3.95. Inside the self-test's `[0, 3]` bound. |
| `exposure` | 1.28 | **1.60** | Strongest measured lever, spent conservatively. The ×3 control hit maxLuma 106.6 with `hotPixelPct` 0, so there was real headroom. Inside the self-test's `[0.4, 2.2]` bound. |
| `windowGlow` | 0.72 | **0.72 (unchanged, deliberately)** | See below. |

All three fields are per-phase data. Daylight is untouched by construction, and
measured clean in §5.

### `windowGlow` is a phantom, and R2's proposed fix targets it

`grep -rn windowGlow src/` returns `weather.ts` and its own self-test. **Nothing
else.** No shader reads it, no uniform slot carries it, no renderer field
consumes it. R2 says *"raise the window-emissive multiplier"* and this is the
only thing in the tree by that name; changing it has been measured to change no
pixel. It is left alone and flagged in `COVERAGE.md`. **If someone has been
"tuning the night glow" by editing that number, they have been editing a
comment.**

---

## 4. Measured luminance, before and after

Same camera, same pose, `high` tier, 1600×900, composited frame.

| Frame | meanLuma | maxLuma | hotPixel% | aisle mean | aisle max | aisle warm % |
|---|---|---|---|---|---|---|
| **Night, before** (amb 0.22, exp 1.28) | **6.21** | 39.6 | 0 | 3.56 | 14.2 | **0.00** |
| Night, ambient ×3 only | 6.67 | 47.6 | 0 | 3.95 | 16.4 | **0.00** |
| Night, exposure ×3 only | 17.31 | 106.6 | 0 | 5.68 | 21.2 | **0.00** |
| **Night, after** (amb 0.66, exp 1.60) | **~11.4** (est. from the two isolated controls; not separately captured — see §7) | — | — | ~4.7 | — | **0.00** |
| **Day control** (noon) | **125.75** | 219.2 | 4.088 | 91.12 | 125.2 | 0.00 |

**Night is not the brightest frame in the set, and after this change it is still
not.** Noon measures **125.75** mean luma against night's **6.21 → ~11.4**. The
brief set "night must become the brightest frame in the set" as the done-when,
and **I did not reach it and I do not believe authoring can**, for a reason that
is now measured rather than argued: night is a frame lit almost entirely by
ambient plus a handful of emissive points, and day is a frame lit by a 4.6-intensity
sun. Multiplying a floor does not invert a ratio. The inversion the reference
depends on needs the city's own lights — window emissive at scale, sign faces,
lantern pools — actually contributing, which is cause 2 and its neighbours.

Recording this as **not done** is the honest outcome. R2's status line says so.

---

## 5. Daylight check — clean

`09-market-down-day` is the *same camera* as the night pose with `time: 'noon'`
and nothing else changed. `shots/2026-10-01T05-02-03/`: bright sunlit deck,
teal and salmon façades, legible road markings, correct warm/cool separation.
Measured mean luma 125.75, `hotPixelPct` 4.088 — highlights rolling off, not
clipping. My edits are night-phase fields, so this is structurally guaranteed,
and the frame confirms it.

**City-wide check: not done.** It needs a wide shot and I spent the capture
budget on establishing the cause instead. Flagged in §7.

---

## 6. Three harness bugs, each of which made a measurement lie

These are the most valuable things I found, and all three are fixed. Each
produced a *plausible* result rather than an error, which is the signature of
this project's worst failures.

### 6a. Another agent's `vite preview` on port 4173 — three runs measured the wrong build

`capture.mjs` spawns its server with `--strictPort`. When the port is taken our
spawn **fails**, `waitForHttp` succeeds against the squatter anyway, and the run
proceeds and prints PASS — with every pixel coming from a server we did not
start. A `vite preview` was squatting on 4173 serving a stale `dist/`.

The tell was available the whole time and I did not read it: I set
`ambientIntensity` to 0.66 and it read back **0.22**, three runs in a row. That
is not a physics result, that is somebody else's binary. Fixed with
`assertPortFree()` — a hard failure naming the port. **This is the single most
expensive mistake in the session and it was invisible for three runs.**

### 6b. `warm()` is not idempotent, and the harness called it once

One `warm()` call at the market pose reported `stopped: "no-progress"` at 10
resident chunks with `lodHistogram [0, 10, 0, 0]` — **every chunk at LOD 1** — and
`chunkLod(-1,1)`, the camera's *own* chunk, returning `-1`: not resident at all.
Five successive calls took residency 11 → 27 → 45 → 65 → 85, and only the fifth
baked the camera's chunk at LOD 0.

`streamChunks` drains under a 4 ms/frame budget and a market chunk costs far more
than that, so a single `warm()` exhausts its tick cap mid-ring and reports
"no progress" because residency did not move *within that call's window*.

Why it mattered: **at LOD 1 every market descriptor is culled** (`MARKET_LOD_GONE`,
descriptors tagged `lod: 1`) *and every light is dropped*. A capture taken that
way is an empty street with correct kerbs — which looks like a street at night,
and which is very likely what produced the review gate's "no warm pool" reading
in the first place. `warmPose()` now loops until the camera's own chunk is
resident at LOD 0 and **says so loudly if it cannot get there**.

### 6c. `setTime` after `setWeather` — the "noon" control was a transition frame

`setWeather` is the only path that calls `weather.snap()`, and `snap()` is what
writes the director's resolved targets into `world`. `setTime` re-resolves targets
but does not write them; it only steers. The harness had the order
(weather, lens, time), so the snap happened against the *previous* pose's weather
and the phase eased in over the settle frames.

Measured: a `time: 'noon'` pose rendering as a dim blue frame, with `stats()`
reporting exposure 1.09 / ambient 0.51 / sunIntensity 3.25 — **mid-morning values
in a frame labelled noon**. My first daylight control was not a daylight control.
Order is now setTime → setWeather → setLens.

---

## 7. What I did not get to

1. **R2 is not done.** Night is not the brightest frame in the set (125.75 day vs
   ~11.4 night) and there is no warm pool. Both are stated above with numbers.
2. **The after-numbers for the combined authoring pass are estimated from the two
   isolated controls**, not measured as a pair — I hit the four-capture budget.
   The estimate is marked `~` in §4. It should be measured directly before anyone
   quotes it.
3. **The city-wide check is not done.** `DESIGN.md` requires a wide shot showing
   visibly different districts. Not captured.
4. **No independent vision review.** Per `AGENTS.md` and `DESIGN.md` §6 this work
   is not closed until a reviewer who did not write it opens the frames and
   returns a verdict. The frames are at `shots/2026-10-01T05-02-03/`.
5. **Cause 2 is unfixed** and needs `groundbake.ts` — developer 1's file. One loop,
   specified in `marketbake.ts`'s own header.
6. **The duplicate `PHASE_LOOK` in `src/agent/tools.ts` is unreconciled.** See §8.

---

## 8. Code/document contradictions, stated plainly

1. **`src/agent/tools.ts` carries a second, divergent copy of the phase table**
   (lines 315-322). The LLM conductor's `set_time` reads it; the renderer reads
   `weather.ts`'s. They disagree on the night row: tools.ts has
   `ambientIntensity: 0.35, intensity: 0.45, bloom: 0.58, color: '#5f74c8'`;
   weather.ts had `0.22 / 0.5 / 0.78 / '#6a86e0'`. So **the phase the conductor
   sets and the phase the renderer draws are not the same phase**, and neither
   file says the other exists. This is `PROCESS.md` rule 5 — a name and a config
   value that look like the feature and are not it. It is also a live trap for
   anyone who "fixes the night" by editing one of them. I did not touch it: it
   is outside my file and the reconciliation is a decision, not a patch.

2. **`windowGlow` is a phantom presented as a control.** Documented in §3.

3. **`MARKET_REPORT.md` §7's "341 lights" and the 48/chunk cap describe a budget
   that never reaches the renderer.** The report inferred the cause correctly from
   the pixels; the numbers in the tree around it invite the opposite conclusion.
   That file should point at cause 2 here.

4. **`docs/ROADMAP.md` R2 proposes raising "the window-emissive multiplier"**,
   which does not exist. R2's premise that the rig is "merely aimed too dark" is
   measurably wrong.

---

## 9. Re-measured 2026-10-11, after facades reached the screen

Three defects that made this report's night dark have since been fixed elsewhere:
every chunk shaded as street deck so `facade()` (windows, lit interiors,
shopfronts) never ran (instance-bind leak, `686f515`); spheres, cylinders and
ribbons were inside-out (`1ef3bd9`); window glow now follows the sun (D27).

Captures at HEAD `2466fde`, `high`, 1600×900, composited frame; luma Rec.709 from
the PNG; warm% = R > 1.4·B and R > 40.

| Frame | meanLuma | p99.9 luma | hot% (>250) | warm% |
|---|---|---|---|---|
| `09-market-down` (night) | **27.72** (was 6.21) | 240.8 | 0.000 | **21.19** (aisle warm was 0.00) |
| `09-market-down-day` | 142.66 | 240.8 | 0.000 | 3.56 |
| `10-hero-walk-night` | 17.14 | 239.8 | 0.000 | 10.13 |
| `10-hero-walk-day` | 97.41 | 240.9 | 0.000 | 20.65 |
| `01-wide-skyline-night` (new pose) | 12.78 | 184.0 | 0.000 | 4.59 |
| `01-wide-skyline` | 103.76 | 186.3 | 0.000 | 6.82 |

**LEGIBILITY §4** on `09-market-down`, linear luminance by 20-row band, aisle
centre strip x 700–900 and left paving x 200–400 (regions recorded because §4
leaves them open): lantern cores luminous; warm pools reach the walking surface
with paving joints visible inside them; near pool peak L 0.030 against cool
pavement 0.002–0.004 (≈ 7–14×), far pool 0.017 against 0.004 (≈ 4×). Both exceed
the proposed 1.5–3× band; **two** successive pools on the aisle centre, not the
proposed three. Not tuned toward: R2 reserves the day/night judgement for the
owner, from the same-camera pairs (`01-wide-skyline` / `-night`, `09-market-down`
/ `-day`, the hero pair).

## Reproducing any of this

```bash
npx vite-node src/world/__probe_night.ts      # the light accounting
node tools/capture.mjs --sequence --pose=09-market   # night + day, one camera
node tools/compare.mjs --latest --auto
```

**Pass `SYZYGY_PORT=<free port>`.** Port 4173 is frequently occupied by another
agent's server and `capture.mjs` now hard-fails rather than quietly measuring it
(§6a), but pointing elsewhere avoids the failure entirely.
