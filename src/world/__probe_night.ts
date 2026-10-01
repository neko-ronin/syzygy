/**
 * Night-market light accounting for R2. Run with:
 *
 *   npx vite-node src/world/__probe_night.ts
 *
 * Prints, at the reviewed market poses, the light harvest that actually reaches
 * `BakedChunk.lights` — the array `renderer.gatherLights()` reads — plus the
 * deck-level pool arithmetic and whether a lantern is even in frame.
 *
 * This exists because that number was nowhere in the tree and its absence is
 * invisible. `MAX_MARKET_LIGHTS_PER_CHUNK` is 48 and `LANTERN_LIGHT_INTENSITY`
 * is 3.0 and the self-test reports "341 lights" for the market, and every one
 * of those numbers describes lights that are then discarded before they reach
 * the renderer. `docs/NIGHT_REPORT.md` has the full story; the short version is
 * that the grammar's light list and the renderer's light list are two different
 * lists and only one of them is drawn.
 *
 * `bakeGroundDetail` is called here with the same signature and the same sink
 * the renderer uses, so the totals below are the real ones, not a prediction.
 */

import { makeRng } from '../core/math';
import { districtField, spineHit, spinePoint } from './districts';
import { City, defaultCityConfig, GROUND_Y, type CityChunk } from './citygen';
import { MeshBuilder } from './geometry';
import { bakeChunk } from '../render/citymesh';
import { bakeGroundDetail, type GroundLight } from '../render/groundbake';
import {
  LANTERN_LIGHT_INTENSITY, LANTERN_LIGHT_RADIUS, marketGrammarFor,
} from './marketgrammar';

const SEED = 0x5e7a17;
const L = (...a: unknown[]): void => { console.log(...a); };

/** The four poses the review gate names, from docs/MARKET_REPORT.md §7. */
const POSES: [string, [number, number, number]][] = [
  ['DOWN_THE_STREET', [1.16, 2.6, 0.36]],
  ['THREE_QUARTER  ', [4.8, 3.4, 32.58]],
  ['LOOKING_BACK   ', [11.04, 2.3, -38.46]],
  ['ALONG_THE_ROW  ', [-13.34, 2.9, -3.47]],
];

/** The exact attenuation `lighting.wgsl` applies to a clustered light. */
const atten = (d2: number, r: number): number =>
  Math.pow(Math.max(1 - d2 / (r * r), 0), 2) / (1 + d2 * 0.05);

