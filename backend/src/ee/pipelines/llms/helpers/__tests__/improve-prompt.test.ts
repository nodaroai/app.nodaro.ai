import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../../call-llm.js"
import { runImprovePrompt } from "../improve-prompt.js"

beforeEach(() => vi.clearAllMocks())

const fakeScene = {
  description: "x",
  emotional_beat: "setup",
  continuity_from_prev: "hard_cut",
  video_model: "kling",
  shots: [
    { shot_id: "shot_01", action: "x", motion_prompt: "x", dialogue_line: null },
    { shot_id: "shot_02", action: "x", motion_prompt: "x", dialogue_line: null },
  ],
} as never

const fakePlan = {
  global_style: {
    visual_style: "x",
    color_palette: "x",
    lighting: "x",
    camera_language: "x",
  },
} as never

describe("runImprovePrompt", () => {
  it("uses Sonnet + helper role + improve_prompt task + sceneId", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { scene_id: "x", shots: [] },
      llmCallId: "x",
      costUsd: 0.01,
      inputTokens: 500,
      outputTokens: 200,
    })

    const result = await runImprovePrompt({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: fakeScene,
      input: { shot_ids: ["shot_01"], field_targets: ["action"] },
    })

    expect(result).toEqual({ scene_id: "x", shots: [] })
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("helper")
    expect(call.task).toBe("improve_prompt")
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(call.sceneId).toBe("scene-1")
    expect(call.userPrompt).toContain('"shot_01"')
  })

  it("expands shot_ids: ['all'] to every scene shot in the user prompt", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { scene_id: "x", shots: [] },
      llmCallId: "x",
      costUsd: 0.01,
      inputTokens: 500,
      outputTokens: 200,
    })

    await runImprovePrompt({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: fakeScene,
      input: { shot_ids: ["all"], field_targets: ["motion_prompt"] },
    })

    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.userPrompt).toContain('"shot_01"')
    expect(call.userPrompt).toContain('"shot_02"')
  })
})
