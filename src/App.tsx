import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeMesh,
  generateProceduralCode,
  parseOBJ,
  SAMPLE_OBJ,
} from "./engine/geometryEngine";

/** Debounce a value so heavy analysis runs at most once per drag gesture. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
import {
  DEFAULT_SETTINGS,
  type ConversionSettings,
  type MeshData,
  type ReconstructionMode,
} from "./types/engine";
import { CodePreview } from "./components/CodePreview";
import { SettingsPanel } from "./components/SettingsPanel";
import { ModelViewer, type ViewMode } from "./components/ModelViewer";
import { Icon, type IconName } from "./components/icons";

interface SampleModel {
  id: string;
  label: string;
  url: string;
  hint: string;
}

const SAMPLE_MODELS: SampleModel[] = [
  { id: "glock", label: "Glock", url: "/models/glock-example.obj", hint: "Angled grip / single group" },
  { id: "launcher", label: "Launcher", url: "/models/launcher-example.obj", hint: "120+ named parts" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const MODE_LABEL: Record<ReconstructionMode, string> = {
  obb_primitives: "OBB Primitives",
  convex_hulls: "Convex Hulls",
  indexed_buffer: "Indexed Buffer",
  hybrid: "Hybrid",
};

function App() {
  const [settings, setSettings] = useState<ConversionSettings>(DEFAULT_SETTINGS);
  const [mesh, setMesh] = useState<MeshData>(() => parseOBJ(SAMPLE_OBJ, "linear-guide-demo.obj"));
  const [viewMode, setViewMode] = useState<ViewMode>("procedural");
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedPart, setSelectedPart] = useState<number | null>(null);
  const [codeTab, setCodeTab] = useState<"typescript" | "report">("typescript");
  const [inspectorTab, setInspectorTab] = useState<"parts" | "scores">("parts");
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [loadingSample, setLoadingSample] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const analysisTick = useRef(0);

  // Resolve the effective mode (auto -> best by score). Derive from the
  // debounced settings so the (potentially heavy) analysis runs once per change
  // while the sliders themselves stay instantly responsive.
  const analysisSettings = useDebounced(settings, 120);
  const forceMode: ReconstructionMode | undefined =
    analysisSettings.reconstructionMode === "auto" ? undefined : analysisSettings.reconstructionMode;

  const result = useMemo(
    () => (mesh ? analyzeMesh(mesh, { settings: analysisSettings, forceMode }) : null),
    [mesh, analysisSettings, forceMode],
  );

  // Cosmetic "analyzing" pulse whenever inputs change.
  useEffect(() => {
    const tick = ++analysisTick.current;
    setAnalyzing(true);
    const timer = window.setTimeout(() => {
      if (analysisTick.current === tick) setAnalyzing(false);
    }, 480);
    return () => window.clearTimeout(timer);
  }, [mesh, analysisSettings]);

  const generated = useMemo(
    () => (result ? generateProceduralCode(mesh, result, analysisSettings) : null),
    [mesh, result, analysisSettings],
  );

  const report = useMemo(
    () =>
      JSON.stringify(
        result
          ? {
              source: mesh.name,
              mode: result.mode,
              topology: { vertices: mesh.vertices.length, triangles: mesh.faces.length },
              decomposition: { parts: result.parts.length, planarity: result.metrics.planarity },
              quality: {
                fidelity: result.fidelity,
                obbCoverage: result.metrics.obbCoverage,
                hullTightness: result.metrics.hullTightness,
                symmetry: result.symmetry,
              },
              scores: result.scores,
              parts: result.parts.map((p) => ({
                id: p.id,
                name: p.name,
                kind: p.kind,
                faces: p.faceCount,
                inlier: p.obbInlierRatio,
                angled: Math.abs(Math.abs(p.quaternion[3]) - 1) > 1e-3,
              })),
            }
          : { status: "awaiting-analysis" },
        null,
        2,
      ),
    [mesh, result],
  );

  const visibleCode = codeTab === "typescript" ? generated?.code ?? "" : report;
  const compression = result && generated ? mesh.sourceBytes / Math.max(generated.bytes, 1) : 0;
  const recommended = result ? [...result.scores].sort((a, b) => b.score - a.score)[0] : null;

  const loadSource = (source: string, name: string) => {
    try {
      const parsed = parseOBJ(source, name);
      setMesh(parsed);
      setSelectedPart(null);
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

  const loadSample = async (sample: SampleModel) => {
    setLoadingSample(sample.id);
    setError("");
    try {
      const response = await fetch(sample.url);
      if (!response.ok) throw new Error(`Could not fetch ${sample.url}`);
      loadSource(await response.text(), `${sample.id}.obj`);
      setViewMode("procedural");
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load sample model.");
    } finally {
      setLoadingSample(null);
    }
  };

  // Auto-load the glock on first launch.
  useEffect(() => {
    loadSample(SAMPLE_MODELS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyCode = async () => {
    await navigator.clipboard.writeText(visibleCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const downloadCode = () => {
    if (!generated) return;
    const blob = new Blob([generated.code], { type: "text/typescript" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${mesh.name.replace(/\.obj$/i, "") || "procedural-part"}.ts`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const stages: Array<{ title: string; icon: IconName; detail: string }> = [
    { title: "Parse & weld", icon: "file", detail: "Triangulate faces, weld duplicate vertices, track object groups." },
    { title: "Planar segmentation", icon: "grid", detail: `Region-grow normals within ${settings.coplanarThresholdDegrees}°.` },
    { title: "OBB decomposition", icon: "box", detail: "PCA-oriented boxes via recursive bisection; angled features keep their angle." },
    { title: "Mode scoring", icon: "spark", detail: "Score OBB / convex / indexed / hybrid by fidelity and compression." },
    { title: "Code generation", icon: "braces", detail: `Emit standalone procedural-part.ts (${result?.mode}).` },
  ];

  const viewTabs: Array<{ id: ViewMode; label: string }> = [
    { id: "raw", label: "Source" },
    { id: "segments", label: "Regions" },
    { id: "procedural", label: "Reconstruction" },
    { id: "comparison", label: "Compare" },
  ];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark"><Icon name="box" size={19} /></div>
          <div>
            <div className="brand-name">PARAMESH</div>
            <div className="brand-subtitle">OBJ → Three.js geometry compiler</div>
          </div>
        </div>
        <div className="project-path" aria-label="Current model">
          <span>WORKBENCH</span>
          <Icon name="chevron" size={12} />
          <strong>{mesh.name}</strong>
        </div>
        <div className="top-actions">
          <div className="engine-state">
            <span className={analyzing ? "status-dot working" : "status-dot"} />
            {analyzing ? "ANALYZING" : "ENGINE LOCAL"}
          </div>
          <button className="export-button" onClick={downloadCode} disabled={!generated}>
            <Icon name="download" size={14} /> Export .ts
          </button>
        </div>
      </header>

      <main className="workbench">
        <aside className="source-panel">
          <div className="panel-title"><span>Source</span><span className="panel-index">01</span></div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".obj,text/plain"
            hidden
            onChange={(event) => loadFile(event.target.files?.[0])}
          />
          <button
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); loadFile(event.dataTransfer.files[0]); }}
          >
            <span className="drop-icon"><Icon name="upload" size={18} /></span>
            <span className="drop-primary">Drop raw OBJ</span>
            <span className="drop-secondary">or browse local mesh</span>
          </button>

          <div className="sample-row">
            {SAMPLE_MODELS.map((sample) => (
              <button
                key={sample.id}
                className={`sample-chip ${mesh.name.startsWith(sample.id) ? "active" : ""}`}
                onClick={() => loadSample(sample)}
                disabled={loadingSample === sample.id}
                title={sample.hint}
              >
                {loadingSample === sample.id ? "…" : sample.label}
              </button>
            ))}
          </div>

          {error && <div className="error-message">{error}</div>}

          <div className="source-file">
            <div className="file-heading">
              <Icon name="file" size={16} />
              <span title={mesh.name}>{mesh.name}</span>
              <i>OBJ</i>
            </div>
            <dl className="metadata-grid">
              <div><dt>Vertices</dt><dd>{mesh.vertices.length.toLocaleString()}</dd></div>
              <div><dt>Triangles</dt><dd>{mesh.faces.length.toLocaleString()}</dd></div>
              <div><dt>Parts</dt><dd>{result?.metrics.partCount ?? 0}</dd></div>
              <div><dt>Source</dt><dd>{formatBytes(mesh.sourceBytes)}</dd></div>
            </dl>
          </div>

          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            onReset={() => setSettings(DEFAULT_SETTINGS)}
          />
        </aside>

        <section className="viewport-panel">
          <div className="viewport-toolbar">
            <div className="view-tabs" role="tablist" aria-label="Display mode">
              {viewTabs.map((tab) => (
                <button
                  key={tab.id}
                  className={viewMode === tab.id ? "active" : ""}
                  onClick={() => setViewMode(tab.id)}
                  disabled={tab.id !== "raw" && !result}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="viewport-actions">
              <button className={showGrid ? "active" : ""} onClick={() => setShowGrid((v) => !v)} title="Toggle grid">
                <Icon name="grid" size={15} />
              </button>
              <button className={autoRotate ? "active" : ""} onClick={() => setAutoRotate((v) => !v)} title="Auto rotate">
                <Icon name="rotate" size={15} />
              </button>
            </div>
          </div>

          <div className="viewport-stage">
            {result ? (
              <ModelViewer
                mesh={mesh}
                result={result}
                mode={viewMode}
                settings={analysisSettings}
                showGrid={showGrid}
                autoRotate={autoRotate}
                analyzing={analyzing}
              />
            ) : (
              <div className="viewport-canvas" />
            )}
            <div className="viewport-label">
              <span>
                {viewMode === "procedural" ? "RECONSTRUCTION" : viewMode === "comparison" ? "SIDE-BY-SIDE" : viewMode === "segments" ? "REGION MAP" : "SOURCE TRIANGLES"}
              </span>
              <small>{result?.mode ?? "—"} · {result ? `${(result.fidelity * 100).toFixed(1)}% fidelity` : ""}</small>
            </div>
            {result && (
              <div className="fit-readout">
                <span>FIDELITY</span>
                <strong>{(result.fidelity * 100).toFixed(1)}%</strong>
              </div>
            )}
          </div>

          <div className="pipeline-strip">
            {stages.map((stage, index) => (
              <div className="pipeline-step" key={stage.title}>
                <i><Icon name={stage.icon} size={12} /></i>
                <div>
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  <strong>{stage.title}</strong>
                </div>
              </div>
            ))}
          </div>
        </section>

        <aside className="analysis-panel">
          {result && recommended && (
            <div className="recommendation-card">
              <div className="rec-head">
                <Icon name="spark" size={15} />
                <span>Recommended mode</span>
              </div>
              <strong>{MODE_LABEL[result.mode]}</strong>
              <small>{recommended.reason}</small>
              <div className="rec-bar"><i style={{ width: `${result.fidelity * 100}%` }} /></div>
            </div>
          )}

          <div className="analysis-tabs">
            <button className={inspectorTab === "parts" ? "active" : ""} onClick={() => setInspectorTab("parts")}>
              Parts <span>{result?.parts.length ?? 0}</span>
            </button>
            <button className={inspectorTab === "scores" ? "active" : ""} onClick={() => setInspectorTab("scores")}>
              Scores
            </button>
          </div>

          {inspectorTab === "parts" ? (
            <div className="feature-content">
              <div className="feature-list">
                {result?.parts.map((part) => {
                  const angled = Math.abs(Math.abs(part.quaternion[3]) - 1) > 1e-3;
                  return (
                    <button
                      className={`feature-row ${selectedPart === part.id ? "selected" : ""}`}
                      key={part.id}
                      onClick={() => setSelectedPart(selectedPart === part.id ? null : part.id)}
                    >
                      <i style={{ background: angled ? "#d4a65f" : kindColorFor(part.kind) }} />
                      <div>
                        <strong>{part.name}</strong>
                        <span>
                          {part.faceCount} tri · {part.kind === "unknown" ? "free-form" : part.kind}
                          {angled ? " · angled" : ""}
                        </span>
                      </div>
                      <output>{(part.obbInlierRatio * 100).toFixed(0)}%</output>
                    </button>
                  );
                })}
              </div>
              {result && (
                <div className="symmetry-result">
                  <Icon name="scan" size={15} />
                  <div><span>Strongest symmetry</span><strong>{result.symmetry.plane}</strong></div>
                  <output>{(result.symmetry.score * 100).toFixed(0)}%</output>
                </div>
              )}
            </div>
          ) : (
            <div className="score-content">
              {result?.scores
                .slice()
                .sort((a, b) => b.score - a.score)
                .map((s) => {
                  const isWinner = s.mode === result.mode;
                  return (
                    <div className={`score-row ${isWinner ? "winner" : ""}`} key={s.mode}>
                      <div className="score-head">
                        <strong>{MODE_LABEL[s.mode]}</strong>
                        {isWinner && <i>SELECTED</i>}
                      </div>
                      <div className="score-bars">
                        <div><span>fidelity</span><b>{(s.fidelity * 100).toFixed(0)}%</b><i style={{ width: `${s.fidelity * 100}%` }} /></div>
                        <div><span>compression</span><b>{s.compression.toFixed(1)}×</b><i style={{ width: `${Math.min(100, Math.log10(Math.max(s.compression, 1)) * 50)}%` }} /></div>
                      </div>
                      <div className="score-total">score {s.score.toFixed(3)}</div>
                    </div>
                  );
                })}
            </div>
          )}
        </aside>

        <section className="code-panel">
          <div className="code-header">
            <div className="code-tabs">
              <button className={codeTab === "typescript" ? "active" : ""} onClick={() => setCodeTab("typescript")}>
                <Icon name="braces" size={14} /> procedural-part.ts
              </button>
              <button className={codeTab === "report" ? "active" : ""} onClick={() => setCodeTab("report")}>
                analysis.json
              </button>
            </div>
            <div className="code-meta">
              {generated && <span>{generated.primitiveCount} prims · {generated.vertexCount > 0 ? `${generated.vertexCount} verts` : "0 arrays"}</span>}
              {compression > 0 && <span>{compression.toFixed(1)}× smaller</span>}
              <button onClick={copyCode}>
                <Icon name={copied ? "check" : "copy"} size={13} />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
          <CodePreview code={visibleCode} />
        </section>
      </main>
    </div>
  );
}

function kindColorFor(kind: string): string {
  switch (kind) {
    case "obb":
    case "box":
      return "#6fbbaa";
    case "convex":
      return "#80a9df";
    case "indexed":
      return "#a9b3b2";
    default:
      return "#858b8d";
  }
}

export default App;
