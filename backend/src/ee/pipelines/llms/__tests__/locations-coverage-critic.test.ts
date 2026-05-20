import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ShowrunnerPlan } from "@nodaro/shared"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runLocationsCoverageCritic } from "../locations-coverage-critic.js"

const mockSupabase = {} as never

function makePlan(): ShowrunnerPlan {
  return {
    title: "T", logline: "L", target_duration_seconds: 30, format: "short_film",
    output_resolution: "1080p", language: "en", genre: "drama", tone: ["intimate"],
    cast: [],
    locations: [{ key: "loc1", name: "L1", visual_description: "A bright kitchen with sunlight pouring in", variants_needed: [] }],
    objects: [], scenes: [],
    beats: [], has_narrator: false, narrator_profile: null,
    music_plan: { mood: "m", bpm_target: 100, genre_hints: [] },
    global_style: { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" },
    total_duration_seconds: 30, estimated_scene_count: 1, warnings: [],
  } as ShowrunnerPlan
}

describe("runLocationsCoverageCritic", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls callLLM with role='critic', task='locations_coverage', maxRetries:1, cached system prompt", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { verdict: "pass", issues: [] },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runLocationsCoverageCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1", plan: makePlan(),
    })

    expect(callLLM).toHaveBeenCalledTimes(1)
    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.role).toBe("critic")
    expect(args.task).toBe("locations_coverage")
    expect(args.maxRetries).toBe(1)
    expect(args.modelId).toBe("claude-sonnet-4-6")
    expect(args.temperature).toBe(0.2)
    expect(args.systemPrompt).toContain("Locations Coverage Critic")
  })

  it("returns the parsed verdict", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { verdict: "fail", issues: [{ severity: "blocking", issue_type: "duplicate_key", scene_index: null, description: "dup", suggested_fix: "x", location_key: "x" }] },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    const result = await runLocationsCoverageCritic({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1", plan: makePlan(),
    })

    expect(result.verdict).toBe("fail")
    expect(result.issues).toHaveLength(1)
  })
})
