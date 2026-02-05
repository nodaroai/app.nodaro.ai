import type { FastifyInstance } from "fastify"
import { supabase } from "../lib/supabase.js"

// Job types that count as image generation
const IMAGE_TYPES = [
  "generate-image",
  "edit-image",
  "image-to-image",
  "generate-character",
  "generate-character-asset",
  "generate-object",
  "generate-object-asset",
  "generate-location",
  "generate-location-asset",
]

// Job types that count as video generation
const VIDEO_TYPES = [
  "image-to-video",
  "text-to-video",
  "video-to-video",
  "combine-videos",
  "motion-transfer",
  "video-upscale",
]

interface StatsResponse {
  totalExecutions: number
  successful: number
  failed: number
  failureRate: number
  avgImageTime: number | null
  avgVideoTime: number | null
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { scope?: string; userId?: string } }>("/v1/stats", async (req, reply) => {
    const { scope = "user", userId } = req.query

    // Debug logging
    console.log("[stats] Request received:", { scope, userId, rawQuery: req.query })

    try {
      // Build the base query
      let query = supabase
        .from("jobs")
        .select("id, status, input_data, started_at, completed_at")

      // Filtering logic:
      // - scope="user": ALWAYS filter by userId (required for personal stats)
      // - scope="platform": no filter (shows all jobs, admin-only feature)
      let filterApplied = false
      if (scope === "platform") {
        // No filter - show all jobs (TODO: add admin check)
        console.log("[stats] Platform scope - no user filter applied")
      } else {
        // Default to "user" scope - always filter by userId
        if (!userId) {
          // No userId provided for user scope - return empty stats
          console.log("[stats] User scope but no userId - returning empty stats")
          return {
            data: {
              totalExecutions: 0,
              successful: 0,
              failed: 0,
              failureRate: 0,
              avgImageTime: null,
              avgVideoTime: null,
            },
          }
        }
        console.log("[stats] User scope - filtering by user_id:", userId)
        query = query.eq("user_id", userId)
        filterApplied = true
      }

      const { data: jobs, error } = await query

      if (error) {
        console.error("[stats] Supabase query error:", error)
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      const allJobs = jobs ?? []
      console.log("[stats] Query returned", allJobs.length, "jobs (filterApplied:", filterApplied, ")")

      // Calculate stats
      const totalExecutions = allJobs.length
      const successful = allJobs.filter((j) => j.status === "completed").length
      const failed = allJobs.filter((j) => j.status === "failed").length
      const failureRate = totalExecutions > 0 ? Math.round((failed / totalExecutions) * 1000) / 10 : 0

      // Calculate average durations for image and video jobs
      const imageJobs = allJobs.filter((j) => {
        const type = (j.input_data as { type?: string })?.type
        return IMAGE_TYPES.includes(type ?? "")
      })

      const videoJobs = allJobs.filter((j) => {
        const type = (j.input_data as { type?: string })?.type
        return VIDEO_TYPES.includes(type ?? "")
      })

      // Calculate average time for completed image jobs
      const completedImageJobs = imageJobs.filter(
        (j) => j.status === "completed" && j.started_at && j.completed_at
      )
      let avgImageTime: number | null = null
      if (completedImageJobs.length > 0) {
        const totalImageTime = completedImageJobs.reduce((sum, j) => {
          const start = new Date(j.started_at!).getTime()
          const end = new Date(j.completed_at!).getTime()
          return sum + (end - start) / 1000
        }, 0)
        avgImageTime = Math.round((totalImageTime / completedImageJobs.length) * 10) / 10
      }

      // Calculate average time for completed video jobs
      const completedVideoJobs = videoJobs.filter(
        (j) => j.status === "completed" && j.started_at && j.completed_at
      )
      let avgVideoTime: number | null = null
      if (completedVideoJobs.length > 0) {
        const totalVideoTime = completedVideoJobs.reduce((sum, j) => {
          const start = new Date(j.started_at!).getTime()
          const end = new Date(j.completed_at!).getTime()
          return sum + (end - start) / 1000
        }, 0)
        avgVideoTime = Math.round((totalVideoTime / completedVideoJobs.length) * 10) / 10
      }

      const stats: StatsResponse = {
        totalExecutions,
        successful,
        failed,
        failureRate,
        avgImageTime,
        avgVideoTime,
      }

      return { data: stats }
    } catch (err) {
      console.error("[stats] Error fetching stats:", err)
      return reply.status(500).send({
        error: { code: "internal_error", message: "Failed to fetch stats" },
      })
    }
  })
}
