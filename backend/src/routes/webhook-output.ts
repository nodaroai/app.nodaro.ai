import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"

const sendSchema = z.object({
  url: z.string().url(),
  payload: z.record(z.unknown()),
  workflowId: z.string().uuid().optional(),
  forcePrivate: z.boolean().optional(),
})

export async function webhookOutputRoutes(app: FastifyInstance) {
  app.post("/v1/webhook-output/send", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = sendSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten().fieldErrors })
    }

    const { url, payload } = parsed.data
    const userId = req.userId

    // Create job record
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        provider: "webhook-output",
        input_data: { url, payload, type: "webhook-output" },
      })
      .select("id")
      .single()

    if (jobError || !job) {
      return reply.status(500).send({ error: "Failed to create job record" })
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      })

      const rawBody = await response.text().catch(() => "")
      const statusCode = response.status
      const responseBody = rawBody.slice(0, 2000)

      if (!response.ok) {
        await supabase
          .from("jobs")
          .update({
            status: "failed",
            error_message: `Webhook POST failed (${statusCode})`,
            output_data: { success: false, statusCode, responseBody },
          })
          .eq("id", job.id)

        return reply.status(502).send({
          jobId: job.id,
          success: false,
          statusCode,
          responseBody,
          error: `Webhook POST failed (${statusCode})`,
        })
      }

      await supabase
        .from("jobs")
        .update({
          status: "completed",
          output_data: { success: true, statusCode, responseBody },
        })
        .eq("id", job.id)

      return reply.send({ jobId: job.id, success: true, statusCode, responseBody })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error"
      await supabase
        .from("jobs")
        .update({
          status: "failed",
          error_message: `Webhook POST failed: ${message}`,
          output_data: { success: false, statusCode: 0, responseBody: "" },
        })
        .eq("id", job.id)

      return reply.status(502).send({
        jobId: job.id,
        success: false,
        statusCode: 0,
        responseBody: "",
        error: `Webhook POST failed: ${message}`,
      })
    }
  })
}
