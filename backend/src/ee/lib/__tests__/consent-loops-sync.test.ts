import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/config.js", () => ({ config: { LOOPS_API_KEY: "test-key" } }))
// Real constants flow through; only the calls that leave the process are doubled.
vi.mock("@/ee/lib/loops-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../loops-client.js")>()),
  updateContact: vi.fn(),
  isLoopsConfigured: vi.fn(() => true),
}))
// Whether the `language` property exists in the Loops account is its own unit
// (loops-contact-properties.test.ts); the sync only needs the answer.
vi.mock("@/ee/lib/loops-contact-properties.js", () => ({
  languageProperty: { ensure: vi.fn(), forget: vi.fn() },
}))

import { syncConsentRow, sweepUnsyncedConsents } from "../consent-loops-sync.js"
import { supabase } from "../../../lib/supabase.js"
import { updateContact, isLoopsConfigured } from "../loops-client.js"
import { languageProperty } from "../loops-contact-properties.js"

// A supabase query-builder mock that is BOTH chainable and awaitable, so
// `.select().eq().eq().maybeSingle()` (read) and `.update().eq().eq()` (write)
// both resolve the supplied result.
function builder(result: unknown) {
  const b: Record<string, unknown> = {}
  const ret = () => b
  b.select = vi.fn(ret)
  b.update = vi.fn(ret)
  b.eq = vi.fn(ret)
  b.in = vi.fn(ret)
  b.limit = vi.fn(ret)
  b.maybeSingle = vi.fn().mockResolvedValue(result)
  ;(b as { then: unknown }).then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return b
}

function updatePayload(b: Record<string, unknown>): Record<string, unknown> {
  return (b.update as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isLoopsConfigured).mockReturnValue(true)
  vi.mocked(languageProperty.ensure).mockResolvedValue(true)
})

