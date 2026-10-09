/**
 * THE storage-delete funnel: delete, and record what storage did not delete
 * (decided 2026-10-08, rounds 11 and 12 of the expiry walk).
 *
 * Every path that deletes our storage objects — the retention reapers, the
 * user and admin permanent deletes, the community lifecycle, a worker's own
 * cleanup — used to drop a key whose delete failed: its row was already gone
 * or marked, so nothing would ever try that file again. Each path now deletes
 * through `deleteKeysRecordingFailures` / `deleteKeyRecordingFailure`, which
 * record each key storage did not confirm gone in `storage_delete_retries`
 * (migration 496): the key, the url that links it, the path that recorded it
 * (`source`) and, for a job's file, the job — no owner. The daily retry pass
 * (`lib/storage-delete-retries.ts`, every edition) tries again.
 *
 * `lib/__tests__/storage-delete-census.test.ts` fails the build when a raw
 * storage delete appears outside this funnel without a listed reason.
 *
 * STAGING: dev code runs on the shared database before `main` applies 496. A
 * missing table (42P01 / PGRST205) or column (42703 / PGRST204) means "not
 * recorded yet": the record logs and the caller carries on as before.
 *
 * Kept free of the retry's guards (asset-delete, key-ownership), which import
 * the paths that import this one.
 */
import { supabase } from "./supabase.js"
import { batchDeleteFromR2, deleteFromR2 } from "./storage.js"
import { config } from "./config.js"
import { isMissingColumnError, isMissingTableError } from "./postgrest-errors.js"
import { assertOrdinaryMediaKey } from "./retained-image-keys.js"

export const STORAGE_DELETE_RETRIES_TABLE = "storage_delete_retries"

/**
 * The path that recorded a failed delete. Free text in the database (a
 * lower-case slug, checked there), so a new path needs no migration; this
 * union is the list. "retention" is the free-user reaper and the
 * canceled-user wipe (every file they take: job outputs, library items,
 * location images). "asset" and "media" are the user's own deletes that
 * checked job links on their first try; the retry asks those one more guard
 * (`lib/storage-delete-retries.ts`).
 */
export type DeleteSource =
  | "retention"
  | "job-output"
  | "asset"
  | "location"
  | "creature"
  | "object"
  | "media"
  | "workflow"
  | "job-policy"
  | "admin-expunge"
  | "community"
  | "plugin"
  | "edl-checkpoint"
  | "character-training"
  | "job-scratch"

export interface FailedDelete {
  readonly key: string
  /** The url that links the file, blanked everywhere once it is gone; null when none is known. */
  readonly url: string | null
  readonly source: DeleteSource
  /** The job whose output named the file (provenance only). */
  readonly jobId: string | null
  /**
   * When the failed delete BEGAN, taken before the delete call. The retry
   * keeps an object storage wrote at or after it: a new object at a reused key.
   */
  readonly attemptedAt: Date
}

export interface RecordOptions {
  /** The url that links a key; defaults to its public url. */
  readonly urlOf?: (key: string) => string | null
  readonly jobIdOf?: (key: string) => string | null
  /**
   * "throw": a failed record write rejects, so a reaper leaves its rows
   * unmarked and deletes again next run. "log" (default): the caller has no
   * row to keep, so the failure is logged and the file is left as before.
   */
  readonly recordErrors?: "throw" | "log"
}

function notOnThisDatabase(error: { code?: string | null } | null | undefined): boolean {
  return isMissingTableError(error) || isMissingColumnError(error)
}

/** The public url of one of our keys (the inverse of `r2KeyFromUrl`), or null. */
export function publicUrlOfKey(key: string): string | null {
  return config.R2_PUBLIC_URL ? `${config.R2_PUBLIC_URL}/${key}` : null
}

/**
 * The keys of `requested` storage did not confirm gone, minus the ones it
 * keeps on purpose (`kept`: archived site assets, never deleted) — a retry
 * could never finish those.
 */
export function failedKeys(
  requested: readonly string[],
  result: { notDeleted?: readonly string[]; kept?: readonly string[] },
): string[] {
  const kept = new Set(result.kept ?? [])
  const failed = new Set((result.notDeleted ?? []).filter((k) => !kept.has(k)))
  return requested.filter((k) => failed.has(k))
}

