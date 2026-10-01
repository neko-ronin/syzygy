# F5 — Ground surface at eye level: what was built, and what is still wrong

**Owner:** developer 1. **Commits:** `598a51f`, `05aa54b`, `2f14cdc`, and the round-2
commit that follows this file.
**Rule 7 applies to this document:** everything below was measured, and the things
that were *not* measured are labelled as such. Nothing here should be re-derived.

---

## 1. The two-line version

The city had a ground surface that was one 4096 m quad in a single hard-coded grey,
plus 1.2 m "kerb" boxes on a jittered 48 m **world-axis** grid with no relationship
to the street network. `DistrictPalette.ground` — eleven authored district ground
colours — was read by nothing at all.

It is now a grammar: eleven district surface definitions, per-chunk kerbs, footways
and road paint traced from the real street field, per-pixel surface synthesis in the
fragment shader, and street furniture placed against building lines.

And the biggest single defect found in this renderer along the way: **`MeshOpts.emissive`
was a dead wire.** Every glowing lantern and every illuminated sign in the city wrote
a real emissive value into a vertex buffer that the vertex shader threw away one line
later.

---

## 2. Per-chunk triangle delta — measured, same 12 chunks throughout

Baseline is the commit before F5 (`cc4bd7d`). Every row is `bakeChunk` on the same 12
chunks within 1500 m of the origin, best of 4 runs, via the real baker.

| | tris/chunk | min | p50 | max | ms/chunk |
| --- | --- | --- | --- | --- | --- |
| **baseline** | 78,485 | 53,228 | 83,820 | 88,518 | 12.3 |
| round 1, district deck + kerbs/footways/paint | 87,382 (+11.3%) | 62,754 | 92,170 | 98,498 | 27.0 |
| round 1, + street furniture | 95,439 (+21.6%) | 71,374 | 99,982 | 109,690 | 29.8 |
| **round 2, spec-driven furniture + gutter** | **97,662 (+24.4%)** | 73,314 | 101,646 | 112,990 | 45.8 |
| lod 1 (kerb line only) | 36,774 | 28,372 | 37,094 | 44,532 | 27.3 |

Ground contribution per chunk: **23,406 triangles** — kerbs, footways, gutter joints,
paint and furniture. The `ms` column is machine-load sensitive; other agents were
compiling concurrently throughout, so treat the ratios as indicative and the triangle
counts as exact.

Furniture per chunk, round 2: **116 placed of 116 wanted, 6,823 triangles, 9.6 lamps.**
Round 1 placed 182 at 7,923 triangles, so round 2 has **fewer objects for 86% of the
triangles** — because the objects are structurally real rather than being single
boxes. That is the trade the spec asks for: "spend scarce geometry on edges,
thickness, posts, brackets and canopy silhouettes".

Budget controls, in order of how much they will bite: `CLUTTER_TRIS` (9000),
`TRACE_STEP` (5.0 m), `SEED_PITCH` (8.0 m).

---

## 3. Accuracy of the geometry — measured

**Kerb position.** Pooled over 12 chunks, the kerb sits **p50 0.10–0.43 m / p90
1.0–2.8 m** from the carriageway edge that the same street field reports at the
kerb's own position. The spread is junction density: a chunk with many crossings has
a much worse p90 than one without. `src/world/__selftest.ts` prints the percentiles
on every run and fails above p50 0.5 m or p90 6.0 m.

**Pavement family round trip.** `groundGrammarFor` writes the family into the vertex
colour as a (saturation, value) band; `pavementFamily()` in WGSL reads it back.
Measured: **66/66** (district, road kind) pairs correct, and all 10 bands uniquely
nearest to themselves. Both numbers are asserted in the self-test, because two earlier
encodings measured **29/66** and **36/66** and would have shipped silently.

**`PROP_TRIS`.** The hand-written table in `__selftest.ts` was wrong for **16 of 17**
entries and underestimated the mean by **2.7×** (18.4 tris/prop claimed against 49.9
measured). Rebuilt from the real emitter. Method is in the file: bake a 2 m chunk box
placed in open ground at 8 copies of one prop kind and divide the difference from a
0-prop bake by 8. Placing the probe away from the streets is the whole trick — the
first attempt used a real chunk and returned **negative** numbers, because
`bakeChunk` shares one RNG across buildings, props and ground detail, so changing the
prop count shifts every later draw.

