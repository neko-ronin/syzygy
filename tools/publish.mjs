#!/usr/bin/env node
/**
 * Publish main: push to origin, deploy to Cloudflare, check the live site.
 *
 * Run by the post-commit and post-merge hooks (.githooks/), or by hand. It does
 * nothing off `main`, mid-rebase/cherry-pick/revert, or with SYZYGY_PUBLISH=0.
 * It refuses a dirty tree: the deployed site must be exactly the commit, not
 * whatever else is in the working copy. It never force-pushes: if the remote
 * has moved on, it stops. The push runs the pre-push hygiene screen and the
 * deploy screens dist/ (tools/hygiene.mjs), so nothing here is a bypass.
 *
 * SYZYGY_PUBLISH_DRY=1 rehearses every step: push --dry-run, build, screen,
 * wrangler deploy --dry-run, and no live check.
 *
 * Every step is a JSONL event in logs/publish/<YYYY-MM-DD>.jsonl (gitignored,
 * kept 7 days). Exit 0 on success or a deliberate skip, 1 on a failure.
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = join(ROOT, 'logs', 'publish');
const KEEP_DAYS = 7;
const SESSION = randomUUID();
const DRY = process.env.SYZYGY_PUBLISH_DRY === '1';
const T0 = Date.now();

function log(level, event, extra = {}) {
  const ts = new Date().toISOString();
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(join(LOG_DIR, `${ts.slice(0, 10)}.jsonl`),
    `${JSON.stringify({ ts, level, component: 'publish', event, session_id: SESSION, pid: process.pid, ...extra })}\n`);
}

/** Daily files older than KEEP_DAYS go. Names are dates, so no stat needed. */
function rotate() {
  if (!existsSync(LOG_DIR)) return;
  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  for (const f of readdirSync(LOG_DIR)) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f) && f.slice(0, 10) < cutoff) rmSync(join(LOG_DIR, f));
}

const say = (msg) => console.log(`publish: ${msg}`);
const git = (args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

/** Run a step with the terminal attached, so its own output is visible. */
function step(name, cmd, args, env = {}) {
  const t = Date.now();
  log('info', `${name}_start`, { cmd: [cmd, ...args].join(' ') });
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
  const ok = r.status === 0;
  log(ok ? 'info' : 'error', `${name}_${ok ? 'ok' : 'fail'}`, { exit_code: r.status, signal: r.signal, ms: Date.now() - t });
  return ok;
}

/** Why not to publish right now, or null. */
function skipReason() {
  if (process.env.SYZYGY_PUBLISH === '0') return 'SYZYGY_PUBLISH=0';
  const action = process.env.GIT_REFLOG_ACTION ?? '';
  if (/^(rebase|cherry-pick|revert|am)\b/.test(action)) return `inside ${action.split(' ')[0]}`;
  const gitDir = git(['rev-parse', '--git-dir']);
  for (const marker of ['rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if (existsSync(resolve(ROOT, gitDir, marker))) return `a ${marker} is in progress`;
  }
  let branch = '';
  try { branch = git(['symbolic-ref', '--quiet', '--short', 'HEAD']); } catch { /* detached */ }
  if (branch !== 'main') return `on ${branch || 'a detached HEAD'}, not main`;
  return null;
}

/** The custom domain from wrangler.jsonc's routes. */
function liveHost() {
  const m = /"pattern"\s*:\s*"([^"]+)"/.exec(readFileSync(join(ROOT, 'wrangler.jsonc'), 'utf8'));
  return m?.[1] ?? null;
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The live page must load and serve the bundle that was just built. */
async function verifyLive(host) {
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  const bundle = /\/assets\/index-[\w-]+\.js/.exec(html)?.[0];
  if (!bundle) return { ok: false, why: 'no bundle referenced in dist/index.html' };
  const want = sha256(readFileSync(join(ROOT, 'dist', bundle)));
  let last = 'not tried';
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const page = await fetch(`https://${host}/`, { signal: AbortSignal.timeout(10_000), cache: 'no-store' });
      const live = /\/assets\/index-[\w-]+\.js/.exec(await page.text())?.[0];
      if (page.status === 200 && live === bundle) {
        const js = await fetch(`https://${host}${bundle}`, { signal: AbortSignal.timeout(20_000) });
        const got = sha256(Buffer.from(await js.arrayBuffer()));
        if (got === want) return { ok: true, bundle, attempt };
        last = `bundle hash differs (${got.slice(0, 12)} vs ${want.slice(0, 12)})`;
      } else last = `HTTP ${page.status}, serving ${live ?? 'no bundle'}`;
    } catch (e) { last = String(e.message ?? e); }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { ok: false, why: last };
}

async function publish(trigger) {
  const head = git(['rev-parse', '--short', 'HEAD']);
  const why = skipReason();
  if (why) { log('info', 'skipped', { reason: why, trigger, head }); return 0; }

  const dirty = git(['status', '--porcelain']);
  if (dirty) {
    log('warn', 'dirty_tree', { head, files: dirty.split('\n').length });
    say(`not publishing ${head}: the working tree has uncommitted changes, and the site must be exactly the commit.`);
    say('commit or stash them, then run: node tools/publish.mjs');
    return 1;
  }

  say(`${DRY ? 'rehearsing' : 'publishing'} main at ${head} (${trigger})`);
  if (!step('push', 'git', ['push', ...(DRY ? ['--dry-run'] : []), 'origin', 'main'])) {
    say('push failed (hygiene screen, auth, or the remote has commits you do not). Nothing was deployed.');
    return 1;
  }
  const deployed = DRY
    ? step('build', 'npm', ['run', 'build:web']) && step('screen_dist', 'node', ['tools/hygiene.mjs', '--dir', 'dist'])
      && step('deploy', 'npx', ['wrangler', 'deploy', '--dry-run'], { WRANGLER_SEND_METRICS: 'false' })
    : step('deploy', 'npm', ['run', 'deploy']);
  if (!deployed) { say('deploy failed; main was pushed but the site was not updated.'); return 1; }
  if (DRY) { say('rehearsal complete: nothing was pushed or deployed.'); return 0; }

  const host = liveHost();
  if (!host) { log('warn', 'verify_skipped', { reason: 'no custom domain in wrangler.jsonc' }); return 0; }
  const v = await verifyLive(host);
  log(v.ok ? 'info' : 'error', v.ok ? 'verify_ok' : 'verify_fail', { host, ...v });
  say(v.ok ? `live: https://${host} serves ${v.bundle}` : `deployed, but https://${host} did not check out: ${v.why}`);
  return v.ok ? 0 : 1;
}

rotate();
const trigger = (process.argv.includes('--trigger') && process.argv[process.argv.indexOf('--trigger') + 1]) || 'manual';
log('info', 'process_start', { exe: process.execPath, args: process.argv.slice(2), ppid: process.ppid, cwd: process.cwd(), dry: DRY });
let code = 1;
try {
  code = await publish(trigger);
} catch (e) {
  log('critical', 'crash', { error_type: e?.name, message: String(e?.message ?? e), context: { trigger } });
  say(`crashed: ${e?.message ?? e}`);
} finally {
  log(code === 0 ? 'info' : 'error', 'process_exit', { exit_code: code, wall_ms: Date.now() - T0, peak_rss_kb: process.resourceUsage().maxRSS });
}
process.exit(code);
