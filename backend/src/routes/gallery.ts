import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { isPromptBlocked } from "../config/content-filter.js"
import { checkIsAdmin } from "../lib/admin-check.js"

const IMAGE_JOBS = new Set([
  "generate-image", "edit-image", "image-to-image",
  "generate-character", "generate-character-asset",
  "generate-object", "generate-object-asset",
  "generate-location", "generate-location-asset",
])

const VIDEO_JOBS = new Set([
  "image-to-video", "text-to-video", "video-to-video",
  "lip-sync", "motion-transfer", "video-upscale",
  "combine-videos", "suno-music-video",
  "merge-video-audio", "resize-video", "trim-video", "add-captions",
])

const AUDIO_JOBS = new Set([
  "text-to-speech", "generate-music", "text-to-audio",
  "suno-generate", "suno-cover", "suno-extend", "suno-separate",
  "extract-audio", "mix-audio", "adjust-volume", "extract-youtube-audio",
])

function getOutputType(jobName: string): "image" | "video" | "audio" | null {
  if (IMAGE_JOBS.has(jobName)) return "image"
  if (VIDEO_JOBS.has(jobName)) return "video"
  if (AUDIO_JOBS.has(jobName)) return "audio"
  return null
}

function getOutputUrl(
  jobName: string,
  outputData: Record<string, unknown>,
): string | null {
  const type = getOutputType(jobName)
  if (type === "image") return (outputData?.imageUrl as string) ?? null
  if (type === "video") return (outputData?.videoUrl as string) ?? null
  if (type === "audio") return (outputData?.audioUrl as string) ?? null
  return null
}

/** Map job names to the set that should be queryable by type filter */
function jobNamesForType(type: string): string[] {
  if (type === "image") return [...IMAGE_JOBS]
  if (type === "video") return [...VIDEO_JOBS]
  if (type === "audio") return [...AUDIO_JOBS]
  return []
}

// ---- Zod Schemas ----

const reportBody = z.object({
  jobId: z.string().uuid(),
  reason: z.enum(["inappropriate", "copyright", "spam", "other"]),
  details: z.string().max(1000).optional(),
})

const adminDeleteParams = z.object({
  jobId: z.string().uuid(),
})

