import { describe, it, expect } from "vitest"
import {
  normalizeAspectRatio,
  normalizeResolution,
  normalizeQuality,
  normalizeDuration,
  normalizeImageInput,
} from "../normalize.js"

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
