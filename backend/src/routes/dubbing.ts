import { dubbingModelIdentifier } from "../lib/dubbing-model.js"
import { usesDubbingProject, validateProjectDubbing } from "../providers/elevenlabs/dubbing-project.js"
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
import { hasCredits } from "../lib/config.js"
import { dubbingBaseCredits, dubbingReservePlan, effectiveDubbedSeconds, measureDubbingSourceSec } from "../lib/dubbing-duration.js"
// Duration policy constants live beside the provider (the worker enforces the
// same cap post-start against ElevenLabs' media_metadata — one source, two
// seams). A span that can be measured is reserved exactly (and committed as
// reserved); one that cannot is held at the 30-minute ceiling and settled to
// the length actually dubbed at delivery (lib/dubbing-duration.ts).
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

/**
 * Fastify preHandler: measures the source (an upload by ffprobe; a link —
 * where credits are charged — through the social-post probe or ffprobe,
 * lib/dubbing-duration.ts), rejects anything whose dubbed span exceeds
 * {@link DUBBING_MAX_DURATION_SEC} (413 — the spec's word for it), and
 * stashes the span on `body.__probedDurationSec` for creditGuard's
 * computeCredits. A source that cannot be measured is never rejected for it:
 * the run holds the 30-minute ceiling, the worker enforces the cap post-start,
 * and delivery settles the hold to the length dubbed. Mirrors
 * probeDurationPreHandler (video-sfx) / probeAudioDurationPreHandler (ai-avatar).
 */
export async function probeDubbingDurationPreHandler(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  // Reject unsupported project settings before credit reservation or dispatch.
  if (typeof body.targetLanguage === "string" && usesDubbingProject(body.targetLanguage)) {
    const parsed = dubbingBody.safeParse(body)
    if (!parsed.success) {
      return void reply.code(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    try {
      validateProjectDubbing({ url: parsed.data.videoUrl ?? parsed.data.audioUrl }, parsed.data)
    } catch (err) {
      return void reply.code(400).send({ error: { code: "unsupported_dubbing_settings", message: (err as Error).message } })
    }
  }
  const mediaUrl = (typeof body.videoUrl === "string" && body.videoUrl)
    || (typeof body.audioUrl === "string" && body.audioUrl)
    || undefined
  // A link is measured only where credits are charged (its length prices the
  // run); ElevenLabs fetches it either way.
  const sourceUrl = !mediaUrl && hasCredits() && typeof body.sourceUrl === "string" && body.sourceUrl
    ? body.sourceUrl
    : undefined
  const startTime = typeof body.startTime === "number" ? body.startTime : undefined
  const endTime = typeof body.endTime === "number" ? body.endTime : undefined
  const probedSec = mediaUrl || sourceUrl
    ? await measureDubbingSourceSec({ mediaUrl, sourceUrl }, (err) => {
        req.log.warn({ err }, "dubbing: source probe failed; holding the 30-minute ceiling")
      })
    : undefined
  if (typeof body.targetLanguage === "string" && usesDubbingProject(body.targetLanguage) && probedSec == null) {
    return void reply.code(422).send({ error: { code: "unreadable_dubbing_source", message: "Could not read the video duration. Import the source again before dubbing into Hebrew." } })
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
      creditGuard((req) => dubbingModelIdentifier((req.body as Record<string, unknown>)?.targetLanguage), {
        // Per-minute pricing: the measured span, or the 30-minute ceiling
        // when it could not be read (settled down at delivery) → whole
        // minutes x the per-minute row (admin-editable in model_pricing, so
        // a row tunes the RATE). Returns BASE credits — creditGuard applies
        // the markup. The same plan prices a workflow run.
        computeCredits: async (parsedBody) => {
          const body = parsedBody as Record<string, unknown>
          const probed = body.__probedDurationSec
          const plan = dubbingReservePlan(typeof probed === "number" ? probed : undefined)
          return dubbingBaseCredits(body.targetLanguage, plan.seconds)
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
        // `reservedCeiling` tells delivery the hold was the 30-minute
        // ceiling, to be settled to the length actually dubbed.
        input_data: {
          ...buildJobInputData(parsed.data, "dubbing"),
          ...(typeof stashedDuration === "number" ? { probedDurationSec: stashedDuration } : { reservedCeiling: true }),
        },
        ...(mcpClient ? { mcp_client: mcpClient } : {}),
      })

    if (error) {
      return sendInternalError(reply, req, error, "Failed to create job")
    }

    const reservation = await reserveCreditsForJob(req, reply, job.id, dubbingModelIdentifier(targetLanguage))
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
      ...(typeof stashedDuration === "number" ? {} : { reservedCeiling: true }),
      usageLogId,
    })

    return { jobId: job.id }
  })
}
