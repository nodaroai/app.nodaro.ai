/**
 * KIE.ai low-balance runway alert.
 *
 * The hourly balance snapshot (admin-kie-credits.ts `recordKieCreditSnapshot`,
 * wired into cleanup-cron.ts) has always recorded the number — nothing ever
 * looked at the trend. On 2026-08-31 20:31Z the KIE.ai account ran dry and the
 * first signal anyone got was four user jobs failing with
 * `[ALERT] KIE.ai account balance exhausted` (see providers/kie/client.ts) —
 * i.e. mid-generation, after the account was already empty.
 *
 * This computes a trailing-24h burn rate from the stored snapshots and warns
 * BEFORE the balance hits zero, whether or not a generation happens to run in
 * the meantime. It runs after every successful hourly snapshot, so "once per
 * hour" dedup is free — no extra state needed.
 *
 * Deliberately no fixed "alert below N credits" threshold: KIE pricing and
 * traffic both drift over time, so a hardcoded credit floor goes stale. Runway
 * (balance ÷ current burn rate) stays meaningful regardless.
 */

/** Tunable: warn when the trailing-24h burn implies less than this many hours
 *  of runway remain. 24h gives whoever tops up the account a full day's
 *  notice at the current burn rate. */
export const KIE_LOW_BALANCE_RUNWAY_HOURS = 24

/** Below this spacing between the two readings used for the burn calculation,
 *  "24h ago" is really "just now" and the resulting rate is noise dressed up
 *  as a trend — skip the check rather than alert (or stay silent) on it. */
const MIN_SNAPSHOT_SPREAD_HOURS = 6

const MS_PER_HOUR = 3_600_000

/** Shape of a `kie_credit_snapshots` row — matches the DB row directly so the
 *  cron can pass query results straight through with no adapter. */
export interface KieCreditSnapshotRow {
  credits: number
  recorded_at: string | Date
}

/**
 * Pure computation over stored snapshots — no DB access, so it is
 * unit-testable without mocking supabase. Returns the alert message to log,
 * or null when no alert is warranted (including "can't tell yet" cases: too
 * few snapshots, or the two readings aren't spread far enough apart).
 *
 * `now` is the reference time for "latest" and "24h earlier" — passed in
 * (rather than read via `Date.now()`) so callers get deterministic tests, and
 * so any snapshot rows dated after `now` (clock skew, a concurrent insert)
 * are ignored rather than mistaken for "latest".
 */
export function kieRunwayAlert(
  snapshots: readonly KieCreditSnapshotRow[],
  now: Date,
): string | null {
  if (!Array.isArray(snapshots) || snapshots.length < 2) return null

  const nowMs = now.getTime()
  const rows = snapshots
    .map((s) => ({
      credits: Number(s.credits),
      recordedAtMs: new Date(s.recorded_at).getTime(),
    }))
    .filter(
      (s) => Number.isFinite(s.credits) && Number.isFinite(s.recordedAtMs) && s.recordedAtMs <= nowMs,
    )
    .sort((a, b) => a.recordedAtMs - b.recordedAtMs)

  if (rows.length < 2) return null

  const latest = rows[rows.length - 1]
  const target = nowMs - 24 * MS_PER_HOUR

  // Closest-to-24h-earlier reading among every OTHER row (never the latest
  // reading against itself).
  let closest: (typeof rows)[number] | null = null
  let closestDelta = Infinity
  for (let i = 0; i < rows.length - 1; i++) {
    const delta = Math.abs(rows[i].recordedAtMs - target)
    if (delta < closestDelta) {
      closestDelta = delta
      closest = rows[i]
    }
  }
  if (!closest) return null

  const spreadHours = (latest.recordedAtMs - closest.recordedAtMs) / MS_PER_HOUR
  if (spreadHours < MIN_SNAPSHOT_SPREAD_HOURS) return null

  const drop = Math.max(0, closest.credits - latest.credits) // floored at 0
  // Scale the observed drop to a 24h-equivalent rate so a short (but >=6h)
  // window doesn't understate the burn — and so the "(<burn>/24h)" label in
  // the message stays honest. Identical to the raw drop once spreadHours is
  // exactly 24h.
  const burn24h = (drop * 24) / spreadHours

  if (latest.credits <= 0) {
    // An already-drained account alerts every hour regardless of the
    // computed burn (even a flat 0 -> 0 reading) — zero balance isn't a
    // "trend", it's the outage this alert exists to get ahead of.
    return formatAlert(latest.credits, 0, burn24h)
  }

  if (drop <= 0) return null // flat or rising balance — no runway concern

  const burnPerHour = drop / spreadHours
  const runwayHours = latest.credits / burnPerHour

  if (runwayHours >= KIE_LOW_BALANCE_RUNWAY_HOURS) return null

  return formatAlert(latest.credits, runwayHours, burn24h)
}

function formatAlert(balance: number, runwayHours: number, burn24h: number): string {
  return (
    `[ALERT] KIE.ai balance low: ${formatNum(balance)} credits, ` +
    `~${formatNum(runwayHours)}h of runway at the trailing-24h burn (${formatNum(burn24h)}/24h)`
  )
}

/** At most 1 decimal place, trailing ".0" trimmed — credits can be fractional
 *  (migration 317) but whole numbers shouldn't print noise. */
function formatNum(n: number): string {
  return Number(n.toFixed(1)).toString()
}
