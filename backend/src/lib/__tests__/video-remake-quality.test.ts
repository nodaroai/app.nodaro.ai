import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ topazDisabled: false }))
vi.mock("../topaz-video-availability.js", () => ({ topazVideoDisabledHere: () => h.topazDisabled }))

const { engineTakesQuality, isVideoRemakeQuality, loadedEngineTakesQuality, qualityFullOf, qualityOffered, qualityQuoteOf, withQualityTheEngineTakes, VIDEO_REMAKE_QUALITIES } = await import("../video-remake-quality.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../private-plugins/supports-registry.js")

const DELIVERED = {
  "nodaro-prism": [{ size: "720p", from: "480p", native: true }, { size: "1080p", from: "720p", native: true }, { size: "4k", from: "1080p" }],
  "nodaro-pulse": [{ size: "720p", native: true }, { size: "1080p", from: "720p", native: true }, { size: "4k", from: "1080p" }],
  "nodaro-prism-flash": [{ size: "720p", from: "480p", native: true }, { size: "1080p", from: "720p" }],
  "nodaro-pulse-flash": [{ size: "720p", native: true }, { size: "1080p", from: "720p" }],
}
const FULL = { "nodaro-prism": ["480p", "720p", "1080p"], "nodaro-pulse": ["720p", "1080p"], "nodaro-prism-flash": ["480p", "720p"], "nodaro-pulse-flash": ["720p"] }
const CS = { deliveredResolution: true, deliveredResolutions: DELIVERED, quality: true, qualityFull: FULL } as never
const ROWS_ON = { "480p": "720p", "720p": "1080p", "1080p": "4k", flash: { "480p": "720p", "720p": "1080p" } }

beforeEach(() => {
  h.topazDisabled = false
  _resetPluginSupportsForTests()
})

describe("the choice's values", () => {
  it('are "full" and "economy", never the older "draft"', () => {
    expect(VIDEO_REMAKE_QUALITIES).toEqual(["full", "economy"])
    expect(["full", "economy", "draft", "Full", "", undefined, null, 1].map(isVideoRemakeQuality)).toEqual([true, true, false, false, false, false, false, false])
  })
})

describe("engineTakesQuality / loadedEngineTakesQuality", () => {
  it("is true only for castSwap.quality === true", () => {
    expect(engineTakesQuality({ quality: true } as never)).toBe(true)
    for (const cs of [undefined, {}, { quality: false }, { quality: "true" }, { quality: 1 }, { qualityFull: FULL }]) expect(engineTakesQuality(cs as never)).toBe(false)
  })

  it("reads the engine this process loaded", () => {
    expect(loadedEngineTakesQuality()).toBe(false)
    setPluginSupports({ castSwap: { quality: true } } as never)
    expect(loadedEngineTakesQuality()).toBe(true)
  })
})

describe("qualityFullOf", () => {
  it("keeps known engine choices and sizes, each size once, smallest first", () => {
    expect(qualityFullOf({ qualityFull: { "nodaro-prism": ["4k", "720p", "720p", "8k", 3], "nodaro-pulse": [], "motion-max": ["720p"], "nodaro-pulse-flash": "720p" } } as never)).toEqual({ "nodaro-prism": ["720p", "4k"] })
  })

  it("reads anything malformed as nothing, and never an inherited key", () => {
    for (const qualityFull of [undefined, null, [], "x", 1]) expect(qualityFullOf({ qualityFull } as never)).toEqual({})
    expect(qualityFullOf({ qualityFull: Object.create({ "nodaro-prism": ["720p"] }) } as never)).toEqual({})
    expect(qualityFullOf(undefined)).toEqual({})
  })
})

