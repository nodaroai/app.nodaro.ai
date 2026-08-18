/**
 * useNodaroConnection — the shared connection read (4b). Contract:
 *   - cloud builds are statically connected: NO fetch, ever;
 *   - self-host: one fetch per TTL window shared across all consumers;
 *   - a failed read degrades to unconnected (safe CTA default), never throws;
 *   - invalidateNodaroConnectionCache() forces the next read to refetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor, cleanup } from "@testing-library/react"

const editionMock = vi.hoisted(() => ({ hasCredits: vi.fn(() => false) }))
vi.mock("@/lib/edition", () => ({ hasCredits: editionMock.hasCredits, isCloud: () => false }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer t" })) }))

import {
  useNodaroConnection,
  invalidateNodaroConnectionCache,
  _resetNodaroConnectionCacheForTests,
} from "../use-nodaro-connection"

const fetchMock = vi.fn()

beforeEach(() => {
  _resetNodaroConnectionCacheForTests()
  editionMock.hasCredits.mockReturnValue(false)
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ connected: true }) })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("useNodaroConnection", () => {
  it("cloud: statically connected, zero fetches", () => {
    editionMock.hasCredits.mockReturnValue(true)
    const { result } = renderHook(() => useNodaroConnection())
    expect(result.current).toEqual({ connected: true, checked: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("self-host: resolves connected from the status endpoint", async () => {
    const { result } = renderHook(() => useNodaroConnection())
    expect(result.current.checked).toBe(false)
    await waitFor(() => expect(result.current).toEqual({ connected: true, checked: true }))
    expect(fetchMock).toHaveBeenCalledWith("/v1/nodaro-connect/status", expect.anything())
  })

  it("many consumers share ONE fetch per TTL window", async () => {
    const a = renderHook(() => useNodaroConnection())
    const b = renderHook(() => useNodaroConnection())
    const c = renderHook(() => useNodaroConnection())
    await waitFor(() => expect(a.result.current.checked).toBe(true))
    await waitFor(() => expect(b.result.current.checked).toBe(true))
    await waitFor(() => expect(c.result.current.checked).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a failed read degrades to unconnected — the CTA is the safe default", async () => {
    fetchMock.mockRejectedValue(new Error("network down"))
    const { result } = renderHook(() => useNodaroConnection())
    await waitFor(() => expect(result.current.checked).toBe(true))
    expect(result.current.connected).toBe(false)
  })

  it("invalidate forces a refetch (connect/disconnect actions call it)", async () => {
    const first = renderHook(() => useNodaroConnection())
    await waitFor(() => expect(first.result.current.checked).toBe(true))
    first.unmount()
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ connected: false }) })
    invalidateNodaroConnectionCache()
    const second = renderHook(() => useNodaroConnection())
    await waitFor(() => expect(second.result.current).toEqual({ connected: false, checked: true }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
