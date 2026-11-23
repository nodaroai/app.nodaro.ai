import { describe, expect, it, vi } from "vitest"
import {
  NODARO_MOTION_FLASH_OFFER_KEY,
  anyFlashOfferOn,
  engineTakesFlashChoices,
  nodaroMotionFlashOfferSchema,
  parseNodaroMotionFlashOffer,
  flashOfferForPlugin,
  flashOfferOf,
  flashOffersOn,
} from "../nodaro-motion-flash-offer.js"

/**
 * `nodaro_motion_flash_offer`: per Video Remake engine, whether every user may
 * pick its Flash choice (Prism Flash, Pulse Flash).
 *
 * What must hold:
 *  - a NEW key: the retired admin-only test's row (`nodaro_motion_flash_model`)
 *    is not it, so that row (on in production) exposes nothing;
 *  - off everywhere until an admin turns an engine on: no deployment default;
 *  - "off" is the same as left out, and is never stored or answered;
 *  - the engine is answered each engine that is on by its public id, or null.
 */
describe("nodaro_motion_flash_offer", () => {
  it("is the app_settings row nodaro_motion_flash_offer, never the retired test's", () => {
    expect(NODARO_MOTION_FLASH_OFFER_KEY).toBe("nodaro_motion_flash_offer")
    expect(NODARO_MOTION_FLASH_OFFER_KEY).not.toBe("nodaro_motion_flash_model")
  })

  it("an admin's save is strict: \"off\" or \"on\" per public engine id", () => {
    for (const good of [{}, { "nodaro-prism": "on" }, { "nodaro-prism": "off", "nodaro-pulse": "on" }]) {
      expect(nodaroMotionFlashOfferSchema.safeParse(good).success, JSON.stringify(good)).toBe(true)
    }
    for (const bad of [{ "nodaro-prism": true }, { "nodaro-prism": "yes" }, { "seedance-2-5": "on" }, { "nodaro-prism-flash": "on" }, { enabled: true }, "on", null]) {
      expect(nodaroMotionFlashOfferSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it("is off for every engine with nothing saved, and for an engine left out", () => {
    for (const setting of [null, undefined, {}]) {
      expect(flashOfferOf(setting, "nodaro-prism"), JSON.stringify(setting)).toBe("off")
      expect(flashOfferOf(setting, "nodaro-pulse"), JSON.stringify(setting)).toBe("off")
      expect(anyFlashOfferOn(setting)).toBe(false)
    }
    expect(flashOfferOf({ "nodaro-pulse": "on" }, "nodaro-prism")).toBe("off")
    expect(flashOfferOf({ "nodaro-pulse": "on" }, "nodaro-pulse")).toBe("on")
    expect(anyFlashOfferOn({ "nodaro-pulse": "on" })).toBe(true)
    expect(anyFlashOfferOn({ "nodaro-prism": "off" })).toBe(false)
  })

  it("stores only the engines that are on, in a new object", () => {
    const setting = { "nodaro-prism": "off", "nodaro-pulse": "on" } as const
    expect(flashOffersOn(setting)).toEqual({ "nodaro-pulse": "on" })
    expect(flashOffersOn(setting)).not.toBe(setting)
    expect(flashOffersOn({ "nodaro-prism": "off" })).toEqual({})
  })

  it("answers the engine each engine that is on, by its public id; null when none is", () => {
    expect(flashOfferForPlugin(null)).toBeNull()
    expect(flashOfferForPlugin({})).toBeNull()
    expect(flashOfferForPlugin({ "nodaro-prism": "off" })).toBeNull()
    expect(flashOfferForPlugin({ "nodaro-prism": "on" })).toEqual({ "nodaro-prism": "on" })
    expect(flashOfferForPlugin({ "nodaro-prism": "on", "nodaro-pulse": "on" })).toEqual({ "nodaro-prism": "on", "nodaro-pulse": "on" })
  })

  it("reads the stored row tolerantly: an invalid value dropped with a warning", () => {
    const warn = vi.fn()
    expect(parseNodaroMotionFlashOffer(null, warn)).toBeNull()
    expect(parseNodaroMotionFlashOffer({}, warn)).toEqual({})
    expect(parseNodaroMotionFlashOffer({ "nodaro-prism": "on", "nodaro-pulse": "off" }, warn)).toEqual({ "nodaro-prism": "on" })
    expect(warn).not.toHaveBeenCalled()
    expect(parseNodaroMotionFlashOffer({ "nodaro-prism": "always", "nodaro-pulse": "on" }, warn)).toEqual({ "nodaro-pulse": "on" })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain(NODARO_MOTION_FLASH_OFFER_KEY)
  })

  it("an engine runs the Flash choices only when it declares castSwap.flashChoices (the retired flashModel flag is not it)", () => {
    expect(engineTakesFlashChoices({ flashChoices: true })).toBe(true)
    for (const cs of [undefined, {}, { flashChoices: false }, { flashModel: true }, { shotLock: true }]) expect(engineTakesFlashChoices(cs as never), JSON.stringify(cs)).toBe(false)
  })
})
