import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../image-critic.js", () => ({ runImageCritic: vi.fn() }))

import { runImageCritic } from "../../image-critic.js"
import { runAuditImages } from "../audit-images.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  global_style: {
    visual_style: "photoreal",
    color_palette: "warm",
    lighting: "golden",
    camera_language: "wide",
  },
} as never

function shot(opts: {
  id: string
  keyframeUrl?: string
  keyframeAssetId?: string
}) {
  return {
    shot_id: opts.id,
    keyframe_url: opts.keyframeUrl,
    keyframe_asset_id: opts.keyframeAssetId,
    visual_keyframe_prompt: `prompt for ${opts.id}`,
    start_state: `start of ${opts.id}`,
    continuity_with_previous: null,
  }
}

describe("runAuditImages", () => {
  it("happy path — calls Image Critic per shot and rolls up to scene-level ok", async () => {
    const mockedRun = runImageCritic as ReturnType<typeof vi.fn>
    mockedRun.mockResolvedValue({ ok: true, issues: [], notes: "Looks good." })

    const result = await runAuditImages({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s7",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: {
        description: "Hero on the runway",
        emotional_beat: "tense",
        shots: [
          shot({ id: "shot_01", keyframeUrl: "https://r2/k1.png", keyframeAssetId: "a1" }),
          shot({ id: "shot_02", keyframeUrl: "https://r2/k2.png", keyframeAssetId: "a2" }),
        ],
      } as never,
    })

    expect(result.scene_id).toBe("scene-1")
    expect(result.ok).toBe(true)
    expect(result.shot_issues).toHaveLength(2)
    expect(result.shot_issues[0]?.shot_id).toBe("shot_01")
    expect(result.shot_issues[0]?.ok).toBe(true)
    expect(result.shot_issues[0]?.skipped).toBe(false)
    expect(result.summary).toMatch(/All 2 keyframes pass review/)

    expect(mockedRun).toHaveBeenCalledTimes(2)
    const firstCall = mockedRun.mock.calls[0][0]
    expect(firstCall.invokedVia).toBe("helper:audit_images")
    expect(firstCall.keyframeUrl).toBe("https://r2/k1.png")
    expect(firstCall.priorLastFrameUrl).toBeNull()
    expect(firstCall.shotId).toBe("shot_01")
    expect(firstCall.pipelineEntityId).toBe("scene-1")
    // Global style threading: sceneDescription embeds global_style fields.
    expect(firstCall.sceneDescription).toContain("photoreal")
    expect(firstCall.sceneDescription).toContain("golden")
  })

  it("skips shots without keyframe_url and surfaces them in summary", async () => {
    const mockedRun = runImageCritic as ReturnType<typeof vi.fn>
    mockedRun.mockResolvedValue({ ok: true, issues: [], notes: "" })

    const result = await runAuditImages({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s7",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: {
        description: "x",
        emotional_beat: "x",
        shots: [
          shot({ id: "shot_01" }), // no keyframe — skipped
          shot({ id: "shot_02", keyframeUrl: "https://r2/k.png" }),
        ],
      } as never,
    })

    expect(mockedRun).toHaveBeenCalledTimes(1)
    expect(result.shot_issues[0]?.skipped).toBe(true)
    expect(result.shot_issues[0]?.verdict).toBeNull()
    expect(result.shot_issues[1]?.skipped).toBe(false)
    expect(result.summary).toMatch(/1 skipped/)
  })

  it("rolls up ok=false when any audited shot has blocking issues", async () => {
    const mockedRun = runImageCritic as ReturnType<typeof vi.fn>
    mockedRun
      .mockResolvedValueOnce({ ok: true, issues: [], notes: "" })
      .mockResolvedValueOnce({
        ok: false,
        issues: [
          {
            type: "identity_mismatch",
            severity: "blocking",
            message: "Hero's hair color drifted.",
          },
        ],
        notes: "",
      })

    const result = await runAuditImages({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "s7",
      sceneId: "scene-1",
      userId: "u1",
      plan: fakePlan,
      scene: {
        description: "x",
        emotional_beat: "x",
        shots: [
          shot({ id: "shot_01", keyframeUrl: "https://r2/k1.png" }),
          shot({ id: "shot_02", keyframeUrl: "https://r2/k2.png" }),
        ],
      } as never,
    })

    expect(result.ok).toBe(false)
    expect(result.shot_issues[1]?.ok).toBe(false)
    expect(result.summary).toMatch(/1 of 2 shots have blocking issues/)
  })
})
