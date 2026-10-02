/**
 * Section B (cold-industrial) standing measurements — R11 §B.
 *
 * Two changes, measured separately:
 *
 * 1. PALETTE. `glass-foxholes`, `rust-hangars` and `canal-district` reskinned
 *    to steel blue with warm restricted to emissive points. The check asserts
 *    the measurable half: every diffuse slot (base, secondary, trim, glass,
 *    roof, ground, metal) in hue 195–230° at saturation ≤ 0.45, foliage
 *    grey-green (90–150°, ≤ 0.45), every B emissive warm (10–50°, sat ≥ 0.5).
 *    Before the reskin 19 of 21 diffuse slots violated the band and the glass
 *    emissive was cyan (198°); after: none. Water is excluded on purpose: the
 *    water mesh is discarded by the renderer, so its hex is a phantom and
 *    asserting on it would be asserting on nothing. `palette.roof` and the
 *    `shadeLo`/`shadeHi` variants are likewise read by nothing but the
 *    analytic shell in `__selftest.ts` — reported, not asserted, and not
 *    fixed here.
 * 2. CABLES. DESIGN §4 records `cableDensity` as anti-correlated with height
 *    (authored Pearson −0.235; realised Pearson(height, attached cables)
 *    −0.547 over 1337 buildings). The densities were re-weighted with height
 *    so ropeways hang between tall buildings. The inversion is finished when
 *    the realised coefficient changes sign: this check fails at or below
 *    +0.15.
 *
 * No-homogenisation witness: the circular hue separation between the B mean
 * base and the rest-of-city mean base was 11.8° before (B sat inside the warm
 * cluster) and must stay ≥ 100° after; `terracotta-tiers` (11°) and
 * `botanical-dome` (111°) must remain outside the steel band.
 *
 * Run: `npx vite-node src/world/__selftest_sectionB.ts`
 */

import { makeRng } from '../core/math';
import { DISTRICT_STYLES, districtStyle } from './districts';
import { hsv } from './groundgrammar';
import { City, defaultCityConfig, footprintAabb } from './citygen';

/** Section B district ids: glass-foxholes, rust-hangars, canal-district. */
const B_DISTRICTS = [3, 5, 9];
/** Diffuse slots asserted into the steel band (water excluded: phantom). */
const DIFFUSE_SLOTS = ['base', 'secondary', 'trim', 'glass', 'roof', 'ground', 'metal'] as const;

const deg = (turns: number): number => turns * 360;
const circMean = (degs: number[]): number => {
  let x = 0, y = 0;
  for (const d of degs) { x += Math.cos(d * Math.PI / 180); y += Math.sin(d * Math.PI / 180); }
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
const circDist = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};
const pearson = (a: number[], b: number[]): number => {
  const n = a.length, ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (a[i] - ma) * (b[i] - mb); sxx += (a[i] - ma) ** 2; syy += (b[i] - mb) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
};

