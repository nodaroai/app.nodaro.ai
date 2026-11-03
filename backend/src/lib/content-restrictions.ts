/**
 * Content restrictions (migration 581): an administrator takes stored bytes
 * out of reach after a complaint, and lifts the restriction or not.
 *
 * A restriction is of the BYTES: the same object is named by the file's own
 * `assets` row, by the row the worker writes for a job's output, by a copy
 * another account saved, and by the job's `output_data`. The database
 * functions `restrict_content` and `lift_content_restriction` mark and
 * restore every one of those rows in one transaction each; this module reads
 * the named row for its keys and hash, calls them, and maps their refusals.
 *
 * Three things hold a restriction, none of them a reader's care:
 *  - the restrictive policies on `assets` and `jobs` (a logged-in browser
 *    reads both tables directly);
 *  - the backend's own reads, which filter `RESTRICTED_ASSET_COLUMN`
 *    (`asset-restricted-reads.test.ts` holds every user-facing `assets` read
 *    to it);
 *  - a restricted job's `output_data` and `held_output_data` moved to
 *    `restricted_output_data`, a column no grant names and no select lists,
 *    the way a held output is parked (`job-policy-gate.ts`), so every reader
 *    of outputs sees none. A job that is not finished is refused: its worker
 *    would write a fresh output over the restriction.
 * The byte proxies (`routes/download.ts`, `routes/image-proxy.ts`) ask
 * {@link isRestrictedAddress} as well, from a set of restricted keys refreshed
 * every minute. The bytes on the public CDN are a later change.
 */
import { supabase } from "./supabase.js"
import { config } from "./config.js"
import { r2KeyFromPublicUrl } from "./r2-public-key.js"
import { extractJobOutputs, isOwnedObjectKey } from "./job-policy-outputs.js"
import { restrictedKeyOfAddress } from "./content-restriction-address.js"
import { invalidateRestrictedSet, restrictedKeys } from "./content-restriction-set.js"
import { isEvidenceKey } from "./evidence-keys.js"
import { keysUserMayDelete } from "./key-ownership.js"
import { relocateRestrictedBytes, restoreRestrictedBytes, type RestrictionBytes } from "./content-restriction-bytes.js"

// The light halves, re-exported so every reader keeps one import.
export { restrictedKeyOfAddress, restrictedKeys, invalidateRestrictedSet }

export { RESTRICTED_ASSET_COLUMN, RESTRICTED_JOB_COLUMN } from "./content-restrictions-column.js"

export { RESTRICTED_SET_TTL_MS } from "./content-restriction-set.js"

/** A job may be restricted once its worker has nothing more to write. */
export const FINISHED_JOB_STATUSES: ReadonlySet<string> = new Set(["completed", "failed", "cancelled", "pending_review"])

export type ContentRestrictionErrorCode = "not_found" | "already_restricted" | "already_lifted" | "job_not_finished" | "unknown_complaint"

export class ContentRestrictionError extends Error {
  constructor(
    readonly code: ContentRestrictionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "ContentRestrictionError"
  }
}

export interface ContentRestriction {
  readonly id: string
  readonly assetId: string | null
  readonly jobId: string | null
  readonly r2Keys: readonly string[]
  readonly contentHash: string | null
  readonly assetIds: readonly string[]
  readonly jobIds: readonly string[]
  readonly sourceUrl: string | null
  readonly ownerUserId: string | null
  readonly reason: string
  readonly complaintId: string | null
  readonly restrictedBy: string | null
  readonly restrictedAt: string
  readonly liftedBy: string | null
  readonly liftedAt: string | null
  readonly liftReason: string | null
  /** What happened to the bytes (migration 583): each key's move, and the edge purge. */
  readonly bytes: RestrictionBytes
}

