/**
 * Advanced mode's shared route seam.
 *
 * The advanced-OFF path is the one that matters most here: it must be
 * byte-identical to what the routes sent before the feature existed, or a
 * stored `temperature` on a structured-JSON node silently degrades its output.
 */
import { describe, it, expect, vi } from "vitest"
// Both direct keys configured: whether an install HOLDS the key is its own case
// (llm-advanced-mode-keys.test.ts) — CI runs with neither, so state them here.
vi.mock("../config.js", () => ({ config: { GEMINI_API_KEY: "test-gemini", ANTHROPIC_API_KEY: "test-anthropic" } }))
import { LLM_ADVANCED_SHAPE, advancedModeError, resolveLlmParams } from "../llm-advanced-mode.js"
import { z } from "zod"

describe("LLM_ADVANCED_SHAPE", () => {
  const schema = z.object({ ...LLM_ADVANCED_SHAPE })

  it("parses a body that omits every field (older clients unchanged)", () => {
    const r = schema.safeParse({})
    expect(r.success).toBe(true)
    expect(r.success && r.data).toEqual({})
  })

  it("accepts the full set", () => {
    const r = schema.safeParse({ advancedMode: true, temperature: 1.2, maxTokens: 4096 })
    expect(r.success && r.data).toEqual({ advancedMode: true, temperature: 1.2, maxTokens: 4096 })
  })

  it("rejects out-of-range values rather than clamping them", () => {
    expect(schema.safeParse({ temperature: 2.5 }).success).toBe(false)
    expect(schema.safeParse({ maxTokens: 0 }).success).toBe(false)
    expect(schema.safeParse({ maxTokens: 40_000 }).success).toBe(false)
    expect(schema.safeParse({ maxTokens: 1024.5 }).success).toBe(false)
  })
})

describe("advancedModeError", () => {
  it("passes when advanced is off, whatever the model", () => {
    expect(advancedModeError({}, "gpt-5.2")).toBeNull()
    expect(advancedModeError({ advancedMode: false }, "claude-opus-4.7")).toBeNull()
  })

  it("passes for a model with a direct Gemini lane", () => {
    expect(advancedModeError({ advancedMode: true }, "gemini-3.6-flash")).toBeNull()
    expect(advancedModeError({ advancedMode: true }, "gemini-3.1-pro")).toBeNull()
  })

  it("rejects a model with no direct lane, using the shared reason string", () => {
    const err = advancedModeError({ advancedMode: true }, "gpt-5.2")
    expect(err?.code).toBe("advanced_mode_unsupported")
    expect(err?.message).toMatch(/Gemini/)
  })

  it("rejects an undefined model rather than letting it through", () => {
    expect(advancedModeError({ advancedMode: true }, undefined)?.code).toBe("advanced_mode_unsupported")
  })
})

describe("resolveLlmParams", () => {
  it("advanced OFF returns the route's defaults verbatim and pins no lane", () => {
    expect(resolveLlmParams({}, { temperature: 0.3, maxTokens: 2048 }))
      .toEqual({ temperature: 0.3, maxTokens: 2048 })
  })

  it("advanced OFF IGNORES caller-supplied sampling values", () => {
    // The load-bearing case: a stored temperature must not reach a structured
    // node that never exposed the control.
    expect(resolveLlmParams({ temperature: 1.9, maxTokens: 32768 }, { temperature: 0.3, maxTokens: 2048 }))
      .toEqual({ temperature: 0.3, maxTokens: 2048 })
  })

  it("advanced ON pins the direct lane and honours caller values", () => {
    expect(resolveLlmParams({ advancedMode: true, temperature: 1.5, maxTokens: 8192 }, { temperature: 0.3, maxTokens: 2048 }))
      .toEqual({ requireLane: "direct", temperature: 1.5, maxTokens: 8192 })
  })

  it("advanced ON with untouched sliders changes only the lane", () => {
    expect(resolveLlmParams({ advancedMode: true }, { temperature: 0.3, maxTokens: 2048 }))
      .toEqual({ requireLane: "direct", temperature: 0.3, maxTokens: 2048 })
  })

  it("handles a route that has no defaults at all", () => {
    expect(resolveLlmParams({})).toEqual({ temperature: undefined, maxTokens: undefined })
    expect(resolveLlmParams({ advancedMode: true }))
      .toEqual({ requireLane: "direct", temperature: undefined, maxTokens: undefined })
  })

  it("temperature 0 survives — it is a real value, not a missing one", () => {
    expect(resolveLlmParams({ advancedMode: true, temperature: 0 }, { temperature: 0.7 }).temperature).toBe(0)
  })
})
