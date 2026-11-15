import { createSystem, Entity } from '@iwsdk/core';
import { onAway } from './away.js';
import { StallWatch } from './narration-watch.js';
import { LiveSession, PerformanceRecorder, Settings, StoryState, StoryStatuses } from './shadowplay-components.js';
import { storyRuntime } from './story-script.js';

interface NarrationManifest {
  version: 'shadowplay.narration.v1';
  /** Beat id -> clip path relative to the app base. */
  clips: Record<string, string>;
}

/**
 * Plays narration in sync with the captions (the brief's NarrationSystem).
 * When a beat brings a new caption, its recorded clip from
 * public/narration/manifest.json plays. A line with no recorded clip (a dreamed
 * story) is spoken by the server's narrator voice (server/speak.ts, with the
 * child's name), the next lines fetched ahead; where there is none, an optional
 * test-only placeholder voice (on-device speech synthesis, dev builds only) can
 * speak the caption for playtest pacing. Reports when each line
 * finishes so the story waits for it, and pauses and resumes with the story.
 */
export class NarrationSystem extends createSystem({
  stories: { required: [StoryState] },
  settings: { required: [Settings] },
  recorders: { required: [PerformanceRecorder] },
  sessions: { required: [LiveSession] },
}) {
  private clips: Record<string, string> = {};
  private loaded = false;
  private loading = false;
  private lastBeat = '';
  private lastText = '';
  private audio: HTMLAudioElement | null = null;
  private speaking = false;
  private paused = false;
  /** Bumped per line so callbacks from a stopped line are ignored. */
  private line = 0;
  /** Notices a clip that stopped making progress (see narration-watch.ts). */
  private watch = new StallWatch();
  /** The server can voice lines without a recorded clip (dreamed stories). */
  private serverVoice = false;
  /** Lines fetched (or being fetched) ahead, by URL: their audio as object URLs. */
  private ready = new Map<string, Promise<string>>();
  /** Object URLs made, freed when the story changes. */
  private made: string[] = [];
  private prefetchScript = '';

  init(): void {
    // Browsers load the voice list lazily; ask early so the first line has a voice.
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();
    this.cleanupFuncs.push(
      () => this.stopLine(),
      () => this.forgetReady(),
      // Pause at once when the player steps away: a hidden session runs no frames to do it.
      // Coming back, update() resumes the line once the story is playing again.
      onAway((isAway) => {
        if (isAway) this.pauseLine();
      }),
    );
  }

  update(delta: number): void {
    const story = first(this.queries.stories.entities);
    if (!story) return;
    if (!this.loaded && !this.loading) this.load();
    if (!this.loaded) return;

    const status = story.getValue(StoryState, 'status');
    if (status === StoryStatuses.Paused) {
      this.pauseLine();
      return;
    }
    // During a replayed performance the performer's own voice is the narration;
    // and while a parent records with their voice or talks live, they are the
    // narrator (the captions become their script).
    const replaying = Boolean(story.getValue(StoryState, 'followMode'));
    if (status !== StoryStatuses.Playing || story.getValue(StoryState, 'freeStage') || replaying || this.parentNarrating()) {
      if (this.audio || this.speaking) {
        this.stopLine();
        // A cut-off line counts as finished, so the story paces itself by reading time.
        story.setValue(StoryState, 'voiceDone', true);
      }
      return;
    }
    this.resumeLine();
    if (this.audio) this.watchClip(story, delta);

    // A new story: get its first clip-less lines ready (a dreamed story starts at once).
    if (storyRuntime.script !== this.prefetchScript && storyRuntime.order.length) {
      this.prefetchScript = storyRuntime.script;
      this.forgetReady();
      this.prefetchAfter('');
    }
    const beat = story.getValue(StoryState, 'beatId') ?? '';
    if (beat === this.lastBeat) return;
    this.lastBeat = beat;
    const text = story.getValue(StoryState, 'caption') ?? '';
    // Beats without new words (moth, scenery, lamp...) keep the previous line.
    if (!text || text === this.lastText) {
      this.finish(story, beat, '');
      return;
    }
    this.lastText = text;
    this.speak(story, beat, text);
  }

  private parentNarrating(): boolean {
    const rec = first(this.queries.recorders.entities);
    if (rec?.getValue(PerformanceRecorder, 'recording') && rec.getValue(PerformanceRecorder, 'withVoice')) return true;
    return Boolean(first(this.queries.sessions.entities)?.getValue(LiveSession, 'talking'));
  }

  /** The narrator voice's URL for a line without a recorded clip, or null when there is no voice here. */
  private serverLine(beat: string, caption: string): string | null {
    if (!this.serverVoice) return null;
    const words = plainLine(storyRuntime.lines[beat] ?? caption);
    return words ? `${import.meta.env.BASE_URL}api/speak?text=${encodeURIComponent(words)}` : null;
  }

  /** Fetch the next few clip-less lines ahead, so each is ready in memory when its beat comes. */
  private prefetchAfter(beat: string): void {
    const order = storyRuntime.order;
    let i = order.indexOf(beat);
    let ahead = 0;
    while (i >= -1 && ++i < order.length && ahead < PREFETCH_LINES) {
      const id = order[i];
      if (this.clips[id]) continue;
      const url = this.serverLine(id, '');
      if (!url || this.ready.has(url)) continue;
      ahead++;
      const blobUrl = fetch(url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((blob) => {
          const u = URL.createObjectURL(blob);
          this.made.push(u);
          return u;
        });
      blobUrl.catch(() => this.ready.delete(url));
      this.ready.set(url, blobUrl);
    }
  }

  private forgetReady(): void {
    for (const u of this.made) URL.revokeObjectURL(u);
    this.made.length = 0;
    this.ready.clear();
  }

  private load(): void {
    this.loading = true;
    // Whether lines without a recorded clip can be voiced here (the server's narrator voice).
    fetch(`${import.meta.env.BASE_URL}api/speak`)
      .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : null))
      .then((r) => (this.serverVoice = Boolean(r?.available)))
      .catch(() => undefined);
    fetch(`${import.meta.env.BASE_URL}narration/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<NarrationManifest>) : null))
      .catch(() => null)
      .then((manifest) => {
        this.clips = manifest?.clips ?? {};
        this.loaded = true;
      });
  }

  private speak(story: Entity, beat: string, text: string): void {
    this.stopLine();
    const line = ++this.line;
    story.setValue(StoryState, 'voiceBeat', beat);
    story.setValue(StoryState, 'voiceDone', false);
    const done = () => {
      if (line === this.line) this.finish(story, beat, story.getValue(StoryState, 'voiceSource') ?? '');
    };

    const clip = this.clips[beat];
    if (clip) {
      const audio = new Audio(`${import.meta.env.BASE_URL}${clip.replace(/^\/+/u, '')}`);
      this.audio = audio;
      this.watch.reset();
      audio.addEventListener('ended', done, { once: true });
      audio.addEventListener('error', done, { once: true });
      story.setValue(StoryState, 'voiceSource', 'clip');
      // An AbortError only means a pause or a reload (the stall watch's retry) interrupted
      // this attempt; the line is not over. Any other failure ends it.
      void audio.play().catch((e: unknown) => {
        if ((e as Error)?.name !== 'AbortError') done();
      });
      return;
    }

    // No recorded clip (a dreamed story): the server's narrator voice, the next lines fetched ahead.
    const spoken = this.serverLine(beat, text);
    if (spoken) {
      story.setValue(StoryState, 'voiceSource', 'server');
      // Fetched ahead: play it from memory (waiting for a fetch already on its way); else from the server.
      const play = (src: string) => {
        if (line !== this.line) return;
        const audio = new Audio(src);
        this.audio = audio;
        this.watch.reset();
        audio.addEventListener('ended', done, { once: true });
        audio.addEventListener('error', done, { once: true });
        void audio.play().catch((e: unknown) => {
          if ((e as Error)?.name !== 'AbortError') done();
        });
      };
      const ahead = this.ready.get(spoken);
      if (ahead) void ahead.then(play, () => play(spoken));
      else play(spoken);
      this.prefetchAfter(beat);
      return;
    }

    const settings = first(this.queries.settings.entities);
    // Test-only: never in production builds (no licence for commercial use).
    const allowed = import.meta.env.DEV && Boolean(settings?.getValue(Settings, 'placeholderVoice'));
    const voice = allowed ? localVoice() : null;
    if (voice) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.rate = 0.92;
      utterance.onend = done;
      utterance.onerror = done;
      this.speaking = true;
      story.setValue(StoryState, 'voiceSource', 'placeholder');
      speechSynthesis.speak(utterance);
      return;
    }
    this.finish(story, beat, '');
  }

  private finish(story: Entity, beat: string, source: string): void {
    this.audio = null;
    this.speaking = false;
    story.setValue(StoryState, 'voiceBeat', beat);
    story.setValue(StoryState, 'voiceSource', source);
    story.setValue(StoryState, 'voiceDone', true);
  }

  /**
   * A clip that should be playing but has not moved: reload it and try once
   * more; if it is still stuck, stop it and let the line end on its caption
   * (the story then paces it by reading time), rather than wait on silence.
   */
  private watchClip(story: Entity, delta: number): void {
    const audio = this.audio!;
    const action = this.watch.step(delta, audio.currentTime);
    if (action === 'retry') {
      audio.load();
      void audio.play().catch(() => undefined);
    } else if (action === 'give-up') {
      this.line++;
      audio.pause();
      this.finish(story, story.getValue(StoryState, 'voiceBeat') ?? '', 'clip');
    }
  }

  private pauseLine(): void {
    if (this.paused) return;
    this.paused = true;
    this.audio?.pause();
    if (this.speaking) speechSynthesis.pause();
  }

  private resumeLine(): void {
    if (!this.paused) return;
    this.paused = false;
    void this.audio?.play().catch(() => undefined);
    if (this.speaking) speechSynthesis.resume();
  }

  private stopLine(): void {
    this.line++;
    this.paused = false;
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (this.speaking && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.speaking = false;
  }
}

/** Lines fetched ahead of the one playing. */
const PREFETCH_LINES = 3;

/** A line as the narrator voice takes it: plain letters (accents dropped from names), no markup. */
function plainLine(text: string): string {
  const plain = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ,.!?'’;:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.slice(0, 240);
}

/** An English voice that runs on the device (never a network voice). */
function localVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null;
  const voices = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.toLowerCase().startsWith('en'));
  return voices.find((v) => v.default) ?? voices[0] ?? null;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