---

## 4. The emissive fix, and how it was verified

`gbuffer.wgsl` computed `o.emis = v.params.z * v.tint.a`. For every chunk draw
`params.z` is 0 by construction, so `o.emis` was **always zero** and the entire
per-vertex emissive channel was dead. `PropKind.Lantern` (5.5), `PropKind.Sign`
(2.6), antenna beacons (3.0) and every lit market element wrote real values into a
buffer that was discarded one line later.

Fixed to `max(v.emissive, v.params.z * v.tint.a)`. `max`, not `+`: entity meshes also
carry per-vertex emissive (`entityMeshes.tramCar()` marks its headlights 8.0) on top
of a per-instance `params.z`, so summing would double-count every entity emitter and
push it through the bloom threshold at 1.05.

**Verification, measured on `08-night-lanterns`, same pose, fix reverted vs applied:**

| | mean luma | max | pixels > 200 |
| --- | --- | --- | --- |
| fix reverted | 57.885 | 206 | 1,791 |
| **fix applied** | **63.069** | **211** | **4,589** |

**2.6× more near-saturated pixels**, in the brighter direction, from a one-line change
that only affects vertices carrying a non-zero emissive mask. **Peak luma 211/255, so
nothing blooms out** — the bloom prefilter threshold is 1.05 on luminance and the
authored values (lantern 5.5, projecting sign 3.4, lamp bracket 4.2) sit above it
without clipping the tonemap.

**What is NOT verified:** that a lantern *reads as a glowing lantern at street level*.
`08-night-lanterns` frames a canyon looking upward; the ground occupies under 10% of
frame and no lantern is legible in it. See §7.

---

## 5. What was built, in the order it was built

1. **`src/world/groundgrammar.ts`** — 9 pavement families, 6 kerb styles, 6 marking
   styles, 11 district entries plus road-kind sharpening, `CLUTTER_KINDS`,
   `CLUTTER_EDGE`, `streetFrameAt`, `GroundBakeCtx`. Pure data, no WGSL, no GPU types.
   Wires `DistrictPalette.ground`.
2. **`src/render/groundbake.ts`** — per chunk: kerb face, kerb top, footway band,
   gutter joint, road paint, street furniture. Traced from `sampleStreetPlan`, emitted
   into the chunk's solid builder so it streams and culls with the buildings.
3. **`groundSurface()` in `gbuffer.wgsl`** — per-pixel synthesis: family-specific
   grain, slab joints on a rotated per-cell lattice, worley cells for cobble, staggered
   plank courses, board bands with timber grain, chequer relief, worn paint, kerb faces.
4. **Street furniture** — 28 `CLUTTER_KINDS` with correct street-facing yaw.
   `PropKind.Zipline` and `.Cable` had `PROP_SIZE` entries, were never emitted and had
   no case in `pushProp`; both silently rendered as a 0.3-scale metal cube. Fixed.

---

## 6. Six silent bugs found by measuring, not by reading

1. **The lateral normal read the wrong array slot.** `t.p` is `x, z, tx, tz, width`;
   the normal read `t.p[i*5+4]`, which is the **width**. Every kerb landed tens of
   metres from its road and the emitted geometry spanned 2.3 km instead of 256 m.
   Nothing threw; the triangle count looked plausible. `__selftest.ts` now asserts
   every emitted ground normal is a unit vector, which catches a wrong stride at once.
2. **`traceOne` tested both axes against a box derived only from `minX`**, so every
   trace on any chunk not on the world diagonal died on its first step. Found by
   printing the trace-length histogram: p50 was 2 steps against an expected ~70.
3. **Both chunks laid the same footway** wherever a carriageway ran along a chunk
   boundary — coplanar duplicates z-fighting arbitrarily. Fixed by giving each band
   one owner. Out-of-chunk vertices 6132 → 260 → **0**.
4. **The one-query edge predictor never corrected downward**, so the kerb offset could
   only grow and drifted: p50 0.39 m → **3.16 m** from one missing line.
5. **The pavement decode was wrong for 37 of 66 pairs** with the first encoding and
   **30 of 66** with the second (banding before road-kind sharpening). Both looked
   fine; the self-test prints the number every run.
6. **`MeshOpts.emissive` was a dead wire** (§4).

