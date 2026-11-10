import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockUseInfiniteQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockInvalidateQueries = vi.fn()
const mockHasAdmin = vi.fn()
const mockGetAuthHeaders = vi.fn()
const mockFetch = vi.fn()
const mockCreateClient = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: "keepPreviousData",
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useInfiniteQuery: (opts: unknown) => mockUseInfiniteQuery(opts),
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
      users: (page: number, pageSize: number, _sortBy?: string, _sortDir?: string, search?: string) =>
        search ? ["admin", "users", page, pageSize, search] : ["admin", "users", page, pageSize],
      user: (id: string) => ["admin", "users", "one", id],
      jobs: (page: number, pageSize: number, filters: string, excludeUserIds?: ReadonlyArray<string>) =>
        ["admin", "jobs", page, pageSize, filters, [...(excludeUserIds ?? [])].sort().join(",")],
      jobsInfinite: (pageSize: number, filters: string, excludeUserIds?: ReadonlyArray<string>) =>
        ["admin", "jobs-infinite", pageSize, filters, [...(excludeUserIds ?? [])].sort().join(",")],
      jobSources: () => ["admin", "job-sources"],
      job: (id: string, status: string, completedAt: string | null) => ["admin", "job", id, status, completedAt ?? ""],
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
  useAdminUser,
  useAdminUsers,
  sanitizeUserSearch,
  useAdminJobs,
  useAdminJobsInfinite,
  useAdminJobSources,
  useAdminJobDetail,
  jobSourceLabel,
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
import { DEFAULT_JOB_FILTERS, type AdminJobFilters } from "@/ee/app/(admin)/admin/jobs/jobs-filters"

const jobFilters = (over: Partial<AdminJobFilters> = {}): AdminJobFilters => ({ ...DEFAULT_JOB_FILTERS, ...over })

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
      name: "useAdminJobs",
      call: () => useAdminJobs(1, 50, jobFilters()),
      expectedKey: ["admin", "jobs", 1, 50, "", ""],
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

describe("useAdminUsers search", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  function profilesBuilder() {
    const builder = {
      or: vi.fn(() => builder),
      order: vi.fn(() => builder),
      range: vi.fn(async () => ({ data: [], error: null })),
    }
    const select = vi.fn(() => builder)
    mockCreateClient.mockReturnValue({ from: vi.fn(() => ({ select })) })
    return builder
  }

  it("filters every profile in the query, not the loaded page", async () => {
    const builder = profilesBuilder()
    useAdminUsers(3, 50, "created_at", "desc", undefined, "  dana@x.com ")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.queryKey).toEqual(["admin", "users", 3, 50, "dana@x.com"])
    await opts.queryFn()
    expect(builder.or).toHaveBeenCalledWith("email.ilike.%dana@x.com%,full_name.ilike.%dana@x.com%")
    expect(builder.range).toHaveBeenCalledWith(150, 199)
  })

  it("adds no filter for an empty search", async () => {
    const builder = profilesBuilder()
    useAdminUsers(0, 50)
    await mockUseQuery.mock.calls[0][0].queryFn()
    expect(builder.or).not.toHaveBeenCalled()
  })

  it("sends the search to the route under a deployment payer", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    useAdminUsers(1, 50, "created_at", "desc", { viaRoute: true, ready: true }, "דנה כהן")
    await mockUseQuery.mock.calls[0][0].queryFn()
    expect(mockFetch).toHaveBeenCalledWith(
      `/v1/admin/users?limit=50&offset=50&search=${encodeURIComponent("דנה כהן")}`,
      expect.anything(),
    )
  })

  it("keeps the current rows while a new search loads", () => {
    useAdminUsers(0, 50, "created_at", "desc", undefined, "dana")
    expect(mockUseQuery.mock.calls[0][0].placeholderData).toBe("keepPreviousData")
  })

  it("strips PostgREST filter syntax but keeps names and email characters", () => {
    expect(sanitizeUserSearch("a,b),email.eq.(x:y)%")).toBe("abemail.eq.xy")
    expect(sanitizeUserSearch(" john_doe+tag@mail.co ")).toBe("john_doe+tag@mail.co")
    expect(sanitizeUserSearch("דנה כהן")).toBe("דנה כהן")
  })
})

