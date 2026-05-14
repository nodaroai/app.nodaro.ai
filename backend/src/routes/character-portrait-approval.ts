import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { llmComplete } from "../lib/llm-client.js"
import { formatZodError } from "../lib/zod-error.js"

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
 * TODO (spec Open item #7): deduct 1 CR per LLM call. PR 1 ships without it;
 * the existing studio doesn't hit these routes (PR 2 surface). Will be added
 * before the new studio UI ships.
 */

const idParams = z.object({ id: z.string().uuid() })
const approveBody = z.object({ candidateJobId: z.string().uuid() })

const CAPTION_SYSTEM =
  "You write rich, ~80–120-word visual descriptions of a character based on their portrait. " +
  "Cover: face shape, skin tone, eyes (color, shape), nose, mouth, hair (color, style, length), distinctive features, " +
  "build, apparent age, demeanor. Be specific. Avoid clothing unless distinctive. " +
  "This description gets passed to image-gen models alongside the portrait to maintain identity consistency. " +
  "Output only the description; no preamble."

/**
 * Run the LLM caption for a portrait URL. Re-throws on failure so the caller
 * can log with the FastifyRequest's structured logger + decide whether to
 * swallow (approve-portrait, where caption failure is non-fatal) or surface
 * as a 502 (llm-caption, the explicit re-caption surface).
 */
async function captionPortrait(portraitUrl: string): Promise<string | null> {
  const result = await llmComplete({
    modelId: "claude-sonnet-4.6",
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
    maxTokens: 600,
    temperature: 0.6,
  })
  const text = (result.text ?? "").trim()
  return text.length > 0 ? text : null
}

function checkProvider(reply: FastifyReply): boolean {
  if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
    reply.status(503).send({
      error: { code: "provider_unavailable", message: "LLM API key not configured" },
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
  app.post("/v1/characters/:id/approve-portrait", async (req, reply) => {
    const characterId = requireAuthProviderAndId(req, reply)
    if (characterId === null) return

    const body = approveBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
    }

    const { data: job, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, status, output_data")
      .eq("id", body.data.candidateJobId)
      .eq("user_id", req.userId)
      .single()

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

    // Pre-fetch the character to validate ownership + not-deleted BEFORE the
    // paid (~5-30s) LLM call. Without this, PostgREST .update().eq().eq()
    // silently succeeds on zero rows and we leak LLM output for a character
    // the caller doesn't own (soft IDOR).
    const { data: charRow, error: charFetchErr } = await supabase
      .from("characters")
      .select("id")
      .eq("id", characterId)
      .eq("user_id", req.userId)
      .is("deleted_at", null)
      .single()
    if (charFetchErr || !charRow) {
      return reply.status(404).send({ error: { code: "not_found", message: "Character not found" } })
    }

    let canonicalDescription: string | null = null
    try {
      canonicalDescription = await captionPortrait(portraitUrl)
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
      return reply.status(500).send({ error: { code: "internal_error", message: updateErr.message } })
    }

    return { portraitUrl, canonicalDescription }
  })

  app.post("/v1/characters/:id/llm-caption", async (req, reply) => {
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

    let canonicalDescription: string | null
    try {
      canonicalDescription = await captionPortrait(portraitUrl)
    } catch (err) {
      req.log.warn(
        { err, characterId, portraitUrl },
        "[character-portrait-approval] LLM caption failed (llm-caption)",
      )
      return reply.status(502).send({ error: { code: "llm_failure", message: "LLM caption failed" } })
    }
    if (canonicalDescription === null) {
      return reply.status(502).send({ error: { code: "llm_failure", message: "LLM caption failed" } })
    }

    const { error: updateErr } = await supabase
      .from("characters")
      .update({ canonical_description: canonicalDescription, updated_at: new Date().toISOString() })
      .eq("id", characterId)
      .eq("user_id", req.userId)
    if (updateErr) {
      return reply.status(500).send({ error: { code: "internal_error", message: updateErr.message } })
    }
    return { canonicalDescription }
  })
}
