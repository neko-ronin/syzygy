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
 *   Column 1  BASELINE   best-so-far, from shots/baseline/ — OPTIONAL. That
 *                     directory is not in git (D22); nothing is committed
 *                     there, so this column appears only if you populate it
 *   Column 2  CURRENT    the run you just made
 *   Column 3  REFERENCE  a frame extracted from inspirations/dreamscape/*.mov
 *
 *   With no shots/baseline/, the grid is CURRENT | REFERENCE. Weaker, not
 *   broken: the reference is the column that actually answers the question.
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
 *   # a saved before/after pair, without replacing shots/baseline/
 *   node tools/compare.mjs --current=shots/after --baseline=shots/before --auto
 *
 * ffmpeg in this environment has no drawtext filter, so columns are not
 * labelled in-image. The order above is the contract; a .txt sidecar is written
 * beside the output naming each column.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const SHOTS = join(ROOT, 'shots');
const REFS = join(ROOT, 'inspirations', 'dreamscape');
const OUT = join(SHOTS, 'compare');
const MANIFEST = join(ROOT, 'references', 'sections.json');

/**
 * The design manifest. It is the single source of truth for which section a
 * pose belongs to and which curated sheet that section is judged against. It
 * lives in the repo because the videos do not (D22) - this file plus the
 * contact sheets is what a fresh clone actually gets.
 */