interface RestrictionRow {
  id: string
  asset_id: string | null
  job_id: string | null
  r2_keys: string[] | null
  content_hash: string | null
  asset_ids: string[] | null
  job_ids: string[] | null
  source_url: string | null
  owner_user_id: string | null
  reason: string
  complaint_id: string | null
  restricted_by: string | null
  restricted_at: string
  lifted_by: string | null
  lifted_at: string | null
  lift_reason: string | null
  bytes?: RestrictionBytes | null
}

const RESTRICTION_COLUMNS =
  "id, asset_id, job_id, r2_keys, content_hash, asset_ids, job_ids, source_url, owner_user_id, reason, complaint_id, restricted_by, restricted_at, lifted_by, lifted_at, lift_reason, bytes"

function toRestriction(row: RestrictionRow): ContentRestriction {
  return {
    id: row.id,
    assetId: row.asset_id,
    jobId: row.job_id,
    r2Keys: row.r2_keys ?? [],
    contentHash: row.content_hash,
    assetIds: row.asset_ids ?? [],
    jobIds: row.job_ids ?? [],
    sourceUrl: row.source_url,
    ownerUserId: row.owner_user_id,
    reason: row.reason,
    complaintId: row.complaint_id,
    restrictedBy: row.restricted_by,
    restrictedAt: row.restricted_at,
    liftedBy: row.lifted_by,
    liftedAt: row.lifted_at,
    liftReason: row.lift_reason,
    bytes: row.bytes ?? {},
  }
}

export interface RestrictInput {
  readonly reason: string
  readonly complaintId?: string | null
  readonly adminUserId: string | null
}

/** The database functions' refusals, by SQLSTATE, as this module's errors. */
function mapRpcError(error: { code?: string; message?: string }, what: "restrict" | "lift"): ContentRestrictionError | null {
  switch (error.code) {
    case "P0002":
      return new ContentRestrictionError("not_found", what === "restrict" ? "No such file or job" : "No such restriction")
    case "23505":
      return what === "restrict"
        ? new ContentRestrictionError("already_restricted", "The content is already restricted")
        : new ContentRestrictionError("already_lifted", "The restriction was lifted before")
    case "55P03":
      return new ContentRestrictionError("job_not_finished", "The job is not finished; restrict it once it is")
    case "23503":
      return new ContentRestrictionError("unknown_complaint", "No such complaint")
    default:
      return null
  }
}

function keysOf(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((k): k is string => typeof k === "string" && k.length > 0))]
}

interface RestrictTarget {
  assetId: string | null
  jobId: string | null
  keys: string[]
  contentHash: string | null
  sourceUrl: string | null
  ownerUserId: string | null
}

async function callRestrict(target: RestrictTarget, input: RestrictInput): Promise<ContentRestriction> {
  const { data, error } = await supabase.rpc("restrict_content", {
    p_asset_id: target.assetId,
    p_job_id: target.jobId,
    p_keys: target.keys,
    p_content_hash: target.contentHash,
    p_source_url: target.sourceUrl,
    p_owner_user_id: target.ownerUserId,
    p_reason: input.reason,
    p_complaint_id: input.complaintId ?? null,
    p_admin_user_id: input.adminUserId,
  })
  if (error) {
    const mapped = mapRpcError(error, "restrict")
    if (mapped) throw mapped
    throw new Error(`Restriction failed: ${error.message}`)
  }
  invalidateRestrictedSet()
  const restriction = toRestriction(data as RestrictionRow)
  await noteOnCase(restriction.complaintId, "content_restricted", input.adminUserId, {
    restrictionId: restriction.id,
    ...(target.assetId ? { assetId: target.assetId } : { jobId: target.jobId }),
  })
  // The rows are hidden; now the bytes: moved under the evidence prefix and
  // dropped from the edge, each outcome written on the record (never a
  // failure of the restriction that already happened).
  return relocateRestrictedBytes(restriction)
}

/**
 * Writes a restriction's step on the case it was made from, so the case's
 * log tells its whole story whichever screen or route restricted or lifted.
 * Best effort: the restriction has happened, and a log write that fails is
 * logged, never a failure of it. Loaded on demand: most readers of this
 * module never touch a case.
 */
