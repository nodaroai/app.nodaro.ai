/**
 * The admin expunge also erases, for the app's own runs only, the runner's
 * content on the linked `workflow_executions` rows and their `jobs` rows
 * (decided 2026-10-06). It keeps the runner's own library uploads: their
 * `assets` rows belong to the runner, not to the app.
 *
 * Every route test mocks supabase, so a column that does not exist — or a NOT
 * NULL column cleared to null — passes them all and fails only against the
 * real database. These checks read the migrations instead.
 *
 * Each table's columns are sorted into "erased" (the redaction patch in
 * `lib/app-run-content.ts`) and "kept" (the lists below). A column a later
 * migration adds fails the totality case until someone decides which side it
 * is on.
 */
import { describe, expect, it } from "vitest"
import {
  APP_RUN_USER_CONTENT_COLUMNS,
  appReportContentRedaction,
  appRunContentRedaction,
  executionContentRedaction,
  jobContentRedaction,
} from "../app-run-content.js"
import { migrationColumnsOf, migrationNotNullColumnsOf } from "../../test/migration-columns.js"

/** `workflow_executions` columns expunge keeps: the run's record, not its content. */
const KEPT_EXECUTION_COLUMNS = [
  "id",
  "workflow_id",
  "user_id",
  "status",
  "trigger_type",
  // A trigger's payload (036). An app run's execution holds only ids there:
  // the run it belongs to (lib/app-run-stamp.ts) and, for a Render final, the
  // version and the execution it continues. Expunge finds a run's executions
  // through these stamps, so they stay.
  "trigger_data",
  "total_nodes",
  "completed_nodes",
  "failed_nodes",
  "total_credits_used",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at",
  "is_component_execution",
  "idempotency_key",
  "workspace_id",
  "org_id",
  "runtime_env",
  "mcp_client",
]

/** `jobs` columns expunge keeps: billing, status, provenance and pointers. */
const KEPT_JOB_COLUMNS = [
  "id",
  "user_id",
  "job_type",
  "status",
  "provider",
  "provider_kind",
  "provider_task_id",
  "provider_call_started_at",
  "provider_cost",
  "display_cost",
  "credits",
  "credits_actual",
  "relay_credits",
  "relay_job_id",
  "billing_force_refund",
  "priority",
  "progress",
  "created_at",
  "started_at",
  "completed_at",
  "stop_requested_at",
  "slot_wait_ms",
  "usage_log_id",
  // The failure's structured class (376): a fixed code, not the runner's text.
  // The failure lines themselves — `error_message` and the raw `error_detail`
  // — are erased.
  "error_hint",
  "reconcile_attempts",
  "finalize_claimed_at",
  "finalize_claimed_by",
  // A held job's moment and its computed non-output fields (provider, costs)
  // and own object keys (377). Expunge skips a run while a job of it is held,
  // so on the rows it erases these are leftovers of a review that already ended.
  "held_at",
  "held_completion_fields",
  "held_objects",
  "idempotency_key",
  "is_public",
  "force_private",
  "should_watermark",
  "mcp_client",
  "source",
  "source_detail",
  "app_slug",
  "node_id",
  "workflow_id",
  "workflow_execution_id",
  "pipeline_id",
  "parent_job_id",
  "org_id",
  "workspace_id",
  // Server provenance, immutable by trigger (394: "Job submission context is
  // immutable") — an UPDATE that changes it raises, so it cannot be erased.
  "submission_context",
]

/**
 * `app_reports` columns expunge keeps on the reports filed for the erased jobs
 * and executions (decided 2026-10-07): the rows stay, for ops counts, kinds
 * and timestamps. What the sweeps copy from a job's or an execution's errors
 * and prompts — `title` and `payload` — is erased.
 */
const KEPT_REPORT_COLUMNS = [
  "id",
  // The reporter ('failure-sweep', 'job-policy', …) and the report's class: a
  // fixed vocabulary written by the server, never the runner's text.
  "node",
  "kind",
  "severity",
  "status",
  "created_at",
  // The client app the job came from (`input_data.origin`, an app identifier
  // such as 'person'), indexed for per-app counts. Not a prompt or an error.
  "app_slug",
  // Pointers. `job_id` / `execution_id` are how the expunge finds the row (and
  // a retry finds it again), and the keys of the sweeps' dedup indexes
  // (261, 328): cleared, the sweep would file the same job or execution again.
  "user_id",
  "job_id",
  "execution_id",
]

