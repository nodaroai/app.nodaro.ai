import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../image-critic.js", () => ({ runImageCritic: vi.fn() }))
vi.mock("../../../services/pipeline-generate-image.js", () => ({
  pipelineGenerateImage: vi.fn(),
}))

import { runImageCritic } from "../../image-critic.js"
import { pipelineGenerateImage } from "../../../services/pipeline-generate-image.js"
import { runFixContinuity } from "../fix-continuity.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  global_style: { visual_style: "x", color_palette: "x", lighting: "x", camera_language: "x" },
} as never

function shot(opts: {
  id: string
  keyframeUrl?: string
  lastFrameUrl?: string
}) {
  return {
    shot_id: opts.id,
    keyframe_url: opts.keyframeUrl,
    last_frame_url: opts.lastFrameUrl,
    visual_keyframe_prompt: `prompt for ${opts.id}`,
    start_state: `start of ${opts.id}`,
    end_state: `end of ${opts.id}`,
    continuity_with_previous: "hero arm matches end of prior",
  }
}

describe("runFixContinuity", () => {
  it("happy path — continuity_break detected: regenerates keyframe via pipelineGenerateImage", async () => {
    const mockedCritic = runImageCritic as ReturnType<typeof vi.fn>
    mockedCritic.mockResolvedValue({
      ok: false,
      issues: [
        {
          type: "continuity_break",
          severity: "blocking",
          message: "Hero teleports between shots.",
          suggested_fix: "Regen with prior last frame as anchor.",
        },
      ],
      notes: "Continuity broken.",
    })
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "asset-new",
      assetUrl: "https://r2/regen.png",
      creditsSpent: 2,
    })

    const result = await runFixContinuity({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s7",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: {
        description: "x",
        emotional_beat: "x",
        image_model: "nano-banana-2",
        shots: [
          shot({ id: "shot_01", keyframeUrl: "https://r2/k1.png", lastFrameUrl: "https://r2/lf1.png" }),
          shot({ id: "shot_02", keyframeUrl: "https://r2/k2.png" }),
        ],
      } as never,
      targetShotId: "shot_02",
    })

    expect(result.action).toBe("regenerated")
    expect(result.new_keyframe_url).toBe("https://r2/regen.png")
    expect(result.new_keyframe_asset_id).toBe("asset-new")
    expect(result.critic_verdict.ok).toBe(false)
    expect(result.target_shot_id).toBe("shot_02")
    expect(result.scene_id).toBe("scene-1")

    // Critic received the prior last_frame for continuity check
    const criticArgs = mockedCritic.mock.calls[0][0]
    expect(criticArgs.priorLastFrameUrl).toBe("https://r2/lf1.png")
    expect(criticArgs.invokedVia).toBe("helper:fix_continuity")
    expect(criticArgs.shotId).toBe("shot_02")

    // Regen used prior last_frame as the only reference + scene's image_model
    const regenArgs = (pipelineGenerateImage as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(regenArgs.referenceImageUrls).toEqual(["https://r2/lf1.png"])
    expect(regenArgs.modelIdentifier).toBe("nano-banana-2")
    expect(regenArgs.prompt).toBe("prompt for shot_02")
  })

  it("no_action_needed — when critic returns ok=true, regen is skipped", async () => {
    const mockedCritic = runImageCritic as ReturnType<typeof vi.fn>
    mockedCritic.mockResolvedValue({ ok: true, issues: [], notes: "Keyframe continuity is fine." })

    const result = await runFixContinuity({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s7",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: {
        description: "x",
        emotional_beat: "x",
        image_model: "nano-banana",
        shots: [
          shot({ id: "shot_01", keyframeUrl: "https://r2/k1.png", lastFrameUrl: "https://r2/lf1.png" }),
          shot({ id: "shot_02", keyframeUrl: "https://r2/k2.png" }),
        ],
      } as never,
      targetShotId: "shot_02",
    })

    expect(result.action).toBe("no_action_needed")
    expect(result.new_keyframe_url).toBeUndefined()
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
  })

  it("throws when target_shot_id is the first shot (no prior to bridge from)", async () => {
    await expect(
      runFixContinuity({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s7",
        sceneId: "scene-1",
        userId: "u1",
        plan: fakePlan,
        scene: {
          shots: [
            shot({ id: "shot_01", keyframeUrl: "https://r2/k1.png" }),
            shot({ id: "shot_02", keyframeUrl: "https://r2/k2.png" }),
          ],
        } as never,
        targetShotId: "shot_01",
      }),
    ).rejects.toThrow(/first shot/)

    expect(runImageCritic).not.toHaveBeenCalled()
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
  })

  it("throws when prior shot has no last_frame_url (sequential mode hasn't run)", async () => {
    await expect(
      runFixContinuity({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "s7",
        sceneId: "scene-1",
        userId: "u1",
        plan: fakePlan,
        scene: {
          shots: [
            shot({ id: "shot_01", keyframeUrl: "https://r2/k1.png" /* no lastFrameUrl */ }),
            shot({ id: "shot_02", keyframeUrl: "https://r2/k2.png" }),
          ],
        } as never,
        targetShotId: "shot_02",
      }),
    ).rejects.toThrow(/last_frame_url/)

    expect(runImageCritic).not.toHaveBeenCalled()
  })
})
