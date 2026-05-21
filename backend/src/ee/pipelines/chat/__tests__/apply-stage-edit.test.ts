/**
 * Phase 1D.2b D1 — applyStageEdit unified helper tests.
 *
 * Helper is the single source of truth for the stage-advance transition used
 * by BOTH the chat_apply route and the approve_edits route. It validates a
 * JSON Patch against the per-stage Zod schema (STAGE_PATCH_SCHEMA), enforces
 * reference-integrity for Script-stage cast/locations/objects removals,
 * inserts a new pipeline_stage_attempts row, updates the source chat turn's
 * applied_to_attempt_id, then CAS-flips pipeline_stages.status from
 * awaiting_approval → approved + enqueues the next stage + publishes the
 * chat:proposal_applied SSE event.
 *
 * The 7 test cases cover every failure mode in §5.1 plus the happy path +
 * the CAS-race regression (concurrent approval).
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import type { ShowrunnerPlan, JsonPatch } from "@nodaro/shared"

// ---------------------------------------------------------------------------
// Hoisted mocks. queue.ts pulls in BullMQ + ioredis at import time, so we
// always mock it. pipelineEvents is real — easy to spy on publish().
// ---------------------------------------------------------------------------

vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

import { applyStageEdit } from "../apply-stage-edit.js"
import { enqueuePipelineRun } from "../../queue.js"
import { pipelineEvents } from "../../events.js"

beforeEach(() => vi.clearAllMocks())

// ─── Fixtures ────────────────────────────────────────────────────────────────

function basePlan(): ShowrunnerPlan {
  return {
    title: "T",
    logline: "L",
    target_duration_seconds: 30,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    genre: "drama",
    tone: ["intimate"],
    cast: [
      {
        key: "alice",
        name: "Alice",
        role: "protagonist",
        has_dialogue: true,
        voice_profile: "v",
        angle_count_hint: 5,
        expression_set_hint: ["neutral"],
        visual_description: "",
      },
      {
        key: "bob",
        name: "Bob",
        role: "supporting",
        has_dialogue: false,
        voice_profile: "",
        angle_count_hint: 3,
        expression_set_hint: ["neutral"],
        visual_description: "",
      },
    ],
    locations: [
      {
        key: "kitchen",
        name: "Kitchen",
        visual_description: "k",
        variants_needed: [],
      },
    ],
    objects: [],
    scenes: [
      {
        scene_index: 1,
        description: "s1",
        duration_seconds: 10,
        cast_keys: ["alice"],
        location_key: "kitchen",
        object_keys: [],
        dialogue: [],
        narration: null,
        emotional_beat: "setup",
        shot_count_hint: 1,
        continuity_from_prev: "hard_cut",
      },
      {
        scene_index: 2,
        description: "s2",
        duration_seconds: 10,
        cast_keys: ["bob"],
        location_key: "kitchen",
        object_keys: [],
        dialogue: [],
        narration: null,
        emotional_beat: "rising",
        shot_count_hint: 1,
        continuity_from_prev: "hard_cut",
      },
      {
        scene_index: 3,
        description: "s3",
        duration_seconds: 10,
        cast_keys: ["alice", "bob"],
        location_key: "kitchen",
        object_keys: [],
        dialogue: [],
        narration: null,
        emotional_beat: "release",
        shot_count_hint: 1,
        continuity_from_prev: "hard_cut",
      },
    ],
    beats: [],
    has_narrator: false,
    narrator_profile: null,
    music_plan: { mood: "m", bpm_target: 100, genre_hints: [] },
    global_style: {
      visual_style: "v",
      color_palette: "p",
      lighting: "l",
      camera_language: "c",
    },
    total_duration_seconds: 30,
    estimated_scene_count: 3,
    warnings: [],
  } as ShowrunnerPlan
}

// ─── In-memory Supabase mock ─────────────────────────────────────────────────

interface StageRow {
  id: string
  pipeline_id: string
  stage_name: string
  stage_order: number
  status: string
  output?: Record<string, unknown> | null
}

interface AttemptRow {
  id: string
  pipeline_stage_id: string
  attempt_n: number
  trigger: string
  output: Record<string, unknown>
}

interface ChatTurnRow {
  id: string
  pipeline_stage_id: string
  applied_to_attempt_id: string | null
}

interface PipelineRow {
  id: string
  user_id: string
}

interface MockState {
  stages: StageRow[]
  attempts: AttemptRow[]
  chatTurns: ChatTurnRow[]
  pipelines: Map<string, PipelineRow>
  /** Force the pipeline_stages CAS UPDATE to return 0 rows even when filters match (race-loss simulator). */
  forceCasMiss?: boolean
  /** Snapshot of all .insert() calls, useful for "did we write the audit row?" assertions. */
  attemptInsertCalls: Array<Record<string, unknown>>
  chatTurnUpdates: Array<{ id: string; patch: Record<string, unknown> }>
}

