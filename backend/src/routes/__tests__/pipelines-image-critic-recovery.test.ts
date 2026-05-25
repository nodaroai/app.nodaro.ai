/**
 * Phase 1D.2c-a §7 (E1) follow-up — route tests for image-critic recovery.
 *
 * Closes the documented gap from PR #2656: entities terminally failed by the
 * Stage 2/4 image-critic chain (status='failed', metadata.last_error='image_critic_unresolvable')
 * can't go through the general approve/reject routes because those CAS-gate on
 * status='awaiting_approval'. Two narrow-scoped recovery routes:
 *
 *   POST /v1/pipelines/:id/entities/:entityId/force-approve-image-critic-failure
 *   POST /v1/pipelines/:id/entities/:entityId/retry-image-generation
 *
 * Both gate on `entity.status='failed' AND metadata.last_error='image_critic_unresolvable'`
 * and return 409 `entity_not_image_critic_failed` otherwise. They DO NOT
 * delegate to entity-approval.ts — they manipulate the row directly, so a
 * full in-memory mock of the relevant tables is needed.
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
  approveStage: vi.fn(async () => ({ ok: true })),
  approveScriptStage: vi.fn(async () => ({ ok: true })),
  rejectScriptStage: vi.fn(async () => ({ ok: true })),
}))

vi.mock("../../ee/pipelines/entity-approval.js", () => ({
  approveEntity: vi.fn(async () => ({ ok: true })),
  rejectEntity: vi.fn(async () => ({ ok: true })),
  // Recovery routes call approveEntityCore/resetEntityForRetry directly for
  // the post-CAS side effects (entity:status SSE + canvas node transition +
  // materialize). The route happily delegates to the mocks; assertions run
  // against either the helper invocation or the underlying primitives.
  approveEntityCore: vi.fn(async () => undefined),
  resetEntityForRetry: vi.fn(async () => undefined),
}))

vi.mock("../../ee/pipelines/depends-on.js", () => ({
  transitionEntityNodeAndEmit: vi.fn(async () => undefined),
}))

vi.mock("../../ee/pipelines/events.js", () => ({
  pipelineEvents: {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  },
}))

// ---------------------------------------------------------------------------
// In-memory supabase mock with full pipeline_entities + assets state.
//
// The mock implements a narrow subset of the PostgREST chain shapes the route
// uses. Each `update()` chain captures the patch and returns it via the final
// .select(), which mirrors how Supabase JS returns updated rows.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const ENTITY_ID = "00000000-0000-0000-0000-0000000000e1"
const ASSET_ID = "00000000-0000-0000-0000-000000000a01"
const ASSET_ID_OLD = "00000000-0000-0000-0000-000000000a00"
const TEST_USER_ID = "user-1"
const OTHER_USER_ID = "user-2"

interface MockPipelineEntity {
  id: string
  pipeline_id: string
  entity_type: string
  entity_key: string
  status: string
  main_asset_id: string | null
  metadata: Record<string, unknown>
}

interface MockAsset {
  id: string
  pipeline_entity_id: string
  r2_url: string
  created_at: string
}

interface MockState {
  pipelines: Map<string, { id: string; user_id: string; status?: string }>
  pipelineEntities: Map<string, MockPipelineEntity>
  assets: MockAsset[]
}

const _state: MockState = {
  pipelines: new Map(),
  pipelineEntities: new Map(),
  assets: [],
}

function seedDefault() {
  _state.pipelines.clear()
  _state.pipelineEntities.clear()
  _state.assets = []
  _state.pipelines.set(PIPELINE_ID, {
    id: PIPELINE_ID,
    user_id: TEST_USER_ID,
    status: "running",
  })
}

vi.mock("../../lib/supabase.js", () => {
  function from(table: string) {
    if (table === "pipelines") {
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: PIPELINE_ID }, error: null }),
          }),
        }),
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => ({
              data: _state.pipelines.get(val) ?? null,
              error: null,
            }),
            single: async () => ({
              data: _state.pipelines.get(val) ?? null,
              error: null,
            }),
          }),
        }),
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
    if (table === "pipeline_entities") {
      return {
        select: (_cols: string) => ({
          eq: (col1: string, val1: string) => ({
            eq: (col2: string, val2: string) => ({
              maybeSingle: async () => {
                const row = _state.pipelineEntities.get(val1)
                if (!row) return { data: null, error: null }
                // The route's load query does .eq("id", entityId).eq("pipeline_id", pipelineId).
                // Honor both equality filters so we can simulate "entity exists but in different pipeline".
                if (col1 === "id" && col2 === "pipeline_id") {
                  return row.pipeline_id === val2
                    ? { data: row, error: null }
                    : { data: null, error: null }
                }
                return { data: row, error: null }
              },
            }),
            maybeSingle: async () => ({
              data: _state.pipelineEntities.get(val1) ?? null,
              error: null,
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          // Chain: .update(patch).eq(col, val).eq(col, val).select(...) | .eq(col, val).select(...)
          // The CAS variant adds an additional .eq("status", ...) which the route uses to prevent
          // double-update races. We honor it by recording the last seen "status" filter and
          // refusing the update if the current row doesn't match.
          const filters: Array<{ col: string; val: string }> = []
          const builder = {
            eq(col: string, val: string) {
              filters.push({ col, val })
              return builder
            },
            select() {
              return {
                async maybeSingle() {
                  const idFilter = filters.find((f) => f.col === "id")
                  if (!idFilter) return { data: null, error: null }
                  const row = _state.pipelineEntities.get(idFilter.val)
                  if (!row) return { data: null, error: null }
                  // Honor all .eq filters against the current row state.
                  for (const f of filters) {
                    if ((row as unknown as Record<string, unknown>)[f.col] !== f.val) {
                      return { data: null, error: null }
                    }
                  }
                  const merged = { ...row, ...patch } as MockPipelineEntity
                  _state.pipelineEntities.set(idFilter.val, merged)
                  return { data: merged, error: null }
                },
                then(onFulfilled: (v: { data: unknown[]; error: null }) => unknown) {
                  // .select() without a terminator returns a thenable that resolves to data[].
                  const idFilter = filters.find((f) => f.col === "id")
                  if (!idFilter) return onFulfilled({ data: [], error: null })
                  const row = _state.pipelineEntities.get(idFilter.val)
                  if (!row) return onFulfilled({ data: [], error: null })
                  for (const f of filters) {
                    if ((row as unknown as Record<string, unknown>)[f.col] !== f.val) {
                      return onFulfilled({ data: [], error: null })
                    }
                  }
                  const merged = { ...row, ...patch } as MockPipelineEntity
                  _state.pipelineEntities.set(idFilter.val, merged)
                  return onFulfilled({ data: [merged], error: null })
                },
              }
            },
            // For the chain `update(patch).eq(...).eq(...)` without .select() the call returns a
            // thenable resolving to {data, error} — match Supabase semantics minimally.
            then(onFulfilled: (v: { data: unknown; error: null }) => unknown) {
              const idFilter = filters.find((f) => f.col === "id")
              if (!idFilter) return onFulfilled({ data: null, error: null })
              const row = _state.pipelineEntities.get(idFilter.val)
              if (!row) return onFulfilled({ data: null, error: null })
              for (const f of filters) {
                if ((row as unknown as Record<string, unknown>)[f.col] !== f.val) {
                  return onFulfilled({ data: null, error: null })
                }
              }
              const merged = { ...row, ...patch } as MockPipelineEntity
              _state.pipelineEntities.set(idFilter.val, merged)
              return onFulfilled({ data: merged, error: null })
            },
          }
          return builder
        },
      }
    }
    if (table === "assets") {
      return {
        select: (_cols: string) => ({
          eq: (col: string, val: string) => ({
            order: () => ({
              limit: () => ({
                maybeSingle: async () => {
                  // Filter by pipeline_entity_id, sort by created_at desc, return first.
                  if (col !== "pipeline_entity_id") return { data: null, error: null }
                  const rows = _state.assets
                    .filter((a) => a.pipeline_entity_id === val)
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                  return { data: rows[0] ?? null, error: null }
                },
              }),
            }),
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

async function makeApp(userId: string = TEST_USER_ID) {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = userId
    ;(req as unknown as { appAuthorization: unknown }).appAuthorization = undefined
  })
  await app.register(pipelinesRoutes)
  await app.ready()
  return app
}

function seedCriticFailedEntity(overrides: Partial<MockPipelineEntity> = {}) {
  _state.pipelineEntities.set(ENTITY_ID, {
    id: ENTITY_ID,
    pipeline_id: PIPELINE_ID,
    entity_type: "character",
    entity_key: "alice",
    status: "failed",
    main_asset_id: null,
    metadata: {
      name: "Alice",
      last_error: "image_critic_unresolvable",
      last_error_at: "2026-05-21T10:00:00.000Z",
      last_attempted_image_url: "https://r2/alice-failed.png",
      image_critic_retry_count: 3,
      critic_findings: [
        {
          severity: "blocking",
          category: "wrong_face",
          description: "Doesn't match the reference.",
          suggested_fix: "Lean into the jawline.",
        },
      ],
      voice_match: { voice_id: "v_123", matched_at: "2026-05-21T09:00:00.000Z" },
    },
    ...overrides,
  })
}

function seedAssetForEntity(
  entityId: string,
  assetId: string,
  r2Url: string,
  createdAt: string,
) {
  _state.assets.push({
    id: assetId,
    pipeline_entity_id: entityId,
    r2_url: r2Url,
    created_at: createdAt,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  seedDefault()
})

// ---------------------------------------------------------------------------
// force-approve-image-critic-failure
// ---------------------------------------------------------------------------

describe("POST /v1/pipelines/:id/entities/:entity_id/force-approve-image-critic-failure", () => {
  it("404 not_found when pipeline isn't owned by caller", async () => {
    seedCriticFailedEntity()
    seedAssetForEntity(ENTITY_ID, ASSET_ID, "https://r2/alice-failed.png", "2026-05-21T10:00:00Z")
    const app = await makeApp(OTHER_USER_ID)
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/force-approve-image-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    await app.close()
  })

  it("403 edition_required when not cloud edition", async () => {
    // makeApp's route registration calls `hasCredits()` multiple times for
    // edition-gated routes — using `mockReturnValueOnce` BEFORE makeApp lets
    // registration consume the single `false`, leaving the request's
    // gateEdition with the default `true`. Register first, then queue
    // `false` for the SOLE next call (which will be the route's gateEdition).
    const app = await makeApp()
    const config = await import("../../lib/config.js")
    ;(config.hasCredits as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/force-approve-image-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("409 entity_not_image_critic_failed when entity status is awaiting_approval", async () => {
    seedCriticFailedEntity({ status: "awaiting_approval" })
    seedAssetForEntity(ENTITY_ID, ASSET_ID, "https://r2/alice.png", "2026-05-21T10:00:00Z")
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/force-approve-image-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("entity_not_image_critic_failed")
    await app.close()
  })

  it("409 entity_not_image_critic_failed when failed but last_error is different", async () => {
    seedCriticFailedEntity({
      status: "failed",
      metadata: { name: "Alice", last_error: "provider_timeout" },
    })
    seedAssetForEntity(ENTITY_ID, ASSET_ID, "https://r2/alice.png", "2026-05-21T10:00:00Z")
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/force-approve-image-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("entity_not_image_critic_failed")
    await app.close()
  })

  it("409 no_asset_to_approve when no asset row exists for the entity", async () => {
    seedCriticFailedEntity()
    // intentionally no seedAssetForEntity
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/force-approve-image-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("no_asset_to_approve")
    await app.close()
  })

  it("200 + entity status='approved' + main_asset_id set + enqueues pipeline run + runs approveEntityCore", async () => {
    seedCriticFailedEntity()
    // Two assets — most recent should win.
    seedAssetForEntity(
      ENTITY_ID,
      ASSET_ID_OLD,
      "https://r2/alice-attempt-1.png",
      "2026-05-21T09:00:00Z",
    )
    seedAssetForEntity(
      ENTITY_ID,
      ASSET_ID,
      "https://r2/alice-failed.png",
      "2026-05-21T10:00:00Z",
    )
    const { enqueuePipelineRun } = await import("../../ee/pipelines/queue.js")
    const { approveEntityCore } = await import(
      "../../ee/pipelines/entity-approval.js"
    )
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/force-approve-image-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    // Side-effects on the entity row.
    const row = _state.pipelineEntities.get(ENTITY_ID)
    expect(row?.status).toBe("approved")
    expect(row?.main_asset_id).toBe(ASSET_ID)
    // Fix 1 — post-CAS side effects (SSE publish + canvas transition +
    // materialize) all run via approveEntityCore, NOT inline in the route.
    expect(approveEntityCore).toHaveBeenCalledWith(
      expect.anything(),
      PIPELINE_ID,
      expect.objectContaining({
        id: ENTITY_ID,
        entity_type: "character",
        entity_key: "alice",
      }),
    )
    // Pipeline run re-enqueued so the orchestrator advances (Stage 6 etc).
    expect(enqueuePipelineRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        userId: TEST_USER_ID,
        reason: "stage_advance",
      }),
    )
    await app.close()
  })

  it("Fix 2: prefers last_attempted_asset_id from metadata over latest-by-created_at", async () => {
    // Seed: metadata.last_attempted_asset_id points to ASSET_ID_OLD; assets
    // table separately has ASSET_ID created LATER. Route MUST adopt the
    // metadata value, not the latest one.
    seedCriticFailedEntity({
      metadata: {
        name: "Alice",
        last_error: "image_critic_unresolvable",
        last_attempted_image_url: "https://r2/alice-attempt-1.png",
        last_attempted_asset_id: ASSET_ID_OLD,
        image_critic_retry_count: 3,
        critic_findings: [],
      },
    })
    seedAssetForEntity(
      ENTITY_ID,
      ASSET_ID_OLD,
      "https://r2/alice-attempt-1.png",
      "2026-05-21T09:00:00Z",
    )
    seedAssetForEntity(
      ENTITY_ID,
      ASSET_ID,
      "https://r2/alice-later.png",
      "2026-05-21T10:00:00Z",
    )
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/force-approve-image-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    const row = _state.pipelineEntities.get(ENTITY_ID)
    expect(row?.main_asset_id).toBe(ASSET_ID_OLD)
    await app.close()
  })
})

// ---------------------------------------------------------------------------
// retry-image-generation
// ---------------------------------------------------------------------------

describe("POST /v1/pipelines/:id/entities/:entity_id/retry-image-generation", () => {
  it("404 not_found when pipeline isn't owned by caller", async () => {
    seedCriticFailedEntity()
    const app = await makeApp(OTHER_USER_ID)
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/retry-image-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    await app.close()
  })

  it("403 edition_required when not cloud edition", async () => {
    // See note on the previous force-approve test — register first, then
    // queue the `false` so only the route's gateEdition consumes it.
    const app = await makeApp()
    const config = await import("../../lib/config.js")
    ;(config.hasCredits as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/retry-image-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("409 entity_not_image_critic_failed when status is approved", async () => {
    seedCriticFailedEntity({ status: "approved" })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/retry-image-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("entity_not_image_critic_failed")
    await app.close()
  })

  it("409 when failed but last_error is not image_critic_unresolvable", async () => {
    seedCriticFailedEntity({
      status: "failed",
      metadata: { name: "Alice", last_error: "provider_timeout" },
    })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/retry-image-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("entity_not_image_critic_failed")
    await app.close()
  })

  it("200 + entity status='pending' + image-critic metadata cleared + voice_match preserved + enqueue called + resetEntityForRetry invoked", async () => {
    seedCriticFailedEntity({
      metadata: {
        name: "Alice",
        last_error: "image_critic_unresolvable",
        last_error_at: "2026-05-21T10:00:00.000Z",
        last_attempted_image_url: "https://r2/alice-failed.png",
        last_attempted_asset_id: ASSET_ID,
        image_critic_retry_count: 3,
        critic_findings: [
          {
            severity: "blocking",
            category: "wrong_face",
            description: "Doesn't match the reference.",
            suggested_fix: "Lean into the jawline.",
          },
        ],
        voice_match: { voice_id: "v_123", matched_at: "2026-05-21T09:00:00.000Z" },
      },
    })
    const { enqueuePipelineRun } = await import("../../ee/pipelines/queue.js")
    const { resetEntityForRetry } = await import(
      "../../ee/pipelines/entity-approval.js"
    )
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/entities/${ENTITY_ID}/retry-image-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    const row = _state.pipelineEntities.get(ENTITY_ID)
    expect(row?.status).toBe("pending")
    // Image-critic-only metadata cleared — every IMAGE_CRITIC_METADATA_KEYS
    // entry must be gone (Fix 5's shared constant is what the clearer uses).
    expect(row?.metadata.last_error).toBeUndefined()
    expect(row?.metadata.last_error_at).toBeUndefined()
    expect(row?.metadata.critic_findings).toBeUndefined()
    expect(row?.metadata.last_attempted_image_url).toBeUndefined()
    expect(row?.metadata.last_attempted_asset_id).toBeUndefined()
    expect(row?.metadata.image_critic_retry_count).toBeUndefined()
    // Other metadata preserved (voice_match, name).
    expect(row?.metadata.name).toBe("Alice")
    expect(row?.metadata.voice_match).toEqual({
      voice_id: "v_123",
      matched_at: "2026-05-21T09:00:00.000Z",
    })
    // Fix 1 — post-CAS side effects (entity:status SSE publish with
    // status="pending" + canvas node transition to pipeline_owned_running)
    // all run via resetEntityForRetry, NOT inline in the route. Mirrors
    // the force-approve route's delegation to approveEntityCore.
    expect(resetEntityForRetry).toHaveBeenCalledWith(
      expect.anything(),
      PIPELINE_ID,
      expect.objectContaining({
        id: ENTITY_ID,
        entity_type: "character",
        entity_key: "alice",
      }),
    )
    expect(enqueuePipelineRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        userId: TEST_USER_ID,
        reason: "stage_advance",
      }),
    )
    await app.close()
  })
})
