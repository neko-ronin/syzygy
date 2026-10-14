#!/usr/bin/env node
/**
 * Self-check for tools/hygiene.mjs: every rule fires on a leak and stays quiet
 * on the look-alikes this repo is full of (version strings, number tables,
 * no-reply addresses). Leaks are assembled at runtime from pieces, so this file
 * passes the screen it tests. Run: node tools/__selftest_hygiene.mjs
 */
import assert from 'node:assert/strict';
import { addedLines, scanLine, scanText } from './hygiene.mjs';

const j = (...parts) => parts.join('');
const rules = (line, deny) => scanLine(line, deny).map((f) => f.rule);

// Each leak is caught, by the rule that names it.
const leaks = [
  ['home-path', j('cd /', 'Us', 'ers/someone/code')],
  ['home-path', j('log at /', 'ho', 'me/someone/app.log')],
  ['home-path', j('C:', '\\', 'Us', 'ers', '\\', 'someone')],
  ['scratch-path', j('"output": "/pri', 'vate/tmp/x"')],
  ['scratch-path', j('/var/fo', 'lders/ab/T/x')],
  ['scratch-path', j('slug -Us', 'ers-someone-code-app')],
  ['email', j('mail me: some.one', '@', 'example-mail.io')],
  ['phone', j('call 555', '-', '123-4567')],
  ['phone', j('(415) 555', '-', '0100')],
  ['ssn', j('id 123', '-', '45-6789')],
  ['card-number', j('4111 1111', ' ', '1111 1111')],
  ['ip-address', j('host 192', '.168.1.20 up')],
  ['mac-address', j('nic a4:83:e7', ':', '12:34:56')],
  ['private-key', j('-----BEGIN OPENSSH PRIV', 'ATE KEY-----')],
  ['secret-token', j('key sk-a', 'nt-', 'a'.repeat(24))],
  ['secret-token', j('token gh', 'p_', 'A'.repeat(36))],
];
for (const [rule, line] of leaks) assert.ok(rules(line).includes(rule), `${rule} missed: ${line}`);

// Look-alikes stay quiet.
const quiet = [
  '"jsVersion": "15.3.76.4",',                         // a version, not an address
  '"product": "Chrome/153.0.8010.12",',
  'tri counts 256 531 1152 per tier',                   // a number table, not a phone
  'dates 2026-10-14 and 2026-10-07',
  'timestamp 1792001369021 ms',
  j('commit as 2', '86168278+neko-ronin', '@', 'users.noreply.github.com'),
  j('placeholder', '@', 'example.com'),
  'loopback 127.0.0.1 and docs range 192.0.2.0',
  '/api/chat returns 404; assets under /assets/',
  'read docs/PROCESS.md, then src/main.ts',
  'Distance, not vibes.',
];
for (const line of quiet) assert.deepEqual(rules(line), [], `false alarm on: ${line}`);

// Private terms match case-insensitively as substrings, and only when listed.
const deny = [j('/wor', 'kspace/'), 'zz-owner'];
assert.deepEqual(rules(j('see /home2/WOR', 'KSPACE/notes'), deny), ['private-term']);
assert.deepEqual(rules('signed ZZ-Owner', deny), ['private-term']);
assert.deepEqual(rules('signed zz-owner', []), []);

// Co-author trailers are a message rule, not a file rule.
const coLine = j('Co-Authored', '-By: Someone');
assert.deepEqual(scanText(coLine, 'file').map((f) => f.rule), []);
const messageRules = [{ id: 'co-author', re: /co-authored-by\s*:/gi }];
assert.deepEqual(scanText(coLine, 'msg', [], messageRules).map((f) => f.rule), ['co-author']);

// Added lines come back with their new-file line numbers.
const diff = ['diff --git a/x.md b/x.md', '--- a/x.md', '+++ b/x.md', '@@ -3,0 +4,2 @@', '+one', '+two', '@@ -9 +11 @@', '-old', '+three'].join('\n');
assert.deepEqual(addedLines(diff).map((a) => `${a.file}:${a.line}:${a.text}`), ['x.md:4:one', 'x.md:5:two', 'x.md:11:three']);

console.log(`ALL PASS: ${leaks.length} leaks caught, ${quiet.length} look-alikes quiet, private terms, message rules, diff lines`);
