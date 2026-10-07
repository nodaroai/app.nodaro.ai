import { describe, it, expect, vi, beforeEach } from "vitest"
import type { SceneNodeData, ShotSpec } from "@nodaro/shared"

// allocateReferenceSlots emits a pipeline:warning event when a 1-ref
// provider has to degrade — assert via this mock.
vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))

// extractLastFrame calls pipelineExtractFrame; we mock it for the
// extractLastFrame test (in extract-last-frame.test.ts). allocateReferenceSlots
// doesn't call pipelineExtractFrame, but the mock is safe to apply at the
// module level.
vi.mock("../services/pipeline-extract-frame.js", () => ({
  pipelineExtractFrame: vi.fn(),
}))

import {
  allocateReferenceSlots,
  extractLastFrame,
  prepareSceneRefContext,
} from "../continuity.js"
import { pipelineEvents } from "../events.js"
import { pipelineExtractFrame } from "../services/pipeline-extract-frame.js"

/**
 * A fixture asset id: `assets.id` is a uuid column, and the ownership lookup
 * only asks about uuid-shaped ids, so a named fixture asset maps to a stable
 * uuid (one per name, in first-use order).
 */
const fixtureAssetIds = new Map<string, string>()
function aid(name: string): string {
  let id = fixtureAssetIds.get(name)
  if (!id) {
    id = `00000000-0000-4000-8000-${String(fixtureAssetIds.size + 1).padStart(12, "0")}`
    fixtureAssetIds.set(name, id)
  }
  return id
}

beforeEach(() => vi.clearAllMocks())

function makeShot(overrides: Partial<ShotSpec> = {}): ShotSpec {
  return {
    shot_id: "shot_01",
    camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    shot_intensity_kind: "establishing_shot",
    action: "Hero enters",
    dialogue_line: null,
    duration_seconds: 5,
    motion_prompt: "slow push in",
    start_state: "hero at door",
    end_state: "hero in room",
    continuity_with_previous: null,
    shot_intent: {
      needs_multishot_reference: false,
      is_loopable: false,
      needs_music_suppression: true,
      is_match_cut: false,
    },
    visual_keyframe_prompt: "Wide shot, dim hallway",
    ...overrides,
  } as ShotSpec
}

function makeScene(overrides: Partial<SceneNodeData> = {}): SceneNodeData {
  return {
    scene_index: 1,
    description: "Opening",
    emotional_beat: "anticipation",
    duration_seconds: 5,
    shot_input_mode: "first_frame",
    cast_keys: ["hero", "rival"],
    location_key: "hallway",
    object_keys: ["briefcase"],
    continuity_from_prev: "hard_cut",
    image_model: "nano-banana-pro",
    video_model: "kling-3-omni",
    shots: [makeShot()],
    scene_anchor_keyframe: null,
    generated_keyframes: [],
    generated_clips: [],
    composite_video: null,
    last_frame: null,
    scene_audio_track: null,
    ...overrides,
  } as SceneNodeData
}

const PIPELINE_OWNER = "owner-1"

/**
 * Build a supabase mock returning the supplied entity + asset rows. Every
 * pipeline is PIPELINE_OWNER's; an asset is too unless `assetOwners` says
 * otherwise, and the assets read honours its `user_id` filter.
 */
