import { Vector3 } from '@iwsdk/core';
import type { RoomPlane } from './wall-choice.js';

/**
 * Per-frame shared stage geometry, written by StageSetupSystem and read by the
 * recognizer and puppet systems. Allocated once; never reassigned.
 */
export const stageRuntime = {
  ready: false,
  /** Stage center on the wall/screen surface, world space. */
  center: new Vector3(),
  /** Unit normal pointing from the surface toward the player. */
  normal: new Vector3(0, 0, 1),
  right: new Vector3(1, 0, 0),
  up: new Vector3(0, 1, 0),
  width: 1.2,
  height: 0.75,
  /** Lamp bulb world position (the shadow projection origin). */
  bulb: new Vector3(),
  /** Centre of the lamp's light pool on the stage (moves as the lamp is dragged). */
  poolCenter: new Vector3(),
  lampOn: true,
  /** Adaptive quality level (Stage.quality), for visuals outside the stage system. */
  quality: 0,
  /** The headset's answer to our 72 Hz request: '' (not asked yet), 'granted', 'refused', 'unsupported'. */
  frameRateRequest: '',
  /** The viewer's eyes (head), world space, updated every frame by stage setup. */
  eye: new Vector3(),
  /** Distance from the eyes to the stage, metres. */
  distance: 2,
  /** The headset's horizontal field of view in degrees (0 until measured in XR). */
  fovH: 0,
  /** Where the lamp and journal stand: on the real desk Room Setup found ('surface'), or at the usual height ('estimate'). */
  desk: 'estimate' as 'estimate' | 'surface',
  /** The stage's room anchor (stage-anchor.ts AnchorState), for diagnostics and tests. */
  anchor: '' as string,
  /** The stage went back to the wall remembered from last session. */
  anchorFromLastTime: false,
  /** Times the anchor moved the stage back onto its wall this session, and the largest move (cm). */
  anchorFixes: 0,
  anchorMaxFixCm: 0,
  /** A creature just woke: the lamp light swells (1) and settles back (0) over about a second. */
  wakeFlare: 0,
  /** Every wake, counted, with where the creature was (world) and its colour: fireflies, sounds. */
  wakes: 0,
  wakeAt: new Vector3(),
  wakeColour: 0xffb45a,
  wakeShape: '',
  /** Mo on the wall (world point, moth.ts), and whether she is away visiting the storyteller's fingertip (mo-visit.ts). */
  moWall: new Vector3(),
  moAway: false,
  /** The story has reached its last beat ("The End"), set by the story system. */
  atEnd: false,
  /** A search beat: the light pool follows the hand like a torch (the lamp behind the viewer is not slid). */
  searching: false,
  /** Every creature let go after it was awake, counted, with where, how big (metres) and its colour: lanterns on the desk. */
  releases: 0,
  releaseAt: new Vector3(),
  releaseScale: 0.3,
  releaseShape: '',
  releaseColour: 0xffb45a,
  /**
   * Automation only (emulator tests): when set, stage placement sees these
   * planes instead of the headset's detected planes.
   */
  testPlanes: null as RoomPlane[] | null,
  /** Automation only: behave as a browser without WebXR anchors. */
  testNoAnchors: false,
};

/** Hand tracking flickering during a shape request (story.ts): show the light hint. */
export const trackingRuntime = { lightHint: false };

/** Accessibility modes that several systems draw differently (written by SettingsSystem). */
export const accessRuntime = {
  highContrast: false,
  /** Look to press: head-gaze dwell presses buttons and stands in for shapes. */
  gazeDwell: false,
  /** Look to press: the centre of the view is on the stage right now. */
  gazeOnStage: false,
  /** Voice commands: 'off', 'starting', 'browser' or 'server' (listening), 'unavailable', 'denied'. */
  voiceState: 'off',
  /** Set by a spoken "go on"; the story finishes a movement beat with it and clears it. */
  voiceNext: false,
  /** The last thing understood, shown on the stage for a moment ('' for nothing), and when (performance.now()). */
  voiceHeard: '',
  voiceHeardAt: 0,
  /** Set by a spoken "help": Mo the coach gives a tip now (mo-coach.ts clears it). */
  coachRequested: false,
};

