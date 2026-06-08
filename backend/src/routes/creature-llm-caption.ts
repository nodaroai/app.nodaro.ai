import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { captionCreature } from "../lib/creature-caption.js"
import { formatZodError } from "../lib/zod-error.js"
import { creditGuard } from "../middleware/credit-guard.js"
import { meterSyncLlm } from "../lib/meter-sync-llm.js"

/**
 * Creature canonical-description LLM retry route.
 *
 * POST /v1/creatures/:id/llm-caption — no body
 *   Re-runs the Claude Sonnet vision caption against the creature's existing
 *   `source_image_url` and persists the result to `canonical_description`.
 *   Used by the studio's "retry caption" affordance when
 *   `/approve-main-image` initially returned `canonicalDescription: ""`
 *   (LLM sub-failure path).
 *
 * Mirrors `object-llm-caption.ts` with two creature-specific deltas:
 *   - `captionCreature` (not `captionObject`)
 *   - Uniform `"not_found"` 404 code per spec Pass 10 F-90b (creature
 *     intentionally diverges from location's `location_not_found` per-path
 *     codes to prevent ID enumeration via error-code differences)
 *
 * Differs from `/approve-main-image` in TWO ways:
 *   1. LLM failure is FATAL: returns HTTP 502 `caption_failed`. The
 *      approval route returns 200 with `canonicalDescription: ""` because
 *      it has a side-effect to preserve (promoting `source_image_url`).
 *      This route has none — the only purpose IS the caption, so failure
 *      must surface as a hard error so the frontend can retry.
 *   2. Requires `source_image_url IS NOT NULL`: returns 400
 *      `main_image_required` otherwise. There's nothing to caption until
 *      the user has approved a main image first.
 *
 * Persists `canonical_description` + bumps `updated_at`. Does NOT touch
 * `source_image_url` — that's strictly an approval-route concern.
 *
 * Rate-limit: 10 req/min/IP via `@fastify/rate-limit` config.
 *
 * TODO Phase 2: deduct 1 CR per LLM call.
 */

const paramsSchema = z.object({ id: z.string().uuid() })

// Bill the paid Sonnet vision caption at the shared prompt-helper rate (same as
// llm-suggest-description) — without this the route was a free Claude proxy.
const CREDIT_IDENTIFIER = "prompt-helper"

export async function creatureLlmCaptionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/creatures/:id/llm-caption",
    {
      // dedup:false — this route returns { canonicalDescription }, not the
      // { jobId, deduped:true } shape the idempotency short-circuit would send.
      preHandler: creditGuard(() => CREDIT_IDENTIFIER, { dedup: false }),
      config: {
        // 10 req/min/IP — `@fastify/rate-limit` must be registered globally.
        rateLimit: { max: 10, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      // ----- Auth + validation -----
      if (!req.userId) {
        return reply
          .status(401)
          .send({ error: { code: "unauthorized", message: "Authentication required" } })
      }

      // captionCreature() routes through llmComplete with
      // modelId="claude-sonnet-4.6". Without ANTHROPIC_API_KEY (or
      // KIE_API_KEY as fallback) the LLM call would 502 mid-request —
      // gate it here with a clean 503 instead. Mirrors the object
      // precedent.
      if (!config.ANTHROPIC_API_KEY && !config.KIE_API_KEY) {
        return reply.status(503).send({
          error: { code: "provider_unavailable", message: "No LLM provider configured" },
        })
      }

      const params = paramsSchema.safeParse(req.params)
      if (!params.success) {
        return reply
          .status(400)
          .send({ error: { code: "validation_error", ...formatZodError(params.error) } })
      }
      const { id: creatureId } = params.data

      // ----- Fetch the creature + verify ownership/active state -----
      // Scoped by user_id; `deleted_at IS NULL` rejects archived rows.
      // Both cross-user and archived collapse to a uniform "not_found"
      // 404 (indistinguishable from "doesn't exist") per spec Pass 10
      // F-90b so we don't leak existence to other users.
      const { data: row, error: fetchErr } = await supabase
        .from("creatures")
        .select("id, source_image_url")
        .eq("id", creatureId)
        .eq("user_id", req.userId)
        .is("deleted_at", null)
        .single()
      if (fetchErr || !row) {
        return reply
          .status(404)
          .send({ error: { code: "not_found", message: "Not found" } })
      }
      if (!row.source_image_url) {
        return reply
          .status(400)
          .send({
            error: {
              code: "main_image_required",
              message: "Creature has no source image to caption",
            },
          })
      }

      // ----- Reserve credits, then LLM caption (FATAL — null is a 502) -----
      // Unlike approve-main-image, this route has no side-effect to preserve
      // when the LLM fails. Surface as 502 so the frontend can retry. Refund
      // the reservation on every failure (sync route — no worker refund net).
      const meter = await meterSyncLlm(req, reply, "creature-llm-caption", CREDIT_IDENTIFIER)
      if (!meter) return

      const caption = await captionCreature(row.source_image_url)
      if (caption === null) {
        await meter.refund()
        return reply
          .status(502)
          .send({ error: { code: "caption_failed", message: "Failed to caption creature image" } })
      }

      // ----- Persist canonical_description (NOT source_image_url) -----
      // Bump updated_at so the Studio's optimistic-concurrency token
      // stays in lockstep with the row.
      const { error: updateErr } = await supabase
        .from("creatures")
        .update({
          canonical_description: caption,
          updated_at: new Date().toISOString(),
        })
        .eq("id", creatureId)
        .eq("user_id", req.userId)

      if (updateErr) {
        await meter.refund()
        return reply
          .status(500)
          .send({ error: { code: "update_failed", message: updateErr.message ?? "Update failed" } })
      }

      await meter.commit()
      return reply.send({ canonicalDescription: caption })
    },
  )
}