function makeSupabaseMock(opts: {
  entities?: Array<{
    id: string
    entity_type: string
    entity_key: string
    main_asset_id: string | null
  }>
  assetUrls?: Record<string, string>
  assetOwners?: Record<string, string>
}) {
  const supabase = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "pipeline_entities") {
        return {
          select: () => ({
            eq: () => ({
              in: async () => ({ data: opts.entities ?? [], error: null }),
            }),
          }),
        }
      }
      if (table === "pipelines") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { user_id: PIPELINE_OWNER }, error: null }),
            }),
          }),
        }
      }
      if (table === "assets") {
        return {
          select: () => ({
            in: (_col: string, ids: string[]) => ({
              eq: async (col: string, owner: string) => ({
                data: Object.entries(opts.assetUrls ?? {})
                  .filter(([id]) => ids.includes(id))
                  .filter(([id]) => col !== "user_id" || (opts.assetOwners?.[id] ?? PIPELINE_OWNER) === owner)
                  .map(([id, url]) => ({ id, r2_url: url })),
                error: null,
              }),
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    }),
  }
  return supabase as never
}

describe("allocateReferenceSlots", () => {
  it("Kling 3 Omni (7-ref): allocates continuity anchor + primary char + location + extras", async () => {
    const supabase = makeSupabaseMock({
      entities: [
        { id: "char-hero", entity_type: "character", entity_key: "hero", main_asset_id: aid("hero") },
        { id: "char-rival", entity_type: "character", entity_key: "rival", main_asset_id: aid("rival") },
        { id: "loc-hall", entity_type: "location", entity_key: "hallway", main_asset_id: aid("hall") },
        { id: "obj-bf", entity_type: "object", entity_key: "briefcase", main_asset_id: aid("bf") },
      ],
      assetUrls: {
        [aid("hero")]: "https://r2/hero.png",
        [aid("rival")]: "https://r2/rival.png",
        [aid("hall")]: "https://r2/hall.png",
        [aid("bf")]: "https://r2/bf.png",
      },
    })
    const slots = await allocateReferenceSlots({
      supabase,
      pipelineId: "p1",
      scene: { id: "scene-1" },
      shot: makeShot(),
      sceneNodeData: makeScene({ video_model: "kling-3-omni" }),
      priorLastFrame: { assetId: aid("prior"), url: "https://r2/prior.png" },
    })

    expect(slots.length).toBe(5) // anchor + hero + hall + rival + briefcase
    expect(slots[0]).toMatchObject({ kind: "continuity_anchor", url: "https://r2/prior.png" })
    expect(slots[1]).toMatchObject({ kind: "primary_character", url: "https://r2/hero.png" })
    expect(slots[2]).toMatchObject({ kind: "location_main", url: "https://r2/hall.png" })
    expect(slots[3]).toMatchObject({ kind: "additional_character", url: "https://r2/rival.png" })
    expect(slots[4]).toMatchObject({ kind: "additional_object", url: "https://r2/bf.png" })
    expect(pipelineEvents.publish).not.toHaveBeenCalled()
  })

  it("Hailuo Standard (1-ref): drops all but the continuity anchor + emits warning", async () => {
    const supabase = makeSupabaseMock({
      entities: [
        { id: "char-hero", entity_type: "character", entity_key: "hero", main_asset_id: aid("hero") },
        { id: "loc-hall", entity_type: "location", entity_key: "hallway", main_asset_id: aid("hall") },
      ],
      assetUrls: {
        [aid("hero")]: "https://r2/hero.png",
        [aid("hall")]: "https://r2/hall.png",
      },
    })
    const slots = await allocateReferenceSlots({
      supabase,
      pipelineId: "p1",
      scene: { id: "scene-1" },
      shot: makeShot({
        shot_intent: {
          needs_multishot_reference: true,
          is_loopable: false,
          needs_music_suppression: true,
          is_match_cut: false,
        },
      }),
      sceneNodeData: makeScene({ video_model: "hailuo-standard", cast_keys: ["hero"], object_keys: [] }),
      priorLastFrame: { assetId: aid("prior"), url: "https://r2/prior.png" },
    })

    expect(slots.length).toBe(1)
    expect(slots[0]).toMatchObject({ kind: "continuity_anchor" })
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "pipeline:warning",
        code: "ref_slots_degraded_to_one",
      }),
    )
  })

  it("Hailuo Standard (1-ref): no prior frame → uses character ref + warns", async () => {
    const supabase = makeSupabaseMock({
      entities: [
        { id: "char-hero", entity_type: "character", entity_key: "hero", main_asset_id: aid("hero") },
        { id: "loc-hall", entity_type: "location", entity_key: "hallway", main_asset_id: aid("hall") },
      ],
      assetUrls: {
        [aid("hero")]: "https://r2/hero.png",
        [aid("hall")]: "https://r2/hall.png",
      },
    })
    const slots = await allocateReferenceSlots({
      supabase,
      pipelineId: "p1",
      scene: { id: "scene-1" },
      shot: makeShot(),
      sceneNodeData: makeScene({ video_model: "hailuo-standard", cast_keys: ["hero"], object_keys: [] }),
      priorLastFrame: null,
    })

    expect(slots.length).toBe(1)
    expect(slots[0]).toMatchObject({ kind: "primary_character", url: "https://r2/hero.png" })
    expect(pipelineEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({ code: "ref_slots_degraded_to_one" }),
    )
  })

  it("attacker: an entity whose main_asset_id names another user's asset gets no reference (decided 2026-10-07)", async () => {
    const supabase = makeSupabaseMock({
      entities: [
        { id: "char-hero", entity_type: "character", entity_key: "hero", main_asset_id: aid("hero") },
        // A pointer at another user's private asset, written before migration 480.
        { id: "char-rival", entity_type: "character", entity_key: "rival", main_asset_id: aid("foreign") },
      ],
      assetUrls: {
        [aid("hero")]: "https://r2/hero.png",
        [aid("foreign")]: "https://r2/someone-elses.png",
      },
      assetOwners: { [aid("foreign")]: "victim" },
    })
    const slots = await allocateReferenceSlots({
      supabase,
      pipelineId: "p1",
      scene: { id: "scene-1" },
      shot: makeShot(),
      sceneNodeData: makeScene({ video_model: "kling-3-omni", location_key: "", object_keys: [] }),
      priorLastFrame: null,
    })
    expect(slots.map((s) => s.url)).toEqual(["https://r2/hero.png"])

    const ctx = await prepareSceneRefContext(
      supabase,
      "p1",
      makeScene({ location_key: "", object_keys: [] }),
    )
    expect(ctx.entitiesByTypeKey.get("character:hero")?.main_asset_url).toBe("https://r2/hero.png")
    expect(ctx.entitiesByTypeKey.get("character:rival")?.main_asset_url).toBeNull()
  })

  it("Returns empty list when no candidates available", async () => {
    const supabase = makeSupabaseMock({ entities: [] })
    const slots = await allocateReferenceSlots({
      supabase,
      pipelineId: "p1",
      scene: { id: "scene-1" },
      shot: makeShot(),
      sceneNodeData: makeScene({ cast_keys: [], location_key: "", object_keys: [] }),
      priorLastFrame: null,
    })
    expect(slots).toEqual([])
  })

  it("J2a cached path: sceneContext skips DB queries — supabase.from never called", async () => {
    // Build the context manually (simulates prepareSceneRefContext output).
    const prebuiltContext = {
      entitiesByTypeKey: new Map([
        [
          "character:hero",
          { id: "char-hero", main_asset_url: "https://r2/hero.png" },
        ],
        [
          "location:hallway",
          { id: "loc-hall", main_asset_url: "https://r2/hall.png" },
        ],
      ]),
    }
    // Supabase stub that throws if any DB call is made.
    const neverCalledSupabase = {
      from: vi.fn(() => {
        throw new Error("DB should not be queried when sceneContext is provided")
      }),
    } as unknown as Parameters<typeof allocateReferenceSlots>[0]["supabase"]

    const slots = await allocateReferenceSlots({
      supabase: neverCalledSupabase,
      pipelineId: "p1",
      scene: { id: "scene-1" },
      shot: makeShot(),
      sceneNodeData: makeScene({ video_model: "kling-3-omni", cast_keys: ["hero"], object_keys: [] }),
      priorLastFrame: { assetId: aid("prior"), url: "https://r2/prior.png" },
      sceneContext: prebuiltContext,
    })

    // supabase.from must not have been called — the cached map was used.
    expect(neverCalledSupabase.from).not.toHaveBeenCalled()
    // Slots should reflect anchor + hero + hallway.
    expect(slots.length).toBe(3)
    expect(slots[0]).toMatchObject({ kind: "continuity_anchor" })
    expect(slots[1]).toMatchObject({ kind: "primary_character", url: "https://r2/hero.png" })
    expect(slots[2]).toMatchObject({ kind: "location_main", url: "https://r2/hall.png" })
  })
})

