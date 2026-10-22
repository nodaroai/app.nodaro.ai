/**
 * The token size a metered LLM call is EXPECTED to have, per credit feature —
 * what the pre-run estimate (`~X CR`) prices on a model's rates
 * (`llmEstimateBaseCredits`). Never what a call is charged: the charge is the
 * call's own usage, and the reservation is the ceiling.
 *
 * Seeded from the measured sizes in the metered-pricing design (describe- and
 * text-to-picker, the structured lane, Generate Text); every other feature
 * carries a placeholder 2k/2k until the measurement script (median usage of
 * the feature's completed jobs) refreshes this table.
 */
import { LLM_FEATURE_DEFAULTS, type LlmFeature } from "@nodaro/shared/llm-models"
import { isTierBilledLlmFeature, type TierBilledLlmFeature } from "@nodaro/render-rules"

/**
 * A credit feature that bills metered: every {@link LlmFeature} except
 * `pick-best-llm`, which bills under its reduce credit id
 * `reduce:pick-best-llm`, and except the features still billed at their tier
 * row (`TIER_BILLED_LLM_FEATURES` in `@nodaro/render-rules`: Workflow Copilot's
 * own ceilings, Content Recipe / Ideas until their plugin meters) — plus the
 * two LLM callers that are not an `LlmFeature` (`POST /v1/llm/structured` and
 * Text to Picker).
 */
export type MeteredLlmFeature =
  | Exclude<LlmFeature, "pick-best-llm" | TierBilledLlmFeature>
  | "llm-structured"
  | "text-to-picker"
  | "reduce:pick-best-llm"

export interface LlmTypicalUsage {
  inputTokens: number
  outputTokens: number
}

const UNMEASURED: LlmTypicalUsage = { inputTokens: 2000, outputTokens: 2000 }

/** Typed as a total record, so a new {@link LlmFeature} fails typecheck until it has a row here. */
export const LLM_TYPICAL_USAGE: Readonly<Record<MeteredLlmFeature, Readonly<LlmTypicalUsage>>> = {
  "describe-to-picker": { inputTokens: 35000, outputTokens: 1500 },
  "text-to-picker": { inputTokens: 99000, outputTokens: 4000 },
  "llm-structured": { inputTokens: 10000, outputTokens: 12000 },
  "llm-chat": { inputTokens: 1000, outputTokens: 1000 },
  "ai-writer": UNMEASURED,
  "prompt-helper": UNMEASURED,
  "scene-graph-ai": UNMEASURED,
  "after-effects": UNMEASURED,
  "motion-graphics": UNMEASURED,
  "motion-graphics-lottie": UNMEASURED,
  "lottie-overlay": UNMEASURED,
  "3d-title": UNMEASURED,
  "3d-scene": UNMEASURED,
  "image-to-text": UNMEASURED,
  "meta-ads-analysis": UNMEASURED,
  "qa-check": UNMEASURED,
  "generate-script": UNMEASURED,
  "translate": UNMEASURED,
  "image-critic": UNMEASURED,
  "reduce:pick-best-llm": UNMEASURED,
}

/**
 * Every metered credit feature — derived from the shared feature registry
 * (`LLM_FEATURE_DEFAULTS`, a runtime record of every {@link LlmFeature}), not
 * from {@link LLM_TYPICAL_USAGE}, so a guard that walks this list checks the
 * table rather than itself.
 */
export const METERED_LLM_FEATURES: readonly MeteredLlmFeature[] = [
  ...(Object.keys(LLM_FEATURE_DEFAULTS) as LlmFeature[]).filter(
    (f): f is Exclude<LlmFeature, "pick-best-llm" | TierBilledLlmFeature> => f !== "pick-best-llm" && !isTierBilledLlmFeature(f),
  ),
  "llm-structured",
  "text-to-picker",
  "reduce:pick-best-llm",
]
