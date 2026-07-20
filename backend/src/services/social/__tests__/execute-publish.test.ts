import { describe, it, expect, vi, beforeEach } from "vitest"

// ---- controllable provider -------------------------------------------------
const publishMock = vi.fn()
const testProvider = {
  id: "prov",
  label: "Prov",
  connectKind: "oauth2",
  capabilities: { schedule: true, comment: false, media: ["image"], refresh: "real" as string },
  oauth: {} as Record<string, unknown>,
  publisher: { publish: publishMock },
}
vi.mock("../providers/registry.js", () => ({
  getProvider: (id: string) => (id === "prov" ? testProvider : null),
}))

// ---- crypto stand-ins (reversible, assertable) ------------------------------
vi.mock("../encryption.js", () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ""),
}))

const refreshMock = vi.fn()
vi.mock("../oauth.js", () => ({
  refreshAccessToken: (...args: unknown[]) => refreshMock(...args),
}))

// ---- recording supabase fake ------------------------------------------------
let connectionRows: Array<Record<string, unknown>> = []
const updates: Array<{ table: string; patch: Record<string, unknown> }> = []
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from(table: string) {
      const b: Record<string, unknown> = {}
      const chain = (ret: unknown) => Object.assign(b, ret)
      chain({
        select: () => b,
        eq: () => b,
        limit: () => b,
        update: (patch: Record<string, unknown>) => {
          updates.push({ table, patch })
          return b
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: table === "social_connections" ? connectionRows : [], error: null }).then(resolve),
      })
      return b
    },
  },
}))

import { executePublish, NotConnectedError, UnknownOutcomeError } from "../execute-publish.js"
import { BadBodyError, NotPublishedError, RefreshTokenError } from "../providers/types.js"

const future = new Date(Date.now() + 3600_000).toISOString()
const past = new Date(Date.now() - 3600_000).toISOString()

function conn(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    user_id: "u1",
    platform: "prov",
    access_token_encrypted: "enc:tok-live",
    refresh_token_encrypted: null,
    token_expires_at: future,
    metadata: {},
    ...overrides,
  }
}

beforeEach(() => {
  publishMock.mockReset()
  refreshMock.mockReset()
  updates.length = 0
  connectionRows = []
  testProvider.capabilities.refresh = "real"
})

