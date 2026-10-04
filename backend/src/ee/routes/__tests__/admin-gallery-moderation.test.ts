/**
 * The admin's gallery moderation lists, against an in-memory app_settings
 * that behaves like PostgREST (insert conflicts, compare-and-set updates).
 * Neutral stand-in words on purpose: the real list is admin data, never code.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"

type Row = Record<string, unknown>
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  /** Runs once, just before the next update lands — another admin writing first. */
  beforeNextUpdate: null as null | (() => void),
}))

function query(table: string) {
  const filters: Array<(row: Row) => boolean> = []
  let op: { kind: "select" } | { kind: "insert"; row: Row } | { kind: "update"; patch: Row } = { kind: "select" }
  let max = Infinity
  const run = () => {
    const rows = db.tables[table] ?? []
    if (op.kind === "insert") {
      const row = op.row
      if (table === "app_settings" && rows.some((r) => r.key === row.key)) return { data: null, error: { code: "23505", message: "duplicate key" } }
      db.tables = { ...db.tables, [table]: [...rows, { ...row }] }
      return { data: null, error: null }
    }
    if (op.kind === "update") {
      const race = db.beforeNextUpdate
      db.beforeNextUpdate = null
      race?.()
      const current = db.tables[table] ?? []
      const patch = op.patch
      const hit = current.filter((r) => filters.every((f) => f(r)))
      db.tables = { ...db.tables, [table]: current.map((r) => (hit.includes(r) ? { ...r, ...patch } : r)) }
      return { data: hit.map((r) => ({ key: r.key })), error: null }
    }
    return { data: rows.filter((r) => filters.every((f) => f(r))).slice(0, max), error: null }
  }
  const builder: Record<string, unknown> = {
    select: () => builder,
    insert: (row: Row) => {
      op = { kind: "insert", row }
      return builder
    },
    update: (patch: Row) => {
      op = { kind: "update", patch }
      return builder
    },
    eq: (column: string, value: unknown) => {
      filters.push((r) => r[column] === value)
      return builder
    },
    in: (column: string, values: unknown[]) => {
      filters.push((r) => values.includes(r[column]))
      return builder
    },
    ilike: (column: string, pattern: string) => {
      // ILIKE for real: an unescaped _ is any one character, % any run; \x is x itself.
      const source = pattern.replace(/\\(.)|([%_])|([^\\%_]+)/g, (_m, escaped: string, wild: string, text: string) =>
        escaped !== undefined
          ? escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          : wild === "%"
            ? ".*"
            : wild === "_"
              ? "."
              : text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      )
      const re = new RegExp(`^${source}$`, "i")
      filters.push((r) => re.test(String(r[column])))
      return builder
    },
    limit: (n: number) => {
      max = n
      return builder
    },
    maybeSingle: async () => {
      const { data, error } = run()
      return { data: (data as Row[] | null)?.[0] ?? null, error }
    },
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
  }
  return builder
}

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn((table: string) => query(table)) } }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", SUPABASE_URL: "https://test.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" },
  isCloud: () => true,
  hasCredits: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("@/lib/admin-check.js", () => ({ warmAdminCache: vi.fn(), checkIsAdmin: vi.fn().mockResolvedValue(true) }))
vi.mock("@/ee/lib/gallery-word-suggestions.js", () => ({ suggestForBannedWord: vi.fn() }))
vi.mock("@/ee/lib/gallery-word-import.js", () => ({ fillSuggestionsInBackground: vi.fn(async () => undefined), wordsBeingFilled: vi.fn(() => []) }))

import { adminGalleryModerationRoutes } from "../admin-gallery-moderation.js"
import { checkIsAdmin } from "../../../lib/admin-check.js"
import { suggestForBannedWord } from "../../lib/gallery-word-suggestions.js"
import { fillSuggestionsInBackground } from "../../lib/gallery-word-import.js"
import { getAppSettings, invalidateSettingsCache } from "../../../lib/app-settings.js"

