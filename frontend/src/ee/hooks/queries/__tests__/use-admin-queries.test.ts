import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockInvalidateQueries = vi.fn()
const mockHasAdmin = vi.fn()
const mockGetAuthHeaders = vi.fn()
const mockFetch = vi.fn()
const mockCreateClient = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useMutation: (opts: unknown) => mockUseMutation(opts),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock("@/lib/edition", () => ({
  hasAdmin: () => mockHasAdmin(),
}))

vi.mock("@/lib/api", () => ({
  getAuthHeaders: () => mockGetAuthHeaders(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    admin: {
      stats: () => ["admin", "stats"],
      users: (page: number, pageSize: number) => ["admin", "users", page, pageSize],
      jobs: (
        page: number,
        pageSize: number,
        status?: string,
        userId?: string,
        excludeUserIds?: ReadonlyArray<string>,
      ) =>
        [
          "admin",
          "jobs",
          page,
          pageSize,
          status ?? "",
          userId ?? "",
          [...(excludeUserIds ?? [])].sort().join(","),
        ],
      usersLite: () => ["admin", "users-lite"],
      usageLogs: (page: number, pageSize: number) => ["admin", "usage-logs", page, pageSize],
      models: () => ["admin", "models"],
      reports: (page: number, status?: string) => ["admin", "reports", page, status ?? ""],
      alerts: () => ["admin", "alerts"],
      settings: () => ["admin", "settings"],
      userTransactions: (userId: string) => ["admin", "user-transactions", userId],
    },
    gallery: {
      all: ["gallery"],
      reportCount: () => ["gallery", "report-count"],
    },
    billing: {
      storage: (userId: string) => ["billing", "storage", userId],
    },
  },
}))

import {
  useAdminStats,
  useAdminUsers,
  useAdminJobs,
  useAllAdminUsersLite,
  useAdminUsageLogs,
  useAdminModels,
  useAdminReports,
  useAdminAlerts,
  useAdminSettings,
  useAdminUserTransactions,
  useUpdateModelPricingMutation,
  useAdminAdjustCreditsMutation,
  useResolveReportMutation,
  useCreateAlertMutation,
  useUpdateAlertMutation,
  useDeleteAlertMutation,
  useAdminChangeTierMutation,
  useAdminChangeStorageMutation,
  useAdminChangeRoleMutation,
} from "../use-admin-queries"

// ------------------------------------------------------------------
// Query hooks
// ------------------------------------------------------------------

