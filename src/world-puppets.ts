import { Entity, Group, World } from '@iwsdk/core';
import { ShadowPuppet } from './shadowplay-components.js';
import { WORLD_CREATURES } from './world-creatures.js';

const WORLD_CREATURE_IDS: ReadonlySet<string> = new Set(Object.values(WORLD_CREATURES).flat());

/**
 * A world creature's puppet, made the first time it is needed: by a story that
 * asks for it, or by a recording or live room in which it wakes (the scene only
 * holds the first creatures). Undefined for any other shape.
 */
export function addWorldPuppet(world: World, shape: string): Entity | undefined {
  if (!WORLD_CREATURE_IDS.has(shape)) return undefined;
  const puppet = world.createTransformEntity(new Group());
  puppet.object3D!.name = `${shape}-puppet`;
  puppet.addComponent(ShadowPuppet, { shape: shape as never });
  return puppet;
}
