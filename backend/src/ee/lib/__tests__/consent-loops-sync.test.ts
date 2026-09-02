import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/ee/lib/loops-client.js", () => ({
  updateContact: vi.fn(),
  isLoopsConfigured: vi.fn(() => true),
}))

import { syncConsentRow, sweepUnsyncedConsents } from "../consent-loops-sync.js"
import { supabase } from "../../../lib/supabase.js"
import { updateContact, isLoopsConfigured } from "../loops-client.js"

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
})

describe("sweepUnsyncedConsents", () => {
  it("returns 0 and does nothing when Loops is unconfigured", async () => {
    vi.mocked(isLoopsConfigured).mockReturnValue(false)
    const n = await sweepUnsyncedConsents()
    expect(n).toBe(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
