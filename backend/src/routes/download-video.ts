import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema, isAllowedSocialVideoUrl, isDirectVideoFileUrl } from "../lib/url-validator.js"
import { resolvesOnlyToPublicAddresses } from "../lib/safe-fetch.js"
import {
  DIRECT_FILE_MAX_BYTES,
  MAX_ACTIVE_DOWNLOADS_PER_USER,
  activeDownloads,
  startTrackedDownload,
  tryAcquireDownloadSlot,
} from "../lib/video-download.js"
import { formatZodError } from "../lib/zod-error.js"
import { isOriginAllowedDynamic } from "../lib/dynamic-origins.js"
import { firstHeaderValue } from "../lib/request-helpers.js"

const downloadVideoBody = z
  .object({
    url: safeUrlSchema.refine(
      (url) => isAllowedSocialVideoUrl(url) || isDirectVideoFileUrl(url),
      { message: "Must be a social video URL (YouTube, Facebook, TikTok, Instagram, X) or a direct video file URL (.mp4, .webm, .mov, .avi)" },
    ),
    // Optional max video height (px). When present, caps yt-dlp's format
    // selection to `<=maxHeight`; ABSENT keeps the "best" behaviour
    // byte-for-byte. The DEFAULT-to-1080p decision lives in the CLIENTS, not
    // here — the editor's Video URL node, Recast, Studio and VCP each send
    // their cap for a YouTube link. A non-number is rejected (strict body);
    // the value is clamped below.
    maxHeight: z.number().int().optional(),
    // Optional section fetch: both-or-neither, 0 <= start < end (seconds).
    // The provider pads the range ±3s before handing it to yt-dlp, because
    // --download-sections cuts at keyframes; the client does the exact trim.
    sectionStartSec: z.number().min(0, "sectionStartSec must be >= 0").optional(),
    sectionEndSec: z.number().min(0, "sectionEndSec must be >= 0").optional(),
    // `true` cuts the section exactly, with no pad: for a client that does not
    // trim the result (the editor's Video URL node). Absent keeps the padded
    // fetch every other client trims itself. Only with a section.
    exactSection: z.boolean().optional(),
    // Whether a download that arrives with NO audio stream fails. ABSENT means
    // TRUE — the behaviour every released client (Studio, Recast, the voice
    // changer) was built on, and the one that keeps Instagram's failover
    // working: a silent first attempt is retried through the proxy pool, which
    // sees the full format set. `false` is the editor's explicit second try,
    // offered only AFTER a no-audio failure — a genuinely silent clip is a
    // valid input to a video node, and there it must be importable. A
    // non-boolean is rejected: a truthy string must not switch the policy off.
    requireAudio: z.boolean().optional(),
  })
  .superRefine((body, ctx) => {
    const hasStart = body.sectionStartSec !== undefined
    const hasEnd = body.sectionEndSec !== undefined
    if (hasStart !== hasEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sectionStartSec and sectionEndSec must be provided together",
        path: [hasStart ? "sectionEndSec" : "sectionStartSec"],
      })
      return
    }
    if (body.exactSection !== undefined && !hasStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exactSection applies to a section: send sectionStartSec and sectionEndSec with it",
        path: ["exactSection"],
      })
      return
    }
    if (hasStart && hasEnd && body.sectionStartSec! >= body.sectionEndSec!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sectionStartSec must be less than sectionEndSec",
        path: ["sectionStartSec"],
      })
    }
  })

// The download itself (provider call, upload, poster, ownership row) and the
// account's running-download bookkeeping live in `lib/video-download.ts`, shared
// with the orchestrator's pre-run fetch (decided 2026-10-08): one downloader.
export { MAX_ACTIVE_DOWNLOADS_PER_USER }

