# Silt class gate — can the fall zone's ground take a first-class surface class?

**Gate document. Docs only. No code, no captures, no edits to `src/` or to
`VISION_FALL_BASELINE.md`. Written by a gate agent that did not implement any
round and does not judge frames.**

The owner has chosen that the fall zone's ground gets a first-class surface
class (`silt` / `wreck`) rather than reusing an existing one (`paving`,
`flood`, ...). The reason is in the frames: the yard's dominant surface is
`citygen`'s intact printed paving — running-bond slabs with joints — running
right up to the rubble, and it is the strongest "intact city" tell in the zone.
It covers the whole floor, so it outweighs the rubble dressing that rounds 3b
and 3o put on top of it.

This gate answers, in advance and with measurements or file-and-line citations,
whether that class can be added without breaking the contract selftest, the pool
gate, or the district's street structure. A gate that refutes the option is a
successful gate.

## 1. The ABI, exhaustively

Every place that knows a ground surface class **by number** (or by name that
resolves to a number), and whether appending a new class at the **end** of
`GROUND_SURFACE_CLASSES` keeps every existing index stable.

### The codec (the only place indices are defined)

- `src/world/groundgrammar.ts:715` — `export type GroundSurfaceClass = 'carriageway' | 'paving' | 'kerb-face' | 'kerb-top' | 'gutter' | 'paint' | 'flood'`.
- `src/world/groundgrammar.ts:716` — `export const GROUND_SURFACE_CLASSES: readonly GroundSurfaceClass[] = ['carriageway', 'paving', 'kerb-face', 'kerb-top', 'gutter', 'paint', 'flood'];`
- `src/world/groundgrammar.ts:717-719` — `groundSurfaceTag(surface, family, height)` = `-(1 + GROUND_SURFACE_CLASSES.indexOf(surface) * 16 + BAND_ORDER.indexOf(family) + clamp(height, 0, 0.99))`. The index is `indexOf`, not a literal. **Appending `'silt'` at the end leaves indices 0-6 bit-identical.** (PITFALLS: append-only, never renumber — the same rule `CLUTTER_KINDS` already follows, `groundgrammar.ts:74-75`.)
- `src/world/groundgrammar.ts:720-723` — `decodeGroundSurfaceTag` reads `GROUND_SURFACE_CLASSES[Math.floor(payload / 16)]`. Moves with the array.
- `src/world/walkingsurfaces.ts:13-20` — reads the vertex alpha, decodes it, keeps only `'paving'` and `'kerb-top'`. A new class is **automatically excluded** from the crowd's walking surfaces. That is what we want for silt (the off-limits patches are already crowd obstacles), but it is a third consumer of the sign convention that the selftest does not yet assert (see §6).
- `src/shaders/gbuffer.wgsl:445-448` — `surface = u32(floor(payload / 16.0))`; `fam = u32(floor(payload)) % 16u;`. Pure arithmetic, no literals. Moves with the TS array.
- `src/shaders/gbuffer.wgsl:455-459` — the dispatch chain: `vertical = surface == 2u`, `isPaintY = surface == 5u`, `isRaised = surface == 1u || surface == 3u`, `isGutter = surface == 4u`, `isFlood = surface == 6u`. **These are literals.** A new class needs a new `let isSilt = surface == 7u;` and a branch, or it falls into the carriageway catch-all (`else { ... }` at `:583-621`), which is worn asphalt with resurfacing patches, tar seams and the pool term — a flooded quad would read as a wet patch of street. The selftest's reachability check (`__selftest_ground_contract.ts`, the `finalElse` / `branch < finalElse` assertions) is what catches a branch placed after the final `else`.
- `src/shaders/gbuffer.wgsl:661` — `isChunkDeck = i.matId == MAT_DIFFUSE && i.groundTag < 0.0` admits any tagged primitive into `groundSurface()`. A silt-tagged primitive rides this path automatically. No change needed.
- `src/shaders/gbuffer.wgsl:668` — `base = g.albedo; rough = g.roughness; metal = g.metallic; emis = g.emissive;` — a tagged primitive's material is **replaced** by the ground path. The silt branch must derive its albedo from the quad's own colour (or set its own), and the quad loses per-primitive emissive. This is the same trap the flood class already navigates.
- `src/shaders/lighting.wgsl:19` — `MAT_WATER` is defined and unused; nothing sets matId 4. Not relevant to silt unless silt wants matId 4, which it should not (per-instance, needs a second draw — see `FLOODED_LOWS_SPIKE.md` claim 3).
- `src/render/__selftest_ground_contract.ts` — `GROUND_SURFACE_CLASSES.indexOf('flood') === 6` (hard-coded 6), the round-trip loop `for (const surface of GROUND_SURFACE_CLASSES)`, the regex `/i\.groundTag\s*<\s*0\.0\s*&&\s*u32\(floor\(floodPayload \/ 16\.0\)\)\s*==\s*6u/`, and the reachability assertions. All must move with the new class.

