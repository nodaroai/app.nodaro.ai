import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { LLM_MODELS, LLM_REASONING_EFFORTS, buildLlmCreditIdentifier, resolveLlmCreditId } from "@nodaro/shared/llm-models"
import {
  META_ADS_ANALYSIS_CREDITS_PER_AD,
  META_ADS_SCRAPE_TIERS,
  INSTAGRAM_SCRAPE_TIERS,
  buildMetaAdsScrapeCreditId,
  buildInstagramScrapeCreditId,
  metaAdsAnalysisTier,
  metaAdsAnalysisCreditId,
  instagramAnalysisCreditId,
} from "@nodaro/shared/social"
import {
  STATIC_CREDIT_COSTS,
  LLM_DIRECT_RUNG_FEATURES,
  LLM_PREMIUM_DIRECT_EXPLICIT,
  NO_DIRECT_RUNG,
  LLM_PREMIUM_DIRECT_MULTIPLIER,
  llmTierPricedFeatures,
  CreditsService,
} from "../credits.js"

const MIGRATIONS_DIR = join(__dirname, "../../../../../supabase/migrations")
const MIGRATION = readFileSync(join(MIGRATIONS_DIR, "490_llm_premium_direct_rung.sql"), "utf8")

const excluded = (feature: string) =>
  NO_DIRECT_RUNG.some((entry) => (entry.endsWith(":") ? feature.startsWith(entry) : feature === entry))
/** The features whose rung is derived from their premium row (every one not stated explicitly). */
const derived = LLM_DIRECT_RUNG_FEATURES.filter((f) => !(f in LLM_PREMIUM_DIRECT_EXPLICIT))

