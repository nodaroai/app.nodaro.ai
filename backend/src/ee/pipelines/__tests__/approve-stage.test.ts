/**
 * Phase 1D.2b E1 — approveStage generalization tests.
 *
 * Verifies the generalized `approveStage(supabase, pipelineId, stageName, userId, edits?)`:
 *   - no-edits path: CAS-flips status='awaiting_approval' → 'approved',
 *     publishes stage:status SSE, enqueues stage_advance.
 *   - with-edits path: routes through `applyStageEdit` with
 *     source='approve_edits' (which marks the attempt row trigger as 'user_edit').
 *   - stage_not_found: maybeSingle returns null when the row is absent.
 *   - shim: `approveScriptStage` resolves userId internally and delegates.
 *
 * The `applyStageEdit` helper has its own end-to-end suite at
 * `chat/__tests__/apply-stage-edit.test.ts`; here we mock it and only assert
 * the call shape so we don't double-cover its internals.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { JsonPatch } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Hoisted mocks. `queue.js` pulls in BullMQ + ioredis; `apply-stage-edit.js`
// is the helper we want to spy on, mocked so we assert the call shape without
// re-running its end-to-end logic here.
// ---------------------------------------------------------------------------

vi.mock("../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

vi.mock("../chat/apply-stage-edit.js", () => ({
  applyStageEdit: vi.fn(async () => ({
    ok: true,
    newAttemptId: "attempt-X",
    newOutput: {},
  })),
}))

import { approveStage, approveScriptStage } from "../engine.js"
import { applyStageEdit } from "../chat/apply-stage-edit.js"
import { enqueuePipelineRun } from "../queue.js"
import { pipelineEvents } from "../events.js"

beforeEach(() => vi.clearAllMocks())

// ─── In-memory Supabase mock ────────────────────────────────────────────────

interface StageRow {
  id: string
  pipeline_id: string
  stage_name: string
  status: string
}

interface PipelineRow {
  id: string
  user_id: string
}

interface MockState {
  stages: StageRow[]
  pipelines: Map<string, PipelineRow>
  /** Force the pipeline_stages CAS UPDATE to return 0 rows. */
  forceCasMiss?: boolean
  stageUpdates: Array<{ filters: Record<string, unknown>; patch: Record<string, unknown> }>
}

function makeSupabase(state: MockState): unknown {
  return {
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: (_cols: string) => {
            const filters: Record<string, unknown> = {}
            const chain = {
              eq: (col: string, v: unknown) => {
                filters[col] = v
                return chain
              },
              maybeSingle: async () => {
                const row = state.stages.find((s) => {
                  if (filters.pipeline_id !== undefined && s.pipeline_id !== filters.pipeline_id)
                    return false
                  if (filters.stage_name !== undefined && s.stage_name !== filters.stage_name)
                    return false
                  return true
                })
                return { data: row ?? null, error: null }
              },
            }
            return chain
          },
          update: (patch: Record<string, unknown>) => {
            const filters: Record<string, unknown> = {}
            const chain = {
              eq: (col: string, v: unknown) => {
                filters[col] = v
                return chain
              },
              select: (_selectCols: string) => ({
                then: async (
                  resolve: (v: { data: { id: string }[] | null; error: null }) => unknown,
                ) => {
                  state.stageUpdates.push({ filters, patch })
                  if (state.forceCasMiss) {
                    return resolve({ data: [], error: null })
                  }
                  const matched: { id: string }[] = []
                  for (const row of state.stages) {
                    const allMatch = Object.entries(filters).every(
                      ([k, v]) => (row as unknown as Record<string, unknown>)[k] === v,
                    )
                    if (allMatch) {
                      Object.assign(row, patch)
                      matched.push({ id: row.id })
                    }
                  }
                  return resolve({ data: matched, error: null })
                },
              }),
            }
            return chain
          },
        }
      }
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: (_col: string, val: unknown) => ({
              single: async () => {
                const row = state.pipelines.get(val as string)
                return {
                  data: row ?? null,
                  error: row ? null : { message: "not found" },
                }
              },
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
  }
}

