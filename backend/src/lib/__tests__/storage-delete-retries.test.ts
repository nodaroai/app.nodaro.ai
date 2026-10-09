import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"

// ---------------------------------------------------------------------------
// A storage delete that failed (decided 2026-10-08, rounds 11 and 12): every
// path records it in `storage_delete_retries` (migration 496) through the
// funnel (lib/storage-delete.ts), and a daily pass — every edition — retries
// it at most MAX_DELETE_RETRIES times, then logs and gives up.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => {
  type Answer = { data: unknown; error: unknown }
  const state = {
    selectAnswers: [] as Answer[],
    /** What the claim returns; by default every row the last read returned (no other pass took any). */
    claimAnswers: [] as Answer[],
    lastRead: [] as unknown[],
    upsertAnswer: { data: null, error: null } as Answer,
    updateAnswer: { data: null, error: null } as Answer,
    deleteAnswer: { data: null, error: null } as Answer,
    upserts: [] as Array<{ rows: unknown; opts: unknown }>,
    claims: [] as Array<{ values: Record<string, unknown>; keys: unknown; filters: unknown[][] }>,
    updates: [] as Array<{ values: Record<string, unknown>; key: unknown; failedAt: unknown }>,
    deletes: [] as unknown[],
    deleteFilters: [] as Array<{ key: unknown; failedAt: unknown }>,
    storageConfigured: true,
  }
  const resolved = (a: Answer) => ({ then: (r: (v: Answer) => void) => r(a) })
  const from = vi.fn((table: string) => {
    if (table !== "storage_delete_retries") throw new Error(`unexpected table ${table}`)
    const read: Record<string, unknown> = {}
    read.is = vi.fn(() => read)
    read.or = vi.fn(() => read)
    read.order = vi.fn(() => read)
    read.limit = vi.fn(() => {
      const answer = state.selectAnswers.shift() ?? { data: [], error: null }
      state.lastRead = (answer.data as unknown[] | null) ?? []
      return resolved(answer)
    })
    return {
      select: vi.fn(() => read),
      upsert: vi.fn((rows: unknown, opts: unknown) => {
        state.upserts.push({ rows, opts })
        return resolved(state.upsertAnswer)
      }),
      update: vi.fn((values: Record<string, unknown>) => {
        // A claim: update(...).in(r2_key).is(...).or(...).select(...)
        // A counted failure: update(...).eq(r2_key).eq(failed_at)
        const filters: unknown[][] = []
        const claim: Record<string, unknown> = {}
        claim.is = vi.fn((...a: unknown[]) => { filters.push(["is", ...a]); return claim })
        claim.or = vi.fn((...a: unknown[]) => { filters.push(["or", ...a]); return claim })
        claim.select = vi.fn(() => {
          const answer = state.claimAnswers.shift() ?? { data: state.lastRead, error: null }
          return resolved(answer)
        })
        return {
          in: vi.fn((_col: string, keys: unknown) => {
            state.claims.push({ values, keys, filters })
            return claim
          }),
          eq: vi.fn((_col: string, key: unknown) => ({
            eq: vi.fn((_c: string, failedAt: unknown) => {
              state.updates.push({ values, key, failedAt })
              return resolved(state.updateAnswer)
            }),
          })),
        }
      }),
      delete: vi.fn(() => ({
        eq: vi.fn((_col: string, key: unknown) => ({
          eq: vi.fn((_c: string, failedAt: unknown) => {
            state.deletes.push(key)
            state.deleteFilters.push({ key, failedAt })
            return resolved(state.deleteAnswer)
          }),
        })),
      })),
    }
  })
  return {
    state,
    from,
    batchDeleteFromR2: vi.fn(),
    deleteFromR2: vi.fn(),
    headR2Object: vi.fn(),
    keysHeldByOtherLibraryRows: vi.fn(),
    deletableKeys: vi.fn(),
    blankUrlsInEveryJobOutput: vi.fn(),
    urlsLinkedByJobsSince: vi.fn(),
  }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: h.from } }))
