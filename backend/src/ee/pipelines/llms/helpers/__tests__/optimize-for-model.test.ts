import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../../call-llm.js"
import { runOptimizeForModel } from "../optimize-for-model.js"

beforeEach(() => vi.clearAllMocks())

const fakeScene = {
  shots: [
    {
      shot_id: "shot_01",
      action: "Hero walks slowly",
      motion_prompt: "static camera",
      camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
      shot_intensity_kind: "establishing_shot",
      duration_seconds: 4,
      start_state: "hero in foreground",
      end_state: "hero centered",
    },
  ],
} as never

describe("runOptimizeForModel", () => {
  it("uses Sonnet + helper role + optimize_for_model task + sceneId", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        scene_id: "scene-1",
        target_model: "veo3.1",
        shots: [
          {
            shot_id: "shot_01",
            action: "Hero walks slowly across runway",
            motion_prompt: "static camera",
          },
        ],
        rationale: "Veo prefers tag-heavy comma-separated style.",
      },
      llmCallId: "x",
      costUsd: 0.01,
      inputTokens: 600,
      outputTokens: 200,
    })

    const result = await runOptimizeForModel({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-1",
      userId: "u1",
      scene: fakeScene,
      targetModel: "veo3.1",
    })

    expect(result.target_model).toBe("veo3.1")
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("helper")
    expect(call.task).toBe("optimize_for_model")
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(call.sceneId).toBe("scene-1")
    // The target model's prompting style flows into the user prompt
    expect(call.userPrompt).toContain("veo3.1")
    expect(call.userPrompt).toContain("cinematic_tag_heavy")
  })

  it("throws when targetModel is not in VIDEO_MODEL_CAPS", async () => {
    await expect(
      runOptimizeForModel({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s5",
        sceneId: "scene-1",
        userId: "u1",
        scene: fakeScene,
        targetModel: "made-up-model-id",
      }),
    ).rejects.toThrow(/not in VIDEO_MODEL_CAPS/)
    expect(callLLM).not.toHaveBeenCalled()
  })
})
