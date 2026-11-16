/**
 * Canvas drawing for stage captions and the 'show me' ghost hand. Kept free of
 * ECS so the art can be tweaked in isolation.
 */
import { poseOf } from './world-creatures.js';

export const CAPTION_W = 1024;
export const CAPTION_H = 192;

const FONT = 'italic 500 50px Georgia, "Times New Roman", serif';
/** High contrast: upright, heavier, sans-serif, white on solid black with a white edge. */
const FONT_HIGH_CONTRAST = '700 52px "Helvetica Neue", Arial, sans-serif';

function wrap(g: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

/** Warm serif caption on a soft dark backing, legible on any real wall (or white on solid black in high contrast). */
export function drawCaption(g: CanvasRenderingContext2D, text: string, highContrast = false): void {
  g.clearRect(0, 0, CAPTION_W, CAPTION_H);
  if (!text) return;
  g.font = highContrast ? FONT_HIGH_CONTRAST : FONT;
  const lines = wrap(g, text, CAPTION_W - 120);
  const lineH = 58;
  const blockH = lines.length * lineH + 36;
  const widest = Math.max(...lines.map((l) => g.measureText(l).width));
  const w = Math.min(CAPTION_W - 16, widest + 90);
  const x = (CAPTION_W - w) / 2;
  const y = (CAPTION_H - blockH) / 2;

  g.save();
  if (highContrast) {
    g.fillStyle = '#000000';
    g.strokeStyle = '#ffffff';
    g.lineWidth = 5;
    g.beginPath();
    g.roundRect(x, y, w, blockH, 18);
    g.fill();
    g.stroke();
  } else {
    g.shadowColor = 'rgba(5, 3, 10, 0.9)';
    g.shadowBlur = 28;
    g.fillStyle = 'rgba(10, 7, 16, 0.72)';
    g.beginPath();
    g.roundRect(x, y, w, blockH, 30);
    g.fill();
  }
  g.restore();

  g.fillStyle = highContrast ? '#ffffff' : '#f6e3bd';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => {
    g.fillText(l, CAPTION_W / 2, y + 18 + lineH * (i + 0.5));
  });
}

export const HINT_SIZE = 512;

function capsule(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, r: number): void {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const nx = Math.cos(a + Math.PI / 2) * r;
  const ny = Math.sin(a + Math.PI / 2) * r;
  g.beginPath();
  g.moveTo(x1 + nx, y1 + ny);
  g.lineTo(x2 + nx, y2 + ny);
  g.arc(x2, y2, r, a + Math.PI / 2, a - Math.PI / 2, true);
  g.lineTo(x1 - nx, y1 - ny);
  g.arc(x1, y1, r, a - Math.PI / 2, a + Math.PI / 2, true);
  g.closePath();
  g.fill();
  g.stroke();
}

function ghostStyle(g: CanvasRenderingContext2D): void {
  g.lineWidth = 8;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(255, 176, 84, 1)';
  g.fillStyle = 'rgba(255, 232, 196, 0.8)';
  g.shadowColor = 'rgba(255, 170, 80, 0.8)';
  g.shadowBlur = 24;
}

function hintLabel(g: CanvasRenderingContext2D, text: string): void {
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(246, 227, 189, 0.95)';
  g.font = 'italic 600 40px Georgia, serif';
  g.textAlign = 'center';
  g.fillText(text, 256, 40);
}

/** Flat hand seen from the side, fingers pointing right. */
function flatHand(g: CanvasRenderingContext2D, ox: number, oy: number, thumbUp: boolean): void {
  capsule(g, ox + 20, oy + 40, ox + 250, oy + 40, 36); // fingers together
  g.beginPath();
  g.roundRect(ox - 70, oy, 150, 100, 40); // palm
  g.fill();
  g.stroke();
  if (thumbUp) capsule(g, ox - 10, oy + 10, ox + 20, oy - 110, 22); // thumb up (ear)
  else capsule(g, ox - 20, oy + 70, ox + 120, oy + 70, 20); // thumb tucked
  capsule(g, ox - 110, oy + 50, ox - 60, oy + 50, 44); // wrist
}

