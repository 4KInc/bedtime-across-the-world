/**
 * A laptop or tablet camera sees little room around a child's raised hands, so
 * the comfortable middle of the picture (REACH_BAND each side of the centre)
 * spans the whole lamp light (REACH_M each side): a wrist a little inside the
 * frame's edge reaches the stage's edge, as "fly up over the ferns" or "carry it
 * to the cave" ask, without leaving the camera's view.
 */
export const REACH_BAND = 0.35;
export const REACH_M = 0.25;

/** Image position (0..1) to metres from the light's centre, along that axis. */
export function reach(image: number): number {
  return Math.max(-1, Math.min(1, (image - 0.5) / REACH_BAND)) * REACH_M;
}
