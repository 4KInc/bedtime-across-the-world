import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAsk, softenIdea } from '../src/story-checks.ts';
import { checkDream, checkTaste, cleanSetting, planByWords, readSuggestions, suggestByTaste } from '../server/dream.ts';

test("a child's idea is softened, not thrown away: a character from a show or a scary word is dropped and named", () => {
  assert.deepEqual(softenIdea('Dad, tell me a story about Mo at the carnival'), { words: 'Dad, tell me a story about Mo at the carnival', dropped: [] });
  assert.deepEqual(softenIdea('an Elsa story with a dog'), { words: 'a story with a dog', dropped: ['elsa'] });
  assert.deepEqual(softenIdea('a Paw Patrol story and a monster in the forest!!'), { words: 'a story and a in the forest!!', dropped: ['paw patrol', 'monster'] });
  assert.equal(softenIdea('<b>forest</b> 🎪 story').words, 'b forest b story');
  assert.equal(softenIdea('Elsa').words, '');
  assert.equal(softenIdea('an apple and an octopus').words, 'an apple and an octopus');
  assert.equal(softenIdea(`${'word '.repeat(40)}`).words.split(' ').length, 30);
});

test('a story request: softened words, a known place, one to three known creatures; anything else refused', () => {
  assert.deepEqual(checkAsk({ words: 'a story about Mo at the carnival', theme: 'meadow', shapes: ['dog', 'whale'], extra: 1 }), {
    words: 'a story about Mo at the carnival', theme: 'meadow', shapes: ['dog', 'whale'],
  });
  assert.deepEqual(checkAsk({ theme: 'space' }), { theme: 'space' });
  for (const bad of [
    null, 'carnival', {}, { words: 'an Elsa story' }, { words: '' }, { theme: 'mars' }, { shapes: [] },
    { shapes: ['dog', 'dog'] }, { shapes: ['unicorn'] }, { shapes: ['dog', 'fish', 'bird', 'cup'] }, { words: 42 },
  ]) {
    assert.equal(checkAsk(bad), null, JSON.stringify(bad));
  }
});

test('the closest place, from the words: a carnival in the meadow, pirates by the sea, a castle by the forest', () => {
  const plan = (wish: string) => planByWords({ theme: '', shapes: [], wish }, () => 0);
  assert.deepEqual(
    { theme: plan('tell me a story about Mo at the carnival').theme, setting: plan('tell me a story about Mo at the carnival').setting },
    { theme: 'meadow', setting: 'at a little carnival in the meadow, under strings of lanterns' },
  );
  assert.equal(plan('a pirate story').theme, 'sea');
  assert.equal(plan('a story about a princess and a dragon').theme, 'forest');
  assert.equal(plan('a snowy story').setting, 'in a meadow under the first soft snow');
  // The place it names wins; the idea's setting only where it was made for that place.
  const named = planByWords({ theme: 'space', shapes: [], wish: 'a carnival in space' }, () => 0);
  assert.equal(named.theme, 'space');
  assert.equal(named.setting, undefined);
  // Nothing recognised: a place and shapes at random, no setting.
  const other = plan('a story about being kind');
  assert.ok(other.theme && other.shapes.length >= 2 && !other.setting);
});

test('a setting is one plain, gentle line; a dream request carries it only with a place', () => {
  assert.equal(cleanSetting('at a little carnival in the meadow, under strings of lanterns.'), 'at a little carnival in the meadow, under strings of lanterns');
  for (const bad of ['in a castle where a monster lives', 'at the Disney parade', 'a b c d e f g h i j k l m n o p', '<script>', 42]) assert.equal(cleanSetting(bad), '', String(bad));
  assert.equal(checkDream({ wish: 'a carnival', theme: 'meadow', shapes: ['dog', 'bird'], setting: 'at a carnival in the meadow' })?.setting, 'at a carnival in the meadow');
  assert.equal(checkDream({ wish: 'a carnival', setting: 'at a carnival in the meadow' })?.setting, undefined);
  assert.equal(checkDream({ theme: 'sea', shapes: ['fish', 'whale'], setting: 'on a pirate boat on the quiet sea' })?.setting, 'on a pirate boat on the quiet sea');
});

test("a child's taste: counts of known places and creatures and softened ideas, no names; anything else refused", () => {
  assert.deepEqual(checkTaste({ places: { meadow: 3, sea: 0 }, creatures: { dog: 4 }, ideas: ['a story about Mo at the carnival', 'an Elsa story about snow'] }), {
    places: { meadow: 3 }, creatures: { dog: 4 }, ideas: ['a story about Mo at the carnival', 'a story about snow'],
  });
  for (const bad of [
    null, { places: {}, creatures: {}, ideas: [] }, { places: { mars: 1 }, creatures: {}, ideas: [] }, { places: {}, creatures: { dog: -1 }, ideas: [] },
    { places: {}, creatures: { dog: 1.5 }, ideas: [] }, { places: {}, creatures: { dog: 1 }, ideas: Array(6).fill('a dog') }, { places: [], creatures: {}, ideas: [] },
  ]) {
    assert.equal(checkTaste(bad), null, JSON.stringify(bad));
  }
});

test("suggestions from a taste alone: more of what they love, their last idea again, somewhere new", () => {
  const ideas = suggestByTaste({ places: { meadow: 3, sea: 1 }, creatures: { dog: 4, rabbit: 2, whale: 1 }, ideas: ['a story about Mo at the carnival'] });
  assert.equal(ideas.length, 3);
  assert.deepEqual(ideas[0], { title: 'The dog in the meadow', idea: 'a story in the meadow with a dog and a rabbit', theme: 'meadow', shapes: ['dog', 'rabbit'], why: 'Loves the meadow and the dog' });
  assert.equal(ideas[1].idea, 'a story about Mo at the carnival');
  assert.equal(ideas[1].theme, 'meadow');
  assert.ok(!['meadow', 'sea'].includes(ideas[2].theme));
  for (const i of ideas) assert.ok(i.shapes.length >= 2 && checkDream({ wish: i.idea, theme: i.theme, shapes: i.shapes }), JSON.stringify(i));
  // Only creatures, no ideas yet: more of what they love, and somewhere new.
  assert.equal(suggestByTaste({ places: {}, creatures: { shark: 2 }, ideas: [] }).length, 2);
});

test("the model's suggestions are checked one by one: known places and shapes, plain lines, no he or she, no characters", () => {
  const reply = JSON.stringify({
    ideas: [
      { title: 'The Carnival Lights', idea: 'Mo rides a dog through a little carnival', theme: 'meadow', shapes: ['dog', 'bird'], why: 'Asked for the carnival' },
      { title: 'Elsa and Mo', idea: 'Mo meets Elsa in the snow', theme: 'meadow', shapes: ['dog', 'bird'], why: 'Loves snow' },
      { title: 'Whale Song', idea: 'a sleepy whale sings to Mo', theme: 'sea', shapes: ['whale', 'fish'], why: 'She loves the whale' },
      { title: 'Too Many', idea: 'a story', theme: 'mars', shapes: ['dog', 'bird'], why: 'Loves Mars' },
    ],
  });
  const ideas = readSuggestions(`Here you go: ${reply}`);
  assert.deepEqual(ideas.map((i) => i.title), ['The Carnival Lights']);
  assert.deepEqual(readSuggestions('no idea'), []);
});
