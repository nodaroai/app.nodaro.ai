import type { FastifyInstance } from "fastify"
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
 * Both routes scope by req.userId. Cross-user candidates return 404
 * (indistinguishable from "doesn't exist" — see spec error table).
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

async function captionPortrait(portraitUrl: string): Promise<string | null> {
  try {
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
    const text = result.text.trim()
    return text.length > 0 ? text : null
  } catch (err) {
    console.warn("[approve-portrait] LLM caption failed:", err)
    return null
  }
}

function checkProvider(reply: import("fastify").FastifyReply): boolean {
  if (!config.KIE_API_KEY && !config.ANTHROPIC_API_KEY) {
    reply.status(503).send({
      error: { code: "provider_unavailable", message: "LLM API key not configured" },
    })
    return false
  }
  return true
}

export async function characterPortraitApprovalRoutes(app: FastifyInstance) {
  app.post("/v1/characters/:id/approve-portrait", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (!checkProvider(reply)) return

    const params = idParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid character id" } })
    }
    const body = approveBody.safeParse(req.body)
    if (!body.success) {
      return reply.status(400).send({ error: { code: "validation_error", ...formatZodError(body.error) } })
    }

    const { data: job, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, user_id, status, output_data")
      .eq("id", body.data.candidateJobId)
      .single()

    if (fetchErr || !job) {
      return reply.status(404).send({ error: { code: "not_found", message: "Candidate not found" } })
    }
    if (job.user_id !== req.userId) {
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

    const canonicalDescription = await captionPortrait(portraitUrl)

    const { error: updateErr } = await supabase
      .from("characters")
      .update({
        source_image_url: portraitUrl,
        canonical_description: canonicalDescription,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.data.id)
      .eq("user_id", req.userId)

    if (updateErr) {
      return reply.status(500).send({ error: { code: "internal_error", message: updateErr.message } })
    }

    return { portraitUrl, canonicalDescription }
  })

  app.post("/v1/characters/:id/llm-caption", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (!checkProvider(reply)) return

    const params = idParams.safeParse(req.params)
    if (!params.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: "Invalid character id" } })
    }

    const { data: row, error: fetchErr } = await supabase
      .from("characters")
      .select("source_image_url")
      .eq("id", params.data.id)
      .eq("user_id", req.userId)
      .single()
    if (fetchErr || !row) {
      return reply.status(404).send({ error: { code: "not_found", message: "Character not found" } })
    }
    if (!(row as { source_image_url?: string | null }).source_image_url) {
      return reply.status(400).send({ error: { code: "no_portrait", message: "Character has no approved portrait yet" } })
    }
    const canonicalDescription = await captionPortrait((row as { source_image_url: string }).source_image_url)
    if (canonicalDescription === null) {
      return reply.status(502).send({ error: { code: "llm_failure", message: "LLM caption failed" } })
    }
    const { error: updateErr } = await supabase
      .from("characters")
      .update({ canonical_description: canonicalDescription, updated_at: new Date().toISOString() })
      .eq("id", params.data.id)
      .eq("user_id", req.userId)
    if (updateErr) {
      return reply.status(500).send({ error: { code: "internal_error", message: updateErr.message } })
    }
    return { canonicalDescription }
  })
}
