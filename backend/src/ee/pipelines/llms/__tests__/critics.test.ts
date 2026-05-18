import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runScriptCritic } from "../script-critic.js"
import { runCastCoverageCritic } from "../cast-coverage-critic.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  title: "x", logline: "x", target_duration_seconds: 60, format: "short_film" as const,
  output_resolution: "1080p" as const, language: "en", genre: "drama" as const, tone: [],
  cast: [], locations: [], objects: [], scenes: [], beats: [],
  has_narrator: false, narrator_profile: null,
  music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
  global_style: { visual_style: "x", color_palette: "x", lighting: "x", camera_language: "x" },
  total_duration_seconds: 60, estimated_scene_count: 0, warnings: [],
}

describe("runScriptCritic", () => {
  it("uses Sonnet + critic role + 'script' task", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        verdict: "pass",
        issues: [],
        duration_analysis: { target_seconds: 60, actual_sum_seconds: 60, deviation_percent: 0, within_tolerance: true },
      },
      llmCallId: "x", costUsd: 0.02, inputTokens: 100, outputTokens: 50,
    })
    await runScriptCritic({ supabase: {} as never, pipelineId: "p1", stageId: "s1", userId: "u1", plan: fakePlan })
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("critic")
    expect(call.task).toBe("script")
    expect(call.modelId).toBe("claude-sonnet-4-6")
  })
})

describe("runCastCoverageCritic", () => {
  it("uses 'cast_coverage' task", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { verdict: "pass", issues: [], dialogue_distribution: [] },
      llmCallId: "x", costUsd: 0.02, inputTokens: 100, outputTokens: 50,
    })
    await runCastCoverageCritic({ supabase: {} as never, pipelineId: "p1", stageId: "s1", userId: "u1", plan: fakePlan })
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.task).toBe("cast_coverage")
  })
})
