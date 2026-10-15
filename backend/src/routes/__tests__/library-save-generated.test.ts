import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

/**
 * `POST /v1/library/save-generated` records an object of ours in the caller's
 * library only when the caller provably made it (decided 2026-10-15).
 *
 * The route used to accept any url on our storage and file a row naming its
 * key under the caller — and a permanent delete of that row then removed the
 * object, whoever it belonged to. The ownership question is the one every
 * deleter asks (`lib/key-ownership.ts`); these tests drive it through the
 * route with a table-backed database.
 */

const fake = vi.hoisted(() => {
  type Row = Record<string, unknown>
  const state = {
    jobs: [] as Row[],
    assets: [] as Row[],
    inserts: [] as Row[],
    updates: [] as Array<{ patch: Row; where: Row }>,
    fail: {} as Record<string, string | undefined>,
  }
  function table(name: "jobs" | "assets") {
    const where: Row = {}
    const tests: Array<(r: Row) => boolean> = []
    let mode: "select" | "insert" | "update" = "select"
    let payload: Row = {}
    let cap = Number.POSITIVE_INFINITY
    const failure = () => state.fail[name]
    const matching = () => (state[name] as Row[]).filter((r) => tests.every((t) => t(r))).slice(0, cap)
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, v: unknown) => {
        where[col] = v
        tests.push((r) => r[col] === v)
        return chain
      },
      in: (col: string, vs: unknown[]) => {
        tests.push((r) => vs.includes(r[col]))
        return chain
      },
      limit: (n: number) => {
        cap = n
        return chain
      },
      insert: (row: Row) => {
        mode = "insert"
        payload = row
        return chain
      },
      update: (patch: Row) => {
        mode = "update"
        payload = patch
        return chain
      },
      maybeSingle: async () => {
        if (failure()) return { data: null, error: { message: failure() } }
        return { data: matching()[0] ?? null, error: null }
      },
      single: async () => {
        if (failure()) return { data: null, error: { message: failure() } }
        if (mode === "insert") {
          const id = `00000000-0000-4000-8000-${String(state.inserts.length + 1).padStart(12, "0")}`
          state.inserts.push({ ...payload, id })
          return { data: { id }, error: null }
        }
        return { data: matching()[0] ?? null, error: null }
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
        let result: unknown
        if (failure()) result = { data: null, error: { message: failure() } }
        else if (mode === "update") {
          state.updates.push({ patch: payload, where: { ...where } })
          result = { data: null, error: null }
        } else result = { data: matching(), error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    return chain
  }
  return { state, table }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (name: "jobs" | "assets") => fake.table(name) },
}))

