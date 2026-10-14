/**
 * The node-agnostic per-creative analysis: one structured call per item,
 * a failure or the deadline never fails the batch (null + reason), stats
 * that price the settlement, and the request shape the model sees.
 */
import { describe, it, expect, vi } from "vitest"

vi.mock("../llm-client.js", () => ({ llmCompleteStructured: vi.fn() }))

import { AD_CREATIVE_ANALYSIS_SYSTEM_PROMPT } from "@nodaro/prompts/doctrine"
import { adCreativeAnalysisSchema, analyzeAdCreatives, type AdCreativeItem } from "../ad-creative-analysis.js"

const ANALYSIS = {
  assetType: "static" as const,
  format: "in-feed",
  visualHooks: ["product close-up"],
  audiences: ["runners"],
  graphicIdentity: "Black on white, big serif headline.",
  copywritingHooks: ["urgency: 'last day'"],
  usps: ["free returns"],
  cta: "Shop now",
  summary: "Sells running shoes to runners with a last-day urgency hook.",
}

const item = (id: string, over: Partial<AdCreativeItem> = {}): AdCreativeItem => ({
  id,
  imageUrl: `https://cdn.nodaro.ai/images/${id}.jpg`,
  advertiser: "Nike",
  headline: "Air Max",
  body: "Just do it.",
  ctaLabel: "Shop now",
  platforms: ["FACEBOOK"],
  creativeFormat: "square",
  ...over,
})

describe("analyzeAdCreatives", () => {
  it("one structured vision call per item — system prompt, the facts as text, the creative as an image block", async () => {
    const complete = vi.fn(async () => ({ output: ANALYSIS, inputTokens: 10, outputTokens: 20, providerCost: 0.001 }))
    const { results, stats } = await analyzeAdCreatives([item("1"), item("2", { imageUrl: undefined, focus: "compare to our positioning" })], {
      modelId: "gemini-3.6-flash",
      deadlineAt: Date.now() + 60_000,
      complete: complete as never,
    })
    expect(complete).toHaveBeenCalledTimes(2)
    const [req, schema, opts] = (complete.mock.calls[0] as unknown[]) as [Record<string, unknown>, unknown, Record<string, unknown>]
    expect(req.modelId).toBe("gemini-3.6-flash")
    expect(req.system).toBe(AD_CREATIVE_ANALYSIS_SYSTEM_PROMPT)
    const content = (req.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content
    expect(content[0]).toMatchObject({ type: "text" })
    expect(String(content[0].text)).toContain("Account / advertiser: Nike")
    expect(String(content[0].text)).toContain("Body copy:\nJust do it.")
    expect(content[1]).toEqual({ type: "image", url: "https://cdn.nodaro.ai/images/1.jpg" })
    expect(schema).toBe(adCreativeAnalysisSchema)
    expect(opts).toMatchObject({ schemaName: "ad_creative_analysis" })
    // No creative → copy-only analysis (one text block), with the user's focus appended.
    const secondReq = (complete.mock.calls[1] as unknown[])[0] as Record<string, unknown>
    const second = secondReq.messages as Array<{ content: Array<Record<string, unknown>> }>
    expect(second[0].content).toHaveLength(1)
    expect(String(second[0].content[0].text)).toContain("Analyst focus from the user: compare to our positioning")

    expect(results.get("1")).toEqual({ analysis: ANALYSIS })
    expect(stats).toEqual({ requested: 2, analyzed: 2, failed: 0, skipped: 0, providerCostUsd: 0.002, usageComplete: true })
  })

  it("a failed call is null + 'failed' (the batch goes on); a missing cost marks usage incomplete", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce({ output: ANALYSIS, inputTokens: 1, outputTokens: 1 })
      .mockRejectedValueOnce(new Error("model refused"))
    const { results, stats } = await analyzeAdCreatives([item("ok"), item("bad")], {
      modelId: "gemini-3.6-flash",
      deadlineAt: Date.now() + 60_000,
      concurrency: 1,
      complete: complete as never,
    })
    expect(results.get("ok")?.analysis).toEqual(ANALYSIS)
    expect(results.get("bad")).toEqual({ analysis: null, reason: "failed", detail: "model refused" })
    expect(stats).toMatchObject({ requested: 2, analyzed: 1, failed: 1, skipped: 0, usageComplete: false })
  })

  it("past the deadline the remaining items are 'deadline' skips, never started", async () => {
    let clock = 1_000
    const complete = vi.fn(async () => {
      clock += 100_000 // each call burns the whole budget
      return { output: ANALYSIS, inputTokens: 1, outputTokens: 1, providerCost: 0.001 }
    })
    const { results, stats } = await analyzeAdCreatives([item("a"), item("b"), item("c")], {
      modelId: "gemini-3.6-flash",
      deadlineAt: 50_000,
      concurrency: 1,
      now: () => clock,
      complete: complete as never,
    })
    expect(complete).toHaveBeenCalledTimes(1)
    expect(results.get("a")?.analysis).toEqual(ANALYSIS)
    expect(results.get("b")).toEqual({ analysis: null, reason: "deadline" })
    expect(results.get("c")).toEqual({ analysis: null, reason: "deadline" })
    expect(stats).toMatchObject({ requested: 3, analyzed: 1, failed: 0, skipped: 2, usageComplete: false })
  })

  it("the schema is fixed fields + string lists only (Gemini via KIE drops map fields)", () => {
    const shape = adCreativeAnalysisSchema.shape
    expect(Object.keys(shape)).toEqual(["assetType", "format", "visualHooks", "audiences", "graphicIdentity", "copywritingHooks", "usps", "cta", "summary"])
    expect(adCreativeAnalysisSchema.safeParse(ANALYSIS).success).toBe(true)
    expect(adCreativeAnalysisSchema.safeParse({ ...ANALYSIS, assetType: "gif" }).success).toBe(false)
  })
})
