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

  // ─── Phase 1C.3 Method 3 — video_continuation ─────────────────────────
  describe("video_continuation (Method 3)", () => {
    it("dispatches to extend-video worker with kieTaskId for VEO", async () => {
      const supabase = makeSupabaseMock({
        jobStates: [
          {
            status: "completed",
            output_data: {
              videoUrl: "https://r2/ext.mp4",
              kieTaskId: "veo_ext_task_xyz",
            },
            credits_actual: 19,
          },
        ],
        assetRow: { id: "asset-ext-1" },
      })

      const promise = pipelineAnimateShot({
        supabase,
        pipelineId: "p1",
        pipelineEntityId: "scene-1",
        userId: "u1",
        shot: makeShot({ extends_shot_id: "shot_01" }),
        sceneNodeData: makeSceneNodeData({
          shot_input_mode: "video_continuation",
          video_model: "veo3.1",
        }),
        startFrameUrl: null,
        priorClipKieTaskId: "prior_task_abc",
      })
      const result = await runUntilSettled(promise)
      expect(result.assetUrl).toBe("https://r2/ext.mp4")
      expect(videoQueue.add).toHaveBeenCalledWith(
        "extend-video",
        expect.objectContaining({
          kieTaskId: "prior_task_abc",
          provider: "veo-extend",
          model: "fast",
        }),
      )
    })

    it("throws when extends_shot_id is missing", async () => {
      const supabase = makeSupabaseMock({ jobStates: [] })
      await expect(
        pipelineAnimateShot({
          supabase,
          pipelineId: "p1",
          pipelineEntityId: "scene-1",
          userId: "u1",
          shot: makeShot({ extends_shot_id: undefined }),
          sceneNodeData: makeSceneNodeData({
            shot_input_mode: "video_continuation",
            video_model: "veo3.1",
          }),
          startFrameUrl: null,
          priorClipKieTaskId: "prior_task_abc",
        }),
      ).rejects.toThrow(/video_continuation requires shot\.extends_shot_id/)
    })

    it("throws when priorClipKieTaskId is missing", async () => {
      const supabase = makeSupabaseMock({ jobStates: [] })
      await expect(
        pipelineAnimateShot({
          supabase,
          pipelineId: "p1",
          pipelineEntityId: "scene-1",
          userId: "u1",
          shot: makeShot({ extends_shot_id: "shot_01" }),
          sceneNodeData: makeSceneNodeData({
            shot_input_mode: "video_continuation",
            video_model: "veo3.1",
          }),
          startFrameUrl: null,
        }),
      ).rejects.toThrow(/video_continuation requires priorClipKieTaskId/)
    })

    it("seedance-2 dispatches to image-to-video with first_frame_url + reference_video_urls", async () => {
      const supabase = makeSupabaseMock({
        jobStates: [
          {
            status: "completed",
            output_data: { videoUrl: "https://r2/seedance-ext.mp4" },
            credits_actual: 23,
          },
        ],
        assetRow: { id: "asset-s2-ext-1" },
      })

      const promise = pipelineAnimateShot({
        supabase,
        pipelineId: "p1",
        pipelineEntityId: "scene-1",
        userId: "u1",
        shot: makeShot({
          extends_shot_id: "shot_01",
          action: "Hero turns toward the door",
          duration_seconds: 8,
        }),
        sceneNodeData: makeSceneNodeData({
          shot_input_mode: "video_continuation",
          video_model: "seedance-2",
        }),
        startFrameUrl: null,
        priorClipUrl: "https://r2/prior-clip.mp4",
        priorLastFrameUrl: "https://r2/prior-last-frame.png",
      })
      const result = await runUntilSettled(promise)
      expect(result.assetUrl).toBe("https://r2/seedance-ext.mp4")
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-video",
        expect.objectContaining({
          imageUrl: "https://r2/prior-last-frame.png",
          referenceVideoUrls: ["https://r2/prior-clip.mp4"],
          provider: "seedance-2",
          duration: 8,
          prompt: expect.stringMatching(
            /Hero turns toward the door Continue seamlessly from the previous clip, matching its motion, lighting, and style\./,
          ),
        }),
      )
    })

    it("seedance-2 throws when priorLastFrameUrl is missing", async () => {
      const supabase = makeSupabaseMock({ jobStates: [] })
      await expect(
        pipelineAnimateShot({
          supabase,
          pipelineId: "p1",
          pipelineEntityId: "scene-1",
          userId: "u1",
          shot: makeShot({ extends_shot_id: "shot_01" }),
          sceneNodeData: makeSceneNodeData({
            shot_input_mode: "video_continuation",
            video_model: "seedance-2",
          }),
          startFrameUrl: null,
          priorClipUrl: "https://r2/prior-clip.mp4",
        }),
      ).rejects.toThrow(/requires priorClipUrl \+ priorLastFrameUrl/)
    })

    it("seedance-2 throws when priorClipUrl is missing", async () => {
      const supabase = makeSupabaseMock({ jobStates: [] })
      await expect(
        pipelineAnimateShot({
          supabase,
          pipelineId: "p1",
          pipelineEntityId: "scene-1",
          userId: "u1",
          shot: makeShot({ extends_shot_id: "shot_01" }),
          sceneNodeData: makeSceneNodeData({
            shot_input_mode: "video_continuation",
            video_model: "seedance-2",
          }),
          startFrameUrl: null,
          priorLastFrameUrl: "https://r2/prior-last-frame.png",
        }),
      ).rejects.toThrow(/requires priorClipUrl \+ priorLastFrameUrl/)
    })

    it("seedance-2-fast routes the same as seedance-2", async () => {
      const supabase = makeSupabaseMock({
        jobStates: [
          {
            status: "completed",
            output_data: { videoUrl: "https://r2/seedance-fast-ext.mp4" },
            credits_actual: 16,
          },
        ],
        assetRow: { id: "asset-s2-fast-ext-1" },
      })

      const promise = pipelineAnimateShot({
        supabase,
        pipelineId: "p1",
        pipelineEntityId: "scene-1",
        userId: "u1",
        shot: makeShot({
          extends_shot_id: "shot_01",
          action: "Hero reaches the door",
          duration_seconds: 8,
        }),
        sceneNodeData: makeSceneNodeData({
          shot_input_mode: "video_continuation",
          video_model: "seedance-2-fast",
        }),
        startFrameUrl: null,
        priorClipUrl: "https://r2/prior-clip.mp4",
        priorLastFrameUrl: "https://r2/prior-last-frame.png",
      })
      const result = await runUntilSettled(promise)
      expect(result.assetUrl).toBe("https://r2/seedance-fast-ext.mp4")
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-video",
        expect.objectContaining({
          imageUrl: "https://r2/prior-last-frame.png",
          referenceVideoUrls: ["https://r2/prior-clip.mp4"],
          provider: "seedance-2-fast",
        }),
      )
    })
  })

  // ─── Phase 1C.3 Method 8 — frame_interpolation ────────────────────────
  describe("frame_interpolation (Method 8)", () => {
    it("throws provider_not_available in manual mode (stubbed provider)", async () => {
      const supabase = makeSupabaseMock({ jobStates: [] })
      await expect(
        pipelineAnimateShot({
          supabase,
          pipelineId: "p1",
          pipelineEntityId: "scene-1",
          userId: "u1",
          shot: makeShot({
            interpolation_keyframes: [
              { timestamp_sec: 0, prompt: "frame at start of scene" },
              { timestamp_sec: 4, prompt: "frame at end of scene" },
            ],
          }),
          sceneNodeData: makeSceneNodeData({
            shot_input_mode: "frame_interpolation",
            video_model: "rife",
          }),
          startFrameUrl: null,
          interpolationKeyframeUrls: ["https://r2/kf1.png", "https://r2/kf2.png"],
          pipelineMode: "manual",
        }),
      ).rejects.toThrow(/provider_not_available:rife/)
    })

    it("auto mode falls back to first_frame", async () => {
      const supabase = makeSupabaseMock({
        jobStates: [
          {
            status: "completed",
            output_data: { videoUrl: "https://r2/fallback.mp4" },
            credits_actual: 22,
          },
        ],
        assetRow: { id: "asset-fallback-1" },
      })
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

      const promise = pipelineAnimateShot({
        supabase,
        pipelineId: "p1",
        pipelineEntityId: "scene-1",
        userId: "u1",
        shot: makeShot({
          interpolation_keyframes: [
            { timestamp_sec: 0, prompt: "frame at start of scene" },
            { timestamp_sec: 4, prompt: "frame at end of scene" },
          ],
        }),
        sceneNodeData: makeSceneNodeData({
          shot_input_mode: "frame_interpolation",
          video_model: "kling",
        }),
        startFrameUrl: null,
        interpolationKeyframeUrls: ["https://r2/kf1.png", "https://r2/kf2.png"],
        pipelineMode: "auto",
      })
      const result = await runUntilSettled(promise)

      expect(result.assetUrl).toBe("https://r2/fallback.mp4")
      // Recursed into first_frame using the first sub-keyframe.
      expect(videoQueue.add).toHaveBeenCalledWith(
        "image-to-video",
        expect.objectContaining({ imageUrl: "https://r2/kf1.png" }),
      )
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/frame_interpolation skipped in auto mode/),
      )
      warnSpy.mockRestore()
    })

    it("throws when interpolation_keyframes is missing", async () => {
      const supabase = makeSupabaseMock({ jobStates: [] })
      await expect(
        pipelineAnimateShot({
          supabase,
          pipelineId: "p1",
          pipelineEntityId: "scene-1",
          userId: "u1",
          shot: makeShot(),
          sceneNodeData: makeSceneNodeData({
            shot_input_mode: "frame_interpolation",
            video_model: "rife",
          }),
          startFrameUrl: null,
        }),
      ).rejects.toThrow(/frame_interpolation requires ≥2 interpolation_keyframes/)
    })
  })

  // ─── Phase 1C.3 Method 10 — camera_path ───────────────────────────────
  describe("camera_path (Method 10)", () => {
    it("falls back to first_frame with amended prompt for non-SV3D models", async () => {
      const supabase = makeSupabaseMock({
        jobStates: [
          {
            status: "completed",
            output_data: { videoUrl: "https://r2/cam.mp4" },
            credits_actual: 22,
          },
        ],
        assetRow: { id: "asset-cam-1" },
      })

      const promise = pipelineAnimateShot({
        supabase,
        pipelineId: "p1",
        pipelineEntityId: "scene-1",
        userId: "u1",
        shot: makeShot({
          action: "Hero stands still",
          motion_prompt: "subtle motion",
          camera_path_directive: { path_kind: "orbit", parameters: { degrees: 270 } },
        }),
        sceneNodeData: makeSceneNodeData({
          shot_input_mode: "camera_path",
          video_model: "veo3.1",
        }),
        startFrameUrl: "https://r2/kf.png",
      })
      const result = await runUntilSettled(promise)

      expect(result.assetUrl).toBe("https://r2/cam.mp4")
      // The fallback amends motion_prompt with the orbit phrase.
      const addCall = (videoQueue.add as ReturnType<typeof vi.fn>).mock.calls.find(
        (c: unknown[]) => c[0] === "image-to-video",
      )
      expect(addCall).toBeDefined()
      const payload = (addCall as [string, Record<string, unknown>])[1]
      expect(payload.motionPrompt).toMatch(/orbits subject 270°/)
    })

    it("throws provider_not_available for SV3D (stubbed)", async () => {
      const supabase = makeSupabaseMock({ jobStates: [] })
      await expect(
        pipelineAnimateShot({
          supabase,
          pipelineId: "p1",
          pipelineEntityId: "scene-1",
          userId: "u1",
          shot: makeShot({
            camera_path_directive: { path_kind: "orbit" },
          }),
          sceneNodeData: makeSceneNodeData({
            shot_input_mode: "camera_path",
            video_model: "stable-video-3d",
          }),
          startFrameUrl: "https://r2/kf.png",
        }),
      ).rejects.toThrow(/provider_not_available:stable-video-3d/)
    })

    it("throws when camera_path_directive is missing", async () => {
      const supabase = makeSupabaseMock({ jobStates: [] })
      await expect(
        pipelineAnimateShot({
          supabase,
          pipelineId: "p1",
          pipelineEntityId: "scene-1",
          userId: "u1",
          shot: makeShot(),
          sceneNodeData: makeSceneNodeData({
            shot_input_mode: "camera_path",
            video_model: "veo3.1",
          }),
          startFrameUrl: "https://r2/kf.png",
        }),
      ).rejects.toThrow(/camera_path requires shot\.camera_path_directive/)
    })
  })
})

