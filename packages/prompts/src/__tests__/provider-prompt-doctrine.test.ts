import { describe, it, expect } from "vitest"
import {
  PROVIDER_PROMPT_DOCTRINES,
  getPromptDoctrine,
  getPromptTips,
} from "../provider-prompt-doctrine.js"
import { MODEL_CATALOG } from "@nodaro/shared"

describe("PROVIDER_PROMPT_DOCTRINES", () => {
  it("every doctrine maps to real catalog providers and has tips + body", () => {
    expect(PROVIDER_PROMPT_DOCTRINES.length).toBeGreaterThan(0)
    for (const d of PROVIDER_PROMPT_DOCTRINES) {
      expect(d.providers.length).toBeGreaterThan(0)
      for (const p of d.providers) expect(MODEL_CATALOG[p]).toBeDefined()
      expect(d.tips.length).toBeGreaterThanOrEqual(3)
      expect(d.tips.length).toBeLessThanOrEqual(7)
      for (const t of d.tips) expect(t.length).toBeLessThanOrEqual(220)
      expect(d.doctrine.length).toBeGreaterThan(500)
      expect(d.heading.length).toBeGreaterThan(0)
    }
  })

  it("resolves by provider id, returns undefined/[] for providers without doctrine", () => {
    expect(getPromptDoctrine("seedance-2")).toBeDefined()
    expect(getPromptDoctrine("seedance-2-fast")).toBeDefined()
    // bytedance-lite/pro + hailuo-2.3 are DELIBERATELY uncovered (older engines
    // whose surfaces differ — mapping the family doctrine would overclaim).
    expect(getPromptDoctrine("bytedance-lite")).toBeUndefined()
    expect(getPromptTips("seedance-2").length).toBeGreaterThan(0)
    expect(getPromptTips("bytedance-lite")).toEqual([])
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

  it("splits the timestamp + multi-view rules by version: 2.0 SKUs no, seedance-2-5 yes (official 2.5 guide)", () => {
    // Official "Dreamina Seedance 2.5 prompt guide" → Differences from Seedance 2.0:
    // 2.0 does not respond to timestamps (shot numbers only) and multi-view
    // subject images are not recommended; 2.5 supports integer-second
    // timestamps and multi-view references. The doctrine is one group for the
    // whole family, so BOTH halves must be stated — a rewrite that drops
    // either side re-applies a 2.0 rule to 2.5 (or vice versa).
    const d = getPromptDoctrine("seedance-2-5")!
    expect(d.providers).toContain("seedance-2")
    expect(d.doctrine).toMatch(/2\.0[^.]*(ignore|do not respond to|respond to shot numbers only)[^.]*timestamps|timestamps[^.]*2\.0/i)
    expect(d.doctrine).toMatch(/seedance-2-5[^.]*integer-second timestamps|integer-second timestamps[^.]*2\.5/i)
    expect(d.doctrine).toMatch(/At the 5-second mark/)
    expect(d.doctrine).toMatch(/2\.5 accepts multi-view|supported on 2\.5/i)
    const tips = getPromptTips("seedance-2-5").join(" ")
    expect(tips).toMatch(/2\.0 SKUs ignore timestamps/)
    expect(tips).toMatch(/seedance-2-5 honours integer-second timestamps/)
  })

  it("Wan 3.0 has its OWN doctrine — the 2.x token format must not leak onto it", () => {
    // WAN_DOCTRINE teaches "Image 1" / "Video 1" (capitalised, WITH a space),
    // which is the Wan 2.x format. The Wan 3.0 KIE contract binds Image1 /
    // Video1 / Audio1 (no space). Folding 3.0 into the 2.x entry would ship a
    // token format the model does not use — a prompt-quality regression that
    // costs real generations, so the split is the point of this test.
    const d = getPromptDoctrine("wan-3")!
    expect(d.providers).toEqual(["wan-3", "wan-3-prime"])
    expect(getPromptDoctrine("wan-3-prime")).toBe(d)
    expect(d.doctrine).toContain("Image1")
    expect(d.doctrine).toContain("Audio1")
    // The 2.x spelling may appear ONLY as an explicit contrast, never as the
    // instruction — so the body must say the format has no space.
    expect(d.doctrine).toMatch(/NO space/)
    expect(d.doctrine).toMatch(/Wan 2\.x's "Image 1"/)

    // The 2.x doctrine must stay the 2.x doctrine.
    const wan2 = getPromptDoctrine("wan-i2v")!
    expect(wan2).not.toBe(d)
    expect(wan2.providers).not.toContain("wan-3")
    expect(wan2.doctrine).toContain("Image 1")

    // KIE contract facts the body is required to carry.
    expect(d.doctrine).toMatch(/mutually exclusive|CANNOT be combined/i)
    expect(d.doctrine).toMatch(/20,000 characters/)
    expect(d.doctrine).toMatch(/≤ 30 seconds/)
    // Prime is the SPEED tier — never described as higher quality.
    expect(d.doctrine).toMatch(/faster turnaround/i)
    expect(d.doctrine).not.toMatch(/higher quality/i)
  })

  it("Gemini Omni Flash rides the sibling's doctrine (identical request surface)", () => {
    const d = getPromptDoctrine("gemini-omni-flash")!
    expect(d).toBe(getPromptDoctrine("gemini-omni-video"))
    expect(d.providers).toEqual(["gemini-omni-video", "gemini-omni-flash"])
    expect(d.heading).toContain("gemini-omni-flash")
    expect(d.doctrine).toMatch(/gemini-omni-flash is the faster\/cheaper tier/)
  })
})
