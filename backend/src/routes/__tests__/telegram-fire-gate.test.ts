// P14/W6 — the Telegram fire lane finally asks the same fire-time question
// the webhook and schedule lanes always asked: may the trigger's owner STILL
// run this workflow? A trigger outlives the session that created it; without
// the gate the bot kept firing the current graph after the owner lost access.
import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const TRIGGER_1 = {
  triggerId: "trig-1",
  userId: "owner-1",
  workflowId: "wf-1",
  connectionId: "conn-1",
  nodeId: "tg-node-1",
  chatIdFilter: undefined,
  messageTypeFilters: undefined,
}

const { mockCanRun, mockRecordRefusal, mockResolve, mockQueueAdd, mockFailWaiting, failAttempts, execInserts, execReadBack, workflowHome, botTriggers } = vi.hoisted(() => ({
  mockCanRun: vi.fn(),
  mockRecordRefusal: vi.fn(async () => undefined),
  mockResolve: vi.fn(async (input: { userId: string }) => ({ payer: "user" as const, userId: input.userId })),
  mockQueueAdd: vi.fn(async (..._a: unknown[]) => ({})),
  /** A run the queue refuses is failed through its own failure write (lib/enqueue-execution.ts). */
  mockFailWaiting: vi.fn(async (..._a: unknown[]) => true),
  /** How many writes that failure write took: a false after more than one is read back (lib/enqueue-execution.ts). */
  failAttempts: { value: 1 },
  execInserts: [] as Array<Record<string, unknown>>,
  /** What the read-back of a run answers when its failure write answered false (lib/enqueue-execution.ts). */
  execReadBack: { value: { data: null, error: null } as { data: unknown; error: unknown } },
  workflowHome: { value: null as string | null },
  /** Every trigger listening on the bot; null: the one trigger below. */
  botTriggers: { value: null as Array<Record<string, unknown>> | null },
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
vi.mock("@/lib/concurrency-lanes/run-failure.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/concurrency-lanes/run-failure.js")>()),
  failWaitingExecution: mockFailWaiting,
  // The form the refused-run settle calls (lib/enqueue-execution.ts): mockFailWaiting's answer after
  // failAttempts.value writes. A false after one write is believed without a read-back.
  failWaitingExecutionDetailed: async (...a: unknown[]) => ({ failed: await mockFailWaiting(...a), attempts: failAttempts.value }),
}))
vi.mock("@/lib/app-reports.js", () => ({ insertAppReport: vi.fn(async () => true) }))
vi.mock("@/lib/telegram-router.js", () => ({
  // The secret belongs to the URL; the triggers are every listener on that bot.
  getRouteForToken: () => ({
    secretToken: "shh",
    triggers: botTriggers.value ?? [TRIGGER_1],
  }),
  downloadTelegramFile: vi.fn(),
}))
vi.mock("@/lib/telegram-trigger-activation.js", () => ({
  ensureBotRegistration: vi.fn(),
  syncBotRegistration: vi.fn(async () => undefined),
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
          // The read-back of a run by id: `.select(…).eq("id", …).maybeSingle()`.
          const read: Record<string, unknown> = {}
          read.select = vi.fn().mockReturnValue(read)
          read.eq = vi.fn().mockReturnValue(read)
          read.maybeSingle = vi.fn().mockImplementation(async () => execReadBack.value)
          return {
            ...read,
            insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
              execInserts.push(row)
              // exec-1, exec-2, …: one execution per trigger the message fires.
              const id = `exec-${execInserts.length}`
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
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
import { UNQUEUED_EXECUTION_CLIENT_MESSAGE, UNQUEUED_EXECUTION_MESSAGE } from "@/lib/enqueue-execution.js"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  execInserts.length = 0
  execReadBack.value = { data: null, error: null }
  failAttempts.value = 1
  botTriggers.value = null
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
        // The node the row was projected from rides the run, so the worker
        // executes the branch behind THIS trigger (`triggerRunScope`) — two
        // Telegram Triggers on one canvas are two branch runs, not two runs
        // of the whole workflow.
        triggerNodeId: "tg-node-1",
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

// A queue that refuses a trigger's run (lib/enqueue-execution.ts): the run is
// failed from `pending` at once with its key released, and the bot's other
// triggers still fire. An error answer makes Telegram deliver the message
// again, which fires every trigger again, so it is given only when no run of
// the message started and every refused run is failed (those runs carry no
// key: the redelivery fires them again cleanly). Otherwise Telegram gets ok.
describe("telegram fire: a queue that refuses a trigger's run", () => {
  it("the run is failed, the next trigger still fires, and Telegram gets its ok", async () => {
    mockCanRun.mockResolvedValue(true)
    workflowHome.value = null
    botTriggers.value = [TRIGGER_1, { ...TRIGGER_1, triggerId: "trig-2", workflowId: "wf-2", nodeId: "tg-node-2" }]
    mockQueueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    const res = await fire()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    expect(execInserts).toHaveLength(2)
    expect(mockFailWaiting).toHaveBeenCalledTimes(1)
    expect(mockFailWaiting).toHaveBeenCalledWith("exec-1", UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
    // The second trigger's run was queued as usual.
    expect(mockQueueAdd).toHaveBeenCalledTimes(2)
    expect(mockQueueAdd).toHaveBeenLastCalledWith(
      "workflow-execution",
      expect.objectContaining({ executionId: "exec-2", workflowId: "wf-2", triggerNodeId: "tg-node-2" }),
      { jobId: "exec-2" },
    )
  })

  it("a failure write that cannot land still answers Telegram ok (the never-started sweep fails the run)", async () => {
    mockCanRun.mockResolvedValue(true)
    workflowHome.value = null
    mockQueueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    mockFailWaiting.mockRejectedValueOnce(new Error("could not write the execution"))
    const res = await fire()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it("the only run refused and failed: nothing started, so Telegram gets an error and delivers the message again", async () => {
    mockCanRun.mockResolvedValue(true)
    workflowHome.value = null
    mockQueueAdd.mockRejectedValueOnce(new Error("OOM command not allowed when used memory > 'maxmemory'."))
    const res = await fire()
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: "internal_error", message: UNQUEUED_EXECUTION_CLIENT_MESSAGE } })
    expect(res.body).not.toContain("maxmemory")
    expect(mockFailWaiting).toHaveBeenCalledWith("exec-1", UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
  })

  it("every trigger's run refused and failed: an error too", async () => {
    mockCanRun.mockResolvedValue(true)
    workflowHome.value = null
    botTriggers.value = [TRIGGER_1, { ...TRIGGER_1, triggerId: "trig-2", workflowId: "wf-2", nodeId: "tg-node-2" }]
    mockQueueAdd.mockRejectedValueOnce(new Error("Connection is closed.")).mockRejectedValueOnce(new Error("Connection is closed."))
    const res = await fire()
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(mockFailWaiting).toHaveBeenCalledTimes(2)
    expect(mockFailWaiting).toHaveBeenCalledWith("exec-1", UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
    expect(mockFailWaiting).toHaveBeenCalledWith("exec-2", UNQUEUED_EXECUTION_MESSAGE, { idempotency_key: null })
  })

  it("one trigger skipped by its gate and the other's run refused and failed: still an error (the gate's refusal is recorded once)", async () => {
    workflowHome.value = null
    botTriggers.value = [TRIGGER_1, { ...TRIGGER_1, triggerId: "trig-2", workflowId: "wf-2", nodeId: "tg-node-2" }]
    mockCanRun.mockImplementation(async (_userId: string, workflowId: string) => workflowId === "wf-2")
    mockQueueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    const res = await fire()
    expect(res.statusCode).toBe(500)
    expect(mockRecordRefusal).toHaveBeenCalledTimes(1)
    expect(execInserts).toHaveLength(1)
  })

  it("a refused run that moved on (a worker claimed it) started: Telegram gets its ok", async () => {
    mockCanRun.mockResolvedValue(true)
    workflowHome.value = null
    mockQueueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    mockFailWaiting.mockResolvedValueOnce(false)
    failAttempts.value = 2
    execReadBack.value = { data: { status: "running", error_message: null }, error: null }
    const res = await fire()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it("a refused run whose failure the read-back cannot confirm (unsettled) keeps the ok", async () => {
    mockCanRun.mockResolvedValue(true)
    workflowHome.value = null
    mockQueueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    mockFailWaiting.mockResolvedValueOnce(false)
    failAttempts.value = 2
    execReadBack.value = { data: null, error: { message: "could not read" } }
    const res = await fire()
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it("a refused run whose lost-answer write the read-back finds failed counts as failed: an error", async () => {
    mockCanRun.mockResolvedValue(true)
    workflowHome.value = null
    mockQueueAdd.mockRejectedValueOnce(new Error("Connection is closed."))
    mockFailWaiting.mockResolvedValueOnce(false)
    failAttempts.value = 2
    execReadBack.value = { data: { status: "failed", error_message: UNQUEUED_EXECUTION_MESSAGE }, error: null }
    const res = await fire()
    expect(res.statusCode).toBe(500)
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
