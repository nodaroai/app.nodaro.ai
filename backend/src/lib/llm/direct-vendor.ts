/**
 * Whose API a model's direct lane is — read off the registry field that
 * names the model there: `directGeminiModel` → Google, `directFallbackModel`
 * → Anthropic. The one reading the router, the served-lane labels and
 * provider attribution share. Pure: imports only the registry type.
 */
import type { LlmModelDef } from "@nodaro/shared/llm-models"

export type LlmDirectVendor = "google" | "anthropic"

/** The vendor of the model's direct lane, or null when it has none (KIE only). */
export function directLaneVendor(model: Pick<LlmModelDef, "directGeminiModel" | "directFallbackModel">): LlmDirectVendor | null {
  if (model.directGeminiModel) return "google"
  if (model.directFallbackModel) return "anthropic"
  return null
}
