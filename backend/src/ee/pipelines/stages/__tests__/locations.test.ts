import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../services/pipeline-generate-image.js", () => ({ pipelineGenerateImage: vi.fn() }))

import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
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

function makeSupabase(entityState: "pending" | "approved") {
  const entities = new Map<string, Record<string, unknown>>([
    [
      "e-carrier_deck",
      {
        id: "e-carrier_deck",
        entity_key: "carrier_deck",
        status: entityState,
        metadata: {},
        main_asset_id: entityState === "approved" ? "main-asset" : null,
      },
    ],
  ])
  const variants: Array<Record<string, unknown>> = []
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
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
      }
      if (table === "pipeline_entities") {
        // The .eq().eq() chain must be thenable so the post-loop re-fetch
        // `select("metadata").eq(...).eq(...)` resolves to all rows (mirrors
        // the Supabase JS query builder which is PromiseLike).
        const makeEqEqChain = () => {
          return {
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
          }
        }
        return {
          upsert: () => Promise.resolve({ data: null, error: null }),
          select: () => ({
            eq: () => makeEqEqChain(),
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
            variants.push(row)
            return Promise.resolve({ data: null, error: null })
          },
          select: () => ({ eq: async () => ({ data: variants, error: null }) }),
          update: () => ({ eq: () => ({ eq: async () => ({ data: null, error: null }) }) }),
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
    const supabase = makeSupabase("pending")
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
    const supabase = makeSupabase("approved")
    await runLocationsStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })
    // 2 variants × 1 call each
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(2)
    const variants = (supabase as never as { _variants: Array<Record<string, unknown>> })
      ._variants
    expect(variants).toHaveLength(2)
    expect(variants[0]?.variant_kind).toBe("time_of_day") // "sunrise"
    expect(variants[1]?.variant_kind).toBe("time_of_day") // "night"
  })
})
