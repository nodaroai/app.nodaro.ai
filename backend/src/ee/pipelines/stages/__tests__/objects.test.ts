import { describe, it, expect, vi, beforeEach } from "vitest"
vi.mock("../../services/pipeline-generate-image.js", () => ({ pipelineGenerateImage: vi.fn() }))
import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
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

function makeSupabase() {
  const entities = new Map<string, Record<string, unknown>>()
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
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
      }
      if (table === "pipeline_entities") {
        return {
          upsert: (row: Record<string, unknown>) => {
            const id = `e-${row.entity_key}`
            if (!entities.has(id)) entities.set(id, { id, ...row })
            return Promise.resolve({ data: null, error: null })
          },
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({ data: Array.from(entities.values()), error: null }),
              }),
            }),
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
      throw new Error(`Unmocked table: ${table}`)
    },
    _entities: entities,
  } as never
}

describe("runObjectsStage", () => {
  it("generates one image per object", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1", assetId: "a1", assetUrl: "https://r2/helmet.png", creditsSpent: 2,
    })
    const supabase = makeSupabase()
    await runObjectsStage({ supabase, pipelineId: "p1", userId: "u1", userTier: "pro" })
    expect(pipelineGenerateImage).toHaveBeenCalledTimes(1)
    const row = (supabase as never as { _entities: Map<string, Record<string, unknown>> })._entities.get("e-helmet")
    expect(row?.status).toBe("awaiting_approval")
  })
})
