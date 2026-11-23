/**
 * The canvas results a view link may not show: the files of every result
 * whose job a share link would refuse to show (`shareRefusalOf`'s rules,
 * lib/share-links/shared-job.ts) — restricted, kept private (a Preview
 * render, work done privately: `force_private`, or the request's own private
 * flag), or whose prompt trips the content filter. A view link is public and
 * may be indexed, so it shows no more of a result than a share link of that
 * result would.
 *
 * Read by the result entries' own `jobId` (a canvas result carries the job
 * that made it), owner-scoped: a job id that is not the owner's, or no longer
 * exists, says nothing here, and its file is judged by its address alone
 * (`isRestrictedAddress`, project.ts).
 */
import { supabase } from "../supabase.js"
import { PRIVATE_INPUT_FLAGS, contentFiltered } from "../share-links/shared-job.js"

const JOB_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Ids per read (a URL-length bound for PostgREST's `in`). */
const CHUNK = 150

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

interface ResultEntry {
  readonly jobId: string
  readonly urls: readonly string[]
}

/** Every result entry of every node that names its job. */
function resultEntries(nodes: readonly unknown[]): ResultEntry[] {
  const out: ResultEntry[] = []
  for (const node of nodes) {
    const data = isRecord(node) && isRecord(node.data) ? node.data : null
    const results = data && Array.isArray(data.generatedResults) ? data.generatedResults : []
    for (const result of results) {
      if (!isRecord(result) || typeof result.jobId !== "string" || !JOB_ID_RE.test(result.jobId)) continue
      const urls = Object.values(result).filter((v): v is string => typeof v === "string" && /^https?:\/\//i.test(v))
      out.push({ jobId: result.jobId, urls })
    }
  }
  return out
}

interface JobRow {
  readonly id: string
  readonly input_data: unknown
  readonly restricted_at: string | null
  readonly force_private: boolean | null
}

function refused(row: JobRow): boolean {
  if (row.restricted_at || row.force_private === true) return true
  const input = isRecord(row.input_data) ? row.input_data : {}
  if (PRIVATE_INPUT_FLAGS.some((flag) => input[flag] === true)) return true
  return contentFiltered({ input_data: row.input_data })
}

/** The addresses of the owner's results a view may not show. Throws on a database error. */
export async function hiddenResultUrls(nodes: readonly unknown[], ownerId: string): Promise<ReadonlySet<string>> {
  const entries = resultEntries(nodes)
  const ids = [...new Set(entries.map((e) => e.jobId))]
  if (ids.length === 0) return new Set()
  const refusedIds = new Set<string>()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabase
      .from("jobs")
      // trash-read: a result on the canvas is shown whatever the Trash holds; this read only asks whether it may be.
      .select("id, input_data, restricted_at, force_private")
      .eq("user_id", ownerId)
      .in("id", ids.slice(i, i + CHUNK))
    if (error) throw new Error(`view link result read failed: ${error.message}`)
    for (const row of (Array.isArray(data) ? data : []) as JobRow[]) if (refused(row)) refusedIds.add(row.id)
  }
  return new Set(entries.filter((e) => refusedIds.has(e.jobId)).flatMap((e) => e.urls))
}
