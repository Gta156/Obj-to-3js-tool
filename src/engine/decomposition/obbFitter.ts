/**
 * obbFitter.ts — Oriented Bounding Box decomposition & part segmentation.
 *
 * Partitioning strategy:
 *   1. Group-aware: when the OBJ declares multiple objects/groups (the launcher
 *      ships ~100 named parts), each group becomes a seed cluster.
 *   2. Connected components: single-group meshes (the glock) seed from manifold
 *      islands.
 *
 * Every seed cluster is then recursively refined with OBB-tree bisection: fit a
 * PCA-oriented box, and if the cluster is not locally box-like, split it along
 * its principal axis at the face-centroid median and recurse. Leaves become
 * parts. This is robust (always terminates, always yields valid oriented
 * boxes) and crucially produces ANGLED OBBs for angled sub-volumes — the
 * barrel, grip and trigger guard keep their true orientation instead of being
 * axis-aligned into a staircase. Free-form leaves that never become box-like
 * are flagged `kind:"unknown"` so the hybrid generator emits them as exact
 * indexed geometry (lossless).
 */

import type {
  ConversionSettings,
  MeshData,
  PartInfo,
  PrimitiveKind,
  Vec3,
} from "../../types/engine";
import {
  add,
  boxVolume,
  centroid,
  dot,
  fitObb,
  getBounds,
  obbResidual,
  quaternionFromAxes,
  scale,
  sub,
  type ObbFit,
} from "../../utils/pcaMath";
import { convexHull } from "./convexHull";
import type { PlanarSegmentation } from "./planarSegmentation";

function gatherVertexIds(mesh: MeshData, faceIds: number[]): number[] {
  const set = new Set<number>();
  for (const faceId of faceIds) {
    const face = mesh.faces[faceId];
    if (!face) continue;
    face.forEach((idx) => set.add(idx));
  }
  return [...set];
}

function faceCenter(mesh: MeshData, faceId: number): Vec3 {
  const f = mesh.faces[faceId];
  const a = mesh.vertices[f[0]];
  const b = mesh.vertices[f[1]];
  const c = mesh.vertices[f[2]];
  return scale(add(add(a, b), c), 1 / 3);
}

export interface LeafCluster {
  faceIds: number[];
  obb: ObbFit;
  inlierRatio: number;
  meanError: number;
  boxLike: boolean;
}

/**
 * Recursively bisect a face cluster along its OBB principal axis until each
 * leaf is locally box-like (most vertices lie near the leaf OBB surface) or
 * small enough to stop.
 */
function obbSplit(
  mesh: MeshData,
  faceIds: number[],
  tolerance: number,
  minVolume: number,
  depth: number,
  maxDepth: number,
  leafInlier: number,
  minFaces: number,
): LeafCluster[] {
  const vertexIds = gatherVertexIds(mesh, faceIds);
  const points = vertexIds.map((idx) => mesh.vertices[idx]);
  const obb = fitObb(points);
  const { meanError, inlierRatio } = obbResidual(points, obb, tolerance);
  const boxLike = inlierRatio >= leafInlier;
  const volume = boxVolume(obb.extents);

  const smallEnough = faceIds.length <= minFaces;
  const deepEnough = depth >= maxDepth;
  const tiny = volume < minVolume;
  if (boxLike || smallEnough || deepEnough || tiny) {
    return [{ faceIds, obb, inlierRatio, meanError, boxLike }];
  }

  // Split along the principal axis at the median projected face centroid.
  const axis = obb.axes[0];
  const projected = faceIds
    .map((faceId) => ({ faceId, p: dot(sub(faceCenter(mesh, faceId), obb.center), axis) }))
    .sort((a, b) => a.p - b.p);
  const mid = Math.floor(projected.length / 2);
  if (mid <= 0 || mid >= projected.length) {
    return [{ faceIds, obb, inlierRatio, meanError, boxLike }];
  }
  const left = projected.slice(0, mid).map((e) => e.faceId);
  const right = projected.slice(mid).map((e) => e.faceId);
  if (!left.length || !right.length) {
    return [{ faceIds, obb, inlierRatio, meanError, boxLike }];
  }
  return [
    ...obbSplit(mesh, left, tolerance, minVolume, depth + 1, maxDepth, leafInlier, minFaces),
    ...obbSplit(mesh, right, tolerance, minVolume, depth + 1, maxDepth, leafInlier, minFaces),
  ];
}

