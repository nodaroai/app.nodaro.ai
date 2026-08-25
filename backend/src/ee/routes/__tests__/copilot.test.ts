/**
 * Route contract: who may call this at all, what refuses a turn before any
 * spend, and that the SSE error text never carries a raw internal message
 * (SSE bypasses the 500 sanitizer — the wire text comes from a fixed map).
 */
import { describe, expect, it, vi, beforeEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const { state } = vi.hoisted(() => ({
  state: {
    settings: { copilot_enabled: true } as Record<string, unknown>,
    thread: null as unknown,
    workflow: null as unknown,
    liveTurn: null as unknown,
    activeThreads: 0,
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
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => state.settings }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: state.workflow }),
    }),
  },
}))
vi.mock("@/middleware/credit-guard.js", () => ({
  creditGuard: () => async () => undefined,
  paygSurfaceGuard: () => async () => undefined,
  reserveCreditsForJob: async () => ({ usageLogId: "log1", creditsReserved: 150, watermark: false }),
}))
vi.mock("@/lib/queue.js", () => ({ redis: { incr: vi.fn().mockResolvedValue(1), expire: vi.fn(), ttl: vi.fn().mockResolvedValue(60) } }))
vi.mock("../../copilot/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../copilot/store.js")>()
  return {
    ...actual,
    getThreadForUser: async () => state.thread,
    findActiveThread: async () => state.thread,
    countActiveThreads: async () => state.activeThreads,
    findLiveTurn: async () => state.liveTurn,
    findStaleTurns: async () => [],
    threadAtTurnCap: actual.threadAtTurnCap,
  }
})

const memoriesMock = vi.hoisted(() => ({
  listMemories: vi.fn(async () => [] as unknown[]),
  deleteMemory: vi.fn(async () => false),
}))
vi.mock("../../copilot/memories.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../copilot/memories.js")>()
  return { ...actual, listMemories: memoriesMock.listMemories, deleteMemory: memoriesMock.deleteMemory }
})

const { registerCopilotRoutes } = await import("../copilot.js")
const { TURN_ERROR_TEXT } = await import("../../copilot/turn-runner.js")

/** Minimal app whose auth hook is driven per-request by headers. */
async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify()
  app.addHook("preHandler", async (req) => {
    const kind = req.headers["x-test-auth"] as string | undefined
    ;(req as { authKind?: string }).authKind = kind ?? "jwt"
    ;(req as { userId?: string }).userId = kind === "none" ? undefined : "u1"
  })
  await registerCopilotRoutes(app)
  return app
}

const thread = {
  id: "th1",
  user_id: "u1",
  workflow_id: "wf1",
  run_mode: "ask" as const,
  auto_run_limit_credits: 100,
  user_turn_count: 0,
  archived_at: null,
  last_message_at: null,
  created_at: "2026-08-23T10:00:00Z",
}

beforeEach(() => {
  state.settings = { copilot_enabled: true }
  state.thread = thread
  state.workflow = { id: "wf1", project_id: "p1", name: "W", version: 3, nodes: [], edges: [] }
  state.liveTurn = null
  state.activeThreads = 0
})

describe("copilot routes — access", () => {
  it("rejects every non-JWT caller (app token, API token, internal secret)", async () => {
    const app = await buildApp()
    for (const kind of ["app_token", "api_token", "internal"]) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/copilot/threads/th1/messages",
        headers: { "x-test-auth": kind },
        payload: { message: "hi" },
      })
      expect(res.statusCode, kind).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
    }
  })

  it("answers 503 when the kill switch is off", async () => {
    state.settings = { copilot_enabled: false }
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/copilot/threads",
      payload: { workflowId: "11111111-2222-4333-8444-555555555555" },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe("feature_disabled")
  })
})

describe("copilot routes — turn preconditions", () => {
  it("409s on a stale baseVersion instead of editing the wrong graph", async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/copilot/threads/th1/messages",
      payload: { message: "add a node", baseVersion: 2 },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("workflow_stale")
    expect(res.json().currentVersion).toBe(3)
  })

  it("409s while another turn of the thread is live", async () => {
    state.liveTurn = { id: "turn-live" }
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("turn_in_progress")
  })

  it("409s at the thread's turn cap", async () => {
    state.thread = { ...thread, user_turn_count: 200 }
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("thread_cap_reached")
  })

  it("404s when the thread's workflow is no longer the caller's", async () => {
    state.workflow = null
    const app = await buildApp()
    const res = await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message: "hi" } })
    expect(res.statusCode).toBe(404)
  })

  it("rejects an oversized or empty message", async () => {
    const app = await buildApp()
    for (const message of ["", "x".repeat(16_001)]) {
      const res = await app.inject({ method: "POST", url: "/v1/copilot/threads/th1/messages", payload: { message } })
      expect(res.statusCode).toBe(400)
    }
  })

  it("409s when the user has too many open conversations", async () => {
    state.activeThreads = 50
    const app = await buildApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/copilot/threads",
      payload: { workflowId: "11111111-2222-4333-8444-555555555555" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("thread_cap_reached")
  })
})

describe("copilot memories routes (M1)", () => {
  it("refuses non-JWT callers on both routes — a token must not read or erase a user's memory", async () => {
    const app = await buildApp()
    for (const [method, url] of [
      ["GET", "/v1/copilot/memories"],
      ["DELETE", "/v1/copilot/memories/5f0e8f6a-1111-2222-3333-444455556666"],
    ] as const) {
      const res = await app.inject({ method, url, headers: { "x-test-auth": "app-token" } })
      expect(res.statusCode, `${method} ${url}`).toBe(403)
      expect(res.json().error.code).toBe("in_app_only")
    }
    expect(memoriesMock.listMemories).not.toHaveBeenCalled()
    expect(memoriesMock.deleteMemory).not.toHaveBeenCalled()
  })

  it("lists the CALLER's memories only", async () => {
    memoriesMock.listMemories.mockResolvedValueOnce([{ id: "m1", content: "always 9:16", created_at: "t" }])
    const app = await buildApp()
    const res = await app.inject({ method: "GET", url: "/v1/copilot/memories" })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.memories).toHaveLength(1)
    expect(memoriesMock.listMemories).toHaveBeenCalledWith("u1")
  })

  it("delete validates the id shape, scopes to the caller, and 404s a foreign or missing row", async () => {
    const app = await buildApp()

    const bad = await app.inject({ method: "DELETE", url: "/v1/copilot/memories/not-a-uuid" })
    expect(bad.statusCode).toBe(400)
    expect(memoriesMock.deleteMemory).not.toHaveBeenCalled()

    const missing = await app.inject({ method: "DELETE", url: "/v1/copilot/memories/5f0e8f6a-1111-2222-3333-444455556666" })
    expect(missing.statusCode).toBe(404)
    expect(memoriesMock.deleteMemory).toHaveBeenCalledWith("u1", "5f0e8f6a-1111-2222-3333-444455556666")

    memoriesMock.deleteMemory.mockResolvedValueOnce(true)
    const ok = await app.inject({ method: "DELETE", url: "/v1/copilot/memories/5f0e8f6a-1111-2222-3333-444455556666" })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().data.deleted).toBe(true)
  })
})

describe("SSE error text", () => {
  it("is a fixed map — no raw internal message can reach the wire", () => {
    for (const text of Object.values(TURN_ERROR_TEXT)) {
      expect(text).not.toMatch(/supabase|relation |column |rpc |stack/i)
      expect(text.length).toBeLessThan(120)
    }
    expect(Object.keys(TURN_ERROR_TEXT)).toContain("internal_error")
  })
})
