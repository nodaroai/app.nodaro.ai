import { describe, it, expect, vi, beforeEach } from "vitest"
import Fastify from "fastify"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import.
//
// The factory bodies are hoisted by vi.mock, so any helper (e.g. the supabase
// fixture builder) must be self-contained (no captured top-level variables).
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

vi.mock("../../ee/pipelines/llms/helpers/audit-prompt.js", () => ({
  runAuditPrompt: vi.fn(),
}))
vi.mock("../../ee/pipelines/llms/helpers/improve-prompt.js", () => ({
  runImprovePrompt: vi.fn(),
}))
vi.mock("../../ee/pipelines/llms/helpers/generate-motion.js", () => ({
  runGenerateMotion: vi.fn(),
}))
vi.mock("../../ee/pipelines/llms/helpers/optimize-for-model.js", () => ({
  runOptimizeForModel: vi.fn(),
}))
vi.mock("../../ee/pipelines/llms/helpers/add-broll.js", () => ({
  runAddBRoll: vi.fn(),
}))
vi.mock("../../ee/pipelines/llms/helpers/bridge-to-next-scene.js", () => ({
  runBridgeToNextScene: vi.fn(),
}))
vi.mock("../../ee/pipelines/llms/helpers/anchor-scene-style.js", () => ({
  runAnchorSceneStyle: vi.fn(),
}))

// ---------------------------------------------------------------------------
// In-memory supabase mock — minimal chain support matching scene-helpers.ts.
//
// Tests can toggle module-level fixtures via mutators exposed on the mock
// module (sceneSupabaseState.*) — see overrideScene / overridePlan below.
// ---------------------------------------------------------------------------

vi.mock("../../lib/supabase.js", () => {
  const state = {
    pipeline: { id: "p1", user_id: "u1" } as { id: string; user_id: string } | null,
    scene: {
      id: "scene-1",
      stage_id: "stage-5",
      entity_type: "scene",
      metadata: {
        entity_type: "scene",
        scene_node_data: {
          scene_index: 1,
          description: "A misty forest at dawn.",
          emotional_beat: "setup",
          duration_seconds: 30,
          shot_input_mode: "first_frame",
          cast_keys: [],
          location_key: "forest",
          object_keys: [],
          continuity_from_prev: "hard_cut",
          image_model: "nano-banana-2",
          video_model: "kling",
          shots: [],
          scene_anchor_keyframe: null,
          generated_keyframes: [],
          generated_clips: [],
          composite_video: null,
          last_frame: null,
          scene_audio_track: null,
        },
      },
    } as Record<string, unknown> | null,
    plan: {
      cast: [],
      locations: [],
      objects: [],
      global_style: {
        visual_style: "x",
        color_palette: "x",
        lighting: "x",
        camera_language: "x",
      },
      format: "short_film",
    } as Record<string, unknown> | null,
  }

  function from(table: string) {
    if (table === "pipelines") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: state.pipeline, error: null }),
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
                maybeSingle: async () => ({ data: state.scene, error: null }),
              }),
            }),
          }),
        }),
      }
    }
    if (table === "pipeline_stages") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.plan ? { output: { plan: state.plan } } : null,
                error: null,
              }),
            }),
          }),
        }),
      }
    }
    throw new Error(`Unmocked table: ${table}`)
  }

  return {
    supabase: { from },
    // Test-only mutators (exposed on the mocked module so tests can flip
    // fixtures between calls without redefining the mock).
    __sceneHelpersState: state,
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { sceneHelpersRoutes } from "../scene-helpers.js"
import {
  reserveHelperCredits,
  refundHelperCredits,
} from "../../ee/pipelines/scene-helper-credits.js"
import { runAuditPrompt } from "../../ee/pipelines/llms/helpers/audit-prompt.js"
import { runImprovePrompt } from "../../ee/pipelines/llms/helpers/improve-prompt.js"
import { runAnchorSceneStyle } from "../../ee/pipelines/llms/helpers/anchor-scene-style.js"

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

beforeEach(() => {
  vi.clearAllMocks()
  // Defaults — mutated only by specific tests below.
  ;(reserveHelperCredits as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    usageLogId: "log-1",
  })
  ;(refundHelperCredits as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /v1/pipelines/:id/entities/:sceneId/helpers/audit_prompt", () => {
  it("dispatches the helper, returns 200, and reserves credits", async () => {
    ;(runAuditPrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
      scene_id: "scene-1",
      ok: true,
      issues_per_shot: [],
      scene_level_notes: "All good.",
    })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/audit_prompt",
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ scene_id: "scene-1", ok: true })
    expect(runAuditPrompt).toHaveBeenCalledTimes(1)
    expect(reserveHelperCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        helperName: "audit_prompt",
        userId: TEST_USER_ID,
      }),
    )
    expect(refundHelperCredits).not.toHaveBeenCalled()
    await app.close()
  })

  it("refunds the reservation when the helper LLM throws (500 helper_failed)", async () => {
    ;(runAuditPrompt as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("upstream api down"),
    )
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/audit_prompt",
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("helper_failed")
    expect(res.json().error.detail).toBe("upstream api down")
    expect(refundHelperCredits).toHaveBeenCalledTimes(1)
    expect(refundHelperCredits).toHaveBeenCalledWith(expect.anything(), "log-1")
    await app.close()
  })

  it("returns 403 edition_required when hasCredits() is false", async () => {
    const config = await import("../../lib/config.js")
    ;(config.hasCredits as ReturnType<typeof vi.fn>).mockReturnValueOnce(false)
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/audit_prompt",
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe("edition_required")
    expect(res.json().error.required_edition).toBe("cloud")
    // Edition gate fires BEFORE credit reservation.
    expect(reserveHelperCredits).not.toHaveBeenCalled()
    await app.close()
  })

  it("returns 402 when reserveHelperCredits reports insufficient_credits", async () => {
    ;(reserveHelperCredits as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: "insufficient_credits",
    })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/audit_prompt",
    })
    expect(res.statusCode).toBe(402)
    expect(res.json().error.code).toBe("insufficient_credits")
    expect(runAuditPrompt).not.toHaveBeenCalled()
    expect(refundHelperCredits).not.toHaveBeenCalled()
    await app.close()
  })
})