// ─── cameraPathToPromptAmendment ────────────────────────────────────────────
import { cameraPathToPromptAmendment } from "../pipeline-animate-shot.js"

describe("cameraPathToPromptAmendment", () => {
  it("orbit emits degrees", () => {
    expect(
      cameraPathToPromptAmendment({ path_kind: "orbit", parameters: { degrees: 180 } }),
    ).toBe("Camera orbits subject 180°.")
  })
  it("orbit defaults to 360°", () => {
    expect(cameraPathToPromptAmendment({ path_kind: "orbit" })).toBe(
      "Camera orbits subject 360°.",
    )
  })
  it("dolly emits direction", () => {
    expect(
      cameraPathToPromptAmendment({ path_kind: "dolly", parameters: { direction: "backward" } }),
    ).toBe("Camera dollies backward smoothly.")
  })
  it("crane emits direction", () => {
    expect(
      cameraPathToPromptAmendment({ path_kind: "crane", parameters: { direction: "downward" } }),
    ).toBe("Camera cranes downward revealing the scene.")
  })
  it("arc emits the smooth-curve phrase", () => {
    expect(cameraPathToPromptAmendment({ path_kind: "arc" })).toBe(
      "Camera arcs around the subject in a smooth curve.",
    )
  })
  it("reveal emits target", () => {
    expect(
      cameraPathToPromptAmendment({ path_kind: "reveal", parameters: { target: "the throne" } }),
    ).toBe("Camera moves to reveal the throne.")
  })
})
