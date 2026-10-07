/** GPU-free regressions for the emission authority that diagnostics and crowd consume. */
import { City, defaultCityConfig, GROUND_Y } from '../world/citygen';
import { deriveHeroWalk } from '../world/diagnosticposes';
import { groundGrammarFor, groundSurfaceTag, decodeGroundSurfaceTag, GROUND_SURFACE_CLASSES, BAND_ORDER } from '../world/groundgrammar';
import { COUNTER_TOP, marketGrammarFor } from '../world/marketgrammar';
import { MeshBuilder } from '../world/geometry';
import { makeRng } from '../core/math';
import { bakeChunk } from './citymesh';
import { bakeMarketDetail, marketBakeState } from './marketbake';

function requireThat(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}
const seed = 6191639;
const city = new City(defaultCityConfig(seed));
const chunk = city.getChunk(0, -2);
requireThat(chunk, 'fixture chunk must exist');
const mesh = new MeshBuilder();
const state = marketBakeState();
const ctx = { builder: mesh, rng: makeRng(seed), plan: city.plan, chunk, lod: 0, seed,
  frame: { lateral: 0, along: 0, tx: 0, tz: -1, nx: 1, nz: 0, width: 28, kind: 'market' as const, districtId: 2, clearance: -1, px: 0, pz: 0 },
  grammar: groundGrammarFor(2, 'market') };
