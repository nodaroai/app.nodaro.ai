/**
 * What a finalize that does not complete its job does with what it stored
 * (lib/job-finalize.ts `finalizeJobWithMedia`): its record of every object it
 * stored (`storeLedger`), the fence on its own finalize claim
 * (`fenceFinalizeClaim`), and the delete behind that fence
 * (`discardUnfinishedStores`, through the delete lane of
 * lib/discard-job-copies.ts).
 */
import { supabase } from "./supabase.js"
import { TERMINAL_JOB_STATUSES, type JobStatus } from "./job-status.js"

/**
 * Every object a finalize stored, by URL, in the order each store landed —
 * what it deletes again if it does not complete the job. Never a caller's
 * pre-uploaded file: this finalize did not store it.
 */
export interface StoreLedger {
  /** Record objects as their stores land. */
  readonly add: (...urls: readonly string[]) => void
  /** Every object recorded so far. */
  readonly urls: () => readonly string[]
}

/** A fresh, empty ledger for one finalize. */
export function storeLedger(): StoreLedger {
  let stored: readonly string[] = []
  return {
    add: (...urls) => {
      stored = [...stored, ...urls]
    },
    urls: () => stored,
  }
}

/**
 * The claimant a finalize writes while it deletes what it stored. It is
 * neither "worker" nor "cron", so `claim_job_finalize` grants the row to no
 * finalizer (its same-claimant arm never matches it) until the claim is
 * released or its TTL lapses.
 */
const DISCARD_CLAIMANT = "discard"

/**
 * The only rows a finalize that is not completing may delete its stores on:
 * gone terminal WITHOUT a completion — cancelled or failed. Never a completed
 * row (another finalizer's completion names the same keys, incident
 * 2026-06-10), never a held one (a reviewer reads them), and never a LIVE one
 * (pending, queued, processing): a finalizer that took the row over may still
 * complete it naming those very keys (migration 211's stall re-pick, or the
 * TTL), so a live row's stored keys are left to the normal flow — a re-pick
 * re-stores the same keys, or the sweep reaps them. One rule for a throw and
 * for a lost completion.
 */
export const DISCARD_STATUSES: readonly JobStatus[] = TERMINAL_JOB_STATUSES.filter((s) => s !== "completed")

/**
 * After a result-gate block: only a CANCELLED row. A block the gate applied
 * leaves the row failed, its objects already deleted and their bytes given
 * back by the gate itself; only a block that missed its compare-and-set (the
 * row was cancelled first) left what this finalize stored behind.
 */
export const DISCARD_AFTER_MISSED_BLOCK: readonly JobStatus[] = TERMINAL_JOB_STATUSES.filter((s) => s === "cancelled")

/**
 * Fence our finalize claim for a delete: ONE conditional UPDATE that matches
 * only while the row still carries OUR claim (`finalize_claimed_at` = the
 * timestamp we claimed with) and is in one of `statuses`, and that makes the
 * claim the discard's — `finalize_claimed_by` "discard" and a fresh
 * timestamp, so neither a same-claimant re-claim (a stall re-pick, migration
 * 211) nor a TTL take-over can win the row while we delete. Returns the
 * fenced claim's timestamp (release with it), or null when the row is not
 * ours or not in `statuses` — then nothing may be deleted. Never throws.
 */
async function fenceFinalizeClaim(jobId: string, claimTs: string, statuses: readonly JobStatus[]): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("jobs")
      .update({ finalize_claimed_at: new Date().toISOString(), finalize_claimed_by: DISCARD_CLAIMANT })
      .eq("id", jobId)
      .eq("finalize_claimed_at", claimTs)
      .in("status", [...statuses])
      .select("finalize_claimed_at")
    if (error) {
      console.warn(`[job-finalize] discard fence failed for ${jobId} — its stored objects stay: ${error.message}`)
      return null
    }
    const ts = (data as ReadonlyArray<{ finalize_claimed_at?: string | null }> | null)?.[0]?.finalize_claimed_at
    return typeof ts === "string" && ts ? ts : null
  } catch (err) {
    console.warn(`[job-finalize] discard fence failed for ${jobId} — its stored objects stay: ${String(err)}`)
    return null
  }
}

/**
 * A finalize that will not complete its job deletes what it stored — every
 * object of `stored` in the job's own key family — and gives each one's bytes
 * back to the owner's storage (`discardOwnedKeys`, lib/discard-job-copies.ts:
 * the storage-delete funnel, so a failed delete is recorded for the retry
 * pass, and only the bytes storage confirmed gone are given back). Nothing
 * else references those objects: the completion that would have named them
 * never happened.
 *
 * SAFE against the other finalizer of the same deterministic keys (incident
 * 2026-06-10) because it deletes only behind its fence (`fenceFinalizeClaim`):
 *   - only with a claim of its own (`claimTs`) — an unclaimed finalize (the
 *     claim RPC failed) deletes nothing;
 *   - only while the row still carries that claim — a finalizer that took the
 *     row over (TTL, or a stall re-pick) has stamped its own, so the fence
 *     misses and nothing is deleted;
 *   - only in `statuses` (`DISCARD_STATUSES`: cancelled or failed) — never a
 *     completed, a held or a live row: a live row may yet be completed by a
 *     finalizer that took it over, naming the same keys;
 *   - and the fence holds the row while it deletes: no finalizer can claim it
 *     and re-store a key until the caller releases the claim, AFTER the delete.
 *     A retry re-stores every key it needs after that, at the same keys.
 *
 * Returns the fenced claim's timestamp (the caller releases with it), or null
 * when it deleted nothing and the claim is as it was. Never throws.
 */
export async function discardUnfinishedStores(
  jobId: string,
  userId: string | undefined,
  stored: readonly string[],
  claimTs: string,
  statuses: readonly JobStatus[],
): Promise<string | null> {
  if (stored.length === 0) return null
  let keys: readonly string[] = []
  let discard: ((jobId: string, userId: string | undefined, keys: readonly string[]) => Promise<void>) | undefined
  try {
    // Loaded only here, so a finalize that completes never loads the delete lane.
    const lane = await import("./discard-job-copies.js")
    keys = lane.ownedCopyKeys(jobId, stored)
    discard = lane.discardOwnedKeys
  } catch (err) {
    // Never thrown: the caller is surfacing the finalize's own error, and must still release its claim.
    console.warn(`[job-finalize] ${jobId}: what this finalize stored could not be discarded: ${String(err)}`)
    return null
  }
  if (!discard || keys.length === 0) return null
  const fenced = await fenceFinalizeClaim(jobId, claimTs, statuses)
  if (!fenced) return null
  // Never throws (it logs its own failure): the fenced claim is returned either way, for the release.
  await discard(jobId, userId, keys)
  return fenced
}
