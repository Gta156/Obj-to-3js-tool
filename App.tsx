import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  SAMPLE_OBJ,
  analyzeMesh,
  generateProceduralCode,
  parseOBJ,
  type AnalysisResult,
  type Axis,
  type MeshData,
  type PrimitiveKind,
} from "./geometry-engine";

type ViewMode = "raw" | "segments" | "procedural";
type IconName =
  | "box"
  | "braces"
  | "check"
  | "chevron"
  | "copy"
  | "download"
  | "file"
  | "focus"
  | "grid"
  | "layers"
  | "play"
  | "rotate"
  | "scan"
  | "settings"
  | "spark"
  | "upload";

const INITIAL_MESH = parseOBJ(SAMPLE_OBJ, "linear-guide-demo.obj");

function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  const paths: Record<IconName, React.ReactNode> = {
    box: <><path d="m3 6 9-4 9 4-9 4-9-4Z"/><path d="m3 6 9 4 9-4v11l-9 5-9-5V6Z"/><path d="M12 10v12"/></>,
    braces: <><path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2"/><path d="M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 1-2 2v4a2 2 0 0 1-2 2h-2"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    chevron: <path d="m9 18 6-6-6-6"/>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    download: <><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></>,
    focus: <><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/><circle cx="12" cy="12" r="3"/></>,
    grid: <><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
    play: <path d="m7 4 13 8-13 8V4Z"/>,
    rotate: <><path d="M20 7h-5V2"/><path d="M20 7a9 9 0 1 0 1 9"/></>,
    scan: <><path d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.6-1H3v-4h.09A1.7 1.7 0 0 0 4.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.6V3h4v.09a1.7 1.7 0 0 0 1.5 1.51 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.6 1h.09v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    spark: <><path d="m12 3-1.4 4.2a5 5 0 0 1-3.2 3.2L3 12l4.4 1.6a5 5 0 0 1 3.2 3.2L12 21l1.4-4.2a5 5 0 0 1 3.2-3.2L21 12l-4.4-1.6a5 5 0 0 1-3.2-3.2L12 3Z"/></>,
    upload: <><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 20h16"/></>,
  };
  return <svg aria-hidden="true" className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

const regionPalette = ["#67d5c1", "#edb96c", "#80a9df", "#d57b85", "#b69ad9", "#b7c96b", "#739f98"];
const kindColors: Record<PrimitiveKind, string> = {
  box: "#829a9b",
  cylinder: "#d4a65f",
  extrusion: "#6fbbaa",
  lathe: "#b18fca",
  plane: "#8aa6ca",
  unknown: "#858b8d",
};

function orientGeometry(geometry: THREE.BufferGeometry, axis: Axis) {
  if (axis === "x") geometry.rotateZ(-Math.PI / 2);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
}

