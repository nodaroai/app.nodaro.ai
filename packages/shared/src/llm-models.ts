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
export type LlmVendor = "anthropic" | "google" | "openai" | "xai"

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
  vendor: LlmVendor
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
  /**
   * Google Gemini API model id for the DIRECT lane (generativelanguage, keyed
   * by `GEMINI_API_KEY`) — the Google-side twin of `directFallbackModel`.
   * Presence declares "this model CAN be served straight from Google"; absence
   * pins it to KIE forever. Stated, never derived: Google carries `-preview`
   * suffixes on unreleased models, so the id routinely differs from both `id`
   * and `kieSlugOrModel` (`gemini-3.1-pro` → `gemini-3.1-pro-preview`).
   */
  directGeminiModel?: string
  /**
   * Try the direct-vendor lane FIRST for this model, with KIE as the failure
   * fallback. Absent (while `directGeminiModel` is set) = KIE first, direct
   * only when KIE fails.
   *
   * This is a per-model COST decision, not just a routing one: the two lanes
   * bill the same model at materially different unit rates, so a model that
   * backs a high-volume default (see `LLM_FEATURE_DEFAULTS`) is usually better
   * left on whichever lane is cheaper. The rate tables for both lanes live in
   * `backend/src/lib/pricing/llm-cost.ts` — deliberately not in this package,
   * which is published to npm.
   *
   * Mutually exclusive with `preferKie` — the Claude-side half of the same
   * idea. Guarded by a registry test so the two can't both be set.
   */
  preferDirect?: true
  /** Effort levels this model accepts (ascending). Absent/empty = no effort lever, picker hidden. */
  reasoningEfforts?: readonly LlmReasoningEffort[]
  /**
   * Effort levels available on the DIRECT lane, when the vendor's own API
   * accepts more than the aggregator does. Absent = the direct lane offers the
   * same set as `reasoningEfforts`.
   *
   * This exists because `reasoningEfforts` has to stay at the KIE-safe
   * intersection — sending a level KIE rejects is a hard failure — while the
   * vendor API accepts the full ladder. Unlocking those extra levels is one of
   * the concrete things Advanced mode buys.
   */
  directReasoningEfforts?: readonly LlmReasoningEffort[]
  /** false = model rejects `temperature` (Claude 5-era, GPT-5.6). Absent = accepts. */
  supportsTemperature?: false
  /** Claude-only: KIE is the preferred routing, direct Anthropic the fallback. */
  preferKie?: true
  /**
   * true = the model reasons even when NO thinking parameter is sent, so its
   * reasoning tokens share the `max_tokens` budget on EVERY call — not just
   * effort-bearing ones. Claude Opus 5 flipped this default (on Opus 4.8/4.7
   * and Sonnet 5, omitting `thinking` means no thinking at all).
   *
   * Consumers MUST give such a model output headroom regardless of the
   * requested effort, or reasoning silently eats a small legacy cap and the
   * answer truncates with `stop_reason: max_tokens` — a paid-for empty reply,
   * not an error. `deriveParams` (llm-client.ts) and the film-pipeline's
   * `callLLM` both floor on this flag; keep it in sync with the vendor's
   * documented default rather than inferring it from the model name.
   */
  thinkingDefaultOn?: true
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
    // KIE-first: no `preferDirect` — direct is the reliability fallback only.
    // (Per-lane rates are deliberately NOT in this published package; see
    // backend/src/lib/pricing/llm-cost.ts.)
    directGeminiModel: "gemini-3-flash-preview",
    // No `reasoningEfforts` at all on the KIE lane, but the vendor API accepts
    // the full minimal→high ladder (`none` maps to Google's `minimal`).
    directReasoningEfforts: ["none", "low", "medium", "high"],
  },
  {
    id: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    desc: "Latest fast Gemini, sharper reasoning",
    tier: "economy",
    kieFormat: "chat-completions",
    // KIE serves Gemini 3.6 Flash on the OpenAI-compatible dialect under this
    // slug (docs.kie.ai/market/gemini/gemini-3-6-flash-openai.md) — same
    // chat-completions path shape as gemini-3-flash, different slug prefix.
    kieSlugOrModel: "gemini-3-6-flash-openai",
    vendor: "google",
    structuredOutputMode: "kie-response-format",
    supportsImages: true,
    maxOutputTokens: 8192,
    // KIE's 3.6 endpoint accepts `reasoning_effort: low | high` (thinking
    // level) — exactly the chat-completions wire mapping deriveParams sends.
    // Google's own API additionally accepts `minimal` and `medium` on this
    // model; the set stays at the KIE-safe intersection because ONE field
    // feeds both lanes and this model is KIE-first. Widen it only if/when
    // `preferDirect` is set here.
    reasoningEfforts: ["low", "high"],
    // Google's own API additionally accepts `minimal` and `medium` here —
    // live-verified 2026-07-28. Advanced mode unlocks them.
    directReasoningEfforts: ["none", "low", "medium", "high"],
    // KIE-first: this model backs 5 of the LLM_FEATURE_DEFAULTS plus the
    // video-analysis fast tier, so it carries the highest call volume of any
    // Gemini entry — the lane with the lower unit cost wins by default and
    // direct is the reliability fallback only.
    directGeminiModel: "gemini-3.6-flash",
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
    directGeminiModel: "gemini-3.1-pro-preview",
    // Google documents low/medium/high for 3.1 Pro — no `minimal` tier, so
    // this ladder is deliberately shorter than the flash models'.
    directReasoningEfforts: ["low", "medium", "high"],
    // NO `reasoningEfforts` (the proxied ladder) ON PURPOSE, not an omission.
    // That endpoint accepts `reasoning_effort: low | high` and already DEFAULTS
    // to "high", so leaving it unset gets its deepest setting and a ladder here
    // would unlock nothing. The two lanes are NOT equivalent at their maxima:
    // verified 2026-07-29 on identical input, the proxy's ceiling produces
    // roughly a quarter of the reasoning tokens that the direct lane's
    // `thinkingLevel: HIGH` does, and it does not expose Google's deeper tiers
    // at all. That difference is visible in fine-detail reading (small on-screen
    // text such as a name badge), which is exactly what video-analysis casts
    // identities from — so adding an entry here would silently move analysis to
    // the shallower lane. Don't. Full comparison lives with the analysis engine.
    // The ONE Gemini model routed direct-first. It is the premium/low-volume
    // tier (video-analysis `pro`, no LLM_FEATURE_DEFAULTS entry), so the ~4×
    // list-price premium lands on the smallest call volume — and it is where
    // the direct lane's capability wins actually matter: real `thinkingLevel`
    // control, native media ingestion, and a `responseJsonSchema` that honours
    // `additionalProperties` (KIE's `response_format` silently DROPS
    // record/map-shaped fields — see the z.record rule in backend/CLAUDE.md).
    preferDirect: true,
  },
  {
    id: "claude-opus-4.7",
    displayName: "Claude Opus 4.7",
    // Superlatives belong to the CURRENT top model only — `desc` renders in every
    // model picker, so leaving "highest quality" on an older Opus steers
    // quality-critical work backwards (all three Opus entries bill premium, so
    // the mis-steer is invisible on the invoice).
    desc: "Older Opus, complex tasks",
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
  {
    id: "grok-4.6",
    displayName: "Grok 4.6",
    desc: "xAI flagship, strong reasoning",
    tier: "standard",
    kieFormat: "responses",
    // KIE serves Grok on the responses dialect under its own family path —
    // grok/v1/responses, NOT codex/v1/responses (llm-client derives the path
    // from `vendor`). Live-verified end-to-end 2026-08-18: array `input`,
    // `developer` system role, `input_image` URL vision, `text.format`
    // json_schema enforcement, SSE `response.output_text.delta` stream, and
    // `credits_consumed` actual-cost capture. (grok-4.5 was deferred 2026-07-13
    // because none of this was live; 4.6 is its activation.)
    kieSlugOrModel: "grok-4-6",
    vendor: "xai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    // KIE's documented enum, each level live-verified (echoed back) 2026-08-18.
    // No `none`: the endpoint reasons unconditionally (see thinkingDefaultOn).
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    // Live-probed 2026-08-18: `temperature` is silently IGNORED (request echo
    // stays at the 0.7 default), so never send it — same treatment as GPT-5.5+.
    supportsTemperature: false,
    // Reasons with NO reasoning param sent (effort defaults to "low" server-side
    // — a trivial probe spent 169 of 170 output tokens on reasoning), so every
    // call needs output headroom, not just xhigh.
    thinkingDefaultOn: true,
  },
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
    desc: "Previous-gen Opus, long-horizon work",
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
  {
    id: "claude-opus-5",
    displayName: "Claude Opus 5",
    desc: "Latest Opus, deepest agentic reasoning",
    tier: "premium",
    kieFormat: "messages",
    // KIE serves Opus 5 on the Claude-native messages dialect under the plain
    // id (docs.kie.ai/market/claude/claude-opus-5.md) — same path shape as
    // claude-opus-4-8 / claude-fable-5.
    kieSlugOrModel: "claude-opus-5",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-opus-5",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
    preferKie: true,
    // Opus 5 reasons with NO thinking param sent (vendor default flipped from
    // Opus 4.8/4.7) — so every call needs output headroom, not just xhigh/max.
    thinkingDefaultOn: true,
  },
  {
    id: "claude-fable-5",
    displayName: "Claude Fable 5",
    desc: "Frontier Claude above Opus, hardest problems",
    tier: "premium",
    kieFormat: "messages",
    kieSlugOrModel: "claude-fable-5",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-fable-5",
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

/**
 * Vendor presentation order + labels for model pickers. Every LlmVendor MUST
 * appear in the order list (guarded by a registry test) so a new vendor can't
 * ship with its models silently sorted to the end of every menu unlabeled.
 * Alphabetical on purpose: stable, and no vendor-preference fights.
 */
export const LLM_VENDOR_ORDER: readonly LlmVendor[] = ["anthropic", "google", "openai", "xai"]
export const LLM_VENDOR_LABELS: Record<LlmVendor, string> = {
  anthropic: "Anthropic",
  google: "Google",
  openai: "OpenAI",
  xai: "xAI",
}

const TIER_RANK: Record<LlmTier, number> = { economy: 0, standard: 1, premium: 2 }

export interface LlmModelGroup {
  vendor: LlmVendor
  /** Display heading for the group (LLM_VENDOR_LABELS[vendor]). */
  label: string
  models: LlmModelDef[]
}

/**
 * The ONE ordering every LLM model menu renders: grouped by vendor (in
 * LLM_VENDOR_ORDER), and inside each group sorted economy → standard → premium
 * (registry order breaks ties, which keeps family generations adjacent).
 * A flat registry-order dump was genuinely hard to scan at 17 models — every
 * picker (config panel, quick strips, quick toolbar) derives from this so the
 * menus can't drift apart. Groups with no models (after `filter`) are omitted.
 */
export function groupLlmModelsByVendor(models: readonly LlmModelDef[] = LLM_MODELS): LlmModelGroup[] {
  const groups: LlmModelGroup[] = []
  for (const vendor of LLM_VENDOR_ORDER) {
    const members = models
      .filter((m) => m.vendor === vendor)
      .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier])
    if (members.length > 0) groups.push({ vendor, label: LLM_VENDOR_LABELS[vendor], models: members })
  }
  return groups
}

