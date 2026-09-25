/**
 * `POST /v1/workflows/:id/sync-triggers` — the editor saves through PostgREST,
 * which never projects Schedule / Webhook Trigger nodes onto trigger rows
 * (#1566). After such a save the editor asks here for the same projection the
 * API lanes get, from the STORED graph. Only the owner's own browser session
 * vouches for a schedule (plan D3); a token running as the owner does not.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }) },
  },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  hasOrganizations: () => false,
}))

vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn().mockResolvedValue(false),
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "schedule-trigger", category: "trigger" },
  ],
}))

const { reconcileMock } = vi.hoisted(() => ({ reconcileMock: vi.fn() }))
vi.mock("@/lib/workflow-trigger-sync.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workflow-trigger-sync.js")>()),
  reconcileWorkflowTriggers: reconcileMock,
}))

import { workflowRoutes } from "../workflows.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const STRANGER = "00000000-0000-4000-8000-000000000002"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const NODES = [
  { id: "t1", type: "text-prompt", data: {} },
  { id: "s1", type: "schedule-trigger", data: { interval: "*/5 * * * *", cron: "*/5 * * * *" } },
]

/** Serves the stored workflow row (or nothing) to the access loader; the delta RPC lands. */
function serve(row: Record<string, unknown> | null) {
  vi.mocked(supabase.rpc).mockImplementation((async () => ({
    data: { ok: true, version: 2, updated_at: "2026-09-22T00:00:01.000Z" },
    error: null,
  })) as never)
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit", "insert", "upsert", "delete", "update"]) chain[m] = vi.fn(() => chain)
    const result = table === "workflows" ? { data: row, error: null } : { data: null, error: null }
    chain.single = vi.fn().mockResolvedValue(result)
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null })
    return chain
  }) as never)
}

const ROW = { id: WORKFLOW_ID, user_id: OWNER, workspace_id: null, visibility: "private", nodes: NODES }

let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  vi.clearAllMocks()
  reconcileMock.mockReset()
  reconcileMock.mockResolvedValue({ created: 1, updated: 0, removed: 0 })
  __resetAvailabilityOverridesForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const user = req.headers["x-user-id"]
    if (typeof user === "string") req.userId = user
    const kind = req.headers["x-auth-kind"]
    if (typeof kind === "string") req.authKind = kind as typeof req.authKind
  })
  await app.register(async (instance) => {
    await workflowRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
})

// `payload: null` sends no body at all (an explicit undefined would take the default).
const sync = (userId: string | null, authKind = "jwt", payload: Record<string, unknown> | null = { vouchNodeIds: ["s1"] }) =>
  app.inject({
    method: "POST",
    url: `/v1/workflows/${WORKFLOW_ID}/sync-triggers`,
    headers: userId ? { "x-user-id": userId, "x-auth-kind": authKind } : {},
    ...(payload ? { payload } : {}),
  })

describe("POST /v1/workflows/:id/sync-triggers", () => {
  it("projects the STORED graph for the owner's browser session, vouching for the node ids the editor says it added", async () => {
    serve(ROW)
    const res = await sync(OWNER, "jwt")
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { synced: true, created: 1, updated: 0, removed: 0 } })
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    expect(reconcileMock).toHaveBeenCalledWith({ workflowId: WORKFLOW_ID, userId: OWNER, nodes: NODES, vouchNodeIds: ["s1"], ownerActing: true })
  })

  it("no vouch ids in the body: projects, vouches for nothing", async () => {
    serve(ROW)
    const res = await sync(OWNER, "jwt", null)
    expect(res.statusCode).toBe(200)
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    expect(reconcileMock.mock.calls[0][0]).toMatchObject({ userId: OWNER })
    expect(reconcileMock.mock.calls[0][0].vouchNodeIds).toBeUndefined()
  })

  it("the owner through an API token projects too — but its vouch ids are ignored", async () => {
    serve(ROW)
    const res = await sync(OWNER, "api_token")
    expect(res.statusCode).toBe(200)
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    // Still the owner acting: the account lane is theirs to change.
    expect(reconcileMock.mock.calls[0][0]).toMatchObject({ userId: OWNER, ownerActing: true })
    expect(reconcileMock.mock.calls[0][0].vouchNodeIds).toBeUndefined()
  })

  it("a malformed body is refused before anything is read", async () => {
    serve(ROW)
    const res = await sync(OWNER, "jwt", { vouchNodeIds: "s1" })
    expect(res.statusCode).toBe(400)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("the row is always the OWNER's, whoever asks", async () => {
    // Organisations are off here, so a stranger has no access at all: refused
    // before any projection, as an absence.
    serve(ROW)
    const res = await sync(STRANGER, "jwt")
    expect(res.statusCode).toBe(404)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("no such workflow: 404, nothing projected", async () => {
    serve(null)
    const res = await sync(OWNER)
    expect(res.statusCode).toBe(404)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("unauthenticated: 401", async () => {
    serve(ROW)
    const res = await sync(null)
    expect(res.statusCode).toBe(401)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("the REST delta lane projects the STORED graph after the RPC landed — never vouching", async () => {
    serve(ROW)
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER, "x-auth-kind": "jwt" },
      payload: { delta: { baseVersion: 1, upsertNodes: [NODES[1]] } },
    })
    expect(res.statusCode).toBe(200)
    expect(reconcileMock).toHaveBeenCalledTimes(1)
    expect(reconcileMock.mock.calls[0][0]).toMatchObject({ workflowId: WORKFLOW_ID, userId: OWNER, nodes: NODES })
    expect(reconcileMock.mock.calls[0][0].vouchNodeIds).toBeUndefined()
  })

  it("a delta that touches no trigger node and deletes nothing stays one round trip — no projection", async () => {
    serve(ROW)
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER, "x-auth-kind": "jwt" },
      payload: { delta: { baseVersion: 1, upsertNodes: [NODES[0]] } },
    })
    expect(res.statusCode).toBe(200)
    expect(reconcileMock).not.toHaveBeenCalled()
  })

  it("a delta that only deletes a node projects — the deleted one may have been a trigger", async () => {
    serve(ROW)
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/workflows/${WORKFLOW_ID}`,
      headers: { "x-user-id": OWNER, "x-auth-kind": "jwt" },
      payload: { delta: { baseVersion: 1, deleteNodeIds: ["s1"] } },
    })
    expect(res.statusCode).toBe(200)
    expect(reconcileMock).toHaveBeenCalledTimes(1)
  })

  it("a projection failure is reported, not hidden — synced: false, still 200 (the save already landed)", async () => {
    serve(ROW)
    reconcileMock.mockResolvedValue({ created: 0, updated: 0, removed: 0, error: "insert failed" })
    const res = await sync(OWNER)
    expect(res.statusCode).toBe(200)
    expect(res.json().data.synced).toBe(false)
  })
})
