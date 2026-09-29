# Coverage map

A living map from **the original build checklist** to where each item is
actually covered in this repository.

It exists to answer one question that nothing else does:

> **Is every part of the plan accounted for, and does each part have an owner?**

`ORIGINAL_PROMPT.md` maps the *clauses of the brief* to where they live.
`ROADMAP.md` ranks *outcomes* by visual impact. `HANDOFF.md` holds the current
work items. None of them notice a subsystem that quietly stopped existing.

The build checklist below came from the first session's chat pane and was never
committed. That is why it went stale — items 1–7 were done but still marked
`[ ]` — and why three phantoms survived three sessions. Its marks were never
wrong by accident; nobody could see them.

---

## How to maintain this

**This file grows; it does not get rewritten.** When you add a feature, add a
row. When you discover a subsystem nobody owns, that is the most valuable thing
you can add here.

1. **Every row names an owner** — an `R`-item, an `F`-item, a `D`-decision, or
   the explicit word `UNOWNED`. A row with no owner is the output of this file.
2. **Link, do not restate.** If a row repeats a status that `ROADMAP.md` owns,
   the two will drift. Point at it and let that file hold the status.
3. **Every claim here is verified, not remembered.** Each row was checked
   against the source during the audit below. If you change a status, re-check
   the code first — the point of this file is that it cannot be wrong by
   assumption.
4. **Adding a sub-detail is normal and expected.** Most rows will accumulate
   children as a subsystem grows. Add them as they appear.

**Status vocabulary** — deliberately narrow, because the interesting cases are
the ambiguous ones:

| Status | Means |
| --- | --- |
| `done` | Implemented **and** verified by rendering it |
| `partial` | Some sub-details done; children say which |
| `not built` | No implementation. Named files are scaffolding only |
| `unverified` | Exists, correctness not re-confirmed since it was written |
| **`PHANTOM`** | **A name exists with no system behind it.** Reads as done, does nothing |

`PHANTOM` is its own status because it is the dangerous one: it survives review,
it satisfies a grep, and it will be believed.

---

## The 13 build items

| # | Item | Status | Owner |
| --- | --- | --- | --- |
| 1 | Scaffold: Vite+TS, WebGPU init, headless screenshot harness | `done` | [`HANDOFF.md`](HANDOFF.md) |
| 2 | Math/noise lib + core GPU abstraction | `done` | `src/core/math.ts`, `src/core/gpu.ts` |
| 3 | City generation: districts, canyons, buildings, skybridges | `done` | R9, D14, D15 |
| 4 | Deferred renderer: G-buffer, clustered lighting, painterly shading | `done` | D5, D17 |
| 5 | Atmosphere: volumetric fog, god rays, sky, weather | `partial` | R6 |
| 6 | Camera: free flight + gamepad/keyboard + tilt-shift/roll/FOV | `done` | `src/camera/`, D16 |
| 7 | Post stack: TAA, bloom, DOF, CA, grade | `done` | `src/shaders/post.wgsl` |
| 8 | Crowd sim + pedestrians | **`unverified`** | F1, F2, F3 |
| 9 | Traffic: trams, trolleys, cable cars, ziplines, blimps, balloons | `partial` | F4 |
| 10 | LLM agent integration (weather/camera/events) | `done` | `src/agent/`, D20 |
| 11 | Destructible structures (GPU fracture) | `not built` | R5 |
| 12 | Vegetation / solarpunk overgrowth + district colour identities | `done` | R9 |
| 13 | Iteration loop: screenshots, perf, notes | `partial` | R10, F6 |

Two deviations from the checklist as written, both deliberate and both recorded
in `DECISIONS.md`:

- **Item 8 says "GPU compute". The crowd runs on the CPU** in structure-of-arrays
  (D8). It simulates 6,000 agents in ~2 ms/frame. This is a considered
  trade-off, not a shortfall — the checklist assumed an implementation detail
  rather than stating a requirement.
- **Item 4's WebGL 2 half is missing** entirely. The brief asked for both
  backends; this project is WebGPU-only (D1, R8). The one outright deviation.

---

## The phantoms

Found during the audit by checking each row against the source instead of
against a filename. Each has a name, wiring, or a tool that makes it look done.

None of these were caught in three sessions. Everything in the doc set was
organised around *what to do next*; nothing was checking *what was planned and
where it went*.

| Subsystem | What exists | What is missing |
| --- | --- | --- |
| `godRays` | A weather field, written to the `weather2` uniform (`common.wgsl:25`, `renderer.ts:522`). Set by poses and by the LLM's `set_weather` | **No shader reads `weather2.y`.** No volumetric pass exists anywhere in `src/` |
| `precip` | `weather3.w` (`common.wgsl:26`) | **No shader reads `weather3.w`.** No precipitation renderer |
| `structure-collapse` | An `EventKind` in `core/state.ts:177`; a tool in `agent/tools.ts:132,162` | No fracture renderer. **You can ask the LLM to collapse a structure and it will report success** |
| `debrisChunk()` | Defined at `citymesh.ts:900` | Never called. The GPU debris field R5 depends on does not exist |
| Canal water | `bakeGround()` builds a water mesh (`citymesh.ts:787`) | Dropped on the floor — `renderer.ts:400` uploads `ground.mesh` and discards `ground.water` |

Two consequences worth stating plainly:

- **The LLM will lie by omission.** `structure-collapse` is a registered tool.
  Natural language asking for a collapse succeeds and does nothing. This is the
  D20 event system working as designed with nothing behind it.
- **`godRays: 0.4` in the `01b` pose config** suggests an effect that is not
  being drawn. Reading a pose config as evidence of a feature is exactly the
  mistake this file exists to prevent.

### Incidental finding

`renderer.ts:402` assigns `this.entities = { ground: ... }`, and line 403
immediately overwrites it. A dead store, harmless to output, but it is the kind
of leftover that implies a ground entity exists when it does not. Not on the
roadmap; fold it into the next pass over that function.

---

## Adding rows

The three phantoms above were all found by asking "what did the plan include,
and is each part actually there?" The checklist had 13 items and the map found
gaps inside 5 of them. The sub-details are where the real growth is:

- **As a subsystem grows, add a child row per capability**, with the same three
  questions: is it named, is it wired, does anything consume it?
- **When a feature is added, add it here** — even if it is small, and especially
  if it was not on the original checklist. The map is for the project as it
  stands, not as it was planned.
- **When you retire something, delete its row** rather than marking it done. A
  map full of completed rows stops being read.

*Last verified: during the audit that produced this file, against commit
`66a65df`. Every status above was read out of the source, not out of another
document. If a row disagrees with the code, the code is right and this file
needs the edit.*
