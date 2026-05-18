import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../../call-llm.js"
import { runAddBRoll } from "../add-broll.js"

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
  description: "Hero on the runway between flights",
  emotional_beat: "anticipation",
  duration_seconds: 20,
  shots: [
    {
      shot_id: "shot_01",
      action: "Hero walks across runway",
      duration_seconds: 6,
    },
  ],
} as never

describe("runAddBRoll", () => {
  it("uses Sonnet + helper role + add_broll task + sceneId", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        scene_id: "scene-1",
        candidates: [
          {
            proposed_insert_after_shot_id: "shot_01",
            insert_kind: "reaction_shot",
            shot: { shot_id: "shot_02" },
            rationale: "Adds emotional beat.",
          },
        ],
        scene_duration_delta: 2,
      },
      llmCallId: "x",
      costUsd: 0.01,
      inputTokens: 600,
      outputTokens: 400,
    })

    const result = await runAddBRoll({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: fakeScene,
    })

    expect(result.candidates).toHaveLength(1)
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("helper")
    expect(call.task).toBe("add_broll")
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(call.sceneId).toBe("scene-1")
    // Scene description flows into the user prompt
    expect(call.userPrompt).toContain("Hero on the runway between flights")
  })
})
