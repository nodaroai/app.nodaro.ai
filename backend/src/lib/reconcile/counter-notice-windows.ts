import { supabase } from "../supabase.js"
import { hasAdmin } from "../config.js"
import { newYorkDate, nextWeekday } from "../business-days.js"
import { recordComplaintEvent } from "../rights-complaints.js"

/**
 * A counter-notice's restore window, noted on its case's log when it opens
 * and on the weekday before its last day (migration 587), and told to the
 * administrators' Slack where one is configured: the handler's screen shows
 * where a window stands at every read, and the log and the alert say when
 * each moment came, so a case nobody opened that week still carries it.
 *
 * Only for a counter-notice still waiting for a decision: not restored, not
 * held by a court action, not declined. Each note is claimed before it is
 * written (its stamp, from null, on a counter-notice still waiting), so two
 * servers on the same tick write it once; a note that fails releases its
 * claim, and the next pass writes it. Nothing here restores or forwards
 * anything: those are an administrator's steps.
 */

/** The notes one pass writes, at most; the next pass takes the rest. */
const PER_PASS = 200

type Moment = {
  readonly stamp: "window_opened_noted_at" | "window_closing_noted_at"
  readonly date: "window_opens_on" | "window_closes_on"
  readonly kind: string
  readonly alert: "opened" | "closing"
  /** The latest date the moment has come by, given today in New York. */
  readonly dueBy: (today: string) => string
}

const MOMENTS: readonly Moment[] = [
  { stamp: "window_opened_noted_at", date: "window_opens_on", kind: "restore_window_opened", alert: "opened", dueBy: (today) => today },
  // The weekday before the last day: a day left to restore in.
  { stamp: "window_closing_noted_at", date: "window_closes_on", kind: "restore_window_closing", alert: "closing", dueBy: nextWeekday },
]

export interface CounterNoticeWindowsResult {
  readonly noted: number
  readonly errors: number
}

interface DueRow {
  id: string
  reference: string
  complaint_id: string
  window_opens_on: string
  window_closes_on: string
}

/** The administrators' Slack, told (ee/, loaded the shim way where the edition has it). Never fails the note. */
async function alertQuietly(moment: Moment, row: DueRow): Promise<void> {
  if (!hasAdmin()) return
  try {
    const { alertCounterNoticeWindow } = await import("../../ee/lib/counter-notice-alerts.js")
    await alertCounterNoticeWindow(moment.alert, { reference: row.reference, complaintId: row.complaint_id, opensOn: row.window_opens_on, closesOn: row.window_closes_on })
  } catch (e) {
    console.warn(`[reconcile/counter-notice-windows] ${row.reference} not alerted:`, e instanceof Error ? e.message : e)
  }
}

async function noteMoment(moment: Moment, today: string, at: string): Promise<CounterNoticeWindowsResult> {
  const { data, error } = await supabase
    .from("rights_counter_notices")
    .select("id, reference, complaint_id, window_opens_on, window_closes_on")
    .is("restored_at", null)
    .is("court_action_at", null)
    .is("declined_at", null)
    .is(moment.stamp, null)
    .lte(moment.date, moment.dueBy(today))
    .limit(PER_PASS)
  if (error) throw new Error(`Counter-notice windows read failed: ${error.message}`)
  let noted = 0
  let errors = 0
  for (const row of (data ?? []) as DueRow[]) {
    const claim = await supabase
      .from("rights_counter_notices")
      .update({ [moment.stamp]: at })
      .eq("id", row.id)
      .is(moment.stamp, null)
      .is("restored_at", null)
      .is("court_action_at", null)
      .is("declined_at", null)
      .select("id")
      .maybeSingle()
    if (claim.error) {
      errors += 1
      continue
    }
    if (!claim.data) continue
    try {
      await recordComplaintEvent(row.complaint_id, moment.kind, "system", { reference: row.reference, opensOn: row.window_opens_on, closesOn: row.window_closes_on })
    } catch (e) {
      // Released, so the next pass writes it: a claimed note that was never written would be lost for good.
      const release = await supabase.from("rights_counter_notices").update({ [moment.stamp]: null }).eq("id", row.id)
      console.warn(
        `[reconcile/counter-notice-windows] ${row.reference} not noted${release.error ? " (and its claim not released)" : ""}:`,
        e instanceof Error ? e.message : e,
      )
      errors += 1
      continue
    }
    await alertQuietly(moment, row)
    noted += 1
  }
  return { noted, errors }
}

/** Notes every waiting counter-notice whose window opened, or reaches its last day by the next weekday, in New York. */
export async function noteCounterNoticeWindows(now: Date = new Date()): Promise<CounterNoticeWindowsResult> {
  const today = newYorkDate(now)
  const at = now.toISOString()
  let noted = 0
  let errors = 0
  for (const moment of MOMENTS) {
    const result = await noteMoment(moment, today, at)
    noted += result.noted
    errors += result.errors
  }
  return { noted, errors }
}
