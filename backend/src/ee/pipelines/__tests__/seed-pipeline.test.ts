/**
 * createSeededPipeline() — seeded pipeline creation lane unit tests.
 *
 * A seeded pipeline starts the existing 8-stage film-director pipeline with
 * PRE-APPROVED creative artifacts (a validated ShowrunnerPlan, and optionally
 * per-scene SceneNodeData) instead of LLM-generated ones, then lets the engine
 * run the remaining stages unattended in auto mode.
 *
 * Mock strategy (mirrors branch-pipeline.test.ts / create-pipeline.test.ts):
 *   - credits.js + queue.js are mocked so we assert the estimate flows through
 *     the reservation and the enqueue happens with reason:'initial'.
 *   - @nodaro/shared schemas run REAL (fixtures below are valid ShowrunnerPlan /
 *     SceneNodeData) so schema-rejection (test 3) is genuine.
 *   - prompt-registry runs REAL — src/test/setup.ts registers the fixture prompt
 *     table for every test file, so pipelinePromptsAvailable() returns true.
 *   - An in-memory Supabase mock captures .insert()/.delete() payloads by table.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { OWNER_ID, VICTIM_JOB_ID, ownerUrl, useStorageHost, victimUrl, withStorageOwnerTables } from "../../../test/storage-owner-tables.js"

// ---------------------------------------------------------------------------
// Hoisted mocks (credits + queue)
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  estimateUpfrontCredits: vi.fn<(args: unknown) => number>(),
  reservePipelineCredits:
    vi.fn<(args: unknown) => Promise<{ ok: true; usageLogId: string } | { ok: false; reason: string }>>(),
  enqueuePipelineRun: vi.fn<(data: unknown) => Promise<void>>(),
  refundPipelineCredits: vi.fn<(args: unknown) => Promise<void>>(),
}))

vi.mock("../credits.js", () => ({
  estimateUpfrontCredits: mocks.estimateUpfrontCredits,
  reservePipelineCredits: mocks.reservePipelineCredits,
  refundPipelineCredits: mocks.refundPipelineCredits,
}))

vi.mock("../queue.js", () => ({
  enqueuePipelineRun: mocks.enqueuePipelineRun,
}))

import {
  createSeededPipeline,
  SeedConsistencyError,
  type SeededPipelineInput,
} from "../seed-pipeline.js"

// ---------------------------------------------------------------------------
// In-memory Supabase mock — captures inserts/deletes keyed by table.
// ---------------------------------------------------------------------------

interface Fixture {
  pipelinesInserted: Array<Record<string, unknown>>
  pipelinesDeleted: Array<{ column: string; value: unknown }>
  stagesInserted: Array<Record<string, unknown>>
  entitiesInserted: Array<Record<string, unknown>>
}

function makeSupabaseMock(opts: {
  newPipelineId?: string
  pipelineInsertError?: { message: string }
  stagesInsertError?: { message: string }
  entitiesInsertError?: { message: string }
  /** asset id → its owner, for the up-front owner check of scene asset ids. */
  assetOwners?: Record<string, string>
  assetsReadFails?: boolean
} = {}): { client: never; fixture: Fixture } {
  const fixture: Fixture = {
    pipelinesInserted: [],
    pipelinesDeleted: [],
    stagesInserted: [],
    entitiesInserted: [],
  }
  const newPipelineId = opts.newPipelineId ?? "seeded-pipeline-id"

  const client = {
    from(table: string) {
      if (table === "pipelines") {
        return {
          insert: (row: Record<string, unknown>) => {
            fixture.pipelinesInserted.push(row)
            return {
              select: (_cols: string) => ({
                single: async () => ({
                  data: opts.pipelineInsertError ? null : { id: newPipelineId },
                  error: opts.pipelineInsertError ?? null,
                }),
              }),
            }
          },
          delete: () => ({
            eq: async (column: string, value: unknown) => {
              fixture.pipelinesDeleted.push({ column, value })
              return { error: null }
            },
          }),
        }
      }
      if (table === "pipeline_stages") {
        return {
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            fixture.stagesInserted.push(...arr)
            return Promise.resolve({ error: opts.stagesInsertError ?? null })
          },
        }
      }
      if (table === "pipeline_entities") {
        return {
          insert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            fixture.entitiesInserted.push(...arr)
            return Promise.resolve({ error: opts.entitiesInsertError ?? null })
          },
        }
      }
      if (table === "assets") {
        // ownedAssetUrlsById: `.select("id, r2_url").in("id", ids).eq("user_id", owner)`.
        return {
          select: (_cols: string) => ({
            in: (_col: string, ids: string[]) => ({
              eq: async (_col2: string, owner: string) =>
                opts.assetsReadFails
                  ? { data: null, error: { message: "timeout" } }
                  : {
                      data: ids
                        .filter((id) => opts.assetOwners?.[id] === owner)
                        .map((id) => ({ id, r2_url: `https://r2/${id}.png` })),
                      error: null,
                    },
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
  }

  return { client: client as unknown as never, fixture }
}

// ---------------------------------------------------------------------------
// Fixtures — valid ShowrunnerPlan + SceneNodeData (parsed by REAL schemas).
// ---------------------------------------------------------------------------

function makeSceneSpec(sceneIndex: number, overrides: Record<string, unknown> = {}): unknown {
  return {
    scene_index: sceneIndex,
    description: `Scene ${sceneIndex} description`,
    emotional_beat: "setup",
    duration_seconds: 6,
    cast_keys: ["hero"],
    location_key: "forest",
    object_keys: ["sword"],
    narration: null,
    continuity_from_prev: "hard_cut",
    shot_count_hint: 2,
    ...overrides,
  }
}

function makePlan(overrides: Record<string, unknown> = {}): unknown {
  return {
    title: "Test Film",
    logline: "A short test film.",
    target_duration_seconds: 20,
    format: "short_film",
    output_resolution: "1080p",
    language: "en",
    genre: "drama",
    tone: ["tense"],
    cast: [
      {
        key: "hero",
        name: "Hero",
        role: "protagonist",
        visual_description: "a lone hero",
        voice_profile: "deep, steady",
        has_dialogue: true,
        angle_count_hint: 3,
      },
    ],
    locations: [{ key: "forest", name: "Forest", visual_description: "a dense forest" }],
    objects: [
      {
        key: "sword",
        name: "Sword",
        visual_description: "a gleaming sword",
        narrative_significance: "the hero's weapon",
      },
    ],
    scenes: [makeSceneSpec(1), makeSceneSpec(2), makeSceneSpec(3)],
    beats: [{ type: "hook", scene_indices: [1] }],
    has_narrator: false,
    narrator_profile: null,
    music_plan: { mood: "tense", bpm_target: 120, genre_hints: ["orchestral"] },
    global_style: {
      visual_style: "cinematic",
      color_palette: "muted greens",
      lighting: "low-key",
      camera_language: "handheld",
    },
    total_duration_seconds: 20,
    estimated_scene_count: 3,
    warnings: [],
    ...overrides,
  }
}

function makeSceneNodeData(sceneIndex: number): unknown {
  return {
    scene_index: sceneIndex,
    description: `Scene ${sceneIndex}`,
    emotional_beat: "setup",
    duration_seconds: 6,
    shot_input_mode: "first_frame",
    cast_keys: ["hero"],
    location_key: "forest",
    object_keys: ["sword"],
    continuity_from_prev: "hard_cut",
    image_model: "seedream",
    video_model: "veo3",
    shots: [
      {
        shot_id: "shot_01",
        camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
        shot_intensity_kind: "establishing_shot",
        action: "The hero stands.",
        dialogue_line: null,
        duration_seconds: 4,
        motion_prompt: "slow push in",
        start_state: "hero at rest",
        end_state: "hero alert",
        continuity_with_previous: null,
        shot_intent: {},
        visual_keyframe_prompt: "A hero stands in a forest at dawn",
      },
    ],
  }
}

function makeInput(overrides: Partial<SeededPipelineInput> = {}): SeededPipelineInput {
  return {
    userId: "user-1",
    workflowId: "workflow-1",
    rootNodeId: "root-1",
    inputPrompt: "Seeded: A short test film",
    plan: makePlan(),
    config: {},
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  mocks.estimateUpfrontCredits.mockReturnValue(42)
  mocks.reservePipelineCredits.mockResolvedValue({ ok: true, usageLogId: "usage-1" })
  mocks.enqueuePipelineRun.mockResolvedValue(undefined)
  mocks.refundPipelineCredits.mockResolvedValue(undefined)
})

describe("createSeededPipeline", () => {
  it("happy path (plan only): inserts an auto/queued pipeline + a single approved script stage, reserves the estimate, enqueues initial", async () => {
    const { client, fixture } = makeSupabaseMock()

    const result = await createSeededPipeline(client, makeInput())

    // pipelines row: auto mode, queued, plan-derived attributes.
    expect(fixture.pipelinesInserted).toHaveLength(1)
    const pipeline = fixture.pipelinesInserted[0]!
    expect(pipeline.mode).toBe("auto")
    expect(pipeline.status).toBe("queued")
    expect(pipeline.format).toBe("short_film")
    expect(pipeline.target_duration_seconds).toBe(20)
    expect(pipeline.language).toBe("en")
    expect(pipeline.output_resolution).toBe("1080p")
    expect(pipeline.user_id).toBe("user-1")
    expect(pipeline.input_prompt).toBe("Seeded: A short test film")
    expect(pipeline.upfront_credit_estimate).toBe(42)
    expect(pipeline.reserved_credits).toBe(42)

    // Exactly one stage row: an approved script stage carrying { plan }.
    expect(fixture.stagesInserted).toHaveLength(1)
    const script = fixture.stagesInserted[0]!
    expect(script.stage_name).toBe("script")
    expect(script.stage_order).toBe(1)
    expect(script.status).toBe("approved")
    expect((script.output as { plan?: unknown }).plan).toBeDefined()

    // No scene entities on the plan-only path.
    expect(fixture.entitiesInserted).toHaveLength(0)

    // Reserved with the estimate, enqueued with reason:'initial'.
    expect(mocks.reservePipelineCredits).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1", pipelineId: "seeded-pipeline-id", credits: 42 }),
    )
    expect(mocks.enqueuePipelineRun).toHaveBeenCalledWith({
      pipelineId: "seeded-pipeline-id",
      userId: "user-1",
      reason: "initial",
    })

    expect(result).toEqual({ pipelineId: "seeded-pipeline-id", reservedCredits: 42 })
  })

  it("happy path (plan + scenes): pre-inserts pending entity stages (2-4), an approved shot_list (5), and one approved scene entity per scene", async () => {
    const { client, fixture } = makeSupabaseMock()

    await createSeededPipeline(
      client,
      makeInput({
        scenes: [
          { sceneIndex: 1, sceneNodeData: makeSceneNodeData(1) },
          { sceneIndex: 2, sceneNodeData: makeSceneNodeData(2) },
          { sceneIndex: 3, sceneNodeData: makeSceneNodeData(3) },
        ],
      }),
    )

    const byName = new Map(fixture.stagesInserted.map((s) => [s.stage_name, s]))

    // Pre-inserted pending rows so the engine walk can't skip entity generation.
    for (const [name, order] of [
      ["characters", 2],
      ["objects", 3],
      ["locations", 4],
    ] as const) {
      const row = byName.get(name)
      expect(row, `expected a ${name} stage row`).toBeDefined()
      expect(row!.status).toBe("pending")
      expect(row!.stage_order).toBe(order)
    }

    // script (1, approved) + shot_list (5, approved).
    expect(byName.get("script")!.status).toBe("approved")
    expect(byName.get("script")!.stage_order).toBe(1)
    const shotList = byName.get("shot_list")!
    expect(shotList.status).toBe("approved")
    expect(shotList.stage_order).toBe(5)

    // Exactly the 5 seeded stage rows — nothing downstream of shot_list.
    expect(fixture.stagesInserted).toHaveLength(5)

    // One approved scene entity per scene, keyed scene_01/02/03, carrying scene_node_data.
    expect(fixture.entitiesInserted).toHaveLength(3)
    const keys = fixture.entitiesInserted.map((e) => e.entity_key)
    expect(keys).toEqual(["scene_01", "scene_02", "scene_03"])
    for (const entity of fixture.entitiesInserted) {
      expect(entity.entity_type).toBe("scene")
      expect(entity.status).toBe("approved")
      const metadata = entity.metadata as { scene_node_data?: unknown }
      expect(metadata.scene_node_data).toBeDefined()
    }
  })

  it("throws and inserts nothing when the plan fails ShowrunnerPlanSchema", async () => {
    const { client, fixture } = makeSupabaseMock()

    await expect(
      createSeededPipeline(client, makeInput({ plan: { not: "a valid plan" } })),
    ).rejects.toThrow()

    expect(fixture.pipelinesInserted).toHaveLength(0)
    expect(fixture.stagesInserted).toHaveLength(0)
    expect(fixture.entitiesInserted).toHaveLength(0)
    expect(mocks.reservePipelineCredits).not.toHaveBeenCalled()
    expect(mocks.enqueuePipelineRun).not.toHaveBeenCalled()
  })

  it("throws SeedConsistencyError listing unresolved keys when a scene references a cast key absent from the plan", async () => {
    const { client, fixture } = makeSupabaseMock()

    const plan = makePlan({
      scenes: [
        makeSceneSpec(1, { cast_keys: ["ghost"] }),
        makeSceneSpec(2),
        makeSceneSpec(3),
      ],
    })

    await expect(
      createSeededPipeline(client, makeInput({ plan })),
    ).rejects.toThrow(SeedConsistencyError)
    await expect(
      createSeededPipeline(client, makeInput({ plan })),
    ).rejects.toThrow(/ghost/)

    expect(fixture.pipelinesInserted).toHaveLength(0)
    expect(mocks.reservePipelineCredits).not.toHaveBeenCalled()
  })

  it("throws SeedConsistencyError when seeded scene indices don't cover the plan's scenes exactly", async () => {
    const { client, fixture } = makeSupabaseMock()

    // Plan has scenes 1,2,3 — seed supplies only 1,2 (missing 3).
    await expect(
      createSeededPipeline(
        client,
        makeInput({
          scenes: [
            { sceneIndex: 1, sceneNodeData: makeSceneNodeData(1) },
            { sceneIndex: 2, sceneNodeData: makeSceneNodeData(2) },
          ],
        }),
      ),
    ).rejects.toThrow(SeedConsistencyError)

    expect(fixture.pipelinesInserted).toHaveLength(0)
    expect(fixture.stagesInserted).toHaveLength(0)
  })

  describe("a seeded scene names only the caller's assets (decided 2026-10-07)", () => {
    const OWN = "a5000000-0000-4000-8000-000000000001"
    const FOREIGN = "a5000000-0000-4000-8000-000000000002"
    function scenesWith(shotFields: Record<string, unknown>) {
      return [1, 2, 3].map((i) => {
        const snd = makeSceneNodeData(i) as { shots: Array<Record<string, unknown>> }
        return {
          sceneIndex: i,
          sceneNodeData: i === 2 ? { ...snd, shots: [{ ...snd.shots[0], ...shotFields }] } : snd,
        }
      })
    }

    it("attacker: a shot keyframe naming another user's asset is refused before any row or reservation", async () => {
      // The scene would otherwise be inserted after the credits are reserved,
      // where migration 480's trigger refuses it and leaves the reservation held.
      const { client, fixture } = makeSupabaseMock({ assetOwners: { [FOREIGN]: "victim", [OWN]: "user-1" } })

      await expect(
        createSeededPipeline(client, makeInput({ scenes: scenesWith({ keyframe_asset_id: FOREIGN }) })),
      ).rejects.toThrow(SeedConsistencyError)

      expect(fixture.pipelinesInserted).toHaveLength(0)
      expect(fixture.entitiesInserted).toHaveLength(0)
      expect(mocks.reservePipelineCredits).not.toHaveBeenCalled()
    })

    it("the caller's own asset ids pass", async () => {
      const { client, fixture } = makeSupabaseMock({ assetOwners: { [OWN]: "user-1" } })

      await createSeededPipeline(
        client,
        makeInput({ scenes: scenesWith({ keyframe_asset_id: OWN, keyframe_url: "https://r2/own.png" }) }),
      )

      const scene2 = fixture.entitiesInserted.find((e) => e.entity_key === "scene_02")
      expect(
        (scene2?.metadata as { scene_node_data: { shots: Array<Record<string, unknown>> } }).scene_node_data.shots[0]
          ?.keyframe_asset_id,
      ).toBe(OWN)
    })

    it("a failed owner lookup fails the seed before any row is written (it is not a refusal)", async () => {
      const { client, fixture } = makeSupabaseMock({ assetsReadFails: true })

      const err = await createSeededPipeline(
        client,
        makeInput({ scenes: scenesWith({ keyframe_asset_id: OWN }) }),
      ).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(Error)
      expect(err).not.toBeInstanceOf(SeedConsistencyError)
      expect(fixture.pipelinesInserted).toHaveLength(0)
      expect(mocks.reservePipelineCredits).not.toHaveBeenCalled()
    })
  })

  describe("a seeded scene names only the caller's storage urls (decided 2026-10-07; migration 482)", () => {
    let restoreHost: () => void
    beforeEach(() => {
      restoreHost = useStorageHost()
    })
    afterEach(() => restoreHost())

    function scenesWith(shotFields: Record<string, unknown>) {
      return [1, 2, 3].map((i) => {
        const snd = makeSceneNodeData(i) as { shots: Array<Record<string, unknown>> }
        return {
          sceneIndex: i,
          sceneNodeData: i === 2 ? { ...snd, shots: [{ ...snd.shots[0], ...shotFields }] } : snd,
        }
      })
    }

    it("attacker: a keyframe url another user made is refused before any row or reservation", async () => {
      const { client, fixture } = makeSupabaseMock()
      await expect(
        createSeededPipeline(
          withStorageOwnerTables(client as object) as never,
          makeInput({ userId: OWNER_ID, scenes: scenesWith({ keyframe_url: victimUrl() }) }),
        ),
      ).rejects.toThrow(SeedConsistencyError)
      expect(fixture.pipelinesInserted).toHaveLength(0)
      expect(fixture.entitiesInserted).toHaveLength(0)
      expect(mocks.reservePipelineCredits).not.toHaveBeenCalled()
    })

    it("attacker: a url on any host whose path names another user's job is refused before any row (482 judges every host)", async () => {
      const { client, fixture } = makeSupabaseMock()
      await expect(
        createSeededPipeline(
          withStorageOwnerTables(client as object) as never,
          makeInput({ userId: OWNER_ID, scenes: scenesWith({ keyframe_url: `https://example.com/x/${VICTIM_JOB_ID}.png` }) }),
        ),
      ).rejects.toThrow(SeedConsistencyError)
      expect(fixture.pipelinesInserted).toHaveLength(0)
      expect(mocks.reservePipelineCredits).not.toHaveBeenCalled()
    })

    it("the caller's own urls and external urls pass", async () => {
      const { client, fixture } = makeSupabaseMock()
      await createSeededPipeline(
        withStorageOwnerTables(client as object) as never,
        makeInput({
          userId: OWNER_ID,
          scenes: scenesWith({ keyframe_url: ownerUrl(), video_url: "https://provider.example/clip.mp4" }),
        }),
      )
      const scene2 = fixture.entitiesInserted.find((e) => e.entity_key === "scene_02")
      expect(
        (scene2?.metadata as { scene_node_data: { shots: Array<Record<string, unknown>> } }).scene_node_data.shots[0]
          ?.keyframe_url,
      ).toBe(ownerUrl())
    })
  })

  it("deletes the pipelines row and propagates when the credit reservation fails", async () => {
    const { client, fixture } = makeSupabaseMock()
    mocks.reservePipelineCredits.mockResolvedValueOnce({ ok: false, reason: "insufficient_credits" })

    await expect(createSeededPipeline(client, makeInput())).rejects.toThrow()

    // The row was inserted, then rolled back — mirrors createPipeline's cleanup.
    expect(fixture.pipelinesInserted).toHaveLength(1)
    expect(fixture.pipelinesDeleted).toEqual([{ column: "id", value: "seeded-pipeline-id" }])
    // Nothing downstream of the failed reservation.
    expect(fixture.stagesInserted).toHaveLength(0)
    expect(fixture.entitiesInserted).toHaveLength(0)
    expect(mocks.enqueuePipelineRun).not.toHaveBeenCalled()
  })

  // Review round (decided 2026-10-07): a failure AFTER the reservation used to
  // leave the credits held on a pipeline with no scenes that was never queued.
  for (const [what, opts] of [
    ["the scene entity insert", { entitiesInsertError: { message: "refused by trigger" } }],
    ["the stage rows insert", { stagesInsertError: { message: "boom" } }],
  ] as const) {
    it(`refunds the reservation, then deletes the pipelines row, when ${what} fails`, async () => {
      const { client, fixture } = makeSupabaseMock(opts)
      const order: string[] = []
      mocks.refundPipelineCredits.mockImplementationOnce(async () => {
        order.push(`refund:${fixture.pipelinesDeleted.length}`)
      })
      await expect(
        createSeededPipeline(client, makeInput({ scenes: [1, 2, 3].map((i) => ({ sceneIndex: i, sceneNodeData: makeSceneNodeData(i) })) })),
      ).rejects.toThrow()
      expect(mocks.refundPipelineCredits).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1", pipelineId: "seeded-pipeline-id" }),
      )
      // Refund first: it reads the reservation link from the pipelines row.
      expect(order).toEqual(["refund:0"])
      expect(fixture.pipelinesDeleted).toEqual([{ column: "id", value: "seeded-pipeline-id" }])
      expect(mocks.enqueuePipelineRun).not.toHaveBeenCalled()
    })
  }

  it("refunds and deletes when the enqueue fails", async () => {
    const { client, fixture } = makeSupabaseMock()
    mocks.enqueuePipelineRun.mockRejectedValueOnce(new Error("redis down"))
    await expect(createSeededPipeline(client, makeInput())).rejects.toThrow(/redis down/)
    expect(mocks.refundPipelineCredits).toHaveBeenCalledTimes(1)
    expect(fixture.pipelinesDeleted).toEqual([{ column: "id", value: "seeded-pipeline-id" }])
  })

  it("does not refund when the reservation itself failed (nothing was held)", async () => {
    const { client } = makeSupabaseMock()
    mocks.reservePipelineCredits.mockResolvedValueOnce({ ok: false, reason: "insufficient_credits" })
    await expect(createSeededPipeline(client, makeInput())).rejects.toThrow()
    expect(mocks.refundPipelineCredits).not.toHaveBeenCalled()
  })

  it("generates and stores a root_node_id when none is supplied", async () => {
    const { client, fixture } = makeSupabaseMock()

    await createSeededPipeline(client, makeInput({ rootNodeId: undefined }))

    const rootNodeId = fixture.pipelinesInserted[0]!.root_node_id
    expect(typeof rootNodeId).toBe("string")
    expect(rootNodeId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })
})