### Verdict on the ABI

**Appending keeps every existing index stable.** No site in `src/` encodes the class *count* rather than an index; every reference is `indexOf` (TS) or a `surface == Nu` literal (WGSL) or the arithmetic `floor(payload/16)`. The one thing that breaks **silently** if an implementer only edits the TS array is the WGSL dispatch chain: a new class with no `surface == 7u` test falls into the carriageway catch-all and renders as worn asphalt with resurfacing patches and the pool term — a flooded quad reading as a wet patch of street, which is the decal failure the shader's own comment warns about. The selftest's reachability block (`finalElse` / `branch < finalElse`) is the guard; it passes today for 7 classes and must be kept passing for 8.

## 2. What would produce the quads

The zone does not own its floor. `citygen` bakes the deck; `fallmesh.ts` only adds localised patch quads at `GROUND_Y + 0.03`. Two producers are honest; a third (a zone-wide tagged mesh) is not.

### Option A — zone-wide ground mesh tagged `silt`, emitted by `pushFallGround`

- Cost: the ground pass is currently 68,128 tris citywide, mean 2,523 per chunk (`__probe_fallground.ts`, measured this session). A cover-all across the fall zone's 27 chunks would add roughly 27 × 2,500 ≈ 67,500 tris to the zone alone — doubling the ground pass and adding ~33 % to the chunk's g-buffer load. That is a real number, not a rounding error.
- What it covers and destroys: **kerbs, gutters, paint, the existing `fenced`/`flooded`/`overgrown` patches, the flood water sheets, the crowd's walk surface, and the obstacles.** `bakeGroundDetail` emits all of those as primitives in the chunk's solid builder with their own tags; a cover-all quad at `GROUND_Y` with a silt tag sits **under** or **over** them and either hides them (if drawn last) or is hidden by them (if drawn first), and either way the street's structure — carriageway, footway, kerb, gutter, paint — is flattened into one surface. The flood water sheets (the `flood` class, the pool's own surface) would be buried. The crowd's walk surface (`walkingsurfaces.ts` keeps only `paving` and `kerb-top`) would silently lose its walkable set. **A cover-all that flattens the district's street structure is a cost, not a simplification.** It is the wrong producer.

### Option B — re-tag `citygen`'s deck quads inside the zone's footprint at bake time (recommended)

