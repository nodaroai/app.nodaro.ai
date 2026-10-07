/**
 * How a render (any of `RENDER_NODE_TYPES` — Apply EDL today) lists in the media
 * listings (decided 2026-10-06): the owner's own gallery view, MCP
 * `browse_gallery scope=mine` / `list_favorites` and `list_jobs scope=mine`.
 *
 * Two facts the listings need that no allowlist can hold, so every listing reads
 * them here and none keeps its own copy:
 *
 *   - its MEDIUM. A render is a video or an audio file — the job's order picks —
 *     so the listing kind is decided per row, not per job type: what the
 *     finished output holds (`videoUrl` / `audioUrl`), and until it holds
 *     anything, what the order asks for (the registry's `mediumOf`).
 *   - its PREVIEW marker. A render made at proxy quality is a private 720p cut
 *     for review. A render recorded before its quality was stored carries none in
 *     `output_data`, so it is read from the order by the one rule every other
 *     reader uses (`fillJobRenderQuality` → `jobRowStamp`).
 *
 * A render whose descriptor says `ownerOnlyListing` (Apply EDL's does) lists in
 * its OWNER's views only: a Preview is `force_private`, but a final by a user
 * whose outputs are public is `is_public` too, and listing it in a public view
 * would expose it in a place it has never been. Each listing gates on the
 * owner, not on the quality.
 */
import { OWNER_ONLY_LISTING_RENDER_TYPES, isRenderNodeType, renderNodeOf, type RenderMedium } from "@nodaro/shared"
import { fillJobRenderQuality } from "./render-label-fill.js"
import { isPreviewRender } from "./preview-render.js"

/** The render job types every listing gates on the owner (from the registry). */
export const OWNER_ONLY_RENDER_JOBS: ReadonlySet<string> = new Set(OWNER_ONLY_LISTING_RENDER_TYPES)

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)

const hasUrl = (v: unknown): boolean => typeof v === "string" && v.length > 0

/** The kind a listed render job lists under; `undefined` for a job that is not
 *  a render. */
export function renderListingMedium(jobType: unknown, inputData: unknown, outputData: unknown): RenderMedium | undefined {
  const render = renderNodeOf(jobType)
  if (!render) return undefined
  if (isRecord(outputData)) {
    if (hasUrl(outputData.videoUrl)) return "video"
    if (hasUrl(outputData.audioUrl)) return "audio"
  }
  return render.mediumOf(isRecord(inputData) ? inputData : {})
}

export interface ListedJobRow {
  readonly id?: unknown
  readonly job_type?: unknown
  readonly input_data?: unknown
  readonly output_data?: unknown
}

/** Whether a listed job is a Preview render. Only reads the row; never writes. */
export function isPreviewListing(row: ListedJobRow): boolean {
  if (!isRenderNodeType(row.job_type)) return false
  const filled = fillJobRenderQuality({ ...row, id: String(row.id ?? ""), status: "completed" }) as { output_data?: unknown }
  const out = isRecord(filled.output_data) ? filled.output_data : null
  return isPreviewRender(row.job_type, out?.quality)
}
