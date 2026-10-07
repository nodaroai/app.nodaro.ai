/**
 * Stage 6 feeds the primary character's approved VARIANT images to the
 * keyframe generation as identity references. A variant's `asset_id` names an
 * `assets` row by id and is read with the service role, so it must resolve
 * only to an asset of the pipeline's owner (decided 2026-10-07; migration
 * 480): a pointer at another user's asset, written before 480, must not put
 * that user's private image into this user's generation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../../../lib/settled-with-limit.js", () => ({
  settledWithLimit: vi.fn(async (tasks: Array<() => Promise<unknown>>) =>
    Promise.all(tasks.map(async (t) => ({ status: "fulfilled", value: await t() }))),
  ),
}))
vi.mock("../../services/pipeline-generate-image.js", () => ({
  pipelineGenerateImage: vi.fn(),
}))
vi.mock("../../continuity.js", () => ({
  allocateReferenceSlots: vi.fn(),
}))
vi.mock("../../depends-on.js", () => ({
  transitionStageEntityNodesAndEmit: vi.fn(),
}))
vi.mock("../../stage-utils.js", async () => {
  const actual = await vi.importActual<typeof import("../../stage-utils.js")>(
    "../../stage-utils.js",
  )
  return {
    ...actual,
    ensureStageRow: vi.fn().mockResolvedValue("stage-6"),
    failStage: vi.fn(),
  }
})
vi.mock("../../match-cut-orchestrator.js", () => ({
  runMatchCutOrchestrator: vi.fn(),
}))
vi.mock("../../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

import { pipelineGenerateImage } from "../../services/pipeline-generate-image.js"
import { allocateReferenceSlots } from "../../continuity.js"
import { runMatchCutOrchestrator } from "../../match-cut-orchestrator.js"
import { runSceneImagesStage } from "../scene-images.js"

beforeEach(() => vi.clearAllMocks())

// ─── Fixtures ────────────────────────────────────────────────────────────────

const fakePlan = {
  title: "x",
  logline: "x",
  target_duration_seconds: 60,
  format: "short_film",
  output_resolution: "1080p",
  language: "en",
  genre: "drama",
  tone: [],
  cast: [],
  locations: [],
  objects: [],
  scenes: [],
  beats: [],
  has_narrator: false,
  narrator_profile: null,
  music_plan: { mood: "x", bpm_target: 120, genre_hints: [] },
  global_style: {
    visual_style: "x",
    color_palette: "x",
    lighting: "x",
    camera_language: "x",
  },
  total_duration_seconds: 60,
  estimated_scene_count: 0,
  warnings: [],
}

function makeShot(id: string, isMatchCut = false) {
  return {
    shot_id: id,
    camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    shot_intensity_kind: "establishing_shot",
    action: "x",
    dialogue_line: null,
    duration_seconds: 5,
    motion_prompt: "x",
    start_state: "x",
    end_state: "x",
    continuity_with_previous: null,
    shot_intent: {
      needs_multishot_reference: false,
      is_loopable: false,
      needs_music_suppression: true,
      is_match_cut: isMatchCut,
    },
    visual_keyframe_prompt: `prompt for ${id}`,
  }
}

function makeSceneNodeData(idx: number, shots: ReturnType<typeof makeShot>[]) {
  return {
    scene_index: idx,
    description: "x",
    emotional_beat: "setup",
    duration_seconds: 10,
    shot_input_mode: "first_frame",
    cast_keys: [],
    location_key: "x",
    object_keys: [],
    continuity_from_prev: "hard_cut",
    image_model: "nano-banana-2",
    video_model: "kling",
    shots,
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
  }
}

/**
 * Build a supabase mock. Mirrors the scene-images-match-cut.test.ts helper but
 * adds the chained .eq().eq().eq() bulk-update path used by the H2 auto-mode
 * advanceToApproved helper (UPDATE pipeline_entities SET status=approved
 * WHERE pipeline_id=? AND entity_type='scene' AND status='awaiting_approval').
 */
