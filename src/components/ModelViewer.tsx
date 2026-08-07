import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { AnalysisResult, ConversionSettings, MeshData, PrimitiveKind } from "../types/engine";
import { convexHull } from "../engine/decomposition/convexHull";
import { buildIndexedGeometry } from "../engine/generators/threejsCodeGenerator";

export type ViewMode = "raw" | "segments" | "procedural" | "comparison";

const regionPalette = ["#67d5c1", "#edb96c", "#80a9df", "#d57b85", "#b69ad9", "#b7c96b", "#739f98", "#d98f6a"];
const kindColors: Record<PrimitiveKind, string> = {
  box: "#829a9b",
  obb: "#6fbbaa",
  cylinder: "#d4a65f",
  extrusion: "#6fbbaa",
  lathe: "#b18fca",
  convex: "#80a9df",
  indexed: "#a9b3b2",
  unknown: "#858b8d",
};

/** Build a Three.js reconstruction that mirrors the generated code, so what
 *  you see is exactly what `procedural-part.ts` will produce. */
function buildProceduralGroup(
  mesh: MeshData,
  result: AnalysisResult,
  settings: ConversionSettings,
): THREE.Group {
  const group = new THREE.Group();
  const boxMat = new THREE.MeshStandardMaterial({ color: 0x6fbbaa, metalness: 0.6, roughness: 0.34 });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x0e1718, transparent: true, opacity: 0.4 });
  const meshMat = new THREE.MeshStandardMaterial({ color: 0x8fa5a5, metalness: 0.62, roughness: 0.34, side: THREE.DoubleSide });

  if (result.mode === "indexed_buffer") {
    const geom = buildIndexedGeometry(mesh, mesh.faces.map((_, i) => i), settings.enableNormalsSmoothing);
    group.add(bufferMesh(geom, meshMat));
    return group;
  }

  result.parts.forEach((part) => {
    const useBox = result.mode === "obb_primitives" || (result.mode === "hybrid" && part.kind === "obb");
    if (useBox) {
      const geometry = new THREE.BoxGeometry(part.size.x, part.size.y, part.size.z);
      const material = boxMat.clone();
      material.color = new THREE.Color(kindColors.obb);
      // Tint angled (rotated) parts so the grip/barrel stand out.
      const rotated = Math.abs(Math.abs(part.quaternion[3]) - 1) > 1e-3;
      if (rotated) material.color = new THREE.Color("#d4a65f");
      const feature = new THREE.Mesh(geometry, material);
      feature.position.set(part.center.x, part.center.y, part.center.z);
      feature.quaternion.set(part.quaternion[0], part.quaternion[1], part.quaternion[2], part.quaternion[3]);
      group.add(feature);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 1), edgeMat);
      edges.position.copy(feature.position);
      edges.quaternion.copy(feature.quaternion);
      group.add(edges);
    } else if (result.mode === "convex_hulls") {
      const points = part.vertexIds.map((vi) => mesh.vertices[vi]);
      const hull = convexHull(points);
      if (hull.triangleCount === 0) {
        const geometry = new THREE.BoxGeometry(part.size.x, part.size.y, part.size.z);
        const feature = new THREE.Mesh(geometry, boxMat);
        feature.position.set(part.center.x, part.center.y, part.center.z);
        feature.quaternion.set(part.quaternion[0], part.quaternion[1], part.quaternion[2], part.quaternion[3]);
        group.add(feature);
        return;
      }
      const used = [...new Set(hull.indices)];
      const remap = new Map<number, number>();
      used.forEach((src, local) => remap.set(src, local));
      const positions = new Float32Array(used.length * 3);
      used.forEach((src, local) => {
        positions[local * 3] = points[src].x;
        positions[local * 3 + 1] = points[src].y;
        positions[local * 3 + 2] = points[src].z;
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(hull.indices.map((src) => remap.get(src)!));
      geometry.computeVertexNormals();
      const mat = boxMat.clone();
      mat.color = new THREE.Color(kindColors.convex);
      group.add(new THREE.Mesh(geometry, mat));
    } else {
      // hybrid non-box part -> exact indexed slice
      const geom = buildIndexedGeometry(mesh, part.faceIds, settings.enableNormalsSmoothing);
      group.add(bufferMesh(geom, meshMat));
    }
  });
  return group;
}

