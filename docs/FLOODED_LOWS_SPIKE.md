# Flooded lows: how the water gets into the ground shader

**Spike, 2026-10-20. Round 0 of the fall-zone village pass. No code changed by this
document.**

DESIGN §8, "The ground: a wreck field with a working floor", asks for flooded lows
where the fall broke the drains, and says: *"No water surface renders today
(`bakeGround` builds a water mesh the renderer drops), so push the ground shader's
standing-water term (`gbuffer.wgsl`) to full cover there."* This note answers how,
and what it costs, before anyone writes it.

## What is actually there

Measured by reading and grepping, not assumed:

- **The patch quads exist.** `src/render/fallmesh.ts:118-121` draws each
  `FallChunk.patches` entry as one flat quad at `GROUND_Y + 0.03`, half-height
  0.02, coloured `PATCH[p.kind]` (`flooded = [0.06, 0.08, 0.1]`). They are part of
  the chunk mesh, with no tag of their own.
- **The standing-water term exists but only for the carriageway.**
  `src/shaders/gbuffer.wgsl:617-621` computes `pool = smoothstep(0.40, 0.78,
  resurf)` from resurfacing noise and drops roughness to 0.12 under it. It sits
  inside the `surface == 0` (carriageway) branch, so a patch quad never reaches it.
- **The wetness pass is weather, not geography.** `gbuffer.wgsl:724-732` darkens
  and tightens by `F.weather2.x` everywhere. It cannot make a specific place wet.
- **`MAT_WATER` is defined and unused.** `gbuffer.wgsl:91` and `:715-717` give
  matId 4 roughness 0.04; `src/render/citymesh.ts:40` defines `MATS.WATER = 4`;
  **nothing in `src/` ever sets it.** That is a second phantom beside the
  canal-water mesh in `COVERAGE.md:131`, and it is not the mechanism to reach for:
  matId is a per-mesh `params` value, so using it needs a separate mesh and draw
  per patch — exactly the shape of the water mesh the renderer drops.
- **Reflections are analytic and roughness-driven.** `lighting.wgsl:86-117`
  samples the procedural sky with a lobe widened by roughness, so a low-roughness
  surface *does* pick up a sky reflection. Water will read as water without a
  reflection pass.

## The three ways to do it

| | Mechanism | Cost | Verdict |
|---|---|---|---|
| A | Extend the existing ground-surface tag with a `flood` class | 0 draws, 0 vertices, one shader branch, **no vertex-layout change** | **recommended** |
| B | Give flooded patches `MAT_WATER` on their own mesh and draw | one extra mesh + draw per chunk, upload path in `renderer.ts` | rejected: new plumbing, and it repeats the phantom's design |
| C | Upload an array of patch rects to the frame uniform | frame-uniform ABI change, fixed max count | rejected: ABI risk for a cosmetic term |

## A, in full

The tag is already a per-primitive signed payload in the emissive slot:
`groundSurfaceTag(surface, family, height) = -(1 + class*16 + family + height)`
(`src/world/groundgrammar.ts:717`), decoded in `gbuffer.wgsl:445-448`. Classes
0-5 are in use (`carriageway, paving, kerb-face, kerb-top, gutter, paint`); the
index space goes to 15.

1. `groundgrammar.ts:716` — append `'flood'` to `GROUND_SURFACE_CLASSES`.
   Append only: indices 0-5 keep their meaning, so every existing tag still
   decodes the same. The WGSL comment at `gbuffer.wgsl:454` names this list as the
   contract and must be updated in the same change.
2. `gbuffer.wgsl` — in `groundSurface`, `let isFlood = surface == 6u;`. In the
   flood branch: roughness 0.06-0.10, metallic 0, albedo the quad's own dark
   colour times a low-frequency mud/silt noise, and no paving joints or grain —
   the surface is water, not a wet pavement.
3. `fallmesh.ts` — `pushOrientedBox` gains an `opts: MeshOpts` parameter (the
   existing call sites pass nothing) so the flooded patch quad can carry
   `surfaceTag: groundSurfaceTag('flood', 'asphalt')`. The other patch kinds keep
   their flat colour.

Nothing else moves: the quad already exists, already sits at ground level, and is
already an obstacle for the crowd.

## Risks, named before the frame

