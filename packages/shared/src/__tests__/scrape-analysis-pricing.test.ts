import { describe, it, expect } from "vitest"
import { scrapeAnalysisPriceParts, scrapeAnalysisQuoteId, SCRAPE_ANALYSIS_FEATURE } from "../scrape-analysis-pricing.js"
import { buildMetaAdsScrapeCreditId, META_ADS_SCRAPE_MAX_COUNT } from "../meta-ads-scrape.js"
import { buildInstagramScrapeCreditId, INSTAGRAM_SCRAPE_MAX_COUNT } from "../instagram-scrape.js"
import { LLM_FEATURE_DEFAULTS } from "../llm-models.js"
import { resolveScriptModelId, SCRIPT_LEGACY_PROVIDER_MODELS } from "../script-model.js"

describe("scrapeAnalysisPriceParts — a scrape's analysis billed per call", () => {
  it("no analysis, or another node: null", () => {
    expect(scrapeAnalysisPriceParts({ type: "meta-ads-scrape", data: { count: 10 } })).toBeNull()
    expect(scrapeAnalysisPriceParts({ type: "llm-chat", data: { analyze: true } })).toBeNull()
  })
  it("Meta Ads: its fixed scrape (no analysis suffix), the analysis model, count × sources items (clamped)", () => {
    expect(scrapeAnalysisPriceParts({ type: "meta-ads-scrape", data: { count: 10, analyze: true } })).toEqual({
      fixedId: buildMetaAdsScrapeCreditId({ count: 10, sources: 1 }),
      analysisModel: LLM_FEATURE_DEFAULTS[SCRAPE_ANALYSIS_FEATURE],
      items: 10,
    })
    expect(scrapeAnalysisPriceParts({ type: "meta-ads-scrape", data: { count: 9999, analyze: true, analysisModel: "claude-opus-5.5" } })).toMatchObject({ analysisModel: "claude-opus-5.5", items: META_ADS_SCRAPE_MAX_COUNT })
  })
  it("Instagram: the count the route accepts × the targets", () => {
    const parts = scrapeAnalysisPriceParts({ type: "instagram-scrape", data: { count: 500, analyze: true, mode: "profile", targets: "a\nb" } })
    expect(parts).toEqual({ fixedId: buildInstagramScrapeCreditId({ count: INSTAGRAM_SCRAPE_MAX_COUNT, sources: 2 }), analysisModel: LLM_FEATURE_DEFAULTS[SCRAPE_ANALYSIS_FEATURE], items: INSTAGRAM_SCRAPE_MAX_COUNT * 2 })
  })
})

describe("scrapeAnalysisQuoteId — the whole analysis as one price id", () => {
  it("is the analysis model's metered key as a `<key>:<items>u` quote", () => {
    const parts = scrapeAnalysisPriceParts({ type: "meta-ads-scrape", data: { count: 10, analyze: true, analysisModel: "claude-opus-5.5" } })!
    expect(scrapeAnalysisQuoteId(parts)).toBe(`${SCRAPE_ANALYSIS_FEATURE}:claude-opus-5.5:10u`)
  })
})

describe("resolveScriptModelId — the model a Generate Script call runs on", () => {
  it("an explicit model, else a legacy provider's, else the default", () => {
    expect(resolveScriptModelId("claude", "gpt-5.2")).toBe("gpt-5.2")
    expect(resolveScriptModelId("claude")).toBe(SCRIPT_LEGACY_PROVIDER_MODELS.claude)
    expect(resolveScriptModelId()).toBe(LLM_FEATURE_DEFAULTS["generate-script"])
    expect(resolveScriptModelId("toString")).toBe(LLM_FEATURE_DEFAULTS["generate-script"])
  })
})
