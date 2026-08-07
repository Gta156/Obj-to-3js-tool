/**
 * geometryEngine.ts — orchestrator. Pure TypeScript (no Three.js).
 *
 * Pipeline:
 *   parse OBJ  ->  build face adjacency  ->  planar region segmentation
 *   ->  partition into OBB parts (group-aware or region-merge clustering)
 *   ->  score every reconstruction mode  ->  resolve "auto" into a concrete mode
 *   ->  emit Three.js code via the generator.
 *
 * The "auto" selector the user asked for lives in `scoreModes`: it evaluates
 * each strategy with real metrics (OBB coverage, hull convexity, planarity,
 * compression) and recommends the best mode mathematically.
 */

import type {
  AnalysisResult,
  Axis,
  Bounds,
  ConversionSettings,
  MeshData,
  ModeScore,
  PartInfo,
  ReconstructionMode,
  SymmetryInfo,
  Vec3,
} from "../types/engine";
import { getBounds, scale, sub, vec } from "../utils/pcaMath";
import { convexHull } from "./decomposition/convexHull";
import {
  averageHullTightness,
  averageObbCoverage,
  partitionIntoParts,
} from "./decomposition/obbFitter";
import { buildFaceAdjacency, segmentByNormals } from "./decomposition/planarSegmentation";
import { generateProceduralCode, estimateCodeBytes } from "./generators/threejsCodeGenerator";

/* ----------------------------- symmetry -------------------------------- */

function detectSymmetry(vertices: Vec3[], bounds: Bounds): SymmetryInfo {
  const span = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 0.001);
  const quantum = span * 0.004;
  const key = (p: Vec3) =>
    `${Math.round(p.x / quantum)}:${Math.round(p.y / quantum)}:${Math.round(p.z / quantum)}`;
  const pointSet = new Set(vertices.map(key));
  const step = Math.max(1, Math.floor(vertices.length / 2500));
  const scores: Array<{ axis: Axis; score: number }> = (["x", "y", "z"] as Axis[]).map((axis) => {
    let tested = 0;
    let matched = 0;
    for (let i = 0; i < vertices.length; i += step) {
      const reflected = { ...vertices[i] };
      reflected[axis] = bounds.center[axis] * 2 - reflected[axis];
      matched += pointSet.has(key(reflected)) ? 1 : 0;
      tested += 1;
    }
    return { axis, score: matched / Math.max(tested, 1) };
  });
  const best = scores.sort((a, b) => b.score - a.score)[0];
  const plane = best.axis === "x" ? "YZ" : best.axis === "y" ? "XZ" : "XY";
  return { plane: `${plane} mirror`, axis: best.axis, score: best.score };
}

/* --------------------------- mode scoring ------------------------------ */

function compressionFactor(compression: number): number {
  // 1x -> 0, 10x -> 0.5, 100x -> 1 (log-scaled).
  if (compression <= 1) return 0;
  return Math.min(1, Math.log10(compression) / 2);
}

/** Per-mode convexity: fraction of each part's vertices that lie on its hull. */
function averageConvexity(mesh: MeshData, parts: PartInfo[]): number {
  if (!parts.length) return 0;
  const totalVerts = parts.reduce((s, p) => s + p.vertexCount, 0) || 1;
  let sum = 0;
  for (const part of parts) {
    const points = part.vertexIds.map((vi) => mesh.vertices[vi]);
    const hull = convexHull(points);
    const hullVerts = hull.triangleCount === 0 ? part.vertexCount : new Set(hull.indices).size;
    const convexity = Math.min(1, hullVerts / Math.max(part.vertexCount, 1));
    sum += convexity * part.vertexCount;
  }
  return sum / totalVerts;
}

/** Hybrid fidelity: box parts contribute their OBB inlier, the rest are exact. */
function hybridFidelity(parts: PartInfo[]): number {
  if (!parts.length) return 1;
  const totalVerts = parts.reduce((s, p) => s + p.vertexCount, 0) || 1;
  let sum = 0;
  for (const part of parts) {
    sum += (part.kind === "obb" ? part.obbInlierRatio : 1) * part.vertexCount;
  }
  return sum / totalVerts;
}

