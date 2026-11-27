// @test-watches backend/src/app.ts supabase/migrations/*.sql
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

const ADMIN_UUID = "00000000-0000-4000-8000-000000000002"
const USER_UUID = "00000000-0000-4000-8000-000000000001"
const RUN = "00000000-0000-4000-8000-0000000000a1"
const FROM = "2026-11-01T00:00:00.000Z"
const TO = "2026-11-08T00:00:00.000Z"

const state = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { rpc: (...args: unknown[]) => state.rpc(...args) },
}))

vi.mock("@/ee/middleware/require-admin.js", () => ({
  requireAdmin: async (
    req: { userId?: string },
    reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (req.userId !== ADMIN_UUID) {
      return reply.status(403).send({ error: { code: "forbidden", message: "Admin access required" } })
    }
  },
}))

import { adminRemakeFaultsRoutes } from "../admin-remake-faults.js"

/** A row as admin_remake_fault_list answers it. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: RUN, created_at: "2026-11-02T10:00:00+00:00", user_id: USER_UUID, email: "person@example.test",
    job_type: "cast-swap", status: "failed", full_quality: false, engine: "prism", resolution: "720p",
    delivered_resolution: null, draft: true,
    worst: "blocked",
    faults: [
      { kind: "unblurred_refused", severity: "blocked", at: "2026-11-02T10:00:03Z" },
      { kind: "intent_override", severity: "recovered", at: "2026-11-02T10:00:01Z", detail: { code: "no_person" } },
    ],
    ...over,
  }
}

let app: FastifyInstance
let logLines: string[] = []

beforeEach(async () => {
  vi.clearAllMocks()
  state.rpc.mockResolvedValue({ data: { total: 1, rows: [row()], kinds: ["intent_override", "unblurred_refused"] }, error: null })
  logLines = []
  app = Fastify({ logger: { level: "warn", stream: { write: (line: string) => { logLines.push(line) } } } })
  app.addHook("preHandler", async (req) => {
    const userId = req.headers["x-user-id"]
    if (typeof userId === "string") req.userId = userId
  })
  await app.register(async (instance) => {
    await adminRemakeFaultsRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const get = (query: Record<string, string | number>, userId = ADMIN_UUID) =>
  app.inject({
    method: "GET",
    url: `/v1/admin/remake-faults?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString()}`,
    headers: { "x-user-id": userId },
  })

const listCall = () => state.rpc.mock.calls.find((c) => c[0] === "admin_remake_fault_list")?.[1]

describe("admins only", () => {
  it("a non-admin gets 403, and nothing is read", async () => {
    const res = await get({ from: FROM, to: TO }, USER_UUID)
    expect(res.statusCode).toBe(403)
    expect(state.rpc).not.toHaveBeenCalled()
  })
})

describe("GET /v1/admin/remake-faults", () => {
  it("the default call: the range, no filter, the first page of 50; the answer in the wire's names", async () => {
    const res = await get({ from: FROM, to: TO })
    expect(res.statusCode).toBe(200)
    expect(state.rpc).toHaveBeenCalledTimes(1)
    expect(state.rpc).toHaveBeenCalledWith("admin_remake_fault_list", {
      p_from: FROM, p_to: TO, p_severity: null, p_kind: null, p_engine: null, p_offset: 0, p_limit: 50,
    })
    expect(res.json()).toEqual({
      data: {
        total: 1,
        kinds: ["intent_override", "unblurred_refused"],
        runs: [{
          id: RUN, createdAt: "2026-11-02T10:00:00+00:00", userId: USER_UUID, email: "person@example.test",
          jobType: "cast-swap", status: "failed", fullQuality: false, engine: "prism", resolution: "720p",
          deliveredResolution: null, draft: true,
          worst: "blocked",
          faults: [
            { kind: "unblurred_refused", severity: "blocked", at: "2026-11-02T10:00:03Z" },
            { kind: "intent_override", severity: "recovered", at: "2026-11-02T10:00:01Z", detail: { code: "no_person" } },
          ],
        }],
      },
    })
  })

  it("passes the filters and the page through", async () => {
    const res = await get({ from: FROM, to: TO, severity: "recovered", kind: "intent_override", engine: "pulse", offset: 50, limit: 25 })
    expect(res.statusCode).toBe(200)
    expect(listCall()).toEqual({
      p_from: FROM, p_to: TO, p_severity: "recovered", p_kind: "intent_override", p_engine: "pulse", p_offset: 50, p_limit: 25,
    })
  })

  it("takes any kind (an open vocabulary), trimmed", async () => {
    await get({ from: FROM, to: TO, kind: "  some_future_kind " })
    expect(listCall()).toMatchObject({ p_kind: "some_future_kind" })
  })

  it.each([
    ["no range", {}],
    ["no to", { from: FROM }],
    ["to not after from", { from: TO, to: FROM }],
    ["a range past 31 days", { from: "2026-09-01T00:00:00.000Z", to: "2026-10-02T00:00:01.000Z" }],
    ["a date that is not an instant", { from: "2026-11-01", to: TO }],
    ["an unknown severity", { from: FROM, to: TO, severity: "fatal" }],
    ["an unknown engine", { from: FROM, to: TO, engine: "kling" }],
    ["a blank kind", { from: FROM, to: TO, kind: "  " }],
    ["a kind past 120 characters", { from: FROM, to: TO, kind: "k".repeat(121) }],
    ["a limit past 200", { from: FROM, to: TO, limit: 201 }],
    ["a limit of 0", { from: FROM, to: TO, limit: 0 }],
    ["a negative offset", { from: FROM, to: TO, offset: -1 }],
    ["a fractional offset", { from: FROM, to: TO, offset: 1.5 }],
  ])("400 for %s; nothing is read", async (_label, query) => {
    const res = await get(query as Record<string, string | number>)
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe("validation_error")
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("re-reads the faults tolerantly: malformed entries dropped, worst first, an unknown severity a warning", async () => {
    state.rpc.mockResolvedValue({
      data: {
        total: 1,
        rows: [row({ worst: "warning", faults: [{ kind: "x", severity: "odd" }, 7, { kind: "y", severity: "blocked" }] })],
        kinds: ["x", "y", 3],
      },
      error: null,
    })
    const data = (await get({ from: FROM, to: TO })).json().data
    expect(data.kinds).toEqual(["x", "y"])
    expect(data.runs[0].faults).toEqual([{ kind: "y", severity: "blocked" }, { kind: "x", severity: "warning" }])
    expect(data.runs[0].worst).toBe("blocked")
  })

  it("answers the engine's size and the size delivered apart (a 4K delivery made at 1080p)", async () => {
    state.rpc.mockResolvedValue({ data: { total: 1, rows: [row({ resolution: "1080p", delivered_resolution: "4k" })], kinds: [] }, error: null })
    const run = (await get({ from: FROM, to: TO })).json().data.runs[0]
    expect(run).toMatchObject({ resolution: "1080p", deliveredResolution: "4k" })
  })

  it("an answer of no shape is an empty list", async () => {
    state.rpc.mockResolvedValue({ data: null, error: null })
    expect((await get({ from: FROM, to: TO })).json()).toEqual({ data: { total: 0, kinds: [], runs: [] } })
  })

  it("never answers a job row's own columns (no output_data / input_data to redact)", async () => {
    const body = (await get({ from: FROM, to: TO })).body
    expect(body).not.toContain("output_data")
    expect(body).not.toContain("input_data")
    expect(body).not.toContain("__castSwapFaults")
  })
})

describe("answers 503 remake_faults_unavailable while the function is not in the database", () => {
  it.each(["PGRST202", "42883"])("%s", async (code) => {
    const cause = { code, message: "Could not find the function public.admin_remake_fault_list" }
    state.rpc.mockResolvedValue({ data: null, error: cause })
    const res = await get({ from: FROM, to: TO })
    expect(res.statusCode).toBe(503)
    expect((res.json() as { error: unknown }).error).toEqual({
      code: "remake_faults_unavailable",
      message: "Video Remake faults need the database update that ships with the next production release.",
    })
    expect(logLines).toHaveLength(1)
    expect(JSON.parse(logLines[0]!)).toMatchObject({ level: 40, route: "/v1/admin/remake-faults", err: cause })
  })

  it("a generic database error is a 500 that says only Failed to read the Video Remake faults", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })
    const res = await get({ from: FROM, to: TO })
    expect(res.statusCode).toBe(500)
    expect((res.json() as { error: unknown }).error).toEqual({ code: "internal_error", message: "Failed to read the Video Remake faults" })
    expect(res.body).not.toContain("statement timeout")
  })

  it("a call that throws is the same 500", async () => {
    state.rpc.mockRejectedValue(new Error("socket hang up"))
    const res = await get({ from: FROM, to: TO })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain("socket hang up")
  })
})

describe("the arguments the route sends, against the function's own signature", () => {
  /** Every migration, oldest first, so a function's newest definition is its last. */
  const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "..", "supabase", "migrations")
  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
    .map((file) => readFileSync(join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n")

  function signatureOf(fn: string): { names: string[]; required: string[] } {
    const definitions = [...migrations.matchAll(new RegExp(String.raw`CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.${fn}\s*\(([^)]*)\)`, "gi"))]
    const parameters = (definitions.at(-1)?.[1] ?? "").split(",").map((p) => p.trim()).filter((p) => p !== "")
    const nameOf = (p: string) => p.split(/\s+/)[0]!
    return { names: parameters.map(nameOf), required: parameters.filter((p) => !/\bDEFAULT\b/i.test(p)).map(nameOf) }
  }

  it("every argument is a parameter of the newest definition, and every parameter with no default is sent", async () => {
    await get({ from: FROM, to: TO })
    const calls = state.rpc.mock.calls as [string, Record<string, unknown>][]
    expect(calls.map(([fn]) => fn)).toEqual(["admin_remake_fault_list"])
    for (const [fn, args] of calls) {
      const { names, required } = signatureOf(fn)
      expect(names.length, `no definition of ${fn} in the migrations`).toBeGreaterThan(0)
      const sent = Object.keys(args)
      expect(sent.filter((name) => !names.includes(name)), `${fn}: sent, but no such parameter`).toEqual([])
      expect(required.filter((name) => !sent.includes(name)), `${fn}: a parameter with no default, not sent`).toEqual([])
    }
  })

  it("the list function is the service role's alone, and reads the Remake runs through the job type, with no index of its own", () => {
    const sig = "public.admin_remake_fault_list(TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, INT, INT)"
    for (const role of ["PUBLIC", "anon", "authenticated"]) expect(migrations).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${role};`)
    expect(migrations).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`)
    // No index on output_data (its build would read every row's output under a lock that blocks writes):
    // the scan starts from idx_jobs_job_type and keeps a range of at most 31 days.
    expect(migrations).not.toMatch(/CREATE INDEX[^;]*__castSwapFaults/)
    expect(migrations).toContain("WHERE r.job_type IN ('cast-swap', 'cast-swap-full-quality')")
    expect(migrations).toContain("p_to - p_from > INTERVAL '31 days'")
  })
})

describe("app.ts", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "app.ts"), "utf8")

  it("registers the route for admins on an edition with credits, once", () => {
    expect(source).toContain('import { adminRemakeFaultsRoutes } from "./ee/routes/admin-remake-faults.js"')
    expect(source).toContain("if (hasAdmin() && hasCredits()) await app.register(adminRemakeFaultsRoutes)")
    expect(source.match(/app\.register\(adminRemakeFaultsRoutes\)/g) ?? []).toHaveLength(1)
  })
})
