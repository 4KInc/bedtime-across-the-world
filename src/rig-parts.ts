import {
  AddEquation,
  CustomBlending,
  Group,
  Material,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  Shape,
  ShapeGeometry,
  ZeroFactor,
} from '@iwsdk/core';

/** Parts the puppet silhouettes are drawn with (puppet-rigs.ts, world-rigs.ts). */

export function mesh(geometry: ShapeGeometry, material: Material, name: string, order: number, z = 0): Mesh {
  const m = new Mesh(geometry, material);
  m.name = name;
  m.renderOrder = order;
  m.position.z = z;
  return m;
}

export function pivot(name: string, x: number, y: number, z: number, child: Mesh): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  g.add(child);
  return g;
}

export function circle(r: number): Shape {
  const s = new Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

const eyeGeo = new ShapeGeometry(circle(0.026), 16);

export function eyeAt(material: Material, x: number, y: number): Mesh {
  const e = mesh(eyeGeo, material, 'eye', 12, 0.001);
  e.position.x = x;
  e.position.y = y;
  return e;
}

/** Thin quad from (x1, y1) to (x2, y2): antler beams and tines. */
export function twig(x1: number, y1: number, x2: number, y2: number, w: number): Shape {
  const a = Math.atan2(y2 - y1, x2 - x1) + Math.PI / 2;
  const nx = Math.cos(a) * w;
  const ny = Math.sin(a) * w;
  const s = new Shape();
  s.moveTo(x1 + nx, y1 + ny);
  s.lineTo(x2 + nx * 0.5, y2 + ny * 0.5);
  s.lineTo(x2 - nx * 0.5, y2 - ny * 0.5);
  s.lineTo(x1 - nx, y1 - ny);
  s.closePath();
  return s;
}

/** Add light to colour without touching alpha, so it glows over passthrough. */
export function glowMaterial(color: number): MeshBasicMaterial {
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
