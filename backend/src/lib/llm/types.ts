/**
 * The LLM client's public request/response shapes — re-exported by `../llm-client.ts`.
 */

import type { LlmReasoningEffort } from "@nodaro/shared/llm-models"
import type { LlmServingLane } from "../pricing/llm-cost.js"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LlmContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "image_base64"; mediaType: string; data: string }
  | {
      type: "video"
      url: string
      mimeType?: string
      /**
       * Frame sampling rate. Gemini samples at 1 fps by default; this raises it,
       * and it is the only lever that gets a model MORE frames of the same clip.
       *
       * DIRECT LANE ONLY. KIE reaches Gemini through the `image_url`
       * URL-smuggling hack, which has nowhere to carry this, so `buildChat-
       * CompletionsMessages` THROWS on an fps-bearing block rather than quietly
       * analysing at 1 fps — a silent downgrade here is indistinguishable from
       * success and would mis-ground the analysis with no signal.
       *
       * Costs ~66 tokens per frame, so prompt tokens scale linearly in fps
       * (measured 2026-07-29 against a 640x360 clip: 3,274 prompt tokens at
       * fps 1, 8,026 at fps 3, 15,088 at fps 6, i.e. 66/frame + 25/sec of audio).
       */
      fps?: number
    }
  | {
      /**
       * Inline video BYTES — the exact clip, carried in the request itself.
       *
       * WHY BYTES AND NOT A URL: every other media block in this union is a
       * URL, because both lanes that carry media dereference one (KIE server
       * side, `gemini/media.ts` on our side). That is fine when the URL *is*
       * the asset's identity. It is wrong when a caller must analyse a
       * SPECIFIC, IMMUTABLE set of bytes it already holds: publishing the
       * user's media to reach the model is a privacy cost with no upside, and
       * a mutable or signed URL is not durable request identity — the object
       * behind it can change, expire, or 403 between the request being built
       * and the model reading it, and the analysis would silently describe
       * something else. Handing the bytes over closes both.
       *
       * DIRECT GOOGLE LANE ONLY, and the ONLY lane-pinned block in this union:
       * `llmComplete`/`llmStream` reject the whole request unless it carries
       * `requireLane: "direct"` (see {@link assertInlineVideoLane}). Nothing
       * else can carry it — KIE's chat-completions proxy smuggles media as an
       * `image_url` it dereferences itself (no bytes channel at all), and the
       * Claude `messages` / GPT `responses` lanes take no video input in any
       * form. Requiring the pin is what makes that TOTAL: an unpinned call on
       * a Gemini model would still be eligible for a KIE leg (primary or
       * fallback), so "it happened to route direct today" is not a guarantee.
       *
       * Bounded and validated before the request leaves the process —
       * `gemini/media.ts` enforces exact media type, canonical base64, MP4
       * `ftyp` magic and a 6 MiB RAW ceiling (see `INLINE_MAX_BYTES`; base64
       * inflates that 4/3 on the wire, staying well inside Google's ~20 MB
       * request limit). Anything larger belongs on the URL-bearing `video`
       * block, which streams to the Files API instead.
       */
      type: "video_base64"
      /** Exact, not a family: only `video/mp4` is accepted (validated). */
      mediaType: "video/mp4"
      /** Canonical base64 of the raw MP4 bytes — no data: prefix, no newlines. */
      data: string
      /** Frame sampling rate, identical semantics to the `video` block's `fps`. */
      fps?: number
    }
  | { type: "audio"; url: string; mimeType?: string }

export interface LlmMessage {
  role: "user" | "assistant"
  content: string | LlmContentBlock[]
}

