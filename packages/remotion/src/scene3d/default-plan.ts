import type { Scene3DPlanV1 } from "./types"

/**
 * A minimal, VALID Scene3D plan: ground, hero block and a key light.
 *
 * Used as the `3d-scene` composition's default props (Remotion Studio and a
 * bare CLI render need something to draw) and available to hosts that want a
 * placeholder before a generation returns. It is checked against the real
 * `scene3DPlanSchema` in `__tests__/contract-conformance.test.ts` — the plan schema is
 * `.strict()`, so a contract change that this fixture misses fails there
 * instead of at render time.
 */
export const SCENE3D_DEFAULT_PLAN: Scene3DPlanV1 = {
  planType: "3d-scene",
  schemaVersion: 1,
  revisionId: "00000000-0000-4000-8000-000000000000",
  width: 1920,
  height: 1080,
  fps: 24,
  durationInFrames: 96,
  backgroundColor: "#0b0b10",
  camera: {
    position: [0, 2.5, 9],
    target: [0, 1, 0],
    focalLengthMm: 35,
    sensorWidthMm: 36,
  },
  objects: [
    {
      id: "ground",
      name: "Ground",
      primitive: "plane",
      dimensions: [24, 24, 1],
      position: [0, 0, 0],
      rotation: [-Math.PI / 2, 0, 0],
      scale: [1, 1, 1],
      color: "#3f3f46",
    },
    {
      id: "hero",
      name: "Hero block",
      primitive: "box",
      dimensions: [2, 2, 2],
      position: [0, 1, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: "#e4a04c",
    },
  ],
  lighting: {
    ambientIntensity: 0.55,
    keyIntensity: 1.6,
    keyPosition: [6, 8, 5],
  },
}