function freshState(overrides?: Partial<StageRow>): MockState {
  return {
    stages: [
      {
        id: "stage-script",
        pipeline_id: "pipeline-1",
        stage_name: "script",
        status: "awaiting_approval",
        ...overrides,
      },
    ],
    pipelines: new Map([["pipeline-1", { id: "pipeline-1", user_id: "u1" }]]),
    stageUpdates: [],
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("approveStage — no-edits path", () => {
  it("flips status='awaiting_approval'→'approved', publishes SSE, enqueues stage_advance", async () => {
    const state = freshState()
    const supabase = makeSupabase(state)
    const publishSpy = vi.spyOn(pipelineEvents, "publish")

    const result = await approveStage(
      supabase as never,
      "pipeline-1",
      "script",
      "u1",
    )

    expect(result).toEqual({ ok: true })
    // Stage row was flipped.
    expect(state.stages[0]!.status).toBe("approved")
    // CAS UPDATE included the awaiting_approval guard.
    expect(state.stageUpdates).toHaveLength(1)
    expect(state.stageUpdates[0]!.filters).toMatchObject({
      pipeline_id: "pipeline-1",
      stage_name: "script",
      status: "awaiting_approval",
    })
    expect(state.stageUpdates[0]!.patch).toMatchObject({ status: "approved" })
    expect(state.stageUpdates[0]!.patch.completed_at).toBeTypeOf("string")
    // applyStageEdit MUST NOT be called on the no-edits path.
    expect(applyStageEdit).not.toHaveBeenCalled()
    // Next stage was enqueued with the userId we passed in (NOT resolved internally).
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "pipeline-1",
      userId: "u1",
      reason: "stage_advance",
    })
    // SSE was published.
    expect(publishSpy).toHaveBeenCalledWith({
      type: "stage:status",
      pipelineId: "pipeline-1",
      stageName: "script",
      status: "approved",
    })
    publishSpy.mockRestore()
  })

  it("returns stage_already_advanced when CAS returns 0 rows (race lost)", async () => {
    const state = freshState({ status: "approved" }) // already advanced
    state.forceCasMiss = true
    const supabase = makeSupabase(state)
    const result = await approveStage(
      supabase as never,
      "pipeline-1",
      "script",
      "u1",
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stage_already_advanced")
    expect(applyStageEdit).not.toHaveBeenCalled()
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("treats edits=[] (empty patch) as the no-edits path (does NOT call applyStageEdit)", async () => {
    const state = freshState()
    const supabase = makeSupabase(state)
    const result = await approveStage(
      supabase as never,
      "pipeline-1",
      "script",
      "u1",
      [] as JsonPatch,
    )
    expect(result).toEqual({ ok: true })
    expect(applyStageEdit).not.toHaveBeenCalled()
    expect(enqueuePipelineRun).toHaveBeenCalled()
  })
})

describe("approveStage — with-edits path", () => {
  it("delegates to applyStageEdit with source='approve_edits' and the resolved stageId", async () => {
    const state = freshState()
    const supabase = makeSupabase(state)
    const patch: JsonPatch = [
      { op: "replace", path: "/title", value: "Refined" },
    ]
    const result = await approveStage(
      supabase as never,
      "pipeline-1",
      "script",
      "u1",
      patch,
    )
    expect(result).toEqual({ ok: true })
    expect(applyStageEdit).toHaveBeenCalledTimes(1)
    expect(applyStageEdit).toHaveBeenCalledWith({
      supabase: expect.anything(),
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-script",
      userId: "u1",
      jsonPatch: patch,
      source: "approve_edits",
    })
    // No-edits CAS UPDATE must NOT have run — applyStageEdit owns the flip.
    expect(state.stageUpdates).toEqual([])
    // The no-edits enqueue must NOT run either — applyStageEdit owns the enqueue.
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("forwards applyStageEdit's failure reason verbatim", async () => {
    ;(applyStageEdit as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      reason: "patch_invalid",
      detail: { whatever: true },
    })
    const state = freshState()
    const supabase = makeSupabase(state)
    const result = await approveStage(
      supabase as never,
      "pipeline-1",
      "script",
      "u1",
      [{ op: "replace", path: "/title", value: "X" }] as JsonPatch,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("patch_invalid")
  })
})

describe("approveStage — stage_not_found", () => {
  it("returns stage_not_found when the stage row is absent (e.g. characters not yet inserted)", async () => {
    // State has ONLY the script row. Asking for 'characters' must return stage_not_found.
    const state = freshState()
    const supabase = makeSupabase(state)
    const result = await approveStage(
      supabase as never,
      "pipeline-1",
      "characters",
      "u1",
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stage_not_found")
    expect(applyStageEdit).not.toHaveBeenCalled()
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
    expect(state.stageUpdates).toEqual([])
  })
})

describe("approveScriptStage — deprecation shim", () => {
  it("resolves userId from the pipeline row and delegates to approveStage('script', edits)", async () => {
    const state = freshState()
    const supabase = makeSupabase(state)
    const patch = [{ op: "replace", path: "/title", value: "Shimmed" }] as JsonPatch

    const result = await approveScriptStage(supabase as never, "pipeline-1", patch)

    expect(result).toEqual({ ok: true })
    // The shim picked up u1 from the pipelines table and passed it to applyStageEdit.
    expect(applyStageEdit).toHaveBeenCalledTimes(1)
    expect(applyStageEdit).toHaveBeenCalledWith({
      supabase: expect.anything(),
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-script",
      userId: "u1",
      jsonPatch: patch,
      source: "approve_edits",
    })
  })

  it("shim no-edits path: enqueues with the resolved userId", async () => {
    const state = freshState()
    const supabase = makeSupabase(state)
    const result = await approveScriptStage(supabase as never, "pipeline-1")
    expect(result).toEqual({ ok: true })
    expect(applyStageEdit).not.toHaveBeenCalled()
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "pipeline-1",
      userId: "u1",
      reason: "stage_advance",
    })
  })
})
