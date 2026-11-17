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
import { contentProblems, softenIdea } from '../src/story-checks.ts';
import { MAX_DREAM_SHAPES, MAX_WISH_WORDS, readWish } from '../src/voice-commands.ts';
import type { Llm } from './llm.ts';

/**
 * Every shape a dreamed story can tell: the five the chooser offers, the ones an idea can name ("a fish
 * and a crocodile"), and the story worlds' creatures (src/world-creatures.ts), which the chooser offers
 * for their own places.
 */
export const DREAM_SHAPES = [
  ...['rabbit', 'fish', 'dog', 'bird', 'cup', 'swan', 'crocodile', 'deer', 'snail'],
  ...['rocket', 'alien', 'asteroid', 'shark', 'octopus', 'whale', 'car', 'plane', 'digger', 'trex', 'pterodactyl'],
] as const;
/** What Mo picks from when an idea names no shapes, or tops up a request: the easiest five. */
export const PICK_SHAPES = ['rabbit', 'fish', 'dog', 'bird', 'cup'] as const;
export const THEMES: Readonly<Record<string, { words: string; scenery: string }>> = {
  sea: { words: 'by the quiet sea at night', scenery: 'sea' },
  forest: { words: 'in a sleepy forest', scenery: 'forest' },
  meadow: { words: 'in a meadow under the stars', scenery: 'field' },
  river: { words: 'along a slow, silver river', scenery: 'river' },
  rain: { words: 'on a night of soft, passing rain', scenery: 'storm' },
  sky: { words: 'high in the night sky among the clouds', scenery: 'none' },
  // The story worlds' places, with their scenery.
  space: { words: 'far out in space, among the stars and planets', scenery: 'star-port' },
  road: { words: 'along a long, winding road under the moon', scenery: 'moon-road' },
  dinosaurs: { words: 'in a valley of giant ferns, long, long ago, where the dinosaurs live', scenery: 'dino-valley' },
};
/** What Mo picks from in a story world's place: its own creatures (and the cup, which fits anywhere). */
const THEME_PICKS: Readonly<Record<string, readonly string[]>> = {
  space: ['rocket', 'alien', 'asteroid', 'cup'],
  road: ['car', 'plane', 'digger', 'cup'],
  dinosaurs: ['trex', 'pterodactyl', 'bird', 'cup'],
  sea: ['fish', 'shark', 'octopus', 'whale', 'cup'],
};
const picksFor = (theme: string): readonly string[] => THEME_PICKS[theme] ?? PICK_SHAPES;
/** How a child makes each world creature, for the writing prompt (only those in the story are listed). */
const WORLD_HANDS: Readonly<Record<string, string>> = {
  rocket: 'for the rocket: one finger pointing straight up, the others curled in',
  alien: 'for the alien: the pointer finger and the little finger up, like antennae',
  asteroid: 'for the asteroid: a fist, round and lumpy like a space rock',
  shark: 'for the shark: a flat hand, fingers together, pointing up like a fin',
  octopus: 'for the octopus: a hand hanging down, fingers spread, wiggling like arms',
  whale: 'for the whale: a fist for its body, and the thumb up for its spout',
  car: 'for the car: a fist, with two fingers pointing forward like headlights',
  plane: 'for the aeroplane (shape plane): the thumb and the little finger stretched out, like wings',
  digger: 'for the digger: a flat hand bent down at the wrist, like a scoop',
  trex: 'for the T. rex (shape trex): two flat hands, one on top of the other, like a big mouth',
  pterodactyl: 'for the pterodactyl: two hands side by side, like wide wings',
};
/** Creatures that fly: their ride stays up off the stage's ground (as the bird's does). */
const FLIERS: ReadonlySet<string> = new Set(['bird', 'rocket', 'alien', 'plane', 'pterodactyl']);

