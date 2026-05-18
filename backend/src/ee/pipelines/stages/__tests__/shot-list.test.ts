import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../llms/scene-director.js", () => ({ runSceneDirector: vi.fn() }))
vi.mock("../../llms/shot-list-critic.js", () => ({ runShotListCritic: vi.fn() }))
vi.mock("../../stage-utils.js", () => ({
  ensureStageRow: vi.fn().mockResolvedValue("stage-5"),
  failStage: vi.fn(),
}))

import { runSceneDirector } from "../../llms/scene-director.js"
import { runShotListCritic } from "../../llms/shot-list-critic.js"
import { runShotListStage } from "../shot-list.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  title: "Final Mission",
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
  scenes: [
    {
      scene_index: 1,
      description: "x",
      emotional_beat: "setup",
      duration_seconds: 20,
      cast_keys: [],
      location_key: "x",
      object_keys: [],
      dialogue: [],
      narration: null,
      continuity_from_prev: "hard_cut",
      shot_count_hint: 2,
    },
    {
      scene_index: 2,
      description: "x",
      emotional_beat: "climax",
      duration_seconds: 20,
      cast_keys: [],
      location_key: "x",
      object_keys: [],
      dialogue: [],
      narration: null,
      continuity_from_prev: "hard_cut",
      shot_count_hint: 2,
    },
    {
      scene_index: 3,
      description: "x",
      emotional_beat: "resolution",
      duration_seconds: 20,
      cast_keys: [],
      location_key: "x",
      object_keys: [],
      dialogue: [],
      narration: null,
      continuity_from_prev: "hard_cut",
      shot_count_hint: 2,
    },
  ],
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
  estimated_scene_count: 3,
  warnings: [],
}

const fakeSceneNodeData = (idx: number) => ({
  scene_index: idx,
  description: "x",
  emotional_beat: "setup",
  duration_seconds: 20,
  shot_input_mode: "first_frame",
  cast_keys: [],
  location_key: "x",
  object_keys: [],
  continuity_from_prev: "hard_cut",
  image_model: "nano-banana-2",
  video_model: "kling",
  shots: [
    {
      shot_id: "shot_01",
      camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
      shot_intensity_kind: "establishing_shot",
      action: "x",
      dialogue_line: null,
      duration_seconds: 10,
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
    },
  ],
  scene_anchor_keyframe: null,
  generated_keyframes: [],
  generated_clips: [],
  composite_video: null,
  last_frame: null,
  scene_audio_track: null,
})

function makeSupabase(
  opts: {
    planOverride?: unknown
    initialEntities?: Array<Record<string, unknown>>
  } = {},
) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const e of opts.initialEntities ?? []) entities.set(e.id as string, e)
  const stageUpdates: Array<Record<string, unknown>> = []
  const planForRead = opts.planOverride ?? fakePlan

  // The pipeline_entities table receives:
  //   - `select("id, entity_key, status, metadata").eq().eq().order()` → array of entities
  //   - `select("status").eq().eq()` (no order) → refreshed statuses (post-loop re-fetch)
  // Both must return data — the second chain is awaited directly, so the .eq().eq()
  // result must be PromiseLike. Mirrors characters.test.ts / locations.test.ts pattern.
  const makeEntityEqEqThenable = () => {
    const eqEq = {
      order: async () => ({
        data: Array.from(entities.values()),
        error: null,
      }),
      then: (
        resolve: (v: { data: unknown; error: null }) => unknown,
      ) =>
        resolve({
          data: Array.from(entities.values()),
          error: null,
        }),
    }
    return eqEq
  }

  return {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({ data: { output: { plan: planForRead } }, error: null }),
              }),
            }),
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
          // shot-list.ts batches scene upserts into a single call with an array;
          // accept either shape so existing per-row callers keep working.
          upsert: (
            rowOrRows: Record<string, unknown> | Array<Record<string, unknown>>,
          ) => {
            const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows]
            for (const row of rows) {
              const id = `e-${row.entity_key}`
              if (!entities.has(id)) {
                entities.set(id, { id, ...row })
              }
            }
            return Promise.resolve({ data: null, error: null })
          },
          // select() supports three chains:
          //   .eq().eq().order()           -> entities list (initial)
          //   .eq().eq() awaited directly  -> refreshed status fetch
          //   .eq().in()                   -> resolveEntityKeysToIds lookup
          //   .eq().contains()             -> emitDependentStaleEvents
          select: () => ({
            eq: () => ({
              eq: () => makeEntityEqEqThenable(),
              // depends-on resolveEntityKeysToIds path
              in: async () => ({ data: Array.from(entities.values()), error: null }),
              // C1 emitDependentStaleEvents path — no rows are flagged stale in
              // these tests so an empty array is the right answer.
              contains: async () => ({ data: [], error: null }),
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
      // pipeline_entity_nodes — markEntityNodeState target. No rows exist in
      // these tests (canvas materializer runs at approve time), so the UPDATE
      // is a no-op.
      if (table === "pipeline_entity_nodes") {
        return {
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

describe("runShotListStage", () => {
  it("dispatches Scene Director once per scene, persists each result", async () => {
    ;(runSceneDirector as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(fakeSceneNodeData(1))
      .mockResolvedValueOnce(fakeSceneNodeData(2))
      .mockResolvedValueOnce(fakeSceneNodeData(3))
    ;(runShotListCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: "pass",
      issues: [],
      duration_analysis: {
        target_seconds: 20,
        actual_sum_seconds: 20,
        deviation_percent: 0,
        within_tolerance: true,
      },
    })

    const supabase = makeSupabase()
    await runShotListStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    expect(runSceneDirector).toHaveBeenCalledTimes(3)
    expect(runShotListCritic).toHaveBeenCalledTimes(3)
    const entities = (supabase as never as { _entities: Map<string, Record<string, unknown>> })._entities
    expect(entities.size).toBe(3)
    for (const e of entities.values()) {
      expect(e.status).toBe("awaiting_approval")
    }
  })

  it("retries Scene Director on blocking critic fail (up to 2 retries)", async () => {
    ;(runSceneDirector as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSceneNodeData(1))
    ;(runShotListCritic as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        verdict: "fail",
        issues: [
          {
            severity: "blocking",
            shot_id: "shot_01",
            issue_type: "duration",
            description: "off",
            suggested_fix: "fix it",
          },
        ],
        duration_analysis: {
          target_seconds: 20,
          actual_sum_seconds: 40,
          deviation_percent: 100,
          within_tolerance: false,
        },
      })
      .mockResolvedValue({
        verdict: "pass",
        issues: [],
        duration_analysis: {
          target_seconds: 20,
          actual_sum_seconds: 20,
          deviation_percent: 0,
          within_tolerance: true,
        },
      })

    const planOneScene = { ...fakePlan, scenes: [fakePlan.scenes[0]] }
    const supabase = makeSupabase({ planOverride: planOneScene })

    await runShotListStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    // 1 initial + 1 retry = 2 Scene Director calls; 2 critic calls
    expect(runSceneDirector).toHaveBeenCalledTimes(2)
    expect(runShotListCritic).toHaveBeenCalledTimes(2)
  })

  it("marks scene failed when Scene Director throws", async () => {
    ;(runSceneDirector as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("api down"))

    const supabase = makeSupabase()
    await runShotListStage({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      userTier: "pro",
    })

    const entities = (supabase as never as { _entities: Map<string, Record<string, unknown>> })._entities
    for (const e of entities.values()) {
      expect(e.status).toBe("failed")
    }
    expect(runShotListCritic).not.toHaveBeenCalled()
  })
})
