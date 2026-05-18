import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../../call-llm.js"
import { runBridgeToNextScene } from "../bridge-to-next-scene.js"

beforeEach(() => vi.clearAllMocks())

const fakeScene = {
  shots: [
    {
      shot_id: "shot_01",
      camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
      action: "Hero walks slowly",
      start_state: "hero in foreground left",
      end_state: "hero in center, looking up",
    },
    {
      shot_id: "shot_02",
      camera: { shot_type: "close_up", angle: "low", motion: "dolly" },
      action: "Hero kneels",
      start_state: "wider area now empty, no hero",
      end_state: "shadows on ground",
    },
  ],
} as never

describe("runBridgeToNextScene", () => {
  it("uses Sonnet + helper role + bridge_to_next_scene task + sceneId", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        scene_id: "scene-1",
        target_shot_id: "shot_02",
        bridge_image_prompt: "remove hero, leave empty runway with shadows",
        reasoning: "Shot 02 starts after hero exits frame.",
      },
      llmCallId: "x",
      costUsd: 0.008,
      inputTokens: 400,
      outputTokens: 150,
    })

    const result = await runBridgeToNextScene({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-1",
      userId: "u1",
      scene: fakeScene,
      targetShotId: "shot_02",
    })

    expect(result.target_shot_id).toBe("shot_02")
    expect(result.bridge_image_prompt).toContain("remove hero")
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("helper")
    expect(call.task).toBe("bridge_to_next_scene")
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(call.sceneId).toBe("scene-1")
    // Both prior end_state + target start_state surface in the user prompt
    expect(call.userPrompt).toContain("hero in center, looking up")
    expect(call.userPrompt).toContain("wider area now empty")
  })

  it("throws when target_shot_id is not in the scene", async () => {
    await expect(
      runBridgeToNextScene({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s5",
        sceneId: "scene-1",
        userId: "u1",
        scene: fakeScene,
        targetShotId: "shot_99",
      }),
    ).rejects.toThrow(/not found in scene/)
    expect(callLLM).not.toHaveBeenCalled()
  })

  it("throws when target_shot_id is the first shot (no prior to bridge from)", async () => {
    await expect(
      runBridgeToNextScene({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s5",
        sceneId: "scene-1",
        userId: "u1",
        scene: fakeScene,
        targetShotId: "shot_01",
      }),
    ).rejects.toThrow(/first shot/)
    expect(callLLM).not.toHaveBeenCalled()
  })
})