/**
 * The easier pose each shape also accepts, as in the library stories: two
 * fingers up for the rabbit, a rabbit for the dog, a dog for the fish. Dreamed
 * rabbits had none (Quest 3S, Nov 16: 25 s, against 2.4 s for The Moth's rabbit).
 */
// The digger also takes a scooped (cupped) hand: people make the scoop the story asks for with curled
// fingers, and the swan's pose it borrows wants them flat, the thumb tucked (Quest 3, Nov 17: 31 s).
const ALTS: Readonly<Record<string, string>> = { rabbit: 'ears', dog: 'rabbit', fish: 'dog', digger: 'cup' };

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
  rocket: /\brocket/i,
  alien: /\balien/i,
  asteroid: /\b(asteroid|space rock)/i,
  shark: /\bshark/i,
  octopus: /\boctop/i,
  whale: /\bwhale/i,
  car: /\bcars?\b/i,
  plane: /\b(aeroplane|airplane|plane)/i,
  digger: /\bdigger/i,
  trex: /\b(t\.? ?rex|tyrannosaur)/i,
  pterodactyl: /\bpterodactyl/i,
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
  /**
   * Where the idea happens inside the place, when the idea names somewhere the
   * app has no scenery for ("at a little carnival in the meadow, under strings
   * of lanterns"): chosen by the model when it plans (or by IDEA_PLACES), checked
   * like a story line. The story is written there; the scenery stays the place's.
   */
  setting?: string;
}

/** A setting: one plain line of at most this many words. */
const MAX_SETTING_WORDS = 14;

/** A setting fit to write a story in, or ''. */
export function cleanSetting(setting: unknown): string {
  if (typeof setting !== 'string') return '';
  const t = setting.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (!LINE.test(t) || NEVER.test(t) || t.split(' ').length > MAX_SETTING_WORDS || contentProblems(t).length) return '';
  return t;
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
    const setting = theme ? cleanSetting(b.setting) : '';
    return { theme, shapes, ...(wish ? { wish } : {}), ...(setting ? { setting } : {}) };
  }
  if (typeof b.theme !== 'string' || !Object.hasOwn(THEMES, b.theme)) return null;
  if (!Array.isArray(b.shapes) || b.shapes.length < 2 || b.shapes.length > MAX_DREAM_SHAPES) return null;
  if (new Set(b.shapes).size !== b.shapes.length) return null;
  if (!b.shapes.every(isShape)) return null;
  const setting = cleanSetting(b.setting);
  return { theme: b.theme, shapes: b.shapes as string[], ...(setting ? { setting } : {}) };
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
  const rest = picksFor(theme).filter((s) => !shapes.includes(s));
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
      : `Choose two or three shadow shapes that fit it best, from: ${req.theme ? picksFor(req.theme).join(', ') : `${PICK_SHAPES.join(', ')}; or for a story in space, ${THEME_PICKS.space.join(', ')}; by the sea, ${THEME_PICKS.sea.join(', ')}; on the road, ${THEME_PICKS.road.join(', ')}; with the dinosaurs, ${THEME_PICKS.dinosaurs.join(', ')}`} (cup means cupped hands holding something small, like a star or a firefly; trex is a T. rex, plane an aeroplane).${req.shapes.length ? ` Keep these, in this order, first: ${req.shapes.join(', ')}.` : ''}`,
    'setting = where the idea happens inside that place, in at most 12 plain words, so the story can bring the idea to the place (like: at a little carnival in the meadow, under strings of lanterns; or: on a pirate boat on the quiet sea). Gentle, no names, no characters from shows. If the idea is simply the place, describe the place.',
    'JSON: {"theme":"...","shapes":["...","..."],"setting":"..."}',
  ].join('\n');
}

