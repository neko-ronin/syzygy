/**
 * Mesh/instance data types plus a small CPU mesh builder. Everything the city
 * generator needs to hand the renderer uploadable vertex buffers.
 *
 * Interleaving is done at upload time, not here: the builder keeps plain
 * component arrays so a caller can decide the vertex layout. Vertex colour
 * carries `rgb + emissive` (the 4th component is an emissive mask, not alpha).
 */

import { v3cross, v3len, v3norm, v3perp, v3sub, type Vec2, type Vec3 } from '../core/math';

/** Uploadable triangle soup with per-vertex colour and tangent-space UVs. */
export interface Mesh {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 4 floats per vertex: linear rgb + emissive mask. */
  colors: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  indexCount: number;
  boundsMin: Vec3;
  boundsMax: Vec3;
}

/** Face bitmask for {@link MeshOpts.faces}. */
export const FACE_PX = 1, FACE_NX = 2, FACE_PY = 4, FACE_NY = 8, FACE_PZ = 16, FACE_NZ = 32;
export const FACE_ALL = FACE_PX | FACE_NX | FACE_PY | FACE_NY | FACE_PZ | FACE_NZ;

export interface MeshOpts {
  /** 0..N additive emissive mask written to the colour alpha. */
  emissive?: number;
  /** UV repeats per metre. Default 1. */
  uvScale?: number;
  /** Explicit per-vertex normals (smooth shading) for quad-like emitters. */
  normals?: readonly [Vec3, Vec3, Vec3, Vec3];
  /** Yaw about the primitive's own origin, radians. */
  rotationY?: number;
  /** Subset of {@link FACE_ALL} faces to emit. */
  faces?: number;
  /** Cap the end faces of cylinders/cones/tubes. */
  capEnds?: boolean;
  /** Top radius for cylinders/cones. */
  radiusTop?: number;
  /** Emit the strip twice with opposite winding. */
  doubleSided?: boolean;
  /** First UV coordinate offset, for atlas-style tiling. */
  uvOffset?: number;
  /** Reference up vector for frame construction on ribbons and planes. */
  up?: Vec3;
}

const DEF_OPTS: MeshOpts = {};

export const emptyMesh = (): Mesh => ({
  positions: new Float32Array(0),
  normals: new Float32Array(0),
  uvs: new Float32Array(0),
  colors: new Float32Array(0),
  indices: new Uint32Array(0),
  vertexCount: 0,
  indexCount: 0,
  boundsMin: [0, 0, 0],
  boundsMax: [0, 0, 0],
});

export const meshTriangleCount = (m: Mesh): number => m.indexCount / 3;

/** Rotates a point about +Y: world.x = lx*cos + lz*sin, world.z = -lx*sin + lz*cos. */
export const rotY = (p: Vec3, a: number): Vec3 => {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};

/** Yaw that maps local +X onto the horizontal direction (dx, dz). */
export const yawFromDir = (dx: number, dz: number): number => Math.atan2(-dz, dx);

