# Ground round 3 — plan (the fall zone's floor, and the flooded lows)

**Written by the vision reviewer, 2026-10-21. Planning only: no code changed,
nothing captured, no writes to `src/`.** Round 2 is in `bb92f87`; the implementer
is benchmarking the tree, so this document is deliberately the only thing on
disk from this turn.

The zone's ground is the last unbuilt third of DESIGN §8's "The ground: a wreck
field with a working floor". This plan covers the three pieces — lifelines,
wreck dressing, flooded lows — with the exact edits for the flood, the cost
estimates, and the order.

**Read the zone's ground data first** (measured from `fallzone.ts`, seed
0x5e7a17): 151 columns, of which **88 carry a lifeline** — 27 `stair-tower`,
61 `winch`, 24 `core-stair` — and 39 are `access: 'none'`. **25 off-limits
patches: 11 `fenced`, 9 `overgrown`, 5 `flooded`**, and the flooded ones are
*large*: half-extents 24-72 m, mean area 7373 m² (about 86 m across). **69
wreck pieces: 66 slabs** (18-44 m long, 2.4 m thick) **and 3 spire bodies**
(138-208 m long, 25-28 m wide, 15-16 m thick). 9 ropeways with 4-6 stations
each, 61 bridges (36 rope, 24 catwalk, 1 truss), 1 deck fragment.

---

## 0. The finding that should change the round's shape

**The zone's ground is in none of the four review poses.** Pose 16 looks up at
65°; poses 17 and 19 stand on the deck fragment 150 m above it; pose 18's
ground is 150 m down and behind the old city. So the work this round plans —
the flooded lows, the salvage workshops, the paths, the lamps at the foot of a
pier — would be **photographed nowhere**.

Round 0's failure was that the fall zone had never been photographed at all.
The same failure is available again, one level down: a ground round with no
ground pose. **Round 3 should add a fifth pose, `20-fall-ground-level`**, and
it must be in the capture or the round cannot be judged. Derived in
`src/world/__probe_fallzone.ts` (my file): a street point in the belt at
GROUND_Y + 1.7 m, with a `flooded` patch 15-30 m ahead, at least one winch
house or stair-tower foot in frame, and the old city behind for the value
structure. It goes in `tools/capture.mjs` next to 16-19 and in
`references/sections.json`'s pose map (already `"fall-": "B"`, so no change
there).

**That pose is the reason the ground round can be judged, and it is also what
makes the flood legible at all** — the flooded lows are 86 m across and would
be a 4 % sliver in any of the existing four.

---

## 1. Lifelines — the zone's working floor

### What the placement already gives us

Nothing new needs placing. The data is in `FallColumn.access`
(`fallzone.ts:100`: `'core-stair' | 'stair-tower' | 'winch' | 'none'`) and in
`FallChunk.stations` (the ropeway ground huts, `fallzone.ts:795-796`):

| lifeline | where it comes from | count | what it needs |
|---|---|---|---|
| Stair tower foot | columns with `access === 'stair-tower'` | 27 | a scaffold tower at the pier's face, bolted up it |
| Winch house | columns with `access === 'winch'` | 61 | a hut where the hoist cable lands, a drum, the cable up to the outriggers |
| Core stair foot | columns with `access === 'core-stair'` | 24 | a threshold and a door at the core's foot; the lit slots climbing the shaft are the village's (round 3+ of the village) |
| Ropeway hut | `FallChunk.stations` | 9 | the station is already a 6 m steel box; it needs a hut, a queue rail and a lamp |
| Salvage workshop | **derived**: every third winch house | ~20 | a bigger hut with sorted heaps |
| Warm work lamp | one per stair tower, winch house and workshop | ~88-110 | 1 light each, D28 warm amber only |
| D30's B kit | barrels, pallets, cable drums | scattered | the geometry already exists (below) |
| Foot traffic paths | **emergent** | — | no geometry this round (below) |

**The salvage workshops are derived, not placed**: at every third winch house,
on the side away from the carriageway. If the owner wants a different number or
distribution, that is a placement change and it is not mine.

