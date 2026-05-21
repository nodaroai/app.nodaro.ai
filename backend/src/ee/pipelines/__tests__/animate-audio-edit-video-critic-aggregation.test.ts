import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SceneNodeData } from "@nodaro/shared"

// Mock every sub-step module + helpers BEFORE importing the SUT. Mirrors the
// mock surface from animate-audio-edit.test.ts so the SUT graph resolves the
// same way the real handler does.
vi.mock("../scene-internal-pipeline.js", () => ({
  runSceneInternalPipeline: vi.fn(),
}))
vi.mock("../depends-on.js", () => ({
  transitionStageEntityNodesAndEmit: vi.fn(),
}))
vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))
vi.mock("../services/pipeline-final-merge.js", () => ({
  pipelineFinalMerge: vi.fn(),
}))
vi.mock("../sub-steps/dialogue-recheck.js", () => ({
  runDialogueRecheck: vi.fn(),
}))
vi.mock("../sub-steps/narration-audio.js", () => ({
  runNarrationAudio: vi.fn(),
}))
vi.mock("../sub-steps/silent-cut-review.js", () => ({
  runSilentCutReview: vi.fn(),
}))
vi.mock("../sub-steps/shot-realignment.js", () => ({
  runShotRealignment: vi.fn(),
}))
vi.mock("../music-timeline.js", () => ({
  runMusicTimeline: vi.fn(),
}))
vi.mock("../llms/editor.js", () => ({
  runEditor: vi.fn(),
}))
// E1: the auto-mode aggregator delegates to `failPipelineWithCriticReason` in
// stage-utils.js. Mock the helper here (NOT failStage) so we can assert the
// auto-mode path hits the typed-reason fail flow and NOT the generic failStage.
vi.mock("../stage-utils.js", () => ({
  ensureStageRow: vi.fn().mockResolvedValue("stage-7"),
  failStage: vi.fn(),
  failPipelineWithCriticReason: vi.fn(async () => undefined),
}))

import { runSceneInternalPipeline } from "../scene-internal-pipeline.js"
import {
  failStage,
  failPipelineWithCriticReason,
} from "../stage-utils.js"
import { pipelineFinalMerge } from "../services/pipeline-final-merge.js"
import { runDialogueRecheck } from "../sub-steps/dialogue-recheck.js"
import { runNarrationAudio } from "../sub-steps/narration-audio.js"
import { runSilentCutReview } from "../sub-steps/silent-cut-review.js"
import { runShotRealignment } from "../sub-steps/shot-realignment.js"
import { runMusicTimeline } from "../music-timeline.js"
import { runEditor } from "../llms/editor.js"
import { runAnimateAudioEditStage } from "../stages/animate-audio-edit.js"

beforeEach(() => {
  vi.clearAllMocks()
  // Happy-path defaults — overridden per-test as needed.
  ;(runDialogueRecheck as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    rebalances: [],
    warnings: [],
    awaitingUserDecision: false,
  })
  ;(runNarrationAudio as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    skipped: true,
    reason: "no_script",
  })
  ;(runSilentCutReview as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    awaitingApproval: false,
  })
  ;(runShotRealignment as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    realignedShots: [],
    warnings: [],
  })
  ;(runMusicTimeline as ReturnType<typeof vi.fn>).mockResolvedValue({
    enabled: true,
    musicAssetUrl: "https://r2/music.mp3",
    beatGrid: [0.5, 1.0, 1.5],
    detectedBPM: 120,
    plannedBPM: 120,
    realignmentNeeded: false,
  })
  ;(runEditor as ReturnType<typeof vi.fn>).mockResolvedValue({ cut_decisions: [] })
  ;(pipelineFinalMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
    finalAssetId: "asset-final",
    finalAssetUrl: "https://r2/final.mp4",
  })
})

/**
 * Builds a SceneNodeData with N shots; per-shot `video_critic_failed`
 * overridable via `shotFailures[i]`.
 *
 * E1 reads `shot.video_critic_failed` directly (the field is hoisted onto
 * the ShotSpec by `runSceneInternalPipeline`, NOT nested under a
 * `shot.metadata` sub-object).
 */
function makeSceneNodeData(
  idx: number,
  opts: { shotCount?: number; shotFailures?: boolean[] } = {},
): SceneNodeData {
  const shotCount = opts.shotCount ?? 2
  const failures = opts.shotFailures ?? []
  return {
    scene_index: idx,
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
    shots: Array.from({ length: shotCount }, (_, i) => ({
      shot_id: `shot_${String(i + 1).padStart(2, "0")}`,
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
      visual_keyframe_prompt: `prompt ${i}`,
      has_dialogue: false,
      ...(failures[i] !== undefined
        ? { video_critic_failed: failures[i] }
        : {}),
    })),
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
  } as SceneNodeData
}

