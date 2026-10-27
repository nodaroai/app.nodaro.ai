import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/motion` — the admin's Motion setting per Nodaro
 * Motion engine (direct runs with `style: "motion"`): its masking (a face
 * mask or full depth with its scene) and its prompt style. Admin-only; a save
 * is strict, written whole under the current keys, clears the settings cache
 * and leaves an `admin_actions` row. The stored row's read is tolerant.
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_motion"), chain),
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

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_MOTION_AUDIT_TARGET } = await import("../admin-nodaro-motion-motion.js")
const { NODARO_MOTION_MASKING_AUDIT_TARGET } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { directRunPromptShape, parseNodaroMotionMotion, withEarlierMotionKeys } = await import("../../../lib/nodaro-motion-motion.js")

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
const URL = "/v1/admin/nodaro-motion/motion"
const ENGINES = [
  { id: "motion-prism", name: "Nodaro Motion Prism", internal: "seedance-2-5" },
  { id: "motion-pulse", name: "Nodaro Motion Pulse", internal: "kling-4" },
]
const MOTION = {
  "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "original" }, promptStyle: "flexible" },
  "motion-pulse": { promptStyle: "precise" },
}
const put = (motion: unknown, headers: Record<string, string> = as) => app.inject({ method: "PUT", url: URL, headers, payload: { motion } })

describe("GET /v1/admin/nodaro-motion/motion", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved, with the engines and the prompt styles", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ motion: null, updatedAt: null, engines: ENGINES, promptStyles: ["precise", "flexible"], supports: {} })
  })

  it("answers the stored setting: an earlier engine id read as the current one, an invalid entry left out", async () => {
    h.row = { value: { "motion-pro": { promptStyle: "precise" }, "motion-pulse": { masking: { mode: "always", source: "keep-people" } } }, updated_at: "2026-10-27T10:00:00.000Z" }
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.json().data.motion).toEqual({ "motion-prism": { promptStyle: "precise" } })
  })
})

describe("PUT /v1/admin/nodaro-motion/motion", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put(MOTION)).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the whole setting under the current keys, clears the cache and audits before and after", async () => {
    h.row = { value: { "motion-pulse": { promptStyle: "flexible" } }, updated_at: "2026-10-24T10:00:00.000Z" }
    const res = await put(MOTION)
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_motion", value: MOTION, updated_at: expect.any(String), updated_by: as["x-user"] }])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ motion: MOTION, engines: ENGINES })
    expect(h.audits).toEqual([
      {
        admin_user_id: as["x-user"],
        action: "update_nodaro_motion_motion",
        target_type: "app_setting",
        target_id: NODARO_MOTION_MOTION_AUDIT_TARGET,
        payload: { key: "nodaro_motion_motion", before: { "motion-pulse": { promptStyle: "flexible" } }, after: MOTION },
      },
    ])
  })

  it("files its audit rows under an id of its own", () => {
    expect(new Set([NODARO_MOTION_MOTION_AUDIT_TARGET, NODARO_MOTION_MASKING_AUDIT_TARGET, NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET]).size).toBe(3)
  })

  it("takes one engine alone, or none (every engine on the defaults)", async () => {
    for (const m of [{ "motion-pulse": { masking: { mode: "auto", target: "face" } } }, { "motion-prism": {} }, {}]) {
      expect((await put(m)).statusCode, JSON.stringify(m)).toBe(200)
    }
  })

  it("refuses what a Motion run cannot take, writing nothing", async () => {
    for (const bad of [
      // Keep people is a trend's alone.
      { "motion-prism": { masking: { mode: "always", source: "keep-people" } } },
      // Full depth is made once per run in mode "always".
      { "motion-prism": { masking: { mode: "auto", source: "full-depth" } } },
      // A scene is full depth's alone.
      { "motion-prism": { masking: { mode: "always", scene: "none" } } },
      { "motion-prism": { masking: { mode: "always", source: "full-depth", scene: "video" } } },
      // Marks are a trend's stored mask's alone.
      { "motion-prism": { masking: { mode: "always", marks: [] } } },
      { "motion-prism": { promptStyle: "motion" } },
      { "motion-prism": { style: "flexible" } },
      { "motion-pro": { promptStyle: "precise" } },
    ]) {
      const res = await put(bad)
      expect(res.statusCode, JSON.stringify(bad)).toBe(400)
      expect(res.json().error.code).toBe("validation_error")
    }
    expect(h.upserts).toEqual([])
    expect(h.audits).toEqual([])
  })
})

describe("the setting, as the engine reads it", () => {
  it("answers each entry under its current and its earlier key (a copy)", () => {
    const got = withEarlierMotionKeys(structuredClone(MOTION) as never)
    expect(got).toEqual({ ...MOTION, "motion-pro": MOTION["motion-prism"], "motion-lite": MOTION["motion-pulse"] })
    got["motion-prism"]!.promptStyle = "precise"
    expect(got["motion-pro"]!.promptStyle).toBe("flexible")
  })

  it("reads a value that is not an object as never saved", () => {
    expect(parseNodaroMotionMotion("x", () => {})).toBeNull()
    expect(parseNodaroMotionMotion(null, () => {})).toBeNull()
  })

  it("a direct run's prompt shape: Precise on a face mask; Motion as saved, else the Flexible prompt on a face mask", () => {
    expect(directRunPromptShape("precise", { promptStyle: "flexible", masking: { mode: "always", source: "full-depth" } })).toEqual({ promptStyle: "precise", source: "faces" })
    expect(directRunPromptShape("motion", undefined)).toEqual({ promptStyle: "flexible", source: "faces" })
    expect(directRunPromptShape("motion", { masking: { mode: "auto" } })).toEqual({ promptStyle: "flexible", source: "faces" })
    expect(directRunPromptShape("motion", { masking: { mode: "always", source: "full-depth" }, promptStyle: "precise" })).toEqual({
      promptStyle: "precise",
      source: "full-depth",
      scene: "description",
    })
  })
})
