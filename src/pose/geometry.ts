import type { PosePoint } from './landmarks';

/**
 * Angle at joint `b` formed by points a-b-c, in degrees (0..180).
 * Uses x/y only: the depth estimate from a single phone camera is too noisy
 * for joint angles.
 *
 * `aspect` is frame width / height. Landmarks are normalized separately on
 * each axis, so on a 9:16 portrait frame one unit of x is shorter than one
 * unit of y; we rescale x before measuring.
 */
export function jointAngle(a: PosePoint, b: PosePoint, c: PosePoint, aspect = 1): number {
  const abx = (a.x - b.x) * aspect;
  const aby = a.y - b.y;
  const cbx = (c.x - b.x) * aspect;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) return 180;
  const cos = Math.min(1, Math.max(-1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * How far the line from `lower` up to `upper` leans away from vertical, in
 * degrees. 0 = perfectly upright, 90 = horizontal.
 */
export function leanFromVertical(upper: PosePoint, lower: PosePoint, aspect = 1): number {
  const dx = (upper.x - lower.x) * aspect;
  const dy = lower.y - upper.y; // image y grows downward
  if (dx === 0 && dy === 0) return 0;
  return (Math.atan2(Math.abs(dx), dy) * 180) / Math.PI;
}

export function visible(p: PosePoint | undefined, min = 0.5): p is PosePoint {
  return !!p && (p.visibility ?? 1) >= min;
}

/** Exponential moving average that smooths landmark jitter. */
export class Ema {
  private value: number | undefined;
  constructor(private readonly alpha: number) {}
  next(x: number): number {
    this.value = this.value === undefined ? x : this.alpha * x + (1 - this.alpha) * this.value;
    return this.value;
  }
  reset(): void {
    this.value = undefined;
  }
}