interface MakeSupabaseOpts {
  scenes: Array<{ id: string; entity_key: string; scene_node_data?: SceneNodeData }>
  pipelineMode?: "manual" | "auto" | "guided"
  /**
   * Pipeline-row credit fields. E1 reads `user_id` / `reserved_credits` /
   * `spent_credits` from the same SELECT that already loads
   * `config` / `mode` / `target_duration_seconds`.
   */
  reservedCredits?: number
  spentCredits?: number
  userId?: string
}

function makeSupabase(opts: MakeSupabaseOpts) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const s of opts.scenes) {
    entities.set(s.id, {
      id: s.id,
      entity_key: s.entity_key,
      metadata:
        s.scene_node_data !== undefined ? { scene_node_data: s.scene_node_data } : {},
    })
  }
  const stageUpdates: Array<Record<string, unknown>> = []
  let stageOutput: Record<string, unknown> = {}

  return {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: (cols?: string) => ({
            eq: (col1: string, _val1: string) => {
              if (col1 === "id") {
                return {
                  maybeSingle: async () => {
                    const data: Record<string, unknown> = {
                      status: "running",
                    }
                    if ((cols ?? "").includes("output")) {
                      data.output = stageOutput
                    }
                    return { data, error: null }
                  },
                }
              }
              if (col1 === "pipeline_id") {
                return {
                  eq: () => ({
                    maybeSingle: async () => ({
                      data: { output: { plan: null } },
                      error: null,
                    }),
                  }),
                }
              }
              return { eq: () => ({ single: async () => ({ data: null, error: null }) }) }
            },
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              stageUpdates.push(patch)
              if (patch.output && typeof patch.output === "object") {
                stageOutput = patch.output as Record<string, unknown>
              }
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
                  config: {},
                  mode: opts.pipelineMode ?? "manual",
                  target_duration_seconds: 60,
                  user_id: opts.userId ?? "u-pipeline",
                  reserved_credits: opts.reservedCredits ?? 100,
                  spent_credits: opts.spentCredits ?? 25,
                },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
      }
      if (table === "pipeline_entities") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({
                  data: Array.from(entities.values()),
                  error: null,
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              const row = entities.get(val)
              if (row) entities.set(val, { ...row, ...patch })
              return { data: null, error: null }
            },
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
    _stageUpdates: stageUpdates,
  } as never
}

function buildUpdatedMetadata(sceneNodeData: SceneNodeData): Record<string, unknown> {
  return {
    scene_node_data: {
      ...sceneNodeData,
      composite_video_url: "https://r2/composite.mp4",
      composite_video_asset_id: "asset-composite",
    },
  }
}

/** Wire `runSceneInternalPipeline` to return the per-scene shot data unchanged
 *  (already carries `video_critic_failed` where the test seeded it). */
function setupSceneInternalPipelineEcho() {
  ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
    async (
      _ctx: unknown,
      scene: { id: string; metadata: Record<string, unknown> | null },
    ) => {
      const sceneData = (scene.metadata as { scene_node_data?: SceneNodeData } | null)
        ?.scene_node_data as SceneNodeData
      return {
        ok: true,
        composite_video_asset_id: `vid-${scene.id}`,
        composite_video_url: `https://r2/vid-${scene.id}.mp4`,
        per_shot_results: [],
        updated_metadata: buildUpdatedMetadata(sceneData),
      }
    },
  )
}

