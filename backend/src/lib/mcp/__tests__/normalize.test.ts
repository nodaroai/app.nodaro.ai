import { describe, it, expect } from "vitest"
import {
  normalizeAspectRatio,
  normalizeResolution,
  normalizeQuality,
  normalizeDuration,
  normalizeImageInput,
  normalizeVideoInput,
  requestedAspectRatio,
  savedEditModel,
  imageToImageLevers,
} from "../normalize.js"
import { fanOutLevers } from "../tools/_image-batch.js"

describe("normalizeAspectRatio", () => {
  const supported = ["1:1", "16:9", "9:16", "4:3", "3:4"] as const

  it("passes through valid values", () => {
    expect(normalizeAspectRatio("16:9", supported)).toBe("16:9")
    expect(normalizeAspectRatio("1:1", supported)).toBe("1:1")
  })

  it("normalizes separator typos", () => {
    expect(normalizeAspectRatio("16x9", supported)).toBe("16:9")
    expect(normalizeAspectRatio("16-9", supported)).toBe("16:9")
    expect(normalizeAspectRatio("16/9", supported)).toBe("16:9")
  })

  it("snaps unsupported numeric ratios to the nearest supported", () => {
    // 21:9 = 2.33 → nearest in [1.78, 0.56, 1.0, 1.33, 0.75] is 1.78 (16:9).
    expect(normalizeAspectRatio("21:9", supported)).toBe("16:9")
    // 9:21 = 0.43 → nearest is 0.56 (9:16).
    expect(normalizeAspectRatio("9:21", supported)).toBe("9:16")
    // 1.78:1 (cinematic) → 16:9.
    expect(normalizeAspectRatio("1.78:1", supported)).toBe("16:9")
    // Bare decimal — same logic.
    expect(normalizeAspectRatio("1.78", supported)).toBe("16:9")
    // "1x9" typo is parseable as 1/9 ≈ 0.111 → nearest is 0.56 (9:16).
    expect(normalizeAspectRatio("1x9", supported)).toBe("9:16")
  })

  it("falls back to 16:9 for unparseable / empty input", () => {
    expect(normalizeAspectRatio("nonsense", supported)).toBe("16:9")
    expect(normalizeAspectRatio("", supported)).toBe("16:9")
    expect(normalizeAspectRatio(undefined, supported)).toBe("16:9")
  })

  it("returns first supported when 16:9 isn't in the set and input is unparseable", () => {
    const narrow = ["1:1", "4:3"] as const
    expect(normalizeAspectRatio("nonsense", narrow)).toBe("1:1")
  })

  it("skips non-numeric supported values during nearest-match", () => {
    // 'auto' has no numeric representation — it should be passed through
    // as exact-match but not used as a candidate for numeric snapping.
    const withAuto = ["auto", "1:1", "16:9", "9:16"] as const
    expect(normalizeAspectRatio("auto", withAuto)).toBe("auto")
    // 21:9 still snaps to 16:9, doesn't pick "auto".
    expect(normalizeAspectRatio("21:9", withAuto)).toBe("16:9")
  })

  it("returns undefined when the model has no aspect-ratio lever", () => {
    expect(normalizeAspectRatio("16:9", undefined)).toBeUndefined()
    expect(normalizeAspectRatio("16:9", [])).toBeUndefined()
  })
})

describe("normalizeResolution", () => {
  const supported = ["1K", "2K", "4K"] as const

  it("passes through valid values", () => {
    expect(normalizeResolution("2K", supported)).toBe("2K")
    expect(normalizeResolution("4K", supported)).toBe("4K")
  })

  it("uppercases lowercase k", () => {
    expect(normalizeResolution("2k", supported)).toBe("2K")
    expect(normalizeResolution("4k", supported)).toBe("4K")
  })

  it("snaps oversized requests to the largest supported", () => {
    expect(normalizeResolution("8K", supported)).toBe("4K")
    expect(normalizeResolution("16K", supported)).toBe("4K")
  })

  it("returns undefined when the model has no resolution lever", () => {
    expect(normalizeResolution("4K", undefined)).toBeUndefined()
    expect(normalizeResolution("4K", [])).toBeUndefined()
  })

  it("returns undefined for nonsense (caller falls back to model default)", () => {
    expect(normalizeResolution("foobar", supported)).toBeUndefined()
    expect(normalizeResolution(undefined, supported)).toBeUndefined()
  })
})

