import { FastifyInstance } from "fastify"
import { z } from "zod"
import { randomUUID } from "crypto"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { supabase } from "../lib/supabase.js"
import { uploadBufferToR2, deleteFromR2, r2KeyFromOurUrl } from "../lib/storage.js"
import { updateStorageUsage } from "../utils/file-validation.js"
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

/** Allowed on-disk extensions — kept in lockstep with MIME_TYPES (single source of truth). */
const ALLOWED_MEDIA_EXT = new Set(Object.keys(MIME_TYPES))

/**
 * Derive a filesystem-safe extension from an attacker-controllable source URL.
 * The extension is only used to name a temp file under a server-owned workDir, but
 * clamping it to a known allowlist removes any path-shaping input entirely (defense
 * in depth — mirrors the regex-allowlist pattern in providers/kie/video.ts).
 */
export function safeMediaExt(url: string, fallback: string): string {
  const raw = url.split("?")[0].split(".").pop()?.toLowerCase() ?? ""
  return ALLOWED_MEDIA_EXT.has(raw) ? raw : fallback
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
  // "The cut replaces the original": after processing succeeds and the output
  // is uploaded, best-effort delete the SOURCE object from R2 (only when it is
  // our bucket AND the requester provably owns it via an assets row).
  deleteSource: z.boolean().optional().default(false),
})

/**
 * Best-effort source cleanup for `deleteSource: true` — the caller has declared
 * "the processed output replaces the original". Runs only AFTER the new output
 * is fully uploaded and the response payload is built, and NEVER throws: a
 * delete problem must not fail a request whose real work already succeeded.
 *
 * Mirrors the platform's canonical asset delete, DELETE /v1/library/:id
 * ?permanent=true (routes/library.ts):
 *   1. Bucket gate — only objects in OUR R2 bucket (`r2KeyFromOurUrl`); foreign
 *      URLs are silently skipped.
 *   2. Ownership gate — the requesting user must positively own the object via
 *      an `assets` row (user_id + r2_key). /v1/upload, this route's own outputs
 *      and /v1/library/save-generated all create such rows. No row, or someone
 *      else's row → skip with a warn.
 *   3. Referrer safety — the R2 object is removed only when NO other assets row
 *      and NO job output references it (content-addressed safety: R2 objects
 *      are unrecoverable, see library.ts). Lookup errors fail safe toward
 *      keeping data.
 *   4. The user's asset row is deleted and their tracked storage decremented by
 *      the row's size_bytes — the same way the quota was charged at upload.
 *      (Like library.ts, no thumbnail-object chase: the existing delete path
 *      removes only the primary object + row.)
 *
 * Exported for testability.
 */
export async function deleteSourceAfterProcess(sourceUrl: string, userId: string): Promise<void> {
  try {
    const sourceKey = r2KeyFromOurUrl(sourceUrl)
    if (!sourceKey) return // foreign URL — not our bucket, nothing to delete

    const { data: owned, error: ownedError } = await supabase
      .from("assets")
      .select("id, user_id, r2_key, size_bytes")
      .eq("r2_key", sourceKey)
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle()

    if (ownedError || !owned) {
      console.warn(
        `[media-process] deleteSource skipped for ${sourceKey}: ` +
          (ownedError
            ? `ownership lookup failed (${ownedError.message})`
            : "no asset record establishes the requester's ownership"),
      )
      return
    }

    // Content-addressed safety (same checks as library.ts): another assets row
    // (e.g. saved from the gallery by another user) or one of the user's job
    // outputs may point at the SAME object — deleting it would permanently
    // break them. Any lookup error counts as "a referrer may exist".
    const { count: otherAssetRefs, error: assetRefError } = await supabase
      .from("assets")
      .select("id", { count: "exact", head: true })
      .eq("r2_key", sourceKey)
      .neq("id", owned.id)
    const assetRefsExist = !!assetRefError || (!!otherAssetRefs && otherAssetRefs > 0)

    let jobRefsExist = false
    if (!assetRefsExist) {
      // One .eq() per output_data key — never a hand-built .or() string; the
      // URL's reserved chars corrupt an unquoted PostgREST filter (library.ts).
      for (const key of ["imageUrl", "videoUrl", "audioUrl"] as const) {
        const { count, error } = await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq(`output_data->>${key}`, sourceUrl)
        if (error || (count ?? 0) > 0) {
          jobRefsExist = true
          break
        }
      }
    }

    if (!assetRefsExist && !jobRefsExist) {
      try {
        await deleteFromR2(sourceKey)
      } catch (err) {
        // Object survives; continue to the record cleanup like library.ts does.
        console.warn(`[media-process] deleteSource R2 delete failed for ${sourceKey} (continuing):`, err)
      }
    } else {
      console.warn(
        `[media-process] deleteSource kept R2 object ${sourceKey}: other asset/job referrers exist`,
      )
    }

    const { error: rowError } = await supabase.from("assets").delete().eq("id", owned.id).eq("user_id", userId)
    if (rowError) {
      // Row survives → its quota charge must survive with it; skip the decrement.
      console.warn(`[media-process] deleteSource failed to delete asset row ${owned.id}: ${rowError.message}`)
      return
    }

    const sizeBytes = owned.size_bytes ?? 0
    if (sizeBytes > 0) {
      await updateStorageUsage(userId, -sizeBytes).catch((err) => {
        console.warn("[media-process] deleteSource storage decrement failed:", err)
      })
    }
  } catch (err) {
    console.warn("[media-process] deleteSource failed (response unaffected):", err)
  }
}

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
          message: parsed.error.issues.map((e) => e.message).join(", "),
        },
      })
    }

    const { sourceUrl, type, crop, trim, format, deleteSource } = parsed.data

    const inputExt = safeMediaExt(sourceUrl, type === "video" ? "mp4" : "mp3")
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

      const responsePayload = {
        data: {
          url: publicUrl,
          thumbnailUrl,
          assetId,
          metadata,
          sizeBytes: processedBuffer.length,
          mimeType,
        },
      }

      // Best-effort housekeeping, strictly AFTER the new output is uploaded and
      // the response payload is built. The helper never throws, so a delete
      // problem can never turn a successful process into a failed request.
      if (deleteSource) {
        await deleteSourceAfterProcess(sourceUrl, userId)
      }

      return responsePayload
    } finally {
      await cleanupWorkDir(workDir)
    }
  })
}
