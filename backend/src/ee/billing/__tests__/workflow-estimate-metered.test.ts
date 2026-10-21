// @test-watches backend/src/lib/tutorial-seed/templates/*.json
// @test-units-by-name prices the metered LLM node types it names (llm-chat, video-composer, describe-to-picker, after-effects, lottie-overlay, 3d-title, generate-script, qa-check, image-to-text, image-critic, motion-graphics, generate-3d-scene, edit-3d-scene, reduce, meta-ads-scrape, instagram-scrape) and fixed ones (extract-audio)
/**
 * Server estimates of a workflow price every metered LLM node per model
 * (plan v2 Task 12, spec §8.5): the node's price key `<feature>:<model>[:direct]`
 * (`llmPriceKey`), which the charged price table answers with the model's
 * typical-usage estimate. A workflow's total is the sum of those estimates and
 * the fixed prices (never a ceiling), flagged an estimate when any line is one.
 * Under the rollback (`LLM_TIER_PRICING_ROLLBACK`) every figure is today's tier
 * figure, byte for byte, and nothing is flagged.
 *
 * The real switch is exercised: the R33 schema gate pinned ready, the rollback
 * read from `config`. The price table is the real one over an empty
 * `model_pricing` at a 10% markup — the figures are Task 5/6's: Opus 5.5 on
 * llm-chat is 5 base → 6 charged; Extract Audio 10 → 11.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { llmPriceKey, LLM_FEATURE_DEFAULTS, buildLlmCreditIdentifier } from "@nodaro/shared/llm-models"
import { scrapeAnalysisPriceParts, scrapeAnalysisQuoteId } from "@nodaro/shared/social"

vi.mock("@/lib/supabase.js", () => {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    in: () => query,
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    range: async () => ({ data: [], error: null }),
  }
  return { supabase: { from: () => query } }
})
// A model is made unpriced by withholding its rates (the state the rate-coverage guard keeps out of production).
const unpriced = vi.hoisted(() => new Set<string>())
vi.mock("@/lib/pricing/llm-cost.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/pricing/llm-cost.js")>()
  return { ...actual, hasLlmRate: (modelId: string, lane: never) => !unpriced.has(modelId) && actual.hasLlmRate(modelId, lane) }
})
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => ({ cost_markup_percent: 10, service_margin_percent: {} }),
}))

import { config, llmMeteredPricing } from "../../../lib/config.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../../lib/llm-metered-schema-gate.js"
import {
  CreditsService,
  STATIC_CREDIT_COSTS,
  chargedCredits,
  chargedPriceTableFrom,
  estimateWorkflowCredits,
  estimateWorkflowCreditsDetailed,
  estimateWorkflowListingCredits,
  getNodeModelIdentifier,
  meteredLlmKeyOfNode,
  unpricedMeteredLlmOfRun,
  meteredLlmQuote,
  isMeteredLlmQuoteId,
  type EstimateNode,
} from "../credits.js"

const rollback = (on: boolean) => {
  ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = on
}

beforeEach(() => {
  setLlmMeteredSchemaReadyForTesting(true)
  rollback(false)
  unpriced.clear()
})
afterAll(() => {
  setLlmMeteredSchemaReadyForTesting(undefined)
  rollback(false)
})

/** The figure the charged table (10% markup) quotes for an id. */
const charged = (id: string, units = 1) => chargedCredits(chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never), id, units)

const OPUS_CHAT: EstimateNode = { id: "chat", type: "llm-chat", data: { llmModel: "claude-opus-5.5" } }
const AUDIO: EstimateNode = { id: "audio", type: "extract-audio", data: {} }

