import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Mocks — hoisted before any route import. Mirrors scene-images-auto-mode.test.ts.
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
vi.mock("../../llms/storyboard-cohesion-critic.js", () => ({
  runStoryboardCohesionCritic: vi.fn(),
}))

import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { failStage } from "../../stage-utils.js"
import { runMatchCutOrchestrator } from "../../match-cut-orchestrator.js"
import { runStoryboardCohesionCritic } from "../../llms/storyboard-cohesion-critic.js"
import { enqueuePipelineRun } from "../../queue.js"
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
    visual_style: "noir",
    color_palette: "muted",
    lighting: "low-key",
    camera_language: "handheld",
  },
  total_duration_seconds: 60,
  estimated_scene_count: 0,
  warnings: [],
}

function makeShot(
  id: string,
  opts: { isMatchCut?: boolean; keyframeUrl?: string } = {},
) {
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
      is_match_cut: opts.isMatchCut ?? false,
    },
    visual_keyframe_prompt: `prompt for ${id}`,
    ...(opts.keyframeUrl ? { keyframe_url: opts.keyframeUrl } : {}),
  }
}

function makeSceneNodeData(idx: number, shots: ReturnType<typeof makeShot>[]) {
  return {
    scene_index: idx,
    description: `Scene ${idx} description`,
    emotional_beat: "setup",
    duration_seconds: 10,
    shot_input_mode: "first_frame",
    cast_keys: ["protagonist"],
    location_key: `location_${idx}`,
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
 * Build a supabase mock. Persists per-shot metadata writes so the re-read inside
 * Stage 6 (the second `pipeline_entities` SELECT) returns the keyframe URLs
 * persisted by `generateKeyframesForScene`.
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

  // Chained .eq() update builder — used by auto-mode bulk-flip.
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

describe("Stage 6 storyboard-cohesion-critic integration (Phase 1D.2c-b-i §4)", () => {
  it("invokes critic AFTER all keyframes generated with the right scenes payload", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockImplementation(
      async () => ({
        jobId: "j1",
        assetId: "a1",
        assetUrl: "https://r2/kf-generated.png",
        creditsSpent: 2,
      }),
    )
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdicts: {},
      pendingBreaks: [],
    })
    ;(runStoryboardCohesionCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: {
        overall_assessment: "coherent",
        coherence_score: 9,
        summary: "all good",
        findings: [],
      },
      llmCallId: "llm-1",
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
    await runSceneImagesStage({
      supabase,
      pipelineId: "p1-cohesion-happy",
      userId: "u1",
      userTier: "pro",
      mode: "manual",
    })

    // The critic was called exactly once with both scenes' inputs.
    expect(runStoryboardCohesionCritic).toHaveBeenCalledTimes(1)
    const arg = (runStoryboardCohesionCritic as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as {
      pipelineId: string
      stageId: string
      userId: string
      scenes: Array<{
        scene_index: number
        description: string
        keyframe_url: string
        location_key: string
        cast_keys: string[]
      }>
      globalStyle: { visual_style: string }
    }
    expect(arg.pipelineId).toBe("p1-cohesion-happy")
    expect(arg.stageId).toBe("stage-6")
    expect(arg.userId).toBe("u1")
    expect(arg.scenes).toHaveLength(2)
    // Verify shape — scene_index, description, keyframe_url, location_key, cast_keys.
    expect(arg.scenes[0]).toMatchObject({
      scene_index: 1,
      description: "Scene 1 description",
      keyframe_url: "https://r2/kf-generated.png",
      location_key: "location_1",
      cast_keys: ["protagonist"],
    })
    expect(arg.scenes[1]).toMatchObject({
      scene_index: 2,
      description: "Scene 2 description",
      keyframe_url: "https://r2/kf-generated.png",
      location_key: "location_2",
      cast_keys: ["protagonist"],
    })
    expect(arg.globalStyle).toEqual(fakePlan.global_style)

    // Critic must run AFTER match-cut.
    const matchCutCallOrder = (runMatchCutOrchestrator as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0]
    const cohesionCallOrder = (runStoryboardCohesionCritic as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0]
    expect(cohesionCallOrder).toBeGreaterThan(matchCutCallOrder)
  })

  it("persists findings/assessment/score/summary to stage output", async () => {
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
    const findings = [
      {
        severity: "warning",
        category: "lighting_mismatch",
        affected_scenes: [1, 2],
        description: "lighting drift between scenes",
        suggested_action: "anchor scene 2 to scene 1's lighting",
      },
    ]
    ;(runStoryboardCohesionCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: {
        overall_assessment: "minor_issues",
        coherence_score: 6,
        summary: "lighting drift between scenes 1 and 2",
        findings,
      },
      llmCallId: "llm-2",
    })

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1")]),
        },
        {
          id: "scene-2",
          entity_key: "scene_02",
          scene_node_data: makeSceneNodeData(2, [makeShot("s2")]),
        },
      ],
    })
    await runSceneImagesStage({
      supabase,
      pipelineId: "p1-cohesion-findings",
      userId: "u1",
      userTier: "pro",
      mode: "manual",
    })

    const stageUpdates = (
      supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
    )._stageUpdates
    const awaitingUpdate = stageUpdates.find(
      (u) =>
        u.status === "awaiting_approval" &&
        !(u.output as Record<string, unknown> | undefined)?.current_sub_gate,
    )
    expect(awaitingUpdate).toBeDefined()
    const output = awaitingUpdate!.output as Record<string, unknown>
    expect(output.storyboard_cohesion_findings).toEqual(findings)
    expect(output.storyboard_cohesion_assessment).toBe("minor_issues")
    expect(output.storyboard_cohesion_score).toBe(6)
    expect(output.storyboard_cohesion_summary).toBe(
      "lighting drift between scenes 1 and 2",
    )
  })

  it("skips critic when any scene lacks a keyframe URL (early return)", async () => {
    // Simulate: generated_kf step actually writes a keyframe_url on the
    // shot, but scene-2's persist step fails silently — when the re-read
    // happens, scene-2's first shot has NO keyframe_url, so the critic must
    // NOT run. We model this by having pipelineGenerateImage NOT actually
    // populate the keyframe URLs (returns urls but the writeback path in
    // generateKeyframesForScene is the SUT — using a custom update mock that
    // drops scene-2's update).
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

    // Build a supabase where one of the scene rows comes pre-loaded WITHOUT
    // a keyframe_url AND the per-scene metadata write is suppressed for it.
    // The easiest path: model a supabase whose UPDATE on pipeline_entities
    // ALWAYS no-ops, so when the re-read happens after gen, no shot has a
    // keyframe_url even though pipelineGenerateImage succeeded. Both scenes
    // lack a keyframe — the critic must be skipped.
    const entities = new Map<string, Record<string, unknown>>()
    entities.set("scene-1", {
      id: "scene-1",
      entity_key: "scene_01",
      status: "awaiting_approval",
      metadata: {
        scene_node_data: makeSceneNodeData(1, [makeShot("s1")]),
      },
    })
    entities.set("scene-2", {
      id: "scene-2",
      entity_key: "scene_02",
      status: "awaiting_approval",
      metadata: {
        scene_node_data: makeSceneNodeData(2, [makeShot("s2")]),
      },
    })
    const stageUpdates: Array<Record<string, unknown>> = []
    // Track update calls so we can assert NO writeback for entities (no keyframes persist).
    const makeNoOpEntityChain = (): {
      eq: (col: string, val: unknown) => unknown
    } => {
      const node: {
        eq: (col: string, val: unknown) => unknown
        then: (resolve: (v: unknown) => unknown) => unknown
      } = {
        eq: () => node,
        then: (resolve) => resolve({ data: null, error: null }),
      }
      return node
    }
    const supabase: never = {
      rpc: vi.fn(),
      from: (table: string) => {
        if (table === "pipeline_stages") {
          return {
            select: () => ({
              eq: (col1: string, _val1: string) => {
                if (col1 === "id") {
                  return {
                    maybeSingle: async () => ({
                      data: { status: "running", output: null },
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
            // Drop entity writebacks — no keyframe_url ever lands on the rows.
            update: () => makeNoOpEntityChain(),
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
    } as never

    await runSceneImagesStage({
      supabase,
      pipelineId: "p1-cohesion-missing-kf",
      userId: "u1",
      userTier: "pro",
      mode: "manual",
    })

    // Critic NOT called when keyframes incomplete.
    expect(runStoryboardCohesionCritic).not.toHaveBeenCalled()

    // Stage still advanced to awaiting_approval (degradation, not failure).
    const awaitingUpdate = stageUpdates.find(
      (u) =>
        u.status === "awaiting_approval" &&
        !(u.output as Record<string, unknown> | undefined)?.current_sub_gate,
    )
    expect(awaitingUpdate).toBeDefined()
    // No cohesion fields on output (critic didn't run).
    const output = awaitingUpdate!.output as Record<string, unknown>
    expect(output.storyboard_cohesion_findings).toBeUndefined()
    expect(output.storyboard_cohesion_assessment).toBeUndefined()
  })

  it("critic throw is non-fatal — stage still advances; no cohesion fields persisted", async () => {
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
    ;(runStoryboardCohesionCritic as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("vision-llm timed out"),
    )

    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined)

    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1")]),
        },
      ],
    })
    try {
      await runSceneImagesStage({
        supabase,
        pipelineId: "p1-cohesion-throw",
        userId: "u1",
        userTier: "pro",
        mode: "manual",
      })

      // Critic threw, but stage MUST still flip to awaiting_approval.
      const stageUpdates = (
        supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
      )._stageUpdates
      const awaitingUpdate = stageUpdates.find(
        (u) =>
          u.status === "awaiting_approval" &&
          !(u.output as Record<string, unknown> | undefined)?.current_sub_gate,
      )
      expect(awaitingUpdate).toBeDefined()

      // No cohesion fields written (critic threw before persistence).
      const output = awaitingUpdate!.output as Record<string, unknown>
      expect(output.storyboard_cohesion_findings).toBeUndefined()
      expect(output.storyboard_cohesion_assessment).toBeUndefined()
      expect(output.storyboard_cohesion_score).toBeUndefined()
      expect(output.storyboard_cohesion_summary).toBeUndefined()

      // The stage itself was NOT failed.
      expect(failStage).not.toHaveBeenCalled()

      // The warn was emitted with the pipeline id + non-fatal note.
      expect(warnSpy).toHaveBeenCalled()
      const warnArgs = warnSpy.mock.calls[0]
      const warnStr = warnArgs.map(String).join(" ")
      expect(warnStr).toMatch(/storyboard-cohesion/)
      expect(warnStr).toMatch(/p1-cohesion-throw/)
      expect(warnStr).toMatch(/non-fatal/i)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it("auto mode + healthy critic — findings persisted; stage still bulk-approves (warn-only)", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/kf-auto.png",
      creditsSpent: 2,
    })
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdicts: {},
      pendingBreaks: [],
    })
    const findings = [
      {
        severity: "info",
        category: "style_drift",
        affected_scenes: [1, 2],
        description: "minor stylization drift",
        suggested_action: "OK to ignore",
      },
    ]
    ;(runStoryboardCohesionCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: {
        overall_assessment: "minor_issues",
        coherence_score: 7,
        summary: "minor drift",
        findings,
      },
      llmCallId: "llm-3",
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
    await runSceneImagesStage({
      supabase,
      pipelineId: "p1-cohesion-auto",
      userId: "u1",
      userTier: "pro",
      mode: "auto",
    })

    // Critic ran.
    expect(runStoryboardCohesionCritic).toHaveBeenCalledTimes(1)

    const stageUpdates = (
      supabase as never as { _stageUpdates: Array<Record<string, unknown>> }
    )._stageUpdates
    // Auto-mode advanced straight to `approved` (warn-only — not failed).
    const approvedUpdate = stageUpdates.find((u) => u.status === "approved")
    expect(approvedUpdate).toBeDefined()
    const output = approvedUpdate!.output as Record<string, unknown>
    expect(output.storyboard_cohesion_findings).toEqual(findings)
    expect(output.storyboard_cohesion_assessment).toBe("minor_issues")
    expect(output.storyboard_cohesion_score).toBe(7)
    expect(output.storyboard_cohesion_summary).toBe("minor drift")

    // Pipeline was NOT failed.
    expect(failStage).not.toHaveBeenCalled()
    // Orchestrator was re-enqueued for Stage 7.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
  })
})
