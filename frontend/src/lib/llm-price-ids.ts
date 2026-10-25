/**
 * The two ids an LLM call can be priced at, and which one applies.
 *
 * - `key` — the metered price key (`llmPriceKey`: `<feature>:<model>[:direct]`).
 *   The server prices it as an ESTIMATE of the call's usage while metered
 *   pricing is on, and reports it `missing` under the tier-pricing rollback.
 * - `tierId` — today's tier credit id (`buildLlmCreditIdentifier`), the
 *   fallback: what every surface quoted before, and what it still quotes
 *   whenever the server has not marked the key an estimate.
 *
 * Every surface asks the price batch for BOTH in one request, then reads
 * {@link resolveLlmPriceId}. So a cold cache and a rollback look exactly as
 * before (the tier id), and only the server decides that a figure is an
 * estimate. A key the server refuses to price (a metered model with no rate)
 * resolves to the key, which has no price: no figure is shown for a run the
 * server would refuse, rather than the tier's.
 */
import {
  LLM_FEATURE_DEFAULTS,
  buildLlmCreditIdentifier,
  defaultReasoningEffort,
  llmDefaultsFeature,
  llmPriceKey,
  motionGraphicsFeature,
  resolveScriptModelId,
  type LlmFeature,
} from "@nodaro/shared/llm-models"
import { SCRAPE_ANALYSIS_FEATURE, scrapeAnalysisPriceParts, scrapeAnalysisQuoteId } from "@nodaro/shared/social"
import { isTierBilledLlmFeature } from "@nodaro/render-rules"
import { isModelEstimate, isModelRefused } from "@/hooks/use-model-credit-cost"

export interface LlmPriceIds {
  /** The metered price key (an estimate while metered pricing is on). */
  readonly key: string
  /** Today's tier credit id — the fallback. */
  readonly tierId: string
}

/** The model a call of `feature` runs on: the one chosen, else its feature's default. */
export function llmModelFor(feature: string, modelId: string | undefined): string | undefined {
  return modelId || LLM_FEATURE_DEFAULTS[llmDefaultsFeature(feature) as LlmFeature]
}

/**
 * Both price ids of a call of `feature` on `modelId` (unset → the feature's
 * default model). An unset effort is the one the run uses — the feature's
 * recipe effort on that model (describe-to-picker's high on Opus 5.5), else
 * none — for both ids, exactly as the run holds and charges.
 *
 * A feature still billed at its tier row while metered pricing is on
 * (`TIER_BILLED_LLM_FEATURES`, `@nodaro/render-rules` — Workflow Copilot,
 * Content Recipe / Ideas) has no metered key: both ids are its tier id, so no
 * surface ever asks for, or shows, a per-model `≈N` for it.
 */
export function llmPriceIds(
  feature: string,
  modelId: string | undefined,
  reasoningEffort?: string,
  advancedMode?: boolean,
): LlmPriceIds {
  const model = llmModelFor(feature, modelId)
  if (!model) return { key: feature, tierId: feature }
  const effort = reasoningEffort ?? defaultReasoningEffort(llmDefaultsFeature(feature), model)
  const tierId = buildLlmCreditIdentifier(feature, model, effort, advancedMode)
  return { key: isTierBilledLlmFeature(feature) ? tierId : llmPriceKey(feature, model, effort, advancedMode), tierId }
}

/**
 * The id the call is priced at now: the metered key once the server marked it
 * an estimate (or refused it), else the tier id. Reads the session's answers
 * (`use-model-credit-cost`), so it is only as fresh as the last price fetch —
 * a surface that renders it must also fetch both ids (`useLlmPrice`,
 * `runModelIds`).
 */
export function resolveLlmPriceId(ids: LlmPriceIds): string {
  return isModelEstimate(ids.key) || isModelRefused(ids.key) ? ids.key : ids.tierId
}

/**
 * The id the editor learns the server's LLM pricing mode from: Generate Text's
 * price key on its default model. The server answers it as an estimate while it
 * prices LLM calls per model, and `missing` under the tier-pricing rollback. A
 * surface that holds a flag stored while metered (a Component's
 * `estimatedCreditsIsEstimate`) asks for it and honours the flag only while it
 * is an estimate — the server's own gate (`llmMeteredPricing()`).
 */
export function meteredModeProbeId(): string {
  return llmPriceKey("llm-chat", LLM_FEATURE_DEFAULTS["llm-chat"])
}

/** A Component whose stored listing flag says its price holds a metered LLM estimate (not yet gated on the mode). */
export function componentStoredEstimate(node: LlmNodeLike): boolean {
  return node.type === "component" && (node.data as { estimatedCreditsIsEstimate?: unknown } | undefined)?.estimatedCreditsIsEstimate === true
}

/** The node fields the price ids read. */
export interface LlmNodeLike {
  readonly type?: string
  readonly data: unknown
}

/** Map node types that use LLM models to their credit feature names */
export const LLM_NODE_FEATURE_MAP: Record<string, LlmFeature> = {
  "llm-chat": "llm-chat",
  "video-composer": "scene-graph-ai",
  "after-effects": "after-effects",
  "lottie-overlay": "lottie-overlay",
  "3d-title": "3d-title",
  // motion-graphics is handled by an engine-aware special-case in getModelIdentifier
  "generate-script": "generate-script",
  "qa-check": "qa-check",
  "image-to-text": "image-to-text",
  "image-critic": "image-critic",
  // Was missing: its per-node badge priced correctly via its own
  // buildLlmCreditIdentifier call, but the workflow TOTAL fell through to the
  // flat 1-credit NODE_CREDIT_COSTS entry, so a premium model on this node was
  // invisible in the pre-run estimate.
  "describe-to-picker": "describe-to-picker",
}

