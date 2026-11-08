import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `/v1/admin/nodaro-motion/settings-sets` — named copies of every Nodaro
 * Motion setting, kept to load as a draft.
 *
 * What must hold:
 *  - every route is admin-only;
 *  - a set is stored as each section's route stores it, and a key that names
 *    no section or a value its route refuses is 400 with every problem listed;
 *  - names are unique (409 `name_taken`); rename, overwrite and delete answer
 *    404 for an unknown id; each write leaves an `admin_actions` row;
 *  - what the engines cannot run yet is a warning, never a refusal;
 *  - an imported file is checked without writing anything, live settings
 *    least of all; a file of a newer version, or not this format, is refused
 *    with the reason; people's data (the route's bypass list) is left out of
 *    an export and kept from the live setting on an import;
 *  - NOTHING here writes `app_settings`.
 */
interface Row {
  [k: string]: unknown
}

const h = vi.hoisted(() => ({
  sets: [] as Row[],
  settings: new Map<string, unknown>(),
  envs: [] as Row[],
  profiles: [] as Row[],
  audits: [] as Row[],
  appSettingsWrites: 0,
  admin: true,
  seq: 0,
}))

vi.mock("@/lib/supabase.js", () => {
  function builder(table: string) {
    let op: "select" | "insert" | "update" | "delete" = "select"
    let payload: Row | null = null
    const filters: Array<(r: Row) => boolean> = []
    const run = (): { data: unknown; error: { code?: string; message: string } | null } => {
      if (table === "admin_actions") {
        h.audits.push(payload!)
        return { data: null, error: null }
      }
      if (table === "app_settings") {
        if (op !== "select") {
          h.appSettingsWrites++
          return { data: null, error: null }
        }
        return { data: [...h.settings].map(([key, value]) => ({ key, value, updated_at: "2026-11-01T00:00:00.000Z" })), error: null }
      }
      if (table === "engine_environments") return { data: h.envs, error: null }
      if (table === "profiles") return { data: h.profiles.filter((r) => filters.every((f) => f(r))), error: null }
      if (table !== "nodaro_motion_settings_sets") throw new Error(`unexpected table ${table}`)
      const matches = () => h.sets.filter((r) => filters.every((f) => f(r)))
      // A database answers copies of its rows.
      const copies = (rows: Row[]) => structuredClone(rows)
      if (op === "insert") {
        const name = String(payload!.name)
        if (h.sets.some((r) => String(r.name).toLowerCase() === name.toLowerCase())) return { data: null, error: { code: "23505", message: "duplicate key" } }
        const now = `2026-11-06T10:00:${String(h.seq).padStart(2, "0")}.000Z`
        const row = { id: `00000000-0000-4000-8000-${String(++h.seq).padStart(12, "0")}`, created_at: now, updated_at: now, live_at: null, ...payload! }
        h.sets.push(row)
        return { data: copies([row]), error: null }
      }
      if (op === "update") {
        const name = payload!.name
        if (name !== undefined && h.sets.some((r) => String(r.name).toLowerCase() === String(name).toLowerCase() && !matches().includes(r))) {
          return { data: null, error: { code: "23505", message: "duplicate key" } }
        }
        const hit = matches()
        for (const r of hit) Object.assign(r, structuredClone(payload))
        return { data: copies(hit), error: null }
      }
      if (op === "delete") {
        const hit = matches()
        h.sets = h.sets.filter((r) => !hit.includes(r))
        return { data: copies(hit), error: null }
      }
      return { data: copies(matches()), error: null }
    }
    const chain = {
      select: () => chain,
      insert: (row: Row) => ((op = "insert"), (payload = row), chain),
      update: (patch: Row) => ((op = "update"), (payload = patch), chain),
      upsert: (row: Row) => ((op = "update"), (payload = row), chain),
      delete: () => ((op = "delete"), chain),
      eq: (col: string, v: unknown) => (filters.push((r) => (table === "app_settings" ? true : r[col] === v)), table === "app_settings" ? appSettingsRow(v as string) : chain),
      in: (col: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[col])), chain),
      order: () => chain,
      single: async () => {
        const { data, error } = run()
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error }
      },
      maybeSingle: async () => {
        const { data, error } = run()
        return { data: Array.isArray(data) ? (data[0] ?? null) : data, error }
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    }
    return chain
  }
  /** One app_settings row read by key (the stores' fresh reads). */
  function appSettingsRow(key: string) {
    const row = h.settings.has(key) ? { value: h.settings.get(key), updated_at: "2026-11-01T00:00:00.000Z" } : null
    return { maybeSingle: async () => ({ data: row, error: null }), then: (r: (v: unknown) => unknown) => Promise.resolve({ data: row ? [row] : [], error: null }).then(r) }
  }
  return { supabase: { from: builder } }
})
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: async () => h.admin }))

