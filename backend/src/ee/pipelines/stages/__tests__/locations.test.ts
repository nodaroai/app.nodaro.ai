import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../services/pipeline-generate-image.js", () => ({ pipelineGenerateImage: vi.fn() }))
vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { enqueuePipelineRun } from "../../queue.js"
import { pipelineEvents } from "../../events.js"
import { runLocationsStage } from "../locations.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  cast: [],
  objects: [],
  locations: [
    {
      key: "carrier_deck",
      name: "Carrier Deck",
      visual_description: "naval aircraft carrier flight deck at sea",
      variants_needed: ["sunrise", "night"],
    },
  ],
  scenes: [],
  beats: [],
  tone: [],
  global_style: {
    visual_style: "photoreal",
    color_palette: "warm",
    lighting: "golden",
    camera_language: "wide",
  },
  has_narrator: false,
  narrator_profile: null,
  music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
  total_duration_seconds: 60,
  estimated_scene_count: 0,
  warnings: [],
  title: "x",
  logline: "x",
  target_duration_seconds: 60,
  format: "short_film",
  output_resolution: "1080p",
  language: "en",
  genre: "drama",
} as never

function makeSupabase(opts: {
  entityState?: "pending" | "approved"
  seedEntities?: Array<Record<string, unknown>>
  pipelineId?: string
} = {}) {
  const pipelineId = opts.pipelineId ?? "p1"
  const entities = new Map<string, Record<string, unknown>>()
  if (opts.seedEntities) {
    for (const seed of opts.seedEntities) {
      entities.set(seed.id as string, seed)
    }
  } else {
    const entityState = opts.entityState ?? "pending"
    entities.set("e-carrier_deck", {
      id: "e-carrier_deck",
      entity_key: "carrier_deck",
      pipeline_id: pipelineId,
      entity_type: "location",
      status: entityState,
      metadata: {},
      main_asset_id: entityState === "approved" ? "main-asset" : null,
    })
  }
  const variants: Array<Record<string, unknown>> = []
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
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: "stage-4" }, error: null }) }),
          }),
          update: (patch: Record<string, unknown>) => {
            stageUpdates.push(patch)
            return { eq: async () => ({ data: null, error: null }) }
          },
        }
      }
      if (table === "pipeline_entities") {
        // N-level .eq() chain (thenable at every depth):
        //   await .select().eq().eq()             — 2-level (entity refresh)
        //   await .select("id").eq().eq().eq()    — 3-level (markStageEntityNodesState)
        //   .select().eq().eq().order()           — terminal .order()
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
          upsert: () => Promise.resolve({ data: null, error: null }),
          select: () => ({
            eq: () => makeEqChain(),
          }),
          update: (patch: Record<string, unknown>) => makeUpdateChain(patch),
        }
      }
      if (table === "pipeline_entity_variants") {
        return {
          insert: (row: Record<string, unknown>) => {
            variants.push(row)
            return Promise.resolve({ data: null, error: null })
          },
          select: () => ({ eq: async () => ({ data: variants, error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
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
      if (table === "assets") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { r2_url: "https://r2/main.png" } }),
            }),
          }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
    _entities: entities,
    _variants: variants,
    _stageUpdates: stageUpdates,
  } as never
}