export async function downloadVideoRoutes(app: FastifyInstance) {
  // POST /v1/download-video - Start download, return downloadId immediately
  app.post("/v1/download-video", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = downloadVideoBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: { code: "validation_error", ...formatZodError(parsed.error) },
      })
    }

    const userId = req.userId
    const { url, sectionStartSec, sectionEndSec, exactSection, maxHeight: rawMaxHeight, requireAudio } = parsed.data

    const isSocial = isAllowedSocialVideoUrl(url)
    if (!isSocial) {
      // Direct-file URL on an ARBITRARY host. yt-dlp does its own DNS+HTTP —
      // safeFetch's connect-time IP gate never sees this fetch — so pre-resolve
      // the host here and refuse private/reserved answers. Social hosts are
      // fixed, reputable domains and skip this.
      if (!(await resolvesOnlyToPublicAddresses(new URL(url).hostname))) {
        return reply.status(400).send({
          error: { code: "validation_error", message: "That address can't be fetched." },
        })
      }
    }
    // Clamp to a sane pixel range: 144p floor (anything smaller is unusable),
    // 8K ceiling. yt-dlp picks the best format under the cap; see
    // videoFormatSelector. Absent stays absent (unchanged "best" behaviour).
    const maxHeight =
      rawMaxHeight !== undefined ? Math.min(4320, Math.max(144, rawMaxHeight)) : undefined

    // Zod guarantees both-or-neither; collapse the pair into one value here so
    // everything downstream deals with a single optional section object.
    const section =
      sectionStartSec !== undefined && sectionEndSec !== undefined
        ? { startSec: sectionStartSec, endSec: sectionEndSec, ...(exactSection ? { exact: true } : {}) }
        : undefined

    // The account's download slot, across processes (a run's download in the
    // orchestrator counts here too). Taken last, with nothing that can fail
    // between it and the start, so a request that is refused for anything else
    // never holds one.
    const slot = await tryAcquireDownloadSlot(userId)
    if (!slot) {
      return reply.status(429).send({
        error: {
          code: "too_many_downloads",
          message: "Too many downloads are running — wait for one to finish and try again.",
        },
      })
    }

    // Start download in background. Direct files carry the 500MB cap; social
    // fetches pass none (unchanged). The slot is given back when it ends.
    const { downloadId } = startTrackedDownload(
      {
        url,
        userId,
        section,
        maxHeight,
        maxFilesizeBytes: isSocial ? undefined : DIRECT_FILE_MAX_BYTES,
        requireAudio: requireAudio ?? true,
      },
      slot,
    )

    return { downloadId }
  })

  // GET /v1/download-video/progress/:id - SSE stream for download progress
  app.get("/v1/download-video/progress/:id", async (req, reply) => {
    const { id } = req.params as { id: string }
    const state = activeDownloads.get(id)

    if (!state) {
      return reply.status(404).send({
        error: { code: "not_found", message: "Download not found or expired" },
      })
    }

    // Bypass Fastify's onSend hooks (we write to reply.raw directly), so
    // re-implement the CORS check that lib/sse.ts uses: only reflect the
    // Origin header when it's in the dynamic allowlist. Reflecting an
    // arbitrary origin would let any site that knows the downloadId UUID
    // read SSE progress events for another user's download.
    const corsHeaders: Record<string, string> = {}
    const originStr = firstHeaderValue(req.headers.origin)
    if (originStr && (await isOriginAllowedDynamic(originStr))) {
      corsHeaders["Access-Control-Allow-Origin"] = originStr
      corsHeaders["Access-Control-Allow-Credentials"] = "true"
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...corsHeaders,
    })

    const sendEvent = (data: Record<string, unknown>) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
    }

    // Send progress updates every 500ms
    const interval = setInterval(() => {
      const current = activeDownloads.get(id)
      if (!current) {
        sendEvent({ phase: "failed", percent: 0, error: "Download expired" })
        clearInterval(interval)
        reply.raw.end()
        return
      }

      sendEvent({
        phase: current.phase,
        percent: current.percent,
        videoUrl: current.videoUrl,
        thumbnailUrl: current.thumbnailUrl,
        error: current.error,
      })

      if (current.phase === "completed" || current.phase === "failed") {
        clearInterval(interval)
        reply.raw.end()
      }
    }, 500)

    // Handle client disconnect
    req.raw.on("close", () => {
      clearInterval(interval)
    })
  })
}
