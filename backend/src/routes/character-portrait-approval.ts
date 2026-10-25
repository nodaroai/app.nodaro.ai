import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { llmComplete, type LlmRequest } from "../lib/llm-client.js"
import { meterSyncLlmMetered, type LlmSpend } from "../lib/llm-billing.js"
import { llmMeteredPricing } from "../lib/config.js"
import { claudeLaneConfigured } from "../lib/llm/anthropic-availability.js"
import { requireAppScope } from "../lib/scope-prehandler.js"
import { formatZodError } from "../lib/zod-error.js"
import { creditGuard } from "../middleware/credit-guard.js"
import { billedFailureMessage, llmGuardPrecheck, meterOptionalSyncLlm, spendLlmCall, type MeteredSyncLlmMeter } from "../lib/meter-sync-llm.js"
import { sendInternalError } from "../lib/http-errors.js"
import { PORTRAIT_CAPTION_MODEL } from "../lib/portrait-caption-model.js"
import { TRASHED_JOB_COLUMN } from "../lib/public-job-data.js"

// Bill the paid Sonnet vision caption at the shared prompt-helper rate (same as
// llm-suggest-description) — the dedicated /llm-caption retry route is otherwise
// a loopable free Claude proxy.
const CAPTION_CREDIT_IDENTIFIER = "prompt-helper"

/**
 * Character portrait approval + canonical-description LLM caption.
 *
 * POST /v1/characters/:id/approve-portrait — body { candidateJobId }
 *   Validates candidate belongs to caller AND status='completed'.
 *   Validates the target character exists, belongs to caller, and is not
 *   soft-deleted (pre-fetch BEFORE the paid LLM call — prevents leaking LLM
 *   output for a character the caller doesn't own).
 *   Sets characters.source_image_url, fires LLM caption inline (Claude Sonnet
 *   vision), persists canonical_description. Returns
 *   { portraitUrl: string, canonicalDescription: string | null }.
 *   canonicalDescription is null on LLM caption sub-failure — the portrait is
 *   still set; frontend retries via /llm-caption.
 *
 * POST /v1/characters/:id/llm-caption — body {}
 *   Re-fires the caption against the current source_image_url. Returns
 *   { canonicalDescription }. 502 on LLM failure. 400 no_portrait if no portrait.
 *
 * Both routes scope by req.userId. Cross-user candidates / characters return
 * 404 (indistinguishable from "doesn't exist" — see spec error table).
 *
 * Billing (D3/D8): BOTH captions bill metered under prompt-helper:<model> — a
 * billed failure charged, an unbilled one refunded. approve-portrait was free
 * before metered pricing and stays free under the rollback; /llm-caption bills
 * the flat prompt-helper rate under the rollback, as it always did.
 */

const idParams = z.object({ id: z.string().uuid() })
const approveBody = z.object({ candidateJobId: z.string().uuid() })

const CAPTION_SYSTEM =
  "You write rich, ~80–120-word visual descriptions of a character based on their portrait. " +
  "Output a single flowing paragraph (NOT a structured list) that ALWAYS names: " +
  "eye color (e.g. brown, blue, hazel, green), " +
  "hair color (e.g. black, blonde, auburn, grey), " +
  "hair style (length, texture, distinctive style), " +
  "skin tone, " +
  "approximate age range, " +
  "build (slim, athletic, heavy-set, etc.), " +
  "and any distinctive features (scars, tattoos, glasses, freckles, jewelry). " +
  "Be specific and concrete — if any of these traits are not clearly visible in the portrait, infer the most likely value rather than omitting it. " +
  "Avoid clothing unless distinctive. " +
  "This description gets passed to image-gen models alongside the portrait to maintain identity consistency, so every named trait matters. " +
  "Output the description only, no preamble."

/**
 * Run the LLM caption for a portrait URL. Re-throws on failure so the caller
 * can log with the FastifyRequest's structured logger + decide whether to
 * swallow (approve-portrait, where caption failure is non-fatal) or surface
 * as a 502 (llm-caption, the explicit re-caption surface).
 */
const PORTRAIT_CAPTION_MAX_TOKENS = 600

/** The caption request as it is sent — what a metered route sizes its hold from. */
function portraitCaptionRequest(portraitUrl: string): LlmRequest {
  return {
    modelId: PORTRAIT_CAPTION_MODEL,
    system: CAPTION_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Write a deep visual description of this character portrait:" },
          { type: "image", url: portraitUrl },
        ],
      },
    ],
    maxTokens: PORTRAIT_CAPTION_MAX_TOKENS,
    temperature: 0.6,
  }
}

