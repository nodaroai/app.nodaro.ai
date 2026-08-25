/**
 * B4c — voice-gender dispatch backstop in buildPayload (text-to-speech case).
 *
 * `voice.allowedGenders` was enforced ONLY at the direct /v1/text-to-speech
 * route; the orchestrator/worker TTS path had NO backstop, so an auto-wired
 * Character voice (input-resolver) or an imported/MCP-authored premade voice of
 * a DISALLOWED gender reached the provider under a gender lock — the B1
 * model-deny bypass class. buildPayload now vets the EFFECTIVE (auto-wired ??
 * data ?? default) voice's premade gender and throws `voice_not_available`,
 * mirroring the model-deny thrown shape. Inert by default (empty
 * allowedGenders allows every gender).
 */
import { describe, it, expect, afterEach } from "vitest"
import { buildPayload } from "../payload-builder.js"
import type { SimpleNode } from "../types.js"
import { __resetSurfaceProfileCacheForTests } from "../../../lib/surface-profile.js"

afterEach(() => {
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
})

const ttsNode = (data: Record<string, unknown> = {}): SimpleNode => ({
  id: "tts-1",
  type: "text-to-speech",
  data: { textSource: "direct", directText: "hello", ...data },
})
const giNode = (provider: string): SimpleNode => ({
  id: "gi-1",
  type: "generate-image",
  data: { provider, prompt: "a red bird on a branch" },
})
const ctx = (n: SimpleNode) => ({ nodes: [n], edges: [], nodeStates: {} })

const maleOnly = () => {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ voice: { allowedGenders: ["male"] } })
  __resetSurfaceProfileCacheForTests()
}

describe("buildPayload — voice-gender dispatch backstop (B4c)", () => {
  it("throws voice_not_available when an AUTO-WIRED (resolvedInputs) voice is a disallowed gender", () => {
    // The confirmed bypass: input-resolver auto-injects an upstream Character
    // node's voice into resolvedInputs.voice, and the TTS case dispatches
    // `resolvedInputs.voice || data.voiceId || data.voice`. With data unset, a
    // disallowed-gender premade voice (Rachel = female) reaches the provider
    // under a male-only lock unless the backstop catches the EFFECTIVE voice.
    maleOnly()
    const n = ttsNode()
    const resolved = { voice: "Rachel", voiceType: "premade" as const }
    expect(() => buildPayload(n, "job-vgd-1", resolved, undefined, ctx(n))).toThrow(
      /not available on this deployment/,
    )
    try {
      buildPayload(n, "job-vgd-1", resolved, undefined, ctx(n))
      expect.unreachable("buildPayload should have thrown for the disallowed-gender voice")
    } catch (e) {
      expect((e as { code?: string }).code).toBe("voice_not_available")
    }
  })

  it("throws voice_not_available for a disallowed-gender voice carried on node DATA (import/MCP)", () => {
    maleOnly()
    const n = ttsNode({ voiceId: "Rachel", voiceType: "premade" })
    expect(() => buildPayload(n, "job-vgd-2", {}, undefined, ctx(n))).toThrow(
      /not available on this deployment/,
    )
  })

  it("builds normally when the effective voice is an ALLOWED gender", () => {
    maleOnly()
    const n = ttsNode()
    const resolved = { voice: "Adam", voiceType: "premade" as const }
    const result = buildPayload(n, "job-vgd-3", resolved, undefined, ctx(n))
    expect(result.jobName).toBe("text-to-speech")
    expect(result.payload.voice).toBe("Adam")
  })

  it("does NOT reject a custom/library voice (unknown premade gender) under the lock", () => {
    maleOnly()
    const n = ttsNode()
    const resolved = { voice: "someClonedId", voiceType: "custom" as const }
    const result = buildPayload(n, "job-vgd-4", resolved, undefined, ctx(n))
    expect(result.payload.voice).toBe("someClonedId")
  })

  it("is inert by default — empty allowedGenders never rejects a female voice", () => {
    // No NODARO_SURFACE_PROFILE → allowedGenders is [] → every gender allowed.
    const n = ttsNode()
    const resolved = { voice: "Rachel", voiceType: "premade" as const }
    const result = buildPayload(n, "job-vgd-5", resolved, undefined, ctx(n))
    expect(result.payload.voice).toBe("Rachel")
  })

  it("does NOT affect a NON-TTS node under the same male-only lock", () => {
    maleOnly()
    const n = giNode("nano-banana")
    const result = buildPayload(n, "job-vgd-6", {}, undefined, ctx(n))
    expect(result.jobName).toBe("generate-image")
    expect(result.payload.prompt).toBe("a red bird on a branch")
  })
})
