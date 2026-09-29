#!/usr/bin/env node
/**
 * Visual comparison harness.
 *
 * The brief has no completion condition — it is iterated until the output
 * "reaches near or surpasses the videos". That makes "did this change help?" the
 * only question that matters, every single iteration. Answering it by opening
 * two images in sequence and holding them in your head does not work; the
 * previous one is gone by the time you look at the next.
 *
 * So: put them side by side, in a fixed, documented order.
 *
 *   Column 1  BASELINE   the committed best-so-far (shots/baseline/)
 *   Column 2  PREVIOUS   the run before last
 *   Column 3  CURRENT    the run you just made
 *   Column N  REFERENCE  a frame extracted from inpirations/dreamscape/*.mov
 *
 * Examples
 *   # current against baseline and the reference video
 *   node tools/compare.mjs --latest
 *
 *   # an explicit left-to-right strip
 *   node tools/compare.mjs shots/a/01.png shots/b/01.png shots/baseline/01.png
 *
 *   # extract a reference frame and put it in the strip
 *   node tools/compare.mjs --latest --ref dreamscape-05@12
 *
 * ffmpeg in this environment has no drawtext filter, so columns are not
 * labelled in-image. The order above is the contract; a .txt sidecar is written
 * beside the output naming each column.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = join(ROOT, 'shots');
const REFS = join(ROOT, 'inpirations', 'dreamscape');
const OUT = join(SHOTS, 'compare');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const files = argv.filter((a) => !a.startsWith('--') && a.endsWith('.png'));
const refSpec = val('--ref');
const wantLatest = has('--latest');
const width = Number(val('--width') ?? 520);
const H = Math.round(width * 0.5625);

/** Run ffmpeg, resolve with its stderr on failure so the message is useful. */
function ffmpeg(args) {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d.toString(); });
    p.on('close', (c) => {
      if (c === 0) res();
      else rej(new Error(err.split('\n').slice(-4).join('\n')));
    });
    p.on('error', () => rej(new Error('ffmpeg not found on PATH')));
  });
}

function haveFfmpeg() {
  return new Promise((res) => {
    const p = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    p.on('close', (c) => res(c === 0));
    p.on('error', () => res(false));
  });
}

/** Most recent shots/<timestamp>/ directory, which is the run just made. */
/** Real capture runs only. `baseline`, `reference` and `compare` are not runs. */
function runDirs() {
  if (!existsSync(SHOTS)) return [];
  return readdirSync(SHOTS)
    .filter((d) => !['baseline', 'reference', 'compare'].includes(d))
    .filter((d) => statSync(join(SHOTS, d)).isDirectory())
    .sort();
}

function latestRunDir() {
  const runs = runDirs();
  return runs.length ? join(SHOTS, runs[runs.length - 1]) : null;
}

/**
 * Extract a frame from a reference video, cached under shots/reference/.
 * `spec` is `name[@seconds]`, default 10s in — past the opening title cards.
 */
async function referenceFrame(spec) {
  const [name, at] = spec.split('@');
  const src = join(REFS, `${name}.mov`);
  if (!existsSync(src)) throw new Error(`no such reference video: ${src}`);
  mkdirSync(join(SHOTS, 'reference'), { recursive: true });
  const out = join(SHOTS, 'reference', `${name}-${at ?? 10}s.png`);
  if (!existsSync(out)) {
    await ffmpeg([
      '-y', '-loglevel', 'error',
      '-ss', at ?? '10', '-i', src,
      '-frames:v', '1', '-vf', `scale=${width}:-2`, out,
    ]);
  }
  return out;
}

/** Poses to compare: the intersection of the current run and the baseline. */
function poseSet(dir, only) {
  if (!dir || !existsSync(dir)) return [];
  const names = readdirSync(dir).filter((f) => f.endsWith('.png') && !f.startsWith('_'));
  return only.length ? names.filter((n) => only.some((o) => n.includes(o))) : names;
}

