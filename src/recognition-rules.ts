import { ShapeIds } from './shadowplay-components.js';

/**
 * Recognition decisions that do not depend on the ECS: which shape a request
 * accepts (the gate), how two hands make one creature, and how long a shape
 * must be held. Pure, so the recognition sweep tests exactly what runs.
 */

/** Flicker grace: brief tracking dropouts (Quest drops a hand for ~100 ms) don't reset the hold timer. */
export const GRACE_SECONDS = 0.15;

/**
 * Wrists this close together with both hands open read as a two-hand bird.
 * Side-by-side palms (not interlocked) put the wrists about a hand-width apart.
 */
export const BIRD_WRIST_GAP = 0.22;
/** Open hands for the bird, deer and crocodile: fingers straight (a resting hand curls ~0.33). */
export const BIRD_MAX_CURL = 0.25;
/** ...and the thumb not bent across (an OK sign bends it to ~0.5). */
const PAIR_MAX_THUMB = 0.35;

/**
 * When a story asks for the bird, real hands get more room: on a Quest 3 (Nov 14)
 * a bird made with thumbs hooked and fingers a little relaxed read as two flat
 * or slightly curled hands that missed the strict rule. Hooked thumbs bend the
 * thumb, so a bent thumb is fine when the two thumb tips are together (that is
 * what makes it a shadow bird). A resting hand (curl ~0.3, thumb half bent, not
 * hooked to the other) still fails the thumb test.
 */
const BIRD_WANTED_GAP = 0.28;
const BIRD_WANTED_CURL = 0.3;
const THUMBS_TOGETHER = 0.07;
/** ...and each thumb away from its own index fingertip (an OK sign touches it). */
const OWN_PINCH_MIN = 0.04;
const THUMB_TIP = 4;
const INDEX_TIP = 9;

function antlerThumb(h: PairHand): boolean {
  const t = h.features[0];
  return t <= PAIR_MAX_THUMB || (t <= DEER_MAX_THUMB && ownPinch(h) >= OWN_PINCH_MIN);
}

function ownPinch(h: PairHand): number {
  const t = THUMB_TIP * 3;
  const i = INDEX_TIP * 3;
  return Math.hypot(h.joints[t] - h.joints[i], h.joints[t + 1] - h.joints[i + 1], h.joints[t + 2] - h.joints[i + 2]);
}
/** Assist (the story has waited 40 s or more): any two hands near each other, side by side, are the bird. */
const BIRD_ASSIST_GAP = 0.35;
const BIRD_ASSIST_TOLERANCE = 0.2;

/** Deer: hands may be further apart than the bird's (antlers either side of the head). */
const DEER_WRIST_GAP = 0.4;
const DEER_MIN_UP = 0.75;
const DEER_MIN_SPREAD = 0.5;
/**
 * Real antlers are rarely rigid: fingers a little bent, the thumb wherever it
 * falls, the hands tilted. Fingers up and spread is what makes a deer (and
 * keeps resting hands out), so the curl and thumb get more room, and the
 * story's assist relaxes how upright the fingers must be.
 */
const DEER_MAX_CURL = 0.32;
const DEER_MAX_THUMB = 0.5;
/** Crocodile: flat hands stacked, one wrist above the other. */
const CROC_MIN_DY = 0.03;
const CROC_MAX_DY = 0.2;
const CROC_MAX_SIDEWAYS = 0.12;
/**
 * Crocodile jaws: two flat hands, a little looser than the bird's (finger spread
 * is too noisy to use; stacked and level is what makes it a crocodile).
 */
const CROC_MAX_CURL = 0.3;
/** Jaws point sideways: finger direction roughly level (0.5 = level, 1 = up). */
const CROC_LEVEL = 0.25;

/** Free Stage: every shape that can be performed, mapped to its character. */
export const FREE_ACCEPT: Readonly<Record<string, string>> = {
  [ShapeIds.Rabbit]: ShapeIds.Rabbit,
  [ShapeIds.Ears]: ShapeIds.Rabbit,
  [ShapeIds.Fish]: ShapeIds.Fish,
  [ShapeIds.Dog]: ShapeIds.Dog,
  [ShapeIds.Bird]: ShapeIds.Bird,
  [ShapeIds.Snail]: ShapeIds.Snail,
  [ShapeIds.Swan]: ShapeIds.Swan,
  [ShapeIds.Deer]: ShapeIds.Deer,
  [ShapeIds.Crocodile]: ShapeIds.Crocodile,
};

