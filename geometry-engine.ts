export type Axis = "x" | "y" | "z";
export type PrimitiveKind =
  | "box"
  | "cylinder"
  | "extrusion"
  | "lathe"
  | "plane"
  | "unknown";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MeshData {
  name: string;
  sourceBytes: number;
  vertices: Vec3[];
  faces: Array<[number, number, number]>;
}

export interface RegionInfo {
  id: number;
  faceIds: number[];
  normal: Vec3;
  area: number;
  surface: "planar" | "curved";
  inlierRatio: number;
  fitError: number;
}

export interface ComponentInfo {
  id: number;
  faceIds: number[];
  vertexIds: number[];
  center: Vec3;
  size: Vec3;
  kind: PrimitiveKind;
  axis: Axis;
  confidence: number;
  regionCount: number;
}

export interface PatternInfo {
  id: number;
  kind: PrimitiveKind;
  componentIds: number[];
  count: number;
  axis: Axis;
  spacing: number;
  start: number;
  confidence: number;
}

export interface AnalysisResult {
  regions: RegionInfo[];
  components: ComponentInfo[];
  patterns: PatternInfo[];
  faceToRegion: number[];
  faceToComponent: number[];
  bounds: { min: Vec3; max: Vec3; center: Vec3; size: Vec3 };
  symmetry: { plane: string; axis: Axis; score: number };
  fidelity: number;
  generatedBytes: number;
  durationMs: number;
}

const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
const scale = (a: Vec3, n: number): Vec3 => vec(a.x * n, a.y * n, a.z * n);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const normalize = (a: Vec3): Vec3 => {
  const l = length(a) || 1;
  return scale(a, 1 / l);
};

function triangleNormal(mesh: MeshData, faceId: number) {
  const face = mesh.faces[faceId];
  const a = mesh.vertices[face[0]];
  const b = mesh.vertices[face[1]];
  const c = mesh.vertices[face[2]];
  const raw = cross(sub(b, a), sub(c, a));
  return { normal: normalize(raw), area: length(raw) * 0.5 };
}

function buildAdjacency(mesh: MeshData) {
  const edgeMap = new Map<string, number[]>();
  mesh.faces.forEach((face, faceId) => {
    const edges: Array<[number, number]> = [
      [face[0], face[1]],
      [face[1], face[2]],
      [face[2], face[0]],
    ];
    edges.forEach(([a, b]) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const entries = edgeMap.get(key) ?? [];
      entries.push(faceId);
      edgeMap.set(key, entries);
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

function getBounds(vertices: Vec3[]) {
  const min = vec(Infinity, Infinity, Infinity);
  const max = vec(-Infinity, -Infinity, -Infinity);
  vertices.forEach((point) => {
    min.x = Math.min(min.x, point.x);
    min.y = Math.min(min.y, point.y);
    min.z = Math.min(min.z, point.z);
    max.x = Math.max(max.x, point.x);
    max.y = Math.max(max.y, point.y);
    max.z = Math.max(max.z, point.z);
  });
  const size = sub(max, min);
  return { min, max, center: scale(add(min, max), 0.5), size };
}

function fitPlaneRansac(mesh: MeshData, faceIds: number[], fitTolerance?: number) {
  const vertexIds = new Set<number>();
  faceIds.forEach((faceId) => mesh.faces[faceId].forEach((vertexId) => vertexIds.add(vertexId)));
  const allPoints = [...vertexIds].map((vertexId) => mesh.vertices[vertexId]);
  const step = Math.max(1, Math.floor(allPoints.length / 1200));
  const points = allPoints.filter((_, index) => index % step === 0);
  if (points.length < 3) return { normal: vec(0, 1, 0), inlierRatio: 0, fitError: Infinity };

  const bounds = getBounds(points);
  const tolerance = Math.max(fitTolerance ?? length(bounds.size) * 0.0025, 1e-6);
  let state = (faceIds[0] + 1) * 2654435761;
  const randomIndex = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state % points.length;
  };
  let bestNormal = vec(0, 1, 0);
  let bestOrigin = points[0];
  let bestInliers = -1;
  const iterations = Math.min(36, Math.max(8, points.length * 2));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const aIndex = randomIndex();
    let bIndex = randomIndex();
    let cIndex = randomIndex();
    if (bIndex === aIndex) bIndex = (bIndex + 1) % points.length;
    while (cIndex === aIndex || cIndex === bIndex) cIndex = (cIndex + 1) % points.length;
    const candidate = normalize(cross(sub(points[bIndex], points[aIndex]), sub(points[cIndex], points[aIndex])));
    if (length(candidate) < 0.5) continue;
    const inliers = points.reduce((count, point) =>
      count + (Math.abs(dot(candidate, sub(point, points[aIndex]))) <= tolerance ? 1 : 0), 0);
    if (inliers > bestInliers) {
      bestInliers = inliers;
      bestNormal = candidate;
      bestOrigin = points[aIndex];
    }
  }

  const distances = points.map((point) => Math.abs(dot(bestNormal, sub(point, bestOrigin))));
  const inlierDistances = distances.filter((distance) => distance <= tolerance);
  return {
    normal: bestNormal,
    inlierRatio: inlierDistances.length / points.length,
    fitError: inlierDistances.reduce((sum, distance) => sum + distance, 0) / Math.max(inlierDistances.length, 1),
  };
}

function bestRotationalAxis(size: Vec3): Axis {
  const pairs: Array<{ axis: Axis; delta: number }> = [
    { axis: "x", delta: Math.abs(size.y - size.z) },
    { axis: "y", delta: Math.abs(size.x - size.z) },
    { axis: "z", delta: Math.abs(size.x - size.y) },
  ];
  return pairs.sort((a, b) => a.delta - b.delta)[0].axis;
}

function largestAxis(size: Vec3): Axis {
  return (["x", "y", "z"] as Axis[]).sort((a, b) => size[b] - size[a])[0];
}

function inferMedialAxis(points: Vec3[]): Axis {
  const center = scale(points.reduce((sum, point) => add(sum, point), vec()), 1 / points.length);
  const covariance = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  points.forEach((point) => {
    const offset = sub(point, center);
    const values = [offset.x, offset.y, offset.z];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) covariance[row][column] += values[row] * values[column];
    }
  });
  let direction = [0.577, 0.577, 0.577];
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const next = covariance.map((row) => row.reduce((sum, value, index) => sum + value * direction[index], 0));
    const magnitude = Math.hypot(...next) || 1;
    direction = next.map((value) => value / magnitude);
  }
  const index = direction.map(Math.abs).indexOf(Math.max(...direction.map(Math.abs)));
  return (["x", "y", "z"] as Axis[])[index];
}

