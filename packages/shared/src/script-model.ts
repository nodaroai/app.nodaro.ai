/**
 * The model a Generate Script call runs on, in one place: an explicit
 * `llmModel`, else a legacy script `provider` alias (nodes saved before the
 * per-model picker), else the feature's default. The route validates against
 * it, the worker runs it, and the server's estimate and the editor's price it —
 * one rule, so none of them can name a different model.
 */
import { LLM_FEATURE_DEFAULTS } from "./llm-models.js"
import type { ScriptProvider } from "./model-constants.js"

/** Legacy provider names → the LLM model ids they ran. */
export const SCRIPT_LEGACY_PROVIDER_MODELS: Readonly<Record<ScriptProvider, string>> = {
  gemini: "gemini-3.6-flash",
  claude: "claude-sonnet-4.6",
  gpt: "gpt-5.2",
}

export function resolveScriptModelId(provider?: string, llmModel?: string): string {
  const legacy = provider && Object.hasOwn(SCRIPT_LEGACY_PROVIDER_MODELS, provider) ? SCRIPT_LEGACY_PROVIDER_MODELS[provider as ScriptProvider] : undefined
  return llmModel || legacy || LLM_FEATURE_DEFAULTS["generate-script"]
}
