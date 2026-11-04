/**
 * KIE's own figures for the Motion tasks of a range, for the admin's Motion
 * price check: what KIE's dashboard logs say each task consumed, in USD.
 *
 * The logs are read with the admin's dashboard session token (it changes per
 * session) and the server's `KIE_UNIQUE_ID`, through `fetchAllKieLogs` (the
 * Credit Audit's reader), once per view: the page sends the map back with
 * each list and drill-down request (`kieUsd`), so the token is used here and
 * nowhere else. It is never logged, kept or answered: an endpoint's error
 * that quotes it is scrubbed, and KIE's raw response samples are never
 * passed on.
 *
 * A step's KIE task may start after the range ends (a run started at its last
 * minute), so the logs are read up to `KIE_WINDOW_TAIL_MS` past it, never
 * past now.
 *
 * Only a task KIE has finished supplies a cost, its failure included: a task
 * that failed may still have consumed credits. A task still running may read
 * 0 credits, and the map outlives the read, so that 0 would beat what the step
 * records once it settles (`finishedCredits`).
 */
import { z } from "zod"
import { fetchAllKieLogs, type KieLogRecord } from "../../../providers/kie/credit-lookup.js"
import { KIE_CREDIT_USD } from "../../../providers/kie/models.js"
import type { KieRealResult } from "./wire.js"

/** How far past the range's end KIE's logs are read. */
export const KIE_WINDOW_TAIL_MS = 3 * 3600_000
/** 100 pages × 50: an endpoint that returned this many records may have been cut short. */
export const KIE_PAGE_CAP_RECORDS = 5_000
/** The most KIE figures one view carries (and the runs routes take back). */
export const MAX_KIE_TASKS = 10_000
/** The longest task id a figure is kept for. */
export const MAX_KIE_TASK_ID = 200

/** The `kieUsd` the runs routes take: task id (1–200 characters) → USD, a finite figure of 0 or more; at most `MAX_KIE_TASKS`. */
export const kieUsdSchema = z
  .record(z.string().min(1).max(MAX_KIE_TASK_ID), z.number().min(0))
  .refine((m) => Object.keys(m).length <= MAX_KIE_TASKS, { message: `At most ${MAX_KIE_TASKS} KIE task figures` })

const usableTaskId = (v: unknown): v is string => typeof v === "string" && v.length >= 1 && v.length <= MAX_KIE_TASK_ID

/** `admin_motion_task_ids`' one array (never rows: a row cap cannot cut it short) as the set of tasks to look up. */
export function motionTaskIdsOf(value: unknown): Set<string> {
  return new Set(Array.isArray(value) ? value.filter(usableTaskId) : [])
}

const NUMERIC = /^\d+(?:\.\d+)?$/

/** A record's credits: a number, or a numeric string, of 0 or more; else none. */
function creditsOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && NUMERIC.test(v) ? Number(v) : Number.NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** How a record says its task succeeded, as Credit Audit reads it. */
const SUCCEEDED: ReadonlySet<string> = new Set(["success", "completed", "done", "1"])
/** How a record says its task failed, as the KIE clients' polls read it. */
const FAILED: ReadonlySet<string> = new Set(["fail", "failed", "error"])

/**
 * What a record's task cost in KIE's credits, once KIE has finished it; else
 * none, so the step's recorded cost stands. Read from the log reader's `state`:
 * a word known to end a task counts, and any other (`waiting`, `queuing`,
 * `generating`, a word not known here, none at all) does not.
 *
 * The reader folds whatever it cannot read as a success into "fail", a running
 * VEO task's `successFlag: 0` and a `status` of "pending" among them, so a fail
 * with nothing consumed may be a task still running. It supplies no cost: a
 * failed task's credits count only when it has some.
 */
function finishedCredits(record: KieLogRecord): number | null {
  const state = String(record.state ?? "").toLowerCase()
  const credits = creditsOf(record.consumeCredits)
  if (SUCCEEDED.has(state)) return credits
  return FAILED.has(state) && credits !== null && credits > 0 ? credits : null
}

/** The window's end: `KIE_WINDOW_TAIL_MS` past the range's end, never past now. */
const windowEnd = (to: Date, now: Date): number => Math.min(now.getTime(), to.getTime() + KIE_WINDOW_TAIL_MS)

