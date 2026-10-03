import { buildLlmCreditIdentifier, getLlmModel, LLM_FEATURE_DEFAULTS } from "./llm-models.js"

/**
 * Pricing vocabulary for the "steal the format" nodes — Content Recipe and
 * Content Ideas. Public prices only: the credit ids a run is billed under and
 * the count rule that picks between them. One copy for the editor's credit
 * badge, the workflow orchestrator's reservation and the pre-run estimate;
 * the cloud plugin that runs the nodes computes the same ids.
 *
 * Content Ideas is charged per batch of up to five ideas: a run of 1–5 ideas
 * bills `content-ideas[:economy|:premium]`, a run of 6–10 bills
 * `content-ideas:10[:economy|:premium]`, priced at two batches.
 */

export const CONTENT_IDEAS_MAX_COUNT = 10
export const CONTENT_IDEAS_DEFAULT_COUNT = 5
export const CONTENT_IDEAS_PER_CHARGE = 5

/** Request limits the cloud routes enforce — the orchestrator trims to the
 *  same bounds, since its payload never passes the route's validation. */
export const CONTENT_RECIPE_SOURCE_MAX = 300_000
export const CONTENT_IDEAS_MAX_RECIPE_INPUTS = 20
export const CONTENT_IDEAS_BRAND_MAX = 6_000
export const CONTENT_IDEAS_LANGUAGE_MAX = 40

/** A whole number of ideas in 1..10; anything but a finite number is the
 *  default. (The plugin reads `count` the same way — numbers only.) */
export function clampContentIdeasCount(raw: unknown): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? Math.floor(raw) : CONTENT_IDEAS_DEFAULT_COUNT
  return Math.min(CONTENT_IDEAS_MAX_COUNT, Math.max(1, n))
}

/** The billing feature for a run of `count` ideas. */
export function contentIdeasCreditFeature(count: number): "content-ideas" | "content-ideas:10" {
  return count > CONTENT_IDEAS_PER_CHARGE ? "content-ideas:10" : "content-ideas"
}

/** The model a node runs: its own pick when the registry can return
 *  structured output, else the feature default. Billing uses THIS — a missing
 *  model must never bill the bare (standard) id while running economy. */
export function effectiveContentModel(feature: "content-recipe" | "content-ideas", llmModel: unknown): string {
  if (typeof llmModel === "string" && getLlmModel(llmModel)?.structuredOutputMode != null) return llmModel
  return LLM_FEATURE_DEFAULTS[feature]
}

export function contentRecipeCreditId(llmModel?: unknown, reasoningEffort?: string): string {
  return buildLlmCreditIdentifier("content-recipe", effectiveContentModel("content-recipe", llmModel), reasoningEffort)
}

export function contentIdeasCreditId(count: unknown, llmModel?: unknown, reasoningEffort?: string): string {
  return buildLlmCreditIdentifier(
    contentIdeasCreditFeature(clampContentIdeasCount(count)),
    effectiveContentModel("content-ideas", llmModel),
    reasoningEffort,
  )
}

/** Every credit id the two nodes can bill — for price tables and guards. */
export const CONTENT_RECIPE_IDEAS_CREDIT_IDS = [
  "content-recipe:economy",
  "content-recipe",
  "content-recipe:premium",
  "content-ideas:economy",
  "content-ideas",
  "content-ideas:premium",
  "content-ideas:10:economy",
  "content-ideas:10",
  "content-ideas:10:premium",
] as const
