import { createSystem, Entity, Quaternion, UIKit, UIKitMLAsset, Vector3 } from '@iwsdk/core';
import { loadSettings, saveDreamed, saveSettings } from './journal-store.js';
import { isDreamed } from './story-script.js';
import {
  HintModes,
  Settings,
  ShadowJournal,
  ShapeRecognizer,
  Stage,
  StoryState,
  ToleranceLevels,
} from './shadowplay-components.js';
import { playClick } from './sfx.js';
import { palette } from './panel-palette.js';
import { creatureName } from './creatures.js';
import { canHearWishes, listenForWish, wishListenRuntime, type WishListening } from './wish-listener.js';
import { answerAsk, hasTaste, loadStoryRequests, planAsk, refreshSuggestions, requestsRuntime } from './story-requests.js';
import { MAX_DREAM_SHAPES } from './voice-commands.js';
import { accessRuntime, gazeTargets, stageRuntime, uiPresses } from './stage-runtime.js';

const PANEL_NODE = 'settings-panel';
/** Authored panel width in metres (UIKit cm / 100). */
const PANEL_WIDTH = 0.38;
/** Enlarge the authored panel so its text is legible at wall distance. */
const READABLE_SCALE = 1.7;
/** How far the panel sits below the stage centre, as a fraction of the stage width (about 3 degrees at any distance). */
const PANEL_DROP = 0.09;
/** Stage width per metre at the usual 33 degrees (the reference the panel is sized against). */
const WIDTH_AT_ONE_METER = 2 * Math.tan((16.5 * Math.PI) / 180);
/** Below this horizontal field of view the panel goes over the stage rather than beside it. */
const NARROW_FOV = 75;

const TOLERANCE_VALUE: Readonly<Record<string, number>> = {
  [ToleranceLevels.Strict]: 0.2,
  [ToleranceLevels.Normal]: 0.3,
  [ToleranceLevels.Forgiving]: 0.4,
  [ToleranceLevels.VeryForgiving]: 0.5,
};
const HINT_AFTER: Readonly<Record<string, number>> = {
  [HintModes.Off]: -1,
  [HintModes.Delayed]: 15,
  [HintModes.Always]: 0,
};
const TOLERANCE_BUTTONS: readonly [string, string][] = [
  ['tol-strict', ToleranceLevels.Strict],
  ['tol-normal', ToleranceLevels.Normal],
  ['tol-forgiving', ToleranceLevels.Forgiving],
  ['tol-very-forgiving', ToleranceLevels.VeryForgiving],
];
const HINT_BUTTONS: readonly [string, string][] = [
  ['hint-off', HintModes.Off],
  ['hint-delayed', HintModes.Delayed],
  ['hint-always', HintModes.Always],
];

const CHAPTER_BUTTONS: readonly [string, string, string][] = [
  ['chap-prologue', 'prologue', 'the Prologue'],
  ['chap-ch1', 'ch1', 'Chapter One'],
  ['chap-ch2', 'ch2', 'Chapter Two'],
  ['chap-ch3', 'ch3', 'Chapter Three'],
  ['chap-ch4', 'ch4', 'Chapter Four'],
  ['chap-ch5', 'ch5', 'Chapter Five'],
];
/** The story library (public/story/library.json): browse with the arrows, start with "Tell this story". */
interface LibraryStory {
  id: string;
  title: string;
  script: string;
  minutes: number;
  /** Stories told in chapters say so (each chapter is short, and the story resumes at the last one). */
  chapters?: number;
  blurb: string;
  /** The story world it belongs to (library.json "worlds"); missing means Wonder and Nature. */
  world?: string;
}
/**
 * A story world: Mo is always the guide; the world is where she takes the child
 * tonight. Chosen by interest, never labelled for boys or girls. A world with no
 * stories yet is not shown.
 */
interface StoryWorld {
  id: string;
  title: string;
  blurb: string;
  /** The world's own colour in the picker ("#rrggbb"); plain cream in high contrast. */
  color?: string;
}
const DEFAULT_WORLD = 'nature';
const MOTH_SCRIPT = 'story/the-moth.story.json';
/** "Dream a new one": what the app asks Mo for (server/dream.ts accepts exactly these). */
const DREAM_THEMES = ['sea', 'forest', 'meadow', 'river', 'rain', 'sky', 'space', 'road', 'dinosaurs'] as const;
/** The story worlds' creatures the chooser offers in their own places (a second row of shapes; server/dream.ts). */
const PLACE_CREATURES: Readonly<Record<string, readonly string[]>> = {
  sea: ['shark', 'octopus', 'whale'],
  space: ['rocket', 'alien', 'asteroid'],
  road: ['car', 'plane', 'digger'],
  dinosaurs: ['trex', 'pterodactyl'],
};
const WORLD_BUTTONS = ['dream-world-1', 'dream-world-2', 'dream-world-3'] as const;
/** Mo's suggestions for the child, one per row. */
const IDEA_BUTTONS = ['dream-idea-1', 'dream-idea-2', 'dream-idea-3'] as const;
/** Where each place is, in a sentence. */
const PLACE_WORDS: Readonly<Record<string, string>> = {
  sea: 'by the sea', forest: 'in the forest', meadow: 'in the meadow', river: 'by the river', rain: 'in the rain', sky: 'in the sky',
  space: 'in space', road: 'on the road', dinosaurs: 'with the dinosaurs',
};
/** "a dog, a bird and a swan" */
const shapeList = (shapes: readonly string[]): string => {
  const names = shapes.map((sh) => (sh === 'cup' ? 'cupped hands' : `a ${creatureName(sh).toLowerCase().replace('t. rex', 'T. rex')}`));
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
};
/** The chooser's shapes (an idea in words can also name the swan, crocodile, deer and snail). */
const DREAM_SHAPES = ['rabbit', 'fish', 'dog', 'bird', 'cup'] as const;
const DREAM_ANY_SHAPE: ReadonlySet<string> = new Set([...DREAM_SHAPES, 'swan', 'crocodile', 'deer', 'snail', ...Object.values(PLACE_CREATURES).flat()]);
/** Shapes to start from, or top up with, in a place: its own creatures where it has them (and the cup). */
const startingShapes = (theme: string): readonly string[] => (PLACE_CREATURES[theme] ? [...PLACE_CREATURES[theme], 'cup'] : DREAM_SHAPES);

