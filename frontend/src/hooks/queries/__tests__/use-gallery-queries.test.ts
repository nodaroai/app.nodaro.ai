import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseInfiniteQuery = vi.fn()
const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockUseQueryClient = vi.fn()
const mockUseAuth = vi.fn()
const mockHasAdmin = vi.fn()
const mockGetAuthHeaders = vi.fn()
const mockFetch = vi.fn()
const mockInvalidateQueries = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useInfiniteQuery: (opts: unknown) => mockUseInfiniteQuery(opts),
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useMutation: (opts: unknown) => mockUseMutation(opts),
  useQueryClient: () => mockUseQueryClient(),
}))

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock("@/lib/edition", () => ({
  hasAdmin: () => mockHasAdmin(),
}))

vi.mock("@/lib/api", () => ({
  getAuthHeaders: () => mockGetAuthHeaders(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    gallery: {
      all: ["gallery"],
      list: (filter: string) => ["gallery", "list", filter],
      favorites: (userId: string) => ["gallery", "favorites", userId],
      reportCount: () => ["gallery", "report-count"],
    },
  },
}))

import {
  useGalleryInfinite,
  useGalleryReportCount,
  useReportGalleryItemMutation,
  useDeleteGalleryItemMutation,
  useToggleFavoriteMutation,
} from "../use-gallery-queries"

describe("useGalleryInfinite", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passes correct query key with filter", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useGalleryInfinite("image")
    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["gallery", "list", "image"],
      })
    )
  })

  it("passes correct query key for 'all' filter", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useGalleryInfinite("all")
    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["gallery", "list", "all"],
      })
    )
  })

  it("has staleTime of 30_000", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useGalleryInfinite("video")
    const opts = mockUseInfiniteQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(30_000)
  })

  it("getNextPageParam returns nextCursor when present", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useGalleryInfinite("all")
    const opts = mockUseInfiniteQuery.mock.calls[0][0]
    const result = opts.getNextPageParam({ data: [], nextCursor: "abc123" })
    expect(result).toBe("abc123")
  })

  it("getNextPageParam returns undefined when nextCursor is null", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useGalleryInfinite("all")
    const opts = mockUseInfiniteQuery.mock.calls[0][0]
    const result = opts.getNextPageParam({ data: [], nextCursor: null })
    expect(result).toBeUndefined()
  })
})

describe("useGalleryReportCount", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: { id: "u1" }, isAdmin: true })
    mockHasAdmin.mockReturnValue(true)
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("passes correct query key", () => {
    mockUseQuery.mockReturnValue({ data: 0 })
    useGalleryReportCount()
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["gallery", "report-count"],
      })
    )
  })

  it("is enabled when user is admin and hasAdmin returns true", () => {
    mockUseQuery.mockReturnValue({ data: 0 })
    useGalleryReportCount()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("is disabled when user is null", () => {
    mockUseAuth.mockReturnValue({ user: null, isAdmin: false })
    mockUseQuery.mockReturnValue({ data: 0 })
    useGalleryReportCount()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when user is not admin", () => {
    mockUseAuth.mockReturnValue({ user: { id: "u1" }, isAdmin: false })
    mockUseQuery.mockReturnValue({ data: 0 })
    useGalleryReportCount()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when hasAdmin returns false", () => {
    mockHasAdmin.mockReturnValue(false)
    mockUseQuery.mockReturnValue({ data: 0 })
    useGalleryReportCount()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has refetchInterval of 60_000", () => {
    mockUseQuery.mockReturnValue({ data: 0 })
    useGalleryReportCount()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.refetchInterval).toBe(60_000)
  })

  it("has staleTime of 30_000", () => {
    mockUseQuery.mockReturnValue({ data: 0 })
    useGalleryReportCount()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(30_000)
  })
})

describe("useReportGalleryItemMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("calls useMutation", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useReportGalleryItemMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
  })

  it("mutationFn throws 'You already reported' on 429 status", async () => {
    mockFetch.mockResolvedValue({ status: 429, ok: false })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useReportGalleryItemMutation()

    await expect(
      captured.mutationFn({ jobId: "j1", reason: "spam" })
    ).rejects.toThrow("You already reported this item recently")
  })

  it("mutationFn throws generic error on non-ok non-429 status", async () => {
    mockFetch.mockResolvedValue({ status: 500, ok: false })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useReportGalleryItemMutation()

    await expect(
      captured.mutationFn({ jobId: "j1", reason: "spam" })
    ).rejects.toThrow("Failed to submit report")
  })
})