/** `spend` (metered): the call is recorded as billed — its answer, or a failure's billed usage — before anything else. */
async function captionPortrait(portraitUrl: string, spend?: LlmSpend): Promise<string | null> {
  const request = portraitCaptionRequest(portraitUrl)
  const result = await spendLlmCall(spend, PORTRAIT_CAPTION_MODEL, request, () => llmComplete(request))
  const text = (result.text ?? "").trim()
  return text.length > 0 ? text : null
}

function checkProvider(reply: FastifyReply): boolean {
  // captionPortrait() calls llmComplete with modelId="claude-sonnet-4.6", which
  // the router serves on KIE or on the Anthropic account — refuse only when
  // neither is configured, with a clean 503 instead of a mid-request failure.
  if (!claudeLaneConfigured()) {
    reply.status(503).send({
      error: { code: "provider_unavailable", message: "No AI provider key is configured" },
    })
    return false
  }
  return true
}

/**
 * Shared preflight: 401 auth -> 503 provider -> 400 invalid id-param.
 * Returns the validated character id, or null if a response has been sent.
 */
function requireAuthProviderAndId(req: FastifyRequest, reply: FastifyReply): string | null {
  if (!req.userId) {
    reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    return null
  }
  if (!checkProvider(reply)) return null
  const parsed = idParams.safeParse(req.params)
  if (!parsed.success) {
    reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    return null
  }
  return parsed.data.id
}

