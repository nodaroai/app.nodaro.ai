import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock continuity helpers + service wrapper before importing the SUT so the
// SUT's static imports pick up the mocks. Path strings are relative to the
// SUT (`stages/scene-images.ts`), NOT to this test file.
vi.mock("../services/pipeline-generate-image.js", () => ({
  pipelineGenerateImage: vi.fn(),
}))
vi.mock("../continuity.js", () => ({
  allocateReferenceSlots: vi.fn().mockResolvedValue([]),
}))
vi.mock("../depends-on.js", () => ({
  transitionStageEntityNodesAndEmit: vi.fn(),
}))
vi.mock("../stage-utils.js", () => ({
  ensureStageRow: vi.fn().mockResolvedValue("stage-6"),
  failStage: vi.fn(),
}))

import { pipelineGenerateImage } from "../services/pipeline-generate-image.js"
import { allocateReferenceSlots } from "../continuity.js"
import { failStage } from "../stage-utils.js"
import { runSceneImagesStage } from "../stages/scene-images.js"

beforeEach(() => vi.clearAllMocks())

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fakePlan = {
  title: "x",
  logline: "x",
  target_duration_seconds: 60,
  format: "short_film",
  output_resolution: "1080p",
  language: "en",
  genre: "drama",
  tone: [],
  cast: [],
  locations: [],
  objects: [],
  scenes: [],
  beats: [],
  has_narrator: false,
  narrator_profile: null,
  music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
  global_style: {
    visual_style: "x",
    color_palette: "x",
    lighting: "x",
    camera_language: "x",
  },
  total_duration_seconds: 60,
  estimated_scene_count: 0,
  warnings: [],
}

function makeShot(id: string) {
  return {
    shot_id: id,
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
    visual_keyframe_prompt: `prompt for ${id}`,
  }
}

function makeSceneNodeData(idx: number, shotCount: number) {
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
    shots: Array.from({ length: shotCount }, (_, i) =>
      makeShot(`shot_${String(i + 1).padStart(2, "0")}`),
    ),
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
  }
}

