import { createSystem, Entity, Vector3, VisibilityState } from '@iwsdk/core';
import { away, setAway } from './away.js';
import { nameInDream, personalise } from './family.js';
import { loadProgress, loadUnlocks, saveProgress, saveUnlocks } from './journal-store.js';
import {
  HiddenProp,
  Moth,
  PuppetStates,
  Scenery,
  PerformanceRecorder,
  Settings,
  ShadowJournal,
  ShadowPuppet,
  ShapeIds,
  ShapeRecognizer,
  Stage,
  StageActor,
  StoryState,
  StoryStatuses,
} from './shadowplay-components.js';
import { loadStoryScript, readingSeconds, StoryBeat, StoryScript, storyRuntime } from './story-script.js';
import { soundLock } from './sfx.js';
import { accessRuntime, handRuntime, readerRuntime, stageRuntime, trackingRuntime } from './stage-runtime.js';
import { DropoutWatch } from './tracking-watch.js';
import { viewerMode } from './viewer-mode.js';
import { addWorldPuppet, WORLD_CREATURE_IDS } from './world-puppets.js';
import { creatureName } from './creatures.js';

const CHAPTER_SECONDS = 3.2;
const LAMP_SECONDS = 1.8;
/**
 * The first shape a session asks for is taught by showing it: the ghost hand
 * appears this soon (later requests use the player's hint setting, 15 s by
 * default; "Off" is still respected).
 */
const FIRST_HINT_SECONDS = 2;
const GROW_HOLD_SECONDS = 0.6;
/** The most a grow step asks for, as a share of the stage width. */
const GROW_NEED_MAX = 0.7;
const CONTINUE_HOLD_SECONDS = 1.0;
const REVEAL_HOLD_SECONDS = 0.8;
const LETGO_HOLD_SECONDS = 0.5;
const PAUSED_CAPTION = 'Paused. Pinch the lamp switch to continue.';
/** Behind the Quest menu, or with the headset off: it carries on by itself on return. */
const AWAY_CAPTION = 'Paused.';
const JOURNAL_CAPTION = 'Your Shadow Journal. Pinch the book to close it.';
/** The headset held the sound back until a gesture (see soundLock in sfx.ts). */
const SOUND_CAPTION = 'Pinch your thumb and finger together once to turn on the sound.';
/** How long the story waits for that pinch before going on with captions only (s). */
const SOUND_WAIT_SECONDS = 10;
const TITLE_CAPTION =
  'Bedtime Across the World. A lamp behind you, a story on your wall. Put on your headset and press Enter XR to begin.';
const OUTSIDE_XR_CAPTION = 'Paused. Press Enter XR to return to the story.';
/** Family viewer (phone / tablet): no headset needed. */
const VIEWER_CAPTION = 'A bedtime story is waiting. Pick one below to watch.';
const HANDS_CAPTION = 'This story is told with your hands. Put your controllers down and let the headset see your hands.';
/** Grace period before the hands-first guard pauses (controllers being set down). */
const CONTROLLER_GRACE_SECONDS = 1;
/** A parent reading aloud has finished a line once they have been quiet this long (ms). */
const READER_PAUSE_MS = 800;
/** The first story; progress saved before the library existed belongs to it. */
const DEFAULT_SCRIPT = 'story/the-moth.story.json';
/**
 * A first launch (nothing saved yet) opens with The Shy Little Shark: five
 * minutes, and every shape in it one hand and easy (a shark, an octopus, a
 * whale, then cupped hands), with a story world's own creatures and the
 * finale's lights. On a Quest 3 (Nov 17) each woke in 2 to 7 seconds. It
 * replaces Counting Stars (three minutes), which was quick but the plainest
 * story to meet first. Returning players continue where they were; the
 * journal lists every story.
 */
const FIRST_LAUNCH_SCRIPT = 'story/gentle-shark.story.json';
/** 'Never stuck' assist: seconds a player beat may wait before each assist level. */
// (Quest 3, Nov 15: people gave up on a shape at about a minute, so the last assist comes at 45 s.)
const ASSIST_AFTER = [15, 30, 45] as const;
/** Extra recognition tolerance at assist levels 1 and 2. */
const ASSIST_TOLERANCE = [0, 0.1, 0.2] as const;
/**
 * At level 3, a hand held still in the light for this long counts as the request:
 * its wrist stays within this distance (m) of where it settled. (Measured over the
 * hold, not frame to frame: Quest tracking jitter alone is ~0.15 m/s per frame.)
 */
const STILL_RADIUS = 0.04;
const STILL_SECONDS = 1.5;
/** Look to press: beats that ask the hands to move finish after the gaze rests on the stage this long. */
const GAZE_BEAT_SECONDS = 2.5;
const GAZE_BEATS = new Set(['follow', 'grow', 'carry', 'reveal', 'continue', 'letgo']);

/** Lamp flicker envelope for the prologue: stutters, catches, then warms up. */
function flicker(t: number): number {
  if (t < 0.25) return 0;
  if (t < 0.35) return 0.55;
  if (t < 0.6) return 0.05;
  if (t < 0.72) return 0.8;
  if (t < 0.82) return 0.25;
  return Math.min(1, 0.5 + (t - 0.82) / 1.2);
}

/** Longest story step per frame (seconds). */
const MAX_STEP_SECONDS = 0.25;

/**
 * Plays the beat script: captions, lamp, moth, scenery, actors, shape requests
 * and choices. Waits (never fails) on player beats, pauses while the lamp is
 * off, the headset is removed or the journal is open, and saves progress at
 * each chapter so a returning player resumes where they left off.
 */
