/**
 * The model ladder's invariants — the three places a tier can silently rot:
 * a creditId with no price row (503 at reservation), a registryId the pricing
 * table cannot cost (a turn billed at zero), and an effort the model does not
 * declare (an API error on every turn of that tier).
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { LLM_MODELS } from "@nodaro/shared"
import { COPILOT_TIERS, DEFAULT_COPILOT_TIER, resolveCopilotTier, type CopilotModelTier } from "../constants.js"
import { STATIC_CREDIT_COSTS } from "../../billing/credits.js"

const TIERS = Object.keys(COPILOT_TIERS) as CopilotModelTier[]

describe("the copilot model ladder", () => {
  it("every tier's creditId has a static price — the reservation can never 503", () => {
    for (const tier of TIERS) {
      const { creditId } = COPILOT_TIERS[tier]
      expect(STATIC_CREDIT_COSTS[creditId], `${tier} → ${creditId}`).toBeGreaterThan(0)
    }
  })

  it("every tier's registryId is a real LLM_MODELS entry whose direct id matches anthropicModelId", () => {
    for (const tier of TIERS) {
      const spec = COPILOT_TIERS[tier]
      const model = LLM_MODELS.find((m) => m.id === spec.registryId)
      expect(model, `${tier} → ${spec.registryId}`).toBeTruthy()
      expect(model!.directFallbackModel, `${tier} API id`).toBe(spec.anthropicModelId)
    }
  })

  it("a tier carries an effort ONLY when its model declares it — Haiku gets none", () => {
    for (const tier of TIERS) {
      const spec = COPILOT_TIERS[tier]
      const declared = LLM_MODELS.find((m) => m.id === spec.registryId)?.reasoningEfforts
      if (spec.reasoningEffort) {
        expect(declared, `${tier} declares efforts`).toContain(spec.reasoningEffort)
      } else {
        expect(declared ?? undefined, `${tier} must not need an effort`).toBeUndefined()
      }
    }
  })

  it("resolveCopilotTier fails closed to standard on anything unknown", () => {
    expect(resolveCopilotTier("premium")).toBe("premium")
    expect(resolveCopilotTier("economy")).toBe("economy")
    for (const junk of ["deep", "", null, undefined, 3, "STANDARD", {}]) {
      expect(resolveCopilotTier(junk)).toBe(DEFAULT_COPILOT_TIER)
    }
  })
})

describe("migration 344", () => {
  const sql = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../supabase/migrations/344_copilot_model_tier.sql"),
    "utf-8",
  )

  it("constrains the column to the ladder and defaults to standard", () => {
    expect(sql).toMatch(/model_tier text NOT NULL DEFAULT 'standard'/)
    expect(sql).toMatch(/CHECK \(model_tier IN \('economy', 'standard', 'premium'\)\)/)
  })

  it("seeds BOTH non-default reservation rows — the DB half of the hard-fail pair", () => {
    expect(sql).toContain("'workflow-copilot:economy'")
    expect(sql).toContain("'workflow-copilot:premium'")
    expect(sql).toContain("ON CONFLICT (model_identifier) DO NOTHING")
  })
})