const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Growable triangle-soup accumulator. Not thread-safe, not reentrant. */
export class MeshBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private vcount = 0;
  private lo: Vec3 = [Infinity, Infinity, Infinity];
  private hi: Vec3 = [-Infinity, -Infinity, -Infinity];

  get vertexCount(): number { return this.vcount; }
  get indexCount(): number { return this.idx.length; }
  get triangleCount(): number { return this.idx.length / 3; }

  private vert(p: Vec3, n: Vec3, u: number, v: number, color: Vec3, e: number): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(u, v);
    this.col.push(color[0], color[1], color[2], e);
    if (p[0] < this.lo[0]) this.lo[0] = p[0];
    if (p[1] < this.lo[1]) this.lo[1] = p[1];
    if (p[2] < this.lo[2]) this.lo[2] = p[2];
    if (p[0] > this.hi[0]) this.hi[0] = p[0];
    if (p[1] > this.hi[1]) this.hi[1] = p[1];
    if (p[2] > this.hi[2]) this.hi[2] = p[2];
    this.vcount++;
  }

  /** Four corners in CCW order viewed from the front. */
  pushQuad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, color: Vec3, uvScale = 1, opts: MeshOpts = DEF_OPTS): void {
    const e = opts.emissive ?? 0;
    const n = opts.normals
      ? undefined
      : v3norm(cross3(v3sub(b, a), v3sub(d, a)));
    const e1 = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * uvScale;
    const e2 = Math.hypot(d[0] - a[0], d[1] - a[1], d[2] - a[2]) * uvScale;
    const uo = opts.uvOffset ?? 0;
    const base = this.vcount;
    if (opts.normals) {
      const ns = opts.normals;
      this.vert(a, ns[0], uo, 0, color, e);
      this.vert(b, ns[1], uo + e1, 0, color, e);
      this.vert(c, ns[2], uo + e1, e2, color, e);
      this.vert(d, ns[3], uo, e2, color, e);
    } else {
      const nn = n as Vec3;
      this.vert(a, nn, uo, 0, color, e);
      this.vert(b, nn, uo + e1, 0, color, e);
      this.vert(c, nn, uo + e1, e2, color, e);
      this.vert(d, nn, uo, e2, color, e);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Axis-aligned (optionally yawed) box. UVs are metres-per-texel consistent. */
  pushBox(center: Vec3, half: Vec3, color: Vec3, opts: MeshOpts = DEF_OPTS): void {
    const yaw = opts.rotationY ?? 0;
    const us = opts.uvScale ?? 1;
    const faces = opts.faces ?? FACE_ALL;
    const hx = half[0], hy = half[1], hz = half[2];
    const p = (x: number, y: number, z: number): Vec3 => {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      return [center[0] + x * c + z * s, center[1] + y, center[2] - x * s + z * c];
    };
    const c000 = p(-hx, -hy, -hz), c100 = p(hx, -hy, -hz), c110 = p(hx, hy, -hz), c010 = p(-hx, hy, -hz);
    const c001 = p(-hx, -hy, hz), c101 = p(hx, -hy, hz), c111 = p(hx, hy, hz), c011 = p(-hx, hy, hz);
    if (faces & FACE_PZ) this.pushQuad(c001, c101, c111, c011, color, us, opts);
    if (faces & FACE_NZ) this.pushQuad(c100, c000, c010, c110, color, us, opts);
    if (faces & FACE_PX) this.pushQuad(c101, c100, c110, c111, color, us, opts);
    if (faces & FACE_NX) this.pushQuad(c000, c001, c011, c010, color, us, opts);
    if (faces & FACE_PY) this.pushQuad(c011, c111, c110, c010, color, us, opts);
    if (faces & FACE_NY) this.pushQuad(c000, c100, c101, c001, color, us, opts);
  }

  /** Frustum between two centred rectangles. `base`/`top` are face centres. */
  pushBoxTapered(
    base: Vec3, top: Vec3, halfBottom: Vec3, halfTop: Vec3, color: Vec3, opts: MeshOpts = DEF_OPTS,
  ): void {
    const us = opts.uvScale ?? 1;
    const faces = opts.faces ?? FACE_ALL;
    const bx = halfBottom[0], bz = halfBottom[2];
    const tx = halfTop[0], tz = halfTop[2];
    const b = (sx: number, sz: number): Vec3 => [base[0] + sx * bx, base[1], base[2] + sz * bz];
    const t = (sx: number, sz: number): Vec3 => [top[0] + sx * tx, top[1], top[2] + sz * tz];
    if (faces & (FACE_PZ | FACE_NX | FACE_PX | FACE_NZ)) {
      this.pushQuad(b(1, 1), t(1, 1), t(-1, 1), b(-1, 1), color, us, opts);
      this.pushQuad(b(-1, -1), t(-1, -1), t(1, -1), b(1, -1), color, us, opts);
      this.pushQuad(b(1, -1), t(1, -1), t(1, 1), b(1, 1), color, us, opts);
      this.pushQuad(b(-1, 1), t(-1, 1), t(-1, -1), b(-1, -1), color, us, opts);
    }
    if (faces & FACE_PY) this.pushQuad(t(-1, 1), t(1, 1), t(1, -1), t(-1, -1), color, us, opts);
    if (faces & FACE_NY) this.pushQuad(b(1, -1), b(-1, -1), b(-1, 1), b(1, 1), color, us, opts);
  }

  /** Swept circle from `from` to `to`. Smooth side normals, optional caps. */
  pushCylinder(
    from: Vec3, to: Vec3, radius: number, sides: number, color: Vec3, opts: MeshOpts = DEF_OPTS,
  ): void {
    const n = Math.max(3, sides | 0);
    const rt = opts.radiusTop ?? radius;
    const axis = v3sub(to, from);
    const len = v3len(axis);
    if (len < 1e-6) return;
    const t = v3norm(axis);
    const u = v3perp(t);
    const w = v3norm(cross3(t, u));
    const us = opts.uvScale ?? 1;
    const e = opts.emissive ?? 0;
    const base = this.vcount;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const nA: Vec3 = [u[0] * ca + w[0] * sa, u[1] * ca + w[1] * sa, u[2] * ca + w[2] * sa];
      const slope = (radius - rt) / len;
      const nB = v3norm([nA[0] + t[0] * slope, nA[1] + t[1] * slope, nA[2] + t[2] * slope]);
      this.vert([from[0] + nA[0] * radius, from[1] + nA[1] * radius, from[2] + nA[2] * radius], nB, i / n * len * us, 0, color, e);
      this.vert([to[0] + nA[0] * rt, to[1] + nA[1] * rt, to[2] + nA[2] * rt], nB, i / n * len * us, len * us, color, e);
    }
    for (let i = 0; i < n; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (opts.capEnds) {
      const capFan = (c: Vec3, nrm: Vec3, r: number): void => {
        const b0 = this.vcount;
        this.vert(c, nrm, 0.5, 0.5, color, e);
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          this.vert(
            [c[0] + (u[0] * ca + w[0] * sa) * r, c[1] + (u[1] * ca + w[1] * sa) * r, c[2] + (u[2] * ca + w[2] * sa) * r],
            nrm, 0.5 + ca * 0.5, 0.5 + sa * 0.5, color, e,
          );
        }
        for (let i = 0; i < n; i++) this.idx.push(b0, b0 + 1 + i + 1, b0 + 1 + i);
      };
      if (rt > 1e-5) capFan(to, t, rt);
      capFan(from, [-t[0], -t[1], -t[2]], radius);
    }
  }

  /** Cone from `from` (radius) to `to` (apex unless `opts.radiusTop` is set). */
  pushCone(
    from: Vec3, to: Vec3, radius: number, sides: number, color: Vec3, opts: MeshOpts = DEF_OPTS,
  ): void {
    this.pushCylinder(from, to, radius, sides, color, { ...opts, radiusTop: opts.radiusTop ?? 0 });
  }

  /** Swept circle of constant radius along a polyline. Parallel-transport frames. */
  pushTubeAlongPath(points: Vec3[], radius: number, sides: number, color: Vec3, opts: MeshOpts = DEF_OPTS): void {
    if (points.length < 2) return;
    const frames = pathFrames(points);
    const n = Math.max(3, sides | 0);
    const us = opts.uvScale ?? 1;
    const e = opts.emissive ?? 0;
    const base = this.vcount;
    let run = 0;
    for (let i = 0; i < points.length; i++) {
      const f = frames[i];
      if (i > 0) run += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
      for (let j = 0; j <= n; j++) {
        const a = (j / n) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const nA: Vec3 = [
          f.n[0] * ca + f.b[0] * sa,
          f.n[1] * ca + f.b[1] * sa,
          f.n[2] * ca + f.b[2] * sa,
        ];
        this.vert(
          [points[i][0] + nA[0] * radius, points[i][1] + nA[1] * radius, points[i][2] + nA[2] * radius],
          nA, (j / n) * us * 6.283, run * us, color, e,
        );
      }
    }
    for (let i = 0; i < points.length - 1; i++) {
      for (let j = 0; j < n; j++) {
        const a = base + i * (n + 1) + j;
        this.idx.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
      }
    }
  }

  /** Flat strip of constant width following a polyline. Double-sided by default. */
  pushRibbonAlongPath(
    points: Vec3[], width: number, color: Vec3, opts: MeshOpts = DEF_OPTS,
  ): void {
    if (points.length < 2) return;
    const frames = pathFrames(points, opts.up ?? ([0, 1, 0] as Vec3));
    const hw = width * 0.5;
    const us = opts.uvScale ?? 1;
    const e = opts.emissive ?? 0;
    for (const pass of opts.doubleSided === false ? [0] : [0, 1]) {
      const base = this.vcount;
      let run = 0;
      for (let i = 0; i < points.length; i++) {
        const f = frames[i];
        const nrm: Vec3 = pass === 0 ? f.t : [-f.t[0], -f.t[1], -f.t[2]];
        if (i > 0) run += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
        this.vert([points[i][0] - f.n[0] * hw, points[i][1] - f.n[1] * hw, points[i][2] - f.n[2] * hw], nrm, 0, run * us, color, e);
        this.vert([points[i][0] + f.n[0] * hw, points[i][1] + f.n[1] * hw, points[i][2] + f.n[2] * hw], nrm, 1, run * us, color, e);
      }
      for (let i = 0; i < points.length - 1; i++) {
        const a = base + i * 2;
        if (pass === 0) this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
        else this.idx.push(a, a + 3, a + 1, a, a + 2, a + 3);
      }
    }
  }

  /** UV sphere. `rings` is the latitude count, `sectors` the longitude count. */
  pushSphere(
    center: Vec3, radius: number, rings: number, sectors: number, color: Vec3, opts: MeshOpts = DEF_OPTS,
  ): void {
    const R = Math.max(2, rings | 0), S = Math.max(3, sectors | 0);
    const us = opts.uvScale ?? 1;
    const e = opts.emissive ?? 0;
    const base = this.vcount;
    for (let r = 0; r <= R; r++) {
      const phi = (r / R) * Math.PI;
      const sp = Math.sin(phi), cp = Math.cos(phi);
      for (let s = 0; s <= S; s++) {
        const th = (s / S) * Math.PI * 2;
        const n: Vec3 = [sp * Math.cos(th), cp, sp * Math.sin(th)];
        this.vert(
          [center[0] + n[0] * radius, center[1] + n[1] * radius, center[2] + n[2] * radius],
          n, (s / S) * 6.283 * us, (r / R) * Math.PI * us, color, e,
        );
      }
    }
    for (let r = 0; r < R; r++) {
      for (let s = 0; s < S; s++) {
        const a = base + r * (S + 1) + s;
        this.idx.push(a, a + S + 1, a + 1, a + 1, a + S + 1, a + S + 2);
      }
    }
  }

  /** Single quad from an explicit right/up basis (default X/Z, i.e. horizontal). */
  pushPlane(center: Vec3, halfW: number, halfH: number, color: Vec3, opts: MeshOpts = DEF_OPTS): void {
    const right: Vec3 = opts.up ? v3norm(cross3([0, 1, 0], opts.up)) : [1, 0, 0];
    const upv: Vec3 = opts.up ?? [0, 0, 1];
    const n = v3norm(cross3(right, upv));
    const us = opts.uvScale ?? 1;
    const r = v3scaleV(right, halfW), u = v3scaleV(upv, halfH);
    this.pushQuad(
      [center[0] - r[0] - u[0], center[1] - r[1] - u[1], center[2] - r[2] - u[2]],
      [center[0] + r[0] - u[0], center[1] + r[1] - u[1], center[2] + r[2] - u[2]],
      [center[0] + r[0] + u[0], center[1] + r[1] + u[1], center[2] + r[2] + u[2]],
      [center[0] - r[0] + u[0], center[1] - r[1] + u[1], center[2] - r[2] + u[2]],
      color, us, { ...opts, normals: [n, n, n, n] },
    );
    if (opts.doubleSided !== false) {
      this.pushQuad(
        [center[0] - r[0] + u[0], center[1] - r[1] + u[1], center[2] - r[2] + u[2]],
        [center[0] + r[0] + u[0], center[1] + r[1] + u[1], center[2] + r[2] + u[2]],
        [center[0] + r[0] - u[0], center[1] + r[1] - u[1], center[2] + r[2] - u[2]],
        [center[0] - r[0] - u[0], center[1] - r[1] - u[1], center[2] - r[2] - u[2]],
        color, us, { ...opts, normals: [n, n, n, n] },
      );
    }
  }

  build(): Mesh {
    const count = this.vcount;
    const empty = count === 0;
    return {
      positions: Float32Array.from(this.pos),
      normals: Float32Array.from(this.nrm),
      uvs: Float32Array.from(this.uv),
      colors: Float32Array.from(this.col),
      indices: Uint32Array.from(this.idx),
      vertexCount: count,
      indexCount: this.idx.length,
      boundsMin: empty ? [0, 0, 0] : [this.lo[0], this.lo[1], this.lo[2]],
      boundsMax: empty ? [0, 0, 0] : [this.hi[0], this.hi[1], this.hi[2]],
    };
  }
}

