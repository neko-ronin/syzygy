# Capture preflight: unknown capacity must block

Date: 2026-10-06. Scope: `tools/orchestrate.mjs` and the headless
`tools/__selftest_orchestrate.mjs`; no captures, dependency
installs, or commits.

## Defect and control

The capture guard interpreted a failed `top` probe as **9999 MB unused**,
unavailable swap as zero, unavailable disk as 999 GB, and unknown CPU count as
eight. Malformed disk output could also become `NaN`, which bypasses ordinary
less-than checks. The result claimed a healthy machine without measuring it.

The regression command was written and run before the fix:

```text
node tools/__selftest_orchestrate.mjs
AssertionError: unavailable physical-memory telemetry must refuse capture eligibility:
OK   swap 2.00/8.0GB  disk 95.4GB  mem-unused 9999MB  load 2.20/8
0 !== 1
```

That fixture drove the actual CLI with a failing `top` executable and otherwise
known healthy command outputs. It did not run a capture. A dummy capture script
in an isolated temporary directory protects the later `--force` regression from
starting real GPU work if the guard regresses.

Ranked hypotheses were healthy fallback on command failure, rejection of valid
macOS output, and malformed numeric output bypassing comparisons. The first was
reproduced directly; the test suite also locks down the other failure paths.

## Change

Platform readings now pass through an exported pure parser and injectable probe
runner. Unknown values stay `null`, are printed as `unknown`, and produce
explicit blocking problems for physical memory, disk, and swap. Used/total swap
come from a single observation. Optional load/core telemetry is also reported
unknown rather than assigned an invented value; it produces advisory warnings.

CLI execution is guarded so importing probes neither prints usage nor exits the
caller. `capture --force` cannot override unknown critical measurements. The
existing block/warning thresholds are unchanged: 250/500 MB unused memory,
10/20 GB disk, and 88/75% swap. The existing override for known measurements is
not used by this work.

The shared GPU lock now claims `shots/.caplock` with an atomic, non-recursive
`mkdir`. An existing directory blocks even while its owner file is being
initialised; two launches cannot both read an empty owner and overwrite it.
The reusable acquire/release functions let the benchmark use the same guard.
Release checks the owning PID, so a delayed cleanup cannot remove another
process's active claim. This repair never cleared or modified the live lock.

## Verification

```text
node tools/__selftest_orchestrate.mjs
ALL PASS: orchestration preflight + atomic GPU lock

node --check tools/orchestrate.mjs
node --check tools/__selftest_orchestrate.mjs
```

Tests cover healthy samples; measured zero swap; M/G swap units; K/M/G memory
units; the reported 165 MB host sample; exceptions, missing and malformed output
for every critical probe; non-finite values; impossible capacities; unchanged
threshold boundaries; one swap command per sample; CLI exit status; refusal to
capture under `--force` when telemetry is unknown; and import side effects.
These tests concern eligibility and the regression, not rendering or performance.
Lock properties additionally cover an initializing/unreadable owner, refusal to
overwrite a live claim, owner-only cleanup, and two child processes released
from one barrier: exactly one can acquire the shared GPU lock. Those processes
do not launch a browser or capture. Syntax and owned-file `git diff --check`
also pass.

Running `node tools/orchestrate.mjs preflight` in the restricted environment now
returned **exit 1** with unknown swap/memory and unknown core count; readable disk
was 23.4 GB. The same read-only command with actual host probe access also
returned **exit 1**:

```text
BLOCK swap 1.40/3.0GB  disk 23.4GB  mem-unused 75MB  load 5.52/8
BLOCK: physical memory unused 75MB < 250MB.
```

Those are separate environments and a single resource snapshot, not stable
machine capacity or an FPS benchmark. The current host is below the existing
capture memory threshold. No capture was attempted or forced.

## Round reflection

This remains the related capture-trust repair requested by the orchestrator.
The failing eligibility path is fixed and tested; the machine's current low RAM
is an external condition that code changes do not remedy. The next useful work
is independent review of already saved frames while the capture gate remains
closed. An agent other than this implementer must review the guard change.
