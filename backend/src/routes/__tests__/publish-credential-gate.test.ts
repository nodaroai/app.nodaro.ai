/**
 * `/v1/apps/publish` — the credential gate (plan D3). A published app runs the
 * creator's snapshot for strangers, so a Webhook Output that sends with a
 * PLAIN (unbound) or MISSING credential is refused with 409
 * `credential_unbound` BEFORE any row is written — the details carry each
 * node's url so the client can offer "Lock to <url>".
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(),
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

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockReturnValue(10),
  estimateWorkflowListingCredits: vi.fn().mockResolvedValue({ preview: 10, final: 0 }),
}))

vi.mock("@/lib/node-registry.js", () => ({
  NODE_REGISTRY: [
    { type: "text-prompt", category: "input" },
    { type: "generate-image", category: "ai-image" },
    { type: "webhook-output", category: "output" },
  ],
}))

const { findUnboundMock } = vi.hoisted(() => ({ findUnboundMock: vi.fn() }))
vi.mock("@/lib/http-credentials.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http-credentials.js")>()),
  findUnboundCredentialUses: findUnboundMock,
}))

import { publishedAppsRoutes } from "../published-apps.js"
import { supabase } from "../../lib/supabase.js"
import {
  __resetAvailabilityOverridesForTests,
  __availabilityUniverseReadyForTests,
} from "../../lib/availability-override.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const CRED = "00000000-0000-4000-8000-0000000000c1"

function workflowRow(nodes: Array<{ id: string; type: string; data?: Record<string, unknown> }>) {
  return { id: WORKFLOW_ID, user_id: OWNER, workspace_id: null, visibility: "private", nodes, edges: [{ source: "t1", target: "hook-1", targetHandle: "field-url" }], settings: {} }
}

/** Serves the workflow row; records every write so the test can prove none happened. */
function serveWorkflow(row: Record<string, unknown>): { writes: string[] } {
  const writes: string[] = []
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    const result = { data: table === "workflows" ? row : null, error: null }
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "in", "order", "limit", "update", "upsert", "delete"]) {
      chain[m] = vi.fn(() => chain)
    }
    chain.insert = vi.fn(() => {
      writes.push(table)
      return chain
    })
    chain.single = vi.fn().mockResolvedValue(result)
    chain.maybeSingle = vi.fn().mockResolvedValue(result)
    return chain
  }) as never)
  return { writes }
}

let app: FastifyInstance

beforeAll(() => __availabilityUniverseReadyForTests())

beforeEach(async () => {
  vi.clearAllMocks()
  findUnboundMock.mockReset()
  __resetAvailabilityOverridesForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (typeof header === "string") (req as { userId?: string }).userId = header
  })
  await app.register(publishedAppsRoutes)
  await app.ready()
})

afterEach(async () => {
  await app.close()
  __resetAvailabilityOverridesForTests()
})

const publish = () =>
  app.inject({
    method: "POST",
    url: "/v1/apps/publish",
    headers: { "x-user-id": OWNER },
    payload: { workflowId: WORKFLOW_ID, name: "Deliver app" },
  })

describe("publishing a workflow whose Webhook Output sends with a stored credential", () => {
  const nodes = [
    { id: "t1", type: "text-prompt", data: { text: "hi" } },
    { id: "hook-1", type: "webhook-output", data: { url: "https://mine.example/hook", credentialId: CRED, label: "Deliver" } },
  ]

  it("refuses a PLAIN credential with 409 credential_unbound, naming the node and its url, before any row is written", async () => {
    const { writes } = serveWorkflow(workflowRow(nodes))
    findUnboundMock.mockResolvedValue([
      { nodeId: "hook-1", nodeLabel: "Deliver", credentialId: CRED, nodeUrl: "https://mine.example/hook", kind: "plain", credentialName: "Grok bot" },
    ])

    const res = await publish()

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("credential_unbound")
    expect(res.json().error.details[0]).toMatchObject({ nodeId: "hook-1", nodeUrl: "https://mine.example/hook", kind: "plain" })
    // The credentials checked are the OWNER's — the publisher.
    expect(findUnboundMock).toHaveBeenCalledWith(nodes, OWNER, [{ source: "t1", target: "hook-1", targetHandle: "field-url" }])
    expect(writes).toEqual([])
  })

  it("refuses a MISSING credential the same way", async () => {
    const { writes } = serveWorkflow(workflowRow(nodes))
    findUnboundMock.mockResolvedValue([
      { nodeId: "hook-1", nodeLabel: "Deliver", credentialId: CRED, nodeUrl: "https://mine.example/hook", kind: "missing", credentialName: null },
    ])
    const res = await publish()
    expect(res.statusCode).toBe(409)
    expect(res.json().error.details[0].kind).toBe("missing")
    expect(writes).toEqual([])
  })

  it("passes the gate when every credentialed webhook is BOUND, and never asks the vault when none is credentialed", async () => {
    serveWorkflow(workflowRow(nodes))
    findUnboundMock.mockResolvedValue([])
    const bound = await publish()
    expect(bound.statusCode).not.toBe(409)
    expect(findUnboundMock).toHaveBeenCalledTimes(1)

    findUnboundMock.mockClear()
    serveWorkflow(workflowRow([{ id: "t1", type: "text-prompt", data: {} }, { id: "hook-2", type: "webhook-output", data: { url: "https://mine.example/hook" } }]))
    const plainHook = await publish()
    expect(plainHook.statusCode).not.toBe(409)
    expect(findUnboundMock).not.toHaveBeenCalled()
  })
})