export function isHiddenPair(shape: string | null | undefined): boolean {
  return shape === ShapeIds.Deer || shape === ShapeIds.Crocodile;
}

/**
 * The gate: which requested shape (if any) a hand's shape satisfies. In the
 * story only the shapes the current beat asks for (and their easier
 * alternatives) count; anything else is ignored. Free Stage accepts every
 * performable creature.
 */
export function requested(shape: string, t1: string, a1: string, t2: string, a2: string, free: boolean, oneHand: boolean): string {
  if (shape === ShapeIds.None) return ShapeIds.None;
  if (shape === t1 || (a1 !== ShapeIds.None && shape === a1)) return t1;
  if (shape === t2 || (a2 !== ShapeIds.None && shape === a2)) return t2;
  // One-hand mode: an open hand is the bird wherever a bird is asked for (and in Free Stage).
  if (oneHand && shape === ShapeIds.Open) {
    if (t1 === ShapeIds.Bird) return t1;
    if (t2 === ShapeIds.Bird) return t2;
    if (free) return ShapeIds.Bird;
  }
  if (!free) return ShapeIds.None;
  return FREE_ACCEPT[shape] ?? ShapeIds.None;
}

export interface PairHand {
  /** 25 joints x (x, y, z), world space (y up). */
  joints: Float32Array;
  /** Joint-angle features (hand-features.ts). */
  features: Float32Array;
  /** Mean curl of the four fingers. */
  curl: number;
  /** This hand's own (one-hand) shape, after its acceptance threshold. */
  shape: string;
  /** The best-fitting template, whether or not it passed its threshold. */
  best: string;
}

/**
 * Two-hand shapes, both hands in the light. Most specific first: deer (open,
 * fingers up and spread), crocodile (flat hands stacked), bird (open, wrists
 * side by side), cup (both cupped, side by side). Deer and crocodile only when
 * `hidden` (Free Stage, or a story that asks for one). `birdWanted` /
 * `deerWanted` / `crocWanted`: that shape is asked for (more room for real
 * hands); `assist`: the story's extra tolerance.
 */
