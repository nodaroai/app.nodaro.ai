import { describe, expect, it, vi, beforeEach } from "vitest"

// Mock llm-client BEFORE importing the module-under-test so the import sees the mock.
vi.mock("../llm-client.js", () => ({
  llmComplete: vi.fn(),
}))

import { llmComplete } from "../llm-client.js"
import { captionObject, OBJECT_CAPTION_SYSTEM } from "../object-caption.js"

const mockLlm = vi.mocked(llmComplete)

describe("captionObject", () => {
  beforeEach(() => {
    mockLlm.mockReset()
  })

  it("returns the trimmed text on success", async () => {
    mockLlm.mockResolvedValue({
      text: "  A glowing katana with ancient runes etched along the blade.  ",
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "claude-sonnet-4.6",
    })
    const result = await captionObject("https://example.com/img.png")
    expect(result).toBe("A glowing katana with ancient runes etched along the blade.")
  })

  it("returns null on empty LLM output", async () => {
    mockLlm.mockResolvedValue({
      text: "   ",
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "claude-sonnet-4.6",
    })
    const result = await captionObject("https://example.com/img.png")
    expect(result).toBeNull()
  })

  it("returns null on LLM error (swallowed)", async () => {
    mockLlm.mockRejectedValue(new Error("network failure"))
    const result = await captionObject("https://example.com/img.png")
    expect(result).toBeNull()
  })

  it("truncates at sentence boundary when text exceeds 4000 chars", async () => {
    // Build a 4500-char string with sentence terminators interspersed.
    const sentence = "This is a sentence about the object. "
    const longText = sentence.repeat(150).slice(0, 4500) // ~4500 chars, ends with partial sentence
    mockLlm.mockResolvedValue({
      text: longText,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "claude-sonnet-4.6",
    })
    const result = await captionObject("https://example.com/img.png")
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThanOrEqual(3990)
    // Should end with a sentence terminator (the last `.` before the 3990 cut)
    expect(result!.endsWith(".")).toBe(true)
  })

  it("hard-cuts at 3990 chars when no sentence terminator exists beyond offset 100", async () => {
    // A 4200-char string with NO terminators at all (just a single run-on).
    const longRunOn = "a".repeat(4200)
    mockLlm.mockResolvedValue({
      text: longRunOn,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "claude-sonnet-4.6",
    })
    const result = await captionObject("https://example.com/img.png")
    expect(result).not.toBeNull()
    expect(result!.length).toBe(3990) // hard-cut
  })

  it("uses the object-specific system prompt", () => {
    expect(OBJECT_CAPTION_SYSTEM).toMatch(/form\/shape/)
    expect(OBJECT_CAPTION_SYSTEM).toMatch(/primary material/)
    // The prompt explicitly says "Do NOT include scenes, backgrounds, or environments"
    // and "Do NOT add adjectives that imply mood or atmosphere" — so the body should
    // not orient AROUND landscape/location/atmosphere generation guidance.
    expect(OBJECT_CAPTION_SYSTEM).not.toMatch(/landscape/i)
    expect(OBJECT_CAPTION_SYSTEM).not.toMatch(/\blocation\b/i)
    expect(OBJECT_CAPTION_SYSTEM).toMatch(/Language: English ONLY/)
  })
})
