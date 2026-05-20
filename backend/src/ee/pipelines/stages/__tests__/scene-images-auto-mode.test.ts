import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import. Mirrors scene-images-match-cut.test.ts.
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
vi.mock("../../stage-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../../stage-utils.js")>(
    "../../stage-utils.js",
  )
  return {
    ...actual,
    ensureStageRow: vi.fn().mockResolvedValue("stage-6"),
    failStage: vi.fn(),
  }
})
vi.mock("../../match-cut-orchestrator.js", () => ({
  runMatchCutOrchestrator: vi.fn(),
}))
vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { failStage } from "../../stage-utils.js"
import { pipelineEvents } from "../../events.js"
import { runMatchCutOrchestrator } from "../../match-cut-orchestrator.js"
import { enqueuePipelineRun } from "../../queue.js"
import { transitionStageEntityNodesAndEmit } from "../../depends-on.js"
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
 * Build a supabase mock. Mirrors the scene-images-match-cut.test.ts helper but
 * adds the chained .eq().eq().eq() bulk-update path used by the H2 auto-mode
 * advanceToApproved helper (UPDATE pipeline_entities SET status=approved
 * WHERE pipeline_id=? AND entity_type='scene' AND status='awaiting_approval').
 */
function makeSupabase(
  opts: {
    scenes: Array<{ id: string; entity_key: string; scene_node_data?: unknown; status?: string }>
    initialStageStatus?: string
    initialStageOutput?: Record<string, unknown>
  } = { scenes: [] },
) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const s of opts.scenes) {
    entities.set(s.id, {
      id: s.id,
      entity_key: s.entity_key,
      status: s.status ?? "awaiting_approval",
      metadata: s.scene_node_data !== undefined ? { scene_node_data: s.scene_node_data } : {},
    })
  }
  const stageUpdates: Array<Record<string, unknown>> = []

  // Chained .eq() update builder — used by auto-mode bulk-flip
  // UPDATE pipeline_entities SET status=approved WHERE pipeline_id=? AND
  // entity_type='scene' AND status='awaiting_approval'.
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
          update: (patch: Record<string, unknown>) => {
            // Two callers:
            //   1) per-scene .update().eq("id", val) — terminator after one .eq()
            //   2) bulk auto-mode .update().eq().eq().eq() — chained terminator
            //
            // The first call is awaited as a Promise after `.eq("id", ...)`. The
            // second resolves on .then() after the third .eq(). The chain handles
            // both shapes — .eq() returns the same chain node either way, and the
            // thenable resolves when awaited.
            const chain = makeUpdateChain(patch)
            return chain
          },
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

