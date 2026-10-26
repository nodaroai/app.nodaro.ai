/**
 * `GET /v1/trash` — one newest-first page of the caller's Trash, on the
 * request's side of the workspace line (migration 561's `list_trash`): the
 * items removed from sessions, each with its session, and the deleted jobs,
 * each with when it is purged. A removed item whose job is also deleted is
 * listed once, as the deleted job. Restore and delete-for-good are the routes
 * of each kind (`POST /v1/sessions/:id/items/:jobId/restore`, `DELETE
 * …?forever=true`; `POST /v1/jobs/:id/restore`, `DELETE /v1/jobs/:id?forever=true`).
 */
import { supabase } from "./supabase.js"
import { SESSION_FEED_JOB_COLS, TOOL_RE } from "./generation-sessions.js"
import { CHILD_JOB_COLUMN, TRASHED_JOB_COLUMN } from "./public-job-data.js"
import { purgeAtOf } from "./job-trash.js"

export interface TrashQuery {
  readonly userId: string
  readonly workspaceId: string | null
  readonly tool?: string
  /** A project's id, or `"none"`. */
  readonly projectId?: string
  readonly types?: readonly string[]
  readonly limit: number
  readonly after: TrashCursor | null
}

export interface TrashCursor {
  readonly at: string
  readonly key: string
}

export interface TrashSession {
  readonly id: string
  readonly title: string | null
  readonly projectId: string | null
}

export type TrashEntry<J> =
  | { kind: "removed"; removedAt: string; session: TrashSession; job: J }
  | { kind: "deleted"; deletedAt: string; purgeAt: string; job: J }

interface TrashRow {
  kind: "removed" | "deleted"
  at: string
  job_id: string
  session_id: string | null
  sort_key: string
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
const KEY_RE = new RegExp(`^(r:${UUID}:${UUID}|d:${UUID})$`)
// The timestamp shape Postgres hands back (generation-sessions.ts's cursor rule).
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/

export function encodeTrashCursor(c: TrashCursor): string {
  return Buffer.from(JSON.stringify([c.at, c.key]), "utf8").toString("base64url")
}

/** `null` for a cursor this server did not issue. */
export function decodeTrashCursor(raw: string): TrashCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [at, key] = parsed
    if (typeof at !== "string" || !TIMESTAMP_RE.test(at) || Number.isNaN(Date.parse(at))) return null
    if (typeof key !== "string" || !KEY_RE.test(key)) return null
    return { at, key }
  } catch {
    return null
  }
}

export function isTrashTool(tool: string): boolean {
  return TOOL_RE.test(tool)
}

/**
 * One page of entries, jobs as the database holds them (the route sanitizes
 * them) — with the cursor of the next page, from the RAW page: an entry whose
 * job was purged meanwhile is dropped without ending the listing early.
 */
export async function listTrash<J = Record<string, unknown>>(
  q: TrashQuery,
): Promise<{ data: TrashEntry<J>[]; next: string | null; error: unknown }> {
  const noProject = q.projectId === "none"
  const { data, error } = await supabase.rpc("list_trash", {
    p_user_id: q.userId,
    p_workspace_id: q.workspaceId,
    p_tool: q.tool ?? null,
    p_project_id: q.projectId && !noProject ? q.projectId : null,
    p_no_project: noProject,
    p_types: q.types && q.types.length > 0 ? [...q.types] : null,
    p_before_at: q.after?.at ?? null,
    p_before_key: q.after?.key ?? null,
    p_limit: q.limit,
  })
  if (error) return { data: [], next: null, error }
  const rows = (data ?? []) as TrashRow[]
  if (rows.length === 0) return { data: [], next: null, error: null }

  const hydrated = await hydrateTrashRows<J>(rows, q.userId)
  if (hydrated.error) return { data: [], next: null, error: hydrated.error }
  const last = rows[rows.length - 1]!
  return {
    data: hydrated.entries,
    next: rows.length === q.limit ? encodeTrashCursor({ at: last.at, key: last.sort_key }) : null,
    error: null,
  }
}

/** A page of Trash rows as entries: each row's job and session, read as the
 *  owner's own in one read per table. A row whose job or session is gone
 *  (purged, deleted meanwhile) is left out. */
async function hydrateTrashRows<J>(
  rows: readonly TrashRow[],
  userId: string,
): Promise<{ entries: TrashEntry<J>[]; error: unknown }> {
  const jobIds = [...new Set(rows.map((r) => r.job_id))]
  const sessionIds = [...new Set(rows.flatMap((r) => (r.session_id ? [r.session_id] : [])))]
  const [jobs, sessions] = await Promise.all([
    supabase
      .from("jobs")
      // trash-read: the Trash listing reads deleted jobs on purpose.
      .select(`${SESSION_FEED_JOB_COLS}, ${TRASHED_JOB_COLUMN}`)
      .in("id", jobIds)
      .eq("user_id", userId)
      .is(CHILD_JOB_COLUMN, null),
    sessionIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("generation_sessions")
          .select("id, title, project_id")
          .in("id", sessionIds)
          .eq("user_id", userId),
  ])
  if (jobs.error) return { entries: [], error: jobs.error }
  if (sessions.error) return { entries: [], error: sessions.error }
  const jobOf = new Map(((jobs.data ?? []) as unknown as Array<Record<string, unknown>>).map((j) => [j.id as string, j as J]))
  const sessionOf = new Map(
    ((sessions.data ?? []) as Array<{ id: string; title: string | null; project_id: string | null }>).map((s) => [
      s.id,
      { id: s.id, title: s.title, projectId: s.project_id },
    ]),
  )

  const entries = rows.flatMap((r): TrashEntry<J>[] => {
    const job = jobOf.get(r.job_id)
    if (!job) return []
    if (r.kind === "deleted") return [{ kind: "deleted", deletedAt: r.at, purgeAt: purgeAtOf(r.at), job }]
    const session = r.session_id ? sessionOf.get(r.session_id) : undefined
    return session ? [{ kind: "removed", removedAt: r.at, session, job }] : []
  })
  return { entries, error: null }
}
