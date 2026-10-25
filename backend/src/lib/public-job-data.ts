import { withoutServerOnlyKeys } from "./job-output-visibility.js"

/**
 * Remove server-only fields from arbitrary job JSON before it crosses a public
 * API boundary. `unscoredUrl` is the private remux base used by Recast audio
 * replacement; it must never reach browsers, SDK consumers, MCP clients, or
 * even the admin UI.
 *
 * It also drops a job's server-only keys — the top-level `__` keys of its
 * `output_data` (plugins' resume checkpoints) and of its `input_data` (hidden
 * inputs such as a trend run's source clip and prompt parts); see
 * lib/job-output-visibility.ts — from every `output_data` and `input_data` it
 * meets in the value, so a whole row, a list of rows or an envelope around
 * them is covered. Only those objects' own top-level keys go; a `__` key
 * nested deeper stays. A bare `output_data` (not under that key) goes through
 * `redactPrivateJobOutput` instead.
 *
 * Supabase JSONB values are acyclic plain JSON, but this helper deliberately
 * handles shared/cyclic objects as well so a malformed mock or future adapter
 * cannot turn redaction into an infinite recursion. The input is never mutated.
 */
export function redactPrivateJobData<T>(value: T): T {
  return redact(value, new WeakMap<object, unknown>()) as T
}

/**
 * The redaction for a job's `output_data` read on its own (not inside a row):
 * its server-only top-level `__` keys dropped, then `redactPrivateJobData`.
 */
export function redactPrivateJobOutput<T>(output: T): T {
  return redactPrivateJobData(withoutServerOnlyKeys(output))
}

// ── child jobs and trend runs: what a NON-ADMIN job read leaves out ─────────

/**
 * The column that makes a job a CHILD: a step a worker-side handler ran for
 * its parent (`tk.http.workerRequest`). A child's `input_data` is what the
 * handler sent on the user's behalf — for Cast Swap, the engine's own prompt
 * wording and a silent copy of the source clip — and the parent's
 * `output_data` names it, so its owner can learn its id. A child is shown only
 * through its parent: the lists leave it out (`applyJobListFilters`), and every
 * read of a job BY ID answers a non-admin `query.is(CHILD_JOB_COLUMN, null)`,
 * so a child reads exactly as a job that does not exist. Admins keep reading
 * children. Workers and server-side waits read the raw row and are untouched.
 */
export const CHILD_JOB_COLUMN = "parent_job_id"

/**
 * The column that puts a job in the Trash (migration 561): `DELETE
 * /v1/jobs/:id` stamps it, `POST /v1/jobs/:id/restore` clears it, and 30 days
 * on the purge deletes the job for good (lib/job-trash-purge.ts). A job in the
 * Trash reads, for EVERY caller and every user-facing read — lists, a read by
 * id, status polls, the gallery, session feeds, MCP tools — exactly as a job
 * that does not exist: `query.is(TRASHED_JOB_COLUMN, null)`. Only the Trash
 * itself (`GET /v1/trash`) and its restore / delete-for-good routes read one.
 * Totals of work done and credits spent keep counting it until the purge.
 * `lib/__tests__/job-trash-reads.test.ts` holds every jobs read to it.
 */
export const TRASHED_JOB_COLUMN = "deleted_at"

/** What a non-admin reads in place of a trend run's failure text. */
export const TREND_RUN_FAILURE_MESSAGE = "This run didn't finish."

/**
 * The select fragment a job read adds when it does not read `input_data`
 * itself (the lean status reads), so `maskTrendRunError` can tell a trend run.
 * The alias is removed by `maskTrendRunError` for every caller.
 */
export const TREND_RUN_MARKER_SELECT = "trend_run_marker:input_data->trend"
const TREND_RUN_MARKER = "trend_run_marker"

function isTrendRun(row: Record<string, unknown>): boolean {
  if (row[TREND_RUN_MARKER] != null) return true
  const input = row.input_data
  return !!input && typeof input === "object" && !Array.isArray(input) && (input as Record<string, unknown>).trend != null
}

/**
 * A job row as a job read returns it: the trend-run marker (if selected)
 * removed, and — for a NON-ADMIN — a trend run's `error_message` replaced with
 * `TREND_RUN_FAILURE_MESSAGE`. A trend run's failure can quote any part of its
 * hidden input (the source clip, a role name, the trend prompt), whole or in
 * pieces, so no filter over the text is safe. `error_hint` stays: it is the
 * user-safe channel. A row with no failure text keeps its null. Admins author
 * the hidden data and read the real text. Never mutates the row.
 */
export function maskTrendRunError<T extends object>(row: T, isAdmin: boolean): T {
  const rec = row as unknown as Record<string, unknown>
  const trend = isTrendRun(rec)
  if (!(TREND_RUN_MARKER in rec) && (isAdmin || !trend || rec.error_message == null)) return row
  const { [TREND_RUN_MARKER]: _marker, ...rest } = rec
  if (!isAdmin && trend && rest.error_message != null) rest.error_message = TREND_RUN_FAILURE_MESSAGE
  return rest as unknown as T
}

/** `maskTrendRunError` over a list of rows. */
export function maskTrendRunErrors<T extends object>(rows: readonly T[], isAdmin: boolean): T[] {
  return rows.map((row) => maskTrendRunError(row, isAdmin))
}

/** A trend run's failure text as a non-admin reads it, from the text and the job's `input_data` (or marker). */
export function trendRunErrorText(
  errorMessage: string | null | undefined,
  inputData: unknown,
  isAdmin: boolean,
): string | null {
  const masked = maskTrendRunError({ error_message: errorMessage ?? null, input_data: inputData }, isAdmin)
  return masked.error_message
}

function redact(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value === null || typeof value !== "object") return value

  const existing = seen.get(value)
  if (existing !== undefined) return existing

  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(redact(item, seen))
    return copy
  }

  const copy: Record<string, unknown> = {}
  seen.set(value, copy)
  for (const [key, item] of Object.entries(value)) {
    if (key === "unscoredUrl") continue
    Object.defineProperty(copy, key, {
      value: redact(key === "output_data" || key === "input_data" ? withoutServerOnlyKeys(item) : item, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    })
  }
  return copy
}
