import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  createSystem,
  CustomBlending,
  CylinderGeometry,
  DoubleSide,
  Entity,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OneFactor,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  TorusGeometry,
  Vector3,
  VisibilityState,
  ZeroFactor,
} from '@iwsdk/core';
import { Keepsake, loadKeepsakes, saveKeepsakes } from './journal-store.js';
import { ShadowJournal } from './shadowplay-components.js';
import { accessRuntime, stageRuntime } from './stage-runtime.js';
import { storyRuntime } from './story-script.js';

/** The jar: radius and height (metres), beside the Shadow Journal on the desk. */
const RADIUS = 0.034;
const HEIGHT = 0.085;
/** Where it stands, in the book's own frame (the book is 0.15 x 0.21, its spine along -X). */
const BESIDE_BOOK = new Vector3(-0.14, 0, -0.07);
/** Stars shown in the jar (the most recent); all are kept. */
const SHOWN = 40;
const KEPT = 500;
/** Seconds for a new star to rise off the wall and float into the jar. */
const FLIGHT = 2.6;
/** Seconds the count stays up after a star arrives. */
const LABEL_SECONDS = 5;
const STAR_SIZE = 0.02;
const WARM = new Color(0xffd27a);

/** For tests: stars kept, one flying now, and the label's text while it shows. */
export const keepsakeRuntime = { count: 0, flying: false, label: '', loaded: false, jar: new Vector3() };

/** Light added without touching alpha, so passthrough shows through (see fireflies.ts). */
function addLight(params: ConstructorParameters<typeof MeshBasicMaterial>[0] = {}): MeshBasicMaterial {
  return new MeshBasicMaterial({
    ...params,
    transparent: true,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: ZeroFactor,
    blendDstAlpha: OneFactor,
  });
}

/** A soft five-pointed star, drawn in colour (white on black), since it is added as light. */
function starTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 64);
  const glow = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  glow.addColorStop(0, '#666');
  glow.addColorStop(1, '#000');
  g.fillStyle = glow;
  g.fillRect(0, 0, 64, 64);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 26 : 11;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    g.lineTo(32 + r * Math.cos(a), 32 + r * Math.sin(a));
  }
  g.closePath();
  g.fillStyle = '#fff';
  g.fill();
  return new CanvasTexture(c);
}

/** A fixed spot inside the jar for the i-th star, so the jar looks the same every night. */
function spot(i: number, out: Vector3): Vector3 {
  const golden = 2.399963;
  const r = RADIUS * 0.7 * Math.sqrt(((i * 0.61803) % 1) * 0.85 + 0.15);
  const a = i * golden;
  return out.set(Math.cos(a) * r, HEIGHT * (0.15 + 0.7 * ((i * 0.3819 + 0.1) % 1)), Math.sin(a) * r);
}

/**
 * Keepsake stars: a small glass jar on the desk beside the Shadow Journal. Each
 * story told to the end leaves a star, in the colour of the last creature
 * woken, which rises off the wall and floats into the jar. The stars are kept
 * (journal store) and the jar stands with the anchored stage, so they are
 * there again the next night: a quiet count of bedtimes told. In the headset
 * only. In high contrast
 * the stars are plain warm white.
 */