function countLevels(points: Vec3[], axis: Axis, tolerance: number) {
  const levels: number[] = [];
  points
    .map((point) => point[axis])
    .sort((a, b) => a - b)
    .forEach((value) => {
      if (!levels.length || Math.abs(value - levels[levels.length - 1]) > tolerance) levels.push(value);
    });
  return levels.length;
}

function crossSectionSimilarity(points: Vec3[], axis: Axis, size: Vec3) {
  const axes = (["x", "y", "z"] as Axis[]).filter((item) => item !== axis);
  let min = Infinity;
  let max = -Infinity;
  points.forEach((point) => {
    min = Math.min(min, point[axis]);
    max = Math.max(max, point[axis]);
  });
  const endTolerance = Math.max((max - min) * 0.015, 1e-6);
  const quantumA = Math.max(size[axes[0]] * 0.015, 1e-6);
  const quantumB = Math.max(size[axes[1]] * 0.015, 1e-6);
  const signature = (point: Vec3) =>
    `${Math.round(point[axes[0]] / quantumA)}:${Math.round(point[axes[1]] / quantumB)}`;
  const start = new Set(points.filter((point) => Math.abs(point[axis] - min) <= endTolerance).map(signature));
  const end = new Set(points.filter((point) => Math.abs(point[axis] - max) <= endTolerance).map(signature));
  if (!start.size || !end.size) return 0;
  let intersection = 0;
  start.forEach((key) => { if (end.has(key)) intersection += 1; });
  return intersection / Math.max(start.size, end.size);
}

