/**
 * How a Video Upscale target reads on screen. The stored id stays as the server
 * takes it (`"4k"`, `"2k"`); only the label is formatted ("4K", "2K"). Typed by
 * the shared unions, so a new resolution without a label fails tsc.
 */
import type { TopazVideoResolution } from "@nodaro/shared/models"
import type { VideoUpscaleResolution } from "@nodaro/shared/model-catalog"

/** Every Video Upscale target's label (Topaz's short sides, Nodaro Video Upscale's boxes). */
export const VIDEO_UPSCALE_RESOLUTION_LABELS: Readonly<Record<VideoUpscaleResolution, string>> = {
  "720p": "720p",
  "1080p": "1080p",
  "2k": "2K",
  "4k": "4K",
}

export const TOPAZ_VIDEO_RESOLUTION_LABELS: Readonly<Record<TopazVideoResolution, string>> = {
  "720p": VIDEO_UPSCALE_RESOLUTION_LABELS["720p"],
  "1080p": VIDEO_UPSCALE_RESOLUTION_LABELS["1080p"],
  "4k": VIDEO_UPSCALE_RESOLUTION_LABELS["4k"],
}

/** The label of a stored resolution id; an unknown id shows as written. */
export function topazVideoResolutionLabel(id: string): string {
  return (VIDEO_UPSCALE_RESOLUTION_LABELS as Readonly<Record<string, string>>)[id] ?? id
}
