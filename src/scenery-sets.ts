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

/** A set with a character that follows Mo along the stage (the buggy, the little dinosaur, Pip's spaceship). */
export interface FollowerSet extends ScenerySet {
  /** Mo's position along the stage (stage widths, centre 0); the set's character goes after her. */
  follow(u: number): void;
}
export type MoonRoadSet = FollowerSet;

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

// ---------------------------------------------------------------- dino valley (Dinosaurs & Discovery)

/** Low rolling ground with a few fern fans along it. */
function valleyGround(): Shape[] {
  const ground = new Shape();
  ground.moveTo(-0.62, 0);
  for (let x = -0.62; x <= 0.62 + 1e-6; x += 0.02) ground.lineTo(x, 0.07 + Math.sin(x * 4.2 + 1.1) * 0.02 + Math.sin(x * 17) * 0.005);
  ground.lineTo(0.62, 0);
  ground.closePath();
  const ferns: Shape[] = [];
  for (const [x, h] of [[-0.3, 0.1], [-0.12, 0.07], [0.08, 0.09], [0.26, 0.08]] as const) {
    // A fan of thin fronds, curving out from one root.
    for (let i = 0; i < 5; i++) {
      const a = -0.9 + i * 0.45;
      const tipX = x + Math.sin(a) * h * 0.8;
      const tipY = 0.06 + Math.cos(a) * h;
      const f = new Shape();
      f.moveTo(x - 0.004, 0.06);
      f.quadraticCurveTo(x + Math.sin(a) * h * 0.2, 0.06 + h * 0.6, tipX, tipY);
      f.quadraticCurveTo(x + Math.sin(a) * h * 0.3, 0.06 + h * 0.5, x + 0.004, 0.06);
      f.closePath();
      ferns.push(f);
    }
  }
  return [ground, ...ferns];
}

/** A sleepy volcano far off on the left, with a notch at its top. */
function volcanoShape(): Shape {
  const s = new Shape();
  s.moveTo(-0.62, 0.05);
  s.lineTo(-0.62, 0.2);
  s.lineTo(-0.47, 0.44);
  s.lineTo(-0.44, 0.42);
  s.lineTo(-0.41, 0.44);
  s.lineTo(-0.24, 0.12);
  s.lineTo(-0.2, 0.05);
  s.closePath();
  return s;
}

/** A tall palm-like tree at the right edge: a leaning trunk and drooping leaves. */
function palmShapes(): Shape[] {
  const x = 0.58;
  const trunk = new Shape();
  trunk.moveTo(x - 0.012, 0);
  trunk.quadraticCurveTo(x - 0.03, 0.3, x - 0.05, 0.55);
  trunk.lineTo(x - 0.036, 0.55);
  trunk.quadraticCurveTo(x - 0.014, 0.3, x + 0.012, 0);
  trunk.closePath();
  const leaves = [-2.6, -2.0, -1.2, -0.5, 0.2].map((a) => {
    const l = new Shape();
    const cx = x - 0.043;
    const cy = 0.55;
    const ex = cx + Math.cos(a) * 0.13;
    const ey = cy + Math.sin(a) * 0.05 + 0.02;
    l.moveTo(cx, cy);
    l.quadraticCurveTo((cx + ex) / 2, cy + 0.07, ex, ey - 0.04);
    l.quadraticCurveTo((cx + ex) / 2, cy + 0.03, cx, cy);
    return l;
  });
  return [trunk, ...leaves];
}

/** The little dinosaur's cave: a rocky mound on the right with a round doorway. */
function caveShape(): Shape {
  const x = 0.42;
  const s = new Shape();
  s.moveTo(x - 0.16, 0.05);
  s.quadraticCurveTo(x - 0.15, 0.27, x, 0.3);
  s.quadraticCurveTo(x + 0.12, 0.31, x + 0.2, 0.2);
  s.lineTo(x + 0.2, 0.05);
  s.closePath();
  const door = new Shape();
  door.moveTo(x - 0.055, 0.05);
  door.lineTo(x - 0.055, 0.12);
  door.absarc(x, 0.12, 0.055, Math.PI, 0, true);
  door.lineTo(x + 0.055, 0.05);
  door.closePath();
  s.holes.push(door);
  return s;
}

/** The cave's doorway, centred on its own origin (placed at the door, 0.42, 0.1, so it can be found there). */
function caveDoorShape(): Shape {
  const door = new Shape();
  door.moveTo(-0.055, -0.05);
  door.lineTo(-0.055, 0.02);
  door.absarc(0, 0.02, 0.055, Math.PI, 0, false);
  door.lineTo(0.055, -0.05);
  door.closePath();
  return door;
}

