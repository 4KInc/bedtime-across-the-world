/**
 * What a child can send back with a goodnight, besides their shadow creature:
 * colours for Mo (one of a few named palettes), and a creature drawn with a
 * finger, which walks onto the storyteller's wall in the next story. Shared by
 * the family viewer, the headset and the server (which checks both), so it
 * has no DOM, no three.js and no side effects.
 */

/** Mo's colours: her wings' tint, and her glow and halo when she lights up. */
export const MO_PALETTES = {
  amber: { name: 'Amber', wings: 0x0a0810, glow: 0xffc870, halo: 0xffb45a },
  rose: { name: 'Rose', wings: 0x5a1840, glow: 0xff9fd0, halo: 0xff70b0 },
  sky: { name: 'Sky', wings: 0x10305e, glow: 0x9fd8ff, halo: 0x60b0ff },
  mint: { name: 'Mint', wings: 0x0e4a36, glow: 0xa8f5d0, halo: 0x50e0a0 },
  violet: { name: 'Violet', wings: 0x2e1a66, glow: 0xd2b0ff, halo: 0xa070ff },
  sun: { name: 'Sun', wings: 0x5e3608, glow: 0xffe68a, halo: 0xffc030 },
} as const;
export type MoPaletteId = keyof typeof MO_PALETTES;

export function isMoPalette(id: unknown): id is MoPaletteId {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MO_PALETTES, id);
}

/** A drawing is a few strokes of points on a square, each coordinate one byte (0-254); 255 ends a stroke. */
export const DRAWING_MAX_BYTES = 3000;
const END = 255;

export type Stroke = [number, number][];

/** Strokes with coordinates 0..1 (x right, y down), to a short base64 string. */
export function encodeDrawing(strokes: Stroke[]): string {
  const bytes: number[] = [];
  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    if (bytes.length + stroke.length * 2 + 1 > DRAWING_MAX_BYTES) break;
    for (const [x, y] of stroke) bytes.push(quantise(x), quantise(y));
    bytes.push(END);
  }
  return btoa(String.fromCharCode(...bytes));
}

/** Back to strokes (coordinates 0..1), or null if it is not a drawing. */
export function decodeDrawing(text: unknown): Stroke[] | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > Math.ceil(DRAWING_MAX_BYTES / 3) * 4) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null;
  let raw: string;
  try {
    raw = atob(text);
  } catch {
    return null;
  }
  const strokes: Stroke[] = [];
  let current: Stroke = [];
  for (let i = 0; i < raw.length; ) {
    const b = raw.charCodeAt(i);
    if (b === END) {
      if (current.length) strokes.push(current);
      current = [];
      i++;
      continue;
    }
    if (i + 1 >= raw.length || raw.charCodeAt(i + 1) === END) return null;
    current.push([b / 254, raw.charCodeAt(i + 1) / 254]);
    i += 2;
  }
  if (current.length) strokes.push(current);
  return strokes.length ? strokes : null;
}

function quantise(v: number): number {
  return Math.round(Math.min(1, Math.max(0, v)) * 254);
}
