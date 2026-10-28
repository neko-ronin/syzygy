#!/usr/bin/env node
/**
 * Close-range ground measurement — the numbers `docs/GROUND_CLOSE_ROUND4A.md`
 * registers, computed one way, every time.
 *
 * Why this exists as a tool: round 4a's first pass measured "detail energy by
 * row" with a per-band mean of |dL/dy| and concluded that the near field was
 * flatter than the distance. That number is confounded by PITCH — a band with
 * three joint rows averages a lower gradient than one with twelve, whatever the
 * joints' contrast is — so the conclusion was an artifact of the metric. A gate
 * whose numbers come from a different throwaway script each round is not a gate.
 *
 * So: one definition per clause, in code, with the definition written down.
 * Run it on the baseline and on the new frame and compare like with like.
 *
 * Decoding is ffmpeg (already a toolchain dependency of tools/compare.mjs);
 * there is no runtime npm dependency and there must not be one.
 *
 *   node tools/measure_close_range.mjs <frame.png> [W] [H]
 *
 * Regions are for the 01g-kerb-face pose: ground fills the lower frame, a
 * building face is at the right, water and buildings at the left/top. They are
 * constants of that pose, not of the city — do not reuse on another pose
 * without re-deriving them.
 */

import { spawn } from 'node:child_process';

const SHARP = 20;      // p2p <= this = a joint-free 24x24 window (a slab interior)
const NEAR_ROWS = 50;  // bottom 50 rows: 2.71-2.99 m at this pose's camera
const DECK_X0 = 40, DECK_X1 = 1040;   // clears the right-hand building
const FACADE = { y0: 100, y1: 260, x0: 0, x1: 620 };
const FAR = { y0: 380, y1: 460, x0: 640, x1: 940 };

function decode(path, W, H) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', rej);
    p.on('close', (code) => {
      if (code !== 0) return rej(new Error(`ffmpeg exited ${code}`));
      const buf = Buffer.concat(chunks);
      if (buf.length !== W * H * 3) return rej(new Error(`expected ${W * H * 3} bytes, got ${buf.length}`));
      res(buf);
    });
  });
}

const pct = (arr, q) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

function make(buf, W) {
  const L = (x, y) => {
    const o = (y * W + x) * 3;
    return 0.2126 * buf[o] + 0.7152 * buf[o + 1] + 0.0722 * buf[o + 2];
  };
  const region = (r) => {
    const out = [];
    for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) out.push(L(x, y));
    return out;
  };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length); };
  return { L, region, mean, sd };
}

/** 24x24 windows stepped by 12; returns per-window p2p and sd. */
function windows(m, W, H) {
  const out = [];
  for (let y = H - NEAR_ROWS; y + 24 <= H; y += 12) {
    for (let x = DECK_X0; x + 24 <= DECK_X1; x += 12) {
      const v = [];
      for (let j = 0; j < 24; j++) for (let i = 0; i < 24; i++) v.push(m.L(x + i, y + j));
      out.push({ x, y, p2p: Math.max(...v) - Math.min(...v), sd: m.sd(v) });
    }
  }
  return out;
}

/**
 * Band-pass sd: the 300-900 px scale the round's verdict is about.
 *
 * `box100` cannot see this scale (it is dominated by the depth ramp), so the
 * second review built a band-pass by hand: blur 70 px minus blur 350 px, then
 * sd. That is the right instrument and it is reproduced here rather than left
 * in a transcript. Integral images make both blurs O(1) per pixel.
 */
