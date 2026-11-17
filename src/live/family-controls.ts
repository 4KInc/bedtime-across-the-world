import { createSystem, Entity, UIKit, UIKitMLAsset } from '@iwsdk/core';
import { listRecordings } from '../journal-store.js';
import type { Performance } from '../performance/format.js';
import { recordingsRuntime } from '../performance/recorder.js';
import { FamilyInbox, LiveSession, PerformancePlayer, PerformanceRecorder, ShadowJournal } from '../shadowplay-components.js';
import { playClick } from '../sfx.js';
import { palette } from '../panel-palette.js';
import { accessRuntime, gazeTargets, uiPresses } from '../stage-runtime.js';
import { recordingName, storyNames } from '../story-names.js';


const PANEL_NODE = 'settings-panel';

interface Control {
  button: UIKit.Container;
  label: UIKit.Text | undefined;
}

/** A recording made on this headset (not a goodnight received, not a sample). */
interface Saved {
  id: string;
  title: string;
  createdAt: number;
  seconds: number;
  voice: boolean;
  sent: boolean;
}

/**
 * The 'For your family' controls at the top of the settings panel: record a
 * bedtime story and send it, or go live and talk. Everything starts from a
 * press by the parent; the microphone opens only for recording with voice or
 * when Talk is switched on. Every recording is kept on the headset; the
 * recordings row picks which one Play replays and Send sends (newest first, so
 * after a reload Send still has the last story told).
 */
