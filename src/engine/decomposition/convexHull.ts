/**
 * convexHull.ts — incremental 3D convex hull (QuickHull-style).
 *
 * Used by the `convex_hulls` reconstruction mode. Pure TypeScript so it runs
 * in the headless test harness. Every face is wound so its normal points
 * outward from a guaranteed-interior reference point, which keeps the hull
 * consistent and prevents interior points from leaking into the boundary.
 */

import {
  centroid,
  cross,
  dot,
  length,
  scale,
  sub,
} from "../../utils/pcaMath";
import type { Vec3 } from "../../types/engine";

export interface ConvexHull {
  /** Triangle indices into the source point array. */
  indices: number[];
  triangleCount: number;
  surfaceArea: number;
  volume: number;
}

interface Face {
  a: number;
  b: number;
  c: number;
  normal: Vec3;
  offset: number;
  outside: number[];
  removed: boolean;
}

function normalizeSafe(v: Vec3): Vec3 {
  const l = length(v);
  return l > 1e-15 ? scale(v, 1 / l) : v;
}

/**
 * Build a face (a,b,c) wound so its normal points away from `interior`.
 * Returns null if the three points are colinear.
 */
function outwardFace(points: Vec3[], a: number, b: number, c: number, interior: Vec3): Face | null {
  let na = a, nb = b, nc = c;
  let normal = normalizeSafe(cross(sub(points[nb], points[na]), sub(points[nc], points[na])));
  if (length(normal) < 1e-15) return null;
  if (dot(normal, sub(points[na], interior)) < 0) {
    [nb, nc] = [nc, nb];
    normal = scale(normal, -1);
  }
  return { a: na, b: nb, c: nc, normal, offset: dot(normal, points[na]), outside: [], removed: false };
}

/** True if point p is strictly above the face plane (outside the hull). */
function above(face: Face, p: Vec3, eps: number): boolean {
  return dot(face.normal, p) - face.offset > eps;
}

/**
 * Build the convex hull of a point set. Returns an empty hull for degenerate
 * inputs (fewer than 4 non-coplanar points).
 */
