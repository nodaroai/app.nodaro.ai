/**
 * Phase 1 (granular-pipeline-control spec) — saveStageEdit helper tests.
 *
 * Helper applies inline scene edits without advancing the stage: validates
 * the JSON Patch against the per-stage Zod schema, enforces the Phase 1
 * path/op whitelist, writes the patched plan to pipeline_stages.output, and
 * APPENDS the ops to pipeline_stages.user_edits. Does NOT CAS-flip status,
 * does NOT enqueue, does NOT emit SSE.
 *
 * Test cases cover: happy path (single + multi-op), pre-existing user_edits
 * accumulation, the four reject paths (stage_not_awaiting / stage_not_editable
 * / patch_path_not_editable / schema_invalid), and the CAS-race regression.
 */
import { describe, it, expect, beforeEach } from "vitest"
import type { JsonPatch, ShowrunnerPlan } from "@nodaro/shared"
import { saveStageEdit } from "../save-stage-edit.js"

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
        description: "s1 original",
        duration_seconds: 10,
        cast_keys: ["alice"],
        location_key: "kitchen",
        object_keys: [],
        dialogue: [{ cast_key: "alice", line: "hello" }],
        narration: null,
        emotional_beat: "setup",
        shot_count_hint: 1,
        continuity_from_prev: "hard_cut",
      },
      {
        scene_index: 2,
        description: "s2 original",
        duration_seconds: 10,
        cast_keys: ["alice"],
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
        description: "s3 original",
        duration_seconds: 10,
        cast_keys: ["alice"],
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
  status: string
  output: Record<string, unknown>
  user_edits: unknown[] | null
}

interface MockState {
  stages: StageRow[]
  /** Force the UPDATE to return 0 rows even when filters match (race-loss simulator). */
  forceCasMiss?: boolean
}

