/** GPU-free replay state transitions using the actual renderer method. */
import { City, defaultCityConfig } from '../world/citygen';
import type { Renderer } from './renderer';
import type { BakedChunk } from './citymesh';

export async function runCaptureResidencySelfTest(): Promise<void> {
  // gpuutil declares stage masks at module load; no device or shader is created.
  if (!('GPUShaderStage' in globalThis)) Object.assign(globalThis, { GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 } });
  const { Renderer: RendererClass } = await import('./renderer');
  const requireThat = (ok: unknown, why: string) => { if (!ok) throw new Error(why); };
  const key = (cx: number, cz: number) => `${cx},${cz}`;
  const chunks = new Map([
    [key(0, 0), { cx: 0, cz: 0, lod: 1, version: 7, mesh: null, foliage: null }],
    [key(1, 0), { cx: 1, cz: 0, lod: 0, version: 8, mesh: null, foliage: null }],
    [key(5, 5), { cx: 5, cz: 5, lod: 2, version: 9, mesh: null, foliage: null }],
  ]);
  const uploaded: string[] = [];
  const harness = Object.assign(Object.create(RendererClass.prototype), {
    captureFrozen: true, chunks, residencyRevision: 9,
    world: { seed: 6191639 }, city: new City(defaultCityConfig(6191639)), chunkKey: key,
    gpu: { device: { queue: { onSubmittedWorkDone: async () => {} } } },
    uploadChunk(cx: number, cz: number, baked: BakedChunk, lod: number) {
      requireThat(baked.opaque.indexCount > 0, 'replay must bake actual requested geometry');
      uploaded.push(key(cx, cz));
      chunks.set(key(cx, cz), { cx, cz, lod, version: ++this.residencyRevision, mesh: null, foliage: null });
    },
  }) as Renderer;
  const saved = [{ cx: 0, cz: 0, lod: 0 }, { cx: 1, cz: 0, lod: 0 }, { cx: 0, cz: -1, lod: 2 }];
  await harness.replayCaptureResidency(saved);
  requireThat(!chunks.has(key(5, 5)), 'replay must remove extra geometry');
  requireThat(chunks.get(key(0, 0))?.lod === 0 && chunks.get(key(0, -1))?.lod === 2, 'missing and changed LODs must match the saved scene');
  requireThat(chunks.get(key(1, 0))?.version === 8, 'matching resident geometry should remain intact');
  requireThat(uploaded.includes(key(0, 0)) && uploaded.includes(key(0, -1)) && !uploaded.includes(key(1, 0)), 'replay must bake changes without silently using distance-selected LOD');
  let refused = false;
  try { await harness.replayCaptureResidency([{ cx: 0, cz: 0, lod: 0 }, { cx: 0, cz: 0, lod: 1 }]); } catch { refused = true; }
  requireThat(refused, 'ambiguous duplicate saved chunks must refuse');
  console.log('CAPTURE REPLAY ALL PASS: exact saved keys and LODs, extras removed, matching meshes retained');
}
