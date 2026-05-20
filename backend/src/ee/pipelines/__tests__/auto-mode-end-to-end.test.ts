/**
 * Phase 1D.2a §9 smoke 1 — Auto Mode end-to-end integration test.
 *
 * Drives the pipeline engine (`drivePipeline`) in a loop and verifies the
 * `mode='auto'` state-machine advances cleanly from Stage 1 → 8 without
 * resting at `awaiting_approval`. Also exercises the negative path: a
 * blocking Stage-1 failure (`objects_validation` duplicate_key) leaves the
 * pipeline in `failed` with `failure_reason='script_critic_unresolvable'`,
 * `failure_detail='objects_validation'`, and triggers a credit refund.
 *
 * SCOPE: this is an INTEGRATION test of the engine's dispatch loop. The 8
 * stage orchestrators are mocked at module level so the test focuses on:
 *   1) how the engine reads `pipeline_stages` to pick the next stage,
 *   2) how it dispatches the right handler with mode='auto',
 *   3) how it advances to `completed` when every stage is `approved`,
 *   4) how Stage-1 failure terminates the pipeline + refunds credits.
 *
 * The individual stage handlers' auto-mode behavior is unit-tested in
 * stages/__tests__/{characters,objects,locations,shot-list,scene-images,
 * script}.test.ts (F1, G1, G2, G3, H1, H2). This file is the glue test:
 * does the engine string those approved stages together correctly?
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks. Every stage handler and the credits/queue modules are mocked
// before any imports below. Engine.ts dynamic-imports the entity-stage
// handlers, so the mock paths must match the runtime specifier exactly.
// ---------------------------------------------------------------------------

vi.mock("../stages/script.js", () => ({
  runScriptStage: vi.fn(),
}))
vi.mock("../stages/characters.js", () => ({
  runCharactersStage: vi.fn(async () => undefined),
}))
vi.mock("../stages/objects.js", () => ({
  runObjectsStage: vi.fn(async () => undefined),
}))
vi.mock("../stages/locations.js", () => ({
  runLocationsStage: vi.fn(async () => undefined),
}))
vi.mock("../stages/shot-list.js", () => ({
  runShotListStage: vi.fn(async () => undefined),
}))
vi.mock("../stages/scene-images.js", () => ({
  runSceneImagesStage: vi.fn(async () => undefined),
}))
vi.mock("../stages/animate-audio-edit.js", () => ({
  runAnimateAudioEditStage: vi.fn(async () => undefined),
}))
vi.mock("../stages/post-merge.js", () => ({
  runPostMergeStage: vi.fn(async () => undefined),
}))

vi.mock("../credits.js", () => ({
  refundPipelineCredits: vi.fn(async () => undefined),
}))

vi.mock("../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

vi.mock("../drift.js", () => ({
  // Never fire drift in this test — every stage is clean.
  validateCanvasAgainstPlan: vi.fn(async () => ({ ok: true, drifted: [] })),
  getStageExpectedEntityIds: vi.fn(async () => new Set<string>()),
}))

// ---------------------------------------------------------------------------
// Imports — must come after vi.mock calls.
// ---------------------------------------------------------------------------

import { drivePipeline } from "../engine.js"
import { runScriptStage } from "../stages/script.js"
import { runCharactersStage } from "../stages/characters.js"
import { runObjectsStage } from "../stages/objects.js"
import { runLocationsStage } from "../stages/locations.js"
import { runShotListStage } from "../stages/shot-list.js"
import { runSceneImagesStage } from "../stages/scene-images.js"
import { runAnimateAudioEditStage } from "../stages/animate-audio-edit.js"
import { runPostMergeStage } from "../stages/post-merge.js"
import { refundPipelineCredits } from "../credits.js"
import { enqueuePipelineRun } from "../queue.js"
import { pipelineEvents } from "../events.js"

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
} as never

// ─── In-memory Supabase mock ─────────────────────────────────────────────────

interface PipelineRow {
  id: string
  user_id: string
  status: string
  mode: "manual" | "auto" | "guided"
  activation_mode: string
  input_prompt: string
  target_duration_seconds: number
  format: string
  output_resolution: string
  language: string
  reserved_credits: number
  spent_credits: number
  reservation_usage_log_id: string | null
  failure_reason?: string | null
  style_directives?: unknown
}

interface StageRow {
  id: string
  pipeline_id: string
  stage_name: string
  stage_order: number
  status: string
  awaiting_reason?: string | null
  output?: Record<string, unknown> | null
  critic_feedback?: Record<string, unknown> | null
  completed_at?: string | null
}

interface MockState {
  pipelines: Map<string, PipelineRow>
  stages: StageRow[]
}

/**
 * Build a Supabase client mock that exposes just enough chain shapes for the
 * engine to read pipelines + pipeline_stages and write status updates.
 *
 * - `from("pipelines").select("*").eq("id", v).single()` → pipeline row
 * - `from("pipelines").update(patch).eq("id", v)` → mutate row
 * - `from("pipeline_stages").select("stage_name, status, stage_order")
 *      .eq("pipeline_id", v).order(...)` → all stage rows
 * - `from("pipeline_stages").select("id").eq("pipeline_id", v).eq("stage_name", v).maybeSingle()` → one row
 * - `from("pipeline_stages").update(patch).eq("pipeline_id", v).eq("stage_name", v)` → mutate
 * - `from("pipeline_stages").update(patch).eq("id", v)` → mutate
 * - `from("profiles").select("tier").eq("id", v).single()` → tier
 */
