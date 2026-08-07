# Obj-to-3js-tool (Paramesh)

A reverse-geometry compiler that turns Wavefront `.obj` meshes into clean,
standalone, procedural **Three.js + TypeScript** code — with near 1:1 visual
fidelity and **no axis-aligned voxel/staircase artifacts** on angled features.

The headline fix: instead of stacking **Axis-Aligned Bounding Boxes (AABB)** —
which chop an angled pistol grip into a staircase — the engine fits
**Oriented Bounding Boxes (OBB)** via Principal Component Analysis (PCA), so
grips, barrels and trigger guards keep their true angle.

```
Old AABB approach (blocky)        OBB / PCA approach (angled)
      [ ]                              / /
     [   ]                            / /
    [     ]                          / /
   [       ]                        / /
```

## Reconstruction modes

The engine analyses the mesh, scores every strategy with real metrics (OBB
coverage, convex-hull tightness, planarity, compression), and — in **Auto**
mode — recommends the best one by math.

| Mode | Output | Best for |
|---|---|---|
| `hybrid` (default) | OBB where the box fits, exact indexed geometry elsewhere | General purpose — clean code + high fidelity |
| `obb_primitives` | One PCA-oriented `BoxGeometry` per part (rotated via quaternion) | Clean low-poly parametric output |
| `convex_hulls` | Per-part `QuickHull` decomposition as indexed `BufferGeometry` | Convex / organic sub-regions |
| `indexed_buffer` | Lossless exact `BufferGeometry` (position/normal/index) | 100% precision |

## Tunable settings (live in the UI)

- **Reconstruction mode** — `auto | hybrid | obb_primitives | convex_hulls | indexed_buffer`
- **Coplanar threshold** (5–35°) — angle for merging adjacent faces during segmentation
- **OBB fit tolerance** (0.4–4%) — how tightly oriented boxes hug vertex clusters
- **Min region volume** — drop micro-artefacts below this size
- **Smooth normals** — toggle smooth vs flat shading on indexed output

## Repository layout

```
Obj-to-3js-tool/
├── public/models/                # sample OBJ test files
│   ├── glock-example.obj         # single-group, angled grip
│   └── launcher-example.obj      # 120+ named parts
├── src/
│   ├── components/               # React + Three.js UI
│   │   ├── ModelViewer.tsx       # viewport (renders OBB quaternions + side-by-side compare)
│   │   ├── SettingsPanel.tsx     # reconstruction controls
│   │   ├── CodePreview.tsx       # syntax-highlighted generated source
│   │   └── icons.tsx
│   ├── engine/                   # pure TypeScript, no Three.js dependency
│   │   ├── parsers/objParser.ts  # triangulate, weld duplicates, track groups
│   │   ├── decomposition/
│   │   │   ├── obbFitter.ts      # PCA OBB + recursive bisection part segmentation
│   │   │   ├── planarSegmentation.ts
│   │   │   └── convexHull.ts     # incremental 3D QuickHull
│   │   ├── generators/threejsCodeGenerator.ts
│   │   ├── geometryEngine.ts     # orchestrator + auto mode scoring
│   │   └── samples.ts
│   ├── types/engine.ts
│   ├── utils/pcaMath.ts          # Vec3 algebra, Jacobi PCA, OBB fit, quaternions
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── tests/                        # headless test harness + visual critic
│   ├── math.test.ts              # PCA / OBB / hull unit tests
│   ├── engine.test.ts            # end-to-end structural validation
│   └── visual-critic.ts          # the harshest QA reviewer + Markdown report
├── package.json
├── tsconfig.json
└── vite.config.ts
```

The engine (`src/engine`, `src/utils`, `src/types`) is **pure TypeScript** with
no Three.js import, so the math is fully unit-testable in Node. Only the
generated `procedural-part.ts` and the viewport depend on `three`.

## How OBB fixes angled features

1. **Partition** the mesh into parts. When the OBJ declares objects/groups
   (the launcher ships 120+), each group is a part. For single-group meshes
   (the glock), connected components seed recursive **OBB-tree bisection**.
2. **Fit an OBB** to each part: compute the vertex covariance, Jacobi-eigen
   decompose it for the principal axes, and find tight extents along them.
3. **Re-centre** along each axis using the projected span so the box hugs the
   geometry, and convert the axes to a quaternion.
4. Angled sub-volumes (the grip) get a non-identity quaternion, so the
   generated `BoxGeometry` is rotated to the true angle instead of being
   axis-aligned.

## Getting started

```bash
npm install
npm run dev        # http://localhost:5173  — loads the glock automatically
npm run build      # single-file production bundle
npm test           # math + engine unit tests (20 tests)
npm run test:visual  # Visual QA Critic report -> tests/report/visual-critic.md
```

## Verified results on the sample models

| Model | Parts | Auto mode | Fidelity | Angled OBB parts |
|---|---|---|---|---|
| Glock | 8 | hybrid | **97.8%** | 2 (grip + guard) |
| Launcher | 127 | hybrid | **100%** | grid-aligned model |

Both clear the **>90% visual similarity** acceptance bar, with the glock's
angled grip reconstructed at ~72° and zero AABB-staircase inflation.

The generated `procedural-part.ts` is standalone — it imports only `three`,
exposes a single `createProceduralPart(): THREE.Group`, and type-checks
against the real `@types/three` with no other dependencies.
