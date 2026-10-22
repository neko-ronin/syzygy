# Fall lit rows, round 3k — gate not passed (bay-width cap)

**Implementer's record. No capture was taken.**

## The change attempted

In `dressFaces` (`src/render/fallvillage.ts`), raise the lit row's bay-width cap
from 2.4 m to about 4 m, scoped to boxes with `u.long > 8` m (so a wide bay is
a window, not a wall, on the smaller boxes). The aim: at 264 m, a single clear
pane projects to at least 2 px, moving id108 from `1+1` to `2+2` in the probe.

## Probe — before (HEAD, `47b5c6d`)

```
columns 151
lod 0 village: 1088 lit quads, 2598 m2 lit area, 17.20 m2 per column
lod 2 merged:  2872 lit quads, 7842 m2 lit area, 51.93 m2 per column
bay-free triangles at lod 0: 93272
pose 18: 62 of 151 columns in frame
  id  kind     dist  screen      lod  panes  runs (largest first)   row width
  109 pier      193m ( 206,422)   0     44  12+8+8+6+4+4+2        55 px   44/11  4+2+2+2+1  ACCEPT(2+2+2)  clear box x 184-225 y 396-398
   76 pier      198m ( 754,668)   0     12  4+4+2+2               30 px   12/4  2+2  ACCEPT(2+2)  clear box x 762-772 y 637-640
  124 lattice   225m ( 165,457)   0      8  4+4                   27 px   8/3  2+1  ACCEPT(2)  clear box x 164-177 y 446-448
   89 pier      228m ( 655,426)   0     24  10+4+4+2+2+2          37 px   24/4  2+2  ACCEPT(2+2)  clear box x 645-652 y 386-388
  123 lattice   262m ( 328,520)   0      8  4+4                   23 px   8/4  2+2  ACCEPT(2+2)  clear box x 322-334 y 499-501
  108 stack     264m ( 554,472)   0      8  2+2+1+1+1+1           30 px   8/2  1+1  no 2-3  clear box x 543-544 y 475-476
   75 pier      272m ( 950,448)   0      0  -                     0 px   0/0  -  no 2-3
  107 pier      297m ( 666,631)   0      8  4+4                   19 px   8/4  2+2  ACCEPT(2+2)  clear box x 665-673 y 624-626
```

## Probe — after (cap raised to 4 m for `u.long > 8`)

```
columns 151
lod 0 village: 1048 lit quads, 2809 m2 lit area, 18.60 m2 per column
lod 2 merged:  2872 lit quads, 7842 m2 lit area, 51.93 m2 per column
bay-free triangles at lod 0: 93272
pose 18: 62 of 151 columns in frame
  id  kind     dist  screen      lod  panes  runs (largest first)   row width
  109 pier      193m ( 206,422)   0     44  12+8+8+6+4+4+2        55 px   44/11  4+2+2+2+1  ACCEPT(2+2+2)  clear box x 184-225 y 396-398
   76 pier      198m ( 754,668)   0     12  4+2+2+2+2             41 px   12/4  2+1+1  ACCEPT(2)  clear box x 757-773 y 636-641
  124 lattice   225m ( 165,457)   0      8  4+2+2                 42 px   8/4  2+1+1  ACCEPT(2)  clear box x 154-179 y 446-448
   89 pier      228m ( 655,426)   0     24  10+4+4+2+2+2          37 px   24/4  2+2  ACCEPT(2+2)  clear box x 645-652 y 386-388
  123 lattice   262m ( 328,520)   0      8  4+4                   23 px   8/4  2+2  ACCEPT(2+2)  clear box x 322-334 y 499-501
  108 stack     264m ( 554,472)   0      8  2+2+1+1+1+1           30 px   8/2  1+1  no 2-3  clear box x 543-544 y 475-476
   75 pier      272m ( 950,448)   0      0  -                     0 px   0/0  -  no 2-3
  107 pier      297m ( 666,631)   0      8  4+4                   19 px   8/4  2+2  ACCEPT(2+2)  clear box x 665-673 y 624-626
```

## Gate result: NOT PASSED

id108 is still `1+1` (no 2-3). The cap change did not move it. Raising the cap
widened bays on boxes with `u.long > 8` (lit quads fell 1088 → 1048, m² rose
2598 → 2809), which coarsened the row on several crowns (id76's clear runs went
from 2+2 to 2+1+1; id124 from 2+1 to 2+1+1) and **reduced** the total lit-bay
count, without helping the one crown the gate was for. The wider bays merged
adjacent panes rather than splitting id108's 1-px marks into two visible blocks.

## Near-pose (pose 19) check

The box carrying pose 19's band has `u.long = 5.40`, `bayW = 2.16 m`
(`0.4 * 5.40`, below the 2.4 m cap, so the scoped change did not touch it). At
3 m, with held fov ~1.07 (focal ~805 px), that bay projects to ~580 px —
unchanged from the 3i baseline. The near-pose risk did not materialise because
the wider cap only binds for `u.long > 8`, and the near box is not one of them.

## Decision

No capture taken (PITFALLS §38: a change the projection says cannot work is a
wasted round). The code change has been reverted; the tree is back to the 3i
state. The lever PART 15 named (bay width) does not move id108: id108's clear
panes are ~1 px wide because the box is seen edge-on, and widening the bay
widens the pane that is already there rather than creating a second one. A
different lever is needed (box orientation / promotion, or a different distance
at which the pane projects to ≥ 2 px).

## What I did not verify

- No frame was captured, so no frame count, no warm share, no visual read.
- I did not try other cap values or scoping rules beyond the one specified.
- `workshopYard` remains unverified (no judged frame), as in every round.
- The city-wide check (`wide-skyline`, `aerial-top`) was not re-run; the change
  was reverted, so nothing to check.

Self-tests on the (reverted) tree: `tsc --noEmit` clean, `vite build` clean,
`__selftest.ts` → `VIOLATIONS none`, `__selftest_fallzone.ts` → `VIOLATIONS none`.
Preflight OK (mem-unused 822 MB at the time of the attempt).