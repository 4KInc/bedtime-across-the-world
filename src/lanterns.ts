import {
  AddEquation,
  CanvasTexture,
  Color,
  createSystem,
  CustomBlending,
  DoubleSide,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OneFactor,
  PlaneGeometry,
  Vector3,
  VisibilityState,
  ZeroFactor,
} from '@iwsdk/core';
import { buildPuppetRig, PuppetRig } from './puppet-rigs.js';
import { SHELF, shelfRuntime, shelfSpot } from './shelf.js';
import { DeskLamp, ShadowJournal } from './shadowplay-components.js';
import { accessRuntime, stageRuntime } from './stage-runtime.js';
import { storyRuntime } from './story-script.js';

/** Creatures that step into the room (the cup is a light, the open hand is not a creature). */
const CREATURES = new Set(['rabbit', 'ears', 'fish', 'dog', 'bird', 'snail', 'swan', 'deer', 'crocodile']);
/**
 * Places on the desk: a gentle arc in front of the Shadow Journal and the lamp's
 * switch, side by side (m from their midpoint, along the desk) and toward the
 * wall (m), far enough apart that lanterns never touch (Quest 3, Nov 15: three
 * places 8 cm apart for 14 cm lanterns overlapped).
 */
const SLOTS = [
  { along: -0.19, toWall: 0.17 },
  { along: 0, toWall: 0.22 },
  { along: 0.19, toWall: 0.17 },
] as const;
/** A lantern creature's size on the desk (metres, like the wall puppets' scale). */
const SIZE = 0.12;
/** Seconds for the hop from the wall to the desk. */
const HOP = 1.8;
/** How high the hop arcs above the straight line (metres). */
const ARC = 0.28;
const PAPER = new Color(0xffe6bf);
const WARM = new Color(0xffc477);
const EYE = new MeshBasicMaterial({ color: 0x1b1822, side: DoubleSide });

/** For tests: lantern creatures on the desk (by shape), hopping now, where the last one stands, and the closest two (m apart). */
export const lanternRuntime = { onDesk: [] as string[], hopping: 0, last: new Vector3(), deskY: 0, gap: -1 };

interface Lantern {
  shape: string;
  rig: PuppetRig;
  paper: MeshBasicMaterial;
  glow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  group: Group;
  entity: Entity;
  slot: number;
  t: number;
  from: Vector3;
  fromScale: number;
  colour: Color;
  phase: number;
}

/** A soft round glow drawn in colour (it is added as light: see fireflies.ts). */
function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#fff');
  grad.addColorStop(0.4, '#555');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * Creatures step into the room: when a creature you woke is let go, it does not
 * just fade from the wall. A little paper cut-out of it, lit warm from inside
 * like a lantern in its colour, hops off the wall in an arc and lands on the
 * real desk between the Shadow Journal and the lamp, where it stays, breathing
 * softly and turned toward you, for the rest of the story. Up to three at once
 * (the oldest makes room); they leave when another story starts. On the family
 * viewer (phone, tablet, computer) they land on the shelf under the stage
 * instead (shelf.ts), so the child sees them step out too.
 */
