import { Group, Material, Path, Shape, ShapeGeometry } from '@iwsdk/core';
import type { PuppetRig } from './puppet-rigs.js';
import { circle, eyeAt, mesh, pivot, twig } from './rig-parts.js';
import { ShapeIds } from './shadowplay-components.js';

/**
 * Silhouettes of the world creatures (world-creatures.ts), on the puppets'
 * contract (puppet-rigs.ts): ~1 unit long, facing +X, centred on the origin.
 * Gentle, bedtime versions: a smiling shark, a sleepy asteroid, a T. rex with
 * small arms. The hand's features move a part where the pose has one (the
 * alien's antennae are its fingers, the whale's spout its thumb).
 */

function hole(x: number, y: number, r: number): Path {
  const p = new Path();
  p.absarc(x, y, r, 0, Math.PI * 2, true);
  return p;
}

// ---------------------------------------------------------------- rocket (space)

function rocketBody(): Shape {
  const s = new Shape();
  s.moveTo(-0.3, -0.11);
  s.lineTo(0.18, -0.11);
  s.bezierCurveTo(0.3, -0.11, 0.4, -0.05, 0.46, 0);
  s.bezierCurveTo(0.4, 0.05, 0.3, 0.11, 0.18, 0.11);
  s.lineTo(-0.3, 0.11);
  s.bezierCurveTo(-0.34, 0.06, -0.34, -0.06, -0.3, -0.11);
  return s;
}
function rocketFins(): Shape[] {
  const fin = (sign: number) => {
    const s = new Shape();
    s.moveTo(-0.3, 0.1 * sign);
    s.lineTo(-0.12, 0.1 * sign);
    s.lineTo(-0.36, 0.27 * sign);
    s.lineTo(-0.41, 0.25 * sign);
    s.closePath();
    return s;
  };
  return [fin(1), fin(-1)];
}
function rocketFlame(): Shape {
  const s = new Shape();
  s.moveTo(0, 0.07);
  s.bezierCurveTo(-0.08, 0.06, -0.16, 0.03, -0.26, 0);
  s.bezierCurveTo(-0.16, -0.03, -0.08, -0.06, 0, -0.07);
  s.closePath();
  return s;
}
const rocketGeo = {
  body: new ShapeGeometry(rocketBody(), 14),
  fins: new ShapeGeometry(rocketFins(), 1),
  flame: new ShapeGeometry(rocketFlame(), 10),
};

function buildRocket(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'rocket';
  // Nose up and forward, as it climbs.
  const tilt = new Group();
  tilt.rotation.z = 0.4;
  const flame = pivot('rocket-flame', -0.31, 0, -0.003, mesh(rocketGeo.flame, fill, 'rocket-flame-mesh', 4));
  // The porthole glows like an eye.
  const eye = eyeAt(eyeMat, 0.16, 0);
  eye.scale.setScalar(1.5);
  tilt.add(mesh(rocketGeo.body, fill, 'rocket-body', 5), mesh(rocketGeo.fins, fill, 'rocket-fins', 6, -0.0015), flame, eye);
  root.add(tilt);
  return {
    root,
    eye,
    seat: { x: -0.06, y: 0.16 },
    animate(time) {
      flame.scale.set(0.8 + 0.25 * Math.sin(time * 17) + 0.1 * Math.sin(time * 29), 1 + 0.1 * Math.sin(time * 23), 1);
      tilt.position.y = Math.sin(time * 2) * 0.015;
    },
  };
}

// ---------------------------------------------------------------- alien (space)

