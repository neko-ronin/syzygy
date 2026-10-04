# Round 12 report: close-range deck, kerb gutter-read, hero ready

## 0. Pose reproduces the capture exactly

Re-derived `kerb-face` at seed 6191639 headlessly: cam (125.8, 2.0, 24.6),
look (131.0, 0.6, 23.4) — digit-identical to `shots/latest.json`. The
derivation is deterministic against the real capture; what follows is
measured at the shot's own street (glass-foxholes, street 24.83, flush
kerb 0.13, asphalt, centre-line).

## 1. The deck at 2–3 m: authored flat (dev1's branch, file+line below)

Measured at the shot's street, 15 m radius:

- Base deck: one albedo per 64 m cell by construction (`pushGroundDeck`) —
  the close read cannot come from vertex colour.
- Detail layer: 7 distinct baked colours near camera (kerb, footway,
  gutter, joint, paint, deck accents) — variety exists where baked.
- Carriageway synthesis (`gbuffer.wgsl:538-576`): grain ±10% (`:464-465`)
  + 28 m resurf patches (`:555`) + 24 m tar seams (`:568`) + 6 m wheel
  lattice. Nothing at 0.1–2 m scale. The frame's flat-with-blotches deck
  is exactly this recipe rendered correctly.
- Footway synthesis (`:495-536`) HAS sub-metre joints (cobble 0.21,
  terracotta 0.30, flagstone 0.90/0.60, boardwalk/banded) — same frame,
  same light, different branch. The asymmetry proves the gap is branch
  content, not a global threshold.
- Ruled out by reading: UV dependence (synthesis keys off `world.xz`,
  `:413`), close-range cutoff (`groundJointsD` widens WITH distance —
  close stays crisp), band mismatch (TS `FAMILY_BAND` == WGSL decode
  table entry-for-entry), octave gating (`detail=F.time.w`=quality tier;
  amplitude identical either way).

Verdict: the carriageway branch has no close-scale synthesis BY
AUTHORSHIP. Fix belongs in `gbuffer.wgsl:538-576` (dev1) — close joints
or finer grain on the carriageway path. NOT mine: `groundgrammar.ts`
correctly assigns asphalt (district identity); swapping family to fake
joints would corrupt identity to fix shading. G1/G2 HELD.

## 2. Gutter-read: shading consequence, not tone or height

Face and kerb-top share ONE albedo (`kerbAlbedo`, `groundbake.ts:899,962`)
— any face-vs-top differential in-frame is lighting by construction.
Height exonerated (0.126 m measured vs 0.10–0.20 authored — a normal
kerb). Tone raises both surfaces together, so it cannot make a face read
against its own top. The dark band is normal·sun + the in-shader chamfer,
dark base and AO (`gbuffer.wgsl:480-484`, already authored). If the face
still reads recessed after dev1's pass, the remaining levers are all
shading-side (sun angle on verticals, ambient floor, AO strength) or a
second albedo channel the vertex format has no room for (full at 12
floats) — dev1's call either way. `kerbTone` stays; face height stays.
G3 HELD.

## 3. Hero ready to shoot

`deriveHeroWalk` re-proven green at the capture seed (run 422.7–434.7,
approach/exit known, corridor unblocked, eye 1.6, fov 1.05). Expected
frame for the reviewer brief: standing in the approach gap at 1.6 m eye,
nearest right-hand counter front AND end in near foreground right with
paving and passing strip beside it, aisle continuing to the exit gap,
opposing frontage left, towers and cords above. If the approach reads
empty, that is per-spec (open approach gap), not a defect — the run's
density is mid/late. H1 HELD. Wiring (main.ts call + capture entry)
remains the routed follow-up.

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0.
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`.
Scratch deleted. No source changes this round.

## Files committed (this round)

- `docs/R11_GROUND_CLOSE.md` (this file). A localisation round; the fixes
  it names are in `gbuffer.wgsl` and are routed, not made.
