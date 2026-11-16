import { createSystem, Entity, VisibilityState } from '@iwsdk/core';
import { away } from './away.js';
import { playClick } from './sfx.js';
import {
  Hands,
  LiveSession,
  PerformanceRecorder,
  Settings,
  ShadowJournal,
  ShapeRecognizer,
  Stage,
  StoryState,
  ToleranceLevels,
} from './shadowplay-components.js';
import { accessRuntime, gazeTargets, stageRuntime } from './stage-runtime.js';
import { dreamRuntime } from './settings.js';
import { describe, parseCommand, type VoiceCommand } from './voice-commands.js';
import { downsample, encodeWav, joinParts, PcmRing } from './voice-clip.js';

/** Speech onset: louder than this (RMS, 0-1) for ONSET_SECONDS starts a clip. */
const SPEECH_RMS = 0.025;
const ONSET_SECONDS = 0.06;
/** A clip ends after this much quiet, or at MAX_CLIP_SECONDS; shorter than MIN_CLIP_SECONDS is a noise. */
const END_SILENCE_SECONDS = 0.6;
/** Long enough for a story asked for in plain words ("I need a forest story with a dog and a rabbit"). */
const MAX_CLIP_SECONDS = 6;
const MIN_CLIP_SECONDS = 0.25;

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
};
type RecognitionClass = new () => Recognition;

function recognitionClass(): RecognitionClass | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/**
 * Voice commands (accessibility): spoken alternatives for the hand
 * interactions, while the setting is on in the headset. Say a shape's name
 * when the story asks for it, "open the journal", "pause", "continue",
 * "go on" (for beats that ask the hands to move), "move stage here", or the
 * name of a panel button.
 *
 * Listening uses the browser's own speech recognition where it has one;
 * otherwise, if the server offers it (/api/voice), each short spoken phrase
 * is recorded on its own (a simple loudness check finds where it starts and
 * ends) and sent to be understood. The microphone is open only while Voice
 * commands is on, and commands are ignored while a story is being recorded
 * with voice or a live Talk is on (that speech is for the family).
 */
/**
 * For diagnostics (diag-system.ts) and tests: how voice commands are going. Counts
 * only, never the words or the audio. Clips are pieces of speech sent to the
 * server (`short` ones were too short to send); each comes back understood
 * (words), empty (nothing understood) or failed. Words heard are acted on,
 * refused (not now), not a command, or ignored (speech for the family, or a story idea).
 */
export const voiceRuntime = {
  audio: '' as string,
  resumes: 0,
  short: 0,
  clips: 0,
  understood: 0,
  empty: 0,
  failed: 0,
  acted: 0,
  refused: 0,
  notCommands: 0,
  ignored: 0,
};

