/**
 * Placeholder sound, synthesised with Web Audio (no audio files, so no
 * licensing). Replace with commissioned audio later. Sounds can be placed in
 * the room (HRTF panners) so they come from where things happen: chimes from
 * the character on the wall, the click and hum from the lamp on the desk. The
 * context is created lazily; entering XR counts as the required user gesture.
 */
import { away, onAway } from './away.js';

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended' && !away.now) void ctx.resume();
  return ctx;
}

// Silence the lamp hum and effects while the player is away (Quest menu, headset off).
onAway((isAway) => {
  if (!ctx) return;
  if (isAway) void ctx.suspend().catch(() => undefined);
  else void ctx.resume().catch(() => undefined);
});

/** Creates (and asks to resume) the audio context, so music can start before the first sound effect. */
export function wakeAudio(): void {
  audio();
}

/**
 * A recorded voice through a gain node, so it can be faded where an audio
 * element's volume does nothing (iOS) and muted without being paused (a paused
 * element may not start again without a tap on iOS). Null when the audio
 * context is not running yet: then the element plays on its own.
 */
export function voiceGain(el: HTMLMediaElement): GainNode | null {
  const a = audio();
  if (!a || a.state !== 'running') return null;
  try {
    const gain = a.createGain();
    a.createMediaElementSource(el).connect(gain).connect(a.destination);
    return gain;
  } catch {
    return null;
  }
}

/** True once the browser lets audio play (after a user gesture such as entering XR). */
export function audioRunning(): boolean {
  return ctx?.state === 'running';
}

/**
 * Sound waits for a user gesture. Entering XR from the browser's own prompt (not
 * the page's Enter XR button) is not one, so the Quest Browser kept every sound,
 * the narrator too, silent until the first pinch (Quest 3S, Nov 15: 50 s of
 * silence). `blocked`: a line could not play; the story asks for a pinch.
 * `waived`: no pinch came, so the story goes on with captions only.
 */
export const soundLock = { blocked: false, waived: false };
const gestureListeners = new Set<() => void>();

/** Run `fn` inside each user gesture (a pinch, a tap, a key), while sound may start. */
export function onGesture(fn: () => void): () => void {
  gestureListeners.add(fn);
  return () => gestureListeners.delete(fn);
}

/** A user gesture: start the audio context and let anything waiting for one play now. */
export function gesture(): void {
  wakeAudio();
  soundLock.blocked = false;
  for (const fn of gestureListeners) fn();
}

/** The audio context's state for diagnostics: 'none' before it exists, then suspended, running or closed. */
export function audioState(): string {
  return ctx?.state ?? 'none';
}

/**
 * Placed sounds keep their full level out to this distance (m) and only then
 * fall off. The stage is on a wall 1.5 to 3.5 m away, so with the usual 0.6 m a
 * creature's voice came out at a fifth of its level, under the lullaby (Quest 3S,
 * Nov 15: a wall 3.3 m away, no creature heard). Direction still comes from the HRTF.
 */
const PLACED_FULL_LEVEL = 3;

/** Where a sound goes: an HRTF panner at `pos`, or straight out when unplaced. */
function output(a: AudioContext, pos?: Point3, clear = false): AudioNode {
  if (!pos) return a.destination;
  const panner = a.createPanner();
  // `clear`: left/right only and no fall-off, for creature voices (HRTF filtering dulled
  // their short high chirps on the Quest's speakers).
  panner.panningModel = clear ? 'equalpower' : 'HRTF';
  panner.distanceModel = 'inverse';
  panner.refDistance = PLACED_FULL_LEVEL;
  panner.rolloffFactor = clear ? 0 : 1;
  panner.positionX.value = pos.x;
  panner.positionY.value = pos.y;
  panner.positionZ.value = pos.z;
  panner.connect(a.destination);
  return panner;
}

function tone(freq: number, start: number, duration: number, gain: number, type: OscillatorType, pos?: Point3, clear = false): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const amp = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp).connect(output(a, pos, clear));
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/** Keep the Web Audio listener on the viewer's head. */
export function setListener(p: Point3, forward: Point3, up: Point3): void {
  if (!ctx || ctx.state !== 'running') return;
  const l = ctx.listener;
  if (l.positionX) {
    const t = ctx.currentTime;
    l.positionX.setTargetAtTime(p.x, t, 0.02);
    l.positionY.setTargetAtTime(p.y, t, 0.02);
    l.positionZ.setTargetAtTime(p.z, t, 0.02);
    l.forwardX.setTargetAtTime(forward.x, t, 0.02);
    l.forwardY.setTargetAtTime(forward.y, t, 0.02);
    l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
    l.upX.setTargetAtTime(up.x, t, 0.02);
    l.upY.setTargetAtTime(up.y, t, 0.02);
    l.upZ.setTargetAtTime(up.z, t, 0.02);
  } else {
    l.setPosition(p.x, p.y, p.z);
    l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
  }
}

