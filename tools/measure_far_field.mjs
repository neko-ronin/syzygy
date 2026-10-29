#!/usr/bin/env node
/**
 * Far-field stability — is the upper frame converged, or still resolving?
 *
 * Written for `docs/ALIASING_SETTLE_PROBE.md`, registered before the runs. R3
 * says "the base image is unstable" and blames the resolve; the harness settles
 * 24-45 frames, which cannot be a converged TAA image by construction, so the
 * first question is which of the two is being measured. This prints the number
 * that separates them.
 *
 * `|dL/dx|` between adjacent pixels is the signature: on a converged silhouette
 * the differences are concentrated at edges, and on unresolved geometry they are
 * everywhere. Reported over the upper frame only -- the ground plane is not the
 * subject and its own gradient would swamp the statistic, which is exactly the
 * confound that retired `box(100)` in round 4a.
 *
 *   node tools/measure_far_field.mjs <frame.png> [--ratio=<base.png>]
 *   node tools/measure_far_field.mjs --diff=<a.png>,<b.png>
 *   node tools/measure_far_field.mjs --contrast=<test.png>,<base.png>
 *
 * `spikePx` is the alias-sensitive statistic (share of single-pixel steps).
 * `mean|dL/dx|` is reported for continuity and is NOT trustworthy for this: a
 * synthetic positive control -- the same frame nearest-neighbour downscaled and
 * re-expanded -- raises the visible jaggies and *lowers* `mean|dL/dx|`.
 * `--contrast` bins the signed difference by local contrast instead, which is
 * how the TAA pass was identified as a one-way darkening rather than a filter.
 *
 * Decoding is ffmpeg; no npm dependency, as everywhere else in tools/.
 */

import { spawn } from 'node:child_process';

const W = 1600, H = 900;
const Y0 = 0, Y1 = Math.round(H * 0.40);   // upper 40 %: sky and far silhouettes only

function decode(path) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', rej);
    p.on('close', (code) => {
      if (code !== 0) return rej(new Error(`ffmpeg exited ${code} for ${path}`));
      const buf = Buffer.concat(chunks);
      if (buf.length !== W * H * 3) return rej(new Error(`expected ${W * H * 3} bytes, got ${buf.length}`));
      res(buf);
    });
  });
}

const lum = (buf, x, y) => {
  const o = (y * W + x) * 3;
  return 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2];
};

