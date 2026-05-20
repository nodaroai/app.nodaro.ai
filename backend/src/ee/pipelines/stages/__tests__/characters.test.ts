import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../llms/voice-matcher.js", () => ({ runVoiceMatcher: vi.fn() }))
vi.mock("../../services/pipeline-generate-image.js", () => ({ pipelineGenerateImage: vi.fn() }))
vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

import { runVoiceMatcher } from "../../llms/voice-matcher.js"
import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { enqueuePipelineRun } from "../../queue.js"
import { pipelineEvents } from "../../events.js"
import { runCharactersStage } from "../characters.js"

beforeEach(() => vi.clearAllMocks())

const fakePlan = {
  title: "x", logline: "x", target_duration_seconds: 60, format: "short_film",
  output_resolution: "1080p", language: "en", genre: "drama", tone: [],
  cast: [
    { key: "hero", name: "Hero", role: "protagonist", visual_description: "tall, weathered",
      voice_profile: "deep, weary", has_dialogue: true, angle_count_hint: 2,
      expression_set_hint: ["neutral", "determined"] },
  ],
  locations: [], objects: [], scenes: [], beats: [],
  has_narrator: false, narrator_profile: null,
  music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
  global_style: { visual_style: "photoreal", color_palette: "warm", lighting: "golden", camera_language: "wide" },
  total_duration_seconds: 60, estimated_scene_count: 0, warnings: [],
} as never

