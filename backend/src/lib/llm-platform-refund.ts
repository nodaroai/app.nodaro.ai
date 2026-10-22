// @reads-none moves credits through service-role RPCs; reads no repo file
/**
 * R61 + R57: a DELIBERATE platform refund of everything a job's metered LLM
 * calls were already CHARGED — for a job the platform itself refuses after
 * the fact: a result-policy block, a reviewer's reject, or the owner's
 * withdraw of a held job ("a platform gate's false positives are ours", D19).
 *
 * The job's reservation refund (`refundReservedCreditsForJob`) gives back
 * only what is still `reserved`; a metered LLM job settles BEFORE its
 * completion write (so a billed call is never left free, D10), so by the time
 * the gate speaks its hold is committed, and its side holds (554) may be too.
 * This reverses both, through the database's own reversal (per payer, for
 * what each commit actually moved, once): the job's own metered charges
 * (`refund_settled_metered_charge`) and its settled side holds
 * (`refund_settled_side_hold`). It is never a D10 path: nothing else refunds
 * a billed call.
 *
 * Keyed off the charges, never the pricing switch (R15): a charge settled
 * before a rollback flip is refunded all the same. The schema is asked of the
 * database (a fresh process answers "not ready" until its first probe lands —
 * and this runs once, with no later tick to catch up). Cloud-only: every money
 * path is in `ee/`, loaded by dynamic import. Never throws: a failure is
 * logged, and an RPC that refused is reported by the implementation.
 */
import { hasCredits } from "./config.js"
import { probeLlmMeteredSchemaNow } from "./llm-metered-schema-gate.js"

/**
 * Reverse the job's settled metered charges and its settled side holds;
 * answers how many usage logs were refunded (what a caller that tells the user
 * "your credits came back" checks, with the reservation refund's own count).
 * Never throws — everything, imports included, is inside the catch: it runs
 * between a refusal's CAS and the deletion of the refused output, which must
 * happen whatever the money did.
 */
export async function refundSettledLlmCharges(jobId: string): Promise<number> {
  let refunded = 0
  try {
    if (!hasCredits()) return 0
    if (!(await probeLlmMeteredSchemaNow())) return 0
    try {
      const { refundSettledMeteredJobChargesImpl } = await import("../ee/billing/llm-billing-impl.js")
      refunded += await refundSettledMeteredJobChargesImpl(jobId)
    } catch (err) {
      console.error(`[llm-billing] refunding the settled metered charges of job ${jobId} failed:`, err)
    }
    // The job's settled SIDE holds (R57), whatever the job's own charges did.
    const { refundSettledSideHolds } = await import("./llm-side-hold.js")
    refunded += await refundSettledSideHolds(jobId)
  } catch (err) {
    console.error(`[llm-billing] the platform refund of job ${jobId}'s settled LLM charges failed:`, err)
  }
  return refunded
}