const configMock = vi.hoisted(() => ({
  config: {
    EDITION: "cloud",
    SUPABASE_URL: "https://test.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "test",
    R2_PUBLIC_URL: "https://cdn.test",
    R2_PUBLIC_FALLBACK_DOMAIN: "fallback.test" as string | undefined,
  },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/config.js", () => configMock)

const adminMock = vi.hoisted(() => ({ isAdmin: false }))
vi.mock("@/lib/admin-check.js", () => ({
  warmAdminCache: vi.fn(),
  checkIsAdmin: vi.fn(async () => adminMock.isAdmin),
}))

// A plain url check: the SSRF gate is not under test here.
vi.mock("@/lib/url-validator.js", async () => {
  const { z } = await import("zod")
  return { safeUrlSchema: z.string().url() }
})

vi.mock("@/lib/relay-possible.js", () => ({ relayPossible: () => false }))

vi.mock("@/lib/storage.js", () => ({ deleteFromR2: vi.fn().mockResolvedValue(undefined), s3: {} }))
vi.mock("@/utils/file-validation.js", () => ({ updateStorageUsage: vi.fn().mockResolvedValue(undefined) }))

import { libraryRoutes } from "../library.js"

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const SELF_JOB = "11111111-1111-4111-8111-111111111111"
const OTHER_JOB = "22222222-2222-4222-8222-222222222222"
const UPLOAD_ID = "44444444-4444-4444-8444-444444444444"

const SELF_OUTPUT = `images/${SELF_JOB}.png`
const OTHER_OUTPUT = `videos/${OTHER_JOB}.mp4`
const UPLOAD_KEY = `uploads/images/${UPLOAD_ID}.png`

let app: FastifyInstance

beforeEach(async () => {
  fake.state.jobs = [
    { id: SELF_JOB, user_id: SELF },
    { id: OTHER_JOB, user_id: OTHER },
  ]
  fake.state.assets = []
  fake.state.inserts = []
  fake.state.updates = []
  fake.state.fail = {}
  adminMock.isAdmin = false
  configMock.config.R2_PUBLIC_URL = "https://cdn.test"
  configMock.config.R2_PUBLIC_FALLBACK_DOMAIN = "fallback.test"

  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    req.userId = SELF
  })
  await app.register(async (instance) => {
    await libraryRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const save = (url: string, extra: Record<string, unknown> = {}) =>
  app.inject({ method: "POST", url: "/v1/library/save-generated", payload: { url, type: "image", ...extra } })

const REFUSAL = {
  error: { code: "forbidden", message: "Only a file you generated or uploaded can be saved to your library" },
}

describe("POST /v1/library/save-generated — whose file", () => {
  it("ATTACK: another user's output is refused, and nothing is written", async () => {
    const res = await save(`https://cdn.test/${OTHER_OUTPUT}`)
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual(REFUSAL)
    expect(fake.state.inserts).toEqual([])
    expect(fake.state.updates).toEqual([])
  })

  it("ATTACK: an operator file nobody made is refused — the same answer as a file that does not exist", async () => {
    const operator = await save("https://cdn.test/brand/makers/acme.svg")
    const missing = await save("https://cdn.test/images/never-made.png")
    expect(operator.statusCode).toBe(403)
    expect(operator.json()).toEqual(REFUSAL)
    expect(missing.statusCode).toBe(403)
    expect(missing.json()).toEqual(REFUSAL)
    expect(fake.state.inserts).toEqual([])
  })

  it.each([
    ["an encoded traversal", "https://cdn.test/images%2F..%2F..%2Fbrand%2Fmakers%2Facme.svg"],
    ["a dot-segment path", "https://cdn.test/images/../brand/makers/acme.svg"],
    ["a doubled slash", `https://cdn.test//${SELF_OUTPUT}`],
    ["the fallback host spelling of another user's output", `https://fallback.test/${OTHER_OUTPUT}`],
    ["the http spelling of another user's output", `http://cdn.test/${OTHER_OUTPUT}`],
  ])("refuses %s", async (_name, url) => {
    const res = await save(url)
    expect(res.statusCode).toBe(403)
    expect(fake.state.inserts).toEqual([])
  })

  it("an admin saving to the shared library is held to the same rule", async () => {
    adminMock.isAdmin = true
    const res = await save(`https://cdn.test/${OTHER_OUTPUT}`, { isLibraryItem: true })
    expect(res.statusCode).toBe(403)
    expect(fake.state.inserts).toEqual([])
  })

  it("saves the caller's own output under its one key and canonical url", async () => {
    const res = await save(`https://cdn.test/${SELF_OUTPUT}?v=2`)
    expect(res.statusCode).toBe(200)
    expect(fake.state.inserts).toHaveLength(1)
    expect(fake.state.inserts[0]).toMatchObject({
      user_id: SELF,
      r2_key: SELF_OUTPUT,
      r2_url: `https://cdn.test/${SELF_OUTPUT}`,
      filename: `${SELF_JOB}.png`,
      upload_source: "generated",
      size_bytes: 0,
      in_library: true,
    })
    expect(res.json()).toEqual({ data: { id: fake.state.inserts[0]!.id, isLibraryItem: false } })
  })

  it("the fallback host spelling of the caller's own output is stored under the public url", async () => {
    const res = await save(`https://fallback.test/${SELF_OUTPUT}`)
    expect(res.statusCode).toBe(200)
    expect(fake.state.inserts[0]).toMatchObject({ r2_key: SELF_OUTPUT, r2_url: `https://cdn.test/${SELF_OUTPUT}` })
  })

  it("the caller's own upload (proved by the upload's row) is put in the library, not filed twice", async () => {
    fake.state.assets = [
      {
        id: "upload-row",
        r2_key: UPLOAD_KEY,
        r2_url: `https://cdn.test/${UPLOAD_KEY}`,
        user_id: SELF,
        upload_source: "manual_upload",
        job_id: null,
        size_bytes: 2048,
        pipeline_entity_id: null,
        relay_job_id: null,
      },
    ]
    const res = await save(`https://cdn.test/${UPLOAD_KEY}`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ data: { id: "upload-row", isLibraryItem: false } })
    expect(fake.state.inserts).toEqual([])
    expect(fake.state.updates).toEqual([{ patch: { in_library: true }, where: { id: "upload-row", user_id: SELF } }])
  })

  it("the caller's own MCP upload (their namespace) is savable", async () => {
    const key = `uploads/image/${SELF}/${UPLOAD_ID}.png`
    const res = await save(`https://cdn.test/${key}`)
    expect(res.statusCode).toBe(200)
    expect(fake.state.inserts[0]).toMatchObject({ r2_key: key })
  })

  it("a url off our storage is recorded as before: the url is its own key", async () => {
    const url = "https://example.com/pictures/cat.png"
    const res = await save(url)
    expect(res.statusCode).toBe(200)
    expect(fake.state.inserts[0]).toMatchObject({ r2_key: url, r2_url: url, filename: "cat.png" })
  })

  it("self-host: the storage subtree behind the app origin is judged like the CDN", async () => {
    configMock.config.R2_PUBLIC_URL = "http://localhost:3000/storage/nodaro-assets"
    configMock.config.R2_PUBLIC_FALLBACK_DOMAIN = undefined
    const mine = await save(`http://localhost:3000/storage/nodaro-assets/${SELF_OUTPUT}`)
    expect(mine.statusCode).toBe(200)
    expect(fake.state.inserts[0]).toMatchObject({
      r2_key: SELF_OUTPUT,
      r2_url: `http://localhost:3000/storage/nodaro-assets/${SELF_OUTPUT}`,
    })
    const theirs = await save(`http://localhost:3000/storage/nodaro-assets/${OTHER_OUTPUT}`)
    expect(theirs.statusCode).toBe(403)
  })

  it("a failed ownership lookup is a 500 and writes nothing", async () => {
    fake.state.fail = { jobs: "jobs timeout" }
    const res = await save(`https://cdn.test/${SELF_OUTPUT}`)
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe("internal_error")
    expect(JSON.stringify(res.json())).not.toContain("jobs timeout")
    expect(fake.state.inserts).toEqual([])
  })
})
