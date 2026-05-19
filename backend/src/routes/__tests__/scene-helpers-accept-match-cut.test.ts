import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// ---------------------------------------------------------------------------
// Phase 1D.1 — Tests for the accept_match_cut_break route.
//
// Uses a separate test file with its own supabase mock to avoid contaminating
// the existing scene-helpers.test.ts mock which supports different DB chains.
// ---------------------------------------------------------------------------

vi.mock("../../lib/config.js", () => ({
  hasCredits: vi.fn(() => true),
  hasAdmin: vi.fn(() => true),
  isCommunity: vi.fn(() => false),
}))

vi.mock("../../ee/pipelines/scene-helper-credits.js", () => ({
  reserveHelperCredits: vi.fn(async () => ({ ok: true, usageLogId: "log-1" })),
  refundHelperCredits: vi.fn(async () => undefined),
}))

// All existing helper modules — mocked to return stubs so route registration
// does not fail but these helpers are never called in these tests.
vi.mock("../../ee/pipelines/llms/helpers/audit-prompt.js", () => ({ runAuditPrompt: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/improve-prompt.js", () => ({ runImprovePrompt: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/generate-motion.js", () => ({ runGenerateMotion: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/optimize-for-model.js", () => ({ runOptimizeForModel: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/add-broll.js", () => ({ runAddBRoll: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/bridge-to-next-scene.js", () => ({ runBridgeToNextScene: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/anchor-scene-style.js", () => ({ runAnchorSceneStyle: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/audit-images.js", () => ({ runAuditImages: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/fix-continuity.js", () => ({ runFixContinuity: vi.fn() }))
vi.mock("../../ee/pipelines/llms/helpers/validate-match-cut.js", () => ({ runValidateMatchCut: vi.fn() }))

vi.mock("../../ee/pipelines/queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

// ---------------------------------------------------------------------------
// Flexible in-memory supabase mock.
//
// `amcbState` is the mutable fixture store. Each test seeds it via
// `seedAmcbState(...)` before running an HTTP call. This avoids module-level
// vi.mock factories needing top-level state — the factory captures a reference
// to `amcbState` which tests mutate between calls.
// ---------------------------------------------------------------------------

interface AmcbShot {
  shot_id: string
  shot_intent: { is_match_cut: boolean }
  accepted_match_cut_break?: boolean
  [key: string]: unknown
}

interface AmcbSceneNodeData {
  shots: AmcbShot[]
  [key: string]: unknown
}

interface AmcbState {
  pipeline: { id: string; user_id: string } | null
  scene: {
    id: string
    metadata: { scene_node_data: AmcbSceneNodeData }
  } | null
  sceneUpdates: Array<Record<string, unknown>>
  stage: {
    id: string
    pipeline_id: string
    stage_name: string
    status: string
    output: Record<string, unknown>
  } | null
  stageUpdates: Array<Record<string, unknown>>
}

const amcbState: AmcbState = {
  pipeline: null,
  scene: null,
  sceneUpdates: [],
  stage: null,
  stageUpdates: [],
}

vi.mock("../../lib/supabase.js", () => {
  function from(table: string) {
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: (_col: string, _val: string) => ({
            maybeSingle: async () => ({ data: amcbState.pipeline, error: null }),
          }),
        }),
      }
    }
    if (table === "pipeline_entities") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: amcbState.scene, error: null }),
              }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            amcbState.sceneUpdates.push(patch)
            return { data: null, error: null }
          },
        }),
      }
    }
    if (table === "pipeline_stages") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: amcbState.stage, error: null }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: async () => {
            amcbState.stageUpdates.push(patch)
            return { data: null, error: null }
          },
        }),
      }
    }
    if (table === "pipeline_stage_attempts") {
      return {
        insert: async () => ({ error: null }),
      }
    }
    throw new Error(`Unmocked table in accept-match-cut tests: ${table}`)
  }

  return { supabase: { from } }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { sceneHelpersRoutes } from "../scene-helpers.js"
import { enqueuePipelineRun } from "../../ee/pipelines/queue.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "u1"

async function makeApp() {
  const app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = TEST_USER_ID
    ;(req as unknown as { appAuthorization: unknown }).appAuthorization = undefined
  })
  await app.register(sceneHelpersRoutes)
  await app.ready()
  return app
}

