import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../../call-llm.js"
import { runAuditPrompt } from "../audit-prompt.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  format: "short_film",
  global_style: {
    visual_style: "photoreal",
    color_palette: "warm",
    lighting: "golden",
    camera_language: "wide",
  },
} as never

const fakeScene = {
  description: "Hero on the runway",
  emotional_beat: "setup",
  shots: [
    {
      shot_id: "shot_01",
      action: "Hero walks slowly",
      motion_prompt: "static camera",
      dialogue_line: null,
      camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    },
  ],
} as never

describe("runAuditPrompt", () => {
  it("uses Haiku + helper role + audit_prompt task + sceneId", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { scene_id: "x", ok: true, issues_per_shot: [], scene_level_notes: "All good." },
      llmCallId: "x",
      costUsd: 0.005,
      inputTokens: 300,
      outputTokens: 100,
    })

    const result = await runAuditPrompt({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: fakeScene,
    })

    expect(result).toEqual({
      scene_id: "x",
      ok: true,
      issues_per_shot: [],
      scene_level_notes: "All good.",
    })
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("helper")
    expect(call.task).toBe("audit_prompt")
    expect(call.modelId).toBe("claude-haiku-4-5")
    expect(call.sceneId).toBe("scene-1")
  })
})
