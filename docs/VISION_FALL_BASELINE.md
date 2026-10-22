# Vision — the fall zone against sheet B (rounds 0 and 1)

**Reviewer:** vision reviewer, read-only except `src/world/__probe_fallzone.ts`.
**Date:** 2026-10-20. **Section:** B, `cold-industrial`.
**Subject:** the fall zone's first ever photographs. Round 0 is placement and a
greybox; `src/render/fallvillage.ts` is being written in parallel and is not
ready. This document establishes the baseline and names what the *rendered*
village must deliver in each pose. It is not a complaint that a greybox is a
greybox.

**Three runs, three documents-worth of evidence.** Part 1 is the **BEFORE**:
the greybox baseline, run 15:55, before the village existed. Part 2 is the
round-0 village (`fae3058`), run 16:41, with the re-derived cameras. Part 3 is
the round-1 village (`b0d7bf3`, on the boot fix `7f06ac4`), run 20:14, **on
`main`** — so unlike round 0's frames these are evidence of a committed build.

---

## Close-out (DESIGN §6) — after the village run

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg
          references/sections/B-cold-industrial/{01-monolith,02-fog-tram,03-snow-ropeway,04-tram-bridge}.jpg
          shots/2026-10-20T22-55-25/{16,17,18,19}-*.png            (BEFORE, greybox)
          shots/2026-10-20T23-39-50/{16,17,18,19}-*.png            (AFTER, round-0 village)
          shots/2026-10-20T23-39-50/_capture.json
          shots/compare/2026-10-20T23-15-16.png (+ .txt)            (BEFORE grid)
          shots/compare/2026-10-20T23-41-55.png (+ .txt)            (AFTER grid)
JUDGED:   silhouette, mid-band height, material read, palette, value structure,
          atmospheric depth and human scale, per pose, in sheet-B vocabulary
GAP:      the village has no warm emissive points and no cold steel-blue material
          read, so at dusk the whole zone is 78-94% salmon-orange and the mid
          band cannot be told from the industrial belt it stands in