- Cost: **zero new triangles.** The deck already exists; only the tag on its quads changes from `paving`/`board-formed` to `silt` inside the fall zone's footprint. The ground pass stays at 68,128 tris citywide. The change is a bake-time predicate, not geometry.
- What it preserves: every kerb, gutter, paint line, patch, water sheet, walk surface and obstacle — they keep their own tags and their own classes. Only the flat deck surface under the fall zone changes class. The street structure survives.
- What it needs: `bakeChunk` (or `pushFallChunk`) must know whether a chunk is inside the fall zone's footprint, and `citygen`'s deck bake must accept a surface-class override for those chunks. The zone's footprint is `fallZone(seed)`'s column set; the chunk grid is 256 m. A chunk is "in the zone" if it contains any fall column. That predicate is a `Set` of chunk keys built once per seed, looked up per chunk. Cost of the lookup is negligible.
- Risk: the deck quads are the printed paving. Re-tagging changes their **material read** (no more running-bond joints? No — the joint family is decoded from colour band, and the silt class's shader branch decides whether to draw joints). The implementer controls that in the branch. The risk is that silt reads as "grey fill" instead of "dead ground" — that is §4's question, not a structural one.

### Verdict on the producer

**Option B (re-tag `citygen`'s deck quads inside the zone footprint).** Option A is a cover-all that destroys the street structure the ground grammar exists to produce, for ~67,500 tris of new geometry, and it buries the flood water sheets that the pool sits on. The owner's option survives only as Option B. If the owner's intent was a zone-wide reskin, that intent is refuted here on cost and on structure; the smaller change is the honest one.

## 3. The pool

The lamp's pool is `color += albedo * li.colorInt.rgb * li.colorInt.w * disc * POOL_GAIN * pools;` (`lighting.wgsl`, the clustered local lights loop). It multiplies the lamp's colour by the **fragment's albedo**. The accepted +45..+52 lift sits on the silt margin, which is currently tagged `paving`/`board-formed` at albedo ~0.132 (the patch quad colour `PATCH['flooded'] = [0.132, 0.126, 0.115]`).

If the floor under the lamp becomes `silt` at a different albedo, the pool's measured lift scales by the albedo ratio:

- current silt-margin albedo ≈ 0.132 (luminance of `[0.132, 0.126, 0.115]`).
- pool lift ∝ albedo. Lift_new = lift_old × (albedo_silt / 0.132).

Direction and magnitude:

| silt albedo (luminance) | ratio vs 0.132 | expected lift on y 730-739 | vs PART 22 gate (≥ +45) |
|---|---|---|---|
| 0.06 (dark mud) | 0.45 | +20 to +23 | **FAILS** |
| 0.08 (wet silt) | 0.61 | +27 to +32 | **FAILS** |
| 0.11 (damp silt) | 0.83 | +37 to +43 | **FAILS** (borderline) |
| 0.13 (current) | 1.00 | +45 to +52 | holds |
| 0.15 (pale silt) | 1.14 | +51 to +59 | holds |

The gate survives **only if the silt class's albedo is set at or above ~0.13** — essentially the same value the silt margin already carries. If the implementer sets silt to a darker "dead ground" albedo (the natural choice for §4's read), the pool gate fails: a 0.08 albedo drops the lift to +27-32, well below +45, and the lamp stops warming the floor it is supposed to warm.

**This is the single most important sentence in this document:** if the silt class's albedo is set below ~0.11, the +45 pool gate fails, because the pool term multiplies by albedo and the accepted lift sits on an albedo of ~0.132. The class cannot be both darker than the silt margin it replaces and pool-compatible. Either the pool gate is re-registered (and PART 22's verdict revisited), or the silt albedo stays near 0.13 and the "dead ground" read comes from something other than darkness — texture, jointlessness, low saturation, not low value.

## 4. The read

