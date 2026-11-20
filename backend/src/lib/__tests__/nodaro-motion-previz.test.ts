import { afterEach, describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_PREVIZ_KEY,
  engineTakesPreviz,
  nodaroMotionPrevizSchema,
  parseNodaroMotionPreviz,
  previzEnabled,
  previzForPlugin,
  withoutDefaultPreviz,
} from "../nodaro-motion-previz.js"
import { previzOfferedByDefault } from "../nodaro-motion-previz-default.js"
import { __resetSurfaceProfileCacheForTests, surfaceGateOpen } from "../surface-profile.js"

/**
 * `nodaro_motion_previz`: whether this deployment accepts a Video Remake run
 * whose clip is a 3D previz (`clipKind: "previz"`).
 *
 * What must hold:
 *  - `enabled` is the admin's choice only once one was made; without one the
 *    deployment's default decides (on for Nodaro's own deployment, off under
 *    a white-label surface profile), and a saved choice wins either way;
 *  - the engine is always answered an object whose `enabled` is resolved;
 *  - the stored row is read field by field.
 */
describe("nodaro_motion_previz", () => {
  it("is the app_settings row nodaro_motion_previz", () => {
    expect(NODARO_MOTION_PREVIZ_KEY).toBe("nodaro_motion_previz")
  })

  it("an admin's save is strict: the switch, nothing else", () => {
    for (const good of [{}, { enabled: true }, { enabled: false }]) {
      expect(nodaroMotionPrevizSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [{ enabled: "true" }, { enabled: null }, { engine: "nodaro-prism" }, { enabled: true, lighting: true }, true, null, []]) {
      expect(nodaroMotionPrevizSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("stores the switch only when an admin chose a value", () => {
    expect(withoutDefaultPreviz(null)).toEqual({})
    expect(withoutDefaultPreviz({})).toEqual({})
    expect(withoutDefaultPreviz({ enabled: false })).toEqual({ enabled: false })
    expect(withoutDefaultPreviz({ enabled: true })).toEqual({ enabled: true })
  })

  it("reads the stored row field by field: a switch that is not a boolean reads as never chosen, with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionPreviz(null, warn)).toBeNull()
    expect(parseNodaroMotionPreviz("on", warn)).toBeNull()
    expect(parseNodaroMotionPreviz([], warn)).toBeNull()
    expect(parseNodaroMotionPreviz({}, warn)).toEqual({})
    // A key this build does not know is ignored; nothing else is dropped for it.
    expect(parseNodaroMotionPreviz({ enabled: false, later: { a: 1 } }, warn)).toEqual({ enabled: false })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionPreviz({ enabled: "yes" }, warn)).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(NODARO_MOTION_PREVIZ_KEY)
  })

  it("resolves the switch: the admin's saved choice, else the deployment's default", () => {
    for (const setting of [null, undefined, {}]) {
      expect(previzEnabled(setting, true), JSON.stringify(setting)).toBe(true)
      expect(previzEnabled(setting, false), JSON.stringify(setting)).toBe(false)
    }
    expect(previzEnabled({ enabled: true }, false)).toBe(true)
    expect(previzEnabled({ enabled: false }, true)).toBe(false)
  })

  it("answers the engine an object every time, `enabled` resolved, a new object", () => {
    expect(previzForPlugin(null, true)).toStrictEqual({ enabled: true })
    expect(previzForPlugin(null, false)).toStrictEqual({ enabled: false })
    expect(previzForPlugin({ enabled: true }, false)).toStrictEqual({ enabled: true })
    const saved = { enabled: false }
    expect(previzForPlugin(saved, true)).toStrictEqual({ enabled: false })
    expect(previzForPlugin(saved, true)).not.toBe(saved)
  })

  it("an engine takes a 3D previz clip only when it declares castSwap.previz", () => {
    expect(engineTakesPreviz({ previz: true })).toBe(true)
    for (const cs of [undefined, {}, { previz: false }, { planRoles: true, shotLock: true }]) expect(engineTakesPreviz(cs as never), JSON.stringify(cs)).toBe(false)
  })
})

describe("the deployment's default for 3D previz clips", () => {
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
    expect(previzOfferedByDefault()).toBe(true)
    configure({ header: "default" })
    expect(previzOfferedByDefault()).toBe(true)
    configure({ brand: { productName: "Acme" } })
    expect(previzOfferedByDefault()).toBe(true)
  })

  it("is off under a white-label surface profile", () => {
    // The profile is read only where the edition takes one (this suite's does).
    expect(surfaceGateOpen()).toBe(true)
    configure({ header: "white-label" })
    expect(previzOfferedByDefault()).toBe(false)
  })
})
