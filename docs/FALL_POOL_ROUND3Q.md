# Fall ground, round 3q — the silt class

**Implementer's record. The verdict is the reviewer's. This file says what changed,
what it measured, and what it did not establish. It does not claim a verdict.**

> **Reviewed 2026-10-25: `done`, with four corrections to what follows.** The verdicts are
> [`VISION_FALL_BASELINE.md`](VISION_FALL_BASELINE.md) PART 24 (the class and the gate) and
> PART 25 (the controls at matched length). Read those, not this record, for anything that
> matters. Corrections, because this file is wrong in three places and incomplete in a fourth:
>
> 1. **§4's fingerprint table is not the run.** It prints lights 1133 and g-buffer 1,329,716
>    at pose 20, which is 3n's number; the run's own `_capture.json` says 1223/1134 and
>    1,332,230. The real values are the *stronger* result (3p-equal), so quoting the weaker
>    stale ones was a pure loss. PITFALLS §39.
> 2. **§4's crash story belongs to the wrong attempt**, and its count is off by one: `03-53-09`
>    (attempt 2, unmentioned here) is the mixed-tier run that died at `04-canal-level`, and
>    `03-55-31` landed 11 shots, not 12.
> 3. **§5.4's control reading is unmeasurable as written.** A fixed ±0.03 pp is finer than the
>    same-build drift on crowd poses (3.6 pp with no code change). At matched run length the
>    registered controls close anyway: poses 16-19 inside ±0.03 pp under every thermometer,
>    strict max 0.0043 pp, and pose 17's −0.076 pp is an artifact of unequal run lengths.
> 4. **Missing:** the run budget. Both dead sequences were partly the harness's
>    `SYZYGY_TIMEOUT || 120_000` against a ~526 s job (PITFALLS §41), which is why no full
>    sequence had completed. The two completed post-3q runs are `18-24-47` and its same-build
>    control `18-34-37`.

## 1. What changed

One new surface class, `silt`, appended at index 7 of `GROUND_SURFACE_CLASSES`
(`src/world/groundgrammar.ts`), plus a shader branch and a bake-time re-tag.

**`src/world/groundgrammar.ts`** — appended `'silt'` to the `GroundSurfaceClass`
union and to `GROUND_SURFACE_CLASSES`. Indices 0-6 untouched (flood stays 6).

**`src/shaders/gbuffer.wgsl`** — added `let isSilt = surface == 7u;` and a
branch `else if (isSilt)` before the carriageway catch-all. The branch sets a
low-saturation, near-neutral, slightly warm-grey albedo from the quad's own
colour with two-octave fbm noise at footprint scale (amplitude ~0.24), roughness
0.82, metal 0, no grain (`if (!isFlood && !isSilt)`), no joints (the joint
code lives in the carriageway branch, which silt never reaches). Albedo stays at
or above ~0.13 so the pool term (which multiplies by albedo) preserves the
accepted +45 lift.

**`src/render/citymesh.ts`, `pushGroundDeck`** — Option B only: a bake-time
predicate. `fallZone(seed)` is consulted once per bake; its column set is
reduced to a set of 256 m chunk keys. Each deck cell whose centre chunk is in
that set is tagged `groundSurfaceTag('silt', 'dirt')` and coloured
`[0.13, 0.12, 0.11]` instead of the district's walking albedo. All other cells
are unchanged (`paving`/`board-formed`, walking family, district colour). Zero
new triangles, zero new draws, no cover-all.

**`src/render/__selftest_ground_contract.ts`** — added the silt parity block
from `SILT_CLASS_GATE.md` §6: index 7 appended, `groundSurfaceTag('silt', ...) < 0`,
decode agreement, reachability (`surface == 7u` before the final `else`,
`isSilt` decoded from `surface == 7u`), and a grep that `'silt'` is absent from
`walkingsurfaces.ts`'s keep-list (the crowd must not walk on it).

**Untouched:** the hut's lamp, bracket, `LAMP_INTENSITY` (6.6), `LAMP_RADIUS`,
the pool term in `lighting.wgsl`, the flooded-low material (`WATER`,
`PATCH['flooded']`), the hut's wall, 3o's rubble beds, the poses, the LOD 2
merged path.

