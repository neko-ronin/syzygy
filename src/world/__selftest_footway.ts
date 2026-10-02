/**
 * Footway widths and clear walking bands per district — R1/R11 evidence.
 *
 * The reviewer's NEXT is lateral distribution "on the actual walking surface".
 * Groups are placed on footways (`crowd.ts`: centre at kerb + FOOTWAY_SETBACK
 * 1.9 m, members within GROUP_RADIUS 1.5 m, wander ±1.5 m — a ±3 m footprint),
 * so this table is the capacity the crowd spreads into. Clutter sits on the
 * footway (kerb line or building line per CLUTTER_EDGE), so the clear band is
 * footway minus one ~1 m clutter line; capacity counts bodies at 0.7 m lateral
 * pitch (0.45 m body + separation; LEGIBILITY_TARGETS wants 2 px gaps at
 * 20–24 px bodies ≈ 0.11–0.17 m at 50–75 m, which the pitch covers).
 *
 * Kind sharpening matters more than the district default: alley-kind footways
 * are single-file-or-spill by construction in every district, and the market
 * kind (2.86 m at the market-spine district) is narrower than any group
 * formation — the hero aisle is the carriageway it sits in, not the footway.
 *
 * Run: `npx vite-node src/world/__selftest_footway.ts`
 */

import { DISTRICT_STYLES } from './districts';
import type { RoadKind } from './citygen';
import { groundGrammarFor } from './groundgrammar';

const KINDS: RoadKind[] = ['street', 'market', 'artery', 'alley'];
const CLUTTER_LINE = 1.0;
const PITCH = 0.7;

function main(): void {
  const problems: string[] = [];
  console.log('\nFOOTWAY per district (authored m) | clear band (minus 1 m clutter) | capacity @0.7 m pitch');
  for (let d = 0; d < DISTRICT_STYLES.length; d++) {
    const cells: string[] = [];
    for (const k of KINDS) {
      const g = groundGrammarFor(d, k);
      const fw = g.footwayWidth;
      if (!Number.isFinite(fw) || fw < 0) problems.push(`${DISTRICT_STYLES[d].key}/${k} footway ${fw}`);
      const clear = Math.max(0, fw - CLUTTER_LINE);
      const cap = Math.floor(clear / PITCH);
      cells.push(`${k}=${fw.toFixed(2)}/${clear.toFixed(2)}/${cap}`);
    }
    console.log(`  ${DISTRICT_STYLES[d].key.padEnd(17)} ${cells.join('  ')}`);
  }
  // Hero adjacency: the market-spine district's market-kind footway borders
  // the hero aisle. It is 2.86 m by construction (2.2 x 1.3); if a future
  // grammar narrows it below a two-abreast band the hero loses its edge.
  const heroFw = groundGrammarFor(10, 'market').footwayWidth;
  if (heroFw < 2.5) problems.push(`market market-kind footway ${heroFw.toFixed(2)} m below 2.5 m hero floor`);
  // Alley-kind bands are single-file by design; assert the design, not a value.
  for (let d = 0; d < DISTRICT_STYLES.length; d++) {
    const fw = groundGrammarFor(d, 'alley').footwayWidth;
    if (fw >= 1.5) problems.push(`${DISTRICT_STYLES[d].key} alley footway ${fw.toFixed(2)} m is not single-file`);
  }
  console.log(`\nVIOLATIONS ${problems.length === 0 ? 'none' : problems.length}`);
  for (const p of problems) console.log(`  - ${p}`);
}

main();
