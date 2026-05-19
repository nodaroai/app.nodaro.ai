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
import { resolveLocationAspectRatio } from "../lib/aspect-ratio.js"
import {
  LOCATION_ATMOSPHERE_PROVIDERS,
  buildLocationMotionPrompt,
  CHARACTER_STYLES,
  CHARACTER_ASPECT_OPTIONS,
} from "@nodaro/shared"

/**
 * Body schema for `POST /v1/generate-location-motion`.
 *
 * Mirrors `generate-character-motion.ts` minus character-specific fields
 * (gender / baseOutfit / realLifeRefs / attachToCharacterId / body-angle
 * routing). Locations have a single attach column (`atmosphere_motions`) so
 * the column literal is set route-side, not supplied by the caller.
 *
 * `sourceImageUrl` is REQUIRED — image-to-video needs a source frame and there
 * is no studio fallback for locations (no `source_image_url` column to pull
 * from on the locations row; the studio path supplies the canonical
 * establishing-shot URL explicitly).
 */
export const generateLocationMotionBody = z.object({
  motionPrompt: z.string().min(1).max(2000),
  sourceImageUrl: safeUrlSchema,
  provider: z.enum(LOCATION_ATMOSPHERE_PROVIDERS).optional().default("kling"),
  name: z.string().min(1).max(200),
  // When set, worker routes to video-to-video using this clip as the
  // source instead of running image-to-video from sourceImageUrl.
  refineFromVideoUrl: safeUrlSchema.optional(),
  // Optional descriptive context for `buildLocationMotionPrompt`. The
  // canonical description is preferred when present; the helper falls back to
  // `category` + `name` otherwise.
  category: z.string().max(100).optional(),
  style: z.enum(CHARACTER_STYLES).optional(),
  canonicalDescription: z.string().max(4000).optional(),
  userId: z.string().uuid().optional(),
  // Studio auto-attach. When set the worker appends `{name, url}` to the
  // location row's `atmosphere_motions` JSONB column.
  attachToLocationId: z.string().uuid().optional(),
  attachName: z.string().min(1).max(200).optional(),
  // Optional aspect-ratio override. Defaults to 16:9 via
  // `resolveLocationAspectRatio` (locations are cinematic establishing shots).
  // Reuses CHARACTER_ASPECT_OPTIONS — the 4 supported ratios are identical.
  aspectRatio: z.enum(CHARACTER_ASPECT_OPTIONS).optional(),
})

export async function generateLocationMotionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-location-motion",
    { preHandler: creditGuard((req) => extractProvider(req.body, "kling")) },
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
      const parsed = generateLocationMotionBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      // ───────────────────────────────────────────────────────────────────
      // 3. Belt-and-braces ownership re-verification on the attach target.
      //    Service-role bypasses RLS so without this check a forged
      //    `attachToLocationId` would let the worker write to another user's
      //    row. Also rejects soft-deleted rows so motions can't be attached
      //    to a deleted location.
      // ───────────────────────────────────────────────────────────────────
      if (parsed.data.attachToLocationId) {
        const { data: row } = await supabase
          .from("locations")
          .select("id")
          .eq("id", parsed.data.attachToLocationId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .single()
        if (!row) {
          return reply.status(404).send({
            error: { code: "location_not_found", message: "Location not found" },
          })
        }
      }

      const modelIdentifier = parsed.data.provider

      const prompt = buildLocationMotionPrompt({
        name: parsed.data.name,
        category: parsed.data.category,
        style: parsed.data.style,
        motionPrompt: parsed.data.motionPrompt,
        canonicalDescription: parsed.data.canonicalDescription,
      })

      // Locations default to 16:9 (cinematic establishing shots). Explicit
      // override wins. Mirrors the character motion route's call site shape
      // for consistency, even though location only has one asset type today.
      const aspectRatio = resolveLocationAspectRatio({
        explicit: parsed.data.aspectRatio,
        assetType: "motions",
      })

      // ───────────────────────────────────────────────────────────────────
      // 4. DB insert. `force_private: true` is unconditional — generated
      //    location motions must never leak to the public gallery,
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
            ...buildJobInputData(parsed.data, "generate-location-motion"),
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
      // 6. Enqueue worker job. `attachToColumn` is route-side — locations
      //    have a single motion column (`atmosphere_motions`) so unlike the
      //    asset route, callers don't supply it.
      // ───────────────────────────────────────────────────────────────────
      await videoQueue.add("generate-location-motion", {
        jobId: job.id,
        prompt,
        sourceImageUrl: parsed.data.sourceImageUrl,
        refineFromVideoUrl: parsed.data.refineFromVideoUrl,
        provider: modelIdentifier,
        aspectRatio,
        usageLogId,
        attachToLocationId: parsed.data.attachToLocationId,
        attachToColumn: "atmosphere_motions" as const,
        attachName: parsed.data.attachName,
      })

      return { jobId: job.id }
    },
  )
}