vi.mock("@/lib/storage.js", () => ({
  batchDeleteFromR2: h.batchDeleteFromR2,
  deleteFromR2: h.deleteFromR2,
  headR2Object: h.headR2Object,
  isStorageConfigured: () => h.state.storageConfigured,
}))
vi.mock("@/lib/key-ownership.js", () => ({ keysHeldByOtherLibraryRows: h.keysHeldByOtherLibraryRows }))
vi.mock("@/lib/asset-delete.js", () => ({ deletableKeys: h.deletableKeys }))
vi.mock("@/lib/job-output-references.js", () => ({
  blankUrlsInEveryJobOutput: h.blankUrlsInEveryJobOutput,
  urlsLinkedByJobsSince: h.urlsLinkedByJobsSince,
}))
vi.mock("@/lib/config.js", () => ({ config: { R2_PUBLIC_URL: "https://cdn.example.com" } }))

import { CLOCK_SKEW_MS, MAX_DELETE_RETRIES, retryFailedStorageDeletes, startStorageDeleteRetry } from "../storage-delete-retries.js"
import {
  deleteKeyRecordingFailure,
  deleteKeysRecordingFailures,
  failedKeys,
  keyFailures,
  recordFailedDeletes,
} from "../storage-delete.js"

const JOB = "00000000-0000-4000-8000-0000000000aa"
const KEY = `videos/${JOB}.mp4`
const URL_ = `https://cdn.example.com/${KEY}`
const RECORDED_AT = "2026-10-02T00:00:00Z"
const row = (
  attempts: number,
  key = KEY,
  url: string | null = URL_,
  jobId: string | null = JOB,
  failedAt = RECORDED_AT,
  source = "job-output",
) => ({
  r2_key: key,
  url,
  source,
  job_id: jobId,
  attempts,
  failed_at: failedAt,
})
/** The row the funnel writes for a failure: a fresh record, or a refreshed one. */
const recordedRow = (key: string, url: string | null, source: string, jobId: string | null) => ({
  r2_key: key,
  url,
  source,
  job_id: jobId,
  failed_at: expect.any(String),
  attempts: 0,
  last_attempt_at: null,
  last_error: null,
  gave_up_at: null,
})

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(h.state, {
    selectAnswers: [],
    claimAnswers: [],
    lastRead: [],
    upsertAnswer: { data: null, error: null },
    updateAnswer: { data: null, error: null },
    deleteAnswer: { data: null, error: null },
    upserts: [],
    claims: [],
    updates: [],
    deletes: [],
    deleteFilters: [],
    storageConfigured: true,
  })
  h.keysHeldByOtherLibraryRows.mockResolvedValue(new Set())
  h.deletableKeys.mockImplementation(async (keys: string[]) => keys)
  h.batchDeleteFromR2.mockImplementation(async (keys: string[]) => ({ deleted: keys.length, errors: 0, notDeleted: [] }))
  h.blankUrlsInEveryJobOutput.mockResolvedValue(1)
  h.urlsLinkedByJobsSince.mockResolvedValue(new Set())
  // The object that failed: written well before its record.
  h.headR2Object.mockResolvedValue({ exists: true, lastModified: new Date("2026-10-01T00:00:00Z") })
})

describe("recordFailedDeletes", () => {
  it("records each failed file — key, url, job and when the failed delete began", async () => {
    const at = new Date("2026-10-05T10:00:00.250Z")
    const out = await recordFailedDeletes([{ key: KEY, url: URL_, source: "job-output", jobId: JOB, attemptedAt: at }])

    expect(out).toEqual({ recorded: 1, unavailable: false })
    expect(h.state.upserts).toEqual([
      {
        rows: [{ ...recordedRow(KEY, URL_, "job-output", JOB), failed_at: at.toISOString() }],
        opts: { onConflict: "r2_key" },
      },
    ])
  })

  it("a later failure at a recorded key REFRESHES the record — new moment, attempts and give-up reset — never ignored", async () => {
    // Independent review round: with ON CONFLICT DO NOTHING, a second failure
    // kept the first moment (so the retry took the new object for a rewrite
    // and dropped it undeleted) and a given-up key could never be recorded again.
    await recordFailedDeletes([{ key: KEY, url: URL_, source: "job-output", jobId: JOB, attemptedAt: new Date() }])
    const { rows, opts } = h.state.upserts[0]!
    expect((opts as Record<string, unknown>).ignoreDuplicates).toBeUndefined()
    expect(rows).toEqual([expect.objectContaining({ attempts: 0, gave_up_at: null, last_attempt_at: null })])
  })

  it("writes nothing for no failures", async () => {
    expect(await recordFailedDeletes([])).toEqual({ recorded: 0, unavailable: false })
    expect(h.from).not.toHaveBeenCalled()
  })

  it.each([
    ["42P01", "table"],
    ["PGRST205", "table (schema cache)"],
    ["42703", "column"],
    ["PGRST204", "column (schema cache)"],
  ])("tolerates a database without the record yet (%s, missing %s)", async (code) => {
    h.state.upsertAnswer = { data: null, error: { code, message: "missing" } }
    expect(await recordFailedDeletes([{ key: KEY, url: URL_, source: "job-output", jobId: JOB, attemptedAt: new Date() }])).toEqual({ recorded: 0, unavailable: true })
  })

  it("throws on any other failure, so the reaper leaves the batch unmarked", async () => {
    h.state.upsertAnswer = { data: null, error: { code: "57014", message: "timeout" } }
    await expect(recordFailedDeletes([{ key: KEY, url: URL_, source: "job-output", jobId: JOB, attemptedAt: new Date() }])).rejects.toThrow(/timeout/)
  })
})

