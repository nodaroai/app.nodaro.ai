import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the combine-videos wrapper + stage helpers BEFORE importing the SUT
// so the SUT's static imports pick up the mocks. Paths are relative to the
// SUT (`stages/post-merge.ts`), NOT this test file.
vi.mock("../services/pipeline-combine-videos.js", () => ({
  pipelineCombineVideos: vi.fn(),
}))
vi.mock("../stage-utils.js", () => ({
  ensureStageRow: vi.fn().mockResolvedValue("stage-8"),
  failStage: vi.fn(),
}))
vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))

import { pipelineCombineVideos } from "../services/pipeline-combine-videos.js"
import { failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"
import { runPostMergeStage } from "../stages/post-merge.js"

beforeEach(() => vi.clearAllMocks())

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface SceneFixture {
  id: string
  entity_key: string
  composite_video_url?: string
  composite_video_asset_id?: string
}

interface MakeSupabaseOpts {
  scenes: SceneFixture[]
  initialStageStatus?: string
}

function makeSupabase(opts: MakeSupabaseOpts) {
  const stageUpdates: Array<Record<string, unknown>> = []
  const pipelineUpdates: Array<Record<string, unknown>> = []

  return {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: (col1: string, _val1: string) => {
              if (col1 === "id") {
                return {
                  maybeSingle: async () => ({
                    data: {
                      status: opts.initialStageStatus ?? "running",
                    },
                    error: null,
                  }),
                }
              }
              return { eq: () => ({ single: async () => ({ data: null, error: null }) }) }
            },
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              stageUpdates.push(patch)
              return { data: null, error: null }
            },
          }),
        }
      }
      if (table === "pipelines") {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              pipelineUpdates.push(patch)
              return { data: null, error: null }
            },
          }),
        }
      }
      if (table === "pipeline_entities") {
        const rows = opts.scenes.map((s) => ({
          metadata:
            s.composite_video_url || s.composite_video_asset_id
              ? {
                  scene_node_data: {
                    composite_video_url: s.composite_video_url,
                    composite_video_asset_id: s.composite_video_asset_id,
                  },
                }
              : {},
          entity_key: s.entity_key,
        }))
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({ data: rows, error: null }),
              }),
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
    _stageUpdates: stageUpdates,
    _pipelineUpdates: pipelineUpdates,
  } as never
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runPostMergeStage", () => {
  it("happy path: N scenes → combine_videos call → status=completed + pipeline:completed", async () => {
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-final",
      assetId: "final-asset-1",
      assetUrl: "https://r2/final.mp4",
      creditsSpent: 0,
    })

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          composite_video_url: "https://r2/scene-1.mp4",
          composite_video_asset_id: "vid-1",
        },
        {
          id: "scene-2",
          entity_key: "scene_02",
          composite_video_url: "https://r2/scene-2.mp4",
          composite_video_asset_id: "vid-2",
        },
        {
          id: "scene-3",
          entity_key: "scene_03",
          composite_video_url: "https://r2/scene-3.mp4",
          composite_video_asset_id: "vid-3",
        },
      ],
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(pipelineCombineVideos).toHaveBeenCalledTimes(1)
    const combineCall = (pipelineCombineVideos as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(combineCall?.[0]?.videoUrls).toEqual([
      "https://r2/scene-1.mp4",
      "https://r2/scene-2.mp4",
      "https://r2/scene-3.mp4",
    ])
    expect(combineCall?.[0]?.pipelineEntityId).toBeUndefined() // Stage 8 doesn't tie to an entity

    expect(failStage).not.toHaveBeenCalled()

    // Pipeline row flipped to completed with final_output_asset_id.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.some((u) => u.status === "completed")).toBe(true)
    expect(
      pipelineUpdates.find((u) => u.final_output_asset_id !== undefined)
        ?.final_output_asset_id,
    ).toBe("final-asset-1")

    // pipeline:completed event emitted with the asset id + URL.
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    const completedEvent = publishCalls.find(
      (call) => call[0]?.type === "pipeline:completed",
    )
    expect(completedEvent).toBeTruthy()
    expect(completedEvent?.[0]).toMatchObject({
      type: "pipeline:completed",
      pipelineId: "p1",
      finalOutputAssetId: "final-asset-1",
      finalOutputUrl: "https://r2/final.mp4",
    })
  })

  it("fails the stage with 'no_scene_videos' when no scenes carry composite_video_url", async () => {
    const supabase = makeSupabase({
      scenes: [
        // Scene without composite_video_url — Stage 7 didn't (or couldn't) write it back.
        { id: "scene-1", entity_key: "scene_01" },
      ],
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    expect((failStage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toBe(
      "no_scene_videos",
    )
    expect(pipelineCombineVideos).not.toHaveBeenCalled()
    // pipeline:completed should NOT have fired.
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(
      publishCalls.find((c) => c[0]?.type === "pipeline:completed"),
    ).toBeUndefined()
  })

  it("fails the stage with combine_failed when combine_videos throws", async () => {
    ;(pipelineCombineVideos as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("FFmpeg dispatch returned 500"),
    )

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          composite_video_url: "https://r2/scene-1.mp4",
          composite_video_asset_id: "vid-1",
        },
        {
          id: "scene-2",
          entity_key: "scene_02",
          composite_video_url: "https://r2/scene-2.mp4",
          composite_video_asset_id: "vid-2",
        },
      ],
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    const failCall = (failStage as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(failCall?.[2]).toMatch(/^combine_failed: /)
    expect(failCall?.[2]).toMatch(/FFmpeg dispatch returned 500/)
    // No pipeline row update should have flipped status=completed.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.some((u) => u.status === "completed")).toBe(false)
  })

  it("single-scene pipeline: copies the lone composite URL to final_output (no combine call)", async () => {
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          composite_video_url: "https://r2/lone-scene.mp4",
          composite_video_asset_id: "vid-lone",
        },
      ],
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    // Combine should NOT be called for a single-scene pipeline.
    expect(pipelineCombineVideos).not.toHaveBeenCalled()
    expect(failStage).not.toHaveBeenCalled()

    // Pipeline row flipped to completed; final_output_asset_id is the lone scene's.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    const completionUpdate = pipelineUpdates.find(
      (u) => u.status === "completed",
    )
    expect(completionUpdate?.final_output_asset_id).toBe("vid-lone")

    // pipeline:completed event carries the lone scene's URL + asset id.
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    const completedEvent = publishCalls.find(
      (c) => c[0]?.type === "pipeline:completed",
    )
    expect(completedEvent?.[0]).toMatchObject({
      type: "pipeline:completed",
      finalOutputAssetId: "vid-lone",
      finalOutputUrl: "https://r2/lone-scene.mp4",
    })
  })

  it("is a no-op when the stage row is already approved", async () => {
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          composite_video_url: "https://r2/scene-1.mp4",
          composite_video_asset_id: "vid-1",
        },
      ],
      initialStageStatus: "approved",
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(pipelineCombineVideos).not.toHaveBeenCalled()
    expect(failStage).not.toHaveBeenCalled()
    // No completion event should fire on re-entry.
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(
      publishCalls.find((c) => c[0]?.type === "pipeline:completed"),
    ).toBeUndefined()
  })
})
