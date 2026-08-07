/**
 * math.test.ts — unit tests for the pure-TS math core (PCA, OBB, convex hull).
 * Run with: npm test
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  centroid,
  covarianceMatrix,
  cross,
  dot,
  fitObb,
  jacobi3,
  length,
  obbResidual,
  quaternionFromAxes,
  vec,
} from "../src/utils/pcaMath";
import { convexHull } from "../src/engine/decomposition/convexHull";

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

test("jacobi3 returns descending eigenvalues for a diagonal matrix", () => {
  const e = jacobi3([[3, 0, 0], [0, 1, 0], [0, 0, 2]]);
  assert.ok(approx(e.values[0], 3));
  assert.ok(approx(e.values[1], 2));
  assert.ok(approx(e.values[2], 1));
});

test("jacobi3 eigenvectors are orthonormal and right-handed", () => {
  const e = jacobi3(covarianceMatrix([vec(0, 0, 0), vec(2, 0, 0), vec(1, 5, 0), vec(1, 1, 9)]));
  const [a0, a1, a2] = e.vectors;
  assert.ok(approx(length(a0), 1) && approx(length(a1), 1) && approx(length(a2), 1));
  assert.ok(approx(dot(a0, a1), 0));
  assert.ok(approx(dot(a1, a2), 0));
  assert.ok(approx(dot(a0, a2), 0));
  assert.ok(dot(cross(a0, a1), a2) > 0, "basis must be right-handed");
});

test("OBB fits an axis-aligned unit cube with zero residual", () => {
  const pts = cube();
  const obb = fitObb(pts);
  assert.ok(approx(obb.center.x, 0) && approx(obb.center.y, 0) && approx(obb.center.z, 0));
  const r = obbResidual(pts, obb, 1e-6);
  assert.ok(approx(r.meanError, 0, 1e-9));
  assert.ok(approx(r.inlierRatio, 1, 1e-9));
});

test("OBB recovers a 45-degree rotated thin slab (angled-feature core test)", () => {
  // The whole point of OBB: an angled feature keeps its angle instead of
  // becoming an axis-aligned staircase. Build a long thin box, rotate 45° in
  // the XY plane, and confirm PCA recovers the orientation + extents.
  const cos = Math.SQRT1_2;
  const sin = Math.SQRT1_2;
  const rotate = (x: number, y: number, z: number) => vec(x * cos - y * sin, x * sin + y * cos, z);
  const pts = [
    rotate(-4, -0.5, -0.5), rotate(4, -0.5, -0.5), rotate(4, 0.5, -0.5), rotate(-4, 0.5, -0.5),
    rotate(-4, -0.5, 0.5), rotate(4, -0.5, 0.5), rotate(4, 0.5, 0.5), rotate(-4, 0.5, 0.5),
  ];
  const obb = fitObb(pts);
  const expected = vec(cos, sin, 0);
  assert.ok(approx(Math.abs(dot(obb.axes[0], expected)), 1, 1e-6), "principal axis recovers 45° slab");
  assert.ok(approx(obb.extents.x, 8, 1e-6), "longest extent = 8");
  assert.ok(approx(obb.extents.y, 1, 1e-6) && approx(obb.extents.z, 1, 1e-6), "thin extents = 1");
  const q = quaternionFromAxes(obb.axes[0], obb.axes[1], obb.axes[2]);
  assert.ok(approx(Math.hypot(q[0], q[1], q[2], q[3]), 1, 1e-9), "quaternion is unit length");
});

test("convexHull of a unit cube = 12 triangles, volume 8, area 24", () => {
  const h = convexHull(cube());
  assert.equal(h.triangleCount, 12);
  assert.ok(approx(h.volume, 8, 1e-6));
  assert.ok(approx(h.surfaceArea, 24, 1e-6));
});

test("convexHull of an octahedron = 8 triangles, volume 4/3", () => {
  const pts = [vec(1, 0, 0), vec(-1, 0, 0), vec(0, 1, 0), vec(0, -1, 0), vec(0, 0, 1), vec(0, 0, -1)];
  const h = convexHull(pts);
  assert.equal(h.triangleCount, 8);
  assert.ok(approx(h.volume, 4 / 3, 1e-6));
});

test("convexHull excludes interior points (no leak)", () => {
  const pts = [vec(1, 0, 0), vec(-1, 0, 0), vec(0, 1, 0), vec(0, -1, 0), vec(0, 0, 1), vec(0, 0, -1), vec(0, 0, 0)];
  const h = convexHull(pts);
  assert.equal(h.triangleCount, 8, "interior point must not add faces");
});

test("convexHull of coplanar points is empty (degenerate handled)", () => {
  const pts = [vec(0, 0, 0), vec(1, 0, 0), vec(2, 0, 0), vec(0.5, 0, 0.5)];
  const h = convexHull(pts);
  assert.equal(h.triangleCount, 0);
});

test("centroid of a symmetric set is the expected midpoint", () => {
  const c = centroid([vec(-1, -1, -1), vec(1, 1, 1), vec(-2, 0, 0), vec(2, 0, 0)]);
  assert.ok(approx(c.x, 0) && approx(c.y, 0) && approx(c.z, 0));
});

function cube() {
  const pts = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push(vec(x, y, z));
  return pts;
}
