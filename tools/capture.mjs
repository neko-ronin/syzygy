#!/usr/bin/env node
/**
 * Headless screenshot harness for SYZYGY.
 *
 *   node tools/capture.mjs                      one shot -> shots/<ts>.png
 *   node tools/capture.mjs --sequence           ~8 named poses -> shots/<ts>/*.png
 *   node tools/capture.mjs --quality high       set the app's quality tier
 *   node tools/capture.mjs --eval "expr"        run an expression in the page
 *
 * Boots vite preview (or dev with --dev) on port 4173, waits for
 * `window.__syzygy.ready`, drives the app, screenshots, and always tears the
 * server down. Every failure is reported as one readable line, never a stack.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'shots');
const PORT = Number(process.env.SYZYGY_PORT || 4173);
/**
 * The seed every capture renders, in DECIMAL because that is what `main.ts`
 * parses it as. Must equal `0x5e7a17`; asserted in `src/render/__perftest.ts`.
 */
const DEFAULT_SEED = 0x5e7a17;
/**
 * How far the renderer may hold a camera from the one a pose requested.
 *
 * fov is deliberately NOT compared — `speedFov` biases it by design and by up to
 * 24%, so comparing it rejects correct frames. See the check.
 */
const POSITION_TOLERANCE_M = 0.5;
const DIRECTION_TOLERANCE_DEG = 1.5;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const BASE = `http://localhost:${PORT}`;
const GLOBAL_TIMEOUT_MS = Number(process.env.SYZYGY_TIMEOUT || 120_000);

// ---------------------------------------------------------------- cli

function parseArgs(argv) {
  const opts = {
    sequence: false, poses: [], debug: 0, debugseq: false, grab: null, query: '', quality: '', eval: null,
    dev: false, timeout: GLOBAL_TIMEOUT_MS, keepOpen: false, heroPair: false, scene: null,
    // `chunks` is the boot warm (`?chunks=N`): how many chunks to force resident
    // before the first presented frame. `poseChunks` is the post-pose warm, which
    // is the one that bakes at the LOD the capture camera will actually see.
    chunks: 64, warmTicks: 400, poseChunks: 96,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sequence' || a === '-s') opts.sequence = true;
    else if (a === '--dev') opts.dev = true;
    else if (a === '--hero-pair') opts.heroPair = true;
    else if (a.startsWith('--scene=')) opts.scene = a.slice(8);
    else if (a.startsWith('--pose=')) opts.poses.push(a.slice(7));
    else if (a.startsWith('--debug=')) opts.debug = Number(a.slice(8));
    else if (a === '--debugseq') opts.debugseq = true;
    else if (a.startsWith('--grab=')) opts.grab = a.slice(7);
    else if (a.startsWith('--query=')) opts.query = a.slice(8);
    else if (a.startsWith('--chunks=')) opts.chunks = Math.max(0, Number(a.slice(9)) | 0);
    else if (a.startsWith('--pose-chunks=')) opts.poseChunks = Math.max(0, Number(a.slice(14)) | 0);
    else if (a === '--no-warm') { opts.chunks = 0; opts.poseChunks = 0; }
    else if (a === '--keep-open') opts.keepOpen = true;
    else if (a === '--quality' || a === '-q') opts.quality = argv[++i] ?? '';
    else if (a === '--eval' || a === '-e') opts.eval = argv[++i] ?? null;
    else if (a === '--timeout') opts.timeout = Number(argv[++i]) * 1000;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a.startsWith('--eval=')) opts.eval = a.slice(7);
    else if (a.startsWith('--quality=')) opts.quality = a.slice(10);
    else if (a.startsWith('--timeout=')) opts.timeout = Number(a.slice(10)) * 1000;
  }
  if (!Number.isFinite(opts.timeout) || opts.timeout <= 0) opts.timeout = GLOBAL_TIMEOUT_MS;
  return opts;
}

const HELP = `
 syzygy capture harness

  node tools/capture.mjs                       capture one shot
  node tools/capture.mjs --sequence            capture the curated poses
  node tools/capture.mjs --quality high        set quality tier (low|med|high)
  node tools/capture.mjs --eval "expr"         run a JS expression, print JSON
  node tools/capture.mjs --pose=canyon          only shoot poses whose name contains 'canyon'
  node tools/capture.mjs --hero-pair            derived hero, frozen daylight/night control
  node tools/capture.mjs --hero-pair --scene=shots/<run>/_scene.json  replay saved actors/camera
  node tools/capture.mjs --dev                 use ` + '`vite dev`' + ` instead of preview
  node tools/capture.mjs --timeout 180         global budget in seconds (default 120)

  node tools/capture.mjs --no-warm             stream the world instead of baking it
                                             (the cold path, for A/B against a warm run)
  node tools/capture.mjs --chunks=64           chunks to bake before the first frame (?chunks=)
  node tools/capture.mjs --pose-chunks=96      chunks to bake after setPose, at the pose's LOD

  Diagnostic poses (01d/01e/01f) take their position from live world state via
  the app's \`pose()\`; \`--eval "__syzygy.pose('street-crowd')"\` prints the exact
  numbers the renderer used.
`;

// ---------------------------------------------------------------- poses

/**
 * Curated camera poses. `name` is used for the file name and the index.
 *
 * A pose either carries literal `position`/`lookAt` — an establishing shot of a
 * known place — or a `derive` key, which asks the app where to stand based on
 * live state at capture time (D21). Diagnostic shots use `derive`. The literal
 * ones are for places where a fixed coordinate is the subject.
 *
 * A diagnostic that is anchored to a literal and claims to be about something
 * else is worse than no diagnostic: it reports faithfully and in perfect detail,
 * and what it reports is about empty ground. `01b-crowd-closeup` stood at the
 * world origin while the city and crowd are near (990, 25); two sessions read
 * that empty street as a winding bug and then a culling bug. The three poses
 * that did it were renamed rather than deleted — the shots are still worth
 * having, they just are not what their names said — and the diagnostics were
 * rebuilt on `derive`.
 */
