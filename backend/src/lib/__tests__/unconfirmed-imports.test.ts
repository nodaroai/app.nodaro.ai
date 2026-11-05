/**
 * The count of imports without a content rights confirmation (migration 597,
 * lib/unconfirmed-imports.ts): one row per import with only the link's host and
 * no account, the request kept only as a keyed hash (the same for every retry,
 * so the table's index answers 23505 for one); counting never fails an import,
 * waits a bounded time, is capped per account and minute, stays quiet while
 * the table is not there yet, and happens only where the admin screen reads
 * it; the share an administrator reads, and from when; rows past 90 days
 * deleted daily.
 */
import { createHmac } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const SECRET = "s".repeat(40)

const db = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  signal: vi.fn(),
  result: vi.fn(),
  lt: vi.fn(),
  deleteSignal: vi.fn(),
  deleteResult: vi.fn(),
  rpc: vi.fn(),
  admin: true,
}))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      db.from(table)
      return {
        insert: (row: unknown) => {
          db.insert(row)
          return {
            abortSignal: (signal: unknown) => {
              db.signal(signal)
              return db.result()
            },
          }
        },
        delete: () => ({
          lt: (column: string, value: string) => {
            db.lt(column, value)
            return {
              abortSignal: (signal: unknown) => {
                db.deleteSignal(signal)
                return db.deleteResult()
              },
            }
          },
        }),
      }
    },
    rpc: db.rpc,
  },
}))
vi.mock("../config.js", () => ({ hasAdmin: () => db.admin, config: { INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(40) } }))

import {
  COUNT_CAP_PER_MINUTE,
  __resetUnconfirmedImportCapForTests,
  deleteExpiredUnconfirmedImports,
  importDeclarationShare,
  recordUnconfirmedImport,
  startUnconfirmedImportsSweep,
} from "../unconfirmed-imports.js"

const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
const IMPORT = { userId: "u1", url: "https://example.com/a.mp4", lane: "route", via: null, appId: null, requestId: null } as const
const insertedRequest = (call: number): string => (db.insert.mock.calls[call]![0] as { request_id: string }).request_id

beforeEach(() => {
  vi.clearAllMocks()
  db.admin = true
  db.result.mockResolvedValue({ error: null })
  db.deleteResult.mockResolvedValue({ error: null })
  __resetUnconfirmedImportCapForTests()
})
afterEach(() => vi.useRealTimers())

