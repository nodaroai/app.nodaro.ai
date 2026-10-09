import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
// ---------------------------------------------------------------------------

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  const mockRpc = vi.fn()
  return { supabase: { from: mockFrom, rpc: mockRpc } }
})

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    R2_PUBLIC_URL: "https://r2.example.com",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(true),
}))

// Mock requireAdmin as passthrough — admin check tested separately per-test
vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: vi.fn(async () => {}),
}))

vi.mock("@/lib/collect-app-r2-keys.js", () => ({
  collectAppR2Keys: vi.fn().mockResolvedValue(["key1", "key2", "key3"]),
}))

/**
 * The linked executions and jobs (lib/app-expunge-targets.ts, tested on its
 * own against the migrations and for ownership). Here: the route's use of
 * them — read before anything changes, skip the runs still in flight, erase
 * before the app row goes.
 */
const RUN_DONE = "00000000-0000-4000-8000-000000000101"
const RUN_BUSY = "00000000-0000-4000-8000-000000000102"
const DEFAULT_TARGETS = {
  runIds: [RUN_DONE],
  skippedRunIds: [] as string[],
  levels: [
    {
      executionIds: ["00000000-0000-4000-8000-000000000201"],
      jobIds: ["00000000-0000-4000-8000-000000000301", "00000000-0000-4000-8000-000000000302"],
      appRunIds: [] as string[],
    },
    // A component's inner run, and its own app run on the component's app.
    {
      executionIds: ["00000000-0000-4000-8000-000000000202"],
      jobIds: [] as string[],
      appRunIds: ["00000000-0000-4000-8000-000000000901"],
    },
  ],
  unpointedExecutions: [] as Array<{ id: string; owner: string }>,
  runsBeforeRunTag: 1,
}
type Levels = { levels: Array<{ executionIds: string[]; jobIds: string[]; appRunIds?: string[] }> }
const counted = (t: Levels) => ({
  executions: t.levels.reduce((n, l) => n + l.executionIds.length, 0),
  jobs: t.levels.reduce((n, l) => n + l.jobIds.length, 0),
  innerRuns: t.levels.reduce((n, l) => n + (l.appRunIds?.length ?? 0), 0),
  // The reports filed for the erased jobs and executions (decided 2026-10-07):
  // here, one per execution.
  reports: t.levels.reduce((n, l) => n + l.executionIds.length, 0),
})
const mockCollectTargets = vi.hoisted(() => vi.fn())
const mockRedactTargets = vi.hoisted(() => vi.fn())
vi.mock("@/lib/app-expunge-targets.js", () => ({
  collectAppExpungeTargets: mockCollectTargets,
  redactAppExpungeTargets: mockRedactTargets,
}))

vi.mock("@/lib/storage.js", () => ({
  batchDeleteFromR2: vi.fn().mockResolvedValue({ deleted: 3, errors: 0 }),
}))

/**
 * THE RELAY DELETE RULE's shared predicate (lib/asset-delete.ts). Expunge
 * harvests urls straight out of `jobs.output_data`, and a relayed job's
 * output_data holds the FAR end's url — resolvable here because a shared bucket
 * means one R2_PUBLIC_URL. Default passthrough: with no relay target the real
 * predicate returns the input array unchanged and issues no query at all.
 */
const mockDeletableKeys = vi.hoisted(() =>
  vi.fn(async (keys: string[]) => [...keys]),
)
vi.mock("@/lib/asset-delete.js", () => ({ deletableKeys: mockDeletableKeys }))

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { adminRoutes } from "../admin.js"
import { supabase } from "../../../lib/supabase.js"
import { requireAdmin } from "../../middleware/require-admin.js"
import { collectAppR2Keys } from "../../../lib/collect-app-r2-keys.js"
import { batchDeleteFromR2 } from "../../../lib/storage.js"
import { migrationColumnsOf } from "../../../test/migration-columns.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "00000000-0000-4000-8000-000000000001"
const TEST_APP_ID = "00000000-0000-4000-8000-000000000099"
const TEST_REASON = "GDPR right-to-erasure request from user 12345"

