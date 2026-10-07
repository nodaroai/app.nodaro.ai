/**
 * Phase 1D.3 — branchPipeline service unit tests.
 *
 * Uses an in-memory Supabase mock that captures .insert() payloads keyed by
 * table, mirroring the style of fork.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { OWNER_ID, VICTIM_JOB_ID, ownerUrl, useStorageHost, victimUrl, withStorageOwnerTables } from "../../../test/storage-owner-tables.js"

// ---------------------------------------------------------------------------
// Hoist mocks before any module import
// ---------------------------------------------------------------------------

vi.mock("../queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

import { branchPipeline, BranchPipelineError } from "../branch-pipeline.js"
import { enqueuePipelineRun } from "../queue.js"

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

// ---------------------------------------------------------------------------
// In-memory Supabase mock
// ---------------------------------------------------------------------------

/**
 * The gateway refuses a request line past its URL limit; an `.in("id", …)` of
 * a few hundred uuids is ~39 bytes each in the query string. The mock refuses
 * a list longer than this, as the gateway would refuse the request.
 */
const ASSET_IN_LIST_LIMIT = 150

interface Pipeline {
  id: string
  status: string
  user_id: string
  workflow_id?: string | null
  root_node_id: string
  pipeline_type: string
  activation_mode: string
  mode: string
  input_prompt: string
  target_duration_seconds: number
  format: string
  output_resolution: string
  language: string
  style_directives?: unknown
  config?: unknown
  max_cost_credits?: number | null
}

interface Stage {
  stage_name: string
  stage_order: number
  output?: unknown
  critic_feedback?: unknown
  user_edits?: unknown
}

interface Entity {
  entity_type: string
  entity_key: string
  status: string
  main_asset_id?: string | null
  last_frame_asset_id?: string | null
  metadata?: unknown
}

interface Fixture {
  pipelinesInserted: Array<Record<string, unknown>>
  stagesInserted: Array<Record<string, unknown>>
  entitiesInserted: Array<Record<string, unknown>>
  pipelinesUpdated: Array<Record<string, unknown>>
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>
}

