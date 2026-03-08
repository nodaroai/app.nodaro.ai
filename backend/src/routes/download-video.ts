import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { safeUrlSchema } from "../lib/url-validator.js"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { promises as fs } from "node:fs"
import { spawn } from "node:child_process"
import { uploadFileWithKeyToR2, uploadBufferToR2 } from "../lib/storage.js"

const SUPPORTED_HOSTNAMES = [
  "youtube.com", "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com", "x.com",
  "facebook.com", "fb.watch", "fb.com",
]

const downloadVideoBody = z.object({
  url: safeUrlSchema.refine(
    (url) => {
      try {
        const parsed = new URL(url)
        return SUPPORTED_HOSTNAMES.some((h) => parsed.hostname.includes(h))
      } catch {
        return false
      }
    },
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const isWindows = process.platform === "win32"
const YT_DLP_BIN = resolve(
  __dirname,
  `../../node_modules/youtube-dl-exec/bin/yt-dlp${isWindows ? ".exe" : ""}`,
)

function findVideoFile(baseName: string, expectedPath: string): Promise<string> {
  return fs.access(expectedPath).then(() => expectedPath).catch(async () => {
    const alternatives = [".mkv", ".webm", ".mov", ".avi", ".flv"]
    for (const ext of alternatives) {
      const altPath = join(tmpdir(), `${baseName}${ext}`)
      try {
        await fs.access(altPath)
        return altPath
      } catch {
        continue
      }
    }
    throw new Error("yt-dlp did not produce an output file")
  })
}

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

function isH264(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name",
      "-of", "csv=p=0",
      filePath,
    ], { stdio: ["ignore", "pipe", "pipe"] })

    let stdout = ""
    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.on("close", (code) => {
      resolve(code === 0 && stdout.trim() === "h264")
    })
    proc.on("error", () => resolve(false))
  })
}

function reencodeToH264(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", inputPath,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-y",
      outputPath,
    ], { stdio: ["ignore", "ignore", "pipe"] })

    let stderrBuf = ""
    proc.stderr.on("data", (chunk: Buffer) => { stderrBuf += chunk.toString() })
    proc.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg re-encode exited with code ${code}: ${stderrBuf.trim().split("\n").pop()}`))
    })
    proc.on("error", reject)
  })
}

function runDownloadWithProgress(
  downloadId: string,
  url: string,
  outputId: string,
  baseName: string,
  outputTemplate: string,
  expectedPath: string,
): void {
  const state = activeDownloads.get(downloadId)
  if (!state) return

  const args = [
    url,
    "--format", "mp4/best",
    "--output", outputTemplate,
    "--no-playlist",
    "--no-check-certificates",
    "--merge-output-format", "mp4",
    "--write-thumbnail",
    "--convert-thumbnails", "jpg",
    "--extractor-args", "youtube:player_client=android",
    "--add-header", "referer:youtube.com",
    "--add-header", "user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "--newline",
    "--progress-template", "download:%(progress._percent_str)s",
  ]

  const proc = spawn(YT_DLP_BIN, args, { stdio: ["ignore", "pipe", "pipe"] })

  let stderrBuf = ""

  proc.stdout.on("data", (chunk: Buffer) => {
    const lines = chunk.toString().split("\n")
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // Progress lines look like "download: 45.2%" or "download:  45.2%"
      const match = trimmed.match(/^download:\s*([\d.]+)%/)
      if (match) {
        const pct = parseFloat(match[1])
        if (!Number.isNaN(pct) && state.phase === "downloading") {
          state.percent = Math.min(Math.round(pct), 99)
        }
      }
    }
  })

  proc.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString()
  })

  proc.on("close", async (code) => {
    if (code !== 0) {
      const errMsg = stderrBuf.trim().split("\n").pop() || "yt-dlp exited with code " + code
      state.phase = "failed"
      state.error = errMsg
      cleanupFiles(baseName)
      // Auto-clean after 5 minutes
      setTimeout(() => activeDownloads.delete(downloadId), 5 * 60 * 1000)
      return
    }

    try {
      const actualPath = await findVideoFile(baseName, expectedPath)
      const stat = await fs.stat(actualPath)
      if (stat.size === 0) throw new Error("Downloaded video file is empty")

      // Re-encode to h264/aac if needed for downstream compatibility
      let uploadPath = actualPath
      const normalizedPath = join(tmpdir(), `normalized-${outputId}.mp4`)
      const alreadyH264 = await isH264(actualPath)
      if (!alreadyH264) {
        state.phase = "processing"
        state.percent = 90
        await reencodeToH264(actualPath, normalizedPath)
        await fs.unlink(actualPath).catch(() => {})
        uploadPath = normalizedPath
      }

      state.phase = "uploading"
      state.percent = 95

      const videoR2Url = await uploadFileWithKeyToR2(uploadPath, `videos/yt-${outputId}.mp4`, "video/mp4")
      await fs.unlink(uploadPath).catch(() => {})

      const thumbnailUrl = await findAndUploadThumbnail(baseName, outputId)

      state.phase = "completed"
      state.percent = 100
      state.videoUrl = videoR2Url
      state.thumbnailUrl = thumbnailUrl
    } catch (err) {
      state.phase = "failed"
      state.error = err instanceof Error ? err.message : "Upload failed"
      cleanupFiles(baseName)
    }

    // Auto-clean from map after 5 minutes
    setTimeout(() => activeDownloads.delete(downloadId), 5 * 60 * 1000)
  })
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
        error: {
          code: "validation_error",
          message: parsed.error.issues[0]?.message ?? "Invalid request",
        },
      })
    }

    const { url } = parsed.data
    const downloadId = randomUUID()
    const outputId = randomUUID()
    const baseName = `yt-video-${outputId}`
    const outputTemplate = join(tmpdir(), `${baseName}.%(ext)s`)
    const expectedPath = join(tmpdir(), `${baseName}.mp4`)

    const state: ActiveDownload = { percent: 0, phase: "downloading" }
    activeDownloads.set(downloadId, state)

    // Start download in background
    runDownloadWithProgress(downloadId, url, outputId, baseName, outputTemplate, expectedPath)

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

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
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
