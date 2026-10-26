import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/masking` — the admin's face masking per Nodaro
 * Motion engine (for direct runs). Admin-only; a save is validated per engine
 * by the Cast Swap `faceMasking` schema, written whole, clears the settings
 * cache and leaves an `admin_actions` row.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") {
        return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      const chain = {
        select: () => chain,
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_masking"), chain),
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(opts).toEqual({ onConflict: "key" })
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

const { adminNodaroMotionRoutes, NODARO_MOTION_MASKING_AUDIT_TARGET } = await import("../admin-nodaro-motion.js")

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const as = { "x-user": "00000000-0000-4000-8000-0000000000ad" }
const ENGINES = [
  { id: "motion-pro", name: "Nodaro Motion Pro", internal: "seedance-2-5" },
  { id: "motion-lite", name: "Nodaro Motion Lite", internal: "kling-4" },
]

describe("GET /v1/admin/nodaro-motion/masking", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/masking" })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/masking", headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved, with both engines named", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/masking", headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ masking: null, updatedAt: null, engines: ENGINES })
  })

  it("answers the stored setting, an invalid engine entry left out", async () => {
    h.row = { value: { "motion-pro": { mode: "auto" }, "motion-lite": { mode: "nope" } }, updated_at: "2026-10-25T10:00:00.000Z" }
    const res = await app.inject({ method: "GET", url: "/v1/admin/nodaro-motion/masking", headers: as })
    expect(res.json().data).toEqual({ masking: { "motion-pro": { mode: "auto" } }, updatedAt: "2026-10-25T10:00:00.000Z", engines: ENGINES })
  })
})

describe("PUT /v1/admin/nodaro-motion/masking", () => {
  const masking = {
    "motion-pro": { mode: "always", target: "head", fill: "blur", minFaceHeightPct: 10, maxFaceHeightPct: 0, zone: { leftPct: 5, rightPct: 5 }, blurStrengthPct: 2.5, threshold: 0.4 },
    "motion-lite": { mode: "auto", target: "face", fill: "depth", zone: null },
  }

  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    const res = await app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/masking", headers: as, payload: { masking } })
    expect(res.statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the whole setting with who and when, clears the cache, audits before and after, and answers what is now stored", async () => {
    h.row = { value: { "motion-pro": { mode: "off" } }, updated_at: "2026-10-24T10:00:00.000Z" }
    const before = Date.now()
    const res = await app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/masking", headers: as, payload: { masking } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_masking", value: masking, updated_at: expect.any(String), updated_by: as["x-user"] }])
    expect(h.invalidated).toBe(1)
    // The "Saved" time moves with every save.
    const savedAt = res.json().data.updatedAt as string
    expect(Date.parse(savedAt)).toBeGreaterThanOrEqual(before)
    expect(savedAt).not.toBe("2026-10-24T10:00:00.000Z")
    expect(res.json().data).toEqual({ masking, updatedAt: savedAt, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: as["x-user"],
        action: "update_nodaro_motion_masking",
        target_type: "app_setting",
        target_id: NODARO_MOTION_MASKING_AUDIT_TARGET,
        payload: { key: "nodaro_motion_masking", before: { "motion-pro": { mode: "off" } }, after: masking },
      },
    ])
  })

  it("takes one engine alone, or none (no engine masks)", async () => {
    for (const m of [{ "motion-lite": { mode: "auto" } }, {}]) {
      const res = await app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/masking", headers: as, payload: { masking: m } })
      expect(res.statusCode, JSON.stringify(m)).toBe(200)
    }
    expect(h.upserts).toHaveLength(2)
  })

  it("refuses a setting the engine would refuse, writing nothing", async () => {
    for (const payload of [
      {},
      { masking: null },
      { masking: { "motion-pro": { mode: "sometimes" } } },
      { masking: { "motion-pro": { mode: "auto", threshold: 2 } } },
      { masking: { "motion-lite": { mode: "auto", minFaceHeightPct: 40, maxFaceHeightPct: 20 } } },
      { masking: { "motion-lite": { mode: "auto", zone: { leftPct: 60 } } } },
      { masking: { "motion-lite": { mode: "auto", fill: "pixelate" } } },
      { masking: { "motion-lite": { mode: "auto", tresh: 0.4 } } },
      { masking: { "kling-4": { mode: "auto" } } },
      { masking: {}, extra: 1 },
    ]) {
      const res = await app.inject({ method: "PUT", url: "/v1/admin/nodaro-motion/masking", headers: as, payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })
})
