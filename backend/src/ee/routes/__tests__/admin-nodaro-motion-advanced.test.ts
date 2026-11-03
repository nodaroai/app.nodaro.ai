import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/advanced` — whether a Nodaro Motion page shows its
 * Advanced options (Prepare references and the pre-prompt). One switch for
 * the whole page, not per engine; hidden until an admin turns it on.
 *
 * What must hold:
 *  - both routes are admin-only, and a refused caller writes nothing;
 *  - GET answers `{ show: false }` until it is saved (updatedAt null);
 *  - PUT `{ show: true }` → the admin GET answers true → the public
 *    `GET /v1/cast-swap/advanced` answers true, over the real settings cache
 *    (the save clears it), and back again with `{ show: false }`;
 *  - PUT is strict: anything but `{ show: boolean }` is 400 and writes nothing;
 *  - each save leaves an `admin_actions` row, before and after, under an id
 *    of its own.
 */
const h = vi.hoisted(() => ({
  rows: new Map<string, { value: unknown; updated_at: string }>(),
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") {
        return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      let key: string | null = null
      const chain = {
        select: () => chain,
        eq: (_column: string, k: string) => ((key = k), chain),
        // The admin's fresh read of one row.
        maybeSingle: async () => ({ data: key === null ? null : (h.rows.get(key) ?? null), error: null }),
        // The settings cache's read of every row (awaited without a terminal call).
        then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve({ data: [...h.rows].map(([k, r]) => ({ key: k, value: r.value })), error: null }).then(resolve, reject),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(row.key).toBe("nodaro_motion_advanced")
          expect(opts).toEqual({ onConflict: "key" })
          h.upserts.push(row)
          h.rows.set(row.key, { value: row.value, updated_at: row.updated_at })
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))

const { adminNodaroMotionRoutes, NODARO_MOTION_MASKING_AUDIT_TARGET } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_ADVANCED_AUDIT_TARGET } = await import("../admin-nodaro-motion-advanced.js")
const { castSwapAdvancedRoutes } = await import("../cast-swap-advanced.js")
const { NODARO_MOTION_STYLE_AUDIT_TARGET } = await import("../admin-nodaro-motion-style.js")
const { NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-wording.js")
const { NODARO_MOTION_STEPS_AUDIT_TARGET } = await import("../admin-nodaro-motion-steps.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { NODARO_MOTION_MOTION_AUDIT_TARGET } = await import("../admin-nodaro-motion-motion.js")
const { NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-pulse-audio.js")
const { NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-prism-reference-audio.js")
const { invalidateSettingsCache } = await import("../../../lib/app-settings.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const URL = "/v1/admin/nodaro-motion/advanced"
const PUBLIC_URL = "/v1/cast-swap/advanced"

let app: FastifyInstance

beforeEach(async () => {
  h.rows = new Map()
  h.upserts = []
  h.audits = []
  h.admin = true
  invalidateSettingsCache()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.register(castSwapAdvancedRoutes)
  await app.ready()
})

/** A raw JSON body, so a body that is not an object (`true`, `null`) reaches the route as sent. */
const put = (body: unknown, headers: Record<string, string> = as) =>
  app.inject({ method: "PUT", url: URL, headers: { ...headers, "content-type": "application/json" }, payload: JSON.stringify(body) })
const adminGet = (headers: Record<string, string> = as) => app.inject({ method: "GET", url: URL, headers })
const publicGet = () => app.inject({ method: "GET", url: PUBLIC_URL })

describe("GET /v1/admin/nodaro-motion/advanced", () => {
  it("is admin-only", async () => {
    expect((await adminGet({})).statusCode).toBe(401)
    h.admin = false
    expect((await adminGet()).statusCode).toBe(403)
  })

  it("answers hidden until it is saved", async () => {
    const res = await adminGet()
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ show: false, updatedAt: null })
  })

  it("answers the stored row; a value it does not know reads as hidden", async () => {
    h.rows.set("nodaro_motion_advanced", { value: { show: true }, updated_at: "2026-11-03T10:00:00.000Z" })
    expect((await adminGet()).json().data).toEqual({ show: true, updatedAt: "2026-11-03T10:00:00.000Z" })
    h.rows.set("nodaro_motion_advanced", { value: { show: "yes" }, updated_at: "2026-11-03T11:00:00.000Z" })
    expect((await adminGet()).json().data).toEqual({ show: false, updatedAt: "2026-11-03T11:00:00.000Z" })
  })
})

describe("PUT /v1/admin/nodaro-motion/advanced", () => {
  it("is admin-only, and writes nothing for a refused caller", async () => {
    expect((await put({ show: true }, {})).statusCode).toBe(401)
    h.admin = false
    expect((await put({ show: true })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("PUT { show: true } → the admin GET answers true → the public GET answers true; and back with { show: false }", async () => {
    // The public answer is read (and cached) before the save: the save must clear the cache.
    expect((await publicGet()).json()).toEqual({ show: false })

    const res = await put({ show: true })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ show: true, updatedAt: expect.any(String) })
    expect(h.upserts).toEqual([{ key: "nodaro_motion_advanced", value: { show: true }, updated_at: expect.any(String), updated_by: ADMIN }])
    expect((await adminGet()).json().data.show).toBe(true)
    expect((await publicGet()).json()).toEqual({ show: true })

    expect((await put({ show: false })).json().data.show).toBe(false)
    expect((await adminGet()).json().data.show).toBe(false)
    expect((await publicGet()).json()).toEqual({ show: false })
  })

  it("refuses anything but { show: boolean }, writing nothing", async () => {
    for (const body of [{}, { show: "true" }, { show: 1 }, { show: null }, { show: true, engine: "motion-prism" }, { advanced: { show: true } }, true, null, "show", []]) {
      const res = await put(body)
      expect(res.statusCode, JSON.stringify(body)).toBe(400)
      expect(res.json().error.code, JSON.stringify(body)).toBe("validation_error")
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })

  it("audits each save with the setting before and after", async () => {
    await put({ show: true })
    await put({ show: false })
    expect(h.audits).toEqual([
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_advanced",
        target_type: "app_setting",
        target_id: NODARO_MOTION_ADVANCED_AUDIT_TARGET,
        payload: { key: "nodaro_motion_advanced", before: null, after: { show: true } },
      },
      {
        admin_user_id: ADMIN,
        action: "update_nodaro_motion_advanced",
        target_type: "app_setting",
        target_id: NODARO_MOTION_ADVANCED_AUDIT_TARGET,
        payload: { key: "nodaro_motion_advanced", before: { show: true }, after: { show: false } },
      },
    ])
  })

  it("files its audit rows under an id of its own", () => {
    const targets = [
      NODARO_MOTION_ADVANCED_AUDIT_TARGET,
      NODARO_MOTION_STYLE_AUDIT_TARGET,
      NODARO_MOTION_PROMPT_WORDING_AUDIT_TARGET,
      NODARO_MOTION_STEPS_AUDIT_TARGET,
      NODARO_MOTION_MASKING_AUDIT_TARGET,
      NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET,
      NODARO_MOTION_MOTION_AUDIT_TARGET,
      NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET,
      NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
    ]
    expect(new Set(targets).size).toBe(targets.length)
  })
})
