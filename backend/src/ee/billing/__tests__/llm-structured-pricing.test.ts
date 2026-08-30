/**
 * `llm-structured` (POST /v1/llm/structured) bills under its OWN feature id
 * rather than reusing `llm-chat`: its system prompt is a rendered catalog
 * legend (~12-18k tokens), several times a chat turn, so one shared row would
 * misprice one of the two. Three tier rows, the describe-to-picker precedent.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildLlmCreditIdentifier } from "@nodaro/shared"
import { STATIC_CREDIT_COSTS } from "../credits.js"

// backend/src/ee/billing/__tests__/ → up 5 → repo root
const MIGRATION = join(
  __dirname, "..", "..", "..", "..", "..",
  "supabase/migrations/358_llm_structured_pricing.sql",
)

const TIER_IDS = ["llm-structured", "llm-structured:economy", "llm-structured:premium"] as const

describe("llm-structured pricing", () => {
  it.each(TIER_IDS)("%s is in STATIC_CREDIT_COSTS at describe-to-picker parity", (id) => {
    expect(STATIC_CREDIT_COSTS[id]).toBe(10)
  })

  it("migration 358 seeds every tier row idempotently", () => {
    const sql = readFileSync(MIGRATION, "utf8")
    for (const id of TIER_IDS) expect(sql, id).toContain(`'${id}'`)
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*model_identifier\s*\)\s*DO\s+NOTHING/i)
  })

  it("every model the route can run resolves onto one of the three rows", () => {
    // economy default (LLM_FEATURE_DEFAULTS["llm-chat"]), a standard model,
    // and the two the studio dialog offers.
    expect(buildLlmCreditIdentifier("llm-structured", "gemini-3.6-flash")).toBe("llm-structured:economy")
    expect(buildLlmCreditIdentifier("llm-structured", "grok-4.6")).toBe("llm-structured")
    expect(buildLlmCreditIdentifier("llm-structured", "claude-fable-5")).toBe("llm-structured:premium")
    expect(buildLlmCreditIdentifier("llm-structured", "gpt-5.6-sol")).toBe("llm-structured:premium")
  })
})
