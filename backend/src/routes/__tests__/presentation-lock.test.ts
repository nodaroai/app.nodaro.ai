/**
 * `/v1/present/:token/run` — the override lock (issue #1555).
 *
 * A share-for-run viewer runs the owner's LIVE graph and supplies the override
 * map; it may not re-point an outbound node. The route holds `workflow.nodes`
 * right after the share-token lookup, so the refusal lands before the
 * already-running check and before any execution row. The orchestrator's merge
 * refuses too; this pins the route's own 400.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockOrchestrationQueueAdd } = vi.hoisted(() => ({
  mockOrchestrationQueueAdd: vi.fn().mockResolvedValue({ id: "orch-job-1" }),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

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
  orchestrationQueue: { add: mockOrchestrationQueueAdd },
}))

vi.mock("@/ee/billing/credits.js", () => ({
  estimateWorkflowCredits: vi.fn().mockResolvedValue(0),
}))

const { findUnboundMock } = vi.hoisted(() => ({ findUnboundMock: vi.fn() }))
vi.mock("@/lib/http-credentials.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/http-credentials.js")>()),
  findUnboundCredentialUses: findUnboundMock,
}))

import { presentationRoutes } from "../presentation.js"
import { supabase } from "../../lib/supabase.js"

const VIEWER_ID = "00000000-0000-4000-8000-000000000002"
const OWNER_ID = "00000000-0000-4000-8000-000000000001"
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000020"
const EXEC_ID = "00000000-0000-4000-8000-000000000060"
const TOKEN = "share-token-abc"

/** Any chained call returns the chain; awaiting it (or `.single()`) resolves `value`. */
function chainResolving(value: unknown) {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(value)
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

function mockSharedWorkflow(nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    if (table === "workflows") {
      return chainResolving({
        data: {
          id: WORKFLOW_ID,
          user_id: OWNER_ID,
          nodes,
          edges: [{ source: "t1", target: "hook-1", targetHandle: "field-url" }],
          settings: {},
          is_presentation_enabled: true,
        },
        error: null,
      }) as never
    }
    // workflow_executions: the already-running probe reads `.length` off the
    // data (an object → undefined → "none running"); the insert's `.single()`
    // reads `.id`. One value serves both.
    return chainResolving({ data: { id: EXEC_ID }, error: null }) as never
  })
}

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const header = req.headers["x-user-id"]
    if (header && typeof header === "string") req.userId = header
  })
  await app.register(async (instance) => {
    await presentationRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

function viewerRun(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: `/v1/present/${TOKEN}/run`,
    headers: { "x-user-id": VIEWER_ID },
    payload,
  })
}