/** A little long-neck dinosaur in profile, facing right: body, neck, head, tail, four legs. */
function dinoShapes(): Shape[] {
  const body = new Shape();
  body.absellipse(0, 0.06, 0.055, 0.032, 0, Math.PI * 2, false, 0);
  const neck = new Shape();
  neck.moveTo(0.03, 0.07);
  neck.quadraticCurveTo(0.07, 0.09, 0.075, 0.14);
  neck.lineTo(0.092, 0.14);
  neck.quadraticCurveTo(0.09, 0.08, 0.05, 0.05);
  neck.closePath();
  const head = new Shape();
  head.absellipse(0.092, 0.145, 0.022, 0.013, 0, Math.PI * 2, false, 0.15);
  const tail = new Shape();
  tail.moveTo(-0.045, 0.075);
  tail.quadraticCurveTo(-0.1, 0.07, -0.135, 0.04);
  tail.quadraticCurveTo(-0.09, 0.05, -0.045, 0.045);
  tail.closePath();
  const legs = [-0.035, -0.015, 0.018, 0.036].map((lx) => {
    const l = new Shape();
    l.moveTo(lx - 0.008, 0.045);
    l.lineTo(lx - 0.008, 0);
    l.lineTo(lx + 0.008, 0);
    l.lineTo(lx + 0.008, 0.045);
    l.closePath();
    return l;
  });
  return [body, neck, head, tail, ...legs];
}

/** Smoke puffs above the volcano. */
const PUFFS = 4;

/**
 * Dinosaurs & Discovery: a fern valley under a sleepy volcano, a palm at the
 * edge and a cave on the right. The little dinosaur stomps after Mo; at the
 * finale it walks into its cave and the doorway glows warm.
 */
export function buildDinoValley(ink: MeshBasicMaterial): FollowerSet {
  const group = new Group();
  group.name = 'scenery-dino-valley';
  const backGeo = new ShapeGeometry([volcanoShape(), ...palmShapes()], 8);
  const back = new Mesh(backGeo, ink);
  back.name = 'scenery-dino-valley-volcano';
  back.renderOrder = 3;
  const groundGeo = new ShapeGeometry(valleyGround(), 6);
  const ground = new Mesh(groundGeo, ink);
  ground.name = 'scenery-dino-valley-ground';
  ground.renderOrder = 4;
  const caveGeo = new ShapeGeometry(caveShape(), 12);
  const cave = new Mesh(caveGeo, ink);
  cave.name = 'scenery-dino-valley-cave';
  cave.renderOrder = 4;

  const doorMat = glow(0xffb45a);
  const doorGeo = new ShapeGeometry(caveDoorShape(), 12);
  const door = new Mesh(doorGeo, doorMat);
  door.name = 'scenery-dino-valley-cave-door';
  door.position.set(0.42, 0.1, 0.0005);
  door.renderOrder = 2;

  const lavaMat = glow(0xff6a2a);
  const lavaGeo = new PlaneGeometry(0.05, 0.03);
  const lava = new Mesh(lavaGeo, lavaMat);
  lava.name = 'scenery-dino-valley-lava';
  lava.position.set(-0.44, 0.43, -0.0005);
  lava.renderOrder = 2;

  const puffShape = new Shape();
  puffShape.absellipse(0, 0, 0.022, 0.015, 0, Math.PI * 2, false, 0);
  const puffGeo = new ShapeGeometry(puffShape, 10);
  const puffs = Array.from({ length: PUFFS }, (_, i) => {
    const m = new Mesh(puffGeo, ink);
    m.name = `scenery-dino-valley-puff-${i}`;
    m.renderOrder = 3;
    return m;
  });

  const dino = new Group();
  dino.name = 'scenery-dino-valley-dino';
  const dinoGeo = new ShapeGeometry(dinoShapes(), 8);
  const dinoBody = new Mesh(dinoGeo, ink);
  dinoBody.name = 'scenery-dino-valley-dino-body';
  dinoBody.renderOrder = 5;
  dino.add(dinoBody);
  dino.position.set(-0.36, 0.06, 0.0008);

  group.add(back, lava, ...puffs, door, cave, ground, dino);
  let target = -0.36;
  let lastTime = -1;
  return {
    group,
    follow(u) {
      // A little behind Mo, and never past the cave door.
      target = Math.min(0.28, Math.max(-0.48, u - 0.12));
    },
    update(time, level, finale) {
      const dt = lastTime < 0 ? 0 : Math.min(0.1, time - lastTime);
      lastTime = time;
      const goal = finale > 0.01 ? 0.42 : target;
      const before = dino.position.x;
      dino.position.x += (goal - before) * Math.min(1, dt * 0.7);
      // Stomp, stomp: a heavier, slower bob than the buggy's.
      const moving = Math.min(1, Math.abs(dino.position.x - before) / Math.max(dt, 1e-3) / 0.05);
      dino.position.y = 0.06 + Math.abs(Math.sin(time * 4)) * 0.006 * moving;
      // Into the cave: it shrinks a little into the dark as it goes in.
      const inside = Math.max(0, Math.min(1, (finale - 0.6) / 0.38));
      dino.scale.setScalar(1 - 0.4 * inside);
      dino.visible = finale < 0.98;
      puffs.forEach((p, i) => {
        const t = (time * 0.05 + i / PUFFS) % 1;
        p.position.set(-0.44 + Math.sin(t * 5 + i) * 0.02 + t * 0.04, 0.46 + t * 0.3, -0.0002);
        p.scale.setScalar(0.6 + t * 1.6);
        p.visible = t < 0.9;
      });
      lavaMat.color.setHex(0xff6a2a).multiplyScalar(level * (0.35 + 0.15 * Math.sin(time * 1.3)));
      doorMat.color.setHex(0xffb45a).multiplyScalar(0.05 * level + 0.9 * level * finale);
    },
    dispose() {
      backGeo.dispose();
      groundGeo.dispose();
      caveGeo.dispose();
      doorGeo.dispose();
      doorMat.dispose();
      lavaGeo.dispose();
      lavaMat.dispose();
      puffGeo.dispose();
      dinoGeo.dispose();
    },
  };
}

