#!/usr/bin/env node
/**
 * Hygiene screen: nothing identifying goes into a commit, a push or a deploy.
 *
 * Run by the git hooks in .githooks/ and by `npm run deploy` on dist/. Prints one
 * line per finding and exits 1 if there is any. See docs/PROCEDURES.md "Publishing".
 *
 *   --staged          staged changes: added lines, file names, images (pre-commit, pre-merge-commit)
 *   --message <file>  a commit message (commit-msg)
 *   --push <remote>   every commit about to be pushed: lines, messages, identities (pre-push; refs on stdin)
 *   --dir <path>      every file under a directory (deploy, on dist/)
 *   --tree            every tracked file at HEAD (an audit)
 *
 * Generic rules live here. Private terms (a real name, workspace folder names, an
 * account ID) live in <git-common-dir>/hygiene-deny, one per line, matched as
 * case-insensitive substrings: listing them in this public file would publish
 * the very things it guards. A push or deploy refuses to run without that file;
 * an empty one is an explicit "no private terms".
 *
 * Patterns are written so this file does not match itself (`U[s]ers`, split
 * literals): it is screened like any other file.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const ALLOWED_EMAIL = /@(?:users\.noreply\.github\.com|example\.(?:com|org|net))$|^noreply@github\.com$/i;

/** One rule per kind of leak. `allow` exempts a match, `skipLine` a whole line. */
export const RULES = [
  { id: 'home-path', re: /\/U[s]ers\/[\w.-]+|\/h[o]me\/[\w.-]+|[A-Za-z]:\\U[s]ers\\/g },
  { id: 'scratch-path', re: /\/private\/(?:tmp|var)\/|\/var\/f[o]lders\/|claude-\d{3,}\/|-U[s]ers-[\w-]+/g },
  { id: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, allow: (m) => ALLOWED_EMAIL.test(m) },
  { id: 'phone', re: /(?<![\w.])(?:\+\d{1,3}[ .-])?(?:\(\d{3}\) ?|\d{3}[.-])\d{3}[.-]\d{4}(?![\w.])/g },
  { id: 'ssn', re: /(?<![\w-])\d{3}-\d{2}-\d{4}(?![\w-])/g },
  { id: 'card-number', re: /(?<!\d)(?:\d{4}[ -]){3}\d{1,4}(?!\d)/g },
  {
    // Version strings (`"jsVersion": "15.3.76.4"`) are dotted quads too; a line
    // that names a version is not screened for addresses.
    id: 'ip-address', re: new RegExp(`(?<![\\w./-])${OCTET}(?:\\.${OCTET}){3}(?![\\w./-])`, 'g'),
    skipLine: (line) => /version/i.test(line),
    allow: (m) => /^(?:127\.|0\.0\.0\.0$|255\.255\.255\.255$|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.)/.test(m),
  },
  { id: 'mac-address', re: /(?<![\w:])(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}(?![\w:])/g },
  { id: 'private-key', re: new RegExp('-----BEGIN [A-Z ]*PRIV' + 'ATE KEY-----', 'g') },
  { id: 'secret-token', re: /\b(?:sk-a[n]t-[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_p[a]t_\w{20,}|AK[I]A[0-9A-Z]{16}|xo[x][baprs]-[\w-]{10,})/g },
];

/** Commit-message-only rules: this project takes no co-author trailers. */
const MESSAGE_RULES = [{ id: 'co-author', re: /co-authored-by\s*:/gi }];

const git = (args, opts = {}) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 << 20, ...opts });
const gitBuf = (args) => execFileSync('git', args, { maxBuffer: 256 << 20 });

/** Path of the private deny-list, shared by every worktree of the repo. */
export function denyPath() {
  return join(git(['rev-parse', '--git-common-dir']).trim(), 'hygiene-deny');
}

/** Private terms, or null when the file does not exist. */
export function loadDeny(path = denyPath()) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
}

/** Findings in one line of text: [{ rule, match }]. */
export function scanLine(line, deny = [], extraRules = []) {
  const out = [];
  for (const r of [...RULES, ...extraRules]) {
    if (r.skipLine?.(line)) continue;
    r.re.lastIndex = 0;
    for (const m of line.matchAll(r.re)) if (!r.allow?.(m[0])) out.push({ rule: r.id, match: m[0] });
  }
  const lower = line.toLowerCase();
  for (const term of deny) if (lower.includes(term.toLowerCase())) out.push({ rule: 'private-term', match: term });
  return out;
}

