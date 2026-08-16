/**
 * The connection store must tell "the instance is not connected" apart from
 * "the instance could not READ its connection". Boot-time provider
 * registration retries on the second and stops on the first; folding both
 * into `null` (as getNodaroConnection does for its callers) is what made the
 * cloud provider silently miss registration on every community boot — the
 * read raced the container's own proxy and looked like "not connected".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { maybeSingleMock, mockConfig } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn<() => Promise<{ data: unknown; error: { message: string } | null }>>(),
  mockConfig: { NODARO_API_KEY: "" as string, NODARO_CLOUD_URL: "" as string },
}))

vi.mock("../config.js", () => ({ config: mockConfig }))

vi.mock("../supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: maybeSingleMock,
        }),
      }),
    })),
  },
}))

import {
  clearNodaroConnection,
  getNodaroConnection,
  getNodaroCredential,
  isNodaroConnected,
  readNodaroConnectionState,
} from "../nodaro-connect.js"

beforeEach(() => {
  maybeSingleMock.mockReset()
  mockConfig.NODARO_API_KEY = ""
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("readNodaroConnectionState", () => {
  it("is 'unavailable' when the store cannot be read (transport error)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "TypeError: fetch failed" } })
    expect(await readNodaroConnectionState()).toEqual({ state: "unavailable", reason: "TypeError: fetch failed" })
  })

  it("is 'not-connected' when no row exists", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "not-connected" })
  })

  it("is 'not-connected' when registration started but the OAuth flow never finished", async () => {
    maybeSingleMock.mockResolvedValue({
      data: { value: { clientId: "ndr_dcr_x", clientSecret: "s" } },
      error: null,
    })
    expect(await readNodaroConnectionState()).toEqual({ state: "not-connected" })
  })

  it("is 'connected' once a token is stored (JSON string or object value)", async () => {
    const conn = { clientId: "ndr_dcr_x", clientSecret: "s", accessToken: "ndr_app_t", connectedAt: "2026-08-16T00:00:00Z" }
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "oauth", connection: conn })

    maybeSingleMock.mockResolvedValue({ data: { value: JSON.stringify(conn) }, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "oauth", connection: conn })
  })

  it("is 'unavailable' when the read throws", async () => {
    maybeSingleMock.mockRejectedValue(new Error("socket hang up"))
    expect(await readNodaroConnectionState()).toEqual({ state: "unavailable", reason: "socket hang up" })
  })
})

// NODARO_API_KEY: nodaro.ai as a provider like the other six — a personal API
// token from app.nodaro.ai (Settings -> API) pasted into .env. It is a
// CREDENTIAL, not a registration: the OAuth flow's stored client_id/secret
// stay in getNodaroConnection(); everything that only needs to CALL the cloud
// asks getNodaroCredential(). A stored OAuth connection wins over the env key
// (it carries per-instance caps and Connected Instances visibility).
describe("NODARO_API_KEY as the credential", () => {
  const conn = { clientId: "c", clientSecret: "s", accessToken: "ndr_app_oauth", connectedAt: "2026-08-16T00:00:00Z" }

  it("is used when nothing is stored", async () => {
    mockConfig.NODARO_API_KEY = "ndr_personal_key"
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_personal_key", source: "env" })
    expect(await isNodaroConnected()).toBe(true)
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "env" })
  })

  it("loses to a stored OAuth connection", async () => {
    mockConfig.NODARO_API_KEY = "ndr_personal_key"
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_app_oauth", source: "oauth" })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "oauth", connection: conn })
  })

  it("makes the boot path race-free: an unreadable store still yields connected via env", async () => {
    // The whole reason the provider registration retries is that the store is
    // behind the container's own proxy at boot. With an env key there is
    // nothing to wait for.
    mockConfig.NODARO_API_KEY = "ndr_personal_key"
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "TypeError: fetch failed" } })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", source: "env" })
    expect(await getNodaroCredential()).toEqual({ token: "ndr_personal_key", source: "env" })
  })

  it("does not masquerade as a registration for the OAuth flow", async () => {
    mockConfig.NODARO_API_KEY = "ndr_personal_key"
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    // /start must still see "not registered" and register properly.
    expect(await getNodaroConnection()).toBeNull()
  })

  it("is trimmed and ignored when blank", async () => {
    mockConfig.NODARO_API_KEY = "   "
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await getNodaroCredential()).toBeNull()
    expect(await isNodaroConnected()).toBe(false)
  })
})

describe("getNodaroConnection / isNodaroConnected keep their null-on-failure contract", () => {
  it("returns null and false on a transport error", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "fetch failed" } })
    expect(await getNodaroConnection()).toBeNull()
    expect(await isNodaroConnected()).toBe(false)
  })

  it("returns the connection and true when connected", async () => {
    const conn = { clientId: "c", clientSecret: "s", accessToken: "t" }
    maybeSingleMock.mockResolvedValue({ data: { value: conn }, error: null })
    expect(await getNodaroConnection()).toEqual(conn)
    expect(await isNodaroConnected()).toBe(true)
  })
})

describe("clearNodaroConnection keeps the instance's DCR client (#708)", () => {
  it("drops the tokens but writes the clientId/clientSecret back — the next Connect reuses the registration", async () => {
    const stored = { clientId: "ndr_dcr_1", clientSecret: "s3cr3t", accessToken: "ndr_app_tok", connectedAt: "2026-08-16T16:05:41Z" }
    maybeSingleMock.mockResolvedValue({ data: { value: stored }, error: null })
    const { supabase } = await import("../supabase.js")
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const del = vi.fn()
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock }) }),
      upsert,
      delete: del,
    })) as never)

    await clearNodaroConnection()

    expect(del).not.toHaveBeenCalled()
    expect(upsert).toHaveBeenCalledTimes(1)
    const row = upsert.mock.calls[0]![0] as { key: string; value: Record<string, unknown> }
    expect(row.value).toEqual({ clientId: "ndr_dcr_1", clientSecret: "s3cr3t" })
    expect(row.value).not.toHaveProperty("accessToken")
    expect(row.value).not.toHaveProperty("connectedAt")
  })

  it("is a no-op when nothing is stored", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const { supabase } = await import("../supabase.js")
    const upsert = vi.fn()
    vi.mocked(supabase.from).mockImplementation((() => ({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock }) }),
      upsert,
      delete: vi.fn(),
    })) as never)
    await clearNodaroConnection()
    expect(upsert).not.toHaveBeenCalled()
  })
})