describe("migration NOT NULL reader", () => {
  it("finds NOT NULL columns, and follows ALTER COLUMN ... DROP NOT NULL", () => {
    // A reader that found nothing would let every null redaction pass.
    const jobs = migrationNotNullColumnsOf("jobs")
    expect(jobs.has("id")).toBe(true)
    expect(jobs.has("input_data")).toBe(true) // 001: JSONB NOT NULL DEFAULT '{}'
    expect(jobs.has("output_data")).toBe(false)
    expect(jobs.has("workflow_id")).toBe(false) // 003 dropped NOT NULL
    const executions = migrationNotNullColumnsOf("workflow_executions")
    expect(executions.has("node_states")).toBe(true) // 036
    expect(executions.has("input_overrides")).toBe(false) // 466
    expect(executions.has("video_link_files")).toBe(false) // 487
    expect(executions.has("error_message")).toBe(false)
    expect(jobs.has("error_message")).toBe(false) // 001: TEXT, nullable
    const reports = migrationNotNullColumnsOf("app_reports")
    expect(reports.has("title")).toBe(true) // 261: TEXT NOT NULL
    expect(reports.has("payload")).toBe(true) // 261: JSONB NOT NULL DEFAULT '{}'
    expect(reports.has("job_id")).toBe(false)
    expect(reports.has("execution_id")).toBe(false) // 328
  })
})

const TABLES = [
  {
    table: "workflow_executions",
    patch: () => executionContentRedaction() as Record<string, unknown>,
    kept: KEPT_EXECUTION_COLUMNS,
  },
  { table: "jobs", patch: () => jobContentRedaction() as Record<string, unknown>, kept: KEPT_JOB_COLUMNS },
  {
    table: "app_runs",
    patch: () => appRunContentRedaction() as Record<string, unknown>,
    kept: null,
  },
  {
    table: "app_reports",
    patch: () => appReportContentRedaction() as Record<string, unknown>,
    kept: KEPT_REPORT_COLUMNS,
  },
] as const

describe.each(TABLES)("$table — the redaction patch", ({ table, patch, kept }) => {
  const columns = migrationColumnsOf(table)
  const notNull = migrationNotNullColumnsOf(table)

  it("names only columns that exist", () => {
    const erased = Object.keys(patch())
    expect(erased.length).toBeGreaterThan(0)
    const missing = erased.filter((c) => !columns.has(c))
    expect(missing, `${table} has no ${missing.join(", ")}`).toEqual([])
  })

  it("never clears a NOT NULL column to null", () => {
    const bad = Object.entries(patch())
      .filter(([column, value]) => value === null && notNull.has(column))
      .map(([column]) => column)
    expect(bad, `${table}: NOT NULL columns cleared to null: ${bad.join(", ")}`).toEqual([])
  })

  it("returns a fresh patch each time", () => {
    // A shared `{}` handed to a client that mutates it would leak across calls.
    const a = patch()
    const b = patch()
    expect(a).toEqual(b)
    for (const [column, value] of Object.entries(a)) {
      if (value && typeof value === "object") expect(value).not.toBe(b[column])
    }
  })

  if (kept) {
    it("every column is either erased or deliberately kept", () => {
      const erased = Object.keys(patch())
      const classified = new Set<string>([...erased, ...kept])
      const unclassified = [...columns].filter((c) => !classified.has(c)).sort()
      expect(unclassified, `classify these ${table} columns: ${unclassified.join(", ")}`).toEqual([])
      const both = erased.filter((c) => kept.includes(c))
      expect(both, `both erased and kept: ${both.join(", ")}`).toEqual([])
      const stale = kept.filter((c) => !columns.has(c))
      expect(stale, `no longer on ${table}: ${stale.join(", ")}`).toEqual([])
    })
  }
})

describe("what expunge erases", () => {
  it("clears an execution's node states, input overrides and error message", () => {
    // node_states is NOT NULL (036), so it becomes the empty map; the
    // input_overrides pin (466) is nullable and only ever an object or NULL.
    // error_message (036, nullable) too (decided 2026-10-07): the run-level
    // failure line repeats a child job's message ("Execution failed — child
    // job error …"), and the job's own copy is erased.
    // video_link_files (487, decided 2026-10-08): the files fetched from a Video
    // URL link — a runner's own episode — nullable, an object or NULL.
    expect(executionContentRedaction()).toEqual({
      node_states: {},
      input_overrides: null,
      video_link_files: null,
      error_message: null,
    })
  })

  it("clears a job's inputs, outputs, held output, error messages and input fingerprint", () => {
    // input_data is NOT NULL (001), so it becomes the empty object.
    // error_message (001, nullable) too (decided 2026-10-07): a failure line
    // can carry the request's own words.
    expect(jobContentRedaction()).toEqual({
      input_data: {},
      output_data: null,
      held_output_data: null,
      error_message: null,
      error_detail: null,
      input_fingerprint: null,
      reconcile_last_error: null,
    })
  })

  // Decided 2026-10-07: the reports filed for the erased jobs and executions
  // lose what the sweeps copied into them — the error line in `title`, the
  // error, raw provider error and prompt excerpt in `payload`. Both are NOT
  // NULL (261), so they become the empty string and the empty object.
  it("clears a report's title and payload", () => {
    expect(appReportContentRedaction()).toEqual({ title: "", payload: {} })
  })

  it("keeps the app_runs list it already had", () => {
    expect(Object.keys(appRunContentRedaction()).sort()).toEqual([...APP_RUN_USER_CONTENT_COLUMNS].sort())
  })
})