describe("admin query hooks — shared hasAdmin() gating", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  const queryHookCases: Array<{
    name: string
    call: () => void
    expectedKey: unknown
    expectedStaleTime: number
  }> = [
    {
      name: "useAdminStats",
      call: () => useAdminStats(),
      expectedKey: ["admin", "stats"],
      expectedStaleTime: 30_000,
    },
    {
      name: "useAdminUsers",
      call: () => useAdminUsers(0, 50),
      expectedKey: ["admin", "users", 0, 50],
      expectedStaleTime: 30_000,
    },
    {
      name: "useAllAdminUsersLite",
      call: () => useAllAdminUsersLite(),
      expectedKey: ["admin", "users-lite"],
      expectedStaleTime: 60_000,
    },
    {
      name: "useAdminJobs",
      call: () => useAdminJobs(1, 50),
      expectedKey: ["admin", "jobs", 1, 50, "", "", ""],
      expectedStaleTime: 15_000,
    },
    {
      name: "useAdminUsageLogs",
      call: () => useAdminUsageLogs(2, 50),
      expectedKey: ["admin", "usage-logs", 2, 50],
      expectedStaleTime: 15_000,
    },
    {
      name: "useAdminModels",
      call: () => useAdminModels(),
      expectedKey: ["admin", "models"],
      expectedStaleTime: 60_000,
    },
    {
      name: "useAdminReports",
      call: () => useAdminReports(0),
      expectedKey: ["admin", "reports", 0, ""],
      expectedStaleTime: 15_000,
    },
    {
      name: "useAdminAlerts",
      call: () => useAdminAlerts(),
      expectedKey: ["admin", "alerts"],
      expectedStaleTime: 30_000,
    },
    {
      name: "useAdminSettings",
      call: () => useAdminSettings(),
      expectedKey: ["admin", "settings"],
      expectedStaleTime: 60_000,
    },
  ]

  it.each(queryHookCases)(
    "$name passes correct queryKey",
    ({ call, expectedKey }) => {
      call()
      expect(mockUseQuery).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: expectedKey })
      )
    }
  )

  it.each(queryHookCases)(
    "$name has correct staleTime",
    ({ call, expectedStaleTime }) => {
      call()
      const opts = mockUseQuery.mock.calls[0][0]
      expect(opts.staleTime).toBe(expectedStaleTime)
    }
  )

  it.each(queryHookCases)(
    "$name is enabled when hasAdmin() returns true",
    ({ call }) => {
      mockHasAdmin.mockReturnValue(true)
      call()
      const opts = mockUseQuery.mock.calls[0][0]
      expect(opts.enabled).toBe(true)
    }
  )

  it.each(queryHookCases)(
    "$name is disabled when hasAdmin() returns false",
    ({ call }) => {
      mockHasAdmin.mockReturnValue(false)
      call()
      const opts = mockUseQuery.mock.calls[0][0]
      expect(opts.enabled).toBe(false)
    }
  )
})

describe("useAdminJobs with statusFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
  })

  it("includes status filter in queryKey", () => {
    useAdminJobs(0, 50, "completed")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["admin", "jobs", 0, 50, "completed", "", ""],
      })
    )
  })
})

describe("useAdminJobs with userIdFilter", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
  })

  it("includes userId filter in queryKey", () => {
    useAdminJobs(0, 50, undefined, "u1")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["admin", "jobs", 0, 50, "", "u1", ""],
      })
    )
  })

  it("combines status and userId in queryKey", () => {
    useAdminJobs(2, 50, "failed", "u1")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["admin", "jobs", 2, 50, "failed", "u1", ""],
      })
    )
  })
})

describe("useAdminJobs with excludeUserIds", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
  })

  it("includes sorted excludeUserIds in queryKey", () => {
    useAdminJobs(0, 50, undefined, undefined, ["u3", "u1", "u2"])
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["admin", "jobs", 0, 50, "", "", "u1,u2,u3"],
      }),
    )
  })

  it("treats empty excludeUserIds as no filter", () => {
    useAdminJobs(0, 50, undefined, undefined, [])
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["admin", "jobs", 0, 50, "", "", ""],
      }),
    )
  })
})

describe("useAllAdminUsersLite options.enabled", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseQuery.mockReturnValue({ data: null })
  })

  it("respects options.enabled = false even when hasAdmin() is true", () => {
    mockHasAdmin.mockReturnValue(true)
    useAllAdminUsersLite({ enabled: false })
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("defaults options.enabled to true (keeps hasAdmin gate behavior)", () => {
    mockHasAdmin.mockReturnValue(true)
    useAllAdminUsersLite()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("stays disabled when hasAdmin() is false even with enabled=true", () => {
    mockHasAdmin.mockReturnValue(false)
    useAllAdminUsersLite({ enabled: true })
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })
})

describe("useAdminUserTransactions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("passes correct queryKey with userId", () => {
    useAdminUserTransactions("user-42")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["admin", "user-transactions", "user-42"],
      })
    )
  })

  it("has 30s staleTime", () => {
    useAdminUserTransactions("user-42")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(30_000)
  })

  it("is enabled when hasAdmin() is true and userId is truthy", () => {
    mockHasAdmin.mockReturnValue(true)
    useAdminUserTransactions("user-42")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("is disabled when userId is empty string", () => {
    mockHasAdmin.mockReturnValue(true)
    useAdminUserTransactions("")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when hasAdmin() is false even with valid userId", () => {
    mockHasAdmin.mockReturnValue(false)
    useAdminUserTransactions("user-42")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })
})