function bandpass(m, W, H) {
  // Integral image is (W+1) x (H+1); sizing it W*H+1 reads out of bounds and
  // every box mean silently becomes NaN.
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      const v = m.L(x, y);
      row += v;
      I[(y + 1) * (W + 1) + (x + 1)] = I[y * (W + 1) + (x + 1)] + row;
    }
  }
  const box = (x, y, r) => {
    const x0 = Math.max(0, x - r), x1 = Math.min(W, x + r + 1);
    const y0 = Math.max(0, y - r), y1 = Math.min(H, y + r + 1);
    const A = I[y0 * (W + 1) + x0], B = I[y0 * (W + 1) + x1];
    const C = I[y1 * (W + 1) + x0], D = I[y1 * (W + 1) + x1];
    return (D - B - C + A) / ((x1 - x0) * (y1 - y0));
  };
  const out = {};
  // Radii 70 / 350 (diameters 140 / 700 px) and the PER-ROW MEAN REMOVED: the
  // deck's depth ramp is the largest signal in these regions and it is not
  // material. With the ramp left in, the number rises and falls with the
  // camera, not with the shader. The reviewer's mid-field figure reproduces
  // within 0.3 luma under this definition; its near-field figure does not
  // reproduce under any definition tried, so verdicts use the QUADRATURE DELTA
  // between two builds, which is instrument-independent.
  for (const [name, r] of [['near', { y0: 820, y1: 900 }], ['mid', { y0: 700, y1: 820 }], ['far', { y0: 380, y1: 500 }]]) {
    const vals = [];
    for (let y = r.y0; y < r.y1; y++) {
      const row = [];
      for (let x = DECK_X0; x < DECK_X1; x++) row.push(box(x, y, 70) - box(x, y, 350));
      const m = row.reduce((a, b) => a + b, 0) / row.length;
      for (const v of row) vals.push(v - m);
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    out[name] = +Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length).toFixed(2);
  }
  return out;
}

function box100(m, W, H) {
  const means = [];
  for (let y = H - 200; y + 100 <= H; y += 100) {
    for (let x = DECK_X0; x + 100 <= DECK_X1; x += 100) {
      const v = [];
      for (let j = 0; j < 100; j++) for (let i = 0; i < 100; i++) v.push(m.L(x + i, y + j));
      means.push(m.mean(v));
    }
  }
  return { n: means.length, sd: m.sd(means), min: Math.min(...means), max: Math.max(...means) };
}

/**
 * Grouping at several scales.
 *
 * `box100` alone measures variation between 28x14 cm patches, i.e. tile-scale
 * mottle - so it falls when the mottle is made COARSER, even though the eye
 * reads the coarser field as better grouped. Sheet B's near field groups at
 * 300-600 px (0.6-1.2 m at 2.7 m), so the tool has to report the scale that the
 * verdict is about. Every block is measured inside the deck region below the
 * horizon, never across the bright kerb line, which is what made the bare-slab
 * frame score 9.86 on box100.
 */
function groupingScales(m, W, H) {
  const out = {};
  for (const size of [50, 100, 200, 300]) {
    const means = [];
    for (let y = H - 300; y + size <= H; y += size) {
      for (let x = DECK_X0; x + size <= 1200; x += size) {
        const v = [];
        for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) v.push(m.L(x + i, y + j));
        means.push(m.mean(v));
      }
    }
    out[`${size}px`] = { n: means.length, sd: +m.sd(means).toFixed(2), range: +(Math.max(...means) - Math.min(...means)).toFixed(1) };
  }
  return out;
}

/** Largest disjoint runs of >= 4 luma over the near strip's 100x50 block means. */
function patches(m, W, H) {
  const grid = [];
  for (let y = H - NEAR_ROWS; y + 50 <= H; y += 50) {
    const row = [];
    for (let x = DECK_X0; x + 100 <= DECK_X1; x += 100) {
      const v = [];
      for (let j = 0; j < 50; j++) for (let i = 0; i < 100; i++) v.push(m.L(x + i, y + j));
      row.push(m.mean(v));
    }
    grid.push(row);
  }
  const vals = grid.flat();
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const bins = [];
  for (let b = Math.floor(lo); b < hi; b += 4) {
    const n = vals.filter((v) => v >= b && v < b + 4).length;
    if (n) bins.push({ band: `${b}-${b + 4}`, n, share: n / vals.length });
  }
  return { blocks: vals.length, range: +(hi - lo).toFixed(1), min: +lo.toFixed(1), max: +hi.toFixed(1), bins };
}