/** Connected components restricted to a face subset. */
function connectedComponents(faceIds: number[], adjacency: Set<number>[]): number[][] {
  const faceSet = new Set(faceIds);
  const visited = new Set<number>();
  const components: number[][] = [];
  for (const seed of faceIds) {
    if (visited.has(seed)) continue;
    const stack = [seed];
    const comp: number[] = [];
    visited.add(seed);
    while (stack.length) {
      const face = stack.pop()!;
      comp.push(face);
      adjacency[face].forEach((nb) => {
        if (faceSet.has(nb) && !visited.has(nb)) {
          visited.add(nb);
          stack.push(nb);
        }
      });
    }
    components.push(comp);
  }
  return components;
}

/**
 * Partition the mesh into OBB parts and materialise PartInfo records
 * (orientation quaternion, residual, hull tightness).
 */
export function partitionIntoParts(
  mesh: MeshData,
  segmentation: PlanarSegmentation,
  adjacency: Set<number>[],
  settings: ConversionSettings,
  modelScale: number,
): PartInfo[] {
  const tolerance = settings.obbFitTolerance * modelScale;
  const minVolume = settings.minRegionVolume * Math.pow(modelScale, 3);

  const meaningfulGroups = mesh.groups.filter((g) => g.faceIds.length > 0);
  let seeds: Array<{ name: string; faceIds: number[] }>;
  if (meaningfulGroups.length >= 2) {
    seeds = meaningfulGroups.map((g) => ({ name: g.name, faceIds: g.faceIds }));
  } else {
    const allFaces = mesh.faces.map((_, idx) => idx);
    seeds = connectedComponents(allFaces, adjacency).map((comp, i) => ({
      name: `component_${i + 1}`,
      faceIds: comp,
    }));
  }

  const parts: PartInfo[] = [];
  for (const seed of seeds) {
    const leaves = obbSplit(mesh, seed.faceIds, tolerance, minVolume, 0, 9, 0.82, 6);
    for (const leaf of leaves) {
      const vertexIds = gatherVertexIds(mesh, leaf.faceIds);
      const points = vertexIds.map((idx) => mesh.vertices[idx]);
      const hull = convexHull(points);
      const tightness = hull.volume > 1e-12 ? boxVolume(leaf.obb.extents) / hull.volume : 1;
      // A part is "box-like" (clean OBB) if the leaf is locally box-like AND
      // the OBB hugs the hull. Otherwise it is free-form -> indexed in hybrid.
      const kind: PrimitiveKind = leaf.boxLike && tightness >= 0.6 ? "obb" : "unknown";

      parts.push({
        id: parts.length,
        name: seed.name,
        faceIds: leaf.faceIds,
        vertexIds,
        vertexCount: vertexIds.length,
        faceCount: leaf.faceIds.length,
        center: leaf.obb.center,
        size: leaf.obb.extents,
        halfExtents: leaf.obb.halfExtents,
        axes: leaf.obb.axes,
        quaternion: quaternionFromAxes(leaf.obb.axes[0], leaf.obb.axes[1], leaf.obb.axes[2]),
        kind,
        obbFitError: leaf.meanError / modelScale,
        obbInlierRatio: leaf.inlierRatio,
        tightness,
        confidence: Math.min(1, leaf.inlierRatio * 0.7 + tightness * 0.3),
        regionCount: new Set(leaf.faceIds.map((f) => segmentation.faceToRegion[f])).size,
      });
    }
  }
  parts.forEach((p, idx) => (p.id = idx));
  return parts;
}

/** Average OBB inlier ratio weighted by vertex count. */
export function averageObbCoverage(parts: PartInfo[]): number {
  if (!parts.length) return 0;
  const totalVerts = parts.reduce((s, p) => s + p.vertexCount, 0) || 1;
  return parts.reduce((s, p) => s + p.obbInlierRatio * p.vertexCount, 0) / totalVerts;
}

/** Average hull tightness weighted by vertex count. */
export function averageHullTightness(parts: PartInfo[]): number {
  if (!parts.length) return 0;
  const totalVerts = parts.reduce((s, p) => s + p.vertexCount, 0) || 1;
  return parts.reduce((s, p) => s + p.tightness * p.vertexCount, 0) / totalVerts;
}

export { getBounds, centroid };
