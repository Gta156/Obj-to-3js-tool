/**
 * pcaMath.ts — pure TypeScript linear-algebra & geometry helpers.
 *
 * NO Three.js dependency: the engine and the test harness run this headless.
 * The React viewport maps these vectors onto THREE.Vector3 at render time.
 *
 * Highlights:
 *   - Compact Vec3 algebra
 *   - 3x3 covariance + Jacobi eigen-decomposition (PCA)
 *   - Oriented Bounding Box fit (PCA + tight extent re-centring)
 *   - Rotation-matrix -> quaternion conversion
 *   - Volume / area / centroid utilities
 */

import type { Quaternion, Vec3 } from "../types/engine";

/* ------------------------------------------------------------------ *
 * Vec3 algebra
 * ------------------------------------------------------------------ */

export const vec = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, n: number): Vec3 => vec(a.x * n, a.y * n, a.z * n);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
export const lengthSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;

export function normalize(a: Vec3): Vec3 {
  const l = length(a);
  return l > 1e-12 ? scale(a, 1 / l) : vec(a.x, a.y, a.z);
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Signed angle between two vectors around an axis, in radians. */
export function signedAngle(from: Vec3, to: Vec3, axis: Vec3): number {
  const a = normalize(from);
  const b = normalize(to);
  const c = cross(a, b);
  const sine = length(c) * Math.sign(dot(c, axis));
  const cosine = clamp(dot(a, b), -1, 1);
  return Math.atan2(sine, cosine);
}

/* ------------------------------------------------------------------ *
 * Bounds, centroid, area
 * ------------------------------------------------------------------ */

export function getBounds(points: Vec3[]): { min: Vec3; max: Vec3; center: Vec3; size: Vec3 } {
  const min = vec(Infinity, Infinity, Infinity);
  const max = vec(-Infinity, -Infinity, -Infinity);
  for (const p of points) {
    if (p.x < min.x) min.x = p.x;
    if (p.y < min.y) min.y = p.y;
    if (p.z < min.z) min.z = p.z;
    if (p.x > max.x) max.x = p.x;
    if (p.y > max.y) max.y = p.y;
    if (p.z > max.z) max.z = p.z;
  }
  const size = sub(max, min);
  const center = scale(add(min, max), 0.5);
  return { min, max, center, size };
}

export function centroid(points: Vec3[]): Vec3 {
  if (!points.length) return vec();
  const sum = points.reduce((acc, p) => add(acc, p), vec());
  return scale(sum, 1 / points.length);
}

/** Triangle area via the half cross-product magnitude. */
export function triangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  return length(cross(sub(b, a), sub(c, a))) * 0.5;
}

/* ------------------------------------------------------------------ *
 * Covariance & PCA (Jacobi eigen-decomposition of a 3x3 symmetric matrix)
 * ------------------------------------------------------------------ */

export function covarianceMatrix(points: Vec3[], pivot?: Vec3): number[][] {
  const c = pivot ?? centroid(points);
  const m: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  if (!points.length) return m;
  for (const p of points) {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    const dz = p.z - c.z;
    m[0][0] += dx * dx;
    m[0][1] += dx * dy;
    m[0][2] += dx * dz;
    m[1][1] += dy * dy;
    m[1][2] += dy * dz;
    m[2][2] += dz * dz;
  }
  const n = points.length;
  m[0][0] /= n;
  m[0][1] /= n;
  m[0][2] /= n;
  m[1][0] = m[0][1];
  m[1][1] /= n;
  m[1][2] /= n;
  m[2][0] = m[0][2];
  m[2][1] = m[1][2];
  m[2][2] /= n;
  return m;
}

export interface EigenDecomposition {
  /** Eigenvalues, descending. */
  values: [number, number, number];
  /** Corresponding eigenvectors (unit length), as columns. */
  vectors: [Vec3, Vec3, Vec3];
}

/** Row-major 3x3 matrix multiply. */
function matMul3(a: number[][], b: number[][]): number[][] {
  const r: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += a[i][k] * b[k][j];
      r[i][j] = sum;
    }
  }
  return r;
}

function transpose3(a: number[][]): number[][] {
  return [
    [a[0][0], a[1][0], a[2][0]],
    [a[0][1], a[1][1], a[2][1]],
    [a[0][2], a[1][2], a[2][2]],
  ];
}

/**
 * Jacobi eigenvalue algorithm for a 3x3 symmetric matrix.
 * Uses explicit 3x3 matmul for the similarity transforms so the accumulated
 * eigenvector matrix is guaranteed correct. Returns eigenvalues in descending
 * order with matching (unit, right-handed) eigenvectors as columns.
 */
export function jacobi3(input: number[][]): EigenDecomposition {
  let A: number[][] = [
    [input[0][0], input[0][1], input[0][2]],
    [input[1][0], input[1][1], input[1][2]],
    [input[2][0], input[2][1], input[2][2]],
  ];
  // V's columns are the eigenvectors; starts as identity.
  let V: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

  const maxSweeps = 60;
  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    const off = Math.abs(A[0][1]) + Math.abs(A[0][2]) + Math.abs(A[1][2]);
    if (off < 1e-15) break;
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        const apq = A[p][q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p][p];
        const aqq = A[q][q];
        const theta = (aqq - app) / (2 * apq);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.hypot(theta, 1));
        const c = 1 / Math.hypot(t, 1);
        const s = t * c;
        // Givens rotation in the (p,q) plane.
        const J: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
        J[p][p] = c;
        J[q][q] = c;
        J[p][q] = s;
        J[q][p] = -s;
        A = matMul3(matMul3(transpose3(J), A), J);
        V = matMul3(V, J);
      }
    }
  }

  const candidates: Array<{ value: number; vector: Vec3 }> = [0, 1, 2].map((col) => ({
    value: A[col][col],
    vector: normalize(vec(V[0][col], V[1][col], V[2][col])),
  }));
  candidates.sort((p, q) => q.value - p.value);

  // Ensure a right-handed basis so the matrix is a pure rotation.
  const e0 = candidates[0].vector;
  const e1 = candidates[1].vector;
  let e2 = candidates[2].vector;
  if (dot(cross(e0, e1), e2) < 0) e2 = scale(e2, -1);

  return {
    values: [candidates[0].value, candidates[1].value, candidates[2].value],
    vectors: [e0, e1, e2],
  };
}

