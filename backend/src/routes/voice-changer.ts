/**
 * Voice Changer Route — `POST /v1/voice-changer`.
 *
 * Replaces the voice in an audio (or in a whole talking video) on ElevenLabs
 * speech-to-speech. Priced by the length of the audio, as the server reads it
 * before anything is held (decided 2026-11-22): one
 * `elevenlabs-voice-changer:per-10s` unit per started ten seconds, at least
 * one — the video's sound when the request names a video (a video wins), else
 * the audio's. Audio past 5 minutes, or that cannot be read, is refused with
 * nothing held (`voiceChangerLengthStep`). The hold is the charge. The model
 * that runs (what a deployment's model restriction names) is still
 * `elevenlabs-voice-changer`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { sendInternalError } from "../lib/http-errors.js"
import { insertJob } from "../lib/insert-job.js"
import { z } from "zod"
import { VOICE_CHANGER_RATE_ID } from "@nodaro/shared/credits"
import { VOICE_CHANGER_MODEL_IDS } from "@nodaro/shared/models"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { judgeVoice, voiceNotAvailableBody } from "../lib/voice-gender.js"
import { VOICE_CHANGER_MODEL_ID, fixedRunModel } from "../lib/run-model.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"
import { readVoiceChangerInput, voiceChangerSourceUrl } from "../lib/voice-changer-input.js"
import { unitRateBaseCredits } from "../lib/credit-base-cost.js"
import { dropClientMeasureFields, requestMeasure, setRequestMeasure } from "../lib/request-measure.js"
import { ROUTE_MEASURE_DEADLINE_MS } from "../lib/pre-charge-probe-bounds.js"
import { probeRefusalStatus } from "../providers/video/probe-guard.js"

const voiceChangerBody = z
  .object({
    // Audio mode (audio in → audio out) OR video mode (video in → video out +
    // revoiced audio). When both are supplied, video wins (the worker ignores
    // audioUrl, and the video's sound is what the run is priced on). Exactly
    // one is required.
    audioUrl: safeUrlSchema.optional(),
    videoUrl: safeUrlSchema.optional(),
    voiceId: z.string().min(1),
    // ElevenLabs speech-to-speech model. Optional: when omitted the provider
    // falls back to eleven_multilingual_sts_v2 — ElevenLabs recommends it
    // even for English audio, and it's required for non-English sources.
    model: z.enum(VOICE_CHANGER_MODEL_IDS as [string, ...string[]]).optional(),
    stability: z.number().min(0).max(1).optional(),
    similarityBoost: z.number().min(0).max(1).optional(),
    style: z.number().min(0).max(1).optional(),
    useSpeakerBoost: z.boolean().optional(),
    seed: z.number().int().min(0).max(4294967295).optional(),
    removeBackgroundNoise: z.boolean().optional(),
    userId: z.string().uuid().optional(),
  })
  .refine((d) => Boolean(d.audioUrl) || Boolean(d.videoUrl), {
    message: "Either audioUrl or videoUrl is required",
    path: ["audioUrl"],
  })

/** Body fields named like the server's own reading: dropped from every request, never read. */
const CLIENT_LENGTH_FIELDS: readonly string[] = ["voiceChangerSec", "voiceChangerUnits"]
/** The key the length step keeps its reading under, server-side only. */
const LENGTH_KEY = "voiceChanger"
/** What the length step read: the audio's length and the units it is held and charged. */
interface VoiceChangerStash {
  readonly audioSec: number
  readonly units: number
}

function stashOf(req: FastifyRequest): VoiceChangerStash | undefined {
  return requestMeasure<VoiceChangerStash>(req, LENGTH_KEY)
}

/**
 * The credit guard's `beforePricing` step: past the guard's model and node
 * doors, the app-token scope gate and the Idempotency-Key dedup, validate the
 * body with the handler's own schema, read the length of the audio the run
 * revoices (`readVoiceChangerInput`, the rule the workflow run shares — the
 * video's when one is named), refuse audio past the cap or that cannot be read
 * with nothing held, and keep the reading on the server-side request.
 */
export async function voiceChangerLengthStep(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  dropClientMeasureFields(req.body, CLIENT_LENGTH_FIELDS)
  const parsed = voiceChangerBody.safeParse(req.body)
  if (!parsed.success) {
    return void reply.status(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
  }
  // The schema holds one of the two links.
  const sourceUrl = voiceChangerSourceUrl(parsed.data)!
  const read = await readVoiceChangerInput(sourceUrl, (err) => {
    req.log.warn({ err }, "voice-changer: the audio's length could not be read; refusing the run")
  }, { deadlineAt: Date.now() + ROUTE_MEASURE_DEADLINE_MS })
  if (!read.ok) {
    return void reply.status(probeRefusalStatus(read.code)).send({ error: { code: read.code, message: read.message } })
  }
  setRequestMeasure(req, LENGTH_KEY, { audioSec: read.audioSec, units: read.units } satisfies VoiceChangerStash)
}

/** BASE credits: the per-10-second row × the units read, rounded up once. */
export async function voiceChangerComputeCredits(_body: unknown, req: FastifyRequest): Promise<number> {
  const stash = stashOf(req)
  if (!stash) throw new Error("voice-changer: the run reached its pricing without the length of its audio")
  return unitRateBaseCredits(VOICE_CHANGER_RATE_ID, stash.units)
}

export async function voiceChangerRoutes(app: FastifyInstance) {
  app.post("/v1/voice-changer", {
    // The audio's length is read inside the guard (`beforePricing`), after its model and node doors.
    preHandler: creditGuard(() => VOICE_CHANGER_RATE_ID, {
      runModel: fixedRunModel(VOICE_CHANGER_MODEL_ID),
      computeCredits: voiceChangerComputeCredits,
      beforePricing: voiceChangerLengthStep,
    }),
  }, async (req, reply) => {
    const parsed = voiceChangerBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const { audioUrl, videoUrl, voiceId, model, stability, similarityBoost, style, removeBackgroundNoise, useSpeakerBoost, seed } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    // B4c: under a voice lock, the voice a clip is converted INTO must be one
    // whose gender the platform can vouch for as allowed, judged by its id alone
    // (lib/voice-gender.ts: a premade voice by name or id, the caller's own
    // clone, a library voice this deployment listed), before any job row or
    // reservation. A voice of unknown gender is refused too. No lock: nothing is
    // looked up and the request is unchanged.
    const voiceVerdict = await judgeVoice(voiceId, { userId })
    if (!voiceVerdict.allowed) {
      return reply.status(400).send(voiceNotAvailableBody())
    }

    const stash = stashOf(req)
    if (!stash) {
      // Unreachable while the length step runs first; an invariant, not a user error.
      return sendInternalError(reply, req, new Error("voice-changer: audio length missing"), "Failed to change voice")
    }

    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        input_data: {
          ...buildJobInputData(parsed.data, "voice-changer"),
          resolvedModel: VOICE_CHANGER_MODEL_ID,
          voiceChangerSec: stash.audioSec,
          voiceChangerUnits: stash.units,
        },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to change voice")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, VOICE_CHANGER_RATE_ID)
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("voice-changer", {
      jobId: job.id,
      audioUrl,
      videoUrl,
      voiceId,
      model,
      stability,
      similarityBoost,
      style,
      removeBackgroundNoise,
      useSpeakerBoost,
      seed,
      voiceChangerSec: stash.audioSec,
      voiceChangerUnits: stash.units,
      usageLogId,
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