async function main() {
  if (!(await haveFfmpeg())) {
    console.error('ffmpeg is not on PATH; this tool needs it to build the grid.');
    process.exit(1);
  }

  const only = argv.filter((a) => a.startsWith('--pose=')).map((a) => a.slice(7));
  const currentDir = latestRunDir();
  const baseDir = join(SHOTS, 'baseline');
  const refPath = refSpec ? await referenceFrame(refSpec) : null;

  // Which columns exist. REFERENCE is always last so the bar is always on the
  // right, where the eye ends up.
  const hasBaseline = existsSync(baseDir) && readdirSync(baseDir).some((f) => f.endsWith('.png'));
  const cols = [];
  if (hasBaseline) cols.push('BASELINE');
  if (currentDir) cols.push('CURRENT');
  if (refPath) cols.push('REFERENCE');

  if (cols.length < 2) {
    console.error('need at least two sources to compare.');
    console.error('  node tools/compare.mjs --latest --ref dreamscape-05@12');
    process.exit(1);
  }

  // Pair by pose name so each row is the same framing across columns, and
  // restrict to poses that exist in *both* baseline and current. vstack needs
  // every row to be the same width, and a row missing its "before" is not a
  // comparison anyway — it is just a picture.
  const currentNames = poseSet(currentDir, only);
  const baseNames = existsSync(baseDir) ? poseSet(baseDir, only) : [];
  const paired = currentNames.filter((n) => baseNames.includes(n));
  const poses = (hasBaseline ? (paired.length ? paired : currentNames) : currentNames)
    .filter((n) => only.length === 0 || only.some((o) => n.includes(o)))
    .sort();

  if (!poses.length) {
    console.error('no matching poses found.');
    process.exit(1);
  }

  // Build the argument list and the filter graph in lockstep.
  const inputs = [];
  const graph = [];
  const legend = [];
  // ffmpeg numbers inputs by occurrence, not by args-array position: each
  // input contributes two array elements (`-i` and the path) but one index.
  let inputIndex = 0;
  const missing = [];
  poses.forEach((pose, row) => {
    cols.forEach((col, c) => {
      let p = null;
      if (col === 'BASELINE') p = join(baseDir, pose);
      else if (col === 'CURRENT') p = join(currentDir, pose);
      else if (col === 'REFERENCE') p = refPath;
      // A row missing a cell leaves its label undefined. ffmpeg does not always
      // reject that — it can emit a plausible-looking PNG with a tile silently
      // filled from the wrong input. Fail here instead.
      if (!p || !existsSync(p)) { missing.push(`${row + 1} ${col} ${pose}`); return; }
      const idx = inputIndex++;
      inputs.push('-i', p);
      // The reference video is portrait and our shots are 16:9. Crop the
      // *reference* to fill its tile so it is actually legible, but never crop
      // our own output — cropping the thing under test hides exactly the thing
      // you are trying to look at.
      const tile = col === 'REFERENCE'
        ? `[${idx}:v]scale=${width}:${H}:force_original_aspect_ratio=increase,` +
          `crop=${width}:${H}[r${row}c${c}]`
        : `[${idx}:v]scale=${width}:${H}:force_original_aspect_ratio=decrease,` +
          `pad=${width}:${H}:(ow-iw)/2:(oh-ih)/2:color=black[r${row}c${c}]`;
      graph.push(tile);
      legend.push(`row ${row + 1} col ${cols.indexOf(col) + 1}  ${col.padEnd(9)} ${pose}`);
    });
  });

  // hstack each row over the columns that actually resolved, then vstack rows.
  if (missing.length) {
    console.error(`missing ${missing.length} tile(s); refusing to build a partial grid:`);
    for (const m of missing) console.error(`  row/col ${m}`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });
  // Second resolution, plus a disambiguating counter: two compare runs inside
  // the same second would otherwise write the same path, and the second would
  // silently replace the first.
  const base = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  let stamp = base;
  for (let n = 1; existsSync(join(OUT, `${stamp}.png`)); n++) {
    stamp = `${base}-${n}`;
  }
  const outPng = join(OUT, `${stamp}.png`);
  const outTxt = join(OUT, `${stamp}.txt`);

  // Every row now resolves the same columns, so hstack then vstack is uniform.
  const chains = [];
  for (let r = 0; r < poses.length; r++) {
    const cells = cols.map((_, c) => `[r${r}c${c}]`);
    chains.push(`${cells.join('')}hstack=inputs=${cols.length}[row${r}]`);
  }
  // Always end on an explicitly labelled output and -map it. With a single row
  // the chain used to end on a labelled hstack pad, and ffmpeg auto-mapping
  // only picks up *unlabelled* outputs — so the graph failed to bind. vstack
  // rejects inputs=1, so a single row passes through `null` instead.
  const filter = [
    graph.join(';'),
    chains.length === 1
      ? `${chains[0]};[row0]null[grid]`
      : `${chains.join(';')};${chains.map((_, i) => `[row${i}]`).join('')}` +
        `vstack=inputs=${chains.length}[grid]`,
  ].join(';');

  await ffmpeg([
    '-y', '-loglevel', 'error', ...inputs,
    '-filter_complex', filter,
    '-map', '[grid]',
    '-frames:v', '1', outPng,
  ]);

  writeFileSync(outTxt,
    `columns, left to right: ${cols.join('  |  ')}\n\n${legend.join('\n')}\n`);

  console.log('');
  console.log(`  rows     ${poses.length}`);
  console.log(`  columns  ${cols.join('  |  ')}`);
  console.log('');
  console.log(`  grid     ${outPng}`);
  console.log(`  legend   ${outTxt}`);
  return 0;
}

process.exit(await main().catch((e) => {
  console.error('compare failed:', e.message);
  process.exit(1);
}));