- **A flat mirror sheet.** At 1.7 m looking 30 m across, the grazing angle is
  strong and roughness 0.06 will reflect the sky as a hard sheet — a plastic
  sheet, not a pool. A slight normal ripple (two-octave noise, amplitude a few
  centimetres) before the lighting is the fix; judge it in the frame, not here.
- **A hard rectangle.** The patch is a quad; water with a straight edge reads as
  a decal. The noise mask needs a soft margin where it meets the pavement, or the
  ground shader needs the patch's own height in the tag (the `height` field is
  free and already in the encoding).
- **`@interpolate(flat)`.** The tag is per-primitive by design; all variation has
  to come from world-space noise, not from the tag.
- **Z-fighting** at distance against the 0.02 m offset — the existing patch height
  already dodges it, so this is only a reason not to lower it.

## What this is not

This is not the canal-water item in `COVERAGE.md:131`, and fixing it does not
close that row: the canal still needs a water surface the renderer draws. The
flooded lows are a ground-shader surface class on geometry that already exists.
Record the distinction there when this lands, so the next session does not read one
as the other.

---

## Adversarial check (reviewer)

**Round 1, 2026-10-20. Read-only: no code changed, nothing captured.** The
spike's mechanism was tested against the code rather than against its prose.
**The mechanism survives; the look does not follow from it.**

### Claim 1 — a sixth class is append-only, and nothing decodes the list by position: **survives, with three additions**

The encoder and the decoder are symmetric and position-based only in the
*array*:

```ts
// groundgrammar.ts:717-723
return -(1 + GROUND_SURFACE_CLASSES.indexOf(surface) * 16 + BAND_ORDER.indexOf(family) + clamp(height, 0, 0.99));
const payload = -tag - 1;
return { surface: GROUND_SURFACE_CLASSES[Math.floor(payload / 16)], family: BAND_ORDER[Math.floor(payload) % 16], ... };
```

Appending `'flood'` leaves classes 0-5 bit-identical, because `indexOf` on the
existing names does not move. The `+1` in the tag and the `-1` in the decode
cancel exactly. The class field cannot overflow: `BAND_ORDER` has **10**
entries (`groundgrammar.ts:706-709`), so `family + height < 11 < 16` and
`floor(payload / 16)` is the class and nothing else. The shader decodes the
same way (`gbuffer.wgsl:445-448`) and compares against the literals 0-5 only
(`:455-458`); there is no class-count check anywhere in the shaders (`grep 6u`
finds only matId and family constants). `decodeGroundSurfaceTag` is the only
decoder of the class list in `src/` or `tools/`.

**Addition 1 — the union type must move with the array.**
`GroundSurfaceClass` (`groundgrammar.ts:715`) is a literal union and
`GROUND_SURFACE_CLASSES` is typed `readonly GroundSurfaceClass[]`, so the
compiler will refuse `'flood'` until the type is extended too. That is the
compiler doing the right thing, but it means the change is two lines, not one.

**Addition 2 — the branch must be inserted *before* the final `else`, and this
is the trap.** The dispatch is a chain, not a switch:

```
if (vertical) {...}                                  // surface == 2
else if (isPaintY && isPaint) {...}                   // surface == 5
else if (isGutter) {...}                             // surface == 4
else if (isRaised || (surface == 0u && fam != 0u && fam != 1u && fam != 2u)) {...}
else { /* carriageway */ }                            // gbuffer.wgsl:583-621
```

A new `else if (surface == 6u)` written *after* that final `else` is
**unreachable**. A new class that is added to the table but not to the chain
falls into the carriageway catch-all: worn asphalt with resurfacing patches, a
polished wheel-track pair on a 6 m world lattice, tar seams every 24 m, and
the `pool` term that mixes roughness to 0.12 over roughly a third of the area
(`gbuffer.wgsl:601-621`). A flooded quad would then read as a *wet patch of
street* — which is the decal failure the shader's own comment warns about.

