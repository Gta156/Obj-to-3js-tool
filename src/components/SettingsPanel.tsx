import type { ConversionSettings, ReconstructionSelector } from "../types/engine";
import { Icon, type IconName } from "./icons";

const MODES: Array<{ id: ReconstructionSelector; label: string; hint: string; icon: IconName }> = [
  { id: "auto", label: "Auto", hint: "Score every mode and pick the best by math", icon: "spark" },
  { id: "hybrid", label: "Hybrid", hint: "OBB where it fits, exact indexed geometry elsewhere", icon: "layers" },
  { id: "obb_primitives", label: "OBB", hint: "PCA-oriented boxes (clean low-poly)", icon: "box" },
  { id: "convex_hulls", label: "Convex", hint: "Per-part QuickHull decomposition", icon: "grid" },
  { id: "indexed_buffer", label: "Indexed", hint: "Lossless exact BufferGeometry", icon: "braces" },
];

export function SettingsPanel({
  settings,
  onChange,
  onReset,
}: {
  settings: ConversionSettings;
  onChange: (next: ConversionSettings) => void;
  onReset: () => void;
}) {
  const patch = (delta: Partial<ConversionSettings>) => onChange({ ...settings, ...delta });

  return (
    <div className="settings-stack">
      <div className="settings-heading">
        <span>Reconstruction</span>
        <button className="text-action" onClick={onReset} title="Restore defaults">reset</button>
      </div>

      <div className="mode-grid" role="radiogroup" aria-label="Reconstruction mode">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            role="radio"
            aria-checked={settings.reconstructionMode === mode.id}
            className={`mode-chip ${settings.reconstructionMode === mode.id ? "active" : ""}`}
            onClick={() => patch({ reconstructionMode: mode.id })}
            title={mode.hint}
          >
            <Icon name={mode.icon} size={15} />
            <span>{mode.label}</span>
          </button>
        ))}
      </div>

      <label className="range-control">
        <span>
          <b>Coplanar threshold</b>
          <output>{settings.coplanarThresholdDegrees}°</output>
        </span>
        <input
          type="range"
          min="5"
          max="35"
          value={settings.coplanarThresholdDegrees}
          onChange={(e) => patch({ coplanarThresholdDegrees: Number(e.target.value) })}
        />
        <small>Merge adjacent faces within this normal angle.</small>
      </label>

      <label className="range-control">
        <span>
          <b>OBB fit tolerance</b>
          <output>{(settings.obbFitTolerance * 100).toFixed(1)}%</output>
        </span>
        <input
          type="range"
          min="0.004"
          max="0.04"
          step="0.002"
          value={settings.obbFitTolerance}
          onChange={(e) => patch({ obbFitTolerance: Number(e.target.value) })}
        />
        <small>How tightly oriented boxes hug vertex clusters.</small>
      </label>

      <label className="range-control">
        <span>
          <b>Min region volume</b>
          <output>{(settings.minRegionVolume * 1e5).toFixed(1)}e-5</output>
        </span>
        <input
          type="range"
          min="0.000002"
          max="0.0002"
          step="0.000002"
          value={settings.minRegionVolume}
          onChange={(e) => patch({ minRegionVolume: Number(e.target.value) })}
        />
        <small>Ignore micro-artefacts below this volume.</small>
      </label>

      <label className="toggle-control">
        <span>
          <b>Smooth normals</b>
          <small>{settings.enableNormalsSmoothing ? "Smooth shading" : "Flat shading"} on indexed output</small>
        </span>
        <button
          className={`toggle ${settings.enableNormalsSmoothing ? "on" : ""}`}
          role="switch"
          aria-checked={settings.enableNormalsSmoothing}
          onClick={() => patch({ enableNormalsSmoothing: !settings.enableNormalsSmoothing })}
        >
          <i />
        </button>
      </label>
    </div>
  );
}