function makeSupabase(state: MockState): unknown {
  const pipelinesUpdate = (patch: Record<string, unknown>) => {
    const filters: Record<string, unknown> = {}
    const apply = () => {
      for (const row of state.pipelines.values()) {
        if (
          Object.entries(filters).every(
            ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
          )
        ) {
          Object.assign(row, patch)
        }
      }
      return { data: null, error: null }
    }
    const chain: {
      eq: (col: string, val: unknown) => unknown
      then: (resolve: (v: unknown) => unknown) => unknown
    } = {
      eq: (col, val) => {
        filters[col] = val
        return chain
      },
      then: (resolve) => resolve(apply()),
    }
    return chain
  }

  const stagesSelect = (cols: string) => {
    // We support 2 shapes:
    //   .eq("pipeline_id", v).order("stage_order", ...) → list
    //   .eq("pipeline_id", v).eq("stage_name", v).maybeSingle() → one
    let pipelineIdFilter: string | null = null
    let stageNameFilter: string | null = null
    const chain: Record<string, unknown> = {
      eq: (col: string, val: unknown) => {
        if (col === "pipeline_id") pipelineIdFilter = val as string
        if (col === "stage_name") stageNameFilter = val as string
        if (col === "id") {
          const row = state.stages.find((s) => s.id === val)
          return {
            maybeSingle: async () => ({ data: row ?? null, error: null }),
            single: async () => ({ data: row ?? null, error: row ? null : { message: "not found" } }),
          }
        }
        return chain
      },
      order: async (_col: string, _opts: unknown) => {
        const rows = state.stages.filter((s) => s.pipeline_id === pipelineIdFilter)
        // Mimic the columns the engine selects.
        const projected = rows.map((r) => {
          if (cols.includes("stage_name") || cols === "*") {
            return {
              stage_name: r.stage_name,
              status: r.status,
              stage_order: r.stage_order,
            }
          }
          return r
        })
        return { data: projected, error: null }
      },
      maybeSingle: async () => {
        const row = state.stages.find(
          (s) =>
            s.pipeline_id === pipelineIdFilter &&
            (stageNameFilter === null || s.stage_name === stageNameFilter),
        )
        return { data: row ? { id: row.id } : null, error: null }
      },
    }
    return chain
  }

  const stagesUpdate = (patch: Record<string, unknown>) => {
    const filters: Record<string, unknown> = {}
    const apply = () => {
      for (const row of state.stages) {
        if (
          Object.entries(filters).every(
            ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
          )
        ) {
          Object.assign(row, patch)
        }
      }
      return { data: null, error: null }
    }
    const chain: {
      eq: (col: string, val: unknown) => unknown
      then: (resolve: (v: unknown) => unknown) => unknown
    } = {
      eq: (col, val) => {
        filters[col] = val
        return chain
      },
      then: (resolve) => resolve(apply()),
    }
    return chain
  }

  return {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipelines") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, val: string) => ({
              single: async () => {
                const row = state.pipelines.get(val)
                return {
                  data: row ?? null,
                  error: row ? null : { message: "not found" },
                }
              },
              maybeSingle: async () => {
                const row = state.pipelines.get(val)
                return { data: row ?? null, error: null }
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => pipelinesUpdate(patch),
        }
      }
      if (table === "pipeline_stages") {
        return {
          select: (cols: string) => stagesSelect(cols),
          update: (patch: Record<string, unknown>) => stagesUpdate(patch),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                const newRow: StageRow = {
                  id: `stage-${state.stages.length + 1}`,
                  pipeline_id: row.pipeline_id as string,
                  stage_name: row.stage_name as string,
                  stage_order: row.stage_order as number,
                  status: (row.status as string) ?? "running",
                }
                state.stages.push(newRow)
                return { data: { id: newRow.id }, error: null }
              },
            }),
          }),
        }
      }
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { tier: "pro" }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const passScriptVerdict = {
  verdict: "pass",
  issues: [],
  duration_analysis: {
    target_seconds: 60,
    actual_sum_seconds: 60,
    deviation_percent: 0,
    within_tolerance: true,
  },
}
const passCastVerdict = { verdict: "pass", issues: [], dialogue_distribution: [] }
const passLocationsVerdict = { verdict: "pass", issues: [] }
const passObjectsVerdict = { verdict: "pass" as const, issues: [] }

