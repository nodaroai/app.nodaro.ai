// Provider attribution (lib/concurrency-lanes/provider-of.ts): the provider a
// job or an LLM call counts against for the platform-wide provider ceilings.
// Its totality guard enumerates every node unit's lane, so a unit change selects it.
// @test-watches frontend/src/nodes/** backend/src/nodes/**
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { LlmRequest } from "../../llm/types.js"

// Every LLM key set (the production posture); a case changes one at a time.
const keys = vi.hoisted(() => ({ KIE_API_KEY: "kie", ANTHROPIC_API_KEY: "anthropic", GEMINI_API_KEY: "gemini" }))
vi.mock("../../config.js", async (orig) => {
  const actual = (await orig<typeof import("../../config.js")>()).config
  return { ...(await orig<typeof import("../../config.js")>()), config: new Proxy(actual, { get: (t, k) => (k in keys ? keys[k as keyof typeof keys] : Reflect.get(t, k)) }) }
})

const { registerKieProviders } = await import("../../../providers/kie/index.js")
const { registerReplicateProviders } = await import("../../../providers/replicate/index.js")
const { JOB_LANE_CLASSES, laneClassOf } = await import("../registry.js")
const { UNIT_NODE_DESCRIPTORS, laneOf } = await import("../../unit-descriptors.js")
const { HANDLER_PROVIDERS, ROUTED_JOBS, UNATTRIBUTED, primaryProviderOfJob, primaryProviderOfLlm } = await import("../provider-of.js")
const { latchDirectLaneExhausted, __resetPlatformExhaustionAlerts } = await import("../../llm-platform-exhaustion.js")

// The router reads the live registry; a worker fills it at boot (initProviders).
beforeAll(() => {
  registerKieProviders()
  registerReplicateProviders()
})

describe("primaryProviderOfJob", () => {
  it("a KIE image model counts against kie", () => {
    expect(primaryProviderOfJob("generate-image", { provider: "nano-banana" })).toBe("kie")
  })

  it("a model KIE retired (still a KIE_IMAGE_MODELS key) counts against the provider that serves it", () => {
    expect(primaryProviderOfJob("edit-image", { provider: "topaz-image-upscale" })).toBe("replicate")
  })

  it("a handler that calls a provider client directly counts against that provider", () => {
    expect(primaryProviderOfJob("text-to-speech", { text: "hi", voice: "x" })).toBe("elevenlabs")
    expect(primaryProviderOfJob("audio-isolation", { audioUrl: "https://x/a.mp3" })).toBe("kie")
  })

  it("a local-lane job counts against local", () => {
    expect(primaryProviderOfJob("trim-video", {})).toBe("local")
    expect(primaryProviderOfJob("render-video", {})).toBe("local")
  })

  it("a Replicate-only video model counts against replicate", () => {
    expect(primaryProviderOfJob("image-to-video", { provider: "kling-3-omni" })).toBe("replicate")
    expect(primaryProviderOfJob("image-to-video", { provider: "minimax" })).toBe("kie")
  })

  it("a payload with no model counts against the handler's default model", () => {
    expect(primaryProviderOfJob("image-to-video", {})).toBe("kie")
    expect(primaryProviderOfJob("video-upscale", {})).toBe("replicate")
  })

  it("a model no provider in the chain serves is unknown", () => {
    expect(primaryProviderOfJob("generate-image", { provider: "no-such-model" })).toBeNull()
  })

  it("an unknown job type is null", () => {
    expect(primaryProviderOfJob("no-such-job", {})).toBeNull()
  })

  it("a coordinator or an llm-lane job is null (each call it makes is attributed on its own)", () => {
    expect(primaryProviderOfJob("generate-video-pro", {})).toBeNull()
    expect(primaryProviderOfJob("generate-script", {})).toBeNull()
  })

  const isProviderLane = (name: string): boolean => {
    const cls = laneClassOf("video-generation", name, {})
    return cls.kind === "leaf" && cls.lane === "provider"
  }

  it("every HANDLER_PROVIDERS key is a classified provider-lane job", () => {
    expect(Object.keys(HANDLER_PROVIDERS).filter((name) => !isProviderLane(name))).toEqual([])
  })

  it("every ROUTED_JOBS and UNATTRIBUTED key is a classified provider-lane job", () => {
    expect([...Object.keys(ROUTED_JOBS), ...Object.keys(UNATTRIBUTED)].filter((name) => !isProviderLane(name))).toEqual([])
  })

  it("every provider-lane job (registry table and node units) is attributed, or unattributed with a reason, exactly once", () => {
    const providerJobs = [
      ...Object.entries(JOB_LANE_CLASSES)
        .filter(([, cls]) => cls.kind === "leaf" && cls.lane === "provider")
        .map(([key]) => key.slice(key.indexOf(":") + 1)),
      ...UNIT_NODE_DESCRIPTORS.map((d) => d.type).filter((type) => laneOf(type) === "provider"),
    ]
    const tables = [HANDLER_PROVIDERS, ROUTED_JOBS, UNATTRIBUTED].map((t) => new Set(Object.keys(t)))
    const missing = providerJobs.filter((name) => !tables.some((t) => t.has(name)))
    const twice = providerJobs.filter((name) => tables.filter((t) => t.has(name)).length > 1)
    expect({ missing, twice }).toEqual({ missing: [], twice: [] })
    expect(Object.values(UNATTRIBUTED).filter((reason) => reason.trim().length < 10)).toEqual([])
  })

  it("Suno, HeyGen and Beeble jobs count against their one vendor", () => {
    expect(primaryProviderOfJob("suno-generate", {})).toBe("kie")
    expect(primaryProviderOfJob("suno-separate", {})).toBe("kie")
    expect(primaryProviderOfJob("ai-avatar", {})).toBe("heygen")
    expect(primaryProviderOfJob("cinematic-avatar", {})).toBe("heygen")
    expect(primaryProviderOfJob("switchx", {})).toBe("beeble")
  })

  it("payload-dependent jobs follow their handler's branch", () => {
    expect(primaryProviderOfJob("extend-video", { provider: "ltx-2.3-pro" })).toBe("replicate")
    expect(primaryProviderOfJob("extend-video", { provider: "veo-extend" })).toBe("kie")
    expect(primaryProviderOfJob("extend-video", { provider: "seedance-2-extend" })).toBe("kie")
    expect(primaryProviderOfJob("text-to-audio", {})).toBe("elevenlabs")
    expect(primaryProviderOfJob("text-to-audio", { provider: "tangoflux" })).toBe("replicate")
    expect(primaryProviderOfJob("transcribe", { provider: "elevenlabs-stt" })).toBe("elevenlabs")
    expect(primaryProviderOfJob("transcribe", {})).toBe("replicate")
    expect(primaryProviderOfJob("video-depth", {})).not.toBeNull()
    expect(primaryProviderOfJob("video-depth", { provider: "no-such-depth" })).toBeNull()
    expect(primaryProviderOfJob("voiced-video", {})).toBe("kie")
  })

  it("reference-sheet counts as local", () => {
    expect(primaryProviderOfJob("reference-sheet", {})).toBe("local")
  })

  it("a provider-lane job that calls no AI provider is null", () => {
    expect(primaryProviderOfJob("extract-youtube-audio", {})).toBeNull()
  })
})

