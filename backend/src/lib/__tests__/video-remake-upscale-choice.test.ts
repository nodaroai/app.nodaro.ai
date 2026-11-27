import { afterEach, describe, expect, it, vi } from "vitest"

const topaz = vi.hoisted(() => ({ disabled: false }))
vi.mock("../topaz-video-availability.js", () => ({ topazVideoDisabledHere: () => topaz.disabled }))

import { enginePreciseUpscale, engineTakesUpscaleChoice, upscaleStepOffered } from "../video-remake-upscale-choice.js"
import { videoRemakeEngineQuoteOf } from "../video-remake-engine-quote.js"

/**
 * Video Remake's step one size up, as the platform reads it now that the request read the earlier way is removed:
 * the admin's kill switch per engine size (`upscaleStepOffered`, the rule the delivered sizes are built from), the
 * Precise upscale as the engine is handed it, and whether the engine words the admin's rows as kill switches. No
 * answer names the step: the Video to Video quote of a Video Remake engine folds an older engine's step line into
 * the engine's own and answers only the size delivered.
 */
describe("whether the engine reads the admin's rows as kill switches", () => {
  it("only an engine that declares castSwap.upscaleChoice true", () => {
    expect(engineTakesUpscaleChoice(undefined)).toBe(false)
    expect(engineTakesUpscaleChoice({ upscaleChoice: false } as never)).toBe(false)
    expect(engineTakesUpscaleChoice({ preciseUpscale: true } as never)).toBe(false)
    expect(engineTakesUpscaleChoice({ upscaleChoice: true } as never)).toBe(true)
  })
})

describe("upscaleStepOffered: the admin's kill switch for one step, read as the engine reads it", () => {
  afterEach(() => {
    topaz.disabled = false
  })
  const CS = { preciseUpscale: true } as never
  const ALL_ON = { "480p": "1080p", "720p": "1080p", "1080p": "4k", flash: { "480p": "1080p", "720p": "1080p" } }

  it("all rows on (a setting never saved is every default): every step on every engine", () => {
    for (const precise of [ALL_ON, enginePreciseUpscale(null, CS)]) {
      for (const size of ["480p", "720p", "1080p"] as const) {
        expect(upscaleStepOffered("nodaro-prism", size, precise), size).toBe(true)
        expect(upscaleStepOffered("nodaro-pulse", size, precise), size).toBe(true)
      }
      for (const size of ["480p", "720p"] as const) expect(upscaleStepOffered("nodaro-prism-flash", size, precise)).toBe(true)
      expect(upscaleStepOffered("nodaro-pulse-flash", "720p", precise)).toBe(true)
    }
  })

  it("a Prism row off turns that size's step off on Prism, and on Prism Flash where it has no row of its own", () => {
    expect(upscaleStepOffered("nodaro-prism", "720p", { ...ALL_ON, "720p": "off" })).toBe(false)
    expect(upscaleStepOffered("nodaro-prism", "480p", { ...ALL_ON, "720p": "off" })).toBe(true)
    // Prism Flash's own row decides its 480p and 720p; its 1080p (no Flash row) falls through to Prism's.
    expect(upscaleStepOffered("nodaro-prism-flash", "720p", { ...ALL_ON, "720p": "off" })).toBe(true)
    expect(upscaleStepOffered("nodaro-prism-flash", "480p", { ...ALL_ON, flash: { "480p": "off", "720p": "4k" } })).toBe(false)
    expect(upscaleStepOffered("nodaro-prism-flash", "1080p", { ...ALL_ON, "1080p": "off" })).toBe(false)
    expect(upscaleStepOffered("nodaro-prism-flash", "1080p", ALL_ON)).toBe(true)
  })

  it("Nodaro Pulse and Pulse Flash have no row: on whatever the rows say", () => {
    const allOff = { "480p": "off", "720p": "off", "1080p": "off", flash: { "480p": "off", "720p": "off" } }
    expect(upscaleStepOffered("nodaro-pulse", "720p", allOff)).toBe(true)
    expect(upscaleStepOffered("nodaro-pulse-flash", "720p", null)).toBe(true)
  })

  it("a missing row, a value that is not a target, or no value (the settings unread): no Prism-family step", () => {
    expect(upscaleStepOffered("nodaro-prism", "480p", { "720p": "1080p" })).toBe(false)
    expect(upscaleStepOffered("nodaro-prism", "480p", { ...ALL_ON, "480p": "on" })).toBe(false)
    expect(upscaleStepOffered("nodaro-prism", "1080p", { ...ALL_ON, "1080p": 4 })).toBe(false)
    expect(upscaleStepOffered("nodaro-prism-flash", "480p", { ...ALL_ON, flash: "x" })).toBe(true)
    for (const precise of [null, undefined]) expect(upscaleStepOffered("nodaro-prism", "720p", precise)).toBe(false)
  })

  it("the value the engine is handed: null where it reads no row; while Topaz is withheld every size off and no step on any engine", () => {
    expect(enginePreciseUpscale(null, { preciseUpscale: false } as never)).toBeNull()
    expect(enginePreciseUpscale({ "480p": "off" }, CS)).toMatchObject({ "480p": "off", "720p": "1080p", "1080p": "4k" })
    topaz.disabled = true
    expect(enginePreciseUpscale({ "480p": "4k" }, CS)).toMatchObject({ "480p": "off", "720p": "off", "1080p": "off" })
    expect(upscaleStepOffered("nodaro-pulse", "720p", ALL_ON)).toBe(false)
    expect(upscaleStepOffered("nodaro-prism", "480p", ALL_ON)).toBe(false)
  })
})

describe("the Video to Video quote of a Video Remake engine names no step", () => {
  const base = { totalCredits: 20, breakdown: { base: 5, motion: 7, references: 0 }, settlesLower: false }

  it("an engine that answers the earlier fields: the size delivered as resolution, the step in the engine's line, nothing else of them", () => {
    for (const [answered, delivered] of [
      [{ resolution: "720p", outputResolution: "1080p", upscale: "next", upscaleOffered: true }, "1080p"],
      [{ resolution: "1080p", outputResolution: "4k", upscale: "next", upscaleOffered: true }, "4k"],
      [{ resolution: "720p", outputResolution: "720p", upscale: "off", upscaleOffered: false }, "720p"],
    ] as const) {
      const quote = videoRemakeEngineQuoteOf({ data: { ...base, breakdown: { ...base.breakdown, upscale: 8 }, ...answered } }, "nodaro-prism")!
      expect(quote.resolution).toBe(delivered)
      expect(quote.breakdown).toEqual({ base: 5, motion: 15, references: 0 })
      for (const key of ["outputResolution", "upscale", "upscaleOffered"]) expect(quote, key).not.toHaveProperty(key)
      expect(quote.totalCredits).toBe(20)
    }
  })

  it("an engine that answers the size delivered: as it is; one that answers no size: none", () => {
    expect(videoRemakeEngineQuoteOf({ ...base, resolution: "4k" }, "nodaro-prism")).toMatchObject({ resolution: "4k", breakdown: base.breakdown })
    const older = videoRemakeEngineQuoteOf(base, "nodaro-prism")!
    for (const key of ["resolution", "outputResolution", "upscale", "upscaleOffered"]) expect(older, key).not.toHaveProperty(key)
    // A value outside the contract is no size.
    expect(videoRemakeEngineQuoteOf({ ...base, resolution: "4K", outputResolution: "2160p" }, "nodaro-prism")).not.toHaveProperty("resolution")
  })
})