describe("useAdminJobs filters", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("keys on the serialized filters, without the view", () => {
    useAdminJobs(0, 50, jobFilters({ status: "completed", view: "gallery", userEmail: "dana@x.test" }))
    expect(mockUseQuery.mock.calls[0][0].queryKey).toEqual(["admin", "jobs", 0, 50, "status=completed&user=dana%40x.test", ""])
  })

  it("same filters → same query key", () => {
    useAdminJobs(0, 50, jobFilters({ types: ["b", "a"], sources: ["web:x"] }))
    useAdminJobs(0, 50, jobFilters({ sources: ["web:x"], types: ["a", "b"] }))
    expect(mockUseQuery.mock.calls[0][0].queryKey).toEqual(mockUseQuery.mock.calls[1][0].queryKey)
  })

  it("sends and keys the admins' ids only while the admins are hidden", () => {
    useAdminJobs(0, 50, jobFilters({ excludeAdmins: true }), ["u3", "u1", "u2"])
    useAdminJobs(0, 50, jobFilters(), ["u3", "u1"])
    useAdminJobs(0, 50, jobFilters({ excludeAdmins: true, userEmail: "a@b.co" }), ["u3"])
    expect(mockUseQuery.mock.calls.map((c) => c[0].queryKey[5])).toEqual(["u1,u2,u3", "", ""])
  })

  it("requests the server params and reports an unknown address", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], userNotFound: true }) })
    useAdminJobs(2, 50, jobFilters({ status: "failed", userEmail: "nobody@x.test", excludeAdmins: false }), ["u1"])
    await expect(mockUseQuery.mock.calls[0][0].queryFn()).resolves.toEqual({ jobs: [], userNotFound: true, filtersUnavailable: false })
    const url = new URL(String(mockFetch.mock.calls[0]![0]), "http://x")
    expect(url.pathname).toBe("/v1/admin/jobs")
    expect(Object.fromEntries(url.searchParams)).toEqual({ page: "2", pageSize: "50", status: "failed", userEmail: "nobody@x.test" })
  })

  it("sends the admins' ids when they are hidden", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [] }) })
    useAdminJobs(0, 50, jobFilters({ excludeAdmins: true }), ["u2", "u1"])
    await expect(mockUseQuery.mock.calls[0][0].queryFn()).resolves.toEqual({ jobs: [], userNotFound: false, filtersUnavailable: false })
    const url = new URL(String(mockFetch.mock.calls[0]![0]), "http://x")
    expect(url.searchParams.get("excludeUserIds")?.split(",").sort()).toEqual(["u1", "u2"])
  })

  it("passes on that the server could not apply the newer filters", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [], filtersUnavailable: true }) })
    useAdminJobs(0, 50, jobFilters({ kind: "video" }))
    await expect(mockUseQuery.mock.calls[0][0].queryFn()).resolves.toEqual({ jobs: [], userNotFound: false, filtersUnavailable: true })
  })

  it("a caller can hold the request (the admins' ids not loaded yet)", () => {
    useAdminJobs(0, 50, jobFilters({ excludeAdmins: true }), [], { enabled: false })
    useAdminJobs(0, 50, jobFilters())
    useAdminJobsInfinite(50, jobFilters({ excludeAdmins: true }), [], { enabled: false })
    useAdminJobsInfinite(50, jobFilters())
    expect(mockUseQuery.mock.calls.map((c) => c[0].enabled)).toEqual([false, true])
    expect(mockUseInfiniteQuery.mock.calls.map((c) => c[0].enabled)).toEqual([false, true])
  })

  it("the gallery pages by the filtered page's length", () => {
    useAdminJobsInfinite(50, jobFilters({ kind: "video" }))
    const opts = mockUseInfiniteQuery.mock.calls[0][0]
    expect(opts.queryKey).toEqual(["admin", "jobs-infinite", 50, "kind=video", ""])
    expect(opts.getNextPageParam({ jobs: new Array(50), userNotFound: false, filtersUnavailable: false }, [{}, {}])).toBe(2)
    expect(opts.getNextPageParam({ jobs: new Array(3), userNotFound: false, filtersUnavailable: false }, [{}])).toBeUndefined()
  })
})

