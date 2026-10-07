/**
 * Who can review a Preview in a published app (Render final in the app
 * runner, decided 2026-10-04). Until the app runner had a Render final, every
 * app run counted as "nobody to review" and a Preview render refused. Now a
 * person in the app runner — and only there — is a reviewer: the run stops at
 * the preview and its card offers Render final. Every other caller (the SDK,
 * the CLI, MCP `run_app`, a headless call, an API token) is still refused, and
 * a component never stops for a review.
 *
 * With the stop rule off (`PREVIEW_STOP_RULE_ENABLED`), nothing changes: no
 * caller is refused, mark or not, and the orchestrator ignores the field.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  flag: true,
  executeAppRun: vi.fn(),
  queueAdd: vi.fn().mockResolvedValue({}),
  authKind: "jwt" as string,
  publishType: "app" as string,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => mocks.flag }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
vi.mock("@/lib/access-blocks.js", () => ({ isUserBlocked: vi.fn().mockResolvedValue(false) }))
vi.mock("@/middleware/credit-guard.js", () => ({ resolveWebSurfaceFlag: vi.fn().mockResolvedValue(false) }))
vi.mock("@/ee/billing/credits.js", () => ({
  CreditsService: { checkAppRunEligibility: vi.fn().mockResolvedValue({ allowed: true }) },
}))
vi.mock("@/services/app-execution.js", () => ({ executeAppRun: mocks.executeAppRun }))

import { appRunnerRoutes, invalidateAppCache } from "../app-runner.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const VERSION = "00000000-0000-4000-8000-000000000010"
const DRAFT = "00000000-0000-4000-8000-000000000040"

const previewSnapshot = {
  nodes: [
    { id: "cut", type: "apply-edl", data: { quality: "proxy", edl: { version: 1, sources: [], segments: [] } } },
    { id: "cap", type: "add-captions", data: {} },
  ],
  edges: [{ source: "cut", target: "cap" }],
}

function chain(result: unknown) {
  const self: Record<string, unknown> = {}
  for (const m of ["select", "eq", "is", "in", "limit", "order", "gte", "update", "insert"]) self[m] = () => self
  self.single = async () => result
  self.maybeSingle = async () => result
  self.then = (resolve: (v: unknown) => void) => resolve(result)
  return self
}

function mockTables() {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "published_apps") {
      // The draft lane lists the app's versions (#1930) before its own read.
      const versions = chain({ data: [{ id: VERSION }], error: null })
      const self = chain({
        data: {
          id: VERSION,
          workflow_id: "wf-1",
          creator_id: "creator-1",
          max_runs_per_user_per_day: null,
          snapshot_nodes: previewSnapshot.nodes,
          snapshot_edges: previewSnapshot.edges,
          snapshot_settings: {},
          publish_type: mocks.publishType,
        },
        error: null,
      })
      const select = self.select as () => unknown
      self.select = (columns?: string) => (columns === "id" ? versions : select())
      return self as never
    }
    if (table === "workflow_executions") return chain({ data: { id: "exec-draft" }, error: null }) as never
    if (table === "app_runs") return chain({ data: { id: DRAFT }, error: null }) as never
    throw new Error(`unexpected table ${table}`)
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  invalidateAppCache("my-app")
  mocks.flag = true
  mocks.authKind = "jwt"
  mocks.publishType = "app"
  mocks.executeAppRun.mockResolvedValue({ executionId: "exec-1", appRunId: "run-1", deduped: false })
  mockTables()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    ;(req as { authKind?: string }).authKind = mocks.authKind
  })
  await app.register(appRunnerRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const run = (payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/v1/app/my-app/run", payload })

describe("a Preview app run from the app runner stops at the preview", () => {
  it("the runner's mark makes a reviewer: the run is accepted and carries it", async () => {
    const res = await run({ reviewer: "app" })
    expect(res.statusCode).toBe(202)
    expect(mocks.executeAppRun.mock.calls[0]![0]).toMatchObject({ reviewerPresent: true })
  })

  it("a draft run from the app runner too", async () => {
    const res = await run({ reviewer: "app", runId: DRAFT })
    expect(res.statusCode).toBe(202)
    expect(mocks.queueAdd.mock.calls[0]![1]).toMatchObject({ reviewerPresent: true, appVersionId: VERSION })
  })
})

describe("everyone else is still nobody to review (TA9 a)", () => {
  it.each([
    ["no mark (the SDK's apps.run, the CLI)", { authKind: "jwt", body: {} }],
    ["an API token, mark or not", { authKind: "api_token", body: { reviewer: "app" } }],
    ["an MCP client", { authKind: "jwt", body: { reviewer: "app", mcp_client: "Claude" } }],
    ["a headless call", { authKind: "jwt", body: { reviewer: "app", headless: true } }],
    ["the editor's mark", { authKind: "jwt", body: { reviewer: "editor" } }],
  ])("%s is refused", async (_label, { authKind, body }) => {
    mocks.authKind = authKind
    const res = await run(body)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("preview_review_required")
    expect(mocks.executeAppRun).not.toHaveBeenCalled()
  })

  it("a component never stops for a review, even from the runner (permanent)", async () => {
    mocks.publishType = "component"
    const res = await run({ reviewer: "app" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("preview_render_nested")
  })
})

describe("with the stop rule off, nothing changes", () => {
  it("every caller runs, mark or not; only the app runner says a reviewer is there", async () => {
    mocks.flag = false
    expect((await run({})).statusCode).toBe(202)
    mocks.authKind = "api_token"
    expect((await run({ reviewer: "app" })).statusCode).toBe(202)
    mocks.authKind = "jwt"
    expect((await run({ reviewer: "app" })).statusCode).toBe(202)
    expect(mocks.executeAppRun.mock.calls.map((c) => (c[0] as { reviewerPresent?: boolean }).reviewerPresent)).toEqual([false, false, true])
  })
})

describe("a run's Render final shows over its preview", () => {
  const runRow = {
    id: DRAFT,
    app_id: VERSION,
    runner_id: USER,
    execution_id: "exec-run",
    final_execution_id: "exec-final",
    node_states: { plan: { editedEdl: { v: 1 } } },
    created_at: "2026-10-06T10:00:00Z",
    published_apps: { version: 1, thumbnail_node_id: "cut", workflow_id: "wf-1" },
    workflow_executions: {
      id: "exec-run",
      user_id: USER,
      workflow_id: "wf-1",
      status: "completed",
      node_states: {
        cut: { status: "completed", output: { videoUrl: "https://r2/preview.mp4", quality: "proxy" } },
        cap: { status: "skipped" },
      },
      total_credits_used: 12,
    },
  }
  const finalRow = {
    id: "exec-final",
    status: "completed",
    node_states: {
      plan: { status: "completed", output: { json: {} }, seededFromExecution: "exec-run" },
      cut: { status: "completed", output: { videoUrl: "https://r2/final.mp4", quality: "final" }, startedAt: "t" },
      cap: { status: "completed", output: { videoUrl: "https://r2/captioned.mp4" }, startedAt: "t" },
    },
    completed_nodes: 2,
    total_nodes: 2,
    error_message: null,
    completed_at: "2026-10-06T10:10:00Z",
    total_credits_used: 80,
  }
  const finalFilters: Array<[string, unknown]> = []

  beforeEach(() => {
    finalFilters.length = 0
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "app_runs") return chain({ data: runRow, error: null }) as never
      if (table === "workflow_executions") {
        const self = chain({ data: [finalRow], error: null })
        self.eq = (column: string, value: unknown) => {
          finalFilters.push([column, value])
          return self
        }
        return self as never
      }
      throw new Error(`unexpected table ${table}`)
    })
  })

  it("the final's results replace the preview's; the run's own credits stay its own", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/app/my-app/runs/${DRAFT}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.execution.nodeStates.cut.output).toMatchObject({ videoUrl: "https://r2/final.mp4", quality: "final" })
    expect(body.execution.nodeStates.cap.output.videoUrl).toBe("https://r2/captioned.mp4")
    expect(body.thumbnailUrl).toBe("https://r2/final.mp4")
    expect(body.creditsUsed).toBe(12)
    expect(body.finalExecution).toMatchObject({ id: "exec-final", status: "completed", creditsUsed: 80 })
    expect(body.nodeStateEdits).toEqual({ plan: { editedEdl: { v: 1 } } })
    // The final is read only when it is the runner's own (the service-role read bypasses RLS).
    expect(finalFilters).toContainEqual(["user_id", USER])
    // …and only when it is an execution of this app's workflow, as the run's own is (#1930).
    expect(finalFilters).toContainEqual(["workflow_id", "wf-1"])
  })

  // Review round 2: a final that completed the render and then failed further
  // on is not laid — the render shows its Preview again, with Render final on
  // it (the one the route accepts), and the failure is the run's final.
  it("a final that failed after completing the render: the preview stays, the final reads failed", async () => {
    const failed = { ...finalRow, status: "failed", error_message: "captions failed" }
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "app_runs") return chain({ data: runRow, error: null }) as never
      if (table === "workflow_executions") return chain({ data: [failed], error: null }) as never
      throw new Error(`unexpected table ${table}`)
    })
    const res = await app.inject({ method: "GET", url: `/v1/app/my-app/runs/${DRAFT}` })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.execution.nodeStates.cut.output).toMatchObject({ videoUrl: "https://r2/preview.mp4", quality: "proxy" })
    expect(body.execution.nodeStates.cap.status).toBe("skipped")
    expect(body.thumbnailUrl).toBe("https://r2/preview.mp4")
    expect(body.finalExecution).toMatchObject({ id: "exec-final", status: "failed", errorMessage: "captions failed" })
  })
})
