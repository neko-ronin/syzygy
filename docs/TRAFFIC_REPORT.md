# Traffic report — developer 2, round 4

F4: traffic has been simulated since `cc4bd7d` and never drawn. This wires it.

Commits on this work: the traffic draw layer, the cable-car route fix, and the
pose. Everything below was measured.

---

## 1. What I wired

**The instance buffer** — `buildVehicleInstances` in `src/sim/traffic.ts`. One
`Float32Array`, the shared 24-float layout (D18): mat4 model, `tint` vec4,
`params` vec4. It writes vehicles grouped by mesh, one contiguous block per
mesh, so the renderer can draw each at its own instance offset.

**`RailLine.suspension`** — existed and was read nowhere. Copied onto `Route` in
`makeRailRoute` and exposed as `TrafficSim.suspensionOf(v)`.

**`Vehicle.forward`** — new. The unit tangent of travel **including grade**,
signed by direction so a tram that turned at a terminus faces the way it is
going. `stepRail` already computed that vector for its grade penalty; this keeps
it rather than making the draw layer re-derive it. `stepAir` and `stepCycle` set
theirs too.

**`pendingEntities`** — one upload for the whole frame, per-mesh draws issued
against the pass encoder and the two getters `Renderer` already exposes.

### Why one upload and not `drawEntitySet` per kind

`Renderer.drawEntitySet` calls `uploadInstances(data, count)` on **every**
invocation, and `uploadInstances` writes at `bufferOffset: 0` with
`drawIndexed(..., instanceOffset = 0)`. WebGPU is deferred: all the
`writeBuffer` calls land before the command buffer runs, so the last upload wins
for the whole buffer. Two calls in one frame would draw the second set's bytes
for the first set's mesh — a tram wearing a pedestrian's matrix, and both
counters agreeing. There was no way to observe that from a counter.

So `main.ts` packs pedestrians then vehicles into one contiguous buffer, uploads
it once, and issues the draws itself against `renderer.entityGeometry` and
`renderer.instanceBuffer`. **No change to `renderer.ts` was needed**, because
both getters are already public.

---

## 2. The rail transform, honoured

`heading` is a yaw. A model matrix built from it leaves a tram level on a graded
alignment: it floats off the rail on the way up and sinks into it on the way
down. The fix is `v.forward`, and it is *measured* rather than asserted
downstream, because `buildVehicleInstances` is the only scope holding both the
tangent the sim computed and the column that went into the buffer:

```
steepest written grade 75.5%, forward-column error 3.1e-8 (verified)
```

Column 0 is `worldUp × forward` — world up is the reference, not the vehicle's,
so a funicular descending a steep grade still stands on its rails instead of
rolling with them. A zero `forward` (a blimp stalled against its keep-out box)
falls back to `heading` rather than collapsing the basis into a singular matrix
that draws nothing and reports nothing.

**The hang uses `suspension`.** `cableCar()` spans y −1.1…+2.3 and carries a
hanger arm from +1.25 to +2.1 with a cap at +2.2, so its cable is at local +2.2
and the body belongs 2.2 m below the line. `ziplineRider()` spans −0.2…+0.4 with
the head at +0.30, so its cable is ~0.5 m above the body. Both measured from the
built mesh bounds.

---

## 3. A bug the draw layer exposed: every cable car was on a tram line

`byKind.cablecar` was bound by a fallback that ran *inside* the route sweep:

```ts
if (r.family === 'rail' && this.byKind.tram < 0) this.byKind.tram = i;
if (r.family === 'rail' && this.byKind.cablecar < 0) this.byKind.cablecar = i;
```

Guarded only by `< 0`, it bound every unbound kind to whichever rail route came
first in the list — and route 0 is a tram line. **Measured, before:**

```
cablecar vehicles by route index: { '0': 27 }
cable car sample: route 0 y=8.7  /  y=0.6  /  y=9.4
cable car line altitudes          219..607 m
```

All 27 cable cars rode a street-level tram alignment at 1–9 m, while the cable
car lines they were supposed to be on run at 418–607 m. **After:**

```
cable cars 422-537 m altitude vs trams 9 m ceiling
```

Nothing reported it. The HUD said `cablecar`. The self-test checked speeds and
NaN and passed. No counter anywhere compared a vehicle's altitude against its
line's — which is now an assertion:

> `if (cableAlts.length > 0 && cableFloor < railCeiling + 20)` →
> *"cable cars fly at N m while trams reach M m — they are on the wrong lines"*

The fallback now runs as a second pass, after the sweep, so it can only bind
kinds that are genuinely unbound.

**This is the F4 phantom in miniature.** A name, a counter and no pixels — and
in this case not even the right pixels.