Two more found by *looking at the frame* rather than reading the code:

7. The carriageway crack network was `1 - smoothstep(0, 0.035, abs(fbm - 0.5))`, which
   draws the **iso-contours of a smooth field** — a topographic map laid on the street.
   It rendered as thick black loops of spilled oil. Replacing it with a level set of
   worley F1 was wrong differently: that draws **rings around each feature point**,
   because a cell border is not a level set of the distance to the nearest point. A
   real crack net needs `F2 - F1` and `worley2()` in `common.wgsl` returns F1 only.
   Both versions read as a decal, and a decal on a street reads as a bug rather than
   as wear, so the crack network was **removed rather than tuned**.
8. The round-1 deck came out at ≈0.87 sRGB — brighter than any real paving. That was
   an over-correction and `docs/STREET_SPEC.md` §A says why; see §7.

---

## 7. What the visual spec changed, and what it is still wrong about

`docs/STREET_SPEC.md` was written after opening every reference sheet. Three of its
findings contradicted the brief I was working to, and it was right on all three.

**The references show stairs, decks, terraces and canals — not carriageways.** So:

- The round-1 `0.62` deck darkening was **an over-correction**. The spec: "the
  pedestrian surface can be a bright plane"; "foreground treads are LIGHTER than
  adjacent dark fronts". The deck multiplier is now **conditional on the family**:
  asphalt / rubber / dirt keep 0.82 (a genuinely dirty carriageway), and the six
  deck-and-terrace families get **no multiplier at all**, so the whole corridor reads
  as one continuous walking plane. The footway is lifted 1.15× in both cases, making
  the walking plane the brightest ground surface.
- **Kerbs, bins, drain covers, manholes and the original street kit are UNCONFIRMED**
  in the references. The round-1 `CLUTTER_KINDS` list was invented. It has been
  rebalanced: `bin` removed from every district, `bollard` kept only where a grammar
  gives it a reason (a `bollard-line` kerb, the canal quay — where the district's own
  description asks for mooring bollards), drain covers and manholes kept at low
  weight. Eight reference-evidenced kinds appended: `railing`, `bracket`,
  `projecting-sign`, `lamp-bracket`, `awning`, `balcony`, `planter-row`, `step-edge`.
  `CLUTTER_KINDS` is append-only so no index already handed out changes meaning.
- **Uniform procedural repetition is the named risk.** Implemented as three rules in
  the placement loop: items go to the **building line or the kerb line** per
  `CLUTTER_EDGE` and never across the middle; gaps are re-rolled in 0.22–0.72×
  (clump) or 1.7–3.4× (open stretch); and `CLUSTER_MEAN` holds the mean so the
  authored `clutterDensity` still means what it says. **The naive version of this —
  reject 34% of opportunities and widen every remaining gap — cut placement from 182
  to 70 items per chunk, which is deletion, not clustering.** That measurement is why
  the mean is compensated rather than assumed.
