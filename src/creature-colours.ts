/**
 * The colour each shadow creature wakes up in: a shadow while it is being
 * formed, then it blooms into its own colour, like lamplight through a paper
 * lantern, and drains back to shadow when it bows. Mid-tone and saturated, so
 * it reads against the warm, lit wall; each creature its own, so a child can
 * tell them apart at a glance. Pure data (no imports).
 */
export const CREATURE_COLOURS: Readonly<Record<string, number>> = {
  rabbit: 0x8b5cf6, // violet
  ears: 0x8b5cf6, // the easier rabbit
  fish: 0x0fa5a0, // teal
  dog: 0xd9692b, // warm orange
  bird: 0x2f7be6, // sky blue
  cup: 0xd9468a, // rose (the cup holds a star, gold would vanish in the lamp light)
  snail: 0x3fa857, // leaf green
  swan: 0xe0639f, // pink
  deer: 0xb85f2a, // russet
  crocodile: 0x2f9a55, // green
  open: 0xf08c2e, // amber (Free Stage)
};

/** A creature's colour, or 0 when it has none (it stays a shadow). */
export function creatureColour(shape: string): number {
  return CREATURE_COLOURS[shape] ?? 0;
}
