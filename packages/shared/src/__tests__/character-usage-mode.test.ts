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
  it("contains the 6 expected mode keys in canonical order", () => {
    expect(USAGE_MODES).toEqual([
      "identical",
      "face",
      "face-pose",
      "pose",
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
    expect(isUsageMode("body")).toBe(false) // pose is "pose", not "body"
    expect(isUsageMode("FACE")).toBe(false) // case-sensitive
    expect(isUsageMode("")).toBe(false)
    expect(isUsageMode("Face-Pose")).toBe(false)
  })
  it("returns true for the new 'pose' mode", () => {
    expect(isUsageMode("pose")).toBe(true)
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
    // Strengthened directive — the bullet "- … description. The subject must
    // remain exactly the same person …" reads naturally.
    expect(d).toMatch(/^The subject must remain exactly the same person/)
    expect(d).toMatch(/preserve 100% facial identity/i)
    expect(d).toMatch(/bone structure, skin tone/i)
  })
  it("emits face-only language for 'face'", () => {
    const d = usageModeDirective("face")
    expect(d).toMatch(/facial features/i)
    expect(d).toMatch(/expression/i)
    // Explicitly mentions adopting clothing/hair/posture from the rest of the prompt.
    expect(d).toMatch(/clothing/i)
    expect(d).toMatch(/posture/i)
    expect(d).toMatch(/preserve 100% facial identity/i)
  })
  it("emits face + pose language for 'face-pose'", () => {
    const d = usageModeDirective("face-pose")
    expect(d).toMatch(/facial features/i)
    expect(d).toMatch(/body pose/i)
    expect(d).toMatch(/clothing/i)
    expect(d).toMatch(/preserve 100% facial identity/i)
  })
  it("emits pose-only language for 'pose'", () => {
    const d = usageModeDirective("pose")
    expect(d).toMatch(/^Take only the body pose/)
    // Pose mode must explicitly NOT copy facial identity — the whole point is
    // borrowing the posture while keeping the rest of the prompt's face/hair.
    expect(d).toMatch(/do not copy facial identity/i)
    expect(d).toMatch(/adopt face, clothing, hair/i)
  })
  it("emits emotion-only language for 'emotion'", () => {
    const d = usageModeDirective("emotion")
    expect(d).toMatch(/emotional expression/i)
    expect(d).toMatch(/transfer only the emotional cue/i)
  })
  it("emits style-only language for 'style'", () => {
    const d = usageModeDirective("style")
    expect(d).toMatch(/visual style/i)
    expect(d).toMatch(/tone/i)
    expect(d).toMatch(/do not copy the subject's identity/i)
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
    expect(usageModeLabel("pose")).toBe("Pose only")
    expect(usageModeLabel("emotion")).toBe("Emotion only")
    expect(usageModeLabel("style")).toBe("Style only")
  })
  it("returns a distinct label per mode", () => {
    const labels = USAGE_MODES.map(usageModeLabel)
    const unique = new Set(labels)
    expect(unique.size).toBe(USAGE_MODES.length)
  })
})
