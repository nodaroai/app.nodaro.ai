/**
 * The retry pass for storage deletes that failed (decided 2026-10-08, rounds
 * 11 and 12 of the expiry walk).
 *
 * Every path that deletes our storage objects records each key storage did
 * not confirm gone in `storage_delete_retries` (migration 496) through the
 * funnel in `lib/storage-delete.ts`. This pass — every edition, once a day
 * (`startStorageDeleteRetry`, started in `server.ts`) — tries each again, at
 * most `MAX_DELETE_RETRIES` times, then logs the key and gives up. A file's
 * link stays in every job output until storage confirms the delete; only then
 * is it blanked everywhere (`blankUrlsInEveryJobOutput`).
 *
 * The retry asks the guards again before it deletes, and stricter than the
 * first try: between the two the link was live, so ANY library row now naming
 * the key keeps the file (`keysHeldByOtherLibraryRows` with no row counted as
 * the file's own — a row that names it is cleaned up by its own path, which
 * deletes the file then), and a relay target's object is never ours to delete
 * (`deletableKeys`). A file one of them holds is left alone and its record is
 * dropped, as is a key storage would refuse outright.
 *
 * A failed delete from a path that checked job links on its first try asks
 * one more (decided 2026-10-09): a job created after the failure began whose
 * output links the file keeps it, and the record is dropped
 * (`urlsLinkedByJobsSince`, the same "links" the blanking would clear). Those
 * paths are the user's own deletes (`GUARDED_BY_NEWER_JOB_LINKS`): `source`
 * "asset" — the library delete, and the media delete of a file with a library
 * row (through the same asset delete) — and "media" — the media delete's
 * row-less branch and media-process. Their first-try rules differ: the
 * library delete and media-process held a file one of the user's jobs linked,
 * the media delete did not (the job being wiped still names the url). One
 * rule for all of them on the retry: only a job made since the failure counts
 * — a new link, like a rewritten object — so the job being wiped never pins
 * the file. Compared with the same clock allowance as below, in the same
 * direction: a job made in the failure's second keeps the file.
 *
 * Every other record is retried without it. The free-user reaper and the
 * canceled-user wipe record theirs as "retention" (decided 2026-10-09): the
 * account's files are going, so a later echo of one does not keep it — its
 * link is blanked with the rest once the delete lands.
 *
 * And one guard the first try did not need: the object must still be the one
 * that failed. Before deleting, the pass asks storage for it (`headR2Object`).
 * An object storage last wrote at or after the moment the failed delete BEGAN
 * (`failed_at`, taken before the delete call) is a NEW object at a reused key
 * (a job re-run, a plugin rewriting its checkpoint) — it is left alone and the
 * record dropped. Storage dates an object to the whole second, so that moment
 * is compared to the second, less `CLOCK_SKEW_MS` for the two clocks: an
 * object written in the same second is kept (a file left behind, never a new
 * one deleted). An object storage no longer has is already gone: its links
 * are blanked and the record dropped, with no delete.
 *
 * ONE PASS PER RECORD. Every boot of every replica runs a pass, so a pass
 * CLAIMS its batch before it touches storage: one update stamps
 * `last_attempt_at` on the rows it read, under the same filter, and returns
 * the rows it won (the database re-checks the filter under each row's lock,
 * so two passes never both win a row). The attempt it counts names its own
 * claim stamp (decided 2026-10-09): the funnel's re-record never writes
 * `last_attempt_at`, so a newer failure recorded at the key between the claim
 * and the count still has the attempt counted, and the cap holds — the newer
 * failure stays, with its own `failed_at`, for the next pass. The record it
 * drops names the failure it worked (`failed_at`): a newer failure recorded
 * at the key meanwhile is left for the next pass, never dropped.
 *
 * COMMUNITY: the table arrives with the migrations on every install and the
 * pass needs nothing edition-gated (no credits, no admin; the relay guard is
 * inert without a relay target). Without object storage it does not start.
 *
 * STAGING: dev code runs on the shared database before `main` applies 496. A
 * missing table (42P01 / PGRST205) or column (42703 / PGRST204) makes the
 * pass a no-op.
 */
