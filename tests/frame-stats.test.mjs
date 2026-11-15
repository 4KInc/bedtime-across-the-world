import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FrameStats } from '../src/diag/frame-stats.ts';

const out = () => ({ avg: 0, p95: 0, worst: 0, fps: 0, frames: 0 });

test('steady 72 Hz', () => {
  const s = new FrameStats(5000);
  for (let i = 0; i < 1000; i++) s.push(1000 / 72);
  const r = s.read(out());
  assert.ok(Math.abs(r.fps - 72) < 0.01);
  assert.ok(Math.abs(r.worst - 13.89) < 0.01);
  assert.ok(Math.abs(r.frames - 360) <= 1); // only the last 5 s
});

test('a hitch shows in p95 and worst, not much in the average', () => {
  const s = new FrameStats(5000);
  for (let i = 0; i < 340; i++) s.push(13.9);
  for (let i = 0; i < 20; i++) s.push(40);
  const r = s.read(out());
  assert.equal(Math.round(r.worst), 40);
  assert.equal(Math.round(r.p95), 40);
  assert.ok(r.avg < 16);
});

test('ignores nonsense and starts empty', () => {
  const s = new FrameStats();
  s.push(-1);
  s.push(0);
  s.push(5000);
  assert.equal(s.read(out()).frames, 0);
});

test('system transitions (sleep, wake, blur) are held out of the windows, tallied apart, until it settles', async () => {
  const { TransitionGate } = await import('../src/diag/frame-stats.ts');
  const gate = new TransitionGate(2000);
  const s = new FrameStats(5000);
  let now = 0;
  const frame = (ms) => {
    now += ms;
    if (gate.admit(now, ms)) s.push(ms);
  };
  for (let i = 0; i < 360; i++) frame(1000 / 72);
  // The headset wakes: a frame of most of a second, blurred for a moment, then visible again.
  gate.change(now, true);
  frame(978);
  gate.change(now, false);
  for (let i = 0; i < 10; i++) frame(33);
  gate.change(now, true);
  for (let i = 0; i < 60; i++) frame(33); // still settling (2 s)
  for (let i = 0; i < 360; i++) frame(1000 / 72);
  const r = s.read(out());
  assert.ok(r.fps > 71.9 && r.worst < 14, `the window is the app's frames only: ${JSON.stringify(r)}`);
  const held = gate.take();
  assert.equal(held.frames, 72); // the wake frame, 10 blurred, 60 settling, and one more inside the 2 s
  assert.equal(held.worst, 978);
  assert.deepEqual(gate.take(), { frames: 0, worst: 0 }, 'cleared once taken');
  // A real hitch while plainly visible is not a transition: it shows.
  frame(250);
  assert.equal(Math.round(s.read(out()).worst), 250);
});
