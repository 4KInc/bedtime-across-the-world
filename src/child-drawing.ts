import { CanvasTexture, createSystem, DoubleSide, Entity, Mesh, MeshBasicMaterial, PlaneGeometry } from '@iwsdk/core';
import { decodeDrawing } from './child-gifts.js';
import { CHILD_COLOUR } from './creature-colours.js';
import { giftsRuntime } from './gifts-received.js';
import { Stage } from './shadowplay-components.js';
import { stageRuntime } from './stage-runtime.js';
import { storyRuntime } from './story-script.js';
import { viewerMode } from './viewer-mode.js';

/** Where it walks from and settles (fractions of the stage, from its centre). */
const FROM_X = -0.62;
const TO_X = -0.36;
const Y = -0.28;
/** Its height, as a fraction of the stage's. */
const SIZE = 0.34;
const WALK_SECONDS = 4;
/** How long it stays, settled with its label, before it hops back off (Nov 16: it stayed through every story, in the way). */
const STAY_SECONDS = 12;
/** Which drawing has walked on (its arrival time), kept on this device so it comes once, not every story or launch. */
const SHOWN_KEY = 'sp-child-drawing-shown';

function loadShown(): number {
  try {
    return Number(localStorage.getItem(SHOWN_KEY) ?? -1);
  } catch {
    return -1;
  }
}

function saveShown(at: number): void {
  try {
    localStorage.setItem(SHOWN_KEY, String(at));
  } catch {
    // Not kept: it may come once more next launch.
  }
}
const TEX = 256;

/** For tests: whether the drawn creature is on the wall, walking or settled, and its label. */
export const childDrawingRuntime = { phase: 'none' as 'none' | 'walk' | 'sit' | 'leave', label: '' };

/**
 * The child's drawn creature: a creature the child drew with a finger and sent
 * with a goodnight walks onto the storyteller's wall at the start of the next
 * story, hopping in from the side, settles in the corner with a label ("Mia's
 * creature") for a few seconds, then hops back off. Once for each drawing. It is a
 * shadow in the child's own colour, like the creatures they wake in Live.
 * Not on the child's own device.
 */