/** Lamp switch click (from the lamp). */
export function playClick(pos?: Point3): void {
  tone(1800, 0, 0.03, 0.12, 'square', pos);
  tone(900, 0.012, 0.04, 0.08, 'square', pos);
}

/** Music-box chime when a creature comes alive (from the creature). */
export function playChime(pos?: Point3): void {
  tone(1046.5, 0, 0.9, 0.12, 'sine', pos);
  tone(1318.5, 0.09, 0.9, 0.1, 'sine', pos);
  tone(1568, 0.18, 1.2, 0.09, 'sine', pos);
}

/** Soft rising note when a page is added to the journal. */
export function playSoftRise(pos?: Point3): void {
  tone(523.25, 0, 0.5, 0.06, 'triangle', pos);
  tone(784, 0.12, 0.7, 0.05, 'triangle', pos);
}

const MUSIC_BOX = [659.25, 783.99, 987.77, 783.99, 880, 659.25, 587.33, 783.99];

/** One note of the placeholder Free Stage music-box loop (from the stage). */
export function playMusicBoxNote(step: number, pos?: Point3): void {
  tone(MUSIC_BOX[step % MUSIC_BOX.length], 0, 1.4, 0.035, 'sine', pos);
}

export interface Hum {
  setPosition(p: Point3): void;
  /** 0..1 lamp brightness. */
  setLevel(level: number): void;
}

/** The lamp's faint warm hum: two quiet sines through one panner at the bulb. */
export function startLampHum(): Hum | null {
  const a = audio();
  if (!a || a.state !== 'running') return null;
  const panner = output(a, { x: 0, y: 0, z: 0 }) as PannerNode;
  const amp = a.createGain();
  amp.gain.value = 0;
  amp.connect(panner);
  for (const [freq, g] of [
    [110, 1],
    [220, 0.35],
  ] as const) {
    const osc = a.createOscillator();
    const og = a.createGain();
    osc.frequency.value = freq;
    og.gain.value = g;
    osc.connect(og).connect(amp);
    osc.start();
  }
  return {
    setPosition(p) {
      const t = a.currentTime;
      panner.positionX.setTargetAtTime(p.x, t, 0.05);
      panner.positionY.setTargetAtTime(p.y, t, 0.05);
      panner.positionZ.setTargetAtTime(p.z, t, 0.05);
    },
    setLevel(level) {
      amp.gain.setTargetAtTime(0.012 * level, a.currentTime, 0.3);
    },
  };
}

// ------------------------------------------------------------------ creature voices

/** For tests: creature voices played, by shape. */
export const soundRuntime = { creature: {} as Record<string, number>, lullabyNotes: 0, lullabyLevel: 0 };

/** After the wake chime's first note, so the voice is not lost under it. */
const AFTER_CHIME = 0.45;
/** How long the lullaby dips for a creature's voice (s), and to what share. */
const DUCK_SECONDS = 1.6;
const DUCK_LEVEL = 0.25;
let duckUntil = 0;

/**
 * Each creature's little voice: a short sound file (scripts/sfx/creatures.py),
 * played like the narration, as loud as it, just after the wake chime, with the
 * lullaby dipping under it. Synthesised live (Web Audio) they were played but
 * not heard: on a Quest 3S (session xnhuwf56d6) 14 voices, and on a Quest 3
 * (xhz96jhkv9) 7 with the audio context running, none heard, while the
 * narrator's files were. Preloaded once; `quiet` for the occasional sounds while
 * a creature is awake.
 */
const CREATURE_FILES: Readonly<Record<string, string>> = {
  rabbit: 'rabbit', ears: 'rabbit', fish: 'fish', dog: 'dog', bird: 'bird', cup: 'cup',
  snail: 'snail', swan: 'swan', deer: 'deer', crocodile: 'crocodile',
  rocket: 'rocket', alien: 'alien', asteroid: 'asteroid', shark: 'shark', octopus: 'octopus', whale: 'whale',
  car: 'car', plane: 'plane', digger: 'digger', trex: 'trex', pterodactyl: 'pterodactyl',
};
const creatureAudio = new Map<string, HTMLAudioElement>();