describe("normalizeQuality", () => {
  const supportedMedHigh = ["medium", "high"] as const
  const supportedTurbo = ["TURBO", "BALANCED", "QUALITY"] as const

  it("passes through valid values", () => {
    expect(normalizeQuality("high", supportedMedHigh)).toBe("high")
    expect(normalizeQuality("BALANCED", supportedTurbo)).toBe("BALANCED")
  })

  it("case-insensitive match", () => {
    expect(normalizeQuality("HIGH", supportedMedHigh)).toBe("high")
    expect(normalizeQuality("turbo", supportedTurbo)).toBe("TURBO")
  })

  it("synonym buckets", () => {
    expect(normalizeQuality("ultra", supportedMedHigh)).toBe("high")
    expect(normalizeQuality("best", supportedMedHigh)).toBe("high")
    expect(normalizeQuality("auto", supportedTurbo)).toBe("BALANCED")
    expect(normalizeQuality("balanced", supportedTurbo)).toBe("BALANCED")
  })

  it("a model listing Auto first: a word for fast takes the cheap level, never Auto", () => {
    const listed = ["auto", "low", "medium", "high", "xhigh", "max"] as const
    for (const word of ["fast", "quick", "speed", "turbo"]) expect(normalizeQuality(word, listed)).toBe("low")
    expect(normalizeQuality("balanced", listed)).toBe("medium")
    expect(normalizeQuality("default", listed)).toBe("medium")
    expect(normalizeQuality("best", listed)).toBe("max")
  })

  it("Auto is only reached by naming it", () => {
    expect(normalizeQuality("auto", ["auto", "low", "medium"])).toBe("auto")
    expect(normalizeQuality("fast", ["auto", "medium", "high"])).toBe("medium")
    expect(normalizeQuality("normal", ["auto", "standard"])).toBe("standard")
  })

  it("returns undefined for unknown when no synonym matches", () => {
    expect(normalizeQuality("weird-quality", supportedMedHigh)).toBeUndefined()
  })

  it("returns undefined when the model has no quality lever", () => {
    expect(normalizeQuality("high", undefined)).toBeUndefined()
  })
})

describe("normalizeDuration", () => {
  const supported = [5, 10, 15] as const

  it("passes through exact matches", () => {
    expect(normalizeDuration(5, supported)).toBe(5)
    expect(normalizeDuration(10, supported)).toBe(10)
  })

  it("snaps to nearest supported", () => {
    expect(normalizeDuration(7, supported)).toBe(5)
    expect(normalizeDuration(8, supported)).toBe(10)
    expect(normalizeDuration(20, supported)).toBe(15)
  })

  it("parses string inputs", () => {
    expect(normalizeDuration("10s", supported)).toBe(10)
    expect(normalizeDuration("12 seconds", supported)).toBe(10)
  })

  it("returns undefined for unparseable / no lever", () => {
    expect(normalizeDuration("abc", supported)).toBeUndefined()
    expect(normalizeDuration(5, undefined)).toBeUndefined()
  })
})

