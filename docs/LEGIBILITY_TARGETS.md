# Legibility and repetition targets

Quantitative acceptance thresholds for street-level crowd legibility and market
repetition. Produced by the vision agent (Codex, acting as visual-developer) on
2026-09-30, at the request of the orchestrator, after `docs/REVIEW_GATE_1.md`
returned `more work needed` on both counts.

**These numbers are thresholds to beat, not measurements of a reference.** Where
the agent could not derive a number from the reference frames it said so and
proposed one instead. That distinction is preserved below and should be preserved
by anyone citing them.

---

## 1. Market repetition — the canopy row

### What could and could not be measured

| Property | Finding |
| --- | --- |
| Width | Projected widths vary substantially with depth. **Independent width variation is not reliably measurable** from these oblique views. |
| Colour | Dark/brown and ochre areas are visible, but neighbouring roofs repeatedly reuse that arrangement. **No defensible percentage** — lighting and stripe placement prevent a colour variance statistic. |
| Pitch | **Estimated** neighbouring projected roof-edge angles differ by roughly **5-10°**. Different roof types are not apparent at a glance. |
| Night frames | `night-down.png` preserves the repeated row outline. The other three night frames are **too dark to count roof boundaries or measure variation confidently**. |

### The reference cannot supply this number

`references/A-saturated-sheet.jpg` and `references/sections/A-saturated/02-cablecar.jpg`
contain **no identifiable market canopy row** from which to derive a repeat period
or a maximum run length. Their repeated façade elements are not interchangeable
with stalls.

This is consistent with `docs/STREET_SPEC.md` §C: the reference set contains no
legible market at all. Everything built for the market is a **design hypothesis**,
and the criterion below is therefore a proposal, not a spec.

### Pass criterion

> **No more than three consecutive near-identical canopy/counter modules. Every
> fourth module must visibly change roof silhouette or counter arrangement at
> normal image size. Recolouring an otherwise identical roof does not count as a
> typology break. Check both daylight angles; variation visible only when enlarged
> fails.**

Note the consequences:
- Colour variation does not count. Only silhouette does.
- Both daylight angles. A typology that reads from one camera and not the other
  has not passed.
- Three of four night frames being too dark to evaluate is itself a problem: a
  market you cannot see is a market you cannot review.

---

## 2. Crowd legibility at 20 px

Frame sizes: our street frame is 1600 × 900; the `B-cold-industrial` reference is
900 × 1614.

### The finding that corrects the obvious fix

Our figure/ground contrast **already exceeds the reference's sampled contrast, and
still fails to read as a person**:

| Sample | Contrast |
| --- | --- |
| Reference, 16 px figure | 2.76:1 |
| Reference, 19 px figure | 2.20:1 |
| Reference, 26 px figure | 1.40:1 |

The reference's people are **lower** contrast than ours and they read fine.
**Raising contrast is not the fix.** Separation and grouping are.

### What could not be established

Our frame does **not** establish a reliable minimum height at which an isolated
pedestrian becomes recognisable. The left band remains merged even where its
vertical extent is much greater than 20 px. The narrow isolated mark around
**(1052, 466)** could not be confidently identified as a pedestrian, so no contrast
figure is claimed for it.

### Acceptance thresholds

```
At 20-24 px height:
  a separately identifiable BODY, with at least 2 px of background separation
  from neighbouring bodies, plus >= 2.5:1 torso/background contrast.

For explicit head separation, use 32 px as the acceptance sample:
  a head approximately 4 px across, with a visible shoulder narrowing / neck
  of at least 1 px.
```

### The limitation to design around

In the reference, distinct head/neck separation becomes unreliable below
approximately **25-30 px** — *estimated*. Smaller figures can still read as people,
but the agent's advice is **not to preserve heads merely to preserve heads**.

**So: do not chase head geometry at 20 px. Chase body separation.**

This inverts the naive fix, and it is worth stating plainly: the failure is that
adjacent agents are at or under 2 px of screen separation — the left-edge band
merges into a continuous strip. That is a **screen-space density** problem, not a
world-space headcount problem. Raising the instance count makes it worse.

---

## 3. What to measure

The reviewer's brief, restated as instrumentation:

1. **Mean and minimum nearest-neighbour separation in screen pixels**, for agents
   in the 20-30 px band. If the minimum is near zero, adjacent agents are
   overlapping in screen space and the fix is placement.
2. **The fraction of visible street length carrying no legible figures.** The far
   end of the street reads largely empty. That is the real target: fill it with
   readable groups **with gaps between them**, not with a continuous band.

Watch for the opposite failure. `PITFALLS.md` §9 is the clump failure — raising
density without fixing distribution produces a clump. Groups with deliberate gaps
are the opposite of uniform density, and the measurement should show that.

---

## 4. What a lit market aisle has to look like

The review gate's single named gap was that warm lantern illumination does not
visibly reach the aisle. 365 market lights were produced and **0 reached
`BakedChunk.lights`** — counted by a self-test, delivered to nothing. That plumbing
is being fixed. The acceptance test remains the reviewer's, verbatim:

> Make a market lantern produce a clearly luminous warm core and a visible warm
> pool on the adjacent walking surface at the reviewed night exposure.