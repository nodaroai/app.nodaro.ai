import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { LLM_MODELS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier } from "@nodaro/shared"
import {
  STATIC_CREDIT_COSTS,
  LLM_DIRECT_RUNG_FEATURES,
  NO_DIRECT_RUNG,
  LLM_PREMIUM_DIRECT_MULTIPLIER,
  llmTierPricedFeatures,
} from "../credits.js"

const MIGRATION = readFileSync(
  join(__dirname, "../../../../../supabase/migrations/490_llm_premium_direct_rung.sql"),
  "utf8",
)

const excluded = (feature: string) =>
  NO_DIRECT_RUNG.some((entry) => (entry.endsWith(":") ? feature.startsWith(entry) : feature === entry))

describe("premium-direct rung (decided 2026-10-08)", () => {
  it("every tier-priced feature is either given the rung or excluded with a reason", () => {
    const undecided = llmTierPricedFeatures().filter((f) => !LLM_DIRECT_RUNG_FEATURES.includes(f) && !excluded(f))
    expect(undecided, "add each to LLM_DIRECT_RUNG_FEATURES or NO_DIRECT_RUNG in credits.ts").toEqual([])
  })

  it("prices every rung at CEIL(premium × multiplier)", () => {
    for (const f of LLM_DIRECT_RUNG_FEATURES) {
      expect(STATIC_CREDIT_COSTS[`${f}:premium-direct`], f).toBe(
        Math.ceil(STATIC_CREDIT_COSTS[`${f}:premium`]! * LLM_PREMIUM_DIRECT_MULTIPLIER),
      )
    }
  })

  it("migration 490 seeds every rung at the same value, and only those", () => {
    const seeded = [...MIGRATION.matchAll(/\('([^']+):premium-direct', (\d+), true/g)].map((m) => [m[1], Number(m[2])])
    expect(Object.fromEntries(seeded)).toEqual(
      Object.fromEntries(LLM_DIRECT_RUNG_FEATURES.map((f) => [f, STATIC_CREDIT_COSTS[`${f}:premium-direct`]])),
    )
  })

  it("every id the LLM credit builder can produce for these features is priced (no 503 price_not_configured)", () => {
    const missing = new Set<string>()
    for (const feature of LLM_DIRECT_RUNG_FEATURES) {
      for (const model of LLM_MODELS) {
        for (const effort of [undefined, ...LLM_REASONING_EFFORTS]) {
          for (const advanced of [false, true]) {
            const id = buildLlmCreditIdentifier(feature, model.id, effort, advanced)
            if (!(id in STATIC_CREDIT_COSTS)) missing.add(id)
          }
        }
      }
    }
    expect([...missing]).toEqual([])
  })

  it("the Copilot's metered ceilings get no rung", () => {
    expect(STATIC_CREDIT_COSTS["workflow-copilot:premium-direct"]).toBeUndefined()
  })
})