function saucer(): Shape {
  const s = new Shape();
  s.moveTo(-0.46, 0);
  s.bezierCurveTo(-0.4, -0.11, 0.4, -0.11, 0.46, 0);
  s.bezierCurveTo(0.36, 0.08, -0.36, 0.08, -0.46, 0);
  return s;
}
function alienHead(): Shape {
  const s = new Shape();
  s.moveTo(-0.13, 0.04);
  s.bezierCurveTo(-0.17, 0.2, -0.1, 0.3, 0.0, 0.3);
  s.bezierCurveTo(0.1, 0.3, 0.17, 0.2, 0.13, 0.04);
  s.closePath();
  return s;
}
function antenna(): Shape[] {
  const ball = new Shape();
  ball.absarc(0, 0.16, 0.026, 0, Math.PI * 2, false);
  return [twig(0, 0, 0, 0.15, 0.01), ball];
}
const alienGeo = {
  saucer: new ShapeGeometry(saucer(), 16),
  head: new ShapeGeometry(alienHead(), 14),
  antenna: new ShapeGeometry(antenna(), 10),
  light: new ShapeGeometry(circle(0.022), 10),
};

function buildAlien(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'alien';
  const ship = new Group();
  const left = pivot('alien-antenna-left', -0.05, 0.28, -0.003, mesh(alienGeo.antenna, fill, 'alien-antenna-left-mesh', 4));
  const right = pivot('alien-antenna-right', 0.05, 0.28, -0.003, mesh(alienGeo.antenna, fill, 'alien-antenna-right-mesh', 4));
  const eye = eyeAt(eyeMat, 0.04, 0.17);
  eye.scale.setScalar(1.9);
  ship.add(mesh(alienGeo.head, fill, 'alien-head', 4, -0.0015), mesh(alienGeo.saucer, fill, 'alien-saucer', 5), left, right, eye);
  // Little lights along the saucer's rim, in the eye's glow, twinkling in turn.
  const lights = [-0.28, -0.1, 0.1, 0.28].map((x, i) => {
    const l = mesh(alienGeo.light, eyeMat, `alien-light-${i}`, 12, 0.001);
    l.position.set(x, -0.02, 0.001);
    ship.add(l);
    return l;
  });
  root.add(ship);
  return {
    root,
    eye,
    seat: { x: 0.26, y: 0.06 },
    animate(time, _delta, f) {
      // The antennae are the index and little fingers.
      left.rotation.z = 0.25 + (f ? f[1] : 0.1 + 0.1 * Math.sin(time * 1.7)) * 1.2;
      right.rotation.z = -0.25 - (f ? f[4] : 0.1 + 0.1 * Math.sin(time * 1.7 + 1)) * 1.2;
      ship.position.y = Math.sin(time * 1.6) * 0.02;
      ship.rotation.z = Math.sin(time * 1.1) * 0.05;
      for (let i = 0; i < lights.length; i++) lights[i].scale.setScalar(0.6 + 0.4 * Math.max(0, Math.sin(time * 3 - i * 1.2)));
    },
  };
}

// ---------------------------------------------------------------- asteroid (space)

/** A lumpy rock, rounded between its points, with two craters. */
function rock(): Shape {
  const radii = [0.3, 0.26, 0.31, 0.27, 0.29, 0.24, 0.3, 0.25, 0.28];
  const pts = radii.map((r, i) => {
    const a = (i / radii.length) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r * 0.9];
  });
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const s = new Shape();
  const start = mid(pts[pts.length - 1], pts[0]);
  s.moveTo(start[0], start[1]);
  for (let i = 0; i < pts.length; i++) {
    const m = mid(pts[i], pts[(i + 1) % pts.length]);
    s.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  s.holes.push(hole(-0.12, 0.1, 0.055), hole(-0.04, -0.14, 0.04));
  return s;
}
function pebbles(): Shape[] {
  return [
    [-0.4, 0.05, 0.05],
    [-0.52, -0.03, 0.035],
    [-0.62, 0.04, 0.025],
  ].map(([x, y, r]) => {
    const s = new Shape();
    s.absarc(x, y, r, 0, Math.PI * 2, false);
    return s;
  });
}
const asteroidGeo = { rock: new ShapeGeometry(rock(), 8), pebbles: new ShapeGeometry(pebbles(), 8) };