describe("useAdminJobSources", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("is cached for minutes and not refetched on focus", () => {
    useAdminJobSources()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.queryKey).toEqual(["admin", "job-sources"])
    expect(opts.staleTime).toBeGreaterThanOrEqual(5 * 60_000)
    expect(opts.refetchOnWindowFocus).toBe(false)
    expect(opts.enabled).toBe(true)
  })

  it("labels apps by name (else id) and web apps by product", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { key: "web:studio", source: "web", sourceDetail: "studio.nodaro.ai", count: 9 },
          { key: "app:A1", source: "app", sourceDetail: "A1", count: 4 },
          { key: "app:gone", source: "app", sourceDetail: "gone", count: 2 },
          { key: "api", source: "api", sourceDetail: null, count: 1 },
        ],
      }),
    })
    const inFn = vi.fn(async () => ({ data: [{ id: "A1", name: "Reel Maker" }] }))
    const from = vi.fn(() => ({ select: vi.fn(() => ({ in: inFn })) }))
    mockCreateClient.mockReturnValue({ from })
    useAdminJobSources()
    await expect(mockUseQuery.mock.calls[0][0].queryFn()).resolves.toEqual([
      { key: "web:studio", label: "studio", count: 9 },
      { key: "app:A1", label: "Reel Maker", count: 4 },
      { key: "app:gone", label: "gone", count: 2 },
      { key: "api", label: "api", count: 1 },
    ])
    expect(String(mockFetch.mock.calls[0]![0])).toBe("/v1/admin/jobs/sources")
    expect(from).toHaveBeenCalledWith("developer_apps")
    expect(inFn).toHaveBeenCalledWith("id", ["A1", "gone"])
  })

  it("reads no apps when no source is one", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ data: [{ key: "web:studio", count: 1 }] }) })
    useAdminJobSources()
    await mockUseQuery.mock.calls[0][0].queryFn()
    expect(mockCreateClient).not.toHaveBeenCalled()
  })

  it("jobSourceLabel keeps any other key as written", () => {
    expect(jobSourceLabel("unknown", new Map())).toBe("unknown")
    expect(jobSourceLabel("web:localhost:3000", new Map())).toBe("localhost:3000")
  })
})

describe("useAdminJobDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("reads the whole job each time the view opens, keyed by the state the row shows", () => {
    useAdminJobDetail({ id: "j1", status: "processing", completed_at: null })
    useAdminJobDetail({ id: "j1", status: "completed", completed_at: "2026-11-02T10:00:00Z" })
    const [running, finished] = mockUseQuery.mock.calls.map(([opts]) => opts)
    // A job the list now shows as finished is a different entry: never its earlier output.
    expect(running.queryKey).toEqual(["admin", "job", "j1", "processing", ""])
    expect(finished.queryKey).toEqual(["admin", "job", "j1", "completed", "2026-11-02T10:00:00Z"])
    // The app's query client keeps a read fresh for a minute: zero is what makes a reopen read again.
    expect(running.staleTime).toBe(0)
    expect(running.enabled).toBe(true)
  })

  it("holds the read while no job is open", () => {
    useAdminJobDetail(null)
    expect(mockUseQuery.mock.calls[0][0].enabled).toBe(false)
  })

  it("returns the job's full input and output", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "j1", input_data: { type: "x", prompt: "p" }, output_data: { imageUrl: "https://cdn.test/a.png" } } }),
    })
    useAdminJobDetail({ id: "j1", status: "completed", completed_at: null })
    await expect(mockUseQuery.mock.calls[0][0].queryFn()).resolves.toEqual({
      input_data: { type: "x", prompt: "p" },
      output_data: { imageUrl: "https://cdn.test/a.png" },
      error_message: null,
      error_detail: null,
    })
    expect(String(mockFetch.mock.calls[0]![0])).toBe("/v1/admin/jobs/j1")
  })

  it("returns a failed job's sentence and the provider's own words about it, from the one read", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: "j1", input_data: { type: "x" }, output_data: null, error_message: "declined", error_detail: "Request blocked: restricted content." },
      }),
    })
    useAdminJobDetail({ id: "j1", status: "failed", completed_at: null })
    await expect(mockUseQuery.mock.calls[0][0].queryFn()).resolves.toEqual({
      input_data: { type: "x" },
      output_data: null,
      error_message: "declined",
      error_detail: "Request blocked: restricted content.",
    })
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

