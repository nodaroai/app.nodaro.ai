/**
 * Phase 1D.2c-b-ii §9 (J1) — route tests for shot-level video-critic recovery.
 *
 * Closes the documented gap from PR #2675 (and the H1 placeholder buttons in
 * scene-configs.tsx): individual shots inside Stage 7's `scene_node_data.shots`
 * can be terminally marked `video_critic_failed=true` by the critic retry
 * loop. The general approve/reject routes don't operate on per-shot data, so
 * two narrow-scoped routes let the user recover in Manual / Guided mode:
 *
 *   POST /v1/pipelines/:id/shots/:scene_id/:shot_id/skip-video-critic-failure
 *   POST /v1/pipelines/:id/shots/:scene_id/:shot_id/retry-video-generation
 *
 * Both gate on the SAME state: scene_entity.scene_node_data.shots[N] exists
 * AND that shot's `video_critic_failed === true`. Any other state returns
 * 409 `shot_not_video_critic_failed`. Skip flips the flag to false but
 * keeps the findings (audit trail). Retry strips every `video_critic_*`
 * key AND re-enqueues the orchestrator so processShot reruns.
 *
 * Mirrors `pipelines-image-critic-recovery.test.ts`, but the state lives
 * inside `pipeline_entities.metadata.scene_node_data.shots`, not directly
 * on the entity row — so the mock supports a full metadata-merge update.
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
// In-memory supabase mock — minimal but enough to exercise the route's
// full path: pipeline ownership SELECT, scene entity SELECT, metadata UPDATE.
// ---------------------------------------------------------------------------

const PIPELINE_ID = "00000000-0000-0000-0000-000000000111"
const SCENE_ID = "00000000-0000-0000-0000-0000000000s1"
const SHOT_ID = "shot_01"
const TEST_USER_ID = "user-1"
const OTHER_USER_ID = "user-2"

interface MockSceneEntity {
  id: string
  pipeline_id: string
  entity_type: string
  entity_key: string
  status: string
  metadata: Record<string, unknown>
}

interface MockState {
  pipelines: Map<string, { id: string; user_id: string; status?: string }>
  pipelineEntities: Map<string, MockSceneEntity>
}

const _state: MockState = {
  pipelines: new Map(),
  pipelineEntities: new Map(),
}

function seedDefault() {
  _state.pipelines.clear()
  _state.pipelineEntities.clear()
  _state.pipelines.set(PIPELINE_ID, {
    id: PIPELINE_ID,
    user_id: TEST_USER_ID,
    status: "awaiting_approval",
  })
}

function seedSceneWithFailedShot(overrides: {
  shotPatch?: Record<string, unknown>
  extraShots?: Array<Record<string, unknown>>
  sceneMetadataExtra?: Record<string, unknown>
} = {}) {
  const failedShot = {
    shot_id: SHOT_ID,
    action: "Hero walks toward camera",
    duration_seconds: 3,
    video_critic_failed: true,
    video_critic_score: 3,
    video_critic_continuity_score: 4,
    video_critic_identified_action: "Hero walks toward camera",
    video_critic_retry_count: 2,
    video_critic_last_attempted_url: "https://r2/shot_01-failed.mp4",
    video_critic_findings: [
      {
        severity: "blocking",
        category: "motion_glitch",
        description: "Hand snaps between frames",
        suggested_fix: "Re-render with steadier motion prompt",
      },
    ],
    ...overrides.shotPatch,
  }
  const shots = [failedShot, ...(overrides.extraShots ?? [])]
  _state.pipelineEntities.set(SCENE_ID, {
    id: SCENE_ID,
    pipeline_id: PIPELINE_ID,
    entity_type: "scene",
    entity_key: "scene_01",
    status: "approved",
    metadata: {
      ...(overrides.sceneMetadataExtra ?? {}),
      scene_node_data: { shots },
    },
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
              eq: (col3: string, val3: string) => ({
                maybeSingle: async () => {
                  // Route's load: .eq("id", scene_id).eq("pipeline_id", pipelineId).eq("entity_type", "scene")
                  const row = _state.pipelineEntities.get(val1)
                  if (!row) return { data: null, error: null }
                  if (col1 === "id" && col2 === "pipeline_id" && col3 === "entity_type") {
                    if (row.pipeline_id !== val2) return { data: null, error: null }
                    if (row.entity_type !== val3) return { data: null, error: null }
                    return { data: row, error: null }
                  }
                  return { data: row, error: null }
                },
              }),
              maybeSingle: async () => {
                const row = _state.pipelineEntities.get(val1)
                if (!row) return { data: null, error: null }
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
          const filters: Array<{ col: string; val: string }> = []
          const builder = {
            eq(col: string, val: string) {
              filters.push({ col, val })
              return builder
            },
            // Terminal: `await supabase.update(...).eq(...).eq(...)` resolves
            // without a final .select() in this route — Supabase returns
            // `{ error }` only on failure. Honor both chain shapes.
            then(onFulfilled: (v: { data: unknown; error: { message: string } | null }) => unknown) {
              const idFilter = filters.find((f) => f.col === "id")
              if (!idFilter) {
                return onFulfilled({ data: null, error: { message: "no id filter" } })
              }
              const row = _state.pipelineEntities.get(idFilter.val)
              if (!row) {
                return onFulfilled({ data: null, error: null })
              }
              for (const f of filters) {
                if ((row as unknown as Record<string, unknown>)[f.col] !== f.val) {
                  return onFulfilled({ data: null, error: null })
                }
              }
              const merged = { ...row, ...patch } as MockSceneEntity
              _state.pipelineEntities.set(idFilter.val, merged)
              return onFulfilled({ data: merged, error: null })
            },
          }
          return builder
        },
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

beforeEach(() => {
  vi.clearAllMocks()
  seedDefault()
})

// ---------------------------------------------------------------------------
// skip-video-critic-failure
// ---------------------------------------------------------------------------

describe("POST /v1/pipelines/:id/shots/:scene_id/:shot_id/skip-video-critic-failure", () => {
  it("404 not_found when pipeline isn't owned by caller", async () => {
    seedSceneWithFailedShot()
    const app = await makeApp(OTHER_USER_ID)
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/skip-video-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    await app.close()
  })

  it("403 edition_required when not cloud edition", async () => {
    const config = await import("../../lib/config.js")
    ;(config.hasCredits as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/skip-video-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("404 scene_not_found when the scene entity doesn't exist", async () => {
    // No scene seeded.
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/skip-video-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("scene_not_found")
    await app.close()
  })

  it("404 shot_not_found when shot_id isn't in scene_node_data.shots", async () => {
    seedSceneWithFailedShot()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/nonexistent_shot/skip-video-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("shot_not_found")
    await app.close()
  })

  it("409 shot_not_video_critic_failed when video_critic_failed=false", async () => {
    seedSceneWithFailedShot({ shotPatch: { video_critic_failed: false } })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/skip-video-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("shot_not_video_critic_failed")
    await app.close()
  })

  it("409 shot_not_video_critic_failed when video_critic_failed is undefined", async () => {
    seedSceneWithFailedShot({ shotPatch: { video_critic_failed: undefined } })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/skip-video-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("shot_not_video_critic_failed")
    await app.close()
  })

  it("200 + clears video_critic_failed + preserves findings + emits SSE", async () => {
    seedSceneWithFailedShot({
      extraShots: [{ shot_id: "shot_02", action: "Other shot", duration_seconds: 4 }],
    })
    const { pipelineEvents } = await import("../../ee/pipelines/events.js")
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/skip-video-critic-failure`,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    // State assertions: flag flipped, findings preserved (audit trail).
    const row = _state.pipelineEntities.get(SCENE_ID)
    const sceneData = (row?.metadata as Record<string, unknown>).scene_node_data as {
      shots: Array<Record<string, unknown>>
    }
    expect(sceneData.shots).toHaveLength(2)
    const targetShot = sceneData.shots[0]!
    expect(targetShot.video_critic_failed).toBe(false)
    expect(targetShot.video_critic_findings).toBeDefined()
    expect(targetShot.video_critic_score).toBe(3)
    expect(targetShot.video_critic_retry_count).toBe(2)
    // Sibling shot untouched.
    expect(sceneData.shots[1]!.shot_id).toBe("shot_02")
    expect(sceneData.shots[1]!.video_critic_failed).toBeUndefined()
    // SSE emitted: shot:status with `approved` (mirrors the critic's own pass event).
    expect(pipelineEvents.publish).toHaveBeenCalledWith({
      type: "shot:status",
      pipelineId: PIPELINE_ID,
      sceneId: SCENE_ID,
      shotId: SHOT_ID,
      status: "approved",
    })
    await app.close()
  })
})

// ---------------------------------------------------------------------------
// retry-video-generation
// ---------------------------------------------------------------------------

describe("POST /v1/pipelines/:id/shots/:scene_id/:shot_id/retry-video-generation", () => {
  it("404 not_found when pipeline isn't owned by caller", async () => {
    seedSceneWithFailedShot()
    const app = await makeApp(OTHER_USER_ID)
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/retry-video-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    await app.close()
  })

  it("403 edition_required when not cloud edition", async () => {
    const config = await import("../../lib/config.js")
    ;(config.hasCredits as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/retry-video-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it("404 scene_not_found when the scene entity doesn't exist", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/retry-video-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("scene_not_found")
    await app.close()
  })

  it("404 shot_not_found when shot_id isn't in scene_node_data.shots", async () => {
    seedSceneWithFailedShot()
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/nonexistent_shot/retry-video-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("shot_not_found")
    await app.close()
  })

  it("409 shot_not_video_critic_failed when video_critic_failed=false", async () => {
    seedSceneWithFailedShot({ shotPatch: { video_critic_failed: false } })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/retry-video-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("shot_not_video_critic_failed")
    await app.close()
  })

  it("200 + strips all video_critic_* fields + re-enqueues + emits SSE + preserves other shot fields", async () => {
    seedSceneWithFailedShot({
      shotPatch: {
        // A non-critic field that must survive the strip.
        camera: { shot_type: "medium" },
        motion_prompt: "steady walk",
      },
      extraShots: [{ shot_id: "shot_02", action: "Other shot", duration_seconds: 4 }],
      sceneMetadataExtra: { generated_keyframes: ["kf-1"] },
    })
    const { enqueuePipelineRun } = await import("../../ee/pipelines/queue.js")
    const { pipelineEvents } = await import("../../ee/pipelines/events.js")
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE_ID}/shots/${SCENE_ID}/${SHOT_ID}/retry-video-generation`,
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
    // All video_critic_* stripped.
    const row = _state.pipelineEntities.get(SCENE_ID)
    const sceneData = (row?.metadata as Record<string, unknown>).scene_node_data as {
      shots: Array<Record<string, unknown>>
    }
    const targetShot = sceneData.shots[0]!
    for (const key of Object.keys(targetShot)) {
      expect(key.startsWith("video_critic_")).toBe(false)
    }
    // Non-critic shot fields preserved.
    expect(targetShot.shot_id).toBe(SHOT_ID)
    expect(targetShot.action).toBe("Hero walks toward camera")
    expect(targetShot.camera).toEqual({ shot_type: "medium" })
    expect(targetShot.motion_prompt).toBe("steady walk")
    // Other scene metadata preserved.
    expect((row?.metadata as Record<string, unknown>).generated_keyframes).toEqual(["kf-1"])
    // Sibling shot untouched.
    expect(sceneData.shots[1]!.shot_id).toBe("shot_02")
    // Orchestrator re-enqueued so Stage 7 reruns processShot.
    expect(enqueuePipelineRun).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: PIPELINE_ID,
        userId: TEST_USER_ID,
        reason: "stage_advance",
      }),
    )
    // SSE emitted — clients refetch to observe the reset state.
    expect(pipelineEvents.publish).toHaveBeenCalledWith({
      type: "shot:status",
      pipelineId: PIPELINE_ID,
      sceneId: SCENE_ID,
      shotId: SHOT_ID,
      status: "approved",
    })
    await app.close()
  })
})
