import { describe, it, expect, vi } from "vitest"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"
import {
  runShotRealignment,
  realignSceneShots,
  isOnBeat,
  nearestBeatWithinWindow,
} from "../sub-steps/shot-realignment.js"

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeShot(id: string, duration: number): ShotSpec {
  return {
    shot_id: id,
    camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    shot_intensity_kind: "establishing_shot",
    action: "x",
    dialogue_line: null,
    duration_seconds: duration,
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
    visual_keyframe_prompt: "x",
    has_dialogue: false,
  } as ShotSpec
}

function makeSceneNodeData(shots: ShotSpec[]): SceneNodeData {
  return {
    scene_index: 1,
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
  } as SceneNodeData
}

interface SceneFixture {
  id: string
  entity_key: string
  scene_node_data?: SceneNodeData
}

function makeSupabase(scenes: SceneFixture[]) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const s of scenes) {
    entities.set(s.id, {
      id: s.id,
      entity_key: s.entity_key,
      metadata: s.scene_node_data ? { scene_node_data: s.scene_node_data } : {},
    })
  }
  return {
    from: (table: string) => {
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
  } as never
}

// ─── Tests: top-level orchestrator ───────────────────────────────────────────

describe("runShotRealignment", () => {
  it("1. no BPM drift (within ±2) → returns ok with no shifts, no warnings", async () => {
    const supabase = makeSupabase([
      {
        id: "scene-1",
        entity_key: "scene_01",
        scene_node_data: makeSceneNodeData([
          makeShot("shot_01", 3.0),
          makeShot("shot_02", 2.5),
        ]),
      },
    ])

    const result = await runShotRealignment({
      supabase,
      pipelineId: "p1",
      detectedBPM: 120,
      plannedBPM: 121,
      beatGrid: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0],
    })

    expect(result.ok).toBe(true)
    expect(result.realignedShots).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it("5. no beat grid → returns empty (no-op)", async () => {
    const supabase = makeSupabase([
      {
        id: "scene-1",
        entity_key: "scene_01",
        scene_node_data: makeSceneNodeData([makeShot("shot_01", 3.0)]),
      },
    ])

    const result = await runShotRealignment({
      supabase,
      pipelineId: "p1",
      detectedBPM: 120,
      plannedBPM: 90, // big drift, but no beats → still no-op
      beatGrid: [],
    })

    expect(result.ok).toBe(true)
    expect(result.realignedShots).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it("2. single shot needs ±1 beat shift, within scene budget → applied", async () => {
    // detectedBPM=120 → beat interval 0.5s. Beat grid at 0.5s, 1.0s, 1.5s, 2.0s, 2.5s.
    // Shot 1 = 1.3s ends at 1.3s (not on-beat). Nearest beat: 1.5s (Δ=0.2s, within 0.5s interval).
    // Shift = +0.2s, within ±0.3s budget. Apply.
    const supabase = makeSupabase([
      {
        id: "scene-1",
        entity_key: "scene_01",
        scene_node_data: makeSceneNodeData([
          makeShot("shot_01", 1.3),
          makeShot("shot_02", 1.0), // ends at 1.5+1.0=2.5 (on-beat)
        ]),
      },
    ])

    const result = await runShotRealignment({
      supabase,
      pipelineId: "p1",
      detectedBPM: 120,
      plannedBPM: 100, // 20 BPM drift triggers
      beatGrid: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    })

    expect(result.ok).toBe(true)
    expect(result.realignedShots).toHaveLength(1)
    expect(result.realignedShots[0]?.shot_id).toBe("shot_01")
    expect(result.realignedShots[0]?.original_duration_sec).toBe(1.3)
    expect(result.realignedShots[0]?.realigned_duration_sec).toBeCloseTo(1.5, 3)

    // Persisted back to entity.
    const persisted = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("scene-1")
    const sceneData = (persisted?.metadata as { scene_node_data: SceneNodeData })
      .scene_node_data
    expect(sceneData.shots[0]?.duration_seconds).toBeCloseTo(1.5, 3)
  })

  it("3. shift exceeds ±0.3s scene budget → skipped with warning", async () => {
    // Shot ends at 1.0s; nearest beat within 1 beat interval (0.5s) is 1.4s
    // (Δ=0.4s). 0.4s > 0.3s budget → skip + warn.
    const supabase = makeSupabase([
      {
        id: "scene-1",
        entity_key: "scene_01",
        scene_node_data: makeSceneNodeData([makeShot("shot_01", 1.0)]),
      },
    ])

    const result = await runShotRealignment({
      supabase,
      pipelineId: "p1",
      detectedBPM: 120,
      plannedBPM: 90,
      beatGrid: [1.4, 1.9, 2.4],
    })

    expect(result.ok).toBe(true)
    expect(result.realignedShots).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toMatch(/budget_exceeded/)

    // No persist on skip — original duration preserved.
    const persisted = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("scene-1")
    const sceneData = (persisted?.metadata as { scene_node_data: SceneNodeData })
      .scene_node_data
    expect(sceneData.shots[0]?.duration_seconds).toBe(1.0)
  })

  it("4. multiple shots in one scene → cumulative budget respected", async () => {
    // detectedBPM=120 → beat interval 0.5s. Snap window ±0.1s, budget ±0.3s.
    // Beat grid at 1.15, 2.30, 3.45 (sparse — gap 1.15s > beat interval).
    // Shot 1 = 1.0s → ends 1.0, not on-beat (Δ to 1.15 is 0.15 > 0.1).
    //   nearest within ±0.5 interval = 1.15 (Δ=+0.15). shift=+0.15, cumulative=+0.15. Apply.
    // Shot 2 = 1.0s → ends 1.15+1.0=2.15, not on-beat (Δ to 2.30 = 0.15 > 0.1).
    //   nearest within ±0.5 interval = 2.30 (Δ=+0.15). shift=+0.15, cumulative=+0.30. Apply.
    // Shot 3 = 1.0s → ends 2.30+1.0=3.30, not on-beat (Δ to 3.45 = 0.15 > 0.1).
    //   nearest = 3.45 (Δ=+0.15). cumulative would be +0.45. > 0.3 budget → skip + warn.
    const supabase = makeSupabase([
      {
        id: "scene-1",
        entity_key: "scene_01",
        scene_node_data: makeSceneNodeData([
          makeShot("shot_01", 1.0),
          makeShot("shot_02", 1.0),
          makeShot("shot_03", 1.0),
        ]),
      },
    ])

    const result = await runShotRealignment({
      supabase,
      pipelineId: "p1",
      detectedBPM: 120,
      plannedBPM: 90,
      beatGrid: [1.15, 2.30, 3.45],
    })

    expect(result.ok).toBe(true)
    // First 2 shots shifted; 3rd should be in warnings.
    expect(result.realignedShots).toHaveLength(2)
    expect(result.realignedShots.map((r) => r.shot_id).sort()).toEqual([
      "shot_01",
      "shot_02",
    ])
    expect(result.warnings.some((w) => /shot_03/.test(w) && /budget_exceeded/.test(w))).toBe(true)
  })
})

// ─── Tests: pure helpers ────────────────────────────────────────────────────

describe("isOnBeat", () => {
  it("returns true within window", () => {
    expect(isOnBeat(1.0, [0.5, 1.0, 1.5], 0.1)).toBe(true)
    expect(isOnBeat(1.05, [0.5, 1.0, 1.5], 0.1)).toBe(true)
  })
  it("returns false outside window", () => {
    expect(isOnBeat(1.2, [0.5, 1.0, 1.5], 0.1)).toBe(false)
  })
})

describe("nearestBeatWithinWindow", () => {
  it("returns nearest beat within ±interval", () => {
    expect(nearestBeatWithinWindow(1.2, [0.5, 1.0, 1.5, 2.0], 0.5)).toBe(1.0)
    expect(nearestBeatWithinWindow(1.3, [0.5, 1.0, 1.5, 2.0], 0.5)).toBe(1.5)
  })
  it("returns null when no beat within window", () => {
    expect(nearestBeatWithinWindow(5.0, [0.5, 1.0, 1.5], 0.5)).toBe(null)
  })
})

describe("realignSceneShots — pure", () => {
  it("returns empty result + no warnings when scene already aligned", () => {
    const shots = [makeShot("shot_01", 0.5), makeShot("shot_02", 0.5)]
    const result = realignSceneShots(shots, 0, [0.5, 1.0, 1.5], 0.5)
    expect(result.shifts).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it("applies shift when nearest beat is within bounds", () => {
    // Shot=0.5s ends at 0.5. Beat at 0.65 is within 0.5 (beatInterval) but
    // NOT within snap window 0.1 of 0.5 → triggers realignment. Δ=+0.15.
    // New duration = 0.65 ≥ SHOT_MIN_DURATION (0.3). Apply.
    const shots = [makeShot("shot_01", 0.5)]
    const result = realignSceneShots(shots, 0, [0.65], 0.5)
    expect(result.shifts).toHaveLength(1)
    expect(result.shifts[0]?.realigned_duration_sec).toBeCloseTo(0.65, 3)
  })

  it("skips when candidate duration falls below SHOT_MIN_DURATION", () => {
    // Shot=0.4s ends at 0.4. Beat at 0.2 is within 0.5 (beatInterval) and
    // NOT within 0.1 (Δ=0.2 > snap window). Candidate new duration = 0.2,
    // which is below SHOT_MIN_DURATION (0.3) → skip + warn.
    const shots = [makeShot("shot_01", 0.4)]
    const result = realignSceneShots(shots, 0, [0.2], 0.5)
    expect(result.shifts).toEqual([])
    expect(result.warnings.some((w) => /candidate_out_of_bounds/.test(w))).toBe(true)
  })
})

// Suppress unused-import warning when tests don't use vi
void vi
