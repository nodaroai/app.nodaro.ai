/**
 * The whole-run estimate with a metered LLM node (Task 13, spec §8.5):
 *
 * - The run asks the price batch for BOTH of the node's ids (the metered key
 *   and today's tier id) in the one request, so the server's answer decides.
 * - Once the server has marked the key an estimate, the node is priced at it,
 *   its line is an estimate, and so is the run's total (Execute workflow `~`)
 *   — total = the estimates + the fixed prices.
 * - Under the rollback the key is `missing`: the node is priced at its tier
 *   id, exactly as before, and nothing is an estimate.
 * - The app runner's Run label reads the same figure, `~` included.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/edition", () => ({ hasCredits: () => true }))

import { queryClient } from "@/lib/query-client"
import { queryKeys } from "@/lib/query-keys"
import {
  forgetEstimateModels,
  forgetUnpricedModels,
  getCachedModelCredits,
  rememberEstimateModels,
  rememberRefusedModels,
  rememberUnpricedModels,
} from "@/hooks/use-model-credit-cost"
import { getModelIdentifier } from "@/components/editor/config-panels/helpers"
import { computeLiveRunEstimate } from "@/hooks/use-live-run-estimate"
import { runCostLabel } from "@/lib/run-price"
import type { WorkflowNode } from "@/types/nodes"
import { llmNodeFeature, llmNodePriceIds, meteredModeProbeId } from "@/lib/llm-price-ids"
import { buildLlmCreditIdentifier, llmPriceKey, resolveScriptModelId } from "@nodaro/shared/llm-models"
import { scrapeAnalysisPriceParts, scrapeAnalysisQuoteId } from "@nodaro/shared/social"
import { estimateRunCreditLines, estimateWholeRun, runModelIds } from "../estimate-run-credits"
import { runLinesUnpriced } from "../run-unpriced"
import { ugcRunCredits } from "../ugc-run-estimate"

const KEY = "llm-chat:claude-opus-5.5"
const TIER = "llm-chat:premium"

function n(id: string, type: string, data: Record<string, unknown>): WorkflowNode {
  return { id, type, position: { x: 0, y: 0 }, data: { label: id, ...data } } as WorkflowNode
}

const llm = n("chat", "llm-chat", { llmModel: "claude-opus-5.5" })
const image = n("img", "generate-image", { provider: "nano-banana" })
const IMAGE_ID = getModelIdentifier(image, [], [image])

function cache(prices: Record<string, number>): void {
  for (const [id, credits] of Object.entries(prices)) queryClient.setQueryData(queryKeys.credits.modelCost(id), credits)
}

beforeEach(() => {
  queryClient.clear()
  forgetUnpricedModels()
  forgetEstimateModels()
})

describe("whole-run estimate with a metered LLM node", () => {
  it("asks for the node's metered key AND its tier id", () => {
    expect(runModelIds([llm], [llm], [])).toEqual(expect.arrayContaining([KEY, TIER]))
  })

  it("Execute workflow shows ~ when any node is metered; total = estimates + fixed", () => {
    cache({ [KEY]: 6, [TIER]: 3, [IMAGE_ID]: 44 })
    rememberEstimateModels([KEY])
    const nodes = [llm, image]
    const run = estimateWholeRun(nodes, [], getCachedModelCredits)
    expect(run.total).toBe(6 + 44)
    expect(run.estimate).toBe(true)
    const lines = estimateRunCreditLines(nodes, nodes, [], getCachedModelCredits)
    expect(lines.find((l) => l.nodeId === "chat")).toMatchObject({ credits: 6, estimate: true })
    expect(lines.find((l) => l.nodeId === "img")?.estimate).toBeUndefined()
  })

  it("a run set with no UGC part (Run from here, Run up to here, Render final) is `approx` exactly when a metered line is", () => {
    cache({ [KEY]: 6, [TIER]: 3, [IMAGE_ID]: 44 })
    rememberEstimateModels([KEY])
    const nodes = [llm, image]
    expect(ugcRunCredits(nodes, nodes, [], getCachedModelCredits, () => undefined)).toMatchObject({ credits: 50, estimate: "none", approx: true })
    expect(ugcRunCredits([image], nodes, [], getCachedModelCredits, () => undefined)).toMatchObject({ credits: 44, approx: false })
  })

  it("rollback: the key is missing, so the node is priced at its tier and nothing is an estimate", () => {
    cache({ [TIER]: 3, [IMAGE_ID]: 44 })
    rememberUnpricedModels([KEY])
    const run = estimateWholeRun([llm, image], [], getCachedModelCredits)
    expect(run.total).toBe(3 + 44)
    expect(run.estimate).toBe(false)
    expect(getModelIdentifier(llm, [], [llm])).toBe(TIER)
  })

  it("a metered key the server refuses to price adds nothing — never its tier's or a row's figure — and its line says so", () => {
    cache({ [TIER]: 3, [IMAGE_ID]: 44 })
    rememberRefusedModels([KEY])
    rememberUnpricedModels([KEY])
    const lines = estimateRunCreditLines([llm, image], [llm, image], [], getCachedModelCredits)
    expect(lines.find((l) => l.nodeId === "chat")).toMatchObject({ credits: 0, unpriced: true })
    expect(lines.find((l) => l.nodeId === "chat")?.estimate).toBeUndefined()
    expect(estimateWholeRun([llm, image], [], getCachedModelCredits).total).toBe(44)
  })

  it("the run's totals say they leave an unpriced node out, with the server's own sentence (Execute, Run from here, Run up to here)", () => {
    const message = 'The model "claude-opus-5.5" has no price yet, so it cannot be run. Choose another model.'
    cache({ [TIER]: 3, [IMAGE_ID]: 44 })
    rememberRefusedModels([KEY], { [KEY]: { message } })
    rememberUnpricedModels([KEY])
    const lines = estimateRunCreditLines([llm, image], [llm, image], [], getCachedModelCredits)
    expect(lines.find((l) => l.nodeId === "chat")).toMatchObject({ credits: 0, unpriced: true, unpricedMessage: message })
    expect(runLinesUnpriced(lines)).toEqual({ message })
    // Execute: the whole run.
    expect(estimateWholeRun([llm, image], [], getCachedModelCredits)).toMatchObject({ total: 44, unpriced: { message } })
    // Run from here / Run up to here / Render final: the run-set figure.
    expect(ugcRunCredits([llm, image], [llm, image], [], getCachedModelCredits, () => undefined)).toMatchObject({ credits: 44, unpriced: { message } })
    // A set without the unpriced node is priced as before.
    expect(estimateWholeRun([image], [], getCachedModelCredits).unpriced).toBeUndefined()
    expect(ugcRunCredits([image], [llm, image], [], getCachedModelCredits, () => undefined).unpriced).toBeUndefined()
  })

  it("a Component whose listing holds an LLM estimate (its stored flag) makes its line and the run ~ — while metered", () => {
    const comp = n("comp", "component", { appSlug: "x", estimatedCredits: 40, estimatedCreditsIsEstimate: true })
    cache({ [IMAGE_ID]: 44 })
    // The flag asks for the mode probe, so the editor learns the server's pricing mode.
    expect(runModelIds([comp], [comp], [])).toContain(meteredModeProbeId())
    rememberEstimateModels([meteredModeProbeId()])
    const run = estimateWholeRun([comp, image], [], getCachedModelCredits)
    expect(run.estimate).toBe(true)
    expect(estimateRunCreditLines([comp], [comp], [], getCachedModelCredits)[0]).toMatchObject({ credits: 40, estimate: true })
    const fixed = n("comp", "component", { appSlug: "x", estimatedCredits: 40, estimatedCreditsIsEstimate: false })
    expect(estimateWholeRun([fixed, image], [], getCachedModelCredits).estimate).toBe(false)
  })

  it("rollback: a Component's stored estimate flag marks nothing (the mode probe is `missing`), as the server gates it", () => {
    const comp = n("comp", "component", { appSlug: "x", estimatedCredits: 40, estimatedCreditsIsEstimate: true })
    cache({ [IMAGE_ID]: 44 })
    rememberUnpricedModels([meteredModeProbeId()])
    expect(estimateWholeRun([comp, image], [], getCachedModelCredits).estimate).toBe(false)
    expect(estimateRunCreditLines([comp], [comp], [], getCachedModelCredits)[0]?.estimate).toBeUndefined()
  })

  it("a run of fixed-price nodes only is never an estimate", () => {
    cache({ [IMAGE_ID]: 44 })
    expect(estimateWholeRun([image], [], getCachedModelCredits)).toMatchObject({ total: 44, estimate: false })
  })
})

describe("whole-run estimate with a Choose Best AI judge", () => {
  const judge = n("best", "reduce", { strategyId: "pick-best-llm", strategyConfig: { llmModel: "claude-opus-5.5" } })
  const judgeIds = llmNodePriceIds(judge)!

  it("prices the judge as a metered reduce:pick-best-llm call on its strategy-config model", () => {
    expect(llmNodeFeature(judge)).toBe("reduce:pick-best-llm")
    expect(judgeIds.key).toMatch(/^reduce:pick-best-llm:claude-opus-5\.5/)
    expect(judgeIds.tierId).toBe("reduce:pick-best-llm:premium")
    expect(runModelIds([judge], [judge], [])).toEqual(expect.arrayContaining([judgeIds.key, judgeIds.tierId]))
  })

  it("an unset judge model is the pick-best-llm default", () => {
    const unset = n("best", "reduce", { strategyId: "pick-best-llm", strategyConfig: {} })
    expect(llmNodePriceIds(unset)!.key).toMatch(/^reduce:pick-best-llm:claude-sonnet-5\.5/)
  })

  it("a pure-logic strategy makes no metered call", () => {
    const concat = n("join", "reduce", { strategyId: "concat" })
    expect(llmNodeFeature(concat)).toBeUndefined()
    expect(llmNodePriceIds(concat)).toBeUndefined()
  })

  it("metered: the judge is in Execute's total and makes it ~", () => {
    cache({ [judgeIds.key]: 7, [judgeIds.tierId]: 25, [IMAGE_ID]: 44 })
    rememberEstimateModels([judgeIds.key])
    const nodes = [judge, image]
    const run = estimateWholeRun(nodes, [], getCachedModelCredits)
    expect(run.total).toBe(7 + 44)
    expect(run.estimate).toBe(true)
    expect(getModelIdentifier(judge, [], [judge])).toBe(judgeIds.key)
    const lines = estimateRunCreditLines(nodes, nodes, [], getCachedModelCredits)
    expect(lines.find((l) => l.nodeId === "best")).toMatchObject({ credits: 7, estimate: true })
  })

  it("rollback: the key is missing, so the judge is priced at the tier id its route bills — the server estimate's id (judge parity) — and nothing is an estimate", () => {
    // The server prices a judge at `buildLlmCreditIdentifier("reduce:pick-best-llm", model)` —
    // its route's `reduceCreditIdentifier`, the estimator's CREDIT_COSTS["reduce"].
    const serverId = buildLlmCreditIdentifier("reduce:pick-best-llm", "claude-opus-5.5")
    cache({ reduce: 1, [serverId]: 25, [IMAGE_ID]: 44 })
    expect(getModelIdentifier(judge, [], [judge])).toBe(serverId)
    const run = estimateWholeRun([judge, image], [], getCachedModelCredits)
    expect(run.total).toBe(25 + 44)
    expect(run.estimate).toBe(false)
    // An unset judge model: the bare feature id, as the route bills it.
    expect(getModelIdentifier(n("best", "reduce", { strategyId: "pick-best-llm" }), [], [])).toBe("reduce:pick-best-llm")
  })
})

describe("app runner", () => {
  it("app-runner Run label reads the live estimate with ~; a settled (non-estimate) figure has none", () => {
    cache({ [KEY]: 6, [TIER]: 3, [IMAGE_ID]: 44 })
    rememberEstimateModels([KEY])
    const live = computeLiveRunEstimate({ nodes: [llm, image], edges: [] }, getCachedModelCredits)
    expect(live).toMatchObject({ total: 50, estimate: true })
    const label = (estimate: boolean) => runCostLabel({
      exact: live.total,
      estimate,
      listing: null,
      pending: false,
      plusPerMinute: (m) => `+ ${m}/min`,
    })
    expect(label(true)).toBe(" (~50 CR)")
    // A fixed run, or a settled figure (a slot's credits used is the run's
    // actual charge), carries no ~.
    expect(label(false)).toBe(" (50 CR)")
  })
})

describe("judge parity: the run asks the price batch for the id the judge resolves to", () => {
  it.each([undefined, "claude-opus-5.5", "gemini-3.8-flash", "claude-sonnet-5.5"])("judge model %s", (model) => {
    const judge = n("best", "reduce", { strategyId: "pick-best-llm", strategyConfig: model ? { llmModel: model } : {} })
    // Cold cache / rollback: the id the judge is priced at is in the batch the run sends.
    expect(runModelIds([judge], [judge], [])).toContain(getModelIdentifier(judge, [], [judge]))
  })
})

describe("I6: the editor prices as the server does", () => {
  it("a deterministic Edit 3D Scene (operations) is not an LLM node; an instruction edit is", () => {
    expect(llmNodeFeature(n("e", "edit-3d-scene", { operations: [{ op: "move" }] }))).toBeUndefined()
    expect(llmNodeFeature(n("e", "edit-3d-scene", { editPrompt: "make it red" }))).toBe("3d-scene")
  })

  it("Generate Script keys the model its run resolves: a legacy script provider maps to its model", () => {
    const legacy = n("s", "generate-script", { provider: "claude" })
    expect(llmNodePriceIds(legacy)!.key).toBe(llmPriceKey("generate-script", resolveScriptModelId("claude")))
    expect(llmNodePriceIds(legacy)!.key).toBe("generate-script:claude-sonnet-4.6")
    // An explicit model wins, as the run's.
    expect(llmNodePriceIds(n("s", "generate-script", { provider: "claude", llmModel: "gpt-5.2" }))!.key).toBe(llmPriceKey("generate-script", "gpt-5.2"))
  })

  describe("a scrape with AI analysis", () => {
    const ads = n("ads", "meta-ads-scrape", { count: 10, analyze: true })
    const parts = scrapeAnalysisPriceParts({ type: "meta-ads-scrape", data: ads.data as Record<string, unknown> })!
    const quoteId = scrapeAnalysisQuoteId(parts)

    it("asks for its fixed scrape and its whole analysis's quote (the server's figure)", () => {
      expect(quoteId).toBe(`${llmPriceKey("meta-ads-analysis", parts.analysisModel)}:${parts.items}u`)
      expect(runModelIds([ads], [ads], [])).toEqual(expect.arrayContaining([parts.fixedId, quoteId]))
    })

    it("metered: fixed + the analysis quote, exactly as the server estimates it, an estimate (`~`)", () => {
      // 23, not 10 × a rounded per-call figure: the server rounds and marks up the items once.
      cache({ [parts.fixedId]: 22, [quoteId]: 23, [getModelIdentifier(ads, [], [ads])]: 99 })
      rememberEstimateModels([quoteId])
      const lines = estimateRunCreditLines([ads], [ads], [], getCachedModelCredits)
      expect(lines[0]).toMatchObject({ credits: 22 + 23, estimate: true })
    })

    it("rollback: the quote is not an estimate, so its tier composite prices it, as before", () => {
      cache({ [parts.fixedId]: 22, [quoteId]: 23, [getModelIdentifier(ads, [], [ads])]: 99 })
      const lines = estimateRunCreditLines([ads], [ads], [], getCachedModelCredits)
      expect(lines[0]!.credits).toBe(99)
      expect(lines[0]).not.toHaveProperty("estimate")
    })
  })
})
