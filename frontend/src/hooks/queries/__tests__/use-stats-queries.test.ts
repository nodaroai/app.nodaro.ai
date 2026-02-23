import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockGetStats = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
}))

vi.mock("@/lib/api", () => ({
  getStats: (...args: unknown[]) => mockGetStats(...args),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    stats: {
      scoped: (scope: string, userId: string) => ["stats", scope, userId],
    },
  },
}))

import { useStats } from "../use-stats-queries"

describe("useStats", () => {
  beforeEach(() => {
    mockUseQuery.mockReset()
    mockGetStats.mockReset()
  })

  it("passes correct query key for user scope", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useStats("user", "u1")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["stats", "user", "u1"],
      })
    )
  })

  it("passes correct query key for platform scope", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useStats("platform", "u1")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["stats", "platform", "u1"],
      })
    )
  })

  it("is disabled when userId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useStats("user", undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is enabled when userId is provided", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useStats("user", "u1")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("has 10s stale time", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useStats("user", "u1")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(10_000)
  })

  it("passes through refetchInterval option", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useStats("user", "u1", { refetchInterval: 5000 })
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.refetchInterval).toBe(5000)
  })

  it("calls getStats in queryFn", async () => {
    mockUseQuery.mockReturnValue({ data: null })
    mockGetStats.mockResolvedValue({ data: { totalJobs: 10 } })
    useStats("user", "u1")
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(mockGetStats).toHaveBeenCalledWith("user", "u1")
    expect(result).toEqual({ totalJobs: 10 })
  })
})
