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
  useUpdateNodeMenuPrefsMutation,
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
      textTemplates: [],
      preferredLocale: null,
      showRecentNodes: false,
      showMostUsedNodes: false,
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
      textTemplates: [],
      preferredLocale: null,
      showRecentNodes: false,
      showMostUsedNodes: false,
    })
  })

  it("queryFn parses textTemplates from the API", async () => {
    const textTemplates = [{ id: "t1", label: "Blog", systemPrompt: "You write blogs." }]
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { textTemplates } }),
    })
    mockUseQuery.mockReturnValue({ data: null })
    useUserSettings("u1")
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(result.textTemplates).toEqual(textTemplates)
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

  it("mutationFn forwards textTemplates when provided (drops it when undefined)", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useSaveTemplatesMutation()

    const textTemplates = [{ id: "t1", label: "Blog", systemPrompt: "You write blogs." }]
    await captured.mutationFn({ userId: "u1", promptTemplates: { a: "b" }, textTemplates })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({ userId: "u1", promptTemplates: { a: "b" }, textTemplates })

    // Without textTemplates, the field is omitted entirely (PATCH-merge semantics).
    mockFetch.mockClear()
    await captured.mutationFn({ userId: "u1", promptTemplates: { a: "b" } })
    const body2 = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body2).toEqual({ userId: "u1", promptTemplates: { a: "b" } })
    expect("textTemplates" in body2).toBe(false)
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

describe("useUpdateNodeMenuPrefsMutation", () => {
  const mockCancelQueries = vi.fn()
  const mockGetQueryData = vi.fn()
  const mockSetQueryData = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    mockCancelQueries.mockResolvedValue(undefined)
    mockGetQueryData.mockReturnValue(undefined)
    mockUseQueryClient.mockReturnValue({
      invalidateQueries: mockInvalidateQueries,
      cancelQueries: mockCancelQueries,
      getQueryData: mockGetQueryData,
      setQueryData: mockSetQueryData,
    })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("mutationFn sends PATCH and drops the untouched (undefined) field", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateNodeMenuPrefsMutation()

    await captured.mutationFn({ userId: "u1", showRecentNodes: true })
    expect(mockFetch).toHaveBeenCalledWith(
      "/v1/user/settings",
      expect.objectContaining({ method: "PATCH" })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body).toEqual({ userId: "u1", showRecentNodes: true })
  })

  it("mutationFn throws on non-ok response", async () => {
    mockFetch.mockResolvedValue({ ok: false })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateNodeMenuPrefsMutation()

    await expect(
      captured.mutationFn({ userId: "u1", showMostUsedNodes: false })
    ).rejects.toThrow("Failed to update node menu preferences")
  })

  it("onMutate optimistically merges only the toggled field and returns rollback context", async () => {
    const previous = {
      publicOutputs: true,
      tier: "free",
      promptTemplates: {},
      preferredLocale: null,
      showRecentNodes: false,
      showMostUsedNodes: false,
    }
    mockGetQueryData.mockReturnValue(previous)
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateNodeMenuPrefsMutation()

    const ctx = await captured.onMutate({ userId: "u1", showRecentNodes: true })
    expect(mockCancelQueries).toHaveBeenCalledWith({ queryKey: ["user-settings", "u1"] })
    expect(mockSetQueryData).toHaveBeenCalledWith(
      ["user-settings", "u1"],
      { ...previous, showRecentNodes: true }
    )
    expect(ctx).toEqual({ queryKey: ["user-settings", "u1"], previous })
  })

  it("onMutate does not write the cache when there is no cached settings", async () => {
    mockGetQueryData.mockReturnValue(undefined)
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateNodeMenuPrefsMutation()

    const ctx = await captured.onMutate({ userId: "u1", showMostUsedNodes: true })
    expect(mockSetQueryData).not.toHaveBeenCalled()
    expect(ctx).toEqual({ queryKey: ["user-settings", "u1"], previous: undefined })
  })

  it("onError rolls back to the previous snapshot", () => {
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateNodeMenuPrefsMutation()

    const previous = { showRecentNodes: false }
    captured.onError(
      new Error("boom"),
      { userId: "u1" },
      { queryKey: ["user-settings", "u1"], previous }
    )
    expect(mockSetQueryData).toHaveBeenCalledWith(["user-settings", "u1"], previous)
  })

  it("onError is a no-op when there is no previous snapshot", () => {
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateNodeMenuPrefsMutation()

    captured.onError(
      new Error("boom"),
      { userId: "u1" },
      { queryKey: ["user-settings", "u1"], previous: undefined }
    )
    expect(mockSetQueryData).not.toHaveBeenCalled()
  })

  it("onSettled invalidates userSettings.detail for the userId", () => {
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateNodeMenuPrefsMutation()

    captured.onSettled({}, null, { userId: "u3", showRecentNodes: true })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user-settings", "u3"],
    })
  })
})