describe("POST /v1/pipelines/:id/entities/:sceneId/helpers/improve_prompt", () => {
  it("returns 400 validation_error when the body is empty", async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/improve_prompt",
      payload: {}, // missing shot_ids + field_targets
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("validation_error")
    expect(runImprovePrompt).not.toHaveBeenCalled()
    // Body validation fires BEFORE credit reservation.
    expect(reserveHelperCredits).not.toHaveBeenCalled()
    await app.close()
  })

  it("dispatches improve_prompt with the validated input", async () => {
    ;(runImprovePrompt as ReturnType<typeof vi.fn>).mockResolvedValue({
      scene_id: "scene-1",
      shots: [
        { shot_id: "shot_01", action: "rewritten.", reasoning: "more cinematic" },
      ],
    })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/improve_prompt",
      payload: { shot_ids: ["shot_01"], field_targets: ["action"] },
    })
    expect(res.statusCode).toBe(200)
    expect(runImprovePrompt).toHaveBeenCalledTimes(1)
    expect(runImprovePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { shot_ids: ["shot_01"], field_targets: ["action"] },
        userId: TEST_USER_ID,
      }),
    )
    expect(reserveHelperCredits).toHaveBeenCalledWith(
      expect.objectContaining({ helperName: "improve_prompt" }),
    )
    await app.close()
  })
})

describe("POST /v1/pipelines/:id/entities/:sceneId/helpers/anchor_scene_style", () => {
  it("dispatches the anchor_scene_style helper with the scene context", async () => {
    ;(runAnchorSceneStyle as ReturnType<typeof vi.fn>).mockResolvedValue({
      scene_id: "scene-1",
      anchor_prompt: "A misty forest at dawn, cinematic mid-wide.",
      asset_id: "00000000-0000-0000-0000-000000000aaa",
      asset_url: "https://example.com/a.png",
      credits_spent: 4,
    })
    const app = await makeApp()
    const res = await app.inject({
      method: "POST",
      url: "/v1/pipelines/p1/entities/scene-1/helpers/anchor_scene_style",
    })
    expect(res.statusCode).toBe(200)
    expect(runAnchorSceneStyle).toHaveBeenCalledTimes(1)
    expect(runAnchorSceneStyle).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "p1",
        pipelineEntityId: "scene-1",
        userId: TEST_USER_ID,
      }),
    )
    expect(reserveHelperCredits).toHaveBeenCalledWith(
      expect.objectContaining({ helperName: "anchor_scene_style" }),
    )
    await app.close()
  })
})
