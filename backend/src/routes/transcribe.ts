import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { insertJob } from "../lib/insert-job.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import {
  TRANSCRIBE_PROVIDERS,
  TRANSCRIBE_PROVIDER_CAPABILITIES,
  DEFAULT_TRANSCRIBE_PROVIDER,
} from "@nodaro/shared/models"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"

// The providers this route ACCEPTS that can also honour word timestamps —
// derived from the capability table, intersected with the route's own enum so
// the rejection message never names a provider this same route would reject.
// (Today the enum is every lane, so the intersection is the whole capable set;
// it stays an intersection because the two sets have diverged before.)
const WORD_TIMESTAMP_PROVIDERS = TRANSCRIBE_PROVIDERS.filter(
  (p) => TRANSCRIBE_PROVIDER_CAPABILITIES[p].wordTimestamps,
)

export const transcribeBody = z.object({
  audioUrl: safeUrlSchema,
  provider: z.enum(TRANSCRIBE_PROVIDERS).optional(),
  language: z.string().max(10).optional(),
  diarize: z.boolean().optional(),
  tagAudioEvents: z.boolean().optional(),
  wordTimestamps: z.boolean().optional(),
  userId: z.string().uuid().optional(),
}).superRefine((v, ctx) => {
  // Word timings are a per-provider capability, and the incapable lane fails
  // SILENTLY: `openai/whisper` has no `word_timestamps` input in any published
  // version, so Replicate drops the key and the job "succeeds" with an empty
  // word list after credits are spent. That is the ONE incapable lane in the
  // enum — `incredibly-fast-whisper` (`timestamp: "word"`) and `elevenlabs-stt`
  // (word-level by design) both pass. Reject at ingress — before the job insert
  // and the credit reservation — rather than auto-swapping the provider: the
  // credit guard reserves on the provider id, so a swap would silently change
  // what bills. The capability is always asked of the table, never of a
  // provider-name check.
  if (!v.wordTimestamps) return
  const resolved = v.provider ?? DEFAULT_TRANSCRIBE_PROVIDER
  if (TRANSCRIBE_PROVIDER_CAPABILITIES[resolved].wordTimestamps) return
  ctx.addIssue({
    code: "custom",
    path: ["wordTimestamps"],
    message:
      `provider "${resolved}"${v.provider ? "" : " (the default)"} does not return word timestamps — ` +
      `set provider to ${WORD_TIMESTAMP_PROVIDERS.join(" or ")}`,
  })
})

export async function transcribeRoutes(app: FastifyInstance) {
  app.post("/v1/transcribe", {
    // The engine id IS the credit identifier, and all three enum members carry
    // a price (`elevenlabs-stt`, `whisper`, `incredibly-fast-whisper` in
    // STATIC_CREDIT_COSTS + model_pricing) — the guard here and the reservation
    // below resolve an absent provider the same way, so what is checked is what
    // bills.
    preHandler: creditGuard((req) => {
      const body = req.body as Record<string, unknown>
      return (body?.provider as string) ?? DEFAULT_TRANSCRIBE_PROVIDER
    }),
  }, async (req, reply) => {
    const parsed = transcribeBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl, provider, language, diarize, tagAudioEvents } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // Determine model identifier for credit reservation
    const modelIdentifier = provider ?? DEFAULT_TRANSCRIBE_PROVIDER
    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: buildJobInputData(parsed.data, "transcribe"),
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    // Reserve credits
    const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("transcribe", {
      jobId: job.id,
      audioUrl,
      provider,
      language,
      diarize,
      tagAudioEvents,
      wordTimestamps: parsed.data.wordTimestamps,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
