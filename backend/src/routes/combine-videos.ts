import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const combineVideosBody = z.object({
  videoUrls: z.array(z.string().url()).min(2, "At least 2 video URLs required"),
  transition: z.enum(["cut", "fade", "dissolve"]).optional().default("cut"),
  transitionDuration: z.number().min(0).max(5).optional().default(0.5),
})

export async function combineVideosRoutes(app: FastifyInstance) {
  app.post("/v1/combine-videos", async (req, reply) => {
    const parsed = combineVideosBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { videoUrls, transition, transitionDuration } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: "fb48d4d5-cd33-4599-816a-3262e4908522", // TODO: get from auth
        status: "pending",
        input_data: { videoUrls, transition, transitionDuration, type: "combine-videos" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("combine-videos", {
      jobId: job.id,
      videoUrls,
      transition,
      transitionDuration,
    })

    return { jobId: job.id }
  })
}
