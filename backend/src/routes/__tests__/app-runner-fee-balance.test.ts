// @test-units-by-name names one node type (generate-image) as snapshot data and stubs the balance read on CreditsService; prices no node
/**
 * The app run's pre-run check of the creator's fee. A monetized app's fee is
 * settled from the runner's balance after the run and only what that balance
 * holds is collected, so a runner who cannot pay the run's listed price with
 * the fee is refused with a 402 before any row is written or anything is
 * enqueued. The creator's own run carries no fee and is not checked; an app
 * with no fee is not checked. The balance read is stubbed on `CreditsService`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => {
  const mockFrom = vi.fn()
  return {
    supabase: {
      from: mockFrom,
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
    },
  }
})

const edition = vi.hoisted(() => ({ credits: true }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/config.js")>()
  return { ...orig, isCloud: () => edition.credits, hasCredits: () => edition.credits, isCommunity: () => !edition.credits, isBusiness: () => false, hasAdmin: () => edition.credits }
})

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn().mockResolvedValue({}) },
}))

const mockExecuteAppRun = vi.hoisted(() => vi.fn())
vi.mock("@/services/app-execution.js", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>
  return { ...orig, executeAppRun: (p: unknown) => mockExecuteAppRun(p) }
})

import { appRunnerRoutes, invalidateAppCache } from "../app-runner.js"
import { supabase } from "../../lib/supabase.js"
import { orchestrationQueue } from "../../lib/orchestration-queue.js"
import { CreditsService } from "../../ee/billing/credits.js"

const RUNNER = "00000000-0000-4000-8000-000000000001"
const CREATOR = "00000000-0000-4000-8000-000000000002"
const APP_ID = "00000000-0000-4000-8000-000000000010"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const EXECUTION_ID = "00000000-0000-4000-8000-000000000030"
const RUN_ID = "00000000-0000-4000-8000-000000000040"
const SLUG = "fee-app"

/** A monetized app: listed fee base 40, flat fee 1000, 25 % — 40 + 1000 + 10 = 1050 to run. */
const APP_ROW = {
  id: APP_ID,
  workflow_id: WORKFLOW_ID,
  creator_id: CREATOR,
  max_runs_per_user_per_day: null,
  snapshot_nodes: [{ id: "a", type: "generate-image", data: {} }],
  snapshot_edges: [],
  snapshot_settings: {},
  publish_type: "app",
  monetization_enabled: true,
  monetization_flat_fee: 1000,
  monetization_percent: 25,
  base_estimated_credits: 40,
}

function createChainMock(resolveValue: unknown, onSelect?: (cols: unknown) => void) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(resolveValue)
      return (...args: unknown[]) => {
        if (prop === "select") onSelect?.(args[0])
        return new Proxy({}, handler)
      }
    },
  }
  return new Proxy({}, handler)
}

function setupApp(row: Record<string, unknown>) {
  const tables: string[] = []
  const selects: unknown[] = []
  let callCount = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    tables.push(table)
    callCount++
    if (callCount === 1) return createChainMock({ data: { workflow_id: WORKFLOW_ID }, error: null }) as never
    if (callCount === 2) return createChainMock({ data: row, error: null }, (cols) => selects.push(cols)) as never
    if (table === "workflow_executions") return createChainMock({ data: { id: EXECUTION_ID }, error: null }) as never
    if (table === "app_runs") return createChainMock({ data: { id: RUN_ID }, error: null }) as never
    return createChainMock({ data: null, error: null }) as never
  })
  return { tables, selects }
}

let app: FastifyInstance
let covers: ReturnType<typeof vi.spyOn>
let eligibility: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  vi.clearAllMocks()
  edition.credits = true
  invalidateAppCache(SLUG)
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await appRunnerRoutes(instance)
  })
  await app.ready()
  eligibility = vi.spyOn(CreditsService, "checkAppRunEligibility").mockResolvedValue({ allowed: true })
  covers = vi.spyOn(CreditsService, "checkBalanceCovers").mockResolvedValue({ ok: true })
  mockExecuteAppRun.mockResolvedValue({ executionId: EXECUTION_ID, appRunId: RUN_ID, deduped: false })
})

afterEach(async () => {
  eligibility.mockRestore()
  covers.mockRestore()
  await app.close()
})

function run(userId: string, payload: Record<string, unknown> = {}) {
  return app.inject({ method: "POST", url: `/v1/app/${SLUG}/run`, headers: { "x-user-id": userId }, payload })
}

describe("an app run with the creator's fee is refused when the runner cannot pay it", () => {
  it("a balance below the listed price with the fee is a 402 before any row or enqueue", async () => {
    const { tables } = setupApp(APP_ROW)
    covers.mockResolvedValue({ ok: false, balance: 300 })
    const res = await run(RUNNER)
    expect(res.statusCode).toBe(402)
    expect(res.json()).toEqual({
      error: {
        code: "insufficient_credits",
        message: "This app costs about 1050 credits to run, including the creator's fee of 1010 credits; your balance is 300.",
      },
    })
    expect(covers).toHaveBeenCalledWith(RUNNER, 1050, undefined, expect.any(Boolean))
    expect(mockExecuteAppRun).not.toHaveBeenCalled()
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
    expect(tables).not.toContain("workflow_executions")
    expect(tables).not.toContain("app_runs")
  })

  it("the draft-run path (a runId) is refused the same way, before an execution row", async () => {
    const { tables } = setupApp(APP_ROW)
    covers.mockResolvedValue({ ok: false, balance: 300 })
    const res = await run(RUNNER, { runId: RUN_ID })
    expect(res.statusCode).toBe(402)
    expect(orchestrationQueue.add).not.toHaveBeenCalled()
    expect(tables).not.toContain("workflow_executions")
  })

  it("the payer is read as every balance check reads it (the request's billing context)", async () => {
    setupApp(APP_ROW)
    await run(RUNNER)
    expect(covers).toHaveBeenCalledTimes(1)
    expect(covers.mock.calls[0]?.[2]).toBeUndefined()
  })

  it("a balance that covers it lets the run proceed", async () => {
    setupApp(APP_ROW)
    const res = await run(RUNNER)
    expect(res.statusCode).toBe(202)
    expect(covers).toHaveBeenCalledTimes(1)
    expect(mockExecuteAppRun).toHaveBeenCalledTimes(1)
  })

  it("the version row is read with the fee and its base", async () => {
    const { selects } = setupApp(APP_ROW)
    await run(RUNNER)
    const cols = String(selects[0])
    for (const c of ["creator_id", "monetization_enabled", "monetization_flat_fee", "monetization_percent", "base_estimated_credits"]) {
      expect(cols).toContain(c)
    }
  })
})

describe("runs that carry no fee are not checked", () => {
  it("the creator running their own app", async () => {
    setupApp(APP_ROW)
    const res = await run(CREATOR)
    expect(res.statusCode).toBe(202)
    expect(covers).not.toHaveBeenCalled()
  })

  it("an app with monetization off", async () => {
    setupApp({ ...APP_ROW, monetization_enabled: false })
    const res = await run(RUNNER)
    expect(res.statusCode).toBe(202)
    expect(covers).not.toHaveBeenCalled()
  })

  it("an edition without credits", async () => {
    edition.credits = false
    setupApp(APP_ROW)
    const res = await run(RUNNER)
    expect(res.statusCode).toBe(202)
    expect(covers).not.toHaveBeenCalled()
  })
})
