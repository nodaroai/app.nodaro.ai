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
  desc: string
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
    desc: "Fast and cheap, good for simple tasks",
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
    desc: "Fast economy, good reasoning",
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
    desc: "Balanced quality and speed",
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
    desc: "Strong general purpose",
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
    desc: "Advanced reasoning, large context",
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
    id: "claude-opus-4.7",
    displayName: "Claude Opus 4.7",
    desc: "Highest quality, complex tasks",
    tier: "premium",
    kieFormat: "messages",
    kieSlugOrModel: "claude-opus-4-7",
    vendor: "anthropic",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-opus-4-7",
    inputPricePerM: 5.00,
    outputPricePerM: 25.00,
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    desc: "Latest GPT, premium quality",
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
  | "motion-graphics-lottie"
  | "lottie-overlay"
  | "3d-title"
  | "image-to-text"
  | "qa-check"
  | "generate-script"
  | "translate"
  | "image-critic"

/** Engine-dependent LlmFeature for the motion-graphics node (design §8: every credit-id site must branch on engine). */
export function motionGraphicsFeature(engine?: string): LlmFeature {
  return engine === "lottie" ? "motion-graphics-lottie" : "motion-graphics"
}

/** Feature → default model when user hasn't selected one */
export const LLM_FEATURE_DEFAULTS: Record<LlmFeature, string> = {
  "ai-writer": "claude-sonnet-4.6",
  "llm-chat": "gemini-3-flash",
  "prompt-helper": "gemini-3-flash",
  "scene-graph-ai": "claude-sonnet-4.6",
  "after-effects": "claude-sonnet-4.6",
  "motion-graphics": "claude-sonnet-4.6",
  "motion-graphics-lottie": "claude-sonnet-4.6",
  "lottie-overlay": "claude-sonnet-4.6",
  "3d-title": "claude-sonnet-4.6",
  "image-to-text": "claude-sonnet-4.6",
  "qa-check": "claude-sonnet-4.6",
  "generate-script": "gemini-3-flash",
  "translate": "gemini-3-flash",
  "image-critic": "claude-sonnet-4.6",
}

/**
 * Per-model multimodal input capabilities. Drives both frontend UI gating
 * and backend route-level filtering for the LLM Chat node references.
 *
 * As of 2026-05: Claude Messages API supports text + image only (no audio,
 * no video). Gemini 2/3 family supports image + video + audio natively.
 * GPT-5.x via KIE chat-completions / responses supports image only — audio
 * input requires a separate audio-capable model we don't route to today.
 */
export const LLM_MODALITY_CAPS: Record<string, { image: boolean; video: boolean; audio: boolean }> = {
  "gemini-3-flash":    { image: true,  video: true,  audio: true  },
  "gemini-3.1-pro":    { image: true,  video: true,  audio: true  },
  "claude-haiku-4.5":  { image: true,  video: false, audio: false },
  "claude-sonnet-4.6": { image: true,  video: false, audio: false },
  "claude-opus-4.7":   { image: true,  video: false, audio: false },
  "gpt-5.2":           { image: true,  video: false, audio: false },
  "gpt-5.4":           { image: true,  video: false, audio: false },
}

/** Capability lookup with safe default — unknown models get image-only. */
export function getLlmModalityCaps(modelId: string | undefined): { image: boolean; video: boolean; audio: boolean } {
  if (!modelId) return { image: true, video: false, audio: false }
  return LLM_MODALITY_CAPS[modelId] ?? { image: true, video: false, audio: false }
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
