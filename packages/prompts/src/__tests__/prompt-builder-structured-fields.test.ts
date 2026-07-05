import { describe, it, expect } from "vitest"
import { renderStructuredFields } from "../prompt-builder-structured-fields.js"

describe("renderStructuredFields", () => {
  it("returns empty string for empty input", () => {
    expect(renderStructuredFields({})).toBe("")
  })

  it("renders a full prompt fragment", () => {
    const out = renderStructuredFields({
      person: { age: 40, gender: "man", profession: "warrior", hair: "black", expression: "intense" },
      styling: { mood: "epic", lighting: "cinematic golden-hour" },
      setting: { era: "medieval", atmosphere: "stormy" },
    })
    expect(out).toContain("Subject:")
    expect(out).toContain("warrior")
    expect(out).toContain("Style:")
    expect(out).toContain("cinematic golden-hour lighting")
    expect(out).toContain("Setting:")
    expect(out).toContain("medieval era")
  })

  it("renders mood shorthand", () => {
    expect(renderStructuredFields({ mood: "tense" })).toBe("Mood: tense.")
  })

  it("skips empty subsections", () => {
    expect(renderStructuredFields({ person: {} })).toBe("")
    expect(renderStructuredFields({ styling: {} })).toBe("")
  })

  it("renders camera + lens", () => {
    const out = renderStructuredFields({
      camera: { framing: "wide", motion: "tracking" },
      lens: { focalLength: "85mm", aperture: "1.8" },
    })
    expect(out).toContain("Camera: wide framing, tracking.")
    expect(out).toContain("Lens: 85mm, f/1.8.")
  })
})
