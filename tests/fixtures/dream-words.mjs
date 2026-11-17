// A reply as Claude might write it for "Dream up a new story" (server tests and
// the sim build stories from it with server/dream.ts assembleStory).
const ASK = {
  rabbit: 'Make a rabbit with your hand: two tall ears up, and hold it still.',
  fish: 'Make a fish: a flat hand, fingers together, and let it swim.',
  dog: 'Make a dog with your hand, its ear up, and say a soft woof.',
  bird: 'Make a bird with two hands side by side, and spread your wings.',
  cup: 'Cup your hands together softly, to hold the little light.',
  swan: 'Make a swan: a flat hand, bent down at the wrist, like a long neck.',
  crocodile: 'Make a crocodile: two flat hands, one on top of the other, like a long mouth.',
  deer: 'Make a deer with two hands: wrists together, fingers up and spread, like antlers.',
  snail: 'Make a snail: a fist for the shell, and two fingers poking forward for its eyes.',
  rocket: 'Make a rocket: one finger pointing straight up, the others curled in.',
  alien: 'Make an alien: your pointer finger and your little finger up, like antennae.',
  asteroid: 'Make an asteroid: a fist, round and lumpy like a space rock.',
  shark: 'Make a shark: a flat hand, fingers together, pointing up like a fin.',
  octopus: 'Make an octopus: let your hand hang down, fingers spread, and wiggle them.',
  whale: 'Make a whale: a fist for its body, and your thumb up for its spout.',
  car: 'Make a car: a fist, with two fingers pointing forward like headlights.',
  plane: 'Make an aeroplane: your thumb and your little finger out, like wings.',
  digger: 'Make a digger: a flat hand, bent down at the wrist, like a scoop.',
  trex: 'Make a T. rex: two flat hands, one on top of the other, like a big mouth.',
  pterodactyl: 'Make a pterodactyl: two hands side by side, like wide wings.',
};

/** The words for these shapes; `broken` leaves the shape's name out of every request (which must be refused). */
export function cannedWords(shapes, { broken = false } = {}) {
  return JSON.stringify({
    title: 'The Lantern Tide',
    opening: ['The sea is hushed tonight, and the waves are whispering.', 'Mo flutters down to see who is still awake.'],
    scenes: shapes.map((shape) => ({
      shape,
      setup: `A small light is drifting far away, and Mo needs a friend to reach it.`,
      ask: broken ? 'Make a shape with your hand and hold it still.' : ASK[shape],
      ride: 'Off we go, softly.',
      after: 'There it is, glowing like a sleepy star.',
      bow: 'The creature curls up and closes its eyes.',
    })),
    ending: ['The little lights are home, and the sea is calm.', 'Goodnight, little one. Mo is sleepy too.'],
  });
}