/** Ghost hand demonstrating a shape: every shape a story asks for (an unknown one shows the rabbit). */
export function drawHandHint(g: CanvasRenderingContext2D, shape: string): void {
  g.clearRect(0, 0, HINT_SIZE, HINT_SIZE);
  ghostStyle(g);
  // A world creature that borrows a pose shows that pose (a T. rex the crocodile's jaws).
  shape = poseOf(shape);
  if (drawWorldHint(g, shape)) return;
  if (shape === 'fish') {
    flatHand(g, 150, 220, false);
    hintLabel(g, 'flat, thumb tucked');
    return;
  }
  if (shape === 'dog') {
    flatHand(g, 150, 250, true);
    hintLabel(g, 'flat, thumb up');
    return;
  }
  if (shape === 'cup') {
    // Two hands cupped together, fingers half-curled, as if holding water.
    g.beginPath();
    g.moveTo(110, 250);
    g.bezierCurveTo(110, 420, 402, 420, 402, 250);
    g.lineTo(360, 250);
    g.bezierCurveTo(350, 350, 162, 350, 152, 250);
    g.closePath();
    g.fill();
    g.stroke();
    for (const x of [124, 150, 362, 388]) capsule(g, x, 250, x + (x < 256 ? 16 : -16), 200, 13);
    capsule(g, 200, 400, 312, 400, 30);
    hintLabel(g, 'cup your hands');
    return;
  }
  if (shape === 'bird') {
    // Two open hands side by side, thumbs hooked together at the centre.
    for (const side of [-1, 1]) {
      const cx = 256 + side * 70;
      g.beginPath();
      g.roundRect(cx - 50, 300, 100, 110, 36);
      g.fill();
      g.stroke();
      for (let f = 0; f < 4; f++) {
        const bx = cx - 38 + f * 25;
        capsule(g, bx, 305, bx + side * (40 + f * 18), 130 + f * 12, 14);
      }
    }
    capsule(g, 200, 330, 312, 330, 16);
    hintLabel(g, 'two hands, side by side');
    return;
  }
  // The swan, crocodile, deer and snail had no drawing and showed the rabbit (Quest 3S, Nov 16).
  if (shape === 'swan') {
    // The forearm rising as the neck; the flat hand bent down at the wrist as the head, fingers the beak.
    capsule(g, 170, 480, 236, 190, 40);
    capsule(g, 236, 175, 340, 225, 40);
    capsule(g, 330, 222, 404, 300, 24);
    hintLabel(g, 'bent down at the wrist');
    return;
  }
  if (shape === 'crocodile') {
    // Two flat hands, one on top of the other, fingers forward and a little apart like long jaws.
    for (const [y, tip] of [[150, 196], [300, 336]]) {
      capsule(g, 40, y + 50, 90, y + 50, 40); // wrist
      g.beginPath();
      g.roundRect(70, y, 140, 100, 38); // palm
      g.fill();
      g.stroke();
      capsule(g, 190, y + 50, 440, tip + (y === 150 ? 20 : -20), 32); // fingers together
    }
    hintLabel(g, 'hands like long jaws');
    return;
  }
  if (shape === 'deer') {
    // Wrists together at the bottom, fingers up and spread wide like antlers.
    for (const side of [-1, 1]) {
      const cx = 256 + side * 58;
      capsule(g, 256 + side * 18, 470, cx, 400, 34); // wrist, touching at the centre
      g.beginPath();
      g.roundRect(cx - 46, 290, 92, 110, 34);
      g.fill();
      g.stroke();
      for (let f = 0; f < 4; f++) {
        const bx = cx - 34 + f * 23;
        // Outermost finger spreads most, on both hands.
        const spread = side * (side > 0 ? f : 3 - f) * 32;
        capsule(g, bx, 295, bx + spread, 120 + Math.abs(f - 1.5) * 18, 13);
      }
    }
    hintLabel(g, 'fingers up, spread');
    return;
  }
  if (shape === 'snail') {
    // A fist for the shell, two fingers poking forward and up for its eyes.
    capsule(g, 170, 400, 110, 480, 44); // wrist
    capsule(g, 300, 270, 410, 170, 17); // index (eye)
    capsule(g, 310, 300, 430, 230, 17); // middle (eye)
    g.beginPath();
    g.roundRect(140, 230, 190, 170, 75); // fist
    g.fill();
    g.stroke();
    hintLabel(g, 'a fist, two fingers out');
    return;
  }
  drawRabbitHand(g);
}

