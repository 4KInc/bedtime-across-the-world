import { ShapeIds } from './shadowplay-components.js';

/** Every Shadow Journal page, in book order. Hidden ones show as '?' until found. */
export const CREATURES: readonly { id: string; name: string; rig: string | null }[] = [
  { id: 'rabbit', name: 'Rabbit', rig: ShapeIds.Rabbit },
  { id: 'fish', name: 'Fish', rig: ShapeIds.Fish },
  { id: 'dog', name: 'Dog', rig: ShapeIds.Dog },
  { id: 'bird', name: 'Bird', rig: ShapeIds.Bird },
  { id: 'snail', name: 'Snail', rig: ShapeIds.Snail },
  { id: 'swan', name: 'Swan', rig: ShapeIds.Swan },
  { id: 'deer', name: 'Deer', rig: ShapeIds.Deer },
  { id: 'crocodile', name: 'Crocodile', rig: ShapeIds.Crocodile },
  // The story worlds' creatures (world-creatures.ts), world by world.
  { id: 'rocket', name: 'Rocket', rig: ShapeIds.Rocket },
  { id: 'alien', name: 'Alien', rig: ShapeIds.Alien },
  { id: 'asteroid', name: 'Asteroid', rig: ShapeIds.Asteroid },
  { id: 'shark', name: 'Shark', rig: ShapeIds.Shark },
  { id: 'octopus', name: 'Octopus', rig: ShapeIds.Octopus },
  { id: 'whale', name: 'Whale', rig: ShapeIds.Whale },
  { id: 'car', name: 'Car', rig: ShapeIds.Car },
  { id: 'plane', name: 'Aeroplane', rig: ShapeIds.Plane },
  { id: 'digger', name: 'Digger', rig: ShapeIds.Digger },
  { id: 'trex', name: 'T. rex', rig: ShapeIds.Trex },
  { id: 'pterodactyl', name: 'Pterodactyl', rig: ShapeIds.Pterodactyl },
];

/** A creature's name on its page ('T. rex', not 'trex'); the id capitalised for any other shape. */
export function creatureName(id: string): string {
  return CREATURES.find((c) => c.id === id)?.name ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export const PAGE_W = 1024;
export const PAGE_H = 640;
/** Nineteen creatures, five to a row (four rows). */
export const SLOT_COLUMNS = 5;
/** Slot frame size and the gap between slot centres (page pixels). */
const SLOT_W = 180;
const SLOT_H = 104;
const COL_STEP = 196;
const ROW_STEP = 120;

/** Slot centre in page pixels. */
export function slotCenter(index: number): { x: number; y: number } {
  const col = index % SLOT_COLUMNS;
  const row = Math.floor(index / SLOT_COLUMNS);
  return { x: PAGE_W / 2 + (col - (SLOT_COLUMNS - 1) / 2) * COL_STEP, y: 186 + row * ROW_STEP };
}

/** Paper page with title, slot frames and labels (silhouettes are 3D overlays). */
export function drawJournalPage(
  g: CanvasRenderingContext2D,
  discovered: ReadonlySet<string>,
  endingsFound = 0,
  endingsTotal = 2,
): void {
  const grad = g.createRadialGradient(PAGE_W / 2, PAGE_H / 2, 80, PAGE_W / 2, PAGE_H / 2, 620);
  grad.addColorStop(0, '#f3e6c8');
  grad.addColorStop(1, '#d9c294');
  g.fillStyle = grad;
  g.beginPath();
  g.roundRect(0, 0, PAGE_W, PAGE_H, 28);
  g.fill();

  g.fillStyle = '#2a2036';
  g.textAlign = 'center';
  g.font = 'italic 600 52px Georgia, "Times New Roman", serif';
  g.fillText('Shadow Journal', PAGE_W / 2, 72);
  g.font = 'italic 500 34px Georgia, serif';
  const found = CREATURES.filter((c) => discovered.has(c.id)).length;
  g.fillText(
    `${found} of ${CREATURES.length} creatures  ·  Endings: ${endingsFound} of ${endingsTotal}`,
    PAGE_W / 2,
    118,
  );

  CREATURES.forEach((c, i) => {
    const { x, y } = slotCenter(i);
    g.strokeStyle = 'rgba(42, 32, 54, 0.35)';
    g.lineWidth = 3;
    g.beginPath();
    g.roundRect(x - SLOT_W / 2, y - SLOT_H / 2 - 8, SLOT_W, SLOT_H, 14);
    g.stroke();
    const known = discovered.has(c.id);
    g.fillStyle = known ? '#2a2036' : 'rgba(42, 32, 54, 0.45)';
    g.font = 'italic 500 24px Georgia, serif';
    g.fillText(known ? c.name : '? ? ?', x, y + SLOT_H / 2 + 14);
    if (!known) {
      g.font = '600 64px Georgia, serif';
      g.fillStyle = 'rgba(42, 32, 54, 0.22)';
      g.fillText('?', x, y + 14);
    }
  });
}
