import {
  AddEquation,
  Color,
  createSystem,
  CustomBlending,
  Entity,
  Mesh,
  OneFactor,
  PlaneGeometry,
  MeshStandardMaterial,
  ShaderMaterial,
  ZeroFactor,
} from '@iwsdk/core';
import { Scenery, ScenerySets, Stage } from './shadowplay-components.js';
import { accessRuntime, stageRuntime } from './stage-runtime.js';

/** Sky colours per scene (top of the stage, bottom of the stage): light added to the wall, like coloured gels. */
export const SKIES: Readonly<Record<string, readonly [number, number]>> = {
  [ScenerySets.None]: [0x3d3ab0, 0xff8a5c], // indigo night to peach
  [ScenerySets.Field]: [0x5b49d6, 0xffb36b], // violet dusk over a golden field
  [ScenerySets.River]: [0x2f6fd6, 0x9fd4ff], // moonlit blue to silver
  [ScenerySets.Forest]: [0x2f8f6a, 0xffb45a], // deep green to lantern amber
  [ScenerySets.Storm]: [0x6a5acd, 0x8fa3c7], // lilac to slate
  [ScenerySets.Sea]: [0x1f6fb8, 0x2cc5b5], // ocean blue to teal
};
/** How strongly the sky colours the wall at full lamp light (the lamp pool stays warmer and brighter). */
const GAIN = 0.4;
/** The lamp's own warm light; its centre keeps most of it, its edge takes the scene's colour. */
const WARM = new Color(0xffa43a);
/** How much of the scene's colour the lamp light takes at its centre. */
const CENTRE_TINT = 0.3;
/** The paper screen's own colours (stage-visuals.ts), and how much of the sky it takes. */
const PAPER = new Color(0xf1dfbd);
const PAPER_GLOW = new Color(0x3a2814);
const PAPER_TINT = 0.4;
/** Time constant of the cross-fade to a new scene's sky (seconds): about there in three of these. */
const BLEND_SECONDS = 0.7;

/** For tests: the sky's current top colour (hex) and strength. */
export const twilightRuntime = { top: '', bottom: '', intensity: 0 };

/**
 * Twilight on the wall: a soft gradient of coloured light behind the shadows,
 * indigo above and warm below, changing with the story's scene (sea, river,
 * forest...). It is light added to the real wall, not paint over it, so the
 * wall stays real in passthrough; it follows the lamp (off when the lamp is off)
 * and is off in high contrast.
 */
export class TwilightSystem extends createSystem({
  stages: { required: [Stage] },
  scenery: { required: [Scenery] },
}) {
  private material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Like the lamp pool: add light to colour, leave alpha, so passthrough shows through.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
    uniforms: {
      uTop: { value: new Color(SKIES[ScenerySets.None][0]) },
      uBottom: { value: new Color(SKIES[ScenerySets.None][1]) },
      uIntensity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        vec3 sky = mix(uBottom, uTop, smoothstep(0.1, 0.9, vUv.y));
        // Soft edges all round, so it melts into the room.
        vec2 e = smoothstep(vec2(0.0), vec2(0.18), vUv) * smoothstep(vec2(0.0), vec2(0.18), 1.0 - vUv);
        gl_FragColor = vec4(sky * e.x * e.y * uIntensity, 0.0);
      }`,
  });
  private mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
  private attached = false;
  private top = new Color();
  private bottom = new Color();
  private target = [new Color(), new Color()] as const;
  /** The lamp's light pool (stage-visuals.ts), coloured like a gel by the scene. */
  private pool: (Mesh & { material: ShaderMaterial }) | undefined;
  private centre = new Color();
  /** With no wall, the paper screen stands in: its paper takes a little of the scene's colour too. */
  private paper: (Mesh & { material: MeshStandardMaterial }) | undefined;

  init(): void {
    this.mesh.name = 'twilight-sky';
    this.mesh.renderOrder = 0;
    this.mesh.position.z = -0.002;
    this.mesh.frustumCulled = false;
    this.top.copy(this.material.uniforms.uTop.value);
    this.bottom.copy(this.material.uniforms.uBottom.value);
    this.cleanupFuncs.push(() => {
      this.mesh.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
    });
  }

  update(delta: number): void {
    const stage = this.queries.stages.entities.values().next().value as Entity | undefined;
    if (!stage?.object3D) return;
    if (!this.attached) {
      stage.object3D.add(this.mesh);
      this.attached = true;
    }
    this.pool ??= stage.object3D.getObjectByName('light-pool') as (Mesh & { material: ShaderMaterial }) | undefined;
    this.paper ??= stage.object3D.getObjectByName('paper-screen') as (Mesh & { material: MeshStandardMaterial }) | undefined;
    this.mesh.visible = stageRuntime.ready;
    if (!stageRuntime.ready) return;

    const scenery = this.queries.scenery.entities.values().next().value as Entity | undefined;
    const set = (scenery?.getValue(Scenery, 'set') as string | undefined) ?? ScenerySets.None;
    const [top, bottom] = SKIES[set] ?? SKIES[ScenerySets.None];
    this.target[0].setHex(top);
    this.target[1].setHex(bottom);
    const k = Math.min(1, delta / BLEND_SECONDS);
    this.top.lerp(this.target[0], k);
    this.bottom.lerp(this.target[1], k);
    (this.material.uniforms.uTop.value as Color).copy(this.top);
    (this.material.uniforms.uBottom.value as Color).copy(this.bottom);

    // Follows the lamp; a touch brighter at the finale; nothing in high contrast.
    const lamp = stage.getValue(Stage, 'lampOn') ? (stage.getValue(Stage, 'lampLevel') ?? 1) : 0;
    const finale = stage.getValue(Stage, 'finale') ?? 0;
    const contrast = accessRuntime.highContrast;
    const intensity = contrast ? 0 : GAIN * lamp * (1 + 0.6 * finale);
    // The lamp light itself: warm at the centre, the scene's sky toward the edge (plain warm in high contrast).
    if (this.pool) {
      const u = this.pool.material.uniforms;
      (u.uColor.value as Color).copy(contrast ? WARM : this.centre.copy(WARM).lerp(this.bottom, CENTRE_TINT));
      (u.uEdge.value as Color).copy(contrast ? WARM : this.top);
    }
    if (this.paper) {
      this.paper.material.color.copy(PAPER).lerp(this.top, contrast ? 0 : PAPER_TINT);
      this.paper.material.emissive.copy(PAPER_GLOW).lerp(this.bottom, contrast ? 0 : PAPER_TINT * 0.6);
    }
    this.material.uniforms.uIntensity.value = intensity;
    this.mesh.scale.set(stageRuntime.width * 1.25, stageRuntime.height * 1.3, 1);

    twilightRuntime.top = this.top.getHexString();
    twilightRuntime.bottom = this.bottom.getHexString();
    twilightRuntime.intensity = Math.round(intensity * 100) / 100;
  }
}
