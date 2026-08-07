/**
 * planarSegmentation.ts — surface region growing.
 *
 * Clusters contiguous triangles whose normals agree within a configurable
 * angle (coplanarThresholdDegrees). The resulting regions feed both the OBB
 * merge-clustering (single-group meshes like the glock) and the planarity
 * scoring used by the "auto" mode selector.
 */

import type { MeshData, RegionInfo, Vec3 } from "../../types/engine";
import {
  add,
  cross,
  dot,
  length,
  normalize,
  scale,
  sub,
  vec,
} from "../../utils/pcaMath";

function triangleGeometry(mesh: MeshData, faceId: number): { normal: Vec3; area: number } {
  const face = mesh.faces[faceId];
  const a = mesh.vertices[face[0]];
  const b = mesh.vertices[face[1]];
  const c = mesh.vertices[face[2]];
  const raw = cross(sub(b, a), sub(c, a));
  return { normal: normalize(raw), area: length(raw) * 0.5 };
}

/** Half-edge style adjacency: faces sharing two vertices are neighbours. */
export function buildFaceAdjacency(mesh: MeshData): Set<number>[] {
  const edgeMap = new Map<string, number[]>();
  mesh.faces.forEach((face, faceId) => {
    const edges: Array<[number, number]> = [
      [face[0], face[1]],
      [face[1], face[2]],
      [face[2], face[0]],
    ];
    edges.forEach(([a, b]) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const list = edgeMap.get(key) ?? [];
      list.push(faceId);
      edgeMap.set(key, list);
    });
  });

  const adjacency = Array.from({ length: mesh.faces.length }, () => new Set<number>());
  edgeMap.forEach((faceIds) => {
    for (let i = 0; i < faceIds.length; i += 1) {
      for (let j = i + 1; j < faceIds.length; j += 1) {
        adjacency[faceIds[i]].add(faceIds[j]);
        adjacency[faceIds[j]].add(faceIds[i]);
      }
    }
  });
  return adjacency;
}

export interface PlanarSegmentation {
  regions: RegionInfo[];
  faceToRegion: number[];
  /** Fraction of total surface area that lies in strongly-planar regions. */
  planarity: number;
}

export function segmentByNormals(
  mesh: MeshData,
  adjacency: Set<number>[],
  coplanarThresholdDegrees: number,
): PlanarSegmentation {
  const faceGeometry = mesh.faces.map((_, faceId) => triangleGeometry(mesh, faceId));
  const faceToRegion = Array(mesh.faces.length).fill(-1);
  const regions: RegionInfo[] = [];
  const threshold = Math.cos((coplanarThresholdDegrees * Math.PI) / 180);
  let totalArea = 0;

  for (let seed = 0; seed < mesh.faces.length; seed += 1) {
    if (faceToRegion[seed] !== -1) continue;
    const regionId = regions.length;
    const queue = [seed];
    const faceIds: number[] = [];
    const seedNormal = faceGeometry[seed].normal;
    let area = 0;
    let weightedNormal = vec();
    faceToRegion[seed] = regionId;

    let head = 0;
    while (head < queue.length) {
      const faceId = queue[head++];
      faceIds.push(faceId);
      area += faceGeometry[faceId].area;
      totalArea += faceGeometry[faceId].area;
      weightedNormal = add(weightedNormal, scale(faceGeometry[faceId].normal, faceGeometry[faceId].area));
      adjacency[faceId].forEach((neighbour) => {
        if (faceToRegion[neighbour] !== -1) return;
        if (dot(seedNormal, faceGeometry[neighbour].normal) >= threshold) {
          faceToRegion[neighbour] = regionId;
          queue.push(neighbour);
        }
      });
    }

    const fitted = dot(weightedNormal, seedNormal) < 0 ? scale(weightedNormal, -1) : weightedNormal;
    const normal = length(fitted) > 1e-12 ? normalize(fitted) : seedNormal;
    regions.push({
      id: regionId,
      faceIds,
      normal,
      area,
      surface: faceIds.length > 6 ? "planar" : "planar",
      inlierRatio: 1,
      fitError: 0,
    });
  }

  // Planarity = share of area contained in regions larger than a couple of
  // triangles (i.e. real flat panels, not noise shards).
  const planarArea = regions
    .filter((r) => r.faceIds.length >= 2)
    .reduce((sum, r) => sum + r.area, 0);
  const planarity = totalArea > 0 ? planarArea / totalArea : 0;

  return { regions, faceToRegion, planarity };
}