function buildAsteroid(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'asteroid';
  const body = new Group();
  const eye = eyeAt(eyeMat, 0.12, 0.06);
  eye.scale.setScalar(0.9);
  body.add(mesh(asteroidGeo.rock, fill, 'asteroid-rock', 5), eye);
  const trail = mesh(asteroidGeo.pebbles, fill, 'asteroid-pebbles', 4, -0.0015);
  root.add(trail, body);
  return {
    root,
    eye,
    seat: { x: 0.02, y: 0.29 },
    animate(time) {
      // A slow, sleepy tumble, its little pebbles drifting after it.
      body.rotation.z = Math.sin(time * 0.6) * 0.3;
      trail.position.x = Math.sin(time * 1.3) * 0.02;
      trail.position.y = Math.cos(time * 1.1) * 0.015;
    },
  };
}

// ---------------------------------------------------------------- shark (ocean)

function sharkBody(): Shape {
  const s = new Shape();
  s.moveTo(0.5, -0.02);
  s.bezierCurveTo(0.45, 0.1, 0.25, 0.14, 0.05, 0.13);
  s.bezierCurveTo(-0.15, 0.12, -0.32, 0.06, -0.42, 0.01);
  s.lineTo(-0.42, -0.03);
  s.bezierCurveTo(-0.3, -0.09, -0.1, -0.12, 0.1, -0.11);
  s.bezierCurveTo(0.3, -0.1, 0.45, -0.08, 0.5, -0.02);
  // A gentle smile.
  const smile = new Path();
  smile.moveTo(0.32, -0.05);
  smile.quadraticCurveTo(0.39, -0.09, 0.45, -0.05);
  smile.quadraticCurveTo(0.39, -0.07, 0.32, -0.05);
  s.holes.push(smile);
  return s;
}
function sharkFins(): Shape[] {
  const dorsal = new Shape();
  dorsal.moveTo(0.12, 0.12);
  dorsal.bezierCurveTo(0.05, 0.2, -0.04, 0.28, -0.1, 0.33);
  dorsal.bezierCurveTo(-0.07, 0.24, -0.07, 0.16, -0.09, 0.12);
  dorsal.closePath();
  const side = new Shape();
  side.moveTo(0.14, -0.08);
  side.lineTo(0.0, -0.21);
  side.lineTo(0.2, -0.09);
  side.closePath();
  return [dorsal, side];
}
function sharkTail(): Shape {
  const s = new Shape();
  s.moveTo(0.02, 0.01);
  s.lineTo(-0.1, 0.21);
  s.quadraticCurveTo(-0.15, 0.2, -0.13, 0.15);
  s.lineTo(-0.06, 0.0);
  s.lineTo(-0.12, -0.13);
  s.lineTo(0.02, -0.03);
  s.closePath();
  return s;
}
const sharkGeo = {
  body: new ShapeGeometry(sharkBody(), 16),
  fins: new ShapeGeometry(sharkFins(), 10),
  tail: new ShapeGeometry(sharkTail(), 6),
};

function buildShark(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'shark';
  const tail = pivot('shark-tail', -0.41, -0.01, -0.0015, mesh(sharkGeo.tail, fill, 'shark-tail-mesh', 6));
  const eye = eyeAt(eyeMat, 0.34, 0.04);
  eye.scale.setScalar(0.8);
  root.add(mesh(sharkGeo.body, fill, 'shark-body', 5), mesh(sharkGeo.fins, fill, 'shark-fins', 6, -0.0015), tail, eye);
  return {
    root,
    eye,
    seat: { x: 0.24, y: 0.15 },
    animate(time) {
      tail.rotation.z = Math.sin(time * 4) * 0.3;
    },
  };
}

// ---------------------------------------------------------------- octopus (ocean)

function mantle(): Shape {
  const s = new Shape();
  s.moveTo(-0.2, -0.04);
  s.bezierCurveTo(-0.3, 0.2, -0.16, 0.42, 0.02, 0.42);
  s.bezierCurveTo(0.2, 0.42, 0.3, 0.22, 0.22, -0.04);
  s.closePath();
  return s;
}
function tentacle(): Shape {
  const s = new Shape();
  s.moveTo(-0.035, 0);
  s.bezierCurveTo(-0.05, -0.1, 0.03, -0.18, -0.01, -0.3);
  s.quadraticCurveTo(0.0, -0.34, 0.016, -0.3);
  s.bezierCurveTo(0.05, -0.18, 0.0, -0.1, 0.035, 0);
  s.closePath();
  return s;
}
const octopusGeo = { mantle: new ShapeGeometry(mantle(), 16), tentacle: new ShapeGeometry(tentacle(), 10) };