/** A fist from the front, knuckles along its top, on its wrist. */
function fistHand(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  capsule(g, x + w / 2, y + h + 70, x + w / 2, y + h - 20, 46); // wrist
  g.beginPath();
  g.roundRect(x, y, w, h, 64);
  g.fill();
  g.stroke();
}

/** The world creatures' own poses (world-creatures.ts); false for any other shape. */
function drawWorldHint(g: CanvasRenderingContext2D, shape: string): boolean {
  switch (shape) {
    case 'fist':
      fistHand(g, 160, 200, 192, 180);
      hintLabel(g, 'a fist');
      return true;
    case 'rocket':
      capsule(g, 222, 280, 214, 80, 24); // index, straight up
      fistHand(g, 172, 250, 172, 160);
      hintLabel(g, 'one finger up');
      return true;
    case 'alien':
      capsule(g, 206, 280, 186, 96, 22); // index
      capsule(g, 322, 290, 350, 124, 19); // little finger
      fistHand(g, 172, 250, 172, 160);
      hintLabel(g, 'two fingers up, at the sides');
      return true;
    case 'shark':
      // A flat hand standing up, fingers together like a fin.
      capsule(g, 256, 470, 256, 420, 44); // wrist
      g.beginPath();
      g.roundRect(196, 270, 120, 170, 42); // palm
      g.fill();
      g.stroke();
      capsule(g, 262, 300, 262, 80, 38); // fingers together
      capsule(g, 210, 410, 214, 300, 20); // thumb tucked
      hintLabel(g, 'flat, fingers up');
      return true;
    case 'octopus':
      // The hand hanging down from the wrist, fingers spread like arms.
      capsule(g, 256, 60, 256, 130, 44); // wrist
      for (let f = 0; f < 4; f++) capsule(g, 212 + f * 30, 230, 150 + f * 72, 460 - Math.abs(f - 1.5) * 20, 16);
      capsule(g, 196, 170, 112, 262, 18); // thumb
      g.beginPath();
      g.roundRect(186, 110, 142, 140, 44); // palm
      g.fill();
      g.stroke();
      hintLabel(g, 'fingers down, spread');
      return true;
    case 'whale':
      capsule(g, 192, 280, 186, 110, 25); // thumb, straight up
      fistHand(g, 162, 250, 192, 160);
      hintLabel(g, 'a fist, thumb up');
      return true;
    case 'plane':
      capsule(g, 196, 300, 78, 244, 23); // thumb out
      capsule(g, 326, 320, 448, 262, 19); // little finger out
      fistHand(g, 172, 230, 172, 160);
      hintLabel(g, 'thumb and little finger out');
      return true;
    default:
      return false;
  }
}

/**
 * Ghost hand demonstrating the rabbit: index + middle up as ears, ring and
 * pinky curled, thumb reaching across to touch them.
 */
function drawRabbitHand(g: CanvasRenderingContext2D): void {

  capsule(g, 222, 270, 196, 86, 25); // index (ear)
  capsule(g, 270, 262, 286, 70, 26); // middle (ear)
  g.beginPath();
  g.roundRect(170, 240, 170, 170, 60); // palm
  g.fill();
  g.stroke();
  capsule(g, 318, 280, 338, 330, 23); // ring, curled
  capsule(g, 340, 318, 350, 360, 20); // pinky, curled
  capsule(g, 178, 380, 320, 322, 24); // thumb meeting the ring finger
  capsule(g, 220, 400, 250, 490, 48); // wrist

  hintLabel(g, 'like this');
}
