import { describe, it, expect } from "vitest"
import { composeCameraMotionHintFromConnections } from "../camera-motions.js"

describe("composeCameraMotionHintFromConnections", () => {
  it("returns empty string for unknown motion", () => {
    expect(composeCameraMotionHintFromConnections("nonexistent", [], [])).toBe("")
  })

  it("returns empty string when motion id is undefined", () => {
    expect(composeCameraMotionHintFromConnections(undefined, [], [])).toBe("")
  })

  it("returns empty string when motion id resolves to empty hint (e.g. auto)", () => {
    expect(composeCameraMotionHintFromConnections("auto", [], [])).toBe("")
  })

  it("returns bare motion hint when no connections", () => {
    const out = composeCameraMotionHintFromConnections("orbit-right", [], [])
    expect(out).toContain("orbit")
    expect(out).not.toContain("beginning")
    expect(out).not.toContain("ending")
  })

  it("appends 'beginning with' clause when only start nodes connected", () => {
    const out = composeCameraMotionHintFromConnections(
      "orbit-right",
      ["wide shot of subject", "soft daylight"],
      [],
    )
    expect(out).toContain("beginning with wide shot of subject and soft daylight")
    expect(out).not.toContain("ending")
  })

  it("appends 'ending with' clause when only end nodes connected", () => {
    const out = composeCameraMotionHintFromConnections("orbit-right", [], ["close-up on face"])
    expect(out).toContain("ending with close-up on face")
    expect(out).not.toContain("beginning")
  })

  it("emits both clauses when both ends connected", () => {
    const out = composeCameraMotionHintFromConnections(
      "orbit-right",
      ["wide shot"],
      ["close-up"],
    )
    expect(out).toContain("beginning with wide shot")
    expect(out).toContain("ending with close-up")
  })

  it("ignores empty hints", () => {
    const out = composeCameraMotionHintFromConnections(
      "orbit-right",
      ["", "wide shot", ""],
      [],
    )
    expect(out).toContain("beginning with wide shot")
    // No double separators left from filtered-out empty entries.
    expect(out).not.toContain(" and ,")
  })

  it("works with static motion (no per-motion gating)", () => {
    const out = composeCameraMotionHintFromConnections(
      "static",
      ["wide shot"],
      ["close-up"],
    )
    expect(out).toContain("static")
    expect(out).toContain("beginning with wide shot")
    expect(out).toContain("ending with close-up")
  })
})
