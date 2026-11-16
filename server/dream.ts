/**
 * "Dream up a new story": the model (Claude or Muse Spark, llm.ts) writes the words of a new short bedtime story
 * for the shapes and theme the app picks; the server builds the story itself
 * (the same pattern as Counting Stars: Mo follows a finger, then for each shape
 * a request, a ride across the stage and a bow, then the finale), so the model
 * only ever supplies lines of narration. The request carries only a theme id
 * and shape ids from fixed lists. Every line is checked (length, plain words,
 * the shape's name in its request, a never-say list); a story that fails is
 * refused rather than shown.
 *
 * On when the server has a model key (main.ts; DREAM_MODEL picks the model).
 */
import { contentProblems } from '../src/story-checks.ts';
import { MAX_DREAM_SHAPES, MAX_WISH_WORDS, readWish } from '../src/voice-commands.ts';
import type { Llm } from './llm.ts';

/** Every shape a dreamed story can tell: the five the chooser offers, and the ones an idea can name ("a fish and a crocodile"). */
export const DREAM_SHAPES = ['rabbit', 'fish', 'dog', 'bird', 'cup', 'swan', 'crocodile', 'deer', 'snail'] as const;
/** What Mo picks from when an idea names no shapes, or tops up a request: the easiest five. */
export const PICK_SHAPES = ['rabbit', 'fish', 'dog', 'bird', 'cup'] as const;
export const THEMES: Readonly<Record<string, { words: string; scenery: string }>> = {
  sea: { words: 'by the quiet sea at night', scenery: 'sea' },
  forest: { words: 'in a sleepy forest', scenery: 'forest' },
  meadow: { words: 'in a meadow under the stars', scenery: 'field' },
  river: { words: 'along a slow, silver river', scenery: 'river' },
  rain: { words: 'on a night of soft, passing rain', scenery: 'storm' },
  sky: { words: 'high in the night sky among the clouds', scenery: 'none' },
};

