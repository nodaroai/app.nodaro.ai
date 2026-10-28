import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/prism-reference-audio` — the admin's Prism
 * reference audio for every direct Nodaro Motion Prism run. Admin-only; never
 * saved reads as null (the full audio); a save is strict, clears the settings
 * cache and leaves an `admin_actions` row; `supported` is whether the loaded
 * engine declares `castSwap.prismReferenceAudio`.
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
        eq: (_c: string, key: string) => (expect(key).toBe("nodaro_motion_prism_reference_audio"), chain),
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
const { NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-prism-reference-audio.js")
const { NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-pulse-audio.js")
const { NODARO_MOTION_MOTION_AUDIT_TARGET } = await import("../admin-nodaro-motion-motion.js")
const { NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET } = await import("../admin-nodaro-motion-prompt-parts.js")
const { parseNodaroMotionPrismReferenceAudio } = await import("../../../lib/cast-swap-prism-reference-audio.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const as = { "x-user": "00000000-0000-4000-8000-0000000000ad" }
const URL = "/v1/admin/nodaro-motion/prism-reference-audio"
const put = (prismReferenceAudio: unknown, headers: Record<string, string> = as) =>
  app.inject({ method: "PUT", url: URL, headers, payload: { prismReferenceAudio } })
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["480p" as const], trendRun: true }

describe("GET /v1/admin/nodaro-motion/prism-reference-audio", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved (the full audio), and whether the engine takes it", async () => {
    const res = await app.inject({ method: "GET", url: URL, headers: as })
    expect(res.statusCode).toBe(200)
    expect(res.json().data).toEqual({ prismReferenceAudio: null, updatedAt: null, supported: false })
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudio: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(true)
  })

  it("answers the stored value, and a value it does not know as never saved", async () => {
    h.row = { value: "voice", updated_at: "2026-10-29T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      prismReferenceAudio: "voice",
      updatedAt: "2026-10-29T10:00:00.000Z",
    })
    h.row = { value: "mute", updated_at: "2026-10-29T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.prismReferenceAudio).toBeNull()
  })
})

describe("PUT /v1/admin/nodaro-motion/prism-reference-audio", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put("voice")).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the value, clears the cache and audits before and after", async () => {
    const res = await put("voice")
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([
      { key: "nodaro_motion_prism_reference_audio", value: "voice", updated_at: expect.any(String), updated_by: as["x-user"] },
    ])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ prismReferenceAudio: "voice" })
    expect(h.audits).toEqual([
      {
        admin_user_id: as["x-user"],
        action: "update_nodaro_motion_prism_reference_audio",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
        payload: { key: "nodaro_motion_prism_reference_audio", before: null, after: "voice" },
      },
    ])
    expect((await put("none")).json().data.prismReferenceAudio).toBe("none")
    expect(h.audits[1]?.payload).toEqual({ key: "nodaro_motion_prism_reference_audio", before: "voice", after: "none" })
    expect((await put("full")).json().data.prismReferenceAudio).toBe("full")
  })

  it("refuses any other value, and an extra key", async () => {
    for (const v of ["mute", "", null, 1]) expect((await put(v)).statusCode, JSON.stringify(v)).toBe(400)
    expect(
      (await app.inject({ method: "PUT", url: URL, headers: as, payload: { prismReferenceAudio: "voice", engine: "motion-prism" } })).statusCode,
    ).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("files its audit rows under an id of its own", () => {
    expect(
      new Set([
        NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
        NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET,
        NODARO_MOTION_MOTION_AUDIT_TARGET,
        NODARO_MOTION_MASKING_AUDIT_TARGET,
        NODARO_MOTION_PROMPT_PARTS_AUDIT_TARGET,
      ]).size,
    ).toBe(5)
  })
})

describe("parseNodaroMotionPrismReferenceAudio", () => {
  it("reads full, voice or none, anything else as never saved", () => {
    for (const v of ["full", "voice", "none"] as const) expect(parseNodaroMotionPrismReferenceAudio(v)).toBe(v)
    for (const v of [undefined, null, "", "mute", { prismReferenceAudio: "voice" }]) expect(parseNodaroMotionPrismReferenceAudio(v)).toBeNull()
  })
})