describe("executePublish", () => {
  it("publishes with the decrypted token and returns platform ids", async () => {
    connectionRows = [conn()]
    publishMock.mockResolvedValue({ success: true, platformPostId: "p1", platformPostUrl: "https://x/p1" })

    const res = await executePublish({
      userId: "u1",
      platform: "prov",
      request: { action: "post-image" },
    })
    expect(res).toEqual({ connectionId: "c1", platformPostId: "p1", platformPostUrl: "https://x/p1" })
    expect(publishMock).toHaveBeenCalledWith("tok-live", { action: "post-image" }, expect.any(Object))
  })

  it("throws NotConnectedError when no row matches", async () => {
    connectionRows = []
    await expect(
      executePublish({ userId: "u1", platform: "prov", request: { action: "post-image" } }),
    ).rejects.toBeInstanceOf(NotConnectedError)
  })

  it("wraps a mid-call throw as UnknownOutcomeError (never blind-retry)", async () => {
    connectionRows = [conn()]
    publishMock.mockRejectedValue(new Error("socket hang up"))
    await expect(
      executePublish({ userId: "u1", platform: "prov", request: { action: "post-image" } }),
    ).rejects.toBeInstanceOf(UnknownOutcomeError)
  })

  it("rethrows NotPublishedError untouched — a PROVEN non-publish is never 'may have published'", async () => {
    connectionRows = [conn()]
    publishMock.mockRejectedValue(
      new NotPublishedError("Instagram publish failed: media still not ready (code 9007)"),
    )

    const err = await executePublish({ userId: "u1", platform: "prov", request: { action: "post-image" } })
      .then(() => null)
      .catch((e) => e)

    expect(err).toBeInstanceOf(NotPublishedError)
    expect(err).not.toBeInstanceOf(UnknownOutcomeError)
    // The exact regression: 9007 used to reach the user as "MAY have been published".
    expect((err as Error).message).not.toMatch(/MAY have been published/)
  })

  it("rethrows a publisher-thrown BadBodyError untouched", async () => {
    connectionRows = [conn()]
    publishMock.mockRejectedValue(new BadBodyError("Instagram media processing failed (status_code=ERROR)"))
    await expect(
      executePublish({ userId: "u1", platform: "prov", request: { action: "post-image" } }),
    ).rejects.toBeInstanceOf(BadBodyError)
  })

  it("maps a definitive platform rejection to BadBodyError", async () => {
    connectionRows = [conn()]
    publishMock.mockResolvedValue({ success: false, error: "Caption too long" })
    await expect(
      executePublish({ userId: "u1", platform: "prov", request: { action: "post-image" } }),
    ).rejects.toBeInstanceOf(BadBodyError)
  })

  it("expired + no refresh on a reconnect provider -> RefreshTokenError(token_expired) + reconnect_needed", async () => {
    testProvider.capabilities.refresh = "reconnect"
    connectionRows = [conn({ token_expires_at: past })]

    const err = await executePublish({ userId: "u1", platform: "prov", request: { action: "post-image" } })
      .then(() => null)
      .catch((e) => e)
    expect(err).toBeInstanceOf(RefreshTokenError)
    expect((err as { code?: string }).code).toBe("token_expired")
    expect(updates.some((u) => u.table === "social_connections" && u.patch.reconnect_needed === true)).toBe(true)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it("expired + refresh succeeds -> publishes with the NEW token and stores it", async () => {
    connectionRows = [conn({ token_expires_at: past, refresh_token_encrypted: "enc:refresh-1" })]
    refreshMock.mockResolvedValue({ accessToken: "tok-new", refreshToken: "refresh-2", expiresIn: 3600 })
    publishMock.mockResolvedValue({ success: true })

    await executePublish({ userId: "u1", platform: "prov", request: { action: "post-image" } })

    expect(refreshMock).toHaveBeenCalledWith(testProvider, "refresh-1")
    expect(publishMock).toHaveBeenCalledWith("tok-new", expect.any(Object), expect.any(Object))
    const tokenUpdate = updates.find((u) => u.patch.access_token_encrypted === "enc:tok-new")
    expect(tokenUpdate).toBeDefined()
    expect(tokenUpdate!.patch.refresh_token_encrypted).toBe("enc:refresh-2")
    expect(tokenUpdate!.patch.reconnect_needed).toBe(false)
  })

  it("expired + refresh fails -> RefreshTokenError(refresh_failed)", async () => {
    connectionRows = [conn({ token_expires_at: past, refresh_token_encrypted: "enc:refresh-1" })]
    refreshMock.mockRejectedValue(new Error("invalid_grant"))

    const err = await executePublish({ userId: "u1", platform: "prov", request: { action: "post-image" } })
      .then(() => null)
      .catch((e) => e)
    expect(err).toBeInstanceOf(RefreshTokenError)
    expect((err as { code?: string }).code).toBe("refresh_failed")
    expect(publishMock).not.toHaveBeenCalled()
  })

  it("decrypts the page token and merges extra metadata", async () => {
    connectionRows = [conn({ metadata: { page_access_token: "enc:page-tok", page_id: "pg" } })]
    publishMock.mockResolvedValue({ success: true })

    await executePublish({
      userId: "u1",
      platform: "prov",
      request: { action: "post-image" },
      extraMetadata: { chatId: "42" },
    })
    const metadata = publishMock.mock.calls[0]![2] as Record<string, unknown>
    expect(metadata.page_access_token).toBe("page-tok")
    expect(metadata.page_id).toBe("pg")
    expect(metadata.chatId).toBe("42")
  })
})
