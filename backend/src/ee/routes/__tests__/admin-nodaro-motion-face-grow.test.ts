import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-remake/face-grow` — per engine, how far a direct Precise
 * run's face mask is widened onto the face's own skin. Its own row
 * (`nodaro_motion_face_grow`), never a key of the masking row.
 *
 * What must hold:
 *  - both routes are admin-only; GET answers the saved row (null until saved);
 *  - PUT is strict (whole numbers 0–40, the current engine ids); 0 is left
 *    out of what is stored;
 *  - a grow is 422 `platform_unsupported` while any environment's platform
 *    does not take the row, then 409 `engine_unsupported` while any
 *    environment's engine does not grow; all zeros is saved whatever the
 *    environments, without reading them;
 *  - a save clears the settings cache and leaves an `admin_actions` row
 *    under an id of its own.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as Array<{ key: string; value: unknown }>,
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
  envs: [] as Record<string, unknown>[],
  envReads: 0,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      const chain = {
        select: () => chain,
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_face_grow"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }) => {
          expect(row.key).toBe("nodaro_motion_face_grow")
          h.upserts.push(row)
          h.row = { value: row.value, updated_at: row.updated_at }
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ invalidateSettingsCache: () => void h.invalidated++ }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))
vi.mock("../../lib/engine-environments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/engine-environments.js")>()),
  listEngineEnvironments: async () => (h.envReads++, h.envs),
}))

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_FACE_GROW_AUDIT_TARGET } = await import("../admin-nodaro-motion-face-grow.js")

const as = { "x-user": "00000000-0000-4000-8000-0000000000ad" }
const URL = "/v1/admin/video-remake/face-grow"
/** An environment whose engine grows (or not) and whose platform claims the row now (or makes no claim). */
const env = (name: string, grows = true, claimed = true) => ({
  env: name,
  pluginBuildId: null,
  supports: { castSwap: { roleKinds: ["person"], ...(grows ? { faceGrow: true } : {}) } },
  updatedAt: "2026-11-23T00:00:00.000Z",
  ...(claimed ? { platformClaim: { supports: { faceGrow: true }, at: new Date().toISOString() } } : {}),
})

let app: FastifyInstance
beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.envs = [env("production"), env("staging")]
  h.envReads = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const put = (faceGrow: unknown) => app.inject({ method: "PUT", url: URL, headers: as, payload: { faceGrow } })

describe("GET/PUT /v1/admin/video-remake/face-grow", () => {
  it("is admin-only", async () => {
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
    expect((await put({ "nodaro-prism": 18 })).statusCode).toBe(403)
  })

  it("answers null until saved; saves the grows (0 left out), audits under its own id, clears the cache", async () => {
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.faceGrow).toBeNull()
    const res = await put({ "nodaro-prism": 18, "nodaro-pulse": 0 })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.faceGrow).toEqual({ "nodaro-prism": 18 })
    expect(h.upserts[0]!.value).toEqual({ "nodaro-prism": 18 })
    expect(h.invalidated).toBe(1)
    expect(h.audits[0]).toMatchObject({ action: "update_nodaro_motion_face_grow", target_id: NODARO_MOTION_FACE_GROW_AUDIT_TARGET })
  })

  it("is strict: out of range, not whole, an unknown engine or key is 400", async () => {
    for (const body of [{ "nodaro-prism": 41 }, { "nodaro-prism": -1 }, { "nodaro-prism": 2.5 }, { "nodaro-x": 5 }]) {
      expect((await put(body)).statusCode, JSON.stringify(body)).toBe(400)
    }
    expect(h.upserts).toEqual([])
  })

  it("holds a grow while an environment's platform does not take the row (422), before the engines are asked", async () => {
    h.envs = [env("production", false, false), env("staging")]
    const res = await put({ "nodaro-prism": 18 })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: "platform_unsupported", envs: ["production"], message: expect.stringMatching(/does not take the face grow/) })
    expect(h.upserts).toEqual([])
  })

  it("refuses a grow while an environment's engine cannot grow (409), naming it", async () => {
    h.envs = [env("production"), env("staging", false)]
    const res = await put({ "nodaro-prism": 18 })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["staging"], message: expect.stringMatching(/cannot grow the face mask/) })
    expect(h.upserts).toEqual([])
  })

  it("saves all zeros (nothing grows) whatever the environments, without reading them", async () => {
    h.envs = []
    const res = await put({ "nodaro-prism": 0 })
    expect(res.statusCode).toBe(200)
    expect(h.envReads).toBe(0)
    expect(h.upserts[0]!.value).toEqual({})
  })
})
