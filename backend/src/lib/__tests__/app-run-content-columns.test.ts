/**
 * The admin expunge erases a run's user content by column NAME, and every
 * route test mocks supabase — so a column that does not exist passes them all
 * and fails only against the real database.
 *
 * That is what happened: expunge selected and cleared `app_runs.input_data` /
 * `output_data`, which no migration ever created. The first read of them (the
 * R2-key harvest) threw before anything was erased, so expunge could not
 * succeed on any app. The columns that do hold a runner's content are
 * `input_values` (migration 047) and `node_states` (082).
 *
 * These checks read the migrations instead of trusting a hand-kept list.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))

// The real one reaches for R2 config; the harvest only needs url → key.
vi.mock("@/ee/billing/cleanup-service.js", () => ({
  r2KeyFromUrl: (url: string) =>
    url.startsWith("https://r2.example.com/") ? url.slice("https://r2.example.com/".length) : null,
}))

import { supabase } from "../supabase.js"
import { collectAppR2Keys } from "../collect-app-r2-keys.js"
import { APP_RUN_USER_CONTENT_COLUMNS } from "../app-run-content.js"
import { migrationColumnsOf } from "../../test/migration-columns.js"

/**
 * Every `app_runs` column, sorted into what expunge erases and what it keeps.
 * A column added later fails the totality case below until someone decides
 * which side it is on — the decision this list exists to force.
 */
const KEPT_RUN_RECORD_COLUMNS = [
  "id",
  "app_id",
  "execution_id",
  "runner_id",
  "credits_used",
  "created_at",
  "status",
  "deleted_at",
  "app_name_snapshot",
  "app_slug_snapshot",
  // The runner's hidden node ids (081): ids of the app's own nodes, not text
  // or media the runner supplied, so the run record keeps them.
  "hidden_nodes",
  // The run's Render final (473): the id of a server-written execution, whose
  // media the harvest reaches through it, not content the runner supplied.
  "final_execution_id",
]

describe("migration column reader", () => {
  it("finds the columns app_runs really has, and only those", () => {
    // A reader that silently found nothing would pass every case below.
    const columns = migrationColumnsOf("app_runs")
    expect(columns.has("id")).toBe(true)
    expect(columns.has("input_values")).toBe(true)
    expect(columns.has("node_states")).toBe(true)
    expect(columns.has("app_slug_snapshot")).toBe(true)
    expect(columns.has("no_such_column_anywhere")).toBe(false)
    // The two names this test exists for.
    expect(columns.has("input_data")).toBe(false)
    expect(columns.has("output_data")).toBe(false)
  })

  it("follows RENAME and DROP COLUMN", () => {
    // 063 renamed jobs.credits_estimated → credits and dropped credits_used.
    const jobs = migrationColumnsOf("jobs")
    expect(jobs.has("credits")).toBe(true)
    expect(jobs.has("credits_estimated")).toBe(false)
    expect(jobs.has("credits_used")).toBe(false)
  })
})