export class ChildDrawingSystem extends createSystem({
  stages: { required: [Stage] },
}) {
  private canvas = document.createElement('canvas');
  private texture = new CanvasTexture(this.canvas);
  private material = new MeshBasicMaterial({ color: CHILD_COLOUR, map: this.texture, transparent: true, depthWrite: false, side: DoubleSide });
  private mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
  private labelCanvas = document.createElement('canvas');
  private labelTexture = new CanvasTexture(this.labelCanvas);
  private label = new Mesh(new PlaneGeometry(1, 0.25), new MeshBasicMaterial({ map: this.labelTexture, transparent: true, depthWrite: false }));
  private attached = false;
  private drawnAt = -1;
  /** A drawing not yet shown: it walks on when a story is being told. */
  private pending = false;
  private script = '';
  private t = 0;
  private time = 0;

  init(): void {
    this.canvas.width = this.canvas.height = TEX;
    this.labelCanvas.width = 512;
    this.labelCanvas.height = 128;
    this.mesh.name = 'child-drawing';
    this.label.name = 'child-drawing-label';
    this.mesh.renderOrder = 21;
    this.label.renderOrder = 21;
    this.mesh.visible = this.label.visible = false;
    this.cleanupFuncs.push(() => {
      this.mesh.removeFromParent();
      this.label.removeFromParent();
      this.mesh.geometry.dispose();
      this.material.dispose();
      this.texture.dispose();
      this.label.geometry.dispose();
      this.label.material.dispose();
      this.labelTexture.dispose();
    });
  }

  update(delta: number): void {
    if (viewerMode.on) return;
    this.time += delta;
    const stage = this.queries.stages.entities.values().next().value as Entity | undefined;
    if (!stage?.object3D) return;
    if (!this.attached) {
      stage.object3D.add(this.mesh, this.label);
      this.attached = true;
    }
    // A new drawing arrived: draw it; it walks on once, when a story is being told.
    if (giftsRuntime.drawingAt !== this.drawnAt) {
      this.drawnAt = giftsRuntime.drawingAt;
      const ok = this.draw(giftsRuntime.drawing, giftsRuntime.drawingFrom);
      this.pending = ok && this.drawnAt !== loadShown();
      childDrawingRuntime.phase = 'none';
    }
    // Another story: a drawing already shown does not come back.
    if (storyRuntime.script !== this.script) {
      this.script = storyRuntime.script;
      if (childDrawingRuntime.phase !== 'none') childDrawingRuntime.phase = 'leave';
      this.t = 0;
    }
    if (this.pending && storyRuntime.script && childDrawingRuntime.phase === 'none') {
      this.pending = false;
      saveShown(this.drawnAt);
      childDrawingRuntime.phase = 'walk';
      this.t = 0;
    }
    const show = childDrawingRuntime.phase !== 'none' && stageRuntime.ready;
    this.mesh.visible = this.label.visible = show;
    if (!show) return;

    const w = stageRuntime.width;
    const h = stageRuntime.height;
    const size = SIZE * h;
    this.t += delta;
    let x = TO_X;
    let hop = 0;
    let tilt = 0;
    if (childDrawingRuntime.phase === 'walk') {
      const k = Math.min(1, this.t / WALK_SECONDS);
      const e = k * k * (3 - 2 * k);
      x = FROM_X + (TO_X - FROM_X) * e;
      hop = Math.abs(Math.sin(this.t * 5.5)) * 0.18 * size * (1 - k * 0.6);
      tilt = Math.sin(this.t * 11) * 0.07;
      if (k >= 1) {
        childDrawingRuntime.phase = 'sit';
        this.t = 0;
      }
    } else if (childDrawingRuntime.phase === 'sit') {
      if (this.t >= STAY_SECONDS) {
        childDrawingRuntime.phase = 'leave';
        this.t = 0;
      }
    } else {
      // Hopping back off the way it came, fading.
      const k = Math.min(1, this.t / WALK_SECONDS);
      const e = k * k * (3 - 2 * k);
      x = TO_X + (FROM_X - TO_X) * e;
      hop = Math.abs(Math.sin(this.t * 5.5)) * 0.18 * size * (0.4 + k * 0.6);
      tilt = Math.sin(this.t * 11) * 0.07;
      if (k >= 1) childDrawingRuntime.phase = 'none';
    }
    const breathe = 1 + 0.025 * Math.sin(this.time * 2.2);
    this.mesh.position.set(x * w, Y * h + hop, 0.003);
    this.mesh.rotation.z = tilt;
    this.mesh.scale.set(size, size * breathe, 1);
    const fadeIn = childDrawingRuntime.phase === 'walk' ? Math.min(1, this.t / 0.6) : 1;
    const fadeOut = childDrawingRuntime.phase === 'leave' ? 1 - Math.min(1, this.t / WALK_SECONDS) : 1;
    this.material.opacity = fadeIn * fadeOut * 0.95;
    this.label.position.set(x * w, Y * h - size * 0.62, 0.003);
    this.label.scale.setScalar(size * 1.4);
    this.label.material.opacity = this.material.opacity;
  }

  /** The strokes, thick and round like a felt-tip, white on clear (the material gives the colour). */
  private draw(text: string, from: string): boolean {
    const strokes = decodeDrawing(text);
    childDrawingRuntime.label = '';
    if (!strokes) return false;
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, TEX, TEX);
    g.strokeStyle = g.fillStyle = '#fff';
    g.lineWidth = 18;
    g.lineCap = g.lineJoin = 'round';
    const m = 16;
    const s = TEX - m * 2;
    for (const stroke of strokes) {
      g.beginPath();
      stroke.forEach(([x, y], i) => (i === 0 ? g.moveTo(m + x * s, m + y * s) : g.lineTo(m + x * s, m + y * s)));
      if (stroke.length === 1) g.arc(m + stroke[0][0] * s, m + stroke[0][1] * s, 9, 0, Math.PI * 2);
      g.stroke();
    }
    this.texture.needsUpdate = true;

    const text2 = from ? `${from}'s creature` : 'A creature for you';
    const l = this.labelCanvas.getContext('2d')!;
    l.clearRect(0, 0, 512, 128);
    l.fillStyle = 'rgba(13, 10, 20, 0.8)';
    l.beginPath();
    l.roundRect(16, 20, 480, 88, 44);
    l.fill();
    l.fillStyle = '#f6c6f0';
    l.font = 'italic 700 56px Georgia, serif';
    l.textAlign = 'center';
    l.textBaseline = 'middle';
    l.fillText(text2.length > 22 ? `${text2.slice(0, 21)}…` : text2, 256, 66);
    this.labelTexture.needsUpdate = true;
    childDrawingRuntime.label = text2;
    return true;
  }
}
