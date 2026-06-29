/**
 * Authoring core (Unit C) — the video-director's LLM brain.
 *
 * Given a genre + one-line brief, makes ONE premium-tier LLM call using the
 * ported HyperFrames doctrine as the system prompt, then parses + validates
 * the result into a typed AuthoredSequence.
 *
 * Retry contract: on parse/schema/cue-substring failure, retries ONCE feeding
 * the error back as a correction turn. Second failure throws AuthoringError.
 *
 * Credit reservation is NOT done here — it happens at the MCP-tool / worker
 * layer (Task 6/D′). This function only produces the authored data.
 */

import { shotSequenceBriefSchema, type ShotSequenceBrief } from "../../services/shot-sequence/brief-schema.js"
import { llmComplete, type LlmRequest, type LlmResponse } from "../../lib/llm-client.js"
import { extractJsonFromAIResponse } from "../../lib/json-utils.js"
import { buildAuthorSystemPrompt, type VideoGenre } from "./prompt.js"

export type { VideoGenre }

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export class AuthoringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AuthoringError"
  }
}

export interface AuthoredSequence {
  voScript: string
  cues: { id: string; text: string }[]
  shotSequenceBrief: ShotSequenceBrief
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Model used for authoring. Sonnet 4.6 (standard tier) is sufficient to hold
 * the full doctrine + machine contract and produces high-quality VO + reveal
 * structures in one shot, at a fraction of the Opus cost.
 *
 * [figures removed]
 *   → 9 credits per authoring call.
 * This is seeded as `STATIC_CREDIT_COSTS["video-director"]` in
 * `ee/billing/credits.ts` (no :economy/:premium composites — the model is
 * fixed and not user-selectable).
 *
 * LLM_FEATURE_DEFAULTS decision: `llmComplete`'s `feature` field is typed as
 * `string` (not `LlmFeature`), so "video-director" does NOT need to be added to
 * the `LlmFeature` union. We pass `modelId` directly, bypassing the
 * feature-based default resolution.
 */
const AUTHOR_MODEL = "claude-sonnet-4.6"

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

type LlmFn = (req: LlmRequest) => Promise<LlmResponse>

type ParseResult =
  | { ok: true; value: AuthoredSequence }
  | { ok: false; error: string }

/**
 * Parse a raw LLM text response into a validated AuthoredSequence.
 * Returns an error descriptor (not throws) so the caller can decide to retry.
 */
function tryParseAndValidate(text: string): ParseResult {
  // 1. Strip markdown fences / extract first JSON object
  let raw: string
  try {
    raw = extractJsonFromAIResponse(text)
  } catch {
    return { ok: false, error: "Failed to extract JSON from response." }
  }

  // 2. Parse JSON
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: "Output was not valid JSON." }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Output was not a JSON object." }
  }

  const obj = parsed as Record<string, unknown>

  // 3. Extract top-level fields
  const voScript = typeof obj.voScript === "string" ? obj.voScript : undefined
  const cues = Array.isArray(obj.cues) ? (obj.cues as unknown[]) : undefined
  const briefRaw = obj.shotSequenceBrief

  if (!voScript) return { ok: false, error: 'Missing or non-string "voScript" field.' }
  if (!cues) return { ok: false, error: 'Missing or non-array "cues" field.' }
  if (briefRaw === undefined || briefRaw === null) {
    return { ok: false, error: 'Missing "shotSequenceBrief" field.' }
  }

  // 4. Validate shotSequenceBrief against Zod schema
  const briefResult = shotSequenceBriefSchema.safeParse(briefRaw)
  if (!briefResult.success) {
    const issues = briefResult.error.issues
      .slice(0, 6)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")
    return { ok: false, error: `shotSequenceBrief schema invalid: ${issues}` }
  }

  // 5. Validate each cue: { id, text } with text a substring of voScript
  const typedCues: { id: string; text: string }[] = []
  for (const item of cues) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false, error: "Each cue must be an object." }
    }
    const c = item as Record<string, unknown>
    if (typeof c.id !== "string" || typeof c.text !== "string") {
      return { ok: false, error: 'Each cue must have string "id" and "text".' }
    }
    const trimmedText = c.text.trim()
    if (!voScript.includes(trimmedText)) {
      return {
        ok: false,
        error: `Cue text "${trimmedText}" (id: "${c.id}") is not a whitespace-exact substring of voScript.`,
      }
    }
    typedCues.push({ id: c.id, text: trimmedText })
  }

  if (typedCues.length === 0) {
    return { ok: false, error: "cues array must not be empty." }
  }

  return {
    ok: true,
    value: {
      voScript,
      cues: typedCues,
      shotSequenceBrief: briefResult.data,
    },
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Author a shot sequence from a genre + one-line brief.
 *
 * Makes one standard-tier LLM call (claude-sonnet-4.6, fixed). On
 * parse/schema/cue-substring failure, retries ONCE with the error fed back as
 * a correction turn. Throws AuthoringError on second failure.
 *
 * @param opts.genre   "explainer" | "product-launch"
 * @param opts.brief   The one-line creative brief from the caller.
 * @param opts.userId  The requesting user id (passed through for future audit).
 * @param opts.tier    The user's plan tier (passed through for future gating).
 * @param opts.llm     Injectable LLM function (defaults to llmComplete). Tests
 *                     pass a vi.fn() mock; production uses the real client.
 */
export async function authorShotSequence(opts: {
  genre: VideoGenre
  brief: string
  userId: string
  tier: string
  llm?: LlmFn
}): Promise<AuthoredSequence> {
  const { genre, brief, llm: llmFn = llmComplete } = opts
  const system = buildAuthorSystemPrompt(genre)

  // Initial turn: just the user's brief
  let messages: LlmRequest["messages"] = [{ role: "user", content: brief }]
  let lastError = ""

  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await llmFn({ modelId: AUTHOR_MODEL, system, messages, maxTokens: 16000 })
    const result = tryParseAndValidate(resp.text)

    if (result.ok) return result.value

    lastError = result.error

    // Correction turn for retry: append the bad output as assistant message,
    // then a user correction. Roles MUST alternate (Anthropic rejects consecutive
    // same-role messages), so we keep the initial user turn + add assistant + user.
    messages = [
      ...messages,
      { role: "assistant", content: resp.text || "{}" },
      {
        role: "user",
        content: `Your previous output was invalid: ${lastError}. Return ONLY the valid JSON object matching the machine contract — no prose, no markdown fences.`,
      },
    ]
  }

  throw new AuthoringError(`Authoring failed after 2 attempts: ${lastError}`)
}
