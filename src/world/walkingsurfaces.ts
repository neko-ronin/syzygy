/** Compact world-space triangles emitted by actual upward walking geometry.
 * Each record is ax,ay,az,bx,by,bz,cx,cy,cz. The producer extracts only tagged
 * paving/kerb-top faces and treats the published Float32Array as immutable.
 * The consumer retains this buffer, never the opaque mesh it came from.
 */
import type { Mesh } from './geometry';
import { decodeGroundSurfaceTag } from './groundgrammar';

export const WALKING_TRIANGLE_FLOATS = 9;
export type WalkingSurfaceTriangles = Float32Array;

/** The producer: tagged paving and kerb-top triangles of one baked mesh. */
export function walkingTriangles(mesh: Mesh): WalkingSurfaceTriangles {
  const out: number[] = [];
  const { indices, colors, positions } = mesh;
  for (let i = 0; i < mesh.indexCount; i += 3) {
    const tag = colors[indices[i] * 4 + 3];
    if (tag >= 0) continue;
    const kind = decodeGroundSurfaceTag(tag).surface;
    if (kind !== 'paving' && kind !== 'kerb-top') continue;
    for (let k = 0; k < 3; k++) {
      const v = indices[i + k] * 3;
      out.push(positions[v], positions[v + 1], positions[v + 2]);
    }
  }
  return new Float32Array(out);
}

const CELL_SIZE = 8;
const EDGE_EPSILON = 1e-7;

/** A revision is indexed once; support queries allocate nothing. */
export class WalkingSurfaceIndex {
  private triangles: WalkingSurfaceTriangles = new Float32Array(0);
  private rows = new Map<number, Map<number, Uint32Array>>();
  private revision = Number.NaN;
  /** XZ bounds of the indexed triangles; empty index has inverted bounds. */
  minX = Infinity; minZ = Infinity; maxX = -Infinity; maxZ = -Infinity;

  /** Returns whether a new immutable buffer was accepted. Reusing a revision
   * deliberately ignores the supplied buffer; changed geometry needs a new ID.
   */
  set(triangles: WalkingSurfaceTriangles, revision: number): boolean {
    if (revision === this.revision) return false;
    if (triangles.length % WALKING_TRIANGLE_FLOATS !== 0) {
      throw new RangeError('Walking surfaces need nine floats per triangle');
    }

    // Count first, then allocate exact typed cell lists. Temporary maps contain
    // one number per occupied cell, rather than an array per triangle or vertex.
    const counts = new Map<number, Map<number, number>>();
    const rows = new Map<number, Map<number, Uint32Array>>();
    for (let pass = 0; pass < 2; pass++) {
      for (let o = 0; o < triangles.length; o += WALKING_TRIANGLE_FLOATS) {
        let finite = true;
        for (let k = 0; k < WALKING_TRIANGLE_FLOATS; k++) {
          if (!Number.isFinite(triangles[o + k])) finite = false;
        }
        if (!finite) continue;
        const ax = triangles[o], az = triangles[o + 2];
        const bx = triangles[o + 3], bz = triangles[o + 5];
        const cx = triangles[o + 6], cz = triangles[o + 8];
        // Geometric winding, not authored normals: cross(ab,ac).y = -area.
        const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
        if (area >= -1e-10) continue;
        const x0 = Math.floor(Math.min(ax, bx, cx) / CELL_SIZE);
        const x1 = Math.floor(Math.max(ax, bx, cx) / CELL_SIZE);
        const z0 = Math.floor(Math.min(az, bz, cz) / CELL_SIZE);
        const z1 = Math.floor(Math.max(az, bz, cz) / CELL_SIZE);
        for (let z = z0; z <= z1; z++) {
          let countRow = counts.get(z);
          if (!countRow) { countRow = new Map(); counts.set(z, countRow); }
          const row = rows.get(z);
          for (let x = x0; x <= x1; x++) {
            const n = countRow.get(x) ?? 0;
            if (pass === 0) countRow.set(x, n + 1);
            else {
              row!.get(x)![n] = o;
              countRow.set(x, n + 1);
            }
          }
        }
      }
      if (pass === 0) {
        for (const [z, countRow] of counts) {
          const row = new Map<number, Uint32Array>();
          for (const [x, n] of countRow) {
            row.set(x, new Uint32Array(n));
            countRow.set(x, 0);
          }
          rows.set(z, row);
        }
      }
    }
    this.triangles = triangles;
    this.minX = this.minZ = Infinity; this.maxX = this.maxZ = -Infinity;
    for (let o = 0; o < triangles.length; o += 3) {
      const x = triangles[o], z = triangles[o + 2];
      if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
      if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    }
    this.rows = rows;
    this.revision = revision;
    return true;
  }

  /** Highest actual support at the body's center; the global deck is fallback.
   * Sloped triangles use barycentric height. Downward/vertical faces were
   * excluded during indexing, and overlapping patches do not depend on order.
   */
  heightAt(x: number, z: number, fallback: number): number {
    const cell = this.rows.get(Math.floor(z / CELL_SIZE))?.get(Math.floor(x / CELL_SIZE));
    if (!cell) return fallback;
    const t = this.triangles;
    let height = fallback;
    for (let k = 0; k < cell.length; k++) {
      const o = cell[k];
      const ax = t[o], az = t[o + 2], bx = t[o + 3], bz = t[o + 5];
      const cx = t[o + 6], cz = t[o + 8];
      const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
      const a = ((bx - x) * (cz - z) - (bz - z) * (cx - x)) / area;
      const b = ((cx - x) * (az - z) - (cz - z) * (ax - x)) / area;
      const c = 1 - a - b;
      if (a < -EDGE_EPSILON || b < -EDGE_EPSILON || c < -EDGE_EPSILON) continue;
      height = Math.max(height, a * t[o + 1] + b * t[o + 4] + c * t[o + 7]);
    }
    return height;
  }
}

/**
 * Walking support indexed per chunk, so a chunk arriving or leaving re-indexes
 * only itself. One index over all resident chunks was rebuilt on every LOD 0
 * swap (7 ms for nine chunks), which was most of the flight route's slow frames.
 */
export class WalkingSurfaceSet {
  private parts = new Map<string, { source: WalkingSurfaceTriangles; index: WalkingSurfaceIndex }>();
  private nextRevision = 0;

  /** Diff by key and array identity; returns whether anything changed. */
  update(parts: ReadonlyMap<string, WalkingSurfaceTriangles>): boolean {
    let changed = false;
    for (const key of [...this.parts.keys()]) {
      if (!parts.has(key)) { this.parts.delete(key); changed = true; }
    }
    for (const [key, source] of parts) {
      if (this.parts.get(key)?.source === source) continue;
      const index = new WalkingSurfaceIndex();
      index.set(source, ++this.nextRevision);
      this.parts.set(key, { source, index });
      changed = true;
    }
    return changed;
  }

  /** Highest support across parts whose bounds contain the point. */
  heightAt(x: number, z: number, fallback: number): number {
    let h = fallback;
    for (const { index } of this.parts.values()) {
      if (x < index.minX || x > index.maxX || z < index.minZ || z > index.maxZ) continue;
      h = Math.max(h, index.heightAt(x, z, fallback));
    }
    return h;
  }
}
