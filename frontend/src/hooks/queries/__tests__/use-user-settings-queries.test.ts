import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockUseQueryClient = vi.fn()
const mockGetAuthHeaders = vi.fn()
const mockFetch = vi.fn()
const mockInvalidateQueries = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useMutation: (opts: unknown) => mockUseMutation(opts),
  useQueryClient: () => mockUseQueryClient(),
}))

vi.mock("@/lib/api", () => ({
  getAuthHeaders: () => mockGetAuthHeaders(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    userSettings: {
      all: ["user-settings"],
      detail: (userId: string) => ["user-settings", userId],
    },
  },
}))

import {
  useUserSettings,
  useUpdatePublicOutputsMutation,
  useSaveTemplatesMutation,
} from "../use-user-settings-queries"

describe("useUserSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("passes correct query key with userId", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useUserSettings("u1")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["user-settings", "u1"],
      })
    )
  })

  it("uses empty string in query key when userId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useUserSettings(undefined)
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["user-settings", ""],
      })
    )
  })

  it("is enabled when userId is provided", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useUserSettings("u1")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("is disabled when userId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useUserSettings(undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has staleTime of 60_000", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useUserSettings("u1")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(60_000)
  })

  it("queryFn returns parsed settings from API", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { publicOutputs: false, tier: "pro", promptTemplates: { k: "v" } },
      }),
    })
    mockUseQuery.mockReturnValue({ data: null })
    useUserSettings("u1")
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(result).toEqual({
      publicOutputs: false,
      tier: "pro",
      promptTemplates: { k: "v" },
      preferredLocale: null,
    })
  })

  it("queryFn applies defaults for missing fields", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    })
    mockUseQuery.mockReturnValue({ data: null })
    useUserSettings("u1")
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(result).toEqual({
      publicOutputs: true,
      tier: "free",
      promptTemplates: {},
      preferredLocale: null,
    })
  })
})

describe("useUpdatePublicOutputsMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    mockUseQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("calls useMutation", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useUpdatePublicOutputsMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
  })

  it("mutationFn sends PATCH request with publicOutputs", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdatePublicOutputsMutation()

    await captured.mutationFn({ userId: "u1", publicOutputs: false })
    expect(mockFetch).toHaveBeenCalledWith(
      "/v1/user/settings",
      expect.objectContaining({ method: "PATCH" })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({ userId: "u1", publicOutputs: false })
  })

  it("mutationFn throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdatePublicOutputsMutation()

    await expect(
      captured.mutationFn({ userId: "u1", publicOutputs: true })
    ).rejects.toThrow("Failed to update settings")
  })

  it("onSuccess invalidates userSettings.detail for the userId", () => {
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdatePublicOutputsMutation()

    captured.onSuccess({}, { userId: "u1", publicOutputs: false })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user-settings", "u1"],
    })
  })
})

describe("useSaveTemplatesMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    mockUseQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("calls useMutation", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useSaveTemplatesMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
  })

  it("mutationFn sends PATCH with promptTemplates", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useSaveTemplatesMutation()

    const templates = { scene: "A dark room" }
    await captured.mutationFn({ userId: "u1", promptTemplates: templates })
    expect(mockFetch).toHaveBeenCalledWith(
      "/v1/user/settings",
      expect.objectContaining({ method: "PATCH" })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({ userId: "u1", promptTemplates: templates })
  })

  it("mutationFn throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useSaveTemplatesMutation()

    await expect(
      captured.mutationFn({ userId: "u1", promptTemplates: {} })
    ).rejects.toThrow("Failed to save templates")
  })

  it("onSuccess invalidates userSettings.detail for the userId", () => {
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useSaveTemplatesMutation()

    captured.onSuccess({}, { userId: "u2", promptTemplates: {} })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user-settings", "u2"],
    })
  })
})