export function convexHull(inputPoints: Vec3[], eps = 1e-9): ConvexHull {
  const points = inputPoints;
  if (points.length < 4) return { indices: [], triangleCount: 0, surfaceArea: 0, volume: 0 };

  // Deduplicate indices.
  const seen = new Map<string, number>();
  const unique: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    const key = `${points[i].x.toFixed(7)}:${points[i].y.toFixed(7)}:${points[i].z.toFixed(7)}`;
    if (!seen.has(key)) {
      seen.set(key, i);
      unique.push(i);
    }
  }
  if (unique.length < 4) return { indices: [], triangleCount: 0, surfaceArea: 0, volume: 0 };

  // Four extreme points forming a maximal initial tetrahedron.
  let i0 = unique[0];
  for (const i of unique) if (points[i].x < points[i0].x) i0 = i;
  let i1 = unique[0];
  let bestDist = -1;
  for (const i of unique) {
    const d = length(sub(points[i], points[i0]));
    if (d > bestDist) { bestDist = d; i1 = i; }
  }
  if (bestDist <= eps) return { indices: [], triangleCount: 0, surfaceArea: 0, volume: 0 };

  let i2 = unique[0];
  let bestArea = -1;
  for (const i of unique) {
    if (i === i0 || i === i1) continue;
    const area = length(cross(sub(points[i], points[i0]), sub(points[i1], points[i0])));
    if (area > bestArea) { bestArea = area; i2 = i; }
  }
  if (bestArea <= eps) return { indices: [], triangleCount: 0, surfaceArea: 0, volume: 0 };

  let i3 = unique[0];
  let bestVol = -1;
  for (const i of unique) {
    if (i === i0 || i === i1 || i === i2) continue;
    const v = Math.abs(dot(cross(sub(points[i1], points[i0]), sub(points[i2], points[i0])), sub(points[i], points[i0])));
    if (v > bestVol) { bestVol = v; i3 = i; }
  }
  if (bestVol <= eps) return { indices: [], triangleCount: 0, surfaceArea: 0, volume: 0 };

  // Interior reference = centroid of the seed tetrahedron. This point is
  // strictly inside the tetrahedron and stays strictly inside as the hull
  // grows outward, so it reliably orients every face. (Using the centroid of
  // *all* points would land on a face plane for symmetric inputs like a cube.)
  const interior = centroid([points[i0], points[i1], points[i2], points[i3]]);

  const seedVerts = [i0, i1, i2, i3];
  const faces: Face[] = [];
  // Four faces of the tetrahedron; each omits one seed vertex.
  const tetraFaces: Array<[number, number, number]> = [
    [i0, i2, i1],
    [i0, i1, i3],
    [i1, i2, i3],
    [i0, i3, i2],
  ];
  for (const [a, b, c] of tetraFaces) {
    const f = outwardFace(points, a, b, c, interior);
    if (f) faces.push(f);
  }
  if (faces.length < 4) return { indices: [], triangleCount: 0, surfaceArea: 0, volume: 0 };

  const active = unique.filter((i) => !seedVerts.includes(i));
  for (const idx of active) {
    for (const f of faces) {
      if (above(f, points[idx], eps)) {
        f.outside.push(idx);
        break;
      }
    }
  }

  for (let iter = 0; iter < points.length + 8; iter += 1) {
    // Pick the face with the farthest outside point.
    let face: Face | null = null;
    let farthest = 0;
    for (const f of faces) {
      if (f.removed || f.outside.length === 0) continue;
      let localFar = -Infinity;
      for (const idx of f.outside) {
        const d = dot(f.normal, points[idx]) - f.offset;
        if (d > localFar) localFar = d;
      }
      if (localFar > farthest) { farthest = localFar; face = f; }
    }
    if (!face) break;

    let eye = face.outside[0];
    let eyeDist = -Infinity;
    for (const idx of face.outside) {
      const d = dot(face.normal, points[idx]) - face.offset;
      if (d > eyeDist) { eyeDist = d; eye = idx; }
    }

    const visible = faces.filter((f) => !f.removed && above(f, points[eye], eps));

    // Horizon edges: an edge shared by exactly one visible face.
    const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const edgeCount = new Map<string, number[]>();
    for (const f of visible) {
      const edges: Array<[number, number]> = [[f.a, f.b], [f.b, f.c], [f.c, f.a]];
      for (const [a, b] of edges) {
        const key = edgeKey(a, b);
        edgeCount.set(key, [...(edgeCount.get(key) ?? []), a, b]);
      }
    }
    const horizonEdges: Array<[number, number]> = [];
    for (const [, flat] of edgeCount) {
      if (flat.length === 2) horizonEdges.push([flat[0], flat[1]]);
    }

    const reassign: number[] = [];
    for (const f of visible) {
      f.removed = true;
      for (const idx of f.outside) if (idx !== eye) reassign.push(idx);
    }

    for (const [a, b] of horizonEdges) {
      const f = outwardFace(points, a, b, eye, interior);
      if (f) faces.push(f);
    }

    for (const idx of reassign) {
      for (const f of faces) {
        if (!f.removed && above(f, points[idx], eps)) {
          f.outside.push(idx);
          break;
        }
      }
    }
  }

  const out: number[] = [];
  let area = 0;
  let volume = 0;
  const survivors = faces.filter((f) => !f.removed);
  for (const f of survivors) {
    out.push(f.a, f.b, f.c);
    area += length(cross(sub(points[f.b], points[f.a]), sub(points[f.c], points[f.a]))) * 0.5;
    volume += dot(points[f.a], cross(points[f.b], points[f.c])) / 6;
  }

  return {
    indices: out,
    triangleCount: survivors.length,
    surfaceArea: area,
    volume: Math.abs(volume),
  };
}
