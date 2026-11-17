import { BoxGeometry, createSystem, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3, VisibilityState } from '@iwsdk/core';
import { CAPTION_H, CAPTION_W } from './caption-art.js';
import { stageRuntime } from './stage-runtime.js';
import { viewerMode } from './viewer-mode.js';

/** Metres in front of the stage (toward the viewer) where things stand on the shelf. */
const DEPTH = 0.08;
const THICK = 0.025;
/** Clear space between the caption's bottom and the tallest thing on the shelf (m). */
const GAP = 0.015;

/**
 * Where things stand on the shelf (m along the stage's right, from its centre).
 * Left of the middle and toward it, so the viewer's Pause / Join in / Stop pill
 * in the bottom-right corner never covers them.
 */
export const SHELF = {
  jar: -0.52,
  /** One place for each place on the desk (lanterns.ts SLOTS: four). */
  lanterns: [-0.33, -0.15, 0.03, 0.21],
  mo: 0.36,
  /** A lantern creature's size on the shelf (m), as on a real desk. */
  size: 0.12,
  /** Glows on the shelf are smaller than in a room, so neighbours do not run together. */
  glow: 0.7,
} as const;

/** For other systems: the shelf is showing, and the middle of its top surface and its right (world space). */
export const shelfRuntime = { on: false, centre: new Vector3(), right: new Vector3(1, 0, 0) };

/** How far below the stage centre the shelf's top is: under the caption, with room for a lantern. */
export function shelfDrop(width: number): number {
  const caption = ((width * 0.95 * CAPTION_H) / CAPTION_W) * 0.7;
  return width * 0.62 * 0.5 + caption + SHELF.size + GAP;
}

/** How far below the stage centre the shelf's underside is (framing the view). */
export function shelfBottom(width: number): number {
  return shelfDrop(width) + THICK;
}

/** A point on the shelf's top surface, `along` metres to the stage's right of its middle. */
export function shelfSpot(along: number, out: Vector3): Vector3 {
  return out.copy(shelfRuntime.centre).addScaledVector(shelfRuntime.right, along);
}

/**
 * The shelf: the family viewer's desk. A phone, tablet or computer has no real
 * desk in front of the wall, so a little wooden shelf runs under the stage,
 * below the caption, and what steps off the wall into the room in the headset
 * lands here instead: the lantern creatures (lanterns.ts), the keepsake star
 * jar (keepsakes.ts) and Mo, asleep at the end of the story (mo-visit.ts).
 * Family viewer only, outside XR.
 */
export class ShelfSystem extends createSystem({}) {
  private group = new Group();
  /**
   * The plank writes no depth: seen from above, its top hid the lower part of the glows behind
   * the creatures on it (Nov 17: each glowing circle was cut off). It is drawn first
   * (renderOrder), so everything on it still stands in front of it.
   */
  private materials = [
    new MeshBasicMaterial({ depthWrite: false, color: 0x4a3322 }), // ends
    new MeshBasicMaterial({ depthWrite: false, color: 0x4a3322 }),
    new MeshBasicMaterial({ depthWrite: false, color: 0x7a5638 }), // top, catching the light
    new MeshBasicMaterial({ depthWrite: false, color: 0x24180f }),
    new MeshBasicMaterial({ depthWrite: false, color: 0x3a281a }), // front edge
    new MeshBasicMaterial({ depthWrite: false, color: 0x24180f }),
  ];
  private plank = new Mesh(new BoxGeometry(1, THICK, 0.12), this.materials);

  private basis = new Matrix4();

  init(): void {
    this.plank.name = 'shelf-plank';
    this.plank.renderOrder = -1;
    this.group.name = 'viewer-shelf';
    this.group.add(this.plank);
    this.group.visible = false;
    const entity = this.world.createTransformEntity(this.group);
    this.cleanupFuncs.push(() => {
      shelfRuntime.on = false;
      this.plank.geometry.dispose();
      for (const m of this.materials) m.dispose();
      entity.dispose();
    });
  }

  update(): void {
    const on = viewerMode.on && stageRuntime.ready && this.world.visibilityState.peek() === VisibilityState.NonImmersive;
    shelfRuntime.on = on;
    this.group.visible = on;
    if (!on) return;
    const width = stageRuntime.width;
    shelfRuntime.right.copy(stageRuntime.right);
    shelfRuntime.centre
      .copy(stageRuntime.center)
      .addScaledVector(stageRuntime.up, -shelfDrop(width))
      .addScaledVector(stageRuntime.normal, DEPTH);
    this.group.position.copy(shelfRuntime.centre).addScaledVector(stageRuntime.up, -THICK / 2);
    this.group.quaternion.setFromRotationMatrix(this.basis.makeBasis(stageRuntime.right, stageRuntime.up, stageRuntime.normal));
    this.plank.scale.x = width * 1.1;
  }
}
