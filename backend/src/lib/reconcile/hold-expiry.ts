/**
 * The ONE sweep permitted to write a `pending_review` row (spec D31).
 *
 * Every other liveness sweep in this directory filters positively on
 * `pending|processing`, so a held job is exempt from all of them BY
 * CONSTRUCTION — which is exactly what makes a hold safe, and exactly why it
 * needs its own clock. Without a TTL an abandoned review holds the user's
 * credits (on a deployment with one payer account: the payer's balance)
 * indefinitely, and nothing anywhere would report it.
 *
 * On expiry the platform AUTO-REJECTS: the job fails with the platform's own
 * words, the reservation is refunded and the withheld object is deleted. Auto-
 * APPROVE is deliberately not an option — it would publish exactly the output a
 * human declined to look at.
 *
 * `JOB_HOLD_TTL_HOURS` unset (the default) means the sweep does NOTHING AT ALL:
 * not one query per tick. A deployment that registers no job policy can never
 * have a held row and must not pay for the possibility.
 *
 * `lib/reconcile/cron.ts` calls this from its loop.
 */
import { supabase } from "../supabase.js"
import { config } from "../config.js"
import { rejectHeldJobRow } from "../job-policy-gate.js"
import { PLATFORM_POLICY_ID } from "../job-policy.js"
import { policyBlockHint } from "../safety-block.js"
import { insertAppReport } from "../app-reports.js"

/** Bounded per tick: the queue is meant to be drained by humans, and a sweep
 *  that refunds hundreds of jobs in one pass is a bug report, not a feature. */
const MAX_PER_SWEEP = 50

/** The MACHINE reason, as the public docs promise (`docs/deployment.md`'s
 *  JOB_HOLD_TTL_HOURS row). Stable — the decisions tab keys on it. */
export const HOLD_EXPIRED_REASON = "hold-expired"

/** The USER-VISIBLE text. The platform's words, never a policy's: nobody
 *  judged this content, we simply ran out of time to look at it. */
export const HOLD_EXPIRED_MESSAGE =
  "This result was not reviewed in time, so it was not released. Your credits have been refunded."

/** The same sentence for the case where the refund moved NOTHING.
 *
 *  A held job's reservation is not always still `reserved` when the hold is
 *  taken: the smart-loop-cut path commits at (reserved − addon) before the
 *  result gate ever speaks, so `refundReservedCreditsForJob` finds no
 *  `reserved` row and returns 0. Promising a refund there is a lie the user
 *  can check against their balance, and it turns a billing bug into a support
 *  ticket about a message instead of about the money. */
export const HOLD_EXPIRED_NO_REFUND_MESSAGE =
  "This result was not reviewed in time, so it was not released. Nothing was refunded — its credits were no longer being held. Contact support if you were charged for it."

export interface HoldExpiryResult {
  expired: number
  errors: number
}

/** Hours, or null when the TTL is disabled. Blank, zero, negative and
 *  non-numeric all mean disabled — a typo must not silently become "1 hour". */
function ttlHours(): number | null {
  const raw = (config.JOB_HOLD_TTL_HOURS ?? "").trim()
  if (!raw) return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[reconcile/hold-expiry] JOB_HOLD_TTL_HOURS="${raw}" is not a positive number — holds will not expire`)
    return null
  }
  return n
}

/**
 * Rewrite the sentence we just told the user, because it was not true.
 *
 * Only ever touches the row this sweep just failed (`status = 'failed'` is the
 * CAS: an approve or a cancel that raced us leaves the row alone), and files a
 * report — a hold that expires with nothing left to refund means the money was
 * settled somewhere it should not have been, which is a defect an operator has
 * to see rather than a message to quietly soften.
 */
async function correctRefundClaim(jobId: string): Promise<void> {
  const { error } = await supabase
    .from("jobs")
    .update({
      error_message: HOLD_EXPIRED_NO_REFUND_MESSAGE,
      // `error_hint.reason` is what the canvas renders, so correcting only
      // `error_message` would leave the false promise on screen.
      error_hint: policyBlockHint(PLATFORM_POLICY_ID, HOLD_EXPIRED_NO_REFUND_MESSAGE, "result"),
    })
    .eq("id", jobId)
    .eq("status", "failed")
  if (error) console.error(`[reconcile/hold-expiry] could not correct the refund claim on job ${jobId}: ${error.message}`)
  await insertAppReport({
    node: "job-policy",
    kind: "hold-expired-without-refund",
    severity: "warning",
    title: `job ${jobId} expired out of review with no reserved credits left to refund`,
    jobId,
  })
}

export async function sweepExpiredHolds(): Promise<HoldExpiryResult> {
  const result: HoldExpiryResult = { expired: 0, errors: 0 }
  const hours = ttlHours()
  if (hours === null) return result

  const cutoff = new Date(Date.now() - hours * 3_600_000).toISOString()
  const { data, error } = await supabase
    .from("jobs")
    .select("id")
    .eq("status", "pending_review")
    .lt("held_at", cutoff)
    .order("held_at", { ascending: true })
    .limit(MAX_PER_SWEEP)
  if (error) {
    console.error(`[reconcile/hold-expiry] candidate scan failed: ${error.message}`)
    result.errors++
    return result
  }

  for (const row of (data as Array<{ id: string }> | null) ?? []) {
    try {
      const res = await rejectHeldJobRow(row.id, {
        userMessage: HOLD_EXPIRED_MESSAGE,
        machineReason: HOLD_EXPIRED_REASON,
        policyId: PLATFORM_POLICY_ID,
        hookPoint: "review",
        verdict: "reject",
      })
      if (res.ok) {
        result.expired++
        // The message above is written by the reject CAS, which runs BEFORE the
        // refund — so the only place the promise can be checked is here, with
        // the count the refund actually moved.
        if (res.refunded === 0) await correctRefundClaim(row.id)
      }
      // Not ok = a reviewer, a cancel or another tick got there first. That is
      // the CAS doing its job, not an error worth retrying.
      else result.errors++
    } catch (err) {
      console.error(`[reconcile/hold-expiry] expiring job ${row.id} threw:`, err)
      result.errors++
    }
  }
  return result
}