describe("app_runs user-content columns", () => {
  const columns = migrationColumnsOf("app_runs")

  it("every column expunge erases exists on app_runs", () => {
    expect(APP_RUN_USER_CONTENT_COLUMNS.length).toBeGreaterThan(0)
    const missing = APP_RUN_USER_CONTENT_COLUMNS.filter((c) => !columns.has(c))
    expect(missing, `app_runs has no ${missing.join(", ")}`).toEqual([])
  })

  it("covers the columns that hold a runner's content", () => {
    // `name` (049) is the run label the runner types — free text, so erased.
    expect([...APP_RUN_USER_CONTENT_COLUMNS].sort()).toEqual(["input_values", "name", "node_states"])
  })

  it("every app_runs column is either erased or deliberately kept", () => {
    const classified = new Set<string>([...APP_RUN_USER_CONTENT_COLUMNS, ...KEPT_RUN_RECORD_COLUMNS])
    const unclassified = [...columns].filter((c) => !classified.has(c)).sort()
    expect(unclassified, `classify these app_runs columns: ${unclassified.join(", ")}`).toEqual([])
    const stale = KEPT_RUN_RECORD_COLUMNS.filter((c) => !columns.has(c))
    expect(stale, `no longer on app_runs: ${stale.join(", ")}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The R2-key harvest runs against a recording supabase: every column it
// selects or filters on is checked against the migrations.
// ---------------------------------------------------------------------------

type Touch = { table: string; column: string; via: string }

function recordingSupabase(
  rows: Record<string, unknown[]>,
  touched: Touch[],
  failing: Record<string, string> = {},
) {
  return (table: string) => {
    const note = (column: string, via: string) => touched.push({ table, column: column.trim(), via })
    const result = () =>
      failing[table] ? { data: null, error: { message: failing[table] } } : { data: rows[table] ?? [], error: null }
    const query = {
      select(cols: string) {
        for (const c of cols.split(",")) note(c, "select")
        return query
      },
      eq(col: string) {
        note(col, "eq")
        return query
      },
      in(col: string) {
        note(col, "in")
        return query
      },
      gt(col: string) {
        note(col, "gt")
        return query
      },
      order(col: string) {
        note(col, "order")
        return query
      },
      limit() {
        return query
      },
      single() {
        return Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null })
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject)
      },
    }
    return query as never
  }
}

describe("collectAppR2Keys", () => {
  it("reads only columns that exist, and harvests the runs' real content columns", async () => {
    const touched: Touch[] = []
    vi.mocked(supabase.from).mockImplementation(
      recordingSupabase(
        {
          published_apps: [{ creator_id: "00000000-0000-4000-8000-0000000000c1", icon_url: "https://r2.example.com/images/icon.png", preview_media_url: null, snapshot_nodes: null }],
          app_runs: [
            {
              id: "00000000-0000-4000-8000-000000000010",
              runner_id: "00000000-0000-4000-8000-0000000000a1",
              execution_id: "00000000-0000-4000-8000-000000000020",
              input_values: { "input-1": { imageUrl: "https://r2.example.com/uploads/runner-photo.png" } },
              node_states: { "gen-1": { results: [{ url: "https://r2.example.com/images/edited.png" }] } },
            },
          ],
          workflow_executions: [
            {
              id: "00000000-0000-4000-8000-000000000020",
              user_id: "00000000-0000-4000-8000-0000000000a1",
              node_states: { "gen-1": { url: "https://r2.example.com/images/00000000-0000-4000-8000-000000000030-gen.png" } },
            },
          ],
          jobs: [
            {
              id: "00000000-0000-4000-8000-000000000030",
              user_id: "00000000-0000-4000-8000-0000000000a1",
              workflow_execution_id: "00000000-0000-4000-8000-000000000020",
              output_data: { url: "https://r2.example.com/videos/00000000-0000-4000-8000-000000000030.mp4" },
            },
          ],
        },
        touched,
      ),
    )

    const keys = await collectAppR2Keys("00000000-0000-4000-8000-000000000099")

    expect(keys.sort()).toEqual(
      [
        "images/icon.png",
        "uploads/runner-photo.png",
        "images/edited.png",
        "images/00000000-0000-4000-8000-000000000030-gen.png",
        "videos/00000000-0000-4000-8000-000000000030.mp4",
      ].sort(),
    )

    expect(touched.length).toBeGreaterThan(0)
    const missing = touched.filter(({ table, column }) => !migrationColumnsOf(table).has(column))
    expect(
      missing.map(({ table, column, via }) => `${table}.${column} (${via})`),
      "collectAppR2Keys names columns no migration creates",
    ).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Whose objects expunge may delete. A runner's input can point at an object
// the app never made: a file they uploaded (`POST /v1/upload` gives it an
// `assets` row in their library, with no job), or a url they pasted — their
// own older library item, or another user's. Deleting those would break a
// library row expunge leaves in place, for a user who is not the subject of
// the erasure. A key is deletable only when every `assets` row that points at
// it came from one of this app's own jobs.
// ---------------------------------------------------------------------------

describe("collectAppR2Keys — objects the app does not own", () => {
  const APP_ID = "00000000-0000-4000-8000-000000000099"
  const RUNNER = "00000000-0000-4000-8000-0000000000a1"
  const OTHER_USER = "00000000-0000-4000-8000-0000000000b2"
  const APP_JOB = "00000000-0000-4000-8000-000000000030"
  const OTHER_JOB = "00000000-0000-4000-8000-000000000031"
  const EXECUTION = "00000000-0000-4000-8000-000000000020"
  // A job's output key is in its own key family (`<prefix>/<jobId>…`), or the
  // job-ownership fence drops it before the library check runs.
  const JOB_KEY = `videos/${APP_JOB}.mp4`
  // A node state's url counts only in the family of one of the app's own jobs.
  const APP_NODE_OUTPUT = `images/${APP_JOB}-gen.png`

  const fixture = (assets: unknown[]) => ({
    published_apps: [{ creator_id: "00000000-0000-4000-8000-0000000000c1", icon_url: null, preview_media_url: null, snapshot_nodes: null }],
    app_runs: [
      {
        id: "00000000-0000-4000-8000-000000000010",
        runner_id: RUNNER,
        execution_id: EXECUTION,
        input_values: {
          "input-1": { url: "https://r2.example.com/images/other-user-old.png" },
          "input-2": { url: "https://r2.example.com/uploads/runner-photo.png" },
        },
        node_states: null,
      },
    ],
    workflow_executions: [
      { id: EXECUTION, user_id: RUNNER, node_states: { "gen-1": { url: `https://r2.example.com/${APP_NODE_OUTPUT}` } } },
    ],
    jobs: [{ id: APP_JOB, user_id: RUNNER, workflow_execution_id: EXECUTION, output_data: { url: `https://r2.example.com/${JOB_KEY}` } }],
    assets,
  })

  it("keeps a pasted url backed by another user's library row out of the delete set", async () => {
    const touched: Touch[] = []
    vi.mocked(supabase.from).mockImplementation(
      recordingSupabase(
        fixture([
          { r2_key: "images/other-user-old.png", user_id: OTHER_USER, job_id: OTHER_JOB },
          // The app's own output, saved to the runner's library by the worker.
          { r2_key: JOB_KEY, user_id: RUNNER, job_id: APP_JOB },
        ]),
        touched,
      ),
    )

    const keys = await collectAppR2Keys(APP_ID)

    expect(keys).not.toContain("images/other-user-old.png")
    // The app's own objects are still erased.
    expect(keys).toContain(JOB_KEY)
    expect(keys).toContain(APP_NODE_OUTPUT)

    const missing = touched.filter(({ table, column }) => !migrationColumnsOf(table).has(column))
    expect(missing.map(({ table, column, via }) => `${table}.${column} (${via})`)).toEqual([])
  })

  it("keeps the runner's own upload, which no job of the app made", async () => {
    // Whether expunge should erase a runner's uploads — deleting the library
    // row and its storage accounting with the object — is an open decision.
    // Until it is made, the object stays with the row that points at it.
    vi.mocked(supabase.from).mockImplementation(
      recordingSupabase(fixture([{ r2_key: "uploads/runner-photo.png", user_id: RUNNER, job_id: null }]), []),
    )

    const keys = await collectAppR2Keys(APP_ID)

    expect(keys).not.toContain("uploads/runner-photo.png")
    expect(keys).toContain(JOB_KEY)
  })

  it("keeps an app output that another library row also points at", async () => {
    // A gallery save copies the url into the saver's library with no job.
    vi.mocked(supabase.from).mockImplementation(
      recordingSupabase(
        fixture([
          { r2_key: JOB_KEY, user_id: RUNNER, job_id: APP_JOB },
          { r2_key: JOB_KEY, user_id: OTHER_USER, job_id: null },
        ]),
        [],
      ),
    )

    const keys = await collectAppR2Keys(APP_ID)

    expect(keys).not.toContain(JOB_KEY)
    expect(keys).toContain(APP_NODE_OUTPUT)
  })

  it("counts only the execution owner's jobs as the app's, so a planted job cannot vouch for a key", async () => {
    // Both fences at once: a job row that merely names the run's execution
    // (written by someone else) is not one of the app's jobs, so a library
    // row filed under it does not make the object deletable.
    const base = fixture([{ r2_key: "images/other-user-old.png", user_id: OTHER_USER, job_id: OTHER_JOB }])
    vi.mocked(supabase.from).mockImplementation(
      recordingSupabase(
        {
          ...base,
          jobs: [
            ...base.jobs,
            {
              id: OTHER_JOB,
              user_id: OTHER_USER,
              workflow_execution_id: EXECUTION,
              output_data: { url: `https://r2.example.com/images/${OTHER_JOB}.png` },
            },
          ],
        },
        [],
      ),
    )

    const keys = await collectAppR2Keys(APP_ID)

    expect(keys).not.toContain("images/other-user-old.png")
    expect(keys).not.toContain(`images/${OTHER_JOB}.png`)
    expect(keys).toContain(JOB_KEY)
  })

  it("fails rather than delete when the library lookup errors", async () => {
    vi.mocked(supabase.from).mockImplementation(recordingSupabase(fixture([]), [], { assets: "timeout" }))

    await expect(collectAppR2Keys(APP_ID)).rejects.toThrow(/assets/)
  })
})
