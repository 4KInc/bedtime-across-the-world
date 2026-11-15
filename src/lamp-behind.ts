import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D, Vector3 } from '@iwsdk/core';
import { handRuntime, stageRuntime } from './stage-runtime.js';

/**
 * The lamp is behind you. In shadow theatre the light is behind the storyteller
 * and the screen in front, with the hands in between. With the lamp on the desk
 * 30 cm in front of the viewer, a hand had to reach past the bulb and hit a
 * window about 14 x 9 cm for its shadow to land on the stage (Quest 3, Nov 15:
 * hands in the light ~15% of the time). With the bulb 65 cm behind the eyes and
 * a little low, about 80% of natural hand positions (25-50 cm ahead, chest to
 * eye height) throw their shadow onto the stage, at a natural 2.6x.
 *
 * Positions are relative to the viewer's eyes: behind (m, away from the stage),
 * below the eyes (m), and to the right (m).
 */
export const LIGHT_BEHIND = 0.65;
export const LIGHT_BELOW = 0.28;
export const LIGHT_SIDE = 0.12;
/** Where people hold their hands, in front of the eyes (m): the light is aimed through here. */
export const NATURAL_HAND = 0.42;
/** Calibration: hand samples gathered (about 2 s at 72 Hz) before the light is aimed at them. */
const CALIBRATION_SAMPLES = 150;
/** Limits for the calibrated light, relative to the eyes (it must stay a believable lamp behind you). */
const LIGHT_MIN_BELOW = 0.05;
const LIGHT_MAX_BELOW = 0.55;
const LIGHT_MAX_SIDE = 0.4;
/** The calibrated light settles in over about this long (s). */
const SETTLE_SECONDS = 1;

/** For tests: whether the light has been aimed at this viewer's hands, and where it is (relative to the eyes). */
export const lampBehindRuntime = { calibrated: false, behind: 0, below: 0, side: 0 };

const ink = new MeshStandardMaterial({ color: 0x1b1822, roughness: 0.6, metalness: 0.2 });
const brass = new MeshStandardMaterial({ color: 0xb8863b, roughness: 0.35, metalness: 0.8 });

/** The default light position behind the viewer: `eye`, the direction to the stage (`toStage`), up and right. */
export function lightHome(eye: Vector3, toStage: Vector3, up: Vector3, right: Vector3, out: Vector3): Vector3 {
  return out.copy(eye).addScaledVector(toStage, -LIGHT_BEHIND).addScaledVector(up, -LIGHT_BELOW).addScaledVector(right, LIGHT_SIDE);
}

/**
 * A natural place for a hand: `NATURAL_HAND` in front of the eyes, on the line
 * from the bulb to `target` (the stage centre by default). Test tools (the demo
 * player, webcam hands, the recognition lab) hold their hands here.
 */
export function naturalHandPoint(out: Vector3, target: Vector3 = stageRuntime.center): Vector3 {
  const e = stageRuntime.eye;
  const n = stageRuntime.normal;
  const fwd = (p: Vector3) => -((p.x - e.x) * n.x + (p.y - e.y) * n.y + (p.z - e.z) * n.z);
  const b = fwd(stageRuntime.bulb);
  const t = fwd(target);
  const k = t - b > 1e-3 ? Math.min(0.9, Math.max(0.05, (NATURAL_HAND - b) / (t - b))) : 0.22;
  return out.copy(stageRuntime.bulb).lerp(target, k);
}

/**
 * The lamp's place behind the viewer: a small side table it stands on, a switch
 * on the desk where the lamp used to be (pinch it to pause, as before), and the
 * calibration that aims the light through the viewer's own hands.
 */
export class LampRig {
  readonly table = new Group();
  readonly deskSwitch = new Group();
  /** Where the bulb goes (world), and where calibration is moving it to. */
  readonly bulb = new Vector3();
  private target = new Vector3();
  /** The bulb's position in the lamp's own frame (found once from the model). */
  private offset = new Vector3();
  private hasOffset = false;
  private samples = new Float32Array(CALIBRATION_SAMPLES * 3);
  private count = 0;
  private sorted = new Float32Array(CALIBRATION_SAMPLES);
  private palm = new Vector3();
  private v = new Vector3();
  private meshes: Mesh[] = [];

  constructor() {
    const part = (geo: CylinderGeometry, mat: MeshStandardMaterial, name: string, parent: Group) => {
      const m = new Mesh(geo, mat);
      m.name = name;
      parent.add(m);
      this.meshes.push(m);
      return m;
    };
    part(new CylinderGeometry(0.17, 0.17, 0.02, 32), ink, 'side-table-top', this.table).position.y = -0.01;
    part(new CylinderGeometry(0.022, 0.026, 1, 12), brass, 'side-table-leg', this.table);
    part(new CylinderGeometry(0.13, 0.14, 0.015, 28), ink, 'side-table-foot', this.table);
    this.table.name = 'lamp-side-table';
    part(new CylinderGeometry(0.03, 0.034, 0.012, 24), ink, 'desk-switch-base', this.deskSwitch).position.y = 0.006;
    part(new CylinderGeometry(0.014, 0.014, 0.012, 20), brass, 'desk-switch-button', this.deskSwitch).position.y = 0.018;
    this.deskSwitch.name = 'desk-switch';
  }

