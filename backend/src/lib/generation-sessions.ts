/**
 * Generation sessions — the shapes and reads `routes/generation-sessions.ts`
 * shares: the response mapping, the keyset cursors, the caller's-own-session
 * lookup and the list previews. Migration 518 holds the design notes.
 */
import type { FastifyRequest } from "fastify"
import { supabase } from "./supabase.js"
import { redactPrivateJobData } from "./public-job-data.js"

export const SESSION_COLS =
  "id, user_id, project_id, workspace_id, title, tool, created_at, updated_at, archived_at, cover_job_id"

/** The job columns a session feed returns, before `sanitizeJobForPublic`
 *  narrows them to the public allowlist. `parent_job_id` is read only to leave
 *  a child job out of a non-admin's feed (the allowlist drops it). */
export const SESSION_FEED_JOB_COLS =
  "id, status, progress, input_data, output_data, error_message, error_hint, created_at, started_at, completed_at, user_id, credits, job_type, source, source_detail, session_id, parent_job_id"

export const TOOL_RE = /^[a-z0-9][a-z0-9-]{0,39}$/

export interface SessionRow {
  id: string
  user_id: string
  project_id: string | null
  workspace_id: string | null
  title: string | null
  tool: string
  created_at: string
  updated_at: string
  archived_at: string | null
  /** The item a person picked to lead the previews (migration 532); null = automatic. */
  cover_job_id?: string | null
}

export interface SessionPreview {
  itemCount: number
  previewUrls: string[]
}

export function toSessionResponse(row: SessionRow, preview: SessionPreview) {
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    tool: row.tool,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    coverJobId: row.cover_job_id ?? null,
    itemCount: preview.itemCount,
    previewUrls: preview.previewUrls,
  }
}

/* ---------------------------------------------------------------- cursors */

/** A keyset position: a timestamp and the row id that breaks its ties. */
export interface Keyset {
  readonly at: string
  readonly id: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// The timestamp shape Postgres hands back, and nothing else: the value is
// interpolated into a PostgREST `or()` filter, and `Date.parse` alone accepts
// text in parentheses (a comment to V8) that would become filter syntax there.
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/

export function encodeCursor(k: Keyset): string {
  return Buffer.from(JSON.stringify([k.at, k.id]), "utf8").toString("base64url")
}

/** `null` for a cursor this server did not issue. */
export function decodeCursor(raw: string): Keyset | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))
    if (!Array.isArray(parsed) || parsed.length !== 2) return null
    const [at, id] = parsed
    if (typeof at !== "string" || !TIMESTAMP_RE.test(at) || Number.isNaN(Date.parse(at))) return null
    if (typeof id !== "string" || !UUID_RE.test(id)) return null
    return { at, id }
  } catch {
    return null
  }
}

/**
 * The PostgREST `or` filter for "strictly after `k`" in a newest-first
 * `(timeCol DESC, idCol DESC)` order. Ties on the timestamp are broken by the
 * id, so a page boundary inside a run of equal timestamps neither skips nor
 * repeats a row. Values are double-quoted (a timestamp carries `:` and `+`).
 */
export function afterKeyset(timeCol: string, idCol: string, k: Keyset): string {
  return `${timeCol}.lt."${k.at}",and(${timeCol}.eq."${k.at}",${idCol}.lt."${k.id}")`
}

/* ------------------------------------------------------- ownership lookup */

/**
 * The caller's own session, on the side of the workspace line the request is
 * on — the same rows `GET /v1/sessions` lists. `null` = 404 for the caller.
 */
export async function findOwnSession(
  req: FastifyRequest,
  userId: string,
  sessionId: string,
): Promise<{ data: SessionRow | null; error: unknown }> {
  let query = supabase
    .from("generation_sessions")
    .select(SESSION_COLS)
    .eq("id", sessionId)
    .eq("user_id", userId)
  query = req.workspaceId ? query.eq("workspace_id", req.workspaceId) : query.is("workspace_id", null)
  const { data, error } = await query.maybeSingle()
  return { data: (data as SessionRow | null) ?? null, error }
}

/** The caller's own project on the request's side of the workspace line. */
export async function ownsProjectHere(
  req: FastifyRequest,
  userId: string,
  projectId: string,
): Promise<{ owned: boolean; error: unknown }> {
  let query = supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", userId)
  query = req.workspaceId ? query.eq("workspace_id", req.workspaceId) : query.is("workspace_id", null)
  const { data, error } = await query.maybeSingle()
  return { owned: !!data, error }
}

