import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { config } from "../lib/config.js"
import { supabase } from "../lib/supabase.js"
import { captionObject } from "../lib/object-caption.js"
import { formatZodError } from "../lib/zod-error.js"

/**
 * Object main-image approval + canonical-description LLM caption.
 *
 * POST /v1/objects/:id/approve-main-image — body { candidateJobId }
 *   Promotes a candidate-generation job's output image to the object's
 *   permanent `source_image_url` AND fires the Claude Sonnet vision caption
 *   inline to populate `canonical_description`.
 *
 * Mirrors `location-main-image-approval.ts` with key security-hardening
 * deltas per the Object Studio spec:
 *   - Both candidate + object are fetched in parallel via Promise.all
 *     (spec Pass 3 F-25) — both must succeed BEFORE the ~5-30s paid LLM
 *     call. Without the object pre-fetch, PostgREST `.update().eq().eq()`
 *     silently succeeds on zero rows and we'd leak LLM output for an
 *     object the caller doesn't own (soft IDOR).
 *   - Both queries are scoped by `req.userId`, so cross-user candidate /
 *     object returns null → 404 (indistinguishable from "doesn't exist").
 *   - Object pre-fetch ALSO filters `deleted_at IS NULL` — archived
 *     objects are 404 (cannot resurrect-by-approve).
 *   - Cross-link IDOR gate (spec Pass 3 F-26): the candidate's
 *     `input_data.attachToObjectId` MUST match the URL `:id`. Mismatch
 *     returns 400 `candidate_object_mismatch` (NOT 404 — the caller is
 *     authenticated and owns both rows, this is a semantic error worth
 *     surfacing distinctly).
 *
 * Per spec Pass 10 F-90/F-90b: uniform `"not_found"` error code for all
 * "not yours / archived / malformed-row" failure paths — object is
 * DELIBERATELY stricter than location's per-path codes. Eval order:
 *   1. candidate not found / cross-user → 404 "not_found"
 *   2. candidate not in completed state → 400 "candidate_not_completed"
 *   3. candidate has no imageUrl → 400 "candidate_no_image"
 *   4. candidate.input_data.attachToObjectId !== :id → 400
 *      "candidate_object_mismatch" (Pass 3 F-26 IDOR gate)
 *   5. object not found / cross-user / archived → 404 "not_found"
 *
 * Object 404 evaluates AFTER the candidate gates so a known-bad candidate
 * id doesn't leak whether the object exists.
 *
 * Caption-failure semantics (matches location):
 *   When the LLM caption sub-fails, the route STILL persists
 *   `source_image_url` and returns HTTP **200** with
 *   `canonicalDescription: ""` (NOT 502, NOT null — frontend type is
 *   non-nullable `string`). The frontend retries via `/llm-caption`.
 *
 * Optimistic concurrency (spec Pass 3 F-27):
 *   When `expectedUpdatedAt` is supplied, the UPDATE is gated on
 *   `.eq("updated_at", expectedUpdatedAt)`. On mismatch (zero rows
 *   updated), returns 409 with `{ code: "concurrent_modification",
 *   updatedAt, message }` so the caller can re-fetch + retry.
 *
 * Rate-limit: 10 req/min/IP via `@fastify/rate-limit` config.
 *
 * TODO Phase 2: deduct 1 CR per LLM call (matches the location precedent's
 * TODO at the same point in the file). Phase 1 ships without it.
 */

const paramsSchema = z.object({ id: z.string().uuid() })
const bodySchema = z.object({
  candidateJobId: z.string().uuid(),
  /**
   * Optimistic-concurrency token. When present, the UPDATE is gated by
   * `.eq("updated_at", expectedUpdatedAt)` so a stale studio snapshot
   * can't clobber a concurrent writer (worker auto-attach, another tab,
   * etc.). On mismatch the route returns 409 `concurrent_modification`
   * with the fresh `updated_at` so the caller can re-fetch + retry.
   * Mirrors the pattern in POST /v1/objects (Phase B).
   */
  expectedUpdatedAt: z.string().datetime().optional(),
})

