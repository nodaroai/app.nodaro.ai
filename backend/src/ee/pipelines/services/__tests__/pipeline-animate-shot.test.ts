import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"

vi.mock("../../../../lib/queue.js", () => ({
  videoQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock("../../../billing/credits.js", () => ({
  CreditsService: {
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-animate-1",
      creditsReserved: 22,
      watermark: false,
    }),
  },
}))

import { videoQueue } from "../../../../lib/queue.js"
import { CreditsService } from "../../../billing/credits.js"
import { pipelineAnimateShot } from "../pipeline-animate-shot.js"

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

function makeShot(overrides: Partial<ShotSpec> = {}): ShotSpec {
  return {
    shot_id: "shot_01",
    camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    shot_intensity_kind: "establishing_shot",
    action: "Hero walks down hallway",
    dialogue_line: null,
    duration_seconds: 5,
    motion_prompt: "slow dolly forward",
    start_state: "hero at hallway entrance",
    end_state: "hero mid-stride",
    continuity_with_previous: null,
    shot_intent: {
      needs_multishot_reference: false,
      is_loopable: false,
      needs_music_suppression: true,
      is_match_cut: false,
    },
    visual_keyframe_prompt: "Wide shot of dim hallway, hero in silhouette",
    ...overrides,
  } as ShotSpec
}

function makeSceneNodeData(overrides: Partial<SceneNodeData> = {}): SceneNodeData {
  return {
    scene_index: 1,
    description: "Opening scene",
    emotional_beat: "anticipation",
    duration_seconds: 8,
    shot_input_mode: "first_frame",
    cast_keys: ["hero"],
    location_key: "hallway",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "nano-banana-pro",
    video_model: "kling",
    shots: [makeShot()],
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
    ...overrides,
  } as SceneNodeData
}

function makeSupabaseMock(opts: {
  jobStates: Array<Record<string, unknown>>
  assetRow?: { id: string } | null
}) {
  let pollIdx = 0
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "jobs") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({ data: { id: "anim-job-1" }, error: null }),
            }),
          }),
          select: () => ({
            eq: () => ({
              maybeSingle: async () => {
                const idx = Math.min(pollIdx, opts.jobStates.length - 1)
                pollIdx += 1
                return { data: opts.jobStates[idx], error: null }
              },
            }),
          }),
        }
      }
      if (table === "assets") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: opts.assetRow ?? null, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return supabase as never
}

async function runUntilSettled<T>(p: Promise<T>, stepMs = 3500, maxSteps = 30): Promise<T> {
  for (let i = 0; i < maxSteps; i++) {
    let settled = false
    p.then(() => { settled = true }, () => { settled = true })
    await vi.advanceTimersByTimeAsync(stepMs)
    await Promise.resolve()
    if (settled) break
  }
  return p
}

describe("pipelineAnimateShot", () => {
  it("dispatches first_frame mode to image-to-video queue", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { videoUrl: "https://r2/anim.mp4" },
          credits_actual: 22,
        },
      ],
      assetRow: { id: "asset-anim-1" },
    })

    const promise = pipelineAnimateShot({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      shot: makeShot(),
      sceneNodeData: makeSceneNodeData({ shot_input_mode: "first_frame", video_model: "kling" }),
      startFrameUrl: "https://r2/kf.png",
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/anim.mp4")
    expect(result.assetId).toBe("asset-anim-1")
    expect(videoQueue.add).toHaveBeenCalledWith(
      "image-to-video",
      expect.objectContaining({
        jobId: "anim-job-1",
        imageUrl: "https://r2/kf.png",
        provider: "kling",
        duration: 5,
      }),
    )
    expect(CreditsService.reserveCredits).toHaveBeenCalledTimes(1)
  })

  it("dispatches text mode to text-to-video queue", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [
        {
          status: "completed",
          output_data: { videoUrl: "https://r2/text-anim.mp4" },
          credits_actual: 18,
        },
      ],
      assetRow: { id: "asset-anim-2" },
    })

    const promise = pipelineAnimateShot({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      shot: makeShot(),
      sceneNodeData: makeSceneNodeData({
        shot_input_mode: "text",
        video_model: "veo3.1",
      }),
      startFrameUrl: null,
    })
    const result = await runUntilSettled(promise)

    expect(result.assetUrl).toBe("https://r2/text-anim.mp4")
    expect(videoQueue.add).toHaveBeenCalledWith(
      "text-to-video",
      expect.objectContaining({
        jobId: "anim-job-1",
        provider: "veo3.1",
      }),
    )
  })

  it("throws when mode is deferred-to-1c3 (first_last_frame)", async () => {
    const supabase = makeSupabaseMock({ jobStates: [] })
    await expect(
      pipelineAnimateShot({
        supabase,
        pipelineId: "p1",
        pipelineEntityId: "scene-1",
        userId: "u1",
        shot: makeShot(),
        sceneNodeData: makeSceneNodeData({ shot_input_mode: "first_last_frame" }),
        startFrameUrl: "https://r2/kf.png",
      }),
    ).rejects.toThrow(/mode_unsupported_until_1c3:first_last_frame/)
  })

  it("throws when animate job fails", async () => {
    const supabase = makeSupabaseMock({
      jobStates: [{ status: "failed", error_message: "provider unavailable" }],
    })

    const promise = pipelineAnimateShot({
      supabase,
      pipelineId: "p1",
      pipelineEntityId: "scene-1",
      userId: "u1",
      shot: makeShot(),
      sceneNodeData: makeSceneNodeData({ shot_input_mode: "first_frame" }),
      startFrameUrl: "https://r2/kf.png",
    })
    promise.catch(() => undefined)
    await runUntilSettled(promise.then(() => undefined, () => undefined))
    await expect(promise).rejects.toThrow(/Job failed: provider unavailable/)
  })
})
