import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock runValidateMatchCut before importing the SUT. Path is relative to the
// SUT (`match-cut-orchestrator.ts`), NOT to this test file.
vi.mock("../llms/helpers/validate-match-cut.js", () => ({
  runValidateMatchCut: vi.fn(),
}))

import { runValidateMatchCut } from "../llms/helpers/validate-match-cut.js"
import { runMatchCutOrchestrator } from "../match-cut-orchestrator.js"
import type { SceneNodeData } from "@nodaro/shared"

// ─── Fixtures ────────────────────────────────────────────────────────────────

const mockRunValidateMatchCut = vi.mocked(runValidateMatchCut)

const fakePlan = {
  title: "Test Film",
  logline: "A story",
  target_duration_seconds: 60,
  format: "short_film" as const,
  output_resolution: "1080p" as const,
  language: "en",
  genre: "drama",
  tone: [],
  cast: [],
  locations: [],
  objects: [],
  scenes: [],
  beats: [],
  has_narrator: false,
  narrator_profile: null,
  music_plan: { mood: "tense", bpm_target: 120, genre_hints: [] },
  global_style: {
    visual_style: "cinematic",
    color_palette: "desaturated",
    lighting: "natural",
    camera_language: "handheld",
  },
  total_duration_seconds: 60,
  estimated_scene_count: 1,
  warnings: [],
}

const fakeSupabase = {} as Parameters<typeof runMatchCutOrchestrator>[0]["supabase"]

function makeShot(
  id: string,
  opts: {
    is_match_cut?: boolean
    keyframe_url?: string
    accepted_match_cut_break?: boolean
  } = {},
) {
  return {
    shot_id: id,
    camera: { shot_type: "wide" as const, angle: "eye_level" as const, motion: "static" as const },
    shot_intensity_kind: "establishing_shot" as const,
    action: "Character action",
    dialogue_line: null,
    duration_seconds: 3,
    motion_prompt: "slow push",
    start_state: "state_start",
    end_state: "state_end",
    continuity_with_previous: null,
    shot_intent: {
      needs_multishot_reference: false,
      is_loopable: false,
      needs_music_suppression: true,
      is_match_cut: opts.is_match_cut ?? false,
    },
    visual_keyframe_prompt: `prompt for ${id}`,
    has_dialogue: false,
    keyframe_url: opts.keyframe_url,
    accepted_match_cut_break: opts.accepted_match_cut_break,
  }
}

function makeSceneNodeData(shots: ReturnType<typeof makeShot>[]): SceneNodeData {
  return {
    scene_index: 1,
    description: "A pivotal scene",
    emotional_beat: "climax",
    duration_seconds: 10,
    shot_input_mode: "first_frame",
    cast_keys: [],
    location_key: "loc_01",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "nano-banana-2",
    video_model: "kling",
    shots,
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
  } as SceneNodeData
}

function makeArgs(scene: SceneNodeData) {
  return {
    supabase: fakeSupabase,
    pipelineId: "pipe_abc",
    stageId: "stage_06",
    sceneId: "scene_01",
    userId: "user_01",
    plan: fakePlan as unknown as Parameters<typeof runMatchCutOrchestrator>[0]["plan"],
    scene,
  }
}

function fakeVerdict(shotPair: [string, string], strength: "strong" | "moderate" | "weak" | "break") {
  return {
    scene_id: "scene_01",
    shot_pair: shotPair,
    match_strength: strength,
    critic_verdict: { ok: true, issues: [], notes: "" },
    suggested_adjustments: "Keep the door frame centered.",
  }
}

beforeEach(() => vi.clearAllMocks())

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("runMatchCutOrchestrator (Phase 1D.1 Method 7)", () => {
  it("runs the critic for each unaccepted match-cut shot and returns verdicts", async () => {
    const shots = [
      makeShot("shot_01", { is_match_cut: true, keyframe_url: "https://r2.example.com/kf01.jpg" }),
      makeShot("shot_02", { keyframe_url: "https://r2.example.com/kf02.jpg" }),
      makeShot("shot_03", { is_match_cut: true, keyframe_url: "https://r2.example.com/kf03.jpg" }),
      makeShot("shot_04", { keyframe_url: "https://r2.example.com/kf04.jpg" }),
    ]
    const scene = makeSceneNodeData(shots)

    mockRunValidateMatchCut
      .mockResolvedValueOnce(fakeVerdict(["shot_01", "shot_02"], "strong"))
      .mockResolvedValueOnce(fakeVerdict(["shot_03", "shot_04"], "moderate"))

    const result = await runMatchCutOrchestrator(makeArgs(scene))

    expect(mockRunValidateMatchCut).toHaveBeenCalledTimes(2)
    expect(mockRunValidateMatchCut).toHaveBeenCalledWith(
      expect.objectContaining({ targetShotId: "shot_01" }),
    )
    expect(mockRunValidateMatchCut).toHaveBeenCalledWith(
      expect.objectContaining({ targetShotId: "shot_03" }),
    )
    expect(Object.keys(result.verdicts)).toHaveLength(2)
    expect(result.verdicts["shot_01"]!.match_strength).toBe("strong")
    expect(result.verdicts["shot_03"]!.match_strength).toBe("moderate")
    expect(result.pendingBreaks).toHaveLength(0)
  })

  it("collects 'break' verdicts into pendingBreaks", async () => {
    const shots = [
      makeShot("shot_01", { is_match_cut: true, keyframe_url: "https://r2.example.com/kf01.jpg" }),
      makeShot("shot_02", { keyframe_url: "https://r2.example.com/kf02.jpg" }),
    ]
    const scene = makeSceneNodeData(shots)

    mockRunValidateMatchCut.mockResolvedValueOnce(fakeVerdict(["shot_01", "shot_02"], "break"))

    const result = await runMatchCutOrchestrator(makeArgs(scene))

    expect(result.verdicts["shot_01"]!.match_strength).toBe("break")
    expect(result.pendingBreaks).toEqual(["shot_01"])
  })

  it("skips shots with accepted_match_cut_break=true", async () => {
    const shots = [
      makeShot("shot_01", {
        is_match_cut: true,
        keyframe_url: "https://r2.example.com/kf01.jpg",
        accepted_match_cut_break: true, // user already accepted — skip
      }),
      makeShot("shot_02", { keyframe_url: "https://r2.example.com/kf02.jpg" }),
    ]
    const scene = makeSceneNodeData(shots)

    const result = await runMatchCutOrchestrator(makeArgs(scene))

    expect(mockRunValidateMatchCut).not.toHaveBeenCalled()
    expect(result.verdicts).toEqual({})
    expect(result.pendingBreaks).toHaveLength(0)
  })

  it("skips the last shot even when is_match_cut=true (no next shot to pair with)", async () => {
    const shots = [
      makeShot("shot_01", { keyframe_url: "https://r2.example.com/kf01.jpg" }),
      // Last shot flagged as match_cut — should be skipped (no next)
      makeShot("shot_02", {
        is_match_cut: true,
        keyframe_url: "https://r2.example.com/kf02.jpg",
      }),
    ]
    const scene = makeSceneNodeData(shots)

    const result = await runMatchCutOrchestrator(makeArgs(scene))

    expect(mockRunValidateMatchCut).not.toHaveBeenCalled()
    expect(result.verdicts).toEqual({})
    expect(result.pendingBreaks).toHaveLength(0)
  })
})