function classifyComponent(
  points: Vec3[],
  size: Vec3,
  vertexCount: number,
  regionCount: number,
) {
  const axis = bestRotationalAxis(size);
  const radialAxes = (["x", "y", "z"] as Axis[]).filter((item) => item !== axis);
  const radialA = size[radialAxes[0]];
  const radialB = size[radialAxes[1]];
  const radialMatch = Math.abs(radialA - radialB) / Math.max(radialA, radialB, 0.001);
  const levels = countLevels(points, axis, Math.max(size[axis], 1) * 0.002);

  if (vertexCount > 12 && radialMatch < 0.08) {
    const centerA = points.reduce((sum, item) => sum + item[radialAxes[0]], 0) / points.length;
    const centerB = points.reduce((sum, item) => sum + item[radialAxes[1]], 0) / points.length;
    const radialDistances = points.map((point) => {
      return Math.hypot(point[radialAxes[0]] - centerA, point[radialAxes[1]] - centerB);
    });
    const meanRadius = radialDistances.reduce((sum, radius) => sum + radius, 0) / radialDistances.length;
    const radialError = radialDistances.reduce((sum, radius) => sum + Math.abs(radius - meanRadius), 0)
      / Math.max(radialDistances.length * meanRadius, 0.001);
    if (levels > 2) return { kind: "lathe" as const, axis, confidence: Math.max(0.82, 1 - radialError * 0.35) };
    return { kind: "cylinder" as const, axis, confidence: Math.max(0.82, 1 - radialError * 2) };
  }

  const extrusionAxis = inferMedialAxis(points);
  const dimensions = [size.x, size.y, size.z].sort((a, b) => b - a);
  const sectionMatch = crossSectionSimilarity(points, extrusionAxis, size);
  if (vertexCount <= 12 || regionCount >= 5) {
    if (dimensions[0] / Math.max(dimensions[1], 0.001) > 2.3 && sectionMatch > 0.7) {
      return { kind: "extrusion" as const, axis: extrusionAxis, confidence: 0.9 + sectionMatch * 0.09 };
    }
    return { kind: "box" as const, axis: extrusionAxis, confidence: 0.99 };
  }

  return { kind: "unknown" as const, axis: largestAxis(size), confidence: 0.61 };
}

function inferPatterns(components: ComponentInfo[]) {
  const buckets = new Map<string, ComponentInfo[]>();
  components.forEach((component) => {
    const dims = [component.size.x, component.size.y, component.size.z]
      .map((value) => Math.round(value * 100) / 100)
      .join(":");
    const key = `${component.kind}:${dims}:${component.vertexIds.length}`;
    buckets.set(key, [...(buckets.get(key) ?? []), component]);
  });

  const patterns: PatternInfo[] = [];
  buckets.forEach((bucket) => {
    if (bucket.length < 3) return;
    const centerBounds = getBounds(bucket.map((component) => component.center));
    const axis = largestAxis(centerBounds.size);
    const ordered = [...bucket].sort((a, b) => a.center[axis] - b.center[axis]);
    const gaps = ordered.slice(1).map((component, index) => component.center[axis] - ordered[index].center[axis]);
    const spacing = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
    const deviation = gaps.reduce((sum, gap) => sum + Math.abs(gap - spacing), 0) / gaps.length;
    if (deviation > Math.max(Math.abs(spacing) * 0.06, 0.001)) return;
    patterns.push({
      id: patterns.length,
      kind: bucket[0].kind,
      componentIds: ordered.map((component) => component.id),
      count: bucket.length,
      axis,
      spacing,
      start: ordered[0].center[axis],
      confidence: Math.max(0.82, 1 - deviation / Math.max(Math.abs(spacing), 0.001)),
    });
  });
  return patterns;
}

