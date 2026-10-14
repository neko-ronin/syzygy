/**
 * Named viewpoints: the places a visitor can jump to from the strip or keys 1-8.
 *
 * Copied from the curated establishing poses in `tools/capture.mjs`, which were
 * chosen against the reference sheets (docs/DESIGN.md), not invented here. Only
 * the camera is taken: time of day and weather stay live, so a viewpoint shows
 * whatever light the clock is in. The poses assume the default world seed,
 * which is why the public build ignores `?seed=`.
 *
 * Kept in sync by hand. If a pose moves in capture.mjs, move it here too.
 */

import type { Vec3 } from '../core/math';

export interface Viewpoint {
  name: string;
  position: Vec3;
  lookAt: Vec3;
  fov: number;
  roll: number;
}

export const VIEWPOINTS: readonly Viewpoint[] = [
  // 01-wide-skyline: over the old town onto the downtown peak (D29).
  { name: 'skyline', position: [323, 150, 506], lookAt: [-491, 280, -754], fov: 1.12, roll: 0 },
  // 02-canyon-up: deep in the canyon looking up.
  { name: 'canyon', position: [190, 9, 330], lookAt: [230, 150, 150], fov: 1.43, roll: 0.08 },
  // 04-canal-level: canal water level, reflections.
  { name: 'canal', position: [900, 3, 260], lookAt: [1400, 6, 340], fov: 0.8, roll: 0.04 },
  // 13-terraces-d: planted terrace bands and vine curtains (sheet D).
  { name: 'terraces', position: [288.8, 14, 1013.0], lookAt: [243.9, 30, 1015.1], fov: 1.0, roll: 0 },
  // 14-old-town-c: an old-town alley, kilns, ruins and bunting (sheet C).
  { name: 'old town', position: [200, 22, 275], lookAt: [194, 10, 170], fov: 1.05, roll: 0 },
  // 09-market-aisle-night: the market aisle from a first-floor balcony.
  { name: 'market', position: [1.16, 6.0, 0.36], lookAt: [1.16 + 0.2557 * 40, 0.8, 0.36 - 0.9668 * 40], fov: 1.05, roll: 0 },
  // 05-aerial-top: near top-down over the grid.
  { name: 'aerial', position: [300, 1400, 700], lookAt: [0, 0, 0], fov: 1.05, roll: 0 },
  // 06-low-vertigo: low over the void, wide and banking.
  { name: 'vertigo', position: [-420, 14, -560], lookAt: [180, 260, 120], fov: 1.62, roll: -0.35 },
];
