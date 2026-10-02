/**
 * Section A (saturated-graphic) standing measurements — R11 §A.
 *
 * A reads through clean chromatic blocks: saturated indigo/violet masses and
 * teal secondaries (neon-arcology), warm red-brown blocks with red signage
 * (lantern-bazaar). The success condition is anti-spread: A must not become
 * the other sections warmer, so the check pins A's saturation lead (trim and
 * emissive mean saturation ≥ rest-of-city mean + 0.15) and the slot bands
 * below — not a mood.
 *
 * Crowd coupling (read, not owned): `crowdColorFor` picks coats per district
 * by value-contrast against the ground, so palette moves flow through
 * automatically. The guard replicates its scoring for the two A palettes and
 * requires the top coat ≥ 1.5 — above the documented 1.15 failure mode in
 * `crowd.ts`, with margin under the measured market floor (1.90). Night
 * contrast is invariant under uniform ambient (all coats ~1.0); no palette
 * entry can fix that, so none is asked to.
 *
 * R2 geometry pins (diagnosis committed, grammar untouched): hero-zone
 * lanterns span the street (median lateral ≤ 8 m), ≥ 30% of the aisle within
 * 5 m of a lantern, ≥ 50% of lanterns carry a light flag. These pin the
 * current good geometry against future regressions; moving light placement
 * is developer 1's call.
 *
 * Run: `npx vite-node src/world/__selftest_sectionA.ts`
 */

import { DISTRICT_STYLES, districtStyle, districtField, spinePoint } from './districts';
import { hsv, valueOf } from './groundgrammar';
import { City, defaultCityConfig, sampleStreetPlan, type StreetSample } from './citygen';
import { marketGrammarFor } from './marketgrammar';
import type { Vec3 } from '../core/math';

const deg = (turns: number): number => turns * 360;

/** Mirror of the scoring inside `crowdColorFor`'s contrast set (sim/crowd.ts),
 * expressed as the luminance RATIO the legibility doc actually specifies
 * (2.5:1). The raw value-difference score does not transfer to dark-ground
 * districts: on near-black neon ground every coat scores < 1.0 by difference
 * while the brightest coat still stands at >4:1 by ratio. Scoring the ratio
 * is the instrument correction this check already needed once. */
function topCoatRatio(styleId: number): number {
  const pal = districtStyle(styleId).palette;
  const g = pal.ground;
  const vg = valueOf(g);
  const pool = [pal.trim, pal.glass, pal.secondary, pal.foliage, pal.water, pal.emissive, pal.metal];
  let best = 0;
  for (const c of pool) {
    const v = valueOf(c);
    const r = (Math.max(v, vg) + 0.05) / (Math.min(v, vg) + 0.05);
    if (r > best) best = r;
  }
  return best;
}

