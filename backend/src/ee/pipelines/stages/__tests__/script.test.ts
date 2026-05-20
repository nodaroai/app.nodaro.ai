import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../llms/detection.js", () => ({ runDetection: vi.fn() }))
vi.mock("../../llms/showrunner.js", () => ({ runShowrunner: vi.fn() }))
vi.mock("../../llms/script-critic.js", () => ({ runScriptCritic: vi.fn() }))
vi.mock("../../llms/cast-coverage-critic.js", () => ({ runCastCoverageCritic: vi.fn() }))
vi.mock("../../llms/locations-coverage-critic.js", () => ({ runLocationsCoverageCritic: vi.fn() }))

import { runDetection } from "../../llms/detection.js"
import { runShowrunner } from "../../llms/showrunner.js"
import { runScriptCritic } from "../../llms/script-critic.js"
import { runCastCoverageCritic } from "../../llms/cast-coverage-critic.js"
import { runLocationsCoverageCritic } from "../../llms/locations-coverage-critic.js"
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

const passScriptVerdict = {
  verdict: "pass",
  issues: [],
  duration_analysis: { target_seconds: 60, actual_sum_seconds: 60, deviation_percent: 0, within_tolerance: true },
}
const passCastVerdict = { verdict: "pass", issues: [], dialogue_distribution: [] }
const passLocationsVerdict = { verdict: "pass", issues: [] }

const blockingScriptVerdict = {
  verdict: "fail",
  issues: [{ severity: "blocking", scene_index: null, issue_type: "duration", description: "x", suggested_fix: "x" }],
  duration_analysis: { target_seconds: 60, actual_sum_seconds: 80, deviation_percent: 33, within_tolerance: false },
}
const blockingCastVerdict = {
  verdict: "fail",
  issues: [{ severity: "blocking", character_name: "alice", issue_type: "no_voice_match", description: "x", suggested_fix: "x" }],
  dialogue_distribution: [],
}
const blockingLocationsVerdict = {
  verdict: "fail",
  issues: [{ severity: "blocking", issue_type: "orphan_location", description: "x", suggested_fix: "x", location_key: "lk1" }],
}

