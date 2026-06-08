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
  // Reuse the entity-agnostic video-motion helpers (the object names are the
  // canonical home for these — they produce a generic "Motion: …,
  // product-showcase quality" string + resolve aspect ratios; nothing in them
  // is object-specific). Creating creature-named clones would be drift, not
  // safety, so per CLAUDE.md (single source of truth) the creature motion
  // route reuses them directly. `materials`→`poses` doesn't apply to motion.
  OBJECT_MOTION_PROVIDERS,
  buildObjectMotionPrompt,
  resolveObjectAspectRatio,
  CHARACTER_STYLES,
  OBJECT_ASPECT_OPTIONS,
} from "@nodaro/shared"

/**
 * Body schema for `POST /v1/generate-creature-motion`.
 *
 * Mirrors `generate-object-motion.ts` with object → creature substitution.
 * Creatures share the i2v + auto-attach pattern but use the `motion_clips`
 * JSONB column (single attach column, set route-side so callers don't supply
 * it) and default to 1:1 framing — same as object's product-showcase default
 * (a creature reference clip is centered framing, not cinematic 16:9).
 *
 * `sourceImageUrl` is REQUIRED — image-to-video needs a source frame and the
 * studio path supplies the canonical creature-shot URL explicitly.
 */
export const generateCreatureMotionBody = z.object({
  motionPrompt: z.string().min(1).max(2000),
  sourceImageUrl: safeUrlSchema,
  provider: z.enum(OBJECT_MOTION_PROVIDERS).optional().default("kling-turbo"),
  name: z.string().min(1).max(200),
  // When set, worker routes to video-to-video using this clip as the source
  // instead of running image-to-video from sourceImageUrl.
  refineFromVideoUrl: safeUrlSchema.optional(),
  // Optional descriptive context for `buildObjectMotionPrompt`. The canonical
  // description is preferred when present; the helper falls back to
  // `category` + `name` otherwise.
  category: z.string().max(100).optional(),
  style: z.enum(CHARACTER_STYLES).optional(),
  canonicalDescription: z.string().max(4000).optional(),
  seedPromptHint: z.string().max(2000).optional(),
  userId: z.string().uuid().optional(),
  // Studio auto-attach. When set the worker appends `{name, url}` to the
  // creature row's `motion_clips` JSONB column via append_creature_asset RPC.
  attachToCreatureId: z.string().uuid().optional(),
  attachName: z.string().min(1).max(200).optional(),
  // Optional aspect-ratio override. Defaults to 1:1 via
  // `resolveObjectAspectRatio({ assetType: "motion" })`. Uses the canonical
  // OBJECT_ASPECT_OPTIONS.
  aspectRatio: z.enum(OBJECT_ASPECT_OPTIONS).optional(),
})

export async function generateCreatureMotionRoutes(app: FastifyInstance) {
  app.post(
    "/v1/generate-creature-motion",
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
      const parsed = generateCreatureMotionBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      // ───────────────────────────────────────────────────────────────────
      // 3. Belt-and-braces ownership re-verification on the attach target
      //    (MUST happen BEFORE reserveCreditsForJob so a forged
      //    `attachToCreatureId` can't burn credits before the check).
      //    Service-role bypasses RLS, so without this re-check a forged
      //    `attachToCreatureId` would let the worker write to another user's
      //    row. Also rejects soft-deleted rows so motions can't be attached
      //    to a deleted creature.
      //
      //    Uniform `"not_found"` error code for missing/cross-user/
      //    soft-deleted rows — mirrors object, DELIBERATELY stricter than
      //    location's per-path codes to prevent callees from enumerating
      //    creature IDs by error-code differences.
      // ───────────────────────────────────────────────────────────────────
      if (parsed.data.attachToCreatureId) {
        const { data: row } = await supabase
          .from("creatures")
          .select("id")
          .eq("id", parsed.data.attachToCreatureId)
          .eq("user_id", userId)
          .is("deleted_at", null)
          .single()
        if (!row) {
          return reply.status(404).send({
            error: { code: "not_found", message: "Creature not found" },
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

      // Creatures default to 1:1 (centered reference framing). Explicit
      // override wins via `resolveObjectAspectRatio`'s precedence (explicit >
      // node > per-asset-type default). Mirrors object's call-site shape.
      const aspectRatio = resolveObjectAspectRatio({
        explicit: parsed.data.aspectRatio,
        assetType: "motion",
      })

      // ───────────────────────────────────────────────────────────────────
      // 4. DB insert. `force_private: true` is unconditional — generated
      //    creature motions must never leak to the public gallery,
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
            ...buildJobInputData(parsed.data, "generate-creature-motion"),
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
      // 6. Enqueue worker job. `attachToColumn` is route-side — creatures
      //    have a single motion column (`motion_clips`) so unlike the asset
      //    route, callers don't supply it. The BullMQ job name
      //    `"generate-creature-motion"` matches the Phase C2 entityHandlers
      //    key the creature worker registered.
      // ───────────────────────────────────────────────────────────────────
      await videoQueue.add("generate-creature-motion", {
        jobId: job.id,
        prompt,
        sourceImageUrl: parsed.data.sourceImageUrl,
        refineFromVideoUrl: parsed.data.refineFromVideoUrl,
        provider: modelIdentifier,
        aspectRatio,
        usageLogId,
        attachToCreatureId: parsed.data.attachToCreatureId,
        attachToColumn: "motion_clips" as const,
        attachName: parsed.data.attachName,
      })

      return { jobId: job.id }
    },
  )
}
