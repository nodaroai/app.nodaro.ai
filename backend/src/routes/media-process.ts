import { FastifyInstance } from "fastify"
import { z } from "zod"
import { randomUUID } from "crypto"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { supabase } from "../lib/supabase.js"
import { uploadBufferToR2 } from "../lib/storage.js"
import { safeUrlSchema } from "../lib/url-validator.js"
import {
  downloadFile,
  runFfmpeg,
  runFfprobe,
  createWorkDir,
  cleanupWorkDir,
} from "../providers/video/ffmpeg-utils.js"

const MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
}

const MediaProcessSchema = z.object({
  sourceUrl: safeUrlSchema,
  type: z.enum(["video", "audio"]),
  crop: z
    .object({
      x: z.number().min(0),
      y: z.number().min(0),
      width: z.number().positive(),
      height: z.number().positive(),
    })
    .optional(),
  trim: z
    .object({
      startTime: z.number().min(0),
      endTime: z.number().positive(),
    })
    .refine((d) => d.endTime > d.startTime, {
      message: "endTime must be after startTime",
    })
    .optional(),
  format: z.enum(["mp4", "webm", "mp3", "wav", "m4a", "aac"]).optional(),
})

export async function mediaProcessRoutes(app: FastifyInstance) {
  app.post("/v1/media/process", async (req, reply) => {
    const userId = req.userId
    if (!userId) {
      return reply.status(401).send({
        error: { code: "unauthorized", message: "Authentication required" },
      })
    }

    const parsed = MediaProcessSchema.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: {
          code: "validation_error",
          message: parsed.error.errors.map((e) => e.message).join(", "),
        },
      })
    }

    const { sourceUrl, type, crop, trim, format } = parsed.data

    const inputExt = sourceUrl.split(".").pop()?.split("?")[0] ?? "mp4"
    const outputExt = format ?? inputExt
    const workDir = await createWorkDir("media-process")
    const inputPath = join(workDir, `input.${inputExt}`)
    const outputPath = join(workDir, `output.${outputExt}`)

    try {
      await downloadFile(sourceUrl, inputPath)

      const args: string[] = ["-y"]
      if (trim) {
        args.push("-ss", String(trim.startTime))
      }
      args.push("-i", inputPath)
      if (trim) {
        args.push("-t", String(trim.endTime - trim.startTime))
      }

      const vFilters: string[] = []
      if (crop && type === "video") {
        vFilters.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`)
      }
      if (vFilters.length > 0) {
        args.push("-vf", vFilters.join(","))
      }

      if (type === "video") {
        args.push("-c:v", "libx264", "-c:a", "aac", "-movflags", "+faststart")
      } else {
        const audioCodecs: Record<string, string[]> = {
          mp3: ["-c:a", "libmp3lame"],
          wav: ["-c:a", "pcm_s16le"],
        }
        args.push(...(audioCodecs[outputExt] ?? ["-c:a", "aac"]))
      }

      args.push(outputPath)

      await runFfmpeg(args, 300_000)

      const processedBuffer = await fs.readFile(outputPath)
      const fileId = randomUUID()
      const category = type === "video" ? "videos" : "audio"
      const r2Key = `uploads/${category}/${fileId}.${outputExt}`
      const mimeType = MIME_TYPES[outputExt] ?? "application/octet-stream"

      const publicUrl = await uploadBufferToR2(processedBuffer, r2Key, mimeType, userId)

      let thumbnailUrl: string | null = null
      if (type === "video") {
        try {
          const thumbPath = join(workDir, "thumb.png")
          await runFfmpeg([
            "-y", "-i", outputPath,
            "-ss", "0", "-frames:v", "1", "-vf", "scale=320:-1",
            thumbPath,
          ])
          const thumbBuffer = await fs.readFile(thumbPath)
          const thumbKey = `uploads/${category}/${fileId}_thumb.png`
          thumbnailUrl = await uploadBufferToR2(thumbBuffer, thumbKey, "image/png", userId)
        } catch {
          // Thumbnail generation is best-effort
        }
      }

      let metadata: Record<string, unknown> = {}
      try {
        const probeOutput = await runFfprobe([
          "-v", "quiet", "-print_format", "json",
          "-show_streams", "-show_format",
          outputPath,
        ])
        const probe = JSON.parse(probeOutput)
        const videoStream = probe.streams?.find(
          (s: { codec_type: string }) => s.codec_type === "video",
        )
        if (videoStream) {
          metadata.width = Number(videoStream.width)
          metadata.height = Number(videoStream.height)
        }
        if (probe.format?.duration) {
          metadata.durationSeconds = Number(probe.format.duration)
        }
      } catch {
        // Metadata extraction is best-effort
      }

      let assetId: string | null = null
      const { data: asset } = await supabase
        .from("assets")
        .insert({
          user_id: userId,
          type: type === "video" ? "video" : "audio",
          filename: `processed_${fileId}.${outputExt}`,
          mime_type: mimeType,
          size_bytes: processedBuffer.length,
          r2_key: r2Key,
          r2_url: publicUrl,
          upload_source: "media_process",
          metadata: { ...metadata, thumbnail_url: thumbnailUrl },
        })
        .select("id")
        .single()

      if (asset) assetId = asset.id

      return {
        data: {
          url: publicUrl,
          thumbnailUrl,
          assetId,
          metadata,
          sizeBytes: processedBuffer.length,
          mimeType,
        },
      }
    } finally {
      await cleanupWorkDir(workDir)
    }
  })
}
