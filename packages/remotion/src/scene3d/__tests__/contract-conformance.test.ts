import { describe, it, expect } from "vitest"
import { scene3DPlanSchema } from "@nodaro/shared"
import { SCENE3D_DEFAULT_PLAN } from "../default-plan"
import { sampleScene3DFrame } from "../sampler"
import { buildScene3DScene } from "../scene-builder"
import { makeObject, makePlan } from "./fixtures"

/**
 * The renderer consumes plans that the shared contract produced, so the fixtures
 * this package tests against must be plans that contract ACCEPTS. Without this,
 * the renderer suite could stay green against a shape the platform can never
 * emit (the plan schema is `.strict()` — a renamed field would slip through
 * every other test here).
 */
function parse(plan: unknown) {
  const result = scene3DPlanSchema.safeParse(plan)
  if (!result.success) {
    throw new Error(
      `plan rejected by @nodaro/shared: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    )
  }
  return result.data
}

describe("Scene3D renderer fixtures conform to the shared contract", () => {
  it("accepts the default plan the composition ships with", () => {
    expect(() => parse(SCENE3D_DEFAULT_PLAN)).not.toThrow()
  })

  it("accepts the plan fixture every renderer test is built on", () => {
    expect(() => parse(makePlan())).not.toThrow()
  })

  it("accepts an animated, parented fixture", () => {
    const plan = makePlan({
      durationInFrames: 48,
      camera: {
        position: [0, 2, 8],
        target: [0, 0, 0],
        focalLengthMm: 35,
        sensorWidthMm: 36,
        keyframes: [{ frame: 47, position: [4, 2, 6], focalLengthMm: 50, easing: "easeInOut" }],
      },
      objects: [
        makeObject({ id: "rig", primitive: "group", keyframes: [{ frame: 47, rotation: [0, 3, 0] }] }),
        makeObject({ id: "sat", parentId: "rig", primitive: "sphere", position: [3, 0, 0] }),
      ],
    } as never)
    expect(() => parse(plan)).not.toThrow()
  })

  it("renders every primitive the contract allows", () => {
    // A primitive added to the contract but not to the builder would fall
    // through to the default box; this keeps that from going unnoticed.
    const primitives = ["box", "sphere", "cylinder", "cone", "plane", "capsule", "group"] as const
    const plan = makePlan({
      objects: primitives.map((primitive, index) =>
        makeObject({ id: `p-${index}`, primitive, position: [index * 2, 0, 0] } as never),
      ),
    })
    parse(plan)

    const handle = buildScene3DScene(plan)
    expect(handle.objects.size).toBe(primitives.length)
    // every primitive except `group` gets a mesh
    expect(handle.meshes.size).toBe(primitives.length - 1)

    const sample = sampleScene3DFrame(plan, 0)
    for (const objectSample of sample.objects) {
      expect(objectSample.worldPosition.every(Number.isFinite)).toBe(true)
    }
    handle.dispose()
  })

  it("samples the contract's own duration bounds without producing NaN", () => {
    const plan = parse(SCENE3D_DEFAULT_PLAN)
    for (const frame of [0, Math.floor(plan.durationInFrames / 2), plan.durationInFrames - 1]) {
      const sample = sampleScene3DFrame(plan as never, frame)
      expect(Number.isFinite(sample.camera.fovDeg)).toBe(true)
      expect(sample.camera.fovDeg).toBeGreaterThan(0)
      expect(sample.camera.fovDeg).toBeLessThan(180)
      for (const objectSample of sample.objects) {
        expect(objectSample.worldMatrix.every(Number.isFinite)).toBe(true)
      }
    }
  })
})
