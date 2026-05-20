import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractProvider } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import {
  OBJECT_MOTION_PROVIDERS,
  buildObjectMotionPrompt,
  resolveObjectAspectRatio,
  CHARACTER_STYLES,
  OBJECT_ASPECT_OPTIONS,
} from "@nodaro/shared"

/**
 * Body schema for `POST /v1/generate-object-motion`.
 *
 * Mirrors `generate-location-motion.ts` with location → object substitution.
 * Objects share the i2v + auto-attach pattern but use the `motion_clips`
 * JSONB column (single attach column, set route-side so callers don't
 * supply it) and default to 1:1 framing (product-showcase) rather than
 * the location precedent's 16:9 (cinematic establishing shot).
 *
 * `sourceImageUrl` is REQUIRED — image-to-video needs a source frame and
 * there is no studio fallback for objects (no `source_image_url` column to
 * pull from on the objects row at this point in the flow; the studio path
 * supplies the canonical product-shot URL explicitly).
 */
export const generateObjectMotionBody = z.object({
  motionPrompt: z.string().min(1).max(2000),
  sourceImageUrl: safeUrlSchema,
  provider: z.enum(OBJECT_MOTION_PROVIDERS).optional().default("kling-turbo"),
  name: z.string().min(1).max(200),
  // When set, worker routes to video-to-video using this clip as the
  // source instead of running image-to-video from sourceImageUrl.
  refineFromVideoUrl: safeUrlSchema.optional(),
  // Optional descriptive context for `buildObjectMotionPrompt`. The
  // canonical description is preferred when present; the helper falls back
  // to `category` + `name` otherwise.
  category: z.string().max(100).optional(),
  style: z.enum(CHARACTER_STYLES).optional(),
  canonicalDescription: z.string().max(4000).optional(),
  seedPromptHint: z.string().max(2000).optional(),
  userId: z.string().uuid().optional(),
  // Studio auto-attach. When set the worker appends `{name, url}` to the
  // object row's `motion_clips` JSONB column via append_object_asset RPC.
  attachToObjectId: z.string().uuid().optional(),
  attachName: z.string().min(1).max(200).optional(),
  // Optional aspect-ratio override. Defaults to 1:1 via
  // `resolveObjectAspectRatio({ assetType: "motion" })` — objects are
  // product-showcase framing. Uses the canonical OBJECT_ASPECT_OPTIONS.
  aspectRatio: z.enum(OBJECT_ASPECT_OPTIONS).optional(),
})

export async function generateObjectMotionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-object-motion",
    { preHandler: creditGuard((req) => extractProvider(req.body, "kling-turbo")) },
    async (req, reply) => {
      // ───────────────────────────────────────────────────────────────────
      // 1. Authentication
      // ───────────────────────────────────────────────────────────────────
      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "userId is required" },
        })
      }

      // ───────────────────────────────────────────────────────────────────
      // 2. Zod validation
      // ───────────────────────────────────────────────────────────────────
      const parsed = generateObjectMotionBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      // ───────────────────────────────────────────────────────────────────
      // 3. Belt-and-braces ownership re-verification on the attach target
      //    (spec Pass 3 F-30: MUST happen BEFORE reserveCreditsForJob so a
      //    forged `attachToObjectId` can't burn credits before the check).
      //    Service-role bypasses RLS, so without this re-check a forged
      //    `attachToObjectId` would let the worker write to another user's
      //    row. Also rejects soft-deleted rows so motions can't be attached
      //    to a deleted object.
      //
      //    Per spec Pass 10 F-90b: object uses a uniform `"not_found"`
      //    error code for missing/cross-user/soft-deleted rows — object is
      //    DELIBERATELY stricter than location's per-path codes to prevent
      //    callees from enumerating object IDs by error-code differences.
      // ───────────────────────────────────────────────────────────────────
      if (parsed.data.attachToObjectId) {
        const { data: row } = await supabase
          .from("objects")
          .select("id")
          .eq("id", parsed.data.attachToObjectId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .single()
        if (!row) {
          return reply.status(404).send({
            error: { code: "not_found", message: "Object not found" },
          })
        }
      }

      const modelIdentifier = parsed.data.provider

      const prompt = buildObjectMotionPrompt({
        name: parsed.data.name,
        category: parsed.data.category,
        style: parsed.data.style,
        motionPrompt: parsed.data.motionPrompt,
        canonicalDescription: parsed.data.canonicalDescription,
        seedPromptHint: parsed.data.seedPromptHint,
      })

      // Objects default to 1:1 (product-showcase framing). Explicit override
      // wins via `resolveObjectAspectRatio`'s precedence (explicit > node >
      // per-asset-type default). Mirrors location's call-site shape.
      const aspectRatio = resolveObjectAspectRatio({
        explicit: parsed.data.aspectRatio,
        assetType: "motion",
      })

      // ───────────────────────────────────────────────────────────────────
      // 4. DB insert. `force_private: true` is unconditional — generated
      //    object motions must never leak to the public gallery,
      //    regardless of what the caller sends in `forcePrivate`.
      // ───────────────────────────────────────────────────────────────────
      const mcpClient = extractMcpClient(req.body)
      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          force_private: true,
          user_id: userId,
          status: "pending",
          input_data: {
            ...buildJobInputData(parsed.data, "generate-object-motion"),
            prompt,
            aspectRatio,
          },
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })
        .select("id")
        .single()

      if (error || !job) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error?.message ?? "Failed to create job" },
        })
      }

      // ───────────────────────────────────────────────────────────────────
      // 5. Reserve credits
      // ───────────────────────────────────────────────────────────────────
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      // ───────────────────────────────────────────────────────────────────
      // 6. Enqueue worker job. `attachToColumn` is route-side — objects
      //    have a single motion column (`motion_clips`) so unlike the
      //    asset route, callers don't supply it.
      // ───────────────────────────────────────────────────────────────────
      await videoQueue.add("generate-object-motion", {
        jobId: job.id,
        prompt,
        sourceImageUrl: parsed.data.sourceImageUrl,
        refineFromVideoUrl: parsed.data.refineFromVideoUrl,
        provider: modelIdentifier,
        aspectRatio,
        usageLogId,
        attachToObjectId: parsed.data.attachToObjectId,
        attachToColumn: "motion_clips" as const,
        attachName: parsed.data.attachName,
      })

      return { jobId: job.id }
    },
  )
}
