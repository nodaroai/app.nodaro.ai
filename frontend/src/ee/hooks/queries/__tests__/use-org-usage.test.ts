import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockHasOrganizations = vi.fn(() => true)
// vi.hoisted: the orgs-api mock factory reads these EAGERLY, so they must exist
// before the hoisted vi.mock runs (unlike the closure-wrapped useQuery mock).
const mockApi = vi.hoisted(() => ({
  getOrgUsage: vi.fn(),
  getWorkspaceUsage: vi.fn(),
  listOrgUsageRows: vi.fn(),
  listWorkspaceUsageRows: vi.fn(),
}))

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>()
  return { ...actual, useQuery: (opts: unknown) => mockUseQuery(opts) }
})
vi.mock("@/lib/edition", () => ({ hasOrganizations: () => mockHasOrganizations() }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))
vi.mock("@/ee/lib/orgs-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/orgs-api")>()
  return {
    ...actual, // keeps the real OrgApiError
    getOrgUsage: mockApi.getOrgUsage,
    getWorkspaceUsage: mockApi.getWorkspaceUsage,
    listOrgUsageRows: mockApi.listOrgUsageRows,
    listWorkspaceUsageRows: mockApi.listWorkspaceUsageRows,
  }
})

import { OrgApiError } from "@/ee/lib/orgs-api"
import { useOrgUsage, useWorkspaceUsage, useOrgUsageRows, useWorkspaceUsageRows } from "../use-org-usage"

interface QueryOpts {
  enabled: boolean
  queryKey: readonly unknown[]
  queryFn: () => unknown
  retry: (count: number, err: unknown) => boolean
  placeholderData?: unknown
}
function lastOpts(): QueryOpts {
  return mockUseQuery.mock.calls.at(-1)?.[0] as QueryOpts
}

beforeEach(() => {
  mockUseQuery.mockReset()
  mockHasOrganizations.mockReset()
  mockHasOrganizations.mockReturnValue(true)
  for (const m of Object.values(mockApi)) m.mockReset()
})

describe("useOrgUsage", () => {
  it("is disabled without an org id", () => {
    useOrgUsage(undefined, { groupBy: "day" })
    expect(lastOpts().enabled).toBe(false)
  })

  it("is disabled when hasOrganizations() is false", () => {
    mockHasOrganizations.mockReturnValue(false)
    useOrgUsage("o-1", { groupBy: "day" })
    expect(lastOpts().enabled).toBe(false)
  })

  it("is enabled with an id while organizations are on", () => {
    useOrgUsage("o-1", { groupBy: "day" })
    expect(lastOpts().enabled).toBe(true)
  })

  it("never retries an OrgApiError (4xx or 5xx state); retries transport failures, bounded", () => {
    useOrgUsage("o-1", { groupBy: "day" })
    const { retry } = lastOpts()
    expect(retry(1, new OrgApiError("insufficient_role", "no", 403))).toBe(false)
    expect(retry(1, new OrgApiError("not_found", "no", 404))).toBe(false)
    expect(retry(1, new OrgApiError("billing_unavailable", "later", 503))).toBe(false)
    expect(retry(0, new TypeError("Failed to fetch"))).toBe(true)
    expect(retry(2, new TypeError("Failed to fetch"))).toBe(false)
  })

  it("queryFn calls getOrgUsage with the id, groupBy and a resolved tz", async () => {
    mockApi.getOrgUsage.mockResolvedValueOnce({ rows: [] })
    useOrgUsage("o-1", { groupBy: "member", from: "2026-09-01" })
    await lastOpts().queryFn()
    expect(mockApi.getOrgUsage).toHaveBeenCalledWith(
      "o-1",
      expect.objectContaining({ groupBy: "member", from: "2026-09-01", tz: expect.any(String) }),
    )
  })

  it("passes an explicit tz through verbatim (not overwritten by the browser zone)", async () => {
    mockApi.getOrgUsage.mockResolvedValueOnce({ rows: [] })
    useOrgUsage("o-1", { groupBy: "day", tz: "Asia/Jerusalem" })
    await lastOpts().queryFn()
    expect(mockApi.getOrgUsage).toHaveBeenCalledWith("o-1", expect.objectContaining({ tz: "Asia/Jerusalem" }))
  })

  it("carries the params (with a resolved tz) in the query key", () => {
    useOrgUsage("o-1", { groupBy: "member", from: "2026-09-01" })
    const key = lastOpts().queryKey
    expect(key.slice(0, 3)).toEqual(["orgs", "usage", "o-1"])
    expect(key[3]).toMatchObject({ groupBy: "member", from: "2026-09-01" })
    expect(typeof (key[3] as { tz?: unknown }).tz).toBe("string")
  })
})

describe("useOrgUsageRows", () => {
  it("keeps previous data and forwards limit + cursor to listOrgUsageRows", async () => {
    mockApi.listOrgUsageRows.mockResolvedValueOnce({ data: [], nextCursor: null })
    useOrgUsageRows("o-1", { limit: 25 }, "cursor-abc")
    expect(lastOpts().placeholderData).toBeDefined()
    await lastOpts().queryFn()
    expect(mockApi.listOrgUsageRows).toHaveBeenCalledWith(
      "o-1",
      expect.objectContaining({ limit: 25, cursor: "cursor-abc", tz: expect.any(String) }),
    )
  })
})

describe("useWorkspaceUsage", () => {
  it("is disabled without an id / when orgs are off; enabled otherwise", () => {
    useWorkspaceUsage(undefined, { groupBy: "day" })
    expect(lastOpts().enabled).toBe(false)
    mockHasOrganizations.mockReturnValue(false)
    useWorkspaceUsage("ws-1", { groupBy: "day" })
    expect(lastOpts().enabled).toBe(false)
    mockHasOrganizations.mockReturnValue(true)
    useWorkspaceUsage("ws-1", { groupBy: "day" })
    expect(lastOpts().enabled).toBe(true)
  })

  it("queryFn calls getWorkspaceUsage with the id and a resolved tz", async () => {
    mockApi.getWorkspaceUsage.mockResolvedValueOnce({ rows: [] })
    useWorkspaceUsage("ws-1", { groupBy: "member" })
    await lastOpts().queryFn()
    expect(mockApi.getWorkspaceUsage).toHaveBeenCalledWith("ws-1", expect.objectContaining({ groupBy: "member", tz: expect.any(String) }))
  })
})

describe("useWorkspaceUsageRows", () => {
  it("is disabled without an id, and forwards limit + cursor", async () => {
    useWorkspaceUsageRows(undefined, {})
    expect(lastOpts().enabled).toBe(false)
    mockApi.listWorkspaceUsageRows.mockResolvedValueOnce({ data: [], nextCursor: null })
    useWorkspaceUsageRows("ws-1", { limit: 10 }, "cur-1")
    expect(lastOpts().enabled).toBe(true)
    await lastOpts().queryFn()
    expect(mockApi.listWorkspaceUsageRows).toHaveBeenCalledWith(
      "ws-1",
      expect.objectContaining({ limit: 10, cursor: "cur-1", tz: expect.any(String) }),
    )
  })
})