**The foot traffic paths need no geometry.** The crowd already walks the zone:
the columns and the 25 off-limits patches are registered as crowd obstacles
(`fallmesh.ts:95-106`) and `fallFoot` (FALL_FOOT 0.25) thins the crowd inside
the groups. A *visible* worn path would need a second ground class (index 7,
after `flood`) — **I recommend against adding one this round.** Two new classes
in one round is how the decode drifts, and the paths are the better read as
*evidence of use* (the crowd's own thin traffic) than as geometry.

### Where it goes

**New file `src/render/fallground.ts`**, one entry point:

```ts
export function pushFallGround(bld: MeshBuilder, fall: FallChunk, lod: number, obstacles: CrowdObstacle[], lights: ChunkLight[]): void
```

called from `pushFallChunk` in `src/render/fallmesh.ts` (so the zone stays in
one place and the lamps land in the same `lights` array the rest of the chunk
uses). It follows the `fallvillage.ts` precedent: deterministic, rolled from
`makeRng(c.seed ^ SALT)`, no `Math.random`.

### The D30 B kit: duplicate, do not export

`pushClutterItem` (`groundbake.ts:680`) already has `barrel`, `pallet`,
`spool` and `cable-spool` — but it is **module-private** and its signature is
street-shaped (`Placer`, `ClutterPalette`, `ClutterTally`). The zone has no
footway to place against and `clutterReach` (the "too deep for the walking
line" rule) does not apply to it.

**Recommendation: re-implement the four kinds in `fallground.ts`** (~120 lines)
rather than exporting a street function. The colours (`BARREL_PAINT`, `TIMBER`,
`PALE_TIMBER`) would need exporting or copying; copying four `const` colours is
cheaper than coupling the zone to a placement signature it cannot satisfy.
Cost per group: a barrel group 24-40 tris, a pallet group 12-36, a spool 60.

### The lights, and the budget that must not starve the market

This is the part that can go wrong quietly, so the numbers first.

- The renderer's binner cap is `MAX_LIGHTS = 3072` (`renderer.ts:57`). Round 2
  measured **1189-1383 delivered, 0 starved, 5700/5700 tile bins, 0 refused
  tiles** — so there is ~1700 of headroom at the renderer, and the 212 crown
  lights cost nothing there.
- The binding budget is **per chunk**: the ground bake adds at most **48**
  lights to a chunk (`groundbake.ts:301-303`), and the market may take at most
  half of what is left after everything else.
- **The zone's lamps are inside that subtraction.** `bakeChunk` pushes the
  fall zone at `citymesh.ts:1539`, *before* `bakeGroundDetail` at
  `citymesh.ts:1649`, and the market's room is
  `min(48, lightCap - (lights.length - stallLights), floor((lightCap - (lights.length - stallLights) + maxLights) * 0.5))`
  (`groundbake.ts:433-440`). So **every zone lamp reduces the market's share
  in that chunk** — PITFALLS §29's exact failure mode, with the wrong payer.
- Mitigation: **cap the zone at 4 lamps per chunk** and record the drops in
  the same style as `marketLightsDropped`, so the number is visible rather
  than inferred. The zone's chunks are belt chunks and the market spine is
  elsewhere, so the risk is low, but a cap is the cheap insurance. Do **not**
  raise the 48: that number was measured against the market (48 gave deck
  irradiance 1.197 where 24 gave exactly zero).

**Which of these need lights?** The warm work lamps only. The stair towers,
winch houses, workshops, drums, barrels and pallets are **albedo and emissive
only** — D30's festoon bulbs are the precedent (`groundbake.ts:613`: "amber
(D28), emissive only, no light budget"). A work lamp is a real light: radius
~9-11 m, intensity ~2.2, warm amber, one per tower/house/workshop.

### Cost estimate (to be confirmed by the probe)

| item | tris | per zone chunk (4-8 columns) |
|---|---|---|
| stair-tower foot (4 legs, 5 rungs, landing) | 120-200 | 1-3 towers → 150-600 |
| winch house (hut, roof, drum, cable) | 60-110 | 2-6 → 150-600 |
| salvage workshop (hut + sorted heaps) | 150-300 | 0-2 → 0-600 |
| B kit group (barrels/pallets/spools) | 24-60 each | 4-10 → 100-600 |
| **total** | | **400-2400 tris/chunk**, 1-4 lights/chunk |

Against the village's own cost (the round-1 probe: 2367 tris per zone chunk at
LOD 0, max 8408) this is the same order of magnitude and should be inside the
frame-rate floor (D32: 30 fps). **The probe must confirm it** — measure the
zone chunk's total solid triangles before and after, and the light counts with
0 starved.

---

## 2. Wreck dressing — ridges, rebar, and the spire bodies' facade grid

### What is drawn today

`fallmesh.ts:92-99`: **one plain `pushOrientedBox` per wreck piece** — a
tilted box, 12 triangles, colour `SLAB` (0.30, 0.31, 0.32). The obstacle
record is already correct. So the 66 slabs are smooth grey plates lying at
random tilts, and the 3 spire bodies are smooth grey boxes 138-208 m long.

### What is missing, and it is all dressing — no new placement

1. **Rubble ridges along the fall lines.** DESIGN: "rubble ridges along the
   lines where the deck came down". The 66 slabs are already placed along
   those lines; a *ridge* is the mound of broken concrete that broke off them.
   Dress each slab with 10-18 small boxes along its long axis, sized from the
   slab (0.4-2.5 m), rotated with the slab's yaw and tilt, so the plate reads
   as the top of a pile rather than a lid on the ground. **120-216 tris/piece.**
2. **Rebar fringes.** DESIGN: "fallen deck slabs (20-50 m tilted plates, broken
   edges, rebar fringes)". 6-10 thin cylinders (0.05-0.09 m) out of the slab's
   broken short ends, splayed. **60-100 tris/piece.**
