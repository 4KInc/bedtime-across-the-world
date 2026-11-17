import { encodeDrawing, MO_PALETTES, MoPaletteId, Stroke } from './child-gifts.js';
import { MAX_ASK_SHAPES, softenIdea, type StoryAsk } from './story-checks.js';
import { canHearWishes, listenForWish, type WishListening } from './wish-listener.js';

/** Places and creatures to ask for in pictures (for a child who cannot say it yet). */
const ASK_PLACES: readonly [string, string, string][] = [
  ['sea', '🌊', 'Sea'], ['forest', '🌲', 'Forest'], ['meadow', '🌼', 'Meadow'], ['river', '🏞️', 'River'], ['rain', '🌧️', 'Rain'],
  ['sky', '☁️', 'Sky'], ['space', '🪐', 'Space'], ['road', '🛣️', 'Road'], ['dinosaurs', '🦕', 'Dinosaurs'],
];
const ASK_CREATURES: readonly [string, string, string][] = [
  ['rabbit', '🐰', 'Rabbit'], ['dog', '🐶', 'Dog'], ['fish', '🐟', 'Fish'], ['bird', '🐦', 'Bird'], ['swan', '🦢', 'Swan'],
  ['deer', '🦌', 'Deer'], ['snail', '🐌', 'Snail'], ['crocodile', '🐊', 'Crocodile'], ['whale', '🐳', 'Whale'], ['shark', '🦈', 'Shark'],
  ['octopus', '🐙', 'Octopus'], ['rocket', '🚀', 'Rocket'], ['alien', '👽', 'Alien'], ['car', '🚗', 'Car'], ['plane', '✈️', 'Aeroplane'],
  ['trex', '🦖', 'T. rex'],
];

const STYLE = `
.sp-gifts { margin: 10px 0 4px; display: grid; gap: 10px; }
.sp-gifts .sp-swatches { display: flex; gap: 10px; flex-wrap: wrap; }
.sp-swatch { width: 56px; height: 56px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; padding: 0; }
.sp-swatch[aria-pressed="true"] { border-color: #f6e3bd; box-shadow: 0 0 0 3px #e0a24a; }
.sp-ask { display: grid; gap: 8px; }
.sp-ask .sp-pics { display: flex; gap: 6px; flex-wrap: wrap; }
.sp-pic { min-width: 52px; height: 52px; border-radius: 12px; border: 2px solid #e0a24a; background: #2a2433; color: #f6e3bd;
  font-size: 26px; cursor: pointer; padding: 0 6px; }
.sp-pic[aria-pressed="true"] { background: #e0a24a; }
.sp-idea { width: 100%; box-sizing: border-box; font: inherit; font-size: 17px; padding: 10px; border-radius: 10px; border: 2px solid #e0a24a;
  background: #f6e3bd; color: #1b1822; }
.sp-pad { width: min(260px, 70vw); aspect-ratio: 1; touch-action: none; border-radius: 16px;
  background: #f1dfbd; border: 2px solid #e0a24a; cursor: crosshair; display: block; }
`;

let styled = false;

/**
 * On the family viewer, with a goodnight: the child can choose colours for Mo
 * and draw a creature with a finger for the storyteller's next story. Both are
 * optional; only a palette name and the strokes (a few kilobytes) are sent.
 */
export class GiftPicker {
  private mo: MoPaletteId | null = null;
  private strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private pad: HTMLCanvasElement;
  /** Tomorrow's story, asked for: the child's words (softened as they are typed or heard), a place, creatures. */
  private askTheme = '';
  private askShapes: string[] = [];
  private ideaInput: HTMLInputElement;
  private listening: WishListening | null = null;

