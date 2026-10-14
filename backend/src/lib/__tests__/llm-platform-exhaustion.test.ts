/**
 * The platform-account classifier (lib/llm-platform-exhaustion.ts) — one row
 * per provider shape, and the shapes that must NOT match (a plain rate limit,
 * an ordinary bad request), because a false match hides the real reason
 * behind "out of capacity" and moves the call to another lane.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Anthropic from "@anthropic-ai/sdk"

const editionMock = vi.hoisted(() => ({ credits: true }))
vi.mock("../config.js", () => ({
  config: { NODE_ENV: "test" },
  hasCredits: () => editionMock.credits,
}))

import {
  DIRECT_LANE_LATCH_MS,
  PLATFORM_CAPACITY_MESSAGE,
  __resetPlatformExhaustionAlerts,
  alertPlatformExhaustion,
  directLaneLatch,
  latchDirectLaneExhausted,
  classifyPlatformExhaustion,
  exhaustionSignalOf,
  platformExhaustionMessage,
} from "../llm-platform-exhaustion.js"
import { LlmLaneError, LlmPlatformExhaustedError, toPlatformExhausted } from "../llm-errors.js"
import { userFacingMessage } from "../user-facing-error.js"
import { providerDetailOf } from "../provider-error-detail.js"
import { isRetryableFailure, failureGuidance } from "../mcp/tools/_job-error.js"

/** The staging 2026-10-14 reply, exactly as the SDK builds it. */
const ANTHROPIC_DRAINED_BODY = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
  },
  request_id: "req_011Cg1vRqC6zwPq2Yvfy6NS6",
}
const anthropicDrained = () => Anthropic.APIError.generate(400, ANTHROPIC_DRAINED_BODY, undefined, new Headers())

const kind = (err: unknown) => {
  const s = exhaustionSignalOf(err)
  return s ? classifyPlatformExhaustion(s) : null
}

describe("classifyPlatformExhaustion — per provider shape", () => {
  it("Anthropic: credit balance too low (a 400) is billing", () => {
    expect(kind(anthropicDrained())).toBe("billing")
  })
  it("Anthropic: 401 authentication_error / invalid x-api-key is auth", () => {
    const err = Anthropic.APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, new Headers())
    expect(kind(err)).toBe("auth")
  })
  it("Anthropic: 403 permission_error is auth", () => {
    const err = Anthropic.APIError.generate(403, { type: "error", error: { type: "permission_error", message: "Your API key does not have permission" } }, undefined, new Headers())
    expect(kind(err)).toBe("auth")
  })
  it("OpenAI: 429 insufficient_quota is billing", () => {
    const err = Object.assign(new Error("429 You exceeded your current quota, please check your plan and billing details."), {
      status: 429,
      error: { message: "You exceeded your current quota", type: "insufficient_quota", code: "insufficient_quota" },
    })
    expect(kind(err)).toBe("billing")
  })
  it("OpenAI: invalid_api_key is auth", () => {
    expect(kind(Object.assign(new Error("Incorrect API key provided"), { status: 401, error: { code: "invalid_api_key" } }))).toBe("auth")
  })
  it("Gemini: depleted prepayment (a 429 RESOURCE_EXHAUSTED) is billing", () => {
    const err = Object.assign(
      new Error('{"error":{"code":429,"message":"Your prepayment credits are depleted. Please go to AI Studio to manage your project and billing.","status":"RESOURCE_EXHAUSTED"}}'),
      { status: 429 },
    )
    expect(kind(err)).toBe("billing")
  })
  it("Gemini: API key not valid (a 400 INVALID_ARGUMENT) is auth", () => {
    const err = Object.assign(new Error('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT","details":[{"reason":"API_KEY_INVALID"}]}}'), { status: 400 })
    expect(kind(err)).toBe("auth")
  })
  it("Gemini: 403 PERMISSION_DENIED is auth", () => {
    expect(kind(Object.assign(new Error('{"error":{"code":403,"status":"PERMISSION_DENIED"}}'), { status: 403 }))).toBe("auth")
  })
  it("OpenRouter: 402 requires more credits is billing", () => {
    expect(kind(Object.assign(new Error("This request requires more credits"), { status: 402 }))).toBe("billing")
  })
  it("KIE LLM wire: HTTP 402 and the 200-envelope code 402 are billing", () => {
    expect(kind(new LlmLaneError("KIE.ai messages claude-sonnet-4.6 failed (402): Credits insufficient", { lane: "kie", httpStatus: 402 }))).toBe("billing")
    expect(kind(new LlmLaneError("KIE.ai chat-completions gpt-5.2 failed (code 402): Credits insufficient", { lane: "kie", bodyCode: 402 }))).toBe("billing")
  })
  it("KIE LLM wire: 401 is auth", () => {
    expect(kind(new LlmLaneError("KIE.ai responses gpt-5.4 failed (401): Unauthorized", { lane: "kie", httpStatus: 401 }))).toBe("auth")
  })
})

