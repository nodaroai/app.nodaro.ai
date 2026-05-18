import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { captionLocation } from "../lib/location-caption.js"
import { formatZodError } from "../lib/zod-error.js"

/**
 * Location main-image approval + canonical-description LLM caption.
 *
 * POST /v1/locations/:id/approve-main-image — body { candidateJobId }
 *   Promotes a candidate-generation job's output image to the location's
 *   permanent `source_image_url` AND fires the Claude Sonnet vision caption
 *   inline to populate `canonical_description`.
 *
 * Mirrors `character-portrait-approval.ts` exactly:
 *   - Both candidate + location are fetched in parallel via Promise.all —
 *     both must succeed BEFORE the ~5-30s paid LLM call. Without the
 *     location pre-fetch, PostgREST `.update().eq().eq()` silently succeeds
 *     on zero rows and we'd leak LLM output for a location the caller
 *     doesn't own (soft IDOR).
 *   - Both queries are scoped by `req.userId`, so cross-user candidate /
 *     location returns null → 404 (indistinguishable from "doesn't exist").
 *   - Location pre-fetch ALSO filters `deleted_at IS NULL` — archived
 *     locations are 404 (cannot resurrect-by-approve).
 *
 * Caption-failure semantics:
 *   When the LLM caption sub-fails, the route STILL persists
 *   `source_image_url` and returns HTTP **200** with
 *   `canonicalDescription: ""` (NOT 502, NOT null — frontend type is
 *   non-nullable `string`). The frontend retries via `/llm-caption`.
 *
 * Rate-limit: 10 req/min/IP via `@fastify/rate-limit` config.
 *
 * TODO Phase 2: deduct 1 CR per LLM call (matches character-portrait-approval
 * TODO at line 29). Phase 1 ships without it.
 */

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({ candidateJobId: z.string().uuid() })

export async function locationMainImageApprovalRoutes(app: FastifyInstance) {
  app.post(
    "/v1/locations/:id/approve-main-image",
    {
      config: {
        // 10 req/min/IP — `@fastify/rate-limit` must be registered globally.
        // Mirrors `oauth-register.ts` pattern.
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
      const body = bodySchema.safeParse(req.body)
      if (!body.success) {
        return reply
          .status(400)
          .send({ error: { code: "validation_error", ...formatZodError(body.error) } })
      }

      const { id: locationId } = params.data
      const { candidateJobId } = body.data

      // ----- Parallel fetch: candidate job + location pre-fetch -----
      // Both must succeed before the paid LLM call. Both are scoped by
      // user_id so a cross-user candidate / location returns null (mapped
      // to 404). Location pre-fetch also rejects archived rows.
      const [candidateResult, locationResult] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, status, output_data")
          .eq("id", candidateJobId)
          .eq("user_id", req.userId)
          .single(),
        supabase
          .from("locations")
          .select("id")
          .eq("id", locationId)
          .eq("user_id", req.userId)
          .is("deleted_at", null)
          .single(),
      ])

      // Error evaluation order (matches spec):
      //   1. candidate 404
      //   2. candidate not-completed (400)
      //   3. candidate has no imageUrl (400)
      //   4. location 404 (archived or cross-user)
      // Location 404 evaluates AFTER candidate so a known-bad candidate id
      // doesn't leak whether the location exists.
      const { data: job, error: candidateErr } = candidateResult
      if (candidateErr || !job) {
        return reply
          .status(404)
          .send({ error: { code: "candidate_job_not_found", message: "Candidate job not found" } })
      }
      if (job.status !== "completed") {
        return reply
          .status(400)
          .send({ error: { code: "candidate_not_completed", message: "Candidate not completed" } })
      }
      const output = (job.output_data ?? {}) as Record<string, unknown>
      const imageUrl = typeof output.imageUrl === "string" ? output.imageUrl : null
      if (!imageUrl) {
        return reply
          .status(400)
          .send({ error: { code: "candidate_no_image", message: "Candidate has no imageUrl" } })
      }

      const { data: locationRow, error: locationErr } = locationResult
      if (locationErr || !locationRow) {
        return reply
          .status(404)
          .send({ error: { code: "location_not_found", message: "Location not found" } })
      }

      // ----- LLM caption (non-fatal — null is OK) -----
      // captionLocation() swallows internally and returns null on any
      // failure, including >4000-char truncation. The frontend retries
      // via /llm-caption.
      // TODO Phase 2: deduct 1 CR per LLM call.
      const caption = await captionLocation(imageUrl)

      // ----- Persist -----
      // Update both `source_image_url` (always set on approval) and
      // `canonical_description` (null on LLM failure — frontend coerces).
      // We deliberately bump `updated_at` so the Studio's optimistic-
      // concurrency token stays in lockstep with the row.
      const { data: updated, error: updateErr } = await supabase
        .from("locations")
        .update({
          source_image_url: imageUrl,
          canonical_description: caption,
          updated_at: new Date().toISOString(),
        })
        .eq("id", locationId)
        .eq("user_id", req.userId)
        .select("source_image_url, canonical_description")
        .single()

      if (updateErr || !updated) {
        return reply
          .status(500)
          .send({ error: { code: "update_failed", message: updateErr?.message ?? "Update failed" } })
      }

      // Coerce DB null → "" in the response so the frontend's non-nullable
      // LocationNodeData.canonicalDescription type stays consistent.
      return reply.send({
        sourceImageUrl: updated.source_image_url,
        canonicalDescription: updated.canonical_description ?? "",
      })
    },
  )
}