/** Buttons with their own look (the rest are options and toggles). */
const REPLAY_BUTTONS = new Set(['replay-button']);

/**
 * Accessibility settings: a hands-first panel (pressed with hand rays) that
 * appears beside the open Shadow Journal. Applies recognition tolerance,
 * 'show me' timing and one-hand mode, persists them in IndexedDB, and asks
 * the story to replay from the Prologue.
 */
export class SettingsSystem extends createSystem({
  settings: { required: [Settings] },
  recognizers: { required: [ShapeRecognizer] },
  stories: { required: [StoryState] },
  journals: { required: [ShadowJournal] },
  stages: { required: [Stage] },
}) {
  private panel: UIKitMLAsset | undefined;
  private buttons = new Map<string, UIKit.Container>();
  private oneHandLabel: UIKit.Text | undefined;
  private contrastLabel: UIKit.Text | undefined;
  private gazeLabel: UIKit.Text | undefined;
  private voiceCommandsLabel: UIKit.Text | undefined;
  private musicLabel: UIKit.Text | undefined;
  private voiceLabel: UIKit.Text | undefined;
  private status: UIKit.Text | undefined;
  private loaded = false;
  private loading = false;
  private applied = '';
  /** What the story picker last showed. */
  private shownScript = '';
  private library: LibraryStory[] = [];
  /** Worlds that have at least one story, in library order. */
  private worlds: StoryWorld[] = [];
  /** Index of the world being looked at in the picker. */
  private browsingWorld = 0;
  /** Index (into the library) of the story being looked at in the picker. */
  private browsing = 0;
  private worldTitle: UIKit.Text | undefined;
  private worldBlurb: UIKit.Text | undefined;
  private storyTitle: UIKit.Text | undefined;
  private storyBlurb: UIKit.Text | undefined;
  private storyStart: UIKit.Text | undefined;
  /** Whether the server can dream up stories (null: not asked yet), and a dream in progress. */
  private dreamAvailable: boolean | null = null;
  private dreaming = false;
  /** "Say your idea": listening for a spoken story idea (null when not). */
  private wishListening: WishListening | null = null;
  private sayLabel: UIKit.Text | undefined;
  /** "Dream a new one", which reads "Mo is dreaming..." while a story is being dreamed up. */
  private dreamLabel: UIKit.Text | undefined;
  private dreamDots = -1;
  /** The dream chooser: open, and what it has picked. */
  private choosing = false;
  private dreamTheme: string = DREAM_THEMES[0];
  private dreamShapes: string[] = [];
  private dreams = 0;
  /**
   * A child's request or one of Mo's suggestions, taken into the chooser: its
   * words (sent as the idea), where in the place it happens (planned for that
   * place only), and the request it answers ('' for a suggestion).
   */
  private pendingWish = '';
  private pendingSetting = '';
  private pendingFor = '';
  private pendingTheme = '';
  private requestsShown = -1;
  /** Last unlock list shown on the chapter buttons. */
  private shownUnlocks: string | null = null;
  private quat = new Quaternion();
  private yAxis = new Vector3(0, 1, 0);

  update(): void {
    const settings = first(this.queries.settings.entities);
    if (!settings) return;
    if (!this.loaded && !this.loading) this.load(settings);
    if (!this.panel) this.bind(settings);
    if (!this.loaded) return;
    this.showDreaming();
    if (this.choosing && requestsRuntime.version !== this.requestsShown) this.refreshRequests();

    const tolerance = settings.getValue(Settings, 'tolerance') ?? ToleranceLevels.Normal;
    const hints = settings.getValue(Settings, 'hints') ?? HintModes.Delayed;
    const oneHand = Boolean(settings.getValue(Settings, 'oneHand'));
    const voice = Boolean(settings.getValue(Settings, 'placeholderVoice'));
    const highContrast = Boolean(settings.getValue(Settings, 'highContrast'));
    const gazeDwell = Boolean(settings.getValue(Settings, 'gazeDwell'));
    const voiceCommands = Boolean(settings.getValue(Settings, 'voiceCommands'));
    const music = Boolean(settings.getValue(Settings, 'music'));
    const key = `${tolerance}|${hints}|${oneHand}|${voice}|${highContrast}|${gazeDwell}|${voiceCommands}|${music}`;
    if (key !== this.applied) {
      accessRuntime.highContrast = highContrast;
      accessRuntime.gazeDwell = gazeDwell;
      this.restyle();
      this.apply(tolerance, hints, oneHand, voice, highContrast, gazeDwell);
      this.buttons.get('voice-commands-toggle')?.setProperties(voiceCommands ? palette().selected : palette().unselected);
      this.voiceCommandsLabel?.setProperties({ text: `Voice commands: ${voiceCommands ? 'On' : 'Off'}`, color: voiceCommands ? palette().ink : palette().cream });
      this.buttons.get('music-toggle')?.setProperties(music ? palette().selected : palette().unselected);
      this.musicLabel?.setProperties({ text: `Music: ${music ? 'On' : 'Off'}`, color: music ? palette().ink : palette().cream });
      if (this.applied) void saveSettings({ tolerance, hints, oneHand, highContrast, gazeDwell, voiceCommands, music, placeholderVoice: voice });
      this.applied = key;
    }
    if (dreamRuntime.request) {
      const { theme, shapes, wish } = dreamRuntime.request;
      dreamRuntime.request = null;
      this.closeDreamChooser();
      this.dream(theme, shapes, wish);
    }
    this.refreshStories();
    this.refreshChapters();
    this.place(settings);
  }

  /** The browsed story's name and blurb; the start button shows whether it is tonight's. */
  private refreshStories(): void {
    const script = first(this.queries.stories.entities)?.getValue(StoryState, 'script') ?? '';
    const key = `${script}|${this.browsingWorld}|${this.browsing}|${this.library.length}`;
    if (key === this.shownScript || !this.panel) return;
    this.shownScript = key;
    const world = this.worlds[this.browsingWorld];
    const p = palette();
    if (world) {
      const tint = accessRuntime.highContrast ? p.cream : (world.color ?? p.cream);
      this.worldTitle?.setProperties({ text: world.title, color: tint });
      this.worldBlurb?.setProperties({ text: world.blurb });
      for (const id of ['world-prev', 'world-next']) this.buttons.get(id)?.setProperties({ ...p.unselected, borderColor: tint, color: tint });
    }
    const story = this.library[this.browsing];
    if (!story) return;
    const telling = story.script === script;
    this.storyTitle?.setProperties({ text: story.title });
    const length = story.chapters ? `${story.chapters} chapters, ${story.minutes} min` : `${story.minutes} min`;
    this.storyBlurb?.setProperties({ text: `${story.blurb} (${length})` });
    this.buttons.get('story-start')?.setProperties(telling ? p.selected : p.unselected);
    this.storyStart?.setProperties({ text: telling ? 'Telling this story tonight' : 'Tell this story', color: telling ? p.ink : p.cream });
    this.panel.getElementById('chapter-section')?.setProperties({ display: script === MOTH_SCRIPT ? 'flex' : 'none' });
  }

  /** Library indexes of the stories in the world being looked at. */
  private storiesInWorld(): number[] {
    const world = this.worlds[this.browsingWorld]?.id ?? DEFAULT_WORLD;
    const out: number[] = [];
    this.library.forEach((s, i) => {
      if (worldOf(s) === world) out.push(i);
    });
    return out;
  }

  private loadLibrary(): void {
    fetch(`${import.meta.env.BASE_URL}story/library.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ worlds?: StoryWorld[]; stories: LibraryStory[] }>) : null))
      .then((lib) => {
        this.library = lib?.stories ?? [];
        const worlds = lib?.worlds?.length ? lib.worlds : [{ id: DEFAULT_WORLD, title: 'Wonder and Nature', blurb: '' }];
        this.worlds = worlds.filter((w) => this.library.some((s) => worldOf(s) === w.id));
        // Start browsing at tonight's story, in its world.
        const script = first(this.queries.stories.entities)?.getValue(StoryState, 'script') ?? '';
        this.browsing = Math.max(0, this.library.findIndex((s) => s.script === script));
        const current = this.library[this.browsing];
        this.browsingWorld = Math.max(0, this.worlds.findIndex((w) => current && w.id === worldOf(current)));
        this.shownScript = '';
      })
      .catch(() => undefined);
  }

  /**
   * "Dream a new one": Mo (Claude, on the server) writes a new short story for
   * a theme and two or three shapes picked here; it is kept on this device and
   * told at once. Only where the server has AI.
   */
  /** "Dream a new one": open the chooser (a place and two or three shapes), starting from a random pick. */
  private openDreamChooser(): void {
    if (!this.dreamAvailable) {
      this.status?.setProperties({ text: 'Mo can dream up new stories only where the app has AI.' });
      return;
    }
    if (this.choosing) return this.closeDreamChooser();
    this.choosing = true;
    this.dreamTheme = DREAM_THEMES[Math.floor(Math.random() * DREAM_THEMES.length)];
    this.dreamShapes = [...startingShapes(this.dreamTheme)].sort(() => Math.random() - 0.5).slice(0, 2);
    this.clearPending();
    this.panel?.getElementById('dream-section')?.setProperties({ display: 'flex' });
    const ask = requestsRuntime.pending;
    this.say(ask
        ? `${ask.from || 'Your family'} asked for a story. Press Dream ${possessive(ask.from)} story, or say your idea, or pick a place and shapes.`
        : 'Say your idea, or pick a place and two or three shapes, then Dream it.',
    );
    this.refreshDreamChooser();
    this.requestsShown = -1;
    void refreshSuggestions();
  }

  /** The child's request and Mo's suggestions for them, shown at the top of the chooser when there are any. */
  private refreshRequests(): void {
    this.requestsShown = requestsRuntime.version;
    const p = palette();
    const ask = requestsRuntime.pending;
    const show = (id: string, on: boolean) => this.panel?.getElementById(id)?.setProperties({ display: on ? 'flex' : 'none' });
    show('dream-ask-row', !!ask);
    show('dream-ask-buttons', !!ask);
    if (ask) {
      const what = ask.words ? `"${ask.words}"` : `a story${ask.theme ? ` ${PLACE_WORDS[ask.theme] ?? ''}` : ''}${ask.shapes?.length ? ` with ${shapeList(ask.shapes)}` : ''}`;
      dreamRuntime.shown.ask = `${ask.from || 'Your family'} asked: ${what}`;
      dreamRuntime.shown.askButton = `Dream ${possessive(ask.from)} story`;
      this.panel?.getElementById<UIKit.Text>('dream-ask-text')?.setProperties({ text: dreamRuntime.shown.ask, color: p.cream });
      this.panel?.getElementById<UIKit.Text>('dream-ask-go-label')?.setProperties({ text: dreamRuntime.shown.askButton });
    } else dreamRuntime.shown.ask = dreamRuntime.shown.askButton = '';
    const ideas = requestsRuntime.ideas;
    const child = requestsRuntime.child;
    // While Mo thinks, the rows are already there (three, as the ideas will be), so nothing moves under a pointer.
    const thinking = !ideas.length && (requestsRuntime.thinking || hasTaste());
    const rows = ideas.length || (thinking ? IDEA_BUTTONS.length : 0);
    const name = child && child !== 'your family' ? child : 'your child';
    show('dream-ideas-label', rows > 0);
    dreamRuntime.shown.ideasLabel = ideas.length ? `${cap(name)} might like` : thinking ? `Mo is thinking of stories ${name} would like...` : '';
    dreamRuntime.shown.ideas = ideas.map((i) => i.title);
    if (rows) this.panel?.getElementById<UIKit.Text>('dream-ideas-label')?.setProperties({ text: dreamRuntime.shown.ideasLabel });
    IDEA_BUTTONS.forEach((id, i) => {
      const idea = ideas[i];
      show(`dream-idea-row-${i + 1}`, i < rows);
      if (i < rows) this.panel?.getElementById<UIKit.Text>(`${id}-label`)?.setProperties({ text: idea?.title ?? '...', color: idea ? p.cream : p.muted });
    });
  }

  /** "Dream Mia's story": Mo plans the request (the closest place the app has, its shapes, where in it the idea happens) into the chooser, to change or dream. */
  private takeAsk(): void {
    const ask = requestsRuntime.pending;
    if (!ask || this.dreaming) return;
    this.say(`Mo is thinking about ${possessive(ask.from)} idea...`);
    void planAsk(ask).then((plan) => {
      if (!this.choosing || requestsRuntime.pending?.id !== ask.id) return;
      if (!plan) {
        // No plan (offline): the request as it came, the rest picked when it is dreamed.
        this.takeIntoChooser(ask.theme ?? this.dreamTheme, ask.shapes?.length ? ask.shapes : this.dreamShapes, ask.words ?? '', '', ask.id);
        this.say(`${possessive(ask.from)} idea is ready. Change the place or shapes if you like, then Dream it.`);
        return;
      }
      this.takeIntoChooser(plan.theme, plan.shapes, ask.words ?? '', plan.setting ?? '', ask.id);
      const where = plan.setting || PLACE_WORDS[plan.theme] || plan.theme;
      this.say(
        `${ask.words ? `${possessive(ask.from)} idea` : 'This story'}, ${where}, with ${shapeList(plan.shapes)}. Change the place or shapes if you like, then Dream it.`,
      );
    });
  }

  /** One of Mo's suggestions, into the chooser. */
  private takeIdea(i: number): void {
    const idea = requestsRuntime.ideas[i];
    if (!idea || this.dreaming) return;
    this.takeIntoChooser(idea.theme, idea.shapes, idea.idea, '', '');
    this.say(`${idea.title}: ${idea.why}. Dream it, or change the place or shapes first.`);
  }

  private takeIntoChooser(theme: string, shapes: readonly string[], wish: string, setting: string, askId: string): void {
    this.dreamTheme = (DREAM_THEMES as readonly string[]).includes(theme) ? theme : this.dreamTheme;
    this.dreamShapes = [...new Set(shapes.filter((x) => DREAM_ANY_SHAPE.has(x)))].slice(0, MAX_DREAM_SHAPES);
    this.pendingWish = wish;
    this.pendingSetting = setting;
    this.pendingTheme = this.dreamTheme;
    this.pendingFor = askId;
    this.refreshDreamChooser();
  }

  /** The status line, for a request or a suggestion (also kept in dreamRuntime.shown for tests and diagnostics). */
  private say(text: string): void {
    dreamRuntime.shown.status = text;
    this.status?.setProperties({ text });
  }

  private clearPending(): void {
    this.pendingWish = this.pendingSetting = this.pendingFor = this.pendingTheme = '';
  }

  /**
   * "Say your idea": the grown-up (or child) says what story they would like,
   * in their own words ("a forest story with a dog and a rabbit"); Mo writes
   * it. A second press while listening finishes early.
   */
  private sayWish(): void {
    if (this.wishListening) return this.wishListening.finish();
    if (this.dreaming) return;
    const p = palette();
    const button = this.buttons.get('dream-say');
    const idle = () => {
      this.wishListening = null;
      dreamRuntime.wish.state = '';
      button?.setProperties(p.unselected);
      this.sayLabel?.setProperties({ text: 'Say your idea', color: p.cream });
      dreamRuntime.wish.label = 'Say your idea';
    };
    void canHearWishes().then((ok) => {
      if (!ok) {
        this.status?.setProperties({ text: 'Mo cannot hear ideas in this browser. Pick a place and shapes instead.' });
        return;
      }
      if (this.wishListening || !this.choosing) return;
      const listening = listenForWish();
      this.wishListening = listening;
      dreamRuntime.wish.state = 'listening';
      button?.setProperties(p.selected);
      // The same button finishes: it says so (Quest 3, Nov 16: "click done", but no Done button to be seen).
      this.sayLabel?.setProperties({ text: 'Done', color: p.ink });
      dreamRuntime.wish.label = 'Done';
      this.status?.setProperties({ text: 'Listening... Tell Mo your idea, like: a forest story with a dog and a rabbit. Then press Done, or just stop talking.' });
      void listening.stopped.then(() => {
        if (this.wishListening !== listening) return;
        // The microphone is off: say so while the words are worked out.
        dreamRuntime.wish.state = 'understanding';
        this.sayLabel?.setProperties({ text: 'Got it', color: p.ink });
        dreamRuntime.wish.label = 'Got it';
        this.status?.setProperties({ text: 'Got it. Mo is working out your words...' });
      });
      listening.words
        .then((words) => {
          if (this.wishListening !== listening) return;
          idle();
          dreamRuntime.wish.heard = words;
          if (!words) {
            this.status?.setProperties({ text: 'Mo did not hear an idea. Press Say your idea and try again.' });
            return;
          }
          this.closeDreamChooser();
          this.dream(undefined, [], words);
        })
        .catch(() => {
          if (this.wishListening !== listening) return;
          idle();
          this.status?.setProperties({ text: 'Mo needs the microphone to hear your idea.' });
        });
    });
  }

  private closeDreamChooser(): void {
    this.wishListening?.cancel();
    this.choosing = false;
    this.clearPending();
    dreamRuntime.chooser = { ...dreamRuntime.chooser, open: false };
    this.panel?.getElementById('dream-section')?.setProperties({ display: 'none' });
  }

  /** A shape in the chooser: on or off, kept in the order picked (the order the story asks for them). */
  private toggleDreamShape(shape: string): void {
    if (this.dreamShapes.includes(shape)) this.dreamShapes = this.dreamShapes.filter((s) => s !== shape);
    else if (this.dreamShapes.length >= 3) this.status?.setProperties({ text: 'Three shapes at most: take one off first.' });
    else this.dreamShapes = [...this.dreamShapes, shape];
    this.refreshDreamChooser();
  }

  private refreshDreamChooser(): void {
    dreamRuntime.chooser = { open: this.choosing, theme: this.dreamTheme, shapes: [...this.dreamShapes] };
    const p = palette();
    for (const t of DREAM_THEMES) this.buttons.get(`dream-theme-${t}`)?.setProperties(t === this.dreamTheme ? p.selected : p.unselected);
    for (const sh of DREAM_SHAPES) this.buttons.get(`dream-shape-${sh}`)?.setProperties(this.dreamShapes.includes(sh) ? p.selected : p.unselected);
    // The place's own creatures, if it has them (a shark by the sea, a rocket in space).
    const own = PLACE_CREATURES[this.dreamTheme] ?? [];
    this.panel?.getElementById('dream-world-row')?.setProperties({ display: own.length ? 'flex' : 'none' });
    WORLD_BUTTONS.forEach((id, i) => {
      const shape = own[i];
      const on = !!shape && this.dreamShapes.includes(shape);
      this.buttons.get(id)?.setProperties({ ...(on ? p.selected : p.unselected), display: shape ? 'flex' : 'none' });
      if (shape) this.panel?.getElementById<UIKit.Text>(`${id}-label`)?.setProperties({ text: creatureName(shape), color: on ? p.ink : p.cream });
    });
  }

  /** "Dream it" in the chooser. */
  private dreamChosen(): void {
    if (this.dreamShapes.length < 2) {
      this.status?.setProperties({ text: 'Pick at least two shapes.' });
      return;
    }
    // A request or a suggestion keeps its words; its setting only in the place it was planned for.
    const wish = this.pendingWish;
    const setting = this.dreamTheme === this.pendingTheme ? this.pendingSetting : '';
    const askId = this.pendingFor;
    this.closeDreamChooser();
    this.dream(this.dreamTheme, this.dreamShapes, wish || undefined, setting || undefined, askId || undefined);
  }

  /**
   * Ask Mo for a story about `theme` with `shapes` (in order). Missing parts are
   * picked at random (a voice command may name only a place, or nothing), or,
   * with a `wish` (an idea said in plain words), by the server's model from it.
   */
  dream(theme?: string, shapes: readonly string[] = [], wish?: string, setting?: string, askId?: string): void {
    const story = first(this.queries.stories.entities);
    if (!story || this.dreaming || story.getValue(StoryState, 'followMode')) return;
    if (!this.dreamAvailable) {
      this.status?.setProperties({ text: 'Mo can dream up new stories only where the app has AI.' });
      return;
    }
    const known = theme && (DREAM_THEMES as readonly string[]).includes(theme) ? theme : '';
    const chosen = [...new Set(shapes.filter((x) => DREAM_ANY_SHAPE.has(x)))].slice(0, MAX_DREAM_SHAPES);
    let body: { theme?: string; shapes: string[]; wish?: string; setting?: string };
    if (wish) {
      // The server reads the place and shapes from the idea (its model picks what it leaves out).
      body = { ...(known ? { theme: known } : {}), shapes: chosen, wish, ...(known && setting ? { setting } : {}) };
    } else {
      const place = known || DREAM_THEMES[Math.floor(Math.random() * DREAM_THEMES.length)];
      const rest = startingShapes(place).filter((x) => !chosen.includes(x)).sort(() => Math.random() - 0.5);
      // Two at least: a one-shape (or no-shape) request is topped up at random.
      body = {
        theme: place,
        shapes: chosen.length >= 2 ? chosen : [...chosen, ...rest].slice(0, chosen.length ? 2 : Math.random() < 0.5 ? 2 : 3),
      };
    }
    this.dreaming = true;
    accessRuntime.dreaming = true;
    this.status?.setProperties({ text: wish ? `Heard: "${wish}". Mo is dreaming it up...` : 'Mo is dreaming up a story...' });
    dreamRuntime.asked = { theme: body.theme ?? '', shapes: [...body.shapes], ...(wish ? { wish } : {}), ...(body.setting ? { setting: body.setting } : {}) };
    const t0 = performance.now();
    fetch('/api/dream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) })
      .then(async (r) => {
        const script = r.ok ? ((await r.json()) as { version?: string; title?: string; beats?: unknown[] }) : null;
        if (!script || script.version !== 'shadowplay.story.v1' || !Array.isArray(script.beats)) throw new Error(`dream ${r.status}`);
        await saveDreamed(script);
        dreamRuntime.ms = Math.round(performance.now() - t0);
        dreamRuntime.title = script.title ?? '';
        dreamRuntime.ok++;
        for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
        // A new path each time, so the story system loads the new one (only the latest is kept).
        const current = story.getValue(StoryState, 'script') ?? '';
        this.dreams = Math.max(this.dreams, isDreamed(current) ? Number(current.slice(8)) : 0) + 1;
        story.setValue(StoryState, 'script', `dreamed:${this.dreams}`);
        this.status?.setProperties({ text: `Mo dreamed "${script.title}"...` });
        // A child's request, answered: it leaves the journal, and the story counts toward their taste.
        if (askId) void answerAsk(askId, body.theme ?? '', body.shapes);
      })
      .catch(() => {
        dreamRuntime.failed++;
        this.status?.setProperties({ text: 'Mo could not dream one just now. Try again in a moment.' });
      })
      .finally(() => {
        this.dreaming = false;
        accessRuntime.dreaming = false;
      });
  }

  /**
   * While a story is being dreamed up, "Dream a new one" reads "Mo is dreaming..."
   * (the wall says so too, its dots moving, captions.ts): there were 3 to 5 quiet
   * seconds after an idea was heard (Quest 3S, Nov 16).
   */
  private showDreaming(): void {
    // Steady: changing dots made the label re-centre and jitter (the wall's line animates them, captions.ts).
    const dots = this.dreaming ? 1 : -1;
    if (dots === this.dreamDots) return;
    this.dreamDots = dots;
    const p = palette();
    this.buttons.get('story-dream')?.setProperties(dots >= 0 ? p.selected : p.unselected);
    this.dreamLabel?.setProperties(dots >= 0 ? { text: 'Mo is dreaming...', color: p.ink } : { text: 'Dream a new one', color: p.cream });
  }

  /** Dim chapters the player has not reached yet. */
  private refreshChapters(): void {
    const unlocks = first(this.queries.stories.entities)?.getValue(StoryState, 'unlocked') ?? '';
    if (unlocks === this.shownUnlocks || this.buttons.size === 0) return;
    this.shownUnlocks = unlocks;
    const reached = unlocks.split(',');
    for (const [id, chapter] of CHAPTER_BUTTONS) {
      this.buttons.get(id)?.setProperties(reached.includes(chapter) ? palette().unselected : palette().locked);
    }
  }

  private load(settings: Entity): void {
    this.loading = true;
    loadSettings().then((stored) => {
      if (stored) {
        settings.setValue(Settings, 'tolerance', stored.tolerance as never);
        settings.setValue(Settings, 'hints', stored.hints as never);
        settings.setValue(Settings, 'oneHand', stored.oneHand);
        settings.setValue(Settings, 'highContrast', Boolean(stored.highContrast));
        settings.setValue(Settings, 'gazeDwell', Boolean(stored.gazeDwell));
        settings.setValue(Settings, 'voiceCommands', Boolean(stored.voiceCommands));
        settings.setValue(Settings, 'music', stored.music !== false);
        settings.setValue(Settings, 'placeholderVoice', Boolean(stored.placeholderVoice));
      }
      this.loaded = true;
    });
  }

  private bind(settings: Entity): void {
    const panel = this.world.getSceneObject<UIKitMLAsset>(PANEL_NODE);
    if (!panel) return;
    this.panel = panel;
    const on = (id: string, handler: () => void) => {
      const el = panel.getElementById<UIKit.Container>(id);
      if (!el) return;
      el.name = id;
      this.buttons.set(id, el);
      const click = () => {
        playClick(settings.object3D?.position);
        uiPresses.push(id);
        if (uiPresses.length > 50) uiPresses.shift();
        handler();
      };
      el.addEventListener('click', click);
      gazeTargets.set(id, { object: el, press: click });
      this.cleanupFuncs.push(() => {
        el.removeEventListener('click', click);
        gazeTargets.delete(id);
      });
    };
    for (const [id, value] of TOLERANCE_BUTTONS) on(id, () => settings.setValue(Settings, 'tolerance', value as never));
    for (const [id, value] of HINT_BUTTONS) on(id, () => settings.setValue(Settings, 'hints', value as never));
    on('one-hand-toggle', () => settings.setValue(Settings, 'oneHand', !settings.getValue(Settings, 'oneHand')));
    on('contrast-toggle', () => settings.setValue(Settings, 'highContrast', !settings.getValue(Settings, 'highContrast')));
    on('gaze-toggle', () => settings.setValue(Settings, 'gazeDwell', !settings.getValue(Settings, 'gazeDwell')));
    on('voice-commands-toggle', () => settings.setValue(Settings, 'voiceCommands', !settings.getValue(Settings, 'voiceCommands')));
    on('music-toggle', () => settings.setValue(Settings, 'music', !settings.getValue(Settings, 'music')));
    on('voice-toggle', () =>
      settings.setValue(Settings, 'placeholderVoice', !settings.getValue(Settings, 'placeholderVoice')),
    );
    for (const [id, chapter, name] of CHAPTER_BUTTONS) {
      on(id, () => {
        const story = first(this.queries.stories.entities);
        const unlocked = (story?.getValue(StoryState, 'unlocked') ?? '').split(',');
        if (!story || !unlocked.includes(chapter)) {
          this.status?.setProperties({ text: 'Reach this chapter in the story first.' });
          return;
        }
        for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
        story.setValue(StoryState, 'jumpTo', chapter);
        this.status?.setProperties({ text: `Starting ${name}...` });
      });
    }
    // Stories step within the world being looked at; worlds step to that world's first story.
    const browse = (step: number) => {
      const inWorld = this.storiesInWorld();
      if (!inWorld.length) return;
      const at = Math.max(0, inWorld.indexOf(this.browsing));
      this.browsing = inWorld[(at + step + inWorld.length) % inWorld.length];
    };
    const browseWorld = (step: number) => {
      if (!this.worlds.length) return;
      this.browsingWorld = (this.browsingWorld + step + this.worlds.length) % this.worlds.length;
      this.browsing = this.storiesInWorld()[0] ?? this.browsing;
    };
    on('world-prev', () => browseWorld(-1));
    on('world-next', () => browseWorld(1));
    on('story-prev', () => browse(-1));
    on('story-next', () => browse(1));
    on('story-start', () => {
      const story = first(this.queries.stories.entities);
      const chosen = this.library[this.browsing];
      if (!story || !chosen || story.getValue(StoryState, 'followMode')) return;
      if (story.getValue(StoryState, 'script') === chosen.script) return;
      for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
      story.setValue(StoryState, 'script', chosen.script);
      this.status?.setProperties({ text: `Starting "${chosen.title}"...` });
    });
    on('story-dream', () => this.openDreamChooser());
    for (const t of DREAM_THEMES) {
      on(`dream-theme-${t}`, () => {
        // Another place's own creatures are not on show here any more: they come off.
        const others = Object.entries(PLACE_CREATURES).filter(([place]) => place !== t).flatMap(([, shapes]) => shapes);
        this.dreamShapes = this.dreamShapes.filter((sh) => !others.includes(sh));
        this.dreamTheme = t;
        this.refreshDreamChooser();
      });
    }
    for (const sh of DREAM_SHAPES) on(`dream-shape-${sh}`, () => this.toggleDreamShape(sh));
    WORLD_BUTTONS.forEach((id, i) =>
      on(id, () => {
        const shape = PLACE_CREATURES[this.dreamTheme]?.[i];
        if (shape) this.toggleDreamShape(shape);
      }),
    );
    on('dream-go', () => this.dreamChosen());
    on('dream-cancel', () => this.closeDreamChooser());
    on('dream-say', () => this.sayWish());
    on('dream-ask-go', () => this.takeAsk());
    IDEA_BUTTONS.forEach((id, i) => on(id, () => this.takeIdea(i)));
    void loadStoryRequests();
    this.sayLabel = panel.getElementById<UIKit.Text>('dream-say-label') ?? undefined;
    this.dreamLabel = panel.getElementById<UIKit.Text>('story-dream-label') ?? undefined;
    panel.getElementById('dream-section')?.setProperties({ display: 'none' });
    this.choosing = false;
    fetch('/api/dream')
      .then((r) => (r.ok ? (r.json() as Promise<{ available?: boolean }>) : { available: false }))
      .then((r) => (this.dreamAvailable = Boolean(r.available)))
      .catch(() => (this.dreamAvailable = false));
    this.worldTitle = panel.getElementById<UIKit.Text>('world-title') ?? undefined;
    this.worldBlurb = panel.getElementById<UIKit.Text>('world-blurb') ?? undefined;
    this.storyTitle = panel.getElementById<UIKit.Text>('story-title') ?? undefined;
    this.storyBlurb = panel.getElementById<UIKit.Text>('story-blurb') ?? undefined;
    this.storyStart = panel.getElementById<UIKit.Text>('story-start-label') ?? undefined;
    if (!this.library.length) this.loadLibrary();
    on('replace-stage-button', () => {
      // "Move stage here": close the journal and place the stage again, ahead of
      // wherever the player looks a moment from now (time to turn toward the spot).
      for (const j of this.queries.journals.entities) j.setValue(ShadowJournal, 'open', false);
      for (const s of this.queries.stages.entities) s.setValue(Stage, 'replaceRequested', true);
      this.status?.setProperties({ text: 'Look where you want the stage...' });
    });
    on('replay-button', () => {
      settings.setValue(Settings, 'replayRequested', true);
      this.status?.setProperties({ text: 'Story restarted from the Prologue.' });
    });
    this.oneHandLabel = panel.getElementById<UIKit.Text>('one-hand-label') ?? undefined;
    this.status = panel.getElementById<UIKit.Text>('status-text') ?? undefined;
    if (this.oneHandLabel) this.oneHandLabel.name = 'one-hand-label';
    this.contrastLabel = panel.getElementById<UIKit.Text>('contrast-label') ?? undefined;
    if (this.contrastLabel) this.contrastLabel.name = 'contrast-label';
    this.gazeLabel = panel.getElementById<UIKit.Text>('gaze-label') ?? undefined;
    if (this.gazeLabel) this.gazeLabel.name = 'gaze-label';
    this.voiceCommandsLabel = panel.getElementById<UIKit.Text>('voice-commands-label') ?? undefined;
    if (this.voiceCommandsLabel) this.voiceCommandsLabel.name = 'voice-commands-label';
    this.musicLabel = panel.getElementById<UIKit.Text>('music-label') ?? undefined;
    if (this.musicLabel) this.musicLabel.name = 'music-label';
    this.voiceLabel = panel.getElementById<UIKit.Text>('voice-label') ?? undefined;
    if (this.voiceLabel) this.voiceLabel.name = 'voice-label';
    // The placeholder voice is a development aid only; production builds hide it.
    // Test-only (and hidden in development with ?clean, for submission stills).
    if (!import.meta.env.DEV || new URLSearchParams(location.search).has('clean')) panel.getElementById('voice-section')?.setProperties({ display: 'none' });
    if (this.status) this.status.name = 'status-text';
    this.applied = '';
    this.shownUnlocks = null;
    this.shownScript = '';
  }

  /**
   * Every button and the panel itself in the current palette (high contrast or
   * not); apply() then highlights the selected ones, and the story and chapter
   * rows are redrawn on the next update.
   */
  private restyle(): void {
    const p = palette();
    this.panel?.getElementById('settings-root')?.setProperties(p.root);
    for (const [id, el] of this.buttons) el.setProperties(REPLAY_BUTTONS.has(id) ? p.replay : p.unselected);
    this.shownScript = '';
    this.shownUnlocks = null;
  }

  private apply(tolerance: string, hints: string, oneHand: boolean, voice: boolean, highContrast: boolean, gazeDwell: boolean): void {
    for (const r of this.queries.recognizers.entities) {
      r.setValue(ShapeRecognizer, 'tolerance', TOLERANCE_VALUE[tolerance] ?? 0.3);
      r.setValue(ShapeRecognizer, 'oneHand', oneHand);
    }
    for (const s of this.queries.stories.entities) {
      // Look to press: the ghost hand is what you look at to make a shape, so it shows at once.
      s.setValue(StoryState, 'hintAfterSeconds', gazeDwell ? 0 : (HINT_AFTER[hints] ?? 15));
    }
    const p = palette();
    const pick = (on: boolean) => (on ? p.selected : p.unselected);
    for (const [id, value] of TOLERANCE_BUTTONS) this.buttons.get(id)?.setProperties(pick(value === tolerance));
    for (const [id, value] of HINT_BUTTONS) this.buttons.get(id)?.setProperties(pick(value === hints));
    this.buttons.get('one-hand-toggle')?.setProperties(pick(oneHand));
    this.buttons.get('contrast-toggle')?.setProperties(pick(highContrast));
    this.buttons.get('gaze-toggle')?.setProperties(pick(gazeDwell));
    this.gazeLabel?.setProperties({ text: `Look to press: ${gazeDwell ? 'On' : 'Off'}`, color: gazeDwell ? p.ink : p.cream });
    this.buttons.get('voice-toggle')?.setProperties(pick(voice));
    this.voiceLabel?.setProperties({ text: `Placeholder voice: ${voice ? 'On' : 'Off'}`, color: voice ? p.ink : p.cream });
    this.oneHandLabel?.setProperties({ text: `One-hand mode: ${oneHand ? 'On' : 'Off'}`, color: oneHand ? p.ink : p.cream });
    this.contrastLabel?.setProperties({ text: `High contrast: ${highContrast ? 'On' : 'Off'}`, color: highContrast ? p.ink : p.cream });
  }

  /** Beside the open journal page, to the right of the stage; tucked away otherwise. */
  private place(settings: Entity): void {
    const obj = settings.object3D;
    if (!obj) return;
    const open = Boolean(first(this.queries.journals.entities)?.getValue(ShadowJournal, 'open'));
    const show = open && stageRuntime.ready;
    obj.visible = show;
    if (!show) {
      obj.position.set(0, -10, 0);
      return;
    }
    // Readable from the seat: ~2.3 cm body text on a wall ~2 m away, scaled with the distance
    // (so the text keeps its size in view even where a narrow field of view shrinks the stage).
    const scale = READABLE_SCALE * Math.min(1.4, Math.max(0.6, (stageRuntime.distance * WIDTH_AT_ONE_METER) / 1.1));
    // A narrow field of view (below NARROW_FOV): over the middle of the stage, where it stays in view,
    // instead of beside it.
    const narrow = stageRuntime.fovH > 0 && stageRuntime.fovH < NARROW_FOV;
    const n = stageRuntime.normal;
    obj.quaternion.copy(this.quat.setFromAxisAngle(this.yAxis, Math.atan2(n.x, n.z)));
    obj.scale.setScalar(scale);
    obj.position
      .copy(stageRuntime.center)
      .addScaledVector(stageRuntime.right, narrow ? 0 : stageRuntime.width * 0.46 + (PANEL_WIDTH * scale) / 2 + 0.04)
      // About 3 degrees below eye level: looking down at a menu is easier than looking up.
      .addScaledVector(stageRuntime.up, -stageRuntime.distance * WIDTH_AT_ONE_METER * PANEL_DROP)
      .addScaledVector(n, narrow ? 0.06 : 0.04);
  }
}

/** For tests and diagnostics: the last dream asked for, and how dreaming has gone. */
export const dreamRuntime = {
  asked: null as { theme: string; shapes: string[]; wish?: string; setting?: string } | null,
  /** A dream asked for elsewhere (a voice command): taken by the Settings system on its next update. */
  request: null as { theme: string; shapes: string[]; wish?: string } | null,
  /** "Say your idea": 'listening' while the microphone is on, 'understanding' while the words are worked out, else ''; and the last words heard. */
  wish: { state: '' as '' | 'listening' | 'understanding', label: 'Say your idea', heard: '', listen: wishListenRuntime },
  /** The chooser as shown (for tests and diagnostics). */
  chooser: { open: false, theme: '', shapes: [] as string[] },
  /** A child's request and Mo's suggestions as shown on the panel, and the status line about them. */
  shown: { status: '', ask: '', askButton: '', ideasLabel: '', ideas: [] as string[] },
  title: '',
  ms: 0,
  ok: 0,
  failed: 0,
};

const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

/** "Mia's", "James'", "your family's". */
function possessive(name: string): string {
  const n = name || 'your family';
  return n.endsWith('s') ? `${n}'` : `${n}'s`;
}

function first<T>(set: Iterable<T>): T | undefined {
  for (const v of set) return v;
  return undefined;
}

/** A story's world (stories from before worlds belong to Wonder and Nature). */
function worldOf(story: LibraryStory): string {
  return story.world ?? DEFAULT_WORLD;
}
