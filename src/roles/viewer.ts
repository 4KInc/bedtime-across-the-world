import type { World } from '@iwsdk/core';
import { CameraHandsSystem } from '../camera-hands.js';
import { ShelfSystem } from '../shelf.js';
import { ViewerUISystem } from '../viewer-ui.js';

/** Systems only the family viewer needs (phone, tablet): its page UI, camera hands, and the shelf under the stage. */
export function registerViewer(world: World): void {
  world.registerSystem(CameraHandsSystem).registerSystem(ViewerUISystem).registerSystem(ShelfSystem);
}