/** Joint contrast and pitch on the bottom scanline that has deck. */
function joints(m, W, H) {
  const y = H - 20;
  const line = [];
  for (let x = DECK_X0; x < DECK_X1; x++) line.push(m.L(x, y));
  const lo = pct(line, 0.05), hi = pct(line, 0.95);
  const mean = line.reduce((s, v) => s + v, 0) / line.length;
  const d = line.map((v) => v - mean);
  const ac = [];
  for (let lag = 30; lag < 220; lag++) {
    let a = 0, b = 0;
    for (let i = 0; i + lag < line.length; i++) { a += d[i] * d[i + lag]; b += d[i] * d[i]; }
    ac.push({ lag, r: b ? a / b : 0 });
  }
  ac.sort((p, q) => q.r - p.r);
  // The strongest lag is often the SECOND harmonic: running bond alternates its
  // course offset, so a 0.30 m module peaks at 0.60 m. Report the peaks, not one
  // number called "pitch", or the gate compares a module to a double module.
  const peaks = [];
  for (const a of ac) {
    if (peaks.every((q) => Math.abs(q.lag - a.lag) > 12)) peaks.push(a);
    if (peaks.length === 3) break;
  }
  return {
    p5: +lo.toFixed(1), p95: +hi.toFixed(1), contrast: +(hi - lo).toFixed(1),
    peaks: peaks.map((q) => `${q.lag}px(r=${q.r.toFixed(2)})`).join(' '),
  };
}

const [, , path, wArg, hArg] = process.argv;
if (!path) {
  console.error('usage: node tools/measure_close_range.mjs <frame.png> [W] [H]');
  process.exit(1);
}
const W = Number(wArg) || 1600, H = Number(hArg) || 900;
const buf = await decode(path, W, H);
const m = make(buf, W);

const near = windows(m, W, H);
const sharp = near.filter((w) => w.p2p <= SHARP);
const nearStrip = m.region({ y0: H - NEAR_ROWS, y1: H, x0: DECK_X0, x1: DECK_X1 });
const deck = m.region({ y0: 380, y1: 880, x0: 60, x1: 1000 });
const facade = m.region(FACADE);
let farGrad = 0, farN = 0;
for (let y = FAR.y0; y < FAR.y1; y++) for (let x = FAR.x0; x < FAR.x1; x++) { farGrad += Math.abs(m.L(x + 1, y) - m.L(x, y)); farN++; }

const b = box100(m, W, H);
const p = patches(m, W, H);
const j = joints(m, W, H);
const g = groupingScales(m, W, H);
const bp = bandpass(m, W, H);

const round = (v, n = 2) => +v.toFixed(n);
const out = {
  frame: path, size: `${W}x${H}`,
  '1 material.hfSd': round(sharp.length ? m.mean(sharp.map((w) => w.sd)) : NaN),
  '1 material.jointFreeShare': round(sharp.length / near.length, 3),
  '2 grouping.box100Sd': round(b.sd),
  '2 grouping.blocks100x100': b.n,
  '2 grouping.nearStripRange': round(p.range, 1),
  '2 grouping.scale50Sd': g['50px'].sd,
  '2 grouping.scale100Sd': g['100px'].sd,
  '2 grouping.scale200Sd': g['200px'].sd,
  '2 grouping.scale300Sd': g['300px'].sd,
  '2 grouping.scale300Range': g['300px'].range,
  '2 grouping.bandpassNear': bp.near,
  '2 grouping.bandpassMid': bp.mid,
  '2 grouping.bandpassFar': bp.far,
  '3 joint.contrast': j.contrast,
  '3 joint.periods': j.peaks,
  '4 value.deckMean': round(m.mean(deck), 1),
  '4 value.facadeMean': round(m.mean(facade), 1),
  '4 value.deckOverFacade': round(m.mean(deck) / m.mean(facade)),
  '5 aliasing.farGradX': round(farGrad / farN),
  'nearStrip.sd': round(m.sd(nearStrip)),
};
const pad = Math.max(...Object.keys(out).map((k) => k.length));
for (const [k, v] of Object.entries(out)) console.log(`${k.padEnd(pad)}  ${v}`);
console.log('\ngrouping bins (100x50 block means, 4-luma bands):');
for (const bin of p.bins) console.log(`  ${bin.band.padEnd(9)} ${String(bin.n).padStart(2)} blocks  ${(bin.share * 100).toFixed(0)}%`);
