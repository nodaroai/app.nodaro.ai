/**
 * Phase 1D.2a §4.5 — route tests for PATCH /v1/pipelines/:id (mode switch).
 *
 * The service-side enqueue + event publish are mocked so these tests focus on
 * the routing layer: auth, scope, Zod body validation, ownership check, and
 * transition guard (mode ∈ {auto,guided} AND status ∈ {running,awaiting_approval}).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import
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

// ---------------------------------------------------------------------------
// Supabase mock with mutable per-test fixture state.
//
// `currentPipeline` is the row returned by the route's `.select(...).eq("id",
// _).maybeSingle()` call. Tests overwrite it per-case via `setCurrentPipeline`
// to exercise different (mode, status, user_id) tuples.
//
// `updateMock` captures the `.update(patch).eq(col, val)` call so tests can
// assert which field gets mutated.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const TEST_USER_ID = "user-1"
const OTHER_USER_ID = "user-2"

let currentPipeline: {
  user_id: string
  mode: string
  status: string
} | null = null

const updateMock = vi.fn(
  async (
    _patch: Record<string, unknown>,
    _col: string,
    _val: string,
  ): Promise<{ data: null; error: null }> => ({ data: null, error: null }),
)

function setCurrentPipeline(row: typeof currentPipeline) {
  currentPipeline = row
}

vi.mock("../../lib/supabase.js", () => {
  function from(table: string) {
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: currentPipeline, error: null }),
            single: async () => ({ data: currentPipeline, error: null }),
          }),
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (col: string, val: string) => updateMock(patch, col, val),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: PIPELINE_ID }, error: null }),
          }),
        }),
        delete: () => ({ eq: async () => ({ data: null, error: null }) }),
      }
    }
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { tier: "pro" }, error: null }),
          }),
        }),
      }
    }
    throw new Error(`Unmocked table: ${table}`)
  }
  return { supabase: { from } }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { pipelinesRoutes } from "../pipelines.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeApp(userId: string | null = TEST_USER_ID) {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string | null }).userId = userId
    ;(req as unknown as { appAuthorization: unknown }).appAuthorization = undefined
  })
  await app.register(pipelinesRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  currentPipeline = null
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PATCH /v1/pipelines/:id mode-switch", () => {
  it("flips mode from auto → manual when status='running'", async () => {
    setCurrentPipeline({ user_id: TEST_USER_ID, mode: "auto", status: "running" })
    const app = await makeApp()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${PIPELINE_ID}`,
      payload: { mode: "manual" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, mode: "manual" })

    // The update went out with `mode: 'manual'` against the right id.
    expect(updateMock).toHaveBeenCalledOnce()
    const [patch, _col, id] = updateMock.mock.calls[0]
    expect(patch).toEqual({ mode: "manual" })
    expect(id).toBe(PIPELINE_ID)

    // Re-enqueue with reason='mode_switch'.
    const { enqueuePipelineRun } = await import("../../ee/pipelines/queue.js")
    expect(enqueuePipelineRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        userId: TEST_USER_ID,
        reason: "mode_switch",
      }),
    )

    // SSE emit carries the (unchanged) status.
    const { pipelineEvents } = await import("../../ee/pipelines/events.js")
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pipeline:status",
        pipelineId: PIPELINE_ID,
        status: "running",
      }),
    )
    await app.close()
  })

  it("flips mode from guided → manual when status='awaiting_approval'", async () => {
    setCurrentPipeline({
      user_id: TEST_USER_ID,
      mode: "guided",
      status: "awaiting_approval",
    })
    const app = await makeApp()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${PIPELINE_ID}`,
      payload: { mode: "manual" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, mode: "manual" })

    const { pipelineEvents } = await import("../../ee/pipelines/events.js")
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pipeline:status",
        pipelineId: PIPELINE_ID,
        status: "awaiting_approval",
      }),
    )
    await app.close()
  })

  it("rejects mode='manual' on failed pipeline (use Branch instead)", async () => {
    setCurrentPipeline({ user_id: TEST_USER_ID, mode: "auto", status: "failed" })
    const app = await makeApp()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${PIPELINE_ID}`,
      payload: { mode: "manual" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("mode_transition_not_allowed")
    expect(updateMock).not.toHaveBeenCalled()
    const { enqueuePipelineRun } = await import("../../ee/pipelines/queue.js")
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    await app.close()
  })

  it("rejects manual → manual (already manual)", async () => {
    setCurrentPipeline({ user_id: TEST_USER_ID, mode: "manual", status: "running" })
    const app = await makeApp()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${PIPELINE_ID}`,
      payload: { mode: "manual" },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("mode_transition_not_allowed")
    expect(updateMock).not.toHaveBeenCalled()
    await app.close()
  })

  it("rejects when caller doesn't own the pipeline (404 not_found)", async () => {
    // Existence-leak guard — wrong-user lookups must return 404, NOT 403.
    setCurrentPipeline({ user_id: OTHER_USER_ID, mode: "auto", status: "running" })
    const app = await makeApp()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${PIPELINE_ID}`,
      payload: { mode: "manual" },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    expect(updateMock).not.toHaveBeenCalled()
    await app.close()
  })

  it("rejects body without mode='manual' (400 validation_error)", async () => {
    setCurrentPipeline({ user_id: TEST_USER_ID, mode: "auto", status: "running" })
    const app = await makeApp()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${PIPELINE_ID}`,
      payload: { mode: "auto" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(updateMock).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 404 when pipeline doesn't exist", async () => {
    setCurrentPipeline(null)
    const app = await makeApp()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${PIPELINE_ID}`,
      payload: { mode: "manual" },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    await app.close()
  })

  it("returns 401 when auth is missing", async () => {
    setCurrentPipeline({ user_id: TEST_USER_ID, mode: "auto", status: "running" })
    const app = await makeApp(null)
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/${PIPELINE_ID}`,
      payload: { mode: "manual" },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it("returns 400 for non-uuid pipeline id", async () => {
    setCurrentPipeline({ user_id: TEST_USER_ID, mode: "auto", status: "running" })
    const app = await makeApp()
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/pipelines/not-a-uuid`,
      payload: { mode: "manual" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    await app.close()
  })
})