describe("retryFailedStorageDeletes", () => {
  it("a retried delete that succeeds blanks the file's links everywhere, then drops the record", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]

    const result = await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).toHaveBeenCalledWith([KEY])
    expect(h.blankUrlsInEveryJobOutput).toHaveBeenCalledWith([URL_])
    expect(h.state.deletes).toEqual([KEY])
    expect(h.state.updates).toEqual([])
    expect(result).toMatchObject({ retried: 1, deleted: 1, failed: 0, gaveUp: 0, errors: 0 })
  })

  it("a retry that fails again counts the attempt and keeps the record and the link", async () => {
    h.state.selectAnswers = [{ data: [row(1)], error: null }]
    h.batchDeleteFromR2.mockResolvedValue({ deleted: 0, errors: 1, notDeleted: [KEY] })

    const result = await retryFailedStorageDeletes()

    expect(h.state.updates).toHaveLength(1)
    expect(h.state.updates[0]!.key).toBe(KEY)
    expect(h.state.updates[0]!.values).toMatchObject({ attempts: 2 })
    expect(h.state.updates[0]!.values.gave_up_at).toBeUndefined()
    expect(h.blankUrlsInEveryJobOutput).not.toHaveBeenCalled()
    expect(h.state.deletes).toEqual([])
    expect(result).toMatchObject({ retried: 1, deleted: 0, failed: 1, gaveUp: 0 })
  })

  it(`gives up after ${MAX_DELETE_RETRIES} attempts: logs, stamps the record, and never blanks the link`, async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    h.state.selectAnswers = [{ data: [row(MAX_DELETE_RETRIES - 1)], error: null }]
    h.batchDeleteFromR2.mockResolvedValue({ deleted: 0, errors: 1, notDeleted: [KEY] })

    const result = await retryFailedStorageDeletes()

    expect(h.state.updates[0]!.values).toMatchObject({ attempts: MAX_DELETE_RETRIES })
    expect(typeof h.state.updates[0]!.values.gave_up_at).toBe("string")
    expect(h.blankUrlsInEveryJobOutput).not.toHaveBeenCalled()
    expect(result.gaveUp).toBe(1)
    expect(errorLog.mock.calls.some((c) => String(c[0]).includes(KEY) || String(c.join(" ")).includes(KEY))).toBe(true)
    errorLog.mockRestore()
  })

  it("only asks for records not given up and not tried within the last day", async () => {
    h.state.selectAnswers = [{ data: [], error: null }]
    await retryFailedStorageDeletes()
    const read = h.from.mock.results[0]!.value.select.mock.results[0]!.value
    expect(read.is).toHaveBeenCalledWith("gave_up_at", null)
    expect(read.or.mock.calls[0]![0]).toMatch(/^last_attempt_at\.is\.null,last_attempt_at\.lt\./)
  })

  // Independent review round: passes on several replicas (every boot runs
  // one) never work the same record.
  it("claims its batch before touching storage: the same filter, re-checked as it stamps last_attempt_at", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    await retryFailedStorageDeletes()

    expect(h.state.claims).toHaveLength(1)
    const claim = h.state.claims[0]!
    expect(claim.keys).toEqual([KEY])
    expect(typeof claim.values.last_attempt_at).toBe("string")
    expect(claim.filters).toContainEqual(["is", "gave_up_at", null])
    expect(claim.filters.find((f) => f[0] === "or")![1]).toMatch(/^last_attempt_at\.is\.null,last_attempt_at\.lt\./)
    // Claimed before the storage lookup.
    expect(h.from.mock.invocationCallOrder[1]!).toBeLessThan(h.headR2Object.mock.invocationCallOrder[0]!)
  })

  it("works only the records its claim won: one another pass took is left alone", async () => {
    const OTHER_KEY = `videos/${JOB}-raw.mov`
    h.state.selectAnswers = [{ data: [row(0), row(0, OTHER_KEY, `https://cdn.example.com/${OTHER_KEY}`)], error: null }]
    // Another replica claimed KEY between the read and this claim.
    h.state.claimAnswers = [{ data: [row(0, OTHER_KEY, `https://cdn.example.com/${OTHER_KEY}`)], error: null }]

    await retryFailedStorageDeletes()

    expect(h.headR2Object).toHaveBeenCalledTimes(1)
    expect(h.batchDeleteFromR2).toHaveBeenCalledWith([OTHER_KEY])
    expect(h.state.deletes).toEqual([OTHER_KEY])
  })

  it("a failed claim deletes nothing", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    h.state.claimAnswers = [{ data: null, error: { code: "57014", message: "timeout" } }]
    const result = await retryFailedStorageDeletes()
    expect(h.headR2Object).not.toHaveBeenCalled()
    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(result.errors).toBeGreaterThan(0)
  })

  it("drops and counts only the failure it worked: a newer failure recorded at the key meanwhile is kept", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    await retryFailedStorageDeletes()
    expect(h.state.deleteFilters).toEqual([{ key: KEY, failedAt: RECORDED_AT }])

    vi.clearAllMocks()
    h.state.updates = []
    h.state.selectAnswers = [{ data: [row(1)], error: null }]
    h.batchDeleteFromR2.mockResolvedValue({ deleted: 0, errors: 1, notDeleted: [KEY] })
    h.headR2Object.mockResolvedValue({ exists: true, lastModified: new Date("2026-10-01T00:00:00Z") })
    await retryFailedStorageDeletes()
    expect(h.state.updates).toEqual([expect.objectContaining({ key: KEY, failedAt: RECORDED_AT })])
  })

  it("an object rewritten in the same second the failed delete began is kept (LastModified has whole seconds)", async () => {
    // Independent review round: storage dates an object to the second, so one
    // written at 12:00:00.300 reads 12:00:00 — earlier than a delete that
    // began at 12:00:00.700, though it came after it.
    h.state.selectAnswers = [{ data: [row(0, KEY, URL_, JOB, "2026-10-02T12:00:00.700Z")], error: null }]
    h.headR2Object.mockResolvedValue({ exists: true, lastModified: new Date("2026-10-02T12:00:00Z") })

    const result = await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(h.blankUrlsInEveryJobOutput).not.toHaveBeenCalled()
    expect(result.released).toBe(1)
  })

  it("an object last written two seconds or more before the failed delete began is the one that failed, and is deleted", async () => {
    h.state.selectAnswers = [{ data: [row(0, KEY, URL_, JOB, "2026-10-02T12:00:02.000Z")], error: null }]
    h.headR2Object.mockResolvedValue({ exists: true, lastModified: new Date("2026-10-02T12:00:00Z") })
    await retryFailedStorageDeletes()
    expect(h.batchDeleteFromR2).toHaveBeenCalledWith([KEY])
  })

  it("re-runs the library and relay guards: a file another row now holds is never deleted, and its record is released", async () => {
    const OTHER_KEY = `videos/${JOB}-raw.mov`
    h.state.selectAnswers = [{ data: [row(0), row(0, OTHER_KEY, `https://cdn.example.com/${OTHER_KEY}`)], error: null }]
    h.keysHeldByOtherLibraryRows.mockResolvedValue(new Set([KEY]))

    const result = await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).toHaveBeenCalledWith([OTHER_KEY])
    expect(h.blankUrlsInEveryJobOutput).toHaveBeenCalledWith([`https://cdn.example.com/${OTHER_KEY}`])
    expect(h.state.deletes.flat().sort()).toEqual([KEY, OTHER_KEY].sort())
    expect(result.released).toBe(1)
  })

  it("any library row naming the key holds it — the retry counts none as the file's own", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    await retryFailedStorageDeletes()
    const isOwnJob = h.keysHeldByOtherLibraryRows.mock.calls[0]![1] as (key: string, jobId: string) => boolean
    // Even a row tied to the very job whose output named the file.
    expect(isOwnJob(KEY, JOB)).toBe(false)
  })

  it("retries an asset's and a location's failed delete the same way", async () => {
    const ASSET = "images/asset-1.png"
    const LOC = "locations/main.png"
    h.state.selectAnswers = [{
      data: [row(0, ASSET, `https://cdn.example.com/${ASSET}`, null), row(0, LOC, `https://cdn.example.com/${LOC}`, null)],
      error: null,
    }]

    const result = await retryFailedStorageDeletes()

    expect(h.keysHeldByOtherLibraryRows).toHaveBeenCalledWith([ASSET, LOC], expect.any(Function))
    expect(h.deletableKeys).toHaveBeenCalledWith([ASSET, LOC])
    expect(h.batchDeleteFromR2).toHaveBeenCalledWith([ASSET, LOC])
    expect(h.state.deletes).toEqual([ASSET, LOC])
    expect(result).toMatchObject({ retried: 2, deleted: 2 })
  })

  it("a record with no url is deleted and dropped, with nothing to blank", async () => {
    h.state.selectAnswers = [{ data: [row(0, KEY, null, null)], error: null }]

    await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).toHaveBeenCalledWith([KEY])
    expect(h.blankUrlsInEveryJobOutput).not.toHaveBeenCalled()
    expect(h.state.deletes).toEqual([KEY])
  })

  it("a NEW object written at the key after the failure was recorded is never deleted; the record is dropped", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    h.headR2Object.mockResolvedValue({ exists: true, lastModified: new Date("2026-10-03T00:00:00Z") })

    const result = await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(h.blankUrlsInEveryJobOutput).not.toHaveBeenCalled()
    expect(h.state.deletes).toEqual([KEY])
    expect(result.released).toBe(1)
  })

  it("an object with no date to prove it is the old one is kept too", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    h.headR2Object.mockResolvedValue({ exists: true })
    await retryFailedStorageDeletes()
    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
  })

  it("an object storage no longer has is already gone: links blanked, record dropped, no delete sent", async () => {
    h.state.selectAnswers = [{ data: [row(2)], error: null }]
    h.headR2Object.mockResolvedValue({ exists: false })

    const result = await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(h.blankUrlsInEveryJobOutput).toHaveBeenCalledWith([URL_])
    expect(h.state.deletes).toEqual([KEY])
    expect(result.deleted).toBe(1)
  })

  it("deletes nothing when storage cannot say whether the object is still the old one", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    h.headR2Object.mockRejectedValue(new Error("503"))
    const result = await retryFailedStorageDeletes()
    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(h.state.deletes).toEqual([])
    expect(result.errors).toBeGreaterThan(0)
  })

  describe("a failed delete that checked job links: a job made after the failure that links the file keeps it (decided 2026-10-09)", () => {
    // The user's own deletes that checked job links on their first try record
    // "asset" (the library delete, and the media delete through it) or "media"
    // (the media delete's row-less branch, media-process). Their first-try
    // rules differ — the library delete held a file one of the user's jobs
    // linked, the media delete did not (the job being wiped still names the
    // url) — so the retry asks one rule of both: only a job created AFTER the
    // failure counts (a new link, like a rewritten object), and the job being
    // wiped never pins the file. The retention reapers record "retention" and
    // are retried without it.
    const FILE = "images/u-1/asset-1.png"
    const FILE_URL = `https://cdn.example.com/${FILE}`
    const recordOf = (source: string, url: string | null = FILE_URL) => row(0, FILE, url, null, RECORDED_AT, source)

    describe.each(["asset", "media"])("source %s", (source) => {
      it("keeps the file and drops the record when such a job links it: no lookup in storage, no delete, no blanking", async () => {
        h.state.selectAnswers = [{ data: [recordOf(source)], error: null }]
        h.urlsLinkedByJobsSince.mockResolvedValue(new Set([FILE_URL]))

        const result = await retryFailedStorageDeletes()

        expect(h.headR2Object).not.toHaveBeenCalled()
        expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
        expect(h.blankUrlsInEveryJobOutput).not.toHaveBeenCalled()
        expect(h.state.deleteFilters).toEqual([{ key: FILE, failedAt: RECORDED_AT }])
        expect(result).toMatchObject({ retried: 0, deleted: 0, released: 1, errors: 0 })
      })

      it("asks about jobs created since the failure began, less the clock allowance (keep when unsure)", async () => {
        h.state.selectAnswers = [{ data: [recordOf(source)], error: null }]

        await retryFailedStorageDeletes()

        expect(h.urlsLinkedByJobsSince).toHaveBeenCalledWith([
          { url: FILE_URL, since: new Date(Date.parse(RECORDED_AT) - CLOCK_SKEW_MS) },
        ])
      })

      it("retries the delete when no job made since the failure links the file", async () => {
        h.state.selectAnswers = [{ data: [recordOf(source)], error: null }]

        const result = await retryFailedStorageDeletes()

        expect(h.batchDeleteFromR2).toHaveBeenCalledWith([FILE])
        expect(h.blankUrlsInEveryJobOutput).toHaveBeenCalledWith([FILE_URL])
        expect(result).toMatchObject({ retried: 1, deleted: 1, released: 0 })
      })

      it("does not ask for a record with no url (nothing a job could link)", async () => {
        h.state.selectAnswers = [{ data: [recordOf(source, null)], error: null }]

        await retryFailedStorageDeletes()

        expect(h.urlsLinkedByJobsSince).not.toHaveBeenCalled()
        expect(h.batchDeleteFromR2).toHaveBeenCalledWith([FILE])
      })

      it("asks nothing for a file another guard already keeps", async () => {
        h.state.selectAnswers = [{ data: [recordOf(source)], error: null }]
        h.keysHeldByOtherLibraryRows.mockResolvedValue(new Set([FILE]))

        const result = await retryFailedStorageDeletes()

        expect(h.urlsLinkedByJobsSince).not.toHaveBeenCalled()
        expect(result.released).toBe(1)
      })

      it("deletes nothing and drops no record when the lookup fails", async () => {
        h.state.selectAnswers = [{ data: [recordOf(source), row(0)], error: null }]
        h.urlsLinkedByJobsSince.mockRejectedValue(new Error("lookup down"))

        const result = await retryFailedStorageDeletes()

        expect(h.headR2Object).not.toHaveBeenCalled()
        expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
        expect(h.state.deletes).toEqual([])
        expect(result.errors).toBeGreaterThan(0)
      })
    })

    // Every other path — the retention reapers above all — is retried as
    // before, even were a later job to link the file. Read off the
    // `DeleteSource` union, so a new path is covered (and unguarded) by default.
    const union = readFileSync(new URL("../storage-delete.ts", import.meta.url), "utf8").match(/export type DeleteSource =([\s\S]*?)\n\n/)
    const unguarded = [...(union?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((s) => s !== "asset" && s !== "media")

    it("the union lists the retention reapers' source and the other paths", () => {
      expect(unguarded).toContain("retention")
      expect(unguarded.length).toBeGreaterThan(10)
    })

    describe.each(unguarded)("source %s", (source) => {
      it("is retried without asking about newer jobs", async () => {
        h.state.selectAnswers = [{ data: [recordOf(source)], error: null }]
        h.urlsLinkedByJobsSince.mockResolvedValue(new Set([FILE_URL]))

        const result = await retryFailedStorageDeletes()

        expect(h.urlsLinkedByJobsSince).not.toHaveBeenCalled()
        expect(h.batchDeleteFromR2).toHaveBeenCalledWith([FILE])
        expect(h.blankUrlsInEveryJobOutput).toHaveBeenCalledWith([FILE_URL])
        expect(result).toMatchObject({ retried: 1, deleted: 1, released: 0 })
      })
    })

    it("a retention record is counted and given up after the usual retries, never released by a newer job", async () => {
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
      h.state.selectAnswers = [{ data: [row(MAX_DELETE_RETRIES - 1, FILE, FILE_URL, JOB, RECORDED_AT, "retention")], error: null }]
      h.urlsLinkedByJobsSince.mockResolvedValue(new Set([FILE_URL]))
      h.batchDeleteFromR2.mockResolvedValue({ deleted: 0, errors: 1, notDeleted: [FILE] })

      const result = await retryFailedStorageDeletes()

      expect(h.state.updates[0]!.values).toMatchObject({ attempts: MAX_DELETE_RETRIES })
      expect(typeof h.state.updates[0]!.values.gave_up_at).toBe("string")
      expect(result).toMatchObject({ failed: 1, gaveUp: 1, released: 0 })
      errorLog.mockRestore()
    })

    it("in a mixed batch asks once, about the asset and media records only", async () => {
      const MEDIA = "videos/u-1/upload-1.mp4"
      const MEDIA_URL = `https://cdn.example.com/${MEDIA}`
      const LOC = "locations/main.png"
      h.state.selectAnswers = [{
        data: [
          recordOf("asset"),
          row(0, MEDIA, MEDIA_URL, null, RECORDED_AT, "media"),
          row(0, KEY, URL_, JOB, RECORDED_AT, "retention"),
          row(0, LOC, `https://cdn.example.com/${LOC}`, null, RECORDED_AT, "location"),
        ],
        error: null,
      }]
      // Even were a later job to link every one of them.
      h.urlsLinkedByJobsSince.mockResolvedValue(new Set([FILE_URL, MEDIA_URL, URL_, `https://cdn.example.com/${LOC}`]))

      const result = await retryFailedStorageDeletes()

      expect(h.urlsLinkedByJobsSince).toHaveBeenCalledTimes(1)
      expect(h.urlsLinkedByJobsSince.mock.calls[0]![0]).toEqual([
        expect.objectContaining({ url: FILE_URL }),
        expect.objectContaining({ url: MEDIA_URL }),
      ])
      expect(h.batchDeleteFromR2).toHaveBeenCalledWith([KEY, LOC])
      expect(result).toMatchObject({ retried: 2, released: 2 })
    })
  })
  it("a relay-owned file is never deleted either", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    h.deletableKeys.mockResolvedValue([])

    await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(h.state.deletes).toEqual([KEY])
  })

  it("deletes nothing when the guard lookup fails", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    h.keysHeldByOtherLibraryRows.mockRejectedValue(new Error("lookup down"))

    const result = await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(h.state.deletes).toEqual([])
    expect(result.errors).toBeGreaterThan(0)
  })

  it("keeps the record when the blanking fails, so the next pass finishes it", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    h.blankUrlsInEveryJobOutput.mockRejectedValue(new Error("blank down"))

    const result = await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).toHaveBeenCalledWith([KEY])
    expect(h.state.deletes).toEqual([])
    expect(result.errors).toBeGreaterThan(0)
  })

  it.each(["42P01", "PGRST205", "42703", "PGRST204"])(
    "is a no-op on a database without the record yet (%s)",
    async (code) => {
      h.state.selectAnswers = [{ data: null, error: { code, message: "missing" } }]
      const result = await retryFailedStorageDeletes()
      expect(result).toMatchObject({ retried: 0, errors: 0 })
      expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    },
  )

  it("stops the pass when counting an attempt fails, rather than re-reading the same records", async () => {
    h.state.selectAnswers = [
      { data: [row(0)], error: null },
      { data: [row(0)], error: null },
    ]
    h.batchDeleteFromR2.mockResolvedValue({ deleted: 0, errors: 1, notDeleted: [KEY] })
    h.state.updateAnswer = { data: null, error: { code: "57014", message: "timeout" } }

    const result = await retryFailedStorageDeletes()

    expect(h.batchDeleteFromR2).toHaveBeenCalledTimes(1)
    expect(result.errors).toBeGreaterThan(0)
  })
})

