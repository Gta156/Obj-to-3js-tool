/**
 * Core data contracts shared across the geometry engine, the math utilities,
 * the Three.js code generators and the React UI. Everything in this file is
 * pure TypeScript (no Three.js import) so the engine can be exercised by the
 * headless test harness in /tests.
 */

export type Axis = "x" | "y" | "z";

/** The reconstruction strategies the engine can emit. */
export type ReconstructionMode =
  /** PCA-fitted oriented boxes — clean low-poly parametric code. */
  | "obb_primitives"
  /** QuickHull decomposition into extruded/convex shapes per part. */
  | "convex_hulls"
  /** Exact, lossless BufferGeometry (position/normal/index arrays). */
  | "indexed_buffer"
  /** Per-part decision: OBB where it fits, indexed geometry elsewhere. */
  | "hybrid";

/** UI-only selector. The engine resolves "auto" into a concrete mode via scoring. */
export type ReconstructionSelector = ReconstructionMode | "auto";

export type PrimitiveKind =
  | "box"
  | "obb"
  | "cylinder"
  | "extrusion"
  | "lathe"
  | "convex"
  | "indexed"
  | "unknown";

/** Unit quaternion stored as [x, y, z, w]. */
export type Quaternion = [number, number, number, number];

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MeshData {
  name: string;
  sourceBytes: number;
  vertices: Vec3[];
  /** Triangulated faces as indices into `vertices`. */
  faces: Array<[number, number, number]>;
  /** OBJ object/group boundaries — used as natural part seams when present. */
  groups: MeshGroup[];
  /** -1 when a face belongs to no recorded group. */
  faceToGroup: number[];
}

export interface MeshGroup {
  name: string;
  faceIds: number[];
  vertexCount: number;
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

/**
 * A reconstructed part. `obb` describes the oriented bounding box from PCA;
 * `kind` describes how the generator should materialise it. Angled features
 * (grips, barrels) keep their angle because `obb.axes` carry the orientation
 * and `obb.quaternion` rotates the generated primitive accordingly.
 */
export interface PartInfo {
  id: number;
  name: string;
  faceIds: number[];
  vertexIds: number[];
  vertexCount: number;
  faceCount: number;
  /** OBB centre in world space. */
  center: Vec3;
  /** OBB full extents along its own axes. */
  size: Vec3;
  halfExtents: Vec3;
  /** Orthonormal OBB axes (columns of the rotation matrix). */
  axes: [Vec3, Vec3, Vec3];
  /** Quaternion rotating an axis-aligned box onto this OBB. */
  quaternion: Quaternion;
  kind: PrimitiveKind;
  /** Mean per-vertex distance from the OBB surface, normalised by model size. */
  obbFitError: number;
  /** Fraction of part vertices that lie within obbFitTolerance of the surface. */
  obbInlierRatio: number;
  /** OBB volume divided by the part's convex-hull volume (1.0 = perfectly tight). */
  tightness: number;
  confidence: number;
  regionCount: number;
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
  center: Vec3;
  size: Vec3;
}

export interface SymmetryInfo {
  plane: string;
  axis: Axis;
  score: number;
}

export interface ModeScore {
  mode: ReconstructionMode;
  fidelity: number;
  compression: number;
  /** Weighted overall score in [0, 1]. */
  score: number;
  /** Human readable justification. */
  reason: string;
}

export interface AnalysisResult {
  parts: PartInfo[];
  regions: RegionInfo[];
  faceToRegion: number[];
  faceToPart: number[];
  bounds: Bounds;
  symmetry: SymmetryInfo;
  fidelity: number;
  generatedBytes: number;
  durationMs: number;
  mode: ReconstructionMode;
  /** Mode scoring used by the "auto" selector. */
  scores: ModeScore[];
  /** Metrics used for fidelity/quality readouts. */
  metrics: {
    vertexCount: number;
    faceCount: number;
    planarity: number;
    obbCoverage: number;
    hullTightness: number;
    partCount: number;
  };
}

/** Tunable conversion settings surfaced in the UI. */
export interface ConversionSettings {
  reconstructionMode: ReconstructionSelector;
  /** Angle threshold (degrees) for merging adjacent coplanar faces. */
  coplanarThresholdDegrees: number;
  /** Regions smaller than this volume are merged into neighbours or dropped. */
  minRegionVolume: number;
  /** How aggressively to fit oriented boxes around vertex groups (normalised). */
  obbFitTolerance: number;
  /** Toggle smooth vs flat shading on indexed/convex output. */
  enableNormalsSmoothing: boolean;
}

export const DEFAULT_SETTINGS: ConversionSettings = {
  reconstructionMode: "auto",
  coplanarThresholdDegrees: 18,
  minRegionVolume: 0.00002,
  obbFitTolerance: 0.012,
  enableNormalsSmoothing: true,
};