describe("normalizeImageInput", () => {
  it("explicit args win over saved prefs and catalog default", () => {
    const out = normalizeImageInput(
      { model: "z-image", aspect_ratio: "9:16" },
      { model: "nano-banana-pro", aspectRatio: "16:9" },
      "nano-banana-2",
    )
    expect(out.model).toBe("z-image")
    expect(out.aspectRatio).toBe("9:16")
  })

  it("saved prefs win when explicit is missing AND saved is compatible", () => {
    const out = normalizeImageInput({}, { model: "nano-banana-pro" }, "nano-banana-2")
    expect(out.model).toBe("nano-banana-pro")
  })

  // The ratio helper fills an unset value with its fallback, so the saved ratio
  // must be chosen before it — it was once a `??` alternative never reached.
  it("uses the saved ratio when the call names none, and the named one over it", () => {
    expect(normalizeImageInput({}, { aspectRatio: "9:16" }, "nano-banana-2").aspectRatio).toBe("9:16")
    expect(normalizeImageInput({ aspect_ratio: "" }, { aspectRatio: "9:16" }, "nano-banana-2").aspectRatio).toBe("9:16")
    expect(normalizeImageInput({ aspect_ratio: "1:1" }, { aspectRatio: "9:16" }, "nano-banana-2").aspectRatio).toBe("1:1")
  })

  it("fits a saved ratio to the model, and falls back to 16:9 with neither", () => {
    // 21:9 on a model without it → its nearest listed ratio.
    expect(normalizeImageInput({ model: "z-image" }, { aspectRatio: "21:9" }, "nano-banana-2").aspectRatio).toBe("16:9")
    expect(normalizeImageInput({ model: "z-image" }, {}, "nano-banana-2").aspectRatio).toBe("16:9")
  })

  it("uses the saved size and quality the same way", () => {
    const saved = normalizeImageInput({ model: "gpt-image-2-6-flare" }, { resolution: "2K", quality: "high" }, "nano-banana-2")
    expect([saved.resolution, saved.quality]).toEqual(["2K", "high"])
    const named = normalizeImageInput({ model: "gpt-image-2-6-flare", resolution: "4K", quality: "low" }, { resolution: "2K", quality: "high" }, "nano-banana-2")
    expect([named.resolution, named.quality]).toEqual(["4K", "low"])
  })

  it("falls back to catalog default when both explicit and saved are bad", () => {
    const out = normalizeImageInput(
      { model: "made-up-model" },
      { model: "another-fake-id" },
      "nano-banana-2",
    )
    expect(out.model).toBe("nano-banana-2")
  })

  it("normalizes 8K to 4K when model only supports up to 4K", () => {
    const out = normalizeImageInput(
      { model: "nano-banana-pro", resolution: "8K" },
      {},
      "nano-banana-2",
    )
    expect(out.model).toBe("nano-banana-pro")
    expect(out.resolution).toBe("4K")
  })

  it("normalizes 'ultra' quality to model's highest", () => {
    const out = normalizeImageInput(
      { model: "gpt-image", quality: "ultra" },
      {},
      "nano-banana-2",
    )
    expect(out.quality).toBe("high")
  })

  it("normalizes 16x9 to 16:9", () => {
    const out = normalizeImageInput(
      { model: "nano-banana-2", aspect_ratio: "16x9" },
      {},
      "nano-banana-2",
    )
    expect(out.aspectRatio).toBe("16:9")
  })

  it("drops saved quality when resolved model has no quality lever", () => {
    const out = normalizeImageInput(
      { model: "nano-banana-2" },
      { quality: "high" },
      "nano-banana-2",
    )
    // nano-banana-2 has no `qualities` set → undefined.
    expect(out.quality).toBeUndefined()
  })

  it("never throws on garbage input", () => {
    expect(() =>
      normalizeImageInput(
        {
          model: "💀💀💀",
          aspect_ratio: "wat",
          resolution: "🌈",
          quality: "🚀",
        },
        { model: "" },
        "nano-banana-2",
      ),
    ).not.toThrow()
  })
})

describe("requestedAspectRatio", () => {
  it("is the named ratio, else the saved one, else undefined; a blank names nothing", () => {
    expect(requestedAspectRatio("1:1", "9:16")).toBe("1:1")
    expect(requestedAspectRatio(undefined, "9:16")).toBe("9:16")
    expect(requestedAspectRatio("", "9:16")).toBe("9:16")
    expect(requestedAspectRatio("  ", null)).toBeUndefined()
    expect(requestedAspectRatio(null, undefined)).toBeUndefined()
  })
})

