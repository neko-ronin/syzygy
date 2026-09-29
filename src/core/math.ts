/**
 * Compact math kernel. Column-major mat4 laid out to match WGSL's
 * `mat4x4<f32>` memory order, so buffers can be memcpy'd straight to the GPU.
 *
 * Convention: right-handed world, -Z forward in view space (WebGPU clip space),
 * +Y up. Perspective maps depth to [0,1] (not [-1,1]).
 */

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];
export type Mat4 = Float32Array;
export type Mat3 = Float32Array;

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const saturate = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix = lerp;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = saturate((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0: number, e1: number, x: number) => {
  const t = saturate((x - e0) / (e1 - e0 || 1e-9));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Frame-rate independent exponential approach. `rate` = fraction closed per second. */
export const damp = (a: number, b: number, rate: number, dt: number) =>
  b + (a - b) * Math.exp(-rate * dt);
export const remap = (x: number, a: number, b: number, c: number, d: number) =>
  c + ((x - a) / (b - a || 1e-9)) * (d - c);
export const fract = (x: number) => x - Math.floor(x);
export const sign = Math.sign;
export const signNZ = (x: number) => (x < 0 ? -1 : 1);
export const sqr = (x: number) => x * x;

// ---------------------------------------------------------------- vec3

export const v3 = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const v3add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const v3sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const v3mul = (a: Vec3, b: Vec3): Vec3 => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const v3scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const v3dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const v3cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const v3len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const v3len2 = (a: Vec3) => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
export const v3dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const v3dist2 = (a: Vec3, b: Vec3) => {
  const x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
  return x * x + y * y + z * z;
};
export const v3norm = (a: Vec3): Vec3 => {
  const l = v3len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};
export const v3lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t),
];
export const v3reflect = (i: Vec3, n: Vec3): Vec3 => {
  const d = 2 * v3dot(i, n);
  return [i[0] - n[0] * d, i[1] - n[1] * d, i[2] - n[2] * d];
};
/** Any unit vector perpendicular to `a` (branchless, stable). */
export const v3perp = (a: Vec3): Vec3 => {
  const s = a[2] >= 0 ? 1 : -1;
  const t = -1 / (s + a[2]);
  const b = a[0] * a[0] * t;
  return v3norm([1 + s * b, s * b, -s * a[0]]);
};

// ---------------------------------------------------------------- mat4

export const mat4 = (): Mat4 => new Float32Array(16);
export const mat4identity = (out: Mat4 = mat4()): Mat4 => {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
};
export const m4copy = (a: Mat4): Mat4 => new Float32Array(a);

export function m4mul(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  for (let i = 0; i < 4; i++) {
    const b0 = b[i * 4], b1 = b[i * 4 + 1], b2 = b[i * 4 + 2], b3 = b[i * 4 + 3];
    out[i * 4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[i * 4 + 1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[i * 4 + 2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[i * 4 + 3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  }
  return out;
}

/** Reverse-Z infinite-ish perspective. near maps to 1, far to 0. Much better depth precision. */
export function m4perspectiveReverseZ(
  out: Mat4, fovY: number, aspect: number, near: number, far: number,
): Mat4 {
  const f = 1 / Math.tan(fovY * 0.5);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[11] = -1;
  if (far === Infinity) {
    // reverse-Z infinite far plane: z_ndc -> 0 as z -> inf
    out[10] = 0;
    out[14] = near;
  } else {
    out[10] = near / (far - near);
    out[14] = (far * near) / (far - near);
  }
  return out;
}

export function m4lookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const z = v3norm(v3sub(eye, target));
  let x = v3cross(up, z);
  if (v3len2(x) < 1e-12) {
    // view direction parallel to up — nudge
    x = v3cross([up[0] + 0.001, up[1], up[2] + 0.001], z);
  }
  x = v3norm(x);
  const y = v3cross(z, x);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -v3dot(x, eye);
  out[13] = -v3dot(y, eye);
  out[14] = -v3dot(z, eye);
  out[15] = 1;
  return out;
}

export const m4translate = (out: Mat4, v: Vec3): Mat4 => {
  mat4identity(out);
  out[12] = v[0]; out[13] = v[1]; out[14] = v[2];
  return out;
};
export const m4scale = (out: Mat4, v: Vec3): Mat4 => {
  mat4identity(out);
  out[0] = v[0]; out[5] = v[1]; out[10] = v[2];
  return out;
};
export const m4rotY = (out: Mat4, a: number): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  mat4identity(out);
  out[0] = c; out[2] = -s; out[8] = s; out[10] = c;
  return out;
};
export const m4rotX = (out: Mat4, a: number): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  mat4identity(out);
  out[5] = c; out[6] = s; out[9] = -s; out[10] = c;
  return out;
};
export const m4rotZ = (out: Mat4, a: number): Mat4 => {
  const c = Math.cos(a), s = Math.sin(a);
  mat4identity(out);
  out[0] = c; out[1] = s; out[4] = -s; out[5] = c;
  return out;
};

export function m4invert(out: Mat4, a: Mat4): Mat4 {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return mat4identity(out);
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

/** Inverse-transpose of the upper 3x3, written into a mat3 (9 floats). */
export const m3normalFromM4 = (out: Mat3, a: Mat4): Mat3 => {
  const t = mat4();
  m4invert(t, a);
  out[0] = t[0]; out[1] = t[4]; out[2] = t[8];
  out[3] = t[1]; out[4] = t[5]; out[5] = t[9];
  out[6] = t[2]; out[7] = t[6]; out[8] = t[10];
  return out;
};

export const m4transformPoint = (m: Mat4, p: Vec3): Vec3 => {
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15] || 1;
  return [
    (m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w,
    (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w,
    (m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]) / w,
  ];
};
export const m4transformDir = (m: Mat4, p: Vec3): Vec3 => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2],
];

