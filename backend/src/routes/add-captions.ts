import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { ALL_CAPTION_STYLES, isKineticCaptionStyle } from "@nodaro/shared"

const captionInputSchema = z.object({
  text: z.string(),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
  timestampMs: z.number().min(0).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
})

function buildAddCaptionsCreditId(body: unknown): string {
  if (!body || typeof body !== "object") return "add-captions"
  const style = (body as Record<string, unknown>).style
  if (typeof style === "string" && isKineticCaptionStyle(style)) return "add-captions:kinetic"
  return "add-captions"
}

const addCaptionsBody = z.object({
  videoUrl: safeUrlSchema,
  text: z.string().min(1).optional(),
  captions: z.array(captionInputSchema).optional(),
  auto_transcribe: z.boolean().optional(),
  transcribe_provider: z.enum(["whisper", "incredibly-fast-whisper", "elevenlabs-stt"]).optional(),
  style: z.enum(ALL_CAPTION_STYLES).optional().default("subtitle"),
  position: z.enum(["bottom", "top", "center"]).optional().default("bottom"),
  fontSize: z.number().min(12).max(200).optional().default(32),
  color: z.string().optional().default("white"),
  backgroundColor: z.string().optional(),
  userId: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  // Need at least one caption source. auto_transcribe defaults to undefined,
  // which the worker treats as true — so absent flag = transcribe attempted.
  const hasSource = v.text || (v.captions && v.captions.length > 0) || v.auto_transcribe !== false
  if (!hasSource) {
    ctx.addIssue({
      code: "custom",
      message: "Provide text, captions, or set auto_transcribe (default true for kinetic styles)",
    })
  }
})

export async function addCaptionsRoutes(app: FastifyInstance) {
  app.post("/v1/add-captions", { preHandler: creditGuard((req) => buildAddCaptionsCreditId(req.body)) }, async (req, reply) => {
    const parsed = addCaptionsBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid request" },
      })
    }

    const { userId: _bodyUserId, ...restData } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const modelIdentifier = buildAddCaptionsCreditId(parsed.data)

    const mcpClient = extractMcpClient(req.body)
    const { data: job, error } = await supabase
      .from("jobs")
      .insert({
        workflow_id: extractWorkflowId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "add-captions"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })
      .select("id")
      .single()

    if (error) {
      return reply.status(500).send({ error: { code: "internal_error", message: error.message } })
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("add-captions", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}