function main(): void {
  const city = new City(defaultCityConfig(SEED));
  const chunks: CityChunk[] = [];
  for (let cz = -3; cz <= 3; cz++) {
    for (let cx = -3; cx <= 3; cx++) {
      const c = city.getChunk(cx, cz);
      if (c) chunks.push(c);
    }
  }
  const live = chunks.filter((c) => c.buildings.length + c.props.length > 0);
  L(`chunks baked: ${live.length}`);

  // --- harvest exactly as the renderer would, per chunk.
  const perChunk: { key: string; lights: GroundLight[]; market: number }[] = [];
  for (const c of live) {
    const bld = new MeshBuilder();
    const rng = makeRng(0x51a7e ^ (c.cx * 7919) ^ (c.cz * 104729));
    const lights: GroundLight[] = [];
    bakeGroundDetail(bld, c, city.plan, 0, rng, lights);
    // How many the market grammar produced for the same chunk. Re-derived, not
    // predicted: the grammar is a pure function of (seed, plan, chunk, kind).
    const desc = marketGrammarFor({
      seed: SEED, plan: city.plan, chunk: c, kind: 'market', districtId: 0,
    });
    perChunk.push({ key: `${c.cx},${c.cz}`, lights, market: desc.lights.length });
  }

  const totalGround = perChunk.reduce((a, p) => a + p.lights.length, 0);
  const totalMarket = perChunk.reduce((a, p) => a + p.market, 0);
  L('');
  L('per-chunk light harvest (bakeGroundDetail -> BakedChunk.lights -> gatherLights)');
  L('  chunk    harvested   marketGrammar.lights   radii');
  for (const p of perChunk) {
    if (p.lights.length === 0 && p.market === 0) continue;
    const rads = p.lights.map((l) => l.radius).sort((a, b) => b - a);
    L(`  ${p.key.padEnd(8)} ${String(p.lights.length).padStart(9)} ` +
      `${String(p.market).padStart(22)}   ${rads.slice(0, 4).map((r) => r.toFixed(0)).join(',') || '-'}`);
  }
  L('');
  L(`  TOTAL harvested into the render light buffer: ${totalGround}`);
  L(`  TOTAL market-grammar lights the grammar produced: ${totalMarket}`);
  L('  -> a large gap here is the whole of NIGHT_REPORT.md cause 2: the grammar');
  L('     emits lights, bakeGroundDetail has no market light sink, and the');
  L('     renderer therefore gathers none of them. See marketbake.ts header.');

  // --- where does the camera stand, and what reaches the deck under it?
  const GROUND: number = GROUND_Y;
  L('');
  L('deck-level warm irradiance from ONE lantern, by lateral offset (metres)');
  L('  (this is the arithmetic working; it is not what the frame shows)');
  L('pose              drop   0m     2m     4m     6m     8m    10m    12m');
  const drops: number[] = [];
  for (const [name, p] of POSES) {
    let best = Infinity;
    let bestY = 0;
    for (const c of live) {
      const desc = marketGrammarFor({
        seed: SEED, plan: city.plan, chunk: c, kind: 'market', districtId: 0,
      });
      for (const l of desc.lights) {
        const d = Math.hypot(l.pos[0] - p[0], l.pos[2] - p[2]);
        if (d < best) { best = d; bestY = l.pos[1]; }
      }
    }
    const drop = bestY - GROUND;
    drops.push(drop);
    const row: string[] = [];
    for (const lat of [0, 2, 4, 6, 8, 10, 12]) {
      const d2 = drop * drop + lat * lat;
      row.push((atten(d2, LANTERN_LIGHT_RADIUS) * LANTERN_LIGHT_INTENSITY).toFixed(3));
    }
    L(`  ${name}  ${drop.toFixed(1).padStart(4)}  ` + row.map((r) => r.padStart(6)).join(' '));
  }

  // --- where the spine actually runs at the origin, so a GPU pose looks DOWN it
  // rather than across it (PROCESS rule 4: print both positions).
  const field = districtField(SEED);
  const t = spinePoint(field.market, 0);
  const hit = spineHit(field.market, t[0], t[1], { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, along: 0 });
  L('');
  L('market spine at along=0');
  L(`  centre  [${t[0].toFixed(2)}, ${t[1].toFixed(2)}]  tangent [${hit.tx.toFixed(4)}, ${hit.tz.toFixed(4)}]`);
  L(`  bearing ${Math.atan2(hit.tz, hit.tx).toFixed(4)} rad,  corridor ${field.market.width.toFixed(1)}m`);
  L('  this is the origin, which is a chunk CORNER: chunk (0,0) itself carries 0');
  L('  stalls / 0 cords / 0 lights. The market either side lives in (0,-1) and');
  L('  (-1,0), both within LOD 0 range. See capture.mjs pose 09-market-down.');

  // --- is a lantern even IN FRAME, and are any lights near the pose?
  L('');
  L('lantern visibility and nearest light, per pose');
  for (const [name, p] of POSES) {
    const fwd: [number, number] = [hit.tx, hit.tz];
    let inFrame = 0, nearestLantern = Infinity, nearestLight = Infinity, lightCount30 = 0;
    for (const c of live) {
      const desc = marketGrammarFor({
        seed: SEED, plan: city.plan, chunk: c, kind: 'market', districtId: 0,
      });
      for (const str of desc.strings) {
        for (const l of str.lanterns) {
          const dx = l.pos[0] - p[0], dz = l.pos[2] - p[2];
          const d = Math.hypot(dx, dz, l.pos[1] - 2.6);
          const dot = (dx * fwd[0] + dz * fwd[1]) / (Math.hypot(dx, dz) || 1);
          if (d < 70 && dot > 0.82) { inFrame++; if (d < nearestLantern) nearestLantern = d; }
        }
      }
      const baked = bakeChunk(c, 0, SEED);
      for (const l of baked.lights) {
        const d = Math.hypot(l.pos[0] - p[0], l.pos[2] - p[2]);
        if (d < nearestLight) nearestLight = d;
        if (d < 30) lightCount30++;
      }
    }
    L(`  ${name}: ${inFrame} lanterns in frame <70m, nearest ${nearestLantern.toFixed(1)}m; ` +
      `${lightCount30} lights within 30m, nearest ${nearestLight.toFixed(1)}m`);
  }

  // --- the night ambient the shader will actually apply to that deck.
  L('');
  L('night ambient on an up-facing deck, skyIrradiance(N=+Y)');
  const amb: [number, number, number] = [0x1d / 255, 0x25 / 255, 0x47 / 255];
  const srgbToLinear = (v: number): number =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const ambLin = amb.map(srgbToLinear) as [number, number, number];
  const AI = 0.66;
  const irr = ambLin.map((v) => v * 1.15 * AI);
  L(`  ambient colour #1d2547 -> linear ${ambLin.map((v) => v.toFixed(4)).join(', ')}`);
  L(`  ambientIntensity      ${AI}   (was 0.22 before the R2 authoring pass)`);
  L(`  irradiance on +Y      ${irr.map((v) => v.toFixed(5)).join(', ')}`);
  for (const [i, d] of drops.entries()) {
    const pool0 = atten(d * d, LANTERN_LIGHT_RADIUS) * LANTERN_LIGHT_INTENSITY;
    L(`  pool/ambient at 0m, ${POSES[i][0]}: ${(pool0 / Math.max(irr[0], 1e-6)).toFixed(1)}x on red`);
  }
  L('  -> the pool is ~50-80x the ambient even after the 3x ambient lift. It is');
  L('     not faint; it is ABSENT, because the light that would make it never');
  L('     enters the buffer. That is why no amount of exposure or ambient');
  L('     authoring produces a warm pool.');
}

main();
