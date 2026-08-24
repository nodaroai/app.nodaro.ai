/**
 * S3 — deployment-surface MODEL deny run-time backstop in buildPayload.
 *
 * Node deny already throws at the top of buildPayload; model deny used to be
 * DISCOVERY-only, so a denied model still ran + billed when its `provider`
 * reached the orchestrator via an imported/templated workflow row or a
 * FieldMapping-injected value (neither passes a write guard). buildPayload now
 * throws for a denied `data.provider` too, mirroring the node-deny shape.
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

const giNode = (provider: string): SimpleNode => ({
  id: "gi-1",
  type: "generate-image",
  data: { provider, prompt: "a red bird on a branch" },
})
const ttsNode = (data: Record<string, unknown>): SimpleNode => ({
  id: "tts-1",
  type: "text-to-speech",
  data,
})
const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })

describe("buildPayload — surface MODEL deny run-time backstop (S3)", () => {
  it("throws model_not_available for a node whose data.provider is a denied model", () => {
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["nano-banana"] } })
    __resetSurfaceProfileCacheForTests()
    const n = giNode("nano-banana")
    expect(() => buildPayload(n, "job-model-deny-1", {}, undefined, ctx(n))).toThrow(
      /not available on this deployment/,
    )
    try {
      buildPayload(n, "job-model-deny-1", {}, undefined, ctx(n))
      expect.unreachable("buildPayload should have thrown for a denied model")
    } catch (e) {
      expect((e as { code?: string }).code).toBe("model_not_available")
      expect((e as Error).message).toMatch(/nano-banana/)
    }
  })

  it("does NOT raise model_not_available when the model is not denied (default profile)", () => {
    // Default profile denies nothing — the top-of-buildPayload backstop must be
    // inert. (Any other build error is fine; only model_not_available is barred.)
    const n = giNode("nano-banana")
    try {
      buildPayload(n, "job-model-deny-2", {}, undefined, ctx(n))
    } catch (e) {
      expect((e as { code?: string }).code).not.toBe("model_not_available")
    }
  })
})

describe("buildPayload — MODEL deny checks the EFFECTIVE dispatched provider (B1, 2nd cycle)", () => {
  it("throws model_not_available for a text-to-speech node whose auto-wired resolvedInputs.provider is denied while data.provider is UNSET", () => {
    // The confirmed bypass: input-resolver auto-injects a wired Character/creature
    // node's recommended TTS provider into resolvedInputs.provider (alongside
    // voice/voiceType) when the TTS node has no explicit voice, and the TTS case
    // dispatches + bills `resolvedInputs.provider || data.provider || "elevenlabs-v3"`.
    // With data.provider UNSET, the old backstop (which read only data.provider)
    // let the denied model run + bill. It must throw on the effective provider.
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["elevenlabs-v3"] } })
    __resetSurfaceProfileCacheForTests()
    const n = ttsNode({ textSource: "direct", directText: "hi" })
    const resolved = { voice: "vid_123", voiceType: "premade" as const, provider: "elevenlabs-v3" }
    expect(() => buildPayload(n, "job-tts-deny-1", resolved, undefined, ctx(n))).toThrow(
      /not available on this deployment/,
    )
    try {
      buildPayload(n, "job-tts-deny-1", resolved, undefined, ctx(n))
      expect.unreachable("buildPayload should have thrown for the denied dispatched provider")
    } catch (e) {
      expect((e as { code?: string }).code).toBe("model_not_available")
      expect((e as Error).message).toMatch(/elevenlabs-v3/)
    }
  })

  it("does NOT deny a text-to-speech node whose effective (auto-wired) provider is allowed", () => {
    // deny lists elevenlabs-v3, but the effective dispatched provider is the
    // auto-wired elevenlabs-turbo → the node must build normally and dispatch it.
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["elevenlabs-v3"] } })
    __resetSurfaceProfileCacheForTests()
    const n = ttsNode({ textSource: "direct", directText: "hi" })
    const resolved = { voice: "vid_123", voiceType: "premade" as const, provider: "elevenlabs-turbo" }
    const result = buildPayload(n, "job-tts-allow-1", resolved, undefined, ctx(n))
    expect(result.payload.provider).toBe("elevenlabs-turbo")
  })

  it("does NOT falsely deny a NON-TTS node that merely carries an unrelated resolvedInputs.provider (no over-reach)", () => {
    // generate-image dispatches on data.provider ONLY. A stray (denied)
    // resolvedInputs.provider must not gate it — the helper deliberately reads
    // resolvedInputs.provider for text-to-speech ONLY, so non-TTS nodes are
    // unchanged and can't be falsely denied.
    process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ models: { deny: ["elevenlabs-v3"] } })
    __resetSurfaceProfileCacheForTests()
    const n = giNode("nano-banana")
    const result = buildPayload(n, "job-nontts-1", { provider: "elevenlabs-v3" }, undefined, ctx(n))
    expect(result.modelIdentifier).toBeDefined()
    expect(result.modelIdentifier).not.toBe("elevenlabs-v3")
  })
})
