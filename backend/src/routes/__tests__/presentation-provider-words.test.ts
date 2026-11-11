/**
 * `GET /v1/present/:token/status/:execId` — a shared workflow viewer's own run,
 * polled. Here the viewer also created the shared workflow, so a failed node's
 * provider words (`errorDetail` on `node_states`) follow the deployment's
 * `jobs.errorDetail` setting alone (lib/provider-words.ts): with no setting the
 * answer is exactly what it was; kept for admins, a viewer who is not an admin
 * gets the node state without the key, in an answer whose keys are in the same
 * order; an admin viewer still gets them. A viewer who did not create the
 * workflow is in presentation-creator-provider-words.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

// A surface profile is honoured on this edition (surfaceGateOpen: cloud).
vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: vi.fn() },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  unpricedMeteredLlmOfRun: () => null,
  estimateWorkflowCredits: vi.fn().mockResolvedValue(0),
  estimateWorkflowCreditsDetailed: vi.fn().mockResolvedValue({ credits: 0, estimate: false, perNode: {} }),
}))

import { executionOutcome } from "@nodaro/shared/workflow"
import { presentationRoutes } from "../presentation.js"
import { supabase } from "../../lib/supabase.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const VIEWER_ID = "00000000-0000-4000-8000-000000000002"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const EXEC_ID = "00000000-0000-4000-8000-000000000060"
const TOKEN = "share-token-abc"

const WORDS = "provider said: the prompt 'a red fox at dawn' was flagged"

const failedWithWords = () => ({ status: "failed", error: "Generation failed", errorDetail: WORDS, jobId: "j1" })
const failedWithoutWords = () => ({ status: "failed", error: "Generation failed", jobId: "j1" })
const completed = () => ({ status: "completed", output: { imageUrl: "https://cdn.example/x.png" }, jobId: "j2" })

/**
 * The viewer's run as the answer carries it (the route's columns, in its
 * select's order, but the run's `workflow_id`, which it reads and never sends).
 * A "completed" run can hold a failed node (a node whose siblings are tried
 * anyway) and is the one status whose answer carries an `outcome`.
 */
const executionRow = (status: "failed" | "completed" = "failed") => ({
  id: EXEC_ID,
  status,
  node_states: { n1: failedWithWords(), n2: completed() },
  total_nodes: 2,
  completed_nodes: 1,
  failed_nodes: 1,
  total_credits_used: 5,
  error_message: status === "failed" ? "Generation failed" : null,
  completed_at: "2026-01-01T00:05:00Z",
})

/**
 * `.from("workflow_executions")…single()` → the viewer's run, as the route
 * reads it (its `workflow_id` last); `.from("workflows")…maybeSingle()` → the
 * run's workflow, created by the viewer.
 */
function mockRun(status: "failed" | "completed" = "failed") {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const answer =
      table === "workflow_executions"
        ? { data: { ...executionRow(status), workflow_id: WORKFLOW_ID }, error: null }
        : table === "workflows"
          ? { data: { user_id: VIEWER_ID }, error: null }
          : { data: null, error: null }
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single: vi.fn().mockResolvedValue(answer),
      maybeSingle: vi.fn().mockResolvedValue(answer),
    }
    return chain as never
  })
}

const prevProfile = process.env.NODARO_SURFACE_PROFILE

function keepWordsForAdmins(): void {
  process.env.NODARO_SURFACE_PROFILE = JSON.stringify({ jobs: { errorDetail: "admin" } })
  __resetSurfaceProfileCacheForTests()
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  delete process.env.NODARO_SURFACE_PROFILE
  __resetSurfaceProfileCacheForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") {
      req.userId = header
      const role = req.headers["x-user-role"]
      req.userRole = typeof role === "string" ? (role as typeof req.userRole) : undefined
    }
  })
  await app.register(async (instance) => {
    await presentationRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  if (prevProfile === undefined) delete process.env.NODARO_SURFACE_PROFILE
  else process.env.NODARO_SURFACE_PROFILE = prevProfile
  __resetSurfaceProfileCacheForTests()
})

async function poll(role?: string, status: "failed" | "completed" = "failed") {
  mockRun(status)
  const res = await app.inject({
    method: "GET",
    url: `/v1/present/${TOKEN}/status/${EXEC_ID}`,
    headers: { "x-user-id": VIEWER_ID, ...(role ? { "x-user-role": role } : {}) },
  })
  expect(res.statusCode).toBe(200)
  return res
}

describe("GET /v1/present/:token/status/:execId — a failed node's provider words", () => {
  it.each(["failed", "completed"] as const)("with no setting, the answer for a %s run is exactly as before: the run's row plus its outcome", async (status) => {
    const res = await poll(undefined, status)
    const row = executionRow(status)
    const before = { ...row, outcome: executionOutcome(row.status, row.node_states) }
    expect(res.json()).toEqual(before)
    // Byte for byte, key order included.
    expect(res.body).toBe(JSON.stringify(before))
    expect(res.json().node_states.n1.errorDetail).toBe(WORDS)
    // The run's workflow id was read to decide the words, and is never sent.
    expect(res.json()).not.toHaveProperty("workflow_id")
    expect(res.body).not.toContain(WORKFLOW_ID)
  })

  it("kept for admins, a viewer who is not an admin gets the node without them and every other field as it was", async () => {
    keepWordsForAdmins()
    const body = (await poll()).json()
    expect(body.node_states.n1).not.toHaveProperty("errorDetail")
    expect(body.node_states.n1).toEqual(failedWithoutWords())
    expect(body.node_states.n2).toEqual(completed())
    // Every other key of the answer as it was, the outcome included.
    const { node_states: _states, ...rest } = executionRow()
    expect(body).toMatchObject(rest)
    expect(body.outcome).toBe(executionOutcome(executionRow().status, executionRow().node_states))
  })

  it.each(["failed", "completed"] as const)("kept for admins, the answer for a %s run keeps its keys in the same order", async (status) => {
    const before = Object.keys((await poll(undefined, status)).json())
    keepWordsForAdmins()
    const body = (await poll(undefined, status)).json()
    expect(body.node_states.n1).not.toHaveProperty("errorDetail")
    expect(Object.keys(body)).toEqual(before)
    // `node_states` where the row has it; `outcome` last, present only for a completed run.
    expect(Object.keys(body)).toEqual(status === "completed" ? [...Object.keys(executionRow(status)), "outcome"] : Object.keys(executionRow(status)))
    if (status === "completed") expect(body.outcome).toBe("succeeded")
  })

  it.each(["admin", "super_admin"])("kept for admins, an %s viewer still reads them", async (role) => {
    keepWordsForAdmins()
    const body = (await poll(role)).json()
    expect(body.node_states).toEqual(executionRow().node_states)
  })
})
