import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import { serializeProduction, type Cast, type Shot } from "@nodaro/studio-production"

/**
 * `POST /v1/studio/productions/:id/import` — appending a plan to a production
 * that already exists.
 *
 * The append is the only Phase-0 route that WRITES over a document somebody
 * else already owns, so the three things it must not do are all about what was
 * already there:
 *
 * 1. **It must not erase what the serializer does not know about.** `settings`
 *    carries more than the film: the studio's own `pendingDraft` / `pendingMusic`
 *    markers, and whatever a later version writes. `serializeProduction` builds
 *    `settings.studio` from a fixed parameter list, so writing its output whole
 *    deletes every key outside that list — spec §11, "`settings.studio` unknown
 *    to the serializer is never erased".
 * 2. **It must not touch the studio's internal store row.** The favorites store
 *    is a workflow with `settings.studio = { hidden: true, favorites }` — a
 *    production-shaped row that is not a production. An append into it would
 *    replace the favorites map with a shot index.
 * 3. **Its receipt must count what actually happened.** `castEnrolled` is the
 *    roles the merge ADDED, which on an append is not the size of the cast: a
 *    name the production already has enrolls nothing.
 *
 * The current document in every test below is built by the real writer
 * (`serializeProduction`) rather than typed out, so a fixture cannot quietly
 * drift into a shape the studio never persists.
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
  hasOrganizations: () => false,
}))

vi.mock("@/lib/private-plugins/load.js", () => ({
  getPluginServices: vi.fn(() => ({})),
  loadPrivatePlugins: vi.fn(),
}))

import { studioProductionRoutes } from "../studio-productions.js"
import { supabase } from "../../lib/supabase.js"

const OWNER = "00000000-0000-4000-8000-000000000001"
const STRANGER = "00000000-0000-4000-8000-0000000000ff"
const PRODUCTION = "00000000-0000-4000-8000-000000000020"

/** Two scenes, one of them naming a cast member. */
const PLAN = {
  format: "nodaro-studio-production",
  version: 2,
  title: "More scenes",
  cast: [{ name: "Kira", kind: "character" }],
  scenes: [
    {
      frame: { prompt: "@Kira on the shoreline at dawn" },
      motion: { prompt: "slow dolly in", seconds: 5 },
    },
    { frame: { prompt: "the lighthouse, seen from the water" } },
  ],
}

/** The production the append lands on — one shot, written by the real writer. */
function existingShots(): Shot[] {
  return [
    {
      id: "shot-1",
      name: "Opening",
      still: {
        nodeId: "generate-image-a",
        url: "https://r2/a1.png",
        provider: "flux-2",
        prompt: "a lighthouse at dawn",
      },
    },
  ]
}

/**
 * A workflow row as `PRODUCTION_COLS` selects it.
 *
 * `extraStudio` is the half a serializer-shaped write destroys: keys the studio
 * app writes beside the shot index and `serializeProduction` never emits.
 */
function row(opts: { cast?: Cast; extraStudio?: Record<string, unknown>; extraSettings?: Record<string, unknown> } = {}) {
  const graph = serializeProduction(
    existingShots(),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    opts.cast,
  )
  return {
    id: PRODUCTION,
    user_id: OWNER,
    workspace_id: null,
    visibility: "private",
    name: "The Long Walk",
    thumbnail_url: null,
    version: 3,
    nodes: graph.nodes,
    edges: graph.edges,
    settings: {
      ...(opts.extraSettings ?? {}),
      studio: { ...graph.settings.studio, ...(opts.extraStudio ?? {}) },
    },
    updated_at: "2026-09-06T10:00:00Z",
  }
}

/** The favorites store: production-shaped, and not a production. */
function favoritesRow() {
  return {
    ...row(),
    name: "Studio favorites (internal)",
    nodes: [],
    edges: [],
    // The shape `entity-favorites.ts` actually writes.
    settings: { studio: { hidden: true, favorites: { character: ["c1"] } } },
  }
}

const ENTITY_TABLES = ["characters", "locations", "objects", "creatures"]

/** `.select().order().limit()` then `entityOwnerFilter`'s `.eq().is()`. */
function entityChain(rows: Array<Record<string, unknown>> = []) {
  const is = vi.fn().mockResolvedValue({ data: rows, error: null })
  const eq = vi.fn().mockReturnValue({ is })
  const limit = vi.fn().mockReturnValue({ eq })
  const order = vi.fn().mockReturnValue({ limit })
  const select = vi.fn().mockReturnValue({ order })
  return { select }
}

let app: FastifyInstance
let updated: Record<string, unknown> | undefined

