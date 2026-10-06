#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock, releaseLock, parsePlatformTelemetry, preflight, readPlatformTelemetry } from './orchestrate.mjs';

const tool = join(dirname(fileURLToPath(import.meta.url)), 'orchestrate.mjs');
const healthy = {
  swap: 'total = 8192.00M  used = 2048.00M  free = 6144.00M  (encrypted)\n',
  disk: 'Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on\n/dev/disk3s5 500000000 300000000 100000000 75% 100 1000 9% /System/Volumes/Data\n',
  mem: 'PhysMem: 12G used (2330M wired, 7488M compressor), 2G unused.\n',
  load: '15:00 up 2 days, 2 users, load averages: 2.20 2.10 2.00\n',
  ncpu: '8\n',
};

function runCli(args, values = healthy, errors = []) {
  const dir = mkdtempSync(join(tmpdir(), 'syzygy-preflight-'));
  try {
    for (const cmd of ['sysctl', 'df', 'top', 'uptime']) {
      const path = join(dir, cmd);
      writeFileSync(path, `#!${process.execPath}\n` +
        `const values = ${JSON.stringify(values)};\n` +
        `const errors = ${JSON.stringify(errors)};\n` +
        `const key = ${JSON.stringify(cmd)} === 'sysctl' ? ` +
        `(process.argv.includes('hw.ncpu') ? 'ncpu' : 'swap') : ` +
        `${JSON.stringify({ df: 'disk', top: 'mem', uptime: 'load' }[cmd] ?? '')};\n` +
        `if (errors.includes(key)) process.exit(1);\n` +
        `process.stdout.write(values[key] ?? '');\n`);
      chmodSync(path, 0o755);
    }
    // A mistaken --force bypass must never start an actual capture in this test.
    mkdirSync(join(dir, 'tools'));
    writeFileSync(join(dir, 'tools/capture.mjs'), "console.log('UNEXPECTED_CAPTURE');\n");
    return spawnSync(process.execPath, [tool, ...args], {
      cwd: dir, env: { PATH: dir }, encoding: 'utf8', timeout: 5000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const injected = (values = healthy, errors = []) => (cmd, args) => {
  const key = cmd === 'sysctl' ? (args.includes('hw.ncpu') ? 'ncpu' : 'swap')
    : { df: 'disk', top: 'mem', uptime: 'load' }[cmd];
  if (errors.includes(key)) throw new Error('fixture command unavailable');
  return values[key];
};

const parsed = parsePlatformTelemetry(healthy);
assert.deepEqual(parsed, {
  swap: 2, swapTotal: 8, disk: 100000000 / 1024 / 1024,
  mem: 2048, load: 2.2, ncpu: 8, unknown: [],
});
assert.equal(preflight(injected()).ok, true, 'known healthy capacities remain eligible');
assert.equal(parsePlatformTelemetry({ ...healthy,
  swap: 'total = 8.00G used = 2.00G free = 6.00G (encrypted)' }).swap, 2);
assert.equal(preflight(injected({ ...healthy,
  swap: 'total = 0.00M used = 0.00M free = 0.00M (encrypted)' })).ok, true,
  'measured zero swap is valid and differs from an unavailable swap probe');

for (const [text, expected] of [
  ['PhysMem: 15G used (2330M wired, 7488M compressor), 165M unused.', 165],
  ['PhysMem: 14G used (2330M wired, 7488M compressor), 1.5G unused.', 1536],
  ['PhysMem: 15G used, 512K unused.', 0.5],
]) {
  const result = preflight(injected({ ...healthy, mem: text }));
  assert.equal(result.mem, expected);
  assert.equal(result.ok, expected >= 250,
    'known low-memory host sample blocks instead of being interpreted as a probe error');
}

const swapSampleCalls = [];
readPlatformTelemetry((cmd, args) => {
  swapSampleCalls.push([cmd, args]);
  return injected()(cmd, args);
});
assert.equal(swapSampleCalls.filter(([cmd, args]) => cmd === 'sysctl' && args.includes('vm.swapusage')).length, 1,
  'swap used/total are read atomically from one command result');

for (const key of ['swap', 'disk', 'mem']) {
  for (const bad of ['', undefined, 'permission denied', 'NaN', 'Infinity']) {
    const result = preflight(injected({ ...healthy, [key]: bad }));
    assert.equal(result.ok, false, `${key} must fail closed for ${JSON.stringify(bad)}`);
    assert.equal(result[key], null, `${key} must stay unknown without a healthy fallback`);
    assert.ok(result.unknownCritical.includes(key));
    assert.ok(result.problems.some((p) => /unknown/.test(p)));
  }
  const failedProbe = preflight(injected(healthy, [key]));
  assert.equal(failedProbe.ok, false, `${key} command exception must block`);
  assert.equal(failedProbe[key], null);

  const commandError = runCli(['preflight'], healthy, [key]);
  assert.equal(commandError.status, 1, `${key} command failure must give a nonzero CLI result`);
  assert.match(commandError.stdout, /BLOCK.*unknown/);
  const forced = runCli(['capture', '--force'], healthy, [key]);
  assert.equal(forced.status, 1, 'force must not convert missing evidence into permission to capture');
  assert.doesNotMatch(forced.stdout, /UNEXPECTED_CAPTURE/);
  assert.match(forced.stderr, /--force cannot override missing evidence/);
}

for (const [key, malformed] of [
  ['swap', 'total = 8G used = 9G free = 0G'],
  ['swap', 'total = 8G used = -1G free = 9G'],
  ['swap', 'total = 8G used = 1..5G free = 6.5G'],
  ['disk', healthy.disk.replace('100000000', 'NaN')],
  ['disk', healthy.disk.replace('100000000', '900000000')],
  ['disk', healthy.disk.split('\n').slice(1).join('\n')],
  ['mem', 'PhysMem: 15G used (2330M wired), -1M unused.'],
  ['mem', 'PhysMem: 15G used (2330M wired), 1..5G unused.'],
]) {
  const result = preflight(injected({ ...healthy, [key]: malformed }));
  assert.equal(result.ok, false, `${key} malformed data must not pass by comparing NaN`);
  assert.equal(result[key], null);
}

const allUnknown = preflight(() => { throw new Error('unavailable'); });
assert.equal(allUnknown.ok, false);
assert.deepEqual(allUnknown.unknownCritical, ['swap', 'disk', 'mem']);
assert.equal(allUnknown.load, null);
assert.equal(allUnknown.ncpu, null, 'CPU count is unknown rather than an invented eight');
const optionalUnknown = preflight(injected(healthy, ['load', 'ncpu']));
assert.equal(optionalUnknown.ok, true, 'unknown advisory load/core telemetry does not hide known capacities');
assert.equal(optionalUnknown.warnings.filter((p) => /unknown/.test(p)).length, 2);

for (const [mem, ok, warning] of [[249, false, false], [250, true, true], [499, true, true], [500, true, false]]) {
  const result = preflight(injected({ ...healthy, mem: `PhysMem: 15G used (1G wired), ${mem}M unused.` }));
  assert.equal(result.ok, ok, `existing memory gate stays at 250MB (${mem})`);
  assert.equal(result.warnings.some((p) => /physical memory/.test(p)), warning);
}
for (const [disk, ok, warning] of [[9, false, false], [10, true, true], [19, true, true], [20, true, false]]) {
  const result = preflight(injected({ ...healthy,
    disk: healthy.disk.replace('100000000', String(disk * 1024 * 1024)) }));
  assert.equal(result.ok, ok, `existing disk gate stays at 10GB (${disk})`);
  assert.equal(result.warnings.some((p) => /disk free/.test(p)), warning);
}
for (const [ratio, ok, warning] of [[0.74, true, false], [0.75, true, true], [0.879, true, true], [0.88, false, false]]) {
  const result = preflight(injected({ ...healthy,
    swap: `total = 1000M used = ${ratio * 1000}M free = ${(1 - ratio) * 1000}M (encrypted)` }));
  assert.equal(result.ok, ok, `existing swap gate stays at 88% (${ratio})`);
  assert.equal(result.warnings.some((p) => /^swap /.test(p)), warning);
}

const healthyCli = runCli(['preflight']);
assert.equal(healthyCli.status, 0);
assert.match(healthyCli.stdout, /^OK\s/);
const imported = spawnSync(process.execPath, ['--input-type=module', '-e',
  `await import(${JSON.stringify(new URL('./orchestrate.mjs', import.meta.url).href)}); console.log('IMPORTED');`],
{ encoding: 'utf8', timeout: 5000 });
assert.equal(imported.status, 0);
assert.equal(imported.stdout, 'IMPORTED\n', 'importing probes must not run CLI or exit the caller');
assert.equal(imported.stderr, '');

const lockDir = mkdtempSync(join(tmpdir(), 'syzygy-gpu-lock-'));
const previousCwd = process.cwd();
try {
  process.chdir(lockDir);
  mkdirSync('shots/.caplock', { recursive: true });
  assert.equal(acquireLock('must-not-steal-initializing-lock'), false,
    'a directory with no owner yet is already claimed, not free');
  assert.equal(releaseLock(), false, 'an unreadable owner is not our claim to remove');
  assert.equal(existsSync('shots/.caplock'), true);
  writeFileSync('shots/.caplock/owner.json', JSON.stringify({ pid: process.pid + 100000, owner: 'other' }));
  assert.equal(releaseLock(), false, 'late cleanup cannot remove another owner');
  assert.equal(JSON.parse(readFileSync('shots/.caplock/owner.json', 'utf8')).owner, 'other');
  rmSync('shots/.caplock', { recursive: true });
  assert.equal(acquireLock('selftest-owner'), true);
  assert.equal(JSON.parse(readFileSync('shots/.caplock/owner.json', 'utf8')).pid, process.pid);
  assert.equal(acquireLock('same-process-second-job'), false, 'a second job cannot overwrite a live claim');
  assert.equal(releaseLock(), true);
  assert.equal(existsSync('shots/.caplock'), false);

  // Release both contenders from one barrier. The winner holds its claim until
  // both acquire attempts have had time to run; no GPU or capture is started.
  const script = `import {acquireLock,releaseLock} from ${JSON.stringify(new URL('./orchestrate.mjs', import.meta.url).href)};
    console.log('READY'); process.stdin.once('data',()=>{
      const claimed=acquireLock('contender-'+process.pid); console.log('CLAIM '+claimed);
      if(claimed) setTimeout(()=>{releaseLock();process.exit(0)},250);
      else process.exit(0);
    });`;
  const contenders = [0, 1].map(() => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], { cwd: lockDir, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const ready = new Promise((resolve) => child.stdout.on('data', (chunk) => { output += chunk; if (output.includes('READY')) resolve(); }));
    const done = new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolve(output) : reject(new Error(`lock contender exit ${code}`)));
    });
    return { child, ready, done };
  });
  await Promise.all(contenders.map((c) => c.ready));
  for (const contender of contenders) contender.child.stdin.end('go');
  const claims = await Promise.all(contenders.map((c) => c.done));
  assert.equal(claims.filter((output) => output.includes('CLAIM true')).length, 1,
    'simultaneous GPU jobs have exactly one atomic lock owner');
  assert.equal(claims.filter((output) => output.includes('CLAIM false')).length, 1);
  assert.equal(existsSync('shots/.caplock'), false, 'only the winning owner releases its completed job');
} finally {
  process.chdir(previousCwd);
  rmSync(lockDir, { recursive: true, force: true });
}
console.log('ALL PASS: orchestration preflight + atomic GPU lock');