const ADMIN = "00000000-0000-4000-8000-0000000000ad"
const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const JOB_A = "11111111-1111-4111-8111-11111111111a"
const JOB_B = "11111111-1111-4111-8111-11111111111b"

let app: FastifyInstance

beforeEach(async () => {
  vi.clearAllMocks()
  vi.mocked(checkIsAdmin).mockResolvedValue(true)
  vi.mocked(suggestForBannedWord).mockResolvedValue({ translations: ["seau", "eimer"], exceptions: ["a bucket of water", "a glass of water"] })
  invalidateSettingsCache()
  db.beforeNextUpdate = null
  db.tables = {
    app_settings: [],
    profiles: [
      { id: A, email: "maker.a@example.com", full_name: "Maker A" },
      { id: B, email: "maker_b@example.com", full_name: null },
      // Matches "maker_b@…" only if the underscore were left a wildcard.
      { id: "00000000-0000-4000-8000-0000000000dd", email: "makerxb@example.com", full_name: null },
    ],
    jobs: [
      { id: JOB_A, user_id: A },
      { id: JOB_B, user_id: B },
    ],
  }
  app = Fastify({ logger: false })
  app.addHook("preHandler", async (req) => {
    const id = req.headers["x-user-id"]
    if (typeof id === "string" && id) req.userId = id
  })
  await app.register(async (instance) => {
    await adminGalleryModerationRoutes(instance)
  })
  await app.ready()
})

afterEach(async () => {
  await app.close()
})

const as = (userId: string | null) => (userId ? { "x-user-id": userId } : {})
const post = (url: string, payload: unknown, userId: string | null = ADMIN) => app.inject({ method: "POST", url, payload: payload as object, headers: as(userId) })
const patch = (payload: unknown) => app.inject({ method: "PATCH", url: "/v1/admin/gallery-moderation/words", payload: payload as object, headers: as(ADMIN) })
const stored = (key: string) => db.tables.app_settings!.find((row) => row.key === key)?.value

describe("admin gallery moderation — access", () => {
  it("is for admins only", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/admin/gallery-moderation" })).statusCode).toBe(401)
    vi.mocked(checkIsAdmin).mockResolvedValue(false)
    expect((await app.inject({ method: "GET", url: "/v1/admin/gallery-moderation", headers: as(A) })).statusCode).toBe(403)
    expect((await post("/v1/admin/gallery-moderation/words", { word: "bucket" }, A)).statusCode).toBe(403)
    expect(db.tables.app_settings).toEqual([])
  })
})

