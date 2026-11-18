import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/video-remake/pulse-reference-audio` — the admin's Pulse
 * reference audio ("audio in") for every direct Nodaro Pulse run, a mode and a
 * pitch shift per output resolution. Admin-only; never saved reads as null
 * (the default of the audio out); a save is strict, stores only the
 * resolutions off the default of the Pulse audio stored then, clears the
 * settings cache and leaves an `admin_actions` row; `supported` is whether the
 * loaded engine declares `castSwap.pulseReferenceAudio`. A save that changes a
 * resolution to a value off the default waits for every environment's platform
 * claim (422 `platform_unsupported`), then its engine flag (409
 * `engine_unsupported`); what was not changed, or was taken back to the
 * default, is never refused. The Pulse audio's own row is never written.
 */
const h = vi.hoisted(() => ({
  row: null as { value: unknown; updated_at: string } | null,
  /** The stored Pulse audio (`nodaro_motion_pulse_audio`). */
  pulseAudio: null as { value: unknown; updated_at: string } | null,
  upserts: [] as Array<{ key: string; value: unknown }>,
  audits: [] as Record<string, unknown>[],
  admin: true,
  invalidated: 0,
  envs: [] as Array<Record<string, unknown>>,
  envReads: 0,
  envsFail: false,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      if (table === "admin_actions") {
        return { insert: async (row: Record<string, unknown>) => (h.audits.push(row), { error: null }) }
      }
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`)
      let key = ""
      const chain = {
        select: () => chain,
        eq: (_c: string, k: string) => {
          expect(["nodaro_motion_pulse_reference_audio", "nodaro_motion_pulse_audio"]).toContain(k)
          key = k
          return chain
        },
        maybeSingle: async () => ({ data: key === "nodaro_motion_pulse_audio" ? h.pulseAudio : h.row, error: null }),
        upsert: async (row: { key: string; value: unknown; updated_at: string }, opts: unknown) => {
          expect(opts).toEqual({ onConflict: "key" })
          h.upserts.push(row)
          if (row.key === "nodaro_motion_pulse_reference_audio") h.row = { value: row.value, updated_at: row.updated_at }
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
  listEngineEnvironments: async () => {
    h.envReads++
    if (h.envsFail) throw new Error("down")
    return h.envs
  },
}))