async function noteOnCase(complaintId: string | null, kind: "content_restricted" | "restriction_lifted", adminUserId: string | null, data: Record<string, unknown>): Promise<void> {
  if (!complaintId) return
  try {
    const { recordComplaintEventQuietly } = await import("./rights-complaints.js")
    await recordComplaintEventQuietly(complaintId, kind, adminUserId ?? "system", data)
  } catch (e) {
    console.warn(`[content-restrictions] "${kind}" not written on case ${complaintId}:`, e instanceof Error ? e.message : e)
  }
}

/**
 * The file's thumbnail key, when the file's owner can be shown to own that
 * object (lib/key-ownership.ts). `metadata.thumbnail_url` is written by the
 * server for the uploads it makes thumbnails for, but a library save takes
 * its metadata from the caller: a key the owner does not own — another
 * account's file, one of the deployment's own — is not the restriction's to
 * mark, hide or move. A lookup that fails keeps the thumbnail out.
 */
async function ownedThumbnailKey(asset: { user_id: string | null; metadata: Record<string, unknown> | null }): Promise<string | null> {
  const thumb = asset.metadata?.thumbnail_url
  const key = typeof thumb === "string" ? r2KeyFromPublicUrl(thumb, config.R2_PUBLIC_URL) : null
  if (!key || !asset.user_id) return null
  try {
    return (await keysUserMayDelete(asset.user_id, [key])).has(key) ? key : null
  } catch (e) {
    console.warn(`[content-restrictions] the thumbnail's ownership could not be read; left out:`, e instanceof Error ? e.message : e)
    return null
  }
}

/**
 * Restricts a stored file and everything that names its bytes: its own row,
 * the rows of copies (by key and by hash), and the jobs whose output it is.
 */
export async function restrictAsset(assetId: string, input: RestrictInput): Promise<ContentRestriction> {
  // restricted-read: the restriction reads the row it restricts
  const { data, error } = await supabase
    .from("assets")
    .select("id, user_id, r2_key, content_hash, metadata, restricted_at")
    .eq("id", assetId)
    .maybeSingle()
  if (error) throw new Error(`Restriction read failed: ${error.message}`)
  if (!data) throw new ContentRestrictionError("not_found", "No such file")
  const asset = data as { id: string; user_id: string | null; r2_key: string | null; content_hash: string | null; metadata: Record<string, unknown> | null; restricted_at: string | null }
  if (asset.restricted_at) throw new ContentRestrictionError("already_restricted", "The file is already restricted")
  const sourceUrl = typeof asset.metadata?.source_url === "string" ? (asset.metadata.source_url as string) : null
  return callRestrict(
    {
      assetId: asset.id,
      jobId: null,
      keys: keysOf([asset.r2_key, await ownedThumbnailKey(asset)]),
      contentHash: asset.content_hash,
      sourceUrl,
      ownerUserId: asset.user_id,
    },
    input,
  )
}

/**
 * Restricts a job's output and everything that names its bytes: the job
 * (its output and held output moved aside), the rows the worker wrote for
 * the output, and copies of them. A job that is not finished is refused.
 */
export async function restrictJob(jobId: string, input: RestrictInput): Promise<ContentRestriction> {
  // trash-read: a restriction reaches a job in the Trash too, and reads the row it restricts
  const { data, error } = await supabase
    .from("jobs")
    .select("id, user_id, status, output_data, held_output_data, restricted_at")
    .eq("id", jobId)
    .maybeSingle()
  if (error) throw new Error(`Restriction read failed: ${error.message}`)
  if (!data) throw new ContentRestrictionError("not_found", "No such job")
  const job = data as {
    id: string
    user_id: string | null
    status: string
    output_data: Record<string, unknown> | null
    held_output_data: Record<string, unknown> | null
    restricted_at: string | null
  }
  if (job.restricted_at) throw new ContentRestrictionError("already_restricted", "The job is already restricted")
  if (!FINISHED_JOB_STATUSES.has(job.status)) throw new ContentRestrictionError("job_not_finished", "The job is not finished; restrict it once it is")
  // The job's OWN objects only: an output may repeat an input's address (a
  // pass-through), and that file is somebody else's to restrict.
  const outputs = [...extractJobOutputs(job.output_data), ...extractJobOutputs(job.held_output_data)]
  const keys = keysOf(outputs.map((o) => o.key)).filter((key) => isOwnedObjectKey(job.id, key))
  return callRestrict({ assetId: null, jobId: job.id, keys, contentHash: null, sourceUrl: null, ownerUserId: job.user_id }, input)
}