  constructor(host: HTMLElement, to: string) {
    if (!styled) {
      const style = document.createElement('style');
      style.textContent = STYLE;
      document.head.appendChild(style);
      styled = true;
    }
    const swatches = Object.entries(MO_PALETTES)
      .map(([id, p]) => `<button class="sp-swatch" data-mo="${id}" aria-pressed="false" aria-label="${p.name}" title="${p.name}"
        style="background: radial-gradient(circle, #${hex(p.glow)} 0 45%, #${hex(p.wings)} 46% 100%)"></button>`)
      .join('');
    host.innerHTML = `<div class="sp-gifts">
      <div>Colour Mo for ${escape(to)} (if you like):</div>
      <div class="sp-swatches" role="group" aria-label="Mo's colours">${swatches}</div>
      <div>Draw a creature for ${escape(to)}'s next story:</div>
      <canvas class="sp-pad" width="256" height="256" aria-label="Drawing pad"></canvas>
      <div class="sp-row"><button class="sp-btn" data-act="clear-drawing">Clear drawing</button></div>
      <div class="sp-ask" role="group" aria-label="Ask for tomorrow's story">
        <div>Ask ${escape(to)} for tomorrow's story (if you like):</div>
        <div class="sp-row"><button class="sp-btn" data-act="say-idea" hidden>Say it</button></div>
        <input class="sp-idea" data-idea maxlength="200" placeholder="A story about..." aria-label="The story you would like">
        <div class="sp-note" data-idea-note aria-live="polite"></div>
        <div>Or pick a place:</div>
        <div class="sp-pics" role="group" aria-label="Places">${ASK_PLACES.map(([id, pic, name]) => `<button class="sp-pic" data-place="${id}" aria-pressed="false" aria-label="${name}" title="${name}">${pic}</button>`).join('')}</div>
        <div>And up to ${MAX_ASK_SHAPES} creatures:</div>
        <div class="sp-pics" role="group" aria-label="Creatures">${ASK_CREATURES.map(([id, pic, name]) => `<button class="sp-pic" data-creature="${id}" aria-pressed="false" aria-label="${name}" title="${name}">${pic}</button>`).join('')}</div>
        <div class="sp-note">For grown-ups: the words are sent to ${escape(to)} with this goodnight. Mo only uses them if ${escape(to)} dreams the story.</div>
      </div>
    </div>`;
    this.ideaInput = host.querySelector<HTMLInputElement>('[data-idea]')!;
    const note = host.querySelector<HTMLElement>('[data-idea-note]')!;
    // Softened as it is typed: what will be sent, and why anything was left out.
    const soften = () => {
      const { words, dropped } = softenIdea(this.ideaInput.value);
      note.textContent = dropped.length
        ? `Mo will leave out "${dropped.join('", "')}": she makes up her own gentle characters. ${to} will see: ${words || '(nothing)'}`
        : '';
      return words;
    };
    this.ideaInput.addEventListener('input', soften);
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-place]')) {
      b.addEventListener('click', () => {
        this.askTheme = this.askTheme === b.dataset.place ? '' : b.dataset.place!;
        for (const o of host.querySelectorAll<HTMLButtonElement>('[data-place]')) o.setAttribute('aria-pressed', String(o.dataset.place === this.askTheme));
      });
    }
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-creature]')) {
      b.addEventListener('click', () => {
        const id = b.dataset.creature!;
        if (this.askShapes.includes(id)) this.askShapes = this.askShapes.filter((c) => c !== id);
        else if (this.askShapes.length < MAX_ASK_SHAPES) this.askShapes = [...this.askShapes, id];
        for (const o of host.querySelectorAll<HTMLButtonElement>('[data-creature]')) o.setAttribute('aria-pressed', String(this.askShapes.includes(o.dataset.creature!)));
      });
    }
    // "Say it": the microphone only from this press until the idea is said (wish-listener.ts).
    const say = host.querySelector<HTMLButtonElement>('[data-act="say-idea"]')!;
    void canHearWishes().then((ok) => (say.hidden = !ok));
    say.addEventListener('click', () => {
      if (this.listening) return this.listening.finish();
      const listening = listenForWish();
      this.listening = listening;
      say.textContent = 'Done';
      say.classList.add('on');
      note.textContent = 'Listening... say the story you would like.';
      listening.words
        .then((words) => {
          if (words) this.ideaInput.value = words;
          note.textContent = words ? '' : 'Mo did not hear that. Try again, or pick pictures.';
          if (words) soften();
        })
        .catch(() => (note.textContent = 'The microphone is needed to say it. You can type it or pick pictures.'))
        .finally(() => {
          this.listening = null;
          say.textContent = 'Say it';
          say.classList.remove('on');
        });
    });
    for (const b of host.querySelectorAll<HTMLButtonElement>('[data-mo]')) {
      b.addEventListener('click', () => {
        const id = b.dataset.mo as MoPaletteId;
        this.mo = this.mo === id ? null : id;
        for (const o of host.querySelectorAll<HTMLButtonElement>('[data-mo]')) o.setAttribute('aria-pressed', String(o.dataset.mo === this.mo));
      });
    }
    this.pad = host.querySelector('canvas')!;
    this.pad.addEventListener('pointerdown', (e) => {
      this.pad.setPointerCapture(e.pointerId);
      this.current = [this.point(e)];
      this.strokes.push(this.current);
      this.paint();
    });
    this.pad.addEventListener('pointermove', (e) => {
      if (!this.current) return;
      const p = this.point(e);
      const last = this.current[this.current.length - 1];
      // Thin the points: a little apart is enough for a felt-tip line.
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.012) this.current.push(p);
      this.paint();
    });
    const end = () => (this.current = null);
    this.pad.addEventListener('pointerup', end);
    this.pad.addEventListener('pointercancel', end);
    host.querySelector('[data-act="clear-drawing"]')?.addEventListener('click', () => {
      this.strokes = [];
      this.paint();
    });
  }

  /** What to send with the goodnight (nothing chosen, nothing sent). */
  get(): { mo?: string; drawing?: string; ask?: StoryAsk } {
    const out: { mo?: string; drawing?: string; ask?: StoryAsk } = {};
    if (this.mo) out.mo = this.mo;
    if (this.strokes.length) out.drawing = encodeDrawing(this.strokes);
    const words = softenIdea(this.ideaInput.value).words;
    const ask: StoryAsk = {
      ...(words ? { words } : {}),
      ...(this.askTheme ? { theme: this.askTheme } : {}),
      ...(this.askShapes.length ? { shapes: [...this.askShapes] } : {}),
    };
    if (Object.keys(ask).length) out.ask = ask;
    return out;
  }

  /** The sheet is going: the microphone too, if it is still listening. */
  stop(): void {
    this.listening?.cancel();
    this.listening = null;
  }

  private point(e: PointerEvent): [number, number] {
    const r = this.pad.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  }

  private paint(): void {
    const g = this.pad.getContext('2d')!;
    g.clearRect(0, 0, 256, 256);
    g.strokeStyle = g.fillStyle = '#1b1822';
    g.lineWidth = 12;
    g.lineCap = g.lineJoin = 'round';
    for (const s of this.strokes) {
      g.beginPath();
      s.forEach(([x, y], i) => (i === 0 ? g.moveTo(x * 256, y * 256) : g.lineTo(x * 256, y * 256)));
      if (s.length === 1) g.arc(s[0][0] * 256, s[0][1] * 256, 6, 0, Math.PI * 2);
      g.stroke();
    }
  }
}

function hex(n: number): string {
  return n.toString(16).padStart(6, '0');
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