**Addition 3 — a third consumer of the sign convention, not in the spike.**
`walkingTriangles` (`src/world/walkingsurfaces.ts:13-20`) reads the same
vertex alpha, decodes it, and keeps only `'paving'` and `'kerb-top'`. A
`'flood'` class is therefore automatically excluded from the crowd's walking
surfaces, which is what we want (the off-limits patches are already crowd
obstacles). It also means the CPU decoder and the GPU decoder can drift apart
with nothing to catch it: `__selftest_ground_contract.ts:73-79` round-trips
every class × family through `fround`, so a class in the table is checked, but
**no test asserts that the shader's `u32(floor(payload / 16))` agrees with
`Math.floor(payload / 16)`**. The shader's own comment at `gbuffer.wgsl:454`
calls that list the contract, so the class number is now written in three
places and only two of them are tested.

### Claim 2 — the tag rides the existing vertex emissive slot, so no layout and no uniform change: **survives, with one trap that fails silently**

`VERTEX_FLOATS = 12` — pos(3) nrm(3) uv(2) col(3) em(1) (`geometry.ts:28-29`) —
and the emissive is the twelfth float, byte offset 44. `MeshBuilder.vert`
writes `this.col.push(r, g, b, e)` (`:143-147`) and `pushQuad` sets
`e = opts.surfaceTag ?? opts.emissive ?? 0` (`:158-159`). The shader splits
the one slot cleanly:

```wgsl
// gbuffer.wgsl:76-77
o.emis = max(max(v.emissive, 0.0), v.params.z * v.tint.a);
o.groundTag = min(v.emissive, 0.0);
```

with `@location(9) @interpolate(flat) groundTag` already declared. **So: no
new attribute, no stride change, no frame-uniform change.** True.

The routing works for the fall zone specifically because `pushFallChunk(solid, ...)`
(`citymesh.ts:1539`) puts the patches in the chunk's solid builder, whose
identity instance is `params.x = MAT.DIFFUSE` (`groundgrammar.ts:50`), and
`isChunkDeck = i.matId == MAT_DIFFUSE && i.groundTag < 0.0`
(`gbuffer.wgsl:661`) is the only thing that admits a tagged primitive into
`groundSurface()`.

**The trap: `pushOrientedBox` must forward the options to `pushQuad`.**
It currently calls `bld.pushQuad(c001, c101, c111, c011, color)` — no
`uvScale`, no `opts` (`fallmesh.ts:24-34`). The spike's step 3 says
`pushOrientedBox` "gains an `opts: MeshOpts` parameter"; **if the parameter is
added and not forwarded to `pushQuad`, the tag never reaches the vertex
buffer, the quad renders exactly as it does today, and nothing errors,
warns, or fails.** This is the single thing the implementation must not get
wrong.

Two smaller consequences, both worth writing into the change:

- `pushOrientedBox` pushes **all six faces** of its box, so a tag on the patch
  also lands on the 4 cm *side* faces, whose normals are horizontal. Those
  would be shaded by the flood branch as a vertical mirror — a bright 4 cm
  line of sky around every puddle, at exactly the grazing angle where it is
  most visible. The tag belongs on the top face only.
- A tagged primitive has its material **replaced** by the ground path
  (`base = g.albedo; rough = g.roughness; metal = g.metallic; emis = g.emissive;`
  at `gbuffer.wgsl:668`), so the flood branch must derive its albedo from the
  quad's own colour, and the quad loses its per-primitive emissive. Fine here,
  but it is not a decoration layered on top of the existing material.

**Refuted on the way, in my own reasoning: the winding.** I expected the top
face to be wound inward (the corner order reads that way by hand) and the
water plane to be culled from above. Measured instead, on a real
`MeshBuilder` box: the top face's geometric normal is **+y and outward**, and
all six faces are outward. `pushOrientedBox` and `pushBox` emit the top face
the same way, so the plane will be visible from above. The `away()` guard in
`pushQuad` (`:184-195`) also rewinds the index order to agree with an
*authored* normal, so passing `normals: UP4` — as `groundbake.ts` does for
every street band — is the cheap way to be certain.

### Claim 3 — `MAT_WATER` is defined and used by nothing, and matId is per-mesh: **survives, with the name corrected and the reason strengthened**

- The constant is `MAT.WATER = 4` at `src/render/citymesh.ts:40` — the spike
  calls it `MATS.WATER`; the export is `MAT`. It is the **only** occurrence of
  `WATER` in `src/` or `tools/` outside the shaders.
