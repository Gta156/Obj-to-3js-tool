/**
 * samples.ts — a small synthetic OBJ used for instant first paint before the
 * default sample model is fetched from /public/models.
 */

import type { Vec3 } from "../types/engine";
import { vec } from "../utils/pcaMath";

function buildSampleOBJ(): string {
  const lines = ["# Paramesh mechanical demo", "o Base_Plate"];
  let vertexOffset = 1;
  let objectIndex = 0;
  const pushShape = (name: string, vertices: Vec3[], faces: number[][]) => {
    lines.push(`o ${name}`);
    objectIndex += 1;
    vertices.forEach((p) => lines.push(`v ${p.x.toFixed(5)} ${p.y.toFixed(5)} ${p.z.toFixed(5)}`));
    faces.forEach((face) => lines.push(`f ${face.map((id) => id + vertexOffset).join(" ")}`));
    vertexOffset += vertices.length;
  };
  const box = (name: string, center: Vec3, size: Vec3) => {
    const x = size.x / 2;
    const y = size.y / 2;
    const z = size.z / 2;
    const v = [
      vec(center.x - x, center.y - y, center.z - z), vec(center.x + x, center.y - y, center.z - z),
      vec(center.x + x, center.y + y, center.z - z), vec(center.x - x, center.y + y, center.z - z),
      vec(center.x - x, center.y - y, center.z + z), vec(center.x + x, center.y - y, center.z + z),
      vec(center.x + x, center.y + y, center.z + z), vec(center.x - x, center.y + y, center.z + z),
    ];
    pushShape(name, v, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]);
  };
  const cylinder = (name: string, center: Vec3, radius: number, height: number, segments = 18) => {
    const v: Vec3[] = [];
    for (let ring = 0; ring < 2; ring += 1) {
      const yy = center.y + (ring ? height / 2 : -height / 2);
      for (let i = 0; i < segments; i += 1) {
        const a = (i / segments) * Math.PI * 2;
        v.push(vec(center.x + Math.cos(a) * radius, yy, center.z + Math.sin(a) * radius));
      }
    }
    const f: number[][] = [];
    for (let i = 0; i < segments; i += 1) {
      const n = (i + 1) % segments;
      f.push([i, n, segments + n, segments + i]);
    }
    f.push(Array.from({ length: segments }, (_, i) => segments - 1 - i));
    f.push(Array.from({ length: segments }, (_, i) => segments + i));
    pushShape(name, v, f);
  };

  box("Base_Plate", vec(0, 0, 0), vec(12, 0.7, 3.6));
  box("Spine", vec(0, 0.7, 0), vec(10.8, 0.7, 0.8));
  box("Left_Stop", vec(-5.55, 0.72, 0), vec(0.55, 1.45, 3.1));
  box("Right_Stop", vec(5.55, 0.72, 0), vec(0.55, 1.45, 3.1));
  [-4.5, -3, -1.5, 0, 1.5, 3, 4.5].forEach((x, i) => cylinder(`Fastener_${i + 1}`, vec(x, 0.78, -1.1), 0.24, 0.34));
  cylinder("Knob", vec(0, 1.2, 1.15), 0.42, 0.7);
  void objectIndex;
  return lines.join("\n");
}

export const SAMPLE_OBJ = buildSampleOBJ();
