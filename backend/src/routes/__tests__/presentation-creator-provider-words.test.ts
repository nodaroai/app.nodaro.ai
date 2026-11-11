/**
 * A share link's provider words are its workflow's CREATOR's (lib/provider-words.ts,
 * decided 2026-11-11): the words a failed node carries can quote the shared
 * workflow's prompt, so whatever the `jobs.errorDetail` setting, a viewer who
 * did not create the workflow never reads them — not on their own run, not on
 * the page. An admin always does; under "admin" a creator who is not one does not.
 *
 *  - `GET /v1/present/:token/status/:execId`: the viewer's own run, polled.
 *    `errorDetail` stays for the creator only (asked of `workflows.user_id`,
 *    never of the access rule, so a collaborator is no exception); the run's
 *    `workflow_id` is read for that and never sent.
 *  - `GET /v1/present/:token`: the page's saved `nodes` keep `data.errorDetail`
 *    for the creator only; a signed-in viewer and an anonymous one get them
 *    without it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockWorkflowAccess } = vi.hoisted(() => ({
  /** A collaborator the workflow is shared with: the share link's reads must not ask this. */
  mockWorkflowAccess: vi.fn(async () => "view"),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
// A surface profile is honoured on this edition (surfaceGateOpen: cloud).
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))
vi.mock("@/lib/orchestration-queue.js", () => ({ orchestrationQueue: { add: vi.fn() } }))
vi.mock("@/ee/billing/credits.js", () => ({
  unpricedMeteredLlmOfRun: () => null,
  estimateWorkflowCredits: vi.fn().mockResolvedValue(0),
  estimateWorkflowCreditsDetailed: vi.fn().mockResolvedValue({ credits: 0, estimate: false, perNode: {} }),
}))
vi.mock("@/lib/workflow-access.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workflow-access.js")>()),
  workflowAccess: mockWorkflowAccess,
}))

import { executionOutcome } from "@nodaro/shared/workflow"
import { presentationRoutes } from "../presentation.js"
import { supabase } from "../../lib/supabase.js"
import { readerCanOpenWorkflow } from "../../lib/provider-words-readers.js"
import { __resetSurfaceProfileCacheForTests } from "../../lib/surface-profile.js"

const CREATOR_ID = "00000000-0000-4000-8000-000000000001"
const VIEWER_ID = "00000000-0000-4000-8000-000000000002"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const EXEC_ID = "00000000-0000-4000-8000-000000000060"
const TOKEN = "share-token-abc"

const WORDS = "provider said: the prompt 'a red fox at dawn' was flagged"

const failedWithWords = () => ({ status: "failed", error: "Generation failed", errorDetail: WORDS, jobId: "j1" })
const failedWithoutWords = () => ({ status: "failed", error: "Generation failed", jobId: "j1" })
const completed = () => ({ status: "completed", output: { imageUrl: "https://cdn.example/x.png" }, jobId: "j2" })

type States = Record<string, Record<string, unknown>>

/** The run as the answer carries it: the route's columns, in its select's order, but `workflow_id`. */
const answerRow = (states: States = { n1: failedWithWords(), n2: completed() }) => ({
  id: EXEC_ID,
  status: "failed",
  node_states: states,
  total_nodes: 2,
  completed_nodes: 1,
  failed_nodes: 1,
  total_credits_used: 5,
  error_message: "Generation failed",
  completed_at: "2026-01-01T00:05:00Z",
})

/** The shared workflow's saved nodes: a failed image node holding the words its creator's editor saved, and its prompt. */
const savedNodes = (words = true) => [
  {
    id: "image-1",
    type: "generate-image",
    position: { x: 0, y: 0 },
    data: { label: "Image", prompt: "a red fox at dawn", provider: "nano-banana", executionStatus: "failed", errorMessage: "Generation failed", ...(words ? { errorDetail: WORDS } : {}) },
  },
  { id: "prompt-1", type: "text-prompt", position: { x: 0, y: 200 }, data: { label: "Prompt", text: "a red fox at dawn" } },
]

