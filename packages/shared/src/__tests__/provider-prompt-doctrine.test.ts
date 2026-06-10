import { describe, it, expect } from "vitest"
import {
  PROVIDER_PROMPT_DOCTRINES,
  getPromptDoctrine,
  getPromptTips,
} from "../provider-prompt-doctrine.js"
import { MODEL_CATALOG } from "../index.js"

describe("PROVIDER_PROMPT_DOCTRINES", () => {
  it("every doctrine maps to real catalog providers and has tips + body", () => {
    expect(PROVIDER_PROMPT_DOCTRINES.length).toBeGreaterThan(0)
    for (const d of PROVIDER_PROMPT_DOCTRINES) {
      expect(d.providers.length).toBeGreaterThan(0)
      for (const p of d.providers) expect(MODEL_CATALOG[p]).toBeDefined()
      expect(d.tips.length).toBeGreaterThanOrEqual(3)
      expect(d.tips.length).toBeLessThanOrEqual(6)
      for (const t of d.tips) expect(t.length).toBeLessThanOrEqual(220)
      expect(d.doctrine.length).toBeGreaterThan(500)
      expect(d.heading.length).toBeGreaterThan(0)
    }
  })

  it("resolves by provider id, returns undefined/[] for providers without doctrine", () => {
    expect(getPromptDoctrine("seedance-2")).toBeDefined()
    expect(getPromptDoctrine("seedance-2-fast")).toBeDefined()
    expect(getPromptDoctrine("veo3.1")).toBeUndefined()
    expect(getPromptTips("seedance-2").length).toBeGreaterThan(0)
    expect(getPromptTips("veo3.1")).toEqual([])
  })

  it("seedance doctrine encodes the official rules and bans the unstable patterns", () => {
    const d = getPromptDoctrine("seedance-2")!
    // untimed Shot N storyboards, never "(0-3s)" timestamps
    expect(d.doctrine).toContain("Shot 1")
    expect(d.doctrine).toMatch(/timestamp/i)
    expect(d.doctrine).not.toMatch(/Shot \d+\s*\(\d+\s*[-–]\s*\d+s\)/)
    // headshot + full-body identity rule (NOT multi-view)
    expect(d.doctrine).toMatch(/headshot/i)
    expect(d.doctrine).toMatch(/multi-view|three-view/i)
    // audio symbol semantics + Nodaro brace caveat
    expect(d.doctrine).toContain("（")
    expect(d.doctrine).toContain("<")
    expect(d.doctrine).toMatch(/quoted|quotes/i)
    // edit/extend "reference" keyword trap
    expect(d.doctrine).toMatch(/reference Video/i)
    // no native negative-prompt param
    expect(d.doctrine).toMatch(/negative/i)
  })
})