describe("metered: a workflow estimate prices LLM nodes per model", () => {
  beforeEach(() => {
    expect(llmMeteredPricing(), "the metered path is the one under test").toBe(true)
  })

  it("a workflow with one llm-chat (Opus 5.5) node and one fixed node is an estimate: 6 + fixed", async () => {
    expect(STATIC_CREDIT_COSTS["extract-audio"]).toBe(10)
    const detailed = await estimateWorkflowCreditsDetailed([OPUS_CHAT, AUDIO], [])
    expect(detailed).toEqual({
      credits: 6 + 11,
      estimate: true,
      perNode: { chat: { credits: 6, estimate: true }, audio: { credits: 11, estimate: false } },
    })
    // The number-only estimate every other caller reads is the same total.
    expect(await estimateWorkflowCredits([OPUS_CHAT, AUDIO], [])).toBe(17)
  })

  it("a workflow of fixed nodes only is not an estimate", async () => {
    const detailed = await estimateWorkflowCreditsDetailed([AUDIO], [])
    expect(detailed).toEqual({ credits: 11, estimate: false, perNode: { audio: { credits: 11, estimate: false } } })
  })

  it("a Component whose published price holds an LLM estimate (its stored flag) makes the line, and the total, an estimate", async () => {
    const component: EstimateNode = { id: "comp", type: "component", data: { appSlug: "x", estimatedCredits: 40, estimatedCreditsIsEstimate: true } }
    const flagged = await estimateWorkflowCreditsDetailed([component, AUDIO], [])
    expect(flagged.estimate).toBe(true)
    expect(flagged.perNode.comp?.estimate).toBe(true)
    const fixed = await estimateWorkflowCreditsDetailed([{ ...component, data: { ...component.data, estimatedCreditsIsEstimate: false } }, AUDIO], [])
    expect(fixed.estimate).toBe(false)
  })

  it("the total sums each run of a metered node, never its hold", async () => {
    // Two chat nodes: two estimates.
    const two = await estimateWorkflowCreditsDetailed([OPUS_CHAT, { ...OPUS_CHAT, id: "chat2" }], [])
    expect(two.credits).toBe(12)
    expect(two.estimate).toBe(true)
  })

  it.each([
    ["after-effects", {}, "after-effects"],
    ["lottie-overlay", {}, "lottie-overlay"],
    ["3d-title", {}, "3d-title"],
    ["qa-check", {}, "qa-check"],
    ["image-to-text", {}, "image-to-text"],
    ["image-critic", {}, "image-critic"],
    ["video-composer", {}, "scene-graph-ai"],
    ["describe-to-picker", {}, "describe-to-picker"],
    ["motion-graphics", {}, "motion-graphics"],
    ["motion-graphics", { engine: "lottie" }, "motion-graphics-lottie"],
    ["generate-3d-scene", {}, "3d-scene"],
    ["edit-3d-scene", { editPrompt: "make it red" }, "3d-scene"],
  ] as const)("%s %j prices its %s key at the feature's default model", (type, data, feature) => {
    const key = getNodeModelIdentifier({ type, data: { ...data } })
    expect(key).toBe(llmPriceKey(feature, LLM_FEATURE_DEFAULTS[feature === "motion-graphics-lottie" ? "motion-graphics-lottie" : feature]))
    expect(meteredLlmKeyOfNode({ type, data: { ...data } })).toBe(key)
    expect(charged(key)).toBeGreaterThan(0)
  })

  it("a node's own model, effort and Advanced flag decide its key", () => {
    expect(getNodeModelIdentifier({ type: "qa-check", data: { llmModel: "claude-opus-5.5", advancedMode: true } })).toBe(llmPriceKey("qa-check", "claude-opus-5.5", undefined, true))
    expect(getNodeModelIdentifier({ type: "image-to-text", data: { llmModel: "gpt-5.6-terra", reasoningEffort: "max" } })).toBe(llmPriceKey("image-to-text", "gpt-5.6-terra", "max"))
  })

  it("Generate Script prices the model its run resolves (a legacy script provider maps to its model)", () => {
    expect(getNodeModelIdentifier({ type: "generate-script", data: {} })).toBe(llmPriceKey("generate-script", LLM_FEATURE_DEFAULTS["generate-script"]))
    expect(getNodeModelIdentifier({ type: "generate-script", data: { llmModel: "claude-opus-5.5" } })).toBe(llmPriceKey("generate-script", "claude-opus-5.5"))
  })

  it("a deterministic Edit 3D Scene (operations) makes no call: free, not an estimate", async () => {
    const node = { id: "edit", type: "edit-3d-scene", data: { operations: [{ op: "move" }] } }
    expect(meteredLlmKeyOfNode(node)).toBeNull()
    expect(await estimateWorkflowCreditsDetailed([node], [])).toEqual({ credits: 0, estimate: false, perNode: { edit: { credits: 0, estimate: false } } })
  })

  it("Choose Best's AI judge is priced at its key; a logic strategy is not an LLM node", async () => {
    const judge: EstimateNode = { id: "judge", type: "reduce", data: { strategyId: "pick-best-llm", strategyConfig: { llmModel: "gemini-3.8-flash" } } }
    expect(getNodeModelIdentifier(judge)).toBe("reduce:pick-best-llm:gemini-3.8-flash")
    const d = await estimateWorkflowCreditsDetailed([judge], [])
    expect(d.estimate).toBe(true)
    expect(d.credits).toBe(charged("reduce:pick-best-llm:gemini-3.8-flash"))
    expect(d.credits).toBeGreaterThan(0)
    const concat = { type: "reduce", data: { strategyId: "concat" } }
    expect(getNodeModelIdentifier(concat)).toBe("reduce:concat")
    expect(meteredLlmKeyOfNode(concat)).toBeNull()
  })

  it("a Meta Ads scrape with analysis is its fixed scrape plus the analyses' estimate, flagged; without analysis it is fixed", async () => {
    const withAnalysis: EstimateNode = { id: "ads", type: "meta-ads-scrape", data: { count: 10, analyze: true } }
    const d = await estimateWorkflowCreditsDetailed([withAnalysis], [])
    const plain = await estimateWorkflowCreditsDetailed([{ id: "ads", type: "meta-ads-scrape", data: { count: 10 } }], [])
    expect(plain.estimate).toBe(false)
    expect(d.estimate).toBe(true)
    expect(d.credits).toBe(plain.credits + charged(llmPriceKey("meta-ads-analysis", LLM_FEATURE_DEFAULTS["meta-ads-analysis"]), 10)!)
  })

  it("the static base table prices a metered key at its estimate, unmarked (the built-in templates' listing)", () => {
    const key = getNodeModelIdentifier(OPUS_CHAT)
    expect(CreditsService.estimateWorkflowBaseCredits([OPUS_CHAT], [])).toBe(5)
    expect(key).toBe("llm-chat:claude-opus-5.5")
  })

  it("published listing price includes the LLM estimate", async () => {
    const listing = await estimateWorkflowListingCredits([OPUS_CHAT, AUDIO], [], { publishType: "app" })
    expect(listing.preview).toBe(17)
  })
})

