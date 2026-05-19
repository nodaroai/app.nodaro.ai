import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import.
// ---------------------------------------------------------------------------

vi.mock("../../../lib/settled-with-limit.js", () => ({
  settledWithLimit: vi.fn(async (tasks: Array<() => Promise<unknown>>) =>
    Promise.all(tasks.map(async (t) => ({ status: "fulfilled", value: await t() }))),
  ),
}))

vi.mock("../../services/pipeline-generate-image.js", () => ({
  pipelineGenerateImage: vi.fn(),
}))
vi.mock("../../continuity.js", () => ({
  allocateReferenceSlots: vi.fn().mockResolvedValue([]),
}))
vi.mock("../../depends-on.js", () => ({
  transitionStageEntityNodesAndEmit: vi.fn(),
}))
vi.mock("../../stage-utils.js", () => ({
  ensureStageRow: vi.fn().mockResolvedValue("stage-6"),
  failStage: vi.fn(),
}))
vi.mock("../../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))

// Mock the match-cut orchestrator — this is the SUT dependency we control.
vi.mock("../../match-cut-orchestrator.js", () => ({
  runMatchCutOrchestrator: vi.fn(),
}))

import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { failStage } from "../../stage-utils.js"
import { pipelineEvents } from "../../events.js"
import { runMatchCutOrchestrator } from "../../match-cut-orchestrator.js"
import { runSceneImagesStage } from "../scene-images.js"

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

function makeShot(id: string, isMatchCut = false) {
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
      is_match_cut: isMatchCut,
    },
    visual_keyframe_prompt: `prompt for ${id}`,
  }
}

function makeSceneNodeData(idx: number, shots: ReturnType<typeof makeShot>[]) {
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
    shots,
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
  }
}

/**
 * Build a supabase mock with stage-output tracking.
 * The `stageOutputs` array captures every `pipeline_stages.update(patch)` call.
 */
function makeSupabase(opts: {
  scenes: Array<{ id: string; entity_key: string; scene_node_data?: unknown }>
  initialStageStatus?: string
  initialStageOutput?: Record<string, unknown>
} = { scenes: [] }) {
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
                return {
                  maybeSingle: async () => ({
                    data: {
                      status: opts.initialStageStatus ?? "running",
                      output: opts.initialStageOutput ?? null,
                    },
                    error: null,
                  }),
                }
              }
              // .eq("pipeline_id").eq("stage_name").single() — load script output
              return {
                eq: () => ({
                  single: async () => ({
                    data: { output: { plan: fakePlan } },
                    error: null,
                  }),
                  maybeSingle: async () => ({
                    data: { output: { plan: fakePlan } },
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
                in: async () => ({ data: [], error: null }),
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

describe("Stage 6 match-cut orchestrator integration (Phase 1D.1)", () => {
  it("C1-1: calls runMatchCutOrchestrator for each scene after keyframes are generated", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/kf.png",
      creditsSpent: 2,
    })
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdicts: {},
      pendingBreaks: [],
    })

    const shots = [makeShot("s1"), makeShot("s2")]
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, shots),
        },
        {
          id: "scene-2",
          entity_key: "scene_02",
          scene_node_data: makeSceneNodeData(2, shots),
        },
      ],
    })

    await runSceneImagesStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })

    // One orchestrator call per scene.
    expect(runMatchCutOrchestrator).toHaveBeenCalledTimes(2)
    expect(runMatchCutOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ pipelineId: "p1", stageId: "stage-6", userId: "u1" }),
    )
  })

  it("C1-2: advances to awaiting_approval when pendingBreaks is empty for all scenes", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/kf.png",
      creditsSpent: 2,
    })
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdicts: {},
      pendingBreaks: [],
    })

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1")]),
        },
      ],
    })

    await runSceneImagesStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })

    const updates = (supabase as never as { _stageUpdates: Array<Record<string, unknown>> })
      ._stageUpdates
    // Stage should end up at awaiting_approval (no sub-gate).
    expect(updates.some((u) => u.status === "awaiting_approval" && !("current_sub_gate" in ((u.output as Record<string, unknown>) ?? {})))).toBe(true)
    expect(failStage).not.toHaveBeenCalled()
    // Verify SSE event emitted.
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ type: "stage:status", status: "awaiting_approval" }),
    )
  })

  it("C1-3: sets match_cut_break_pending sub-gate when pendingBreaks is non-empty", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/kf.png",
      creditsSpent: 2,
    })
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdicts: { s1: { shot_pair: ["s1", "s2"], match_strength: "break", suggested_adjustments: "redo", checked_at: "2026-05-20T00:00:00Z" } },
      pendingBreaks: ["s1"],
    })

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1", true), makeShot("s2")]),
        },
      ],
    })

    await runSceneImagesStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })

    const updates = (supabase as never as { _stageUpdates: Array<Record<string, unknown>> })
      ._stageUpdates
    // Stage should end up awaiting_approval WITH current_sub_gate = "match_cut_break_pending".
    const subGateUpdate = updates.find(
      (u) =>
        u.status === "awaiting_approval" &&
        (u.output as Record<string, unknown>)?.current_sub_gate === "match_cut_break_pending",
    )
    expect(subGateUpdate).toBeDefined()

    const outputPayload = subGateUpdate!.output as Record<string, unknown>
    expect(outputPayload.match_cut_break_pending).toEqual(["s1"])

    // Verify SSE event emitted.
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "stage:awaiting_sub_gate",
        subGate: "match_cut_break_pending",
      }),
    )
  })

  it("C1-4: persists match_cut_verdicts in stage output after orchestrator runs", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/kf.png",
      creditsSpent: 2,
    })
    const verdict = {
      shot_pair: ["s1", "s2"] as [string, string],
      match_strength: "strong" as const,
      suggested_adjustments: "none",
      checked_at: "2026-05-20T00:00:00Z",
    }
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdicts: { s1: verdict },
      pendingBreaks: [],
    })

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1", true), makeShot("s2")]),
        },
      ],
    })

    await runSceneImagesStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })

    const updates = (supabase as never as { _stageUpdates: Array<Record<string, unknown>> })
      ._stageUpdates
    const finalUpdate = updates.find((u) => u.status === "awaiting_approval")
    expect(finalUpdate).toBeDefined()
    const output = finalUpdate!.output as Record<string, unknown>
    expect(output.match_cut_verdicts).toMatchObject({ s1: { match_strength: "strong" } })
    expect(output.match_cut_break_pending).toEqual([])
  })

  it("C1-5: fails the stage when runMatchCutOrchestrator throws", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/kf.png",
      creditsSpent: 2,
    })
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("vision api down"),
    )

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1")]),
        },
      ],
    })

    await expect(
      runSceneImagesStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" }),
    ).rejects.toThrow("vision api down")
  })
})
