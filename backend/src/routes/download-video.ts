import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema, isAllowedSocialVideoUrl } from "../lib/url-validator.js"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { uploadFileWithKeyToR2, uploadBufferToR2 } from "../lib/storage.js"
import { downloadYouTubeVideo } from "../providers/video/youtube-video.js"
import { formatZodError } from "../lib/zod-error.js"
import { isOriginAllowedDynamic } from "../lib/dynamic-origins.js"
import { firstHeaderValue } from "../lib/request-helpers.js"

const downloadVideoBody = z.object({
  url: safeUrlSchema.refine(
    (url) => isAllowedSocialVideoUrl(url),
    { message: "Must be a valid video URL (YouTube, Facebook, TikTok, Instagram, or X)" },
  ),
})

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
): Promise<void> {
  const state = activeDownloads.get(downloadId)
  if (!state) return

  try {
    // Provider owns yt-dlp spawn + spoof + h264 normalize; we keep the SSE
    // progress map, fed by its callbacks. onProgress reports download percent;
    // onProcessingStart fires once when the h264 re-encode begins.
    await downloadYouTubeVideo({
      url,
      outPath,
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

    const videoR2Url = await uploadFileWithKeyToR2(outPath, `videos/yt-${outputId}.mp4`, "video/mp4")
    await fs.unlink(outPath).catch(() => {})

    const thumbnailUrl = await findAndUploadThumbnail(baseName, outputId)

    state.phase = "completed"
    state.percent = 100
    state.videoUrl = videoR2Url
    state.thumbnailUrl = thumbnailUrl
  } catch (err) {
    state.phase = "failed"
    state.error = err instanceof Error ? err.message : "Download failed"
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

    const { url } = parsed.data
    const downloadId = randomUUID()
    const outputId = randomUUID()
    const baseName = `yt-video-${outputId}`
    const outPath = join(tmpdir(), `${baseName}.mp4`)

    const state: ActiveDownload = { percent: 0, phase: "downloading" }
    activeDownloads.set(downloadId, state)

    // Start download in background
    void runDownloadWithProgress(downloadId, url, outputId, baseName, outPath)

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