type Read = { table: string; columns?: string }
/** Every `supabase.from(…)` the request made, with its select. */
const reads: Read[] = []

/**
 * `workflow_executions` → the viewer's run of the shared workflow (its
 * `workflow_id` last); `workflows` → the shared workflow, created by
 * CREATOR_ID (or the answer `workflowsAnswer` gives).
 */
function mockDb(opts: { states?: States; nodes?: unknown[];workflowsAnswer?: { data: unknown; error: unknown } } = {}) {
  reads.length = 0
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    const read: Read = { table }
    reads.push(read)
    const answer =
      table === "workflow_executions"
        ? { data: { ...answerRow(opts.states), workflow_id: WORKFLOW_ID }, error: null }
        : table === "workflows"
          ? (opts.workflowsAnswer ?? {
              data: { id: WORKFLOW_ID, name: "Fox film", user_id: CREATOR_ID, workspace_id: null, nodes: opts.nodes ?? savedNodes(), edges: [], settings: {}, is_presentation_enabled: true },
              error: null,
            })
          : { data: null, error: null }
    const chain: Record<string, unknown> = {
      select: vi.fn((columns: string) => ((read.columns = columns), chain)),
      eq: vi.fn(() => chain),
      single: vi.fn().mockResolvedValue(answer),
      maybeSingle: vi.fn().mockResolvedValue(answer),
    }
    return chain as never
  })
}

/** The lookups of the run's workflow's creator. */
const creatorLookups = () => reads.filter((r) => r.table === "workflows" && r.columns === "user_id")

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

function as(userId: string | undefined, role?: string) {
  return { ...(userId ? { "x-user-id": userId } : {}), ...(role ? { "x-user-role": role } : {}) }
}

// ==========================================================================
// GET /v1/present/:token/status/:execId
// ==========================================================================

describe("GET /v1/present/:token/status/:execId — the provider's words on a viewer's own run", () => {
  async function poll(userId: string, role?: string) {
    const res = await app.inject({ method: "GET", url: `/v1/present/${TOKEN}/status/${EXEC_ID}`, headers: as(userId, role) })
    expect(res.statusCode).toBe(200)
    return res
  }

  it("with no setting, the workflow's creator keeps them, after one lookup of the creator", async () => {
    mockDb()
    const body = (await poll(CREATOR_ID)).json()
    expect(body.node_states).toEqual(answerRow().node_states)
    expect(creatorLookups()).toHaveLength(1)
  })

  it("with no setting, a viewer who did not create the workflow gets the node without them, every other key as it was and in the same order", async () => {
    mockDb()
    const res = await poll(VIEWER_ID)
    const row = answerRow({ n1: failedWithoutWords(), n2: completed() })
    // Byte for byte: the run's row (no `workflow_id`) with the words dropped, then its outcome.
    expect(res.body).toBe(JSON.stringify({ ...row, outcome: executionOutcome(row.status, row.node_states) }))
    expect(res.body).not.toContain(WORDS)
    expect(res.body).not.toContain(WORKFLOW_ID)
  })

  it("with no setting, a viewer the workflow is shared with does not get them either: only its creator does", async () => {
    mockDb()
    // The viewer can open the workflow (the access rule, as mocked, says "view")...
    expect(await readerCanOpenWorkflow(VIEWER_ID, WORKFLOW_ID)).toBe(true)
    mockWorkflowAccess.mockClear()
    // ...and the share link's run is still read by the creator-only rule.
    const body = (await poll(VIEWER_ID)).json()
    expect(body.node_states.n1).toEqual(failedWithoutWords())
    expect(mockWorkflowAccess).not.toHaveBeenCalled()
  })

  it("a lookup of the creator that fails counts as a viewer who did not create it", async () => {
    mockDb({ workflowsAnswer: { data: null, error: { message: "connection reset" } } })
    const body = (await poll(CREATOR_ID)).json()
    expect(body.node_states.n1).toEqual(failedWithoutWords())
  })

  it.each(["admin", "super_admin"])("an %s viewer who did not create the workflow keeps them, with no lookup", async (role) => {
    mockDb()
    const body = (await poll(VIEWER_ID, role)).json()
    expect(body.node_states).toEqual(answerRow().node_states)
    expect(body).not.toHaveProperty("workflow_id")
    expect(creatorLookups()).toHaveLength(0)
  })

  it("kept for admins, the creator who is not an admin gets the node without them, with no lookup", async () => {
    keepWordsForAdmins()
    mockDb()
    const body = (await poll(CREATOR_ID)).json()
    expect(body.node_states).toEqual({ n1: failedWithoutWords(), n2: completed() })
    expect(creatorLookups()).toHaveLength(0)
  })

  it("a run whose nodes carry no words is answered exactly as stored, with no lookup", async () => {
    const states = { n1: failedWithoutWords(), n2: completed() }
    mockDb({ states })
    const res = await poll(VIEWER_ID)
    const row = answerRow(states)
    expect(res.body).toBe(JSON.stringify({ ...row, outcome: executionOutcome(row.status, row.node_states) }))
    expect(creatorLookups()).toHaveLength(0)
  })
})

