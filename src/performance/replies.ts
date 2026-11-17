import { createSystem, Entity } from '@iwsdk/core';
import { loadStoryScript, StoryBeat, storyRuntime } from '../story-script.js';
import { listRecordings, loadRecording, saveRecording } from '../journal-store.js';
import { FamilyInbox, LiveSession, PerformancePlayer, ShadowJournal, StoryState } from '../shadowplay-components.js';
import type { Performance } from './format.js';
import { seedSamples } from './samples.js';
import { fetchReplies } from './sharing.js';
import { receiveGifts } from '../gifts-received.js';
import { learnFromGoodnight, requestsRuntime } from '../story-requests.js';

/** Look for new goodnights this often (ms), only while the page is open. */
const POLL_MS = 90_000;
/** Shared stories expire after 30 days, and so do their replies. */
const MAX_AGE_MS = 30 * 86_400_000;

/**
 * The storyteller's inbox: for each story this device sent, fetch the
 * goodnights the family sent back, keep them on the device, and play the
 * oldest unwatched one on the wall when asked.
 */
export class FamilyInboxSystem extends createSystem({
  inboxes: { required: [FamilyInbox] },
  players: { required: [PerformancePlayer] },
  stories: { required: [StoryState] },
  sessions: { required: [LiveSession] },
  journals: { required: [ShadowJournal] },
}) {
  /** Beat types of the running story (for the waiting-goodnight cue). */
  private beatTypes = new Map<string, StoryBeat['type']>();
  private typesFor = '';
  private cuedBeat = '';
  private nextPoll = 0;
  private polling = false;
  /** Goodnight ids waiting to be watched, oldest first. */
  private unwatched: { id: string; from: string }[] = [];
  private playing = '';

  update(): void {
    const inbox = this.queries.inboxes.entities.values().next().value;
    const player = this.queries.players.entities.values().next().value;
    if (!inbox || !player) return;
    const now = performance.now();
    if (now >= this.nextPoll && !this.polling) {
      this.nextPoll = now + POLL_MS;
      void this.poll(inbox);
    }
    if (inbox.getValue(FamilyInbox, 'playRequested')) {
      inbox.setValue(FamilyInbox, 'playRequested', false);
      const next = this.unwatched[0];
      if (next && !player.getValue(PerformancePlayer, 'playing')) {
        this.playing = next.id;
        player.setValue(PerformancePlayer, 'recordingId', next.id);
        player.setValue(PerformancePlayer, 'joinIn', false);
        player.setValue(PerformancePlayer, 'paused', false);
        player.setValue(PerformancePlayer, 'playing', true);
        // The goodnight plays on the wall: the Journal steps aside, or its pages cover it (Quest, Nov 16).
        for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
      }
    }
    this.cue(inbox);
    // Watched to the end (or stopped): it leaves the unwatched list.
    if (this.playing && !player.getValue(PerformancePlayer, 'playing')) {
      void this.markWatched(this.playing);
      this.unwatched = this.unwatched.filter((u) => u.id !== this.playing);
      this.playing = '';
      this.publish(inbox);
    }
  }

  /**
   * At the story's natural pauses (between chapters, the end, Free Stage) tell
   * the storyteller a goodnight is waiting, and where to find it.
   */
  private cue(inbox: Entity): void {
    const story = this.queries.stories.entities.values().next().value;
    const ask = requestsRuntime.pending;
    if (!story || (!this.unwatched.length && !ask) || story.getValue(StoryState, 'followMode')) return;
    if (this.queries.sessions.entities.values().next().value?.getValue(LiveSession, 'role') !== 'off') return;
    const script = storyRuntime.script;
    if (script && script !== this.typesFor) {
      this.typesFor = script;
      this.beatTypes.clear();
      void loadStoryScript(script).then((s) => {
        if (this.typesFor === script) for (const b of s.beats) this.beatTypes.set(b.id, b.type);
      }).catch(() => undefined);
    }
    const beat = story.getValue(StoryState, 'beatId') ?? '';
    const type = this.beatTypes.get(beat);
    if (beat === this.cuedBeat || (type !== 'continue' && type !== 'freestage' && type !== 'end')) return;
    this.cuedBeat = beat;
    const from = inbox.getValue(FamilyInbox, 'latestFrom') || 'your family';
    const caption = story.getValue(StoryState, 'caption') ?? '';
    const waiting = this.unwatched.length ? `A goodnight from ${from} is waiting: pinch your Shadow Journal to watch it.` : '';
    const asked = ask ? `${ask.from || 'Your family'} asked for a story: pinch your Shadow Journal, then Dream a new one.` : '';
    story.setValue(StoryState, 'caption', `${caption}  ${waiting} ${asked}`.replace(/\s+/g, ' ').trim());
  }

  private async poll(inbox: Entity): Promise<void> {
    this.polling = true;
    try {
      await seedSamples('headset');
      const all = await listRecordings<Performance & { watched?: boolean }>();
      const cutoff = Date.now() - MAX_AGE_MS;
      const shared = all.filter((p) => p.shareCode && !p.replyTo && p.createdAt > cutoff);
      for (const story of shared) {
        for (const reply of await fetchReplies(story.shareCode!)) {
          if (await loadRecording(reply.id)) continue;
          await saveRecording({ ...reply, watched: false });
        }
      }
      // The child's gifts (Mo's colours, a drawn creature) are taken as soon as the goodnight arrives.
      const arrived = (await listRecordings<Performance & { giftsTaken?: boolean }>()).sort((a, b) => a.createdAt - b.createdAt);
      for (const p of arrived) {
        if (!p.replyTo || p.giftsTaken || (!p.mo && !p.drawing)) continue;
        await receiveGifts(p);
        await saveRecording({ ...p, giftsTaken: true });
      }
      // The story the child asks for next waits in the journal; the child's taste learns from every goodnight.
      for (const p of (await listRecordings<Performance & { learned?: boolean }>()).sort((a, b) => a.createdAt - b.createdAt)) {
        if (!p.replyTo || p.learned) continue;
        await learnFromGoodnight(p);
        await saveRecording({ ...p, learned: true });
      }
      const fresh = (await listRecordings<Performance & { watched?: boolean }>())
        .filter((p) => p.replyTo && !p.watched)
        .sort((a, b) => a.createdAt - b.createdAt);
      this.unwatched = fresh.map((p) => ({ id: p.id, from: p.performer }));
      this.publish(inbox);
    } catch {
      // Offline: try again at the next poll.
    } finally {
      this.polling = false;
    }
  }

  private publish(inbox: Entity): void {
    inbox.setValue(FamilyInbox, 'unwatched', this.unwatched.length);
    inbox.setValue(FamilyInbox, 'latestFrom', this.unwatched[this.unwatched.length - 1]?.from ?? '');
  }

  private async markWatched(id: string): Promise<void> {
    const perf = await loadRecording<Performance>(id);
    if (perf) await saveRecording({ ...perf, watched: true });
  }
}
