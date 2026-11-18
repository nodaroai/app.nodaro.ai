/**
 * What KIE billed for one finished task, in USD, as a job records it
 * (`jobs.provider_cost`): the task record's own `creditsConsumed` (read by
 * `kieTaskCreditsConsumed`) at `KIE_CREDIT_USD`, else `listedUsd`, the model's
 * catalog figure, when the record carries no such figure.
 *
 * Recorded only. A lane that returns this as `ProviderResult.cost` without
 * `meteredCost` commits its reservation whatever the figure is
 * (`commitJobCredits`' reserved-tier branch), so a charge never reads it. The
 * figure comes off the final poll's response (`runKieTask` / `pollLumaTask`
 * return it as `rawRecordInfo`), never a request of its own.
 *
 * One rule for every KIE video and audio lane that records the task's bill;
 * `__tests__/kie-billed-cost-guard.test.ts` holds those lanes to it.
 */

import { kieTaskCreditsConsumed } from "./image-cost.js"
import { KIE_CREDIT_USD } from "./models.js"

/** KIE credits in USD: the one conversion every recorded KIE bill goes through. */
export function kieCreditsUsd(credits: number): number {
  return credits * KIE_CREDIT_USD
}

export function kieBilledCostUsd(record: Record<string, unknown> | undefined, listedUsd: number): number {
  const credits = kieTaskCreditsConsumed(record)
  return credits !== undefined ? kieCreditsUsd(credits) : listedUsd
}

/**
 * What a job finished by a RECOVERY path (the reconcile cron, the worker's
 * re-pick after a restart, a unit's `recover.ts`) records as its
 * `provider_cost`: the credits its saved task's record carries
 * (`kieTaskCreditsConsumed`, read off the poll the recovery already made), at
 * the same rate as `kieBilledCostUsd`. No record figure: null, and the column
 * is left unwritten — a recovery knows the task, not the request the worker
 * ran it with, so it has no catalog figure it could name for certain.
 *
 * Recorded only, as above: a recovery commits its reservation (or its own
 * metered base) whatever this is. `lib/reconcile/__tests__/kie-recovery-cost-guard.test.ts`
 * holds every KIE recovery path to it.
 */
export function kieRecoveredCostUsd(credits: number | undefined): number | null {
  return credits !== undefined ? kieCreditsUsd(credits) : null
}
