import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CREATURE_COLOURS } from '../src/creature-colours.ts';

// The lamp's pool of light on the wall (stage-visuals.ts): every creature wakes up in front of it.
const LAMP = 0xffa43a;
// The faintest that still reads on a headset (Quest 3, Nov 17: the yellow car, 1.14, could not be seen at all).
const MIN_CONTRAST = 1.35;

const luminance = (hex) => {
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [16, 8, 0].map((s) => lin(((hex >> s) & 255) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every creature stands out from the lamp light it wakes in', () => {
  const faint = Object.entries(CREATURE_COLOURS)
    .filter(([shape]) => shape !== 'open') // the Free Stage hand is lamplight itself
    .map(([shape, colour]) => [shape, +contrast(colour, LAMP).toFixed(2)])
    .filter(([, c]) => c < MIN_CONTRAST);
  assert.deepEqual(faint, []);
});

test('the car is red, not the yellow that vanished', () => {
  assert.ok(contrast(CREATURE_COLOURS.car, LAMP) >= 2, contrast(CREATURE_COLOURS.car, LAMP).toFixed(2));
});
