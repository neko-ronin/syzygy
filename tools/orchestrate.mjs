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
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Thresholds — WORKFLOW.md §6.1
// ---------------------------------------------------------------------------

/**
 * Swap is judged as a FRACTION of total, not in absolute GB.
 *
 * The original threshold was 4.5 GB absolute, copied from the WORKFLOW §6.1
 * datapoint where the box had 8.1 GB used of 9.2 GB total. macOS then grew total
 * swap to 8.0 GB under pressure, and the absolute threshold became meaningless:
 * it blocked at 80% full while the datapoint that justified blocking was 88%
 * full. Worse, it blocked a capture at 1286 MB of genuinely free memory.
 *
 * What actually predicts a failed capture is free RAM. Swap is a lagging
 * record of pressure that has already passed — the kernel does not fault pages
 * back in just because RAM freed up — so it is a warning signal, not the gate.
 * The gate is MEM_BLOCK_MB.
 */
const SWAP_WARN_RATIO = 0.75;
const SWAP_BLOCK_RATIO = 0.88;

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

/**
 * Parse platform output without inventing healthy measurements when a command
 * is unavailable. null means unknown; it must never compare as free capacity.
 * Kept pure so fixtures exercise the same interpretation as a real capture.
 */
export function parsePlatformTelemetry(raw = {}) {
  const out = (key) => typeof raw[key] === 'string' ? raw[key].trim() : '';
  const finite = (n) => Number.isFinite(n) && n >= 0;
  const amount = '(\\d+(?:\\.\\d+)?)([MG])';
  const swapMatch = out('swap').match(new RegExp(
    `^total\\s*=\\s*${amount}\\s+used\\s*=\\s*${amount}\\s+free\\s*=\\s*${amount}(?:\\s+\\(encrypted\\))?$`,
  ));
  const gib = (v, unit) => Number(v) / (unit === 'M' ? 1024 : 1);
  let swap = null;
  let swapTotal = null;
  if (swapMatch) {
    const total = gib(swapMatch[1], swapMatch[2]);
    const used = gib(swapMatch[3], swapMatch[4]);
    const free = gib(swapMatch[5], swapMatch[6]);
    if ([total, used, free].every(finite) && used <= total && free <= total) {
      swap = used;
      swapTotal = total;
    }
  }

  // df -k provides integer 1K blocks. A header/error line is not a data row.
  const lines = out('disk').split(/\r?\n/);
  const fields = (lines.at(-1) ?? '').split(/\s+/);
  let disk = null;
  if (lines.length >= 2 && /\b(?:1024-blocks|1K-blocks)\b/.test(lines[0]) &&
      fields.length >= 6 && fields.slice(1, 4).every((v) => /^\d+$/.test(v)) &&
      /^\d+%$/.test(fields[4])) {
    const [total, used, available] = fields.slice(1, 4).map(Number);
    if ([total, used, available].every(finite) && total > 0 && used <= total && available <= total) {
      disk = available / 1024 / 1024;
    }
  }

  // Examples: "15G used (...), 165M unused." and "14G used (...), 1.5G unused."
  const memMatch = out('mem').match(
    /^PhysMem:\s*(\d+(?:\.\d+)?)([KMG])\s+used\s*(?:\([^\n)]*\))?,\s*(\d+(?:\.\d+)?)([KMG])\s+unused\.?\s*$/m,
  );
  const mib = (v, unit) => Number(v) * ({ K: 1 / 1024, M: 1, G: 1024 }[unit]);
  let mem = null;
  if (memMatch && finite(mib(memMatch[1], memMatch[2])) && finite(mib(memMatch[3], memMatch[4]))) {
    mem = mib(memMatch[3], memMatch[4]);
  }

  const loadMatch = out('load').match(
    /load averages?:\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/,
  );
  const load = loadMatch && loadMatch.slice(1).map(Number).every(finite) ? Number(loadMatch[1]) : null;
  const cpu = /^\d+$/.test(out('ncpu')) ? Number(out('ncpu')) : null;
  const ncpu = Number.isSafeInteger(cpu) && cpu > 0 ? cpu : null;
  const unknown = [
    ...(swap === null ? ['swap'] : []), ...(disk === null ? ['disk'] : []),
    ...(mem === null ? ['mem'] : []), ...(load === null ? ['load'] : []),
    ...(ncpu === null ? ['ncpu'] : []),
  ];
  return { swap, swapTotal, disk, mem, load, ncpu, unknown };
}

