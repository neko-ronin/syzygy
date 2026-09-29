# The original prompt

Verbatim, as given at the start of the session that built this repository. Kept
unedited so that every later judgement can be traced back to what was actually
asked for, rather than to a memory of it.

---

> visually hyperrealistic city simulation syled with surreal proportions and
> dreamlike camera distortion that produces a great sense of depth, vertigo and
> scale. it has seperate systems of simulations emerging into a realistically
> active living city of pedestrians and traffic. no cars, only alternate form of
> transportation like rail cars, trolleys, ziplines, blimps, personal hot air
> ballons. wire a free floating camera to playstation controls and keyboard
> controls.
>
> image and video resource inspirations are in ./inspirations/
> lean toward solar punk beautiful colorings. allow large sections of the city to
> have differing styles and colors like a real city. atmostpheric lighting and
> atmostphere effects are vey important. use performance tricks but structures
> should be able to transform into a destructible form like in games with
> destructible enviroments in gameplay. there is no gameplay it is an interactive
> simulation experience.
>
> Break up work as needed to recover work done without having work get lost by an
> agent hitting a session limit. even when completed, continnue iterations until
> quality, details, fidelity, and performance optimization reaches near or
> surpasses the videos.
>
> inlcude LLM agent integration so I can prompt to control weather, to move the
> camera, to create events. each person should have the capacity to have
> independent goals but use optimzations to run this performatively. this sim
> runs in a web browser with GPU access.
>
> you're in herdr enviornment and have two agents in this workspace in the claude
> and developer pane. use your own subagents as well so we are free to
> communicate.
>
> use webgl 2 and webgpu to build this. go by your own judgement and drop
> screenshots every iteration and I'll steer with comments on my own volition.
> you don't need to ask me for directions, I'll interject.
>
> this will be continuously interated on with no condition for completion so
> engineer it so that iteration comes at ease. the product goal is to act as a
> spectacle and showcase representing the enhanced abilities of every AI model
> release. Every new frontier model will be assigned to improve the dreamscape
> styled simulated world.

---

## Reading it as a specification

Each clause, and what it commits the project to. The roadmap in
[`ROADMAP.md`](ROADMAP.md) is organised around these; the status column there is
the honest current state against each. For the build-level map — which planned
subsystems are covered, and which are a name with nothing behind it — see
[`COVERAGE.md`](COVERAGE.md).

| Clause from the prompt | What it demands | Where it lives |
| --- | --- | --- |
| "visually hyperrealistic" | Photographic materials, light transport, and finish | `src/render/`, `src/shaders/` |
| "surreal proportions" | A city that is *architecturally* impossible but reads as a real one | `src/world/citygen.ts` |
| "dreamlike camera distortion" | A lens model, not a filter stack | `common.wgsl` + `post.wgsl`, driven by `Lens` in `state.ts` |
| "depth, vertigo and scale" | Tilt-shift miniature, roll, speed-coupled FOV, canyon fog | `post.wgsl`, `camera.ts`, `applyFog` |
| "seperate systems of simulations emerging into a living city" | Independent agents that compose into something unplanned | `src/sim/` |
| "pedestrians and traffic" | Two populated systems, both visible | `crowd.ts`, `traffic.ts` — **traffic is simulated but never drawn** (F4); pedestrian rendering is unverified (F1) |
| "no cars" — rail cars, trolleys, ziplines, blimps, hot air balloons | A closed set of vehicle kinds; nothing on four wheels | `VehicleKind` in `traffic.ts` |
| "free floating camera to playstation controls and keyboard" | 6-DOF flight, gamepad first-class | `src/camera/` |
| "solar punk beautiful colorings" | A palette doctrine, not a mood | `src/world/districts.ts` |
| "large sections differing styles and colors" | Districts that are spatially coherent | `districtAt` / `districtField` |
| "atmospheric lighting and atmosphere effects are **very** important" | Called out twice in the prompt. This is the highest-value target. | `lighting.wgsl`, `common.wgsl` |
| "use performance tricks" | LOD, instancing, streaming, clustered lights — all present in kind | `renderer.ts` |
| "structures should be able to transform into a destructible form" | Collapse/debris capability | **Not implemented.** Roadmap R5. `structure-collapse` is a registered event and LLM tool with no renderer behind it — see [`COVERAGE.md`](COVERAGE.md) |
| "no gameplay" | No score, no objectives, no fail state. A place, not a game. | Enforced by omission |
| "LLM agent integration ... weather, camera, events" | Natural-language control of the world | `src/agent/` |
| "each person ... independent goals but use optimzations to run this performatively" | Per-agent goals at population scale, not N agents × LLM | `crowd.ts` need-mix |
| "web browser with GPU access" | Runs in a tab | WebGPU |
| "use webgl 2 **and** webgpu" | Two backends | **WebGPU only.** See below |
| "drop screenshots every iteration" | A visual feedback loop is mandatory infrastructure | `tools/capture.mjs` |
| "engineer it so that iteration comes at ease" | Iteration cost is a first-class engineering concern | `docs/PROCEDURES.md` |
| "no condition for completion ... every new frontier model will be assigned" | Quality bar: match or exceed the reference video | `ROADMAP.md` |

## The one outright deviation

The prompt asked for **WebGL 2 and WebGPU**. This project is **WebGPU only**.
`src/core/gpu.ts` requests an adapter and device from `navigator.gpu`; there is no
GL context, no shader translation, and no fallback path. Recorded as D1; the
open product question is tracked as R8.

This was a deliberate early call, not an oversight, and it should be recorded as
one: WGSL compute is load-bearing for the light binning, the deferred G-buffer is
a natural fit for WebGPU's MRT, and a half-finished GL backend would have been a
second, worse codebase. The cost is that a meaningful slice of users — anything
without WebGPU — sees nothing at all. Whether to close that gap is an open
product question, tracked as **R8** in the roadmap. If it is taken on, the honest
framing is "a genuine second renderer", not "a compatibility shim".

## Reference material

The inspiration folder is **`inpirations/`** (misspelled in the repository; it is
not a typo this project introduced — do not "fix" it without asking, git history
will be confusing). It is on disk but **not tracked in git**: the nine `.mov`
files are ~670 MB of reference material rather than source (D22). A fresh clone
does not include them, so copy them from a working checkout before comparing.
It holds:

- `dreamscape/` — nine `.mov` files, the actual quality bar. Extract frames with
  ffmpeg; they are the reference for density, palette, and atmosphere.
- `metropolis/` — two solarpunk stills that set the colour doctrine.
- `vehicles/`, `inhabitants/`, `world-items/` — concept art for vehicle and
  prop language.

**Use these.** Every "is this good enough" judgement in this project should be
made against them, not against imagination. Several times during bring-up the
distinction between "a bug" and "an aesthetic choice" was only resolvable by
comparing to a reference frame.
