/**
 * THROWAWAY probe: why the crowd has no lateral spread. Round 3.
 *
 * The sidecar says every sampled agent sits at z = 0.35 and the crowd centroid
 * is cz = 0, i.e. 2550 bodies on a 1-D line along x. This measures the
 * distribution rather than trusting the four samples in the sidecar, and works
 * out which axis is actually the lateral one before concluding anything.
 *
 * Self-validated against a quantity whose answer is already known before
 * reporting anything: the agent count is checked against
 * `crowd.population().n`, and the street tangent is printed alongside the
 * spread so the spread can be read in the street's own frame.
 */

import { defaultWorld, type WorldState } from '../core/state';
import { City, defaultCityConfig, GROUND_Y, sampleStreetPlan, type StreetSample } from '../world/citygen';
import { derivePose } from '../world/diagnosticposes';
import { CrowdSim } from './crowd';

const SEED = 0x5e7a17;
const SETTLE_FRAMES = 300;
const FX = 0, FY = 1, FZ = 2, FLAT = 28, FACTIVE = 25, FLOCAL = 29;
const CAP = 6000;

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

const out: StreetSample = {
  dist: 0, px: 0, pz: 0, tx: 1, tz: 0, width: 1, kind: 'street', clearance: 0,
};

function main(): void {
  const city = new City(defaultCityConfig(SEED));
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) city.getChunk(x, z);
  const w: WorldState = defaultWorld(SEED);
  const sim = new CrowdSim(SEED);
  sim.attach(city, SEED);
  const f = (sim as unknown as { f: Float32Array }).f;

  const boot = city.getChunk(0, 0);

  if (!boot) throw new Error('chunk (0,0) not resident');
  const bootPos: [number, number, number] = [boot.boundsMin[0] + 20, GROUND_Y + 2.4, boot.boundsMin[2] + 20];
  const bootLook: [number, number, number] = [boot.boundsMin[0] + 120, GROUND_Y + 1.7, boot.boundsMin[2] + 20];
  // Does the line exist at BIRTH, or does the walk make it?
  console.log(`\n  SPREAD TIME SERIES at the boot pose — is the line seeded or walked into?`);
  console.log(`    frame    z IQR    x IQR    lat IQR`);
  for (const frames of [5, 10, 30, 120, 300, 600]) {
    const s = new CrowdSim(SEED);
    s.attach(city, SEED);
    const sf = (s as unknown as { f: Float32Array }).f;
    for (let k = 0; k < frames; k++) s.update(1 / 60, { position: bootPos, lookAt: bootLook }, w);
    const lz: number[] = [], lx: number[] = [], ll: number[] = [];
    for (let i = 0; i < CAP; i++) {
      if (sf[i * FLOCAL + FACTIVE] < 0.5) continue;
      const x = sf[i * FLOCAL + FX], z = sf[i * FLOCAL + FZ];
      lx.push(x); lz.push(z);
      const st = sampleStreetPlan(city.plan, x, z, out);
      ll.push((x - st.px) * -st.tz + (z - st.pz) * st.tx);
    }
    const iqr = (v: number[]): number => {
      const c = v.reduce((a, b) => a + b, 0) / (v.length || 1);
      const d = v.map((x) => x - c).sort((a, b) => a - b);
      return pct(d, 0.75) - pct(d, 0.25);
    };
    console.log(`    ${String(frames).padStart(5)}   ${iqr(lz).toFixed(3).padStart(7)}   ${iqr(lx).toFixed(2).padStart(7)}   ${iqr(ll).toFixed(2).padStart(7)}   (n=${lz.length})`);
  }
  for (let k = 0; k < SETTLE_FRAMES; k++) sim.update(1 / 60, { position: bootPos, lookAt: bootLook }, w);
  const pose = derivePose('street-crowd', sim.population(), SEED);
  if (!pose.ok) throw new Error(`pose refused: ${pose.reason}`);
  const pos = pose.position as [number, number, number];
  const look = pose.lookAt as [number, number, number];
  for (let k = 0; k < SETTLE_FRAMES; k++) sim.update(1 / 60, { position: pos, lookAt: look }, w);
  const sp = sim as unknown as {
    seededCount: number; seededWidth: number; seededTx: number;
    seededTz: number; seededLat: number; seededCz: number;
  };
  if (sp.seededCount > 0) {
    const sc = sp.seededCount;
    console.log(`\n  SEEDER'S STREET SNAP, accumulated over ${sc} seeds:`);
    console.log(`    placed.width   = ${(sp.seededWidth / sc).toFixed(2)} m`);
    console.log(`    placed tangent = (${(sp.seededTx / sc).toFixed(3)}, ${(sp.seededTz / sc).toFixed(3)})`);
    console.log(`    lat (footway)  = ${(sp.seededLat / sc).toFixed(2)} m`);
    console.log(`    group centre cz= ${(sp.seededCz / sc).toFixed(2)} m`);
  }

  const pop = sim.population();
  console.log(`CROWD SPREAD  pose=${pose.id}  seed=${SEED}`);
  console.log(`  population()  n=${pop.n}  centroid=(${pop.cx}, ${pop.cz})  spread=${pop.spread} m`);
  console.log(`  visibleCount=${sim.visibleCount}  instances=${sim.instances.count}`);
  console.log(`  SELF-VALIDATION n matches population: ${pop.n >= sim.visibleCount ? 'PASS' : 'FAIL'}`);
  if (pop.n < sim.visibleCount) { console.log('  instrument disagrees; withholding'); return; }

  // Raw world axes.
  const xs: number[] = [], ys: number[] = [], zs: number[] = [], lat: number[] = [], tgt: number[] = [];
  const tanX: number[] = [], tanZ: number[] = [];
  for (let i = 0; i < CAP; i++) {
    if (f[i * FLOCAL + FACTIVE] < 0.5) continue;
    const x = f[i * FLOCAL + FX], y = f[i * FLOCAL + FY], z = f[i * FLOCAL + FZ];
    const s = sampleStreetPlan(city.plan, x, z, out);
    xs.push(x); ys.push(y); zs.push(z);
    lat.push((x - s.px) * -s.tz + (z - s.pz) * s.tx);
    tgt.push(f[i * FLOCAL + FLAT]);
    tanX.push(s.tx); tanZ.push(s.tz);
  }
  console.log(`\n  agents measured: ${xs.length}`);

  const axis = (label: string, v: number[]): void => {
    const c = v.reduce((a, b) => a + b, 0) / (v.length || 1);
    const d = v.map((x) => x - c).sort((a, b) => a - b);
    console.log(`  ${label.padEnd(26)} p5 ${pct(d, 0.05).toFixed(2).padStart(7)}  p25 ${pct(d, 0.25).toFixed(2).padStart(7)}`
      + `  p50 ${pct(d, 0.5).toFixed(2).padStart(7)}  p75 ${pct(d, 0.75).toFixed(2).padStart(7)}  p95 ${pct(d, 0.95).toFixed(2).padStart(7)}`
      + `   IQR ${(pct(d, 0.75) - pct(d, 0.25)).toFixed(2)} m`);
  };
  const cx = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const cz = zs.reduce((a, b) => a + b, 0) / (zs.length || 1);
  console.log(`\n  DISTRIBUTION ABOUT THE CROWD CENTROID (centroid x=${cx.toFixed(2)} z=${cz.toFixed(2)})`);
  axis('x - cx  (along?)', xs);
  axis('y', ys);
  axis('z - cz  (lateral?)', zs);

  // Which way does the street actually run?
  const tX = tanX.reduce((a, b) => a + b, 0) / (tanX.length || 1);
  const tZ = tanZ.reduce((a, b) => a + b, 0) / (tanZ.length || 1);
  const ang = (Math.atan2(tZ, tX) * 180 / Math.PI).toFixed(1);
  console.log(`\n  STREET TANGENT averaged over agents: (${tX.toFixed(3)}, ${tZ.toFixed(3)})  bearing ${ang} deg`);
  console.log(`    -> the street runs mostly along ${Math.abs(tX) > Math.abs(tZ) ? 'X' : 'Z'}; the other axis is the lateral one.`);

  lat.sort((a, b) => a - b);
  tgt.sort((a, b) => a - b);
  console.log(`\n  PERPENDICULAR OFFSET from the nearest carriageway centreline (the lateral measure)`);
  console.log(`    p5 ${pct(lat, 0.05).toFixed(2)}  p25 ${pct(lat, 0.25).toFixed(2)}  p50 ${pct(lat, 0.5).toFixed(2)}`
    + `  p75 ${pct(lat, 0.75).toFixed(2)}  p95 ${pct(lat, 0.95).toFixed(2)}   IQR ${(pct(lat, 0.75) - pct(lat, 0.25)).toFixed(2)} m`);
  console.log(`    F.lateral (stored target): p5 ${pct(tgt, 0.05).toFixed(2)}  p25 ${pct(tgt, 0.25).toFixed(2)}  p50 ${pct(tgt, 0.5).toFixed(2)}`
    + `  p75 ${pct(tgt, 0.75).toFixed(2)}  p95 ${pct(tgt, 0.95).toFixed(2)}   IQR ${(pct(tgt, 0.75) - pct(tgt, 0.25)).toFixed(2)} m`);

  // Is the hold reaching those targets, or is the population being replaced?
  const before = new Float32Array(CAP);
  for (let i = 0; i < CAP; i++) before[i] = f[i * FLOCAL + FACTIVE] >= 0.5 ? f[i * FLOCAL + FX] : NaN;
  let reseeded = 0, turnedOff = 0;
  for (let k = 0; k < 30; k++) {
    sim.update(1 / 60, { position: pos, lookAt: look }, w);
    for (let i = 0; i < CAP; i++) {
      const was = !Number.isNaN(before[i]);
      const now = f[i * FLOCAL + FACTIVE] >= 0.5;
      if (was && !now) turnedOff++;
      if (!was && now) reseeded++;
    }
  }
  console.log(`\n  POPULATION CHURN over 30 frames: ${turnedOff} agents retired, ${reseeded} newly seeded`);

  // How far is each agent from its own stored target right now?
  const err: number[] = [];
  for (let i = 0; i < CAP; i++) {
    if (f[i * FLOCAL + FACTIVE] < 0.5) continue;

    const x = f[i * FLOCAL + FX], z = f[i * FLOCAL + FZ];
    const s = sampleStreetPlan(city.plan, x, z, out);
    const l = (x - s.px) * -s.tz + (z - s.pz) * s.tx;
    err.push(Math.abs(f[i * FLOCAL + FLAT] - l));
  }
  err.sort((a, b) => a - b);
  console.log(`  |F.lateral - current lateral|: p25 ${pct(err, 0.25).toFixed(2)}  p50 ${pct(err, 0.5).toFixed(2)}  p75 ${pct(err, 0.75).toFixed(2)}  p95 ${pct(err, 0.95).toFixed(2)} m`);
  console.log('    (near 0 means the hold is achieving its targets; large means it is not)');
  // Are the seeder's footway targets landing inside buildings, and is
  // resolveBuildings ejecting everyone onto a building face (a straight line)?
  const cs = city.cfg.chunkSize;
  let insideB = 0, activeN = 0, faceLat: number[] = [];
  for (let i = 0; i < CAP; i++) {
    if (f[i * FLOCAL + FACTIVE] < 0.5) continue;
    activeN++;
    const x = f[i * FLOCAL + FX], z = f[i * FLOCAL + FZ];
    const ck = city.getChunk(Math.floor(x / cs), Math.floor(z / cs));
    if (!ck) continue;
    for (const b of ck.buildings) {
      if (x > b.aabbMin[0] && x < b.aabbMax[0] && z > b.aabbMin[2] && z < b.aabbMax[2]) {
        insideB++;
        const nearZ = Math.min(Math.abs(z - b.aabbMin[2]), Math.abs(z - b.aabbMax[2]));
        faceLat.push(nearZ);
        break;
      }
    }
  }
  faceLat.sort((a, b) => a - b);
  console.log(`  BUILDING OVERLAP: ${insideB} of ${activeN} active agents stand inside a footprint `
    + `(${((100 * insideB) / (activeN || 1)).toFixed(1)}%)`);
  if (faceLat.length) {
    console.log(`    distance to the footprint face they are sitting on: p50 ${pct(faceLat, 0.5).toFixed(2)} m`);
  }

  // --- assertions. The measurement exists to be re-run, so it must fail loudly
  // when the defect it exists for is present. Both FAIL on `e96ba15`.
  const halfW = 32.15 * 0.5 + 1.9;
  const left = lat.filter((v) => v < -halfW * 0.5).length;
  const right = lat.filter((v) => v > halfW * 0.5).length;
  const leftShare = left / (left + right || 1);
  const sideOk = leftShare > 0.3 && leftShare < 0.7;
  const cZ = zs.reduce((a, b) => a + b, 0) / (zs.length || 1);
  const dz = zs.map((v) => v - cZ).sort((a, b) => a - b);
  const zIqr = pct(dz, 0.75) - pct(dz, 0.25);
  const zOk = zIqr > 1.0;
  console.log(`\n  FOOTWAY BALANCE  left ${left}  right ${right}  (left share ${(leftShare * 100).toFixed(1)}%)`);
  console.log(`  z IQR about centroid = ${zIqr.toFixed(2)} m`);
  const bad = (ok: boolean, why: string): void => console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${why}`);
  bad(sideOk, 'both footways carry a real share of the crowd (30-70%)');
  bad(zOk, 'z IQR about the centroid exceeds 1.0 m (not a line)');
  if (!(sideOk && zOk)) console.log('\nSPREAD VIOLATIONS 2');
}

main();