/**
 * useUpdateCheck: one /v1/version fetch per day per browser (localStorage
 * stamp + in-session memory), silent on failure. Policy lives server-side —
 * the hook is edition-blind by design.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, waitFor, cleanup } from "@testing-library/react"
import { useUpdateCheck, _resetUpdateCheckForTests } from "../use-update-check"

const fetchMock = vi.fn()

const INFO = {
  current: "1.23.0",
  latest: {
    version: "v2.0.0",
    url: "https://github.com/nodaroai/app.nodaro.ai/releases/tag/v2.0.0",
    publishedAt: "2026-08-19T00:00:00Z",
    highlights: "## Features\n- everything",
  },
  updateAvailable: true,
}

beforeEach(() => {
  _resetUpdateCheckForTests()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, json: async () => INFO })
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("useUpdateCheck", () => {
  it("fetches /v1/version and reports the update", async () => {
    const { result } = renderHook(() => useUpdateCheck())
    await waitFor(() => expect(result.current?.updateAvailable).toBe(true))
    expect(fetchMock).toHaveBeenCalledWith("/v1/version")
  })

  it("many consumers share ONE fetch, and the stamp survives a remount", async () => {
    const a = renderHook(() => useUpdateCheck())
    const b = renderHook(() => useUpdateCheck())
    await waitFor(() => expect(a.result.current).not.toBeNull())
    await waitFor(() => expect(b.result.current).not.toBeNull())
    a.unmount()
    b.unmount()
    const c = renderHook(() => useUpdateCheck())
    await waitFor(() => expect(c.result.current?.latest?.version).toBe("v2.0.0"))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a stale localStorage stamp refetches", async () => {
    localStorage.setItem(
      "nodaro-update-check",
      JSON.stringify({ at: Date.now() - 25 * 60 * 60 * 1000, info: { ...INFO, updateAvailable: false } }),
    )
    const { result } = renderHook(() => useUpdateCheck())
    await waitFor(() => expect(result.current?.updateAvailable).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a failed fetch stays silent — null, no throw, no dot", async () => {
    fetchMock.mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() => useUpdateCheck())
    await new Promise((r) => setTimeout(r, 30))
    expect(result.current).toBeNull()
  })
})