/** Findings in a block of text, each tagged with `where:line`. */
export function scanText(text, where, deny = [], extraRules = []) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    for (const f of scanLine(line, deny, extraRules)) out.push({ ...f, where: `${where}:${i + 1}` });
  });
  return out;
}

/** Added lines of a unified diff (-U0), with their new-file line numbers. */
export function addedLines(diff) {
  const out = [];
  let file = null, line = 0;
  for (const l of diff.split('\n')) {
    if (l.startsWith('+++ ')) { file = l.slice(4).replace(/^b\//, ''); continue; }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (file && l.startsWith('+')) { out.push({ file, line, text: l.slice(1) }); line++; }
  }
  return out;
}

const IMAGE = /\.(?:jpe?g|png|gif|webp|heic|tiff?)$/i;
const EXIF_TAGS = ['GPSLatitude', 'GPSLongitude', 'Artist', 'Creator', 'OwnerName', 'CameraOwnerName',
  'SerialNumber', 'HostComputer', 'XPAuthor', 'By-line', 'Copyright'];
/** Every external tool a hook calls gets a deadline: a stuck tool must block, not hang. */
const TOOL_TIMEOUT_MS = 20_000;
let exifAvailable = null;

/**
 * Identifying EXIF/XMP tags in an image, via exiftool when it is installed. The
 * image goes through a temp file: `exiftool -` on a pipe hung for ten minutes.
 */
function imageFindings(buffer, where) {
  if (exifAvailable === null) {
    exifAvailable = spawnSync('exiftool', ['-ver'], { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS }).status === 0;
    if (!exifAvailable) console.error('hygiene: exiftool not installed; image metadata not screened');
  }
  if (!exifAvailable) return [];
  const dir = mkdtempSync(join(tmpdir(), 'hygiene-'));
  try {
    const file = join(dir, 'image');
    writeFileSync(file, buffer);
    const r = spawnSync('exiftool', ['-q', '-q', '-s', ...EXIF_TAGS.map((t) => `-${t}`), file],
      { encoding: 'utf8', timeout: TOOL_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error || r.status !== 0) return [{ rule: 'image-metadata', match: `could not screen (${r.error?.code ?? `exit ${r.status}`})`, where }];
    return r.stdout.split('\n').filter(Boolean).map((l) => ({ rule: 'image-metadata', match: l.trim(), where }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Text file? A NUL in the first 8 KB says no. */
const isText = (buf) => !buf.subarray(0, 8192).includes(0);

function scanStaged(deny) {
  const diff = git(['diff', '--cached', '-U0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR']);
  const out = [];
  for (const { file, line, text } of addedLines(diff)) {
    for (const f of scanLine(text, deny)) out.push({ ...f, where: `${file}:${line}` });
  }
  for (const file of git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean)) {
    for (const f of scanLine(file, deny)) out.push({ ...f, where: `file name ${file}` });
    if (IMAGE.test(file)) out.push(...imageFindings(gitBuf(['show', `:${file}`]), file));
  }
  return out;
}

function scanMessage(path, deny) {
  return scanText(readFileSync(path, 'utf8').split('\n').filter((l) => !l.startsWith('#')).join('\n'),
    'commit message', deny, MESSAGE_RULES);
}

const ZERO = /^0+$/;

/**
 * Commits a push would publish, from the pre-push stdin lines. The remote tip
 * git reports is the only trusted boundary: when the remote lacks the branch,
 * or its tip is not here, every commit reachable from the pushed tip is
 * screened. Local remote-tracking refs are not trusted; they can be stale or
 * belong to another remote, and trusting them once screened nothing at all.
 */
function pushedCommits(stdin) {
  const shas = new Set();
  for (const line of stdin.split('\n').filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(' ');
    if (ZERO.test(localSha)) continue; // a delete publishes nothing
    let list = null;
    if (!ZERO.test(remoteSha)) {
      try { list = git(['rev-list', `${remoteSha}..${localSha}`]); } catch { /* remote tip unknown here */ }
    }
    if (list === null) list = git(['rev-list', localSha]);
    for (const s of list.split('\n').filter(Boolean)) shas.add(s);
  }
  return [...shas];
}

function scanPush(remote, deny) {
  const out = [];
  const shas = pushedCommits(readFileSync(0, 'utf8'));
  console.error(`hygiene: screening ${shas.length} commit(s) for ${remote}`);
  for (const sha of shas) {
    const at = sha.slice(0, 8);
    const [an, ae, cn, ce] = git(['show', '-s', '--format=%an%x00%ae%x00%cn%x00%ce', sha]).trim().split('\0');
    for (const email of [ae, ce]) if (!ALLOWED_EMAIL.test(email)) out.push({ rule: 'identity-email', match: email, where: `commit ${at}` });
    for (const name of [an, cn]) for (const f of scanLine(name, deny)) out.push({ ...f, rule: `identity-${f.rule}`, where: `commit ${at}` });
    out.push(...scanText(git(['show', '-s', '--format=%B', sha]), `commit ${at} message`, deny, MESSAGE_RULES));
    const diff = git(['show', '--format=', '-p', '-U0', '--no-color', '--no-ext-diff', '--diff-merges=first-parent', sha]);
    for (const { file, line, text } of addedLines(diff)) {
      for (const f of scanLine(text, deny)) out.push({ ...f, where: `commit ${at} ${file}:${line}` });
    }
    for (const file of git(['show', '--format=', '--name-only', '--diff-merges=first-parent', '--diff-filter=ACMR', sha]).split('\n').filter(Boolean)) {
      for (const f of scanLine(file, deny)) out.push({ ...f, where: `commit ${at} file name ${file}` });
      if (IMAGE.test(file)) out.push(...imageFindings(gitBuf(['show', `${sha}:${file}`]), `commit ${at} ${file}`));
    }
  }
  return out;
}

function scanDir(dir, deny) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const rel = relative(dir, p);
      const buf = readFileSync(p);
      for (const f of scanLine(rel, deny)) out.push({ ...f, where: `file name ${rel}` });
      if (isText(buf)) out.push(...scanText(buf.toString('utf8'), rel, deny));
      else if (IMAGE.test(name)) out.push(...imageFindings(buf, rel));
    }
  };
  walk(dir);
  return out;
}

function scanTree(deny) {
  const out = [];
  for (const file of git(['ls-files', '-z']).split('\0').filter(Boolean)) {
    const buf = gitBuf(['show', `HEAD:${file}`]);
    for (const f of scanLine(file, deny)) out.push({ ...f, where: `file name ${file}` });
    if (isText(buf)) out.push(...scanText(buf.toString('utf8'), file, deny));
    else if (IMAGE.test(file)) out.push(...imageFindings(buf, file));
  }
  return out;
}

/** Run one mode; print findings; exit 1 if any. */
export function main(argv = process.argv.slice(2)) {
  const [mode, arg] = argv;
  const deny = loadDeny();
  if (deny === null) {
    const path = denyPath();
    // A push or a deploy publishes; without the private list it would publish blind.
    if (mode === '--push' || mode === '--dir') {
      console.error(`hygiene: private deny-list missing (${path}). Create it, one term per line;\n` +
        '         an empty file means "no private terms". Refusing to publish without it.');
      return 1;
    }
    console.error(`hygiene: private deny-list missing (${path}); screening generic rules only`);
  }
  const terms = deny ?? [];
  let findings;
  if (mode === '--staged') findings = scanStaged(terms);
  else if (mode === '--message') findings = scanMessage(arg, terms);
  else if (mode === '--push') findings = scanPush(arg ?? 'origin', terms);
  else if (mode === '--dir') findings = scanDir(arg, terms);
  else if (mode === '--tree') findings = scanTree(terms);
  else {
    console.error('usage: node tools/hygiene.mjs --staged | --message <file> | --push <remote> | --dir <path> | --tree');
    return 2;
  }
  if (findings.length === 0) return 0;
  console.error(`hygiene: ${findings.length} finding(s); nothing was ${mode === '--dir' ? 'deployed' : mode === '--push' ? 'pushed' : 'committed'}:`);
  for (const f of findings.slice(0, 50)) console.error(`  ${f.where}  [${f.rule}]  ${f.match}`);
  if (findings.length > 50) console.error(`  … and ${findings.length - 50} more`);
  return 1;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) process.exit(main());
