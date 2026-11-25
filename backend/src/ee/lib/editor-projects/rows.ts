import { supabase } from "../../../lib/supabase.js"

/**
 * Every database read and write of the editor-project routes (migration 703),
 * through the service client. A signed-in person's own rows are readable to
 * them INCLUDING soft-deleted ones, so every read here filters
 * `deleted_at is null` itself, and every one names the owner.
 *
 * Each function throws the database's error as it came (the routes map it in
 * one place, `errors.ts`: a missing table or function is 503 `not_available`,
 * a function's raise by its name).
 */

const PROJECTS = "editor_projects"
const VERSIONS = "editor_project_versions"

/** How long a claim lasts without its holder being seen (the database functions' rule). */
export const CLAIM_STALE_MS = 90_000

export interface ProjectSummary {
  id: string
  name: string
  updated_at: string
  size_bytes: number | null
  revision: number
}

export interface ProjectRow extends ProjectSummary {
  content_hash: string | null
  /** The key of the file in the private bucket holding the current content (null until first saved). */
  blob_key: string | null
  holder_id: string | null
  holder_seen_at: string | null
}

/** What a client is told about a version: never its key or its hash. */
export interface VersionSummary {
  number: number
  label: string
  author: string
  created_at: string
  size_bytes: number
  kind: "full" | "patch"
}

/** A version row as the version store works with it (never answered to a client). */
export interface VersionRecord {
  number: number
  label: string
  author: string
  kind: "full" | "patch"
  base_number: number | null
  content_hash: string
  size_bytes: number
  blob_key: string
}

const VERSION_COLUMNS = "number, label, author, kind, base_number, content_hash, size_bytes, blob_key"

const ROW_COLUMNS = "id, name, updated_at, size_bytes, revision, content_hash, blob_key, holder_id, holder_seen_at"

export async function listProjects(userId: string, limit: number): Promise<ProjectSummary[]> {
  const { data, error } = await supabase
    .from(PROJECTS)
    .select("id, name, updated_at, size_bytes, revision")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as ProjectSummary[]
}

/** How many live projects the person has (an exact count; no rows are read). */
export async function countLiveProjects(userId: string): Promise<number> {
  const { count, error } = await supabase.from(PROJECTS).select("id", { count: "exact", head: true }).eq("user_id", userId).is("deleted_at", null)
  if (error) throw error
  return count ?? 0
}

export async function createProject(userId: string, name: string): Promise<{ id: string; name: string; revision: number }> {
  const { data, error } = await supabase.from(PROJECTS).insert({ user_id: userId, name }).select("id, name, revision").single()
  if (error) throw error
  return data as { id: string; name: string; revision: number }
}

/** The caller's live project, or null. */
export async function readProject(userId: string, id: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from(PROJECTS)
    .select(ROW_COLUMNS)
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle()
  if (error) throw error
  return (data as ProjectRow | null) ?? null
}

/**
 * The version rows below read and write one project's versions by its id
 * alone (the table has no owner column): every caller has first read the
 * project as the caller's own live project.
 */

/** A project's versions for a client, newest first. */
export async function listVersions(projectId: string): Promise<VersionSummary[]> {
  const { data, error } = await supabase
    .from(VERSIONS)
    .select("number, label, author, created_at, size_bytes, kind")
    .eq("project_id", projectId)
    .order("number", { ascending: false })
  if (error) throw error
  return (data ?? []) as VersionSummary[]
}

/** Every version of a project, oldest first. */
export async function listVersionRecords(projectId: string): Promise<VersionRecord[]> {
  const { data, error } = await supabase
    .from(VERSIONS)
    .select(VERSION_COLUMNS)
    .eq("project_id", projectId)
    .order("number", { ascending: true })
  if (error) throw error
  return (data ?? []) as VersionRecord[]
}

export async function readVersionRecord(projectId: string, number: number): Promise<VersionRecord | null> {
  const { data, error } = await supabase.from(VERSIONS).select(VERSION_COLUMNS).eq("project_id", projectId).eq("number", number).maybeSingle()
  if (error) throw error
  return (data as VersionRecord | null) ?? null
}

/** The version whose file is `blobKey` (keys are never reused), or null. */
export async function findVersionByKey(projectId: string, blobKey: string): Promise<{ number: number } | null> {
  const { data, error } = await supabase.from(VERSIONS).select("number").eq("project_id", projectId).eq("blob_key", blobKey).maybeSingle()
  if (error) throw error
  return (data as { number: number } | null) ?? null
}

