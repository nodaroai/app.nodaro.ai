/**
 * Business days, for the window in which content restricted after a copyright
 * notice may be restored after a counter-notice (17 U.S.C. § 512(g)(2)(C):
 * "not less than 10, nor more than 14, business days following receipt").
 *
 * The statute leaves two things open, and the window here is where every
 * reading agrees, so a restore inside it is timely under any of them:
 *   - "business day" is every weekday, or every weekday that is not a US
 *     federal holiday;
 *   - "not less than 10 business days following receipt" may allow a restore
 *     on the 10th business day itself, or only once ten full business days
 *     have passed.
 * So the window opens on the 11th business day after receipt counting holidays
 * out (ten full business days have passed under every reading) and closes on
 * the 14th counting every weekday (the earliest of the closings). Across any
 * 14 weekdays at most two federal holidays fall, so the window always holds
 * at least two weekdays.
 *
 * Dates are calendar dates in New York (the statute's jurisdiction). A
 * receipt is dated where it lands in New York, and day 1 is the first
 * business day after that date. Pure: no clock, no I/O.
 */

/** A calendar date, `YYYY-MM-DD`. */
export type IsoDate = string

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function toUtc(date: IsoDate): Date {
  const m = ISO_DATE.exec(date)
  if (!m) throw new Error(`Not a calendar date: ${date}`)
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (utc.toISOString().slice(0, 10) !== date) throw new Error(`Not a calendar date: ${date}`)
  return utc
}

function fromUtc(utc: Date): IsoDate {
  return utc.toISOString().slice(0, 10)
}

function addDays(date: IsoDate, days: number): IsoDate {
  const utc = toUtc(date)
  return fromUtc(new Date(utc.getTime() + days * 86_400_000))
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(date: IsoDate): number {
  return toUtc(date).getUTCDay()
}

/** Whether a calendar date is a Saturday or a Sunday. */
export function isWeekend(date: IsoDate): boolean {
  const day = weekday(date)
  return day === 0 || day === 6
}

function ymd(year: number, month: number, day: number): IsoDate {
  return fromUtc(new Date(Date.UTC(year, month - 1, day)))
}

/** The `nth` (1-based) given weekday of a month; `nth` -1 is the last one. */
function nthWeekday(year: number, month: number, day: number, nth: number): IsoDate {
  if (nth > 0) {
    const first = ymd(year, month, 1)
    const offset = (day - weekday(first) + 7) % 7
    return addDays(first, offset + (nth - 1) * 7)
  }
  const last = ymd(year, month + 1, 0)
  const back = (weekday(last) - day + 7) % 7
  return addDays(last, -back)
}

/** A holiday on a Saturday is observed the Friday before, on a Sunday the Monday after (5 U.S.C. § 6103(b)). */
function observed(date: IsoDate): IsoDate {
  const day = weekday(date)
  if (day === 6) return addDays(date, -1)
  if (day === 0) return addDays(date, 1)
  return date
}

const holidaysByYear = new Map<number, readonly IsoDate[]>()

/** The federal holidays of a year (5 U.S.C. § 6103(a)), each on the date it is observed. */
export function usFederalHolidays(year: number): readonly IsoDate[] {
  const known = holidaysByYear.get(year)
  if (known) return known
  const holidays = Object.freeze(computeHolidays(year))
  holidaysByYear.set(year, holidays)
  return holidays
}

function computeHolidays(year: number): IsoDate[] {
  return [
    observed(ymd(year, 1, 1)), // New Year's Day
    nthWeekday(year, 1, 1, 3), // Birthday of Martin Luther King, Jr.
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    nthWeekday(year, 5, 1, -1), // Memorial Day
    observed(ymd(year, 6, 19)), // Juneteenth National Independence Day
    observed(ymd(year, 7, 4)), // Independence Day
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 10, 1, 2), // Columbus Day
    observed(ymd(year, 11, 11)), // Veterans Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving Day
    observed(ymd(year, 12, 25)), // Christmas Day
  ]
}

/** Whether a date is a federal holiday as observed; the next year's New Year's Day can be observed on December 31. */
export function isUsFederalHoliday(date: IsoDate): boolean {
  const year = toUtc(date).getUTCFullYear()
  return usFederalHolidays(year).includes(date) || usFederalHolidays(year + 1).includes(date)
}

export interface BusinessDayReading {
  /** Whether a federal holiday is a business day (false: it is not counted). */
  readonly holidaysAreBusinessDays: boolean
}

/** The `n`th business day after `from` (which is not counted). */
export function addBusinessDays(from: IsoDate, n: number, reading: BusinessDayReading): IsoDate {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Count business days from 1: ${n}`)
  let date = from
  let counted = 0
  while (counted < n) {
    date = addDays(date, 1)
    if (isWeekend(date)) continue
    if (!reading.holidaysAreBusinessDays && isUsFederalHoliday(date)) continue
    counted += 1
  }
  return date
}

const NEW_YORK = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })

/** The calendar date an instant falls on in New York. */
export function newYorkDate(instant: Date): IsoDate {
  return NEW_YORK.format(instant)
}

export interface RestoreWindow {
  /** The receipt's date in New York. */
  readonly receivedOn: IsoDate
  /** The first day content may be restored: the 11th business day after receipt, holidays not counted (ten full business days have passed). */
  readonly opensOn: IsoDate
  /** The last day content may be restored: the 14th business day after receipt, every weekday counted. */
  readonly closesOn: IsoDate
}

/** The full business days that pass before content may be restored. */
export const FULL_BUSINESS_DAYS_BEFORE_RESTORE = 10
/** The business day by which content is restored. */
export const RESTORE_BY_BUSINESS_DAYS = 14

/** The window in which content may be restored after a counter-notice received at `receivedAt`. */
export function restoreWindow(receivedAt: Date): RestoreWindow {
  const receivedOn = newYorkDate(receivedAt)
  return {
    receivedOn,
    opensOn: addBusinessDays(receivedOn, FULL_BUSINESS_DAYS_BEFORE_RESTORE + 1, { holidaysAreBusinessDays: false }),
    closesOn: addBusinessDays(receivedOn, RESTORE_BY_BUSINESS_DAYS, { holidaysAreBusinessDays: true }),
  }
}

/** The weekday after a date: the next day that is not a Saturday or a Sunday. */
export function nextWeekday(date: IsoDate): IsoDate {
  return addBusinessDays(date, 1, { holidaysAreBusinessDays: true })
}

export type WindowPosition = "before" | "open" | "after"

/** Where a date stands against a window: too early to restore, inside it, or past its last day. */
export function windowPosition(window: Pick<RestoreWindow, "opensOn" | "closesOn">, today: IsoDate): WindowPosition {
  if (today < window.opensOn) return "before"
  if (today > window.closesOn) return "after"
  return "open"
}