describe("runAnimateAudioEditStage — Phase 1D.2c-b-ii E1 video-critic auto-mode aggregation", () => {
  it("auto + 1 shot with video_critic_failed=true → pipeline fails via failPipelineWithCriticReason + refund, no sub-steps run", async () => {
    setupSceneInternalPipelineEcho()
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, {
            shotCount: 2,
            shotFailures: [false, true],
          }),
        },
      ],
      pipelineMode: "auto",
      reservedCredits: 200,
      spentCredits: 50,
      userId: "u-fail-test",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1-video-critic-fail",
      userId: "u-fail-test",
      userTier: "pro",
    })

    // The helper was called with the video-critic reason + correct refund delta.
    expect(failPipelineWithCriticReason).toHaveBeenCalledTimes(1)
    expect(failPipelineWithCriticReason).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: "p1-video-critic-fail",
        failureReason: "video_critic_unresolvable",
        stageName: "animate_audio_edit",
        userId: "u-fail-test",
        refundCredits: 150, // reserved 200 - spent 50
      }),
    )

    // No sub-steps run — we fail BEFORE the chain.
    expect(runDialogueRecheck).not.toHaveBeenCalled()
    expect(runSilentCutReview).not.toHaveBeenCalled()
    expect(runMusicTimeline).not.toHaveBeenCalled()
    expect(runEditor).not.toHaveBeenCalled()
    expect(pipelineFinalMerge).not.toHaveBeenCalled()
    // Stage was NOT also `failStage`'d generically — failPipelineWithCriticReason
    // owns the stage flip (status='failed' + typed reason) end-to-end.
    expect(failStage).not.toHaveBeenCalled()
  })

  it("auto + 0 shots failed → existing happy-path runs, no aggregation fires", async () => {
    setupSceneInternalPipelineEcho()
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, {
            shotCount: 2,
            shotFailures: [false, false],
          }),
        },
      ],
      pipelineMode: "auto",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1-happy",
      userId: "u1",
      userTier: "pro",
    })

    expect(failPipelineWithCriticReason).not.toHaveBeenCalled()
    // Full chain runs through final_merge.
    expect(pipelineFinalMerge).toHaveBeenCalledTimes(1)
  })

  it("manual mode + 1 shot failed → pipeline does NOT fail (user reviews via UI)", async () => {
    setupSceneInternalPipelineEcho()
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, {
            shotCount: 2,
            shotFailures: [false, true],
          }),
        },
      ],
      pipelineMode: "manual",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1-manual",
      userId: "u1",
      userTier: "pro",
    })

    expect(failPipelineWithCriticReason).not.toHaveBeenCalled()
    // Manual-mode chain still proceeds — the per-shot UI surfaces the failure
    // for the user to Regenerate via the J1 recovery routes.
    expect(runDialogueRecheck).toHaveBeenCalled()
  })

  it("guided mode + 1 shot failed → pipeline does NOT fail (same as manual)", async () => {
    setupSceneInternalPipelineEcho()
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, {
            shotCount: 2,
            shotFailures: [false, true],
          }),
        },
      ],
      pipelineMode: "guided",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1-guided",
      userId: "u1",
      userTier: "pro",
    })

    expect(failPipelineWithCriticReason).not.toHaveBeenCalled()
    expect(runDialogueRecheck).toHaveBeenCalled()
  })

  it("auto + multiple shots failed across multiple scenes → single aggregated failure", async () => {
    setupSceneInternalPipelineEcho()
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, {
            shotCount: 3,
            shotFailures: [false, true, false],
          }),
        },
        {
          id: "scene-2",
          entity_key: "scene_02",
          scene_node_data: makeSceneNodeData(2, {
            shotCount: 2,
            shotFailures: [true, true],
          }),
        },
        {
          id: "scene-3",
          entity_key: "scene_03",
          scene_node_data: makeSceneNodeData(3, {
            shotCount: 1,
            shotFailures: [false],
          }),
        },
      ],
      pipelineMode: "auto",
      reservedCredits: 500,
      spentCredits: 100,
      userId: "u-multi",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1-multi",
      userId: "u-multi",
      userTier: "pro",
    })

    // Exactly one aggregated failure call, regardless of how many shots fail.
    expect(failPipelineWithCriticReason).toHaveBeenCalledTimes(1)
    expect(failPipelineWithCriticReason).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: "video_critic_unresolvable",
        refundCredits: 400, // 500 - 100
      }),
    )
    expect(pipelineFinalMerge).not.toHaveBeenCalled()
  })

  it("auto + 0 reserved-spent delta → refundCredits=0, helper still called", async () => {
    // Edge case: spent >= reserved (no refund owed). The helper still fires
    // (we still need to flip pipeline.status='failed' + emit SSE), with
    // refundCredits clamped to 0 so the helper's internal `if (refundCredits > 0)`
    // gate skips the refund RPC.
    setupSceneInternalPipelineEcho()
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, {
            shotCount: 1,
            shotFailures: [true],
          }),
        },
      ],
      pipelineMode: "auto",
      reservedCredits: 50,
      spentCredits: 75, // over-spent
      userId: "u-zero",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1-zero-refund",
      userId: "u-zero",
      userTier: "pro",
    })

    expect(failPipelineWithCriticReason).toHaveBeenCalledTimes(1)
    expect(failPipelineWithCriticReason).toHaveBeenCalledWith(
      expect.objectContaining({
        refundCredits: 0,
      }),
    )
  })
})
