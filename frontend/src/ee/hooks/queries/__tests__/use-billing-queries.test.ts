import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockUseQueryClient = vi.fn()
const mockInvalidateQueries = vi.fn()
const mockGetSubscription = vi.fn()
const mockGetTransactions = vi.fn()
const mockGetManageSubscriptionUrl = vi.fn()
const mockChangePlan = vi.fn()
const mockHasCredits = vi.fn()
const mockCreateClient = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useMutation: (opts: unknown) => mockUseMutation(opts),
  useQueryClient: () => mockUseQueryClient(),
}))

vi.mock("@/lib/api", () => ({
  getSubscription: (...args: unknown[]) => mockGetSubscription(...args),
  getTransactions: (...args: unknown[]) => mockGetTransactions(...args),
  getManageSubscriptionUrl: (...args: unknown[]) => mockGetManageSubscriptionUrl(...args),
  changePlan: (...args: unknown[]) => mockChangePlan(...args),
}))

vi.mock("@/lib/edition", () => ({
  hasCredits: () => mockHasCredits(),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    billing: {
      subscription: (id: string) => ["billing", "subscription", id],
      transactions: (id: string) => ["billing", "transactions", id],
      storage: (id: string) => ["billing", "storage", id],
    },
    credits: {
      balance: (id: string) => ["credits", "balance", id],
    },
    userSettings: {
      detail: (id: string) => ["user-settings", id],
    },
  },
}))

vi.mock("@/lib/pricing-data", () => ({
  TIER_STORAGE_BYTES: {
    free: 1073741824,
    basic: 10737418240,
    pro: 53687091200,
  },
}))

import {
  useSubscription,
  useTransactions,
  useStorageProfile,
  useManageSubscriptionMutation,
  useChangePlanMutation,
} from "../use-billing-queries"

describe("useSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCredits.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
  })

  it("passes correct query key for a given userId", () => {
    useSubscription("user-123")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["billing", "subscription", "user-123"],
      })
    )
  })

  it("uses empty string in query key when userId is undefined", () => {
    useSubscription(undefined)
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["billing", "subscription", ""],
      })
    )
  })

  it("is disabled when userId is undefined", () => {
    useSubscription(undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when hasCredits returns false", () => {
    mockHasCredits.mockReturnValue(false)
    useSubscription("user-123")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has 60s stale time", () => {
    useSubscription("user-123")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(60_000)
  })
})

describe("useTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCredits.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
  })

  it("passes correct query key", () => {
    useTransactions("user-456")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["billing", "transactions", "user-456"],
      })
    )
  })

  it("is disabled when userId is undefined", () => {
    useTransactions(undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when hasCredits returns false", () => {
    mockHasCredits.mockReturnValue(false)
    useTransactions("user-456")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has 60s stale time", () => {
    useTransactions("user-456")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(60_000)
  })
})

describe("useStorageProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCredits.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
  })

  it("passes correct query key", () => {
    useStorageProfile("user-789")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["billing", "storage", "user-789"],
      })
    )
  })

  it("is disabled when userId is undefined", () => {
    useStorageProfile(undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has 30s stale time", () => {
    useStorageProfile("user-789")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(30_000)
  })
})

describe("useManageSubscriptionMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
  })

  it("passes mutationFn that calls getManageSubscriptionUrl", () => {
    useManageSubscriptionMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
    const opts = mockUseMutation.mock.calls[0][0]
    expect(opts.mutationFn).toBeDefined()
  })

  it("mutationFn forwards userId to getManageSubscriptionUrl", async () => {
    mockGetManageSubscriptionUrl.mockResolvedValue({ url: "https://example.com" })
    useManageSubscriptionMutation()
    const opts = mockUseMutation.mock.calls[0][0]
    await opts.mutationFn("user-manage")
    expect(mockGetManageSubscriptionUrl).toHaveBeenCalledWith("user-manage")
  })
})

describe("useChangePlanMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries })
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
  })

  it("passes mutationFn that calls changePlan", async () => {
    mockChangePlan.mockResolvedValue({ success: true })
    useChangePlanMutation()
    const opts = mockUseMutation.mock.calls[0][0]
    await opts.mutationFn({ userId: "u1", priceId: "price_abc" })
    expect(mockChangePlan).toHaveBeenCalledWith("u1", "price_abc")
  })

  it("onSuccess invalidates subscription query key", () => {
    useChangePlanMutation()
    const opts = mockUseMutation.mock.calls[0][0]
    opts.onSuccess(undefined, { userId: "u1" })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["billing", "subscription", "u1"],
    })
  })

  it("onSuccess invalidates credits balance query key", () => {
    useChangePlanMutation()
    const opts = mockUseMutation.mock.calls[0][0]
    opts.onSuccess(undefined, { userId: "u1" })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["credits", "balance", "u1"],
    })
  })

  it("onSuccess invalidates storage query key", () => {
    useChangePlanMutation()
    const opts = mockUseMutation.mock.calls[0][0]
    opts.onSuccess(undefined, { userId: "u1" })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["billing", "storage", "u1"],
    })
  })

  it("onSuccess invalidates userSettings detail query key", () => {
    useChangePlanMutation()
    const opts = mockUseMutation.mock.calls[0][0]
    opts.onSuccess(undefined, { userId: "u1" })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user-settings", "u1"],
    })
  })
})
