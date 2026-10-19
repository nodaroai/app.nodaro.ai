/**
 * One rule decides whether Claude runs on the platform's Anthropic account or
 * on KIE: the key — trimmed — and the direct-lane latch. Every path that can
 * move (film pipelines, the Copilot, the route gates, the router's own key
 * tests) reads the same answer, so a whitespace key cannot read as "set" in
 * one place and "missing" in another.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import Anthropic from "@anthropic-ai/sdk"

// A plain config object: the live getter trims a whitespace key to "" on its
// own, which would hide the router's untrimmed reads this file guards against.
const cfg = vi.hoisted(() => ({
  ANTHROPIC_API_KEY: "sk-ant-test" as string | undefined,
  KIE_API_KEY: "kie-test" as string | undefined,
  KIE_API_BASE_URL: "https://api.kie.ai",
  GEMINI_API_KEY: "",
  NODE_ENV: "test",
}))
vi.mock("../config.js", () => ({ config: cfg, hasCredits: () => true }))
const createSpy = vi.hoisted(() => vi.fn())
vi.mock("../anthropic.js", () => ({ getAnthropicClient: () => ({ messages: { create: createSpy } }) }))

import {
  __resetAnthropicAvailabilityLog,
  anthropicDirectUsable,
  anthropicKeySet,
  claudeLaneConfigured,
  geminiKeySet,
  kieKeySet,
  localLlmKeySet,
  pickClaudeLane,
} from "../llm/anthropic-availability.js"
import {
  DIRECT_LANE_LATCH_MS,
  __resetPlatformExhaustionAlerts,
  directLaneLatch,
  latchDirectLaneExhausted,
} from "../llm-platform-exhaustion.js"
import { LlmPlatformExhaustedError, toPlatformExhausted } from "../llm-errors.js"

beforeEach(() => {
  __resetPlatformExhaustionAlerts()
  __resetAnthropicAvailabilityLog()
  createSpy.mockReset()
  cfg.ANTHROPIC_API_KEY = "sk-ant-test"
  cfg.KIE_API_KEY = "kie-test"
  cfg.GEMINI_API_KEY = ""
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("anthropicDirectUsable", () => {
  it("is true with a key and no latch", () => {
    expect(anthropicKeySet()).toBe(true)
    expect(anthropicDirectUsable()).toBe(true)
  })

  it("is false for an empty key", () => {
    cfg.ANTHROPIC_API_KEY = ""
    expect(anthropicDirectUsable()).toBe(false)
  })

  it("reads a whitespace-only key as no key", () => {
    cfg.ANTHROPIC_API_KEY = "   \n"
    expect(anthropicKeySet()).toBe(false)
    expect(anthropicDirectUsable()).toBe(false)
  })

  it("reads an undefined key as no key", () => {
    cfg.ANTHROPIC_API_KEY = undefined
    expect(anthropicKeySet()).toBe(false)
    expect(anthropicDirectUsable()).toBe(false)
  })

  it("is false while the anthropic latch is open, and true again once it expires", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-18T12:00:00Z"))
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "refused" })
    expect(anthropicDirectUsable()).toBe(false)
    vi.setSystemTime(Date.now() + DIRECT_LANE_LATCH_MS)
    expect(anthropicDirectUsable()).toBe(true)
  })

  it("ignores another provider's latch", () => {
    latchDirectLaneExhausted({ provider: "google", kind: "billing", detail: "refused" })
    expect(anthropicDirectUsable()).toBe(true)
  })
})

describe("pickClaudeLane", () => {
  it("is direct while the account is usable", () => {
    expect(pickClaudeLane()).toBe("direct")
  })

  it("is kie for an empty key, and says so once per process", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    cfg.ANTHROPIC_API_KEY = ""
    expect(pickClaudeLane()).toBe("kie")
    expect(pickClaudeLane()).toBe("kie")
    const lines = warn.mock.calls.filter((c) => String(c[0]).includes("Anthropic key not set — Claude calls go to KIE"))
    expect(lines).toHaveLength(1)
    warn.mockRestore()
  })

  it("is kie while the latch is open", () => {
    latchDirectLaneExhausted({ provider: "anthropic", kind: "auth", detail: "refused" })
    expect(pickClaudeLane()).toBe("kie")
  })

  it("stays direct when there is no KIE key to move to (today's answers stand)", () => {
    cfg.ANTHROPIC_API_KEY = ""
    cfg.KIE_API_KEY = ""
    expect(kieKeySet()).toBe(false)
    expect(pickClaudeLane()).toBe("direct")
  })
})

describe("claudeLaneConfigured", () => {
  it("is true with either key and false with neither", () => {
    expect(claudeLaneConfigured()).toBe(true)
    cfg.ANTHROPIC_API_KEY = ""
    expect(claudeLaneConfigured()).toBe(true)
    cfg.KIE_API_KEY = "  "
    expect(claudeLaneConfigured()).toBe(false)
  })
})

describe("localLlmKeySet — any local LLM lane (KIE, Anthropic, Gemini)", () => {
  it("is true with any one key, trimmed, and false when every key is blank", () => {
    cfg.ANTHROPIC_API_KEY = "  "
    cfg.KIE_API_KEY = "\n"
    cfg.GEMINI_API_KEY = " \t "
    expect(localLlmKeySet()).toBe(false)
    expect(geminiKeySet()).toBe(false)
    for (const key of ["KIE_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"] as const) {
      cfg.ANTHROPIC_API_KEY = " "
      cfg.KIE_API_KEY = " "
      cfg.GEMINI_API_KEY = " "
      cfg[key] = "set"
      expect(localLlmKeySet(), key).toBe(true)
    }
    expect(geminiKeySet()).toBe(true)
  })
})

describe("toPlatformExhausted — a refused key", () => {
  const revoked = () =>
    Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, new Headers())

  it("does not latch by default (the general client's rule is unchanged)", () => {
    const typed = toPlatformExhausted(revoked(), { lane: "direct", provider: "anthropic", modelId: "claude-sonnet-5.5" })
    expect(typed).toBeInstanceOf(LlmPlatformExhaustedError)
    expect(directLaneLatch("anthropic")).toBeNull()
  })

  it("latches when the caller asks (latchAuth — pipelines and the Copilot)", () => {
    toPlatformExhausted(revoked(), { lane: "direct", provider: "anthropic", modelId: "claude-sonnet-5.5", latchAuth: true })
    expect(directLaneLatch("anthropic")?.kind).toBe("auth")
  })

  it("never latches the KIE lane, even with latchAuth", () => {
    const kie401 = Object.assign(new Error("KIE.ai messages failed (401): unauthorized"), { status: 401 })
    toPlatformExhausted(kie401, { lane: "kie", provider: "kie", modelId: "claude-sonnet-5.5", latchAuth: true })
    expect(directLaneLatch("kie")).toBeNull()
    expect(directLaneLatch("anthropic")).toBeNull()
  })
})

describe("the router reads the trimmed key", () => {
  it("does not treat a blank key as a direct lane", async () => {
    cfg.ANTHROPIC_API_KEY = "   "
    const fetchMock = vi.fn().mockResolvedValue(new Response("upstream down", { status: 500 }))
    vi.stubGlobal("fetch", fetchMock)
    const { llmComplete } = await import("../llm-client.js")
    await expect(
      llmComplete({
        modelId: "claude-sonnet-4.6",
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        retryStreamOnError: false,
      }),
    ).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Before the change the blank key was truthy, so the KIE failure fell back to the direct SDK.
    expect(createSpy).not.toHaveBeenCalled()
  })
})
