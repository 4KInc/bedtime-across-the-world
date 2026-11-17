/**
 * Device-free recognition check (npm run test:recognition). Synthetic hands
 * (varied size, +/-8 deg joint-angle noise) model people; on top of that the
 * sweep adds what Quest hand tracking does to them: +/-5 mm joint jitter, an
 * occluded finger (jittering, or frozen at a resting curl) and 100 ms tracking
 * dropouts. It checks, against the same code the app runs:
 *
 *   1. accuracy per one-hand shape, per condition            target >= 95%
 *   2. negatives (resting, half-closed hands) accepted by a
 *      story request, per story shape                        target <= 10% of frames
 *   3. two-hand shapes (bird, deer, crocodile, cupped hands)  target >= 95%
 *   4. over time at 72 Hz with dropouts: every target shape
 *      triggers within 1.5 s; no negative triggers at all    target 0 false triggers
 *   5. the request gate (only requested shapes count, except in Free Stage)
 *   6. the webcam landmark mapping preserves every shape
 *
 * Synthetic hands are a model, not people: tune on real-hand data (?diag
 * sessions, the recognition lab) and use this to catch regressions.
 */
import { Vector3 } from '@iwsdk/core';
import { acceptScore, classify, computeFeatures, rescuesRequested, worldPoses } from '../../src/hand-features';
import { FIXTURES, HandPose, localJoints, toWorld } from '../../src/hand-poses';
import { classifyPair, HoldState, isHiddenPair, JointSmoother, requested, stepHold } from '../../src/recognition-rules';
import { ShapeIds } from '../../src/shadowplay-components';
import { Landmark, landmarksToJoints } from '../../src/webcam-landmarks';
import { WORLD_POSES } from '../../src/world-creatures';

const N = 40;
const TOLERANCE = 0.3;
const TARGET_ACCURACY = 0.95;
const MAX_NEGATIVE_RATE = 0.1;
const HZ = 72;
const HOLD = 0.5;
const TRIGGER_WITHIN = 1.5;

/** As in the app: a world pose (a rocket, a whale...) is read only while a story asks for it. */
function ask(label: string): void {
  worldPoses.asked.clear();
  if (WORLD_POSES.has(label)) worldPoses.asked.add(label);
}

let failed = false;
const fail = (msg: string) => {
  failed = true;
  return `${msg}  <-- below target`;
};

// ---------------------------------------------------------------- hands

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const FINGER_JOINTS = [
  [1, 2, 3, 4],
  [6, 7, 8, 9],
  [11, 12, 13, 14],
  [16, 17, 18, 19],
  [21, 22, 23, 24],
];

type Condition = 'clean' | 'jitter 5 mm' | 'occluded finger' | 'jitter + occlusion';
const CONDITIONS: Condition[] = ['clean', 'jitter 5 mm', 'occluded finger', 'jitter + occlusion'];

const R = new Vector3(1, 0, 0);
const U = new Vector3(0, 1, 0);
const NRM = new Vector3(0, 0, 1);

/** A person: a pose rendered at a size with their own joint-angle noise, in world space. */
function person(pose: HandPose, side: 'left' | 'right', s: number, salt: number, at: [number, number] = [0, 0]): Float32Array {
  const local = localJoints(pose, 0.85 + (s % 7) * 0.05, 1000 + s * 13 + salt * 101);
  return toWorld(local, side, new Vector3(at[0], at[1], 0), R, U, NRM, new Float32Array(75));
}

/**
 * What tracking does to that hand this frame. The occluded finger is chosen per
 * person: half the time it jitters (+/-12 mm), half the time it is frozen at a
 * resting curl (Quest's estimate for a finger it cannot see).
 */
function track(base: Float32Array, pose: HandPose, side: 'left' | 'right', cond: Condition, s: number, salt: number, frame: number, at: [number, number] = [0, 0]): Float32Array {
  const out = new Float32Array(base);
  const r = rng(s * 7919 + salt * 104729 + frame * 31 + 17);
  const jitter = cond === 'jitter 5 mm' || cond === 'jitter + occlusion';
  const occlude = cond === 'occluded finger' || cond === 'jitter + occlusion';
  if (occlude) {
    const pick = rng(s * 131 + salt * 7 + 3);
    const finger = 1 + Math.floor(pick() * 4);
    if (pick() < 0.5) {
      for (const j of FINGER_JOINTS[finger]) for (let k = 0; k < 3; k++) out[j * 3 + k] += (r() * 2 - 1) * 0.012;
    } else {
      const fingers = pose.fingers.map((f, i) => (i === finger - 1 ? { curl: 0.25 } : f)) as HandPose['fingers'];
      const rest = person({ ...pose, fingers }, side, s, salt, at);
      for (const j of FINGER_JOINTS[finger]) for (let k = 0; k < 3; k++) out[j * 3 + k] = rest[j * 3 + k];
    }
  }
  if (jitter) for (let i = 0; i < 75; i++) out[i] += (r() * 2 - 1) * 0.005;
  return out;
}

/** The tolerance the pipeline uses (the player's Normal setting; section 7 raises it like the story's assist). */
let tolerance = TOLERANCE;
/** The story's extra tolerance for the pair rules (section 7). */
let pairAssist = 0;