const emitted = bakeMarketDetail(mesh, ctx, state);
const geometry = mesh.build();
requireThat(emitted.stalls.some((s) => s.module === 'bare'), 'fixture must exercise an open-air pitch');
for (const s of emitted.stalls) {
  const counter = emitted.obstacles.find((o) => o.kind === 'market-counter' && Math.hypot(o.x - s.cx - s.nx * s.counter, o.z - s.cz - s.nz * s.counter) < 1e-8);
  requireThat(counter, `emitted ${s.module} pitch must have its actual counter`);
  requireThat(counter.minY === GROUND_Y && counter.maxY === GROUND_Y + COUNTER_TOP, 'counter contact must match the ground and worktop');
  for (const along of [-counter.halfAlong, counter.halfAlong]) {
    for (const across of [-counter.halfAcross, counter.halfAcross]) {
      for (const y of [counter.minY, counter.maxY]) {
        const x = counter.x + s.tx * along + s.nx * across;
        const z = counter.z + s.tz * along + s.nz * across;
        let present = false;
        for (let i = 0; i < geometry.positions.length; i += 3) {
          if (Math.hypot(geometry.positions[i] - x, geometry.positions[i + 1] - y, geometry.positions[i + 2] - z) < 0.0001) { present = true; break; }
        }
        requireThat(present, `${s.module} obstacle corner must be present in the emitted counter mesh`);
      }
    }
  }
}
const before = mesh.indexCount;
bakeMarketDetail(mesh, ctx, state);
requireThat(mesh.indexCount === before, 'revisiting a trace must not emit a second copy of the same market');
const baked = bakeChunk(chunk, 0, seed);
for (const surface of GROUND_SURFACE_CLASSES) {
  for (const family of BAND_ORDER) {
    const packed = Math.fround(groundSurfaceTag(surface, family, 0.14));
    const decoded = decodeGroundSurfaceTag(packed);
    requireThat(decoded.surface === surface && decoded.family === family && Math.abs(decoded.height - 0.14) < 0.00001, 'ground class/family/height must survive Float32 upload independently of colour');
  }
}
const groundClasses = new Set<string>();
const kerbTris: Record<string, { keys: string[]; ys: number[] }[]> = {};
for (let t = 0; t < baked.opaque.indices.length; t += 3) {
  const vertices = Array.from(baked.opaque.indices.subarray(t, t + 3));
  const tags = vertices.map((i) => baked.opaque.colors[i * 4 + 3]);
  if (tags[0] >= 0) continue;
  requireThat(tags.every((tag) => tag === tags[0]), 'a ground primitive cannot interpolate between material identities');
  const decoded = decodeGroundSurfaceTag(tags[0]);
  requireThat(decoded.surface && decoded.family, 'every actual tagged triangle must have a valid authored class and family');
  if (decoded.surface === 'carriageway') {
    const [a, b, c] = vertices.map((i) => baked.opaque.positions.subarray(i * 3, i * 3 + 3));
    const up = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    requireThat(up > 0, 'both emitted road halves must face upward, matching their authored normal');
  }
  groundClasses.add(decoded.surface);
  {
    const [a, b, c] = vertices.map((i) => baked.opaque.positions.subarray(i * 3, i * 3 + 3));
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = baked.opaque.normals.subarray(vertices[0] * 3, vertices[0] * 3 + 3);
    const g = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const cos = (g[0] * n[0] + g[1] * n[1] + g[2] * n[2]) / (Math.hypot(g[0], g[1], g[2]) * Math.hypot(n[0], n[1], n[2]) || 1);
    // Tolerances admit edge-on normals and sub-pixel slivers whose sign
    // Float32 upload can flip; opposed winding on real area still fails.
    requireThat(cos > -0.05 || Math.hypot(g[0], g[1], g[2]) < 1e-3, `${decoded.surface} winding must face its authored normal, or the back-face cull hides it`);
  }
  const keys = vertices.map((i) => Array.from(baked.opaque.positions.subarray(i * 3, i * 3 + 3), (v) => v.toFixed(4)).join(','));
  (kerbTris[decoded.surface] ??= []).push({ keys, ys: vertices.map((i) => baked.opaque.positions[i * 3 + 1]) });
}
requireThat(groundClasses.has('carriageway') && groundClasses.has('paving') && groundClasses.has('kerb-face'), 'real road, walking and face geometry must carry distinct surface inputs');
// The kerb top must close the face's upper edge, not repeat the footway.
const topVerts = new Set((kerbTris['kerb-top'] ?? []).flatMap((t) => t.keys));
const pavingTris = new Set((kerbTris['paving'] ?? []).map((t) => [...t.keys].sort().join('|')));
requireThat(topVerts.size > 0, 'fixture must emit kerb tops');
for (const t of kerbTris['kerb-face'] ?? []) {
  const top = Math.max(...t.ys);
  t.keys.forEach((k, i) => requireThat(t.ys[i] < top - 1e-4 || topVerts.has(k), 'every kerb face upper edge must meet an emitted kerb top'));
}
for (const t of kerbTris['kerb-top'] ?? []) requireThat(!pavingTris.has([...t.keys].sort().join('|')), 'a kerb top must not duplicate a footway triangle');
requireThat(new Set(baked.marketStalls.map((s) => `${s.along}:${s.side}`)).size === baked.marketStalls.length, 'chunk must own each physical market pitch once');
const expected = marketGrammarFor({ seed, plan: city.plan, chunk, kind: 'market', districtId: 2 });
const expectedSubject = expected.stalls.filter((s) => s.side === 1 && s.along >= 422 && s.along <= 431);
requireThat(expectedSubject.length > 0, 'live-seed comparison must exercise real emitted subjects');
for (const st of expectedSubject) {
  const actual = baked.marketStalls.find((s) => s.along === st.along && s.side === st.side);
  requireThat(actual && actual.module === st.module && actual.pitch === st.pitch, 'baked subject must belong to the live seed, not seed zero');
}
const missing = deriveHeroWalk(city.plan, seed, []);
requireThat(!missing.ok && missing.chunksMissing.length > 0, 'unknown coverage must refuse');
const chunks = missing.chunksMissing.flatMap((key) => {
  const [cx, cz] = key.split(',').map(Number);
  const c = city.getChunk(cx, cz);
  return c ? [c] : [];
});
const absentEmission = deriveHeroWalk(city.plan, seed, chunks, new Map());
requireThat(!absentEmission.ok && absentEmission.chunksMissing.length > 0, 'a supplied map with missing emission keys must refuse instead of reconstructing');
const knownEmpty = new Map(chunks.map((c) => [`${c.cx},${c.cz}`, []]));
const emptyEmission = deriveHeroWalk(city.plan, seed, chunks, knownEmpty);
requireThat(!emptyEmission.ok && emptyEmission.chunksMissing.length === 0, 'evaluated empty emissions are known absence, not unknown coverage');
console.log('GROUND CONTRACT ALL PASS: every open-air counter is supported; repeated traces do not duplicate geometry; emitted hero subjects use the live seed');
