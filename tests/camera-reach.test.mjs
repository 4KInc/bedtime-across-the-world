import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reach, REACH_BAND, REACH_M } from '../src/camera-reach.ts';

test('the middle of the picture is the middle of the light', () => {
  assert.equal(reach(0.5), 0);
});

test('a hand a little inside the frame edge reaches the edge of the light', () => {
  assert.equal(reach(0.5 + REACH_BAND), REACH_M);
  assert.equal(reach(0.5 - REACH_BAND), -REACH_M);
  // Before: the whole picture spanned 0.175 m each side, too little to carry a creature to the stage's edge.
  assert.ok(reach(0.25) < -0.175);
});

test('beyond the band it holds at the edge', () => {
  assert.equal(reach(0), -REACH_M);
  assert.equal(reach(1), REACH_M);
});