- The shader is the consumer: `MAT_WATER` at `gbuffer.wgsl:91, 715-717`
  (roughness 0.04) and `lighting.wgsl:19`. **Nothing sets matId 4** — no
  `MAT.WATER` use, no numeric literal 4 in a matId position, in `src/` or
  `tools/`.
- The spike's *reason* is slightly wrong and its conclusion is right. matId is
  not per-mesh; it is **per-instance** — `params.x` in the 24-float instance
  buffer (`citymesh.ts:62-96`) — and a chunk's geometry is drawn with **one**
  instance carrying **one** matId. So a chunk cannot contain both MAT_DIFFUSE
  street geometry and MAT_WATER patches: giving the patches matId 4 needs a
  second instance *and* a second draw of a second mesh, with the rest of the
  chunk split out. That is a stronger argument against option B than the spike
  makes, and it confirms the phantom status recorded in `COVERAGE.md`.

### Does a flat quad read as water at 1.7 m and 30 m? **No — and the reason is not roughness**

The only reflection in the renderer is analytic. There is **no screen-space
reflection anywhere in `src/shaders/`** (grep for SSR / scene-colour sampling
finds nothing), and no reflection probe. The specular term is

```wgsl
// lighting.wgsl:286-288
let f0 = mix(vec3f(0.04), albedo, metal);   // 0.04 for a dielectric
let R = reflect(-V, N);
let spec = skyRadianceSpec(R, rough) * envBRDF(f0, rough, max(dot(N, V), 0.0));
```

At 1.7 m eye height and 30 m out, the view is 3.2° above the surface, so
`N·V = 0.056` and Schlick gives F ≈ 0.76, while the mirror direction `R` is
3.2° above the horizon. The puddle therefore shows **~76 % of the sky
radiance just above the horizon** — a bright, flat, sky-coloured sheet. The
GGX sun highlight does not rescue it: with the sun at 62° elevation and a 3.2°
mirror direction, the sun is nowhere in the reflection lobe, so there is no
glint.

**What is missing is the thing that makes water read at a grazing angle: the
reflection of the scene.** A pool in a wreck field is mostly a picture of the
pilings, the broken deck slabs and the standing columns around it — at a
grazing angle that content *is* the read. With an analytic sky and no SSR, the
puddle reflects the sky alone: a uniform bright rectangle with a hard edge.
The spike's own risk note ("a plastic sheet, not a pool") is right, and its
mitigation (a normal ripple) breaks up the *sky* but still cannot put the
world in it. At a steeper angle — from the deck at 150 m, looking down — the
same quad inverts its failure: F drops to ≈ 0.19, the near-black albedo takes
over, and it reads as a **dark hole**.

**What I would do instead of a mirror pool.** Aim for *wet silt with standing
water*, not for a mirror:

1. **Matte mud as the base.** Roughness 0.55-0.7 and the quad's own dark
   colour for most of the patch. The read comes from the **value contrast**
   against the dry asphalt around it, which is robust at every angle and costs
   nothing.
2. **Standing water only in the ruts**, at low roughness, with a **normal
   ripple** (two octaves, a few centimetres) so the sky sample varies across
   the surface. The sparkle of a rippled puddle catching the last of the dusk
   sky is the cue; a flat sheet is not.
3. **A soft, noisy edge.** The patch is an axis-aligned rectangle on the zone's
   grid; a straight waterline is the decal giveaway. The `height` field of the
   tag is free and already in the encoding, and the class index space goes to
   15, so a silt margin can be carried in the tag rather than baked in.
4. **Do not rely on the reflection to do the work.** With no SSR, the only
   reliable water cue here is the sun's glint and the value contrast.

The reference agrees: sheet B frame 3 (`03-snow-ropeway.jpg`) shows water as
**wet ground and small reflective patches** held in a cold blue canyon, with
the reflections carrying the sky and the lamps, not a mirror pool. That is
also the honest target for the fall zone, whose flooded lows are ruts between
wreckage at 150 m up.

### What the implementation must not get wrong

**Forward the options.** `pushOrientedBox` must pass `opts` through to
`bld.pushQuad`, and the tag must go on the **top face only**. If the options
are not forwarded, the quad renders exactly as it does today — no error, no
warning, no failed check — and the whole pass looks like it did nothing.