const POSES = [
  {
    name: '01-wide-skyline',
    label: 'wide skyline, tower tops in haze',
    // Over the old town onto the downtown peak, 1.5 km out (D29): the old camera,
    // (900, 120, 1400), sat 2.6 km out on the same axis and saw 1.6 km of garden
    // suburbs, so the teal climax was a pale ghost (R14 review 4). The benchmark
    // keeps the old camera for comparability.
    position: [323, 150, 506], lookAt: [-491, 280, -754], fov: 1.12, roll: 0,
    weather: { sky: 'clear', cloudCover: 0.34, haze: 0.22, aerialHaze: 0.4, godRays: 0.55 },
    lens: { tiltShift: 0.62, focusWidth: 0.34, fov: 1.12 },
    settle: 30,
  },
  {
    // NOT a ground-contact check any more. This stands at (1833, 6, 1760),
    // about 1.2 km from the dense districts and inside a block with no
    // carriageway near it, so it cannot show whether a building meets the
    // ground. The check that can is `01f-facade-base`, which derives its
    // position from live state and stands on a real footway.
    name: '01a-lot-interior',
    label: 'block interior ~1.2km from the dense districts — establishing only, NOT a ground-contact check',
    position: [1833, 6, 1760], lookAt: [1740, 26, 1742], fov: 1.15, roll: 0,
    weather: { sky: 'clear', haze: 0.16 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0, grain: 0, saturation: 1.1, vignette: 0.15 },
    settle: 40,
  },
  {
    // Was `01b-crowd-closeup` at [0, 2.4, -40]. An arterial does pass near the
    // origin, so this is a real street — it is simply a street a kilometre from
    // where the city is thick, and it was never a crowd close-up. The crowd
    // close-up is `01e-crowd-closeup`, which derives from the live centroid.
    name: '01b-origin-field',
    label: 'world origin, ~1km from the dense districts — establishing only, NOT a crowd close-up',
    position: [0, 2.4, -40], lookAt: [30, 1.2, -180], fov: 0.95, roll: 0,
    weather: { sky: 'clear', haze: 0.2, godRays: 0.4 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0.05, grain: 0, saturation: 1.1, vignette: 0.2 },
    settle: 40,
  },
  {
    // Was `01c-street-crowd` at [0, 4.5, -30], same fault as 01b. The street
    // diagnostic is `01d-street-crowd`.
    name: '01c-origin-avenue',
    label: 'world origin arterial — establishing only, NOT a crowd-density check',
    position: [0, 4.5, -30], lookAt: [6, 2, -300], fov: 0.9, roll: 0,
    weather: { sky: 'clear', haze: 0.15, godRays: 0.3 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0, grain: 0, saturation: 1.1, vignette: 0.15 },
    settle: 45,
  },
  {
    // ---- derived: the position is computed inside the app, from live state,
    // ---- at capture time. Nothing here is typed in.
    name: '01d-street-crowd',
    label: 'street level on the carriageway nearest the live crowd centroid, 2.4m on the footway, looking along the tangent — do pedestrians appear where the crowd actually is?',
    derive: 'street-crowd',
    weather: { sky: 'clear', haze: 0.15 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0, grain: 0, saturation: 1.1, vignette: 0.15 },
    settle: 40,
  },
  {
    name: '01e-crowd-closeup',
    label: 'street level aimed at the live crowd centroid — are pedestrians actually drawn, and drawn at the right place?',
    derive: 'crowd-closeup',
    weather: { sky: 'clear', haze: 0.2 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0.05, grain: 0, saturation: 1.1, vignette: 0.2 },
    settle: 40,
  },
  {
    name: '01f-facade-base',
    label: 'facade height on a derived footway, aimed across the street and up — do buildings meet the ground?',
    derive: 'facade-base',
    weather: { sky: 'clear', haze: 0.16 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0, grain: 0, saturation: 1.1, vignette: 0.15 },
    settle: 40,
  },
  {
    // Derived: the position is computed in diagnosticposes.ts from the live
    // street field (first B-district street/artery with a kerb face on a
    // straight run, rings out from the origin). Nothing here is typed in.
    // FOR the reviewer's kerb question: pavement, vertical kerb face and
    // carriageway in one oblique frame — raised kerb vs painted stripe.
    // NOTE (rule 4): `compare.mjs --auto` has no `kerb-face` key in
    // `references/sections.json`, so this row is skipped by --auto until one
    // is added mapping it at B. Judge it against the B sheet by hand.
    name: '01g-kerb-face',
    label: 'oblique kerb close-up on a derived B-district kerb line — raised face or painted stripe?',
    derive: 'kerb-face',
    // The local-first crowd (D26) spawns around the camera and stood in front
    // of the kerb on 2026-10-07. This frame judges ground, not people.
    crowd: 0,
    weather: { sky: 'clear', haze: 0.16 },
    lens: { tiltShift: 0, focusWidth: 1, bokeh: 0, chroma: 0, grain: 0, saturation: 1.1, vignette: 0.15 },
    settle: 40,
  },
  {
    name: '02-canyon-up',
    label: 'deep in the canyon looking straight up',
    position: [190, 9, 330], lookAt: [230, 150, 150], fov: 1.43, roll: 0.08,
    weather: { sky: 'clear', haze: 0.5, godRays: 0.8 },
    lens: { tiltShift: 0.55, focusWidth: 0.3, fov: 1.43, warp: 0.28 },
    settle: 24,
  },
  {
    // Name kept because `references/sections.json` maps `tram-level` to a
    // section and `--auto` matches on it; renaming would silently drop that.
    // Label corrected: it stands at the world origin, ~1km from the dense
    // districts, so it is a tram-height look at a quiet arterial and not a
    // statement about the city at its busiest.
    name: '03-tram-level',
    label: 'tram height at the world origin — establishing only, NOT a street-activity check',
    position: [0, 2.2, -60], lookAt: [40, 4, -260], fov: 0.95, roll: -0.05,
    weather: { haze: 0.3, wetness: 0.3 },
    lens: { tiltShift: 0.72, bokeh: 0.7, focusWidth: 0.2, fov: 0.95 },
    settle: 24,
  },
  {
    name: '04-canal-level',
    label: 'canal water level, reflections',
    position: [900, 3, 260], lookAt: [1400, 6, 340], fov: 0.8, roll: 0.04,
    weather: { haze: 0.42, wetness: 0.75, motes: 0.5 },
    lens: { fov: 0.8, saturation: 1.25, tiltShift: 0.4, focusWidth: 0.5 },
    settle: 24,
  },
  {
    name: '05-aerial-top',
    label: 'aerial, near top-down over the grid',
    position: [300, 1400, 700], lookAt: [0, 0, 0], fov: 1.05, roll: 0,
    weather: { cloudCover: 0.5, aerialHaze: 0.7 },
    lens: { fov: 1.05, horizonBend: 0.34, tiltShift: 0.6, focusWidth: 0.24 },
    settle: 24,
  },
  {
    name: '06-low-vertigo',
    label: 'low over the void, wide and banking',
    position: [-420, 14, -560], lookAt: [180, 260, 120], fov: 1.62, roll: -0.35,
    weather: { haze: 0.34, cloudCover: 0.45, aerialHaze: 0.5 },
    lens: { fov: 1.62, roll: -0.35, warp: 0.4, speedFov: 0.5, distortion: 0.1 },
    settle: 24,
  },
  {
    name: '07-sunset-gorge',
    label: 'sunset over the gorge, long light',
    position: [640, 120, 980], lookAt: [-200, 60, -300], fov: 1.0, roll: 0.06,
    time: 'dusk',
    weather: { sky: 'dusk', cloudCover: 0.4, haze: 0.4, godRays: 0.9, bloomStrength: 0.6 },
    lens: { fov: 1.0, saturation: 1.2, bloom: 0.8, vignette: 0.5 },
    settle: 36,
  },
  {
    name: '08-night-lanterns',
    label: 'night, lanterns and window light',
    position: [180, 60, 340], lookAt: [40, 120, -260], fov: 1.18, roll: 0.02,
    time: 'night',
    weather: { sky: 'night', cloudCover: 0.3, haze: 0.45, godRays: 0.1, motes: 0.4 },
    lens: { fov: 1.18, bloom: 0.85, exposure: 1.25, saturation: 1.15, vignette: 0.55 },
    settle: 36,
  },
  // ---- the market, at street level, in both phases.
  //
  // The market is R2's subject and it had NO pose in this table: the six frames
  // in `shots/market/` came from a throwaway script, so the review gate judged
  // images no one can reproduce. These are the same camera the review gate
  // looked at, promoted here so `--pose=market` is a thing that works.
  //
  // Position and heading are MEASURED (`src/world/__probe_night.ts` prints the
  // derivation): `districtField(0x5e7a17).market` puts the spine centre at
  // [1.16, 0.36] at along=0 with unit tangent [0.2557, -0.9668], and
  // `sampleStreetPlan` there reports `kind=market width=28.1 dist=0.00`. The
  // camera stands on that centreline at eye height and looks 60 m DOWN it.
  //
  // A note on that pose, because it cost a run and it is not obvious: the
  // origin is a chunk CORNER, so chunk (0,0) itself contains 0 stalls, 0 cords
  // and 0 lights — the market either side of the origin lives in chunks (0,-1)
  // and (-1,0). That is fine, because `lodForDistance` returns 0 out to 1.6
  // chunks, so both neighbours are baked at full detail too. What is NOT fine
  // is a capture whose warm stopped early: at LOD 1 every market descriptor is
  // culled and the frame is an empty street with correct kerbs. See
  // `warmPose()` for that measurement.
  {
    name: '09-market-down',
    label: 'market spine, eye height, looking down the aisle — does a warm lantern pool reach the walking surface?',
    position: [1.16, 2.6, 0.36],
    lookAt: [1.16 + 0.2557 * 60, 2.2, 0.36 - 0.9668 * 60],
    fov: 1.05, roll: 0,
    time: 'night',
    weather: { sky: 'night', cloudCover: 0.3, haze: 0.3 },
    lens: { fov: 1.05, bloom: 0.8, exposure: 1.28, saturation: 1.18, vignette: 0.5 },
    settle: 40,
  },
  {
    // Same viewpoint, same everything except the phase. A day/night pair from
    // one camera is the only way to tell "the night pass fixed it" from "the
    // night pass made the day frame brighter too".
    name: '09-market-down-day',
    label: 'market spine, eye height, SAME camera as 09-market-down, noon — the daylight control',
    position: [1.16, 2.6, 0.36],
    lookAt: [1.16 + 0.2557 * 60, 2.2, 0.36 - 0.9668 * 60],
    fov: 1.05, roll: 0,
    time: 'noon',
    weather: { sky: 'clear', haze: 0.25 },
    lens: { fov: 1.05, bloom: 0.3, exposure: 0.92, saturation: 1.08, vignette: 0.34 },
    settle: 40,
  },
  {
    // LEGIBILITY §4 asks for successive warm pools along the aisle. From 2.6 m a
    // pool 15 m ahead is a sliver; from a first-floor balcony (6 m), looking at
    // the aisle floor 40 m out, the run of pools reads. Same spot as 09-market-down.
    name: '09-market-aisle-night',
    label: 'market aisle from a first-floor balcony, night: successive warm pools',
    position: [1.16, 6.0, 0.36],
    lookAt: [1.16 + 0.2557 * 40, 0.8, 0.36 - 0.9668 * 40],
    fov: 1.05, roll: 0,
    time: 'night',
    weather: { sky: 'night', cloudCover: 0.3, haze: 0.3 },
    lens: { fov: 1.05, bloom: 0.8, exposure: 1.28, saturation: 1.18, vignette: 0.5 },
    settle: 40,
  },
  {
    // Sheet B feature review: a scaffold with rooms bolted on, on a 440 m Copper
    // Stacks tower, from 38 m and 25 degrees off its face (picked from the
    // per-building seed, D29 plan). The face points +z, into the sun: the sun
    // path never reaches a -z face, and the old rust-hangar face read flat in shade.
    name: '12-scaffold-b',
    label: 'sheet B: a scaffold with bolted-on rooms on a Copper Stacks tower, noon',
    position: [-300.8, 14, -484.1], lookAt: [-287.3, 30, -519.7], fov: 1.0, roll: 0,
    time: 'noon',
    weather: { sky: 'clear', haze: 0.22 },
    lens: { fov: 1.0, exposure: 0.92 },
    settle: 30,
  },
  {
    // Same camera at night: sheet B's warmth is its lit windows, which a noon
    // frame cannot judge.
    name: '12-scaffold-b-night',
    label: 'sheet B: SAME camera as 12-scaffold-b, night — lit room windows',
    position: [-300.8, 14, -484.1], lookAt: [-287.3, 30, -519.7], fov: 1.0, roll: 0,
    time: 'night',
    weather: { sky: 'night', cloudCover: 0.3, haze: 0.3 },
    lens: { fov: 1.0, bloom: 0.8, exposure: 1.28 },
    settle: 30,
  },
  {
    // Sheet D feature review: planted terrace bands and vines on a garden-suburb
    // (verdant-canyon) block, from 45 m, looking slightly up (D29 plan).
    name: '13-terraces-d',
    label: 'sheet D: planted terrace bands, shrubs and vine curtains, morning',
    position: [288.8, 14, 1013.0], lookAt: [243.9, 30, 1015.1], fov: 1.0, roll: 0,
    // Morning: the sun is due +z at noon, which only grazes this east face and
    // left its planting grey-green in sky shade (R14 review 4).
    time: 'morning',
    weather: { sky: 'clear', haze: 0.22 },
    lens: { fov: 1.0, exposure: 0.92 },
    settle: 30,
  },
  {
    // Sheet C (fire-lit) review: "close into the canyon". 22 m up in an old-town
    // alley (x ~ 200, the densest stretch; D29: the old town is the terracotta
    // core at the canal-market crossing), looking north along it, at dusk.
    name: '14-old-town-c',
    label: 'sheet C: an old-town alley at dusk: kilns, forges, ruins, bunting and smoke',
    position: [200, 22, 275], lookAt: [194, 10, 170], fov: 1.05, roll: 0,
    time: 'dusk',
    weather: { sky: 'dusk', cloudCover: 0.35, haze: 0.3, bloomStrength: 0.6 },
    // No saturation boost: at 1.15 the dusk terracotta clipped to flat red (B = 0).
    lens: { fov: 1.0, saturation: 1.0, bloom: 0.7, vignette: 0.45 },
    settle: 36,
  },
  {
    // Sheet C at night: two burnt-out shells, (166, 231) and (165, 271), beside
    // the alley of 14-old-town-c, from 55 m over the north-west. Their jagged
    // tops, ember-lit openings and glowing beds read against lit neighbours; the
    // steep aerial onto the largest ruin, (353, -128), was 63% black.
    name: '15-old-town-ruins-night',
    label: 'sheet C: old-town ruins (kiln yards) among lit neighbours, night',
    position: [108, 55, 332], lookAt: [185, 26, 245], fov: 1.05, roll: 0,
    time: 'night',
    weather: { sky: 'night', cloudCover: 0.3, haze: 0.3 },
    lens: { fov: 1.05, bloom: 0.8, exposure: 1.28, saturation: 1.18, vignette: 0.5 },
    settle: 36,
  },
  {
    // R2 asks for the wide skyline at both phases, side by side: whether night
    // out-reads day is the owner's call from the pair, not from a mean.
    // Same camera, lens and weather; phase, exposure and bloom as 09-market-down.
    // After every pose that sets no `time`: those inherit the previous phase, and
    // in second place it turned every later pose (01a, 05-aerial...) into night.
    name: '01-wide-skyline-night',
    label: 'wide skyline, SAME camera as 01-wide-skyline, night',
    position: [323, 150, 506], lookAt: [-491, 280, -754], fov: 1.12, roll: 0,
    time: 'night',
    weather: { sky: 'night', cloudCover: 0.34, haze: 0.22, aerialHaze: 0.4 },
    lens: { tiltShift: 0.62, focusWidth: 0.34, fov: 1.12, exposure: 1.28, bloom: 0.8 },
    settle: 30,
  },
  {
    // D30 islands' review camera. `01d-street-crowd` cannot be one: it derives
    // from the live crowd and moved between three places in one session (review
    // 7). Literal, on the spine 4 m past 09's camera and 3 m right of the
    // centreline, looking the same way, so noon lights the islands from behind
    // the lens. Measured from `marketGrammarFor` (seed 0x5e7a17): tree-bench
    // 10.1 m, planters 16.5, cafe with parasol 17.9, cafe with sitters 31.3,
    // planters 50.8. Last in the list, so every pose above keeps its sequence
    // history (PITFALLS §30); it sets its own phase, and the crowd is restored.
    name: '09-market-islands',
    label: 'market spine islands at 10-31 m, noon, crowd on: D30 furniture, signs of use, sheet-A colour',
    position: [1.16 + 0.2557 * 4 + 0.9668 * 3, 2.6, 0.36 - 0.9668 * 4 + 0.2557 * 3],
    lookAt: [1.16 + 0.2557 * 34 + 0.9668 * 3, 1.4, 0.36 - 0.9668 * 34 + 0.2557 * 3],
    fov: 1.05, roll: 0,
    time: 'noon',
    weather: { sky: 'clear', haze: 0.25 },
    lens: { fov: 1.05, bloom: 0.3, exposure: 0.92, saturation: 1.08, vignette: 0.34 },
    settle: 40,
  },
];

