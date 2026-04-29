import { supabase } from "../supabase.js"

interface ResolveOpts {
  assetId: string | null | undefined
  userId: string
  expectedKind: "image" | "video" | "audio"
}

/**
 * Job names that produce an IMAGE in `output_data.imageUrl`.
 * Mirrors `IMAGE_JOBS` in `routes/gallery.ts` plus generators (character/
 * location/object) that the MCP plan exposes via image_asset_id, plus
 * `extract-frame` (FFmpeg job that emits an imageUrl).
 */
const IMAGE_TYPES = new Set<string>([
  "generate-image",
  "edit-image",
  "image-to-image",
  "generate-character",
  "generate-character-asset",
  "generate-object",
  "generate-object-asset",
  "generate-location",
  "generate-location-asset",
  "extract-frame",
])

/**
 * Job names that produce a VIDEO in `output_data.videoUrl`.
 * Includes generation, editing, and FFmpeg post-processing jobs that
 * v1.1 verbs accept as `video_asset_id`.
 */
const VIDEO_TYPES = new Set<string>([
  "image-to-video",
  "text-to-video",
  "video-to-video",
  "lip-sync",
  "motion-transfer",
  "extend-video",
  "combine-videos",
  "add-captions",
  "video-upscale",
  "merge-video-audio",
  "resize-video",
  "trim-video",
  "fade-video",
  "loop-video",
  "transcode-video",
  "speech-to-video",
])

/**
 * Job names that produce an AUDIO file in `output_data.audioUrl`.
 */
const AUDIO_TYPES = new Set<string>([
  "text-to-speech",
  "generate-music",
  "text-to-audio",
  "suno-generate",
  "suno-cover",
  "suno-extend",
  "text-to-dialogue",
  "voice-changer",
  "dubbing",
  "voice-remix",
  "voice-design",
  "audio-isolation",
  "trim-audio",
  "mix-audio",
  "combine-audio",
  "extract-youtube-audio",
])

/**
 * Resolve a Nodaro `jobs.id` to the URL of its output media.
 *
 * v1.1 MCP verbs accept either a direct URL (`image_url` / `video_url`)
 * OR a Nodaro asset id (`image_asset_id` / `video_asset_id`). When given
 * an asset id we look up the job, enforce per-user ownership, validate
 * the media kind matches what the verb expects, and return the output URL.
 *
 * Returns `null` for null/empty input so callers can `??` the URL field.
 *
 * Schema notes (matches actual `jobs` table, not the spec stub):
 * - `job_type` is set by the worker when it picks up the job (BullMQ job
 *   name). For completed jobs it's always populated.
 * - `output_data` is JSONB keyed by media kind: `imageUrl` / `videoUrl` /
 *   `audioUrl`. There is no scalar `output_url` column.
 */
export async function resolveAssetId(opts: ResolveOpts): Promise<string | null> {
  const { assetId, userId, expectedKind } = opts
  if (!assetId || assetId.length === 0) return null

  const { data, error } = await supabase
    .from("jobs")
    .select("id, user_id, job_type, output_data")
    .eq("id", assetId)
    .maybeSingle()

  if (error) throw new Error(`Failed to resolve asset: ${error.message}`)
  if (!data) throw new Error(`Asset ${assetId} not found`)
  if (data.user_id !== userId) {
    throw new Error("forbidden: asset belongs to a different user")
  }

  const expected =
    expectedKind === "image"
      ? IMAGE_TYPES
      : expectedKind === "video"
        ? VIDEO_TYPES
        : AUDIO_TYPES

  const jobType = data.job_type as string | null
  if (!jobType || !expected.has(jobType)) {
    throw new Error(`expected ${expectedKind}, got job of type ${jobType ?? "unknown"}`)
  }

  const outputData = (data.output_data ?? {}) as Record<string, unknown>
  const urlField =
    expectedKind === "image" ? "imageUrl" : expectedKind === "video" ? "videoUrl" : "audioUrl"
  const url = outputData[urlField]
  if (typeof url !== "string" || url.length === 0) {
    throw new Error(`Asset ${assetId} has no ${urlField} yet`)
  }
  return url
}
