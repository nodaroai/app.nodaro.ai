/**
 * Render final for agents (decided 2026-10-06): the SERVER is the single
 * source of the run set. `renderFinal: { renderNodeId }` on
 * POST /v1/workflows/:id/run, and its quote
 * (POST /v1/workflows/:id/render-final/estimate), derive the nodes the run
 * executes and the render's one-shot Final override from the saved graph —
 * by the rule the editor's Render final runs (`@nodaro/render-rules`). Both
 * sides read `fixtures/render-final-sets.json`; the editor's half is
 * frontend/.../__tests__/render-final-set-parity.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn().mockResolvedValue({ id: "orch-job-1" }),
  loadSource: vi.fn(),
  estimate: vi.fn(async () => 120),
  afford: vi.fn(async (_userId: string, required: number, _surface?: unknown) => ({ sufficient: true, required, available: 1000 }) as {
    sufficient: boolean
    required: number
    available: number | null
    message?: string
  }),
  inserts: [] as Array<Record<string, unknown>>,
  graph: { nodes: [] as unknown[], edges: [] as unknown[] },
  credits: true,
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => mocks.credits,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/preview-stop-rule-flag.js", () => ({ previewStopRuleEnabled: () => true }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(false) }))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: mocks.queueAdd } }))
vi.mock("@/lib/billing-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing-context.js")>()
  return { ...actual, resolveBillingContext: vi.fn(async (input: { userId: string }) => ({ payer: "user" as const, userId: input.userId })) }
})
vi.mock("@/lib/queue.js", () => ({
  videoQueue: { add: vi.fn(), getJob: vi.fn(), remove: vi.fn() },
  renderQueue: { add: vi.fn() },
  redis: {},
  tryRemoveFromQueue: vi.fn(),
}))
vi.mock("@/lib/sse.js", () => ({ createSSEStream: vi.fn() }))
vi.mock("@/lib/execution-events.js", () => ({ executionEvents: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } }))
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { refundCredits: vi.fn() }, estimateRunSetCredits: mocks.estimate, checkRunSetCredits: mocks.afford }))
vi.mock("@/ee/routes/credits.js", () => ({ invalidateBalanceCache: vi.fn() }))
vi.mock("@/lib/cancel-job.js", () => ({ cancelOwnedJob: vi.fn() }))
vi.mock("@/services/workflow-engine/run-continuation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/workflow-engine/run-continuation.js")>()
  return { ...actual, loadContinuationSource: mocks.loadSource }
})

import { workflowExecutionRoutes } from "../workflow-execution.js"
import { workflowRenderFinalRoutes } from "../workflow-render-final.js"
import { supabase } from "../../lib/supabase.js"

const USER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW = "00000000-0000-4000-8000-000000000020"
const PRIOR = "00000000-0000-4000-8000-000000000061"
const NEW_EXEC = "00000000-0000-4000-8000-000000000062"

interface Case {
  readonly nodes: ReadonlyArray<{ id: string; type: string; data: Record<string, unknown> }>
  readonly edges: ReadonlyArray<{ source: string; target: string; targetHandle?: string }>
  readonly runSet: readonly string[]
}
const HERE = dirname(fileURLToPath(import.meta.url))
const FIXTURE = JSON.parse(readFileSync(join(HERE, "fixtures", "render-final-sets.json"), "utf8")) as {
  readonly cases: Record<string, Case>
}
const cases = Object.entries(FIXTURE.cases)

function useGraph(c: Pick<Case, "nodes" | "edges">) {
  mocks.graph = {
    nodes: c.nodes.map((n) => ({ ...n, data: { ...n.data } })),
    edges: c.edges.map((e, i) => ({ ...e, id: `e${i}` })),
  }
}

function mockTables() {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "workflows") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: WORKFLOW, user_id: USER, workspace_id: null, visibility: "private", ...mocks.graph },
              error: null,
            }),
          }),
        }),
      } as never
    }
    if (table === "workflow_executions") {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
        insert: (row: Record<string, unknown>) => {
          mocks.inserts.push(row)
          return { select: () => ({ single: async () => ({ data: { id: NEW_EXEC }, error: null }) }) }
        },
      } as never
    }
    throw new Error(`unexpected table ${table}`)
  })
}

const source = (over: Record<string, unknown> = {}) => ({
  id: PRIOR,
  userId: USER,
  workflowId: WORKFLOW,
  status: "completed",
  appVersionId: null,
  inputOverrides: null,
  nodeStates: {},
  ...over,
})

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.inserts.length = 0
  mocks.credits = true
  useGraph(FIXTURE.cases["tighten"]!)
  mockTables()
  mocks.loadSource.mockResolvedValue(source())
  mocks.afford.mockImplementation(async (_userId: string, required: number) => ({ sufficient: true, required, available: 1000 }))
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = USER
    ;(req as { authKind?: string }).authKind = "api_token"
  })
  await app.register(async (instance) => {
    await workflowExecutionRoutes(instance)
    await workflowRenderFinalRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const run = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/workflows/${WORKFLOW}/run`, payload })
const quote = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: `/v1/workflows/${WORKFLOW}/render-final/estimate`, payload })

const renderFinal = { renderFinal: { renderNodeId: "render" }, continueFromExecutionId: PRIOR }

describe("the server's Render final run set matches the shared fixture", () => {
  it.each(cases)("run: %s", async (_name, c) => {
    useGraph(c)
    const res = await run(renderFinal)
    expect(res.statusCode).toBe(202)
    const job = mocks.queueAdd.mock.calls[0]![1] as Record<string, unknown>
    expect([...(job.nodeIds as string[])].sort()).toEqual([...c.runSet].sort())
    expect(job.inputOverrides).toEqual({ render: { quality: "final" } })
    expect(job.continueFromExecutionId).toBe(PRIOR)
  })

  it.each(cases)("quote: %s", async (_name, c) => {
    useGraph(c)
    const res = await quote({ renderNodeId: "render", continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(200)
    const data = res.json().data
    expect([...data.nodeIds].sort()).toEqual([...c.runSet].sort())
    expect(data.inputOverrides).toEqual({ render: { quality: "final" } })
  })
})

describe("renderFinal on POST /v1/workflows/:id/run", () => {
  const refusals: Array<[string, Record<string, unknown>, string]> = [
    ["a node the workflow does not have", { renderFinal: { renderNodeId: "nope" }, continueFromExecutionId: PRIOR }, "render_final_node_not_found"],
    ["a node that is not a render", { renderFinal: { renderNodeId: "c" }, continueFromExecutionId: PRIOR }, "render_final_not_a_render"],
    ["a missing renderNodeId", { renderFinal: {}, continueFromExecutionId: PRIOR }, "validation_error"],
    ["nodeIds sent with it: the server derives them", { ...renderFinal, nodeIds: ["render"] }, "validation_error"],
    ["inputOverrides sent with it: the override is the render's Final", { ...renderFinal, inputOverrides: { c: { fontSize: 40 } } }, "validation_error"],
    ["no execution to continue", { renderFinal: { renderNodeId: "render" } }, "validation_error"],
  ]
  it.each(refusals)("refuses %s, before any execution row exists", async (_name, payload, code) => {
    const res = await run(payload)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe(code)
    expect(typeof res.json().error.message).toBe("string")
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("the continuation is checked as on any continued run", async () => {
    mocks.loadSource.mockResolvedValue(source({ status: "failed" }))
    const res = await run(renderFinal)
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("continuation_not_completed")
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("the Final override lets an agent's run past the Preview review", async () => {
    // The render reads Proxy on the saved graph; an API caller has nobody to
    // review it, and the derived override sets it to Final for this run.
    const res = await run(renderFinal)
    expect(res.statusCode).toBe(202)
  })
})

describe("renderFinal is checked against the payer's balance before the run starts", () => {
  const short = { sufficient: false, required: 530, available: 50, message: "Insufficient credits. Required: 530, Available: 50" }

  it("a payer who cannot cover the run set gets a 402, and nothing is created or charged", async () => {
    mocks.estimate.mockResolvedValueOnce(530)
    mocks.afford.mockResolvedValue(short)
    const res = await run(renderFinal)
    expect(res.statusCode).toBe(402)
    expect(res.json().error).toMatchObject({ code: "insufficient_credits", required: 530, available: 50 })
    expect(typeof res.json().error.message).toBe("string")
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("the run is checked on the figure the quote shows: the same priced graph, the same run set, the run's payer", async () => {
    useGraph(FIXTURE.cases["multicam"]!)
    mocks.loadSource.mockResolvedValue(source({ inputOverrides: { c: { fontSize: 48 } } }))
    const res = await run(renderFinal)
    expect(res.statusCode).toBe(202)
    const [nodes, , runNodeIds] = mocks.estimate.mock.calls[0]! as unknown as [
      Array<{ id: string; data: Record<string, unknown> }>,
      unknown,
      ReadonlySet<string>,
    ]
    expect(nodes.find((n) => n.id === "render")!.data.quality).toBe("final")
    expect(nodes.find((n) => n.id === "c")!.data.fontSize).toBe(48)
    expect([...runNodeIds].sort()).toEqual(["c", "cam", "render"])
    const [userId, required, surface] = mocks.afford.mock.calls[0]! as unknown as [string, number, { billingContext?: unknown }]
    expect(userId).toBe(USER)
    expect(required).toBe(120)
    expect(surface.billingContext).toEqual({ payer: "user", userId: USER })
  })

  it("a deployment payer's pool is not echoed in the 402", async () => {
    mocks.afford.mockResolvedValue({ sufficient: false, required: 530, available: null, message: "This deployment is out of credits. Contact your administrator." })
    const res = await run(renderFinal)
    expect(res.statusCode).toBe(402)
    expect(res.json().error.available).toBeUndefined()
    expect(res.json().balance).toBeUndefined()
  })

  it("without a credit system the run is not checked", async () => {
    mocks.credits = false
    mocks.afford.mockResolvedValue(short)
    const res = await run(renderFinal)
    expect(res.statusCode).toBe(202)
    expect(mocks.afford).not.toHaveBeenCalled()
  })

  it("the quote says upfront whether the payer can cover it", async () => {
    mocks.afford.mockResolvedValue({ ...short, required: 120 })
    const res = await quote({ renderNodeId: "render", continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toMatchObject({ estimatedCredits: 120, sufficient: false, available: 50 })
    expect(mocks.afford.mock.calls[0]![1]).toBe(120)
    expect(mocks.inserts).toEqual([])
  })

  it("without a credit system the quote has no verdict", async () => {
    mocks.credits = false
    const res = await quote({ renderNodeId: "render", continueFromExecutionId: PRIOR })
    expect(res.json().data).toMatchObject({ estimatedCredits: null, sufficient: null, available: null })
    expect(mocks.afford).not.toHaveBeenCalled()
  })
})

describe("POST /v1/workflows/:id/render-final/estimate", () => {
  it("prices the run set on the graph the run executes: the render at Final, the earlier run's pin under it", async () => {
    useGraph(FIXTURE.cases["multicam"]!)
    mocks.loadSource.mockResolvedValue(source({ inputOverrides: { c: { fontSize: 48 } } }))
    const res = await quote({ renderNodeId: "render", continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.estimatedCredits).toBe(120)
    const [nodes, , runNodeIds] = mocks.estimate.mock.calls[0]! as unknown as [
      Array<{ id: string; data: Record<string, unknown> }>,
      unknown,
      ReadonlySet<string>,
    ]
    expect(nodes.find((n) => n.id === "render")!.data.quality).toBe("final")
    expect(nodes.find((n) => n.id === "c")!.data.fontSize).toBe(48)
    expect([...runNodeIds].sort()).toEqual(["c", "cam", "render"])
    // Nothing is created by a quote.
    expect(mocks.inserts).toEqual([])
    expect(mocks.queueAdd).not.toHaveBeenCalled()
  })

  it("without a credit system it answers the set with no figure", async () => {
    mocks.credits = false
    const res = await quote({ renderNodeId: "render", continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.estimatedCredits).toBeNull()
    expect(mocks.estimate).not.toHaveBeenCalled()
  })

  it("refuses as the run would: a continuation that is not the caller's", async () => {
    mocks.loadSource.mockResolvedValue(source({ userId: "someone-else" }))
    const res = await quote({ renderNodeId: "render", continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("continuation_not_found")
  })

  it("refuses a node that is not a render", async () => {
    const res = await quote({ renderNodeId: "c", continueFromExecutionId: PRIOR })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("render_final_not_a_render")
  })

  it("refuses a body without the execution", async () => {
    const res = await quote({ renderNodeId: "render" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
  })
})

/** The rule has ONE home. A copy in either engine is how the two sets drift. */
describe("renderFinalRunSet is defined only in @nodaro/render-rules", () => {
  const REPO = join(HERE, "..", "..", "..", "..")
  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "dist") continue
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) yield* walk(path)
      else if (/\.(ts|tsx)$/.test(entry)) yield path
    }
  }
  it("no engine keeps its own copy", () => {
    const definition = /\b(function\s+renderFinalRunSet\b|(const|let)\s+renderFinalRunSet\s*=)/
    const homes = [join(REPO, "frontend", "src"), join(REPO, "backend", "src"), join(REPO, "packages")]
      .flatMap((dir) => [...walk(dir)])
      .filter((file) => definition.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO, file))
    expect(homes).toEqual(["packages/render-rules/src/render-final-set.ts"])
  })
})
