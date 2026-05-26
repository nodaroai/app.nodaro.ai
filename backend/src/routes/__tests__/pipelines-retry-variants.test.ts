import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// ---------------------------------------------------------------------------
// Mocks — covers POST /v1/pipelines/:id/entities/:entity_id/retry-variants
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

interface FakeEntity {
  id: string
  pipeline_id: string
  entity_type: string
  entity_key: string
  status: string
  metadata: Record<string, unknown>
}
interface FakeVariant {
  entity_id: string
  variant_key: string
  status: string
}

vi.mock("../../lib/supabase.js", () => {
  const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
  const PIPELINE_OTHER = "00000000-0000-0000-0000-000000000222"
  const ENTITY_FAILED_ID = "00000000-0000-0000-0000-000000000a01"
  const ENTITY_NOT_APPROVED_ID = "00000000-0000-0000-0000-000000000a02"
  const ENTITY_LOCATION_ID = "00000000-0000-0000-0000-000000000a03"
  const USER_ID = "user-1"

  const pipelines = new Map<string, { id: string; user_id: string }>()
  pipelines.set(PIPELINE_ID, { id: PIPELINE_ID, user_id: USER_ID })
  pipelines.set(PIPELINE_OTHER, { id: PIPELINE_OTHER, user_id: "other-user" })

  const entities = new Map<string, FakeEntity>()
  entities.set(ENTITY_FAILED_ID, {
    id: ENTITY_FAILED_ID,
    pipeline_id: PIPELINE_ID,
    entity_type: "character",
    entity_key: "hero",
    status: "approved",
    metadata: {
      name: "Hero",
      variants_failed_count: 3,
      variants_total_count: 5,
      variant_generation_error: "assetUrlForId timed out",
      variant_generation_error_at: "2026-05-26T11:00:00Z",
      // Should survive the retry — only the failure markers strip.
      voice_match_meta: { voice_id: "ABC" },
    },
  })
  entities.set(ENTITY_NOT_APPROVED_ID, {
    id: ENTITY_NOT_APPROVED_ID,
    pipeline_id: PIPELINE_ID,
    entity_type: "character",
    entity_key: "sidekick",
    status: "awaiting_approval",
    metadata: {},
  })
  entities.set(ENTITY_LOCATION_ID, {
    id: ENTITY_LOCATION_ID,
    pipeline_id: PIPELINE_ID,
    entity_type: "location",
    entity_key: "desert",
    status: "approved",
    metadata: {},
  })

  const variants: FakeVariant[] = [
    { entity_id: ENTITY_FAILED_ID, variant_key: "angle_profile", status: "approved" },
    { entity_id: ENTITY_FAILED_ID, variant_key: "angle_three_quarter", status: "failed" },
    { entity_id: ENTITY_FAILED_ID, variant_key: "expression_neutral", status: "failed" },
  ]

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
    if (table === "pipeline_entities") {
      return {
        select: () => ({
          eq: (_c1: string, v1: string) => ({
            eq: (_c2: string, _v2: string) => ({
              maybeSingle: async () => ({
                data: entities.get(v1) ?? null,
                error: null,
              }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, val: string) => {
            const e = entities.get(val)
            if (e) Object.assign(e, patch)
            return { data: null, error: null }
          },
        }),
      }
    }
    if (table === "pipeline_entity_variants") {
      return {
        delete: () => {
          const filters: Record<string, unknown> = {}
          const chain = {
            eq: (col: string, val: unknown) => {
              filters[col] = val
              return chain
            },
            then: (resolve: (v: { data: null; error: null }) => unknown) => {
              const entityId = filters.entity_id as string
              const statusFilter = filters.status as string
              for (let i = variants.length - 1; i >= 0; i--) {
                if (
                  variants[i]!.entity_id === entityId &&
                  variants[i]!.status === statusFilter
                ) {
                  variants.splice(i, 1)
                }
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
    __test: { pipelines, entities, variants },
  }
})

import { pipelinesRoutes } from "../pipelines.js"
import { enqueuePipelineRun } from "../../ee/pipelines/queue.js"
import * as supabaseMod from "../../lib/supabase.js"

const TEST_USER_ID = "user-1"
const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const PIPELINE_OTHER = "00000000-0000-0000-0000-000000000222"
const ENTITY_FAILED_ID = "00000000-0000-0000-0000-000000000a01"
const ENTITY_NOT_APPROVED_ID = "00000000-0000-0000-0000-000000000a02"
const ENTITY_LOCATION_ID = "00000000-0000-0000-0000-000000000a03"

const testState = (supabaseMod as unknown as {
  __test: {
    entities: Map<string, FakeEntity>
    variants: FakeVariant[]
  }
}).__test

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
  // Restore the failed entity's metadata + the failed variant rows so each
  // test starts from the same baseline.
  testState.entities.get(ENTITY_FAILED_ID)!.metadata = {
    name: "Hero",
    variants_failed_count: 3,
    variants_total_count: 5,
    variant_generation_error: "assetUrlForId timed out",
    variant_generation_error_at: "2026-05-26T11:00:00Z",
    voice_match_meta: { voice_id: "ABC" },
  }
  testState.entities.get(ENTITY_FAILED_ID)!.status = "approved"
  testState.variants.length = 0
  testState.variants.push(
    { entity_id: ENTITY_FAILED_ID, variant_key: "angle_profile", status: "approved" },
    { entity_id: ENTITY_FAILED_ID, variant_key: "angle_three_quarter", status: "failed" },
    { entity_id: ENTITY_FAILED_ID, variant_key: "expression_neutral", status: "failed" },
  )
})

describe("POST /v1/pipelines/:id/entities/:entity_id/retry-variants", () => {
  it("clears failure markers, deletes failed variant rows, re-enqueues", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_FAILED_ID}/retry-variants`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })

    // Failure markers stripped — voice_match_meta survives.
    const meta = testState.entities.get(ENTITY_FAILED_ID)!.metadata
    expect(meta.variants_failed_count).toBeUndefined()
    expect(meta.variants_total_count).toBeUndefined()
    expect(meta.variant_generation_error).toBeUndefined()
    expect(meta.variant_generation_error_at).toBeUndefined()
    expect(meta.name).toBe("Hero")
    expect(meta.voice_match_meta).toEqual({ voice_id: "ABC" })

    // Failed variants are deleted; the approved one stays so we don't burn
    // credits regenerating a successful variant.
    expect(testState.variants).toHaveLength(1)
    expect(testState.variants[0]!.variant_key).toBe("angle_profile")
    expect(testState.variants[0]!.status).toBe("approved")

    // Orchestrator re-enqueued.
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: PIPELINE_ID,
      userId: TEST_USER_ID,
      reason: "stage_advance",
    })
    await app.close()
  })

  it("recovers an entity with no failure markers (pre-fix stalled pipeline)", async () => {
    // Pipeline 65c57374 from 2026-05-26 had this exact shape: entity at
    // status='approved' with no variants_*_* markers and no variant rows.
    // The route deliberately doesn't gate on a specific marker so it can
    // unblock these.
    testState.entities.get(ENTITY_FAILED_ID)!.metadata = { name: "Hero" }
    testState.variants.length = 0

    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_FAILED_ID}/retry-variants`,
    })
    expect(res.statusCode).toBe(200)
    expect(enqueuePipelineRun).toHaveBeenCalled()
    await app.close()
  })

  it("returns 404 when the pipeline doesn't belong to the caller", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_OTHER}/entities/${ENTITY_FAILED_ID}/retry-variants`,
    })
    expect(res.statusCode).toBe(404)
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 409 entity_not_character for non-character entities", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_LOCATION_ID}/retry-variants`,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("entity_not_character")
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 409 entity_not_approved when status is not 'approved'", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_NOT_APPROVED_ID}/retry-variants`,
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("entity_not_approved")
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    await app.close()
  })
})
