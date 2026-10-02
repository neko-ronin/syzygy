#!/usr/bin/env node
/**
 * Orchestration guard for a memory-starved machine.
 *
 * Two jobs, both from `docs/WORKFLOW.md` §6:
 *
 *   1. `preflight` — refuse to start a capture when the box is already in the
 *      state that killed the last session. WORKFLOW §6.4: "a failed capture is
 *      not evidence of a rendering bug". Disk full and OOM produce truncated
 *      frames and GPU errors that read exactly like the silent faults this
 *      project spends its life hunting. This is the check that stops a dying
 *      machine from being believed.
 *
 *   2. `capture` — serialise GPU work. WORKFLOW §2.3: "Two agents capturing at
 *      once is how swap gets killed." An exclusive lock, held for the life of
 *      the capture, with a stale-lock reaper so a crashed run cannot wedge the
 *      queue for the rest of the session.
 *
 *   3. `watch` — report pane lifecycle states so an idle or blocked agent is
 *      visible without a human watching four terminals.
 *
 * The thresholds are the ones WORKFLOW §6.1 recorded from the session where
 * they were crossed. They are deliberately conservative: a refused capture costs
 * a retry, and an OOM capture costs a round plus a plausible wrong conclusion.
 *
 * This never decides anything about the render. It only decides whether the
 * machine is healthy enough for its output to be believed.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Thresholds — WORKFLOW.md §6.1
// ---------------------------------------------------------------------------

/**
 * Swap used in GB. The last session hit 8.1 of 9.2 GB and serialised captures.
 * This box already carries other workspaces' agents, so we start refusing
 * earlier and let the caller override with --force.
 */
const SWAP_WARN_GB = 3.0;
const SWAP_BLOCK_GB = 4.5;

/** Free disk in GB on the data volume. Was 98% full at the last session's peak. */
const DISK_WARN_GB = 20;
const DISK_BLOCK_GB = 10;

/** "unused" physical memory in MB. 66 MB at the last session's peak. */
const MEM_WARN_MB = 500;
const MEM_BLOCK_MB = 250;

/** A capture over this long is presumed dead; the lock may then be broken. */
const LOCK_STALE_MIN = 25;

const LOCK_DIR = 'shots/.caplock';

// ---------------------------------------------------------------------------
// Platform probes
// ---------------------------------------------------------------------------

const sh = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
};

/** Swap used in GB, e.g. 4.94 for "4943.19M". */
function swapUsedGB() {
  const out = sh('sysctl', ['-n', 'vm.swapusage']);
  const m = out.match(/used\s*=\s*([\d.]+)M/);
  if (m) return Number(m[1]) / 1024;
  const g = out.match(/used\s*=\s*([\d.]+)G/);
  return g ? Number(g[1]) : 0;
}

function swapTotalGB() {
  const out = sh('sysctl', ['-n', 'vm.swapusage']);
  const m = out.match(/total\s*=\s*([\d.]+)M/);
  if (m) return Number(m[1]) / 1024;
  const g = out.match(/total\s*=\s*([\d.]+)G/);
  return g ? Number(g[1]) : 0;
}

/** Free bytes on the data volume — the binding constraint last session. */
function diskFreeGB() {
  const out = sh('df', ['-k', '/System/Volumes/Data']);
  const line = out.trim().split('\n').pop() ?? '';
  const f = line.split(/\s+/);
  if (f.length < 4) return 999;
  return Number(f[3]) / 1024 / 1024; // 1K blocks -> GiB
}

/** macOS reports memory as "15G used (2330M wired, 7488M compressor), 191M unused". */
function physUnusedMB() {
  const out = sh('top', ['-l', '1', '-n', '0']);
  const m = out.match(/PhysMem:\s*\d+[MG]\s+used\s*\([^)]*\),\s*([\d.]+)([MG])\s+unused/);
  if (!m) return 9999;
  const v = Number(m[1]);
  return m[2] === 'G' ? v * 1024 : v;
}

