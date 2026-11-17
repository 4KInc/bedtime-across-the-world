import { loadRequests, saveRequests } from './journal-store.js';
import type { Performance } from './performance/format.js';
import { checkAsk, type StoryAsk } from './story-checks.js';

/**
 * A child asks for tomorrow's story ("Dad, tell me a story about Mo at the
 * carnival"), with a goodnight from the family viewer; the storyteller's
 * headset keeps the request until it is dreamed. And each child's taste: what
 * they asked for and what they made with their hands, so Mo can suggest
 * stories this child would like (server/dream.ts suggest). All of it stays on
 * this headset; only the taste's counts and the child's own (softened) ideas
 * are sent, to ask for suggestions, never a name.
 */

/** A request waiting to be dreamed: who asked, and what. */
export interface PendingAsk extends StoryAsk {
  /** The goodnight it came with. */
  id: string;
  from: string;
  at: number;
}

/** A child's taste: how often each place and creature came up, and their last few ideas, newest first. */
export interface ChildTaste {
  places: Record<string, number>;
  creatures: Record<string, number>;
  ideas: string[];
  updatedAt: number;
}

/** A story Mo suggests for a child (server/dream.ts Suggestion). */
export interface Suggestion {
  title: string;
  idea: string;
  theme: string;
  shapes: string[];
  why: string;
}

interface Stored {
  asks: PendingAsk[];
  tastes: Record<string, ChildTaste>;
}

const MAX_IDEAS = 5;
/** A request is answered within a month, or the story it came with has expired anyway. */
const MAX_AGE_MS = 30 * 86_400_000;
/** Shapes a goodnight shows that are not creatures a story can be about. */
const NOT_CREATURES = new Set(['open', 'ears', 'fist', 'none']);

let stored: Stored = { asks: [], tastes: {} };
let loaded: Promise<void> | null = null;

/** For the journal and tests: the oldest request waiting, the child whose taste is newest, and Mo's suggestions for them. */
export const requestsRuntime = {
  pending: null as PendingAsk | null,
  child: '',
  ideas: [] as Suggestion[],
  /** 'ai' or 'taste' (how the ideas were made), '' while there are none. */
  ideasBy: '' as '' | 'ai' | 'taste',
  /** Suggestions are being asked for (the journal keeps their rows in place meanwhile, so nothing moves under a pointer). */
  thinking: false,
  /** Changes whenever a request or a taste does (so the journal refreshes). */
  version: 0,
  /** The last plan for a request: where the idea happens (for tests and diagnostics). */
  plan: null as { theme: string; shapes: string[]; setting?: string; by: string } | null,
};

function ensureLoaded(): Promise<void> {
  loaded ??= loadRequests<Stored>()
    .then((s) => {
      if (s && Array.isArray(s.asks) && s.tastes) stored = s;
      publish();
    })
    .catch(() => undefined);
  return loaded;
}

export function loadStoryRequests(): Promise<void> {
  return ensureLoaded();
}

function publish(): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  stored.asks = stored.asks.filter((a) => a.at > cutoff);
  requestsRuntime.pending = stored.asks[0] ?? null;
  const newest = Object.entries(stored.tastes).sort((a, b) => b[1].updatedAt - a[1].updatedAt)[0];
  if (newest?.[0] !== requestsRuntime.child) {
    requestsRuntime.ideas = [];
    requestsRuntime.ideasBy = '';
  }
  requestsRuntime.child = newest?.[0] ?? '';
  requestsRuntime.version++;
}

async function save(): Promise<void> {
  publish();
  await saveRequests(stored);
}

function tasteOf(child: string): ChildTaste {
  const key = child || 'your family';
  stored.tastes[key] ??= { places: {}, creatures: {}, ideas: [], updatedAt: 0 };
  return stored.tastes[key];
}

function add(table: Record<string, number>, key: string, n = 1): void {
  table[key] = Math.min(9999, (table[key] ?? 0) + n);
}

/**
 * A goodnight arrived: its request (if any) waits to be dreamed, and the child's
 * taste learns from it (what they asked for counts twice what they made).
 */