function shapeOf(joints: Float32Array, tol = tolerance): { shape: string; best: string; score: number; curl: number; features: Float32Array } {
  const f = new Float32Array(9);
  computeFeatures(joints, f);
  const r = classify(f, { id: ShapeIds.None, score: 0 });
  const shape = r.score >= acceptScore(r.id, tol) ? r.id : ShapeIds.None;
  return { shape, best: r.id, score: r.score, curl: (f[1] + f[2] + f[3] + f[4]) / 4, features: f };
}

type Frame = { shape: string; best: string; score: number; curl: number; features: Float32Array; joints: Float32Array };

/** What a request for `target` accepts from one hand's frame, as in the app: its shape, or the requested shape when it is close enough. */
function acceptedFor(frame: Frame | string | null, target: string): string {
  if (frame === null) return ShapeIds.None;
  if (typeof frame === 'string') return requested(frame, target, ShapeIds.None, ShapeIds.None, ShapeIds.None, false, false);
  const own = requested(frame.shape, target, ShapeIds.None, ShapeIds.None, ShapeIds.None, false, false);
  if (own !== ShapeIds.None) return own;
  return rescuesRequested(frame.features, { id: frame.best as never, score: frame.score }, target, tolerance, pairAssist) ? target : ShapeIds.None;
}

/** The app's per-hand pipeline: smooth the tracked joints, then classify (null while untracked). */
class HandPipeline {
  private smoother = new JointSmoother();
  step(raw: Float32Array | null): Frame | null {
    const joints = this.smoother.update(raw);
    if (!joints) return null;
    return { ...shapeOf(joints), joints: new Float32Array(joints) };
  }
}

/**
 * What a request sees from two hands, as in the app: the pair's shape if they
 * make one, otherwise each hand's own shape (a single cupped hand also answers
 * "cup your hands").
 */
function twoHands(l: Frame, r: Frame, hidden: boolean, target: string): string {
  // As in the app: a requested bird gets the looser two-hand rule.
  const pair = classifyPair(l, r, hidden, target === 'bird', pairAssist, target === 'deer', target === 'crocodile', target === 'cup');
  if (pair) return pair;
  return r.shape === target || l.shape === target ? target : ShapeIds.None;
}

/** One second of one person holding a pose through the pipeline; the shape at the end. */
function settle(base: Float32Array, pose: HandPose, side: 'left' | 'right', cond: Condition, s: number, salt: number, at: [number, number] = [0, 0], frames = HZ) {
  const p = new HandPipeline();
  let out = p.step(track(base, pose, side, cond, s, salt, 0, at))!;
  for (let i = 1; i < frames; i++) out = p.step(track(base, pose, side, cond, s, salt, i, at))!;
  return out;
}

const oneHand = FIXTURES.filter((fx) => fx.right && !fx.left && fx.label !== 'negative');
const negatives = FIXTURES.filter((fx) => fx.label === 'negative');
const pairs = FIXTURES.filter((fx) => fx.right && fx.left);
// Cupped hands as a pair: two cups side by side.
const cupPose = FIXTURES.find((fx) => fx.label === 'cup')!.right!;
const pairFixtures = [
  ...pairs.map((fx) => ({ label: fx.label, right: fx.right!, left: fx.left!, rightAt: fx.rightAt ?? [0.06, 0], leftAt: fx.leftAt ?? [-0.06, 0] })),
  { label: 'cup', right: cupPose, left: cupPose, rightAt: [0.05, 0] as [number, number], leftAt: [-0.05, 0] as [number, number] },
];
/** Shapes a story can ask for (one-hand ones are judged per hand; the rest as pairs). */
const STORY_SHAPES = ['rabbit', 'fish', 'dog', 'snail', 'swan', 'cup', 'bird', 'deer', 'crocodile'];

// ---------------------------------------------------------------- 1. accuracy

