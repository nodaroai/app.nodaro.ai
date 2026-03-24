import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockUseMutation = vi.fn()
const mockUseQueryClient = vi.fn()
const mockIsCommunity = vi.fn()
const mockGetAuthHeaders = vi.fn()
const mockFetch = vi.fn()
const mockInvalidateQueries = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useMutation: (opts: unknown) => mockUseMutation(opts),
  useQueryClient: () => mockUseQueryClient(),
}))

vi.mock("@/lib/edition", () => ({
  isCommunity: () => mockIsCommunity(),
}))

vi.mock("@/lib/api", () => ({
  getAuthHeaders: () => mockGetAuthHeaders(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    appSettings: { all: ["app-settings"] },
    admin: { settings: () => ["admin", "settings"] },
  },
}))

import { useAppSettings, useUpdateSettingMutation } from "../use-app-settings-queries"
import type { AppSettings } from "../use-app-settings-queries"

const DEFAULT_SETTINGS: AppSettings = {
  ai_provider: "kie",
  ***REDACTED-OSS-SCRUB***
  apps_video_autoplay: true,
  featured_app_ids: [],
}

describe("useAppSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsCommunity.mockReturnValue(false)
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("passes correct query key", () => {
    mockUseQuery.mockReturnValue({ data: DEFAULT_SETTINGS })
    useAppSettings()
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["app-settings"],
      })
    )
  })

  it("has 5 minute stale time", () => {
    mockUseQuery.mockReturnValue({ data: DEFAULT_SETTINGS })
    useAppSettings()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(5 * 60_000)
  })

  it("has placeholder data with defaults", () => {
    mockUseQuery.mockReturnValue({ data: DEFAULT_SETTINGS })
    useAppSettings()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.placeholderData).toEqual(DEFAULT_SETTINGS)
  })

  it("queryFn returns defaults for community edition", async () => {
    mockIsCommunity.mockReturnValue(true)
    mockUseQuery.mockReturnValue({ data: DEFAULT_SETTINGS })
    useAppSettings()
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(result).toEqual(DEFAULT_SETTINGS)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("queryFn fetches from API for non-community", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        settings: { ai_provider: "kie", cost_markup_percent: 30 },
      }),
    })
    mockUseQuery.mockReturnValue({ data: null })
    useAppSettings()
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(result).toEqual({ ai_provider: "kie", cost_markup_percent: 30 })
  })

  it("queryFn returns defaults on fetch failure", async () => {
    mockFetch.mockResolvedValue({ ok: false })
    mockUseQuery.mockReturnValue({ data: null })
    useAppSettings()
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(result).toEqual(DEFAULT_SETTINGS)
  })
})

describe("useUpdateSettingMutation", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAuthHeaders.mockResolvedValue({ Authorization: "Bearer tok" })
    mockUseQueryClient.mockReturnValue({ invalidateQueries: mockInvalidateQueries })
    globalThis.fetch = mockFetch as unknown as typeof fetch
  })

  it("calls useMutation", () => {
    mockUseMutation.mockReturnValue({ mutate: vi.fn() })
    useUpdateSettingMutation()
    expect(mockUseMutation).toHaveBeenCalledTimes(1)
  })

  it("mutationFn sends PUT request", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateSettingMutation()

    await captured.mutationFn({ key: "ai_provider", value: "kie" })
    expect(mockFetch).toHaveBeenCalledWith(
      "/v1/admin/settings/ai_provider",
      expect.objectContaining({ method: "PUT" })
    )
  })

  it("mutationFn throws on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false })
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateSettingMutation()

    await expect(captured.mutationFn({ key: "x", value: "y" })).rejects.toThrow(
      "Failed to update setting"
    )
  })

  it("onSuccess invalidates appSettings and admin.settings queries", async () => {
    let captured: any
    mockUseMutation.mockImplementation((opts: any) => {
      captured = opts
      return { mutate: vi.fn() }
    })
    useUpdateSettingMutation()

    captured.onSuccess()
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["app-settings"] })
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["admin", "settings"] })
  })
})
