import {
  AddEquation,
  Color,
  createSystem,
  CustomBlending,
  Entity,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  RingGeometry,
  ShaderMaterial,
  Vector2,
  Vector3,
  ZeroFactor,
} from '@iwsdk/core';
import { Scenery, ScenerySets, Stage } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';
import { SKIES } from './twilight.js';

/** The window's half-width and half-height when fully open, as fractions of the stage. */
const OPEN_X = 0.48;
const OPEN_Y = 0.5;
/** Its centre, a little above the stage's centre (fraction of the stage height). */
const LIFT = 0.06;
/** How far behind the wall each layer is (metres): near hills, far hills, the sky. */
const NEAR = 0.7;
const FAR = 1.9;
const SKY = 4.5;
const INK = new Color(0x150f22);

/** For tests: how far open the window is (0..1). */
export const wallWindowRuntime = { open: 0 };

const FRAGMENT = /* glsl */ `
  uniform vec3 uCenter;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform vec3 uNormal;
  uniform vec2 uRadii;
  uniform vec3 uDepths;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uFarHills;
  uniform vec3 uNearHills;
  uniform float uTime;
  varying vec3 vWorld;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  // Where the line of sight meets a plane this far behind the wall, in the wall's own (x right, y up) metres.
  vec2 behind(vec3 d, float depth) {
    vec3 c = uCenter - uNormal * depth;
    vec3 p = cameraPosition + d * (dot(c - cameraPosition, uNormal) / dot(d, uNormal));
    return vec2(dot(p - uCenter, uRight), dot(p - uCenter, uUp));
  }

  float ridge(float x, float base, float amp, float seed) {
    return base + amp * (0.6 * sin(x * 1.7 + seed) + 0.3 * sin(x * 4.3 + seed * 2.3) + 0.1 * sin(x * 11.0 + seed * 5.1));
  }

  void main() {
    vec2 w = vec2(dot(vWorld - uCenter, uRight) / uRadii.x, dot(vWorld - uCenter, uUp) / uRadii.y);
    float a = 1.0 - smoothstep(0.86, 1.0, length(w));
    if (a <= 0.0) discard;
    vec3 d = vWorld - cameraPosition;

    vec3 col;
    vec2 n = behind(d, uDepths.x);
    vec2 f = behind(d, uDepths.y);
    if (n.y < ridge(n.x, -0.2, 0.07, 4.2)) {
      col = uNearHills;
    } else if (f.y < ridge(f.x, -0.12, 0.22, 1.3)) {
      col = uFarHills;
    } else {
      vec2 s = behind(d, uDepths.z);
      col = mix(uHorizon, uTop, smoothstep(-0.6, 2.8, s.y));
      vec2 g = s * 12.0;
      vec2 cell = floor(g);
      float h = hash(cell);
      vec2 at = vec2(hash(cell + 1.3), hash(cell + 7.1)) - 0.5;
      float star = step(0.86, h) * smoothstep(0.11, 0.0, length(fract(g) - 0.5 - at * 0.6));
      star *= 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.5) + h * 40.0);
      star *= smoothstep(-0.5, 0.4, s.y);
      col += vec3(1.0, 0.94, 0.82) * star;
    }
    gl_FragColor = vec4(col * a, a);
  }
`;

/**
 * The wall opens: at the story's finale a soft-edged window opens in the wall
 * behind the shadows, into the story's world: rolling hills under a starry sky
 * in the scene's colours. It is drawn on the wall itself, but each point looks
 * along your line of sight to hills and sky at real distances behind the wall,
 * so the view through it shifts as you move your head, like a window. Being on
 * the wall, it stays behind your real hands, the shadows and the creatures. It
 * closes again when the story starts over.
 */