/**
 * Everything "Look to press" can press, by name: panel buttons register here
 * (with the same handler a pinch runs). Written by the panel systems.
 */
export const gazeTargets = new Map<string, { object: import('@iwsdk/core').Object3D; press: () => void }>();

/** The headset panel's last button presses (ids, newest last), for the hands-only test. */
export const uiPresses: string[] = [];

export const JOINT_COUNT = 25;

/** Render layers that isolate each hand's shadow casters for silhouette matching. */
export const SILHOUETTE_LAYER = { left: 2, right: 3 } as const;

export interface HandSample {
  tracked: boolean;
  /** 25 WebXR joints x (x, y, z), world space. */
  joints: Float32Array;
  radii: Float32Array;
  /** Set by the puppet system while a character replaces this hand's shadow. */
  hideCasters: boolean;
  /** Joint-angle features for this frame (written by the shape matcher). */
  features: Float32Array;
  /** Best silhouette template match at or above threshold ('' if none). */
  silhouetteShape: string;
  silhouetteOverlap: number;
  /** performance.now() of the readback that produced the match. */
  silhouetteAt: number;
  /** Raw opinions for the recognition lab: best template of each method, even below threshold. */
  jointBest: string;
  jointScore: number;
  /** Joint method's shape after the tolerance threshold ('' if none). */
  jointShape: string;
  silhouetteBest: string;
  silhouetteBestOverlap: number;
}

function makeHand(): HandSample {
  return {
    tracked: false,
    joints: new Float32Array(JOINT_COUNT * 3),
    radii: new Float32Array(JOINT_COUNT),
    hideCasters: false,
    features: new Float32Array(9),
    silhouetteShape: '',
    silhouetteOverlap: 0,
    silhouetteAt: 0,
    jointBest: '',
    jointScore: 0,
    jointShape: '',
    silhouetteBest: '',
    silhouetteBestOverlap: 0,
  };
}

/** Written by HandCasterSystem each XR frame. */
export const handRuntime = {
  left: makeHand(),
  right: makeHand(),
  /** The session has controllers but no hand input (hands-first guard). */
  controllersOnly: false,
};

/**
 * Test hand sources (synthetic pose fixtures, the webcam bridge). While
 * `active`, the hand caster uses these world-space joints instead of WebXR
 * hand input; a side set to null counts as untracked. Works outside XR too.
 */
export const handOverride: {
  active: boolean;
  source: string;
  left: Float32Array | null;
  right: Float32Array | null;
  radii: Float32Array;
  cameraAllowed: boolean;
  cameraTarget: 'override' | 'second';
  xrToSecond: boolean;
} = {
  active: false,
  source: '',
  left: null,
  right: null,
  radii: new Float32Array(JOINT_COUNT).fill(0.009),
  /** False while a replay drives the hands; the camera may take over only during join-in moments. */
  cameraAllowed: true,
  /** Where camera hands go: the performing pair, or the second pair (a Live guest while the host performs). */
  cameraTarget: 'override',
  /** While the override performs (a Live guest's turn), this headset's own hands still cast, as the second pair. */
  xrToSecond: false,
};

/**
 * A second pair of hands on this stage, in world space: the other person in a
 * Live room (or, for a Live guest, their own camera hands while the host
 * performs). They cast shadows only: they do not occlude and do not drive this
 * stage's recognition. Null means not shown.
 */
export const secondHands: { left: Float32Array | null; right: Float32Array | null } = {
  left: null,
  right: null,
};

/** This headset's own hands while they cast as the second pair (handOverride.xrToSecond); written by the caster. */
export const xrSecond: { left: Float32Array | null; right: Float32Array | null } = {
  left: null,
  right: null,
};

/**
 * Project a world point from the lamp bulb onto the stage plane.
 * Returns the magnification (lamp->surface / lamp->point), or 0 when the point
 * is not between the lamp and the surface.
 */
