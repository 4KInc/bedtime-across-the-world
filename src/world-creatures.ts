/**
 * Creatures of the story worlds: space (rocket, alien, asteroid), the ocean
 * (shark, octopus, whale), cars and adventure (car, aeroplane, digger) and the
 * dinosaurs (T. rex, pterodactyl). Each is a creature of its own on the wall,
 * asked for by the stories of its world.
 *
 * A creature is made with a hand pose. Six have a pose of their own (the
 * recognizer's templates of the same name); the rest borrow a pose a child
 * already knows and the recognizer already reads well: a fist is an asteroid,
 * the snail's two fingers are a car's headlights, the swan's bent wrist is a
 * digger's bucket, the crocodile's jaws a T. rex's and the bird's wings a
 * pterodactyl's. A story asks for the creature; the hand makes its pose.
 *
 * The new poses count only while a story asks for them (WORLD_POSES), so the
 * other stories, and Free Stage, read hands exactly as before. Pure data.
 */

/** Creatures that borrow another shape's pose. */
const BORROWED: Readonly<Record<string, string>> = {
  asteroid: 'fist',
  car: 'snail',
  digger: 'swan',
  trex: 'crocodile',
  pterodactyl: 'bird',
};

/** The hand pose that makes a creature (its own id unless it borrows one). */
export function poseOf(shape: string): string {
  return BORROWED[shape] ?? shape;
}

/** Poses the recognizer considers only while a story asks for them. */
export const WORLD_POSES: ReadonlySet<string> = new Set(['rocket', 'alien', 'shark', 'octopus', 'whale', 'plane']);

/** Every world creature, by world. */
export const WORLD_CREATURES: Readonly<Record<string, readonly string[]>> = {
  space: ['rocket', 'alien', 'asteroid'],
  ocean: ['shark', 'octopus', 'whale'],
  adventure: ['car', 'plane', 'digger'],
  dinosaurs: ['trex', 'pterodactyl'],
};

/** What a creature is called in a sentence (its id otherwise). */
export const CREATURE_NAMES: Readonly<Record<string, string>> = {
  plane: 'aeroplane',
  trex: 'T. rex',
};