describe("failedKeys / keyFailures", () => {
  it("takes what storage did not confirm gone, minus what it keeps on purpose", () => {
    expect(failedKeys(["a", "b", "c"], { notDeleted: ["b", "c"], kept: ["c"] })).toEqual(["b"])
    expect(failedKeys(["a"], {})).toEqual([])
  })

  it("links an asset or location key by its public url", () => {
    const at = new Date()
    expect(keyFailures(["images/x.png"], "asset", {}, at)).toEqual([
      { key: "images/x.png", url: "https://cdn.example.com/images/x.png", source: "asset", jobId: null, attemptedAt: at },
    ])
  })
})

describe("the funnel (lib/storage-delete.ts)", () => {
  it("a batch delete records exactly the keys storage did not confirm gone, with their public url", async () => {
    h.batchDeleteFromR2.mockResolvedValue({ deleted: 1, errors: 1, notDeleted: ["b.png"], kept: [] })

    const out = await deleteKeysRecordingFailures(["a.png", "b.png"], "creature")

    expect(out.failed).toEqual(["b.png"])
    expect(h.state.upserts[0]!.rows).toEqual([recordedRow("b.png", "https://cdn.example.com/b.png", "creature", null)])
  })

  it("records the moment the delete BEGAN, taken before the delete call (independent review round)", async () => {
    // An object rewritten at the key after that moment is a new object the
    // retry must keep; a moment taken after the call would let one written in
    // between look old.
    let calledAt = 0
    h.batchDeleteFromR2.mockImplementation(async () => {
      calledAt = Date.now()
      await new Promise((r) => setTimeout(r, 5))
      return { deleted: 0, errors: 1, notDeleted: ["b.png"], kept: [] }
    })
    await deleteKeysRecordingFailures(["b.png"], "creature")
    const [recorded] = h.state.upserts[0]!.rows as Array<{ failed_at: string }>
    expect(Date.parse(recorded!.failed_at)).toBeLessThanOrEqual(calledAt)

    h.deleteFromR2.mockImplementation(async () => {
      calledAt = Date.now()
      await new Promise((r) => setTimeout(r, 5))
      throw new Error("R2 down")
    })
    await expect(deleteKeyRecordingFailure("videos/x.mp4", "media")).rejects.toThrow()
    const [single] = h.state.upserts[1]!.rows as Array<{ failed_at: string }>
    expect(Date.parse(single!.failed_at)).toBeLessThanOrEqual(calledAt)
  })

  it("records nothing when every delete succeeds", async () => {
    await deleteKeysRecordingFailures(["a.png"], "object")
    expect(h.state.upserts).toEqual([])
  })

  it("a failed record is logged by default and thrown on request", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
    h.batchDeleteFromR2.mockResolvedValue({ deleted: 0, errors: 1, notDeleted: ["a.png"], kept: [] })
    h.state.upsertAnswer = { data: null, error: { code: "57014", message: "timeout" } }

    await expect(deleteKeysRecordingFailures(["a.png"], "location")).resolves.toMatchObject({ failed: ["a.png"] })
    await expect(deleteKeysRecordingFailures(["a.png"], "location", { recordErrors: "throw" })).rejects.toThrow(/timeout/)
    errorLog.mockRestore()
  })

  it("a single failed delete is recorded, then rethrown so the caller's handling is unchanged", async () => {
    h.deleteFromR2.mockRejectedValue(new Error("R2 down"))

    await expect(deleteKeyRecordingFailure("videos/x.mp4", "media")).rejects.toThrow(/R2 down/)
    expect(h.state.upserts[0]!.rows).toEqual([recordedRow("videos/x.mp4", "https://cdn.example.com/videos/x.mp4", "media", null)])
  })

  it("a single delete that succeeds records nothing", async () => {
    h.deleteFromR2.mockResolvedValue(undefined)
    await deleteKeyRecordingFailure("videos/x.mp4", "media")
    expect(h.state.upserts).toEqual([])
  })

  it("never records a key storage refuses outright (a retained image or video)", async () => {
    await recordFailedDeletes([
      { key: "retained-videos/a.mp4", url: null, source: "plugin", jobId: null, attemptedAt: new Date() },
      { key: "videos/ok.mp4", url: null, source: "plugin", jobId: null, attemptedAt: new Date() },
    ])
    expect((h.state.upserts[0]!.rows as Array<{ r2_key: string }>).map((r) => r.r2_key)).toEqual(["videos/ok.mp4"])
  })
})

describe("the retry pass on every edition (startStorageDeleteRetry)", () => {
  it("runs a pass at start, with no edition gate", async () => {
    h.state.selectAnswers = [{ data: [row(0)], error: null }]
    const stop = startStorageDeleteRetry(() => {})
    await stop()
    expect(h.batchDeleteFromR2).toHaveBeenCalledWith([KEY])
  })

  it("does not start without object storage", async () => {
    h.state.storageConfigured = false
    const stop = startStorageDeleteRetry(() => {})
    await stop()
    expect(h.from).not.toHaveBeenCalled()
  })

  it("drops a record whose key storage would refuse outright, without trying it", async () => {
    h.state.selectAnswers = [{ data: [row(0, "retained-images/x.png", null, null)], error: null }]
    const result = await retryFailedStorageDeletes()
    expect(h.batchDeleteFromR2).not.toHaveBeenCalled()
    expect(h.state.deletes).toEqual(["retained-images/x.png"])
    expect(result.released).toBe(1)
  })
})