import { supabase } from "./supabase.js"
import { batchDeleteFromR2, headR2Object, isStorageConfigured } from "./storage.js"
import { deletableKeys } from "./asset-delete.js"
import { keysHeldByOtherLibraryRows } from "./key-ownership.js"
import { blankUrlsInEveryJobOutput, urlsLinkedByJobsSince } from "./job-output-references.js"
import { isMissingColumnError, isMissingTableError } from "./postgrest-errors.js"
import { isRetryableDeleteKey, STORAGE_DELETE_RETRIES_TABLE as TABLE, type DeleteSource } from "./storage-delete.js"

/**
 * The sources whose failed delete a job made after the failure keeps: the
 * user's own deletes that checked job links on their first try.
 */
const GUARDED_BY_NEWER_JOB_LINKS: ReadonlySet<string> = new Set<DeleteSource>(["asset", "media"])

/** Retries per file before the pass logs it and gives up. */
export const MAX_DELETE_RETRIES = 5
/** Records one batch takes. */
const RETRY_BATCH = 100
/** Batches one pass runs at most; the rest wait for the next pass. */
const MAX_BATCHES_PER_PASS = 20
const RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000
/** A record is tried again only this long after its last attempt. */
const MIN_HOURS_BETWEEN_ATTEMPTS = 20
/** How far storage's clock may run behind ours: an object dated this close before a failed delete is kept. */
export const CLOCK_SKEW_MS = 1000

const RETRY_COLUMNS = "r2_key, url, source, job_id, attempts, failed_at"

interface RetryRow {
  r2_key: string
  url: string | null
  source: string
  job_id: string | null
  attempts: number
  failed_at: string
}

/**
 * Whether storage's copy of the key is a NEW object, written at or after the
 * failed delete began (or with no date to prove otherwise). `lastModified`
 * has whole seconds, so the moment is floored to the second first.
 */
export function isNewerObject(lastModified: Date | undefined, failedAt: string): boolean {
  const began = Date.parse(failedAt)
  if (!lastModified || !Number.isFinite(began)) return true
  return lastModified.getTime() >= Math.floor(began / 1000) * 1000 - CLOCK_SKEW_MS
}

export interface RetryResult {
  readonly retried: number
  readonly deleted: number
  readonly failed: number
  readonly gaveUp: number
  /** Records dropped because another row, a newer job, or a new object at the key holds the file. */
  readonly released: number
  readonly errors: number
}

function notOnThisDatabase(error: { code?: string | null } | null | undefined): boolean {
  return isMissingTableError(error) || isMissingColumnError(error)
}

/**
 * One retry pass over the recorded failures. Per batch: ask the guards again,
 * delete what is still ours, count an attempt on what storage again did not
 * confirm (giving up at `MAX_DELETE_RETRIES`), blank the links of what it did,
 * and drop the records of the files deleted or now held by another row. Stops
 * at the first failed lookup or write; everything it does is safe to repeat.
 */
