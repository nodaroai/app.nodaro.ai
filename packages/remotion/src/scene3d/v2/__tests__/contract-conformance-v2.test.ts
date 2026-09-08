import { describe, expect, it } from "vitest"
import {
  isScene3DPlanV1,
  isScene3DPlanV2,
  isScene3DSchemaVersionSupported,
  scene3DPlanSchemaVersion,
  scene3DPlanV2Schema,
  SCENE3D_SUPPORTED_SCHEMA_VERSIONS,
} from "@nodaro/shared"
import { validateScene3DPlanV2Shape } from "../load"
import { makePlan } from "../../__tests__/fixtures"
import { makeLoadableScene, makeV2Plan, TABLE_SHOTS } from "./v2-fixtures"

/**
 * The renderer consumes plans the shared contract produced, so the fixtures the
 * v2 suite is built on must be plans the contract ACCEPTS. Without this, the
 * renderer suite could stay green against a shape the platform can never emit
 * — the v2 plan schema is `.strict()`, so a renamed field would otherwise slip
 * through every other test here.
 */
function parse(plan: unknown) {
  const result = scene3DPlanV2Schema.safeParse(plan)
  if (!result.success) {
    throw new Error(
      `plan rejected by @nodaro/shared: ${result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    )
  }
  return result.data
}

describe("v2 renderer fixtures conform to the shared contract", () => {
  it("accepts the base plan fixture", () => {
    expect(() => parse(makeV2Plan())).not.toThrow()
  })

  it("accepts a loadable asset-backed scene", () => {
    const { plan } = makeLoadableScene({})
    expect(() => parse(plan)).not.toThrow()
  })

  it("accepts the spec's own 4-shot table timeline", () => {
    const { plan } = makeLoadableScene({ durationInFrames: 720, shots: TABLE_SHOTS })
    expect(() => parse(plan)).not.toThrow()
  })
})

describe("version negotiation", () => {
  it("reports the schema version of either plan, and null for neither", () => {
    expect(scene3DPlanSchemaVersion(makePlan())).toBe(1)
    expect(scene3DPlanSchemaVersion(makeV2Plan())).toBe(2)
    expect(scene3DPlanSchemaVersion({ planType: "slideshow" })).toBeNull()
  })

  it("agrees with the discriminators the canvas dispatches on", () => {
    expect(isScene3DPlanV2(makeV2Plan())).toBe(true)
    expect(isScene3DPlanV2(makePlan())).toBe(false)
    expect(isScene3DPlanV1(makePlan())).toBe(true)
    expect(isScene3DPlanV1(makeV2Plan())).toBe(false)
  })

  it("declares both versions supported by this build", () => {
    // An SDK consumer must be able to identify an unsupported version BEFORE
    // trying to render, rather than discovering it as a failed job.
    expect([...SCENE3D_SUPPORTED_SCHEMA_VERSIONS]).toEqual([1, 2])
    expect(isScene3DSchemaVersionSupported(1)).toBe(true)
    expect(isScene3DSchemaVersionSupported(2)).toBe(true)
    expect(isScene3DSchemaVersionSupported(3)).toBe(false)
  })

  it("refuses a v1 plan handed to the v2 loader", () => {
    // `inputProps` is unvalidated JSON, so the loader must not assume its
    // caller checked the discriminator first.
    expect(() => validateScene3DPlanV2Shape(makePlan() as never)).toThrow(/SCENE_PLAN_INVALID/)
  })

  it("refuses a future schema version instead of guessing", () => {
    const future = { ...makeV2Plan(), schemaVersion: 3 } as never
    expect(isScene3DPlanV2(future)).toBe(false)
    expect(() => validateScene3DPlanV2Shape(future)).toThrow(/SCENE_PLAN_INVALID/)
  })
})
