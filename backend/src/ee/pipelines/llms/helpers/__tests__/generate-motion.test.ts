import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../../call-llm.js"
import { runGenerateMotion } from "../generate-motion.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {} as never

const fakeScene = {
  description: "x",
  emotional_beat: "setup",
  video_model: "kling",
  shots: [
    {
      shot_id: "shot_01",
      camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
      action: "Hero walks",
      duration_seconds: 4,
      visual_keyframe_prompt: "wide eye-level shot of hero",
      shot_intent: {
        needs_multishot_reference: false,
        is_loopable: false,
        needs_music_suppression: true,
        is_match_cut: false,
      },
    },
    {
      shot_id: "shot_02",
      camera: { shot_type: "close_up", angle: "low", motion: "dolly" },
      action: "Hero looks up",
      duration_seconds: 3,
      visual_keyframe_prompt: "close up of hero looking up",
      shot_intent: {
        needs_multishot_reference: false,
        is_loopable: true,
        needs_music_suppression: true,
        is_match_cut: false,
      },
    },
  ],
} as never

describe("runGenerateMotion", () => {
  it("uses Haiku + helper role + generate_motion task + sceneId", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        scene_id: "scene-1",
        shots: [{ shot_id: "shot_01", motion_prompt: "static frame" }],
      },
      llmCallId: "x",
      costUsd: 0.003,
      inputTokens: 200,
      outputTokens: 60,
    })

    const result = await runGenerateMotion({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: fakeScene,
      shotIds: ["shot_01"],
    })

    expect(result.scene_id).toBe("scene-1")
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("helper")
    expect(call.task).toBe("generate_motion")
    expect(call.modelId).toBe("claude-haiku-4-5")
    expect(call.sceneId).toBe("scene-1")
    expect(call.userPrompt).toContain('"shot_01"')
    // Only the targeted shot is in the prompt
    expect(call.userPrompt).not.toContain('"shot_02"')
  })

  it("expands shotIds: ['all'] to every scene shot in the user prompt", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { scene_id: "scene-1", shots: [] },
      llmCallId: "x",
      costUsd: 0.003,
      inputTokens: 200,
      outputTokens: 60,
    })

    await runGenerateMotion({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: fakeScene,
      shotIds: ["all"],
    })

    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.userPrompt).toContain('"shot_01"')
    expect(call.userPrompt).toContain('"shot_02"')
  })
})