const { adminNodaroMotionRoutes, NODARO_MOTION_MASKING_AUDIT_TARGET, NODARO_MOTION_SETTINGS_SECTIONS } = await import("../admin-nodaro-motion.js")
const { NODARO_MOTION_PULSE_REFERENCE_AUDIO_AUDIT_TARGET, NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION } = await import("../admin-nodaro-motion-pulse-reference-audio.js")
const { NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-prism-reference-audio.js")
const { NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET } = await import("../admin-nodaro-motion-pulse-audio.js")
const { NODARO_MOTION_STEPS_AUDIT_TARGET } = await import("../admin-nodaro-motion-steps.js")
const { _resetPluginSupportsForTests, setPluginSupports } = await import("../../../lib/private-plugins/supports-registry.js")

let app: FastifyInstance

beforeEach(async () => {
  h.row = null
  h.pulseAudio = null
  h.upserts = []
  h.audits = []
  h.admin = true
  h.invalidated = 0
  h.envs = []
  h.envReads = 0
  h.envsFail = false
  _resetPluginSupportsForTests()
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const as = { "x-user": "00000000-0000-4000-8000-0000000000ad" }
const URL = "/v1/admin/video-remake/pulse-reference-audio"
const put = (pulseReferenceAudio: unknown, headers: Record<string, string> = as) =>
  app.inject({ method: "PUT", url: URL, headers, payload: { pulseReferenceAudio } })
const CS = { roleKinds: [], fixedReferences: true, fullQuality: true, resolutions: ["720p" as const, "1080p" as const], trendRun: true }
const VOICE = { mode: "voice", semitones: 4 } as const

/** An environment whose engine declares the setting and whose platform claims it (a fresh heartbeat), or either left out. */
const env = (name: string, { engine = true, claim = true, claimedAt }: { engine?: boolean; claim?: boolean; claimedAt?: string } = {}) => ({
  env: name,
  pluginBuildId: "b",
  supports: { castSwap: { ...CS, pulseAudio: true, ...(engine ? { pulseReferenceAudio: true } : {}) } },
  updatedAt: "2026-11-18T00:00:00Z",
  ...(claim ? { platformClaim: { supports: { pulseReferenceAudio: true }, at: claimedAt ?? new Date().toISOString() } } : {}),
})
const takes = () => [env("staging"), env("production")]
const refAudioUpserts = () => h.upserts.filter((u) => u.key === "nodaro_motion_pulse_reference_audio")

describe("GET /v1/admin/video-remake/pulse-reference-audio", () => {
  it("is admin-only", async () => {
    expect((await app.inject({ method: "GET", url: URL })).statusCode).toBe(401)
    h.admin = false
    expect((await app.inject({ method: "GET", url: URL, headers: as })).statusCode).toBe(403)
  })

  it("answers null until it is saved, and whether the engine takes it", async () => {
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toEqual({ pulseReferenceAudio: null, updatedAt: null, supported: false })
    setPluginSupports({ castSwap: { ...CS, pulseReferenceAudio: true } })
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.supported).toBe(true)
  })

  it("answers the stored value, and a value it does not know as never saved", async () => {
    h.row = { value: { "1080p": { mode: "none" } }, updated_at: "2026-11-18T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data).toMatchObject({
      pulseReferenceAudio: { "1080p": { mode: "none" } },
      updatedAt: "2026-11-18T10:00:00.000Z",
    })
    h.row = { value: { "720p": "voice" }, updated_at: "2026-11-18T10:00:00.000Z" }
    expect((await app.inject({ method: "GET", url: URL, headers: as })).json().data.pulseReferenceAudio).toBeNull()
  })
})

describe("PUT /v1/admin/video-remake/pulse-reference-audio", () => {
  it("is admin-only, and writes nothing for a non-admin", async () => {
    expect((await put({ "720p": VOICE }, {})).statusCode).toBe(401)
    h.admin = false
    expect((await put({ "720p": VOICE })).statusCode).toBe(403)
    expect(h.upserts).toEqual([])
  })

  it("saves the resolutions off the default, clears the cache and audits before and after; the Pulse audio row is never written", async () => {
    h.envs = takes()
    const res = await put({ "720p": VOICE, "1080p": { mode: "full", semitones: 4 } })
    expect(res.statusCode).toBe(200)
    expect(h.upserts).toEqual([
      { key: "nodaro_motion_pulse_reference_audio", value: { "720p": VOICE }, updated_at: expect.any(String), updated_by: as["x-user"] },
    ])
    expect(h.invalidated).toBe(1)
    expect(res.json().data).toMatchObject({ pulseReferenceAudio: { "720p": VOICE } })
    expect(h.audits).toEqual([
      {
        admin_user_id: as["x-user"],
        action: "update_nodaro_motion_pulse_reference_audio",
        target_type: "app_setting",
        target_id: NODARO_MOTION_PULSE_REFERENCE_AUDIO_AUDIT_TARGET,
        payload: { key: "nodaro_motion_pulse_reference_audio", before: null, after: { "720p": VOICE } },
      },
    ])
    // Back to the default everywhere: stored as nothing, and never held.
    h.envs = []
    expect((await put({})).json().data.pulseReferenceAudio).toEqual({})
    expect(h.audits[1]?.payload).toEqual({ key: "nodaro_motion_pulse_reference_audio", before: { "720p": VOICE }, after: {} })
  })

  it("drops what is the default of the stored Pulse audio: full at 0 with Kling's own audio, full at +4 with the original", async () => {
    h.envs = takes()
    h.pulseAudio = { value: "generated", updated_at: "2026-11-18T00:00:00Z" }
    await put({ "720p": { mode: "full", semitones: 0 }, "1080p": { mode: "full", semitones: 4 } })
    expect(refAudioUpserts().at(-1)?.value).toEqual({ "1080p": { mode: "full", semitones: 4 } })
    h.pulseAudio = { value: "original", updated_at: "2026-11-18T00:00:00Z" }
    await put({ "720p": { mode: "full" }, "1080p": { mode: "full", semitones: 4 } })
    expect(refAudioUpserts().at(-1)?.value).toEqual({ "720p": { mode: "full", semitones: 0 } })
  })

  it("never reads the environments for a save that changes nothing off the default", async () => {
    expect((await put({ "720p": { mode: "full", semitones: 4 } })).statusCode).toBe(200)
    expect(refAudioUpserts().at(-1)?.value).toEqual({})
    expect(h.envReads).toBe(0)
  })

  it("holds a change off the default 422 while any environment's platform does not claim it (an older platform reads the row as never saved)", async () => {
    for (const [envs, missing] of [
      [[env("staging"), env("production", { claim: false })], ["production"]],
      [[env("staging", { claim: false }), env("production", { claim: false })], ["staging", "production"]],
      [[env("production")], ["staging"]],
      [[], ["staging", "production"]],
    ] as const) {
      h.envs = envs as never
      const res = await put({ "720p": { mode: "none" } })
      expect(res.statusCode, JSON.stringify(missing)).toBe(422)
      expect(res.json().error).toMatchObject({ code: "platform_unsupported", envs: missing })
      expect(res.json().error.message).toContain("Pulse reference audio")
    }
    expect(h.upserts).toEqual([])
  })

  it("a stale claim is no claim", async () => {
    h.envs = [env("staging"), env("production", { claimedAt: new Date(Date.now() - 60 * 60_000).toISOString() })]
    const res = await put({ "720p": VOICE })
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toMatchObject({ code: "platform_unsupported", envs: ["production"] })
  })

  it("then refuses it 409 while any environment's engine lacks castSwap.pulseReferenceAudio", async () => {
    h.envs = [env("staging", { engine: false }), env("production")]
    const res = await put({ "1080p": { mode: "voice-one-tone", semitones: -3.5 } })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatchObject({ code: "engine_unsupported", envs: ["staging"] })
    expect(h.upserts).toEqual([])
  })

  it("counts a change as stored, not as it sounds: full at +4 newly stored under Kling's own audio is held", async () => {
    h.pulseAudio = { value: "generated", updated_at: "2026-11-18T00:00:00Z" }
    const res = await put({ "720p": { mode: "full", semitones: 4 } })
    expect(res.statusCode).toBe(422)
  })

  it("never refuses what was not changed, or what is taken back to the default", async () => {
    h.row = { value: { "720p": VOICE, "1080p": { mode: "none" } }, updated_at: "2026-11-18T10:00:00.000Z" }
    h.envs = [env("staging", { claim: false, engine: false }), env("production", { claim: false, engine: false })]
    expect((await put({ "720p": VOICE, "1080p": { mode: "none" } })).statusCode).toBe(200)
    expect((await put({ "720p": VOICE })).statusCode).toBe(200)
    expect(refAudioUpserts().at(-1)?.value).toEqual({ "720p": VOICE })
    // Another value at a resolution is a change.
    const moved = await put({ "720p": { mode: "voice", semitones: 5 } })
    expect(moved.statusCode).toBe(422)
  })

  it("an environments read that fails while a change is asked is a 500, never a save", async () => {
    h.envsFail = true
    expect((await put({ "720p": VOICE })).statusCode).toBe(500)
    expect(h.upserts).toEqual([])
  })

  it("refuses ids, a plain string, other resolutions, extra keys and a pitch out of range or step", async () => {
    for (const bad of ["voice", { "720p": "voice" }, { "480p": VOICE }, { "720p": { ...VOICE, x: 1 } }, { "720p": { mode: "full", semitones: 30 } }, { "720p": { mode: "full", semitones: 0.3 } }]) {
      expect((await put(bad)).statusCode, JSON.stringify(bad)).toBe(400)
    }
    expect((await app.inject({ method: "PUT", url: URL, headers: as, payload: { pulseReferenceAudio: {}, other: 1 } })).statusCode).toBe(400)
    expect(h.upserts).toEqual([])
  })

  it("files its audit rows under an id of its own", () => {
    expect(NODARO_MOTION_PULSE_REFERENCE_AUDIO_AUDIT_TARGET).toBe("00000000-0000-4000-8000-00000000a0fd")
    expect(
      new Set([
        NODARO_MOTION_PULSE_REFERENCE_AUDIO_AUDIT_TARGET,
        NODARO_MOTION_PRISM_REFERENCE_AUDIO_AUDIT_TARGET,
        NODARO_MOTION_PULSE_AUDIO_AUDIT_TARGET,
        NODARO_MOTION_STEPS_AUDIT_TARGET,
        NODARO_MOTION_MASKING_AUDIT_TARGET,
      ]).size,
    ).toBe(5)
  })
})

describe("the settings section", () => {
  it("comes right after the Pulse audio (a set saves the audio out first)", () => {
    const keys = NODARO_MOTION_SETTINGS_SECTIONS.map((s) => s.key)
    expect(keys.indexOf("pulse-reference-audio")).toBe(keys.indexOf("pulse-audio") + 1)
    expect(NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION.label).toBe("Pulse reference audio")
  })

  it("stores each resolution in its written form, and its warning reads the stored Pulse audio", async () => {
    const parsed = NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION.body.parse({ pulseReferenceAudio: { "720p": { mode: "voice" }, "1080p": { mode: "none", semitones: 2 } } })
    expect(NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION.prepare(parsed)).toEqual({
      value: { pulseReferenceAudio: { "720p": { mode: "voice", semitones: 0 }, "1080p": { mode: "none" } } },
    })
    h.pulseAudio = { value: "generated", updated_at: "2026-11-18T00:00:00Z" }
    expect(await NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION.engineRefusal!({ pulseReferenceAudio: { "720p": { mode: "full", semitones: 0 } } }, null)).toBeNull()
    expect(await NODARO_MOTION_PULSE_REFERENCE_AUDIO_SECTION.engineRefusal!({ pulseReferenceAudio: { "720p": { mode: "full", semitones: 4 } } }, null)).toMatchObject({ status: 422 })
  })
})
