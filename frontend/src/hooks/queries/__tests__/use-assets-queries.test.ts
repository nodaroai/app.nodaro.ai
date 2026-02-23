import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockUseInfiniteQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockInvalidateQueries = vi.fn()
const mockUseQueryClient = vi.fn()

const mockGetCharacters = vi.fn()
const mockGetObjects = vi.fn()
const mockGetLocations = vi.fn()
const mockGetFaces = vi.fn()
const mockGetLibraryAssets = vi.fn()
const mockDeleteLibraryAsset = vi.fn()
const mockRemoveLibraryAsset = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useInfiniteQuery: (opts: unknown) => mockUseInfiniteQuery(opts),
  useMutation: (opts: unknown) => mockUseMutation(opts),
  useQueryClient: () => mockUseQueryClient(),
}))

vi.mock("@/lib/api", () => ({
  getCharacters: (...args: unknown[]) => mockGetCharacters(...args),
  getObjects: (...args: unknown[]) => mockGetObjects(...args),
  getLocations: (...args: unknown[]) => mockGetLocations(...args),
  getFaces: (...args: unknown[]) => mockGetFaces(...args),
  getLibraryAssets: (...args: unknown[]) => mockGetLibraryAssets(...args),
  deleteLibraryAsset: (...args: unknown[]) => mockDeleteLibraryAsset(...args),
  removeLibraryAsset: (...args: unknown[]) => mockRemoveLibraryAsset(...args),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    assets: {
      characters: (projectId?: string, userId?: string) =>
        ["assets", "characters", projectId ?? "", userId ?? ""],
      objects: (projectId?: string, userId?: string) =>
        ["assets", "objects", projectId ?? "", userId ?? ""],
      locations: (projectId?: string, userId?: string) =>
        ["assets", "locations", projectId ?? "", userId ?? ""],
      faces: (projectId?: string, userId?: string) =>
        ["assets", "faces", projectId ?? "", userId ?? ""],
    },
    library: {
      all: ["library"],
      list: (params: { userId: string; type?: string; search?: string; owned?: boolean }) =>
        ["library", "list", params.userId, params.type ?? "", params.search ?? "", String(params.owned ?? false)],
    },
    billing: {
      storage: (userId: string) => ["billing", "storage", userId],
    },
  },
}))

import {
  useCharacters,
  useObjects,
  useLocations,
  useFaces,
  useLibraryInfinite,
  useDeleteLibraryAssetMutation,
  useRemoveLibraryAssetMutation,
} from "../use-assets-queries"

describe("useCharacters", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes correct queryKey with projectId and userId", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useCharacters("proj1", "user1")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["assets", "characters", "proj1", "user1"],
      })
    )
  })

  it("is enabled when userId is provided", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useCharacters("proj1", "user1")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("is disabled when userId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useCharacters("proj1", undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has staleTime of 60_000", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useCharacters("proj1", "user1")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(60_000)
  })
})

describe("useObjects", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes correct queryKey", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useObjects("proj2", "user2")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["assets", "objects", "proj2", "user2"],
      })
    )
  })

  it("is disabled when userId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useObjects("proj2", undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has staleTime of 60_000", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useObjects("proj2", "user2")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(60_000)
  })
})

describe("useLocations", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes correct queryKey", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useLocations("proj3", "user3")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["assets", "locations", "proj3", "user3"],
      })
    )
  })

  it("is disabled when userId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useLocations(undefined, undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has staleTime of 60_000", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useLocations("proj3", "user3")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(60_000)
  })
})

describe("useFaces", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes correct queryKey", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useFaces("proj4", "user4")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["assets", "faces", "proj4", "user4"],
      })
    )
  })

  it("is disabled when userId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useFaces("proj4", undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has staleTime of 60_000", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useFaces("proj4", "user4")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(60_000)
  })
})

describe("useLibraryInfinite", () => {
  beforeEach(() => vi.clearAllMocks())

  it("passes correct queryKey based on params", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useLibraryInfinite({ userId: "user5", type: "image", search: "cat" })
    expect(mockUseInfiniteQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["library", "list", "user5", "image", "cat", "false"],
      })
    )
  })

  it("is enabled when userId is provided", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useLibraryInfinite({ userId: "user5" })
    const opts = mockUseInfiniteQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("is disabled when userId is undefined", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useLibraryInfinite({ userId: undefined })
    const opts = mockUseInfiniteQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has staleTime of 30_000", () => {
    mockUseInfiniteQuery.mockReturnValue({ data: null })
    useLibraryInfinite({ userId: "user5" })
    const opts = mockUseInfiniteQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(30_000)
  })
})

describe("useDeleteLibraryAssetMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries })
  })

  it("calls useMutation with a mutationFn", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useDeleteLibraryAssetMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
    const opts = mockUseMutation.mock.calls[0][0]
    expect(opts.mutationFn).toBeDefined()
  })

  it("onSuccess invalidates library.all and billing.storage", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useDeleteLibraryAssetMutation()
    const opts = mockUseMutation.mock.calls[0][0]
    opts.onSuccess(undefined, { assetId: "a1", userId: "user6" })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["library"],
    })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["billing", "storage", "user6"],
    })
  })
})

describe("useRemoveLibraryAssetMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries })
  })

  it("calls useMutation with a mutationFn", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useRemoveLibraryAssetMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
    const opts = mockUseMutation.mock.calls[0][0]
    expect(opts.mutationFn).toBeDefined()
  })

  it("onSuccess invalidates library.all", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useRemoveLibraryAssetMutation()
    const opts = mockUseMutation.mock.calls[0][0]
    opts.onSuccess(undefined, { assetId: "a1", userId: "user6" })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["library"],
    })
  })
})
