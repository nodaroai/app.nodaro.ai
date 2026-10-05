/**
 * The `output_data` of a finished Apply EDL render — the one shape the worker
 * writes and every lane reads.
 *
 * Beside the cut (`videoUrl` + `thumbnailUrl`, or `audioUrl`) and the remapped
 * Transcript (`json`), it carries the render's identity (A1b):
 *   - `quality`: "proxy" (a Preview) or "final" — ALWAYS written, so a result is
 *     labelled from what it is, never from the node's current setting (a Render
 *     final runs with a one-shot override while the node keeps Preview);
 *   - `clipKey`: the plan clip it cut (`edlSpanKey`), exactly as the payload
 *     gave it — taken at payload build from the Edit Plan row the iteration
 *     read, never from the rendered EDL (Camera Switch can shrink a clip's outer
 *     span). Absent for a render of no plan clip.
 * The shared `renderResultStamp` reads these two back.
 */
import type { RenderQuality } from "@nodaro/shared"

export interface ApplyEdlOutputParts {
  readonly medium: "video" | "audio"
  readonly mediaUrl: string
  readonly thumbnailUrl?: string
  /** The payload's quality; anything but "proxy" is the final. */
  readonly quality: unknown
  readonly clipKey?: unknown
  readonly json?: unknown
}

export function applyEdlOutputData(parts: ApplyEdlOutputParts): Record<string, unknown> {
  const quality: RenderQuality = parts.quality === "proxy" ? "proxy" : "final"
  const clipKey = typeof parts.clipKey === "string" && parts.clipKey.length > 0 ? parts.clipKey : undefined
  return {
    ...(parts.medium === "video"
      ? { videoUrl: parts.mediaUrl, ...(parts.thumbnailUrl ? { thumbnailUrl: parts.thumbnailUrl } : {}) }
      : { audioUrl: parts.mediaUrl }),
    quality,
    ...(clipKey ? { clipKey } : {}),
    ...(parts.json !== undefined ? { json: parts.json } : {}),
  }
}
