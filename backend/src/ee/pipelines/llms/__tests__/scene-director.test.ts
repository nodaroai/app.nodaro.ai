import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import { runSceneDirector } from "../scene-director.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  title: "Final Mission",
  logline: "x",
  target_duration_seconds: 60,
  format: "short_film",
  output_resolution: "1080p",
  language: "en",
  genre: "drama",
  tone: ["epic"],
  cast: [
    {
      key: "hero",
      name: "Hero",
      role: "protagonist",
      visual_description: "weathered pilot",
      voice_profile: "deep, weary",
      has_dialogue: true,
      angle_count_hint: 3,
      expression_set_hint: ["determined"],
    },
  ],
  locations: [
    { key: "carrier", name: "Carrier", visual_description: "naval flight deck", variants_needed: [] },
  ],
  objects: [],
  scenes: [
    {
      scene_index: 1,
      description: "Hero on the runway",
      emotional_beat: "setup",
      duration_seconds: 30,
      cast_keys: ["hero"],
      location_key: "carrier",
      object_keys: [],
      dialogue: [],
      narration: null,
      continuity_from_prev: "hard_cut",
      shot_count_hint: 3,
    },
  ],
  beats: [{ type: "hook", scene_indices: [1] }],
  has_narrator: false,
  narrator_profile: null,
  music_plan: { mood: "epic", bpm_target: 120, genre_hints: ["cinematic"] },
  global_style: {
    visual_style: "photoreal",
    color_palette: "warm",
    lighting: "golden",
    camera_language: "wide",
  },
  total_duration_seconds: 30,
  estimated_scene_count: 1,
  warnings: [],
} as never

const fakeSceneNodeData = {
  scene_index: 1,
  description: "Hero on the runway",
  emotional_beat: "setup",
  duration_seconds: 30,
  shot_input_mode: "first_frame",
  cast_keys: ["hero"],
  location_key: "carrier",
  object_keys: [],
  continuity_from_prev: "hard_cut",
  image_model: "nano-banana-2",
  video_model: "kling",
  shots: [
    {
      shot_id: "shot_01",
      camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
      shot_intensity_kind: "establishing_shot",
      action: "Wide shot of the carrier deck at dawn",
      dialogue_line: null,
      duration_seconds: 10,
      motion_prompt: "static camera, ambient breeze",
      start_state: "Empty deck",
      end_state: "Hero enters frame from left",
      continuity_with_previous: null,
      shot_intent: {
        needs_multishot_reference: false,
        is_loopable: false,
        needs_music_suppression: true,
        is_match_cut: false,
      },
      visual_keyframe_prompt: "wide cinematic shot of naval carrier deck at golden dawn, empty, warm light",
    },
    {
      shot_id: "shot_02",
      camera: { shot_type: "medium", angle: "eye_level", motion: "static" },
      shot_intensity_kind: "establishing_shot",
      action: "Hero walks slowly toward camera",
      dialogue_line: null,
      duration_seconds: 10,
      motion_prompt: "subject approaches camera at slow walking pace",
      start_state: "Hero entering from left",
      end_state: "Hero in mid-frame, looking past camera",
      continuity_with_previous: "Hero is the same person from shot 1, walking continues",
      shot_intent: {
        needs_multishot_reference: false,
        is_loopable: false,
        needs_music_suppression: true,
        is_match_cut: false,
      },
      visual_keyframe_prompt: "medium shot of weathered pilot walking on carrier deck, warm golden light",
    },
    {
      shot_id: "shot_03",
      camera: { shot_type: "close_up", angle: "low", motion: "static" },
      shot_intensity_kind: "climactic_shot",
      action: "Close on Hero's determined face",
      dialogue_line: null,
      duration_seconds: 10,
      motion_prompt: "subtle facial micro-expression, camera holds",
      start_state: "Hero looking past camera",
      end_state: "Hero's eyes lock to horizon",
      continuity_with_previous: "Same character, same lighting, tighter framing",
      shot_intent: {
        needs_multishot_reference: false,
        is_loopable: false,
        needs_music_suppression: true,
        is_match_cut: false,
      },
      visual_keyframe_prompt: "close-up of weathered pilot's face, determined, golden light, shallow focus",
    },
  ],
  scene_anchor_keyframe: null,
  generated_keyframes: [],
  generated_clips: [],
  composite_video: null,
  last_frame: null,
  scene_audio_track: null,
} as never

