/**
 * Holding the finalize claim through a long media step (a copy, a download +
 * encode + upload) that can outlive the claim's TTL: the claim is taken BEFORE
 * the step and re-stamped while it runs, so the reconcile cron
 * (`hasFreshFinalizeClaim`) leaves the row alone for as long as a live process
 * works on it, and the claim lapses within one TTL of that process dying.
 * Shared by the exclusive-node relay's copy home and the Rhea upscale's
 * delivery (worker and reconcile alike).
 */
import { supabase } from "./supabase.js"
import { claimJobFinalize, releaseJobFinalizeClaim, type FinalizeClaimant } from "./job-finalize.js"
import { FINALIZE_CLAIM_TTL_MS } from "./reconcile/types.js"

/** How often a long copy re-stamps its finalize claim: well inside the TTL the
 *  reconcile cron's `hasFreshFinalizeClaim` measures the claim's age against. */
export const CLAIM_REFRESH_MS = Math.floor(FINALIZE_CLAIM_TTL_MS / 3)

/** True when the row holds a finalize claim younger than its TTL, read now
 *  (not from the cron's scan). A failed read answers false: the claim RPC
 *  still guards against another claimant. */
export async function hasFreshFinalizeClaimNow(jobId: string): Promise<boolean> {
  // trash-read: a job's own finalize lifecycle; it is delivered and settled whether or not it was deleted
  const { data, error } = await supabase.from("jobs").select("finalize_claimed_at").eq("id", jobId).maybeSingle()
  if (error) return false
  const at = (data as { finalize_claimed_at?: string | null } | null)?.finalize_claimed_at
  if (typeof at !== "string") return false
  return Date.now() - new Date(at).getTime() < FINALIZE_CLAIM_TTL_MS
}

/** The claim was taken over by another finalizer while this one worked: it must not store or finalize. */
export class FinalizeClaimLostError extends Error {
  readonly code = "finalize_claim_lost"
  constructor(jobId: string) {
    super(`job ${jobId}: the finalize claim was taken by another finalizer; this delivery stops`)
    this.name = "FinalizeClaimLostError"
  }
}

export function isFinalizeClaimLost(err: unknown): err is FinalizeClaimLostError {
  return err instanceof FinalizeClaimLostError
}

/** What `work` is handed: whether the claim is still held, read at the moment it is asked. */
export interface FinalizeClaimHold {
  /** True once a refresh found the claim held by another finalizer. */
  readonly lost: boolean
  /** Throws {@link FinalizeClaimLostError} when the claim was lost: call it before each step that stores or commits. */
  assertHeld(): void
}

/**
 * Run `work` (a copy that can outlive the finalize claim's TTL several times
 * over) holding the finalize claim `firstTs` won: re-stamped every
 * CLAIM_REFRESH_MS through the same-claimant re-entry of `claim_job_finalize`,
 * so the cron leaves the row alone for as long as the copy runs, and lapses
 * within one TTL of this process dying. A failed copy releases the LATEST
 * stamp, so a retry or the next tick need not wait the TTL out.
 *
 * `stopOnLoss`: a refresh that finds the claim held by ANOTHER finalizer marks
 * the hold lost (`work` checks it with `assertHeld()` before it stores), stops
 * refreshing, and the call throws {@link FinalizeClaimLostError} instead of
 * returning — so a delivery that lost its claim never goes on to store or
 * finalize beside the one that took it. Without it (the exclusive-node relay's
 * copy home, unchanged), a refresh's answer is only used to keep the latest stamp.
 */
export async function holdingFinalizeClaim<T>(
  jobId: string,
  claimant: FinalizeClaimant,
  firstTs: string | null,
  work: (hold: FinalizeClaimHold) => Promise<T>,
  opts: { readonly stopOnLoss?: boolean } = {},
): Promise<T> {
  let ts = firstTs
  let lost = false
  const hold: FinalizeClaimHold = {
    get lost() { return lost },
    assertHeld() {
      if (lost) throw new FinalizeClaimLostError(jobId)
    },
  }
  let refreshing: Promise<void> = Promise.resolve()
  const timer = setInterval(() => {
    refreshing = refreshing
      .then(() => (lost ? undefined : claimJobFinalize(jobId, claimant)))
      .then(
        (claim) => {
          if (!claim) return
          if (claim.won && claim.ts) ts = claim.ts
          else if (!claim.won && opts.stopOnLoss) {
            lost = true
            clearInterval(timer)
          }
        },
        () => undefined,
      )
  }, CLAIM_REFRESH_MS)
  timer.unref?.()
  const stopRefreshing = async (): Promise<void> => {
    clearInterval(timer)
    await refreshing
  }
  try {
    const out = await work(hold)
    await stopRefreshing()
    hold.assertHeld()
    return out
  } catch (err) {
    await stopRefreshing()
    // A lost claim is another finalizer's now: never released from here, and
    // whatever the step threw on the way out (a store refused by `assertHeld`,
    // wrapped by its post-processing guard) is reported as the loss it is.
    if (lost) throw new FinalizeClaimLostError(jobId)
    if (ts) await releaseJobFinalizeClaim(jobId, ts)
    throw err
  }
}
