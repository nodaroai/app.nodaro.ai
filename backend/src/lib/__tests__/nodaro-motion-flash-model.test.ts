import { describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_FLASH_MODEL_KEY,
  anyFlashModelOn,
  engineTakesFlashModel,
  nodaroMotionFlashModelSchema,
  parseNodaroMotionFlashModel,
  flashModelForPlugin,
  flashModelOf,
  flashModelsOn,
} from "../nodaro-motion-flash-model.js"

/**
 * `nodaro_motion_flash_model`: per Video Remake engine, a test switch that
 * makes every new run of that engine on the faster model of the same family.
 *
 * What must hold:
 *  - off everywhere until an admin turns an engine on: no deployment default;
 *  - "off" is the same as left out, and is never stored or answered;
 *  - the engine is answered each engine that is on under its current and its
 *    earlier keys, or null when none is.
 */
describe("nodaro_motion_flash_model", () => {
  it("is the app_settings row nodaro_motion_flash_model", () => {
    expect(NODARO_MOTION_FLASH_MODEL_KEY).toBe("nodaro_motion_flash_model")
  })

  it("an admin's save is strict: \"off\" or \"on\" per public engine id", () => {
    for (const good of [{}, { "nodaro-prism": "on" }, { "nodaro-prism": "off", "nodaro-pulse": "on" }]) {
      expect(nodaroMotionFlashModelSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [{ "nodaro-prism": true }, { "nodaro-prism": "yes" }, { "seedance-2-5": "on" }, { enabled: true }, "on", null]) {
      expect(nodaroMotionFlashModelSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("is off for every engine with nothing saved, and for an engine left out", () => {
    for (const setting of [null, undefined, {}]) {
      expect(flashModelOf(setting, "nodaro-prism"), JSON.stringify(setting)).toBe("off")
      expect(flashModelOf(setting, "nodaro-pulse"), JSON.stringify(setting)).toBe("off")
      expect(anyFlashModelOn(setting)).toBe(false)
    }
    expect(flashModelOf({ "nodaro-pulse": "on" }, "nodaro-prism")).toBe("off")
    expect(flashModelOf({ "nodaro-pulse": "on" }, "nodaro-pulse")).toBe("on")
    expect(anyFlashModelOn({ "nodaro-pulse": "on" })).toBe(true)
    expect(anyFlashModelOn({ "nodaro-prism": "off" })).toBe(false)
  })

  it("stores only the engines that are on, in a new object", () => {
    const setting = { "nodaro-prism": "off", "nodaro-pulse": "on" } as const
    expect(flashModelsOn(setting)).toEqual({ "nodaro-pulse": "on" })
    expect(flashModelsOn(setting)).not.toBe(setting)
    expect(flashModelsOn({ "nodaro-prism": "off" })).toEqual({})
  })

  it("answers the engine each engine that is on under its current and its earlier keys, null when none is", () => {
    expect(flashModelForPlugin(null)).toBeNull()
    expect(flashModelForPlugin({})).toBeNull()
    expect(flashModelForPlugin({ "nodaro-prism": "off" })).toBeNull()
    expect(flashModelForPlugin({ "nodaro-prism": "on" })).toEqual({ "nodaro-prism": "on", "motion-prism": "on", "motion-pro": "on" })
    expect(flashModelForPlugin({ "nodaro-prism": "on", "nodaro-pulse": "on" })).toEqual({
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
    expect(parseNodaroMotionFlashModel(null, warn)).toBeNull()
    expect(parseNodaroMotionFlashModel({}, warn)).toEqual({})
    expect(parseNodaroMotionFlashModel({ "nodaro-prism": "on", "nodaro-pulse": "off" }, warn)).toEqual({ "nodaro-prism": "on" })
    expect(parseNodaroMotionFlashModel({ "motion-pulse": "on" }, warn)).toEqual({ "nodaro-pulse": "on" })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionFlashModel({ "nodaro-prism": "always", "nodaro-pulse": "on" }, warn)).toEqual({ "nodaro-pulse": "on" })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(NODARO_MOTION_FLASH_MODEL_KEY)
  })

  it("an engine runs the test only when it declares castSwap.flashModel", () => {
    expect(engineTakesFlashModel({ flashModel: true })).toBe(true)
    for (const cs of [undefined, {}, { flashModel: false }, { shotLock: true }]) expect(engineTakesFlashModel(cs as never), JSON.stringify(cs)).toBe(false)
  })
})