const v3scaleV = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/** Orthonormal frames along a polyline, minimising twist. */
export function pathFrames(points: Vec3[], up: Vec3 = [0, 1, 0]): { t: Vec3; n: Vec3; b: Vec3 }[] {
  const N = points.length;
  const tangents: Vec3[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(N - 1, i + 1)];
    const d = v3sub(b, a);
    tangents[i] = v3len(d) > 1e-9 ? v3norm(d) : [0, 0, 1];
  }
  const out: { t: Vec3; n: Vec3; b: Vec3 }[] = new Array(N);
  let n = v3cross(up, tangents[0]);
  n = v3len(n) > 1e-6 ? v3norm(n) : v3perp(tangents[0]);
  for (let i = 0; i < N; i++) {
    if (i > 0) n = rotateBetween(n, tangents[i - 1], tangents[i]);
    const t = tangents[i];
    const b = v3norm(v3cross(t, n));
    n = v3norm(v3cross(b, t));
    out[i] = { t, n, b };
  }
  return out;
}

/** Rodrigues rotation carrying unit vector `from` onto unit vector `to`. */
const rotateBetween = (v: Vec3, from: Vec3, to: Vec3): Vec3 => {
  const axis = cross3(from, to);
  const s = v3len(axis);
  const c = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
  if (s < 1e-9) return c < 0 ? [-v[0], -v[1], -v[2]] : v;
  const ax: Vec3 = [axis[0] / s, axis[1] / s, axis[2] / s];
  const ang = Math.atan2(s, c);
  const k = Math.sin(ang);
  const d = ax[0] * v[0] + ax[1] * v[1] + ax[2] * v[2];
  const cr: Vec3 = [
    ax[1] * v[2] - ax[2] * v[1],
    ax[2] * v[0] - ax[0] * v[2],
    ax[0] * v[1] - ax[1] * v[0],
  ];
  const cA = Math.cos(ang);
  return [
    v[0] * cA + cr[0] * k + ax[0] * d * (1 - cA),
    v[1] * cA + cr[1] * k + ax[1] * d * (1 - cA),
    v[2] * cA + cr[2] * k + ax[2] * d * (1 - cA),
  ];
};