describe("useDeleteGalleryItemMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    mockUseQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("calls useMutation", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useDeleteGalleryItemMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
  })

  it("mutationFn sends DELETE request to correct url", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useDeleteGalleryItemMutation()

    await captured.mutationFn({ itemId: "item-1", userId: "u1" })
    expect(mockFetch).toHaveBeenCalledWith(
      "/v1/gallery/item-1",
      expect.objectContaining({ method: "DELETE" })
    )
  })

  it("mutationFn throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useDeleteGalleryItemMutation()

    await expect(
      captured.mutationFn({ itemId: "item-1", userId: "u1" })
    ).rejects.toThrow("Failed to remove item")
  })

  it("onSettled invalidates gallery.all queries", () => {
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useDeleteGalleryItemMutation()

    captured.onSettled()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["gallery"],
    })
  })

  it("onMutate snapshots gallery lists and writes the optimistic removal", async () => {
    const setMock = vi.fn()
    const getMock = vi.fn().mockReturnValue([])
    const cancelMock = vi.fn().mockResolvedValue(undefined)
    mockUseQueryClient.mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      cancelQueries: cancelMock,
      getQueriesData: getMock,
      setQueriesData: setMock,
      setQueryData: vi.fn(),
    })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useDeleteGalleryItemMutation()

    await captured.onMutate({ itemId: "item-1", userId: "u1" })
    expect(cancelMock).toHaveBeenCalled()
    expect(getMock).toHaveBeenCalled()
    expect(setMock).toHaveBeenCalledTimes(1)
    // The updater removes the matching item from each page's `.data` array.
    const updater = setMock.mock.calls[0][1] as (
      d: { pages: { data: { id: string }[] }[]; pageParams: unknown[] } | undefined,
    ) => unknown
    const result = updater({
      pages: [{ data: [{ id: "item-1" }, { id: "keep" }] }],
      pageParams: [undefined],
    }) as { pages: { data: { id: string }[] }[] }
    expect(result.pages[0].data.map((x) => x.id)).toEqual(["keep"])
  })
})

describe("useToggleFavoriteMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("onMutate optimistically adds the id to the favorites set", async () => {
    const setData = vi.fn()
    mockUseQueryClient.mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn().mockReturnValue(["existing"]),
      setQueryData: setData,
    })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useToggleFavoriteMutation("u1")

    const ctx = await captured.onMutate({ jobId: "job-1" })
    expect(setData).toHaveBeenCalledWith(
      ["gallery", "favorites", "u1"],
      expect.any(Function),
    )
    // The updater toggles the id in/out of the set.
    const updater = setData.mock.calls[0][1]
    expect(updater(["existing"])).toEqual(["existing", "job-1"])
    expect(updater(["existing", "job-1"])).toEqual(["existing"])
    // Snapshot captured for rollback.
    expect(ctx.previous).toEqual(["existing"])
    expect(ctx.key).toEqual(["gallery", "favorites", "u1"])
  })

  it("onMutate is a no-op without a userId (cannot key the favorites set)", async () => {
    const setData = vi.fn()
    mockUseQueryClient.mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      cancelQueries: vi.fn().mockResolvedValue(undefined),
      getQueryData: vi.fn(),
      setQueryData: setData,
    })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useToggleFavoriteMutation(undefined)

    const ctx = await captured.onMutate({ jobId: "job-1" })
    expect(setData).not.toHaveBeenCalled()
    expect(ctx.previous).toBeUndefined()
  })

  it("onError restores the captured favorites snapshot", () => {
    const setData = vi.fn()
    mockUseQueryClient.mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      setQueryData: setData,
    })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useToggleFavoriteMutation("u1")

    captured.onError(new Error("boom"), { jobId: "job-1" }, {
      previous: ["existing"],
      key: ["gallery", "favorites", "u1"],
    })
    expect(setData).toHaveBeenCalledWith(["gallery", "favorites", "u1"], ["existing"])
  })
})
