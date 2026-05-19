import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../call-llm.js", () => ({ callLLM: vi.fn() }))

import { callLLM } from "../call-llm.js"
import {
  runShotListCritic,
  validateMethod3_8_10Eligibility,
} from "../shot-list-critic.js"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"

beforeEach(() => vi.clearAllMocks())

const fakeSceneNodeData: SceneNodeData = {
  scene_index: 1,
  description: "x",
  emotional_beat: "setup",
  duration_seconds: 30,
  shot_input_mode: "first_frame",
  cast_keys: [],
  location_key: "carrier",
  object_keys: [],
  continuity_from_prev: "hard_cut",
  image_model: "nano-banana-2",
  video_model: "kling",
  shots: [],
  scene_anchor_keyframe: null,
  generated_keyframes: [],
  generated_clips: [],
  composite_video: null,
  last_frame: null,
  scene_audio_track: null,
} as unknown as SceneNodeData

// Default LLM-pass response — many tests need this, only override when relevant.
const llmPassResponse = {
  output: {
    verdict: "pass" as const,
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
}

describe("runShotListCritic", () => {
  it("uses critic role + Sonnet + shot_list task + sceneId", async () => {
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(llmPassResponse)

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

  it("merges deterministic eligibility issues into the verdict and forces fail on blocking", async () => {
    // LLM returns a pass verdict, but we hand it a camera_path scene with a
    // missing directive — the deterministic check should flip verdict to fail.
    ;(callLLM as ReturnType<typeof vi.fn>).mockResolvedValue(llmPassResponse)

    const sceneData = {
      ...fakeSceneNodeData,
      shot_input_mode: "camera_path",
      video_model: "stable-video-3d",
      shots: [
        {
          shot_id: "shot_01",
          camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
          shot_intensity_kind: "establishing_shot",
          action: "x",
          dialogue_line: null,
          duration_seconds: 5,
          motion_prompt: "orbit",
          start_state: "a",
          end_state: "b",
          continuity_with_previous: null,
          shot_intent: {
            needs_multishot_reference: false,
            is_loopable: false,
            needs_music_suppression: true,
            is_match_cut: false,
          },
          visual_keyframe_prompt: "subject in 3D space",
          // NOTE: no camera_path_directive — should trip the deterministic check
        },
      ],
    } as unknown as SceneNodeData

    const result = await runShotListCritic({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s5",
      sceneId: "scene-entity-1",
      userId: "u1",
      sceneNodeData: sceneData,
    })

    expect(result.verdict).toBe("fail")
    expect(result.issues.some((i) => i.issue_type === "camera_path_eligibility")).toBe(true)
  })
})

// ─── validateMethod3_8_10Eligibility — pure-function unit tests ─────────────

const baseShot = (overrides: Partial<ShotSpec> = {}): ShotSpec =>
  ({
    shot_id: "shot_01",
    camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    shot_intensity_kind: "establishing_shot",
    action: "x",
    dialogue_line: null,
    duration_seconds: 5,
    motion_prompt: "static",
    start_state: "a",
    end_state: "b",
    continuity_with_previous: null,
    shot_intent: {
      needs_multishot_reference: false,
      is_loopable: false,
      needs_music_suppression: true,
      is_match_cut: false,
    },
    visual_keyframe_prompt: "wide cinematic shot of a runway",
    has_dialogue: false,
    ...overrides,
  }) as ShotSpec

const baseScene = (overrides: Partial<SceneNodeData> = {}): SceneNodeData =>
  ({
    ...fakeSceneNodeData,
    shots: [baseShot()],
    ...overrides,
  }) as unknown as SceneNodeData

describe("validateMethod3_8_10Eligibility — video_continuation (Method 3)", () => {
  it("passes when video_model supports extension and extends_shot_id resolves within scene", () => {
    const scene = baseScene({
      shot_input_mode: "video_continuation" as never,
      video_model: "seedance-2",
      shots: [
        baseShot({ shot_id: "shot_01" }),
        baseShot({ shot_id: "shot_02", extends_shot_id: "shot_01" }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues).toEqual([])
  })

  it("rejects when prior shot's video_model lacks supportsVideoExtension", () => {
    const scene = baseScene({
      shot_input_mode: "video_continuation" as never,
      video_model: "kling", // no supportsVideoExtension
      shots: [
        baseShot({ shot_id: "shot_01" }),
        baseShot({ shot_id: "shot_02", extends_shot_id: "shot_01" }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0]!.issue_type).toBe("video_continuation_eligibility")
    expect(issues[0]!.description).toMatch(/video_model to support extension/i)
    expect(issues[0]!.severity).toBe("blocking")
  })

  it("rejects when extends_shot_id is missing on shot N>0", () => {
    const scene = baseScene({
      shot_input_mode: "video_continuation" as never,
      video_model: "veo3.1",
      shots: [
        baseShot({ shot_id: "shot_01" }),
        baseShot({ shot_id: "shot_02" /* no extends_shot_id */ }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.some((i) => i.issue_type === "video_continuation_eligibility")).toBe(true)
    expect(issues.find((i) => i.shot_id === "shot_02")!.description).toMatch(/extends_shot_id is missing/i)
  })

  it("rejects when extends_shot_id references a shot not in this scene (cross-scene)", () => {
    const scene = baseScene({
      shot_input_mode: "video_continuation" as never,
      video_model: "veo3.1",
      shots: [
        baseShot({ shot_id: "shot_01" }),
        baseShot({ shot_id: "shot_02", extends_shot_id: "shot_99_other_scene" }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.some((i) => i.issue_type === "video_continuation_eligibility")).toBe(true)
    expect(issues.find((i) => i.shot_id === "shot_02")!.description).toMatch(/does not resolve to any shot/i)
  })

  it("allows shot_01 to skip extends_shot_id (it's the scene entry)", () => {
    const scene = baseScene({
      shot_input_mode: "video_continuation" as never,
      video_model: "veo3.1",
      shots: [baseShot({ shot_id: "shot_01" /* no extends_shot_id, ok for first */ })],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues).toEqual([])
  })
})

describe("validateMethod3_8_10Eligibility — frame_interpolation (Method 8)", () => {
  it("passes when ≥2 monotonic keyframes are present and model supports interpolation", () => {
    const scene = baseScene({
      shot_input_mode: "frame_interpolation" as never,
      video_model: "rife",
      shots: [
        baseShot({
          shot_id: "shot_01",
          duration_seconds: 3,
          interpolation_keyframes: [
            { timestamp_sec: 0, prompt: "character draws sword from sheath" },
            { timestamp_sec: 1.5, prompt: "sword reaches apex above head" },
            { timestamp_sec: 3, prompt: "sword strikes downward" },
          ],
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues).toEqual([])
  })

  it("rejects when fewer than 2 keyframes are provided", () => {
    const scene = baseScene({
      shot_input_mode: "frame_interpolation" as never,
      video_model: "rife",
      shots: [
        baseShot({
          shot_id: "shot_01",
          duration_seconds: 3,
          interpolation_keyframes: [
            { timestamp_sec: 0, prompt: "first and only keyframe" },
          ],
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.some((i) => i.issue_type === "frame_interpolation_eligibility")).toBe(true)
    expect(issues[0]!.description).toMatch(/requires ≥2 interpolation_keyframes/)
  })

  it("rejects when keyframes are not monotonic ascending", () => {
    const scene = baseScene({
      shot_input_mode: "frame_interpolation" as never,
      video_model: "rife",
      shots: [
        baseShot({
          shot_id: "shot_01",
          duration_seconds: 3,
          interpolation_keyframes: [
            { timestamp_sec: 0, prompt: "a" },
            { timestamp_sec: 2, prompt: "b" },
            { timestamp_sec: 1, prompt: "out of order" },
          ],
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.some((i) => /monotonic/.test(i.description))).toBe(true)
  })

  it("rejects when first keyframe timestamp_sec is not 0", () => {
    const scene = baseScene({
      shot_input_mode: "frame_interpolation" as never,
      video_model: "rife",
      shots: [
        baseShot({
          shot_id: "shot_01",
          duration_seconds: 3,
          interpolation_keyframes: [
            { timestamp_sec: 0.5, prompt: "should-be-zero" },
            { timestamp_sec: 2, prompt: "b" },
          ],
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.some((i) => /first interpolation keyframe must be at timestamp_sec=0/.test(i.description))).toBe(true)
  })

  it("rejects when last keyframe timestamp exceeds shot duration", () => {
    const scene = baseScene({
      shot_input_mode: "frame_interpolation" as never,
      video_model: "rife",
      shots: [
        baseShot({
          shot_id: "shot_01",
          duration_seconds: 3,
          interpolation_keyframes: [
            { timestamp_sec: 0, prompt: "a" },
            { timestamp_sec: 5, prompt: "past end" },
          ],
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.some((i) => /exceeds duration_seconds/.test(i.description))).toBe(true)
  })

  it("rejects when video_model does not support frame interpolation", () => {
    const scene = baseScene({
      shot_input_mode: "frame_interpolation" as never,
      video_model: "kling", // no maxInterpolationKeyframes
      shots: [
        baseShot({
          shot_id: "shot_01",
          duration_seconds: 3,
          interpolation_keyframes: [
            { timestamp_sec: 0, prompt: "a" },
            { timestamp_sec: 3, prompt: "b" },
          ],
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.some((i) => /supportsFrameInterpolation/.test(i.description))).toBe(true)
  })
})

describe("validateMethod3_8_10Eligibility — camera_path (Method 10)", () => {
  it("passes when camera_path_directive is present with a valid path_kind", () => {
    const scene = baseScene({
      shot_input_mode: "camera_path" as never,
      video_model: "stable-video-3d",
      shots: [
        baseShot({
          shot_id: "shot_01",
          camera_path_directive: { path_kind: "orbit" },
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues).toEqual([])
  })

  it("rejects when camera_path_directive is missing", () => {
    const scene = baseScene({
      shot_input_mode: "camera_path" as never,
      video_model: "stable-video-3d",
      shots: [baseShot({ shot_id: "shot_01" /* no directive */ })],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.length).toBe(1)
    expect(issues[0]!.issue_type).toBe("camera_path_eligibility")
    expect(issues[0]!.description).toMatch(/camera_path_directive is missing/)
  })

  it("rejects when path_kind is not in the allowed set", () => {
    const scene = baseScene({
      shot_input_mode: "camera_path" as never,
      video_model: "stable-video-3d",
      shots: [
        baseShot({
          shot_id: "shot_01",
          // @ts-expect-error — deliberately wrong value to exercise the gate
          camera_path_directive: { path_kind: "spiral" },
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues.length).toBe(1)
    expect(issues[0]!.description).toMatch(/path_kind ∈ \{orbit, dolly, crane, arc, reveal\}/)
  })

  it("allows camera_path on any video model (text-prompt fallback works universally)", () => {
    // Use kling — has NO supportsCameraPath flag — should still pass the
    // eligibility check because Method 10 falls back to text-prompt.
    const scene = baseScene({
      shot_input_mode: "camera_path" as never,
      video_model: "kling",
      shots: [
        baseShot({
          shot_id: "shot_01",
          camera_path_directive: { path_kind: "dolly" },
        }),
      ],
    })
    const issues = validateMethod3_8_10Eligibility(scene)
    expect(issues).toEqual([])
  })
})
