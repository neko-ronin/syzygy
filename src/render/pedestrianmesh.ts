/** One reusable human silhouette, in metres, with +Z facing forward.
 *
 * Separated legs/feet, a tapered shoulder mass, neck and close arms survive
 * instancing without the old central post and detached signboard outline.
 * It is a static walking pose; this module does not claim limb animation.
 */
import type { Vec3 } from '../core/math';
import { MeshBuilder, type Mesh } from '../world/geometry';
import { PEDESTRIAN_HEIGHT } from '../world/crowdobstacles';

export function pedestrianMesh(): Mesh {
  const b = new MeshBuilder();
  // Neutral cloth preserves the per-agent coat tint supplied by the simulator.
  const cloth: Vec3 = [0.65, 0.68, 0.72];
  const trousers: Vec3 = [0.16, 0.19, 0.23];
  const shoe: Vec3 = [0.08, 0.09, 0.11];
  const skin: Vec3 = [0.70, 0.54, 0.42];

  for (const side of [-1, 1]) {
    const stride = side * 0.035;
    b.pushBox([side * 0.082, 0.05, stride + 0.025], [0.052, 0.05, 0.105], shoe);
    b.pushBoxTapered(
      [side * 0.082, 0.09, stride], [side * 0.082, 0.48, stride * 0.45],
      [0.044, 0, 0.05], [0.052, 0, 0.06], trousers,
    );
    b.pushBoxTapered(
      [side * 0.082, 0.47, stride * 0.45], [side * 0.073, 0.87, 0],
      [0.052, 0, 0.06], [0.063, 0, 0.075], trousers,
    );
    // Arms connect to the shoulders and remain inside the physical disc at
    // every yaw. The small opposing fore/aft offset avoids a rigid T pose.
    const armZ = -side * 0.01;
    b.pushBox([side * 0.195, 1.22, armZ], [0.038, 0.14, 0.052], cloth);
    b.pushBox([side * 0.2, 0.99, armZ * 1.5], [0.035, 0.12, 0.048], cloth);
    b.pushBox([side * 0.2, 0.835, armZ * 1.5], [0.034, 0.042, 0.042], skin);
  }
  b.pushBox([0, 0.875, 0], [0.14, 0.065, 0.085], trousers);
  b.pushBoxTapered([0, 0.89, 0], [0, 1.36, 0], [0.135, 0, 0.075], [0.19, 0, 0.095], cloth);
  b.pushBox([0, 1.415, 0], [0.043, 0.055, 0.047], skin);
  b.pushCylinder([0, 1.46, 0], [0, PEDESTRIAN_HEIGHT, 0], 0.1, 8, skin,
    { capEnds: true, radiusTop: 0.09 });
  // A small face projection makes the local forward direction legible nearby.
  b.pushBox([0, 1.57, 0.097], [0.025, 0.027, 0.022], skin);
  return b.build();
}
