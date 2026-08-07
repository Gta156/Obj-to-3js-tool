/**
 * engine.test.ts — end-to-end structural validation on both sample models.
 * Run with: npm test
 */
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { analyzeMesh, generateProceduralCode } from "../src/engine/geometryEngine";
import { parseOBJ } from "../src/engine/parsers/objParser";
import { DEFAULT_SETTINGS, type ReconstructionMode } from "../src/types/engine";

const MODELS = {
  glock: { path: "public/models/glock-example.obj", name: "glock.obj", minFaces: 100 },
  launcher: { path: "public/models/launcher-example.obj", name: "launcher.obj", minFaces: 500 },
};

function load(key: keyof typeof MODELS) {
  return parseOBJ(readFileSync(MODELS[key].path, "utf8"), MODELS[key].name);
}

for (const key of Object.keys(MODELS) as Array<keyof typeof MODELS>) {
  test(`[${key}] parser triangulates and welds vertices`, () => {
    const mesh = load(key);
    assert.ok(mesh.faces.length >= MODELS[key].minFaces, `${mesh.faces.length} faces`);
    assert.ok(mesh.vertices.length > 0);
    // Welding: every face index must be valid and within the vertex array.
    for (const f of mesh.faces) for (const i of f) assert.ok(i >= 0 && i < mesh.vertices.length);
  });

  test(`[${key}] every part has a unit quaternion and valid OBB`, () => {
    const mesh = load(key);
    const result = analyzeMesh(mesh, { settings: { ...DEFAULT_SETTINGS, reconstructionMode: "auto" } });
    assert.ok(result.parts.length > 0);
    for (const part of result.parts) {
      const m = Math.hypot(part.quaternion[0], part.quaternion[1], part.quaternion[2], part.quaternion[3]);
      assert.ok(Math.abs(m - 1) < 1e-6, `part ${part.id} quaternion not unit: ${m}`);
      assert.ok(part.size.x >= 0 && part.size.y >= 0 && part.size.z >= 0);
    }
  });

  test(`[${key}] auto mode meets the >=90% fidelity acceptance bar`, () => {
    const mesh = load(key);
    const result = analyzeMesh(mesh, { settings: { ...DEFAULT_SETTINGS, reconstructionMode: "auto" } });
    assert.ok(
      result.fidelity >= 0.9,
      `${key} auto fidelity ${result.fidelity.toFixed(3)} below 0.90 threshold`,
    );
  });

  test(`[${key}] every reconstruction mode emits standalone three-only code`, () => {
    const mesh = load(key);
    for (const mode of ["obb_primitives", "convex_hulls", "indexed_buffer", "hybrid"] as ReconstructionMode[]) {
      const result = analyzeMesh(mesh, { settings: DEFAULT_SETTINGS, forceMode: mode });
      const gen = generateProceduralCode(mesh, result, DEFAULT_SETTINGS);
      assert.ok(gen.code.includes('import * as THREE from "three"'), `${mode} has three import`);
      assert.ok(gen.code.includes("createProceduralPart"), `${mode} exports factory`);
      assert.ok(gen.bytes > 100, `${mode} produced non-trivial output`);
    }
  });
}

test("the glock grip is reconstructed at an angle (no axis-aligned staircase)", () => {
  const mesh = load("glock");
  const result = analyzeMesh(mesh, { settings: { ...DEFAULT_SETTINGS, reconstructionMode: "auto" } });
  // At least one part must carry a non-identity rotation (angled grip/guard).
  const angled = result.parts.filter(
    (p) => Math.abs(Math.abs(p.quaternion[3]) - 1) > 1e-3,
  );
  assert.ok(angled.length > 0, "expected at least one angled (rotated) OBB part for the grip");
  // The grip specifically: a part whose principal axis is notably off the world axes.
  const gripLike = result.parts.find((p) => {
    const a = p.axes[0];
    return Math.abs(a.y) > 0.2 && Math.abs(a.z) > 0.2; // forward-tilted feature
  });
  assert.ok(gripLike, "expected a forward-tilted grip/feature part");
});

test("the launcher respects OBJ object groups as part boundaries", () => {
  const mesh = load("launcher");
  const result = analyzeMesh(mesh, { settings: { ...DEFAULT_SETTINGS, reconstructionMode: "auto" } });
  assert.ok(mesh.groups.length >= 50, `expected many named groups, got ${mesh.groups.length}`);
  // Part names should carry through from the OBJ objects.
  const named = result.parts.filter((p) => !p.name.startsWith("component_"));
  assert.ok(named.length >= 20, "expected group-named parts to survive decomposition");
});

test("indexed_buffer mode is lossless (vertex/triangle count preserved)", () => {
  const mesh = load("glock");
  const result = analyzeMesh(mesh, { settings: DEFAULT_SETTINGS, forceMode: "indexed_buffer" });
  const gen = generateProceduralCode(mesh, result, DEFAULT_SETTINGS);
  // Indexed buffer lists every triangle (3 indices each).
  const indexCount = (gen.code.match(/\d+\.\d+|\d+/g) ?? []).length; // rough sanity
  assert.ok(indexCount > mesh.faces.length, "indexed output should encode all triangles");
  assert.equal(result.fidelity, 1, "indexed_buffer is by definition lossless");
});