/** Compose TRS without intermediate allocations. */
export function m4compose(
  out: Mat4, pos: Vec3, quat: Vec4, scale: Vec3 = [1, 1, 1],
): Mat4 {
  const [x, y, z, w] = quat;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const sx = scale[0], sy = scale[1], sz = scale[2];
  out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx; out[3] = 0;
  out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
  out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
  out[12] = pos[0]; out[13] = pos[1]; out[14] = pos[2]; out[15] = 1;
  return out;
}

// ---------------------------------------------------------------- quat

export const quat = (x = 0, y = 0, z = 0, w = 1): Vec4 => [x, y, z, w];

export const qmul = (a: Vec4, b: Vec4): Vec4 => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qnorm = (a: Vec4): Vec4 => {
  const l = Math.hypot(a[0], a[1], a[2], a[3]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l, a[3] / l];
};
export const qFromAxisAngle = (axis: Vec3, a: number): Vec4 => {
  const h = a * 0.5, s = Math.sin(h);
  const n = v3norm(axis);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(h)];
};
export const qFromEulerYXZ = (yaw: number, pitch: number, roll: number): Vec4 => {
  const cy = Math.cos(yaw * 0.5), sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5), sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5), sr = Math.sin(roll * 0.5);
  return qnorm([
    sp * cy * cr + cp * sy * sr,
    cp * sy * cr - sp * cy * sr,
    cp * cy * sr - sp * sy * cr,
    cp * cy * cr + sp * sy * sr,
  ]);
};
export const qslerp = (a: Vec4, b: Vec4, t: number): Vec4 => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb: Vec4 = b;
  if (d < 0) { bb = [-b[0], -b[1], -b[2], -b[3]]; d = -d; }
  if (d > 0.9995) {
    return qnorm([lerp(a[0], bb[0], t), lerp(a[1], bb[1], t), lerp(a[2], bb[2], t), lerp(a[3], bb[3], t)]);
  }
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bb[0] * wb, a[1] * wa + bb[1] * wb, a[2] * wa + bb[2] * wb, a[3] * wa + bb[3] * wb];
};

// ---------------------------------------------------------------- random

/** Deterministic 32-bit PRNG (mulberry32). Same seed → same city, always. */
export function makeRng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo: number, hi: number) => lo + (hi - lo) * next(),
    int: (lo: number, hi: number) => Math.floor(lo + (hi - lo + 1) * next()),
    /** Symmetric jitter in [-a, a]. */
    jitter: (a: number) => (next() * 2 - 1) * a,
    bool: (p = 0.5) => next() < p,
    pick: <T>(arr: readonly T[]): T => arr[Math.floor(next() * arr.length) % arr.length],
    /** Approximate normal via sum of uniforms — fast, bounded, good enough. */
    gauss: (mean = 0, sd = 1) => {
      const s = next() + next() + next() + next() - 2;
      return mean + s * 0.8660254 * sd;
    },
    /** In-place Fisher-Yates over a plain array. */
    shuffle: <T>(arr: T[]): T[] => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = arr[i];
        arr[i] = arr[j];
        arr[j] = t;
      }
      return arr;
    },
    /** Same, but accepts a typed array. Returns it for chaining. */
    shuffleInto: <T extends { length: number }>(arr: T): T => {
      const a = arr as unknown as number[];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const t = a[i];
        a[i] = a[j];
        a[j] = t;
      }
      return arr;
    },
    fork: (salt: number) => makeRng((seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0),
  };
}
export type Rng = ReturnType<typeof makeRng>;

// ---------------------------------------------------------------- noise