const windowOf = (from: Date, endMs: number): { from: string; to: string } => ({ from: from.toISOString(), to: new Date(endMs).toISOString() })

/** Each endpoint's error with the token taken out of it, whatever the text (an invalid header's error quotes the header). */
function scrubbed(errors: Record<string, string>, token: string): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).map(([label, message]) => {
    const text = String(message)
    return [label, token === "" ? text : text.split(token).join("[redacted]")]
  }))
}

/** How the log reader words KIE refusing the token (an expired session, or not a dashboard session token). */
const TOKEN_REFUSED = /\b401\b/
const MAX_CAUSES = 3
const MAX_CAUSE_CHARS = 160

/**
 * The 502's sentence for a read that failed, from its endpoints' (scrubbed)
 * errors: the token is blamed only when every endpoint refused it; otherwise
 * each distinct cause is named (at most three, each kept short), so a
 * timeout or a 5xx never reads as a bad token.
 */
export function kieFailureMessage(errors: Record<string, string>): string {
  const causes = [...new Set(Object.values(errors))]
  if (causes.length === 0) return "KIE's logs could not be read."
  if (causes.every((cause) => TOKEN_REFUSED.test(cause))) {
    return "KIE refused the token: it has expired, or it is not a KIE dashboard session token."
  }
  const named = causes.slice(0, MAX_CAUSES).map((cause) => (cause.length > MAX_CAUSE_CHARS ? `${cause.slice(0, MAX_CAUSE_CHARS - 1)}…` : cause))
  const more = causes.length > MAX_CAUSES ? `; and ${causes.length - MAX_CAUSES} more` : ""
  return `KIE's logs could not be read: ${named.join("; ")}${more}`
}

/** The answer for a range with no Motion task: nothing to look up, so KIE is never asked. */
export function noMotionTasks(o: { from: Date; to: Date; now?: Date }): KieRealResult {
  const now = o.now ?? new Date()
  return {
    kieUsd: {},
    window: windowOf(o.from, windowEnd(o.to, now)),
    motionTasks: 0,
    matched: 0,
    truncated: false,
    kieRecords: 0,
    capped: [],
    errors: {},
    fetchedAt: now.toISOString(),
  }
}

/**
 * KIE's figures for `motionTaskIds`: each task's first finished record, at its
 * credits × `KIE_CREDIT_USD`. `matched` counts every Motion task with a figure;
 * the map keeps the first `MAX_KIE_TASKS` of them (`truncated` when there were
 * more), so it is always a valid `kieUsd`. `capped` lists the endpoints at the
 * page cap, `errors` the endpoints that failed (a token expired on some of them
 * still gives a partial map). No records at all with errors is `{ failed }`.
 *
 * The token is used trimmed, for KIE and for the scrub alike: fetch trims a
 * header value before it checks it and quotes the trimmed value in its
 * error, so a token pasted with whitespace around it is still scrubbed.
 */
export async function readKieReal(
  o: { token: string; from: Date; to: Date; now?: Date; motionTaskIds: ReadonlySet<string> },
  fetchLogs: typeof fetchAllKieLogs = fetchAllKieLogs,
): Promise<KieRealResult | { failed: Record<string, string> }> {
  const token = o.token.trim()
  const now = o.now ?? new Date()
  const endMs = windowEnd(o.to, now)
  const { records, sources, errors } = await fetchLogs(token, o.from.getTime(), endMs)
  const failures = scrubbed(errors, token)
  if (records.length === 0 && Object.keys(failures).length > 0) return { failed: failures }
  const found = new Map<string, number>()
  for (const record of records) {
    const taskId = record.taskId
    if (!usableTaskId(taskId) || !o.motionTaskIds.has(taskId) || found.has(taskId)) continue
    const credits = finishedCredits(record)
    if (credits !== null) found.set(taskId, credits * KIE_CREDIT_USD)
  }
  return {
    kieUsd: Object.fromEntries([...found].slice(0, MAX_KIE_TASKS)),
    window: windowOf(o.from, endMs),
    motionTasks: o.motionTaskIds.size,
    matched: found.size,
    truncated: found.size > MAX_KIE_TASKS,
    kieRecords: records.length,
    capped: Object.entries(sources).filter(([, count]) => count >= KIE_PAGE_CAP_RECORDS).map(([label]) => label),
    errors: failures,
    fetchedAt: now.toISOString(),
  }
}
