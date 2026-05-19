import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SceneNodeData } from "@nodaro/shared"

// Mock every sub-step module + helpers BEFORE importing the SUT.
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
vi.mock("../services/pipeline-final-merge.js", () => ({
  pipelineFinalMerge: vi.fn(),
}))
vi.mock("../sub-steps/dialogue-recheck.js", () => ({
  runDialogueRecheck: vi.fn(),
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

import { runSceneInternalPipeline } from "../scene-internal-pipeline.js"
import { failStage } from "../stage-utils.js"
import { transitionStageEntityNodesAndEmit } from "../depends-on.js"
import { pipelineEvents } from "../events.js"
import { pipelineFinalMerge } from "../services/pipeline-final-merge.js"
import { runDialogueRecheck } from "../sub-steps/dialogue-recheck.js"
import { runSilentCutReview } from "../sub-steps/silent-cut-review.js"
import { runShotRealignment } from "../sub-steps/shot-realignment.js"
import { runMusicTimeline } from "../music-timeline.js"
import { runEditor } from "../llms/editor.js"
import { runAnimateAudioEditStage } from "../stages/animate-audio-edit.js"

beforeEach(() => {
  vi.clearAllMocks()
  // Defaults: happy-path sub-step returns.
  ;(runDialogueRecheck as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    rebalances: [],
    warnings: [],
    awaitingUserDecision: false,
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
  ;(runEditor as ReturnType<typeof vi.fn>).mockResolvedValue({
    cut_decisions: [],
  })
  ;(pipelineFinalMerge as ReturnType<typeof vi.fn>).mockResolvedValue({
    finalAssetId: "asset-final",
    finalAssetUrl: "https://r2/final.mp4",
  })
})

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
      has_dialogue: false,
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
  initialStageStatus?: string
  initialStageOutput?: Record<string, unknown>
  pipelineConfig?: Record<string, unknown>
  pipelineMode?: "manual" | "auto" | "guided"
  targetDurationSeconds?: number
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
  let stageOutput: Record<string, unknown> = { ...(opts.initialStageOutput ?? {}) }

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
                      status: opts.initialStageStatus ?? "running",
                    }
                    if ((cols ?? "").includes("output")) {
                      data.output = stageOutput
                    }
                    return { data, error: null }
                  },
                }
              }
              if (col1 === "pipeline_id") {
                // loadShowrunnerPlan
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
                  config: opts.pipelineConfig ?? {},
                  mode: opts.pipelineMode ?? "manual",
                  target_duration_seconds: opts.targetDurationSeconds ?? 60,
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
    _entities: entities,
    _stageUpdates: stageUpdates,
  } as never
}

