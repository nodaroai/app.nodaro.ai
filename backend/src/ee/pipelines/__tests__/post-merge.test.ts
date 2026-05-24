import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock stage helpers + events BEFORE importing the SUT. Paths are relative
// to the SUT (`stages/post-merge.ts`), NOT to this test file.
vi.mock("../stage-utils.js", () => ({
  ensureStageRow: vi.fn().mockResolvedValue("stage-8"),
  failStage: vi.fn(),
}))
vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))

import { failStage } from "../stage-utils.js"
import { pipelineEvents } from "../events.js"
import { runPostMergeStage } from "../stages/post-merge.js"

beforeEach(() => vi.clearAllMocks())

// ─── Fixtures ────────────────────────────────────────────────────────────────

interface MakeSupabaseOpts {
  pipelineMode?: "manual" | "auto" | "guided"
  finalOutputAssetId?: string | null
  initialStageStatus?: string
  assetR2Url?: string
  assetMissing?: boolean
  /**
   * Stage 7 (`animate_audio_edit`) output that the post_merge handler reads
   * to copy cut_decisions / final_duration_seconds / beat_grid_used onto its
   * own row. Defaults to an empty object so the existing tests that don't
   * exercise the copy path still pass.
   */
  animateStageOutput?: Record<string, unknown> | null
}

function makeSupabase(opts: MakeSupabaseOpts = {}) {
  const stageUpdates: Array<Record<string, unknown>> = []
  const pipelineUpdates: Array<Record<string, unknown>> = []

  return {
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: (col: string, value: string) => {
              // Two distinct SELECT paths land here:
              //  - by id (the re-entrancy guard)        → returns { status }
              //  - by pipeline_id + .eq("stage_name", "animate_audio_edit")
              //                                          → returns { output }
              // We branch on the first eq() arg to mirror real behavior.
              if (col === "id") {
                return {
                  maybeSingle: async () => ({
                    data: { status: opts.initialStageStatus ?? "running" },
                    error: null,
                  }),
                }
              }
              if (col === "pipeline_id") {
                return {
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: opts.animateStageOutput === null
                        ? null
                        : { output: opts.animateStageOutput ?? {} },
                      error: null,
                    }),
                  }),
                }
              }
              throw new Error(`Unmocked pipeline_stages.select.eq(${col}, ${value})`)
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
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  mode: opts.pipelineMode ?? "manual",
                  final_output_asset_id:
                    opts.finalOutputAssetId === undefined
                      ? "asset-final"
                      : opts.finalOutputAssetId,
                },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              pipelineUpdates.push(patch)
              return { data: null, error: null }
            },
          }),
        }
      }
      if (table === "assets") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => {
                if (opts.assetMissing) {
                  return { data: null, error: { message: "not_found" } }
                }
                return {
                  data: { r2_url: opts.assetR2Url ?? "https://r2/final.mp4" },
                  error: null,
                }
              },
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

