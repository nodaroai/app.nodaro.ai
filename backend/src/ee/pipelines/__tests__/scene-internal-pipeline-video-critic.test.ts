import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SceneNodeData, ShotSpec, VideoCriticVerdict } from "@nodaro/shared"

// Mock service wrappers + critics before importing the SUT. Paths are relative
// to the SUT (scene-internal-pipeline.ts), NOT this test file.
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
  extractFramesForCritic: vi.fn(),
  allocateReferenceSlots: vi.fn().mockResolvedValue([]),
  prepareSceneRefContext: vi.fn().mockResolvedValue({ entitiesByTypeKey: new Map() }),
}))
vi.mock("../llms/image-critic.js", () => ({
  runImageCritic: vi.fn(),
}))
vi.mock("../llms/video-critic.js", () => ({
  runVideoCritic: vi.fn(),
}))

import { runSceneInternalPipeline } from "../scene-internal-pipeline.js"
import { pipelineAnimateShot } from "../services/pipeline-animate-shot.js"
import { pipelineCombineVideos } from "../services/pipeline-combine-videos.js"
import { extractFramesForCritic, extractLastFrame } from "../continuity.js"
import { runVideoCritic } from "../llms/video-critic.js"
import { pipelineEvents } from "../events.js"

beforeEach(() => vi.clearAllMocks())

// ─── Fixtures (same shape as scene-internal-pipeline.test.ts) ────────────────

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

function makeCtx(extra: Record<string, unknown> = {}) {
  return {
    supabase: {} as never,
    pipelineId: "p1",
    userId: "u1",
    stageId: "stage-7",
    videoCriticFrameMode: "first_last" as const,
    ...extra,
  }
}

function makeSceneEntity(metadata: { scene_node_data?: SceneNodeData }) {
  return { id: "scene-1", metadata }
}

function defaultAnimateSuccess(shotId: string) {
  return {
    jobId: `job-${shotId}`,
    assetId: `vid-asset-${shotId}`,
    assetUrl: `https://r2/vid-${shotId}.mp4`,
    creditsSpent: 25,
    videoModel: "kling",
  }
}

function passVerdict(): VideoCriticVerdict {
  return {
    verdict: "pass",
    prompt_adherence_score: 8,
    continuity_score: 7,
    identified_action: "Subject does the right thing.",
    issues: [],
  }
}

function failVerdict(
  overrides: Partial<VideoCriticVerdict> = {},
): VideoCriticVerdict {
  return {
    verdict: "fail",
    prompt_adherence_score: 3,
    continuity_score: 2,
    identified_action: "Subject does the wrong thing.",
    issues: [
      {
        severity: "blocking",
        category: "wrong_action",
        description: "Subject walks instead of running.",
        suggested_fix: "Keep the subject running, not walking.",
      },
    ],
    ...overrides,
  }
}

function setStandardMocks() {
  ;(pipelineAnimateShot as ReturnType<typeof vi.fn>).mockImplementation(
    async (args: { shot: ShotSpec }) => defaultAnimateSuccess(args.shot.shot_id),
  )
  ;(extractLastFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
    assetId: "lf-asset",
    url: "https://r2/lf.png",
  })
  // /simplify pass-2 — `extractFramesForCritic` now returns `lastFrameAssetId`
  // so the sequential animate caller can reuse it as the next-shot anchor
  // instead of firing a second extractLastFrame at the same timestamp.
  ;(extractFramesForCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
    frameUrls: ["https://r2/frame-first.png", "https://r2/frame-last.png"],
    lastFrameAssetId: "critic-last-frame-asset",
  })
  ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
    jobId: "combine-1",
    assetId: "composite-asset",
    assetUrl: "https://r2/composite.mp4",
    creditsSpent: 0,
  })
}

