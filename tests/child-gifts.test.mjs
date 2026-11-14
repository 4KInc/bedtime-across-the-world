import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeDrawing, DRAWING_MAX_BYTES, encodeDrawing, isMoPalette } from '../src/child-gifts.ts';

test('a drawing goes there and back, to a byte per coordinate', () => {
  const strokes = [[[0, 0], [0.5, 0.25], [1, 1]], [[0.2, 0.8]]];
  const back = decodeDrawing(encodeDrawing(strokes));
  assert.equal(back.length, 2);
  assert.equal(back[0].length, 3);
  for (const [i, [x, y]] of strokes[0].entries()) {
    assert.ok(Math.abs(back[0][i][0] - x) < 0.005 && Math.abs(back[0][i][1] - y) < 0.005);
  }
});

test('a long drawing is cut to fit, and junk is not a drawing', () => {
  const long = [Array.from({ length: 5000 }, (_, i) => [i / 5000, 0.5])];
  const many = Array.from({ length: 40 }, () => Array.from({ length: 60 }, () => [Math.random(), Math.random()]));
  assert.ok(atob(encodeDrawing(many)).length <= DRAWING_MAX_BYTES);
  assert.equal(decodeDrawing(encodeDrawing(long)), null); // one stroke too long for the limit: nothing kept
  assert.equal(decodeDrawing(''), null);
  assert.equal(decodeDrawing('not base64!'), null);
  assert.equal(decodeDrawing(btoa('\x10')), null); // half a point
  assert.equal(decodeDrawing('A'.repeat(DRAWING_MAX_BYTES * 2)), null);
  assert.equal(decodeDrawing(42), null);
});

test("Mo's palettes are a fixed list", () => {
  assert.ok(isMoPalette('rose'));
  assert.ok(!isMoPalette('toString'));
  assert.ok(!isMoPalette('#ff00ff'));
});
