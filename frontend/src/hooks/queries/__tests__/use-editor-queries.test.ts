import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockGetWorkflowCostSummary = vi.fn()
const mockCreateClient = vi.fn()
const mockHasCredits = vi.fn()

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: unknown) => mockUseQuery(opts),
}))

vi.mock("@/lib/api", () => ({
  getWorkflowCostSummary: (...args: unknown[]) =>
    mockGetWorkflowCostSummary(...args),
}))

vi.mock("@/lib/supabase", () => ({
  createClient: () => mockCreateClient(),
}))

vi.mock("@/lib/edition", () => ({
  hasCredits: () => mockHasCredits(),
}))

vi.mock("@/lib/query-keys", () => ({
  queryKeys: {
    editor: {
      costSummary: (jobIds: readonly string[]) =>
        ["editor", "cost-summary", [...jobIds].sort()],
      importableWorkflows: (projectId: string, currentWorkflowId: string) =>
        ["editor", "importable-workflows", projectId, currentWorkflowId],
    },
  },
}))

import {
  useWorkflowCostSummary,
  useImportableWorkflows,
} from "../use-editor-queries"

describe("useWorkflowCostSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCredits.mockReturnValue(true)
  })

  it("passes correct query key with sorted job IDs", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useWorkflowCostSummary(["job-b", "job-a"])
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["editor", "cost-summary", ["job-a", "job-b"]],
      })
    )
  })

  it("is enabled when jobIds is non-empty and hasCredits is true", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useWorkflowCostSummary(["job-1"])
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("is disabled when jobIds array is empty", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useWorkflowCostSummary([])
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when hasCredits returns false", () => {
    mockHasCredits.mockReturnValue(false)
    mockUseQuery.mockReturnValue({ data: null })
    useWorkflowCostSummary(["job-1"])
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("is disabled when jobIds is empty and hasCredits is false", () => {
    mockHasCredits.mockReturnValue(false)
    mockUseQuery.mockReturnValue({ data: null })
    useWorkflowCostSummary([])
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has staleTime of 60_000", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useWorkflowCostSummary(["job-1"])
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(60_000)
  })

  it("queryFn calls getWorkflowCostSummary and returns data", async () => {
    mockUseQuery.mockReturnValue({ data: null })
    mockGetWorkflowCostSummary.mockResolvedValue({
      data: { totalCredits: 10, jobs: [] },
    })
    useWorkflowCostSummary(["job-1", "job-2"])
    const opts = mockUseQuery.mock.calls[0][0]
    const result = await opts.queryFn()
    expect(mockGetWorkflowCostSummary).toHaveBeenCalledWith(["job-1", "job-2"])
    expect(result).toEqual({ totalCredits: 10, jobs: [] })
  })
})

describe("useImportableWorkflows", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("passes correct query key using projectId and currentWorkflowId", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useImportableWorkflows("proj-1", "wf-2", true)
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["editor", "importable-workflows", "proj-1", "wf-2"],
      })
    )
  })

  it("defaults undefined projectId and currentWorkflowId to empty strings in query key", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useImportableWorkflows(undefined, null, false)
    expect(mockUseQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["editor", "importable-workflows", "", ""],
      })
    )
  })

  it("is enabled when isOpen is true", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useImportableWorkflows("proj-1", "wf-2", true)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(true)
  })

  it("is disabled when isOpen is false", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useImportableWorkflows("proj-1", "wf-2", false)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.enabled).toBe(false)
  })

  it("has staleTime of 30_000", () => {
    mockUseQuery.mockReturnValue({ data: null })
    useImportableWorkflows("proj-1", "wf-2", true)
    const opts = mockUseQuery.mock.calls[0][0]
    expect(opts.staleTime).toBe(30_000)
  })
})