export async function galleryRoutes(app: FastifyInstance) {
  /**
   * GET /v1/gallery - Public gallery of completed outputs
   *
   * Query params:
   *   cursor - ISO timestamp cursor for pagination (completed_at of last item)
   *   limit  - items per page (default 20, max 50)
   *   type   - optional filter: "image" | "video" | "audio"
   */
  app.get("/v1/gallery", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? "20", 10) || 20))
    const typeFilter = query.type as string | undefined
    const cursor = query.cursor as string | undefined

    // Build query — fetch limit + 1 to detect if there are more items
    let dbQuery = supabase
      .from("jobs")
      .select("id, job_type, input_data, output_data, completed_at, user_id, provider")
      .eq("is_public", true)
      .eq("status", "completed")
      .not("output_data", "is", null)
      .order("completed_at", { ascending: false })
      .limit(limit + 1)

    // Cursor-based pagination: fetch items older than cursor
    if (cursor) {
      dbQuery = dbQuery.lt("completed_at", cursor)
    }

    // Filter by type (restricts to specific job names)
    if (typeFilter && ["image", "video", "audio"].includes(typeFilter)) {
      const jobNames = jobNamesForType(typeFilter)
      dbQuery = dbQuery.in("job_type", jobNames)
    } else {
      // Exclude text-only jobs (scripts, transcriptions) from gallery
      const allMediaNames = [...IMAGE_JOBS, ...VIDEO_JOBS, ...AUDIO_JOBS]
      dbQuery = dbQuery.in("job_type", allMediaNames)
    }

    const { data: jobs, error } = await dbQuery

    if (error) {
      console.error("[gallery] Query failed:", error)
      return reply.status(500).send({ error: "Failed to fetch gallery" })
    }

    if (!jobs || jobs.length === 0) {
      return reply.send({ data: [], nextCursor: null })
    }

    // Determine if there are more items
    const hasMore = jobs.length > limit
    const pageJobs = hasMore ? jobs.slice(0, limit) : jobs

    // Build response items — filter out blocked prompts
    const items = pageJobs
      .map((job) => {
        const outputData = (job.output_data ?? {}) as Record<string, unknown>
        const inputData = (job.input_data ?? {}) as Record<string, unknown>
        const type = getOutputType(job.job_type)
        const outputUrl = getOutputUrl(job.job_type, outputData)

        if (!type || !outputUrl) return null

        // Extract prompt from input_data (different field names per job type)
        const prompt = (inputData.prompt as string)
          ?? (inputData.text as string)
          ?? null

        // Filter out items with blocked words in prompt
        if (isPromptBlocked(prompt)) return null

        // Extract model name from input_data.provider (stores model identifier like "nano-banana")
        // Falls back to jobs.provider column (which stores provider name like "kie")
        const model = (inputData.provider as string)
          ?? (job.provider as string)
          ?? null

        return {
          id: job.id,
          type,
          jobName: job.job_type,
          outputUrl,
          thumbnailUrl: (outputData.thumbnailUrl as string) ?? null,
          createdAt: job.completed_at,
          prompt,
          model,
        }
      })
      .filter(Boolean)

    // Set nextCursor to the completed_at of the last item in the page
    const lastItem = pageJobs[pageJobs.length - 1]
    const nextCursor = hasMore && lastItem?.completed_at ? lastItem.completed_at : null

    reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=60")
    return reply.send({
      data: items,
      nextCursor,
    })
  })

  /**
   * POST /v1/gallery/report - Report a gallery item
   *
   * Body: { jobId, reason, details? }
   * No auth required — uses IP for rate limiting / dedup.
   */
  app.post("/v1/gallery/report", async (req, reply) => {
    const parsed = reportBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { jobId, reason, details } = parsed.data
    const reporterIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      ?? req.ip
      ?? null

    // Check job exists and is public
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("id")
      .eq("id", jobId)
      .eq("is_public", true)
      .eq("status", "completed")
      .single()

    if (jobError || !job) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Gallery item not found" },
      })
    }

    // Prevent duplicate reports from same IP within 1 hour
    if (reporterIp) {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { data: existing } = await supabase
        .from("gallery_reports")
        .select("id")
        .eq("job_id", jobId)
        .eq("reporter_ip", reporterIp)
        .gte("created_at", oneHourAgo)
        .limit(1)

      if (existing && existing.length > 0) {
        return reply.status(429).send({
          error: { code: "rate_limited", message: "You already reported this item recently" },
        })
      }
    }

    const { error: insertError } = await supabase
      .from("gallery_reports")
      .insert({
        job_id: jobId,
        reason,
        details: details ?? null,
        reporter_ip: reporterIp,
      })

    if (insertError) {
      console.error("[gallery] Report insert failed:", insertError)
      return reply.status(500).send({ error: "Failed to submit report" })
    }

    return reply.send({ success: true, message: "Report submitted" })
  })

  /**
   * DELETE /v1/gallery/:jobId - Admin soft-delete from gallery
   *
   * Sets is_public = false (does not delete the job).
   */
  app.delete<{ Params: { jobId: string } }>("/v1/gallery/:jobId", async (req, reply) => {
    const paramsResult = adminDeleteParams.safeParse(req.params)
    if (!paramsResult.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: paramsResult.error.issues[0]?.message ?? "Invalid job ID",
        },
      })
    }

    const { jobId } = paramsResult.data

    // Use authenticated user's ID from JWT, NOT body-supplied userId
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const isAdmin = await checkIsAdmin(req.userId)
    if (!isAdmin) {
      return reply.status(403).send({
        error: { code: "forbidden", message: "Only admins can remove gallery items" },
      })
    }

    const { error } = await supabase
      .from("jobs")
      .update({ is_public: false })
      .eq("id", jobId)

    if (error) {
      console.error("[gallery] Admin delete failed:", error)
      return reply.status(500).send({ error: "Failed to remove item from gallery" })
    }

    // Auto-review all pending reports for this job
    const { error: reportsError } = await supabase
      .from("gallery_reports")
      .update({ status: "reviewed" })
      .eq("job_id", jobId)
      .eq("status", "pending")

    if (reportsError) {
      console.error("[gallery] Failed to auto-review reports:", reportsError)
    }

    return reply.send({ success: true, message: "Item removed from gallery" })
  })
}
