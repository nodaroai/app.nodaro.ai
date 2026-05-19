import { describe, it, expect } from "vitest"
import {
  locationMentionSlug,
  parseLocationMentionToken,
  findLocationMentionTokens,
  isLocationUsageMode,
  LOCATION_USAGE_MODES,
} from "../location-mention-slug.js"

describe("LOCATION_USAGE_MODES", () => {
  it("has exactly the 4 spec-mandated modes", () => {
    expect(LOCATION_USAGE_MODES).toEqual(["identical", "style", "layout", "none"])
  })

  it("isLocationUsageMode narrows known values", () => {
    expect(isLocationUsageMode("identical")).toBe(true)
    expect(isLocationUsageMode("layout")).toBe(true)
    expect(isLocationUsageMode("face")).toBe(false) // character-only mode
    expect(isLocationUsageMode("bogus")).toBe(false)
  })
})

describe("locationMentionSlug", () => {
  it("lowercases, strips non-alphanumeric, collapses runs", () => {
    expect(locationMentionSlug("Old Library")).toBe("old-library")
    expect(locationMentionSlug("Forest at Night!")).toBe("forest-at-night")
    expect(locationMentionSlug("  Spaceship-3000  ")).toBe("spaceship-3000")
    expect(locationMentionSlug("___foo___")).toBe("foo")
  })

  it("returns empty string for inputs that have no alphanumerics", () => {
    expect(locationMentionSlug("!!!")).toBe("")
    expect(locationMentionSlug("")).toBe("")
  })
})

describe("parseLocationMentionToken", () => {
  describe("rejection cases", () => {
    it("returns null for non-@ tokens", () => {
      expect(parseLocationMentionToken("oldlibrary:1")).toBeNull()
      expect(parseLocationMentionToken("")).toBeNull()
    })

    it("returns null for tokens missing the index segment", () => {
      expect(parseLocationMentionToken("@oldlibrary")).toBeNull()
    })

    it("returns null for tokens with non-numeric index", () => {
      expect(parseLocationMentionToken("@oldlibrary:abc")).toBeNull()
      expect(parseLocationMentionToken("@oldlibrary:0")).toBeNull() // index must be ≥ 1
    })

    it("returns null for tokens with more than 4 segments", () => {
      expect(
        parseLocationMentionToken("@oldlibrary:1:weather/rain:style:extra"),
      ).toBeNull()
    })

    it("returns null for malformed slug (uppercase / leading digit)", () => {
      expect(parseLocationMentionToken("@OldLibrary:1")).toBeNull()
      expect(parseLocationMentionToken("@3000library:1")).toBeNull()
    })

    it("returns null for 4-part with no slash in 3rd segment", () => {
      expect(parseLocationMentionToken("@oldlibrary:1:weather:style")).toBeNull()
    })

    it("returns null for 4-part with unknown 4th-segment mode", () => {
      expect(
        parseLocationMentionToken("@oldlibrary:1:weather/rain:face"),
      ).toBeNull()
    })

    it("returns null for 3-part with unknown plain segment (not bucket/variant, not mode)", () => {
      expect(parseLocationMentionToken("@oldlibrary:1:foobar")).toBeNull()
    })
  })

  describe("accepted shapes", () => {
    it("2-part: canonical, default mode", () => {
      expect(parseLocationMentionToken("@oldlibrary:1")).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: null,
        variant: null,
        usageMode: null,
      })
    })

    it("3-part bucket/variant", () => {
      expect(parseLocationMentionToken("@oldlibrary:1:weather/rain")).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: "weather",
        variant: "rain",
        usageMode: null,
      })
    })

    it("3-part with hyphenated bucket/variant", () => {
      expect(
        parseLocationMentionToken("@oldlibrary:1:time-of-day/golden-hour"),
      ).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: "time-of-day",
        variant: "golden-hour",
        usageMode: null,
      })
    })

    it("3-part canonical + mode keyword", () => {
      expect(parseLocationMentionToken("@oldlibrary:1:layout")).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: null,
        variant: null,
        usageMode: "layout",
      })
    })

    it("4-part bucket/variant + mode override", () => {
      expect(
        parseLocationMentionToken("@oldlibrary:1:weather/rain:style"),
      ).toEqual({
        locationSlug: "oldlibrary",
        imageIndex: 1,
        bucket: "weather",
        variant: "rain",
        usageMode: "style",
      })
    })

    it("hyphenated location slug", () => {
      expect(parseLocationMentionToken("@old-library:2:lighting/neon")).toEqual({
        locationSlug: "old-library",
        imageIndex: 2,
        bucket: "lighting",
        variant: "neon",
        usageMode: null,
      })
    })
  })
})

describe("findLocationMentionTokens", () => {
  it("finds canonical mention against known slug", () => {
    const tokens = findLocationMentionTokens(
      "Hero stands in @oldlibrary:1 reading.",
      ["oldlibrary"],
    )
    expect(tokens).toHaveLength(1)
    expect(tokens[0].token).toBe("@oldlibrary:1")
    expect(tokens[0].bucket).toBeNull()
    expect(tokens[0].variant).toBeNull()
  })

  it("finds bucket/variant mention", () => {
    const tokens = findLocationMentionTokens(
      "Set in @oldlibrary:1:weather/rain.",
      ["oldlibrary"],
    )
    expect(tokens).toHaveLength(1)
    expect(tokens[0].bucket).toBe("weather")
    expect(tokens[0].variant).toBe("rain")
  })

  it("finds multiple mentions in one prompt", () => {
    const tokens = findLocationMentionTokens(
      "@oldlibrary:1 at dawn, then @forest:2:weather/storm later.",
      ["oldlibrary", "forest"],
    )
    expect(tokens).toHaveLength(2)
    expect(tokens[0].locationSlug).toBe("oldlibrary")
    expect(tokens[1].locationSlug).toBe("forest")
    expect(tokens[1].bucket).toBe("weather")
    expect(tokens[1].variant).toBe("storm")
  })

  it("skips tokens whose slug isn't in knownLocationSlugs", () => {
    const tokens = findLocationMentionTokens(
      "@kira:1:smile then @oldlibrary:1:weather/rain.",
      ["oldlibrary"], // kira is a character, not in this set
    )
    expect(tokens).toHaveLength(1)
    expect(tokens[0].locationSlug).toBe("oldlibrary")
  })

  it("reports the correct offset for each token", () => {
    const prompt = "in @oldlibrary:1 at"
    const tokens = findLocationMentionTokens(prompt, ["oldlibrary"])
    expect(tokens[0].offset).toBe(prompt.indexOf("@"))
  })

  it("does not match @ preceded by alphanumeric (email-like)", () => {
    const tokens = findLocationMentionTokens(
      "tal@oldlibrary:1 visited",
      ["oldlibrary"],
    )
    expect(tokens).toHaveLength(0)
  })

  it("matches @ at start of prompt", () => {
    const tokens = findLocationMentionTokens(
      "@oldlibrary:1 stood empty.",
      ["oldlibrary"],
    )
    expect(tokens).toHaveLength(1)
    expect(tokens[0].offset).toBe(0)
  })
})
