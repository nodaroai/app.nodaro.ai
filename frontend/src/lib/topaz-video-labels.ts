/**
 * How a Topaz video target reads on screen. The stored id stays as the server
 * takes it (`"4k"`); only the label is formatted ("4K"). Typed by the shared
 * union, so a new resolution without a label fails tsc.
 */
import type { TopazVideoResolution } from "@nodaro/shared/models"

export const TOPAZ_VIDEO_RESOLUTION_LABELS: Readonly<Record<TopazVideoResolution, string>> = {
  "720p": "720p",
  "1080p": "1080p",
  "4k": "4K",
}

/** The label of a stored resolution id; an unknown id shows as written. */
export function topazVideoResolutionLabel(id: string): string {
  return (TOPAZ_VIDEO_RESOLUTION_LABELS as Readonly<Record<string, string>>)[id] ?? id
}
