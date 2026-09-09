/**
 * The route half of "two assistants, one workflow".
 *
 * Two half-deployed states are the reason this file exists, and each has its
 * own honest refusal:
 *
 *  - the column reaches the database AFTER this code does. A thread creation
 *    that has to name it must answer service-unavailable, not 500.
 *  - the studio editor's own turn now RUNS here, on the same loop and the same
 *    budget as the canvas one. What the route owes it is the surface: the turn
 *    is told which one it is, and the stream's first frame says so — the one
 *    place a client can learn it.
 *
 * And underneath both: a canvas thread — including one whose row predates the
 * column and carries no surface at all — still streams exactly as it does now.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { state } = vi.hoisted(() => ({
  state: {
    thread: null as unknown,
    workflow: null as unknown,
    createThreadError: null as unknown,
  },
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/config.js")>()
  return {
    ...actual,
    hasCredits: () => true,
    config: { ...actual.config, COPILOT_ENABLED: true, ANTHROPIC_API_KEY: "test-key" },
  }
})
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ copilot_enabled: true }) }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: null }),
      update: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: state.workflow }),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: "not in this harness" } }),
    }),
  },
}))

const spies = vi.hoisted(() => ({
  insertJob: vi.fn(async () => ({ data: { id: "job1" }, error: null })),
  reserveCreditsForJob: vi.fn(async () => ({ usageLogId: "log1", creditsReserved: 150, watermark: false })),
  createTurn: vi.fn(async () => ({ id: "turn1" })),
  // Typed through its INPUT: the surface and the selection the route hands the
  // turn are things this suite asserts, and a nullary spy records no arguments
  // to assert about.
  runCopilotTurn: vi.fn(async (_input: Record<string, unknown>): Promise<Record<string, unknown>> => ({
    status: "completed",
    assistantMessageId: "msg1",
    finalVersion: 4,
    creditsCharged: 10,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
  })),
  createThread: vi.fn(async () => ({ id: "th-new" })),
  findActiveThread: vi.fn(async () => state.thread),
  /** The stream itself, so "no stream" can be asserted rather than inferred. */
  createSSEStream: vi.fn(),
  /** Every event the turn put on the wire, in order. */
  sendEvent: vi.fn(),
}))

vi.mock("@/lib/insert-job.js", () => ({ insertJob: spies.insertJob }))
vi.mock("@/lib/reconcile/persistence.js", () => ({ markProviderCallStart: vi.fn() }))
vi.mock("@/lib/credits-job-lifecycle.js", () => ({ refundReservedCreditsForJob: vi.fn(async () => 1) }))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  paygSurfaceGuard: () => async () => undefined,
  reserveCreditsForJob: spies.reserveCreditsForJob,
}))
vi.mock("@/lib/queue.js", () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn(), ttl: vi.fn().mockResolvedValue(60) },
}))
vi.mock("../../copilot/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../copilot/store.js")>()
  return {
    ...actual,
    getThreadForUser: async () => state.thread,
    findActiveThread: spies.findActiveThread,
    createThread: async (...args: unknown[]) => {
      if (state.createThreadError) throw state.createThreadError
      return spies.createThread(...(args as []))
    },
    countActiveThreads: async () => 0,
    findLiveTurn: async () => null,
    findStaleTurns: async () => [],
    createTurn: spies.createTurn,
    updateThreadSettings: async (_id: string, _userId: string, patch: Record<string, unknown>) => ({
      ...(state.thread as Record<string, unknown>),
      ...patch,
    }),
  }
})
vi.mock("@/lib/sse.js", () => ({
  createSSEStream: async (_req: unknown, reply: { hijack: () => void; raw: { end: () => void } }) => {
    spies.createSSEStream()
    reply.hijack()
    return { sendEvent: spies.sendEvent, sendComment: vi.fn(), close: () => reply.raw.end(), isClosed: false }
  },
}))
vi.mock("../../copilot/turn-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../copilot/turn-runner.js")>()
  return { ...actual, runCopilotTurn: spies.runCopilotTurn }
})

