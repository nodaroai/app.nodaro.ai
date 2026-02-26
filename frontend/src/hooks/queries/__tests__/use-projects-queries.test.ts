import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockCreateClient = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    projects: {
      list: () => ["projects", "list"],
      detail: (id: string) => ["projects", "detail", id],
    },
  },
}))

import { useProjects, useProjectData } from "../use-projects-queries"

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

  it("queryFn fetches from supabase projects table", async () => {
    const mockData = [
      { id: "p1", name: "Project 1", description: "desc", created_at: "2026-01-01", updated_at: "2026-01-02" },
    ]
    const mockEq = vi.fn().mockResolvedValue({ data: mockData, error: null })
    const mockOrder = vi.fn().mockReturnValue({ eq: mockEq })
    const mockSelect = vi.fn().mockReturnValue({ order: mockOrder })
    const mockAuth = { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } } }) }
    mockCreateClient.mockReturnValue({ from: vi.fn().mockReturnValue({ select: mockSelect }), auth: mockAuth })
    mockUseQuery.mockReturnValue({ data: null })

    useProjects()
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()

    expect(mockEq).toHaveBeenCalledWith("user_id", "user-1")
    expect(result).toEqual([
      { id: "p1", name: "Project 1", description: "desc", createdAt: "2026-01-01", updatedAt: "2026-01-02", userId: undefined, ownerEmail: undefined },
    ])
  })

  it("queryFn throws on supabase error", async () => {
    const mockEq = vi.fn().mockResolvedValue({ data: null, error: new Error("db error") })
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
