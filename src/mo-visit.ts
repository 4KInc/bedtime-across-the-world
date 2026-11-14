import {
  AddEquation,
  CanvasTexture,
  createSystem,
  CustomBlending,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  PlaneGeometry,
  Vector3,
  VisibilityState,
  ZeroFactor,
} from '@iwsdk/core';
import { buildMoth, MothRig } from './silhouettes.js';
import { Moth, MothModes, StoryState, StoryStatuses } from './shadowplay-components.js';
import { handRuntime, stageRuntime } from './stage-runtime.js';

const INDEX_TIP = 9;
/** Mo in the room: about a real moth's size (wingspan, metres). */
const SIZE = 0.075;
/** Seconds to fly from the wall to the fingertip (and back). */
const FLIGHT = 1.5;
/** Seconds she perches on the fingertip when she first arrives. */
const PERCH = 3.5;
/** At goodnight she stays this long on the fingertip, asleep, before fading. */
const SLEEP = 6;
/** Just above the fingertip. */
const ABOVE = 0.022;

type Phase = 'idle' | 'out' | 'perch' | 'back' | 'sleep';

/** For tests: what Mo is doing, and how far she is from the fingertip (metres). */
export const moVisitRuntime = { phase: 'idle' as Phase, visits: 0, fromTip: -1 };

function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffcf80');
  grad.addColorStop(0.35, '#7a4a14');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * Mo comes to you. When she first comes to follow your finger, she leaves the
 * wall as a small glowing moth in the room, flies to your real index
 * fingertip and perches there (following your finger) for a few seconds, which
 * counts toward following you, then flies back onto the wall. At the end of a
 * story she comes to your fingertip again and falls asleep there. In the
 * headset only, and only with a hand in view; otherwise she stays on the wall.
 */