export class LanternSystem extends createSystem({
  lamps: { required: [DeskLamp] },
  journals: { required: [ShadowJournal] },
}) {
  private lanterns: Lantern[] = [];
  private seen = 0;
  private script = '';
  private time = 0;
  private glowTexture = glowTexture();
  private glowGeometry = new PlaneGeometry(1, 1);
  private lamp = new Vector3();
  private book = new Vector3();
  private toWall = new Vector3();
  private along = new Vector3();
  private target = new Vector3();
  private head = new Vector3();
  private landed = -1;
  private switchObj: Object3D | undefined;

  init(): void {
    this.seen = stageRuntime.releases;
    this.cleanupFuncs.push(() => {
      for (const l of [...this.lanterns]) this.remove(l);
      this.glowTexture.dispose();
      this.glowGeometry.dispose();
    });
  }

  update(delta: number): void {
    this.time += delta;
    const inXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    // The desk runs from the Shadow Journal to the lamp's switch (the lamp itself stands behind the viewer).
    this.switchObj ??= this.world.scene.getObjectByName('desk-switch');
    const lampObj = this.switchObj ?? (this.queries.lamps.entities.values().next().value as Entity | undefined)?.object3D;
    const bookObj = (this.queries.journals.entities.values().next().value as Entity | undefined)?.object3D;
    const onShelf = !inXR && shelfRuntime.on;
    const ready = stageRuntime.ready && (onShelf || (inXR && !!lampObj && !!bookObj));
    if (storyRuntime.script !== this.script) {
      this.script = storyRuntime.script;
      for (const l of [...this.lanterns]) this.remove(l);
    }
    if (stageRuntime.releases !== this.seen) {
      this.seen = stageRuntime.releases;
      if (ready && CREATURES.has(stageRuntime.releaseShape)) this.add();
    }
    for (const l of this.lanterns) l.group.visible = ready;
    if (!ready) return;

    const size = onShelf ? SHELF.size : SIZE;
    const glow = onShelf ? SHELF.glow : 1;
    let deskY = shelfRuntime.centre.y;
    if (!onShelf) {
      lampObj!.getWorldPosition(this.lamp);
      bookObj!.getWorldPosition(this.book);
      deskY = this.lamp.y;
      this.toWall.copy(stageRuntime.normal).setY(0).normalize().negate();
    }
    this.head.copy(stageRuntime.eye);
    let hopping = 0;
    for (const l of this.lanterns) {
      if (onShelf) shelfSpot(SHELF.lanterns[l.slot], this.target);
      else {
        const slot = SLOTS[l.slot];
        this.target
          .lerpVectors(this.book, this.lamp, 0.5)
          .addScaledVector(this.along.subVectors(this.lamp, this.book).setY(0).normalize(), slot.along)
          .addScaledVector(this.toWall, slot.toWall);
      }
      this.target.y = deskY + size * 0.5;
      const g = l.group;
      if (l.t < HOP) {
        hopping++;
        l.t += delta;
        const k = Math.min(1, l.t / HOP);
        const e = k * k * (3 - 2 * k);
        g.position.lerpVectors(l.from, this.target, e);
        g.position.y += Math.sin(Math.PI * e) * ARC;
        g.scale.setScalar(l.fromScale + (size - l.fromScale) * e);
      } else {
        // On the desk: a soft breath and a little sway.
        g.position.copy(this.target);
        g.position.y += Math.sin(this.time * 2 + l.phase) * 0.003;
        g.scale.setScalar(size * (1 + 0.02 * Math.sin(this.time * 2 + l.phase)));
      }
      g.rotation.set(0, Math.atan2(this.head.x - g.position.x, this.head.z - g.position.z), Math.sin(this.time * 1.3 + l.phase) * 0.04);
      l.rig.animate(this.time, delta, null);
      // Lit from inside: the paper in its colour, a glow around it (plain warm in high contrast).
      const contrast = accessRuntime.highContrast;
      l.paper.color.copy(contrast ? PAPER : l.colour).lerp(PAPER, contrast ? 0 : 0.3);
      l.glow.scale.setScalar(2.4 * glow);
      l.glow.material.color.copy(contrast ? WARM : l.colour).lerp(WARM, 0.4).multiplyScalar(0.55 + 0.15 * Math.sin(this.time * 2.6 + l.phase));
    }
    // (Rebuilt only when one lands or leaves: nothing allocated per frame.)
    let landed = 0;
    for (const l of this.lanterns) if (l.t >= HOP) landed++;
    if (landed !== this.landed) {
      this.landed = landed;
      lanternRuntime.onDesk = this.lanterns.filter((l) => l.t >= HOP).map((l) => l.shape);
      lanternRuntime.gap = this.closest();
    }
    lanternRuntime.hopping = hopping;
    lanternRuntime.deskY = Math.round(deskY * 1000) / 1000;
    const last = this.lanterns[this.lanterns.length - 1];
    if (last) lanternRuntime.last.copy(last.group.position);
  }

  /** The smallest distance between two lanterns on the desk (-1 with fewer than two). */
  private closest(): number {
    let best = -1;
    for (let i = 0; i < this.lanterns.length; i++) {
      for (let j = i + 1; j < this.lanterns.length; j++) {
        const d = this.lanterns[i].group.position.distanceTo(this.lanterns[j].group.position);
        if (best < 0 || d < best) best = d;
      }
    }
    return Math.round(best * 1000) / 1000;
  }

  /** The creature just let go hops off the wall onto the desk (the same creature again just hops again). */
  private add(): void {
    const shape = stageRuntime.releaseShape;
    let l = this.lanterns.find((x) => x.shape === shape);
    if (l) {
      this.lanterns.splice(this.lanterns.indexOf(l), 1);
      this.lanterns.push(l);
    } else {
      let slot = SLOTS.findIndex((_, i) => !this.lanterns.some((x) => x.slot === i));
      if (slot < 0) {
        slot = this.lanterns[0].slot;
        this.remove(this.lanterns[0]);
      }
      const paper = new MeshBasicMaterial({ color: PAPER, side: DoubleSide });
      const rig = buildPuppetRig(shape, paper, EYE);
      const glow = new Mesh(
        this.glowGeometry,
        new MeshBasicMaterial({
          map: this.glowTexture, transparent: true, depthWrite: false, blending: CustomBlending, blendEquation: AddEquation,
          blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
        }),
      );
      glow.scale.setScalar(2.4);
      glow.position.z = -0.05;
      glow.name = 'lantern-glow';
      const group = new Group();
      group.name = `lantern-${shape}`;
      group.add(glow, rig.root);
      const entity = this.world.createTransformEntity(group);
      l = { shape, rig, paper, glow, group, entity, slot, t: 0, from: new Vector3(), fromScale: 0.3, colour: new Color(), phase: Math.random() * 6 };
      this.lanterns.push(l);
    }
    l.t = 0;
    this.landed = -1;
    l.from.copy(stageRuntime.releaseAt);
    l.fromScale = stageRuntime.releaseScale;
    l.colour.setHex(stageRuntime.releaseColour);
    l.group.position.copy(l.from);
  }

  private remove(l: Lantern): void {
    this.lanterns.splice(this.lanterns.indexOf(l), 1);
    this.landed = -1;
    // The rig's shapes are shared with the wall puppets: only this lantern's own materials are freed.
    l.paper.dispose();
    l.glow.material.dispose();
    l.entity.dispose();
  }
}
