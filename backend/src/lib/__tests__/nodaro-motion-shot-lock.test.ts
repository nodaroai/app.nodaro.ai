import { describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_SHOT_LOCK_KEY,
  anyShotLockOn,
  engineTakesShotLock,
  nodaroMotionShotLockSchema,
  parseNodaroMotionShotLock,
  shotLockForPlugin,
  shotLockOf,
  shotLocksOn,
} from "../nodaro-motion-shot-lock.js"

/**
 * `nodaro_motion_shot_lock`: per Video Remake engine, whether a direct run's
 * prompt on an ordinary clip carries the shot lock's line.
 *
 * What must hold:
 *  - off everywhere until an admin turns an engine on: no deployment default;
 *  - "off" is the same as left out, and is never stored or answered;
 *  - the engine is answered each engine that is on under its current and its
 *    earlier keys, or null when none is.
 */
describe("nodaro_motion_shot_lock", () => {
  it("is the app_settings row nodaro_motion_shot_lock", () => {
    expect(NODARO_MOTION_SHOT_LOCK_KEY).toBe("nodaro_motion_shot_lock")
  })

  it("an admin's save is strict: \"off\" or \"on\" per public engine id", () => {
    for (const good of [{}, { "nodaro-prism": "on" }, { "nodaro-prism": "off", "nodaro-pulse": "on" }]) {
      expect(nodaroMotionShotLockSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [{ "nodaro-prism": true }, { "nodaro-prism": "yes" }, { "seedance-2-5": "on" }, { enabled: true }, "on", null]) {
      expect(nodaroMotionShotLockSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("is off for every engine with nothing saved, and for an engine left out", () => {
    for (const setting of [null, undefined, {}]) {
      expect(shotLockOf(setting, "nodaro-prism"), JSON.stringify(setting)).toBe("off")
      expect(shotLockOf(setting, "nodaro-pulse"), JSON.stringify(setting)).toBe("off")
      expect(anyShotLockOn(setting)).toBe(false)
    }
    expect(shotLockOf({ "nodaro-pulse": "on" }, "nodaro-prism")).toBe("off")
    expect(shotLockOf({ "nodaro-pulse": "on" }, "nodaro-pulse")).toBe("on")
    expect(anyShotLockOn({ "nodaro-pulse": "on" })).toBe(true)
    expect(anyShotLockOn({ "nodaro-prism": "off" })).toBe(false)
  })

  it("stores only the engines that are on, in a new object", () => {
    const setting = { "nodaro-prism": "off", "nodaro-pulse": "on" } as const
    expect(shotLocksOn(setting)).toEqual({ "nodaro-pulse": "on" })
    expect(shotLocksOn(setting)).not.toBe(setting)
    expect(shotLocksOn({ "nodaro-prism": "off" })).toEqual({})
  })

  it("answers the engine each engine that is on under its current and its earlier keys, null when none is", () => {
    expect(shotLockForPlugin(null)).toBeNull()
    expect(shotLockForPlugin({})).toBeNull()
    expect(shotLockForPlugin({ "nodaro-prism": "off" })).toBeNull()
    expect(shotLockForPlugin({ "nodaro-prism": "on" })).toEqual({ "nodaro-prism": "on", "motion-prism": "on", "motion-pro": "on" })
    expect(shotLockForPlugin({ "nodaro-prism": "on", "nodaro-pulse": "on" })).toEqual({
      "nodaro-prism": "on",
      "motion-prism": "on",
      "motion-pro": "on",
      "nodaro-pulse": "on",
      "motion-pulse": "on",
      "motion-lite": "on",
    })
  })

  it("reads the stored row tolerantly: an earlier key as the current one, an invalid value dropped with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionShotLock(null, warn)).toBeNull()
    expect(parseNodaroMotionShotLock({}, warn)).toEqual({})
    expect(parseNodaroMotionShotLock({ "nodaro-prism": "on", "nodaro-pulse": "off" }, warn)).toEqual({ "nodaro-prism": "on" })
    expect(parseNodaroMotionShotLock({ "motion-pulse": "on" }, warn)).toEqual({ "nodaro-pulse": "on" })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionShotLock({ "nodaro-prism": "always", "nodaro-pulse": "on" }, warn)).toEqual({ "nodaro-pulse": "on" })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(NODARO_MOTION_SHOT_LOCK_KEY)
  })

  it("an engine writes the line only when it declares castSwap.shotLock", () => {
    expect(engineTakesShotLock({ shotLock: true })).toBe(true)
    for (const cs of [undefined, {}, { shotLock: false }, { previz: true }]) expect(engineTakesShotLock(cs as never), JSON.stringify(cs)).toBe(false)
  })
})