// ------------------------------------------------------------------
// Mutation hooks
// ------------------------------------------------------------------

describe("admin mutation hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    mockInvalidateQueries.mockResolvedValue(undefined)
    globalThis.fetch = mockFetch as unknown as typeof fetch
    mockUseMutation.mockImplementation((opts: unknown) => {
      // Store opts so we can call onSuccess later
      return { mutate: vi.fn(), _opts: opts }
    })
  })

  function captureMutationOpts(hookFn: () => unknown): any {
    const result = hookFn() as any
    return result._opts
  }

  it("useUpdateModelPricingMutation calls useMutation", () => {
    useUpdateModelPricingMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
  })

  it("useUpdateModelPricingMutation onSuccess invalidates admin.models", () => {
    const opts = captureMutationOpts(useUpdateModelPricingMutation)
    opts.onSuccess()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "models"],
    })
  })

  it("useAdminAdjustCreditsMutation calls useMutation", () => {
    useAdminAdjustCreditsMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
  })

  it("useAdminAdjustCreditsMutation onSuccess invalidates users and userTransactions", () => {
    const opts = captureMutationOpts(useAdminAdjustCreditsMutation)
    opts.onSuccess(undefined, { userId: "u1", amount: 10, type: "topup" })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "users"],
    })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "user-transactions", "u1"],
    })
  })

  it("useResolveReportMutation calls useMutation", () => {
    useResolveReportMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
  })

  it("useResolveReportMutation onSuccess invalidates reports, reportCount, and gallery", () => {
    const opts = captureMutationOpts(useResolveReportMutation)
    opts.onSuccess()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "reports"],
    })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["gallery", "report-count"],
    })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["gallery"],
    })
  })

  it("useCreateAlertMutation onSuccess invalidates admin.alerts", () => {
    const opts = captureMutationOpts(useCreateAlertMutation)
    opts.onSuccess()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "alerts"],
    })
  })

  it("useUpdateAlertMutation onSuccess invalidates admin.alerts", () => {
    const opts = captureMutationOpts(useUpdateAlertMutation)
    opts.onSuccess()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "alerts"],
    })
  })

  it("useDeleteAlertMutation onSuccess invalidates admin.alerts", () => {
    const opts = captureMutationOpts(useDeleteAlertMutation)
    opts.onSuccess()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "alerts"],
    })
  })

  it("useAdminChangeTierMutation onSuccess invalidates admin users", () => {
    const opts = captureMutationOpts(useAdminChangeTierMutation)
    opts.onSuccess()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "users"],
    })
  })

  it("useAdminChangeStorageMutation onSuccess invalidates admin users and billing storage", () => {
    const opts = captureMutationOpts(useAdminChangeStorageMutation)
    opts.onSuccess(undefined, { userId: "u5", storageLimitBytes: 1024 })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "users"],
    })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["billing", "storage", "u5"],
    })
  })

  it("useAdminChangeRoleMutation onSuccess invalidates admin users", () => {
    const opts = captureMutationOpts(useAdminChangeRoleMutation)
    opts.onSuccess()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["admin", "users"],
    })
  })

  it("all 9 mutation hooks call useMutation exactly once", () => {
    const mutationHooks = [
      useUpdateModelPricingMutation,
      useAdminAdjustCreditsMutation,
      useResolveReportMutation,
      useCreateAlertMutation,
      useUpdateAlertMutation,
      useDeleteAlertMutation,
      useAdminChangeTierMutation,
      useAdminChangeStorageMutation,
      useAdminChangeRoleMutation,
    ]
    for (const hook of mutationHooks) {
      mockUseMutation.mockClear()
      hook()
      expect(mockUseMutation).toHaveBeenCalledTimes(1)
    }
  })
})