export interface LlmRequest {
  modelId: string
  system: string
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
  /** Nucleus-sampling cutoff (`top_p`). Passed through to the KIE body when set;
   *  a caller pins it (e.g. 1.0 to disable nucleus filtering) to avoid riding an
   *  unknown vendor default. Undefined → not sent. */
  topP?: number
  /**
   * Requested reasoning effort. Clamped to the model's declared levels
   * (`effectiveReasoningEffort`); undefined / unsupported → nothing is sent
   * and the vendor default applies.
   */
  reasoningEffort?: LlmReasoningEffort
  /** Feature name — used only for default model resolution */
  feature?: string
  /**
   * Per-request timeout override in milliseconds. Defaults to LLM_TIMEOUT_MS
   * (120s) when omitted, so existing callers are unchanged. Large structured
   * outputs (e.g. the Lottie motion-graphics worker) pass a higher value.
   */
  timeoutMs?: number
  /**
   * Allow a collapsed SSE adapter to restart a stream that failed BEFORE reporting any usage;
   * defaults to true. Set `false` to see the first failure immediately.
   *
   * This is a TRANSPORT policy and it is independent of `llmCompleteStructured`'s `maxRetries`,
   * which counts validation retries. A transport retry re-asks a question the provider never
   * answered and never billed; a validation retry re-asks one it DID answer, and pays again. A
   * call that reported usage is never retried here, whatever this field says. Serving-lane
   * fallback and vendor SDK retry settings are separate policies again.
   */
  retryStreamOnError?: boolean
  /**
   * A Claude `stop_reason: "refusal"` throws `LlmContentRefusalError` instead
   * of returning the refusal's text. Set by the structured entry points
   * (`llm/structured.ts`) on every attempt they make; a plain call leaves it
   * off, so its refusal reads as an ordinary answer.
   */
  failOnRefusal?: boolean
  /**
   * Request schema-constrained output. The router enforces it natively where
   * the model supports it (Anthropic forced tool / Gemini `response_format`);
   * for models with no native mode the field is ignored and the caller's
   * parse+retry loop ({@link llmCompleteStructured}) is the guarantee. Prefer
   * calling {@link llmCompleteStructured} over setting this directly.
   */
  jsonSchema?: { name: string; schema: Record<string, unknown> }
  /**
   * Pin the serving lane for THIS call, overriding the model's registry default.
   *
   * `"direct"` means the vendor's own API, with one exception: when the account
   * behind it cannot serve — no Anthropic key for a Claude model, or a
   * platform-account refusal — the call is served by KIE on the same registry
   * model, unless it is Advanced mode (`advancedMode`) or carries media KIE
   * cannot carry (`kieCanCarry`). Video-analysis pins direct for exactly that
   * last reason: its video never reaches a KIE leg, and a refusal surfaces.
   *
   * Pinning a model with no lane of that kind is a configuration error and
   * throws rather than degrading — see {@link assertLanePinnable}.
   */
  requireLane?: LlmServingLane
  /**
   * Set by `resolveLlmParams` when the person turned Advanced mode on (it also
   * pins `requireLane: "direct"`). Such a call is never served from KIE — not by
   * the exhaustion fallback, its latched skip, a stream twin, or a keyless
   * Claude pin: it fails as `advanced_mode_unavailable` instead
   * (`LlmAdvancedModeUnavailableError`).
   */
  advancedMode?: boolean
  /**
   * Reject the response unless the provider reports at least this many PROMPT
   * tokens. Set it when the request carries media the answer depends on.
   *
   * This exists because the proxied lane FAILS OPEN on media. Measured
   * 2026-07-31: of 7 KIE calls carrying a freshly-uploaded R2 video, 3 came
   * back reporting prompt tokens equal to the system prompt ALONE — the video
   * was never ingested — and answered with a fluent, schema-valid analysis of
   * a video that does not exist (a different invented one each time: a
   * programmer with a tabby cat, a starship pilot, a luxury-watch commercial).
   * Nothing downstream can catch that: the text is well-formed, the schema
   * validates, and a text-only grader cannot tell a confident fabrication from
   * the truth. The token count is the only honest signal, and only the caller
   * knows how much media it sent, so the floor is passed in rather than
   * guessed here.
   *
   * Enforced on all three KIE formats — that is the lane with the hazard, and
   * where `buildResponse` sees both the request and the reported usage. The
   * collapsed responses lane (`kieCollapseStream`) returns the stream parser's
   * own object instead of calling `buildResponse`, so it re-applies the guard
   * itself once the retry has resolved. It is
   * deliberately NOT wired into the direct lanes: `lib/gemini/media.ts` already
   * THROWS when media cannot be fetched, so an ungrounded answer is not
   * reachable there, and the direct-Anthropic paths carry no video at all.
   * Setting the field on a direct-pinned call is harmless and simply inert.
   */
  minPromptTokens?: number
  /**
   * Send KIE's binary `thinkingFlag` on the Claude wire even with no reasoning
   * effort set. For a caller that moves a call to KIE itself and asks a model
   * that reasons by default (`thinkingDefaultOn`) — on the direct lane such a
   * model thinks with no parameter at all, on KIE only when flagged. Ignored by
   * every other wire and by the direct lane.
   */
  thinkingFlag?: boolean
  /**
   * Never pay the direct-vendor fallback (decided 2026-10-20): a call whose
   * PRIMARY lane is KIE is not re-asked on the vendor's own API when KIE
   * fails — it fails, and the caller's retry (a scheduled run's retry sweep)
   * handles it later. Removes exactly the KIE→direct legs: the failure
   * fallback of `llmComplete` / `llmStream` / the structured stream, and the
   * direct-tool backup of a structured call KIE never answered well. The
   * primary lane is never changed — a call that must run direct by its own
   * settings (Advanced mode, a reasoning effort on a Claude model, a direct
   * pin) still does, and a direct lane's own fallback TO KIE (the cheaper
   * leg) stays. Set by the orchestrator for a run under a "cheap lanes only"
   * schedule retry policy (`WorkflowExecutionJob.cheapLanesOnly`); default off
   * = today's routing.
   */
  cheapLanesOnly?: boolean
}

/**
 * The lane that actually served a response. A fallback reports the fallback's
 * lane, so a call meant for KIE but answered by Google's own API says
 * `direct-gemini`. Distinct from {@link LlmServingLane}, the pricing band
 * (`kie` | `direct`), which cannot tell the two direct APIs apart.
 */
export type LlmServedLane = "kie" | "direct-gemini" | "direct-anthropic"

export interface LlmResponse {
  text: string
  usage?: { inputTokens: number; outputTokens: number }
  model: string
  /** Estimated provider cost in USD based on token usage */
  providerCost?: number
  /**
   * KIE's own charge for this call (`credits_consumed`, converted to USD), when
   * the reply carried it — absent otherwise, including when `providerCost` is
   * only a rate-table estimate. A caller that must not cost a KIE Claude call
   * from its reported input tokens (they leave out the caller's own prompt)
   * reads this, and estimates from sizes when it is absent (`kie-cost.ts`).
   */
  creditsUsd?: number
  /** Which lane served this response (see {@link LlmServedLane}). */
  lane: LlmServedLane
}