const P = new Uint8Array(512);
{
  const r = makeRng(1337);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  r.shuffleInto(perm);
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];
}
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const grad2 = (h: number, x: number, y: number) => {
  switch (h & 7) {
    case 0: return x + y; case 1: return x - y; case 2: return -x + y; case 3: return -x - y;
    case 4: return x; case 5: return -x; case 6: return y; default: return -y;
  }
};

/** Perlin noise in [-1,1]. */
export function noise2(x: number, y: number): number {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  x -= Math.floor(x); y -= Math.floor(y);
  const u = fade(x), v = fade(y);
  const a = P[X] + Y, b = P[X + 1] + Y;
  return lerp(
    lerp(grad2(P[a], x, y), grad2(P[b], x - 1, y), u),
    lerp(grad2(P[a + 1], x, y - 1), grad2(P[b + 1], x - 1, y - 1), u),
    v,
  ) * 0.7071;
}
export function noise3(x: number, y: number, z: number): number {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
  x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
  const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  const g = (h: number, a: number, b: number, c: number) => {
    const hh = h & 15;
    const u2 = hh < 8 ? a : b;
    const v2 = hh < 4 ? b : hh === 12 || hh === 14 ? a : c;
    return ((hh & 1) === 0 ? u2 : -u2) + ((hh & 2) === 0 ? v2 : -v2);
  };
  return lerp(
    lerp(
      lerp(g(P[AA], x, y, z), g(P[BA], x - 1, y, z), u),
      lerp(g(P[AB], x, y - 1, z), g(P[BB], x - 1, y - 1, z), u), v),
    lerp(
      lerp(g(P[AA + 1], x, y, z - 1), g(P[BA + 1], x - 1, y, z - 1), u),
      lerp(g(P[AB + 1], x, y - 1, z - 1), g(P[BB + 1], x - 1, y - 1, z - 1), u), v),
    w,
  ) * 0.936;
}
/** Fractal Brownian motion. */
export function fbm2(x: number, y: number, oct = 4, lac = 2.03, gain = 0.5): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise2(x * f, y * f); f *= lac; a *= gain; }
  return s * 1.4;
}
export function fbm3(x: number, y: number, z: number, oct = 4, lac = 2.03, gain = 0.5): number {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise3(x * f, y * f, z * f); f *= lac; a *= gain; }
  return s * 1.4;
}
/** Ridged multifractal — the sharp-crest variant good for mountains/megastructure spines. */
export function ridged2(x: number, y: number, oct = 5, lac = 2.11, gain = 0.5): number {
  let s = 0, a = 0.5, f = 1, prev = 1;
  for (let i = 0; i < oct; i++) {
    const n = 1 - Math.abs(noise2(x * f, y * f));
    s += a * n * n * prev;
    prev = n;
    f *= lac; a *= gain;
  }
  return s * 1.2;
}
/** Domain-warped fbm — the good-looking one. */
export function warpFbm2(x: number, y: number, warp = 0.6, oct = 5): number {
  const qx = fbm2(x + 5.2, y + 1.3, 3);
  const qy = fbm2(x + 9.7, y + 4.1, 3);
  return fbm2(x + warp * qx, y + warp * qy, oct);
}
/** Worley / cellular F1 distance, normalised roughly to [0,1]. */
export function worley2(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 8;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const h = P[(P[cx & 255] + (cy & 255)) & 255];
      const h2 = P[(h + 17) & 255];
      const px = cx + h / 255, py = cy + h2 / 255;
      best = Math.min(best, Math.hypot(px - x, py - y));
    }
  }
  return Math.min(1, best);
}

// ---------------------------------------------------------------- color

/** sRGB hex → linear rgb triple. All palette math downstream is linear. */
export function hexLinear(hex: string): Vec3 {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const s = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  return s.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))) as Vec3;
}
export const luma = (c: Vec3) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

// ---------------------------------------------------------------- geometry

export const aabbIntersects = (
  amin: Vec3, amax: Vec3, bmin: Vec3, bmax: Vec3,
): boolean =>
  amin[0] <= bmax[0] && amax[0] >= bmin[0] &&
  amin[1] <= bmax[1] && amax[1] >= bmin[1] &&
  amin[2] <= bmax[2] && amax[2] >= bmin[2];

/** Shortest distance from point p to segment ab. */
export function distPointSegment(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
  const apx = p[0] - a[0], apy = p[1] - a[1], apz = p[2] - a[2];
  const d = abx * abx + aby * aby + abz * abz;
  const t = d < 1e-12 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / d));
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t);
}

/** Catmull-Rom on scalars — used for all rail/cable splines. */
export function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Critically-damped spring toward a target. Returns [value, velocity]. */
export function spring(cur: number, vel: number, target: number, omega: number, dt: number): [number, number] {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega, hoo = dt * oo, hhoo = dt * hoo;
  const det = f + hhoo;
  return [(f * cur + dt * vel + hhoo * target) / det, (vel + hoo * (target - cur)) / det];
}