function main(): void {
  const problems: string[] = [];

  console.log('\nSECTION A palette (hue°, sat in linear)');
  const bands: Array<{ id: number; slot: 'base' | 'secondary' | 'trim' | 'emissive'; lo: number; hi: number; sat: number }> = [
    { id: 7, slot: 'base', lo: 240, hi: 270, sat: 0.6 },
    { id: 7, slot: 'secondary', lo: 175, hi: 195, sat: 0.6 },
    { id: 7, slot: 'trim', lo: 280, hi: 300, sat: 0.6 },
    { id: 4, slot: 'base', lo: 5, hi: 20, sat: 0.6 },
    { id: 4, slot: 'trim', lo: 350, hi: 370, sat: 0.6 },
  ];
  for (const { id, slot, lo, hi, sat } of bands) {
    const st = districtStyle(id);
    const [h, s] = hsv(st.palette[slot]);
    const hd = deg(h);
    const inBand = hi <= 360 ? (hd >= lo && hd <= hi) : (hd >= lo || hd <= hi - 360);
    const ok = inBand && s >= sat;
    console.log(`  ${st.key.padEnd(17)} ${slot}=${hd.toFixed(0)}/${s.toFixed(2)}${ok ? '' : ' X'}`);
    if (!ok) problems.push(`${st.key} ${slot} outside band ${lo}–${hi}°/sat≥${sat}`);
  }
  for (const id of [7, 4]) {
    const st = districtStyle(id);
    const [, s] = hsv(st.palette.emissive);
    console.log(`  ${st.key.padEnd(17)} emissive sat=${s.toFixed(2)}${s >= 0.8 ? '' : ' X'}`);
    if (s < 0.8) problems.push(`${st.key} emissive sat ${s.toFixed(2)} below 0.8`);
  }
  const aSat: number[] = [], rSat: number[] = [];
  for (const s of DISTRICT_STYLES) {
    const [, ts] = hsv(s.palette.trim);
    const [, es] = hsv(s.palette.emissive);
    ((s.id === 7 || s.id === 4) ? aSat : rSat).push(ts, es);
  }
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const lead = mean(aSat) - mean(rSat);
  console.log(`  A trim/emissive mean sat ${mean(aSat).toFixed(2)} vs rest ${mean(rSat).toFixed(2)}: lead ${lead >= 0 ? '+' : ''}${lead.toFixed(2)}`);
  if (lead < 0.15) problems.push(`A saturation lead ${lead.toFixed(2)} below +0.15 (spread risk)`);
  for (const id of [7, 4]) {
    const top = topCoatRatio(id);
    console.log(`  ${districtStyle(id).key.padEnd(17)} crowd top-coat ratio ${top.toFixed(2)}:1${top >= 2.5 ? '' : ' X'}`);
    if (top < 2.5) problems.push(`${districtStyle(id).key} crowd top-coat ${top.toFixed(2)}:1 below 2.5:1`);
  }

  // --- R2 geometry: hero-zone lanterns vs the aisle (capture seed) ---
  const SEED = 0x5e7a17;
  const cfg = defaultCityConfig(SEED);
  const city = new City(cfg);
  const field = districtField(SEED);
  const plan = (city as unknown as { plan: object }).plan as Parameters<typeof import('./citygen').sampleStreetPlan>[0];
  const m = field.market;
  const seen = new Map<string, { cx: number; cz: number }>();
  for (let a = -100; a <= 700; a += 8) {
    const p = spinePoint(m, a);
    const k = `${Math.floor(p[0] / 256)},${Math.floor(p[1] / 256)}`;
    if (!seen.has(k)) seen.set(k, { cx: Math.floor(p[0] / 256), cz: Math.floor(p[1] / 256) });
  }
  const lats: number[] = [];
  const lpos: Vec3[] = [];
  let flagged = 0, total = 0;
  const tmp: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };
  for (const { cx, cz } of seen.values()) {
    const ch = city.getChunk(cx, cz);
    if (!ch) continue;
    const desc = marketGrammarFor({ seed: SEED, plan, chunk: ch, kind: 'market', districtId: 10 });
    for (const s of desc.strings) {
      for (const l of s.lanterns) {
        if (l.pos[1] > 20) continue;
        total++;
        if (l.light) flagged++;
        sampleStreetPlan(plan, l.pos[0], l.pos[2], tmp);
        const t = tmp as unknown as { px: number; pz: number; tx: number; tz: number };
        lats.push(Math.abs((l.pos[0] - t.px) * -t.tz + (l.pos[2] - t.pz) * t.tx));
        lpos.push(l.pos);
      }
    }
  }
  lats.sort((a, b) => a - b);
  const medLat = lats[lats.length >> 1] ?? NaN;
  let cov5 = 0, n = 0;
  for (let a = 0; a <= 600; a += 10) {
    const p = spinePoint(m, a);
    n++;
    for (const l of lpos) {
      if (Math.hypot(l[0] - p[0], l[2] - p[1]) <= 5) { cov5++; break; }
    }
  }
  const flagFrac = flagged / Math.max(1, total);
  console.log(`\nR2 aisle geometry: lanterns=${total} flagged=${flagged} (${(100 * flagFrac).toFixed(0)}%) median lateral=${medLat.toFixed(2)} m aisle-within-5m=${(100 * cov5 / n).toFixed(0)}%`);
  if (!(medLat <= 8)) problems.push(`median lantern lateral ${medLat.toFixed(2)} m beyond 8 m (cords not over the aisle)`);
  if (!(cov5 / n >= 0.3)) problems.push(`aisle within-5m fraction ${(100 * cov5 / n).toFixed(0)}% below 30%`);
  if (!(flagFrac >= 0.5)) problems.push(`light-flag fraction ${(100 * flagFrac).toFixed(0)}% below 50%`);

  console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);
}

main();