/* --------------------------------------------------------------- previews */

/** The image links of one job's output, through the same redaction every
 *  public job read applies. Images only: a thumbnail, else the image itself. */
export function previewUrlOf(outputData: unknown): string | null {
  const out = redactPrivateJobData(outputData)
  if (!out || typeof out !== "object" || Array.isArray(out)) return null
  const o = out as Record<string, unknown>
  for (const key of ["thumbnailUrl", "imageUrl"] as const) {
    if (typeof o[key] === "string" && o[key]) return o[key] as string
  }
  if (Array.isArray(o.imageUrls) && typeof o.imageUrls[0] === "string") return o.imageUrls[0]
  return null
}

interface PreviewRow {
  session_id: string
  item_count: number | string
  recent: Array<{ job_id: string; output_data: unknown }> | null
}

/** One automatic preview: the job it came from and its image link. */
export interface PreviewEntry {
  readonly jobId: string
  readonly url: string
}

export const MAX_PREVIEWS = 4

/** A session's preview links: its cover's image first (when it has one), then
 *  the automatic ones without the cover, at most MAX_PREVIEWS. Pure. */
export function withCover(
  coverUrl: string | null,
  coverJobId: string | null,
  auto: readonly PreviewEntry[],
): string[] {
  if (!coverUrl) return auto.map((e) => e.url).slice(0, MAX_PREVIEWS)
  const rest = auto.filter((e) => e.jobId !== coverJobId).map((e) => e.url)
  return [coverUrl, ...rest].slice(0, MAX_PREVIEWS)
}

/** The cover images of a page of sessions — the caller's own jobs only. */
async function loadCoverUrls(
  userId: string,
  jobIds: readonly string[],
): Promise<{ data: Map<string, string>; error: unknown }> {
  const map = new Map<string, string>()
  if (jobIds.length === 0) return { data: map, error: null }
  const { data, error } = await supabase
    .from("jobs")
    .select("id, output_data")
    .in("id", [...new Set(jobIds)])
    .eq("user_id", userId)
    // Completed only, like the automatic previews: an unfinished cover just
    // leaves the automatic order in place until it has its image.
    .eq("status", "completed")
  if (error) return { data: map, error }
  for (const row of (data ?? []) as Array<{ id: string; output_data: unknown }>) {
    const url = previewUrlOf(row.output_data)
    if (url) map.set(row.id, url)
  }
  return { data: map, error: null }
}

/** Item counts and up to four preview links for a page of sessions: ONE call
 *  for the automatic previews (migration 518's `generation_session_previews`),
 *  plus one read of the covers when any session has one (migration 532). */
export async function loadPreviews(
  sessions: readonly Pick<SessionRow, "id" | "cover_job_id">[],
  userId: string,
): Promise<{ data: Map<string, SessionPreview>; error: unknown }> {
  const map = new Map<string, SessionPreview>()
  if (sessions.length === 0) return { data: map, error: null }
  // The two reads are independent: run them together.
  const [{ data, error }, covers] = await Promise.all([
    supabase.rpc("generation_session_previews", { p_session_ids: sessions.map((s) => s.id) }),
    loadCoverUrls(userId, sessions.flatMap((s) => (s.cover_job_id ? [s.cover_job_id] : []))),
  ])
  if (error) return { data: map, error }
  if (covers.error) return { data: map, error: covers.error }
  const coverOf = new Map(sessions.map((s) => [s.id, s.cover_job_id ?? null]))
  for (const row of (data ?? []) as PreviewRow[]) {
    const auto = (row.recent ?? []).flatMap((r) => {
      const url = previewUrlOf(r.output_data)
      return url ? [{ jobId: r.job_id, url }] : []
    })
    const coverJobId = coverOf.get(row.session_id) ?? null
    const coverUrl = coverJobId ? (covers.data.get(coverJobId) ?? null) : null
    map.set(row.session_id, {
      itemCount: Number(row.item_count) || 0,
      previewUrls: withCover(coverUrl, coverJobId, auto),
    })
  }
  return { data: map, error: null }
}

export const EMPTY_PREVIEW: SessionPreview = { itemCount: 0, previewUrls: [] }
