# Round 9 follow-up: the three asks were already answered in 82427d8

This brief re-asks the previous round's three questions against `21f4efa`.
They were answered and committed as `82427d6` (`docs/R11_DETAIL_SURVIVAL.md`),
which is on main. No re-measurement was needed: zero commits have touched
`src/world/` since, so every probe input is identical and the numbers stand.
Verified this round: pinned tsc exit 0; world suite green (import test).

Where each ask lives, with the verdict:

1. **Detail survival** (`R11_DETAIL_SURVIVAL.md` §1): in-frame facade props
   all measure 5.8–21.8 px with zero LOD culling (camera chunk always LOD0,
   whole-chunk draws) → drawn-but-unreadable fragment/shading, plus
   LOD-by-design past ~410 m, plus a camera aimed down the void. Bake
   exonerated; routed to `gbuffer.wgsl` groundSurface / lighting.
2. **Kerb refusal** (§2): verified firing via temp-edit test (reverted);
   documented reason string observed, not assumed.
3. **Pose coverage** (§3): no dedicated A-street/B-avenue pose; 01d is
   district-agnostic; 01g covers B kerbs; `kerb-face` sections.json key still
   open. Left unbuilt deliberately without capture budget.

New since that commit, and it corroborates rather than supersedes: dev1's
`f24ff19` ("the kerb had 4.3x authored contrast and nothing consuming it")
found exactly the unconsumed-contrast defect the localisation routed —
fragment side, as predicted. No action from this lane (boundary held);
bake-side numbers unaffected (no world/groundbake changes).

D26 (crowd local-first, scenes later) is consistent with the footway/prop
evidence already committed: if people arrive late, the street must read
inhabited from authored detail, which is measured present-but-unreadable
above — same defect, same owner.

## Files committed (this round)

- `docs/R11_DETAIL_FOLLOWUP.md` (this file). No source changes: nothing
  moved, nothing was indicated, nothing was touched.
