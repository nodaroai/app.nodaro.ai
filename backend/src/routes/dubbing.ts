import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { supabase } from "../lib/supabase.js"
import { insertJob } from "../lib/insert-job.js"
import { videoQueue } from "../lib/queue.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { sendInternalError } from "../lib/http-errors.js"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
// Duration policy constants live beside the provider (the worker enforces the
// same cap post-start against ElevenLabs' media_metadata — one source, two
// seams). 120s fallback = the ai-avatar precedent: 2 min x the per-minute
// rate prices exactly like the old flat 80. Reservation-vs-actual is NOT
// trued up (fixed-priced provider — decision A of commitJobCredits).
import { DUBBING_MAX_DURATION_SEC, DUBBING_FALLBACK_SECONDS } from "../providers/elevenlabs/dubbing.js"

export { DUBBING_MAX_DURATION_SEC, DUBBING_FALLBACK_SECONDS }

const dubbingBody = z.object({
  /** Exactly one source: uploaded audio, uploaded video, or a public link. */
  audioUrl: safeUrlSchema.optional(),
  videoUrl: safeUrlSchema.optional(),
  /**
   * A public page/media URL (YouTube, TikTok, or a direct link) handed to
   * ElevenLabs verbatim — THEY fetch it, the bytes never pass through this
   * server. Deliberate policy delta (stated in the PR): unlike the yt-dlp
   * ingest paths, this is NOT gated on the SOCIAL_VIDEO_HOSTS allowlist —
   * there is no SSRF exposure on our side, and which hosts work is
   * ElevenLabs' problem surface.
   */
  sourceUrl: safeUrlSchema.optional(),
  targetLanguage: z.string().min(2).max(10),
  sourceLanguage: z.string().min(2).max(10).optional(),
  /** 0 = auto-detect (the API default); 1-20 when the count is known. */
  numSpeakers: z.number().int().min(0).max(20).optional(),
  // Use a similar Voice Library voice instead of cloning the original speaker
  // (the API default clone keeps the source accent — see provider docs).
  disableVoiceCloning: z.boolean().optional(),
  // Drop background audio — cleaner dubs for speech-only sources.
  dropBackgroundAudio: z.boolean().optional(),
  /** Dub only this window of the source (seconds). */
  startTime: z.number().min(0).optional(),
  endTime: z.number().min(0).optional(),
  /** Keep the source resolution on video dubs (slower render). */
  highestResolution: z.boolean().optional(),
  useProfanityFilter: z.boolean().optional(),
  /** Experimental upstream lever: steer dubbed voices toward an accent. */
  targetAccent: z.string().max(50).optional(),
  /** ElevenLabs' own watermark on video dubs (cheaper on some plans). */
  watermark: z.boolean().optional(),
  userId: z.string().uuid().optional(),
}).refine(
  (b) => [b.audioUrl, b.videoUrl, b.sourceUrl].filter(Boolean).length === 1,
  { message: "Provide exactly one source: audioUrl, videoUrl, or sourceUrl" },
).refine(
  (b) => b.startTime == null || b.endTime == null || b.endTime > b.startTime,
  { message: "endTime must be greater than startTime" },
)

/** The dubbed span in seconds: the start/end window when set, else the whole source. */
function effectiveDubbedSeconds(probedSec: number | undefined, startTime?: number, endTime?: number): number | undefined {
  const window = startTime != null && endTime != null ? Math.ceil(endTime - startTime) : undefined
  if (window != null && window > 0) {
    return probedSec != null ? Math.min(probedSec, window) : window
  }
  return probedSec
}

/**
 * Fastify preHandler: ffprobes the uploaded source (audio or video), rejects
 * anything whose dubbed span exceeds {@link DUBBING_MAX_DURATION_SEC} (413 —
 * the spec's word for it), and stashes the span on `body.__probedDurationSec`
 * for creditGuard's computeCredits. `sourceUrl` inputs are un-probeable here
 * (ElevenLabs fetches them) and fall through to the fallback bucket + the
 * worker's post-hoc cap. Probe failures fail OPEN to the same path — never
 * reject a request over a probe hiccup. Mirrors probeDurationPreHandler
 * (video-sfx) / probeAudioDurationPreHandler (ai-avatar).
 */
