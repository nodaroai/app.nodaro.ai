import { afterEach, describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_PLAN_ROLES_KEY,
  PLAN_ROLES_INSTRUCTIONS_STORED_MAX_CHARS,
  PLAN_ROLES_MODEL_MAX_CHARS,
  engineTakesPlanRoles,
  engineTakesPlanRolesReview,
  nodaroMotionPlanRolesSchema,
  parseNodaroMotionPlanRoles,
  planRolesEnabled,
  planRolesForPlugin,
  withoutDefaultPlanRoles,
} from "../nodaro-motion-plan-roles.js"
import { planRolesOfferedByDefault } from "../nodaro-motion-plan-roles-default.js"
import { __resetSurfaceProfileCacheForTests, surfaceGateOpen } from "../surface-profile.js"

/**
 * `nodaro_motion_plan_roles`: whether this deployment offers Video Remake's
 * roles planned from the prompt, and the admin's own instructions and model
 * for the engine's planning step.
 *
 * What must hold:
 *  - `enabled` is the admin's choice only once one was made; without one the
 *    deployment's default decides (on for Nodaro's own deployment, off under
 *    a white-label surface profile), and a saved choice wins either way;
 *  - the engine is always answered an object whose `enabled` is resolved;
 *  - the stored row is read field by field: one bad field drops alone.
 */