/** The model's pick (text) for this request, or null when it is not a usable one. Keeps what was already chosen. */
export function readPick(req: DreamRequest, reply: string): DreamRequest | null {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let pick: { theme?: unknown; shapes?: unknown; setting?: unknown };
  try {
    pick = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  const theme = req.theme || (typeof pick.theme === 'string' && Object.hasOwn(THEMES, pick.theme) ? pick.theme : '');
  const picked = Array.isArray(pick.shapes) ? pick.shapes.filter(isShape) : [];
  // Two or more named (a fish and a crocodile): exactly those; the model only tops up fewer.
  const shapes = req.shapes.length >= 2 ? req.shapes : [...new Set([...req.shapes, ...picked])].slice(0, 3);
  const setting = cleanSetting(pick.setting);
  const out = { ...req, theme, shapes, ...(setting ? { setting } : {}) };
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
  // The story worlds' creatures keep to their worlds (the aeroplane flies anywhere).
  rocket: ['star-port', 'none'],
  alien: ['star-port', 'none'],
  asteroid: ['star-port'],
  shark: ['sea'],
  octopus: ['sea'],
  whale: ['sea'],
  car: ['moon-road', 'field'],
  digger: ['moon-road', 'field'],
  trex: ['dino-valley'],
  pterodactyl: ['dino-valley', 'none'],
};
const HOME: Readonly<Record<string, string>> = {
  fish: 'river', swan: 'river', crocodile: 'river', deer: 'forest', snail: 'forest', rabbit: 'field', dog: 'field',
  rocket: 'star-port', alien: 'star-port', asteroid: 'star-port', shark: 'sea', octopus: 'sea', whale: 'sea',
  car: 'moon-road', digger: 'moon-road', trex: 'dino-valley', pterodactyl: 'dino-valley',
};
/** A place in the words given to the model. */
const PLACE_WORDS: Readonly<Record<string, string>> = {
  sea: 'by the sea',
  river: 'beside a river',
  forest: 'in the forest',
  field: 'in a meadow',
  storm: 'in the soft rain',
  none: 'up in the night sky',
  'star-port': 'out among the stars',
  'moon-road': 'on the road across the moon',
  'dino-valley': 'in the valley of the dinosaurs',
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
    `Write a new story set ${req.setting ? `${req.setting} (the place: ${THEMES[req.theme].words})` : THEMES[req.theme].words}. In order, the child makes these shadow shapes: ${req.shapes.join(', ')}.`,
    ...(req.wish
      ? [
          `The grown-up asked for it in their own words: ${req.wish}`,
          'Let that idea shape the story (its feeling, what Mo is looking for, small details) where it is gentle and fits the rules; leave out anything that does not. Do not use anyone\'s name from it.',
        ]
      : []),
    `Where each scene happens, in order (the story travels there when the place changes; say so in that scene's setup): ${scenePlaces(req)
      .map((place, i) => `${req.shapes[i]} ${PLACE_WORDS[place]}`)
      .join(', ')}.`,
    `For each scene: setup = why Mo needs that creature now; ask = tells the child to make it with their hands, naming the shape (for the bird: two hands side by side; for the cup: cupped hands; for the fish: a flat hand, fingers together; for the swan: a flat hand bent down at the wrist; for the crocodile: two flat hands, one on top of the other, like a long mouth; for the deer: wrists together, fingers up and spread like antlers; for the snail: a fist for the shell and two fingers for its eyes${req.shapes.filter((sh) => WORLD_HANDS[sh]).map((sh) => `; ${WORLD_HANDS[sh]}`).join('')}); ride = 2 to 6 words while Mo rides it across the stage; after = what they find; bow = the creature settles down to sleep.`,
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
    beats.push({ id: `dream-${n}-want`, type: 'request', shape, ...(ALTS[shape] ? { alt: ALTS[shape] } : {}), text: ask });
    if (shape === 'cup') {
      // Cupped hands hold something; they open to let it go (as in Counting Stars).
      // The let-go beat waits for open hands, so its caption must say so; the bow follows.
      beats.push({ id: `dream-${n}-after`, type: 'narrate', text: after });
      beats.push({ id: `dream-${n}-letgo`, type: 'letgo', text: 'Now open your hands, and let it go.' });
      beats.push({ id: `dream-${n}-free`, type: 'release', text: bow });
    } else {
      beats.push({ id: `dream-${n}-ride`, type: 'moth', mode: 'riding' });
      beats.push({ id: `dream-${n}-carry`, type: 'carry', toU: 0.3, ...(FLIERS.has(shape) ? { minV: 0.12 } : {}), text: ride });
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
    // Named in full: written as asked (a setting is planned only when asked for, /api/dream/plan).
    if (complete(req)) return req;
    if (req.wish) return (await this.plan(req)).request;
    return fillAtRandom(req);
  }

  /**
   * What a story from this idea would be, before it is written: the place that
   * fits it best (the closest one the app has scenery for), the shapes, and
   * where in that place the idea happens. The model plans; without it, or if
   * its plan will not do, IDEA_PLACES and a random pick.
   */
  async plan(req: DreamRequest): Promise<{ request: DreamRequest; by: 'ai' | 'words' }> {
    if (req.wish) {
      try {
        const reply = await this.llm.text({ model: this.pickModel, system: PICK_SYSTEM, user: pickPrompt(req), maxTokens: 250, effort: 'low', timeoutMs: 15000 });
        const picked = readPick(req, reply);
        if (picked) return { request: picked, by: 'ai' };
      } catch {
        // Planned from the words instead.
      }
    }
    return { request: planByWords(req), by: 'words' };
  }

  /**
   * Three stories a child would like, from their taste (what they asked for
   * and made): the model suggests, every field is checked; without it, or if
   * its ideas will not do, suggestByTaste.
   */
  async suggest(taste: Taste): Promise<{ ideas: Suggestion[]; by: 'ai' | 'taste' }> {
    try {
      const reply = await this.llm.text({ model: this.pickModel, system: SUGGEST_SYSTEM, user: suggestPrompt(taste), maxTokens: 700, effort: 'low', timeoutMs: 15000 });
      const ideas = readSuggestions(reply);
      if (ideas.length >= 2) return { ideas: ideas.slice(0, 3), by: 'ai' };
    } catch {
      // Suggested from the taste instead.
    }
    return { ideas: suggestByTaste(taste), by: 'taste' };
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

// ------------------------------------------------------------------ the closest place, without the model

/**
 * Places a child asks for that the app has no scenery for, and the closest one
 * it has, with where in it the idea happens. The model does this better (any
 * idea); these keep the common ones working without it.
 */
const IDEA_PLACES: readonly [RegExp, string, string][] = [
  [/\b(carnival|fair|funfair|circus|carousel|merry go round|ferris wheel)\b/i, 'meadow', 'at a little carnival in the meadow, under strings of lanterns'],
  [/\b(pirates?|ship|boat|island|treasure|mermaids?|beach)\b/i, 'sea', 'on a little boat on the quiet sea'],
  [/\b(castle|king|queen|princess|prince|knights?|dragons?)\b/i, 'forest', 'by an old castle at the edge of the sleepy forest'],
  [/\b(jungle|rainforest)\b/i, 'forest', 'deep in a warm, green jungle'],
  [/\b(farm|tractor|barn|cows?|pigs?|sheep)\b/i, 'meadow', 'on a sleepy farm beside the meadow'],
  [/\b(snow|snowy|winter|ice|icy|christmas)\b/i, 'meadow', 'in a meadow under the first soft snow'],
  [/\b(birthday|party|picnic)\b/i, 'meadow', 'at a little party in the meadow'],
  [/\b(garden|flowers?)\b/i, 'meadow', 'in a garden full of sleepy flowers'],
  [/\b(zoo|safari)\b/i, 'meadow', 'at a quiet zoo where everyone is falling asleep'],
  [/\b(trains?|city|town|bus)\b/i, 'road', 'on a long road to the twinkling lights of a town'],
  [/\b(moon|stars?|planets?|astronauts?)\b/i, 'space', 'out among the stars, past the sleepy moon'],
  [/\b(waterfall|lake|pond|bridge)\b/i, 'river', 'beside a little bridge over a quiet river'],
  [/\b(clouds?|rainbow|kite|balloon)\b/i, 'sky', 'up among the clouds, near a sleepy rainbow'],
];

/** A plan from the words alone: the place an idea names (or the closest one), and shapes picked at random. */
export function planByWords(req: DreamRequest, random = Math.random): DreamRequest {
  const idea = req.wish ? IDEA_PLACES.find(([re]) => re.test(req.wish!)) : undefined;
  const theme = Object.hasOwn(THEMES, req.theme) ? req.theme : (idea?.[1] ?? '');
  // The idea's setting only where it was made for that place.
  const setting = req.setting || (idea && idea[1] === theme ? idea[2] : '');
  const out = fillAtRandom({ ...req, theme }, random);
  return { ...out, ...(setting ? { setting } : {}) };
}

// ------------------------------------------------------------------ a child's taste, and stories they would like

/**
 * What the storyteller's headset knows a child likes (story-requests.ts), kept
 * on that headset and sent only to ask for suggestions: how often each place
 * and creature was asked for or made, and the last few ideas the child asked
 * for in their own words. No names.
 */
export interface Taste {
  places: Record<string, number>;
  creatures: Record<string, number>;
  ideas: string[];
}

export interface Suggestion {
  title: string;
  /** The story idea, as a grown-up would say it (dreamed like "Say your idea"). */
  idea: string;
  theme: string;
  shapes: string[];
  /** Why the child would like it, for the grown-up (no names). */
  why: string;
}

const MAX_TASTE_IDEAS = 5;
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9999;

/** A taste from untrusted JSON, rebuilt from known places, creatures and softened ideas, or null. */
export function checkTaste(body: unknown): Taste | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  const table = (v: unknown, known: (k: string) => boolean): Record<string, number> | null => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: Record<string, number> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      if (!known(k) || !count(n)) return null;
      if (n > 0) out[k] = n;
    }
    return out;
  };
  const places = table(b.places, (k) => Object.hasOwn(THEMES, k));
  const creatures = table(b.creatures, isShape);
  if (!places || !creatures || !Array.isArray(b.ideas) || b.ideas.length > MAX_TASTE_IDEAS) return null;
  const ideas: string[] = [];
  for (const i of b.ideas) {
    if (typeof i !== 'string') return null;
    const soft = softenIdea(i).words;
    if (soft && cleanWish(soft)) ideas.push(soft);
  }
  if (!Object.keys(places).length && !Object.keys(creatures).length && !ideas.length) return null;
  return { places, creatures, ideas };
}

