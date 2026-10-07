/**
 * A scene's storage urls reach a provider or an LLM only when they are the
 * pipeline owner's objects (decided 2026-10-07; migration 482).
 *
 * Two routes forward a stored scene's urls: the clip editor's re-animate
 * (the shot's keyframe is the video model's start frame) and the scene helper
 * LLMs (keyframes and last frames sent to vision critics and image
 * regeneration). A url on our storage that another user made, planted before
 * 482, is dropped from what they forward — and the stored scene keeps it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify from "fastify"

vi.mock("../../lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/config.js")>()),
  hasCredits: vi.fn(() => true),
  hasAdmin: vi.fn(() => true),
  isCommunity: vi.fn(() => false),
}))
vi.mock("../../middleware/credit-guard.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../middleware/credit-guard.js")>()),
  paygSurfaceSpendHook: () => async () => undefined,
}))
vi.mock("../../ee/pipelines/pipeline-payer.js", () => ({
  getPipelineBillingContext: vi.fn(async (_sb: unknown, _pid: string, userId: string) => ({ payer: "user", userId })),
  stampPipelineConfig: vi.fn((cfg: Record<string, unknown> | null | undefined) => cfg ?? {}),
}))
vi.mock("../../ee/pipelines/scene-helper-credits.js", () => ({
  reserveHelperCredits: vi.fn(async () => ({ ok: true, usageLogId: "log-1" })),
  refundHelperCredits: vi.fn(async () => undefined),
}))
vi.mock("../../ee/pipelines/llms/helpers/fix-continuity.js", () => ({
  runFixContinuity: vi.fn(async () => ({ ok: true })),
}))
vi.mock("../../ee/pipelines/services/pipeline-animate-shot.js", () => ({
  pipelineAnimateShot: vi.fn(async () => ({ assetUrl: "https://media.test/videos/new-clip.mp4" })),
}))
vi.mock("../../ee/pipelines/continuity.js", () => ({
  allocateReferenceSlots: vi.fn(async () => []),
}))
vi.mock("../../ee/pipelines/queue.js", () => ({ enqueuePipelineRun: vi.fn(async () => undefined) }))
vi.mock("../../ee/pipelines/events.js", () => ({
  pipelineEvents: { publish: vi.fn(), subscribe: vi.fn(() => () => undefined) },
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
      insert: async () => ({ data: null, error: null }),
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

import { pipelineAnimateShot } from "../../ee/pipelines/services/pipeline-animate-shot.js"
import { runFixContinuity } from "../../ee/pipelines/llms/helpers/fix-continuity.js"
import { pipelinesRoutes } from "../pipelines.js"
import { sceneHelpersRoutes } from "../scene-helpers.js"
import {
  OWNER_ID,
  STORAGE_OWNER_ROWS,
  VICTIM_JOB_ID,
  ownerUrl,
  useStorageHost,
  victimUrl,
} from "../../test/storage-owner-tables.js"

const PIPELINE = "00000000-0000-4000-8000-000000000511"
const SCENE = "00000000-0000-4000-8000-000000000512"

function shot(id: string, fields: Row): Row {
  return {
    shot_id: id,
    camera: { shot_type: "wide", angle: "eye_level", motion: "static" },
    shot_intent: { needs_multishot_reference: false, is_loopable: false, needs_music_suppression: true, is_match_cut: false },
    duration_seconds: 4,
    ...fields,
  }
}

function seed(): void {
  db.updates = []
  db.tables = {
    pipelines: [{ id: PIPELINE, user_id: OWNER_ID }],
    pipeline_stages: [{ pipeline_id: PIPELINE, stage_name: "script", output: { plan: { cast: [], locations: [], objects: [] } } }],
    pipeline_entities: [
      {
        id: SCENE,
        pipeline_id: PIPELINE,
        entity_type: "scene",
        stage_id: "stage-5",
        metadata: {
          scene_node_data: {
            scene_index: 1,
            video_model: "kling",
            cast_keys: [],
            shots: [
              // Planted before 482: the victim's generated image as keyframe
              // and as the last frame the next shot continues from.
              shot("s1", { keyframe_url: victimUrl(), last_frame_url: victimUrl() }),
              shot("s2", { keyframe_url: ownerUrl() }),
            ],
          },
        },
      },
    ],
    jobs: STORAGE_OWNER_ROWS.jobs.map((r) => ({ ...r })),
    assets: [],
  }
}

async function app(routes: typeof pipelinesRoutes) {
  const a = Fastify({ logger: false })
  a.addHook("preHandler", async (req) => {
    ;(req as unknown as { userId: string }).userId = OWNER_ID
  })
  await a.register(routes)
  await a.ready()
  return a
}

let restoreHost: () => void
beforeEach(() => {
  vi.clearAllMocks()
  restoreHost = useStorageHost()
  seed()
})
afterEach(() => restoreHost())

describe("POST …/shots/:shot_id/reanimate — the start frame is the owner's", () => {
  it("attacker: a keyframe url another user made is not sent as the start frame", async () => {
    const a = await app(pipelinesRoutes)
    const res = await a.inject({ method: "POST", url: `/v1/pipelines/${PIPELINE}/scenes/${SCENE}/shots/s1/reanimate` })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("shot_missing_keyframe")
    expect(pipelineAnimateShot).not.toHaveBeenCalled()
    await a.close()
  })

  it("the owner's keyframe is sent, and the stored scene keeps every other shot as it was", async () => {
    const a = await app(pipelinesRoutes)
    const res = await a.inject({ method: "POST", url: `/v1/pipelines/${PIPELINE}/scenes/${SCENE}/shots/s2/reanimate` })
    expect(res.statusCode).toBe(200)
    const args = (pipelineAnimateShot as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      startFrameUrl: string
      sceneNodeData: unknown
    }
    expect(args.startFrameUrl).toBe(ownerUrl())
    expect(JSON.stringify(args.sceneNodeData)).not.toContain(VICTIM_JOB_ID)
    const written = db.updates.find((u) => u.table === "pipeline_entities")?.patch as {
      metadata: { scene_node_data: { shots: Row[] } }
    }
    expect(written.metadata.scene_node_data.shots[0]?.keyframe_url).toBe(victimUrl())
    expect(written.metadata.scene_node_data.shots[1]?.video_url).toBe("https://media.test/videos/new-clip.mp4")
    await a.close()
  })
})

describe("POST …/helpers/:name — a helper LLM is sent only the owner's urls", () => {
  it("attacker: fix_continuity never receives another user's keyframe or last frame", async () => {
    const a = await app(sceneHelpersRoutes)
    const res = await a.inject({
      method: "POST",
      url: `/v1/pipelines/${PIPELINE}/entities/${SCENE}/helpers/fix_continuity`,
      payload: { target_shot_id: "s2" },
    })
    expect(res.statusCode).toBe(200)
    const args = (runFixContinuity as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as { scene: { shots: Row[] } }
    expect(JSON.stringify(args.scene)).not.toContain(VICTIM_JOB_ID)
    expect(args.scene.shots[1]?.keyframe_url).toBe(ownerUrl())
    await a.close()
  })
})