// ---------------------------------------------------------------- helpers

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (m) => process.stdout.write(`${m}\n`);

/** A readable one-line error. Never a stack trace. */
class CaptureError extends Error {}

function fail(msg, hint) {
  throw new CaptureError(hint ? `${msg}\n  ↳ ${hint}` : msg);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await sleep(250);
  }
  return false;
}

// ---------------------------------------------------------------- server

/**
 * Refuse to run against a server somebody else started.
 *
 * `--strictPort` makes our own spawn FAIL when the port is taken, and then
 * `waitForHttp` succeeds anyway against whoever owns it. The run proceeds,
 * writes screenshots, prints PASS — and every pixel in it came from a server we
 * did not start.
 *
 * That is not hypothetical. Another agent's `vite preview` squatted on 4173
 * serving a stale `dist/`, and three consecutive runs measured a build from
 * before the edit under test: an authored `ambientIntensity` of 0.66 read back
 * as 0.22, three times, and the control it was supposed to produce never
 * appeared. The tell was available the whole time and I did not read it —
 * `--strictPort` was in the spawn args precisely so this could not happen, and
 * its failure was swallowed.
 *
 * A screenshot of somebody else's build is worse than no screenshot, so this
 * is a hard failure with the port named.
 */
async function assertPortFree(port) {
  const { createConnection } = await import('node:net');
  const busy = await new Promise((resolve) => {
    const s = createConnection({ port, host: '127.0.0.1' });
    const done = (v) => { s.destroy(); resolve(v); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    setTimeout(() => done(false), 800);
  });
  if (busy) {
    fail(
      `port ${port} is already in use — something else is serving it`,
      'another agent or a stray `vite preview` owns this port, so every frame below would be ' +
      'that server\'s build rather than yours. Pick another: SYZYGY_PORT=4177 node tools/capture.mjs ...',
    );
  }
}

async function startServer(opts) {
  await assertPortFree(PORT);

  // Always use the dev server. A `preview` build is a stale build, and a
  // screenshot of a stale build is worse than no screenshot: it looks valid.
  const useDev = true;
  const args = useDev ? ['vite', 'dev', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1']
                      : ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'];
  const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  let child;
  try {
    child = spawn(bin, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  } catch (err) {
    fail(`could not spawn \`${bin} ${args.join(' ')}\`: ${err?.message || err}`, 'is vite installed? try `npm install`');
  }

  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  let exited = null;
  child.on('exit', (code) => { exited = code; });

  const up = await waitForHttp(BASE + '/', Math.min(30_000, Math.max(5_000, opts.timeout / 2)));
  if (!up) {
    stopServer(child);
    if (exited !== null) {
      fail(`vite ${useDev ? 'dev' : 'preview'} exited with code ${exited} before serving`, tail(log));
    }
    fail(`vite ${useDev ? 'dev' : 'preview'} did not answer on ${BASE}`, tail(log));
  }
  // Second check, after our own server is up: if something else is on the port
  // AND ours is answering, `--strictPort` would have killed ours, so a server
  // that is still alive here is ours. If the port had been taken, `assertPortFree`
  // above already refused the run.
  if (exited !== null) {
    fail(
      `our vite server exited (code ${exited}) but something still answers on ${PORT}`,
      'another process owns this port; the frames would not be this build. ' +
      'Re-run with SYZYGY_PORT set to a free port.',
    );
  }
  say(`  server    ${useDev ? 'dev' : 'preview'} on ${BASE} (port verified ours)`);
  return { child, useDev };
}

function stopServer(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 2500).unref?.();
}

const tail = (s, n = 6) => s.trim().split('\n').slice(-n).join('\n          ');

// ---------------------------------------------------------------- browser

async function launchBrowser() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    fail('playwright is not installed', 'run `npm install`');
  }
  try {
    return await chromium.launch({
      headless: true,
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan',
        '--use-angle=metal',
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--disable-dev-shm-usage',
        '--mute-audio',
      ],
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/Executable doesn't exist|browserType.launch/i.test(msg)) {
      fail('chromium is not installed for playwright', 'run `npx playwright install chromium` once');
    }
    fail(`could not launch chromium: ${msg.split('\n')[0]}`);
  }
}

