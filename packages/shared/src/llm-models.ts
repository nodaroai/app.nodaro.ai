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
export type LlmVendor = "anthropic" | "deepseek" | "google" | "moonshot" | "openai" | "xai"

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
  /**
   * false = the model 400s on a FORCED `tool_choice` (`{ type: "tool" }` /
   * `{ type: "any" }`) — Claude Sonnet 5.5 and Opus 5.5 (vendor docs: "not
   * supported for this model"). Absent = forcing is accepted.
   *
   * Only meaningful with `structuredOutputMode: "anthropic-tool"`: such a model
   * is asked with `tool_choice: auto` plus an instruction naming the tool, and
   * the tool carries `strict: true` whenever its schema is expressible in the
   * vendor's strict subset (`anthropicStrictToolSchema` in llm-client). The
   * caller's Zod still validates every answer, so nothing the wire withholds is
   * lost. Declared per model, never matched on a model name.
   */
  supportsForcedToolChoice?: false
  /**
   * true = the model binds each thinking block to the exact conversation prefix
   * that produced it ("preserved thinking" — Claude Sonnet 5.5 / Opus 5.5):
   * replaying a block after an earlier turn was edited, dropped or rebuilt is a
   * 400 on accounts the vendor enforces. A caller that trims or rebuilds stored
   * history between requests (the Workflow Copilot keeps a token budget by
   * dropping its oldest turns) must strip thinking blocks from the turns it
   * replays. Within one request's own tool loop the history only grows, so
   * blocks produced there stay valid.
   */
  conversationBoundThinking?: true
  /**
   * true = this model's reasoning effort takes effect ONLY on the vendor's own
   * API: the aggregator accepts the field and silently ignores it. Measured
   * 2026-10-08 for the Claude family on KIE — `low`, `max` and no effort gave
   * the same output length on a reasoning-heavy prompt, and no thinking block
   * ever came back, even on Sonnet 4.6 at `max`.
   *
   * So an effort-bearing call on such a model is SERVED direct, and it bills
   * as Advanced mode does — one rung up (decided 2026-10-08: "effort =
   * Advanced"). {@link llmServesDirect} is the one place that decides it, for
   * the credit identifier and the routing alike.
   */
  effortRequiresDirect?: true
  /** Claude-only: KIE is the preferred routing, direct Anthropic the fallback. */
  preferKie?: true
  /**
   * KIE's NON-streaming endpoint for this model is unreliable (measured);
   * `llmComplete` serves it by opening the streaming wire and collapsing it to
   * one response. Streaming responses do not reliably carry
   * `credits_consumed`, so provider cost on this path comes from the rate
   * table (`backend/src/lib/pricing/llm-cost.ts`) rather than the real charge.
   *
   * Declared per model — a per-model condition on KIE's side, like the
   * Claude-lane one behind `callKieMessagesCollapsed`. The flag says WHICH
   * model is affected, and `llm-client` reads it instead of matching model
   * names. Today only the `responses` dispatcher in `callKie` honours it (the
   * one format where the condition has been measured); a chat-completions or
   * messages model that needs the same treatment must also teach its `callKie`
   * case to read the flag — declaring it alone changes nothing there.
   */
  kieCollapseStream?: true
  /**
   * true = the model reasons even when NO thinking parameter is sent, so its
   * reasoning tokens share the `max_tokens` budget on EVERY call — not just
   * effort-bearing ones. Claude Opus 5 flipped this default (on Opus 4.8/4.7
   * and Sonnet 5, omitting `thinking` means no thinking at all).
   *
   * Consumers MUST give such a model output headroom regardless of the
   * requested effort, or reasoning silently eats a small legacy cap and the
   * answer truncates with `stop_reason: max_tokens` — a paid-for empty reply
   * (since #1588 the client fails such a call rather than return the
   * fragment, but the floor is what keeps it from happening). `deriveParams`
   * (llm-client.ts) floors to {@link reasoningOutputFloor}; the film
   * pipeline's `callLLM` — Anthropic SDK only, so only its Claude members
   * matter — floors at the default. Keep the flag in sync with the vendor's
   * documented default rather than inferring it from the model name.
   */
  thinkingDefaultOn?: true
  /**
   * The output-token cap a REASONING call on this model is floored to — the
   * room its thinking shares with the answer (`thinkingDefaultOn`, or an
   * xhigh/max effort). Absent = {@link REASONING_OUTPUT_FLOOR}; read it through
   * {@link reasoningOutputFloor}, never directly.
   *
   * Declare it ONLY where a lane serving this model is not known to accept the
   * default: the floor rides every lane the model can be served on (KIE AND its
   * direct fallback), so it has to sit at the intersection of what they take —
   * the rule `maxOutputTokens` already follows for the Gemini flash entries.
   * Never below `maxOutputTokens` (a floor under the default cap is not a
   * floor — guarded by a registry test).
   */
  reasoningOutputFloor?: number
}