describe("primaryProviderOfLlm", () => {
  const call = (extra: Partial<LlmRequest>): LlmRequest =>
    ({ system: "", messages: [{ role: "user", content: "hi" }], ...extra }) as LlmRequest

  beforeEach(() => {
    keys.KIE_API_KEY = "kie"
    keys.ANTHROPIC_API_KEY = "anthropic"
    keys.GEMINI_API_KEY = "gemini"
    __resetPlatformExhaustionAlerts()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })

  it("a Claude at high effort counts against anthropic", () => {
    expect(primaryProviderOfLlm(call({ modelId: "claude-opus-5.5", reasoningEffort: "high" }))).toBe("anthropic")
  })

  it("a Gemini served on KIE counts against kie", () => {
    expect(primaryProviderOfLlm(call({ modelId: "gemini-3.6-flash" }))).toBe("kie")
  })

  it("a direct-only Gemini counts against google", () => {
    expect(primaryProviderOfLlm(call({ modelId: "gemini-4-argon" }))).toBe("google")
  })

  it("requireLane direct on a Claude counts against anthropic", () => {
    expect(primaryProviderOfLlm(call({ modelId: "claude-opus-5.5", requireLane: "direct" }))).toBe("anthropic")
  })

  it("a Claude call counts against kie when there is no Anthropic key", () => {
    keys.ANTHROPIC_API_KEY = ""
    expect(primaryProviderOfLlm(call({ modelId: "claude-opus-5.5", reasoningEffort: "high" }))).toBe("kie")
    expect(primaryProviderOfLlm(call({ modelId: "claude-opus-5.5", requireLane: "direct" }))).toBe("kie")
  })

  it("a Claude call counts against kie while the Anthropic account is latched as refused", () => {
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "test" })
    expect(primaryProviderOfLlm(call({ modelId: "claude-opus-5.5", reasoningEffort: "high" }))).toBe("kie")
  })

  it("a KIE-first Gemini counts against google when there is no KIE key", () => {
    keys.KIE_API_KEY = ""
    expect(primaryProviderOfLlm(call({ modelId: "gemini-3.6-flash" }))).toBe("google")
  })

  it("a request naming only a feature counts against its default model's provider", () => {
    expect(primaryProviderOfLlm(call({ feature: "llm-chat" }))).toBe("kie") // gemini-3.6-flash, KIE-first
  })

  it("an unknown model, or a call no key can serve, is null", () => {
    expect(primaryProviderOfLlm(call({ modelId: "no-such-llm" }))).toBeNull()
    keys.GEMINI_API_KEY = ""
    expect(primaryProviderOfLlm(call({ modelId: "gemini-4-argon" }))).toBeNull()
  })
})
