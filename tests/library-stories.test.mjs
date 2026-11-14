import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contentProblems } from '../src/story-checks.ts';

const read = (p) => JSON.parse(readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8'));
const library = read('story/library.json').stories;
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
  for (const id of ['the-night-garden', 'the-kind-crocodile', 'the-little-rainstorm']) {
    const story = read(library.find((s) => s.id === id).script);
    for (const b of story.beats) {
      if (b.type === 'request') assert.ok(SHAPES.has(b.shape) && (!b.alt || SHAPES.has(b.alt)), `${b.id} shape`);
      if (!b.text) continue;
      assert.deepEqual(contentProblems(b.text, b.type === 'request' ? b.shape : undefined), [], `${b.id}: ${b.text}`);
    }
  }
});

test('every spoken line of the newer stories has its narration, read by the story\'s narrator', () => {
  for (const id of ['the-night-garden', 'the-kind-crocodile', 'the-little-rainstorm']) {
    const entry = library.find((s) => s.id === id);
    assert.equal(narration.narrators[id], entry.narrator, `${id} narrator`);
    for (const b of read(entry.script).beats) {
      if (!b.text) continue;
      const clip = narration.clips[b.id];
      assert.ok(clip && existsSync(new URL(`../public/${clip}`, import.meta.url)), `${b.id} has a clip`);
    }
  }
});
