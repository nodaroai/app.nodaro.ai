import { afterEach, describe, expect, it, vi } from "vitest"

const topaz = vi.hoisted(() => ({ disabled: false }))
vi.mock("../topaz-video-availability.js", () => ({ topazVideoDisabledHere: () => topaz.disabled }))

import {
  enginePreciseUpscale,
  engineTakesUpscaleChoice,
  loadedEngineTakesUpscaleChoice,
  outputResolutionLabel,
  upscaleNextOf,
  upscaleQuoteOf,
  upscaleToOffered,
  upscaleToReadsSettings,
} from "../video-remake-upscale-choice.js"
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

/**
 * `upscaleTo` (GET /v1/video-remake/style-choice): the engine's declared `castSwap.upscaleNext`, read
 * defensively, less every size the admin's Precise upscale switches off — read exactly as the engine
 * reads it (the value `tk.settings.nodaroMotionPreciseUpscale()` hands it): Prism the size's row,
 * Prism Flash its `flash` row else the size's, Pulse and Pulse Flash no row (always offered).
 */
describe("upscaleTo", () => {
  afterEach(() => {
    topaz.disabled = false
  })
  const NEXT = {
    "nodaro-prism": { "480p": "720p", "720p": "1080p", "1080p": "4k" },
    "nodaro-pulse": { "720p": "1080p", "1080p": "4k" },
    "nodaro-prism-flash": { "480p": "720p", "720p": "1080p" },
    "nodaro-pulse-flash": { "720p": "1080p" },
  } as const
  const CS = { upscaleChoice: true, preciseUpscale: true, upscaleNext: NEXT } as never
  const ALL_ON = { "480p": "1080p", "720p": "1080p", "1080p": "4k", flash: { "480p": "1080p", "720p": "1080p" } }
  const PULSE_ONLY = { "nodaro-pulse": NEXT["nodaro-pulse"], "nodaro-pulse-flash": NEXT["nodaro-pulse-flash"] }

  it("all rows on: the declared map, whole", () => {
    expect(upscaleToOffered(CS, ALL_ON)).toEqual(NEXT)
    // A setting never saved is every default, which turns every size on.
    expect(upscaleToOffered(CS, enginePreciseUpscale(null, CS))).toEqual(NEXT)
  })

  it("a row off removes that size from Prism, and from Prism Flash where it has no row of its own", () => {
    expect(upscaleToOffered(CS, { ...ALL_ON, "720p": "off" })).toEqual({ ...NEXT, "nodaro-prism": { "480p": "720p", "1080p": "4k" } })
    // An engine with no size left is left out.
    const allOff = { "480p": "off", "720p": "off", "1080p": "off", flash: { "480p": "off", "720p": "off" } }
    expect(upscaleToOffered(CS, allOff)).toEqual(PULSE_ONLY)
  })

  it("Prism Flash reads its own flash row for the size, else the size's row", () => {
    expect(upscaleToOffered(CS, { ...ALL_ON, flash: { "480p": "off", "720p": "4k" } })).toEqual({ ...NEXT, "nodaro-prism-flash": { "720p": "1080p" } })
    // Prism's rows off, Flash's on: Flash keeps its sizes.
    expect(upscaleToOffered(CS, { "480p": "off", "720p": "off", "1080p": "off", flash: { "480p": "1080p", "720p": "1080p" } })).toEqual({
      ...PULSE_ONLY,
      "nodaro-prism-flash": NEXT["nodaro-prism-flash"],
    })
    // A Flash 1080p (no Flash row there) falls through to Prism's 1080p row.
    const flash1080 = { upscaleChoice: true, upscaleNext: { "nodaro-prism-flash": { "1080p": "4k" } } } as never
    expect(upscaleToOffered(flash1080, { ...ALL_ON })).toEqual({ "nodaro-prism-flash": { "1080p": "4k" } })
    expect(upscaleToOffered(flash1080, { ...ALL_ON, "1080p": "off" })).toEqual({})
  })

  it("a missing row, or a value that is not a target, is not offered", () => {
    expect(upscaleToOffered(CS, { "720p": "1080p", flash: {} })).toEqual({
      ...PULSE_ONLY,
      "nodaro-prism": { "720p": "1080p" },
      "nodaro-prism-flash": { "720p": "1080p" },
    })
    expect(upscaleToOffered(CS, { ...ALL_ON, "480p": "on", "1080p": 4, flash: "x" })).toEqual({
      ...PULSE_ONLY,
      "nodaro-prism": { "720p": "1080p" },
      "nodaro-prism-flash": { "720p": "1080p" },
    })
  })

  it("a settings read failure (no value): Prism and Prism Flash nowhere, Pulse as declared", () => {
    expect(upscaleToOffered(CS, null)).toEqual(PULSE_ONLY)
    expect(upscaleToOffered(CS, undefined)).toEqual(PULSE_ONLY)
  })

  it("the value the engine is handed: null where it reads no row, every size off while Topaz is withheld", () => {
    expect(enginePreciseUpscale(null, { preciseUpscale: false } as never)).toBeNull()
    expect(upscaleToOffered(CS, enginePreciseUpscale(null, { ...(CS as object), preciseUpscale: false } as never))).toEqual(PULSE_ONLY)
    topaz.disabled = true
    // Withheld: Pulse's "next" runs the same upscale step, so no engine is offered it.
    expect(upscaleToOffered(CS, enginePreciseUpscale({ "480p": "4k" }, CS))).toEqual({})
    expect(upscaleToOffered(CS, null)).toEqual({})
    topaz.disabled = false
    expect(enginePreciseUpscale({ "480p": "off" }, CS)).toMatchObject({ "480p": "off", "720p": "1080p", "1080p": "4k" })
  })

  it("the capability absent, or upscaleChoice off: {}", () => {
    expect(upscaleToOffered(undefined, ALL_ON)).toEqual({})
    expect(upscaleToOffered({ upscaleChoice: true } as never, ALL_ON)).toEqual({})
    expect(upscaleToOffered({ upscaleNext: NEXT } as never, ALL_ON)).toEqual({})
    expect(upscaleToOffered({ upscaleChoice: false, upscaleNext: NEXT } as never, ALL_ON)).toEqual({})
    expect(upscaleToReadsSettings({ upscaleChoice: false, upscaleNext: NEXT } as never)).toBe(false)
  })

  it("drops an unknown engine id, size or target from the capability, and never throws on a malformed one", () => {
    const odd = {
      upscaleChoice: true,
      upscaleNext: {
        "nodaro-prism": { "480p": "720p", "360p": "480p", "720p": "8k", "1080p": "4K" },
        "motion-prism": { "480p": "720p" },
        "nodaro-ultra": { "720p": "1080p" },
        __proto__: { "nodaro-pulse": { "720p": "1080p" } },
        "nodaro-pulse": "all",
        "nodaro-pulse-flash": { "720p": "1080p", toString: "x" },
        "nodaro-prism-flash": {},
      },
    } as never
    expect(upscaleNextOf(odd)).toEqual({ "nodaro-prism": { "480p": "720p" }, "nodaro-pulse-flash": { "720p": "1080p" } })
    expect(upscaleToOffered(odd, ALL_ON)).toEqual({ "nodaro-prism": { "480p": "720p" }, "nodaro-pulse-flash": { "720p": "1080p" } })
    for (const upscaleNext of [null, "x", 1, [], [{ "nodaro-prism": {} }]]) {
      expect(upscaleNextOf({ upscaleChoice: true, upscaleNext } as never), JSON.stringify(upscaleNext)).toEqual({})
    }
  })

  it("reads the settings only where the declared map names a Prism-family engine", () => {
    expect(upscaleToReadsSettings(CS)).toBe(true)
    expect(upscaleToReadsSettings({ upscaleChoice: true, upscaleNext: { "nodaro-prism-flash": { "480p": "720p" } } } as never)).toBe(true)
    expect(upscaleToReadsSettings({ upscaleChoice: true, upscaleNext: PULSE_ONLY } as never)).toBe(false)
    expect(upscaleToReadsSettings({ upscaleChoice: true } as never)).toBe(false)
  })
})
