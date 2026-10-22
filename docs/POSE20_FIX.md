# Pose 20 — the camera moves to the lamp's side of the pile

Derived eye (558.1, 1.97, −452.4) → target (471.1, 19.7, −501.8), fov 1.1, pitch 10° up, bluehour; `src/world/__probe_fallzone.ts`, copied to `tools/capture.mjs`, still section B.
Rule change: winch foot id54 is 15.0 m away on its **lamp side** — camera local b **24.8** vs foot b **11.2** (3d was −11.1 vs +10.3), so the pile is behind the head, not in front of it.
Run `shots/2026-10-22T03-11-38` (sequence, 5 fall poses, **PASS 60.0 s**, `error: null`); frame `20-fall-ground-level.png`, camera held 1.965 vs 2.1 requested, fov 1.0754, lights 1133 starved 0.
frameCount: **341** at boot on this run (the per-shot stats carry no frameCount); the single-shot run of the same pose at `shots/2026-10-22T02-33-05` measured **1025**, also no GPU/WGSL error.
**In frame:** the shaft — id54's 120.7 m pile top at 78°, out of the 41.5° top edge — the old city (572 buildings) on the pile's open side, and the wet floor.
**In frame:** a pool's near edge 6.6 m out, water from 70 % to 92 % of the frame: mean (5, 12, 62) against silt (3, 6, 43) below it, a 45 % value break in blue.
**Not in frame: the lamp.** Warm-bright (R > 120, R > 1.6 B) below y 600 = **0.00 %**; the warmest pixel there is a lit window row at (1072, 606), not the head.
Cause, measured in code: the head is **inside its hut** — winch box top 3.05 m vs head top 3.02 m (3 cm), workshop 3.80 vs 3.62 — at the hut's centre, with its 2.76 m ground disc under the hut's own 2.1 × 1.7 m footprint.
So no pose can carry it: the nearest unburied lamps are stair-tower id82 (48.6 m outside the flooded patch's edge) and ropeway station 8 (204.5 m from its centre).
**Not in frame:** a waterline with a glint — the pool reads as a lighter rippled band only (PART 8 risk 2: no SSR, no probe).
Next, not done here: move the head to the door face (`b0 + 1.75`) or onto a bracket above the roof; done-when warm below y 600 > 0 in this pose.
Reproduce: `vite-node __probe_fallzone.ts`; `capture.mjs --dev --pose=20-fall-ground-level`; `python3 tools/pixel_share.py <frame> --rect=0,600,1600,300`.
