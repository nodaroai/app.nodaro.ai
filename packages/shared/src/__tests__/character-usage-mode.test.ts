import { describe, it, expect } from "vitest"
import {
  USAGE_MODES,
  DEFAULT_USAGE_MODE,
  isUsageMode,
  usageModeDirective,
  usageModeLabel,
  type UsageMode,
} from "../character-usage-mode.js"

describe("USAGE_MODES", () => {
  it("contains the 5 expected mode keys in canonical order", () => {
    expect(USAGE_MODES).toEqual([
      "identical",
      "face",
      "face-pose",
      "emotion",
      "style",
    ])
  })
  it("has 'identical' as the default", () => {
    expect(DEFAULT_USAGE_MODE).toBe("identical")
    expect(USAGE_MODES).toContain(DEFAULT_USAGE_MODE)
  })
})

describe("isUsageMode", () => {
  it("returns true for every entry in USAGE_MODES", () => {
    for (const m of USAGE_MODES) {
      expect(isUsageMode(m)).toBe(true)
    }
  })
  it("returns false for unrecognized strings", () => {
    expect(isUsageMode("smile")).toBe(false)
    expect(isUsageMode("walking")).toBe(false)
    expect(isUsageMode("FACE")).toBe(false) // case-sensitive
    expect(isUsageMode("")).toBe(false)
    expect(isUsageMode("Face-Pose")).toBe(false)
  })
  it("narrows a typed-positive string at compile time", () => {
    const s: string = "face"
    if (isUsageMode(s)) {
      // narrowed
      const m: UsageMode = s
      expect(m).toBe("face")
    } else {
      throw new Error("expected face to be a usage mode")
    }
  })
})

describe("usageModeDirective", () => {
  it("emits the identity-lock language for 'identical'", () => {
    const d = usageModeDirective("identical")
    // Sentence-cased start so the bullet "- … description. Match exactly."
    // reads naturally.
    expect(d).toMatch(/^Match exactly/)
    expect(d).toMatch(/perfect likeness/i)
    expect(d).toMatch(/face, body proportions, distinctive features/i)
  })
  it("emits face-only language for 'face'", () => {
    const d = usageModeDirective("face")
    expect(d).toMatch(/facial features/i)
    expect(d).toMatch(/expression/i)
    // Explicitly mentions preserving clothing/hair/posture from the rest of the prompt.
    expect(d).toMatch(/clothing/i)
    expect(d).toMatch(/posture/i)
  })
  it("emits face + pose language for 'face-pose'", () => {
    const d = usageModeDirective("face-pose")
    expect(d).toMatch(/facial features/i)
    expect(d).toMatch(/body pose/i)
    expect(d).toMatch(/clothing/i)
  })
  it("emits emotion-only language for 'emotion'", () => {
    const d = usageModeDirective("emotion")
    expect(d).toMatch(/emotional expression/i)
    expect(d).toMatch(/preserve all other aspects/i)
  })
  it("emits style-only language for 'style'", () => {
    const d = usageModeDirective("style")
    expect(d).toMatch(/visual style/i)
    expect(d).toMatch(/tone/i)
  })
  it("returns a distinct directive for each mode (no accidental aliasing)", () => {
    const directives = USAGE_MODES.map(usageModeDirective)
    const unique = new Set(directives)
    expect(unique.size).toBe(USAGE_MODES.length)
  })
})

describe("usageModeLabel", () => {
  it("returns a human-readable label per mode", () => {
    expect(usageModeLabel("identical")).toBe("Identical")
    expect(usageModeLabel("face")).toBe("Face only")
    expect(usageModeLabel("face-pose")).toBe("Face + Pose")
    expect(usageModeLabel("emotion")).toBe("Emotion only")
    expect(usageModeLabel("style")).toBe("Style only")
  })
  it("returns a distinct label per mode", () => {
    const labels = USAGE_MODES.map(usageModeLabel)
    const unique = new Set(labels)
    expect(unique.size).toBe(USAGE_MODES.length)
  })
})
