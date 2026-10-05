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
import { DEFAULT_TTS_PROVIDER, getMaxTtsChars } from "@nodaro/shared"
import { buildPayload, effectiveDispatchProvider } from "../payload-builder.js"
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

  it("dispatches the character-auto-wired provider via effectiveDispatchProvider (single source with the deny check)", () => {
    // No data.provider — the character node auto-wires resolvedInputs.provider.
    const n = node("n1", "text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "hi" })
    const resolvedInputs = { provider: "elevenlabs-v3", voice: "Rachel" }
    const built = buildPayload(n, "job-1", resolvedInputs)
    // The provider actually dispatched (modelIdentifier + payload.provider) must be
    // exactly what the surface deny check reads via effectiveDispatchProvider.
    expect(built.modelIdentifier).toBe(effectiveDispatchProvider("text-to-speech", n.data, resolvedInputs))
    expect(built.payload.provider).toBe("elevenlabs-v3")
  })
})

describe("buildPayload — text-to-speech with no model anywhere", () => {
  it("dispatches AND bills the default speech model (ElevenLabs v4) for a node that stores no provider", () => {
    const n = node("t1", "text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "hi" })
    const built = buildPayload(n, "job1", {}, "usage1")
    expect(DEFAULT_TTS_PROVIDER).toBe("elevenlabs-v4")
    expect(built.payload.provider).toBe(DEFAULT_TTS_PROVIDER)
    expect(built.modelIdentifier).toBe(DEFAULT_TTS_PROVIDER)
  })

  it("treats an empty-string provider as none (the `||` precedence)", () => {
    const n = node("t1", "text-to-speech", { voiceId: "Rachel", provider: "", textSource: "direct", directText: "hi" })
    const built = buildPayload(n, "job1", {}, "usage1")
    expect(built.payload.provider).toBe(DEFAULT_TTS_PROVIDER)
    expect(built.modelIdentifier).toBe(DEFAULT_TTS_PROVIDER)
  })

  it("leaves a node that stores v3 on v3 — the flip changes only nodes with no provider", () => {
    const n = node("t1", "text-to-speech", { voiceId: "Rachel", provider: "elevenlabs-v3", textSource: "direct", directText: "hi" })
    const built = buildPayload(n, "job1", {}, "usage1")
    expect(built.payload.provider).toBe("elevenlabs-v3")
    expect(built.modelIdentifier).toBe("elevenlabs-v3")
  })

  // The same length rule as the REST route's omitted-provider default (one function):
  // the default model up to its own cap, turbo above it — so the model billed is the
  // model run, and a long text is never sent to a model that cannot take it.
  it("runs AND bills turbo for a node with no provider whose text is over the default model's cap", () => {
    expect(getMaxTtsChars(DEFAULT_TTS_PROVIDER)).toBe(10000)
    const n = node("t1", "text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "a".repeat(12000) })
    const built = buildPayload(n, "job1", {}, "usage1")
    expect(built.payload.provider).toBe("elevenlabs-turbo")
    expect(built.modelIdentifier).toBe("elevenlabs-turbo")
    expect(built.payload.text).toHaveLength(12000)
  })

  it("keeps the default model for a node with no provider at and under its cap", () => {
    for (const len of [9000, 10000]) {
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", textSource: "direct", directText: "a".repeat(len) })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect(built.payload.provider, `${len}`).toBe(DEFAULT_TTS_PROVIDER)
      expect(built.modelIdentifier, `${len}`).toBe(DEFAULT_TTS_PROVIDER)
    }
  })

  it("measures the text the node actually sends (pre/post text included)", () => {
    const n = node("t1", "text-to-speech", {
      voiceId: "Rachel", textSource: "direct", directText: "a".repeat(9990), promptPrefix: "b".repeat(20),
    })
    const built = buildPayload(n, "job1", {}, "usage1")
    expect((built.payload.text as string).length).toBeGreaterThan(10000)
    expect(built.payload.provider).toBe("elevenlabs-turbo")
    expect(built.modelIdentifier).toBe("elevenlabs-turbo")
  })

  it("never applies the length rule to a stored model, v3 or v4", () => {
    for (const provider of ["elevenlabs-v3", "elevenlabs-v4"]) {
      const n = node("t1", "text-to-speech", { voiceId: "Rachel", provider, textSource: "direct", directText: "a".repeat(12000) })
      const built = buildPayload(n, "job1", {}, "usage1")
      expect(built.payload.provider, provider).toBe(provider)
      expect(built.modelIdentifier, provider).toBe(provider)
    }
  })
})
