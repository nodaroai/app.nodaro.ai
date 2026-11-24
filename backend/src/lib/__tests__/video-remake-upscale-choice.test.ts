import { afterEach, describe, expect, it } from "vitest"
import { engineTakesUpscaleChoice, loadedEngineTakesUpscaleChoice, outputResolutionLabel, upscaleQuoteOf } from "../video-remake-upscale-choice.js"
import { videoRemakeEngineQuoteOf } from "../video-remake-engine-quote.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../private-plugins/supports-registry.js"

/**
 * Video Remake's upscale choice, as the platform reads it: whether the engine takes the field
 * (`castSwap.upscaleChoice`), and the estimate's four fields, each kept only when it is a value
 * of the contract (an older engine answers none, and nothing is added for it).
 */
describe("the upscale choice", () => {
  afterEach(() => _resetPluginSupportsForTests())

  it("is taken only by an engine that declares castSwap.upscaleChoice true", () => {
    expect(engineTakesUpscaleChoice(undefined)).toBe(false)
    expect(engineTakesUpscaleChoice({ upscaleChoice: false } as never)).toBe(false)
    expect(engineTakesUpscaleChoice({ preciseUpscale: true } as never)).toBe(false)
    expect(engineTakesUpscaleChoice({ upscaleChoice: true } as never)).toBe(true)
    expect(loadedEngineTakesUpscaleChoice()).toBe(false)
    setPluginSupports({ castSwap: { upscaleChoice: true } as never })
    expect(loadedEngineTakesUpscaleChoice()).toBe(true)
  })

  it("reads the estimate's fields, dropping any value outside the contract", () => {
    expect(upscaleQuoteOf({ resolution: "480p", outputResolution: "720p", upscale: "next", upscaleOffered: true })).toEqual({
      resolution: "480p",
      outputResolution: "720p",
      upscale: "next",
      upscaleOffered: true,
    })
    expect(upscaleQuoteOf({ resolution: "4k", outputResolution: 720, upscale: "applied", upscaleOffered: "yes" })).toEqual({})
    // A 1080p run is delivered at 4K: "4k" (lower-case, exactly) is a delivered size, never the engine's.
    expect(upscaleQuoteOf({ resolution: "1080p", outputResolution: "4k", upscale: "next", upscaleOffered: true })).toEqual({
      resolution: "1080p",
      outputResolution: "4k",
      upscale: "next",
      upscaleOffered: true,
    })
    expect(upscaleQuoteOf({ resolution: "1080p", outputResolution: "4K" })).toEqual({ resolution: "1080p" })
    expect(upscaleQuoteOf({ resolution: "1080p", outputResolution: "2160p" })).toEqual({ resolution: "1080p" })
    expect(upscaleQuoteOf(null)).toEqual({})
    expect(upscaleQuoteOf({ totalCredits: 1 })).toEqual({})
  })

  it("carries them on the Video to Video quote of a Video Remake engine, and none for an engine that answers none", () => {
    const base = { totalCredits: 20, breakdown: { base: 5, motion: 7, references: 0, upscale: 8 }, settlesLower: false }
    expect(videoRemakeEngineQuoteOf({ data: { ...base, resolution: "720p", outputResolution: "1080p", upscale: "next", upscaleOffered: true } }, "nodaro-prism")).toMatchObject({
      breakdown: { upscale: 8 },
      resolution: "720p",
      outputResolution: "1080p",
      upscale: "next",
      upscaleOffered: true,
    })
    expect(videoRemakeEngineQuoteOf({ data: { ...base, resolution: "1080p", outputResolution: "4k", upscale: "next", upscaleOffered: true } }, "nodaro-prism")).toMatchObject({
      resolution: "1080p",
      outputResolution: "4k",
      upscale: "next",
      upscaleOffered: true,
    })
    const older = videoRemakeEngineQuoteOf(base, "nodaro-prism")!
    for (const key of ["resolution", "outputResolution", "upscale", "upscaleOffered"]) expect(key in older, key).toBe(false)
  })

  it("names a delivered size in words: 4K for \"4k\", the others as spelled", () => {
    expect(outputResolutionLabel("4k")).toBe("4K")
    expect(outputResolutionLabel("1080p")).toBe("1080p")
    expect(outputResolutionLabel("720p")).toBe("720p")
  })
})
