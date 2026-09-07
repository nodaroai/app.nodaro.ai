/** A minimal plan that PASSES the shared `scene3DPlanSchema`, so tests here
 *  exercise the real applier rather than a hand-rolled stand-in. */
export const REV_A = "11111111-1111-4111-8111-111111111111"
export const REV_B = "22222222-2222-4222-8222-222222222222"

export function makePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planType: "3d-scene",
    schemaVersion: 1,
    revisionId: REV_A,
    width: 1920,
    height: 1080,
    fps: 24,
    durationInFrames: 96,
    backgroundColor: "#101014",
    camera: {
      position: [0, 2, 6],
      target: [0, 1, 0],
      focalLengthMm: 50,
      sensorWidthMm: 36,
    },
    objects: [
      {
        id: "ground",
        name: "Ground",
        primitive: "plane",
        dimensions: [10, 0.1, 10],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#3f3f46",
      },
      {
        id: "hero",
        name: "Hero",
        primitive: "capsule",
        parentId: "ground",
        dimensions: [0.5, 1.8, 0.5],
        position: [0, 1, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#f4a261",
        keyframes: [
          { frame: 0, position: [0, 1, 0] },
          { frame: 48, position: [2, 1, 0], easing: "easeInOut" },
        ],
      },
    ],
    lighting: { ambientIntensity: 0.4, keyIntensity: 1.2, keyPosition: [4, 6, 4] },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// v2 (baked) plans
// ---------------------------------------------------------------------------

export const REV_V2 = "33333333-3333-4333-8333-333333333333"
export const REV_V2_B = "44444444-4444-4444-8444-444444444444"

/** A 64-hex digest that is syntactically valid but names no real bytes. */
export const FAKE_DIGEST = "a".repeat(64)

/**
 * A minimal plan the SHARED `scene3DPlanV2Schema` accepts — camera sidecar
 * asset, one primitive entity, one shot tiling the whole timeline.
 *
 * Built as a plain record (not a typed literal) because every consumer under
 * test takes the plan the way the app really holds it: unvalidated JSON off a
 * node, an import, or a `postMessage`.
 */
export function makeV2Plan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    planType: "3d-scene",
    schemaVersion: 2,
    revisionId: REV_V2,
    width: 1920,
    height: 1080,
    fps: 24,
    durationInFrames: 96,
    units: "meters",
    upAxis: "Y",
    handedness: "right",
    backgroundColor: "#101014",
    objects: [
      {
        id: "hero",
        name: "Hero",
        role: "person",
        identityColor: "#f4a261",
        position: [0, 0.5, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        visual: { kind: "primitive", primitive: "capsule", dimensions: [0.5, 1.8, 0.5], color: "#f4a261" },
      },
      {
        id: "car",
        name: "Car",
        role: "vehicle",
        visual: { kind: "asset", assetId: "geo", rootNodeId: "car" },
        materialBindings: [{ role: "body", materialName: "CarBody", color: "#2a9d8f" }],
      },
    ],
    assets: [
      { assetId: "cam", kind: "camera-track-json", role: "camera-track", byteLength: 2, sha256: FAKE_DIGEST },
      { assetId: "geo", kind: "glb", role: "entity-geometry", byteLength: 1024, sha256: FAKE_DIGEST },
    ],
    cameraTrackAssetId: "cam",
    shots: [
      { id: "wide", label: "Wide", startFrame: 0, endFrameExclusive: 48 },
      { id: "close", label: "Close", startFrame: 48, endFrameExclusive: 96 },
    ],
    lighting: {
      preset: "clay-studio-v1",
      ambientIntensity: 0.55,
      keyIntensity: 1.6,
      keyPosition: [6, 8, 5],
    },
    provenance: {
      engine: "blender-cloud",
      engineVersion: "4.2.0",
      recipeVersion: "1.0.0",
      compilerVersion: "1.0.0",
      exporterVersion: "1.0.0",
      rendererVersion: "1.0.0",
      contentHash: FAKE_DIGEST,
    },
    ...overrides,
  }
}
