/**
 * Shadow-cascade policy.
 *
 * Pure maths, no GPU types, no browser globals: this module is imported by the
 * renderer and by `src/render/__perftest.ts` alike, so the test exercises the
 * renderer's actual policy instead of a copy of it. A three.js or WebGL2 port
 * wants the same cascade set-up expressed as a table of distance splits and a
 * resolution, and this is that table with the maths attached.
 */

import { m4lookAt, v3cross, v3norm, type Mat4, type Vec3 } from '../core/math';

/** World up. Shadow boxes cannot use the camera's up; roll would rotate them. */
const UP: Vec3 = [0, 1, 0];
/** Fallback up for a sun within 2 degrees of straight up, where the cross degenerates. */
const UP_ALT: Vec3 = [0, 0, 1];

/** Cascade distance splits in metres. Four cascades. Also uploaded as a uniform. */
export const CASCADE_SPLITS = [45, 160, 520, 1900];

function v3scaleAdd(base: Vec3, dir: Vec3, s: number): Vec3 {
  return [base[0] + dir[0] * s, base[1] + dir[1] * s, base[2] + dir[2] * s];
}

/** Right-handed orthographic projection mapping near to 0 and far to 1. */
export function m4ortho(
  out: Mat4, l: number, r: number, b: number, t: number, n: number, f: number,
): Mat4 {
  out.fill(0);
  out[0] = 2 / (r - l);
  out[5] = 2 / (t - b);
  out[10] = 1 / (n - f);
  out[12] = -(r + l) / (r - l);
  out[13] = -(t + b) / (t - b);
  out[14] = n / (n - f);
  out[15] = 1;
  return out;
}

/** One cascade's light-space box, as pure data. */
export interface CascadeBox {
  centre: Vec3;
  radius: number;
  eye: Vec3;
  up: Vec3;
  lightView: Mat4;
  left: number; right: number; bottom: number; top: number;
  /** Metres of world covered by one shadow-map texel. */
  texelWorld: number;
}

/**
 * Build one cascade's light-space box.
 *
 * The box is a conservative bounding sphere around the camera's view of the
 * [near, far] distance range. It is deliberately slack in all three axes rather
 * than being the camera frustum's slab: a caster sitting outside the camera's
 * slice of the world can still cast a shadow into it, and a tight slab drops
 * those shadows silently. A comment here used to claim "frustum slab"; it was
 * wrong, and it has been corrected above.
 *
 * A second comment here used to claim the centre was "snapped to texel
 * increments to stop shimmer". It was not, and it has been deleted rather than
 * implemented, for a reason worth recording:
 *
 *   `m4lookAt(eye, centre, up)` puts its target at the light-space origin, so
 *   the box centre's light-space x and y are *identically zero* for any camera
 *   position. Snapping them is a no-op. An implementation that appeared to work
 *   (moving the ortho extents off zero) still leaves the box static in its own
 *   map frame, which is the thing snapping exists to prevent.
 *
 *   Real snapping needs the light view to be a pure rotation with the position
 *   carried by the ortho extents, so the box centre has non-degenerate
 *   light-space coordinates to snap. That also forces the depth range to be
 *   derived from the light-space z extent rather than fixed at `radius * 4.2`,
 *   which interacts with the defect immediately below. Both belong to the same
 *   piece of work, not to a performance fix.
 *
 * KNOWN DEFECT, measured, not fixed here — see `src/render/__perftest.ts`:
 * the light view's depth axis is `lx`, which is perpendicular to the sun, not
 * `lz`, which points along it. The eye offset is `centre + lx * radius`, and
 * `m4lookAt` then derives its z axis from `eye - centre`. So the shadow map is
 * projected along a direction 65-114 degrees away from the sun. The line
 * `v3cross(lz, lx)` was clearly an attempt to re-orthogonalise the basis;
 * `v3cross` returns a new vector rather than mutating, so the result was
 * discarded and the line is dead. The one-line fix is to offset the eye along
 * `lz` instead of `lx`. It changes every shadow in the project and is a visual
 * change, so it is not being made inside a performance commit.
 */
