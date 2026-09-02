import { describe, it, expect, vi, beforeEach } from "vitest"

const mockUseQuery = vi.fn()
const mockHasOrganizations = vi.fn(() => true)

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>()
  return { ...actual, useQuery: (opts: unknown) => mockUseQuery(opts) }
})
vi.mock("@/lib/edition", () => ({ hasOrganizations: () => mockHasOrganizations() }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))

import { OrgApiError } from "@/ee/lib/orgs-api"
import { useOrgUsage, useOrgUsageRows } from "../use-org-usage"

interface QueryOpts {
  enabled: boolean
  queryKey: readonly unknown[]
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

  it("does not retry a 4xx OrgApiError, but retries a 5xx", () => {
    useOrgUsage("o-1", { groupBy: "day" })
    const { retry } = lastOpts()
    expect(retry(1, new OrgApiError("insufficient_role", "no", 403))).toBe(false)
    expect(retry(1, new OrgApiError("not_found", "no", 404))).toBe(false)
    expect(retry(1, new OrgApiError("billing_unavailable", "later", 503))).toBe(true)
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
  it("keeps previous data while paging", () => {
    useOrgUsageRows("o-1", {}, "cursor-abc")
    expect(lastOpts().placeholderData).toBeDefined()
  })
})
