import { describe, expect, it } from "vitest"
import {
  EXTEND_VIDEO_PROVIDERS,
  extendHasSoundSwitch,
  getMaxVideoPromptChars,
  isCatalogExtendProvider,
  isSeedanceExtendProvider,
  isTailExtendProvider,
  refVideoAspectProblem,
} from "../model-constants.js"
import { MODEL_CATALOG } from "../model-catalog.js"
import { buildVideoCreditModelIdentifier, tailExtendCreditId, tailExtendResolution } from "../credit-identifiers.js"
import { geminiOmniExtendQuoteCreditId, parseGeminiOmniExtendQuoteCreditId } from "../gemini-omni-extend-quote.js"
import { isSeedanceExtendPricedBySecondsSent } from "../seedance-extend-rate.js"
import * as credits from "../entries/credits.js"

const P = "gemini-omni-flash-1-2-extend"

describe("Gemini Omni Flash 1.2 Extend: the provider", () => {
  it("is a tail-recipe, catalog extend provider, listed after Kling 4, with no Seedance levers", () => {
    const at = EXTEND_VIDEO_PROVIDERS.indexOf(P)
    expect(EXTEND_VIDEO_PROVIDERS[at - 1]).toBe("kling-4-extend")
    expect(isTailExtendProvider(P)).toBe(true)
    expect(isCatalogExtendProvider(P)).toBe(true)
    expect(isSeedanceExtendProvider(P)).toBe(false)
    expect(extendHasSoundSwitch(P)).toBe(false)
    expect(isSeedanceExtendPricedBySecondsSent(P)).toBe(false)
  })

  it("offers 3–10 s added at 360p / 720p / 1080p / 4K (default 8 s), made by Google, its default run first", () => {
    const entry = MODEL_CATALOG[P]!
    expect(entry.modes).toEqual(["extend"])
    expect(entry.maker).toBe("google")
    expect(entry.durations).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    expect(entry.defaultDuration).toBe(8)
    expect(entry.resolutions).toEqual(["360p", "720p", "1080p", "4k"])
    expect(entry.pricing[0]!.identifier).toBe(tailExtendCreditId(P))
    expect(entry.pricing[0]!.identifier).toBe("gemini-omni-flash-1-2-extend:720p:sent-10s:added-8s")
    for (const row of entry.pricing) expect(parseGeminiOmniExtendQuoteCreditId(row.identifier), row.identifier).toBeDefined()
  })

  it("takes fal's 20000-character prompt; the plain Gemini Omni Flash 1.2 model's reference videos are untouched", () => {
    expect(getMaxVideoPromptChars(P)).toBe(20000)
    expect(refVideoAspectProblem("gemini-omni-flash-1-2", 640, 640)).toBeUndefined()
  })

  it("prices a resolution it renders as asked, any other at 720p", () => {
    for (const res of ["360p", "720p", "1080p", "4k"]) expect(tailExtendResolution(P, res)).toBe(res)
    for (const other of [undefined, "480p", "540p", "4K", "2160p"]) expect(tailExtendResolution(P, other)).toBe("720p")
  })
})

// The one id of a whole run (decided 2026-11-17): both lengths and the resolution.
describe("geminiOmniExtendQuoteCreditId", () => {
  it("names the resolution, the seconds sent (the overhang rule, at most 10) and the seconds added", () => {
    expect(geminiOmniExtendQuoteCreditId({ sourcePictureSec: 4.37, duration: 3, resolution: "720p" })).toBe("gemini-omni-flash-1-2-extend:720p:sent-4.37s:added-3s")
    expect(geminiOmniExtendQuoteCreditId({ sourcePictureSec: 4.06, duration: 3, resolution: "720p" })).toBe("gemini-omni-flash-1-2-extend:720p:sent-4s:added-3s")
    expect(geminiOmniExtendQuoteCreditId({ sourcePictureSec: 42, duration: 5, resolution: "4k" })).toBe("gemini-omni-flash-1-2-extend:4k:sent-10s:added-5s")
  })

  it("an unknown source is the whole 10 s window; no length is 8 s; another resolution is 720p; a length outside 3–10 is held in it", () => {
    expect(geminiOmniExtendQuoteCreditId({})).toBe("gemini-omni-flash-1-2-extend:720p:sent-10s:added-8s")
    expect(geminiOmniExtendQuoteCreditId({ sourcePictureSec: null, duration: "12", resolution: "480p" })).toBe("gemini-omni-flash-1-2-extend:720p:sent-10s:added-10s")
    expect(geminiOmniExtendQuoteCreditId({ sourcePictureSec: -1, duration: 2, resolution: "360p" })).toBe("gemini-omni-flash-1-2-extend:360p:sent-10s:added-3s")
  })

  it("is what tailExtendCreditId and buildVideoCreditModelIdentifier name for a run on an unknown source", () => {
    expect(tailExtendCreditId(P, 5, "4k")).toBe(geminiOmniExtendQuoteCreditId({ duration: 5, resolution: "4k" }))
    expect(buildVideoCreditModelIdentifier(P, 8, undefined, undefined, undefined, "1080p")).toBe("gemini-omni-flash-1-2-extend:1080p:sent-10s:added-8s")
  })

  it("uses no character a URL query or an id splitter reads specially", () => {
    const id = geminiOmniExtendQuoteCreditId({ sourcePictureSec: 4.37, duration: 3, resolution: "4k" })
    expect(id).toMatch(/^[a-z0-9.:-]+$/)
    expect(encodeURIComponent(id)).toBe(id.replace(/:/g, "%3A"))
    // Not a `<rate>:<N>u` quote id.
    expect(id.endsWith("u")).toBe(false)
  })
})

describe("parseGeminiOmniExtendQuoteCreditId", () => {
  it("reads back what the builder wrote", () => {
    for (const [src, dur, res] of [[4.37, 3, "720p"], [undefined, 8, "4k"], [6, 10, "360p"]] as const) {
      const id = geminiOmniExtendQuoteCreditId({ sourcePictureSec: src, duration: dur, resolution: res })
      expect(parseGeminiOmniExtendQuoteCreditId(id)).toEqual({ resolution: res, sentSec: src ?? 10, addedSec: dur })
    }
  })

  it("answers nothing for any other shape", () => {
    for (const id of [
      "gemini-omni-flash-1-2-extend:720p:per-second",
      "gemini-omni-flash-1-2-extend:8s:720p",
      "gemini-omni-flash-1-2-extend:720p:sent-10s:added-8.5s",
      "gemini-omni-flash-1-2-extend:720p:sent-0s:added-8s",
      "gemini-omni-flash-1-2-extend:720p:sent-10s+added-8s",
      "seedance-2-5-extend:720p:per-2s:9u",
      "",
    ]) expect(parseGeminiOmniExtendQuoteCreditId(id), id).toBeUndefined()
  })
})

// The irrevocable grant is kept minimal (decided 2026-11-17): the id builder,
// its reader and its parts' type; the rule, the rows and the shape check are
// the server's and the editor's (@nodaro/render-rules, backend).
describe("what @nodaro/shared exports for it", () => {
  it("is the builder and the reader, nothing else of the engine", () => {
    const names = Object.keys(credits).filter((k) => /gemini/i.test(k))
    expect(names.sort()).toEqual(["geminiOmniExtendQuoteCreditId", "parseGeminiOmniExtendQuoteCreditId"])
  })
})