3. **The spire bodies' facade grid.** DESIGN: "the spires' bodies as long wreck
   ridges with their facade grid showing". A body is a fallen tower: its
   floors and columns are the grid. Dress the body's flanks with 12-20 thin
   boxes (floor lines and columns) along its 138-208 m length, following the
   body's yaw. **200-300 tris/body, 3 bodies.**

### Cost

2-4 pieces per zone chunk → **400-1200 tris/chunk** for the ridges and rebar,
plus ~700 for the bodies in the three chunks that hold them. Cheaper than the
lifelines and less certain: the rubble ridge only reads at close range, and the
close-focus pose currently stands on a blank deck (round 2's finding), so
**the wreck dressing is not judgeable until pose 20 exists**.

---

## 3. The flooded lows — the exact edits

This is the item my adversarial check
(`docs/FLOODED_LOWS_SPIKE.md`, "Adversarial check (reviewer)") already
specified, with the failures it named closed. **The order of the edits matters
more than the content of them.**

### 3.1 `src/world/groundgrammar.ts` — two lines

| line | change |
|---|---|
| **715** | `export type GroundSurfaceClass = 'carriageway' \| 'paving' \| 'kerb-face' \| 'kerb-top' \| 'gutter' \| 'paint';` → add `\| 'flood'`. The array below is typed `readonly GroundSurfaceClass[]`, so the compiler refuses the new class until the union moves — that is the compiler doing its job, and it is why this is two lines and not one. |
| **716** | `GROUND_SURFACE_CLASSES` → **append** `'flood'` at the end. Index 6. `indexOf` on the existing names does not move, so classes 0-5 keep their exact tags. |
| 717-719 | `groundSurfaceTag` — **unchanged**. The `+1`/`-1` cancels, `BAND_ORDER` has 10 families so `family + height < 16` and the class field cannot overflow. |
| 720-723 | `decodeGroundSurfaceTag` — **unchanged**. |

### 3.2 `src/shaders/gbuffer.wgsl` — a branch, a ripple, and two exclusions

| line | change |
|---|---|
| 445-448 | the decode — **unchanged**. `max(0.0, -tag - 1.0)`, `u32(floor(payload / 16.0))`, `u32(floor(payload)) % 16u`. |
| 454-458 | add `let isFlood = surface == 6u;` beside the other class literals. |
| 500-501 | the shared grain `alb *= 0.90 + 0.20 * grain;` must **not** apply to the flood class — a mirror has no grain. Gate it on `!isFlood`. |
| **581-583** | **insert `} else if (isFlood) { ... }` BEFORE the final `else {`** — the carriageway catch-all at 583-621. **A branch appended after that `else` is unreachable, and a class in the table with no branch falls into the carriageway: worn asphalt, wheel tracks on a 6 m lattice, tar seams every 24 m, and the `pool` term mixing roughness to 0.12.** A flooded quad would then read as a wet patch of *street*. The flood branch is the last `else if` in the chain. |
| the flood branch | roughness 0.06-0.10, metallic 0, albedo = the quad's own colour (the `PATCH.flooded` dark) times a low-frequency mud/silt noise, **no paving joints, no grain**; the silt noise is the only variation, and it is world-space (the tag is per-primitive, so it cannot carry a gradient). |
| **643** | `var n = normalize(i.normal);` — **the ripple goes here**, before the G-buffer normal write at **742** (`o.normalMetal = vec4f(n, metal)`), so the lighting pass reads the rippled normal. Two octaves of world-space noise, a few centimetres of amplitude, applied only when `isFlood`. Perturbing the colour would not move a single specular; the ripple has to be in the normal. |
| 726-732 | the weather wetness pass — **exclude the flood class** (`i.matId != MAT_FOLIAGE` becomes `&& !isFlood`). It drops roughness to 0.055 and darkens by 42 %; a surface that is already wet gets darkened and polished twice, and the weather term is weather, not geography — it cannot make a specific place wet, which is the whole reason this class exists. |
| 741-742 | the G-buffer writes — unchanged. |

### 3.3 `src/render/fallmesh.ts` — the trap, and the geometry

| line | change |
|---|---|
| **24-34** | `pushOrientedBox` gains an `opts: MeshOpts` parameter **and forwards it to all six `bld.pushQuad` calls**. It currently calls `bld.pushQuad(c001, c101, c111, c011, color)` with neither `uvScale` nor `opts`. **If the parameter is added and not forwarded, the tag never reaches the vertex buffer, the quad renders exactly as it does today, and nothing errors, warns or fails.** That is the one thing this implementation must not get wrong. |
| **100-103** | the patch loop. The tag goes on the **top face only** — all six faces of the box share the opts, and a tagged side face would be a vertical mirror: a bright 4 cm line of sky around every puddle, at exactly the grazing angle where it is most visible. |
| 100-103 | the **flooded** patches get new geometry (below); the `fenced` and `overgrown` patches keep their flat colour and no tag. |
| 100-103 | `lod < 2` stays: the patch quads are near-field detail. |

### 3.4 The geometry: the class goes on *parts* of the patch, not on the patch

**A flooded patch is 86 m across on average (half-extents 24-72 m, mean area
7373 m²).** One quad that size, tagged `flood`, is exactly the "flat mirror
sheet" the spike's own risk note describes: a hard-edged rectangle of horizon
sky. And the tag is per-primitive, so it cannot carry a soft edge.

So the flood class is applied to **several small water quads inside the
patch** — the lows, the ruts, the runnels between the wreckage — and the patch
as a whole is **wet silt**:

1. A **silt quad** under the whole patch: matte (roughness 0.55-0.7), the
   patch's own dark colour, **no tag** (it is ordinary ground, and it must not
   become a chunk deck).