function manifest() {
  if (!existsSync(MANIFEST)) {
    console.error(`missing ${MANIFEST} - run from a checkout with references/ present.`);
    process.exit(1);
  }
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
// Accept both `--flag value` and `--flag=value`. The equals form previously
// returned null silently, so `--section=B` looked like no flag at all.
const val = (f) => {
  const eq = argv.find((a) => a.startsWith(`${f}=`));
  if (eq !== undefined) return eq.slice(f.length + 1);
  const i = argv.indexOf(f);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const files = argv.filter((a) => !a.startsWith('--') && a.endsWith('.png'));
const refSpec = val('--ref');
const sectionArg = val('--section');
const auto = has('--auto');
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
    .filter((d) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(d))
    .filter((d) => !['baseline', 'reference', 'compare'].includes(d))
    .filter((d) => statSync(join(SHOTS, d)).isDirectory())
    .sort();
}

function latestRunDir() {
  const runs = runDirs();
  return runs.length ? join(SHOTS, runs[runs.length - 1]) : null;
}

/**
 * The quality tiers a run's frames were actually shot at.
 *
 * A sequence is one measurement, so its frames should all share a tier. When they do
 * not, comparing that run against another is comparing two experiments, not two
 * builds (PITFALLS §40) — and the grid said nothing about it. Pose 20 is the heaviest
 * frame in the set and the app's governor put it on `low` (a 1200×675 render upscaled
 * to 1600×900) in three runs while the rest were `medium`, moving 66 chunks of the far
 * city to the coarsest geometry. `--latest` then picked one of those runs and would
 * have judged an experiment as if it were HEAD.
 */
function tierProfile(dir) {
  if (!dir) return null;
  try {
    const shots = JSON.parse(readFileSync(join(dir, '_capture.json'), 'utf8')).shots || [];
    const tiers = [...new Set(shots.map((s) => s.provenance?.tier).filter(Boolean))].sort();
    return tiers.length ? tiers : null;
  } catch {
    return null; // no sidecar (a reference or a hand-made directory), not an error
  }
}

/**
 * Loud notes about the two runs' tiers, or an empty list when they agree.
 * Silence here means "comparable", which is worth being able to trust.
 */
function tierNotes(baseDir, currentDir, hasBaseline) {
  const out = [];
  const cur = tierProfile(currentDir);
  const base = hasBaseline ? tierProfile(baseDir) : null;
  const where = (label, t) => `${label} ${t.join('/')}`;
  if (cur && cur.length > 1) {
    out.push(`${where('CURRENT', cur)} — mixed tiers in one run, so the frames are not one measurement`);
  }
  if (base && base.length > 1) {
    out.push(`${where('BASELINE', base)} — mixed tiers in one run, so the frames are not one measurement`);
  }
  if (base && cur && base.length === 1 && cur.length === 1 && base[0] !== cur[0]) {
    out.push(`tier changed between runs: ${where('BASELINE', base)} vs ${where('CURRENT', cur)} — ` +
      `renderScale, shadow resolution, cascades and the LOD ceiling all move with it`);
  }
  return out;
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
  const currentArg = val('--current');
  const baselineArg = val('--baseline');
  const currentDir = currentArg ? resolve(ROOT, currentArg) : latestRunDir();
  const baseDir = baselineArg ? resolve(ROOT, baselineArg) : join(SHOTS, 'baseline');
  for (const [flag, requested, path] of [['--current', currentArg, currentDir], ['--baseline', baselineArg, baseDir]]) {
    if (requested !== null && (!path || !existsSync(path) || !statSync(path).isDirectory())) {
      throw new Error(`${flag} directory does not exist: ${path ?? requested}`);
    }
  }
  const refPath = refSpec ? await referenceFrame(refSpec) : null;

  // How a row picks its reference. Three modes, in precedence order:
  //   --ref <video>     a single frame, every row. Legacy; prone to the
  //                     category error of comparing a night shot to a day one.
  //   --section=<id>    one curated sheet for every row, e.g. --section=B
  //   --auto            each row is compared against the sheet for the section
  //                     that pose belongs to, per references/sections.json
  let m = null;
  if (!refPath && (sectionArg || auto)) {
    m = manifest();
    if (sectionArg && !m.sections[sectionArg]) {
      console.error(`no such section "${sectionArg}". Have: ${Object.keys(m.sections).join(', ')}`);
      process.exit(1);
    }
  }

  /** The reference image for one pose: null means this row has no reference. */
  const refFor = (pose) => {
    if (refPath) return refPath;
    if (!m) return null;
    if (sectionArg) {
      const sheet = m.sections[sectionArg].sheet;
      return existsSync(join(ROOT, sheet)) ? join(ROOT, sheet) : null;
    }
    // --auto: match the longest pose key that appears in the filename
    let best = null;
    for (const [key, id] of Object.entries(m.poses)) {
      if (pose.includes(key) && (!best || key.length > best.len)) best = { key, id };
    }
    if (!best || best.id === 'ALL') return null;
    const sheet = m.sections[best.id]?.sheet;
    return sheet && existsSync(join(ROOT, sheet)) ? join(ROOT, sheet) : null;
  };

  // Which columns exist. REFERENCE is always last so the bar is always on the
  // right, where the eye ends up.
  const hasBaseline = existsSync(baseDir) && readdirSync(baseDir).some((f) => f.endsWith('.png'));
  const cols = [];
  if (hasBaseline) cols.push('BASELINE');
  if (currentDir) cols.push('CURRENT');
  // m is set when --section/--auto supplied a per-row reference, so a
  // REFERENCE column exists even though there is no single refPath.
  if (refPath || m) cols.push('REFERENCE');

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
  let poses = (hasBaseline ? (paired.length ? paired : currentNames) : currentNames)
    .filter((n) => only.length === 0 || only.some((o) => n.includes(o)))
    .sort();

  // In --auto mode every row must resolve a reference, or the grid has ragged
  // columns. The city-wide poses (wide-skyline, aerial-top, low-vertigo) are
  // mapped to ALL: they are the check that several sections have not merged,
  // and no single sheet is the right bar for them. Drop them here and say so,
  // rather than emitting a grid with a silently missing column.
  if (auto && m && !refPath) {
    const keep = [], dropped = [];
    for (const pose of poses) (refFor(pose) ? keep : dropped).push(pose);
    if (dropped.length) {
      console.error('');
      console.error('  --auto skipped these poses: they have no single section to compare against.');
      for (const d of dropped) console.error(`    ${d}`);
      console.error('  Judge those separately: a wide shot is the check that the sections have not');
      console.error('  all merged into one look, and no single sheet is the bar for it.');
      console.error('');
    }
    poses.length = 0;
    poses.push(...keep);
  }

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
      else if (col === 'REFERENCE') p = refFor(pose);
      // A row missing a cell leaves its label undefined. ffmpeg does not always
      // reject that — it can emit a plausible-looking PNG with a tile silently
      // filled from the wrong input. Fail here instead.
      if (!p || !existsSync(p)) {
        // In --auto mode a pose may legitimately have no section reference
        // (the ALL wide shots, or an unmapped pose). That is a real gap in the
        // manifest, so report it rather than silently dropping the column.
        if (col === 'REFERENCE' && m && !refPath) {
          console.error(`note: no section reference for "${pose}" - row will have no reference column.`);
          return;
        }
        missing.push(`${row + 1} ${col} ${pose}`);
        return;
      }
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
      let note = '';
      if (col === 'REFERENCE' && m) {
        const id = sectionArg
          ? sectionArg
          : (Object.entries(m.poses).find(([k]) => pose.includes(k)) ?? [])[1];
        if (id) note = `  [section ${id} ${m.sections[id]?.name ?? ''}]`;
      }
      legend.push(`row ${row + 1} col ${cols.indexOf(col) + 1}  ${col.padEnd(9)} ${pose}${note}`);
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

  // The tiers belong in the sidecar next to the directories, not only on the console:
  // a reviewer reads the .txt days later, and this is the field that decides whether
  // the two columns are comparable at all.
  const notes = tierNotes(baseDir, currentDir, hasBaseline);
  writeFileSync(outTxt,
    `columns, left to right: ${cols.join('  |  ')}\n` +
    `baseline directory: ${hasBaseline ? baseDir : '(none)'}\ncurrent directory: ${currentDir}\n` +
    `tiers: baseline ${(tierProfile(baseDir) ?? ['(no sidecar)']).join('/')}, ` +
    `current ${(tierProfile(currentDir) ?? ['(no sidecar)']).join('/')}\n` +
    (notes.length ? `\n!! ${notes.join('\n!! ')}\n` : '') +
    `\n${legend.join('\n')}\n`);

  console.log('');
  console.log(`  rows     ${poses.length}`);
  console.log(`  columns  ${cols.join('  |  ')}`);
  if (notes.length) {
    console.log('');
    for (const n of notes) console.log(`  !! ${n}`);
    console.log('  !! read the numbers above before believing any difference between columns');
  }
  console.log('');
  console.log(`  grid     ${outPng}`);
  console.log(`  legend   ${outTxt}`);
  return 0;
}

process.exit(await main().catch((e) => {
  console.error('compare failed:', e.message);
  process.exit(1);
}));