describe("nodaro_motion_plan_roles", () => {
  it("is the app_settings row nodaro_motion_plan_roles", () => {
    expect(NODARO_MOTION_PLAN_ROLES_KEY).toBe("nodaro_motion_plan_roles")
  })

  it("an admin's save is strict: the switch and the planning step, nothing else", () => {
    for (const good of [{}, { enabled: true }, { enabled: false }, { plan: {} }, { enabled: true, plan: { instructions: "Place each image.", model: "some-model" } }, { plan: { review: "full" } }, { plan: { review: "targeted", model: "m" } }]) {
      expect(nodaroMotionPlanRolesSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [
      { enabled: "true" },
      { enabled: null },
      { engine: "nodaro-prism" },
      { plan: "Place each image." },
      { plan: { instructions: 1 } },
      { plan: { prompt: "x" } },
      { plan: { model: ["a"] } },
      { plan: { review: "always" } },
      { plan: { review: true } },
      { medium: { model: "some-model" } },
      { plan: { instructions: "x".repeat(PLAN_ROLES_INSTRUCTIONS_STORED_MAX_CHARS + 1) } },
      { plan: { model: "m".repeat(PLAN_ROLES_MODEL_MAX_CHARS + 1) } },
      true,
      null,
      [],
    ]) {
      expect(nodaroMotionPlanRolesSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("stores the switch only when an admin chose a value, and the step only when it holds something", () => {
    expect(withoutDefaultPlanRoles(null)).toEqual({})
    expect(withoutDefaultPlanRoles({})).toEqual({})
    expect(withoutDefaultPlanRoles({ enabled: false })).toEqual({ enabled: false })
    expect(withoutDefaultPlanRoles({ enabled: true, plan: {} })).toEqual({ enabled: true })
    expect(withoutDefaultPlanRoles({ enabled: true, plan: { instructions: "   ", model: " " } })).toEqual({ enabled: true })
    // The instructions as written, the model trimmed.
    expect(withoutDefaultPlanRoles({ plan: { instructions: " Place each image.\n", model: " some-model " } })).toEqual({ plan: { instructions: " Place each image.\n", model: "some-model" } })
    // A step holding only its review mode is kept.
    expect(withoutDefaultPlanRoles({ plan: { review: "full" } })).toEqual({ plan: { review: "full" } })
    expect(withoutDefaultPlanRoles({ plan: { review: "targeted", model: " m " } })).toEqual({ plan: { review: "targeted", model: "m" } })
  })

  it("reads the stored row field by field: a bad field drops alone, with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPlanRoles(null, warn)).toBeNull()
    expect(parseNodaroMotionPlanRoles("on", warn)).toBeNull()
    expect(parseNodaroMotionPlanRoles([], warn)).toBeNull()
    expect(parseNodaroMotionPlanRoles({}, warn)).toEqual({})
    expect(warn).not.toHaveBeenCalled()
    // A key this build does not know is ignored; nothing else is dropped for it.
    expect(parseNodaroMotionPlanRoles({ enabled: false, later: { a: 1 }, plan: { model: "some-model", later: true } }, warn)).toEqual({ enabled: false, plan: { model: "some-model" } })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionPlanRoles({ enabled: "yes", plan: { instructions: 7, model: "another-model" } }, warn)).toEqual({ plan: { model: "another-model" } })
    expect(warn).toHaveBeenCalledTimes(2)
    expect(parseNodaroMotionPlanRoles({ enabled: true, plan: "text" }, warn)).toEqual({ enabled: true })
    expect(warn).toHaveBeenCalledTimes(3)
    // The review mode: kept when it is one, dropped alone (with a warning) when it is not.
    expect(parseNodaroMotionPlanRoles({ plan: { review: "full" } }, warn)).toEqual({ plan: { review: "full" } })
    expect(warn).toHaveBeenCalledTimes(3)
    expect(parseNodaroMotionPlanRoles({ plan: { review: "sometimes", model: "m" } }, warn)).toEqual({ plan: { model: "m" } })
    expect(warn).toHaveBeenCalledTimes(4)
    for (const [msg] of warn.mock.calls) expect(msg).toContain(NODARO_MOTION_PLAN_ROLES_KEY)
  })

  it("resolves the switch: the admin's saved choice, else the deployment's default", () => {
    for (const setting of [null, undefined, {}, { plan: { model: "some-model" } }]) {
      expect(planRolesEnabled(setting, true), JSON.stringify(setting)).toBe(true)
      expect(planRolesEnabled(setting, false), JSON.stringify(setting)).toBe(false)
    }
    expect(planRolesEnabled({ enabled: true }, false)).toBe(true)
    expect(planRolesEnabled({ enabled: false }, true)).toBe(false)
  })

  it("answers the engine an object every time, `enabled` resolved, the admin's step as stored, in new objects", () => {
    expect(planRolesForPlugin(null, true, true)).toStrictEqual({ enabled: true })
    expect(planRolesForPlugin(null, false, true)).toStrictEqual({ enabled: false })
    expect(planRolesForPlugin({ enabled: true }, false, true)).toStrictEqual({ enabled: true })
    const saved = { enabled: false, plan: { instructions: "Place each image.", model: "some-model" } }
    const got = planRolesForPlugin(saved, true, true)
    expect(got).toStrictEqual({ enabled: false, plan: { instructions: "Place each image.", model: "some-model" } })
    expect(got.plan).not.toBe(saved.plan)
  })

  it("sends the step's review mode only to an engine that reads it (castSwap.planRolesReview)", () => {
    const saved = { enabled: true, plan: { model: "some-model", review: "full" as const } }
    expect(planRolesForPlugin(saved, true, true)).toStrictEqual({ enabled: true, plan: { model: "some-model", review: "full" } })
    expect(planRolesForPlugin(saved, true, false)).toStrictEqual({ enabled: true, plan: { model: "some-model" } })
    // A step that held only its review mode is no step to an engine that does not read it.
    expect(planRolesForPlugin({ plan: { review: "full" } }, true, false)).toStrictEqual({ enabled: true })
    expect(engineTakesPlanRolesReview({ planRolesReview: true })).toBe(true)
    for (const cs of [undefined, {}, { planRoles: true }, { planRolesReview: false }]) expect(engineTakesPlanRolesReview(cs as never), JSON.stringify(cs)).toBe(false)
  })

  it("an engine plans roles only when it declares castSwap.planRoles", () => {
    expect(engineTakesPlanRoles({ planRoles: true })).toBe(true)
    for (const cs of [undefined, {}, { planRoles: false }, { customStyle: true }]) expect(engineTakesPlanRoles(cs as never), JSON.stringify(cs)).toBe(false)
  })
})

describe("the deployment's default for roles planned from the prompt", () => {
  const REAL_ENV = process.env.NODARO_SURFACE_PROFILE
  function configure(profile: unknown | undefined): void {
    if (profile === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = JSON.stringify(profile)
    __resetSurfaceProfileCacheForTests()
  }
  afterEach(() => {
    if (REAL_ENV === undefined) delete process.env.NODARO_SURFACE_PROFILE
    else process.env.NODARO_SURFACE_PROFILE = REAL_ENV
    __resetSurfaceProfileCacheForTests()
  })

  it("is on for Nodaro's own deployment (no profile, or one that keeps the platform's header)", () => {
    configure(undefined)
    expect(planRolesOfferedByDefault()).toBe(true)
    configure({ header: "default" })
    expect(planRolesOfferedByDefault()).toBe(true)
    configure({ brand: { productName: "Acme" } })
    expect(planRolesOfferedByDefault()).toBe(true)
  })

  it("is off under a white-label surface profile", () => {
    // The profile is read only where the edition takes one (this suite's does).
    expect(surfaceGateOpen()).toBe(true)
    configure({ header: "white-label" })
    expect(planRolesOfferedByDefault()).toBe(false)
  })
})
