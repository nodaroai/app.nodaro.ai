import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema, isAllowedSocialVideoUrl, isDirectVideoFileUrl } from "../lib/url-validator.js"
import { resolvesOnlyToPublicAddresses } from "../lib/safe-fetch.js"
import { thumbnailFromLocalVideo } from "../utils/thumbnail.js"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { uploadFileWithKeyToR2, uploadBufferToR2 } from "../lib/storage.js"
import { recordDownloadedVideoAsset } from "../lib/asset-records.js"
import { downloadYouTubeVideo } from "../providers/video/youtube-video.js"
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
    // selection to `<=maxHeight`; ABSENT keeps today's "best" behaviour
    // byte-for-byte (the platform's own youtube-video-node passes nothing, and
    // the DEFAULT-to-1080p decision lives in the VCP client, not here). A
    // non-number is rejected (strict body); the value is clamped below.
    maxHeight: z.number().int().optional(),
    // Optional section fetch: both-or-neither, 0 <= start < end (seconds).
    // The provider pads the range ±3s before handing it to yt-dlp, because
    // --download-sections cuts at keyframes; the client does the exact trim.
    sectionStartSec: z.number().min(0, "sectionStartSec must be >= 0").optional(),
    sectionEndSec: z.number().min(0, "sectionEndSec must be >= 0").optional(),
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
    if (hasStart && hasEnd && body.sectionStartSec! >= body.sectionEndSec!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sectionStartSec must be less than sectionEndSec",
        path: ["sectionStartSec"],
      })
    }
  })

/** Size cap for DIRECT-file downloads — parity with /v1/upload's and
 *  save-to-storage's 500MB video limit (file-validation SIZE_LIMITS.video).
 *  Social fetches stay uncapped: their sources are duration-bounded flows whose
 *  behavior must not change. */
const DIRECT_FILE_MAX_BYTES = 500 * 1024 * 1024

interface ActiveDownload {
  percent: number
  phase: "downloading" | "processing" | "uploading" | "completed" | "failed"
  videoUrl?: string
  thumbnailUrl?: string
  error?: string
}

const activeDownloads = new Map<string, ActiveDownload>()

async function findAndUploadThumbnail(baseName: string, outputId: string): Promise<string | undefined> {
  const thumbExtensions = [".jpg", ".webp", ".png"]
  for (const ext of thumbExtensions) {
    const thumbPath = join(tmpdir(), `${baseName}${ext}`)
    try {
      await fs.access(thumbPath)
      const thumbStat = await fs.stat(thumbPath)
      if (thumbStat.size > 0) {
        const thumbBuffer = await fs.readFile(thumbPath)
        const contentType = ext === ".jpg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "image/png"
        const thumbR2Key = `thumbnails/yt-${outputId}${ext}`
        const url = await uploadBufferToR2(thumbBuffer, thumbR2Key, contentType)
        await fs.unlink(thumbPath).catch(() => {})
        return url
      }
      await fs.unlink(thumbPath).catch(() => {})
    } catch {
      continue
    }
  }
  return undefined
}

function cleanupFiles(baseName: string): void {
  const videoExts = [".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv"]
  const thumbExts = [".jpg", ".webp", ".png"]
  for (const ext of [...videoExts, ...thumbExts]) {
    fs.unlink(join(tmpdir(), `${baseName}${ext}`)).catch(() => {})
  }
}

