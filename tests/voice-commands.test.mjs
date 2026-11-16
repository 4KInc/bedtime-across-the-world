import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COMMAND_PHRASES, describe, MAX_WORDS, parseCommand, readWish } from '../src/voice-commands.ts';

test('shapes by name, with everyday words around them', () => {
  assert.deepEqual(parseCommand('rabbit'), { kind: 'shape', shape: 'rabbit' });
  assert.deepEqual(parseCommand('Make a bunny!'), { kind: 'shape', shape: 'rabbit' });
  assert.deepEqual(parseCommand('the bird please'), { kind: 'shape', shape: 'bird' });
  assert.deepEqual(parseCommand('Croc'), { kind: 'shape', shape: 'crocodile' });
  assert.deepEqual(parseCommand('cupped hands'), { kind: 'shape', shape: 'cup' });
});

test('the longest phrase wins', () => {
  assert.deepEqual(parseCommand('close the journal'), { kind: 'journal', open: false });
  assert.deepEqual(parseCommand('journal'), { kind: 'journal', open: null });
  assert.deepEqual(parseCommand('next story'), { kind: 'press', id: 'story-next' });
  assert.deepEqual(parseCommand('next'), { kind: 'next' });
  assert.deepEqual(parseCommand('one-hand mode off'), { kind: 'setting', which: 'oneHand', on: false });
  assert.deepEqual(parseCommand('One hand mode'), { kind: 'setting', which: 'oneHand', on: null });
  assert.deepEqual(parseCommand('music off'), { kind: 'setting', which: 'music', on: false });
  assert.deepEqual(parseCommand('No music please'), { kind: 'setting', which: 'music', on: false });
  assert.deepEqual(parseCommand('music on'), { kind: 'setting', which: 'music', on: true });
});

test('panel buttons, the lamp and movement beats', () => {
  assert.deepEqual(parseCommand('move stage here'), { kind: 'press', id: 'replace-stage-button' });
  assert.deepEqual(parseCommand('Go live'), { kind: 'press', id: 'live-button' });
  assert.deepEqual(parseCommand('pause'), { kind: 'lamp', on: false });
  assert.deepEqual(parseCommand('okay continue'), { kind: 'lamp', on: true });
  assert.deepEqual(parseCommand('keep going'), { kind: 'next' });
});

test('whole words only, and nothing in long speech or narration', () => {
  assert.equal(parseCommand('fisherman'), null);
  assert.equal(parseCommand('dogma'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand('hello there'), null);
  // A narration line read out loud near the microphone is not a command.
  assert.equal(parseCommand('Make a rabbit with your hand and hold it still'), null);
  assert.ok('make a rabbit with your hand'.split(' ').length <= MAX_WORDS);
});

test('every command can be described, and phrase hints are unique', () => {
  for (const p of COMMAND_PHRASES) {
    const c = parseCommand(p);
    assert.ok(c, p);
    assert.ok(describe(c).length > 0, p);
  }
  assert.equal(new Set(COMMAND_PHRASES).size, COMMAND_PHRASES.length);
});

test('dreaming by voice: the place and shapes named, in the order said', () => {
  assert.deepEqual(parseCommand('Dream a story about the river with a fish and a bird'), { kind: 'dream', theme: 'river', shapes: ['fish', 'bird'] });
  assert.deepEqual(parseCommand("Mo, dream about the stars with a bunny, a dog and a cup please"), { kind: 'dream', theme: 'sky', shapes: ['rabbit', 'dog', 'cup'] });
  // An idea beyond the place and shapes goes to the model too, in plain words.
  assert.deepEqual(parseCommand('Dream about a fish who is shy'), { kind: 'dream', theme: '', shapes: ['fish'], wish: 'dream about a fish who is shy' });
  assert.deepEqual(parseCommand('dream a new story'), { kind: 'dream', theme: '', shapes: [] });
  assert.deepEqual(parseCommand("let's dream in the forest"), { kind: 'dream', theme: 'forest', shapes: [] });
  // Any shape a dreamed story can tell (the swan too, since Nov 15); at most four (Quest 3S, Nov 16: the fourth was dropped).
  assert.deepEqual(parseCommand('dream with a swan, a fish, a bird, a dog and a rabbit').shapes, ['swan', 'fish', 'bird', 'dog']);
  assert.deepEqual(readWish('a story with a rabbit, a dog, a bird and a cup').shapes, ['rabbit', 'dog', 'bird', 'cup']);
  assert.deepEqual(readWish('a rabbit, a dog, a bird and cups of light').shapes, ['rabbit', 'dog', 'bird', 'cup']);
  // A story line that says "dream" is not a command.
  assert.notEqual(parseCommand('The fish drifts off to dream')?.kind, 'dream');
  assert.equal(parseCommand('Close your eyes and dream of the sea'), null);
});

test('a story asked for in plain words: the place and shapes read from it, and the words kept as the idea', () => {
  assert.deepEqual(parseCommand('I need a forest story with dog and rabbit'), {
    kind: 'dream', theme: 'forest', shapes: ['dog', 'rabbit'], wish: 'i need a forest story with dog and rabbit',
  });
  assert.deepEqual(parseCommand("Can we have a story about puppies at the beach? Make it funny."), {
    kind: 'dream', theme: 'sea', shapes: ['dog'], wish: 'can we have a story about puppies at the beach make it funny',
  });
  // Nothing named: the server's model picks from the idea.
  assert.deepEqual(parseCommand("I'd like a bedtime story about being brave"), { kind: 'dream', theme: '', shapes: [], wish: 'i d like a bedtime story about being brave' });
  // Narration that mentions a story is not someone asking for one.
  assert.equal(parseCommand('This is the story of a little dog in the forest')?.kind === 'dream', false);
  assert.equal(parseCommand('Once upon a time, in a story far away, a rabbit hopped'), null);
  // Too long to be a request.
  assert.equal(parseCommand(`I want a story ${'and then '.repeat(15)}`), null);
});

test('readWish: places and shapes in any wording, plurals too, in the order said', () => {
  assert.deepEqual(readWish('A story in the woods with bunnies, birds and a puppy'), { theme: 'forest', shapes: ['rabbit', 'bird', 'dog'] });
  assert.deepEqual(readWish('something calm'), { theme: '', shapes: [] });
  // Any creature a story can tell, not only the chooser's five (Quest 3, Nov 15: the crocodile was dropped).
  assert.deepEqual(readWish('a story with a fish and a crocodile'), { theme: '', shapes: ['fish', 'crocodile'] });
  assert.deepEqual(readWish('swans and a deer and a snail'), { theme: '', shapes: ['swan', 'deer', 'snail'] });
});