export async function characterPortraitApprovalRoutes(app: FastifyInstance) {
  // The approve-portrait caption's payer-aware guard, run INLINE only when the
  // caption bills metered (meterOptionalSyncLlm) — under the rollback the
  // approval has none, exactly as before.
  const captionGuard = creditGuard(() => CAPTION_CREDIT_IDENTIFIER, {
    dedup: false,
    computeCredits: () => llmGuardPrecheck("prompt-helper", undefined, { llmModel: PORTRAIT_CAPTION_MODEL, maxTokens: PORTRAIT_CAPTION_MAX_TOKENS }),
  })
  app.post(
    "/v1/characters/:id/approve-portrait",
    {
      preHandler: requireAppScope("assets:write"),
      // 10 req/min/IP — gates the paid LLM caption (Claude Sonnet vision,
      // per call). Mirrors `location-main-image-approval.ts`. Without
      // this, a motivated attacker can burn /min in Anthropic credits.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
    const characterId = requireAuthProviderAndId(req, reply)
    if (characterId === null) return

    const body = approveBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
    }

    // Fire candidate + character fetches in parallel — both must succeed before
    // the paid (~5-30s) LLM call, and both are scoped by req.userId so a
    // cross-user candidate or character returns null (mapped to 404 below).
    // Error evaluation order matches the spec: candidate 404 first, then
    // candidate not-ready (400), then character 404. Without the character
    // pre-fetch, PostgREST .update().eq().eq() silently succeeds on zero rows
    // and we'd leak LLM output for a character the caller doesn't own (soft IDOR).
    const [candidateResult, characterResult] = await Promise.all([
      supabase
        .from("jobs")
        .select("id, status, output_data")
        .is(TRASHED_JOB_COLUMN, null)
        .eq("id", body.data.candidateJobId)
        .eq("user_id", req.userId)
        .single(),
      supabase
        .from("characters")
        .select("id")
        .eq("id", characterId)
        .eq("user_id", req.userId)
        .is("deleted_at", null)
        .single(),
    ])

    const { data: job, error: fetchErr } = candidateResult
    if (fetchErr || !job) {
      return reply.status(404).send({ error: { code: "not_found", message: "Candidate not found" } })
    }
    if (job.status !== "completed") {
      return reply.status(400).send({ error: { code: "candidate_not_ready", message: "Candidate not ready" } })
    }

    const output = (job.output_data ?? {}) as Record<string, unknown>
    const portraitUrl = typeof output.imageUrl === "string" ? output.imageUrl : null
    if (!portraitUrl) {
      return reply.status(400).send({ error: { code: "candidate_not_ready", message: "Candidate has no imageUrl" } })
    }

    const { data: charRow, error: charFetchErr } = characterResult
    if (charFetchErr || !charRow) {
      return reply.status(404).send({ error: { code: "not_found", message: "Character not found" } })
    }

    // Metered (D3/D8): the caption is BILLED — held under prompt-helper:<model>
    // and settled at what it cost. Free before metered pricing, so under the
    // rollback it stays free: no reservation, exactly as before. An approval
    // is NEVER blocked by credits (owner decision D11): when the caption's hold is
    // refused the portrait is still approved, the caption skipped
    // (canonical_description null) and /llm-caption retries it later.
    let meter: MeteredSyncLlmMeter | null | undefined
    if (llmMeteredPricing()) {
      // The caption guard runs inline (spend surface, instance cap, payer
      // balance); a refusal or a billing error skips the caption, never the approval.
      const optional = await meterOptionalSyncLlm(req, captionGuard, "character-portrait-approval", {
        feature: "prompt-helper",
        calls: [{ modelId: PORTRAIT_CAPTION_MODEL, request: portraitCaptionRequest(portraitUrl) }],
      })
      if ("meter" in optional) meter = optional.meter
      else {
        meter = null
        req.log.info({ characterId, skipped: optional.skipped }, "[character-portrait-approval] caption skipped: its hold was refused")
      }
    }

    let canonicalDescription: string | null = null
    if (meter !== null) try {
      canonicalDescription = await captionPortrait(portraitUrl, meter?.spend)
    } catch (err) {
      req.log.warn(
        { err, characterId, portraitUrl },
        "[character-portrait-approval] LLM caption failed (approve-portrait)",
      )
      canonicalDescription = null
    }

    const { error: updateErr } = await supabase
      .from("characters")
      .update({
        source_image_url: portraitUrl,
        canonical_description: canonicalDescription,
        updated_at: new Date().toISOString(),
      })
      .eq("id", characterId)
      .eq("user_id", req.userId)

    if (updateErr) {
      if (meter) await meter.settle("failed", billedFailureMessage("Failed to update character", meter.spend))
      return sendInternalError(reply, req, updateErr, "Failed to update character")
    }

    if (meter) {
      if (canonicalDescription !== null) await meter.settle("completed")
      else await meter.settle("failed", billedFailureMessage("The caption could not be written.", meter.spend))
    }
    return { portraitUrl, canonicalDescription }
  })

  app.post(
    "/v1/characters/:id/llm-caption",
    {
      // dedup:false — this route returns { canonicalDescription }, not the
      // { jobId, deduped:true } shape the idempotency short-circuit would send.
      // Scope first: an app without assets:write is refused before any credit check.
      preHandler: [requireAppScope("assets:write"), creditGuard(() => CAPTION_CREDIT_IDENTIFIER, {
        dedup: false,
        // Metered (D3): the pre-check is the caption call's 1-attempt hold; undefined under the rollback.
        computeCredits: () => llmGuardPrecheck("prompt-helper", undefined, { llmModel: PORTRAIT_CAPTION_MODEL, maxTokens: PORTRAIT_CAPTION_MAX_TOKENS }),
      })],
      // 10 req/min/IP — gates the paid LLM caption. Mirrors location-llm-caption.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
    const characterId = requireAuthProviderAndId(req, reply)
    if (characterId === null) return

    const { data: row, error: fetchErr } = await supabase
      .from("characters")
      .select("source_image_url")
      .eq("id", characterId)
      .eq("user_id", req.userId)
      .single()
    if (fetchErr || !row) {
      return reply.status(404).send({ error: { code: "not_found", message: "Character not found" } })
    }
    const portraitUrl = (row as { source_image_url?: string | null }).source_image_url
    if (!portraitUrl) {
      return reply.status(400).send({ error: { code: "no_portrait", message: "Character has no approved portrait yet" } })
    }

    // Reserve credits (sync route — settle on every outcome, no worker net):
    // metered under prompt-helper:<model>, else the flat prompt-helper rate as before.
    const metered = llmMeteredPricing()
    const meter = await meterSyncLlmMetered(req, reply, "character-llm-caption", {
      feature: "prompt-helper",
      calls: [{ modelId: PORTRAIT_CAPTION_MODEL, request: portraitCaptionRequest(portraitUrl) }],
    })
    if (!meter) return

    let canonicalDescription: string | null
    try {
      canonicalDescription = await captionPortrait(portraitUrl, metered ? meter.spend : undefined)
    } catch (err) {
      req.log.warn(
        { err, characterId, portraitUrl },
        "[character-portrait-approval] LLM caption failed (llm-caption)",
      )
      const message = billedFailureMessage("LLM caption failed", meter.spend)
      await meter.settle("failed", message)
      return reply.status(502).send({ error: { code: "llm_failure", message } })
    }
    if (canonicalDescription === null) {
      const message = billedFailureMessage("LLM caption failed", meter.spend)
      await meter.settle("failed", message)
      return reply.status(502).send({ error: { code: "llm_failure", message } })
    }

    const { error: updateErr } = await supabase
      .from("characters")
      .update({ canonical_description: canonicalDescription, updated_at: new Date().toISOString() })
      .eq("id", characterId)
      .eq("user_id", req.userId)
    if (updateErr) {
      // The caption call was billed and answered: it is charged (never refunded, D10).
      await meter.settle("failed", billedFailureMessage("Failed to update character", meter.spend))
      return sendInternalError(reply, req, updateErr, "Failed to update character")
    }
    await meter.settle("completed")
    return { canonicalDescription }
  })
}
