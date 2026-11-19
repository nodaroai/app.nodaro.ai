/**
 * Audio Isolation Route — `POST /v1/audio-isolation`.
 *
 * Removes background noise and music from an audio (or a video's sound) on
 * ElevenLabs' own API. Priced by the length of the audio, as the server reads
 * it before anything is held (decided 2026-11-18): one
 * `elevenlabs-isolation:per-10s` unit per started ten seconds, at least one;
 * audio past 30 minutes, or that cannot be read, is refused with nothing held
 * (`audioIsolationLengthStep`). The hold is the charge.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { AUDIO_ISOLATION_RATE_ID } from "@nodaro/shared/credits"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { AUDIO_ISOLATION_MODEL_ID, fixedRunModel } from "../lib/run-model.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { readAudioIsolationInput } from "../lib/audio-isolation-input.js"
import { unitRateBaseCredits } from "../lib/credit-base-cost.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"
import { ROUTE_MEASURE_DEADLINE_MS } from "../lib/pre-charge-probe-bounds.js"
import { probeRefusalStatus } from "../providers/video/probe-guard.js"

export const audioIsolationBody = z.object({
  audioUrl: safeUrlSchema,
  userId: z.string().uuid().optional(),
})

/** Body fields named like the server's own reading: dropped from every request, never read. */
const CLIENT_LENGTH_FIELDS: readonly string[] = ["audioIsolationSec", "audioIsolationUnits"]
/** The key the length step keeps its reading under, server-side only. */
const LENGTH_KEY = "audioIsolation"
/** What the length step read: the audio's length and the units it is held and charged. */
interface AudioIsolationStash {
  readonly audioSec: number
  readonly units: number
}

function stashOf(req: FastifyRequest): AudioIsolationStash | undefined {
  return requestMeasure<AudioIsolationStash>(req, LENGTH_KEY)
}

/**
 * The credit guard's `beforePricing` step: past the guard's model and node
 * doors, the app-token scope gate and the Idempotency-Key dedup, validate the
 * body with the handler's own schema, read the audio's length
 * (`readAudioIsolationInput`, the rule the workflow run shares), refuse audio
 * past the cap or that cannot be read with nothing held, and keep the reading
 * on the server-side request.
 */
export async function audioIsolationLengthStep(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  dropClientMeasureFields(req.body, CLIENT_LENGTH_FIELDS)
  const parsed = audioIsolationBody.safeParse(req.body)
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  const read = await readAudioIsolationInput(parsed.data.audioUrl, (err) => {
    req.log.warn({ err }, "audio-isolation: the audio's length could not be read; refusing the run")
  }, { deadlineAt: Date.now() + ROUTE_MEASURE_DEADLINE_MS })
  if (!read.ok) {
    return void reply.status(probeRefusalStatus(read.code)).send({ error: { code: read.code, message: read.message } })
  }
  setRequestMeasure(req, LENGTH_KEY, { audioSec: read.audioSec, units: read.units } satisfies AudioIsolationStash)
}

/** BASE credits: the per-10-second row × the units read, rounded up once. */
export async function audioIsolationComputeCredits(_body: unknown, req: FastifyRequest): Promise<number> {
  const stash = stashOf(req)
  if (!stash) throw new Error("audio-isolation: the run reached its pricing without the length of its audio")
  return unitRateBaseCredits(AUDIO_ISOLATION_RATE_ID, stash.units)
}

export async function audioIsolationRoutes(app: FastifyInstance) {
  app.post("/v1/audio-isolation", {
    // The audio's length is read inside the guard (`beforePricing`), after its model and node doors.
    preHandler: creditGuard(() => AUDIO_ISOLATION_RATE_ID, {
      runModel: fixedRunModel(AUDIO_ISOLATION_MODEL_ID),
      computeCredits: audioIsolationComputeCredits,
      beforePricing: audioIsolationLengthStep,
    }),
  }, async (req, reply) => {
    const parsed = audioIsolationBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const stash = stashOf(req)
    if (!stash) {
      // Unreachable while the length step runs first; an invariant, not a user error.
      return sendInternalError(reply, req, new Error("audio-isolation: audio length missing"), "Failed to isolate audio")
    }

    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          ...buildJobInputData(parsed.data, "audio-isolation"),
          audioIsolationSec: stash.audioSec,
          audioIsolationUnits: stash.units,
        },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, AUDIO_ISOLATION_RATE_ID)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("audio-isolation", {
      jobId: job.id,
      audioUrl,
      audioIsolationSec: stash.audioSec,
      audioIsolationUnits: stash.units,
      usageLogId,
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