describe("runScriptStage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns awaiting_approval (mode=manual) when all critics pass", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passScriptVerdict)
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passCastVerdict)
    ;(runLocationsCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passLocationsVerdict)

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("awaiting_approval")
    expect(runScriptCritic).toHaveBeenCalledTimes(1)
    expect(runCastCoverageCritic).toHaveBeenCalledTimes(1)
    expect(runLocationsCoverageCritic).toHaveBeenCalledTimes(1)
    if (result.status === "awaiting_approval" || result.status === "approved") {
      expect(result.locationsCoverageCritic).toEqual(passLocationsVerdict)
      expect(result.objectsValidation).toBeDefined()
      expect(result.objectsValidation.verdict).toBe("pass")
    }
  })

  it("returns approved (mode=auto) when all critics pass", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passScriptVerdict)
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passCastVerdict)
    ;(runLocationsCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passLocationsVerdict)

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "auto",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("approved")
    if (result.status === "approved") {
      expect(result.plan).toEqual(fakePlan)
      expect(result.scriptCritic).toEqual(passScriptVerdict)
      expect(result.castCoverageCritic).toEqual(passCastVerdict)
      expect(result.locationsCoverageCritic).toEqual(passLocationsVerdict)
      expect(result.objectsValidation.verdict).toBe("pass")
    }
  })

  it("retries Showrunner on blocking critic fail then succeeds", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(blockingScriptVerdict)
      .mockResolvedValueOnce(passScriptVerdict)
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passCastVerdict)
    ;(runLocationsCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passLocationsVerdict)

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("awaiting_approval")
    expect(runShowrunner).toHaveBeenCalledTimes(2)
    const secondCallArgs = (runShowrunner as ReturnType<typeof vi.fn>).mock.calls[1][0]
    expect(secondCallArgs.criticFeedback).toBeDefined()
    // Combined envelope now includes all 4 verdicts:
    expect(secondCallArgs.criticFeedback.scriptVerdict).toBeDefined()
    expect(secondCallArgs.criticFeedback.castVerdict).toBeDefined()
    expect(secondCallArgs.criticFeedback.locationsVerdict).toBeDefined()
    expect(secondCallArgs.criticFeedback.objectsVerdict).toBeDefined()
  })

  it("retries Showrunner on blocking locations verdict (non-blocking others)", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passScriptVerdict)
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passCastVerdict)
    ;(runLocationsCoverageCritic as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(blockingLocationsVerdict)
      .mockResolvedValueOnce(passLocationsVerdict)

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("awaiting_approval")
    expect(runShowrunner).toHaveBeenCalledTimes(2)
    const secondCallArgs = (runShowrunner as ReturnType<typeof vi.fn>).mock.calls[1][0]
    expect(secondCallArgs.criticFeedback.locationsVerdict).toEqual(blockingLocationsVerdict)
  })

  it("returns failed with failure_detail='locations_coverage' after cap-reached blocking locations", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passScriptVerdict)
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passCastVerdict)
    ;(runLocationsCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(blockingLocationsVerdict)

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("script_critic_unresolvable")
      expect(result.failure_detail).toBe("locations_coverage")
    }
    expect(runShowrunner).toHaveBeenCalledTimes(3) // initial + 2 retries
  })

  it("returns failed with failure_detail='objects_validation' on cap-reached blocking objects", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    // Plan with duplicate object keys → validateObjects produces a blocking
    // 'duplicate_key' issue. The Showrunner returns the same plan on every
    // retry, so the issue never resolves and we hit the cap.
    const dupObjectsPlan = {
      ...(fakePlan as Record<string, unknown>),
      objects: [
        { key: "dup", name: "X", visual_description: "a", narrative_significance: "story" },
        { key: "dup", name: "X", visual_description: "a", narrative_significance: "story" },
      ],
    } as never
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(dupObjectsPlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passScriptVerdict)
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passCastVerdict)
    ;(runLocationsCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passLocationsVerdict)

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("script_critic_unresolvable")
      expect(result.failure_detail).toBe("objects_validation")
    }
  })

  it("BUG FIX: cast-only blocking with passing script verdict now correctly fails (was: slipped through)", async () => {
    // Pre-fix: the cap-reached guard was `scriptVerdict.verdict === "fail" && hasBlockingIssue(...)`,
    // so a blocking-only cast failure with `scriptVerdict.verdict === "pass"` slipped through
    // to `awaiting_approval`. Now we just check `hasBlockingIssue` regardless of script's verdict.
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passScriptVerdict)
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(blockingCastVerdict)
    ;(runLocationsCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passLocationsVerdict)

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("script_critic_unresolvable")
      expect(result.failure_detail).toBe("cast_coverage")
    }
  })

  it("returns failed after 2 critic retries on persistent blocking script verdict", async () => {
    ;(runDetection as ReturnType<typeof vi.fn>).mockResolvedValue(fakeDetection)
    ;(runShowrunner as ReturnType<typeof vi.fn>).mockResolvedValue(fakePlan)
    ;(runScriptCritic as ReturnType<typeof vi.fn>).mockResolvedValue(blockingScriptVerdict)
    ;(runCastCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passCastVerdict)
    ;(runLocationsCoverageCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passLocationsVerdict)

    const result = await runScriptStage({
      supabase: fakeSupabase(), pipelineId: "p1", userId: "u1",
      storyPrompt: "x", targetDurationSeconds: 60, format: "short_film",
      outputResolution: "1080p", language: "en", mode: "manual",
      activationMode: "interactive", userTier: "pro",
    })

    expect(result.status).toBe("failed")
    if (result.status === "failed") {
      expect(result.reason).toBe("script_critic_unresolvable")
      expect(result.failure_detail).toBe("script")
    }
    expect(runShowrunner).toHaveBeenCalledTimes(3) // initial + 2 retries
  })
})