interface ShotMetaUpdate {
  shot_id: string
  video_critic_findings?: unknown
  video_critic_score?: number
  video_critic_continuity_score?: number | null
  video_critic_identified_action?: string
  video_critic_retry_count?: number
  video_critic_last_attempted_url?: string
  video_critic_failed?: boolean
}

describe("runSceneInternalPipeline — Phase 1D.2c-b-ii Video Critic", () => {
  it("critic passes first try → animate called once, shot persists score+findings (informational), video_critic_failed=false", async () => {
    setStandardMocks()
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: passVerdict(),
      llmCallId: "llm-1",
    })

    const sceneData = makeSceneNodeData(1)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    // Animate called exactly once for a 1-shot scene.
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(1)
    // Critic called exactly once.
    expect(runVideoCritic).toHaveBeenCalledTimes(1)

    // Persisted shot metadata MUST carry the findings even on pass (informational).
    const updatedShots = (result.updated_metadata as
      | { scene_node_data: { shots: ShotMetaUpdate[] } }
      | undefined)?.scene_node_data.shots
    expect(updatedShots).toBeDefined()
    const shot0 = updatedShots?.[0]
    expect(shot0?.shot_id).toBe("shot_01")
    expect(shot0?.video_critic_failed).toBe(false)
    expect(shot0?.video_critic_score).toBe(8)
    expect(shot0?.video_critic_continuity_score).toBe(7)
    expect(shot0?.video_critic_identified_action).toBe("Subject does the right thing.")
    expect(shot0?.video_critic_retry_count).toBe(0)
    expect(shot0?.video_critic_last_attempted_url).toBe(
      "https://r2/vid-shot_01.mp4",
    )
  })

  it("critic fails once then passes on retry → animate called twice (initial + retry), final shot persists retry_count=1, failed=false", async () => {
    setStandardMocks()
    let criticCall = 0
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      criticCall += 1
      return {
        verdict: criticCall === 1 ? failVerdict() : passVerdict(),
        llmCallId: `llm-${criticCall}`,
      }
    })

    const sceneData = makeSceneNodeData(1)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    // Initial + 1 retry.
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(2)
    expect(runVideoCritic).toHaveBeenCalledTimes(2)

    // The retry call's prompt MUST carry the feedback amendment (the verdict's
    // suggested_fix + identified_action surfaced into the shot's prompt).
    const retryCallArgs = (
      pipelineAnimateShot as ReturnType<typeof vi.fn>
    ).mock.calls[1]?.[0] as { shot: ShotSpec } | undefined
    expect(retryCallArgs?.shot.visual_keyframe_prompt).toContain("prompt for shot_01")
    expect(retryCallArgs?.shot.visual_keyframe_prompt).toContain(
      "Subject does the wrong thing.",
    )
    expect(retryCallArgs?.shot.visual_keyframe_prompt).toContain(
      "Keep the subject running, not walking.",
    )

    const updatedShots = (result.updated_metadata as
      | { scene_node_data: { shots: ShotMetaUpdate[] } }
      | undefined)?.scene_node_data.shots
    const shot0 = updatedShots?.[0]
    expect(shot0?.video_critic_failed).toBe(false)
    expect(shot0?.video_critic_retry_count).toBe(1)
    // Final findings reflect the PASSING verdict (empty issues).
    expect(shot0?.video_critic_score).toBe(8)
  })

  it("critic fails twice (cap exhausted) → shot persists video_critic_failed=true with findings, retry_count=1", async () => {
    setStandardMocks()
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: failVerdict(),
      llmCallId: "llm-fail",
    })

    const sceneData = makeSceneNodeData(1)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    // The scene as a whole still ok=true — video-critic failure marks the
    // SHOT failed but doesn't abort the scene.
    expect(result.ok).toBe(true)
    // Initial + cap=1 retry.
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(2)
    expect(runVideoCritic).toHaveBeenCalledTimes(2)

    const updatedShots = (result.updated_metadata as
      | { scene_node_data: { shots: ShotMetaUpdate[] } }
      | undefined)?.scene_node_data.shots
    const shot0 = updatedShots?.[0]
    expect(shot0?.video_critic_failed).toBe(true)
    expect(shot0?.video_critic_retry_count).toBe(1)
    expect(shot0?.video_critic_score).toBe(3)
    expect(shot0?.video_critic_continuity_score).toBe(2)
    const findings = shot0?.video_critic_findings as
      | ReadonlyArray<{ category: string; severity: string }>
      | undefined
    expect(findings).toBeDefined()
    expect(findings?.length).toBeGreaterThan(0)
    expect(findings?.[0]?.category).toBe("wrong_action")
  })

  it("verdict='pass' but prompt_adherence_score < MIN counts as a fail → retries fire", async () => {
    setStandardMocks()
    let criticCall = 0
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      criticCall += 1
      return {
        verdict:
          criticCall === 1
            ? {
                verdict: "pass" as const,
                prompt_adherence_score: 3,
                continuity_score: 8,
                identified_action: "Adherence below threshold.",
                issues: [],
              }
            : passVerdict(),
        llmCallId: `llm-${criticCall}`,
      }
    })

    const sceneData = makeSceneNodeData(1)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(2)
    expect(runVideoCritic).toHaveBeenCalledTimes(2)
    const updatedShots = (result.updated_metadata as
      | { scene_node_data: { shots: ShotMetaUpdate[] } }
      | undefined)?.scene_node_data.shots
    expect(updatedShots?.[0]?.video_critic_failed).toBe(false)
    expect(updatedShots?.[0]?.video_critic_retry_count).toBe(1)
  })

  it("verdict='pass' but continuity_score < MIN (when prior shot exists) counts as a fail → retries fire", async () => {
    setStandardMocks()
    let criticCall = 0
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      criticCall += 1
      // Shot 0: continuity_score is null (first shot) — passes.
      // Shot 1 first attempt: continuity_score=2 — fails.
      // Shot 1 retry: passes.
      if (criticCall === 1) {
        return {
          verdict: {
            verdict: "pass" as const,
            prompt_adherence_score: 9,
            continuity_score: null,
            identified_action: "first shot ok",
            issues: [],
          },
          llmCallId: `llm-${criticCall}`,
        }
      }
      if (criticCall === 2) {
        return {
          verdict: {
            verdict: "pass" as const,
            prompt_adherence_score: 9,
            continuity_score: 2,
            identified_action: "continuity broken",
            issues: [],
          },
          llmCallId: `llm-${criticCall}`,
        }
      }
      return { verdict: passVerdict(), llmCallId: `llm-${criticCall}` }
    })

    const sceneData = makeSceneNodeData(2)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    // 2 shots × 1 animate-base each + 1 retry for shot 1 = 3 animate calls.
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(3)
    // Shot 0: 1 critic. Shot 1: 2 critic. Total = 3.
    expect(runVideoCritic).toHaveBeenCalledTimes(3)

    const updatedShots = (result.updated_metadata as
      | { scene_node_data: { shots: ShotMetaUpdate[] } }
      | undefined)?.scene_node_data.shots
    expect(updatedShots?.[0]?.video_critic_retry_count).toBe(0)
    expect(updatedShots?.[1]?.video_critic_retry_count).toBe(1)
    expect(updatedShots?.[1]?.video_critic_failed).toBe(false)
  })

  it("first shot (no priorLastFrame) with continuity_score=null still passes when prompt_adherence_score >= MIN", async () => {
    setStandardMocks()
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: {
        verdict: "pass",
        prompt_adherence_score: 9,
        continuity_score: null,
        identified_action: "Subject does the thing.",
        issues: [],
      } satisfies VideoCriticVerdict,
      llmCallId: "llm-first",
    })

    const sceneData = makeSceneNodeData(1)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    // No retries — passes first try.
    expect(pipelineAnimateShot).toHaveBeenCalledTimes(1)
    expect(runVideoCritic).toHaveBeenCalledTimes(1)
    // The critic call for shot 0 MUST pass priorLastFrameUrl=null.
    const criticArgs = (runVideoCritic as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(criticArgs?.priorLastFrameUrl).toBeNull()

    const updatedShots = (result.updated_metadata as
      | { scene_node_data: { shots: ShotMetaUpdate[] } }
      | undefined)?.scene_node_data.shots
    expect(updatedShots?.[0]?.video_critic_failed).toBe(false)
    expect(updatedShots?.[0]?.video_critic_continuity_score).toBeNull()
  })

  it("critic infrastructure failure is non-fatal — shot retains original animate result and is NOT marked failed", async () => {
    setStandardMocks()
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("LLM service unavailable"),
    )
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    try {
      const sceneData = makeSceneNodeData(1)
      const result = await runSceneInternalPipeline(
        makeCtx(),
        makeSceneEntity({ scene_node_data: sceneData }),
        { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
      )

      // Scene still completes successfully.
      expect(result.ok).toBe(true)
      // Animate called only once — no retries fired because the critic itself
      // threw rather than returning a fail verdict.
      expect(pipelineAnimateShot).toHaveBeenCalledTimes(1)
      // A warning was logged.
      expect(warnSpy).toHaveBeenCalled()

      const updatedShots = (result.updated_metadata as
        | { scene_node_data: { shots: ShotMetaUpdate[] } }
        | undefined)?.scene_node_data.shots
      // Shot is NOT marked failed when the critic infrastructure threw — only
      // when a returned verdict says fail.
      const shot0 = updatedShots?.[0]
      expect(shot0?.video_critic_failed).toBeFalsy()
      // Original animate result preserved.
      const sceneShots = (result.updated_metadata as
        | { scene_node_data: { shots: Array<{ shot_id: string; video_url?: string }> } }
        | undefined)?.scene_node_data.shots
      expect(sceneShots?.[0]?.video_url).toBe("https://r2/vid-shot_01.mp4")
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("emits a shot:status SSE event per shot after critic finalises (pass → 'approved', fail → 'failed')", async () => {
    setStandardMocks()
    let criticCall = 0
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      criticCall += 1
      // shot 0 critic passes; shot 1 critic fails forever (uses both attempts).
      return {
        verdict: criticCall <= 1 ? passVerdict() : failVerdict(),
        llmCallId: `llm-${criticCall}`,
      }
    })

    const events: Array<{
      type: string
      shotId: string
      status: string
      sceneId: string
    }> = []
    const unsub = pipelineEvents.subscribe("p1", (e) => {
      if (e.type === "shot:status") {
        events.push({
          type: e.type,
          shotId: e.shotId,
          status: e.status,
          sceneId: e.sceneId,
        })
      }
    })

    try {
      const sceneData = makeSceneNodeData(2)
      await runSceneInternalPipeline(
        makeCtx(),
        makeSceneEntity({ scene_node_data: sceneData }),
        { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
      )
    } finally {
      unsub()
    }

    // One shot:status per shot.
    expect(events).toHaveLength(2)
    expect(events[0]?.shotId).toBe("shot_01")
    expect(events[0]?.status).toBe("approved")
    expect(events[1]?.shotId).toBe("shot_02")
    expect(events[1]?.status).toBe("failed")
    // sceneId routes to the scene entity.
    expect(events[0]?.sceneId).toBe("scene-1")
  })

  it("frame extraction failure is treated as critic-infrastructure failure (non-fatal, no retries fire)", async () => {
    setStandardMocks()
    ;(extractFramesForCritic as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ffmpeg out of memory"),
    )
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    try {
      const sceneData = makeSceneNodeData(1)
      const result = await runSceneInternalPipeline(
        makeCtx(),
        makeSceneEntity({ scene_node_data: sceneData }),
        { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
      )

      expect(result.ok).toBe(true)
      // Animate succeeded; critic never reached.
      expect(pipelineAnimateShot).toHaveBeenCalledTimes(1)
      expect(runVideoCritic).not.toHaveBeenCalled()
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  // /simplify pass-2 — duplicate last-frame extraction
  it("reuse path — critic returned a last-frame asset → extractLastFrame is NOT called for the same shot", async () => {
    setStandardMocks()
    ;(runVideoCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: passVerdict(),
      llmCallId: "llm-1",
    })

    const sceneData = makeSceneNodeData(2)
    const result = await runSceneInternalPipeline(
      makeCtx(),
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    // 2 shots × 1 critic each = 2 extractFramesForCritic calls.
    expect(extractFramesForCritic).toHaveBeenCalledTimes(2)
    // CRITICAL: extractLastFrame should NOT be called for shot 0 — the
    // critic's `extractFramesForCritic` already extracted it at the same
    // timestamp. The final shot (shot 1) never extracts a last frame
    // anyway (no downstream shot in the scene).
    expect(extractLastFrame).not.toHaveBeenCalled()

    // The per-shot result for shot 0 should carry the critic's last-frame
    // asset id + URL (NOT extractLastFrame's "lf-asset" / "lf.png").
    const shotResults = result.per_shot_results ?? []
    expect(shotResults[0]?.last_frame_asset_id).toBe("critic-last-frame-asset")
    expect(shotResults[0]?.last_frame_url).toBe("https://r2/frame-last.png")
  })

  it("fallback path — critic disabled (no stageId) → extractLastFrame is called as before", async () => {
    setStandardMocks()
    // No critic mocking needed — the guard returns before runVideoCritic.

    const sceneData = makeSceneNodeData(2)
    const result = await runSceneInternalPipeline(
      // makeCtx without stageId → critic disabled.
      { supabase: {} as never, pipelineId: "p1", userId: "u1" },
      makeSceneEntity({ scene_node_data: sceneData }),
      { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
    )

    expect(result.ok).toBe(true)
    // Critic never ran → no extractFramesForCritic, no runVideoCritic.
    expect(extractFramesForCritic).not.toHaveBeenCalled()
    expect(runVideoCritic).not.toHaveBeenCalled()
    // The original extractLastFrame path is the SOLE source of the chain
    // anchor when the critic is off. Called once for shot 0 (final shot
    // skipped).
    expect(extractLastFrame).toHaveBeenCalledTimes(1)

    const shotResults = result.per_shot_results ?? []
    expect(shotResults[0]?.last_frame_asset_id).toBe("lf-asset")
    expect(shotResults[0]?.last_frame_url).toBe("https://r2/lf.png")
  })

  it("reuse path — when critic threw before first extract → falls through to extractLastFrame", async () => {
    setStandardMocks()
    // The critic's extract throws — `lastFrameAsset` stays null in the loop
    // result, so the caller takes the fallback extractLastFrame path.
    ;(extractFramesForCritic as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("ffmpeg out of memory"),
    )
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    try {
      const sceneData = makeSceneNodeData(2)
      const result = await runSceneInternalPipeline(
        makeCtx(),
        makeSceneEntity({ scene_node_data: sceneData }),
        { mode: "sequential", lipSyncEnabled: false, runImageCritic: false },
      )

      expect(result.ok).toBe(true)
      // Critic loop ran (2 attempts at extract = 2 calls).
      expect(extractFramesForCritic).toHaveBeenCalledTimes(2)
      // Fallback path fired for shot 0 (final shot skipped as usual).
      expect(extractLastFrame).toHaveBeenCalledTimes(1)
      const shotResults = result.per_shot_results ?? []
      expect(shotResults[0]?.last_frame_asset_id).toBe("lf-asset")
    } finally {
      warnSpy.mockRestore()
    }
  })
})