function buildOctopus(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'octopus';
  const arms = [-0.17, -0.1, -0.03, 0.04, 0.11, 0.18].map((x, i) => {
    const arm = pivot(`octopus-arm-${i}`, x, -0.02, -0.0015 * (1 + (i % 2)), mesh(octopusGeo.tentacle, fill, `octopus-arm-${i}-mesh`, 4 + (i % 2)));
    arm.rotation.z = (x / 0.18) * 0.35;
    root.add(arm);
    return arm;
  });
  const eye = eyeAt(eyeMat, 0.1, 0.2);
  eye.scale.setScalar(1.3);
  root.add(mesh(octopusGeo.mantle, fill, 'octopus-mantle', 6), eye);
  return {
    root,
    eye,
    seat: { x: 0.0, y: 0.44 },
    animate(time, _delta, f) {
      // The arms wave; spread fingers spread them wider.
      const spread = f ? 0.25 + f[5] * 0.2 : 0.35;
      for (let i = 0; i < arms.length; i++) {
        arms[i].rotation.z = ((i - 2.5) / 2.5) * spread + Math.sin(time * 2.2 + i * 0.9) * 0.22;
      }
    },
  };
}

// ---------------------------------------------------------------- whale (ocean)

function whaleBody(): Shape {
  const s = new Shape();
  s.moveTo(0.48, 0.0);
  s.bezierCurveTo(0.48, 0.2, 0.25, 0.26, 0.0, 0.24);
  s.bezierCurveTo(-0.2, 0.22, -0.34, 0.12, -0.42, 0.04);
  s.lineTo(-0.48, 0.0);
  s.lineTo(-0.38, -0.05);
  s.bezierCurveTo(-0.2, -0.14, 0.2, -0.18, 0.4, -0.1);
  s.bezierCurveTo(0.46, -0.07, 0.48, -0.04, 0.48, 0.0);
  return s;
}
function whaleTail(): Shape {
  const s = new Shape();
  s.moveTo(0.02, 0.0);
  s.quadraticCurveTo(-0.05, 0.08, -0.17, 0.16);
  s.quadraticCurveTo(-0.1, 0.05, -0.08, 0.01);
  s.quadraticCurveTo(-0.1, -0.04, -0.17, -0.1);
  s.quadraticCurveTo(-0.05, -0.06, 0.02, 0.0);
  return s;
}
function whaleFin(): Shape {
  const s = new Shape();
  s.moveTo(0.2, -0.07);
  s.quadraticCurveTo(0.12, -0.2, 0.02, -0.21);
  s.quadraticCurveTo(0.1, -0.13, 0.13, -0.06);
  s.closePath();
  return s;
}
function spout(): Shape[] {
  const drop = (x: number, y: number, r: number) => {
    const s = new Shape();
    s.absarc(x, y, r, 0, Math.PI * 2, false);
    return s;
  };
  return [
    twig(0, 0, 0, 0.13, 0.013),
    twig(0, 0.12, -0.08, 0.18, 0.011),
    twig(0, 0.12, 0.08, 0.18, 0.011),
    drop(-0.1, 0.17, 0.016),
    drop(0.1, 0.17, 0.016),
    drop(0, 0.18, 0.018),
  ];
}
const whaleGeo = {
  body: new ShapeGeometry(whaleBody(), 16),
  tail: new ShapeGeometry(whaleTail(), 8),
  fin: new ShapeGeometry(whaleFin(), 8),
  spout: new ShapeGeometry(spout(), 8),
};