Proposed shading for the `silt` class in `groundSurface` (`gbuffer.wgsl`), in one
paragraph. The class is dead ground: the yard's own surface after the fall, not
asphalt, not water, not a decal. It should be **low saturation, near-neutral,
slightly warm-grey**, with **no paving joints** (the printed-paving tell is the
running-bond seam; joints are the "intact city" signal), **no polish**, **no
grain at carriageway scale**, and **low-frequency albedo noise** (two-octave
fbm, amplitude ~0.15) so it reads as mud and silt rather than as a flat fill.
Roughness should be high (0.75-0.85) and metallic 0. The albedo must stay at or
above ~0.13 (§3) — so the darkness comes from saturation and texture, not from
value. Evidence of passage (scuff marks, footprints, wheel tracks) is the
reference's own cue for wet ground, but it is a **geometry** cue, not a shading
one; the class's shading cannot author it, and the gate should not ask the
shader to. The failure to avoid is a uniform dark fill with no structure — the
project has paid for that one before (the carriageway comment in `gbuffer.wgsl`
records two wrong crack-network versions that read as decals, and the "plastic
sheet" risk in `FLOODED_LOWS_SPIKE.md` records the flat-mirror failure). A
single `alb *= 0.84 + 0.30 * resurf` on a flat colour is exactly that failure.
The noise must vary at the scale of a footprint, not at the scale of a car.

## 5. Cost and LOD

Producer recommended: Option B (re-tag `citygen`'s deck quads inside the zone
footprint). Cost:

- New triangles: **0**. The deck already exists; only the tag changes.
- Ground pass stays at 68,128 tris citywide, mean 2,523 per chunk, max 5,694
  (`__probe_fallground.ts`, measured this session, 27 chunks, winding 0).
- No new draw call, no new mesh, no new instance. The chunk's solid builder
  already carries the deck quads; only their vertex colour's alpha (the tag)
  changes for chunks inside the zone footprint.
- LOD 0/1/2: unchanged. The deck is baked at lod 0 and the chunk's LOD
  policy (`lodForDistance`) is untouched. The tag is per-primitive and flat-
  interpolated, so it survives every LOD the chunk is baked at.
- If the implementer instead chooses Option A (zone-wide mesh), the cost is
  ~67,500 new tris (27 chunks × ~2,500) and the loss of the street structure
  (§2). That is not recommended.

## 6. The parity selftest

What `__selftest_ground_contract.ts` must additionally assert, in the file's own
idiom, so the new class cannot drift between TypeScript and WGSL. The existing
flood block (lines ~110-140 of the selftest) is the template; the silt
assertions are:

```ts
// ---------------------------------------------------------------- silt parity
// Round 3s (the silt class). The class is appended at index 7, after flood at
// 6, so every existing tag stays bit-identical. The selftest must assert the
// index, the reachability of the branch, and the decode, in the same idiom as
// the flood block above.
{
  requireThat(GROUND_SURFACE_CLASSES.indexOf('silt') === 7,
    'silt must be class 7, appended after flood at 6: indices 0-6 keep every existing tag bit-identical');
  requireThat(groundSurfaceTag('silt', 'asphalt') < 0,
    'an unappended class list decodes to a POSITIVE tag, which the renderer reads as emission');

  // The two decoders agree — re-express either side and this fails until the
  // other matches. (Same expressions as the flood block; repeated here so a
  // future edit to one side is caught against the other for BOTH classes.)
  for (const expr of ['max(0.0, -tag - 1.0)', 'u32(floor(payload / 16.0))', 'u32(floor(payload)) % 16u']) {
    requireThat(gbufferSrc.includes(expr), `GPU ground decode changed (${expr}): groundgrammar.ts must move with it`);
  }
  for (const expr of ['-tag - 1', 'Math.floor(payload / 16)', 'Math.floor(payload) % 16']) {
    requireThat(grammarSrc.includes(expr), `CPU ground decode changed (${expr}): gbuffer.wgsl must move with it`);
  }

  // Reachability, not presence. The existing flood block already requires
  // every class in the table to have a `surface == Nu` test and forbids any
  // branch after the final `else`. Those assertions cover silt automatically
  // once 'silt' is in GROUND_SURFACE_CLASSES — but they must still pass, and the
  // silt branch must sit BEFORE the carriageway catch-all, not after it.
  const stripComments = (s: string): string => s.replace(/\/\/[^\n]*/g, '');
  const wgsl = stripComments(gbufferSrc);
  const fn = wgsl.indexOf('fn groundSurface(');
  requireThat(fn >= 0, 'groundSurface must exist in gbuffer.wgsl');
  let depth = 0, end = -1;
  for (let i = wgsl.indexOf('{', fn); i < wgsl.length; i++) {
    if (wgsl[i] === '{') depth++;
    else if (wgsl[i] === '}' && --depth === 0) { end = i; break; }
  }
  requireThat(end > fn, 'groundSurface must have a body');
  const body = wgsl.slice(fn, end);
  // silt is class 7; it must have a test, and the test must be before the
  // final else (otherwise the branch is dead and silt renders as carriageway).
  requireThat(body.includes('surface == 7u'), 'silt (class 7) has no test in groundSurface, so it falls into the carriageway catch-all');
  const finalElse = body.lastIndexOf('else {');
  const siltBranch = body.indexOf('else if (isSilt)');
  requireThat(siltBranch > 0 && siltBranch < finalElse, 'the silt branch must sit before the carriageway catch-all, or it never runs');
  requireThat(/let\s+isSilt\s*=\s*surface\s*==\s*7u\s*;/.test(body), 'isSilt must be decoded from surface == 7u');

  // Walking surfaces: silt must NOT be walkable (it is off-limits rubble/silt,
  // same as flood). walkingsurfaces.ts keeps only 'paving' and 'kerb-top';
  // assert the new class is not among them.
  requireThat(!['paving', 'kerb-top'].includes('silt'), 'silt must not be a walking surface (it is off-limits ground)');
}
```

Notes on the assertion:

- The existing flood block's loop `for (let k = 0; k < GROUND_SURFACE_CLASSES.length; k++)` already requires `surface == 7u` to appear once `'silt'` is appended. The new block repeats the reachability check explicitly for silt so a future edit that adds the class to the TS list but forgets the WGSL branch fails loudly rather than passing on the flood block's coattails.
- The `walkingsurfaces.ts` assertion is a tautology in the form above (silt is not in that list by construction). The real assertion is that `walkingsurfaces.ts` contains no reference to `'silt'` in its keep-list. The implementer should grep for it: `grep -n "'silt'" src/world/walkingsurfaces.ts` must return nothing. If it returns a line, silt is walkable and the crowd will stand on it.
- No fragment-stage decode is required for silt unless the implementer wants silt-specific fragment behaviour. If they add one, it must be tested the same way the flood decode is (`i.groundTag < 0.0 && u32(floor(floodPayload / 16.0)) == 6u`).

## 7. The gate for the round

Pre-registered acceptance, judgeable without reinterpretation:

> **Post-round status, 2026-10-25 — the round is `done`, two clauses here are not.** Verdicts:
> [`VISION_FALL_BASELINE.md`](VISION_FALL_BASELINE.md) PART 24 and PART 25. What held: the
> texture swap (measured on deck-only patches, not on this band), the pool at +52.5, the wall
> at +0.025 pp, no new geometry, no GPU error, the std-dev floor, and the controls at matched
> run length (16-19 inside ±0.03 pp under every thermometer, strict max 0.0043 pp — pose 17's
> −0.076 pp was an artifact of a 5-pose run against a 28-pose one).
>
> What did **not** hold, and must not be reused as written:
>
> - **The ≥15-point warm-leaning drop was arithmetically impossible.** The baseline measures
>   7.69 % `R>B` in this band, so the largest fall available is 7.69 points. The clause was
>   unsatisfiable the day it was registered; the band's warm pixels are the figures, the wedge
>   and the pool skirt, not the deck, so a deck change could never deliver it.
> - **±0.03 pp is finer than the noise on any crowd-bearing pose.** Two runs of an *unchanged*
>   build moved `03-tram-level` by 3.6 pp and `01d-street-crowd` by 1.6 pp at the same seed,
>   with identical instance counts. The threshold reaches or exceeds the measured same-build
>   floor on ten city poses.
>
> Replacement line, to be used in the next gate: *fall-family controls hold ±0.03 pp strict;
> city controls hold within their own same-build, same-length floor pair, with the floor
> recorded per pose and treated as a lower bound on sim drift.* And a sequence must be run with
> `SYZYGY_TIMEOUT=900000` — the default 120 s cannot fit 28 poses (PITFALLS §41).

**Measurement.** On pose 20's frame (`20-fall-ground-level`, `--sequence`, `--quality=medium`), the yard band `x 250-1300, y 560-780`:

- **Warm-leaning pixels (`R > B`) on the ground surface inside the band:** the
  baseline (3n's frame, `shots/2026-10-22T11-09-19`) has the printed-paving
  tell. The gate passes if the band's warm-leaning share falls by at least
  15 points (i.e., the printed paving is gone from the yard) **and** the
  band's mean RGB shifts away from the running-bond palette's warm-grey toward
  the silt class's authored colour, with the shift measurable as a change in
  the (saturation, value) band the decoder recovers (§4's silt band must be a
  new entry in `FAMILY_BAND`, or the family must be recovered as the nearest
  band — either way, the decoded family for the yard's deck quads must change
  from `board-formed`/`asphalt` to the silt entry).
- **No new decal.** The yard band must not gain a uniform flat fill: the
  standard deviation of luma across the band must not drop by more than 20 %
  (a flat fill is a uniform value; dead ground has texture). If the std dev
  collapses, the change is a paint job and the gate fails.
- **Controls that must not move:** pose 16, 17, 18, 19 warm share within 0.03 pp
  of the 3n baseline; pose 20's pool peak lift at y 730-739 ≥ +45 against
  `shots/2026-10-22T07-21-31`; no GPU/WGSL error; tier uniform (medium,
  1600×900); lights 1222/1133/1405/1133/1133, starved 0.
- **No city-wide regression.** The ground pass's triangle count must not rise
  (Option B is a re-tag, 0 new tris). If it rises, the producer is wrong.

**The single most important sentence in this document** (repeated from §3):
if the silt class's albedo is set below ~0.11, the +45 pool gate fails, because
the pool term multiplies by albedo and the accepted lift sits on an albedo of
~0.132. The class cannot be both darker than the silt margin it replaces and
pool-compatible.

## Conclusion

**The silt class survives its own gate only if its albedo stays at or above ~0.13.**
It breaks the pool if it is set darker. The ABI is sound (append at the end, keep
the WGSL dispatch chain reachable, update the selftest). The producer must be
Option B (re-tag `citygen`'s deck quads inside the zone footprint) — Option A
covers and destroys the street structure for ~67,500 new tris and is not a
simplification. The read is achievable only if the class's shading is noisy,
jointless and low-saturation at a value of ~0.13, not a flat dark fill. The
selftest gains one block (§6) and one grep. The gate for the round is the
warm-leaning-share drop plus the std-dev floor plus the pool and controls.

**Does the silt class survive its own gate, or does it break the pool? It breaks
the pool if its albedo is set below ~0.11. At albedo ≥ 0.13 it survives, but
then the "dead ground" read has to come from saturation and texture, not from
darkness — and that is the open question for the round, not for this gate.**