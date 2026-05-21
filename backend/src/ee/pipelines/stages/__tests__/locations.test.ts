import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../services/pipeline-generate-image.js", () => ({ pipelineGenerateImage: vi.fn() }))
vi.mock("../../llms/location-image-critic.js", () => ({
  runLocationImageCritic: vi.fn(),
}))
vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))
vi.mock("../../credits.js", () => ({
  refundPipelineCredits: vi.fn(async () => undefined),
}))

import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { runLocationImageCritic } from "../../llms/location-image-critic.js"
import { enqueuePipelineRun } from "../../queue.js"
import { refundPipelineCredits } from "../../credits.js"
import { pipelineEvents } from "../../events.js"
import { runLocationsStage } from "../locations.js"

beforeEach(() => {
  vi.clearAllMocks()
  // Default critic mock: pass + score 9, no issues. Tests that want the
  // failure path override this explicitly.
  ;(runLocationImageCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
    verdict: {
      verdict: "pass",
      prompt_adherence_score: 9,
      identified_subject: "an aircraft carrier flight deck",
      issues: [],
    },
    llmCallId: "llm-default",
  })
})

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
  pipelineRow?: Record<string, unknown>
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
  // Phase 1D.2c-a (D1): auto-mode failure-aggregation reads pipelines{...}
  const pipelineRow: Record<string, unknown> = {
    reserved_credits: 100,
    spent_credits: 25,
    user_id: "u1",
    ...(opts.pipelineRow ?? {}),
  }
  const pipelineUpdates: Array<Record<string, unknown>> = []
  return {
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: pipelineRow, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            pipelineUpdates.push(patch)
            return { eq: async () => ({ data: null, error: null }) }
          },
        }
      }
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
            // The chain may be terminated at any depth by an awaited Promise.
            // Phase 1D.2c-a (D1) `failPipelineWithCriticReason`
            // chains `.eq(pipeline_id, ...).eq(stage_name, ...)` — return a
            // thenable node at every depth so both 1- and 2-level chains work.
            const node: {
              eq: () => unknown
              then: (resolve: (v: unknown) => unknown) => unknown
            } = {
              eq: () => node,
              then: (resolve) => resolve({ data: null, error: null }),
            }
            return node
          },
        }
      }
      if (table === "pipeline_entities") {
        // N-level .eq() chain (thenable at every depth):
        //   await .select().eq().eq()             — 2-level (entity refresh)
        //   await .select("id").eq().eq().eq()    — 3-level (markStageEntityNodesState)
        //   .select().eq().eq().order()           — terminal .order()
        //   .select("stage_id").eq("id", ...).single()  — single-row read for
        //                                                  the critic-loop stage_id
        //                                                  lookup (C2)
        const makeEqChain = (): {
          eq: () => unknown
          order: () => Promise<{ data: unknown; error: null }>
          single: () => Promise<{ data: unknown; error: null }>
          then: (
            resolve: (v: { data: unknown; error: null }) => unknown,
          ) => unknown
        } => {
          const data = Array.from(entities.values())
          const node: {
            eq: () => unknown
            order: () => Promise<{ data: unknown; error: null }>
            single: () => Promise<{ data: unknown; error: null }>
            then: (
              resolve: (v: { data: unknown; error: null }) => unknown,
            ) => unknown
          } = {
            eq: () => makeEqChain(),
            order: async () => ({ data, error: null }),
            // Return the first row + a synthetic stage_id so the critic loop
            // has a non-empty stage to log the LLM call against.
            single: async () => ({
              data: { ...(data[0] as Record<string, unknown>), stage_id: "stage-4" },
              error: null,
            }),
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
    _pipelineUpdates: pipelineUpdates,
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

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D.2c-a §5 (C2): location-image-critic integration
  // ──────────────────────────────────────────────────────────────────────────

  it("critic passes first try → entity ends at awaiting_approval, no critic_findings/last_error in metadata", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/main.png", creditsSpent: 2,
    })
    // Default critic mock (pass, score=9, no issues) is set in beforeEach.

    const supabase = makeSupabase({ entityState: "pending" })
    await runLocationsStage({
      supabase, pipelineId: "p-crit-pass", userId: "u1", userTier: "pro",
    })

    expect(pipelineGenerateImage).toHaveBeenCalledTimes(1)
    expect(runLocationImageCritic).toHaveBeenCalledTimes(1)

    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-carrier_deck")
    expect(entityRow?.status).toBe("awaiting_approval")
    const meta = (entityRow?.metadata as Record<string, unknown>) ?? {}
    expect(meta.last_error).toBeUndefined()
    expect(meta.critic_findings).toBeUndefined()
    expect(meta.image_critic_retry_count).toBeUndefined()
  })

  it("critic fails once then passes → 2 image gens, retry_count=1 in metadata", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        jobId: "j1", assetId: "a1", assetUrl: "https://r2/attempt-1.png", creditsSpent: 2,
      })
      .mockResolvedValueOnce({
        jobId: "j2", assetId: "a2", assetUrl: "https://r2/attempt-2.png", creditsSpent: 2,
      })
    ;(runLocationImageCritic as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        verdict: {
          verdict: "fail",
          prompt_adherence_score: 4,
          identified_subject: "a city street at noon",
          issues: [
            {
              severity: "blocking",
              category: "wrong_time_of_day",
              description: "noon instead of dusk",
              suggested_fix: "set time of day to dusk",
            },
          ],
        },
        llmCallId: "llm-1",
      })
      .mockResolvedValueOnce({
        verdict: {
          verdict: "pass",
          prompt_adherence_score: 9,
          identified_subject: "aircraft carrier at dusk",
          issues: [],
        },
        llmCallId: "llm-2",
      })

    const supabase = makeSupabase({ entityState: "pending" })
    await runLocationsStage({
      supabase, pipelineId: "p-crit-retry-1", userId: "u1", userTier: "pro",
    })

    expect(pipelineGenerateImage).toHaveBeenCalledTimes(2)
    expect(runLocationImageCritic).toHaveBeenCalledTimes(2)

    // Second pipelineGenerateImage call must include the prior critic's
    // suggested_fix in the feedback-augmented prompt.
    const secondCall = (pipelineGenerateImage as ReturnType<typeof vi.fn>).mock.calls[1]
    const secondArgs = secondCall?.[0] as { prompt: string }
    expect(secondArgs.prompt).toContain("a city street at noon")
    expect(secondArgs.prompt).toContain("set time of day to dusk")

    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-carrier_deck")
    expect(entityRow?.status).toBe("awaiting_approval")
    const meta = entityRow?.metadata as Record<string, unknown>
    expect(meta.image_critic_retry_count).toBe(1)
    expect(meta.last_error).toBeUndefined()
  })

  it("critic fails 3 times → entity.status='failed' with critic_findings + last_error='image_critic_unresolvable'", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        jobId: "j1", assetId: "a1", assetUrl: "https://r2/attempt-1.png", creditsSpent: 2,
      })
      .mockResolvedValueOnce({
        jobId: "j2", assetId: "a2", assetUrl: "https://r2/attempt-2.png", creditsSpent: 2,
      })
      .mockResolvedValueOnce({
        jobId: "j3", assetId: "a3", assetUrl: "https://r2/attempt-3.png", creditsSpent: 2,
      })
    const failVerdict = {
      verdict: "fail" as const,
      prompt_adherence_score: 3,
      identified_subject: "wrong location",
      issues: [
        {
          severity: "blocking" as const,
          category: "wrong_location_type" as const,
          description: "interior instead of exterior",
          suggested_fix: "make it an outdoor exterior shot",
        },
      ],
    }
    ;(runLocationImageCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: failVerdict,
      llmCallId: "llm-fail",
    })

    const supabase = makeSupabase({
      entityState: "pending",
      pipelineId: "p-crit-cap",
    })
    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p-crit-cap", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )
    try {
      await runLocationsStage({
        supabase, pipelineId: "p-crit-cap", userId: "u1", userTier: "pro",
      })
    } finally {
      unsub()
    }

    expect(pipelineGenerateImage).toHaveBeenCalledTimes(3)
    expect(runLocationImageCritic).toHaveBeenCalledTimes(3)

    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-carrier_deck")
    expect(entityRow?.status).toBe("failed")
    const meta = entityRow?.metadata as Record<string, unknown>
    expect(meta.last_error).toBe("image_critic_unresolvable")
    expect(meta.image_critic_retry_count).toBe(2)
    expect(meta.last_attempted_image_url).toBe("https://r2/attempt-3.png")
    expect(Array.isArray(meta.critic_findings)).toBe(true)
    expect((meta.critic_findings as unknown[]).length).toBeGreaterThan(0)

    const failedEvent = sseEvents.find(
      (e) => e.type === "entity:status" && e.status === "failed",
    )
    expect(failedEvent).toBeDefined()
    // Must be tagged as location (not character).
    expect(failedEvent?.entityType).toBe("location")
  })

  it("prompt_adherence_score < 5 with verdict='pass' is still treated as fail (defense in depth)", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        jobId: "j1", assetId: "a1", assetUrl: "https://r2/attempt-1.png", creditsSpent: 2,
      })
      .mockResolvedValueOnce({
        jobId: "j2", assetId: "a2", assetUrl: "https://r2/attempt-2.png", creditsSpent: 2,
      })
    ;(runLocationImageCritic as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        verdict: {
          verdict: "pass",
          prompt_adherence_score: 3,
          identified_subject: "wrong-ish",
          issues: [],
        },
        llmCallId: "llm-1",
      })
      .mockResolvedValueOnce({
        verdict: {
          verdict: "pass",
          prompt_adherence_score: 9,
          identified_subject: "carrier deck",
          issues: [],
        },
        llmCallId: "llm-2",
      })

    const supabase = makeSupabase({ entityState: "pending" })
    await runLocationsStage({
      supabase, pipelineId: "p-crit-lowscore", userId: "u1", userTier: "pro",
    })

    expect(pipelineGenerateImage).toHaveBeenCalledTimes(2)
    expect(runLocationImageCritic).toHaveBeenCalledTimes(2)

    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-carrier_deck")
    expect(entityRow?.status).toBe("awaiting_approval")
    const meta = entityRow?.metadata as Record<string, unknown>
    expect(meta.image_critic_retry_count).toBe(1)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D.2c-a §6 (D1): auto-mode aggregates image-critic failures →
  // pipeline failed + refund. Mirrors characters.test.ts's D1 block.
  // ──────────────────────────────────────────────────────────────────────────

  it("auto-mode: any entity with last_error='image_critic_unresolvable' → pipeline failed + refund + no bulk-approve", async () => {
    // Two location entities: one healthy at awaiting_approval, one already
    // force-failed by the critic cap. Auto-mode must fail the pipeline BEFORE
    // bulk-approve runs (so the healthy entity stays at awaiting_approval).
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-unused", assetId: "a-unused", assetUrl: "https://r2/unused.png",
      creditsSpent: 0,
    })
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-carrier_deck",
          entity_key: "carrier_deck",
          status: "awaiting_approval",
          main_asset_id: "main-asset",
          metadata: { entity_type: "location", name: "Carrier Deck" },
        },
        {
          id: "e-bunker",
          entity_key: "bunker",
          status: "failed",
          metadata: {
            entity_type: "location",
            name: "Bunker",
            last_error: "image_critic_unresolvable",
            last_error_at: "2026-05-20T12:00:00Z",
            image_critic_retry_count: 2,
            critic_findings: [{ severity: "blocking", category: "wrong_location_type" }],
            last_attempted_image_url: "https://r2/bunker-attempt-3.png",
          },
        },
      ],
      pipelineId: "p1-auto-loc-fail",
      pipelineRow: {
        reserved_credits: 200,
        spent_credits: 50,
        user_id: "u-fail-loc",
      },
    })

    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p1-auto-loc-fail", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )
    try {
      await runLocationsStage({
        supabase, pipelineId: "p1-auto-loc-fail", userId: "u-fail-loc",
        userTier: "pro", mode: "auto",
      })
    } finally {
      unsub()
    }

    // Pipeline flipped to failed with the typed reason.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    const failUpdate = pipelineUpdates.find((u) => u.status === "failed")
    expect(failUpdate).toBeDefined()
    expect(failUpdate?.failure_reason).toBe("locations_image_critic_unresolvable")

    // Refund called with reserved-spent=150 and the typed reason.
    expect(refundPipelineCredits).toHaveBeenCalledTimes(1)
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-fail-loc",
        pipelineId: "p1-auto-loc-fail",
        credits: 150,
        reason: "pipeline_failed:locations_image_critic_unresolvable",
      }),
    )

    // SSE events emitted.
    const pipelineFailedEvent = sseEvents.find(
      (e) => e.type === "pipeline:status" && e.status === "failed",
    )
    expect(pipelineFailedEvent).toBeDefined()
    const stageFailedEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "failed" && e.stageName === "locations",
    )
    expect(stageFailedEvent).toBeDefined()

    // pipeline_stages row was flipped to failed (Fix 1: prevents the row from
    // staying at `running` while the pipeline is `failed`).
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    const stageFailUpdate = stageUpdates.find((u) => u.status === "failed")
    expect(stageFailUpdate).toBeDefined()
    expect((stageFailUpdate?.output as { failure_reason?: string })?.failure_reason).toBe(
      "locations_image_critic_unresolvable",
    )

    // Healthy carrier_deck NOT auto-approved (pipeline is dead).
    const healthyRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-carrier_deck")
    expect(healthyRow?.status).toBe("awaiting_approval")

    // Stage-advance enqueue must NOT have run.
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("auto-mode: no refund when reserved == spent (nothing left to refund)", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-unused", assetId: "a-unused", assetUrl: "https://r2/unused.png",
      creditsSpent: 0,
    })
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-carrier_deck",
          entity_key: "carrier_deck",
          status: "failed",
          metadata: {
            entity_type: "location",
            name: "Carrier Deck",
            last_error: "image_critic_unresolvable",
          },
        },
      ],
      pipelineId: "p1-loc-zero",
      pipelineRow: {
        reserved_credits: 50,
        spent_credits: 50, // nothing to refund
        user_id: "u-zero-loc",
      },
    })

    await runLocationsStage({
      supabase, pipelineId: "p1-loc-zero", userId: "u-zero-loc",
      userTier: "pro", mode: "auto",
    })

    // Pipeline still flipped to failed.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.find((u) => u.status === "failed")).toBeDefined()
    // But refund NOT called.
    expect(refundPipelineCredits).not.toHaveBeenCalled()
  })

  it("manual-mode: failed-by-critic entity does NOT aggregate — pipeline stays alive", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-unused", assetId: "a-unused", assetUrl: "https://r2/unused.png",
      creditsSpent: 0,
    })
    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-carrier_deck",
          entity_key: "carrier_deck",
          status: "awaiting_approval",
          main_asset_id: "main-asset",
          metadata: { entity_type: "location", name: "Carrier Deck" },
        },
        {
          id: "e-bunker",
          entity_key: "bunker",
          status: "failed",
          metadata: {
            entity_type: "location",
            name: "Bunker",
            last_error: "image_critic_unresolvable",
          },
        },
      ],
      pipelineId: "p1-loc-manual-with-failed",
    })

    await runLocationsStage({
      supabase, pipelineId: "p1-loc-manual-with-failed", userId: "u1",
      userTier: "pro", mode: "manual",
    })

    // Pipeline NOT flipped to failed.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.find((u) => u.status === "failed")).toBeUndefined()
    expect(refundPipelineCredits).not.toHaveBeenCalled()
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
