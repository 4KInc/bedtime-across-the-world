import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contentProblems } from '../src/story-checks.ts';

const read = (p) => JSON.parse(readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8'));
const { stories: library, worlds } = read('story/library.json');
const narration = read('narration/manifest.json');
const SHAPES = new Set(['rabbit', 'ears', 'fish', 'dog', 'bird', 'cup', 'snail', 'swan', 'deer', 'crocodile']);

test('every library story: its file, unique beat ids across the library, and an end', () => {
  const ids = new Set();
  for (const entry of library) {
    const story = read(entry.script);
    assert.equal(story.version, 'shadowplay.story.v1', entry.id);
    assert.ok(['end', 'freestage'].includes(story.beats.at(-1).type), `${entry.id} ends (or opens the Free Stage)`);
    for (const b of story.beats) {
      // Narration clips are named by beat id, so ids are unique across every story.
      assert.ok(!ids.has(b.id), `${entry.id}: beat id ${b.id} is used twice`);
      ids.add(b.id);
    }
  }
});

test('the newer stories pass the content checks (no brands, Mo is "she", the right hand poses)', () => {
  for (const id of ['the-night-garden', 'the-kind-crocodile', 'the-little-rainstorm', 'moon-buggy', 'sleepy-dinosaur', 'lost-spaceship']) {
    const story = read(library.find((s) => s.id === id).script);
    for (const b of story.beats) {
      if (b.type === 'request') assert.ok(SHAPES.has(b.shape) && (!b.alt || SHAPES.has(b.alt)), `${b.id} shape`);
      if (!b.text) continue;
      assert.deepEqual(contentProblems(b.text, b.type === 'request' ? b.shape : undefined), [], `${b.id}: ${b.text}`);
    }
  }
});

test('every spoken line of the newer stories has its narration, read by the story\'s narrator', () => {
  for (const id of ['the-night-garden', 'the-kind-crocodile', 'the-little-rainstorm', 'moon-buggy']) {
    const entry = library.find((s) => s.id === id);
    assert.equal(narration.narrators[id], entry.narrator, `${id} narrator`);
    for (const b of read(entry.script).beats) {
      if (!b.text) continue;
      const clip = narration.clips[b.id];
      assert.ok(clip && existsSync(new URL(`../public/${clip}`, import.meta.url)), `${b.id} has a clip`);
    }
  }
});

test('story worlds: every story is in a known world, none is labelled for boys or girls, and the first launch stays in Wonder and Nature', () => {
  const ids = new Set(worlds.map((w) => w.id));
  assert.equal(ids.size, worlds.length, 'world ids are unique');
  for (const w of worlds) assert.doesNotMatch(`${w.title} ${w.blurb}`, /\b(boys?|girls?|princess(es)?)\b/i, w.id);
  for (const s of library) assert.ok(ids.has(s.world), `${s.id}: world ${s.world}`);
  assert.equal(library.find((s) => s.id === 'counting-stars').world, 'nature');
  // Cars and Adventure, the first new world, has its first story.
  assert.ok(library.some((s) => s.world === 'adventure'), 'Cars and Adventure has a story');
  // Every world has at least one story, so every world shows in the picker.
  for (const w of worlds) assert.ok(library.some((s) => s.world === w.id), `${w.id} has a story`);
});

test('every world and story colour is a "#rrggbb" colour, and no two worlds share a picker colour', () => {
  const HEX = /^#[0-9a-f]{6}$/i;
  for (const w of worlds) {
    assert.match(w.color, HEX, `${w.id} color`);
    assert.ok(w.sky?.length === 2 && w.sky.every((c) => HEX.test(c)), `${w.id} sky`);
  }
  assert.equal(new Set(worlds.map((w) => w.color)).size, worlds.length, 'world colours differ');
  for (const s of library) if (s.sky) assert.ok(s.sky.length === 2 && s.sky.every((c) => HEX.test(c)), `${s.id} sky`);
});

test('every scenery set a library story uses is one the stage can draw', () => {
  const SETS = new Set(['none', 'field', 'river', 'forest', 'storm', 'sea', 'moon-road', 'dino-valley', 'star-port']);
  for (const entry of library) {
    for (const b of read(entry.script).beats) if (b.type === 'scenery') assert.ok(SETS.has(b.set), `${b.id}: ${b.set}`);
  }
});
