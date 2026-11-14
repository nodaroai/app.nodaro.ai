import { describe, expect, it } from "vitest"
import { addLanguageTerms, dubBillableSeconds } from "../dubbing-add-terms.js"
import { parseRateQuoteCreditId } from "../unit-quote-rates.js"

const upload = { videoUrl: "https://cdn.example/source.mp4" }

describe("dubBillableSeconds", () => {
  it("is the span the dub itself was charged for when the service holds no more", () => {
    expect(dubBillableSeconds({ probedDurationSec: 95 }, 94.2)).toBe(95)
    expect(dubBillableSeconds({ probedDurationSec: 95 }, null)).toBe(95)
  })

  it("is the length the service holds when it holds more than the dub was charged for", () => {
    expect(dubBillableSeconds({ probedDurationSec: 60 }, 1800)).toBe(1800)
  })

  it("cuts what the service holds to the window before comparing", () => {
    expect(dubBillableSeconds({ probedDurationSec: 30, startTime: 10, endTime: 40 }, 600)).toBe(30)
  })

  it("falls back to the length the service tells", () => {
    expect(dubBillableSeconds({}, 130.5)).toBe(130.5)
  })

  it("cuts that length to the dub's start/end window", () => {
    expect(dubBillableSeconds({ startTime: 10, endTime: 40 }, 600)).toBe(30)
    expect(dubBillableSeconds({ startTime: 10, endTime: 4000 }, 600)).toBe(600)
  })

  it("reads the window alone when no length is known", () => {
    expect(dubBillableSeconds({ startTime: 0, endTime: 45 }, null)).toBe(45)
  })

  it("is unknown when nothing tells the length", () => {
    expect(dubBillableSeconds({}, null)).toBeUndefined()
    expect(dubBillableSeconds({ reservedCeiling: true }, 0)).toBeUndefined()
  })

  it("ignores stored values that are not a length", () => {
    expect(dubBillableSeconds({ probedDurationSec: "95" }, 60)).toBe(60)
    expect(dubBillableSeconds({ probedDurationSec: -5 }, 60)).toBe(60)
    expect(dubBillableSeconds({ probedDurationSec: Number.NaN, startTime: "1", endTime: "9" }, 60)).toBe(60)
    expect(dubBillableSeconds({}, Number.POSITIVE_INFINITY)).toBeUndefined()
  })
})

describe("addLanguageTerms: the price", () => {
  it("charges a regular dub by the started minute, and Hebrew on the project row", () => {
    const { price } = addLanguageTerms({ ...upload, probedDurationSec: 61 }, "regular", null)

    expect(price).toEqual({
      billableMinutes: 2,
      creditId: "elevenlabs-dubbing:2u",
      creditIdByLanguage: { he: "elevenlabs-dubbing-v2:2u", heb: "elevenlabs-dubbing-v2:2u" },
    })
  })

  it("charges a project dub on the project row, whatever the language", () => {
    const { price } = addLanguageTerms({ ...upload, probedDurationSec: 61 }, "project", null)

    expect(price).toEqual({ billableMinutes: 2, creditId: "elevenlabs-dubbing-v2:2u", creditIdByLanguage: {} })
  })

  it("charges at least one minute", () => {
    expect(addLanguageTerms({ ...upload, probedDurationSec: 0.4 }, "regular", null).price.billableMinutes).toBe(1)
  })

  it("tells no price when the length is not known", () => {
    expect(addLanguageTerms(upload, "regular", null).price).toEqual({ billableMinutes: null, creditId: null, creditIdByLanguage: {} })
  })

  it("tells the minutes and no price for a dub past what a dub may cover", () => {
    expect(addLanguageTerms(upload, "regular", 1801).price).toEqual({ billableMinutes: 31, creditId: null, creditIdByLanguage: {} })
    expect(addLanguageTerms(upload, "regular", 1800).price.creditId).toBe("elevenlabs-dubbing:30u")
  })

  it("names only ids the price lookup answers", () => {
    for (const engine of ["regular", "project"] as const) {
      for (const seconds of [1, 59, 60, 61, 1799, 1800]) {
        const { price } = addLanguageTerms({ ...upload, probedDurationSec: seconds }, engine, null)
        const ids = [price.creditId, ...Object.values(price.creditIdByLanguage)]

        expect(ids.length).toBeGreaterThan(0)
        for (const id of ids) {
          expect(id).not.toBeNull()
          expect(parseRateQuoteCreditId(id ?? "")?.units).toBe(price.billableMinutes)
        }
      }
    }
  })
})

describe("addLanguageTerms: whether a language can be added", () => {
  it("can be added to a dub with a source and a length that fits", () => {
    expect(addLanguageTerms({ ...upload, probedDurationSec: 61 }, "regular", null).blocked).toBeNull()
    expect(addLanguageTerms({ audioUrl: "https://cdn.example/a.mp3", probedDurationSec: 61 }, "project", null).blocked).toBeNull()
  })

  it("cannot be added to a dub whose source is no longer on record", () => {
    expect(addLanguageTerms({ probedDurationSec: 61 }, "regular", null).blocked).toBe("no_source")
    expect(addLanguageTerms({ videoUrl: "  ", audioUrl: 7, probedDurationSec: 61 }, "project", null).blocked).toBe("no_source")
  })

  it("takes a link as the source of a regular dub only", () => {
    const link = { sourceUrl: "https://video.example/watch?v=1", probedDurationSec: 61 }

    expect(addLanguageTerms(link, "regular", null).blocked).toBeNull()
    expect(addLanguageTerms(link, "project", null).blocked).toBe("no_source")
  })

  it("needs the length of a project dub, and measures a regular one again", () => {
    expect(addLanguageTerms(upload, "project", null).blocked).toBe("unknown_length")
    expect(addLanguageTerms(upload, "regular", null).blocked).toBeNull()
  })

  it("cannot be added past what a dub may cover", () => {
    expect(addLanguageTerms(upload, "regular", 1801).blocked).toBe("too_long")
    expect(addLanguageTerms(upload, "project", 1801).blocked).toBe("too_long")
    expect(addLanguageTerms(upload, "project", 1800).blocked).toBeNull()
  })

  it("tells the missing source before anything else", () => {
    expect(addLanguageTerms({}, "project", 1801).blocked).toBe("no_source")
  })
})
