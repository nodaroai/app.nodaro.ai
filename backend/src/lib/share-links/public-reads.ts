/**
 * What a live share link shows to anyone holding its token (migration 680).
 *
 * Read with the service role, by the token alone — that IS what a share link
 * is — and scoped to the link's owner on every row, so a link can only ever
 * show its owner's own item. What the link shows is decided again on every
 * read, by the same rule as turning it on (`shared-job.ts`): a job moved to
 * the Trash, restricted, or kept private stops showing at once, and a removed
 * session item, a deleted session or project, or one moved into a workspace
 * reads as not found.
 */
import { GALLERY_BLOCKED_WORDS } from "../../config/content-filter.js"
import { supabase } from "../supabase.js"
import { CHILD_JOB_COLUMN } from "../public-job-data.js"
import { RESTRICTED_JOB_COLUMN } from "../content-restrictions-column.js"
import { noteTitleColumnError, titleSelect } from "../jobs-title-column.js"
import { FEED_LIVE_JOB_FILTER, afterKeyset, decodeCursor, encodeCursor, previewUrlOf, type Keyset } from "../generation-sessions.js"
import { findOwnerJob, isRestrictedAddress, jobShareRefusal } from "./job-reads.js"
import { SHARE_JOB_COLUMNS, toSharedJob, type ShareJobRow } from "./shared-job.js"
import { isShareableAddress } from "./settings.js"
import type { PublicShare, SharedJob, SharedProjectSession, ShareLinkRow } from "./types.js"

/** The most sessions a shared project lists (its most recently active ones). */
export const MAX_PROJECT_SESSIONS = 200

interface SessionMeta {
  readonly id: string
  readonly title: string | null
  readonly tool: string | null
  readonly created_at: string
}

/** One of the owner's personal sessions; with `projectId`, only a live (unarchived) session of that project. */
export async function ownerSession(ownerId: string, sessionId: string, projectId?: string): Promise<SessionMeta | null> {
  let query = supabase
    .from("generation_sessions")
    .select("id, title, tool, created_at")
    .eq("id", sessionId)
    .eq("user_id", ownerId)
    .is("workspace_id", null)
  if (projectId) query = query.eq("project_id", projectId).is("archived_at", null)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`share session read failed: ${error.message}`)
  return (data as SessionMeta | null) ?? null
}

/** The owner's personal project, or null. */
async function ownerProject(ownerId: string, projectId: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .eq("user_id", ownerId)
    .is("workspace_id", null)
    .maybeSingle()
  if (error) throw new Error(`share project read failed: ${error.message}`)
  return (data as { id: string; name: string } | null) ?? null
}

interface SummaryRow {
  readonly session_id: string
  readonly item_count: number | string
  readonly recent: Array<{ job_id: string; output_data: unknown }> | null
}

/**
 * How many results each session's link shows, and its cover: the cover the
 * owner picked when it is shown, else its newest shown image. One call for a
 * page of sessions (`share_link_session_summaries`, which applies the same
 * rule as a single job, the content filter's words passed in).
 */
export async function sessionSummaries(ids: readonly string[]): Promise<Map<string, { itemCount: number; coverUrl: string | null }>> {
  const map = new Map<string, { itemCount: number; coverUrl: string | null }>()
  if (ids.length === 0) return map
  const { data, error } = await supabase.rpc("share_link_session_summaries", {
    p_session_ids: [...ids],
    p_blocked_words: [...GALLERY_BLOCKED_WORDS],
  })
  if (error) throw new Error(`share session summaries failed: ${error.message}`)
  for (const row of (data ?? []) as SummaryRow[]) {
    const coverUrl =
      (row.recent ?? [])
        .map((r) => previewUrlOf(r.output_data))
        .find((url): url is string => !!url && isShareableAddress(url) && !isRestrictedAddress(url)) ?? null
    map.set(row.session_id, { itemCount: Number(row.item_count) || 0, coverUrl })
  }
  return map
}