const LINE = /^[A-Za-z0-9 ,.!?'’;:-]{2,160}$/;
const MAX_LINE_WORDS = 24;
const NEVER = /\b(kill|killed|die|dies|dead|death|blood|hate|stupid|dumb|ugly|monster|gun|knife|scream|screams|nightmare|lost forever|http|www)\b/i;
/** The shape's name (or how a child would say it) must appear in its request. */
const SHAPE_WORDS: Readonly<Record<string, RegExp>> = {
  rabbit: /\b(rabbit|bunny)\b/i,
  fish: /\bfish\b/i,
  dog: /\b(dog|puppy)\b/i,
  bird: /\bbird\b/i,
  cup: /\bcup/i,
  swan: /\bswan/i,
  crocodile: /\b(crocodile|croc)/i,
  deer: /\b(deer|reindeer)\b/i,
  snail: /\bsnail/i,
};

export interface DreamRequest {
  theme: string;
  shapes: string[];
  /**
   * The grown-up's idea in their own words ("a forest story with a dog and a
   * rabbit"), checked by cleanWish. Only ever sent to the model, as an idea;
   * never stored, logged or put in the story.
   */
  wish?: string;
}

/** A wish's characters: plain words, as speech-to-text writes them. */
const WISH = /^[A-Za-z0-9 ,.!?'’-]{3,240}$/;

/**
 * A spoken wish fit to show the model, or '' when it is not: plain words, at
 * most MAX_WISH_WORDS, nothing on the never-say list, no brands or
 * well-known characters (the story would have to drop them anyway).
 */
export function cleanWish(wish: unknown): string {
  if (typeof wish !== 'string') return '';
  const t = wish.trim().replace(/\s+/g, ' ');
  if (!WISH.test(t) || t.split(' ').length > MAX_WISH_WORDS || NEVER.test(t) || contentProblems(t).length) return '';
  return t;
}

const isShape = (s: unknown): s is string => typeof s === 'string' && (DREAM_SHAPES as readonly string[]).includes(s);

/**
 * A dream request from untrusted JSON, or null. Either a theme and two or
 * three shapes (the chooser), or a wish in plain words, with any place and
 * shapes already read from it; what a wish leaves out, Dreamer.resolve fills in.
 */
export function checkDream(body: unknown): DreamRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const wish = cleanWish(b.wish);
  if (b.wish !== undefined) {
    // A wish that will not do still makes a story (Mo picks), just without the idea.
    const read = readWish(wish);
    const theme = typeof b.theme === 'string' && Object.hasOwn(THEMES, b.theme) ? b.theme : read.theme;
    const given = Array.isArray(b.shapes) ? b.shapes.filter(isShape) : [];
    const shapes = [...new Set([...given, ...read.shapes])].slice(0, MAX_DREAM_SHAPES);
    return { theme, shapes, ...(wish ? { wish } : {}) };
  }
  if (typeof b.theme !== 'string' || !Object.hasOwn(THEMES, b.theme)) return null;
  if (!Array.isArray(b.shapes) || b.shapes.length < 2 || b.shapes.length > MAX_DREAM_SHAPES) return null;
  if (new Set(b.shapes).size !== b.shapes.length) return null;
  if (!b.shapes.every(isShape)) return null;
  return { theme: b.theme, shapes: b.shapes as string[] };
}

/** True when the request names a place and two to four shapes (ready to write). */
export function complete(req: DreamRequest): boolean {
  return Object.hasOwn(THEMES, req.theme) && req.shapes.length >= 2 && req.shapes.length <= MAX_DREAM_SHAPES;
}

/** The rest of a request picked at random: a place if none, shapes up to two (or as many as there are). */
export function fillAtRandom(req: DreamRequest, random = Math.random): DreamRequest {
  const themes = Object.keys(THEMES);
  const theme = Object.hasOwn(THEMES, req.theme) ? req.theme : themes[Math.floor(random() * themes.length)];
  const shapes = [...req.shapes];
  const rest = PICK_SHAPES.filter((s) => !shapes.includes(s));
  while (shapes.length < 2) shapes.push(rest.splice(Math.floor(random() * rest.length), 1)[0]);
  return { ...req, theme, shapes };
}

const PICK_SYSTEM = [
  'You help choose a bedtime story for a hand shadow-puppet game, from a grown-up\'s idea in their own words.',
  'Choose only from the lists given. Reply with JSON only.',
].join(' ');

function pickPrompt(req: DreamRequest): string {
  return [
    `The idea: ${req.wish}`,
    `Choose the place that fits it best, one of: ${Object.keys(THEMES).join(', ')}.${req.theme ? ` (Already chosen: ${req.theme}.)` : ''}`,
    req.shapes.length >= 2
      ? `The shapes are already chosen: ${req.shapes.join(', ')}.`
      : `Choose two or three shadow shapes that fit it best, from: ${PICK_SHAPES.join(', ')} (cup means cupped hands holding something small, like a star or a firefly).${req.shapes.length ? ` Keep these, in this order, first: ${req.shapes.join(', ')}.` : ''}`,
    'JSON: {"theme":"...","shapes":["...","..."]}',
  ].join('\n');
}

/** The model's pick (text) for this request, or null when it is not a usable one. Keeps what was already chosen. */
export function readPick(req: DreamRequest, reply: string): DreamRequest | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let pick: { theme?: unknown; shapes?: unknown };
  try {
    pick = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const theme = req.theme || (typeof pick.theme === 'string' && Object.hasOwn(THEMES, pick.theme) ? pick.theme : '');
  const picked = Array.isArray(pick.shapes) ? pick.shapes.filter(isShape) : [];
  // Two or more named (a fish and a crocodile): exactly those; the model only tops up fewer.
  const shapes = req.shapes.length >= 2 ? req.shapes : [...new Set([...req.shapes, ...picked])].slice(0, 3);
  const out = { ...req, theme, shapes };
  return complete(out) ? out : null;
}

/** What the model is asked to write (and must return, exactly this shape). */
/**
 * Where each creature belongs. A dreamed story keeps the theme's place while a
 * creature fits there, and otherwise moves to the creature's home first, so a
 * fish never swims through a forest (Quest 3, Nov 15). The bird and cupped hands
 * fit anywhere.
 */
const FITS: Readonly<Record<string, readonly string[]>> = {
  fish: ['sea', 'river'],
  swan: ['river', 'sea'],
  crocodile: ['river'],
  deer: ['forest', 'field'],
  snail: ['forest', 'field', 'storm'],
  rabbit: ['field', 'forest'],
  dog: ['field', 'forest', 'storm', 'none'],
};
const HOME: Readonly<Record<string, string>> = { fish: 'river', swan: 'river', crocodile: 'river', deer: 'forest', snail: 'forest', rabbit: 'field', dog: 'field' };
/** A place in the words given to the model. */
const PLACE_WORDS: Readonly<Record<string, string>> = {
  sea: 'by the sea',
  river: 'beside a river',
  forest: 'in the forest',
  field: 'in a meadow',
  storm: 'in the soft rain',
  none: 'up in the night sky',
};

/**
 * The scenery of each scene, in order: where the story is while the creature
 * fits there; otherwise back to the theme's place if it fits that, else the
 * creature's home.
 */
export function scenePlaces(req: DreamRequest): string[] {
  const theme = THEMES[req.theme].scenery;
  let here = theme;
  return req.shapes.map((shape) => {
    const fits = FITS[shape];
    if (fits && !fits.includes(here)) here = fits.includes(theme) ? theme : HOME[shape];
    return here;
  });
}

interface DreamWords {
  title: string;
  opening: [string, string];
  scenes: { shape: string; setup: string; ask: string; ride: string; after: string; bow: string }[];
  ending: [string, string];
}

const SYSTEM = [
  'You write the words of very short, gentle bedtime stories for a hand shadow-puppet game.',
  'The listener is a child of 10 or younger at bedtime, with a grown-up. The hero is Mo, a small moth (she, her) who rides each shadow creature the child makes with their hands.',
  'Tone: calm, warm, sleepy, a little wonder. Mild peril at most, always resolved kindly. No other named characters, no characters or brands from books, films or games, no real places, nothing scary.',
  'Every line is one or two short sentences, at most 22 words, plain words, no quotation marks, no emojis.',
  'Reply with JSON only, exactly in the shape asked for.',
].join(' ');

function prompt(req: DreamRequest): string {
  const scenes = req.shapes.map((s) => `{"shape":"${s}","setup":"...","ask":"...","ride":"...","after":"...","bow":"..."}`).join(',');
  return [
    `Write a new story set ${THEMES[req.theme].words}. In order, the child makes these shadow shapes: ${req.shapes.join(', ')}.`,
    ...(req.wish
      ? [
          `The grown-up asked for it in their own words: ${req.wish}`,
          'Let that idea shape the story (its feeling, what Mo is looking for, small details) where it is gentle and fits the rules; leave out anything that does not. Do not use anyone\'s name from it.',
        ]
      : []),
    `Where each scene happens, in order (the story travels there when the place changes; say so in that scene's setup): ${scenePlaces(req)
      .map((place, i) => `${req.shapes[i]} ${PLACE_WORDS[place]}`)
      .join(', ')}.`,
    'For each scene: setup = why Mo needs that creature now; ask = tells the child to make it with their hands, naming the shape (for the bird: two hands side by side; for the cup: cupped hands; for the fish: a flat hand, fingers together; for the swan: a flat hand bent down at the wrist; for the crocodile: two flat hands, one on top of the other, like a long mouth; for the deer: wrists together, fingers up and spread like antlers; for the snail: a fist for the shell and two fingers for its eyes); ride = 2 to 6 words while Mo rides it across the stage; after = what they find; bow = the creature settles down to sleep.',
    'opening = two lines that begin the story; ending = two lines that say goodnight. title = 2 to 5 words.',
    `JSON: {"title":"...","opening":["...","..."],"scenes":[${scenes}],"ending":["...","..."]}`,
  ].join('\n');
}

function line(s: unknown, shape?: string): string | null {
  if (typeof s !== 'string') return null;
  const t = s.trim().replace(/\s+/g, ' ');
  if (!LINE.test(t) || NEVER.test(t) || t.split(' ').length > MAX_LINE_WORDS) return null;
  if (contentProblems(t, shape).length) return null;
  return t;
}

/**
 * The model's reply (text) as a playable story for this request, or null when
 * anything about it is off. Pure, so tests and the sims can build stories from
 * canned replies.
 */
export function assembleStory(req: DreamRequest, reply: string): Record<string, unknown> | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let words: DreamWords;
  try {
    words = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const title = line(words.title);
  const opening = Array.isArray(words.opening) ? words.opening.map(line) : [];
  const ending = Array.isArray(words.ending) ? words.ending.map(line) : [];
  if (!title || title.split(' ').length > 6 || opening.length !== 2 || ending.length !== 2 || [...opening, ...ending].includes(null)) return null;
  if (!Array.isArray(words.scenes) || words.scenes.length !== req.shapes.length) return null;

  const beats: Record<string, unknown>[] = [
    { id: 'dream-title', type: 'chapter', chapter: title, text: title },
    { id: 'dream-lamp', type: 'lamp', level: 1 },
    { id: 'dream-scenery', type: 'scenery', set: THEMES[req.theme].scenery },
    { id: 'dream-open-1', type: 'narrate', text: opening[0] },
    { id: 'dream-mo', type: 'moth', mode: 'arriving' },
    { id: 'dream-follow', type: 'follow', seconds: 3, text: 'Hold up your hand. Mo will follow your finger, slowly, slowly.' },
    { id: 'dream-open-2', type: 'narrate', text: opening[1] },
  ];
  const places = scenePlaces(req);
  let here = THEMES[req.theme].scenery;
  for (let i = 0; i < req.shapes.length; i++) {
    const shape = req.shapes[i];
    const s = words.scenes[i] as Record<string, unknown>;
    // The request is checked against its own shape's hands; the other lines only for the general rules.
    const [setup, ask, ride, after, bow] = ['setup', 'ask', 'ride', 'after', 'bow'].map((k) => line(s?.[k], k === 'ask' ? shape : undefined));
    if (s?.shape !== shape || !setup || !ask || !ride || !after || !bow) return null;
    if (!SHAPE_WORDS[shape].test(ask) || ride.split(' ').length > 8) return null;
    const n = i + 1;
    // To the creature's own place first, if it does not belong where the story is.
    if (places[i] !== here) {
      here = places[i];
      beats.push({ id: `dream-${n}-place`, type: 'scenery', set: here });
    }
    beats.push({ id: `dream-${n}-setup`, type: 'narrate', text: setup });
    beats.push({ id: `dream-${n}-want`, type: 'request', shape, ...(shape === 'fish' ? { alt: 'dog' } : {}), text: ask });
    if (shape === 'cup') {
      // Cupped hands hold something; they open to let it go (as in Counting Stars).
      // The let-go beat waits for open hands, so its caption must say so; the bow follows.
      beats.push({ id: `dream-${n}-after`, type: 'narrate', text: after });
      beats.push({ id: `dream-${n}-letgo`, type: 'letgo', text: 'Now open your hands, and let it go.' });
      beats.push({ id: `dream-${n}-free`, type: 'release', text: bow });
    } else {
      beats.push({ id: `dream-${n}-ride`, type: 'moth', mode: 'riding' });
      beats.push({ id: `dream-${n}-carry`, type: 'carry', toU: 0.3, ...(shape === 'bird' ? { minV: 0.12 } : {}), text: ride });
      beats.push({ id: `dream-${n}-after`, type: 'narrate', text: after });
      beats.push({ id: `dream-${n}-bow`, type: 'release', text: bow });
    }
    beats.push({ id: `dream-${n}-dim`, type: 'lamp', level: Math.max(0.5, 0.9 - 0.15 * n) });
  }
  beats.push(
    { id: 'dream-rest', type: 'moth', mode: 'resting', restU: 0, restV: 0.1 },
    { id: 'dream-finale', type: 'finale', seconds: 4 },
    { id: 'dream-end-1', type: 'narrate', text: ending[0] },
    { id: 'dream-dim-last', type: 'lamp', level: 0.35 },
    { id: 'dream-end-2', type: 'narrate', text: ending[1] },
    { id: 'dream-mo-sleep', type: 'moth', mode: 'resting', restU: 0.1, restV: 0.15 },
    { id: 'dream-the-end', type: 'chapter', chapter: 'The End', text: 'The End' },
    { id: 'dream-end', type: 'end', text: 'The End' },
  );
  return { version: 'shadowplay.story.v1', title, dreamed: true, theme: req.theme, beats };
}

export class Dreamer {
  private llm: Llm;
  private model: string;
  private pickModel: string;

  /** `pickModel` (a quick one) chooses the place and shapes a wish leaves out; the main model writes. */
  constructor(llm: Llm, model: string, pickModel = model) {
    this.llm = llm;
    this.model = model;
    this.pickModel = pickModel;
  }

  /**
   * A request ready to write: as it is when it names a place and two or three
   * shapes; otherwise the model picks the rest from the wish, else at random.
   */
  async resolve(req: DreamRequest): Promise<DreamRequest> {
    if (complete(req)) return req;
    if (req.wish) {
      try {
        const reply = await this.llm.text({ model: this.pickModel, system: PICK_SYSTEM, user: pickPrompt(req), maxTokens: 200, effort: 'low', timeoutMs: 15000 });
        const picked = readPick(req, reply);
        if (picked) return picked;
      } catch {
        // Picked at random instead.
      }
    }
    return fillAtRandom(req);
  }

  /** A new story, or null if the model's words did not pass (one retry). */
  async dream(asked: DreamRequest): Promise<Record<string, unknown> | null> {
    const req = await this.resolve(asked);
    for (let attempt = 0; attempt < 2; attempt++) {
      // Room for every scene's lines (a fourth scene needs more than the 1500 three were given).
      const text = await this.llm.text({ model: this.model, system: SYSTEM, user: prompt(req), maxTokens: 900 + 300 * req.shapes.length, effort: 'medium', timeoutMs: 50000 });
      const story = assembleStory(req, text);
      if (story) return story;
    }
    return null;
  }
}
