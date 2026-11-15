import {
  AddEquation,
  CustomBlending,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
  ZeroFactor,
} from '@iwsdk/core';
import { stageRuntime } from './stage-runtime.js';

/**
 * Chapter Four and Five scenery. Built in stage units (x in stage widths,
 * y in stage heights, rooted on the stage floor at y = 0); the scenery system
 * scales the group to the stage.
 */
export interface ScenerySet {
  group: Group;
  update(time: number, level: number, finale: number): void;
  dispose(): void;
}

function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function glow(color: number): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
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

// ---------------------------------------------------------------- storm

const DROPS = 70;

/** Slanting rain streaks and heavy clouds rolling across the top of the stage. */
export function buildStorm(ink: MeshBasicMaterial): ScenerySet {
  const group = new Group();
  group.name = 'scenery-storm';
  const rand = makeRandom(71);

  const rainMat = new MeshBasicMaterial({ color: 0x0a0810, transparent: true, opacity: 0, depthWrite: false });
  const dropGeo = new PlaneGeometry(0.004, 0.07);
  const rain = new InstancedMesh(dropGeo, rainMat, DROPS);
  rain.name = 'scenery-storm-rain';
  rain.renderOrder = 4;
  rain.frustumCulled = false;
  const seeds = Array.from({ length: DROPS }, () => ({ x: rand() * 1.2 - 0.6, y: rand(), speed: 0.9 + rand() * 0.5 }));
  group.add(rain);

  const cloudShapes: Shape[] = [];
  // Two rows of uneven billows: a flat underside with lumpy tops.
  for (let i = 0; i < 16; i++) {
    const c = new Shape();
    const row = i % 2;
    const x = -0.6 + (i / 15) * 1.2 + (rand() - 0.5) * 0.05;
    const r = 0.05 + rand() * 0.06 + row * 0.02;
    c.absellipse(x, 0.9 + row * 0.05 + rand() * 0.04, r * 1.3, r, 0, Math.PI * 2, false, 0);
    cloudShapes.push(c);
  }
  const cloudGeo = new ShapeGeometry(cloudShapes, 12);
  const clouds = new Mesh(cloudGeo, ink);
  clouds.name = 'scenery-storm-clouds';
  clouds.renderOrder = 3;
  group.add(clouds);

  const m = new Matrix4();
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.35);
  const p = new Vector3();
  const s = new Vector3(1, 1, 1);
  return {
    group,
    update(time, level) {
      rainMat.opacity = 0.55 * level;
      // Quality 3 (last resort): half the raindrops.
      const drops = stageRuntime.quality >= 3 ? DROPS >> 1 : DROPS;
      rain.count = drops;
      for (let i = 0; i < drops; i++) {
        const d = seeds[i];
        const y = 1 - ((d.y + time * d.speed) % 1);
        const x = ((d.x + 0.6 - (1 - y) * 0.3) % 1.2 + 1.2) % 1.2 - 0.6;
        m.compose(p.set(x, y * 0.95, 0), q, s);
        rain.setMatrixAt(i, m);
      }
      rain.instanceMatrix.needsUpdate = true;
      clouds.position.x = Math.sin(time * 0.15) * 0.04;
    },
    dispose() {
      rainMat.dispose();
      dropGeo.dispose();
      cloudGeo.dispose();
    },
  };
}

// ---------------------------------------------------------------- sea + lighthouse

function lighthouseShape(): Shape {
  const s = new Shape();
  const x = 0.36;
  s.moveTo(x - 0.075, 0);
  s.lineTo(x - 0.045, 0.62);
  s.lineTo(x - 0.07, 0.62); // gallery
  s.lineTo(x - 0.07, 0.65);
  s.lineTo(x - 0.035, 0.65);
  s.lineTo(x - 0.035, 0.76); // lamp room
  s.lineTo(x - 0.045, 0.76);
  s.lineTo(x, 0.84); // roof
  s.lineTo(x + 0.045, 0.76);
  s.lineTo(x + 0.035, 0.76);
  s.lineTo(x + 0.035, 0.65);
  s.lineTo(x + 0.07, 0.65);
  s.lineTo(x + 0.07, 0.62);
  s.lineTo(x + 0.045, 0.62);
  s.lineTo(x + 0.075, 0);
  s.closePath();
  return s;
}

function seaWaves(): Shape {
  const s = new Shape();
  s.moveTo(-0.62, 0);
  for (let x = -0.62; x <= 0.62 + 1e-6; x += 0.02) s.lineTo(x, 0.07 + Math.sin(x * 34) * 0.018);
  s.lineTo(0.62, 0);
  s.closePath();
  return s;
}