async function runDownloadWithProgress(
  downloadId: string,
  url: string,
  outputId: string,
  baseName: string,
  outPath: string,
  userId: string,
  section?: { startSec: number; endSec: number },
  maxHeight?: number,
  maxFilesizeBytes?: number,
): Promise<void> {
  const state = activeDownloads.get(downloadId)
  if (!state) return

  try {
    // Provider owns yt-dlp spawn + spoof + h264 normalize; we keep the SSE
    // progress map, fed by its callbacks. onProgress reports download percent;
    // onProcessingStart fires once when the h264 re-encode begins. For section
    // downloads yt-dlp's percents are jumpy — accepted, the map just relays them.
    await downloadYouTubeVideo({
      url,
      outPath,
      section,
      maxHeight,
      maxFilesizeBytes,
      // A voice changer can't use a silent clip — fail the import on a no-audio
      // download instead of ingesting/processing it (also avoids the re-encode's
      // "-c:a aac" crash). See assertAudioPresent.
      requireAudio: true,
      onProgress: (pct) => {
        if (state.phase === "downloading") {
          state.percent = Math.min(Math.round(pct), 99)
        }
      },
      onProcessingStart: () => {
        state.phase = "processing"
        state.percent = 90
      },
    })

    state.phase = "uploading"
    state.percent = 95

    const videoR2Key = `videos/yt-${outputId}.mp4`
    // Size taken BEFORE the upload path unlinks the file — it becomes the
    // assets row's size_bytes, which is exactly what the delete paths
    // (library.ts, media-process deleteSource) decrement by later.
    const videoSizeBytes = (await fs.stat(outPath)).size
    const videoR2Url = await uploadFileWithKeyToR2(outPath, videoR2Key, "video/mp4")

    // Sidecar thumbnail first (yt-dlp's --write-thumbnail); when the source had
    // none — a direct file URL never does, and some social fetches come back
    // bare — extract the file's own first frame while it is still on disk.
    // Nice-to-have semantics, same as /v1/upload: a poster failure logs and the
    // download proceeds without one.
    let thumbnailUrl = await findAndUploadThumbnail(baseName, outputId)
    if (!thumbnailUrl) {
      try {
        const poster = await thumbnailFromLocalVideo(outPath)
        thumbnailUrl = await uploadBufferToR2(poster, `thumbnails/yt-${outputId}.png`, "image/png")
      } catch (err) {
        console.warn(
          `[download-video] poster fallback failed: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    await fs.unlink(outPath).catch(() => {})

    // Ownership row + increment-only storage accounting — the same assets shape
    // /v1/upload and /v1/media/process insert. Without this row the downloaded
    // object is unowned and untracked: the ownership-gated deleteSource on
    // /v1/media/process could never clean it up, and its bytes never counted
    // toward the user's storage. Primary video object only — no thumbnail row
    // and no thumbnail byte tracking, matching the platform's delete paths
    // (which remove/decrement only the primary object + row).
    //
    // DELIBERATELY no reserve_storage_if_within_limit here: social imports have
    // never been quota-ENFORCED, and silently making them fail over-quota would
    // be an unauthorized product change. Increment-only accounting for now;
    // enforcement is an explicit future decision.
    //
    // Bookkeeping is best-effort: a failure must never fail a download whose
    // video already uploaded — the user keeps their video; it is merely unowned
    // (deleteSource will skip it), same as every pre-existing download.
    await recordDownloadedVideoAsset({
      userId,
      outputId,
      sizeBytes: videoSizeBytes,
      r2Key: videoR2Key,
      r2Url: videoR2Url,
      thumbnailUrl,
      sourceUrl: url,
    })

    state.phase = "completed"
    state.percent = 100
    state.videoUrl = videoR2Url
    state.thumbnailUrl = thumbnailUrl
  } catch (err) {
    state.phase = "failed"
    state.error = err instanceof Error ? err.message : "Download failed"
    // LOG IT. This ran in the background and only ever reported the failure to
    // the SSE client, so a broken downloader looked like silence server-side —
    // which is how a `spawn ... yt-dlp ENOENT` (the binary was missing from the
    // image entirely) survived unnoticed across every social-video path.
    console.error(`[download-video] ${downloadId} failed: ${state.error}`)
    cleanupFiles(baseName)
  }

  // Auto-clean from map after 5 minutes
  setTimeout(() => activeDownloads.delete(downloadId), 5 * 60 * 1000)
}

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
    const { url, sectionStartSec, sectionEndSec, maxHeight: rawMaxHeight } = parsed.data

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
    const downloadId = randomUUID()
    const outputId = randomUUID()
    const baseName = `yt-video-${outputId}`
    const outPath = join(tmpdir(), `${baseName}.mp4`)

    // Zod guarantees both-or-neither; collapse the pair into one value here so
    // everything downstream deals with a single optional section object.
    const section =
      sectionStartSec !== undefined && sectionEndSec !== undefined
        ? { startSec: sectionStartSec, endSec: sectionEndSec }
        : undefined

    const state: ActiveDownload = { percent: 0, phase: "downloading" }
    activeDownloads.set(downloadId, state)

    // Start download in background. Direct files carry the 500MB cap; social
    // fetches pass none (unchanged).
    void runDownloadWithProgress(
      downloadId, url, outputId, baseName, outPath, userId, section, maxHeight,
      isSocial ? undefined : DIRECT_FILE_MAX_BYTES,
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
