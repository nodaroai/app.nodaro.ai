import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../llms/voice-matcher.js", () => ({ runVoiceMatcher: vi.fn() }))
vi.mock("../../services/pipeline-generate-image.js", () => ({ pipelineGenerateImage: vi.fn() }))
vi.mock("../../llms/character-image-critic.js", () => ({
  runCharacterImageCritic: vi.fn(),
}))
vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))
vi.mock("../../credits.js", () => ({
  refundPipelineCredits: vi.fn(async () => undefined),
}))

import { runVoiceMatcher } from "../../llms/voice-matcher.js"
import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { runCharacterImageCritic } from "../../llms/character-image-critic.js"
import { enqueuePipelineRun } from "../../queue.js"
import { refundPipelineCredits } from "../../credits.js"
import { pipelineEvents } from "../../events.js"
import { runCharactersStage } from "../characters.js"

beforeEach(() => {
  vi.clearAllMocks()
  // Default critic mock: pass + score 9, no issues. Tests that want the
  // failure path override this explicitly.
  ;(runCharacterImageCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
    verdict: {
      verdict: "pass",
      prompt_adherence_score: 9,
      identified_subject: "a tall, weathered hero",
      issues: [],
    },
    llmCallId: "llm-default",
  })
})

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

function makeSupabase(opts: {
  seedEntities?: Array<Record<string, unknown>>
  pipelineRow?: Record<string, unknown>
  plan?: unknown
} = {}) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const seed of opts.seedEntities ?? []) {
    entities.set(seed.id as string, seed)
  }
  // Per-test plan override — used by the parallelism + error-isolation tests
  // that need multi-cast plans. Existing tests default to `fakePlan`.
  const activePlan = opts.plan ?? fakePlan
  const variants: Array<{ entity_id: string; variant_key: string; status: string; asset_id?: string }> = []
  const stageUpdates: Array<Record<string, unknown>> = []
  // Phase 1D.2c-a (D1): the auto-mode failure-aggregation guard reads
  // pipelines{reserved_credits,spent_credits,user_id} to compute the refund.
  // Default row covers tests that don't care; callers can override.
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
                maybeSingle: async () => ({ data: null, error: null }),
                single: async () => ({ data: { output: { plan: activePlan } }, error: null }),
              }),
            }),
          }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: "stage-2" }, error: null }) }) }),
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
    _pipelineUpdates: pipelineUpdates,
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

    // Phase 3 (granular-pipeline-control): pre-seed at `pending` to simulate
    // the user having already clicked Approve in Step A wizard. The default
    // post-ensureCharacterEntity status is `pending_description`, which would
    // pause the engine waiting for the wizard.
    const supabase = makeSupabase({
      seedEntities: [
        { id: "e-hero", entity_key: "hero", status: "pending", metadata: {} },
      ],
    })
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

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D.2c-a §5 (C1): character-image-critic integration
  // ──────────────────────────────────────────────────────────────────────────

  it("critic passes first try → entity ends at awaiting_approval, no critic_findings/last_error in metadata", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/main.png", creditsSpent: 2,
    })
    ;(runVoiceMatcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      voice_source: "premade", voice_id: "ABC", reasoning: "fits",
    })
    // Default critic mock (pass, score=9, no issues) is set in beforeEach.

    // Phase 3 — pre-seed at `pending` (user already approved Step A wizard).
    const supabase = makeSupabase({
      seedEntities: [
        { id: "e-hero", entity_key: "hero", status: "pending", metadata: {} },
      ],
    })
    await runCharactersStage({
      supabase, pipelineId: "p-crit-pass", userId: "u1", userTier: "pro",
    })

    // Single image gen, single critic call.
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(1)
    expect(runCharacterImageCritic).toHaveBeenCalledTimes(1)

    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect(entityRow?.status).toBe("awaiting_approval")
    const meta = entityRow?.metadata as Record<string, unknown>
    expect(meta.last_error).toBeUndefined()
    // No issues → no critic_findings key, no retry count key.
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
    ;(runVoiceMatcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      voice_source: "premade", voice_id: "ABC", reasoning: "fits",
    })
    ;(runCharacterImageCritic as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        verdict: {
          verdict: "fail",
          prompt_adherence_score: 4,
          identified_subject: "a different person",
          issues: [
            {
              severity: "blocking",
              category: "wrong_subject",
              description: "wrong gender",
              suggested_fix: "make subject male",
            },
          ],
        },
        llmCallId: "llm-1",
      })
      .mockResolvedValueOnce({
        verdict: {
          verdict: "pass",
          prompt_adherence_score: 9,
          identified_subject: "a tall, weathered hero",
          issues: [],
        },
        llmCallId: "llm-2",
      })

    // Phase 3 — pre-seed at `pending` (user already approved Step A wizard).
    const supabase = makeSupabase({
      seedEntities: [
        { id: "e-hero", entity_key: "hero", status: "pending", metadata: {} },
      ],
    })
    await runCharactersStage({
      supabase, pipelineId: "p-crit-retry-1", userId: "u1", userTier: "pro",
    })

    expect(pipelineGenerateImage).toHaveBeenCalledTimes(2)
    expect(runCharacterImageCritic).toHaveBeenCalledTimes(2)

    // Second pipelineGenerateImage call must include the prior critic's
    // suggested_fix in the feedback-augmented prompt.
    const secondCall = (pipelineGenerateImage as ReturnType<typeof vi.fn>).mock.calls[1]
    const secondArgs = secondCall?.[0] as { prompt: string }
    expect(secondArgs.prompt).toContain("a different person")
    expect(secondArgs.prompt).toContain("make subject male")

    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
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
      identified_subject: "still wrong",
      issues: [
        {
          severity: "blocking" as const,
          category: "wrong_subject" as const,
          description: "wrong gender again",
          suggested_fix: "make subject male",
        },
      ],
    }
    ;(runCharacterImageCritic as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdict: failVerdict,
      llmCallId: "llm-fail",
    })

    // Phase 3 — pre-seed at `pending` (user already approved Step A wizard).
    const supabase = makeSupabase({
      seedEntities: [
        { id: "e-hero", entity_key: "hero", status: "pending", metadata: {} },
      ],
    })
    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p-crit-cap", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )
    try {
      await runCharactersStage({
        supabase, pipelineId: "p-crit-cap", userId: "u1", userTier: "pro",
      })
    } finally {
      unsub()
    }

    // 1 initial + 2 retries = 3 image gens; 3 critic calls.
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(3)
    expect(runCharacterImageCritic).toHaveBeenCalledTimes(3)

    // Voice-matcher MUST NOT have been invoked on the failure path.
    expect(runVoiceMatcher).not.toHaveBeenCalled()

    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect(entityRow?.status).toBe("failed")
    const meta = entityRow?.metadata as Record<string, unknown>
    expect(meta.last_error).toBe("image_critic_unresolvable")
    expect(meta.image_critic_retry_count).toBe(2)
    expect(meta.last_attempted_image_url).toBe("https://r2/attempt-3.png")
    expect(Array.isArray(meta.critic_findings)).toBe(true)
    expect((meta.critic_findings as unknown[]).length).toBeGreaterThan(0)

    // Failed SSE event published.
    const failedEvent = sseEvents.find(
      (e) => e.type === "entity:status" && e.status === "failed",
    )
    expect(failedEvent).toBeDefined()
  })

  it("prompt_adherence_score < 5 with verdict='pass' is still treated as fail (defense in depth)", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        jobId: "j1", assetId: "a1", assetUrl: "https://r2/attempt-1.png", creditsSpent: 2,
      })
      .mockResolvedValueOnce({
        jobId: "j2", assetId: "a2", assetUrl: "https://r2/attempt-2.png", creditsSpent: 2,
      })
    ;(runVoiceMatcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      voice_source: "premade", voice_id: "ABC", reasoning: "fits",
    })
    ;(runCharacterImageCritic as ReturnType<typeof vi.fn>)
      // First: verdict='pass' but adherence_score=3 — must trigger retry.
      .mockResolvedValueOnce({
        verdict: {
          verdict: "pass",
          prompt_adherence_score: 3,
          identified_subject: "wrong-ish",
          issues: [],
        },
        llmCallId: "llm-1",
      })
      // Second: real pass.
      .mockResolvedValueOnce({
        verdict: {
          verdict: "pass",
          prompt_adherence_score: 9,
          identified_subject: "hero",
          issues: [],
        },
        llmCallId: "llm-2",
      })

    // Phase 3 — pre-seed at `pending` (user already approved Step A wizard).
    const supabase = makeSupabase({
      seedEntities: [
        { id: "e-hero", entity_key: "hero", status: "pending", metadata: {} },
      ],
    })
    await runCharactersStage({
      supabase, pipelineId: "p-crit-lowscore", userId: "u1", userTier: "pro",
    })

    // Despite verdict='pass', low score forced a retry → 2 image gens.
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(2)
    expect(runCharacterImageCritic).toHaveBeenCalledTimes(2)

    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect(entityRow?.status).toBe("awaiting_approval")
    const meta = entityRow?.metadata as Record<string, unknown>
    expect(meta.image_critic_retry_count).toBe(1)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D.2c-a §6 (D1): auto-mode aggregates image-critic failures →
  // pipeline failed + refund. Manual/guided modes do NOT aggregate; the
  // failed entity stays on the card and the pipeline keeps its prior status.
  // ──────────────────────────────────────────────────────────────────────────

  it("auto-mode: any entity with last_error='image_critic_unresolvable' → pipeline failed + refund + no bulk-approve", async () => {
    // Seed: one healthy entity at awaiting_approval AND one entity already
    // force-failed by the critic cap. After the loop, the auto-mode guard
    // must spot the failed-by-critic entity and fail the pipeline BEFORE
    // calling bulk-approve (so the healthy entity stays at awaiting_approval,
    // it does NOT get auto-approved into a dead pipeline).
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-unused", assetId: "a-unused", assetUrl: "https://r2/unused.png",
      creditsSpent: 0,
    })

    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-hero",
          entity_key: "hero",
          status: "awaiting_approval",
          main_asset_id: "main-asset-hero",
          metadata: {
            entity_type: "character",
            name: "Hero",
            visual_description: "tall, weathered",
          },
        },
        {
          id: "e-villain",
          entity_key: "villain",
          status: "failed",
          metadata: {
            entity_type: "character",
            name: "Villain",
            visual_description: "shadowed figure",
            last_error: "image_critic_unresolvable",
            last_error_at: "2026-05-20T12:00:00Z",
            image_critic_retry_count: 2,
            critic_findings: [{ severity: "blocking", category: "wrong_subject" }],
            last_attempted_image_url: "https://r2/villain-attempt-3.png",
          },
        },
      ],
      pipelineRow: {
        reserved_credits: 200,
        spent_credits: 50,
        user_id: "u-fail-test",
      },
    })

    const sseEvents: Array<Record<string, unknown>> = []
    const unsub = pipelineEvents.subscribe("p1-auto-critic-fail", (e) =>
      sseEvents.push(e as unknown as Record<string, unknown>),
    )
    try {
      await runCharactersStage({
        supabase, pipelineId: "p1-auto-critic-fail", userId: "u-fail-test",
        userTier: "pro", mode: "auto",
      })
    } finally {
      unsub()
    }

    // Pipeline row was flipped to failed with the typed reason.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    const failUpdate = pipelineUpdates.find((u) => u.status === "failed")
    expect(failUpdate).toBeDefined()
    expect(failUpdate?.failure_reason).toBe("characters_image_critic_unresolvable")

    // Refund called with reserved-spent=150 and the typed reason.
    expect(refundPipelineCredits).toHaveBeenCalledTimes(1)
    expect(refundPipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u-fail-test",
        pipelineId: "p1-auto-critic-fail",
        credits: 150,
        reason: "pipeline_failed:characters_image_critic_unresolvable",
      }),
    )

    // SSE events: pipeline:status failed + stage:status failed.
    const pipelineFailedEvent = sseEvents.find(
      (e) => e.type === "pipeline:status" && e.status === "failed",
    )
    expect(pipelineFailedEvent).toBeDefined()
    const stageFailedEvent = sseEvents.find(
      (e) => e.type === "stage:status" && e.status === "failed" && e.stageName === "characters",
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
      "characters_image_critic_unresolvable",
    )

    // Bulk-approve must NOT have run — the healthy hero entity stays at
    // awaiting_approval (it does not get auto-approved into a dead pipeline).
    const heroRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect(heroRow?.status).toBe("awaiting_approval")

    // Stage_advance enqueue must NOT have run (pipeline is dead).
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("auto-mode: no refund when reserved == spent (nothing left to refund)", async () => {
    // Defensive: refund is only called when reserved > spent. Otherwise the
    // pipeline still flips to failed but no credits move (avoids confusing
    // negative-refund or zero-amount usage_log entries).
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-unused", assetId: "a-unused", assetUrl: "https://r2/unused.png",
      creditsSpent: 0,
    })

    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-hero",
          entity_key: "hero",
          status: "failed",
          metadata: {
            entity_type: "character",
            name: "Hero",
            last_error: "image_critic_unresolvable",
          },
        },
      ],
      pipelineRow: {
        reserved_credits: 50,
        spent_credits: 50, // nothing to refund
        user_id: "u-zero",
      },
    })

    await runCharactersStage({
      supabase, pipelineId: "p1-zero-refund", userId: "u-zero",
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
    // Manual mode: even if an entity carries last_error='image_critic_unresolvable',
    // the stage handler does NOT fail the pipeline. The failed entity stays on
    // its card (user sees the critic findings + Regenerate button via E1).
    // This is a regression-net for the auto/manual gate behavior.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-unused", assetId: "a-unused", assetUrl: "https://r2/unused.png",
      creditsSpent: 0,
    })

    const supabase = makeSupabase({
      seedEntities: [
        {
          id: "e-hero",
          entity_key: "hero",
          status: "awaiting_approval",
          main_asset_id: "main-asset-hero",
          metadata: {
            entity_type: "character",
            name: "Hero",
          },
        },
        {
          id: "e-villain",
          entity_key: "villain",
          status: "failed",
          metadata: {
            entity_type: "character",
            name: "Villain",
            last_error: "image_critic_unresolvable",
          },
        },
      ],
    })

    await runCharactersStage({
      supabase, pipelineId: "p1-manual-with-failed", userId: "u1",
      userTier: "pro", mode: "manual",
    })

    // Pipeline row NOT flipped to failed.
    const pipelineUpdates = (supabase as never as {
      _pipelineUpdates: Array<Record<string, unknown>>
    })._pipelineUpdates
    expect(pipelineUpdates.find((u) => u.status === "failed")).toBeUndefined()
    // Refund NOT called.
    expect(refundPipelineCredits).not.toHaveBeenCalled()
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

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1D /simplify perf pass: settledWithLimit parallelism + error isolation
  //
  // Stage 2 used to process entities sequentially (`for (const entity of
  // entities) await ...`). The refactor wraps each entity's work in a task
  // and runs them at concurrency=3 via `settledWithLimit`, `failFast=false`.
  // Two tests below cover the two invariants:
  //   1. Parallelism — submission order ≠ completion order; all entities are
  //      processed regardless.
  //   2. Error isolation — one entity throwing does NOT cancel siblings;
  //      `metadata.last_error` is persisted by the inner handler before the
  //      throw, and the task-level catch swallows so the stage handler can
  //      continue.
  // ──────────────────────────────────────────────────────────────────────────

  // 3-cast plan shared by the parallelism + error-isolation tests.
  const multiCastPlan = {
    title: "x", logline: "x", target_duration_seconds: 60, format: "short_film",
    output_resolution: "1080p", language: "en", genre: "drama", tone: [],
    cast: [
      {
        key: "hero", name: "Hero", role: "protagonist",
        visual_description: "tall, weathered", voice_profile: "deep, weary",
        has_dialogue: false, angle_count_hint: 1, expression_set_hint: [],
      },
      {
        key: "sidekick", name: "Sidekick", role: "companion",
        visual_description: "wiry, alert", voice_profile: "quick, bright",
        has_dialogue: false, angle_count_hint: 1, expression_set_hint: [],
      },
      {
        key: "villain", name: "Villain", role: "antagonist",
        visual_description: "shadowed figure", voice_profile: "low, menacing",
        has_dialogue: false, angle_count_hint: 1, expression_set_hint: [],
      },
    ],
    locations: [], objects: [], scenes: [], beats: [],
    has_narrator: false, narrator_profile: null,
    music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
    global_style: { visual_style: "photoreal", color_palette: "warm", lighting: "golden", camera_language: "wide" },
    total_duration_seconds: 60, estimated_scene_count: 0, warnings: [],
  } as never

  it("parallelism: all entities are processed regardless of resolution order", async () => {
    // Resolve out-of-submission-order: sidekick (#2) first, then villain (#3),
    // then hero (#1) last. The settledWithLimit worker pool starts all three
    // concurrently (limit=3, 3 tasks); whichever resolves first records its
    // call. Because mocks return per-call promises, parallel kick-off is
    // observable via the recorded resolution sequence.
    const resolveOrder: string[] = []
    // Per-entity deferred resolvers. Keyed by `pipelineEntityId` so the mock
    // implementation closure can pluck the right one without needing branchy
    // narrowing TypeScript can't track across closures.
    const resolvers: Record<string, () => void> = {}
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { pipelineEntityId: string }) => {
        await new Promise<void>((resolve) => {
          resolvers[args.pipelineEntityId] = resolve
        })
        const key =
          args.pipelineEntityId === "e-hero" ? "hero" :
          args.pipelineEntityId === "e-sidekick" ? "sidekick" : "villain"
        resolveOrder.push(key)
        return {
          jobId: `j-${key}`, assetId: `a-${key}`,
          assetUrl: `https://r2/${key}.png`, creditsSpent: 2,
        }
      },
    )

    const supabase = makeSupabase({
      plan: multiCastPlan,
      seedEntities: [
        { id: "e-hero", entity_key: "hero", status: "pending", metadata: {} },
        { id: "e-sidekick", entity_key: "sidekick", status: "pending", metadata: {} },
        { id: "e-villain", entity_key: "villain", status: "pending", metadata: {} },
      ],
    })

    // Kick off the stage; it should suspend on all three image-gen promises.
    const stagePromise = runCharactersStage({
      supabase, pipelineId: "p-parallel", userId: "u1", userTier: "pro",
    })

    // Wait so all three tasks have entered and registered their resolvers.
    await new Promise((r) => setTimeout(r, 10))

    // All three image-gen calls have been issued in parallel (concurrency=3).
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(3)

    // Resolve OUT of submission order: sidekick → villain → hero.
    resolvers["e-sidekick"]?.()
    await new Promise((r) => setTimeout(r, 5))
    resolvers["e-villain"]?.()
    await new Promise((r) => setTimeout(r, 5))
    resolvers["e-hero"]?.()

    await stagePromise

    // Observed order matches forced resolution order — proving parallelism.
    expect(resolveOrder).toEqual(["sidekick", "villain", "hero"])

    // All three entities reached `awaiting_approval` despite the scrambled
    // resolution order — none were skipped.
    const ents = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities
    expect(ents.get("e-hero")?.status).toBe("awaiting_approval")
    expect(ents.get("e-sidekick")?.status).toBe("awaiting_approval")
    expect(ents.get("e-villain")?.status).toBe("awaiting_approval")
  })

  it("error isolation: one entity's throw does NOT cancel siblings", async () => {
    // Each entity independently throws at `pipelineGenerateImage` (e.g.
    // upstream KIE outage). The refactor's task-level try/catch swallows
    // the re-thrown error from `generateCharacterMain` — its own inner
    // catch has already persisted `metadata.last_error` + emitted the
    // `entity:status failed` SSE — so settledWithLimit sees three fulfilled
    // tasks and `runCharactersStage` resolves cleanly. Sibling tasks are
    // NOT cancelled by hero's failure; villain still gets its own typed
    // error persisted (proving the error didn't short-circuit siblings).
    //
    // Note on test design: each entity throws (rather than only one
    // throwing) keeps the assertion local — we can verify EACH entity has
    // its OWN distinct last_error, proving the catches are per-task. A
    // half-throw / half-pass design hits a vitest 4 concurrent-dynamic-
    // import race with `vi.mock` that masks the parallelism intent.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { pipelineEntityId: string }) => {
        const key =
          args.pipelineEntityId === "e-hero" ? "hero" :
          args.pipelineEntityId === "e-sidekick" ? "sidekick" : "villain"
        throw new Error(`provider outage for ${key}`)
      },
    )

    const supabase = makeSupabase({
      plan: multiCastPlan,
      seedEntities: [
        { id: "e-hero", entity_key: "hero", status: "pending", metadata: {} },
        { id: "e-sidekick", entity_key: "sidekick", status: "pending", metadata: {} },
        { id: "e-villain", entity_key: "villain", status: "pending", metadata: {} },
      ],
    })

    // Stage handler MUST NOT reject — even though every entity throws, the
    // per-task catch wraps each thrown error and settledWithLimit returns
    // all-fulfilled. (Without isolation, the first throw would bubble out
    // and abort the stage handler.)
    await expect(
      runCharactersStage({
        supabase, pipelineId: "p-isolate", userId: "u1", userTier: "pro",
      }),
    ).resolves.toBeUndefined()

    const ents = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities

    // EACH entity has its OWN distinct error captured — proving the
    // per-task isolation. If error isolation were broken, only the FIRST
    // entity to throw would have its metadata persisted (others would
    // either be cancelled by failFast or never run because the first
    // throw aborted the stage handler).
    for (const key of ["hero", "sidekick", "villain"] as const) {
      const row = ents.get(`e-${key}`)
      expect(row?.status).toBe("failed")
      expect((row?.metadata as Record<string, unknown>)?.last_error).toBe(
        `provider outage for ${key}`,
      )
    }
  })

  it("all entities fail: stage does NOT advance to approved (anyAwaiting tracks failures)", async () => {
    // Regression for Pass 2 /simplify bug: when ALL pending entities throw
    // (e.g. transient KIE 503 outage), the outer task-wrapper catch correctly
    // swallows each rejection so siblings keep running, but it MUST also set
    // `anyAwaiting=true`. Without this, anyAwaiting stays false → the
    // "if (anyAwaiting)" branch doesn't fire → control falls through to the
    // final "mark stage approved" write at step 6, marking the stage
    // `approved` with zero successful main assets. Downstream Shot List
    // would then run against missing main_asset_id refs.
    //
    // This test forces every entity to throw at image gen, then asserts:
    //   1. Every entity is persisted with status='failed' + last_error.
    //   2. NO `pipeline_stages.update({ status: "approved" })` was written.
    //   3. The stage update queue contains no terminal "approved" patch —
    //      the stage stays at `running` (set by ensureStageRow before the
    //      loop), so the engine driver will re-enter on the user's
    //      Regenerate.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { pipelineEntityId: string }) => {
        const key =
          args.pipelineEntityId === "e-hero" ? "hero" :
          args.pipelineEntityId === "e-sidekick" ? "sidekick" : "villain"
        throw new Error(`provider outage for ${key}`)
      },
    )

    const supabase = makeSupabase({
      plan: multiCastPlan,
      seedEntities: [
        { id: "e-hero", entity_key: "hero", status: "pending", metadata: {} },
        { id: "e-sidekick", entity_key: "sidekick", status: "pending", metadata: {} },
        { id: "e-villain", entity_key: "villain", status: "pending", metadata: {} },
      ],
    })

    // Stage handler MUST NOT reject — per-task catches swallow.
    await expect(
      runCharactersStage({
        supabase, pipelineId: "p-all-fail", userId: "u1", userTier: "pro",
      }),
    ).resolves.toBeUndefined()

    const refs = supabase as never as {
      _entities: Map<string, Record<string, unknown>>
      _stageUpdates: Array<Record<string, unknown>>
    }

    // (1) All three entities are failed.
    for (const key of ["hero", "sidekick", "villain"] as const) {
      const row = refs._entities.get(`e-${key}`)
      expect(row?.status).toBe("failed")
      expect((row?.metadata as Record<string, unknown>)?.last_error).toBe(
        `provider outage for ${key}`,
      )
    }

    // (2) The stage was NEVER patched to `approved` — the outer-catch fix
    // routes us through the `if (anyAwaiting)` early-return, skipping the
    // step-6 "mark approved" write entirely. Without the fix, this
    // assertion would fail with one stage update carrying status='approved'.
    const approvedPatch = refs._stageUpdates.find((p) => p.status === "approved")
    expect(approvedPatch).toBeUndefined()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 3 (granular-pipeline-control) — Character Wizard Step A
  //
  // New initial state: ensureCharacterEntity inserts at `pending_description`
  // so manual/guided pipelines pause for the user's Step A click. Auto-mode
  // bulk-flips to `pending` at stage start so the existing parallel-gen flow
  // takes over with no behavioral change.
  //
  // Terminal state `skipped` opts the entity out — no image, no critic, no
  // variant gen. The variant-batch-gate check filters out `skipped` entities
  // so the stage can still advance when EVERY non-skipped entity is approved.
  // ──────────────────────────────────────────────────────────────────────────

  it("manual mode: fresh pending_description entity → engine pauses, no image gen, no stage advance", async () => {
    // No seedEntities — production's ensureCharacterEntity creates the row at
    // `pending_description`. Manual mode (default) must NOT bulk-flip; it
    // pauses for the user's wizard click and skips image gen entirely.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-unused", assetId: "a-unused", assetUrl: "https://r2/unused.png",
      creditsSpent: 0,
    })

    const supabase = makeSupabase()
    await runCharactersStage({
      supabase, pipelineId: "p3-manual-fresh", userId: "u1", userTier: "pro",
    })

    // Engine paused at pending_description — no generation triggered.
    expect(pipelineGenerateImage).not.toHaveBeenCalled()
    expect(runVoiceMatcher).not.toHaveBeenCalled()
    expect(runCharacterImageCritic).not.toHaveBeenCalled()

    // Entity stays at `pending_description`.
    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect(entityRow?.status).toBe("pending_description")

    // Stage stays running (the pause sets anyAwaiting=true → early return
    // BEFORE the variant-batch or step-6 stage-approval writes).
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    expect(stageUpdates.find((u) => u.status === "approved")).toBeUndefined()
    expect(stageUpdates.find((u) => u.status === "awaiting_approval")).toBeUndefined()

    // No orchestrator re-enqueue.
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("auto mode: fresh pending_description entity → bulk-flip to pending → engine generates main image", async () => {
    // No seedEntities — ensureCharacterEntity creates the row at
    // `pending_description`. Auto-mode's bulk-flip (before the entity SELECT)
    // must convert it to `pending` so generateCharacterMain runs.
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/main.png", creditsSpent: 2,
    })
    ;(runVoiceMatcher as ReturnType<typeof vi.fn>).mockResolvedValue({
      voice_source: "premade", voice_id: "ABC", reasoning: "fits",
    })

    const supabase = makeSupabase()
    await runCharactersStage({
      supabase, pipelineId: "p3-auto-fresh", userId: "u1", userTier: "pro", mode: "auto",
    })

    // Bulk-flip happened (pending_description → pending) before SELECT, so the
    // task loop hit the `pending` branch and called generateCharacterMain.
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(1)
    expect(runCharacterImageCritic).toHaveBeenCalledTimes(1)

    // Auto-mode then bulk-approved the per-entity gate and re-enqueued.
    const entityRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect(entityRow?.status).toBe("approved")
    expect(enqueuePipelineRun).toHaveBeenCalledTimes(1)
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "p3-auto-fresh",
      userId: "u1",
      reason: "stage_advance",
    })
  })

  it("manual mode: skipped entity is filtered out of variant-batch gate → stage advances when all non-skipped are approved", async () => {
    // Plan has 2 cast members: hero (skipped) + sidekick (approved with
    // variants_awaiting_approval=true). The variant-batch gate must IGNORE
    // hero and treat the stage as ready for the awaiting_approval pause —
    // proving the `nonSkippedEntities` filter works.
    const twoCastPlan = {
      title: "x", logline: "x", target_duration_seconds: 60, format: "short_film",
      output_resolution: "1080p", language: "en", genre: "drama", tone: [],
      cast: [
        {
          key: "hero", name: "Hero", role: "protagonist",
          visual_description: "tall, weathered", voice_profile: "deep",
          has_dialogue: false, angle_count_hint: 2,
          expression_set_hint: ["neutral", "determined"],
        },
        {
          key: "sidekick", name: "Sidekick", role: "companion",
          visual_description: "wiry, alert", voice_profile: "quick",
          has_dialogue: false, angle_count_hint: 2,
          expression_set_hint: ["neutral", "determined"],
        },
      ],
      locations: [], objects: [], scenes: [], beats: [],
      has_narrator: false, narrator_profile: null,
      music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
      global_style: { visual_style: "photoreal", color_palette: "warm", lighting: "golden", camera_language: "wide" },
      total_duration_seconds: 60, estimated_scene_count: 0, warnings: [],
    } as never

    const supabase = makeSupabase({
      plan: twoCastPlan,
      seedEntities: [
        // Hero is skipped — does NOT block the stage.
        {
          id: "e-hero",
          entity_key: "hero",
          status: "skipped",
          metadata: { entity_type: "character", name: "Hero" },
        },
        // Sidekick is approved with variants already generated and ready for
        // batch approval.
        {
          id: "e-sidekick",
          entity_key: "sidekick",
          status: "approved",
          main_asset_id: "main-asset-sidekick",
          metadata: {
            entity_type: "character",
            name: "Sidekick",
            visual_description: "wiry, alert",
            angle_count: 2,
            variants_awaiting_approval: true,
          },
        },
      ],
    })

    await runCharactersStage({
      supabase, pipelineId: "p3-manual-skipped", userId: "u1", userTier: "pro",
    })

    // Skipped entity stays skipped (no image gen, no transition).
    const heroRow = (supabase as never as {
      _entities: Map<string, Record<string, unknown>>
    })._entities.get("e-hero")
    expect(heroRow?.status).toBe("skipped")

    // Stage transitioned to `awaiting_approval` for the variant batch — proving
    // the nonSkippedEntities filter let sidekick's variants_awaiting_approval
    // flag drive the gate.
    const stageUpdates = (supabase as never as {
      _stageUpdates: Array<Record<string, unknown>>
    })._stageUpdates
    const awaitingUpdate = stageUpdates.find((u) => u.status === "awaiting_approval")
    expect(awaitingUpdate).toBeDefined()
    expect((awaitingUpdate?.output as Record<string, unknown>)?.phase).toBe(
      "variant_batch_approval",
    )
  })
})
