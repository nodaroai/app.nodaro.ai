import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../llms/detection.js", () => ({ runDetection: vi.fn() }))
vi.mock("../../llms/showrunner.js", () => ({ runShowrunner: vi.fn() }))
vi.mock("../../llms/script-critic.js", () => ({ runScriptCritic: vi.fn() }))
vi.mock("../../llms/cast-coverage-critic.js", () => ({ runCastCoverageCritic: vi.fn() }))

import { runDetection } from "../../llms/detection.js"
import { runShowrunner } from "../../llms/showrunner.js"
import { runScriptCritic } from "../../llms/script-critic.js"
import { runCastCoverageCritic } from "../../llms/cast-coverage-critic.js"
import { runScriptStage } from "../script.js"

function fakeSupabase() {
  // `select(...).eq(...)` returns an object that supports both another `.eq()`
  // (used by `ensureStageRow`'s `pipeline_id`+`stage_name` lookup) and `.single()`
  // (used by `incrementCriticRetry`'s `id` lookup).
  const selectChain = {
    eq: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: null }),
      }),
      single: async () => ({ data: { critic_retry_count: 0 }, error: null }),
    }),
  }
  return {
    from: () => ({
      select: () => selectChain,
      insert: () => ({ select: () => ({ single: async () => ({ data: { id: "stage-1" }, error: null }) }) }),
      update: () => ({ eq: () => ({ data: null }) }),
    }),
  } as never
}

const fakeDetection = { characters: [], objects: [], locations: [],
  audio_intent: { has_narrator: false, narrator_profile_hint: null, dialogue_speaker_keys: [],
    music: { mood_hint: "", bpm_hint: 100, genre_hints: [] }, sfx_hints: [] } }
const fakePlan = { title: "x", logline: "x", target_duration_seconds: 60, format: "short_film", output_resolution: "1080p", language: "en", genre: "drama", tone: [], cast: [], locations: [], objects: [], scenes: [], beats: [], has_narrator: false, narrator_profile: null, music_plan: { mood: "x", bpm_target: 120, genre_hints: [] }, global_style: { visual_style: "", color_palette: "", lighting: "", camera_language: "" }, total_duration_seconds: 60, estimated_scene_count: 0, warnings: [] } as never

describe("runScriptStage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns awaiting_approval when both critics pass", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: "pass", issues: [], duration_analysis: { target_seconds: 60, actual_sum_seconds: 60, deviation_percent: 0, within_tolerance: true },
    })
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: "pass", issues: [], dialogue_distribution: [],
    })

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("awaiting_approval")
  })

  it("retries Showrunner on blocking critic fail then succeeds", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        verdict: "fail",
        issues: [{ severity: "blocking", scene_index: null, issue_type: "duration", description: "x", suggested_fix: "x" }],
        duration_analysis: { target_seconds: 60, actual_sum_seconds: 80, deviation_percent: 33, within_tolerance: false },
      })
      .mockResolvedValueOnce({
        verdict: "pass", issues: [], duration_analysis: { target_seconds: 60, actual_sum_seconds: 60, deviation_percent: 0, within_tolerance: true },
      })
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: "pass", issues: [], dialogue_distribution: [],
    })

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("awaiting_approval")
    expect(runShowrunner).toHaveBeenCalledTimes(2)
    // Second Showrunner call carried critic feedback:
    const secondCallArgs = (runShowrunner as ReturnType<typeof vi.fn>).mock.calls[1][0]
    expect(secondCallArgs.criticFeedback).toBeDefined()
  })

  it("returns failed after 2 critic retries without resolution", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: "fail",
      issues: [{ severity: "blocking", scene_index: null, issue_type: "duration", description: "x", suggested_fix: "x" }],
      duration_analysis: { target_seconds: 60, actual_sum_seconds: 80, deviation_percent: 33, within_tolerance: false },
    })
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: "pass", issues: [], dialogue_distribution: [],
    })

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("script_critic_unresolvable")
    }
    expect(runShowrunner).toHaveBeenCalledTimes(3) // initial + 2 retries
  })
})
