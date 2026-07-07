/**
 * LLM Model Registry — shared between frontend and backend.
 *
 * Single source of truth for available chat/LLM models routed through KIE.ai,
 * with direct Anthropic SDK fallback for Claude models. This is the
 * NON-monetary side of the registry (model ids, capabilities, tiers,
 * feature defaults). The provider-$ per-token rate table and the
 * `calculateLlmCost` formula derived from it live in
 * `backend/src/lib/pricing/llm-cost.ts` (core, not ee/ — internal LLM cost
 * logging needs them regardless of edition). They were moved out of this
 * package (published Apache-2.0 on npm — an irrevocable grant) per the
 * 2026-07-06 public-flip IP audit, S5: "Keep the model-id enum; strip prices
 * + measurement notes."
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
  /**
   * How this model can be forced into schema-valid structured output.
   * - "anthropic-tool"       → direct Anthropic SDK forced tool_choice (guaranteed).
   * - "kie-response-format"  → KIE chat-completions `response_format: json_schema`
   *                            (verified enforced for Gemini via KIE).
   * - undefined              → no native structured mode (GPT-via-KIE doesn't honor
   *                            response_format); callers fall back to parse + retry.
   * Capability-driven so `llmCompleteStructured` never hardcodes provider ids.
   */
  structuredOutputMode?: "anthropic-tool" | "kie-response-format"
  /** If set, fallback to direct Anthropic SDK with this model ID when KIE.ai fails */
  directFallbackModel?: string
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
    structuredOutputMode: "kie-response-format",
    supportsImages: true,
    maxOutputTokens: 8192,
  },
  {
    id: "claude-haiku-4.5",
    displayName: "Claude Haiku 4.5",
    desc: "Fast economy, good reasoning",
    tier: "economy",
    kieFormat: "messages",
    kieSlugOrModel: "claude-haiku-4-5",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    supportsImages: true,
    maxOutputTokens: 8192,
    directFallbackModel: "claude-haiku-4-5-20251001",
  },
  {
    id: "claude-sonnet-4.6",
    displayName: "Claude Sonnet 4.6",
    desc: "Balanced quality and speed",
    tier: "standard",
    kieFormat: "messages",
    kieSlugOrModel: "claude-sonnet-4-6",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-sonnet-4-6",
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
  },
  {
    id: "gemini-3.1-pro",
    displayName: "Gemini 3.1 Pro",
    desc: "Advanced reasoning, large context",
    tier: "premium",
    kieFormat: "chat-completions",
    kieSlugOrModel: "gemini-3.1-pro",
    vendor: "google",
    structuredOutputMode: "kie-response-format",
    supportsImages: true,
    maxOutputTokens: 16384,
  },
  {
    id: "claude-opus-4.7",
    displayName: "Claude Opus 4.7",
    desc: "Highest quality, complex tasks",
    tier: "premium",
    kieFormat: "messages",
    kieSlugOrModel: "claude-opus-4-7",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-opus-4-7",
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
  },
] as const

export const LLM_MODEL_IDS = LLM_MODELS.map((m) => m.id)

/** Vision models that can return GUARANTEED structured output — the
 *  describe-to-picker analyzer forces a schema over an image, so its model
 *  pickers AND the backend route gate offer exactly these: Anthropic (forced
 *  tool) + Gemini (KIE `response_format`). GPT-via-KIE has no native structured
 *  mode (parse+retry only), so it's excluded. Single source of truth so the
 *  picker, the config panel, and the route gate can't drift. */
export const STRUCTURED_VISION_MODELS = LLM_MODELS.filter(
  (m) => m.supportsImages && m.structuredOutputMode != null,
)

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
  | "describe-to-picker"
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
  "describe-to-picker": "claude-opus-4.7",
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

/** Models capable of video-analysis: capability-derived, never hand-listed (route-enum-sync convention). */
export const VIDEO_ANALYSIS_LLM_MODELS: string[] = LLM_MODELS
  .filter((m) => getLlmModalityCaps(m.id).video && getLlmModalityCaps(m.id).audio)
  .map((m) => m.id)