NEXT:     put the section's colour doctrine into the village: cold steel-blue
          and slate on the large surfaces, and one lit window row per pile top
          (D28's quarter of windows lit), so the band is a stratum of warm
          points at 300-1400 m instead of a field of rust chimneys
CONFIRMED: "no done-when can be met by a greybox" — and now, of the village:
          the mid band exists as a distinct stratum in frame (village in frame
          1.3% -> 4.1%, largest pile 29 px -> 87 px, background behind the band
          819 m -> 139 m); the pile crowns are stepped masses with masts, tanks
          and red panels, not the flat greybox slab; the close pose holds a
          subject with a corner edge, ribs and a water tank where the baseline
          held one untextured plane; no column top reads as a floating mass or
          a hard cut
```

**One blocking defect found in `fae3058` itself**, before any frame could be
taken: the app does not boot. `src/render/fallvillage.ts` reads `ROOMS` at
module scope (line 50) while `citymesh.ts` is still initialising, and the
import cycle `citymesh -> fallmesh -> fallvillage -> citymesh` makes that a
temporal-dead-zone read. The page dies with
`ReferenceError: Cannot access 'ROOMS' before initialization`, `window.__syzygy`
never appears, and the harness reports *"vite dev did not answer"* /
*"`window.__syzygy` is missing"*. **The one-line fix** is to build the palette
on demand instead of at module scope:

```ts
const containerPalette = (): Vec3[] => [
  ROOMS[1], ROOMS[0], ROOMS[4], ROOMS[9],
  ROOMS[2], ROOMS[7], ROOMS[8], ROOMS[6], ROOMS[8],
];   // used as containerPalette()[r.int(0, 8)]
```

Verified in a scratch worktree at `fae3058` (app boots, `ready: true`, 1167
frames, 60 fps). **The main tree still has the bug** — `src/render` is the
implementer's file and this review did not touch it. The AFTER frames were
taken in that scratch worktree with only this one-line, geometry-neutral fix
applied; nothing else differs from `fae3058`.

**Provenance of the AFTER frames.** They are evidence of the village, not of a
committed build: the worktree was scratch, it has since been removed, and the
only difference from `fae3058` is that one line, so the frames cannot be
re-derived from the repository as it stands. **The next capture on `main`,
after the boot fix lands, is the control that closes this** — same poses, same
seed, and the village's own pixels compared against these four.

---

---

# PART 1 — BEFORE: the greybox baseline (run 15:55, `shots/2026-10-20T22-55-25`)

## The capture (one run, nothing else on the GPU)

```
node tools/capture.mjs --dev --sequence --pose=fall --timeout 900
→ shots/2026-10-20T22-55-25/   PASS, 5 shots (4 poses + contact sheet), 52.2 s
```

No GPU error and no WGSL error was reported. That matters for pose 19, whose
frame is near-black: **a black screenshot is not a dark scene**, so the run was
checked for errors before the frame was read as a failure.

**Provenance.** These four frames are of the **pure greybox**: the parallel
agent's `fallvillage.ts` and its `fallmesh.ts` edit landed at 16:13-16:16, after
this run at 15:55. Nothing in the village rendering pass is in these frames, and
nothing below judges it.

**Artifact check (PROCESS rule 3).** All four PNGs exist, 1600 × 900, plus
`_capture.json` and `_contact-sheet.png`. From `_capture.json`:

| pose | dayPhase | lodHistogram | lights delivered / starved | notes |
|---|---|---|---|---|
| 16 | 0.243 | [9, 28, 98, 0] | 1090 / 0 | dusk |
| 17 | 0.57 | [9, 28, 98, 0] | 995 / 0 | mid-morning, sun ≈ 29° |
| 18 | 0.243 | [9, 20, 106, 0] | 1249 / 0 | dusk |
| 19 | 0.958 | [9, 28, 98, 0] | 1090 / 0 | high noon, sun ≈ 62° |

`dayPhase` is `(sun.elevation + 0.35) / 1.5`, so the four phases are the four
the poses asked for. No light was starved in any pose, so nothing here is a
lighting-budget symptom.

**The camera applied.** Requested-versus-held, per pose: view direction off by
≤ 0.008°, position off by ≤ 0.06 m. (`stats().camera.lookAt` is a 400 m ray
point, not the target; comparing it to the target directly is a false alarm.) The
held fov carries the camera's own speed bias: −7.4 % on 16 and −7.8 % on 18,
+1.9 % on 17 and +2.1 % on 19. So 16 and 18 are framed **narrower than the pose
asked** — a fact worth remembering before blaming the pose for a tight frame.

**The zone as placed** (seed 6191639 = 0x5e7a17, from `fallzone.ts`): 151
columns — 93 pier, 25 core, 17 lattice, 8 silo, 5 stack, 3 spire — 1 deck
fragment, 61 bridges, 69 wreck pieces, 4138 old buildings. Pile tops: min 53 m,
median 130.7 m, max 176.4 m; **127 of 151 columns have their whole pile inside
the DESIGN §8 band of 75-185 m.** The mid band exists in the placement. The
frames below are about whether it can be seen.

**Method note.** Every "in frame" number below is a screen-space projection of
the zone's own piles through the captured camera, not an eyeball estimate. The
frames were also sampled numerically (`tools/pixel_share.py` plus a raw RGB
patch grid) because two of the four frames are not what they look like at a
glance.

---

## Pose 16 — `16-fall-wreck-up`, the wreck field looking up at a knot of piles

**What the frame shows now.** 7 fall-zone columns have pixels in frame. The
three nearest shafts (48 m, 69 m, 87 m) run out of the bottom of the frame, and
their villages read as **thin dark caps** on warm-lit shafts. The camera is
2 m above the ground looking 65° up, so the frame is mostly sky.

- Palette: warm-dominant, the opposite of sheet B. Every sampled patch is
  R > G > B — sky (142, 98, 81) and (149, 102, 84), shaft (141, 48, 22) and
  (125, 33, 17). Luma mean 65, max 216.
- Value structure: inverted. The *shafts* are the brightest thing in frame
  (they take the dusk sun); the subject — the village — is the darkest thing.
- Atmospheric depth: none. The sky is a smooth brown gradient and the old city
  at the left is crisp, with individually legible windows. Sheet B's depth comes
  from fog flattening the distance into flat blue shapes.

**What sheet B asks for in this frame** (`02-fog-tram.jpg`, the pile-on-columns
shot, and the brief's own bar): a bare, windowless concrete column rising
steeply out of the bottom of frame; on top of it a stack of 6-8 boxy rooms,
**top-heavy and overhanging** the column, with a stepped, cluttered skyline of
aerials, satellite dishes, ladders, stairs and a white tarp; a railed catwalk at
the pile's foot; gridded warm windows; a few rust-red panels; and behind it all,
deep teal fog with distant flat blue towers. Value structure: near-black masses
against a mid teal, warmth only in the windows. The eye is drawn to the pile,
not to the shaft.

**The question the village must answer here.** *At 48 m, does the nearest pile
read as a stack of rooms hanging off its column, or as a box on a stick?*

**The single most valuable change.** **Silhouette before material: build the
pile as 3-10 rotated container layers that overhang the column 1.3-2× and step
down irregularly.** At this distance the village is ~100 px tall and the rest of
the frame is shaft; until the outline is right, no amount of panel detail will
read.

**Camera fault (corrected in the probe).** The old rule scored the knot by
**count** of piles in the cone, so the frame took the three furthest of the
seven and left the rest sky. It now scores by **angular mass** — how much of
the frame the village subtends — and aims at the village instead of past it.
6 piles, 121.9° of angular mass, nearest 20.2 m.

---

## Pose 17 — `17-fall-piles-level`, level with a deck fragment

**What the frame shows now.** The fall zone is 11 % of the frame: the deck
fragment as a **pale grey plank** (18.4 m wide, seen edge-on from 45 m away,
with a hole in it) and the two piles as **flat black boxes** either side
(pile id115 at x 1108-1322, y 357-624; id114 at x 248-509, y 451-628). The
remaining 89 % of the frame is the old city at clear morning — bright teal glass
towers under a near-white sky. Sampled: (87, 153, 163), (172, 191, 207),
(193, 202, 204), (163, 181, 196). Luma mean 122, max 225. That is sheet A/D's
register, not sheet B's.

**What sheet B asks for in this frame** (`01-monolith.jpg`, the frame the DESIGN
names for this pose): a **dark megastructure mass in the near field** with
platforms, catwalks and a long skybridge crossing the frame, aerials and
ropeways, against heavy teal fog in which the distant city is a **flat blue
silhouette** with speckled warm windows. The camera stands *at* the level of
the structure. Value structure: near-black foreground, mid teal middle, pale
blue distance.

**The question the village must answer here.** *Standing on the deck, does the
eye meet a lived-in structure — a rail, a lit window, a stair head, a line of
lamps — or a bare plank?*

**The single most valuable change.** **Build the deck fragment as a street.**
DESIGN already says what it is: *"Where two full-height piers still hold a deck
fragment between them, the fragment is a street in the sky."* That means railings
on both edges, rooms and boxes on it, a stair head, laundry, one warm lamp —
not a slab. A deck with no rail and no lit window is a plank at any exposure.

**Camera fault (corrected in the probe).** The old pose stood 45 m to the *side*
of the deck, which sees it **edge on** — a plank, not a street. It now stands on
the deck, clear of pier a's pile, and looks along it to pier b's village.
*(A first re-derivation put it off the far end of the deck instead; the AFTER
run caught that and it is corrected again in Part 2.)*

**Watch item for the renderer, not the camera.** At clear morning this frame
cannot be judged against sheet B's palette at all: a cold-blue city at noon is
not what the sheet shows. The zone's own identity has to come from its materials
and emissives, not from the time of day (see *the palette the village must
carry* below).

---

## Pose 18 — `18-fall-skyline`, the fall zone as a mid band on the skyline

**What the frame shows now.** The frame is **the old town at dusk**: warm brick
mid-rises with lit windows filling the lower two-thirds, downtown's towers
behind, a rust sky. Sampled: (141, 97, 80), (99, 61, 49), (40, 17, 14),
(133, 27, 0), (78, 8, 3). Luma mean 59.

The fall zone is in the frame but it is **1.3 % of it**: 64 piles project into
view, but the largest is 29 px tall and most are 15-47 px, scattered in a ~110 px
band around y = 400-500, with the old town in front of them and the heart's
**819.1 m** towers behind. Those towers are the dark needle silhouettes in the
upper left of the frame; they stand 22.7° off the view axis. The band's tops
span 5.7° of a 64° frame.

So the recorded fault — "does not yet show a distinct mid band" — is not a
matter of degree. **The band is a 1.3 %-of-frame smudge behind a forest of
819 m towers.**

**What sheet B asks for in this frame.** Sheet B's own vocabulary for a distance
band is frame 3 (`03-snow-ropeway.jpg`): a mass of **warm window light** in the
middle distance, held between darker masses, in cold blue; and frame 1, where
the far city is a flat blue silhouette with speckled warm points. A "mid band"
in sheet-B terms is a **stratum of warm points with a legible top edge**, sitting
between the darker hangars below and the taller downtown above.

**The question the village must answer here.** *Does the fall zone read as a
layer of its own — a distinct row of lit tops between the hangars and downtown
— or as a few grey specks?*

**The single most valuable change.** **Every pile top must carry a legible lit
row** (a line of warm windows, one lamp, an aerial breaking the edge). A pile
that is 29 px tall at 300 m and 1.3 % of the frame can only be read as a warm
point; nothing else survives the distance.

**Camera fault (corrected in the probe) — the largest fault of the four.** The
old rule aimed at the closest pair of spire stumps from 900 m across the belt,
which put the 819 m heart directly behind the band. The new rule takes the
**stretch of the band with the lowest old city behind it** (anchor id122, 483.8 m
clear of any taller building), stands 300 m off it on the downtown side and
looks **out** over the low city. Measured on the derived camera: 55 band columns
in frame, band tops spanning 11.1°, and the tallest old building behind the
band **139 m instead of 819 m**. The village's share of the frame goes from
1.3 % to 4.1 %, and the largest pile from 29 px to 87 px.

**Note for the placement owner.** The band is 3 km across, and the old city
stands in and among it — 1170 of 4138 buildings are over 190 m and the heart's
819 m towers are 942 m from the band centroid. A clean skyline edge for the
band is therefore a *placement* question as much as a camera question, and the
probe's answer is the best available at this seed, not a proof.

---

## Pose 19 — `19-fall-pile-close`, 3 m from a village pile

**What the frame shows now.** One flat plane. Pile id114's box covers **62.8 % of
the frame** (x 230-1375, y 110-900); the camera stood 4.1 m off its face, dead
on, and the face's vertical span of −37° to +56.5° is wider than the 64.3°
frame, so the face covers everything.

Measured, it is not a wall — it is a **void**: uniform blue-navy, luma mean
35.9, min 22, max 55, a smooth gradient from (38, 55, 77) top-left to
(17, 27, 42) bottom-right, and no structure anywhere in the frame.
`tools/pixel_share.py` reports 0.0 % near-black and 0.0 % warm-bright: the
tool's thresholds do not even register it. The cause is not a bug: the greybox
face is one untextured plane with albedo 0.13/0.15/0.18, and at high noon a
near-vertical face is in shadow, lit only by blue sky ambient.

**What sheet B asks for in this frame.** At 3 m, sheet B's surfaces are the
subject, not the skyline: corrugated container walls, panel seams, rust
streaks, a framed window with a lit pane, a railed balcony, a zig-zag ladder,
laundry, a plant box, a solar panel on a roof. The doctrine is explicit —
*"a facade needs to survive a 3 m inspection, not just a 400 m one"* — and this
is the close-focus pose the project has been missing.

**The question the village must answer here.** *Does the village hold up at 3 m
— is there a face on it with panels, a seam, a lit window and a rail?*

**The single most valuable change.** **Build the pile's faces.** `weatherRoom`
already knows how to dress a room (seams, a grime skirt, soot runs, framed
windows with a lit side pane, a railed balcony, a canvas tarp over the roof);
that dressing has to be applied to the pile boxes, and at least one lit window
has to fall in this frame's field. Without a face there is nothing to inspect.

**Camera fault (corrected in the probe).** The old pose was dead-on to a flat
face. It now stands **3 m off the pile's corner**, so the frame holds a vertical
edge, two faces at different values, and the sky above the pile's top instead of
one plane.

---

## The palette the village must carry (applies to 16, 17 and 18)

Sheet B is *near-monochrome steel blue and grey-green across every large
surface, with warmth restricted almost entirely to emissive windows, lamps and
vehicle interiors* — and *"value range carries the image, not hue"*. Two of the
four captured frames are warm-dominant (16, 18) and two are bright cyan
daylight (17), and in all four the fall zone's own surfaces take their colour
from the light rig rather than from the section.

**So the zone's identity has to live in its materials, not in the hour.** The
piles and the shafts want the `ROOMS` palette's own weighting — desaturated
steel blue, slate, soot, rust and red panels — and the *warmth* has to be
emissive: lit windows, a work lamp on a stair head, the string lights on a
mast. The captured frames show the opposite: a warm rust shaft lit by the dusk
sun and a black pile with no window in it, so the warmth is on the wrong
material and the section's accent is missing from the subject.

---

## Camera corrections (implemented in `src/world/__probe_fallzone.ts` only)

These are **derived and measured**, and 16, 18 and 19 were then **photographed**
in the AFTER run. The probe prints each pose with the numbers behind it; the
positions below are its output for seed 0x5e7a17.

| pose | captured (old rule) | re-derived (new rule) | measured effect |
|---|---|---|---|
| 16 | `[540, 2.1, -504]` → `[600, 130.1, -504]`, fov 1.05 | `[570, 2.1, -516]` → `[615.4, 122.4, -495.6]`, fov 1.05 | scores by angular mass, not count: 6 piles, 121.9° of mass, nearest 20.2 m (was 7 piles, nearest 48 m). Photographed: the crowns now read as stepped masses with masts |
| 17 | `[798.2, 156.4, -445.1]` → `[768.5, 158.4, -478.9]`, fov 1.05 | first pass `[735.5, 152, -449.9]` → `[786.5, 159.4, -494.7]`; **corrected** `[765.5, 152, -476.2]` → `[786.5, 159.4, -494.7]`, fov 1.05 | stands on the deck clear of pier a's pile and looks along it; was 45 m off the side, seeing the deck edge-on. The first pass stood *off the end* of the deck (`ux` runs b→a) and put a's whole pile in frame as an unsupported mass — corrected after the AFTER run, **not yet photographed** |
| 18 | `[1322.1, 160, 41]` → `[727.4, 110.4, -634.5]`, fov 1.12 | `[-633.8, 123, 438.5]` → `[-669.5, 135.9, 736.3]`, fov 1.12 | background behind the band **819 m → 139 m**; village 1.3 % → 4.1 % of frame; largest pile 29 px → 87 px; band tops 5.7° → 11.1°. Photographed: the band reads as a ragged stratum of crowns |
| 19 | `[759.5, 152, -470.9]` → `[750.5, 155.4, -463]`, fov 1.1 | `[765.3, 152, -463.2]` → `[761.9, 153, -463.2]`, fov 1.0 | 3 m off the pile's corner: the frame gains a vertical edge, two faces and sky, instead of one flat plane covering 63 % of it. Photographed: ribs, a rust panel, a water tank and a mast |

**What was deliberately not changed.** The poses' times and skies (16/18 dusk,
17 morning, 19 noon) are authored, not derived, and re-timing a section is an
owner's call, not a reviewer's. The times are also what make the palette
question above visible rather than hidden.

---

# PART 2 — AFTER: the round-0 village (run 16:41, `shots/2026-10-20T23-39-50`)

**The run.** `node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev
--sequence --pose=fall --timeout 900` → PASS, 5 shots, 51.0 s, no GPU error and
no WGSL error. Seed 6191639, dayPhase 0.244 / 0.56 / 0.244 / 0.959 (dusk,
morning, dusk, noon — the same four phases as the baseline), lodHistogram
`[9,111,14,0]` on 16 and `[9,28,100,0]`, `[9,34,124,0]`, `[9,34,124,0]` on the
other three, lights delivered 1090-1371 and **starved 0** in all four. The
cameras are the re-derived ones, to the last decimal (16 at `[570, 2.3, -516]`,
17 at `[735.5, 152, -449.9]`, 18 at `[-633.8, 123, 438.5]`, 19 at
`[765.3, 152, -463.2]`).

**What changed in the picture, in one line:** the village is now a real stepped
mass of boxes, awnings, masts and water tanks instead of a flat grey slab, and
the mid band finally reads as a stratum — but the zone is still lit and
coloured like an oil refinery at sunset, and the sheet's cold blue with its
warmth held in emissive points is nowhere in it.

---

## Pose 16 — the wreck field looking up at a knot of piles

**BEFORE:** three bare, warm-lit shafts with thin dark caps; 84 % of the pixels
warm; the village ~2 % of the frame.

**AFTER:** the same three shafts, but each now carries a **crown that reads as
a village** — a stepped cluster of red and slate boxes with two thin masts
breaking the skyline (crop-verified at 2×). The flat greybox slab is gone and
the silhouette is now the stepped one the DESIGN asks for. But the frame is
**94 % warm pixels** (mean RGB 107, 54, 41 — the baseline was 99, 52, 42), so
the village got *warmer* than the greybox, not colder: the shafts and the
crowns are all the same rust-orange as the sky, and the crowns are the only
cold thing in frame.

**Sheet B asks (frame 2):** a bare windowless concrete column with a *stack of
6-8 boxy rooms on top*, top-heavy and overhanging, a stepped cluttered crown,
warm gridded windows, rust-red panels — against **deep teal fog**. The
silhouette language is now half there; the colour doctrine is not.

**Question the village must still answer here:** *can the pile read as a
cluster of lit rooms at dusk, rather than a red cap on an orange shaft?*

**Most valuable change:** the same one as everywhere — cold material and warm
emissive. The crowns must be cold slate/steel-blue with **lit windows**, so
that the one warm thing in the frame is the village and the shaft is cold.

## Pose 17 — level with a deck fragment

**BEFORE:** a pale grey plank seen edge-on with two black boxes either side, in
a bright cyan daylight city; the fall zone was 11 % of the frame.

**AFTER:** the village *is* in the frame now, and it reads: pier b's pile is a
stepped stack of slate and **rust-red** boxes with a **black water tank on legs
and a mast** on top — exactly the "uneven, stepped top with antennas, a water
tank and a white tarp" the DESIGN specifies, and the silhouette is legible
against the sky. The two pier tops and the deck slab read as the "street in the
sky" the DESIGN asks for.

**But this pose is not a fair test, because of a camera fault of mine.** The
re-derived camera stands 19.9 m from pier a — and `ux` runs *from b to a*, so
`a + ux*stand` put the camera **off the far end of the deck**, hovering in
mid-air, with the whole of a's pile (id114, 1088 px wide, 626 px tall) filling
the left half of the frame as a large black mass with no visible support. That
mass is not a cantilever and not a defect in the village: it is pier a's own
pile, seen from beyond the deck's end, with its 9.6 m shaft hidden behind the
pile's own overhanging boxes. **The probe is fixed** (`a - ux*stand`, i.e.
toward b, so the camera stands on the deck between the piers) and
`tools/capture.mjs` now carries the corrected `[765.5, 152, -476.2]`. It is
**unphotographed** — the one capture this round was already spent.

**Sheet B asks (frame 1):** a dark near megastructure with platforms, catwalks
and a skybridge, against heavy teal fog with a flat blue distance.

**Question:** *once the camera is on the deck, does the street in the sky have
railings, rooms, a stair head and one warm lamp — or is it a slab between two
piles?* It is still a slab: the deck carries no rail, no rooms, no lamp.

**Most valuable change:** **build the deck fragment as a street** — railings on
both edges, rooms and boxes on it, a stair head, laundry, one warm lamp.

## Pose 18 — the fall zone as a mid band on the skyline

**BEFORE:** the fall zone was **1.3 % of the frame**, its largest pile 29 px
tall, with the 819 m heart towers standing behind it.

**AFTER:** the mid band now exists. Across the frame there is a **ragged stratum
of village crowns** at roughly y 350-520 — a row of pier tops, each carrying a
cluttered crown of red boxes, masts and tanks (crop-verified at 2×). The
background behind the band is now the low city and the haze, not the 819 m
heart. The camera correction did what it was measured to do.

**And the band still does not read as sheet B.** The frame is **78 % warm
pixels, 0 % cool** (mean RGB 93, 52, 42): sky, piers, crowns, haze and the
city below are all one salmon-orange. Sheet B's rule is the opposite — *"value
range carries the image, not hue"*, warmth *"almost entirely to emissive
windows"* — and **the village has no emissive windows at all**, so at dusk
there is not a single warm *point* anywhere in the zone to sit against the
cold. What the frame shows is a field of rust chimneys with orange hats.

The one thing that *is* sheet B in this frame is the **atmospheric depth**:
the far city is flat, cool and low-contrast, and the haze separates the
layers. The value structure is right; the hue is wrong.

**Sheet B asks (frame 3):** a middle distance that is a **mass of warm window
light** held in cold blue, between darker masses.

**Question:** *does the band read as a stratum of lit villages, or as a row of
orange columns?*

**Most valuable change:** **one lit window row per pile top.** At 300-1400 m a
pile is 30-90 px; the only thing that can make it a *point of light* rather
than a dark speck is an emissive window row, and 127 columns of them are what
would turn this frame into sheet B.

## Pose 19 — 3 m from a village pile

**BEFORE:** one flat plane, 63 % of the frame, luma 22-55, no structure — a
void, not a wall.

**AFTER:** the frame holds a **subject**. The camera is 3 m off the pile's
corner, and the frame now carries: the vertical corner edge with two faces at
different values, a **rust-red container with its corrugation ribs reading as
dark vertical lines** (the kit-1 ribs work), a slate box above it, a **black
water tank on legs** and a mast on top, the deck below and the city behind.
Mean RGB is now 118, 133, 149 (93 % cool) against the baseline's 26, 38, 55:
the frame is no longer a void, it is a lit daylight close-up of a pile.

**And the material read is still thin.** At 3 m the surfaces are flat, untextured
and unlit: no seams beyond the ribs, no grime, no soot run, no framed window,
no lit pane, no door leaves visible, no balcony rail, no ladder, no laundry, no
planter. The DESIGN's "faces" paragraph is rounds 1-2, and it is the whole
remaining content of this pose. The doctrine is explicit — *"a facade needs to
survive a 3 m inspection"* — and this one would not.

**Sheet B asks:** corrugated container walls, panel seams, rust streaks, a
framed lit window, a railed balcony, a zig-zag ladder, laundry, a plant box.

**Question:** *is there a face on the pile with a lit window and a rail on it?*

**Most valuable change:** **`weatherRoom` on the pile boxes, and at least one
lit window in this frame's field.** Form is now there; faces are not.

---

## The two risks the implementer flagged — checked in the frames

**(a) Removing the greybox pile slab: does any column top read as floating or
as a hard cut?** **No, and the removal is a clear win.** The crowns now read as
stepped stacks with masts, tanks and red panels in every frame (16's caps, 17's
centre mass, 18's stratum, 19's pile) — a flat slab capping every pile at
`pileTop` would have flattened exactly the silhouette the DESIGN asks for.
Measured against the placement, three kinds deliberately leave shaft above
their village — a stack 4 m, a lattice cage 3 m, a spire crown 4 m — and in the
frames those read as the intended crown rim, cage top and collar, not as a cut.
**One exception, and it is not a cut:** at 305 m in pose 19, pier id93's pile
(id93, x 296-374, y 596-751) reads as **floating boxes** because its 10.5 m
shaft is 16 px wide and is lost against the bright city behind. That is a
contrast problem at distance, not a geometry fault, and it will be fixed by
anything that gives the shafts value separation from the background.

**(b) Cantilevered boxes up to 3.6 m past the registered pile extent, where
the deck fragments and bridges anchor — a collision read in pose 17?** **No
collision found.** The code puts a cantilever's far edge at `extent + out`,
up to 3.6 m past the registered extent, which is a real overhang; the
implementer's own probe reports the village bounds *"WITHIN"* its tolerance
(`y+7.0 / y-4.6 / xz cantilever`). In pose 17 no cantilevered box intersects
the deck slab or a bridge: the deck's near edge is at pier a and the cantilever
boxes hang at 2-4 m above the pile base, below the deck's underside. **The
floating mass in pose 17 is not a cantilever** — it is pier a's entire pile
(id114), and the cause is the camera sign error above. One real consequence of
the cantilever does show in pose 19: at frame x 310-345, y 585-650 a vertical
column of small boxes hangs with **visible gaps and nothing under it** — a
cantilever stack reading as debris in the air, because there is no outrigger
or bracket under a cantilevered box and none is drawn.

---

## The palette the village must carry (16, 17, 18 — and the gap)

Sheet B is *near-monochrome steel blue and grey-green across every large
surface, with warmth restricted almost entirely to emissive windows, lamps and
vehicle interiors* — and *"value range carries the image, not hue"*.

Measured on the AFTER frames, as a share of pixels that are warm (R>G>B):

| pose | BEFORE | AFTER | sheet B wants |
|---|---|---|---|
| 16 (dusk) | 84 % warm | **94 % warm** | cold surfaces, warm points |
| 18 (dusk) | 81 % warm, 0 % cool | **78 % warm, 0 % cool** | cold surfaces, warm points |
| 17 (morning) | 8 % warm, 90 % cool | 0 % warm, 95 % cool | cold surfaces, warm points |
| 19 (noon) | 0 % warm, 100 % cool | 4 % warm, 93 % cool | cold surfaces, warm points |

17 and 19 are cold, but that is the *city* being cold, at clear morning and
noon; the village in them is black. 16 and 18 are the two dusk frames, and in
both the zone's own large surfaces — the shafts and the crowns — take the
dusk sun's rust. **This is the gap.** Round 0 delivered form and the form is
good; what it cannot deliver yet is the section's colour doctrine, because the
doctrine lives in the emissives (a lit window is the only warm thing sheet B
allows on a large surface) and in the material's own value, and round 0 has
neither. It is also the thing that decides whether the mid band reads at
300-1400 m: a band of dark specks is invisible; a band of warm points is the
sheet's own middle distance.

---

## Open, and not settled by this round

1. **The boot bug in `fae3058` is still in the main tree.** One line in
   `src/render/fallvillage.ts`; verified in a scratch worktree. Until it is
   applied, **the app does not boot and no capture of anything is possible** —
   including the harness's other 23 poses.
2. **Pose 17's corrected camera is unphotographed.** The re-derivation put the
   camera off the end of the deck; it is fixed in the probe and in
   `tools/capture.mjs` (`[765.5, 152, -476.2]`), but this round's capture
   budget was already spent, so the "street in the sky" read is still unproven.
3. **The mid band's skyline edge is partly a placement question.** The band is
   3 km across and the old city stands in among it; the probe picks the cleanest
   stretch at this seed, and a different seed may have no clean stretch.
4. **No city-wide check was run.** `wide-skyline` and `aerial-top` were not in
   this run, so the homogenisation check (DESIGN §6.4) is outstanding for
   anything the village rendering changes.
5. **The village has no faces.** Windows, doors, rails, ladders, laundry and
   the revival kit are rounds 1-2; the close-focus pose 19 is the one that
   cannot be judged until they land.

---

# PART 3 — ROUND 1: the cold village (`b0d7bf3`, run 20:14, `shots/2026-10-21T03-14-12`)

## Close-out (DESIGN §6) — round 1

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg
          references/sections/B-cold-industrial/{01-monolith,02-fog-tram,03-snow-ropeway,04-tram-bridge}.jpg
          shots/2026-10-21T03-14-12/{16-fall-wreck-up,17-fall-piles-level,18-fall-skyline,19-fall-pile-close}.png
          shots/2026-10-21T03-14-12/_capture.json
          shots/compare/2026-10-21T03-21-18.png (+ .txt)
          (earlier: shots/2026-10-20T22-55-25 = greybox, shots/2026-10-20T23-39-50 = round 0)
JUDGED:   silhouette, mid-band height, material read, palette, value structure,
          atmospheric depth and human scale, per pose, in sheet-B vocabulary
GAP:      the zone's largest surfaces are still plain smooth prisms — the column
          shafts carry no break, no rebar, no stain and no salvage cut, and at
          dusk they are the brightest, warmest thing in the frame, so the warm
          is on the wrong objects
NEXT:     model the column break: a sheared or cratered top with rebar, a
          spalled face and a stain running down from it, on the shafts that
          face the camera — then the village's crowns can be the brightest
          thing in the dusk frames instead of the bare concrete
CONFIRMED: the mid band now exists as a legible stratum of village crowns
          (the largest crown reads at ~60 px in the frame, where the pile
          record's own extent projects to 87 px and round 0's pile slab was
          29 px; and the background behind the band is the low city at 139 m,
          not the 819 m heart); the crowns are stepped masses with masts,
          tanks, ribs and door leaves, not the flat greybox slab; the close
          pose holds a real material read — a corrugated rust container, a door
          leaf, two lit windows, a water tank on legs; the app boots, which is
          the first boot check the fix ever had; 212 crown lights delivered,
          0 starved, 0 refused tiles
```

**The run.** `node tools/orchestrate.mjs capture -- node tools/capture.mjs
--dev --sequence --pose=fall --timeout 900` → PASS, 5 shots, 54.8 s, no GPU
error, no WGSL error, **app ready (frameCount=569)** — the boot fix works, and
this is the first time anything has booted it. The preflight gate was
respected throughout: it blocked on disk (9.2 GB) and then on memory (72-244 MB)
for about forty minutes, and was never bypassed.

**Artifact, from `_capture.json`.** `dayPhase` 0.242 / 0.569 / 0.244 / 0.959 —
the same four phases as the greybox and round-0 runs, so every frame here is
phase-matched against them. `lodHistogram` [9,28,97,0] / [9,28,100,0] /
[9,34,124,0] / [9,34,124,0]. **Lights: delivered 1189 / 1107 / 1383 / 1107
against a 3072 cap, `starved 0` in all four poses, 5700/5700 tile bins, 0
refused tiles.** The 212 crown lights are therefore *not* starved and the
light budget is *not* the constraint in any of these frames.

---

## Pose 16 — the wreck field looking up at a knot of piles

**What the frame shows now.** Three shafts rise out of the bottom of the frame
and converge; they are **smooth, untextured, rust-orange prisms with clean
flat tops**, and each carries a small dark crown of stepped boxes with two thin
masts. The old city is at the upper left with warm lit windows, a black cable
crosses the frame, and the sky is a smooth salmon-brown wash with no fog
structure.

**The palette did not move.** Measured over the whole frame: **94 % of pixels
warm, mean RGB (107, 54, 40)** — against round 0's 94 % and (107, 54, 41). The
warm-bright point count is 0.04 %, also unchanged. The village's own surfaces
are cold; **the shafts are what is warm**, and the shafts are 80 % of the frame.

**And the shafts are not modelled at all.** `fallmesh.ts` still draws a pier as
one `pushOrientedBox` of `CONCRETE`. DESIGN §8's column table asks for
"diagonal shears, spalled craters, rebar bristling, a few at clean salvage
cuts, water stains running down from the breaks" — the *break kind* is in the
placement data (`c.break`: intact, shear, crater, cut) and **nothing renders
it**. Every one of the 93 piers is a clean-cut rectangular prism. At dusk that
prism is the brightest surface in the zone, which is why the frame is 94 %
salmon.

**Sheet B asks (frame 2):** a bare, windowless, *dark* concrete column, with
the pile — not the column — as the subject: a top-heavy stack of 6-8 boxy
rooms overhanging the column, a stepped crown of aerials, dishes, ladders and
a white tarp, warm gridded windows, rust-red panels, a railed catwalk, all
against **deep teal fog**.

**Question:** *does the eye land on the village or on the shaft?* Round 1: the
shaft, by a distance. The crown is legible now — it has a silhouette with
masts — but it is a hat on a stick: the pile is 9-26 m on a 60-150 m shaft, and
no camera change fixes that ratio.

**Most valuable change:** **model the column break** (see NEXT in the close-out).
Second: the crown needs a *lit row* that reads at 20-100 m, not only at 3 m.

## Pose 17 — level with a deck fragment

**What the frame shows now.** The camera fix worked: we stand **on** the deck
and look along it. Pier b's village is in the centre — a stepped stack of
near-black boxes, narrowing as it rises, with a **grey cylinder water tank on
legs** on top and one rust-red box at the left. The city behind is cold and
deeply atmospheric (pale blue-white towers, teal, warm roof lights), and the
deck is a large **blank white plane** across the bottom third.

**The value structure is inverted for sheet B.** 0 % warm, 98 % cool, mean RGB
(118, 135, 153) — and the subject is a **black silhouette** against a pale sky
over a white ground. Sheet B is the other way round: a near-black mass read
against a *mid* teal fog, with the ground dark. Here the frame is high-key
everywhere except the subject, so the village reads as a cut-out.

**And the deck is still a slab.** Nothing on it: no railing, no rooms, no stair
head, no lamp, no cable run. The DESIGN calls it a street in the sky; at
present it is a white table-top with a village at the far end.

**The pile reads as a wedding cake.** The courses narrow as they rise, so the
silhouette tapers; DESIGN wants the opposite — a pile 1.3-2× the column top,
overhanging, hung on outriggers with the bracing visible below, top-heavy. At
this camera the outriggers are hidden behind the pile's own footprint.

**Sheet B asks (frame 1):** a dark near megastructure with platforms, catwalks
and a skybridge, against heavy teal fog, with the far city a flat blue
silhouette.

**Question:** *is the street in the sky a street?* Round 1: no — it is a slab
with a village at the end of it.

**Most valuable change:** **the deck.** Railings, a line of boxes, a stair
head, one warm lamp, a cable run — the same change as round 0's note, still
unbuilt, and it is a third of the frame.

## Pose 18 — the fall zone as a mid band on the skyline

**What the frame shows now. This is the round-1 win.** The band exists and is
legible: a field of piers, each carrying a stepped crown of rust-red and
near-black boxes with thin masts, the largest crown reading at roughly 60 px
(round 0's largest pile slab was 29 px). The background behind the band is the
low city and the haze, not the 819 m heart. **The mid band is now a stratum.**

**And it still does not read as sheet B.** Measured over the whole frame:
**78 % warm, 0 % cool, mean RGB (93, 52, 42)** — against round 0's 78 %, 0 %
and (93, 52, 42). The warm-bright point count is 0.21 %, again unchanged. At
2.6× the crowns are clearly **dark red and black boxes with no lit row on
any of them**; the only warm points in the frame belong to the *old city's*
towers behind the zone. So the band reads as **dark hats on bright orange
needles** — the inverse of sheet B, where the middle distance is a mass of
warm window light held in cold blue.

**Why, when 212 crown lights are delivered and none is starved:** the light
budget is not the constraint. The crown light falls on surfaces whose albedo is
dark slate, while the dusk sun on the bare piers is two orders of magnitude
brighter; the lit patch is therefore dimmer than its neighbour and disappears
at 300-1400 m. **This is a value relationship, not a delivery failure** — the
same lesson as the market-lantern row in `COVERAGE.md` §"Market lantern hang
height", where the fix was never brightness but the value of what the light
lands on.

**Sheet B asks (frame 3):** the middle distance is a **mass of warm window
light** in cold blue, held between darker masses.

**Question:** *does the band read as a stratum of lit villages, or as a row of
orange columns?* Round 1: the latter, with the villages as dark hats on top.

**Most valuable change:** the same as everywhere — **the warm has to be on the
village and off the shafts.** Concretely: break the shafts (so their value
drops and their hue stops being the sun's), and give each crown an emissive
window row that is large enough to survive at 300 m.

## Pose 19 — 3 m from a village pile

**What the frame shows now. The best frame of the three rounds.** A rust-red
container with visible **corrugation ribs and a door leaf**; above it a slate
box room with **two lit windows** and a black box with a third; on top a **grey
water tank on legs** with a mast; the pile on a grey base course on the white
deck; behind it a cold blue-teal city with real atmospheric depth and warm
roof lights. Measured 1 % warm, 93 % cool, mean RGB (117, 132, 149) — and
unlike the other three frames, the *village's own surfaces* are the subject
and they are cold slate and rust, as round 1 claimed.

**The faces are partially delivered, and the lit windows read as spots.** At
1.9×: ribs, a door leaf, and lit windows with a frame are all present. But the
surfaces are **flat and clean** — no grime skirt, no soot run, no panel seam
beyond the ribs, no balcony rail, no ladder, no laundry, no planter, no tarp.
And the answer to "do the crown lights read as light, or as spots pasted on
the surface?" is **spots**: the lit windows are emissive rectangles and the
wall either side of them is the same value as the wall elsewhere. Nothing
spills, nothing falls off, no pool forms under the sill.

**Sheet B asks:** corrugated walls, seams, rust streaks, a framed lit window,
a railed balcony, a zig-zag ladder, laundry, a plant box — and the doctrine's
"a facade needs to survive a 3 m inspection".

**Question:** *is there a face on the pile with a panel, a seam, a lit window
and a rail on it?* Round 1: a face with a window, a rib and a door leaf, and
nothing else.

**Most valuable change:** **make the lit windows light.** Give them a spill
(an emissive that also brightens the surface around it, or a crown light
placed to graze the wall) and put the missing furniture on the faces —
weatherRoom's grime skirt and soot runs, a railed balcony, a ladder, one
planter. This is the frame that tests the doctrine and it is still empty.

---

## What round 1 actually moved, measured

| | round 0 | round 1 | sheet B |
| --- | --- | --- | --- |
| 16 warm pixels / mean RGB | 94 % / (107, 54, 41) | 94 % / (107, 54, 40) | cold surfaces, warm points |
| 18 warm pixels / mean RGB | 78 % / (93, 52, 42) | 78 % / (93, 52, 42) | cold surfaces, warm points |
| 18 warm-bright points | 0.21 % | 0.21 % | a stratum of them |
| 17 warm / cool | 0 % / 95 % | 0 % / 98 % | a mid-teal fog, not a pale sky |
| 19 warm / cool | 4 % / 93 % | 1 % / 93 % | the village's own surfaces cold, rust as accent |
| largest crown in 18 | 29 px | ~60-80 px | legible as a stratum |
| lit row visible on a crown at 300-1400 m | no | **no** | yes |
| lights starved | 0 | 0 | — |

The village's **form** moved: stepped crowns, masts, tanks, ribs, door leaves,
lit windows, and a band that now reads. The **section** did not move: the
palette statistics of the dusk frames are the same numbers to the digit, and
they will stay there until the surfaces that are warm in those frames — the
column shafts — are modelled and darkened.

## Open, after round 1

1. **The column shafts are still plain prisms.** The largest surfaces in the
   zone, unmodelled: no break, no rebar, no stain, no salvage cut, and a warm
   sun on all of it. This is the gap.
2. **The lit rows do not survive 300 m.** They are real at 19 and absent at 18.
   The crown lights are delivered and invisible.
3. **The deck fragment is still a slab**, and pose 17's frame is a third blank
   plane.
4. **The faces are flat and clean**; the lit windows do not light anything.
5. **No city-wide check was run.** `wide-skyline` and `aerial-top` were not in
   this run, so the homogenisation check (DESIGN §6.4) is still outstanding for
   the village rendering.
6. **The cantilever still reads as floating boxes** (pose 19, frame x 310-345,
   y 585-650: a vertical column of small boxes with visible gaps and nothing
   under them). Round 1 seated the cantilevers 0.3 m inside the record and
   put a brace under each, which is right; the *read* is still a stack of
   boxes hanging in the air at 300 m, because the shaft that should carry them
   is 16 px wide against a bright city.

---

# PART 4 — ROUND 2: the break (`bb92f87`, run 10:14, `shots/2026-10-21T17-14-22`)

## Close-out (DESIGN §6) — round 2

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg
          references/sections/B-cold-industrial/{01-monolith,02-fog-tram,03-snow-ropeway,04-tram-bridge}.jpg
          shots/2026-10-21T17-14-22/{16-fall-wreck-up,17-fall-piles-level,18-fall-skyline,19-fall-pile-close}.png
          shots/2026-10-21T17-14-22/_capture.json
          shots/compare/2026-10-21T17-16-56.png (+ .txt)   BASELINE | CURRENT | REFERENCE
          (baseline: shots/2026-10-21T03-14-12, round 1)
JUDGED:   silhouette, mid-band height, material read, palette, value structure,
          atmospheric depth and human scale, per pose, in sheet-B vocabulary
GAP:      the break is a notch in the silhouette, not broken concrete — there is
          no rebar bristling from the shear, no spalled crater, and no stain
          running down the face from the break, so the shafts read as clean
          prisms with a bite taken out of the top
NEXT:     dress the break itself: rebar out of the shear, a spall crater, and a
          stain running down from the break line (DESIGN §8's own words), on
          the shafts that read against the sky
CONFIRMED: the break reads as a break, at 48 m and at skyline distance, and at
          the far LOD — the near piers' tops go from flat cuts to stepped,
          sheared, notched tops, and the mid-distance crowns sit on ragged
          tops (round 2's "in geometry at both LODs" is true and visible); the
          shafts' value dropped and their shadow sides are now violet-grey
          rather than orange; the app boots, the 212 crown lights are still
          delivered with 0 starved, and the light counts are identical to round
          1; the break cost ~5k triangles
```

**The run.** `node tools/orchestrate.mjs capture -- node tools/capture.mjs
--dev --sequence --pose=fall --timeout 900` → PASS, 5 shots, 54.7 s, no GPU or
WGSL error, **app ready (frameCount=1025)**. Preflight OK (4.2 GB free).

**Artifact, against round 1.** Same seed (6191639). `dayPhase` **identical in
all four** — 0.242 / 0.569 / 0.244 / 0.959 — so this is a phase-matched A/B.
`lodHistogram` identical: [9,28,97,0] / [9,28,100,0] / [9,34,124,0] /
[9,34,124,0]. **Lights delivered 1189 / 1107 / 1383 / 1107, starved 0 in all
four, the same counts as round 1** — nothing was starved and the light budget
did not move. G-buffer triangles rose by 4.8k / 5.0k / 6.4k / 4.5k: the break
is cheap. Pixels changed between the two runs: **49.6 %** of 16, 49.1 % of 18,
8.4 % of 17, 13.1 % of 19 — one localised change, in the shafts.

---

## (a) At dusk, are the shafts still the brightest and warmest thing, or has the warm moved onto the crowns?

**No. The warm has not moved.** Measured over the whole frame:

| | round 1 | round 2 | change |
| --- | --- | --- | --- |
| 16 warm pixels | 94 % | 92 % | −2 |
| 16 mean RGB | (107, 54, 40) | (100, 52, 41) | luma 68 → 64 |
| 18 warm pixels | 78 % | 78 % | 0 |
| 18 mean RGB | (93, 52, 42) | (91, 52, 42) | luma 63 → 62 |

What the frames do show is the cold soot-slate arriving on the shafts' **shadow
sides** (violet-grey instead of orange), and the shafts dropping a little in
value. But a grey albedo under an orange light is orange, and at dusk the light
is a sunset: the sun is at 0.75° elevation (`dayPhase` 0.242 → elevation
`0.242 × 1.5 − 0.35 = 0.013 rad`) and the horizon sky is salmon. So the
sunlit faces are still terracotta and the frame is still 92 % and 78 % warm.

And the crowns carry no warmth at all: their red is **material**, and the
warm-bright population of the band is 0.21 % of the frame — the lit windows of
round 1 are 1-2 px at 300-1400 m. The nearest crown in 18 does show a single
cream lit window, which is the first warm point on a village crown in any
frame of this project, but one window on one crown is not a stratum.

**So the value structure is still inverted for sheet B:** the zone is a field of
warm shafts with dark hats on them, where sheet B is a cold mass with warm
points in it.

**A caveat the owner should have, because it changes what the dusk frames can
be used for.** *No frame in the sheet B set is a warm sunset.* Three are cold
fog (01, 02, 04) and one is cold blue daylight (03, the snow canyon). The two
dusk poses are therefore the two frames that **cannot be judged against sheet
B as a palette at all** — they measure the hour, not the zone. The material
has to be judged at 17 and 19, which are cold blue daylight, and there round
2's soot-slate does read: at 19 the pile is rust-red, slate and near-black
against a cold blue city. That is a decision for the owner, not for the
renderer: either the zone gets one review pose in the section's own register
(overcast or blue hour, no sun), or the dusk frames are accepted as a
different hour and judged against the section's *materials* rather than its
light.

## (b) Do the breaks read as breaks at 48 m (16) and at skyline distance (18)?

**Yes as silhouette, no as material.** In the A/B crop of the same band region
(round 1 above, round 2 below) the near piers' tops go from flat cuts to
**stepped, notched, sheared tops**, and the mid-distance crowns sit on visibly
ragged tops. In 16 the central shaft's top is notched, the left shaft is
sheared on a diagonal, and the right is jagged. That is a legible change of
outline and not noise — the claim holds.

**But the break is a notch, not broken concrete.** At 3× on the near pier in 18
the new top edge is clear — a step, a shoulder, a bite out of the rim — and the
shaft faces are still **smooth planes**: no rebar bristling from the shear, no
spalled crater, no stain running down from the break line. DESIGN §8 asks for
exactly those three things, and none of them is in the frame. What the eye
reads is a clean concrete prism with a bite taken out of it.

## (c) At 19, does the near pier read as broken concrete rather than a beige plane?

**There is no pier in the frame at all.** The camera stands 3 m off pile a's
corner at deck height (152 m); pier a's shaft stops at 150.4 m, *below* the
deck slab's top (151.55 m), so the near pier is out of frame entirely and the
close-focus pose cannot judge the break at any resolution.

What fills the lower third instead is the **deck fragment's blank top face** —
mean luma 138 against the pile stack's 73 and the sky's 173. So the largest
surface in the frame is an untextured mid-bright card, and the *subject is the
darkest thing in frame*, which inverts sheet B's value structure (near mass
dark, distance light). The pile itself is good — a rust-red container with
corrugation ribs and door leaves, a slate room with a lit cream window, a
near-black box with a second lit window, a grey water tank on legs — and the
cold city behind it has real depth. The floating cantilever stack is still
there at x 310-345.

## (d) Did the far LOD keep the broken silhouette?

**Yes.** The mid-distance group in the A/B crop (roughly 500-900 m, LOD 2)
shows ragged, notched tops in round 2 where round 1 showed flat cuts, so the
break survives where the merged blocks cannot know about it, exactly as the
round-2 note says: the break is in the shaft geometry, and the shaft is drawn
per kind at both LODs. What survives at that distance is the **silhouette**;
the break's material is sub-pixel there and will stay so.

---

## What round 2 moved, measured

| | round 1 | round 2 |
| --- | --- | --- |
| break reads as a notch (16, 18) | no — flat cuts | **yes** |
| break reads as broken concrete | no | **no** |
| shaft shadow-side hue | orange-brown | **violet-grey** |
| 16 / 18 warm pixels | 94 % / 78 % | 92 % / 78 % |
| 18 largest crown | ~60 px | ~60 px, ragged base |
| warm-bright points in 18 | 0.21 % | 0.21 % |
| lights starved | 0 | 0 |
| g-buffer triangles | — | +5k |

The zone's **silhouette** is now right: broken shafts, village crowns sitting
on the breaks, a band that reads as a stratum. Its **material** and its
**light** are not: the break is still a clean notch, the frames are still a
warm sunset, and the warm in them is still on the shafts rather than in the
village's windows.

---

# METHODOLOGICAL NOTE — three rounds were judged on the wrong hour

**Added 2026-10-21, between rounds 2 and 3. No verdict above is changed by this
note; it changes what the gap means, and it is a testable claim, not a
conclusion.**

**The claim.** Sheet B is a **blue-hour** section. All four frames are
teal-blue, the light source is the sky, and the warmth is emissive — windows
and signs (frame 2: dark teal masses, scattered warm windows, a white tarp).
**None of it is sunlit material.** Our two dusk poses were shot at `dusk`,
whose rig is `sunColor #ff7a2e` at 0.5° of elevation, exposure 1.14 and a
warm colourGrade — so those frames were orange *by construction*, and this
review's own measurement says so: 94 % → 92 % warm pixels at 16 and 78 % → 78 %
at 18 across the material round. "A grey albedo under an orange light is
orange" was the right diagnosis; the inference that the *material* was the
problem was not tested, and the numbers that came back did not move, which is
what an untested inference looks like.

**What exists and has never been photographed.** `src/sim/weather.ts:233-246`
already carries a `bluehour` phase: saturated blue ambient `#2b4a9a` at 0.8,
sun `#5a78d8` at 0.9 with the elevation **-0.11 rad** (6.3° under the
horizon), exposure 1.4, colourGrade `[0.94, 1.0, 1.1]`, sky `bluehour`,
godRays 0.2 — "no direct light worth the name; the sky is the light source, so
the windows are already coming on". It is in `PHASES`, aliased (`blue hour`,
`blue-hour`, `twilight`), wired through `SkyState`, the agent tools and the
local brain, and the sim self-test asserts the day cycle spends time in it.
**No capture pose has ever used it**: `tools/capture.mjs` had 4 dusk, 2
morning, 5 night and 4 noon, and not one bluehour. The one rig written for this
section's light has never been photographed.

**The control (round 3).** `time` on **16-fall-wreck-up** and
**18-fall-skyline** becomes `bluehour`; the cameras, the lens, the poses and
everything else stay exactly where rounds 0-2 put them. The next capture is
therefore a control on the hour and on nothing else, and it is judged on three
questions:

- **(a)** does the frame turn teal — i.e. does the zone's own material read as
  steel blue and slate once the light is the sheet's light?
- **(b)** do the crowns' lit windows read as **warm points against** the cold
  field, rather than as 1-2 px specks (the band is 0.21 % warm-bright pixels
  today)?
- **(c)** do the shafts stop being the brightest, warmest thing in frame
  **without any further material work**?

**A clean refutation is a useful result.** If the frame does not turn teal, or
the warm points still do not read, then the hour was not the binding constraint
and the gap reverts to the material — and the section's own register still
needs a pose shot in it. Either answer is worth the capture; what is not worth
it is a fourth round of judging a sunset against a blue hour.

**A mechanical note, because it changes how the control reads.** A pose's
`weather` block in `tools/capture.mjs` is **inert**. `setWeather` assigns it
(`src/main.ts:974-976`) and the director's next `snap()` writes the *phase's*
own values over it — `seedTargets()` copies the phase look into the base for
every `WX_KEYS` entry, and `snap()` then sets `wx.sky = this.targetSky`. So
the rig — sky, sun, ambient, exposure, grade, haze — comes from `time` alone,
and the `weather` lines in the poses have never done anything. The control is
therefore clean: `time: 'bluehour'` moves the whole rig, sky included, and
"same weather otherwise" is satisfied by construction. The `weather` blocks
have been left in place and are now labelled as documentation; the two blue
hour poses' `sky` fields were changed to match, which changes nothing in the
render.

**What this note does not do.** It does not reopen the verdicts above, and it
does not retract the findings that do not depend on the hour: the pose
derivations and their measurements (the 819 m heart behind the band, the deck
seen edge-on, the void at 3 m), the **break** — a notch, not broken concrete,
which was judged on silhouette and material and not on hue — the near-black
value of the pile against a pale sky, the blank deck, the floating cantilever
stack, and the fact that the zone's *ground* is in none of the four poses. It
also does not excuse the dusk frames: they were read as "the zone is 78-92 %
warm", and that measurement was a measurement of the *hour*, not of the zone.
Both of the dusk reviews should be read as measurements of a sunset.

---

# PART 5 — THE HOUR CONTROL (`6d5e81a`, run 22:19, `shots/2026-10-21T22-19-59`)

**Scope.** This part judges **one change**: poses 16 and 18 were moved from `dusk` to the
existing `bluehour` rig. Same camera, same lens, same geometry, same seed. It is a control
on the hour and nothing else. Rounds 0-2's break dressing is **not** re-judged here; the
round-2 verdict above stands as written.

## Close-out (DESIGN §6) — the blue-hour control

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first)
          shots/compare/2026-10-21T22-21-08.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-21T17-14-22 (round 2, dusk)
            current:  shots/2026-10-21T22-19-59 (bluehour)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-21T22-19-59/{16,17,18,19}.png
          same-build control: shots/2026-10-21T22-24-43 (identical command, same HEAD)
          shots/2026-10-21T22-19-59/_capture.json
JUDGED:   palette, value structure, atmospheric depth and material read at poses
          16 and 18; control integrity at 17 and 19 by pixel diff against a
          same-build run
GAP:      the hour is now right and the village is still not lit. At 18 the fall
          zone's crown carries ONE warm point, about 2 px, where every crown in
          sheet B carries rows of window blocks; at 16 the fall zone shows no
          lit window at all and the frame is a near-monochrome indigo wash with
          no value structure to read material against. Warm pixels went 96.9 %
          -> 0.0 % at 16 and 68.8 % -> 0.6 % at 18: the sunset is gone from the
          zone entirely, and nothing warm replaced it
NEXT:     give the fall zone's crowns and pile faces a lit row that holds at
          18's distance — several window blocks per crown, emitted as blocks
          rather than one small point (the day pose 19 already shows cream
          window blocks reading clearly on a pile, so the mechanism works; the
          blue-hour crowns get one dot). One change, then re-shoot 16 and 18
CONFIRMED: the frame turned cold — 18's mean RGB (92,52,42) -> (18,34,79), blue-
          dominant pixels 0.0 % -> 82.3 %, and it now reads as a hazy blue-hour
          city with the distant warm points the sheet is built from; the shafts
          are no longer the brightest warm thing at either blue-hour pose,
          because at the blue hour they are not warm at all; 17 and 19 did not
          regress (below); the app booted (frameCount=980), zero GPU/WGSL
          errors, 1189 / 1107 / 1383 / 1107 lights delivered with 0 starved
```

## The run, and whether the control is valid

`node tools/orchestrate.mjs capture -- node tools/capture.mjs --dev --sequence
--pose=fall --timeout 900` → PASS, 5 shots, 48.4 s. Preflight OK (2248 MB unused; the
benchmark's own gate had refused twice earlier in the session at 168 and 142 MB and passed
on retry). Four PNGs and `_capture.json` present. `"error": null` on every shot, no GPU or
WGSL line in the run, **app ready (frameCount=980)** — the app boots, which `tsc` and
`vite build` do not prove.

Phase, from `_capture.json`:

| pose | round 2 (dusk) | this run | changed? |
|---|---|---|---|
| 16 | dusk, dayPhase 0.242 | **bluehour, 0.164** | yes, by design |
| 17 | clear, 0.569 | clear, 0.564 | no |
| 18 | dusk, 0.244 | **bluehour, 0.164** | yes, by design |
| 19 | clear, 0.959 | clear, 0.958 | no |

Only 16 and 18 changed hour, as `6d5e81a` claims. Lights are identical to round 2 —
1189 / 1107 / 1383 / 1107 delivered, **starved 0** in all four — so the light budget did
not move and nothing was starved by the rig change.

**Control validity, measured rather than assumed.** A raw `BASE -> CURRENT` pixel diff
cannot answer "did 17/19 regress", because this harness lets the day clock drift and the
crowd move between runs. So the same command was run again at the same HEAD
(`shots/2026-10-21T22-24-43`) and used as the noise floor:

| pose | base → current | current → current (same build) | base → current-build control |
|---|---|---|---|
| 16 | 51.08 | 4.19 | 51.03 |
| 17 | 7.02 | 6.78 | **0.96** |
| 18 | 45.08 | 5.81 | 45.07 |
| 19 | 2.52 | 2.48 | **0.82** |

- **16 and 18:** the change is 10x the same-build noise. Real.
- **17 and 19: no regression.** `base -> current-build control` is 0.96 and 0.82 MAE, and
  `base -> current` matches the same-build noise (7.02 against 6.78 at 17; 2.52 against
  2.48 at 19). The 17 frame differs run to run by as much as it differs from base — that is
  the crowd and the 0.005 dayPhase drift, not this commit. The control is valid.
- One pose detail: 16's camera y moved 2.00 -> 2.26 m. The pose is derived and picks up
  ground height; the composition is unchanged between the two frames.

## (a) Did the frame turn teal?

**It turned cold, and it did not turn teal.** The sheet's blue is a pale, hazy
**teal-cyan**; this is a deep saturated **indigo**.

| | round 2 | this run | sheet B |
|---|---|---|---|
| 16 mean RGB | (100, 52, 41) | **(15, 34, 87)** | (50, 94, 109) |
| 18 mean RGB | (92, 52, 42) | **(18, 34, 79)** | (50, 94, 109) |
| 16 warm pixels | 96.9 % | **0.0 %** | 1.1 % |
| 18 warm pixels | 68.8 % | **0.6 %** | 1.1 % |
| 16 blue-dominant pixels | 0.0 % | **98.5 %** | — |
| 18 blue-dominant pixels | 0.0 % | **82.3 %** | — |

The frames are about **2.5-3x darker than the sheet** in each channel and far more
saturated. That is a **rig** observation, not a material one, and it is written down rather
than acted on here: the control changed the hour, and one change at a time. It is the
second thing to fix, after the gap above.

Judged by eye at 18, the frame is nevertheless a real improvement in register: it reads as
a hazy blue-hour city seen across rooftops, with the warm distant points the sheet is built
from, and the value structure of a skyline against a paler sky. At **16** it is worse than
that: two piers filling the frame in one flat indigo, no haze gradation, no value structure,
and **no village in it at all**. Whether 16's camera can show this section is now a fair
question — it frames two bare piers, and the zone's material may simply not be in shot
(PROCESS rule 4). **That is a hypothesis, not a finding**; it needs the pose's own
projection to settle it, and it is not what this control was for.

## (b) Do the crowns' lit windows read as warm points, or still 1-2 px?

**Still dots, and at 16 there are none.** At 18, cropped at 2x around the fall-zone crown,
the crown is a stack of blue boxes with **one** warm point on it, roughly 2 px at 1x. The
ordinary city towers behind it carry window grids that read as points; the zone's own
crowns do not.

The mechanism is not broken — pose 19 (unchanged, still clear) shows **cream window blocks
on a pile reading clearly**, tens of pixels across. What fails is scale and count at
blue-hour skyline distance: one emitter per crown is one dot. Sheet B's crowns carry rows of
lit blocks, several per face, and that density is most of what makes the section read. This
is the gap, and it is the next change.

## (c) Are the shafts still the brightest warm thing?

**At the blue hour the question dissolves: the shafts are not warm.** They are blue
ambient-lit concrete, and the warmest things left in 16 are a handful of distant tower
windows on the left edge. So the round-2 answer ("the shafts are still the brightest warm
thing") was a property of the **sunset**, exactly as `6d5e81a` predicted — remove the sun
and the zone has no warm of its own to compete with them.

At 19, unchanged and still daylight, the red-brown shafts **are** still the brightest warm
thing in frame, which is consistent and expected: nothing about this control touched the
day pose.

## (d) Did 17 and 19 regress?

**No.** `base -> current-build control` is 0.96 and 0.82 MAE; `base -> current` is at the
same-build noise floor for both. See the table above. 17's camera, crown and piles are
identical in composition and hue across all three runs, and 19's cream pile windows, pale
sky and teal towers are unchanged.

## What this control establishes, and what it does not

- **Establishes:** the sunset was doing most of the colour work at 16 and 18, and blue hour
  is the right register for the section — 18 in particular now sits in the sheet's family
  even though it is too dark and too saturated. The hour was a real part of the problem.
- **Establishes:** 17 and 19 are untouched by the commit, measured against a same-build run
  rather than argued from the code.
- **Does not establish** that material work is now sufficient. It is not: at the hour that
  suits the section, the village has no warm inventory of its own and the fall zone is
  legible only as silhouette.
- **Does not re-judge** round 2. The break is still a notch rather than broken concrete on
  the same evidence as PART 4, and the round-2 verdict stands.

---

# PART 6 — ROUND 3A: the lit row (`9b157dd`, run 23:54, `shots/2026-10-21T23-54-59`)

**Scope.** This part judges **one change**: lit *area* instead of intensity — a framed bay on
every dressed face, and a row of 1.7-2.9 m bays on two heights of the merged far mass, in
`src/render/fallvillage.ts`. The baseline is the blue-hour control `shots/2026-10-21T22-24-43`
(parent build `6d5e81a`; the only commits between it and `9b157dd` are docs, and `9b157dd`
touches only `fallvillage.ts` + its own doc). Same hour, same rig, same seed. This is the A/B,
not round 2's dusk run. Round 2's break verdict is not re-judged.

## Close-out (DESIGN §6) — round 3a

```
VERDICT:  more work needed
EVIDENCE: references/B-cold-industrial-sheet.jpg (read first)
          shots/compare/2026-10-21T23-57-43.png (+ .txt)   BASELINE | CURRENT | REFERENCE
            baseline: shots/2026-10-21T22-24-43 (blue-hour control, parent build)
            current:  shots/2026-10-21T23-54-59 (round 3a, shot after 9b157dd)
            reference column: references/sections/B-cold-industrial/
          full-size: shots/2026-10-21T23-54-59/{16,18}.png (this round)
                     shots/2026-10-21T23-54-59/{17,19}.png (control)
          shots/2026-10-21T23-54-59/_capture.json
JUDGED:   lit area vs lit points at 18 (a count, not an impression); whether 16
          has the fall zone in shot at all; 17/19 against the same-build control;
          warm/dark balance at 18 against sheet B frame 2
GAP:      at 18 the lit row is still a point, not a row: ZERO window blocks on
          any fall crown. The nearest crowns carry one mark each, and the whole
          fall band gained 2.0 % warm pixels (8009 -> 8171). The cause is a LOD
          mismatch, not the bay size: the merged row is drawn only at LOD 2,
          which the renderer reaches at ~819 m (chunk 256 m, LOD = floor(chunks
          / 1.6)), where a 2.9 m bay is 1.9-2.7 px; at 18's nearest columns
          (193-410 m, LOD 0-1) the near path lights one bay per face, which is
          the same single point as the control. 16 is blank for a different
          reason: no fall crown is in the frame at all (the pose).
NEXT:     one change: on the LOD 0-1 path, light a contiguous row of 2-3 bays
          at one height per dressed face (not one bay), so the crowns at 18's
          actual 193-410 m carry blocks; keep the merged row for LOD 2. Re-shoot
          18 and count blocks. Pose 16 is a separate, already-named camera item.
CONFIRMED: cost is inside D32 (+0.06 % G-buffer triangles; lights identical to
          the control, 1189/1107/1383/1107 delivered, 0 starved, app ready
          frameCount=1025); 17 did not change (0.38 -> 0.38 % warm; all diff
          components <= 19 px); 19's near bay is larger and reads better, not a
          regression; 16 shows no fall village, only old-city towers.
```

## (a) At 18, count the blocks on the fall crowns

The fall columns are the dark, windowless stacks; the towers with dense window grids behind
them are the old city. Six nearest fall columns were inspected at 4x, at the screen positions
`src/render/__probe_litrow.ts` prints, in both runs:

| column (screen) | distance | warm px, control | warm px, this run | blocks added |
|---|---|---|---|---|
| id109 (206,422) | 193 m | 12 | 14 | 0 |
| id89 (655,426) | 228 m | 6 | 10 | 0 |
| id108 (554,472) | 264 m | 29 | 30 | 0 |
| id123 (328,520) | 262 m | 70 | 84 | 0 |

(`warm` = R > B + 15 and R > 60, in a 90 x 90 px box centred on the column.) Each crown still
carries **one** mark of about 2-3 px, as in PART 5. Across the whole frame, no new warm
component larger than 16 px exists anywhere; the largest within 45 px of a fall column is
13 px at (373,559), a point. City-wide warm pixels went **1.62 % -> 1.63 %** and strong warm
**0.82 % -> 0.84 %**: the lit area did not arrive.

Why the geometry does not show: the probe's own line `const lod = p.d > 160 ? 2 : 0`
(`__probe_litrow.ts:106`) is an assumption about the renderer, not the renderer. The real rule
is `floor(chunkDistance / 1.6)` with 256 m chunks (`quality.ts:56,67`): LOD 2 starts at 3.2
chunks, about **819 m**. So at 18 the row is drawn only where it is 1.9-2.7 px, and at the
distances where a bay would be 10 px (193-410 m) the near path is what draws — one bay per
face. The "11.7 x 5.8 px at 193 m" in the round's account is the size of a bay that path does
not draw there. This is PROCESS rule 4: the diagnostic measured a distance, not the code path.

## (b) At 16, is there anything to read the shaft against?

**No — and the cause is the pose, confirmed from the frame.** The two piers fill the frame and
run off the top edge; neither crown is in shot. The only lit objects are the old-city towers
at the top-left and left edge, and they are pixel-unchanged: a same-threshold difference of
the two 16 frames finds **0** new strong-warm components >= 6 px, and the 4x crops of the
top-left cluster are the same window grid in both runs. That cluster is the facade shader, not
the fall village (the village's lit marks are sparse warm rooms, not a regular grid).

So the implementer's account is right about 16 for the wrong reason to act on: material did
not fail there, material was **not in the frame**. The pose is the defect (PROCESS rule 4;
D21: a diagnostic pose derives from live state, and this one frames two bare shafts). 16
cannot be used to judge round 3a and must be re-derived before it can judge the next round.

## (c) 17 and 19 — control

**17 did not regress.** Warm pixels 0.38 % -> 0.38 %; 66 diff components, all <= 19 px; the
composition, hue and crowd are the same as the control.

**19 did change, by design, and did not regress.** `9b157dd` changed the shared
`dressFaces` bay, and 19 is drawn at lod < 2, so the near path applies there. The left face
of the near pile now carries a framed three-pane bay where the control had one small pane;
the two changed components are 814 px and 528 px. It is closer to sheet B's window blocks and
is an improvement. The claim that 19 "did not change" is wrong on the frame; the claim that it
did not regress is right.

## (d) Warm/dark balance against sheet B frame 2

18's mean RGB is (17.9, 33.7, 78.7) against the sheet's roughly (50, 94, 109): still 2.5-3x
darker and more saturated, as PART 5 measured. The warm fraction is 1.63 % against the sheet's
1.1 %, but the warm is the old city's window points, not the zone's: the crowns carry one mark
each. The balance is **not** closer to frame 2, because the zone's own warm inventory is still
one point per crown. The sheet's frame 2 carries blocks at several heights on one column; this
frame carries one point.

## What this round establishes, and what it does not

- **Establishes:** the mechanism renders. 19's near bay is a real framed opening, and the
  emissive geometry costs +0.06 % triangles and zero lights. The lever is right; the placement
  of the lever at distance is not.
- **Establishes:** 17 is untouched, and the control is valid.
- **Does not establish** that lit area holds at 18. It does not: zero blocks, one point per
  crown, warm pixels flat.
- **Does not establish** anything about 16's material, because the village is not in the frame.
- **Does not re-judge** round 2.

**One next change, not three.** Put a 2-3 bay row on the LOD 0-1 dressed face, where 18's
columns actually are, and count at 18. The merged row stays for LOD 2. The pose 16 fix is
already named and is a separate item; it does not belong in this round's change.
