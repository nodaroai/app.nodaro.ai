/**
 * The monthly anchors of a billing period (decided 2026-10-15).
 *
 * A paid plan grants its credits every month, on a yearly price too. On a
 * monthly price Stripe moves the billing period every month and the renewal
 * resets the credits; a yearly price moves its period once a year, so the
 * months in between are counted from the period's own start:
 *
 *   anchor k = period start + k calendar months, at the same UTC time of day,
 *              on the same day of the month — clamped to the month's last day
 *              when the month is shorter (Jan 31 → Feb 28/29 → Mar 31 → …).
 *
 * Every anchor is computed from the period START, never from the previous
 * anchor: chaining would carry Feb 28 into every later month. All arithmetic
 * is in UTC, so a daylight-saving change never moves an anchor.
 *
 * Pure: no clock, no I/O. The cron step that grants at these anchors is
 * `yearly-plan-monthly-credits.ts`; the database re-checks the anchor it is
 * handed under a row lock (migration 527) but never recomputes it.
 */

function daysInUtcMonth(year: number, monthIndex: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

/**
 * Anchor `k` of a period that starts at `periodStart`: `periodStart` plus `k`
 * calendar months (k = 0 is the start itself). Throws a `RangeError` for a `k`
 * that is not a whole, non-negative number.
 */
export function monthlyAnchor(periodStart: Date, k: number): Date {
  if (!Number.isInteger(k) || k < 0) {
    throw new RangeError(`monthlyAnchor: k must be a whole number of months >= 0, got ${k}`)
  }
  const months = periodStart.getUTCMonth() + k
  const year = periodStart.getUTCFullYear() + Math.floor(months / 12)
  const monthIndex = months % 12
  const day = Math.min(periodStart.getUTCDate(), daysInUtcMonth(year, monthIndex))
  return new Date(
    Date.UTC(
      year,
      monthIndex,
      day,
      periodStart.getUTCHours(),
      periodStart.getUTCMinutes(),
      periodStart.getUTCSeconds(),
      periodStart.getUTCMilliseconds(),
    ),
  )
}

/**
 * The latest anchor of the period `[periodStart, periodEnd)` that `now` has
 * reached: the largest anchor that is `<= now` AND `< periodEnd`. The anchor
 * AT the period end is the next period's start — the renewal's grant, never
 * this one's — which is what keeps a year-end renewal from being granted twice.
 *
 * `null` before the period starts, for a period that ends before it begins,
 * or when any date is unreadable.
 */
export function latestMonthlyAnchor(periodStart: Date, periodEnd: Date, now: Date): Date | null {
  const start = periodStart.getTime()
  // Anchors are whole milliseconds, so "< periodEnd" is "<= periodEnd - 1".
  const limit = Math.min(now.getTime(), periodEnd.getTime() - 1)
  if (!Number.isFinite(start) || !Number.isFinite(limit) || limit < start) return null

  const bound = new Date(limit)
  // The anchor in the bound's own month is the largest candidate; when its
  // day (or time) has not come yet, the previous month's is the one.
  let k =
    (bound.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 +
    (bound.getUTCMonth() - periodStart.getUTCMonth())
  while (k > 0 && monthlyAnchor(periodStart, k).getTime() > limit) k -= 1
  return monthlyAnchor(periodStart, k)
}