function beamShape(): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(-1.1, 0.12);
  s.lineTo(-1.1, -0.12);
  s.closePath();
  return s;
}

/** The lighthouse on its rock by the sea; its lamp room and beam wake in the finale. */
export function buildSea(ink: MeshBasicMaterial): ScenerySet {
  const group = new Group();
  group.name = 'scenery-sea';
  const towerGeo = new ShapeGeometry(lighthouseShape(), 1);
  const tower = new Mesh(towerGeo, ink);
  tower.name = 'scenery-sea-lighthouse';
  tower.renderOrder = 3;
  const waveGeo = new ShapeGeometry(seaWaves(), 1);
  const waves = new Mesh(waveGeo, ink);
  waves.name = 'scenery-sea-waves';
  waves.renderOrder = 4;

  const windowMat = glow(0xffc46a);
  const windowGeo = new PlaneGeometry(0.05, 0.09);
  const lampRoom = new Mesh(windowGeo, windowMat);
  lampRoom.name = 'scenery-sea-lamp-room';
  lampRoom.position.set(0.36, 0.705, 0.001);
  lampRoom.renderOrder = 5;

  const beamMat = glow(0xffd48a);
  const beamGeo = new ShapeGeometry(beamShape(), 1);
  const beam = new Mesh(beamGeo, beamMat);
  beam.name = 'scenery-sea-beam';
  beam.position.set(0.36, 0.71, 0.0005);
  beam.renderOrder = 2;

  group.add(beam, tower, waves, lampRoom);
  return {
    group,
    update(time, level, finale) {
      waves.position.x = Math.sin(time * 0.6) * 0.015;
      const lit = level * finale;
      windowMat.color.setHex(0xffc46a).multiplyScalar(0.08 * level + 0.9 * lit);
      beamMat.color.setHex(0xffd48a).multiplyScalar(0.35 * lit);
      beam.rotation.z = Math.sin(time * 0.5) * 0.35;
      beam.visible = lit > 0.01;
    },
    dispose() {
      towerGeo.dispose();
      waveGeo.dispose();
      windowGeo.dispose();
      windowMat.dispose();
      beamGeo.dispose();
      beamMat.dispose();
    },
  };
}

// ---------------------------------------------------------------- moon road (Cars & Adventure)

/** Rolling moon ground with two crater rims, across the bottom of the stage. */
function moonGround(): Shape {
  const s = new Shape();
  s.moveTo(-0.62, 0);
  for (let x = -0.62; x <= 0.62 + 1e-6; x += 0.02) {
    const hills = 0.075 + Math.sin(x * 5.5 + 0.6) * 0.022 + Math.sin(x * 13) * 0.006;
    // Crater rims: two little raised lips with a dip between.
    const crater = (cx: number, r: number) => {
      const d = (x - cx) / r;
      return Math.abs(d) < 1 ? 0.02 * (d * d * 1.6 - 0.6) * (1 - d * d) * 2.2 : 0;
    };
    s.lineTo(x, hills + crater(-0.12, 0.09) + crater(0.18, 0.06));
  }
  s.lineTo(0.62, 0);
  s.closePath();
  return s;
}

/** The buggy's quiet moon garage: a little dome with a door, on the right of the road. */
function garageShape(): Shape {
  const x = 0.45;
  const s = new Shape();
  s.moveTo(x - 0.1, 0.05);
  s.lineTo(x - 0.1, 0.16);
  s.absarc(x, 0.16, 0.1, Math.PI, 0, true);
  s.lineTo(x + 0.1, 0.05);
  s.closePath();
  return s;
}

/** A little moon buggy in profile, facing right: body, cab, antenna, three wheels. */
function buggyShape(): Shape {
  const s = new Shape();
  s.moveTo(-0.075, 0.028);
  s.lineTo(-0.08, 0.06);
  s.lineTo(-0.03, 0.065);
  s.lineTo(-0.018, 0.1); // cab
  s.lineTo(0.03, 0.1);
  s.lineTo(0.045, 0.066);
  s.lineTo(0.078, 0.06);
  s.lineTo(0.082, 0.032);
  s.closePath();
  return s;
}