export class MoVisitSystem extends createSystem({
  moths: { required: [Moth] },
  stories: { required: [StoryState] },
}) {
  private group = new Group();
  private fill = new MeshBasicMaterial({ color: 0xffc870, transparent: true, opacity: 0 });
  private glowMat = new MeshBasicMaterial({
    map: glowTexture(),
    transparent: true,
    depthWrite: false,
    // Light added without touching alpha, so passthrough shows through around her.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  private rig!: MothRig;
  private entity: Entity | undefined;
  private phase: Phase = 'idle';
  private t = 0;
  private flap = 0;
  private time = 0;
  private side: 'left' | 'right' = 'right';
  private from = new Vector3();
  private to = new Vector3();
  private control = new Vector3();
  private tip = new Vector3();
  private head = new Vector3();
  private a = new Vector3();
  private b = new Vector3();

  init(): void {
    this.rig = buildMoth(this.fill);
    this.rig.root.scale.setScalar(SIZE);
    const glow = new Mesh(new PlaneGeometry(SIZE * 3, SIZE * 3), this.glowMat);
    glow.name = 'mo-visit-glow';
    glow.position.z = -0.002;
    this.group.add(glow, this.rig.root);
    this.group.name = 'mo-visit';
    this.group.visible = false;
    this.entity = this.world.createTransformEntity(this.group);
    this.cleanupFuncs.push(() => {
      this.fill.dispose();
      this.glowMat.map?.dispose();
      this.glowMat.dispose();
      glow.geometry.dispose();
      this.entity?.dispose();
    });
  }

  update(delta: number): void {
    this.time += delta;
    const moth = this.queries.moths.entities.values().next().value as Entity | undefined;
    const story = this.queries.stories.entities.values().next().value as Entity | undefined;
    const inXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const mode = moth?.getValue(Moth, 'mode') ?? '';
    const status = story?.getValue(StoryState, 'status') ?? '';

    // When to come: once while she follows your finger (as soon as a hand is in view), and at the end of a story.
    if (mode !== MothModes.Following) this.visitedThisFollow = false;
    const atEnd = stageRuntime.atEnd || status === StoryStatuses.Ended;
    if (!atEnd) this.sleptThisEnd = false;
    if (this.phase === 'idle' && inXR && stageRuntime.ready && this.handInView()) {
      if (mode === MothModes.Following && !this.visitedThisFollow) {
        this.visitedThisFollow = true;
        this.start(false);
      } else if (atEnd && !this.sleptThisEnd) {
        this.sleptThisEnd = true;
        this.start(true);
      }
    }
    if (this.phase === 'idle' || !inXR) {
      if (this.phase !== 'idle') this.finish();
      return;
    }

    const hand = handRuntime[this.side];
    if (hand.tracked) this.tipOf(this.tip);
    this.t += delta;
    let opacity = 1;
    let flapRate = 14;
    switch (this.phase) {
      case 'out': {
        this.flightPath(this.t / FLIGHT, this.tip);
        if (this.t >= FLIGHT) this.next(this.sleeping ? 'sleep' : 'perch');
        break;
      }
      case 'perch': {
        this.group.position.lerp(this.a.copy(this.tip).addScaledVector(stageRuntime.up, ABOVE), Math.min(1, delta * 12));
        flapRate = 2.2;
        // Perching on your finger counts toward following you.
        if (moth && mode === MothModes.Following) moth.setValue(Moth, 'followedSeconds', (moth.getValue(Moth, 'followedSeconds') ?? 0) + delta);
        if (this.t >= PERCH || !hand.tracked) {
          this.from.copy(this.group.position);
          this.next('back');
        }
        break;
      }
      case 'back': {
        this.flightPath(this.t / FLIGHT, stageRuntime.moWall);
        if (this.t >= FLIGHT) return this.finish();
        break;
      }
      case 'sleep': {
        this.group.position.lerp(this.a.copy(this.tip).addScaledVector(stageRuntime.up, ABOVE), Math.min(1, delta * 12));
        flapRate = 0.6;
        opacity = Math.max(0, 1 - Math.max(0, this.t - (SLEEP - 1.5)) / 1.5);
        if (this.t >= SLEEP || !hand.tracked) return this.finish();
        break;
      }
    }
    // Wings, a little wobble, always facing you.
    this.flap += delta * flapRate;
    const fold = this.phase === 'sleep' ? 0.3 : 0.35 + 0.65 * Math.abs(Math.cos(this.flap));
    this.rig.wingRight.scale.x = fold;
    this.rig.wingLeft.scale.x = -fold;
    this.player.head.getWorldPosition(this.head);
    this.group.lookAt(this.head);
    this.fill.opacity = opacity;
    this.glowMat.color.setScalar(0.9 * opacity * (0.85 + 0.15 * Math.sin(this.time * 3)));
    moVisitRuntime.phase = this.phase;
    moVisitRuntime.fromTip = Math.round(this.group.position.distanceTo(this.tip) * 1000) / 1000;
  }

  private sleeping = false;
  private visitedThisFollow = false;
  private sleptThisEnd = false;

  private handInView(): boolean {
    if (handRuntime.right.tracked) this.side = 'right';
    else if (handRuntime.left.tracked) this.side = 'left';
    else return false;
    return true;
  }

  private tipOf(out: Vector3): Vector3 {
    const j = handRuntime[this.side].joints;
    return out.set(j[INDEX_TIP * 3], j[INDEX_TIP * 3 + 1], j[INDEX_TIP * 3 + 2]);
  }

  private start(sleeping: boolean): void {
    this.sleeping = sleeping;
    this.from.copy(stageRuntime.moWall);
    this.tipOf(this.tip);
    this.group.position.copy(this.from);
    this.group.visible = true;
    stageRuntime.moAway = true;
    moVisitRuntime.visits++;
    this.next('out');
  }

  private next(phase: Phase): void {
    this.phase = phase;
    this.t = 0;
    moVisitRuntime.phase = phase;
  }

  private finish(): void {
    this.phase = 'idle';
    this.group.visible = false;
    stageRuntime.moAway = false;
    moVisitRuntime.phase = 'idle';
    moVisitRuntime.fromTip = -1;
  }

  /** A gentle arc from `from` to `target` (it may move): up and toward the room, then down onto it. */
  private flightPath(k: number, target: Vector3): void {
    const s = Math.min(1, Math.max(0, k));
    const e = s * s * (3 - 2 * s);
    this.control
      .addVectors(this.from, target)
      .multiplyScalar(0.5)
      .addScaledVector(stageRuntime.up, 0.25)
      .addScaledVector(stageRuntime.normal, 0.15);
    // Quadratic Bezier: (1-e)^2 from + 2e(1-e) control + e^2 target.
    this.a.copy(this.from).multiplyScalar((1 - e) * (1 - e));
    this.b.copy(this.control).multiplyScalar(2 * e * (1 - e));
    this.group.position.copy(this.a).add(this.b).addScaledVector(target, e * e);
  }
}
