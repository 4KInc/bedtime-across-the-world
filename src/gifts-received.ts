import { isMoPalette, MO_PALETTES, MoPaletteId } from './child-gifts.js';
import { loadGifts, saveGifts, StoredGifts } from './journal-store.js';
import type { Performance } from './performance/format.js';

/**
 * The child's gifts on the storyteller's headset: Mo's colours (moth.ts,
 * mo-visit.ts) and the drawn creature (child-drawing.ts). Kept, so Mo stays in
 * the child's colours on later nights.
 */
export const giftsRuntime = {
  mo: 'amber' as MoPaletteId,
  moFrom: '',
  drawing: '',
  drawingFrom: '',
  /** Changes whenever a new drawing arrives (so it walks on again). */
  drawingAt: 0,
  loaded: false,
};

let stored: StoredGifts = {};

export async function loadReceivedGifts(): Promise<void> {
  stored = await loadGifts();
  publish();
  giftsRuntime.loaded = true;
}

/** A goodnight arrived: take its gifts (newer ones replace older ones). */
export async function receiveGifts(reply: Performance): Promise<boolean> {
  let changed = false;
  if (isMoPalette(reply.mo)) {
    stored.mo = reply.mo;
    stored.moFrom = reply.performer;
    changed = true;
  }
  if (typeof reply.drawing === 'string' && reply.drawing) {
    stored.drawing = reply.drawing;
    stored.drawingFrom = reply.performer;
    stored.drawingAt = reply.createdAt || Date.now();
    changed = true;
  }
  if (!changed) return false;
  publish();
  await saveGifts(stored);
  return true;
}

function publish(): void {
  giftsRuntime.mo = isMoPalette(stored.mo) ? stored.mo : 'amber';
  giftsRuntime.moFrom = stored.moFrom ?? '';
  giftsRuntime.drawing = stored.drawing ?? '';
  giftsRuntime.drawingFrom = stored.drawingFrom ?? '';
  giftsRuntime.drawingAt = stored.drawingAt ?? 0;
}

/** Mo's current palette. */
export function moPalette(): (typeof MO_PALETTES)[MoPaletteId] {
  return MO_PALETTES[giftsRuntime.mo];
}