function makeSupabaseMock(
  pipeline: Pipeline | null,
  stages: Stage[] = [],
  entities: Entity[] = [],
  /** asset id → its owner. An asset not listed is the pipeline owner's. */
  assetOwners: Record<string, string> = {},
  assetsReadFails = false,
): { client: unknown; fixture: Fixture } {
  const fixture: Fixture = {
    pipelinesInserted: [],
    stagesInserted: [],
    entitiesInserted: [],
    pipelinesUpdated: [],
    rpcCalls: [],
  }

  let newPipelineId = "new-pipeline-id"

  const client = {
    from(table: string) {
      if (table === "pipelines") {
        return {
          select: (_cols: string) => {
            // The owner filter behaves as in Postgres: a pipeline of another
            // user matches no row. (The id filter is not modelled; each case
            // has one pipeline.)
            let owner: unknown
            const chain = {
              eq: (col: string, val: unknown) => {
                if (col === "user_id") owner = val
                return chain
              },
              single: async () => {
                const visible = pipeline && (owner === undefined || pipeline.user_id === owner) ? pipeline : null
                return { data: visible, error: visible ? null : { message: "not found", code: "PGRST116" } }
              },
              // refundPipelineCredits looks up the new pipeline's reservation link.
              maybeSingle: async () => ({
                data: { reservation_usage_log_id: "reservation-usage-log-id" },
                error: null,
              }),
            }
            return chain
          },
          insert: (row: Record<string, unknown>) => {
            fixture.pipelinesInserted.push(row)
            return {
              select: (_cols: string) => ({
                single: async () => ({
                  data: { id: newPipelineId },
                  error: null,
                }),
              }),
            }
          },
          // reservePipelineCredits persists reservation_usage_log_id; rollback path deletes.
          update: (row: Record<string, unknown>) => {
            fixture.pipelinesUpdated.push(row)
            return { eq: async () => ({ error: null }) }
          },
          delete: () => ({ eq: async () => ({ error: null }) }),
        }
      }
      if (table === "pipeline_stages") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              in: (_col2: string, _vals: string[]) => ({
                data: stages.filter((s) => _vals.includes(s.stage_name)),
                error: null,
              }),
            }),
          }),
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            fixture.stagesInserted.push(...arr)
            return { error: null }
          },
        }
      }
      if (table === "assets") {
        // ownedAssetUrlsById: `.select("id, r2_url").in("id", ids).eq("user_id", owner)`.
        return {
          select: (_cols: string) => ({
            in: (_col: string, ids: string[]) => ({
              eq: async (_col2: string, owner: string) => assetsReadFails || ids.length > ASSET_IN_LIST_LIMIT ? { data: null, error: { message: "timeout" } } : ({
                data: ids
                  .filter((id) => (assetOwners[id] ?? pipeline?.user_id) === owner)
                  .map((id) => ({ id, r2_url: `https://r2/${id}.png` })),
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === "pipeline_entities") {
        return {
          select: (_cols: string) => ({
            eq: (_col: string, _val: string) => ({
              in: (_col2: string, vals: string[]) => ({
                data: entities.filter((e) => vals.includes(e.entity_type)),
                error: null,
              }),
            }),
          }),
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            fixture.entitiesInserted.push(...arr)
            return { error: null }
          },
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
    // reservePipelineCredits calls rpc("reserve_credits") → usageLogId;
    // refundPipelineCredits calls rpc("refund_credits", { p_usage_log_id }).
    rpc: async (fn: string, args: Record<string, unknown>) => {
      fixture.rpcCalls.push({ fn, args })
      return {
        data: fn === "reserve_credits" ? "reservation-usage-log-id" : null,
        error: null,
      }
    },
  }

  return { client, fixture }
}

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "orig-pipeline-id",
    status: "completed",
    user_id: "user-1",
    workflow_id: null,
    root_node_id: "root_1",
    pipeline_type: "story_to_video",
    activation_mode: "interactive",
    mode: "manual",
    input_prompt: "A pilot's final mission",
    target_duration_seconds: 60,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    style_directives: null,
    config: null,
    max_cost_credits: null,
    ...overrides,
  }
}

function makeStagesUpTo(count: number): Stage[] {
  const names = [
    "script",
    "characters",
    "objects",
    "locations",
    "shot_list",
    "scene_images",
    "animate_audio_edit",
    "post_merge",
  ] as const
  return names.slice(0, count).map((name, i) => ({
    stage_name: name,
    stage_order: i + 1,
    output: { some: "data" },
  }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
})

describe("branchPipeline", () => {
  it("inserts a new pipelines row with branched_from lineage", async () => {
    const { client, fixture } = makeSupabaseMock(
      makePipeline(),
      makeStagesUpTo(5),
    )
    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    expect(fixture.pipelinesInserted).toHaveLength(1)
    const inserted = fixture.pipelinesInserted[0]!
    expect(inserted.status).toBe("running")
    expect(inserted.branched_from_pipeline_id).toBe("orig-pipeline-id")
    expect(inserted.branched_from_stage).toBe("scene_images")
    expect(inserted.user_id).toBe("user-1")
    expect(inserted.input_prompt).toBe("A pilot's final mission")
    expect(inserted.pipeline_type).toBe("story_to_video")
  })

  it("P14: the branch carries the BRANCHER's payer stamp — the original's is stripped, forged ones don't survive", async () => {
    const wsCtx = {
      payer: "workspace" as const,
      userId: "user-1",
      workspaceId: "ws-1",
      orgId: "org-1",
      memberCap: null,
      entitlements: {
        watermark: false as const,
        dailyCapCredits: null,
        parallelism: 12,
        tierForGates: "business" as const,
        freeTierBlocklist: false as const,
        webFreeMode: false as const,
        appCreditsAllowance: false as const,
      },
    }
    // The ORIGINAL carries someone's stamp — it must not ride the branch.
    const original = makePipeline()
    original.config = { music_enabled: true, billingContext: { payer: "workspace", workspaceId: "someone-elses" } }

    const { client, fixture } = makeSupabaseMock(original, makeStagesUpTo(5))
    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
      billingContext: wsCtx,
    })
    const cfg = fixture.pipelinesInserted[0]!.config as Record<string, unknown>
    expect(cfg.billingContext).toEqual(wsCtx)
    expect(cfg.music_enabled).toBe(true)

    // And a PERSONAL brancher gets no stamp at all — the original's gone too.
    vi.clearAllMocks()
    const second = makeSupabaseMock(original, makeStagesUpTo(5))
    await branchPipeline({
      supabase: second.client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })
    const cfg2 = second.fixture.pipelinesInserted[0]!.config as Record<string, unknown>
    expect(cfg2.billingContext).toBeUndefined()
    expect(cfg2.music_enabled).toBe(true)
  })

  it("clones upstream stages as approved", async () => {
    // Branching from scene_images (order 6) → clone stages 1-5
    const stages = makeStagesUpTo(5)
    const { client, fixture } = makeSupabaseMock(makePipeline(), stages)

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    // 5 upstream stages cloned + 1 branch stage inserted
    const upstreamInserts = fixture.stagesInserted.filter((s) => s.status === "approved")
    expect(upstreamInserts).toHaveLength(5)
    for (const row of upstreamInserts) {
      expect(row.pipeline_id).toBe("new-pipeline-id")
      expect(row.status).toBe("approved")
    }
  })

  it("inserts the branch stage as status='running'", async () => {
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5))

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    const runningStages = fixture.stagesInserted.filter((s) => s.status === "running")
    expect(runningStages).toHaveLength(1)
    expect(runningStages[0]!.stage_name).toBe("scene_images")
    expect(runningStages[0]!.stage_order).toBe(6)
    expect(runningStages[0]!.pipeline_id).toBe("new-pipeline-id")
  })

  it("clones pipeline_entities of the correct types for the branch stage", async () => {
    const entities: Entity[] = [
      { entity_type: "character", entity_key: "hero", status: "approved", main_asset_id: "a1" },
      { entity_type: "object", entity_key: "sword", status: "approved", main_asset_id: "a2" },
      { entity_type: "location", entity_key: "forest", status: "approved", main_asset_id: "a3" },
      { entity_type: "scene", entity_key: "scene_01", status: "approved", main_asset_id: "a4" },
    ]
    const { client, fixture } = makeSupabaseMock(
      makePipeline(),
      makeStagesUpTo(5),
      entities,
    )

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images", // ENTITY_BY_STAGE includes character, object, location, scene
      userId: "user-1",
    })

    expect(fixture.entitiesInserted).toHaveLength(4)
    const types = fixture.entitiesInserted.map((e) => e.entity_type)
    expect(types).toContain("character")
    expect(types).toContain("object")
    expect(types).toContain("location")
    expect(types).toContain("scene")
    // Every cloned entity should carry the approved status
    for (const e of fixture.entitiesInserted) {
      expect(e.status).toBe("approved")
      expect(e.pipeline_id).toBe("new-pipeline-id")
    }
  })

  it("attacker: a pointer at another user's asset is not carried into the branch (decided 2026-10-07)", async () => {
    // Written before migration 480: the hero's main image and its last
    // critic attempt name the victim's assets. The branch's insert would
    // carry them into a new row (and 480's trigger refuses that insert).
    const entities: Entity[] = [
      {
        entity_type: "character",
        entity_key: "hero",
        status: "approved",
        main_asset_id: aid("foreign"),
        metadata: { name: "Hero", last_attempted_asset_id: aid("foreign-2") },
      },
      {
        entity_type: "character",
        entity_key: "rival",
        status: "approved",
        main_asset_id: aid("own"),
        metadata: { name: "Rival", last_attempted_asset_id: aid("own") },
      },
    ]
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5), entities, {
      [aid("foreign")]: "victim",
      [aid("foreign-2")]: "victim",
    })

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    const byKey = new Map(fixture.entitiesInserted.map((e) => [e.entity_key, e]))
    expect(byKey.get("hero")).toMatchObject({ main_asset_id: null, metadata: { name: "Hero" } })
    expect((byKey.get("hero")?.metadata as Record<string, unknown>).last_attempted_asset_id).toBeUndefined()
    expect(byKey.get("rival")).toMatchObject({
      main_asset_id: aid("own"),
      metadata: { name: "Rival", last_attempted_asset_id: aid("own") },
    })
  })

  it("attacker: a last_frame_asset_id naming another user's asset is not carried into the branch (decided 2026-10-07)", async () => {
    // Written before migration 480: the hero's last frame names the victim's
    // asset. Copied as is, 480's trigger refuses the clone insert and the
    // whole branch fails; the owner's own last frame carries over.
    const entities: Entity[] = [
      {
        entity_type: "character",
        entity_key: "hero",
        status: "approved",
        main_asset_id: aid("own"),
        last_frame_asset_id: aid("foreign"),
        metadata: { name: "Hero" },
      },
      {
        entity_type: "character",
        entity_key: "rival",
        status: "approved",
        main_asset_id: aid("own"),
        last_frame_asset_id: aid("own-frame"),
        metadata: { name: "Rival" },
      },
    ]
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5), entities, {
      [aid("foreign")]: "victim",
    })

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    const byKey = new Map(fixture.entitiesInserted.map((e) => [e.entity_key, e]))
    expect(byKey.get("hero")).toMatchObject({ main_asset_id: aid("own"), last_frame_asset_id: null })
    expect(byKey.get("rival")).toMatchObject({ last_frame_asset_id: aid("own-frame") })
  })

  it("a non-uuid last_attempted_asset_id is stripped as naming no asset, and the branch still succeeds", async () => {
    // metadata is free-form jsonb; a pre-480 row may hold a non-uuid string.
    // Sent to `.in("id", …)` it would 22P02 the whole lookup and, under
    // throwOnError, make the pipeline impossible to branch.
    const entities: Entity[] = [
      {
        entity_type: "character",
        entity_key: "hero",
        status: "approved",
        main_asset_id: aid("own"),
        metadata: { name: "Hero", last_attempted_asset_id: "not-a-uuid" },
      },
    ]
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5), entities)

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    const hero = fixture.entitiesInserted.find((e) => e.entity_key === "hero")
    expect(hero).toMatchObject({ main_asset_id: aid("own"), metadata: { name: "Hero" } })
    expect((hero?.metadata as Record<string, unknown>).last_attempted_asset_id).toBeUndefined()
  })

  it("attacker: a scene's shot and asset-ref ids naming another user's asset are not carried into the branch (decided 2026-10-07)", async () => {
    // Written before 480's round 3: the scene's first shot keyframe and one of
    // its generated clips name the victim's assets. Copied as is, the trigger
    // judges every id of an inserted row and refuses the clone, failing the
    // whole branch. The owner's own ids and a value that is not a uuid (names
    // no asset) carry over unchanged; a dropped id takes its matching url with
    // it, and an asset ref goes whole (decided 2026-10-07).
    const sceneNodeData = {
      scene_index: 1,
      shots: [
        {
          shot_id: "s1",
          keyframe_asset_id: aid("foreign"),
          keyframe_url: "https://r2/victim-keyframe.png",
          video_asset_id: aid("own-clip"),
          video_url: "https://r2/own-clip.mp4",
        },
        { shot_id: "s2", keyframe_asset_id: "pending", lipsynced_asset_id: aid("own-lipsync") },
      ],
      generated_clips: [
        { asset_id: aid("own-clip"), url: "https://r2/own-clip.mp4" },
        { asset_id: aid("foreign-2"), url: "https://r2/victim-clip.mp4" },
      ],
      composite_video_asset_id: aid("foreign-2"),
    }
    const entities: Entity[] = [
      {
        entity_type: "scene",
        entity_key: "scene_01",
        status: "approved",
        main_asset_id: null,
        metadata: { entity_type: "scene", scene_node_data: sceneNodeData },
      },
    ]
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5), entities, {
      [aid("foreign")]: "victim",
      [aid("foreign-2")]: "victim",
    })

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    const scene = fixture.entitiesInserted.find((e) => e.entity_key === "scene_01")
    const snd = (scene?.metadata as { scene_node_data: typeof sceneNodeData }).scene_node_data
    expect(snd.shots[0]).toEqual({
      shot_id: "s1",
      video_asset_id: aid("own-clip"),
      video_url: "https://r2/own-clip.mp4",
    })
    expect(snd.shots[1]).toEqual({ shot_id: "s2", keyframe_asset_id: "pending", lipsynced_asset_id: aid("own-lipsync") })
    expect(snd.generated_clips).toEqual([{ asset_id: aid("own-clip"), url: "https://r2/own-clip.mp4" }])
    expect("composite_video_asset_id" in snd).toBe(false)
    // The source row is not mutated.
    expect(sceneNodeData.shots[0]?.keyframe_asset_id).toBe(aid("foreign"))
  })

  it("attacker: a scene url naming another user's object is not carried into the branch, nor its id (decided 2026-10-07)", async () => {
    // Written before migration 482: the first shot's keyframe url is the
    // victim's generated image. 482's trigger judges every url of an inserted
    // row, so copied as is it would refuse the clone and fail the branch.
    const restoreHost = useStorageHost()
    try {
      const sceneNodeData = {
        scene_index: 1,
        shots: [
          { shot_id: "s1", keyframe_url: victimUrl(), video_url: ownerUrl("video", "mp4") },
          { shot_id: "s2", interpolation_keyframe_urls: [ownerUrl(), victimUrl()], keyframe_url: "https://provider.example/k.png" },
        ],
        composite_video_url: ownerUrl("video", "mp4", "-composite"),
      }
      const entities: Entity[] = [
        {
          entity_type: "scene",
          entity_key: "scene_01",
          status: "approved",
          main_asset_id: null,
          metadata: { entity_type: "scene", scene_node_data: sceneNodeData },
        },
      ]
      const { client, fixture } = makeSupabaseMock(makePipeline({ user_id: OWNER_ID }), makeStagesUpTo(5), entities, {})

      await branchPipeline({
        supabase: withStorageOwnerTables(client as object) as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: OWNER_ID,
      })

      const scene = fixture.entitiesInserted.find((e) => e.entity_key === "scene_01")
      const snd = (scene?.metadata as { scene_node_data: typeof sceneNodeData }).scene_node_data
      expect(snd.shots[0]).toEqual({ shot_id: "s1", video_url: ownerUrl("video", "mp4") })
      expect(snd.shots[1]).toEqual({ shot_id: "s2", keyframe_url: "https://provider.example/k.png" })
      expect(snd.composite_video_url).toBe(ownerUrl("video", "mp4", "-composite"))
      expect(sceneNodeData.shots[0]?.keyframe_url).toBe(victimUrl())
    } finally {
      restoreHost()
    }
  })

  it("attacker: a url 482's trigger would refuse (another user's job on any host, or through a proxy) is dropped, not left to fail the branch (review round, decided 2026-10-07)", async () => {
    const restoreHost = useStorageHost()
    try {
      const elsewhere = `https://example.com/x/${VICTIM_JOB_ID}.png`
      const proxied = `https://api.example/v1/download?url=${encodeURIComponent(victimUrl())}`
      const sceneNodeData = {
        scene_index: 1,
        shots: [
          { shot_id: "s1", keyframe_url: elsewhere, video_url: ownerUrl("video", "mp4") },
          { shot_id: "s2", keyframe_url: proxied, last_frame_url: "https://provider.example/l.png" },
        ],
      }
      const entities: Entity[] = [
        {
          entity_type: "scene",
          entity_key: "scene_01",
          status: "approved",
          main_asset_id: null,
          metadata: { entity_type: "scene", scene_node_data: sceneNodeData },
        },
      ]
      const { client, fixture } = makeSupabaseMock(makePipeline({ user_id: OWNER_ID }), makeStagesUpTo(5), entities, {})
      await branchPipeline({
        supabase: withStorageOwnerTables(client as object) as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: OWNER_ID,
      })
      const scene = fixture.entitiesInserted.find((e) => e.entity_key === "scene_01")
      const snd = (scene?.metadata as { scene_node_data: typeof sceneNodeData }).scene_node_data
      expect(snd.shots[0]).toEqual({ shot_id: "s1", video_url: ownerUrl("video", "mp4") })
      expect(snd.shots[1]).toEqual({ shot_id: "s2", last_frame_url: "https://provider.example/l.png" })
    } finally {
      restoreHost()
    }
  })

  it("a maximal finished pipeline (20 scenes x 8 shots x 5 asset ids) branches: the owner lookup is chunked (decided 2026-10-07)", async () => {
    // Every id is the owner's. One `.in()` with all ~820 of them is a request
    // the gateway refuses, which used to fail the whole branch.
    const SHOT_ID_KEYS = ["keyframe_asset_id", "video_asset_id", "last_frame_asset_id", "audio_asset_id", "lipsynced_asset_id"]
    const entities: Entity[] = Array.from({ length: 20 }, (_, sc) => ({
      entity_type: "scene",
      entity_key: `scene_${String(sc + 1).padStart(2, "0")}`,
      status: "approved",
      main_asset_id: null,
      metadata: {
        entity_type: "scene",
        scene_node_data: {
          scene_index: sc + 1,
          shots: Array.from({ length: 8 }, (_, sh) => ({
            shot_id: `s${sh + 1}`,
            ...Object.fromEntries(SHOT_ID_KEYS.map((k) => [k, aid(`max-${sc}-${sh}-${k}`)])),
          })),
          composite_video_asset_id: aid(`max-${sc}-composite`),
        },
      },
    }))
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5), entities)

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    expect(fixture.entitiesInserted).toHaveLength(20)
    const last = fixture.entitiesInserted.find((e) => e.entity_key === "scene_20")
    const snd = (last?.metadata as { scene_node_data: { shots: Array<Record<string, unknown>>; composite_video_asset_id?: string } })
      .scene_node_data
    expect(snd.shots[7]?.lipsynced_asset_id).toBe(aid("max-19-7-lipsynced_asset_id"))
    expect(snd.composite_video_asset_id).toBe(aid("max-19-composite"))
  })

  it("a failed owner lookup fails the branch instead of cloning entities with their images stripped", async () => {
    const entities: Entity[] = [
      { entity_type: "character", entity_key: "hero", status: "approved", main_asset_id: aid("own") },
    ]
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5), entities, {}, true)

    await expect(
      branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ code: "entities_fetch_failed" })
    expect(fixture.entitiesInserted).toHaveLength(0)
  })

  it("enqueues a pipeline-run job with reason='branched' for the new pipeline", async () => {
    const { client } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5))

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    expect(enqueuePipelineRun).toHaveBeenCalledOnce()
    expect(enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "new-pipeline-id",
      userId: "user-1",
      reason: "branched",
    })
  })

  it("reserves upfront credits on the branched pipeline (was a free re-run before)", async () => {
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5))

    await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "scene_images",
      userId: "user-1",
    })

    const inserted = fixture.pipelinesInserted[0]
    expect(inserted).toBeDefined()
    // Regression: reserved_credits was previously 0/unset → free repeatable re-run.
    expect((inserted!.reserved_credits as number) > 0).toBe(true)
    expect(inserted!.reserved_credits).toBe(inserted!.upfront_credit_estimate)
  })

  it("answers pipeline_not_found for someone else's pipeline, whatever its status (no existence oracle)", async () => {
    // The status used to be checked before the owner, so a foreign id answered
    // pipeline_not_completed (400) or forbidden (403) where every other
    // pipeline route answers 404.
    for (const status of ["running", "completed"] as const) {
      const { client, fixture } = makeSupabaseMock(makePipeline({ status, user_id: "someone-else" }))
      const err = await branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(BranchPipelineError)
      expect((err as BranchPipelineError).code).toBe("pipeline_not_found")
      expect(fixture.pipelinesInserted).toHaveLength(0)
    }
  })

  it("rejects when pipeline is not completed", async () => {
    const { client } = makeSupabaseMock(makePipeline({ status: "running" }))

    await expect(
      branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      }),
    ).rejects.toThrow(BranchPipelineError)

    let thrownErr: BranchPipelineError | null = null
    try {
      await branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      })
    } catch (e) {
      thrownErr = e as BranchPipelineError
    }
    expect(thrownErr?.code).toBe("pipeline_not_completed")
  })

  it("rejects invalid stage name", async () => {
    const { client } = makeSupabaseMock(makePipeline())

    let thrownErr: BranchPipelineError | null = null
    try {
      await branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "garbage" as never,
        userId: "user-1",
      })
    } catch (e) {
      thrownErr = e as BranchPipelineError
    }
    expect(thrownErr).toBeInstanceOf(BranchPipelineError)
    expect(thrownErr?.code).toBe("invalid_stage")
  })

  it("branch from Stage 1 (script) — empty clone path: 0 upstream stages, branch stage = running", async () => {
    const { client, fixture } = makeSupabaseMock(
      makePipeline(),
      [], // no upstream stages to clone
      [], // no entities to clone
    )

    const result = await branchPipeline({
      supabase: client as never,
      originalPipelineId: "orig-pipeline-id",
      fromStage: "script",
      userId: "user-1",
    })

    // No upstream stages cloned
    expect(result.clonedStages).toHaveLength(0)
    expect(result.clonedEntities).toBe(0)

    // Only the branch stage itself should be inserted
    const approvedStages = fixture.stagesInserted.filter((s) => s.status === "approved")
    const runningStages = fixture.stagesInserted.filter((s) => s.status === "running")
    expect(approvedStages).toHaveLength(0)
    expect(runningStages).toHaveLength(1)
    expect(runningStages[0]!.stage_name).toBe("script")
    expect(runningStages[0]!.stage_order).toBe(1)

    // New pipeline is still created
    expect(fixture.pipelinesInserted).toHaveLength(1)
    expect(result.newPipelineId).toBe("new-pipeline-id")

    // Queue is still enqueued
    expect(enqueuePipelineRun).toHaveBeenCalledOnce()
  })

  // ── The reserve refusal keeps its stable code (F6) ─────────────────────
  //
  // `reservePipelineCredits` classifies the RPC's `USER_ALLOWANCE_EXCEEDED:`
  // raise through `mapReserveError` and answers reason "user_allowance_
  // exceeded". This service used to rewrite every reason except
  // "insufficient_credits" to "reservation_failed", which routes/pipelines.ts
  // maps to HTTP 500 — so the 402 the client keys its allowance copy on never
  // existed. Only a genuine `rpc_error` may become `reservation_failed`.
  it("forwards user_allowance_exceeded as the error CODE, and still rolls the row back", async () => {
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5))
    ;(client as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) => {
      fixture.rpcCalls.push({ fn, args })
      if (fn === "reserve_credits") {
        return { data: null, error: { message: "USER_ALLOWANCE_EXCEEDED: granted 100, remaining 40, need 60" } }
      }
      return { data: null, error: null }
    }

    await expect(
      branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ name: "BranchPipelineError", code: "user_allowance_exceeded" })

    // Nothing downstream of the failed reservation — the row is rolled back and
    // no stage, entity or queue job survives the refusal.
    expect(fixture.stagesInserted).toHaveLength(0)
    expect(fixture.entitiesInserted).toHaveLength(0)
    expect(enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("keeps `reservation_failed` for a genuine fault, which is NOT a business refusal", async () => {
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5))
    ;(client as unknown as { rpc: unknown }).rpc = async (fn: string, args: Record<string, unknown>) => {
      fixture.rpcCalls.push({ fn, args })
      if (fn === "reserve_credits") return { data: null, error: { message: "deadlock detected" } }
      return { data: null, error: null }
    }

    await expect(
      branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      }),
    ).rejects.toMatchObject({ name: "BranchPipelineError", code: "reservation_failed" })
  })

  it("refunds the reservation + fails the pipeline when post-reservation setup throws", async () => {
    const { client, fixture } = makeSupabaseMock(makePipeline(), makeStagesUpTo(5))
    // Step 9 (enqueue) throws — e.g. Redis down — AFTER credits were reserved.
    vi.mocked(enqueuePipelineRun).mockRejectedValueOnce(new Error("redis down"))

    await expect(
      branchPipeline({
        supabase: client as never,
        originalPipelineId: "orig-pipeline-id",
        fromStage: "scene_images",
        userId: "user-1",
      }),
    ).rejects.toThrow("redis down")

    // Regression: previously the reservation leaked until the 6h reconcile abandon.
    // The reservation must be refunded on the post-reservation failure path.
    const refundCall = fixture.rpcCalls.find((c) => c.fn === "refund_credits")
    expect(refundCall).toBeDefined()
    expect(refundCall!.args.p_usage_log_id).toBe("reservation-usage-log-id")
    // And the orphan pipeline is marked failed so the resume cron doesn't churn.
    const failedUpdate = fixture.pipelinesUpdated.find((u) => u.status === "failed")
    expect(failedUpdate).toBeDefined()
    expect(failedUpdate!.failure_reason).toBe("branch_setup_failed")
  })
})
