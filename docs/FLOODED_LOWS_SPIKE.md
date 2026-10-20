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
