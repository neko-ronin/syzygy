/**
 * Section D (verdant-solarpunk) standing measurements — R11 §D baseline.
 *
 * Verdict this file encodes: §D is judgeable without godrays (closed in
 * 6a47405, and absent from all six sheet frames) and without water for every
 * pose except canal-base ones (water appears in 1 of 6 sheet frames; the
 * water mesh is empty by construction and unreferenced by the renderer).
 * So this check pins what §D already has: green/cream district identity
 * distinct from B steel, and heavy planting presence.
 *
 * - verdant-canyon base warm pale (hue 20–60°), botanical-dome base green
 *   (90–130°); neither inside the B steel band (195–230°). Foliage saturated
 *   green (sat ≥ 0.5): D reads through plants, not through grey-green.
 * - verdant-canyon and botanical-dome each carry ≥ 8 planting props
 *   (Planter/VineCurtain/PottedTree) per building at the capture seed.
 *   monastery-spire carries more per building (tall facades accumulate sill
 *   planters) — that is authored herb-garden identity, not a failure, so the
 *   guard is a floor per D district, not a rank.
 *
 * Known gaps, deliberately NOT asserted here: facade timber exists nowhere
 * (timber lives only in groundbake clutter); canal-district serves two
 * sections (B steel since round 3 vs D timber-canal) and wants a reviewer
 * ruling; canal-base poses want water that does not exist.
 *
 * Run: `npx vite-node src/world/__selftest_sectionD.ts`
 */

import { DISTRICT_STYLES, districtStyle } from './districts';
import { hsv } from './groundgrammar';
import { City, defaultCityConfig, PropKind } from './citygen';

const deg = (turns: number): number => turns * 360;

function main(): void {
  const problems: string[] = [];

  console.log('\nSECTION D palette (hue°, sat in linear)');
  const dspec: Array<{ id: number; hLo: number; hHi: number; why: string }> = [
    { id: 0, hLo: 20, hHi: 60, why: 'warm pale stone' },
    { id: 8, hLo: 90, hHi: 130, why: 'green glasshouse' },
  ];
  for (const { id, hLo, hHi, why } of dspec) {
    const st = districtStyle(id);
    const [h, s] = hsv(st.palette.base);
    const hd = deg(h);
    const ok = hd >= hLo && hd <= hHi;
    console.log(`  ${st.key.padEnd(17)} base h=${hd.toFixed(0)} s=${s.toFixed(2)} (${why})${ok ? '' : ' X'}`);
    if (!ok) problems.push(`${st.key} base hue ${hd.toFixed(0)}° outside ${hLo}–${hHi}°`);
    const [fh, fs] = hsv(st.palette.foliage);
    const fhd = deg(fh);
    const fok = fhd >= 90 && fhd <= 150 && fs >= 0.5;
    console.log(`  ${st.key.padEnd(17)} foliage h=${fhd.toFixed(0)} s=${fs.toFixed(2)}${fok ? '' : ' X'}`);
    if (!fok) problems.push(`${st.key} foliage not saturated green`);
  }
  // Distinct from B steel, both directions: D must not drift into 195–230°.
  for (const id of [0, 8]) {
    const hd = deg(hsv(districtStyle(id).palette.base)[0]);
    if (hd >= 195 && hd <= 230) problems.push(`${districtStyle(id).key} homogenised into B steel`);
  }

  const SEED = 0x5e7a17;
  const cfg = defaultCityConfig(SEED);
  const city = new City(cfg);
  const GREEN = new Set([PropKind.Planter, PropKind.VineCurtain, PropKind.PottedTree]);
  const perD = new Map<number, { b: number; g: number }>();
  for (let x = -cfg.radiusChunks; x <= cfg.radiusChunks; x++) {
    for (let z = -cfg.radiusChunks; z <= cfg.radiusChunks; z++) {
      const ch = city.getChunk(x, z);
      if (!ch) continue;
      for (const b of ch.buildings) {
        const hx = b.halfExtents[0] + 3, hz = b.halfExtents[2] + 3;
        let g = 0;
        for (const p of ch.props) {
          if (!GREEN.has(p.kind)) continue;
          if (Math.abs(p.position[0] - b.position[0]) > hx) continue;
          if (Math.abs(p.position[2] - b.position[2]) > hz) continue;
          g++;
        }
        const e = perD.get(b.districtId) ?? { b: 0, g: 0 };
        e.b++; e.g += g;
        perD.set(b.districtId, e);
      }
    }
  }
  console.log('planting props per building:');
  for (const [d, v] of [...perD.entries()].sort((a, b) => b[1].g / b[1].b - a[1].g / a[1].b)) {
    const per = v.g / v.b;
    console.log(`  ${DISTRICT_STYLES[d].key.padEnd(17)} n=${v.b.toString().padStart(4)} green/bldg=${per.toFixed(2)}`);
    if ((d === 0 || d === 8) && per < 8) problems.push(`${DISTRICT_STYLES[d].key} planting ${per.toFixed(2)}/bldg below 8`);
  }

  console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);
}

main();