describe("useAdminUser — one account, for the users page's direct link", () => {
  const ID = "00000000-0000-4000-8000-0000000000d1"

  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  const optionsOf = () =>
    mockUseQuery.mock.calls.at(-1)![0] as { queryKey: unknown; queryFn: () => Promise<unknown>; enabled: boolean; retry: unknown }

  it("under a payer, asks the route for that id and answers its one row", async () => {
    useAdminUser(ID, { viaRoute: true, ready: true })
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: ID, email: "dana@x.test" }] })))
    expect(await optionsOf().queryFn()).toEqual({ id: ID, email: "dana@x.test" })
    expect(String(mockFetch.mock.calls[0]![0])).toBe(`/v1/admin/users?id=${ID}&limit=1`)
    expect(optionsOf().queryKey).toEqual(["admin", "users", "one", ID, "route"])
  })

  it("otherwise reads the profile directly, with the list's columns and tier rule", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: ID, tier: "pro", subscription_tier: "free", subscription_credits: null, topup_credits: 5, daily_spent_credits: null, storage_limit_bytes: null },
      error: null,
    })
    const eq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq }))
    mockCreateClient.mockReturnValue({ from: vi.fn(() => ({ select })) })
    useAdminUser(ID)
    expect(await optionsOf().queryFn()).toMatchObject({ id: ID, subscription_tier: "pro", subscription_credits: 0, topup_credits: 5, storage_limit_bytes: 524288000 })
    expect(eq).toHaveBeenCalledWith("id", ID)
    expect(String((select.mock.calls[0] as unknown[])[0])).toContain("free_grant_state")
  })

  it("a link that is not an account id names nobody, without a request; an answer is never retried", async () => {
    useAdminUser("not-an-id", { viaRoute: true, ready: true })
    expect(await optionsOf().queryFn()).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockCreateClient).not.toHaveBeenCalled()
    expect(optionsOf().retry).toBe(false)
    useAdminUser(null)
    expect(optionsOf().enabled).toBe(false)
  })
})

describe("useAdminStats — the user counts (migration 586)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasAdmin.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: null })
  })

  const statsFrom = async (rpcData: Record<string, unknown>) => {
    mockCreateClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue({ data: rpcData, error: null }) })
    useAdminStats()
    return mockUseQuery.mock.calls[0][0].queryFn()
  }

  it("passes both counts through", async () => {
    const stats = await statsFrom({ totalUsers: 1000, usersAcceptingEmail: 120, usersWithGeneration: 640, jobsByStatus: {} })
    expect(stats).toMatchObject({ totalUsers: 1000, usersAcceptingEmail: 120, usersWithGeneration: 640 })
  })

  it("an answer without them (a database before 586) is unknown, never 0", async () => {
    const stats = await statsFrom({ totalUsers: 1000, jobsByStatus: {} })
    expect(stats.usersAcceptingEmail).toBeNull()
    expect(stats.usersWithGeneration).toBeNull()
  })

  it("a real 0 stays 0", async () => {
    const stats = await statsFrom({ totalUsers: 3, usersAcceptingEmail: 0, usersWithGeneration: 0, jobsByStatus: {} })
    expect(stats.usersAcceptingEmail).toBe(0)
    expect(stats.usersWithGeneration).toBe(0)
  })
})