describe("runLocationsStage", () => {
  it("generates main image on first pass", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/main.png",
      creditsSpent: 2,
    })
    const supabase = makeSupabase({ entityState: "pending" })
    await runLocationsStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(1)
  })

  it("generates 2 variants after main is approved", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "v1",
      assetId: "av1",
      assetUrl: "https://r2/v1.png",
      creditsSpent: 2,
    })
    const supabase = makeSupabase({ entityState: "approved" })
    await runLocationsStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })
    // 2 variants × 1 call each
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(2)
    const variants = (supabase as never as { _variants: Array<Record<string, unknown>> })
      ._variants
    expect(variants).toHaveLength(2)
    expect(variants[0]?.variant_kind).toBe("time_of_day") // "sunrise"
    expect(variants[1]?.variant_kind).toBe("time_of_day") // "night"
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D.2a §4.1 (G3): auto-mode bulk-approve
  // ──────────────────────────────────────────────────────────────────────────
  //
  // Locations has a two-phase approval flow:
  //   Phase 1 — per-location main image gate (entity reaches
  //             `awaiting_approval` after `generateLocationMain`).
  //   Phase 2 — variant-batch gate (`metadata.variants_awaiting_approval`
  //             flag set on every entity after `ensureLocationVariants`).
  //
  // Auto-mode must short-circuit BOTH gates. Two tests below cover each
  // phase independently.

  it("auto-mode phase 1: bulk-approves at the per-location main-image gate", async () => {
    // Pending entity → `generateLocationMain` runs → entity flips to
    // `awaiting_approval`. Auto-mode then bulk-approves and re-enqueues
    // (the variant generation happens on the NEXT pass, not this one).
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "a1",
      assetUrl: "https://r2/main.png",
      creditsSpent: 2,
    })
    const supabase = makeSupabase({
      entityState: "pending",
      pipelineId: "p1-auto-phase1",
    })
    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p1-auto-phase1", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )

    try {
      await runLocationsStage({
        supabase,
        pipelineId: "p1-auto-phase1",
        userId: "u1",
        userTier: "pro",
        mode: "auto",
      })
    } finally {
      unsub()
    }

    // Entity flipped: pending → generating → awaiting_approval → approved.
    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-carrier_deck")
    expect(entityRow?.status).toBe("approved")

    // Orchestrator re-enqueued with reason=stage_advance.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-auto-phase1",
      userId: "u1",
      reason: "stage_advance",
    })

    // No `stage:status awaiting_approval` event was emitted (this would
    // have surfaced under manual mode).
    const awaitingStageEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "awaiting_approval",
    )
    expect(awaitingStageEvent).toBeUndefined()
  })

  it("auto-mode phase 2: bulk-approves at the variant-batch gate (clears variants_awaiting_approval flag)", async () => {
    // Seed: location already approved with main_asset_id. The stage runs
    // `ensureLocationVariants` (generates 2 variants), writes
    // `variants_awaiting_approval=true` on the entity, then hits the
    // variant-batch gate. Auto-mode must flip the entity to approved
    // (clearing the flag), flip the stage to approved, emit the SSE, and
    // re-enqueue.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "v1",
      assetId: "av1",
      assetUrl: "https://r2/v1.png",
      creditsSpent: 2,
    })
    const supabase = makeSupabase({
      entityState: "approved",
      pipelineId: "p1-auto-phase2",
    })
    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p1-auto-phase2", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )

    try {
      await runLocationsStage({
        supabase,
        pipelineId: "p1-auto-phase2",
        userId: "u1",
        userTier: "pro",
        mode: "auto",
      })
    } finally {
      unsub()
    }

    // Stage row flipped to `approved` (NOT `awaiting_approval`).
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "approved")).toBeDefined()
    expect(stageUpdates.find((u) => u.status === "awaiting_approval")).toBeUndefined()

    // SSE `stage:status approved` was emitted (and no `awaiting_approval`).
    const approvedEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "approved",
    )
    expect(approvedEvent).toBeDefined()
    const awaitingStageEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "awaiting_approval",
    )
    expect(awaitingStageEvent).toBeUndefined()

    // `variants_awaiting_approval` was cleared off the entity's metadata
    // (so a future re-entry doesn't re-fire the variant-batch gate).
    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-carrier_deck")
    expect(
      (entityRow?.metadata as Record<string, unknown> | undefined)
        ?.variants_awaiting_approval,
    ).toBeUndefined()

    // Orchestrator re-enqueued with reason=stage_advance.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-auto-phase2",
      userId: "u1",
      reason: "stage_advance",
    })
  })

  it("manual-mode: existing behavior unchanged — phase 2 pauses at variant-batch gate", async () => {
    // Regression net for manual mode: variant-batch gate must still flip
    // the stage row to `awaiting_approval` (NOT `approved`), and the
    // orchestrator MUST NOT be re-enqueued.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "v1",
      assetId: "av1",
      assetUrl: "https://r2/v1.png",
      creditsSpent: 2,
    })
    const supabase = makeSupabase({ entityState: "approved" })
    await runLocationsStage({
      supabase,
      pipelineId: "p1-manual",
      userId: "u1",
      userTier: "pro",
      mode: "manual",
    })

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "awaiting_approval")).toBeDefined()
    expect(stageUpdates.find((u) => u.status === "approved")).toBeUndefined()
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })
})