const SUGGEST_SYSTEM = [
  'You suggest bedtime stories for a hand shadow-puppet game, for a child of 10 or younger, from what they have asked for and made before.',
  'The hero of every story is Mo, a small moth (she, her). Gentle, calm, a little wonder; nothing scary; no names; no characters or brands from books, films or games.',
  'Choose only from the lists given. Reply with JSON only.',
].join(' ');

const ranked = (t: Record<string, number>): string[] => Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k]) => k);

function suggestPrompt(taste: Taste): string {
  const list = (t: Record<string, number>) => ranked(t).map((k) => `${k} (${t[k]})`).join(', ') || 'none yet';
  return [
    `Places the child asked for or loved, most first: ${list(taste.places)}.`,
    `Creatures the child asked for or made with their hands, most first: ${list(taste.creatures)}.`,
    `Ideas the child asked for in their own words, newest first: ${taste.ideas.length ? taste.ideas.map((i) => `"${i}"`).join('; ') : 'none yet'}.`,
    'Suggest three new stories this child would love, each different: one close to what they love most, one that mixes two things they love, and one gentle new thing near their taste.',
    `For each: title = 2 to 5 words; idea = one sentence of at most 20 plain words that a grown-up could say to ask for the story; theme = one of: ${Object.keys(THEMES).join(', ')}; shapes = two or three from: ${DREAM_SHAPES.join(', ')} (cup means cupped hands holding something small; trex is a T. rex, plane an aeroplane), creatures that belong in that place; why = at most 10 words for the grown-up, starting with a verb like Loves or Asked for, no names and no he or she.`,
    'JSON: {"ideas":[{"title":"...","idea":"...","theme":"...","shapes":["...","..."],"why":"..."}]}',
  ].join('\n');
}

