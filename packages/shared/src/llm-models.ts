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

export const LLM_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const
export type LlmReasoningEffort = (typeof LLM_REASONING_EFFORTS)[number]
/** Levels that bill one tier up. `high` is the Claude-family server default — it never bumps. */
export const EFFORT_TIER_BUMP: ReadonlySet<LlmReasoningEffort> = new Set(["xhigh", "max"])
const EFFORT_RANK: Record<LlmReasoningEffort, number> = { none: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }

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
   * - "anthropic-tool"          → forced tool_choice on the Claude wire (direct SDK
   *                               guaranteed; KIE's proxy re-serializes the tool call
   *                               as a `<tool_calls>` text tag — decoded in llm-client).
   * - "kie-response-format"     → KIE chat-completions `response_format: json_schema`
   *                               (verified enforced for Gemini via KIE).
   * - "responses-json-schema"   → KIE codex/v1/responses `text.format: json_schema`
   *                               (live-verified 2026-07-14 for gpt-5.4/5.5 and the
   *                               whole GPT-5.6 family, text AND vision inputs).
   * - undefined                 → no native mode; callers fall back to parse + retry.
   * Capability-driven so `llmCompleteStructured` never hardcodes provider ids.
   */
  structuredOutputMode?: "anthropic-tool" | "kie-response-format" | "responses-json-schema"
  /** If set, fallback to direct Anthropic SDK with this model ID when KIE.ai fails */
  directFallbackModel?: string
  /** Effort levels this model accepts (ascending). Absent/empty = no effort lever, picker hidden. */
  reasoningEfforts?: readonly LlmReasoningEffort[]
  /** false = model rejects `temperature` (Claude 5-era, GPT-5.6). Absent = accepts. */
  supportsTemperature?: false
  /** Claude-only: KIE is the preferred routing, direct Anthropic the fallback. */
  preferKie?: true
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
    reasoningEfforts: ["low", "medium", "high", "max"],
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
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
    preferKie: true,
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    desc: "Latest GPT, premium quality",
    tier: "premium",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-5-4",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    reasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gpt-5.5",
    displayName: "GPT-5.5",
    desc: "Previous flagship GPT, deep reasoning",
    tier: "premium",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-5-5",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
  },
  {
    id: "gpt-5.6-luna",
    displayName: "GPT-5.6 Luna",
    desc: "Fastest GPT-5.6, high-volume workloads",
    tier: "economy",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-5-6-luna",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
  },
  {
    id: "gpt-5.6-terra",
    displayName: "GPT-5.6 Terra",
    desc: "Balanced GPT-5.6 for production work",
    tier: "standard",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-5-6-terra",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
  },
  {
    id: "gpt-5.6-sol",
    displayName: "GPT-5.6 Sol",
    desc: "Flagship GPT-5.6, deepest reasoning",
    tier: "premium",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-5-6-sol",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
  },
  // grok-4.5 deferred — KIE chat endpoint not yet live (2026-07-13); add entry + rate row + docs when it activates.
  {
    id: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    desc: "Near-Opus quality at Sonnet cost",
    tier: "standard",
    kieFormat: "messages",
    kieSlugOrModel: "claude-sonnet-5",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-sonnet-5",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
    preferKie: true,
  },
  {
    id: "claude-opus-4.8",
    displayName: "Claude Opus 4.8",
    desc: "Most capable Claude, long-horizon work",
    tier: "premium",
    kieFormat: "messages",
    kieSlugOrModel: "claude-opus-4-8",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-opus-4-8",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
    preferKie: true,
  },
] as const

export const LLM_MODEL_IDS = LLM_MODELS.map((m) => m.id)

/** Vision models that can return GUARANTEED structured output — the
 *  describe-to-picker analyzer forces a schema over an image, so its model
 *  pickers AND the backend route gate offer exactly these: Anthropic (forced
 *  tool), Gemini (KIE `response_format`), and GPT responses-format models
 *  (KIE `text.format` json_schema — vision+schema live-verified 2026-07-14).
 *  Single source of truth so the picker, the config panel, and the route gate
 *  can't drift. */
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
  "gpt-5.5":           { image: true,  video: false, audio: false },
  "gpt-5.6-luna":      { image: true,  video: false, audio: false },
  "gpt-5.6-terra":     { image: true,  video: false, audio: false },
  "gpt-5.6-sol":       { image: true,  video: false, audio: false },
  "claude-sonnet-5":   { image: true,  video: false, audio: false },
  "claude-opus-4.8":   { image: true,  video: false, audio: false },
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

/** Highest level the model supports that is ≤ the requested level; undefined = treat as Auto. */
export function effectiveReasoningEffort(
  modelId: string | undefined,
  requested?: string,
): LlmReasoningEffort | undefined {
  if (!requested || !(requested in EFFORT_RANK)) return undefined
  const levels = getLlmModel(modelId ?? "")?.reasoningEfforts
  if (!levels || levels.length === 0) return undefined
  const req = requested as LlmReasoningEffort
  let best: LlmReasoningEffort | undefined
  for (const l of levels) {
    if (EFFORT_RANK[l] <= EFFORT_RANK[req] && (best === undefined || EFFORT_RANK[l] > EFFORT_RANK[best])) best = l
  }
  return best
}