/** What the link shows at the top of its page, or null (its item is gone or may not be shown). */
export async function readPublicShare(share: ShareLinkRow): Promise<PublicShare | null> {
  const base = { kind: share.kind, allowCopy: share.allow_copy === true }
  if (share.kind === "job") {
    const row = await findOwnerJob(share.owner_id, share.target_id)
    const job = row ? sharedJobOf(row, base.allowCopy) : null
    return job ? { ...base, job } : null
  }
  if (share.kind === "session") {
    const session = await ownerSession(share.owner_id, share.target_id)
    if (!session) return null
    const summary = (await sessionSummaries([session.id])).get(session.id)
    return {
      ...base,
      session: { title: session.title, tool: session.tool, createdAt: session.created_at, itemCount: summary?.itemCount ?? 0 },
    }
  }
  const project = await ownerProject(share.owner_id, share.target_id)
  if (!project) return null
  const { data, error } = await supabase
    .from("generation_sessions")
    .select("id, title, tool")
    .eq("project_id", project.id)
    .eq("user_id", share.owner_id)
    .is("workspace_id", null)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MAX_PROJECT_SESSIONS)
  if (error) throw new Error(`share project sessions read failed: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; title: string | null; tool: string | null }>
  const summaries = await sessionSummaries(rows.map((r) => r.id))
  // A session with nothing the link may show is left out: an empty card says nothing.
  const sessions: SharedProjectSession[] = rows.flatMap((r) => {
    const s = summaries.get(r.id)
    return s && s.itemCount > 0 ? [{ id: r.id, title: r.title, tool: r.tool, itemCount: s.itemCount, coverUrl: s.coverUrl }] : []
  })
  return { ...base, project: { name: project.name, sessions } }
}

/** A job as the link shows it, or null when it may not be shown now. */
export function sharedJobOf(row: ShareJobRow, allowCopy: boolean): SharedJob | null {
  if (jobShareRefusal(row)) return null
  return toSharedJob(row, { allowCopy, withoutReference: isRestrictedAddress })
}

export interface ItemsQuery {
  readonly sessionId?: string
  readonly cursor?: string
  readonly limit: number
}

export type ItemsAnswer =
  | { readonly ok: true; readonly data: SharedJob[]; readonly nextCursor: string | null }
  | { readonly ok: false; readonly status: 400 | 404; readonly code: string; readonly message: string }

const NOT_FOUND: ItemsAnswer = { ok: false, status: 404, code: "not_found", message: "Shared link not found" }

/** Which session a link's items come from, or why none. */
async function itemsSession(share: ShareLinkRow, sessionId: string | undefined): Promise<string | ItemsAnswer> {
  if (share.kind === "job") return NOT_FOUND
  if (share.kind === "session") {
    if (sessionId && sessionId !== share.target_id) return NOT_FOUND
    return (await ownerSession(share.owner_id, share.target_id)) ? share.target_id : NOT_FOUND
  }
  if (!sessionId) return { ok: false, status: 400, code: "validation_error", message: "sessionId is required for a shared project" }
  // The project must still be the owner's personal one, and the session one of its live sessions.
  if (!(await ownerProject(share.owner_id, share.target_id))) return NOT_FOUND
  return (await ownerSession(share.owner_id, sessionId, share.target_id)) ? sessionId : NOT_FOUND
}

interface ItemRow {
  readonly job_id: string
  readonly added_at: string
  readonly job: ShareJobRow | ShareJobRow[] | null
}

async function itemRows(ownerId: string, sessionId: string, batch: number, after: Keyset | null): Promise<ItemRow[]> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let query = supabase
      .from("session_items")
      // `!inner` + the job filters: an item whose job is in the Trash, unfinished,
      // a child step, restricted or kept private is no row at all.
      .select(`job_id, added_at, job:jobs!job_id!inner(${SHARE_JOB_COLUMNS}${titleSelect()})`)
      .eq("session_id", sessionId)
      .eq("user_id", ownerId)
      .is("removed_at", null)
      .is(FEED_LIVE_JOB_FILTER, null)
      .eq("job.user_id", ownerId)
      .eq("job.status", "completed")
      .is(`job.${CHILD_JOB_COLUMN}`, null)
      .is(`job.${RESTRICTED_JOB_COLUMN}`, null)
      .not("job.force_private", "is", true)
    if (after) query = query.or(afterKeyset("added_at", "job_id", after))
    const { data, error } = await query.order("added_at", { ascending: false }).order("job_id", { ascending: false }).limit(batch)
    if (!error) return (data ?? []) as unknown as ItemRow[]
    if (attempt === 0 && noteTitleColumnError(error)) continue
    throw new Error(`share items read failed: ${error.message}`)
  }
  return []
}

/** How many rows one read of a session's items takes, at least. */
const ITEMS_BATCH = 50
/** How many reads one page may take to find what it shows. */
const ITEMS_MAX_READS = 5

/**
 * One page of a session's results, newest first. Rows the link may not show
 * (the content filter, restricted bytes, no media) are skipped, and the page
 * reads on until it holds `limit` results, up to `ITEMS_MAX_READS` reads. The
 * cursor is always the position of the last result SHOWN, never of a row left
 * out, so walking the pages reveals nothing about what is hidden. A page may
 * hold fewer than `limit`; follow `nextCursor` until it is null.
 */
export async function readPublicItems(share: ShareLinkRow, q: ItemsQuery): Promise<ItemsAnswer> {
  const start = q.cursor ? decodeCursor(q.cursor) : null
  if (q.cursor && !start) return { ok: false, status: 400, code: "validation_error", message: "Invalid cursor" }
  const session = await itemsSession(share, q.sessionId)
  if (typeof session !== "string") return session
  const allowCopy = share.allow_copy === true
  const batch = Math.max(q.limit, ITEMS_BATCH)
  const data: SharedJob[] = []
  let lastShown: Keyset | null = null
  let after = start
  let more = false
  for (let read = 0; read < ITEMS_MAX_READS && data.length < q.limit; read++) {
    const rows = await itemRows(share.owner_id, session, batch, after)
    for (const r of rows) {
      const job = Array.isArray(r.job) ? r.job[0] : r.job
      const shown = job ? sharedJobOf(job, allowCopy) : null
      if (!shown) continue
      data.push(shown)
      lastShown = { at: r.added_at, id: r.job_id }
      if (data.length === q.limit) break
    }
    const last = rows[rows.length - 1]
    more = rows.length === batch
    if (!more || !last) break
    after = { at: last.added_at, id: last.job_id }
  }
  // A full page may have more after it; a short one has more only when the reads ran out first.
  const nextCursor = lastShown && (data.length === q.limit || more) ? encodeCursor(lastShown) : null
  return { ok: true, data, nextCursor }
}
