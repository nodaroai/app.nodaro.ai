import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { uploadToR2 } from "../lib/storage.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"

const saveToStorageBody = z.object({
  mediaUrl: safeUrlSchema,
  filename: z.string().optional(),
  mediaType: z.enum(["image", "video", "audio"]).optional(),
})

type MediaType = "image" | "video" | "audio"

const VIDEO_EXTS = [".mp4", ".webm", ".mov", ".avi"]
const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".m4a", ".flac"]

function detectMediaType(url: string): MediaType {
  const lower = url.toLowerCase().split("?")[0] ?? ""
  if (VIDEO_EXTS.some((ext) => lower.endsWith(ext))) return "video"
  if (AUDIO_EXTS.some((ext) => lower.endsWith(ext))) return "audio"
  return "image"
}

export async function saveToStorageRoutes(app: FastifyInstance) {
  // 0 credits — creditGuard still enforces storage quota and daily limits
  app.post("/v1/save-to-storage", {
    preHandler: creditGuard(() => "save-to-storage"),
  }, async (req, reply) => {
    const parsed = saveToStorageBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { mediaUrl, filename } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const detectedType: MediaType = parsed.data.mediaType ?? detectMediaType(mediaUrl)

    // Create a job record
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          type: "save-to-storage",
          mediaUrl,
          filename,
          mediaType: detectedType,
        },
      })
      .select("id")
      .single()

    if (jobError) {
      return reply.status(500).send({
        error: { code: "internal_error", message: jobError.message },
      })
    }

    try {
      const r2Url = await uploadToR2(mediaUrl, job.id, detectedType, userId)

      await supabase
        .from("jobs")
        .update({
          status: "completed",
          output_data: {
            url: r2Url,
            filename: filename ?? null,
            type: detectedType,
          },
        })
        .eq("id", job.id)

      return reply.send({ jobId: job.id, url: r2Url })
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save media to storage"

      await supabase
        .from("jobs") // tenant-scope-ignore: job.id is server-generated in this request
        .update({ status: "failed", output_data: { error: message } })
        .eq("id", job.id)

      return reply.status(502).send({
        error: { code: "storage_error", message },
      })
    }
  })
}