/**
 * Whether storage's delete helpers would ever accept `key`. A retained image
 * or video key is refused outright (it has its own collection lane), so one
 * is never recorded: a retry could only fail on it.
 */
export function isRetryableDeleteKey(key: string): boolean {
  try {
    assertOrdinaryMediaKey(key)
    return true
  } catch {
    return false
  }
}

/** `FailedDelete`s for `keys`, linked by `urlOf` or their public url, whose delete began at `attemptedAt`. */
export function keyFailures(
  keys: readonly string[],
  source: DeleteSource,
  opts: RecordOptions,
  attemptedAt: Date,
): FailedDelete[] {
  return keys.map((key) => ({
    key,
    url: opts.urlOf ? opts.urlOf(key) : publicUrlOfKey(key),
    source,
    jobId: opts.jobIdOf?.(key) ?? null,
    attemptedAt,
  }))
}

/**
 * Records files a path failed to delete. A file already recorded gets its
 * record REFRESHED with the new failure's moment (`failed_at`), url, source
 * and job: it may be a new object at a reused key, which the retry must still
 * delete (independent review round). The retry's own bookkeeping — attempts,
 * last attempt, error and give-up — is never written here, so a re-record
 * keeps it (decided 2026-10-09): a key a sweep lists again every day still
 * gives up after `MAX_DELETE_RETRIES`, and a given-up key stays given up. A
 * new record takes the table's defaults (no attempts, not given up). Returns
 * `unavailable` when the database does not have the record yet (staging ahead
 * of `main`); throws on any other failure.
 */
export async function recordFailedDeletes(
  files: readonly FailedDelete[],
): Promise<{ recorded: number; unavailable: boolean }> {
  const byKey = new Map(files.filter((f) => isRetryableDeleteKey(f.key)).map((f) => [f.key, f]))
  if (byKey.size === 0) return { recorded: 0, unavailable: false }
  const rows = [...byKey.values()].map((f) => ({
    r2_key: f.key,
    url: f.url,
    source: f.source,
    job_id: f.jobId,
    failed_at: f.attemptedAt.toISOString(),
  }))
  const { error } = await supabase
    .from(STORAGE_DELETE_RETRIES_TABLE)
    .upsert(rows, { onConflict: "r2_key" })
  if (error) {
    if (notOnThisDatabase(error)) {
      console.warn(`[storage-delete] ${rows.length} failed delete(s) not recorded for retry (${STORAGE_DELETE_RETRIES_TABLE} is not on this database yet): ${rows.map((r) => r.r2_key).join(", ")}`)
      return { recorded: 0, unavailable: true }
    }
    throw new Error(`recording failed storage deletes failed${error.code ? ` (${error.code})` : ""}: ${error.message ?? "unknown error"}`)
  }
  return { recorded: rows.length, unavailable: false }
}

async function record(files: readonly FailedDelete[], opts: RecordOptions): Promise<void> {
  if (files.length === 0) return
  try {
    await recordFailedDeletes(files)
  } catch (err) {
    if (opts.recordErrors === "throw") throw err
    console.error(`[storage-delete] ${files.length} failed delete(s) could not be recorded for retry: ${files.map((f) => f.key).join(", ")}`, err)
  }
}

/**
 * `batchDeleteFromR2`, then each key storage did not confirm gone is recorded
 * for the retry pass. Returns the delete's result plus `failed` (the recorded
 * keys). A throwing delete (a malformed key) still throws, records nothing.
 */
export async function deleteKeysRecordingFailures(
  keys: readonly string[],
  source: DeleteSource,
  opts: RecordOptions = {},
): Promise<Awaited<ReturnType<typeof batchDeleteFromR2>> & { failed: string[] }> {
  const attemptedAt = new Date()
  const result = await batchDeleteFromR2([...keys])
  const failed = failedKeys(keys, result)
  await record(keyFailures(failed, source, opts, attemptedAt), opts)
  return { ...result, failed }
}

/**
 * `deleteFromR2` for one key: a failed delete is recorded for the retry pass
 * and then rethrown, so the caller's own handling is unchanged.
 */
export async function deleteKeyRecordingFailure(key: string, source: DeleteSource, opts: RecordOptions = {}): Promise<void> {
  const attemptedAt = new Date()
  try {
    await deleteFromR2(key)
  } catch (err) {
    await record(keyFailures([key], source, opts, attemptedAt), { ...opts, recordErrors: "log" })
    throw err
  }
}
