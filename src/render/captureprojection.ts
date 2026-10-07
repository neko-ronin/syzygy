/** The renderer's camera math, shared with diagnostic matrix expectations. */
import { m4lookAt, m4perspectiveReverseZ, type Mat4, type Vec3 } from '../core/math';

export function writeCaptureProjection(view: Mat4, projection: Mat4, position: Vec3, lookAt: Vec3,
  roll: number, fov: number, width: number, height: number): void {
  m4lookAt(view, position, lookAt, [Math.sin(roll), Math.cos(roll), 0]);
  m4perspectiveReverseZ(projection, fov, width / Math.max(1, height), 0.1, Infinity);
}