const { registerCopilotRoutes } = await import("../copilot.js")
const { DEFAULT_THREAD_SURFACE, ThreadSurfaceNotPromotedError } = await import("../../copilot/store.js")

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    ;(req as { authKind?: string }).authKind = "jwt"
    ;(req as { userId?: string }).userId = "u1"
  })
  await registerCopilotRoutes(app)
  return app
}

const WORKFLOW_ID = "11111111-2222-4333-8444-555555555555"

/** A canvas thread whose row predates the column: no surface at all. */
const legacyThread = {
  id: "th1",
  user_id: "u1",
  workflow_id: "wf1",
  run_mode: "ask" as const,
  auto_run_limit_credits: 100,
  user_turn_count: 0,
  archived_at: null,
  last_message_at: null,
  created_at: "2026-09-09T10:00:00Z",
}

beforeEach(() => {
  state.thread = legacyThread
  state.workflow = { id: "wf1", project_id: "p1", name: "W", version: 3, nodes: [], edges: [] }
  state.createThreadError = null
  for (const spy of Object.values(spies)) spy.mockClear()
})

describe("the canvas routes ask for the canvas thread", () => {
  it("names its surface on the create handshake", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/copilot/threads", payload: { workflowId: WORKFLOW_ID } })
    expect(res.statusCode).toBe(200)
    expect(spies.findActiveThread).toHaveBeenCalledWith("u1", "wf1", DEFAULT_THREAD_SURFACE)
  })

  it("names it on the lookup the editor polls too", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/copilot/threads?workflowId=${WORKFLOW_ID}` })
    expect(res.statusCode).toBe(200)
    expect(spies.findActiveThread).toHaveBeenCalledWith("u1", WORKFLOW_ID, DEFAULT_THREAD_SURFACE)
  })
})

function frame(type: string): Record<string, unknown> | undefined {
  const call = spies.sendEvent.mock.calls.find((args) => (args[0] as { type?: string })?.type === type)
  return call?.[0] as Record<string, unknown> | undefined
}

describe("a message on a studio thread", () => {
  beforeEach(() => {
    state.thread = { ...legacyThread, surface: "studio" }
  })

  it("streams: the turn runs, on its own surface", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/copilot/threads/th1/messages",
      payload: { message: "hi" },
    })

    expect(res.statusCode).toBe(200)
    expect(spies.createSSEStream).toHaveBeenCalledTimes(1)
    expect(spies.runCopilotTurn).toHaveBeenCalledTimes(1)
    expect(spies.runCopilotTurn.mock.calls[0][0]).toMatchObject({ surface: "studio" })
  })

  it("names the surface in the stream's first frame — the only place a client learns it", async () => {
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(frame("metadata")).toMatchObject({ data: { surface: "studio" } })
  })

  it("carries the person's selection through to the turn", async () => {
    const app = await buildApp()
    await app.inject({
      method: "POST",
      url: "/v1/copilot/threads/th1/messages",
      payload: { message: "hi", focus: { shotId: "s2" } },
    })
    expect(spies.runCopilotTurn.mock.calls[0][0]).toMatchObject({ focus: { shotId: "s2" } })
  })

  it("puts the turn's one card on the wire before the turn's usage", async () => {
    const proposal = { id: "p1", kind: "edit", tool: "edit_studio_production", args: {}, preview: null, restorable: true, safe: true, note: null }
    spies.runCopilotTurn.mockResolvedValueOnce({
      status: "completed",
      assistantMessageId: "msg1",
      finalVersion: null,
      creditsCharged: 10,
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
      proposal,
    })
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })

    const types = spies.sendEvent.mock.calls.map((args) => (args[0] as { type: string }).type)
    expect(frame("action_proposed")).toMatchObject({ data: proposal })
    expect(types.indexOf("action_proposed")).toBeLessThan(types.indexOf("usage"))
  })

  it("emits no card when the turn proposed nothing", async () => {
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(frame("action_proposed")).toBeUndefined()
  })
})

describe("a canvas thread still streams", () => {
  it("runs the turn for a row written before the column existed", async () => {
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(spies.runCopilotTurn).toHaveBeenCalledTimes(1)
  })

  it("runs the turn for a row that carries the canvas surface explicitly", async () => {
    state.thread = { ...legacyThread, surface: "workflow" }
    const app = await buildApp()
    await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(spies.runCopilotTurn).toHaveBeenCalledTimes(1)
  })
})

describe("creating a thread the database cannot hold yet", () => {
  it("answers service-unavailable, not an internal error", async () => {
    state.thread = null
    state.createThreadError = new ThreadSurfaceNotPromotedError("studio")
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/copilot/threads", payload: { workflowId: WORKFLOW_ID } })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("surface_not_promoted")
  })
})

describe("the wire says which assistant a thread belongs to", () => {
  it("reports the canvas for a row written before the column existed", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/copilot/threads?workflowId=${WORKFLOW_ID}` })
    // Absent on the row, present on the wire: the key is how an operator tells
    // this deployment from one that has never heard of a second assistant.
    expect(res.json().data.thread.surface).toBe(DEFAULT_THREAD_SURFACE)
  })

  it("reports the studio editor's surface for a row that carries it", async () => {
    state.thread = { ...legacyThread, surface: "studio" }
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/copilot/threads?workflowId=${WORKFLOW_ID}` })
    expect(res.json().data.thread.surface).toBe("studio")
  })
})

describe("a caller may ask for a surface", () => {
  it("looks the asked-for one up and creates it, rather than the canvas", async () => {
    state.thread = null
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/copilot/threads",
      payload: { workflowId: WORKFLOW_ID, surface: "studio" },
    })
    expect(res.statusCode).toBe(201)
    expect(spies.findActiveThread).toHaveBeenCalledWith("u1", "wf1", "studio")
    expect(spies.createThread).toHaveBeenCalledWith("u1", "wf1", expect.objectContaining({ surface: "studio" }))
  })

  it("looks it up on the polled lookup too", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/copilot/threads?workflowId=${WORKFLOW_ID}&surface=studio` })
    expect(res.statusCode).toBe(200)
    expect(spies.findActiveThread).toHaveBeenCalledWith("u1", WORKFLOW_ID, "studio")
  })

  it("refuses a surface that is not one of ours", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: `/v1/copilot/threads?workflowId=${WORKFLOW_ID}&surface=nonsense` })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    // …and the unknown word never reached the store as if it were a surface.
    expect(spies.findActiveThread).not.toHaveBeenCalled()
  })
})