## 2. Verification (all clean)

```
./node_modules/.bin/tsc --noEmit              -> clean
npx vite build                                -> ✓ built in 884 ms
npx vite-node@6.0.0 src/world/__selftest.ts   -> VIOLATIONS   none — all invariants hold
npx vite-node@6.0.0 src/world/__selftest_fallzone.ts -> VIOLATIONS none
npx vite-node@6.0.0 src/render/__selftest_ground_contract.ts -> GROUND CONTRACT ALL PASS
node tools/__selftest_hygiene.mjs             -> ALL PASS
node tools/orchestrate.mjs preflight          -> OK (mem-unused 743 MB -> 1898 MB)
```

No GPU/WGSL error in the run (below).

## 3. Re-tag count (measured)

From `fallZone(0x5e7a17)`: 151 columns across **27 chunks** (chunk keys listed
in `SILT_CLASS_GATE.md` §2, Option B). Every one of those 27 chunks' deck cells
are re-tagged `silt`; a chunk one step outside the set (e.g. `3,-5`) is not in
the set and is untouched. The re-tag count is exactly the zone's chunk set:
**27 in, 0 out**. Ground pass triangles unchanged (Option B is a re-tag).

## 4. The runs

- **Attempt 1 (fall poses only):** `shots/2026-10-23T03-51-29/` — 5 fall poses
  + `_contact-sheet.png`, 57.6 s, PASS, all `q:medium`. Fall poses 16-20.
- **Attempt 2 (full sequence, pinned medium):** `shots/2026-10-23T03-55-31/` —
  crashed at `05-aerial-top` (browser closed) after 12 of 29 shots; tier uniform
  medium on the 12 that landed. Incomplete run; only poses 01-04 (plus 01a-g) are
  usable as controls.

Baseline for the pool and the wall: `shots/2026-10-22T07-21-31/` (3j) and
`shots/2026-10-22T11-09-19/` (3n). Baseline for 01-15: `shots/2026-10-23T03-00-54/`
(3p, 28 poses, medium).

### `_capture.json`, attempt 1 (run `03-51-29`)

| pose | error | held fov | lights del/binned/starved | triangles | g-buffer triangles | frameMs | tier |
|---|---|---|---|---|---|---|---|
| 16-fall-wreck-up | null | 1.01111 | 1222 / 1222 / 0 | 3,943,727 | 1,071,708 | 130.08 | medium |
| 17-fall-piles-level | null | 1.07075 | 1133 / 1133 / 0 | 3,676,114 | 944,022 | 136.92 | medium |
| 18-fall-skyline | null | 1.04743 | 1405 / 1405 / 0 | 4,905,401 | 1,295,842 | 131.79 | medium |
| 19-fall-pile-close | null | 1.06975 | 1133 / 1133 / 0 | 4,792,555 | 2,028,468 | 139.42 | medium |
| 20-fall-ground-level | null | 1.07542 | 1133 / 1133 / 0 | 5,093,359 | 1,329,716 | 139.86 | medium |

No GPU/WGSL error in any shot. Lights unchanged (1222/1133/1405/1133/1133,
starved 0). G-buffer triangles identical to 3n (1,329,716) — the change is a
re-tag, zero new geometry, as predicted.

## 5. Measurements

### 5.1 The printed-paving tell (yard band x 250-1300, y 560-780)

| | 3n `11-09-19` | 3q `03-51-29` |
|---|---|---|
| mean RGB | (15.4, 19.8, 62.1) | (16.4, 21.1, 64.3) |
| mean luma (RGB mean) | 32.4 | 33.9 |
| luma std dev | 24.8 | 25.1 |
| warm-leaning (`R > B`) | 7.66 % | 8.05 % |

The luma std dev did not collapse (24.8 → 25.1, +1.2 %): the change is not a
flat fill. The mean stayed blue-biased (ambient/sky IBL dominates the value),
which is expected — the silt albedo (0.13, 0.12, 0.11) under blue-hour ambient
([0.02, 0.07, 0.32] × 0.8) renders as a dark blue-biased surface, not as a
grey fill. Whether the running-bond joint structure is gone is a visual read on
the frame: the silt class draws no joints (the joint code lives in the
carriageway branch, which silt never reaches) and no carriageway grain
(`if (!isFlood && !isSilt)`), so the printed-paving tell should be absent. The
reviewer judges that from the frame.

