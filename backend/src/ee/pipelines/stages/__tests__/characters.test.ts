import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../llms/voice-matcher.js", () => ({ runVoiceMatcher: vi.fn() }))
vi.mock("../../services/pipeline-generate-image.js", () => ({ pipelineGenerateImage: vi.fn() }))

import { runVoiceMatcher } from "../../llms/voice-matcher.js"
import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
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
        // Make the .eq().eq() chain thenable so the re-fetch call
        // `select("metadata").eq("pipeline_id", ...).eq("entity_type", ...)`
        // resolves to all rows (mirrors the Supabase JS query builder which
        // is PromiseLike).
        const makeEqEqThenable = () => {
          const inner = {
            eq: () => ({
              order: async () => ({
                data: Array.from(entities.values()),
                error: null,
              }),
              then: (
                resolve: (v: { data: unknown; error: null }) => unknown,
              ) =>
                resolve({
                  data: Array.from(entities.values()),
                  error: null,
                }),
            }),
            maybeSingle: async () => ({ data: null }),
            single: async () => ({ data: { url: "https://r2/main.png" }, error: null }),
          }
          return inner
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
            eq: () => makeEqEqThenable(),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, val: string) => {
              const row = entities.get(val)
              if (row) entities.set(val, { ...row, ...patch })
              return { data: null, error: null }
            },
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
})