/**
 * Extrudes a closed convex 2D profile (XY) from `from` to `to`. Returns a fresh
 * mesh — use {@link mergeInto} to fold it into a larger builder's output.
 */
export function extrudeProfile(
  profile: Vec2[], from: Vec3, to: Vec3, color: Vec3, opts: MeshOpts = DEF_OPTS,
): Mesh {
  const mb = new MeshBuilder();
  if (profile.length < 3) return mb.build();
  const axis = v3sub(to, from);
  if (v3len(axis) < 1e-9) return mb.build();
  const t = v3norm(axis);
  const u = v3perp(t);
  const w = v3norm(v3cross(t, u));
  const at = (base: Vec3, p: Vec2): Vec3 => [
    base[0] + u[0] * p[0] + w[0] * p[1],
    base[1] + u[1] * p[0] + w[1] * p[1],
    base[2] + u[2] * p[0] + w[2] * p[1],
  ];
  const n = profile.length;
  let cx = 0, cy = 0;
  for (const p of profile) { cx += p[0]; cy += p[1]; }
  const centroid: Vec2 = [cx / n, cy / n];
  for (let i = 0; i < n; i++) {
    const a = profile[i], b = profile[(i + 1) % n];
    mb.pushQuad(at(from, a), at(to, a), at(to, b), at(from, b), color, opts.uvScale ?? 1, opts);
  }
  if (opts.capEnds !== false) {
    for (let side = 0; side < 2; side++) {
      const base = side === 0 ? from : to;
      const nrm: Vec3 = side === 0 ? t : [-t[0], -t[1], -t[2]];
      const fan = (p0: Vec2, p1: Vec2): void => {
        if (side === 0) {
          mb.pushQuad(at(base, centroid), at(base, p0), at(base, p1), at(base, p1),
            color, 1, { ...opts, normals: [nrm, nrm, nrm, nrm] });
        } else {
          mb.pushQuad(at(base, centroid), at(base, p1), at(base, p0), at(base, p0),
            color, 1, { ...opts, normals: [nrm, nrm, nrm, nrm] });
        }
      };
      for (let i = 0; i < n; i++) fan(profile[i], profile[(i + 1) % n]);
    }
  }
  return mb.build();
}