function ThreeViewport({ mesh, result, mode, showGrid, autoRotate, analyzing }: {
  mesh: MeshData;
  result: AnalysisResult | null;
  mode: ViewMode;
  showGrid: boolean;
  autoRotate: boolean;
  analyzing: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#111719");
    scene.fog = new THREE.Fog("#111719", 18, 32);
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
    controls.minDistance = 3;
    controls.maxDistance = 40;

    scene.add(new THREE.HemisphereLight(0xe8f6f3, 0x293031, 2.25));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
    keyLight.position.set(4, 8, 6);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0x6dddc7, 2.8);
    rimLight.position.set(-6, 3, -7);
    scene.add(rimLight);

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);
    const bounds = result?.bounds ?? (() => {
      const box = new THREE.Box3();
      mesh.vertices.forEach((point) => box.expandByPoint(new THREE.Vector3(point.x, point.y, point.z)));
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      return {
        min: { x: box.min.x, y: box.min.y, z: box.min.z },
        max: { x: box.max.x, y: box.max.y, z: box.max.z },
        size: { x: size.x, y: size.y, z: size.z },
        center: { x: center.x, y: center.y, z: center.z },
      };
    })();
    modelRoot.position.set(-bounds.center.x, -bounds.center.y, -bounds.center.z);

    if (mode === "procedural" && result) {
      result.components.forEach((component) => {
        let geometry: THREE.BufferGeometry;
        if (component.kind === "cylinder") {
          const radialAxes = (["x", "y", "z"] as Axis[]).filter((axis) => axis !== component.axis);
          const radius = (component.size[radialAxes[0]] + component.size[radialAxes[1]]) / 4;
          geometry = new THREE.CylinderGeometry(radius, radius, component.size[component.axis], 32);
          orientGeometry(geometry, component.axis);
        } else if (component.kind === "lathe") {
          const radius = Math.max(component.size.x, component.size.z) / 2;
          const height = component.size[component.axis];
          geometry = new THREE.LatheGeometry([
            new THREE.Vector2(radius * 0.7, -height / 2),
            new THREE.Vector2(radius, -height * 0.25),
            new THREE.Vector2(radius, height * 0.25),
            new THREE.Vector2(radius * 0.7, height / 2),
          ], 32);
          orientGeometry(geometry, component.axis);
        } else {
          geometry = new THREE.BoxGeometry(component.size.x, component.size.y, component.size.z);
        }
        const material = new THREE.MeshStandardMaterial({ color: kindColors[component.kind], metalness: 0.67, roughness: 0.31 });
        const feature = new THREE.Mesh(geometry, material);
        feature.position.set(component.center.x, component.center.y, component.center.z);
        modelRoot.add(feature);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 32), new THREE.LineBasicMaterial({ color: 0x172022, transparent: true, opacity: 0.34 }));
        edges.position.copy(feature.position);
        edges.rotation.copy(feature.rotation);
        modelRoot.add(edges);
      });
    } else {
      const positions: number[] = [];
      const colors: number[] = [];
      mesh.faces.forEach((face, faceId) => {
        const regionId = result?.faceToRegion[faceId] ?? 0;
        const color = new THREE.Color(mode === "segments" ? regionPalette[regionId % regionPalette.length] : "#8fa5a5");
        face.forEach((vertexId) => {
          const point = mesh.vertices[vertexId];
          positions.push(point.x, point.y, point.z);
          colors.push(color.r, color.g, color.b);
        });
      });
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: mode === "raw" ? 0.72 : 0.35, roughness: mode === "raw" ? 0.31 : 0.44, flatShading: mode === "segments" });
      modelRoot.add(new THREE.Mesh(geometry, material));
    }

    const span = Math.max(bounds.size.x, bounds.size.y, bounds.size.z, 1);
    if (showGrid) {
      const grid = new THREE.GridHelper(span * 2.8, 28, 0x526463, 0x263234);
      grid.position.y = bounds.min.y - bounds.center.y - span * 0.025;
      const gridMaterial = grid.material as THREE.LineBasicMaterial;
      gridMaterial.transparent = true;
      gridMaterial.opacity = 0.42;
      scene.add(grid);
    }
    camera.position.set(span * 1.08, span * 0.76, span * 1.16);
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
  }, [mesh, result, mode, showGrid, autoRotate]);

  return (
    <div ref={mountRef} className="viewport-canvas">
      {analyzing && <div className="scan-plane" />}
      <div className="axis-legend" aria-hidden="true">
        <span className="axis axis-x">X</span><span className="axis axis-y">Y</span><span className="axis axis-z">Z</span>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDimension(value: number) {
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function syntaxLine(line: string) {
  const tokens = line.split(/("[^"\n]*"|'[^'\n]*'|\/\/.*|\b(?:import|from|export|interface|const|let|new|return|for|function|Partial|number)\b|\bTHREE\.[A-Za-z]+\b|\b\d+(?:\.\d+)?\b)/g);
  return tokens.map((token, index) => {
    let className = "";
    if (/^\/\//.test(token)) className = "syn-comment";
    else if (/^["']/.test(token)) className = "syn-string";
    else if (/^(import|from|export|interface|const|let|new|return|for|function|Partial|number)$/.test(token)) className = "syn-keyword";
    else if (/^THREE\./.test(token)) className = "syn-type";
    else if (/^\d/.test(token)) className = "syn-number";
    return <span className={className} key={`${token}-${index}`}>{token}</span>;
  });
}

function CodeViewer({ code }: { code: string }) {
  return (
    <div className="code-scroll">
      <pre className="line-numbers" aria-hidden="true">{code.split("\n").map((_, index) => `${index + 1}\n`)}</pre>
      <pre className="code-content"><code>{code.split("\n").map((line, index) => <span className="code-line" key={index}>{syntaxLine(line)}{"\n"}</span>)}</code></pre>
    </div>
  );
}

function App() {
  const [mesh, setMesh] = useState<MeshData>(INITIAL_MESH);
  const [result, setResult] = useState<AnalysisResult | null>(() =>
    analyzeMesh(INITIAL_MESH, { normalAngle: 18, fitTolerance: 0.15 }),
  );
  const [viewMode, setViewMode] = useState<ViewMode>("procedural");
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [completedStages, setCompletedStages] = useState(5);
  const [activeStage, setActiveStage] = useState(4);
  const [selectedStage, setSelectedStage] = useState(2);
  const [normalAngle, setNormalAngle] = useState(18);
  const [fitTolerance, setFitTolerance] = useState(0.15);
  const [inspectorTab, setInspectorTab] = useState<"pipeline" | "features">("pipeline");
  const [codeTab, setCodeTab] = useState<"typescript" | "report">("typescript");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisRun = useRef(0);

  const generatedCode = useMemo(() => result ? generateProceduralCode(mesh, result) : "// Run the analysis pipeline to emit a procedural model.\n", [mesh, result]);
  const report = useMemo(() => JSON.stringify(result ? {
    source: mesh.name,
    topology: { vertices: mesh.vertices.length, triangles: mesh.faces.length },
    segmentation: { regions: result.regions.length, connectedComponents: result.components.length },
    primitives: result.components.map(({ id, kind, confidence, axis, size }) => ({ id, kind, confidence, axis, size })),
    symmetry: result.symmetry,
    patterns: result.patterns,
    output: { fidelity: result.fidelity, estimatedBytes: result.generatedBytes },
  } : { status: "awaiting-analysis" }, null, 2), [mesh, result]);
  const visibleCode = codeTab === "typescript" ? generatedCode : report;

  const primitiveCount = result?.components.filter((component) => component.kind !== "unknown").length ?? 0;
  const extrusions = result?.components.filter((component) => component.kind === "extrusion").length ?? 0;
  const lathes = result?.components.filter((component) => component.kind === "lathe").length ?? 0;
  const compression = result ? Math.max(1, Math.round(mesh.sourceBytes / result.generatedBytes)) : 0;

  const stages = [
    { title: "Topology ingest", tag: "OBJ", metric: `${mesh.vertices.length.toLocaleString()}v / ${mesh.faces.length.toLocaleString()}f`, detail: "Triangulates polygon faces, resolves negative indices, builds half-edge adjacency and connected islands." },
    { title: "Surface segmentation", tag: "REGION", metric: result ? `${result.regions.length} regions` : "Pending", detail: `Clusters face normals within ${normalAngle} degrees, then region-grows across shared manifold edges.` },
    { title: "Primitive fitting", tag: "RANSAC", metric: result ? `${primitiveCount} accepted` : "Pending", detail: `Fits planes, boxes and cylinders against segmented surfaces with a ${fitTolerance.toFixed(2)} mm residual target.` },
    { title: "Profile inference", tag: "SLICES", metric: result ? `${extrusions} extrude / ${lathes} lathe` : "Pending", detail: "Compares cross-sectional slices and radial levels to recover extrusions, revolved profiles and sweep axes." },
    { title: "Structure compression", tag: "GRAPH", metric: result ? `${result.patterns.length} pattern / ${result.symmetry.plane}` : "Pending", detail: "Scores reflection planes, groups congruent islands and converts regular spacing into instanced loops." },
  ];

  const runAnalysis = async () => {
    const runId = ++analysisRun.current;
    setAnalyzing(true);
    setError("");
    setCompletedStages(0);
    setActiveStage(0);
    setInspectorTab("pipeline");
    for (let index = 0; index < stages.length; index += 1) {
      if (analysisRun.current !== runId) return;
      setActiveStage(index);
      setSelectedStage(index);
      await new Promise((resolve) => window.setTimeout(resolve, 330 + index * 55));
      setCompletedStages(index + 1);
    }
    if (analysisRun.current !== runId) return;
    setResult(analyzeMesh(mesh, { normalAngle, fitTolerance }));
    setViewMode("procedural");
    setAnalyzing(false);
  };

  const loadSource = (source: string, name: string) => {
    try {
      analysisRun.current += 1;
      const parsed = parseOBJ(source, name);
      setMesh(parsed);
      setResult(null);
      setCompletedStages(0);
      setActiveStage(-1);
      setSelectedStage(0);
      setViewMode("raw");
      setAnalyzing(false);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to parse this OBJ file.");
    }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".obj")) {
      setError("Choose a Wavefront .obj mesh file.");
      return;
    }
    loadSource(await file.text(), file.name);
  };

  const loadDemo = () => {
    const parsed = parseOBJ(SAMPLE_OBJ, "linear-guide-demo.obj");
    setMesh(parsed);
    setResult(analyzeMesh(parsed, { normalAngle, fitTolerance }));
    setCompletedStages(5);
    setActiveStage(4);
    setViewMode("procedural");
    setError("");
  };

  const copyCode = async () => {
    await navigator.clipboard.writeText(visibleCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const downloadCode = () => {
    const blob = new Blob([generatedCode], { type: "text/typescript" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${mesh.name.replace(/\.obj$/i, "") || "parametric-part"}.ts`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><Icon name="box" size={19} /></div>
          <div><div className="brand-name">PARAMESH</div><div className="brand-subtitle">Reverse geometry compiler</div></div>
        </div>
        <div className="project-path" aria-label="Current project"><span>WORKBENCH</span><Icon name="chevron" size={12}/><strong>{mesh.name}</strong></div>
        <div className="top-actions">
          <div className="engine-state"><span className={analyzing ? "status-dot working" : "status-dot"}/>{analyzing ? "ANALYZING" : "ENGINE LOCAL"}</div>
          <button className="export-button" onClick={downloadCode} disabled={!result}><Icon name="download" size={14}/> Export .ts</button>
        </div>
      </header>

      <main className="workbench">
        <aside className="source-panel">
          <div className="panel-title"><span>Source</span><span className="panel-index">01</span></div>
          <input ref={fileInputRef} type="file" accept=".obj,text/plain" hidden onChange={(event) => loadFile(event.target.files?.[0])}/>
          <button
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); loadFile(event.dataTransfer.files[0]); }}
          >
            <span className="drop-icon"><Icon name="upload" size={18}/></span>
            <span className="drop-primary">Drop raw OBJ</span>
            <span className="drop-secondary">or browse local mesh</span>
          </button>
          <button className="text-action" onClick={loadDemo}>Reload mechanical demo <span>-&gt;</span></button>
          {error && <div className="error-message">{error}</div>}

          <div className="source-file">
            <div className="file-heading"><Icon name="file" size={16}/><span title={mesh.name}>{mesh.name}</span><i>OBJ</i></div>
            <dl className="metadata-grid">
              <div><dt>Vertices</dt><dd>{mesh.vertices.length.toLocaleString()}</dd></div>
              <div><dt>Triangles</dt><dd>{mesh.faces.length.toLocaleString()}</dd></div>
              <div><dt>Source</dt><dd>{formatBytes(mesh.sourceBytes)}</dd></div>
              <div><dt>Units</dt><dd>mm</dd></div>
            </dl>
          </div>

          <div className="settings-heading"><span>Analysis controls</span><Icon name="settings" size={14}/></div>
          <label className="range-control">
            <span><b>Normal tolerance</b><output>{normalAngle} deg</output></span>
            <input type="range" min="6" max="36" value={normalAngle} onChange={(event) => setNormalAngle(Number(event.target.value))}/>
          </label>
          <label className="range-control">
            <span><b>Fit residual</b><output>{fitTolerance.toFixed(2)} mm</output></span>
            <input type="range" min="0.05" max="0.5" step="0.01" value={fitTolerance} onChange={(event) => setFitTolerance(Number(event.target.value))}/>
          </label>
          <div className="engine-note"><span>Execution</span><strong>Node worker pool</strong><small>Deterministic seed / 8 threads</small></div>
          <button className="analyze-button" onClick={runAnalysis} disabled={analyzing}>
            <Icon name={analyzing ? "scan" : "play"} size={15}/>{analyzing ? `Stage ${activeStage + 1} of 5` : result ? "Rebuild abstraction" : "Analyze mesh"}
          </button>
        </aside>

        <section className="viewport-panel">
          <div className="viewport-toolbar">
            <div className="view-tabs" role="tablist" aria-label="Mesh display mode">
              {(["raw", "segments", "procedural"] as ViewMode[]).map((mode) => (
                <button key={mode} className={viewMode === mode ? "active" : ""} onClick={() => setViewMode(mode)} disabled={mode !== "raw" && !result}>
                  {mode === "raw" ? "Raw mesh" : mode === "segments" ? "Regions" : "Reconstruction"}
                </button>
              ))}
            </div>
            <div className="viewport-actions">
              <button className={showGrid ? "active" : ""} onClick={() => setShowGrid((value) => !value)} title="Toggle ground grid"><Icon name="grid" size={15}/></button>
              <button className={autoRotate ? "active" : ""} onClick={() => setAutoRotate((value) => !value)} title="Toggle auto rotation"><Icon name="rotate" size={15}/></button>
              <button onClick={() => setViewMode("procedural")} disabled={!result} title="Frame reconstruction"><Icon name="focus" size={15}/></button>
            </div>
          </div>
          <div className="viewport-stage">
            <ThreeViewport mesh={mesh} result={result} mode={viewMode} showGrid={showGrid} autoRotate={autoRotate} analyzing={analyzing}/>
            <div className="viewport-label"><span>{viewMode === "procedural" ? "PROCEDURAL SOLID" : viewMode === "segments" ? "REGION MAP" : "SOURCE TRIANGLES"}</span><small>Perspective / Y up / millimeters</small></div>
            {result && <div className="fit-readout"><span>FIT</span><strong>{(result.fidelity * 100).toFixed(2)}%</strong></div>}
          </div>
        </section>

        <aside className="analysis-panel">
          <div className="analysis-tabs">
            <button className={inspectorTab === "pipeline" ? "active" : ""} onClick={() => setInspectorTab("pipeline")}>Pipeline</button>
            <button className={inspectorTab === "features" ? "active" : ""} onClick={() => setInspectorTab("features")}>Features <span>{result?.components.length ?? 0}</span></button>
          </div>
          {inspectorTab === "pipeline" ? (
            <div className="pipeline-content">
              <div className="pipeline-intro"><Icon name="layers" size={17}/><div><strong>Geometric abstraction</strong><span>Coarse-to-fine recovery graph</span></div></div>
              <div className="stage-list">
                {stages.map((stage, index) => {
                  const complete = index < completedStages;
                  const running = analyzing && activeStage === index;
                  return (
                    <button key={stage.title} className={`stage-row ${selectedStage === index ? "selected" : ""} ${running ? "running" : ""}`} onClick={() => setSelectedStage(index)}>
                      <span className="stage-rail"><i className={complete ? "complete" : running ? "running" : ""}>{complete ? <Icon name="check" size={11}/> : index + 1}</i></span>
                      <span className="stage-copy"><small>{stage.tag}</small><strong>{stage.title}</strong><em>{stage.metric}</em></span>
                      <Icon name="chevron" size={13}/>
                    </button>
                  );
                })}
              </div>
              <div className="stage-detail">
                <div><span>{String(selectedStage + 1).padStart(2, "0")}</span><strong>{stages[selectedStage].title}</strong></div>
                <p>{stages[selectedStage].detail}</p>
                <div className="algorithm-line"><span>ALGORITHM</span><code>{["HalfEdgeGraph", "NormalRegionGrow", "RansacMultiFit", "SliceSignature", "CongruenceGraph"][selectedStage]}</code></div>
              </div>
              {result && <div className="compression-summary">
                <span>Representation reduction</span><strong>{compression}<small>x</small></strong>
                <div><i style={{ width: `${Math.min(96, 68 + compression)}%` }}/></div>
                <small>{formatBytes(mesh.sourceBytes)} mesh &rarr; {formatBytes(result.generatedBytes)} source</small>
              </div>}
            </div>
          ) : (
            <div className="feature-content">
              {result ? <>
                <div className="feature-summary"><span>{result.components.length} connected islands</span><strong>{primitiveCount} parametric matches</strong></div>
                <div className="feature-list">
                  {result.components.map((component) => (
                    <div className="feature-row" key={component.id}>
                      <i style={{ background: kindColors[component.kind] }}/>
                      <div><strong>{component.kind === "unknown" ? "Residual mesh" : component.kind}</strong><span>Feature {String(component.id + 1).padStart(2, "0")} / {component.axis.toUpperCase()} axis</span></div>
                      <output>{(component.confidence * 100).toFixed(0)}%</output>
                      <small>{formatDimension(component.size.x)} &times; {formatDimension(component.size.y)} &times; {formatDimension(component.size.z)}</small>
                    </div>
                  ))}
                </div>
                <div className="symmetry-result"><Icon name="spark" size={15}/><div><span>Strongest symmetry</span><strong>{result.symmetry.plane}</strong></div><output>{(result.symmetry.score * 100).toFixed(1)}%</output></div>
              </> : <div className="empty-inspector"><Icon name="scan" size={22}/><strong>No abstraction yet</strong><span>Run analysis to inspect fitted features.</span></div>}
            </div>
          )}
        </aside>

        <section className="code-panel">
          <div className="code-header">
            <div className="code-tabs">
              <button className={codeTab === "typescript" ? "active" : ""} onClick={() => setCodeTab("typescript")}><Icon name="braces" size={14}/> procedural-part.ts</button>
              <button className={codeTab === "report" ? "active" : ""} onClick={() => setCodeTab("report")}>analysis.json</button>
            </div>
            <div className="code-meta"><span><i/> ZERO VERTEX ARRAYS</span><button onClick={copyCode}><Icon name={copied ? "check" : "copy"} size={13}/>{copied ? "Copied" : "Copy"}</button></div>
          </div>
          <CodeViewer code={visibleCode}/>
        </section>
      </main>
    </div>
  );
}

export default App;