describe("Stage 6 (scene-images) auto-mode — Phase 1D.2a §4.1 (H2)", () => {
  it("H2-1: auto-mode happy path — no match-cut breaks → stage approved, canvas approved, orchestrator re-enqueued", async () => {
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
          status: "awaiting_approval",
        },
        {
          id: "scene-2",
          entity_key: "scene_02",
          scene_node_data: makeSceneNodeData(2, [makeShot("s2")]),
          status: "awaiting_approval",
        },
      ],
    })
    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p1-h2-happy", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )

    try {
      await runSceneImagesStage({
        supabase,
        pipelineId: "p1-h2-happy",
        userId: "u1",
        userTier: "pro",
        mode: "auto",
      })
    } finally {
      unsub()
    }

    const stageUpdates = (
      supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
    )._stageUpdates
    // Stage row marked `approved` (NOT awaiting_approval) by auto-mode.
    const approvedUpdate = stageUpdates.find((u) => u.status === "approved")
    expect(approvedUpdate).toBeDefined()
    expect(approvedUpdate?.completed_at).toBeDefined()
    // The standard awaiting_approval transition path was NOT taken.
    expect(
      stageUpdates.find(
        (u) =>
          u.status === "awaiting_approval" &&
          !(u.output as Record<string, unknown> | undefined)?.current_sub_gate,
      ),
    ).toBeUndefined()

    // Canvas nodes transitioned to `pipeline_owned_approved` (not awaiting).
    const transitionCalls = (transitionStageEntityNodesAndEmit as ReturnType<typeof vi.fn>)
      .mock.calls
    const approvedNodeTransition = transitionCalls.find(
      (call) => call[3] === "pipeline_owned_approved",
    )
    expect(approvedNodeTransition).toBeDefined()

    // SSE `stage:status approved` was emitted.
    const approvedEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "approved",
    )
    expect(approvedEvent).toBeDefined()

    // Orchestrator re-enqueued with reason=stage_advance.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-h2-happy",
      userId: "u1",
      reason: "stage_advance",
    })

    expect(failStage).not.toHaveBeenCalled()
  })

  it("H2-2: auto-mode + match-cut break pending → still pauses at sub-gate (critic NOT bypassed)", async () => {
    // The critical safety guarantee: auto-mode must NOT bypass the match-cut
    // critic. When the critic reports a pending break, the stage MUST pause
    // at `current_sub_gate = match_cut_break_pending` regardless of mode.
    // Auto-advance only happens on the no-break path.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/kf.png",
      creditsSpent: 2,
    })
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdicts: {
        s1: {
          shot_pair: ["s1", "s2"],
          match_strength: "break",
          suggested_adjustments: "redo",
          checked_at: "2026-05-20T00:00:00Z",
        },
      },
      pendingBreaks: ["s1"],
    })

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1", true), makeShot("s2")]),
          status: "awaiting_approval",
        },
      ],
    })
    await runSceneImagesStage({
      supabase,
      pipelineId: "p1-h2-break",
      userId: "u1",
      userTier: "pro",
      mode: "auto",
    })

    const stageUpdates = (
      supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
    )._stageUpdates
    // The sub-gate write must have fired: status=awaiting_approval +
    // output.current_sub_gate = "match_cut_break_pending".
    const subGateUpdate = stageUpdates.find(
      (u) =>
        u.status === "awaiting_approval" &&
        (u.output as Record<string, unknown>)?.current_sub_gate === "match_cut_break_pending",
    )
    expect(subGateUpdate).toBeDefined()

    // The auto-mode `approved` path did NOT run.
    expect(stageUpdates.find((u) => u.status === "approved")).toBeUndefined()

    // Orchestrator was NOT re-enqueued — the user must accept the break first.
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("H2-3: auto-mode resume from match-cut gate (all breaks accepted) → advances to approved + re-enqueues", async () => {
    // After acceptMatchCutBreak clears all pending breaks, the stage is
    // re-enqueued; the next pass sees `existingStage.status === "running"`
    // with `match_cut_break_pending: []` and `keyframes_generated: true`,
    // i.e. `resumingFromMatchCutGate === true`. In auto-mode the resume path
    // calls `advanceToApproved` instead of `advanceToAwaitingApproval`.
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1", true), makeShot("s2")]),
          status: "awaiting_approval",
        },
      ],
      initialStageStatus: "running",
      initialStageOutput: {
        keyframes_generated: true,
        match_cut_break_pending: [],
        match_cut_verdicts: { s1: { match_strength: "weak" } },
      },
    })

    await runSceneImagesStage({
      supabase,
      pipelineId: "p1-h2-resume",
      userId: "u1",
      userTier: "pro",
      mode: "auto",
    })

    // No keyframe regeneration — the resume path skips straight to advance.
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
    expect(runMatchCutOrchestrator).not.toHaveBeenCalled()

    const stageUpdates = (
      supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
    )._stageUpdates
    // Stage row flipped to `approved` (auto-mode resume path).
    expect(stageUpdates.find((u) => u.status === "approved")).toBeDefined()
    // Orchestrator re-enqueued.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
  })

  it("H2-4: manual-mode happy path (regression) — no match-cut breaks → stage awaiting_approval, NOT approved, no enqueue", async () => {
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
          status: "awaiting_approval",
        },
      ],
    })
    await runSceneImagesStage({
      supabase,
      pipelineId: "p1-h2-manual",
      userId: "u1",
      userTier: "pro",
      mode: "manual",
    })

    const stageUpdates = (
      supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
    )._stageUpdates
    // Stage row stays at awaiting_approval — the user keyframe-review pause.
    const awaitingUpdate = stageUpdates.find(
      (u) =>
        u.status === "awaiting_approval" &&
        !(u.output as Record<string, unknown> | undefined)?.current_sub_gate,
    )
    expect(awaitingUpdate).toBeDefined()
    // `approved` was NOT written.
    expect(stageUpdates.find((u) => u.status === "approved")).toBeUndefined()

    // Orchestrator was NOT re-enqueued.
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })
})
