import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { TransitionTypeSchema } from "@nodaro/shared"
import { supabase } from "../../lib/supabase.js"
import { reduceTimeline, persistExportAsset } from "../pipelines/_freecut-timeline.js"
import { serializeFreecut } from "../pipelines/freecut-serialize.js"

// `transition_to_next` mirrors TimelineShotInput.cut_decision — the enum is the
// single source of truth `TransitionTypeSchema` from @nodaro/shared, whose
// members are: hard_cut, dissolve, match_cut, overlap. Referencing the shared
// schema (rather than re-declaring the array) keeps this route correct if a new
// transition is ever added upstream.
const timelineSchema = z.object({
  scenes: z
    .array(
      z.object({
        sceneEntityId: z.string().min(1),
        compositeUrl: z.string().url(),
        shots: z
          .array(
            z.object({
              shot_id: z.string().min(1),
              duration_seconds: z.number().nonnegative(),
              cut_decision: z
                .object({
                  in_offset_sec: z.number(),
                  out_offset_sec: z.number(),
                  transition_to_next: TransitionTypeSchema,
                  transition_duration_sec: z.number().optional(),
                })
                .optional(),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  musicAssetUrl: z.string().default(""),
  narrationAssetUrl: z.string().optional(),
  fadeOutDurationSec: z.number().optional(),
})

const bodySchema = z.object({
  format: z.enum(["json", "fcpxml"]),
  timeline: timelineSchema,
  name: z.string().max(200).optional(),
})

/**
 * POST /v1/freecut-export — Studio timeline export.
 *
 * 0-credit (no creditGuard). Auth via the global registerAuthHook (sets
 * req.userId); the handler 401s if it's absent. Rate-limited 10/min.
 *
 * Flow: reduceTimeline(scenes) → serializeFreecut(reduced, format, opts) →
 * persistExportAsset (no pipelineId → user-scoped R2 key) → { url, format, assetId }.
 */
export async function freecutExportRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/freecut-export",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const userId = req.userId
      if (!userId) return reply.status(401).send({ error: { code: "unauthorized" } })

      const parsed = bodySchema.safeParse(req.body)
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { code: "validation_error", issues: parsed.error.issues } })
      }

      const { format, timeline } = parsed.data
      const reduced = reduceTimeline(timeline.scenes)
      const { content, mimeType, fileExtension, formatTag } = serializeFreecut(reduced, format, {
        musicAssetUrl: timeline.musicAssetUrl,
        narrationAssetUrl: timeline.narrationAssetUrl,
        fadeOutDurationSec: timeline.fadeOutDurationSec,
        generatedAt: new Date().toISOString(),
        source: "studio-freecut-export",
      })

      const { assetUrl, assetId } = await persistExportAsset({
        supabase,
        userId,
        filenameStem: "freecut",
        fileExtension,
        mimeType,
        formatTag,
        content,
        logTag: "studio-freecut-export",
        source: "studio-freecut-export",
      })

      return reply.send({ url: assetUrl, format, assetId })
    },
  )
}
