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
