import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transitionWindows } from '../scripts/diag/windows.mjs';

const snap = (t, fps, extra = {}) => ({ k: 'snap', t, fps, ...extra });
const vis = (t, state) => ({ k: 'ev', e: 'vis', t, state });

test('a window with a sleep/wake or menu blur is a transition; entering XR is not', () => {
  const rows = [
    vis(1.9, 'non-immersive'),
    vis(4.5, 'visible'), // entering XR: the app's own work
    snap(7, 70),
    snap(12, 72),
    // Asleep; wakes (as in session cdj3st58rm): visible, blurred, visible.
    vis(1349.38, 'visible'),
    vis(1350.91, 'visible-blurred'),
    vis(1351.24, 'visible'),
    snap(1352.1, 46.9),
    snap(1357.1, 71.6),
  ];
  const t = transitionWindows(rows);
  assert.deepEqual([...t].map((s) => s.t), [1352.1]);
});

test('newer sessions mark their own transition windows', () => {
  const rows = [vis(1, 'visible'), snap(10, 64, { transFrames: 12, transWorstMs: 900 }), snap(15, 72)];
  assert.deepEqual([...transitionWindows(rows)].map((s) => s.t), [10]);
});

test('a slow window with no visibility change stays a slow window', () => {
  assert.equal(transitionWindows([vis(1, 'visible'), snap(10, 45)]).size, 0);
});
