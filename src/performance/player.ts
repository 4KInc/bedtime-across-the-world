import { createSystem, Entity } from '@iwsdk/core';
import { family } from '../family.js';
import { loadRecording } from '../journal-store.js';
import { checkSharedStory } from '../story-checks.js';
import { isStoryScript, loadStoryScript, readingSeconds, shareScript, StoryBeat, StoryScript, storyRuntime } from '../story-script.js';
import {
  DeskLamp,
  HiddenProp,
  Moth,
  PerformancePlayer,
  Scenery,
  ShadowPuppet,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
} from '../shadowplay-components.js';
import { handOverride, JOINT_COUNT, stageRuntime } from '../stage-runtime.js';
import { applyEvent, ApplyTargets, applyTargets } from './apply.js';
import { decodeHands, FRAME_STRIDE, Performance, PerformanceEvent, readFrame } from './format.js';
import { audioRunning, voiceGain } from '../sfx.js';

/** Re-sync the voice when it drifts this far (s) from the performance clock. */
const AUDIO_DRIFT = 0.25;
/** Seconds the performer's voice takes to fade in or out around a join-in moment (never a hard cut). */
const VOICE_FADE = 0.35;
/** A little air after a line before its voice fades. */
const LINE_TAIL_MS = 400;

/**
 * Replays a recorded performance on this stage, in or out of XR: the hands
 * move again through the hand override (so shadows, recognition and creatures
 * behave as they did), the story re-enters each recorded beat at its time,
 * creatures wake and release on cue, the lamp moves, and the performer's
 * voice plays in sync. Pause and resume keep everything together.
 */
/** For tests: the recorded voice now (its loudness, whether paused, whether through a gain node). */
export const playbackVoiceRuntime = {
  gain: 1,
  paused: true,
  routed: false,
  /** For diagnostics: the voice's own position (s), play() calls the browser refused and why, and media errors. */
  at: 0,
  /** The story's clock (s), and whether the child's Join in turn is on. */
  pos: 0,
  joinIn: false,
  refused: 0,
  refusedWhy: '',
  error: '',
};

/** A play() of the recorded voice; a refusal is counted (iOS refuses one without a tap). */
function playVoice(audio: HTMLAudioElement): void {
  void audio.play().catch((e: Error) => {
    playbackVoiceRuntime.refused++;
    playbackVoiceRuntime.refusedWhy = e?.name ?? 'refused';
  });
}

