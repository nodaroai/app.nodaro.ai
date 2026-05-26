import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import.
//
// Covers POST /v1/pipelines/:id/cancel only. Other endpoints are exercised
// in pipelines.test.ts and the sibling pipelines-*.test.ts files.
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
// In-memory supabase mock — covers the chain shapes the cancel route uses:
//   pipelines.select(...).eq(...).maybeSingle()
//   pipelines.update(...).eq(...)
//   pipeline_stages.select(...).eq(...).eq(...)               (running rows)
//   pipeline_stages.update(...).eq(...).eq(...)               (flip them)
// ---------------------------------------------------------------------------

interface FakePipeline {
  id: string
  user_id: string
  reserved_credits: number
  spent_credits: number
  status: string
}
interface FakeStage {
  id: string
  pipeline_id: string
  stage_name: string
  status: string
}

vi.mock("../../lib/supabase.js", () => {
  // Inline string literals (not the top-level const refs) so vi.mock's
  // hoisted factory doesn't TDZ-crash on uninitialized constants.
  const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
  const PIPELINE_AWAITING = "00000000-0000-0000-0000-000000000222"
  const PIPELINE_OTHER_USER = "00000000-0000-0000-0000-000000000333"
  const TEST_USER_ID = "user-1"

  const pipelines = new Map<string, FakePipeline>()
  pipelines.set(PIPELINE_ID, {
    id: PIPELINE_ID,
    user_id: TEST_USER_ID,
    reserved_credits: 63,
    spent_credits: 12,
    status: "running",
  })
  pipelines.set(PIPELINE_AWAITING, {
    id: PIPELINE_AWAITING,
    user_id: TEST_USER_ID,
    reserved_credits: 63,
    spent_credits: 0,
    status: "awaiting_approval",
  })
  pipelines.set(PIPELINE_OTHER_USER, {
    id: PIPELINE_OTHER_USER,
    user_id: "another-user",
    reserved_credits: 63,
    spent_credits: 0,
    status: "running",
  })

  const stages = new Map<string, FakeStage[]>()
  // Pipeline 111 has a running script stage that should be flipped to cancelled.
  stages.set(PIPELINE_ID, [
    { id: "s-1", pipeline_id: PIPELINE_ID, stage_name: "script", status: "running" },
  ])
  // Awaiting pipeline has no running stages.
  stages.set(PIPELINE_AWAITING, [
    { id: "s-2", pipeline_id: PIPELINE_AWAITING, stage_name: "script", status: "awaiting_approval" },
  ])

  const stageUpdates: Array<{ patch: Record<string, unknown>; filters: Record<string, unknown> }> = []

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
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, val: string) => {
            const row = pipelines.get(val)
            if (row) Object.assign(row, patch)
            return { data: null, error: null }
          },
        }),
      }
    }
    if (table === "pipeline_stages") {
      return {
        select: () => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              then: (resolve: (v: { data: FakeStage[]; error: null }) => unknown) => {
                const filtered = (stages.get(val1) ?? []).filter(
                  (s) => col2 === "status" ? s.status === val2 : true,
                )
                return resolve({ data: filtered, error: null })
              },
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          const filters: Record<string, unknown> = {}
          const chain = {
            eq: (col: string, val: unknown) => {
              filters[col] = val
              return chain
            },
            then: (resolve: (v: { data: null; error: null }) => unknown) => {
              stageUpdates.push({ patch, filters: { ...filters } })
              const pipelineId = filters.pipeline_id as string
              const statusFilter = filters.status as string | undefined
              const rows = stages.get(pipelineId) ?? []
              for (const s of rows) {
                if (statusFilter && s.status !== statusFilter) continue
                Object.assign(s, patch)
              }
              return resolve({ data: null, error: null })
            },
          }
          return chain
        },
      }
    }
    throw new Error(`Unmocked table: ${table}`)
  }

  return {
    supabase: { from },
    __test_pipelines: pipelines,
    __test_stages: stages,
    __test_stageUpdates: stageUpdates,
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { pipelinesRoutes } from "../pipelines.js"
import { refundPipelineCredits } from "../../ee/pipelines/credits.js"
import { pipelineEvents } from "../../ee/pipelines/events.js"
import * as supabaseMod from "../../lib/supabase.js"

// Constants used by test bodies — duplicated from the inline mock-factory
// version above (the factory can't reference these top-level constants
// because vi.mock hoists the factory above this declaration).
const TEST_USER_ID = "user-1"
const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const PIPELINE_AWAITING = "00000000-0000-0000-0000-000000000222"
const PIPELINE_OTHER_USER = "00000000-0000-0000-0000-000000000333"

const testPipelines = (supabaseMod as unknown as {
  __test_pipelines: Map<string, FakePipeline>
}).__test_pipelines
const testStages = (supabaseMod as unknown as {
  __test_stages: Map<string, FakeStage[]>
}).__test_stages

async function makeApp(userId = TEST_USER_ID) {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = userId
    ;(req as unknown as { appAuthorization: unknown }).appAuthorization = undefined
  })
  await app.register(pipelinesRoutes)
  await app.ready()
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset pipeline statuses so each test gets a clean baseline.
  testPipelines.get(PIPELINE_ID)!.status = "running"
  testPipelines.get(PIPELINE_AWAITING)!.status = "awaiting_approval"
  testStages.get(PIPELINE_ID)![0]!.status = "running"
  testStages.get(PIPELINE_AWAITING)![0]!.status = "awaiting_approval"
})