function buildWhale(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'whale';
  const tail = pivot('whale-tail', -0.46, 0.0, -0.0015, mesh(whaleGeo.tail, fill, 'whale-tail-mesh', 6));
  const water = pivot('whale-spout', 0.14, 0.23, -0.003, mesh(whaleGeo.spout, fill, 'whale-spout-mesh', 4));
  const eye = eyeAt(eyeMat, 0.31, 0.03);
  eye.scale.setScalar(0.8);
  root.add(mesh(whaleGeo.body, fill, 'whale-body', 5), mesh(whaleGeo.fin, fill, 'whale-fin', 6, 0.0015), tail, water, eye);
  return {
    root,
    eye,
    seat: { x: -0.06, y: 0.26 },
    animate(time, _delta, f) {
      tail.rotation.z = Math.sin(time * 1.6) * 0.25;
      // The spout is the thumb: held straight up, it sprays high.
      const up = f ? 1 - f[0] : 0.6 + 0.4 * Math.max(0, Math.sin(time * 1.2));
      water.scale.set(1, 0.3 + up * 0.8, 1);
    },
  };
}

// ---------------------------------------------------------------- car (cars & adventure)

function carBody(): Shape {
  const s = new Shape();
  s.moveTo(-0.46, -0.08);
  s.lineTo(-0.46, 0.04);
  s.bezierCurveTo(-0.46, 0.08, -0.42, 0.1, -0.36, 0.1);
  s.lineTo(-0.22, 0.1);
  s.bezierCurveTo(-0.16, 0.24, -0.1, 0.26, 0.02, 0.26);
  s.lineTo(0.12, 0.26);
  s.bezierCurveTo(0.2, 0.26, 0.24, 0.2, 0.3, 0.1);
  s.lineTo(0.42, 0.08);
  s.bezierCurveTo(0.47, 0.07, 0.48, 0.03, 0.48, -0.01);
  s.lineTo(0.48, -0.08);
  s.closePath();
  const front = new Path();
  front.moveTo(0.04, 0.13);
  front.lineTo(0.22, 0.13);
  front.bezierCurveTo(0.19, 0.18, 0.16, 0.22, 0.1, 0.22);
  front.lineTo(0.04, 0.22);
  front.closePath();
  const back = new Path();
  back.moveTo(-0.16, 0.13);
  back.lineTo(-0.02, 0.13);
  back.lineTo(-0.02, 0.22);
  back.bezierCurveTo(-0.08, 0.22, -0.12, 0.2, -0.16, 0.13);
  s.holes.push(front, back);
  return s;
}
/** A wheel with two bolts, so it can be seen turning. */
function wheel(): Shape {
  const s = circle(0.095);
  s.holes.push(hole(0.04, 0, 0.018), hole(-0.04, 0, 0.018));
  return s;
}
const carGeo = { body: new ShapeGeometry(carBody(), 12), wheel: new ShapeGeometry(wheel(), 16) };

function buildCar(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'car';
  const wheels = [-0.26, 0.28].map((x, i) => {
    const w = pivot(`car-wheel-${i}`, x, -0.09, 0.0015, mesh(carGeo.wheel, fill, `car-wheel-${i}-mesh`, 7));
    root.add(w);
    return w;
  });
  const body = mesh(carGeo.body, fill, 'car-body', 5);
  // The headlight glows like an eye.
  const eye = eyeAt(eyeMat, 0.44, 0.02);
  eye.scale.setScalar(1.1);
  root.add(body, eye);
  return {
    root,
    eye,
    seat: { x: -0.04, y: 0.3 },
    animate(time, delta) {
      for (const w of wheels) w.rotation.z -= delta * 5;
      body.position.y = Math.abs(Math.sin(time * 6)) * 0.008;
    },
  };
}

// ---------------------------------------------------------------- aeroplane (cars & adventure)

