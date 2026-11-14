import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  createSystem,
  Entity,
  Points,
  PointsMaterial,
  Vector3,
} from '@iwsdk/core';
import { accessRuntime, stageRuntime } from './stage-runtime.js';

/** Fireflies alive at once (one draw call for all of them). */
const POOL = 48;
/** How many leave the wall for each creature that wakes. */
const PER_WAKE = 12;
/** Seconds a firefly lives, at least and at most. */
const LIFE_MIN = 3.2;
const LIFE_MAX = 5.0;
/** Speed off the wall toward the room (m/s), and the sideways and upward drift. */
const OUT_SPEED = [0.12, 0.3] as const;
const DRIFT = 0.08;
const RISE = 0.04;
/** Size of a firefly's glow, metres (it gets smaller with distance, like a real light). */
const SIZE = 0.07;
const WARM = new Color(0xffd27a);

/** For tests: fireflies in the air now, and in total. */
export const fireflyRuntime = { active: 0, released: 0, furthest: 0 };

/** A soft round glow, drawn once. */
function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/**
 * Fireflies: when a creature wakes, a handful of glowing specks in its colour
 * leave the wall and drift out into the room around the storyteller, wobbling
 * like real fireflies, then fade. The stage stops being a flat screen. One
 * Points object for all of them; nothing is allocated per frame. In high
 * contrast they are plain warm white.
 */
export class FireflySystem extends createSystem({}) {
  private positions = new Float32Array(POOL * 3);
  private colours = new Float32Array(POOL * 3);
  private velocity = new Float32Array(POOL * 3);
  private age = new Float32Array(POOL);
  private life = new Float32Array(POOL);
  private phase = new Float32Array(POOL);
  /** The colour each firefly glows at full brightness (it fades by scaling this). */
  private base = new Float32Array(POOL * 3);
  private geometry = new BufferGeometry();
  private material = new PointsMaterial({
    size: SIZE,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  private points = new Points(this.geometry, this.material);
  private entity: Entity | undefined;
  private seenWakes = 0;
  private next = 0;
  private time = 0;
  private colour = new Color();
  private side = new Vector3();

  init(): void {
    this.material.map = glowTexture();
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new BufferAttribute(this.colours, 3));
    this.points.name = 'fireflies';
    this.points.frustumCulled = false;
    this.points.renderOrder = 30;
    this.points.visible = false;
    this.entity = this.world.createTransformEntity(this.points);
    this.seenWakes = stageRuntime.wakes;
    this.cleanupFuncs.push(() => {
      this.geometry.dispose();
      this.material.map?.dispose();
      this.material.dispose();
      this.entity?.dispose();
    });
  }

  update(delta: number): void {
    this.time += delta;
    if (stageRuntime.wakes !== this.seenWakes) {
      this.seenWakes = stageRuntime.wakes;
      if (stageRuntime.ready) this.release();
    }
    let active = 0;
    let furthest = 0;
    const c = stageRuntime.center;
    const n = stageRuntime.normal;
    const p = this.positions;
    const v = this.velocity;
    for (let i = 0; i < POOL; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += delta;
      const t = this.age[i] / this.life[i];
      if (t >= 1) {
        this.life[i] = 0;
        this.colours[i * 3] = this.colours[i * 3 + 1] = this.colours[i * 3 + 2] = 0;
        continue;
      }
      active++;
      // Slow down as they leave the wall; wobble like fireflies.
      const slow = 1 - 0.6 * t;
      const w = this.time * 2.3 + this.phase[i];
      p[i * 3] += (v[i * 3] * slow + Math.sin(w) * 0.03) * delta;
      p[i * 3 + 1] += (v[i * 3 + 1] * slow + Math.cos(w * 1.3) * 0.02) * delta;
      p[i * 3 + 2] += (v[i * 3 + 2] * slow + Math.sin(w * 0.7) * 0.03) * delta;
      // Fade in fast, twinkle, fade out slowly.
      const glow = Math.min(1, t * 8) * (1 - t * t) * (0.8 + 0.2 * Math.sin(w * 3.1)) * 1.4;
      for (let k = 0; k < 3; k++) this.colours[i * 3 + k] = this.base[i * 3 + k] * glow;
      furthest = Math.max(furthest, (p[i * 3] - c.x) * n.x + (p[i * 3 + 1] - c.y) * n.y + (p[i * 3 + 2] - c.z) * n.z);
    }
    fireflyRuntime.active = active;
    fireflyRuntime.furthest = Math.round(furthest * 100) / 100;
    this.points.visible = active > 0;
    if (active > 0) {
      (this.geometry.attributes.position as BufferAttribute).needsUpdate = true;
      (this.geometry.attributes.color as BufferAttribute).needsUpdate = true;
    }
  }

  /** A handful leave the wall where the creature woke, in its colour (warm white in high contrast). */
  private release(): void {
    const n = stageRuntime.normal;
    this.side.crossVectors(n, stageRuntime.up).normalize();
    this.colour.setHex(stageRuntime.wakeColour).lerp(WARM, 0.35);
    if (accessRuntime.highContrast) this.colour.copy(WARM);
    for (let k = 0; k < PER_WAKE; k++) {
      const i = this.next;
      this.next = (this.next + 1) % POOL;
      const spread = (Math.random() - 0.5) * 0.3;
      const lift = (Math.random() - 0.3) * 0.2;
      this.positions[i * 3] = stageRuntime.wakeAt.x + this.side.x * spread + n.x * 0.02;
      this.positions[i * 3 + 1] = stageRuntime.wakeAt.y + lift;
      this.positions[i * 3 + 2] = stageRuntime.wakeAt.z + this.side.z * spread + n.z * 0.02;
      const out = OUT_SPEED[0] + Math.random() * (OUT_SPEED[1] - OUT_SPEED[0]);
      const across = (Math.random() - 0.5) * 2 * DRIFT;
      this.velocity[i * 3] = n.x * out + this.side.x * across;
      this.velocity[i * 3 + 1] = RISE * (0.5 + Math.random());
      this.velocity[i * 3 + 2] = n.z * out + this.side.z * across;
      this.age[i] = 0;
      this.life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
      this.phase[i] = Math.random() * Math.PI * 2;
      this.base[i * 3] = this.colour.r;
      this.base[i * 3 + 1] = this.colour.g;
      this.base[i * 3 + 2] = this.colour.b;
      fireflyRuntime.released++;
    }
  }
}