function detectSymmetry(mesh: MeshData, bounds: ReturnType<typeof getBounds>) {
  const span = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 0.001);
  const quantum = span * 0.003;
  const key = (point: Vec3) =>
    `${Math.round(point.x / quantum)}:${Math.round(point.y / quantum)}:${Math.round(point.z / quantum)}`;
  const pointSet = new Set(mesh.vertices.map(key));
  const sampleStep = Math.max(1, Math.floor(mesh.vertices.length / 3000));
  const scores = (["x", "y", "z"] as Axis[]).map((axis) => {
    let tested = 0;
    let matched = 0;
    for (let i = 0; i < mesh.vertices.length; i += sampleStep) {
      const reflected = { ...mesh.vertices[i] };
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

export function analyzeMesh(
  mesh: MeshData,
  options: { normalAngle?: number; fitTolerance?: number } = {},
): AnalysisResult {
  const startTime = performance.now();
  const adjacency = buildAdjacency(mesh);
  const faceGeometry = mesh.faces.map((_, faceId) => triangleNormal(mesh, faceId));
  const faceToRegion = Array(mesh.faces.length).fill(-1);
  const regions: RegionInfo[] = [];
  const normalThreshold = Math.cos(((options.normalAngle ?? 18) * Math.PI) / 180);

  for (let seed = 0; seed < mesh.faces.length; seed += 1) {
    if (faceToRegion[seed] !== -1) continue;
    const regionId = regions.length;
    const queue = [seed];
    const faceIds: number[] = [];
    const seedNormal = faceGeometry[seed].normal;
    let area = 0;
    let weightedNormal = vec();
    faceToRegion[seed] = regionId;

    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const faceId = queue[queueIndex++];
      faceIds.push(faceId);
      area += faceGeometry[faceId].area;
      weightedNormal = add(weightedNormal, scale(faceGeometry[faceId].normal, faceGeometry[faceId].area));
      adjacency[faceId].forEach((neighbor) => {
        if (faceToRegion[neighbor] !== -1) return;
        if (dot(seedNormal, faceGeometry[neighbor].normal) >= normalThreshold) {
          faceToRegion[neighbor] = regionId;
          queue.push(neighbor);
        }
      });
    }
    const planeFit = fitPlaneRansac(mesh, faceIds, options.fitTolerance);
    const fittedNormal = dot(planeFit.normal, weightedNormal) < 0 ? scale(planeFit.normal, -1) : planeFit.normal;
    regions.push({
      id: regionId,
      faceIds,
      normal: fittedNormal,
      area,
      surface: planeFit.inlierRatio > 0.97 ? "planar" : "curved",
      inlierRatio: planeFit.inlierRatio,
      fitError: planeFit.fitError,
    });
  }

  const faceToComponent = Array(mesh.faces.length).fill(-1);
  const components: ComponentInfo[] = [];
  for (let seed = 0; seed < mesh.faces.length; seed += 1) {
    if (faceToComponent[seed] !== -1) continue;
    const componentId = components.length;
    const queue = [seed];
    const faceIds: number[] = [];
    const vertexIds = new Set<number>();
    faceToComponent[seed] = componentId;
    let queueIndex = 0;
    while (queueIndex < queue.length) {
      const faceId = queue[queueIndex++];
      faceIds.push(faceId);
      mesh.faces[faceId].forEach((vertexId) => vertexIds.add(vertexId));
      adjacency[faceId].forEach((neighbor) => {
        if (faceToComponent[neighbor] !== -1) return;
        faceToComponent[neighbor] = componentId;
        queue.push(neighbor);
      });
    }
    const vertices = [...vertexIds].map((id) => mesh.vertices[id]);
    const componentBounds = getBounds(vertices);
    const regionCount = new Set(faceIds.map((faceId) => faceToRegion[faceId])).size;
    const classification = classifyComponent(vertices, componentBounds.size, vertexIds.size, regionCount);
    components.push({
      id: componentId,
      faceIds,
      vertexIds: [...vertexIds],
      center: componentBounds.center,
      size: componentBounds.size,
      regionCount,
      ...classification,
    });
  }

  const bounds = getBounds(mesh.vertices);
  const patterns = inferPatterns(components);
  const primitiveFaces = components
    .filter((component) => component.kind !== "unknown")
    .reduce((total, component) => total + component.faceIds.length, 0);
  const abstractionCount = components.length - patterns.reduce((sum, pattern) => sum + pattern.count - 1, 0);
  const generatedBytes = 1480 + abstractionCount * 225 + patterns.length * 340;

  return {
    regions,
    components,
    patterns,
    faceToRegion,
    faceToComponent,
    bounds,
    symmetry: detectSymmetry(mesh, bounds),
    fidelity: primitiveFaces / Math.max(mesh.faces.length, 1),
    generatedBytes,
    durationMs: performance.now() - startTime,
  };
}

export function parseOBJ(source: string, name = "untitled.obj"): MeshData {
  const vertices: Vec3[] = [];
  const faces: Array<[number, number, number]> = [];

  source.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/\s+/);
    if (parts[0] === "v" && parts.length >= 4) {
      const coordinates = parts.slice(1, 4).map(Number);
      if (coordinates.every(Number.isFinite)) vertices.push(vec(coordinates[0], coordinates[1], coordinates[2]));
    }
    if (parts[0] === "f" && parts.length >= 4) {
      const indices = parts.slice(1).map((token) => {
        const rawIndex = Number(token.split("/")[0]);
        return rawIndex < 0 ? vertices.length + rawIndex : rawIndex - 1;
      });
      for (let i = 1; i < indices.length - 1; i += 1) {
        if ([indices[0], indices[i], indices[i + 1]].every((index) => index >= 0 && index < vertices.length)) {
          faces.push([indices[0], indices[i], indices[i + 1]]);
        }
      }
    }
  });

  if (!vertices.length || !faces.length) throw new Error("The OBJ contains no readable vertices or faces.");
  return { name, sourceBytes: new Blob([source]).size, vertices, faces };
}