export class WallWindowSystem extends createSystem({
  stages: { required: [Stage] },
  scenery: { required: [Scenery] },
}) {
  private material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Premultiplied: inside the window it covers the passthrough wall; its soft edge blends into it.
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneMinusSrcAlphaFactor,
    uniforms: {
      uCenter: { value: new Vector3() },
      uRight: { value: new Vector3(1, 0, 0) },
      uUp: { value: new Vector3(0, 1, 0) },
      uNormal: { value: new Vector3(0, 0, 1) },
      uRadii: { value: new Vector2(0.001, 0.001) },
      uDepths: { value: new Vector3(NEAR, FAR, SKY) },
      uTop: { value: new Color() },
      uHorizon: { value: new Color() },
      uFarHills: { value: new Color() },
      uNearHills: { value: new Color() },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: FRAGMENT,
  });
  private mesh = new Mesh(new PlaneGeometry(2, 2), this.material);
  private rimMaterial = new MeshBasicMaterial({
    color: 0xffc070,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
  private rim = new Mesh(new RingGeometry(0.95, 1.03, 72), this.rimMaterial);
  private attached = false;
  private time = 0;
  private top = new Color();
  private horizon = new Color();

  init(): void {
    this.mesh.name = 'wall-window';
    this.rim.name = 'window-rim';
    // After the lamp light and the twilight (0), before the shadow surface (1) and everything on it.
    this.mesh.renderOrder = 0.5;
    this.rim.renderOrder = 0.6;
    // Just in front of the paper screen and the wall.
    this.mesh.position.z = 0.0015;
    this.rim.position.z = 0.002;
    this.mesh.frustumCulled = this.rim.frustumCulled = false;
    this.mesh.visible = this.rim.visible = false;
    this.cleanupFuncs.push(() => {
      this.mesh.removeFromParent();
      this.rim.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
      this.rim.geometry.dispose();
      this.rimMaterial.dispose();
    });
  }

  update(delta: number): void {
    this.time += delta;
    const stage = this.queries.stages.entities.values().next().value as Entity | undefined;
    if (!stage?.object3D) return;
    if (!this.attached) {
      stage.object3D.add(this.mesh, this.rim);
      this.attached = true;
    }
    const open = stageRuntime.ready ? (stage.getValue(Stage, 'finale') ?? 0) : 0;
    wallWindowRuntime.open = Math.round(open * 100) / 100;
    const visible = open > 0.002;
    this.mesh.visible = this.rim.visible = visible;
    if (!visible) return;

    const lift = LIFT * stageRuntime.height;
    const rx = OPEN_X * stageRuntime.width * open;
    const ry = OPEN_Y * stageRuntime.height * open;
    this.mesh.position.y = this.rim.position.y = lift;
    this.mesh.scale.set(rx, ry, 1);
    this.rim.scale.set(rx, ry, 1);
    this.rimMaterial.color.setRGB(0.22, 0.15, 0.07).multiplyScalar(open);

    const scenery = this.queries.scenery.entities.values().next().value as Entity | undefined;
    const set = (scenery?.getValue(Scenery, 'set') as string | undefined) ?? ScenerySets.None;
    const [top, bottom] = SKIES[set] ?? SKIES[ScenerySets.None];
    this.top.setHex(top).multiplyScalar(0.4);
    this.horizon.setHex(bottom).lerp(this.top, 0.55).multiplyScalar(0.7);
    const u = this.material.uniforms;
    (u.uTop.value as Color).copy(this.top);
    (u.uHorizon.value as Color).copy(this.horizon);
    (u.uFarHills.value as Color).copy(INK).lerp(this.horizon, 0.4);
    (u.uNearHills.value as Color).copy(INK);
    (u.uCenter.value as Vector3).copy(stageRuntime.center).addScaledVector(stageRuntime.up, lift);
    (u.uRight.value as Vector3).copy(stageRuntime.right);
    (u.uUp.value as Vector3).copy(stageRuntime.up);
    (u.uNormal.value as Vector3).copy(stageRuntime.normal);
    (u.uRadii.value as Vector2).set(rx, ry);
    u.uTime.value = this.time;
  }
}