/**
 * Drive the pipeline until terminal or until `maxIters`. Returns the iteration
 * count so tests can sanity-check progress (e.g., 8 stages → ~9 iterations).
 *
 * Why a loop: in production the BullMQ orchestrator re-enqueues itself between
 * stages via `enqueuePipelineRun`. In the test we just call `drivePipeline`
 * again in a loop — each call advances at most one stage.
 */
async function drainPipeline(
  supabase: unknown,
  pipelineId: string,
  state: MockState,
  maxIters = 20,
): Promise<number> {
  let iters = 0
  while (iters < maxIters) {
    iters++
    const pipeline = state.pipelines.get(pipelineId)!
    if (
      pipeline.status === "completed" ||
      pipeline.status === "failed" ||
      pipeline.status === "cancelled" ||
      pipeline.status === "awaiting_approval"
    ) {
      return iters
    }
    await drivePipeline({ supabase: supabase as never, pipelineId })
  }
  return iters
}

function seedPipeline(state: MockState, id: string, overrides: Partial<PipelineRow> = {}): void {
  state.pipelines.set(id, {
    id,
    user_id: "u1",
    status: "queued",
    mode: "auto",
    activation_mode: "interactive",
    input_prompt: "story prompt",
    target_duration_seconds: 60,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    reserved_credits: 100,
    spent_credits: 0,
    reservation_usage_log_id: "log-1",
    failure_reason: null,
    ...overrides,
  })
  // Seed the script stage row in `running` state. In production the script
  // handler does this itself via `ensureStageRow` before the engine reads
  // pipeline_stages on the SAME call. In tests we mock the script handler,
  // so we seed the row up front so the engine's `nextStage` finder picks it
  // up on the first iteration. (Without this, the engine's "no rows" defensive
  // path at line 75 fires and marks the pipeline completed immediately.)
  state.stages.push({
    id: "stage-script",
    pipeline_id: id,
    stage_name: "script",
    stage_order: 1,
    status: "running",
  })
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Auto Mode end-to-end (Phase 1D.2a §9 smoke 1)", () => {
  it("happy path: auto-mode advances Script → … → post_merge → completed without awaiting_approval", async () => {
    const state: MockState = { pipelines: new Map(), stages: [] }
    seedPipeline(state, "p-happy")

    // Script stage returns 'approved' (auto-mode). The engine's
    // `runScriptAndPersist` wrapper writes the pipeline_stages row to
    // `approved` after the handler returns; our in-memory update chain
    // applies the patch to the seeded row in state.stages.
    ;(runScriptStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "approved",
      plan: fakePlan,
      scriptCritic: passScriptVerdict,
      castCoverageCritic: passCastVerdict,
      locationsCoverageCritic: passLocationsVerdict,
      objectsValidation: passObjectsVerdict,
    })

    // The entity stage handlers' real behavior is unit-tested elsewhere. Here
    // we simulate their "auto-mode succeeded" outcome by directly writing the
    // pipeline_stages row to `approved` on each call. The engine doesn't care
    // HOW the row got there, only that it did.
    const insertApproved = (stageName: string, stageOrder: number) =>
      vi.fn(async () => {
        // ensure a row exists
        let row = state.stages.find(
          (s) => s.pipeline_id === "p-happy" && s.stage_name === stageName,
        )
        if (!row) {
          row = {
            id: `stage-${state.stages.length + 1}`,
            pipeline_id: "p-happy",
            stage_name: stageName,
            stage_order: stageOrder,
            status: "approved",
            output: {},
            critic_feedback: {},
            completed_at: new Date().toISOString(),
          }
          state.stages.push(row)
        } else {
          row.status = "approved"
          row.completed_at = new Date().toISOString()
        }
      })
    ;(runCharactersStage as ReturnType<typeof vi.fn>).mockImplementation(insertApproved("characters", 2))
    ;(runObjectsStage as ReturnType<typeof vi.fn>).mockImplementation(insertApproved("objects", 3))
    ;(runLocationsStage as ReturnType<typeof vi.fn>).mockImplementation(insertApproved("locations", 4))
    ;(runShotListStage as ReturnType<typeof vi.fn>).mockImplementation(insertApproved("shot_list", 5))
    ;(runSceneImagesStage as ReturnType<typeof vi.fn>).mockImplementation(insertApproved("scene_images", 6))
    ;(runAnimateAudioEditStage as ReturnType<typeof vi.fn>).mockImplementation(
      insertApproved("animate_audio_edit", 7),
    )
    // post_merge's real handler flips pipeline status to 'completed'. The engine
    // also has a defensive fallback that does the same; we simulate the handler
    // doing it explicitly here.
    ;(runPostMergeStage as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      await insertApproved("post_merge", 8)()
      const p = state.pipelines.get("p-happy")!
      p.status = "completed"
    })

    // Subscribe to SSE so we can assert no awaiting_approval blip happened.
    const events: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p-happy", (e) =>
      events.push(e as unknown as Record<string, unknown>),
    )

    let iters: number
    try {
      iters = await drainPipeline(makeSupabase(state), "p-happy", state)
    } finally {
      unsub()
    }

    // The engine advanced through every stage and reached terminal in <20 iters.
    expect(iters).toBeLessThan(20)
    const finalPipeline = state.pipelines.get("p-happy")!
    expect(finalPipeline.status).toBe("completed")

    // Every stage row is `approved`.
    for (const stageName of [
      "script",
      "characters",
      "objects",
      "locations",
      "shot_list",
      "scene_images",
      "animate_audio_edit",
      "post_merge",
    ]) {
      const row = state.stages.find(
        (s) => s.pipeline_id === "p-happy" && s.stage_name === stageName,
      )
      expect(row, `stage ${stageName} should exist`).toBeDefined()
      expect(row!.status, `stage ${stageName} should be approved`).toBe("approved")
    }

    // Each entity stage was dispatched with mode='auto'.
    expect(runCharactersStage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "auto", pipelineId: "p-happy" }),
    )
    expect(runObjectsStage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "auto", pipelineId: "p-happy" }),
    )
    expect(runLocationsStage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "auto", pipelineId: "p-happy" }),
    )
    expect(runShotListStage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "auto", pipelineId: "p-happy" }),
    )
    expect(runSceneImagesStage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "auto", pipelineId: "p-happy" }),
    )

    // No `pipeline:status awaiting_approval` event was emitted — auto-mode
    // never rested. (The engine only publishes this on drift OR Stage-1 manual
    // outcome.)
    const awaitingEvent = events.find(
      (e) => e.type === "pipeline:status" && e.status === "awaiting_approval",
    )
    expect(awaitingEvent).toBeUndefined()

    // Failure side never triggered.
    expect(refundPipelineCredits).not.toHaveBeenCalled()
    expect(finalPipeline.failure_reason).toBeFalsy()
  })

  it("Stage-1 blocking failure: objects_validation cap-reached → failed + full refund + no Stage 2", async () => {
    const state: MockState = { pipelines: new Map(), stages: [] }
    seedPipeline(state, "p-fail", { reserved_credits: 100, spent_credits: 0 })

    // Script stage returns the failed outcome (after its 2-retry cap was hit
    // on duplicate object keys). This is the contract from runScriptStage's
    // own unit tests (see stages/__tests__/script.test.ts §
    // "returns failed with failure_detail='objects_validation' on cap-reached
    // blocking objects"). The row is pre-seeded by `seedPipeline`; the
    // engine's failure-handling code then flips it to `failed`.
    ;(runScriptStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "failed",
      reason: "script_critic_unresolvable",
      failure_detail: "objects_validation",
    })

    const iters = await drainPipeline(makeSupabase(state), "p-fail", state)
    expect(iters).toBeLessThan(20)

    // Pipeline marked failed with the unresolvable reason.
    const finalPipeline = state.pipelines.get("p-fail")!
    expect(finalPipeline.status).toBe("failed")
    expect(finalPipeline.failure_reason).toBe("script_critic_unresolvable")

    // Script stage row failed and carries the structured failure_detail.
    const scriptRow = state.stages.find(
      (s) => s.pipeline_id === "p-fail" && s.stage_name === "script",
    )
    expect(scriptRow).toBeDefined()
    expect(scriptRow!.status).toBe("failed")
    expect(
      (scriptRow!.critic_feedback as Record<string, unknown> | undefined)?.failure_detail,
    ).toBe("objects_validation")

    // Stage 2 (characters) was never dispatched — the failure terminated the run.
    expect(runCharactersStage).not.toHaveBeenCalled()
    expect(runObjectsStage).not.toHaveBeenCalled()
    expect(runLocationsStage).not.toHaveBeenCalled()
    expect(runShotListStage).not.toHaveBeenCalled()
    expect(runSceneImagesStage).not.toHaveBeenCalled()
    expect(runAnimateAudioEditStage).not.toHaveBeenCalled()
    expect(runPostMergeStage).not.toHaveBeenCalled()

    // Full upfront credit refund was issued (reserved 100, spent 0 → refund 100).
    expect(refundPipelineCredits).toHaveBeenCalledTimes(1)
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        pipelineId: "p-fail",
        credits: 100,
        reason: "pipeline_failed:script_critic_unresolvable",
      }),
    )
  })

  it("Stage-1 manual mode regression: pass verdict → awaiting_approval (engine does NOT auto-advance)", async () => {
    // Sanity check: when mode='manual', the same engine entry point pauses at
    // Stage 1 after a passing verdict. Confirms the auto/manual branch in
    // `runScriptAndPersist` is the only difference between scenarios 1 and 2.
    const state: MockState = { pipelines: new Map(), stages: [] }
    seedPipeline(state, "p-manual", { mode: "manual" })

    ;(runScriptStage as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "awaiting_approval",
      plan: fakePlan,
      scriptCritic: passScriptVerdict,
      castCoverageCritic: passCastVerdict,
      locationsCoverageCritic: passLocationsVerdict,
      objectsValidation: passObjectsVerdict,
    })

    await drainPipeline(makeSupabase(state), "p-manual", state)

    const finalPipeline = state.pipelines.get("p-manual")!
    expect(finalPipeline.status).toBe("awaiting_approval")
    expect(runCharactersStage).not.toHaveBeenCalled()
    // The engine does NOT enqueue itself in manual-pass mode; the approve route does.
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })
})
