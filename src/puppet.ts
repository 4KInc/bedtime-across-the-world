import { CanvasTexture, Color, createSystem, Entity, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { family } from './family.js';
import { CHILD_COLOUR, creatureColour } from './creature-colours.js';
import { buildPuppetRig, PuppetRig } from './puppet-rigs.js';
import { playChime, playCreature } from './sfx.js';
import {
  Hands,
  LiveSession,
  PuppetStates,
  ShadowPuppet,
  ShapeIds,
  ShapeRecognizer,
} from './shadowplay-components.js';
import { accessRuntime, handRuntime, HandSample, reachStage, stageRuntime } from './stage-runtime.js';
import { NATURAL_HAND } from './lamp-behind.js';

const HAND_LENGTH = 0.18;
/**
 * Character size over the raw hand shadow. With the lamp behind the viewer a
 * shadow is about 2.6x the hand (it was 5-20x from the desk lamp), so a little larger.
 */
const CHARACTER_SCALE = 1.15;
/**
 * Growing: a hand pulled back from its natural place toward the viewer (and the
 * lamp behind them) makes its creature bigger, a little more than a real shadow
 * would, so the story's "grow" asks are playable (about 1.8x at 20 cm from the eyes).
 */
const GROW_GAIN = 3.5;
const GROW_MAX = 2.2;
/** Largest character, as a fraction of stage width. */
const MAX_SIZE = 0.95;
/** Two hands side by side cast a wider shadow than one. */
const TWO_HAND_SPAN = 1.35;
const RELEASE_LOST_SECONDS = 0.6;
/** An open hand must stay out of the light this long before it lets go. */
const RELEASE_OPEN_SECONDS = 0.25;
const RELEASE_DARK_SECONDS = 1.0;
/**
 * A creature woken without a hand crosses the wall by itself: across and back
 * (stage widths, radians per second), reaching every story's carry target
 * (u up to 0.34; a flier also climbs to v 0.2), at about half the stage's height.
 */
const SELF_SWING = 0.36;
const SELF_RATE = 0.4;
const SELF_SIZE = 0.5;
const FLIERS: ReadonlySet<string> = new Set([ShapeIds.Bird, ShapeIds.Swan]);
const FADE_SECONDS = 0.8;
const INK = 0x0a0810;
/** How long a woken creature takes to bloom into its colour (seconds). */
const BLOOM_SECONDS = 0.7;
const INK_COLOUR = new Color(INK);
/** In a live story with Take turns, the child's creatures wake in this colour (unlike any creature's own), with their name. */
const LABEL_W = 512;
const LABEL_H = 128;
/** What a creature is called on its label. */
const CREATURE_NAME: Readonly<Record<string, string>> = { ears: 'rabbit', open: 'creature' };

interface PuppetRuntime {
  rig: PuppetRig;
  fill: MeshBasicMaterial;
  eyeMat: MeshBasicMaterial;
  pos: Vector3;
  scale: number;
  facing: number;
  lostFor: number;
  fade: number;
  alive: number;
  blinkIn: number;
  hop: number;
  lastState: string;
  twoHanded: boolean;
  /** Its waking colour (creature-colours.ts), and how far it has bloomed (0 shadow, 1 colour). */
  colour: Color;
  bloom: number;
  /** Its own colour (`colour` becomes the child's colour while the child's creature is awake). */
  ownColour: number;
  /** Woken by the child in a live story (Take turns), and its name label (made when first needed). */
  byChild: boolean;
  /** Seconds until it next makes its little sound while awake. */
  voiceIn: number;
  /** Woken without a hand (said aloud, or Look to press): it performs by itself until a hand takes it over. */
  selfDriven: boolean;
  selfTime: number;
  label: { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; canvas: HTMLCanvasElement; texture: CanvasTexture } | null;
}

/**
 * Shows a requested character as a faint outline that fills in while the
 * shape is held; once matched, the character replaces the hand's shadow and
 * follows it (position from the lamp projection, size from lamp distance, parts
 * from finger pose). Opening the hand or leaving the light releases it.
 */
export class PuppetSystem extends createSystem({
  puppets: { required: [ShadowPuppet] },
  recognizers: { required: [ShapeRecognizer] },
  sessions: { required: [LiveSession] },
}) {
  private runtimes = new Map<Entity, PuppetRuntime>();
  private palm = new Vector3();
  private palm2 = new Vector3();
  private v = new Vector3();
  private hit = new Vector3();
  private tmp = new Vector3();
  private quat = new Quaternion();
  private time = 0;

  init(): void {
    this.cleanupFuncs.push(
      this.queries.puppets.subscribe('disqualify', (entity) => {
        const rt = this.runtimes.get(entity);
        if (rt) {
          rt.rig.root.removeFromParent();
          rt.fill.dispose();
          rt.eyeMat.dispose();
          if (rt.label) {
            rt.label.texture.dispose();
            rt.label.mesh.material.dispose();
            rt.label.mesh.geometry.dispose();
          }
          this.runtimes.delete(entity);
        }
      }),
    );
  }

  private runtimeFor(entity: Entity): PuppetRuntime | undefined {
    let rt = this.runtimes.get(entity);
    if (rt || !entity.object3D) return rt;
    const fill = new MeshBasicMaterial({ color: INK, transparent: true, opacity: 0 });
    const eyeMat = new MeshBasicMaterial({ color: 0xffb45a, transparent: true, opacity: 0 });
    const rig = buildPuppetRig(entity.getValue(ShadowPuppet, 'shape') ?? ShapeIds.Rabbit, fill, eyeMat);
    rig.root.userData.seat = rig.seat;
    entity.object3D.add(rig.root);
    rt = {
      rig, fill, eyeMat, pos: new Vector3(), scale: 0.3, facing: 1,
      lostFor: 0, fade: 0, alive: 0, blinkIn: 2.5, hop: 0,
      lastState: PuppetStates.Hidden, twoHanded: false,
      colour: new Color(creatureColour(entity.getValue(ShadowPuppet, 'shape') ?? '') || INK), bloom: 0,
      ownColour: creatureColour(entity.getValue(ShadowPuppet, 'shape') ?? '') || INK, byChild: false, label: null, voiceIn: 5,
      selfDriven: false, selfTime: 0,
    };
    this.runtimes.set(entity, rt);
    return rt;
  }

  update(delta: number): void {
    this.time += delta;
    const recognizer = this.queries.recognizers.entities.values().next().value as Entity | undefined;
    for (const entity of this.queries.puppets.entities) {
      const rt = this.runtimeFor(entity);
      const obj = entity.object3D;
      if (!rt || !obj) continue;
      obj.visible = stageRuntime.ready;
      if (!stageRuntime.ready) continue;
      obj.quaternion.copy(this.stageQuaternion());

      const state = entity.getValue(ShadowPuppet, 'state') ?? PuppetStates.Hidden;
      if (state !== rt.lastState) {
        // Entering Releasing from anywhere (e.g. the story's bow) starts the fade.
        if (state === PuppetStates.Releasing) {
          rt.fade = Math.max(rt.fade, rt.fill.opacity / 0.92);
          // Let go after it was awake: it steps off the wall into the room (lanterns.ts).
          if (rt.lastState === PuppetStates.Alive) {
            obj.getWorldPosition(stageRuntime.releaseAt);
            stageRuntime.releaseScale = rt.scale;
            stageRuntime.releaseShape = entity.getValue(ShadowPuppet, 'shape') ?? '';
            stageRuntime.releaseColour = rt.colour.getHex();
            stageRuntime.releases++;
          }
        }
        if (state === PuppetStates.Alive) {
          this.markWaker(entity, rt);
          playChime(obj.position);
          playCreature(entity.getValue(ShadowPuppet, 'shape') ?? '', obj.position);
          rt.voiceIn = 4 + Math.random() * 3;
          stageRuntime.wakeFlare = 1;
          obj.getWorldPosition(stageRuntime.wakeAt);
          stageRuntime.wakeColour = rt.colour.getHex();
          stageRuntime.wakeShape = entity.getValue(ShadowPuppet, 'shape') ?? '';
          stageRuntime.wakes++;
        }
        rt.lastState = state;
      }
      let features: Float32Array | null = null;
      if (state === PuppetStates.Outline) this.updateOutline(entity, rt, recognizer, delta);
      else if (state === PuppetStates.Alive) {
        features = this.updateAlive(entity, rt, recognizer, delta);
        // Now and then, a little sound from where it is.
        rt.voiceIn -= delta;
        if (rt.voiceIn <= 0) {
          rt.voiceIn = 5 + Math.random() * 4;
          playCreature(entity.getValue(ShadowPuppet, 'shape') ?? '', obj.position, true);
        }
      }
      else if (state === PuppetStates.Releasing) this.updateReleasing(entity, rt, recognizer, delta);
      else {
        rt.fill.opacity = Math.max(0, rt.fill.opacity - delta * 1.5);
        rt.eyeMat.opacity = 0;
        // Free Stage: any discovered shape comes alive without a request.
        if (recognizer?.getValue(ShapeRecognizer, 'freeMode')) this.tryWake(entity, rt, recognizer);
      }
      // Fully faded characters are skipped entirely (no draw calls, no animation).
      rt.rig.root.visible = rt.fill.opacity > 0.002;
      if (rt.label) {
        rt.label.mesh.visible = rt.byChild && rt.rig.root.visible;
        rt.label.mesh.material.opacity = Math.min(1, rt.fill.opacity * 1.1);
        rt.label.mesh.position.set(0, -rt.scale * 0.62, 0.002);
        rt.label.mesh.scale.setScalar(stageRuntime.width * 0.36);
      }
      if (rt.rig.root.visible) rt.rig.animate(this.time, delta, features);

      obj.position.copy(rt.pos).addScaledVector(stageRuntime.normal, 0.01);
      rt.rig.root.scale.set(rt.scale * rt.facing, rt.scale, rt.scale);
      entity.setValue(ShadowPuppet, 'size', rt.scale / stageRuntime.width);
    }
  }

  private stageQuaternion(): Quaternion {
    const n = stageRuntime.normal;
    return this.quat.setFromAxisAngle(this.tmp.set(0, 1, 0), Math.atan2(n.x, n.z));
  }

  private updateOutline(entity: Entity, rt: PuppetRuntime, rec: Entity | undefined, delta: number): void {
    // Being formed: a shadow (it blooms into colour only once it wakes).
    if (rt.bloom > 0) {
      rt.bloom = 0;
      this.tint(rt);
    }
    const u = entity.getValue(ShadowPuppet, 'outlineU') ?? 0;
    const v = entity.getValue(ShadowPuppet, 'outlineV') ?? 0;
    rt.pos
      .copy(stageRuntime.center)
      .addScaledVector(stageRuntime.right, u * stageRuntime.width)
      .addScaledVector(stageRuntime.up, v * stageRuntime.height);
    rt.scale = stageRuntime.height * 0.62;
    rt.facing = 1;
    const shape = entity.getValue(ShadowPuppet, 'shape');
    const hold = rec?.getValue(ShapeRecognizer, 'holdSeconds') ?? 0.5;
    const held = rec?.getValue(ShapeRecognizer, 'heldFor') ?? 0;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2);
    // Only the outline being formed fills in.
    const forming = rec?.getValue(ShapeRecognizer, 'matchedShape') === shape || held > 0;
    const target = 0.14 + 0.08 * pulse + (forming ? 0.7 * Math.min(1, held / hold) : 0);
    rt.fill.opacity += (target - rt.fill.opacity) * Math.min(1, delta * 10);
    rt.eyeMat.opacity = 0;

    this.tryWake(entity, rt, rec);
  }

  /** Brings the puppet alive when the recognizer has matched its shape. */
  private tryWake(entity: Entity, rt: PuppetRuntime, rec: Entity | undefined): void {
    const shape = entity.getValue(ShadowPuppet, 'shape');
    const matched = rec?.getValue(ShapeRecognizer, 'matchedHand') ?? Hands.None;
    if (matched !== Hands.None && rec?.getValue(ShapeRecognizer, 'matchedShape') === shape) {
      rt.twoHanded = Boolean(rec.getValue(ShapeRecognizer, 'twoHanded'));
      entity.setValue(ShadowPuppet, 'state', PuppetStates.Alive);
      entity.setValue(ShadowPuppet, 'hand', matched);
      handRuntime[matched as 'left' | 'right'].hideCasters = true;
      if (rt.twoHanded) handRuntime.left.hideCasters = handRuntime.right.hideCasters = true;
      rt.lostFor = 0;
      rt.alive = 0;
      rt.bloom = 0;
      rt.pos.copy(stageRuntime.center);
      rt.selfDriven = accessRuntime.handsFreeWake;
      rt.selfTime = 0;
      accessRuntime.handsFreeWake = false;
    }
  }

  private palmOf(hand: HandSample, out: Vector3): Vector3 {
    const j = hand.joints;
    return out.set((j[0] + j[33]) * 0.5, (j[1] + j[34]) * 0.5, (j[2] + j[35]) * 0.5);
  }

  private updateAlive(entity: Entity, rt: PuppetRuntime, rec: Entity | undefined, delta: number): Float32Array | null {
    const side = entity.getValue(ShadowPuppet, 'hand') as 'left' | 'right';
    const hand = handRuntime[side];
    rt.alive = Math.min(1, rt.alive + delta * 3);
    rt.fill.opacity = 0.92 * Math.min(1, rt.alive * 1.5);
    rt.eyeMat.opacity = rt.fill.opacity;
    rt.bloom = Math.min(1, rt.bloom + delta / BLOOM_SECONDS);
    this.tint(rt);

    const shapeId = entity.getValue(ShadowPuppet, 'shape');
    if (shapeId === ShapeIds.Bird || shapeId === ShapeIds.Cup) {
      const two = Boolean(rec?.getValue(ShapeRecognizer, 'twoHanded'));
      if (two !== rt.twoHanded) {
        rt.twoHanded = two;
        const other = side === 'left' ? handRuntime.right : handRuntime.left;
        other.hideCasters = two;
      }
    }
    let onStage = false;
    let released = false;
    let features: Float32Array | null = null;
    // A creature performing by itself is taken over only by a hand making its shape in the light. Any hand
    // within reach took it over, then let it go when lowered, before it had carried Mo (Quest 3S, Nov 16).
    if (rt.selfDriven) {
      const taker = this.handMaking(shapeId, rec);
      if (taker) {
        rt.selfDriven = false;
        entity.setValue(ShadowPuppet, 'hand', taker);
        handRuntime[taker].hideCasters = true;
        return null;
      }
    }
    if (rt.selfDriven) {
      this.performAlone(entity, rt, delta);
      this.blink(rt, delta);
      return null;
    }
    if (hand?.tracked) {
      this.palmOf(hand, this.palm);
      const other = side === 'left' ? handRuntime.right : handRuntime.left;
      if (rt.twoHanded && other.tracked) this.palm.lerp(this.palmOf(other, this.palm2), 0.5);
      const t = reachStage(this.palm, this.hit, 0.3);
      onStage = t > 0;
      const shape = rec?.getValue(ShapeRecognizer, side === 'left' ? 'leftShape' : 'rightShape');
      released = shape === ShapeIds.Open && !onStage && rt.lostFor + delta > RELEASE_OPEN_SECONDS;
      if (onStage) {
        const k = Math.min(1, delta * 12);
        const dx = this.hit.x - rt.pos.x;
        const dz = this.hit.z - rt.pos.z;
        const lateral = dx * stageRuntime.right.x + dz * stageRuntime.right.z;
        if (Math.abs(lateral) > 0.004) rt.facing = lateral > 0 ? 1 : -1;
        rt.hop += Math.min(1, Math.abs(lateral) * 40) * delta * 9;
        rt.pos.lerp(this.hit, k);
        const hopY = Math.abs(Math.sin(rt.hop)) * rt.scale * 0.12;
        rt.pos.addScaledVector(stageRuntime.up, hopY * k);
        const pop = 1 + 0.25 * Math.sin(Math.min(1, rt.alive) * Math.PI);
        const span = rt.twoHanded ? TWO_HAND_SPAN : 1;
        // Closer to the lamp (behind the viewer) means bigger: a hand pulled back toward the eyes grows its creature.
        const forward = -this.v.subVectors(this.palm, stageRuntime.eye).dot(stageRuntime.normal);
        const grow = 1 + Math.min(GROW_MAX - 1, Math.max(0, NATURAL_HAND - forward) * GROW_GAIN);
        const target = Math.min(stageRuntime.width * MAX_SIZE, HAND_LENGTH * CHARACTER_SCALE * span * t * pop * grow);
        rt.scale += (target - rt.scale) * k;
        features = hand.features;
      }
    }
    this.blink(rt, delta);

    rt.lostFor = onStage ? 0 : rt.lostFor + delta;
    const limit = hand?.tracked ? RELEASE_DARK_SECONDS : RELEASE_LOST_SECONDS;
    if (released || rt.lostFor > limit) {
      entity.setValue(ShadowPuppet, 'state', PuppetStates.Releasing);
      rt.fade = 1;
    }
    return features;
  }

  /** The hand recognised making this shape in the light (two-hand shapes count on either hand), or null. */
  private handMaking(shape: string | null | undefined, rec: Entity | undefined): 'left' | 'right' | null {
    if (!rec || !shape) return null;
    if (rec.getValue(ShapeRecognizer, 'rightShape') === shape && rec.getValue(ShapeRecognizer, 'rightInLight')) return 'right';
    if (rec.getValue(ShapeRecognizer, 'leftShape') === shape && rec.getValue(ShapeRecognizer, 'leftInLight')) return 'left';
    return null;
  }

  /** A creature with no hand to follow: across the wall and back, hopping (or flying higher), at its own size. */
  private performAlone(entity: Entity, rt: PuppetRuntime, delta: number): void {
    rt.selfTime += delta;
    const phase = rt.selfTime * SELF_RATE;
    const u = SELF_SWING * Math.sin(phase);
    const flier = FLIERS.has(entity.getValue(ShadowPuppet, 'shape') ?? '');
    const v = flier ? 0.1 + 0.1 * Math.sin(phase) : 0;
    rt.facing = Math.cos(phase) >= 0 ? 1 : -1;
    rt.hop += delta * 6;
    const k = Math.min(1, delta * 4);
    this.v
      .copy(stageRuntime.center)
      .addScaledVector(stageRuntime.right, u * stageRuntime.width)
      .addScaledVector(stageRuntime.up, v * stageRuntime.height);
    rt.pos.lerp(this.v, k);
    const size = Math.min(stageRuntime.width * MAX_SIZE, stageRuntime.height * SELF_SIZE);
    rt.pos.addScaledVector(stageRuntime.up, Math.abs(Math.sin(rt.hop)) * size * (flier ? 0.04 : 0.1) * k);
    rt.scale += (size - rt.scale) * k;
  }

  /**
   * Who woke it: in a live story with Take turns, a creature that wakes on the
   * child's turn is theirs, in the child's colour and with their name ("Mia's
   * fish", or "Your fish" on the child's own screen when no name is set).
   */
  private markWaker(entity: Entity, rt: PuppetRuntime): void {
    const session = this.queries.sessions.entities.values().next().value as Entity | undefined;
    const role = session?.getValue(LiveSession, 'role') ?? 'off';
    rt.byChild = role !== 'off' && session?.getValue(LiveSession, 'turn') === 'guest';
    rt.colour.setHex(rt.byChild ? CHILD_COLOUR : rt.ownColour);
    if (!rt.byChild) return;
    const shape = entity.getValue(ShadowPuppet, 'shape') ?? '';
    const creature = CREATURE_NAME[shape] ?? shape;
    const child = family.current.child;
    const text = child ? `${child}'s ${creature}` : role === 'guest' ? `Your ${creature}` : `Their ${creature}`;
    if (!rt.label) {
      const canvas = document.createElement('canvas');
      canvas.width = LABEL_W;
      canvas.height = LABEL_H;
      const texture = new CanvasTexture(canvas);
      texture.colorSpace = SRGBColorSpace;
      const mesh = new Mesh(new PlaneGeometry(1, LABEL_H / LABEL_W), new MeshBasicMaterial({ map: texture, transparent: true, opacity: 0, depthWrite: false }));
      mesh.name = 'child-creature-label';
      mesh.renderOrder = 21;
      entity.object3D?.add(mesh);
      rt.label = { mesh, canvas, texture };
    }
    const g = rt.label.canvas.getContext('2d')!;
    g.clearRect(0, 0, LABEL_W, LABEL_H);
    g.font = 'italic 700 72px Georgia, "Times New Roman", serif';
    const w = Math.min(LABEL_W - 8, g.measureText(text).width + 56);
    g.fillStyle = 'rgba(192, 38, 211, 0.92)';
    g.beginPath();
    g.roundRect((LABEL_W - w) / 2, 8, w, LABEL_H - 16, (LABEL_H - 16) / 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, LABEL_W / 2, LABEL_H / 2 + 2);
    rt.label.texture.needsUpdate = true;
  }

  /**
   * The creature's colour for its bloom: a shadow at 0, its own colour at 1
   * (eased). High contrast keeps every creature a solid shadow.
   */
  private tint(rt: PuppetRuntime): void {
    const b = accessRuntime.highContrast ? 0 : rt.bloom * rt.bloom * (3 - 2 * rt.bloom);
    rt.fill.color.copy(INK_COLOUR).lerp(rt.colour, b);
  }

  private updateReleasing(entity: Entity, rt: PuppetRuntime, rec: Entity | undefined, delta: number): void {
    rt.fade -= delta / FADE_SECONDS;
    rt.fill.opacity = rt.eyeMat.opacity = Math.max(0, rt.fade) * 0.92;
    // Back to a shadow in the first half of the bow, then gone.
    rt.bloom = Math.min(rt.bloom, Math.max(0, rt.fade * 2 - 1));
    this.tint(rt);
    rt.pos.addScaledVector(stageRuntime.up, delta * 0.05); // bow and drift
    if (rt.fade > 0) return;
    const side = entity.getValue(ShadowPuppet, 'hand') as 'left' | 'right' | 'none';
    if (side !== 'none') handRuntime[side].hideCasters = false;
    if (rt.twoHanded) handRuntime.left.hideCasters = handRuntime.right.hideCasters = false;
    rt.twoHanded = false;
    entity.setValue(ShadowPuppet, 'hand', Hands.None);
    // Still requested (hand slipped out mid-scene): show the outline again.
    const shape = entity.getValue(ShadowPuppet, 'shape');
    const requested =
      rec?.getValue(ShapeRecognizer, 'target') === shape || rec?.getValue(ShapeRecognizer, 'target2') === shape;
    entity.setValue(ShadowPuppet, 'state', requested ? PuppetStates.Outline : PuppetStates.Hidden);
    rec?.setValue(ShapeRecognizer, 'matchedHand', Hands.None);
    rec?.setValue(ShapeRecognizer, 'matchedShape', ShapeIds.None);
    rec?.setValue(ShapeRecognizer, 'twoHanded', false);
    rec?.setValue(ShapeRecognizer, 'heldFor', 0);
  }

  private blink(rt: PuppetRuntime, delta: number): void {
    rt.blinkIn -= delta;
    const closing = rt.blinkIn < 0.12;
    rt.rig.eye.scale.y = closing ? 0.15 : 1;
    if (rt.blinkIn <= 0) rt.blinkIn = 2 + ((this.time * 7.31) % 2.5);
  }
}
