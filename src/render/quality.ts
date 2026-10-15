/**
 * Quality tiers and the level-of-detail policy.
 *
 * Pure data, no GPU types, no browser globals, so `src/render/__perftest.ts`
 * can assert on it headlessly.
 *
 * LOD is here because it was the most expensive phantom in the repository.
 * `bakeChunk` had a fully implemented `lod` parameter with 21 gates in the bake,
 * and every tier set `lodRange` — and the one call site passed the literal `0`,
 * while `lodRange` was read nowhere. So the detail levels had never run in the
 * shipped build. Nothing failed: the parameter was accepted, the gates existed,
 * and LOD 0 is the correct answer for a chunk at zero distance. A name is not a
 * feature (PROCESS.md rule 5).
 *
 * The measured payoff, re-derived by the self-test from real bakes: a chunk is
 * ~75k triangles at LOD 0, ~27k at LOD 1, ~9k at LOD 2.
 */

export type QualityTier = 'potato' | 'low' | 'medium' | 'high' | 'ultra';

export interface QualitySettings {
  tier: QualityTier;
  /** Backbuffer scale. Above 1 is supersampling. */
  renderScale: number;
  shadowRes: number;
  cascades: number;
  /** [minLod, maxLod]. `maxLod` is the detail ceiling this tier can reach. */
  lodRange: [number, number];
  bloomLevels: number;
  dofEnabled: boolean;
  taaEnabled: boolean;
  /** Static city draw distance in chunks. */
  viewDistance: number;
  foliageEnabled: boolean;
}

// viewDistance floors at 7 on every tier. Dropping it with the tier cut the
// downtown peak (~1.5 km) out of the skyline view on potato; far chunks are
// already LOD 3, so the governor saves more elsewhere for little visible loss.
export const TIERS: Record<QualityTier, Omit<QualitySettings, 'tier'>> = {
  potato: { renderScale: 0.6, shadowRes: 1024, cascades: 2, lodRange: [0, 3], bloomLevels: 3, dofEnabled: false, taaEnabled: true, viewDistance: 7, foliageEnabled: false },
  low: { renderScale: 0.75, shadowRes: 1024, cascades: 3, lodRange: [0, 3], bloomLevels: 4, dofEnabled: true, taaEnabled: true, viewDistance: 7, foliageEnabled: true },
  medium: { renderScale: 1.0, shadowRes: 2048, cascades: 4, lodRange: [0, 2], bloomLevels: 4, dofEnabled: true, taaEnabled: true, viewDistance: 7, foliageEnabled: true },
  high: { renderScale: 1.0, shadowRes: 2048, cascades: 4, lodRange: [0, 1], bloomLevels: 5, dofEnabled: true, taaEnabled: true, viewDistance: 7, foliageEnabled: true },
  ultra: { renderScale: 1.35, shadowRes: 4096, cascades: 4, lodRange: [0, 0], bloomLevels: 6, dofEnabled: true, taaEnabled: true, viewDistance: 9, foliageEnabled: true },
};

/**
 * Chunk distances at which the detail level steps up, in chunks (not metres).
 *
 * 1.6 chunks is ~410m at the default 256m chunk size, chosen so the street the
 * camera is actually flying down keeps full detail while everything past the
 * first couple of blocks drops a level. Expressed in chunk units rather than
 * metres so it survives a chunk-size change.
 */
export const LOD_CHUNK_STEP = 1.6;

/**
 * Detail level for a chunk `distChunks` from the camera's chunk, clamped to the
 * tier's own ceiling. `lodRange[1]` is therefore a real budget control:
 * `ultra` pins every chunk to LOD 0 and `potato` lets the policy reach LOD 3.
 */
export function lodForDistance(
  distChunks: number, q: Pick<QualitySettings, 'lodRange'>,
): number {
  const maxLod = q.lodRange[1];
  const want = Math.floor(Math.max(0, distChunks) / LOD_CHUNK_STEP);
  return Math.max(0, Math.min(maxLod, want));
}

/**
 * Chunk-grid distance between two chunk coordinates. Euclidean rather than
 * Chebyshev so that it matches the sort order `streamChunks` uses to choose what
 * to bake next — the two must agree or the residency set and the detail level
 * disagree about what is near.
 */
export function chunkDistance(cx: number, cz: number, pcx: number, pcz: number): number {
  return Math.hypot(cx - pcx, cz - pcz);
}