/* ------------------------------------------------------------------ *
 * Oriented Bounding Box fit
 * ------------------------------------------------------------------ */

export interface ObbFit {
  center: Vec3;
  /** Orthonormal axes (principal, secondary, tertiary). */
  axes: [Vec3, Vec3, Vec3];
  /** Full extents along each axis. */
  extents: Vec3;
  halfExtents: Vec3;
}

/**
 * Fit an oriented bounding box to a point cloud using PCA for the orientation
 * and tight extent re-centring for the position. This is what lets angled
 * features (grips, barrels) keep their true angle instead of becoming an
 * axis-aligned staircase.
 */
export function fitObb(points: Vec3[]): ObbFit {
  const mean = centroid(points);
  const cov = covarianceMatrix(points, mean);
  const { vectors: axes } = jacobi3(cov);

  // Project every point onto the PCA axes to find the tight span.
  let min0 = Infinity, min1 = Infinity, min2 = Infinity;
  let max0 = -Infinity, max1 = -Infinity, max2 = -Infinity;
  for (const p of points) {
    const d0 = dot(sub(p, mean), axes[0]);
    const d1 = dot(sub(p, mean), axes[1]);
    const d2 = dot(sub(p, mean), axes[2]);
    if (d0 < min0) min0 = d0;
    if (d0 > max0) max0 = d0;
    if (d1 < min1) min1 = d1;
    if (d1 > max1) max1 = d1;
    if (d2 < min2) min2 = d2;
    if (d2 > max2) max2 = d2;
  }

  const half0 = (max0 - min0) * 0.5;
  const half1 = (max1 - min1) * 0.5;
  const half2 = (max2 - min2) * 0.5;
  // Re-centre along each axis using the midpoint of the projected span.
  const mid0 = (min0 + max0) * 0.5;
  const mid1 = (min1 + max1) * 0.5;
  const mid2 = (min2 + max2) * 0.5;
  const center = add(add(add(mean, scale(axes[0], mid0)), scale(axes[1], mid1)), scale(axes[2], mid2));

  return {
    center,
    axes,
    extents: vec(half0 * 2, half1 * 2, half2 * 2),
    halfExtents: vec(half0, half1, half2),
  };
}

/** Shortest signed distance from a point to the surface of an axis-aligned box. */
export function distanceToAabbSurface(local: Vec3, halfExtents: Vec3): number {
  const dx = Math.abs(local.x) - halfExtents.x;
  const dy = Math.abs(local.y) - halfExtents.y;
  const dz = Math.abs(local.z) - halfExtents.z;
  const outside = vec(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
  const outsideDist = length(outside);
  const insideDist = Math.max(dx, dy, dz);
  return insideDist < 0 ? insideDist : outsideDist;
}

/**
 * Convert OBB axes (columns of a rotation matrix) into a unit quaternion
 * [x, y, z, w]. Uses the standard rotation-matrix -> quaternion branch.
 */
export function quaternionFromAxes(a0: Vec3, a1: Vec3, a2: Vec3): Quaternion {
  // Rotation matrix with a0/a1/a2 as columns.
  const m00 = a0.x, m10 = a0.y, m20 = a0.z;
  const m01 = a1.x, m11 = a1.y, m21 = a1.z;
  const m02 = a2.x, m12 = a2.y, m22 = a2.z;
  const trace = m00 + m11 + m22;
  let x = 0, y = 0, z = 0, w = 1;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m12 - m21) / s;
    y = (m20 - m02) / s;
    z = (m01 - m10) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m12 - m21) / s;
    x = 0.25 * s;
    y = (m10 + m01) / s;
    z = (m20 + m02) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m20 - m02) / s;
    x = (m10 + m01) / s;
    y = 0.25 * s;
    z = (m21 + m12) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m01 - m10) / s;
    x = (m20 + m02) / s;
    y = (m21 + m12) / s;
    z = 0.25 * s;
  }
  const l = Math.hypot(x, y, z, w) || 1;
  return [x / l, y / l, z / l, w / l];
}

/** Mean per-vertex distance to an OBB surface and the inlier ratio below `tolerance`. */
export function obbResidual(points: Vec3[], obb: ObbFit, tolerance: number): {
  meanError: number;
  inlierRatio: number;
} {
  if (!points.length) return { meanError: Infinity, inlierRatio: 0 };
  let sum = 0;
  let inliers = 0;
  for (const p of points) {
    const local = sub(p, obb.center);
    const lx = dot(local, obb.axes[0]);
    const ly = dot(local, obb.axes[1]);
    const lz = dot(local, obb.axes[2]);
    const dist = Math.abs(distanceToAabbSurface(vec(lx, ly, lz), obb.halfExtents));
    sum += dist;
    if (dist <= tolerance) inliers += 1;
  }
  return { meanError: sum / points.length, inlierRatio: inliers / points.length };
}

export function boxVolume(size: Vec3): number {
  return size.x * size.y * size.z;
}
