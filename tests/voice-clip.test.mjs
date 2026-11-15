import assert from 'node:assert/strict';
import { test } from 'node:test';
import { downsample, encodeWav, joinParts, PcmRing } from '../src/voice-clip.ts';

test('the ring keeps the last half second, oldest first', () => {
  const ring = new PcmRing(10, 0.5); // 5 samples
  ring.push(Float32Array.from([1, 2, 3]));
  assert.deepEqual([...ring.snapshot()], [1, 2, 3]);
  ring.push(Float32Array.from([4, 5, 6, 7]));
  assert.deepEqual([...ring.snapshot()], [3, 4, 5, 6, 7]);
});

test('a clip starts before the word: the half second before detection comes first', () => {
  const ring = new PcmRing(16000);
  const before = new Float32Array(16000).fill(0.1); // the quiet "f" of "fish", before detection
  ring.push(before);
  const word = new Float32Array(4000).fill(0.5);
  const clip = joinParts([ring.snapshot(), word]);
  assert.equal(clip.length, 8000 + 4000);
  assert.ok(Math.abs(clip[0] - 0.1) < 1e-6 && Math.abs(clip[clip.length - 1] - 0.5) < 1e-6);
});

test('48 kHz to 16 kHz WAV: the right header and length', () => {
  const pcm = downsample(new Float32Array(48000).fill(0.25), 48000);
  assert.equal(pcm.length, 16000);
  const wav = encodeWav(pcm);
  const v = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(wav.length, 44 + 16000 * 2);
  assert.equal(v.getInt16(44, true), Math.round(0.25 * 0x7fff));
});