/** The model's suggestions (text), each checked; the ones that will not do are left out. */
export function readSuggestions(reply: string): Suggestion[] {
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: { ideas?: unknown };
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed.ideas)) return [];
  const out: Suggestion[] = [];
  for (const raw of parsed.ideas.slice(0, 3)) {
    const s = (raw ?? {}) as Record<string, unknown>;
    const title = line(s.title);
    const idea = typeof s.idea === 'string' ? cleanWish(softenIdea(s.idea).words) : '';
    const why = line(s.why);
    const theme = typeof s.theme === 'string' && Object.hasOwn(THEMES, s.theme) ? s.theme : '';
    const shapes = Array.isArray(s.shapes) ? [...new Set(s.shapes.filter(isShape))].slice(0, 3) : [];
    if (!title || title.split(' ').length > 6 || !idea || idea.split(' ').length > 24 || !why || why.split(' ').length > 12 || !theme || shapes.length < 2) continue;
    if (/\b(he|she|him|his|her)\b/i.test(why)) continue;
    out.push({ title, idea, theme, shapes, why });
  }
  return out;
}

const NAMES: Readonly<Record<string, string>> = { cup: 'firefly', trex: 'T. rex', plane: 'aeroplane' };
const PLACE_NAMES: Readonly<Record<string, string>> = {
  sea: 'the sea', forest: 'the forest', meadow: 'the meadow', river: 'the river', rain: 'the rain', sky: 'the sky',
  space: 'space', road: 'the road', dinosaurs: 'dinosaur valley',
};
const named = (shape: string): string => NAMES[shape] ?? shape;
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** Three suggestions from the taste alone: more of what they love, their last idea again, and a new place near it. */
export function suggestByTaste(taste: Taste): Suggestion[] {
  const places = ranked(taste.places);
  const loved = ranked(taste.creatures);
  const top = places[0] ?? 'meadow';
  const pair = (theme: string): string[] => {
    const fits = loved.filter((c) => {
      const f = FITS[c];
      return !f || f.includes(THEMES[theme].scenery);
    });
    return [...new Set([...fits, ...picksFor(theme)])].slice(0, 2);
  };
  const out: Suggestion[] = [];
  const a = pair(top);
  out.push({
    title: cap(`the ${named(a[0])} in ${PLACE_NAMES[top]}`),
    idea: `a story in ${PLACE_NAMES[top]} with a ${named(a[0])} and a ${named(a[1])}`,
    theme: top,
    shapes: a,
    why: `Loves ${PLACE_NAMES[top]} and the ${named(a[0])}`,
  });
  const idea = taste.ideas[0];
  if (idea) {
    const p = planByWords({ theme: '', shapes: [], wish: idea });
    out.push({ title: 'Another one like that', idea, theme: p.theme, shapes: p.shapes, why: 'Asked for this in their own words' });
  }
  const fresh = Object.keys(THEMES).find((t) => !taste.places[t] && pair(t).some((c) => loved.includes(c))) ?? Object.keys(THEMES).find((t) => !taste.places[t]) ?? 'sky';
  const b = pair(fresh);
  out.push({
    title: `Mo visits ${PLACE_NAMES[fresh]}`,
    idea: `a story in ${PLACE_NAMES[fresh]} with a ${named(b[0])} and a ${named(b[1])}`,
    theme: fresh,
    shapes: b,
    why: 'Somewhere new, with a creature they love',
  });
  return out.slice(0, 3);
}
