import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"
import { safeUrlSchema, YOUTUBE_HOSTS, hostnameMatchesAllowlist } from "../lib/url-validator.js"
import { supabase } from "../lib/supabase.js"
import { videoQueue } from "../lib/queue.js"
import { creditGuard, reserveCreditsForJob } from "../middleware/credit-guard.js"
import { extractWorkflowId, extractNodeId, extractForcePrivate } from "../lib/request-helpers.js"
import { extractMcpClient } from "../lib/extract-mcp-client.js"
import { buildJobInputData } from "../lib/job-input-data.js"
import { formatZodError } from "../lib/zod-error.js"
import { stripFocusCloseTag } from "../lib/video-analysis-prompt.js"
import { probeMediaDuration } from "../providers/video/ffmpeg-utils.js"
import { ytMetadataProbe, YtUrlNotAllowedError } from "../providers/video/youtube-video.js"
import { buildVideoAnalysisCreditId, VIDEO_ANALYSIS_LLM_MODELS, VIDEO_ANALYSIS_MAX_DURATION_SEC } from "@nodaro/shared"

const DEFAULT_LLM_MODEL = "gemini-3-flash"

const YOUTUBE_URL_MESSAGE = "youtubeUrl must be a YouTube URL (youtube.com / youtu.be)"

/** Single source of truth for "is this an allowed YouTube URL" — parses the URL
 *  and matches its hostname against the exact-suffix allowlist (SSRF gate,
 *  defense-in-depth with the probe layer's own check inside `ytMetadataProbe`).
 *  Shared by the `/probe` body schema and the main route's videoUrl-absent
 *  superRefine so the two checks can never drift. */
function isYoutubeUrl(url: string): boolean {
  try {
    return hostnameMatchesAllowlist(new URL(url).hostname, YOUTUBE_HOSTS)
  } catch {
    return false
  }
}

/** YouTube-only URL — used by the standalone `/probe` endpoint, where youtubeUrl
 *  is the ONLY source and is therefore always validated. */
const youtubeUrlSchema = z.string().url().refine(isYoutubeUrl, { message: YOUTUBE_URL_MESSAGE })

// `stripFocusCloseTag` is imported from `../lib/video-analysis-prompt.js` — the
// SINGLE source of truth for the delimiter guard, applied at the wrapping site so
// the orchestrated (app/webhook/MCP) path is covered too. Applying it here as a
// Zod transform additionally keeps the stored `input_data` focus clean.

const videoAnalysisBody = z
  .object({
    videoUrl: safeUrlSchema.optional(),
    // Plain string here — the YouTube host/URL check is enforced by the
    // videoUrl-absent superRefine below, NOT at the field level, so a stale
    // non-YouTube leftover can't reject a run that videoUrl wins.
    youtubeUrl: z.string().optional(),
    llmModel: z.enum(VIDEO_ANALYSIS_LLM_MODELS as [string, ...string[]]).default(DEFAULT_LLM_MODEL),
    analysisFocus: z.string().max(2000).transform(stripFocusCloseTag).optional(),
    userId: z.string().uuid().optional(),
  })
  // Precedence, NOT exactly-one: both sources may be present (a stale
  // youtubeUrl alongside a wired videoUrl must not reject — videoUrl wins).
  .refine((v) => Boolean(v.videoUrl || v.youtubeUrl), {
    message: "Either videoUrl or youtubeUrl is required",
  })
  // youtubeUrl host/URL validation is enforced ONLY when videoUrl is absent.
  // Single source of truth for "does youtubeUrl matter": videoUrl absent —
  // mirrors the probe layer's precedence (videoUrl present ⇒ youtubeUrl fully
  // ignored, so a malformed/non-YouTube leftover there must not 400 the run).
  .superRefine((v, ctx) => {
    if (v.videoUrl || !v.youtubeUrl) return
    if (!isYoutubeUrl(v.youtubeUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["youtubeUrl"],
        message: YOUTUBE_URL_MESSAGE,
      })
    }
  })

const probeBody = z.object({
  youtubeUrl: youtubeUrlSchema,
})

/**
 * Single source of truth for the video-analysis credit identifier — used by
 * BOTH the creditGuard preHandler and the in-handler reservation (and echoed
 * into the worker payload as `reservedCreditId`) so the reserved price can
 * never drift from the charged price. Mirrors lip-sync's
 * resolveLipSyncIdentifier().
 *
 * MUST read the RAW request body: the probe preHandler stashes
 * `__probedDuration` there, and Zod strips it at parse (the ai-avatar trap —
 * resolving from parsed.data would silently fall back to the 600s ceiling).
 */