function bufferMesh(
  geom: { positions: number[]; normals: number[]; indices: number[] },
  material: THREE.Material,
): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(geom.positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(geom.normals, 3));
  geometry.setIndex(geom.indices);
  return new THREE.Mesh(geometry, material);
}

function buildRawMesh(mesh: MeshData, mode: ViewMode, result: AnalysisResult | null): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  mesh.faces.forEach((face, faceId) => {
    const regionId = result?.faceToRegion[faceId] ?? 0;
    const color = new THREE.Color(
      mode === "segments" ? regionPalette[regionId % regionPalette.length] : "#8fa5a5",
    );
    face.forEach((vertexId) => {
      const p = mesh.vertices[vertexId];
      positions.push(p.x, p.y, p.z);
      colors.push(color.r, color.g, color.b);
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    metalness: mode === "raw" ? 0.72 : 0.35,
    roughness: mode === "raw" ? 0.31 : 0.44,
    flatShading: mode === "segments",
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(geometry, material);
}

export function ModelViewer({
  mesh,
  result,
  mode,
  settings,
  showGrid,
  autoRotate,
  analyzing,
}: {
  mesh: MeshData;
  result: AnalysisResult | null;
  mode: ViewMode;
  settings: ConversionSettings;
  showGrid: boolean;
  autoRotate: boolean;
  analyzing: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount || !result) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111719");
    scene.fog = new THREE.Fog("#111719", 18, 36);
    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 1;
    controls.maxDistance = 60;

    scene.add(new THREE.HemisphereLight(0xe8f6f3, 0x293031, 2.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
    keyLight.position.set(4, 8, 6);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x6dddc7, 2.8);
    rimLight.position.set(-6, 3, -7);
    scene.add(rimLight);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    const bounds = result.bounds;
    const span = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 0.001);
    modelRoot.position.set(-bounds.center.x, -bounds.center.y, -bounds.center.z);

    const offset = span * 0.78;
    if (mode === "comparison") {
      const raw = buildRawMesh(mesh, "raw", result);
      const rawGroup = new THREE.Group();
      rawGroup.add(raw);
      rawGroup.position.x = -offset;
      modelRoot.add(rawGroup);
      const proc = buildProceduralGroup(mesh, result, settings);
      proc.position.x = offset;
      modelRoot.add(proc);
    } else if (mode === "procedural") {
      modelRoot.add(buildProceduralGroup(mesh, result, settings));
    } else {
      modelRoot.add(buildRawMesh(mesh, mode, result));
    }

    if (showGrid) {
      const grid = new THREE.GridHelper(span * 2.8, 28, 0x526463, 0x263234);
      grid.position.y = bounds.min.y - bounds.center.y - span * 0.025;
      const gridMaterial = grid.material as THREE.LineBasicMaterial;
      gridMaterial.transparent = true;
      gridMaterial.opacity = 0.42;
      scene.add(grid);
    }
    camera.position.set(span * 1.4, span * 0.76, span * 1.5);
    controls.target.set(0, 0, 0);
    controls.update();

    const resize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let frame = 0;
    let entry = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      entry = Math.min(1, entry + 0.035);
      const eased = 1 - Math.pow(1 - entry, 3);
      modelRoot.scale.setScalar(0.86 + eased * 0.14);
      if (autoRotate) modelRoot.rotation.y += 0.0035;
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [mesh, result, mode, settings, showGrid, autoRotate]);

  return (
    <div ref={mountRef} className="viewport-canvas">
      {analyzing && <div className="scan-plane" />}
      <div className="axis-legend" aria-hidden="true">
        <span className="axis axis-x">X</span>
        <span className="axis axis-y">Y</span>
        <span className="axis axis-z">Z</span>
      </div>
      {mode === "comparison" && (
        <div className="comparison-labels" aria-hidden="true">
          <span>SOURCE</span>
          <span>RECONSTRUCTION</span>
        </div>
      )}
    </div>
  );
}
