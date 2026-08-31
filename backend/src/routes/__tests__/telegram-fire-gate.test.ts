// P14/W6 — the Telegram fire lane finally asks the same fire-time question
// the webhook and schedule lanes always asked: may the trigger's owner STILL
// run this workflow? A trigger outlives the session that created it; without
// the gate the bot kept firing the current graph after the owner lost access.
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { mockCanRun, mockRecordRefusal, mockResolve, mockQueueAdd, execInserts, workflowHome } = vi.hoisted(() => ({
  mockCanRun: vi.fn(),
  mockRecordRefusal: vi.fn(async () => undefined),
  mockResolve: vi.fn(async (input: { userId: string }) => ({ payer: "user" as const, userId: input.userId })),
  mockQueueAdd: vi.fn(async () => ({})),
  execInserts: [] as Array<Record<string, unknown>>,
  workflowHome: { value: null as string | null },
}))

vi.mock("@/lib/workflow-access.js", () => ({ canRunWorkflow: mockCanRun }))
vi.mock("@/lib/trigger-fire-refusal.js", () => ({
  recordTriggerFireRefusal: mockRecordRefusal,
  RUN_REQUIRES_AUTHENTICATED_MEMBER: "run_requires_authenticated_member",
}))
vi.mock("@/lib/billing-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing-context.js")>()
  return { ...actual, resolveBillingContext: mockResolve }
})
vi.mock("@/lib/orchestration-queue.js", () => ({
  orchestrationQueue: { add: mockQueueAdd },
}))
vi.mock("@/lib/telegram-router.js", () => ({
  getTriggersForToken: () => [
    {
      triggerId: "trig-1",
      userId: "owner-1",
      workflowId: "wf-1",
      secretToken: "shh",
      chatIdFilter: undefined,
      messageTypeFilters: undefined,
    },
  ],
  generateWebhookToken: vi.fn(),
  registerTelegramWebhook: vi.fn(),
  unregisterTelegramWebhook: vi.fn(),
  downloadTelegramFile: vi.fn(),
  addTriggerToRoute: vi.fn(),
  removeTriggerFromRoute: vi.fn(),
}))
vi.mock("@/services/social/encryption.js", () => ({ decryptToken: vi.fn(() => "bot-token") }))
vi.mock("@/lib/storage.js", () => ({ uploadBufferToR2: vi.fn() }))
vi.mock("@/lib/config.js", () => ({
  config: { PUBLIC_URL: "http://localhost:8000" },
  hasCredits: () => true,
  hasOrganizations: () => false,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/supabase.js", () => {
  const chain: Record<string, unknown> = {}
  for (const m of ["select", "eq", "limit", "update", "delete"]) {
    chain[m] = vi.fn().mockReturnValue(chain)
  }
  chain.single = vi.fn().mockResolvedValue({ data: null, error: null })
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  return {
    supabase: {
      from: vi.fn().mockImplementation((table: string) => {
        if (table === "workflows") {
          return {
            ...chain,
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockImplementation(async () => ({ data: { workspace_id: workflowHome.value }, error: null })),
              }),
            }),
          }
        }
        if (table === "workflow_executions") {
          return {
            ...chain,
            insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
              execInserts.push(row)
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: "exec-1" }, error: null }),
                }),
              }
            }),
          }
        }
        return { ...chain, insert: vi.fn().mockReturnValue(chain) }
      }),
    },
  }
})

import { telegramWebhookRoutes } from "../telegram-webhook.js"
import { supabase } from "@/lib/supabase.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  execInserts.length = 0
  app = Fastify()
  app.addHook("onRequest", async (req) => {
    ;(req as unknown as { userId?: string }).userId = req.headers["x-user-id"] as string | undefined
  })
  await app.register(telegramWebhookRoutes)
  await app.ready()
})

function fire() {
  return app.inject({
    method: "POST",
    url: "/v1/telegram/webhook/tok-1",
    headers: { "x-telegram-bot-api-secret-token": "shh" },
    payload: { message: { chat: { id: 42 }, message_id: 7, text: "hi" } },
  })
}

describe("telegram fire gate (P14/W6)", () => {
  it("an owner who lost run access: NO execution, NO enqueue — one recorded refusal, ok to Telegram", async () => {
    mockCanRun.mockResolvedValue(false)
    const res = await fire()
    expect(res.statusCode).toBe(200)
    expect(execInserts).toHaveLength(0)
    expect(mockQueueAdd).not.toHaveBeenCalled()
    expect(mockRecordRefusal).toHaveBeenCalledWith({
      workflowId: "wf-1",
      userId: "owner-1",
      triggerType: "telegram",
      triggerId: "trig-1",
    })
  })

  it("an owner who still may: fires with the fire-time resolved payer on row and payload", async () => {
    mockCanRun.mockResolvedValue(true)
    const res = await fire()
    expect(res.statusCode).toBe(200)
    expect(mockRecordRefusal).not.toHaveBeenCalled()
    expect(mockResolve).toHaveBeenCalledWith({ userId: "owner-1", workflowId: "wf-1" })
    expect(execInserts).toHaveLength(1)
    expect(mockQueueAdd).toHaveBeenCalledWith(
      "workflow-execution",
      expect.objectContaining({
        userId: "owner-1",
        triggerType: "telegram",
        billingContext: { payer: "user", userId: "owner-1" },
      }),
      expect.anything(),
    )
  })
  it("a DEGRADED resolve on WORKSPACE-HOMED work skips the fire — never silently personal", async () => {
    mockCanRun.mockResolvedValue(true)
    mockResolve.mockResolvedValueOnce({ payer: "user", userId: "owner-1", degraded: true } as never)
    workflowHome.value = "ws-home"
    const res = await fire()
    expect(res.statusCode).toBe(200)
    expect(execInserts).toHaveLength(0)
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it("a DEGRADED resolve on PERSONAL work proceeds — that is the answer it always had", async () => {
    mockCanRun.mockResolvedValue(true)
    mockResolve.mockResolvedValueOnce({ payer: "user", userId: "owner-1", degraded: true } as never)
    workflowHome.value = null
    const res = await fire()
    expect(res.statusCode).toBe(200)
    expect(execInserts).toHaveLength(1)
  })
})

// The webhook twin's rule, mirrored (workflow-visibility.test.ts § "a
// trigger is a standing run"): creating a trigger requires the RUN right,
// checked before anything else is touched.
describe("POST /v1/telegram/triggers — a trigger is a standing run", () => {
  const WF = "0f2b7f9e-1111-4222-8333-444455556666"
  const CONN = "0f2b7f9e-7777-4888-9999-000011112222"

  function create() {
    return app.inject({
      method: "POST",
      url: "/v1/telegram/triggers",
      headers: { "x-user-id": "owner-1" },
      payload: { workflowId: WF, connectionId: CONN },
    })
  }

  it("refuses a caller who may not run — BEFORE the connection lookup; nonexistent and not-yours answer the same 403 (no oracle)", async () => {
    mockCanRun.mockResolvedValue(false)
    const res = await create()
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
    expect(mockCanRun).toHaveBeenCalledWith("owner-1", WF)
    const tables = vi.mocked(supabase.from).mock.calls.map(([t]) => t)
    expect(tables).not.toContain("social_connections")
  })

  it("a caller who may run passes the gate and reaches the connection lookup", async () => {
    mockCanRun.mockResolvedValue(true)
    const res = await create()
    // Past the authorization; whatever the connection lookup answers next is
    // that path's own business, not this test's (the webhook twin's rule).
    expect(res.statusCode).not.toBe(403)
    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith("social_connections")
  })
})