export function resolveVideoAnalysisIdentifier(body: Record<string, unknown> | undefined): string {
  const llmModel =
    typeof body?.llmModel === "string" && body.llmModel.length > 0
      ? body.llmModel
      : DEFAULT_LLM_MODEL
  const probed = typeof body?.__probedDuration === "number" ? body.__probedDuration : undefined
  return buildVideoAnalysisCreditId(llmModel, probed)
}

function reject422(reply: FastifyReply, code: string, message: string): FastifyReply {
  return reply.status(422).send({ error: { code, message } })
}

/** Shared 422 policy for a probed duration — used by the preHandler AND the
 *  standalone /probe endpoint (mirror-422). STRICT `> 600`: probe values are
 *  metadata integers and no money has been spent yet, so there is no route
 *  tolerance (the worker applies its own ±3s re-check grace after download). */
function validateProbedDuration(reply: FastifyReply, durationSec: number | null): boolean {
  if (durationSec === null || !Number.isFinite(durationSec) || durationSec <= 0) {
    reject422(
      reply,
      "invalid_video_duration",
      "The video reports no usable duration. The file may be corrupted, still processing, or an unsupported format.",
    )
    return false
  }
  if (durationSec > VIDEO_ANALYSIS_MAX_DURATION_SEC) {
    reject422(
      reply,
      "video_too_long",
      `Video is ${Math.ceil(durationSec)} seconds. Maximum duration for analysis is ${VIDEO_ANALYSIS_MAX_DURATION_SEC} seconds (10 minutes).`,
    )
    return false
  }
  return true
}

/**
 * Fastify preHandler: probes the duration of the SAME source the worker will
 * ingest and stashes ceil(duration) on the RAW body as `__probedDuration` so
 * the creditGuard's resolver buckets the reserve by the actual length instead
 * of the 600s ceiling. MUST run BEFORE creditGuard (mirrors ai-avatar's
 * probeAudioDurationPreHandler ordering).
 *
 * Source PRECEDENCE (never exactly-one): `videoUrl` wins over `youtubeUrl` —
 * a stale youtubeUrl left in node data alongside a wired videoUrl must not
 * reject the request; the worker applies the same precedence at ingest.
 *
 * Unlike ai-avatar's best-effort probe, this one REJECTS 422 on probe failure,
 * live streams, null duration, and duration > 600s: analysis cost scales with
 * duration, so proceeding blind would reserve the ceiling bucket for content
 * we already know is un-analyzable.
 *
 * When NEITHER source is present it falls through — the handler's Zod refine
 * owns that 400 (friendly field-level validation error).
 */
export async function probeVideoAnalysisDurationPreHandler(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>
  const videoUrl = typeof body.videoUrl === "string" && body.videoUrl.length > 0 ? body.videoUrl : undefined
  const youtubeUrl =
    typeof body.youtubeUrl === "string" && body.youtubeUrl.length > 0 ? body.youtubeUrl : undefined

  let durationSec: number | null = null
  if (videoUrl) {
    try {
      durationSec = await probeMediaDuration(videoUrl)
    } catch (err) {
      req.log.warn({ err }, "video-analysis: direct-video ffprobe failed")
      return void reject422(
        reply,
        "probe_failed",
        "Could not read the video's duration. Check that videoUrl points to a reachable, valid video file.",
      )
    }
  } else if (youtubeUrl) {
    let meta: Awaited<ReturnType<typeof ytMetadataProbe>>
    try {
      meta = await ytMetadataProbe(youtubeUrl)
    } catch (err) {
      if (err instanceof YtUrlNotAllowedError) {
        return void reject422(
          reply,
          "youtube_url_not_allowed",
          "youtubeUrl must be a YouTube URL (youtube.com / youtu.be).",
        )
      }
      req.log.warn({ err }, "video-analysis: YouTube metadata probe failed")
      return void reject422(
        reply,
        "probe_failed",
        "Could not read the YouTube video's metadata. The video may be private, age-restricted, region-locked, or removed.",
      )
    }
    if (meta.isLive) {
      return void reject422(
        reply,
        "live_stream_not_supported",
        "Live streams cannot be analyzed. Wait for the stream to end and the VOD to become available.",
      )
    }
    durationSec = meta.durationSec
    if (typeof meta.title === "string" && meta.title.length > 0) {
      body.__probedTitle = meta.title
    }
  } else {
    return // no source — the handler's Zod refine produces the 400
  }

  if (!validateProbedDuration(reply, durationSec)) return
  body.__probedDuration = Math.ceil(durationSec as number)
}