describe("fanOutLevers", () => {
  it("uses the saved ratio when the call names none, and the named one over it", () => {
    const models = ["gpt-image-2", "nano-banana-pro"]
    expect(fanOutLevers(models, {}, { aspectRatio: "9:16" }).aspectRatio).toBe("9:16")
    expect(fanOutLevers(models, { aspect_ratio: "1:1" }, { aspectRatio: "9:16" }).aspectRatio).toBe("1:1")
    expect(fanOutLevers(models, {}, {}).aspectRatio).toBe("16:9")
  })
})

describe("normalizeVideoInput", () => {
  // The same trap as the image ratio: the helper fills an unset value with its
  // fallback, so the saved ratio is chosen before it, never as a `??` after it.
  it("uses the saved ratio when the call names none, and the named one over it", () => {
    expect(normalizeVideoInput({}, { aspectRatio: "9:16" }, "seedance-2-fast").aspectRatio).toBe("9:16")
    expect(normalizeVideoInput({ aspect_ratio: "" }, { aspectRatio: "9:16" }, "seedance-2-fast").aspectRatio).toBe("9:16")
    expect(normalizeVideoInput({ aspect_ratio: "1:1" }, { aspectRatio: "9:16" }, "seedance-2-fast").aspectRatio).toBe("1:1")
  })

  it("fits a saved ratio to the model, and falls back to 16:9 with neither", () => {
    expect(normalizeVideoInput({ model: "veo3.1" }, { aspectRatio: "3:4" }, "seedance-2-fast").aspectRatio).toBe("9:16")
    expect(normalizeVideoInput({}, {}, "seedance-2-fast").aspectRatio).toBe("16:9")
  })

  it("uses the saved model, size and duration the same way", () => {
    const saved = normalizeVideoInput({}, { model: "veo3.1", resolution: "1080p", duration: 6 }, "seedance-2-fast")
    expect([saved.model, saved.resolution, saved.duration]).toEqual(["veo3.1", "1080p", 6])
    const named = normalizeVideoInput({ resolution: "4k", duration: 8 }, { model: "veo3.1", resolution: "1080p", duration: 6 }, "seedance-2-fast")
    expect([named.resolution, named.duration]).toEqual(["4k", 8])
  })
})

describe("savedEditModel", () => {
  it("is the saved model only when an image-to-image request runs it", () => {
    expect(savedEditModel("gpt-image-2-6-flare-i2i")).toBe("gpt-image-2-6-flare-i2i")
    expect(savedEditModel("nano-banana-pro")).toBe("nano-banana-pro")
    expect(savedEditModel("gpt-image-2")).toBeUndefined()
    expect(savedEditModel("made-up-model")).toBeUndefined()
    expect(savedEditModel(undefined)).toBeUndefined()
  })
})

describe("imageToImageLevers", () => {
  it("sends a named value as it is, and fits a saved one to the model", () => {
    expect(imageToImageLevers({ model: "flux-kontext", aspect_ratio: "27:16" }, { aspectRatio: "1:1" }).aspectRatio).toBe("27:16")
    expect(imageToImageLevers({ model: "flux-kontext" }, { aspectRatio: "27:16" }).aspectRatio).toBe("16:9")
  })

  it("with neither ratio: 'auto' on the GPT Image 2.5 / 2.6 edit models, none on the others", () => {
    expect(imageToImageLevers({ model: "gpt-image-2-5-flare-i2i" }, {})).toEqual({ provider: "gpt-image-2-5-flare-i2i", aspectRatio: "auto" })
    expect(imageToImageLevers({ model: "flux-kontext" }, {})).toEqual({ provider: "flux-kontext" })
  })
})