  /** Where the bulb sits in the lamp model (its 'lamp-bulb-anchor'), measured once. */
  measure(lampObj: Object3D): void {
    if (this.hasOffset) return;
    const anchor = lampObj.getObjectByName('lamp-bulb-anchor');
    if (!anchor) return;
    lampObj.updateMatrixWorld(true);
    anchor.getWorldPosition(this.offset);
    lampObj.worldToLocal(this.offset);
    this.hasOffset = true;
  }

  /** A new placement: the light behind the viewer (uncalibrated), the switch on the desk. */
  place(eye: Vector3, toStage: Vector3, up: Vector3, right: Vector3, switchAt: Vector3): void {
    lightHome(eye, toStage, up, right, this.target);
    this.bulb.copy(this.target);
    this.deskSwitch.position.copy(switchAt);
    this.count = 0;
    lampBehindRuntime.calibrated = false;
  }

  /** Anchor corrections move everything as one piece. */
  shift(fix: import('@iwsdk/core').Matrix4): void {
    this.bulb.applyMatrix4(fix);
    this.target.applyMatrix4(fix);
    this.deskSwitch.position.applyMatrix4(fix);
  }

  /**
   * Each frame: gather the viewer's natural hand position until the light can be
   * aimed through it (once per placement, in the headset), settle the bulb there,
   * and stand the lamp (facing `aim`) on its side table with the bulb in place.
   */
  update(lampObj: Object3D, eye: Vector3, toStage: Vector3, up: Vector3, right: Vector3, aim: Vector3, delta: number, calibrate: boolean): void {
    if (calibrate && !lampBehindRuntime.calibrated) this.sample(eye, toStage, up, right);
    this.bulb.lerp(this.target, Math.min(1, (delta * 3) / SETTLE_SECONDS));

    const yaw = Math.atan2(-(aim.x - this.bulb.x), -(aim.z - this.bulb.z));
    lampObj.rotation.set(0, yaw, 0);
    this.v.copy(this.offset).applyAxisAngle(Y_AXIS, yaw);
    lampObj.position.copy(this.bulb).sub(this.v);

    // The side table under it, from the floor (local-floor: y = 0) to the lamp's base.
    const floorY = eye.y > 1 ? 0 : eye.y - 1.15;
    const h = Math.max(0.2, lampObj.position.y - floorY);
    this.table.position.set(lampObj.position.x, floorY, lampObj.position.z);
    const [top, leg, foot] = this.table.children;
    top.position.y = h - 0.01;
    leg.scale.y = h;
    leg.position.y = h / 2;
    foot.position.y = 0.0075;

    this.v.subVectors(this.bulb, eye);
    lampBehindRuntime.behind = Math.round(-this.v.dot(toStage) * 100) / 100;
    lampBehindRuntime.below = Math.round(-this.v.dot(up) * 100) / 100;
    lampBehindRuntime.side = Math.round(this.v.dot(right) * 100) / 100;
  }

  /** Hands held up in front (15-80 cm ahead, near eye height): sampled until there are enough, then the light is aimed. */
  private sample(eye: Vector3, toStage: Vector3, up: Vector3, right: Vector3): void {
    for (const side of ['left', 'right'] as const) {
      const hand = handRuntime[side];
      if (!hand.tracked || this.count >= CALIBRATION_SAMPLES) continue;
      const j = hand.joints;
      this.palm.set((j[0] + j[33]) * 0.5, (j[1] + j[34]) * 0.5, (j[2] + j[35]) * 0.5).sub(eye);
      const f = this.palm.dot(toStage);
      const u = this.palm.dot(right);
      const v = this.palm.dot(up);
      if (f < 0.15 || f > 0.8 || Math.abs(u) > 0.4 || v < -0.5 || v > 0.3) continue;
      this.samples[this.count * 3] = u;
      this.samples[this.count * 3 + 1] = v;
      this.samples[this.count * 3 + 2] = f;
      this.count++;
    }
    if (this.count < CALIBRATION_SAMPLES) return;
    const u = this.median(0);
    const v = this.median(1);
    const f = this.median(2);
    // The light goes behind the viewer on the line from the stage centre through their hands.
    this.palm.copy(eye).addScaledVector(right, u).addScaledVector(up, v).addScaledVector(toStage, f);
    this.v.subVectors(stageRuntime.center, this.palm).normalize();
    const along = this.v.dot(toStage);
    if (along < 0.2) return;
    const s = (f + LIGHT_BEHIND) / along;
    this.v.multiplyScalar(-s).add(this.palm).sub(eye);
    const below = Math.min(LIGHT_MAX_BELOW, Math.max(LIGHT_MIN_BELOW, -this.v.dot(up)));
    const side = Math.min(LIGHT_MAX_SIDE, Math.max(-LIGHT_MAX_SIDE, this.v.dot(right)));
    this.target.copy(eye).addScaledVector(toStage, -LIGHT_BEHIND).addScaledVector(up, -below).addScaledVector(right, side);
    lampBehindRuntime.calibrated = true;
  }

  private median(k: number): number {
    for (let i = 0; i < CALIBRATION_SAMPLES; i++) this.sorted[i] = this.samples[i * 3 + k];
    this.sorted.sort();
    return this.sorted[CALIBRATION_SAMPLES >> 1];
  }

  dispose(): void {
    for (const m of this.meshes) m.geometry.dispose();
  }
}

const Y_AXIS = new Vector3(0, 1, 0);
