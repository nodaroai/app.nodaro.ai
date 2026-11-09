/**
 * `/v1/admin/provider-safety` — the admin's content-filter setting.
 *
 * What must hold:
 *  - the page's read is admin-only; the write takes the platform operator gate;
 *  - a value looser than today's request is refused unless both a content
 *    guard and a result check are registered, and always refused on a model
 *    that is never loosened;
 *  - a value that changes nothing is left out of what is stored;
 *  - the generic settings route refuses the key;
 *  - every save leaves an `admin_actions` row with the setting before and after.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as Array<{ key: string; value: unknown; updated_by: string }>,
  audits: [] as Record<string, unknown>[],
  admin: true,
  guard: true,
  check: true,
  invalidated: 0,
  auditError: null as string | null,
  saveError: null as string | null,
  order: [] as string[],
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") {
        return {
          insert: async (row: Record<string, unknown>) => {
            if (h.auditError) return { error: { message: h.auditError } }
            h.audits.push(row)
            h.order.push("audit")
            return { error: null }
          },
        }
      }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string; updated_by: string }) => {
          if (h.saveError) return { error: { message: h.saveError } }
          h.upserts.push(row)
          h.order.push("save")
          h.row = { value: row.value, updated_at: row.updated_at }
          return { error: null }
        },
      }
      return chain
    },
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ invalidateSettingsCache: () => void h.invalidated++, getAppSettings: async () => ({ provider_safety_overrides: {} }) }))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))
vi.mock("@/lib/provider-safety-guard-probe.js", () => ({ contentGuardRegistered: async () => h.guard }))
vi.mock("@/lib/result-check.js", () => ({ hasResultCheck: () => h.check }))
vi.mock("@/lib/translate.js", () => ({ translateToEnglish: async (p: string) => p }))

import { adminProviderSafetyRoutes, PROVIDER_SAFETY_AUDIT_TARGET } from "../admin-provider-safety.js"

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.upserts.length = 0
  h.audits.length = 0
  h.admin = true
  h.guard = true
  h.check = true
  h.invalidated = 0
  h.auditError = null
  h.saveError = null
  h.order.length = 0
  app = Fastify()
  app.decorateRequest("userId", null as unknown as string)
  app.addHook("onRequest", async (req) => {
    req.userId = "admin-1"
  })
  await app.register(adminProviderSafetyRoutes)
  await app.ready()
})

const put = (overrides: unknown) => app.inject({ method: "PUT", url: "/v1/admin/provider-safety", payload: { overrides } })

describe("GET /v1/admin/provider-safety", () => {
  it("answers every provider's levers, marked against today's request", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/provider-safety" })
    expect(res.statusCode).toBe(200)
    const { data } = res.json() as { data: { guardRegistered: boolean; groups: Array<{ provider: string; models: Array<{ modelId: string; levers: Array<{ param: string; today: unknown; options: Array<{ value: unknown; relation: string; lock?: string }> }> }>; withoutLever: string[] }> } }
    expect(data.guardRegistered).toBe(true)
    expect(data.groups.map((g) => g.provider)).toEqual(["kie", "replicate", "fal"])
    const replicate = data.groups.find((g) => g.provider === "replicate")!
    const pro = replicate.models.find((m) => m.modelId === "flux-2-pro")!
    expect(pro.levers[0]).toMatchObject({ param: "safety_tolerance", today: 5 })
    expect(pro.levers[0]!.options.find((o) => o.value === 5)!.relation).toBe("today")
    expect(pro.levers[0]!.options.find((o) => o.value === 1)!.relation).toBe("stricter")
    const lora = replicate.models.find((m) => m.modelId === "flux-lora-character")!
    expect(lora.levers[0]!.options.find((o) => o.relation === "looser")!.lock).toBe("never-loosen")
    const kie = data.groups.find((g) => g.provider === "kie")!
    expect(kie.withoutLever.length).toBeGreaterThan(20)
    expect(kie.withoutLever).toContain("veo3")
  })

  it("is admin only", async () => {
    h.admin = false
    const res = await app.inject({ method: "GET", url: "/v1/admin/provider-safety" })
    expect(res.statusCode).toBe(403)
  })

  it("shows looser values locked without a guard", async () => {
    h.guard = false
    const res = await app.inject({ method: "GET", url: "/v1/admin/provider-safety" })
    const { data } = res.json() as { data: { guardRegistered: boolean; groups: Array<{ provider: string; models: Array<{ modelId: string; levers: Array<{ options: Array<{ relation: string; lock?: string }> }> }> }> } }
    expect(data.guardRegistered).toBe(false)
    const klein = data.groups.flatMap((g) => g.models).find((m) => m.modelId === "flux-2-klein")!
    expect(klein.levers[0]!.options.find((o) => o.relation === "looser")!.lock).toBe("loosening-locked")
  })

  it("shows looser values locked with a guard and no result check, and stricter ones open", async () => {
    h.check = false
    const res = await app.inject({ method: "GET", url: "/v1/admin/provider-safety" })
    const { data } = res.json() as { data: { guardRegistered: boolean; resultCheckRegistered: boolean; groups: Array<{ models: Array<{ modelId: string; levers: Array<{ options: Array<{ relation: string; lock?: string }> }> }> }> } }
    expect(data.guardRegistered).toBe(true)
    expect(data.resultCheckRegistered).toBe(false)
    const models = data.groups.flatMap((g) => g.models)
    const klein = models.find((m) => m.modelId === "flux-2-klein")!
    expect(klein.levers[0]!.options.find((o) => o.relation === "looser")!.lock).toBe("loosening-locked")
    const everyLoosen = models.flatMap((m) => m.levers).flatMap((l) => l.options).filter((o) => o.relation === "looser")
    expect(everyLoosen.length).toBeGreaterThan(0)
    expect(everyLoosen.every((o) => o.lock !== undefined)).toBe(true)
    const pro = models.find((m) => m.modelId === "flux-2-pro")!
    expect(pro.levers[0]!.options.find((o) => o.relation === "stricter")!.lock).toBeUndefined()
  })

  it("shows looser values open with a guard and a result check", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/admin/provider-safety" })
    const { data } = res.json() as { data: { resultCheckRegistered: boolean; groups: Array<{ models: Array<{ modelId: string; levers: Array<{ options: Array<{ relation: string; lock?: string }> }> }> }> } }
    expect(data.resultCheckRegistered).toBe(true)
    const klein = data.groups.flatMap((g) => g.models).find((m) => m.modelId === "flux-2-klein")!
    expect(klein.levers[0]!.options.find((o) => o.relation === "looser")!.lock).toBeUndefined()
  })
})

describe("PUT /v1/admin/provider-safety", () => {
  it("saves a stricter value and records the change", async () => {
    const res = await put({ "flux-2-pro": { safety_tolerance: 2 } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toHaveLength(1)
    expect(h.upserts[0]).toMatchObject({ key: "provider_safety_overrides", value: { "flux-2-pro": { safety_tolerance: 2 } }, updated_by: "admin-1" })
    expect(h.audits).toHaveLength(1)
    expect(h.audits[0]).toMatchObject({ action: "update_provider_safety", target_type: "app_setting", target_id: PROVIDER_SAFETY_AUDIT_TARGET, payload: { key: "provider_safety_overrides", before: {}, after: { "flux-2-pro": { safety_tolerance: 2 } } } })
    expect(h.invalidated).toBe(1)
  })

  it("writes the audit row before the save", async () => {
    const res = await put({ "flux-2-pro": { safety_tolerance: 2 } })
    expect(res.statusCode).toBe(200)
    expect(h.order).toEqual(["audit", "save"])
  })

  it("a failed audit write refuses the save: nothing stands unaudited", async () => {
    h.auditError = "db down"
    const res = await put({ "flux-2-pro": { safety_tolerance: 2 } })
    expect(res.statusCode).toBe(500)
    expect(h.upserts).toHaveLength(0)
  })

  it("a save that fails after its audit row leaves a second row saying so", async () => {
    h.saveError = "db down"
    const res = await put({ "flux-2-pro": { safety_tolerance: 2 } })
    expect(res.statusCode).toBe(500)
    expect(h.audits.map((row) => row.action)).toEqual(["update_provider_safety", "update_provider_safety_failed"])
  })

  it("leaves out a value that changes nothing", async () => {
    const res = await put({ "flux-2-pro": { safety_tolerance: 5 } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts[0]!.value).toEqual({})
  })

  it("refuses a looser value without a guard", async () => {
    h.guard = false
    const res = await put({ "flux-2-klein": { disable_safety_checker: true } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("loosening_locked")
    expect(h.upserts).toHaveLength(0)
  })

  it("refuses a looser value with a guard alone: nothing yet looks at what a model made", async () => {
    h.check = false
    const res = await put({ "flux-2-klein": { disable_safety_checker: true } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("loosening_locked")
    expect(h.upserts).toHaveLength(0)
    expect(h.audits).toHaveLength(0)
  })

  it("still saves a stricter value with neither", async () => {
    h.guard = false
    h.check = false
    const res = await put({ "flux-2-pro": { safety_tolerance: 2 } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toHaveLength(1)
  })

  it("accepts a looser value with a guard and a result check", async () => {
    const res = await put({ "flux-2-klein": { disable_safety_checker: true } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts[0]!.value).toEqual({ "flux-2-klein": { disable_safety_checker: true } })
  })

  it("refuses to loosen a model that is never loosened, guard or no guard", async () => {
    const res = await put({ "flux-lora-character": { disable_safety_checker: true } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("never_loosen")
  })

  it("refuses a setting whose spelling is unconfirmed", async () => {
    const res = await put({ "flux-kontext-max": { safetyTolerance: 1 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("wire_unconfirmed")
  })

  it("saves a stricter value on a setting a run has confirmed", async () => {
    const res = await put({ "flux-kontext": { safetyTolerance: 1 } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts[0]!.value).toEqual({ "flux-kontext": { safetyTolerance: 1 } })
  })

  it("refuses an unknown model, an unknown setting and a value out of range", async () => {
    expect((await put({ "no-such-model": { x: 1 } })).statusCode).toBe(400)
    expect((await put({ "flux-2-pro": { other_param: 1 } })).statusCode).toBe(400)
    expect((await put({ "flux-2-pro": { safety_tolerance: 9 } })).statusCode).toBe(400)
    expect((await put({ "flux-2-pro": { safety_tolerance: "high" } })).statusCode).toBe(400)
  })

  it("is refused for a non-admin", async () => {
    h.admin = false
    const res = await put({ "flux-2-pro": { safety_tolerance: 2 } })
    expect(res.statusCode).toBe(403)
    expect(h.upserts).toHaveLength(0)
  })
})