/** Wait for `window.__syzygy` and its readiness signal. */
async function waitForApp(page, timeoutMs) {
  const present = await page
    .waitForFunction(() => typeof window.__syzygy !== 'undefined' && window.__syzygy !== null, null, { timeout: Math.min(15_000, timeoutMs) })
    .then(() => true)
    .catch(() => false);

  if (!present) {
    fail('window.__syzygy is missing 15s after load', 'the app must set `window.__syzygy = {ready, readyPromise, ...}` before the first frame');
  }

  // resolve readyPromise if the app provides one, then wait for the flag
  await page.evaluate(async () => {
    const g = window.__syzygy;
    if (g && typeof g.readyPromise?.then === 'function') {
      await Promise.race([g.readyPromise, new Promise((r) => setTimeout(r, 30_000))]);
    }
  }).catch(() => {});

  const ready = await page
    .waitForFunction(() => window.__syzygy?.ready === true, null, { timeout: Math.min(45_000, timeoutMs) })
    .then(() => true)
    .catch(() => false);

  if (!ready) {
    const boot = await page.evaluate(() => document.getElementById('boot-status')?.textContent ?? '').catch(() => '');
    fail('window.__syzygy.ready never became true', boot ? `boot screen says: "${boot}"` : 'the app never signalled readiness (WebGPU adapter missing?)');
  }
}

/** Feature-detected call into the app surface; never throws. */
/**
 * A pose's `crowd` count, applied after setPose in both the sequence and single-shot paths.
 *
 * The count outlives its pose. `01g-kerb-face` sets 0, and every later pose of a
 * sequence (the market, the scaffolds, the old town) was shot with no crowd
 * until review 7 noticed. A pose that sets no `crowd` after one that did gets the
 * boot crowd back (`resetCrowd`, the world's density); its settle refills it.
 */
let crowdOverridden = false;
async function applyPoseCrowd(page, pose) {
  if (pose.crowd === undefined) {
    if (!crowdOverridden) return;
    const r = await callApp(page, 'resetCrowd');
    // A build older than resetCrowd keeps the old leak; say so rather than fail,
    // so base commits can still be shot with this harness.
    if (r.skipped) {
      say(`    ! ${pose.name}: crowd not restored (${r.reason}); it and every later pose keep the last pose's count`);
      crowdOverridden = false;
      return;
    }
    if (!r.ok) throw new Error(`resetCrowd: ${r.error}`);
    crowdOverridden = false;
    return;
  }
  const r = await callApp(page, 'setCrowdCount', pose.crowd);
  if (!r.ok) throw new Error(`setCrowdCount: ${r.error || r.reason}`);
  crowdOverridden = true;
}

async function callApp(page, method, ...args) {
  return page.evaluate(async ({ method, args }) => {
    const g = window.__syzygy;
    if (!g || typeof g[method] !== 'function') return { ok: false, skipped: true, reason: `${method}() not implemented` };
    try {
      const v = await g[method](...args);
      return { ok: true, value: v === undefined ? null : v };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { method, args });
}

/** Drive the app forward a fixed number of *presented* frames. */
async function settle(page, frames) {
  // Wait for the streaming city to populate first: a shot taken on frame 1 is
  // of an empty world and tells you nothing about the render.
  await page.evaluate(async () => {
    const g = window.__syzygy;
    if (!g || typeof g.stats !== 'function') return;
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const s = g.stats();
      if ((s.residentChunks ?? 0) >= 40) return;
      await new Promise((r) => requestAnimationFrame(r));
    }
  }).catch(() => {});

  // Pace these through rAF rather than through `__syzygy.step()`.
  //
  // This is the single largest cost in a capture run and it was invisible,
  // because both paths "advance N frames" and both return successfully.
  // `step()` calls `tick()` N times back to back: each one encodes and submits
  // a frame in ~20ms and returns immediately, because `queue.submit` does not
  // wait for the GPU. N frames of GPU work are therefore queued in a few tens
  // of milliseconds, and the next thing that blocks — `captureRGBA`, which has
  // to `mapAsync` the readback — pays for the whole backlog.
  //
  // Measured on this machine, replaying the 11-pose sequence: the synchronous
  // step cost 274–1160 ms per pose and the capture that followed it cost
  // 1319 ms on pose 1 rising to 15204 ms on pose 11, totalling 104 s of a run
  // whose streaming work was 1.6 s. Streaming was never the cost. The unbounded
  // submit queue was.
  //
  // rAF paces at presentation, so the GPU is never handed more work than it can
  // retire, and the capture waits for at most the frame in flight.
  const advanced = await page.evaluate(async (n) => {
    const g = window.__syzygy;
    const start = g?.frameCount ?? 0;
    // Generous: a presented frame is ~33ms here, and warm chunks are already
    // resident by this point so none of these are expensive.
    const deadline = Date.now() + Math.max(2500, n * 150);
    while (Date.now() < deadline && (g?.frameCount ?? 0) < start + n) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    return (g?.frameCount ?? 0) - start;
  }, frames).catch(() => -1);

  // rAF genuinely not advancing (page not painting): fall back to synchronous
  // ticks, and say so rather than quietly capturing a world that never ticked.
  if (advanced < Math.min(4, frames)) {
    const stepped = await callApp(page, 'step', frames);
    if (stepped.ok) return { paced: false, advanced: frames };
  }
  return { paced: true, advanced };
}

/**
 * Bake the chunks the capture needs, synchronously, from the pose's camera.
 *
 * Order matters and it is the whole trick. `?chunks=` warms at boot, which is
 * right for "load the app and see a city" — but a chunk's LOD is derived from
 * the *live camera position*, so a boot warm bakes detail levels for the spawn
 * camera and then re-bakes them the moment the capture pose is set. Warming
 * here, after `setPose`, bakes each chunk at the level it will actually be
 * viewed at: `01d-street-crowd` gets the near ring at LOD 0 rather than the
 * boot camera's ring. Baking at the wrong level is not a slow capture, it is a
 * plausible-looking low-detail image — the exact failure this repository keeps
 * paying for, and the reason the warm is the app's own loop and not a second
 * bake path in the harness.
 */
async function warmPose(page, chunks, maxTicks) {
  if (chunks <= 0) return null;
  // `warm()` is NOT idempotent, and calling it once is not enough.
  //
  // Measured at the market pose: one call reports `stopped: "no-progress"` at
  // 10-11 resident chunks with `lodHistogram [0, 10, 0, 0]` — ten chunks
  // resident, every one at LOD 1, and `chunkLod(-1,1)` (the camera's OWN chunk)
  // returning -1, i.e. not resident at all. Five successive calls took
  // residency 11 → 27 → 45 → 65 → 85 and only the fifth baked the camera's
  // chunk, at which point `chunkLod(-1,1)` became 0.
  //
  // Why one call is not enough: `streamChunks` drains its bake queue under a
  // 4 ms per-frame budget, and each `bakeChunk` of a market chunk costs far more
  // than that. So a single `warm()` exhausts its tick cap partway through the
  // nearest ring, reports `no-progress` because residency has not moved *within
  // that call's* window, and the harness photographed a half-loaded world.
  //
  // That is the exact failure this file's own header warns about — "a
  // plausible-looking low-detail image" — arriving by a different route. It is
  // invisible in the PNG: an L1 market chunk is an empty street with correct
  // kerbs, which looks like a street at night.
  //
  // The loop runs until the camera's own chunk is resident at LOD 0, which is
  // the precondition for the frame to contain anything that LOD 1 culls: every
  // market cord, lantern, crate, sign and vent, and every clustered light.
  const deadline = Date.now() + 120_000;
  let report = null;
  let settled = null;
  for (let i = 0; i < 12 && Date.now() < deadline; i++) {
    const r = await callApp(page, 'warm', chunks, maxTicks);
    if (!r.ok) {
      if (r.skipped) return null;
      throw new Error(`warm: ${r.error}`);
    }
    report = r.value;
    settled = await page.evaluate(() => {
      const g = window.__syzygy;
      const [cx, cz] = g.cameraChunk();
      const st = g.stats();
      return {
        lod: g.chunkLod(cx, cz),
        resident: st.residentChunks ?? 0,
        // "Nothing left to bake" is the target-free settled condition. Comparing
        // residency to a fixed chunk count is not: residency is bounded by the
        // tier's `viewDistance`, so it plateaus well below the warm target and
        // the comparison can never be satisfied.
        pending: st.rebakePending ?? 0,
        // Chunks not yet resident at all; rebakePending never counted them.
        streaming: st.streamPending ?? 0,
      };
    }).catch(() => null);
    // TWO conditions, and only the first is a precondition for a correct frame.
    //
    // The camera's own chunk must be resident at LOD 0 — that is the real
    // precondition. Residency *count* is secondary, and it must be compared
    // against what the renderer can actually reach, not against `chunks`.
    //
    // This gate used to be `settled.lod === 0 && settled.resident >= chunks`.
    // Measured: `lod` was 0 on every one of 12 passes, while `resident`
    // plateaued at 70 against a target of 96 — bounded by the tier's
    // `viewDistance`, not by the bake budget. The gate was therefore
    // unpassable, and the failure message named LOD, the one condition that had
    // been satisfied the whole time. That message is in the sidecar of every
    // capture this project has ever taken, and it has been read as a measurement
    // rather than as a symptom (PITFALLS.md §12).
    const lodOk = !!settled && settled.lod === 0;
    const drained = !!settled && settled.pending === 0 && settled.streaming === 0;
    if (lodOk && drained) return { ...report, passes: i + 1 };
    if (report?.stopped === 'target' && lodOk) return { ...report, passes: i + 1 };
    await sleep(60);
  }
  if (report) {
    // Name the condition that actually failed. A reader who cannot tell which of
    // the two conditions held is exactly the reader who mis-instruments this.
    const why = !settled
      ? 'could not read the renderer state'
      : settled.lod !== 0
        ? `camera chunk is at LOD ${settled.lod}, not 0`
        : `bake queue still holds ${settled.pending} rebake(s) and ${settled.streaming} unstreamed chunk(s)`;
    say(`    ! warm did not settle in 12 passes: ${why} ` +
      `(resident ${settled?.resident ?? report.residentChunks}, ` +
      `lod [${report.lodHistogram.join(',')}]) — the frame may be low-detail`);
  }
  return report;
}

/** Screenshot, preferring an in-page canvas capture when available. */
async function shoot(page, path) {
  let saved = false;
  const cap = await callApp(page, 'capture');
  if (cap.ok && typeof cap.value === 'string' && cap.value.startsWith('data:image/')) {
    const b64 = cap.value.slice(cap.value.indexOf(',') + 1);
    writeFileSync(path, Buffer.from(b64, 'base64'));
    if (Buffer.from(b64, 'base64').length > 0) saved = true;
  }
  if (!saved) {
    await page.screenshot({ path, type: 'png', animations: 'allow', timeout: 20_000 });
    saved = existsSync(path);
  }
  return saved;
}

async function contactSheet(dir, out) {
  const { spawnSync } = await import('node:child_process');
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (probe.error) return null;
  const r = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-pattern_type', 'glob', '-framerate', '1', '-i', join(dir, '*.png'),
    '-filter_complex', 'scale=480:-1,tile=4x2:padding=6:color=0x05080b',
    '-frames:v', '1', out,
  ], { stdio: 'ignore' });
  return r.status === 0 && existsSync(out) ? out : null;
}

