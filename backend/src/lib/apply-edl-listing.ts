/**
 * How an Apply EDL render lists in the media listings (decided 2026-10-06): the
 * owner's own gallery view, MCP `browse_gallery scope=mine` / `list_favorites`
 * and `list_jobs scope=mine`.
 *
 * Two facts the listings need that no allowlist can hold, so every listing reads
 * them here and none keeps its own copy:
 *
 *   - its MEDIUM. A render is a video or an audio file — the job's `output`
 *     picks — so the listing kind is decided per row, not per job type: what the
 *     finished output holds (`videoUrl` / `audioUrl`), and until it holds
 *     anything, what the order asks for (`input_data.output`).
 *   - its PREVIEW marker. A render made at proxy quality is a private 720p cut
 *     for review. A render recorded before its quality was stored carries none in
 *     `output_data`, so it is read from the order by the one rule every other
 *     reader uses (`fillJobRenderQuality` → `jobRowStamp`).
 *
 * Apply EDL is OWNER-ONLY in every listing: a Preview is `force_private`, but a
 * final by a user whose outputs are public is `is_public` too, and listing it in
 * a public view would expose it in a place it has never been. Each listing gates
 * on the owner, not on the quality.
 */
import { fillJobRenderQuality } from "./render-label-fill.js"
import { isPreviewRender } from "./preview-render.js"

export const APPLY_EDL_JOB = "apply-edl"

export type ApplyEdlMedium = "video" | "audio"

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)

const hasUrl = (v: unknown): boolean => typeof v === "string" && v.length > 0

export function applyEdlMedium(inputData: unknown, outputData: unknown): ApplyEdlMedium {
  if (isRecord(outputData)) {
    if (hasUrl(outputData.videoUrl)) return "video"
    if (hasUrl(outputData.audioUrl)) return "audio"
  }
  return isRecord(inputData) && inputData.output === "audio" ? "audio" : "video"
}

export interface ListedJobRow {
  readonly id?: unknown
  readonly job_type?: unknown
  readonly input_data?: unknown
  readonly output_data?: unknown
}

/** Whether a listed job is a Preview render. Only reads the row; never writes. */
export function isPreviewListing(row: ListedJobRow): boolean {
  if (row.job_type !== APPLY_EDL_JOB) return false
  const filled = fillJobRenderQuality({ ...row, id: String(row.id ?? ""), status: "completed" }) as { output_data?: unknown }
  const out = isRecord(filled.output_data) ? filled.output_data : null
  return isPreviewRender(APPLY_EDL_JOB, out?.quality)
}