function makeSupabase(state: MockState): unknown {
  return {
    from: (table: string) => {
      if (table !== "pipeline_stages") {
        throw new Error(`Unmocked table: ${table}`)
      }
      return {
        select: (_cols: string) => ({
          eq: (col: string, val: unknown) => ({
            single: async () => {
              const row = state.stages.find((s) =>
                col === "id" ? s.id === val : false,
              )
              if (!row) return { data: null, error: { message: "not found" } }
              return { data: row, error: null }
            },
          }),
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
                resolve: (v: {
                  data: { id: string }[] | null
                  error: null
                }) => unknown,
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
    },
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function freshState(
  opts: {
    stageStatus?: string
    existingUserEdits?: unknown[] | null
    forceCasMiss?: boolean
  } = {},
): MockState {
  // Match production storage: engine.ts:301 writes Stage 1 output wrapped as
  // `{plan: ShowrunnerPlan}`. Seed the stage row with the same envelope so
  // the helper's unwrap-validate-rewrap path is exercised end-to-end.
  return {
    stages: [
      {
        id: "stage-1",
        pipeline_id: "pipeline-1",
        stage_name: "script",
        status: opts.stageStatus ?? "awaiting_approval",
        output: { plan: basePlan() as unknown as Record<string, unknown> },
        user_edits: opts.existingUserEdits ?? null,
      },
    ],
    forceCasMiss: opts.forceCasMiss,
  }
}

const baseArgs = (
  state: MockState,
  jsonPatch: JsonPatch,
  overrides: { stageName?: string } = {},
) =>
  ({
    supabase: makeSupabase(state) as never,
    pipelineId: "pipeline-1",
    stageId: "stage-1",
    stageName: (overrides.stageName ?? "script") as never,
    userId: "user-1",
    jsonPatch,
  }) as Parameters<typeof saveStageEdit>[0]

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  // No mocks to clear — helper is pure aside from the supabase arg.
})

describe("saveStageEdit — happy path", () => {
  it("applies a single-op patch to /scenes/0/description", async () => {
    const state = freshState()
    const patch: JsonPatch = [
      { op: "replace", path: "/scenes/0/description", value: "s1 edited" },
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(true)
    const stage = state.stages[0]!
    const written = stage.output as { plan: ShowrunnerPlan }
    expect(written.plan.scenes[0]!.description).toBe("s1 edited")
    // user_edits started as null; should now contain the one op.
    expect(stage.user_edits).toEqual(patch)
    // Status MUST remain awaiting_approval — save does not advance.
    expect(stage.status).toBe("awaiting_approval")
  })

  it("applies a multi-op patch across multiple scenes + fields", async () => {
    const state = freshState()
    const patch: JsonPatch = [
      { op: "replace", path: "/scenes/0/description", value: "s1 new" },
      { op: "replace", path: "/scenes/0/duration_seconds", value: 8 },
      { op: "replace", path: "/scenes/1/emotional_beat", value: "climax" },
      { op: "replace", path: "/scenes/0/dialogue/0/line", value: "goodbye" },
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(true)
    const written = state.stages[0]!.output as { plan: ShowrunnerPlan }
    expect(written.plan.scenes[0]!.description).toBe("s1 new")
    expect(written.plan.scenes[0]!.duration_seconds).toBe(8)
    expect(written.plan.scenes[1]!.emotional_beat).toBe("climax")
    expect(written.plan.scenes[0]!.dialogue[0]!.line).toBe("goodbye")
  })

  it("APPENDS to pre-existing user_edits (does not replace)", async () => {
    const priorOps = [
      { op: "replace", path: "/scenes/2/description", value: "s3 prior" },
    ]
    const state = freshState({ existingUserEdits: priorOps })
    const newPatch: JsonPatch = [
      { op: "replace", path: "/scenes/0/description", value: "s1 newer" },
    ]
    const result = await saveStageEdit(baseArgs(state, newPatch))
    expect(result.ok).toBe(true)
    expect(state.stages[0]!.user_edits).toEqual([...priorOps, ...newPatch])
  })
})

describe("saveStageEdit — reject paths", () => {
  it("rejects when the stage is not awaiting_approval", async () => {
    const state = freshState({ stageStatus: "approved" })
    const patch: JsonPatch = [
      { op: "replace", path: "/scenes/0/description", value: "x" },
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stage_not_awaiting")
  })

  it("rejects non-script stages with stage_not_editable", async () => {
    const state = freshState()
    const patch: JsonPatch = [
      { op: "replace", path: "/anything", value: "x" },
    ]
    const result = await saveStageEdit(
      baseArgs(state, patch, { stageName: "characters" }),
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stage_not_editable")
  })

  it("rejects a non-whitelisted path with patch_path_not_editable", async () => {
    const state = freshState()
    const patch: JsonPatch = [
      { op: "replace", path: "/cast/0/name", value: "Renamed" },
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("patch_path_not_editable")
      expect(result.detail).toMatchObject({ offending_path: "/cast/0/name" })
    }
  })

  it("rejects non-replace ops with patch_path_not_editable", async () => {
    const state = freshState()
    const patch: JsonPatch = [
      {
        op: "remove",
        path: "/scenes/0/description",
      } as unknown as JsonPatch[number],
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe("patch_path_not_editable")
      expect(result.detail).toMatchObject({ offending_op: "remove" })
    }
  })

  it("rejects schema-invalid values (negative duration) with schema_invalid", async () => {
    const state = freshState()
    const patch: JsonPatch = [
      { op: "replace", path: "/scenes/0/duration_seconds", value: -5 },
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("schema_invalid")
  })

  it("rejects schema-invalid values (unknown emotional_beat) with schema_invalid", async () => {
    const state = freshState()
    const patch: JsonPatch = [
      {
        op: "replace",
        path: "/scenes/0/emotional_beat",
        value: "not_a_real_beat",
      },
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("schema_invalid")
  })

  it("rejects patches targeting non-existent scene index with patch_invalid", async () => {
    const state = freshState()
    const patch: JsonPatch = [
      // basePlan has 3 scenes (indices 0..2); index 99 is out of range
      { op: "replace", path: "/scenes/99/description", value: "x" },
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("patch_invalid")
  })
})

describe("saveStageEdit — CAS race", () => {
  it("returns stage_not_awaiting when the UPDATE CAS finds 0 matching rows", async () => {
    const state = freshState({ forceCasMiss: true })
    const patch: JsonPatch = [
      { op: "replace", path: "/scenes/0/description", value: "s1 edited" },
    ]
    const result = await saveStageEdit(baseArgs(state, patch))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("stage_not_awaiting")
  })
})