// ---------------------------------------------------------------- main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { say(HELP); return 0; }

  mkdirSync(SHOTS, { recursive: true });
  const runStamp = stamp();
  const started = Date.now();
  const notes = [];

  let server = null;
  let browser = null;
  let page = null;
  const results = [];
  let failed = false;

  // Hard global budget — the one thing that must never be missed.
  const watchdog = setTimeout(() => {
    process.stderr.write(`\nFAIL  global timeout of ${Math.round(opts.timeout / 1000)}s exceeded\n`);
    try { browser?.close(); } catch { /* noop */ }
    stopServer(server?.child);
    process.exit(1);
  }, opts.timeout + 5000);
  watchdog.unref?.();

  try {
    if (opts.eval && !existsSync(join(ROOT, 'dist', 'index.html')) && !opts.dev) opts.dev = true;
    server = await startServer(opts);
    say(`  browser   chromium (webgpu)`);
    browser = await launchBrowser();

    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e?.message || e).split('\n')[0]));
    page.on('console', (m) => { if (m.type() === 'error' && pageErrors.length < 6) pageErrors.push(m.text().split('\n')[0]); });

    // `?chunks=N&warm=M` — resolve the seed and force the first N chunks
    // resident, baked synchronously before the first presented frame.
    //
    // DECIMAL, deliberately. This used to carry a 0x-prefixed hex literal, and
    // `main.ts` reads it with `Number.parseInt(q.get(k) ?? '', 10)`. With an
    // explicit radix of 10 parseInt stops at the `x`, so the value that reached
    // the app was **0**, not 6191639 — every capture rendered seed 0 while every
    // CPU-side probe measured the intended seed. Two cities, and both sides were
    // internally correct about their own.
    //
    // The app also parses `chunks` and `warm` from this same string, and those
    // are decimal, so the fix belongs on the writing side rather than in the
    // parser: one representation, one parser. A hex-aware `int()` would have to
    // special-case the key. See PITFALLS.md §19a.
    const q = [`seed=${DEFAULT_SEED}`];
    if (opts.chunks > 0) { q.push(`chunks=${opts.chunks}`); q.push(`warm=${opts.warmTicks}`); }
    if (opts.query) q.push(opts.query);
    await page.goto(`${BASE}/?${q.join('&')}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await waitForApp(page, opts.timeout);
    const bootStats = await page.evaluate(() => (typeof window.__syzygy?.stats === 'function' ? window.__syzygy.stats() : null)).catch(() => null);
    if (bootStats?.warm) {
      say(`  boot warm ${bootStats.warm.residentChunks}/${bootStats.warm.target} chunks in ${bootStats.warm.ms}ms (${bootStats.warm.ticks} ticks, stopped: ${bootStats.warm.stopped})`);
    }
    say(`  app       ready (frameCount=${await page.evaluate(() => window.__syzygy?.frameCount ?? 0)})`);

    if (opts.quality) {
      const r = await callApp(page, 'setQuality', opts.quality);
      if (!r.ok) {
        notes.push(`--quality ${opts.quality} ignored (${r.skipped ? r.reason : r.error})`);
      } else {
        say(`  quality   ${opts.quality}`);
      }
      await settle(page, 12);
    }

    // ---- --eval short-circuits: no screenshots.
    if (opts.grab) {
      // `grab` is "name:sat=0" or "name:key=v,key=v" — apply overrides to the
      // first matching pose and save exactly one frame. Bisecting a single
      // parameter should not cost a 5-minute sequence.
      mkdirSync(join(SHOTS, runStamp), { recursive: true });
      const [name, over] = opts.grab.split(':');
      const pose = POSES.find((p) => p.name.includes(name)) ?? POSES[0];
      await callApp(page, 'setPose', { ...pose, name: pose.name }).catch((e) => say(`    ! setPose: ${e.message}`));
      await warmPose(page, opts.poseChunks, opts.warmTicks);
      await settle(page, pose.settle ?? 30);
      for (const variant of over.split('|')) {
        const [k, patch] = variant.split('=');
        const target = k === 'lens' ? 'setLens' : k === 'weather' ? 'setWeather' : k;
        const obj = {};
        for (const pair of (patch ?? '').split(',')) {
          if (!pair) continue;
          const [kk, vv] = pair.split(':');
          obj[kk] = Number.isNaN(Number(vv)) ? vv : Number(vv);
        }
        await callApp(page, target, obj).catch((e) => say(`    ! ${target}: ${e.message}`));
        await settle(page, 4);
        const out = join(SHOTS, runStamp, `${name}__${variant.replace(/[^a-z0-9]+/gi, '_')}.png`);
        await shoot(page, out);
        say(`    ✓ ${variant}`);
        results.push({ name: variant, file: out });
      }
      writeIndex(runStamp, results, notes, opts);
      return;
    }

    if (opts.heroPair) {
      const dir = join(SHOTS, runStamp);
      mkdirSync(dir, { recursive: true });
      const replay = opts.scene ? JSON.parse(readFileSync(resolve(ROOT, opts.scene), 'utf8')) : null;
      const hr = replay ? { ok: true, value: replay.hero } : await callApp(page, 'heroWalk');
      if (!hr.ok || !hr.value?.ok) throw new CaptureError(`hero derivation refused: ${hr.value?.reason ?? hr.error}`);
      const hero = hr.value;
      const pr = await callApp(page, 'setPose', hero);
      if (!pr.ok) throw new CaptureError(`hero setPose: ${pr.error}`);
      const warm = await warmPose(page, opts.poseChunks, opts.warmTicks);
      await settle(page, 40);
      await callApp(page, 'freezeCapture');
      if (replay) {
        const restored = await callApp(page, 'replayCaptureScene', replay.scene);
        if (!restored.ok) throw new CaptureError(`saved scene replay failed: ${restored.error}`);
      }
      // A pose record must describe a submitted frame, not stale writer matrices
      // from the frame before replay. Renderer matrices are the capture authority.
      const beforeSettled = (await callApp(page, 'submittedFrames')).value;
      await page.waitForFunction((start) => window.__syzygy.submittedFrames() >= start + 8, beforeSettled, { timeout: 15000 });
      const scene = (await callApp(page, 'captureScene')).value;
      if (!scene) throw new CaptureError('captureScene unavailable');
      if (replay) {
        for (const key of ['time', 'camera', 'lens', 'weather', 'crowd', 'crowdCount', 'vehicles', 'trafficLights']) {
          if (JSON.stringify(scene[key]) !== JSON.stringify(replay.scene[key])) throw new CaptureError(`saved scene replay changed ${key}`);
        }
        const signature = (entries) => JSON.stringify(entries.map(({ cx, cz, lod }) => ({ cx, cz, lod })).sort((a, b) => a.cx - b.cx || a.cz - b.cz));
        if (signature(scene.residency) !== signature(replay.scene.residency)) throw new CaptureError('saved scene replay changed residency keys or LODs');
        const expected = replay.scene.cameraMatrices ?? (await callApp(page, 'expectedCaptureMatrices', replay.scene)).value;
        if (JSON.stringify(scene.cameraMatrices) !== JSON.stringify(expected)) throw new CaptureError('saved scene replay changed the renderer view or projection matrices');
      }
      const localDetail = await page.evaluate((subjects) => subjects.map((s) => ({
        ...s, bakedLod: window.__syzygy.chunkLod(...s.chunk),
      })), hero.source.subjects);
      if (localDetail.some((s) => s.bakedLod !== 0)) throw new CaptureError(`hero foreground lacks full detail: ${JSON.stringify(localDetail)}`);
      const shared = (s) => JSON.stringify({ ...s, weather: { ...s.weather, sky: null } });
      const frozen = shared(scene);
      writeFileSync(join(dir, '_scene.json'), JSON.stringify({ hero, scene, localDetail,
        replayedFrom: opts.scene,
        matrixAuthority: replay?.scene.cameraMatrices ? 'saved submitted renderer matrices' : replay ? 'expectation derived from the saved physical-pose interpretation and held lens; historical matrix readback unavailable' : 'submitted renderer matrices',
        provenanceLimit: 'Subjects use actual bake emission records; their named centres are not raw surface readback. Gap segmentation is inferred from emitted slots. Exposure is a frame judgement.' }, null, 2));
      for (const phase of ['noon', 'night']) {
        const startSubmitted = (await callApp(page, 'submittedFrames')).value;
        const cr = await callApp(page, 'capturePhase', phase, scene);
        if (!cr.ok) throw new CaptureError(`capturePhase: ${cr.error}`);
        await page.waitForFunction((start) => window.__syzygy.submittedFrames() >= start + 8, startSubmitted, { timeout: 15000 });
        const heldScene = (await callApp(page, 'captureScene')).value;
        if (shared(heldScene) !== frozen) throw new CaptureError('Controlled hero scene changed between phases');
        const stats = (await callApp(page, 'stats')).value;
        const held = stats.camera;
        const dp = Math.hypot(...sub(held.position, hero.position));
        const hf = norm(sub(held.lookAt, held.position));
        const rf = norm(sub(hero.lookAt, hero.position));
        const angle = Math.acos(Math.max(-1, Math.min(1, hf.reduce((n, v, i) => n + v * rf[i], 0)))) * 180 / Math.PI;
        if (dp > POSITION_TOLERANCE_M || angle > DIRECTION_TOLERANCE_DEG) throw new CaptureError(`hero camera drift: ${dp}m/${angle}deg`);
        const name = `10-hero-walk-${phase === 'noon' ? 'day' : 'night'}`;
        const file = `shots/${runStamp}/${name}.png`;
        if (!await shoot(page, join(ROOT, file))) throw new CaptureError(`hero ${phase} screenshot missing`);
        results.push({ name, file, stats, requested: hero, label: 'Market Spine Counter Walk, frozen pair' });
        say(`    ✓ ${name} camera ${dp.toFixed(3)}m/${angle.toFixed(3)}deg; ${localDetail.length} subjects LOD 0`);
      }
      opts.sequence = true;
      writeIndex(runStamp, results, notes, opts);
    } else if (opts.eval !== null) {
      const out = await page.evaluate(async (expr) => {
        try {
          // eslint-disable-next-line no-new-func
          const v = await new Function(`return (async () => (${expr}))()`)();
          return { ok: true, value: v === undefined ? null : v };
        } catch (err) {
          return { ok: false, error: String(err?.message || err) };
        }
      }, opts.eval);
      say(`\n  eval: ${opts.eval}`);
      say(`  result: ${JSON.stringify(out.ok ? out.value : { error: out.error }, null, 2)}\n`);
      if (!out.ok) { failed = true; notes.push(`eval threw: ${out.error}`); }
    } else if (opts.sequence) {
      // ---- curated sequence
      const dir = join(SHOTS, runStamp);
      mkdirSync(dir, { recursive: true });
      say(`  shots     ${POSES.length} poses -> shots/${runStamp}/`);

      let wanted = opts.poses.length ? POSES.filter((p) => opts.poses.some((w) => p.name.includes(w))) : POSES;
      if (opts.debugseq) {
        // One pose, every debug view, one run — strictly comparable, and it
        // rules out "the textures were empty that time" as an explanation.
        const pose = wanted[0];
        await callApp(page, 'setPose', { ...pose, name: pose.name }).catch((e) => say(`    ! setPose: ${e.message}`));
        await warmPose(page, opts.poseChunks, opts.warmTicks);
        await settle(page, pose.settle ?? 30);
        for (const mode of [0, 1, 2, 3, 4, 5]) {
          await callApp(page, 'setDebug', mode).catch(() => {});
          await settle(page, 3);
          const out = join(SHOTS, runStamp, `dbg-${mode}-${pose.name}.png`);
          await shoot(page, out);
          const names = ['full composite', 'resolved only', 'bloom only', 'dof only', 'tonemap no warp', 'no tonemap'];
          const r = await page.evaluate(async () => {
            const c = await window.__syzygy.capture();
            return c.length;
          }).catch(() => 0);
          say(`    ✓ dbg-${mode}  ${names[mode]}  (${(r / 1365).toFixed(0)}kB png)`);
          results.push({ name: `dbg-${mode}`, file: out });
        }
        await callApp(page, 'setDebug', 0).catch(() => {});
        wanted = [];
      }
      for (const pose of wanted) {
        const at = Date.now();
        try {
          // ORDER MATTERS, and it was wrong.
          //
          // `setWeather` is the only path that calls `weather.snap()`, and
          // `snap()` is what writes the director's resolved TARGETS into
          // `world`. `setTime` re-resolves those targets for the named phase but
          // does not write them — it only steers. So with the old order
          // (weather, lens, time) the snap happened against the PREVIOUS pose's
          // weather and the phase was then left to ease in over the settle
          // frames.
          //
          // Measured consequence: a `time: 'noon'` pose rendered as a dim blue
          // frame, and reading `stats()` mid-settle gave exposure 1.09 /
          // ambientIntensity 0.51 / sunIntensity 3.25 — mid-morning values in a
          // frame labelled noon. It looked like a plausible dark city and it was
          // a transition frame, which is the failure this project keeps paying
          // for: correct-looking output, wrong subject.
          //
          // So: setTime FIRST (resolve the phase), then setWeather (snap it into
          // the world), then setLens (the pose's explicit lens overrides). A
          // second snap after the lens would undo the lens, so it does not go
          // there.
          if (pose.time) await callApp(page, 'setTime', pose.time);
          if (pose.weather) {
            const r = await callApp(page, 'setWeather', pose.weather);
            if (!r.ok && !r.skipped) throw new Error(`setWeather: ${r.error}`);
          }
          if (pose.lens) await callApp(page, 'setLens', pose.lens);

          // A derived pose carries no coordinates: the app computes them from
          // live state and hands back the same numbers the renderer will use.
          const pr = await callApp(page, 'setPose', {
            position: pose.position, lookAt: pose.lookAt, fov: pose.fov, roll: pose.roll,
            derive: pose.derive, name: pose.name,
          });
          if (!pr.ok) throw new Error(pr.skipped ? pr.reason : `setPose: ${pr.error}`);
          await applyPoseCrowd(page, pose);

          // Warm AFTER the pose is set. A chunk's LOD comes from the live camera
          // position, so warming before would bake the wrong detail levels and
          // leave the capture quietly low-detail.
          const warm = await warmPose(page, opts.poseChunks, opts.warmTicks);
          const warmMs = warm ? warm.ms : 0;

          const settled = await settle(page, pose.settle ?? 24);

          // REQUESTED vs HELD. A pose that was asked for is not yet a pose that
          // was rendered: `setPose` writes yaw/pitch/fov into a camera that
          // damps and biases them, and the capture then settles for frames during
          // which the pose keeps moving. Round 11's pool measurement recorded this
          // as a prose caveat after the fact, because a human noticed the sidecar
          // disagree with the request.
          //
          // So it is checked here, on every frame, and it fails the run. The
          // tolerances are the camera's own settle budget, not a guess: fov is
          // deliberately biased by `speedFov`, and position rises to a cruise
          // height, so an exact match would fail every flying pose. 0.5 m of
          // position, 0.02 rad (~1.1 degrees) of view direction and 0.02 of fov
          // are well inside what a settle produces and well outside a wrong pose.
          const held = await page.evaluate(() => {
            const s = window.__syzygy?.stats?.();
            return s ? s.camera : null;
          });
          if (held && pose.position) {
            const dp = Math.hypot(
              held.position[0] - pose.position[0],
              held.position[1] - pose.position[1],
              held.position[2] - pose.position[2]);
            // View DIRECTION, not fov. `FlightCamera` deliberately biases fov with
            // `speedFov` — measured at 0.8 requested and 0.991 held on
            // 04-canal-level, a 24% widening that is a designed feature of the
            // camera, not a pose that failed to apply. Comparing fov rejects
            // correct frames for being correct.
            //
            // What "the pose applied" means is where the camera STANDS and what it
            // LOOKS AT. `stats().camera.lookAt` is `position + forward * 400`, so
            // the angle between (held.pos -> held.ray) and (requested.pos ->
            // requested.lookAt) is the direction the frame was taken in.
            let dAngle = 0;
            if (pose.lookAt) {
              // `stats().camera.lookAt` is the 400m ray point; the provenance
              // alias `viewRayPoint400m` is only in the sidecar, not here.
              const rf = norm(sub(held.lookAt, held.position));
              const qf = norm(sub(pose.lookAt, pose.position));
              dAngle = Math.acos(Math.max(-1, Math.min(1, rf[0] * qf[0] + rf[1] * qf[1] + rf[2] * qf[2]))) * 180 / Math.PI;
            }
            if (dp > POSITION_TOLERANCE_M || dAngle > DIRECTION_TOLERANCE_DEG) {
              throw new Error(
                `pose "${pose.name}": renderer held a different camera than requested ` +
                `(position off by ${dp.toFixed(2)}m, view direction off by ${dAngle.toFixed(2)} deg). ` +
                `requested pos ${JSON.stringify(pose.position)} lookAt ${JSON.stringify(pose.lookAt)}; ` +
                `held pos ${JSON.stringify(held.position)}. ` +
                `The frame would not be the frame that was asked for.`);
            }
          }

          const file = join(dir, `${pose.name}.png`);
          const ok = await shoot(page, file);
          if (!ok) throw new Error('screenshot produced no file');

          if (opts.debug) await callApp(page, 'setDebug', opts.debug).catch(() => {});
          const stats = await page.evaluate(() => (typeof window.__syzygy?.stats === 'function' ? window.__syzygy.stats() : null)).catch(() => null);
          // Print the counter next to the shot. "Looks fine" and "twelve
          // pedestrians were submitted" are different claims, and only one of
          // them is checkable from the console.
          // Rule 5: a name with nothing behind it is a name that lies. If the
          // draw list carries no pedestrian entry, say what *is* known -- the
          // instance count and the visible count -- rather than printing `?`,
          // which is unreadable and unactionable. `crowdTotal` is a phantom: it
          // does not exist in src/, tools/, server/ or latest.json.
          const pedEntry = stats?.entityDraws?.find((d) => d.startsWith('pedestrian:'));
          const ped = pedEntry
            ?? `pedestrian:${stats?.crowd ?? 0}/visible:${stats?.trafficDraw ? 'n/a' : 'n/a'}`;
          results.push({
            name: pose.name, label: pose.label, file: `shots/${runStamp}/${pose.name}.png`,
            ms: Date.now() - at, warmMs, stats,
            requested: {
              position: pose.position ?? null, lookAt: pose.lookAt ?? null,
              fov: pose.fov ?? null,
            },
          });
          say(`    ✓ ${pose.name.padEnd(18)} ${String(Date.now() - at).padStart(5)}ms` +
            `${warm ? ` (warm ${warm.ms}ms ${warm.residentChunks}/${warm.target} ${warm.stopped})` : ''}` +
            `${settled.paced ? '' : ' [UNPACED]'}  ${ped}`);
          if (stats?.derivedPose?.ok) {
            const d = stats.derivedPose.source;
            say(`      └ standing at ${d.carriageway.kind} ${d.carriageway.width}m wide, ` +
              `${d.footwayOffset}m off the centreline, ${d.distanceToCrowd}m from the crowd centroid ` +
              `(${d.population.cx}, ${d.population.cz}) n=${d.population.n}`);
            // Rule 4 as a mechanical check, not a habit. A crowd diagnostic whose
            // camera ended up far from the crowd is a diagnostic that lies by
            // position, which is how `01b-crowd-closeup` spent two sessions.
            if (/crowd/.test(pose.name) && d.distanceToCrowd > 60) {
              const m = `!! ${pose.name}: camera is ${d.distanceToCrowd}m from the crowd centroid — too far to be a crowd diagnostic`;
              say(`      ${m}`);
              notes.push(m);
            }
          }
        } catch (err) {
          failed = true;
          results.push({ name: pose.name, label: pose.label, error: String(err?.message || err) });
          say(`    ✗ ${pose.name.padEnd(18)} ${String(err?.message || err).split('\n')[0]}`);
        }
      }

      const sheet = await contactSheet(dir, join(dir, '_contact-sheet.png'));
      if (sheet) { say(`    · contact sheet -> shots/${runStamp}/_contact-sheet.png`); results.push({ name: '_contact-sheet', file: `shots/${runStamp}/_contact-sheet.png` }); }
      else notes.push('ffmpeg unavailable — no contact sheet');

      writeIndex(runStamp, results, notes, opts);
    } else {
      // ---- single shot
      //
      // `--pose=<substr>` selects a pose. This branch used to ignore that
      // selection entirely: it warmed, settled and shot whatever the free camera
      // happened to be doing, recorded `requested: null`, and printed a PASS.
      //
      // That is the worst failure mode in this tool, because `--pose=canyon` is
      // the command AGENTS.md, README.md and PROCEDURES.md all document as "one
      // shot". Measured consequence: `--pose=09-market-down`, a pose defined at
      // [1.16, 2.6, 0.36] at eye height looking down a market aisle, rendered a
      // rooftop vista from 444 m up at [1058, 444, 337]. The requested-vs-held
      // check exists precisely to fail that run, and it lives only in the
      // sequence loop, so it never ran. Two frames were spent discovering this.
      //
      // So: resolve the pose, apply it, and run the SAME held-camera check the
      // sequence branch runs. A single shot is the cheaper diagnostic, not the
      // unchecked one.
      // An exact name wins over a substring match. `--pose=09-market-down` is
      // the name of one pose and a substring of two (`09-market-down-day` exists
      // as its daylight control), and silently shooting both, or the wrong one,
      // would make a single-shot diagnostic into something it is not.
      const wanted = opts.poses.length
        ? (() => {
          const exact = POSES.filter((p) => opts.poses.some((w) => w === p.name));
          if (exact.length) return exact;
          return POSES.filter((p) => opts.poses.some((w) => p.name.includes(w)));
        })()
        : [];
      if (opts.poses.length && wanted.length === 0) {
        throw new CaptureError(
          `--pose=${opts.poses.join(',')} matched no pose in the table. ` +
          `Available: ${POSES.map((p) => p.name).join(', ')}`);
      }
      if (wanted.length > 1) {
        throw new CaptureError(
          `--pose matched ${wanted.length} poses (${wanted.map((p) => p.name).join(', ')}). ` +
          `A single shot needs one; pass --sequence to shoot several, or narrow the substring.`);
      }
      const pose = wanted[0] ?? null;
      if (pose) {
        // Order matters and is load-bearing: setTime resolves the phase,
        // setWeather snaps it into the world, setLens applies the pose's explicit
        // overrides. A second snap after the lens would undo the lens.
        //
        // This was missing here, so `--pose=09-market-down` — a NIGHT pose — shot
        // dayPhase 0.707 under a clear sky at exposure 0.92, which are the day
        // control's values. The frame came back labelled "night" and was not
        // night. Same failure class as the ignored pose: correct-looking output,
        // wrong subject.
        if (pose.time) await callApp(page, 'setTime', pose.time);
        if (pose.weather) {
          const r = await callApp(page, 'setWeather', pose.weather);
          if (!r.ok && !r.skipped) throw new CaptureError(`setWeather: ${r.error}`);
        }
        if (pose.lens) await callApp(page, 'setLens', pose.lens);

        const pr = await callApp(page, 'setPose', { ...pose, name: pose.name })
          .catch((e) => ({ ok: false, error: e.message }));
        if (pr?.skipped) throw new CaptureError(`setPose skipped: ${pr.reason}`);
        if (pr && pr.ok === false) throw new CaptureError(`setPose: ${pr.error}`);
        await applyPoseCrowd(page, pose);
      }
      const file = join(SHOTS, `${runStamp}${pose ? `-${pose.name}` : ''}.png`);
      await warmPose(page, opts.poseChunks, opts.warmTicks);
      await settle(page, pose?.settle ?? 45);

      // Rule 4 as a mechanical check, in the branch that had none. Same
      // tolerances and same reasoning as the sequence loop above; if the camera
      // ends up somewhere else, this frame is not the frame that was asked for
      // and saying PASS would be a lie.
      if (pose?.position) {
        const held = await page.evaluate(() => window.__syzygy?.stats?.()?.camera ?? null).catch(() => null);
        if (!held) {
          throw new CaptureError(
            `pose "${pose.name}": the app reported no camera, so there is nothing to check ` +
            `the frame against. Refusing to write a picture whose camera is unknown.`);
        }
        const dp = Math.hypot(
          held.position[0] - pose.position[0],
          held.position[1] - pose.position[1],
          held.position[2] - pose.position[2]);
        let dAngle = 0;
        if (pose.lookAt) {
          const rf = norm(sub(held.lookAt, held.position));
          const qf = norm(sub(pose.lookAt, pose.position));
          dAngle = Math.acos(Math.max(-1, Math.min(1,
            rf[0] * qf[0] + rf[1] * qf[1] + rf[2] * qf[2]))) * 180 / Math.PI;
        }
        if (dp > POSITION_TOLERANCE_M || dAngle > DIRECTION_TOLERANCE_DEG) {
          throw new CaptureError(
            `pose "${pose.name}": renderer held a different camera than requested ` +
            `(position off by ${dp.toFixed(2)}m, view direction off by ${dAngle.toFixed(2)} deg). ` +
            `requested pos ${JSON.stringify(pose.position)} lookAt ${JSON.stringify(pose.lookAt)}; ` +
            `held pos ${JSON.stringify(held.position)}. ` +
            `The frame would not be the frame that was asked for.`);
        }
      }

      const ok = await shoot(page, file);
      if (!ok) throw new CaptureError('screenshot produced no file');
      const stats = await page.evaluate(() => (typeof window.__syzygy?.stats === 'function' ? window.__syzygy.stats() : null)).catch(() => null);
      // What the app actually derived and is currently holding, if any.
      const derived = stats?.derivedPose ?? null;
      const derivedPos = derived?.ok ? derived.position : null;
      const derivedLook = derived?.ok ? derived.lookAt : null;
      const derivedFov = derived?.ok ? derived.fov : null;
      results.push({
        name: pose ? pose.name : runStamp,
        label: pose?.label ?? null,
        file: `shots/${runStamp}${pose ? `-${pose.name}` : ''}.png`,
        stats,
        // `pose.position` is a static config value and is null for every DERIVED
        // pose (the 01d/01e/01f family is computed at runtime), so recording it
        // wrote `requested: {position: null}` and the check below could not fail.
        // Record what was actually derived instead, and say which it was.
        requested: pose ? {
          position: pose.position ?? derivedPos, lookAt: pose.lookAt ?? derivedLook,
          fov: pose.fov ?? derivedFov ?? null,
          derived: pose.position == null && derivedPos != null,
          // A derived pose is computed once, from a population that is usually
          // still filling. By capture time that crowd has moved, so the
          // derivation-time population is a number about a crowd that no longer
          // exists. Record both so the guard cannot read as a working one.
          populationAtDerivation: derived?.source?.population ?? null,
          populationAtCapture: stats?.pop ?? null,
        } : null,
      });
      writeIndex(runStamp, results, notes, opts);
      say(`\n  shot      ${results[results.length - 1].file}`);
      if (pose) {
        // Restate the camera agreement here rather than only on failure. The
        // check is cheap, and printing "view off by 0.00 deg" next to the frame
        // is what makes a reader trust the frame without re-deriving it.
        const hp = stats?.camera?.position;
        const want = pose.position ?? derivedPos;
        const d = (hp && want) ? Math.hypot(
          hp[0] - want[0], hp[1] - want[1], hp[2] - want[2]) : null;
        // A derived pose with no live derivation is the case this used to miss
        // entirely: `heldDerivedPose()` returns null once the camera has drifted
        // off the pose it was derived for, and that is exactly when the frame is
        // no longer the frame the pose describes. Fail rather than pass quietly.
        if (pose.position == null && derivedPos == null) {
          throw new CaptureError(
            `pose ${pose.name} is derived, but no live derivedPose was reported: ` +
            `the camera is not held at any pose derived from the crowd.`);
        }
        const src = pose.position == null ? 'derived' : 'requested';
        say(`  pose      ${pose.name}` +
          (d === null ? '  (no position to check against)'
                      : `  (camera ${d.toFixed(2)}m from ${src}, within ${POSITION_TOLERANCE_M}m)`));
      }
      if (stats) say(`  stats     ${JSON.stringify(stats)}`);
    }

    if (pageErrors.length) notes.push(`page errors: ${pageErrors.slice(0, 3).join(' | ')}`);

    if (!opts.keepOpen) await ctx.close().catch(() => {});
  } catch (err) {
    failed = true;
    const msg = err instanceof CaptureError ? err.message : `${err?.name || 'Error'}: ${String(err?.message || err).split('\n')[0]}`;
    notes.push(msg);
    process.stderr.write(`\nFAIL  ${msg}\n`);
  } finally {
    try { await browser?.close(); } catch { /* noop */ }
  }

  // ---- summary
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  // Any GPU validation or WGSL compile error invalidates every screenshot in
  // the run — they will all be black or stale. Fail loudly instead of noting it
  // in the footer where it is easy to miss.
  const gpuErrors = notes.filter((n) => /webgpu|wgsl|ShaderModule|entry point/i.test(n));
  if (gpuErrors.length) {
    for (const g of gpuErrors) {
      say(`    !! ${g}`);
    }
    failed = true;
    notes.push(`run INVALIDATED by ${gpuErrors.length} GPU/shader error(s) — the shots above are not trustworthy`);
  }
  const okCount = results.filter((r) => !r.error).length;
  say('');
  say('─'.repeat(64));
  if (failed) {
    say(`  FAIL   ${okCount}/${results.length || 1} shot(s) · ${secs}s`);
    for (const n of notes) say(`    · ${String(n).split('\n').join('\n      ')}`);
  } else {
    say(`  PASS   ${okCount} shot(s) · ${secs}s`);
    for (const n of notes) say(`    · ${n}`);
  }
  say('─'.repeat(64));

  clearTimeout(watchdog);
  stopServer(server?.child);
  return failed ? 1 : 0;
}

/** Per-shot provenance sidecar. See the note in `writeIndex`. */
function provenance(r, req) {
  const s = r.stats || {};
  const cam = s.camera || {};
  return {
    // The seed a reviewer needs and cannot infer. It was 0 for an entire session
    // while every doc said 0x5e7a17, so it is now written next to the image it
    // belongs to rather than being something a reader has to reconstruct.
    seed: s.seed ?? null,
    tier: s.tier ?? null,
    camera: {
      position: cam.position ?? null,
      // A point on the view RAY, 400m ahead — `FlightCamera.lookTarget` is
      // `position + forward * 400`, not the look-at the pose requested. Named to
      // say so, because a reviewer comparing it to the pose they asked for would
      // otherwise conclude the camera went somewhere else.
      viewRayPoint400m: cam.lookAt ?? null,
      fov: cam.fov ?? null,
      // The pose table's own coordinates, so the record states both what was asked
      // for and what was rendered. A diff between them is a failed run, checked
      // per frame above; publishing them makes it checkable after the fact too.
      requested: req ?? null,
    },
    lodHistogram: s.lodHistogram ?? null,
    residentChunks: s.residentChunks ?? null,
    // The single most useful number for judging a night frame, and it was
    // missing from every frame of the presentation set. `stats.lights` is the
    // count handed to the binner; `lightDelivery.binned` is the same number under
    // a longer name, and both are published so a reviewer can cross-check rather
    // than trust.
    lights: s.lights ?? null,
    lightDelivery: s.lightDelivery ?? null,
    entity: {
      drawCalls: s.entityDrawCalls ?? null,
      triangles: s.entityTriangles ?? null,
      draws: s.entityDraws ?? null,
    },
    dayPhase: s.dayPhase ?? null,
    weather: s.phase ?? null,
  };
}

function writeIndex(runStamp, results, notes, opts) {
  const stats = {};
  for (const r of results) if (r.stats && typeof r.stats === 'object') stats[r.name] = r.stats;
  const payload = {
    stamp: runStamp,
    when: new Date().toISOString(),
    mode: opts.sequence ? 'sequence' : 'single',
    quality: opts.quality || null,
    url: BASE,
    // `provenance` on every shot, so the index answers "which world is this frame
    // from?" without anyone opening a console. A reviewer looking at a warm pool
    // needs the seed, the camera, the LOD histogram and the light delivery to
    // believe it; all four are here now and none of them were before.
    seed: DEFAULT_SEED,
    shots: results.map((r) => ({
      name: r.name, file: r.file ?? null, ms: r.ms ?? null,
      label: r.label ?? null, error: r.error ?? null,
      ...(r.stats ? { provenance: provenance(r, r.requested) } : {}),
    })),
    stats,
    notes,
  };
  const json = JSON.stringify(payload, null, 2);
  writeFileSync(join(SHOTS, 'latest.json'), json, 'utf8');
  if (opts.sequence) writeFileSync(join(SHOTS, runStamp, '_capture.json'), json, 'utf8');
}

process.exit(await main().catch((err) => {
  process.stderr.write(`\nFAIL  ${err?.message || err}\n`);
  return 1;
}));