describe("extractLastFrame", () => {
  function makeUpdatingSupabase() {
    const updates: Array<Record<string, unknown>> = []
    const supabase = {
      from: (table: string) => {
        if (table === "pipeline_entities") {
          return {
            update: (patch: Record<string, unknown>) => ({
              eq: async () => {
                updates.push(patch)
                return { data: null, error: null }
              },
            }),
          }
        }
        throw new Error(`Unmocked table: ${table}`)
      },
    }
    return { supabase: supabase as never, _updates: updates }
  }

  it("returns assetId + url and persists last_frame_asset_id on success", async () => {
    ;(pipelineExtractFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j",
      assetId: "lf-1",
      assetUrl: "https://r2/lf.png",
      creditsSpent: 0,
    })
    const { supabase, _updates } = makeUpdatingSupabase()
    const result = await extractLastFrame({
      supabase,
      pipelineId: "p1",
      sceneEntityId: "scene-1",
      userId: "u1",
      videoUrl: "https://r2/clip.mp4",
      durationSec: 5,
    })
    expect(result).toEqual({ assetId: "lf-1", url: "https://r2/lf.png" })
    expect(_updates).toEqual([{ last_frame_asset_id: "lf-1" }])
  })

  it("salvages URL when assetId is null (race window) — no DB write, no throw", async () => {
    ;(pipelineExtractFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j",
      assetId: null, // asset row hasn't landed yet
      assetUrl: "https://r2/lf.png",
      creditsSpent: 0,
    })
    const { supabase, _updates } = makeUpdatingSupabase()
    const result = await extractLastFrame({
      supabase,
      pipelineId: "p1",
      sceneEntityId: "scene-1",
      userId: "u1",
      videoUrl: "https://r2/clip.mp4",
      durationSec: 5,
    })
    // URL salvaged so the continuity chain can proceed.
    expect(result.url).toBe("https://r2/lf.png")
    expect(result.assetId).toBeNull()
    // No pipeline_entities update should fire when there's no asset id to write.
    expect(_updates).toEqual([])
  })

  it("throws only when the URL itself is missing", async () => {
    ;(pipelineExtractFrame as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j-fail",
      assetId: null,
      assetUrl: "",
      creditsSpent: 0,
    })
    const { supabase } = makeUpdatingSupabase()
    await expect(
      extractLastFrame({
        supabase,
        pipelineId: "p1",
        sceneEntityId: "scene-1",
        userId: "u1",
        videoUrl: "https://r2/clip.mp4",
        durationSec: 5,
      }),
    ).rejects.toThrow(/extract-frame job completed without output URL/)
  })
})

