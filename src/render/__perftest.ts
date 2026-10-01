/**
 * Performance self-test.
 *
 *   npx vite-node src/render/__perftest.ts
 *
 * This exists because the perf defects it guards against were all *silent*.
 * `stats.drawCalls` reported 30% of the truth for several sessions and every
 * number it printed looked reasonable. LOD was dead code with a fully
 * implemented parameter behind it. Both were greppable and both survived review,
 * which is the exact failure PROCESS.md rule 5 is about.
 *
 * So this asserts the properties that would have caught them:
 *
 *   1. Ortho plane extraction is correct, checked against points whose
 *      inside/outside status is known analytically — not against itself.
 *   2. Per-cascade culling is *conservative*: nothing a cascade's box contains
 *      is ever rejected. A too-tight box drops shadows and reads as a lighting
 *      bug, so this is the assertion that matters.
 *   3. The shadow depth axis, measured against the sun. Currently wrong, and
 *      the check is written to fail loudly when someone fixes it.
 *   4. LOD is not dead: the distance table must actually reduce triangles, and
 *      the tier table must be monotonic in detail.
 *
 * It imports the real `cascadeParams` / `extractOrthoFrustum` / `lodForDistance`
 * rather than copying them, so a change to the renderer's policy cannot leave
 * this test agreeing with a version that no longer exists. That is also why they
 * live in `cascade.ts` and `quality.ts` rather than inside `renderer.ts`: the
 * renderer touches `GPUShaderStage` at module scope and cannot be imported here.
 */

import rendererSrc from './renderer.ts?raw';
import lightbinWgsl from '../shaders/lightbin.wgsl?raw';
import gbufferWgsl from '../shaders/gbuffer.wgsl?raw';
import groundbakeSrc from './groundbake.ts?raw';
import mainTsSrc from '../main.ts?raw';
import stateTsSrc from '../core/state.ts?raw';
import harnessSrc from '../../tools/capture.mjs?raw';
import postWgsl from '../shaders/post.wgsl?raw';
import { City, defaultCityConfig } from '../world/citygen';
import { defaultWorld, sunDirection, type WorldState } from '../core/state';
import { FlightCamera } from '../camera/camera';
import { mat4 as m4, type Vec3 } from '../core/math';
import { bakeChunk } from './citymesh';
import {
  CASCADE_SPLITS, cascadeMatrix, cascadeParams, extractOrthoFrustum,
} from './cascade';
import { LOD_CHUNK_STEP, TIERS, lodForDistance } from './quality';

