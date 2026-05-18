import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"

const mockInvalidateQueries = vi.fn()
const stableQueryClient = { invalidateQueries: mockInvalidateQueries }
const mockUseQueryClient = vi.fn(() => stableQueryClient)

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockUseQueryClient(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    assets: {
      locations: (projectId?: string, userId?: string) =>
        ["assets", "locations", projectId ?? "", userId ?? ""],
    },
  },
}))

import { useInvalidateLocation } from "../use-invalidate-location"

describe("useInvalidateLocation", () => {
  beforeEach(() => {
    mockInvalidateQueries.mockReset()
  })

  it("returns a callback that invalidates the assets.locations 4-tuple key", () => {
    const { result } = renderHook(() => useInvalidateLocation("proj-1", "user-1"))
    expect(typeof result.current).toBe("function")

    result.current()

    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1)
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["assets", "locations", "proj-1", "user-1"],
    })
  })

  it("handles undefined projectId / userId via the registry's coercion", () => {
    const { result } = renderHook(() =>
      useInvalidateLocation(undefined, undefined),
    )

    result.current()

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["assets", "locations", "", ""],
    })
  })

  it("returns a stable callback identity when inputs are unchanged", () => {
    const { result, rerender } = renderHook(
      ({ p, u }) => useInvalidateLocation(p, u),
      { initialProps: { p: "p1", u: "u1" } },
    )
    const firstCb = result.current
    rerender({ p: "p1", u: "u1" })
    expect(result.current).toBe(firstCb)
  })

  it("returns a new callback when projectId / userId change", () => {
    const { result, rerender } = renderHook(
      ({ p, u }) => useInvalidateLocation(p, u),
      { initialProps: { p: "p1", u: "u1" } },
    )
    const firstCb = result.current
    rerender({ p: "p2", u: "u1" })
    expect(result.current).not.toBe(firstCb)
  })
})