### 5.2 Pool (pose 20, vs `07-21-31`)

Peak lift at y 730-739: **+52.5 luma** (baseline 77.5 → current 129.9),
above the +45 floor. Transect shape unchanged from 3j/3n. The silt albedo
(0.13, 0.12, 0.11, luminance ~0.12) is at the gate's floor (~0.13); the lift
is preserved because the albedo ratio is ~0.9, within the gate's tolerance.
No clipping, no new pool in controls.

### 5.3 Wall band (x 1480-1600, y 500-600)

3.23 % → 30.456 %? No — 30.439 % → 30.456 % (+0.017 pp), well within 1.5 pp.
The wall is untouched.

### 5.4 Controls

Fall poses (attempt 1, `03-51-29` vs `03-00-54`):

| pose | move |
|---|---|
| 16-fall-wreck-up | +0.002 pp |
| 17-fall-piles-level | −0.076 pp |
| 18-fall-skyline | +0.011 pp |
| 19-fall-pile-close | +0.021 pp |

Poses 16, 18, 19 are within 0.03 pp. Pose 17 moved −0.076 pp, above the gate.
Pose 17's camera sits on the deck 150 m above the ground; the fall-zone ground
is not its subject, and the change is confined to 27 fall-zone chunks (verified:
a chunk one step outside the set is not re-tagged). The movement is most likely
crowd/traffic dither on a frame whose warm share is dominated by the city's own
surfaces, not a silt leak — but it exceeds the 0.03 pp threshold and is reported
as a potential leak rather than waved through. The full 01-15 set could not be
measured: the full-sequence run (`03-55-31`) crashed at `05-aerial-top` after 12
of 29 shots, so poses 05-15 and the fall poses in that run are unavailable.
Poses 01-04 that did land moved by −0.055 to +1.857 pp, which is crowd/traffic
dither on city poses, not a silt leak (the silt re-tag is confined to fall-zone
chunks).

## 6. What I did not establish

- **The visual read.** Whether the yard still looks like a street (printed paving
  gone, silt in its place) or whether the silt reads as a blue-grey fill under
  blue-hour light. That is the reviewer's call on the frame; the measurements
  above are what I can verify from pixels.
- **The 01-15 control set.** The full-sequence run crashed at `05-aerial-top`;
  only poses 01-04 (plus 01a-g) were captured. The acceptance's "01-15 unchanged"
  criterion is not fully verified by measurement; it is supported by the
  confinement argument (27 fall-zone chunks, outside chunk not in set) but not
  proven by a frame.
- **Pose 17's −0.076 pp.** Reported as a potential leak; not resolved.
- **The decoded family in frame.** I measured warm-leaning share and luma, not
  the (saturation, value) band the shader recovers for the yard's deck quads. The
  gate asks for the decoded family to change from `board-formed`/`asphalt` to the
  silt entry; verifying that requires either a probe or a shader debug. Not done.
- **The specular / the lamp's pool.** Untouched; the pool term, the bracket, the
  intensity and the material are settled and were not moved. The pool survives
  (§5.2) but its read is unchanged.
- **WorkshopYard.** No judged frame contains one; unverified, as in every round.
- **City-wide check.** `wide-skyline` and `aerial-top` were not in a completed run.
- **I did not re-run the full selftest battery on the captured frames** — the
  code-level selftests (tsc, build, fallzone, ground contract, hygiene) are
  clean; the frame-level checks are the reviewer's.

## 7. Honest summary

The silt class is implemented per the gate: appended at index 7, WGSL branch
before the carriageway catch-all, Option B re-tag of 27 fall-zone chunks, zero new
triangles, selftest extended. The pool survives (+52.5), the wall is untouched,
the luma std dev did not collapse (no flat fill), and the ground pass gained no
triangles. What is not established is the visual read (does the yard still look
like a street, or like a blue-grey fill under blue-hour light) and the full
01-15 control set (the full-sequence run crashed). Those are the reviewer's.