describe("classifyPlatformExhaustion — must not match", () => {
  it("a plain 429 rate limit (Google words it with 'quota' and 'billing details' too)", () => {
    const err = Object.assign(
      new Error('{"error":{"code":429,"message":"You exceeded your current quota, please check your plan and billing details.","status":"RESOURCE_EXHAUSTED"}}'),
      { status: 429 },
    )
    expect(kind(err)).toBeNull()
    expect(kind(Anthropic.APIError.generate(429, { type: "error", error: { type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" } }, undefined, new Headers()))).toBeNull()
  })
  it("an ordinary bad request, a 5xx, a socket error", () => {
    expect(kind(Anthropic.APIError.generate(400, { type: "error", error: { type: "invalid_request_error", message: "max_tokens: must be less than 64000" } }, undefined, new Headers()))).toBeNull()
    expect(kind(new LlmLaneError("KIE.ai messages x failed (503): unavailable", { lane: "kie", httpStatus: 503 }))).toBeNull()
    expect(kind(new Error("socket hang up"))).toBeNull()
  })
})

describe("toPlatformExhausted → what the user, the operator and MCP see", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    editionMock.credits = true
    __resetPlatformExhaustionAlerts()
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => errorSpy.mockRestore())

  it("re-types the staging reply: capacity sentence for the user, raw reply only in the operator detail", () => {
    const typed = toPlatformExhausted(anthropicDrained(), { lane: "direct", provider: "anthropic", modelId: "claude-sonnet-4.6" })
    expect(typed).toBeInstanceOf(LlmPlatformExhaustedError)
    // Wrapped the way the structured client wraps a failed attempt.
    const wrapped = new Error((typed as Error).message, { cause: typed })
    const shown = userFacingMessage(wrapped, "fallback")
    expect(shown).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect(shown).not.toMatch(/anthropic|req_|billing|400/i)
    expect(providerDetailOf(wrapped)).toContain("credit balance is too low")
    // Even a surface that reads `.message` (a route, a worker, a plugin) shows only the sentence.
    expect((typed as Error).message).toBe(PLATFORM_CAPACITY_MESSAGE)
    expect(wrapped.message).toBe(PLATFORM_CAPACITY_MESSAGE)
  })

  it("alerts the operator once per provider per minute", () => {
    for (let i = 0; i < 3; i++) toPlatformExhausted(anthropicDrained(), { lane: "direct", provider: "anthropic", modelId: "claude-sonnet-4.6" })
    const alerts = errorSpy.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.startsWith("[ALERT]"))
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toContain("anthropic")
    expect(alertPlatformExhaustion({ provider: "anthropic", kind: "billing", lane: "direct", modelId: "m", detail: "x", now: Date.now() + 61_000 })).toBe(true)
  })

  it("leaves every other failure untouched", () => {
    const plain = new Error("socket hang up")
    expect(toPlatformExhausted(plain, { lane: "kie", provider: "kie", modelId: "m" })).toBe(plain)
  })

  it("self-hosted: no credits promise — the operator is told what to check, no vendor named", () => {
    editionMock.credits = false
    const msg = platformExhaustionMessage()
    expect(msg).not.toContain("credits were not charged")
    expect(msg).toContain("Provider keys")
    expect(msg).not.toMatch(/anthropic|openai|google|gemini|kie/i)
  })

  it("MCP reads the capacity sentence as transient, with its own guidance", () => {
    expect(isRetryableFailure(PLATFORM_CAPACITY_MESSAGE)).toBe(true)
    const g = failureGuidance({ error_message: PLATFORM_CAPACITY_MESSAGE })
    expect(g.retryable).toBe(true)
    expect(g.guidance).toContain("refunded")
  })
})

describe("the direct-lane exhaustion latch — skip a drained direct account for a short, self-expiring window", () => {
  beforeEach(() => __resetPlatformExhaustionAlerts())

  it("a direct-lane billing refusal latches that provider for DIRECT_LANE_LATCH_MS, then expires on its own", () => {
    const t0 = 1_000_000
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "credit balance is too low", now: t0 })
    expect(directLaneLatch("anthropic", t0 + 1)).toMatchObject({ kind: "billing", detail: "credit balance is too low" })
    expect(directLaneLatch("anthropic", t0 + DIRECT_LANE_LATCH_MS - 1)).not.toBeNull()
    expect(directLaneLatch("anthropic", t0 + DIRECT_LANE_LATCH_MS)).toBeNull()
    // Per provider: a drained Anthropic account says nothing about Google's.
    expect(directLaneLatch("google", t0 + 1)).toBeNull()
  })

  it("the window is a few minutes at most, so a topped-up account is never hidden for long", () => {
    expect(DIRECT_LANE_LATCH_MS).toBeGreaterThanOrEqual(60_000)
    expect(DIRECT_LANE_LATCH_MS).toBeLessThanOrEqual(5 * 60_000)
  })

  it("a refusal seen again re-arms from that moment (the window runs from the LAST observation)", () => {
    const t0 = 1_000_000
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "a", now: t0 })
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "b", now: t0 + DIRECT_LANE_LATCH_MS - 10 })
    expect(directLaneLatch("anthropic", t0 + DIRECT_LANE_LATCH_MS + 10)).toMatchObject({ detail: "b" })
  })

  it("toPlatformExhausted latches a DIRECT billing refusal only — never the KIE lane, never a refused key", () => {
    const now = Date.now()
    toPlatformExhausted(Anthropic.APIError.generate(400, ANTHROPIC_DRAINED_BODY, undefined, new Headers()), { lane: "kie", provider: "kie", modelId: "m" })
    expect(directLaneLatch("kie", now)).toBeNull()
    // 401/403 ride the same classifier but can be a transient permission blip (the 2026-08-14 Gemini 403):
    // a key refusal keeps asking the direct lane every call, exactly as before.
    toPlatformExhausted(Object.assign(new Error("API key not valid"), { status: 403 }), { lane: "direct", provider: "google", modelId: "m" })
    expect(directLaneLatch("google", now)).toBeNull()
    toPlatformExhausted(Anthropic.APIError.generate(400, ANTHROPIC_DRAINED_BODY, undefined, new Headers()), { lane: "direct", provider: "anthropic", modelId: "m" })
    expect(directLaneLatch("anthropic", Date.now())).toMatchObject({ kind: "billing" })
  })

  it("the test reset clears the latch too, so no test inherits another's drained account", () => {
    latchDirectLaneExhausted({ provider: "anthropic", kind: "billing", detail: "x" })
    __resetPlatformExhaustionAlerts()
    expect(directLaneLatch("anthropic")).toBeNull()
  })
})
