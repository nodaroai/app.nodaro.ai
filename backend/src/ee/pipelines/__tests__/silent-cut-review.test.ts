import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../services/pipeline-combine-videos.js", () => ({
  pipelineCombineVideos: vi.fn(),
}))

import { pipelineCombineVideos } from "../services/pipeline-combine-videos.js"
import { runSilentCutReview } from "../sub-steps/silent-cut-review.js"

beforeEach(() => vi.clearAllMocks())

interface SceneFixture {
  entity_key: string
  composite_video_url?: string
}

function makeSupabaseMock(opts: { scenes: SceneFixture[] }) {
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "pipeline_entities") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({
                  data: opts.scenes.map((s) => ({
                    entity_key: s.entity_key,
                    metadata: s.composite_video_url
                      ? { scene_node_data: { composite_video_url: s.composite_video_url } }
                      : {},
                  })),
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return { supabase: supabase as never }
}

describe("runSilentCutReview", () => {
  it("auto mode skips entirely — no combine call", async () => {
    const { supabase } = makeSupabaseMock({ scenes: [] })
    const result = await runSilentCutReview({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      mode: "auto",
    })
    expect(result).toEqual({ ok: true, awaitingApproval: false })
    expect(pipelineCombineVideos).not.toHaveBeenCalled()
  })

  it("manual happy path: combines N scenes + returns previewUrl awaiting approval", async () => {
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "cv-1",
      assetId: "asset-cv-1",
      assetUrl: "https://r2/silent-cut.mp4",
      creditsSpent: 0,
    })
    const { supabase } = makeSupabaseMock({
      scenes: [
        { entity_key: "scene_01", composite_video_url: "https://r2/s1.mp4" },
        { entity_key: "scene_02", composite_video_url: "https://r2/s2.mp4" },
        { entity_key: "scene_03", composite_video_url: "https://r2/s3.mp4" },
      ],
    })
    const result = await runSilentCutReview({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      mode: "manual",
    })
    expect(result).toEqual({
      ok: true,
      previewUrl: "https://r2/silent-cut.mp4",
      awaitingApproval: true,
    })
    expect(pipelineCombineVideos).toHaveBeenCalledWith(
      expect.objectContaining({
        videoUrls: ["https://r2/s1.mp4", "https://r2/s2.mp4", "https://r2/s3.mp4"],
        transition: "cut",
        audioMode: "keep",
      }),
    )
  })

  it("single-scene short-circuit: uses scene composite directly without combine call", async () => {
    const { supabase } = makeSupabaseMock({
      scenes: [
        { entity_key: "scene_01", composite_video_url: "https://r2/single.mp4" },
      ],
    })
    const result = await runSilentCutReview({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      mode: "guided",
    })
    expect(result.ok).toBe(true)
    expect(result.previewUrl).toBe("https://r2/single.mp4")
    expect(result.awaitingApproval).toBe(true)
    expect(pipelineCombineVideos).not.toHaveBeenCalled()
  })

  it("combine failure → returns {ok: false, awaitingApproval: false}", async () => {
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Combine job failed: resolution mismatch"),
    )
    const { supabase } = makeSupabaseMock({
      scenes: [
        { entity_key: "scene_01", composite_video_url: "https://r2/s1.mp4" },
        { entity_key: "scene_02", composite_video_url: "https://r2/s2.mp4" },
      ],
    })
    const result = await runSilentCutReview({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      mode: "manual",
    })
    expect(result.ok).toBe(false)
    expect(result.awaitingApproval).toBe(false)
  })

  it("no-scenes failure → returns {ok: false}", async () => {
    const { supabase } = makeSupabaseMock({ scenes: [] })
    const result = await runSilentCutReview({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      mode: "manual",
    })
    expect(result.ok).toBe(false)
    expect(result.awaitingApproval).toBe(false)
  })

  // Phase 1C.2.1 §I1b — runSilentCutReview MUST NOT touch pipeline_stages
  // directly. The orchestrator (animate-audio-edit.ts) owns the sub_gate /
  // status / output writes against that table per the second /simplify pass.
  // Regressing this invariant would double-write (sub-step + orchestrator)
  // and re-introduce the awaiting_approval race condition that bug fixed.
  it("does NOT write to pipeline_stages directly (orchestrator owns those writes)", async () => {
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "cv-1",
      assetId: "asset-cv-1",
      assetUrl: "https://r2/silent-cut.mp4",
      creditsSpent: 0,
    })
    const { supabase } = makeSupabaseMock({
      scenes: [
        { entity_key: "scene_01", composite_video_url: "https://r2/s1.mp4" },
        { entity_key: "scene_02", composite_video_url: "https://r2/s2.mp4" },
      ],
    })
    await runSilentCutReview({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      mode: "manual",
    })
    const fromCalls = (supabase as never as {
      from: { mock: { calls: unknown[][] } }
    }).from.mock.calls.map((c) => c[0])
    expect(fromCalls).not.toContain("pipeline_stages")
  })
})
