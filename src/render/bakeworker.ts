/**
 * Chunk baking off the main thread.
 *
 * Synchronous bakes inside `streamChunks` were the flight route's frame spikes
 * (stream p95 19.7 ms, max 46 ms). The worker owns its own `City` from the same
 * seed; a chunk baked in a fresh City is byte-identical to one baked after its
 * neighbours (checked at LOD 0 and 1), so results match the synchronous path.
 * Mesh arrays are transferred, not copied.
 */
import { City, defaultCityConfig } from '../world/citygen';
import { bakeChunk, type BakedChunk } from './citymesh';

export type BakeRequest =
  | { type: 'init'; seed: number }
  | { type: 'bake'; id: number; cx: number; cz: number; lod: number };
export type BakeResponse =
  | { id: number; baked: BakedChunk; ms: number }
  | { id: number; baked: null; ms: number; error?: string };

let city: City | null = null;
let seed = 0;
// Typed locally: a `lib="webworker"` reference would leak into the whole program.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BakeRequest>) => void) | null;
  postMessage(message: BakeResponse, transfer?: Transferable[]): void;
};

scope.onmessage = (e: MessageEvent<BakeRequest>) => {
  const m = e.data;
  if (m.type === 'init') { seed = m.seed; city = new City(defaultCityConfig(seed)); return; }
  const t0 = performance.now();
  try {
    const chunk = city?.getChunk(m.cx, m.cz);
    if (!chunk) { scope.postMessage({ id: m.id, baked: null, ms: 0 } satisfies BakeResponse); return; }
    const baked = bakeChunk(chunk, m.lod, seed);
    const buffers = new Set<ArrayBuffer>();
    for (const mesh of [baked.opaque, baked.foliage]) {
      for (const a of [mesh.positions, mesh.normals, mesh.uvs, mesh.colors, mesh.indices]) buffers.add(a.buffer as ArrayBuffer);
    }
    buffers.add(baked.walking.buffer as ArrayBuffer);
    scope.postMessage({ id: m.id, baked, ms: performance.now() - t0 } satisfies BakeResponse, [...buffers]);
  } catch (err) {
    scope.postMessage({ id: m.id, baked: null, ms: performance.now() - t0, error: String(err) } satisfies BakeResponse);
  }
};