function scoreModes(
  mesh: MeshData,
  parts: PartInfo[],
): ModeScore[] {
  const obbCoverage = averageObbCoverage(parts);
  const hullTightness = averageHullTightness(parts);
  const convexity = averageConvexity(mesh, parts);
  const hybridFid = hybridFidelity(parts);

  const modes: Array<{ mode: ReconstructionMode; fidelity: number; reason: string }> = [
    {
      mode: "indexed_buffer",
      fidelity: 1,
      reason: "Lossless BufferGeometry — exact vertex-for-vertex reproduction.",
    },
    {
      mode: "hybrid",
      fidelity: hybridFid,
      reason: `OBB for box-like parts (${Math.round(hybridFid * 100)}% exact), indexed geometry elsewhere.`,
    },
    {
      mode: "obb_primitives",
      fidelity: obbCoverage,
      reason: `PCA-oriented boxes hug ${(obbCoverage * 100).toFixed(0)}% of vertices; angled features keep their angle.`,
    },
    {
      mode: "convex_hulls",
      fidelity: convexity,
      reason: `Convex decomposition — ${Math.round(convexity * 100)}% of vertices are hull vertices (convexity ${hullTightness.toFixed(2)}).`,
    },
  ];

  return modes.map((m) => {
    const compression = mesh.sourceBytes / Math.max(estimateCodeBytes(mesh, m.mode, true), 1);
    const score = 0.72 * m.fidelity + 0.28 * compressionFactor(compression);
    return {
      mode: m.mode,
      fidelity: m.fidelity,
      compression,
      score: Math.round(score * 1000) / 1000,
      reason: `${m.reason} (compression ${compression.toFixed(1)}x)`,
    };
  });
}

/* ------------------------------ engine --------------------------------- */

export interface AnalyzeOptions {
  settings: ConversionSettings;
  /** Force a concrete mode, bypassing "auto". Mainly for the test harness. */
  forceMode?: ReconstructionMode;
}

export function analyzeMesh(mesh: MeshData, options: AnalyzeOptions): AnalysisResult {
  const startTime = performance.now();
  const adjacency = buildFaceAdjacency(mesh);
  const segmentation = segmentByNormals(mesh, adjacency, options.settings.coplanarThresholdDegrees);

  const bounds = getBounds(mesh.vertices);
  const modelScale = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1e-6);
  const parts = partitionIntoParts(mesh, segmentation, adjacency, options.settings, modelScale);

  const scores = scoreModes(mesh, parts);
  const resolvedMode: ReconstructionMode =
    options.forceMode ?? (options.settings.reconstructionMode === "auto"
      ? [...scores].sort((a, b) => b.score - a.score)[0].mode
      : options.settings.reconstructionMode);

  const obbCoverage = averageObbCoverage(parts);
  const hullTightness = averageHullTightness(parts);
  const symmetry = detectSymmetry(mesh.vertices, bounds);

  const fidelityByMode: Record<ReconstructionMode, number> = {
    indexed_buffer: 1,
    hybrid: hybridFidelity(parts),
    obb_primitives: obbCoverage,
    convex_hulls: averageConvexity(mesh, parts),
  };

  const generated = generateProceduralCode(mesh, {
    parts,
    regions: segmentation.regions,
    faceToRegion: segmentation.faceToRegion,
    faceToPart: [],
    bounds,
    symmetry,
    fidelity: fidelityByMode[resolvedMode],
    generatedBytes: 0,
    durationMs: 0,
    mode: resolvedMode,
    scores,
    metrics: {
      vertexCount: mesh.vertices.length,
      faceCount: mesh.faces.length,
      planarity: segmentation.planarity,
      obbCoverage,
      hullTightness,
      partCount: parts.length,
    },
  } as AnalysisResult, options.settings);

  const faceToPart = Array(mesh.faces.length).fill(-1);
  parts.forEach((part) => part.faceIds.forEach((faceId) => (faceToPart[faceId] = part.id)));

  return {
    parts,
    regions: segmentation.regions,
    faceToRegion: segmentation.faceToRegion,
    faceToPart,
    bounds,
    symmetry,
    fidelity: Math.max(0, Math.min(1, fidelityByMode[resolvedMode])),
    generatedBytes: generated.bytes,
    durationMs: performance.now() - startTime,
    mode: resolvedMode,
    scores,
    metrics: {
      vertexCount: mesh.vertices.length,
      faceCount: mesh.faces.length,
      planarity: segmentation.planarity,
      obbCoverage,
      hullTightness,
      partCount: parts.length,
    },
  };
}

export { generateProceduralCode } from "./generators/threejsCodeGenerator";
export { parseOBJ } from "./parsers/objParser";
export { SAMPLE_OBJ } from "./samples";

// Re-export commonly used helpers for the UI/tests.
export { getBounds, sub, scale, vec };
