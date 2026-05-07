import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockGetUserCredits = vi.fn()
const mockGetModelCreditCost = vi.fn()
const mockGetBatchModelCreditCosts = vi.fn()
const mockHasCredits = vi.fn()
const mockGetQueryData = vi.fn()
const mockSetQueryData = vi.fn()
const mockPrefetchQuery = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
}))

vi.mock("@/lib/api", () => ({
  getUserCredits: (...args: unknown[]) => mockGetUserCredits(...args),
  getModelCreditCost: (...args: unknown[]) => mockGetModelCreditCost(...args),
  getBatchModelCreditCosts: (...args: unknown[]) => mockGetBatchModelCreditCosts(...args),
}))

vi.mock("@/lib/edition", () => ({
  hasCredits: () => mockHasCredits(),
}))

vi.mock("@/lib/query-client", () => ({
  queryClient: {
    getQueryData: (...args: unknown[]) => mockGetQueryData(...args),
    setQueryData: (...args: unknown[]) => mockSetQueryData(...args),
    prefetchQuery: (...args: unknown[]) => mockPrefetchQuery(...args),
  },
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    credits: {
      balance: (id: string) => ["credits", "balance", id],
      modelCost: (model: string) => ["credits", "model-cost", model],
    },
  },
}))

import {
  useUserCredits,
  useModelCreditCost,
  getCachedCredits,
  prefetchModelCredits,
} from "../use-credits-queries"

describe("useUserCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCredits.mockReturnValue(true)
  })

  it("passes correct query key", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useUserCredits("u1")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["credits", "balance", "u1"],
      })
    )
  })

  it("is disabled when userId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useUserCredits(undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when hasCredits returns false", () => {
    mockHasCredits.mockReturnValue(false)
    mockUseQuery.mockReturnValue({ data: null })
    useUserCredits("u1")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has 30s refetch and stale time", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useUserCredits("u1")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.refetchInterval).toBe(30_000)
    expect(opts.staleTime).toBe(30_000)
  })
})

describe("useModelCreditCost", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCredits.mockReturnValue(true)
  })

  it("passes correct query key", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useModelCreditCost("flux")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["credits", "model-cost", "flux"],
      })
    )
  })

  it("is disabled when model is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useModelCreditCost(undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when hasCredits returns false", () => {
    mockHasCredits.mockReturnValue(false)
    mockUseQuery.mockReturnValue({ data: null })
    useModelCreditCost("flux")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has Infinity stale time", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useModelCreditCost("flux")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(Infinity)
  })

  it("queryFn returns creditCost from API", async () => {
    mockUseQuery.mockReturnValue({ data: null })
    mockGetModelCreditCost.mockResolvedValue({ data: { creditCost: 3 } })
    useModelCreditCost("flux")
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(result).toBe(3)
  })
})

describe("getCachedCredits", () => {
  it("reads from query client cache", () => {
    mockGetQueryData.mockReturnValue(5)
    expect(getCachedCredits("flux")).toBe(5)
    expect(mockGetQueryData).toHaveBeenCalledWith(["credits", "model-cost", "flux"])
  })

  it("returns undefined when not cached", () => {
    mockGetQueryData.mockReturnValue(undefined)
    expect(getCachedCredits("unknown")).toBeUndefined()
  })
})

describe("prefetchModelCredits", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCredits.mockReturnValue(true)
    mockGetQueryData.mockReturnValue(undefined)
  })

  it("does nothing when hasCredits is false", async () => {
    mockHasCredits.mockReturnValue(false)
    await prefetchModelCredits(["flux", "kling"])
    expect(mockGetBatchModelCreditCosts).not.toHaveBeenCalled()
  })

  it("does nothing when models array is empty", async () => {
    await prefetchModelCredits([])
    expect(mockGetBatchModelCreditCosts).not.toHaveBeenCalled()
  })

  it("skips already cached models", async () => {
    mockGetQueryData.mockImplementation((key: string[]) =>
      key[2] === "flux" ? 3 : undefined
    )
    mockGetBatchModelCreditCosts.mockResolvedValue({ kling: 5 })
    await prefetchModelCredits(["flux", "kling"])
    expect(mockGetBatchModelCreditCosts).toHaveBeenCalledWith(["kling"])
  })

  it("batch fetches uncached models and sets cache", async () => {
    mockGetBatchModelCreditCosts.mockResolvedValue({ flux: 3, kling: 5 })
    await prefetchModelCredits(["flux", "kling"])
    expect(mockSetQueryData).toHaveBeenCalledWith(["credits", "model-cost", "flux"], 3)
    expect(mockSetQueryData).toHaveBeenCalledWith(["credits", "model-cost", "kling"], 5)
  })

  it("falls back to individual fetch on batch error", async () => {
    mockGetBatchModelCreditCosts.mockRejectedValue(new Error("batch failed"))
    mockPrefetchQuery.mockResolvedValue(undefined)
    await prefetchModelCredits(["flux"])
    expect(mockPrefetchQuery).toHaveBeenCalledTimes(1)
  })
})