describe("runSceneDirector", () => {
  it("calls callLLM with scene_director role + Sonnet + shot_list task", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: fakeSceneNodeData,
      llmCallId: "x",
      costUsd: 0.08,
      inputTokens: 1200,
      outputTokens: 800,
    })

    const result = await runSceneDirector({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      userId: "u1",
      sceneId: "scene-entity-1",
      plan: fakePlan,
      sceneIndex: 1,
      shotInputMode: "first_frame",
    })

    expect(result.shots.length).toBe(3)
    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.role).toBe("scene_director")
    expect(call.task).toBe("shot_list")
    expect(call.modelId).toBe("claude-sonnet-4-6")
    expect(call.sceneId).toBe("scene-entity-1")
    expect(call.userPrompt).toContain("Hero")
    expect(call.userPrompt).toContain("first_frame")
    expect(call.userPrompt).toContain("kling")
  })

  it("rejects video_model not in eligibleVideoModels", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: { ...(fakeSceneNodeData as Record<string, unknown>), video_model: "made-up-model" },
      llmCallId: "x",
      costUsd: 0.08,
      inputTokens: 1200,
      outputTokens: 800,
    })

    await expect(
      runSceneDirector({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s5",
        userId: "u1",
        sceneId: "scene-entity-1",
        plan: fakePlan,
        sceneIndex: 1,
        shotInputMode: "first_frame",
      }),
    ).rejects.toThrow(/not eligible/)
  })

  it("coerces shot_input_mode to the stage-selected mode (ref_images) even if the LLM echoes first_frame", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      // LLM picks a ref_images-eligible model but echoes a stale shot_input_mode.
      output: {
        ...(fakeSceneNodeData as Record<string, unknown>),
        video_model: "seedance-2",
        shot_input_mode: "first_frame",
      },
      llmCallId: "x",
      costUsd: 0.08,
      inputTokens: 1200,
      outputTokens: 800,
    })

    const result = await runSceneDirector({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      userId: "u1",
      sceneId: "scene-entity-1",
      plan: fakePlan,
      sceneIndex: 1,
      shotInputMode: "ref_images",
      videoModelOverride: "seedance-2",
    })

    expect(result.shot_input_mode).toBe("ref_images")
    expect(result.video_model).toBe("seedance-2")
  })

  it("honors a pinned video model film-wide even when it isn't in VIDEO_MODEL_CAPS (e.g. seedance v1)", async () => {
    // The LLM picks a caps-eligible first_frame model; the user pinned 'seedance'
    // (no caps entry). The pin must win so the whole film is consistent.
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: {
        ...(fakeSceneNodeData as Record<string, unknown>),
        video_model: "kling",
      },
      llmCallId: "x",
      costUsd: 0.08,
      inputTokens: 1200,
      outputTokens: 800,
    })

    const result = await runSceneDirector({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      userId: "u1",
      sceneId: "scene-entity-1",
      plan: fakePlan,
      sceneIndex: 1,
      shotInputMode: "first_frame",
      videoModelOverride: "seedance",
    })

    expect(result.video_model).toBe("seedance")
  })

  it("throws when scene_index not in plan", async () => {
    await expect(
      runSceneDirector({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s5",
        userId: "u1",
        sceneId: "scene-entity-99",
        plan: fakePlan,
        sceneIndex: 99,
        shotInputMode: "first_frame",
      }),
    ).rejects.toThrow(/Scene 99 not found/)
  })

  it("includes Method 3/8/10 mode-selection heuristic rows in the system prompt", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: fakeSceneNodeData,
      llmCallId: "x",
      costUsd: 0.08,
      inputTokens: 1300,
      outputTokens: 800,
    })

    await runSceneDirector({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      userId: "u1",
      sceneId: "scene-entity-1",
      plan: fakePlan,
      sceneIndex: 1,
      shotInputMode: "first_frame",
    })

    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    // Method 3 — video_continuation
    expect(call.systemPrompt).toContain("video_continuation")
    expect(call.systemPrompt).toContain("extends_shot_id")
    expect(call.systemPrompt).toMatch(/VEO \+ Seedance 2 family/)
    // Method 8 — frame_interpolation
    expect(call.systemPrompt).toContain("frame_interpolation")
    expect(call.systemPrompt).toContain("interpolation_keyframes")
    expect(call.systemPrompt).toMatch(/auto-mode falls back to first_frame/i)
    // Method 10 — camera_path
    expect(call.systemPrompt).toContain("camera_path")
    expect(call.systemPrompt).toContain("camera_path_directive")
    expect(call.systemPrompt).toMatch(/orbit, dolly, crane, arc, reveal/)
  })

  it("includes the provider-availability caveat (Methods 8/10 limited; same-scene extends_shot_id)", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: fakeSceneNodeData,
      llmCallId: "x",
      costUsd: 0.08,
      inputTokens: 1300,
      outputTokens: 800,
    })

    await runSceneDirector({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      userId: "u1",
      sceneId: "scene-entity-1",
      plan: fakePlan,
      sceneIndex: 1,
      shotInputMode: "first_frame",
    })

    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.systemPrompt).toMatch(/Methods 8 \(frame_interpolation\) and 10 \(camera_path\) are currently provider-limited/)
    expect(call.systemPrompt).toMatch(/extends_shot_id MUST reference a prior shot's shot_id within the same scene/)
  })

  it("injects critic feedback into user prompt when present", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue({
      output: fakeSceneNodeData,
      llmCallId: "x",
      costUsd: 0.08,
      inputTokens: 1300,
      outputTokens: 800,
    })

    await runSceneDirector({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      userId: "u1",
      sceneId: "scene-entity-1",
      plan: fakePlan,
      sceneIndex: 1,
      shotInputMode: "first_frame",
      criticFeedback: { verdict: "fail", issues: [{ description: "duration off" }] },
    })

    const call = (callLLM as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.userPrompt).toContain("PRIOR ATTEMPT WAS REJECTED BY THE SHOT LIST CRITIC")
    expect(call.userPrompt).toContain("duration off")
  })
})
