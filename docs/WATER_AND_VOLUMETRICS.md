# Water and volumetrics

Two items that were both marked `PHANTOM` in [`COVERAGE.md`](COVERAGE.md): the
canal water mesh that `bakeGround()` builds and the renderer throws away, and
`godRays`, which was written to the frame uniform every frame and read by
nothing for three sessions.

**God rays are closed** (`6a47405`). **Water is not**, and this document records
why, what it would take, and the measurements god rays produced on the way —
because the water work should reuse them.

---

## Shafts

### What it is

A half-resolution radial scatter march from the sun's position in screen space.
Each pixel walks toward the sun in 14 steps, fetches the depth buffer at each
step, and accumulates how much of that walk is unobstructed sky.

The formulation is the cheap portable one on purpose:

| Candidate | Cost | Why not |
| --- | --- | --- |
| Full-screen radial march | 1 triangle, 14 depth fetches/px, no geometry | **Chosen.** Nothing in a low-frequency effect survives 2× upsample |
| Froxel volume | Faster per pixel, one more target, compute pass | Does not survive a WebGL2 port without a rewrite — the backend is shelved, but a port is still wanted, so this stays a real constraint (D1, R8) |
| Cascaded shadow-map march | Free occlusion, exact | Only correct where the cascade covers; the shafts in the references cut across 300m |
| Reflection probe / cubemap | — | Cannot be justified before water exists; R7 needs the budget more |

The whole pass is plain arithmetic over texture loads. `precip` will need the
same discipline, and the reason `godRays` was invisible for so long is worth
carrying into it: **a feature no pose can see is a feature nothing will ask you
to finish.**

### Why depth, and why reverse-Z makes it free

A shaft is the set of pixels whose line of sight to the sun is not blocked. The
occlusion signal is therefore the depth buffer and nothing else — no extra
target, no extra geometry, no lighting query. Buildings read as the thing casting
the shafts for free, because they are what writes depth.

The main pass clears depth to `0.0` and tests `greater`, so sky is *exactly*
zero. That turns occlusion into `step(d, 1e-5)` — a threshold, not a comparison
against a reconstructed world distance. Cheaper, and immune to the near/far
convention. The cost of getting this backwards is a frame of solid geometry in
the places shafts should be.

### Placement

After the temporal resolve, before the composite. Not before TAA: a
screen-space ray sampled from the previous frame's history smears when the
camera moves, and smearing is the one artefact that makes volumetrics read as a
lens bug rather than as light. Shafts also do **not** feed bloom — bloom on an
already-soft additive term is how shafts turn to mush.

### Cost

| | |
| --- | --- |
| Target | one half-res HDR `GPUTexture` — **2.9 MB** at 1600×900 |
| Geometry | one fullscreen triangle (3 verts) |
| Fetches | 14 per pixel, at quarter the pixels |
| Draw calls | +1 |
| Skipped when | `weather2.y <= 0.001`, or the sun projects off-frame |

Measured `postDrawCalls` 13 / `postTriangles` 13 on `01-wide-skyline`. The
budget question is whether 14 depth fetches beat one bloom mip chain at this
resolution; on the machine this was tuned on, comfortably.

### Controls

Three, deliberately, because a volumetric pass can be "running" and still be
contributing nothing.

1. **Static guard** — `src/render/__perftest.ts` asserts `post.wgsl` reads
   `F.weather2.y`, that a `shafts` entry point exists, and that it returns the
   accumulation it marches. It reads the shader through `?raw`; a renderer
   cannot be imported there (it touches `GPUShaderStage` at module scope) and a
   capture costs 24s. This is the unfashionable kind of check and it is the one
   that matters: **deleting the read must not merge quietly a third time.**
2. **`__syzygy.stats().shafts`** — `{ strength, passRan, sunOnScreen, sunUv }`.
   `sunOnScreen` is the precondition that was never checked, and it is the one
   that matters most (below).
3. **Debug view 6** — the shaft buffer alone, ×2.5 and tonemapped, because
   binding 4 holds it exactly when the pass ran. Black means the pass did not
   run. This is what turned a guess into a measurement.