export function projectToStage(point: Vector3, out: Vector3): number {
  const b = stageRuntime.bulb;
  const n = stageRuntime.normal;
  const dx = point.x - b.x;
  const dy = point.y - b.y;
  const dz = point.z - b.z;
  const denom = dx * n.x + dy * n.y + dz * n.z;
  if (denom > -1e-5) return 0;
  const c = stageRuntime.center;
  const t = ((c.x - b.x) * n.x + (c.y - b.y) * n.y + (c.z - b.z) * n.z) / denom;
  if (t < 1) return 0;
  out.set(b.x + dx * t, b.y + dy * t, b.z + dz * t);
  return t;
}

/**
 * Where a hand meets the stage. The lamp's shadow when it lands on the stage;
 * otherwise where the hand appears over the stage from the viewer's eyes; else
 * its place in the performance zone in front of the viewer (reachZone). The
 * lamp stands on the desk at about the depth a hand is comfortably held, so a
 * relaxed hand is often level with the bulb and its shadow misses the stage
 * (Quest 3, Nov 15: hands counted in the lamp's light about 20% of the time).
 * Returns the magnification (surface distance over hand distance from the
 * source), or 0 when neither lands on the stage within the margin.
 */
export function reachStage(point: Vector3, out: Vector3, margin = 0.15): number {
  const t = projectToStage(point, out);
  if (t > 0 && isOnStage(out, margin)) return t;
  const e = stageRuntime.eye;
  const n = stageRuntime.normal;
  const dx = point.x - e.x;
  const dy = point.y - e.y;
  const dz = point.z - e.z;
  const denom = dx * n.x + dy * n.y + dz * n.z;
  if (denom > -1e-5) return 0;
  const c = stageRuntime.center;
  const s = ((c.x - e.x) * n.x + (c.y - e.y) * n.y + (c.z - e.z) * n.z) / denom;
  if (s < 1) return 0;
  out.set(e.x + dx * s, e.y + dy * s, e.z + dz * s);
  if (isOnStage(out, margin)) return s;
  return reachZone(point, out);
}

/**
 * The performance zone: a hand held up in front of the viewer, anywhere from a
 * little above the eyes to chest height, counts, and its place in the zone maps
 * onto the stage (raise the hand and the creature rises). The stage is at eye
 * level 2 m away, so a hand at chest height is neither in the lamp's beam nor
 * over the stage from the eyes. A hand in the lap or on the desk is below it.
 */
const ZONE = { near: 0.15, far: 0.8, side: 0.35, below: 0.4, above: 0.25 };

function reachZone(point: Vector3, out: Vector3): number {
  const e = stageRuntime.eye;
  const dx = point.x - e.x;
  const dy = point.y - e.y;
  const dz = point.z - e.z;
  const n = stageRuntime.normal;
  const forward = -(dx * n.x + dy * n.y + dz * n.z);
  if (forward < ZONE.near || forward > ZONE.far) return 0;
  const u = dx * stageRuntime.right.x + dy * stageRuntime.right.y + dz * stageRuntime.right.z;
  const v = dx * stageRuntime.up.x + dy * stageRuntime.up.y + dz * stageRuntime.up.z;
  if (Math.abs(u) > ZONE.side || v < -ZONE.below || v > ZONE.above) return 0;
  const su = (u / ZONE.side) * 0.5 * stageRuntime.width;
  const sv = ((v + ZONE.below) / (ZONE.below + ZONE.above) - 0.5) * stageRuntime.height;
  out.copy(stageRuntime.center).addScaledVector(stageRuntime.right, su).addScaledVector(stageRuntime.up, sv);
  // Size as if seen from the eyes.
  return stageRuntime.distance / forward;
}

/** True when a projected point falls on the lit stage area (with margin). */
export function isOnStage(p: Vector3, margin = 0.15): boolean {
  const c = stageRuntime.center;
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const dz = p.z - c.z;
  const u = dx * stageRuntime.right.x + dy * stageRuntime.right.y + dz * stageRuntime.right.z;
  const v = dx * stageRuntime.up.x + dy * stageRuntime.up.y + dz * stageRuntime.up.z;
  const hw = stageRuntime.width * (0.5 + margin);
  const hh = stageRuntime.height * (0.5 + margin);
  return Math.abs(u) <= hw && Math.abs(v) <= hh;
}