export class FamilyControlsSystem extends createSystem({
  recorders: { required: [PerformanceRecorder] },
  sessions: { required: [LiveSession] },
  inboxes: { required: [FamilyInbox] },
  players: { required: [PerformancePlayer] },
  journals: { required: [ShadowJournal] },
}) {
  private controls = new Map<string, Control>();
  private status: UIKit.Text | undefined;
  private bound = false;
  private shown = '';
  private lastLive = '';
  private lastRec = '';
  private message = 'Record a bedtime story, or go live with your family.';
  private lastUnwatched = 0;
  private recordings: Saved[] = [];
  private index = -1;
  /** The chosen id and its family code when the list was last read (a new recording or a send re-reads it). */
  private listedFor = '';
  private listing = false;
  private listed = false;
  private recTitle: UIKit.Text | undefined;
  private recInfo: UIKit.Text | undefined;
  /** The recording Play started on the wall ('' when none). */
  private playing = '';

  update(): void {
    const rec = first(this.queries.recorders.entities);
    const live = first(this.queries.sessions.entities);
    if (!rec || !live) return;
    if (!this.bound) this.bind(rec, live);
    if (!this.bound) return;
    const player = first(this.queries.players.entities);
    if (this.playing && !player?.getValue(PerformancePlayer, 'playing')) this.playing = '';
    const chosen = `${rec.getValue(PerformanceRecorder, 'lastId') ?? ''}|${rec.getValue(PerformanceRecorder, 'shareCode') ?? ''}`;
    if (!this.listing && (!this.listed || chosen !== this.listedFor)) void this.list(rec, chosen);
    this.refresh(rec, live);
  }

  /** Read the recordings kept on this headset, newest first, and choose the one Send will send. */
  private async list(rec: Entity, chosen: string): Promise<void> {
    this.listing = true;
    try {
      const [all, names] = await Promise.all([listRecordings<Performance>(), storyNames()]);
      // Named by the story told (their own titles are usually the same "A story for ..."), else by their title.
      const name = (p: Performance) => recordingName(p, names);
      this.recordings = all
        .filter((p) => !p.replyTo && !p.sample && p.version)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((p) => ({ id: p.id, title: name(p), createdAt: p.createdAt, seconds: Math.round(p.durationMs / 1000), voice: Boolean(p.audio), sent: Boolean(p.shareCode) }));
    } catch {
      this.recordings = [];
    }
    const id = rec.getValue(PerformanceRecorder, 'lastId') ?? '';
    this.index = this.recordings.findIndex((r) => r.id === id);
    if (this.index < 0 && this.recordings.length) {
      this.index = 0;
      rec.setValue(PerformanceRecorder, 'lastId', this.recordings[0].id);
    }
    this.listedFor = `${rec.getValue(PerformanceRecorder, 'lastId') ?? ''}|${chosen.split('|')[1] ?? ''}`;
    this.listed = true;
    this.listing = false;
    this.shown = '';
  }

  /** Choose the previous or next recording (newest first). */
  private step(rec: Entity, by: number): void {
    if (rec.getValue(PerformanceRecorder, 'recording') || this.recordings.length < 2) return;
    this.index = Math.min(this.recordings.length - 1, Math.max(0, this.index + by));
    const id = this.recordings[this.index].id;
    rec.setValue(PerformanceRecorder, 'lastId', id);
    this.listedFor = `${id}|${rec.getValue(PerformanceRecorder, 'shareCode') ?? ''}`;
    this.shown = '';
  }

  /** Play the chosen recording on the wall (or stop it). */
  private playChosen(rec: Entity, live: Entity): void {
    const player = first(this.queries.players.entities);
    const chosen = this.recordings[this.index];
    if (!player || !chosen || rec.getValue(PerformanceRecorder, 'recording') || live.getValue(LiveSession, 'role') !== 'off') return;
    if (this.playing) {
      player.setValue(PerformancePlayer, 'playing', false);
      this.playing = '';
    } else if (!player.getValue(PerformancePlayer, 'playing')) {
      this.playing = chosen.id;
      player.setValue(PerformancePlayer, 'recordingId', chosen.id);
      player.setValue(PerformancePlayer, 'joinIn', false);
      player.setValue(PerformancePlayer, 'paused', false);
      player.setValue(PerformancePlayer, 'playing', true);
      // It plays on the wall: the Journal steps aside (open it again to stop).
      for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
    }
    this.shown = '';
  }

  private bind(rec: Entity, live: Entity): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE);
    if (!panel) return;
    const on = (id: string, labelId: string, handler: () => void) => {
      const button = panel.getElementById<UIKit.Container>(id);
      if (!button) return;
      button.name = id;
      const label = panel.getElementById<UIKit.Text>(labelId) ?? undefined;
      if (label) label.name = labelId;
      this.controls.set(id, { button, label });
      const click = () => {
        playClick(rec.object3D?.position);
        uiPresses.push(id);
        if (uiPresses.length > 50) uiPresses.shift();
        handler();
      };
      button.addEventListener('click', click);
      gazeTargets.set(id, { object: button, press: click });
      this.cleanupFuncs.push(() => gazeTargets.delete(id));
      this.cleanupFuncs.push(() => button.removeEventListener('click', click));
    };
    on('record-button', 'record-label', () => {
      if (live.getValue(LiveSession, 'role') !== 'off') return;
      rec.setValue(PerformanceRecorder, 'recording', !rec.getValue(PerformanceRecorder, 'recording'));
    });
    on('send-button', 'send-label', () => {
      if (rec.getValue(PerformanceRecorder, 'lastId') && !rec.getValue(PerformanceRecorder, 'recording')) {
        rec.setValue(PerformanceRecorder, 'shareRequested', true);
      }
    });
    on('rec-prev', '', () => this.step(rec, -1));
    on('rec-next', '', () => this.step(rec, 1));
    on('rec-play', 'rec-play-label', () => this.playChosen(rec, live));
    this.recTitle = panel.getElementById<UIKit.Text>('rec-title') ?? undefined;
    this.recInfo = panel.getElementById<UIKit.Text>('rec-info') ?? undefined;
    on('inbox-button', 'inbox-label', () => {
      if (rec.getValue(PerformanceRecorder, 'recording') || live.getValue(LiveSession, 'role') !== 'off') return;
      for (const inbox of this.queries.inboxes.entities) inbox.setValue(FamilyInbox, 'playRequested', true);
    });
    on('live-button', 'live-label', () => {
      if (rec.getValue(PerformanceRecorder, 'recording')) return;
      live.setValue(LiveSession, 'role', live.getValue(LiveSession, 'role') === 'off' ? 'host' : 'off');
    });
    on('duet-button', 'duet-label', () => live.setValue(LiveSession, 'duet', !live.getValue(LiveSession, 'duet')));
    on('talk-button', 'talk-label', () => {
      if (live.getValue(LiveSession, 'role') === 'off') return;
      live.setValue(LiveSession, 'talk', !live.getValue(LiveSession, 'talk'));
    });
    this.status = panel.getElementById<UIKit.Text>('family-status') ?? undefined;
    if (this.status) this.status.name = 'family-status';
    this.bound = this.controls.size > 0;
    this.shown = '';
  }

  private refresh(rec: Entity, live: Entity): void {
    const recording = Boolean(rec.getValue(PerformanceRecorder, 'recording'));
    const seconds = Math.floor(rec.getValue(PerformanceRecorder, 'seconds') ?? 0);
    const hasStory = Boolean(rec.getValue(PerformanceRecorder, 'lastId'));
    const role = live.getValue(LiveSession, 'role') ?? 'off';
    const talk = Boolean(live.getValue(LiveSession, 'talk'));
    const duet = Boolean(live.getValue(LiveSession, 'duet'));
    const turn = live.getValue(LiveSession, 'turn') ?? 'host';
    const liveStatus = live.getValue(LiveSession, 'status') ?? '';
    const recStatus = rec.getValue(PerformanceRecorder, 'status') ?? '';
    const inbox = this.queries.inboxes.entities.values().next().value;
    const unwatched = inbox?.getValue(FamilyInbox, 'unwatched') ?? 0;
    const from = inbox?.getValue(FamilyInbox, 'latestFrom') ?? '';
    const key = `${accessRuntime.highContrast}|${recording}|${seconds}|${hasStory}|${role}|${talk}|${duet}|${turn}|${unwatched}|${liveStatus}|${recStatus}|${this.index}|${this.recordings.length}|${this.playing}`;
    if (key === this.shown) return;
    this.shown = key;

    const isLive = role !== 'off';
    this.set('record-button', recording ? `Stop recording ${clock(seconds)}` : 'Record a story', recording ? 'on' : isLive ? 'dim' : 'off');
    this.set('send-button', 'Send to family', hasStory && !recording ? 'off' : 'dim');
    this.set('inbox-button', unwatched ? `Goodnights (${unwatched})` : 'Goodnights', unwatched && !recording && !isLive ? 'on' : 'dim');
    this.showRecordings(recording || isLive);
    this.set('live-button', isLive ? 'End live story' : 'Go live', isLive ? 'on' : recording ? 'dim' : 'off');
    this.set('talk-button', `Talk: ${talk ? 'On' : 'Off'}`, talk ? 'on' : isLive ? 'off' : 'dim');
    this.set('duet-button', turn === 'guest' ? 'Their turn' : `Take turns: ${duet ? 'On' : 'Off'}`, duet ? 'on' : 'off');
    // Whichever news is newest.
    if (unwatched > this.lastUnwatched) {
      this.message = `${from || 'Your family'} sent you a goodnight! Pinch Goodnights to watch.`;
    } else if (liveStatus !== this.lastLive && liveStatus) this.message = liveStatus;
    else if (recStatus !== this.lastRec && recStatus) this.message = recStatus;
    this.lastUnwatched = unwatched;
    this.lastLive = liveStatus;
    this.lastRec = recStatus;
    this.status?.setProperties({ text: this.message });
  }

  /** The recordings row: which one is chosen (newest first), when it was made, how long, and whether it was sent. */
  private showRecordings(busy: boolean): void {
    const n = this.recordings.length;
    const r = this.recordings[this.index];
    const title = r ? (n > 1 ? `${this.index + 1} of ${n}: ${r.title}` : r.title) : 'No recordings yet';
    const info = r
      ? `${when(r.createdAt)} · ${clock(r.seconds)}${r.voice ? ' · with voice' : ''} · ${r.sent ? 'sent' : 'not sent yet'}`
      : 'Record a story: it stays on this headset until you send it.';
    this.recTitle?.setProperties({ text: title });
    this.recInfo?.setProperties({ text: info });
    this.set('rec-prev', '', n > 1 && this.index > 0 && !busy ? 'off' : 'dim');
    this.set('rec-next', '', n > 1 && this.index < n - 1 && !busy ? 'off' : 'dim');
    this.set('rec-play', this.playing ? 'Stop' : 'Play', this.playing ? 'on' : r && !busy ? 'off' : 'dim');
    Object.assign(recordingsRuntime, { count: n, index: this.index, chosen: r?.id ?? '', title, info, playing: this.playing });
  }

  /** Show a line in the family status (repainted on the next update). */
  private say(text: string): void {
    this.message = text;
    this.shown = '';
  }

  private set(id: string, text: string, state: 'on' | 'off' | 'dim'): void {
    const c = this.controls.get(id);
    if (!c) return;
    const p = palette();
    const style = state === 'on' ? p.selected : state === 'dim' ? p.locked : p.unselected;
    c.button.setProperties({ backgroundColor: style.backgroundColor, borderColor: style.borderColor });
    c.label?.setProperties({ text, color: state === 'on' ? p.ink : state === 'dim' ? p.muted : p.cream });
  }
}

/** 'Today 9:41 pm', 'Yesterday 8:02 pm', or 'Nov 14 7:30 pm'. */
function when(at: number): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  if (at >= day.getTime()) return `Today ${time}`;
  if (at >= day.getTime() - 86_400_000) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function clock(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}