function sampleOBJ() {
  const lines = ["# Paramesh linear guide demo", "o LinearGuide"];
  let vertexOffset = 1;
  const pushShape = (name: string, vertices: Vec3[], faces: number[][]) => {
    lines.push(`g ${name}`);
    vertices.forEach((point) => lines.push(`v ${point.x.toFixed(5)} ${point.y.toFixed(5)} ${point.z.toFixed(5)}`));
    faces.forEach((face) => lines.push(`f ${face.map((id) => id + vertexOffset).join(" ")}`));
    vertexOffset += vertices.length;
  };
  const box = (name: string, center: Vec3, size: Vec3) => {
    const x = size.x / 2;
    const y = size.y / 2;
    const z = size.z / 2;
    const vertices = [
      vec(center.x - x, center.y - y, center.z - z), vec(center.x + x, center.y - y, center.z - z),
      vec(center.x + x, center.y + y, center.z - z), vec(center.x - x, center.y + y, center.z - z),
      vec(center.x - x, center.y - y, center.z + z), vec(center.x + x, center.y - y, center.z + z),
      vec(center.x + x, center.y + y, center.z + z), vec(center.x - x, center.y + y, center.z + z),
    ];
    pushShape(name, vertices, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]]);
  };
  const cylinder = (name: string, center: Vec3, radius: number, height: number, segments = 20) => {
    const vertices: Vec3[] = [];
    for (let ring = 0; ring < 2; ring += 1) {
      const y = center.y + (ring ? height / 2 : -height / 2);
      for (let i = 0; i < segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        vertices.push(vec(center.x + Math.cos(angle) * radius, y, center.z + Math.sin(angle) * radius));
      }
    }
    const faces: number[][] = [];
    for (let i = 0; i < segments; i += 1) {
      const next = (i + 1) % segments;
      faces.push([i, next, segments + next, segments + i]);
    }
    faces.push(Array.from({ length: segments }, (_, index) => segments - 1 - index));
    faces.push(Array.from({ length: segments }, (_, index) => segments + index));
    pushShape(name, vertices, faces);
  };
  const lathe = (name: string, center: Vec3, profile: Array<[number, number]>, segments = 24) => {
    const vertices: Vec3[] = [];
    profile.forEach(([radius, y]) => {
      for (let i = 0; i < segments; i += 1) {
        const angle = (i / segments) * Math.PI * 2;
        vertices.push(vec(center.x + Math.cos(angle) * radius, center.y + y, center.z + Math.sin(angle) * radius));
      }
    });
    const faces: number[][] = [];
    for (let ring = 0; ring < profile.length - 1; ring += 1) {
      for (let i = 0; i < segments; i += 1) {
        const next = (i + 1) % segments;
        faces.push([ring * segments + i, ring * segments + next, (ring + 1) * segments + next, (ring + 1) * segments + i]);
      }
    }
    faces.push(Array.from({ length: segments }, (_, index) => segments - 1 - index));
    const last = (profile.length - 1) * segments;
    faces.push(Array.from({ length: segments }, (_, index) => last + index));
    pushShape(name, vertices, faces);
  };

  box("extruded_base", vec(0, 0, 0), vec(12, 0.7, 3.6));
  box("guide_spine", vec(0, 0.7, 0), vec(10.8, 0.7, 0.8));
  box("left_stop", vec(-5.55, 0.72, 0), vec(0.55, 1.45, 3.1));
  box("right_stop", vec(5.55, 0.72, 0), vec(0.55, 1.45, 3.1));
  [-4.5, -3, -1.5, 0, 1.5, 3, 4.5].forEach((x, index) =>
    cylinder(`fastener_${index + 1}`, vec(x, 0.78, -1.1), 0.24, 0.34),
  );
  lathe("adjustment_knob", vec(0, 1.2, 1.15), [[0.28, -0.35], [0.4, -0.18], [0.4, 0.18], [0.28, 0.35]]);
  return lines.join("\n");
}