const TEST_WORKFLOW_ID = "00000000-0000-4000-8000-0000000000f1"

const fakeApp = {
  id: TEST_APP_ID,
  slug: "my-test-app",
  deleted_at: "2026-05-01T10:00:00.000Z",
  workflow_id: TEST_WORKFLOW_ID,
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mockCollectTargets.mockResolvedValue({ ...DEFAULT_TARGETS })
  mockRedactTargets.mockImplementation(async (t: Levels) => counted(t))

  // Reset requireAdmin to passthrough for most tests
  vi.mocked(requireAdmin).mockImplementation(async () => {})

  app = Fastify({ logger: false })

  // Bypass auth — set userId from header
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") {
      req.userId = header
      req.userRole = undefined
    }
  })

  await app.register(async (instance) => {
    await adminRoutes(instance)
  })

  await app.ready()
})

afterEach(async () => {
  await app.close()
})

// ---------------------------------------------------------------------------
// DELETE /v1/admin/apps/:appId/expunge
// ---------------------------------------------------------------------------

describe("DELETE /v1/admin/apps/:appId/expunge", () => {
  it("returns 403 when caller is not admin", async () => {
    vi.mocked(requireAdmin).mockImplementationOnce(async (_req, reply) => {
      reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    })

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  it("returns 400 when reason is missing", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("reason_required")
  })

  it("returns 400 when reason is too short", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: "too short" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("reason_required")
  })

  it("returns 404 when app does not exist", async () => {
    const mockSingle = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
  })

  it("returns 400 when app is not soft-deleted", async () => {
    const liveApp = { ...fakeApp, deleted_at: null }
    const mockSingle = vi.fn().mockResolvedValue({ data: liveApp, error: null })
    const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("app_not_soft_deleted")
  })

  it("happy path: snapshots, redacts runs, deletes app, queues R2, audit logs", async () => {
    // Track all supabase.from() calls by table name
    const fromCalls: Record<string, ReturnType<typeof vi.fn>> = {}

    // Capture the audit insert mock at the outer scope so we can assert on it
    const auditInsertMock = vi.fn().mockResolvedValue({ error: null })
    const runRedactEq = vi.fn().mockResolvedValue({ error: null })
    const runRedactUpdate = vi.fn().mockReturnValue({ eq: runRedactEq })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        // First call: SELECT (single)
        // Second call: DELETE
        if (!fromCalls["published_apps_select"]) {
          const mockSingle = vi.fn().mockResolvedValue({ data: fakeApp, error: null })
          const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
          const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
          const mock = { select: mockSelect }
          fromCalls["published_apps_select"] = vi.fn().mockReturnValue(mock)
          return mock as never
        } else {
          // Second call: DELETE
          const mockEq = vi.fn().mockResolvedValue({ error: null })
          const mock = { delete: vi.fn().mockReturnValue({ eq: mockEq }) }
          return mock as never
        }
      }
      if (table === "app_runs") {
        return { update: runRedactUpdate } as never
      }
      if (table === "admin_actions") {
        return { insert: auditInsertMock } as never
      }
      return {} as never
    })

    // Mock RPC
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)

    // collectAppR2Keys returns 3 keys (already mocked globally)
    // batchDeleteFromR2 returns { deleted: 3, errors: 0 } (already mocked globally)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.success).toBe(true)
    expect(body.r2KeysCollected).toBe(3)
    expect(body.r2KeysDeleted).toBe(3)
    expect(body.r2Errors).toBe(0)
    expect(body.expungedAt).toBeTruthy()

    // Verify RPC called with correct args
    expect(supabase.rpc).toHaveBeenCalledWith("expunge_app_snapshots", { p_app_id: TEST_APP_ID })

    // Verify collectAppR2Keys called with appId: nothing skipped, nothing beyond the pointers
    expect(collectAppR2Keys).toHaveBeenCalledWith(TEST_APP_ID, { skipRunIds: new Set(), extraExecutions: [] })

    // Verify batchDeleteFromR2 called with the collected keys
    expect(batchDeleteFromR2).toHaveBeenCalledWith(["key1", "key2", "key3"])

    // Verify supabase.from was called with expected tables
    const fromArgs = vi.mocked(supabase.from).mock.calls.map((c) => c[0])
    expect(fromArgs).toContain("published_apps")
    expect(fromArgs).toContain("app_runs")
    expect(fromArgs).toContain("admin_actions")

    // The runs keep their record and lose the runner's content: the columns
    // that hold it, and nothing else.
    expect(runRedactUpdate).toHaveBeenCalledTimes(1)
    expect(runRedactUpdate).toHaveBeenCalledWith({ input_values: null, node_states: null, name: null })
    expect(runRedactEq).toHaveBeenCalledWith("app_id", TEST_APP_ID)

    // The app's own runs' executions and jobs are found by the app and its
    // workflow, and erased.
    expect(mockCollectTargets).toHaveBeenCalledWith(TEST_APP_ID, TEST_WORKFLOW_ID)
    expect(mockRedactTargets).toHaveBeenCalledWith(expect.objectContaining({ levels: DEFAULT_TARGETS.levels }))
    expect(body.executionsRedacted).toBe(2)
    expect(body.jobsRedacted).toBe(2)
    expect(body.runsErased).toBe(1)
    expect(body.runsSkipped).toBe(0)
    expect(body.appDeleted).toBe(true)
    // Decided 2026-10-07: the component inner runs' own app runs, and the
    // runs from before the run tag (whose earlier executions are not found).
    expect(body.innerRunsRedacted).toBe(1)
    expect(body.runsBeforeRunTag).toBe(1)
    // Decided 2026-10-07: the reports filed for those jobs and executions lose
    // their title and payload; the response counts them.
    expect(body.reportsRedacted).toBe(2)

    // Verify audit log insert was called with the correct payload
    expect(auditInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        admin_user_id: TEST_USER_ID,
        action: "expunge_app",
        target_type: "published_app",
        target_id: TEST_APP_ID,
        reason: TEST_REASON,
        payload: expect.objectContaining({
          slug: fakeApp.slug,
          executions_redacted: 2,
          jobs_redacted: 2,
          inner_runs_redacted: 1,
          reports_redacted: 2,
          runs_erased: 1,
          runs_skipped: 0,
          runs_before_run_tag: 1,
          app_deleted: true,
        }),
      }),
    )
  })
})