describe("admin gallery moderation — words", () => {
  it("adds a word with its suggested translations; suggested exceptions wait for approval, only those that contain it", async () => {
    // The gallery's settings cache already holds the empty list…
    expect((await getAppSettings()).gallery_blocked_words).toEqual([])

    const res = await post("/v1/admin/gallery-moderation/words", { word: " bucket " })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      words: [{ word: "bucket", translations: ["seau", "eimer"], exceptions: [], suggestedExceptions: ["a bucket of water"] }],
      suggested: true,
    })
    expect(stored("gallery_blocked_words")).toEqual(res.json().words)
    // …and reads the new one straight away in this process.
    expect((await getAppSettings()).gallery_blocked_words).toEqual(res.json().words)
  })

  it("adds the word even when no suggestions came", async () => {
    vi.mocked(suggestForBannedWord).mockResolvedValue(null)
    const res = await post("/v1/admin/gallery-moderation/words", { word: "bucket" })
    expect(res.json()).toEqual({ words: [{ word: "bucket", translations: [], exceptions: [] }], suggested: false })
  })

  it("adding a word that is already there merges into it", async () => {
    await post("/v1/admin/gallery-moderation/words", { word: "bucket" })
    vi.mocked(suggestForBannedWord).mockResolvedValue({ translations: ["SEAU", "cubo"], exceptions: [] })
    const res = await post("/v1/admin/gallery-moderation/words", { word: "Bucket" })
    expect(res.json().words).toEqual([{ word: "bucket", translations: ["seau", "eimer", "cubo"], exceptions: [], suggestedExceptions: ["a bucket of water"] }])
  })

  it("edits translations and exceptions, and refuses an exception that would change nothing", async () => {
    await post("/v1/admin/gallery-moderation/words", { word: "bucket" })

    let res = await patch({ word: "bucket", removeTranslations: ["EIMER"], addTranslations: ["cubo", "seau"] })
    expect(res.json().words[0].translations).toEqual(["seau", "cubo"])

    res = await patch({ word: "bucket", addExceptions: ["un seau d'eau"], removeExceptions: ["a bucket of water"] })
    expect(res.json().words[0].exceptions).toEqual(["un seau d'eau"])

    res = await patch({ word: "bucket", addExceptions: ["a glass of water"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("exception_without_word")
    expect((stored("gallery_blocked_words") as Array<{ exceptions: string[] }>)[0]!.exceptions).toEqual(["un seau d'eau"])
  })

  it("an approved suggestion applies; a dismissed one is gone", async () => {
    vi.mocked(suggestForBannedWord).mockResolvedValue({ translations: ["seau"], exceptions: ["a bucket of water", "a bucket of sand"] })
    await post("/v1/admin/gallery-moderation/words", { word: "bucket" })

    let res = await patch({ word: "bucket", approveExceptions: ["A Bucket of Water"] })
    expect(res.json().words[0]).toEqual({ word: "bucket", translations: ["seau"], exceptions: ["a bucket of water"], suggestedExceptions: ["a bucket of sand"] })

    res = await patch({ word: "bucket", dismissExceptions: ["a bucket of sand"] })
    expect(res.json().words[0]).toEqual({ word: "bucket", translations: ["seau"], exceptions: ["a bucket of water"] })
  })

  it("refuses a word with nothing to compare, before asking for suggestions", async () => {
    const res = await post("/v1/admin/gallery-moderation/words", { word: "\u200B" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("empty_word")
    expect(vi.mocked(suggestForBannedWord)).not.toHaveBeenCalled()
  })

  it("an edit of a word no longer on the list says so", async () => {
    const res = await patch({ word: "bucket", addTranslations: ["seau"] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("unknown_word")
  })

  it("removes a word", async () => {
    await post("/v1/admin/gallery-moderation/words", { word: "bucket" })
    await post("/v1/admin/gallery-moderation/words", { word: "spade" })
    const res = await post("/v1/admin/gallery-moderation/words/remove", { word: "BUCKET" })
    expect(res.json().words.map((entry: { word: string }) => entry.word)).toEqual(["spade"])
  })

  it("refuses a word that is too long, before asking for suggestions", async () => {
    const res = await post("/v1/admin/gallery-moderation/words", { word: "x".repeat(61) })
    expect(res.statusCode).toBe(400)
    expect(vi.mocked(suggestForBannedWord)).not.toHaveBeenCalled()
  })

  it("keeps another admin's change made at the same moment", async () => {
    await post("/v1/admin/gallery-moderation/words", { word: "bucket" })
    // Between this request's read and its write, another admin adds "spade".
    db.beforeNextUpdate = () => {
      db.tables = {
        ...db.tables,
        app_settings: db.tables.app_settings!.map((row) =>
          row.key === "gallery_blocked_words"
            ? { ...row, value: [{ word: "spade", translations: [], exceptions: [] }, ...(row.value as unknown[])], updated_at: "2099-01-01T00:00:00.000Z" }
            : row,
        ),
      }
    }

    const res = await patch({ word: "bucket", addTranslations: ["cubo"] })

    expect(res.statusCode).toBe(200)
    expect(res.json().words.map((entry: { word: string }) => entry.word)).toEqual(["spade", "bucket"])
    expect(res.json().words[1].translations).toContain("cubo")
  })
})

describe("admin gallery moderation — importing a list", () => {
  it("adds every new word at once and looks up their suggestions in the background, in the language given", async () => {
    await post("/v1/admin/gallery-moderation/words", { word: "bucket" })
    const res = await post("/v1/admin/gallery-moderation/words/import", { words: ["spade", "Bucket", "rake", "spade", "x".repeat(61), "  "], language: "English" })

    expect(res.statusCode).toBe(200)
    expect(res.json().added).toBe(2)
    expect(res.json().skipped).toEqual(["x".repeat(61)])
    expect(res.json().words.map((entry: { word: string }) => entry.word)).toEqual(["spade", "rake", "bucket"])
    expect(vi.mocked(fillSuggestionsInBackground)).toHaveBeenCalledWith(ADMIN, ["spade", "rake"], "English")
  })

  it("refuses a list with nothing storable, and one that is too long", async () => {
    expect((await post("/v1/admin/gallery-moderation/words/import", { words: ["  "] })).statusCode).toBe(400)
    expect((await post("/v1/admin/gallery-moderation/words/import", { words: Array.from({ length: 201 }, (_, i) => "w" + i) })).statusCode).toBe(400)
  })
})

describe("admin gallery moderation — email patterns", () => {
  it("blocks a pattern once, refuses one that would block everyone, and unblocks it", async () => {
    let res = await post("/v1/admin/gallery-moderation/creators/patterns", { pattern: "SeriesName*@example.com" })
    expect(res.statusCode).toBe(200)
    expect(res.json().emailPatterns.map((p: { pattern: string }) => p.pattern)).toEqual(["seriesname*@example.com"])
    await post("/v1/admin/gallery-moderation/creators/patterns", { pattern: "seriesname*@example.com" })
    expect((stored("gallery_banned_email_patterns") as unknown[]).length).toBe(1)

    res = await post("/v1/admin/gallery-moderation/creators/patterns", { pattern: "*@gmail.com" })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe("bad_pattern")

    res = await post("/v1/admin/gallery-moderation/creators/patterns/remove", { pattern: "seriesname*@example.com" })
    expect(res.json().emailPatterns).toEqual([])
  })
})

describe("admin gallery moderation — creators", () => {
  it("blocks the creators of gallery items, and lists them with their email", async () => {
    const res = await post("/v1/admin/gallery-moderation/creators", { jobIds: [JOB_A, JOB_B, JOB_A] })

    expect(res.statusCode).toBe(200)
    expect(res.json().blocked).toBe(2)
    expect(res.json().bannedUsers.map((user: { userId: string; email: string }) => [user.userId, user.email]).sort()).toEqual([
      [A, "maker.a@example.com"],
      [B, "maker_b@example.com"],
    ])
    const list = await app.inject({ method: "GET", url: "/v1/admin/gallery-moderation", headers: as(ADMIN) })
    expect(list.json().bannedUsers).toHaveLength(2)
  })

  it("blocks by email — an underscore is a letter, not a wildcard", async () => {
    const res = await post("/v1/admin/gallery-moderation/creators", { email: "MAKER_B@example.com" })
    expect(res.json().bannedUsers.map((user: { userId: string }) => user.userId)).toEqual([B])

    const unknown = await post("/v1/admin/gallery-moderation/creators", { email: "nobody@example.com" })
    expect(unknown.statusCode).toBe(404)
  })

  it("refuses a request that names nobody", async () => {
    expect((await post("/v1/admin/gallery-moderation/creators", {})).statusCode).toBe(400)
    expect((await post("/v1/admin/gallery-moderation/creators", { jobIds: ["not-an-id"] })).statusCode).toBe(400)
  })

  it("unblocks a creator", async () => {
    await post("/v1/admin/gallery-moderation/creators", { userIds: [A, B] })
    const res = await post("/v1/admin/gallery-moderation/creators/remove", { userId: A })
    expect(res.json().bannedUsers.map((user: { userId: string }) => user.userId)).toEqual([B])
    expect((await getAppSettings()).gallery_banned_users.map((user) => user.userId)).toEqual([B])
  })
})