const { adminNodaroMotionRoutes } = await import("../admin-nodaro-motion.js")

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const as = { "x-user": ADMIN }
const BASE = "/v1/admin/nodaro-motion/settings-sets"

let app: FastifyInstance

beforeEach(async () => {
  h.sets = []
  h.settings = new Map()
  h.envs = []
  h.profiles = [{ id: ADMIN, email: "admin@example.com" }]
  h.audits = []
  h.appSettingsWrites = 0
  h.admin = true
  h.seq = 0
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    if (req.headers["x-user"]) req.userId = String(req.headers["x-user"])
  })
  await app.register(adminNodaroMotionRoutes)
  await app.ready()
})

const send = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, body?: unknown, headers: Record<string, string> = as) =>
  app.inject({ method, url, headers: { ...headers, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) })

const SETTINGS = {
  advanced: { show: true },
  "pulse-audio": { pulseAudio: "generated" },
  style: { style: { "motion-prism": "precise", "motion-pulse": "user" } },
  "precise-style-route": { preciseStyleRoute: { routing: "off", bypassEmails: ["Tester@Example.com"] } },
}

describe("admin-only", () => {
  it("refuses every route to a caller who is not an admin, and writes nothing", async () => {
    h.admin = false
    const id = "00000000-0000-4000-8000-000000000001"
    for (const [method, url, body] of [
      ["GET", BASE],
      ["POST", BASE, { name: "A", settings: {} }],
      ["PUT", `${BASE}/${id}`, { name: "B" }],
      ["DELETE", `${BASE}/${id}`],
      ["POST", `${BASE}/${id}/live`, {}],
      ["POST", `${BASE}/check`, { document: {} }],
      ["POST", `${BASE}/export`, { name: "A", settings: {} }],
    ] as const) {
      expect((await send(method, url, body)).statusCode, `${method} ${url}`).toBe(403)
    }
    expect(h.sets).toEqual([])
    expect(h.audits).toEqual([])
  })
})

