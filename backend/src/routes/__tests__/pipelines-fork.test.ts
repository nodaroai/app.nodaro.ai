import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import.
//
// Phase 1B.4 — covers POST /v1/pipelines/:id/fork only. The other endpoints
// are exercised in pipelines.test.ts.
// ---------------------------------------------------------------------------

vi.mock("../../lib/config.js", () => ({
  hasCredits: vi.fn(() => true),
  hasAdmin: vi.fn(() => true),
  isCommunity: vi.fn(() => false),
}))

vi.mock("../../ee/pipelines/queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
  pipelineOrchestrationQueue: { getJobs: vi.fn(async () => []) },
}))

vi.mock("../../ee/pipelines/credits.js", () => ({
  estimateUpfrontCredits: vi.fn(() => 30),
  resolveMaxCostCredits: vi.fn(() => 2000),
  reservePipelineCredits: vi.fn(async () => ({ ok: true, usageLogId: "ul-1" })),
  refundPipelineCredits: vi.fn(async () => undefined),
}))

vi.mock("../../ee/pipelines/engine.js", () => ({
  approveScriptStage: vi.fn(async () => ({ ok: true })),
  rejectScriptStage: vi.fn(async () => ({ ok: true })),
}))

vi.mock("../../ee/pipelines/entity-approval.js", () => ({
  approveEntity: vi.fn(async () => ({ ok: true })),
  rejectEntity: vi.fn(async () => ({ ok: true })),
}))

vi.mock("../../ee/pipelines/events.js", () => ({
  pipelineEvents: {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  },
}))

vi.mock("../../ee/pipelines/fork.js", () => ({
  forkPipeline: vi.fn(async (_supabase, pipelineId) => ({
    ok: true,
    pipelineId,
    forkedAt: "2026-05-18T12:00:00.000Z",
    forkedStatus: "awaiting_approval",
    forkReason: "user_takeover",
  })),
}))

// ---------------------------------------------------------------------------
// In-memory supabase mock — only the chain shapes the fork route uses.
//
// vi.mock factories are hoisted module-scope, so we inline literal IDs here
// rather than referencing top-level constants (which would TDZ).
// ---------------------------------------------------------------------------

vi.mock("../../lib/supabase.js", () => {
  const pipelines = new Map<string, { id: string; user_id: string; status: string }>()
  pipelines.set("00000000-0000-0000-0000-000000000111", {
    id: "00000000-0000-0000-0000-000000000111",
    user_id: "user-1",
    status: "awaiting_approval",
  })
  pipelines.set("term-completed", {
    id: "term-completed",
    user_id: "user-1",
    status: "completed",
  })
  pipelines.set("term-failed", {
    id: "term-failed",
    user_id: "user-1",
    status: "failed",
  })
  pipelines.set("other-user", {
    id: "other-user",
    user_id: "another-user",
    status: "running",
  })

  function from(table: string) {
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => ({
              data: pipelines.get(val) ?? null,
              error: null,
            }),
          }),
        }),
      }
    }
    throw new Error(`Unmocked table: ${table}`)
  }

  return { supabase: { from } }
})

const TEST_USER_ID = "user-1"
const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { pipelinesRoutes } from "../pipelines.js"
import { forkPipeline } from "../../ee/pipelines/fork.js"
import { pipelineOrchestrationQueue } from "../../ee/pipelines/queue.js"

async function makeApp() {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = TEST_USER_ID
    ;(req as unknown as { appAuthorization: unknown }).appAuthorization = undefined
  })
  await app.register(pipelinesRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /v1/pipelines/:id/fork", () => {
  it("forks the pipeline and returns the fork result", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/fork`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      ok: true,
      pipelineId: PIPELINE_ID,
      forkedAt: "2026-05-18T12:00:00.000Z",
      forkReason: "user_takeover",
    })
    expect(forkPipeline).toHaveBeenCalledWith(expect.anything(), PIPELINE_ID)
    // Queue cleanup ran (empty result is fine).
    expect(pipelineOrchestrationQueue.getJobs).toHaveBeenCalled()
    await app.close()
  })

  it("removes queued BullMQ jobs for the pipeline as part of cleanup", async () => {
    const removeSpy = vi.fn(async () => undefined)
    ;(pipelineOrchestrationQueue.getJobs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { data: { pipelineId: PIPELINE_ID }, remove: removeSpy },
      { data: { pipelineId: "other-pipeline" }, remove: vi.fn() },
    ])
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/fork`,
    })
    expect(res.statusCode).toBe(200)
    // Only the matching job's remove() was called.
    expect(removeSpy).toHaveBeenCalledTimes(1)
    await app.close()
  })

  it("returns 404 when the pipeline does not exist", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/00000000-0000-0000-0000-000000999999/fork",
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(forkPipeline).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 404 (not 403) when the pipeline belongs to another user (existence-leak guard)", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/other-user/fork",
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(forkPipeline).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 409 pipeline_terminal for completed pipelines", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/term-completed/fork",
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("pipeline_terminal")
    expect(res.json().error.status).toBe("completed")
    expect(forkPipeline).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 409 pipeline_terminal for failed pipelines", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/term-failed/fork",
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("pipeline_terminal")
    expect(forkPipeline).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 403 edition_required when hasCredits() is false", async () => {
    const config = await import("../../lib/config.js")
    ;(config.hasCredits as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/fork`,
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("edition_required")
    expect(forkPipeline).not.toHaveBeenCalled()
    await app.close()
  })

  it("still returns the fork result when queue cleanup throws", async () => {
    ;(pipelineOrchestrationQueue.getJobs as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("redis dropped connection"),
    )
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/fork`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
    await app.close()
  })
})