describe("runAnimateAudioEditStage — Phase 1C.2 sub-step chain", () => {
  // ─── Per-scene loop (preserved from 1C.1) ──────────────────────────────

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
      pipelineMode: "auto",
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
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "approved")).toBe(true)
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
      pipelineMode: "auto",
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

  it("fails the stage when a scene returns continuity_break — no sub-steps run", async () => {
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
      pipelineConfig: { shot_generation_mode: "sequential" },
      pipelineMode: "auto",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    expect((failStage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toMatch(/1 scenes failed/)
    expect(runDialogueRecheck).not.toHaveBeenCalled()
    expect(pipelineFinalMerge).not.toHaveBeenCalled()
  })

  it("defaults shot_generation_mode to 'parallel' when config is empty", async () => {
    const observed: Array<Record<string, unknown>> = []
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
      async (
        _ctx: unknown,
        scene: { id: string },
        options: Record<string, unknown>,
      ) => {
        observed.push(options)
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
      pipelineConfig: {},
      pipelineMode: "auto",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(observed[0]?.mode).toBe("parallel")
    expect(observed[0]?.runImageCritic).toBe(false)
    expect(observed[0]?.lipSyncEnabled).toBe(true)
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
  })

  // ─── Phase 1C.2 H1 — Sub-step chain ──────────────────────────────────

  function setupHappyScenes() {
    ;(runSceneInternalPipeline as ReturnType<typeof vi.fn>).mockImplementation(
      async (_ctx: unknown, scene: { id: string }) => ({
        ok: true,
        composite_video_asset_id: `vid-${scene.id}`,
        composite_video_url: `https://r2/vid-${scene.id}.mp4`,
        per_shot_results: [],
      }),
    )
  }

  it("H1: auto mode — full chain runs end-to-end, no pauses, final_merge called", async () => {
    setupHappyScenes()
    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
        { id: "scene-2", entity_key: "scene_02", scene_node_data: makeSceneNodeData(2) },
      ],
      pipelineMode: "auto",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runDialogueRecheck).toHaveBeenCalledTimes(1)
    expect(runSilentCutReview).toHaveBeenCalledTimes(1)
    expect(runMusicTimeline).toHaveBeenCalledTimes(1)
    expect(runEditor).toHaveBeenCalledTimes(1)
    expect(pipelineFinalMerge).toHaveBeenCalledTimes(1)
    expect((runDialogueRecheck as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject(
      { mode: "auto" },
    )
    expect((runSilentCutReview as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toMatchObject(
      { mode: "auto" },
    )
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "approved")).toBe(true)
    expect(stageUpdates.some((u) => u.status === "awaiting_approval")).toBe(false)
    expect(failStage).not.toHaveBeenCalled()
  })

  it("H1: manual mode + dialogue_recheck rebalance — pauses at sub-gate, no downstream calls", async () => {
    setupHappyScenes()
    ;(runDialogueRecheck as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      rebalances: [
        {
          scene_entity_id: "scene-1",
          shot_id: "shot_01",
          delta_sec: 1.5,
          new_intended_duration_sec: 6.5,
        },
      ],
      warnings: ["scene_total_drift"],
      awaitingUserDecision: true,
    })

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "manual",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runDialogueRecheck).toHaveBeenCalledTimes(1)
    expect(runSilentCutReview).not.toHaveBeenCalled()
    expect(runMusicTimeline).not.toHaveBeenCalled()
    expect(runEditor).not.toHaveBeenCalled()
    expect(pipelineFinalMerge).not.toHaveBeenCalled()
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "awaiting_approval")).toBe(true)
    expect(stageUpdates.some((u) => u.status === "approved")).toBe(false)
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(
      publishCalls.some(
        (c) =>
          (c[0] as { type?: string }).type === "stage:awaiting_sub_gate" &&
          (c[0] as { subGate?: string }).subGate === "dialogue_recheck",
      ),
    ).toBe(true)
  })

  it("H1: manual mode + silent_cut paused — no music/editor/final_merge", async () => {
    setupHappyScenes()
    ;(runSilentCutReview as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      previewUrl: "https://r2/silent-preview.mp4",
      awaitingApproval: true,
    })

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "manual",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runDialogueRecheck).toHaveBeenCalledTimes(1)
    expect(runSilentCutReview).toHaveBeenCalledTimes(1)
    expect(runMusicTimeline).not.toHaveBeenCalled()
    expect(runEditor).not.toHaveBeenCalled()
    expect(pipelineFinalMerge).not.toHaveBeenCalled()
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "awaiting_approval")).toBe(true)
    expect(stageUpdates.some((u) => u.status === "approved")).toBe(false)
  })

  it("H1 regression: silent_cut pause persists preview_url + current_sub_gate on stage row (regression from a0a23642)", async () => {
    setupHappyScenes()
    ;(runSilentCutReview as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      previewUrl: "https://r2/silent-preview.mp4",
      awaitingApproval: true,
    })

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "manual",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    // Find the setSubGate update that wrote both `output` + `status='awaiting_approval'`.
    const subGateWrite = stageUpdates.find(
      (u) =>
        u.status === "awaiting_approval" &&
        typeof u.output === "object" &&
        u.output !== null,
    )
    expect(subGateWrite).toBeDefined()
    const output = subGateWrite!.output as Record<string, unknown>
    expect(output.silent_cut_preview_url).toBe("https://r2/silent-preview.mp4")
    expect(output.current_sub_gate).toBe("silent_cut_preview")
    // sub_step_completed must be present so the resume run uses the right map.
    expect(output.sub_step_completed).toBeDefined()
    // The orchestrator emits the SSE event itself via setSubGate.
    const publishCalls = (pipelineEvents.publish as ReturnType<typeof vi.fn>).mock.calls
    expect(
      publishCalls.some(
        (c) =>
          (c[0] as { type?: string }).type === "stage:awaiting_sub_gate" &&
          (c[0] as { subGate?: string }).subGate === "silent_cut_preview",
      ),
    ).toBe(true)
  })

  it("H1: resume from silent_cut — completed map causes chain to skip past 7d'+7e'", async () => {
    setupHappyScenes()
    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "manual",
      initialStageOutput: {
        sub_step_completed: { dialogue_recheck: true, silent_cut: true },
      },
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runDialogueRecheck).not.toHaveBeenCalled()
    expect(runSilentCutReview).not.toHaveBeenCalled()
    expect(runMusicTimeline).toHaveBeenCalledTimes(1)
    expect(runEditor).toHaveBeenCalledTimes(1)
    expect(pipelineFinalMerge).toHaveBeenCalledTimes(1)
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "approved")).toBe(true)
  })

  it("H1: music disabled — runEditor gets empty beatGrid; final_merge gets empty url", async () => {
    setupHappyScenes()
    ;(runMusicTimeline as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      enabled: false,
      musicAssetUrl: "",
      beatGrid: [],
      detectedBPM: 0,
      plannedBPM: 0,
      realignmentNeeded: false,
    })

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineConfig: { music_enabled: false },
      pipelineMode: "auto",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runEditor).toHaveBeenCalledTimes(1)
    expect(
      (runEditor as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({ beatGrid: [] })
    expect(pipelineFinalMerge).toHaveBeenCalledTimes(1)
    expect(
      (pipelineFinalMerge as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({ musicAssetUrl: "" })
    expect(runShotRealignment).not.toHaveBeenCalled()
  })

  it("H1: realignment runs only when music timeline reports BPM drift", async () => {
    setupHappyScenes()
    ;(runMusicTimeline as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      enabled: true,
      musicAssetUrl: "https://r2/music.mp3",
      beatGrid: [0.5, 1.0, 1.5],
      detectedBPM: 128,
      plannedBPM: 120,
      realignmentNeeded: true,
    })

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "auto",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runShotRealignment).toHaveBeenCalledTimes(1)
    expect(
      (runShotRealignment as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toMatchObject({ detectedBPM: 128, plannedBPM: 120 })
  })

  it("H1: Editor LLM failure propagates — no final_merge call", async () => {
    setupHappyScenes()
    ;(runEditor as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Editor LLM exploded"),
    )

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "auto",
    })

    let threw = false
    try {
      await runAnimateAudioEditStage({
        supabase,
        pipelineId: "p1",
        userId: "u1",
        userTier: "pro",
      })
    } catch {
      threw = true
    }

    expect(pipelineFinalMerge).not.toHaveBeenCalled()
    expect(threw || (failStage as ReturnType<typeof vi.fn>).mock.calls.length > 0).toBe(true)
  })

  it("H1 regression: editor crash AFTER music success flushes completed.music=true so resume skips music re-pay (regression from a0a23642)", async () => {
    setupHappyScenes()
    ;(runEditor as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Editor LLM exploded"),
    )

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "auto",
    })

    try {
      await runAnimateAudioEditStage({
        supabase,
        pipelineId: "p1",
        userId: "u1",
        userTier: "pro",
      })
    } catch {
      // Expected — editor throws.
    }

    // The finally block MUST have flushed `completed.music = true` to the
    // stage row so the next worker resume reads it back and skips
    // runMusicTimeline (which is paid via Suno).
    expect(runMusicTimeline).toHaveBeenCalledTimes(1)
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    const outputFlush = stageUpdates.find(
      (u) =>
        u.output &&
        typeof u.output === "object" &&
        ((u.output as Record<string, unknown>).sub_step_completed as
          | Record<string, boolean>
          | undefined)?.music === true,
    )
    expect(outputFlush).toBeDefined()
    expect(outputFlush!.status).toBeUndefined() // flush only writes `output`, not `status`
  })

  it("H1: final_merge failure — stage fails with final_merge_failed prefix", async () => {
    setupHappyScenes()
    ;(pipelineFinalMerge as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("FFmpeg crashed"),
    )

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "auto",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    const failCall = (failStage as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(failCall?.[2]).toMatch(/^final_merge_failed:/)
  })

  it("H1: transitions SceneNodes running -> awaiting_approval on full happy path", async () => {
    setupHappyScenes()
    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1) },
      ],
      pipelineMode: "auto",
    })

    await runAnimateAudioEditStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(transitionStageEntityNodesAndEmit).toHaveBeenCalledTimes(2)
    const calls = (transitionStageEntityNodesAndEmit as ReturnType<typeof vi.fn>).mock.calls
    expect(calls[0]?.[3]).toBe("pipeline_owned_running")
    expect(calls[1]?.[3]).toBe("pipeline_owned_awaiting_approval")
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stage:status",
        stageName: "animate_audio_edit",
        status: "approved",
      }),
    )
  })
})
