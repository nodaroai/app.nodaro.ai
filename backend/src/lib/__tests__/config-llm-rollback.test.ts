import { afterEach, describe, expect, it, vi } from "vitest"
import { config, envSchema, llmMeteredPricing, type Edition } from "../config.js"
import {
  LLM_SCHEMA_PROBE_TIMEOUT_MS,
  probeLlmMeteredSchemaNow,
  registerLlmMeteredSchemaClient,
  setLlmMeteredSchemaReadyForTesting,
} from "../llm-metered-schema-gate.js"

// The helpers read `config` at call time off the (mutable) singleton, so the
// real implementation is exercised by swapping fields on it and restoring them
// (the pattern config.multiuser.test.ts explains).
const originalEdition = config.EDITION
const originalRollback = config.LLM_TIER_PRICING_ROLLBACK

afterEach(() => {
  config.EDITION = originalEdition
  config.LLM_TIER_PRICING_ROLLBACK = originalRollback
  setLlmMeteredSchemaReadyForTesting(undefined)
})

function metered(edition: Edition, rollback: boolean): boolean {
  setLlmMeteredSchemaReadyForTesting(true)
  config.EDITION = edition
  config.LLM_TIER_PRICING_ROLLBACK = rollback
  return llmMeteredPricing()
}

describe("LLM_TIER_PRICING_ROLLBACK", () => {
  it("rollback env parses: only \"true\" and \"1\" roll back", () => {
    const schema = envSchema.shape.LLM_TIER_PRICING_ROLLBACK
    expect(schema.parse("true")).toBe(true)
    expect(schema.parse("1")).toBe(true)
    expect(schema.parse(undefined)).toBe(false)
    for (const value of ["yes", "false", "0", "", "TRUE"]) expect(schema.parse(value)).toBe(false)
  })

  it("metered pricing is the default on Cloud, and off under the rollback", () => {
    expect(metered("cloud", false)).toBe(true)
    expect(metered("cloud", true)).toBe(false)
  })

  it("is never metered without credits (hasCredits() false)", () => {
    for (const edition of ["community", "business"] as const) {
      expect(metered(edition, false)).toBe(false)
      expect(metered(edition, true)).toBe(false)
    }
  })
})

describe("R33 — metered pricing waits for its schema (551 + 552 + 554)", () => {
  function cloud(): void {
    config.EDITION = "cloud"
    config.LLM_TIER_PRICING_ROLLBACK = false
  }

  it("schema not confirmed → the tier path, exactly as under the rollback", () => {
    cloud()
    setLlmMeteredSchemaReadyForTesting(undefined)
    expect(llmMeteredPricing()).toBe(false)
    setLlmMeteredSchemaReadyForTesting(false)
    expect(llmMeteredPricing()).toBe(false)
  })

  it("schema confirmed → metered", () => {
    cloud()
    setLlmMeteredSchemaReadyForTesting(true)
    expect(llmMeteredPricing()).toBe(true)
  })

  it("a probe that finds the schema turns metering on, and a probe that does not leaves it off", async () => {
    cloud()
    vi.spyOn(console, "log").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    setLlmMeteredSchemaReadyForTesting(undefined, async () => false)
    expect(await probeLlmMeteredSchemaNow()).toBe(false)
    expect(llmMeteredPricing()).toBe(false)
    setLlmMeteredSchemaReadyForTesting(undefined, async () => true)
    expect(await probeLlmMeteredSchemaNow()).toBe(true)
    expect(llmMeteredPricing()).toBe(true)
  })

  it("a probe ERROR is not ready — the safe, earlier path", async () => {
    cloud()
    vi.spyOn(console, "warn").mockImplementation(() => {})
    setLlmMeteredSchemaReadyForTesting(undefined, async () => {
      throw new Error("connection refused")
    })
    expect(await probeLlmMeteredSchemaNow()).toBe(false)
    expect(llmMeteredPricing()).toBe(false)
  })

  it("a probe that HANGS is not ready after ~10 s, and frees the gate to ask again", async () => {
    cloud()
    vi.useFakeTimers()
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      setLlmMeteredSchemaReadyForTesting(undefined, () => new Promise<boolean>(() => {}))
      const answer = probeLlmMeteredSchemaNow()
      await vi.advanceTimersByTimeAsync(LLM_SCHEMA_PROBE_TIMEOUT_MS)
      expect(await answer).toBe(false)
      expect(llmMeteredPricing()).toBe(false)
      expect(warn.mock.calls.some((c) => /timed out/.test(String(c[0])))).toBe(true)
      // The in-flight slot was released: a later probe runs and can turn metering on.
      vi.spyOn(console, "log").mockImplementation(() => {})
      setLlmMeteredSchemaReadyForTesting(undefined, async () => true)
      expect(await probeLlmMeteredSchemaNow()).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("probes with the client lib/supabase.ts registers (no override)", async () => {
    cloud()
    vi.spyOn(console, "log").mockImplementation(() => {})
    // 551's refusal, and 554's (the side-hold reserve).
    const rpc = vi.fn(async (fn: string) => ({ data: null, error: { message: fn === "reserve_llm_side_hold" ? "SIDE_HOLD_INVALID" : "METERED_ACTUAL_REQUIRED" } }))
    const from = vi.fn(() => ({ select: () => ({ limit: async () => ({ data: [], error: null }) }) }))
    registerLlmMeteredSchemaClient({ rpc, from } as never)
    setLlmMeteredSchemaReadyForTesting(undefined)
    expect(await probeLlmMeteredSchemaNow()).toBe(true)
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(llmMeteredPricing()).toBe(true)
  })

  it("never asks the gate without credits, nor under the rollback", () => {
    setLlmMeteredSchemaReadyForTesting(true)
    config.EDITION = "community"
    expect(llmMeteredPricing()).toBe(false)
    cloud()
    config.LLM_TIER_PRICING_ROLLBACK = true
    expect(llmMeteredPricing()).toBe(false)
  })
})

