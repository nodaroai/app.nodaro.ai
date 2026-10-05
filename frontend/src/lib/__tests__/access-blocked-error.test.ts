import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockGetSession = vi.fn()
vi.mock("@/lib/supabase", () => ({
  createClient: () => ({ auth: { getSession: mockGetSession } }),
}))

import { getUserCredits, AccessBlockedError } from "../api"
import { ACCESS_BLOCKED_EVENT } from "../access-blocked-event"

/**
 * `403 access_blocked` — an admin blocked this account or its network. Every
 * REST call funnels through `throwApiError`, so ONE mapping covers the whole
 * app: the typed error for the caller, and the window event the root-level
 * AccessBlockedScreen listens for.
 */
describe("access_blocked → AccessBlockedError + event", () => {
  const originalFetch = globalThis.fetch
  let code = "access_blocked"

  beforeEach(() => {
    code = "access_blocked"
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } })
    globalThis.fetch = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ error: { code, message: "Access has been blocked." } }),
      text: () => Promise.resolve(""),
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it("throws the typed error", async () => {
    await expect(getUserCredits("u1")).rejects.toBeInstanceOf(AccessBlockedError)
  })

  it("dispatches the access-blocked event before throwing", async () => {
    const seen = vi.fn()
    window.addEventListener(ACCESS_BLOCKED_EVENT, seen)
    try {
      await getUserCredits("u1").catch(() => {})
      expect(seen).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener(ACCESS_BLOCKED_EVENT, seen)
    }
  })

  it("does not fire for an ordinary 403", async () => {
    code = "forbidden"
    const seen = vi.fn()
    window.addEventListener(ACCESS_BLOCKED_EVENT, seen)
    try {
      const err = await getUserCredits("u1").catch((e: unknown) => e)
      expect(err).not.toBeInstanceOf(AccessBlockedError)
      expect(seen).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(ACCESS_BLOCKED_EVENT, seen)
    }
  })
})
