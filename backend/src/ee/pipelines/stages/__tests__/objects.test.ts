import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("../../services/pipeline-generate-image.js", () => ({ pipelineGenerateImage: vi.fn() }))
vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))
import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { enqueuePipelineRun } from "../../queue.js"
import { pipelineEvents } from "../../events.js"
import { runObjectsStage } from "../objects.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  cast: [], locations: [],
  objects: [{ key: "helmet", name: "Helmet", visual_description: "battered military helmet", narrative_significance: "keepsake" }],
  scenes: [], beats: [],
  global_style: { visual_style: "photoreal", color_palette: "warm", lighting: "golden", camera_language: "wide" },
  has_narrator: false, narrator_profile: null,
  music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
  total_duration_seconds: 60, estimated_scene_count: 0, warnings: [], tone: [],
  title: "x", logline: "x", target_duration_seconds: 60, format: "short_film",
  output_resolution: "1080p", language: "en", genre: "drama",
} as never

function makeSupabase(opts: { seedEntities?: Array<Record<string, unknown>> } = {}) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const seed of opts.seedEntities ?? []) {
    entities.set(seed.id as string, seed)
  }
  const stageUpdates: Array<Record<string, unknown>> = []
  return {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null }),
                single: async () => ({ data: { output: { plan: fakePlan } }, error: null }),
              }),
            }),
          }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "stage-3" }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => {
            stageUpdates.push(patch)
            return { eq: async () => ({ data: null, error: null }) }
          },
        }
      }
      if (table === "pipeline_entities") {
        // N-level .eq() chain (thenable at every depth). Supports:
        //   await .select().eq().eq()             (2 — entity refresh)
        //   await .select("id").eq().eq().eq()    (3 — markStageEntityNodesState)
        //   .select().eq().eq().order()           (terminal order)
        const makeEqChain = (): {
          eq: () => unknown
          order: () => Promise<{ data: unknown; error: null }>
          then: (
            resolve: (v: { data: unknown; error: null }) => unknown,
          ) => unknown
        } => {
          const data = Array.from(entities.values())
          const node: {
            eq: () => unknown
            order: () => Promise<{ data: unknown; error: null }>
            then: (
              resolve: (v: { data: unknown; error: null }) => unknown,
            ) => unknown
          } = {
            eq: () => makeEqChain(),
            order: async () => ({ data, error: null }),
            then: (resolve) => resolve({ data, error: null }),
          }
          return node
        }
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
          upsert: (row: Record<string, unknown>) => {
            const id = `e-${row.entity_key}`
            if (!entities.has(id)) entities.set(id, { id, ...row })
            return Promise.resolve({ data: null, error: null })
          },
          select: () => ({
            eq: () => makeEqChain(),
          }),
          update: (patch: Record<string, unknown>) => makeUpdateChain(patch),
        }
      }
      if (table === "pipeline_entity_nodes") {
        // Auto-mode bulk-flip writes here via .update().in("entity_id", [...]).
        return {
          update: () => ({
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

describe("runObjectsStage", () => {
  it("generates one image per object whose description was approved (status=pending)", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/helmet.png", creditsSpent: 2,
    })
    // Seed `pending` — i.e. the user already passed the Step A description gate
    // (Generate). New objects now start at `pending_description` (see the
    // pause test below), so generation only runs once a description is approved.
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-helmet", entity_key: "helmet", pipeline_id: "p1",
          entity_type: "object", status: "pending",
          metadata: { entity_type: "object", name: "Helmet", visual_description: "x" },
        },
      ],
    })
    await runObjectsStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(1)
    const row = (supabase as never as { _entities: Map<string, Record<string, unknown>> })._entities.get("e-helmet")
    expect(row?.status).toBe("awaiting_approval")
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D.2a §4.1 (G2): auto-mode bulk-approve
  // ──────────────────────────────────────────────────────────────────────────

  it("auto-mode: bulk-approves objects + flips stage + re-enqueues after generation", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/helmet.png", creditsSpent: 2,
    })
    const supabase = makeSupabase()
    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p1-auto", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )

    try {
      await runObjectsStage({
        supabase, pipelineId: "p1-auto", userId: "u1", userTier: "pro", mode: "auto",
      })
    } finally {
      unsub()
    }

    // Object entity flipped to `approved` by the auto-mode UPDATE
    // (status='approved' WHERE status='awaiting_approval').
    const row = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-helmet")
    expect(row?.status).toBe("approved")

    // Stage row flipped to `approved`.
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "approved")).toBeDefined()

    // SSE `stage:status approved` emitted.
    const approvedEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "approved",
    )
    expect(approvedEvent).toBeDefined()

    // Orchestrator re-enqueued with reason=stage_advance.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-auto",
      userId: "u1",
      reason: "stage_advance",
    })
  })

  it("auto-mode: on a re-entrant pass with already-awaiting entities, still advances", async () => {
    // Seed: helmet already awaiting (no generation needed this pass). The
    // existing manual-mode code path falls through to `if (!allApproved)
    // return` and pauses — auto-mode must instead bulk-approve and advance.
    // pipeline_id + entity_type MUST match the auto-mode UPDATE filter
    // (`.eq("pipeline_id", ...).eq("entity_type", "object").eq("status",
    // "awaiting_approval")`) or the in-memory mock won't update the row.
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-helmet",
          entity_key: "helmet",
          pipeline_id: "p1-auto-re",
          entity_type: "object",
          status: "awaiting_approval",
          metadata: { entity_type: "object", name: "Helmet", visual_description: "x" },
        },
      ],
    })

    await runObjectsStage({
      supabase, pipelineId: "p1-auto-re", userId: "u1", userTier: "pro", mode: "auto",
    })

    const row = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-helmet")
    expect(row?.status).toBe("approved")
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-auto-re",
      userId: "u1",
      reason: "stage_advance",
    })
  })

  it("manual-mode: when all objects are approved, marks stage approved AND re-enqueues to advance (regression: lost-wakeup stall)", async () => {
    // Seed the object entity already approved (the user just approved the last
    // object). The stage must finalize AND drive the next stage. Previously the
    // manual path marked the stage approved but never enqueued, stalling the
    // pipeline at `objects approved / current_stage=NULL` (prod pipeline
    // e06d9ff3, 2026-05-27).
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-helmet",
          entity_key: "helmet",
          pipeline_id: "p1-manual-done",
          entity_type: "object",
          status: "approved",
          metadata: { entity_type: "object", name: "Helmet", visual_description: "x" },
        },
      ],
    })

    await runObjectsStage({
      supabase, pipelineId: "p1-manual-done", userId: "u1", userTier: "pro", mode: "manual",
    })

    // Stage finalized…
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "approved")).toBeDefined()
    // …AND the orchestrator was re-enqueued to advance to locations.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-manual-done",
      userId: "u1",
      reason: "stage_advance",
    })
  })

  it("guided-mode: also advances + re-enqueues on completion (guided shares the non-auto path)", async () => {
    // The stage handlers only special-case `mode === "auto"`; guided falls
    // through the same non-auto branch as manual, so it had the identical
    // stall bug and is covered by the same fix. This test pins that contract.
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-helmet",
          entity_key: "helmet",
          pipeline_id: "p1-guided-done",
          entity_type: "object",
          status: "approved",
          metadata: { entity_type: "object", name: "Helmet", visual_description: "x" },
        },
      ],
    })

    await runObjectsStage({
      supabase, pipelineId: "p1-guided-done", userId: "u1", userTier: "pro", mode: "guided",
    })

    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-guided-done",
      userId: "u1",
      reason: "stage_advance",
    })
  })

  it("manual-mode: new objects pause at pending_description for the Step A gate (no spend)", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/helmet.png", creditsSpent: 2,
    })
    const supabase = makeSupabase()
    await runObjectsStage({
      supabase, pipelineId: "p1-manual", userId: "u1", userTier: "pro", mode: "manual",
    })
    const row = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-helmet")
    // No image yet — the object waits at the description gate for the user's
    // Generate / Upload / Reuse / Skip choice before any credits are spent.
    expect(row?.status).toBe("pending_description")
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("manual-mode: a skipped object counts as resolved and doesn't block stage advance", async () => {
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-helmet", entity_key: "helmet", pipeline_id: "p1-skip",
          entity_type: "object", status: "skipped",
          metadata: { entity_type: "object", name: "Helmet", visual_description: "x" },
        },
      ],
    })
    await runObjectsStage({
      supabase, pipelineId: "p1-skip", userId: "u1", userTier: "pro", mode: "manual",
    })
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "approved")).toBeDefined()
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
    expect(enqueuePipelineRun).toHaveBeenCalled()
  })

  it("manual-mode: a failed object is recovered to the choose-gate, NOT advanced past (regression)", async () => {
    // Repro of the bug: a location/object that failed (e.g. credit error) used
    // to let the stage fall through to 'approved' and advance. It must instead
    // go back to pending_description so the stage holds open + the user recovers.
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-helmet", entity_key: "helmet", pipeline_id: "p1-obj-failrec",
          entity_type: "object", status: "failed",
          metadata: {
            entity_type: "object", name: "Helmet", visual_description: "x",
            last_error: "Credit reservation failed: Insufficient credits",
          },
        },
      ],
    })
    await runObjectsStage({
      supabase, pipelineId: "p1-obj-failrec", userId: "u1", userTier: "pro", mode: "manual",
    })
    const row = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-helmet")
    expect(row?.status).toBe("pending_description") // recovered to the gate
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "approved")).toBeUndefined() // did NOT advance
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })
})
