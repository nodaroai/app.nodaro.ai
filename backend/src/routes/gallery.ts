import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

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

export async function galleryRoutes(app: FastifyInstance) {
  /**
   * GET /v1/gallery - Public gallery of completed outputs
   *
   * Query params:
   *   page  - page number (default 1)
   *   limit - items per page (default 20, max 50)
   *   type  - optional filter: "image" | "video" | "audio"
   */
  app.get("/v1/gallery", async (req, reply) => {
    const query = req.query as Record<string, string | undefined>
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1)
    const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? "20", 10) || 20))
    const typeFilter = query.type as string | undefined
    const offset = (page - 1) * limit

    // Build query
    let dbQuery = supabase
      .from("jobs")
      .select("id, job_type, input_data, output_data, completed_at, user_id, provider", { count: "exact" })
      .eq("is_public", true)
      .eq("status", "completed")
      .not("output_data", "is", null)
      .order("completed_at", { ascending: false })
      .range(offset, offset + limit - 1)

    // Filter by type (restricts to specific job names)
    if (typeFilter && ["image", "video", "audio"].includes(typeFilter)) {
      const jobNames = jobNamesForType(typeFilter)
      dbQuery = dbQuery.in("job_type", jobNames)
    } else {
      // Exclude text-only jobs (scripts, transcriptions) from gallery
      const allMediaNames = [...IMAGE_JOBS, ...VIDEO_JOBS, ...AUDIO_JOBS]
      dbQuery = dbQuery.in("job_type", allMediaNames)
    }

    const { data: jobs, count, error } = await dbQuery

    if (error) {
      console.error("[gallery] Query failed:", error)
      return reply.status(500).send({ error: "Failed to fetch gallery" })
    }

    if (!jobs || jobs.length === 0) {
      return reply.send({ data: [], total: 0, page, limit })
    }

    // Batch-fetch profiles for usernames
    const userIds = [...new Set(jobs.map((j) => j.user_id).filter(Boolean))]
    const { data: profiles } = userIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIds)
      : { data: [] }

    const profileMap = new Map(
      (profiles ?? []).map((p) => [p.id, p]),
    )

    // Build response items
    const items = jobs
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

        // Extract model from provider column or input_data.provider
        const model = (job.provider as string)
          ?? (inputData.provider as string)
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

    return reply.send({
      data: items,
      total: count ?? 0,
      page,
      limit,
    })
  })
}
