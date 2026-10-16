/**
 * Review poses for the fall zone (DESIGN §8), derived from the zone, not typed in:
 * run, then paste the printed objects into tools/capture.mjs.
 *
 *   npx --yes vite-node@6.0.0 src/world/__probe_fallzone.ts
 *
 * 16 stands in the wreck field and looks up at the densest knot of piles
 * (frame 2's angle); 17 is level with the longest deck fragment (frame 1);
 * 18 frames the closest pair of spire stumps from 900 m across the belt, on the
 * side away from downtown, so the mid band reads against the sky; 19 stands on a
 * deck fragment 3 m from a pile.
 */

import { cityPlan, GROUND_Y, sampleStreetPlan, type StreetSample } from './citygen';
import { beltBand } from './districts';
import { fallZone, patchAt } from './fallzone';

const SEED = 0x5e7a17;
const z = fallZone(SEED), plan = cityPlan(SEED), f = plan.districts;
const r1 = (v: number): number => Math.round(v * 10) / 10;
const pose = (name: string, label: string, position: number[], lookAt: number[], time: string, sky: string, fov = 1.05): string =>
  `  {\n    // Derived by src/world/__probe_fallzone.ts (seed 5e7a17).\n    name: '${name}',\n    label: '${label}',\n`
  + `    position: [${position.map(r1).join(', ')}], lookAt: [${lookAt.map(r1).join(', ')}], fov: ${fov}, roll: 0,\n`
  + `    time: '${time}',\n    weather: { sky: '${sky}', cloudCover: 0.35, haze: 0.3 },\n    lens: { fov: ${fov} },\n    settle: 30,\n  },`;

// 16: the street point in the deck band, outside the fences, with the most piles 25-150 m ahead
// (two or three rows of the 48 m grid: frame 2's forest) in a 70-degree cone.
const s: StreetSample = { dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0 };
let best = { n: 0, x: 0, z: 0, ang: 0 };
for (let x = -1536; x < 1792; x += 6) {
  for (let q = -1536; q < 1792; q += 6) {
    if (beltBand(f, x, q) !== 1 || patchAt(z, x, q)) continue;
    if (sampleStreetPlan(plan, x, q, s).clearance > -2) continue;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const n = z.columns.filter((c) => {
        const d = Math.hypot(c.x - x, c.z - q);
        const off = Math.abs(Math.atan2(Math.sin(Math.atan2(c.z - q, c.x - x) - ang), Math.cos(Math.atan2(c.z - q, c.x - x) - ang)));
        return d >= 25 && d <= 150 && off < 0.61;
      }).length;
      if (n > best.n) best = { n, x, z: q, ang };
    }
  }
}
const knot = z.columns.filter((c) => Math.hypot(c.x - best.x, c.z - best.z) <= 150 && Math.hypot(c.x - best.x, c.z - best.z) >= 25);
const tops = knot.map((c) => c.pileTop).sort((p, q) => p - q);
const lookUp = [best.x + Math.cos(best.ang) * 60, tops[tops.length >> 1] ?? GROUND_Y + 120, best.z + Math.sin(best.ang) * 60];
console.log(`// 16: ${best.n} piles in the cone`);
console.log(pose('16-fall-wreck-up', 'sheet B: the wreck field looking up at a knot of piles, dusk', [best.x, GROUND_Y + 1.7, best.z], lookUp, 'dusk', 'dusk'));

// 17: level with the longest deck fragment, 45 m off its side.
const deck = [...z.decks].sort((p, q) => {
  const lp = Math.hypot(z.columns[p.a].x - z.columns[p.b].x, z.columns[p.a].z - z.columns[p.b].z);
  const lq = Math.hypot(z.columns[q.a].x - z.columns[q.b].x, z.columns[q.a].z - z.columns[q.b].z);
  return lq - lp;
})[0];
if (deck) {
  const a = z.columns[deck.a], b = z.columns[deck.b];
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, l = Math.hypot(b.x - a.x, b.z - a.z);
  const nx = -(b.z - a.z) / l, nz = (b.x - a.x) / l;
  console.log(pose('17-fall-piles-level', 'sheet B: level with a deck fragment between two piles, morning', [mx + nx * 45, deck.y + 6, mz + nz * 45], [mx, deck.y + 8, mz], 'morning', 'clear'));
  // 19: standing on the fragment, 3 m from pile a's face, looking at it.
  const ux = (a.x - b.x) / l, uz = (a.z - b.z) / l, reach = Math.max(a.pileHalfX, a.pileHalfZ) + 3;
  console.log(pose('19-fall-pile-close', 'sheet B: on a deck fragment, 3 m from a village pile, noon', [a.x - ux * reach, deck.y + 1.7, a.z - uz * reach], [a.x, deck.y + 5, a.z], 'noon', 'clear', 1.1));
} else {
  console.log('// 17 and 19: no deck fragment at this seed; derive them from the tallest pile instead.');
}

// 18: the closest pair of spire stumps, framed from 900 m across the belt (perpendicular to
// the railway), on the side farther from the downtown heart, whose towers would wall the view.
// The belt runs right through the city, so a centroid of all columns lands on the old town.
const spires = z.columns.filter((c) => c.kind === 'spire');
let pair: [typeof spires[0], typeof spires[0]] | null = null;
for (let i = 0; i < spires.length; i++) {
  for (let j = i + 1; j < spires.length; j++) {
    const d = Math.hypot(spires[i].x - spires[j].x, spires[i].z - spires[j].z);
    if (!pair || d < Math.hypot(pair[0].x - pair[1].x, pair[0].z - pair[1].z)) pair = [spires[i], spires[j]];
  }
}
if (pair) {
  const mx = (pair[0].x + pair[1].x) / 2, mz = (pair[0].z + pair[1].z) / 2;
  // Across the belt: the grid frame's local z, which rotationY maps to (sin, cos).
  const ax = Math.sin(z.gridYaw), az = Math.cos(z.gridYaw);
  const heart = [Math.cos(f.downtownBearing) * 900, Math.sin(f.downtownBearing) * 900];
  const sides = [1, -1].map((s) => [mx + ax * 900 * s, mz + az * 900 * s]);
  const cam = sides.sort((p, q) => Math.hypot(q[0] - heart[0], q[1] - heart[1]) - Math.hypot(p[0] - heart[0], p[1] - heart[1]))[0];
  const head = Math.atan2(mz - cam[1], mx - cam[0]);
  const seen = spires.filter((c) => Math.abs(Math.atan2(Math.sin(Math.atan2(c.z - cam[1], c.x - cam[0]) - head), Math.cos(Math.atan2(c.z - cam[1], c.x - cam[0]) - head))) < 0.56);
  console.log(`// 18: ${seen.length}/${spires.length} spire stumps inside the horizontal view; pair ${Math.hypot(pair[0].x - pair[1].x, pair[0].z - pair[1].z).toFixed(0)} m apart`);
  console.log(pose('18-fall-skyline', 'sheet B: the fall zone as a mid band on the skyline, dusk', [cam[0], 160, cam[1]], [mx, GROUND_Y + 110, mz], 'dusk', 'dusk', 1.12));
} else {
  console.log('// 18: fewer than two spire stumps at this seed.');
}
