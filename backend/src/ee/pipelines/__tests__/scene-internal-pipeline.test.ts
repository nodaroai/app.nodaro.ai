import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"

// Mock service wrappers + Image Critic before importing the SUT. Paths are
// relative to the SUT (scene-internal-pipeline.ts), NOT this test file.
vi.mock("../services/pipeline-animate-shot.js", () => ({
  pipelineAnimateShot: vi.fn(),
}))
vi.mock("../services/pipeline-generate-speech.js", () => ({
  pipelineGenerateSpeech: vi.fn(),
}))
vi.mock("../services/pipeline-lip-sync.js", () => ({
  pipelineLipSync: vi.fn(),
}))
vi.mock("../services/pipeline-combine-videos.js", () => ({
  pipelineCombineVideos: vi.fn(),
}))
vi.mock("../continuity.js", () => ({
  extractLastFrame: vi.fn(),
}))
vi.mock("../llms/image-critic.js", () => ({
  runImageCritic: vi.fn(),
}))

import { runSceneInternalPipeline } from "../scene-internal-pipeline.js"
import { pipelineAnimateShot } from "../services/pipeline-animate-shot.js"
import { pipelineGenerateSpeech } from "../services/pipeline-generate-speech.js"
import { pipelineLipSync } from "../services/pipeline-lip-sync.js"
import { pipelineCombineVideos } from "../services/pipeline-combine-videos.js"
import { extractLastFrame } from "../continuity.js"
import { runImageCritic } from "../llms/image-critic.js"

beforeEach(() => vi.clearAllMocks())

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeShot(id: string, overrides: Partial<ShotSpec> = {}): ShotSpec {
  return {
    shot_id: id,
    camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    shot_intensity_kind: "establishing_shot",
    action: "x",
    dialogue_line: null,
    duration_seconds: 5,
    motion_prompt: "x",
    start_state: "x",
    end_state: "x",
    continuity_with_previous: null,
    shot_intent: {
      needs_multishot_reference: false,
      is_loopable: false,
      needs_music_suppression: true,
      is_match_cut: false,
    },
    visual_keyframe_prompt: `prompt for ${id}`,
    keyframe_url: `https://r2/kf-${id}.png`,
    keyframe_asset_id: `kf-asset-${id}`,
    ...overrides,
  } as ShotSpec
}

function makeSceneNodeData(
  shotCount: number,
  overrides: Partial<SceneNodeData> = {},
): SceneNodeData {
  return {
    scene_index: 1,
    description: "x",
    emotional_beat: "setup",
    duration_seconds: 10,
    shot_input_mode: "first_frame",
    cast_keys: [],
    location_key: "x",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "nano-banana-2",
    video_model: "kling",
    shots: Array.from({ length: shotCount }, (_, i) =>
      makeShot(`shot_${String(i + 1).padStart(2, "0")}`),
    ),
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
    ...overrides,
  } as SceneNodeData
}

function makeCtx() {
  return {
    supabase: {} as never,
    pipelineId: "p1",
    userId: "u1",
  }
}

function makeSceneEntity(metadata: { scene_node_data?: SceneNodeData }) {
  return { id: "scene-1", metadata }
}

// ─── Default mocks (override per-test as needed) ─────────────────────────────