/** The load (`select → eq → maybeSingle`) and the write (`update → eq → select → maybeSingle`). */
function withRow(current: Record<string, unknown> | null) {
  updated = undefined
  vi.mocked(supabase.from).mockImplementation(((table: string) => {
    if (ENTITY_TABLES.includes(table)) return entityChain() as never
    const readMaybeSingle = vi.fn().mockResolvedValue({ data: current, error: null })
    const select = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ maybeSingle: readMaybeSingle }),
      // The `select` that follows an `update` — the row as it now stands.
      maybeSingle: vi.fn(async () => ({
        data: current ? { ...current, ...updated } : null,
        error: null,
      })),
    })
    const update = vi.fn((payload: Record<string, unknown>) => {
      updated = payload
      return { eq: vi.fn().mockReturnValue({ select }) }
    })
    return { select, update } as never
  }) as never)
}

async function importPlan(userId: string, plan: unknown = PLAN) {
  return app.inject({
    method: "POST",
    url: `/v1/studio/productions/${PRODUCTION}/import`,
    headers: { "x-user-id": userId },
    payload: { plan, mode: "append" },
  })
}

/** The `settings.studio` the route wrote. */
function writtenStudio(): Record<string, unknown> {
  return (updated?.settings as { studio: Record<string, unknown> }).studio
}

beforeEach(async () => {
  vi.clearAllMocks()
  updated = undefined
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

describe("POST /v1/studio/productions/:id/import", () => {
  it("appends the plan's scenes after the ones already there", async () => {
    withRow(row())
    const res = await importPlan(OWNER)

    expect(res.statusCode).toBe(200)
    const shots = writtenStudio().shots as Array<{ id: string }>
    expect(shots).toHaveLength(3)
    expect(shots[0].id).toBe("shot-1")
    expect(res.json().data.summary.shotsAdded).toBe(2)
  })

  it("keeps every settings key the serializer knows nothing about", async () => {
    // The real writers: `entity-favorites.ts` spreads its own keys beside the
    // studio index, and the studio's director lane parks `pendingDraft` /
    // `pendingMusic` there while a run is outstanding.
    withRow(
      row({
        extraSettings: { canvasViewport: { x: 10, y: 20, zoom: 1.5 } },
        extraStudio: {
          pendingDraft: { jobId: "job-draft-1", mode: "append" },
          pendingMusic: { jobId: "job-music-1" },
          favorites: { character: ["c1"] },
        },
      }),
    )
    const res = await importPlan(OWNER)
    expect(res.statusCode).toBe(200)

    const studio = writtenStudio()
    // Spec §11 — unknown to the serializer is never erased.
    expect(studio.pendingDraft).toEqual({ jobId: "job-draft-1", mode: "append" })
    expect(studio.pendingMusic).toEqual({ jobId: "job-music-1" })
    expect(studio.favorites).toEqual({ character: ["c1"] })
    // ...and the keys BESIDE `studio` are another app's, not ours to drop.
    expect((updated?.settings as Record<string, unknown>).canvasViewport).toEqual({
      x: 10,
      y: 20,
      zoom: 1.5,
    })
    // The append still won where it had something to say.
    expect((studio.shots as unknown[]).length).toBe(3)
  })

  it("refuses the studio's internal store row — 404, and nothing written", async () => {
    withRow(favoritesRow())
    const res = await importPlan(OWNER)

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe("not_found")
    // The favorites map is still the favorites map.
    expect(updated).toBeUndefined()
  })

  it("counts the roles the merge ADDED, not the size of the cast", async () => {
    // The production already knows Kira; the plan names her again. Nothing is
    // enrolled — she is already that role.
    withRow(row({ cast: { kira: { kind: "character", displayName: "Kira" } } }))
    const known = await importPlan(OWNER)
    expect(known.json().data.summary.castEnrolled).toBe(0)

    // A production that knows somebody else: one role arrives, and the cast is
    // two — which is why the cast's size is the wrong figure to report.
    withRow(row({ cast: { jonas: { kind: "character", displayName: "Jonas" } } }))
    const fresh = await importPlan(OWNER)
    expect(fresh.json().data.summary.castEnrolled).toBe(1)
    expect(Object.keys(fresh.json().data.production.cast)).toHaveLength(2)
  })

  it("answers a stranger 404 — never 403, and writes nothing", async () => {
    withRow(row())
    const res = await importPlan(STRANGER)
    expect(res.statusCode).toBe(404)
    expect(updated).toBeUndefined()
  })

  it("refuses a plan it cannot parse before it writes anything", async () => {
    withRow(row())
    const res = await importPlan(OWNER, { format: "nodaro-studio-production", version: 2 })
    expect(res.statusCode).toBe(400)
    expect(updated).toBeUndefined()
  })
})