/**
 * Why the story is paused now, for diagnostics: '' (playing), 'lamp' (the lamp
 * switched off), 'away' (Quest menu or headset off), 'journal' (the Shadow
 * Journal open), 'hands' (waiting to see hands) or 'sound' (waiting for a gesture to start sound).
 */
export const pauseRuntime = { why: '' as '' | 'lamp' | 'away' | 'journal' | 'hands' | 'sound' };

export class StorySystem extends createSystem({
  stories: { required: [StoryState] },
  stages: { required: [Stage, ShapeRecognizer] },
  puppets: { required: [ShadowPuppet] },
  moths: { required: [Moth] },
  scenery: { required: [Scenery] },
  actors: { required: [StageActor] },
  journals: { required: [ShadowJournal] },
  props: { required: [HiddenProp] },
  settings: { required: [Settings] },
  recorders: { required: [PerformanceRecorder] },
}) {
  private script: StoryScript | null = null;
  private beatTime = 0;
  /** Time the current player condition (grow/continue) has been held. */
  private holdTime = 0;
  /** Look to press: how long the gaze has rested on the stage during this beat. */
  private gazeTime = 0;
  private beatCaption = '';
  private blurred = false;
  private inXR = false;
  /** Browser attract mode (before any XR session) is showing. */
  private attract = false;
  private controllerTime = 0;
  /** Time spent waiting for the pinch that turns the sound on (s). */
  private soundWait = 0;
  private unlocked = new Set<string>();

  private assistLevel = 0;
  private stillTime = { left: 0, right: 0 };
  /** Where each hand settled (level 3 assist). */
  private lastWrist = { left: new Vector3(), right: new Vector3() };
  private wrist = new Vector3();
  /** Viewer's own beat when a replay began (restored to its chapter afterwards). */
  private beforeFollow = -2;
  /** Recording, as of the last frame: a recording begun before the first shape restarts the story (below). */
  private wasRecording = false;
  private endings = new Set<string>();
  private loading = false;
  private switching = false;
  /** Path of the loaded script. */
  private scriptPath = '';
  private resumeAt = -1;
  private lastAliveShape: string = ShapeIds.None;
  /** A creature has woken this session (until then the hint comes early). */
  private firstWoken = false;
  /** Hand-tracking flickers during shape requests (tracking-watch.ts). */
  private dropouts = new DropoutWatch();
  /** The chapter card now showing is a returning player's resume point. */
  private welcomeBack = false;
  /** Puppet size when the current grow beat began. */
  private growFrom = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        this.blurred = state === VisibilityState.VisibleBlurred || state === VisibilityState.Hidden;
        this.inXR = state !== VisibilityState.NonImmersive;
        this.updateAway();
      }),
    );
    const onPageVisibility = () => this.updateAway();
    document.addEventListener('visibilitychange', onPageVisibility);
    this.cleanupFuncs.push(() => document.removeEventListener('visibilitychange', onPageVisibility));
  }

  /**
   * In XR the session's own visibility decides (the Quest menu: visible-blurred;
   * headset off: hidden). The page's visibility counts only outside XR (a phone
   * or desktop tab in the background): a headset browser may report its 2D page
   * as hidden for the whole immersive session, which must not pause the story.
   */
  private updateAway(): void {
    setAway(this.inXR ? this.blurred : document.hidden);
  }

  /** Index of the chapter beat at or before `index` (0 if none). */
  private chapterStart(index: number): number {
    for (let i = Math.min(index, this.script!.beats.length - 1); i > 0; i--) {
      if (this.script!.beats[i].type === 'chapter') return i;
    }
    return 0;
  }

  /** Remember a reached chapter and/or a seen ending (persisted). */
  private unlock(story: Entity, chapter: string | null, ending: string | null): void {
    const before = this.unlocked.size + this.endings.size;
    if (chapter) this.unlocked.add(chapter);
    if (ending) this.endings.add(ending);
    if (this.unlocked.size + this.endings.size === before) return;
    this.publishUnlocks(story);
    void saveUnlocks({ chapters: [...this.unlocked], endings: [...this.endings] });
  }

  private publishUnlocks(story: Entity): void {
    story.setValue(StoryState, 'unlocked', [...this.unlocked].join(','));
    story.setValue(StoryState, 'endings', [...this.endings].join(','));
  }

  /** Title card with the lamp lit and Mo fluttering, until an XR session starts. */
  private showAttract(story: Entity, stage: Entity): void {
    const started = (story.getValue(StoryState, 'beatIndex') ?? -1) >= 0;
    setIfChanged(story, 'status', StoryStatuses.Waiting);
    setIfChanged(story, 'caption', viewerMode.on ? VIEWER_CAPTION : started ? OUTSIDE_XR_CAPTION : TITLE_CAPTION);
    if (started || this.attract) return;
    this.attract = true;
    stage.setValue(Stage, 'lampLevel', 1);
    for (const m of this.queries.moths.entities) {
      m.setValue(Moth, 'restU', 0.12);
      m.setValue(Moth, 'restV', 0.18);
      m.setValue(Moth, 'mode', 'hovering');
    }
  }

  /** Entering XR: clear the title card so the Prologue (or resume) starts cleanly. */
  private leaveAttract(stage: Entity): void {
    this.attract = false;
    if (this.resumeAt <= 0) stage.setValue(Stage, 'lampLevel', 0);
    for (const m of this.queries.moths.entities) m.setValue(Moth, 'mode', 'hidden');
  }

  /** Another story from the library: load it and start it from the beginning. */
  private switchScript(story: Entity, stage: Entity, path: string): void {
    this.switching = true;
    storyRuntime.script = '';
    storyRuntime.title = '';
    storyRuntime.lines = {};
    storyRuntime.order = [];
    loadStoryScript(path)
      .then((script) => {
        this.script = script;
        this.scriptPath = path;
        storyRuntime.script = path;
        storyRuntime.title = script.title;
        publishLines(script);
        const following = Boolean(story.getValue(StoryState, 'followMode'));
        if (following) {
          // A replay or Live story drives the beats; nothing to restore afterwards in the old script.
          this.beforeFollow = -1;
          story.setValue(StoryState, 'beatIndex', -1);
        } else {
          this.restart(story, stage);
          this.resumeAt = -1;
        }
      })
      .catch((error: unknown) => {
        console.error('[shadowplay] story load failed', error);
        story.setValue(StoryState, 'script', this.scriptPath);
      })
      .finally(() => (this.switching = false));
  }

  /** Story entities may exist before this system registers, so load lazily. */
  private load(story: Entity): void {
    this.loading = true;
    const resume = Boolean(story.getValue(StoryState, 'resume'));
    Promise.all([resume ? loadProgress() : null, loadUnlocks()])
      .then(async ([progress, unlocks]) => {
        // Resume whichever story from the library was being told last.
        const path = progress ? progress.script ?? DEFAULT_SCRIPT : FIRST_LAUNCH_SCRIPT;
        const script = await loadStoryScript(path);
        this.script = script;
        this.scriptPath = path;
        storyRuntime.script = path;
        storyRuntime.title = script.title;
        publishLines(script);
        story.setValue(StoryState, 'script', path);
        for (const c of unlocks.chapters) this.unlocked.add(c);
        for (const e of unlocks.endings) this.endings.add(e);
        this.publishUnlocks(story);
        // Resume at the saved chapter, unless it is the closing card right before the end.
        const finished = script.beats[(progress?.beatIndex ?? 0) + 1]?.type === 'end';
        if (progress && progress.beatIndex > 0 && progress.beatIndex < script.beats.length && !finished) {
          this.resumeAt = progress.beatIndex;
          story.setValue(StoryState, 'branch', progress.branch ?? '');
        }
        story.setValue(StoryState, 'status', StoryStatuses.Waiting);
      })
      .catch((error: unknown) => console.error('[shadowplay] story load failed', error));
  }

  update(frameDelta: number): void {
    // After a hidden session (headset off) the first frame's delta spans the whole
    // absence; the story must pick up where it paused, not skip ahead.
    const delta = Math.min(frameDelta, MAX_STEP_SECONDS);
    const story = first(this.queries.stories.entities);
    const stage = first(this.queries.stages.entities);
    if (story && !this.script && !this.loading) this.load(story);
    if (!story || !stage || !this.script) return;
    const wanted = story.getValue(StoryState, 'script') ?? '';
    if (wanted !== this.scriptPath) {
      if (!this.switching) this.switchScript(story, stage, wanted);
      return;
    }
    const settings = first(this.queries.settings.entities);
    if (settings?.getValue(Settings, 'replayRequested')) {
      settings.setValue(Settings, 'replayRequested', false);
      this.restart(story, stage);
    }
    // Record pressed before the story's first shape: the story starts again from its title, so the recording
    // has all of it (Quest 3, Nov 17: a dreamed story begins at once, and Record came a few lines too late).
    const recording = Boolean(first(this.queries.recorders.entities)?.getValue(PerformanceRecorder, 'recording'));
    if (recording && !this.wasRecording && !story.getValue(StoryState, 'followMode') && this.script) {
      const at = story.getValue(StoryState, 'beatIndex') ?? -1;
      const firstAsk = this.script.beats.findIndex((b) => b.type === 'request' || b.type === 'choice');
      if (at > 0 && firstAsk > 0 && at < firstAsk) {
        this.restart(story, stage);
        storyRuntime.restartedForRecording++;
      }
    }
    this.wasRecording = recording;
    // Chapter select: jump straight to a chapter the player has reached.
    const jumpTo = story.getValue(StoryState, 'jumpTo') ?? '';
    if (jumpTo) {
      story.setValue(StoryState, 'jumpTo', '');
      const index = this.indexOf(jumpTo);
      if (index >= 0 && this.unlocked.has(jumpTo)) {
        this.restart(story, stage);
        if (index > 0) this.resumeAt = index;
      }
    }
    const status = story.getValue(StoryState, 'status');
    if (status === StoryStatuses.Ended) return;
    if (!stageRuntime.ready) {
      setIfChanged(story, 'status', StoryStatuses.Waiting);
      return;
    }

    // Replaying a performance: the player enters each recorded beat at its time;
    // the story makes no decisions of its own (and it works outside XR too).
    const following = Boolean(story.getValue(StoryState, 'followMode'));
    if (following && this.beforeFollow === -2) {
      this.beforeFollow = story.getValue(StoryState, 'beatIndex') ?? -1;
      this.endAssist(story, stage);
    } else if (!following && this.beforeFollow !== -2) {
      // Replay over: back to the start of the chapter the viewer was in.
      const back = this.chapterStart(this.beforeFollow);
      this.beforeFollow = -2;
      this.restart(story, stage);
      if (back > 0) this.resumeAt = back;
      return;
    }
    if (following) {
      const requested = story.getValue(StoryState, 'enterBeat') ?? -1;
      if (requested >= 0) {
        story.setValue(StoryState, 'enterBeat', -1);
        if (this.attract) this.leaveAttract(stage);
        this.enter(story, stage, requested);
      }
      setIfChanged(story, 'status', StoryStatuses.Playing);
      this.beatTime += delta;
      // Join-in moment: the story runs live with the viewer's hands (no saving).
      if (story.getValue(StoryState, 'joinIn')) {
        const index = story.getValue(StoryState, 'beatIndex') ?? -1;
        const beat = this.script.beats[index];
        if (beat) {
          this.watchTracking(beat, delta);
          this.updateAssist(beat, story, stage, delta);
          const next = this.run(beat, story, stage, delta);
          if (next !== null) {
            this.exit(beat, story);
            if (next < this.script.beats.length) this.enter(story, stage, next);
          }
        }
      }
      return;
    }

    // Outside XR (e.g. the hosted link on a desktop): a title card, not the story.
    if (!this.inXR) {
      this.showAttract(story, stage);
      return;
    }
    if (this.attract) this.leaveAttract(stage);

    // Hands first: controllers but no hands pauses the story with a gentle note.
    // (Not with Look to press or voice commands: someone who cannot use their hands may well be holding controllers.)
    const handsFree = accessRuntime.gazeDwell || accessRuntime.voiceState !== 'off';
    this.controllerTime = handRuntime.controllersOnly && !handsFree ? this.controllerTime + delta : 0;
    const needHands = this.controllerTime > CONTROLLER_GRACE_SECONDS;

    const journalOpen = Boolean(first(this.queries.journals.entities)?.getValue(ShadowJournal, 'open'));
    if (story.getValue(StoryState, 'journalOpen') !== journalOpen) story.setValue(StoryState, 'journalOpen', journalOpen);
    // Sound held back: wait (a little) for the pinch that lets the narrator speak. Look to
    // press and voice commands go straight on with captions: a pinch may not be possible.
    if (soundLock.blocked && !soundLock.waived) {
      this.soundWait += delta;
      if (handsFree || this.soundWait > SOUND_WAIT_SECONDS) soundLock.waived = true;
    }
    const needSound = soundLock.blocked && !soundLock.waived;
    const paused = !stage.getValue(Stage, 'lampOn') || away.now || journalOpen || needHands || needSound;
    pauseRuntime.why = !paused ? '' : away.now ? 'away' : !stage.getValue(Stage, 'lampOn') ? 'lamp' : journalOpen ? 'journal' : needHands ? 'hands' : 'sound';
    if (paused) {
      setIfChanged(story, 'status', StoryStatuses.Paused);
      setIfChanged(
        story,
        'caption',
        needHands ? HANDS_CAPTION : journalOpen ? JOURNAL_CAPTION : away.now ? AWAY_CAPTION : needSound ? SOUND_CAPTION : PAUSED_CAPTION,
      );
      return;
    }
    if (status === StoryStatuses.Paused) story.setValue(StoryState, 'caption', this.beatCaption);
    setIfChanged(story, 'status', StoryStatuses.Playing);

    let index = story.getValue(StoryState, 'beatIndex') ?? -1;
    if (index < 0) {
      if (this.resumeAt > 0) {
        // Returning player: the lamp is already lit; start at their chapter, and say so.
        stage.setValue(Stage, 'lampLevel', 1);
        index = this.enter(story, stage, this.resumeAt);
        const resumed = this.script.beats[index];
        if (resumed?.type === 'chapter') {
          this.welcomeBack = true;
          this.setCaption(story, `Welcome back. Continuing from ${resumed.text}. To start again, open the Shadow Journal.`);
        }
        this.resumeAt = -1;
      } else {
        index = this.enter(story, stage, 0);
      }
    }
    const beat = this.script.beats[index];
    if (!beat) return;
    this.beatTime += delta;
    this.watchTracking(beat, delta);
    this.updateAssist(beat, story, stage, delta);
    const next = this.run(beat, story, stage, delta);
    if (next !== null) {
      this.exit(beat, story);
      if (next < this.script.beats.length) this.enter(story, stage, next);
      else story.setValue(StoryState, 'status', StoryStatuses.Ended);
    }
  }

  /** Replay from the Prologue: reset every story-driven actor; keep the journal. */
  private restart(story: Entity, stage: Entity): void {
    this.resumeAt = -1;
    this.beatTime = 0;
    this.holdTime = 0;
    this.growFrom = 0;
    this.lastAliveShape = ShapeIds.None;
    story.setValue(StoryState, 'beatIndex', -1);
    story.setValue(StoryState, 'status', StoryStatuses.Waiting);
    story.setValue(StoryState, 'freeStage', false);
    story.setValue(StoryState, 'branch', '');
    story.setValue(StoryState, 'chapter', '');
    story.setValue(StoryState, 'hintVisible', false);
    this.setCaption(story, '');
    stage.setValue(Stage, 'lampOn', true);
    stage.setValue(Stage, 'lampLevel', 0);
    stage.setValue(Stage, 'finale', 0);
    this.setTargets(stage, ShapeIds.None, ShapeIds.None, ShapeIds.None, ShapeIds.None);
    stage.setValue(ShapeRecognizer, 'freeMode', false);
    for (const p of this.queries.puppets.entities) {
      const alive = p.getValue(ShadowPuppet, 'state') === PuppetStates.Alive;
      p.setValue(ShadowPuppet, 'state', alive ? PuppetStates.Releasing : PuppetStates.Hidden);
    }
    for (const m of this.queries.moths.entities) {
      m.setValue(Moth, 'mode', 'hidden');
      m.setValue(Moth, 'glow', 0);
      m.setValue(Moth, 'followedSeconds', 0);
    }
    for (const e of this.queries.scenery.entities) e.setValue(Scenery, 'set', 'none');
    for (const a of this.queries.actors.entities) a.setValue(StageActor, 'state', 'hidden');
    for (const p of this.queries.props.entities) p.setValue(HiddenProp, 'active', false);
    // A dreamed story waits on its title with the Journal open, for Tell it or Record and tell it (settings.ts).
    if (storyRuntime.keepJournalOpen) storyRuntime.keepJournalOpen = false;
    else for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
    void saveProgress({ beatIndex: 0, chapter: 'Prologue', branch: '', savedAt: Date.now(), script: this.scriptPath });
  }

  private indexOf(id: string): number {
    return this.script!.beats.findIndex((b) => b.id === id);
  }

  private setCaption(story: Entity, text: string): void {
    text = personalise(text);
    if (isDreamed(this.scriptPath)) text = nameInDream(text);
    this.beatCaption = text;
    story.setValue(StoryState, 'caption', text);
  }

  private setTargets(stage: Entity, t1: string, a1: string, t2: string, a2: string): void {
    stage.setValue(ShapeRecognizer, 'target', t1 as never);
    stage.setValue(ShapeRecognizer, 'altTarget', a1 as never);
    stage.setValue(ShapeRecognizer, 'target2', t2 as never);
    stage.setValue(ShapeRecognizer, 'altTarget2', a2 as never);
    stage.setValue(ShapeRecognizer, 'heldFor', 0);
  }

  private showOutline(shape: string, u = 0, v = 0): void {
    const p = this.puppetFor(shape) ?? addWorldPuppet(this.world, shape);
    if (!p) return;
    p.setValue(ShadowPuppet, 'outlineU', u);
    p.setValue(ShadowPuppet, 'outlineV', v);
    if (p.getValue(ShadowPuppet, 'state') !== PuppetStates.Alive) {
      p.setValue(ShadowPuppet, 'state', PuppetStates.Outline);
    }
  }

  private enter(story: Entity, stage: Entity, index: number): number {
    this.dropouts.reset();
    trackingRuntime.lightHint = false;
    const beat = this.script!.beats[index];
    stageRuntime.atEnd = beat?.type === 'end';
    stageRuntime.searching = beat?.type === 'reveal';
    this.beatTime = 0;
    this.welcomeBack = false;
    this.holdTime = 0;
    this.gazeTime = 0;
    accessRuntime.voiceNext = false;
    this.growFrom = 0;
    this.endAssist(story, stage);
    story.setValue(StoryState, 'beatIndex', index);
    story.setValue(StoryState, 'beatId', beat.id);
    if ('text' in beat) this.setCaption(story, beat.text);
    switch (beat.type) {
      case 'chapter':
        story.setValue(StoryState, 'chapter', beat.chapter);
        // A replayed performance must not touch the viewer's own progress.
        if (story.getValue(StoryState, 'followMode')) break;
        this.unlock(story, beat.id, null);
        void saveProgress({
          beatIndex: index,
          chapter: beat.chapter,
          branch: story.getValue(StoryState, 'branch') ?? '',
          savedAt: Date.now(),
          script: this.scriptPath,
        });
        break;
      case 'moth':
        for (const moth of this.queries.moths.entities) {
          moth.setValue(Moth, 'mode', beat.mode as never);
          if (beat.restU !== undefined) moth.setValue(Moth, 'restU', beat.restU);
          if (beat.restV !== undefined) moth.setValue(Moth, 'restV', beat.restV);
        }
        break;
      case 'scenery':
        for (const e of this.queries.scenery.entities) e.setValue(Scenery, 'set', beat.set as never);
        break;
      case 'actor':
        for (const a of this.queries.actors.entities) {
          if (beat.u !== undefined) a.setValue(StageActor, 'u', beat.u);
          if (beat.v !== undefined) a.setValue(StageActor, 'v', beat.v);
          a.setValue(StageActor, 'state', beat.state as never);
        }
        break;
      case 'follow':
        for (const moth of this.queries.moths.entities) {
          moth.setValue(Moth, 'mode', 'following');
          moth.setValue(Moth, 'followedSeconds', 0);
        }
        break;
      case 'request':
        story.setValue(StoryState, 'hintShape', beat.shape);
        this.setTargets(stage, beat.shape, beat.alt ?? ShapeIds.None, ShapeIds.None, ShapeIds.None);
        this.showOutline(beat.shape, beat.outlineU, beat.outlineV);
        break;
      case 'choice': {
        const [a, b] = beat.options;
        story.setValue(StoryState, 'hintShape', a.shape);
        this.setTargets(stage, a.shape, a.alt ?? ShapeIds.None, b?.shape ?? ShapeIds.None, b?.alt ?? ShapeIds.None);
        for (const o of beat.options) this.showOutline(o.shape, o.outlineU, o.outlineV);
        break;
      }
      case 'release':
        this.setTargets(stage, ShapeIds.None, ShapeIds.None, ShapeIds.None, ShapeIds.None);
        for (const p of this.queries.puppets.entities) {
          const state = p.getValue(ShadowPuppet, 'state');
          if (state === PuppetStates.Alive) p.setValue(ShadowPuppet, 'state', PuppetStates.Releasing);
          else if (state === PuppetStates.Outline) p.setValue(ShadowPuppet, 'state', PuppetStates.Hidden);
        }
        break;
      case 'journal': {
        const creature = beat.creature === '$last' ? this.lastAliveShape : beat.creature;
        const text = beat.text.replace('$name', creatureName(creature));
        this.setCaption(story, text);
        for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'pendingAdd', creature);
        break;
      }
      case 'end':
        this.setTargets(stage, ShapeIds.None, ShapeIds.None, ShapeIds.None, ShapeIds.None);
        // A finished story starts from the beginning next time (not "Continuing from The End").
        if (!story.getValue(StoryState, 'followMode')) {
          void saveProgress({ beatIndex: 0, chapter: '', branch: '', savedAt: Date.now(), script: this.scriptPath });
        }
        break;
      case 'prop':
        for (const p of this.queries.props.entities) {
          if (beat.u !== undefined) p.setValue(HiddenProp, 'u', beat.u);
          p.setValue(HiddenProp, 'active', beat.active);
        }
        break;
      case 'freestage':
        // The story is over: Mo keeps her glow and every creature is free to play.
        stage.setValue(Stage, 'lampLevel', 1);
        stage.setValue(Stage, 'finale', 0);
        this.setTargets(stage, ShapeIds.None, ShapeIds.None, ShapeIds.None, ShapeIds.None);
        stage.setValue(ShapeRecognizer, 'freeMode', true);
        story.setValue(StoryState, 'freeStage', true);
        // The world creatures met in their stories may come too (shape-match.ts): their puppets are made now.
        for (const shape of WORLD_CREATURE_IDS) if (!this.puppetFor(shape)) addWorldPuppet(this.world, shape);
        for (const m of this.queries.moths.entities) {
          m.setValue(Moth, 'glow', 1);
          if (m.getValue(Moth, 'mode') === 'hidden') m.setValue(Moth, 'mode', 'hovering');
        }
        if (!story.getValue(StoryState, 'followMode')) {
          void saveProgress({ beatIndex: index, chapter: 'Free Stage', branch: story.getValue(StoryState, 'branch') ?? '', savedAt: Date.now(), script: this.scriptPath });
        }
        break;
      default:
        break;
    }
    return index;
  }

  /** Returns the next beat index when the beat is complete, otherwise null. */
  private run(beat: StoryBeat, story: Entity, stage: Entity, delta: number): number | null {
    const t = this.beatTime;
    const index = story.getValue(StoryState, 'beatIndex') ?? 0;
    const done = index + 1;
    if (GAZE_BEATS.has(beat.type) && accessRuntime.voiceNext) {
      // Voice commands: "go on" does what the movement would.
      accessRuntime.voiceNext = false;
      if (beat.type === 'reveal') for (const p of this.queries.props.entities) p.setValue(HiddenProp, 'revealed', 1);
      return done;
    }
    if (GAZE_BEATS.has(beat.type) && accessRuntime.gazeDwell) {
      // Look to press: no hands needed; resting the gaze on the stage does what the movement would.
      this.gazeTime = accessRuntime.gazeOnStage ? this.gazeTime + delta : 0;
      if (this.gazeTime >= GAZE_BEAT_SECONDS) {
        if (beat.type === 'reveal') for (const p of this.queries.props.entities) p.setValue(HiddenProp, 'revealed', 1);
        return done;
      }
    }
    switch (beat.type) {
      case 'chapter':
        return this.lineFinished(story, beat.id, t, this.welcomeBack ? readingSeconds(this.beatCaption) : CHAPTER_SECONDS) ? done : null;
      case 'narrate':
        return this.lineFinished(story, beat.id, t, beat.seconds ?? readingSeconds(beat.text)) ? done : null;
      case 'release':
      case 'journal':
        return this.lineFinished(story, beat.id, t, readingSeconds(this.beatCaption)) ? done : null;
      case 'lamp':
        stage.setValue(Stage, 'lampLevel', beat.level * flicker(t));
        return t >= LAMP_SECONDS ? done : null;
      case 'moth':
      case 'scenery':
      case 'actor':
        return done;
      case 'goto':
        return this.indexOf(beat.to);
      case 'follow': {
        let followed = 0;
        for (const m of this.queries.moths.entities) followed = Math.max(followed, m.getValue(Moth, 'followedSeconds') ?? 0);
        return followed >= beat.seconds || this.assistLevel >= 3 ? done : null;
      }
      case 'request':
        return this.awaitAlive(story, [beat.shape], t) !== null ? done : null;
      case 'choice': {
        const chosen = this.awaitAlive(story, beat.options.map((o) => o.shape), t);
        if (chosen === null) return null;
        const option = beat.options.find((o) => o.shape === chosen)!;
        story.setValue(StoryState, 'branch', option.goto);
        if (!story.getValue(StoryState, 'followMode')) this.unlock(story, null, option.goto);
        // Keep only the chosen shape requested, so a slipped hand re-forms it.
        this.setTargets(stage, option.shape, option.alt ?? ShapeIds.None, ShapeIds.None, ShapeIds.None);
        for (const o of beat.options) {
          const p = this.puppetFor(o.shape);
          if (o.shape !== chosen && p?.getValue(ShadowPuppet, 'state') === PuppetStates.Outline) {
            p.setValue(ShadowPuppet, 'state', PuppetStates.Hidden);
          }
        }
        return this.indexOf(option.goto);
      }
      case 'grow': {
        const alive = this.alivePuppet();
        const size = alive?.getValue(ShadowPuppet, 'size') ?? 0;
        if (this.growFrom <= 0) this.growFrom = size;
        // Never more than GROW_NEED_MAX of the stage: a creature already big must not need a hand at the eyes.
        const need = Math.min(GROW_NEED_MAX, Math.max(beat.minSize ?? 0, this.growFrom * beat.factor));
        const big = alive !== undefined && size >= need;
        this.holdTime = big ? this.holdTime + delta : 0;
        if (this.assistLevel >= 2 && alive) return done;
        return this.holdTime >= (beat.holdSeconds ?? GROW_HOLD_SECONDS) ? done : null;
      }
      case 'carry': {
        if (this.assistLevel >= 3) return done;
        const obj = this.alivePuppet()?.object3D;
        if (!obj) return null;
        const c = stageRuntime.center;
        const dx = obj.position.x - c.x;
        const dy = obj.position.y - c.y;
        const dz = obj.position.z - c.z;
        const u = (dx * stageRuntime.right.x + dz * stageRuntime.right.z) / stageRuntime.width;
        const v = dy / stageRuntime.height;
        return u >= beat.toU && (beat.minV === undefined || v >= beat.minV) ? done : null;
      }
      case 'continue': {
        const open = openInLight(stage, 'left') || openInLight(stage, 'right');
        this.holdTime = open ? this.holdTime + delta : 0;
        return this.holdTime >= CONTINUE_HOLD_SECONDS ? done : null;
      }
      case 'reveal': {
        let revealed = 0;
        for (const p of this.queries.props.entities) revealed = Math.max(revealed, p.getValue(HiddenProp, 'revealed') ?? 0);
        if (this.assistLevel >= 3) {
          for (const p of this.queries.props.entities) p.setValue(HiddenProp, 'revealed', 1);
          return done;
        }
        this.holdTime = revealed >= 0.8 ? this.holdTime + delta : 0;
        return this.holdTime >= REVEAL_HOLD_SECONDS ? done : null;
      }
      case 'letgo': {
        const open = handOpened(stage, 'left') || handOpened(stage, 'right');
        this.holdTime = open ? this.holdTime + delta : 0;
        return this.holdTime >= LETGO_HOLD_SECONDS ? done : null;
      }
      case 'finale': {
        const f = Math.min(1, t / beat.seconds);
        const eased = f * f * (3 - 2 * f);
        stage.setValue(Stage, 'finale', eased);
        for (const m of this.queries.moths.entities) m.setValue(Moth, 'glow', eased);
        return f >= 1 ? done : null;
      }
      case 'end':
      case 'freestage':
        return null;
      default:
        return done;
    }
  }

  /**
   * A timed line is finished once its reading time has passed and its narration
   * (if any) has ended, capped so a stuck clip can never stall the story.
   */
  private lineFinished(story: Entity, beatId: string, t: number, minSeconds: number): boolean {
    if (t < minSeconds) return false;
    if (t >= minSeconds * 3 + 5) return true;
    // Recording with their voice, the parent reads the line: it ends once they pause, not mid-sentence (Nov 17).
    if (readerRuntime.listening) {
      const reading = performance.now() - readerRuntime.lastSpokeAt < READER_PAUSE_MS;
      if (reading) readerRuntime.waits++;
      return !reading;
    }
    if (story.getValue(StoryState, 'voiceBeat') !== beatId) return t > minSeconds + 0.25;
    return Boolean(story.getValue(StoryState, 'voiceDone'));
  }

  /** Player beats that can stall on recognition or dexterity. */
  private isPlayerBeat(beat: StoryBeat): boolean {
    return ['request', 'choice', 'grow', 'carry', 'reveal', 'follow'].includes(beat.type);
  }

  /**
   * 'Never stuck': the longer a player beat waits, the more forgiving the
   * story becomes. Levels 1-2 loosen recognition; level 3 lets any hand held
   * still in the light summon the requested creature (and finishes the other
   * player beats), so unknown real-hand accuracy can never strand anyone.
   */
  private updateAssist(beat: StoryBeat, story: Entity, stage: Entity, delta: number): void {
    if (!this.isPlayerBeat(beat)) return;
    const t = this.beatTime;
    const level = t >= ASSIST_AFTER[2] ? 3 : t >= ASSIST_AFTER[1] ? 2 : t >= ASSIST_AFTER[0] ? 1 : 0;
    if (level !== this.assistLevel) {
      this.assistLevel = level;
      story.setValue(StoryState, 'assist', level);
      // Added to the player's own setting by the matcher, so Settings changes apply at once.
      stage.setValue(ShapeRecognizer, 'assistTolerance', ASSIST_TOLERANCE[Math.min(level, 2)]);
    }
    if (level < 3 || (beat.type !== 'request' && beat.type !== 'choice')) return;
    if (stage.getValue(ShapeRecognizer, 'matchedHand') !== 'none') return;
    for (const side of ['left', 'right'] as const) {
      const hand = handRuntime[side];
      const lit = stage.getValue(ShapeRecognizer, side === 'left' ? 'leftInLight' : 'rightInLight');
      this.wrist.fromArray(hand.joints, 0);
      // lastWrist is where the hand settled; moving away from it starts the count again.
      const settled = this.stillTime[side] > 0 && this.wrist.distanceTo(this.lastWrist[side]) <= STILL_RADIUS;
      if (!settled) this.lastWrist[side].copy(this.wrist);
      this.stillTime[side] = hand.tracked && lit ? (settled ? this.stillTime[side] + delta : 1e-6) : 0;
      if (this.stillTime[side] >= STILL_SECONDS) {
        const shape = beat.type === 'request' ? beat.shape : beat.options[0].shape;
        stage.setValue(ShapeRecognizer, 'matchedHand', side);
        stage.setValue(ShapeRecognizer, 'matchedShape', shape as never);
        stage.setValue(ShapeRecognizer, 'twoHanded', false);
        this.stillTime[side] = 0;
        return;
      }
    }
  }

  /** Back to the player's own tolerance when a beat ends. */
  private endAssist(story: Entity, stage: Entity): void {
    if ((stage.getValue(ShapeRecognizer, 'assistTolerance') ?? 0) !== 0) stage.setValue(ShapeRecognizer, 'assistTolerance', 0);
    this.assistLevel = 0;
    this.stillTime.left = this.stillTime.right = 0;
    if (story.getValue(StoryState, 'assist') !== 0) story.setValue(StoryState, 'assist', 0);
  }

  /**
   * During a shape request, hands that keep flickering in and out of tracking
   * (a dim room, most likely) get the ghost hand at once and a line suggesting
   * a light. Recognition itself is unchanged.
   */
  private watchTracking(beat: StoryBeat, delta: number): void {
    const asking = beat.type === 'request' || beat.type === 'choice';
    const struggling = asking && this.dropouts.step(delta, handRuntime.left.tracked, handRuntime.right.tracked);
    trackingRuntime.lightHint = struggling && !this.alivePuppet();
  }

  /** Waits for one of the shapes to come alive; shows the hint when stuck. */
  private awaitAlive(story: Entity, shapes: string[], t: number): string | null {
    const alive = shapes.find((s) => this.puppetFor(s)?.getValue(ShadowPuppet, 'state') === PuppetStates.Alive);
    const setting = story.getValue(StoryState, 'hintAfterSeconds') ?? 15;
    const hintAfter = this.firstWoken || setting < 0 ? setting : Math.min(setting, FIRST_HINT_SECONDS);
    const stuck = hintAfter >= 0 && (t >= hintAfter || trackingRuntime.lightHint);
    story.setValue(StoryState, 'hintVisible', alive === undefined && stuck);
    if (alive === undefined || t <= 0.3) return null;
    this.firstWoken = true;
    this.lastAliveShape = alive;
    // A world creature joins the Shadow Journal the first time a child wakes it (the
    // first creatures join through The Moth's journal pages, and in Free Stage).
    if (WORLD_CREATURE_IDS.has(alive) && !story.getValue(StoryState, 'followMode')) {
      for (const j of this.queries.journals.entities) {
        if (!(j.getValue(ShadowJournal, 'discovered') ?? '').split(',').includes(alive)) j.setValue(ShadowJournal, 'pendingAdd', alive);
      }
    }
    return alive;
  }

  private exit(beat: StoryBeat, story: Entity): void {
    if (beat.type === 'request' || beat.type === 'choice') story.setValue(StoryState, 'hintVisible', false);
  }

  private alivePuppet(): Entity | undefined {
    for (const p of this.queries.puppets.entities) {
      if (p.getValue(ShadowPuppet, 'state') === PuppetStates.Alive) return p;
    }
    return undefined;
  }

  /**
   * A world creature's puppet (world-creatures.ts), made the first time a story
   * asks for it: the scene holds only the first creatures', so a headset that
   * never meets a rocket never builds one.
   */
  private puppetFor(shape: string): Entity | undefined {
    for (const p of this.queries.puppets.entities) {
      if (p.getValue(ShadowPuppet, 'shape') === shape) return p;
    }
    return undefined;
  }
}

