import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockCreateClient = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
  useQueryClient: () => ({}),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockCreateClient(),
}))

// Visibility filter is exercised by its own unit tests; here we stub it so the
// projects-query tests stay focused and deterministic.
const mockReadShowClientAppsFlag = vi.fn().mockReturnValue(false)
vi.mock("../use-client-apps-queries", () => ({
  fetchListedAppSlugs: vi.fn().mockResolvedValue([]),
  projectVisibilityFilter: vi.fn().mockReturnValue("app_slug.is.null"),
  readShowClientAppsFlag: () => mockReadShowClientAppsFlag(),
  isAppSlugColumnMissing: (e: { code?: string; message?: string } | null) =>
    e?.code === "42703" ||
    e?.code === "PGRST204" ||
    (typeof e?.message === "string" && e.message.includes("app_slug")),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    projects: {
      all: ["projects"],
      list: () => ["projects", "list"],
      detail: (id: string) => ["projects", "detail", id],
    },
  },
}))

// useAllProjects hits the admin backend route; stub auth headers so its queryFn
// runs without reaching for real supabase auth.
vi.mock("@/lib/api", () => ({
  getAuthHeaders: vi.fn().mockResolvedValue({}),
}))

import { useProjects, useProjectData, useAllProjects } from "../use-projects-queries"

describe("useProjects", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passes correct query key", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useProjects()
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["projects", "list"],
      })
    )
  })

  it("has 30s stale time", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useProjects()
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(30_000)
  })

  it("queryFn fetches from supabase projects table, scoped + visibility-filtered", async () => {
    mockReadShowClientAppsFlag.mockReturnValue(false)
    const mockData = [
      { id: "p1", name: "Project 1", description: "desc", created_at: "2026-01-01", updated_at: "2026-01-02" },
    ]
    // Default path: owner-scoped `.eq` then the visibility `.or` terminal.
    const mockOr = vi.fn().mockResolvedValue({ data: mockData, error: null })
    const mockEq = vi.fn().mockReturnValue({ or: mockOr })
    const mockOrder = vi.fn().mockReturnValue({ eq: mockEq })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    const mockAuth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }
    mockCreateClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select: mockSelect }), auth: mockAuth })
    mockUseQuery.mockReturnValue({ data: null })

    useProjects()
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()

    expect(mockEq).toHaveBeenCalledWith("user_id", "user-1")
    // Client-app projects are hidden by the visibility filter.
    expect(mockOr).toHaveBeenCalledWith("app_slug.is.null")
    expect(result).toEqual([
      { id: "p1", name: "Project 1", description: "desc", isDefault: false, createdAt: "2026-01-01", updatedAt: "2026-01-02", userId: undefined, ownerEmail: undefined, settings: {} },
    ])
  })

  it("admin override ON skips the visibility filter (no .or)", async () => {
    mockReadShowClientAppsFlag.mockReturnValue(true)
    const mockEq = vi.fn().mockResolvedValue({ data: [], error: null })
    const mockOrder = vi.fn().mockReturnValue({ eq: mockEq })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    const mockAuth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }
    mockCreateClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select: mockSelect }), auth: mockAuth })
    mockUseQuery.mockReturnValue({ data: null })

    useProjects()
    await mockUseQuery.mock.calls[0][0].queryFn()

    // No `.or` chained — the terminal was `.eq`, which resolved directly.
    expect(mockEq).toHaveBeenCalledWith("user_id", "user-1")
  })

  it("falls back to an unfiltered query when projects.app_slug is missing (pre-migration)", async () => {
    mockReadShowClientAppsFlag.mockReturnValue(false)
    const rows = [
      { id: "p1", name: "Project 1", description: "d", created_at: "2026-01-01", updated_at: "2026-01-02" },
    ]
    // The filter branch (.or) errors with undefined_column; the builder is also
    // thenable and resolves rows for the unfiltered retry.
    const filteredOr = vi
      .fn()
      .mockResolvedValue({ data: null, error: { code: "42703", message: "column projects.app_slug does not exist" } })
    const makeBuilder = () => {
      const b: Record<string, unknown> = {}
      b.select = () => b
      b.order = () => b
      b.eq = () => b
      b.or = filteredOr
      b.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve)
      return b
    }
    const mockAuth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }
    mockCreateClient.mockReturnValue({ from: () => makeBuilder(), auth: mockAuth })
    mockUseQuery.mockReturnValue({ data: null })

    useProjects()
    const result = await mockUseQuery.mock.calls[0][0].queryFn()

    expect(filteredOr).toHaveBeenCalledTimes(1) // the filter WAS attempted
    expect((result as Array<{ id: string }>).map((p) => p.id)).toEqual(["p1"]) // list still renders
  })

  it("queryFn throws on supabase error", async () => {
    mockReadShowClientAppsFlag.mockReturnValue(false)
    const mockOr = vi.fn().mockResolvedValue({ data: null, error: new Error("db error") })
    const mockEq = vi.fn().mockReturnValue({ or: mockOr })
    const mockOrder = vi.fn().mockReturnValue({ eq: mockEq })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    const mockAuth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }
    mockCreateClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select: mockSelect }), auth: mockAuth })
    mockUseQuery.mockReturnValue({ data: null })

    useProjects()
    const opts = mockUseQuery.mock.calls[0][0]
    await expect(opts.queryFn()).rejects.toThrow("db error")
  })
})

