import { describe, it, expect, vi, beforeAll, afterAll } from "vitest"

vi.mock("@anthropic-ai/sdk", () => {
  // Sequential responses for: Detection → Showrunner → ScriptCritic → CastCoverageCritic
  const responses = [
    {
      content: [{ type: "tool_use", name: "emit", input: {
        characters: [{ key: "hero", name: "Hero", visual_description: "x",
          role_hint: "protagonist", has_dialogue_hint: true }],
        objects: [],
        locations: [{ key: "desert", name: "Desert", visual_description: "vast sand",
          parent_location_key: null, variant_kind: "main" }],
        audio_intent: { has_narrator: false, narrator_profile_hint: null,
          dialogue_speaker_keys: ["hero"],
          music: { mood_hint: "epic", bpm_hint: 120, genre_hints: ["cinematic"] },
          sfx_hints: [] },
      } }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
    {
      content: [{ type: "tool_use", name: "emit", input: {
        title: "Final Mission", logline: "A pilot's last flight",
        target_duration_seconds: 60, format: "short_film", output_resolution: "1080p",
        language: "en", genre: "drama", tone: ["epic"],
        cast: [{ key: "hero", name: "Hero", role: "protagonist",
          visual_description: "x", voice_profile: "deep, weary",
          has_dialogue: true, angle_count_hint: 3, expression_set_hint: ["determined"] }],
        locations: [{ key: "desert", name: "Desert", visual_description: "vast sand", variants_needed: [] }],
        objects: [],
        scenes: [
          { scene_index: 1, description: "Hero on the runway", emotional_beat: "setup",
            duration_seconds: 20, cast_keys: ["hero"], location_key: "desert", object_keys: [],
            dialogue: [], narration: null, continuity_from_prev: "hard_cut", shot_count_hint: 2 },
          { scene_index: 2, description: "In the cockpit", emotional_beat: "climax",
            duration_seconds: 20, cast_keys: ["hero"], location_key: "desert", object_keys: [],
            dialogue: [], narration: null, continuity_from_prev: "hard_cut", shot_count_hint: 2 },
          { scene_index: 3, description: "Final view of the horizon", emotional_beat: "resolution",
            duration_seconds: 20, cast_keys: ["hero"], location_key: "desert", object_keys: [],
            dialogue: [], narration: null, continuity_from_prev: "hard_cut", shot_count_hint: 2 },
        ],
        beats: [{ type: "hook", scene_indices: [1] }, { type: "climax", scene_indices: [2] }, { type: "resolution", scene_indices: [3] }],
        has_narrator: false, narrator_profile: null,
        music_plan: { mood: "epic", bpm_target: 120, genre_hints: ["cinematic"] },
        global_style: { visual_style: "photorealistic", color_palette: "warm", lighting: "golden", camera_language: "wide" },
        total_duration_seconds: 60, estimated_scene_count: 3, warnings: [],
      } }],
      usage: { input_tokens: 800, output_tokens: 1200 },
    },
    {
      content: [{ type: "tool_use", name: "emit", input: {
        verdict: "pass", issues: [],
        duration_analysis: { target_seconds: 60, actual_sum_seconds: 60,
          deviation_percent: 0, within_tolerance: true },
      } }],
      usage: { input_tokens: 200, output_tokens: 80 },
    },
    {
      content: [{ type: "tool_use", name: "emit", input: {
        verdict: "pass", issues: [],
        dialogue_distribution: [{ cast_key: "hero", line_count: 0, share_pct: 0 }],
      } }],
      usage: { input_tokens: 200, output_tokens: 80 },
    },
  ]
  let idx = 0
  const messagesCreate = vi.fn(async () => responses[idx++])
  return {
    default: vi.fn().mockImplementation(() => ({ messages: { create: messagesCreate } })),
  }
})

import { createClient } from "@supabase/supabase-js"
import { runScriptStage } from "../../ee/pipelines/stages/script.js"

const TEST_USER_ID = process.env.E2E_TEST_USER_ID
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

describe.skipIf(!TEST_USER_ID)("E2E Stage 1: Detection → Showrunner → Critics", () => {
  let pipelineId: string

  beforeAll(async () => {
    const { data, error } = await supabase
      .from("pipelines")
      .insert({
        user_id: TEST_USER_ID, root_node_id: "test_root",
        pipeline_type: "story_to_video", activation_mode: "interactive", mode: "manual",
        input_prompt: "A pilot's final mission over the desert",
        target_duration_seconds: 60, format: "short_film", output_resolution: "1080p", language: "en",
      })
      .select("id").single()
    if (error || !data) throw error
    pipelineId = data.id
  })

  afterAll(async () => {
    if (pipelineId) await supabase.from("pipelines").delete().eq("id", pipelineId)
  })

  it("runs Stage 1 to awaiting_approval", async () => {
    const result = await runScriptStage({
      supabase, pipelineId, userId: TEST_USER_ID!,
      storyPrompt: "A pilot's final mission over the desert",
      targetDurationSeconds: 60, format: "short_film", outputResolution: "1080p",
      language: "en", mode: "manual", activationMode: "interactive", userTier: "pro",
    })
    expect(result.status).toBe("awaiting_approval")
    if (result.status !== "awaiting_approval") return
    expect(result.plan.title).toBe("Final Mission")
    expect(result.scriptCritic.verdict).toBe("pass")
    expect(result.castCoverageCritic.verdict).toBe("pass")

    const { data: stageRow } = await supabase
      .from("pipeline_stages")
      .select("status, output")
      .eq("pipeline_id", pipelineId)
      .eq("stage_name", "script")
      .single()
    expect(stageRow?.status).toBe("running") // engine sets to awaiting_approval; runScriptStage doesn't write status itself
  })
})