let failures = 0;
const lines: string[] = [];
const out = (s: string): void => { lines.push(s); };
const check = (ok: boolean, label: string, detail = ''): void => {
  if (!ok) failures++;
  out(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

// ---------------------------------------------------------------- helpers

/** The same sphere test the renderer uses, reimplemented so a bug is visible. */
function sphereIn(planes: Float32Array, c: Vec3, r: number): boolean {
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    if (planes[o] * c[0] + planes[o + 1] * c[1] + planes[o + 2] * c[2] + planes[o + 3] < -r) {
      return false;
    }
  }
  return true;
}

function planesOf(i: number): Float32Array {
  const pl = new Float32Array(24);
  extractOrthoFrustum(cascadeMatrix(boxes[i]), pl);
  return pl;
}

const SEED = 0x5e7a17;
const world: WorldState = defaultWorld(SEED);
const city = new City(defaultCityConfig(SEED));
const sun = sunDirection(world.sun);

// The reference pose every perf measurement in this repo is taken from.
const cam = new FlightCamera({ world, start: [0, 220, 520] });
cam.setPose({
  position: [900, 120, 1400] as never, lookAt: [0, 200, 0] as never, fov: 1.12, roll: 0,
});

const boxes = CASCADE_SPLITS.map((far, i) =>
  cascadeParams(cam.position, cam.forward, sun, i === 0 ? 0.1 : CASCADE_SPLITS[i - 1], far, 2048));

function run(): void {
  // ------------------------------------------------------------ 1. planes

  out('\northo plane extraction');

  {
    // An axis-aligned world-space box: identity view, plain ortho projection.
    // With an identity view the box spans z in [-f, -n], so z = 0 is in front of
    // the near plane and z = -5 is simply inside. Probing the near plane with a
    // point that is inside would pass for the wrong reason.
    const L = -30, R = 30, B = -10, T = 10, N = 1, F = 200;
    const planes = new Float32Array(24);
    // Plain axis-aligned orthographic projection, identity view.
    const mm = m4();
    mm.fill(0);
    mm[0] = 2 / (R - L); mm[5] = 2 / (T - B); mm[10] = 1 / (N - F);
    mm[12] = -(R + L) / (R - L); mm[13] = -(T + B) / (T - B);
    mm[14] = N / (N - F); mm[15] = 1;
    extractOrthoFrustum(mm, planes);

    check(sphereIn(planes, [0, 0, -100], 0), 'centre point is inside');
    check(sphereIn(planes, [L + 1, B + 1, -100], 0), 'inside near the -x-y corner');
    check(sphereIn(planes, [R - 1, T - 1, -100], 0), 'inside near the +x+y corner');
    check(!sphereIn(planes, [L - 5, 0, -100], 0), '5m beyond the left face is outside');
    check(!sphereIn(planes, [R + 5, 0, -100], 0), '5m beyond the right face is outside');
    check(!sphereIn(planes, [0, B - 5, -100], 0), '5m below the bottom face is outside');
    check(!sphereIn(planes, [0, T + 5, -100], 0), '5m above the top face is outside');
    check(sphereIn(planes, [0, 0, -5], 0), 'a point between near and far is inside');
    check(!sphereIn(planes, [0, 0, 0], 0), 'in front of the near plane is outside');
    check(!sphereIn(planes, [0, 0, 2], 0), 'well in front of the near plane is outside');
    check(!sphereIn(planes, [0, 0, -F - 5], 0), 'beyond the far plane is outside');
    // A sphere straddling a face must be kept: that is the entire reason a radius
    // is used rather than a centre point.
    check(sphereIn(planes, [L + 1, 0, -100], 2), 'sphere straddling the left face is kept');
    check(!sphereIn(planes, [L - 3, 0, -100], 2), 'sphere fully outside the left face is culled');
  }

  // ------------------------------------------------------------ 2. cascades

  out('\ncascade boxes (reference pose 01-wide-skyline)');

  for (let i = 0; i < boxes.length; i++) {
    check(boxes[i].radius > 0 && Number.isFinite(boxes[i].radius),
      `cascade ${i} radius is finite`,
      `r=${boxes[i].radius.toFixed(1)}m split=${CASCADE_SPLITS[i]}m`);
  }

  let monotonic = true;
  for (let i = 1; i < boxes.length; i++) {
    if (boxes[i].radius <= boxes[i - 1].radius) monotonic = false;
  }
  check(monotonic, 'cascade radius increases with cascade index',
    boxes.map((b) => b.radius.toFixed(0)).join(' < '));

  // The camera itself must lie inside cascade 0's box, or cascade 0 renders a
  // shadow map of somewhere else entirely.
  check(sphereIn(planesOf(0), cam.position, 0), 'camera is inside cascade 0');

  // The first split must be covered by cascade 1, or there is a band of world in
  // front of the camera that casts nothing at all.
  const fwd = cam.forward;
  const boundary: Vec3 = [
    cam.position[0] + fwd[0] * CASCADE_SPLITS[0],
    cam.position[1] + fwd[1] * CASCADE_SPLITS[0],
    cam.position[2] + fwd[2] * CASCADE_SPLITS[0],
  ];
  check(sphereIn(planesOf(1), boundary, 0), `camera + ${CASCADE_SPLITS[0]}m is inside cascade 1`);

  // Conservation: the box must contain the sphere it was built around. If this
  // fails, the per-cascade culling below is dropping shadow casters.
  let contained = true;
  for (let i = 0; i < boxes.length; i++) {
    if (!sphereIn(planesOf(i), boxes[i].centre, boxes[i].radius)) contained = false;
  }
  check(contained, 'each cascade box contains its own bounding sphere');

  // ---- per-cascade culling, measured on the real city. Predicted here and
  // checked against the GPU in the commit that introduced it.
  const cs = city.cfg.chunkSize;
  const pcx = Math.floor(cam.position[0] / cs);
  const pcz = Math.floor(cam.position[2] / cs);
  const r = 7; // 'high' tier viewDistance
  const chunks: { c: Vec3; rad: number }[] = [];
  for (let dz = -r; dz <= r; dz++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dz * dz > r * r + 1) continue;
      const c = city.getChunk(pcx + dx, pcz + dz);
      if (!c) continue;
      const b = bakeChunk(c, 0, SEED);
      chunks.push({
        c: [
          (b.boundsMin[0] + b.boundsMax[0]) * 0.5,
          (b.boundsMin[1] + b.boundsMax[1]) * 0.5,
          (b.boundsMin[2] + b.boundsMax[2]) * 0.5,
        ],
        rad: 0.5 * Math.hypot(
          b.boundsMax[0] - b.boundsMin[0],
          b.boundsMax[1] - b.boundsMin[1],
          b.boundsMax[2] - b.boundsMin[2]),
      });
    }
  }
  out(`        ${chunks.length} resident chunks in the test set`);
  out('        cascade   drawn   culled   reduction');
  let totalDrawn = 0;
  for (let i = 0; i < boxes.length; i++) {
    const pl = planesOf(i);
    let drawn = 0;
    for (const ch of chunks) if (sphereIn(pl, ch.c, ch.rad)) drawn++;
    totalDrawn += drawn;
    out(`        ${String(i).padEnd(8)} ${String(drawn).padStart(5)} ` +
      `${String(chunks.length - drawn).padStart(7)}   ` +
      `${(100 * (1 - drawn / chunks.length)).toFixed(1)}%`);
  }
  check(totalDrawn < chunks.length * boxes.length * 0.75,
    'per-cascade culling removes at least a quarter of the shadow submissions',
    `${totalDrawn} vs ${chunks.length * boxes.length} unculled`);

  // ------------------------------------------------------------ 3. depth axis

  out('\nshadow depth axis');

  {
    // A directional shadow map's depth axis must BE the sun direction. It was
    // not: `m4lookAt` derives its z axis from `eye - centre`, and the eye was
    // offset along `lx = cross(up, lz)`, which is perpendicular to the sun by
    // construction. Measured 65.7 deg off in cascade 0 and 114.3 deg off in
    // cascades 1-3 — not a subtle inaccuracy but a different set of occluders,
    // which is why anything standing in the open could be shadowed by whatever
    // lay between it and a sideways light.
    //
    // This assertion was deliberately inverted (asserting the DEFECT) so that it
    // would fail loudly the moment the basis was fixed, because that fix changes
    // every shadow in the project and needs a vision reviewer rather than a
    // silent merge. The eye is now on the sun side; this asserts the correct
    // behaviour. VISUAL CHANGE — see the commit.
    const angs = CASCADE_SPLITS.map((far, i) => {
      const b = cascadeParams(cam.position, cam.forward, sun,
        i === 0 ? 0.1 : CASCADE_SPLITS[i - 1], far, 2048);
      // Row 2 of a column-major matrix is (m[2], m[6], m[10]) — that is
      // `m4lookAt`'s z axis, the camera's +Z in world space, so forward is its
      // negation. This used to read (m[8], m[9], m[10]), which is the third
      // COLUMN and has no meaning as a direction: it is world +Z expressed in
      // camera space. Every "65.7 / 114.3 degrees off" number recorded against
      // this defect was therefore a measurement of the wrong vector, and the
      // eye offset it appeared to indict may never have been wrong at all.
      const f: Vec3 = [-b.lightView[2], -b.lightView[6], -b.lightView[10]];
      const dot = Math.max(-1, Math.min(1, f[0] * sun[0] + f[1] * sun[1] + f[2] * sun[2]));
      return Math.acos(dot) * 180 / Math.PI;
    });
    out(`        shadow-camera forward vs sun: ${angs.map((a) => a.toFixed(1) + ' deg').join(', ')}`);
    out('        correct for a directional light is 0 deg');
    check(angs.every((a) => a < 5),
      'shadow depth axis is not the sun axis',
      `worst ${Math.max(...angs).toFixed(1)} deg off; per cascade ${angs.map((a) => a.toFixed(1)).join('/')}`);

    // ------------------------------------------------------------------
    // PHANTOM GUARD. `weather2.y` (godRays) and `weather3.w` (precip) were both
    // written every frame for three sessions and read by nothing. A pose
    // carrying `godRays: 0.4` asserted an effect that did not exist, and
    // grep found the field, the writer and the pose — everything except the
    // consumer. That is the exact shape COVERAGE.md warns about.
    //
    // This is a static check and it is deliberately the unfashionable kind: it
    // reads the shader source and asserts the uniform is referenced. A renderer
    // cannot be imported here (it touches GPUShaderStage at module scope), the
    // pass needs a GPU to run, and a capture costs 24s. What this buys is that
    // deleting the read cannot merge quietly again, which is the failure mode
    // that actually happened three times.
    const shaderSrc = postWgsl;
    check(/F\.weather2\.y/.test(shaderSrc),
      'weather2.y (godRays) is consumed by a shader',
      'no shader reads it — the field is a PHANTOM again');
    const shaftEntry = /fn shafts\s*\(/.test(shaderSrc);
    check(shaftEntry, 'post.wgsl has a shafts entry point');
    // And it must be a real consumer, not a mention: the pass has to write the
    // marched accumulation into its output.
    check(/fn shafts[\s\S]*?return vec4f\(F\.sunColor/.test(shaderSrc),
      'the shafts pass returns the marched accumulation it computes');
    check(!/F\.weather3\.w/.test(shaderSrc),
      'weather3.w (precip) is still unconsumed',
      'expected: precip was deliberately NOT built this round');

    // ------------------------------------------------------------------
    // MARKET LIGHT DELIVERY — behavioural, and the reason this is here.
    //
    // 365 lanterns were produced by the market grammar, counted by a
    // self-test, and delivered to the frame as none of them. Nothing was red.
    // `bakeMarketDetail` draws the stalls and returns void; the lights the same
    // grammar harvested had nowhere to go, so `BakedChunk.lights` — which
    // exists, and which `gatherLights` already reads — stayed empty for the
    // whole market. The lanterns glowed and lit nothing.
    //
    // Every guard that could have caught that was a grep, and greps agreed:
    // the field existed, the writer existed, the counter existed, the selftest
    // passed. So this one bakes real chunks and asks the only question that
    // matters — does a chunk that the grammar lit come back with lights in it.
    // A rename, a moved call site, or a refactor that drops the loop fails
    // here, loudly, with a number.
    const mCity = new City(defaultCityConfig(SEED));
    let marketProduced = 0, marketDelivered = 0, marketChunks = 0;
    for (let cz = -3; cz <= 3 && marketChunks < 4; cz++) {
      for (let cx = -3; cx <= 3 && marketChunks < 4; cx++) {
        const mc = mCity.getChunk(cx, cz);
        if (!mc) continue;
        const b = bakeChunk(mc, 0, SEED);
        const ml = b.marketLights;
        if (!ml || ml.produced === 0) continue;
        marketChunks++;
        marketProduced += ml.produced;
        // Count the market's OWN lights, not `b.lights.length` — that array also
        // holds every building's window lights, so reading delivery off it is
        // how a market that delivers nothing can still look delivered.
        marketDelivered += ml.delivered;
        check(ml.delivered > 0,
          `market chunk (${cx},${cz}): ${ml.delivered}/${ml.produced} lanterns delivered ` +
          `over ${ml.traces} market carriageway(s)`,
          'grammar produced lanterns but the chunk delivered none of them');
      }
    }
    check(marketChunks > 0,
      'the test actually found a market chunk to assert on',
      'no chunk produced market lights, so the delivery assert above never ran');
    check(marketDelivered > 0,
      `market lanterns delivered to BakedChunk.lights: ${marketDelivered} of ${marketProduced} produced`,
      'zero delivered — this is the 365-lights-go-nowhere bug, back again');

    // ------------------------------------------------------------------
    // THE TILE-BIN CAPACITY TRAP. `tileBuf` was `16 * 16 * 400` bytes, which
    // looks like "a 16x16 grid of tiles" and is not: `TILE_DIM` in
    // lightbin.wgsl is a tile's side in PIXELS, so the grid is
    // `ceil(w/16) x ceil(h/16)` — 5700 bins at 1600x900. The buffer held 256.
    //
    // Both the binning pass and the lighting pass agreed with each other and
    // disagreed with the allocation, and out-of-bounds storage access is legal
    // WebGPU: stores are dropped, loads read zero. So most tiles got
    // `count == 0` and lit nothing, with no error anywhere.
    //
    // This is arithmetic rather than a GPU measurement — it is checkable by
    // reading two constants — so it belongs in the fast suite where it can
    // never be forgotten, rather than in a capture that costs 24s and might be
    // skipped.
    const BIN_BYTES = 400;   // array<atomic<u32>,96> + count + 3 pad
    check(BIN_BYTES === 96 * 4 + 4 + 12,
      'sizeof(Bin) in lightbin.wgsl is accounted for exactly',
      'the 400 constant no longer matches the WGSL struct — recheck the allocation');
    for (const [w, h, tier] of [[1600, 900, 'default'], [1200, 675, 'low'], [2160, 1215, 'ultra']] as const) {
      const need = Math.ceil(w / 16) * Math.ceil(h / 16);
      const needBytes = need * BIN_BYTES;
      check(needBytes > 256 * BIN_BYTES,
        `tier ${tier} (${w}x${h}) needs ${need} bins = ${(needBytes / 1e6).toFixed(2)} MB of tile bins`,
        'sanity: this suite assumed the grid outgrows the old 256-bin buffer');
    }
    // The real guard: the renderer must size the buffer FROM the resolution.
    const rsrc = rendererSrc;
    check(!/tileBuf = dev\.createBuffer\(\{[^}]*size:\s*16\s*\*\s*16/.test(rsrc),
      'tileBuf is no longer allocated from a hard-coded 16*16 tile count',
      'the tile buffer is sized by a literal again — it must derive from targetsW/H');
    check(/Math\.ceil\(this\.targetsW\s*\/\s*16\)/.test(rsrc) && /Math\.ceil\(this\.targetsH\s*\/\s*16\)/.test(rsrc),
      'the tile buffer size derives from the render-target resolution');

    // ------------------------------------------------------------------
    // THE LIGHT BUFFER STRIDE. This is the actual cause of the unlit market.
    //
    // `gatherLights` packed lights through `makeInstanceWriter`, which strides
    // 24 floats (a mat4), and then patched floats 12..15 and 19 of each record.
    // `lightbin.wgsl` reads `struct Light { posRadius: vec4f, colorInt: vec4f }`
    // — 8 floats. Light 0's position was written to byte 48 and the shader read
    // bytes 0..32, which held the identity matrix `pushStatic` had left there.
    //
    // The refusal was total and silent: `bin` skips any light whose
    // `colorInt.w <= 0`, and that is the intensity slot, so every light was
    // rejected, every bin was written with `count == 0`, and
    // `lighting.wgsl`'s per-pixel loop ran zero iterations for the whole frame.
    // `stats.lights` still read 219-3072, which is why delivery looked healthy.
    //
    // This asserts the layout contract from both ends — the WGSL struct and the
    // TS packing — rather than trusting that two files written months apart
    // agree about a byte offset.
    const rsrc2 = rendererSrc;
    check(/const LIGHT_FLOATS\s*=\s*8/.test(rsrc2),
      'the light buffer has its own 8-float stride constant',
      'no LIGHT_FLOATS — lights are packed at some other stride');
    check(!/pushStatic\(l\.color/.test(rsrc2),
      'gatherLights no longer packs lights through the instance writer',
      'lights are being packed at INSTANCE_FLOATS (96 B) for a 32 B shader struct');
    const lb = /label: 'lights', size: MAX_LIGHTS \* (\d+)/.exec(rsrc2);
    check(lb !== null && lb[1] === '32',
      'lightBuf is allocated 32 bytes per light, matching struct Light',
      'lightBuf allocation disagrees with the WGSL Light struct');
    // And the survival test the shader actually applies.
    const binSrc = lightbinWgsl;
    check(/colorInt\.w <= 0\.0/.test(binSrc),
      'the bin shader rejects on colorInt.w, which is the intensity slot',
      'the shader survival test changed — recheck which slot carries intensity');
    check(/posRadius\s*:\s*vec4f/.test(binSrc) && /colorInt\s*:\s*vec4f/.test(binSrc),
      'struct Light is two vec4f, i.e. 8 floats / 32 bytes');

    // ------------------------------------------------------------------
    // PAVEMENT JOINT WIDTH FLOOR. The review gate says slab joints "do not
    // survive sufficiently to establish close-focus material construction", and
    // the instinct is to raise joint contrast. That is the wrong lever: the
    // masks are 1.35-2.7cm wide in world units, which is ~1px at 21m and gone by
    // 30m, and a sub-pixel feature cannot be rescued by contrast. It has to be
    // rescued in SCREEN SPACE.
    //
    // This asserts the floor exists and that it scales with distance, because a
    // constant-width joint is the bug it replaces.
    const gb = gbufferWgsl;
    check(/fn jointFloor\(/.test(gb) && /fn groundJointsD\(/.test(gb),
      'paving has a distance-aware joint width, not a fixed world width',
      'groundJointsD is gone — joints are back to a constant 1.35-2.7cm and vanish past ~25m');
    check(/fn groundSurface\([^)]*dist: f32/.test(gb),
      'groundSurface receives the view distance its joint widths depend on');
    const calls = gb.match(/groundJointsD\(/g) ?? [];
    check(calls.length >= 5,
      `every paving family uses the floored joint (${calls.length - 1} call sites + the definition)`,
      'a family still calls the unfloored groundJoints — it will flatten with distance');
    check(!/joint = groundJoints\(/.test(gb),
      'no paving family is left on the unfloored joint width');
    // And the deck multiplier the brief blamed is NOT the cause — record that
    // so nobody goes looking for a 0.62 again.
    check(/let deckMul = select\(1\.0, 0\.82, dirtyRoad\)/.test(gb),
      'the deck multiplier is 1.0 for paving families (0.82 only for dirty road)',
      'deckMul changed — re-read §deckMul before attributing uniformity to it');

    // ------------------------------------------------------------------
    // THE BINNER MUST NOT WALK THE WHOLE LIGHT BUFFER.
    //
    // `lightBuf` is allocated for MAX_LIGHTS and the CPU uploads only what
    // gatherLights produced. `arrayLength(&lights)` is therefore 3072 every frame
    // regardless, and everything past the count is LAST frame's leftovers: still
    // non-zero, so still passing `colorInt.w <= 0`, so still binned. Measured at
    // a market pool centre: the bin named indices up to 385 with `stats.lights`
    // at 296, and all 74 lights it held were 140m away and outside their own
    // radius. A zeroed stale entry would be harmless; a real one from the
    // previous frame is binned and then evaluated against a pixel it no longer
    // belongs to, and its own radius says it should reach.
    const lb2 = lightbinWgsl;
    check(!/let n = arrayLength\(&lights\);/.test(lb2),
      'the binner does not walk arrayLength(&lights)',
      'it walks all MAX_LIGHTS entries and bins stale lights from previous frames');
    check(/let n = min\(u32\(F\.grade\.w\), arrayLength\(&lights\)\)/.test(lb2),
      'the binner bounds its walk by the packed light count in the frame uniform');
    // The count has to be in the uniform BEFORE it is written, which is why
    // gatherLights moved ahead of writeFrameUniforms.
    const rs3 = rendererSrc;
    const gi = rs3.indexOf('this.gatherLights(cam)');
    const wi = rs3.indexOf('this.writeFrameUniforms(cam)');
    check(gi > 0 && wi > 0 && gi < wi,
      'gatherLights runs before writeFrameUniforms, so grade.w carries this frame\'s count',
      'grade.w carries LAST frame\'s count and the binner lags by a frame');
    check(/put\(w\.lens\.colorGrade\[0\], w\.lens\.colorGrade\[1\], w\.lens\.colorGrade\[2\], this\.stats\.lights\)/.test(rs3),
      'grade.w is written from stats.lights, not a literal 0');
    // And grade.w must not be read as a colour anywhere.
    check(!/F\.grade\.w/.test(gb) && !/F\.grade\.w/.test(postWgsl),
      'no shader reads grade.w as a colour — it is free for the light count',
      'a shader now depends on grade.w, so it is no longer a spare slot');

    // ------------------------------------------------------------------
    // THE MARKET LIGHT BUDGET. Three separate defects, all silent, all of which
    // had to be true simultaneously for the aisle to be dark. Each is arithmetic
    // on chunk (0,-1), which carries the market spine.
    const gb2 = groundbakeSrc;
    // (a) per-trace spending against a per-chunk budget. The block runs once per
    // carriageway -- `traces: 5` measured -- so first-come meant one carriageway
    // took the whole budget and four took none.
    check(!/const perTrace = Math\.min\(MAX_MARKET_LIGHTS_PER_CHUNK/.test(gb2),
      'the market budget is not spent per trace against a per-chunk allowance',
      'per-trace spending is back: one carriageway takes the budget, the rest take nothing');
    check(/adjudicate the market's offered lights, once, for the whole chunk/.test(gb2),
      'market lights are adjudicated once per chunk, after all traces');
    // (b) ordering by distance to the CHUNK CENTRE. A 256m chunk's centre is 173m
    // from the market spine it contains, so this selected the far end of the
    // market every time: `dPool` 111-184m for the eight chosen, against 5.8-12.1m
    // for the lanterns actually over the aisle, and deck irradiance exactly 0.000.
    check(!/\bccx\b[\s\S]{0,300}pendingMarket\.length > 0[\s\S]{0,300}sort\(\(a, b\) => key\(a\) - key\(b\)\)/.test(gb2),
      'market lights are not ordered by distance to the chunk centre',
      'chunk-centre ordering selects the far end of the market -- see spineDistance');
    check(/function spineDistance\(/.test(gb2),
      'market lights are ordered along the market spine, recovered from the light set itself');
    // (c) the deterministic grammar re-derived per trace. Identical arguments
    // return an identical list, so 5 traces offered 240 entries of which 48 were
    // distinct: the budget was spent on copies and `dropped` counted each lantern
    // five times (measured `produced 240, delivered 24, dropped 216`).
    check(/marketSeenKeys\.has\(key\)/.test(gb2),
      'market lights are deduplicated by position across traces',
      'the deterministic grammar is being offered once per trace and the budget spent on copies');
    // And the budget itself: 24 slots for up to 240 offered lanterns, measured as
    // deck irradiance 0.000 at 24 against 1.197 at 48.
    check(/const maxLights = 48;/.test(gb2),
      'the per-chunk light budget is 48, not 24',
      'back to 24: measured deck irradiance at the market spine is exactly 0.000');

    // ------------------------------------------------------------------
    // THE SEED THE RENDERER ACTUALLY USES.
    //
    // `capture.mjs` USED to write `?seed=0x5e7a17` and `main.ts` reads it with
    // `Number.parseInt(q.get('seed') ?? '', 10)`. parseInt with an explicit radix
    // of 10 stops at the `x`: `parseInt('0x5e7a17', 10) === 0`. It is finite, so
    // the 0x5e7a17 default was never used and **every capture ran on seed 0**.
    //
    // This went unnoticed because seed 0 renders perfectly — it is a valid city,
    // it just is not the city every CPU-side probe was measuring. Round 9 aimed
    // a camera at a "market spine" at [1.16, 0, -9.97] that exists in seed
    // 0x5e7a17 and does not exist in seed 0, and the nearest market lantern to it
    // measured 47.5m away in the packed array. Nothing was broken; the
    // coordinate was from a different city.
    //
    // Asserted here rather than fixed because both halves are in files that are
    // not mine: `capture.mjs` and `main.ts`. What is mine is the assertion, so
    // the next person to read a capture knows the city is seed 0 unless the
    // parse changes.
    const mainSrc = mainTsSrc;
    check(/const int = \(k: string, d: number\)/.test(mainSrc) && /int\('seed', 0x5e7a17\)/.test(mainSrc),
      'main.ts parses the boot seed from the query string with a 0x5e7a17 default',
      'the boot-parsing block changed shape — re-derive which seed captures use');
    // The app side is radix 10 for every key, so the WRITER must be decimal.
    // If a hex seed ever appears again this is the assertion that catches it.
    check(!/seed=0x/.test(harnessSrc) && /DEFAULT_SEED/.test(harnessSrc),
      'the harness writes a decimal seed the radix-10 parser reads correctly');
    check(/Number\.parseInt\(q\.get\(k\)/.test(mainSrc),
      'the boot int() helper parses query values with parseInt, which is where the hex trap lives',
      'the boot parser changed — recheck the radix');

    // ------------------------------------------------------------------
    // AUTHORED LIGHTS MUST NOT BE CULLED BY A DAY SCALAR.
    //
    // `gatherLights` used to `if (byDay) continue`, where `byDay` is
    // `world.dayPhase > 0.55`. `dayPhase` is derived from a sun CLOCK
    // (`integrateWorld` advances `sun.azimuth` continuously) while `setTime`
    // sets a WEATHER phase once. Two sources of truth that disagree: a pose
    // named `night-lanterns` reported `produced 48, delivered 0,
    // culledByDay: true`, and developer 2 lost a measurement cycle to a night
    // frame with no lights in it.
    //
    // This is not a threshold problem. "Is the sun up" and "should an authored
    // light be visible" are different questions — a market lantern is a light
    // source and is visible at dusk, under overcast, and in a daylight canyon.
    const rs4 = rendererSrc;
    check(!/if \(byDay\) continue;/.test(rs4),
      'gatherLights does not cull authored lights by dayPhase',
      'the day cull is back — a night pose will report delivered 0 again');
    check(/const byDay = this\.world\.dayPhase > 0\.55/.test(rs4),
      'byDay is still computed, because stats.lightDelivery.culledByDay reports it',
      'the stat went away, and the field that caught this is the one to keep');
    check(/culledByDay: byDay/.test(rs4),
      'culledByDay is reported on the light-delivery stat');
    // And the two clocks must be visible as two clocks, not conflated.
    check(/w\.dayPhase = saturate\(\(w\.sun\.elevation \+ 0\.35\) \/ 1\.5\)/.test(stateTsSrc),
      'dayPhase is derived from sun elevation, which the sun clock advances',
      'the dayPhase derivation changed — re-read whether the weather and the clock agree');
    check(/w\.sun\.azimuth = \(w\.sun\.azimuth/.test(stateTsSrc),
      'sun.azimuth advances every tick, independent of the weather phase',
      'the sun clock stopped advancing — the two-clock disagreement may be gone');

    // ------------------------------------------------------------------
    // SEED ROUND-TRIP. The harness writes `?seed=0x5e7a17`; the app parses with
    // an explicit radix of 10, which stops at the `x` and yields 0.
    const expectedSeed = 0x5e7a17;
    // The harness must WRITE the decimal the app PARSES. Not the hex literal it
    // used to: `parseInt('0x5e7a17', 10)` is 0.
    check(/const DEFAULT_SEED = 0x5e7a17;/.test(harnessSrc),
      'the harness names the seed once, as DEFAULT_SEED',
      'the harness has no single seed constant — a second literal can drift again');
    check(/const q = \[`seed=\$\{DEFAULT_SEED\}`\]/.test(harnessSrc),
      'the harness writes seed=${DEFAULT_SEED} — decimal, which is what the app parses',
      "the harness writes something other than the constant; if it is 'seed=0x...' it parses to 0 again");
    check(!/seed=0x/.test(harnessSrc),
      'no 0x-prefixed seed is written into a query string the app parses with radix 10',
      'a hex seed in the query string parses to 0');
    // And the round trip itself, so the two sides are pinned together.
    const written = String(expectedSeed);
    check(Number.parseInt(written, 10) === expectedSeed,
      `the written seed ${written} round-trips to ${expectedSeed}`);

    // ------------------------------------------------------------------
    // ENTITY DRAWS MUST BE COUNTED WHERE THEY ARE ISSUED.
    //
    // `counter.entity` was incremented in `drawEntitySet` and nowhere else, and
    // `drawEntitySet` has no callers: the crowd and the fleet go through
    // `main.ts`'s own `drawEntityBlock`. So `entityDrawCalls` read 0 in every
    // capture while `entityTriangles` read hundreds of thousands — instances
    // uploaded, triangles counted, no draw call issued. It read as "counted, never
    // issued" and was taken, correctly, to be the cause of R1.
    //
    // It was not: `drawEntityBlock` returns `(indexCount/3) * count` only after
    // calling `pass.drawIndexed`, so a nonzero `entityTriangles` PROVES the draw
    // was issued. Measured 356480 triangles against 0 draw calls. The counter was
    // the lie.
    const rs5 = rendererSrc;
    // `counter.entity++` still exists, inside `drawEntitySet`, which currently has
    // no callers — main.ts's comments treat it as the pending migration target for
    // instance-offset draws. So the invariant is not "the increment is gone", it is
    // "no published field is sourced from it".
    check(!/s\.entityDrawCalls = c\.entity/.test(rs5) && !/s\.drawCalls = [^;]*c\.entity/.test(rs5),
      'no published field is sourced from the single-caller entity counter',
      'a published stat is reading counter.entity, which only drawEntitySet increments');
    check(/this\.counter\.entity\+\+/.test(rs5),
      'the dead drawEntitySet increment is still there and visible for the migration',
      'drawEntitySet was removed or altered — re-read before trusting the counter story');
    check(/s\.entityDrawCalls = issued/.test(rs5),
      'entityDrawCalls is counted from the entityDraws ledger both paths push to',
      'entityDrawCalls is not derived from the shared ledger');
    check(/if \(!e\.endsWith\(':0'\)\)/.test(rs5),
      "a ':0' entry (nothing submitted) is excluded from the draw count");
    check(!/s\.drawCalls = c\.shadow \+ c\.gbuffer \+ c\.post \+ c\.entity/.test(rs5),
      'drawCalls does not add the single-caller entity counter either',
      'drawCalls is short by every crowd and fleet draw — same bug one field over');
    check(/s\.triangles = c\.shadowTris \+ c\.gbufferTris \+ c\.postTris \+ c\.entityTris/.test(rs5),
      'triangle accounting is unchanged and still honest');

    // Whatever the axis is, the box must still be a square of the advertised
    // size, or the culling above is dropping casters.
    const b0 = boxes[0];
    check(Math.abs(b0.right - b0.left - 2 * b0.radius) < 1e-6 &&
      Math.abs(b0.top - b0.bottom - 2 * b0.radius) < 1e-6,
      'cascade box is a square of the advertised half-extent',
      `${(b0.right - b0.left).toFixed(2)}m wide, r=${b0.radius.toFixed(2)}m`);
    check(b0.texelWorld > 0 && b0.texelWorld < b0.radius,
      'a shadow texel is smaller than the box it covers',
      `${b0.texelWorld.toFixed(4)}m at 2048`);
  }

  // ------------------------------------------------------------ 4. LOD

  out('\nLOD policy');

  {
    check(Object.keys(TIERS).every((t) => (TIERS as Record<string, { lodRange: number[] }>)[t].lodRange),
      'every tier declares a lodRange');

    // potato and low are both [0,3]; ultra pins everything to 0.
    check(TIERS.potato.lodRange[1] > TIERS.ultra.lodRange[1],
      'coarser tiers allow a higher LOD',
      `potato<=${TIERS.potato.lodRange[1]} ultra<=${TIERS.ultra.lodRange[1]}`);

    check(lodForDistance(0, TIERS.ultra) === 0, 'the camera chunk is LOD 0 on ultra');
    check(lodForDistance(0, TIERS.potato) === 0, 'the camera chunk is LOD 0 on potato');
    check(lodForDistance(9, TIERS.ultra) === 0, 'ultra pins every chunk to LOD 0');
    check(lodForDistance(9, TIERS.potato) > lodForDistance(9, TIERS.ultra),
      'potato drops distant chunks below LOD 0');
    check(lodForDistance(1, TIERS.potato) === 0, 'the chunk you are in stays LOD 0 on potato',
      '1 chunk away');

    let clamped = true;
    for (let d = 0; d <= 12; d += 0.25) {
      const l = lodForDistance(d, TIERS.potato);
      if (l < 0 || l > TIERS.potato.lodRange[1] || !Number.isInteger(l)) clamped = false;
    }
    check(clamped, 'LOD is an integer inside the tier bound for every distance 0..12');
    check(LOD_CHUNK_STEP > 0, 'LOD distance step is positive', `${LOD_CHUNK_STEP} chunks`);

    // The payoff, measured on real chunks rather than asserted.
    out('        chunk     lod0     lod1     lod2    l1/l0    l2/l0');
    const r1: number[] = [];
    const r2: number[] = [];
    for (let i = 0; i < 6; i++) {
      const c = city.getChunk(i % 3, Math.floor(i / 3));
      if (!c) continue;
      const t = [0, 1, 2].map((lod) => {
        const b = bakeChunk(c, lod, SEED);
        return Math.round((b.opaque.indexCount + b.foliage.indexCount) / 3);
      });
      r1.push(t[1] / t[0]);
      r2.push(t[2] / t[0]);
      out(`        ${String(i).padEnd(7)} ${String(t[0]).padStart(7)} ` +
        `${String(t[1]).padStart(7)} ${String(t[2]).padStart(7)}  ` +
        `${(t[1] / t[0]).toFixed(3).padStart(6)}  ${(t[2] / t[0]).toFixed(3).padStart(6)}`);
    }
    const mean1 = r1.reduce((a, b) => a + b, 0) / r1.length;
    const mean2 = r2.reduce((a, b) => a + b, 0) / r2.length;
    check(mean1 < 0.6, 'LOD 1 is a real saving, not a rounding artefact',
      `mean ${(mean1 * 100).toFixed(1)}% of LOD 0 triangles`);
    check(mean2 < 0.3, 'LOD 2 is a real saving', `mean ${(mean2 * 100).toFixed(1)}% of LOD 0`);
    check(mean2 < mean1, 'LOD 2 is cheaper than LOD 1');
  }
}

// ---------------------------------------------------------------- entry

export function runPerfSelfTest(): string {
  failures = 0;
  lines.length = 0;
  run();
  lines.push('');
  lines.push(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  return lines.join('\n');
}

// A self-test you have to wrap in a temporary file to run is a self-test nobody
// runs. Make the documented command work.
const isMain = (): boolean => {
  const url = import.meta.url;
  return url.endsWith('__perftest.ts') || url.endsWith('__perftest.js');
};

if (isMain()) console.log(runPerfSelfTest());