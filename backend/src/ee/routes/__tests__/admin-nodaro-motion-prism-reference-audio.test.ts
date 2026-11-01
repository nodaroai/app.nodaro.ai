import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/prism-reference-audio` — the admin's Prism
 * reference audio for every direct Nodaro Motion Prism run, a mode per output
 * resolution. Admin-only; never saved reads as null (the full audio); a plain
 * mode (the setting's first shape) reads, and saves, as that mode at every
 * resolution; a save is strict, clears the settings cache and leaves an
 * `admin_actions` row; `supported` is whether the loaded engine declares
 * either `castSwap.prismReferenceAudio` flag, `perResolution` whether it takes
 * the object.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  upserts: [] as unknown[],
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
  /** The recorded engine environments (`listEngineEnvironments`) and how often they were read. */
  envs: [] as Array<{ env: string; pluginBuildId: string; supports: Record<string, unknown>; updatedAt: string }>,
  envReads: 0,
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
vi.mock("../../lib/engine-environments.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/engine-environments.js")>()),
  listEngineEnvironments: async () => (h.envReads++, h.envs),
}))

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
  h.envs = []
  h.envReads = 0
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
    expect(res.json().data).toEqual({ prismReferenceAudio: null, updatedAt: null, supported: false, perResolution: false, modes: ["full"] })
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudio: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({ supported: true, perResolution: false })
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({ supported: true, perResolution: true })
  })

  it("answers the modes this environment's engine takes: one-tone and octave only where it lists them", async () => {
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.modes).toEqual(["full", "voice", "none"])
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true, prismReferenceAudioModes: ["full", "voice", "none", "one-tone"] } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.modes).toEqual(["full", "voice", "none", "one-tone"])
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioPerResolution: true, prismReferenceAudioModes: ["full", "voice", "none", "one-tone", "octave"] } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.modes).toEqual(["full", "voice", "none", "one-tone", "octave"])
    // Listed by an engine that takes no reference audio at all: nothing beyond the full audio.
    setPluginSupports({ castSwap: { ...CS, prismReferenceAudioModes: ["one-tone"] } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.modes).toEqual(["full"])
  })

  it("answers the stored value, a plain mode as that mode at every resolution, and a value it does not know as never saved", async () => {
    h.row = { value: { "720p": "none" }, updated_at: "2026-10-29T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      prismReferenceAudio: { "720p": "none" },
      updatedAt: "2026-10-29T10:00:00.000Z",
    })
    h.row = { value: "voice", updated_at: "2026-10-29T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.prismReferenceAudio).toEqual({
      "480p": "voice",
      "720p": "voice",
      "1080p": "voice",
    })
    for (const value of ["mute", { "720p": "mute" }, { "4k": "none" }]) {
      h.row = { value, updated_at: "2026-10-29T10:00:00.000Z" }
      expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.prismReferenceAudio, JSON.stringify(value)).toBeNull()
    }
  })
})

describe("PUT /v1/admin/nodaro-motion/prism-reference-audio", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    h.admin = false
    expect((await put({ "720p": "voice" })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the value, clears the cache and audits before and after", async () => {
    const first = { "480p": "full", "720p": "voice", "1080p": "none" } as const
    const res = await put(first)
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([
      { key: "nodaro_motion_prism_reference_audio", value: first, updated_at: expect.any(String), updated_by: as["x-user"] },
    ])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ prismReferenceAudio: first })
    expect(h.audits).toEqual([
      {
        admin_user_id: as["x-user"],
        action: "update_nodaro_motion_prism_reference_audio",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
        payload: { key: "nodaro_motion_prism_reference_audio", before: null, after: first },
      },
    ])
    expect((await put({ "720p": "none" })).json().data.prismReferenceAudio).toEqual({ "720p": "none" })
    expect(h.audits[1]?.payload).toEqual({ key: "nodaro_motion_prism_reference_audio", before: first, after: { "720p": "none" } })
    expect((await put({})).json().data.prismReferenceAudio).toEqual({})
  })

  const env = (name: string, modes?: string[]) => ({
    env: name,
    pluginBuildId: "b",
    supports: { castSwap: { ...CS, prismReferenceAudioPerResolution: true, ...(modes ? { prismReferenceAudioModes: modes } : {}) } },
    updatedAt: "2026-11-01T00:00:00Z",
  })
  const ALL = ["full", "voice", "none", "one-tone", "octave"]

  it("saves voice / none without reading the environments (as before)", async () => {
    expect((await put({ "480p": "voice", "1080p": "none" })).statusCode).toBe(200)
    expect(h.envReads).toBe(0)
  })

  it("refuses one-tone or octave 409 while any environment's engine does not list it (the row is shared)", async () => {
    for (const [value, envs, missing] of [
      [{ "480p": "one-tone" }, [env("staging", ALL), env("production", ["full", "voice", "none"])], ["production"]],
      [{ "720p": "octave" }, [env("staging", ["full", "one-tone"]), env("production", ALL)], ["staging"]],
      [{ "720p": "octave" }, [env("production", ALL)], ["staging"]],
      ["one-tone", [], ["staging", "production"]],
    ] as const) {
      h.envs = envs as never
      const res = await put(value)
      expect(res.statusCode, JSON.stringify(value)).toBe(409)
      expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: missing })
    }
    expect(h.upserts).toEqual([])
  })

  it("saves one-tone and octave once every environment's engine lists them", async () => {
    h.envs = [env("staging", ALL), env("production", ALL)]
    const value = { "480p": "one-tone", "720p": "octave", "1080p": "voice" } as const
    const res = await put(value)
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([{ key: "nodaro_motion_prism_reference_audio", value, updated_at: expect.any(String), updated_by: as["x-user"] }])
    expect(res.json().data.prismReferenceAudio).toEqual(value)
    expect((await put("octave")).json().data.prismReferenceAudio).toEqual({ "480p": "octave", "720p": "octave", "1080p": "octave" })
  })

  it("takes a plain mode from an earlier client as that mode at every resolution", async () => {
    expect((await put("none")).json().data.prismReferenceAudio).toEqual({ "480p": "none", "720p": "none", "1080p": "none" })
    expect(h.upserts[0]).toMatchObject({ value: { "480p": "none", "720p": "none", "1080p": "none" } })
  })

  it("refuses any other value, and an extra key", async () => {
    for (const v of ["mute", "", null, 1, { "720p": "mute" }, { "4k": "none" }, ["voice"]]) {
      expect((await put(v)).statusCode, JSON.stringify(v)).toBe(400)
    }
    expect(
      (await app.inject({ method: "PUT", url: URL, headers: as, payload: { prismReferenceAudio: { "720p": "voice" }, engine: "motion-prism" } }))
        .statusCode,
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
  it("reads the per-resolution object, a plain mode as every resolution, anything else as never saved", () => {
    expect(parseNodaroMotionPrismReferenceAudio({ "480p": "full", "1080p": "none" })).toEqual({ "480p": "full", "1080p": "none" })
    expect(parseNodaroMotionPrismReferenceAudio({})).toEqual({})
    for (const v of ["full", "voice", "none", "one-tone", "octave"] as const) {
      expect(parseNodaroMotionPrismReferenceAudio(v)).toEqual({ "480p": v, "720p": v, "1080p": v })
    }
    for (const v of [undefined, null, "", "mute", { prismReferenceAudio: "voice" }, { "720p": "mute" }]) {
      expect(parseNodaroMotionPrismReferenceAudio(v), JSON.stringify(v)).toBeNull()
    }
  })
})