export class VoiceControlSystem extends createSystem({
  settings: { required: [Settings] },
  stories: { required: [StoryState] },
  stages: { required: [Stage] },
  journals: { required: [ShadowJournal] },
  recorders: { required: [PerformanceRecorder] },
  lives: { required: [LiveSession] },
}) {
  private wanted = false;
  private recognition: Recognition | null = null;
  private stream: MediaStream | null = null;
  private audio: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples = new Float32Array(1024);
  /** Raw microphone audio (voice-clip.ts): the last half second always kept; a clip starts with it. */
  private capture: ScriptProcessorNode | null = null;
  private ring: PcmRing | null = null;
  private clipParts: Float32Array[] | null = null;
  private loud = 0;
  private quiet = 0;
  private clipTime = 0;
  /** Bumped by every start/stop: late async results from an old engine are dropped. */
  private generation = 0;

  init(): void {
    this.cleanupFuncs.push(() => this.stopListening());
  }

  /** A resume of the microphone's audio is under way. */
  private resuming = false;

  update(delta: number): void {
    // The headset can suspend the microphone's audio (Quest menu, headset off); it then hears only silence. Wake it.
    if (this.audio?.state === 'suspended' && !away.now && !this.resuming) {
      this.resuming = true;
      voiceRuntime.resumes++;
      void this.audio
        .resume()
        .catch(() => undefined)
        .finally(() => (this.resuming = false));
    }
    voiceRuntime.audio = this.audio?.state ?? '';
    const settings = this.queries.settings.entities.values().next().value as Entity | undefined;
    const on = Boolean(settings?.getValue(Settings, 'voiceCommands')) && this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (on !== this.wanted) {
      this.wanted = on;
      if (on) this.startListening();
      else this.stopListening();
    }
    if (this.analyser) this.listen(delta);
  }

  /** Speech meant for the family (recording with voice, or Talk in a live story), or a story idea, is not a command. */
  private suspended(): boolean {
    // "Say your idea" is listening for a story idea: that is not a command either.
    if (dreamRuntime.wish.state === 'listening') return true;
    for (const r of this.queries.recorders.entities) {
      if (r.getValue(PerformanceRecorder, 'recording') && r.getValue(PerformanceRecorder, 'withVoice')) return true;
    }
    for (const l of this.queries.lives.entities) if (l.getValue(LiveSession, 'talk')) return true;
    return false;
  }

  private startListening(): void {
    const generation = ++this.generation;
    accessRuntime.voiceState = 'starting';
    const Recognition = recognitionClass();
    if (Recognition) {
      this.startBrowser(Recognition, generation);
      return;
    }
    fetch('/api/voice')
      .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : { available: false }))
      .catch(() => ({ available: false }))
      .then((s) => {
        if (generation !== this.generation) return;
        if (s.available) void this.startServer(generation);
        else this.unavailable('Voice commands are not available in this browser.');
      });
  }

  private stopListening(): void {
    this.generation++;
    if (this.recognition) {
      this.recognition.onend = null;
      this.recognition.abort();
      this.recognition = null;
    }
    this.clipParts = null;
    if (this.capture) {
      this.capture.onaudioprocess = null;
      this.capture.disconnect();
      this.capture = null;
    }
    this.ring = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.audio?.close();
    this.audio = null;
    this.analyser = null;
    accessRuntime.voiceState = 'off';
  }

  private unavailable(line: string): void {
    accessRuntime.voiceState = 'unavailable';
    this.show(line);
  }

  // ------------------------------------------------------------ browser speech recognition

  private startBrowser(Recognition: RecognitionClass, generation: number): void {
    const r = new Recognition();
    r.continuous = true;
    r.interimResults = false;
    r.lang = 'en-US';
    r.onresult = (e) => {
      if (generation !== this.generation) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) this.heard(e.results[i][0]?.transcript ?? '');
      }
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        accessRuntime.voiceState = 'denied';
        this.show('Voice commands need the microphone.');
        r.onend = null;
      }
    };
    // Recognition stops on its own after a while: keep it going while wanted.
    r.onend = () => {
      if (generation === this.generation) setTimeout(() => generation === this.generation && r.start(), 300);
    };
    this.recognition = r;
    try {
      r.start();
      accessRuntime.voiceState = 'browser';
    } catch {
      this.unavailable('Voice commands could not start.');
    }
  }

  // ------------------------------------------------------------ server: short clips, found by loudness

  private async startServer(generation: number): Promise<void> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (generation !== this.generation) return void stream.getTracks().forEach((t) => t.stop());
      this.stream = stream;
      this.audio = new AudioContext();
      void this.audio.resume();
      this.analyser = this.audio.createAnalyser();
      this.analyser.fftSize = this.samples.length;
      const source = this.audio.createMediaStreamSource(stream);
      source.connect(this.analyser);
      // Raw audio for the clips: the last half second is always at hand, so a clip
      // includes the start of a word said before the loudness was noticed.
      this.ring = new PcmRing(this.audio.sampleRate);
      this.capture = this.audio.createScriptProcessor(2048, 1, 1);
      this.capture.onaudioprocess = (e) => {
        const samples = e.inputBuffer.getChannelData(0);
        this.clipParts?.push(new Float32Array(samples));
        this.ring?.push(samples);
      };
      source.connect(this.capture);
      // (It only runs while connected to an output; it writes silence.)
      this.capture.connect(this.audio.destination);
      accessRuntime.voiceState = 'server';
    } catch {
      if (generation !== this.generation) return;
      accessRuntime.voiceState = 'denied';
      this.show('Voice commands need the microphone.');
    }
  }

  /** Per frame: find where a spoken phrase starts and ends, and record just that. */
  private listen(delta: number): void {
    this.analyser!.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] * this.samples[i];
    const speaking = Math.sqrt(sum / this.samples.length) > SPEECH_RMS && !this.suspended();
    if (!this.clipParts) {
      this.loud = speaking ? this.loud + delta : 0;
      if (this.loud >= ONSET_SECONDS) this.beginClip();
      return;
    }
    this.clipTime += delta;
    this.quiet = speaking ? 0 : this.quiet + delta;
    if (this.quiet >= END_SILENCE_SECONDS || this.clipTime >= MAX_CLIP_SECONDS) this.endClip();
  }

  private beginClip(): void {
    if (!this.stream || !this.ring) return;
    // The clip begins with the half second before the speech was noticed.
    this.clipParts = [this.ring.snapshot()];
    this.clipTime = 0;
    this.quiet = 0;
    this.loud = 0;
  }

  private endClip(): void {
    const parts = this.clipParts;
    const seconds = this.clipTime;
    this.clipParts = null;
    if (!parts || !this.audio) return;
    if (seconds < MIN_CLIP_SECONDS) {
      voiceRuntime.short++;
      return;
    }
    const generation = this.generation;
    const wav = encodeWav(downsample(joinParts(parts), this.audio.sampleRate));
    voiceRuntime.clips++;
    fetch('/api/voice', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: new Blob([wav as BlobPart], { type: 'audio/wav' }) })
      .then((r) => {
        if (!r.ok) voiceRuntime.failed++;
        return r.ok ? (r.json() as Promise<{ text?: string }>) : null;
      })
      .then((r) => {
        if (!r) return;
        if (r.text) voiceRuntime.understood++;
        else voiceRuntime.empty++;
        if (generation === this.generation) this.heard(r.text ?? '');
      })
      .catch(() => voiceRuntime.failed++);
  }

  // ------------------------------------------------------------ understanding and acting

  /** Something was said (a final transcript): act on it if it is a command. */
  heard(text: string): void {
    if (this.suspended()) {
      voiceRuntime.ignored++;
      return;
    }
    const command = parseCommand(text);
    if (!command) {
      voiceRuntime.notCommands++;
      return;
    }
    const done = this.run(command);
    if (done) voiceRuntime.acted++;
    else voiceRuntime.refused++;
    this.show(done ? `Heard: ${describe(command)}` : done === false ? `Heard "${describe(command)}" - not now` : '');
  }

  /** True when done, false when it does not apply right now. */
  private run(c: VoiceCommand): boolean {
    const story = this.queries.stories.entities.values().next().value as Entity | undefined;
    const stage = this.queries.stages.entities.values().next().value as Entity | undefined;
    const journal = this.queries.journals.entities.values().next().value as Entity | undefined;
    const settings = this.queries.settings.entities.values().next().value as Entity | undefined;
    switch (c.kind) {
      case 'shape': {
        if (!stage || !story || !stageRuntime.ready) return false;
        // Only a shape the story is asking for, and not over the narration still being read.
        const asked = (['target', 'target2', 'altTarget', 'altTarget2'] as const).some((f) => stage.getValue(ShapeRecognizer, f) === c.shape);
        const reading = story.getValue(StoryState, 'voiceBeat') === story.getValue(StoryState, 'beatId') && !story.getValue(StoryState, 'voiceDone');
        if (!asked || reading || stage.getValue(ShapeRecognizer, 'matchedHand') !== Hands.None) return false;
        stage.setValue(ShapeRecognizer, 'matchedHand', Hands.Right);
        stage.setValue(ShapeRecognizer, 'matchedShape', c.shape as never);
        stage.setValue(ShapeRecognizer, 'twoHanded', false);
        accessRuntime.handsFreeWake = true;
        return true;
      }
      case 'journal': {
        if (!journal) return false;
        const open = c.open ?? !journal.getValue(ShadowJournal, 'open');
        journal.setValue(ShadowJournal, 'open', open);
        playClick(journal.object3D?.position);
        return true;
      }
      case 'lamp':
        if (!stage) return false;
        stage.setValue(Stage, 'lampOn', c.on);
        return true;
      case 'next':
        accessRuntime.voiceNext = true;
        return true;
      case 'help':
        accessRuntime.coachRequested = true;
        return true;
      case 'dream':
        // The Settings system dreams it (it knows whether the server can).
        dreamRuntime.request = { theme: c.theme, shapes: c.shapes, ...(c.wish ? { wish: c.wish } : {}) };
        return true;
      case 'press': {
        const target = gazeTargets.get(c.id);
        if (!target) return false;
        target.press();
        return true;
      }
      case 'setting': {
        if (!settings) return false;
        if (c.which === 'forgiving') {
          settings.setValue(Settings, 'tolerance', (c.on === false ? ToleranceLevels.Normal : ToleranceLevels.Forgiving) as never);
          return true;
        }
        settings.setValue(Settings, c.which, c.on ?? !settings.getValue(Settings, c.which));
        return true;
      }
    }
  }

  private show(line: string): void {
    accessRuntime.voiceHeard = line;
    accessRuntime.voiceHeardAt = performance.now();
  }
}