/** Appends `src` into `target`, re-basing indices and expanding bounds. */
export function mergeInto(target: Mesh, src: Mesh): Mesh {
  if (src.vertexCount === 0) return target;
  const p = new Float32Array(target.positions.length + src.positions.length);
  p.set(target.positions); p.set(src.positions, target.positions.length);
  const n = new Float32Array(target.normals.length + src.normals.length);
  n.set(target.normals); n.set(src.normals, target.normals.length);
  const uv = new Float32Array(target.uvs.length + src.uvs.length);
  uv.set(target.uvs); uv.set(src.uvs, target.uvs.length);
  const c = new Float32Array(target.colors.length + src.colors.length);
  c.set(target.colors); c.set(src.colors, target.colors.length);
  const off = target.vertexCount;
  const i = new Uint32Array(target.indices.length + src.indices.length);
  i.set(target.indices);
  for (let k = 0; k < src.indices.length; k++) i[target.indices.length + k] = src.indices[k] + off;
  target.positions = p; target.normals = n; target.uvs = uv; target.colors = c; target.indices = i;
  target.vertexCount += src.vertexCount;
  target.indexCount += src.indexCount;
  if (target.vertexCount === src.vertexCount) {
    target.boundsMin = [...src.boundsMin];
    target.boundsMax = [...src.boundsMax];
  } else {
    for (let k = 0; k < 3; k++) {
      if (src.boundsMin[k] < target.boundsMin[k]) target.boundsMin[k] = src.boundsMin[k];
      if (src.boundsMax[k] > target.boundsMax[k]) target.boundsMax[k] = src.boundsMax[k];
    }
  }
  return target;
}