- **The three-metre bar**: a kerb now has a top face, a vertical face *and* a gutter
  joint against the road. Wall-mounted objects (sign, bracket, lamp bracket, awning,
  balcony) carry visible arms running back to the facade; `placer` puts local −Z on
  the building line so the arms attach rather than float. Railings have three
  distinct member thicknesses at 1.0 m (the spec's own 0.9–1.1 m estimate); step rises
  are 0.18 m (spec: 0.15–0.20 m).

**Every market element is labelled a DESIGN HYPOTHESIS**, in `CLUTTER_KINDS`,
`DISTRICT_GROUND` and `src/world/marketgrammar.ts`. The spec is unambiguous that the
reference set contains no legible night market. Nothing in the market vocabulary has
reference authority, and the only relationship the references support for a night
register is A's "warm pedestrian light against cool violet/blue surroundings".

---

## 8. What was NOT done

- **A lantern glowing at street level is unverified.** The emissive fix is measured
  live (§4), but no pose in the harness frames one. `08-night-lanterns` looks up a
  canyon; `01b`/`01c`/`03` are hardcoded at the world origin while the city is centred
  near (933, 49). This is F2, and it is why F5 cannot be closed by the implementer.
- **The night register was not evaluated.** Fixing the emissive channel unlocks it and
  R2 is described as cheap with a large payoff, but nobody has looked at a night
  street since. `08-night-lanterns` does not currently render one.
- **A crack network.** Removed rather than faked (§6.7). Needs `F2 - F1` from
  `common.wgsl`, which is not this task's file.
- **Paving joints run on world X/Z**, not a street-aligned frame, because the GPU
  cannot reconstruct the street field. Per-cell hash rotation hides most of it, but a
  joint crossing a road at an angle is possible.
- **`03-tram-level` and the other origin-anchored poses were not fixed** — F2/F6 are
  another agent's, and `tools/capture.mjs` is theirs.

---

## 9. Contradictions found between the code and the documents

| Claim | Reality |
| --- | --- |
| `HANDOFF.md`: 3 `tsc` errors in `gpuutil.ts` "could not be reproduced" | They reproduce. `npx tsc` resolves to a **global TypeScript 7.0.2**; the project's pinned **5.9.3** at `./node_modules/.bin/tsc` is clean. Neither agent was wrong — different compilers. The documented check is unpinned. |
| `bakeGround`'s shader comment: "painted markings come from the baked kerb geometry" | There were no painted markings anywhere in the codebase. Corrected. |
| `GroundBakeCtx.seed` and `BakedChunk.seed` exist and are documented as feeding the fragment stage | `GpuMesh.ib` is allocated per chunk and never bound, so no per-chunk instance data reaches the shader. |
| `__selftest.ts`'s total-triangle line | Understated by ~11× (0.57M reported against 6.22M measured through the real baker). Now measured from the emitter. |
| lod tiers on `bakeChunk` | Correct but **inert**: `renderer.ts:618` calls `bakeChunk(chunk, 0, seed)` unconditionally. |
| `sampleStreetPlan`'s `clearance` read as a distance | It is not one. For the grid and alley families it evaluates the domain warp at the **query** point, with a gradient of ~1.5 m/m, so `out.dist` is the distance to a line whose position depends on where you asked from. `makeBuilding`'s setbacks use it. Highest-value follow-up this work found. |
| `i.uv` is a shader input | `uploadMesh` reads the uv array with a 3-float stride against a 2-float layout. Garbage. Nothing reads it. |
| `HANDOFF.md` "night is nearly black" | Partly this: the emissive channel was disconnected, so no lantern, sign or beacon emitted at all. |

---

## 10. Verification output, verbatim

```
$ ./node_modules/.bin/tsc --noEmit
(no output)

$ npx vite-node src/world/__selftest.ts
ground detail  20477 tris in 259756 verts, 65 carriageways, 7680m of edge, 30ms, 0 lights
              furniture 70 placed / 70 wanted, 3893 tris, 7 lamps (budget 9000 tris/chunk)
...
VIOLATIONS   none — all invariants hold

$ node tools/lsp-check.mjs
5/5 language server(s) verified

$ node tools/capture.mjs --eval "1"
PASS   0 shot(s) · 2.6s
```

(The self-test figures above are from the run before `CLUSTER_MEAN` was added; the
current figures are 116 placed / 116 wanted, 6,823 tris, 9.6 lamps, 23,406 ground tris
per chunk.)

Note for anyone re-running: `npx tsc` is **not** the project's compiler here. Use
`./node_modules/.bin/tsc --noEmit`.

---

## 11. Capture paths

- `shots/2026-10-01T01-20-55/08-night-lanterns.png` — emissive fix **applied**
- `shots/2026-10-01T01-22-34/08-night-lanterns.png` — emissive fix **reverted** (control)
- `shots/2026-10-01T00-31-03/`, `shots/2026-10-01T00-33-09/`, `shots/2026-10-01T00-34-26/`
  — round-1 street-level frames, including the crack-network iterations

**Harness bug, reported not fixed** (`tools/capture.mjs` is another agent's): the
per-pose loop is inside `} else if (opts.sequence) {`, so `--pose=X` *without*
`--sequence` silently ignores the filter and shoots the app's default camera. The
command documented in `AGENTS.md` — `node tools/capture.mjs --pose=canyon` — is a no-op
filter. It cost two captures in round 1: both produced identical framings under
different pose names. Use `--sequence --pose=...`.
`--eval` is the cheap way to smoke-test a shader: it boots, compiles every module and
hard-fails on WGSL errors, with no settle loop and no screenshots — 1.5 s against 14 s.