describe("storing a set", () => {
  it("stores each section as its route stores it, lists it with the sections, and audits it", async () => {
    const res = await send("POST", BASE, { name: "  Launch look  ", settings: SETTINGS })
    expect(res.statusCode).toBe(201)
    const set = res.json().data.set
    expect(set).toMatchObject({ name: "Launch look", createdBy: "admin@example.com", updatedBy: "admin@example.com", liveAt: null, unreadable: null })
    // "Users choose" is left out of the Style choice, the bypass email is stored trimmed and lowercased: the routes' own forms.
    expect(set.settings).toEqual({
      advanced: { show: true },
      "pulse-audio": { pulseAudio: "generated" },
      style: { style: { "motion-prism": "precise" } },
      "precise-style-route": { preciseStyleRoute: { routing: "off", bypassEmails: ["tester@example.com"] } },
    })
    expect(h.audits).toEqual([
      expect.objectContaining({ action: "create_nodaro_motion_settings_set", target_type: "nodaro_motion_settings_set", target_id: set.id }),
    ])
    const list = (await send("GET", BASE)).json().data
    expect(list.sets.map((s: { name: string }) => s.name)).toEqual(["Launch look"])
    expect(list.format).toBe("nodaro-motion-settings")
    expect(list.version).toBe(1)
    expect(list.sections.map((s: { key: string }) => s.key)).toContain("precise-style-route")
    expect(h.appSettingsWrites).toBe(0)
  })

  it("refuses an unknown section and a value its route refuses, listing every problem", async () => {
    const res = await send("POST", BASE, {
      name: "Bad",
      settings: {
        nope: { x: 1 },
        advanced: { show: "yes" },
        "precise-art-style": { preciseArtStyle: { "motion-pulse": { opener: "edit" } } },
      },
    })
    expect(res.statusCode).toBe(400)
    const { code, issues } = res.json().error
    expect(code).toBe("validation_error")
    expect(issues.map((i: { path: string }) => i.path)).toEqual(["settings.nope", "settings.advanced.show", "settings.precise-art-style"])
    expect(issues[2].message).toMatch(/Pulse/)
    expect(h.sets).toEqual([])
  })

  it("answers what the engines cannot run yet as a warning, and stores the set", async () => {
    // No environment recorded: a forced style waits for every environment's engine.
    const res = await send("POST", BASE, { name: "Forced", settings: { style: { style: { "motion-prism": "flex" } } } })
    expect(res.statusCode).toBe(201)
    expect(res.json().data.warnings).toEqual([expect.objectContaining({ section: "style", label: "Style choice" })])
    expect(h.sets).toHaveLength(1)
  })

  it("keeps names unique, case aside", async () => {
    expect((await send("POST", BASE, { name: "Look", settings: {} })).statusCode).toBe(201)
    const res = await send("POST", BASE, { name: "look", settings: {} })
    expect(res.statusCode).toBe(409)
    expect(res.json().error.code).toBe("name_taken")
  })

  it("renames, overwrites (audited before and after) and deletes; an unknown id is 404", async () => {
    const id = (await send("POST", BASE, { name: "One", settings: { advanced: { show: true } } })).json().data.set.id
    expect((await send("PUT", `${BASE}/${id}`, { name: "Two" })).json().data.set.name).toBe("Two")
    const over = await send("PUT", `${BASE}/${id}`, { settings: { advanced: { show: false } } })
    expect(over.statusCode).toBe(200)
    expect(over.json().data.set.settings).toEqual({ advanced: { show: false } })
    expect(h.audits.at(-1)).toMatchObject({
      action: "update_nodaro_motion_settings_set",
      payload: { before: { advanced: { show: true } }, after: { advanced: { show: false } } },
    })
    expect((await send("PUT", `${BASE}/${id}`, {})).statusCode).toBe(400)
    expect((await send("DELETE", `${BASE}/${id}`)).statusCode).toBe(200)
    expect(h.audits.at(-1)).toMatchObject({ action: "delete_nodaro_motion_settings_set", payload: { name: "Two", settings: { advanced: { show: false } } } })
    expect(h.sets).toEqual([])
    const unknown = "00000000-0000-4000-8000-0000000000ff"
    expect((await send("PUT", `${BASE}/${unknown}`, { name: "X" })).statusCode).toBe(404)
    expect((await send("DELETE", `${BASE}/${unknown}`)).statusCode).toBe(404)
    expect((await send("DELETE", `${BASE}/not-a-uuid`)).statusCode).toBe(404)
    expect(h.appSettingsWrites).toBe(0)
  })

  it("marks the set the live settings match, without changing it", async () => {
    const id = (await send("POST", BASE, { name: "One", settings: {} })).json().data.set.id
    const res = await send("POST", `${BASE}/${id}/live`, {})
    expect(res.statusCode).toBe(200)
    expect(res.json().data.set.liveAt).toEqual(expect.any(String))
    expect(h.appSettingsWrites).toBe(0)
  })
})