describe("recordUnconfirmedImport", () => {
  it("keeps the link's host only, lower-cased, beside the lane, way in, app and request, and no account", async () => {
    await recordUnconfirmedImport({ userId: "u1", url: "https://WWW.YouTube.com/watch?v=abc&name=someone", lane: "route", via: "session", appId: null, requestId: "req-1" })
    expect(db.from).toHaveBeenCalledWith("rights_unconfirmed_imports")
    expect(db.insert).toHaveBeenCalledWith({ lane: "route", via: "session", app_id: null, request_id: expect.stringMatching(/^[0-9a-f]{64}$/), host: "www.youtube.com" })
  })

  it("keeps the request only as a keyed hash: the same for every retry, never the id, and not the id's plain hash", async () => {
    const job = "7f1d6c9a-7b1e-4c7a-9b1c-2f6b1a8d2e01"
    await recordUnconfirmedImport({ ...IMPORT, requestId: job })
    await recordUnconfirmedImport({ ...IMPORT, requestId: job })
    await recordUnconfirmedImport({ ...IMPORT, requestId: `${"e".repeat(150)}:${"n".repeat(100)}` })
    await recordUnconfirmedImport({ ...IMPORT, requestId: null })
    expect(insertedRequest(0)).toMatch(/^[0-9a-f]{64}$/)
    expect(insertedRequest(1)).toBe(insertedRequest(0))
    expect(insertedRequest(0)).not.toContain(job)
    expect(insertedRequest(0)).not.toBe(createHmac("sha256", "").update(job).digest("hex"))
    const key = createHmac("sha256", SECRET).update("nodaro:rights-unconfirmed-imports:request").digest()
    expect(insertedRequest(0)).toBe(createHmac("sha256", key).update(job).digest("hex"))
    expect(insertedRequest(2)).toMatch(/^[0-9a-f]{64}$/)
    expect(insertedRequest(2)).not.toBe(insertedRequest(0))
    expect(insertedRequest(3)).toBeNull()
  })

  it("waits a bounded time: the insert carries a timeout signal", async () => {
    await recordUnconfirmedImport(IMPORT)
    expect(db.signal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal)
  })

  it("something that is not a link is not counted", async () => {
    await recordUnconfirmedImport({ ...IMPORT, url: "not a link" })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it("an edition with no admin screen counts nothing", async () => {
    db.admin = false
    await recordUnconfirmedImport(IMPORT)
    expect(db.insert).not.toHaveBeenCalled()
  })

  it("a retry of the same request is counted once, and a table not there yet is not news: both quietly", async () => {
    db.result.mockResolvedValueOnce({ error: { code: "23505", message: "duplicate key value" } })
    await recordUnconfirmedImport({ ...IMPORT, via: "api", requestId: "job-1" })
    db.result.mockResolvedValueOnce({ error: { code: "PGRST205", message: "Could not find the table" } })
    await recordUnconfirmedImport(IMPORT)
    db.result.mockResolvedValueOnce({ error: { code: "42P01", message: "relation does not exist" } })
    await recordUnconfirmedImport(IMPORT)
    expect(warn).not.toHaveBeenCalled()
  })

  it("never fails the import: a database error or a thrown one is only logged", async () => {
    db.result.mockResolvedValueOnce({ error: { code: "57014", message: "statement timeout" } })
    await expect(recordUnconfirmedImport(IMPORT)).resolves.toBeUndefined()
    db.result.mockRejectedValueOnce(new Error("The operation was aborted due to timeout"))
    await expect(recordUnconfirmedImport(IMPORT)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("one account adds at most the cap a minute; another account still counts; the next minute counts again", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"))
    for (let i = 0; i < COUNT_CAP_PER_MINUTE + 5; i++) await recordUnconfirmedImport(IMPORT)
    expect(db.insert).toHaveBeenCalledTimes(COUNT_CAP_PER_MINUTE)
    await recordUnconfirmedImport({ ...IMPORT, userId: "u2" })
    expect(db.insert).toHaveBeenCalledTimes(COUNT_CAP_PER_MINUTE + 1)
    vi.setSystemTime(new Date("2026-11-04T12:01:00Z"))
    await recordUnconfirmedImport(IMPORT)
    expect(db.insert).toHaveBeenCalledTimes(COUNT_CAP_PER_MINUTE + 2)
  })

  it("downloads with no account (an accountless lane the declaration reaches) share one cap apart from every account's, and each attempt is its own row", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-11-04T12:00:00Z"))
    const accountless = { userId: "", url: "https://example.com/a.mp4", lane: "route", via: null, appId: null, requestId: null } as const
    for (let i = 0; i < COUNT_CAP_PER_MINUTE + 5; i++) await recordUnconfirmedImport(accountless)
    expect(db.insert).toHaveBeenCalledTimes(COUNT_CAP_PER_MINUTE)
    expect(db.insert).toHaveBeenLastCalledWith({ lane: "route", via: null, app_id: null, request_id: null, host: "example.com" })
    await recordUnconfirmedImport(IMPORT)
    expect(db.insert).toHaveBeenCalledTimes(COUNT_CAP_PER_MINUTE + 1)
  })
})

describe("importDeclarationShare", () => {
  const NOW = Date.parse("2026-11-04T12:00:00Z")

  it("asks for the window that ends now and answers the rows, the counts as numbers", async () => {
    db.rpc.mockResolvedValueOnce({
      data: {
        counting_since: "2026-09-01T00:00:00.123456+00:00",
        since: "2026-10-05T12:00:00+00:00",
        rows: [
          { declaration: "none", lane: "route", via: "session", app_id: null, imports: 5 },
          { declaration: "derived", lane: null, via: null, app_id: null, imports: "2" },
          { declaration: "none", lane: "route", via: "app", app_id: "app-1", imports: 1 },
        ],
      },
      error: null,
    })
    const share = await importDeclarationShare(30, NOW)
    expect(db.rpc).toHaveBeenCalledWith("content_rights_import_share", { p_since: "2026-10-05T12:00:00.000Z" })
    expect(share).toEqual({
      countingSince: null,
      rows: [
        { declaration: "none", lane: "route", via: "session", appId: null, imports: 5 },
        { declaration: "derived", lane: null, via: null, appId: null, imports: 2 },
        { declaration: "none", lane: "route", via: "app", appId: "app-1", imports: 1 },
      ],
    })
  })

  it("says when counting began, when that is inside the window (as the database writes a time, to the microsecond)", async () => {
    db.rpc.mockResolvedValueOnce({ data: { counting_since: "2026-11-02T10:00:00.123456+00:00", since: "2026-11-02T10:00:00.123456+00:00", rows: [] }, error: null })
    expect(await importDeclarationShare(7, NOW)).toEqual({ countingSince: "2026-11-02T10:00:00.123456+00:00", rows: [] })
  })

  it("a share with no rows, or no answer, is empty", async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: null })
    expect(await importDeclarationShare(7, NOW)).toEqual({ countingSince: null, rows: [] })
  })

  it("a database error is thrown, for the route to answer", async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: { message: "permission denied" } })
    await expect(importDeclarationShare(7, NOW)).rejects.toThrow("permission denied")
  })
})

describe("the daily deletion", () => {
  it("deletes the rows older than the 90 days the screen reads, waiting a bounded time", async () => {
    expect(await deleteExpiredUnconfirmedImports(Date.parse("2026-11-04T12:00:00Z"))).toEqual({ failed: false })
    expect(db.from).toHaveBeenCalledWith("rights_unconfirmed_imports")
    expect(db.lt).toHaveBeenCalledWith("created_at", "2026-08-06T12:00:00.000Z")
    expect(db.deleteSignal.mock.calls[0]![0]).toBeInstanceOf(AbortSignal)
  })

  it("a failed deletion is answered, never thrown; a table not there yet is not a failure", async () => {
    db.deleteResult.mockResolvedValueOnce({ error: { code: "57014", message: "timeout" } })
    expect(await deleteExpiredUnconfirmedImports()).toEqual({ failed: true })
    db.deleteResult.mockRejectedValueOnce(new Error("network"))
    expect(await deleteExpiredUnconfirmedImports()).toEqual({ failed: true })
    db.deleteResult.mockResolvedValueOnce({ error: { code: "PGRST205", message: "Could not find the table" } })
    expect(await deleteExpiredUnconfirmedImports()).toEqual({ failed: false })
  })

  it("runs on start where the count is kept, reports a failure, and stops", async () => {
    db.deleteResult.mockResolvedValueOnce({ error: { code: "57014", message: "timeout" } })
    const report = vi.fn()
    const stop = startUnconfirmedImportsSweep(report)
    await stop()
    expect(db.lt).toHaveBeenCalledTimes(1)
    expect(report).toHaveBeenCalledTimes(1)
  })

  it("does nothing where nothing is counted", async () => {
    db.admin = false
    const stop = startUnconfirmedImportsSweep(vi.fn())
    await stop()
    expect(db.lt).not.toHaveBeenCalled()
  })
})
