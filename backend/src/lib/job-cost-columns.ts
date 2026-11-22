/**
 * The two cost columns of a `jobs` row, from ONE cost.
 *
 * `provider_cost` is what the provider billed for the job, in USD.
 * `display_cost` is that same figure with the platform markup applied once
 * (`cost_markup_percent`, `calculateDisplayCost`). It is never computed from
 * anything else: a handler that replaces a run's cost after the router priced
 * it (a per-second model measured from the video it returned, a two-step run
 * whose second step adds to the first) used to carry the router's figure in
 * `display_cost` beside the measured one in `provider_cost`, so the admin view
 * showed one model-wide number for every run of a per-second model.
 *
 * Every write of `provider_cost` goes through here or through the completion
 * and failure funnels (`markJobCompletedDetailed`, `markJobFailedDetailed`),
 * which pair it with {@link withPairedDisplayCost}. `display_cost` has no other
 * writer. `lib/__tests__/job-cost-columns-guard.test.ts` holds the source tree
 * to both rules.
 *
 * Recorded only: neither column is read by any charge. A run's credits are
 * settled from its reservation or its own metered base (`commitJobCredits`).
 */

import { calculateDisplayCost, getAppSettings, settingsReadFailed } from "./app-settings.js"

export interface JobCostColumns {
  provider_cost?: number | null
  display_cost?: number | null
}

/**
 * The markup the display figure is computed at, or undefined when the settings
 * could not be read. `getAppSettings` does not throw on a failed read: it hands
 * out stand-in defaults (markup 0) that `settingsReadFailed` flags, and those
 * are no markup at all. Undefined writes `display_cost: null`: a display figure
 * at a guessed markup would be the drift this module exists to stop.
 */
async function markupPercent(): Promise<number | undefined> {
  try {
    const settings = await getAppSettings()
    if (settingsReadFailed(settings)) return undefined
    const value = settings.cost_markup_percent
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * The columns for a markup. A finite cost writes both — with an unknown markup
 * the display figure is written as null, so an earlier pair cannot survive
 * beside the new cost; `null` writes both as null (the caller states the job
 * has no provider cost); `undefined` or a non-finite number writes neither, so
 * the row keeps what it had.
 */
export function jobCostColumnsAt(cost: number | null | undefined, markup: number | undefined): JobCostColumns {
  if (cost === null) return { provider_cost: null, display_cost: null }
  if (typeof cost !== "number" || !Number.isFinite(cost)) return {}
  return markup === undefined
    ? { provider_cost: cost, display_cost: null }
    : { provider_cost: cost, display_cost: calculateDisplayCost(cost, markup) }
}

/** {@link jobCostColumnsAt} at the platform's current markup. */
export async function jobCostColumns(cost: number | null | undefined): Promise<JobCostColumns> {
  if (cost === undefined || (typeof cost === "number" && !Number.isFinite(cost))) return {}
  if (cost === null) return jobCostColumnsAt(null, undefined)
  try {
    return jobCostColumnsAt(cost, await markupPercent())
  } catch {
    // Never throws (the failure funnel must not): the cost, with no display figure.
    return { provider_cost: cost, display_cost: null }
  }
}

/**
 * A row write with its `display_cost` derived from its own `provider_cost`.
 * A caller's `display_cost` is never kept: with a `provider_cost` it is
 * replaced by the derived figure, and without one it is dropped (a display
 * figure with no cost beside it has no source). Fields with neither key come
 * back as the same object.
 */
export async function withPairedDisplayCost<T extends Record<string, unknown>>(fields: T): Promise<T> {
  const hasCost = Object.prototype.hasOwnProperty.call(fields, "provider_cost")
  const hasDisplay = Object.prototype.hasOwnProperty.call(fields, "display_cost")
  if (!hasCost && !hasDisplay) return fields
  const { display_cost: _dropped, provider_cost: cost, ...rest } = fields as Record<string, unknown>
  void _dropped
  if (!hasCost) return rest as T
  const columns = typeof cost === "number" || cost === null ? await jobCostColumns(cost) : {}
  // A cost that is not a number (never written by a typed caller) is written
  // as it came, with no display figure beside it.
  return { ...rest, ...(typeof cost === "number" || cost === null ? columns : { provider_cost: cost }) } as T
}
