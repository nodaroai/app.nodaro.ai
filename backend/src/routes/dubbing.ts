import { DUBBING_VOICE_LOCK_MESSAGE, PROJECT_DUBBING_NEEDS_UPLOAD, dubbingModelIdentifier, dubsAsProject } from "../lib/dubbing-model.js"
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
import { isImportRefusal, requireImportAllowed } from "../lib/import-gate.js"
import { importJobFields, importViaOf } from "../lib/import-via.js"
import { dubbingSourceIsImport } from "../lib/dubbing-source.js"
import { unusableLinkError } from "../lib/unusable-link.js"
import { judgeUnnamedVoices, voiceNotAvailableBody } from "../lib/voice-policy.js"
import { rawBodyRecord } from "../lib/run-model.js"
// Duration policy constants live beside the provider (the worker enforces the
// same cap post-start against ElevenLabs' media_metadata — one source, two
// seams). A span that can be measured is reserved exactly (and committed as
// reserved); one that cannot is held at the 30-minute ceiling and settled to
// the length actually dubbed at delivery (lib/dubbing-duration.ts).
import { DUBBING_MAX_DURATION_SEC, DUBBING_FALLBACK_SECONDS } from "../providers/elevenlabs/dubbing.js"
import { enqueueRouteJob } from "../lib/enqueue-route-job.js"

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
   * ElevenLabs' problem surface. It IS an import of someone else's link,
   * though: the content rights gate holds every sourceUrl that is not a file
   * of our own storage (lib/dubbing-source.ts; probeDubbingDurationPreHandler
   * reads it, the worker spends the confirmation).
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
  /**
   * The content rights confirmation (`POST /v1/content-rights/confirm`) the
   * `sourceUrl` is imported under: the service fetches someone else's link on
   * this account's behalf. Checked before anything reads the link, spent by
   * the worker right before the service is asked. Optional until
   * `content_rights_required` is on; a file of our own storage needs none.
   */
  confirmationId: z.string().uuid().optional(),
}).refine(
  (b) => [b.audioUrl, b.videoUrl, b.sourceUrl].filter(Boolean).length === 1,
  { message: "Provide exactly one source: audioUrl, videoUrl, or sourceUrl" },
).refine(
  (b) => b.startTime == null || b.endTime == null || b.endTime > b.startTime,
  { message: "endTime must be greater than startTime" },
)

/**
 * Fastify preHandler, the route's FIRST: the voice lock (B4c) refuses every dub
 * while it is set. A dub speaks in clones of its source's speakers, or (with
 * `disableVoiceCloning`) in voices the dubbing service picks itself, so no
 * voice it produces is one the platform can vouch for (`judgeUnnamedVoices`).
 * First, so a refused dub probes no media, reads no import gate and prices
 * nothing. No lock: a pass, nothing read.
 */
export async function refuseDubbingUnderVoiceLock(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (judgeUnnamedVoices().allowed) return
  return void reply.code(400).send(voiceNotAvailableBody(DUBBING_VOICE_LOCK_MESSAGE))
}

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
  // A link handed to the dubbing service is an import of that link: refused
  // when two URL parsers would read it differently, then held to the gate
  // (read) before anything touches it, the length probe below included. The
  // worker spends the confirmation right before the service is asked.
  if (typeof body.sourceUrl === "string" && body.sourceUrl) {
    // Nothing touches a link for a request with no account behind it.
    if (!req.userId) {
      return void reply.code(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    const parsed = dubbingBody.safeParse(body)
    if (!parsed.success) {
      return void reply.code(400).send({ error: { code: "validation_error", ...formatZodError(parsed.error) } })
    }
    const sourceUrl = parsed.data.sourceUrl ?? ""
    const unusable = unusableLinkError(sourceUrl)
    if (unusable) return void reply.code(400).send({ error: unusable })
    // A dub into Hebrew takes an uploaded file only (the settings check below
    // says the same for any source): refused before the gate reads the link.
    if (dubsAsProject(body.targetLanguage)) {
      return void reply.code(400).send({ error: { code: "unsupported_dubbing_settings", message: PROJECT_DUBBING_NEEDS_UPLOAD } })
    }
    // From here on the link is the one the gate judged (the schema trims the
    // ends): the length probe below reads it from the body too.
    body.sourceUrl = sourceUrl
    if (dubbingSourceIsImport(sourceUrl)) {
      try {
        await requireImportAllowed(sourceUrl, {
          userId: req.userId,
          confirmationId: parsed.data.confirmationId,
          lane: "route",
          requestId: req.id,
          via: importViaOf(req),
        })
      } catch (e) {
        if (isImportRefusal(e)) return void reply.code(403).send({ error: { code: e.code, message: e.message } })
        throw e
      }
    }
  }
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
      refuseDubbingUnderVoiceLock,
      probeDubbingDurationPreHandler,
      creditGuard((req) => dubbingModelIdentifier((req.body as Record<string, unknown>)?.targetLanguage), {
        runModel: (req) => dubbingModelIdentifier(rawBodyRecord(req).targetLanguage),
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

    // B4c: a voice lock refused this request before anything else ran
    // (`refuseDubbingUnderVoiceLock`, the first preHandler) — a dub names no
    // voice the platform could judge.
    const {
      audioUrl, videoUrl, sourceUrl, targetLanguage, sourceLanguage, numSpeakers,
      disableVoiceCloning, dropBackgroundAudio, startTime, endTime,
      highestResolution, useProfanityFilter, targetAccent, watermark, confirmationId,
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

    await enqueueRouteJob(req, reply, job.id, () => videoQueue.add("dubbing", {
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
      // A link handed to the service is an import of the link: the
      // confirmation, the way in (and the connected app), for the worker's
      // gate (`importRightsOf`).
      ...(confirmationId ? { confirmationId } : {}),
      ...importJobFields(req),
    }))
    if (reply.sent) return

    return { jobId: job.id }
  })
}
