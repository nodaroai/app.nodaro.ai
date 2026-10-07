/**
 * The Preview label of a render recorded BEFORE it was stored (decided
 * 2026-10-05) — read from the job that made it, never written back.
 *
 * Renders made after A1b carry their `quality` ("proxy" is a Preview) in the
 * job's `output_data` and on the asset's `metadata`. Older ones carry neither,
 * so every reader of them showed no label. Two readers fill the gap, both by
 * the ONE rule — `jobRowStamp` (canvas-result-ids.ts; the worker's own label,
 * else the order's `input_data.quality`: "proxy" is a Preview, anything else
 * the final), the function migration 459 and the canvas reads already apply.
 * There is no second copy of it here.
 *
 *   - `fillJobRenderQuality` — for the job READ routes (the job-status
 *     endpoints the editor restores a result from, and the job detail / list
 *     the Executions tab shows). The response carries `output_data.quality`; the
 *     stored row is untouched.
 *   - `fillAssetRenderQuality` — for the library lists (My Library, the editor
 *     library, MCP `browse_uploads`). An Apply EDL file with no stored label
 *     takes it from the job that made it (`assets.job_id`): ONE batched lookup
 *     per page, and none when no file on the page needs one.
 *
 * Both return copies. Neither writes, and a failed lookup never fails the read:
 * the rows go out as stored.
 */
import { isRenderNodeType, RENDER_NODE_TYPE_IDS } from "@nodaro/shared"
import { supabase } from "./supabase.js"
import { jobFactsFromRow, jobFactsFromSelect, jobRowStamp } from "./canvas-result-ids.js"

/** The two columns a lean job read must add to its select for the fill, in the
 *  PostgREST alias form `JOB_FACTS_SELECT` uses. `fillJobRenderQuality` removes
 *  `input_quality` again (and `job_type` with `dropJobType`). */
export const ORDER_QUALITY_COLUMNS = "job_type, input_quality:input_data->>quality"

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v)

const hasLabel = (v: unknown): boolean => isRecord(v) && typeof v.quality === "string" && v.quality.length > 0

export interface FillJobOptions {
  /** The route did not select `job_type` for its caller: take it out again. */
  readonly dropJobType?: boolean
}

/**
 * A job row, as a read route hands it on: for a COMPLETED render job whose
 * `output_data` holds no `quality`, a copy with the label `jobRowStamp` gives it
 * from the order. The row is read from `job_type` + `input_data.quality` (full
 * rows) or the lean projection's `input_quality`; any other job is returned as
 * it came, bar the helper columns.
 */
export function fillJobRenderQuality<T extends object>(row: T, opts: FillJobOptions = {}): T {
  const r = row as Record<string, unknown>
  const { input_quality: inputQuality, ...rest } = r
  const base = opts.dropJobType ? (({ job_type: _jobType, ...kept }) => kept)(rest) : rest
  const hadHelpers = "input_quality" in r || (opts.dropJobType === true && "job_type" in r)

  const output = r.output_data
  const needsLabel =
    isRenderNodeType(r.job_type) && r.status === "completed" && isRecord(output) && !hasLabel(output)
  if (!needsLabel) return (hadHelpers ? base : row) as T

  const order = isRecord(r.input_data) ? r.input_data : { quality: inputQuality }
  const quality = jobRowStamp(
    jobFactsFromRow({ id: String(r.id), job_type: r.job_type, input_data: order, output_data: output }),
  ).quality
  if (!quality) return (hadHelpers ? base : row) as T
  return { ...base, output_data: { ...(output as Record<string, unknown>), quality } } as T
}

export function fillJobsRenderQuality<T extends object>(rows: readonly T[], opts: FillJobOptions = {}): T[] {
  return rows.map((row) => fillJobRenderQuality(row, opts))
}

/** The columns the library fallback reads from the jobs that made the files. */
const ASSET_JOB_SELECT = "id, job_type, input_quality:input_data->>quality, out_quality:output_data->>quality"

/** What a library list row needs for the fallback. */
export interface AssetLabelRow {
  readonly type?: unknown
  readonly job_id?: unknown
  readonly metadata?: unknown
}

/** Only a video or audio file can be a render (Apply EDL's output). */
const couldBeRender = (a: AssetLabelRow): a is AssetLabelRow & { job_id: string } =>
  (a.type === "video" || a.type === "audio") && typeof a.job_id === "string" && a.job_id.length > 0 && !hasLabel(a.metadata)

/**
 * A library page whose Apply EDL files carry the label they were made at. A file
 * with a stored `metadata.quality` keeps it; a video or audio file with a job and
 * no stored label has its job looked up — all of the page's in ONE query,
 * restricted to render jobs (RENDER_NODE_TYPES), and no query at all when no file needs one — and
 * takes `jobRowStamp`'s quality from it. A file with no job (`assets.job_id` is
 * `ON DELETE SET NULL`), or whose job is not a render, is left as stored.
 */
export async function fillAssetRenderQuality<T extends AssetLabelRow>(assets: readonly T[]): Promise<T[]> {
  const ids = [...new Set(assets.filter(couldBeRender).map((a) => a.job_id as string))]
  if (ids.length === 0) return [...assets]

  const { data, error } = await supabase
    .from("jobs")
    // tenant-scope-ignore: a shared library item's job belongs to another user; only the render label is read.
    .select(ASSET_JOB_SELECT)
    .in("id", ids)
    .in("job_type", [...RENDER_NODE_TYPE_IDS])
  if (error || !data) return [...assets]

  const qualityByJob = new Map<string, string>()
  for (const row of data as unknown as Array<Record<string, unknown>>) {
    const facts = jobFactsFromSelect(row)
    const quality = jobRowStamp(facts).quality
    if (quality) qualityByJob.set(facts.id, quality)
  }

  return assets.map((a) => {
    if (!couldBeRender(a)) return a
    const quality = qualityByJob.get(a.job_id)
    if (!quality) return a
    const metadata = isRecord(a.metadata) ? a.metadata : {}
    return { ...a, metadata: { ...metadata, quality } }
  })
}