function seedMatchCutScene(
  shotId: string,
  opts: { isMatchCut: boolean; alreadyAccepted?: boolean },
): void {
  amcbState.pipeline = { id: "p1", user_id: TEST_USER_ID }
  amcbState.scene = {
    id: "scene-1",
    metadata: {
      scene_node_data: {
        scene_index: 1,
        description: "x",
        shots: [
          {
            shot_id: shotId,
            shot_intent: { is_match_cut: opts.isMatchCut },
            ...(opts.alreadyAccepted ? { accepted_match_cut_break: true } : {}),
          },
        ],
      },
    },
  }
}

function seedStage(pendingBreaks: string[], currentSubGate?: string): void {
  amcbState.stage = {
    id: "stage-6",
    pipeline_id: "p1",
    stage_name: "scene_images",
    status: "awaiting_approval",
    output: {
      match_cut_break_pending: pendingBreaks,
      ...(currentSubGate ? { current_sub_gate: currentSubGate } : {}),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  amcbState.pipeline = null
  amcbState.scene = null
  amcbState.sceneUpdates = []
  amcbState.stage = null
  amcbState.stageUpdates = []
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/pipelines/:id/entities/:sceneId/helpers/accept_match_cut_break", () => {
  it("D1-1: flips accepted_match_cut_break on the target shot and returns ok", async () => {
    seedMatchCutScene("shot_01", { isMatchCut: true })
    seedStage(["shot_01"], "match_cut_break_pending")

    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/accept_match_cut_break",
      payload: { shotId: "shot_01" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true })

    // Scene entity was updated with accepted_match_cut_break=true on the shot.
    expect(amcbState.sceneUpdates).toHaveLength(1)
    const updatedMetadata = amcbState.sceneUpdates[0]!.metadata as {
      scene_node_data: { shots: Array<{ accepted_match_cut_break?: boolean }> }
    }
    expect(updatedMetadata.scene_node_data.shots[0]?.accepted_match_cut_break).toBe(true)
    await app.close()
  })

  it("D1-2: clears sub-gate and re-enqueues when last pending break is accepted", async () => {
    seedMatchCutScene("shot_01", { isMatchCut: true })
    seedStage(["shot_01"], "match_cut_break_pending")

    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/accept_match_cut_break",
      payload: { shotId: "shot_01" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().pendingRemaining).toBe(0)

    // Stage output: current_sub_gate cleared, status set to "running".
    expect(amcbState.stageUpdates).toHaveLength(1)
    const stageUpdate = amcbState.stageUpdates[0]!
    expect(stageUpdate.status).toBe("running")
    const output = stageUpdate.output as Record<string, unknown>
    expect(output.current_sub_gate).toBeUndefined()
    expect(output.match_cut_break_pending).toEqual([])

    // Pipeline was re-enqueued.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: "p1", reason: "stage_advance" }),
    )
    await app.close()
  })

  it("D1-3: leaves sub-gate set when other breaks are still pending", async () => {
    seedMatchCutScene("shot_01", { isMatchCut: true })
    // Two pending breaks: shot_01 + shot_03. We accept shot_01 only.
    seedStage(["shot_01", "shot_03"], "match_cut_break_pending")

    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/accept_match_cut_break",
      payload: { shotId: "shot_01" },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().pendingRemaining).toBe(1)

    // Stage output still has current_sub_gate + remaining break.
    expect(amcbState.stageUpdates).toHaveLength(1)
    const stageUpdate = amcbState.stageUpdates[0]!
    expect(stageUpdate.status).toBeUndefined() // no status update
    const output = stageUpdate.output as Record<string, unknown>
    expect(output.current_sub_gate).toBe("match_cut_break_pending")
    expect(output.match_cut_break_pending).toEqual(["shot_03"])

    // Pipeline was NOT re-enqueued.
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    await app.close()
  })

  it("D1-4: returns 400 not_a_match_cut when target shot has is_match_cut=false", async () => {
    seedMatchCutScene("shot_01", { isMatchCut: false })
    seedStage([], undefined)

    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/accept_match_cut_break",
      payload: { shotId: "shot_01" },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("not_a_match_cut")

    // No DB updates should have happened.
    expect(amcbState.sceneUpdates).toHaveLength(0)
    expect(amcbState.stageUpdates).toHaveLength(0)
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    await app.close()
  })
})