describe("runPostMergeStage (J1 — pure approval gate)", () => {
  it("1. auto mode → flip pipelines.status=completed + emit pipeline:completed", async () => {
    const supabase = makeSupabase({
      pipelineMode: "auto",
      finalOutputAssetId: "asset-final",
      assetR2Url: "https://r2/final.mp4",
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.some((u) => u.status === "completed")).toBe(true)

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "approved")).toBe(true)

    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    const completedEvent = publishCalls.find(
      (c) => c[0]?.type === "pipeline:completed",
    )
    expect(completedEvent).toBeTruthy()
    expect(completedEvent?.[0]).toMatchObject({
      type: "pipeline:completed",
      pipelineId: "p1",
      finalOutputAssetId: "asset-final",
      finalOutputUrl: "https://r2/final.mp4",
    })
    expect(failStage).not.toHaveBeenCalled()
  })

  it("2. manual mode → stage_status=awaiting_approval + final_output_url in output", async () => {
    const supabase = makeSupabase({
      pipelineMode: "manual",
      finalOutputAssetId: "asset-final",
      assetR2Url: "https://r2/final.mp4",
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    // Should NOT flip pipelines.status — that happens on user approval.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.some((u) => u.status === "completed")).toBe(false)

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    const awaitingUpdate = stageUpdates.find(
      (u) => u.status === "awaiting_approval",
    )
    expect(awaitingUpdate).toBeTruthy()
    expect(awaitingUpdate?.output).toMatchObject({
      final_output_url: "https://r2/final.mp4",
      final_output_asset_id: "asset-final",
      // Stage 7 output not provided → defaults to empty/zero/null.
      cut_decisions: [],
      final_duration_seconds: 0,
      beat_grid_used: null,
    })

    // Should NOT emit pipeline:completed yet.
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(publishCalls.find((c) => c[0]?.type === "pipeline:completed")).toBeUndefined()

    // Should emit stage:status=awaiting_approval.
    const stageStatusEvent = publishCalls.find(
      (c) => c[0]?.type === "stage:status" && c[0]?.status === "awaiting_approval",
    )
    expect(stageStatusEvent).toBeTruthy()
    expect(failStage).not.toHaveBeenCalled()
  })

  it("8. copies cut_decisions + final_duration_seconds + beat_grid_used from animate_audio_edit stage output", async () => {
    const animateOutput = {
      cut_decisions: [
        { shot_id: "s1_shot1", transition_to_next: "hard_cut" },
        { shot_id: "s1_shot2", transition_to_next: "match_cut" },
      ],
      final_duration_seconds: 42.5,
      beat_grid_used: [0.5, 1.0, 1.5, 2.0],
    }
    const supabase = makeSupabase({
      pipelineMode: "manual",
      finalOutputAssetId: "asset-final",
      assetR2Url: "https://r2/final.mp4",
      animateStageOutput: animateOutput,
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    const awaitingUpdate = stageUpdates.find(
      (u) => u.status === "awaiting_approval",
    )
    expect(awaitingUpdate?.output).toMatchObject({
      final_output_url: "https://r2/final.mp4",
      final_output_asset_id: "asset-final",
      cut_decisions: animateOutput.cut_decisions,
      final_duration_seconds: 42.5,
      beat_grid_used: animateOutput.beat_grid_used,
    })
  })

  it("9. auto mode also writes cut_decisions + duration + beat_grid into the approved output", async () => {
    const animateOutput = {
      cut_decisions: [{ shot_id: "s1_shot1", transition_to_next: "hard_cut" }],
      final_duration_seconds: 60,
      beat_grid_used: null,
    }
    const supabase = makeSupabase({
      pipelineMode: "auto",
      finalOutputAssetId: "asset-final",
      assetR2Url: "https://r2/final.mp4",
      animateStageOutput: animateOutput,
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    const approvedUpdate = stageUpdates.find((u) => u.status === "approved")
    expect(approvedUpdate?.output).toMatchObject({
      final_output_url: "https://r2/final.mp4",
      final_output_asset_id: "asset-final",
      cut_decisions: animateOutput.cut_decisions,
      final_duration_seconds: 60,
      beat_grid_used: null,
    })
  })

  it("10. missing animate_audio_edit row → defaults to empty array / 0 / null (no crash)", async () => {
    const supabase = makeSupabase({
      pipelineMode: "manual",
      finalOutputAssetId: "asset-final",
      assetR2Url: "https://r2/final.mp4",
      animateStageOutput: null, // simulate "no Stage 7 row in DB"
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    const awaitingUpdate = stageUpdates.find(
      (u) => u.status === "awaiting_approval",
    )
    expect(awaitingUpdate?.output).toMatchObject({
      cut_decisions: [],
      final_duration_seconds: 0,
      beat_grid_used: null,
    })
    expect(failStage).not.toHaveBeenCalled()
  })

  it("3. guided mode → same awaiting_approval behavior as manual", async () => {
    const supabase = makeSupabase({
      pipelineMode: "guided",
      finalOutputAssetId: "asset-final",
      assetR2Url: "https://r2/final.mp4",
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.some((u) => u.status === "completed")).toBe(false)

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "awaiting_approval")).toBe(true)
  })

  it("4. final_output_asset_id missing → fail with 'final_output_missing'", async () => {
    const supabase = makeSupabase({
      pipelineMode: "manual",
      finalOutputAssetId: null,
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    expect((failStage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toBe(
      "final_output_missing",
    )

    // No pipeline:completed emission.
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(publishCalls.find((c) => c[0]?.type === "pipeline:completed")).toBeUndefined()
  })

  it("5. is a no-op when the stage row is already approved", async () => {
    const supabase = makeSupabase({
      pipelineMode: "auto",
      finalOutputAssetId: "asset-final",
      initialStageStatus: "approved",
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    // Should NOT touch pipelines.status — already terminal.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.length).toBe(0)
    expect(failStage).not.toHaveBeenCalled()

    // No new pipeline:completed event.
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(publishCalls.find((c) => c[0]?.type === "pipeline:completed")).toBeUndefined()
  })

  it("6. is a no-op when the stage row is already awaiting_approval", async () => {
    const supabase = makeSupabase({
      pipelineMode: "manual",
      finalOutputAssetId: "asset-final",
      initialStageStatus: "awaiting_approval",
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    // Should NOT re-emit awaiting_approval (idempotency).
    expect(stageUpdates.length).toBe(0)
    expect(failStage).not.toHaveBeenCalled()
  })

  it("7. asset load failure → fail with 'asset_load_failed'", async () => {
    const supabase = makeSupabase({
      pipelineMode: "manual",
      finalOutputAssetId: "asset-final",
      assetMissing: true,
    })

    await runPostMergeStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    const failReason = (failStage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]
    expect(failReason).toMatch(/^asset_load_failed:/)
  })
})
