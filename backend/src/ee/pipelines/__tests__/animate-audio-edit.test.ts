import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SceneNodeData } from "@nodaro/shared"

// Mock the inner pipeline runner + stage helpers BEFORE importing the SUT so
// the SUT's static imports pick up the mocks. Paths are relative to the SUT
// (`stages/animate-audio-edit.ts`), NOT to this test file.
vi.mock("../scene-internal-pipeline.js", () => ({
  runSceneInternalPipeline: vi.fn(),
}))
vi.mock("../depends-on.js", () => ({
  transitionStageEntityNodesAndEmit: vi.fn(),
}))
vi.mock("../stage-utils.js", () => ({
  ensureStageRow: vi.fn().mockResolvedValue("stage-7"),
  failStage: vi.fn(),
}))
vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))

import { runSceneInternalPipeline } from "../scene-internal-pipeline.js"
import { failStage } from "../stage-utils.js"
import {
  transitionStageEntityNodesAndEmit,
} from "../depends-on.js"
import { pipelineEvents } from "../events.js"
import { runAnimateAudioEditStage } from "../stages/animate-audio-edit.js"

beforeEach(() => vi.clearAllMocks())

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSceneNodeData(idx: number, shotCount = 2): SceneNodeData {
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
  /**
   * Initial pipeline_stages.status returned by the re-entrancy guard read.
   * Default 'running'. Use 'awaiting_approval' to trigger the no-op branch.
   */
  initialStageStatus?: string
  /**
   * `pipelines.config` JSON returned by the config read. Default `{}` so
   * mode defaults to 'parallel' + lipsync defaults to true.
   */
  pipelineConfig?: Record<string, unknown>
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

  return {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: (col1: string, _val1: string) => {
              if (col1 === "id") {
                // ensureStageRow re-fetch re-entrancy guard
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
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { config: opts.pipelineConfig ?? {} },
                error: null,
              }),
            }),
          }),
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
    _entities: entities,
    _stageUpdates: stageUpdates,
  } as never
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runAnimateAudioEditStage", () => {
  it("sequential mode: drives each scene 1-at-a-time with runImageCritic=true", async () => {
    const calls: Array<{ id: string; options: Record<string, unknown> }> = []
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _ctx: unknown,
        scene: { id: string },
        options: Record<string, unknown>,
      ) => {
        calls.push({ id: scene.id, options })
        return {
          ok: true,
          composite_video_asset_id: `vid-${scene.id}`,
          composite_video_url: `https://r2/vid-${scene.id}.mp4`,
          per_shot_results: [],
        }
      },
    )

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
        { id: "scene-2", entity_key: "scene_02", scene_node_data: makeSceneNodeData(2) },
      ],
      pipelineConfig: { shot_generation_mode: "sequential", lipsync_enabled: true },
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runSceneInternalPipeline).toHaveBeenCalledTimes(2)
    for (const c of calls) {
      expect(c.options.mode).toBe("sequential")
      expect(c.options.runImageCritic).toBe(true)
      expect(c.options.lipSyncEnabled).toBe(true)
    }
    expect(failStage).not.toHaveBeenCalled()
    // Should land an awaiting_approval update on pipeline_stages.
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "awaiting_approval")).toBe(true)
  })

  it("parallel mode: scenes processed up to 3-at-a-time with runImageCritic=false", async () => {
    let inFlight = 0
    let peak = 0
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _ctx: unknown,
        scene: { id: string },
        options: Record<string, unknown>,
      ) => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((r) => setTimeout(r, 5))
        inFlight--
        // Verify runImageCritic always false in parallel mode.
        expect(options.runImageCritic).toBe(false)
        return {
          ok: true,
          composite_video_asset_id: `vid-${scene.id}`,
          composite_video_url: `https://r2/vid-${scene.id}.mp4`,
        }
      },
    )

    const supabase = makeSupabase({
      scenes: Array.from({ length: 6 }, (_, i) => ({
        id: `scene-${i + 1}`,
        entity_key: `scene_${String(i + 1).padStart(2, "0")}`,
        scene_node_data: makeSceneNodeData(i + 1),
      })),
      pipelineConfig: { shot_generation_mode: "parallel", lipsync_enabled: true },
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(peak).toBeLessThanOrEqual(3)
    expect(runSceneInternalPipeline).toHaveBeenCalledTimes(6)
    expect(failStage).not.toHaveBeenCalled()
  })

  it("fails the stage when a scene returns a continuity_break", async () => {
    // Three scenes; scene-2 returns a continuity break in the runner.
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_ctx: unknown, scene: { id: string }) => {
        if (scene.id === "scene-2") {
          return { ok: false, reason: "continuity_break" }
        }
        return {
          ok: true,
          composite_video_asset_id: `vid-${scene.id}`,
          composite_video_url: `https://r2/vid-${scene.id}.mp4`,
        }
      },
    )

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
        { id: "scene-2", entity_key: "scene_02", scene_node_data: makeSceneNodeData(2) },
        { id: "scene-3", entity_key: "scene_03", scene_node_data: makeSceneNodeData(3) },
      ],
      // sequential to cause Image Critic engagement (continuity_break only
      // surfaces in sequential mode internally, but Stage 7 is mode-agnostic
      // for failure counting).
      pipelineConfig: { shot_generation_mode: "sequential" },
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    const failCall = (failStage as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(failCall?.[2]).toMatch(/1 scenes failed/)
  })

  it("forwards lipsync_enabled=false from pipeline.config to the runner", async () => {
    const observedOptions: Array<Record<string, unknown>> = []
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _ctx: unknown,
        scene: { id: string },
        options: Record<string, unknown>,
      ) => {
        observedOptions.push(options)
        return {
          ok: true,
          composite_video_asset_id: `vid-${scene.id}`,
          composite_video_url: `https://r2/vid-${scene.id}.mp4`,
        }
      },
    )

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineConfig: { shot_generation_mode: "parallel", lipsync_enabled: false },
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(observedOptions).toHaveLength(1)
    expect(observedOptions[0]?.lipSyncEnabled).toBe(false)
  })

  it("defaults shot_generation_mode to 'parallel' when pipeline.config is empty", async () => {
    const observedOptions: Array<Record<string, unknown>> = []
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _ctx: unknown,
        scene: { id: string },
        options: Record<string, unknown>,
      ) => {
        observedOptions.push(options)
        return {
          ok: true,
          composite_video_asset_id: `vid-${scene.id}`,
          composite_video_url: `https://r2/vid-${scene.id}.mp4`,
        }
      },
    )

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineConfig: {}, // Empty config — should default mode=parallel, lipsync=true
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(observedOptions[0]?.mode).toBe("parallel")
    expect(observedOptions[0]?.runImageCritic).toBe(false)
    expect(observedOptions[0]?.lipSyncEnabled).toBe(true)
  })

  it("transitions scene nodes: pipeline_owned_running → pipeline_owned_awaiting_approval", async () => {
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      composite_video_asset_id: "vid-1",
      composite_video_url: "https://r2/vid-1.mp4",
    })

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    // Should be called twice: once for running, once for awaiting_approval.
    expect(transitionStageEntityNodesAndEmit).toHaveBeenCalledTimes(2)
    const calls = (transitionStageEntityNodesAndEmit as ReturnType<typeof vi.fn>).mock
      .calls
    expect(calls[0]?.[3]).toBe("pipeline_owned_running")
    expect(calls[1]?.[3]).toBe("pipeline_owned_awaiting_approval")
    // Final stage:status SSE event should also have fired.
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stage:status",
        stageName: "animate_audio_edit",
        status: "awaiting_approval",
      }),
    )
  })

  it("is a no-op when the stage is already awaiting_approval", async () => {
    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      initialStageStatus: "awaiting_approval",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runSceneInternalPipeline).not.toHaveBeenCalled()
    expect(failStage).not.toHaveBeenCalled()
  })

  it("fails the stage when no scenes exist", async () => {
    const supabase = makeSupabase({ scenes: [] })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    expect((failStage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toBe("no_scenes")
    expect(runSceneInternalPipeline).not.toHaveBeenCalled()
  })

  it("persists per-shot video_url + last_frame_url back to scene_node_data.shots", async () => {
    // Runner returns per_shot_results with full URL set so we can assert
    // they land on the persisted ShotSpec fields (the `fix_continuity`
    // helper reads `prior.last_frame_url` from this exact path).
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_ctx: unknown, scene: { id: string }) => ({
        ok: true,
        composite_video_asset_id: `vid-${scene.id}`,
        composite_video_url: `https://r2/vid-${scene.id}.mp4`,
        per_shot_results: [
          {
            shot_id: "shot_01",
            video_asset_id: "va-1",
            video_url: "https://r2/clip-1.mp4",
            last_frame_asset_id: "lf-1",
            last_frame_url: "https://r2/lf-1.png",
          },
          {
            shot_id: "shot_02",
            video_asset_id: "va-2",
            video_url: "https://r2/clip-2.mp4",
            last_frame_asset_id: null, // last shot — no last_frame extraction
            last_frame_url: null,
          },
        ],
      }),
    )

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1, 2) },
      ],
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const persisted = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("scene-1")
    const sceneData = (persisted?.metadata as { scene_node_data?: SceneNodeData })
      ?.scene_node_data
    expect(sceneData).toBeDefined()
    expect(sceneData?.composite_video_url).toBe("https://r2/vid-scene-1.mp4")
    // Each shot should have video_url + last_frame_url written through.
    const shot01 = sceneData?.shots?.find((s) => s.shot_id === "shot_01")
    expect(shot01?.video_url).toBe("https://r2/clip-1.mp4")
    expect(shot01?.video_asset_id).toBe("va-1")
    expect(shot01?.last_frame_url).toBe("https://r2/lf-1.png")
    expect(shot01?.last_frame_asset_id).toBe("lf-1")
    const shot02 = sceneData?.shots?.find((s) => s.shot_id === "shot_02")
    expect(shot02?.video_url).toBe("https://r2/clip-2.mp4")
    // last_frame_* is null on the final shot — nothing to extract — but the
    // shot fixture didn't carry one either, so it should remain undefined,
    // NOT overwritten with null.
    expect(shot02?.last_frame_url).toBeUndefined()
  })
})