### What was measured

Aimed away from the sun, the shaft buffer reads a mean luma of **exactly 0.00**.
Aimed into it, **175.64**. Same camera, same code, the only difference being
where the sun projects — the pass contributes precisely nothing when it should
and precisely a lot when it should.

Composite mean luma moved **173.16 → 89.51 → 101.97** as the gain was tuned
0.3 / 0.6 and the radial falloff 6.0 / 4.0: monotonic in the parameter, which is
what an additive term should do.

### The two bugs, and why both were silent

**`captureLocked` did not bind the shaft buffer.** It re-composites into the
readback target with its own bind group, separate from the live path. So every
harness screenshot and every `--eval` pixel read showed a frame with the
volumetrics missing, while the live view had them. The first four measurements
of this feature were measurements of its absence, and the frame still looked
correct. It only surfaced because debug view 6 read a *bright* image when the
sun was off-frame and the pass had provably written black — the one observation
that could not be explained by "it's just subtle".

**The term was multiplied by `sunDir.w`.** That is sun intensity, ~4.6 at dusk,
and the term is additive on top of a sky that already contains that intensity.
Open sky blew to white: a fog card with fourteen steps of extra cost. Fixed by
dropping the factor and adding a radial falloff so the term concentrates near
the sun — which is also what lets the shafts read, since an occluder only
darkens `march` *relative to its neighbours* and only near the sun is there
enough signal for that difference to be visible.

### Why it was a phantom for three sessions

Grep found the field, the writer and the poses. It did not find a reader,
because there was not one — and nothing about that is visible from any normal
angle on this project. The number was plausible, the poses were plausible, the
frame simply did not change.

**And no pose in `references/sections.json` frames the sun.** `01-wide-skyline`
puts it at elevation 0.68 rad, off-frame: `stats.shafts` reports
`sunOnScreen: false`, `sunUv: [-10, -10]`. So even a correct pass would have
been absent from the comparison grid, and a reviewer comparing before/after
would have seen nothing — and reasonably concluded the feature did not work.

That is a coverage gap, not a rendering gap. **A dusk pose with the sun in frame
is a prerequisite for reviewing this, not a follow-up**, and the same applies to
anything else that only exists under particular lighting.

---

## Canal water — still open

### Current state

`bakeGround()` returns `{ mesh, water }`. The water mesh is built and
discarded. `waterDepthAt()` works and the canal district exists, so the *data*
is fine; nothing consumes it.

### What it would take

- **Geometry.** A ribbon along the canal spine from the district definition,
  emitted into the existing water builder. `waterDepthAt` already gives the
  depth field, so the surface is a function of data that exists rather than
  something to invent.
- **Material.** `MAT_WATER` is already a material id in the g-buffer and the
  branch exists. What is missing is the *look*: a water surface that is not
  convincing is a specular highlight over a dark quad, and that reads as a bug.
- **Reflections.** Undecided, and deliberately so until the geometry exists and
  its cost is measured. A cube probe is too expensive to guess at. A planar pass
  is the obvious candidate but doubles the draw count for a level that is
  visible for a few seconds per flythrough. **Recommendation: build the
  geometry and a Fresnel-weighted sky term first, measure, and only then argue
  about reflections.** A canal that reflects the sky convincingly sells itself;
  one that reflects the buildings sells itself twice as well and costs twice as
  much, and the difference is not worth finding out second.

### Open questions for whoever picks it up

- Which poses actually see water? `01-canyon-up` and `05-aerial-top` if the
  canal is on the route; nobody has checked.
- Is `MAT_WATER` reachable from the water mesh's material index, or does the
  water builder need its own draw? Unresolved.
- Night or day sells a canal better? R7 claims the night shot; verify against
  the reference sheet rather than trusting the claim.

### What to reuse from the shafts

The measurement habit, not the code. Three controls, one of which
(`sunOnScreen`) existed only because a feature was invisible for a long time.
Water's equivalent question is "which pose shows this", and it should be
answered before the code is written, not after it looks wrong.