describe("DELETE /v1/admin/apps/:appId/expunge — the relay fence", () => {
  it("passes every harvested key through deletableKeys and never batches a kept one", async () => {
    // A published app whose runs relayed their generations: `collectAppR2Keys`
    // harvests the FAR end's urls out of jobs.output_data, and before this
    // fence they were batch-deleted with no marker consultation of any kind.
    vi.mocked(collectAppR2Keys).mockResolvedValueOnce(["images/far.png", "images/ours.png"])
    mockDeletableKeys.mockResolvedValueOnce(["images/ours.png"])

    let sawSelect = false
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        if (!sawSelect) {
          sawSelect = true
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: fakeApp, error: null }),
              }),
            }),
          } as never
        }
        return { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) } as never
      }
      if (table === "app_runs") {
        return { update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) } as never
      }
      if (table === "admin_actions") {
        return { insert: vi.fn().mockResolvedValue({ error: null }) } as never
      }
      return {} as never
    })
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(200)
    expect(mockDeletableKeys).toHaveBeenCalledWith(["images/far.png", "images/ours.png"])
    expect(batchDeleteFromR2).toHaveBeenCalledWith(["images/ours.png"])
  })
})

describe("DELETE /v1/admin/apps/:appId/expunge — the schema it writes", () => {
  it("clears and filters app_runs only by columns the migrations create", async () => {
    // Every case above mocks supabase, so a column that does not exist passes
    // them all. This one checks the names the route actually sends against the
    // migrations: the redact once cleared `input_data` / `output_data`, which
    // app_runs never had.
    const writes: Array<{ table: string; column: string }> = []
    let sawSelect = false
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "published_apps") {
        if (!sawSelect) {
          sawSelect = true
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: fakeApp, error: null }),
              }),
            }),
          } as never
        }
        return { delete: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) } as never
      }
      if (table === "app_runs") {
        return {
          update: (patch: Record<string, unknown>) => {
            for (const column of Object.keys(patch)) writes.push({ table, column })
            return {
              eq: (column: string) => {
                writes.push({ table, column })
                return Promise.resolve({ error: null })
              },
            }
          },
        } as never
      }
      if (table === "admin_actions") {
        return {
          insert: (row: Record<string, unknown>) => {
            for (const column of Object.keys(row)) writes.push({ table, column })
            return Promise.resolve({ error: null })
          },
        } as never
      }
      return {} as never
    })
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)

    const res = await app.inject({
      method: "DELETE",
      url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
      headers: { "x-user-id": TEST_USER_ID },
      payload: { reason: TEST_REASON },
    })

    expect(res.statusCode).toBe(200)
    expect(writes.some((w) => w.table === "app_runs")).toBe(true)
    const missing = writes.filter(({ table, column }) => !migrationColumnsOf(table).has(column))
    expect(missing.map(({ table, column }) => `${table}.${column}`)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The linked executions and jobs (decided 2026-10-06).
// ---------------------------------------------------------------------------

/** A supabase whose every step is logged in order: `<table>.<op>`. */
function orderedSupabase(
  steps: string[],
  selected: Array<{ table: string; column: string }> = [],
  runFilters: Array<[string, string, unknown]> = [],
) {
  let sawSelect = false
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "published_apps") {
      if (!sawSelect) {
        sawSelect = true
        return {
          select: (cols: string) => {
            for (const c of cols.split(",")) selected.push({ table, column: c.trim() })
            return {
              eq: () => ({
                single: async () => {
                  steps.push("published_apps.select")
                  return { data: fakeApp, error: null }
                },
              }),
            }
          },
        } as never
      }
      return {
        delete: () => ({
          eq: async () => {
            steps.push("published_apps.delete")
            return { error: null }
          },
        }),
      } as never
    }
    if (table === "app_runs") {
      return {
        update: () => {
          const chain = {
            eq: (column: string, value: unknown) => (runFilters.push(["eq", column, value]), chain),
            in: (column: string, value: unknown) => (runFilters.push(["in", column, value]), chain),
            then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
              steps.push("app_runs.update")
              return Promise.resolve({ error: null }).then(ok, bad)
            },
          }
          return chain
        },
      } as never
    }
    if (table === "admin_actions") {
      return {
        insert: async (row: Record<string, unknown>) => {
          steps.push("admin_actions.insert")
          audits.push(row)
          return { error: null }
        },
      } as never
    }
    return {} as never
  })
  vi.mocked(supabase.rpc).mockImplementation((async () => {
    steps.push("rpc.expunge_app_snapshots")
    return { data: null, error: null }
  }) as never)
  mockCollectTargets.mockImplementation(async () => {
    steps.push("targets.collect")
    return { ...DEFAULT_TARGETS }
  })
  mockRedactTargets.mockImplementation(async (t: Levels) => {
    steps.push("targets.redact")
    return counted(t)
  })
  vi.mocked(batchDeleteFromR2).mockImplementation(async () => {
    steps.push("r2.delete")
    return { deleted: 3, errors: 0, notDeleted: [], kept: [] }
  })
}