function fuselage(): Shape {
  const s = new Shape();
  s.moveTo(0.46, 0.02);
  s.bezierCurveTo(0.46, 0.08, 0.4, 0.1, 0.3, 0.1);
  s.lineTo(-0.3, 0.06);
  s.lineTo(-0.44, 0.21);
  s.lineTo(-0.5, 0.21);
  s.lineTo(-0.47, 0.02);
  s.lineTo(-0.44, -0.02);
  s.bezierCurveTo(-0.2, -0.08, 0.2, -0.08, 0.38, -0.06);
  s.bezierCurveTo(0.44, -0.05, 0.46, -0.02, 0.46, 0.02);
  return s;
}
function planeWings(): Shape[] {
  const wing = new Shape();
  wing.moveTo(0.14, -0.02);
  wing.lineTo(-0.1, -0.02);
  wing.lineTo(-0.2, -0.08);
  wing.lineTo(0.1, -0.08);
  wing.closePath();
  const tail = new Shape();
  tail.moveTo(-0.33, 0.04);
  tail.lineTo(-0.5, 0.05);
  tail.lineTo(-0.52, 0.0);
  tail.lineTo(-0.36, 0.0);
  tail.closePath();
  const cockpit = new Shape();
  cockpit.moveTo(0.06, 0.08);
  cockpit.bezierCurveTo(0.08, 0.18, 0.22, 0.18, 0.26, 0.09);
  cockpit.closePath();
  return [wing, tail, cockpit];
}
const planeGeo = {
  body: new ShapeGeometry(fuselage(), 14),
  wings: new ShapeGeometry(planeWings(), 10),
  blade: new ShapeGeometry(twig(0, -0.17, 0, 0.17, 0.024), 1),
  spinner: new ShapeGeometry(circle(0.035), 10),
};

function buildPlane(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'plane';
  const craft = new Group();
  const prop = pivot('plane-propeller', 0.47, 0.02, 0.0015, mesh(planeGeo.blade, fill, 'plane-blade', 7));
  const spinner = mesh(planeGeo.spinner, fill, 'plane-spinner', 7, 0.0015);
  spinner.position.set(0.47, 0.02, 0.0015);
  // The pilot's window glows like an eye.
  const eye = eyeAt(eyeMat, 0.17, 0.12);
  craft.add(mesh(planeGeo.body, fill, 'plane-body', 5), mesh(planeGeo.wings, fill, 'plane-wings', 6, -0.0015), prop, spinner, eye);
  root.add(craft);
  let phase = 0;
  return {
    root,
    eye,
    seat: { x: -0.08, y: 0.12 },
    animate(time, delta) {
      phase += delta * 30;
      prop.scale.y = Math.cos(phase);
      // A gentle bank and bob.
      craft.rotation.z = Math.sin(time * 0.9) * 0.08;
      craft.position.y = Math.sin(time * 1.4) * 0.015;
    },
  };
}

// ---------------------------------------------------------------- digger (cars & adventure)

function diggerBody(): Shape[] {
  const tracks = new Shape();
  tracks.moveTo(-0.36, -0.3);
  tracks.lineTo(0.1, -0.3);
  tracks.absarc(0.1, -0.24, 0.06, -Math.PI / 2, Math.PI / 2, false);
  tracks.lineTo(-0.36, -0.18);
  tracks.absarc(-0.36, -0.24, 0.06, Math.PI / 2, (3 * Math.PI) / 2, false);
  tracks.holes.push(hole(-0.34, -0.24, 0.03), hole(-0.12, -0.24, 0.03), hole(0.09, -0.24, 0.03));
  const cab = new Shape();
  cab.moveTo(-0.38, -0.19);
  cab.lineTo(-0.38, 0.0);
  cab.lineTo(-0.22, 0.0);
  cab.lineTo(-0.22, 0.2);
  cab.lineTo(0.02, 0.2);
  cab.lineTo(0.06, 0.0);
  cab.lineTo(0.12, -0.19);
  cab.closePath();
  const window = new Path();
  window.moveTo(-0.17, 0.04);
  window.lineTo(-0.17, 0.15);
  window.lineTo(-0.01, 0.15);
  window.lineTo(0.02, 0.04);
  window.closePath();
  cab.holes.push(window);
  return [tracks, cab];
}
function bucket(): Shape[] {
  const scoop = new Shape();
  scoop.moveTo(0.12, -0.2);
  scoop.lineTo(0.24, -0.2);
  scoop.quadraticCurveTo(0.25, -0.33, 0.12, -0.33);
  scoop.lineTo(0.14, -0.29);
  scoop.lineTo(0.1, -0.26);
  scoop.closePath();
  return [twig(0, 0, 0.15, -0.21, 0.028), scoop];
}
const diggerGeo = {
  body: new ShapeGeometry(diggerBody(), 10),
  boom: new ShapeGeometry(twig(0, 0, 0.3, 0.2, 0.035), 1),
  bucket: new ShapeGeometry(bucket(), 8),
};

