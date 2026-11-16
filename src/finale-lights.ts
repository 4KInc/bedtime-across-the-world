import {
  AddEquation,
  CanvasTexture,
  Color,
  CustomBlending,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OneFactor,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  ZeroFactor,
} from '@iwsdk/core';
import { ScenerySets } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';

/**
 * When the story lets its light go (the finale), the light comes home into the
 * scenery, as the lighthouse wakes by the sea: stars come out one by one in an
 * open sky (and through the parting rain clouds), fireflies rise from the
 * meadow, the moon on the river brightens and lays a silver path on the water, and the forest's mushrooms and
 * fireflies glow. Quest 3, Nov 15: most endings released the light onto a wall
 * that did not change.
 *
 * One instanced mesh of soft additive glows (one draw call), in stage units
 * like the other sets (x in stage widths, y in stage heights from the floor).
 */

type Kind = 'sky' | 'field' | 'river' | 'forest';

interface Light {
  x: number;
  y: number;
  /** Radius in stage widths; `stretch` widens it (the river's ripples). */
  size: number;
  stretch: number;
  /** When it lights, as a fraction of the finale, and its own rhythm. */
  delay: number;
  phase: number;
  rate: number;
  color: number;
  /** Fireflies drift; stars and ripples stay. */
  drift: number;
}

const COUNT = 48;
const STAR = 0xfff0c8;
const FIREFLY = 0xffd06a;
const SILVER = 0xcfe0ff;
const MUSHROOM = 0x9ff0d0;

/** The lights for a scenery set, or null when the set has its own finale (sea, moon road, valley, star port). */
export function finaleKind(set: string): Kind | null {
  if (set === ScenerySets.None || set === ScenerySets.Storm) return 'sky';
  if (set === ScenerySets.Field) return 'field';
  if (set === ScenerySets.River) return 'river';
  if (set === ScenerySets.Forest) return 'forest';
  return null;
}

function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * A point in the sky the wall opens onto at the finale (wall-window.ts: an
 * ellipse 0.48 by 0.5 of the stage, centred 0.06 above its middle), kept inside its rim.
 */
function inWindow(x: number, y: number): boolean {
  return (x / 0.42) ** 2 + ((y - 0.56) / 0.44) ** 2 < 1;
}

/** A random point of open sky above `minY`, inside the window. */
function skyPoint(rand: () => number, minY: number): [number, number] {
  for (;;) {
    const x = rand() * 0.84 - 0.42;
    const y = minY + rand() * (1 - minY);
    if (inWindow(x, y)) return [x, y];
  }
}

function layout(kind: Kind): Light[] {
  const rand = makeRandom({ sky: 3, field: 5, river: 7, forest: 11 }[kind]);
  const out: Light[] = [];
  for (let i = 0; i < COUNT; i++) {
    // Each lights in turn through the first 80% of the finale, in a scattered order.
    const delay = 0.04 + 0.76 * ((i * 29) % COUNT) / COUNT;
    const base = { delay, phase: rand() * Math.PI * 2, rate: 0.8 + rand() * 1.6, stretch: 1, drift: 0 };
    if (kind === 'sky') {
      const [x, y] = skyPoint(rand, 0.36);
      out.push({ ...base, x, y, size: 0.004 + rand() * rand() * 0.009, color: STAR });
    } else if (kind === 'field') {
      out.push({ ...base, x: rand() * 1.1 - 0.55, y: 0.06 + rand() * 0.42, size: 0.005 + rand() * 0.004, color: FIREFLY, drift: 1 });
    } else if (kind === 'river') {
      if (i < 26) {
        // The moon's path: shimmering ripples from the water up toward the moon (x 0.34, y 0.8), narrowing with distance.
        const y = 0.08 + (i / 26) * 0.42;
        const spread = 0.02 + (0.5 - y) * 0.22;
        out.push({ ...base, x: 0.34 + (rand() - 0.5) * spread, y, size: 0.006 + rand() * 0.004, stretch: 4 + rand() * 4, color: SILVER, delay: 0.04 + 0.6 * (1 - i / 26) });
      } else if (i < 28) {
        // The moon itself brightens: a wide soft halo.
        out.push({ ...base, x: 0.34, y: 0.8, size: i === 26 ? 0.03 : 0.05, rate: 0.3, color: SILVER, delay: 0.02 });
      } else {
        const [x, y] = skyPoint(rand, 0.45);
        out.push({ ...base, x, y, size: 0.004 + rand() * 0.005, color: STAR });
      }
    } else {
      const left = i % 2 === 0;
      const x = left ? -0.58 + rand() * 0.22 : 0.42 + rand() * 0.18;
      if (i < 14) out.push({ ...base, x, y: 0.012 + rand() * 0.025, size: 0.006 + rand() * 0.005, color: MUSHROOM });
      else out.push({ ...base, x, y: 0.08 + rand() * 0.55, size: 0.006 + rand() * 0.004, color: FIREFLY, drift: 1 });
    }
  }
  return out;
}

