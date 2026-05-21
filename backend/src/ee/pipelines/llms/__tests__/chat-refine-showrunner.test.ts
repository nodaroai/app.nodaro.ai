import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ShowrunnerPlan } from "@nodaro/shared"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runChatRefineShowrunner } from "../chat-refine-showrunner.js"

const mockSupabase = {} as never

function makePlan(): ShowrunnerPlan {
  return {
    title: "T", logline: "L", target_duration_seconds: 30, format: "short_film",
    output_resolution: "1080p", language: "en", genre: "drama", tone: ["intimate"],
    cast: [], locations: [], objects: [],
    scenes: [
      { scene_index: 1, description: "s1", duration_seconds: 5, cast_keys: [],
        location_key: "x", object_keys: [], dialogue: [], narration: null,
        emotional_beat: "setup", shot_count_hint: 1, continuity_from_prev: "hard_cut" },
      { scene_index: 2, description: "s2", duration_seconds: 10, cast_keys: [],
        location_key: "x", object_keys: [], dialogue: [], narration: null,
        emotional_beat: "rising", shot_count_hint: 1, continuity_from_prev: "hard_cut" },
      { scene_index: 3, description: "s3", duration_seconds: 15, cast_keys: [],
        location_key: "x", object_keys: [], dialogue: [], narration: null,
        emotional_beat: "climax", shot_count_hint: 1, continuity_from_prev: "hard_cut" },
    ],
    beats: [], has_narrator: false, narrator_profile: null,
    music_plan: { mood: "m", bpm_target: 100, genre_hints: [] },
    global_style: { visual_style: "v", color_palette: "p", lighting: "l", camera_language: "c" },
    total_duration_seconds: 30, estimated_scene_count: 3, warnings: [],
  } as ShowrunnerPlan
}

describe("runChatRefineShowrunner", () => {
  beforeEach(() => vi.clearAllMocks())

  it("invokes callLLM with role='specialist', task='chat_refine_showrunner', maxRetries=2, sonnet, temp 0.5", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { reply: "Sure!", proposed_change: null },
      llmCallId: "llm-1", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runChatRefineShowrunner({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      currentPlan: makePlan(), priorTurns: [], userMessage: "Hello",
    })

    expect(callLLM).toHaveBeenCalledTimes(1)
    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.role).toBe("specialist")
    expect(args.task).toBe("chat_refine_showrunner")
    expect(args.maxRetries).toBe(2)
    expect(args.modelId).toBe("claude-sonnet-4-6")
    expect(args.temperature).toBe(0.5)
  })

  it("system prompt contains role-anchor text + embedded plan JSON", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { reply: "ok", proposed_change: null },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runChatRefineShowrunner({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      currentPlan: makePlan(), priorTurns: [], userMessage: "msg",
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(args.systemPrompt).toContain("Showrunner Refinement Director")
    expect(args.systemPrompt).toContain('"title": "T"')
    expect(args.systemPrompt).toContain('"scene_index": 1')
  })

  it("userPrompt is a STRING containing prior turns + latest user message", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: { reply: "ok", proposed_change: null },
      llmCallId: "x", costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    await runChatRefineShowrunner({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      currentPlan: makePlan(),
      priorTurns: [
        { role: "user", content: "Make it shorter" },
        { role: "assistant", content: "Sure, by how much?" },
      ],
      userMessage: "30 seconds",
    })

    const args = vi.mocked(callLLM).mock.calls[0][0]
    expect(typeof args.userPrompt).toBe("string")
    expect(args.userPrompt).toContain("Make it shorter")
    expect(args.userPrompt).toContain("Sure, by how much?")
    expect(args.userPrompt).toContain("30 seconds")
  })

  it("returns { response, llmCallId } shape", async () => {
    vi.mocked(callLLM).mockResolvedValue({
      output: {
        reply: "Done",
        proposed_change: {
          change_type: "edit_artifact",
          json_patch: [{ op: "replace", path: "/title", value: "New" }],
          summary: "Update title",
        },
      },
      llmCallId: "llm-abc",
      costUsd: 0, inputTokens: 0, outputTokens: 0,
    } as never)

    const result = await runChatRefineShowrunner({
      supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
      currentPlan: makePlan(), priorTurns: [], userMessage: "Rename",
    })

    expect(result.llmCallId).toBe("llm-abc")
    expect(result.response.reply).toBe("Done")
    expect(result.response.proposed_change?.change_type).toBe("edit_artifact")
  })

  it("propagates callLLM exceptions to the caller", async () => {
    vi.mocked(callLLM).mockRejectedValue(new Error("502 service unavailable"))
    await expect(
      runChatRefineShowrunner({
        supabase: mockSupabase, pipelineId: "p1", stageId: "s1", userId: "u1",
        currentPlan: makePlan(), priorTurns: [], userMessage: "x",
      }),
    ).rejects.toThrow("502")
  })
})
