import { z } from "zod"
import { AD_CREATIVE_ANALYSIS_SYSTEM_PROMPT, buildAdCreativeAnalysisUserText, type AdCreativeAnalysisInput } from "@nodaro/prompts/doctrine"
import { type AdCreativeAnalysis } from "@nodaro/shared/social"
import { llmCompleteStructured, type LlmContentBlock, type LlmRequest } from "./llm-client.js"
import { deadlinePool } from "./deadline-pool.js"

/**
 * Per-creative AI analysis — the "expert competitor ad analyst" pass, one
 * structured LLM call per ad. Node-agnostic: a caller (Meta Ads today,
 * TikTok / Instagram / LinkedIn next) hands over `{ id, imageUrl, text
 * facts }` and gets the analysis back by id.
 *
 * Contract:
 *   1. One ad's failure never fails the batch — it comes back as `null`
 *      with a short reason, and the caller refunds it (the run reserved the
 *      analysis per REQUESTED ad and commits per ANALYSED ad).
 *   2. Everything runs under the caller's deadline with bounded parallelism;
 *      past the deadline the remaining ads are simply "skipped".
 *   3. Fixed fields and string arrays only — never a map: Gemini via KIE
 *      drops record-shaped fields from the enforced schema (backend/CLAUDE.md).
 */

export const adCreativeAnalysisSchema = z.object({
  assetType: z.enum(["static", "motion", "carousel", "unknown"]),
  format: z.string().max(120),
  visualHooks: z.array(z.string().max(240)).max(8),
  audiences: z.array(z.string().max(160)).max(8),
  graphicIdentity: z.string().max(800),
  copywritingHooks: z.array(z.string().max(240)).max(8),
  usps: z.array(z.string().max(240)).max(8),
  cta: z.string().max(160),
  summary: z.string().max(1600),
})

export interface AdCreativeItem extends AdCreativeAnalysisInput {
  readonly id: string
  /** The creative the model sees — an image, or a video's poster frame. Absent = analysed from copy alone. */
  readonly imageUrl?: string
}

export type AdCreativeSkipReason = "deadline" | "failed"

export interface AdCreativeAnalysisResult {
  readonly analysis: AdCreativeAnalysis | null
  readonly reason?: AdCreativeSkipReason
  /** The provider's own error line (already sanitized by the LLM client), for the log. */
  readonly detail?: string
}

export interface AdCreativeAnalysisStats {
  readonly requested: number
  readonly analyzed: number
  readonly failed: number
  readonly skipped: number
  /** Summed provider spend, when every call reported it. */
  readonly providerCostUsd: number
  readonly usageComplete: boolean
}

export interface AnalyzeAdCreativesOptions {
  readonly modelId: string
  readonly deadlineAt: number
  /**
   * The analyst persona. Defaults to the competitor-AD analyst; a scraper of
   * organic content (Instagram / TikTok / LinkedIn posts) passes a post /
   * content-analyst prompt instead. The output shape is the same — the fields
   * (hooks, audiences, USPs, CTA, summary) read for both ads and posts.
   */
  readonly systemPrompt?: string
  readonly concurrency?: number
  readonly now?: () => number
  /** Test seam. */
  readonly complete?: typeof llmCompleteStructured
}

const DEFAULT_CONCURRENCY = 4
/** One analysis answer's output cap — a metered caller sizes each item's hold from it. */
export const AD_CREATIVE_ANALYSIS_MAX_OUTPUT_TOKENS = 1_400

/**
 * The planned call a metered caller holds per requested item BEFORE the items
 * are known: the real request with a creative (an image is sized as an image)
 * and the user's focus — the copy is unknown yet, and D1 collects any overrun
 * at the settle.
 */
export function adCreativeAnalysisPlannedCall(opts: { modelId: string; focus?: string; systemPrompt?: string }): { modelId: string; request: LlmRequest } {
  return {
    modelId: opts.modelId,
    request: adCreativeAnalysisRequest({ imageUrl: "hold://creative", focus: opts.focus }, opts),
  }
}

/**
 * The analysis request for one creative, as it is sent — what a metered
 * caller sizes each item's 1-attempt hold from (`adCreativeAnalysisRequest`
 * with a representative item, before the items are known).
 */
export function adCreativeAnalysisRequest(
  item: Pick<AdCreativeItem, "imageUrl"> & AdCreativeAnalysisInput,
  opts: Pick<AnalyzeAdCreativesOptions, "modelId" | "systemPrompt">,
): LlmRequest {
  const content: LlmContentBlock[] = [{ type: "text", text: buildAdCreativeAnalysisUserText(item) }]
  if (item.imageUrl) content.push({ type: "image", url: item.imageUrl })
  return {
    modelId: opts.modelId,
    system: opts.systemPrompt ?? AD_CREATIVE_ANALYSIS_SYSTEM_PROMPT,
    messages: [{ role: "user", content }],
    maxTokens: AD_CREATIVE_ANALYSIS_MAX_OUTPUT_TOKENS,
  }
}

export async function analyzeAdCreatives(
  items: readonly AdCreativeItem[],
  opts: AnalyzeAdCreativesOptions,
): Promise<{ results: Map<string, AdCreativeAnalysisResult>; stats: AdCreativeAnalysisStats }> {
  const now = opts.now ?? Date.now
  const complete = opts.complete ?? llmCompleteStructured
  const results = new Map<string, AdCreativeAnalysisResult>()
  let providerCostUsd = 0
  let usageComplete = true

  const hitDeadline = await deadlinePool(items, opts.concurrency ?? DEFAULT_CONCURRENCY, opts.deadlineAt, now, async (item) => {
    try {
      const out = await complete(
        adCreativeAnalysisRequest(item, opts),
        adCreativeAnalysisSchema,
        { schemaName: "ad_creative_analysis", maxRetries: 1 },
      )
      if (typeof out.providerCost === "number") providerCostUsd += out.providerCost
      else usageComplete = false
      results.set(item.id, { analysis: out.output })
    } catch (err) {
      results.set(item.id, { analysis: null, reason: "failed", detail: err instanceof Error ? err.message : String(err) })
    }
  })

  for (const item of items) {
    if (!results.has(item.id)) results.set(item.id, { analysis: null, reason: "deadline" })
  }
  const analyzed = [...results.values()].filter((r) => r.analysis !== null).length
  const failed = [...results.values()].filter((r) => r.reason === "failed").length
  return {
    results,
    stats: {
      requested: items.length,
      analyzed,
      failed,
      skipped: items.length - analyzed - failed,
      providerCostUsd,
      usageComplete: usageComplete && !hitDeadline,
    },
  }
}