---

## 4. Which kinds are drawn, and which are not

| kind | drawn as | range | why |
|---|---|---|---|
| tram | `tramCar` | 460 m | 18 m long; past 460 m it is a smear on a road that is already a smear |
| trolley | `tramCar` at 0.78 | 460 m | shares the alignment, offset 5.2 m; a shorter rail box is the right read |
| funicular | `tramCar` at 0.62 | 460 m | steep, short, roof-to-street; a smaller rail box reads correctly |
| cablecar | `cableCar` | 1100 m | the compositional subject of the whole reference set |
| zipline | `ziplineRider` | 620 m | 0.65 m tall; it is a silhouette on a wire |
| blimp | `blimp` | 1500 m | 60 m envelope at 180–340 m; still a shape at 1.5 km |
| balloon | `balloon` | 900 m | 20 m; stops where the envelope stops being a silhouette |
| **cycle** | **dropped** | — | **no mesh exists.** `rider` is 0.65 m tall and would need 2.6× scaling to stand a person up, at which point it is indistinguishable from a pedestrian and the frame would be showing a lie. 3–6 of 194 vehicles. |

**There is no per-mesh LOD, only a distance cull.** Six meshes exist for the
eight kinds and each kind gets exactly one, so a tram at 400 m is the same 88
triangles as a tram at 5 m. Real LOD needs either more meshes (a low-detail tram)
or a shader-side decimation, and `entityMeshes` is not mine.

---

## 5. Measured instance and triangle counts

Live, in the app, at the derived poses (seed `0x5e7a17`):

| pose | drawn | blocks | instance tris | frame tris | draws |
|---|---|---|---|---|---|
| tram-level (street) | **64** | tram 42@0 · cablecar 18@42 · blimp 3@60 · balloon 1@63 | 23 200 | 3.06 M | 97 |
| tram-level (street, night) | **64** | tram 42 · cablecar 18 · blimp 2 · balloon 2 | 43 880 | 3.65 M | 90 |
| cable-car (alt) | **37** | tram 12 · cablecar 18 · blimp 5 · balloon 2 | 26 328 | 2.99 M | 94 |

Against 129 alive vehicles: **65 culled by distance, 3 dropped for want of a
mesh.** Vehicle triangles are **0.23 %–1.4 %** of the frame. The instance-buffer
memcpy that packs the two sets measured **0 ms** (`packMs: 0` in the stats
block).

### The buffer is shared, and there is room

`instBuf` is 4096 instances and pedestrians and vehicles now contend for the
same one. From `entityTris` at a street pose: 62 360 = 60·P + 42·88 + 18·58 +
2·264 + 2·484, so **P ≈ 935 pedestrians + 64 vehicles ≈ 1000 of 4096 — 24 %,
with 3096 headroom.** Not a constraint today; it is a shared clamp and the
combined total is what should be watched.

---

## 6. `cableDensity`: I did not change it, and here is why

The brief asked me to fix `cableDensity` being anti-correlated with height. I
measured it before touching anything:

```
corr(midHeight, cableDensity) = -0.235
market-spine   15-62 m   1.95      lantern-bazaar  18-78 m   1.70
monastery      270-600 m 0.60      neon-arcology   310-600 m 1.10
```

The correlation is real and it is weak. **But `cableDensity` is not the knob.**
It is read in exactly two places:

```
src/world/citygen.ts:597   const dense = style.cableDensity * cfg.detail;
src/world/citygen.ts:753   const attempts = Math.round(5 * style.cableDensity * detail);
```

Both are **facade clutter and building cables**. Nothing reads it on the aerial
network. Changing it would have altered facade clutter and achieved nothing about
ropeways — which is why I did not make a change that looks like progress and is
not.

**The actual knob is `gatherTowers`' height band**, in `networks.ts`, and the
measurement says the band is the problem:

```
buildings within 1200 m: 2214, height p50 251 p90 506 max 600
  in the 140-240 m tower band: 168
  above 240 m:               1200
```

`gatherTowers(city, [0,0,0], 1200, 140, 240)` builds the aerial network from
buildings **140–240 m tall** — 168 of 2214, i.e. 7.6 % — and excludes every
building above 240 m, which is 1200 of them and includes the whole of
`neon-arcology`, `monastery-spire` and `glass-foxholes`. The brief's premise
that "ropeways run between the low pedestrian districts" is also not quite right:
every current line lands in `d1 copper-stacks` (190–520 m), because the band
selects mid-rise, not low-rise.

**Recommendation, for whoever owns `networks.ts`:** raise the band to roughly
[200, 600] so the tallest towers qualify. That is one pair of literals. It is
not a `districts.ts` change and it is not mine.