function makeSupabase(opts: { seedEntities?: Array<Record<string, unknown>> } = {}) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const seed of opts.seedEntities ?? []) {
    entities.set(seed.id as string, seed)
  }
  const variants: Array<{ entity_id: string; variant_key: string; status: string; asset_id?: string }> = []
  const stageUpdates: Array<Record<string, unknown>> = []
  return {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
                single: async () => ({ data: { output: { plan: fakePlan } }, error: null }),
              }),
            }),
          }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "stage-2" }, error: null }) }) }),
          update: (patch: Record<string, unknown>) => {
            stageUpdates.push(patch)
            return { eq: async () => ({ data: null, error: null }) }
          },
        }
      }
      if (table === "pipeline_entities") {
        // Make every level of the chain thenable. Callers we need to satisfy:
        //   .select(...).eq().eq().order()            (2-level + .order)
        //   await .select(...).eq().eq()              (2-level await — re-fetch
        //                                               of metadata)
        //   await .select("id").eq().eq().eq(...)     (3-level await — used by
        //                                               `markStageEntityNodesState`
        //                                               for the `is_forked=false`
        //                                               filter)
        // Plus the multi-eq UPDATE path used by the auto-mode bulk-approve:
        //   .update(...).eq().eq().eq()                — three chained .eq()s.
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
          // Track filters across chained .eq() calls so the auto-mode bulk
          // UPDATE that matches `status=awaiting_approval` only touches the
          // intended rows. The chain may be terminated at any depth by an
          // awaited Promise (PostgREST returns a result without a `.eq()`).
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
            if (!entities.has(id)) {
              entities.set(id, { id, status: "pending", ...row })
            }
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
        // The in-memory fixture doesn't need to track per-row state — the
        // assertion in the test is on `enqueuePipelineRun` + the stage
        // updates + the publish call — but we MUST resolve the chain so the
        // call doesn't throw.
        return {
          update: () => ({
            in: async () => ({ data: null, error: null }),
          }),
        }
      }
      if (table === "pipeline_entity_variants") {
        return {
          insert: (row: Record<string, unknown>) => {
            variants.push(row as never)
            return Promise.resolve({ data: null, error: null })
          },
          select: () => ({ eq: async () => ({ data: variants, error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
        }
      }
      if (table === "assets") {
        return {
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
          // assetUrlForId() reads `r2_url` (the actual column) via select+eq+single.
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { r2_url: "https://r2/main.png" },
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
    _entities: entities,
    _variants: variants,
    _stageUpdates: stageUpdates,
  } as never
}

describe("runCharactersStage", () => {
  it("generates main image + voice match for has_dialogue cast member", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/main.png", creditsSpent: 2,
    })
    ;(runVoiceMatcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      voice_source: "premade", voice_id: "ABC", reasoning: "fits",
    })

    const supabase = makeSupabase()
    await runCharactersStage({
      supabase, pipelineId: "p1", userId: "u1", userTier: "pro",
    })

    expect(pipelineGenerateImage).toHaveBeenCalledTimes(1)
    expect(runVoiceMatcher).toHaveBeenCalledTimes(1)
    // Entity transitioned to awaiting_approval.
    const entityRow = (supabase as never as { _entities: Map<string, Record<string, unknown>> })._entities.get("e-hero")
    expect(entityRow?.status).toBe("awaiting_approval")
  })

  it("transitions stage to awaiting_approval for variant batch once all entities are approved", async () => {
    // Setup: the hero entity is already approved + has main_asset_id, so the loop
    // skips main-image generation and calls ensureCharacterVariants instead. After
    // variants are generated, the post-loop re-fetch must read the freshly-written
    // metadata.variants_awaiting_approval flag and transition the stage to
    // 'awaiting_approval' for the batch variant gate.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "jv", assetId: "av", assetUrl: "https://r2/variant.png", creditsSpent: 2,
    })

    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-hero",
          entity_key: "hero",
          status: "approved",
          main_asset_id: "main-asset-hero",
          metadata: {
            entity_type: "character",
            name: "Hero",
            visual_description: "tall, weathered",
            angle_count: 2,
          },
        },
      ],
    })
    await runCharactersStage({
      supabase, pipelineId: "p1", userId: "u1", userTier: "pro",
    })

    // Variants should have been generated (1 angle + 2 expressions for the seeded plan).
    const variants = (supabase as never as { _variants: Array<Record<string, unknown>> })._variants
    expect(variants.length).toBeGreaterThan(0)

    // metadata.variants_awaiting_approval is now set on the entity.
    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect((entityRow?.metadata as Record<string, unknown>)?.variants_awaiting_approval).toBe(true)

    // Stage update with status='awaiting_approval' must have fired — this is the
    // re-fetch path: stale `entities` snapshot would have fallen through to
    // status='approved' instead.
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    const awaitingUpdate = stageUpdates.find((u) => u.status === "awaiting_approval")
    expect(awaitingUpdate).toBeDefined()
    expect((awaitingUpdate?.output as Record<string, unknown>)?.phase).toBe(
      "variant_batch_approval",
    )

    // And it must NOT have transitioned to approved (the stale-snapshot bug).
    const approvedUpdate = stageUpdates.find((u) => u.status === "approved")
    expect(approvedUpdate).toBeUndefined()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D.2a §4.1 (G1): auto-mode bulk-approve
  // ──────────────────────────────────────────────────────────────────────────

  it("auto-mode: bulk-approves at the per-entity gate and re-enqueues the orchestrator", async () => {
    // After main-image generation, the entity sits at `awaiting_approval`.
    // Auto-mode must short-circuit the pause: flip the entity to `approved`,
    // batch-flip the canvas node, emit no `awaiting_approval` event, and
    // re-enqueue the orchestrator with reason='stage_advance'.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/main.png", creditsSpent: 2,
    })
    ;(runVoiceMatcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      voice_source: "premade", voice_id: "ABC", reasoning: "fits",
    })

    const supabase = makeSupabase()
    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p1-auto-1", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )

    try {
      await runCharactersStage({
        supabase, pipelineId: "p1-auto-1", userId: "u1", userTier: "pro", mode: "auto",
      })
    } finally {
      unsub()
    }

    // Entity got flipped to approved by the auto-mode bulk-approve UPDATE.
    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect(entityRow?.status).toBe("approved")

    // Orchestrator was re-enqueued with the stage_advance reason.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-auto-1",
      userId: "u1",
      reason: "stage_advance",
    })

    // No `stage:status awaiting_approval` event was emitted for the
    // per-entity gate (manual mode would have emitted one). The variant
    // gate is reached on a subsequent re-entry — not in this pass.
    const awaitingStageEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "awaiting_approval",
    )
    expect(awaitingStageEvent).toBeUndefined()
  })

  it("auto-mode: bulk-approves at the variant-batch gate and emits stage:status approved", async () => {
    // Seed: hero is already approved with main_asset_id, so the loop runs
    // `ensureCharacterVariants` and writes `variants_awaiting_approval=true`.
    // Auto-mode must then bulk-approve the entity + canvas node, flip the
    // stage row to `approved`, emit `stage:status approved`, and re-enqueue.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "jv", assetId: "av", assetUrl: "https://r2/variant.png", creditsSpent: 2,
    })

    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-hero",
          entity_key: "hero",
          status: "approved",
          main_asset_id: "main-asset-hero",
          metadata: {
            entity_type: "character",
            name: "Hero",
            visual_description: "tall, weathered",
            angle_count: 2,
          },
        },
      ],
    })
    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p1-auto-2", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )

    try {
      await runCharactersStage({
        supabase, pipelineId: "p1-auto-2", userId: "u1", userTier: "pro", mode: "auto",
      })
    } finally {
      unsub()
    }

    // Stage row flipped to `approved` (auto-mode), NOT `awaiting_approval`.
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "approved")).toBeDefined()
    expect(stageUpdates.find((u) => u.status === "awaiting_approval")).toBeUndefined()

    // SSE `stage:status approved` was emitted.
    const approvedEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "approved",
    )
    expect(approvedEvent).toBeDefined()

    // Orchestrator re-enqueued with reason=stage_advance.
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p1-auto-2",
      userId: "u1",
      reason: "stage_advance",
    })
  })

  it("manual-mode: existing behavior unchanged — pauses at variant-batch gate", async () => {
    // Regression net: re-runs the existing variant-batch awaiting flow but
    // with `mode: "manual"` explicitly threaded — the stage MUST land at
    // `awaiting_approval` (NOT `approved`) and the orchestrator MUST NOT be
    // re-enqueued.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "jv", assetId: "av", assetUrl: "https://r2/variant.png", creditsSpent: 2,
    })

    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-hero",
          entity_key: "hero",
          status: "approved",
          main_asset_id: "main-asset-hero",
          metadata: {
            entity_type: "character",
            name: "Hero",
            visual_description: "tall, weathered",
            angle_count: 2,
          },
        },
      ],
    })

    await runCharactersStage({
      supabase, pipelineId: "p1-manual", userId: "u1", userTier: "pro", mode: "manual",
    })

    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "awaiting_approval")).toBeDefined()
    expect(stageUpdates.find((u) => u.status === "approved")).toBeUndefined()
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })
})
