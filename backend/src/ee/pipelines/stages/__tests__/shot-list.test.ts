import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../llms/scene-director.js", () => ({ runSceneDirector: vi.fn() }))
vi.mock("../../llms/shot-list-critic.js", () => ({ runShotListCritic: vi.fn() }))
vi.mock("../../stage-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../../stage-utils.js")>(
    "../../stage-utils.js",
  )
  return {
    ...actual,
    ensureStageRow: vi.fn().mockResolvedValue("stage-5"),
    failStage: vi.fn(),
  }
})
vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

import { runSceneDirector } from "../../llms/scene-director.js"
import { runShotListCritic } from "../../llms/shot-list-critic.js"
import { enqueuePipelineRun } from "../../queue.js"
import { pipelineEvents } from "../../events.js"
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
    /** Pipeline config row returned for the auto-sequential check. */
    pipelineConfig?: Record<string, unknown>
  } = {},
) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const e of opts.initialEntities ?? []) entities.set(e.id as string, e)
  const stageUpdates: Array<Record<string, unknown>> = []
  const pipelineUpdates: Array<Record<string, unknown>> = []
  const planForRead = opts.planOverride ?? fakePlan
  const pipelineConfig = opts.pipelineConfig ?? {}

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
        // Auto-mode bulk-update path uses a chained .eq().eq().eq() pattern
        // (pipeline_id + entity_type + status filters) that resolves the
        // PostgREST builder without a terminator. Build a chain that tracks
        // every .eq() filter and applies the patch to matching rows on
        // resolution. Mirrors the characters.test.ts helper.
        const makeUpdateChain = (
          patch: Record<string, unknown>,
        ): {
          eq: (col: string, val: unknown) => unknown
        } => {
          const filters: Record<string, unknown> = {}
          const applyPatchAndResolve = () => {
            const matches = Array.from(entities.values()).filter((row) =>
              Object.entries(filters).every(([k, v]) => {
                if (k === "id") return row.id === v
                return row[k] === v
              }),
            )
            for (const row of matches) {
              entities.set(row.id as string, { ...row, ...patch })
            }
            return { data: null, error: null }
          }
          const node: {
            eq: (col: string, val: unknown) => unknown
            then: (resolve: (v: unknown) => unknown) => unknown
          } = {
            eq: (col: string, val: unknown) => {
              filters[col] = val
              return node
            },
            then: (resolve) => resolve(applyPatchAndResolve()),
          }
          return node
        }
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
          update: (patch: Record<string, unknown>) => makeUpdateChain(patch),
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
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { config: pipelineConfig },
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
      throw new Error(`Unmocked table: ${table}`)
    },
    _entities: entities,
    _stageUpdates: stageUpdates,
    _pipelineUpdates: pipelineUpdates,
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

  it("derives ref_images mode when a ref_images video model is pinned (seedance-2)", async () => {
    ;(runSceneDirector as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSceneNodeData(1))
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
      config: { video_model: "seedance-2" },
    })

    expect(runSceneDirector).toHaveBeenCalled()
    for (const call of (runSceneDirector as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).toMatchObject({
        shotInputMode: "ref_images",
        videoModelOverride: "seedance-2",
      })
    }
  })

  it("keeps first_frame mode when a keyframe-only model is pinned (kling-turbo)", async () => {
    ;(runSceneDirector as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSceneNodeData(1))
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
      config: { video_model: "kling-turbo" },
    })

    expect(runSceneDirector).toHaveBeenCalled()
    for (const call of (runSceneDirector as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).toMatchObject({ shotInputMode: "first_frame" })
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

  describe("auto-force sequential mode", () => {
    it("flips shot_generation_mode to 'sequential' when any shot has continuity_with_previous", async () => {
      ;(runSceneDirector as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...fakeSceneNodeData(1),
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
            // The opt-in continuity link that should trigger the auto-force.
            continuity_with_previous: "Hero stays at door",
            shot_intent: {
              needs_multishot_reference: false,
              is_loopable: false,
              needs_music_suppression: true,
              is_match_cut: false,
            },
            visual_keyframe_prompt: "x",
          },
        ],
      })
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

      const planOneScene = { ...fakePlan, scenes: [fakePlan.scenes[0]] }
      const supabase = makeSupabase({
        planOverride: planOneScene,
        pipelineConfig: { shot_generation_mode: "parallel" },
      })

      await runShotListStage({
        supabase,
        pipelineId: "p1",
        userId: "u1",
        userTier: "pro",
      })

      const updates = (
        supabase as never as { _pipelineUpdates: Array<Record<string, unknown>> }
      )._pipelineUpdates
      expect(updates).toHaveLength(1)
      const cfg = updates[0]?.config as { shot_generation_mode?: string }
      expect(cfg.shot_generation_mode).toBe("sequential")
    })

    it("no-op when no shot has continuity_with_previous", async () => {
      // The default fakeSceneNodeData has continuity_with_previous=null on
      // every shot, so the auto-force path should never even read pipelines.config.
      ;(runSceneDirector as ReturnType<typeof vi.fn>).mockResolvedValue(fakeSceneNodeData(1))
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

      const planOneScene = { ...fakePlan, scenes: [fakePlan.scenes[0]] }
      const supabase = makeSupabase({
        planOverride: planOneScene,
        pipelineConfig: { shot_generation_mode: "parallel" },
      })

      await runShotListStage({
        supabase,
        pipelineId: "p1",
        userId: "u1",
        userTier: "pro",
      })

      const updates = (
        supabase as never as { _pipelineUpdates: Array<Record<string, unknown>> }
      )._pipelineUpdates
      expect(updates).toHaveLength(0)
    })

    it("no-op when pipeline is already in sequential mode", async () => {
      ;(runSceneDirector as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...fakeSceneNodeData(1),
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
            continuity_with_previous: "Hero stays at door",
            shot_intent: {
              needs_multishot_reference: false,
              is_loopable: false,
              needs_music_suppression: true,
              is_match_cut: false,
            },
            visual_keyframe_prompt: "x",
          },
        ],
      })
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

      const planOneScene = { ...fakePlan, scenes: [fakePlan.scenes[0]] }
      const supabase = makeSupabase({
        planOverride: planOneScene,
        pipelineConfig: { shot_generation_mode: "sequential" },
      })

      await runShotListStage({
        supabase,
        pipelineId: "p1",
        userId: "u1",
        userTier: "pro",
      })

      const updates = (
        supabase as never as { _pipelineUpdates: Array<Record<string, unknown>> }
      )._pipelineUpdates
      expect(updates).toHaveLength(0)
    })
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

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D.2a §4.1 (H1): auto-mode bulk-approve at the per-scene gate
  // ──────────────────────────────────────────────────────────────────────────

  describe("auto-mode (H1)", () => {
    const passVerdict = {
      verdict: "pass" as const,
      issues: [],
      duration_analysis: {
        target_seconds: 20,
        actual_sum_seconds: 20,
        deviation_percent: 0,
        within_tolerance: true,
      },
    }

    it("auto-mode: bulk-approves every scene + stage row, emits stage:status approved, re-enqueues orchestrator", async () => {
      ;(runSceneDirector as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fakeSceneNodeData(1))
        .mockResolvedValueOnce(fakeSceneNodeData(2))
        .mockResolvedValueOnce(fakeSceneNodeData(3))
      ;(runShotListCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passVerdict)

      const supabase = makeSupabase()
      const sseEvents: Array<Record<string, unknown>> = []
      const unsub = pipelineEvents.subscribe("p1-auto", (e) =>
        sseEvents.push(e as unknown as Record<string, unknown>),
      )

      try {
        await runShotListStage({
          supabase,
          pipelineId: "p1-auto",
          userId: "u1",
          userTier: "pro",
          mode: "auto",
        })
      } finally {
        unsub()
      }

      // Every scene entity flipped to `approved` (auto-mode bulk-flip ran
      // AFTER the per-scene loop transitioned each to `awaiting_approval`).
      const entities = (
        supabase as never as { _entities: Map<string, Record<string, unknown>> }
      )._entities
      expect(entities.size).toBe(3)
      for (const e of entities.values()) {
        expect(e.status).toBe("approved")
      }

      // Stage row got marked approved with a completed_at timestamp.
      const stageUpdates = (
        supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
      )._stageUpdates
      const approvedUpdate = stageUpdates.find((u) => u.status === "approved")
      expect(approvedUpdate).toBeDefined()
      expect(approvedUpdate?.completed_at).toBeDefined()
      // And NOT awaiting_approval.
      expect(stageUpdates.find((u) => u.status === "awaiting_approval")).toBeUndefined()

      // SSE `stage:status approved` was emitted.
      const approvedEvent = sseEvents.find(
        (e) => e.type === "stage:status" && e.status === "approved",
      )
      expect(approvedEvent).toBeDefined()

      // Orchestrator re-enqueued with stage_advance.
      expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
      expect(enqueuePipelineRun).toHaveBeenCalledWith({
        pipelineId: "p1-auto",
        userId: "u1",
        reason: "stage_advance",
      })
    })

    it("auto-mode: does NOT advance when any scene failed (stage stays running for user retry)", async () => {
      // Mix one success + two failures. The "anyFailed" guard at top of the
      // stage handler must short-circuit BEFORE the auto-mode bulk-approve
      // would otherwise run.
      ;(runSceneDirector as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fakeSceneNodeData(1))
        .mockRejectedValue(new Error("api down"))
      ;(runShotListCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passVerdict)

      const supabase = makeSupabase()
      await runShotListStage({
        supabase,
        pipelineId: "p1-auto-fail",
        userId: "u1",
        userTier: "pro",
        mode: "auto",
      })

      // Stage row was NOT flipped to approved — failed scenes block advance.
      const stageUpdates = (
        supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
      )._stageUpdates
      expect(stageUpdates.find((u) => u.status === "approved")).toBeUndefined()
      // Orchestrator was NOT re-enqueued.
      expect(enqueuePipelineRun).not.toHaveBeenCalled()
    })

    it("manual-mode: existing behavior unchanged — does NOT bulk-approve, does NOT re-enqueue", async () => {
      // Regression net: same happy-path inputs but `mode: "manual"`. Scenes
      // sit at `awaiting_approval`; stage row stays `running`; orchestrator is
      // not re-enqueued. The per-scene awaiting_approval gates surface in the
      // panel and the user drives each one individually.
      ;(runSceneDirector as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(fakeSceneNodeData(1))
        .mockResolvedValueOnce(fakeSceneNodeData(2))
        .mockResolvedValueOnce(fakeSceneNodeData(3))
      ;(runShotListCritic as ReturnType<typeof vi.fn>).mockResolvedValue(passVerdict)

      const supabase = makeSupabase()
      await runShotListStage({
        supabase,
        pipelineId: "p1-manual",
        userId: "u1",
        userTier: "pro",
        mode: "manual",
      })

      // Scenes stayed at awaiting_approval (per-scene gate).
      const entities = (
        supabase as never as { _entities: Map<string, Record<string, unknown>> }
      )._entities
      for (const e of entities.values()) {
        expect(e.status).toBe("awaiting_approval")
      }

      // No stage-level approved update fired.
      const stageUpdates = (
        supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
      )._stageUpdates
      expect(stageUpdates.find((u) => u.status === "approved")).toBeUndefined()

      // Orchestrator was NOT re-enqueued.
      expect(enqueuePipelineRun).not.toHaveBeenCalled()
    })
  })
})
