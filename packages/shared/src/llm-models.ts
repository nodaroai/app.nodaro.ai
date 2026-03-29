/**
 * LLM Model Registry — shared between frontend and backend.
 *
 * Single source of truth for available chat/LLM models routed through KIE.ai,
 * with direct Anthropic SDK fallback for Claude models.
 */

export type LlmTier = "economy" | "standard" | "premium"
export type KieApiFormat = "chat-completions" | "messages" | "responses"

export interface LlmModelDef {
  id: string
  displayName: string
  tier: LlmTier
  kieFormat: KieApiFormat
  /** For chat-completions: the slug prefix (e.g. "gemini-3-flash").
   *  For messages: the model id sent in the body (e.g. "claude-haiku-4-5-v1messages").
   *  For responses: the model id sent in the body (e.g. "gpt-5-4"). */
  kieSlugOrModel: string
  vendor: "anthropic" | "google" | "openai"
  supportsImages: boolean
  maxOutputTokens: number
  /** If set, fallback to direct Anthropic SDK with this model ID when KIE.ai fails */
  directFallbackModel?: string
  /** Cost per million input tokens (USD) */
  inputPricePerM: number
  /** Cost per million output tokens (USD) */
  outputPricePerM: number
}

export const LLM_MODELS: readonly LlmModelDef[] = [
  {
    id: "gemini-3-flash",
    displayName: "Gemini 3 Flash",
    tier: "economy",
    kieFormat: "chat-completions",
    kieSlugOrModel: "gemini-3-flash",
    vendor: "google",
    supportsImages: true,
    maxOutputTokens: 8192,
    inputPricePerM: 0.10,
    outputPricePerM: 0.40,
  },
  {
    id: "claude-haiku-4.5",
    displayName: "Claude Haiku 4.5",
    tier: "economy",
    kieFormat: "messages",
    kieSlugOrModel: "claude-haiku-4-5",
    vendor: "anthropic",
    supportsImages: true,
    maxOutputTokens: 8192,
    directFallbackModel: "claude-haiku-4-5-20251001",
    inputPricePerM: 0.80,
    outputPricePerM: 4.00,
  },
  {
    id: "claude-sonnet-4.6",
    displayName: "Claude Sonnet 4.6",
    tier: "standard",
    kieFormat: "messages",
    kieSlugOrModel: "claude-sonnet-4-6",
    vendor: "anthropic",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-sonnet-4-6",
    inputPricePerM: 3.00,
    outputPricePerM: 15.00,
  },
  {
    id: "gpt-5.2",
    displayName: "GPT-5.2",
    tier: "standard",
    kieFormat: "chat-completions",
    kieSlugOrModel: "gpt-5-2",
    vendor: "openai",
    supportsImages: true,
    maxOutputTokens: 16384,
    inputPricePerM: 2.50,
    outputPricePerM: 10.00,
  },
  {
    id: "gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    tier: "premium",
    kieFormat: "chat-completions",
    kieSlugOrModel: "gemini-3.1-pro",
    vendor: "google",
    supportsImages: true,
    maxOutputTokens: 16384,
    inputPricePerM: 3.50,
    outputPricePerM: 10.50,
  },
  {
    id: "claude-opus-4.6",
    displayName: "Claude Opus 4.6",
    tier: "premium",
    kieFormat: "messages",
    kieSlugOrModel: "claude-opus-4-6",
    vendor: "anthropic",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-opus-4-6",
    inputPricePerM: 15.00,
    outputPricePerM: 75.00,
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    tier: "premium",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-5-4",
    vendor: "openai",
    supportsImages: true,
    maxOutputTokens: 16384,
    inputPricePerM: 10.00,
    outputPricePerM: 40.00,
  },
] as const

export const LLM_MODEL_IDS = LLM_MODELS.map((m) => m.id)

/** Calculate provider cost in USD from token usage and model pricing. */
export function calculateLlmCost(
  modelOrId: string | LlmModelDef,
  usage: { inputTokens: number; outputTokens: number },
): number {
  const model = typeof modelOrId === "string" ? getLlmModel(modelOrId) : modelOrId
  if (!model) return 0
  return (usage.inputTokens * model.inputPricePerM + usage.outputTokens * model.outputPricePerM) / 1_000_000
}

export type LlmFeature =
  | "ai-writer"
  | "llm-chat"
  | "prompt-helper"
  | "scene-graph-ai"
  | "after-effects"
  | "motion-graphics"
  | "lottie-overlay"
  | "3d-title"
  | "image-to-text"
  | "qa-check"
  | "generate-script"
  | "translate"

/** Feature → default model when user hasn't selected one */
export const LLM_FEATURE_DEFAULTS: Record<LlmFeature, string> = {
  "ai-writer": "claude-sonnet-4.6",
  "llm-chat": "gemini-3-flash",
  "prompt-helper": "gemini-3-flash",
  "scene-graph-ai": "claude-sonnet-4.6",
  "after-effects": "claude-sonnet-4.6",
  "motion-graphics": "claude-sonnet-4.6",
  "lottie-overlay": "claude-sonnet-4.6",
  "3d-title": "claude-sonnet-4.6",
  "image-to-text": "claude-sonnet-4.6",
  "qa-check": "claude-sonnet-4.6",
  "generate-script": "gemini-3-flash",
  "translate": "gemini-3-flash",
}

export function getLlmModel(id: string): LlmModelDef | undefined {
  return LLM_MODELS.find((m) => m.id === id)
}

export function getLlmTier(id: string): LlmTier {
  return getLlmModel(id)?.tier ?? "standard"
}

/**
 * Build a composite credit identifier for an LLM feature.
 * - economy tier → "ai-writer:economy"
 * - standard tier → "ai-writer" (no suffix — backward compatible)
 * - premium tier → "ai-writer:premium"
 */
export function buildLlmCreditIdentifier(feature: string, modelId?: string): string {
  if (!modelId) return feature
  const tier = getLlmTier(modelId)
  if (tier === "standard") return feature
  return `${feature}:${tier}`
}

/**
 * Resolve llmModel from raw body for creditGuard preHandler (before Zod parsing).
 * Returns the credit identifier for the given feature + optional model.
 */
export function resolveLlmCreditId(feature: string, body: unknown): string {
  const llmModel = (body as Record<string, unknown>)?.llmModel as string | undefined
  return buildLlmCreditIdentifier(feature, llmModel)
}
