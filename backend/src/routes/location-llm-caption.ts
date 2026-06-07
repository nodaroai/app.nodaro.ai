import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { captionLocation } from "../lib/location-caption.js"
import { formatZodError } from "../lib/zod-error.js"
import { creditGuard } from "../middleware/credit-guard.js"
import { meterSyncLlm } from "../lib/meter-sync-llm.js"

/**
 * Location canonical-description LLM retry route.
 *
 * POST /v1/locations/:id/llm-caption — no body
 *   Re-runs the Claude Sonnet vision caption against the location's existing
 *   `source_image_url` and persists the result to `canonical_description`.
 *   Used by the studio's "retry caption" affordance when
 *   `/approve-main-image` initially returned `canonicalDescription: ""`
 *   (LLM sub-failure path).
 *
 * Differs from `/approve-main-image` in TWO ways:
 *   1. LLM failure is FATAL: returns HTTP 502 `caption_failed`. The approval
 *      route returns 200 with `canonicalDescription: ""` because it has a
 *      side-effect to preserve (promoting `source_image_url`). This route has
 *      none — the only purpose IS the caption, so failure must surface as a
 *      hard error so the frontend can retry.
 *   2. Requires `source_image_url IS NOT NULL`: returns 400 `no_source_image`
 *      otherwise. There's nothing to caption until the user has approved a
 *      main image first.
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

export async function locationLlmCaptionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/locations/:id/llm-caption",
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

      // captionLocation() routes through llmComplete with
      // modelId="claude-sonnet-4.6". Without ANTHROPIC_API_KEY (or
      // KIE_API_KEY as fallback) the LLM call would 502 mid-request — gate
      // it here with a clean 503 instead. Mirrors `checkProvider()` in
      // character-portrait-approval.
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
      const { id: locationId } = params.data

      // ----- Fetch the location + verify ownership/active state -----
      // Scoped by user_id; `deleted_at IS NULL` rejects archived rows.
      // Both cross-user and archived collapse to 404 (indistinguishable from
      // "doesn't exist") so we don't leak existence to other users.
      const { data: row, error: fetchErr } = await supabase
        .from("locations")
        .select("id, source_image_url")
        .eq("id", locationId)
        .eq("user_id", req.userId)
        .is("deleted_at", null)
        .single()
      if (fetchErr || !row) {
        return reply
          .status(404)
          .send({ error: { code: "location_not_found", message: "Location not found" } })
      }
      if (!row.source_image_url) {
        return reply
          .status(400)
          .send({
            error: {
              code: "no_source_image",
              message: "Location has no source image to caption",
            },
          })
      }

      // ----- Reserve credits, then LLM caption (FATAL — null is a 502) -----
      // Unlike approve-main-image, this route has no side-effect to preserve
      // when the LLM fails. Surface as 502 so the frontend can retry. Refund the
      // reservation on every failure (sync route — no worker refund net).
      const meter = await meterSyncLlm(req, reply, "location-llm-caption", CREDIT_IDENTIFIER)
      if (!meter) return

      const caption = await captionLocation(row.source_image_url)
      if (caption === null) {
        await meter.refund()
        return reply
          .status(502)
          .send({ error: { code: "caption_failed", message: "Failed to caption location image" } })
      }

      // ----- Persist canonical_description (NOT source_image_url) -----
      // Bump updated_at so the Studio's optimistic-concurrency token stays
      // in lockstep with the row.
      const { error: updateErr } = await supabase
        .from("locations")
        .update({
          canonical_description: caption,
          updated_at: new Date().toISOString(),
        })
        .eq("id", locationId)
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