describe("POST /v1/pipelines/:id/cancel", () => {
  it("cancels the pipeline and flips in-flight stages to cancelled", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/cancel`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    // Pipeline row flipped.
    expect(testPipelines.get(PIPELINE_ID)!.status).toBe("cancelled")

    // The in-flight stage row was flipped — this is the new behavior added
    // by this PR. Before, the stage stayed at `running` forever and the
    // /admin/stuck-pipelines page kept listing the pipeline.
    expect(testStages.get(PIPELINE_ID)![0]!.status).toBe("cancelled")

    // Per-stage SSE event was published so any open panel sees the row flip.
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stage:status",
        pipelineId: PIPELINE_ID,
        stageName: "script",
        status: "cancelled",
      }),
    )
    // Pipeline-level event too.
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pipeline:status",
        pipelineId: PIPELINE_ID,
        status: "cancelled",
      }),
    )

    // Refund fired (reserved=63, spent=12 → refund=51).
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({ credits: 51, reason: "user_cancel" }),
    )
    await app.close()
  })

  it("does NOT update stages when no stage is currently running (awaiting_approval pipeline)", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_AWAITING}/cancel`,
    })
    expect(res.statusCode).toBe(200)

    // Pipeline flipped.
    expect(testPipelines.get(PIPELINE_AWAITING)!.status).toBe("cancelled")
    // Stage stays at awaiting_approval (the stage was already paused, not
    // running — there's nothing in-flight to cancel).
    expect(testStages.get(PIPELINE_AWAITING)![0]!.status).toBe("awaiting_approval")

    // No per-stage event fired (only the pipeline-level one).
    const stageEvents = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
      .map((c) => c[0])
      .filter((e: { type: string }) => e.type === "stage:status")
    expect(stageEvents).toHaveLength(0)
    await app.close()
  })

  it("returns 409 already_terminal if pipeline already cancelled/completed/failed", async () => {
    testPipelines.get(PIPELINE_ID)!.status = "cancelled"
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/cancel`,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("already_terminal")
    expect(refundPipelineCredits).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 404 when the pipeline does not belong to the caller", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_OTHER_USER}/cancel`,
    })
    expect(res.statusCode).toBe(404)
    // Pipeline status unchanged.
    expect(testPipelines.get(PIPELINE_OTHER_USER)!.status).toBe("running")
    await app.close()
  })
})
