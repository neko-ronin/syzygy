/** Shared physical envelope for the emitted human and its local simulation. */
export const PEDESTRIAN_RADIUS = 0.25;
export const PEDESTRIAN_HEIGHT = 1.7;

/** A solid box emitted by the same placement that emits its visible geometry.
 *
 * The horizontal basis is tangent (tx,tz), then across (-tz,tx). Half-extents
 * exclude pedestrian clearance; the local crowd solver expands by body radius.
 * Boxes above a standing person's head do not obstruct the walking surface.
 */
export interface CrowdObstacle {
  x: number;
  z: number;
  /** Unit tangent of the emitted box's local X axis. */
  tx: number;
  tz: number;
  halfAlong: number;
  halfAcross: number;
  minY: number;
  maxY: number;
  /** Provenance for diagnostics, e.g. market-counter, canopy-post or planter. */
  kind: string;
}