/** One sample per probe; used/total swap must come from the same observation. */
export function readPlatformTelemetry(run = sh) {
  const probe = (cmd, args) => {
    try { return run(cmd, args); } catch { return ''; }
  };
  return parsePlatformTelemetry({
    swap: probe('sysctl', ['-n', 'vm.swapusage']),
    disk: probe('df', ['-k', '/System/Volumes/Data']),
    mem: probe('top', ['-l', '1', '-n', '0']),
    load: probe('uptime', []),
    ncpu: probe('sysctl', ['-n', 'hw.ncpu']),
  });
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

export function preflight(run = sh) {
  const telemetry = readPlatformTelemetry(run);
  const { swap, swapTotal, disk, mem, load, ncpu, unknown } = telemetry;

  const problems = [];
  const warnings = [];
  const critical = { swap: 'swap usage', disk: 'disk free space', mem: 'physical memory unused' };
  const unknownCritical = unknown.filter((key) => key in critical);
  for (const key of unknownCritical) {
    problems.push(`${critical[key]} telemetry unknown: command unavailable, failed, or output not recognized. ` +
      'Refusing capture until this capacity can be measured.');
  }
  for (const key of unknown.filter((key) => !(key in critical))) {
    warnings.push(`${key === 'load' ? 'load average' : 'CPU count'} telemetry unknown; load per core cannot be assessed.`);
  }

  const swapRatio = swap === null ? null : swapTotal > 0 ? swap / swapTotal : 0;
  if (swapRatio !== null && swapRatio >= SWAP_BLOCK_RATIO) {
    problems.push(
      `swap ${swap.toFixed(2)}GB of ${swapTotal.toFixed(1)}GB = ${(swapRatio * 100).toFixed(0)}% ` +
      `full (block at ${(SWAP_BLOCK_RATIO * 100).toFixed(0)}%). WORKFLOW §6.1 recorded 8.1 of 9.2GB ` +
      `— 88% — as the point where the session serialised all captures. ` +
      `An OOM here produces a truncated frame that reads like a rendering bug.`,
    );
  } else if (swapRatio !== null && swapRatio >= SWAP_WARN_RATIO) {
    warnings.push(
      `swap ${(swapRatio * 100).toFixed(0)}% full (${swap.toFixed(2)}/${swapTotal.toFixed(1)}GB) — ` +
      `past ${(SWAP_WARN_RATIO * 100).toFixed(0)}%. Swap is a lagging record of pressure, so this is ` +
      `a warning rather than the gate; free RAM is the gate.`,
    );
  }

  if (disk !== null && disk < DISK_BLOCK_GB) {
    problems.push(
      `disk free ${disk.toFixed(1)}GB < ${DISK_BLOCK_GB}GB. A full disk truncates ` +
      `screenshots and emits GPU errors (WORKFLOW §6.4). Prune shots/ per §6.2.`,
    );
  } else if (disk !== null && disk < DISK_WARN_GB) {
    warnings.push(`disk free ${disk.toFixed(1)}GB — below the ${DISK_WARN_GB}GB comfort line.`);
  }

  if (mem !== null && mem < MEM_BLOCK_MB) {
    problems.push(
      `physical memory unused ${Math.round(mem)}MB < ${MEM_BLOCK_MB}MB. ` +
      `Expect a swap death, not a slow run (WORKFLOW §6.1: 66MB at peak).`,
    );
  } else if (mem !== null && mem < MEM_WARN_MB) {
    warnings.push(`physical memory unused ${Math.round(mem)}MB — under the ${MEM_WARN_MB}MB line.`);
  }

  if (load !== null && ncpu !== null && load / ncpu > 1.5) {
    warnings.push(
      `load ${load.toFixed(2)} across ${ncpu} cores is ${(load / ncpu).toFixed(2)} per core — ` +
      `the box is shared. A capture now competes with other agents for the GPU.`,
    );
  }

  return { ok: problems.length === 0, problems, warnings, ...telemetry, unknownCritical };
}

function printHealth(p, prefix = '') {
  const tag = p.ok ? 'OK  ' : 'BLOCK';
  const value = (n, places = 0) => n === null ? 'unknown' : n.toFixed(places);
  console.log(
    `${prefix}${tag} swap ${value(p.swap, 2)}/${value(p.swapTotal, 1)}GB  ` +
    `disk ${value(p.disk, 1)}GB  mem-unused ${value(p.mem)}MB  ` +
    `load ${value(p.load, 2)}/${value(p.ncpu)}`,
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

export function acquireLock(owner) {
  // mkdir itself is the claim. Reading then overwriting owner.json lets two
  // launches both observe an empty lock and run GPU jobs simultaneously.
  mkdirSync('shots', { recursive: true });
  try {
    mkdirSync(LOCK_DIR);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const lock = readLock();
    console.error(
      `another GPU job holds the lock: ${lock?.owner ?? 'owner initializing or unreadable'} ` +
      `(pid ${lock?.pid ?? 'unknown'}).\n` +
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

export function releaseLock() {
  // A delayed exit handler must not clear a newer process's claim.
  if (readLock()?.pid !== process.pid) return false;
  try { rmSync(LOCK_DIR, { recursive: true, force: true }); return true; } catch { return false; }
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

export function main(argv = process.argv.slice(2)) {
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

  if (!p.ok && (!force || p.unknownCritical.length > 0)) {
    console.error(
      '\nREFUSED. This box is in the state that makes a failed capture look like a ' +
      'rendering bug (WORKFLOW §6.4).\n' +
      (p.unknownCritical.length > 0
        ? 'Critical telemetry is unknown. Restore probe access/output and re-run; --force cannot override missing evidence.'
        : 'Free memory or prune shots/, then re-run; or pass --force if you accept that the frame may be a lie.'),
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
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