describe("POST /v1/present/:token/run — the override lock (issue #1555)", () => {
  it("refuses a viewer's override that re-points the owner's Webhook Output — 400 locked_field, nothing enqueued", async () => {
    mockSharedWorkflow([
      { id: "text-1", type: "text-prompt", data: { text: "hello" } },
      { id: "hook-1", type: "webhook-output", data: { url: "https://owner.example/hook" } },
    ])

    const res = await viewerRun({
      inputOverrides: {
        "text-1": { text: "a legitimate input" },
        "hook-1": { url: "https://attacker.example/collect" },
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("locked_field")
    expect(res.json().error.message).toContain('"url" on webhook-output node "hook-1"')
    expect(res.json().error.message).not.toContain("attacker")
    expect(res.json().error.message).not.toContain("owner.example")
    expect(mockOrchestrationQueueAdd).not.toHaveBeenCalled()
  })

  it("refuses a viewer's injected UGC run state — 400 locked_field, nothing enqueued", async () => {
    mockSharedWorkflow([{ id: "ugc-1", type: "ugc-creator", data: { source: "sampled", gender: "woman", keepResult: false } }])

    const res = await viewerRun({ inputOverrides: { "ugc-1": { keepResult: true } } })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("locked_field")
    expect(res.json().error.message).toContain('inputOverrides cannot set "keepResult" on a UGC node "ugc-1".')
    expect(mockOrchestrationQueueAdd).not.toHaveBeenCalled()
  })

  it("still runs with an ordinary input — the override reaches the orchestrator job", async () => {
    mockSharedWorkflow([{ id: "text-1", type: "text-prompt", data: { text: "hello" } }])

    const res = await viewerRun({ inputOverrides: { "text-1": { text: "a legitimate input" } } })

    expect(res.statusCode).toBe(202)
    expect(mockOrchestrationQueueAdd).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({
        workflowId: WORKFLOW_ID,
        userId: VIEWER_ID,
        inputOverrides: { "text-1": { text: "a legitimate input" } },
      }),
      expect.objectContaining({ jobId: EXEC_ID }),
    )
  })
})

describe("POST /v1/workflows/:id/share — the credential gate (plan D3)", () => {
  const CRED = "00000000-0000-4000-8000-0000000000c1"

  function mockOwnedWorkflow(nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>, shareToken: string | null) {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === "workflows") {
        return chainResolving({ data: { id: WORKFLOW_ID, user_id: OWNER_ID, share_token: shareToken, nodes, edges: [{ source: "t1", target: "hook-1", targetHandle: "field-url" }] }, error: null }) as never
      }
      return chainResolving({ data: null, error: null }) as never
    })
  }

  beforeEach(() => findUnboundMock.mockReset())

  it("refuses to share a workflow whose Webhook Output sends with a PLAIN credential — 409 credential_unbound naming the node and its url", async () => {
    const nodes = [{ id: "hook-1", type: "webhook-output", data: { url: "https://mine.example/hook", credentialId: CRED } }]
    mockOwnedWorkflow(nodes, null)
    findUnboundMock.mockResolvedValue([
      { nodeId: "hook-1", nodeLabel: "Webhook Output", credentialId: CRED, nodeUrl: "https://mine.example/hook", kind: "plain", credentialName: "Grok bot" },
    ])

    const res = await app.inject({ method: "POST", url: `/v1/workflows/${WORKFLOW_ID}/share`, headers: { "x-user-id": OWNER_ID } })

    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("credential_unbound")
    expect(res.json().error.details).toEqual([expect.objectContaining({ nodeId: "hook-1", credentialId: CRED, nodeUrl: "https://mine.example/hook", kind: "plain" })])
    // The stored edges travel with the nodes (a mapped URL is not judged).
    expect(findUnboundMock).toHaveBeenCalledWith(nodes, OWNER_ID, [{ source: "t1", target: "hook-1", targetHandle: "field-url" }])
  })

  it("re-checks an ALREADY shared workflow too — the credential may have been attached after the first share", async () => {
    mockOwnedWorkflow([{ id: "hook-1", type: "webhook-output", data: { url: "https://mine.example/hook", credentialId: CRED } }], "existing-token")
    findUnboundMock.mockResolvedValue([
      { nodeId: "hook-1", nodeLabel: "Webhook Output", credentialId: CRED, nodeUrl: "https://mine.example/hook", kind: "plain", credentialName: null },
    ])
    const res = await app.inject({ method: "POST", url: `/v1/workflows/${WORKFLOW_ID}/share`, headers: { "x-user-id": OWNER_ID } })
    expect(res.statusCode).toBe(409)
  })

  it("shares as before when every credentialed webhook is bound — and never asks the vault when none is credentialed", async () => {
    mockOwnedWorkflow([{ id: "t1", type: "text-prompt", data: {} }], "existing-token")
    const res = await app.inject({ method: "POST", url: `/v1/workflows/${WORKFLOW_ID}/share`, headers: { "x-user-id": OWNER_ID } })
    expect(res.statusCode).toBe(200)
    expect(res.json().shareToken).toBe("existing-token")
    expect(findUnboundMock).not.toHaveBeenCalled()
  })
})