describe("export and import", () => {
  const doc = (over: Record<string, unknown> = {}) => ({ format: "nodaro-motion-settings", version: 1, name: "Shared look", settings: SETTINGS, ...over })

  it("exports the file without people's data, naming what it left out", async () => {
    const res = await send("POST", `${BASE}/export`, { name: "Shared look", settings: SETTINGS })
    expect(res.statusCode).toBe(200)
    const file = res.json().data
    expect(file).toMatchObject({ format: "nodaro-motion-settings", version: 1, name: "Shared look", exportedAt: expect.any(String) })
    expect(file.settings["precise-style-route"]).toEqual({ preciseStyleRoute: { routing: "off" } })
    expect(file.omitted).toEqual(["precise-style-route.preciseStyleRoute.bypassEmails"])
    expect(JSON.stringify(file)).not.toContain("example.com")
  })

  it("checks an imported file, keeping the live bypass list and naming the sections it leaves out; writes nothing", async () => {
    h.settings.set("nodaro_motion_precise_style_route", { bypassEmails: ["live@example.com"] })
    const file = (await send("POST", `${BASE}/export`, { name: "Shared look", settings: SETTINGS })).json().data
    const res = await send("POST", `${BASE}/check`, { document: file })
    expect(res.statusCode).toBe(200)
    const out = res.json().data
    expect(out.valid).toBe(true)
    expect(out.name).toBe("Shared look")
    expect(out.errors).toEqual([])
    expect(out.settings["precise-style-route"]).toEqual({ preciseStyleRoute: { routing: "off", bypassEmails: ["live@example.com"] } })
    expect(out.notes).toEqual(expect.arrayContaining([expect.stringMatching(/^Precise masking: not in this file/), expect.stringMatching(/bypassEmails is not exported/)]))
    expect(out.warnings).toEqual([expect.objectContaining({ section: "style" })])
    expect(h.sets).toEqual([])
    expect(h.audits).toEqual([])
    expect(h.appSettingsWrites).toBe(0)
  })

  it("keeps the live bypass list only where the file says it left it out: a list it never had stays empty", async () => {
    h.settings.set("nodaro_motion_precise_style_route", { bypassEmails: ["live@example.com"] })
    const res = await send("POST", `${BASE}/check`, { document: doc({ settings: { "precise-style-route": { preciseStyleRoute: { routing: "off" } } } }) })
    expect(res.json().data.settings["precise-style-route"]).toEqual({ preciseStyleRoute: { routing: "off" } })
    expect(res.json().data.notes.join(" ")).not.toMatch(/bypassEmails/)
  })

  it("imports an older file whose route section holds only the photographic path", async () => {
    const res = await send("POST", `${BASE}/check`, { document: doc({ settings: { "precise-style-route": { preciseStyleRoute: { photographicStyles: "precise" } } } }) })
    expect(res.statusCode).toBe(200)
    expect(res.json().data.valid).toBe(true)
    expect(res.json().data.settings["precise-style-route"]).toEqual({ preciseStyleRoute: { photographicStyles: "precise" } })
  })

  it("imports the route of each art style, and refuses Flex there", async () => {
    const ok = (await send("POST", `${BASE}/check`, { document: doc({ settings: { "precise-style-route": { preciseStyleRoute: { styleRoutes: { cyberpunk: "precise-gray" } } } } }) })).json().data
    expect(ok.valid).toBe(true)
    expect(ok.settings["precise-style-route"]).toEqual({ preciseStyleRoute: { styleRoutes: { cyberpunk: "precise-gray" } } })
    const bad = (await send("POST", `${BASE}/check`, { document: doc({ settings: { "precise-style-route": { preciseStyleRoute: { styleRoutes: { cyberpunk: "flex" } } } } }) })).json().data
    expect(bad.valid).toBe(false)
    expect(h.appSettingsWrites).toBe(0)
  })

  it("lists every problem of a file, and refuses one of another format or a newer version", async () => {
    const bad = (await send("POST", `${BASE}/check`, { document: doc({ settings: { "pulse-audio": { pulseAudio: "loud" }, colour: {} } }) })).json().data
    expect(bad.valid).toBe(false)
    expect(bad.errors.map((e: { path: string }) => e.path)).toEqual(["settings.pulse-audio.pulseAudio", "settings.colour"])
    const other = (await send("POST", `${BASE}/check`, { document: { format: "something-else", version: 1, settings: {} } })).json().data
    expect(other.valid).toBe(false)
    expect(other.errors[0].message).toMatch(/Not a Nodaro Motion settings file/)
    const newer = (await send("POST", `${BASE}/check`, { document: doc({ version: 99 }) })).json().data
    expect(newer.errors).toEqual([{ path: "version", message: expect.stringMatching(/newer than this app reads/) }])
    const extra = (await send("POST", `${BASE}/check`, { document: doc({ secret: "x" }) })).json().data
    expect(extra.valid).toBe(false)
    expect(h.appSettingsWrites).toBe(0)
  })
})