/** Write a StoryState string/enum field only when it changes. */
function setIfChanged(story: Entity, field: 'status' | 'caption', value: string): void {
  if (story.getValue(StoryState, field) !== value) story.setValue(StoryState, field, value as never);
}

/** An open hand held in the lamp light (to continue to the next chapter). */
/**
 * "Raise an open hand into the light to go on": an uncurled hand in the light,
 * fingers together or spread (handOpened). A palm raised toward the wall is
 * usually flat with the fingers together, read as a fish, and was not counted
 * (Quest 3, Nov 16: go-on steps waited 8 to 21 s for a spread-finger pose).
 */
function openInLight(stage: Entity, side: 'left' | 'right'): boolean {
  return Boolean(stage.getValue(ShapeRecognizer, side === 'left' ? 'leftInLight' : 'rightInLight')) && handOpened(stage, side);
}

/** Hands opened (one open hand, or both as the open-winged pair). */
/**
 * "Open your hands": fingers open, however they are held. People open their
 * hands flat with the fingers together (read as a fish), not spread, so this
 * looks at how curled the fingers are rather than at the shape (Quest 3, Nov 15:
 * open hands waited 75 s for a spread-finger pose).
 */
const OPEN_MAX_CURL = 0.3;

const isDreamed = (path: string) => path.startsWith('dreamed');

/** The script's spoken words, names filled in, for the narrator (narration.ts). */
function publishLines(script: StoryScript): void {
  storyRuntime.lines = {};
  storyRuntime.order = [];
  for (const beat of script.beats) {
    const text = 'text' in beat && typeof beat.text === 'string' ? beat.text : '';
    if (!text || beat.type === 'journal') continue;
    const words = personalise(text);
    storyRuntime.lines[beat.id] = isDreamed(storyRuntime.script) ? nameInDream(words) : words;
    storyRuntime.order.push(beat.id);
  }
}

function handOpened(stage: Entity, side: 'left' | 'right'): boolean {
  const shape = stage.getValue(ShapeRecognizer, side === 'left' ? 'leftShape' : 'rightShape');
  if (shape === ShapeIds.Open || shape === ShapeIds.Bird) return true;
  const hand = handRuntime[side];
  if (!hand.tracked) return false;
  const f = hand.features;
  return (f[1] + f[2] + f[3] + f[4]) / 4 <= OPEN_MAX_CURL;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
