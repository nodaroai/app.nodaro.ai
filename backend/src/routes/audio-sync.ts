import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { audioSyncCreditId } from "../lib/audio-sync-credit-id.js"
import { AUDIO_SYNC_MAX_SOURCES, AUDIO_SYNC_MIN_SOURCES } from "../providers/audio/audio-sync-budget.js"

// Keyless, ffmpeg + in-process correlation: measures how far apart the clocks
// of 2–6 recordings of one conversation are, against `reference` (default: the
// first source). Each source is an audio OR a video — the worker reads the
// shared 16 kHz audio proxy either way. Result (`output_data.json`):
// `{ version, reference, offsets: [{ sourceId, offsetMs, confidence,
// driftMsPerHour }], notes }`, D19 sign (`referenceMs = sourceMs + offsetMs`).
// Priced per source aligned to the reference: `audio-sync:<n>src`.
const audioSyncBody = z
  .object({
    sources: z
      .array(
        z.object({
          // The caller's own id for this recording — echoed back as the
          // result's `sourceId`. On the canvas it is the upstream NODE id (the
          // EdlSource id an edit plan uses for the same recording).
          id: z.string().min(1).max(200),
          url: safeUrlSchema,
        }),
      )
      .min(AUDIO_SYNC_MIN_SOURCES)
      .max(AUDIO_SYNC_MAX_SOURCES),
    // The source every offset is measured against (its own offset is 0).
    // Default: the first source.
    reference: z.string().min(1).max(200).optional(),
    userId: z.string().uuid().optional(),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>()
    body.sources.forEach((s, i) => {
      if (seen.has(s.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sources", i, "id"],
          message: `source id "${s.id}" appears more than once — every source needs its own id`,
        })
      }
      seen.add(s.id)
    })
    if (body.reference !== undefined && !seen.has(body.reference)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reference"],
        message: `reference "${body.reference}" is not one of the sources' ids`,
      })
    }
  })

export async function audioSyncRoutes(app: FastifyInstance) {
  app.post("/v1/audio-sync", {
    preHandler: [
      // Validate FIRST, so a malformed request hears the 400 that names its
      // problem rather than a 402, and the guard below prices a body whose
      // source count is already known to be 2..6.
      async (req, reply) => {
        const parsed = audioSyncBody.safeParse(req.body)
        if (!parsed.success) return reply.status(400).send(validationErrorBody(parsed.error))
      },
      // The SAME id the reservation below names (audioSyncCreditId clamps, so
      // even a raw body could never resolve an unpriced row).
      creditGuard((req) => audioSyncCreditId(sourceCountOf(req.body))),
    ],
  }, async (req, reply) => {
    const parsed = audioSyncBody.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send(validationErrorBody(parsed.error))
    const body = parsed.data
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const { userId: _bodyUserId, ...restData } = body
    const creditId = audioSyncCreditId(body.sources.length)
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
      workflow_id: extractWorkflowId(req.body),
      node_id: extractNodeId(req.body),
      force_private: extractForcePrivate(req.body) || undefined,
      user_id: userId,
      status: "pending",
      // `sources` rides input_data verbatim: the job-budget registry reads a
      // row's budget off `input_data.sources` (lib/job-budget.ts).
      input_data: buildJobInputData(restData, "audio-sync"),
      ...(mcpClient ? { mcp_client: mcpClient } : {}),
    })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, creditId)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("audio-sync", { jobId: job.id, ...restData, usageLogId })
    return { jobId: job.id }
  })
}

function validationErrorBody(error: z.ZodError) {
  return { error: { code: "validation_error", ...formatZodError(error) } }
}

function sourceCountOf(body: unknown): number {
  const sources = (body as { sources?: unknown } | undefined)?.sources
  return Array.isArray(sources) ? sources.length : Number.NaN
}