/** The lights showing now ('' for none) and how lit they are (0..1): for tests and diagnostics. */
export const finaleLightsRuntime = { kind: '', lit: 0 };

export interface FinaleLights {
  group: Group;
  update(time: number, delta: number, set: string, finale: number): void;
  dispose(): void;
}

/** A soft round glow (white at the centre to nothing at the edge), drawn once. */
function glowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, '#bbbbbb');
  grad.addColorStop(0.6, '#2a2a2a');
  grad.addColorStop(1, '#000000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function buildFinaleLights(): FinaleLights {
  const group = new Group();
  group.name = 'scenery-finale-lights';
  const map = glowTexture();
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    map,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  // A glow is drawn about three times the light's radius (the soft edge).
  const geometry = new PlaneGeometry(6, 6);
  const mesh = new InstancedMesh(geometry, material, COUNT);
  mesh.name = 'scenery-finale-lights-glows';
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  group.add(mesh);
  group.visible = false;

  const layouts: Record<Kind, Light[]> = { sky: layout('sky'), field: layout('field'), river: layout('river'), forest: layout('forest') };
  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const c = new Color();
  for (let i = 0; i < COUNT; i++) mesh.setColorAt(i, c.setRGB(0, 0, 0));
  const state = finaleLightsRuntime;
  /** The lights showing: kept through a finale so a scenery change does not swap them mid-glow. */
  let kind: Kind | null = null;
  let level = 0;

  return {
    group,
    update(time, delta, set, finale) {
      if (finale <= 0.001) kind = finaleKind(set);
      const target = kind ? finale : 0;
      // Up with the finale; down gently when a new story clears it.
      level = target >= level ? target : Math.max(target, level - delta * 0.5);
      group.visible = level > 0.002 && kind !== null;
      state.kind = group.visible && kind ? kind : '';
      state.lit = Math.round(level * 100) / 100;
      if (!group.visible || !kind) return;
      const lights = layouts[kind];
      const aspect = stageRuntime.width / Math.max(0.01, stageRuntime.height);
      for (let i = 0; i < COUNT; i++) {
        const l = lights[i];
        const on = Math.max(0, Math.min(1, (level - l.delay) / 0.15));
        const pulse = l.drift ? 0.35 + 0.65 * Math.max(0, Math.sin(time * l.rate + l.phase)) : 0.7 + 0.3 * Math.sin(time * l.rate + l.phase);
        // Fireflies rise from the grass as they light, then wander.
        const rise = l.drift ? (1 - on) * -0.08 : 0;
        const dx = l.drift ? Math.sin(time * 0.35 * l.rate + l.phase) * 0.025 : 0;
        const dy = l.drift ? Math.sin(time * 0.5 * l.rate + l.phase * 1.7) * 0.03 : 0;
        const r = l.size * (0.5 + 0.5 * on);
        m.compose(p.set(l.x + dx, Math.max(0.005, l.y + dy + rise), 0), q, s.set(r * l.stretch, r * aspect, 1));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, c.setHex(l.color).multiplyScalar(on * pulse * 1.4));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      map.dispose();
    },
  };
}