const audits: Array<Record<string, unknown>> = []
beforeEach(() => {
  audits.length = 0
})

const expunge = () =>
  app.inject({
    method: "DELETE",
    url: `/v1/admin/apps/${TEST_APP_ID}/expunge`,
    headers: { "x-user-id": TEST_USER_ID },
    payload: { reason: TEST_REASON },
  })

describe("DELETE /v1/admin/apps/:appId/expunge — the linked executions and jobs", () => {
  it("reads the targets before any change and erases them before the app row goes", async () => {
    const steps: string[] = []
    orderedSupabase(steps)

    const res = await expunge()

    expect(res.statusCode).toBe(200)
    expect(steps).toEqual([
      "published_apps.select",
      "targets.collect",
      "rpc.expunge_app_snapshots",
      "app_runs.update",
      "targets.redact",
      "published_apps.delete",
      "r2.delete",
      "admin_actions.insert",
    ])
  })

  it("selects the app's workflow from a column that exists", async () => {
    const steps: string[] = []
    const selected: Array<{ table: string; column: string }> = []
    orderedSupabase(steps, selected)

    await expunge()

    expect(selected.map((s) => s.column)).toContain("workflow_id")
    const missing = selected.filter(({ table, column }) => !migrationColumnsOf(table).has(column))
    expect(missing.map(({ table, column }) => `${table}.${column}`)).toEqual([])
  })

  // Decided 2026-10-06: the finished runs are erased now; a run with anything
  // still in flight is left whole, counted, and the app row stays so the admin
  // can expunge again once it has finished.
  it("erases the finished runs, skips the ones in flight, and keeps the app row for another pass", async () => {
    const steps: string[] = []
    const runFilters: Array<[string, string, unknown]> = []
    orderedSupabase(steps, [], runFilters)
    const extra = [{ id: "00000000-0000-4000-8000-000000000209", owner: TEST_USER_ID }]
    mockCollectTargets.mockImplementation(async () => {
      steps.push("targets.collect")
      return { ...DEFAULT_TARGETS, skippedRunIds: [RUN_BUSY], unpointedExecutions: extra }
    })

    const res = await expunge()

    expect(res.statusCode).toBe(200)
    expect(steps).toEqual([
      "published_apps.select",
      "targets.collect",
      "rpc.expunge_app_snapshots",
      "app_runs.update",
      "targets.redact",
      "r2.delete",
      "admin_actions.insert",
    ])
    // Only the finished runs lose their content.
    expect(runFilters).toContainEqual(["in", "id", [RUN_DONE]])
    expect(runFilters).toContainEqual(["eq", "app_id", TEST_APP_ID])
    // The skipped run's files stay; the extra executions' go.
    expect(collectAppR2Keys).toHaveBeenCalledWith(TEST_APP_ID, { skipRunIds: new Set([RUN_BUSY]), extraExecutions: extra })
    const body = res.json()
    expect(body).toMatchObject({ success: true, runsErased: 1, runsSkipped: 1, appDeleted: false })
    expect(audits[0]?.payload).toMatchObject({ runs_erased: 1, runs_skipped: 1, app_deleted: false })
  })

  it("erases nothing of the runs when every run is in flight, and keeps the app", async () => {
    const steps: string[] = []
    const runFilters: Array<[string, string, unknown]> = []
    orderedSupabase(steps, [], runFilters)
    mockCollectTargets.mockImplementation(async () => ({ runIds: [], skippedRunIds: [RUN_BUSY], levels: [], unpointedExecutions: [], runsBeforeRunTag: 0 }))

    const res = await expunge()

    expect(res.statusCode).toBe(200)
    expect(steps).not.toContain("app_runs.update")
    expect(steps).not.toContain("published_apps.delete")
    expect(res.json()).toMatchObject({ runsErased: 0, runsSkipped: 1, appDeleted: false })
  })

  it("answers 500, changing nothing, when the targets cannot be read", async () => {
    const steps: string[] = []
    orderedSupabase(steps)
    mockCollectTargets.mockRejectedValue(new Error("collectAppExpungeTargets failed at jobs: timeout"))

    const res = await expunge()

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("targets_failed")
    expect(steps).toEqual(["published_apps.select"])
  })

  it("answers 500 and keeps the app row and its files when the erase fails", async () => {
    // The app row stays, so the admin can run the expunge again: the runs
    // still point at their executions, and the executions' jobs at them.
    // (Storage keys named only in columns already cleared are not harvested
    // again — the files they name stay in R2.)
    const steps: string[] = []
    orderedSupabase(steps)
    mockRedactTargets.mockRejectedValue(new Error("redactAppExpungeTargets failed at jobs: timeout"))

    const res = await expunge()

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("linked_redact_failed")
    expect(steps).not.toContain("published_apps.delete")
    expect(steps).not.toContain("r2.delete")
  })
})
