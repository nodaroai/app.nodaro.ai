/**
 * The connection store must tell "the instance is not connected" apart from
 * "the instance could not READ its connection". Boot-time provider
 * registration retries on the second and stops on the first; folding both
 * into `null` (as getNodaroConnection does for its callers) is what made the
 * cloud provider silently miss registration on every community boot — the
 * read raced the container's own proxy and looked like "not connected".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { maybeSingleMock } = vi.hoisted(() => ({
  maybeSingleMock: vi.fn<() => Promise<{ data: unknown; error: { message: string } | null }>>(),
}))

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

import { getNodaroConnection, isNodaroConnected, readNodaroConnectionState } from "../nodaro-connect.js"

beforeEach(() => {
  maybeSingleMock.mockReset()
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
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", connection: conn })

    maybeSingleMock.mockResolvedValue({ data: { value: JSON.stringify(conn) }, error: null })
    expect(await readNodaroConnectionState()).toEqual({ state: "connected", connection: conn })
  })

  it("is 'unavailable' when the read throws", async () => {
    maybeSingleMock.mockRejectedValue(new Error("socket hang up"))
    expect(await readNodaroConnectionState()).toEqual({ state: "unavailable", reason: "socket hang up" })
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