2. **3-6 water quads** inside it, each 4-12 m across, jittered from the
   patch's own seed, at GROUND_Y + 0.03 to +0.05, **carrying the `flood`
   tag**. Their corners are jittered, so the waterline is ragged rather than a
   rectangle. The *read* is the value contrast — dark wet silt against dry
   asphalt — with the water reading as the sky's glint, not as a mirror.
3. The soft rim is therefore **geometry**, not a tag: the silt quad is larger
   than the water quads and irregular, so the edge between wet and dry is
   broken. (The tag's `height` field is free and already encoded, but it is
   per-primitive and cannot vary across a quad, so it cannot draw a margin.)

**Cost: 4 triangles per quad, 4-7 quads per flooded patch, 5 flooded patches
in the zone — about 100 triangles citywide.** Zero new draws, zero new
vertices, zero frame-uniform change: the tag rides the vertex emissive slot
that already exists.

**And the honest limit** (from my adversarial check, and it still stands): with
no SSR and no probe in `src/shaders/`, the water reflects the *sky* alone. At
1.7 m and 30 m the grazing angle is 3.2°, so the reflection is ~76 % of the
horizon sky and **none of the world around it**. That is why the read has to
come from the silt contrast and a small rippled glint, and not from a mirror
pool. Sheet B frame 3 agrees: its water is *wet ground and small reflective
patches* in a blue canyon, not a pool.

### 3.5 The parity test — what it asserts

The gap my check found: **the CPU decoder and the GPU decoder can drift
apart, and nothing tests it.** The class number is written in three places
(`groundgrammar.ts:716`, the CPU decode at 722, the shader's literals at
455-458) and only two of them are tested.

