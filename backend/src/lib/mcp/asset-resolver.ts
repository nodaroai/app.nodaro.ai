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
 * Resolve a Nodaro asset id to the URL of its media.
 *
 * Looks up `jobs` first (generations) and falls back to `assets` (uploads)
 * — this lets MCP verbs accept BOTH a generated job's id and an uploaded
 * asset's id under the same `*_asset_id` parameter, so users can pipe a
 * `browse_uploads` result straight into modify_image / animate_image / etc.
 *
 * v1.1 MCP verbs also accept a direct URL (`image_url` / `video_url`); the
 * resolver returns null for null/empty input so callers can `??` the URL.
 *
 * Per-user enforcement: jobs and assets are both scoped by `user_id`;
 * caller can only resolve their own ids. Media-kind validation: jobs use
 * `job_type` (mapped via the type sets above) and assets use `type`
 * (`image|video|audio` directly).
 */
export async function resolveAssetId(opts: ResolveOpts): Promise<string | null> {
  const { assetId, userId, expectedKind } = opts
  if (!assetId || assetId.length === 0) return null

  // 1. Try jobs (generations) first — most common case for v1.1 verbs.
  const jobResult = await supabase
    .from("jobs")
    .select("id, user_id, job_type, output_data")
    .eq("id", assetId)
    .maybeSingle()
  if (jobResult.error) throw new Error(`Failed to resolve asset: ${jobResult.error.message}`)
  if (jobResult.data) {
    const job = jobResult.data
    if (job.user_id !== userId) {
      throw new Error("forbidden: asset belongs to a different user")
    }
    const expected =
      expectedKind === "image"
        ? IMAGE_TYPES
        : expectedKind === "video"
          ? VIDEO_TYPES
          : AUDIO_TYPES
    const jobType = job.job_type as string | null
    if (!jobType || !expected.has(jobType)) {
      throw new Error(`expected ${expectedKind}, got job of type ${jobType ?? "unknown"}`)
    }
    const outputData = (job.output_data ?? {}) as Record<string, unknown>
    const urlField =
      expectedKind === "image" ? "imageUrl" : expectedKind === "video" ? "videoUrl" : "audioUrl"
    const url = outputData[urlField]
    if (typeof url !== "string" || url.length === 0) {
      throw new Error(`Asset ${assetId} has no ${urlField} yet`)
    }
    return url
  }

  // 2. Fall back to assets (uploads). The `assets.type` column stores the
  // media kind directly (image / video / audio) — no job_type mapping
  // needed. The R2 url is on `r2_url`.
  const assetResult = await supabase
    .from("assets")
    .select("id, user_id, type, r2_url")
    .eq("id", assetId)
    .maybeSingle()
  if (assetResult.error) {
    throw new Error(`Failed to resolve asset: ${assetResult.error.message}`)
  }
  if (!assetResult.data) {
    throw new Error(`Asset ${assetId} not found`)
  }
  const asset = assetResult.data
  if (asset.user_id !== userId) {
    throw new Error("forbidden: asset belongs to a different user")
  }
  const assetKind = asset.type as string | null
  if (assetKind !== expectedKind) {
    throw new Error(`expected ${expectedKind}, got upload of type ${assetKind ?? "unknown"}`)
  }
  const r2Url = asset.r2_url as string | null
  if (!r2Url) {
    throw new Error(`Asset ${assetId} has no url`)
  }
  return r2Url
}