function makeSupabase(
  opts: {
    scenes: Array<{ id: string; entity_key: string; scene_node_data?: unknown; status?: string }>
    initialStageStatus?: string
    initialStageOutput?: Record<string, unknown>
    pipelineId: string
    pipelineOwner: string
    variants: Array<{ entity_id: string; asset_id: string | null; status: string }>
    assets: Array<{ id: string; user_id: string; r2_url: string }>
  },
) {
  const entities = new Map<string, Record<string, unknown>>()
  for (const s of opts.scenes) {
    entities.set(s.id, {
      id: s.id,
      entity_key: s.entity_key,
      status: s.status ?? "awaiting_approval",
      metadata: s.scene_node_data !== undefined ? { scene_node_data: s.scene_node_data } : {},
    })
  }
  const stageUpdates: Array<Record<string, unknown>> = []

  // Chained .eq() update builder — used by auto-mode bulk-flip
  // UPDATE pipeline_entities SET status=approved WHERE pipeline_id=? AND
  // entity_type='scene' AND status='awaiting_approval'.
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
    rpc: vi.fn(),
    from: (table: string) => {
      if (table === "pipeline_stages") {
        return {
          select: () => ({
            eq: (col1: string, _val1: string) => {
              if (col1 === "id") {
                return {
                  maybeSingle: async () => ({
                    data: {
                      status: opts.initialStageStatus ?? "running",
                      output: opts.initialStageOutput ?? null,
                    },
                    error: null,
                  }),
                }
              }
              return {
                eq: () => ({
                  single: async () => ({
                    data: { output: { plan: fakePlan } },
                    error: null,
                  }),
                  maybeSingle: async () => ({
                    data: { output: { plan: fakePlan } },
                    error: null,
                  }),
                }),
              }
            },
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              stageUpdates.push(patch)
              return { data: null, error: null }
            },
          }),
        }
      }
      if (table === "pipeline_entities") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                order: async () => ({
                  data: Array.from(entities.values()),
                  error: null,
                }),
                in: async () => ({ data: [], error: null }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            // Two callers:
            //   1) per-scene .update().eq("id", val) — terminator after one .eq()
            //   2) bulk auto-mode .update().eq().eq().eq() — chained terminator
            //
            // The first call is awaited as a Promise after `.eq("id", ...)`. The
            // second resolves on .then() after the third .eq(). The chain handles
            // both shapes — .eq() returns the same chain node either way, and the
            // thenable resolves when awaited.
            const chain = makeUpdateChain(patch)
            return chain
          },
        }
      }
      if (table === "pipeline_entity_nodes") {
        return {
          select: () => ({ eq: async () => ({ data: [], error: null }) }),
          update: () => ({
            eq: async () => ({ data: null, error: null }),
            in: async () => ({ data: null, error: null }),
          }),
        }
      }
      if (table === "pipeline_entity_variants") {
        // `.select("asset_id").eq("entity_id", …).eq("status", "approved")`
        return {
          select: () => ({
            eq: (_c1: string, entityId: string) => ({
              eq: async (_c2: string, status: string) => ({
                data: opts.variants
                  .filter((v) => v.entity_id === entityId && v.status === status)
                  .map((v) => ({ asset_id: v.asset_id })),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: (_c: string, id: string) => ({
              maybeSingle: async () => ({
                data: id === opts.pipelineId ? { user_id: opts.pipelineOwner } : null,
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === "assets") {
        // Answers both an unfiltered `.in("id", ids)` read and one narrowed by
        // `.eq("user_id", owner)`, the way Postgres would.
        return {
          select: () => ({
            in: (_c: string, ids: string[]) => {
              const rows = (owner?: string) => ({
                data: opts.assets
                  .filter((a) => ids.includes(a.id) && (owner === undefined || a.user_id === owner))
                  .map((a) => ({ id: a.id, r2_url: a.r2_url })),
                error: null,
              })
              return {
                eq: async (_c2: string, owner: string) => rows(owner),
                then: (resolve: (v: unknown) => unknown) => resolve(rows()),
              }
            },
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
    _entities: entities,
    _stageUpdates: stageUpdates,
  } as never
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const PIPELINE = "p-variant-owner"
const OWNER = "owner-1"

describe("Stage 6 (scene-images): variant reference images are the pipeline owner's assets", () => {
  it("attacker: a variant naming another user's asset is not sent as a reference (decided 2026-10-07)", async () => {
    ;(pipelineGenerateImage as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j1",
      assetId: "kf-1",
      assetUrl: "https://r2/kf.png",
      creditsSpent: 2,
    })
    ;(runMatchCutOrchestrator as ReturnType<typeof vi.fn>).mockResolvedValue({
      verdicts: {},
      pendingBreaks: [],
    })
    ;(allocateReferenceSlots as ReturnType<typeof vi.fn>).mockResolvedValue([
      { kind: "primary_character", url: "https://r2/hero-main.png", sourceId: "ent-hero", label: "Character: hero" },
    ])
    const ownVariant = "00000000-0000-4000-8000-00000000a001"
    const foreignVariant = "00000000-0000-4000-8000-00000000a002"
    const supabase = makeSupabase({
      scenes: [
        {
          id: "scene-1",
          entity_key: "scene_01",
          scene_node_data: makeSceneNodeData(1, [makeShot("s1")]),
          status: "awaiting_approval",
        },
      ],
      pipelineId: PIPELINE,
      pipelineOwner: OWNER,
      variants: [
        { entity_id: "ent-hero", asset_id: ownVariant, status: "approved" },
        // Written before migration 480: a variant naming another user's asset.
        { entity_id: "ent-hero", asset_id: foreignVariant, status: "approved" },
      ],
      assets: [
        { id: ownVariant, user_id: OWNER, r2_url: "https://r2/hero-profile.png" },
        { id: foreignVariant, user_id: "victim", r2_url: "https://r2/victims-private.png" },
      ],
    })

    await runSceneImagesStage({
      supabase,
      pipelineId: PIPELINE,
      userId: OWNER,
      userTier: "pro",
      mode: "auto",
    })

    const calls = (pipelineGenerateImage as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.length).toBeGreaterThan(0)
    const refs = (calls[0]![0] as { referenceImageUrls?: string[] }).referenceImageUrls ?? []
    expect(refs).toContain("https://r2/hero-main.png")
    expect(refs).toContain("https://r2/hero-profile.png")
    expect(refs).not.toContain("https://r2/victims-private.png")
  })
})