/**
 * Build a composite credit identifier for an LLM feature.
 * - economy tier → "ai-writer:economy"
 * - standard tier → "ai-writer" (no suffix — backward compatible)
 * - premium tier → "ai-writer:premium"
 * A reasoning effort of "xhigh" or "max" (after clamping to what the model
 * actually supports) bills one tier up (economy→standard, standard→premium;
 * premium stays premium). `high` is the Claude-family server default and
 * never bumps.
 */
export function buildLlmCreditIdentifier(feature: string, modelId?: string, reasoningEffort?: string): string {
  if (!modelId) return feature
  let tier = getLlmTier(modelId)
  const eff = effectiveReasoningEffort(modelId, reasoningEffort)
  if (eff !== undefined && EFFORT_TIER_BUMP.has(eff)) {
    if (tier === "economy") tier = "standard"
    else if (tier === "standard") tier = "premium"
  }
  if (tier === "standard") return feature
  return `${feature}:${tier}`
}

/**
 * Resolve llmModel (+ reasoningEffort) from raw body for creditGuard preHandler
 * (before Zod parsing). Returns the credit identifier for the given feature.
 */
export function resolveLlmCreditId(feature: string, body: unknown): string {
  const b = body as Record<string, unknown> | undefined
  return buildLlmCreditIdentifier(feature, b?.llmModel as string | undefined, b?.reasoningEffort as string | undefined)
}

/** Models capable of video-analysis: capability-derived, never hand-listed (route-enum-sync convention). */
export const VIDEO_ANALYSIS_LLM_MODELS: string[] = LLM_MODELS
  .filter((m) => getLlmModalityCaps(m.id).video && getLlmModalityCaps(m.id).audio)
  .map((m) => m.id)

/**
 * Video-analysis quality TIERS — the ONLY analyzer identifiers exposed to users
 * (API, UI, docs). Each maps to an internal analysis model; the underlying
 * vendor/model name is never surfaced. Default is `pro`. The guard test
 * (video-analysis-pricing.test.ts) asserts every tier target is a real
 * VIDEO_ANALYSIS_LLM_MODELS member AND every such model is reachable by a tier,
 * so adding a video model forces a tier decision instead of silently leaking.
 */
export const VIDEO_ANALYSIS_TIERS = { fast: "gemini-3-flash", pro: "gemini-3.1-pro" } as const
export type VideoAnalysisModelTier = keyof typeof VIDEO_ANALYSIS_TIERS
/**
 * MIXED tiers — multi-model best-of-N plans (3× fast + 2× pro rolls) whose
 * identifier resolves to a roll-plan SENTINEL consumed by the analysis engine,
 * never to a single model id. Two variants, identical compute + price
 * (one shared `video-analysis:mixed:*` credit family):
 *  - `mixed`      — the judge may pick ANY roll as the winning skeleton.
 *  - `mixed-fast` — the judge picks among the fast rolls only (consistent fast
 *                   skeleton); pro rolls act purely as refine-pass donors.
 * The plan composition itself (roll counts, judge scope) is engine-internal —
 * deliberately NOT published here (Apache irrevocability; only the wire
 * vocabulary below is contract).
 */
export const VIDEO_ANALYSIS_MIXED_TIERS = ["mixed", "mixed-fast"] as const
export type VideoAnalysisMixedTier = (typeof VIDEO_ANALYSIS_MIXED_TIERS)[number]
/** UI/listing order — recommended (pro) first. */
export const VIDEO_ANALYSIS_TIER_ORDER = ["pro", "fast", "mixed", "mixed-fast"] as const
export type VideoAnalysisTier = (typeof VIDEO_ANALYSIS_TIER_ORDER)[number]
export const DEFAULT_VIDEO_ANALYSIS_TIER: VideoAnalysisTier = "pro"
export const DEFAULT_VIDEO_ANALYSIS_MODEL: string = VIDEO_ANALYSIS_TIERS[DEFAULT_VIDEO_ANALYSIS_TIER]
/** Neutral, vendor-free display labels for the UI. */
export const VIDEO_ANALYSIS_TIER_LABELS: Record<VideoAnalysisTier, string> = {
  fast: "Fast",
  pro: "Pro",
  mixed: "Mixed (best of all)",
  "mixed-fast": "Mixed (Fast base)",
}

export function isVideoAnalysisTier(v: string): v is VideoAnalysisTier {
  return (VIDEO_ANALYSIS_TIER_ORDER as readonly string[]).includes(v)
}

export function isVideoAnalysisMixedTier(v: string): v is VideoAnalysisMixedTier {
  return (VIDEO_ANALYSIS_MIXED_TIERS as readonly string[]).includes(v)
}

/**
 * Resolve a user-supplied tier OR a raw internal model id to the analysis
 * ENGINE IDENTIFIER carried in the worker payload:
 *  - model-backed tiers ("fast"/"pro") → the internal model id;
 *  - mixed tiers ("mixed"/"mixed-fast") → the sentinel ITSELF (the engine
 *    expands it to a multi-model roll plan);
 *  - raw model ids pass through (back-compat for stored `llmModel` values);
 *  - empty/unknown → the default tier's model (never an error).
 */
export function resolveVideoAnalysisModel(input?: string | null): string {
  if (input && isVideoAnalysisMixedTier(input)) return input
  if (input && Object.prototype.hasOwnProperty.call(VIDEO_ANALYSIS_TIERS, input)) {
    return VIDEO_ANALYSIS_TIERS[input as VideoAnalysisModelTier]
  }
  if (input && VIDEO_ANALYSIS_LLM_MODELS.includes(input)) return input
  return DEFAULT_VIDEO_ANALYSIS_MODEL
}
