import { createSystem, Vector3, VisibilityState } from '@iwsdk/core';
import { audioRunning, gesture, Hum, Lullaby, setListener, startLampHum, startLullaby, wakeAudio } from './sfx.js';
import { LiveSession, PerformanceRecorder, Settings, Stage, StoryState, StoryStatuses } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';

/** Lullaby level under the narrator's (or a recorded storyteller's) voice, and while paused. */
const UNDER_VOICE = 0.35;
const PAUSED = 0.5;

/**
 * Spatial audio upkeep: keeps the Web Audio listener on the viewer's head so
 * placed sounds come from the wall or the desk, runs the lamp's faint hum at
 * the bulb, following its brightness (silent when switched off), and sets the
 * lullaby's level: under the story, lower under a voice and while paused, and
 * silent whenever the microphone is in use (recording with voice, or Talk) so
 * it never ends up in a recording. Off with Music off in Settings.
 */
export class AudioSystem extends createSystem({
  stages: { required: [Stage] },
  settings: { required: [Settings] },
  stories: { required: [StoryState] },
  recorders: { required: [PerformanceRecorder] },
  lives: { required: [LiveSession] },
}) {
  private head = new Vector3();
  private forward = new Vector3();
  private up = new Vector3();
  private hum: Hum | null = null;
  private lullaby: Lullaby | null = null;
  private retry = 0;
  private session: XRSession | undefined;
  private readonly onGesture = () => gesture();

  init(): void {
    // A pinch (select) or grip in the headset, or a tap or key on the page, is the gesture sound needs.
    window.addEventListener('pointerdown', this.onGesture);
    window.addEventListener('keydown', this.onGesture);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', this.onGesture);
      window.removeEventListener('keydown', this.onGesture);
      this.watchSession(undefined);
    });
  }

  private watchSession(session: XRSession | undefined): void {
    if (session === this.session) return;
    this.session?.removeEventListener('selectstart', this.onGesture);
    this.session?.removeEventListener('squeezestart', this.onGesture);
    this.session = session;
    session?.addEventListener('selectstart', this.onGesture);
    session?.addEventListener('squeezestart', this.onGesture);
  }

  update(delta: number): void {
    this.watchSession(this.world.session);
    if (!audioRunning()) {
      // Entering XR counts as the gesture: start the context then, not at the first sound effect.
      this.retry -= delta;
      if (this.retry <= 0 && this.world.visibilityState.peek() !== VisibilityState.NonImmersive) {
        this.retry = 1;
        wakeAudio();
      }
      return;
    }
    const headObj = this.player.head;
    headObj.updateWorldMatrix(true, false);
    this.head.setFromMatrixPosition(headObj.matrixWorld);
    // Object3D world direction is +Z; the viewer looks down -Z.
    headObj.getWorldDirection(this.forward).negate();
    this.up.set(0, 1, 0).transformDirection(headObj.matrixWorld);
    setListener(this.head, this.forward, this.up);

    this.hum ??= startLampHum();
    const stage = this.queries.stages.entities.values().next().value;
    if (this.hum) {
      const on = stage?.getValue(Stage, 'lampOn') ?? false;
      const level = stage?.getValue(Stage, 'lampLevel') ?? 0;
      this.hum.setPosition(stageRuntime.bulb);
      this.hum.setLevel(stageRuntime.ready && on ? level : 0);
    }

    this.lullaby ??= startLullaby();
    this.lullaby?.setLevel(this.lullabyLevel());
  }

  private lullabyLevel(): number {
    const settings = this.queries.settings.entities.values().next().value;
    const story = this.queries.stories.entities.values().next().value;
    if (!settings?.getValue(Settings, 'music') || !story || !stageRuntime.ready) return 0;
    const status = story.getValue(StoryState, 'status');
    if (status !== StoryStatuses.Playing && status !== StoryStatuses.Paused) return 0;
    // The microphone is open: keep the music out of the recording or the call.
    for (const r of this.queries.recorders.entities) {
      if (r.getValue(PerformanceRecorder, 'recording') && r.getValue(PerformanceRecorder, 'withVoice')) return 0;
    }
    for (const l of this.queries.lives.entities) if (l.getValue(LiveSession, 'talk')) return 0;
    if (status === StoryStatuses.Paused) return PAUSED;
    const speaking = story.getValue(StoryState, 'voiceBeat') === story.getValue(StoryState, 'beatId') && !story.getValue(StoryState, 'voiceDone');
    return speaking || story.getValue(StoryState, 'followMode') ? UNDER_VOICE : 1;
  }
}
