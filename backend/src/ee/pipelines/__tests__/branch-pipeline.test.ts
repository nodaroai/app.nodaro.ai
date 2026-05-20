/**
 * Phase 1D.3 — branchPipeline service unit tests.
 *
 * Uses an in-memory Supabase mock that captures .insert() payloads keyed by
 * table, mirroring the style of fork.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoist mocks before any module import
// ---------------------------------------------------------------------------

vi.mock("../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

import { branchPipeline, BranchPipelineError } from "../branch-pipeline.js"
import { enqueuePipelineRun } from "../queue.js"

// ---------------------------------------------------------------------------
// In-memory Supabase mock
// ---------------------------------------------------------------------------

interface Pipeline {
  id: string
  status: string
  user_id: string
  workflow_id?: string | null
  root_node_id: string
  pipeline_type: string
  activation_mode: string
  mode: string
  input_prompt: string
  target_duration_seconds: number
  format: string
  output_resolution: string
  language: string
  style_directives?: unknown
  config?: unknown
  max_cost_credits?: number | null
}

interface Stage {
  stage_name: string
  stage_order: number
  output?: unknown
  critic_feedback?: unknown
  user_edits?: unknown
}

interface Entity {
  entity_type: string
  entity_key: string
  status: string
  main_asset_id?: string | null
  last_frame_asset_id?: string | null
  metadata?: unknown
}

interface Fixture {
  pipelinesInserted: Array<Record<string, unknown>>
  stagesInserted: Array<Record<string, unknown>>
  entitiesInserted: Array<Record<string, unknown>>
}

function makeSupabaseMock(
  pipeline: Pipeline | null,
  stages: Stage[] = [],
  entities: Entity[] = [],
): { client: unknown; fixture: Fixture } {
  const fixture: Fixture = {
    pipelinesInserted: [],
    stagesInserted: [],
    entitiesInserted: [],
  }

  let newPipelineId = "new-pipeline-id"

  const client = {
    from(table: string) {
      if (table === "pipelines") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              single: async () => ({
                data: pipeline,
                error: pipeline ? null : { message: "not found", code: "PGRST116" },
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            fixture.pipelinesInserted.push(row)
            return {
              select: (_cols: string) => ({
                single: async () => ({
                  data: { id: newPipelineId },
                  error: null,
                }),
              }),
            }
          },
        }
      }
      if (table === "pipeline_stages") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              in: (_col2: string, _vals: string[]) => ({
                data: stages.filter((s) => _vals.includes(s.stage_name)),
                error: null,
              }),
            }),
          }),
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            fixture.stagesInserted.push(...arr)
            return { error: null }
          },
        }
      }
      if (table === "pipeline_entities") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              in: (_col2: string, vals: string[]) => ({
                data: entities.filter((e) => vals.includes(e.entity_type)),
                error: null,
              }),
            }),
          }),
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            fixture.entitiesInserted.push(...arr)
            return { error: null }
          },
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
  }

  return { client, fixture }
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "orig-pipeline-id",
    status: "completed",
    user_id: "user-1",
    workflow_id: null,
    root_node_id: "root_1",
    pipeline_type: "story_to_video",
    activation_mode: "interactive",
    mode: "manual",
    input_prompt: "A pilot's final mission",
    target_duration_seconds: 60,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    style_directives: null,
    config: null,
    max_cost_credits: null,
    ...overrides,
  }
}

function makeStagesUpTo(count: number): Stage[] {
  const names = [
    "script",
    "characters",
    "objects",
    "locations",
    "shot_list",
    "scene_images",
    "animate_audio_edit",
    "post_merge",
  ] as const
  return names.slice(0, count).map((name, i) => ({
    stage_name: name,
    stage_order: i + 1,
    output: { some: "data" },
  }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe("branchPipeline", () => {
  it("inserts a new pipelines row with branched_from lineage", async () => {
    const { client, fixture } = makeSupabaseMock(
      makePipeline(),
      makeStagesUpTo(5),
    )
    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    expect(fixture.pipelinesInserted).toHaveLength(1)
    const inserted = fixture.pipelinesInserted[0]!
    expect(inserted.status).toBe("running")
    expect(inserted.branched_from_pipeline_id).toBe("orig-pipeline-id")
    expect(inserted.branched_from_stage).toBe("scene_images")
    expect(inserted.user_id).toBe("user-1")
    expect(inserted.input_prompt).toBe("A pilot's final mission")
    expect(inserted.pipeline_type).toBe("story_to_video")
  })

  it("clones upstream stages as approved", async () => {
    // Branching from scene_images (order 6) → clone stages 1-5
    const stages = makeStagesUpTo(5)
    const { client, fixture } = makeSupabaseMock(makePipeline(), stages)

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    // 5 upstream stages cloned + 1 branch stage inserted
    const upstreamInserts = fixture.stagesInserted.filter((s) => s.status === "approved")
    expect(upstreamInserts).toHaveLength(5)
    for (const row of upstreamInserts) {
      expect(row.pipeline_id).toBe("new-pipeline-id")
      expect(row.status).toBe("approved")
    }
  })

  it("inserts the branch stage as status='running'", async () => {
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5))

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    const runningStages = fixture.stagesInserted.filter((s) => s.status === "running")
    expect(runningStages).toHaveLength(1)
    expect(runningStages[0]!.stage_name).toBe("scene_images")
    expect(runningStages[0]!.stage_order).toBe(6)
    expect(runningStages[0]!.pipeline_id).toBe("new-pipeline-id")
  })

  it("clones pipeline_entities of the correct types for the branch stage", async () => {
    const entities: Entity[] = [
      { entity_type: "character", entity_key: "hero", status: "approved", main_asset_id: "a1" },
      { entity_type: "object", entity_key: "sword", status: "approved", main_asset_id: "a2" },
      { entity_type: "location", entity_key: "forest", status: "approved", main_asset_id: "a3" },
      { entity_type: "scene", entity_key: "scene_01", status: "approved", main_asset_id: "a4" },
    ]
    const { client, fixture } = makeSupabaseMock(
      makePipeline(),
      makeStagesUpTo(5),
      entities,
    )

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images", // ENTITY_BY_STAGE includes character, object, location, scene
      userId: "user-1",
    })

    expect(fixture.entitiesInserted).toHaveLength(4)
    const types = fixture.entitiesInserted.map((e) => e.entity_type)
    expect(types).toContain("character")
    expect(types).toContain("object")
    expect(types).toContain("location")
    expect(types).toContain("scene")
    // Every cloned entity should carry the approved status
    for (const e of fixture.entitiesInserted) {
      expect(e.status).toBe("approved")
      expect(e.pipeline_id).toBe("new-pipeline-id")
    }
  })

  it("enqueues a pipeline-run job with reason='branched' for the new pipeline", async () => {
    const { client } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5))

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    expect(enqueuePipelineRun).toHaveBeenCalledOnce()
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "new-pipeline-id",
      userId: "user-1",
      reason: "branched",
    })
  })

  it("rejects when pipeline is not completed", async () => {
    const { client } = makeSupabaseMock(makePipeline({ status: "running" }))

    await expect(
      branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      }),
    ).rejects.toThrow(BranchPipelineError)

    let thrownErr: BranchPipelineError | null = null
    try {
      await branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      })
    } catch (e) {
      thrownErr = e as BranchPipelineError
    }
    expect(thrownErr?.code).toBe("pipeline_not_completed")
  })

  it("rejects invalid stage name", async () => {
    const { client } = makeSupabaseMock(makePipeline())

    let thrownErr: BranchPipelineError | null = null
    try {
      await branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "garbage" as never,
        userId: "user-1",
      })
    } catch (e) {
      thrownErr = e as BranchPipelineError
    }
    expect(thrownErr).toBeInstanceOf(BranchPipelineError)
    expect(thrownErr?.code).toBe("invalid_stage")
  })

  it("branch from Stage 1 (script) — empty clone path: 0 upstream stages, branch stage = running", async () => {
    const { client, fixture } = makeSupabaseMock(
      makePipeline(),
      [], // no upstream stages to clone
      [], // no entities to clone
    )

    const result = await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "script",
      userId: "user-1",
    })

    // No upstream stages cloned
    expect(result.clonedStages).toHaveLength(0)
    expect(result.clonedEntities).toBe(0)

    // Only the branch stage itself should be inserted
    const approvedStages = fixture.stagesInserted.filter((s) => s.status === "approved")
    const runningStages = fixture.stagesInserted.filter((s) => s.status === "running")
    expect(approvedStages).toHaveLength(0)
    expect(runningStages).toHaveLength(1)
    expect(runningStages[0]!.stage_name).toBe("script")
    expect(runningStages[0]!.stage_order).toBe(1)

    // New pipeline is still created
    expect(fixture.pipelinesInserted).toHaveLength(1)
    expect(result.newPipelineId).toBe("new-pipeline-id")

    // Queue is still enqueued
    expect(enqueuePipelineRun).toHaveBeenCalledOnce()
  })
})