describe("syncConsentRow", () => {
  it("no-ops entirely when Loops is not configured", async () => {
    vi.mocked(isLoopsConfigured).mockReturnValue(false)
    await syncConsentRow("u1")
    expect(supabase.from).not.toHaveBeenCalled()
    expect(updateContact).not.toHaveBeenCalled()
  })

  it("clears dirty without any Loops call when the user never granted", async () => {
    const clearB = builder({ error: null })
    vi.mocked(supabase.from)
      .mockReturnValueOnce(builder({ data: { status: "declined", granted_at: null, source_app: null, loops_sync_attempts: 0 } }) as never)
      .mockReturnValueOnce(clearB as never)
    await syncConsentRow("u1")
    expect(updateContact).not.toHaveBeenCalled()
    expect(updatePayload(clearB).loops_dirty).toBe(false)
  })

  it("subscribes a granted user (firstName from full_name)", async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(builder({ data: { status: "granted", granted_at: "t", source_app: "app", loops_sync_attempts: 0 } }) as never)
      .mockReturnValueOnce(builder({ data: { email: "a@b.com", full_name: "Ann Lee" } }) as never)
      .mockReturnValueOnce(builder({ error: null }) as never)
    vi.mocked(updateContact).mockResolvedValue({ ok: true, status: 200 })
    await syncConsentRow("u1")
    expect(updateContact).toHaveBeenCalledWith("a@b.com", expect.objectContaining({ subscribed: true, firstName: "Ann" }))
  })

  it("unsubscribes a withdrawn user who had granted", async () => {
    vi.mocked(supabase.from)
      .mockReturnValueOnce(builder({ data: { status: "withdrawn", granted_at: "t", source_app: null, loops_sync_attempts: 0 } }) as never)
      .mockReturnValueOnce(builder({ data: { email: "a@b.com", full_name: null } }) as never)
      .mockReturnValueOnce(builder({ error: null }) as never)
    vi.mocked(updateContact).mockResolvedValue({ ok: true, status: 200 })
    await syncConsentRow("u1")
    expect(updateContact).toHaveBeenCalledWith("a@b.com", expect.objectContaining({ subscribed: false }))
  })

  it("increments attempts and keeps the row dirty on a failed push below the cap", async () => {
    const updateB = builder({ error: null })
    vi.mocked(supabase.from)
      .mockReturnValueOnce(builder({ data: { status: "granted", granted_at: "t", source_app: null, loops_sync_attempts: 1 } }) as never)
      .mockReturnValueOnce(builder({ data: { email: "a@b.com", full_name: null } }) as never)
      .mockReturnValueOnce(updateB as never)
    vi.mocked(updateContact).mockResolvedValue({ ok: false, status: 500 })
    await syncConsentRow("u1")
    const p = updatePayload(updateB)
    expect(p.loops_sync_attempts).toBe(2)
    expect(p.loops_dirty).toBe(true)
    expect(p.loops_sync_status).toBe("error")
  })

  it("gives up (clears dirty) once the max attempts is reached", async () => {
    const updateB = builder({ error: null })
    vi.mocked(supabase.from)
      .mockReturnValueOnce(builder({ data: { status: "granted", granted_at: "t", source_app: null, loops_sync_attempts: 4 } }) as never)
      .mockReturnValueOnce(builder({ data: { email: "a@b.com", full_name: null } }) as never)
      .mockReturnValueOnce(updateB as never)
    vi.mocked(updateContact).mockResolvedValue({ ok: false, status: 500 })
    await syncConsentRow("u1")
    const p = updatePayload(updateB)
    expect(p.loops_sync_attempts).toBe(5)
    expect(p.loops_dirty).toBe(false)
  })

  describe("the customer's language", () => {
    const grantedRow = (extra: Record<string, unknown> = {}) =>
      builder({ data: { status: "granted", granted_at: "t", source_app: "studio", locale: "ja", loops_sync_attempts: 0, ...extra } })
    const profileRow = () => builder({ data: { email: "a@b.com", full_name: "Ann Lee" } })
    /** The properties object handed to Loops by the nth `updateContact` call. */
    const sentToLoops = (call = 0) => vi.mocked(updateContact).mock.calls[call][1] as Record<string, unknown>

    it("sends the language the consent was given in", async () => {
      const updateB = builder({ error: null })
      vi.mocked(supabase.from)
        .mockReturnValueOnce(grantedRow() as never)
        .mockReturnValueOnce(profileRow() as never)
        .mockReturnValueOnce(updateB as never)
      vi.mocked(updateContact).mockResolvedValue({ ok: true, status: 200 })

      await syncConsentRow("u1")

      expect(updateContact).toHaveBeenCalledTimes(1)
      expect(updateContact).toHaveBeenCalledWith("a@b.com", expect.objectContaining({ subscribed: true, source: "studio", language: "ja" }))
      expect(updatePayload(updateB)).toMatchObject({ loops_dirty: false, loops_sync_status: "synced" })
    })

    it("leaves the key out entirely when no language is known", async () => {
      const updateB = builder({ error: null })
      vi.mocked(supabase.from)
        .mockReturnValueOnce(grantedRow({ locale: null }) as never)
        .mockReturnValueOnce(profileRow() as never)
        .mockReturnValueOnce(updateB as never)
      vi.mocked(updateContact).mockResolvedValue({ ok: true, status: 200 })

      await syncConsentRow("u1")

      // Absent, not undefined/null/"": a row with no language must not overwrite one Loops already has.
      expect(sentToLoops()).not.toHaveProperty("language")
      expect(updatePayload(updateB)).toMatchObject({ loops_dirty: false, loops_sync_status: "synced" })
    })

    it("checks the property before it reads the row — never between reading it and pushing it", async () => {
      vi.mocked(supabase.from)
        .mockReturnValueOnce(grantedRow() as never)
        .mockReturnValueOnce(profileRow() as never)
        .mockReturnValueOnce(builder({ error: null }) as never)
      vi.mocked(updateContact).mockResolvedValue({ ok: true, status: 200 })

      await syncConsentRow("u1")

      // Cold, the check can take up to three Loops calls; a withdrawal landing
      // inside that gap would be answered by two pushes in no fixed order.
      const checkedAt = vi.mocked(languageProperty.ensure).mock.invocationCallOrder[0]
      const readAt = vi.mocked(supabase.from).mock.invocationCallOrder[0]
      expect(checkedAt).toBeLessThan(readAt)
    })

    it("pushes the subscription without the language, and counts the row as mirrored, when the property cannot be confirmed", async () => {
      vi.mocked(languageProperty.ensure).mockResolvedValue(false)
      const updateB = builder({ error: null })
      vi.mocked(supabase.from)
        .mockReturnValueOnce(grantedRow() as never)
        .mockReturnValueOnce(profileRow() as never)
        .mockReturnValueOnce(updateB as never)
      vi.mocked(updateContact).mockResolvedValue({ ok: true, status: 200 })

      await syncConsentRow("u1")

      expect(updateContact).toHaveBeenCalledTimes(1)
      expect(sentToLoops()).toMatchObject({ subscribed: true })
      expect(sentToLoops()).not.toHaveProperty("language")
      // Mirrored exactly as before the language existed: a granted contact that
      // Loops accepted is not pushed again, because the hourly sweep re-sending
      // `subscribed: true` could undo an unsubscribe made from an email.
      expect(updatePayload(updateB)).toMatchObject({ loops_dirty: false, loops_sync_attempts: 0, loops_sync_status: "synced" })
    })

    it("sends the contact again without the language when Loops refuses an update that carried it — and says why", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const updateB = builder({ error: null })
      vi.mocked(supabase.from)
        .mockReturnValueOnce(grantedRow() as never)
        .mockReturnValueOnce(profileRow() as never)
        .mockReturnValueOnce(updateB as never)
      vi.mocked(updateContact)
        .mockResolvedValueOnce({ ok: false, status: 400, error: "unknown property" })
        .mockResolvedValueOnce({ ok: true, status: 200 })

      await syncConsentRow("u1")

      expect(updateContact).toHaveBeenCalledTimes(2)
      expect(sentToLoops(0)).toHaveProperty("language", "ja")
      expect(sentToLoops(1)).not.toHaveProperty("language")
      expect(sentToLoops(1)).toMatchObject({ subscribed: true, source: "studio" })
      // The property may have been removed from the account: look again next time.
      expect(languageProperty.forget).toHaveBeenCalledTimes(1)
      expect(updatePayload(updateB)).toMatchObject({ loops_dirty: false, loops_sync_attempts: 0, loops_sync_status: "synced" })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain("400")
      warn.mockRestore()
    })

    it("is an ordinary failed sync when the plain push fails too", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const updateB = builder({ error: null })
      vi.mocked(supabase.from)
        .mockReturnValueOnce(grantedRow() as never)
        .mockReturnValueOnce(profileRow() as never)
        .mockReturnValueOnce(updateB as never)
      vi.mocked(updateContact)
        .mockResolvedValueOnce({ ok: false, status: 400, error: "unknown property" })
        .mockResolvedValueOnce({ ok: false, status: 500 })

      await syncConsentRow("u1")

      expect(updatePayload(updateB)).toMatchObject({ loops_dirty: true, loops_sync_attempts: 1, loops_sync_status: "error" })
      warn.mockRestore()
    })

    it.each([
      ["a rate limit", { ok: false, status: 429 }],
      ["a revoked key", { ok: false, status: 401 }],
      ["a key without access", { ok: false, status: 403 }],
      ["a server error", { ok: false, status: 500 }],
      ["a network failure", { ok: false, error: "network down" }],
    ])("does not send it again without the language after %s", async (_label, failure) => {
      const updateB = builder({ error: null })
      vi.mocked(supabase.from)
        .mockReturnValueOnce(grantedRow() as never)
        .mockReturnValueOnce(profileRow() as never)
        .mockReturnValueOnce(updateB as never)
      vi.mocked(updateContact).mockResolvedValue(failure)

      await syncConsentRow("u1")

      expect(updateContact).toHaveBeenCalledTimes(1)
      expect(languageProperty.forget).not.toHaveBeenCalled()
      expect(updatePayload(updateB)).toMatchObject({ loops_dirty: true, loops_sync_attempts: 1, loops_sync_status: "error" })
    })

    it("reads the row without the language column while the column has not reached this database", async () => {
      const withLocale = builder({ data: null, error: { code: "42703", message: 'column user_consents.locale does not exist' } })
      const withoutLocale = builder({ data: { status: "granted", granted_at: "t", source_app: "studio", loops_sync_attempts: 0 } })
      const updateB = builder({ error: null })
      vi.mocked(supabase.from)
        .mockReturnValueOnce(withLocale as never)
        .mockReturnValueOnce(withoutLocale as never)
        .mockReturnValueOnce(profileRow() as never)
        .mockReturnValueOnce(updateB as never)
      vi.mocked(updateContact).mockResolvedValue({ ok: true, status: 200 })

      await syncConsentRow("u1")

      const selected = (b: Record<string, unknown>) => (b.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
      expect(selected(withLocale)).toContain("locale")
      expect(selected(withoutLocale)).not.toContain("locale")
      expect(updateContact).toHaveBeenCalledWith("a@b.com", expect.objectContaining({ subscribed: true }))
      expect(sentToLoops()).not.toHaveProperty("language")
      expect(updatePayload(updateB)).toMatchObject({ loops_dirty: false, loops_sync_status: "synced" })
    })

    it("does not read the row a second time for any other error", async () => {
      vi.mocked(supabase.from).mockReturnValueOnce(builder({ data: null, error: { code: "XX000", message: "boom" } }) as never)

      await syncConsentRow("u1")

      expect(supabase.from).toHaveBeenCalledTimes(1)
      expect(updateContact).not.toHaveBeenCalled()
    })
  })
})

describe("sweepUnsyncedConsents", () => {
  it("returns 0 and does nothing when Loops is unconfigured", async () => {
    vi.mocked(isLoopsConfigured).mockReturnValue(false)
    const n = await sweepUnsyncedConsents()
    expect(n).toBe(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
