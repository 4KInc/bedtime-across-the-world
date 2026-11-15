import { createSystem } from '@iwsdk/core';
import { gesture } from './sfx.js';

/**
 * Listens for the user gestures sound needs (see soundLock in sfx.ts): a pinch
 * (select) or grip in the headset, or a tap or key on the page. Entering XR from
 * the browser's own prompt is not one, so until one of these the headset keeps
 * every sound, the narrator too, silent.
 */
export class SoundUnlockSystem extends createSystem({}) {
  private session: XRSession | undefined;
  private readonly onGesture = () => gesture();

  init(): void {
    window.addEventListener('pointerdown', this.onGesture);
    window.addEventListener('keydown', this.onGesture);
    this.cleanupFuncs.push(() => {
      window.removeEventListener('pointerdown', this.onGesture);
      window.removeEventListener('keydown', this.onGesture);
      this.watch(undefined);
    });
  }

  update(): void {
    this.watch(this.world.session);
  }

  private watch(session: XRSession | undefined): void {
    if (session === this.session) return;
    this.session?.removeEventListener('selectstart', this.onGesture);
    this.session?.removeEventListener('squeezestart', this.onGesture);
    this.session = session;
    session?.addEventListener('selectstart', this.onGesture);
    session?.addEventListener('squeezestart', this.onGesture);
  }
}
