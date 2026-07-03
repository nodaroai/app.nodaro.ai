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
import type { BrandTokens } from "@nodaro/shared"

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

/**
 * Repair context (Task T2 — one-round author self-repair on resolver
 * rejection). Set by `runVideoDirector` when `bakeShotSequence` throws on the
 * FIRST attempt; asks the author for a corrected brief while holding
 * voScript/cues fixed (speech + forced alignment were already generated from
 * them and cannot be redone without re-billing).
 */
export interface AuthorRepairContext {
  /** The full sequence authored on the attempt that failed the resolver. */
  previousBrief: AuthoredSequence
  /** The resolver's (bake) error message, fed back verbatim. */
  resolverError: string
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

/**
 * Build the initial user-turn content for a self-repair authoring call
 * (Task T2). Appends a REPAIR block to the original brief: the previous
 * brief's full JSON + the resolver's exact error, with a hard constraint that
 * voScript and every cue must stay byte-identical — only scene/shot/reveal
 * structure and timing may change. `runVideoDirector` discards the repair and
 * throws the ORIGINAL bake error if that constraint is violated.
 */
function buildRepairPrompt(brief: string, repair: AuthorRepairContext): string {
  return `${brief}

---

## REPAIR REQUIRED

Your previous brief failed the resolver with this exact error:

"${repair.resolverError}"

Here is the previous brief you authored (for reference only — do not return it unchanged):

\`\`\`json
${JSON.stringify(repair.previousBrief, null, 2)}
\`\`\`

Produce a corrected shotSequenceBrief that fixes ONLY the scene/shot/reveal structure and timing — e.g. scenes must be strictly non-overlapping, including reveal holds. When in doubt, prefer collapsing to ONE scene (mirroring the doctrine's own guidance).

HARD CONSTRAINT: "voScript" and every entry in "cues" (id, text, and order) MUST remain EXACTLY UNCHANGED from the previous brief above — do not rewrite, rephrase, reorder, or add/remove any narration. Speech and forced alignment were already generated from them and cannot be redone. Only scene/shot/reveal structure and timing may change.

Return ONLY the JSON object matching the machine contract — no prose, no markdown fences.`
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
 * @param opts.brand   Optional RESOLVED brand tokens. When present, a brand
 *                     block is appended to the system prompt so the LLM authors
 *                     colors/fonts FROM the palette. Resolved by the caller
 *                     (runVideoDirector) — this function does not resolve presets.
 * @param opts.llm     Injectable LLM function (defaults to llmComplete). Tests
 *                     pass a vi.fn() mock; production uses the real client.
 * @param opts.repair  Optional one-round repair context (Task T2), set by
 *                     runVideoDirector when the bake/resolve step rejects the
 *                     previously authored brief. When present, the initial
 *                     user turn is the brief + a REPAIR block (see
 *                     buildRepairPrompt) instead of the bare brief.
 */
export async function authorShotSequence(opts: {
  genre: VideoGenre
  brief: string
  userId: string
  tier: string
  brand?: BrandTokens
  llm?: LlmFn
  repair?: AuthorRepairContext
}): Promise<AuthoredSequence> {
  const { genre, brief, brand, repair, llm: llmFn = llmComplete } = opts
  const system = buildAuthorSystemPrompt(genre, brand)

  // Initial turn: the brief, or — on a repair round — the brief plus the
  // REPAIR block asking for a corrected brief with voScript/cues held fixed.
  const initialContent = repair ? buildRepairPrompt(brief, repair) : brief
  let messages: LlmRequest["messages"] = [{ role: "user", content: initialContent }]
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