function defaultAnimateSuccess(shotId: string) {
  return {
    jobId: `job-${shotId}`,
    assetId: `vid-asset-${shotId}`,
    assetUrl: `https://r2/vid-${shotId}.mp4`,
    creditsSpent: 25,
    videoModel: "kling",
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runSceneInternalPipeline", () => {
  it("sequential mode: animates N shots in order, extracts N-1 last_frames, combines once", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "last-frame-asset",
      url: "https://r2/lf.png",
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "combine-1",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    const sceneData = makeSceneNodeData(3)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: true },
    )

    expect(result.ok).toBe(true)
    expect(result.composite_video_asset_id).toBe("composite-asset")
    expect(result.composite_video_url).toBe("https://r2/composite.mp4")
    expect(result.per_shot_results).toHaveLength(3)
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(3)
    // Last shot doesn't need its last_frame extracted (no successor).
    expect(extractLastFrame).toHaveBeenCalledTimes(2)
    expect(pipelineCombineVideos).toHaveBeenCalledTimes(1)
    // No dialogue lines → no speech / lipsync.
    expect(pipelineGenerateSpeech).not.toHaveBeenCalled()
    expect(pipelineLipSync).not.toHaveBeenCalled()
    // Per-shot results MUST carry both video_url + last_frame_url for
    // shots 0..N-2 — the `fix_continuity` helper reads `prior.last_frame_url`
    // from the persisted scene data and would 500 without these.
    const shot0 = result.per_shot_results?.[0]
    expect(shot0?.video_url).toBe("https://r2/vid-shot_01.mp4")
    expect(shot0?.last_frame_url).toBe("https://r2/lf.png")
    const shot1 = result.per_shot_results?.[1]
    expect(shot1?.video_url).toBe("https://r2/vid-shot_02.mp4")
    expect(shot1?.last_frame_url).toBe("https://r2/lf.png")
    // Last shot has no last_frame extraction.
    const shot2 = result.per_shot_results?.[2]
    expect(shot2?.video_url).toBe("https://r2/vid-shot_03.mp4")
    expect(shot2?.last_frame_url).toBeNull()
  })

  it("parallel mode: fans out via settledWithLimit, no extract chain, no critic", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "combine-1",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    const sceneData = makeSceneNodeData(3)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "parallel", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(3)
    expect(extractLastFrame).not.toHaveBeenCalled()
    expect(runImageCritic).not.toHaveBeenCalled()
    expect(pipelineCombineVideos).toHaveBeenCalledTimes(1)
    // Per-shot results should record null last_frame_asset_id in parallel mode.
    for (const r of result.per_shot_results ?? []) {
      expect(r.last_frame_asset_id).toBeNull()
    }
  })

  it("continuity_break — Image Critic flags blocking continuity_break, scene short-circuits", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    ;(runImageCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      issues: [
        {
          type: "continuity_break",
          severity: "blocking",
          message: "Hero teleported across the room.",
        },
      ],
      notes: "Break in spatial continuity",
    })

    // 3 shots; shot_02 has continuity_with_previous set, so the gate fires.
    const sceneData = makeSceneNodeData(3, {
      shots: [
        makeShot("shot_01"),
        makeShot("shot_02", { continuity_with_previous: "Hero stays at door" }),
        makeShot("shot_03"),
      ],
    })
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: true },
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("continuity_break")
    // Shot 1 animated, then critic blocked before shot 2 animated.
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(1)
    expect(runImageCritic).toHaveBeenCalledTimes(1)
    expect(pipelineCombineVideos).not.toHaveBeenCalled()
    expect(result.per_shot_results).toHaveLength(1)
  })

  it("animate failure short-circuits the scene and surfaces animate_failed", async () => {
    let call = 0
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => {
        call++
        if (call === 2) throw new Error("KIE returned 500")
        return defaultAnimateSuccess(args.shot.shot_id)
      },
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })

    const sceneData = makeSceneNodeData(4)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("animate_failed")
    // 1 succeeded + 1 threw = 2 attempts.
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(2)
    expect(pipelineCombineVideos).not.toHaveBeenCalled()
    // Shot 1 made it to shotResults before shot 2 threw.
    expect(result.per_shot_results).toHaveLength(1)
  })

  it("shot without dialogue_line skips speech generation entirely", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    // 2 shots, only shot 2 has dialogue.
    const sceneData = makeSceneNodeData(2, {
      shots: [
        makeShot("shot_01", { dialogue_line: null }),
        makeShot("shot_02", { dialogue_line: "Hello there." }),
      ],
    })
    ;(pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "speech-1",
      assetId: "audio-asset",
      assetUrl: "https://r2/audio.mp3",
      creditsSpent: 4,
      audioDurationSec: 3.7,
    })

    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    expect(pipelineGenerateSpeech).toHaveBeenCalledTimes(1)
    // Lip-sync disabled.
    expect(pipelineLipSync).not.toHaveBeenCalled()
  })

  it("lipSyncEnabled: false skips lip-sync calls even when audio synth succeeded", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    ;(pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "speech-1",
      assetId: "audio-asset",
      assetUrl: "https://r2/audio.mp3",
      creditsSpent: 4,
      audioDurationSec: 3.7,
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    const sceneData = makeSceneNodeData(2, {
      shots: [
        makeShot("shot_01", { dialogue_line: "Line one." }),
        makeShot("shot_02", { dialogue_line: "Line two." }),
      ],
    })

    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    expect(pipelineGenerateSpeech).toHaveBeenCalledTimes(2)
    expect(pipelineLipSync).not.toHaveBeenCalled()
  })

  it("combine failure returns combine_failed and preserves shotResults", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ffmpeg out of memory"),
    )

    const sceneData = makeSceneNodeData(2)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(false)
    expect(result.reason).toBe("combine_failed")
    expect(result.per_shot_results).toHaveLength(2)
    expect(pipelineCombineVideos).toHaveBeenCalledTimes(1)
  })

  it("speech failure is non-blocking — animate continues, no audio for that shot, scene still completes", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    // Throw on every speech call — shouldn't fail the scene.
    ;(pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ElevenLabs 503"),
    )
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    const sceneData = makeSceneNodeData(2, {
      shots: [
        makeShot("shot_01", { dialogue_line: "Line one." }),
        makeShot("shot_02", { dialogue_line: "Line two." }),
      ],
    })

    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: true, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    expect(pipelineGenerateSpeech).toHaveBeenCalledTimes(2)
    // Lip-sync never fires because audio synth always failed.
    expect(pipelineLipSync).not.toHaveBeenCalled()
    // Scene still combined successfully.
    expect(pipelineCombineVideos).toHaveBeenCalledTimes(1)
    expect(result.composite_video_url).toBe("https://r2/composite.mp4")
  })

  it("scene_node_data missing → fails with scene_node_data_missing reason", async () => {
    const result = await runSceneInternalPipeline(
      makeCtx(),
      { id: "scene-1", metadata: {} },
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )
    expect(result.ok).toBe(false)
    expect(result.reason).toBe("scene_node_data_missing")
    expect(pipelineAnimateShot).not.toHaveBeenCalled()
  })

  it("lipsync replaces the shot's video in the combine input", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    ;(pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "s",
      assetId: "audio-asset",
      assetUrl: "https://r2/audio.mp3",
      creditsSpent: 4,
      audioDurationSec: 4.2,
    })
    ;(pipelineLipSync as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "ls",
      assetId: "lipsync-asset",
      assetUrl: "https://r2/lipsync.mp4",
      creditsSpent: 8,
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    const sceneData = makeSceneNodeData(2, {
      shots: [
        makeShot("shot_01", { dialogue_line: "Line one." }),
        makeShot("shot_02", { dialogue_line: null }),
      ],
    })

    await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: true, runImageCritic: false },
    )

    expect(pipelineLipSync).toHaveBeenCalledTimes(1)
    // Combine should receive the LIPSYNCED url for shot_01 and the raw
    // animate url for shot_02 (no dialogue → no lipsync).
    const combineArgs = (pipelineCombineVideos as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      videoUrls: string[]
    }
    expect(combineArgs.videoUrls[0]).toBe("https://r2/lipsync.mp4")
    expect(combineArgs.videoUrls[1]).toBe("https://r2/vid-shot_02.mp4")
  })

  it("dialogue: forwards character voice_match.voice_id to pipelineGenerateSpeech (partial fix)", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    ;(pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "speech-1",
      assetId: "audio-asset",
      assetUrl: "https://r2/audio.mp3",
      creditsSpent: 4,
      audioDurationSec: 3.7,
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    // Custom supabase mock: respond to the character voice_map lookup with
    // a single character whose voice_match.voice_id is "Adam".
    const supabase = {
      from: (table: string) => {
        if (table === "pipeline_entities") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  in: async () => ({
                    data: [
                      { entity_key: "hero", metadata: { voice_match: { voice_id: "Adam" } } },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        }
        throw new Error(`Unmocked table: ${table}`)
      },
    } as never

    const sceneData = makeSceneNodeData(1, {
      cast_keys: ["hero"],
      shots: [makeShot("shot_01", { dialogue_line: "I will not yield." })],
    })

    await runSceneInternalPipeline(
      { supabase, pipelineId: "p1", userId: "u1" },
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(pipelineGenerateSpeech).toHaveBeenCalledTimes(1)
    const args = (pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(args?.voice).toBe("Adam")
    expect(args?.text).toBe("I will not yield.")
  })

  it("dialogue: forwards actual audio duration to lip-sync and onto per-shot results (bug_003 fix)", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    // Speech returns real probed duration (2.3s); shot's planning duration is 5s.
    // Pre-bug_003, lip-sync received 5s; post-fix it must receive 2.3s.
    ;(pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "speech-1",
      assetId: "audio-asset",
      assetUrl: "https://r2/audio.mp3",
      creditsSpent: 4,
      audioDurationSec: 2.3,
    })
    ;(pipelineLipSync as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "ls",
      assetId: "ls-asset",
      assetUrl: "https://r2/ls.mp4",
      creditsSpent: 8,
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    const sceneData = makeSceneNodeData(1, {
      shots: [makeShot("shot_01", { dialogue_line: "Hello there." })],
    })

    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: true, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    // bug_003: lip-sync must receive the real audio duration (2.3s), not the
    // shot's planning duration (5s).
    expect(pipelineLipSync).toHaveBeenCalledTimes(1)
    const lsArgs = (pipelineLipSync as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(lsArgs?.audioDurationSec).toBe(2.3)
    // Per-shot result carries has_dialogue + actual_audio_duration_sec so
    // Stage 7 can persist them onto ShotSpec for the Editor LLM.
    const shot0 = result.per_shot_results?.[0]
    expect(shot0?.has_dialogue).toBe(true)
    expect(shot0?.actual_audio_duration_sec).toBe(2.3)
  })

  it("dialogue: shot without dialogue_line yields shotResult without has_dialogue flag", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    const sceneData = makeSceneNodeData(1, {
      shots: [makeShot("shot_01", { dialogue_line: null })],
    })

    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: true, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    expect(pipelineGenerateSpeech).not.toHaveBeenCalled()
    const shot0 = result.per_shot_results?.[0]
    // Neither field should be set — the animate path doesn't touch them, and
    // the dialogue loop skips this shot entirely.
    expect(shot0?.has_dialogue).toBeUndefined()
    expect(shot0?.actual_audio_duration_sec).toBeUndefined()
  })

  it("dialogue: forwards audioDurationSec=null when ffprobe fails — lip-sync falls through", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    // Probe failed inside pipelineGenerateSpeech — duration is null.
    ;(pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "speech-1",
      assetId: "audio-asset",
      assetUrl: "https://r2/audio.mp3",
      creditsSpent: 4,
      audioDurationSec: null,
    })
    ;(pipelineLipSync as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "ls",
      assetId: "ls-asset",
      assetUrl: "https://r2/ls.mp4",
      creditsSpent: 8,
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    const sceneData = makeSceneNodeData(1, {
      shots: [makeShot("shot_01", { dialogue_line: "Hello." })],
    })

    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: true, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    // Lip-sync receives undefined (NOT null, NOT shot duration) — the wrapper's
    // bucket lookup falls back to worst-case 5-min pricing per spec.
    const lsArgs = (pipelineLipSync as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(lsArgs?.audioDurationSec).toBeUndefined()
    const shot0 = result.per_shot_results?.[0]
    expect(shot0?.has_dialogue).toBe(true)
    expect(shot0?.actual_audio_duration_sec).toBeNull()
  })

  it("dialogue: omits voice when cast has no voice_match (falls through to worker default)", async () => {
    ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
    )
    ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      assetId: "lf",
      url: "https://r2/lf.png",
    })
    ;(pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "s",
      assetId: "a",
      assetUrl: "https://r2/a.mp3",
      creditsSpent: 4,
      audioDurationSec: null,
    })
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "c",
      assetId: "composite-asset",
      assetUrl: "https://r2/composite.mp4",
      creditsSpent: 0,
    })

    // Character row exists but has no voice_match.
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: async () => ({
                data: [{ entity_key: "hero", metadata: {} }],
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as never

    const sceneData = makeSceneNodeData(1, {
      cast_keys: ["hero"],
      shots: [makeShot("shot_01", { dialogue_line: "Anything." })],
    })

    await runSceneInternalPipeline(
      { supabase, pipelineId: "p1", userId: "u1" },
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    const args = (pipelineGenerateSpeech as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    // voice should be omitted entirely (not "undefined" string, not null).
    expect(args?.voice).toBeUndefined()
  })
})
