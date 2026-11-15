import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The library's stories against what goes with them: their worlds, their narration
// clips, and the built-in recordings made with them.
const read = (p) => JSON.parse(readFileSync(new URL(`../public/${p}`, import.meta.url), 'utf8'));
const { stories: library } = read('story/library.json');
const narration = read('narration/manifest.json');

test("a story's scenery and creatures belong to its world", () => {
  // Ocean and Exploration opened on grassy hills with a rabbit (Quest 3S, Nov 15).
  const LAND = new Set(['field', 'forest', 'moon-road']);
  const LAND_ONLY = new Set(['rabbit', 'ears', 'deer', 'snail']);
  for (const entry of library.filter((s) => s.world === 'ocean')) {
    for (const b of read(entry.script).beats) {
      if (b.type === 'scenery') assert.ok(!LAND.has(b.set), `${entry.id}: ${b.id} shows ${b.set}`);
      if (b.type === 'request') assert.ok(!LAND_ONLY.has(b.shape), `${entry.id}: ${b.id} asks for a ${b.shape}`);
    }
  }
});

test('every narration clip belongs to a beat that still exists', () => {
  const ids = new Set(library.flatMap((e) => read(e.script).beats.map((b) => b.id)));
  for (const beat of Object.keys(narration.clips)) {
    assert.ok(ids.has(beat), `narration clip ${beat} has no beat (left over from an edit?)`);
  }
});

test('the built-in recordings still match the story they were recorded with', () => {
  // A recording replays its beats by number over its story's captions: editing that story
  // would put new words under the performer's old hands and voice. The sample from Dad keeps
  // its own copy of Goodnight Across the Sea (as recorded, with the hills and the rabbit).
  for (const name of ['story-from-dad', 'goodnight-from-mia']) {
    const perf = read(`samples/${name}.json`);
    if (!perf.script) continue;
    const beats = read(perf.script).beats;
    for (const e of perf.events.filter((x) => x.type === 'beat')) {
      assert.equal(beats[e.data.index]?.id, e.data.id, `${name}: beat ${e.data.index}`);
    }
  }
});