function buildDigger(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'digger';
  const boom = pivot('digger-boom', 0.05, 0.03, -0.0015, mesh(diggerGeo.boom, fill, 'digger-boom-mesh', 6));
  const scoop = pivot('digger-bucket', 0.3, 0.2, 0, mesh(diggerGeo.bucket, fill, 'digger-bucket-mesh', 6));
  boom.add(scoop);
  // The driver, in the cab window.
  const eye = eyeAt(eyeMat, -0.09, 0.1);
  root.add(mesh(diggerGeo.body, fill, 'digger-body', 5), boom, eye);
  return {
    root,
    eye,
    seat: { x: -0.1, y: 0.24 },
    animate(time, _delta, f) {
      boom.rotation.z = Math.sin(time * 0.8) * 0.15;
      // The bucket is the hand bent at the wrist: further down, a deeper scoop.
      scoop.rotation.z = f ? -0.3 + f[8] * 0.6 : Math.sin(time * 0.8 + 1) * 0.3;
    },
  };
}

// ---------------------------------------------------------------- T. rex (dinosaurs)

function trexBody(): Shape {
  const s = new Shape();
  s.moveTo(-0.55, 0.1);
  s.bezierCurveTo(-0.35, 0.14, -0.15, 0.22, 0.02, 0.24);
  s.bezierCurveTo(0.12, 0.26, 0.17, 0.3, 0.22, 0.36);
  s.lineTo(0.42, 0.38);
  s.bezierCurveTo(0.5, 0.38, 0.53, 0.33, 0.51, 0.28);
  s.lineTo(0.3, 0.25);
  s.lineTo(0.24, 0.2);
  s.bezierCurveTo(0.22, 0.1, 0.15, 0.02, 0.08, -0.02);
  s.lineTo(0.08, -0.3);
  s.lineTo(0.14, -0.34);
  s.lineTo(0.0, -0.34);
  s.lineTo(-0.02, -0.06);
  s.lineTo(-0.1, -0.06);
  s.lineTo(-0.12, -0.3);
  s.lineTo(-0.06, -0.34);
  s.lineTo(-0.2, -0.34);
  s.lineTo(-0.22, -0.02);
  s.bezierCurveTo(-0.32, 0.02, -0.45, 0.06, -0.55, 0.1);
  return s;
}
function trexJaw(): Shape {
  const s = new Shape();
  s.moveTo(0, 0.01);
  s.lineTo(0.22, 0.02);
  s.bezierCurveTo(0.22, -0.02, 0.2, -0.05, 0.16, -0.05);
  s.lineTo(0.02, -0.05);
  s.closePath();
  return s;
}
const trexGeo = {
  body: new ShapeGeometry(trexBody(), 12),
  jaw: new ShapeGeometry(trexJaw(), 8),
  arm: new ShapeGeometry([twig(0.16, 0.1, 0.24, 0.04, 0.016), twig(0.24, 0.04, 0.27, 0.08, 0.01)], 1),
};

function buildTrex(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'trex';
  const jaw = pivot('trex-jaw', 0.27, 0.25, -0.0015, mesh(trexGeo.jaw, fill, 'trex-jaw-mesh', 6));
  const eye = eyeAt(eyeMat, 0.38, 0.33);
  eye.scale.setScalar(0.7);
  root.add(mesh(trexGeo.body, fill, 'trex-body', 5), mesh(trexGeo.arm, fill, 'trex-arm', 6, 0.0015), jaw, eye);
  return {
    root,
    eye,
    seat: { x: -0.02, y: 0.28 },
    animate(time) {
      // A big, slow, friendly yawn.
      jaw.rotation.z = -Math.max(0, Math.sin(time * 1.3)) * 0.35;
    },
  };
}

