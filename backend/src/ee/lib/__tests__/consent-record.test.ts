import { describe, it, expect, vi, beforeEach } from "vitest"
import type { FastifyBaseLogger } from "fastify"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/lib/consent-config.js", () => ({ getConsentConfig: vi.fn() }))
// recordConsentGrant invalidates the balance cache through a lazy import.
vi.mock("@/ee/billing/balance-cache.js", () => ({ invalidateBalanceCache: vi.fn() }))

import { recordConsentGrant, recordConsentOptOut } from "../consent-record.js"
import { supabase } from "../../../lib/supabase.js"
import { getConsentConfig } from "../consent-config.js"

const USER = "00000000-0000-4000-8000-000000000001"

const warn = vi.fn()
const log = { warn } as unknown as FastifyBaseLogger

/** user_consents answers `upsert`; any other table (the profiles mark) just succeeds. */
function mockTables(upsert: ReturnType<typeof vi.fn>) {
  vi.mocked(supabase.from).mockImplementation(((table: string) =>
    table === "user_consents"
      ? { upsert }
      : { update: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }) }) as never)
}

const NO_COLUMN = { code: "PGRST204", message: "Could not find the 'locale' column of 'user_consents' in the schema cache" }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getConsentConfig).mockResolvedValue({ version: 4 } as never)
})

describe("recordConsentGrant", () => {
  it("records the grant with the language it was given in", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockTables(upsert)

    const result = await recordConsentGrant(USER, "studio", "ja", log)

    expect(result).toEqual({ error: null })
    expect(upsert).toHaveBeenCalledTimes(1)
    const [row, options] = upsert.mock.calls[0]
    expect(row).toMatchObject({
      user_id: USER,
      kind: "marketing_email",
      status: "granted",
      consent_version: 4,
      source_app: "studio",
      locale: "ja",
      loops_dirty: true,
      declined_at: null,
      withdrawn_at: null,
    })
    expect(options).toEqual({ onConflict: "user_id,kind" })
  })

  it("writes null — 'not recorded' — when the client did not say", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockTables(upsert)

    await recordConsentGrant(USER, null, null, log)

    // The key is present and null: a later grant with no language must not
    // leave an EARLIER consent's language standing as this one's.
    expect(upsert.mock.calls[0][0]).toHaveProperty("locale", null)
  })

  it("a later grant in another language replaces the recorded one", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockTables(upsert)

    await recordConsentGrant(USER, "app", "ja", log)
    await recordConsentGrant(USER, "app", "en", log)

    expect(upsert.mock.calls.map(([row]) => row.locale)).toEqual(["ja", "en"])
  })

  it.each([["PGRST204 (schema cache)", NO_COLUMN], ["42703 (undefined column)", { code: "42703", message: 'column "locale" does not exist' }]])(
    "records the grant without the language while the column has not reached this database — %s",
    async (_label, columnError) => {
      const upsert = vi.fn().mockResolvedValueOnce({ error: columnError }).mockResolvedValueOnce({ error: null })
      mockTables(upsert)

      const result = await recordConsentGrant(USER, "studio", "ja", log)

      expect(result).toEqual({ error: null })
      expect(upsert).toHaveBeenCalledTimes(2)
      expect(upsert.mock.calls[0][0]).toHaveProperty("locale", "ja")
      const retried = upsert.mock.calls[1][0]
      expect(retried).not.toHaveProperty("locale")
      expect(retried).toMatchObject({ user_id: USER, status: "granted", source_app: "studio", loops_dirty: true })
      expect(warn).toHaveBeenCalledTimes(1)
    },
  )

  it("does not retry for any other database error", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { code: "23503", message: "violates foreign key" } })
    mockTables(upsert)

    const result = await recordConsentGrant(USER, "studio", "ja", log)

    expect(result).toEqual({ error: "violates foreign key" })
    expect(upsert).toHaveBeenCalledTimes(1)
  })

  it("returns the retry's error when the write without the language fails too", async () => {
    const upsert = vi
      .fn()
      .mockResolvedValueOnce({ error: NO_COLUMN })
      .mockResolvedValueOnce({ error: { code: "08006", message: "connection lost" } })
    mockTables(upsert)

    expect(await recordConsentGrant(USER, "studio", "ja", log)).toEqual({ error: "connection lost" })
  })
})

describe("recordConsentOptOut", () => {
  it("records a decline with the language it was answered in", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockTables(upsert)

    const result = await recordConsentOptOut(USER, "declined", "ko", log)

    expect(result).toEqual({ error: null })
    expect(upsert.mock.calls[0][0]).toMatchObject({
      user_id: USER,
      kind: "marketing_email",
      status: "declined",
      locale: "ko",
      loops_dirty: true,
      declined_at: expect.any(String),
    })
    expect(upsert.mock.calls[0][0]).not.toHaveProperty("withdrawn_at")
  })

  it("records a withdrawal with the language it was answered in", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockTables(upsert)

    await recordConsentOptOut(USER, "withdrawn", "he", log)

    expect(upsert.mock.calls[0][0]).toMatchObject({ status: "withdrawn", locale: "he", withdrawn_at: expect.any(String) })
    expect(upsert.mock.calls[0][0]).not.toHaveProperty("declined_at")
  })

  it("leaves the recorded language alone when the client names none", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    mockTables(upsert)

    await recordConsentOptOut(USER, "withdrawn", null, log)

    // No `locale` key at all: an opt-out from an older client must not erase
    // the language the grant it is withdrawing was given in.
    expect(upsert.mock.calls[0][0]).not.toHaveProperty("locale")
  })

  it("writes again without the language while the column has not reached this database", async () => {
    const upsert = vi.fn().mockResolvedValueOnce({ error: NO_COLUMN }).mockResolvedValueOnce({ error: null })
    mockTables(upsert)

    const result = await recordConsentOptOut(USER, "declined", "ko", log)

    expect(result).toEqual({ error: null })
    expect(upsert.mock.calls[1][0]).not.toHaveProperty("locale")
    expect(upsert.mock.calls[1][0]).toMatchObject({ status: "declined", loops_dirty: true })
  })

  it("does not retry an opt-out that named no language — there is nothing to leave out", async () => {
    const upsert = vi.fn().mockResolvedValue({ error: NO_COLUMN })
    mockTables(upsert)

    const result = await recordConsentOptOut(USER, "declined", null, log)

    expect(result.error).toBe(NO_COLUMN.message)
    expect(upsert).toHaveBeenCalledTimes(1)
  })
})