export async function videoAnalysisRoutes(app: FastifyInstance) {
  app.post(
    "/v1/video-analysis",
    {
      // Order matters: the probe stashes __probedDuration on the raw body so
      // creditGuard's resolver buckets the reserve by the ACTUAL duration.
      preHandler: [
        probeVideoAnalysisDurationPreHandler,
        creditGuard((req) => resolveVideoAnalysisIdentifier(req.body as Record<string, unknown> | undefined)),
      ],
    },
    async (req, reply) => {
      // video-sfx pattern: strip the preHandler stashes off the raw body
      // BEFORE Zod parses so they never leak into parsed.data / input_data.
      // req.body itself keeps them — the credit resolver below re-reads it.
      const rawBody = (req.body ?? {}) as Record<string, unknown>
      const { __probedDuration: _stashedDuration, __probedTitle: _stashedTitle, ...toParse } = rawBody
      const parsed = videoAnalysisBody.safeParse(toParse)
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }
      const { videoUrl, youtubeUrl, llmModel, analysisFocus } = parsed.data

      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      const mcpClient = extractMcpClient(req.body)

      const { data: job, error } = await supabase
        .from("jobs")
        .insert({
          workflow_id: extractWorkflowId(req.body),
          node_id: extractNodeId(req.body),
          force_private: extractForcePrivate(req.body) || undefined,
          user_id: userId,
          status: "pending",
          input_data: buildJobInputData(parsed.data, "video-analysis"),
          ...(mcpClient ? { mcp_client: mcpClient } : {}),
        })
        .select("id")
        .single()

      if (error) {
        return reply.status(500).send({
          error: { code: "internal_error", message: error.message },
        })
      }

      // Re-resolve from the RAW body (not parsed.data): Zod stripped the
      // stashed __probedDuration, so resolving from parsed.data would lose the
      // probe bucket and reserve the 600s ceiling — a drift from what the
      // creditGuard preHandler checked (the ai-avatar trap).
      const modelIdentifier = resolveVideoAnalysisIdentifier(
        req.body as Record<string, unknown> | undefined,
      )
      const reservation = await reserveCreditsForJob(req, reply, job.id, modelIdentifier)
      if (reply.sent) return
      const usageLogId = reservation?.usageLogId

      const probedTitle = typeof rawBody.__probedTitle === "string" ? rawBody.__probedTitle : undefined

      // Worker payload contract (Task 10) — enumerated, do not add fields the
      // worker doesn't consume. attempts: 1 — the handler owns its own retry
      // budget (per-window transport retries + R2 state re-entry); a BullMQ
      // re-run would double-bill the LLM calls.
      await videoQueue.add(
        "video-analysis",
        {
          jobId: job.id,
          usageLogId,
          videoUrl,
          youtubeUrl,
          llmModel,
          analysisFocus,
          reservedCreditId: modelIdentifier,
          probedTitle,
          workflowId: extractWorkflowId(req.body) ?? undefined,
          nodeId: extractNodeId(req.body) ?? undefined,
        },
        { attempts: 1 },
      )

      return { jobId: job.id }
    },
  )

  // Pre-flight duration probe for the editor UI — authenticated, NO credits,
  // no job row. yt-dlp metadata probes cost ~1-3s of subprocess time each, so
  // rate-limit per token (suno /voice/generate pattern).
  app.post(
    "/v1/video-analysis/probe",
    {
      config: { rateLimit: { max: 5, timeWindow: "1m" } },
    },
    async (req, reply) => {
      const parsed = probeBody.safeParse(req.body ?? {})
      if (!parsed.success) {
        return reply.status(400).send({
          error: { code: "validation_error", ...formatZodError(parsed.error) },
        })
      }

      const userId = req.userId
      if (!userId) {
        return reply.status(401).send({
          error: { code: "unauthorized", message: "Authentication required" },
        })
      }

      let meta: Awaited<ReturnType<typeof ytMetadataProbe>>
      try {
        meta = await ytMetadataProbe(parsed.data.youtubeUrl)
      } catch (err) {
        if (err instanceof YtUrlNotAllowedError) {
          return reject422(
            reply,
            "youtube_url_not_allowed",
            "youtubeUrl must be a YouTube URL (youtube.com / youtu.be).",
          )
        }
        req.log.warn({ err }, "video-analysis: probe endpoint yt-dlp failed")
        return reject422(
          reply,
          "probe_failed",
          "Could not read the YouTube video's metadata. The video may be private, age-restricted, region-locked, or removed.",
        )
      }

      // Mirror-422 policy — same verdicts the main route's preHandler applies,
      // so a green probe is a reliable predictor of an accepted analysis run.
      if (meta.isLive) {
        return reject422(
          reply,
          "live_stream_not_supported",
          "Live streams cannot be analyzed. Wait for the stream to end and the VOD to become available.",
        )
      }
      if (!validateProbedDuration(reply, meta.durationSec)) return

      return { durationSec: meta.durationSec, title: meta.title }
    },
  )
}