// ---------------------------------------------------------------- pterodactyl (dinosaurs)

function pteroBody(): Shape {
  const s = new Shape();
  s.moveTo(-0.22, 0.0);
  s.bezierCurveTo(-0.1, 0.06, 0.1, 0.06, 0.18, 0.06);
  s.lineTo(0.24, 0.1);
  s.lineTo(0.2, 0.16);
  s.lineTo(0.08, 0.26);
  s.lineTo(0.27, 0.17);
  s.lineTo(0.56, 0.1);
  s.lineTo(0.28, 0.1);
  s.lineTo(0.2, 0.02);
  s.bezierCurveTo(0.1, -0.04, -0.1, -0.04, -0.22, 0.0);
  return s;
}
function pteroWing(): Shape {
  const s = new Shape();
  s.moveTo(0.1, 0.0);
  s.lineTo(0.0, 0.3);
  s.lineTo(-0.22, 0.56);
  s.quadraticCurveTo(-0.2, 0.36, -0.28, 0.26);
  s.quadraticCurveTo(-0.14, 0.2, -0.12, 0.0);
  s.closePath();
  return s;
}
const pteroGeo = {
  body: new ShapeGeometry(pteroBody(), 10),
  wing: new ShapeGeometry(pteroWing(), 10),
  legs: new ShapeGeometry([twig(-0.14, 0.0, -0.24, -0.1, 0.012), twig(-0.1, 0.0, -0.18, -0.12, 0.012)], 1),
};

function buildPterodactyl(fill: Material, eyeMat: Material): PuppetRig {
  const root = new Group();
  root.name = 'pterodactyl';
  const far = pivot('pterodactyl-wing-far', 0.02, 0.04, -0.003, mesh(pteroGeo.wing, fill, 'pterodactyl-wing-far-mesh', 4));
  const near = pivot('pterodactyl-wing-near', 0.0, 0.03, 0.0015, mesh(pteroGeo.wing, fill, 'pterodactyl-wing-near-mesh', 7));
  const eye = eyeAt(eyeMat, 0.26, 0.13);
  eye.scale.setScalar(0.55);
  root.add(far, mesh(pteroGeo.legs, fill, 'pterodactyl-legs', 4, -0.0015), mesh(pteroGeo.body, fill, 'pterodactyl-body', 5), near, eye);
  let phase = 0;
  return {
    root,
    eye,
    seat: { x: -0.06, y: 0.08 },
    animate(_time, delta) {
      // Big, slow wings, gliding between beats.
      phase += delta * 4;
      near.scale.y = 0.35 + 0.65 * Math.cos(phase);
      far.scale.y = (0.35 + 0.65 * Math.cos(phase - 0.5)) * 0.85;
    },
  };
}

/** A world creature's rig, or null for any other shape. */
export function buildWorldRig(shape: string, fill: Material, eyeMat: Material): PuppetRig | null {
  switch (shape) {
    case ShapeIds.Rocket:
      return buildRocket(fill, eyeMat);
    case ShapeIds.Alien:
      return buildAlien(fill, eyeMat);
    case ShapeIds.Asteroid:
      return buildAsteroid(fill, eyeMat);
    case ShapeIds.Shark:
      return buildShark(fill, eyeMat);
    case ShapeIds.Octopus:
      return buildOctopus(fill, eyeMat);
    case ShapeIds.Whale:
      return buildWhale(fill, eyeMat);
    case ShapeIds.Car:
      return buildCar(fill, eyeMat);
    case ShapeIds.Plane:
      return buildPlane(fill, eyeMat);
    case ShapeIds.Digger:
      return buildDigger(fill, eyeMat);
    case ShapeIds.Trex:
      return buildTrex(fill, eyeMat);
    case ShapeIds.Pterodactyl:
      return buildPterodactyl(fill, eyeMat);
    default:
      return null;
  }
}
