#!/usr/bin/env node
/** Known different pixels prove explicit source selection, not just a successful ffmpeg exit. No capture/GPU. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'syzygy-compare-'));
let grid, sidecar;
try {
  const baseline = join(dir, 'before'), current = join(dir, 'after');
  mkdirSync(baseline); mkdirSync(current);
  for (const [target, color] of [[baseline, 'red'], [current, 'blue']]) {
    const made = spawnSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=64x36`, '-frames:v', '1', join(target, 'fixture.png')], { encoding: 'utf8', timeout: 5000 });
    assert.equal(made.status, 0, made.stderr);
  }
  const compared = spawnSync(process.execPath, ['tools/compare.mjs', `--baseline=${baseline}`, `--current=${current}`, '--section=A', '--pose=fixture', '--width=64'],
    { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(compared.status, 0, compared.stderr);
  grid = compared.stdout.match(/grid\s+([^\n]+)/)?.[1];
  sidecar = compared.stdout.match(/legend\s+([^\n]+)/)?.[1];
  assert.ok(grid && sidecar, compared.stdout);
  const legend = readFileSync(sidecar, 'utf8');
  assert.match(legend, /columns, left to right: BASELINE  \|  CURRENT  \|  REFERENCE/);
  assert.ok(legend.includes(`baseline directory: ${baseline}`));
  assert.ok(legend.includes(`current directory: ${current}`));
  assert.match(legend, /section A saturated-graphic/);
  const decoded = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', grid, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { timeout: 5000 });
  assert.equal(decoded.status, 0, decoded.stderr.toString());
  assert.equal(decoded.stdout.length, 192 * 36 * 3, 'exactly three 64x36 columns must be present');
  const pixel = (x, y) => Array.from(decoded.stdout.subarray((y * 192 + x) * 3, (y * 192 + x) * 3 + 3));
  for (const y of [5, 18, 30]) {
    const red = pixel(32, y), blue = pixel(96, y);
    assert.ok(red[0] > 240 && red[1] < 10 && red[2] < 10, `baseline must be known red pixels: ${red}`);
    assert.ok(blue[2] > 240 && blue[0] < 10 && blue[1] < 10, `current must be known blue pixels: ${blue}`);
  }
  const referencePixels = [];
  for (let y = 0; y < 36; y++) for (let x = 128; x < 192; x++) referencePixels.push(pixel(x, y).join(','));
  assert.ok(new Set(referencePixels).size > 50, 'reference tile must contain the real varied A sheet, not a copied flat source');
  const missing = spawnSync(process.execPath, ['tools/compare.mjs', `--baseline=${join(dir, 'missing')}`, `--current=${current}`, '--section=A'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(missing.status, 1, 'a missing explicit baseline must not silently fall back');
  assert.match(missing.stderr, /--baseline directory does not exist/);
  console.log('ALL PASS: explicit compare sources + three known pixel columns');
} finally {
  rmSync(dir, { recursive: true, force: true });
  if (grid) rmSync(grid, { force: true });
  if (sidecar) rmSync(sidecar, { force: true });
}