export const SAMPLE_OBJ = sampleOBJ();

function formatNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? rounded.toFixed(1) : String(rounded);
}

function axisRotation(axis: Axis) {
  if (axis === "x") return "rotateZ(-Math.PI / 2);";
  if (axis === "z") return "rotateX(Math.PI / 2);";
  return "";
}

export function generateProceduralCode(mesh: MeshData, result: AnalysisResult) {
  const patternedIds = new Set(result.patterns.flatMap((pattern) => pattern.componentIds));
  const primary = [...result.components].sort((a, b) =>
    b.size.x * b.size.y * b.size.z - a.size.x * a.size.y * a.size.z,
  )[0];
  const firstPattern = result.patterns[0];
  const repeatedFeature = firstPattern ? result.components[firstPattern.componentIds[0]] : undefined;
  const repeatedRadialAxes = repeatedFeature
    ? (["x", "y", "z"] as Axis[]).filter((axis) => axis !== repeatedFeature.axis)
    : (["x", "z"] as Axis[]);
  const repeatedRadius = repeatedFeature
    ? (repeatedFeature.size[repeatedRadialAxes[0]] + repeatedFeature.size[repeatedRadialAxes[1]]) / 4
    : 0.25;
  const lines = [
    'import * as THREE from "three";',
    "",
    "export interface ParametricPartParams {",
    "  finish: number;",
    "  primaryX: number;",
    "  primaryY: number;",
    "  primaryZ: number;",
    "  repeatedRadius: number;",
    "  patternCount: number;",
    "  patternSpacing: number;",
    "}",
    "",
    "const defaults: ParametricPartParams = {",
    "  finish: 0x8fa5a5,",
    `  primaryX: ${formatNumber(primary.size.x)},`,
    `  primaryY: ${formatNumber(primary.size.y)},`,
    `  primaryZ: ${formatNumber(primary.size.z)},`,
    `  repeatedRadius: ${formatNumber(repeatedRadius)},`,
    `  patternCount: ${firstPattern?.count ?? 1},`,
    `  patternSpacing: ${formatNumber(firstPattern?.spacing ?? 0)},`,
    "};",
    "",
    "export function createParametricPart(input: Partial<ParametricPartParams> = {}) {",
    "  const params = { ...defaults, ...input };",
    "  const root = new THREE.Group();",
    `  root.name = "${mesh.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_")}";`,
    "  const material = new THREE.MeshStandardMaterial({",
    "    color: params.finish, metalness: 0.72, roughness: 0.28,",
    "  });",
    "  const structure = new THREE.Group();",
    "  const details = new THREE.Group();",
    "  const repeatedFeatures = new THREE.Group();",
    '  structure.name = "structure";',
    '  details.name = "details";',
    '  repeatedFeatures.name = "patterns";',
    "  root.add(structure, details, repeatedFeatures);",
    "",
  ];

  result.components.forEach((component) => {
    if (patternedIds.has(component.id)) return;
    const id = `feature${component.id + 1}`;
    const size = component.size;
    const position = component.center;
    const dimension = (axis: Axis) => component.id === primary.id
      ? `params.primary${axis.toUpperCase()}`
      : formatNumber(size[axis]);
    if (component.kind === "lathe") {
      const radius = Math.max(size.x, size.z) / 2;
      lines.push(
        `  // Rotational profile inferred from ${component.regionCount} normal regions.`,
        `  const ${id}Profile = [`,
        `    new THREE.Vector2(${formatNumber(radius * 0.7)}, ${formatNumber(-size.y / 2)}),`,
        `    new THREE.Vector2(${formatNumber(radius)}, ${formatNumber(-size.y * 0.25)}),`,
        `    new THREE.Vector2(${formatNumber(radius)}, ${formatNumber(size.y * 0.25)}),`,
        `    new THREE.Vector2(${formatNumber(radius * 0.7)}, ${formatNumber(size.y / 2)}),`,
        "  ];",
        `  const ${id} = new THREE.Mesh(new THREE.LatheGeometry(${id}Profile, 32), material);`,
      );
    } else if (component.kind === "cylinder") {
      const radialAxes = (["x", "y", "z"] as Axis[]).filter((axis) => axis !== component.axis);
      const radius = (size[radialAxes[0]] + size[radialAxes[1]]) / 4;
      lines.push(
        `  const ${id}Geometry = new THREE.CylinderGeometry(${formatNumber(radius)}, ${formatNumber(radius)}, ${formatNumber(size[component.axis])}, 32);`,
      );
      const rotation = axisRotation(component.axis);
      if (rotation) lines.push(`  ${id}Geometry.${rotation}`);
      lines.push(`  const ${id} = new THREE.Mesh(${id}Geometry, material);`);
    } else if (component.kind === "extrusion") {
      const crossAxes = (["x", "y", "z"] as Axis[]).filter((axis) => axis !== component.axis);
      const widthAxis = component.axis === "x" ? "z" : crossAxes[0];
      const heightAxis = component.axis === "x" ? "y" : crossAxes[1];
      const width = dimension(widthAxis);
      const height = dimension(heightAxis);
      lines.push(
        `  const ${id}Profile = new THREE.Shape()`,
        `    .moveTo(-${width} / 2, -${height} / 2)`,
        `    .lineTo(${width} / 2, -${height} / 2)`,
        `    .lineTo(${width} / 2, ${height} / 2)`,
        `    .lineTo(-${width} / 2, ${height} / 2)`,
        "    .closePath();",
        `  const ${id}Geometry = new THREE.ExtrudeGeometry(${id}Profile, {`,
        `    depth: ${dimension(component.axis)}, bevelEnabled: false,`,
        "  });",
        `  ${id}Geometry.center();`,
      );
      if (component.axis === "x") lines.push(`  ${id}Geometry.rotateY(Math.PI / 2);`);
      if (component.axis === "y") lines.push(`  ${id}Geometry.rotateX(Math.PI / 2);`);
      lines.push(`  const ${id} = new THREE.Mesh(${id}Geometry, material);`);
    } else {
      lines.push(
        `  const ${id} = new THREE.Mesh(`,
        `    new THREE.BoxGeometry(${dimension("x")}, ${dimension("y")}, ${dimension("z")}), material,`,
        "  );",
      );
    }
    const parent = component.kind === "box" || component.kind === "extrusion" ? "structure" : "details";
    lines.push(
      `  ${id}.position.set(${formatNumber(position.x)}, ${formatNumber(position.y)}, ${formatNumber(position.z)});`,
      `  ${parent}.add(${id});`,
      "",
    );
  });

  result.patterns.forEach((pattern, patternIndex) => {
    const component = result.components[pattern.componentIds[0]];
    const radialAxes = (["x", "y", "z"] as Axis[]).filter((axis) => axis !== component.axis);
    const radius = (component.size[radialAxes[0]] + component.size[radialAxes[1]]) / 4;
    const center = { ...component.center };
    center[pattern.axis] = 0;
    lines.push(
      `  // ${pattern.count}-member linear pattern, ${(pattern.confidence * 100).toFixed(1)}% confidence.`,
      `  const repeatGeometry${patternIndex + 1} = new THREE.CylinderGeometry(`,
      `    params.repeatedRadius || ${formatNumber(radius)}, params.repeatedRadius || ${formatNumber(radius)}, ${formatNumber(component.size[component.axis])}, 24,`,
      "  );",
    );
    const rotation = axisRotation(component.axis);
    if (rotation) lines.push(`  repeatGeometry${patternIndex + 1}.${rotation}`);
    lines.push(
      `  const repeated${patternIndex + 1} = new THREE.InstancedMesh(repeatGeometry${patternIndex + 1}, material, params.patternCount);`,
      `  const matrix${patternIndex + 1} = new THREE.Matrix4();`,
      "  for (let i = 0; i < params.patternCount; i += 1) {",
      `    matrix${patternIndex + 1}.makeTranslation(${formatNumber(center.x)}${pattern.axis === "x" ? ` + ${formatNumber(pattern.start)} + i * params.patternSpacing` : ""}, ${formatNumber(center.y)}${pattern.axis === "y" ? ` + ${formatNumber(pattern.start)} + i * params.patternSpacing` : ""}, ${formatNumber(center.z)}${pattern.axis === "z" ? ` + ${formatNumber(pattern.start)} + i * params.patternSpacing` : ""});`,
      `    repeated${patternIndex + 1}.setMatrixAt(i, matrix${patternIndex + 1});`,
      "  }",
      `  repeatedFeatures.add(repeated${patternIndex + 1});`,
      "",
    );
  });

  lines.push("  return root;", "}", "");
  return lines.join("\n");
}