export function classifyPair(
  l: PairHand,
  r: PairHand,
  hidden: boolean,
  birdWanted = false,
  assist = 0,
  deerWanted = false,
  crocWanted = false,
): string | null {
  const dx = l.joints[0] - r.joints[0];
  const dy = l.joints[1] - r.joints[1];
  const dz = l.joints[2] - r.joints[2];
  const gap = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const sideways = Math.sqrt(dx * dx + dz * dz);
  const lf = l.features;
  const rf = r.features;
  const open = l.curl <= BIRD_MAX_CURL && r.curl <= BIRD_MAX_CURL && lf[0] <= PAIR_MAX_THUMB && rf[0] <= PAIR_MAX_THUMB;
  // A bent thumb is fine unless it touches its own index tip (an OK sign, not an antler hand).
  const antlers = l.curl <= DEER_MAX_CURL && r.curl <= DEER_MAX_CURL && antlerThumb(l) && antlerThumb(r);
  // Only when a deer is asked for, so a crocodile's level hands never become antlers.
  // When asked for, the assist also lets fingers held together count (Quest 3, Nov 15: antlers made flat).
  const up = DEER_MIN_UP - (deerWanted ? assist : 0);
  const spread = DEER_MIN_SPREAD - (deerWanted ? assist * 2.5 : 0);
  if (
    hidden &&
    antlers &&
    gap < DEER_WRIST_GAP &&
    lf[8] >= up &&
    rf[8] >= up &&
    lf[5] >= spread &&
    rf[5] >= spread
  ) {
    return ShapeIds.Deer;
  }
  // When asked for, the assist lets the jaws be less exactly stacked, level and flat, thumbs anywhere
  // (Quest 3, Nov 15: two flat hands near each other, not quite one above the other).
  const ca = crocWanted ? assist : 0;
  const flat =
    l.curl <= CROC_MAX_CURL + ca * 0.5 &&
    r.curl <= CROC_MAX_CURL + ca * 0.5 &&
    ((lf[0] <= PAIR_MAX_THUMB && rf[0] <= PAIR_MAX_THUMB) || ca > 0);
  if (
    hidden &&
    flat &&
    Math.abs(dy) >= CROC_MIN_DY - ca * 0.1 &&
    Math.abs(dy) <= CROC_MAX_DY &&
    sideways <= CROC_MAX_SIDEWAYS + ca &&
    Math.abs(lf[8] - 0.5) <= CROC_LEVEL + ca &&
    Math.abs(rf[8] - 0.5) <= CROC_LEVEL + ca
  ) {
    return ShapeIds.Crocodile;
  }
  // A bird asked for: checked before the cup, with more room (and, after a long wait, any two hands side by side).
  if (birdWanted && sideways >= Math.abs(dy)) {
    if (assist >= BIRD_ASSIST_TOLERANCE && gap < BIRD_ASSIST_GAP) return ShapeIds.Bird;
    const t = THUMB_TIP * 3;
    const thumbs = Math.hypot(l.joints[t] - r.joints[t], l.joints[t + 1] - r.joints[t + 1], l.joints[t + 2] - r.joints[t + 2]);
    const thumbsOk =
      (lf[0] <= PAIR_MAX_THUMB && rf[0] <= PAIR_MAX_THUMB) ||
      (thumbs <= THUMBS_TOGETHER && ownPinch(l) >= OWN_PINCH_MIN && ownPinch(r) >= OWN_PINCH_MIN);
    if (gap < BIRD_WANTED_GAP && l.curl <= BIRD_WANTED_CURL && r.curl <= BIRD_WANTED_CURL && thumbsOk) return ShapeIds.Bird;
  }
  if (gap >= BIRD_WRIST_GAP) return null;
  // Wings sit side by side: stacked hands are not a bird.
  if (open && sideways >= Math.abs(dy)) return ShapeIds.Bird;
  // Cupped hands: one hand clearly a cup, the other cup-like (half curled, thumb
  // in), so an occluded finger on one hand does not break the pair.
  if ((l.shape === ShapeIds.Cup || r.shape === ShapeIds.Cup) && cupLike(l) && cupLike(r)) return ShapeIds.Cup;
  return null;
}

function cupLike(h: PairHand): boolean {
  return h.best === ShapeIds.Cup || (h.curl >= 0.3 && h.curl <= 0.7 && h.features[0] >= 0.3);
}

/** Hold-timer state between frames. */
export interface HoldState {
  candidate: string;
  sinceMatch: number;
}

/**
 * One frame of the hold timer: a requested shape must be held for the hold
 * time; a different shape starts over; losing it for longer than the grace
 * (a tracking dropout) starts over. Returns the new held time.
 */
export function stepHold(state: HoldState, held: number, target: string, delta: number): number {
  if (target !== ShapeIds.None) {
    if (target !== state.candidate) held = 0;
    state.candidate = target;
    state.sinceMatch = 0;
    return held + delta;
  }
  state.sinceMatch += delta;
  return state.sinceMatch > GRACE_SECONDS ? 0 : held;
}

/**
 * Smoothing of joint positions for recognition only (the shadows and the hand
 * occluders keep the raw joints, so nothing lags the real hand). Tracking
 * jitter is zero-mean in position but biases the angle features (a jittery
 * straight finger always looks bent), so it is removed before features are
 * computed. alpha 0.35 per frame at 72 Hz: 5 mm of jitter becomes about 2.3 mm,
 * for about 26 ms of latency. A hand that reappears starts fresh.
 */
export const SMOOTHING_ALPHA = 0.35;

export class JointSmoother {
  readonly joints = new Float32Array(75);
  private primed = false;

  /** Feed this frame's joints (or null when the hand is not tracked); returns the smoothed joints. */
  update(raw: Float32Array | null, alpha = SMOOTHING_ALPHA): Float32Array | null {
    if (!raw) {
      this.primed = false;
      return null;
    }
    if (!this.primed) {
      this.joints.set(raw);
      this.primed = true;
      return this.joints;
    }
    for (let i = 0; i < 75; i++) this.joints[i] += (raw[i] - this.joints[i]) * alpha;
    return this.joints;
  }
}