---

## 7. What I SAW in the frame

Four frames in `shots/traffic/`, all derived from live vehicle positions and all
printing the camera-to-vehicle distance before the shot (PROCESS.md rule 4).

### Trams are drawn, on the real alignment, at the right size

`tram-day`: at 15 m, a tan box roughly a quarter of frame height with a clean
horizontal roofline, standing on the carriageway of a 12.6 m alley with a kerb,
a footway and planters. It is correctly placed, correctly scaled and correctly
oriented — the transforms are right. **It reads as a shipping crate.** The
window band is `[0.06, 0.07, 0.09]` — effectively black — on a district-metal
tan body, and `Vehicle.color` is `pal.metal` blended toward `accentColor`, which
in `copper-stacks` is a dull tan. Neither is in my files: the mesh is
`entityMeshes.tramCar()` and the tint is the sim's existing choice.

`tram-night`: the same pose after I raised the instance emissive. A dark mass
with **two warm headlight points** on it, correctly placed on the front face.
The headlights read; the body does not.

### Cable cars are drawn, at altitude, and now glow

`cable-day`: a chain of separated boxes hanging along a diagonal line high in a
canyon, receding — the reference's aerial ropeway, at 219–433 m.

`cable-night`, before the emissive fix: three faint dark boxes. The ropeway is
the brightest object in the reference set and it was the dimmest thing in my
frame. `cableCar()` gives its window band `emissive: 0.9`, an order of magnitude
below the tram's 8.0 headlights and below the market's 5.5 lanterns.

`cable-night`, after: **a pale cream cable car with a dark roof line and a
visible hanger arm running up to its cable**, against a dark teal city. That is
the relationship `docs/STREET_SPEC.md` §A supports — warm light against cool
violet/blue — with the ropeway carrying it. The fix was the instance-level
`params.z`, which `gbuffer.wgsl` takes as `max(v.emissive, params.z * tint.a)`.

### What is still wrong with the frames

1. **The poses are mine and they are not good.** `tram-level` stands in an alley
   plaza and frames a building more than a tram. `cable-car` looks down a canyon
   of near-identical teal slabs with the ropeway at the frame edge. Both derive
   from live state and both verify, and neither is a photograph.
2. **The night city is nearly black**, so unlit vehicle bodies have nothing to
   read against. Same finding as round 3.
3. **Vehicle silhouettes are weak.** Both meshes are low-contrast boxes at
   distance. That is `citymesh.ts`.
5. **The frames predate nothing** — they come from a build made this session,
   and other agents have committed since.

---

## 8. Verification, verbatim

```
$ npx tsc --noEmit
(no output, exit 0)

$ npx vite-node src/sim/__selftest.ts
traffic draw  38 of 195 alive vehicles drawn as 38 instances
              blocks cablecar 27@0 · blimp 9@27 · balloon 2@36
              4910 triangles across 3 draws, pack copy measured in main
              by kind tram 0/36 · trolley 0/27 · cablecar 27/27 · funicular 0/18 · zipline 0/36 · blimp 9/18 · balloon 2/27 · cycle 0/6
              culled by distance 151, dropped for want of a mesh 6
              steepest written grade 75.5%, forward-column error 3.1e-8 (verified)
              cable cars 422-537m altitude vs trams 9m ceiling
...
ALL PASS

$ npx vite-node src/world/__selftest.ts
VIOLATIONS   none — all invariants hold

$ node tools/lsp-check.mjs
5/5 language server(s) verified

$ npx vite build
✓ built
```

Live, from the capture harness (`__syzygy.stats()`):

```
trafficDraw {"instances":64,"blocks":["tram:42@0","cablecar:18@42","blimp:3@60","balloon:1@63"],
             "alive":129,"packMs":0, ...}
entityTris 62360   tris 4367375   draws 156   resident 113   lights 1289
```

---

## 9. What I did not get to

1. **No vision-agent review.** PROCESS.md rule 9. The four frames were shot and
   judged by me.
2. **`traffic.lights` is a second unwired array.** `buildLights` runs every
   frame, keeps a scored 64-entry pool of headlight and underglow sources — and
   nothing consumes it. `Renderer.gatherLights` reads only `e.lights` from baked
   chunks. So the trams have headlights that light nothing. Same PHANTOM shape as
   `groundbake.ts`'s `void lights;`. It needs one line in `renderer.ts`, which is
   not mine.
3. **`renderer.entityDraws` reads empty, and now I know why** — see §10.1. It is
   not a drawing fault and not a telemetry fault on my side; it is that
   `renderer.render()` has two early exits that draw nothing, neither of which
   is counted the same way, while `tick()` increments `frameCount` after both.
   I added `issuedEntityDraws` in `main.ts`, recorded at the same point, so the
   automation surface no longer depends on that array alone.
