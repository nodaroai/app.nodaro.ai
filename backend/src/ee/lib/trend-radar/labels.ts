/**
 * What the readings say: the day change, the label, and whether a candidate
 * passed the creator threshold. Pure over the readings, newest last.
 */
import type { TrendCandidateLabel, TrendCandidateReading, TrendCandidateStatus, TrendRadarThresholds } from "./types.js"

/** Plays growth from the previous reading, in percent; `null` with fewer than two readings or no base. */
export function dayChangePct(readings: readonly TrendCandidateReading[]): number | null {
  if (readings.length < 2) return null
  const last = readings[readings.length - 1]!
  const prev = readings[readings.length - 2]!
  if (prev.plays <= 0) return null
  return Math.round(((last.plays - prev.plays) / prev.plays) * 1000) / 10
}

/**
 * The label of the latest reading:
 * - `new`: one reading only;
 * - `slowing`: two days running under the slowing change (or no growth at all);
 * - `hot`: past twice the creator threshold and still growing;
 * - `rising`: growing at or past the rising change;
 * - `watching`: anything else.
 */
export function labelOf(readings: readonly TrendCandidateReading[], t: TrendRadarThresholds): TrendCandidateLabel {
  if (readings.length <= 1) return "new"
  const change = dayChangePct(readings)
  const prevChange = dayChangePct(readings.slice(0, -1))
  const last = readings[readings.length - 1]!
  if (change !== null && change < t.slowingPct && (prevChange === null || prevChange < t.slowingPct)) return "slowing"
  if (last.creators >= t.minCreators * 2 && change !== null && change > 0) return "hot"
  if (change !== null && change >= t.risingPct) return "rising"
  return "watching"
}

/**
 * The status the run writes, given the admin's current one. An admin's
 * decision (`approved`, `rejected`, `archived`) is never moved by the run.
 */
export function statusOf(current: TrendCandidateStatus, readings: readonly TrendCandidateReading[], t: TrendRadarThresholds): TrendCandidateStatus {
  if (current === "approved" || current === "rejected" || current === "archived") return current
  const last = readings[readings.length - 1]
  if (!last) return current
  const passed = last.creators >= t.minCreators
  if (!passed) return "watching"
  return labelOf(readings, t) === "slowing" ? "slowing" : "candidate"
}

/** `true` on the reading that first reaches the creator threshold. */
export function passesNow(readings: readonly TrendCandidateReading[], t: TrendRadarThresholds): boolean {
  const last = readings[readings.length - 1]
  if (!last || last.creators < t.minCreators) return false
  return readings.slice(0, -1).every((r) => r.creators < t.minCreators)
}