function creatureClip(file: string): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  let el = creatureAudio.get(file);
  if (!el) {
    el = new Audio(`${import.meta.env.BASE_URL}sfx/creature-${file}.mp3`);
    el.preload = 'auto';
    creatureAudio.set(file, el);
  }
  return el;
}

/** Fetch every creature's voice ahead, so the first wake is heard at once. */
export function preloadCreatureVoices(): void {
  for (const file of new Set(Object.values(CREATURE_FILES))) creatureClip(file);
}

export function playCreature(shape: string, _pos?: Point3, quiet = false): void {
  const file = CREATURE_FILES[shape];
  if (!file) return;
  const el = creatureClip(file);
  if (!el) return;
  const voice = el.cloneNode(true) as HTMLAudioElement;
  voice.volume = quiet ? 0.55 : 1;
  window.setTimeout(() => void voice.play().catch(() => undefined), (quiet ? 0 : AFTER_CHIME) * 1000);
  const a = ctx;
  if (a) duckUntil = Math.max(duckUntil, a.currentTime + (quiet ? 0 : AFTER_CHIME) + DUCK_SECONDS);
  soundRuntime.creature[shape] = (soundRuntime.creature[shape] ?? 0) + 1;
}

// ------------------------------------------------------------------ lullaby

/** An original, gentle music-box lullaby in F, 3/4: [frequency, beats] (0 = rest). */
const LULLABY: readonly (readonly [number, number])[] = [
  [440, 1], [523.25, 1], [698.46, 1], // A C F
  [659.25, 1], [523.25, 1], [440, 1], // E C A
  [392, 1], [440, 1], [523.25, 1], // G A C
  [440, 3], // A
  [440, 1], [523.25, 1], [698.46, 1], // A C F
  [783.99, 1], [698.46, 1], [587.33, 1], // G F D
  [523.25, 1], [440, 1], [392, 1], // C A G
  [349.23, 3], // F
];
/** One soft chord per bar (root and fifth, low): F C C F F Bb C F. */
const CHORDS: readonly (readonly [number, number])[] = [
  [174.61, 261.63], [130.81, 196], [130.81, 196], [174.61, 261.63],
  [174.61, 261.63], [116.54, 174.61], [130.81, 196], [174.61, 261.63],
];
const BEAT = 60 / 66;
const LOOKAHEAD = 0.4;

export interface Lullaby {
  /** 0..1 (0 silent); changes glide over half a second. */
  setLevel(level: number): void;
}

/** The lullaby: a music box over soft chords, quietly, on a loop, through one level control. */
export function startLullaby(): Lullaby | null {
  const a = audio();
  if (!a || a.state !== 'running') return null;
  const master = a.createGain();
  master.gain.value = 0;
  master.connect(a.destination);
  let note = 0;
  let bar = 0;
  let beatInBar = 0;
  let next = a.currentTime + 0.3;
  const voice = (freq: number, t: number, dur: number, gain: number, type: OscillatorType) => {
    const osc = a.createOscillator();
    const amp = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + (type === 'sine' && dur > 2 ? 0.4 : 0.008));
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(amp).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  };
  const schedule = () => {
    if (a.state !== 'running') return;
    while (next < a.currentTime + LOOKAHEAD) {
      const [freq, beats] = LULLABY[note];
      if (beatInBar === 0) {
        const [root, fifth] = CHORDS[bar % CHORDS.length];
        voice(root, next, BEAT * 3.2, 0.05, 'sine');
        voice(fifth, next, BEAT * 3.2, 0.035, 'sine');
      }
      // Music box: a bright sine and its octave, ringing out.
      voice(freq, next, 1.8, 0.09, 'sine');
      voice(freq * 2, next, 0.7, 0.025, 'sine');
      soundRuntime.lullabyNotes++;
      next += beats * BEAT;
      beatInBar += beats;
      if (beatInBar >= 3) {
        beatInBar = 0;
        bar++;
      }
      note = (note + 1) % LULLABY.length;
    }
  };
  setInterval(schedule, 100);
  return {
    setLevel(level) {
      soundRuntime.lullabyLevel = Math.round(level * 100) / 100;
      const duck = a.currentTime < duckUntil ? DUCK_LEVEL : 1;
      master.gain.setTargetAtTime(0.5 * level * duck, a.currentTime, duck < 1 ? 0.08 : 0.25);
    },
  };
}
