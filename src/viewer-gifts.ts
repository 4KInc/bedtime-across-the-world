import { encodeDrawing, MO_PALETTES, MoPaletteId, Stroke } from './child-gifts.js';

const STYLE = `
.sp-gifts { margin: 10px 0 4px; display: grid; gap: 10px; }
.sp-gifts .sp-swatches { display: flex; gap: 10px; flex-wrap: wrap; }
.sp-swatch { width: 56px; height: 56px; border-radius: 50%; border: 3px solid transparent; cursor: pointer; padding: 0; }
.sp-swatch[aria-pressed="true"] { border-color: #f6e3bd; box-shadow: 0 0 0 3px #e0a24a; }
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
    </div>`;
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
  get(): { mo?: string; drawing?: string } {
    const out: { mo?: string; drawing?: string } = {};
    if (this.mo) out.mo = this.mo;
    if (this.strokes.length) out.drawing = encodeDrawing(this.strokes);
    return out;
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
