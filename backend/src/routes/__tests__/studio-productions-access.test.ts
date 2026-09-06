import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { serializeProduction, type Shot, type TrashedItem } from "@nodaro/studio-production"

/**
 * `GET /v1/studio/productions/:id` read by somebody who is NOT the owner.
 *
 * `loadWorkflowFor(..., "view")` admits a reader the access seam grants `view`
 * on — a collaborator, a workspace member. What comes back must then be the
 * same projection the public share read gives (D12): `settings.studio` carries
 * the owner's RECYCLE BIN beside the film, and the bin holds every shot, still
 * and clip they deleted, prompts and urls intact. Handing that to a viewer
 * hands out exactly the work its owner threw away.
 *
 * The strip list is `@nodaro/studio-production`'s own
 * (`stripTransientSettings`), the same one `GET /v1/public/workflows/:id` uses,
 * so the two reads cannot disagree about what "transient" means.
 */

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }))

vi.mock("@/lib/config.js", () => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "x",
    SUPABASE_SERVICE_ROLE_KEY: "x",
    STUDIO_PRODUCTIONS_API: true,
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
  // The access seam only answers `view` where organizations are switched on;
  // without them the only answers are `own` and `none`.
  hasOrganizations: () => true,
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
  loadPrivatePlugins: vi.fn(),
}))

import { studioProductionRoutes } from "../studio-productions.js"
import { supabase } from "../../lib/supabase.js"
import { getPluginServices } from "../../lib/private-plugins/load.js"

const CREATOR = "00000000-0000-4000-8000-000000000001"
const VIEWER = "00000000-0000-4000-8000-0000000000ff"
const PRODUCTION = "00000000-0000-4000-8000-000000000020"
const WORKSPACE = "00000000-0000-4000-8000-000000000030"

function shots(): Shot[] {
  return [
    {
      id: "shot-1",
      still: {
        nodeId: "generate-image-a",
        url: "https://r2/a1.png",
        provider: "flux-2",
        prompt: "a lighthouse at dawn",
      },
    },
  ]
}

/** What the owner deleted — the sharpest thing in the document. */
const TRASH: TrashedItem[] = [
  {
    kind: "still",
    id: "t-1",
    shotId: "shot-1",
    index: 0,
    deletedAt: "2026-09-06T09:00:00Z",
    stillBase: { nodeId: "generate-image-a", provider: "flux-2", prompt: "a lighthouse" },
    result: { url: "https://r2/deleted.png", jobId: "job-gone", prompt: "the one they scrapped" },
  },
]

/** A production that lives in a workspace, written by the real writer. */
function row() {
  const graph = serializeProduction(
    shots(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    TRASH,
  )
  return {
    id: PRODUCTION,
    user_id: CREATOR,
    workspace_id: WORKSPACE,
    visibility: "workspace",
    name: "Class work",
    thumbnail_url: null,
    version: 3,
    nodes: graph.nodes,
    edges: graph.edges,
    settings: { studio: graph.settings.studio },
    updated_at: "2026-09-06T10:00:00Z",
  }
}

/** An organizations plugin that answers exactly one access level. */
function plugin(level: "own" | "edit" | "view") {
  vi.mocked(getPluginServices).mockReturnValue({
    orgs: {
      workflowAccess: vi.fn().mockResolvedValue(level),
      workflowAccessFromRow: vi.fn().mockResolvedValue(level),
      canDeleteWorkflow: vi.fn().mockResolvedValue(false),
      canRunWorkflow: vi.fn().mockResolvedValue(false),
      canChangeWorkflowVisibility: vi.fn().mockResolvedValue(false),
      canShareWorkflow: vi.fn().mockResolvedValue(false),
    },
  } as never)
}

let app: FastifyInstance
let updated: Record<string, unknown> | undefined

function workflowRow(data: Record<string, unknown>) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  vi.mocked(supabase.from).mockReturnValue({ select } as never)
}

const ENTITY_TABLES = ["characters", "locations", "objects", "creatures"]

/** `.select().order().limit()` then `entityOwnerFilter`'s `.eq().is()`. */
function entityChain() {
  const is = vi.fn().mockResolvedValue({ data: [], error: null })
  const eq = vi.fn().mockReturnValue({ is })
  const limit = vi.fn().mockReturnValue({ eq })
  const order = vi.fn().mockReturnValue({ limit })
  const select = vi.fn().mockReturnValue({ order })
  return { select }
}

/** Append one scene to the row above as `userId`, capturing what was written. */
async function importAs(userId: string) {
  const current = row()
  updated = undefined
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (ENTITY_TABLES.includes(table)) return entityChain() as never
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: current, error: null }),
      }),
      // The `select` that follows the `update` — the row as it now stands.
      maybeSingle: vi.fn(async () => ({ data: { ...current, ...updated }, error: null })),
    })
    const update = vi.fn((payload: Record<string, unknown>) => {
      updated = payload
      return { eq: vi.fn().mockReturnValue({ select }) }
    })
    return { select, update } as never
  }) as never)

  return app.inject({
    method: "POST",
    url: `/v1/studio/productions/${PRODUCTION}/import`,
    headers: { "x-user-id": userId },
    payload: {
      plan: {
        format: "nodaro-studio-production",
        version: 2,
        scenes: [{ frame: { prompt: "the lighthouse, seen from the water" } }],
      },
      mode: "append",
    },
  })
}

async function get(userId: string) {
  return app.inject({
    method: "GET",
    url: `/v1/studio/productions/${PRODUCTION}?detail=full`,
    headers: { "x-user-id": userId },
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  app = Fastify({ logger: false })
  app.addHook("onRequest", async (req) => {
    req.orgs = async () => ({ organizations: [], workspaces: [] })
  })
  app.addHook("preHandler", async (req) => {
    const h = req.headers["x-user-id"]
    if (typeof h === "string") req.userId = h
  })
  await app.register(async (i) => {
    await studioProductionRoutes(i)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

describe("GET /v1/studio/productions/:id — a reader who is not the owner", () => {
  it("gives the owner their bin", async () => {
    plugin("own")
    workflowRow(row())
    const res = await get(CREATOR)

    expect(res.statusCode).toBe(200)
    const trash = res.json().data.production.trash as { count: number; items: unknown[] }
    expect(trash.count).toBe(1)
    expect(trash.items).toHaveLength(1)
  })

  it("gives a `view` reader the film and none of the bin", async () => {
    plugin("view")
    workflowRow(row())
    const res = await get(VIEWER)

    expect(res.statusCode).toBe(200)
    const production = res.json().data.production
    expect(production.trash).toEqual({ count: 0, items: [] })
    // Everything the reader is meant to see survives untouched.
    expect(production.shots).toHaveLength(1)
    expect(production.shots[0].still.activeUrl).toBe("https://r2/a1.png")
  })

  it("strips for an `edit` collaborator too — only the OWNER's own read is whole", async () => {
    plugin("edit")
    workflowRow(row())
    const res = await get(VIEWER)
    expect(res.json().data.production.trash).toEqual({ count: 0, items: [] })
  })

  it("an append by a collaborator answers stripped and STORES the bin intact", async () => {
    // The strip is a projection on the way out. A collaborator who cannot read
    // the bin must not delete it either — the write is assembled from the
    // stored row, never from what they were shown.
    plugin("edit")
    const res = await importAs(VIEWER)

    expect(res.statusCode).toBe(200)
    expect(res.json().data.production.trash).toEqual({ count: 0, items: [] })
    expect((updated?.settings as { studio: { trash: unknown[] } }).studio.trash).toHaveLength(1)
  })
})
