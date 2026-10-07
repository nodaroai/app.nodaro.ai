/**
 * A job's `pipeline_id` is a pointer (decided 2026-10-06; migration 480). Before
 * 474 a browser could insert its own job naming ANY pipeline, so a read from a
 * pipeline to its jobs asks for the pipeline owner's jobs only: another user's
 * row must not move the owner's progress bar.
 */
import { describe, it, expect, vi } from "vitest"
import Fastify from "fastify"

vi.mock("../../lib/config.js", () => ({
  hasCredits: vi.fn(() => true),
  hasAdmin: vi.fn(() => true),
  isCommunity: vi.fn(() => false),
}))

// P14: the pipeline payer read — personal stub in these worlds.
vi.mock("../../ee/pipelines/pipeline-payer.js", () => ({
  getPipelineBillingContext: vi.fn(async (_sb: unknown, _pid: string, userId: string) => ({ payer: "user", userId })),
  stampPipelineConfig: vi.fn((cfg: Record<string, unknown> | null | undefined, ctx?: unknown) => {
    const { billingContext: _forged, ...rest } = cfg ?? {}
    return ctx ? { ...rest, billingContext: ctx } : rest
  }),
}))

vi.mock("../../ee/pipelines/queue.js", () => ({
  enqueuePipelineRun: vi.fn(async () => undefined),
}))

vi.mock("../../ee/pipelines/credits.js", () => ({
  estimateUpfrontCredits: vi.fn(() => 30),
  resolveMaxCostCredits: vi.fn(() => 2000),
  reservePipelineCredits: vi.fn(async () => ({ ok: true, usageLogId: "ul-1" })),
  refundPipelineCredits: vi.fn(async () => undefined),
}))

vi.mock("../../ee/pipelines/engine.js", () => ({
  approveStage: vi.fn(async () => ({ ok: true })),
  approveScriptStage: vi.fn(async () => ({ ok: true })),
  rejectScriptStage: vi.fn(async () => ({ ok: true })),
}))

vi.mock("../../ee/pipelines/entity-approval.js", () => ({
  approveEntityCore: vi.fn(async () => undefined),
  approveEntity: vi.fn(async () => ({ ok: true })),
  rejectEntity: vi.fn(async () => ({ ok: true })),
}))

vi.mock("../../ee/pipelines/entity-description.js", () => ({
  approveDescriptionLlmOrEdited: vi.fn(async () => ({ ok: true, newStatus: "pending" })),
  attachUploadedImageToEntity: vi.fn(async () => ({
    ok: true,
    newStatus: "approved",
    assetId: "asset-uuid-1",
  })),
  skipEntity: vi.fn(async () => ({ ok: true })),
}))

vi.mock("../../ee/pipelines/events.js", () => ({
  pipelineEvents: {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
  },
}))


type Row = Record<string, unknown>
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, updates: [] as Array<{ table: string; patch: Row }> }))

vi.mock("../../lib/supabase.js", () => {
  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = []
    const rows = () => (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
    let patch: Row | null = null
    const chain: Record<string, unknown> = {
      select: () => chain,
      update: (p: Row) => {
        patch = p
        return chain
      },
      limit: () => chain,
      eq: (col: string, v: unknown) => {
        filters.push((r) => r[col] === v)
        return chain
      },
      in: (col: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[col]))
        return chain
      },
      order: () => chain,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown) => {
        const hit = rows()
        if (patch) {
          db.updates.push({ table, patch })
          for (const r of hit) Object.assign(r, patch)
        }
        return Promise.resolve({ data: hit, error: null }).then(res)
      },
    }
    return chain
  }
  return { supabase: { from } }
})

import { IMAGE_CRITIC_UNRESOLVABLE } from "@nodaro/shared"
import { pipelinesRoutes } from "../pipelines.js"

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

const PIPELINE = "00000000-0000-4000-8000-000000000111"
const OWNER = "user-1"

describe("GET /v1/pipelines/:id/timeline — the pipeline's own jobs", () => {
  it("attacker: another user's job naming the pipeline does not count toward its progress", async () => {
    db.tables = {
      pipelines: [{ id: PIPELINE, user_id: OWNER, output_resolution: "720p" }],
      pipeline_entities: [
        {
          pipeline_id: PIPELINE,
          entity_type: "scene",
          metadata: { scene_node_data: { shots: [{ duration_seconds: 4 }, { duration_seconds: 4 }] } },
        },
      ],
      pipeline_stages: [],
      jobs: [
        { pipeline_id: PIPELINE, user_id: OWNER, job_type: "image-to-video", status: "pending", progress: 0 },
        // Planted: completed shots the pipeline never rendered.
        { pipeline_id: PIPELINE, user_id: "attacker", job_type: "image-to-video", status: "completed", progress: 100 },
        { pipeline_id: PIPELINE, user_id: "attacker", job_type: "image-to-video", status: "completed", progress: 100 },
      ],
    }
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      ;(req as unknown as { userId: string }).userId = OWNER
    })
    await app.register(pipelinesRoutes)
    await app.ready()

    const res = await app.inject({ method: "GET", url: `/v1/pipelines/${PIPELINE}/timeline` })

    expect(res.statusCode).toBe(200)
    expect(res.json().animateProgress).toEqual({ totalShots: 2, shotsDone: 0, percent: 0 })
    await app.close()
  })
})

