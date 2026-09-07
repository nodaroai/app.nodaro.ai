/**
 * Plan fixtures for the Scene3D renderer tests.
 *
 * Typed against the shared contract so a contract change breaks these first,
 * but constructed here (not imported from a factory) so the numbers under test
 * are visible in the test file itself.
 */
import type { Scene3DObject, Scene3DPlan } from "../types"

export function makeObject(partial: Partial<Scene3DObject> & { id: string }): Scene3DObject {
  return {
    name: partial.id,
    primitive: "box",
    dimensions: [1, 1, 1],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    color: "#ff8844",
    ...partial,
  } as Scene3DObject
}

export function makePlan(partial: Partial<Scene3DPlan> = {}): Scene3DPlan {
  return {
    planType: "3d-scene",
    schemaVersion: 1,
    revisionId: "11111111-1111-4111-8111-111111111111",
    width: 1920,
    height: 1080,
    fps: 24,
    durationInFrames: 48,
    backgroundColor: "#101014",
    camera: {
      position: [0, 2, 8],
      target: [0, 0, 0],
      focalLengthMm: 35,
      sensorWidthMm: 36,
    },
    objects: [makeObject({ id: "cube" })],
    lighting: {
      ambientIntensity: 0.5,
      keyIntensity: 1.2,
      keyPosition: [4, 6, 5],
    },
    ...partial,
  } as Scene3DPlan
}
