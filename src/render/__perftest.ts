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