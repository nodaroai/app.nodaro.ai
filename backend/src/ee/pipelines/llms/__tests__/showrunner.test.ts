import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({
  callLLM: vi.fn(),
  CallLLMValidationError: class extends Error {},
}))

import { callLLM } from "../call-llm.js"
import { runShowrunner } from "../showrunner.js"

beforeEach(() => {
  vi.clearAllMocks()
})

const fakePlan = {
  title: "Final Mission",
  logline: "A pilot's last flight",
  target_duration_seconds: 60,
  format: "short_film" as const,
  output_resolution: "1080p" as const,
  language: "en",
  genre: "drama" as const,
  tone: ["epic", "intimate"] as const,
  cast: [],
  locations: [],
  objects: [],
  scenes: [
    { scene_index: 1, description: "x", emotional_beat: "setup" as const, duration_seconds: 20,
      cast_keys: [], location_key: "x", object_keys: [], dialogue: [], narration: null,
      continuity_from_prev: "hard_cut" as const, shot_count_hint: 2 },
    { scene_index: 2, description: "x", emotional_beat: "climax" as const, duration_seconds: 20,
      cast_keys: [], location_key: "x", object_keys: [], dialogue: [], narration: null,
      continuity_from_prev: "hard_cut" as const, shot_count_hint: 2 },
    { scene_index: 3, description: "x", emotional_beat: "resolution" as const, duration_seconds: 20,
      cast_keys: [], location_key: "x", object_keys: [], dialogue: [], narration: null,
      continuity_from_prev: "hard_cut" as const, shot_count_hint: 2 },
  ],
  beats: [],
  has_narrator: false,
  narrator_profile: null,
  music_plan: { mood: "epic", bpm_target: 120, genre_hints: [] },
  global_style: { visual_style: "x", color_palette: "x", lighting: "x", camera_language: "x" },
  total_duration_seconds: 60,
  estimated_scene_count: 3,
  warnings: [],
}

describe("runShowrunner", () => {
  it("calls callLLM with showrunner role + Opus + Detection seed inlined", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: fakePlan,
      llmCallId: "llm-2",
      costUsd: 0.15,
      inputTokens: 800,
      outputTokens: 1200,
    })

    const result = await runShowrunner({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      storyPrompt: "test",
      detectionResult: {
        characters: [{ key: "hero", name: "Hero", visual_description: "x", role_hint: "protagonist", has_dialogue_hint: true }],
        objects: [],
        locations: [],
        audio_intent: {
          has_narrator: false,
          narrator_profile_hint: null,
          dialogue_speaker_keys: ["hero"],
          music: { mood_hint: "epic", bpm_hint: 120, genre_hints: [] },
          sfx_hints: [],
        },
      },
      targetDurationSeconds: 60,
      format: "short_film",
      outputResolution: "1080p",
      language: "en",
      pipelineType: "story_to_video",
      userTier: "pro",
      activationMode: "interactive",
      mode: "manual",
    })

    expect(result.estimated_scene_count).toBe(3)
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.modelId).toBe("claude-opus-4-7")
    expect(call.userPrompt).toContain("\"hero\"")
  })

  it("includes critic feedback when present", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: fakePlan,
      llmCallId: "llm-3",
      costUsd: 0.15,
      inputTokens: 1000,
      outputTokens: 1200,
    })
    await runShowrunner({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s1",
      userId: "u1",
      storyPrompt: "test",
      detectionResult: {
        characters: [], objects: [], locations: [],
        audio_intent: { has_narrator: false, narrator_profile_hint: null, dialogue_speaker_keys: [],
          music: { mood_hint: "", bpm_hint: 100, genre_hints: [] }, sfx_hints: [] },
      },
      targetDurationSeconds: 60,
      format: "short_film",
      outputResolution: "1080p",
      language: "en",
      pipelineType: "story_to_video",
      userTier: "pro",
      activationMode: "interactive",
      mode: "manual",
      criticFeedback: {
        scriptVerdict: {
          verdict: "fail",
          issues: [{
            severity: "blocking",
            scene_index: null,
            description: "duration off",
            suggested_fix: "trim scenes",
            issue_type: "duration",
          }],
          duration_analysis: {
            target_seconds: 60,
            actual_sum_seconds: 80,
            deviation_percent: 33,
            within_tolerance: false,
          },
        },
      },
    })
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.userPrompt).toContain("PRIOR ATTEMPT WAS REJECTED")
    expect(call.userPrompt).toContain("duration off")
  })
})
