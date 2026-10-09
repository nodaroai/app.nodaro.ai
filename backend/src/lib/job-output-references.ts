/**
 * Which job outputs name a url — any owner, at any depth (decided 2026-10-08).
 *
 * When a retention reaper (`ee/billing/cleanup-service.ts`) or the failed-
 * delete retry (`lib/storage-delete-retries.ts`) deletes a file, its link is
 * set to null in EVERY job output that names it, whoever owns the job — not
 * only in the batch being reaped — and nothing else in those outputs changes
 * (`blankUrlsInEveryJobOutput`). The database answers through migration 495's
 * index on the url strings an output holds (`job_output_urls`), so the
 * blanking never scans the jobs table. A reaper then marks its batch through
 * the same migration (`markJobOutputsCleaned`), on each row's current value.
 * The failed-delete retry asks the same index whether a job made since a
 * failed asset or media delete links the file (`urlsLinkedByJobsSince`).
 *
 * STAGING: dev code runs on the shared database before `main` applies 495. A
 * reaper asks `jobOutputBlankingAvailable` BEFORE it deletes anything and
 * skips its job-output pass when the functions are missing (the one probe
 * covers both: they arrive in the same migration). Deleting first would leave
 * links to files already gone. Every call here throws on a failed call; the
 * reaper then leaves its jobs unmarked, so the next run retries. Batched and
 * idempotent.
 */
import { supabase } from "./supabase.js"
import { isMissingFunctionError } from "./postgrest-errors.js"

/** Urls per call: bounds the request, and each call is one index probe. */
const URLS_PER_CALL = 100
/** Rows one blanking call rewrites at most. */
const ROWS_PER_CALL = 200
/**
 * Calls per chunk before giving up for this run. A url echoed in more outputs
 * than this covers is finished by the next run: the blanking is idempotent
 * and the reaper re-selects the jobs it did not mark.
 */
const MAX_CALLS_PER_CHUNK = 500

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function failure(what: string, error: { code?: string; message?: string }): Error {
  return new Error(`${what} failed${error.code ? ` (${error.code})` : ""}: ${error.message ?? "unknown error"}`)
}

/**
 * Sets every one of `urls` to null in every job output that names it, any
 * owner, any depth; returns how many rows changed. Each call rewrites at most
 * `ROWS_PER_CALL` rows and is repeated until a call changes fewer: a blanked
 * row no longer matches, so a re-run is a no-op. Throws on a failed call, or
 * when a chunk is still not done after `MAX_CALLS_PER_CHUNK` calls.
 */
export async function blankUrlsInEveryJobOutput(urls: readonly string[]): Promise<number> {
  let changed = 0
  for (const chunk of chunks([...new Set(urls)], URLS_PER_CALL)) {
    let calls = 0
    for (;;) {
      const { data, error } = await supabase.rpc("blank_job_output_urls", { p_urls: chunk, p_limit: ROWS_PER_CALL })
      if (error) throw failure("blank_job_output_urls", error)
      const n = typeof data === "number" ? data : 0
      changed += n
      if (n < ROWS_PER_CALL) break
      if (++calls >= MAX_CALLS_PER_CHUNK) {
        throw new Error(`blank_job_output_urls: outputs still name a deleted file after ${calls} calls; the next run continues`)
      }
    }
  }
  return changed
}

/**
 * Whether this database has migration 495's functions: an empty blanking
 * call, which matches no row. False when the function is missing (staging
 * ahead of `main`); throws on any other failure.
 */
export async function jobOutputBlankingAvailable(): Promise<boolean> {
  const { error } = await supabase.rpc("blank_job_output_urls", { p_urls: [], p_limit: 1 })
  if (!error) return true
  if (isMissingFunctionError(error)) return false
  throw failure("blank_job_output_urls", error)
}

/**
 * Marks a reaped batch `_cleaned`, with `deleted` (the urls of the files the
 * batch really deleted) nulled in each output, in ONE statement on each row's
 * current value: a link another path blanked since the batch was read stays
 * blanked. Returns how many rows changed; throws on a failed call.
 */
export async function markJobOutputsCleaned(ids: readonly string[], deleted: ReadonlySet<string>): Promise<number> {
  if (ids.length === 0) return 0
  const { data, error } = await supabase.rpc("mark_job_outputs_cleaned", { p_ids: [...ids], p_urls: [...deleted] })
  if (error) throw failure("mark_job_outputs_cleaned", error)
  return typeof data === "number" ? data : 0
}

/**
 * Which of `links`' urls a job output names whose job was created at or after
 * that url's own moment (`since`) — any owner, any depth, through the same
 * index (decided 2026-10-09). The failed-delete retry asks it before retrying
 * a failed asset or media delete: a job made after the failure that links
 * the file keeps it. Throws on a failed call (the function missing included), so the
 * retry deletes nothing it could not check.
 */
export async function urlsLinkedByJobsSince(
  links: ReadonlyArray<{ readonly url: string; readonly since: Date }>,
): Promise<Set<string>> {
  const linked = new Set<string>()
  for (const chunk of chunks(links, URLS_PER_CALL)) {
    const { data, error } = await supabase.rpc("urls_linked_by_jobs_since", {
      p_urls: chunk.map((l) => l.url),
      p_since: chunk.map((l) => l.since.toISOString()),
    })
    if (error) throw failure("urls_linked_by_jobs_since", error)
    for (const url of (data ?? []) as unknown[]) if (typeof url === "string") linked.add(url)
  }
  return linked
}
