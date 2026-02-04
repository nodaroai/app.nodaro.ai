import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"

const generateScriptBody = z.object({
  prompt: z.string().min(1).max(10000),
  sceneCount: z.number().int().min(1).max(20).optional(),
  tone: z.string().max(200).optional(),
  targetDuration: z.number().int().min(5).max(600).optional(),
  provider: z.enum(["gemini", "claude", "gpt"]).optional(),
  userId: z.string().uuid().optional(),
})

export async function generateScriptRoutes(app: FastifyInstance) {
  app.post("/v1/generate-script", async (req, reply) => {
    const parsed = generateScriptBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { prompt, sceneCount, tone, targetDuration, provider, userId } = parsed.data

    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: null,
        user_id: userId ?? null,
        status: "pending",
        input_data: { prompt, sceneCount, tone, targetDuration, provider, type: "generate-script" },
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({
        error: { code: "internal_error", message: error.message },
      })
    }

    await videoQueue.add("generate-script", {
      jobId: job.id,
      prompt,
      sceneCount,
      tone,
      targetDuration,
      provider,
    })

    return { jobId: job.id }
  })
}