/** Inserts a version row. Throws the database's error as it came (a taken number is `23505`). */
export async function insertVersion(projectId: string, version: VersionRecord): Promise<void> {
  const { error } = await supabase.from(VERSIONS).insert({ project_id: projectId, ...version }).select("number").single()
  if (error) throw error
}

/** Deletes one version row: the key of the file it named, or null when there was no such row. */
export async function deleteVersion(projectId: string, number: number): Promise<{ blobKey: string } | null> {
  const { data, error } = await supabase.from(VERSIONS).delete().eq("project_id", projectId).eq("number", number).select("blob_key")
  if (error) throw error
  const row = (data ?? [])[0] as { blob_key: string } | undefined
  return row ? { blobKey: row.blob_key } : null
}

/** Deletes the version row naming `blobKey` (keys are never reused): whether there was one. */
export async function deleteVersionByKey(projectId: string, blobKey: string): Promise<boolean> {
  const { data, error } = await supabase.from(VERSIONS).delete().eq("project_id", projectId).eq("blob_key", blobKey).select("number")
  if (error) throw error
  return (data ?? []).length > 0
}

/** The keys of every version file of a project. */
export async function listVersionKeys(projectId: string): Promise<string[]> {
  const { data, error } = await supabase.from(VERSIONS).select("blob_key").eq("project_id", projectId)
  if (error) throw error
  return ((data ?? []) as Array<{ blob_key: string }>).map((r) => r.blob_key)
}

export async function renameProject(userId: string, id: string, name: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from(PROJECTS)
    .update({ name })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id, name")
    .maybeSingle()
  if (error) throw error
  return (data as { id: string; name: string } | null) ?? null
}

/** Soft-deletes the caller's live project: null when there was none, else the key of its file. */
export async function softDeleteProject(userId: string, id: string): Promise<{ blobKey: string | null } | null> {
  const { data, error } = await supabase
    .from(PROJECTS)
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .select("id, blob_key")
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { blobKey: (data as { blob_key: string | null }).blob_key ?? null }
}

/** Whether a tab holds the claim and was seen within the stale age. */
export function isHeld(row: Pick<ProjectRow, "holder_id" | "holder_seen_at">, now = Date.now()): boolean {
  if (!row.holder_id || !row.holder_seen_at) return false
  return Date.parse(row.holder_seen_at) >= now - CLAIM_STALE_MS
}

/**
 * The bytes of project files the person holds: their live projects' current
 * files plus every version of those projects (`editor_project_storage_bytes`,
 * migration 711). Throws the database's error as it came (a database without
 * the function yet: PGRST202 / 42883).
 */
export async function storageBytes(userId: string): Promise<number> {
  const { data, error } = await supabase.rpc("editor_project_storage_bytes", { p_user: userId })
  if (error) throw error
  return Number(data ?? 0)
}

export async function claimProject(userId: string, id: string, holder: string, takeover: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc("editor_project_claim", { p_id: id, p_user: userId, p_holder: holder, p_takeover: takeover })
  if (error) throw error
  return data === true
}

export async function releaseProject(userId: string, id: string, holder: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("editor_project_release", { p_id: id, p_user: userId, p_holder: holder })
  if (error) throw error
  return data === true
}

/**
 * Records a save for the holder: the content `hash` (`sizeBytes`) now in the
 * file `blobKey`. With `base`, the save is refused (`base_mismatch`) unless
 * `base` is the hash saved now. The database re-checks the claim under its
 * row lock and answers the key it replaced (null on a first save, or when
 * nothing was saved).
 */
export async function saveProject(args: {
  userId: string
  id: string
  holder: string
  hash: string
  sizeBytes: number
  blobKey: string
  base?: string
}): Promise<{ revision: number; saved: boolean; previousBlobKey: string | null }> {
  const { data, error } = await supabase.rpc("editor_project_save", {
    p_id: args.id,
    p_user: args.userId,
    p_holder: args.holder,
    p_hash: args.hash,
    p_size: args.sizeBytes,
    p_blob_key: args.blobKey,
    ...(args.base !== undefined ? { p_base: args.base } : {}),
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as { revision: number | string; saved: boolean; previous_blob_key: string | null } | undefined
  if (!row) throw new Error("editor_project_save returned no row")
  return { revision: Number(row.revision), saved: row.saved === true, previousBlobKey: row.previous_blob_key ?? null }
}