describe("rollback: every estimate surface returns today's tier figures", () => {
  beforeEach(() => {
    rollback(true)
    expect(llmMeteredPricing()).toBe(false)
  })

  it("a Component's stored estimate flag marks nothing (no figure is an estimate under the rollback)", async () => {
    const component: EstimateNode = { id: "comp", type: "component", data: { appSlug: "x", estimatedCredits: 40, estimatedCreditsIsEstimate: true } }
    expect((await estimateWorkflowCreditsDetailed([component, AUDIO], [])).estimate).toBe(false)
  })

  it("the workflow estimate is the tier figure, not an estimate", async () => {
    const tierId = buildLlmCreditIdentifier("llm-chat", "claude-opus-5.5")
    expect(getNodeModelIdentifier(OPUS_CHAT)).toBe(tierId)
    const d = await estimateWorkflowCreditsDetailed([OPUS_CHAT, AUDIO], [])
    expect(d).toEqual({
      credits: charged(tierId)! + 11,
      estimate: false,
      perNode: { chat: { credits: charged(tierId), estimate: false }, audio: { credits: 11, estimate: false } },
    })
    expect(await estimateWorkflowCredits([OPUS_CHAT, AUDIO], [])).toBe(d.credits)
    expect(meteredLlmKeyOfNode(OPUS_CHAT)).toBeNull()
  })

  it.each([
    ["after-effects", {}],
    ["lottie-overlay", {}],
    ["3d-title", {}],
    ["generate-script", {}],
    ["qa-check", {}],
    ["image-to-text", {}],
    ["image-critic", {}],
    ["motion-graphics", { engine: "lottie" }],
    ["generate-3d-scene", {}],
    ["edit-3d-scene", { editPrompt: "x" }],
    ["meta-ads-scrape", { count: 10, analyze: true }],
  ] as const)("%s keeps today's id", (type, data) => {
    // Today's id: every one of these falls through to its own node-type / scrape id.
    expect(getNodeModelIdentifier({ type, data: { ...data } })).not.toMatch(/:(claude|gpt|gemini|grok|deepseek|qwen|kimi)/)
  })

  it("the static base table is the tier table", () => {
    expect(CreditsService.estimateWorkflowBaseCredits([OPUS_CHAT], [])).toBe(STATIC_CREDIT_COSTS[buildLlmCreditIdentifier("llm-chat", "claude-opus-5.5")])
  })

  it("Choose Best's judge is estimated at the tier id the route bills (judge parity), not 0", async () => {
    const judge = { type: "reduce", data: { strategyId: "pick-best-llm", strategyConfig: { llmModel: "gemini-3.8-flash" } } }
    expect(getNodeModelIdentifier(judge)).toBe(buildLlmCreditIdentifier("reduce:pick-best-llm", "gemini-3.8-flash"))
    expect(CreditsService.estimateWorkflowBaseCredits([judge], [])).toBe(STATIC_CREDIT_COSTS[buildLlmCreditIdentifier("reduce:pick-best-llm", "gemini-3.8-flash")])
  })
})