export class PerformancePlayerSystem extends createSystem({
  players: { required: [PerformancePlayer] },
  stories: { required: [StoryState] },
  recognizers: { required: [ShapeRecognizer] },
  puppets: { required: [ShadowPuppet] },
  lamps: { required: [DeskLamp] },
  moths: { required: [Moth] },
  scenery: { required: [Scenery] },
  actors: { required: [StageActor] },
  stages: { required: [Stage] },
  props: { required: [HiddenProp] },
}) {
  private perf: Performance | null = null;
  /** Free play as it was before a goodnight switched it on (null: not switched); set back when the goodnight ends. */
  private freeBefore: boolean | null = null;
  private frames: Int16Array | null = null;
  private loading = false;
  private clock = 0;
  private next = 0;
  private events: PerformanceEvent[] = [];
  private audio: HTMLAudioElement | null = null;
  private audioUrl = '';
  private left = new Float32Array(JOINT_COUNT * 3);
  private right = new Float32Array(JOINT_COUNT * 3);
  private targets!: ApplyTargets;
  private wasPaused = false;
  private beats: StoryBeat[] = [];
  /** Live join-in segment: the story beat index at which the recording takes over again. */
  private rejoinAt = -1;
  /**
   * Join-in voice: the performer's recorded voice is played line by line while
   * the viewer's hands tell the story, each line fading out where it ends
   * (audio time, seconds; -1: no end, the voice plays on).
   */
  private voiceEndsAt = -1;
  /** The voice's level now and where it is heading (0 or 1). */
  private gain = 1;
  private gainTarget = 1;
  /**
   * The voice's gain node (sfx.ts voiceGain): fades are done here and the voice is
   * muted, never paused, between lines, so iOS never has to be asked to play it
   * again without a tap (iPad, Nov 17: Join in lost the voice after the first shape).
   */
  private voiceNode: GainNode | null = null;
  /** Routing the voice through Web Audio was tried (it is tried once: a media element can be routed only once). */
  private routeTried = false;
  /** Real time (ms) of the last fade step: fades run on the clock, not on frames (a slow device must not stretch them). */
  private fadeAt = 0;
  /** The live story beat whose line was last voiced during join-in. */
  private voicedBeat = -1;

  init(): void {
    this.targets = applyTargets(this.queries, this.world);
    this.cleanupFuncs.push(() => this.teardown());
  }

  update(delta: number): void {
    const player = first(this.queries.players.entities);
    if (!player) return;
    const playing = Boolean(player.getValue(PerformancePlayer, 'playing'));
    if (playing && !this.perf && !this.loading) void this.load(player);
    if (!playing && this.perf) this.finish(player, 'Stopped.');
    if (!this.perf || !this.frames || !stageRuntime.ready) return;

    this.updateVoice();
    if (this.rejoinAt >= 0) {
      this.updateJoinIn(player);
      return;
    }

    const paused = Boolean(player.getValue(PerformancePlayer, 'paused'));
    if (paused !== this.wasPaused) {
      this.wasPaused = paused;
      if (paused) this.audio?.pause();
      else if (this.audio) playVoice(this.audio);
    }
    if (paused) return;
    // Wait while the story loads the recording's script.
    if (this.perf.script && !this.perf.replyTo && storyRuntime.script !== this.perf.script) return;

    this.clock += delta;
    const tMs = this.clock * 1000;
    // At most one beat per frame: the story reads one enterBeat per update, and
    // instant beats (scenery, Mo landing) often share a timestamp.
    while (this.next < this.events.length && this.events[this.next].t <= tMs) {
      const e = this.events[this.next++];
      this.apply(e);
      if (e.type === 'beat') break;
    }

    const hands = readFrame(this.frames, this.perf.frameCount, this.clock * this.perf.frameHz, this.left, this.right);
    handOverride.active = true;
    handOverride.source = 'playback';
    handOverride.left = hands.left ? this.left : null;
    handOverride.right = hands.right ? this.right : null;

    if (this.audio && !this.audio.paused && Math.abs(this.audio.currentTime - this.clock) > AUDIO_DRIFT) {
      this.audio.currentTime = this.clock;
    }
    player.setValue(PerformancePlayer, 'position', +this.clock.toFixed(1));
    if (tMs >= this.perf.durationMs) this.finish(player, 'Finished.');
  }

  private async load(player: Entity): Promise<void> {
    this.loading = true;
    const id = player.getValue(PerformancePlayer, 'recordingId') ?? '';
    let perf: Performance | null = null;
    let frames: Int16Array;
    let beats: StoryBeat[] = [];
    try {
      perf = await loadRecording<Performance>(id);
      if (!perf) throw new Error(`No recording "${id}".`);
      if (perf.story !== undefined) {
        // A dreamed story carries its words: checked again here, then told from memory.
        const checked = checkSharedStory(perf.story);
        perf = { ...perf, script: checked ? shareScript(perf.id, checked as unknown as StoryScript) : '' };
      } else if (perf.script && !isStoryScript(perf.script)) {
        // A story this version does not know plays without changing the stage's story.
        perf = { ...perf, script: '' };
      }
      frames = decodeHands(perf.hands);
      if (frames.length < perf.frameCount * FRAME_STRIDE) throw new Error('This recording is damaged.');
      beats = perf.script ? (await loadStoryScript(perf.script).catch(() => null))?.beats ?? [] : [];
      // A story this site does not have (an older version): the story stage would wait for it forever.
      if (perf.script && !beats.length) perf = { ...perf, script: '' };
    } catch (error) {
      player.setValue(PerformancePlayer, 'playing', false);
      player.setValue(PerformancePlayer, 'status', (error as Error).message);
      return;
    } finally {
      this.loading = false;
    }
    // Stopped, or asked for another recording, while this one was loading.
    if (!player.getValue(PerformancePlayer, 'playing') || player.getValue(PerformancePlayer, 'recordingId') !== id) return;
    this.perf = perf;
    this.frames = frames;
    this.events = staleStartDropped([...perf.events].sort((a, b) => a.t - b.t));
    this.beats = beats;
    this.rejoinAt = -1;
    // The recorded hands drive the stage; the camera only takes over for join-in moments.
    handOverride.cameraAllowed = false;
    this.next = 0;
    this.clock = 0;
    this.wasPaused = false;
    player.setValue(PerformancePlayer, 'duration', +(perf.durationMs / 1000).toFixed(1));
    family.borrow({ child: perf.child ?? '', performer: perf.performer });
    player.setValue(PerformancePlayer, 'status', `Playing "${perf.title}"${perf.performer ? ` from ${perf.performer}` : ''}.`);
    const story = first(this.queries.stories.entities);
    story?.setValue(StoryState, 'followMode', true);
    // Tell the story in the recording's script (it may be another story from the library).
    // A goodnight is not a story: it plays on whatever stage is here, every creature free to wake.
    if (perf.script && !perf.replyTo) story?.setValue(StoryState, 'script', perf.script);
    if (!perf.script && !perf.replyTo) story?.setValue(StoryState, 'caption', perf.title || 'A bedtime story');
    if (perf.replyTo) {
      for (const r of this.queries.recognizers.entities) {
        this.freeBefore ??= Boolean(r.getValue(ShapeRecognizer, 'freeMode'));
        r.setValue(ShapeRecognizer, 'freeMode', true);
      }
      story?.setValue(StoryState, 'caption', perf.title || 'A goodnight for you');
    }
    if (perf.audio) {
      this.audioUrl = URL.createObjectURL(perf.audio);
      this.audio = new Audio(this.audioUrl);
      this.voiceNode = voiceGain(this.audio);
      this.routeTried = this.voiceNode !== null;
      this.audio.addEventListener('error', () => (playbackVoiceRuntime.error = `media ${this.audio?.error?.code ?? '?'}`));
      playVoice(this.audio);
    }
  }

  private apply(e: PerformanceEvent): void {
    if (e.type !== 'beat') {
      applyEvent(e, this.targets);
      return;
    }
    // A goodnight, or a story this site does not have: no story steps (they would land in another story).
    if (this.perf?.replyTo || !this.perf?.script) return;
    const index = Number(e.data.index);
    first(this.queries.stories.entities)?.setValue(StoryState, 'enterBeat', index);
    const type = this.beats[index]?.type;
    const player = first(this.queries.players.entities);
    if (player?.getValue(PerformancePlayer, 'joinIn') && (type === 'request' || type === 'choice')) {
      this.startJoinIn(player, index, e.t);
    }
  }

  /**
   * Join-in moment: the recording reaches a shape request. Pause the recorded
   * hands and voice and let the story run live with the viewer's own hands
   * (camera) until it reaches the next release beat, where the recording's
   * creature bowed out; then the recording carries on from there.
   */
  private startJoinIn(player: Entity, requestIndex: number, requestMs: number): void {
    let rejoin = -1;
    for (let i = requestIndex + 1; i < this.beats.length; i++) {
      if (this.beats[i].type === 'release') {
        rejoin = i;
        break;
      }
    }
    if (rejoin < 0) return;
    this.rejoinAt = rejoin;
    // The performer finishes saying what to make (it is the child's instruction), then the voice fades.
    this.voicedBeat = requestIndex;
    this.voiceEndsAt = this.lineEnd(requestMs, requestIndex);
    // Muted, the voice plays on through the child's turn: round and round, so it never ends and needs no new play().
    if (this.audio && this.voiceNode) this.audio.loop = true;
    handOverride.cameraAllowed = true;
    if (handOverride.source === 'playback') handOverride.left = handOverride.right = null;
    first(this.queries.stories.entities)?.setValue(StoryState, 'joinIn', true);
    player.setValue(PerformancePlayer, 'inJoinIn', true);
    player.setValue(PerformancePlayer, 'status', 'Your turn! Make the shape with your hands.');
  }

  private updateJoinIn(player: Entity): void {
    const story = first(this.queries.stories.entities);
    const index = story?.getValue(StoryState, 'beatIndex') ?? -1;
    if (index < this.rejoinAt) {
      // Each line on the way (the creature wakes, flies...) in the performer's own voice.
      if (index > this.voicedBeat) {
        this.voicedBeat = index;
        this.voiceLine(index);
      }
      return;
    }
    // The viewer's scene is done: pick the recording up at the matching beat.
    // From where the recording is now, never before it (Nov 17: a recording's first event, the story played just
    // before, matched first, and the story started again from 0:00 after the child's turn).
    const at = this.events.findIndex((e, i) => i >= this.next && e.type === 'beat' && Number(e.data.index) >= this.rejoinAt);
    this.rejoinAt = -1;
    story?.setValue(StoryState, 'joinIn', false);
    handOverride.cameraAllowed = false;
    player.setValue(PerformancePlayer, 'inJoinIn', false);
    if (at < 0) {
      this.finish(player, 'Finished.');
      return;
    }
    // Skip re-entering the beat the live story has already entered.
    this.clock = this.events[at].t / 1000;
    this.next = at + 1;
    if (this.audio) {
      this.audio.loop = false;
      this.audio.currentTime = this.clock;
      this.voiceEndsAt = -1;
      this.fadeIn();
    }
    player.setValue(PerformancePlayer, 'status', 'Back to the story...');
  }

  /** Where the performer's line for a beat ends in the recording (audio seconds): its reading time, or the next beat if sooner. */
  private lineEnd(startMs: number, index: number): number {
    const text = lineOf(this.beats[index]);
    let end = text ? startMs + readingSeconds(text) * 1000 + LINE_TAIL_MS : startMs;
    for (const e of this.events) {
      if (e.type === 'beat' && e.t > startMs) {
        end = Math.min(end, e.t);
        break;
      }
    }
    return end / 1000;
  }

  /** Play the performer's recorded line for this story beat (none when the beat has no words). */
  private voiceLine(index: number): void {
    if (!this.audio || !lineOf(this.beats[index])) return;
    let at = -1;
    for (const e of this.events) {
      if (e.type === 'beat' && Number(e.data.index) === index) {
        at = e.t;
        break;
      }
    }
    if (at < 0) return;
    this.audio.currentTime = at / 1000;
    this.voiceEndsAt = this.lineEnd(at, index);
    this.fadeIn();
  }

  private fadeIn(): void {
    if (!this.audio) return;
    this.gain = 0;
    this.gainTarget = 1;
    this.fadeAt = performance.now();
    this.setVoice(0);
    if (this.audio.paused) playVoice(this.audio);
  }

  /**
   * The voice's loudness: on its gain node where there is one (iOS ignores an element's volume), else the
   * element's; and silent is also the element muted. On an iPad (Nov 17) the gain node did not silence it:
   * waiting for the child's shape the recording was heard going on, then jumped back to the line and caught up.
   * iOS honours muted, and muted is not paused, so no tap is needed to hear it again.
   */
  private setVoice(gain: number): void {
    if (this.voiceNode) this.voiceNode.gain.value = gain;
    else if (this.audio) this.audio.volume = gain;
    if (this.audio) this.audio.muted = gain === 0;
  }

  /** Fade the voice toward its target; at a line's end, fade out and stop. */
  private updateVoice(): void {
    const audio = this.audio;
    if (!audio) return;
    // Not routed at the start (the audio context was not running yet when the recording loaded): routed as soon
    // as it runs, once (Nov 17, an iPad: which path a playback took depended on how soon the story was tapped).
    if (!this.voiceNode && !this.routeTried && audioRunning()) {
      this.routeTried = true;
      this.voiceNode = voiceGain(audio);
      if (this.voiceNode) this.voiceNode.gain.value = this.gain;
    }
    playbackVoiceRuntime.gain = Math.round(this.gain * 100) / 100;
    playbackVoiceRuntime.paused = audio.paused;
    playbackVoiceRuntime.routed = this.voiceNode !== null;
    playbackVoiceRuntime.at = audio.currentTime;
    playbackVoiceRuntime.pos = this.clock;
    playbackVoiceRuntime.joinIn = this.rejoinAt >= 0;
    const now = performance.now();
    const step = (now - this.fadeAt) / 1000 / VOICE_FADE;
    this.fadeAt = now;
    if (this.voiceEndsAt >= 0 && !audio.paused && audio.currentTime >= this.voiceEndsAt - VOICE_FADE) this.gainTarget = 0;
    // Well past the line's end (a long frame): stop now rather than run into the next line.
    if (this.gainTarget === 0 && this.voiceEndsAt >= 0 && audio.currentTime >= this.voiceEndsAt + VOICE_FADE && this.gain !== 0) {
      this.gain = 0;
      this.setVoice(0);
    }
    // Quiet between lines, the voice keeps playing, muted, routed or not: never paused, because iOS will not
    // start a paused voice again without a tap (Nov 17, an iPad joining in: silent after the first shape when the
    // voice was not routed, which used to pause it).
    if (this.gain === this.gainTarget) return;
    this.gain = this.gainTarget > this.gain ? Math.min(this.gainTarget, this.gain + step) : Math.max(this.gainTarget, this.gain - step);
    this.setVoice(this.gain);
    if (this.gain === 0) this.voiceEndsAt = -1;
  }

  private finish(player: Entity, status: string): void {
    this.teardown();
    player.setValue(PerformancePlayer, 'playing', false);
    player.setValue(PerformancePlayer, 'inJoinIn', false);
    player.setValue(PerformancePlayer, 'status', status);
    const story = first(this.queries.stories.entities);
    story?.setValue(StoryState, 'joinIn', false);
    story?.setValue(StoryState, 'followMode', false);
  }

  private teardown(): void {
    if (this.perf) family.borrow(null);
    // A goodnight's free play ends with it (Quest, Nov 18: after Goodnights, every story stayed in free play and the car never woke).
    if (this.freeBefore !== null) {
      for (const r of this.queries.recognizers.entities) r.setValue(ShapeRecognizer, 'freeMode', this.freeBefore);
      this.freeBefore = null;
    }
    this.audio?.pause();
    this.voiceNode?.disconnect();
    this.voiceNode = null;
    this.audio = null;
    if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
    this.audioUrl = '';
    this.perf = null;
    this.frames = null;
    this.rejoinAt = -1;
    this.voiceEndsAt = -1;
    this.gain = this.gainTarget = 1;
    this.voicedBeat = -1;
    handOverride.cameraAllowed = true;
    if (handOverride.source === 'playback') {
      handOverride.active = false;
      handOverride.left = handOverride.right = null;
    }
  }
}

/** A beat's spoken line ('' for beats without words). */
function lineOf(beat: StoryBeat | undefined): string {
  return beat && 'text' in beat && typeof beat.text === 'string' ? beat.text : '';
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}

/**
 * A recording started before its story did (Record, then a story picked) begins
 * with the beat the stage was on then: the end of the story before, a beat the
 * new story does not have. Beats before the story's own first beat are dropped,
 * so playback neither shows that ending first nor finds it again.
 */
export function staleStartDropped<E extends { type: string; data: Record<string, unknown> }>(events: E[]): E[] {
  const start = events.findIndex((e) => e.type === 'beat' && Number(e.data.index) === 0);
  if (start <= 0) return events;
  return events.filter((e, i) => i >= start || e.type !== 'beat');
}