describe("useProjectData", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passes correct query key with projectId", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useProjectData("proj-123")
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["projects", "detail", "proj-123"],
      })
    )
  })

  it("passes empty string query key when projectId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useProjectData(undefined)
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["projects", "detail", ""],
      })
    )
  })

  it("has 30s stale time", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useProjectData("proj-123")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(30_000)
  })

  it("is enabled when projectId is provided", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useProjectData("proj-123")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("is disabled when projectId is undefined", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useProjectData(undefined)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when projectId is empty string", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useProjectData("")
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("queryFn fetches folders and workflows and maps them", async () => {
    const mockFolders = [
      { id: "f1", project_id: "proj-1", name: "Folder 1", created_at: "2026-01-01" },
    ]
    const mockWorkflows = [
      { id: "w1", project_id: "proj-1", folder_id: null, name: "Workflow 1", created_at: "2026-01-01", updated_at: "2026-01-02" },
    ]
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "folders") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: mockFolders, error: null }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: mockWorkflows, error: null }),
          }),
        }),
      }
    })
    mockCreateClient.mockReturnValue({ from: mockFrom })
    mockUseQuery.mockReturnValue({ data: null })

    useProjectData("proj-1")
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()

    expect(result).toEqual({
      folders: [{ id: "f1", projectId: "proj-1", name: "Folder 1", createdAt: "2026-01-01" }],
      workflowMetas: [{ id: "w1", projectId: "proj-1", folderId: null, name: "Workflow 1", createdAt: "2026-01-01", updatedAt: "2026-01-02" }],
    })
  })

  it("queryFn throws when folders query errors", async () => {
    const mockFrom = vi.fn().mockImplementation((table: string) => {
      if (table === "folders") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({ data: null, error: new Error("folders error") }),
            }),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        }),
      }
    })
    mockCreateClient.mockReturnValue({ from: mockFrom })
    mockUseQuery.mockReturnValue({ data: null })

    useProjectData("proj-1")
    const opts = mockUseQuery.mock.calls[0][0]
    await expect(opts.queryFn()).rejects.toThrow("folders error")
  })
})

describe("useAllProjects — admin reveal flag threading", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadShowClientAppsFlag.mockReturnValue(false)
  })

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [], currentUserId: "u1" }),
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }

  it("requests includeClientApps=true when the reveal flag is ON", async () => {
    mockReadShowClientAppsFlag.mockReturnValue(true)
    const fetchMock = stubFetch()
    mockUseQuery.mockReturnValue({ data: null })

    useAllProjects(true)
    await mockUseQuery.mock.calls[0][0].queryFn()

    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/projects?viewAll=true&includeClientApps=true",
      expect.anything(),
    )
  })

  it("omits includeClientApps when the reveal flag is OFF (default exclusion)", async () => {
    mockReadShowClientAppsFlag.mockReturnValue(false)
    const fetchMock = stubFetch()
    mockUseQuery.mockReturnValue({ data: null })

    useAllProjects(true)
    await mockUseQuery.mock.calls[0][0].queryFn()

    expect(fetchMock).toHaveBeenCalledWith("/v1/projects?viewAll=true", expect.anything())
  })

  it("passes through the enabled gate", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useAllProjects(false)
    expect(mockUseQuery.mock.calls[0][0].enabled).toBe(false)
  })
})
