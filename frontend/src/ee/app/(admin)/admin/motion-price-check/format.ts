/**
 * Admin → Motion price check: how its figures and its range read. The page
 * is English-only (an operator surface), so numbers are grouped the English
 * way whatever the browser's locale. A figure that is not there reads "—".
 *
 * The range is local days: the admin picks From and To, and the page asks
 * for From's local midnight up to the local midnight after To.
 */
import type { MotionPriceRun } from "@/ee/lib/motion-price-check-api"

export const MAX_RANGE_DAYS = 30

const NONE = "—"
const usdUnderOne = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })
const usdFromOne = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const credits = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })
const seconds = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })
const pct = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })

const known = (v: number | null): v is number => v !== null && Number.isFinite(v)

/** Four decimals under one dollar (a step costs fractions of a cent), two from one; the minus before the sign. */
export function formatUsd(v: number | null): string {
  if (!known(v)) return NONE
  const abs = Math.abs(v)
  const digits = (abs < 1 ? usdUnderOne : usdFromOne).format(abs)
  const zero = Number(digits.replace(/,/g, "")) === 0
  return `${v < 0 && !zero ? "-" : ""}$${digits}`
}

export function formatCredits(v: number | null): string {
  return known(v) ? credits.format(v) : NONE
}

export function formatCount(v: number): string {
  return count.format(v)
}

export function formatSeconds(v: number | null): string {
  return known(v) ? seconds.format(v) : NONE
}

/** A percentage the server already multiplied by 100. */
export function formatPct(v: number | null): string {
  return known(v) ? `${pct.format(v)}%` : NONE
}

const ENGINE_NAMES: ReadonlyMap<string, string> = new Map([
  ["prism", "Prism"],
  ["pulse", "Pulse"],
])
const STYLE_NAMES: ReadonlyMap<string, string> = new Map([
  ["precise", "Precise"],
  ["flex", "Flex"],
])

export const engineLabel = (engine: string): string => ENGINE_NAMES.get(engine) ?? engine
export const styleLabel = (style: string): string => STYLE_NAMES.get(style) ?? style

/** A run as the page names it: its trend's name, or "Hand" for one made by hand. */
export const runName = (run: Pick<MotionPriceRun, "kind" | "trendName">): string =>
  run.kind === "trend" ? (run.trendName ?? "Trend") : "Hand"

/** A resolution as the page names it; a draft's says so. */
export function resolutionLabel(resolution: string | null, draft: boolean): string {
  if (resolution === null) return NONE
  return draft ? `${resolution} (draft)` : resolution
}

const pad = (n: number): string => String(n).padStart(2, "0")

/** A local day as yyyy-mm-dd (from the local calendar, never the UTC date). */
export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** When something happened, in local time: yyyy-mm-dd HH:MM. */
export function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? NONE : `${dayOf(d)} ${formatClock(iso)}`
}

/** The local time of day, HH:MM. */
export function formatClock(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? NONE : `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** A yyyy-mm-dd day as its calendar parts, or null when it is not a real day. */
function partsOf(day: string): { y: number; m: number; d: number } | null {
  const match = DAY.exec(day)
  if (!match) return null
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const check = new Date(y, m - 1, d)
  return check.getFullYear() === y && check.getMonth() === m - 1 && check.getDate() === d ? { y, m, d } : null
}

/** The last seven local days, today included. */
export function defaultRange(now: Date): { fromDay: string; toDay: string } {
  return { fromDay: dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6)), toDay: dayOf(now) }
}

/**
 * What stops a range from being asked for, in the words the page shows, or
 * null when it can be: both days real, From not after To, and at most
 * `MAX_RANGE_DAYS` days, counted by the calendar with both ends included.
 */
export function rangeProblem(fromDay: string, toDay: string): string | null {
  const from = partsOf(fromDay)
  const to = partsOf(toDay)
  if (!from || !to) return "Pick a From and a To day"
  const days = (Date.UTC(to.y, to.m - 1, to.d) - Date.UTC(from.y, from.m - 1, from.d)) / 86_400_000 + 1
  if (days < 1) return "From must be on or before To"
  if (days > MAX_RANGE_DAYS) return `Pick ${MAX_RANGE_DAYS} days or fewer`
  return null
}

/** From's local midnight, and the local midnight after To (so To's whole day is in), as instants. */
export function rangeToIso(fromDay: string, toDay: string): { from: string; to: string } {
  const from = partsOf(fromDay)
  const to = partsOf(toDay)
  if (!from || !to) throw new RangeError(`Not a range of days: ${fromDay} – ${toDay}`)
  return {
    from: new Date(from.y, from.m - 1, from.d).toISOString(),
    to: new Date(to.y, to.m - 1, to.d + 1).toISOString(),
  }
}