// Build a supabase mock that returns N scene entities, optionally including
// one with no scene_node_data to drive the missing-data branch.
function makeSupabase(
  opts: {
    scenes: Array<{ id: string; entity_key: string; scene_node_data?: unknown }>
    planAvailable?: boolean
    initialStageStatus?: string
  } = { scenes: [] },
) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const s of opts.scenes) {
    entities.set(s.id, {
      id: s.id,
      entity_key: s.entity_key,
      metadata: s.scene_node_data !== undefined ? { scene_node_data: s.scene_node_data } : {},
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
                // ensureStageRow re-fetch via .eq("id").maybeSingle()
                return {
                  maybeSingle: async () => ({
                    data: opts.initialStageStatus
                      ? { status: opts.initialStageStatus }
                      : { status: "running" },
                    error: null,
                  }),
                }
              }
              // .eq("pipeline_id").eq("stage_name").single() — load script output
              return {
                eq: () => ({
                  single: async () => ({
                    data: opts.planAvailable === false
                      ? null
                      : { output: { plan: fakePlan } },
                    error: null,
                  }),
                }),
              }
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
              // resolveEntityKeysToIds + allocateReferenceSlots paths use
              // .eq().in() — they aren't reached in these tests because
              // we mock allocateReferenceSlots.
              in: async () => ({ data: [], error: null }),
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
      // pipeline_entity_nodes — markStageEntityNodesState target. Empty
      // result so transitionStageEntityNodesAndEmit no-ops.
      if (table === "pipeline_entity_nodes") {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          update: () => ({
            eq: async () => ({ data: null, error: null }),
            in: async () => ({ data: null, error: null }),
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

describe("runSceneImagesStage", () => {
  it("generates keyframes for every shot in every scene + transitions to awaiting_approval", async () => {
    // 2 scenes × 3 shots = 6 expected pipelineGenerateImage calls.
    const generateImage = pipelineGenerateImage as ReturnType<typeof vi.fn>
    let callCount = 0
    generateImage.mockImplementation(async () => {
      callCount++
      return {
        jobId: `job-${callCount}`,
        assetId: `asset-${callCount}`,
        assetUrl: `https://r2/kf-${callCount}.png`,
        creditsSpent: 2,
      }
    })

    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1, 3) },
        { id: "scene-2", entity_key: "scene_02", scene_node_data: makeSceneNodeData(2, 3) },
      ],
    })

    await runSceneImagesStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(generateImage).toHaveBeenCalledTimes(6)
    // 2 transition calls (running + awaiting_approval) — verified via mock count.
    // (Transition helper is mocked; the import is unused here but the call
    // count is what matters.)
    expect(failStage).not.toHaveBeenCalled()
    // The stage update to awaiting_approval should have landed.
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.some((u) => u.status === "awaiting_approval")).toBe(true)

    // Each scene's metadata.scene_node_data.shots[N] should now carry
    // keyframe_asset_id + keyframe_url. We persist per-scene with a single
    // UPDATE, so checking scene-1 confirms the wiring.
    const entities = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities
    const scene1 = entities.get("scene-1")! as {
      metadata: { scene_node_data: { shots: Array<{ keyframe_url?: string; keyframe_asset_id?: string }> } }
    }
    expect(scene1.metadata.scene_node_data.shots).toHaveLength(3)
    for (const shot of scene1.metadata.scene_node_data.shots) {
      expect(shot.keyframe_url).toMatch(/^https:\/\/r2\/kf-/)
      expect(shot.keyframe_asset_id).toMatch(/^asset-/)
    }
  })

  it("fails the stage when a scene has missing scene_node_data", async () => {
    const supabase = makeSupabase({
      scenes: [
        // Empty metadata → scene_node_data missing → inner helper returns {ok: false}
        { id: "scene-1", entity_key: "scene_01", scene_node_data: undefined },
      ],
    })

    await runSceneImagesStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    const failCallArgs = (failStage as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(failCallArgs?.[2]).toMatch(/scene_keyframe_gen_failed/)
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
  })

  it("respects bounded cross-scene concurrency (max 5 scenes in parallel)", async () => {
    // 6 scenes, 1 shot each. Track concurrent calls — should never exceed 5.
    let inFlight = 0
    let peak = 0
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      // Yield to let the scheduler run other scene tasks; without this the
      // synchronous chain would resolve all 6 in one tick and inflate the peak.
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return {
        jobId: "j",
        assetId: "a",
        assetUrl: "https://r2/kf.png",
        creditsSpent: 2,
      }
    })

    const supabase = makeSupabase({
      scenes: Array.from({ length: 6 }, (_, i) => ({
        id: `scene-${i + 1}`,
        entity_key: `scene_${String(i + 1).padStart(2, "0")}`,
        scene_node_data: makeSceneNodeData(i + 1, 1),
      })),
    })

    await runSceneImagesStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    // CROSS_SCENE_CONCURRENCY is 5; per-scene shot gen is sequential.
    expect(peak).toBeLessThanOrEqual(5)
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(6)
    // allocateReferenceSlots called once per shot.
    expect(allocateReferenceSlots).toHaveBeenCalledTimes(6)
  })

  it("fails the stage when the Showrunner plan is missing", async () => {
    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1, 1) },
      ],
      planAvailable: false,
    })

    await runSceneImagesStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(failStage).toHaveBeenCalledTimes(1)
    expect((failStage as ReturnType<typeof vi.fn>).mock.calls[0]?.[2]).toBe(
      "showrunner_plan_missing",
    )
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
  })

  it("is a no-op when the stage is already awaiting_approval", async () => {
    const supabase = makeSupabase({
      scenes: [
        { id: "scene-1", entity_key: "scene_01", scene_node_data: makeSceneNodeData(1, 1) },
      ],
      initialStageStatus: "awaiting_approval",
    })

    await runSceneImagesStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(pipelineGenerateImage).not.toHaveBeenCalled()
    expect(failStage).not.toHaveBeenCalled()
  })
})