export async function learnFromGoodnight(reply: Performance): Promise<void> {
  await ensureLoaded();
  const taste = tasteOf(reply.performer);
  const ask = reply.ask ? checkAsk(reply.ask) : null;
  if (ask) {
    if (!stored.asks.some((a) => a.id === reply.id)) stored.asks.push({ ...ask, id: reply.id, from: reply.performer, at: reply.createdAt || Date.now() });
    if (ask.theme) add(taste.places, ask.theme, 2);
    for (const s of ask.shapes ?? []) add(taste.creatures, s, 2);
    if (ask.words) taste.ideas = [ask.words, ...taste.ideas.filter((i) => i !== ask.words)].slice(0, MAX_IDEAS);
  }
  for (const e of reply.events ?? []) {
    const shape = e.type === 'wake' ? e.data?.shape : undefined;
    if (typeof shape === 'string' && shape && !NOT_CREATURES.has(shape)) add(taste.creatures, shape);
  }
  taste.updatedAt = Date.now();
  await save();
}

/** A request was dreamed: it is answered, and the place and creatures the story used count toward the child's taste. */
export async function answerAsk(id: string, theme: string, shapes: readonly string[]): Promise<void> {
  await ensureLoaded();
  const ask = stored.asks.find((a) => a.id === id);
  if (!ask) return;
  stored.asks = stored.asks.filter((a) => a.id !== id);
  const taste = tasteOf(ask.from);
  if (theme) add(taste.places, theme);
  for (const s of shapes) add(taste.creatures, s);
  taste.updatedAt = Date.now();
  await save();
}

/** Put a request aside without dreaming it. */
export async function dismissAsk(id: string): Promise<void> {
  await ensureLoaded();
  stored.asks = stored.asks.filter((a) => a.id !== id);
  await save();
}

/** The taste as sent for suggestions: counts and ideas only, no name. */
export function tasteToSend(child: string): { places: Record<string, number>; creatures: Record<string, number>; ideas: string[] } | null {
  const t = stored.tastes[child];
  if (!t || (!Object.keys(t.places).length && !Object.keys(t.creatures).length && !t.ideas.length)) return null;
  return { places: { ...t.places }, creatures: { ...t.creatures }, ideas: [...t.ideas] };
}

let asked = '';

/** Mo's suggestions for the newest child (asked once per change in their taste). */
export async function refreshSuggestions(): Promise<void> {
  await ensureLoaded();
  const child = requestsRuntime.child;
  const taste = child ? tasteToSend(child) : null;
  const key = taste ? `${child}|${JSON.stringify(taste)}` : '';
  if (!taste || key === asked) return;
  asked = key;
  requestsRuntime.thinking = true;
  requestsRuntime.version++;
  try {
    const r = await fetch('/api/dream/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(taste), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`suggest ${r.status}`);
    const body = (await r.json()) as { ideas?: Suggestion[]; by?: 'ai' | 'taste' };
    if (requestsRuntime.child !== child) return;
    requestsRuntime.ideas = Array.isArray(body.ideas) ? body.ideas.slice(0, 3) : [];
    requestsRuntime.ideasBy = requestsRuntime.ideas.length ? (body.by ?? 'taste') : '';
    requestsRuntime.version++;
  } catch {
    // Offline or busy: asked again when the taste next changes.
    asked = '';
  } finally {
    requestsRuntime.thinking = false;
    requestsRuntime.version++;
  }
}

/** Whether a child has a taste to suggest from (the journal shows the suggestions' rows from the start). */
export function hasTaste(): boolean {
  return !!requestsRuntime.child && !!tasteToSend(requestsRuntime.child);
}

/** What a story from a request would be: the closest place the app has, its shapes, and where in it the idea happens. */
export async function planAsk(ask: StoryAsk): Promise<{ theme: string; shapes: string[]; setting?: string; by: string } | null> {
  try {
    const r = await fetch('/api/dream/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wish: ask.words ?? '', ...(ask.theme ? { theme: ask.theme } : {}), ...(ask.shapes?.length ? { shapes: ask.shapes } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const plan = (await r.json()) as { theme: string; shapes: string[]; setting?: string; by: string };
    requestsRuntime.plan = plan;
    return plan;
  } catch {
    return null;
  }
}
