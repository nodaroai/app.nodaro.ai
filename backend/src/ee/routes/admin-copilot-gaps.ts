import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { supabase } from "../../lib/supabase.js"
import { requireAdmin } from "../middleware/require-admin.js"
import { sendInternalError } from "../../lib/http-errors.js"
import { collectGaps, type MessageRow } from "../copilot/knowledge-gaps.js"

/**
 * Admin surface for the copilot knowledge-gap report, day by day.
 *
 * The CLI script (`scripts/copilot-knowledge-gaps.ts`) renders one rolling
 * window; this route serves the SAME mining per calendar day (UTC), so the
 * admin panel can browse "what did it hit yesterday / a week ago" and put two
 * days side by side to see what a teaching change actually resolved.
 *
 * Read-only, computed live from `copilot_messages` — no snapshot table, so
 * every day inside the message-retention window is browsable from day one and
 * there is nothing to drift. TABLE-TOLERANT: a Business-edition install has
 * the admin panel but no copilot tables; a missing table reads as an empty
 * day, never a 500.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const PAGE = 1000
/** Per-day page cap — far above any real day; a backstop, not a quota. */
const MAX_PAGES = 20

const overviewQuery = z.object({
  days: z.coerce.number().int().min(1).max(30).default(14),
})

const dayQuery = z.object({
  day: z.string().regex(DAY_RE, "day must be YYYY-MM-DD"),
})

function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "42P01"
}

interface DayWindow {
  startIso: string
  endIso: string
}

/**
 * True only for a real calendar date. The regex alone lets through month 13
 * (parses to NaN → toISOString throws → 500) and Feb 31 (V8 ROLLS OVER to
 * Mar 3 → silently reports the wrong day). The round-trip catches both.
 */
export function isValidCalendarDay(day: string): boolean {
  const t = Date.parse(`${day}T00:00:00.000Z`)
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === day
}

export function dayWindow(day: string): DayWindow {
  const start = new Date(`${day}T00:00:00.000Z`)
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

/** Oldest → newest list of `days` UTC day strings, ending on `now`'s UTC day. */
export function buildDayList(days: number, now: Date): string[] {
  const dayMs = 24 * 60 * 60 * 1000
  const todayStart = new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`)
  return Array.from({ length: days }, (_, i) =>
    new Date(todayStart.getTime() - (days - 1 - i) * dayMs).toISOString().slice(0, 10),
  )
}

/** Count turn-failure rows per (day, title), title kept verbatim. */
export function groupTurnFailures(
  rows: Array<{ title: string | null; created_at: string }>,
): Array<{ title: string; count: number; day: string }> {
  const counts = new Map<string, { title: string; day: string; count: number }>()
  for (const row of rows) {
    const day = row.created_at.slice(0, 10)
    const title = row.title ?? "(untitled)"
    const key = `${day}\n${title}`
    const existing = counts.get(key)
    if (existing) existing.count += 1
    else counts.set(key, { title, day, count: 1 })
  }
  return [...counts.values()]
}

interface FetchedRows {
  rows: Array<MessageRow & { created_at: string }>
  truncated: boolean
}

/**
 * Page through user-role message rows in [startIso, endIso). Missing table →
 * empty. NEWEST FIRST on purpose: if the page cap ever trips on a multi-day
 * overview window, the dropped rows are the oldest days — never the recent
 * ones the admin opened this page for. Bucket grouping is order-independent
 * (only which sample string wins per bucket shifts).
 */
async function fetchMessageRows(startIso: string, endIso: string): Promise<FetchedRows> {
  const rows: Array<MessageRow & { created_at: string }> = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await supabase
      .from("copilot_messages")
      .select("thread_id, content, created_at")
      .eq("role", "user")
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) {
      if (isMissingTable(error)) return { rows: [], truncated: false }
      throw new Error(`copilot_messages query failed: ${error.message}`)
    }
    const batch = (data ?? []) as Array<MessageRow & { created_at: string }>
    rows.push(...batch)
    if (batch.length < PAGE) return { rows, truncated: false }
  }
  return { rows, truncated: true }
}

/** Turn-failure titles in the window, counted. Missing table → empty. */
async function fetchTurnFailures(startIso: string, endIso: string): Promise<Array<{ title: string; count: number; day: string }>> {
  const { data, error } = await supabase
    .from("app_reports")
    .select("title, created_at")
    .eq("kind", "copilot-turn-failure")
    .gte("created_at", startIso)
    .lt("created_at", endIso)
  if (error) {
    if (isMissingTable(error)) return []
    throw new Error(`app_reports query failed: ${error.message}`)
  }
  return groupTurnFailures((data ?? []) as Array<{ title: string | null; created_at: string }>)
}

const sumCounts = (buckets: Array<{ count: number }>): number =>
  buckets.reduce((total, bucket) => total + bucket.count, 0)

export async function adminCopilotGapsRoutes(app: FastifyInstance) {
  /**
   * Per-day totals for the day strip: how many messages were scanned and how
   * many rejection / heal / turn-failure HITS each day produced. One scan of
   * the whole window, grouped here.
   */
  app.get("/v1/admin/copilot-gaps/overview", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = overviewQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }
    try {
      const { days } = parsed.data
      const dayList = buildDayList(days, new Date())
      const windowStart = dayWindow(dayList[0]).startIso
      const windowEnd = dayWindow(dayList[dayList.length - 1]).endIso

      const [{ rows, truncated }, failures] = await Promise.all([
        fetchMessageRows(windowStart, windowEnd),
        fetchTurnFailures(windowStart, windowEnd),
      ])

      const byDay = new Map<string, MessageRow[]>()
      for (const row of rows) {
        const day = row.created_at.slice(0, 10)
        const list = byDay.get(day)
        if (list) list.push(row)
        else byDay.set(day, [row])
      }
      const failuresByDay = new Map<string, number>()
      for (const failure of failures) {
        failuresByDay.set(failure.day, (failuresByDay.get(failure.day) ?? 0) + failure.count)
      }

      const out = dayList.map((day) => {
        const dayRows = byDay.get(day) ?? []
        const gaps = collectGaps(dayRows)
        return {
          day,
          messages: dayRows.length,
          rejections: sumCounts(gaps.rejections),
          adjustments: sumCounts(gaps.adjustments),
          turnFailures: failuresByDay.get(day) ?? 0,
        }
      })
      return { days: out, truncated }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to build the gaps overview")
    }
  })

  /** One day's full report: ranked buckets + turn-failure titles. */
  app.get("/v1/admin/copilot-gaps", { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = dayQuery.safeParse(req.query)
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.message } })
    }
    if (!isValidCalendarDay(parsed.data.day)) {
      return reply
        .status(400)
        .send({ error: { code: "validation_error", message: "day is not a valid calendar date" } })
    }
    try {
      const { startIso, endIso } = dayWindow(parsed.data.day)
      const [{ rows, truncated }, failures] = await Promise.all([
        fetchMessageRows(startIso, endIso),
        fetchTurnFailures(startIso, endIso),
      ])
      const { rejections, adjustments } = collectGaps(rows)
      return {
        day: parsed.data.day,
        scannedMessages: rows.length,
        truncated,
        rejections,
        adjustments,
        turnFailures: failures
          .map(({ title, count }) => ({ title, count }))
          .sort((a, b) => b.count - a.count),
      }
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to build the day's gap report")
    }
  })
}