describe("the unattended run mode is the canvas assistant's alone", () => {
  it("refuses to put a studio thread into it", async () => {
    state.thread = { ...legacyThread, surface: "studio" }
    const app = await buildApp()
    const res = await app.inject({ method: "PATCH", url: "/v1/copilot/threads/th1", payload: { runMode: "auto" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("run_mode_locked")
  })

  it("leaves that thread's other settings settable", async () => {
    state.thread = { ...legacyThread, surface: "studio" }
    const app = await buildApp()
    const res = await app.inject({ method: "PATCH", url: "/v1/copilot/threads/th1", payload: { modelTier: "premium" } })
    expect(res.statusCode).toBe(200)
  })

  it("still lets a canvas thread run unattended", async () => {
    const app = await buildApp()
    const res = await app.inject({ method: "PATCH", url: "/v1/copilot/threads/th1", payload: { runMode: "auto" } })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.thread.runMode).toBe("auto")
  })
})

describe("a thread's own facts are answered before the surface matters", () => {
  it("answers the turn cap, which is true whatever is deployed", async () => {
    state.thread = { ...legacyThread, surface: "studio", user_turn_count: 200 }
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("thread_cap_reached")
  })

  it("answers a closed conversation as closed", async () => {
    state.thread = { ...legacyThread, surface: "studio", archived_at: "2026-09-09T11:00:00Z" }
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("thread_archived")
  })
})

describe("asking for a surface the database cannot hold yet", () => {
  it("is the request shape that reaches the column, and it too is refused", async () => {
    state.thread = null
    state.createThreadError = new ThreadSurfaceNotPromotedError("studio")
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/copilot/threads",
      payload: { workflowId: WORKFLOW_ID, surface: "studio" },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("surface_not_promoted")
  })
})