// ==========================================================================
// GET /v1/present/:token
// ==========================================================================

describe("GET /v1/present/:token — the provider's words saved on the shared workflow's nodes", () => {
  async function page(userId?: string, role?: string) {
    const res = await app.inject({ method: "GET", url: `/v1/present/${TOKEN}`, headers: as(userId, role) })
    expect(res.statusCode).toBe(200)
    return res
  }

  /** The saved nodes without the words, every other field as it was. */
  const nodesWithoutWords = () => savedNodes(false)

  it("with no setting, the creator's page keeps them", async () => {
    mockDb()
    const body = (await page(CREATOR_ID)).json()
    expect(body.isOwner).toBe(true)
    expect(body.nodes).toEqual(savedNodes())
  })

  it.each([
    ["a signed-in viewer who did not create it", VIEWER_ID],
    ["an anonymous viewer", undefined],
  ])("with no setting, %s gets the nodes without them, every other field as it was", async (_viewer, userId) => {
    mockDb()
    const res = await page(userId)
    expect(res.json().isOwner).toBe(false)
    expect(res.json().nodes).toEqual(nodesWithoutWords())
    expect(res.body).not.toContain(WORDS)
    // The rest of the page as it was.
    expect(res.json()).toMatchObject({ workflowId: WORKFLOW_ID, name: "Fox film", edges: [], presentationSettings: { runTarget: "workflow" } })
  })

  it.each(["admin", "super_admin"])("an %s visitor who did not create it keeps them", async (role) => {
    mockDb()
    const body = (await page(VIEWER_ID, role)).json()
    expect(body.isOwner).toBe(false)
    expect(body.nodes).toEqual(savedNodes())
  })

  it("kept for admins, the creator who is not an admin gets the nodes without them", async () => {
    keepWordsForAdmins()
    mockDb()
    const body = (await page(CREATOR_ID)).json()
    expect(body.isOwner).toBe(true)
    expect(body.nodes).toEqual(nodesWithoutWords())
  })

  it("kept for admins, an admin creator still keeps them", async () => {
    keepWordsForAdmins()
    mockDb()
    expect((await page(CREATOR_ID, "admin")).json().nodes).toEqual(savedNodes())
  })

  it("a page whose nodes carry no words is served as saved, to anyone", async () => {
    mockDb({ nodes: savedNodes(false) })
    expect((await page(VIEWER_ID)).json().nodes).toEqual(nodesWithoutWords())
    expect((await page(undefined)).json().nodes).toEqual(nodesWithoutWords())
  })
})
