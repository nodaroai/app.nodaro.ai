import { inputOverridesCleared } from "./execution-input-overrides.js"
import { videoLinkFilesCleared } from "./execution-video-link-files.js"

/**
 * The `app_runs` columns that hold a runner's own content — what the admin
 * expunge erases from every run of an app while keeping the run record
 * (credits, dates, the app-name snapshots) for earnings and audit.
 *
 * - `input_values` (migration 047): the inputs the runner entered, including
 *   the urls of media they uploaded.
 * - `node_states` (migration 082): results the runner edited after the run,
 *   merged over the execution's own node states — more media urls.
 * - `name` (migration 049): the label the runner typed for the run — free
 *   text that can carry personal data. Not a url, so the harvest skips it.
 *
 * One list for both halves of expunge: the R2-key harvest reads these
 * columns, and the redact step clears them. Every name here must exist on the
 * table, and every `app_runs` column must be either in this list or
 * deliberately kept — `lib/__tests__/app-run-content-columns.test.ts` checks
 * both against the migrations.
 */
export const APP_RUN_USER_CONTENT_COLUMNS = ["input_values", "node_states", "name"] as const

export type AppRunUserContentColumn = (typeof APP_RUN_USER_CONTENT_COLUMNS)[number]

/** The redact patch: every user-content column set to NULL. */
export function appRunContentRedaction(): Record<AppRunUserContentColumn, null> {
  return Object.fromEntries(APP_RUN_USER_CONTENT_COLUMNS.map((column) => [column, null])) as Record<
    AppRunUserContentColumn,
    null
  >
}

/**
 * What expunge erases on the app's own runs' `workflow_executions` rows
 * (decided 2026-10-06), and the value each column is cleared to:
 *
 * - `node_states` (036): every node's status, output and error — the
 *   generated results and their urls. NOT NULL, so it becomes the empty map.
 * - the pin (466, `inputOverridesCleared`): the inputs the run applied,
 *   pinned when it started. Nullable; a pin is an object or NULL. Until 466
 *   reaches the shared database (staging runs dev against it) the column is
 *   missing, and the guard module drops it from the patch once a write says so.
 * - the fetched files (487, `videoLinkFilesCleared`): the files the run fetched
 *   from a Video URL post link, with the link they came from — the runner's own
 *   episode (decided 2026-10-08). Nullable; an object or NULL. Dropped from the
 *   patch by its guard module while the column is missing, like the pin.
 * - `error_message` (036): the run-level failure line. The orchestrator and
 *   reconcile copy a child job's message into it ("Execution failed — child
 *   job error …"), and that job's own copy is erased, so this one is too
 *   (decided 2026-10-07). Nullable.
 *
 * Only the executions the expunge walk takes are written: the run's own, its
 * stamped re-runs and Render finals, and its component inner runs, each
 * ownership-checked there (`lib/app-expunge-targets.ts`).
 *
 * Every other column is the run's record and is kept; the list of kept
 * columns lives in `lib/__tests__/app-expunge-content-columns.test.ts`, which
 * fails on a new column until it is put on one side.
 */
export function executionContentRedaction(): { node_states: Record<string, never>; error_message: null } & ReturnType<
  typeof inputOverridesCleared
> &
  ReturnType<typeof videoLinkFilesCleared> {
  return { node_states: {}, ...inputOverridesCleared(), ...videoLinkFilesCleared(), error_message: null }
}

/**
 * What expunge erases on those executions' `jobs` rows, and the value each
 * column is cleared to:
 *
 * - `input_data` (001): the job's request — prompts, settings, input urls.
 *   NOT NULL, so it becomes the empty object.
 * - `output_data` (001): the job's result and its urls.
 * - `held_output_data` (377): a held job's result, waiting on a reviewer.
 * - `error_message` (001): the failure line shown to the user. Sanitized, but
 *   it can still carry the request's own words (decided 2026-10-07).
 * - `error_detail` (368): the provider's raw error, which can quote the prompt.
 * - `input_fingerprint` (144): a hash of the request body, prompt included.
 * - `reconcile_last_error` (138): the raw message of the last failed
 *   reconcile attempt, unredacted — the same provider/system text as
 *   `error_detail` (decided 2026-10-06).
 *
 * The runner's own library uploads are kept: their `assets` rows belong to the
 * runner, not the app, and are never touched here.
 */
export function jobContentRedaction(): {
  input_data: Record<string, never>
  output_data: null
  held_output_data: null
  error_message: null
  error_detail: null
  input_fingerprint: null
  reconcile_last_error: null
} {
  return {
    input_data: {},
    output_data: null,
    held_output_data: null,
    error_message: null,
    error_detail: null,
    input_fingerprint: null,
    reconcile_last_error: null,
  }
}

/**
 * What expunge erases on the `app_reports` rows filed for the erased jobs and
 * executions (decided 2026-10-07), and the value each column is cleared to.
 * The rows themselves stay, for ops counts, kinds and timestamps.
 *
 * - `title` (261): the one-liner for the admin list. The failure sweeps copy
 *   the job's or the execution's error line into it ("… failed: <error>").
 *   NOT NULL, so it becomes the empty string.
 * - `payload` (261): the detail. The job sweeps copy the error, the raw
 *   provider error and a prompt excerpt into it; the execution sweep, every
 *   failed node's error. NOT NULL, so it becomes the empty object.
 *
 * Every other column is kept: the reporter, kind, severity, review status and
 * timestamp, the client app it came from, and the pointers — `job_id` and
 * `execution_id` are how the rows are found, and the keys the sweeps dedup on
 * (261, 328), so a cleared row is not filed again. The kept list lives in
 * `lib/__tests__/app-expunge-content-columns.test.ts`.
 */
export function appReportContentRedaction(): { title: string; payload: Record<string, never> } {
  return { title: "", payload: {} }
}

/**
 * The columns the failure sweeps copy into a report (`lib/app-report-sweep.ts`):
 * a job's request, error line and raw provider error; an execution's error
 * line and node states. Each one is also in the expunge's patch above — the
 * types say so — so "erased" means exactly what the expunge writes.
 */
export const JOB_REPORT_SOURCE_COLUMNS = ["input_data", "error_message", "error_detail"] as const satisfies ReadonlyArray<
  keyof ReturnType<typeof jobContentRedaction>
>
export const EXECUTION_REPORT_SOURCE_COLUMNS = ["node_states", "error_message"] as const satisfies ReadonlyArray<
  keyof ReturnType<typeof executionContentRedaction>
>

function erasedTo(row: Readonly<Record<string, unknown>>, columns: readonly string[], patch: Readonly<Record<string, unknown>>): boolean {
  return columns.every((column) => JSON.stringify(row[column] ?? null) === JSON.stringify(patch[column]))
}

/** Every column a job report copies holds the value the expunge writes. */
export function jobReportSourceErased(row: Readonly<Record<string, unknown>>): boolean {
  return erasedTo(row, JOB_REPORT_SOURCE_COLUMNS, jobContentRedaction())
}

/** Every column an execution report copies holds the value the expunge writes. */
export function executionReportSourceErased(row: Readonly<Record<string, unknown>>): boolean {
  return erasedTo(row, EXECUTION_REPORT_SOURCE_COLUMNS, executionContentRedaction())
}
