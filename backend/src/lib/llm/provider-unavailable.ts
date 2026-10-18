/**
 * The typed "nothing local can serve this model" error.
 */

import type { LlmModelDef } from "@nodaro/shared/llm-models"
import { config } from "../config.js"
import { describeEmptyCapability, type ProviderKeyName } from "../../providers/provider-keys.js"

/**
 * Nothing local can serve this model. Say which keys WOULD (KIE proxies every
 * model; Anthropic serves the Claude models directly, Gemini the Gemini ones)
 * and whether connecting nodaro.ai is an answer — the shared sentence shape
 * every other provider gap uses, so a self-hoster reads one shape everywhere.
 * Typed so a route can answer 503 provider_unavailable instead of a 500.
 */
export class LlmProviderUnavailableError extends Error {
  readonly code = "provider_unavailable"
  constructor(message: string) {
    super(message)
    this.name = "LlmProviderUnavailableError"
  }
}

export function isLlmProviderUnavailable(err: unknown): err is LlmProviderUnavailableError {
  return err instanceof LlmProviderUnavailableError
    || (typeof err === "object" && err !== null && (err as { code?: unknown }).code === "provider_unavailable")
}

export async function noLlmProviderError(model: LlmModelDef): Promise<LlmProviderUnavailableError> {
  const candidates: ProviderKeyName[] = [
    // A `directOnly` model is never sent to KIE, so its key is no remedy.
    ...(model.directOnly ? [] : (["KIE_API_KEY"] as const)),
    ...(model.directFallbackModel ? (["ANTHROPIC_API_KEY"] as const) : []),
    ...(model.directGeminiModel ? (["GEMINI_API_KEY"] as const) : []),
  ]
  // The connection covers the LLM routes (they proxy to the cloud), so
  // whether it is live decides the remedy the sentence offers.
  const connected = await import("../nodaro-connect.js")
    .then((m) => m.isNodaroConnected())
    .catch(() => false)
  return new LlmProviderUnavailableError(
    describeEmptyCapability(
      "LLM nodes",
      model.id,
      {
        REPLICATE_API_TOKEN: config.REPLICATE_API_TOKEN,
        KIE_API_KEY: config.KIE_API_KEY,
        ELEVENLABS_API_KEY: config.ELEVENLABS_API_KEY,
        ANTHROPIC_API_KEY: config.ANTHROPIC_API_KEY,
        GEMINI_API_KEY: config.GEMINI_API_KEY,
        FAL_KEY: config.FAL_KEY,
        HEYGEN_API_KEY: config.HEYGEN_API_KEY,
        BEEBLE_API_KEY: config.BEEBLE_API_KEY,
        APIFY_API_TOKEN: config.APIFY_API_TOKEN,
      },
      connected,
      candidates,
    ),
  )
}