const confusions: string[] = [];
console.log(`1. One-hand accuracy over ${N} synthetic people per shape (tolerance ${TOLERANCE}):`);
console.log(`   ${'shape'.padEnd(10)}${CONDITIONS.map((c) => c.padStart(20)).join('')}`);
for (const fx of oneHand) {
  ask(fx.label);
  const cells = CONDITIONS.map((cond) => {
    let ok = 0;
    const seen: Record<string, number> = {};
    for (let s = 0; s < N; s++) {
      const base = person(fx.right!, 'right', s, FIXTURES.indexOf(fx));
      const frame = settle(base, fx.right!, 'right', cond, s, FIXTURES.indexOf(fx));
      // A world pose is read only while a story asks for it, so it is judged as the story does.
      const got = WORLD_POSES.has(fx.label) && acceptedFor(frame, fx.label) === fx.label ? fx.label : frame.shape;
      if (got === fx.label) ok++;
      else seen[got] = (seen[got] ?? 0) + 1;
    }
    const acc = ok / N;
    if (acc < TARGET_ACCURACY) confusions.push(`${fx.label} (${cond}) read as ${Object.entries(seen).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    return acc < TARGET_ACCURACY ? `${fail('')}`.replace('  <-- below target', '').concat(`${Math.round(acc * 100)}% !`).padStart(20) : `${Math.round(acc * 100)}%`.padStart(20);
  });
  console.log(`   ${fx.label.padEnd(10)}${cells.join('')}`);
}
for (const c of confusions) console.log(`   ${c}`);
ask('');

// ---------------------------------------------------------------- 2. negatives

console.log(`\n2. Negative hands (resting, half-closed) accepted when a story asks for a shape (share of frames, all conditions):`);
const negHits: Record<string, number> = {};
let negFrames = 0;
const negShapes: Record<string, number> = {};
for (const fx of negatives) {
  for (const cond of CONDITIONS) {
    for (let s = 0; s < N; s++) {
      const base = person(fx.right!, 'right', s, FIXTURES.indexOf(fx));
      const p = new HandPipeline();
      for (let i = 0; i < HZ; i++) {
        const frame = p.step(track(base, fx.right!, 'right', cond, s, FIXTURES.indexOf(fx), i))!;
        const shape = frame.shape;
        if (i < HZ / 5) continue;
        negFrames++;
        negShapes[shape] = (negShapes[shape] ?? 0) + 1;
        for (const target of STORY_SHAPES) {
          if (acceptedFor(frame, target) !== ShapeIds.None) {
            negHits[target] = (negHits[target] ?? 0) + 1;
          }
        }
      }
    }
  }
}
console.log(`   read as: ${Object.entries(negShapes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((100 * v) / negFrames)}%`).join(', ')}`);
for (const target of STORY_SHAPES) {
  const rate = (negHits[target] ?? 0) / negFrames;
  const line = `   ${target.padEnd(10)} ${(100 * rate).toFixed(1)}%`;
  console.log(rate > MAX_NEGATIVE_RATE ? fail(line) : line);
}

// ---------------------------------------------------------------- 3. pairs


console.log(`\n3. Two-hand accuracy (${N} people per shape):`);
console.log(`   ${'shape'.padEnd(10)}${CONDITIONS.map((c) => c.padStart(20)).join('')}`);
for (const fx of pairFixtures) {
  const hidden = isHiddenPair(fx.label);
  const cells = CONDITIONS.map((cond) => {
    let ok = 0;
    for (let s = 0; s < N; s++) {
      const salt = 50 + pairFixtures.indexOf(fx);
      const rb = person(fx.right, 'right', s, salt, fx.rightAt);
      const lb = person(fx.left, 'left', s, salt + 9, fx.leftAt);
      const r = settle(rb, fx.right, 'right', cond, s, salt, fx.rightAt);
      const l = settle(lb, fx.left, 'left', cond, s, salt + 9, fx.leftAt);
      if (twoHands(l, r, hidden, fx.label) === fx.label) ok++;
      else if (process.env.SWEEP_DEBUG && fx.label === process.env.SWEEP_DEBUG)
        console.log(`     miss ${cond} #${s}: L ${l.shape}/${l.best} curl ${l.curl.toFixed(2)} thumb ${l.features[0].toFixed(2)} touch ${l.features[6].toFixed(2)} f ${Array.from(l.features.slice(1,5)).map((x) => x.toFixed(2)).join(",")} | R ${r.shape}/${r.best} curl ${r.curl.toFixed(2)} thumb ${r.features[0].toFixed(2)}`);
    }
    const acc = ok / N;
    return acc < TARGET_ACCURACY ? `${fail('')}`.replace('  <-- below target', '').concat(`${Math.round(acc * 100)}% !`).padStart(20) : `${Math.round(acc * 100)}%`.padStart(20);
  });
  console.log(`   ${fx.label.padEnd(10)}${cells.join('')}`);
}

// ---------------------------------------------------------------- 4. over time

/** Tracking drops the hand for 100 ms about every second. */
const dropped = (i: number) => {
  const t = (i / HZ) % 1;
  return t > 0.85 && t < 0.95;
};

/** When the request first triggers in a 3 s sequence of accepted-shape frames (null if never). */
function triggerTime(shapes: (Frame | string | null)[], target: string): number | null {
  const state: HoldState = { candidate: ShapeIds.None, sinceMatch: 0 };
  let held = 0;
  const dt = 1 / HZ;
  for (let i = 0; i < shapes.length; i++) {
    const accepted = acceptedFor(shapes[i], target);
    held = stepHold(state, held, accepted, dt);
    if (held >= HOLD) return i * dt;
  }
  return null;
}

/** 3 s of one hand through the pipeline, with dropouts. */
function oneHandFrames(base: Float32Array, pose: HandPose, cond: Condition, s: number, salt: number): (Frame | null)[] {
  const p = new HandPipeline();
  return Array.from({ length: HZ * 3 }, (_, i) => (dropped(i) ? (p.step(null), null) : p.step(track(base, pose, 'right', cond, s, salt, i))!));
}

/** 3 s of two hands through the pipeline, with dropouts (both hands drop together). */
function pairFrames(
  rb: Float32Array, rPose: HandPose, rAt: [number, number],
  lb: Float32Array, lPose: HandPose, lAt: [number, number],
  cond: Condition, s: number, salt: number, hidden: boolean, target: string,
): string[] {
  const pr = new HandPipeline();
  const pl = new HandPipeline();
  return Array.from({ length: HZ * 3 }, (_, i) => {
    if (dropped(i)) {
      pr.step(null);
      pl.step(null);
      return ShapeIds.None;
    }
    const r = pr.step(track(rb, rPose, 'right', cond, s, salt, i, rAt))!;
    const l = pl.step(track(lb, lPose, 'left', cond, s, salt + 9, i, lAt))!;
    return twoHands(l, r, hidden, target);
  });
}

console.log(`\n4. Over time (3 s at ${HZ} Hz, jitter + occlusion, 100 ms dropouts, hold ${HOLD} s):`);
const cond: Condition = 'jitter + occlusion';
for (const fx of oneHand.filter((f) => STORY_SHAPES.includes(f.label) || WORLD_POSES.has(f.label))) {
  ask(fx.label);
  const salt = FIXTURES.indexOf(fx);
  let ok = 0;
  let total = 0;
  for (let s = 0; s < N; s++) {
    const t = triggerTime(oneHandFrames(person(fx.right!, 'right', s, salt), fx.right!, cond, s, salt), fx.label);
    if (t !== null && t <= TRIGGER_WITHIN) {
      ok++;
      total += t;
    }
  }
  const line = `   ${fx.label.padEnd(10)} triggers ${ok}/${N}, mean ${(total / Math.max(1, ok)).toFixed(2)} s`;
  console.log(ok / N < TARGET_ACCURACY ? fail(line) : line);
}
ask('');
for (const fx of pairFixtures) {
  const salt = 50 + pairFixtures.indexOf(fx);
  let ok = 0;
  for (let s = 0; s < N; s++) {
    const frames = pairFrames(
      person(fx.right, 'right', s, salt, fx.rightAt), fx.right, fx.rightAt,
      person(fx.left, 'left', s, salt + 9, fx.leftAt), fx.left, fx.leftAt,
      cond, s, salt, isHiddenPair(fx.label), fx.label,
    );
    const t = triggerTime(frames, fx.label);
    if (t !== null && t <= TRIGGER_WITHIN) ok++;
  }
  const line = `   ${fx.label.padEnd(10)} triggers ${ok}/${N} (pair)`;
  console.log(ok / N < TARGET_ACCURACY ? fail(line) : line);
}
// A real-hands bird (Quest 3, Nov 14): fingers a little relaxed and wrists a bit
// further apart. The strict rule misses it; asked for, the bird rule takes it.
{
  const relaxed: HandPose = { fingers: [{ curl: 0.22 }, { curl: 0.22 }, { curl: 0.22 }, { curl: 0.22 }], spread: 14, thumb: 'out', roll: -90 };
  const at: [[number, number], [number, number]] = [[0.12, 0], [-0.12, 0]];
  let asked = 0;
  let strict = 0;
  for (let s = 0; s < N; s++) {
    const salt = 90;
    const rb = person(relaxed, 'right', s, salt, at[0]);
    const lb = person(relaxed, 'left', s, salt + 9, at[1]);
    if (triggerTime(pairFrames(rb, relaxed, at[0], lb, relaxed, at[1], cond, s, salt, false, 'bird'), 'bird') !== null) asked++;
    if (triggerTime(pairFrames(rb, relaxed, at[0], lb, relaxed, at[1], cond, s, salt, false, 'none'), 'bird') !== null) strict++;
  }
  const line = `   relaxed bird (wrists 24 cm, fingers relaxed): asked for ${asked}/${N}, strict rule ${strict}/${N}`;
  console.log(asked / N < TARGET_ACCURACY ? fail(line) : line);
}
// Antlers as real hands made them (Quest 3S, Nov 15): index and middle up and spread, the
// others folded (each hand reads as a rabbit). Asked for, after the story's first assist
// (15 s), that is a deer; not before, not in Free Stage, and not when a rabbit is asked for
// (the rabbit request still gets its rabbit).
{
  const vee: HandPose = { fingers: [{ curl: 0.08 }, { curl: 0.08 }, { curl: 0.95 }, { curl: 0.95 }], spread: 25, thumb: { touch: 19 } };
  const at: [[number, number], [number, number]] = [[0.13, 0], [-0.13, 0]];
  const run = (target: string, hidden: boolean, want: string, assist = 0.1) => {
    pairAssist = assist;
    let n = 0;
    for (let s = 0; s < N; s++) {
      const salt = 98;
      const rb = person(vee, 'right', s, salt, at[0]);
      const lb = person(vee, 'left', s, salt + 9, at[1]);
      if (triggerTime(pairFrames(rb, vee, at[0], lb, vee, at[1], cond, s, salt, hidden, target), want) !== null) n++;
    }
    return n;
  };
  const before = run('deer', true, 'deer', 0);
  const asked = run('deer', true, 'deer');
  const free = run('none', true, 'deer');
  const rabbit = run('rabbit', false, 'deer');
  const stillRabbit = run('rabbit', false, 'rabbit');
  pairAssist = 0;
  const line = `   two-finger antlers (index + middle up, wrists 26 cm): deer asked, after 15 s ${asked}/${N} (at once ${before}/${N}); deer in Free Stage ${free}/${N}, when a rabbit is asked ${rabbit}/${N} (rabbit still ${stillRabbit}/${N})`;
  console.log(asked / N < TARGET_ACCURACY || free > 0 || rabbit > 0 || stillRabbit / N < TARGET_ACCURACY ? fail(line) : line);
}
// Cupped hands as real hands made them (Quest 3S, Nov 15): held together edge to edge,
// palms up, fingers only a little bent, each hand read as a flat fish. Asked for, that is
// a cup; not asked, it stays what it was; palms down or fists together are never a cup.
{
  const together: HandPose = { fingers: [{ curl: 0.22 }, { curl: 0.22 }, { curl: 0.25 }, { curl: 0.28 }], spread: 4, thumb: 'half' };
  const fist: HandPose = { fingers: [{ curl: 1 }, { curl: 1 }, { curl: 1 }, { curl: 1 }], spread: 0, thumb: 'across' };
  // Palms up, fingers pointing at the wall (-Z): local X to -X, Y to -Z, the palm (local -Z) to +Y.
  const UP_R = new Vector3(-1, 0, 0);
  const UP_U = new Vector3(0, 0, -1);
  const UP_N = new Vector3(0, -1, 0);
  // Palms down: the palm to -Y.
  const DOWN_R = new Vector3(1, 0, 0);
  const DOWN_N = new Vector3(0, 1, 0);
  const cupCond: Condition = 'jitter 5 mm';
  const frames = (pose: HandPose, up: boolean, target: string, s: number, salt: number) => {
    const hand = (side: 'left' | 'right', x: number, sd: number) =>
      toWorld(localJoints(pose, 0.85 + (s % 7) * 0.05, 1000 + s * 13 + sd * 101), side, new Vector3(x, 0, 0), up ? UP_R : DOWN_R, UP_U, up ? UP_N : DOWN_N, new Float32Array(75));
    const rb = hand('right', 0.03, salt);
    const lb = hand('left', -0.03, salt + 9);
    const pr = new HandPipeline();
    const pl = new HandPipeline();
    return Array.from({ length: HZ * 3 }, (_, i) => {
      const r = pr.step(track(rb, pose, 'right', cupCond, s, salt, i))!;
      const l = pl.step(track(lb, pose, 'left', cupCond, s, salt + 9, i))!;
      return twoHands(l, r, false, target);
    });
  };
  const count = (pose: HandPose, up: boolean, target: string, salt: number) => {
    let n = 0;
    for (let s = 0; s < N; s++) if (triggerTime(frames(pose, up, target, s, salt), 'cup') !== null) n++;
    return n;
  };
  const asked = count(together, true, 'cup', 95);
  const notAsked = count(together, true, 'none', 95);
  const down = count(together, false, 'cup', 96);
  const fists = count(fist, true, 'cup', 97);
  const line = `   cup with hands together, palms up (wrists 6 cm, fingers a little bent): asked for ${asked}/${N}, not asked ${notAsked}/${N}; palms down ${down}/${N}, fists ${fists}/${N}`;
  console.log(asked / N < TARGET_ACCURACY || notAsked > 0 || down > 0 || fists > 0 ? fail(line) : line);
}
// A real-hands crocodile (Quest 3, Nov 15): jaws of curled fingers, stacked about 15 cm with
// the hands a little apart sideways. Counts when a crocodile is asked for, and is never taken
// for a bird or a deer (two curled hands together may answer "cup your hands", as they should).
{
  const croc = FIXTURES.find((fx) => fx.label === 'crocodile')!;
  const curled = (p: HandPose): HandPose => ({ ...p, fingers: p.fingers.map(() => ({ curl: 0.5 })) as HandPose['fingers'] });
  const rp = curled(croc.right!);
  const lp = curled(croc.left!);
  const ra: [number, number] = [0.07, 0.075];
  const la: [number, number] = [-0.07, -0.075];
  let asked = 0;
  let other = 0;
  for (let s = 0; s < N; s++) {
    const salt = 95;
    const rb = person(rp, 'right', s, salt, ra);
    const lb = person(lp, 'left', s, salt + 9, la);
    if (triggerTime(pairFrames(rb, rp, ra, lb, lp, la, cond, s, salt, true, 'crocodile'), 'crocodile') !== null) asked++;
    for (const target of ['bird', 'deer']) {
      if (triggerTime(pairFrames(rb, rp, ra, lb, lp, la, cond, s, salt, true, target), target) !== null) other++;
    }
  }
  const line = `   curled crocodile (stacked 15 cm, 14 cm apart sideways): asked for ${asked}/${N}, read as a bird or deer ${other}/${N * 2}`;
  console.log(asked / N < TARGET_ACCURACY || other > 0 ? fail(line) : line);
}
let falseTriggers = 0;
const falseBy: Record<string, number> = {};
for (const fx of negatives) {
  const salt = FIXTURES.indexOf(fx);
  for (let s = 0; s < N; s++) {
    const frames = oneHandFrames(person(fx.right!, 'right', s, salt), fx.right!, cond, s, salt);
    for (const target of STORY_SHAPES) {
      if (triggerTime(frames, target) !== null) {
        falseTriggers++;
        falseBy[target] = (falseBy[target] ?? 0) + 1;
      }
    }
  }
}
// Two resting hands side by side, both in the light, when a story asks for a two-hand shape.
for (const fx of negatives) {
  const salt = 70 + FIXTURES.indexOf(fx);
  for (let s = 0; s < N; s++) {
    for (const target of ['cup', 'bird', 'deer', 'crocodile']) {
      const frames = pairFrames(
        person(fx.right!, 'right', s, salt, [0.05, 0]), fx.right!, [0.05, 0],
        person(fx.right!, 'left', s, salt + 9, [-0.05, 0]), fx.right!, [-0.05, 0],
        cond, s, salt, true, target,
      );
      if (triggerTime(frames, target) !== null) {
        falseTriggers++;
        falseBy[`${target} (pair)`] = (falseBy[`${target} (pair)`] ?? 0) + 1;
      }
    }
  }
}
const ftLine = `   negatives: ${falseTriggers} false triggers over ${negatives.length * N * 2} sequences x their requests${falseTriggers ? ' ' + JSON.stringify(falseBy) : ''}`;
console.log(falseTriggers ? fail(ftLine) : ftLine);

// ---------------------------------------------------------------- 7. real-hand variations

/**
 * Real hands are not the drawn poses: fingers rest a little bent (or a curled
 * finger opens), the hand tilts, fingers spread differently, two hands sit
 * further apart. Each story shape, varied like that, over time (jitter +
 * occlusion + dropouts), at the player's Normal tolerance and at the story's
 * assist levels (20 s and 40 s waits). Report only; see the targets below.
 */
type Variant = { name: string; pose: (p: HandPose) => HandPose; apart?: number };
const relax = (p: HandPose): HandPose => ({
  ...p,
  fingers: p.fingers.map((x) => ({ curl: x.curl < 0.2 ? x.curl + 0.15 : x.curl > 0.8 ? x.curl - 0.2 : x.curl })) as HandPose['fingers'],
});
const VARIANTS: Variant[] = [
  { name: 'as drawn', pose: (p) => p },
  { name: 'relaxed', pose: relax },
  { name: 'tilted +25', pose: (p) => ({ ...p, roll: (p.roll ?? 0) + 25 }) },
  { name: 'tilted -25', pose: (p) => ({ ...p, roll: (p.roll ?? 0) - 25 }) },
  { name: 'spread +8', pose: (p) => ({ ...p, spread: (p.spread ?? 0) + 8 }) },
  { name: 'relaxed + tilted', pose: (p) => relax({ ...p, roll: (p.roll ?? 0) + 20 }) },
  { name: 'apart +6 cm', pose: (p) => p, apart: 0.03 },
];
const LEVELS: [string, number, number][] = [['Normal', TOLERANCE, 0], ['15 s', TOLERANCE + 0.1, 0.1], ['30 s', TOLERANCE + 0.2, 0.2]];
const NV = 20;
console.log(`\n7. Real-hand variations (triggers within ${TRIGGER_WITHIN} s, of ${NV}; Normal / after 15 s / after 30 s):`);
const realRows: { shape: string; variant: string; rates: number[] }[] = [];
for (const fx of [...oneHand.filter((f) => STORY_SHAPES.includes(f.label)).map((f) => ({ label: f.label, right: f.right!, left: null as HandPose | null, rightAt: [0, 0] as [number, number], leftAt: [0, 0] as [number, number] })), ...pairFixtures]) {
  for (const v of VARIANTS) {
    if (v.apart && !fx.left) continue;
    const rates = LEVELS.map(([, tol, assist]) => {
      tolerance = tol;
      pairAssist = assist;
      let ok = 0;
      for (let s = 0; s < NV; s++) {
        const salt = 200 + VARIANTS.indexOf(v) * 7;
        const rp = v.pose(fx.right);
        let frames: (Frame | string | null)[];
        if (fx.left) {
          const lp = v.pose(fx.left);
          const ra: [number, number] = [fx.rightAt[0] + (v.apart ?? 0), fx.rightAt[1]];
          const la: [number, number] = [fx.leftAt[0] - (v.apart ?? 0), fx.leftAt[1]];
          frames = pairFrames(person(rp, 'right', s, salt, ra), rp, ra, person(lp, 'left', s, salt + 9, la), lp, la, cond, s, salt, isHiddenPair(fx.label), fx.label);
        } else frames = oneHandFrames(person(rp, 'right', s, salt), rp, cond, s, salt);
        const t = triggerTime(frames, fx.label);
        if (t !== null && t <= TRIGGER_WITHIN) ok++;
      }
      return ok / NV;
    });
    realRows.push({ shape: `${fx.label}${fx.left ? ' (pair)' : ''}`, variant: v.name, rates });
  }
}
tolerance = TOLERANCE;
pairAssist = 0;
for (const r of realRows) {
  const cells = r.rates.map((x) => `${Math.round(x * 100)}%`.padStart(7)).join('');
  console.log(`   ${r.shape.padEnd(18)}${r.variant.padEnd(18)}${cells}${r.rates[2] < 0.9 ? '   <-- weak even after 30 s' : r.rates[0] < 0.75 ? '   <-- weak at Normal' : ''}`);
}

// ---------------------------------------------------------------- 5. the gate

const gate: [string, boolean][] = [
  ['requested shape is accepted', requested('rabbit', 'rabbit', 'none', 'none', 'none', false, false) === 'rabbit'],
  ['its alternative is accepted', requested('ears', 'rabbit', 'ears', 'none', 'none', false, false) === 'rabbit'],
  ['another shape is ignored in the story', requested('dog', 'rabbit', 'ears', 'none', 'none', false, false) === 'none'],
  ['nothing counts when nothing is asked', requested('fish', 'none', 'none', 'none', 'none', false, false) === 'none'],
  ['Free Stage accepts any creature', requested('swan', 'none', 'none', 'none', 'none', true, false) === 'swan'],
  ['Free Stage never accepts cup or fist', requested('cup', 'none', 'none', 'none', 'none', true, false) === 'none' && requested('fist', 'none', 'none', 'none', 'none', true, false) === 'none'],
  ['Free Stage: a fist is the asteroid once it is met, a rocket the rocket', requested('fist', 'none', 'none', 'none', 'none', true, false, new Set(['asteroid'])) === 'asteroid' && requested('rocket', 'none', 'none', 'none', 'none', true, false, new Set(['rocket'])) === 'rocket'],
  ['one-hand mode: an open hand is a bird in Free Stage', requested('open', 'none', 'none', 'none', 'none', true, true) === 'bird'],
  ['one-hand mode: an open hand is the bird a story asks for', requested('open', 'bird', 'none', 'none', 'none', false, true) === 'bird'],
  ['one-hand mode: an open hand picks the bird in a dog-or-bird choice', requested('open', 'dog', 'none', 'bird', 'none', false, true) === 'bird'],
  ['one-hand mode: an open hand is nothing when the story asks for another shape', requested('open', 'rabbit', 'ears', 'none', 'none', false, true) === 'none'],
  ['without one-hand mode an open hand is not a bird', requested('open', 'bird', 'none', 'none', 'none', false, false) === 'none'],
  // World creatures that borrow a pose (world-creatures.ts).
  ['a T. rex is made with the crocodile\'s jaws', requested('crocodile', 'trex', 'none', 'none', 'none', false, false) === 'trex'],
  ['an octopus also takes a hanging hand read as cupped (its alt), but only while an octopus is asked for', requested('cup', 'octopus', 'cup', 'none', 'none', false, false) === 'octopus' && requested('cup', 'octopus', 'none', 'none', 'none', false, false) === 'none'],
  ['a digger also takes a scooped hand (its alt, the cup), but only while a digger is asked for', requested('cup', 'digger', 'cup', 'none', 'none', false, false) === 'digger' && requested('cup', 'digger', 'none', 'none', 'none', false, false) === 'none' && requested('cup', 'car', 'none', 'none', 'none', false, false) === 'none'],
  ['a car with the snail\'s two fingers, a digger with the swan\'s wrist', requested('snail', 'car', 'none', 'none', 'none', false, false) === 'car' && requested('swan', 'digger', 'none', 'none', 'none', false, false) === 'digger'],
  ['an asteroid with a fist, a pterodactyl with the bird', requested('fist', 'asteroid', 'none', 'none', 'none', false, false) === 'asteroid' && requested('bird', 'pterodactyl', 'none', 'none', 'none', false, false) === 'pterodactyl'],
  ['one-hand mode: an open hand is the pterodactyl a story asks for', requested('open', 'pterodactyl', 'none', 'none', 'none', false, true) === 'pterodactyl'],
  ['a T. rex is a hidden pair (asked for, the crocodile rule reads it)', isHiddenPair('trex')],
  ['a crocodile is not a T. rex, nor a snail a car, unless asked', requested('crocodile', 'car', 'none', 'none', 'none', false, false) === 'none' && requested('snail', 'none', 'none', 'none', 'none', true, false) === 'snail'],
];
console.log('\n5. Request gate:');
for (const [name, ok] of gate) console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ((failed = true), '')}`);

// ---------------------------------------------------------------- 6. webcam mapping

// Hand-local (right, up, normal) -> MediaPipe image axes (-x, -y, z) and back.
const WX_FOR_MP = [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24];
let mapped = 0;
let mappedOk = 0;
for (const fx of oneHand) {
  ask(fx.label);
  const local = localJoints(fx.right!, 1, 37);
  const flat = new Float32Array(75);
  local.forEach((p, i) => flat.set(p, i * 3));
  const mp: Landmark[] = WX_FOR_MP.map((j) => ({ x: -local[j][0], y: -local[j][1], z: local[j][2] }));
  const joints = landmarksToJoints(mp, new Vector3(), R, U, NRM, new Float32Array(75));
  mapped++;
  if (shapeOf(joints).shape === shapeOf(flat).shape) mappedOk++;
}
ask('');
console.log(`\n6. Webcam mapping preserves the classification for ${mappedOk}/${mapped} shapes.`);
if (mappedOk !== mapped) failed = true;

// ---------------------------------------------------------------- 8. world poses

// A world pose (world-creatures.ts) asked for: resting hands, and every other one-hand shape
// held for 3 s, must not wake it (at Normal, before the story's assist). Not asked, it is never read.
console.log(`\n8. World poses asked for: other hands that wake it (3 s, jitter + occlusion, of ${N} people each):`);
for (const pose of WORLD_POSES) {
  ask(pose);
  const steals: string[] = [];
  let worst = 0;
  const own = JSON.stringify(FIXTURES.find((f) => f.label === pose)!.right);
  // Every other shape a child knows, and the resting hands (not the pointing hand when the rocket is the point).
  // A fist is a rocket when tracking loses its index finger and holds it half open (Quest's guess for a
  // finger it cannot see): that is a pointing finger, and only ever while a rocket is asked for.
  const others = [...oneHand.filter((f) => !WORLD_POSES.has(f.label) && !(pose === 'rocket' && f.label === 'fist')), ...negatives.filter((f) => JSON.stringify(f.right) !== own)];
  for (const fx of others) {
    const salt = FIXTURES.indexOf(fx);
    let n = 0;
    for (let s = 0; s < N; s++) if (triggerTime(oneHandFrames(person(fx.right!, 'right', s, salt), fx.right!, cond, s, salt), pose) !== null) n++;
    if (n > 0) steals.push(`${fx.label} ${n}`);
    worst = Math.max(worst, n / N);
  }
  const line = `   ${pose.padEnd(10)} ${steals.length ? steals.join(', ') : 'none'}`;
  console.log(worst > MAX_NEGATIVE_RATE ? fail(line) : line);
}
ask('');
{
  // Not asked for: no hand is ever read as a world pose.
  let read = 0;
  for (const fx of oneHand) {
    const salt = FIXTURES.indexOf(fx);
    for (let s = 0; s < 10; s++) if (WORLD_POSES.has(settle(person(fx.right!, 'right', s, salt), fx.right!, 'right', 'clean', s, salt).best)) read++;
  }
  const line = `   not asked for, hands read as a world pose: ${read}`;
  console.log(read > 0 ? fail(line) : line);
}

// ---------------------------------------------------------------- 9. Free Stage, worlds met

// Free Stage once every world creature has been met (all of them in the Shadow Journal): every
// one-hand pose wakes its own creature (all world poses read at once now), and resting hands do
// not wake a world creature. With none met, nothing new comes (a fist stays nothing).
{
  const met: ReadonlySet<string> = new Set(['rocket', 'alien', 'asteroid', 'shark', 'octopus', 'whale', 'plane']);
  const free = (shape: string, m: ReadonlySet<string> = met) => requested(shape, 'none', 'none', 'none', 'none', true, false, m);
  worldPoses.asked.clear();
  for (const pose of WORLD_POSES) worldPoses.asked.add(pose);
  /** The creature that wakes first in 3 s of frames, as the app's hold does (none if none does). */
  const firstAwake = (frames: (Frame | null)[]): string => {
    const state: HoldState = { candidate: ShapeIds.None, sinceMatch: 0 };
    let held = 0;
    for (const f of frames) {
      held = stepHold(state, held, f ? free(f.shape) : ShapeIds.None, 1 / HZ);
      if (held >= HOLD) return state.candidate;
    }
    return ShapeIds.None;
  };
  // Judged with clean and jittered hands. With a hidden finger (Quest guesses it half open) some
  // poses are another's: a fist hiding its index finger is a pointing finger (the rocket), a
  // rocket hiding its middle finger two fingers up (the rabbit). In a story only the shape asked
  // for counts, so that does not happen there (section 8); in Free Stage it can, so it is reported.
  const JUDGED: Condition[] = ['clean', 'jitter 5 mm', 'jitter + occlusion'];
  console.log(`\n9. Free Stage with every world met: the first creature to wake (3 s with dropouts, of ${N} people each; ${JUDGED.join(' / ')}, the last reported only):`);
  const pointing = JSON.stringify(FIXTURES.find((f) => f.label === 'rocket')!.right);
  for (const fx of oneHand) {
    const want = free(fx.label);
    if (want === ShapeIds.None) continue;
    const salt = FIXTURES.indexOf(fx);
    const seen: Record<string, number> = {};
    const rates = JUDGED.map((c) => {
      let ok = 0;
      for (let s = 0; s < N; s++) {
        const got = firstAwake(oneHandFrames(person(fx.right!, 'right', s, salt), fx.right!, c, s, salt));
        if (got === want) ok++;
        else if (c === 'jitter + occlusion') seen[got] = (seen[got] ?? 0) + 1;
      }
      return ok / N;
    });
    const line = `   ${fx.label.padEnd(10)} ${rates.map((r) => `${Math.round(r * 100)}%`.padStart(6)).join('')}${Object.keys(seen).length ? `  (hidden finger: ${Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`;
    console.log(Math.min(rates[0], rates[1]) < TARGET_ACCURACY ? fail(line) : line);
  }
  // Resting hands (not the pointing hand: that is the rocket's own pose).
  let frames = 0;
  const woke: Record<string, number> = {};
  for (const fx of negatives.filter((f) => JSON.stringify(f.right) !== pointing)) {
    const salt = FIXTURES.indexOf(fx);
    for (let s = 0; s < N; s++) {
      const p = new HandPipeline();
      const base = person(fx.right!, 'right', s, salt);
      for (let i = 0; i < HZ; i++) {
        const frame = p.step(track(base, fx.right!, 'right', cond, s, salt, i))!;
        if (i < HZ / 5) continue;
        frames++;
        const got = free(frame.shape);
        if (met.has(got)) woke[got] = (woke[got] ?? 0) + 1;
      }
    }
  }
  const worst = Math.max(0, ...Object.values(woke)) / frames;
  const restLine = `   resting hands read as a world creature: ${Object.keys(woke).length ? Object.entries(woke).map(([k, v]) => `${k} ${((100 * v) / frames).toFixed(1)}%`).join(', ') : 'none'}`;
  console.log(worst > MAX_NEGATIVE_RATE ? fail(restLine) : restLine);
  worldPoses.asked.clear();
  const none = ['fist', ...WORLD_POSES].every((sh) => free(sh, new Set()) === ShapeIds.None);
  console.log(`   ${none ? 'ok  ' : 'FAIL'} none met: a fist and the world poses are nothing${none ? '' : ((failed = true), '')}`);
}

console.log(failed ? '\nRECOGNITION TARGETS NOT MET' : '\nAll recognition targets met.');
process.exit(failed ? 1 : 0);
