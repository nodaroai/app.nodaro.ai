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
 *     span). Absent for a render of no plan clip;
 *   - `planBasis`: the plan value it cut (`renderReadBasis`), as the payload
 *     gave it — only when the render read the plan's own value (the same-run
 *     rule, `renderPlanBasis`). Absent = unknown;
 *   - `renderBasis`: its own settings and the effective sources of the cut
 *     (`effectiveRenderBasis`), stamped by the ingress that built the cut.
 * The shared `renderResultStamp` reads these back.
 */
import type { RenderQuality } from "@nodaro/shared"

/** What a `clipKey` on an Apply EDL request may be: `edlSpanKey` of a plan
 *  clip, `"<first inMs>-<last outMs>"` in integer ms. The REST route and the
 *  MCP verb validate against this one pattern. */
export const APPLY_EDL_CLIP_KEY_PATTERN = /^\d{1,12}-\d{1,12}$/

export interface ApplyEdlOutputParts {
  readonly medium: "video" | "audio"
  readonly mediaUrl: string
  readonly thumbnailUrl?: string
  /** The payload's quality; anything but "proxy" is the final. */
  readonly quality: unknown
  readonly clipKey?: unknown
  readonly planBasis?: unknown
  readonly renderBasis?: unknown
  readonly json?: unknown
}

const BASIS = /^[0-9a-f]{16}$/
const basisOf = (v: unknown): string | undefined => (typeof v === "string" && BASIS.test(v) ? v : undefined)

export function applyEdlOutputData(parts: ApplyEdlOutputParts): Record<string, unknown> {
  const quality: RenderQuality = parts.quality === "proxy" ? "proxy" : "final"
  const clipKey = typeof parts.clipKey === "string" && parts.clipKey.length > 0 ? parts.clipKey : undefined
  const planBasis = basisOf(parts.planBasis)
  const renderBasis = basisOf(parts.renderBasis)
  return {
    ...(parts.medium === "video"
      ? { videoUrl: parts.mediaUrl, ...(parts.thumbnailUrl ? { thumbnailUrl: parts.thumbnailUrl } : {}) }
      : { audioUrl: parts.mediaUrl }),
    quality,
    ...(clipKey ? { clipKey } : {}),
    ...(planBasis ? { planBasis } : {}),
    ...(renderBasis ? { renderBasis } : {}),
    ...(parts.json !== undefined ? { json: parts.json } : {}),
  }
}