const pct = (arr, q) => {
  const s = Float64Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

/**
 * `dx`/`dy` are the mean adjacent-pixel difference: a blunt instrument, because a
 * mean over a whole frame is dominated by sky gradient and haze. It is reported
 * for continuity, not as the primary.
 *
 * `spike` is the alias-sensitive one: an isolated pixel that sits far from the
 * mean of its two horizontal neighbours. A resolved edge is a ramp over 2-3 px
 * and scores low; an unresolved silhouette is a single-pixel step and scores
 * high. `spikePx` is the share of pixels above 6 luma, which is the population
 * that reads as crawling in a still.
 */
function field(buf) {
  const dx = [], dy = [], spike = [];
  let spikePx = 0, spikeN = 0;
  for (let y = Y0; y < Y1; y++) {
    for (let x = 0; x < W; x++) {
      if (x + 1 < W) dx.push(Math.abs(lum(buf, x + 1, y) - lum(buf, x, y)));
      if (y + 1 < Y1) dy.push(Math.abs(lum(buf, x, y + 1) - lum(buf, x, y)));
      if (x > 0 && x + 1 < W) {
        const l = lum(buf, x - 1, y), c = lum(buf, x, y), r = lum(buf, x + 1, y);
        const sp = Math.abs(c - (l + r) / 2);
        spike.push(sp); spikeN++;
        if (sp > 6) spikePx++;
      }
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    dxMean: mean(dx), dxP95: pct(dx, 0.95), dyMean: mean(dy), dyP95: pct(dy, 0.95),
    spikeMean: mean(spike), spikePx: 100 * spikePx / spikeN,
  };
}

const r2 = (v) => +v.toFixed(3);

const args = process.argv.slice(2);
const diffArg = args.find((a) => a.startsWith('--diff='));
const contrastArg = args.find((a) => a.startsWith('--contrast='));
const ratioArg = args.find((a) => a.startsWith('--ratio='));
const files = args.filter((a) => !a.startsWith('--'));

// `--diff` says *how much* two frames differ; it does not say *how*. That
// distinction is what identified R3's defect: a working temporal filter moves
// edge pixels both ways, while the TAA pass as shipped darkened 98.83 % of every
// pixel it touched in proportion to local contrast -- the signature of a blend
// against a constant, not an average of samples.
if (contrastArg) {
  const [pa, pb] = contrastArg.slice(11).split(',');
  if (!pa || !pb) { console.error('--contrast needs two paths: <test.png>,<base.png>'); process.exit(2); }
  const a = await decode(pa), b = await decode(pb);
  let darker = 0, lighter = 0, gt = 0;
  const bins = new Map();
  for (let y = Math.max(1, Y0); y < Y1 - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const d = lum(a, x, y) - lum(b, x, y);
      // Local contrast is measured in the BASE image, so a bin means the same
      // thing whatever the test pass does to the frame.
      let mn = Infinity, mx = -Infinity;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [0, 0]]) {
        const l = lum(b, x + dx, y + dy);
        if (l < mn) mn = l;
        if (l > mx) mx = l;
      }
      const range = mx - mn;
      if (Math.abs(d) > 2) { gt++; if (d < 0) darker++; else lighter++; }
      const key = range < 4 ? '0-4' : range < 12 ? '4-12' : range < 30 ? '12-30' : '30+';
      const e = bins.get(key) ?? { n: 0, sum: 0, max: 0 };
      e.n++; e.sum += d;
      if (Math.abs(d) > e.max) e.max = Math.abs(d);
      bins.set(key, e);
    }
  }
  console.log(`test  ${pa}`);
  console.log(`base  ${pb}`);
  console.log(`changed       ${gt} px (>2 luma)  test darker ${(100 * darker / gt).toFixed(2)} %  ` +
              `lighter ${(100 * lighter / gt).toFixed(2)} %`);
  for (const key of ['0-4', '4-12', '12-30', '30+']) {
    const e = bins.get(key);
    if (!e) continue;
    console.log(`local range ${key.padEnd(6)} n ${String(e.n).padStart(7)}  mean d ${(e.sum / e.n).toFixed(3).padStart(8)}  max |d| ${e.max.toFixed(1)}`);
  }
  process.exit(0);
}

if (diffArg) {
  const [pa, pb] = diffArg.slice(7).split(',');
  if (!pa || !pb) { console.error('--diff needs two paths'); process.exit(2); }
  const a = await decode(pa), b = await decode(pb);
  let n = 0, gt2 = 0, gt8 = 0, max = 0, sum = 0;
  for (let y = Y0; y < Y1; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.abs(lum(a, x, y) - lum(b, x, y));
      n++; sum += d; if (d > max) max = d;
      if (d > 2) gt2++;
      if (d > 8) gt8++;
    }
  }
  console.log(`A  ${pa}`);
  console.log(`B  ${pb}`);
  console.log(`diff.mean      ${r2(sum / n)}`);
  console.log(`diff.max       ${r2(max)}`);
  console.log(`diff.gt2       ${(100 * gt2 / n).toFixed(2)} %  (>2 luma)`);
  console.log(`diff.gt8       ${(100 * gt8 / n).toFixed(2)} %  (>8 luma)`);
  process.exit(0);
}

if (!files.length) {
  console.error('usage: node tools/measure_far_field.mjs <frame.png> [--ratio=<base.png>]');
  process.exit(2);
}

const rows = [];
for (const f of files) rows.push({ path: f, m: field(await decode(f)) });

const base = ratioArg ? field(await decode(ratioArg.slice(8))) : null;

console.log(`region  upper ${Y1} rows (y ${Y0}-${Y1}), full width`);
for (const { path, m } of rows) {
  const tail = base
    ? `  r_spike=${r2(m.spikeMean / base.spikeMean)} r_spikePx=${r2(m.spikePx / base.spikePx)}`
    : '';
  console.log(
    `${path.replace(/^shots\//, '').padEnd(46)} spike ${m.spikeMean.toFixed(3)} (${m.spikePx.toFixed(2)} % > 6)` +
    `  dx ${m.dxMean.toFixed(3)}  dy ${m.dyMean.toFixed(3)}${tail}`
  );
}