describe("POST /v1/pipelines/:id/entities/:entity_id/force-approve-image-critic-failure — the owner's own asset", () => {
  it("attacker: another user's asset naming the entity is not adopted as its main image", async () => {
    const ENTITY = "00000000-0000-4000-8000-000000000222"
    db.updates = []
    db.tables = {
      pipelines: [{ id: PIPELINE, user_id: OWNER }],
      pipeline_entities: [
        {
          id: ENTITY,
          pipeline_id: PIPELINE,
          entity_type: "character",
          entity_key: "hero",
          status: "failed",
          metadata: { last_error: IMAGE_CRITIC_UNRESOLVABLE },
        },
      ],
      // Planted: an asset row of another user's, naming the owner's entity.
      // The mock returns rows in table order, so it would be "the latest".
      assets: [
        { id: aid("planted"), user_id: "attacker", pipeline_entity_id: ENTITY },
        { id: aid("own"), user_id: OWNER, pipeline_entity_id: ENTITY },
      ],
    }
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      ;(req as unknown as { userId: string }).userId = OWNER
    })
    await app.register(pipelinesRoutes)
    await app.ready()

    const res = await app.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE}/entities/${ENTITY}/force-approve-image-critic-failure`,
    })

    expect(res.statusCode).toBe(200)
    const adopted = db.updates.find((u) => u.table === "pipeline_entities")?.patch.main_asset_id
    expect(adopted).toBe(aid("own"))
    await app.close()
  })
})

describe("GET /v1/pipelines/:id/entities — an entity's main image is the owner's asset", () => {
  it("attacker: a main_asset_id naming another user's asset shows no image (decided 2026-10-07)", async () => {
    db.tables = {
      pipelines: [{ id: PIPELINE, user_id: OWNER }],
      pipeline_entities: [
        { id: "ent-own", pipeline_id: PIPELINE, entity_type: "character", entity_key: "hero", status: "approved", main_asset_id: aid("own"), created_at: "1" },
        // A pointer at another user's asset, written before migration 480.
        { id: "ent-planted", pipeline_id: PIPELINE, entity_type: "character", entity_key: "rival", status: "approved", main_asset_id: aid("foreign"), created_at: "2" },
      ],
      pipeline_entity_variants: [],
      assets: [
        { id: aid("own"), user_id: OWNER, r2_url: "https://r2/own.png" },
        { id: aid("foreign"), user_id: "victim", r2_url: "https://r2/victims-private.png" },
      ],
    }
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      ;(req as unknown as { userId: string }).userId = OWNER
    })
    await app.register(pipelinesRoutes)
    await app.ready()

    const res = await app.inject({ method: "GET", url: `/v1/pipelines/${PIPELINE}/entities?type=character` })

    expect(res.statusCode).toBe(200)
    const byId = new Map((res.json() as Array<Record<string, unknown>>).map((e) => [e.id, e]))
    expect(byId.get("ent-own")).toMatchObject({ main_asset_id: aid("own"), main_asset_url: "https://r2/own.png" })
    expect(byId.get("ent-planted")).toMatchObject({ main_asset_id: null, main_asset_url: null })
    expect(res.body).not.toContain("victims-private")
    await app.close()
  })
})

describe("GET /v1/pipelines/:id/entities — a variant's image is the owner's asset", () => {
  it("attacker: a variant asset_id naming another user's asset shows no id and no image (decided 2026-10-07)", async () => {
    db.tables = {
      pipelines: [{ id: PIPELINE, user_id: OWNER }],
      pipeline_entities: [
        { id: "ent-own", pipeline_id: PIPELINE, entity_type: "character", entity_key: "hero", status: "approved", main_asset_id: aid("own"), created_at: "1" },
      ],
      pipeline_entity_variants: [
        { entity_id: "ent-own", variant_key: "angle_profile", asset_id: aid("own-variant"), status: "approved" },
        // A pointer at another user's asset, written before migration 480.
        { entity_id: "ent-own", variant_key: "expression_smiling", asset_id: aid("foreign"), status: "approved" },
      ],
      assets: [
        { id: aid("own"), user_id: OWNER, r2_url: "https://r2/own.png" },
        { id: aid("own-variant"), user_id: OWNER, r2_url: "https://r2/own-variant.png" },
        { id: aid("foreign"), user_id: "victim", r2_url: "https://r2/victims-private.png" },
      ],
    }
    const app = Fastify({ logger: false })
    app.addHook("preHandler", async (req) => {
      ;(req as unknown as { userId: string }).userId = OWNER
    })
    await app.register(pipelinesRoutes)
    await app.ready()

    const res = await app.inject({ method: "GET", url: `/v1/pipelines/${PIPELINE}/entities?type=character` })

    expect(res.statusCode).toBe(200)
    const [hero] = res.json() as Array<{ variants: Array<Record<string, unknown>> }>
    const byKey = new Map(hero!.variants.map((v) => [v.variant_key, v]))
    expect(byKey.get("angle_profile")).toMatchObject({ asset_id: aid("own-variant"), asset_url: "https://r2/own-variant.png" })
    expect(byKey.get("expression_smiling")).toMatchObject({ asset_id: null, asset_url: null })
    expect(res.body).not.toContain(aid("foreign"))
    expect(res.body).not.toContain("victims-private")
    await app.close()
  })
})