export async function retryFailedStorageDeletes(): Promise<RetryResult> {
  // At most one attempt per record per ~day, however many replicas run the
  // pass and however often a deploy restarts it (each start runs one pass):
  // a record is worked only by the pass whose claim stamped it.
  const attemptedBefore = new Date(Date.now() - MIN_HOURS_BETWEEN_ATTEMPTS * 60 * 60 * 1000).toISOString()
  const due = `last_attempt_at.is.null,last_attempt_at.lt.${attemptedBefore}`
  let retried = 0
  let deleted = 0
  let failed = 0
  let gaveUp = 0
  let releasedCount = 0
  let errors = 0

  for (let batch = 0; batch < MAX_BATCHES_PER_PASS; batch++) {
    const { data, error } = await supabase
      .from(TABLE)
      .select("r2_key")
      .is("gave_up_at", null)
      // Not a record tried within the last day (this pass's included).
      .or(due)
      .order("created_at", { ascending: true })
      .limit(RETRY_BATCH)
    if (error) {
      if (!notOnThisDatabase(error)) {
        console.error("[storage-delete] Reading failed storage deletes failed:", error.message)
        errors++
      }
      break
    }
    const read = (data ?? []) as Array<{ r2_key: string }>
    if (read.length === 0) break

    // Claim them: stamped under the same filter, so a row another pass
    // claimed since the read is not returned here. The stamp is this pass's
    // mark on the row: the attempt it counts names it.
    const claimedAt = new Date().toISOString()
    const claimed = await supabase
      .from(TABLE)
      .update({ last_attempt_at: claimedAt })
      .in("r2_key", read.map((r) => r.r2_key))
      .is("gave_up_at", null)
      .or(due)
      .select(RETRY_COLUMNS)
    if (claimed.error) {
      if (!notOnThisDatabase(claimed.error)) {
        console.error("[storage-delete] Claiming failed storage deletes failed:", claimed.error.message)
        errors++
      }
      break
    }
    const rows = (claimed.data ?? []) as RetryRow[]
    if (rows.length === 0) {
      if (read.length < RETRY_BATCH) break
      continue
    }

    const keys = rows.map((r) => r.r2_key)
    let ours: Set<string>
    try {
      // Any library row naming the key holds it: none counts as the file's own.
      // A key storage refuses outright is never retried (released below).
      const retryable = keys.filter(isRetryableDeleteKey)
      const held = await keysHeldByOtherLibraryRows(retryable, () => false)
      ours = new Set(await deletableKeys(retryable.filter((k) => !held.has(k))))
      // A failed delete that checked job links (asset, media): a job made
      // since the failure that links the file keeps it. "retention" and the
      // other paths are retried without asking.
      const guardedLinks = rows
        .filter((r) => GUARDED_BY_NEWER_JOB_LINKS.has(r.source) && r.url && ours.has(r.r2_key))
        .map((r) => ({ key: r.r2_key, url: r.url as string, since: new Date(Date.parse(r.failed_at) - CLOCK_SKEW_MS) }))
      if (guardedLinks.length > 0) {
        const linked = await urlsLinkedByJobsSince(guardedLinks.map(({ url, since }) => ({ url, since })))
        for (const l of guardedLinks) if (linked.has(l.url)) ours.delete(l.key)
      }
    } catch (err) {
      console.error("[storage-delete] Failed-delete retry guard lookup failed:", err)
      errors++
      break
    }

    // Still the object that failed? One written at or after the record (or
    // with no date to prove otherwise) is a new object at a reused key: kept,
    // record dropped. One storage no longer has is already gone.
    const candidates = rows.filter((r) => ours.has(r.r2_key))
    let heads: Array<{ exists: boolean; lastModified?: Date }>
    try {
      heads = await Promise.all(candidates.map((r) => headR2Object(r.r2_key)))
    } catch (err) {
      console.error("[storage-delete] Failed-delete retry storage lookup failed:", err)
      errors++
      break
    }
    const alreadyGone: RetryRow[] = []
    const rewritten: RetryRow[] = []
    const toDelete: RetryRow[] = []
    candidates.forEach((r, i) => {
      const head = heads[i]!
      if (!head.exists) alreadyGone.push(r)
      else if (isNewerObject(head.lastModified, r.failed_at)) rewritten.push(r)
      else toDelete.push(r)
    })

    const now = new Date().toISOString()
    const released = [...rows.filter((r) => !ours.has(r.r2_key)), ...rewritten]

    const stillThere = new Set<string>()
    if (toDelete.length > 0) {
      try {
        const result = await batchDeleteFromR2(toDelete.map((r) => r.r2_key))
        for (const k of result.notDeleted) stillThere.add(k)
      } catch (err) {
        console.error("[storage-delete] Failed-delete retry storage call failed:", err)
        errors++
        break
      }
    }
    retried += toDelete.length

    // Count an attempt on each file storage again did not confirm gone.
    let countFailed = false
    for (const r of toDelete.filter((x) => stillThere.has(x.r2_key))) {
      const attempts = (r.attempts ?? 0) + 1
      const giveUp = attempts >= MAX_DELETE_RETRIES
      const { error: updateErr } = await supabase
        .from(TABLE)
        .update({
          attempts,
          last_attempt_at: now,
          last_error: "storage did not confirm the delete",
          ...(giveUp ? { gave_up_at: now } : {}),
        })
        .eq("r2_key", r.r2_key)
        // The row this pass claimed, even when a newer failure was recorded at
        // the key since (a re-record keeps the stamp): every attempt counts.
        .eq("last_attempt_at", claimedAt)
      if (updateErr) {
        console.error(`[storage-delete] Counting a failed-delete retry for ${r.r2_key} failed:`, updateErr.message)
        errors++
        countFailed = true
        break
      }
      failed++
      if (giveUp) {
        gaveUp++
        console.error(`[storage-delete] Giving up on deleting ${r.r2_key} after ${attempts} retries; the file stays in storage and its links stay in place`)
      }
    }
    if (countFailed) break

    // Storage confirmed these gone: clear their links everywhere first, then
    // drop the records. A failed blanking keeps the records, so the next pass
    // deletes again (a no-op) and blanks again.
    const gone = [...alreadyGone, ...toDelete.filter((r) => !stillThere.has(r.r2_key))]
    try {
      const urls = gone.flatMap((r) => (r.url ? [r.url] : []))
      if (urls.length > 0) await blankUrlsInEveryJobOutput(urls)
    } catch (err) {
      console.error("[storage-delete] Blanking the links of retried deletes failed:", err)
      errors++
      break
    }
    deleted += gone.length

    // Drop each finished record — only the failure this pass worked (a newer
    // one recorded at the key meanwhile stays for the next pass).
    let dropFailed = false
    for (const r of [...gone, ...released]) {
      const { error: dropErr } = await supabase.from(TABLE).delete().eq("r2_key", r.r2_key).eq("failed_at", r.failed_at)
      if (dropErr) {
        console.error("[storage-delete] Dropping finished failed-delete records failed:", dropErr.message)
        errors++
        dropFailed = true
        break
      }
    }
    if (dropFailed) break
    releasedCount += released.length

    if (read.length < RETRY_BATCH) break
  }

  if (retried > 0 || releasedCount > 0 || errors > 0) {
    console.log(`[storage-delete] Failed-delete retry: ${retried} retried, ${deleted} deleted, ${failed} failed again (${gaveUp} given up), ${releasedCount} released (another row or a newer job holds the file, or a new object took the key), ${errors} errors`)
  }
  return { retried, deleted, failed, gaveUp, released: releasedCount, errors }
}

/**
 * Runs the pass on boot, then once a day, on every edition. Returns the stop
 * function the server's `onClose` awaits. A no-op without object storage.
 */
export function startStorageDeleteRetry(report: (message: string) => void): () => Promise<void> {
  if (!isStorageConfigured()) return async () => {}
  let stopped = false
  let pending: Promise<void> | undefined
  const tick = () => {
    if (stopped || pending) return
    pending = (async () => {
      try {
        const result = await retryFailedStorageDeletes()
        if (result.errors > 0 || result.gaveUp > 0) {
          report(`Storage delete retry: ${result.errors} error(s), ${result.gaveUp} file(s) given up after ${MAX_DELETE_RETRIES} retries`)
        }
      } catch (err) {
        report(`Storage delete retry failed: ${(err as Error).message}`)
      }
    })().finally(() => { pending = undefined })
  }
  const timer = setInterval(tick, RETRY_INTERVAL_MS)
  timer.unref()
  tick()
  return async () => {
    stopped = true
    clearInterval(timer)
    await pending
  }
}