/** The reasoning floor for a model that declares no lane limit of its own. */
export const REASONING_OUTPUT_FLOOR = 32768

/** The output cap a reasoning call on `model` is floored to (see `LlmModelDef.reasoningOutputFloor`). */
export function reasoningOutputFloor(model: LlmModelDef): number {
  return model.reasoningOutputFloor ?? REASONING_OUTPUT_FLOOR
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
    // Reasons with no thinking param sent — Google's Gemini 3 default (dynamic
    // thinking; `minimal` is its floor, never off), measured on 3.6 in #1588.
    // Floored at the KIE-safe 8192, the same intersection as `maxOutputTokens`.
    thinkingDefaultOn: true,
    reasoningOutputFloor: 8192,
  },
  {
    id: "gemini-3.6-flash",
    displayName: "Gemini 3.6 Flash",
    // Demoted 2026-09-06 alongside 3.7: superlatives belong to the CURRENT top
    // model of a family only, and 3.8 now holds that slot.
    desc: "Fast Gemini, sharper reasoning",
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
    // Reasons with NO thinking param sent — measured, issue #1588: a Generate
    // Text node capped at 1,100 tokens fell back to the direct lane (KIE 500),
    // spent ~1,060 of them reasoning, and returned 120 characters cut mid-URL.
    // On the same input the KIE runs used ~500 output tokens in all, so only
    // the fallback runs broke — every other run of a 5-minute schedule.
    // Floored at 8192, NOT the default 32768: the floor rides the KIE endpoint
    // too, and 8192 is all it is known to take (see `maxOutputTokens`).
    thinkingDefaultOn: true,
    reasoningOutputFloor: 8192,
  },
  {
    id: "gemini-3.7-flash",
    displayName: "Gemini 3.7 Flash",
    // Demoted 2026-09-06 when 3.8 registered below: superlatives belong to the
    // CURRENT top model of a family only (same rule the Opus entries follow) —
    // `desc` renders in every picker, so leaving "Newest" on the older flash
    // steers the A/B's traffic backwards.
    desc: "Fast Gemini, agentic-tuned",
    tier: "economy",
    kieFormat: "chat-completions",
    // KIE serves it on the OpenAI-compatible dialect under this slug
    // (docs.kie.ai/market/gemini/gemini-3-7-flash-openai.md) — same
    // chat-completions path shape as gemini-3.6-flash.
    kieSlugOrModel: "gemini-3-7-flash-openai",
    vendor: "google",
    structuredOutputMode: "kie-response-format",
    supportsImages: true,
    // Google's own cap is 65,536, but the field feeds BOTH lanes and the KIE
    // flash endpoints cap at 8192 (the measured 3.6 posture) — stay at the
    // KIE-safe intersection, same reasoning as `reasoningEfforts` below.
    maxOutputTokens: 8192,
    // KIE's 3.7 endpoint enumerates reasoning_effort low | high (verified
    // against its OpenAPI spec 2026-08-18), identical to 3.6.
    reasoningEfforts: ["low", "high"],
    // Assumed parity with 3.6 pending a live probe on the direct lane.
    directReasoningEfforts: ["none", "low", "medium", "high"],
    directGeminiModel: "gemini-3.7-flash",
    // Gemini 3 default: reasons with no thinking param sent (measured on 3.6,
    // #1588). KIE-safe floor, same intersection as `maxOutputTokens`.
    thinkingDefaultOn: true,
    reasoningOutputFloor: 8192,
  },
  {
    id: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    // Inherits "Newest" from 3.7 (demoted above). Deliberately does NOT name
    // agentic video: that capability exists only on the direct Google lane
    // (Interactions API, not wired here) and the modality caps below withhold
    // video — a picker desc must not promise a lever this entry cannot expose.
    desc: "Newest fast Gemini, agentic-tuned",
    tier: "economy",
    kieFormat: "chat-completions",
    // KIE serves it on the OpenAI-compatible dialect under this slug
    // (docs.kie.ai/market/gemini/gemini-3-8-flash-openai.md) — identical
    // chat-completions path shape to gemini-3.7-flash / gemini-3.6-flash,
    // different slug prefix.
    kieSlugOrModel: "gemini-3-8-flash-openai",
    vendor: "google",
    // Live-verified 2026-09-06 on the KIE lane: `response_format: json_schema`
    // is ENFORCED (the reply came back exact-schema valid, credits_consumed
    // present) — not merely accepted-and-ignored.
    structuredOutputMode: "kie-response-format",
    supportsImages: true,
    // 16384 here, NOT the 8192 its 3.6 / 3.7 siblings sit at. Those two stay at
    // the KIE-safe intersection because nobody measured their endpoints past
    // it; 3.8's WAS measured — live-verified 2026-09-06, `max_tokens: 20000`
    // was honored for 14,892 completion tokens with finish_reason "stop" (no
    // truncation), so the KIE lane is not the binding constraint. 16384 keeps
    // it level with the rest of the registry's ceiling rather than at the cap.
    maxOutputTokens: 16384,
    // KIE's 3.8 endpoint enumerates reasoning_effort low | high (its doc enum),
    // and usage carries completion_tokens_details.reasoning_tokens — same
    // KIE-safe intersection as 3.6 / 3.7, because ONE field feeds both lanes
    // and this model is KIE-first.
    reasoningEfforts: ["low", "high"],
    // Google's own API accepts the full minimal→high ladder here (`none` maps
    // to `minimal`), same as 3.7. Advanced mode is what unlocks it.
    directReasoningEfforts: ["none", "low", "medium", "high"],
    // KIE-first (no `preferDirect`) — 3.7's posture exactly: the cheap lane
    // serves the A/B, direct is Advanced mode + the reliability fallback.
    directGeminiModel: "gemini-3.8-flash",
    // Gemini 3 default: reasons with no thinking param sent (measured on 3.6,
    // #1588). Floored at its own 16384, inside the 20000 its KIE endpoint was
    // measured to honour.
    thinkingDefaultOn: true,
    reasoningOutputFloor: 16384,
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
    // KIE-first since 2026-10-08 (a call is priced on the lane it runs on);
    // KIE served it plain and with a tool on its streaming wire that day.
    preferKie: true,
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
    // KIE-first since 2026-10-08 (a call is priced on the lane it runs on);
    // KIE served it plain and with a tool on its streaming wire that day.
    preferKie: true,
    reasoningEfforts: ["low", "medium", "high", "max"],
    // KIE ignores Claude effort (measured 2026-10-08): an effort call runs direct and bills as Advanced.
    effortRequiresDirect: true,
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
    // KIE-first since 2026-10-08 (decided: a call is priced on the lane it runs
    // on, so the base premium price buys the KIE lane; the direct lane is
    // Advanced mode, billed `premium-direct`). It was the one direct-first
    // Gemini before. What the direct lane buys, now behind Advanced: real
    // `thinkingLevel` control, native media ingestion, and a `responseJsonSchema`
    // that honours `additionalProperties` (KIE's `response_format` silently DROPS
    // record/map-shaped fields — see the z.record rule in backend/CLAUDE.md).
    // Video-analysis is unaffected: it pins `requireLane: "direct"` itself.
    // Reasons with no thinking param sent on both lanes — the proxied endpoint
    // DEFAULTS to "high" (above), and the direct lane reasons harder still.
    // Floored at its own 16384: its KIE fallback is not known to take more.
    thinkingDefaultOn: true,
    reasoningOutputFloor: 16384,
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
    // KIE ignores Claude effort (measured 2026-10-08): an effort call runs direct and bills as Advanced.
    effortRequiresDirect: true,
    supportsTemperature: false,
    preferKie: true,
  },
  {
    id: "gpt-5.4",
    displayName: "GPT-5.4",
    // Demoted 2026-09-06: two GPT generations have shipped above it, so
    // "Latest" steered the picker at the oldest premium GPT in the registry.
    desc: "Older GPT, premium quality",
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
    // Demoted 2026-09-06 when gpt-6-astra registered below — "Flagship /
    // deepest" is the current top GPT's copy only. Worded to stay distinct
    // from gpt-5.5's "Previous flagship GPT, deep reasoning": all three read
    // premium on the invoice, so a stale superlative mis-steers silently.
    desc: "Previous flagship GPT-5.6, deep reasoning",
    tier: "premium",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-5-6-sol",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
    // SERVED COLLAPSED, on the astra precedent (2026-09-17). The 2026-07-14
    // verification that KIE's non-stream responses endpoint serves the GPT-5.6
    // family reliably no longer holds: a live call — a recast continuity
    // review, ~3k tokens, `reasoning.effort: high`, `text.format: json_schema`
    // — came back `500 {"error":{"type":"server_error"}}` / "Server exception,
    // please try again later". Same endpoint family, same dialect and the same
    // signature astra was measured on (12 calls: non-stream 2/6, streaming
    // 5/6; a schema-less non-stream call 500'd too, so the lane is the trigger
    // and not the schema). ONE sighting here rather than a fresh 12-call probe
    // — the precedent is strong and the flag is cheap to reverse.
    //
    // THE COST: SSE does not reliably carry `credits_consumed`, so this model's
    // provider cost becomes the rate-table estimate instead of the billed
    // figure. That is the price of a lane that answers, and it is the same
    // trade astra already makes.
    kieCollapseStream: true,
  },
  {
    id: "gpt-6-astra",
    displayName: "GPT-6 Astra",
    desc: "Flagship GPT-6, deepest reasoning",
    tier: "premium",
    kieFormat: "responses",
    // KIE serves GPT-6 on the responses dialect under the OpenAI family path —
    // codex/v1/responses, which llm-client DERIVES from `vendor` (the same
    // derivation that keeps Grok on grok/v1/responses). So this field is the
    // body `model` only, not a path segment. Live-verified 2026-09-06 on the
    // streaming path (array `input`, SSE deltas), which is the ONLY path we
    // serve it on — see `kieCollapseStream` below. The non-stream reply does
    // carry `credits_consumed` (and cached_tokens/cache_write_tokens in usage)
    // on the ~1 call in 3 that returns one, but we no longer take that reply,
    // so provider cost here is the rate-table estimate.
    // KIE's codex/v1/responses injects its own Codex-agent `instructions`
    // prompt ABOVE the caller's `developer` message — observed in the
    // 2026-07-14 live probe of that endpoint, and unchanged for GPT-6. Budget
    // for it when a developer message has to dominate.
    kieSlugOrModel: "gpt-6-astra",
    vendor: "openai",
    // Live-verified 2026-09-06: `text.format: json_schema` is passed through
    // and ENFORCED — the server echoed `strict: true` and returned
    // schema-valid JSON.
    structuredOutputMode: "responses-json-schema",
    // text + image + file inputs per KIE's doc. No video/audio — see the
    // image-only LLM_MODALITY_CAPS row below.
    supportsImages: true,
    maxOutputTokens: 16384,
    // KIE's documented enum for this endpoint. No `none` on purpose: the
    // endpoint reasons unconditionally (see thinkingDefaultOn below), so a
    // "none" level would be a lie the wire silently overrides.
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    // Live-probed 2026-09-06: `temperature: 0.2` was sent and the request echo
    // stayed at 1.0 — silently IGNORED, so never send it. Same treatment as the
    // GPT-5.6 family and grok-4.6.
    supportsTemperature: false,
    // With NO reasoning param sent, the server echoed effort "medium" — it
    // reasons by default (2026-09-06), so reasoning tokens share `max_tokens`
    // on EVERY call, not just effort-bearing ones. Consumers must floor output
    // headroom off this flag or a premium answer truncates into a paid-for
    // empty reply.
    thinkingDefaultOn: true,
    // Measured 2026-09-06, 12 identical requests (developer + user message,
    // reasoning.effort low, text.format json_schema): `stream: false`
    // succeeded 2/6 in 4–5 s and 500'd 4/6 with
    // {"error":{"type":"server_error"}} after 34, 34, 35 and 64 s, while the
    // same body with `stream: true` succeeded 5/6 in the same 4–5 s. An
    // earlier non-stream probe timed out at 90 s with 0 bytes, and a
    // non-stream call WITHOUT a schema 500'd after 65 s — the schema is not
    // the trigger, the non-stream lane is. The very same endpoint serves
    // gpt-5.4/5.5/5.6 non-stream reliably (live-verified 2026-07-14), which is
    // why this is per-model and not a lane-wide flag.
    kieCollapseStream: true,
  },
  // ── GPT-6 Luna / Sol / 6.1 Sol ────────────────────────────────────────────
  // Same KIE endpoint and dialect as gpt-6-astra (codex/v1/responses; the doc
  // pages differ only in the model name). Live-probed 2026-10-08, per model:
  // `text.format` json_schema ENFORCED (echo `strict: true`, schema-valid
  // reply), `temperature: 0.2` echoed back as 1 → silently ignored, no
  // reasoning param → echo "medium" (reasons by default), and data-URI vision.
  // Unlike astra, the NON-stream lane served them reliably — luna 10/10 and sol
  // 10/10, 6.1 sol 8/8 at levels other than `none` (incl. 4 long structured
  // calls each, 500–1,500 output tokens) — so none of them is collapsed:
  // `credits_consumed` stays the real provider charge.
  // Their ladder is WIDER than astra's doc-enum one: `none` and `max` were each
  // sent and echoed back by the endpoint (6.1 sol excepted below).
  {
    id: "gpt-6-luna",
    displayName: "GPT-6 Luna",
    desc: "Fastest GPT-6, high-volume workloads",
    tier: "economy",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-6-luna",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
    thinkingDefaultOn: true,
  },
  {
    id: "gpt-6-sol",
    displayName: "GPT-6 Sol",
    desc: "Strong GPT-6, deep reasoning at lower cost",
    // Premium by decision (2026-10-08), not by unit cost — "Sol" is the
    // deep-reasoning rung of the family, and gpt-5.6-sol bills premium too.
    tier: "premium",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-6-sol",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
    thinkingDefaultOn: true,
  },
  {
    id: "gpt-6.1-sol",
    displayName: "GPT-6.1 Sol",
    // Measured slow: 30–76 s for 500–1,100 output tokens (2026-10-08), roughly
    // twice gpt-6-sol on the same request — say so where the picker shows it.
    desc: "Newest GPT-6 Sol, thorough but slower",
    tier: "premium",
    kieFormat: "responses",
    kieSlugOrModel: "gpt-6-1-sol",
    vendor: "openai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    // NO `none`: every probe at `reasoning.effort: none` failed (502, a 120 s
    // timeout, 502, 429 — 0/4, 2026-10-08) while every other level answered,
    // and the same request at `none` succeeded on luna and sol. Clamping maps a
    // `none` request to nothing sent (Auto) rather than to a level that fails.
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    supportsTemperature: false,
    thinkingDefaultOn: true,
  },
  {
    id: "grok-4.6",
    displayName: "Grok 4.6",
    // Demoted 2026-10-08 when grok-4.7 registered — the flagship copy moved up.
    desc: "Previous Grok, strong reasoning",
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
    id: "grok-4.7",
    displayName: "Grok 4.7",
    desc: "xAI flagship, strong reasoning",
    tier: "standard",
    kieFormat: "responses",
    // Same grok/v1/responses family path and wire as grok-4.6 (the KIE doc
    // pages differ only in the model name). Live-probed 2026-10-08: non-stream
    // 6/6, `text.format` json_schema enforced, data-URI vision, SSE deltas.
    kieSlugOrModel: "grok-4-7",
    vendor: "xai",
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    // 4.6's ladder. `none` is NOT honoured: the endpoint echoed it back as
    // "minimal" and still reasoned (33 of 35 output tokens), so offering it
    // would promise a lever the wire overrides.
    reasoningEfforts: ["low", "medium", "high", "xhigh"],
    // `temperature: 0.2` → echo stayed at the 0.7 default: ignored.
    supportsTemperature: false,
    // "Capital of France" with no reasoning param spent 310 of 311 output
    // tokens reasoning.
    thinkingDefaultOn: true,
  },
  {
    id: "claude-sonnet-5",
    displayName: "Claude Sonnet 5",
    // Demoted 2026-10-08 when claude-sonnet-5.5 registered.
    desc: "Previous Sonnet, near-Opus quality",
    tier: "standard",
    kieFormat: "messages",
    kieSlugOrModel: "claude-sonnet-5",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-sonnet-5",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    // KIE ignores Claude effort (measured 2026-10-08): an effort call runs direct and bills as Advanced.
    effortRequiresDirect: true,
    supportsTemperature: false,
    preferKie: true,
  },
  {
    id: "claude-sonnet-5.5",
    displayName: "Claude Sonnet 5.5",
    desc: "Latest Sonnet, near-Opus quality at Sonnet cost",
    tier: "standard",
    kieFormat: "messages",
    // KIE serves it on the Claude-native messages dialect under its plain id
    // (docs.kie.ai/market/claude/claude-sonnet-5-5.md — the page is
    // claude-opus-5's with the model name swapped). Live-probed 2026-10-08 on
    // the streaming wire: plain, effort, and forced/auto+strict tool calls all
    // answered.
    kieSlugOrModel: "claude-sonnet-5-5",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    // Anthropic 400s a forced tool_choice on this model. KIE's proxy happened
    // to accept one in the probe, but the direct lane is where every
    // effort-bearing and every streamed structured call goes.
    supportsForcedToolChoice: false,
    conversationBoundThinking: true,
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-sonnet-5-5",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    // KIE ignores Claude effort (measured 2026-10-08): an effort call runs direct and bills as Advanced.
    effortRequiresDirect: true,
    // Anthropic rejects non-default sampling values on this model (KIE's proxy
    // accepted temperature: 0.2 in the probe; the direct lane is the contract).
    supportsTemperature: false,
    preferKie: true,
    // Adaptive thinking runs when no thinking param is sent (vendor default).
    thinkingDefaultOn: true,
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
    // KIE ignores Claude effort (measured 2026-10-08): an effort call runs direct and bills as Advanced.
    effortRequiresDirect: true,
    supportsTemperature: false,
    preferKie: true,
  },
  {
    id: "claude-opus-5",
    displayName: "Claude Opus 5",
    // Demoted 2026-10-08 when claude-opus-5.5 registered.
    desc: "Previous Opus, deep agentic reasoning",
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
    // KIE ignores Claude effort (measured 2026-10-08): an effort call runs direct and bills as Advanced.
    effortRequiresDirect: true,
    supportsTemperature: false,
    preferKie: true,
    // Opus 5 reasons with NO thinking param sent (vendor default flipped from
    // Opus 4.8/4.7) — so every call needs output headroom, not just xhigh/max.
    thinkingDefaultOn: true,
  },
  {
    id: "claude-opus-5.5",
    displayName: "Claude Opus 5.5",
    // Positioned as Fable-class (decided 2026-10-08: offered wherever Fable is).
    desc: "Latest Opus, frontier-class reasoning",
    tier: "premium",
    kieFormat: "messages",
    // KIE plain id on the messages dialect (docs.kie.ai/market/claude/
    // claude-opus-5-5 — claude-opus-5's page with the name swapped).
    // Live-probed 2026-10-08 on the streaming wire (plain + effort); the KIE
    // Claude lane was erroring for claude-opus-5 too during the tool probes.
    kieSlugOrModel: "claude-opus-5-5",
    vendor: "anthropic",
    structuredOutputMode: "anthropic-tool",
    // Forced tool_choice is a 400 on this model (vendor docs) — see the field.
    supportsForcedToolChoice: false,
    conversationBoundThinking: true,
    supportsImages: true,
    maxOutputTokens: 16384,
    directFallbackModel: "claude-opus-5-5",
    reasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    // KIE ignores Claude effort (measured 2026-10-08): an effort call runs direct and bills as Advanced.
    effortRequiresDirect: true,
    supportsTemperature: false,
    preferKie: true,
    // Thinking cannot be turned off on this model at all (`disabled` is a 400
    // at every effort); with no effort sent it runs adaptive at the vendor's
    // `medium` default. Nothing on our wire sends `disabled`.
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
    // KIE ignores Claude effort (measured 2026-10-08): an effort call runs direct and bills as Advanced.
    effortRequiresDirect: true,
    supportsTemperature: false,
    preferKie: true,
  },
  // ── Moonshot / DeepSeek ───────────────────────────────────────────────────
  // Both on KIE's THIRD responses family path, openai/v1/responses (llm-client
  // derives it from `vendor`). KIE labels both pages "Chat only — not adapted
  // for agent use": fine for single (structured) completions, so neither may
  // back a tool-loop feature.
  {
    id: "kimi-k3",
    displayName: "Kimi K3",
    desc: "Moonshot flagship, 1M context, careful reasoning",
    tier: "premium",
    kieFormat: "responses",
    kieSlugOrModel: "kimi-k3",
    vendor: "moonshot",
    // Live-probed 2026-10-08: `text.format` json_schema is ENFORCED — asked to
    // answer "no json here" in plain prose, it returned schema-shaped JSON.
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    maxOutputTokens: 16384,
    // KIE's documented enum. The endpoint accepted xhigh/none without error but
    // never echoes an effort back, so nothing beyond the doc is verifiable.
    reasoningEfforts: ["low", "medium", "high"],
    // The doc lists no `temperature` field at all.
    supportsTemperature: false,
    // "Reasons by default" per KIE's doc (its usage reports no reasoning-token
    // split, so this is the doc's word, not a measurement).
    thinkingDefaultOn: true,
  },
  {
    id: "deepseek-v4.1-flash",
    displayName: "DeepSeek V4.1 Flash",
    desc: "Very cheap and fast, solid reasoning",
    tier: "economy",
    kieFormat: "responses",
    kieSlugOrModel: "deepseek-v4-1-flash",
    vendor: "deepseek",
    // Live-probed 2026-10-08: json_schema echoed `strict: true` and enforced.
    structuredOutputMode: "responses-json-schema",
    supportsImages: true,
    // ADVISORY ONLY: KIE documents `max_output_tokens` as "not supported … no
    // effect" on this model (a probe sending it was accepted and ignored), so
    // neither this cap nor the reasoning floor binds its output length, and the
    // `incomplete` cap-stop signal cannot fire from our own cap.
    maxOutputTokens: 16384,
    // The endpoint takes none/minimal/low/medium/high/xhigh/max; each of none,
    // low and xhigh was echoed back. `minimal` is not in our ladder.
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh", "max"],
    // Documented "not supported … no effect".
    supportsTemperature: false,
    thinkingDefaultOn: true,
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
export const LLM_VENDOR_ORDER: readonly LlmVendor[] = ["anthropic", "deepseek", "google", "moonshot", "openai", "xai"]
export const LLM_VENDOR_LABELS: Record<LlmVendor, string> = {
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Google",
  moonshot: "Moonshot AI",
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
  // Scene3D previz authoring — generate-3d-scene AND edit-3d-scene share one
  // feature: both send the model a scene (the edit sends the WHOLE plan in) and
  // both get back structured geometry, so the token profile is the same shape.
  // The deterministic edit lane never reaches an LLM and bills the separate
  // zero-cost `3d-scene-ops` identifier instead.
  | "3d-scene"
  | "image-to-text"
  // Per-ad creative analysis on the social scraper nodes (Meta Ads first):
  // one structured vision call per ad, priced per REQUESTED ad by tier and
  // folded into the scrape's own identifier (packages/shared/meta-ads-scrape).
  | "meta-ads-analysis"
  | "describe-to-picker"
  | "qa-check"
  | "generate-script"
  | "translate"
  | "image-critic"
  // Choose Best (reduce) — the pick-best-llm strategy's judge. Its own
  // feature (not ai-writer, which it used to piggyback on) so the model
  // default and the tiered credit ids are the strategy's own.
  | "pick-best-llm"
  // In-app Workflow Copilot turns (backend agent loop; metered, reservation
  // ceiling under `STATIC_CREDIT_COSTS["workflow-copilot"]`).
  | "workflow-copilot"
  // "Steal the format": Content Recipe (why a post worked, one structured
  // call over its analysis) and Content Ideas (recipes + brand → ideas, a
  // call per five ideas). Cloud-only; the implementation is a private plugin.
  // Ideas are priced per batch of five — see content-recipe-ideas.ts.
  | "content-recipe"
  | "content-ideas"

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
  "3d-scene": "claude-sonnet-4.6",
  "image-to-text": "claude-sonnet-4.6",
  // Economy on purpose: the analysis reads ONE frame + the copy per ad and
  // runs once per returned ad — volume, not depth. Must stay an image-capable
  // structured-output model (STRUCTURED_VISION_MODELS); a registry test pins it.
  "meta-ads-analysis": "gemini-3.6-flash",
  // Moved from claude-opus-5 on 2026-10-08 (decided: Opus 5.5 takes the Opus 5
  // defaults). Still an image-capable structured model — a registry test pins it.
  "describe-to-picker": "claude-opus-5.5",
  "qa-check": "gemini-3.6-flash",
  "generate-script": "gemini-3.6-flash",
  "translate": "gemini-3.6-flash",
  "image-critic": "claude-sonnet-4.6",
  "pick-best-llm": "claude-sonnet-4.6",
  "workflow-copilot": "claude-sonnet-5",
  // Both economy on purpose — measured: ten ideas in Hebrew took ~1 min here
  // and ~3.5 min (two calls) on claude-sonnet-4.6. The private plugin keeps
  // the same two defaults for API callers that omit the model.
  "content-recipe": "gemini-3.6-flash",
  "content-ideas": "gemini-3.6-flash",
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
  // gemini-3.7-flash is IMAGE-ONLY by DECISION, not omission: full video+audio
  // caps would auto-enroll it in VIDEO_ANALYSIS_LLM_MODELS (derived below) and
  // force a video-analysis tier + pricing decision that is deliberately
  // deferred while the smart-family A/B routes this model internally (#747).
  // Flip these two flags ONLY together with that VA-side decision.
  "gemini-3.7-flash":  { image: true,  video: false, audio: false },
  // gemini-3.8-flash is IMAGE-ONLY by DECISION, not omission — 3.7's rationale
  // exactly: full video+audio caps would auto-enroll it in
  // VIDEO_ANALYSIS_LLM_MODELS (derived below) and force a video-analysis tier +
  // pricing decision that stays deferred until the 3.8-vs-3.7 analysis A/B
  // concludes. Google's own 3.8 lane DOES understand video (agentic video, via
  // the Interactions API we don't wire) — which is precisely why withholding it
  // has to be a decision rather than a gap. Flip these two flags ONLY together
  // with that VA-side decision.
  "gemini-3.8-flash":  { image: true,  video: false, audio: false },
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
  // KIE's GPT-6 doc lists text + image + file inputs only — no video, no audio.
  "gpt-6-astra":       { image: true,  video: false, audio: false },
  // Same KIE doc as astra: text + image + file inputs only.
  "gpt-6-luna":        { image: true,  video: false, audio: false },
  "gpt-6-sol":         { image: true,  video: false, audio: false },
  "gpt-6.1-sol":       { image: true,  video: false, audio: false },
  "grok-4.6":          { image: true,  video: false, audio: false },
  "grok-4.7":          { image: true,  video: false, audio: false },
  "claude-sonnet-5":   { image: true,  video: false, audio: false },
  "claude-sonnet-5.5": { image: true,  video: false, audio: false },
  "claude-opus-4.8":   { image: true,  video: false, audio: false },
  "claude-opus-5":     { image: true,  video: false, audio: false },
  "claude-opus-5.5":   { image: true,  video: false, audio: false },
  "claude-fable-5":    { image: true,  video: false, audio: false },
  // KIE documents text + image input only for both.
  "kimi-k3":           { image: true,  video: false, audio: false },
  "deepseek-v4.1-flash": { image: true, video: false, audio: false },
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
  // A 100-object plan with keyframe tracks is the biggest structured payload
  // any composer feature emits — 3072 (3d-title's cap) truncates it mid-array.
  "3d-scene":                { temperature: 0.3,  maxTokens: 8192, structuredOutput: true },
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
  const model = modelId ? getLlmModel(modelId) : undefined
  return Boolean(model?.directGeminiModel || model?.directFallbackModel)
}

/** User-facing reason a model can't offer Advanced mode. Single-sourced so the
 *  config panel's disabled hint and the route's 400 say the same thing. */
export const ADVANCED_MODE_UNAVAILABLE_REASON =
  "Advanced mode is available on Gemini and Claude models — switch the model to enable it."

/**
 * Is this call served on the vendor's own API — and therefore billed as such?
 *
 * The rule (decided 2026-10-08): a call is priced on the lane it runs on.
 * It runs direct when Advanced mode is on, or when it carries a reasoning
 * effort on a model whose effort only works there (`effortRequiresDirect` —
 * the Claude family). Everything else runs on the aggregator at its price,
 * falling back to the vendor's API only if the aggregator fails (at no extra
 * charge).
 *
 * The SINGLE decision both the credit identifier and the LLM client's routing
 * read, so what is billed and where it runs cannot disagree. Ignores a stale
 * `advancedMode` on a model with no direct lane, like the bump always has.
 */
export function llmServesDirect(
  modelId: string | undefined,
  reasoningEffort?: string,
  advancedMode?: boolean,
): boolean {
  if (!supportsAdvancedMode(modelId)) return false
  if (advancedMode) return true
  return Boolean(
    getLlmModel(modelId!)?.effortRequiresDirect && effectiveReasoningEffort(modelId, reasoningEffort) !== undefined,
  )
}

/**
 * The credit rungs an LLM feature bills on, cheapest first. `premium-direct` is
 * reached only by a premium model served direct (decided 2026-10-08): the bump
 * for running direct moves one rung on THIS ladder, so a premium model has
 * somewhere to go. The effort bump keeps the three-rung ladder.
 */
export const LLM_CREDIT_RUNGS = ["economy", "standard", "premium", "premium-direct"] as const
export type LlmCreditRung = (typeof LLM_CREDIT_RUNGS)[number]

/** The credit identifier for `feature` on one rung — the standard rung is the bare feature id. */
export function llmCreditIdForRung(feature: string, rung: LlmCreditRung): string {
  return rung === "standard" ? feature : `${feature}:${rung}`
}

/** Every credit identifier a tier-priced LLM feature can bill under, in rung order. */
export function llmTierCreditIds(feature: string): string[] {
  return LLM_CREDIT_RUNGS.map((rung) => llmCreditIdForRung(feature, rung))
}

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
  // A call served on the vendor's own API (Advanced mode, or an effort on a
  // model whose effort only works there — llmServesDirect) bills materially
  // more per token than the aggregator. It bumps INDEPENDENTLY of the effort
  // bump — the two are separate cost levers and genuinely stack, so a
  // max-effort advanced economy call lands at premium — and on the four-rung
  // ladder, so a premium model served direct lands at `premium-direct`. A stale
  // flag on a model with no direct lane never inflates a bill.
  const rung: LlmCreditRung = llmServesDirect(modelId, reasoningEffort, advancedMode) ? bumpToDirectRung(tier) : tier
  return llmCreditIdForRung(feature, rung)
}

/** One rung up the four-rung ladder — the direct-lane bump. */
function bumpToDirectRung(tier: LlmTier): LlmCreditRung {
  return tier === "premium" ? "premium-direct" : bumpTier(tier)
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