`src/render/__selftest_ground_contract.ts` already has the CPU half — the
class × family round-trip at **73-79** — and it covers `'flood'` automatically
once the class is in the list. It also asserts at **88** that every actual
tagged triangle in a baked chunk decodes to a *valid* class and family, and at
**86** that a primitive's three vertices carry the same tag.

**The new assertion is a source-level parity guard** in the same file (or in
`src/render/__perftest.ts`, which already reads a source file and regex-checks
an expression — the `w.dayPhase = saturate(...)` check is the precedent):

1. **The decode is the same function on both sides.** Assert that
   `src/shaders/gbuffer.wgsl` contains `max(0.0, -tag - 1.0)`,
   `u32(floor(payload / 16.0))` and `u32(floor(payload)) % 16u` — the exact
   three expressions `decodeGroundSurfaceTag` does — and that the CPU decode
   does `-tag - 1`, `Math.floor(payload / 16)` and `Math.floor(payload) % 16`.
   If either side is re-expressed, the guard fails until the other matches.
2. **Every class in the table has a branch in the shader.** For each index
   `i` in `GROUND_SURFACE_CLASSES`, assert the WGSL contains `surface == {i}u`.
   Today all six pass (0 at 533, 1 and 3 at 457, 2 at 455, 4 at 458, 5 at
   456); `'flood'` passes only if the branch was inserted **before** the final
   `else` — which is precisely the failure the adversarial check found, and
   precisely the one that would otherwise ship silently.
3. **The class list in the shader's comment** (`gbuffer.wgsl:454`, "the
   authored surface class") matches the array, so the two do not drift
   silently.

---

## 4. Order, budget, and the one change the next capture should judge

### Recommended order

1. **The flood class** (§3). Cheapest and most specified: 3 source edits, one
   shader branch, ~100 triangles citywide, zero new draws, and it comes with
   the parity guard that protects **every** class added after it. Do it first
   because it is the item with a named, verified trap in it, and because the
   guard is the thing that stops the next class from repeating the mistake.
2. **Lifelines and the work lamps** (§1). The only item in this round that
   puts **warm points on the ground**, which is the gap the last two reviews
   measured (78-92 % warm pixels in the dusk frames, and not one warm point on
   the village). It needs the light-budget cap, which is the thing most likely
   to go wrong and to starve the market.
3. **Wreck dressing** (§2). The most triangles, the least certain, and it
   barely reads at any distance the poses can see.

### Budget (my estimate; the probe must confirm it)

| | tris | lights | notes |
|---|---|---|---|
| flood class | ~100 (citywide) | 0 | no new draws, no new vertices |
| lifelines + kit | 400-2400 per zone chunk | 1-4 per chunk, capped | + the 48-light rule |
| wreck dressing | 400-1200 per zone chunk (+700 for the 3 bodies) | 0 | near-field only |

### The one change the next capture should judge

**The work lamps.** If only one change can be in the frame, make it the
lifelines' warm work lamps, because:

- they are visible in **every** pose — a warm point at the foot of a pier in
  16 and 18, a lit hut in 17 and 19 — so one capture judges them four times;
- they change the **value structure** (a dark near field with warm points in
  it, which is sheet B's read) rather than adding another object to a frame
  that already has enough objects;
- and they carry the **light-budget rule**, which is the part most likely to
  starve the market. The capture is the control that the rule is safe, and
  the only way to see that is the frame.

**But the capture must also contain pose 20**, or the flood — the round's
named item — is photographed nowhere, and round 3 repeats round 0's failure
one level down.

---

## 5. What I will not do

- **The columns.** The break's material — rebar, spall, the stain running
  down from the break line — is the implementer's round 3. My round-2 finding
  ("a notch, not broken concrete") is their brief, not my work.
- **The village grammar.** `fallvillage.ts` is theirs.
- **Placement.** `fallzone.ts` is closed. Every item in §1 and §2 is
  *derived* from placement that already exists (the `access` kinds, the wreck
  pieces, the patch kinds, the ropeway stations); the salvage workshops are
  derived from the access data, not placed. If a new footprint is needed, that
  is a placement change and it goes to the owner.
- **`src/render` in this turn.** This document is the only thing on disk.
