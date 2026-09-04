/**
 * Phase 1D.3 — route tests for POST /v1/pipelines/:id/branch.
 *
 * The `branchPipeline` service is fully mocked so these tests focus on the
 * routing layer: auth, scope, Zod validation, and BranchPipelineError → HTTP
 * status mapping.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest"
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

vi.mock("../../ee/pipelines/fork.js", () => ({
  forkPipeline: vi.fn(async (_supabase: unknown, pipelineId: string) => ({
    ok: true,
    pipelineId,
    forkedAt: "2026-05-20T00:00:00.000Z",
    forkedStatus: "completed",
    forkReason: "user_takeover",
  })),
}))

// ---------------------------------------------------------------------------
// The mock for branch-pipeline is the key fixture for this test file.
// We control the resolved/rejected value per test via mockResolvedValueOnce /
// mockRejectedValueOnce.
// ---------------------------------------------------------------------------

class _BranchPipelineError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = "BranchPipelineError"
  }
}

const branchPipelineMock = vi.fn()

vi.mock("../../ee/pipelines/branch-pipeline.js", () => ({
  branchPipeline: branchPipelineMock,
  BranchPipelineError: _BranchPipelineError,
}))

// ---------------------------------------------------------------------------
// Minimal Supabase mock — the branch route calls `supabase` only as part of
// `branchPipeline` which is itself mocked, so we only need the mock to not
// throw on profiles (used by existing POST /v1/pipelines).
// ---------------------------------------------------------------------------

vi.mock("../../lib/supabase.js", () => {
  function from(table: string) {
    if (table === "profiles") {
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { tier: "pro" }, error: null }),
          }),
        }),
      }
    }
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: PIPELINE_ID,
                user_id: TEST_USER_ID,
                status: "completed",
              },
              error: null,
            }),
            single: async () => ({
              data: {
                id: PIPELINE_ID,
                user_id: TEST_USER_ID,
                status: "completed",
              },
              error: null,
            }),
          }),
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: PIPELINE_ID }, error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        delete: () => ({ eq: async () => ({ data: null, error: null }) }),
      }
    }
    if (table === "pipeline_stages") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }
    }
    throw new Error(`Unmocked table: ${table}`)
  }
  return { supabase: { from } }
})

// ---------------------------------------------------------------------------
// Constants + helpers
// ---------------------------------------------------------------------------

const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const TEST_USER_ID = "user-1"
const NEW_PIPELINE_ID = "00000000-0000-0000-0000-000000000222"

import { pipelinesRoutes } from "../pipelines.js"

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /v1/pipelines/:id/branch", () => {
  let app: Awaited<ReturnType<typeof makeApp>>
  beforeAll(async () => {
    app = await makeApp()
  })
  afterAll(async () => {
    await app.close()
  })

  it("returns 201 + pipelineId on success", async () => {
    branchPipelineMock.mockResolvedValueOnce({
      newPipelineId: NEW_PIPELINE_ID,
      clonedStages: ["script", "characters", "objects", "locations", "shot_list"],
      clonedEntities: 7,
    })

    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "scene_images" },
    })

    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.pipelineId).toBe(NEW_PIPELINE_ID)
    expect(body.clonedStages).toHaveLength(5)
    expect(body.clonedEntities).toBe(7)
    expect(branchPipelineMock).toHaveBeenCalledOnce()
    expect(branchPipelineMock).toHaveBeenCalledWith(
      expect.objectContaining({
        originalPipelineId: PIPELINE_ID,
        fromStage: "scene_images",
        userId: TEST_USER_ID,
      }),
    )
  })

  it("returns 400 when pipeline not completed (BranchPipelineError pipeline_not_completed)", async () => {
    branchPipelineMock.mockRejectedValueOnce(
      new _BranchPipelineError("pipeline_not_completed", "Pipeline must be completed"),
    )

    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "scene_images" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("pipeline_not_completed")
  })

  it("returns 404 when pipeline not found (BranchPipelineError pipeline_not_found)", async () => {
    branchPipelineMock.mockRejectedValueOnce(
      new _BranchPipelineError("pipeline_not_found", "Not found"),
    )

    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/00000000-0000-0000-0000-000000000999/branch`,
      payload: { fromStage: "scene_images" },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("pipeline_not_found")
  })

  it("returns 403 when pipeline belongs to another user (BranchPipelineError forbidden)", async () => {
    branchPipelineMock.mockRejectedValueOnce(
      new _BranchPipelineError("forbidden", "Pipeline belongs to a different user"),
    )

    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "scene_images" },
    })

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("forbidden")
  })

  // ── Reserve refusals keep their identity (F6) ──────────────────────────
  //
  // This route has NO `creditGuard` preHandler, so the reservation inside
  // branchPipeline is the only refusal point. The route used to collapse every
  // non-`insufficient_credits` reason to `reservation_failed` → HTTP 500, which
  // meant a user who had simply exhausted their per-user allowance got a
  // server-error toast: `frontend/src/lib/api.ts` keys `UserAllowanceExceeded
  // Error` on the CODE, and the code never travelled.
  it("returns 402 user_allowance_exceeded — the per-user quota refusal, not a 500", async () => {
    branchPipelineMock.mockRejectedValueOnce(
      new _BranchPipelineError("user_allowance_exceeded", "Credit reservation failed: user_allowance_exceeded"),
    )

    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "scene_images" },
    })

    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("user_allowance_exceeded")
  })

  it("returns 500 allowance_unconfigured — an operator fault is NOT a 402", async () => {
    // The one member of the reserve vocabulary that is deliberately a 5xx:
    // telling a user to buy credits would send them after something that
    // cannot help them (reserve-errors.ts, ALLOWANCE_UNCONFIGURED). The CODE
    // still travels, so the log line is greppable.
    branchPipelineMock.mockRejectedValueOnce(
      new _BranchPipelineError("allowance_unconfigured", "Credit reservation failed: allowance_unconfigured"),
    )

    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "scene_images" },
    })

    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("allowance_unconfigured")
  })

  it("returns 409 for a workspace refusal, and 500 reservation_failed for a genuine fault", async () => {
    branchPipelineMock.mockRejectedValueOnce(new _BranchPipelineError("workspace_archived", "archived"))
    const archived = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "scene_images" },
    })
    expect(archived.statusCode).toBe(409)

    branchPipelineMock.mockRejectedValueOnce(new _BranchPipelineError("reservation_failed", "deadlock detected"))
    const fault = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "scene_images" },
    })
    expect(fault.statusCode).toBe(500)
    expect(fault.json().error.code).toBe("reservation_failed")
  })

  it("returns 400 for invalid fromStage (Zod rejection — service never called)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "garbage_stage" },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(branchPipelineMock).not.toHaveBeenCalled()
  })

  it("returns 401 when auth is missing", async () => {
    const unauthApp = await makeApp(null)
    const res = await unauthApp.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/branch`,
      payload: { fromStage: "scene_images" },
    })
    expect(res.statusCode).toBe(401)
    await unauthApp.close()
  })
})