/** {@link groupLlmModelsByVendor} flattened — for menus that can't render
 *  group headers (e.g. the compact node quick strips) but should still read
 *  vendor-clustered and tier-ordered. */
export function orderedLlmModels(models: readonly LlmModelDef[] = LLM_MODELS): LlmModelDef[] {
  return groupLlmModelsByVendor(models).flatMap((g) => g.models)
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
  | "describe-to-picker"
  | "qa-check"
  | "generate-script"
  | "translate"
  | "image-critic"
  // Choose Best (reduce) — the pick-best-llm strategy's judge. Its own
  // feature (not ai-writer, which it used to piggyback on) so the model
  // default and the tiered credit ids are the strategy's own.
  | "pick-best-llm"

/** Engine-dependent LlmFeature for the motion-graphics node (design §8: every credit-id site must branch on engine). */
export function motionGraphicsFeature(engine?: string): LlmFeature {
  return engine === "lottie" ? "motion-graphics-lottie" : "motion-graphics"
}

/** Feature → default model when user hasn't selected one */
export const LLM_FEATURE_DEFAULTS: Record<LlmFeature, string> = {
  "ai-writer": "claude-sonnet-4.6",
  "llm-chat": "gemini-3.6-flash",
  "prompt-helper": "gemini-3.6-flash",
  "scene-graph-ai": "claude-sonnet-4.6",
  "after-effects": "claude-sonnet-4.6",
  "motion-graphics": "claude-sonnet-4.6",
  "motion-graphics-lottie": "claude-sonnet-4.6",
  "lottie-overlay": "claude-sonnet-4.6",
  "3d-title": "claude-sonnet-4.6",
  "image-to-text": "claude-sonnet-4.6",
  "describe-to-picker": "claude-opus-5",
  "qa-check": "gemini-3.6-flash",
  "generate-script": "gemini-3.6-flash",
  "translate": "gemini-3.6-flash",
  "image-critic": "claude-sonnet-4.6",
  "pick-best-llm": "claude-sonnet-4.6",
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
  "gemini-3.6-flash":  { image: true,  video: true,  audio: true  },
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
  "grok-4.6":          { image: true,  video: false, audio: false },
  "claude-sonnet-5":   { image: true,  video: false, audio: false },
  "claude-opus-4.8":   { image: true,  video: false, audio: false },
  "claude-opus-5":     { image: true,  video: false, audio: false },
  "claude-fable-5":    { image: true,  video: false, audio: false },
}

/** Capability lookup with safe default — unknown models get image-only. */
export function getLlmModalityCaps(modelId: string | undefined): { image: boolean; video: boolean; audio: boolean } {
  if (!modelId) return { image: true, video: false, audio: false }
  return LLM_MODALITY_CAPS[modelId] ?? { image: true, video: false, audio: false }
}

/**
 * Dash-form aliases resolve to their canonical dot-form ids. Several wire
 * contracts carry dash forms (`PIPELINE_PINNABLE_SCRIPT_LLMS`, provider slugs,
 * configs persisted before the id scheme settled), while `LLM_MODELS` keys the
 * canonical `major.minor` form — an exact-only lookup makes every such caller
 * throw "Unknown LLM model" at run time. Normalizing here (instead of editing
 * the enums) keeps stored configs and published-package consumers valid.
 */
function dashAliasToCanonical(id: string): string {
  return id.replace(/-(\d+)-(\d+)$/, "-$1.$2")
}

export function getLlmModel(id: string): LlmModelDef | undefined {
  const exact = LLM_MODELS.find((m) => m.id === id)
  if (exact) return exact
  const canonical = dashAliasToCanonical(id)
  if (canonical !== id) {
    const aliased = LLM_MODELS.find((m) => m.id === canonical)
    if (aliased) return aliased
  }
  // Last resort: provider slugs double as historical aliases (e.g. the
  // dated Anthropic slugs, the `-preview`-suffixed Google ids) — accept any
  // model whose slug matches exactly, on either lane.
  return LLM_MODELS.find(
    (m) => m.kieSlugOrModel === id || m.directFallbackModel === id || m.directGeminiModel === id,
  )
}

export function getLlmTier(id: string): LlmTier {
  return getLlmModel(id)?.tier ?? "standard"
}

/**
 * Effort levels this model actually accepts on the lane it will be served on.
 *
 * The two lanes do NOT offer the same ladder: the aggregator accepts a narrower
 * set than the vendor's own API does, which is one of the concrete things
 * Advanced mode buys. Kept as one lookup so the UI picker and the wire-side
 * clamp can never disagree about what's selectable.
 */
export function availableReasoningEfforts(
  modelId: string | undefined,
  advanced = false,
): readonly LlmReasoningEffort[] {
  const model = getLlmModel(modelId ?? "")
  if (!model) return []
  if (advanced && supportsAdvancedMode(modelId)) {
    return model.directReasoningEfforts ?? model.reasoningEfforts ?? []
  }
  return model.reasoningEfforts ?? []
}

/** Highest level the model supports that is ≤ the requested level; undefined = treat as Auto. */
export function effectiveReasoningEffort(
  modelId: string | undefined,
  requested?: string,
  advanced = false,
): LlmReasoningEffort | undefined {
  if (!requested || !(requested in EFFORT_RANK)) return undefined
  const levels = availableReasoningEfforts(modelId, advanced)
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

/**
 * The sampling defaults each LLM feature's route sends when Advanced mode is
 * OFF — and therefore the values its Advanced panel must seed the sliders with.
 *
 * SINGLE SOURCE because the two used to disagree: the routes hardcoded their
 * own literals while the toggle fell back to 0.7/2048, so the panel displayed
 * a temperature the run never used, and one arrow-key press on 3D Title's Max
 * Tokens silently cut its budget from 3072 to 2048 on a node that emits
 * structured JSON.
 *
 * `structuredOutput` marks the features whose prompt asks the model for JSON —
 * a high temperature measurably degrades schema adherence there, so the panel
 * warns. Absent `temperature` means the route sends none (vendor default).
 */
export interface LlmRouteDefaults {
  temperature?: number
  maxTokens?: number
  structuredOutput?: true
}

export const LLM_ROUTE_DEFAULTS: Record<string, LlmRouteDefaults> = {
  "llm-chat":                { temperature: 0.7,  maxTokens: 8192 },
  "ai-writer":               { temperature: 0.7,  maxTokens: 8192 },
  "prompt-helper":           { temperature: 0.7,  maxTokens: 8192, structuredOutput: true },
  "generate-script":         { maxTokens: 16384, structuredOutput: true },
  "qa-check":                { maxTokens: 1024,  structuredOutput: true },
  "image-critic":            { maxTokens: 1024,  structuredOutput: true },
  "image-to-text":           { maxTokens: 1024 },
  "describe-to-picker":      { structuredOutput: true },
  "scene-graph-ai":          { temperature: 0.3,  maxTokens: 4096, structuredOutput: true },
  "after-effects":           { temperature: 0.3,  maxTokens: 2048, structuredOutput: true },
  "lottie-overlay":          { temperature: 0.3,  maxTokens: 2048, structuredOutput: true },
  "motion-graphics":         { temperature: 0.3,  maxTokens: 2048, structuredOutput: true },
  "motion-graphics-lottie":  { temperature: 0.3,  maxTokens: 8192, structuredOutput: true },
  "3d-title":                { temperature: 0.4,  maxTokens: 3072, structuredOutput: true },
}

/** Route defaults for a feature; `{}` for an unknown one. */
export function llmRouteDefaults(feature: string | undefined): LlmRouteDefaults {
  return (feature && LLM_ROUTE_DEFAULTS[feature]) || {}
}

/** One step up the economy → standard → premium ladder. Premium is the ceiling. */
function bumpTier(tier: LlmTier): LlmTier {
  if (tier === "economy") return "standard"
  if (tier === "standard") return "premium"
  return tier
}

/**
 * Can this model be run in Advanced mode?
 *
 * Advanced mode pins the call to the vendor's own API, which is the only lane
 * where sampling levers (`temperature`, `maxTokens`) and the full effort range
 * actually take effect. Capability-derived from the registry — a model without
 * a direct lane simply cannot offer it, so UI and routes both gate on this
 * rather than on a hand-maintained model list.
 */
export function supportsAdvancedMode(modelId: string | undefined): boolean {
  return Boolean(modelId && getLlmModel(modelId)?.directGeminiModel)
}

/** User-facing reason a model can't offer Advanced mode. Single-sourced so the
 *  config panel's disabled hint and the route's 400 say the same thing. */
export const ADVANCED_MODE_UNAVAILABLE_REASON =
  "Advanced mode is available on Gemini models — switch the model to enable it."

export function buildLlmCreditIdentifier(
  feature: string,
  modelId?: string,
  reasoningEffort?: string,
  advancedMode?: boolean,
): string {
  if (!modelId) return feature
  let tier = getLlmTier(modelId)
  const eff = effectiveReasoningEffort(modelId, reasoningEffort)
  if (eff !== undefined && EFFORT_TIER_BUMP.has(eff)) tier = bumpTier(tier)
  // Advanced mode routes to the vendor's own API, which bills materially more
  // per token than the aggregator. It bumps INDEPENDENTLY of the effort bump —
  // the two are separate cost levers and genuinely stack, so a max-effort
  // advanced economy call lands at premium. The bump is ignored on a model that
  // can't run advanced at all, so a stale flag never inflates a bill.
  if (advancedMode && supportsAdvancedMode(modelId)) tier = bumpTier(tier)
  if (tier === "standard") return feature
  return `${feature}:${tier}`
}

/**
 * Resolve llmModel (+ reasoningEffort, advancedMode) from raw body for the
 * creditGuard preHandler (before Zod parsing). Returns the credit identifier
 * for the given feature.
 */
export function resolveLlmCreditId(feature: string, body: unknown): string {
  const b = body as Record<string, unknown> | undefined
  return buildLlmCreditIdentifier(
    feature,
    b?.llmModel as string | undefined,
    b?.reasoningEffort as string | undefined,
    b?.advancedMode === true,
  )
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
 * Models that PREVIOUSLY backed a tier, mapped to the tier they backed.
 * They stay video+audio-capable (so they remain in VIDEO_ANALYSIS_LLM_MODELS):
 * stored raw `llmModel` values keep resolving via the passthrough in
 * `resolveVideoAnalysisModel` and keep pricing under their own credit family —
 * but no tier reaches them for NEW runs. UIs use this map to reverse a stored
 * raw id to the tier the user originally chose (video-configs fail-safe).
 * The tier guard test requires every video-capable model to be a tier target
 * OR a key here, so replacing a tier's backing model stays an explicit,
 * two-sided decision.
 */
export const VIDEO_ANALYSIS_LEGACY_MODELS: Record<string, VideoAnalysisModelTier> = {
  // Backed the fast tier from 2026-07 until 2026-07-29, when the economy tiers
  // moved to the cheaper lane and the older, cheaper flash. It is now the engine
  // behind the `smart` tier — but `smart` is a SENTINEL that never exposes a model
  // id, so as far as this map is concerned it no longer backs a selectable tier and
  // belongs here: stored raw `llmModel` values keep resolving and keep pricing
  // under their own credit family.
  "gemini-3.6-flash": "fast",
}
/**
 * MIXED tiers — advanced multi-engine analysis plans whose identifier resolves
 * to an engine-plan SENTINEL consumed by the analysis engine, never to a single
 * model id. Two variants, same price (one shared `video-analysis:mixed:*`
 * credit family): `mixed` targets maximum result quality; `mixed-fast` targets
 * run-to-run output consistency. What each plan does internally is deliberately
 * NOT published here (Apache irrevocability; only the wire vocabulary below is
 * contract — the engine lives in the private analysis plugin).
 */
export const VIDEO_ANALYSIS_MIXED_TIERS = ["mixed", "mixed-fast", "smart"] as const
export type VideoAnalysisMixedTier = (typeof VIDEO_ANALYSIS_MIXED_TIERS)[number]
/**
 * `smart` is an ENGINE-PLAN sentinel like the mixed tiers — it names a plan, not a
 * model — but it is a different SHAPE of plan, and the distinction is the whole
 * reason it exists as a separate tier rather than a repricing of the others.
 *
 * The economy tiers (`fast`, `pro`, `mixed`, `mixed-fast`) run several passes on
 * the cheaper proxied transport and vote. That transport is cheaper per token and
 * additionally does no deep reasoning, which is why they cost less — and also why
 * they are less accurate. `smart` is a HYBRID plan (2026-08-03 re-plan): one
 * native-transport skeleton pass with everything turned up, blended with several
 * economy-transport donor rolls, and the merged result is always refined —
 * `selectionMode` (the `choose`/`combine` toggle the other tiers expose) does not
 * apply to `smart`; it always applies the equivalent of `combine`.
 *
 * As with the mixed sentinels, what the plan does internally is deliberately not
 * published here; only the wire vocabulary is contract.
 */
/** UI/listing order — recommended (smart) first. */
export const VIDEO_ANALYSIS_TIER_ORDER = ["smart", "pro", "fast", "mixed", "mixed-fast"] as const
export type VideoAnalysisTier = (typeof VIDEO_ANALYSIS_TIER_ORDER)[number]
export const DEFAULT_VIDEO_ANALYSIS_TIER: VideoAnalysisTier = "pro"
export const DEFAULT_VIDEO_ANALYSIS_MODEL: string = VIDEO_ANALYSIS_TIERS[DEFAULT_VIDEO_ANALYSIS_TIER]
/** Neutral, vendor-free display labels for the UI. */
export const VIDEO_ANALYSIS_TIER_LABELS: Record<VideoAnalysisTier, string> = {
  smart: "Smart",
  fast: "Fast",
  pro: "Pro",
  mixed: "Mixed",
  "mixed-fast": "Mixed (consistent)",
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