4. **No per-mesh LOD**, only a distance cull. See §4.
5. **Zipline riders never appeared in any frame** — 24 alive, all culled beyond
   620 m in every pose I derived. The kind is wired and asserted but unverified
   visually.
6. **Funiculars** appeared in one draw list (12 drawn) but I never framed one.
7. **`crowd.ts`'s 4-float instance overrun** (it writes `d[b+24..27]`, one
   instance past its own 24 floats, which is silently dropped for the last
   instance and overwritten for the rest) is still there. Harmless, not mine this
   round.
8. **I did not touch `renderer.ts`, `citymesh.ts`, `*.wgsl`, `groundgrammar.ts`,
   `groundbake.ts`, `districts.ts` or `tools/capture.mjs`.** I did add to
   `diagnosticposes.ts` by appending only — `derivePose` and `SPECS` are
   untouched, because that path has a reviewer.

---

## 10. Contradictions, said plainly

1. **`INSTANCE_FLOATS` is declared twice and the copies are not interchangeable.**
   `gpuutil.ts:216` and `citymesh.ts:62`, both 24. The brief names
   `gpuutil.ts` as canonical — **it cannot be.** `gpuutil.ts` evaluates
   `GPUShaderStage` at module scope, which does not exist in node, so importing
   it into a sim module makes `src/sim/__selftest.ts` unrunnable. I found this
   by hitting it. `citymesh.ts`'s copy is the importable one and is what
   `crowd.ts` uses. One of the two should go.

2. **`RailLine.suspension`'s vocabulary does not describe its own data.** The
   field is `'ground' | 'catenary' | 'free'`, and `networks.ts:216` tags a
   **cable car** `'free'`. A cable car hangs from a span; it does not fly. The
   draw layer keys the hang off the vehicle kind for that reason and uses
   `suspension` only for the tram lines, where `'catenary'` really does mean a
   graded hump.

3. **`renderer.entityDraws` reads empty, and `frameCount` cannot be trusted to
   mean "a frame was drawn".** Measured, after chasing this for four capture runs
   because I reported it as unexplained:

   ```
   A: default pose      frame=1    entityDraws=6  framesSkipped=0
                        frame=7    entityDraws=6  framesSkipped=0
   B: after setPose     frame=15   entityDraws=6  framesSkipped=1
      (camera jumps     frame=21   entityDraws=0  framesSkipped=1
       ~1 km)           frame=25   entityDraws=0  framesSkipped=1
                        frame=30   entityDraws=6  framesSkipped=1
   C: after warm()      frame=54   entityDraws=0  framesSkipped=1
                        frame=114  entityDraws=0  framesSkipped=0
                        frame=174  entityDraws=0  framesSkipped=0
   ```

   Two things fall out. First, `main.ts` clears `entityDraws` at the top of
   `tick()` and it is refilled during `render()`, so the field is empty on any
   tick where `render()` returned before reaching `recordGBuffer` — which is
   precisely when it is most useful to know. Second, `renderer.render()` has
   **two** non-drawing early exits:

   ```ts
   if (!this.targets) return;                      // no counter
   ...
   if ((this.capturePending || overBudget) && ...) { this.skipped++; return; }   // counted
   ```

   and `tick()` does `this.frameCount++` after both. So `frameCount` advances
   on frames where nothing at all was submitted, and `framesSkipped` reports
   only the second of the two exits. In block C above, `framesSkipped` is 0 and
   `entityDraws` is empty — the two are contradictory unless something else
   bailed, and `!this.targets` does not increment anything. I could not fully
   separate the two exits from the outside; both are in `renderer.ts`.

   The vehicles are demonstrably in the frames, so this is a reporting hazard
   and not a rendering one. But it is the same shape as every fault this project
   has paid for: a counter that reads "zero" for two different reasons.

4. **`drawEntitySet` cannot draw two entity sets in one frame**, and its
   signature does not say so. It uploads at offset 0 and draws at instance 0 on
   every call, so it is correct for exactly one set per frame. The name and the
   signature both invite a second call.

5. **`stats.triangles` under-reports when entity draws bypass
   `drawEntitySet`.** `renderer.counter.entityTris` is private and is the only
   thing feeding it, so any draw issued outside that method is invisible to the
   frame's triangle total. I patch it in `main.ts` with a comment saying it is a
   patch; it should not need one.

6. **`HANDOFF.md` says traffic is "Not drawn".** That was true until this
   change and is now wrong. `COVERAGE.md` row 9 moves `partial` → `done` with
   the caveat that cycle is dropped.