function makeSupabase(state: MockState): unknown {
  return {
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: (cols: string) => ({
            eq: (col: string, val: unknown) => {
              const findRow = () =>
                state.stages.find((s) =>
                  col === "id"
                    ? s.id === val
                    : col === "pipeline_id"
                      ? s.pipeline_id === val
                      : false,
                )
              return {
                single: async () => {
                  const row = findRow()
                  if (!row) {
                    return { data: null, error: { message: "not found" } }
                  }
                  // Project only the requested cols when "id, status, stage_name, output"
                  void cols
                  return { data: row, error: null }
                },
                maybeSingle: async () => {
                  const row = findRow()
                  return { data: row ?? null, error: null }
                },
              }
            },
          }),
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
                  if (state.forceCasMiss) {
                    return resolve({ data: [], error: null })
                  }
                  const matched: { id: string }[] = []
                  for (const row of state.stages) {
                    const allMatch = Object.entries(filters).every(
                      ([k, v]) =>
                        (row as unknown as Record<string, unknown>)[k] === v,
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
      if (table === "pipeline_stage_attempts") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, val: unknown) => ({
              order: (_orderCol: string, _opts: unknown) => ({
                limit: (_n: number) => ({
                  maybeSingle: async () => {
                    const rows = state.attempts
                      .filter((a) => a.pipeline_stage_id === val)
                      .sort((a, b) => b.attempt_n - a.attempt_n)
                    return { data: rows[0] ?? null, error: null }
                  },
                }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            state.attemptInsertCalls.push(row)
            return {
              select: (_selectCols: string) => ({
                single: async () => {
                  const newRow: AttemptRow = {
                    id: `attempt-${state.attempts.length + 1}`,
                    pipeline_stage_id: row.pipeline_stage_id as string,
                    attempt_n: row.attempt_n as number,
                    trigger: row.trigger as string,
                    output: (row.output as Record<string, unknown>) ?? {},
                  }
                  state.attempts.push(newRow)
                  return { data: { id: newRow.id }, error: null }
                },
              }),
            }
          },
        }
      }
      if (table === "pipeline_chat_turns") {
        return {
          update: (patch: Record<string, unknown>) => {
            const filters: Record<string, unknown> = {}
            const chain = {
              eq: (col: string, v: unknown) => {
                filters[col] = v
                return chain
              },
              then: async (
                resolve: (v: { data: null; error: null }) => unknown,
              ) => {
                for (const row of state.chatTurns) {
                  const allMatch = Object.entries(filters).every(
                    ([k, v]) =>
                      (row as unknown as Record<string, unknown>)[k] === v,
                  )
                  if (allMatch) {
                    state.chatTurnUpdates.push({ id: row.id, patch })
                    Object.assign(row, patch)
                  }
                }
                return resolve({ data: null, error: null })
              },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freshState(opts: {
  stageStatus?: string
  attemptOutput?: Record<string, unknown>
  withChatTurn?: boolean
  forceCasMiss?: boolean
}): MockState {
  // Match production storage: engine.ts:301 writes Stage 1 output wrapped as
  // `{plan: ShowrunnerPlan}`, not the bare plan. The attempt row is seeded
  // with the same envelope so the helper's "latest attempt" read path
  // exercises the unwrap-then-validate-then-rewrap flow end-to-end.
  const wrappedPlan = (): Record<string, unknown> => ({
    plan: basePlan() as unknown as Record<string, unknown>,
  })
  const state: MockState = {
    stages: [
      {
        id: "stage-1",
        pipeline_id: "pipeline-1",
        stage_name: "script",
        stage_order: 1,
        status: opts.stageStatus ?? "awaiting_approval",
        output: opts.attemptOutput ?? wrappedPlan(),
      },
    ],
    attempts: [
      {
        id: "attempt-1",
        pipeline_stage_id: "stage-1",
        attempt_n: 1,
        trigger: "initial",
        output: opts.attemptOutput ?? wrappedPlan(),
      },
    ],
    chatTurns: opts.withChatTurn
      ? [
          {
            id: "turn-1",
            pipeline_stage_id: "stage-1",
            applied_to_attempt_id: null,
          },
        ]
      : [],
    pipelines: new Map([["pipeline-1", { id: "pipeline-1", user_id: "u1" }]]),
    forceCasMiss: opts.forceCasMiss,
    attemptInsertCalls: [],
    chatTurnUpdates: [],
  }
  return state
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("applyStageEdit (Phase 1D.2b D1)", () => {
  it("stage_not_awaiting — stage at 'approved' is rejected", async () => {
    const state = freshState({ stageStatus: "approved" })
    const supabase = makeSupabase(state)
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-1",
      userId: "u1",
      jsonPatch: [{ op: "replace", path: "/title", value: "New" }] as JsonPatch,
      source: "chat_apply",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stage_not_awaiting")
    expect(state.attemptInsertCalls).toEqual([]) // no audit row written
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("patch_invalid — malformed op rejected by fast-json-patch validate", async () => {
    const state = freshState({})
    const supabase = makeSupabase(state)
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-1",
      userId: "u1",
      // op="invalid" is not in the RFC 6902 op set — fast-json-patch validate rejects.
      jsonPatch: [
        { op: "invalid" as unknown as "replace", path: "/title", value: "New" },
      ] as JsonPatch,
      source: "chat_apply",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("patch_invalid")
    expect(state.attemptInsertCalls).toEqual([])
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("patch_invalid (non-script) — stage_not_patchable=true when stageName has null STAGE_PATCH_SCHEMA", async () => {
    const state: MockState = {
      stages: [
        {
          id: "stage-2",
          pipeline_id: "pipeline-1",
          stage_name: "characters",
          stage_order: 2,
          status: "awaiting_approval",
          output: {},
        },
      ],
      attempts: [],
      chatTurns: [],
      pipelines: new Map([["pipeline-1", { id: "pipeline-1", user_id: "u1" }]]),
      attemptInsertCalls: [],
      chatTurnUpdates: [],
    }
    const supabase = makeSupabase(state)
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "characters",
      stageId: "stage-2",
      userId: "u1",
      jsonPatch: [{ op: "replace", path: "/foo", value: "bar" }] as JsonPatch,
      source: "chat_apply",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("patch_invalid")
      expect((result.detail as { stage_not_patchable?: boolean }).stage_not_patchable).toBe(
        true,
      )
    }
    expect(state.attemptInsertCalls).toEqual([])
  })

  it("schema_invalid — patch producing target_duration_seconds=-5 rejected by ShowrunnerPlanSchema", async () => {
    const state = freshState({})
    const supabase = makeSupabase(state)
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-1",
      userId: "u1",
      jsonPatch: [
        // target_duration_seconds is z.number().positive() — -5 violates that.
        { op: "replace", path: "/target_duration_seconds", value: -5 },
      ] as JsonPatch,
      source: "chat_apply",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("schema_invalid")
      // Zod issues array carries the path.
      expect(result.detail).toBeDefined()
    }
    expect(state.attemptInsertCalls).toEqual([])
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("reference_integrity_failed — removing 'alice' from cast while scene 1 still references it", async () => {
    const state = freshState({})
    const supabase = makeSupabase(state)
    // Remove alice from cast (index 0) but leave scene 1's cast_keys[0]='alice' untouched.
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-1",
      userId: "u1",
      jsonPatch: [{ op: "remove", path: "/cast/0" }] as JsonPatch,
      source: "chat_apply",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("reference_integrity_failed")
      // Detail surfaces the integrity helper's output (manifest + removed_key + remaining_refs).
      const d = result.detail as { manifest: string; removed_key: string }
      expect(d.manifest).toBe("cast")
      expect(d.removed_key).toBe("alice")
    }
    expect(state.attemptInsertCalls).toEqual([])
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("happy path — valid patch creates new attempt, flips stage to approved, updates chat turn, enqueues + publishes SSE", async () => {
    const state = freshState({ withChatTurn: true })
    const supabase = makeSupabase(state)
    const publishSpy = vi.spyOn(pipelineEvents, "publish")
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-1",
      userId: "u1",
      jsonPatch: [
        { op: "replace", path: "/title", value: "Refined Title" },
      ] as JsonPatch,
      source: "chat_apply",
      chatTurnId: "turn-1",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.newAttemptId).toBe("attempt-2")
      expect((result.newOutput as ShowrunnerPlan).title).toBe("Refined Title")
    }
    // New attempt inserted: attempt_n=2, trigger='chat_refine'.
    expect(state.attemptInsertCalls).toHaveLength(1)
    expect(state.attemptInsertCalls[0]).toMatchObject({
      pipeline_stage_id: "stage-1",
      attempt_n: 2,
      trigger: "chat_refine",
    })
    // Chat turn's applied_to_attempt_id was set.
    expect(state.chatTurnUpdates).toEqual([
      { id: "turn-1", patch: { applied_to_attempt_id: "attempt-2" } },
    ])
    // Stage was flipped to approved.
    expect(state.stages[0]!.status).toBe("approved")
    // Next stage was enqueued.
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "pipeline-1",
      userId: "u1",
      reason: "stage_advance",
    })
    // SSE was published with the proposal_applied event.
    expect(publishSpy).toHaveBeenCalledWith({
      type: "chat:proposal_applied",
      pipelineId: "pipeline-1",
      stageName: "script",
      turnId: "turn-1",
      attemptId: "attempt-2",
    })
    publishSpy.mockRestore()
  })

  it("writes patched plan back to pipeline_stages.output wrapped as {plan: ...}", async () => {
    // Regression test for the envelope-aware writeback. The engine writes
    // Stage 1's output as `{plan: ShowrunnerPlan}`. Downstream stages (e.g.
    // characters.ts:63) read via `(scriptStage?.output as { plan?: ... })?.plan`.
    // The helper MUST update pipeline_stages.output with the SAME envelope —
    // not the bare patched plan, and not just the attempt row.
    const state = freshState({})
    const supabase = makeSupabase(state)
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-1",
      userId: "u1",
      jsonPatch: [
        { op: "replace", path: "/title", value: "New" },
      ] as JsonPatch,
      source: "chat_apply",
    })
    expect(result.ok).toBe(true)
    // pipeline_stages.output is the envelope: {plan: ShowrunnerPlan}.
    const stage = state.stages.find((s) => s.id === "stage-1")!
    const stageOutput = stage.output as { plan?: ShowrunnerPlan }
    expect(stageOutput.plan).toBeDefined()
    expect(stageOutput.plan!.title).toBe("New")
    // And the rest of the plan is preserved (we patched only /title).
    expect(stageOutput.plan!.cast).toHaveLength(2)
    // pipeline_stage_attempts row also stores the envelope.
    const attempt = state.attempts[state.attempts.length - 1]!
    const attemptOutput = attempt.output as { plan?: ShowrunnerPlan }
    expect(attemptOutput.plan).toBeDefined()
    expect(attemptOutput.plan!.title).toBe("New")
    // The helper's returned newOutput is the BARE patched doc (callers don't
    // need to know about the envelope).
    if (result.ok) {
      expect((result.newOutput as ShowrunnerPlan).title).toBe("New")
    }
  })

  it("happy path with source='approve_edits' writes trigger='user_edit'", async () => {
    const state = freshState({})
    const supabase = makeSupabase(state)
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-1",
      userId: "u1",
      jsonPatch: [
        { op: "replace", path: "/title", value: "Edited" },
      ] as JsonPatch,
      source: "approve_edits",
    })
    expect(result.ok).toBe(true)
    expect(state.attemptInsertCalls[0]).toMatchObject({
      trigger: "user_edit",
    })
  })

  it("CAS race — stage was awaiting_approval at read but UPDATE returned 0 rows (someone else flipped first)", async () => {
    const state = freshState({ forceCasMiss: true })
    const supabase = makeSupabase(state)
    const result = await applyStageEdit({
      supabase: supabase as never,
      pipelineId: "pipeline-1",
      stageName: "script",
      stageId: "stage-1",
      userId: "u1",
      jsonPatch: [
        { op: "replace", path: "/title", value: "Race" },
      ] as JsonPatch,
      source: "chat_apply",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stage_not_awaiting")
    // The new attempt WAS written (audit trail) — design choice per plan §5.1 step 11.
    expect(state.attemptInsertCalls).toHaveLength(1)
    // But the orchestrator was NOT enqueued and SSE was NOT published.
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })
})