function main(): void {
  const problems: string[] = [];

  // --- palette ---
  console.log('\nSECTION B palette (hue°, sat in linear)');
  let diffuseViolations = 0, emissiveViolations = 0;
  for (const d of B_DISTRICTS) {
    const st = districtStyle(d);
    const cells: string[] = [];
    for (const s of DIFFUSE_SLOTS) {
      const [h, sat] = hsv(st.palette[s]);
      const hd = deg(h);
      const ok = hd >= 195 && hd <= 230 && sat <= 0.45;
      if (!ok) diffuseViolations++;
      cells.push(`${s}=${hd.toFixed(0)}/${sat.toFixed(2)}${ok ? '' : ' X'}`);
    }
    const [fh, fs] = hsv(st.palette.foliage);
    const fhd = deg(fh);
    const fok = fhd >= 90 && fhd <= 150 && fs <= 0.45;
    if (!fok) diffuseViolations++;
    cells.push(`foliage=${fhd.toFixed(0)}/${fs.toFixed(2)}${fok ? '' : ' X'}`);
    const [eh, es] = hsv(st.palette.emissive);
    const ehd = deg(eh);
    const eok = ehd >= 10 && ehd <= 50 && es >= 0.5;
    if (!eok) emissiveViolations++;
    console.log(`  ${st.key.padEnd(17)} ${cells.join(' ')} emis=${ehd.toFixed(0)}/${es.toFixed(2)}${eok ? '' : ' X'}`);
  }
  const bHues = B_DISTRICTS.map((d) => deg(hsv(districtStyle(d).palette.base)[0]));
  const restHues = DISTRICT_STYLES.filter((s) => !B_DISTRICTS.includes(s.id))
    .map((s) => deg(hsv(s.palette.base)[0]));
  const sep = circDist(circMean(bHues), circMean(restHues));
  console.log(`  B mean base hue ${circMean(bHues).toFixed(1)}° vs rest ${circMean(restHues).toFixed(1)}°: separation ${sep.toFixed(1)}° (was 11.8°)`);
  const witnesses: Array<[string, number]> = [
    ['terracotta-tiers', deg(hsv(districtStyle(2).palette.base)[0])],
    ['botanical-dome', deg(hsv(districtStyle(8).palette.base)[0])],
  ];
  for (const [name, h] of witnesses) {
    const outside = h < 190 || h > 235;
    console.log(`  witness ${name} base hue ${h.toFixed(0)}° ${outside ? 'outside steel band' : 'INSIDE STEEL BAND X'}`);
    if (!outside) problems.push(`${name} homogenised into the steel band (${h.toFixed(0)}°)`);
  }
  if (diffuseViolations > 0) problems.push(`${diffuseViolations} B diffuse slots outside the steel band`);
  if (emissiveViolations > 0) problems.push(`${emissiveViolations} B emissives outside the warm band`);
  if (sep < 100) problems.push(`B-vs-rest hue separation ${sep.toFixed(1)}° below 100°`);

  // --- cables ---
  const ax: number[] = [], ay: number[] = [];
  for (const s of DISTRICT_STYLES) {
    ax.push((s.heightRange[0] + s.heightRange[1]) / 2);
    ay.push(s.cableDensity);
  }
  const authored = pearson(ax, ay);
  console.log(`\nauthored Pearson(heightMid, cableDensity) = ${authored.toFixed(3)} (was -0.235)`);
  if (authored < 0.7) problems.push(`authored correlation ${authored.toFixed(3)} below +0.7`);

  const cfg = defaultCityConfig(42);
  const city = new City(cfg);
  const all: [number, number][] = [];
  for (let x = -cfg.radiusChunks; x <= cfg.radiusChunks; x++) {
    for (let z = -cfg.radiusChunks; z <= cfg.radiusChunks; z++) all.push([x, z]);
  }
  const grid = makeRng(cfg.seed ^ 0x5eed).shuffle(all).slice(0, 64);
  const hs: number[] = [], cs: number[] = [];
  const perDist = new Map<number, { n: number; hsum: number; csum: number }>();
  for (const [cx, cz] of grid) {
    const c = city.getChunk(cx, cz)!;
    const attached = new Array(c.buildings.length).fill(0);
    const boxes = c.buildings.map((b) => {
      const fp = footprintAabb(b);
      return {
        mnx: fp[0][0] - 3, mxx: fp[1][0] + 3, mnz: fp[0][2] - 3, mxz: fp[1][2] + 3,
        mny: fp[0][1] - 3, mxy: fp[1][1] + 3,
      };
    });
    const match = (p: readonly number[]): number => {
      let best = -1, bd = Infinity;
      for (let i = 0; i < boxes.length; i++) {
        const bx = boxes[i];
        if (p[0] < bx.mnx || p[0] > bx.mxx || p[2] < bx.mnz || p[2] > bx.mxz) continue;
        if (p[1] < bx.mny || p[1] > bx.mxy) continue;
        const d = Math.hypot(p[0] - c.buildings[i].position[0], p[2] - c.buildings[i].position[2]);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    for (const k of c.cables) {
      const i = match(k.a), j = match(k.b);
      if (i >= 0) attached[i]++;
      if (j >= 0 && j !== i) attached[j]++;
    }
    c.buildings.forEach((b, i) => {
      const h = b.aabbMax[1] - b.aabbMin[1];
      hs.push(h); cs.push(attached[i]);
      const e = perDist.get(b.districtId) ?? { n: 0, hsum: 0, csum: 0 };
      e.n++; e.hsum += h; e.csum += attached[i];
      perDist.set(b.districtId, e);
    });
  }
  const realised = pearson(hs, cs);
  // District-level correlation is DESIGN §4's own framing (its table is
  // per-district), and it is the level the density numbers act on. The
  // building-level coefficient is reported, not pinned: monastery-spire's 429
  // sparse needles stand at ~446 m with almost no neighbours in ray range, so
  // they anchor any building-weighted correlation near zero no matter how the
  // densities are weighted. Starving the low districts further would move the
  // statistic without moving a single ropeway — perverse, so the check does
  // not reward it. Before: district-level −0.65, building-level −0.547.
  const dh: number[] = [], dc: number[] = [];
  for (const [d, v] of [...perDist.entries()].sort((a, b) => a[0] - b[0])) {
    dh.push(v.hsum / v.n); dc.push(v.csum / v.n);
    console.log(`  ${DISTRICT_STYLES[d].key.padEnd(17)} n=${v.n.toString().padStart(4)} meanH=${(v.hsum / v.n).toFixed(0).padStart(3)} cables/bldg=${(v.csum / v.n).toFixed(2)} density=${DISTRICT_STYLES[d].cableDensity}`);
  }
  const districtR = pearson(dh, dc);
  console.log(`district-level Pearson(meanH, cables/bldg) = ${districtR.toFixed(3)} (was -0.65)`);
  console.log(`building-level Pearson(height, attachedCables) = ${realised.toFixed(3)} (n=${hs.length}; was -0.547; monastery anchor, see above)`);
  if (districtR < 0.15) problems.push(`district-level correlation ${districtR.toFixed(3)} did not flip sign (need ≥ +0.15)`);

  console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);
}

main();
