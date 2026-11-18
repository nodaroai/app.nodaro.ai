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

export function kieBilledCostUsd(record: Record<string, unknown> | undefined, listedUsd: number): number {
  const credits = kieTaskCreditsConsumed(record)
  return credits !== undefined ? credits * KIE_CREDIT_USD : listedUsd
}