/** One-minute load average per core — the "is this box already saturated" signal. */
function loadAvg() {
  const out = sh('uptime', []);
  const m = out.match(/load averages?:\s*([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

function cores() {
  return Number(sh('sysctl', ['-n', 'hw.ncpu']).trim()) || 8;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export function preflight() {
  const swap = swapUsedGB();
  const swapTotal = swapTotalGB();
  const disk = diskFreeGB();
  const mem = physUnusedMB();
  const load = loadAvg();
  const ncpu = cores();

  const problems = [];
  const warnings = [];

  if (swap >= SWAP_BLOCK_GB) {
    problems.push(
      `swap ${swap.toFixed(2)}GB of ${swapTotal.toFixed(1)}GB >= ${SWAP_BLOCK_GB}GB ` +
      `(WORKFLOW §6.1: at 8.1GB the session serialised all captures). ` +
      `An OOM here produces a truncated frame that reads like a rendering bug.`,
    );
  } else if (swap >= SWAP_WARN_GB) {
    warnings.push(`swap ${swap.toFixed(2)}GB used — approaching the ${SWAP_BLOCK_GB}GB block.`);
  }

  if (disk < DISK_BLOCK_GB) {
    problems.push(
      `disk free ${disk.toFixed(1)}GB < ${DISK_BLOCK_GB}GB. A full disk truncates ` +
      `screenshots and emits GPU errors (WORKFLOW §6.4). Prune shots/ per §6.2.`,
    );
  } else if (disk < DISK_WARN_GB) {
    warnings.push(`disk free ${disk.toFixed(1)}GB — below the ${DISK_WARN_GB}GB comfort line.`);
  }

  if (mem < MEM_BLOCK_MB) {
    problems.push(
      `physical memory unused ${Math.round(mem)}MB < ${MEM_BLOCK_MB}MB. ` +
      `Expect a swap death, not a slow run (WORKFLOW §6.1: 66MB at peak).`,
    );
  } else if (mem < MEM_WARN_MB) {
    warnings.push(`physical memory unused ${Math.round(mem)}MB — under the ${MEM_WARN_MB}MB line.`);
  }

  if (load / ncpu > 1.5) {
    warnings.push(
      `load ${load.toFixed(2)} across ${ncpu} cores is ${(load / ncpu).toFixed(2)} per core — ` +
      `the box is shared. A capture now competes with other agents for the GPU.`,
    );
  }

  return { ok: problems.length === 0, problems, warnings, swap, swapTotal, disk, mem, load, ncpu };
}

function printHealth(p, prefix = '') {
  const tag = p.ok ? 'OK  ' : 'BLOCK';
  console.log(
    `${prefix}${tag} swap ${p.swap.toFixed(2)}/${p.swapTotal.toFixed(1)}GB  ` +
    `disk ${p.disk.toFixed(1)}GB  mem-unused ${Math.round(p.mem)}MB  ` +
    `load ${p.load.toFixed(2)}/${p.ncpu}`,
  );
  for (const w of p.warnings) console.log(`${prefix}  warn: ${w}`);
  for (const pr of p.problems) console.log(`${prefix}  BLOCK: ${pr}`);
}

// ---------------------------------------------------------------------------
// Capture lock — one GPU job at a time
// ---------------------------------------------------------------------------

function lockPath() {
  return join(LOCK_DIR, 'owner.json');
}

function readLock() {
  try {
    return JSON.parse(readFileSync(lockPath(), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Reap a lock whose owning process is gone or is older than LOCK_STALE_MIN.
 * Without this, one crashed capture silently serialises the whole session
 * behind a lock nobody will ever release — the orchestrator's own version of an
 * idle agent.
 */
function reapLock() {
  const lock = readLock();
  if (!lock) return null;
  let alive = false;
  try {
    process.kill(lock.pid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  const ageMin = (Date.now() - (lock.at ?? 0)) / 60000;
  if (!alive || ageMin > LOCK_STALE_MIN) {
    try {
      rmSync(LOCK_DIR, { recursive: true, force: true });
      console.error(
        `reaped stale capture lock (pid ${lock.pid} ${alive ? 'older than' : 'no longer running,'} ` +
        `${ageMin.toFixed(1)}min — ${lock.owner ?? 'unknown'})`,
      );
      return null;
    } catch { /* fall through */ }
  }
  return lock;
}

function acquireLock(owner) {
  mkdirSync(LOCK_DIR, { recursive: true });
  const lock = readLock();
  if (lock) {
    console.error(
      `another capture holds the lock: ${lock.owner ?? 'unknown'} (pid ${lock.pid}, ` +
      `${((Date.now() - lock.at) / 60000).toFixed(1)}min ago).\n` +
      `GPU work is serialised on this box (WORKFLOW §2.3). Wait, or reap it if that run died.`,
    );
    return false;
  }
  writeFileSync(
    lockPath(),
    JSON.stringify({ pid: process.pid, owner, at: Date.now(), host: process.env.HOSTNAME ?? '' }, null, 2),
  );
  return true;
}

function releaseLock() {
  try { rmSync(LOCK_DIR, { recursive: true, force: true }); } catch { /* already gone */ }
}

// ---------------------------------------------------------------------------
// shots/ size — §6.2 says this directory is the pressure valve
// ---------------------------------------------------------------------------

function shotsMB() {
  try {
    let bytes = 0;
    for (const d of readdirSync('shots')) {
      try { bytes += statSync(join('shots', d)).isDirectory() ? dirBytes(join('shots', d)) : 0; } catch { /* raced */ }
    }
    return Math.round(bytes / 1048576);
  } catch { return 0; }
}

function dirBytes(dir) {
  let total = 0;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += dirBytes(p);
    else { try { total += statSync(p).size; } catch { /* raced */ } }
  }
  return total;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const cmd = argv[0];
const has = (f) => argv.includes(f);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const OWNER = opt('--owner', process.env.USER ?? 'unknown');

if (cmd === 'preflight' || cmd === 'health') {
  const p = preflight();
  printHealth(p);
  if (cmd === 'health') console.log(`shots/ ${shotsMB()}MB`);
  process.exit(p.ok ? 0 : 1);
}

if (cmd === 'watch') {
  // Pane lifecycle at a glance. An idle implementer is a planning failure and a
  // blocked one is a permission prompt nobody answered (WORKFLOW §3.4).
  const ws = process.env.HERDR_WORKSPACE_ID ?? '';
  let agents = [];
  let panes = [];
  try {
    agents = JSON.parse(sh('herdr', ['agent', 'list'])).result?.agents ?? [];
    panes = JSON.parse(sh('herdr', ['pane', 'list'])).result?.panes ?? [];
  } catch { /* herdr unavailable */ }
  if (!ws) { console.error('not inside a herdr pane (HERDR_WORKSPACE_ID unset)'); process.exit(2); }
  // Labels live on the pane record, not the agent record; join them so the
  // table names people rather than pane ids.
  const labelOf = new Map(panes.map((p) => [p.pane_id, p.label ?? p.agent ?? '?']));
  const me = process.env.HERDR_PANE_ID ?? '';
  const mine = agents.filter((a) => a.workspace_id === ws && a.pane_id !== me && labelOf.get(a.pane_id) !== 'orchestrator');
  console.log(`workspace ${ws} — ${mine.length} team panes`);
  for (const a of mine) {
    const st = a.agent_status ?? 'unknown';
    // `unknown` is NOT `working`. An agent mid-long-build reports `unknown`
    // because herdr cannot classify it, and reading that as "busy" once left
    // four panes idle for a full round while the orchestrator reported no idle
    // time. Treat it as needing attention.
    const mark = st === 'working' ? '..' : st === 'idle' ? 'IDLE'
      : st === 'blocked' ? 'BLK' : st === 'done' ? 'DONE' : 'UNKN';
    console.log(`  [${mark}] ${String(labelOf.get(a.pane_id) ?? '?').padEnd(20)} ${a.pane_id}`);
  }
  const blocked = mine.filter((a) => a.agent_status === 'blocked');
  const idle = mine.filter((a) => a.agent_status === 'idle');
  // Unclassifiable is not the same as working, and neither is it the same as idle:
  // it is a pane nobody has read recently. Both need a look.
  const unknown = mine.filter((a) => !['working', 'idle', 'blocked', 'done'].includes(a.agent_status));
  console.log(`  working ${mine.length - idle.length - blocked.length - unknown.length}` +
    `  idle ${idle.length}  blocked ${blocked.length}  unclassified ${unknown.length}`);
  if (blocked.length) console.log('  ACTION: a pane is BLOCKED on a prompt — read it and answer.');
  if (idle.length) console.log('  ACTION: an idle pane needs the next brief (WORKFLOW §3.4).');
  if (unknown.length) console.log(
    '  ACTION: a pane is UNCLASSIFIED — herdr cannot tell if it is running. Read it; ' +
    'do not assume busy. All four sat `unknown` while idle for a whole round.');
  process.exit(idle.length + unknown.length ? 1 : 0);
}

if (cmd === 'lock-status') {
  reapLock();
  const lock = readLock();
  console.log(lock ? `held by ${lock.owner} (pid ${lock.pid})` : 'free');
  process.exit(0);
}

if (cmd === 'capture') {
  const force = has('--force');
  const p = preflight();
  printHealth(p);

  if (!p.ok && !force) {
    console.error(
      '\nREFUSED. This box is in the state that makes a failed capture look like a ' +
      'rendering bug (WORKFLOW §6.4).\nFree memory or prune shots/, then re-run; or pass --force ' +
      'if you accept that the frame may be a lie.',
    );
    process.exit(1);
  }
  if (p.warnings.length && !p.ok) console.error('\nproceeding under --force.');

  if (!acquireLock(OWNER)) process.exit(1);

  const args = argv.slice(1).filter((a) => a !== '--force' && a !== '--owner' && !a.startsWith('--owner='));
  const passthrough = args.filter((a) => a !== '--owner');
  const child = spawn(process.execPath, ['tools/capture.mjs', ...passthrough], {
    stdio: 'inherit',
    env: process.env,
  });
  const done = (code) => { releaseLock(); process.exit(code ?? 1); };
  child.on('exit', done);
  child.on('error', (e) => { console.error(e); done(1); });
  process.on('SIGINT', () => { child.kill('SIGINT'); done(130); });
  process.on('SIGTERM', () => { child.kill('SIGTERM'); done(143); });
} else if (cmd === 'unlock') {
  reapLock();
  rmSync(LOCK_DIR, { recursive: true, force: true });
  console.log('lock cleared');
} else if (cmd === 'prune-report') {
  // §6.2: find what the docs actually reference before deleting anything.
  const keep = new Set();
  try {
    const out = sh('grep', ['-rho', 'shots/[0-9][^/ )`]*', 'docs', 'AGENTS.md', 'README.md']);
    for (const m of out.match(/shots\/[0-9][^/ )`]*/g) ?? []) keep.add(m.split('/')[1]);
  } catch { /* no docs */ }
  console.log(`shots/ total ${shotsMB()}MB`);
  console.log(`referenced by docs (never prune): ${[...keep].sort().join(', ') || 'none'}`);
  try {
    const runs = readdirSync('shots', { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\d/.test(e.name))
      .map((e) => ({ name: e.name, mb: Math.round(dirBytes(join('shots', e.name)) / 1048576) }));
    runs.sort((a, b) => b.mb - a.mb);
    for (const r of runs.slice(0, 15)) {
      console.log(`  ${r.name}  ${r.mb}MB${keep.has(r.name) ? '  <- referenced, keep' : ''}`);
    }
    const unreferenced = runs.filter((r) => !keep.has(r.name));
    const totalUnref = unreferenced.reduce((a, r) => a + r.mb, 0);
    console.log(`unreferenced: ${unreferenced.length} runs, ${totalUnref}MB reclaimable`);
    console.log('prune by hand — WORKFLOW §6.2 warns never to delete a run a verdict cites.');
  } catch { /* no shots dir */ }
} else {
  console.log(`usage: node tools/orchestrate.mjs <preflight|health|watch|capture|lock-status|unlock|prune-report>

  preflight        exit 1 if this box cannot be believed to produce a true frame
  health           preflight + shots/ size
  watch            pane lifecycle: working / idle / blocked
  capture [args]   serialised capture with preflight + exclusive GPU lock
  lock-status      who holds the GPU lock
  unlock           clear a stale lock
  prune-report     what shots/ is holding and what the docs cite

  capture flags: --force (run anyway), --owner <name> (lock holder label)`);
  process.exit(cmd ? 1 : 0);
}