/**
 * Named viewpoints: the places a visitor can jump to from the strip or the number keys.
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
  // 14-old-town-c: an old-town alley, kilns, ruins and bunting (sheet C).
  { name: 'old town', position: [200, 22, 275], lookAt: [194, 10, 170], fov: 1.05, roll: 0 },
  // Street level by the old town, up at the teal tower cluster. Framed at night.
  { name: 'teal towers', position: [-73.5, 7.1, -47.3], lookAt: [179.7, 136.7, -328.5], fov: 0.92, roll: 0 },
  // Same spot as teal towers, turned to the lit tower and the dark peaks behind it.
  { name: 'lit tower', position: [-73.5, 7.1, -47.3], lookAt: [-339.2, 144.3, -313], fov: 0.98, roll: 0 },
];