describe("premium-direct rung (decided 2026-10-08)", () => {
  it("every tier-priced feature is either given the rung or excluded with a reason", () => {
    const undecided = llmTierPricedFeatures().filter((f) => !LLM_DIRECT_RUNG_FEATURES.includes(f) && !excluded(f))
    expect(undecided, "add each to LLM_DIRECT_RUNG_FEATURES or NO_DIRECT_RUNG in credits.ts").toEqual([])
  })

  it("prices every derived rung at CEIL(premium × multiplier)", () => {
    for (const f of derived) {
      expect(STATIC_CREDIT_COSTS[`${f}:premium-direct`], f).toBe(
        Math.ceil(STATIC_CREDIT_COSTS[`${f}:premium`]! * LLM_PREMIUM_DIRECT_MULTIPLIER),
      )
    }
  })

  it("migration 490 seeds every derived rung at the same value, and only rung features (a feature added since states its own row)", () => {
    const seeded = [...MIGRATION.matchAll(/\('([^']+):premium-direct', (\d+), true/g)].map((m) => [m[1], Number(m[2])] as const)
    for (const [f] of seeded) expect(LLM_DIRECT_RUNG_FEATURES, f).toContain(f)
    expect(Object.fromEntries(seeded.filter(([f]) => derived.includes(f)))).toEqual(
      Object.fromEntries(derived.map((f) => [f, STATIC_CREDIT_COSTS[`${f}:premium-direct`]])),
    )
  })

  // A stated rung is a decision with a cost basis, not a rule: it must be a
  // rung feature, must NOT sit at the derived value (or the entry is noise),
  // and its migration must state the static row's value, so the row cannot be
  // changed in code alone.
  it("every explicitly priced rung is a rung feature, differs from the derivation, and is stated by its migration", () => {
    for (const [f, { migration, reason }] of Object.entries(LLM_PREMIUM_DIRECT_EXPLICIT)) {
      expect(LLM_DIRECT_RUNG_FEATURES, f).toContain(f)
      expect(reason.length, f).toBeGreaterThan(0)
      const stated = STATIC_CREDIT_COSTS[`${f}:premium-direct`]!
      expect(stated, f).not.toBe(Math.ceil(STATIC_CREDIT_COSTS[`${f}:premium`]! * LLM_PREMIUM_DIRECT_MULTIPLIER))
      const sql = readFileSync(join(MIGRATIONS_DIR, migration), "utf8")
      const id = `${f}:premium-direct`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      // An UPDATE of an existing row, or a seed tuple for a new id — either states the value.
      expect(sql, `${migration} must set ${f}:premium-direct to ${stated}`).toMatch(
        new RegExp(`credit_cost\\s*=\\s*${stated}\\s+WHERE\\s+model_identifier\\s*=\\s*'${id}'|\\('${id}',\\s*${stated},\\s*true`),
      )
    }
  })

  it("the legend-sized reads' rungs are stated by migration 546 (decided 2026-10-20)", () => {
    for (const f of ["describe-to-picker", "llm-structured", "text-to-picker"]) {
      expect(LLM_PREMIUM_DIRECT_EXPLICIT[f]?.migration, f).toBe("546_describe_to_picker_reprice.sql")
    }
    expect(STATIC_CREDIT_COSTS["describe-to-picker:premium-direct"]).toBe(136)
    expect(STATIC_CREDIT_COSTS["llm-structured:premium-direct"]).toBe(136)
    expect(STATIC_CREDIT_COSTS["text-to-picker:premium-direct"]).toBe(200)
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

describe("a directOnly model bills premium-direct on every path (gemini-4-argon, 2026-10-17)", () => {
  // It runs on Google's own API and nowhere else, so the charge must sit on the
  // rung priced for that lane — whatever the effort, Advanced or not.
  it("the guard, the route's reservation id and the workflow estimate agree on premium-direct", () => {
    for (const effort of [undefined, ...LLM_REASONING_EFFORTS]) {
      for (const advancedMode of [false, true]) {
        const body = { llmModel: "gemini-4-argon", reasoningEffort: effort, advancedMode }
        expect(resolveLlmCreditId("llm-chat", body), `guard ${effort} ${advancedMode}`).toBe("llm-chat:premium-direct")
        expect(buildLlmCreditIdentifier("llm-chat", "gemini-4-argon", effort, advancedMode)).toBe("llm-chat:premium-direct")
        expect(CreditsService.estimateWorkflowBaseCredits([{ type: "llm-chat", data: body }]))
          .toBe(STATIC_CREDIT_COSTS["llm-chat:premium-direct"])
      }
    }
  })

  it("describe-to-picker quotes it on premium-direct too (it reaches the picker as a structured vision model)", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([{ type: "describe-to-picker", data: { llmModel: "gemini-4-argon" } }]))
      .toBe(STATIC_CREDIT_COSTS["describe-to-picker:premium-direct"])
  })
})

// The 200 / 500 tiers are reachable only through several sources (count caps at 100).
const tierInput = (t: number) => ({ count: Math.min(t, 100), sources: t / Math.min(t, 100) })

describe("the social scrapers' per-post analysis has a direct rung too (decided 2026-10-17)", () => {
  it("prices its premium-direct per post by the same rule as every LLM feature's: CEIL(premium × multiplier)", () => {
    expect(META_ADS_ANALYSIS_CREDITS_PER_AD["premium-direct"]).toBe(
      Math.ceil(META_ADS_ANALYSIS_CREDITS_PER_AD.premium * LLM_PREMIUM_DIRECT_MULTIPLIER),
    )
    expect(STATIC_CREDIT_COSTS[metaAdsAnalysisCreditId("premium-direct")]).toBe(META_ADS_ANALYSIS_CREDITS_PER_AD["premium-direct"])
    expect(STATIC_CREDIT_COSTS[instagramAnalysisCreditId("premium-direct")]).toBe(META_ADS_ANALYSIS_CREDITS_PER_AD["premium-direct"])
  })

  it("a directOnly model is quoted, reserved and settled on premium-direct", () => {
    expect(metaAdsAnalysisTier("gemini-4-argon")).toBe("premium-direct")
    for (const t of META_ADS_SCRAPE_TIERS) {
      const id = buildMetaAdsScrapeCreditId({ ...tierInput(t), analysis: metaAdsAnalysisTier("gemini-4-argon") })
      expect(id).toBe(`meta-ads-scrape:${t}:analysis:premium-direct`)
      expect(STATIC_CREDIT_COSTS[id], id).toBe(t * (1 + META_ADS_ANALYSIS_CREDITS_PER_AD["premium-direct"]))
    }
    for (const t of INSTAGRAM_SCRAPE_TIERS) {
      const id = buildInstagramScrapeCreditId({ ...tierInput(t), analysis: metaAdsAnalysisTier("gemini-4-argon") })
      expect(STATIC_CREDIT_COSTS[id], id).toBe(t * (1 + META_ADS_ANALYSIS_CREDITS_PER_AD["premium-direct"]))
    }
  })

  it("every model NOT served direct keeps exactly the id and price it had: its plain tier", () => {
    for (const m of LLM_MODELS.filter((x) => !x.directOnly)) {
      expect(metaAdsAnalysisTier(m.id), m.id).toBe(m.tier)
      for (const t of META_ADS_SCRAPE_TIERS) {
        const suffix = m.tier === "standard" ? ":analysis" : `:analysis:${m.tier}`
        const id = buildMetaAdsScrapeCreditId({ ...tierInput(t), analysis: metaAdsAnalysisTier(m.id) })
        expect(id).toBe(`meta-ads-scrape:${t}${suffix}`)
        expect(STATIC_CREDIT_COSTS[id], id).toBe(t * (1 + { economy: 1, standard: 3, premium: 4 }[m.tier]))
      }
    }
  })
})