/** The 3D scene nodes: their run is a `3d-scene` LLM call (metered), but their
 *  tier-era price is their own row, so they are not in the map above. */
const SCENE3D_LLM_NODE_TYPES: ReadonlySet<string> = new Set(["generate-3d-scene", "edit-3d-scene"])

/**
 * The metered LLM feature a node's run is charged under — the feature its
 * route or DAG step reserves on — or undefined for a node with no metered call.
 */
export function llmNodeFeature(node: LlmNodeLike): string | undefined {
  const type = node.type ?? ""
  const data = node.data as Record<string, unknown>
  if (type === "motion-graphics") return motionGraphicsFeature(data.engine as string | undefined)
  // A deterministic Edit 3D Scene (`operations`) reaches no model: the server prices it free.
  if (type === "edit-3d-scene" && Array.isArray(data.operations)) return undefined
  if (SCENE3D_LLM_NODE_TYPES.has(type)) return "3d-scene"
  // Choose Best: only the AI judge strategy makes a (metered) LLM call; every
  // other strategy is pure logic.
  if (type === "reduce") return data.strategyId === CHOOSE_BEST_JUDGE_STRATEGY ? CHOOSE_BEST_JUDGE_FEATURE : undefined
  return LLM_NODE_FEATURE_MAP[type]
}

/** Choose Best's AI judge strategy, and the credit feature its call is billed under. */
const CHOOSE_BEST_JUDGE_STRATEGY = "pick-best-llm"
const CHOOSE_BEST_JUDGE_FEATURE = "reduce:pick-best-llm"

/** The model a metered node's call runs on as stored: the Choose Best judge's
 *  in its strategy config, every other node's in `llmModel`. */
function storedLlmModel(node: LlmNodeLike, data: Record<string, unknown>): string | undefined {
  if (node.type === "reduce") {
    const config = data.strategyConfig as Record<string, unknown> | undefined
    return typeof config?.llmModel === "string" ? config.llmModel : undefined
  }
  return data.llmModel as string | undefined
}

/**
 * A metered LLM node's two price ids (`llmPriceIds`): the metered key and the
 * tier id it falls back to. Undefined for any other node. `runModelIds` asks
 * the price batch for both; `getModelIdentifier` names the key once the server
 * has priced it as an estimate.
 */
export function llmNodePriceIds(node: LlmNodeLike): LlmPriceIds | undefined {
  const feature = llmNodeFeature(node)
  if (!feature) return undefined
  const data = node.data as Record<string, unknown>
  const effort = data.reasoningEffort as string | undefined
  const ids = llmPriceIds(feature, storedLlmModel(node, data), effort, data.advancedMode === true)
  // Generate Script: the metered call runs the model the run resolves — a legacy script provider
  // maps to its model (the shared `resolveScriptModelId`, the server's own rule). The tier id stays
  // the one its rollback run bills.
  if (node.type === "generate-script") {
    const model = resolveScriptModelId(data.provider as string | undefined, data.llmModel as string | undefined)
    return { ...ids, key: llmPriceIds(feature, model, effort, data.advancedMode === true).key }
  }
  return ids
}

/** A scrape's AI analysis priced per call (metered): its fixed scrape id, the analysis price key, the items, and the whole analysis's quote id. */
export interface ScrapeAnalysisPriceIds {
  readonly fixedId: string
  readonly key: string
  readonly items: number
  /** `<key>:<items>u` — the whole analysis as ONE id, priced as the run is held (rounded and marked up once). */
  readonly quoteId: string
}

/**
 * A Meta Ads or Instagram scrape with AI analysis: what its run is charged in
 * two parts — the scrape's fixed id, and `items` analysis calls at the
 * analysis model's price key — by the server's own rule
 * (`scrapeAnalysisPriceParts`). Undefined for a scrape without analysis and
 * every other node. While the server answers the key as an estimate, the run
 * is priced fixed + items × that estimate (`≈`); otherwise at its tier id.
 */
export function scrapeAnalysisPriceIds(node: LlmNodeLike): ScrapeAnalysisPriceIds | undefined {
  const parts = scrapeAnalysisPriceParts({ type: node.type, data: node.data as Record<string, unknown> })
  return parts ? { fixedId: parts.fixedId, key: llmPriceKey(SCRAPE_ANALYSIS_FEATURE, parts.analysisModel), items: parts.items, quoteId: scrapeAnalysisQuoteId(parts) } : undefined
}

/**
 * The credits a run of a scrape with analysis is charged while metered
 * pricing is on — the fixed scrape plus the WHOLE analysis's quote
 * (`quoteId`: the server's own figure, the estimate × the items rounded and
 * marked up once — exactly its estimate), once the server has answered the
 * quote as an estimate and both prices are cached; undefined otherwise (then
 * its tier id prices it, as before).
 */
export function scrapeAnalysisRunCredits(node: LlmNodeLike, cachedCost: (id: string) => number | undefined): number | undefined {
  const ids = scrapeAnalysisPriceIds(node)
  if (!ids || !isModelEstimate(ids.quoteId)) return undefined
  const fixed = cachedCost(ids.fixedId)
  const analysis = cachedCost(ids.quoteId)
  return fixed === undefined || analysis === undefined ? undefined : fixed + analysis
}
