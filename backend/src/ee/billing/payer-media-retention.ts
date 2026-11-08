import { freshPayerCoverage, payerCoverage } from "../../lib/deployment-payer.js"
import { runtimeSurfaceProfile } from "../../lib/surface-profile.js"

/**
 * MEDIA RETENTION UNDER A DEPLOYMENT PAYER (decided 2026-11-08).
 *
 * WHO IS COVERED is one notion, `payerCoverage()` (lib/deployment-payer.ts),
 * shared with every other plan rule: while a payer is active it covers every
 * user on the instance, at the payer account's grade. Nobody there buys a plan
 * of their own, so each user's own stored tier is `free` while the payer holds
 * the plan.
 *
 * THE RULE. While a payer is active, the sweeps that reap media by a user's
 * OWN plan keep every user's media, the payer account's own included, whatever
 * grade the payer account is on. Those sweeps are the free-tier sweep and the
 * canceled-subscription sweep (cleanup-service.ts). Each asks this first,
 * before it selects a single user. A function that selects users by plan and
 * clears media without asking fails the build
 * (__tests__/plan-keyed-sweeps-census.test.ts).
 *
 * THE PAYER'S OWN PLAN NEVER TURNS A SWEEP BACK ON. The decision is made before
 * anything is read. A payer account on the free tier is a misconfiguration:
 * logged on every run, never acted on. A payer row that cannot be read gives
 * the same answer: media kept. So nothing that drops the payer to free can make
 * a whole instance's library reapable in one night. That includes a canceled
 * payer subscription (the webhook, or the hourly expiry net), an admin tier
 * edit, and a refund clawback that empties a prepaid payer's lifetime top-ups.
 *
 * A profile that NAMES a payer this process has not brought up also keeps
 * media. Boot brings the payer up before the cron starts (app.ts exits when it
 * cannot), so this is a guard for a future entry point that schedules the
 * sweeps without that boot. Failing toward keeping media costs one skipped
 * night. Failing the other way cannot be undone.
 *
 * INERT without a payer: two in-memory checks, no query and no log, and every
 * sweep takes exactly its previous path.
 */
export async function mediaKeptByDeploymentPayer(sweep: string): Promise<boolean> {
  const covered = payerCoverage() !== null
  if (!covered && !runtimeSurfaceProfile().billing.payerAccount) return false
  // Decided. What follows only tells an operator why the sweep did nothing,
  // and about a payer whose own plan is wrong. Nothing it reads, or fails to
  // read, can change the answer.
  if (!covered) {
    console.warn(
      `[cleanup] ${sweep}: the surface profile names a deployment payer but this process has not brought it up. ` +
        "Every user's media is kept.",
    )
    return true
  }
  await reportPayerPlan(sweep)
  return true
}

/** One line per run on the payer's own plan, read fresh. Never throws. */
async function reportPayerPlan(sweep: string): Promise<void> {
  let fresh: Awaited<ReturnType<typeof freshPayerCoverage>> = null
  try {
    fresh = await freshPayerCoverage()
  } catch {
    fresh = null
  }
  if (!fresh || !fresh.read) {
    const account = fresh ? `account ${fresh.coverage.payerId} (last grade read: ${fresh.coverage.tier})` : "account"
    console.warn(
      `[cleanup] ${sweep}: the deployment payer ${account} could not be read. ` +
        "Every user's media is kept, as it is under any payer.",
    )
  } else if (fresh.coverage.tier === "free") {
    console.warn(
      `[cleanup] ${sweep}: MISCONFIGURATION: the deployment payer account ${fresh.coverage.payerId} is on the free tier. ` +
        "Every user's media is still kept (a payer's own plan never turns a sweep on). Put the payer account on a paid plan.",
    )
  } else {
    console.info(
      `[cleanup] ${sweep}: a deployment payer is active (grade: ${fresh.coverage.tier}). Every user's media is kept.`,
    )
  }
}