// ---------------------------------------------------------------- star port (Space & Exploration)

const STARS = 26;

/** Moon rocks along the bottom: a low cratered surface with a few boulders. */
function moonRocks(): Shape[] {
  const s = new Shape();
  s.moveTo(-0.62, 0);
  for (let x = -0.62; x <= 0.62 + 1e-6; x += 0.02) s.lineTo(x, 0.05 + Math.sin(x * 7 + 0.4) * 0.012 + Math.sin(x * 23) * 0.004);
  s.lineTo(0.62, 0);
  s.closePath();
  const rocks = [[-0.45, 0.025], [-0.2, 0.016], [0.12, 0.02], [0.4, 0.03]].map(([x, r]) => {
    const b = new Shape();
    b.absellipse(x, 0.055, r * 1.4, r, 0, Math.PI, false, 0);
    return b;
  });
  return [s, ...rocks];
}

/** Pip's home planet, top right, with a tilted ring (a band with a hole), and a tiny far planet. */
function planetShapes(): Shape[] {
  const planet = new Shape();
  planet.absarc(0.36, 0.74, 0.075, 0, Math.PI * 2, false);
  const ring = new Shape();
  ring.absellipse(0.36, 0.74, 0.135, 0.03, 0, Math.PI * 2, false, -0.25);
  const inner = new Shape();
  inner.absellipse(0.36, 0.74, 0.105, 0.018, 0, Math.PI * 2, true, -0.25);
  ring.holes.push(inner);
  const far = new Shape();
  far.absarc(-0.38, 0.82, 0.03, 0, Math.PI * 2, false);
  return [planet, ring, far];
}

/** Pip's little round spaceship: a dome on a saucer, with a short antenna. */
function saucerShapes(): Shape[] {
  const disk = new Shape();
  disk.absellipse(0, 0, 0.075, 0.018, 0, Math.PI * 2, false, 0);
  const dome = new Shape();
  dome.absarc(0, 0.008, 0.035, 0, Math.PI, false);
  dome.lineTo(0.035, 0.008);
  const antenna = new Shape();
  antenna.moveTo(-0.002, 0.04);
  antenna.lineTo(-0.002, 0.062);
  antenna.lineTo(0.002, 0.062);
  antenna.lineTo(0.002, 0.04);
  antenna.closePath();
  const tip = new Shape();
  tip.absarc(0, 0.066, 0.006, 0, Math.PI * 2, false);
  return [disk, dome, antenna, tip];
}

/**
 * Space & Exploration: moon rocks, a ringed home planet and a tiny far one,
 * twinkling stars, and Pip's little spaceship following Mo. At the finale it
 * flies up to the ringed planet, whose window lights.
 */
