# Round 9 report: kerb pose, orange edging, two old corrections, §A standing

## 1. The pose: `01g-kerb-face` / derive `kerb-face`

`src/world/diagnosticposes.ts` (+`DerivedPoseId`, +`deriveKerbFace`,
branch in `derivePose` — no `main.ts` change needed: `setPose` dispatches
through `app.pose`). `tools/capture.mjs`: one entry after `01f` (that file
otherwise untouched). Verified headlessly at seeds 42 and 6191639: B
districts (canal, rust, glass), street/artery, eye 1.7 m, aim ~5.4 m,
in-cone self-check passes, empty-pop refuses. Geometry: centreline from the
live field, edge at half-width, camera 1.2 m past the edge (on every
footway, provably outside conforming facades: footprints shrink to
`clearance − 1.6`, lean shear is zero at the base) and 2.8 m back along the
tangent, looking 2.5 m ahead at deck +0.25 — pavement, vertical face and
carriageway in one oblique frame.

Derivation rules (all load-bearing, all from named failures): expanding
rings from the origin (most central kerb, deterministic); street/artery in
B districts with a non-`bollard-line` kerb; 20 m straight run under the
same guards `traceOne` walks under; fail-loud refusal when nothing
qualifies (no fallback coordinate — F2). Provenance carries district,
carriageway, offsets and rejections; `distanceToCrowd` reported, not gated.

Routed follow-up (not my file): `compare.mjs --auto` matches pose keys in
`references/sections.json`, which has no `kerb-face` key — the row is
skipped loudly until someone adds `'kerb-face': 'B'`. One line.

## 2. Orange edging: authored, not a grammar bug — but genuinely ambiguous

Channels verified correct: kerb faces/bake read `kerbAlbedo`
(trim-derived, `groundbake.ts:899`), paint reads `paintAlbedo`
(accent-derived, `:1166`), gated by marking style. No swap, no mislanding.

Orange kerb producers (kerb hue 10–50°): verdant stone 24°, copper flush
13°, terracotta stone 25°. Orange/red paint: copper dashes 14°, terracotta
artery 18°, market artery 23°, rust yard-grid 8°. Copper is the collision:
kerb 13° and dashes 14° from trim #c96a2e vs accent #e07a2e — distinct
channels, adjacent hues, same value family. At distance that is a kerb-or-
stripe question no brightness knob can answer; the pose in §1 is the
instrument that can. Do not retune trim or tone against this screenshot.

## 3. Two round-4 corrections (rule 6: the artifact over the prose)

- (From round 6, restated so this file is complete:) the visible band is
  pedestrian geometry per the enabled/disabled control pair, not projecting
  signs. The e=3.4 signature proved baked sign faces exist in the frustum,
  not what the pixels show.
- (New:) market streets DO get kerb faces. `emitTrace` emits face quads
  unconditionally (`groundbake.ts:892-899`); `bollard-line` adds posts, it
  does not remove the face. Round 4's "no kerbs by design on market" was
  false — which strengthens, not weakens, the fragment-side routing: more
  baked faces are missing from pixels than claimed.

## 4. §A standing (resumed per brief, nothing to change)

`__selftest_sectionA.ts` re-run green (bands, +0.19 saturation lead, coats
4.58/6.37:1, R2 pins 307/192/5.90 m/39%); world suite green. The reskin
from round 8 holds; no further §A edits this round.

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → exit 0.
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`.
Section A check → `VIOLATIONS none`.

## Files (this round, committed)

- `src/world/diagnosticposes.ts`: kerb-face id, spec, derivation, branch.
- `tools/capture.mjs`: `01g-kerb-face` entry only.
- `docs/KERB_POSE_AND_COLOUR.md`: this file.
