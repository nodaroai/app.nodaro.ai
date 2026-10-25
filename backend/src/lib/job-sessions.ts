/**
 * The sessions a page of jobs is in NOW — its live links (migration 561: a
 * removed link is in the Trash, not "in" the session) — for `GET /v1/jobs`'s
 * `withSessions` and MCP `list_jobs`'s `with_sessions`. One read for the page,
 * the owner's own links only; a link's session is the owner's by the 518 guard.
 */
import { supabase } from "./supabase.js"

export interface JobSessionRef {
  readonly id: string
  readonly title: string | null
  readonly projectId: string | null
}

interface LinkRow {
  job_id: string
  added_at: string
  session: { id: string; title: string | null; project_id: string | null } | Array<{ id: string; title: string | null; project_id: string | null }> | null
}

/** job id → its sessions, newest link first; a job in no session is absent from the map. */
export async function liveSessionsOfJobs(
  ownerId: string,
  jobIds: readonly string[],
): Promise<{ data: Map<string, JobSessionRef[]>; error: unknown }> {
  const map = new Map<string, JobSessionRef[]>()
  const ids = [...new Set(jobIds)]
  if (ids.length === 0) return { data: map, error: null }
  const { data, error } = await supabase
    .from("session_items")
    .select("job_id, added_at, session:generation_sessions!session_id(id, title, project_id)")
    .in("job_id", ids)
    .eq("user_id", ownerId)
    .is("removed_at", null)
    .order("added_at", { ascending: false })
  if (error) return { data: map, error }
  for (const row of (data ?? []) as unknown as LinkRow[]) {
    const s = Array.isArray(row.session) ? row.session[0] : row.session
    if (!s) continue
    const list = map.get(row.job_id) ?? []
    map.set(row.job_id, [...list, { id: s.id, title: s.title, projectId: s.project_id }])
  }
  return { data: map, error: null }
}