/** Three wheels and a thin antenna with a round tip. */
function buggyParts(): Shape[] {
  const parts = [-0.05, 0.002, 0.054].map((x) => {
    const w = new Shape();
    w.absarc(x, 0.022, 0.022, 0, Math.PI * 2, false);
    return w;
  });
  const antenna = new Shape();
  antenna.moveTo(-0.062, 0.06);
  antenna.lineTo(-0.066, 0.13);
  antenna.lineTo(-0.06, 0.13);
  antenna.lineTo(-0.056, 0.06);
  antenna.closePath();
  const tip = new Shape();
  tip.absarc(-0.063, 0.135, 0.009, 0, Math.PI * 2, false);
  return [...parts, antenna, tip];
}

function headlightShape(): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.lineTo(0.28, 0.05);
  s.lineTo(0.28, -0.045);
  s.closePath();
  return s;
}

/** The moon road also has a buggy that follows Mo along it: where Mo is, in stage widths. */
export interface MoonRoadSet extends ScenerySet {
  /** Mo's position along the stage (stage widths, centre 0); the buggy trundles after her. */
  follow(u: number): void;
}

/**
 * Cars & Adventure: a moon road with craters, the buggy's garage, and the little
 * buggy whose headlights are fading. It follows Mo along the road; at the
 * finale it rolls into its garage, the garage window glows and the headlights
 * go softly out.
 */
export function buildMoonRoad(ink: MeshBasicMaterial): MoonRoadSet {
  const group = new Group();
  group.name = 'scenery-moon-road';
  const groundGeo = new ShapeGeometry(moonGround(), 1);
  const ground = new Mesh(groundGeo, ink);
  ground.name = 'scenery-moon-road-ground';
  ground.renderOrder = 4;
  const garageGeo = new ShapeGeometry(garageShape(), 16);
  const garage = new Mesh(garageGeo, ink);
  garage.name = 'scenery-moon-road-garage';
  garage.renderOrder = 3;

  const windowMat = glow(0xffc46a);
  const windowGeo = new PlaneGeometry(0.06, 0.07);
  const garageWindow = new Mesh(windowGeo, windowMat);
  garageWindow.name = 'scenery-moon-road-garage-window';
  garageWindow.position.set(0.45, 0.16, 0.001);
  garageWindow.renderOrder = 5;

  const buggy = new Group();
  buggy.name = 'scenery-moon-road-buggy';
  const bodyGeo = new ShapeGeometry([buggyShape(), ...buggyParts()], 8);
  const body = new Mesh(bodyGeo, ink);
  body.name = 'scenery-moon-road-buggy-body';
  body.renderOrder = 5;
  const lightMat = glow(0xfff0b0);
  const lightGeo = new ShapeGeometry(headlightShape(), 1);
  const headlight = new Mesh(lightGeo, lightMat);
  headlight.name = 'scenery-moon-road-buggy-headlight';
  headlight.position.set(0.078, 0.048, -0.0005);
  headlight.renderOrder = 2;
  buggy.add(headlight, body);
  buggy.position.set(-0.36, 0.06, 0.0008);

  group.add(garage, ground, garageWindow, buggy);
  let target = -0.36;
  let lastTime = -1;
  return {
    group,
    follow(u) {
      // A little behind Mo, and never past the garage door.
      target = Math.min(0.3, Math.max(-0.48, u - 0.12));
    },
    update(time, level, finale) {
      const dt = lastTime < 0 ? 0 : Math.min(0.1, time - lastTime);
      lastTime = time;
      // Home at the finale: into the garage.
      const goal = finale > 0.01 ? 0.45 : target;
      const before = buggy.position.x;
      buggy.position.x += (goal - before) * Math.min(1, dt * 0.8);
      // A gentle bounce while it drives over the bumps.
      const moving = Math.min(1, Math.abs(buggy.position.x - before) / Math.max(dt, 1e-3) / 0.05);
      buggy.position.y = 0.06 + Math.sin(time * 9) * 0.004 * moving;
      buggy.visible = finale < 0.98;
      // Fading headlights: a weak flicker until the finale, then bright, then softly out.
      const flicker = 0.55 + 0.25 * Math.sin(time * 2.3) * Math.sin(time * 5.1);
      const lights = finale > 0.01 ? Math.sin(Math.min(1, finale) * Math.PI) : flicker * 0.5;
      lightMat.color.setHex(0xfff0b0).multiplyScalar(0.3 * level * lights);
      headlight.visible = level * lights > 0.01;
      windowMat.color.setHex(0xffc46a).multiplyScalar(0.06 * level + 0.9 * level * finale);
    },
    dispose() {
      groundGeo.dispose();
      garageGeo.dispose();
      windowGeo.dispose();
      windowMat.dispose();
      bodyGeo.dispose();
      lightGeo.dispose();
      lightMat.dispose();
    },
  };
}
