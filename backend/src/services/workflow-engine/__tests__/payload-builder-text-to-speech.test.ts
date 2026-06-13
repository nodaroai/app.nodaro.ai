/**
 * Payload-builder tests for the `text-to-speech` auto-wire consumer seam.
 *
 * The Character Studio Voice page auto-wires an upstream Character node's voice
 * into a connected text-to-speech node (input-resolver emits
 * resolvedInputs.voice/.provider/.voiceType). The runtime effect lives in the
 * `text-to-speech` case of buildPayload, which reads
 * `resolvedInputs.voice || data.voiceId`, `resolvedInputs.provider || data.provider`,
 * and `resolvedInputs.voiceType || data.voiceType`. These tests pin that
 * consumer contract so a future payload-builder refactor can't silently break
 * the auto-wire feature.
 */
import { describe, it, expect } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"

function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
  return { id, type, data }
}

describe("buildPayload — text-to-speech voice auto-wire", () => {
  it("text-to-speech consumes auto-wired resolvedInputs.voice/.provider/.voiceType over node data", () => {
    const n = node("t1", "text-to-speech", { voiceId: "node-default", provider: "elevenlabs-v3", voiceType: "premade", textSource: "direct", directText: "hi" })
    const result = buildPayload(n, "job1", { voice: "vid_123", provider: "elevenlabs-turbo", voiceType: "library" }, "usage1")
    expect(result.payload.voice).toBe("vid_123")
    expect(result.payload.provider).toBe("elevenlabs-turbo")
    expect(result.payload.voiceType).toBe("library")
  })

  it("text-to-speech falls back to node data when no voice is auto-wired", () => {
    const n = node("t1", "text-to-speech", { voiceId: "node-default", provider: "elevenlabs-v3", textSource: "direct", directText: "hi" })
    const result = buildPayload(n, "job1", {}, "usage1")
    expect(result.payload.voice).toBe("node-default")
    expect(result.payload.provider).toBe("elevenlabs-v3")
  })
})