describe("the detailed estimate is the estimate: the same total, its lines adding up to it", () => {
  const dir = join(__dirname, "..", "..", "..", "lib", "tutorial-seed", "templates")
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => [f, JSON.parse(readFileSync(join(dir, f), "utf8")) as { nodes: EstimateNode[]; edges: Array<{ source?: string; target: string }> }] as const)
    // A UGC video's part is priced by the plugin seam, which this repository does not hold.
    .filter(([, t]) => !t.nodes.some((n) => n.type === "ugc-clip"))

  it("finds the built-in templates", () => {
    expect(docs.length).toBeGreaterThan(40)
  })

  it.each(["metered", "rollback"] as const)("%s: every template's detailed total is estimateWorkflowCredits', and Σ lines = total", async (mode) => {
    rollback(mode === "rollback")
    let anyEstimate = false
    for (const [file, t] of docs) {
      const detailed = await estimateWorkflowCreditsDetailed(t.nodes, t.edges)
      expect(detailed.credits, file).toBe(await estimateWorkflowCredits(t.nodes, t.edges))
      expect(Object.values(detailed.perNode).reduce((sum, line) => sum + line.credits, 0), file).toBe(detailed.credits)
      expect(detailed.estimate, file).toBe(Object.values(detailed.perNode).some((line) => line.estimate))
      anyEstimate ||= detailed.estimate
    }
    // Metered: the templates holding an LLM node are estimates; the rollback has none.
    expect(anyEstimate).toBe(mode === "metered")
  })
})

describe("R49: a metered model with no price fails closed — never the bare node-type row, never 0", () => {
  it("the workflow estimate throws LlmUnpricedModelError (its run would be refused llm_model_unpriced)", async () => {
    unpriced.add("claude-opus-5.5")
    await expect(estimateWorkflowCreditsDetailed([OPUS_CHAT, AUDIO], [])).rejects.toMatchObject({ name: "LlmUnpricedModelError", code: "llm_model_unpriced", modelId: "claude-opus-5.5" })
    await expect(estimateWorkflowCredits([OPUS_CHAT], [])).rejects.toMatchObject({ code: "llm_model_unpriced" })
    // A type with no bare row (the 3D scene nodes) is refused the same way, not priced 0.
    await expect(estimateWorkflowCredits([{ id: "s", type: "generate-3d-scene", data: { llmModel: "claude-opus-5.5" } }], [])).rejects.toMatchObject({ code: "llm_model_unpriced" })
  })

  it("the listing refuses too (a publish answers llm_model_unpriced), and so does the static base table", async () => {
    unpriced.add("claude-opus-5.5")
    await expect(estimateWorkflowListingCredits([OPUS_CHAT], [], { publishType: "app" })).rejects.toMatchObject({ code: "llm_model_unpriced" })
    expect(() => CreditsService.estimateWorkflowBaseCredits([OPUS_CHAT], [])).toThrow(expect.objectContaining({ code: "llm_model_unpriced" }))
  })

  it("a scrape whose analysis model is unpriced is refused, never priced at the tier composite", async () => {
    const model = LLM_FEATURE_DEFAULTS["meta-ads-analysis"]
    unpriced.add(model)
    await expect(estimateWorkflowCredits([{ id: "ads", type: "meta-ads-scrape", data: { count: 10, analyze: true } }], [])).rejects.toMatchObject({ code: "llm_model_unpriced", modelId: model })
    // Without analysis it is a fixed scrape: priced as before.
    expect(await estimateWorkflowCredits([{ id: "ads", type: "meta-ads-scrape", data: { count: 10 } }], [])).toBeGreaterThan(0)
  })

  it("rollback: an unpriced model is irrelevant — the tier row prices it, as before", async () => {
    unpriced.add("claude-opus-5.5")
    rollback(true)
    expect(await estimateWorkflowCredits([OPUS_CHAT], [])).toBe(charged(buildLlmCreditIdentifier("llm-chat", "claude-opus-5.5")))
  })
})