/** Lifts a restriction: the record says so, and every row it marked is restored to what it was. */
export async function liftRestriction(restrictionId: string, input: { reason: string | null; adminUserId: string | null }): Promise<ContentRestriction> {
  const { data, error } = await supabase.rpc("lift_content_restriction", {
    p_id: restrictionId,
    p_admin_user_id: input.adminUserId,
    p_reason: input.reason,
  })
  if (error) {
    const mapped = mapRpcError(error, "lift")
    if (mapped) throw mapped
    throw new Error(`Restriction lift failed: ${error.message}`)
  }
  invalidateRestrictedSet()
  const restriction = toRestriction(data as RestrictionRow)
  await noteOnCase(restriction.complaintId, "restriction_lifted", input.adminUserId, {
    restrictionId: restriction.id,
    ...(input.reason ? { reason: input.reason } : {}),
  })
  // The rows are back; now the bytes, moved back to their keys.
  return restoreRestrictedBytes(restriction)
}

/**
 * Finishes a restriction's bytes: the phase its current side calls for
 * (the move to evidence while it stands, the move back once lifted), run
 * again over the record. Idempotent; the administrator's "finish" action
 * and the reconcile sweep both come here.
 */
export async function finishRestrictionBytes(restrictionId: string): Promise<ContentRestriction> {
  const { data, error } = await supabase.from("content_restrictions").select(RESTRICTION_COLUMNS).eq("id", restrictionId).maybeSingle()
  if (error) throw new Error(`Restriction read failed: ${error.message}`)
  if (!data) throw new ContentRestrictionError("not_found", "No such restriction")
  const restriction = toRestriction(data as RestrictionRow)
  return restriction.liftedAt ? restoreRestrictedBytes(restriction) : relocateRestrictedBytes(restriction)
}

/** Every restriction, newest first; `active` keeps the unlifted ones only, `complaintId` the ones a case led to. */
export async function listRestrictions(opts: { active?: boolean; limit?: number; complaintId?: string } = {}): Promise<ContentRestriction[]> {
  let query = supabase.from("content_restrictions").select(RESTRICTION_COLUMNS).order("restricted_at", { ascending: false }).limit(opts.limit ?? 200)
  if (opts.active) query = query.is("lifted_at", null)
  if (opts.complaintId) query = query.eq("complaint_id", opts.complaintId)
  const { data, error } = await query
  if (error) throw new Error(`Restrictions read failed: ${error.message}`)
  return ((data ?? []) as RestrictionRow[]).map(toRestriction)
}

// ---------------------------------------------------------------------------
// The byte proxies' question: is this address restricted?

/**
 * Whether serving this address would serve restricted bytes. When the set
 * cannot be read and none was read before, the answer is "not restricted",
 * logged: the bytes are on a public CDN regardless, and a database hiccup
 * must not take every download down with it.
 */
export async function isRestrictedAddress(url: string): Promise<boolean> {
  const key = restrictedKeyOfAddress(url)
  if (!key) return false
  // The evidence copy of a restricted file (migration 583): refused here whatever the set says.
  if (isEvidenceKey(key)) return true
  try {
    return (await restrictedKeys()).has(key)
  } catch (e) {
    console.warn("[content-restrictions] restricted set unavailable; serving as unrestricted:", e instanceof Error ? e.message : e)
    return false
  }
}

export { __resetRestrictedSetForTests } from "./content-restriction-set.js"
