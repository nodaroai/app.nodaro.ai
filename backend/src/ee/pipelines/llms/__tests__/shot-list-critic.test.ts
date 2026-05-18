import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runShotListCritic } from "../shot-list-critic.js"

beforeEach(() => vi.clearAllMocks())

const fakeSceneNodeData = {
  scene_index: 1,
  description: "x",
  emotional_beat: "setup",
  duration_seconds: 30,
  shot_input_mode: "first_frame" as const,
  cast_keys: [],
  location_key: "carrier",
  object_keys: [],
  continuity_from_prev: "hard_cut" as const,
  image_model: "nano-banana-2",
  video_model: "kling",
  shots: [],
  scene_anchor_keyframe: null,
  generated_keyframes: [],
  generated_clips: [],
  composite_video: null,
  last_frame: null,
  scene_audio_track: null,
} as never

describe("runShotListCritic", () => {
  it("uses critic role + Sonnet + shot_list task + sceneId", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        verdict: "pass",
        issues: [],
        duration_analysis: {
          target_seconds: 30,
          actual_sum_seconds: 30,
          deviation_percent: 0,
          within_tolerance: true,
        },
      },
      llmCallId: "x",
      costUsd: 0.04,
      inputTokens: 600,
      outputTokens: 200,
    })

    await runShotListCritic({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-entity-1",
      userId: "u1",
      sceneNodeData: fakeSceneNodeData,
    })

    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("critic")
    expect(call.task).toBe("shot_list")
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(call.sceneId).toBe("scene-entity-1")
    expect(call.temperature).toBe(0.2)
  })

  it("returns the verdict shape", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        verdict: "fail",
        issues: [
          {
            severity: "blocking",
            shot_id: "shot_03",
            issue_type: "duration",
            description: "shot 3 duration exceeds 8s hard max",
            suggested_fix: "Cap at 8.0s and add a transition_shot",
          },
        ],
        duration_analysis: {
          target_seconds: 30,
          actual_sum_seconds: 38,
          deviation_percent: 26.7,
          within_tolerance: false,
        },
      },
      llmCallId: "x",
      costUsd: 0.04,
      inputTokens: 600,
      outputTokens: 250,
    })

    const result = await runShotListCritic({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-entity-1",
      userId: "u1",
      sceneNodeData: fakeSceneNodeData,
    })

    expect(result.verdict).toBe("fail")
    expect(result.issues[0]?.shot_id).toBe("shot_03")
    expect(result.duration_analysis.within_tolerance).toBe(false)
  })
})
