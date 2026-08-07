/**
 * objParser.ts — Wavefront OBJ loader for the geometry engine.
 *
 * Triangulates polygon faces, resolves negative (relative) indices, and tracks
 * object/group boundaries so the decomposition stage can use them as natural
 * part seams (the launcher sample ships ~100 named objects; respecting them
 * produces dramatically cleaner segmentation than blind connected-components).
 */

import type { MeshData, MeshGroup, Vec3 } from "../../types/engine";
import { vec } from "../../utils/pcaMath";

export function parseOBJ(source: string, name = "untitled.obj"): MeshData {
  const vertices: Vec3[] = [];
  const faces: Array<[number, number, number]> = [];
  const faceToGroup: number[] = [];
  const groups: MeshGroup[] = [];
  const groupFaceIds: number[][] = [];
  const groupVertexSets: Array<Set<number>> = [];

  let activeGroupIndex = -1;
  const ensureGroup = (groupName: string) => {
    activeGroupIndex = groups.findIndex((g) => g.name === groupName);
    if (activeGroupIndex === -1) {
      activeGroupIndex = groups.length;
      groups.push({ name: groupName, faceIds: [], vertexCount: 0 });
      groupFaceIds.push([]);
      groupVertexSets.push(new Set());
    }
  };

  const lines = source.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(/\s+/);
    const tag = parts[0];

    if (tag === "v" && parts.length >= 4) {
      const coords = parts.slice(1, 4).map(Number);
      if (coords.every(Number.isFinite)) {
        vertices.push(vec(coords[0], coords[1], coords[2]));
      }
      continue;
    }

    if ((tag === "o" || tag === "g") && parts.length >= 2) {
      const groupName = parts.slice(1).join(" ").trim() || `group${groups.length}`;
      ensureGroup(groupName);
      continue;
    }

    if (tag === "f" && parts.length >= 4) {
      const resolved = parts.slice(1).map((token) => {
        const rawIndex = Number(token.split("/")[0]);
        return rawIndex < 0 ? vertices.length + rawIndex : rawIndex - 1;
      });
      const faceId = faces.length;
      let addedAny = false;
      for (let i = 1; i < resolved.length - 1; i += 1) {
        const tri: [number, number, number] = [resolved[0], resolved[i], resolved[i + 1]];
        if (tri.every((idx) => idx >= 0 && idx < vertices.length)) {
          faces.push(tri);
          faceToGroup.push(activeGroupIndex);
          addedAny = true;
          if (activeGroupIndex >= 0) {
            groupFaceIds[activeGroupIndex].push(faceId + i - 1);
            tri.forEach((idx) => groupVertexSets[activeGroupIndex].add(idx));
          }
        }
      }
      // Ungrouped faces (no preceding o/g) get a synthetic "default" group so
      // every face has a part home. We tag with -1 here and the engine handles it.
      if (addedAny && activeGroupIndex < 0) {
        faceToGroup[faces.length - 1] = -1;
      }
    }
  }

  if (!vertices.length || !faces.length) {
    throw new Error("The OBJ contains no readable vertices or faces.");
  }

  // If some faces were ungrouped, fold them into a single default group.
  const ungrouped = faceToGroup
    .map((g, idx) => (g === -1 ? idx : -1))
    .filter((idx) => idx >= 0);
  if (ungrouped.length) {
    ensureGroup("Default");
    const vset = groupVertexSets[activeGroupIndex];
    ungrouped.forEach((faceId) => {
      groupFaceIds[activeGroupIndex].push(faceId);
      faces[faceId].forEach((idx) => vset.add(idx));
    });
  }

  groups.forEach((g, idx) => {
    g.faceIds = groupFaceIds[idx];
    g.vertexCount = groupVertexSets[idx].size;
  });

  // Weld duplicate vertices by position. Some exporters (e.g. 3dviewer.net, as
  // used by the glock sample) emit one vertex per face corner, which breaks
  // shared-edge adjacency, inflates buffer output and corrupts convex hulls.
  // Welding gives a clean, indexed, manifold-friendly mesh.
  const weldMap = new Map<string, number>();
  const weldedVertices: Vec3[] = [];
  const remap = new Array(vertices.length).fill(0);
  for (let i = 0; i < vertices.length; i += 1) {
    const v = vertices[i];
    const key = `${v.x.toFixed(7)}:${v.y.toFixed(7)}:${v.z.toFixed(7)}`;
    const existing = weldMap.get(key);
    if (existing !== undefined) {
      remap[i] = existing;
    } else {
      const newIndex = weldedVertices.length;
      weldedVertices.push(v);
      weldMap.set(key, newIndex);
      remap[i] = newIndex;
    }
  }
  const weldedFaces = faces.map((f) => [remap[f[0]], remap[f[1]], remap[f[2]]] as [number, number, number]);

  return {
    name,
    sourceBytes: new Blob([source]).size,
    vertices: weldedVertices,
    faces: weldedFaces,
    groups,
    faceToGroup,
  };
}