export function buildStarPort(ink: MeshBasicMaterial): FollowerSet {
  const group = new Group();
  group.name = 'scenery-star-port';
  const rand = makeRandom(97);
  const rocksGeo = new ShapeGeometry(moonRocks(), 8);
  const rocks = new Mesh(rocksGeo, ink);
  rocks.name = 'scenery-star-port-rocks';
  rocks.renderOrder = 4;
  const planetGeo = new ShapeGeometry(planetShapes(), 24);
  const planets = new Mesh(planetGeo, ink);
  planets.name = 'scenery-star-port-planet';
  planets.renderOrder = 3;

  const homeMat = glow(0xffd36b);
  const homeGeo = new PlaneGeometry(0.02, 0.022);
  const home = new Mesh(homeGeo, homeMat);
  home.name = 'scenery-star-port-home-window';
  home.position.set(0.36, 0.74, 0.001);
  home.renderOrder = 5;

  const starMat = glow(0xffffff);
  const starGeo = new PlaneGeometry(0.008, 0.012);
  const stars = new InstancedMesh(starGeo, starMat, STARS);
  stars.name = 'scenery-star-port-stars';
  stars.renderOrder = 2;
  stars.frustumCulled = false;
  const starSeeds = Array.from({ length: STARS }, () => ({
    x: rand() * 1.16 - 0.58,
    y: 0.3 + rand() * 0.65,
    phase: rand() * Math.PI * 2,
    speed: 0.6 + rand() * 1.4,
  }));
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const p = new Vector3();
  starSeeds.forEach((st, i) => {
    stars.setMatrixAt(i, m.compose(p.set(st.x, st.y, -0.0005), q, one));
    stars.setColorAt(i, starMat.color);
  });

  const ship = new Group();
  ship.name = 'scenery-star-port-ship';
  const shipGeo = new ShapeGeometry(saucerShapes(), 12);
  const shipBody = new Mesh(shipGeo, ink);
  shipBody.name = 'scenery-star-port-ship-body';
  shipBody.renderOrder = 5;
  const lightsMat = glow(0x9cf6ff);
  const lightsGeo = new PlaneGeometry(0.008, 0.006);
  const lights = new InstancedMesh(lightsGeo, lightsMat, 3);
  lights.name = 'scenery-star-port-ship-lights';
  lights.renderOrder = 6;
  [-0.04, 0, 0.04].forEach((x, i) => lights.setMatrixAt(i, m.compose(p.set(x, -0.002, 0.0005), q, one)));
  ship.add(shipBody, lights);
  ship.position.set(-0.36, 0.2, 0.0008);

  group.add(stars, planets, home, rocks, ship);
  let target = -0.36;
  let lastTime = -1;
  const tint = starMat.color.clone();
  return {
    group,
    follow(u) {
      target = Math.min(0.3, Math.max(-0.48, u - 0.12));
    },
    update(time, level, finale) {
      const dt = lastTime < 0 ? 0 : Math.min(0.1, time - lastTime);
      lastTime = time;
      // Home at the finale: up to the ringed planet, getting smaller as it flies away.
      const flying = finale > 0.01;
      const gx = flying ? 0.36 : target;
      const gy = flying ? 0.74 : 0.2;
      const k = Math.min(1, dt * (flying ? 0.9 : 0.8));
      ship.position.x += (gx - ship.position.x) * k;
      const baseY = ship.userData.baseY ?? 0.2;
      ship.userData.baseY = baseY + (gy - baseY) * k;
      ship.position.y = ship.userData.baseY + Math.sin(time * 1.6) * 0.008;
      ship.rotation.z = Math.sin(time * 1.1) * 0.06;
      ship.scale.setScalar(1 - 0.75 * Math.min(1, finale));
      ship.visible = finale < 0.98;
      for (let i = 0; i < STARS; i++) {
        const st = starSeeds[i];
        const b = 0.25 + 0.2 * Math.sin(time * st.speed + st.phase);
        stars.setColorAt(i, tint.setScalar(Math.max(0, b * level)));
      }
      if (stars.instanceColor) stars.instanceColor.needsUpdate = true;
      lightsMat.color.setHex(0x9cf6ff).multiplyScalar(level * (0.3 + 0.2 * Math.sin(time * 3)));
      homeMat.color.setHex(0xffd36b).multiplyScalar(0.04 * level + 0.95 * level * finale);
    },
    dispose() {
      rocksGeo.dispose();
      planetGeo.dispose();
      homeGeo.dispose();
      homeMat.dispose();
      starGeo.dispose();
      starMat.dispose();
      shipGeo.dispose();
      lightsGeo.dispose();
      lightsMat.dispose();
    },
  };
}