export class KeepsakeSystem extends createSystem({
  journals: { required: [ShadowJournal] },
}) {
  private stars: Keepsake[] = [];
  private jar = new Group();
  private glass = addLight({ color: 0x1a2634, side: DoubleSide });
  private rim = addLight({ color: 0x40556a });
  private lid = new MeshStandardMaterial({ color: 0x8a6446, roughness: 0.9 });
  private positions = new Float32Array(SHOWN * 3);
  private colours = new Float32Array(SHOWN * 3);
  private base = new Float32Array(SHOWN * 3);
  private starGeometry = new BufferGeometry();
  private starMaterial = new PointsMaterial({ size: STAR_SIZE, sizeAttenuation: true, vertexColors: true });
  private points = new Points(this.starGeometry, this.starMaterial);
  /** The star on its way from the wall to the jar (world space). */
  private flyer = new Mesh(new PlaneGeometry(STAR_SIZE * 2.2, STAR_SIZE * 2.2), addLight());
  private label = this.makeLabel();
  private entities: Entity[] = [];
  private wasAtEnd = false;
  private flight = -1;
  private labelFor = 0;
  private time = 0;
  private from = new Vector3();
  private to = new Vector3();
  private head = new Vector3();
  private v = new Vector3();
  private colour = new Color();
  private bookQ = new Quaternion();
  private pending: Keepsake | null = null;
  private contrast = false;

  init(): void {
    const parts: Mesh[] = [
      new Mesh(new CylinderGeometry(RADIUS, RADIUS * 0.94, HEIGHT, 28, 1, true), this.glass),
      new Mesh(new TorusGeometry(RADIUS * 0.86, 0.003, 8, 28), this.rim),
      new Mesh(new CylinderGeometry(RADIUS * 0.8, RADIUS * 0.84, 0.016, 20), this.lid),
    ];
    parts[0].position.y = HEIGHT / 2;
    parts[1].rotation.x = Math.PI / 2;
    parts[1].position.y = HEIGHT;
    parts[2].position.y = HEIGHT + 0.008;
    parts[0].name = 'keepsake-glass';
    parts[2].name = 'keepsake-lid';
    this.starMaterial.map = starTexture();
    Object.assign(this.starMaterial, {
      transparent: true, depthWrite: false, blending: CustomBlending, blendEquation: AddEquation,
      blendSrc: OneFactor, blendDst: OneFactor, blendSrcAlpha: ZeroFactor, blendDstAlpha: OneFactor,
    });
    this.starGeometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.starGeometry.setAttribute('color', new BufferAttribute(this.colours, 3));
    this.starGeometry.setDrawRange(0, 0);
    this.points.name = 'keepsake-stars';
    this.points.frustumCulled = false;
    this.jar.add(...parts, this.points, this.label.mesh);
    this.jar.name = 'keepsake-jar';
    this.jar.visible = false;
    (this.flyer.material as MeshBasicMaterial).map = this.starMaterial.map;
    this.flyer.name = 'keepsake-flyer';
    this.flyer.visible = false;
    this.entities.push(this.world.createTransformEntity(this.jar), this.world.createTransformEntity(this.flyer));
    void loadKeepsakes().then((stars) => {
      this.stars = stars.concat(this.stars);
      keepsakeRuntime.loaded = true;
      this.fill();
    });
    this.cleanupFuncs.push(() => {
      for (const p of parts) p.geometry.dispose();
      for (const m of [this.glass, this.rim, this.lid, this.flyer.material as MeshBasicMaterial, this.label.mesh.material]) m.dispose();
      this.starMaterial.map?.dispose();
      this.starMaterial.dispose();
      this.starGeometry.dispose();
      this.flyer.geometry.dispose();
      this.label.mesh.geometry.dispose();
      this.label.texture.dispose();
      for (const e of this.entities) e.dispose();
    });
  }

  update(delta: number): void {
    this.time += delta;
    keepsakeRuntime.count = this.stars.length;
    const book = (this.queries.journals.entities.values().next().value as Entity | undefined)?.object3D;
    // On the desk in the headset only (the family viewer on a phone has no desk).
    const inXR = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (!book || !stageRuntime.ready || !inXR) {
      this.jar.visible = false;
      this.wasAtEnd = stageRuntime.atEnd;
      return;
    }
    // Beside the book, turned with it (so it stays on the anchored desk with the stage).
    book.getWorldPosition(this.v);
    book.getWorldQuaternion(this.bookQ);
    this.jar.position.copy(BESIDE_BOOK).applyQuaternion(this.bookQ).add(this.v);
    this.jar.quaternion.copy(this.bookQ);
    this.jar.visible = true;
    this.player.head.getWorldPosition(this.head);

    // A story told to the end: a star leaves the wall for the jar.
    if (stageRuntime.atEnd && !this.wasAtEnd && this.flight < 0) this.award();
    this.wasAtEnd = stageRuntime.atEnd;

    if (this.flight >= 0) this.fly(delta);
    if (accessRuntime.highContrast !== this.contrast) this.fill();

    // The stars twinkle softly.
    const shown = Math.min(SHOWN, this.stars.length);
    for (let i = 0; i < shown; i++) {
      const tw = 0.7 + 0.3 * Math.sin(this.time * 1.7 + i * 1.3);
      for (let k = 0; k < 3; k++) this.colours[i * 3 + k] = this.base[i * 3 + k] * tw;
    }
    if (shown > 0) (this.starGeometry.attributes.color as BufferAttribute).needsUpdate = true;

    // The count, for a few seconds after a star arrives.
    const mesh = this.label.mesh;
    mesh.visible = this.labelFor > 0;
    if (this.labelFor > 0) {
      this.labelFor -= delta;
      mesh.material.opacity = Math.min(1, this.labelFor, (LABEL_SECONDS - this.labelFor) * 3);
      mesh.lookAt(this.head);
    }
    keepsakeRuntime.flying = this.flight >= 0;
    keepsakeRuntime.label = this.labelFor > 0 ? this.label.text : '';
    keepsakeRuntime.jar.copy(this.jar.position);
  }

  private award(): void {
    const colour = accessRuntime.highContrast ? WARM.getHex() : stageRuntime.wakeColour;
    this.pending = { title: storyRuntime.title || 'A story', at: Date.now(), colour };
    this.from.copy(stageRuntime.center).addScaledVector(stageRuntime.normal, 0.05);
    (this.flyer.material as MeshBasicMaterial).color.setHex(colour).lerp(WARM, 0.3);
    this.flyer.visible = true;
    this.flight = 0;
  }

  /** Up off the wall in an arc, down through the jar's neck to its place among the others. */
  private fly(delta: number): void {
    this.flight += delta;
    const k = Math.min(1, this.flight / FLIGHT);
    const e = k * k * (3 - 2 * k);
    spot(this.stars.length, this.to).applyQuaternion(this.jar.quaternion).add(this.jar.position);
    this.flyer.position.lerpVectors(this.from, this.to, e);
    this.flyer.position.y += Math.sin(Math.PI * e) * 0.22;
    this.flyer.scale.setScalar(1.6 - 0.6 * e + 0.15 * Math.sin(this.time * 9));
    this.flyer.lookAt(this.head);
    if (k < 1 || !this.pending) return;
    this.flight = -1;
    this.flyer.visible = false;
    this.stars.push(this.pending);
    if (this.stars.length > KEPT) this.stars.splice(0, this.stars.length - KEPT);
    this.pending = null;
    void saveKeepsakes(this.stars);
    this.fill();
    const n = this.stars.length;
    this.drawLabel(`${n} ${n === 1 ? 'story' : 'stories'} in the jar`, this.stars[n - 1].title);
    this.labelFor = LABEL_SECONDS;
  }

  /** Put the most recent stars in their places in the jar. */
  private fill(): void {
    this.contrast = accessRuntime.highContrast;
    const first = Math.max(0, this.stars.length - SHOWN);
    const shown = this.stars.length - first;
    for (let i = 0; i < shown; i++) {
      spot(first + i, this.v);
      this.positions.set([this.v.x, this.v.y, this.v.z], i * 3);
      this.colour.setHex(this.stars[first + i].colour).lerp(WARM, 0.3);
      if (this.contrast) this.colour.copy(WARM);
      this.base.set([this.colour.r, this.colour.g, this.colour.b], i * 3);
    }
    this.starGeometry.setDrawRange(0, shown);
    (this.starGeometry.attributes.position as BufferAttribute).needsUpdate = true;
  }

  private makeLabel(): { mesh: Mesh<PlaneGeometry, MeshBasicMaterial>; canvas: HTMLCanvasElement; texture: CanvasTexture; text: string } {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const texture = new CanvasTexture(canvas);
    const mesh = new Mesh(new PlaneGeometry(0.16, 0.04), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    mesh.name = 'keepsake-label';
    mesh.position.y = HEIGHT + 0.06;
    mesh.visible = false;
    return { mesh, canvas, texture, text: '' };
  }

  private drawLabel(count: string, title: string): void {
    const g = this.label.canvas.getContext('2d')!;
    g.clearRect(0, 0, 512, 128);
    g.fillStyle = 'rgba(13, 10, 20, 0.85)';
    g.beginPath();
    g.roundRect(4, 4, 504, 120, 28);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = '#f2c47a';
    g.font = '700 44px Georgia, serif';
    g.fillText(count, 256, 56);
    g.fillStyle = '#f6e3bd';
    g.font = 'italic 34px Georgia, serif';
    g.fillText(title.length > 30 ? `${title.slice(0, 29)}…` : title, 256, 104);
    this.label.texture.needsUpdate = true;
    this.label.text = `${count}: ${title}`;
  }
}