export async function objectMainImageApprovalRoutes(app: FastifyInstance) {
  app.post(
    "/v1/objects/:id/approve-main-image",
    {
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

      // captionObject() routes through llmComplete with
      // modelId="claude-sonnet-4.6". Without ANTHROPIC_API_KEY (or
      // KIE_API_KEY as fallback) the LLM call would 502 mid-request — gate
      // it here with a clean 503 instead. Mirrors the location precedent.
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

      const { id: objectId } = params.data
      const { candidateJobId, expectedUpdatedAt } = body.data

      // ----- Parallel fetch: candidate job + object pre-fetch (spec Pass 3 F-25) -----
      // Both must succeed before the paid LLM call. Both are scoped by
      // user_id so a cross-user candidate / object returns null (mapped
      // to 404). Object pre-fetch also rejects archived rows.
      //
      // We select `input_data` on the candidate so we can run the
      // cross-link IDOR check before paying for the LLM call.
      const [candidateResult, objectResult] = await Promise.all([
        supabase
          .from("jobs")
          .select("id, status, output_data, input_data")
          .eq("id", candidateJobId)
          .eq("user_id", req.userId)
          .single(),
        supabase
          .from("objects")
          .select("id")
          .eq("id", objectId)
          .eq("user_id", req.userId)
          .is("deleted_at", null)
          .single(),
      ])

      // Error evaluation order (spec Pass 10 F-90):
      //   1. candidate 404 (uniform "not_found" per Pass 10 F-90b)
      //   2. candidate not-completed (400)
      //   3. candidate has no imageUrl (400)
      //   4. candidate.input_data.attachToObjectId !== :id (400, Pass 3 F-26)
      //   5. object 404 (archived or cross-user — uniform "not_found")
      // Object 404 evaluates AFTER candidate gates so a known-bad
      // candidate id doesn't leak whether the object exists.
      const { data: job, error: candidateErr } = candidateResult
      if (candidateErr || !job) {
        return reply
          .status(404)
          .send({ error: { code: "not_found", message: "Not found" } })
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

      // Cross-link IDOR gate (spec Pass 3 F-26): the candidate's stored
      // `attachToObjectId` MUST match the URL `:id`. Without this gate, a
      // user could "approve" candidate-A into object-B even though A was
      // generated against object-A. Both rows are owned by the caller so
      // this is a semantic mismatch (400), not an authz failure (404).
      const candidateInput = (job.input_data ?? {}) as Record<string, unknown>
      const candidateAttachId =
        typeof candidateInput.attachToObjectId === "string" ? candidateInput.attachToObjectId : null
      if (candidateAttachId !== null && candidateAttachId !== objectId) {
        return reply.status(400).send({
          error: {
            code: "candidate_object_mismatch",
            message: "Candidate was generated for a different object",
          },
        })
      }

      const { data: objectRow, error: objectErr } = objectResult
      if (objectErr || !objectRow) {
        return reply
          .status(404)
          .send({ error: { code: "not_found", message: "Not found" } })
      }

      // ----- LLM caption (non-fatal — null is OK) -----
      // captionObject() swallows internally and returns null on any
      // failure, including > 4000-char truncation. The frontend retries
      // via /llm-caption (which IS fatal-on-null → 502).
      // TODO Phase 2: deduct 1 CR per LLM call.
      const caption = await captionObject(imageUrl)

      // ----- Persist -----
      // Update both `source_image_url` (always set on approval) and
      // `canonical_description` (null on LLM failure — frontend coerces).
      // We deliberately bump `updated_at` so the Studio's optimistic-
      // concurrency token stays in lockstep with the row (belt-and-braces
      // alongside the DB trigger).
      //
      // Optimistic-concurrency (spec Pass 3 F-27): when the caller passes
      // `expectedUpdatedAt`, gate the UPDATE on the row's current
      // `updated_at`. A mismatch zero-rows the UPDATE, which we surface
      // as 409 `concurrent_modification` with the fresh token. Without
      // this gate, a stale studio could approve a candidate over a
      // concurrent writer's work (worker auto-attach, another tab).
      let updateQuery = supabase
        .from("objects")
        .update({
          source_image_url: imageUrl,
          canonical_description: caption,
          updated_at: new Date().toISOString(),
        })
        .eq("id", objectId)
        .eq("user_id", req.userId)
      if (expectedUpdatedAt) {
        updateQuery = updateQuery.eq("updated_at", expectedUpdatedAt)
      }
      const { data: updated, error: updateErr } = await updateQuery
        .select("source_image_url, canonical_description")
        .single()

      if (updateErr || !updated) {
        // Distinguish "row was modified concurrently" (409 — caller passed
        // a stale token) from "real update failure" (500). Only do the
        // follow-up SELECT when the caller actually sent
        // `expectedUpdatedAt` — otherwise this is a plain UPDATE failure
        // path. Mirrors the pattern in `routes/objects.ts` (Phase B).
        if (expectedUpdatedAt) {
          const { data: current } = await supabase
            .from("objects")
            .select("updated_at")
            .eq("id", objectId)
            .eq("user_id", req.userId)
            .single()
          if (current) {
            return reply.status(409).send({
              error: {
                code: "concurrent_modification",
                updatedAt: (current as { updated_at: string }).updated_at,
                message: "Object was modified concurrently",
              },
            })
          }
        }
        return reply
          .status(500)
          .send({ error: { code: "update_failed", message: updateErr?.message ?? "Update failed" } })
      }

      // Coerce DB null → "" in the response so the frontend's non-nullable
      // ObjectNodeData.canonicalDescription type stays consistent.
      return reply.send({
        sourceImageUrl: updated.source_image_url,
        canonicalDescription: updated.canonical_description ?? "",
      })
    },
  )
}