describe("a scrape's whole analysis as one price id (`scrapeAnalysisQuoteId`): the editor quotes exactly the server's figure", () => {
  const table = () => chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
  const ig = { id: "ig", type: "instagram-scrape", data: { targets: "natgeo\nnasa", mode: "profile", count: 20, analyze: true } }

  it("is the key's estimate × the calls, rounded once and marked up once — the workflow estimate's analysis part", async () => {
    const parts = scrapeAnalysisPriceParts(ig)!
    const quoteId = scrapeAnalysisQuoteId(parts)
    const key = llmPriceKey("meta-ads-analysis", parts.analysisModel)
    expect(isMeteredLlmQuoteId(quoteId)).toBe(true)
    expect(chargedCredits(table(), quoteId)).toBe(charged(key, parts.items))
    expect(meteredLlmQuote(table(), quoteId)).toEqual({ kind: "estimate", credits: charged(key, parts.items) })
    const plain = await estimateWorkflowCredits([{ ...ig, data: { ...ig.data, analyze: false } }], [])
    expect(await estimateWorkflowCredits([ig], [])).toBe(plain + chargedCredits(table(), quoteId)!)
  })

  it("only a scrape analysis key, a whole count of calls; nothing under the rollback", () => {
    const key = llmPriceKey("meta-ads-analysis", LLM_FEATURE_DEFAULTS["meta-ads-analysis"])
    expect(isMeteredLlmQuoteId(`${key}:2.5u`)).toBe(false)
    expect(isMeteredLlmQuoteId(`${llmPriceKey("llm-chat", "claude-opus-5.5")}:3u`)).toBe(false)
    expect(chargedCredits(table(), `${key}:2.5u`)).toBeUndefined()
    rollback(true)
    expect(isMeteredLlmQuoteId(`${key}:3u`)).toBe(false)
    expect(chargedCredits(table(), `${key}:3u`)).toBeUndefined()
  })

  it("an unpriced analysis model is quoted unpriced, never 0", () => {
    const model = LLM_FEATURE_DEFAULTS["meta-ads-analysis"]
    unpriced.add(model)
    const quoteId = `${llmPriceKey("meta-ads-analysis", model)}:4u`
    expect(meteredLlmQuote(table(), quoteId)).toMatchObject({ kind: "unpriced" })
    expect(chargedCredits(table(), quoteId)).toBeUndefined()
  })
})

describe("R51: the run pre-check finds the unpriced call a run would meet, before anything is enqueued", () => {
  it("names the first unpriced metered call among the nodes the run executes; null when every call is priced", () => {
    expect(unpricedMeteredLlmOfRun([OPUS_CHAT, AUDIO], [])).toBeNull()
    unpriced.add("claude-opus-5.5")
    expect(unpricedMeteredLlmOfRun([AUDIO, OPUS_CHAT], [])).toMatchObject({ name: "LlmUnpricedModelError", code: "llm_model_unpriced", modelId: "claude-opus-5.5" })
  })

  it("a node outside the run, or frozen, makes no call and is not asked", () => {
    unpriced.add("claude-opus-5.5")
    expect(unpricedMeteredLlmOfRun([OPUS_CHAT, AUDIO], [], new Set(["audio"]))).toBeNull()
    expect(unpricedMeteredLlmOfRun([{ ...OPUS_CHAT, data: { ...OPUS_CHAT.data, skipped: true } }, AUDIO], [])).toBeNull()
  })

  it("rollback: nothing is refused (the tier row prices every model, as before)", () => {
    unpriced.add("claude-opus-5.5")
    rollback(true)
    expect(unpricedMeteredLlmOfRun([OPUS_CHAT], [])).toBeNull()
  })
})

describe("M2: an Instagram scrape with analysis", () => {
  it("is its fixed scrape plus count × sources analyses, the count clamped to what the route accepts", async () => {
    const key = llmPriceKey("meta-ads-analysis", LLM_FEATURE_DEFAULTS["meta-ads-analysis"])
    const ig = (data: Record<string, unknown>) => estimateWorkflowCreditsDetailed([{ id: "ig", type: "instagram-scrape", data }], [])
    const two = { targets: "natgeo\nnasa", mode: "profile" }
    const plain = await ig({ ...two, count: 20 })
    const analysed = await ig({ ...two, count: 20, analyze: true })
    expect(plain.estimate).toBe(false)
    expect(analysed.estimate).toBe(true)
    expect(analysed.credits).toBe(plain.credits + charged(key, 40)!)
    // A stored count above the route's cap (100) is held at the cap, as the route's Zod would refuse more.
    const capped = await ig({ ...two, count: 500, analyze: true })
    const atCap = await ig({ ...two, count: 100, analyze: true })
    expect(capped.credits).toBe(atCap.credits)
  })
})