export async function probeDubbingDurationPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const mediaUrl = (typeof body.videoUrl === "string" && body.videoUrl)
    || (typeof body.audioUrl === "string" && body.audioUrl)
    || undefined
  const startTime = typeof body.startTime === "number" ? body.startTime : undefined
  const endTime = typeof body.endTime === "number" ? body.endTime : undefined
  let probedSec: number | undefined
  if (mediaUrl) {
    try {
      const duration = await probeMediaDuration(mediaUrl)
      if (Number.isFinite(duration) && duration > 0) probedSec = Math.ceil(duration)
    } catch (err) {
      req.log.warn({ err }, "dubbing: media probe failed; falling back to the 120s reserve bucket")
    }
  }
  const effective = effectiveDubbedSeconds(probedSec, startTime, endTime)
  if (effective != null && effective > DUBBING_MAX_DURATION_SEC) {
    return void reply.code(413).send({
      error: {
        code: "media_duration_exceeds_limit",
        message: `The span to dub is ${Math.ceil(effective / 60)} minutes; the maximum is ${DUBBING_MAX_DURATION_SEC / 60} minutes. ` +
          `Trim the clip, or set a start/end window to dub part of it.`,
      },
    })
  }
  if (effective != null) body.__probedDurationSec = effective
}

export async function dubbingRoutes(app: FastifyInstance) {
  app.post("/v1/dubbing", {
    preHandler: [
      probeDubbingDurationPreHandler,
      creditGuard(() => "elevenlabs-dubbing", {
        // Per-minute pricing: probed span (fallback 120s) → ceil to whole
        // minutes x the per-minute base. The base is read through
        // getModelCreditBaseCost so an admin model_pricing row tunes the RATE
        // (treated as per-minute), not a flat price. Returns BASE credits —
        // creditGuard applies the markup. ee import is dynamic on purpose
        // (shim pattern): computeCredits only ever runs under hasCredits().
        computeCredits: async (parsedBody) => {
          const body = parsedBody as Record<string, unknown>
          const probed = body.__probedDurationSec
          const seconds = typeof probed === "number" && probed > 0 ? probed : DUBBING_FALLBACK_SECONDS
          const minutes = Math.max(1, Math.ceil(seconds / 60))
          const { getModelCreditBaseCost } = await import("../ee/billing/credits.js")
          const { creditCost } = await getModelCreditBaseCost("elevenlabs-dubbing")
          return creditCost * minutes
        },
      }),
    ],
  }, async (req, reply) => {
    // preHandler ran against the raw body — strip its stash before parsing so
    // it can't leak into input_data / the queue payload via parsed.data.
    const rawBody = (req.body ?? {}) as Record<string, unknown>
    const { __probedDurationSec: stashedDuration, ...toParse } = rawBody
    const parsed = dubbingBody.safeParse(toParse)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    // B4c note: no voice.allowedGenders enforcement point here — dubbing has no
    // PREMADE voice selector. It clones the ORIGINAL speaker's voice, or (with
    // disableVoiceCloning) substitutes a Voice Library voice whose gender is not
    // knowable at request time. Premade-gender enforcement lives in the routes
    // that pick a premade voice (text-to-speech); voice-creation nodes are gated
    // by nodes.deny (Task 9).
    const {
      audioUrl, videoUrl, sourceUrl, targetLanguage, sourceLanguage, numSpeakers,
      disableVoiceCloning, dropBackgroundAudio, startTime, endTime,
      highestResolution, useProfanityFilter, targetAccent, watermark,
    } = parsed.data
    const userId = req.userId

    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const mcpClient = extractMcpClient(req.body)

    const { data: job, error } = await insertJob(req, {
        workflow_id: extractWorkflowId(req.body),
        node_id: extractNodeId(req.body),
        force_private: extractForcePrivate(req.body) || undefined,
        user_id: userId,
        status: "pending",
        // probedDurationSec rides input_data (not the parsed body — the stash
        // was stripped above) for execution-stats and as reconcile context.
        input_data: {
          ...buildJobInputData(parsed.data, "dubbing"),
          ...(typeof stashedDuration === "number" ? { probedDurationSec: stashedDuration } : {}),
        },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, "elevenlabs-dubbing")
    if (reply.sent) return
    const usageLogId = reservation?.usageLogId

    await videoQueue.add("dubbing", {
      jobId: job.id,
      audioUrl,
      videoUrl,
      sourceUrl,
      targetLanguage,
      sourceLanguage,
      numSpeakers,
      disableVoiceCloning,
      dropBackgroundAudio,
      startTime,
      endTime,
      highestResolution,
      useProfanityFilter,
      targetAccent,
      watermark,
      probedDurationSec: typeof stashedDuration === "number" ? stashedDuration : undefined,
      usageLogId,
    })

    return { jobId: job.id }
  })
}