export function cascadeParams(
  camPos: Vec3, camForward: Vec3, sun: Vec3, near: number, far: number, shadowRes: number,
): CascadeBox {
  const centre = v3scaleAdd(camPos, camForward, (near + far) * 0.5);
  const radius = (far - near) * 0.62 + 40;
  const up: Vec3 = Math.abs(sun[1]) > 0.98 ? UP_ALT : UP;
  // See the KNOWN DEFECT note above: `lx` is not the sun axis and is being used
  // as the depth axis. Preserved deliberately so this commit changes no pixels.
  const lz = v3norm([
    centre[0] - sun[0] * radius * 2,
    centre[1] - sun[1] * radius * 2,
    centre[2] - sun[2] * radius * 2,
  ]);
  const lx = v3norm(v3cross(UP_ALT, lz));
  const eye: Vec3 = [
    centre[0] + lx[0] * radius,
    centre[1] + lx[1] * radius,
    centre[2] + lx[2] * radius,
  ];
  const lightView = m4lookAt(m4Alloc(), eye, centre, up);

  return {
    centre, radius, eye, up, lightView,
    texelWorld: (radius * 2) / shadowRes,
    left: -radius, right: radius, bottom: -radius, top: radius,
  };
}

function m4Alloc(): Mat4 {
  const m = new Float32Array(16) as Mat4;
  return m;
}

/** Compose a cascade's light view-projection. */
export function cascadeMatrix(box: CascadeBox): Mat4 {
  const lp = m4ortho(m4Alloc(), box.left, box.right, box.bottom, box.top, 0.1, box.radius * 4.2);
  const out = m4Alloc();
  // out = lp * lv, column-major.
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += lp[k * 4 + r] * box.lightView[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/**
 * Six world-space planes of an orthographic view-projection, normalised and
 * laid out for `sphereInFrustum`. Gribb-Hartmann plane extraction with the depth
 * range adapted: `m4ortho` here maps near to 0 and far to 1, so the near plane is
 * row 2 alone and the far plane is `row3 - row2` — the same reverse-Z
 * convention `camera.extractFrustum` uses.
 *
 * This is what lets a chunk be rejected per cascade instead of being submitted
 * to all four. Every cascade was previously handed the camera's frustum planes,
 * so a chunk 1500m away was submitted to the 45m cascade as well.
 */
export function extractOrthoFrustum(m: Mat4, out: Float32Array): void {
  const r0 = [m[0], m[4], m[8], m[12]];
  const r1 = [m[1], m[5], m[9], m[13]];
  const r2 = [m[2], m[6], m[10], m[14]];
  const r3 = [m[3], m[7], m[11], m[15]];
  const planes = [
    [r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]],   // left
    [r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]],   // right
    [r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]],   // bottom
    [r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]],   // top
    [r2[0], r2[1], r2[2], r2[3]],                                   // near, ndc z = 0
    [r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]],   // far, ndc z = 1
  ];
  for (let i = 0; i < 6; i++) {
    const p = planes[i];
    const l = Math.hypot(p[0], p[1], p[2]) || 1;
    out[i * 4 + 0] = p[0] / l;
    out[i * 4 + 1] = p[1] / l;
    out[i * 4 + 2] = p[2] / l;
    out[i * 4 + 3] = p[3] / l;
  }
}

/**
 * Sphere against six normalised planes. Inside when the plane signed distance is
 * never less than -r. Conservative: a sphere straddling a face is kept, which is
 * the entire reason a radius is used instead of a centre point.
 */
export function sphereInFrustum(planes: Float32Array, c: Vec3, r: number): boolean {
  for (let i = 0; i < 6; i++) {
    const o = i * 4;
    if (planes[o] * c[0] + planes[o + 1] * c[1] + planes[o + 2] * c[2] + planes[o + 3] < -r) {
      return false;
    }
  }
  return true;
}