describe("qualityOffered", () => {
  it("is the sizes Full makes itself that a step this deployment offers also delivers", () => {
    expect(qualityOffered(CS, ROWS_ON)).toEqual({ "nodaro-prism": ["720p", "1080p"], "nodaro-pulse": ["1080p"], "nodaro-prism-flash": ["720p"] })
  })

  it("never lists a size the engine makes either way (no step: nothing to choose)", () => {
    const offered = qualityOffered(CS, ROWS_ON)
    expect(offered["nodaro-pulse"]).not.toContain("720p")
    expect(offered["nodaro-pulse-flash"]).toBeUndefined()
  })

  it("follows the admin's rows as the delivered sizes do: a step switched off has no choice; no rows read, no Prism-family size", () => {
    expect(qualityOffered(CS, { ...ROWS_ON, "720p": "off" })).toEqual({ "nodaro-prism": ["720p"], "nodaro-pulse": ["1080p"], "nodaro-prism-flash": ["720p"] })
    expect(qualityOffered(CS, { ...ROWS_ON, flash: { "480p": "off", "720p": "1080p" } })).toEqual({ "nodaro-prism": ["720p", "1080p"], "nodaro-pulse": ["1080p"] })
    expect(qualityOffered(CS, null)).toEqual({ "nodaro-pulse": ["1080p"] })
  })

  it("is {} while this deployment withholds the step", () => {
    h.topazDisabled = true
    expect(qualityOffered(CS, ROWS_ON)).toEqual({})
  })

  it("is {} for an engine without the choice, or one that does not deliver resolutions", () => {
    expect(qualityOffered(undefined, ROWS_ON)).toEqual({})
    expect(qualityOffered({ deliveredResolution: true, deliveredResolutions: DELIVERED, qualityFull: FULL } as never, ROWS_ON)).toEqual({})
    expect(qualityOffered({ deliveredResolutions: DELIVERED, quality: true, qualityFull: FULL } as never, ROWS_ON)).toEqual({})
    expect(qualityOffered({ deliveredResolution: true, deliveredResolutions: DELIVERED, quality: true } as never, ROWS_ON)).toEqual({})
  })
})

describe("qualityQuoteOf", () => {
  it("keeps each field only when it is a value of the contract", () => {
    expect(qualityQuoteOf({ quality: "economy", qualityOffered: true, engineResolution: "480p", totalCredits: 9 })).toEqual({ quality: "economy", qualityOffered: true, engineResolution: "480p" })
    expect(qualityQuoteOf({ quality: "full", qualityOffered: false })).toEqual({ quality: "full", qualityOffered: false })
    expect(qualityQuoteOf({ quality: "draft", qualityOffered: "yes", engineResolution: "4k" })).toEqual({})
    for (const quote of [undefined, null, [], "x", {}]) expect(qualityQuoteOf(quote)).toEqual({})
  })
})

describe("withQualityTheEngineTakes", () => {
  const RUN = { videoUrl: "v", roles: [], resolution: "1080p" }

  it("takes full and economy out for an engine without the choice, keeping every other key in order, never mutating", () => {
    for (const quality of ["full", "economy"]) {
      const body = { videoUrl: "v", quality, roles: [], resolution: "1080p" }
      const sent = withQualityTheEngineTakes(body, false)
      expect(JSON.stringify(sent)).toBe(JSON.stringify(RUN))
      expect(body.quality).toBe(quality)
    }
  })

  it('returns the very object for "draft", any other value, no quality, and a body that is not an object', () => {
    for (const body of [{ ...RUN, quality: "draft" }, { ...RUN, quality: "best" }, { ...RUN, quality: undefined }, RUN, null, undefined, "full", ["full"], 3]) {
      expect(withQualityTheEngineTakes(body, false)).toBe(body)
    }
  })

  it("returns the very object for an engine that takes the choice", () => {
    for (const body of [{ ...RUN, quality: "full" }, { ...RUN, quality: "economy" }, { ...RUN, quality: "draft" }, RUN]) {
      expect(withQualityTheEngineTakes(body, true)).toBe(body)
    }
  })

  it("never reads an inherited quality", () => {
    const body = Object.create({ quality: "full" }) as Record<string, unknown>
    body.videoUrl = "v"
    expect(withQualityTheEngineTakes(body, false)).toBe(body)
  })
})
