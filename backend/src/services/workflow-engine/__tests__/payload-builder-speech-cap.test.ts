/**
 * The workflow lane refuses speech text over the model's per-request cap
 * BEFORE anything is reserved (decided 2026-10-06, Q-OVERCAP) — with the MCP
 * tool's wording and the numbers — instead of sending it unclamped. A throw
 * inside buildPayload leaves no jobs row (node-executor deletes the placeholder).
 */
import { describe, it, expect } from "vitest"
import { getMaxTtsChars, DEFAULT_TTS_PROVIDER } from "@nodaro/shared"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

function node(type: string, data: Record<string, unknown>): SimpleNode {
  return { id: "n1", type, data }
}

describe("text-to-speech over the cap on the workflow lane", () => {
  it("a named model over its cap is refused with the numbers, before dispatch", () => {
    const text = "a".repeat(5001)
    expect(() => buildPayload(node("text-to-speech", { provider: "elevenlabs-v3", textSource: "direct", directText: text }), "job1", {}))
      .toThrow("text is 5001 characters; elevenlabs-v3 takes at most 5000 per request. Split the script into several calls, or pick a model with a larger cap.")
  })

  it("the refusal carries a stable code", () => {
    try {
      buildPayload(node("text-to-speech", { provider: "elevenlabs-v4", textSource: "direct", directText: "a".repeat(10001) }), "job1", {})
      expect.unreachable()
    } catch (err) {
      expect((err as Error & { errorCode?: string }).errorCode).toBe("text_too_long")
    }
  })

  it("exactly the cap runs", () => {
    const built = buildPayload(node("text-to-speech", { provider: "elevenlabs-v3", textSource: "direct", directText: "a".repeat(5000) }), "job1", {})
    expect(built.payload.text).toHaveLength(getMaxTtsChars("elevenlabs-v3"))
  })

  it("the alias runs as turbo and is judged by turbo's cap", () => {
    const built = buildPayload(node("text-to-speech", { provider: "elevenlabs", textSource: "direct", directText: "a".repeat(12000) }), "job1", {})
    expect(built.payload.provider).toBe("elevenlabs")
    expect(() => buildPayload(node("text-to-speech", { provider: "elevenlabs", textSource: "direct", directText: "a".repeat(40001) }), "job1", {}))
      .toThrow("elevenlabs-turbo takes at most 40000")
  })

  it("an omitted model follows the length rule (turbo above the default's cap) and is not refused", () => {
    const built = buildPayload(node("text-to-speech", { textSource: "direct", directText: "a".repeat(12000) }), "job1", {})
    expect(built.payload.provider).toBe("elevenlabs-turbo")
    expect(getMaxTtsChars(DEFAULT_TTS_PROVIDER)).toBe(10000)
  })

  it("an unknown model id (written straight into workflow JSON) runs as the fallback model and is judged by ITS cap", () => {
    expect(() => buildPayload(node("text-to-speech", { provider: "not-a-model", textSource: "direct", directText: "a".repeat(12000) }), "job1", {})).not.toThrow()
  })
})

describe("text-to-dialogue over the total cap on the workflow lane", () => {
  it("is refused with the numbers (the model's capability-sheet cap) and a stable code", () => {
    const dialogue = [{ text: "a".repeat(3000), voice: "Rachel" }, { text: "b".repeat(2001), voice: "George" }]
    expect(() => buildPayload(node("text-to-dialogue", { dialogue }), "job1", {}))
      .toThrow("Text to Dialogue has 5001 characters of dialogue; this model takes at most 5000 characters in total")
    try {
      buildPayload(node("text-to-dialogue", { dialogue }), "job1", {})
      expect.unreachable()
    } catch (err) {
      expect((err as Error & { errorCode?: string }).errorCode).toBe("text_too_long")
    }
  })

  it("exactly the cap runs; empty lines are dropped before counting (as today)", () => {
    const dialogue = [{ text: "a".repeat(5000), voice: "Rachel" }, { text: "   ", voice: "George" }]
    const built = buildPayload(node("text-to-dialogue", { dialogue }), "job1", {})
    expect(built.payload.dialogue).toHaveLength(1)
  })
})
