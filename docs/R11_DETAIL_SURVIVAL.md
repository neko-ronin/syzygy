# Round 9 report: detail survival, kerb refusal, pose coverage

## 1. Detail survival: drawn-but-unreadable. Bake exonerated a third time.

Method: authored facade props (Sign/Lantern/ACUnit/all kinds — positions
known from the generator) projected through the 01d camera (seed 0x5e7a17,
values from the round-4 settled run). P-D1 (≥60% sub-6px) REFUTED
decisively: 10/10 in-frame props within 120 m measure 5.8–21.8 px
(p50 12.4). Zero are LOD-culled — the camera chunk is always LOD0
(`lodForDistance(0)=0` at every tier), draws are whole-chunk (no per-prop
cull exists in the renderer), and `placed == wanted` was already proven.

Eliminated: bake-budget drops (none — 1060/1060), per-prop culling (no such
code path; chunk-level frustum + LOD only), subpixel size for facade props.
Remaining, in order:

1. **Fragment/shading response** (dev1): kerb faces project 8172 verts
   in-frame (nearest 7.6 m) at 2.05x baked contrast with zero kerb pixels;
   facade props at 6–22 px read as bare walls and dots. Same shape as the
   kerb finding: geometry + vertex-colour contrast present, pixels absent.
   Files: `src/shaders/gbuffer.wgsl` `groundSurface` (kerb-face detection
   by normal), sun/fog response on vertical faces; `src/render/renderer.ts`
   lighting. One sentence to route: baked detail with authored contrast
   does not survive the fragment stage at street range.
2. **LOD-by-design for the far field**: beyond ~410 m (`LOD_CHUNK_STEP`
   1.6 chunks, `quality.ts:53`) furniture and paint are unbaked on purpose
   (`groundbake` LOD 1 = faces only, LOD 2 = nothing). Horizon bareness is
   policy, not loss — but it means the far half of any avenue shot is
   kerb-faces-or-nothing by authorship.
3. **Viewpoint**: the 01d camera looks down the road void — 267 props within
   120 m, 10 in-frame, clustered on two facades. Sparseness in this frame is
   partly where it points, not what exists.

Caveat (not measured, flag for the capture owner): quality tier at capture
time. At potato/low the governor demotes LOD and drops foliage; the tier
the 01d frame baked at is not in evidence headlessly.

Nothing in this section was changed: no grammar, budget, or LOD edit was
indicated, and none was made.

## 2. Kerb refusal: fires as documented (P-K1 HELD)

Temp edit (`KERB_MIN_WIDTH` → 100000, reverted in the same session):
`ok=false` with `no street/artery with a kerb face in a B district within
±1024 m (step 32 m, width ≥ 100000 m) — refusing rather than guessing`.
The guard is tested, not assumed. No committed change.

## 3. Pose coverage for §A/§B close (P-S1 HELD — gap confirmed)

Capture poses today: 01d district-agnostic (follows the crowd), 01e/01f
crowd/facade, 01g B-kerbs only, plus aerials/market/night. There is NO
dedicated A-street or B-avenue pose; 01d serves whichever district the
crowd is in. `sections.json` maps `street-crowd→B`, `night-lanterns`→A,
and has no `kerb-face` key (01g skipped loudly by `--auto` until one line
is added — restated from round 8, still open). Recommendation: when A/B
close-ups are scheduled, generalise the kerb-face district parameter
rather than minting poses; do not build unasked with no capture budget to
validate them.

## Verification (verbatim)

`./node_modules/.bin/tsc --noEmit` → errors confined to
`src/sim/__probe_wp.ts` (another agent's live scratch, unused vars; not
mine, not touched). Zero errors in world/render/agent files.
`src/world/__selftest.ts` → `VIOLATIONS   none — all invariants hold`
(import test per the standing rule).
Scratch probes deleted. No source changes this round.

## Files committed (this round)

- `docs/R11_DETAIL_SURVIVAL.md` (this file). Nothing else — the round
  produced a localisation, and localisations commit as reports.
